/**
 * `embed.remote` and `allowRemote`: what a host does with a remote type's page (`host.open`'s `remote`).
 * `deny` answers not-opened without calling `open`; `ask` (the default) keeps a yes per origin for the process, asks
 * again after a no, and no callback means no; `allow` passes. The policy goes out in `hello` (`caps.open.remote`).
 */

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { artifactUrl } from '@open-artifact/protocol';
import { createHarness, remoteGate, remotePolicyOf, type HarnessOptions, type OpenRequest, type RemotePageRequest } from '../src/index.ts';
import { startFakeDaemon, type FakeDaemon } from '../src/testing.ts';

const open: Array<{ close(): unknown }> = [];
after(async () => {
  for (const item of open.reverse()) await item.close();
});

async function setUp(options: Partial<HarnessOptions>): Promise<{ daemon: FakeDaemon; opened: OpenRequest[] }> {
  const daemon = await startFakeDaemon();
  open.push(daemon);
  const opened: OpenRequest[] = [];
  const h = await createHarness({ harness: 'remote-host', home: daemon.home, autoStart: false, reconnect: { minMs: 20, maxMs: 100 }, open: (request) => void opened.push(request), ...options });
  open.unshift(h);
  return { daemon, opened };
}

const FAR = { type: 'far', origins: ['https://types.example.com'] };

test('remoteGate: allow, deny, ask (remembered per origin, no callback is no, a throw is no and asked again)', async () => {
  assert.equal(await remoteGate('deny')(null), true, 'a local page always passes');
  assert.equal(await remoteGate('allow')(FAR), true);
  assert.equal(await remoteGate('deny', () => true)(FAR), false);
  assert.equal(await remoteGate('ask')(FAR), false, 'nobody to ask: no');

  const asked: RemotePageRequest[] = [];
  const gate = remoteGate('ask', (request) => (asked.push(request), request.origin === 'https://types.example.com'));
  assert.equal(await gate(FAR, 'Deck'), true);
  assert.equal(await gate(FAR, 'Deck 2'), true);
  assert.deepEqual(asked, [{ origin: 'https://types.example.com', type: 'far', title: 'Deck' }], 'asked once for the origin');
  assert.equal(await gate({ type: 'far', origins: ['https://types.example.com', 'https://cdn.example.net'] }), false, 'every origin must be allowed');
  assert.equal(asked.length, 2);
  assert.equal(await gate({ type: 'far', origins: ['https://cdn.example.net'] }), false);
  assert.equal(asked.length, 3, 'a no is not kept: asked again');

  // Declined once, allowed the next time.
  let yes = false;
  const changing = remoteGate('ask', () => yes);
  assert.equal(await changing(FAR), false);
  yes = true;
  assert.equal(await changing(FAR), true, 'the person may change their mind');
  yes = false;
  assert.equal(await changing(FAR), true, 'a yes is kept');

  let tries = 0;
  const flaky = remoteGate('ask', () => {
    tries++;
    if (tries === 1) throw new Error('dialog failed');
    return true;
  });
  assert.equal(await flaky(FAR), false);
  assert.equal(await flaky(FAR), true, 'a failed question is asked again');

  assert.equal(remotePolicyOf('allow'), 'allow');
  assert.equal(remotePolicyOf(undefined), 'ask');
  assert.equal(remotePolicyOf('bogus'), 'ask');
});

test('hello says the policy: ask by default, the one given otherwise', async () => {
  const { daemon } = await setUp({ embed: { origins: ['app://host'] } });
  assert.deepEqual((daemon.hellos[0]!.caps as { open: unknown }).open, { embed: 'frame', origins: ['app://host'], remote: 'ask' });
  const denied = await setUp({ embed: { origins: ['app://host'], remote: 'deny' } });
  assert.equal((denied.daemon.hellos[0]!.caps as { open: { remote: string } }).open.remote, 'deny');
});

test('host.open: deny answers not-opened without calling open; a local page still opens', async () => {
  const { daemon, opened } = await setUp({ embed: { origins: ['app://host'], remote: 'deny' } });
  assert.deepEqual(await daemon.open({ url: artifactUrl('a1'), title: 'Far', remote: FAR }), { opened: false });
  assert.equal(opened.length, 0);
  assert.deepEqual(await daemon.open({ url: artifactUrl('a2'), title: 'Near' }), { opened: true });
  assert.equal(opened[0]!.remote, undefined);
});

test('host.open: ask calls allowRemote once per origin and passes the origins to open; no callback is no', async () => {
  const asked: RemotePageRequest[] = [];
  const { daemon, opened } = await setUp({ embed: { origins: ['app://host'] }, allowRemote: (request) => (asked.push(request), true) });
  assert.deepEqual(await daemon.open({ url: artifactUrl('a1'), title: 'Far', remote: FAR }), { opened: true });
  assert.deepEqual(await daemon.open({ url: artifactUrl('a3'), title: 'Far again', remote: FAR }), { opened: true });
  assert.deepEqual(asked, [{ origin: 'https://types.example.com', type: 'far', title: 'Far' }]);
  assert.deepEqual(opened[0]!.remote, FAR);

  const silent = await setUp({ embed: { origins: ['app://host'] } });
  assert.deepEqual(await silent.daemon.open({ url: artifactUrl('a1'), remote: FAR }), { opened: false });
  assert.equal(silent.opened.length, 0);
});

test('host.open: allow passes straight through', async () => {
  const { daemon, opened } = await setUp({ embed: { origins: ['app://host'], remote: 'allow' }, allowRemote: () => assert.fail('not asked under allow') });
  assert.deepEqual(await daemon.open({ url: artifactUrl('a1'), remote: FAR }), { opened: true });
  assert.deepEqual(opened[0]!.remote, FAR);
});
