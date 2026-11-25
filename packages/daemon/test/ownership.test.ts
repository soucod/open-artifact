/**
 * Stage B2: every wake says why and from whom (`reason`, `from`); a drafted answer is delivered (no inbox); an answer
 * naming another session hands the artifact over; a write by another session of the same harness and workspace takes
 * an artifact whose owner is gone, and otherwise says once whose it is.
 */

import { tempDir } from './helpers.ts';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { TOOL_ACTION_KINDS, taskMessage, wakeMessage, type SessionRef, type ToolCallResult, type WakePayload } from '@open-artifact/protocol';
import { Inbox } from '../src/inbox.ts';
import { Ownership, handOver, type OwnershipHub } from '../src/ownership.ts';
import { ArtifactStore, sessionKeyOf } from '../src/store.ts';
import { Tools, type ToolsOptions } from '../src/tools.ts';
import { WakeRouter, deliverAnswer, type LiveDelivery } from '../src/wake.ts';

const ART = { id: 'art_from', title: 'From', root: '/tmp/from' };

test('wake source: reason and from on every wake; the text is unchanged', () => {
  const at = new Date().toISOString();
  const own = wakeMessage(ART, [{ id: 't1', messages: [{ from: 'user', text: 'Blue', at }] }], [], { viewUrl: 'v' });
  assert.equal(own.source.reason, 'comment');
  assert.deepEqual(own.source.from, { kind: 'owner' });

  const asked = wakeMessage(ART, [], [{ id: 'r1', text: 'Bigger', sentAt: at }], { viewUrl: 'v' });
  assert.equal(asked.source.reason, 'request');
  assert.deepEqual(asked.source.from, { kind: 'owner' });

  const shared = wakeMessage(ART, [], [{ id: 'r2', text: 'Red', sentAt: at, from: { name: 'Ada https://x.y/z', role: 'editor' } }], { viewUrl: 'v' });
  assert.deepEqual(shared.source.from, { kind: 'collaborator', name: 'Ada [link]', role: 'editor' });
  assert.match(shared.text, /From: Ada \[link\] \(editor, not the owner\)/);

  // Mixed: a comment of the owner and a request of a collaborator. Reason comment; from the collaborator.
  const mixed = wakeMessage(
    ART,
    [{ id: 't2', messages: [{ from: 'user', text: 'Hi', at }] }],
    [{ id: 'r3', text: 'Also', sentAt: at, from: { name: 'Bo', role: 'commenter' } }],
    { viewUrl: 'v' },
  );
  assert.equal(mixed.source.reason, 'comment');
  assert.deepEqual(mixed.source.from, { kind: 'collaborator', name: 'Bo', role: 'commenter' });

  const task = taskMessage(ART, { task: 'task_1', action: 'render', result: { ok: true } }, { viewUrl: 'v' });
  assert.equal(task.source.reason, 'task');
  assert.deepEqual(task.source.from, { kind: 'system' });
});

function router(live: LiveDelivery): { store: ArtifactStore; inbox: Inbox; wake: WakeRouter; logs: string[] } {
  const store = new ArtifactStore();
  const inbox = new Inbox();
  const logs: string[] = [];
  const wake = new WakeRouter({ store, inbox, live: () => live, viewUrl: (id) => `http://127.0.0.1:1/a/${id}`, log: (line) => logs.push(line), mergeMs: 10 });
  return { store, inbox, wake, logs };
}

test('wake: a drafted answer is delivered, nothing waits in the inbox; the router hands the source on', async () => {
  const owner: SessionRef = { harness: 'myide', session: 'chat-1', workspace: null };
  const sent: WakePayload[] = [];
  const { store, inbox, wake } = router({ deliver: async (_ref, payload) => (sent.push(payload), { status: 'drafted' }) });
  const record = store.create({ root: join(tempDir('open-artifact-root-'), 'd'), type: 'design', owner, title: 'Drafted' });
  const result = await wake.ask(record.id, 'Shorter');
  assert.deepEqual(result, { via: 'live', status: 'drafted' });
  assert.equal(inbox.count(sessionKeyOf(owner)!), 0);
  assert.equal(sent[0]!.source?.reason, 'request');
  assert.deepEqual(sent[0]!.source?.from, { kind: 'owner' });
});

test('deliverAnswer: a status or { status, session }; anything else is no answer', () => {
  assert.deepEqual(deliverAnswer('delivered'), { status: 'delivered' });
  assert.deepEqual(deliverAnswer({ status: 'drafted', session: 's-2' }), { status: 'drafted', session: 's-2' });
  assert.equal(deliverAnswer({ status: 'maybe' }), null);
  assert.equal(deliverAnswer(null), null);
  assert.deepEqual(deliverAnswer({ status: 'queued', session: 'bad\nid' }), { status: 'queued' });
});

test('hand-off: an answer naming another session of the harness makes it the owner', async () => {
  const owner: SessionRef = { harness: 'myide', session: 'thread-7', workspace: '/w' };
  const targets: string[] = [];
  const { store, wake, logs } = router({
    deliver: async (ref) => (targets.push(ref.session!), ref.session === 'thread-7' ? { status: 'delivered', session: 'coordinator' } : 'delivered'),
  });
  const record = store.create({ root: join(tempDir('open-artifact-root-'), 'h'), type: 'design', owner, title: 'Handed' });
  const first = await wake.ask(record.id, 'One');
  assert.equal(first.session, 'coordinator');
  assert.deepEqual(store.get(record.id)!.owner, { harness: 'myide', session: 'coordinator', workspace: '/w' });
  assert.match(logs.join('\n'), /handed over/);
  await wake.ask(record.id, 'Two');
  assert.deepEqual(targets, ['thread-7', 'coordinator'], 'the next wake goes straight to the new owner');

  // handOver itself: only from the current owner, never to the same session.
  assert.equal(handOver(store, record.id, owner, 'other', () => undefined), null, 'thread-7 no longer owns it');
  const now: SessionRef = { harness: 'myide', session: 'coordinator', workspace: '/w' };
  assert.equal(handOver(store, record.id, now, 'coordinator', () => undefined), null);
});

/** A hub stand-in. */
function hub(over: Partial<OwnershipHub> = {}): OwnershipHub {
  return { statusOf: () => ({ live: false }), resumes: () => false, seenAt: () => null, workspaceOf: () => null, ...over };
}

function ownership(h: OwnershipHub): { store: ArtifactStore; own: Ownership; make: (owner: SessionRef) => string } {
  const store = new ArtifactStore();
  const own = new Ownership({ store, hub: () => h, log: () => undefined });
  const make = (owner: SessionRef): string => store.create({ root: join(tempDir('open-artifact-root-'), 'o'), type: 'design', owner, title: 'Owned' }).id;
  return { store, own, make };
}

const WS = tempDir('open-artifact-ws-');
const OWNER: SessionRef = { harness: 'claude-code', session: 'old', workspace: WS };
const WRITER: SessionRef = { harness: 'claude-code', session: 'new', workspace: WS };

test('ownership: a gone owner is replaced by the writer of the same harness and workspace', () => {
  const { store, own, make } = ownership(hub());
  const id = make(OWNER);
  const outcome = own.wrote(id, WRITER);
  assert.equal(outcome.moved, true);
  assert.match(outcome.note!, /yours now/);
  assert.deepEqual(store.get(id)!.owner, WRITER);
  // The owner writing its own artifact: nothing.
  assert.deepEqual(own.wrote(id, WRITER), { moved: false, note: null });
});

test('ownership: an owner still there keeps it; the writer is told once that adopt takes it over', () => {
  for (const there of [
    hub({ statusOf: () => ({ live: true }) }),
    hub({ resumes: (harness) => harness === 'claude-code' }),
    hub({ seenAt: () => Date.now() - 60_000 }),
  ]) {
    const { store, own, make } = ownership(there);
    const id = make(OWNER);
    const outcome = own.wrote(id, WRITER);
    assert.equal(outcome.moved, false);
    assert.match(outcome.note!, /belongs to another session \(claude-code:old\).*action: "adopt"/);
    assert.deepEqual(store.get(id)!.owner, OWNER);
    assert.equal(own.wrote(id, WRITER).note, null, 'once');
  }
  // Seen long ago: gone.
  const { own, make } = ownership(hub({ seenAt: () => Date.now() - 3 * 60 * 60_000 }));
  assert.equal(own.wrote(make(OWNER), WRITER).moved, true);
});

test('ownership: never across harnesses or workspaces, and an unowned artifact stays so', () => {
  const { store, own, make } = ownership(hub());
  const other = make(OWNER);
  const codex: SessionRef = { harness: 'codex', session: 'new', workspace: WS };
  assert.equal(own.wrote(other, codex).moved, false);
  assert.deepEqual(store.get(other)!.owner, OWNER);
  const elsewhere: SessionRef = { harness: 'claude-code', session: 'new', workspace: tempDir('open-artifact-ws2-') };
  assert.equal(own.wrote(make(OWNER), elsewhere).moved, false);
  // No workspace known on either side: not the same workspace.
  assert.equal(own.wrote(make({ ...OWNER, workspace: null }), { ...WRITER, workspace: null }).moved, false);
  const unowned = store.create({ root: join(tempDir('open-artifact-root-'), 'u'), type: 'design', title: 'Nobody' }).id;
  assert.deepEqual(own.wrote(unowned, WRITER), { moved: false, note: null });
  assert.equal(store.get(unowned)!.owner ?? null, null);
});

test('ownership: only writes count, through the single call in Tools', async () => {
  const store = new ArtifactStore();
  const inbox = new Inbox();
  const own = new Ownership({ store, hub: () => hub({ statusOf: () => ({ live: true }) }), log: () => undefined });
  const tools = new Tools({
    store,
    inbox,
    harnesses: () => ({ sessions: new Map() }),
    settings: () => ({}),
    viewUrl: (id: string) => `http://127.0.0.1:1/a/${id}`,
    log: () => undefined,
    ownership: own,
  } as unknown as ToolsOptions);
  const record = store.create({ root: join(tempDir('open-artifact-root-'), 't'), type: 'design', owner: OWNER, title: 'Tools' });
  const url = `open-artifact://artifact/${record.id}`;
  const written: ToolCallResult = await tools.call('Artifact', { action: 'publish', url, files: { 'a.txt': 'a' } }, WRITER);
  assert.equal(written.error, undefined, JSON.stringify(written.error));
  assert.ok(written.notes?.some((n) => /belongs to another session/.test(n)));
  const again = await tools.call('Artifact', { action: 'publish', url, files: { 'a.txt': 'b' } }, WRITER);
  assert.ok(!again.notes?.some((n) => /belongs to another session/.test(n)), 'told once');
  // A read is not a write; a failed write changes nothing.
  const other: SessionRef = { harness: 'claude-code', session: 'third', workspace: WS };
  const read = await tools.call('Artifact', { action: 'read', url, path: 'a.txt' }, other);
  assert.ok(!read.notes?.some((n) => /belongs to another session/.test(n)));
  const failed = await tools.call('Artifact', { action: 'publish', url, files: { '../x': 'no' } }, other);
  assert.ok(failed.error);
  assert.equal(failed.notes, undefined);
  // afterTool on ArtifactData writes, and not on its reads.
  const row = own.afterTool('ArtifactData', { action: 'set', url }, other, { ok: true });
  assert.ok(row.notes?.some((n) => /belongs to another session/.test(n)));
  assert.deepEqual(own.afterTool('ArtifactData', { action: 'get', url }, { ...other, session: 'fourth' }, { ok: true }), { ok: true });
  // Every ArtifactData action the protocol counts a write is one here (str_replace among them), and only those.
  for (const [action, kind] of Object.entries(TOOL_ACTION_KINDS.ArtifactData)) {
    const writer: SessionRef = { ...other, session: `data-${action}` };
    const noted = own.afterTool('ArtifactData', { action, url }, writer, { ok: true }).notes?.some((n) => /belongs to another session/.test(n)) ?? false;
    assert.equal(noted, kind === 'write', `ArtifactData ${action} (${kind})`);
  }
});

/** Tools with a stand-in type server: `fill` writes, `peek` reads. */
function toolsWith(own: Ownership, store: ArtifactStore): Tools {
  return new Tools({
    store,
    inbox: new Inbox(),
    types: { get: () => ({ id: 'sheet', entry: { kind: 'url', actions: true } }) },
    typeActions: async () => [
      { name: 'fill', title: 'Fill cells', effect: 'write' },
      { name: 'peek', title: 'Read cells', effect: 'read' },
    ],
    typeAction: async () => ({ ok: true }),
    openPage: async () => undefined,
    harnesses: () => ({ sessions: new Map() }),
    settings: () => ({}),
    viewUrl: (id: string) => `http://127.0.0.1:1/a/${id}`,
    log: () => undefined,
    ownership: own,
  } as unknown as ToolsOptions);
}

test('ownership: a write action (Artifact call) counts; a read action does not', async () => {
  const store = new ArtifactStore();
  const own = new Ownership({ store, hub: () => hub(), log: () => undefined });
  const tools = toolsWith(own, store);
  const record = store.create({ root: join(tempDir('open-artifact-root-'), 's'), type: 'sheet', owner: OWNER, title: 'Sheet' });
  const url = `open-artifact://artifact/${record.id}`;
  const read = await tools.call('Artifact', { action: 'call', url, name: 'peek' }, WRITER);
  assert.equal(read.error, undefined, JSON.stringify(read.error));
  assert.deepEqual(store.get(record.id)!.owner, OWNER, 'a read moves nothing');
  const wrote = await tools.call('Artifact', { action: 'call', url, name: 'fill' }, WRITER);
  assert.equal(wrote.error, undefined, JSON.stringify(wrote.error));
  assert.deepEqual(store.get(record.id)!.owner, WRITER, 'the owner was gone: the writer owns it');
  assert.ok(wrote.notes?.some((n) => /yours now/.test(n)));
});

test('ownership: files an adapter saw the agent write (agent.wrote) count; the line comes with the next tool result', async () => {
  const store = new ArtifactStore();
  const own = new Ownership({ store, hub: () => hub({ statusOf: (ref) => ({ live: ref?.session === 'old' }) }), log: () => undefined });
  const tools = toolsWith(own, store);
  const root = join(WS, 'deck');
  const record = store.create({ root, type: 'slides', owner: OWNER, title: 'Deck' });
  assert.deepEqual(tools.agentWrote(WRITER, ['deck/slides/01.html']).artifacts, [`open-artifact://artifact/${record.id}`]);
  assert.deepEqual(store.get(record.id)!.owner, OWNER, 'the owner is live: it keeps it');
  const next = await tools.call('Artifact', { action: 'list' }, WRITER);
  assert.ok(next.notes?.some((n) => n.includes(record.id) && /belongs to another session.*adopt/.test(n)), JSON.stringify(next.notes));
  const after = await tools.call('Artifact', { action: 'list' }, WRITER);
  assert.ok(!after.notes?.some((n) => /belongs to another session/.test(n)), 'said once');

  // Gone: agent.wrote moves it.
  const gone = new Ownership({ store, hub: () => hub(), log: () => undefined });
  toolsWith(gone, store).agentWrote(WRITER, [join(root, 'deck.json')]);
  assert.deepEqual(store.get(record.id)!.owner, WRITER);
});
