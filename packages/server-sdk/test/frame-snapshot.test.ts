/**
 * frame-host's `snapshot` (frame/snapshot-action.ts): local only (the core's `frameActions`, which a hosted site
 * serves, has none), the same arguments and errors as the built-in types', a one-time credential that is a read-only
 * viewer nobody else sees, and `_agent/snapshots/` inert. With Chrome on this computer, real pictures: the colour
 * scheme, an empty artifact and a page that throws, a page that writes on load, and an open view that sees nothing.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { archiveIncludes, installedTypeCsp, linkSynced } from '@open-artifact/protocol';
import { FrameSite, frameActions, mountFrameSite } from '../src/frame/index.ts';
import { localFrameActions, SNAPSHOTS_KEPT } from '../src/frame/snapshot-action.ts';
import { TypeApi, TypeServer } from '../src/index.ts';
import { findChrome } from '../src/snapshot.ts';
import { zipEntries } from '../src/zip.ts';
import { readPng } from './png.ts';

const SECRET = 'test-secret-0123456789';
const MAIN = 'art_snapmain01';
const OTHER = 'art_snapother1';
const COLOR = 'art_snapcolor1';
const EMPTY = 'art_snapempty1';
const THROWS = 'art_snapthrow1';
const WRITES = 'art_snapwrite1';
const RESTRICTED = 'art_snaprestr1';
const HOLDS = 'art_snapholds1';
const STUCK = 'art_snapstuck1';
const CHROME = findChrome();
const WITH_CHROME = { skip: CHROME ? false : 'no Chrome, Chromium or Edge on this computer' };

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
  json: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

function http(port: number, opts: { method?: string; path: string; host?: string; headers?: Record<string, string | number>; body?: unknown }): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const data = opts.body === undefined ? undefined : Buffer.from(JSON.stringify(opts.body));
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method: opts.method ?? 'GET',
        path: opts.path,
        headers: { Host: opts.host ?? `127.0.0.1:${port}`, ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}), ...opts.headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: unknown;
          try {
            json = JSON.parse(text);
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json });
        });
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

/** An SSE stream on the inner shell's origin: its events as they come, until `close()`. */
function stream(port: number, path: string): Promise<{ status: number; events: any[]; close(): void }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  return new Promise((resolve, reject) => {
    const events: unknown[] = [];
    const req = request({ host: '127.0.0.1', port, path, headers: { Host: `127.0.0.1:${port}`, Origin: `http://127.0.0.1:${port}`, Accept: 'text/event-stream' } }, (res) => {
      let buf = '';
      res.on('data', (c: Buffer) => {
        buf += c.toString('utf8');
        let at: number;
        while ((at = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, at);
          buf = buf.slice(at + 2);
          for (const line of block.split('\n')) if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6)));
        }
      });
      res.on('error', () => undefined);
      const close = (): void => void req.destroy();
      if (res.statusCode !== 200) {
        res.resume();
        resolve({ status: res.statusCode ?? 0, events, close });
        return;
      }
      const started = Date.now();
      const wait = (): void => {
        if (events.length || Date.now() - started > 3000) resolve({ status: 200, events, close });
        else setTimeout(wait, 10);
      };
      wait();
    });
    req.on('error', (error) => (req.destroyed ? undefined : reject(error)));
    req.end();
  });
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** What an open view heard that a snapshot would have caused: a peer that is not an ordinary view, or a reload. */
const heard = (events: any[]): unknown[] => // eslint-disable-line @typescript-eslint/no-explicit-any
  events.slice(1).filter((e) => e.t !== 'peers' || e.peers.some((p: { peer: string }) => !p.peer.startsWith('ownerclient')));

const marker = (root: string, capabilities: Record<string, unknown>): void =>
  writeFileSync(join(root, '.artifact.json'), JSON.stringify({ id: 'x', type: 'page', capabilities }));

/** Every file under `dir` with its bytes and mtime, `_agent/` left out: what "the artifact did not change" compares. */
function tree(dir: string, base = dir, out: Record<string, string> = {}): Record<string, string> {
  for (const name of readdirSync(dir)) {
    const file = join(dir, name);
    const rel = file.slice(base.length + 1);
    if (rel === '_agent' || rel.startsWith('.artifact-server.')) continue; // the server's own run file and log
    const st = statSync(file);
    if (st.isDirectory()) tree(file, base, out);
    else out[rel] = `${st.mtimeMs}:${readFileSync(file).toString('base64')}`;
  }
  return out;
}

const COLOR_PAGE =
  '<!doctype html><html><head><meta charset="utf-8"><title>Colours</title><style>html,body{margin:0;height:100%;background:rgb(10,200,30)}' +
  '@media (prefers-color-scheme: dark){html,body{background:rgb(20,30,140)}}</style></head><body></body></html>';
// It asks the inner shell to hold its reveal, and never lets go.
const HOLDING_PAGE =
  '<!doctype html><html><head><title>Holds</title><script>parent.postMessage({ __frame_reveal_hold: true }, "*")</script>' +
  '<style>html,body{margin:0;height:100%;background:rgb(10,200,30)}</style></head><body></body></html>';
// Its load does not come for 25 s (a script that keeps the page busy), so it never says it is ready in time.
const STUCK_PAGE = '<!doctype html><html><head><title>Stuck</title><script>const t = Date.now(); while (Date.now() - t < 25000) {}</script></head><body>late</body></html>';
const THROWING_PAGE = '<!doctype html><html><head><title>Throws</title><script>throw new Error("boom on load")</script></head><body>never</body></html>';
// It writes on load, then paints what came back: green when the write was refused, red when it went through.
const WRITING_PAGE =
  '<!doctype html><html><head><meta charset="utf-8"><title>Writes</title><style>html,body{margin:0;height:100%;background:#888}</style></head><body><script>' +
  '(async () => { const db = await window.openArtifact.use("db"); let wrote = true;' +
  ' try { await db.collection("votes").doc("snap").set({ n: 1 }); } catch (e) { wrote = false; }' +
  ' document.body.style.background = wrote ? "rgb(220,10,10)" : "rgb(10,200,30)"; })();' +
  '</script></body></html>';

describe('frame-host snapshot', () => {
  let tmp: string;
  let typeDir: string;
  const roots = new Map<string, string>();
  let daemon: Server;
  let server: TypeServer;
  let port: number;
  const sites = new Map<string, FrameSite>();
  const pages = new Map<string, string>();
  const calls: { path: string; body: unknown }[] = [];

  before(async () => {
    tmp = mkdtempSync(join(tmpdir(), 'open-artifact-frame-snapshot-'));
    typeDir = join(tmp, 'page');
    mkdirSync(typeDir, { recursive: true });
    writeFileSync(join(typeDir, 'artifact-type.json'), JSON.stringify({ name: 'Page', openArtifact: { style: 'page' } }));
    writeFileSync(join(typeDir, 'SKILL.md'), '---\nname: page\ndescription: test\n---\n');
    const all = { db: true, assets: {}, room: {}, user: { scopes: ['profile'] }, comments: true };
    const make = (id: string, caps: Record<string, unknown>, html?: string): void => {
      const root = join(tmp, id);
      mkdirSync(root, { recursive: true });
      marker(root, caps);
      if (html !== undefined) writeFileSync(join(root, 'index.html'), html);
      roots.set(id, root);
    };
    make(MAIN, all, '<!doctype html><html><head><title>Main</title></head><body><p>main</p></body></html>');
    mkdirSync(join(tmp, MAIN, 'db', 'votes'), { recursive: true });
    writeFileSync(join(tmp, MAIN, 'db', 'votes', 'first.json'), JSON.stringify({ choice: 'noodles' }));
    make(OTHER, all, '<!doctype html><html><head><title>Other</title></head><body>other</body></html>');
    make(COLOR, {}, COLOR_PAGE);
    make(EMPTY, {});
    make(THROWS, {}, THROWING_PAGE);
    make(WRITES, { db: true }, WRITING_PAGE);
    make(RESTRICTED, {}, COLOR_PAGE);
    make(HOLDS, {}, HOLDING_PAGE);
    make(STUCK, {}, STUCK_PAGE);

    // The daemon records every call: a snapshot makes none that tell anyone (no touch, wake, view or read mark).
    daemon = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
        const url = new URL(req.url ?? '/', 'http://x');
        calls.push({ path: url.pathname, body });
        res.setHeader('Content-Type', 'application/json');
        if (url.pathname === '/api/open-artifact.type.artifact') return res.end(JSON.stringify({ id: url.searchParams.get('id'), agentName: 'Agent' }));
        if (url.pathname === '/api/open-artifact.type.presence') return res.end(JSON.stringify({ presence: 'online', canSend: true, canSendSession: true, busy: false, agentName: 'Agent' }));
        res.end('{}');
      });
    });
    await new Promise<void>((r) => daemon.listen(0, '127.0.0.1', r));

    server = new TypeServer({
      mountSite: async (r, ctx) => {
        // One artifact's type is restricted (installed, or a project not trusted yet): its CSP and sandbox stay its own.
        const site = await mountFrameSite(r, { ...ctx, typeDir, page: true, ...(r.endsWith(RESTRICTED) ? { restricted: true, contentSecurityPolicy: installedTypeCsp([]), allowedNetworkOrigins: [] } : {}) });
        sites.set(r, site);
        return site;
      },
      actions: localFrameActions,
      type: 'page',
      port: 0,
      secret: SECRET,
      idleMs: 0,
      contentHosts: true,
      archive: true,
      daemon: new TypeApi({ url: `http://127.0.0.1:${(daemon.address() as AddressInfo).port}`, token: 'type-token' }),
      log: () => undefined,
    });
    await server.listen();
    port = server.port;
    for (const [id, root] of roots) {
      const r = await http(port, { method: 'POST', path: '/__open-artifact/open', headers: { Authorization: `Bearer ${SECRET}` }, body: { id, root, title: 'Untitled page' } });
      assert.equal(r.status, 200, r.text);
      pages.set(id, new URL(r.json.url).pathname);
    }
  });

  after(async () => {
    server.close();
    await new Promise((r) => daemon.close(r));
    rmSync(tmp, { recursive: true, force: true });
  });

  const site = (id: string): FrameSite => sites.get(roots.get(id)!)!;
  const action = (name: string, id: string, args: Record<string, unknown> = {}): Promise<Reply> =>
    http(port, { method: 'POST', path: `/__open-artifact/actions/${name}`, headers: { Authorization: `Bearer ${SECRET}` }, body: { id, args } });
  /** The inner shell's API under a path prefix (a snapshot visit's `/snapshot/<credential>/`, or the page's own). */
  const api = (prefix: string, name: string, body?: unknown): Promise<Reply> =>
    http(port, { method: body === undefined ? 'GET' : 'POST', path: `${prefix}api/frame/${name}`, headers: { Origin: `http://127.0.0.1:${port}` }, body });
  const visitPrefix = (url: string): string => new URL(url).pathname;

  // ---- local only, and the contract -------------------------------------------------------------------------------

  it('the core’s frameActions (what a hosted site serves) has no snapshot; frame-host’s has it, a read', async () => {
    assert.equal(Object.hasOwn(frameActions, 'snapshot'), false);
    assert.equal(localFrameActions.snapshot!.effect, 'read');
    for (const name of Object.keys(frameActions)) assert.equal(localFrameActions[name], frameActions[name], name);
    const listed = await http(port, { path: '/__open-artifact/actions', headers: { Authorization: `Bearer ${SECRET}` } });
    const snap = listed.json.actions.find((a: { name: string }) => a.name === 'snapshot');
    assert.ok(snap, JSON.stringify(listed.json));
    assert.equal(snap.effect, 'read');
    assert.deepEqual(Object.keys(snap.schema.properties).sort(), ['height', 'scheme', 'width']);
    assert.deepEqual(snap.schema.properties.scheme.enum, ['light', 'dark']);
  });

  it('refuses a size out of range or not an integer, and a scheme that is not light or dark, before Chrome', async () => {
    for (const args of [{ width: 319 }, { width: 3841 }, { height: 239 }, { height: 2161 }, { width: 400.5 }, { width: '400' }]) {
      const r = await action('snapshot', COLOR, args);
      assert.equal(r.status, 400, JSON.stringify(args));
      assert.equal(r.json.code, 'invalid_argument');
      assert.equal(r.json.message, 'snapshot: width is 320 to 3840 pixels, height 240 to 2160.');
    }
    for (const scheme of ['system', 'DARK', 1]) {
      const r = await action('snapshot', COLOR, { scheme });
      assert.equal(r.status, 400, String(scheme));
      assert.equal(r.json.code, 'invalid_argument');
    }
    assert.equal(site(COLOR).snapshotVisits, 0);
  });

  it('with no Chrome, says unsupported and how to fix it; no visit is started', async () => {
    const before = process.env.OPEN_ARTIFACT_CHROME;
    // A browser named that is not there is no browser (findChrome looks nowhere else then).
    process.env.OPEN_ARTIFACT_CHROME = join(tmp, 'no-such-browser');
    try {
      assert.equal(findChrome(), null);
      const r = await action('snapshot', COLOR, {});
      assert.equal(r.status, 400, r.text);
      assert.equal(r.json.code, 'unsupported');
      assert.equal(r.json.fix, "Install Google Chrome, or set OPEN_ARTIFACT_CHROME to a Chromium-based browser's path. Until then, ask the person to look at the page.");
      assert.equal(site(COLOR).snapshotVisits, 0);
    } finally {
      if (before === undefined) delete process.env.OPEN_ARTIFACT_CHROME;
      else process.env.OPEN_ARTIFACT_CHROME = before;
    }
  });

  // ---- the credential -------------------------------------------------------------------------------------------

  it('the credential is a read-only viewer of this artifact only, gone when the visit ends', async () => {
    const visit = site(MAIN).beginSnapshot();
    const prefix = visitPrefix(visit.url);
    assert.match(prefix, /^\/snapshot\/[A-Za-z0-9_-]{32}\/$/);
    try {
      const s = await api(prefix, 'session');
      assert.equal(s.status, 200, s.text);
      assert.equal(s.json.snapshot, true);
      assert.equal(s.json.id, MAIN);
      assert.deepEqual(s.json.comments, { available: false, count: 0 });
      assert.equal(s.json.agent.available, false);
      // The owner's level and name, so the page draws as the person sees it.
      const own = await api(pages.get(MAIN)!, 'session');
      assert.equal(own.json.snapshot, undefined, 'an ordinary view is not one');
      assert.deepEqual(s.json.grants, own.json.grants);
      assert.equal(s.json.me.name, own.json.me.name);
      // The inner shell's page itself answers under the credential.
      const shell = await http(port, { path: prefix });
      assert.equal(shell.status, 200);
      // Another artifact's address does not take this credential.
      const elsewhere = await api(`${pages.get(OTHER)}${prefix.slice(1)}`, 'session');
      assert.equal(elsewhere.status, 404);
      // A credential nobody was given is no visit.
      assert.equal((await api(`/snapshot/${'A'.repeat(32)}/`, 'session')).status, 404);
    } finally {
      visit.end();
    }
    assert.equal((await api(prefix, 'session')).status, 404, 'refused once the visit ended');
    assert.equal((await http(port, { path: prefix })).status, 404);
    assert.equal(site(MAIN).snapshotVisits, 0);
  });

  it('a restricted type keeps its sandbox and CSP under a snapshot', async () => {
    const own = await api(pages.get(RESTRICTED)!, 'session');
    assert.ok(own.json.sandbox, JSON.stringify(own.json));
    const index = (): Promise<Reply> =>
      http(port, { path: `/_f/${own.json.ver}/`, host: `${RESTRICTED}.frame.localhost:${port}`, headers: { 'Sec-Fetch-Dest': 'iframe', 'Sec-Fetch-Site': 'cross-site', Referer: `http://127.0.0.1:${port}/` } });
    const csp = (await index()).headers['content-security-policy'];
    assert.ok(csp, 'a restricted page has a CSP');
    const visit = site(RESTRICTED).beginSnapshot();
    try {
      const s = await api(visitPrefix(visit.url), 'session');
      assert.equal(s.json.snapshot, true);
      assert.equal(s.json.sandbox, own.json.sandbox);
      assert.equal(s.json.contentOrigin, own.json.contentOrigin);
      assert.equal((await index()).headers['content-security-policy'], csp);
    } finally {
      visit.end();
    }
  });

  it('every write is refused, nothing changes, and nobody is told; reads still answer', async () => {
    const root = roots.get(MAIN)!;
    const was = tree(root);
    calls.length = 0;
    const visit = site(MAIN).beginSnapshot();
    const prefix = visitPrefix(visit.url);
    try {
      const gen = (await api(prefix, 'session')).json.brokerGen;
      const cap = async (c: string, method: string, arg: unknown): Promise<any> => { // eslint-disable-line @typescript-eslint/no-explicit-any
        const r = await api(prefix, 'cap', { cap: c, method, args: [arg], client: 'snapclient01', brokerGen: gen });
        assert.equal(r.status, 200, r.text);
        return r.json;
      };
      const writes: [string, string, unknown, string][] = [
        ['db', 'set', { path: 'votes/snap', data: { n: 1 } }, 'invalid_argument'],
        ['db', 'update', { path: 'votes/first', data: { n: 1 } }, 'invalid_argument'],
        ['db', 'delete', { path: 'votes/first' }, 'invalid_argument'],
        ['db', 'add', { path: 'votes', data: { n: 1 } }, 'invalid_argument'],
        ['db', 'acquire', { path: 'votes/first' }, 'invalid_argument'],
        ['db', 'release', { path: 'votes/first' }, 'invalid_argument'],
        ['artifact', 'publish', { files: { 'notes.txt': { text: 'n' } } }, 'not_writer'],
        ['artifact', 'publish', { html: '<p>replaced</p>' }, 'not_writer'],
        ['artifact', 'edit', {}, 'not_writer'],
        ['assets', 'delete', { id: 'x' }, 'not_writer'],
        ['comments', 'create', { body: 'hi', anchor: {} }, 'forbidden'],
        ['comments', 'reply', { id: 'x', body: 'hi' }, 'forbidden'],
        ['comments', 'resolve', { id: 'x' }, 'forbidden'],
        ['comments', 'move', { id: 'x' }, 'forbidden'],
        ['comments', 'delete', { id: 'x' }, 'forbidden'],
        ['comments', 'sendToAgent', { id: 'x' }, 'forbidden'],
        ['room', 'emit', { topic: 't', data: 1 }, 'not_permitted'],
        ['room', 'presence', { state: { x: 1 } }, 'not_permitted'],
        ['room', 'sendToAgentSession', { text: 'hi' }, 'not_permitted'],
        ['permissions', 'manage', {}, 'not_permitted'],
      ];
      for (const [c, method, arg, code] of writes) {
        const r = await cap(c, method, arg);
        assert.equal(r.error?.code, code, `${c}.${method}: ${JSON.stringify(r)}`);
      }
      // The inner shell's own writes: an upload, a title, the agent.
      const upload = await http(port, { method: 'POST', path: `${prefix}api/frame/upload`, headers: { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'image/png' }, body: 'x' });
      assert.equal(upload.json?.error?.code, 'not_granted', upload.text);
      assert.deepEqual((await api(prefix, 'title', { title: 'Renamed' })).json, { applied: false });
      assert.equal((await api(prefix, 'agent', { text: 'hello' })).status, 403);
      assert.deepEqual((await api(prefix, 'activity', {})).json, { working: false, available: false });
      // Reads answer as usual.
      const read = await cap('db', 'get', { path: 'votes/first' });
      assert.ok(!read.error, JSON.stringify(read));
      assert.deepEqual(JSON.stringify(read.result).includes('noodles'), true);
      assert.ok(!(await cap('artifact', 'metadata', {})).error);
      assert.ok(!(await cap('room', 'peers', {})).error);
    } finally {
      visit.end();
    }
    assert.deepEqual(tree(root), was, 'the artifact folder is as it was');
    assert.ok(!existsSync(join(root, '_blobs')) || readdirSync(join(root, '_blobs')).length === 0, 'no asset stored');
    const told = calls.filter((c) => !['/api/open-artifact.type.artifact', '/api/open-artifact.type.presence'].includes(c.path));
    assert.deepEqual(told, [], 'the daemon was told nothing');
  });

  it('its event stream says hello with no peers, and an open view never sees it', async () => {
    const own = await stream(port, `${pages.get(MAIN)}api/frame/events?c=ownerclient01`);
    assert.equal(own.status, 200);
    assert.equal(own.events[0].t, 'hello');
    const visit = site(MAIN).beginSnapshot();
    try {
      const quiet = await stream(port, `${visitPrefix(visit.url)}api/frame/events?c=snapclient01`);
      assert.equal(quiet.status, 200);
      assert.deepEqual(quiet.events, [{ t: 'hello', ver: site(MAIN).ver, brokerGen: site(MAIN).brokerGen, peers: [], count: 0 }]);
      await sleep(300);
      quiet.close();
    } finally {
      visit.end();
    }
    await sleep(200);
    assert.deepEqual(heard(own.events), [], 'no snapshot peer, files or rewired event for the open view');
    own.close();
  });

  // ---- _agent/ is inert --------------------------------------------------------------------------------------------

  it('_agent/snapshots/ is inert: no new version, no event, not served, listed, archived or synced', async () => {
    const root = roots.get(MAIN)!;
    const s = site(MAIN);
    const ver = s.ver;
    const gen = s.brokerGen;
    const own = await stream(port, `${pages.get(MAIN)}api/frame/events?c=ownerclient02`);
    mkdirSync(join(root, '_agent', 'snapshots'), { recursive: true });
    const name = 'snapshot-2026-01-01T00-00-00-000Z.png';
    writeFileSync(join(root, '_agent', 'snapshots', name), 'png');
    s.noteChanges([`_agent/snapshots/${name}`, '_agent/snapshots', '_agent']);
    assert.equal(s.filesChanged(), false, 'the manifest is the same');
    assert.equal(s.ver, ver);
    assert.equal(s.brokerGen, gen);
    await sleep(200);
    assert.deepEqual(heard(own.events), [], 'no reload');
    own.close();
    // Not served on the page's origin, nor on the inner shell's.
    const host = `${MAIN}.frame.localhost:${port}`;
    for (const path of [`/_f/${ver}/_agent/snapshots/${name}`, `/_f/v/_agent/snapshots/${name}`]) {
      assert.equal((await http(port, { path, host })).status, 404, path);
    }
    assert.equal((await http(port, { path: `${pages.get(MAIN)}_agent/snapshots/${name}` })).status, 404);
    // Not among `info`'s files.
    const info = await action('info', MAIN);
    assert.ok(!info.json.info.files.some((f: { path: string }) => f.path.startsWith('_agent')), JSON.stringify(info.json.info.files));
    // Not in the archive (export, duplicate from a site), and never Link-synced.
    const zip = await new Promise<Buffer>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path: `/__open-artifact/archive?id=${MAIN}`, headers: { Host: `127.0.0.1:${port}`, Authorization: `Bearer ${SECRET}` } }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      });
      req.on('error', reject);
      req.end();
    });
    const names = zipEntries(zip).entries.map((e) => e.name);
    assert.ok(names.some((n) => n.endsWith('index.html')), names.join(','));
    assert.ok(!names.some((n) => n.includes('_agent')), names.join(','));
    assert.equal(archiveIncludes(`_agent/snapshots/${name}`), false);
    assert.equal(linkSynced(`_agent/snapshots/${name}`), false);
  });

  // ---- with Chrome ---------------------------------------------------------------------------------------------

  it('draws the page in the light scheme by default and in the dark one when asked', WITH_CHROME, async () => {
    const light = await action('snapshot', COLOR, { width: 400, height: 300 });
    assert.equal(light.status, 200, light.text);
    assert.equal(light.json.scheme, 'light');
    assert.equal(light.json.width, 400);
    assert.match(light.json.image, /[/\\]_agent[/\\]snapshots[/\\]snapshot-[0-9TZ-]+\.png$/);
    assert.equal(light.json.bytes, statSync(light.json.image).size);
    let png = readPng(readFileSync(light.json.image));
    assert.deepEqual([png.width, png.height], [400, 300]);
    assert.deepEqual(png.pixel(200, 150).slice(0, 3), [10, 200, 30]);
    const dark = await action('snapshot', COLOR, { width: 400, height: 300, scheme: 'dark' });
    assert.equal(dark.status, 200, dark.text);
    assert.equal(dark.json.scheme, 'dark');
    png = readPng(readFileSync(dark.json.image));
    assert.deepEqual(png.pixel(200, 150).slice(0, 3), [20, 30, 140]);
    assert.equal(site(COLOR).snapshotVisits, 0, 'the visit ended');
  });

  it('an artifact with no index.html, a page that throws on load, and a restricted page each answer within a few seconds', WITH_CHROME, async () => {
    for (const id of [EMPTY, THROWS, RESTRICTED]) {
      const started = Date.now();
      const r = await action('snapshot', id, { width: 400, height: 300 });
      const took = Date.now() - started;
      assert.equal(r.status, 200, `${id}: ${r.text}`);
      assert.ok(took < 15_000, `${id} took ${took} ms`);
      assert.ok(existsSync(r.json.image));
    }
  });

  it('a page that holds its reveal forever, and one never ready (the problem card), answer well before 45 s', WITH_CHROME, async () => {
    const timed = async (id: string): Promise<number> => {
      const started = Date.now();
      const r = await action('snapshot', id, { width: 400, height: 300 });
      assert.equal(r.status, 200, `${id}: ${r.text}`);
      assert.ok(existsSync(r.json.image));
      return Date.now() - started;
    };
    const held = await timed(HOLDS);
    assert.ok(held >= 5_000 && held < 15_000, `the held page took ${held} ms (its reveal is held 5 s, then shown)`);
    const stuck = await timed(STUCK);
    assert.ok(stuck >= 8_000 && stuck < 20_000, `the page never ready took ${stuck} ms (the problem card comes at 8 s)`);
  });

  it('a page that writes on load is refused, and the store is unchanged; an open view sees nothing', WITH_CHROME, async () => {
    const root = roots.get(WRITES)!;
    const was = tree(root);
    calls.length = 0;
    const own = await stream(port, `${pages.get(WRITES)}api/frame/events?c=ownerclient03`);
    const r = await action('snapshot', WRITES, { width: 400, height: 300 });
    assert.equal(r.status, 200, r.text);
    const png = readPng(readFileSync(r.json.image));
    assert.deepEqual(png.pixel(200, 150).slice(0, 3), [10, 200, 30], 'the page saw its write refused');
    assert.deepEqual(tree(root), was, 'nothing written');
    assert.ok(!existsSync(join(root, 'db', 'votes', 'snap.json')));
    await sleep(200);
    assert.deepEqual(heard(own.events), [], 'no peer joined, no reload');
    own.close();
    const told = calls.filter((c) => !['/api/open-artifact.type.artifact', '/api/open-artifact.type.presence'].includes(c.path));
    assert.deepEqual(told, [], 'the daemon was told nothing');
  });

  it('afterwards no visit is under way and no snapshot stream is left open (the site is not kept mounted by it)', WITH_CHROME, async () => {
    const entries = (server as unknown as { byId: Map<string, { streams: number }> }).byId;
    const deadline = Date.now() + 5000;
    const open = (): string[] => [COLOR, EMPTY, THROWS, RESTRICTED, HOLDS, STUCK].filter((id) => entries.get(id)!.streams !== 0 || site(id).snapshotVisits !== 0);
    while (open().length && Date.now() < deadline) await sleep(50);
    assert.deepEqual(open(), []);
  });

  it(`keeps the last ${SNAPSHOTS_KEPT} snapshots`, async () => {
    const dir = join(roots.get(COLOR)!, '_agent', 'snapshots');
    mkdirSync(dir, { recursive: true });
    for (let i = 0; i < SNAPSHOTS_KEPT + 3; i++) writeFileSync(join(dir, `snapshot-2000-01-01T00-00-${String(i).padStart(2, '0')}-000Z.png`), 'x');
    if (!CHROME) return;
    const r = await action('snapshot', COLOR, { width: 320, height: 240 });
    assert.equal(r.status, 200, r.text);
    const left = readdirSync(dir).filter((n) => n.endsWith('.png'));
    assert.equal(left.length, SNAPSHOTS_KEPT);
    assert.ok(left.includes(r.json.image.split(/[/\\]/).pop()), 'the new one is kept');
  });
});
