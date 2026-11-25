/**
 * Remote configuration against the real host: an install-time preset (`OPEN_ARTIFACT_REMOTE`, a Link refresh token,
 * `OPEN_ARTIFACT_PUBLISH=auto`) links the daemon and makes the remote the default; artifacts created from then on are
 * published by themselves in the background (the tool's answer does not wait and says so); one the person unpublished
 * is never published again by itself; a preset token is used once, even across restarts; a preset remote the person
 * removed is not added again.
 */

import { tempDir, until } from './helpers.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { artifactIdOf, type ArtifactRecord, type ToolCallResult } from '@open-artifact/protocol';
import type { UserRecord } from '../../host/src/core/types.ts';
import { LINK_ACCESS_TTL_MS, LINK_REFRESH_TTL_MS, LINK_SCOPE } from '../../host/src/core/link/services.ts';
import { startDaemon, type Daemon } from '../src/daemon.ts';
import { files } from '../src/paths.ts';
import type { CloudStatus, RemoteStatus } from '../src/link.ts';
import { RemotesFile } from '../src/remote.ts';
import { startRealHost, type RealHost } from './real-host.ts';

process.env.OPEN_ARTIFACT_LINK_RETRY_MS = '100';

const caller = { harness: 'dsh', session: 'cfg-1', workspace: tempDir('open-artifact-ws-') };

let real: RealHost;
let ada: UserRecord;
let token: string;
let tokenId: string;
let daemon: Daemon;

async function start(): Promise<Daemon> {
  return startDaemon({ port: 0, quiet: true, shellDir: tempDir('open-artifact-shell-'), homeDir: tempDir('open-artifact-no-home-') });
}

const tool = (name: string, args: Record<string, unknown>): Promise<ToolCallResult> => daemon.tools.call(name, args, caller);

async function create(title: string): Promise<{ result: ToolCallResult; id: string }> {
  const result = await tool('Artifact', { action: 'publish', type_url: 'open-artifact://type/whiteboard', title });
  assert.equal(result.error, undefined, JSON.stringify(result.error));
  return { result, id: artifactIdOf(String(result.url))! };
}

const record = (id: string): ArtifactRecord => daemon.store.require(id);

before(async () => {
  real = await startRealHost();
  ({ user: ada } = await real.person('Ada', 'ada@example.com'));
  ({ refreshToken: token, token: { id: tokenId } } = await real.host.catalog.issueAgentToken({ userId: ada.id, label: 'preset', scopes: [LINK_SCOPE], accessTtlMs: LINK_ACCESS_TTL_MS, refreshTtlMs: LINK_REFRESH_TTL_MS }));
  process.env.OPEN_ARTIFACT_REMOTE = real.app;
  process.env.OPEN_ARTIFACT_REMOTE_NAME = 'work';
  process.env.OPEN_ARTIFACT_REMOTE_TOKEN = token;
  process.env.OPEN_ARTIFACT_PUBLISH = 'auto';
});

after(async () => {
  daemon?.close();
  await real?.stop();
});

test('a preset adds the remote as the default and signs in with its token, with no browser', async () => {
  daemon = await start();
  const remotes = (): RemoteStatus[] => daemon.link.status();
  await until(() => remotes()[0]?.signedIn, 10_000);
  assert.equal(remotes().length, 1);
  assert.equal(remotes()[0]?.name, 'work');
  assert.equal(remotes()[0]?.host, real.app);
  assert.equal(remotes()[0]?.default, true);
  assert.equal(remotes()[0]?.preset, true);
  assert.equal(remotes()[0]?.user?.email, 'ada@example.com');
  assert.equal(daemon.settings.cloud?.default, 'work');
  // From the environment: settings.json does not set it.
  assert.equal(daemon.settings.cloud?.publish, 'auto');
  // The token itself is not kept, only its hash, and never written to the log.
  const stored = new RemotesFile().get('work')!;
  assert.notEqual(stored.presetToken, token);
  assert.equal(stored.presetToken?.length, 64);
  assert.ok(!readFileSync(join(files.logs(), 'daemon.log'), 'utf8').includes(token), 'the token is not in the log');
});

test('auto: a new artifact is published in the background; the result says so and keeps the local view_url', async () => {
  const { result, id } = await create('Auto one');
  assert.equal(result.view_url, daemon.viewUrl(id));
  assert.match(String(result.view_url), /^http:\/\/127\.0\.0\.1:/);
  assert.ok((result.notes as string[] | undefined)?.some((n) => /being published to .* by itself/.test(n)), JSON.stringify(result.notes));
  await until(() => record(id).remote, 10_000);
  assert.equal(record(id).remote?.name, 'work');
  assert.equal(record(id).autoPublish, null);
  assert.ok(await real.host.catalog.getArtifact(id));
  // Now the cloud address.
  const read = await tool('Artifact', { action: 'read', url: `open-artifact://artifact/${id}` });
  assert.equal(read.view_url, `${real.app}/a/${id}`);
});

test('an artifact the person unpublished is never published by itself again', async () => {
  const { id } = await create('Taken off');
  await until(() => record(id).remote, 10_000);
  await daemon.link.unpublish(record(id));
  assert.equal(record(id).autoPublish, 'off');
  const wrote = await tool('Artifact', { action: 'publish', url: `open-artifact://artifact/${id}`, files: [{ path: 'notes.txt', content: 'still here' }] });
  assert.equal(wrote.error, undefined, JSON.stringify(wrote.error));
  await new Promise((done) => setTimeout(done, 400));
  assert.equal(record(id).remote ?? null, null);
  assert.equal(daemon.link.cloudStatus().pending.length, 0);
});

test('artifacts made before auto was turned on are left alone; turning it off and on is a person\'s act', async () => {
  daemon.link.setCloud({ publish: 'manual' });
  assert.equal(daemon.settings.cloud?.publish, 'manual');
  const { result, id } = await create('Made by hand');
  assert.equal(result.notes, undefined);
  const status: CloudStatus = daemon.link.setCloud({ publish: 'auto' });
  assert.equal(status.publish, 'auto');
  assert.equal(status.default, 'work');
  await new Promise((done) => setTimeout(done, 400));
  assert.equal(record(id).remote ?? null, null);
  assert.equal(record(id).autoPublish, undefined);
});

test('the default remote: an unknown name is refused; the only remote cannot be cleared, it is always the default', () => {
  assert.throws(() => daemon.link.setCloud({ default: 'nope' }), /No remote nope/);
  assert.throws(() => daemon.link.setCloud({ default: null }), (error: Error & { fix?: string }) => {
    assert.match(error.message, /work is the only remote, so it is always the default/);
    assert.match(String(error.fix), /remote auto off/);
    return true;
  });
  assert.equal(daemon.settings.cloud?.default, 'work');
  assert.equal(daemon.link.defaultRemote(), 'work');
  assert.equal(daemon.link.cloudStatus().default, 'work');
});

test('after a restart the preset token is not sent again, and the remote is not added twice', async () => {
  daemon.close();
  daemon = await start();
  await until(() => daemon.link.status()[0]?.connected, 10_000);
  assert.equal(daemon.link.status().length, 1);
  // The rotating refresh token was used once: had it been sent again, the host would have revoked the sign-in.
  assert.equal((await real.host.catalog.getAgentToken(tokenId))?.revokedAt, null);
  const { id } = await create('After restart');
  await until(() => record(id).remote, 10_000);
});

test('a preset remote the person removed is not added again', async () => {
  for (const r of daemon.store.list()) if (r.remote) await daemon.link.unpublish(r);
  const removed = daemon.link.removeRemote('work', true);
  assert.equal(daemon.settings.cloud?.default, undefined);
  // Automatic publishing went to that site, and no other is left: it is turned off, as the person's choice (a preset's
  // `auto` does not turn it back on), so the next site connected does not start receiving every new artifact.
  assert.equal(removed.autoPublishOff, true);
  assert.equal(daemon.settings.cloud?.publish, 'manual');
  daemon.close();
  daemon = await start();
  await new Promise((done) => setTimeout(done, 300));
  assert.equal(daemon.link.status().length, 0);
});

test('without a token: an approval link in status and once in tool messages; failures retry, then publish once approved', async () => {
  daemon.close();
  // A fresh address (the removed one is remembered), with no token: a second host (a host answers only on its own
  // name, so another name for the first one would not do).
  const lanHost = await startRealHost();
  after(() => lanHost.stop());
  process.env.OPEN_ARTIFACT_REMOTE = lanHost.app;
  process.env.OPEN_ARTIFACT_REMOTE_NAME = 'lan';
  delete process.env.OPEN_ARTIFACT_REMOTE_TOKEN;
  daemon = await start();
  // Removing the last site turned automatic publishing off (the test before); the person turns it on again.
  assert.equal(daemon.link.cloudStatus().publish, 'manual');
  daemon.link.setCloud({ publish: 'auto' });
  const approval = await until(() => daemon.link.status().find((r) => r.name === 'lan')?.approval, 10_000);
  assert.match(approval.verification_uri_complete, /\/link\/device\?/);
  assert.equal(daemon.link.defaultRemote(), 'lan');

  const { result, id } = await create('Waits for approval');
  const told = (result.messages as string[] | undefined) ?? [];
  assert.ok(told.some((m) => m.includes(approval.verification_uri_complete)), JSON.stringify(told));
  // The publish fails (not signed in): kept, retried, and told to the agent once.
  await until(() => daemon.link.cloudStatus().pending.find((p) => p.id === id)?.lastError, 10_000);
  const next = await tool('Artifact', { action: 'read', url: `open-artifact://artifact/${id}` });
  const messages = (next.messages as string[] | undefined) ?? [];
  assert.ok(messages.some((m) => m.includes('could not be published')), JSON.stringify(messages));
  assert.ok(!messages.some((m) => m.includes(approval.verification_uri_complete)), 'the approval link is said once');
  const again = await tool('Artifact', { action: 'read', url: `open-artifact://artifact/${id}` });
  assert.ok(!((again.messages as string[] | undefined) ?? []).some((m) => m.includes('could not be published')), 'a failure is said once');

  const cookie = (await lanHost.person('Ada again', 'ada2@example.com')).cookie;
  const decided = await lanHost.decide(cookie, approval.user_code);
  assert.ok(decided.status < 400, `approval answered ${decided.status}`);
  await until(() => daemon.link.status().find((r) => r.name === 'lan')?.signedIn, 10_000);
  await until(() => record(id).remote, 10_000);
  assert.equal(record(id).remote?.name, 'lan');
  assert.equal(daemon.link.cloudStatus().pending.length, 0);
});
