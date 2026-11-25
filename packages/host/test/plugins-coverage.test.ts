/**
 * What `@open-artifact/host-plugin` promises against what the host does, on a real Node host (`startHost`): one
 * plugin records every guard question and every event while the Library, the Link API, remote MCP and the upkeep do
 * each thing the contract names. Then every guarded action must have been asked on each path {@link GUARD_PATHS}
 * lists, every event sent, and each `detail` and payload must have the fields `GuardDetails` / `PluginEventMap`
 * declare, of the declared types (the `via` values included: the import's create is `import`, never `library`).
 */

import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { LINK_API_PREFIX, type LinkDeviceStart, type LinkToken } from '@open-artifact/protocol';
import { HttpMcpClient, archiveEntries, writeZip } from '@open-artifact/type-server';
import { parseConfig } from '../src/core/config.ts';
import { parseMcpConfig } from '../src/core/mcp/config.ts';
import { GUARD_PATHS } from '../src/core/plugins/hooks.ts';
import { parseNodeEnv } from '../src/node/env.ts';
import { startHost } from '../src/node/host.ts';
import { packageOf } from './site-type-fixture.ts';

const SAMPLE = fileURLToPath(new URL('../../../test-artifacts/whiteboard/elements', import.meta.url));
const REDIRECT = 'http://127.0.0.1:9/callback';

/** A field's declared type: a JS type (`?` when it may be absent), or the values it may take. */
type Field = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array' | `${'string' | 'object' | 'array'}?` | readonly unknown[];
type Shape = Readonly<Record<string, Field>>;

const REF: Shape = { id: 'string', type: 'string', title: 'string', owner: 'string' };
const ACTOR: Shape = { kind: ['user', 'agent', 'guest', 'anonymous', 'system'], id: ['string-or-null'], name: 'string?' };
const USER: Shape = { id: 'string', name: 'string', email: ['string-or-null'] };

/** `GuardDetails`, field by field. */
const GUARD: Record<keyof typeof GUARD_PATHS, Shape> = {
  'artifact.create': { type: 'string', title: 'string', via: ['import', 'link', 'mcp'] },
  'artifact.import': { type: 'null', bytes: 'number', via: ['library'] },
  'artifact.delete': { permanent: 'boolean' },
  'artifact.export': { format: 'string' },
  'share.change': { changes: 'object' },
  'link.connect': { client: 'object' },
  'link.publish': { type: 'string', bytes: 'number', replaces: 'boolean' },
  'type.publish': { id: 'string', uid: 'string', version: 'string', bytes: 'number', visibility: ['private', 'site', 'link'], replaces: 'boolean' },
  'mcp.connect': { client: 'object' },
  'agent.ask': { text: 'string', label: 'string?' },
};

/** `PluginEventMap`, field by field (nested objects by their own shape). */
const EVENTS: Record<string, Record<string, Field | Shape>> = {
  'user.created': { user: USER, provider: 'string' },
  'user.signed_in': { user: USER, provider: 'string' },
  'artifact.created': { artifact: REF, by: ACTOR, via: ['import', 'link', 'mcp'] },
  'artifact.changed': { artifact: REF, by: ACTOR, changes: 'object' },
  'artifact.trashed': { artifact: REF, by: ACTOR },
  'artifact.restored': { artifact: REF, by: ACTOR },
  'artifact.deleted': { artifact: REF, by: ACTOR, reason: ['owner', 'expired'] },
  'share.changed': { artifact: REF, by: ACTOR, changes: 'object' },
  'share.invited': { artifact: REF, by: ACTOR, invitee: 'object', role: ['viewer', 'commenter', 'editor'], url: 'string' },
  'agent.requested': { artifact: REF, by: ACTOR, owner: 'string', text: 'string', label: 'string?' },
  audit: { action: 'string', actor: ACTOR, artifact: ['string-or-null'], detail: ['any'] },
};

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** The ways `value` breaks `shape` (an empty list when it fits), and fields it has that the shape does not name. */
function misfits(value: Record<string, unknown>, shape: Record<string, Field | Shape>, where: string, ignore: readonly string[] = []): string[] {
  const out: string[] = [];
  for (const [key, field] of Object.entries(shape)) {
    const got = value[key];
    const at = `${where}.${key}`;
    if (Array.isArray(field)) {
      if (field[0] === 'any') continue;
      if (field[0] === 'string-or-null') {
        if (got !== null && typeof got !== 'string') out.push(`${at}: ${typeOf(got)}, not string or null`);
      } else if (!field.includes(got)) out.push(`${at}: ${JSON.stringify(got)}, not one of ${field.join('|')}`);
    } else if (typeof field === 'object') {
      if (typeOf(got) !== 'object') out.push(`${at}: ${typeOf(got)}, not object`);
      else out.push(...misfits(got as Record<string, unknown>, field as Shape, at));
    } else if (field.endsWith('?')) {
      if (got !== undefined && typeOf(got) !== field.slice(0, -1)) out.push(`${at}: ${typeOf(got)}, not ${field}`);
    } else if (typeOf(got) !== field) out.push(`${at}: ${typeOf(got)}, not ${field}`);
  }
  for (const key of Object.keys(value)) if (!(key in shape) && !ignore.includes(key)) out.push(`${where}.${key}: not declared`);
  return out;
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((done) => server.close(() => done()));
  return port;
}

test('every guarded action is asked, and every event sent, on each promised path, with the declared fields', async () => {
  const asked: Array<{ action: string; principal: { kind: string }; artifact?: unknown; detail: Record<string, unknown> }> = [];
  const heard: Array<Record<string, unknown> & { event: string }> = [];
  const on = Object.fromEntries(Object.keys(EVENTS).map((name) => [name, (event: Record<string, unknown> & { event: string }) => void heard.push(event)]));
  const recorder = {
    id: 'recorder',
    apiVersion: 1,
    // A person the request names in a header signs in (user.created, user.signed_in); asked only when they send it.
    auth: {
      recheck: false,
      authenticate: ({ request }: { request: Request }) => {
        const who = request.headers.get('x-test-person');
        return who ? { subject: who, email: `${who}@example.com`, emailVerified: true, name: who } : null;
      },
    },
    guard: (input: (typeof asked)[number]) => void asked.push(input),
    on,
  };

  const dir = await mkdtemp(join(tmpdir(), 'open-artifact-host-plugin-coverage-'));
  const assets = join(dir, 'assets');
  await mkdir(join(assets, 'editors', 'whiteboard'), { recursive: true });
  await writeFile(join(assets, 'editors', 'whiteboard', 'index.html'), '<!doctype html><html><head></head><body></body></html>');
  await mkdir(join(assets, 'shell'), { recursive: true });
  await writeFile(join(assets, 'shell', 'index.html'), '<!doctype html><script>window.boot=/*__OPEN_ARTIFACT_BOOT__*/null;</script>');
  await writeFile(join(assets, 'support.js'), '/* runtime */');
  const uiDir = join(dir, 'ui');
  await mkdir(join(uiDir, 'shell'), { recursive: true });
  await mkdir(join(uiDir, 'home'), { recursive: true });
  const port = await freePort();
  const app = `http://127.0.0.1:${port}`;
  const config = parseConfig({ OA_APP_ORIGIN: app, OA_CONTENT_ORIGIN: `http://{id}.content.localhost:${port}`, OA_SIGNING_KEYS: 'e'.repeat(40), OA_OWNER_KEY: 'o'.repeat(30), OA_SIGNUP: 'open', OA_TYPES_PUBLISH: 'members' });
  const env = { ...parseNodeEnv({ OA_DATA_DIR: join(dir, 'data'), OA_PORT: String(port), OA_BIND: '127.0.0.1' }), assetsDir: assets };
  const host = await startHost({
    config,
    env,
    uiDir,
    log: () => undefined,
    trashDays: 1,
    upkeepMs: 150,
    plugins: [{ entry: { use: 'recorder' }, plugin: recorder }],
    pluginEnv: {},
    mcp: { config: parseMcpConfig({ OA_OAUTH_CLIENTS: JSON.stringify([{ client_id: 'e2e', client_name: 'E2E client', redirect_uris: [REDIRECT] }]) }, config) },
  });
  let client: HttpMcpClient | undefined;
  try {
    const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json', origin: app, cookie }, body: JSON.stringify(body) });
    const api = (name: string, body: unknown): Promise<Response> => fetch(`${app}/api/open-artifact.${name}`, json(body));
    const ok = async (response: Response | Promise<Response>, status = 200): Promise<Response> => {
      const r = await response;
      assert.equal(r.status, status, `${r.url}: ${await r.clone().text()}`);
      return r;
    };

    // Sign-in by the plugin: user.created, user.signed_in.
    const signIn = await ok(fetch(`${app}/api/open-artifact.auth.me`, { headers: { 'x-test-person': 'ada' } }));
    const cookie = /oa_session=[^;]+/.exec(signIn.headers.get('set-cookie') ?? '')![0];
    assert.ok(cookie, 'signed in');
    await host.catalog.createUser({ name: 'Bob', email: 'bob@example.com', emailVerified: true });

    // The Library: an uploaded archive (artifact.import, then artifact.create via import; artifact.created via import).
    const chunks: Buffer[] = [];
    await writeZip(await archiveEntries(SAMPLE), async (chunk) => void chunks.push(chunk));
    const zip = new Uint8Array(Buffer.concat(chunks));
    const imported = (await (await ok(fetch(`${app}/api/open-artifact.artifacts.import`, { method: 'POST', headers: { 'content-type': 'application/zip', origin: app, cookie }, body: zip }), 201)).json()) as { id: string };
    const id = imported.id;
    await ok(api('artifacts.update', { id, title: 'Renamed' })); // artifact.changed
    await ok(api('artifact.share', { id, members: { 'email:bob@example.com': 'editor' } })); // share.change, share.changed, share.invited
    await ok(api('artifacts.ask', { id, text: 'tidy up', label: 'Tidy' })); // agent.ask, agent.requested
    await ok(fetch(`${app}/api/open-artifact.artifact.archive?id=${id}`, { headers: { cookie } })); // artifact.export
    await ok(api('artifacts.delete', { id })); // artifact.delete (to the trash), artifact.trashed
    await ok(api('artifacts.restore', { id })); // artifact.restored
    await ok(api('artifacts.delete', { id }));
    await ok(api('artifacts.purge', { id })); // artifact.delete (for good), artifact.deleted reason owner

    // A linked computer: the device sign-in (link.connect), a publish (link.publish, artifact.create via link), an
    // export, an unpublish (artifact.delete), and publishing that id again (link.publish replaces).
    const link = (name: string, query = ''): string => `${app}${LINK_API_PREFIX}${name}${query}`;
    const started = (await (await ok(fetch(link('device'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client: { name: 'Laptop', harness: 'claude-code', version: '2.1' } }) }))).json()) as LinkDeviceStart;
    await ok(fetch(`${app}/link/device`, { method: 'POST', headers: { cookie, origin: app, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ user_code: started.user_code, decision: 'approve' }).toString() }));
    const token = (await (await ok(fetch(link('token'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'device_code', device_code: started.device_code }) }))).json()) as LinkToken;
    const bearer = { authorization: `Bearer ${token.access_token}` };
    const linkId = `art_${randomBytes(8).toString('hex')}`;
    await ok(fetch(link('import', `?id=${linkId}`), { method: 'POST', headers: { ...bearer, 'content-type': 'application/zip' }, body: zip }), 201);
    await ok(fetch(link('export', `?id=${linkId}`), { headers: bearer }));
    await ok(fetch(link('unpublish'), { method: 'POST', headers: { ...bearer, 'content-type': 'application/json' }, body: JSON.stringify({ id: linkId }) }));
    await ok(fetch(link('import', `?id=${linkId}&type=whiteboard`), { method: 'POST', headers: { ...bearer, 'content-type': 'application/zip' }, body: zip }), 201);
    // A type published to the site (type.publish), then a new version of it (replaces).
    await ok(fetch(link('types.import', '?visibility=site'), { method: 'POST', headers: { ...bearer, 'content-type': 'application/zip' }, body: packageOf() as Uint8Array<ArrayBuffer> }), 201);
    await ok(fetch(link('types.import'), { method: 'POST', headers: { ...bearer, 'content-type': 'application/zip' }, body: packageOf({ version: '1.1.0' }) as Uint8Array<ArrayBuffer> }));

    // An agent app: the OAuth consent (mcp.connect), create (artifact.create via mcp), a write (artifact.changed),
    // delete (artifact.delete).
    const verifier = randomBytes(32).toString('base64url');
    const params = { response_type: 'code', client_id: 'e2e', redirect_uri: REDIRECT, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', state: 's1', resource: `${app}/mcp` };
    const approved = await fetch(`${app}/oauth/authorize`, { method: 'POST', headers: { cookie, origin: app, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ...params, decision: 'approve' }), redirect: 'manual' });
    const code = new URL(approved.headers.get('location') ?? 'x:').searchParams.get('code');
    assert.ok(code, `consent approved (${approved.status})`);
    const issued = (await (await ok(fetch(`${app}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: 'e2e', redirect_uri: REDIRECT, code_verifier: verifier }) }))).json()) as { access_token: string };
    client = new HttpMcpClient('open-artifact', { url: `${app}/mcp`, headers: { authorization: `Bearer ${issued.access_token}` } });
    const textOf = (result: { content: unknown[] }): Record<string, unknown> => JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
    const created = textOf(await client.callTool('Artifact', { action: 'publish', type_url: 'open-artifact://type/whiteboard', title: 'Retro' }));
    assert.ok(!created.error, JSON.stringify(created));
    assert.ok(!textOf(await client.callTool('Artifact', { action: 'publish', url: created.url, files: { 'notes.md': 'hi' } })).error);
    assert.ok(!textOf(await client.callTool('Artifact', { action: 'delete', url: created.url })).error);

    // The upkeep: an artifact in the trash past OA_TRASH_DAYS is deleted (artifact.deleted reason expired, by system).
    const old = await host.catalog.createArtifact({ type: 'whiteboard', title: 'Old', ownerUser: (await host.catalog.getArtifact(linkId))!.ownerUser });
    await host.catalog.driver.run('UPDATE artifacts SET trashed_at = ? WHERE id = ?', [new Date(Date.now() - 3 * 24 * 3600_000).toISOString(), old.id]);
    for (let i = 0; i < 40 && !heard.some((e) => e.event === 'artifact.deleted' && e.reason === 'expired'); i++) await new Promise((done) => setTimeout(done, 50));
    await host.plugins?.idle();

    // Every guarded action was asked on each of its paths, and each detail fits GuardDetails.
    const problems: string[] = [];
    for (const [i, input] of asked.entries()) {
      const shape = GUARD[input.action as keyof typeof GUARD];
      if (!shape) {
        problems.push(`guard ${i}: ${input.action} is not in GuardDetails`);
        continue;
      }
      problems.push(...misfits(input.detail, shape, `guard ${input.action}`));
      assert.equal(typeof input.principal.kind, 'string');
    }
    const vias = (action: string) => new Set(asked.filter((a) => a.action === action).map((a) => a.detail.via));
    assert.deepEqual(vias('artifact.create'), new Set(['import', 'link', 'mcp']), 'artifact.create on the upload, the link publish and MCP');
    assert.deepEqual(vias('artifact.import'), new Set(['library']));
    assert.deepEqual(new Set(asked.filter((a) => a.action === 'artifact.delete').map((a) => a.detail.permanent)), new Set([false, true]));
    assert.equal(asked.filter((a) => a.action === 'artifact.delete').length, 5, 'trash (twice), purge, unpublish, MCP delete');
    assert.equal(asked.filter((a) => a.action === 'artifact.export').length, 2, 'the archive and the link export');
    assert.deepEqual(new Set(asked.filter((a) => a.action === 'link.publish').map((a) => a.detail.replaces)), new Set([false, true]));
    assert.deepEqual(asked.filter((a) => a.action === 'type.publish').map((a) => [a.detail.version, a.detail.replaces, a.detail.visibility]), [['1.0.0', false, 'site'], ['1.1.0', true, 'site']]);
    for (const action of Object.keys(GUARD_PATHS)) assert.ok(asked.some((a) => a.action === action), `guard ${action} was asked`);

    // Every event was sent, each with the fields PluginEventMap declares.
    for (const event of heard) {
      const shape = EVENTS[event.event];
      if (!shape) problems.push(`event ${event.event} is not in PluginEventMap`);
      else problems.push(...misfits(event, shape, `event ${event.event}`, ['event', 'at']));
      if (typeof event.at !== 'string' || Number.isNaN(Date.parse(event.at))) problems.push(`event ${event.event}.at: not an ISO time`);
    }
    for (const name of Object.keys(EVENTS)) assert.ok(heard.some((e) => e.event === name), `event ${name} was sent`);
    const createdVia = new Set(heard.filter((e) => e.event === 'artifact.created').map((e) => e.via));
    assert.deepEqual(createdVia, new Set(['import', 'link', 'mcp']), 'artifact.created via the upload, the link and MCP (never library)');
    assert.deepEqual(new Set(heard.filter((e) => e.event === 'artifact.deleted').map((e) => e.reason)), new Set(['owner', 'expired']));
    assert.deepEqual(problems, []);
  } finally {
    await client?.close();
    await host.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
