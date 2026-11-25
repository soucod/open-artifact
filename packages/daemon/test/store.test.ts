import { tempDir } from './helpers.ts';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { SessionRef, WakePayload } from '@open-artifact/protocol';
import { Inbox } from '../src/inbox.ts';
import { ArtifactStore, sessionKeyOf } from '../src/store.ts';
import { UNOWNED_KEY, WakeRouter, type LiveDelivery } from '../src/wake.ts';

const owner: SessionRef = { harness: 'dsh', session: 's1', workspace: tempDir('open-artifact-ws-') };

test('store: create, get, list, update, remove and restore', () => {
  const store = new ArtifactStore();
  const changes: string[] = [];
  store.on('changed', (change) => changes.push(`${change.id}${change.removed ? ':removed' : ''}`));
  const root = join(tempDir('open-artifact-root-'), 'one');
  const record = store.create({ root, type: 'design', owner, title: 'One' });
  assert.match(record.id, /^art_[0-9a-z]+$/);
  assert.ok(existsSync(join(root, '.artifact.json')), 'writes the folder marker');
  assert.equal(store.get(record.id)?.title, 'One');
  assert.equal(store.byRoot(root)?.id, record.id);
  assert.equal(store.require(`open-artifact://artifact/${record.id}`).id, record.id);
  assert.throws(() => store.require('art_missing'), { code: 'not_found' });

  const second = store.create({ root: join(tempDir('open-artifact-root-'), 'two'), type: 'design', title: 'Two' });
  store.update(record.id, { pinnedAt: new Date().toISOString() });
  assert.deepEqual(
    store.list().map((r) => r.id),
    [record.id, second.id],
    'pinned first',
  );

  assert.ok(store.remove(record.id));
  assert.equal(store.get(record.id), null);
  assert.equal(store.restore(record.id)?.id, record.id);
  assert.equal(store.get(record.id)?.title, 'One');
  assert.ok(changes.includes(`${record.id}:removed`));
});

test('inbox: append, peek, take and wait', async () => {
  const inbox = new Inbox();
  const key = sessionKeyOf(owner)!;
  assert.deepEqual(inbox.append(key, { kind: 'wake', text: 'first' }), { taken: false });
  assert.equal(inbox.count(key), 1);
  assert.equal(inbox.peek(key)[0]?.text, 'first');
  assert.equal(inbox.take(key).length, 1);
  assert.equal(inbox.count(key), 0);

  const waiting = inbox.wait(key, 2000);
  assert.ok(inbox.waiting(key));
  assert.deepEqual(inbox.append(key, { kind: 'wake', text: 'second' }), { taken: true });
  const got = await waiting;
  assert.equal(got[0]?.text, 'second');
  assert.equal(inbox.count(key), 0, 'a waiter takes it; nothing stays behind');
  assert.deepEqual(await inbox.wait(key, 30), [], 'times out empty');
});

function router(live: LiveDelivery | null): { store: ArtifactStore; inbox: Inbox; wake: WakeRouter } {
  const store = new ArtifactStore();
  const inbox = new Inbox();
  const wake = new WakeRouter({ store, inbox, live: () => live, viewUrl: (id) => `http://127.0.0.1:1/a/${id}`, log: () => undefined, mergeMs: 60 });
  return { store, inbox, wake };
}

test('wake: items in the merge window go out as one delivery', async () => {
  const delivered: WakePayload[] = [];
  const { store, wake } = router({
    deliver: async (_ref, payload) => {
      delivered.push(payload);
      return 'delivered';
    },
  });
  const record = store.create({ root: join(tempDir('open-artifact-root-'), 'w'), type: 'design', owner, title: 'Wake' });
  const results = await Promise.all([
    wake.queue(record.id, { thread: { id: 't1', messages: [{ from: 'user', text: 'Make it blue', at: new Date().toISOString() }] } }),
    wake.ask(record.id, 'And bigger'),
  ]);
  assert.equal(delivered.length, 1, 'merged into one');
  assert.match(delivered[0]!.text, /Make it blue/);
  assert.match(delivered[0]!.text, /And bigger/);
  assert.equal(delivered[0]!.artifactId, record.id);
  for (const result of results) assert.equal(result.via, 'live');
});

test('wake: an inbox wake nudges its session; a live one does not', async () => {
  const owner: SessionRef = { harness: 'antigravity', session: 'conv-nudge', workspace: null };
  const nudged: Array<{ target: SessionRef; artifact: string }> = [];
  const make = (live: LiveDelivery): { store: ArtifactStore; wake: WakeRouter } => {
    const store = new ArtifactStore();
    const wake = new WakeRouter({
      store,
      inbox: new Inbox(),
      live: () => live,
      viewUrl: (id) => `http://127.0.0.1:1/a/${id}`,
      log: () => undefined,
      mergeMs: 20,
      nudge: (target, payload) => nudged.push({ target, artifact: payload.artifact }),
    });
    return { store, wake };
  };
  const idle = make({ deliver: async () => null });
  const queued = idle.store.create({ root: join(tempDir('open-artifact-root-'), 'n'), type: 'design', owner, title: 'Nudged' });
  assert.equal((await idle.wake.ask(queued.id, 'Shorter, please')).via, 'inbox');
  assert.equal(nudged.length, 1);
  assert.deepEqual(nudged[0]!.target, owner);
  assert.match(nudged[0]!.artifact, new RegExp(queued.id));

  const orphan = idle.store.create({ root: join(tempDir('open-artifact-root-'), 'o'), type: 'design', title: 'Orphan' });
  await idle.wake.ask(orphan.id, 'Anyone?');
  assert.equal(nudged.length, 1, 'no owner, nobody to nudge');

  const live = make({ deliver: async () => 'delivered' });
  const shown = live.store.create({ root: join(tempDir('open-artifact-root-'), 'l'), type: 'design', owner, title: 'Live' });
  assert.equal((await live.wake.ask(shown.id, 'Hi')).via, 'live');
  assert.equal(nudged.length, 1, 'delivered live, no nudge');
});

test('wake: a session already nudged is not nudged again until it takes its inbox', async () => {
  const owner: SessionRef = { harness: 'codex', session: 'thread-nudge-once', workspace: null };
  let nudges = 0;
  const store = new ArtifactStore();
  const inbox = new Inbox();
  const wake = new WakeRouter({
    store,
    inbox,
    live: () => ({ deliver: async () => null }),
    viewUrl: (id) => `http://127.0.0.1:1/a/${id}`,
    log: () => undefined,
    mergeMs: 10,
    nudge: () => void nudges++,
  });
  const key = sessionKeyOf(owner)!;
  inbox.take(key);
  const record = store.create({ root: join(tempDir('open-artifact-root-'), 'q'), type: 'design', owner, title: 'Queued' });
  await wake.ask(record.id, 'One');
  await wake.ask(record.id, 'Two');
  assert.equal(nudges, 1, 'the first nudge’s turn takes both');
  assert.equal(inbox.count(key), 2);
  inbox.take(key);
  await wake.ask(record.id, 'Three');
  assert.equal(nudges, 2, 'taken: the next wake nudges again');
  inbox.take(key);
});

test('wake: with nobody live it waits in the owner inbox, or the unowned one', async () => {
  const { store, inbox, wake } = router({ deliver: async () => null });
  const owned = store.create({ root: join(tempDir('open-artifact-root-'), 'a'), type: 'design', owner, title: 'Owned' });
  assert.equal((await wake.ask(owned.id, 'Hello')).via, 'inbox');
  const waiting = inbox.peek(sessionKeyOf(owner)!);
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0]?.artifactId, owned.id);
  assert.match(waiting[0]!.text, /Hello/);

  const orphan = store.create({ root: join(tempDir('open-artifact-root-'), 'b'), type: 'design', title: 'Orphan' });
  assert.equal((await wake.ask(orphan.id, 'Anyone?')).via, 'inbox');
  assert.ok(inbox.peek(UNOWNED_KEY).some((m) => m.artifactId === orphan.id));
});
