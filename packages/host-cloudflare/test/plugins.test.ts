/**
 * Host plugins on Cloudflare (`plugins.ts`): `OA_PLUGINS` matched to the modules bundled into the Worker, the
 * sentence for one that is not bundled, starting them over D1 with invalidation reaching this isolate and the rooms,
 * and the hub's registry of awake rooms that "forget every role" reaches.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Catalog, PluginConfigError, type HostConfig } from '@open-artifact/host';
import { d1Driver, ensureMigrated } from '../src/d1.ts';
import { HUB_CALL_HEADER, SiteHub } from '../src/hub.ts';
import { bundledPluginList, missingModuleMessage, startCloudflarePlugins } from '../src/plugins.ts';
import { fakeD1 } from './d1-fake.ts';

const KEYS = ['s'.repeat(40)];
const config: HostConfig = {
  appOrigin: 'http://localhost:8787',
  contentOrigin: 'http://{id}.content.localhost:8787',
  signingKeys: KEYS,
  auth: [{ kind: 'owner-key' }],
  owners: [],
  signup: 'invite',
  linkMaxRole: 'editor',
  publicAccess: true,
};

const groups = { id: 'groups', apiVersion: 1, authz: { role: () => 'viewer' }, routes: [{ method: 'POST', path: '/forget', public: true, handler: async (_input: unknown, ctx: { host: { access: { invalidate(id?: string): Promise<void> } } }) => { await ctx.host.access.invalidate(); return new Response('ok'); } }] };

async function catalog(): Promise<Catalog> {
  const driver = d1Driver(fakeD1());
  await ensureMigrated(driver, {});
  return new Catalog(driver, { signingKeys: KEYS });
}

test('OA_PLUGINS entries are matched to the bundled modules by "use" (a module namespace counts as its default)', () => {
  assert.deepEqual(bundledPluginList({}, { groups }), []);
  const list = bundledPluginList({ OA_PLUGINS: '[{"use":"groups"},{"use":"ns"},{"use":"missing","optional":true}]' }, { groups, ns: { default: groups } });
  assert.equal(list[0]!.plugin, groups);
  assert.equal(list[1]!.plugin, groups);
  assert.equal(list[2]!.loadError, 'it is not bundled into this Worker: add it to deploy/cloudflare/plugins.mjs as "missing" and build again (bundled: "groups", "ns")');
  assert.equal(missingModuleMessage('x', {}), 'it is not bundled into this Worker: add it to deploy/cloudflare/plugins.mjs as "x" and build again (bundled: none)');
  // A build from another module (OA_PLUGINS_MODULE) names that file.
  assert.match(missingModuleMessage('x', {}, '/srv/site/plugins.mjs'), /add it to \/srv\/site\/plugins\.mjs as "x"/);
  assert.match(bundledPluginList({ OA_PLUGINS: '[{"use":"x"}]' }, {}, 'ops/plugins.mjs')[0]!.loadError ?? '', /add it to ops\/plugins\.mjs/);
});

test('a list naming a module that is not bundled stops the site; an empty list starts nothing', async () => {
  const cat = await catalog();
  const none = startCloudflarePlugins({ vars: {}, modules: {}, catalog: cat, config, version: 't', log: () => undefined });
  assert.deepEqual(none, { registry: null, active: undefined });
  assert.throws(() => startCloudflarePlugins({ vars: { OA_PLUGINS: '[{"use":"acme"}]' }, modules: {}, catalog: cat, config, version: 't', log: () => undefined }), (error: unknown) => {
    assert.ok(error instanceof PluginConfigError);
    assert.match(error.message, /The plugin "acme" could not be loaded: it is not bundled into this Worker/);
    return true;
  });
});

test('ctx.host.access.invalidate moves the site generation, forgets this isolate\'s answers and asks the rooms to refresh', async () => {
  const cat = await catalog();
  const forgot: Array<string | undefined> = [];
  const refreshed: Array<string | undefined> = [];
  const started = startCloudflarePlugins({
    vars: { OA_PLUGINS: '[{"use":"groups"}]' },
    modules: { groups },
    catalog: cat,
    config,
    version: 't',
    log: () => undefined,
    forgetHere: (id) => void forgot.push(id),
    refresh: async (id) => void refreshed.push(id),
  });
  assert.ok(started.active?.hasRoleHook);
  const before = await cat.accessStamp();
  const answer = await started.active!.route(new Request('http://localhost:8787/plugins/groups/forget', { method: 'POST', body: '' }), async () => ({ kind: 'anonymous' }));
  assert.equal(answer?.status, 200);
  const after = await cat.accessStamp();
  assert.ok(after.generation > before.generation);
  assert.deepEqual([forgot, refreshed], [[undefined], [undefined]]);
});

test('the hub keeps the awake rooms and refreshes each when every role is forgotten; a room that forgets leaves', async () => {
  const cat = await catalog();
  const asked: string[] = [];
  const hub = new SiteHub({ config, catalog: async () => cat, log: () => undefined, linkFeed: false, refreshRoom: async (room) => void asked.push(room) });
  const call = (path: string, body: unknown) => hub.fetch(new Request(`http://hub.internal/${path}`, { method: 'POST', headers: { [HUB_CALL_HEADER]: '1', 'content-type': 'application/json' }, body: JSON.stringify(body) }));
  assert.equal((await call('rooms/awake', { room: 'art-a' })).status, 200);
  assert.equal((await call('rooms/awake', { room: 'art-b' })).status, 200);
  assert.equal(hub.stats().awakeRooms, 2);
  const refreshed = await call('rooms/refresh', {});
  assert.deepEqual(await refreshed.json(), { rooms: 2 });
  assert.deepEqual(asked.sort(), ['art-a', 'art-b']);
  await call('presence/forget', { room: 'art-a' });
  assert.equal(hub.stats().awakeRooms, 1);
});
