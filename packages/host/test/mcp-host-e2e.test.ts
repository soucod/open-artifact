/**
 * Remote MCP end to end on a real Node host (`startHost`, with the embedded type server and the installed
 * `artifact-types`): the OAuth code flow over HTTP with a configured client, then a generic MCP client
 * (`HttpMcpClient`, the type server's connector client) creating a whiteboard, writing and reading its files, reading
 * its comments through the type server's reserved action, and hearing a page's wake once.
 *
 * The editors are fakes (as in the Link end-to-end test).
 */

import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { HttpMcpClient } from '@open-artifact/type-server';
import { parseConfig } from '../src/core/config.ts';
import { parseMcpConfig } from '../src/core/mcp/config.ts';
import { startHost, type RunningHost } from '../src/node/host.ts';

const REDIRECT = 'http://127.0.0.1:9/callback';

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

const textOf = (result: { content: unknown[] }): Record<string, unknown> => JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;

describe('remote MCP on a Node host, end to end', () => {
  let dir: string;
  let host: RunningHost;
  let app: string;
  let cookie: string;
  let ownerId: string;
  let access: string;
  let client: HttpMcpClient;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'open-artifact-host-mcp-e2e-'));
    const assets = join(dir, 'assets');
    for (const type of ['whiteboard']) {
      await mkdir(join(assets, 'editors', type), { recursive: true });
      await writeFile(join(assets, 'editors', type, 'index.html'), '<!doctype html><html><head></head><body></body></html>');
    }
    await mkdir(join(assets, 'shell'), { recursive: true });
    await writeFile(join(assets, 'shell', 'index.html'), '<!doctype html><script>window.boot=/*__OPEN_ARTIFACT_BOOT__*/null;</script>');
    await writeFile(join(assets, 'support.js'), '/* runtime */');
    const uiDir = join(dir, 'ui');
    await mkdir(join(uiDir, 'shell'), { recursive: true });
    await mkdir(join(uiDir, 'home'), { recursive: true });
    const port = await freePort();
    // The app answers only on its own host: the origin is the address the test's requests use.
    app = `http://127.0.0.1:${port}`;
    const config = parseConfig({ OA_APP_ORIGIN: app, OA_CONTENT_ORIGIN: `http://{id}.content.localhost:${port}`, OA_SIGNING_KEYS: 'e'.repeat(40), OA_OWNER_KEY: 'owner-key-for-the-mcp-e2e-0123456789' });
    host = await startHost({
      config,
      env: { dataDir: join(dir, 'data'), port, bind: '127.0.0.1', assetsDir: assets },
      uiDir,
      log: () => undefined,
      mcp: { config: parseMcpConfig({ OA_OAUTH_CLIENTS: JSON.stringify([{ client_id: 'e2e', client_name: 'E2E client', redirect_uris: [REDIRECT] }]) }, config) },
    });
    const ada = await host.catalog.createUser({ name: 'Ada', email: 'ada@example.com', emailVerified: true });
    ownerId = ada.id;
    cookie = `oa_session=${(await host.catalog.createSession({ userId: ada.id, ttlMs: 3600_000 })).token}`;
  });

  after(async () => {
    await client?.close();
    await host?.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it('discovers OAuth from the 401 and gets a token through the consent page', async () => {
    const refused = await fetch(`${app}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) });
    assert.equal(refused.status, 401);
    const metadataUrl = /resource_metadata="([^"]+)"/.exec(refused.headers.get('www-authenticate') ?? '')![1]!;
    const resource = (await (await fetch(metadataUrl.replace('localhost', '127.0.0.1'))).json()) as { authorization_servers: string[]; resource: string };
    const server = (await (await fetch(`${resource.authorization_servers[0]!.replace('localhost', '127.0.0.1')}/.well-known/oauth-authorization-server`)).json()) as { authorization_endpoint: string; token_endpoint: string };

    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const params = { response_type: 'code', client_id: 'e2e', redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: 'S256', state: 's1', resource: resource.resource };
    const local = (url: string): string => url.replace('localhost', '127.0.0.1');
    const page = await fetch(`${local(server.authorization_endpoint)}?${new URLSearchParams(params)}`, { headers: { cookie }, redirect: 'manual' });
    assert.equal(page.status, 200);
    assert.match(await page.text(), /E2E client/);
    const origin = resource.authorization_servers[0]!;
    const approved = await fetch(local(server.authorization_endpoint), {
      method: 'POST',
      headers: { cookie, origin, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...params, decision: 'approve' }),
      redirect: 'manual',
    });
    const location = new URL(approved.headers.get('location')!);
    assert.equal(location.searchParams.get('state'), 's1');
    const token = await fetch(local(server.token_endpoint), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: location.searchParams.get('code')!, client_id: 'e2e', redirect_uri: REDIRECT, code_verifier: verifier }),
    });
    assert.equal(token.status, 200);
    access = ((await token.json()) as { access_token: string }).access_token;
    client = new HttpMcpClient('open-artifact', { url: `${app}/mcp`, headers: { authorization: `Bearer ${access}` } });
  });

  it('lists the tools and the installed types', async () => {
    const tools = (await client.listTools()).map((t) => t.name).sort();
    assert.deepEqual(tools, ['Artifact', 'ArtifactComments', 'ArtifactData', 'ShowArtifact']);
    const types = textOf(await client.callTool('Artifact', { action: 'list', scope: 'types' }));
    const ids = (types.types as Array<{ id: string }>).map((t) => t.id);
    assert.ok(ids.includes('whiteboard'), ids.join(','));
    assert.ok(ids.includes('docs'));
  });

  it('creates a whiteboard, writes and reads its files, reads its comments, and hears a wake once', async () => {
    const created = textOf(await client.callTool('Artifact', { action: 'publish', type_url: 'open-artifact://type/whiteboard', title: 'Retro' }));
    assert.ok(!created.error, JSON.stringify(created));
    const url = String(created.url);
    const id = url.replace('open-artifact://artifact/', '');
    assert.match(String(created.instructions), /whiteboard/i);
    const row = await host.catalog.getArtifact(id);
    assert.equal(row?.ownerUser, ownerId);
    const marker = JSON.parse(await readFile(join(host.rooms.rootOf(id), '.artifact.json'), 'utf8')) as { type: string; id: string };
    assert.deepEqual([marker.type, marker.id], ['whiteboard', id]);

    const summary = textOf(await client.callTool('Artifact', { action: 'read', url }));
    const files = (summary.files as Array<{ path: string; sha256: string }>).map((f) => f.path);
    assert.ok(files.some((p) => p.startsWith('db/board/')), files.join(','));
    assert.ok((summary.actions as Array<{ name: string }>).some((a) => a.name === 'check'));

    const notes = 'Went well: shipping.';
    const written = textOf(await client.callTool('Artifact', { action: 'publish', url, files: { 'notes.md': notes } }));
    assert.ok(!written.error, JSON.stringify(written));
    const read = textOf(await client.callTool('Artifact', { action: 'read', url, path: 'notes.md' }));
    assert.equal(read.content, notes);
    const stale = textOf(await client.callTool('Artifact', { action: 'publish', url, files: { 'notes.md': 'x' }, if_match: { 'notes.md': '0'.repeat(64) } }));
    assert.equal((stale.error as { code: string }).code, 'conflict');

    const comments = textOf(await client.callTool('ArtifactComments', { action: 'read', url }));
    assert.ok(!comments.error, JSON.stringify(comments));
    assert.ok(Array.isArray(comments.threads));

    await host.rooms.typeApi.wake(id, { requests: [{ id: 'req-1', text: 'Group the sticky notes by theme' }] });
    const woke = await client.callTool('Artifact', { action: 'read', url });
    const messages = woke.content.slice(1).map((c) => ('text' in c ? c.text : ''));
    assert.equal(messages.length, 1);
    assert.match(messages[0]!, /Group the sticky notes by theme/);
    const again = await client.callTool('Artifact', { action: 'read', url });
    assert.equal(again.content.length, 1);
    assert.ok(!(await host.catalog.listOutbox(ownerId)).some((r) => r.kind === 'wake'), 'the Link would not get it again');
  });
});
