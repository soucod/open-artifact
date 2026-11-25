/**
 * Live data of a published Data dashboard, end to end: a real daemon linked to a real Node host (both in this process,
 * over real HTTP) and the fake sales connector (`test-artifacts/test-connectors.mjs`). The person publishes the
 * `sales-and-signups` dashboard; a publish without the person's confirmation (`data: true`) puts no rows on the host,
 * the confirmation does; the daemon runs its live queries here and
 * pushes the answers; a viewer's page on the host reads them. The connector's answer changes and the owner's page asks
 * for a refresh: the rows and their time move. With the daemon stopped the request waits, and is honoured once when it
 * is back.
 */

import { TEST_HOME, tempDir, until } from './helpers.ts';
import assert from 'node:assert/strict';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { DaemonState, ShellBoot } from '@open-artifact/protocol';
import type { UserRecord } from '../../host/src/core/types.ts';
import type { RunningHost } from '../../host/src/node/host.ts';
import { api, readDaemon } from '../src/client.ts';
import { startDaemon, type Daemon } from '../src/daemon.ts';
import type { DataPublishStatus } from '../src/data-refresh.ts';
import { call, startRealHost, type Answer, type RealHost } from './real-host.ts';
// @ts-expect-error A plain script of the repo's test artifacts, without types.
import { writeTestConnectors } from '../../../test-artifacts/test-connectors.mjs';

const repo = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const bonusFile = join(tempDir('open-artifact-sales-bonus-'), 'bonus');
writeFileSync(bonusFile, '0');
process.env.SALES_MCP_BONUS_FILE = bonusFile;
process.env.OPEN_ARTIFACT_CONNECTORS = (writeTestConnectors as (state: string) => string)(tempDir('open-artifact-connectors-'));
process.env.OPEN_ARTIFACT_LINK_RETRY_MS = '100';
process.env.OPEN_ARTIFACT_LINK_RESCAN_MS = '0';

let real: RealHost;
let host: RunningHost;
let port: number;
let app: string;
let ada: UserRecord;
let adaCookie: string;
let bobCookie: string;
let daemon: Daemon;
let state: DaemonState;
let dash = '';
let adaPage = '';
let bobPage = '';

const shellDir = tempDir('open-artifact-shell-');

async function bootDaemon(): Promise<void> {
  daemon = await startDaemon({ port: 0, quiet: true, shellDir, homeDir: join(shellDir, 'no-home') });
  state = (await readDaemon())!;
}

before(async () => {
  real = await startRealHost();
  ({ host, port, app } = real);
  ({ user: ada, cookie: adaCookie } = await real.person('Ada', 'ada@example.com'));
  ({ cookie: bobCookie } = await real.person('Bob', 'bob@example.com'));
  await bootDaemon();
});

after(async () => {
  if (process.env.DEBUG_DATA) process.stderr.write(readFileSync(join(TEST_HOME, 'logs', 'daemon.log'), 'utf8'));
  daemon?.close();
  await real?.stop();
});

const waitFor = <T>(check: () => T | Promise<T>, ms = 20_000): Promise<NonNullable<T>> => until(check, ms);

async function asPerson(cookie: string, method: string, path: string, body?: unknown): Promise<Answer> {
  const write = method !== 'GET';
  return call(port, method, app + path, { cookie, ...(write ? { origin: app, 'content-type': 'application/json' } : {}) }, body === undefined ? undefined : JSON.stringify(body));
}

async function page<T>(pageUrl: string, route: string, body?: unknown): Promise<{ status: number; body: T }> {
  const answer = await call(port, body === undefined ? 'GET' : 'POST', `${pageUrl}_api/${route}`, body === undefined ? {} : { 'content-type': 'application/json' }, body === undefined ? undefined : JSON.stringify(body));
  let parsed: unknown = answer.body;
  try {
    parsed = JSON.parse(answer.body);
  } catch {
    /* not JSON */
  }
  return { status: answer.status, body: parsed as T };
}

async function pageOf(cookie: string, id: string): Promise<string> {
  const answer = await asPerson(cookie, 'GET', `/api/open-artifact.artifacts.boot?id=${id}`);
  assert.equal(answer.status, 200, answer.body);
  return (JSON.parse(answer.body) as ShellBoot).pageUrl!;
}

const onHost = (path: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(readFileSync(join(host.rooms.rootOf(dash), path), 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
};

interface Answers {
  at: string;
  calls: Array<{ result: { structuredContent?: { rows: Array<{ revenue: string }> } } }>;
}

/** The first revenue in the host's copy of the orders answer. */
const hostRevenue = (): number | undefined => {
  const revenue = hostRevenueText();
  return revenue === undefined ? undefined : Number(revenue) - base;
};
/** The connector's first revenue before any change (what the bonus is added to). */
let base = 0;
const hostRevenueText = (): string | undefined => (onHost('db/data/live/answers/orders.json') as Answers | null)?.calls[0]?.result.structuredContent?.rows[0]?.revenue;

test('the person links the daemon and publishes the dashboard; only the confirmation flag publishes its data', async () => {
  const start = await api<{ user_code: string }>(state, 'remotes.add', { name: 'cloud', host: app });
  assert.equal((await real.decide(adaCookie, start.user_code)).status, 200);
  const done = await api<{ status: string }>(state, 'remotes.add.wait', { name: 'cloud', ms: 20_000 });
  assert.equal(done.status, 'done');
  await waitFor(() => host.link.presence.online(ada.id));

  const root = join(tempDir('open-artifact-dash-'), 'sales-and-signups');
  cpSync(join(repo, 'test-artifacts', 'data', 'sales-and-signups'), root, { recursive: true });
  rmSync(join(root, 'db', 'data'), { recursive: true, force: true });
  dash = daemon.store.create({ root, type: 'data', title: 'Sales and signups' }).id;
  const before = await api<DataPublishStatus>(state, 'artifacts.data', { id: dash });
  assert.equal(before.publish, false);
  assert.deepEqual(before.queries, ['broken', 'orders', 'tickets']);

  // Published through the route without the confirmation: the page goes up, its rows do not.
  const bare = await api<{ view_url: string; code?: string; data?: { live: boolean; publish: boolean } }>(state, 'artifacts.publish', { id: dash, remote: 'cloud' });
  assert.equal(bare.code, undefined, JSON.stringify(bare));
  assert.deepEqual(bare.data, { live: true, publish: false });
  assert.notEqual(daemon.store.require(dash).dataPublish, true);
  await new Promise((done) => setTimeout(done, 800));
  assert.equal(onHost('db/data/live.json'), null, 'no rows without the confirmation');

  // The person's confirmation (the Share panel's Publish sends it; the CLI asks at a terminal): the rows go.
  const out = await api<{ view_url: string; code?: string; data?: { live: boolean; publish: boolean } }>(state, 'artifacts.publish', { id: dash, data: true });
  assert.equal(out.code, undefined, JSON.stringify(out));
  assert.deepEqual(out.data, { live: true, publish: true });
  await waitFor(() => daemon.store.require(dash).dataPublish === true);
  const log = readFileSync(join(TEST_HOME, 'logs', 'daemon.log'), 'utf8');
  assert.match(log, new RegExp(`audit: published ${dash} to cloud, asked by a process holding the daemon token that did not say what it is, route artifacts\\.publish`));
  assert.match(log, new RegExp(`audit: confirmed the data of ${dash} to cloud, asked by`));

  // The host's copy has the rows: one document per query, and the status.
  const status = await waitFor(() => onHost('db/data/live.json'));
  assert.equal(status.owner, 'Ada');
  assert.ok(typeof status.at === 'string');
  // The answers are files of their own and arrive one after another: the status can be there a moment before them.
  base = Number(await waitFor(() => hostRevenueText()));
  assert.ok(base > 0);
  assert.ok(await waitFor(() => onHost('db/data/live/answers/tickets.json')));
  // The broken query failed by itself: its reason is recorded, the others came through.
  assert.match(String((status.failed as { reason?: string } | undefined)?.reason), /broken.*offline for maintenance/);
  const after = await api<DataPublishStatus>(state, 'artifacts.data', { id: dash });
  assert.equal(after.at, status.at);
});

test('a viewer’s page reads the saved rows', async () => {
  const shared = await asPerson(adaCookie, 'POST', '/api/open-artifact.artifact.share', { id: dash, members: { 'email:bob@example.com': 'viewer' } });
  assert.equal(shared.status, 200, shared.body);
  adaPage = await pageOf(adaCookie, dash);
  bobPage = await pageOf(bobCookie, dash);
  const read = await page<{ data: Answers | null }>(bobPage, 'db/get?path=data/live/answers/orders');
  assert.equal(read.status, 200, JSON.stringify(read.body));
  assert.equal(Number(read.body.data?.calls[0]?.result.structuredContent?.rows[0]?.revenue), base);
  // A viewer never refreshes.
  const refused = await page<{ code?: string }>(bobPage, 'data/refresh', {});
  assert.equal(refused.status, 403, JSON.stringify(refused.body));
});

test('the connector answers otherwise; the owner’s page asks for a refresh and the rows and time move', async () => {
  const before = onHost('db/data/live.json')!;
  writeFileSync(bonusFile, '1000');
  await new Promise((done) => setTimeout(done, 5));
  const asked = await page<{ queued: boolean; online: boolean }>(adaPage, 'data/refresh', {});
  assert.equal(asked.status, 200, JSON.stringify(asked.body));
  assert.deepEqual(asked.body, { queued: true, online: true });
  await waitFor(() => hostRevenue() === 1000);
  const status = await waitFor(() => {
    const now = onHost('db/data/live.json');
    return now && now.at !== before.at ? now : null;
  });
  assert.ok(Date.parse(String(status.at)) > Date.parse(String(before.at)));
  const read = await page<{ data: Answers | null }>(bobPage, 'db/get?path=data/live/answers/orders');
  assert.equal(Number(read.body.data?.calls[0]?.result.structuredContent?.rows[0]?.revenue), base + 1000);
});

test('with the daemon stopped the request waits, and is honoured once when it is back', async () => {
  daemon.close();
  await waitFor(() => !host.link.presence.online(ada.id));
  writeFileSync(bonusFile, '5000');
  const asked = await page<{ queued: boolean; online: boolean }>(adaPage, 'data/refresh', {});
  assert.deepEqual(asked.body, { queued: true, online: false });
  await new Promise((done) => setTimeout(done, 300));
  assert.equal(hostRevenue(), 1000, 'nothing runs while the computer is off');
  const waiting = (await host.catalog.listOutbox(ada.id)).filter((row) => row.kind === 'data-refresh' && row.ackedAt === null);
  assert.equal(waiting.length, 1);

  await bootDaemon();
  await waitFor(() => host.link.presence.online(ada.id));
  await waitFor(() => hostRevenue() === 5000);
  const at = onHost('db/data/live.json')!.at;
  // Acknowledged, and not run again.
  await waitFor(async () => (await host.catalog.listOutbox(ada.id)).every((row) => row.kind !== 'data-refresh' || row.ackedAt !== null));
  writeFileSync(bonusFile, '7000');
  await new Promise((done) => setTimeout(done, 1500));
  assert.equal(hostRevenue(), 5000);
  assert.equal(onHost('db/data/live.json')!.at, at);
});

test('unpublishing removes the snapshot from the working copy', async () => {
  const out = await api<{ code?: string }>(state, 'artifacts.unpublish', { id: dash });
  assert.equal(out.code, undefined, JSON.stringify(out));
  await waitFor(() => (daemon.store.require(dash).remote ?? null) === null);
  const status = await waitFor(async () => {
    const s = await api<DataPublishStatus>(state, 'artifacts.data', { id: dash });
    return s.at === null ? s : null;
  });
  assert.equal(status.published, false);
  // The confirmation went with it: publishing again asks again.
  assert.equal(status.publish, false);
  assert.equal(daemon.store.require(dash).dataPublish, false);
});
