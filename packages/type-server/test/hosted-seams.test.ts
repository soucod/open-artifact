/**
 * The seams an embedding host (a Cloudflare room) uses instead of a listener: `internal` (the handshake routes in
 * process), `connect` (a WebSocket the host accepted itself), `viewers`, `watch: 'events'` (no timer runs only to
 * notice changes; checked with instrumented timers on the real `node:fs`), closing an idle artifact, and a host that
 * cannot import PDFs saying so.
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, IncomingMessage, request, type IncomingHttpHeaders, type Server } from 'node:http';
import { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Viewer } from '@open-artifact/runtime/capabilities';
import { createTypeServer, type HostedSocket, type TypeServer, type TypeServerHosting } from '../src/index.ts';
import type { TypeName } from '../src/types.ts';

// --- Live timers made by the product's code (not node:test's), with where each was made. ---------------------------

interface Live {
  kind: 'timeout' | 'interval';
  ms: number;
  site: string;
}
const live = new Map<unknown, Live>();
const keyOf = (handle: unknown): unknown =>
  typeof handle === 'object' && handle !== null && Symbol.toPrimitive in handle ? (handle as { [Symbol.toPrimitive](): unknown })[Symbol.toPrimitive]() : handle;
/** The first stack frame in a package's source (not a test), or null for anyone else's timer. */
const productSite = (): string | null =>
  (new Error().stack ?? '').split('\n').find((line) => /\/packages\/[^/]+\/src\//.test(line))?.trim() ?? null;
{
  const real = { setTimeout, setInterval, clearTimeout, clearInterval };
  const g = globalThis as unknown as Record<string, unknown>;
  g.setTimeout = (fn: (...args: unknown[]) => void, ms?: number, ...rest: unknown[]) => {
    const site = productSite();
    const handle: unknown = real.setTimeout(
      (...args: unknown[]) => {
        live.delete(keyOf(handle));
        fn(...args);
      },
      ms,
      ...rest,
    );
    if (site) live.set(keyOf(handle), { kind: 'timeout', ms: Number(ms ?? 0), site });
    return handle;
  };
  g.setInterval = (fn: (...args: unknown[]) => void, ms?: number, ...rest: unknown[]) => {
    const site = productSite();
    const handle = real.setInterval(fn, ms, ...rest);
    if (site) live.set(keyOf(handle), { kind: 'interval', ms: Number(ms ?? 0), site });
    return handle;
  };
  g.clearTimeout = (handle: Parameters<typeof clearTimeout>[0]) => {
    live.delete(keyOf(handle));
    real.clearTimeout(handle);
  };
  g.clearInterval = (handle: Parameters<typeof clearInterval>[0]) => {
    live.delete(keyOf(handle));
    real.clearInterval(handle);
  };
}
const intervals = (): Live[] => [...live.values()].filter((t) => t.kind === 'interval');
const describeTimers = (timers: Live[]): string => timers.map((t) => `${t.kind} ${t.ms} ms at ${t.site}`).join('\n') || 'none';

// --- Requests and a host's own WebSocket. -------------------------------------------------------------------------

interface Answer {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

function call(port: number, method: string, path: string, headers: Record<string, string> = {}, body?: string | Uint8Array): Promise<Answer> {
  return new Promise((resolvePromise, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

/** The request a host hands to `connect`: only the line and headers matter. */
function upgradeRequest(path: string, headers: Record<string, string>): IncomingMessage {
  const req = new IncomingMessage(new Socket());
  req.method = 'GET';
  req.url = path;
  req.headers = { connection: 'Upgrade', upgrade: 'websocket', ...headers };
  return req;
}

/** A WebSocket as a host holds it: what the server sent, whether it closed it, and the page closing it. */
class FakeSocket implements HostedSocket {
  readonly sent: { event: string; data: unknown }[] = [];
  closedWith: number | null = null;
  private closeListeners: (() => void)[] = [];
  private waiters: (() => void)[] = [];
  sendText(text: string): void {
    this.sent.push(JSON.parse(text) as { event: string; data: unknown });
    for (const wake of this.waiters.splice(0)) wake();
  }
  close(code = 1000): void {
    if (this.closedWith !== null) return;
    this.closedWith = code;
    this.hangUp();
  }
  onMessage(): void {
    // The type server's event stream only sends.
  }
  onClose(listener: () => void): void {
    this.closeListeners.push(listener);
  }
  /** The page went away. */
  hangUp(): void {
    for (const listener of this.closeListeners.splice(0)) listener();
  }
  /** The first message (from now on, or already sent when `from` is 0) that `match` accepts. */
  async next(match: (event: string, data: unknown) => boolean, from = this.sent.length, ms = 5000): Promise<{ event: string; data: unknown }> {
    const until = Date.now() + ms;
    for (;;) {
      const found = this.sent.slice(from).find((m) => match(m.event, m.data));
      if (found) return found;
      const left = until - Date.now();
      if (left <= 0) throw new Error(`no matching message; got ${this.sent.map((m) => m.event).join(', ')}`);
      await new Promise<void>((wake) => {
        this.waiters.push(wake);
        setTimeout(wake, left);
      });
    }
  }
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));
async function until(check: () => boolean | Promise<boolean>, ms = 5000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await sleep(25);
  }
  return check();
}

// --- A host. --------------------------------------------------------------------------------------------------------

interface Host {
  server: TypeServer;
  /** The host's listener (not the type server's): to `internal` when marked so, else to `handle`. */
  port: number;
  root(id: string): string;
  /** A request to artifact `id`'s content host. */
  at(id: string, method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<Answer>;
  /** A request through `internal`. */
  internal(method: string, path: string, body?: unknown): Promise<Answer>;
  /** A page socket, through `connect`. */
  connect(id: string, token: string, client: string, headers?: Record<string, string>): Promise<{ status: number; socket: FakeSocket }>;
  idleClosed: { id: string; stillOpen: number }[];
  close(): Promise<void>;
}

const OWNER: Viewer = { id: 'user:ada', name: 'Ada', role: 'owner' };
const VIEWER: Viewer = { id: 'user:vic', name: 'Vic', role: 'viewer' };
const hostOf = (id: string): string => `${id.replace('_', '-')}.content.test`;

async function startHost(extra: Partial<TypeServerHosting> = {}): Promise<Host> {
  const dir = await mkdtemp(join(tmpdir(), 'open-artifact-seams-'));
  const assets = join(dir, 'assets');
  for (const type of ['whiteboard', 'design', 'docs']) {
    await mkdir(join(assets, 'editors', type), { recursive: true });
    await writeFile(join(assets, 'editors', type, 'index.html'), `<!doctype html><html><head><title>${type}</title></head><body></body></html>`);
  }
  await writeFile(join(assets, 'support.js'), '/* runtime */');
  const root = (id: string): string => join(dir, 'artifacts', id);
  /** Token `v1.<role>-<id>` is `role` on artifact `<id>`. */
  const idleClosed: { id: string; stillOpen: number }[] = [];
  const hosting: TypeServerHosting = {
    hostAllowed: (host) => typeof host === 'string' && host.endsWith('.content.test'),
    async resolve(token) {
      const match = /^v1\.(owner|viewer)-(art_\w+)$/.exec(token);
      if (!match) return null;
      return { id: match[2]!, root: root(match[2]!), title: match[2]!, viewer: match[1] === 'owner' ? OWNER : VIEWER };
    },
    artifactOfHost: (host) => /^(art-\w+)\.content\.test$/.exec(host ?? '')?.[1]!.replace('-', '_') ?? null,
    pageBase: (id) => `https://${hostOf(id)}/`,
    shellUrl: (id) => `https://app.test/a/${id}`,
    appOrigin: 'https://app.test',
    ownerName: () => 'Ada',
    onIdleClose: (id, stillOpen) => idleClosed.push({ id, stillOpen }),
    ...extra,
  };
  // Never `listen()`ed: everything goes through the host's own listener.
  const server = createTypeServer({ assetsDir: assets, secret: 'unused-secret', idleMs: 0, viewerName: 'Local', downloadsDir: join(dir, 'downloads'), lanAddresses: () => [], hosting });
  const front: Server = createServer((req, res) => (req.headers['x-test-internal'] ? server.internal(req, res) : server.handle(req, res)));
  await new Promise<void>((done) => front.listen(0, '127.0.0.1', done));
  const address = front.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  const json = (body: unknown): Record<string, string> => (body === undefined ? {} : { 'content-type': 'application/json' });
  const encode = (body: unknown): string | Uint8Array | undefined => (body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body));
  return {
    server,
    port,
    root,
    idleClosed,
    at: (id, method, path, body, headers = {}) => call(port, method, path, { host: hostOf(id), ...(body instanceof Uint8Array ? {} : json(body)), ...headers }, encode(body)),
    internal: (method, path, body) => call(port, method, path, { host: 'whatever.example', 'x-test-internal': '1', ...json(body) }, encode(body)),
    async connect(id, token, client, headers = {}) {
      const socket = new FakeSocket();
      const status = await server.connect(upgradeRequest(`/${id === 'art_d' ? 'design' : 'whiteboard'}/${token}/_api/events?client=${client}`, { host: hostOf(id), ...headers }), socket);
      return { status, socket };
    },
    async close() {
      front.closeAllConnections();
      await new Promise<void>((done) => front.close(() => done()));
      await server.stop();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

const openBody = (id: string, type: TypeName, root: string): Record<string, string> => ({ id, root, type, title: id });

describe('internal: the handshake routes in process', () => {
  let host: Host;
  before(async () => {
    host = await startHost();
  });
  after(() => host.close());

  it('answers without a listener, a loopback address or the secret, and serves pages without `listen()`', async () => {
    assert.equal(host.server.url, '');
    const health = await host.internal('GET', '/__open-artifact/health');
    assert.equal(health.status, 200);
    assert.equal((JSON.parse(health.body) as { open: number }).open, 0);
    const opened = await host.internal('POST', '/__open-artifact/open', openBody('art_a', 'whiteboard', host.root('art_a')));
    assert.equal(opened.status, 200, opened.body);
    assert.equal((JSON.parse(opened.body) as { id: string }).id, 'art_a');
    const listed = JSON.parse((await host.internal('GET', '/__open-artifact/list')).body) as { artifacts: { id: string; url: string }[] };
    assert.deepEqual(listed.artifacts.map((a) => a.id), ['art_a']);
    // The page and its API, by the host's token, through `handle`.
    assert.equal((await host.at('art_a', 'GET', '/whiteboard/v1.owner-art_a/')).status, 200);
    const session = await host.at('art_a', 'GET', '/whiteboard/v1.owner-art_a/_api/session');
    assert.equal(session.status, 200);
    // The owner keeps the id `owner`, named as the host says.
    assert.deepEqual((JSON.parse(session.body) as { viewer: Viewer }).viewer, { id: 'owner', name: 'Ada', role: 'owner' });
  });

  it('answers only `/__open-artifact/*`, and `handle` never answers those', async () => {
    assert.equal((await host.internal('GET', '/whiteboard/v1.owner-art_a/_api/session')).status, 404);
    assert.equal((await host.internal('GET', '/')).status, 404);
    // Through the content host the handshake routes are not there, secret or not.
    const viaHandle = (headers: Record<string, string>): Promise<Answer> =>
      call(host.port, 'GET', '/whiteboard/../__open-artifact/health', { host: hostOf('art_a'), ...headers });
    assert.notEqual((await viaHandle({})).status, 200);
    assert.notEqual((await viaHandle({ authorization: 'Bearer unused-secret' })).status, 200);
  });
});

describe('connect: a WebSocket the host accepted', () => {
  let host: Host;
  before(async () => {
    host = await startHost();
    await host.internal('POST', '/__open-artifact/open', openBody('art_a', 'whiteboard', host.root('art_a')));
  });
  after(() => host.close());

  it('attaches the page as the token says, sends its events, and lists who is connected', async () => {
    const owner = await host.connect('art_a', 'v1.owner-art_a', 'o1');
    const viewer = await host.connect('art_a', 'v1.viewer-art_a', 'v1', { origin: 'https://art-a.content.test' });
    assert.equal(owner.status, 101);
    assert.equal(viewer.status, 101);
    const agent = await viewer.socket.next((event) => event === 'agent', 0);
    assert.equal((agent.data as { available: boolean }).available, false);
    assert.deepEqual(host.server.viewers('art_a').map((v) => v.role).sort(), ['owner', 'viewer']);
    assert.deepEqual(host.server.viewers('art_zzz'), []);

    // A write straight to the folder reaches both pages, as the agent's.
    const from = owner.socket.sent.length;
    await mkdir(join(host.root('art_a'), 'db', 'elements'), { recursive: true });
    await writeFile(join(host.root('art_a'), 'db', 'elements', 'e1.json'), JSON.stringify({ type: 'note', x: 1, y: 1, text: 'From disk' }));
    const db = await owner.socket.next((event) => event === 'db', from);
    assert.equal((db.data as { author: string }).author, 'agent');

    // The host's check ends the viewer's socket; the page closing its own detaches it.
    host.server.disconnect('art_a', (who) => who.role !== 'viewer');
    assert.equal(viewer.socket.closedWith, 1000);
    assert.ok(await until(() => host.server.viewers('art_a').length === 1));
    owner.socket.hangUp();
    assert.ok(await until(() => host.server.viewers('art_a').length === 0));
  });

  it('answers a refusal with its status and leaves the socket alone', async () => {
    const cases: [string, Record<string, string>, number][] = [
      ['/whiteboard/v1.nobody/_api/events', { host: hostOf('art_a') }, 403],
      ['/whiteboard/v1.owner-art_a/_api/events', { host: hostOf('art_a'), origin: 'https://evil.test' }, 403],
      ['/whiteboard/v1.owner-art_a/_api/nope', { host: hostOf('art_a') }, 404],
      ['/nosuchtype/v1.owner-art_a/_api/events', { host: hostOf('art_a') }, 404],
      ['/whiteboard/v1.owner-art_a/_api/events', { host: 'evil.test' }, 403],
      ['/whiteboard/%E0%A4%A/_api/events', { host: hostOf('art_a') }, 400],
    ];
    for (const [path, headers, status] of cases) {
      const socket = new FakeSocket();
      assert.equal(await host.server.connect(upgradeRequest(path, headers), socket), status, path);
      assert.equal(socket.closedWith, null);
      assert.equal(socket.sent.length, 0);
    }
  });
});

describe("watch: 'events' (one writer: no timer only to notice changes)", () => {
  /** Opens a whiteboard and a design, connects a page to each, and waits for things to settle. */
  async function scene(host: Host): Promise<{ board: FakeSocket; design: FakeSocket }> {
    await host.internal('POST', '/__open-artifact/open', openBody('art_a', 'whiteboard', host.root('art_a')));
    await mkdir(join(host.root('art_d'), 'project'), { recursive: true });
    await writeFile(join(host.root('art_d'), 'project', 'index.html'), '<!doctype html><title>Poster</title>');
    const opened = await host.internal('POST', '/__open-artifact/open', openBody('art_d', 'design', host.root('art_d')));
    assert.equal(opened.status, 200, opened.body);
    const board = await host.connect('art_a', 'v1.owner-art_a', 'b1');
    const design = await host.connect('art_d', 'v1.owner-art_d', 'd1');
    assert.equal(board.status, 101);
    assert.equal(design.status, 101);
    await sleep(400);
    return { board: board.socket, design: design.socket };
  }

  it('keeps no interval running while pages are open, and still sees writes to the folder', async () => {
    live.clear();
    const host = await startHost({ watch: 'events' });
    try {
      const { board, design } = await scene(host);
      assert.deepEqual(intervals(), [], `live intervals:\n${describeTimers(intervals())}`);
      // Nothing long either: what is left are short one-shots (debounces), if any.
      const long = [...live.values()].filter((t) => t.ms >= 2_000);
      assert.deepEqual(long, [], `long timers:\n${describeTimers(long)}`);

      const from = board.sent.length;
      await mkdir(join(host.root('art_a'), 'db', 'elements'), { recursive: true });
      await writeFile(join(host.root('art_a'), 'db', 'elements', 'e9.json'), JSON.stringify({ type: 'note', x: 0, y: 0, text: 'Seen' }));
      const db = await board.next((event) => event === 'db', from);
      assert.deepEqual(Object.keys((db.data as { changes: object }).changes), ['elements/e9']);

      const designFrom = design.sent.length;
      await writeFile(join(host.root('art_d'), 'project', 'index.html'), '<!doctype html><title>Poster 2</title>');
      await design.next((event) => event !== 'agent' && event !== 'peers', designFrom);

      // Still no interval after the writes.
      assert.deepEqual(intervals(), [], `live intervals after writes:\n${describeTimers(intervals())}`);
    } finally {
      await host.close();
    }
  });

  it('(the same scene polls without it, so the check above sees the timers it means)', async () => {
    live.clear();
    const host = await startHost();
    try {
      await scene(host);
      assert.ok(intervals().length > 0, 'the default mode is expected to poll');
    } finally {
      await host.close();
    }
  });

  it('takes word from the host that the agent changed, starting no timer', async () => {
    const host = await startHost({ watch: 'events' });
    try {
      await host.internal('POST', '/__open-artifact/open', openBody('art_a', 'whiteboard', host.root('art_a')));
      const page = await host.connect('art_a', 'v1.owner-art_a', 'p1');
      const first = await page.socket.next((event) => event === 'agent', 0);
      assert.equal((first.data as { available: boolean }).available, false);
      // Without a daemon the agent stays unavailable: the calls are harmless.
      host.server.agentChanged('art_a');
      host.server.agentChanged();
      await sleep(100);
      assert.deepEqual(intervals(), []);
    } finally {
      await host.close();
    }
  });
});

describe('closing an idle artifact (hosting.idleCloseMs)', () => {
  it('closes once no page and no request is left, without losing a write, and opens again on demand', async () => {
    live.clear();
    const host = await startHost({ idleCloseMs: 300 });
    try {
      await host.internal('POST', '/__open-artifact/open', openBody('art_a', 'whiteboard', host.root('art_a')));
      const page = await host.connect('art_a', 'v1.owner-art_a', 'w1');
      // With a page open it stays, past the idle time.
      await sleep(500);
      assert.deepEqual(host.idleClosed, []);
      // A burst of writes, the page leaving in the middle of it.
      const writes = Array.from({ length: 20 }, (_, i) =>
        host.at('art_a', 'POST', '/whiteboard/v1.owner-art_a/_api/db/write', { client: 'w1', writes: [{ op: 'set', path: `elements/n${i}`, data: { type: 'note', x: i, y: 0, text: `n${i}` } }] }),
      );
      page.socket.hangUp();
      const answers = await Promise.all(writes);
      assert.deepEqual(answers.map((a) => a.status), Array(20).fill(200));
      assert.ok(await until(() => host.idleClosed.length === 1, 3000), 'it never closed');
      assert.deepEqual(host.idleClosed, [{ id: 'art_a', stillOpen: 0 }]);
      assert.equal((JSON.parse((await host.internal('GET', '/__open-artifact/health')).body) as { open: number }).open, 0);
      for (let i = 0; i < 20; i++) {
        assert.equal((JSON.parse(await readFile(join(host.root('art_a'), 'db', 'elements', `n${i}.json`), 'utf8')) as { text: string }).text, `n${i}`);
      }
      // Closed, it keeps nothing running for it.
      assert.deepEqual(intervals(), [], describeTimers(intervals()));

      // The next request opens it again, with every write.
      const read = await host.at('art_a', 'GET', '/whiteboard/v1.owner-art_a/_api/db/list?collection=elements');
      assert.equal(read.status, 200);
      assert.equal((JSON.parse(read.body) as { documents: unknown[] }).documents.length, 20);
      // ... and closes again once idle.
      assert.ok(await until(() => host.idleClosed.length === 2, 3000));
    } finally {
      await host.close();
    }
  });

  it('is off unless the host asks for it', async () => {
    const host = await startHost();
    try {
      await host.internal('POST', '/__open-artifact/open', openBody('art_a', 'whiteboard', host.root('art_a')));
      await sleep(400);
      assert.deepEqual(host.idleClosed, []);
      assert.equal((JSON.parse((await host.internal('GET', '/__open-artifact/health')).body) as { open: number }).open, 1);
    } finally {
      await host.close();
    }
  });
});

describe('a host without PDF import (hosting.pdfImport: false)', () => {
  it('refuses a PDF in words a person can act on, and still imports other files', async () => {
    const host = await startHost({ pdfImport: false });
    try {
      const opened = await host.internal('POST', '/__open-artifact/open', openBody('art_c', 'docs', host.root('art_c')));
      assert.equal(opened.status, 200, opened.body);
      const pdf = new TextEncoder().encode('%PDF-1.4\n%âã\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n');
      for (const name of ['Report.pdf', 'no-extension']) {
        const refused = await host.at('art_c', 'POST', `/docs/v1.owner-art_c/_api/doc/import?name=${name}`, pdf, { 'content-type': 'application/octet-stream' });
        assert.equal(refused.status, 400, `${name}: ${refused.body}`);
        const error = JSON.parse(refused.body) as { code: string; message: string };
        assert.equal(error.code, 'unsupported');
        assert.match(error.message, /PDF is not available on this host.*on your own computer/);
      }
      const markdown = await host.at('art_c', 'POST', '/docs/v1.owner-art_c/_api/doc/import?name=Notes.md', new TextEncoder().encode('# Notes\n\nHello.\n'), { 'content-type': 'application/octet-stream' });
      assert.notEqual(markdown.status, 400, markdown.body);
    } finally {
      await host.close();
    }
  });
});
