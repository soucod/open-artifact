/**
 * A daemon linked to a (fake) cloud host: signing in through the daemon, publishing, keeping the working copy and the
 * host in step both ways (conflicts, deletions, `doc/`, an unreachable host), the event stream (wakes, removal,
 * reconnecting after the last acknowledged event), forwarding comments and the db to the host, and the agent's
 * `Artifact share {cloud}` behind `remotes.<name>.agentMayPublish`.
 */

import { tempDir, until } from './helpers.ts';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, type FSWatcher } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { COMMENT_HEADER, DEFAULT_SETTINGS, artifactIdOf, type DaemonState, type ToolCallResult } from '@open-artifact/protocol';
import { archiveEntries, writeZip } from '../../type-server/src/archive.ts';
import { api, readDaemon } from '../src/client.ts';
import { startDaemon, type Daemon } from '../src/daemon.ts';
import { Inbox } from '../src/inbox.ts';
import { LinkHub, type RemoteStatus } from '../src/link.ts';
import { ArtifactStore, sessionKeyOf } from '../src/store.ts';
import type { WakeResult } from '../src/wake.ts';
import { FakeHost, HostFailure } from './fake-host.ts';

process.env.OPEN_ARTIFACT_LINK_RETRY_MS = '40';
process.env.OPEN_ARTIFACT_LINK_RESCAN_MS = '400';

let daemon: Daemon;
let state: DaemonState;
let host: FakeHost;
let typeServer: Server;
/** Actions the local type server ran. */
const localCalls: string[] = [];

/** A URL type's server that zips the artifact's folder and has one action, `check`. */
function fakeTypeServer(): Promise<number> {
  typeServer = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      void (async () => {
        const url = new URL(req.url ?? '/', 'http://x');
        const send = (status: number, body: unknown): void => {
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(body));
        };
        if (url.pathname === '/card/__open-artifact/archive') {
          const record = daemon.store.get(url.searchParams.get('id') ?? '');
          if (!record) return send(404, { code: 'not_found', message: 'no artifact' });
          const chunks: Buffer[] = [];
          await writeZip(await archiveEntries(record.root), async (chunk) => void chunks.push(chunk));
          res.writeHead(200, { 'Content-Type': 'application/zip' });
          return res.end(Buffer.concat(chunks));
        }
        if (url.pathname === '/card/__open-artifact/actions') return send(200, { actions: [{ name: 'check', title: 'Check', effect: 'read' }] });
        if (url.pathname.startsWith('/card/__open-artifact/actions/')) {
          const name = decodeURIComponent(url.pathname.slice('/card/__open-artifact/actions/'.length));
          localCalls.push(name);
          if (name === 'check') return send(200, { ok: true, where: 'local' });
          return send(404, { code: 'unknown_action', message: `no action ${name}` });
        }
        return send(404, { code: 'not_found', message: `${url.pathname}: no such route` });
      })();
    });
  });
  return new Promise((done) => typeServer.listen(0, '127.0.0.1', () => done((typeServer.address() as { port: number }).port)));
}

before(async () => {
  host = await new FakeHost().start();
  const port = await fakeTypeServer();
  const dir = join(process.env.OPEN_ARTIFACT_USER_TYPES!, 'card');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'artifact-type.json'), JSON.stringify({ name: 'card', description: 'The card test type.', entry: { url: `http://127.0.0.1:${port}/card/{id}`, actions: true } }));
  daemon = await startDaemon({ port: 0, quiet: true, shellDir: tempDir('open-artifact-shell-'), homeDir: tempDir('open-artifact-no-home-') });
  state = (await readDaemon())!;
});

after(() => {
  daemon.close();
  host.close();
  typeServer.close();
});

const caller = { harness: 'dsh', session: 'link-1', workspace: tempDir('open-artifact-ws-') };
const ownerKey = sessionKeyOf(caller)!;

async function tool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
  return api<ToolCallResult>(state, 'tools.call', { name, arguments: args, caller });
}

/** A new card artifact with `files`, owned by {@link caller}. */
async function create(title: string, files: Record<string, string> = { 'index.html': `<h1>${title}</h1>` }): Promise<string> {
  const made = await tool('Artifact', { action: 'publish', type_url: 'open-artifact://type/card', title });
  assert.equal(made.error, undefined, JSON.stringify(made.error));
  const url = String(made.url);
  const wrote = await tool('Artifact', { action: 'publish', url, files });
  assert.equal(wrote.error, undefined, JSON.stringify(wrote.error));
  return artifactIdOf(url)!;
}

/** Publishes an artifact to `dev` the way the CLI does. */
async function publish(id: string): Promise<{ view_url: string; code?: string; message?: string }> {
  return api(state, 'artifacts.publish', { id, remote: 'dev' });
}

const rootOf = (id: string): string => daemon.store.require(id).root;
const local = (id: string, path: string): string | null => {
  try {
    return readFileSync(join(rootOf(id), path), 'utf8');
  } catch {
    return null;
  }
};
const status = async (): Promise<RemoteStatus | undefined> => (await api<{ remotes: RemoteStatus[] }>(state, 'remotes')).remotes.find((r) => r.name === 'dev');
const waitFor = <T>(check: () => T | Promise<T>): Promise<NonNullable<T>> => until(check, 8000);

test('a host on http is refused unless it is this computer', async () => {
  const out = await api<{ code: string; message: string }>(state, 'remotes.add', { name: 'far', host: 'http://artifacts.example.com' });
  assert.equal(out.code, 'invalid_argument');
  assert.match(out.message, /https/);
});

test('remote add signs in through the device flow the daemon polls', async () => {
  const start = await api<{ user_code: string; verification_uri_complete: string; opened: boolean }>(state, 'remotes.add', { name: 'dev', host: host.url });
  assert.equal(start.user_code, host.lastDevice()!.userCode);
  assert.ok(start.verification_uri_complete.startsWith(`${host.url}/link?code=`));
  assert.equal(start.opened, false, 'OPEN_ARTIFACT_BROWSER=none: nothing opens');
  const pending = await api<{ status: string }>(state, 'remotes.add.wait', { name: 'dev', ms: 150 });
  assert.equal(pending.status, 'pending');
  host.lastDevice()!.state = 'approved';
  const done = await api<{ status: string; user: { name: string } }>(state, 'remotes.add.wait', { name: 'dev', ms: 5000 });
  assert.equal(done.status, 'done');
  assert.equal(done.user.name, 'Kim');
  await waitFor(() => host.streamCount === 1);
  const dev = await status();
  assert.equal(dev?.signedIn, true);
  assert.equal(JSON.stringify(dev).includes('rt_'), false, 'status shows no token');
});

test('a refused sign-in reports not_granted', async () => {
  await api(state, 'remotes.add', { name: 'nope', host: host.url });
  host.lastDevice()!.state = 'denied';
  const out = await api<{ code: string }>(state, 'remotes.add.wait', { name: 'nope', ms: 5000 });
  assert.equal(out.code, 'not_granted');
});

test('remote add opens the browser unless asked not to (the Shell shows the link itself)', async () => {
  const opened: string[] = [];
  const hub = new LinkHub({
    store: new ArtifactStore(),
    inbox: new Inbox(),
    settings: () => DEFAULT_SETTINGS,
    wake: async (): Promise<WakeResult> => ({ via: 'inbox' }),
    archive: async () => new Uint8Array(),
    browse: (url) => (opened.push(url), true),
    log: () => undefined,
    version: '0.0.0-test',
  });
  try {
    const shown = await hub.signIn('browse-on', host.url);
    assert.equal(shown.opened, true);
    assert.deepEqual(opened, [shown.verification_uri_complete]);
    const quiet = await hub.signIn('browse-off', host.url, { browse: false });
    assert.equal(quiet.opened, false);
    assert.equal(opened.length, 1, 'browse: false opens nothing');
  } finally {
    hub.cancelSignIn('browse-on');
    hub.cancelSignIn('browse-off');
    hub.close();
  }
});

test('remotes.add.cancel stops a sign-in: an approval after it keeps nothing', async () => {
  await api(state, 'remotes.add', { name: 'gone', host: host.url, browse: false });
  const device = host.lastDevice()!;
  assert.deepEqual(await api(state, 'remotes.add.cancel', { name: 'gone' }), { name: 'gone', cancelled: true });
  const polls = device.polls.length;
  device.state = 'approved';
  await new Promise((done) => setTimeout(done, 300));
  assert.equal(device.polls.length, polls, 'the daemon stopped asking the host');
  assert.equal((await api<{ remotes: RemoteStatus[] }>(state, 'remotes')).remotes.some((r) => r.name === 'gone'), false);
  const wait = await api<{ code: string }>(state, 'remotes.add.wait', { name: 'gone', ms: 100 });
  assert.equal(wait.code, 'not_found');
  // Nothing under way: said so, not an error.
  assert.deepEqual(await api(state, 'remotes.add.cancel', { name: 'gone' }), { name: 'gone', cancelled: false });
});

test('publish imports the folder; tools then give the cloud address', async () => {
  const id = await create('Cloud card', { 'index.html': '<h1>Cloud</h1>', 'data/a.json': '{"a":1}', '_agent/notes.md': 'mine' });
  const out = await publish(id);
  assert.equal(out.view_url, `${host.url}/a/${id}`);
  assert.equal(host.text(id, 'index.html'), '<h1>Cloud</h1>');
  assert.equal(host.text(id, 'data/a.json'), '{"a":1}');
  assert.equal(host.text(id, '_agent/notes.md'), null, '_agent stays home');
  const record = daemon.store.require(id);
  assert.equal(record.remote?.name, 'dev');
  assert.equal(record.remote?.url, `${host.url}/a/${id}`);
  assert.ok(record.remote?.base['index.html']);
  // Lists say where it is published (without the sync bookkeeping); a local artifact says null.
  assert.deepEqual(daemon.artifactView(record).remote, { name: 'dev', host: host.url, url: `${host.url}/a/${id}`, syncedAt: record.remote?.syncedAt ?? null });
  const listed = await api<{ artifacts: Array<{ id: string; remote?: { url: string } | null }> }>(state, 'artifacts');
  assert.equal(listed.artifacts.find((a) => a.id === id)?.remote?.url, `${host.url}/a/${id}`);

  const read = await tool('Artifact', { action: 'read', url: `open-artifact://artifact/${id}` });
  assert.equal(read.view_url, `${host.url}/a/${id}`);
  assert.equal((read.cloud as { remote: string }).remote, 'dev');
  const share = await tool('Artifact', { action: 'share', url: `open-artifact://artifact/${id}` });
  assert.equal(share.view_url, `${host.url}/a/${id}`);

  // The local page sends people to the host while it answers.
  const page = await fetch(new URL(`/a/${id}`, state.url), { redirect: 'manual' });
  assert.equal(page.status, 302);
  assert.equal(page.headers.get('location'), `${host.url}/a/${id}`);

  // Publishing an artifact whose id the host has already is refused.
  const other = await create('Taken card');
  host.artifacts.set(other, { id: other, type: 'card', title: 'Someone else', files: new Map() });
  const refused = await publish(other);
  assert.equal(refused.code, 'conflict');
  assert.match(String(refused.message), /already has an artifact/);
  assert.equal(daemon.store.require(other).remote ?? null, null);
  assert.equal(daemon.artifactView(daemon.store.require(other)).remote, null);
  host.artifacts.delete(other);
});

test('a page goes only to a site whose hello says it runs pages; its capabilities then travel both ways', async () => {
  const made = await tool('Artifact', { action: 'publish', type_url: 'open-artifact://type/page', title: 'Linked page', open: 'never', capabilities: { db: true } });
  assert.equal(made.error, undefined, JSON.stringify(made.error));
  const id = artifactIdOf(String(made.url))!;
  await tool('Artifact', { action: 'publish', url: made.url, files: { 'index.html': '<!doctype html><title>Linked page</title><p>hi</p>' } });
  // An older site: refused with the reason, nothing imported.
  host.pages = false;
  const old = await publish(id);
  assert.equal(old.code, 'unsupported');
  assert.match(String(old.message), /does not run page artifacts/);
  assert.equal(host.artifacts.has(id), false);
  // A site that runs pages takes it, `.artifact.json` (with the capabilities) inside the zip.
  host.pages = true;
  try {
    const out = await publish(id);
    assert.equal(out.view_url, `${host.url}/a/${id}`);
    assert.equal(host.artifacts.get(id)?.type, 'page');
    assert.deepEqual(daemon.store.require(id).remote?.capabilities, { db: true }, 'the agreed capabilities are the published ones');
    assert.equal(host.capabilityLog.length, 0, 'nothing to send: the zip carried them');
    // The agent changes them here: they go to the site.
    const changed = await tool('Artifact', { action: 'publish', url: made.url, capabilities: { db: true, network: { origins: ['https://api.example.com'] } } });
    assert.equal(changed.error, undefined, JSON.stringify(changed.error));
    await waitFor(() => host.capabilityLog.find((c) => c.id === id && 'network' in c.capabilities));
    await waitFor(() => (daemon.store.require(id).remote?.capabilities as { network?: unknown } | undefined)?.network);
    // The owner changes them on the site: they come home into the record and the marker, and are not sent back.
    const sent = host.capabilityLog.length;
    host.emit({ type: 'artifact', artifact: id, capabilities: { identity: true } } as never);
    await waitFor(() => (daemon.store.require(id).capabilities as { identity?: unknown } | undefined)?.identity);
    assert.deepEqual(JSON.parse(local(id, '.artifact.json')!).capabilities, { identity: true });
    await new Promise((done) => setTimeout(done, 600));
    assert.equal(host.capabilityLog.length, sent, 'a change from the site is not echoed back');
  } finally {
    host.pages = false;
  }
});

test('the agent’s writes are pushed; a person’s edit on the host is pulled and shows in changed_files', async () => {
  const id = await create('Synced card');
  await publish(id);
  const url = `open-artifact://artifact/${id}`;

  // A tool write.
  await tool('Artifact', { action: 'publish', url, files: { 'notes.txt': 'from the agent' } });
  await waitFor(() => host.text(id, 'notes.txt') === 'from the agent');
  // A plain write into the folder (the watcher or the rescan).
  writeFileSync(join(rootOf(id), 'plain.txt'), 'written directly');
  await waitFor(() => host.text(id, 'plain.txt') === 'written directly');
  await tool('Artifact', { action: 'read', url });

  host.edit(id, 'index.html', '<h1>Kim was here</h1>');
  await waitFor(() => local(id, 'index.html') === '<h1>Kim was here</h1>');
  const read = await waitFor(async () => {
    const out = await tool('Artifact', { action: 'read', url });
    return (out.changed_files as string[] | undefined)?.includes('index.html') ? out : null;
  });
  assert.ok(read);
  // The pull was not pushed back.
  assert.equal(host.writes.some((w) => w.path === 'index.html'), false);

  // The agent's own writes made on the host (author agent) are not the person's edits.
  host.edit(id, 'agent.txt', 'by the agent elsewhere', 'agent:remote');
  await waitFor(() => local(id, 'agent.txt') === 'by the agent elsewhere');
  const again = await tool('Artifact', { action: 'read', url });
  assert.equal(((again.changed_files as string[] | undefined) ?? []).includes('agent.txt'), false);
});

test('deletions travel both ways', async () => {
  const id = await create('Deleting card', { 'index.html': '<h1>D</h1>', 'a.txt': 'a', 'b.txt': 'b' });
  await publish(id);
  rmSync(join(rootOf(id), 'a.txt'));
  await waitFor(() => host.text(id, 'a.txt') === null);
  host.edit(id, 'b.txt', null);
  await waitFor(() => !existsSync(join(rootOf(id), 'b.txt')));
  assert.equal(host.text(id, 'index.html'), '<h1>D</h1>');
});

test('uploads under _blobs/ travel both ways', async () => {
  const id = await create('Blob card');
  await publish(id);
  const here = `_blobs/${'a'.repeat(32)}`;
  mkdirSync(join(rootOf(id), '_blobs'), { recursive: true });
  writeFileSync(join(rootOf(id), here), 'uploaded here');
  await waitFor(() => host.text(id, here) === 'uploaded here');
  const there = `_blobs/${'b'.repeat(32)}`;
  host.edit(id, there, 'uploaded on the site');
  await waitFor(() => local(id, there) === 'uploaded on the site');
  assert.equal(host.writes.some((w) => w.path === there), false, 'the pull is not pushed back');
});

test('a write made while the watch is armed is pushed by the catch-up sync, with no rescan timer', async () => {
  const id = await create('Arming card');
  const rescan = process.env.OPEN_ARTIFACT_LINK_RESCAN_MS;
  process.env.OPEN_ARTIFACT_LINK_RESCAN_MS = '0';
  try {
    await publish(id);
    // The watch hears nothing, as when the write lands before the OS armed it.
    type Armed = { watcher: FSWatcher | null; running: Promise<void> | null; lastSyncAt: string | null };
    const state = (daemon.link as unknown as { syncs: Map<string, Armed> }).syncs.get(id)!;
    state.watcher?.close();
    state.watcher = null;
    // Let the first sync and the host's echo of it finish, so only a catch-up sync can still find the write.
    await until(() => state.lastSyncAt !== null && state.running === null, 4000);
    await new Promise((resolve) => setTimeout(resolve, 500));
    writeFileSync(join(rootOf(id), 'early.txt'), 'written as the watch started');
    await until(() => host.text(id, 'early.txt') === 'written as the watch started', 4000);
  } finally {
    if (rescan === undefined) delete process.env.OPEN_ARTIFACT_LINK_RESCAN_MS;
    else process.env.OPEN_ARTIFACT_LINK_RESCAN_MS = rescan;
  }
});

test('doc/ is never pushed, and mirrors the host', async () => {
  const id = await create('Doc card');
  await publish(id);
  mkdirSync(join(rootOf(id), 'doc'), { recursive: true });
  writeFileSync(join(rootOf(id), 'doc', 'content.json'), '{"local":true}');
  writeFileSync(join(rootOf(id), 'after-doc.txt'), 'pushed');
  await waitFor(() => host.text(id, 'after-doc.txt') === 'pushed');
  host.edit(id, 'doc/content.json', '{"host":true}');
  await waitFor(() => local(id, 'doc/content.json') === '{"host":true}');
  assert.equal(host.writes.some((w) => w.path.startsWith('doc/')), false);
  assert.equal(host.text(id, 'doc/content.json'), '{"host":true}');
});

test('when both changed a file, the host’s version wins the path, the agent’s is kept, and the owner is told', async () => {
  const id = await create('Both card', { 'index.html': '<h1>Base</h1>' });
  await publish(id);
  daemon.inbox.take(ownerKey);
  host.setOffline(true);
  writeFileSync(join(rootOf(id), 'index.html'), '<h1>Agent</h1>');
  host.artifacts.get(id)!.files.set('index.html', Buffer.from('<h1>Kim</h1>'));
  await waitFor(async () => (await status())?.artifacts.find((a) => a.id === id)?.lastError);
  host.setOffline(false);
  await waitFor(() => local(id, 'index.html') === '<h1>Kim</h1>');
  assert.equal(readFileSync(join(rootOf(id), '_agent', 'conflicts', 'index.html'), 'utf8'), '<h1>Agent</h1>');
  assert.equal(host.text(id, 'index.html'), '<h1>Kim</h1>');
  const told = await waitFor(() => daemon.inbox.peek(ownerKey).find((m) => m.text.includes('index.html') && m.text.includes('_agent/conflicts')));
  assert.match(told.text, /re-apply your change/);

  // A second conflict on the same path keeps both of the agent's versions.
  host.setOffline(true);
  writeFileSync(join(rootOf(id), 'index.html'), '<h1>Agent 2</h1>');
  host.artifacts.get(id)!.files.set('index.html', Buffer.from('<h1>Kim 2</h1>'));
  await waitFor(async () => (await status())?.artifacts.find((a) => a.id === id)?.lastError);
  host.setOffline(false);
  await waitFor(() => local(id, 'index.html') === '<h1>Kim 2</h1>');
  assert.equal(readFileSync(join(rootOf(id), '_agent', 'conflicts', 'index.2.html'), 'utf8'), '<h1>Agent 2</h1>');
});

test('while the host is unreachable, writes wait (status shows them) and go once it is back; the page serves locally', async () => {
  const id = await create('Offline card');
  await publish(id);
  host.setOffline(true);
  writeFileSync(join(rootOf(id), 'offline.txt'), 'written offline');
  const waiting = await waitFor(async () => {
    const entry = (await status())?.artifacts.find((a) => a.id === id);
    return entry?.lastError && entry.pending.includes('offline.txt') ? entry : null;
  });
  assert.ok(waiting.lastError);
  // A stable code beside the English text, for the artifact and for the remote.
  assert.equal(waiting.code, 'unreachable');
  assert.equal((await status())?.code, 'unreachable');
  assert.equal((await status())?.reachable, false);
  // Said plainly: in remote status, in a write's result, in read's cloud summary, and in a forwarded action's error.
  assert.match((await status())?.note ?? '', /queued on this computer/);
  const url = `open-artifact://artifact/${id}`;
  const wrote = await tool('Artifact', { action: 'publish', url, files: { 'more.txt': 'also offline' } });
  assert.ok(((wrote.notes as string[] | undefined) ?? []).some((n) => /queued on this computer/.test(n)), JSON.stringify(wrote.notes));
  const read = await tool('Artifact', { action: 'read', url });
  assert.match((read.cloud as { note?: string } | undefined)?.note ?? '', /queued on this computer/);
  const data = await tool('ArtifactData', { action: 'get', url, collection: 'x', doc_id: 'y' });
  assert.match(JSON.stringify(data.error), /queued on this computer/);
  const page = await fetch(new URL(`/a/${id}`, state.url), { redirect: 'manual' });
  assert.notEqual(page.status, 302, 'offline: the working copy shows here');
  await page.arrayBuffer();

  host.setOffline(false);
  await waitFor(() => host.text(id, 'offline.txt') === 'written offline');
  await waitFor(() => host.text(id, 'more.txt') === 'also offline');
  await waitFor(async () => {
    const entry = (await status())?.artifacts.find((a) => a.id === id);
    return entry && !entry.lastError && !entry.pending.length && entry.code === null;
  });
  await waitFor(() => host.streamCount === 1);
  await waitFor(async () => (await status())?.code === null);
});

test('a wake reaches the owner’s inbox as a page’s does, once, and the stream resumes after the last acknowledged event', async () => {
  const id = await create('Wake card');
  await publish(id);
  await waitFor(() => host.streamCount === 1);
  daemon.inbox.take(ownerKey);

  const thread = { id: 't_1', messages: [{ from: 'user', name: 'Kim', text: 'Make it blue', at: new Date().toISOString() }] };
  const first = host.emit({ type: 'wake', artifact: id, threads: [thread] } as never);
  await waitFor(() => host.acked.has(first.id));
  const next = await waitFor(async () => {
    const out = await tool('Artifact', { action: 'list' });
    return (out.messages as string[] | undefined)?.length ? out : null;
  });
  const messages = next.messages as string[];
  assert.equal(messages.length, 1);
  assert.ok(messages[0]!.includes(COMMENT_HEADER));
  assert.match(messages[0]!, /Make it blue/);

  // Reconnecting asks for what came after the last acknowledged event.
  const connects = host.connects.length;
  host.dropStreams();
  await waitFor(() => host.connects.length > connects && host.streamCount === 1);
  assert.equal(host.connects.at(-1), first.id);

  // An event whose ack failed comes again: it is acknowledged, not handled twice.
  host.failAck = true;
  const second = host.emit({ type: 'wake', artifact: id, threads: [{ ...thread, id: 't_2', messages: [{ ...thread.messages[0]!, text: 'Now green' }] }] } as never);
  const failedAcks = host.failedAcks;
  await waitFor(() => daemon.inbox.peek(ownerKey).length === 1 && host.failedAcks > failedAcks);
  host.failAck = false;
  const before = host.connects.length;
  host.dropStreams();
  await waitFor(() => host.connects.length > before && host.acked.has(second.id));
  assert.equal(host.connects.at(-1), first.id);
  await new Promise((done) => setTimeout(done, 200));
  const inbox = daemon.inbox.take(ownerKey);
  assert.equal(inbox.length, 1);
  assert.match(inbox[0]!.text, /Now green/);

  // An event for an artifact this daemon does not have is acknowledged and dropped.
  const stray = host.emit({ type: 'wake', artifact: 'art_unknown1', threads: [thread] } as never);
  await waitFor(() => host.acked.has(stray.id));
});

test('a wake an editor sent names them to the agent; a malformed or item-level sender is dropped', async () => {
  const id = await create('Asked card');
  await publish(id);
  await waitFor(() => host.streamCount === 1);
  daemon.inbox.take(ownerKey);

  const event = host.emit({ type: 'wake', artifact: id, requests: [{ id: 'r_1', text: 'Tidy it up' }], from: { name: 'Eve', role: 'editor' } } as never);
  await waitFor(() => host.acked.has(event.id));
  const named = await waitFor(() => (daemon.inbox.peek(ownerKey).length ? daemon.inbox.take(ownerKey) : null));
  assert.match(named[0]!.text, /From: Eve \(editor, not the owner\)/);
  assert.match(named[0]!.text, /Tidy it up/);

  // The host's word is the event's `from`, checked: a role that is not a sharer's, or a sender on an item, names nobody.
  const owner = host.emit({ type: 'wake', artifact: id, requests: [{ id: 'r_2', text: 'Owner asks', from: { name: 'Mallory', role: 'editor' } }], from: { name: 'Mallory', role: 'owner' } } as never);
  await waitFor(() => host.acked.has(owner.id));
  const plain = await waitFor(() => (daemon.inbox.peek(ownerKey).length ? daemon.inbox.take(ownerKey) : null));
  assert.match(plain[0]!.text, /Owner asks/);
  assert.doesNotMatch(plain[0]!.text, /From:/);
});

test('an artifact removed on the host is local only again, and its owner is told', async () => {
  const id = await create('Removed card');
  await publish(id);
  await waitFor(() => host.streamCount === 1);
  daemon.inbox.take(ownerKey);
  host.artifacts.delete(id);
  const event = host.emit({ type: 'artifact', artifact: id, removed: true });
  await waitFor(() => host.acked.has(event.id));
  assert.equal(daemon.store.require(id).remote ?? null, null);
  const told = daemon.inbox.take(ownerKey);
  assert.ok(told.some((m) => m.text.includes('was removed')));
  const read = await tool('Artifact', { action: 'read', url: `open-artifact://artifact/${id}` });
  assert.ok(String(read.view_url).startsWith(state.url), String(read.view_url));
});

test('comments and the db go to the host; check stays local', async () => {
  const id = await create('Forward card');
  await publish(id);
  const url = `open-artifact://artifact/${id}`;
  host.onCall = (_id, action, args) => {
    if (action === 'open-artifact.comments.read') return { threads: [{ id: 't_9', agent: true, messages: [{ from: 'user', text: 'Hi' }] }], sent_tracked: true };
    if (action === 'open-artifact.comments.reply') return { thread_id: args.thread_id };
    if (action === 'open-artifact.db.write') return { writes: [{ op: 'set', path: 'votes/a', sha256: 'abc' }] };
    return { ok: true };
  };
  host.calls.length = 0;
  localCalls.length = 0;

  const reply = await tool('ArtifactComments', { action: 'reply', url, thread_id: 't_9', text: 'On it' });
  assert.equal(reply.error, undefined, JSON.stringify(reply.error));
  assert.equal(reply.replied, true);
  assert.deepEqual(host.calls.find((c) => c.action === 'open-artifact.comments.reply')?.args, { thread_id: 't_9', text: 'On it', resolve: false });

  const write = await tool('ArtifactData', { action: 'set', url, collection: 'votes', doc_id: 'a', data: { n: 1 } });
  assert.equal(write.error, undefined, JSON.stringify(write.error));
  const dbCall = host.calls.find((c) => c.action === 'open-artifact.db.write');
  assert.ok(dbCall);
  assert.equal(((dbCall.args.writes as Array<{ path: string }>)[0])!.path, 'votes/a');

  const checked = await tool('Artifact', { action: 'call', url, name: 'check' });
  assert.equal(checked.error, undefined, JSON.stringify(checked.error));
  assert.equal(checked.where, 'local');
  assert.deepEqual(localCalls, ['check']);
  assert.equal(host.calls.some((c) => c.action === 'check'), false);
  const record = daemon.store.require(id);
  const docs = { id: 'docs', store: 'doc' } as Parameters<typeof daemon.link.forwards>[1];
  for (const name of ['check', 'upload', 'snapshot', 'share', 'duplicate', 'export']) assert.equal(daemon.link.forwards(record, docs, name), false, name);
  for (const name of ['import', 'insert', 'context', 'open-artifact.db.read']) assert.equal(daemon.link.forwards(record, docs, name), true, name);
  assert.equal(daemon.link.forwards(record, null, 'insert'), false, 'a type without a server store keeps its own actions');

  // A host's refusal comes back in the tool's usual error shape.
  host.onCall = () => {
    throw new HostFailure(403, 'not_granted', 'Comments are closed.');
  };
  const failed = await tool('ArtifactComments', { action: 'read', url });
  assert.equal((failed.error as { code: string }).code, 'not_granted');
  assert.equal((failed.error as { message: string }).message, 'Comments are closed.');
});

test('a published artifact renders here: brought up to date first, or drawn as it is with a note when the host is away', async () => {
  const id = await create('Render card');
  await publish(id);
  const record = daemon.store.require(id);
  const docs = { id: 'docs', store: 'doc' } as Parameters<typeof daemon.link.renders>[1];
  const card = daemon.types.get('card') ?? null;
  // Snapshot for any type, and every Docs export format (one action, `export`): local, never forwarded.
  for (const [type, name] of [[docs, 'snapshot'], [docs, 'export'], [card, 'snapshot']] as const) {
    assert.equal(daemon.link.renders(record, type, name), true, name);
    assert.equal(daemon.link.forwards(record, type, name), false, name);
  }
  for (const name of ['batch', 'import', 'create']) assert.equal(daemon.link.renders(record, docs, name), false, name);
  assert.equal(daemon.link.renders(record, card, 'export'), false, 'export renders here for Docs only');
  assert.equal(daemon.link.renders({ ...record, remote: undefined }, docs, 'export'), false, 'a local artifact is local anyway');

  // A change on the host no event announced yet: the render's sync brings it first.
  host.artifacts.get(id)!.files.set('fresh.txt', Buffer.from('from the host'));
  const fresh = await daemon.link.freshen(record, card);
  assert.deepEqual(fresh, { note: null, reload: false });
  assert.equal(local(id, 'fresh.txt'), 'from the host');
  assert.equal((await daemon.link.freshen(record, docs)).reload, true, 'a server store is reopened to read the pull');

  // The host away: the working copy is rendered as it is, and the result says so.
  host.setOffline(true);
  try {
    host.artifacts.get(id)!.files.set('late.txt', Buffer.from('missed'));
    const stale = await daemon.link.freshen(record, card);
    assert.match(stale.note ?? '', /Rendered the working copy on this computer as it is/);
    assert.equal(local(id, 'late.txt'), null);
  } finally {
    host.setOffline(false);
  }
});

test('the agent publishes to a remote only when the person allows it', async () => {
  const id = await create('Agent card');
  const url = `open-artifact://artifact/${id}`;
  const refused = await tool('Artifact', { action: 'share', url, cloud: 'dev' });
  assert.equal((refused.error as { code: string }).code, 'not_granted');
  assert.match(String((refused.error as { fix?: string }).fix), /open-artifact publish .* --remote dev/);
  assert.equal(daemon.store.require(id).remote ?? null, null);

  daemon.settings = { ...daemon.settings, remotes: { dev: { agentMayPublish: true } } };
  try {
    const shared = await tool('Artifact', { action: 'share', url, cloud: 'dev' });
    assert.equal(shared.error, undefined, JSON.stringify(shared.error));
    assert.equal(shared.view_url, `${host.url}/a/${id}`);
    assert.ok(host.artifacts.has(id));
  } finally {
    daemon.settings = { ...daemon.settings, remotes: {} };
  }
});

test('unpublish brings the host’s version home and leaves the artifact local', async () => {
  const id = await create('Unpublish card');
  await publish(id);
  host.edit(id, 'late.txt', 'from Kim');
  const out = await api<{ view_url: string; code?: string }>(state, 'artifacts.unpublish', { id });
  assert.equal(out.code, undefined, JSON.stringify(out));
  assert.equal(local(id, 'late.txt'), 'from Kim');
  assert.equal(host.artifacts.has(id), false);
  assert.equal(daemon.store.require(id).remote ?? null, null);
  assert.ok(out.view_url.startsWith(state.url));
});

test('remote remove refuses while artifacts are published there, unless forced', async () => {
  const published = (await status())!.artifacts.length;
  assert.ok(published > 0);
  const refused = await api<{ code: string }>(state, 'remotes.remove', { name: 'dev' });
  assert.equal(refused.code, 'conflict');
  const removed = await api<{ removed: string; unlinked: string[] }>(state, 'remotes.remove', { name: 'dev', force: true });
  assert.equal(removed.removed, 'dev');
  assert.equal(removed.unlinked.length, published);
  assert.equal(await status(), undefined);
});

test('the owner’s inbox key is the session of the caller', () => {
  assert.equal(ownerKey, sessionKeyOf(daemon.store.list().find((r) => r.title === 'Wake card')?.owner));
});
