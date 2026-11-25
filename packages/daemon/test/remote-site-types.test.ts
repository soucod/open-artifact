/**
 * Publishing a type of this computer to a site's catalog, and artifacts of it, against the real Node host
 * (`real-host.ts`): `types.publish` (packed with the `--for-share` checks), an artifact refused until its type is
 * there, `publish --with-type` on a fresh type, the person-only rules, and `types.unpublish`.
 */

import { tempDir, until } from './helpers.ts';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { LIBRARY_ROUTES, artifactIdOf, type DaemonState, type ShellBoot, type ToolCallResult, type TypesPublishResponse, type TypesUnpublishResponse } from '@open-artifact/protocol';
import type { UserRecord } from '../../host/src/core/types.ts';
import type { RunningHost } from '../../host/src/node/host.ts';
import { api, readDaemon } from '../src/client.ts';
import { startDaemon, type Daemon } from '../src/daemon.ts';
import { call, startRealHost, type RealHost } from './real-host.ts';

process.env.OPEN_ARTIFACT_LINK_RETRY_MS = '100';
process.env.OPEN_ARTIFACT_LINK_RESCAN_MS = '0';

let real: RealHost;
let host: RunningHost;
let ada: UserRecord;
let adaCookie: string;
let daemon: Daemon;
let state: DaemonState;

const shellDir = tempDir('open-artifact-shell-');
const caller = { harness: 'dsh', session: 'types-1', workspace: tempDir('open-artifact-ws-') };
const AGENT = { 'X-Open-Artifact-Agent': 'dsh session types-1' };

type Refusal = { code?: string; message?: string; fix?: string };

before(async () => {
  real = await startRealHost({ OA_TYPES_PUBLISH: 'members' });
  host = real.host;
  ({ user: ada, cookie: adaCookie } = await real.person('Ada', 'ada@example.com'));
  daemon = await startDaemon({ port: 0, quiet: true, shellDir, homeDir: join(shellDir, 'no-home') });
  state = (await readDaemon())!;
  const start = await api<{ user_code: string }>(state, 'remotes.add', { name: 'cloud', host: real.app });
  assert.equal((await real.decide(adaCookie, start.user_code)).status, 200);
  const done = await api<{ status: string }>(state, 'remotes.add.wait', { name: 'cloud', ms: 20_000 });
  assert.equal(done.status, 'done', JSON.stringify(done));
});

after(async () => {
  daemon?.close();
  await real?.stop();
});

const tool = (name: string, args: Record<string, unknown>): Promise<ToolCallResult> => api<ToolCallResult>(state, 'tools.call', { name, arguments: args, caller });

/** A new user type (`types new`), and an artifact of it. */
async function typeAndArtifact(id: string): Promise<string> {
  const made = await api<Refusal & { id?: string }>(state, LIBRARY_ROUTES.typesNew, { id, scope: 'user', name: `Poll ${id}` });
  assert.equal(made.code, undefined, JSON.stringify(made));
  const art = await tool('Artifact', { action: 'publish', type_url: `open-artifact://type/${id}`, title: `A ${id}` });
  assert.equal(art.error, undefined, JSON.stringify(art.error));
  return artifactIdOf(String(art.url))!;
}

let poll = '';

test('an artifact of a type the site does not have is refused, naming the type and the commands', async () => {
  poll = await typeAndArtifact('poll');
  const out = await api<Refusal>(state, 'artifacts.publish', { id: poll, remote: 'cloud' });
  assert.equal(out.code, 'type_missing', JSON.stringify(out));
  assert.match(out.message ?? '', /poll/);
  assert.match(out.fix ?? '', /open-artifact types publish poll --remote cloud/);
  assert.match(out.fix ?? '', /--with-type/);
  assert.equal(await host.catalog.getArtifact(poll), undefined, 'nothing was kept on the site');
});

test('types publish is the person’s: refused inside an agent session; with-type too', async () => {
  const typed = await api<Refusal>(state, LIBRARY_ROUTES.typesPublish, { id: 'poll', remote: 'cloud' }, { headers: AGENT });
  assert.equal(typed.code, 'not_granted');
  const off = await api<Refusal>(state, LIBRARY_ROUTES.typesUnpublish, { id: 'poll', remote: 'cloud' }, { headers: AGENT });
  assert.equal(off.code, 'not_granted');
  const withType = await api<Refusal>(state, 'artifacts.publish', { id: poll, remote: 'cloud', withType: true }, { headers: AGENT });
  assert.equal(withType.code, 'not_granted');
  assert.equal(host.rooms.siteTypes?.row('poll'), undefined, 'nothing reached the site');
});

test('types publish packs the type and puts it in the site’s catalog; the artifact then publishes and runs there', async () => {
  const out = await api<TypesPublishResponse & Refusal>(state, LIBRARY_ROUTES.typesPublish, { id: 'poll', remote: 'cloud' });
  assert.equal(out.code, undefined, JSON.stringify(out));
  assert.equal(out.change, 'new');
  assert.equal(out.remote, 'cloud');
  assert.equal(out.type.id, 'poll');
  assert.equal(out.type.visibility, 'private');
  assert.equal(out.type.publisher.id, ada.id);
  const local = daemon.types.get('poll')!;
  assert.equal(out.type.uid, local.uid);
  // The same bytes again change nothing.
  const again = await api<TypesPublishResponse>(state, LIBRARY_ROUTES.typesPublish, { id: 'poll', remote: 'cloud' });
  assert.equal(again.change, 'unchanged');

  const published = await api<Refusal & { view_url?: string }>(state, 'artifacts.publish', { id: poll, remote: 'cloud' });
  assert.equal(published.code, undefined, JSON.stringify(published));
  assert.equal(published.view_url, `${real.app}/a/${poll}`);
  assert.equal((await host.catalog.getArtifact(poll))?.type, 'poll');
  // The site runs it on its frame engine: the Shell frames the page host's address, which carries no page token.
  const answer = await call(real.port, 'GET', `${real.app}/api/open-artifact.artifacts.boot?id=${poll}`, { cookie: adaCookie });
  assert.equal(answer.status, 200, answer.body);
  const boot = JSON.parse(answer.body) as ShellBoot;
  assert.ok(boot.pageUrl, 'a page address');
  assert.notEqual(new URL(boot.pageUrl).host, new URL(real.app).host, 'the page runs on its own host');
  assert.match(new URL(boot.pageUrl).pathname, /^\/page\//, 'served as a page, its type id not in the address');
  const session = await call(real.port, 'GET', `${boot.pageUrl}api/frame/session`);
  assert.equal(session.status, 200, session.body);
  const { contentOrigin, ver } = JSON.parse(session.body) as { contentOrigin: string; ver: string };
  assert.notEqual(new URL(contentOrigin).host, new URL(real.app).host);
  const index = await call(real.port, 'GET', `${contentOrigin}/_f/${ver}/`);
  assert.equal(index.status, 200, index.body.slice(0, 300));
  assert.match(String(index.headers['content-security-policy'] ?? ''), /default-src/);
});

test('a built-in or installed type is never published to a site; nor one of a page type', async () => {
  const builtin = await api<Refusal>(state, LIBRARY_ROUTES.typesPublish, { id: 'docs', remote: 'cloud' });
  assert.equal(builtin.code, 'invalid_argument');
  assert.match(builtin.message ?? '', /built in/);
});

test('publish --with-type sends a fresh type first, with link visibility', async () => {
  const fresh = await typeAndArtifact('tally');
  const out = await api<Refusal & { view_url?: string }>(state, 'artifacts.publish', { id: fresh, remote: 'cloud', withType: true });
  assert.equal(out.code, undefined, JSON.stringify(out));
  assert.equal((await host.catalog.getArtifact(fresh))?.type, 'tally');
  const row = host.rooms.siteTypes?.row('tally');
  assert.equal(row?.visibility, 'link');
  assert.equal(row?.publisherUser, ada.id);
});

test('types unpublish delists a type its artifacts still use; they keep opening', async () => {
  const out = await api<TypesUnpublishResponse & Refusal>(state, LIBRARY_ROUTES.typesUnpublish, { id: 'poll', remote: 'cloud' });
  assert.equal(out.code, undefined, JSON.stringify(out));
  assert.equal(out.removed, false);
  assert.equal(out.artifacts, 1);
  await until(() => host.rooms.siteTypes?.row('poll')?.unpublished === true);
  // A new artifact of it is refused now, naming how to publish the type again.
  const second = await tool('Artifact', { action: 'publish', type_url: 'open-artifact://type/poll', title: 'Another poll' });
  const id = artifactIdOf(String(second.url))!;
  const refused = await api<Refusal>(state, 'artifacts.publish', { id, remote: 'cloud' });
  assert.equal(refused.code, 'not_granted', JSON.stringify(refused));
  assert.match(refused.fix ?? '', /types publish poll --remote cloud/);
});

test('a page artifact\'s capabilities travel both ways with the real host', async () => {
  const made = await tool('Artifact', { action: 'publish', type_url: 'open-artifact://type/page', title: 'Real page', open: 'never', capabilities: { db: true } });
  assert.equal(made.error, undefined, JSON.stringify(made.error));
  const id = artifactIdOf(String(made.url))!;
  await tool('Artifact', { action: 'publish', url: made.url, files: { 'index.html': '<!doctype html><title>Real page</title><p>hi</p>' } });
  const out = await api<Refusal & { view_url?: string }>(state, 'artifacts.publish', { id, remote: 'cloud' });
  assert.equal(out.code, undefined, JSON.stringify(out));
  assert.deepEqual(await host.link.pages!.capabilities(id), { db: true }, 'the zip carried them');
  // The agent changes them here: they reach the site.
  const changed = await tool('Artifact', { action: 'publish', url: made.url, capabilities: { db: true, identity: true } });
  assert.equal(changed.error, undefined, JSON.stringify(changed.error));
  await until(async () => ((await host.link.pages!.capabilities(id)) as { identity?: unknown } | null)?.identity === true);
  // Changed on the site (not by the Link): they come home into the record.
  await host.link.pages!.setCapabilities(id, { comments: true }, 'site-test');
  await until(() => (daemon.store.require(id).capabilities as { comments?: unknown } | undefined)?.comments === true);
  assert.deepEqual(daemon.store.require(id).capabilities, { comments: true });
});
