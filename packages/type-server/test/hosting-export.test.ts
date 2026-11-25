/**
 * Hosted mode: who may export a doc (`hosting.mayExport`), the headers a cross-origin Shell needs to read an export,
 * and a snapshot page (a host's `resolve` answer with `snapshot`): a read-only page of its own that is nobody among
 * the page's peers and stops at its expiry.
 */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer, request, type IncomingHttpHeaders, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { Viewer } from '@open-artifact/runtime/capabilities';
import { createTypeServer, type TypeServer, type TypeServerHosting } from '../src/index.ts';

interface Answer {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

function call(port: number, method: string, path: string, headers: Record<string, string> = {}, body?: string): Promise<Answer> {
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

describe('hosted mode: exports and snapshot pages', () => {
  let dir: string;
  let server: TypeServer;
  let front: Server;
  let port: number;
  const host = 'art-d.content.test';
  const wbHost = 'art-w.content.test';
  /** The owner's "viewers can export" setting, as the host keeps it. */
  let viewersExport = false;
  /** When the host's snapshot token stops working (ms). */
  let snapshotUntil = 0;
  const viewers: Record<string, Viewer> = {
    'v1.owner': { id: 'user:ada', name: 'Ada', role: 'owner' },
    'v1.editor': { id: 'user:eve', name: 'Eve', role: 'editor' },
    'v1.commenter': { id: 'user:cam', name: 'Cam', role: 'commenter' },
    'v1.viewer': { id: 'user:vic', name: 'Vic', role: 'viewer' },
  };
  const roots: Record<string, string> = {};

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'open-artifact-hosting-export-'));
    const assets = join(dir, 'assets');
    for (const type of ['docs', 'whiteboard']) {
      await mkdir(join(assets, 'editors', type), { recursive: true });
      await writeFile(join(assets, 'editors', type, 'index.html'), `<!doctype html><title>${type} editor</title>`);
    }
    await mkdir(join(assets, 'shell'), { recursive: true });
    await writeFile(join(assets, 'shell', 'index.html'), '<!doctype html><title>frame shell</title><script>window.boot=/*__OPEN_ARTIFACT_BOOT__*/null;</script>');
    await writeFile(join(assets, 'support.js'), '');
    roots.art_d = join(dir, 'artifacts', 'art_d');
    roots.art_w = join(dir, 'artifacts', 'art_w');
    const idOf = (name: string | undefined): string | null => (name === host ? 'art_d' : name === wbHost ? 'art_w' : null);
    const hosting: TypeServerHosting = {
      hostAllowed: (name) => idOf(name) !== null || name === 'app.test',
      async resolve(token, _type, req) {
        const id = idOf(String(req.headers.host));
        if (!id) return null;
        if (token === 'v1.snap') {
          // The host checks the token's expiry; the server ends what is still open at `until`.
          if (Date.now() >= snapshotUntil) return null;
          return { id, root: roots[id]!, title: 'Plan', viewer: { id: 'user:ada', name: 'Ada', role: 'viewer' }, snapshot: { until: snapshotUntil } };
        }
        const viewer = viewers[token];
        return viewer ? { id, root: roots[id]!, title: 'Plan', viewer } : null;
      },
      artifactOfHost: idOf,
      pageBase: (id) => `https://${id === 'art_d' ? host : wbHost}/`,
      shellUrl: (id) => `https://app.test/a/${id}`,
      ownerName: () => 'Ada',
      // The host's rule: the owner, an editor, a commenter; a viewer while the setting is on.
      mayExport: (_id, viewer) => viewer.role !== 'viewer' || viewersExport,
    };
    server = createTypeServer({ assetsDir: assets, secret: 's', idleMs: 0, downloadsDir: join(dir, 'downloads'), lanAddresses: () => [], hosting });
    await server.listen(0);
    front = createServer((req, res) => server.handle(req, res));
    await new Promise<void>((done) => front.listen(0, '127.0.0.1', done));
    const address = front.address();
    port = typeof address === 'object' && address ? address.port : 0;
    await server.open({ id: 'art_d', root: roots.art_d, type: 'docs', title: 'Plan' });
    await server.open({ id: 'art_w', root: roots.art_w, type: 'whiteboard', title: 'Board' });
  });

  after(async () => {
    front.closeAllConnections();
    await new Promise<void>((done) => front.close(() => done()));
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  });

  const doc = (token: string, method: string, path: string, headers: Record<string, string> = {}, body?: unknown): Promise<Answer> =>
    call(port, method, `/docs/${token}/${path}`, { host, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, body === undefined ? undefined : JSON.stringify(body));
  const board = (token: string, method: string, path: string, headers: Record<string, string> = {}, body?: unknown): Promise<Answer> =>
    call(port, method, `/whiteboard/${token}/${path}`, { host: wbHost, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, body === undefined ? undefined : JSON.stringify(body));
  const json = (answer: Answer): Record<string, unknown> => JSON.parse(answer.body) as Record<string, unknown>;

  it("lets the Shell's broker read an export's file name and notes", async () => {
    const res = await doc('v1.owner', 'GET', '_api/doc/export?format=markdown', { origin: 'https://app.test' });
    assert.equal(res.status, 200, res.body);
    assert.equal(res.headers['access-control-allow-origin'], 'https://app.test');
    assert.equal(res.headers['access-control-expose-headers'], 'content-disposition, x-doc-export-notes');
    assert.match(String(res.headers['content-disposition']), /filename\*=UTF-8''Plan\.md/);
    assert.ok(res.headers['x-doc-export-notes'] !== undefined);
  });

  it('lets an editor and a commenter export, and a viewer only while the owner allows it', async () => {
    viewersExport = false;
    for (const token of ['v1.owner', 'v1.editor', 'v1.commenter']) {
      const res = await doc(token, 'GET', '_api/doc/export?format=markdown');
      assert.equal(res.status, 200, `${token}: ${res.body}`);
    }
    const refused = await doc('v1.viewer', 'GET', '_api/doc/export?format=markdown');
    assert.equal(refused.status, 403);
    assert.equal(json(refused).code, 'not_writer');
    assert.equal(json(refused).message, 'The owner has not let viewers download or export this artifact.');
    viewersExport = true;
    assert.equal((await doc('v1.viewer', 'GET', '_api/doc/export?format=markdown')).status, 200);
    viewersExport = false;
  });

  it('serves a snapshot page on its own: no frame Shell, no redirect, kept out of frames, indexes and Referers', async () => {
    snapshotUntil = Date.now() + 60_000;
    // A top-level visit with the snapshot token is the page itself (a person's token goes to the Shell).
    const visit = await doc('v1.snap', 'GET', '', { 'sec-fetch-dest': 'document' });
    assert.equal(visit.status, 200, visit.body);
    assert.match(visit.body, /docs editor/);
    assert.match(String(visit.headers['content-security-policy']), /frame-ancestors 'none'/);
    assert.equal(visit.headers['x-robots-tag'], 'noindex, nofollow');
    assert.equal(visit.headers['referrer-policy'], 'no-referrer');
    const person = await doc('v1.viewer', 'GET', '', { 'sec-fetch-dest': 'document' });
    assert.equal(person.status, 302);
    // Its calls read as a viewer and carry the same headers.
    const session = await doc('v1.snap', 'GET', '_api/session');
    assert.equal(session.status, 200, session.body);
    assert.equal((json(session).viewer as Viewer).role, 'viewer');
    assert.equal(session.headers['referrer-policy'], 'no-referrer');
    assert.equal(session.headers['x-robots-tag'], 'noindex, nofollow');
  });

  it('drops what a snapshot page writes, and keeps it off the peers list', async () => {
    snapshotUntil = Date.now() + 60_000;
    const note = { type: 'note', x: 0, y: 0, text: 'Snap', color: 'yellow' };
    const write = await board('v1.snap', 'POST', '_api/db/write', {}, { client: 's1', writes: [{ op: 'set', path: 'elements/s1', data: note }] });
    assert.equal(write.status, 200, write.body);
    const presence = await board('v1.snap', 'POST', '_api/presence', {}, { client: 's1', patch: { cursor: { x: 1, y: 1 } } });
    assert.equal(presence.status, 200);
    const read = await board('v1.owner', 'GET', '_api/db/get?path=elements%2Fs1');
    assert.equal(read.status, 200, read.body);
    assert.equal(json(read).data ?? null, null);
    // The same write from an editor lands, so the check above means something.
    assert.equal((await board('v1.editor', 'POST', '_api/db/write', {}, { client: 'e1', writes: [{ op: 'set', path: 'elements/e1', data: note }] })).status, 200);
    assert.equal((json(await board('v1.owner', 'GET', '_api/db/get?path=elements%2Fe1')).data as { text: string }).text, 'Snap');
    const peers = await board('v1.owner', 'GET', '_api/peers');
    assert.equal(peers.status, 200, peers.body);
    assert.doesNotMatch(peers.body, /s1/);
  });

  it('ends at its expiry: the host refuses the token and an open event stream closes', async () => {
    snapshotUntil = Date.now() + 400;
    const ended = new Promise<number>((done, reject) => {
      const req = request({ host: '127.0.0.1', port, path: '/whiteboard/v1.snap/_api/events?client=s2', headers: { host: wbHost } }, (res) => {
        assert.equal(res.statusCode, 200);
        const opened = Date.now();
        res.on('data', () => undefined);
        res.on('close', () => done(Date.now() - opened));
      });
      req.on('error', (error: NodeJS.ErrnoException) => (error.code === 'ECONNRESET' ? done(-1) : reject(error)));
      req.end();
    });
    const took = await Promise.race([ended, new Promise<number>((done) => setTimeout(() => done(Infinity), 3000))]);
    assert.ok(took < 3000, 'the stream ends at the expiry');
    const late = await board('v1.snap', 'GET', '_api/session');
    assert.equal(late.status, 403);
  });
});
