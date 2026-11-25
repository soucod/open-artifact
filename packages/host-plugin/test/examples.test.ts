/** The example plugins in `examples/host-plugins/`, tested with the test kit as their authors would. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { signHmacSha256, type Jwk } from '../src/index.ts';
import { createPluginHarness } from '../src/testing.ts';

const EXAMPLES = new URL('../../../examples/host-plugins/', import.meta.url);
async function load(name: string): Promise<unknown> {
  const module = (await import(new URL(`${name}.mjs`, EXAMPLES).href)) as { default: unknown };
  return module.default;
}

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array | string): string =>
  btoa(String.fromCharCode(...(typeof bytes === 'string' ? enc.encode(bytes) : bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const NOW = new Date('2026-01-01T00:00:00.000Z');

test('three of the examples import nothing', async () => {
  for (const name of ['static-groups', 'webhook-events', 'invite-email']) {
    const source = await readFile(new URL(`${name}.mjs`, EXAMPLES), 'utf8');
    assert.ok(!/^\s*import\b|\bimport\s*\(|\brequire\s*\(/m.test(source), name);
  }
});

test('header-auth: a shared secret from the proxy', async () => {
  const h = createPluginHarness(await load('header-auth'), { config: { secret: { env: 'PROXY_SECRET' }, groupsHeader: 'x-forwarded-groups' }, env: { PROXY_SECRET: 'proxy-secret-1' } });
  const from = (headers: Record<string, string>) => h.authenticate(new Request('https://artifacts.example.test/', { headers }));
  assert.deepEqual(await from({ 'x-forwarded-email': 'Ann@Example.com', 'x-forwarded-user': 'Ann', 'x-forwarded-groups': 'design, staff', 'x-proxy-secret': 'proxy-secret-1' }), {
    subject: 'ann@example.com',
    email: 'ann@example.com',
    emailVerified: true,
    name: 'Ann',
    groups: ['design', 'staff'],
  });
  assert.equal(await from({ 'x-forwarded-email': 'ann@example.com', 'x-proxy-secret': 'wrong' }), null);
  assert.equal(await from({ 'x-forwarded-email': 'ann@example.com' }), null);
  assert.equal(await from({ 'x-proxy-secret': 'proxy-secret-1' }), null);
  assert.deepEqual(h.failures, []);
});

test('header-auth: a JWT from the proxy, checked against its JWKS', async () => {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...((await crypto.subtle.exportKey('jwk', pair.publicKey)) as Jwk), kid: 'k1' };
  const token = async (claims: Record<string, unknown>): Promise<string> => {
    const data = `${b64url(JSON.stringify({ alg: 'RS256', kid: 'k1' }))}.${b64url(JSON.stringify(claims))}`;
    return `${data}.${b64url(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, enc.encode(data))))}`;
  };
  const t = Math.floor(NOW.getTime() / 1000);
  const h = createPluginHarness(await load('header-auth'), {
    config: { jwtHeader: 'cf-access-jwt-assertion', jwksUrl: 'https://team.example.test/certs', issuer: 'https://team.example.test', audience: 'aud-1' },
    now: NOW,
    fetch: async () => Response.json({ keys: [jwk] }),
  });
  const good = await token({ sub: 'u-123', email: 'ann@example.com', iss: 'https://team.example.test', aud: 'aud-1', exp: t + 300 });
  // The e-mail comes from the token, not from a header beside it.
  assert.deepEqual(await h.authenticate(new Request('https://a.test/', { headers: { 'cf-access-jwt-assertion': good, 'x-forwarded-email': 'ceo@example.com' } })), {
    subject: 'u-123',
    email: 'ann@example.com',
    emailVerified: true,
  });
  const wrongAudience = await token({ sub: 'u-123', iss: 'https://team.example.test', aud: 'other', exp: t + 300 });
  assert.equal(await h.authenticate(new Request('https://a.test/', { headers: { 'cf-access-jwt-assertion': wrongAudience } })), null);
  assert.deepEqual(h.logs.at(-1), { message: 'refused a JWT: wrong audience' });
});

test('header-auth: with neither a secret nor a JWT its validate refuses the settings, naming the plugin', async () => {
  const plugin = await load('header-auth');
  assert.throws(() => createPluginHarness(plugin), (error: Error & { problems?: string[] }) => {
    assert.deepEqual(error.problems, ['Plugin "header-auth": set "secret" (with "secretHeader") or "jwtHeader" and "jwksUrl": without one, anyone could send the header.']);
    return true;
  });
  assert.throws(() => createPluginHarness(plugin, { config: { jwtHeader: 'x-jwt' } }), /a JWT needs both "jwtHeader" and "jwksUrl"/);
});

test('http-authz: a signed question, the answer as the role, fail closed, a signed invalidation webhook', async () => {
  const secret = 'perm-secret-xyz';
  let answer: Response = Response.json({ role: 'editor' });
  const h = createPluginHarness(await load('http-authz'), {
    config: { url: 'https://perms.example.test/check', secret: { env: 'PERMS' } },
    env: { PERMS: secret },
    fetch: async () => answer.clone(),
  });
  const ann = h.addUser({ email: 'ann@example.com' });
  const artifact = h.addArtifact({ title: 'Roadmap' });
  assert.deepEqual(await h.role({ principal: h.userPrincipal(ann, ['oidc:design']), artifact, role: 'viewer' }), { role: 'editor', cacheSeconds: 60 });
  const sent = h.fetches[0]!;
  const body = await sent.text();
  assert.deepEqual(JSON.parse(body), { user: { id: ann.id, email: 'ann@example.com', groups: ['oidc:design'] }, artifact: { id: artifact.id, type: 'slides', title: 'Roadmap', owner: 'owner' }, role: 'viewer' });
  assert.equal(sent.headers.get('x-oa-signature'), `sha256=${await signHmacSha256({ secret, body })}`);

  answer = Response.json({});
  assert.equal((await h.role({ principal: h.userPrincipal(ann), artifact, role: 'viewer' })).role, 'viewer');
  answer = Response.json({ role: null });
  assert.equal((await h.role({ principal: h.userPrincipal(ann), artifact, role: 'viewer' })).role, null);
  answer = new Response('down', { status: 503 });
  assert.deepEqual(await h.role({ principal: h.userPrincipal(ann), artifact, role: 'owner' }), { role: null, cacheSeconds: 0 });
  const before = h.fetches.length;
  assert.equal((await h.role({ principal: { kind: 'anonymous' }, artifact, role: null })).role, null);
  assert.equal(h.fetches.length, before, 'no question for someone not signed in');

  const payload = JSON.stringify({ artifactId: artifact.id });
  const signed = await h.request('POST', '/invalidate', { body: payload, headers: { 'x-oa-signature': `sha256=${await signHmacSha256({ secret, body: payload })}`, origin: 'https://perms.example.test' } });
  assert.equal(signed.status, 200);
  assert.deepEqual(h.invalidated, [artifact.id]);
  const forged = await h.request('POST', '/invalidate', { body: payload, headers: { 'x-oa-signature': 'sha256=00' } });
  assert.equal(forged.status, 401);
  assert.deepEqual(h.invalidated, [artifact.id]);
  const all = await h.request('POST', '/invalidate', { body: '', headers: { 'x-oa-signature': `sha256=${await signHmacSha256({ secret, body: '' })}` } });
  assert.equal(all.status, 200);
  assert.deepEqual(h.invalidated, [artifact.id, null]);
});

test('static-groups: authz.artifacts lists what a group may open, bounded, and keeps the list for cacheSeconds', async () => {
  const staticGroups = await load('static-groups');
  const h = createPluginHarness(staticGroups, {
    config: { groups: { design: 'ann@example.com', staff: '@example.com' }, roles: { staff: 'viewer', design: 'editor:lead@example.com' } },
  });
  const lead = h.addUser({ email: 'lead@example.com' });
  const other = h.addUser({ email: 'other@example.com' });
  const leads = [h.addArtifact({ owner: lead.id }), h.addArtifact({ owner: lead.id })];
  const others = h.addArtifact({ owner: other.id });
  h.addArtifact({ owner: other.id, trashedAt: new Date().toISOString() });
  const ann = h.userPrincipal(h.addUser({ email: 'ann@elsewhere.test' }));
  const annDesign = h.userPrincipal(h.addUser({ email: 'ann@example.com' }));
  // ann@example.com is staff (every artifact) and design (the lead's): every one outside the trash.
  assert.deepEqual((await h.artifactsFor(annDesign)).sort(), [...leads, others].map((a) => a.id).sort());
  // In no group: nothing.
  assert.deepEqual(await h.artifactsFor(ann), []);
  // Kept for cacheSeconds: a new artifact shows after that.
  const later = h.addArtifact({ owner: lead.id });
  assert.equal((await h.artifactsFor(annDesign)).includes(later.id), false);
  h.advance(301_000);
  assert.equal((await h.artifactsFor(annDesign)).includes(later.id), true);
  // Only the lead's for a group whose role is for the lead's artifacts.
  const design = createPluginHarness(staticGroups, { config: { groups: { design: 'ann@example.com' }, roles: { design: 'editor:lead@example.com' } } });
  const lead2 = design.addUser({ email: 'lead@example.com' });
  const mine = design.addArtifact({ owner: lead2.id });
  design.addArtifact({ owner: design.addUser({ email: 'x@example.com' }).id });
  assert.deepEqual(await design.artifactsFor(design.userPrincipal(design.addUser({ email: 'ann@example.com' }))), [mine.id]);
  // A host without ctx.host.artifacts.list: nothing (the role hook still works).
  const old = createPluginHarness(staticGroups, { config: { groups: { staff: '@example.com' }, roles: { staff: 'viewer' } }, features: ['authz.role', 'authz.artifacts'] });
  old.addArtifact({});
  assert.deepEqual(await old.artifactsFor(old.userPrincipal(old.addUser({ email: 'a@example.com' }))), []);
});

test('static-groups: roles from groups by e-mail and domain, on all artifacts or one owner\'s; never lowers a role', async () => {
  const staticGroups = await load('static-groups');
  const h = createPluginHarness(staticGroups, {
    config: { groups: { design: 'ann@example.com', staff: '@example.com' }, roles: { staff: 'viewer', design: 'editor:lead@example.com' } },
  });
  const lead = h.addUser({ email: 'lead@example.com' });
  const other = h.addUser({ email: 'other@example.com' });
  const ann = h.userPrincipal(h.addUser({ email: 'ann@example.com' }));
  const bo = h.userPrincipal(h.addUser({ email: 'bo@example.com' }));
  const leads = h.addArtifact({ owner: lead.id });
  const others = h.addArtifact({ owner: other.id });
  assert.equal((await h.role({ principal: ann, artifact: leads, role: null })).role, 'editor');
  assert.equal((await h.role({ principal: ann, artifact: others, role: null })).role, 'viewer');
  assert.equal((await h.role({ principal: bo, artifact: leads, role: null })).role, 'viewer');
  assert.equal((await h.role({ principal: bo, artifact: leads, role: 'owner' })).role, 'owner');
  assert.equal((await h.role({ principal: h.userPrincipal(h.addUser({ email: 'x@elsewhere.test' })), artifact: leads, role: null })).role, null);
  assert.equal((await h.role({ principal: { ...bo, emailVerified: false }, artifact: leads, role: null })).role, null);
  assert.equal((await h.role({ principal: { kind: 'agent', id: 't', label: 'cli', user: ann }, artifact: leads, role: null })).role, 'editor');
  assert.equal((await h.role({ principal: ann, artifact: leads, role: null })).cacheSeconds, 300);

  assert.throws(
    () => createPluginHarness(staticGroups, { config: { groups: { a: '@example.com' }, roles: { a: 'owner', b: 'viewer' } } }),
    (error: Error & { problems?: string[] }) => {
      assert.deepEqual(error.problems, [
        'Plugin "static-groups": roles.a is "owner": the role is viewer, commenter or editor.',
        'Plugin "static-groups": roles.b: there is no group "b" in groups.',
      ]);
      return true;
    },
  );
  // A map setting may come from the environment, as JSON.
  const fromEnv = createPluginHarness(staticGroups, { config: { groups: { env: 'G' }, roles: { env: 'R' } }, env: { G: '{"staff":"@example.com"}', R: '{"staff":"commenter"}' } });
  assert.equal((await fromEnv.role({ principal: bo, artifact: leads, role: null })).role, 'commenter');
  assert.throws(() => createPluginHarness(staticGroups, { config: { groups: ['staff=@example.com'] } }), /setting "groups": expected an object of strings/);
});

test('webhook-events: chosen events only, Slack text, signed, failed posts retried with the next event', async () => {
  const posted: Array<{ body: string; signature: string | null }> = [];
  let up = true;
  const h = createPluginHarness(await load('webhook-events'), {
    config: { url: { env: 'HOOK' }, events: ['artifact.created', 'share.invited'], format: 'slack', signingSecret: { env: 'SIGN' } },
    env: { HOOK: 'https://hooks.slack.test/T1/B1/xyz', SIGN: 'sign-secret' },
    fetch: async (request) => {
      if (!up) return new Response('no', { status: 500 });
      posted.push({ body: await request.text(), signature: request.headers.get('x-oa-signature') });
      return new Response('ok');
    },
  });
  const artifact = { id: 'art_000000000001', type: 'slides', title: 'Plan', owner: 'u1' };
  await h.emit('artifact.created', { artifact, by: { kind: 'user', id: 'u1', name: 'Ann' }, via: 'import' });
  await h.emit('artifact.trashed', { artifact, by: { kind: 'user', id: 'u1', name: 'Ann' } });
  assert.deepEqual(posted.map((p) => p.body), ['{"text":"Ann created \\"Plan\\"."}']);
  assert.equal(posted[0]!.signature, `sha256=${await signHmacSha256({ secret: 'sign-secret', body: posted[0]!.body })}`);

  up = false;
  await h.emit('share.invited', { artifact, by: { kind: 'user', id: 'u1', name: 'Ann' }, invitee: { email: 'bo@example.com' }, role: 'editor', url: 'https://a.test/a/1' });
  assert.equal(h.failures.at(-1)!.hook, 'on.share.invited');
  assert.equal(Object.keys(h.kv.dump()).length, 1);
  up = true;
  await h.emit('artifact.created', { artifact: { ...artifact, title: 'Next' }, by: { kind: 'user', id: 'u1', name: 'Ann' }, via: 'mcp' });
  assert.deepEqual(posted.slice(1).map((p) => JSON.parse(p.body).text), ['Ann invited bo@example.com to "Plan" as editor.', 'Ann created "Next".']);
  assert.deepEqual(h.kv.dump(), {});
  // The secret URL never reaches the log.
  assert.ok(h.logs.every((l) => !l.message.includes('xyz')));
});

test('webhook-events: JSON format posts the event as it came', async () => {
  const bodies: unknown[] = [];
  const h = createPluginHarness(await load('webhook-events'), { config: { url: 'https://hooks.example.test/x', events: ['user.created'] }, now: NOW, fetch: async (r) => { bodies.push(await r.json()); return new Response('ok'); } });
  await h.emit('user.created', { user: { id: 'u', name: 'U', email: null }, provider: 'github' });
  assert.deepEqual(bodies, [{ user: { id: 'u', name: 'U', email: null }, provider: 'github', event: 'user.created', at: NOW.toISOString() }]);
});

test('invite-email: a templated message through the mail API, with the key in the auth header', async () => {
  const sent: Request[] = [];
  let status = 200;
  const h = createPluginHarness(await load('invite-email'), {
    config: { apiUrl: 'https://mail.example.test/send', apiKey: { env: 'MAIL_KEY' }, from: 'Artifacts <artifacts@example.test>' },
    env: { MAIL_KEY: 'mail-key-123' },
    fetch: async (request) => {
      sent.push(request);
      return new Response('', { status });
    },
  });
  const artifact = { id: 'art_000000000001', type: 'docs', title: 'Q3 plan', owner: 'u1' };
  await h.emit('share.invited', { artifact, by: { kind: 'user', id: 'u1', name: 'Ann' }, invitee: { email: 'bo@example.com' }, role: 'commenter', url: 'https://a.test/a/1' });
  assert.equal(sent[0]!.headers.get('authorization'), 'Bearer mail-key-123');
  assert.deepEqual(await sent[0]!.json(), {
    from: 'Artifacts <artifacts@example.test>',
    to: 'bo@example.com',
    subject: 'Ann shared "Q3 plan" with you',
    text: 'Hello bo@example.com,\n\nAnn gave you commenter access to "Q3 plan".\n\nOpen it: https://a.test/a/1\n',
  });
  assert.deepEqual(h.audits, [{ action: 'invite.sent', detail: { artifact: artifact.id, role: 'commenter' } }]);

  // An invitee named by user id: the address comes from the site's users.
  const cy = h.addUser({ email: 'cy@example.com', name: 'Cy' });
  await h.emit('share.invited', { artifact, by: { kind: 'user', id: 'u1', name: 'Ann' }, invitee: { userId: cy.id }, role: 'viewer', url: 'https://a.test/a/1' });
  assert.equal(((await sent[1]!.json()) as { to: string; text: string }).to, 'cy@example.com');

  // The mail service failing is logged and changes nothing else (events fail open).
  status = 500;
  await h.emit('share.invited', { artifact, by: { kind: 'user', id: 'u1' }, invitee: { email: 'dee@example.com' }, role: 'viewer', url: 'https://a.test/a/1' });
  assert.equal(h.failures.length, 1);
  assert.match(h.failures[0]!.message, /answered 500/);
  assert.equal(h.audits.length, 2);
});
