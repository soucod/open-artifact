// Tests for company-jwt.mjs with the plugin test kit. Run: node --test examples/host-plugins/company-jwt.test.mjs
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { createPluginHarness, PluginRefusedError } from '@open-artifact/host-plugin/testing';
import plugin from './company-jwt.mjs';

const KEY = 'test-signing-key-0123456789abcdef';
const NOW = new Date('2026-01-01T00:00:00Z');
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
/** A token as the company's sign-in would make it (HS256). */
function mint(claims, key = KEY) {
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iss: 'https://login.corp.example', exp: NOW.getTime() / 1000 + 3600, ...claims })}`;
  return `${body}.${createHmac('sha256', key).update(body).digest('base64url')}`;
}
const withCookie = (token) => new Request('https://artifacts.corp.example/', { headers: { cookie: `theme=dark; corp_token=${token}` } });
const setup = () =>
  createPluginHarness(plugin, {
    config: { key: { env: 'CORP_JWT_KEY' }, issuer: 'https://login.corp.example', departments: { design: 'editor', sales: 'viewer' } },
    env: { CORP_JWT_KEY: KEY },
    now: NOW,
  });

test('a valid cookie signs the person in, with their department as a group', async () => {
  const h = setup();
  const identity = await h.authenticate(withCookie(mint({ sub: 'e1001', email: 'ann@corp.example', name: 'Ann', department: 'design' })));
  assert.deepEqual(identity, { subject: 'e1001', email: 'ann@corp.example', emailVerified: true, name: 'Ann', groups: ['dept:design'] });
});

test('no cookie, a forged token, another issuer or an expired token: nobody', async () => {
  const h = setup();
  assert.equal(await h.authenticate(new Request('https://artifacts.corp.example/')), null);
  assert.equal(await h.authenticate(withCookie(mint({ sub: 'e1001' }, 'a-guessed-key-0123456789abcdef'))), null);
  assert.equal(await h.authenticate(withCookie(mint({ sub: 'e1001', iss: 'https://evil.example' }))), null);
  assert.equal(await h.authenticate(withCookie(mint({ sub: 'e1001', exp: NOW.getTime() / 1000 - 3600 }))), null);
  assert.equal(h.logs.length, 3); // each refusal logged with its reason
});

test('only listed departments may sign in; other sign-in methods are left alone', async () => {
  const h = setup();
  assert.deepEqual(await h.identity({ subject: 'e2', groups: ['dept:legal'] }, 'plugin:company-jwt'), { reject: 'Your department does not use this site yet.' });
  assert.ok('identity' in (await h.identity({ subject: 'e1', groups: ['dept:sales'] }, 'plugin:company-jwt')));
  assert.ok('identity' in (await h.identity({ subject: 'owner' }, 'owner-key')));
});

test("each department's role, never lowering the site's own, cached for 5 minutes", async () => {
  const h = setup();
  const artifact = h.addArtifact();
  const bob = h.userPrincipal(h.addUser({ email: 'bob@corp.example' }), ['plugin:company-jwt:dept:design']);
  const cy = h.userPrincipal(h.addUser({ email: 'cy@corp.example' }), ['plugin:company-jwt:dept:sales']);
  assert.deepEqual(await h.role({ principal: bob, artifact, role: null }), { role: 'editor', cacheSeconds: 300 });
  assert.equal((await h.role({ principal: cy, artifact, role: null })).role, 'viewer');
  assert.equal((await h.role({ principal: cy, artifact, role: 'editor' })).role, 'editor');
  assert.equal((await h.role({ principal: { kind: 'anonymous' }, artifact, role: null })).role, null);
  const agent = { kind: 'agent', id: 'tok_1', label: 'laptop', user: bob };
  assert.equal((await h.role({ principal: agent, artifact, role: null })).role, 'editor');
});

test('public links are refused; other sharing is not', async () => {
  const h = setup();
  const principal = h.userPrincipal(h.addUser());
  assert.deepEqual(await h.guard('share.change', { principal, detail: { changes: { access: 'public' } } }), {
    allowed: false,
    reason: 'Public links are turned off here: share with people or departments instead.',
  });
  assert.deepEqual(await h.guard('share.change', { principal, detail: { changes: { access: 'link' } } }), { allowed: true });
  assert.deepEqual(await h.guard('artifact.export', { principal, detail: { format: 'zip' } }), { allowed: true });
});

test('/me tells a person their department', async () => {
  const h = setup();
  const principal = h.userPrincipal(h.addUser(), ['plugin:company-jwt:dept:design']);
  assert.deepEqual(await (await h.request('GET', '/me', { principal })).json(), { department: 'design' });
});

test('settings: one key source, and roles the host knows', () => {
  assert.throws(
    () => createPluginHarness(plugin, { config: { issuer: 'x', key: 'k', jwksUrl: 'https://x/jwks', departments: { ops: 'admin' } } }),
    (error) => error instanceof PluginRefusedError && error.problems.length === 2,
  );
});
