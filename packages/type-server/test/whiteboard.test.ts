/**
 * The Whiteboard type on the local type server: its document store
 * (`_api/db/*`), comment threads (`_api/comments*`), room messages, the
 * watcher that reports the agent's disk edits, and the reserved actions the
 * daemon's ArtifactData / ArtifactComments tools call.
 */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createLocalProvider } from '@open-artifact/runtime';
import type { DbChangeEvent, RoomMessage } from '@open-artifact/runtime/capabilities';
import { docSha256 } from '@open-artifact/server-sdk/db';
import { createTypeServer, detectType, main, pending, type TypeServer } from '../src/index.ts';

/** Resolves once `ready()` holds, polling. */
async function until(ready: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!ready()) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((done) => setTimeout(done, 10));
  }
}

/** One page's event stream (SSE), keeping frames that arrive together. */
interface EventStream {
  next(predicate: (name: string, data: unknown) => boolean, timeoutMs?: number): Promise<{ name: string; data: unknown }>;
  close(): Promise<void>;
}

async function openEvents(page: string, client: string): Promise<EventStream> {
  const response = await fetch(new URL(`_api/events?client=${client}`, page));
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const frames: { name: string; data: unknown }[] = [];
  let buffer = '';
  const stream: EventStream = {
    async next(predicate, timeoutMs = 4000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const index = frames.findIndex((f) => predicate(f.name, f.data));
        if (index >= 0) return frames.splice(0, index + 1).pop()!;
        frames.length = 0;
        const left = deadline - Date.now();
        if (left <= 0) throw new Error('timed out waiting for event');
        let timer: NodeJS.Timeout | undefined;
        const chunk = await Promise.race([reader.read(), new Promise<null>((done) => (timer = setTimeout(() => done(null), left)))]);
        clearTimeout(timer);
        if (!chunk) continue;
        if (chunk.done) throw new Error('event stream ended');
        buffer += decoder.decode(chunk.value, { stream: true });
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const name = /^event: (.*)$/m.exec(frame)?.[1];
          const data = /^data: (.*)$/m.exec(frame)?.[1];
          if (name && data) frames.push({ name, data: JSON.parse(data) as unknown });
        }
      }
    },
    close: () => reader.cancel(),
  };
  await stream.next((name) => name === 'peers');
  return stream;
}

interface DbEvent {
  changes: Record<string, Record<string, unknown> | null>;
  author?: string;
  epoch?: string;
  seq?: number;
}

interface PageThread {
  id: string;
  anchor: string;
  label: string;
  location: Record<string, unknown>;
  status: 'open' | 'resolved';
  agent?: { status: string };
  messages: {
    id: string;
    author: { kind: string; name: string };
    text: string;
    to?: string[];
    editedAt?: string;
    reactions?: { emoji: string; authors: { kind: string; name: string }[] }[];
  }[];
}

describe('whiteboard type server', () => {
  let dir: string;
  let root: string;
  let server: TypeServer;
  let page: string;
  const secret = 'test-secret';

  /** POSTs JSON to a page route. */
  const post = (path: string, body: unknown): Promise<Response> =>
    fetch(new URL(path, page), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const write = (client: string, writes: unknown[]): Promise<Response> => post('_api/db/write', { client, writes });
  const get = async (path: string): Promise<unknown> =>
    ((await (await fetch(new URL(`_api/db/get?path=${encodeURIComponent(path)}`, page))).json()) as { data: unknown }).data;
  /** Runs a daemon action. */
  const action = (name: string, args: Record<string, unknown>, at = root): Promise<Response> =>
    fetch(new URL(`/__open-artifact/actions/${name}`, page), {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'x', root: at, args }),
    });

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'open-artifact-whiteboard-'));
    const assets = join(dir, 'assets');
    await mkdir(join(assets, 'editors', 'whiteboard'), { recursive: true });
    await writeFile(join(assets, 'editors', 'whiteboard', 'index.html'), '<!doctype html><title>Whiteboard</title>');
    await writeFile(join(assets, 'support.js'), '/* runtime */');
    root = join(dir, 'Retro');
    server = createTypeServer({ assetsDir: assets, secret, idleMs: 0, viewerName: 'Ada', downloadsDir: join(dir, 'downloads') });
    await server.listen();
    page = (await server.open({ root, type: 'whiteboard', title: 'Retro' })).url;
  });

  after(async () => {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it('scaffolds an empty board and offers the db, comments and history stores', async () => {
    assert.deepEqual(JSON.parse(await readFile(join(root, 'db', 'board', 'meta.json'), 'utf8')), { v: 1, title: 'Retro', order: [] });
    assert.deepEqual(JSON.parse(await readFile(join(root, 'db', 'board', 'inks.json'), 'utf8')), { colors: {} });
    assert.equal(await detectType(root), 'whiteboard');
    assert.match(await (await fetch(page)).text(), /<title>Whiteboard<\/title>/);
    const session = (await (await fetch(new URL('_api/session', page))).json()) as {
      artifact: { title: string; type: string };
      stores?: { db?: boolean; comments?: boolean; history?: boolean };
    };
    assert.equal(session.artifact.title, 'Retro');
    assert.deepEqual(session.stores, { db: true, comments: true, history: true });
    assert.equal((await server.open({ root, type: 'whiteboard' })).url, page);
  });

  it('reads and writes documents, merging updates (RFC 7396)', async () => {
    const res = await write('a', [
      { op: 'set', path: 'elements/n1', data: { type: 'note', x: 0, y: 0, text: 'Hi', color: 'yellow' } },
      { op: 'update', path: 'board/meta', patch: { order: ['n1'] } },
    ]);
    assert.equal(res.status, 200);
    assert.deepEqual(await get('board/meta'), { v: 1, title: 'Retro', order: ['n1'] });
    assert.deepEqual(JSON.parse(await readFile(join(root, 'db', 'elements', 'n1.json'), 'utf8')), { type: 'note', x: 0, y: 0, text: 'Hi', color: 'yellow' });

    // null removes a key; nested objects merge.
    await write('a', [{ op: 'update', path: 'elements/n1', patch: { color: null, w: 200, style: { bold: true } } }]);
    await write('a', [{ op: 'update', path: 'elements/n1', patch: { style: { italic: true } } }]);
    assert.deepEqual(await get('elements/n1'), { type: 'note', x: 0, y: 0, text: 'Hi', w: 200, style: { bold: true, italic: true } });

    const listed = (await (await fetch(new URL('_api/db/list?collection=elements', page))).json()) as { documents: { path: string; data: unknown }[] };
    assert.deepEqual(listed.documents.map((d) => d.path), ['elements/n1']);

    await write('a', [{ op: 'set', path: 'elements/tmp', data: { type: 'note', x: 9, y: 9, text: '' } }]);
    await write('a', [{ op: 'delete', path: 'elements/tmp' }]);
    assert.equal(await get('elements/tmp'), null);
    assert.equal(existsSync(join(root, 'db', 'elements', 'tmp.json')), false);
  });

  it('refuses a bad batch whole', async () => {
    const many = Array.from({ length: 501 }, (_, i) => ({ op: 'set', path: `elements/m${i}`, data: { type: 'note', x: i, y: 0, text: '' } }));
    assert.equal((await write('a', many)).status, 400);
    assert.equal(await get('elements/m0'), null);

    const mixed = [
      { op: 'set', path: 'elements/ok', data: { type: 'note', x: 0, y: 0, text: '' } },
      { op: 'rename', path: 'elements/ok' },
    ];
    assert.equal((await write('a', mixed)).status, 400);
    assert.equal(await get('elements/ok'), null);

    assert.equal((await write('a', [{ op: 'set', path: 'elements/big', data: { text: 'x'.repeat(300_000) } }])).status, 400);
    assert.equal((await write('a', [{ op: 'set', path: '../escape', data: {} }])).status, 400);
    assert.equal((await write('a', [{ op: 'set', path: 'elements', data: {} }])).status, 400);
    let deep: Record<string, unknown> = {};
    for (let i = 0; i < 40; i++) deep = { d: deep };
    assert.equal((await write('a', [{ op: 'set', path: 'elements/deep', data: deep }])).status, 400);
    assert.equal((await write('a', [])).status, 400);
  });

  it("tells other pages about a page's writes, not the writer, and reports disk edits as the agent's", async () => {
    const a = await openEvents(page, 'a');
    const b = await openEvents(page, 'b');
    try {
      const data = { type: 'note', x: 1, y: 2, text: 'From a' };
      await write('a', [{ op: 'set', path: 'elements/e1', data }]);
      const seen = (await b.next((name) => name === 'db')).data as DbEvent;
      // Each event carries its place in the store's order.
      const { epoch, seq, ...rest } = seen;
      assert.deepEqual(rest, { changes: { 'elements/e1': data }, author: 'a' });
      assert.equal(typeof epoch, 'string');
      assert.equal(typeof seq, 'number');

      // An edit straight to disk (the agent's file tools).
      await writeFile(join(root, 'db', 'elements', 'e2.json'), JSON.stringify({ type: 'note', x: 5, y: 5, text: 'From disk' }));
      // a's first db event is the agent's: its own write was never echoed, nor re-reported by the watcher.
      const agent = (await a.next((name) => name === 'db')).data as DbEvent;
      assert.equal(agent.author, 'agent');
      assert.equal(agent.epoch, epoch);
      assert.equal(agent.seq, seq! + 1, 'the next change in the order');
      assert.deepEqual(agent.changes, { 'elements/e2': { type: 'note', x: 5, y: 5, text: 'From disk' } });
      assert.deepEqual(((await b.next((name) => name === 'db')).data as DbEvent).changes, agent.changes);

      await unlink(join(root, 'db', 'elements', 'e2.json'));
      assert.deepEqual(((await a.next((name) => name === 'db')).data as DbEvent).changes, { 'elements/e2': null });
    } finally {
      await a.close();
      await b.close();
    }
  });

  it('relays room messages to the other pages only', async () => {
    const a = await openEvents(page, 'ra');
    const b = await openEvents(page, 'rb');
    try {
      assert.equal((await post('_api/room/emit', { client: 'ra', topic: 'cursor', data: { x: 1, y: 2 } })).status, 200);
      assert.deepEqual((await b.next((name) => name === 'room')).data, { from: 'ra', topic: 'cursor', data: { x: 1, y: 2 } });
      await post('_api/room/emit', { client: 'rb', topic: 'reaction', data: '👍' });
      // a never hears its own message: its first room message is b's.
      assert.deepEqual((await a.next((name) => name === 'room')).data, { from: 'rb', topic: 'reaction', data: '👍' });

      assert.equal((await post('_api/room/emit', { client: 'ra', topic: 'bad topic!', data: 1 })).status, 400);
      assert.equal((await post('_api/room/emit', { client: 'ra', topic: 'big', data: 'x'.repeat(17_000) })).status, 400);
      assert.equal((await post('_api/room/emit', { topic: 'cursor', data: 1 })).status, 400);
    } finally {
      await a.close();
      await b.close();
    }
  });

  it('keeps comment threads and hands one to the agent', async () => {
    const events = await openEvents(page, 'c');
    try {
      const created = await post('_api/comments/create', {
        input: { anchor: JSON.stringify({ element: 'n1' }), label: 'Note "Hi"', text: 'Too vague', location: { x: 0, y: 0 } },
      });
      assert.equal(created.status, 200);
      const { thread } = (await created.json()) as { thread: PageThread };
      assert.equal(thread.status, 'open');
      assert.equal(thread.label, 'Note "Hi"');
      assert.deepEqual(thread.messages.map((m) => [m.author.kind, m.author.name, m.text]), [['person', 'Ada', 'Too vague']]);
      const pushed = (await events.next((name) => name === 'comments')).data as PageThread[];
      assert.deepEqual(pushed.map((t) => t.id), [thread.id]);
      assert.ok(existsSync(join(root, 'comments.json')));

      const replied = ((await (await post('_api/comments/reply', { threadId: thread.id, text: 'Agreed' })).json()) as { thread: PageThread }).thread;
      assert.equal(replied.messages.length, 2);
      const addressed = ((await (await post('_api/comments/reply', { threadId: thread.id, text: 'Over to you', to: ['agent', 'agent'] })).json()) as { thread: PageThread })
        .thread;
      assert.deepEqual(addressed.messages[2]!.to, ['agent']);
      const firstId = thread.messages[0]!.id;
      const edited = ((await (await post('_api/comments/edit', { threadId: thread.id, messageId: firstId, text: 'Too vague, say more' })).json()) as { thread: PageThread }).thread;
      assert.equal(edited.messages[0]!.text, 'Too vague, say more');
      assert.ok(edited.messages[0]!.editedAt);
      const react = async (emoji: string, on: boolean) =>
        ((await (await post('_api/comments/react', { threadId: thread.id, messageId: firstId, emoji, on })).json()) as { thread: PageThread }).thread;
      await react('👍', true);
      await react('👍', true);
      const liked = await react('🎉', true);
      assert.deepEqual(liked.messages[0]!.reactions, [
        { emoji: '👍', authors: [{ kind: 'person', name: 'Ada' }] },
        { emoji: '🎉', authors: [{ kind: 'person', name: 'Ada' }] },
      ]);
      const unliked = await react('👍', false);
      assert.deepEqual(unliked.messages[0]!.reactions?.map((r) => r.emoji), ['🎉']);
      assert.equal((await post('_api/comments/react', { threadId: thread.id, messageId: firstId, emoji: '', on: true })).status, 400);
      await post('_api/comments/remove', { threadId: thread.id, messageId: addressed.messages[2]!.id });

      const resolved = ((await (await post('_api/comments/resolve', { threadId: thread.id, resolved: true })).json()) as { thread: PageThread }).thread;
      assert.equal(resolved.status, 'resolved');
      const reopened = ((await (await post('_api/comments/resolve', { threadId: thread.id, resolved: false })).json()) as { thread: PageThread }).thread;
      assert.equal(reopened.status, 'open');

      const moved = ((await (await post('_api/comments/move', { threadId: thread.id, anchor: '{"element":"n2"}', location: { x: 40 } })).json()) as { thread: PageThread })
        .thread;
      assert.equal(moved.anchor, '{"element":"n2"}');
      assert.deepEqual(moved.location, { x: 40 });

      const trimmed = (await (await post('_api/comments/remove', { threadId: thread.id, messageId: replied.messages[1]!.id })).json()) as { threads: PageThread[] };
      assert.equal(trimmed.threads[0]!.messages.length, 1);

      // Send: marked for the agent and queued (no daemon here).
      const sent = await post('_api/comments/send', { threadId: thread.id });
      assert.equal(sent.status, 200);
      assert.ok(((await sent.json()) as { thread: PageThread }).thread.agent);
      const queued = await pending(root);
      assert.ok(queued.some((item) => item.request.text.includes('Note "Hi"')));

      const listed = (await (await fetch(new URL('_api/comments', page))).json()) as { threads: PageThread[] };
      assert.equal(listed.threads.length, 1);
      assert.equal((await post('_api/comments/reply', { threadId: 'c_nope', text: 'x' })).status, 404);

      const gone = (await (await post('_api/comments/remove', { threadId: thread.id })).json()) as { threads: PageThread[] };
      assert.deepEqual(gone.threads, []);
    } finally {
      await events.close();
    }
  });

  it('answers the ArtifactData and ArtifactComments actions, and pages hear about them', async () => {
    const events = await openEvents(page, 'p');
    try {
      const all = (await (await action('open-artifact.db.read', {})).json()) as { root: string; documents: { path: string }[] };
      assert.equal(all.root, 'db');
      assert.ok(all.documents.some((d) => d.path === 'board/meta'));
      const meta = (await (await action('open-artifact.db.read', { path: 'board/meta' })).json()) as { exists: boolean; data: { title: string } };
      assert.equal(meta.exists, true);
      assert.equal(meta.data.title, 'Retro');

      const wrote = await action('open-artifact.db.write', {
        writes: [
          { op: 'set', path: 'elements/a1', data: { type: 'note', x: 0, y: 0, text: 'Agent', color: 'blue' } },
          { op: 'update', path: 'elements/a1', data: { color: { __delete__: true } } },
        ],
      });
      assert.equal(wrote.status, 400, 'one batch names a document once');
      const ok = (await (
        await action('open-artifact.db.write', { writes: [{ op: 'set', path: 'elements/a1', data: { type: 'note', x: 0, y: 0, text: 'Agent', color: 'blue' } }] })
      ).json()) as { writes: { op: string; path: string; created?: boolean }[] };
      assert.deepEqual(ok.writes.map((w) => [w.op, w.path, w.created]), [['set', 'elements/a1', true]]);
      const heard = (await events.next((name) => name === 'db')).data as DbEvent;
      assert.deepEqual({ changes: heard.changes, author: heard.author }, { changes: { 'elements/a1': { type: 'note', x: 0, y: 0, text: 'Agent', color: 'blue' } }, author: 'agent' });

      // A set over an existing document without if_match is refused when the daemon asks; a stale one conflicts.
      const unguarded = await action('open-artifact.db.write', { writes: [{ op: 'set', path: 'elements/a1', data: { type: 'note', x: 0, y: 0, text: 'X' } }], require_if_match: true });
      assert.equal(unguarded.status, 400);
      assert.match(((await unguarded.json()) as { fix: string }).fix, /if_match/);
      const stale = await action('open-artifact.db.write', { writes: [{ op: 'set', path: 'elements/a1', data: { type: 'note', x: 0, y: 0, text: 'X' }, if_match: '0'.repeat(64) }] });
      assert.equal(stale.status, 409);
      const conflict = (await stale.json()) as { code: string; current: Record<string, { data: { text: string } }> };
      assert.equal(conflict.code, 'conflict');
      assert.equal(conflict.current['elements/a1']!.data.text, 'Agent');
      const a1 = (await (await action('open-artifact.db.read', { path: 'elements/a1' })).json()) as { sha256: string };
      assert.match(a1.sha256, /^[0-9a-f]{64}$/);
      await action('open-artifact.db.write', { writes: [{ op: 'update', path: 'elements/a1', data: { color: { __delete__: true } }, if_match: a1.sha256 }] });
      assert.deepEqual(((await events.next((name) => name === 'db')).data as DbEvent).changes, { 'elements/a1': { type: 'note', x: 0, y: 0, text: 'Agent' } });
      assert.deepEqual(await get('elements/a1'), { type: 'note', x: 0, y: 0, text: 'Agent' });

      // The watcher does not report the action's writes a second time: the next db event is this disk edit.
      await writeFile(join(root, 'db', 'elements', 'a2.json'), JSON.stringify({ type: 'note', x: 1, y: 1, text: 'Next' }));
      assert.deepEqual(Object.keys(((await events.next((name) => name === 'db')).data as DbEvent).changes), ['elements/a2']);

      const made = ((await (await post('_api/comments/create', { input: { anchor: '{}', label: 'The board', text: 'Add a title' } })).json()) as { thread: PageThread })
        .thread;
      const read = (await (await action('open-artifact.comments.read', {})).json()) as { threads: { id: string; n: number; where: string; messages: { from: string }[] }[] };
      assert.deepEqual(read.threads.map((t) => [t.id, t.n, t.where]), [[made.id, 1, 'The board']]);
      assert.equal(read.threads[0]!.messages[0]!.from, 'user');

      const reply = (await (await action('open-artifact.comments.reply', { thread_id: made.id, text: 'Done', resolve: true })).json()) as { thread: { status: string } };
      assert.equal(reply.thread.status, 'resolved');
      const threads = (await events.next((name, data) => name === 'comments' && (data as PageThread[])[0]?.messages.length === 2)).data as PageThread[];
      assert.deepEqual(threads[0]!.messages[1]!.author.kind, 'agent');
      assert.equal(((await (await action('open-artifact.comments.read', {})).json()) as { threads: unknown[] }).threads.length, 0);
      assert.equal(((await (await action('open-artifact.comments.read', { all: true })).json()) as { threads: unknown[] }).threads.length, 1);

      const reopened = (await (await action('open-artifact.comments.resolve', { thread_id: made.id, reopen: true })).json()) as { thread: { status: string } };
      assert.equal(reopened.thread.status, 'open');
      assert.equal((await action('open-artifact.comments.nope', {})).status, 404);
    } finally {
      await events.close();
    }
  });

  it('serves the actions for a board that is not open', async () => {
    const other = join(dir, 'Closed board');
    await mkdir(join(other, 'db', 'board'), { recursive: true });
    await writeFile(join(other, 'db', 'board', 'meta.json'), JSON.stringify({ v: 1, title: 'Closed', order: [] }));
    const res = await action('open-artifact.db.write', { writes: [{ op: 'set', path: 'elements/z', data: { type: 'note', x: 0, y: 0, text: 'z' } }] }, other);
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(await readFile(join(other, 'db', 'elements', 'z.json'), 'utf8')), { type: 'note', x: 0, y: 0, text: 'z' });
    const notBoard = join(dir, 'plain');
    await mkdir(notBoard, { recursive: true });
    const refused = await action('open-artifact.db.read', {}, notBoard);
    assert.equal(refused.status, 404);
    assert.equal(((await refused.json()) as { code: string }).code, 'unknown_action');
  });

  it('checks a board', async () => {
    const board = join(dir, 'Check');
    const docs = join(board, 'db');
    await mkdir(join(docs, 'board'), { recursive: true });
    await mkdir(join(docs, 'elements'), { recursive: true });
    await writeFile(join(docs, 'board', 'meta.json'), JSON.stringify({ v: 1, title: 'Check', order: ['r1', 'ghost'] }));
    await writeFile(join(docs, 'elements', 'r1.json'), JSON.stringify({ type: 'shape', shape: 'rect', x: 0, y: 0, w: 100, h: 60 }));
    await writeFile(join(docs, 'elements', 'r2.json'), JSON.stringify({ type: 'shape', shape: 'rect', x: 200, y: 0, w: 100, h: 60 }));
    await writeFile(join(docs, 'elements', 'broken.json'), '{ nope');
    const res = (await (await action('check', {}, board)).json()) as { check: { problems: number; findings: { file: string; level: string; message: string }[] } };
    const found = res.check.findings.map((f) => [f.level, f.file]);
    assert.deepEqual(
      found.sort(),
      [
        ['error', 'db/elements/broken.json'],
        ['warning', 'db/board/meta.json'],
        ['warning', 'db/elements/r2.json'],
      ].sort(),
    );
    assert.equal(res.check.problems, 1);
    // The scaffold of an open board is clean.
    const clean = (await (await action('check', {}, join(dir, 'Closed board'))).json()) as { check: { problems: number } };
    assert.equal(clean.check.problems, 0);
  });

  it('writes and checks drawing styles, placeholders, table tints and ended claims', async () => {
    const board = join(dir, 'Tints');
    await mkdir(join(board, 'db', 'board'), { recursive: true });
    await writeFile(join(board, 'db', 'board', 'meta.json'), JSON.stringify({ v: 1, title: 'Tints', order: [] }));
    const drawing = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="4" height="4"/></svg>').toString('base64')}`;
    const table = { type: 'table', x: 0, y: 200, cols: { c1: { at: 1 }, c2: { at: 2 } }, rows: { r1: { at: 1, c1: 'Name', c2: 'Score' }, r2: { at: 2, c1: 'a', c2: '12' } } };
    const writes = [
      { op: 'set', path: 'elements/d1', data: { type: 'image', x: 0, y: 0, w: 100, h: 100, src: drawing, style: 'comic' } },
      { op: 'set', path: 'elements/t1', data: { type: 'text', x: 200, y: 0, text: '', placeholder: 'Write the goal' } },
      { op: 'set', path: 'elements/tb', data: { ...table, fills: { r2: { c1: 'blue' } }, heat: { cols: { c2: 'green' } } } },
      { op: 'update', path: 'board/meta', data: { order: ['d1', 't1', 'tb'] } },
      { op: 'set', path: 'board/claim-c1234567', data: { x: 0, y: 0, w: 300, h: 200 } },
    ];
    assert.equal((await action('open-artifact.db.write', { writes }, board)).status, 200);
    type Check = { check: { problems: number; findings: { file: string; level: string; message: string }[] } };
    const claimed = (await (await action('check', {}, board)).json()) as Check;
    assert.deepEqual(
      claimed.check.findings.map((finding) => [finding.level, finding.file]),
      [['warning', 'db/board/claim-c1234567.json']],
      'a claim that still frames an area asks to be ended',
    );

    // Ending the claim with {} is accepted and leaves the board clean.
    assert.equal((await action('open-artifact.db.write', { writes: [{ op: 'set', path: 'board/claim-c1234567', data: {} }] }, board)).status, 200);
    assert.deepEqual(JSON.parse(await readFile(join(board, 'db', 'board', 'claim-c1234567.json'), 'utf8')), {});
    const ended = (await (await action('check', {}, board)).json()) as Check;
    assert.deepEqual(ended.check.findings, []);
    assert.equal(ended.check.problems, 0);

    await action('open-artifact.db.write', { writes: [{ op: 'update', path: 'elements/d1', data: { style: 'oil' } }] }, board);
    const styled = (await (await action('check', {}, board)).json()) as Check;
    assert.equal(styled.check.problems, 1);
    assert.match(styled.check.findings[0]!.message, /watercolor, comic/);
  });

  it('reads and writes a board from the CLI', async () => {
    const lines: string[] = [];
    const log = console.log;
    console.log = (line: unknown) => void lines.push(String(line));
    try {
      assert.equal(await main(['write-db', root, JSON.stringify([{ op: 'set', path: 'elements/cli', data: { type: 'note', x: 3, y: 3, text: 'CLI' } }])]), 0);
      assert.deepEqual((JSON.parse(lines.pop()!) as { writes: { path: string }[] }).writes.map((w) => w.path), ['elements/cli']);
      assert.equal(await main(['read-db', root, 'elements/cli']), 0);
      const cliDoc = { type: 'note', x: 3, y: 3, text: 'CLI' };
      assert.deepEqual(JSON.parse(lines.pop()!), { path: 'elements/cli', exists: true, sha256: docSha256(cliDoc), data: cliDoc });
      const file = join(dir, 'writes.json');
      await writeFile(file, JSON.stringify({ writes: [{ op: 'delete', path: 'elements/cli' }] }));
      assert.equal(await main(['write-db', root, file]), 0);
      assert.equal(existsSync(join(root, 'db', 'elements', 'cli.json')), false);
    } finally {
      console.log = log;
    }
    const error = console.error;
    console.error = () => undefined;
    try {
      assert.equal(await main(['read-db', join(dir, 'plain')]), 1);
      assert.equal(await main(['write-db', root, '[{"op":"set","path":"elements/x"}]']), 1);
    } finally {
      console.error = error;
    }
  });

  it("serves db, comments and room to the runtime's local provider", async () => {
    // The provider is browser code: give it a location, and track its sockets so the test can close them.
    const scope = globalThis as unknown as { location?: { href: string }; WebSocket: typeof WebSocket };
    const Native = scope.WebSocket;
    const sockets: WebSocket[] = [];
    scope.WebSocket = class extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        sockets.push(this);
      }
    };
    const location = scope.location;
    scope.location = { href: page };
    try {
      const one = createLocalProvider({ base: page });
      const two = createLocalProvider({ base: page });
      const [db1, db2, room1, room2, comments] = await Promise.all([one.get('db'), two.get('db'), one.get('room'), two.get('room'), one.get('comments')]);
      assert.ok(db1 && db2 && room1 && room2 && comments);
      const changes1: DbChangeEvent[] = [];
      const changes2: DbChangeEvent[] = [];
      const heard1: RoomMessage[] = [];
      const heard2: RoomMessage[] = [];
      db1.onChange((event) => changes1.push(event));
      db2.onChange((event) => changes2.push(event));
      room1.onMessage((message) => heard1.push(message));
      room2.onMessage((message) => heard2.push(message));
      await until(() => sockets.length === 2 && sockets.every((socket) => socket.readyState === Native.OPEN));

      // Every stream starts with where the documents stand.
      await until(() => changes1.length > 0 && changes2.length > 0);
      const start = changes2.shift()!;
      assert.deepEqual(changes1.shift(), start);
      assert.equal(start.resync, true);
      assert.deepEqual(start.changes, {});
      assert.equal(typeof start.epoch, 'string');
      assert.equal(typeof start.seq, 'number');

      // A write is answered with its place in the order and the documents as stored; the event carries the same place.
      const data = { type: 'note', x: 7, y: 7, text: 'Provider' };
      const receipt = await db1.write([{ op: 'set', path: 'elements/lp', data }]);
      assert.deepEqual(receipt, { epoch: start.epoch, seq: start.seq! + 1, documents: { 'elements/lp': data } });
      await until(() => changes2.length > 0);
      assert.deepEqual(changes2[0], { changes: { 'elements/lp': data }, author: await room1.self(), epoch: start.epoch, seq: start.seq! + 1 });
      assert.deepEqual(await db2.get('elements/lp'), data);
      assert.ok((await db2.list('elements')).some((d) => d.path === 'elements/lp'));
      const listing = await db2.listing!('elements');
      assert.deepEqual({ epoch: listing.epoch, seq: listing.seq }, { epoch: start.epoch, seq: start.seq! + 1 });
      assert.ok(listing.documents.some((d) => d.path === 'elements/lp'));

      // Room messages reach the other page; the writer heard no echo of its write before it.
      await room2.emit('cursor', { x: 1 });
      await until(() => heard1.length > 0);
      assert.deepEqual(heard1[0], { from: await room2.self(), topic: 'cursor', data: { x: 1 } });
      assert.equal(changes1.length, 0);
      assert.equal(heard2.length, 0);

      const thread = await comments.create({ anchor: '{"element":"lp"}', label: 'Note "Provider"', text: 'Looks good' });
      assert.equal(thread.messages[0]!.author.kind, 'person');
      assert.ok((await comments.list()).some((t) => t.id === thread.id));
      await comments.remove(thread.id);
      await db1.write([{ op: 'delete', path: 'elements/lp' }]);
      assert.equal(await db2.get('elements/lp'), null);
    } finally {
      for (const socket of sockets) {
        socket.onclose = null;
        socket.close();
      }
      scope.WebSocket = Native;
      scope.location = location;
    }
  });
});
