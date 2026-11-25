/**
 * A real daemon linked to a real Node host (`packages/host`), both in this process, over real HTTP: the P1 story.
 *
 * The person links their daemon (the device flow, approved through the host's approval route with their session),
 * publishes a whiteboard and a doc, and shares the cloud address. Someone else edits and comments on the cloud page;
 * the comment reaches the agent's session; the agent's writes, replies, db writes and Docs actions reach the host;
 * both-sides changes keep both versions; with the daemon stopped the cloud page still answers, its agent reads
 * offline, and what was sent meanwhile is delivered once when the daemon is back; then the artifact is unpublished.
 *
 * The test lives with the daemon (which may import the host's source by path, as it imports the type server's): the
 * host's own tests stay free of the daemon. The host's editors are fakes; its pages are driven through their
 * `_api/*` routes on the content origin, with an explicit `Host` (no DNS for `*.localhost`).
 */

import { tempDir, until } from './helpers.ts';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { COMMENT_HEADER, REQUEST_HEADER, artifactIdOf, type DaemonState, type ShellBoot, type ToolCallResult } from '@open-artifact/protocol';
import type { UserRecord } from '../../host/src/core/types.ts';
import type { RunningHost } from '../../host/src/node/host.ts';
import { api, readDaemon } from '../src/client.ts';
import { startDaemon, type Daemon } from '../src/daemon.ts';
import type { RemoteStatus } from '../src/link.ts';
import { sessionKeyOf } from '../src/store.ts';
import { call, startRealHost, type Answer, type RealHost } from './real-host.ts';

process.env.OPEN_ARTIFACT_LINK_RETRY_MS = '100';
// No rescan timer: every pull here must come from the host's events (or the daemon's own forwarded writes).
process.env.OPEN_ARTIFACT_LINK_RESCAN_MS = '0';

let real: RealHost;
let host: RunningHost;
let port: number;
let app: string;
let ada: UserRecord;
let adaCookie: string;
let bob: UserRecord;
let bobCookie: string;
let daemon: Daemon;
let state: DaemonState;

const shellDir = tempDir('open-artifact-shell-');
const caller = { harness: 'dsh', session: 'cloud-1', workspace: tempDir('open-artifact-ws-') };
const ownerKey = sessionKeyOf(caller)!;

async function bootDaemon(): Promise<void> {
  daemon = await startDaemon({ port: 0, quiet: true, shellDir, homeDir: join(shellDir, 'no-home') });
  state = (await readDaemon())!;
}

before(async () => {
  real = await startRealHost();
  ({ host, port, app } = real);
  ({ user: ada, cookie: adaCookie } = await real.person('Ada', 'ada@example.com'));
  ({ user: bob, cookie: bobCookie } = await real.person('Bob', 'bob@example.com'));
  await bootDaemon();
});

after(async () => {
  daemon?.close();
  await real?.stop();
});

/** An app-origin request as a signed-in person (writes carry the app origin, as a browser's do). */
async function asPerson(cookie: string, method: string, path: string, body?: unknown): Promise<Answer> {
  const write = method !== 'GET';
  return call(port, method, app + path, { cookie, ...(write ? { origin: app, 'content-type': 'application/json' } : {}) }, body === undefined ? undefined : JSON.stringify(body));
}

/** A page's `_api` request (content origin: no cookies, the page token in the path). */
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

/** The page address the Shell would frame for a person. */
async function pageOf(cookie: string, id: string): Promise<string> {
  const answer = await asPerson(cookie, 'GET', `/api/open-artifact.artifacts.boot?id=${id}`);
  assert.equal(answer.status, 200, answer.body);
  const boot = JSON.parse(answer.body) as ShellBoot;
  assert.ok(boot.pageUrl);
  return boot.pageUrl;
}

async function tool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
  return api<ToolCallResult>(state, 'tools.call', { name, arguments: args, caller });
}

const rootOf = (id: string): string => daemon.store.require(id).root;
const local = (id: string, path: string): string | null => {
  try {
    return readFileSync(join(rootOf(id), path), 'utf8');
  } catch {
    return null;
  }
};
const onHost = (id: string, path: string): string | null => {
  try {
    return readFileSync(join(host.rooms.rootOf(id), path), 'utf8');
  } catch {
    return null;
  }
};
const status = async (): Promise<RemoteStatus | undefined> => (await api<{ remotes: RemoteStatus[] }>(state, 'remotes')).remotes.find((r) => r.name === 'cloud');
const waitFor = <T>(check: () => T | Promise<T>, ms = 10_000): Promise<NonNullable<T>> => until(check, ms);
/** The messages the owning session's next tool result carries. */
const messages = async (): Promise<string[]> => ((await tool('Artifact', { action: 'list' })).messages as string[] | undefined) ?? [];

let board = '';
let doc = '';
let boardPage = '';
let bobPage = '';
let threadId = '';

test('the person links the daemon: device flow approved on the host with their session', async () => {
  const start = await api<{ user_code: string; verification_uri: string; verification_uri_complete: string; opened: boolean }>(state, 'remotes.add', { name: 'cloud', host: app });
  assert.equal(start.verification_uri, `${app}/link/device`);
  assert.equal(start.opened, false);
  // The approval page shows the code to a signed-in person; the person approves.
  const shown = await call(port, 'GET', start.verification_uri_complete, { cookie: adaCookie });
  assert.equal(shown.status, 200);
  assert.match(shown.body, /Open Artifact daemon/);
  const approved = await real.decide(adaCookie, start.user_code);
  assert.equal(approved.status, 200, approved.body);
  const done = await api<{ status: string; user: { id: string; name: string } }>(state, 'remotes.add.wait', { name: 'cloud', ms: 20_000 });
  assert.equal(done.status, 'done', JSON.stringify(done));
  assert.equal(done.user.id, ada.id);
  // The daemon's event stream is open: Ada's agent is online on the host.
  await waitFor(() => host.link.presence.online(ada.id));
  const cloud = await status();
  assert.equal(cloud?.signedIn, true);
  assert.equal(cloud?.user?.name, 'Ada');
});

test('publish a whiteboard and a doc; tools give the cloud address', async () => {
  const madeBoard = await tool('Artifact', { action: 'publish', type_url: 'open-artifact://type/whiteboard', title: 'Plan board' });
  assert.equal(madeBoard.error, undefined, JSON.stringify(madeBoard.error));
  board = artifactIdOf(String(madeBoard.url))!;
  const madeDoc = await tool('Artifact', { action: 'publish', type_url: 'open-artifact://type/docs', title: 'Plan doc' });
  assert.equal(madeDoc.error, undefined, JSON.stringify(madeDoc.error));
  doc = artifactIdOf(String(madeDoc.url))!;
  const created = await tool('Artifact', { action: 'call', url: madeDoc.url, name: 'create', args: { call: { name: 'Plan doc', doc: { markdown: '# Plan\n\nFirst draft.' } } } });
  assert.equal(created.error, undefined, JSON.stringify(created.error));

  for (const id of [board, doc]) {
    const out = await api<{ view_url: string; code?: string; message?: string }>(state, 'artifacts.publish', { id, remote: 'cloud' });
    assert.equal(out.code, undefined, JSON.stringify(out));
    assert.equal(out.view_url, `${app}/a/${id}`);
    const read = await tool('Artifact', { action: 'read', url: `open-artifact://artifact/${id}` });
    assert.equal(read.view_url, `${app}/a/${id}`);
    const row = await host.catalog.getArtifact(id);
    assert.equal(row?.ownerUser, ada.id);
  }
  assert.equal((await host.catalog.getArtifact(board))?.type, 'whiteboard');
  assert.equal((await host.catalog.getArtifact(board))?.title, 'Plan board');
  assert.equal((await host.catalog.getArtifact(doc))?.type, 'docs');
  assert.match(onHost(doc, 'doc/doc.json') ?? '', /Plan doc/);

  // Ada opens the cloud page; Bob gets it as an editor.
  boardPage = await pageOf(adaCookie, board);
  const shared = await asPerson(adaCookie, 'POST', '/api/open-artifact.artifact.share', { id: board, members: { 'email:bob@example.com': 'editor' } });
  assert.equal(shared.status, 200, shared.body);
  bobPage = await pageOf(bobCookie, board);
  const session = await page<{ viewer: { role: string } }>(bobPage, 'session');
  assert.equal(session.body.viewer.role, 'editor');
});

test('a local write is pushed and the cloud page sees it', async () => {
  // Opening the board's page first starts the host's watcher for it (as a person viewing it would).
  assert.equal((await page(boardPage, 'session')).status, 200);
  const note = { type: 'note', x: 10, y: 20, text: 'From the laptop', color: 'yellow' };
  mkdirSync(join(rootOf(board), 'db', 'elements'), { recursive: true });
  writeFileSync(join(rootOf(board), 'db', 'elements', 'laptop.json'), JSON.stringify(note));
  await waitFor(() => onHost(board, 'db/elements/laptop.json'));
  const seen = await waitFor(async () => {
    const got = await page<{ data: { text?: string } | null }>(boardPage, 'db/get?path=elements/laptop');
    return got.body?.data?.text === 'From the laptop' ? got : null;
  });
  assert.equal(seen.status, 200);
  const entry = (await status())?.artifacts.find((a) => a.id === board);
  assert.deepEqual(entry?.pending, []);
});

test('an edit on the cloud page is pulled into the working copy and listed in changed_files', async () => {
  const url = `open-artifact://artifact/${board}`;
  await tool('Artifact', { action: 'read', url });
  const write = { client: 'bob-tab', writes: [{ op: 'set', path: 'elements/bybob', data: { type: 'note', x: 0, y: 0, text: 'From Bob', color: 'blue' } }] };
  const wrote = await page(bobPage, 'db/write', write);
  assert.equal(wrote.status, 200, JSON.stringify(wrote.body));
  await waitFor(() => local(board, 'db/elements/bybob.json')?.includes('From Bob'));
  const read = await waitFor(async () => {
    const out = await tool('Artifact', { action: 'read', url });
    return (out.changed_files as string[] | undefined)?.includes('db/elements/bybob.json') ? out : null;
  });
  assert.ok(read);
});

test('a comment sent to the agent on the cloud page reaches the owning session, once', async () => {
  await messages();
  const created = await page<{ thread: { id: string } }>(bobPage, 'comments/create', { input: { anchor: '{"element":"laptop"}', label: 'Note', text: 'Please make it blue' } });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  threadId = created.body.thread.id;
  // Sending to the agent is the owner's (`OWNER_WRITES` in the runtime): Ada sends Bob's thread.
  const sent = await page(boardPage, 'comments/send', { threadId });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const got = await waitFor(async () => {
    const list = await messages();
    return list.length ? list : null;
  });
  assert.equal(got.length, 1, JSON.stringify(got));
  assert.ok(got[0]!.startsWith(COMMENT_HEADER) || got[0]!.startsWith(REQUEST_HEADER), got[0]);
  assert.match(got[0]!, /Please make it blue/);
  assert.match(got[0]!, new RegExp(`open-artifact://artifact/${board}`));
  // Acknowledged on the host; nothing comes twice.
  await waitFor(async () => (await host.catalog.listOutbox(ada.id, 0, 100)).every((row) => row.ackedAt !== null));
  await new Promise((done) => setTimeout(done, 300));
  assert.deepEqual(await messages(), []);
});

test('the agent replies from the daemon and the reply shows on the cloud page', async () => {
  const url = `open-artifact://artifact/${board}`;
  const read = await tool('ArtifactComments', { action: 'read', url });
  assert.equal(read.error, undefined, JSON.stringify(read.error));
  const threads = read.threads as Array<{ id: string; messages: Array<{ text: string }> }>;
  const thread = threads.find((t) => t.messages.some((m) => m.text.includes('Please make it blue')));
  assert.ok(thread, JSON.stringify(threads));
  const replied = await tool('ArtifactComments', { action: 'reply', url, thread_id: thread.id, text: 'Done, it is blue now' });
  assert.equal(replied.error, undefined, JSON.stringify(replied.error));
  const shown = await page<{ threads: Array<{ id: string; messages: Array<{ text: string; author?: { kind?: string } }> }> }>(bobPage, 'comments');
  const onPage = shown.body.threads.find((t) => t.id === threadId);
  assert.ok(onPage?.messages.some((m) => m.text === 'Done, it is blue now'), JSON.stringify(shown.body));
});

test('an ArtifactData write reaches the host and comes home as the agent’s own', async () => {
  const url = `open-artifact://artifact/${board}`;
  await tool('Artifact', { action: 'read', url });
  const wrote = await tool('ArtifactData', { action: 'set', url, collection: 'elements', doc_id: 'byagent', data: { type: 'note', x: 40, y: 40, text: 'By the agent', color: 'green' } });
  assert.equal(wrote.error, undefined, JSON.stringify(wrote.error));
  const got = await page<{ data: { text?: string } | null }>(boardPage, 'db/get?path=elements/byagent');
  assert.equal(got.body.data?.text, 'By the agent');
  await waitFor(() => local(board, 'db/elements/byagent.json')?.includes('By the agent'));
  const read = await tool('Artifact', { action: 'read', url });
  assert.equal(((read.changed_files as string[] | undefined) ?? []).includes('db/elements/byagent.json'), false, JSON.stringify(read.changed_files));
});

test('a Docs action is forwarded to the host, and the doc comes home', async () => {
  const url = `open-artifact://artifact/${doc}`;
  const read = await tool('Artifact', { action: 'call', url, name: 'read', args: {} });
  assert.equal(read.error, undefined, JSON.stringify(read.error));
  assert.match(JSON.stringify(read), /Plan doc/);
  // A tab added on the host (the server is the only writer of doc/): it comes home into the working copy.
  const tabs = (await tool('Artifact', { action: 'call', url, name: 'batch', args: { call: { batch: [{ verb: 'create', object: 'file', payload: { name: 'Notes', markdown: 'From the cloud.' } }] } } })) as ToolCallResult;
  assert.equal(tabs.error, undefined, JSON.stringify(tabs.error));
  await waitFor(() => (onHost(doc, 'doc/doc.json') ?? '').includes('Notes'));
  await waitFor(() => (local(doc, 'doc/doc.json') ?? '').includes('Notes'));
});

test('a published doc exports here, on the working copy brought up to date first; renders are never forwarded', async () => {
  const url = `open-artifact://artifact/${doc}`;
  // A tab written on the host only (its server is the doc's one writer), not yet pulled here.
  const made = (await host.rooms.action(doc, 'batch', { call: { batch: [{ verb: 'create', object: 'file', payload: { name: 'Fresh' } }] } })) as { acks: { minted: string }[] };
  const tab = made.acks[0]!.minted;
  const insert = { op: 'insert', target: { kind: 'root' }, side: 'end', with: { as: 'markdown', from: { kind: 'inline', content: 'Written on the host just now.' } } };
  await host.rooms.action(doc, 'batch', { call: { batch: [{ verb: 'update', ref: { object: 'node', id: tab }, payload: { ops: [insert] } }] } });
  // With `out` the host would refuse the export (it writes no files for an agent): this runs here, after a sync.
  const out = join(tempDir('open-artifact-export-'), 'plan.md');
  const exported = await tool('Artifact', { action: 'call', url, name: 'export', args: { format: 'markdown', out } });
  assert.equal(exported.error, undefined, JSON.stringify(exported.error));
  assert.equal(exported.out, out);
  assert.match(readFileSync(out, 'utf8'), /Written on the host just now\./);
  assert.equal(exported.notes, undefined, 'current: no note');
  // Routing: snapshot and every export format render here; the doc's writes and reads stay the host's.
  const record = daemon.store.require(doc);
  const docs = daemon.types.get('docs')!;
  for (const name of ['export', 'snapshot']) {
    assert.equal(daemon.link.renders(record, docs, name), true, name);
    assert.equal(daemon.link.forwards(record, docs, name), false, name);
  }
  for (const name of ['read', 'batch', 'import', 'create']) assert.equal(daemon.link.forwards(record, docs, name), true, name);
});

test('with the daemon off, the cloud page answers, reads its agent offline, and what was sent meanwhile arrives once', async () => {
  await messages();
  const url = `open-artifact://artifact/${board}`;
  daemon.close();
  await waitFor(() => !host.link.presence.online(ada.id));

  // Both sides change one file while the computer is off.
  writeFileSync(join(rootOf(board), 'db', 'elements', 'laptop.json'), JSON.stringify({ type: 'note', x: 10, y: 20, text: 'Agent version', color: 'yellow' }));
  const bobEdit = await page(bobPage, 'db/write', { client: 'bob-tab', writes: [{ op: 'set', path: 'elements/laptop', data: { type: 'note', x: 10, y: 20, text: 'Bob version', color: 'yellow' } }] });
  assert.equal(bobEdit.status, 200, JSON.stringify(bobEdit.body));

  // The page still answers; its agent reads offline (a wake is kept, not delivered). Only the owner sees the agent
  // as available (`agentFor` in the type server), so this is Ada's page.
  const session = await waitFor(async () => {
    const got = await page<{ agent?: { available: boolean; wakesIdle?: boolean } }>(boardPage, 'session');
    return got.status === 200 && got.body.agent?.wakesIdle === false ? got : null;
  }, 12_000);
  assert.equal(session.body.agent?.available, true, JSON.stringify(session.body.agent));
  const created = await page<{ thread: { id: string } }>(bobPage, 'comments/create', { input: { anchor: '{"element":"bybob"}', label: 'Note', text: 'While you were away' } });
  assert.equal(created.status, 200);
  const sent = await page<{ thread: { agent?: unknown } }>(boardPage, 'comments/send', { threadId: created.body.thread.id });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));

  // The computer comes back.
  await bootDaemon();
  await waitFor(() => host.link.presence.online(ada.id));
  // Every message read is kept: one poll may carry the conflict notice, a later one the comment.
  const seen: string[] = [];
  const got = await waitFor(async () => {
    seen.push(...(await messages()));
    return seen.some((m) => m.includes('While you were away')) ? seen : null;
  });
  assert.equal(got.filter((m) => m.includes('While you were away')).length, 1);
  // The conflict: Bob's version wins the path, the agent's is kept, the agent is told.
  await waitFor(() => local(board, 'db/elements/laptop.json')?.includes('Bob version'));
  assert.match(readFileSync(join(rootOf(board), '_agent', 'conflicts', 'db', 'elements', 'laptop.json'), 'utf8'), /Agent version/);
  assert.match(onHost(board, 'db/elements/laptop.json') ?? '', /Bob version/);
  const told = [...got, ...(await messages())];
  assert.ok(
    told.some((m) => m.includes('db/elements/laptop.json') && m.includes('_agent/conflicts')),
    JSON.stringify(told),
  );
  // Nothing comes twice.
  await new Promise((done) => setTimeout(done, 500));
  assert.equal((await messages()).filter((m) => m.includes('While you were away')).length, 0);
  void url;
});

test('unpublish brings the host’s version home and takes it off the host', async () => {
  for (const id of [board, doc]) {
    const out = await api<{ view_url: string; code?: string }>(state, 'artifacts.unpublish', { id });
    assert.equal(out.code, undefined, JSON.stringify(out));
    assert.ok(out.view_url.startsWith(state.url), out.view_url);
    assert.ok((await host.catalog.getArtifact(id))?.trashedAt);
    assert.equal(daemon.store.require(id).remote ?? null, null);
  }
  assert.ok(existsSync(join(rootOf(board), 'db', 'elements', 'bybob.json')));
  assert.equal((await page(bobPage, 'session')).status === 200, false);
});
