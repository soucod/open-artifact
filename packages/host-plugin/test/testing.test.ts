import assert from 'node:assert/strict';
import { test } from 'node:test';
import { definePlugin, HttpError, type PluginContext } from '../src/index.ts';
import { createPluginHarness, PluginRefusedError } from '../src/testing.ts';

test('the harness refuses what the host refuses, with the host messages', () => {
  assert.throws(() => createPluginHarness({ id: 'x', apiVersion: 2 }), (e: unknown) => e instanceof PluginRefusedError && /needs plugin API version 2/.test(e.message));
  assert.throws(
    () => createPluginHarness({ id: 'x', apiVersion: 1, config: { url: { type: 'string', required: true } } }),
    { message: 'Plugin "x", setting "url" is required.' },
  );
  assert.throws(
    () => createPluginHarness({ id: 'x', apiVersion: 1, config: { token: { type: 'secret' } } }, { config: { token: { env: 'T' } } }),
    { message: 'Plugin "x", setting "token": the environment variable T is not set.' },
  );
  const h = createPluginHarness({ id: 'x', apiVersion: 1, laterHook: () => 1 });
  assert.deepEqual(h.warnings, ['Plugin "x": unknown "laterHook" ignored (this host does not know it).']);
});

test('ctx: config from env, kv with TTL on the harness clock, captured log/audit/fetch, fake users and artifacts', async () => {
  const plugin = definePlugin({
    id: 'probe',
    apiVersion: 1,
    config: { token: { type: 'secret', required: true }, limit: { type: 'number', default: 2 } },
    async guard({ principal, artifact }, ctx) {
      ctx.log(`checking with ${ctx.config.token}`);
      const owner = artifact ? await ctx.host.users.get(artifact.owner) : null;
      const response = await ctx.fetch('https://perms.example.test/check', { method: 'POST', body: JSON.stringify({ owner: owner?.email }) });
      await ctx.kv.set('last', await response.json(), { ttlSeconds: 60 });
      await ctx.host.audit('probe.checked', { limit: ctx.config.limit });
      await ctx.host.access.invalidate();
      if (principal.kind === 'user' && principal.email === (await ctx.host.users.findByEmail('EVE@example.com'))?.email) return { deny: 'Not Eve.' };
      return undefined;
    },
  });
  const h = createPluginHarness(plugin, {
    config: { token: { env: 'TOKEN' } },
    env: { TOKEN: 'tok-abcdef' },
    fetch: async (request) => Response.json({ seen: await request.text() }),
  });
  assert.deepEqual(h.config, { token: 'tok-abcdef', limit: 2 });
  const owner = h.addUser({ email: 'Owner@Example.com', name: 'Owner' });
  const eve = h.addUser({ email: 'eve@example.com' });
  const artifact = h.addArtifact({ owner: owner.id });
  assert.match(artifact.id, /^art_[0-9a-z]{10,40}$/);

  assert.deepEqual(await h.guard('artifact.export', { principal: h.userPrincipal(owner), artifact, detail: { format: 'zip' } }), { allowed: true });
  assert.deepEqual(await h.guard('artifact.export', { principal: h.userPrincipal(eve), artifact, detail: { format: 'pdf' } }), { allowed: false, reason: 'Not Eve.' });
  assert.deepEqual(h.logs[0], { message: 'checking with [secret]' });
  assert.equal(h.fetches.length, 2);
  assert.equal(await h.fetches[0]!.text(), '{"owner":"owner@example.com"}');
  assert.deepEqual(h.audits[0], { action: 'probe.checked', detail: { limit: 2 } });
  assert.deepEqual(h.invalidated, [null, null]);
  assert.deepEqual(h.kv.dump(), { last: { seen: '{"owner":"owner@example.com"}' } });
  h.advance(61_000);
  assert.deepEqual(h.kv.dump(), {});
  assert.equal(await h.kv.get('last'), null);
});

test('the failure policy: closed for auth, authz and guard; open for events and wake; the time limit applies', async () => {
  const h = createPluginHarness(
    {
      id: 'flaky',
      apiVersion: 1,
      auth: { authenticate: () => { throw new Error('down'); }, identity: () => new Promise(() => undefined) },
      authz: { role: () => 'admin', artifacts: () => 'all' },
      guard: () => { throw new Error('down'); },
      on: { 'user.created': () => { throw new Error('down'); } },
      wake: { deliver: () => { throw new Error('down'); } },
    },
    { timeoutMs: 20 },
  );
  assert.equal(await h.authenticate(new Request('https://x.test/')), null);
  assert.deepEqual(await h.identity({ subject: 'a' }), { reject: 'This sign-in could not be checked just now. Try again in a moment.' });
  assert.deepEqual(await h.role({ principal: { kind: 'anonymous' }, artifact: h.addArtifact(), role: 'viewer' }), { role: null, cacheSeconds: 0 });
  assert.deepEqual(await h.artifactsFor({ kind: 'anonymous' }), []);
  assert.deepEqual(await h.guard('agent.ask', { principal: { kind: 'anonymous' }, detail: { text: 'x' } }), { allowed: false, reason: 'This could not be checked just now (flaky). Try again in a moment.' });
  await h.emit('user.created', { user: { id: 'u', name: 'U', email: null }, provider: 'github' });
  const owner = h.addUser();
  assert.equal(await h.deliverWake({ artifact: h.addArtifact(), owner, payload: { kind: 'wake', requests: [] }, from: { name: 'A', role: 'editor' } }), false);
  assert.deepEqual(
    h.failures.map((f) => `${f.hook}:${f.reason}`),
    ['auth.authenticate:threw', 'auth.identity:timeout', 'authz.role:shape', 'authz.artifacts:shape', 'guard:threw', 'on.user.created:threw', 'wake.deliver:threw'],
  );
});

test('role: no opinion keeps the role; cacheSeconds as declared', async () => {
  const h = createPluginHarness({ id: 'r', apiVersion: 1, authz: { cacheSeconds: 5, role: ({ role }: { role: string | null }) => (role === null ? 'viewer' : undefined) } });
  const artifact = h.addArtifact();
  assert.deepEqual(await h.role({ principal: { kind: 'anonymous' }, artifact, role: null }), { role: 'viewer', cacheSeconds: 5 });
  assert.deepEqual(await h.role({ principal: { kind: 'anonymous' }, artifact, role: 'editor' }), { role: 'editor', cacheSeconds: 5 });
});

test('a missing fetch stub fails the hook with a message saying what to pass', async () => {
  const h = createPluginHarness({ id: 'f', apiVersion: 1, guard: async (_: unknown, ctx: PluginContext) => void (await ctx.fetch('https://x.test/')) });
  await h.guard('artifact.export', { principal: { kind: 'anonymous' }, detail: { format: 'zip' } });
  assert.match(h.failures[0]!.message, /no fetch stub: pass \{fetch\} to createPluginHarness/);
});

test('routes through the harness: params, 404, 405, cross-site writes, HttpError, timeouts', async () => {
  const h = createPluginHarness(
    {
      id: 'web',
      apiVersion: 1,
      routes: [
        { method: 'GET', path: '/items/:id', handler: ({ params, principal }: { params: { id: string }; principal: { kind: string } }) => Response.json({ id: params.id, who: principal.kind }) },
        { method: 'POST', path: '/hook', public: true, handler: () => { throw new HttpError(401, 'Bad signature.'); } },
        { method: 'POST', path: '/form', handler: () => new Response('saved') },
        { method: 'GET', path: '/slow', handler: () => new Promise(() => undefined) },
      ],
    },
    { timeoutMs: 20 },
  );
  assert.deepEqual(await (await h.request('GET', '/items/7')).json(), { id: '7', who: 'anonymous' });
  assert.deepEqual(await (await h.request('GET', '/plugins/web/items/8', { principal: { kind: 'user', id: 'u', name: 'U', siteRole: 'member' } })).json(), { id: '8', who: 'user' });
  assert.equal((await h.request('GET', '/nothing')).status, 404);
  const wrong = await h.request('PUT', '/items/7');
  assert.equal(wrong.status, 405);
  assert.equal(wrong.headers.get('allow'), 'GET');
  const denied = await h.request('POST', '/hook', { body: 'x', headers: { origin: 'https://elsewhere.test' } });
  assert.equal(denied.status, 401);
  assert.deepEqual(await denied.json(), { code: 'plugin_error', message: 'Bad signature.' });
  assert.equal((await h.request('POST', '/form', { headers: { origin: 'https://elsewhere.test' } })).status, 403);
  assert.equal((await h.request('POST', '/form', { headers: { origin: 'https://artifacts.example.test' } })).status, 200);
  assert.equal((await h.request('GET', '/slow')).status, 504);
});

test('sign-in round trip and sign-out', async () => {
  const h = createPluginHarness({
    id: 'sso',
    apiVersion: 1,
    auth: {
      signIn: {
        label: 'SSO',
        start: ({ callbackUrl, returnTo }: { callbackUrl: string; returnTo: string }) => Response.redirect(`https://sso.test/?cb=${encodeURIComponent(callbackUrl)}&rt=${encodeURIComponent(returnTo)}`, 302),
        finish: ({ request }: { request: Request }) => ({ identity: { subject: new URL(request.url).searchParams.get('u')! }, returnTo: '/a/1' }),
      },
      signOutUrl: () => 'javascript:alert(1)',
    },
  });
  const started = await h.signInStart({ returnTo: '/a/1' });
  assert.equal(started.headers.get('location'), 'https://sso.test/?cb=https%3A%2F%2Fartifacts.example.test%2Fauth%2Fplugin%3Asso%2Fcallback&rt=%2Fa%2F1');
  assert.deepEqual(await h.signInFinish(new Request('https://artifacts.example.test/auth/plugin:sso/callback?u=ann')), { identity: { subject: 'ann' }, returnTo: '/a/1' });
  assert.equal(await h.signOutUrl(h.userPrincipal(h.addUser())), null);
  assert.equal(h.failures[0]!.reason, 'shape');
});

test('definePlugin types ctx.config from the schema', () => {
  const plugin = definePlugin({
    id: 'typed',
    apiVersion: 1,
    config: { url: { type: 'string', required: true }, n: { type: 'number', default: 3 }, tags: { type: 'string[]' }, on: { type: 'boolean' } },
    guard(_input, ctx) {
      const url: string = ctx.config.url;
      const n: number = ctx.config.n;
      const tags: string[] | undefined = ctx.config.tags;
      const on: boolean | undefined = ctx.config.on;
      // @ts-expect-error: not a setting of this plugin
      void ctx.config.nope;
      void [url, n, tags, on];
      return undefined;
    },
  });
  assert.equal(plugin.id, 'typed');
});
