import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PluginEntry, PluginKv } from '@open-artifact/host-plugin';
import { OpenArtifactError } from '@open-artifact/protocol';
import { SignInError } from '../src/core/auth/errors.ts';
import { newArtifactId } from '../src/core/catalog/catalog.ts';
import { createPlugins, PluginConfigError, type CreatePluginsInput, type PluginServices } from '../src/core/plugins/index.ts';
import type { ArtifactRow, Principal, UserPrincipal } from '../src/core/types.ts';

const ORIGIN = 'https://artifacts.example.test';
const NOW = new Date('2026-03-01T12:00:00.000Z');
const ANN: UserPrincipal = { kind: 'user', id: 'usr_ann', name: 'Ann', email: 'ann@example.com', emailVerified: true, groups: ['oidc:design'], siteRole: 'member' };
const ANON: Principal = { kind: 'anonymous' };

function row(over: Partial<ArtifactRow> = {}): ArtifactRow {
  return {
    id: newArtifactId(NOW),
    type: 'slides',
    typeRelease: null,
    title: 'Plan',
    ownerUser: 'usr_owner',
    workspaceId: null,
    generalAccess: 'restricted',
    settings: {},
    grantsVersion: 1,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    trashedAt: null,
    ...over,
  } as ArtifactRow;
}

function memoryKv(): PluginKv {
  const store = new Map<string, unknown>();
  return {
    get: async <T>(key: string) => (store.get(key) as T | undefined) ?? null,
    set: async (key, value) => void store.set(key, value),
    delete: async (key) => void store.delete(key),
    list: async () => [...store.entries()].map(([key, value]) => ({ key, value: value as never, expiresAt: null })),
  };
}

interface Setup {
  logs: string[];
  audits: Array<{ pluginId: string; action: string; detail: unknown }>;
  invalidated: Array<string | undefined>;
  waited: Promise<unknown>[];
}

function make(list: Array<{ plugin: unknown; entry?: Partial<PluginEntry> } | { entry: PluginEntry; loadError: string }>, extra: Omit<Partial<CreatePluginsInput>, 'services'> & { services?: Partial<PluginServices> } = {}) {
  const { services: overrides, ...rest } = extra;
  const setup: Setup = { logs: [], audits: [], invalidated: [], waited: [] };
  const kvs = new Map<string, PluginKv>();
  const services: PluginServices = {
    version: '0.12.3',
    appOrigin: ORIGIN,
    users: { get: async () => null, findByEmail: async () => null },
    artifacts: { get: async () => null, list: async () => ({ artifacts: [], next: null }) },
    invalidateAccess: (id) => void setup.invalidated.push(id),
    audit: async (entry) => void setup.audits.push(entry),
    kv: (id) => {
      if (!kvs.has(id)) kvs.set(id, memoryKv());
      return kvs.get(id)!;
    },
    ...overrides,
  };
  const plugins = createPlugins({
    plugins: list.map((item, index) =>
      'loadError' in item ? item : { entry: { use: `./p${index}.mjs`, ...item.entry }, plugin: item.plugin },
    ),
    env: {},
    services,
    log: (line) => setup.logs.push(line),
    now: () => NOW,
    waitUntil: (p) => void setup.waited.push(p),
    ...rest,
  });
  return { plugins, ...setup, kvs };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

test('a plugin list with problems stops the host, listing every one; optional and disabled ones are left out', () => {
  assert.throws(
    () => make([{ plugin: { id: 'a', apiVersion: 2 } }, { plugin: { id: 'a', apiVersion: 1 } }, { plugin: { id: 'a', apiVersion: 1 } }]),
    (e: unknown) => e instanceof PluginConfigError && e.problems.length === 2 && /needs plugin API version 2/.test(e.problems[0]!) && e.problems[1] === 'Two plugins in the list have the id "a"; ids must be unique (./p2.mjs).',
  );
  assert.throws(() => make([{ entry: { use: './gone.mjs' }, loadError: 'not found' }]), { message: 'The plugin "./gone.mjs" could not be loaded: not found' });

  const { plugins, logs } = make([
    { plugin: { id: 'bad', apiVersion: 1, config: { url: { type: 'string', required: true } } }, entry: { optional: true } },
    { plugin: { id: 'off', apiVersion: 1, guard: () => ({ deny: 'no' }) }, entry: { enabled: false } },
    { plugin: { id: 'good', apiVersion: 1, name: 'Good', version: '2.0.0', config: { token: { type: 'secret' } }, guard: () => undefined, mystery: 1 } },
  ]);
  assert.equal(plugins.size, 1);
  assert.deepEqual(logs, [
    'plugin bad is optional and left out: Plugin "bad", setting "url" is required.',
    'plugin good: Plugin "good": unknown "mystery" ignored (this host does not know it).',
  ]);
  assert.deepEqual(plugins.describe(), [
    { id: 'bad', use: './p0.mjs', name: 'bad', version: null, apiVersion: null, enabled: false, state: 'failed', hooks: [], settings: [], problems: ['Plugin "bad", setting "url" is required.'] },
    { id: 'off', use: './p1.mjs', name: 'off', version: null, apiVersion: 1, enabled: false, state: 'off', hooks: ['guard'], settings: [], problems: ['disabled in the plugin list'] },
    { id: 'good', use: './p2.mjs', name: 'Good', version: '2.0.0', apiVersion: 1, enabled: true, state: 'on', hooks: ['guard'], settings: ['token'], problems: ['Plugin "good": unknown "mystery" ignored (this host does not know it).'] },
  ]);
});

test('authenticate: in order, the first identity wins, a failure counts as no identity (closed) and is audited', async () => {
  const seen: string[] = [];
  const { plugins, logs, audits } = make([
    { plugin: { id: 'broken', apiVersion: 1, auth: { authenticate: () => { seen.push('broken'); throw new Error('boom'); } } } },
    { plugin: { id: 'none', apiVersion: 1, auth: { authenticate: () => { seen.push('none'); return null; } } } },
    { plugin: { id: 'proxy', apiVersion: 1, auth: { authenticate: async ({ request }: { request: Request }) => { seen.push('proxy'); return { subject: request.headers.get('x-user')!, email: 'ann@example.com', emailVerified: true, extra: 'dropped' }; } } } },
    { plugin: { id: 'late', apiVersion: 1, auth: { authenticate: () => { seen.push('late'); return { subject: 'late' }; } } } },
  ]);
  assert.equal(plugins.hasAuthenticate, true);
  const result = await plugins.authenticate(new Request(`${ORIGIN}/`, { method: 'POST', headers: { 'x-user': 'ann' }, body: 'kept' }));
  assert.deepEqual(result, { identity: { subject: 'ann', email: 'ann@example.com', emailVerified: true }, provider: 'plugin:proxy' });
  assert.deepEqual(seen, ['broken', 'none', 'proxy']);
  assert.deepEqual(logs, ['plugin broken: auth.authenticate failed (refused): threw: boom']);
  await plugins.idle();
  assert.deepEqual(audits, [{ pluginId: 'broken', action: 'plugin.failed', detail: { plugin: 'broken', hook: 'auth.authenticate', reason: 'threw', error: 'threw: boom' } }]);
});

test('time limit: a hook that hangs is stopped at timeoutMs and its signal aborted', async () => {
  let aborted = false;
  const { plugins, logs } = make([
    {
      plugin: { id: 'slow', apiVersion: 1, auth: { authenticate: (_: unknown, ctx: { signal: AbortSignal }) => new Promise(() => ctx.signal.addEventListener('abort', () => (aborted = true))) } },
      entry: { timeoutMs: 30 },
    },
  ]);
  const started = Date.now();
  assert.equal(await plugins.authenticate(new Request(`${ORIGIN}/`)), null);
  assert.ok(Date.now() - started < 1000);
  assert.ok(aborted);
  assert.match(logs[0]!, /^plugin slow: auth\.authenticate failed \(refused\): .*30 ?ms/);
});

test('wrong shapes fail like errors: closed for auth, authz and guard', async () => {
  const { plugins, logs } = make([
    {
      plugin: {
        id: 'odd',
        apiVersion: 1,
        auth: { authenticate: () => 'ann', identity: () => ({ subject: 'someone-else' }) },
        authz: { role: () => 'superuser' },
        guard: () => ({ deny: '' }),
      },
    },
  ]);
  assert.equal(await plugins.authenticate(new Request(`${ORIGIN}/`)), null);
  assert.deepEqual(await plugins.identity({ subject: 'ann' }, 'github'), { reject: 'This sign-in could not be checked just now. Try again in a moment.', plugin: 'odd' });
  assert.deepEqual(await plugins.role({ principal: ANN, artifact: row(), role: 'editor' }), { role: null, cacheSeconds: 0, failed: 'odd' });
  await assert.rejects(plugins.guard('agent.ask', { principal: ANN, detail: { text: 'hi' } }), (e: unknown) => e instanceof OpenArtifactError && e.code === 'not_granted' && e.status === 403 && e.message === 'This could not be checked just now (odd). Try again in a moment.');
  assert.deepEqual(logs, [
    'plugin odd: auth.authenticate failed (refused): answered wrongly: it answered something that is not an identity ({subject, email?, emailVerified?, name?, avatar?, groups?}) or null',
    "plugin odd: auth.identity failed (refused): answered wrongly: it changed the identity's subject, which it may not (it would sign the person in as someone else)",
    'plugin odd: authz.role failed (refused): answered wrongly: it answered "superuser", which is not a role (owner, editor, commenter, viewer), null or nothing',
    'plugin odd: guard failed (refused): answered wrongly: it answered {deny} without a sentence',
  ]);
});

test('identity: plugins add to it in order; a {reject} stops the sign-in with the sentence', async () => {
  const { plugins } = make([
    { plugin: { id: 'groups', apiVersion: 1, auth: { identity: ({ identity }: { identity: { subject: string; groups?: string[] } }) => ({ ...identity, groups: [...(identity.groups ?? []), 'staff'] }) } } },
    { plugin: { id: 'keep', apiVersion: 1, auth: { identity: () => undefined } } },
    {
      plugin: {
        id: 'gate',
        apiVersion: 1,
        auth: { identity: ({ identity, provider }: { identity: { email?: string }; provider: string }) => (identity.email?.endsWith('@example.com') ? undefined : { reject: `Only example.com people may sign in (${provider}).` }) },
      },
    },
  ]);
  assert.deepEqual(await plugins.identity({ subject: 's1', email: 'ann@example.com', groups: ['a'] }, 'github'), { identity: { subject: 's1', email: 'ann@example.com', groups: ['a', 'staff'] } });
  assert.deepEqual(await plugins.identity({ subject: 's2', email: 'eve@evil.test' }, 'github'), { reject: 'Only example.com people may sign in (github).', plugin: 'gate' });
});

test('sign-in buttons, start and finish (SignInError on failure), sign-out URL', async () => {
  const { plugins } = make([
    {
      plugin: {
        id: 'acme',
        apiVersion: 1,
        auth: {
          signIn: {
            label: ' Acme SSO ',
            start: ({ returnTo, callbackUrl }: { returnTo: string; callbackUrl: string }) => Response.redirect(`https://sso.acme.test/?cb=${encodeURIComponent(callbackUrl)}&state=${encodeURIComponent(returnTo)}`, 302),
            finish: ({ request }: { request: Request }) => {
              const code = new URL(request.url).searchParams.get('code');
              if (code !== 'good') throw new Error('bad code');
              return { identity: { subject: 'u1', name: 'Ann' }, returnTo: 'https://evil.test/' };
            },
          },
          signOutUrl: () => 'https://sso.acme.test/logout',
        },
      },
    },
  ]);
  assert.deepEqual(plugins.signInButtons(), [{ id: 'plugin:acme', label: 'Acme SSO' }]);
  const started = await plugins.startSignIn('plugin:acme', new Request(`${ORIGIN}/auth/plugin:acme/start`), '/a/1', `${ORIGIN}/auth/plugin:acme/callback`);
  assert.equal(started.status, 302);
  const done = await plugins.finishSignIn('acme', new Request(`${ORIGIN}/auth/plugin:acme/callback?code=good`));
  assert.equal(done.provider, 'plugin:acme');
  assert.deepEqual(done.identity, { subject: 'u1', name: 'Ann' });
  assert.equal(done.returnTo, '/');
  await assert.rejects(plugins.finishSignIn('plugin:acme', new Request(`${ORIGIN}/cb?code=bad`)), (e: unknown) => e instanceof SignInError && e.reason === 'provider_error');
  await assert.rejects(plugins.startSignIn('plugin:nobody', new Request(ORIGIN), '/', ORIGIN), (e: unknown) => e instanceof SignInError && e.reason === 'unknown_provider');
  assert.equal(await plugins.signOutUrl(ANN), 'https://sso.acme.test/logout');
});

test('role: a chain in list order, each sees the role so far; cacheSeconds is the smallest of those asked', async () => {
  const calls: string[] = [];
  const { plugins } = make([
    { plugin: { id: 'raise', apiVersion: 1, authz: { cacheSeconds: 120, role: ({ role }: { role: string | null }) => { calls.push(`raise:${role}`); return role === null ? 'viewer' : undefined; } } } },
    { plugin: { id: 'block', apiVersion: 1, authz: { cacheSeconds: 10, role: ({ principal, role }: { principal: { kind: string; email?: string }; role: string | null }) => { calls.push(`block:${role}`); return principal.kind === 'user' && principal.email === 'eve@example.com' ? null : undefined; } } } },
    { plugin: { id: 'other', apiVersion: 1, guard: () => undefined } },
  ]);
  assert.equal(plugins.hasRoleHook, true);
  assert.deepEqual(await plugins.role({ principal: ANN, artifact: row(), role: null }), { role: 'viewer', cacheSeconds: 10 });
  assert.deepEqual(calls, ['raise:null', 'block:viewer']);
  assert.deepEqual(await plugins.role({ principal: { ...ANN, email: 'eve@example.com' }, artifact: row(), role: 'editor' }), { role: null, cacheSeconds: 10 });

  const none = make([{ plugin: { id: 'x', apiVersion: 1 } }]).plugins;
  assert.equal(none.hasRoleHook, false);
  assert.deepEqual(await none.role({ principal: ANN, artifact: row(), role: 'commenter' }), { role: 'commenter', cacheSeconds: null });

  const plain = make([{ plugin: { id: 'p', apiVersion: 1, authz: { role: () => undefined } } }]).plugins;
  assert.deepEqual(await plain.role({ principal: ANN, artifact: row(), role: 'viewer' }), { role: 'viewer', cacheSeconds: 30 });
});

test('role: plugins see plugin views (no link ids, no scopes) and cannot change what the next one sees', async () => {
  let second: unknown;
  const { plugins } = make([
    {
      plugin: {
        id: 'meddle',
        apiVersion: 1,
        authz: {
          role: ({ principal, artifact }: { principal: { user?: { name: string } }; artifact: { title: string } }) => {
            artifact.title = 'changed';
            if (principal.user) principal.user.name = 'changed';
            return undefined;
          },
        },
      },
    },
    { plugin: { id: 'look', apiVersion: 1, authz: { role: (input: unknown) => void (second = input) } } },
  ]);
  const agent: Principal = { kind: 'agent', id: 'tok_1', user: ANN, label: 'laptop', harness: 'claude-code', scopes: ['artifacts:write'] };
  const artifact = row();
  await plugins.role({ principal: agent, artifact, role: 'owner' });
  assert.deepEqual(second, {
    principal: { kind: 'agent', id: 'tok_1', label: 'laptop', harness: 'claude-code', user: { kind: 'user', id: 'usr_ann', name: 'Ann', email: 'ann@example.com', emailVerified: true, groups: ['oidc:design'], siteRole: 'member' } },
    artifact: { id: artifact.id, type: 'slides', title: 'Plan', owner: 'usr_owner', generalAccess: 'restricted', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), trashedAt: null },
    role: 'owner',
  });
  assert.equal(artifact.title, 'Plan');
});

test('extraArtifacts: merged, only artifact ids, a failing plugin adds none', async () => {
  const a = newArtifactId(NOW);
  const b = newArtifactId(NOW);
  const { plugins } = make([
    { plugin: { id: 'one', apiVersion: 1, authz: { artifacts: () => [a, 'not-an-id', a] } } },
    { plugin: { id: 'two', apiVersion: 1, authz: { artifacts: () => { throw new Error('down'); } } } },
    { plugin: { id: 'three', apiVersion: 1, authz: { artifacts: async () => [b] } } },
  ]);
  assert.deepEqual(await plugins.extraArtifacts(ANN), [a, b]);
});

test('guard: the first {deny} wins with its sentence as not_granted, and is audited; nothing means allowed', async () => {
  const asked: unknown[] = [];
  const { plugins, audits } = make([
    { plugin: { id: 'log', apiVersion: 1, guard: (input: unknown) => void asked.push(input) } },
    { plugin: { id: 'size', apiVersion: 1, name: 'Size limit', guard: ({ action, detail }: { action: string; detail: { bytes?: number } }) => (action === 'artifact.import' && (detail.bytes ?? 0) > 100 ? { deny: 'Archives over 100 bytes are not allowed here.' } : undefined) } },
    { plugin: { id: 'never', apiVersion: 1, guard: () => { throw new Error('should not be asked'); } } },
  ]);
  const artifact = row();
  await assert.rejects(
    plugins.guard('artifact.import', { principal: ANN, artifact, detail: { type: null, bytes: 500, via: 'library' } }),
    (e: unknown) => e instanceof OpenArtifactError && e.code === 'not_granted' && e.status === 403 && e.message === 'Archives over 100 bytes are not allowed here.',
  );
  await plugins.idle();
  assert.deepEqual(audits, [{ pluginId: 'size', action: 'plugin.denied', detail: { action: 'artifact.import', artifact: artifact.id } }]);
  assert.equal((asked[0] as { action: string }).action, 'artifact.import');
  await assert.rejects(plugins.guard('nope' as 'agent.ask', { principal: ANN, detail: { text: '' } }), TypeError);
  const allowed = make([{ plugin: { id: 'ok', apiVersion: 1, guard: () => undefined } }]).plugins;
  await allowed.guard('share.change', { principal: ANN, detail: { changes: { access: 'link' } } });
});

test('events: emit returns at once, handlers run in the background with waitUntil, failures are logged only', async () => {
  const got: Array<{ plugin: string; event: unknown }> = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const { plugins, logs, waited, audits } = make([
    { plugin: { id: 'slow', apiVersion: 1, on: { 'artifact.created': async (e: unknown) => { await gate; got.push({ plugin: 'slow', event: e }); } } } },
    { plugin: { id: 'bad', apiVersion: 1, on: { 'artifact.created': () => { throw new Error('nope'); } } } },
    { plugin: { id: 'deaf', apiVersion: 1, on: { 'share.changed': () => undefined } } },
  ]);
  const artifact = { id: newArtifactId(NOW), type: 'slides', title: 'Plan', owner: 'usr_ann' };
  const own: Promise<unknown>[] = [];
  const returned = plugins.emit('artifact.created', { artifact, by: { kind: 'user', id: 'usr_ann', name: 'Ann' }, via: 'import' }, (p) => void own.push(p));
  assert.equal(returned, undefined);
  assert.equal(got.length, 0);
  assert.equal(own.length, 2);
  assert.equal(waited.length, 0);
  release();
  await plugins.idle();
  assert.deepEqual(got, [{ plugin: 'slow', event: { artifact, by: { kind: 'user', id: 'usr_ann', name: 'Ann' }, via: 'import', event: 'artifact.created', at: NOW.toISOString() } }]);
  assert.deepEqual(logs, ['plugin bad: on.artifact.created failed (ignored): threw: nope']);
  assert.deepEqual(audits, []);

  // Without a per-call waitUntil, the one given to createPlugins keeps the work alive.
  plugins.emit('share.changed', { artifact, by: { kind: 'user', id: 'usr_ann' }, changes: { access: 'link' }, at: '2026-01-01T00:00:00.000Z' });
  assert.equal(waited.length, 1);
  await plugins.idle();
});

test('events: a plugin does not hear its own audit entries; an unknown event is logged', async () => {
  const heard: string[] = [];
  const { plugins, logs } = make([
    { plugin: { id: 'a', apiVersion: 1, on: { audit: (e: { action: string }) => void heard.push(`a:${e.action}`) } } },
    { plugin: { id: 'b', apiVersion: 1, on: { audit: (e: { action: string }) => void heard.push(`b:${e.action}`) } } },
  ]);
  plugins.emit('audit', { action: 'invite.sent', actor: { kind: 'system', id: 'plugin:a' }, artifact: null, detail: null });
  await plugins.idle();
  assert.deepEqual(heard, ['b:invite.sent']);
  plugins.emit('nope' as 'audit', { action: 'x', actor: { kind: 'system', id: null }, artifact: null, detail: null });
  assert.deepEqual(logs, ['plugins: no such event nope']);
});

test('wake.deliver: the first {delivered: true} wins; failures fall through (open)', async () => {
  const { plugins, logs } = make([
    { plugin: { id: 'down', apiVersion: 1, wake: { deliver: () => { throw new Error('runner down'); } } } },
    { plugin: { id: 'skip', apiVersion: 1, wake: { deliver: () => undefined } } },
    { plugin: { id: 'runner', apiVersion: 1, wake: { deliver: ({ payload }: { payload: { requests: unknown[] } }) => (payload.requests.length > 0 ? { delivered: true } : undefined) } } },
  ]);
  const owner = { id: 'usr_owner', name: 'Owner', email: null, emailVerified: false, avatar: null, siteRole: 'member' as const, createdAt: NOW.toISOString(), disabled: false };
  const payload = { kind: 'wake' as const, requests: [{ id: 'r1', text: 'Fix the title', sentAt: NOW.toISOString() }] };
  assert.equal(await plugins.deliverWake({ artifact: row(), owner, payload, from: { name: 'Ann', role: 'editor', userId: 'usr_ann' } }), true);
  assert.deepEqual(logs, ['plugin down: wake.deliver failed (ignored): threw: runner down']);
  assert.equal(await make([]).plugins.deliverWake({ artifact: row(), owner, payload, from: { name: 'Ann', role: 'editor' } }), false);
});

test('routes: /plugins/<id>/…, params, 404, 405, HEAD, same-origin writes unless public, errors', async () => {
  const principals: unknown[] = [];
  const { plugins, logs } = make([
    {
      plugin: {
        id: 'hooks',
        apiVersion: 1,
        name: 'Hooks',
        routes: [
          { method: 'GET', path: '/items/:id', handler: ({ params, principal }: { params: Record<string, string>; principal: unknown }) => { principals.push(principal); return Response.json(params); } },
          { method: 'POST', path: '/hook', public: true, handler: async ({ request }: { request: Request }) => Response.json({ got: await request.text() }) },
          { method: 'POST', path: '/admin', handler: () => new Response('done') },
          { method: 'GET', path: '/files/*', handler: ({ params }: { params: Record<string, string> }) => Response.json(params) },
          { method: 'GET', path: '/teapot', handler: () => { const e = new Error("I'm a teapot."); e.name = 'HttpError'; (e as Error & { status: number }).status = 418; throw e; } },
          { method: 'GET', path: '/crash', handler: () => { throw new Error('secret detail'); } },
          { method: 'GET', path: '/shape', handler: () => 'text' },
          { method: 'GET', path: '/hang', handler: () => new Promise(() => undefined) },
        ],
      },
      entry: { timeoutMs: 50 },
    },
  ]);
  const principalOf = async (): Promise<Principal> => ANN;
  const go = async (method: string, path: string, init: RequestInit = {}) => (await plugins.route(new Request(`${ORIGIN}${path}`, { method, ...init }), principalOf))!;

  assert.equal(await plugins.route(new Request(`${ORIGIN}/api/x`), principalOf), null);
  assert.equal(plugins.routeInfo(new Request(`${ORIGIN}/a/1`)), null);
  assert.deepEqual(plugins.routeInfo(new Request(`${ORIGIN}/plugins/hooks/hook`, { method: 'POST' })), { pluginId: 'hooks', public: true });
  assert.deepEqual(plugins.routeInfo(new Request(`${ORIGIN}/plugins/hooks/admin`, { method: 'POST' })), { pluginId: 'hooks', public: false });

  const item = await go('GET', '/plugins/hooks/items/42');
  assert.deepEqual(await item.json(), { id: '42' });
  assert.equal((principals[0] as { kind: string; id: string }).id, 'usr_ann');
  assert.equal((await go('HEAD', '/plugins/hooks/items/42')).status, 200);
  assert.deepEqual(await (await go('GET', '/plugins/hooks/files/a/b.txt')).json(), { '*': 'a/b.txt' });

  const missing = await go('GET', '/plugins/nobody/x');
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { code: 'not_found', message: 'There is no plugin "nobody" on this site.' });
  assert.equal((await go('GET', '/plugins/hooks/nothing')).status, 404);
  const wrong = await go('DELETE', '/plugins/hooks/items/42');
  assert.equal(wrong.status, 405);
  assert.equal(wrong.headers.get('allow'), 'GET');

  // A public webhook takes a cross-site POST; a route that is not public refuses it, and takes a same-origin one.
  assert.deepEqual(await (await go('POST', '/plugins/hooks/hook', { body: 'ping', headers: { origin: 'https://other.example' } })).json(), { got: 'ping' });
  assert.equal((await go('POST', '/plugins/hooks/admin', { headers: { origin: 'https://other.example' } })).status, 403);
  assert.equal((await go('POST', '/plugins/hooks/admin', { headers: { origin: ORIGIN } })).status, 200);

  const teapot = await go('GET', '/plugins/hooks/teapot');
  assert.equal(teapot.status, 418);
  assert.deepEqual(await teapot.json(), { code: 'plugin_error', message: "I'm a teapot." });
  const crash = await go('GET', '/plugins/hooks/crash');
  assert.equal(crash.status, 500);
  assert.deepEqual(await crash.json(), { code: 'plugin_error', message: 'The Hooks plugin failed to answer this request.' });
  assert.equal((await go('GET', '/plugins/hooks/shape')).status, 500);
  assert.equal((await go('GET', '/plugins/hooks/hang')).status, 504);
  assert.ok(logs.some((line) => line === 'plugin hooks: routes failed (ignored): threw: secret detail'));
});

test('ctx: config, log with secrets blanked, fetch with the time limit, kv per plugin, host services', async () => {
  const fetched: Request[] = [];
  let ctxSeen: Record<string, unknown> | undefined;
  const { plugins, logs, audits, invalidated, kvs } = make(
    [
      {
        plugin: {
          id: 'ctx',
          apiVersion: 1,
          config: { token: { type: 'secret', required: true }, mode: { type: 'string', default: 'fast' } },
          guard: async (_: unknown, ctx: Record<string, never> & { config: { token: string }; log: (m: string, f?: unknown) => void; fetch: typeof fetch; kv: PluginKv; host: { audit: (a: string, d?: unknown) => Promise<void>; access: { invalidate: (id?: string) => Promise<void> }; supports: (n: string) => boolean; users: { findByEmail: (e: string) => Promise<unknown> } } }) => {
            ctxSeen = ctx;
            ctx.log(`token is ${ctx.config.token}`, { token: ctx.config.token });
            await ctx.fetch('https://api.example.test/x');
            await ctx.kv.set('k', { n: 1 });
            await ctx.host.audit('ctx.checked', { ok: true });
            await ctx.host.access.invalidate('art_x');
            await assert.rejects(ctx.host.audit('bad action!', {}), TypeError);
            await assert.rejects(ctx.host.audit('big', 'x'.repeat(9000)), TypeError);
            return undefined;
          },
        },
        entry: { config: { token: { env: 'TOKEN' } } },
      },
    ],
    {
      env: { TOKEN: 'tok-123456' },
      services: { fetch: async (input, init) => { fetched.push(new Request(input, init)); return new Response('ok'); }, features: ['guard', 'ctx.kv'] },
    },
  );
  await plugins.guard('artifact.export', { principal: ANN, detail: { format: 'zip' } });
  assert.deepEqual(logs, ['plugin ctx: token is [secret] {"token":"[secret]"}']);
  assert.equal(fetched[0]!.url, 'https://api.example.test/x');
  assert.ok(fetched[0]!.signal instanceof AbortSignal);
  assert.deepEqual(await kvs.get('ctx')!.get('k'), { n: 1 });
  assert.deepEqual(audits, [{ pluginId: 'ctx', action: 'ctx.checked', detail: { ok: true } }]);
  assert.deepEqual(invalidated, ['art_x']);
  const host = ctxSeen!.host as { apiVersion: number; version: string; appOrigin: string; supports: (n: string) => boolean };
  assert.equal(host.apiVersion, 1);
  assert.equal(host.version, '0.12.3');
  assert.equal(host.appOrigin, ORIGIN);
  assert.equal(host.supports('ctx.kv'), true);
  assert.equal(host.supports('on.share.invited'), false);
  assert.deepEqual(ctxSeen!.config, { token: 'tok-123456', mode: 'fast' });
  assert.deepEqual((ctxSeen!.plugin as { id: string }).id, 'ctx');
});

test('ui: links in order with their plugin, the first brand wins', () => {
  const { plugins } = make([
    { plugin: { id: 'a', apiVersion: 1, ui: { links: [{ label: 'Help', href: 'https://help.example.test', where: 'account-menu' }, { label: 'Odd', href: '/x', where: 'sidebar' }], brand: { name: 'Acme' } } } },
    { plugin: { id: 'b', apiVersion: 1, ui: { links: [{ label: 'Status', href: '/plugins/b/status', where: 'home' }], brand: { name: 'Other' } } } },
  ]);
  assert.deepEqual(plugins.ui(), {
    links: [
      { label: 'Help', href: 'https://help.example.test', where: 'account-menu', plugin: 'a' },
      { label: 'Status', href: '/plugins/b/status', where: 'home', plugin: 'b' },
    ],
    brand: { name: 'Acme' },
  });
  assert.throws(() => make([{ plugin: { id: 'c', apiVersion: 1, ui: { links: [{ label: 'X', href: 'javascript:alert(1)', where: 'home' }] } } }]), PluginConfigError);
});

test('events: a hanging handler is cut off without holding up the next event', async () => {
  const { plugins, logs } = make([{ plugin: { id: 'stuck', apiVersion: 1, on: { 'user.created': () => new Promise(() => undefined) } }, entry: { timeoutMs: 20 } }]);
  plugins.emit('user.created', { user: { id: 'u', name: 'U', email: null }, provider: 'github' });
  await sleep(5);
  await plugins.idle();
  assert.match(logs[0]!, /^plugin stuck: on\.user\.created failed \(ignored\): /);
});
