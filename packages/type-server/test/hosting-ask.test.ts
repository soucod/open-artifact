/**
 * Hosted mode: who may send to the owner's agent from a page. The owner always; an editor only when the host says the
 * owner lets editors ask (`hosting.mayAskAgent`), and then the wake names them; a commenter or viewer never, whatever
 * the host says. Without the hook (this computer) nothing changes: only the owner sends, with no sender named.
 */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createServer, request, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { TypeApiPresence, TypeApiWakeResult } from '@open-artifact/protocol';
import type { Viewer } from '@open-artifact/runtime/capabilities';
import { createTypeServer, type TypeApiLike, type TypeServer, type TypeServerHosting } from '../src/index.ts';

type WakeBody = Parameters<TypeApiLike['wake']>[1];

/** One request to `port` with a Host header, answered as JSON. */
function call(port: number, host: string, method: string, path: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolvePromise, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { host, ...(body === undefined ? {} : { 'content-type': 'application/json' }) } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolvePromise({ status: res.statusCode ?? 0, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} });
      });
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

describe('hosted mode: asking the agent', () => {
  let dir: string;
  let server: TypeServer;
  let front: Server;
  let port: number;
  const host = 'art-a.content.test';
  /** The owner's setting, as the host keeps it. */
  let editorsAsk = false;
  /** Every wake the server hands the host. */
  const wakes: WakeBody[] = [];
  const viewers: Record<string, Viewer> = {
    'v1.owner': { id: 'user:ada', name: 'Ada', role: 'owner' },
    'v1.editor': { id: 'user:eve', name: 'Eve', role: 'editor' },
    'v1.commenter': { id: 'user:cam', name: 'Cam', role: 'commenter' },
    'v1.viewer': { id: 'user:vic', name: 'Vic', role: 'viewer' },
  };
  const daemon: TypeApiLike = {
    async wake(_id, body): Promise<TypeApiWakeResult> {
      wakes.push(body);
      return { status: 'inbox', via: 'link' };
    },
    async presence(): Promise<TypeApiPresence> {
      return { presence: 'online', canSend: true, canSendSession: true, busy: false, agentName: 'Claude' };
    },
    async touch() {
      return {};
    },
  };

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'open-artifact-hosting-ask-'));
    const assets = join(dir, 'assets');
    await mkdir(join(assets, 'editors', 'whiteboard'), { recursive: true });
    await writeFile(join(assets, 'editors', 'whiteboard', 'index.html'), '<!doctype html><title>whiteboard</title>');
    await mkdir(join(assets, 'shell'), { recursive: true });
    await writeFile(join(assets, 'shell', 'index.html'), '<!doctype html>');
    await writeFile(join(assets, 'support.js'), '');
    const root = join(dir, 'artifacts', 'art_a');
    const hosting: TypeServerHosting = {
      hostAllowed: (name) => name === host || name === 'app.test',
      async resolve(token) {
        const viewer = viewers[token];
        return viewer ? { id: 'art_a', root, title: 'Retro', viewer: viewer.role === 'owner' ? { ...viewer, id: 'owner' } : viewer } : null;
      },
      artifactOfHost: (name) => (name === host ? 'art_a' : null),
      pageBase: () => `https://${host}/`,
      shellUrl: () => 'https://app.test/a/art_a',
      ownerName: () => 'Ada',
      // The host says yes for anyone while the setting is on: the server still never lets a commenter or viewer send.
      mayAskAgent: () => editorsAsk,
    };
    server = createTypeServer({ assetsDir: assets, secret: 's', idleMs: 0, downloadsDir: join(dir, 'downloads'), lanAddresses: () => [], hosting, daemon });
    await server.listen(0);
    front = createServer((req, res) => server.handle(req, res));
    await new Promise<void>((done) => front.listen(0, '127.0.0.1', done));
    const address = front.address();
    port = typeof address === 'object' && address ? address.port : 0;
    await server.open({ id: 'art_a', root, type: 'whiteboard', title: 'Retro' });
  });

  after(async () => {
    front.closeAllConnections();
    await new Promise<void>((done) => front.close(() => done()));
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  });

  const as = (token: string, method: string, path: string, body?: unknown) => call(port, host, method, `/whiteboard/${token}/${path}`, body);
  const available = async (token: string): Promise<boolean> => ((await as(token, 'GET', '_api/session')).body.agent as { available: boolean }).available;
  const comment = { input: { anchor: '{"element":"n1"}', label: 'Note', text: 'Make it bigger' } };

  it('refuses an editor while the owner does not let editors ask, and hides the agent from them', async () => {
    editorsAsk = false;
    wakes.length = 0;
    assert.equal(await available('v1.editor'), false);
    const send = await as('v1.editor', 'POST', '_api/agent/send', { request: { text: 'hi' } });
    assert.equal(send.status, 403);
    assert.equal(send.body.code, 'not_writer');
    assert.match(String(send.body.message), /does not let editors ask/);
    const thread = (await as('v1.editor', 'POST', '_api/comments/create', comment)).body.thread as { id: string };
    assert.equal((await as('v1.editor', 'POST', '_api/comments/send', { threadId: thread.id })).status, 403);
    assert.equal(wakes.length, 0);
    // The owner sends, with no sender named (as on this computer).
    assert.equal((await as('v1.owner', 'POST', '_api/agent/send', { request: { text: 'from Ada' } })).status, 200);
    assert.equal(wakes.length, 1);
    assert.equal(wakes[0]!.requests![0]!.from, undefined);
  });

  it('lets an editor ask while the owner allows it, naming them on the wake', async () => {
    editorsAsk = true;
    wakes.length = 0;
    assert.equal(await available('v1.editor'), true);
    const send = await as('v1.editor', 'POST', '_api/agent/send', { request: { text: 'Tidy the board' } });
    assert.equal(send.status, 200, JSON.stringify(send.body));
    assert.deepEqual(wakes[0]!.requests![0]!.from, { name: 'Eve', role: 'editor' });
    const thread = (await as('v1.editor', 'POST', '_api/comments/create', comment)).body.thread as { id: string };
    const sent = await as('v1.editor', 'POST', '_api/comments/send', { threadId: thread.id });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.deepEqual(wakes[1]!.requests![0]!.from, { name: 'Eve', role: 'editor' });
  });

  it('never lets a commenter or a viewer ask, even when the host says yes', async () => {
    editorsAsk = true;
    wakes.length = 0;
    for (const token of ['v1.commenter', 'v1.viewer']) {
      assert.equal(await available(token), false, token);
      assert.equal((await as(token, 'POST', '_api/agent/send', { request: { text: 'hi' } })).status, 403, token);
    }
    const thread = (await as('v1.commenter', 'POST', '_api/comments/create', comment)).body.thread as { id: string };
    assert.equal((await as('v1.commenter', 'POST', '_api/comments/send', { threadId: thread.id })).status, 403);
    assert.equal(wakes.length, 0);
  });
});
