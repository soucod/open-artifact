/**
 * The Artifacts page's routes against a fake daemon: the Library API calls they make with the token, a restarted
 * daemon found again, and the page's shapes they answer with.
 */
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { DshRoute } from '../src/server/dsh.ts';
import { pageView, registerRoutes, thumbnailStamp, typeTiles } from '../src/server/routes.ts';
import { PATHS, ROUTE_BASE } from '../src/shared/routes.ts';

const TOKEN = 'secret';

interface Seen {
  method: string;
  path: string;
  query: Record<string, string>;
  auth: string | undefined;
  type: string | undefined;
  body: Buffer;
}

const artifact = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  root: `/work/${id}`,
  type: 'design',
  typeTitle: 'Design',
  title: `Artifact ${id}`,
  createdAt: '2026-11-01T10:00:00.000Z',
  updatedAt: '2026-11-02T10:00:00.000Z',
  openedAt: '2026-11-03T10:00:00.000Z',
  view_url: `http://127.0.0.1:4100/a/${id}/`,
  ...over,
});

let server: Server;
let base = '';
let seen: Seen[] = [];
/** What the fake daemon answers a path with; the default is a 404 `not_found`. */
let answers: Record<string, (seen: Seen) => { status?: number; json?: unknown; body?: string | Buffer; type?: string }> = {};

const read = (request: IncomingMessage) =>
  new Promise<Buffer>((resolve) => {
    const chunks: Buffer[] = [];
    request.on('data', (c: Buffer) => chunks.push(c));
    request.on('end', () => resolve(Buffer.concat(chunks)));
  });

before(async () => {
  server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://x');
    const entry: Seen = {
      method: request.method ?? 'GET',
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      auth: request.headers.authorization,
      type: request.headers['content-type'],
      body: await read(request),
    };
    seen.push(entry);
    if (entry.auth !== `Bearer ${TOKEN}`) {
      response.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ code: 'unauthorized', message: 'Bad token.' }));
      return;
    }
    const answer = answers[url.pathname]?.(entry) ?? { status: 404, json: { code: 'not_found', message: 'No such thing.' } };
    if (answer.type === 'text/event-stream') {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(answer.body ?? '');
      setTimeout(() => response.end(), 20);
      return;
    }
    const body = answer.json !== undefined ? JSON.stringify(answer.json) : (answer.body ?? '');
    response.writeHead(answer.status ?? 200, { 'content-type': answer.type ?? 'application/json' }).end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  seen = [];
  answers = {};
});

/** The routes, registered against a daemon handing out these states in turn (the last one repeats). */
function routesWith(...tokens: string[]) {
  const routes = new Map<string, DshRoute>();
  let found = 0;
  registerRoutes(
    { register: (route) => routes.set(route.path, route) },
    { daemon: async () => ({ url: base, token: tokens[Math.min(found++, tokens.length - 1)]! }) },
  );
  const call = (path: string, init: RequestInit & { query?: Record<string, string> } = {}) => {
    const route = routes.get(path);
    assert.ok(route, `no route ${path}`);
    const url = new URL(`http://app.local${path}`);
    for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
    return route.fetch(new Request(url, init));
  };
  return { routes, call, found: () => found };
}

describe('routes', () => {
  it('registers every page path under the base, buffered', () => {
    const { routes } = routesWith(TOKEN);
    // The host.open, shell-command, updates and changelog routes come with what they need only.
    const host: string[] = [PATHS.hostOpens, PATHS.hostOpened, PATHS.shellCommand, PATHS.updates, PATHS.changelog];
    assert.deepEqual([...routes.keys()].sort(), Object.values(PATHS).filter((p) => !host.includes(p)).sort());
    for (const route of routes.values()) {
      assert.ok(route.path.startsWith(ROUTE_BASE));
      assert.equal(route.requestBody, 'buffered');
    }
  });

  it('lists the library in the page shape, with the types a new session can make', async () => {
    answers['/api/open-artifact.artifacts'] = () => ({
      json: {
        artifacts: [
          artifact('a1', { owner: { harness: 'dsh', session: 's1', live: true, status: 'running' }, pinned: true, thumbnail: '/api/open-artifact.artifacts.thumbnail?id=a1&v=7' }),
          artifact('a2', { owner: { harness: 'other', session: 'x', live: false }, typeMissing: true }),
        ],
      },
    });
    answers['/api/open-artifact.types'] = () => ({
      json: {
        types: [
          { id: 'design', title: 'Design', description: 'Canvas' },
          { id: 'off', title: 'Off', enabled: false },
          { id: 'broken', title: 'Broken', problems: ['bad'] },
          { id: 'hidden', title: 'Hidden', shadowedBy: 'design' },
        ],
      },
    });
    const { call } = routesWith(TOKEN);
    const response = await call(PATHS.list);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = (await response.json()) as { artifacts: ReturnType<typeof pageView>[]; types: unknown[] };
    assert.deepEqual(body.types, [{ id: 'design', title: 'Design', description: 'Canvas' }]);
    const [a1, a2] = body.artifacts;
    assert.equal(a1!.sessionId, 's1');
    assert.equal(a1!.ownerStatus, 'running');
    assert.equal(a1!.pinned, true);
    assert.equal(a1!.thumbnail, '7');
    assert.equal(a1!.viewUrl, 'http://127.0.0.1:4100/a/a1/');
    assert.equal(a2!.sessionId, '', "another harness's session is not one the page can open");
    assert.equal(a2!.ownerStatus, 'offline');
    assert.equal(a2!.openable, false);
    assert.ok(seen.every((s) => s.auth === `Bearer ${TOKEN}`));
  });

  it('finds a restarted daemon again when the old token is refused', async () => {
    answers['/api/open-artifact.artifacts'] = () => ({ json: { artifacts: [] } });
    answers['/api/open-artifact.types'] = () => ({ json: { types: [] } });
    const { call, found } = routesWith('stale', TOKEN);
    const response = await call(PATHS.list);
    assert.equal(response.status, 200);
    assert.equal(found(), 2);
    // Found again, the daemon is kept: the next call goes straight through.
    seen = [];
    await call(PATHS.list);
    assert.equal(found(), 2);
    assert.ok(seen.every((s) => s.auth === `Bearer ${TOKEN}`));
  });

  it("answers a daemon error with its words and the code's status", async () => {
    const { call } = routesWith(TOKEN);
    const response = await call(PATHS.update, { method: 'POST', query: { id: 'zz' }, body: JSON.stringify({ title: 'New' }) });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'No such thing.' });
  });

  it('opens without the daemon showing it itself, and answers with the session to show it in', async () => {
    answers['/api/open-artifact.artifacts.open'] = () => ({ json: { view_url: 'http://127.0.0.1:4100/a/a1/?t=1' } });
    answers['/api/open-artifact.artifact'] = () => ({ json: artifact('a1', { owner: { harness: 'dsh', session: 's1' } }) });
    const { call } = routesWith(TOKEN);
    const response = await call(PATHS.open, { method: 'POST', query: { id: 'a1' } });
    assert.deepEqual(await response.json(), { url: 'http://127.0.0.1:4100/a/a1/?t=1', sessionId: 's1', title: 'Artifact a1' });
    const open = seen.find((s) => s.path === '/api/open-artifact.artifacts.open')!;
    assert.deepEqual(JSON.parse(open.body.toString()), { id: 'a1', host: false });
    assert.deepEqual(seen.find((s) => s.path === '/api/open-artifact.artifact')!.query, { id: 'a1' });
  });

  it('passes only the fields a page may change', async () => {
    answers['/api/open-artifact.artifacts.update'] = (s) => ({ json: artifact('a1', JSON.parse(s.body.toString())) });
    const { call } = routesWith(TOKEN);
    const response = await call(PATHS.update, { method: 'POST', query: { id: 'a1' }, body: JSON.stringify({ pinned: true, title: 7, root: '/etc' }) });
    assert.equal(((await response.json()) as { pinned: boolean }).pinned, true);
    assert.deepEqual(JSON.parse(seen[0]!.body.toString()), { id: 'a1', pinned: true });
  });

  it('deletes and restores by the trash entry', async () => {
    answers['/api/open-artifact.artifacts.delete'] = () => ({ json: { deleted: 'trash-1', folderKept: '' } });
    answers['/api/open-artifact.artifacts.restore'] = (s) => ({ json: artifact('a1', { restoredFrom: JSON.parse(s.body.toString()).id }) });
    const { call } = routesWith(TOKEN);
    const deleted = await call(PATHS.delete, { method: 'POST', query: { id: 'a1' } });
    assert.deepEqual(await deleted.json(), { trash: 'trash-1', path: '' });
    const restored = await call(PATHS.restore, { method: 'POST', query: { trash: 'trash-1' } });
    assert.equal(((await restored.json()) as { id: string }).id, 'a1');
    assert.deepEqual(JSON.parse(seen[1]!.body.toString()), { id: 'trash-1' });
  });

  it('saves a thumbnail as JPEG bytes and answers with its version', async () => {
    answers['/api/open-artifact.artifacts.thumbnail'] = (s) =>
      s.method === 'POST' ? { json: { thumbnail: `/api/open-artifact.artifacts.thumbnail?id=${s.query.id}&v=${s.query.v}` } } : { status: 404, json: {} };
    const { call } = routesWith(TOKEN);
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const response = await call(PATHS.thumbnail, { method: 'POST', query: { id: 'a1', v: '42' }, body: bytes });
    assert.deepEqual(await response.json(), { thumbnail: '42' });
    assert.equal(seen[0]!.type, 'image/jpeg');
    assert.deepEqual([...seen[0]!.body], [...bytes]);
    assert.deepEqual(seen[0]!.query, { id: 'a1', v: '42' });
    // None taken yet.
    const missing = await call(PATHS.thumbnail, { query: { id: 'a1', v: '42' } });
    assert.equal(missing.status, 404);
  });

  it('serves a thumbnail with its type', async () => {
    answers['/api/open-artifact.artifacts.thumbnail'] = () => ({ body: Buffer.from([1, 2, 3]), type: 'image/jpeg' });
    const { call } = routesWith(TOKEN);
    const response = await call(PATHS.thumbnail, { query: { id: 'a1', v: '1' } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3]);
  });

  it("streams the daemon's library events", async () => {
    const event = `data: ${JSON.stringify({ type: 'artifacts/changed' })}\n\n`;
    answers['/api/open-artifact.events'] = () => ({ type: 'text/event-stream', body: event });
    const { call } = routesWith(TOKEN);
    const response = await call(PATHS.events);
    assert.equal(response.headers.get('content-type'), 'text/event-stream');
    assert.equal(await response.text(), event);
  });
});

describe('shapes', () => {
  it('reads a thumbnail version from a stamp or a URL', () => {
    assert.equal(thumbnailStamp(null), null);
    assert.equal(thumbnailStamp('abc'), 'abc');
    assert.equal(thumbnailStamp('/api/open-artifact.artifacts.thumbnail?id=a&v=9'), '9');
    assert.equal(thumbnailStamp('http://127.0.0.1:1/x?v=3'), '3');
  });

  it('fills what the daemon leaves out', () => {
    const view = pageView({ id: 'a', createdAt: '2026-01-01T00:00:00.000Z' });
    assert.equal(view.openedAt, '2026-01-01T00:00:00.000Z');
    assert.equal(view.updatedAt, '2026-01-01T00:00:00.000Z');
    assert.equal(view.ownerStatus, null);
    assert.equal(view.openable, true);
    assert.deepEqual(typeTiles([{ id: 'design' }, { title: 'no id' }]), [{ id: 'design', title: 'design', description: '' }]);
  });
});
