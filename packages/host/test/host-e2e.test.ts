/**
 * The Node host end to end (the P1 story), over real HTTP and WebSockets on one port: the owner signs in with the
 * owner key, uploads a real artifact archive, opens it, shares it with a second person and by link, and every
 * change of role reaches the open pages.
 *
 * The editors are fakes (as in `rooms.test.ts`); the Shell and home page are the built `dist/daemon` when it is
 * there, else stubs with the boot placeholders. Requests carry an explicit `Host` (no DNS for `*.localhost`).
 * The second person is made directly in the catalog with a session (`createUser` + `createSession`): the host has
 * no invitation flow to sign them in through, and the owner-key sign-in is for the owner only.
 */

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, request, type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import type { ArtifactView, ShareView, ShellBoot } from '@open-artifact/protocol';
import type { Viewer } from '@open-artifact/runtime/capabilities';
import { archiveEntries, writeZip } from '@open-artifact/type-server';
import { HOME_BOOT_PLACEHOLDER, SHELL_BOOT_PLACEHOLDER } from '../src/core/app/pages.ts';
import { parseConfig } from '../src/core/config.ts';
import { parseNodeEnv } from '../src/node/env.ts';
import { startHost, type RunningHost } from '../src/node/host.ts';

interface Answer {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

const OWNER_KEY = 'owner-key-for-the-e2e-test-0123456789';
const SAMPLE = fileURLToPath(new URL('../../../test-artifacts/whiteboard/elements', import.meta.url));
const BUILT_UI = fileURLToPath(new URL('../../../dist/daemon', import.meta.url));

function call(port: number, method: string, url: string, headers: Record<string, string> = {}, body?: string | Uint8Array): Promise<Answer> {
  const target = new URL(url);
  return new Promise((resolvePromise, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path: target.pathname + target.search, headers: { host: target.host, ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

/** A WebSocket handshake to a page's events: the open socket (and when it closes), or the refusal's status. */
function socketTo(port: number, url: string, origin: string): Promise<{ status: number; socket?: Socket; closed?: Promise<void> }> {
  const target = new URL(url);
  return new Promise((resolvePromise, reject) => {
    const req = request({
      host: '127.0.0.1',
      port,
      path: target.pathname + target.search,
      headers: { host: target.host, origin, connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-key': randomBytes(16).toString('base64'), 'sec-websocket-version': '13' },
    });
    req.on('upgrade', (res: IncomingMessage, socket: Socket) => {
      const closed = new Promise<void>((done) => {
        socket.on('close', () => done());
        socket.on('end', () => done());
      });
      socket.on('data', () => undefined);
      resolvePromise({ status: res.statusCode ?? 101, socket, closed });
    });
    req.on('response', (res) => {
      res.resume();
      resolvePromise({ status: res.statusCode ?? 0 });
    });
    req.on('error', (error: NodeJS.ErrnoException) => (error.code === 'ECONNRESET' ? resolvePromise({ status: 0 }) : reject(error)));
    req.end();
  });
}

const settled = (promise: Promise<void>, ms = 300): Promise<boolean> =>
  Promise.race([promise.then(() => true), new Promise<boolean>((done) => setTimeout(() => done(false), ms))]);

/** A port nobody uses now (the host's origins name their port before it listens). */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, '127.0.0.1', done));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((done) => probe.close(() => done()));
  return port;
}

/** The cookie pairs a response sets, as a `Cookie` header. */
function cookieOf(answer: Answer): string {
  const lines = answer.headers['set-cookie'] ?? [];
  return lines.map((line) => line.split(';')[0]!).join('; ');
}

describe('host end to end (P1)', () => {
  let dir: string;
  let host: RunningHost;
  let port: number;
  let app: string;
  let usedBuiltUi = false;

  /** An app-origin request; writes carry the app origin. */
  const at = (method: string, path: string, cookie?: string, body?: unknown, headers: Record<string, string> = {}): Promise<Answer> => {
    const write = method !== 'GET' && method !== 'HEAD';
    const raw = body instanceof Uint8Array || typeof body === 'string';
    return call(
      port,
      method,
      app + path,
      {
        ...(cookie ? { cookie } : {}),
        ...(write ? { origin: app } : {}),
        ...(body !== undefined && !raw ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body === undefined ? undefined : raw ? (body as string | Uint8Array) : JSON.stringify(body),
    );
  };
  const json = <T>(answer: Answer): T => JSON.parse(answer.body) as T;

  /** What a page (by its framed address) can do: its role, comment, edit. No cookies go to a content host. */
  const abilities = async (pageUrl: string): Promise<{ role: string | null; comment: boolean; edit: boolean }> => {
    const session = await call(port, 'GET', `${pageUrl}_api/session`);
    assert.equal(session.headers['set-cookie'], undefined);
    const comment = await call(port, 'POST', `${pageUrl}_api/comments/create`, { 'content-type': 'application/json' }, JSON.stringify({ input: { anchor: '{"element":"n1"}', label: 'Note', text: 'Looks good' } }));
    const write = { client: 'p', writes: [{ op: 'set', path: `elements/e2e${randomBytes(3).toString('hex')}`, data: { type: 'note', x: 0, y: 0, text: 'Hi', color: 'yellow' } }] };
    const edit = await call(port, 'POST', `${pageUrl}_api/db/write`, { 'content-type': 'application/json' }, JSON.stringify(write));
    return { role: session.status === 200 ? json<{ viewer: Viewer }>(session).viewer.role : null, comment: comment.status === 200, edit: edit.status === 200 };
  };

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'open-artifact-host-e2e-'));
    const assets = join(dir, 'assets');
    await mkdir(join(assets, 'editors', 'whiteboard', 'assets'), { recursive: true });
    await writeFile(join(assets, 'editors', 'whiteboard', 'index.html'), '<!doctype html><html><head><script src="./assets/index-Ab12Cd34.js"></script></head><body></body></html>');
    await writeFile(join(assets, 'editors', 'whiteboard', 'assets', 'index-Ab12Cd34.js'), '/* editor */');
    await mkdir(join(assets, 'shell'), { recursive: true });
    await writeFile(join(assets, 'shell', 'index.html'), '<!doctype html><script>window.boot=/*__OPEN_ARTIFACT_BOOT__*/null;</script>');
    await writeFile(join(assets, 'support.js'), '/* runtime */');

    let uiDir = BUILT_UI;
    const built = existsSync(join(BUILT_UI, 'shell', 'index.html')) && existsSync(join(BUILT_UI, 'home', 'index.html'));
    if (built && (await readFile(join(BUILT_UI, 'shell', 'index.html'), 'utf8')).includes(SHELL_BOOT_PLACEHOLDER) && (await readFile(join(BUILT_UI, 'home', 'index.html'), 'utf8')).includes(HOME_BOOT_PLACEHOLDER)) {
      usedBuiltUi = true;
    } else {
      uiDir = join(dir, 'ui');
      await mkdir(join(uiDir, 'shell'), { recursive: true });
      await mkdir(join(uiDir, 'home'), { recursive: true });
      await writeFile(join(uiDir, 'shell', 'index.html'), `<!doctype html><script>window.boot=${SHELL_BOOT_PLACEHOLDER};</script>`);
      await writeFile(join(uiDir, 'home', 'index.html'), `<!doctype html><script>window.home=${HOME_BOOT_PLACEHOLDER};</script>`);
    }

    port = await freePort();
    app = `http://localhost:${port}`;
    const config = parseConfig({
      OA_APP_ORIGIN: app,
      OA_CONTENT_ORIGIN: `http://{id}.content.localhost:${port}`,
      OA_SIGNING_KEYS: 'e'.repeat(40),
      OA_OWNER_KEY: OWNER_KEY,
    });
    const env = parseNodeEnv({ OA_DATA_DIR: join(dir, 'data'), OA_PORT: String(port), OA_BIND: '127.0.0.1', OA_ASSETS_DIR: assets });
    host = await startHost({ config, env, uiDir, log: () => undefined });
  });

  after(async () => {
    await host?.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it('keeps its database and data folder to the owner (0600, 0700)', async () => {
    const data = join(dir, 'data');
    assert.equal((await stat(data)).mode & 0o777, 0o700);
    for (const file of ['host.db', 'host.db-wal', 'host.db-shm']) {
      const info = await stat(join(data, file)).catch(() => null);
      if (file === 'host.db') assert.ok(info, file);
      if (info) assert.equal(info.mode & 0o777, 0o600, file);
    }
  });

  it('walks the P1 story', async (t) => {
    t.diagnostic(`Shell and home: ${usedBuiltUi ? 'the built dist/daemon' : 'stubs'}`);
    assert.equal(host.ownerKey, null, 'the key came from the environment');

    // 1. The owner signs in with the key.
    assert.equal((await at('GET', '/')).status, 303);
    const signIn = await at('POST', '/auth/owner-key', undefined, new URLSearchParams({ key: OWNER_KEY, return_to: '/' }).toString(), { 'content-type': 'application/x-www-form-urlencoded' });
    assert.equal(signIn.status, 303, signIn.body);
    const owner = cookieOf(signIn);
    assert.match(owner, /^oa_session=/);
    const home = await at('GET', '/', owner);
    assert.equal(home.status, 200);
    assert.ok(!home.body.includes(HOME_BOOT_PLACEHOLDER));

    // 2. The owner uploads a real artifact archive (as the Shell's "Download .zip" makes it).
    const chunks: Buffer[] = [];
    await writeZip(await archiveEntries(SAMPLE), async (chunk) => {
      chunks.push(chunk);
    });
    const imported = await at('POST', '/api/open-artifact.artifacts.import', owner, new Uint8Array(Buffer.concat(chunks)), { 'content-type': 'application/zip' });
    assert.equal(imported.status, 201, imported.body);
    const view = json<ArtifactView>(imported);
    assert.equal(view.type, 'whiteboard');
    assert.equal(view.role, 'owner');
    // The title is where the type keeps it (its manifest's `titleFrom`), not the zip's folder name.
    assert.equal(view.title, 'Whiteboard element test');
    const id = view.id;
    assert.ok(json<{ artifacts: ArtifactView[] }>(await at('GET', '/api/open-artifact.artifacts', owner)).artifacts.some((a) => a.id === id));
    // A round trip: the download is a zip of the same folder.
    const zip = await at('GET', `/api/open-artifact.artifact.archive?id=${id}`, owner);
    assert.equal(zip.status, 200);
    assert.equal(zip.headers['content-type'], 'application/zip');

    // 3. /a/<id> answers the Shell with its boot.
    const shell = await at('GET', `/a/${id}`, owner);
    assert.equal(shell.status, 200);
    assert.ok(!shell.body.includes(SHELL_BOOT_PLACEHOLDER));
    assert.ok(shell.body.includes(id));
    assert.match(String(shell.headers['content-security-policy']), new RegExp(`frame-src http://${id.replace('_', '-')}\\.content\\.localhost:${port}`));
    const boot = json<ShellBoot>(await at('GET', `/api/open-artifact.artifacts.boot?id=${id}`, owner));
    assert.equal(boot.cloud?.role, 'owner');

    // 4. The framed page answers; its session says owner.
    const page = await call(port, 'GET', boot.pageUrl!);
    assert.equal(page.status, 200);
    assert.equal(page.headers['set-cookie'], undefined);
    assert.deepEqual(await abilities(boot.pageUrl!), { role: 'owner', comment: true, edit: true });
    // A rename in the page reaches the catalog (the type server's touch; the title read where the type keeps it).
    const meta = JSON.parse(await readFile(join(host.rooms.rootOf(id), 'db/board/meta.json'), 'utf8')) as Record<string, unknown>;
    const renamed = await call(port, 'POST', `${boot.pageUrl!}_api/db/write`, { 'content-type': 'application/json' }, JSON.stringify({ client: 'p', writes: [{ op: 'set', path: 'board/meta', data: { ...meta, title: 'Renamed board' } }] }));
    assert.equal(renamed.status, 200, renamed.body);
    for (let i = 0; i < 50 && (await host.catalog.getArtifact(id))?.title !== 'Renamed board'; i++) await new Promise((done) => setTimeout(done, 20));
    assert.equal((await host.catalog.getArtifact(id))?.title, 'Renamed board');

    // 5. The owner adds a second person by email and turns link access on.
    const bobUser = await host.catalog.createUser({ name: 'Bob', email: 'bob@example.com', emailVerified: true });
    const bob = `oa_session=${(await host.catalog.createSession({ userId: bobUser.id, ttlMs: 3600_000 })).token}`;
    assert.equal((await at('GET', `/a/${id}`, bob)).status, 403);
    let shared = await at('POST', '/api/open-artifact.artifact.share', owner, { id, access: 'link', members: { 'email:bob@example.com': 'editor' }, links: { commenter: true } });
    assert.equal(shared.status, 200, shared.body);
    const shareView = json<ShareView>(shared);
    assert.equal(shareView.cloud?.members[0]?.id, `user:${bobUser.id}`);
    const linkUrl = shareView.links.commenter?.url;
    assert.ok(linkUrl);

    // 6. Bob opens it as an editor and writes.
    assert.equal((await at('GET', `/a/${id}`, bob)).status, 200);
    const bobBoot = json<ShellBoot>(await at('GET', `/api/open-artifact.artifacts.boot?id=${id}`, bob));
    assert.equal(bobBoot.cloud?.role, 'editor');
    assert.deepEqual(await abilities(bobBoot.pageUrl!), { role: 'editor', comment: true, edit: true });
    assert.equal(json<{ artifacts: ArtifactView[] }>(await at('GET', '/api/open-artifact.artifacts', bob)).artifacts.find((a) => a.id === id)?.role, 'editor');

    // 7. A link guest joins as a commenter: may comment, may not edit.
    const linkPath = new URL(linkUrl).pathname;
    assert.equal((await at('GET', linkPath)).status, 200);
    const joined = await at('POST', linkPath, undefined, 'name=Gus', { 'content-type': 'application/x-www-form-urlencoded' });
    assert.equal(joined.status, 303);
    assert.equal(joined.headers.location, `/a/${id}`);
    const gus = cookieOf(joined);
    assert.match(gus, /^oa_guest_art-/);
    assert.equal((await at('GET', `/a/${id}`, gus)).status, 200);
    const gusBoot = json<ShellBoot>(await at('GET', `/api/open-artifact.artifacts.boot?id=${id}`, gus));
    assert.equal(gusBoot.cloud?.role, 'commenter');
    assert.equal(gusBoot.cloud?.user, null);
    assert.deepEqual(await abilities(gusBoot.pageUrl!), { role: 'commenter', comment: true, edit: false });

    // 8. The owner demotes Bob: his page connection drops, and his next request is a viewer's.
    const events = (pageUrl: string) => `${pageUrl}_api/events?client=${randomBytes(4).toString('hex')}`;
    const bobWs = await socketTo(port, events(bobBoot.pageUrl!), app);
    const gusWs = await socketTo(port, events(gusBoot.pageUrl!), app);
    const ownerWs = await socketTo(port, events(boot.pageUrl!), app);
    for (const ws of [bobWs, gusWs, ownerWs]) assert.equal(ws.status, 101);
    shared = await at('POST', '/api/open-artifact.artifact.share', owner, { id, members: { [`user:${bobUser.id}`]: 'viewer' } });
    assert.equal(shared.status, 200);
    assert.equal(await settled(bobWs.closed!, 2000), true, "Bob's page dropped");
    assert.equal(await settled(gusWs.closed!), false);
    assert.equal(await settled(ownerWs.closed!, 50), false);
    assert.deepEqual(await abilities(bobBoot.pageUrl!), { role: 'viewer', comment: false, edit: false });
    assert.equal(json<ShellBoot>(await at('GET', `/api/open-artifact.artifacts.boot?id=${id}`, bob)).cloud?.role, 'viewer');

    // 9. Resetting the commenter link puts the guest out.
    shared = await at('POST', '/api/open-artifact.artifact.share', owner, { id, reset: 'commenter' });
    assert.equal(shared.status, 200);
    assert.equal(await settled(gusWs.closed!, 2000), true, "the guest's page dropped");
    assert.equal(await settled(ownerWs.closed!, 50), false);
    assert.notEqual((await call(port, 'GET', `${gusBoot.pageUrl!}_api/session`)).status, 200);
    assert.equal((await at('GET', `/api/open-artifact.artifact?id=${id}`, gus)).status, 401);
    assert.equal((await at('GET', linkPath)).status, 404);

    // 10. Trashing it puts everyone out.
    const bobWs2 = await socketTo(port, events(bobBoot.pageUrl!), app);
    assert.equal(bobWs2.status, 101);
    const trashed = await at('POST', '/api/open-artifact.artifacts.delete', owner, { id });
    assert.equal(trashed.status, 200);
    assert.equal(await settled(bobWs2.closed!, 2000), true, "Bob's page dropped");
    assert.equal(await settled(ownerWs.closed!, 2000), true, "the owner's page dropped");
    for (const pageUrl of [boot.pageUrl!, bobBoot.pageUrl!]) assert.notEqual((await call(port, 'GET', `${pageUrl}_api/session`)).status, 200);
    assert.equal((await at('GET', `/a/${id}`, bob)).status, 403);
    // Its owner is told it is in their trash (a 404 page, only to them).
    const ownerPage = await at('GET', `/a/${id}`, owner);
    assert.equal(ownerPage.status, 404);
    assert.match(ownerPage.body, /In your trash/);
    assert.match(ownerPage.body, /href="\/#trash"/);
    // The owner can bring it back.
    assert.equal((await at('POST', '/api/open-artifact.artifacts.restore', owner, { id })).status, 200);
    assert.equal((await at('GET', `/a/${id}`, owner)).status, 200);
  });
});
