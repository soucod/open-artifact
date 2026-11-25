/**
 * What the differential suite cannot see: how the SQLite file system uses its rows (budgets per operation, no full
 * scans), that a failure part-way changes nothing, that mounts are separate, that scratch memory is bounded, that
 * watchers hear every change, and that the files outlive the object that wrote them.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import * as shim from '../src/fs/index.ts';
import { CHUNK_SIZE, DEFAULT_SCRATCH_BYTES, INLINE_MAX, mount, setScratchLimit, type StorageCounters, watcherCount } from '../src/fs/index.ts';
import { scratchBackend } from '../src/fs/mounts.ts';
import { testStorage, type TestStorage } from './sqlite.ts';

/** The shim, typed as the `node:fs` it stands in for. */
const fs = shim as unknown as typeof import('node:fs');

const dirs: string[] = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function fresh(root: string, storage: TestStorage = testStorage()) {
  const unmount = mount(root, storage);
  return { storage, unmount, backend: unmount.backend };
}

/** The rows one operation read and wrote. */
function cost(backend: { counters(): StorageCounters }, op: () => unknown): StorageCounters {
  const before = backend.counters();
  op();
  const now = backend.counters();
  return {
    statements: now.statements - before.statements,
    rowsRead: now.rowsRead - before.rowsRead,
    rowsWritten: now.rowsWritten - before.rowsWritten,
    chunkRowsRead: now.chunkRowsRead - before.chunkRowsRead,
    chunkRowsWritten: now.chunkRowsWritten - before.chunkRowsWritten,
    commits: now.commits - before.commits,
    rollbacks: now.rollbacks - before.rollbacks,
  };
}

const big = (size: number, fill = 7): Buffer => Buffer.alloc(size, fill);

describe('row budgets', () => {
  test('listing, stat and exists read index rows only, never chunks, never a scan', () => {
    const { storage, unmount, backend } = fresh('/budget');
    try {
      fs.mkdirSync('/budget/many/deep', { recursive: true });
      for (let i = 0; i < 2000; i++) fs.writeFileSync(`/budget/many/f${String(i).padStart(4, '0')}`, i % 10 === 0 ? big(CHUNK_SIZE + 1, i) : `small ${i}`);
      storage.scans.length = 0;

      const list = cost(backend, () => assert.equal(fs.readdirSync('/budget/many').length, 2001));
      assert.equal(list.chunkRowsRead, 0);
      assert.ok(list.rowsRead <= 2001 + 4, `readdir of 2001 entries read ${list.rowsRead} rows`);

      const typed = cost(backend, () => fs.readdirSync('/budget/many', { withFileTypes: true }));
      assert.equal(typed.chunkRowsRead, 0);

      const stat = cost(backend, () => assert.equal(fs.statSync('/budget/many/f0010').size, CHUNK_SIZE + 1));
      assert.equal(stat.chunkRowsRead, 0);
      assert.ok(stat.rowsRead <= 3, `stat read ${stat.rowsRead} rows`);

      const exists = cost(backend, () => assert.equal(fs.existsSync('/budget/many/deep'), true));
      assert.ok(exists.rowsRead <= 3 && exists.chunkRowsRead === 0);

      const missing = cost(backend, () => assert.equal(fs.existsSync('/budget/many/nope'), false));
      assert.ok(missing.rowsRead <= 2);

      // A folder of 2,000 files moves by rewriting one row.
      const move = cost(backend, () => fs.renameSync('/budget/many', '/budget/moved'));
      assert.equal(move.chunkRowsWritten, 0);
      assert.ok(move.rowsWritten <= 2, `folder rename wrote ${move.rowsWritten} rows`);
      assert.equal(fs.readFileSync('/budget/moved/f0001', 'utf8'), 'small 1');

      assert.deepEqual(storage.scans, [], 'no full scan of a file system table');

      // Removing it deletes its rows by range (and still scans nothing).
      const remove = cost(backend, () => fs.rmSync('/budget/moved', { recursive: true }));
      assert.equal(remove.rowsWritten >= 2001 + 200 * 2, true);
      assert.deepEqual(storage.scans, []);
      assert.equal(storage.db.prepare('SELECT count(*) AS n FROM oa_fs_chunks').get()?.n, 0);
      assert.equal(storage.db.prepare('SELECT count(*) AS n FROM oa_fs_entries').get()?.n, 1, 'only the root row is left');
    } finally {
      unmount();
    }
  });

  test('a 1-byte append to a large file rewrites one chunk', () => {
    const { storage, unmount, backend } = fresh('/append');
    try {
      fs.writeFileSync('/append/big', big(10 * CHUNK_SIZE + 5));
      const append = cost(backend, () => fs.appendFileSync('/append/big', 'x'));
      assert.equal(append.chunkRowsWritten, 1);
      assert.ok(append.chunkRowsRead <= 2, `append read ${append.chunkRowsRead} chunk rows`);
      assert.ok(append.rowsWritten <= 2, `append wrote ${append.rowsWritten} rows`);
      const read = cost(backend, () => {
        const fd = fs.openSync('/append/big', 'r');
        const out = Buffer.alloc(10);
        fs.readSync(fd, out, 0, 10, 5 * CHUNK_SIZE - 5);
        fs.closeSync(fd);
      });
      assert.equal(read.chunkRowsRead, 2, 'a range read across one boundary reads two chunks');
      assert.deepEqual(storage.scans, []);
    } finally {
      unmount();
    }
  });

  test('a range read stream reads only the chunks it covers', async () => {
    const { unmount, backend } = fresh('/range');
    try {
      fs.writeFileSync('/range/big', big(20 * CHUNK_SIZE));
      const before = backend.counters().chunkRowsRead;
      let length = 0;
      for await (const chunk of fs.createReadStream('/range/big', { start: 7 * CHUNK_SIZE + 10, end: 9 * CHUNK_SIZE + 9 })) length += (chunk as Buffer).length;
      assert.equal(length, 2 * CHUNK_SIZE);
      assert.equal(backend.counters().chunkRowsRead - before, 3);
    } finally {
      unmount();
    }
  });

  test('identical content is not rewritten', () => {
    const { unmount, backend } = fresh('/same');
    try {
      const bytes = big(4 * CHUNK_SIZE + 3, 1);
      const first = cost(backend, () => fs.writeFileSync('/same/blob', bytes));
      assert.equal(first.chunkRowsWritten, 5);
      const again = cost(backend, () => fs.writeFileSync('/same/blob', bytes));
      assert.equal(again.chunkRowsWritten, 0, 'same bytes: no chunk written');
      assert.ok(again.rowsWritten <= 1);
      const changed = Buffer.from(bytes);
      changed[2 * CHUNK_SIZE + 1] = 9;
      const one = cost(backend, () => fs.writeFileSync('/same/blob', changed));
      assert.equal(one.chunkRowsWritten, 1, 'one changed chunk: one chunk written');
      assert.ok(fs.readFileSync('/same/blob').equals(changed));
      const small = cost(backend, () => {
        fs.writeFileSync('/same/small', 'abc');
        fs.writeFileSync('/same/small', 'abc');
      });
      assert.equal(small.chunkRowsWritten, 0);
    } finally {
      unmount();
    }
  });

  test('measured costs of common operations', (t) => {
    const { storage, unmount, backend } = fresh('/measure');
    try {
      fs.mkdirSync('/measure/project/assets', { recursive: true });
      const rows: [string, StorageCounters][] = [];
      const measure = (label: string, op: () => unknown) => rows.push([label, cost(backend, op)]);
      measure('writeFile 1 KiB (new)', () => fs.writeFileSync('/measure/project/a.json', big(1024)));
      measure('writeFile 1 KiB (replace)', () => fs.writeFileSync('/measure/project/a.json', big(1024, 2)));
      measure('writeFile 100 KiB (new)', () => fs.writeFileSync('/measure/project/b.bin', big(100 * 1024)));
      measure('writeFile 24 MB (new)', () => fs.writeFileSync('/measure/project/assets/video.mp4', big(24 * 1024 * 1024)));
      measure('writeFile tmp + rename (atomic 1 KiB)', () => {
        fs.writeFileSync('/measure/project/a.json.tmp', big(1024, 3));
        fs.renameSync('/measure/project/a.json.tmp', '/measure/project/a.json');
      });
      measure('readFile 1 KiB', () => fs.readFileSync('/measure/project/a.json'));
      measure('readFile 24 MB', () => fs.readFileSync('/measure/project/assets/video.mp4'));
      measure('statSync', () => fs.statSync('/measure/project/a.json'));
      measure('existsSync (missing)', () => fs.existsSync('/measure/project/none'));
      measure('readdirSync (3 entries)', () => fs.readdirSync('/measure/project'));
      measure('appendFileSync 100 B to 24 MB', () => fs.appendFileSync('/measure/project/assets/video.mp4', big(100)));
      measure('mkdirSync', () => fs.mkdirSync('/measure/project/new'));
      measure('rmSync 24 MB file', () => fs.rmSync('/measure/project/assets/video.mp4'));
      measure('rmSync folder (recursive)', () => fs.rmSync('/measure/project', { recursive: true }));
      for (const [label, c] of rows) {
        t.diagnostic(`${label.padEnd(40)} read ${String(c.rowsRead).padStart(5)} (chunks ${String(c.chunkRowsRead).padStart(3)})  written ${String(c.rowsWritten).padStart(5)} (chunks ${String(c.chunkRowsWritten).padStart(3)})  statements ${c.statements}`);
      }
      const video = rows.find(([label]) => label === 'writeFile 24 MB (new)')![1];
      assert.equal(video.chunkRowsWritten, Math.ceil((24 * 1024 * 1024) / CHUNK_SIZE));
      assert.deepEqual(storage.scans, []);
    } finally {
      unmount();
    }
  });
});

describe('atomicity', () => {
  test('a failure part-way through a call leaves everything as it was', () => {
    const { storage, unmount } = fresh('/crash');
    try {
      fs.mkdirSync('/crash/tree/sub', { recursive: true });
      fs.writeFileSync('/crash/tree/sub/big', big(3 * CHUNK_SIZE, 4));
      fs.writeFileSync('/crash/tree/small', 'small');
      fs.writeFileSync('/crash/target', 'target');

      // Remove a tree: fail at the last statement (the folder's own row).
      storage.failOn('DELETE FROM oa_fs_entries WHERE parent = ? AND name = ?');
      assert.throws(() => fs.rmSync('/crash/tree', { recursive: true }), /simulated failure/);
      assert.ok(fs.readFileSync('/crash/tree/sub/big').equals(big(3 * CHUNK_SIZE, 4)));
      assert.equal(fs.readFileSync('/crash/tree/small', 'utf8'), 'small');

      // Rewrite a chunked file: fail after some chunks were written.
      storage.failOn('UPDATE oa_fs_entries SET size');
      assert.throws(() => fs.writeFileSync('/crash/tree/sub/big', big(5 * CHUNK_SIZE, 5)));
      assert.ok(fs.readFileSync('/crash/tree/sub/big').equals(big(3 * CHUNK_SIZE, 4)));

      // Rename over a file: fail at the move, after the replaced file was deleted.
      storage.failOn('UPDATE oa_fs_entries SET parent');
      assert.throws(() => fs.renameSync('/crash/tree/small', '/crash/target'));
      assert.equal(fs.readFileSync('/crash/target', 'utf8'), 'target');
      assert.equal(fs.readFileSync('/crash/tree/small', 'utf8'), 'small');

      // Create with a fresh block of inodes: fail after the block was reserved; the next create still works.
      storage.failOn('INSERT INTO oa_fs_entries');
      assert.throws(() => fs.writeFileSync('/crash/new', 'x'));
      assert.equal(fs.existsSync('/crash/new'), false);
      fs.writeFileSync('/crash/new', 'y');
      assert.equal(fs.readFileSync('/crash/new', 'utf8'), 'y');
      assert.ok(unmount.backend.counters().rollbacks >= 4);
    } finally {
      unmount();
    }
  });
});

describe('mounts', () => {
  test('two mounts never see each other; a rename between them is EXDEV', () => {
    const one = fresh('/a/one');
    const two = fresh('/a/two');
    try {
      fs.writeFileSync('/a/one/f', 'one');
      fs.writeFileSync('/a/two/f', 'two');
      assert.equal(fs.readFileSync('/a/one/f', 'utf8'), 'one');
      assert.equal(fs.readFileSync('/a/two/f', 'utf8'), 'two');
      assert.deepEqual(fs.readdirSync('/a/one'), ['f']);
      assert.throws(() => fs.renameSync('/a/one/f', '/a/two/g'), { code: 'EXDEV' });
      fs.copyFileSync('/a/one/f', '/a/two/g');
      assert.equal(fs.readFileSync('/a/two/g', 'utf8'), 'one');
      assert.equal(one.storage.db.prepare("SELECT count(*) AS n FROM oa_fs_entries WHERE name = 'g'").get()?.n, 0);
      assert.throws(() => fs.rmSync('/a/one', { recursive: true }), { code: 'EPERM' });
      assert.throws(() => mount('/a/one/inner', testStorage()), /overlaps/);
    } finally {
      one.unmount();
      two.unmount();
    }
    // Unmounted: the path is scratch memory again, empty.
    assert.equal(fs.existsSync('/a/one/f'), false);
  });

  test('files outlive the mount: a new object on the same database sees them', () => {
    const dir = mkdtempSync(join(tmpdir(), 'open-artifact-fs-persist-'));
    dirs.push(dir);
    const file = join(dir, 'object.sqlite');
    const first = fresh('/persist', testStorage(file));
    fs.mkdirSync('/persist/x/y', { recursive: true });
    fs.writeFileSync('/persist/x/y/big', big(2 * CHUNK_SIZE + 1, 3));
    fs.writeFileSync('/persist/x/small', 'kept');
    first.unmount();
    first.storage.close();
    const second = fresh('/persist', testStorage(file));
    try {
      assert.equal(fs.readFileSync('/persist/x/small', 'utf8'), 'kept');
      assert.ok(fs.readFileSync('/persist/x/y/big').equals(big(2 * CHUNK_SIZE + 1, 3)));
      // New inodes do not collide with the old ones.
      fs.writeFileSync('/persist/x/new', big(INLINE_MAX + 10, 8));
      assert.ok(fs.readFileSync('/persist/x/y/big').equals(big(2 * CHUNK_SIZE + 1, 3)));
      assert.notEqual(fs.statSync('/persist/x/new').ino, fs.statSync('/persist/x/y/big').ino);
    } finally {
      second.unmount();
      second.storage.close();
    }
  });

  test('scratch memory is bounded', () => {
    setScratchLimit(1024 * 1024);
    try {
      fs.mkdirSync('/tmp/scratch', { recursive: true });
      fs.writeFileSync('/tmp/scratch/a', big(600 * 1024));
      assert.throws(() => fs.writeFileSync('/tmp/scratch/b', big(600 * 1024)), { code: 'ENOSPC' });
      assert.equal(fs.existsSync('/tmp/scratch/b'), false);
      assert.throws(() => fs.appendFileSync('/tmp/scratch/a', big(500 * 1024)), { code: 'ENOSPC' });
      fs.rmSync('/tmp/scratch', { recursive: true });
      fs.writeFileSync('/tmp/b', big(900 * 1024));
      assert.equal(scratchBackend().usage().bytes, 900 * 1024);
    } finally {
      setScratchLimit(DEFAULT_SCRATCH_BYTES);
    }
  });
});

describe('watch', () => {
  const nextEvents = (watcher: import('node:fs').FSWatcher, count: number) =>
    new Promise<[string, string][]>((resolve) => {
      const got: [string, string][] = [];
      watcher.on('change', (event: string, name: string) => {
        got.push([event, name]);
        if (got.length === count) resolve(got);
      });
    });

  test('reports changes below a folder, recursively or not, after the call', async () => {
    const { unmount } = fresh('/watched');
    try {
      fs.mkdirSync('/watched/db/sub', { recursive: true });
      const recursive = fs.watch('/watched/db', { recursive: true });
      const shallow = fs.watch('/watched/db');
      const all = nextEvents(recursive, 6);
      const top = nextEvents(shallow, 4);
      let reportedSynchronously = false;
      recursive.once('change', () => (reportedSynchronously = inCall));
      let inCall = true;
      fs.writeFileSync('/watched/db/sub/doc.json', '{}');
      fs.writeFileSync('/watched/db/top.json', '{}');
      fs.renameSync('/watched/db/top.json', '/watched/db/moved.json');
      inCall = false;
      assert.deepEqual(await all, [
        ['rename', 'sub/doc.json'],
        ['change', 'sub/doc.json'],
        ['rename', 'top.json'],
        ['change', 'top.json'],
        ['rename', 'top.json'],
        ['rename', 'moved.json'],
      ]);
      assert.deepEqual(await top, [
        ['rename', 'top.json'],
        ['change', 'top.json'],
        ['rename', 'top.json'],
        ['rename', 'moved.json'],
      ]);
      assert.equal(reportedSynchronously, false);
      recursive.close();
      shallow.close();
      assert.equal(watcherCount(), 0);
    } finally {
      unmount();
    }
  });

  test('a failed call reports nothing; unmount closes watchers; a missing path cannot be watched', async () => {
    const { storage, unmount } = fresh('/watched2');
    fs.writeFileSync('/watched2/comments.json', '[]');
    const watcher = fs.watch('/watched2', (event, name) => events.push(`${event} ${name}`));
    const events: string[] = [];
    let closed = false;
    watcher.on('close', () => (closed = true));
    storage.failOn('INSERT INTO oa_fs_entries');
    assert.throws(() => fs.writeFileSync('/watched2/failed', 'x'));
    fs.writeFileSync('/watched2/comments.json', '[1]');
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(events, ['change comments.json']);
    assert.throws(() => fs.watch('/watched2/none'), { code: 'ENOENT' });
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(closed, true);
  });
});
