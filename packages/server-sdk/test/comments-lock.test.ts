/**
 * The comments file's lock: `file` (the default) shares comments.json with other processes through
 * `comments.json.lock`; `process` is for a host where this process is the only writer (no lock file at all).
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { CommentStore } from '../src/frame/comments.ts';

const dirs: string[] = [];
const freshDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'open-artifact-comments-lock-'));
  dirs.push(dir);
  return dir;
};
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const threadsOf = (dir: string): number => (JSON.parse(readFileSync(join(dir, 'comments.json'), 'utf8')) as { threads: unknown[] }).threads.length;

describe('comments lock: file (another process may write too)', () => {
  it('is the default, writes under comments.json.lock and leaves none behind', () => {
    const dir = freshDir();
    const store = new CommentStore(dir);
    assert.equal(store.lock, 'file');
    let held = false;
    store.mutate(() => {
      held = existsSync(join(dir, 'comments.json.lock'));
    });
    assert.equal(held, true);
    store.create({ text: 'Hello' });
    assert.equal(threadsOf(dir), 1);
    assert.equal(existsSync(join(dir, 'comments.json.lock')), false);
  });

  it('clears a stale lock (left by a crash) and writes', () => {
    const dir = freshDir();
    const lock = join(dir, 'comments.json.lock');
    writeFileSync(lock, '');
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    new CommentStore(dir).create({ text: 'After a crash' });
    assert.equal(threadsOf(dir), 1);
    assert.equal(existsSync(lock), false);
  });

  it('waits for a live lock, then refuses with 409', () => {
    const dir = freshDir();
    const lock = join(dir, 'comments.json.lock');
    writeFileSync(lock, '');
    const started = Date.now();
    assert.throws(() => new CommentStore(dir).create({ text: 'Blocked' }), (error: { code?: string; status?: number }) => error.code === 'unavailable' && error.status === 409);
    assert.ok(Date.now() - started >= 4_000, 'gave up before the wait');
    // The holder's lock is left alone.
    assert.equal(existsSync(lock), true);
    assert.equal(existsSync(join(dir, 'comments.json')), false);
  });
});

describe('comments lock: process (the only writer)', () => {
  it('makes no lock file, and clears one a crash left whatever its age', () => {
    const dir = freshDir();
    const lock = join(dir, 'comments.json.lock');
    writeFileSync(lock, '');
    const store = new CommentStore(dir, { lock: 'process' });
    assert.equal(existsSync(lock), false);
    let seen = true;
    store.mutate(() => {
      seen = existsSync(lock);
    });
    assert.equal(seen, false);
    store.create({ text: 'One' });
    store.create({ text: 'Two' });
    assert.equal(threadsOf(dir), 2);
  });

  it('refuses a write started inside another (409), and is free again after it', () => {
    const dir = freshDir();
    const store = new CommentStore(dir, { lock: 'process' });
    const other = new CommentStore(dir, { lock: 'process' });
    store.mutate(() => {
      assert.throws(() => other.create({ text: 'Inside' }), (error: { code?: string; status?: number }) => error.code === 'unavailable' && error.status === 409);
    });
    // A write that threw frees the file too.
    assert.throws(() =>
      store.mutate(() => {
        throw new Error('boom');
      }),
    );
    other.create({ text: 'After' });
    assert.equal(threadsOf(dir), 1);
    // Another artifact's file is not held by this one's write.
    const elsewhere = new CommentStore(freshDir(), { lock: 'process' });
    store.mutate(() => {
      elsewhere.create({ text: 'Elsewhere' });
    });
    assert.equal(elsewhere.threads().length, 1);
  });
});
