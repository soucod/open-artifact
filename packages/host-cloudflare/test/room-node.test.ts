/**
 * The room in Node, on the SQLite file system: the unmodified type server and the host's files module run with
 * `node:fs` and `node:fs/promises` replaced by this package's (as the Workers bundle replaces them), through a
 * synchronous module hook (`module.registerHooks`, Node 22.15+). What is aliased: those two specifiers, imported from
 * anywhere but this package's own `src/fs/`, Node's own modules, `node_modules` and the Sheets engine's loader (which
 * reads its `.wasm` from disk; the bundle imports it instead). So the stores, the archive code, `files.ts` and the
 * type server read and write the object's SQLite (`node:sqlite` here), and the editors come from `dist/server` through
 * the assets mount, as from the platform's static assets.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join, relative } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { testStorage } from './sqlite.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = join(here, '../../..');
const fsDir = join(repo, 'packages/host-cloudflare/src/fs/');
const shim = pathToFileURL(join(fsDir, 'index.ts')).href;
const shimPromises = pathToFileURL(join(fsDir, 'promises.ts')).href;
const editors = join(repo, 'dist/server');

registerHooks({
  resolve(specifier, context, next) {
    const parent = context.parentURL ? fileURLToPath(context.parentURL) : '';
    const aliased = parent.startsWith(repo) && !parent.startsWith(fsDir) && !parent.includes('/node_modules/') && !parent.includes('/packages/wasm-sheets/') && !parent.includes('/host-cloudflare/test/');
    if (aliased && (specifier === 'node:fs' || specifier === 'fs')) return { url: shim, shortCircuit: true };
    if (aliased && (specifier === 'node:fs/promises' || specifier === 'fs/promises')) return { url: shimPromises, shortCircuit: true };
    return next(specifier, context);
  },
});

type RoomModule = typeof import('../src/room.ts');
let rooms: RoomModule;

/**
 * An artifact folder on disk as path → bytes (what the export would carry: no `.gitignore`, and no `_agent/`, the
 * machine-local state an editor opened on the fixture leaves behind).
 */
function folderFiles(dir: string): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  const walk = (at: string): void => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) {
        if (at !== dir || name !== '_agent') walk(path);
      }
      else if (name !== '.gitignore') out[relative(dir, path)] = readFileSync(path);
    }
  };
  walk(dir);
  return out;
}

/** The editors from `dist/server`, as the assets binding serves them. */
const assets = {
  async fetch(request: Request): Promise<Response> {
    const path = decodeURIComponent(new URL(request.url).pathname.replace(/^\/_open-artifact\//, ''));
    const file = join(editors, path);
    if (!file.startsWith(editors) || !existsSync(file) || statSync(file).isDirectory()) return new Response(null, { status: 404 });
    return new Response(readFileSync(file));
  },
};

/** A pair of fake sockets: what the room sends the page, and a way to send it one. */
function fakePair() {
  const sent: string[] = [];
  let closed = false;
  const listeners: Record<string, ((event: { data: string }) => void)[]> = {};
  const server = {
    accept() {},
    send(message: string | ArrayBuffer | ArrayBufferView) {
      sent.push(typeof message === 'string' ? message : Buffer.from(message as ArrayBuffer).toString('utf8'));
    },
    close() {
      closed = true;
    },
    addEventListener(type: string, listener: (event: { data: string }) => void) {
      (listeners[type] ??= []).push(listener);
    },
  };
  let made = 0;
  return {
    sent,
    get closed() {
      return closed;
    },
    /** Pairs made so far. */
    get made() {
      return made;
    },
    pair: () => {
      made++;
      return [{ client: true }, server] as [unknown, typeof server];
    },
    /** The page goes away. */
    hangUp: () => {
      for (const listener of listeners.close ?? []) listener({ data: '' });
    },
  };
}

const wakes: unknown[] = [];

const presenceChanges: string[] = [];
const idled: string[] = [];

function makeRoom(storage = testStorage(), name?: string, ws = fakePair(), extra: { idleCloseMs?: number; sseHeartbeatMs?: number } = {}) {
  const room = new rooms.ArtifactRoom({ storage, id: { toString: () => name ?? 'x', ...(name ? { name } : {}) } }, { ASSETS: assets }, {
    host: {
      async resolve(_id, token, _use, request) {
        const type = new URL(request.url).pathname.split('/')[1]!;
        if (token === 'nobody') return null;
        return { title: 'Room test', type, viewer: token === 'owner' ? { id: 'owner', name: 'Owner', role: 'owner', kind: 'user' } : { id: token, name: token, role: 'editor', kind: 'user' }, principal: { kind: 'user', id: token === 'owner' ? 'u-owner' : token } };
      },
      pageBase: (id) => `http://${id}.content.test/`,
      shellUrl: (id) => `http://app.test/a/${id}`,
      appOrigin: () => 'http://app.test',
      ownerName: async () => 'Owner Name',
      typeApi: {
        wake: async (_id, body) => {
          wakes.push(body);
          return { status: 'inbox', via: 'link' };
        },
        presence: async () => ({ presence: 'offline', canSend: true, canSendSession: false, busy: false, agentName: 'Agent' }),
        touch: async () => ({}),
      },
      presenceChanged: (id) => void presenceChanges.push(id),
      idle: (id) => void idled.push(id),
    },
    ...extra,
    pair: ws.pair,
    upgraded: () => new Response(null, { status: 204, headers: { 'x-upgraded': '1' } }),
    log: () => undefined,
  });
  return { room, storage, ws };
}

function page(id: string, path: string, init: RequestInit & { headers?: Record<string, string> } = {}): Request {
  return new Request(`http://${id}.content.test/${path}`, { ...init, headers: { 'x-open-artifact-artifact': id, ...(init.headers ?? {}) } });
}

/** Reads an event stream until `match` shows up in it (or the time is up). */
async function readUntil(body: ReadableStream<Uint8Array>, match: RegExp, ms = 5000): Promise<string> {
  const reader = body.getReader();
  let text = '';
  const deadline = Date.now() + ms;
  try {
    while (!match.test(text)) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`Not seen in ${ms} ms: ${match}. Got: ${text.slice(-400)}`);
      const next = await Promise.race([reader.read(), new Promise<null>((done) => setTimeout(() => done(null), left))]);
      if (!next || next.done) continue;
      text += Buffer.from(next.value).toString('utf8');
    }
    return text;
  } finally {
    reader.releaseLock();
  }
}

const SLIDES = join(repo, 'test-artifacts/slides/browser-smoke');
const haveEditors = existsSync(join(editors, 'editors/slides/index.html'));

describe('the room in Node, on the SQLite file system', () => {
  before(async () => {
    rooms = await import('../src/room.ts');
  });
  const live: { room: InstanceType<RoomModule['ArtifactRoom']> }[] = [];
  after(async () => {
    for (const { room } of live) await room.destroy().catch(() => undefined);
  });

  test('seeds, answers the page API, streams events and notices a page leave', async () => {
    const made = makeRoom(undefined, 'slides1');
    live.push(made);
    const { room, storage } = made;
    const files = folderFiles(SLIDES);
    const seeded = await room.seed('slides1', files);
    assert.equal(seeded.files, Object.keys(files).length);
    await assert.rejects(room.seed('slides1', { 'a.txt': 'x' }), /has a folder already/);
    await assert.rejects(room.ready('other'), /holds slides1/);

    const session = await room.fetch(page('slides1', 'slides/owner/_api/session'));
    assert.equal(session.status, 200);
    const body = (await session.json()) as { artifact: { id: string; type: string }; viewer: { role: string } };
    assert.equal(body.artifact.id, 'slides1');
    assert.equal(body.artifact.type, 'slides');
    assert.equal(body.viewer.role, 'owner');
    // The host refused the token.
    assert.equal((await room.fetch(page('slides1', 'slides/nobody/_api/session'))).status, 403);

    if (haveEditors) {
      const html = await room.fetch(page('slides1', 'slides/owner/', { headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-mode': 'navigate' } }));
      assert.equal(html.status, 200, await html.clone().text());
      assert.match(await html.text(), /<html/i);
    }

    // Two pages listen; a write reaches both; one leaves and is noticed.
    const first = await room.fetch(page('slides1', 'slides/owner/_api/events', { headers: { accept: 'text/event-stream' } }));
    const controller = new AbortController();
    const second = await room.fetch(page('slides1', 'slides/ed/_api/events', { headers: { accept: 'text/event-stream' }, signal: controller.signal }));
    assert.equal(first.status, 200);
    assert.match(first.headers.get('content-type') ?? '', /event-stream/);
    assert.deepEqual(new Set(room.connected().map((p) => p.id)), new Set(['u-owner', 'ed']));
    assert.equal((await room.stats()).connections, 2);

    const deck = JSON.parse(Buffer.from((await room.readFile('project/deck.json'))!.bytes).toString('utf8')) as Record<string, unknown>;
    const [written] = await room.writeFiles([{ path: 'project/deck.json', content: Buffer.from(JSON.stringify({ ...deck, title: 'Changed' })).toString('base64') }], 'test');
    assert.ok(written && 'etag' in written && written.etag);
    await readUntil(first.body!, /event: files/);
    await readUntil(second.body!, /event: files/);

    controller.abort();
    const deadline = Date.now() + 2000;
    while ((await room.stats()).connections !== 1 && Date.now() < deadline) await new Promise((done) => setTimeout(done, 20));
    assert.equal((await room.stats()).connections, 1);
    room.disconnect([]);
    const ended = Date.now() + 2000;
    while ((await room.stats()).connections !== 0 && Date.now() < ended) await new Promise((done) => setTimeout(done, 20));
    assert.equal((await room.stats()).connections, 0);
    await first.body!.cancel().catch(() => undefined);

    // Common reads never scan the chunk table.
    assert.deepEqual(storage.scans.filter((s) => /oa_fs_chunks/.test(s.plan)), []);
    const stats = await room.stats();
    assert.ok(stats.usage.files > 5);
    assert.ok(stats.storage.rowsRead > 0);
  });

  test('a WebSocket gets the events over the pair', async () => {
    const ws = fakePair();
    const made = makeRoom(undefined, 'slides2', ws);
    live.push(made);
    const { room } = made;
    await room.seed('slides2', folderFiles(SLIDES));
    const answer = await room.fetch(page('slides2', 'slides/owner/_api/events', { headers: { upgrade: 'websocket', connection: 'Upgrade', 'sec-websocket-version': '13' } }));
    assert.equal(answer.headers.get('x-upgraded'), '1');
    assert.equal((await room.stats()).connections, 1);
    await room.writeFiles([{ path: 'project/note.txt', content: Buffer.from('hello').toString('base64') }], 'test');
    const deadline = Date.now() + 3000;
    while (!ws.sent.some((m) => m.includes('"files"')) && Date.now() < deadline) await new Promise((done) => setTimeout(done, 20));
    assert.ok(ws.sent.some((m) => m.includes('"files"')), ws.sent.join('\n'));
    ws.hangUp();
    const gone = Date.now() + 2000;
    while ((await room.stats()).connections !== 0 && Date.now() < gone) await new Promise((done) => setTimeout(done, 20));
    assert.equal((await room.stats()).connections, 0);
  });

  test('a refused WebSocket answers its status and makes no pair', async () => {
    const ws = fakePair();
    const made = makeRoom(undefined, 'slides6', ws);
    live.push(made);
    await made.room.seed('slides6', folderFiles(SLIDES));
    const answer = await made.room.fetch(page('slides6', 'slides/nobody/_api/events', { headers: { upgrade: 'websocket', connection: 'Upgrade', 'sec-websocket-version': '13' } }));
    assert.equal(answer.status, 403);
    assert.equal(ws.made, 0);
    assert.equal((await made.room.stats()).connections, 0);
  });

  test('closes the artifact once idle and tells the host; the next request opens it with nothing lost', async () => {
    const made = makeRoom(undefined, 'slides7', fakePair(), { idleCloseMs: 150, sseHeartbeatMs: 0 });
    live.push(made);
    const { room } = made;
    await room.seed('slides7', folderFiles(SLIDES));
    const controller = new AbortController();
    const stream = await room.fetch(page('slides7', 'slides/owner/_api/events', { headers: { accept: 'text/event-stream' }, signal: controller.signal }));
    assert.equal(stream.status, 200);
    assert.equal((await room.stats()).open, 1);
    await new Promise((done) => setTimeout(done, 400));
    assert.equal((await room.stats()).open, 1, 'a page connected keeps it open');
    await room.writeFiles([{ path: 'project/kept.txt', content: Buffer.from('kept').toString('base64') }], 'test');
    controller.abort();
    const deadline = Date.now() + 3000;
    while ((await room.stats()).open !== 0 && Date.now() < deadline) await new Promise((done) => setTimeout(done, 20));
    const quiet = await room.stats();
    assert.equal(quiet.open, 0);
    assert.equal(quiet.connections, 0);
    assert.ok(idled.includes('slides7'), 'the host heard it went idle');
    // Reading the stats twice moves no counter (the usage scan is not counted).
    assert.deepEqual((await room.stats()).storage, quiet.storage);
    // Nothing to tell: the agent's change neither boots nor fails.
    room.agentChanged();
    assert.ok(presenceChanges.includes('slides7'));
    const session = await room.fetch(page('slides7', 'slides/owner/_api/session'));
    assert.equal(session.status, 200);
    assert.equal((await room.stats()).open, 1);
    assert.equal(Buffer.from((await room.readFile('project/kept.txt'))!.bytes).toString('utf8'), 'kept');
  });

  test('an action runs on the internal route; the archive round-trips into another object', async () => {
    const made = makeRoom(undefined, 'slides3');
    live.push(made);
    const { room } = made;
    await room.seed('slides3', folderFiles(SLIDES));
    const context = (await room.action('context')) as { note?: string };
    assert.equal(typeof context.note, 'string');
    await assert.rejects(room.action('no-such-action'), /no-such-action/);

    const zip = new Uint8Array(await new Response(await room.archive()).arrayBuffer());
    assert.equal(Buffer.from(zip.subarray(0, 2)).toString('latin1'), 'PK');
    const copy = makeRoom(undefined, 'slides4');
    live.push(copy);
    const imported = await copy.room.importArchive(zip, { id: 'slides4' });
    assert.equal(imported.type, 'slides');
    const a = await room.manifest();
    const b = await copy.room.manifest();
    // The import records the new id in `.artifact.json`; everything else is the same bytes.
    delete b['.artifact.json'];
    assert.deepEqual(Object.keys(b).sort(), Object.keys(a).sort());
    for (const [path, file] of Object.entries(a)) assert.equal(b[path]!.etag, file.etag, path);
  });

  test('create scaffolds a new artifact as the Node host does; its title is read back; destroy lets it be made again', async () => {
    for (const [type, title] of [['docs', 'Release notes'], ['whiteboard', 'Retro board']] as const) {
      const id = `new${type}`;
      const { room } = makeRoom(testStorage(), id);
      await room.create({ id, type, title });
      const files = await room.manifest();
      assert.ok(files['.artifact.json'], type);
      const meta = JSON.parse(new TextDecoder().decode((await room.readFile('.artifact.json'))!.bytes)) as Record<string, unknown>;
      assert.deepEqual(meta, { type, id, title, release: null });
      assert.equal(await room.contentTitle(type), title, `${type}: the title its own files hold`);
      await assert.rejects(room.create({ id, type, title }), (error: { status?: number }) => error.status === 409);
      await room.destroy();
      await room.create({ id, type, title: `${title} again` });
      assert.equal(await room.contentTitle(type), `${title} again`, 'the same instance serves the id again after destroy');
      await room.destroy();
    }
    const { room } = makeRoom(testStorage(), 'newbad');
    await assert.rejects(room.create({ id: 'newbad', type: 'nope', title: 'x' }), (error: { code?: string }) => error.code === 'invalid_argument');
  });

  test('a new instance of the same object takes over its folder; destroy drops the storage', async () => {
    const storage = testStorage();
    const one = makeRoom(storage, 'slides5');
    await one.room.seed('slides5', folderFiles(SLIDES));
    assert.equal((await one.room.fetch(page('slides5', 'slides/owner/_api/session'))).status, 200);
    // Evicted, then made again in the same isolate: the old type server and mount are ended first.
    const two = makeRoom(storage, 'slides5');
    const session = await two.room.fetch(page('slides5', 'slides/owner/_api/session'));
    assert.equal(session.status, 200);
    assert.deepEqual(Object.keys(await two.room.manifest()).sort(), Object.keys(folderFiles(SLIDES)).sort());
    await two.room.destroy();
    const tables = storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'oa_%'").toArray();
    assert.deepEqual(tables, []);
  });
});
