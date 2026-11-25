/**
 * The compatibility promise of plugin API version 1 (decision 48): a plugin written today keeps working when the host
 * adds input fields, context members, events and hooks. The fixture below is frozen: never edit it to make a test
 * pass. If it stops working, the change broke version 1.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkPlugin } from '../src/contract.ts';
import { createPluginHarness } from '../src/testing.ts';

// ---- Frozen: a version-1 plugin as written on 2026-11-22. Do not edit. ----
const V1_PLUGIN = Object.freeze({
  id: 'frozen-v1',
  apiVersion: 1,
  name: 'Frozen v1',
  config: { domain: { type: 'string', default: 'example.com' } },
  auth: {
    authenticate({ request }: { request: Request }) {
      const email = request.headers.get('x-email');
      return email ? { subject: email, email, emailVerified: true } : null;
    },
    identity({ identity }: { identity: { subject: string; email?: string } }, ctx: { config: { domain: string } }) {
      if (!identity.email?.endsWith(`@${ctx.config.domain}`)) return { reject: 'Wrong domain.' };
      return undefined;
    },
  },
  authz: {
    role({ principal, role }: { principal: { kind: string; email?: string }; role: string | null }) {
      if (principal.kind !== 'user') return undefined;
      return role ?? 'viewer';
    },
  },
  guard({ action }: { action: string }) {
    if (action === 'artifact.delete') return { deny: 'Nothing is deleted here.' };
    return undefined;
  },
  on: {
    async 'share.invited'(event: { invitee: { email?: string } }, ctx: { kv: { set(k: string, v: unknown): Promise<void> } }) {
      await ctx.kv.set(`invited:${event.invitee.email}`, true);
    },
  },
  routes: [{ method: 'GET', path: '/ping', handler: () => new Response('pong') }],
});
// ---- End of the frozen fixture. ----

test('the frozen v1 plugin still checks and runs', async () => {
  const checked = checkPlugin(V1_PLUGIN, 'frozen');
  assert.deepEqual(checked.errors, []);
  assert.deepEqual(checked.warnings, []);
  const h = createPluginHarness(V1_PLUGIN);
  assert.deepEqual(await h.authenticate(new Request('https://x.test/', { headers: { 'x-email': 'ann@example.com' } })), { subject: 'ann@example.com', email: 'ann@example.com', emailVerified: true });
  assert.deepEqual(await h.identity({ subject: 'x', email: 'x@other.test' }), { reject: 'Wrong domain.' });
  const user = h.userPrincipal(h.addUser({ email: 'ann@example.com' }));
  assert.equal((await h.role({ principal: user, artifact: h.addArtifact(), role: null })).role, 'viewer');
  assert.deepEqual(await h.guard('artifact.delete', { principal: user, detail: { permanent: false } }), { allowed: false, reason: 'Nothing is deleted here.' });
  assert.equal(await (await h.request('GET', '/ping')).text(), 'pong');
});

test('extra input fields, an unknown principal kind, an unknown guard action and extra ctx members change nothing', async () => {
  const h = createPluginHarness<{ domain: string }>(V1_PLUGIN);
  const user = { ...h.userPrincipal(h.addUser({ email: 'ann@example.com' })), department: 'R&D', mfa: true };
  const artifact = { ...h.addArtifact(), workspace: 'w1', labels: ['x'] };

  // Inputs with fields a later host adds.
  assert.equal((await h.role({ principal: user, artifact, role: 'editor', reason: 'share' } as Parameters<typeof h.role>[0])).role, 'editor');
  assert.deepEqual(await h.identity({ subject: 's', email: 'a@example.com', locale: 'en' } as Parameters<typeof h.identity>[0]), { identity: { subject: 's', email: 'a@example.com' } });
  // A principal kind a later host adds: the plugin has no opinion.
  assert.equal((await h.role({ principal: { kind: 'service', id: 'svc' } as unknown as Parameters<typeof h.role>[0]['principal'], artifact, role: null })).role, null);
  // A guard action a later host adds: allowed.
  assert.deepEqual(await h.guard('artifact.rename' as 'artifact.export', { principal: user, detail: { format: 'x', newTitle: 'y' } as never }), { allowed: true });
  // An event payload with more fields.
  await h.emit('share.invited', { artifact: { id: artifact.id, type: 'slides', title: 'T', owner: 'o' }, by: { kind: 'user', id: 'u' }, invitee: { email: 'bo@example.com', team: 'x' } as never, role: 'viewer', url: 'https://x.test/a', priority: 'high' } as never);
  assert.deepEqual(h.kv.dump(), { 'invited:bo@example.com': true });

  // Hooks called with a context that has members a later host adds.
  const ctx = { ...h.ctx, newMember: { anything: true }, host: { ...h.ctx.host, newService: () => 1 } };
  assert.deepEqual(await V1_PLUGIN.auth.identity({ identity: { subject: 's', email: 'a@other.test' } }, ctx), { reject: 'Wrong domain.' });
  await V1_PLUGIN.on['share.invited']({ invitee: { email: 'cy@example.com' } }, ctx);
  assert.equal(await h.kv.get('invited:cy@example.com'), true);
  assert.deepEqual(h.failures, []);
});

test('a plugin written for a later version-1 host (with hooks this host does not know) still runs what it knows', async () => {
  const later = { ...V1_PLUGIN, id: 'later-v1', comments: { onCreate: () => undefined }, on: { ...V1_PLUGIN.on, 'comment.created': () => undefined } };
  const h = createPluginHarness(later);
  assert.deepEqual(h.warnings, [
    'Plugin "later-v1": unknown "comments" ignored (this host does not know it).',
    'Plugin "later-v1": unknown event "comment.created" ignored (this host does not send it).',
  ]);
  assert.equal(await (await h.request('GET', '/ping')).text(), 'pong');
});
