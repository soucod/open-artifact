/**
 * A change made while a new watch is still being armed by the OS (FSEvents on macOS takes a moment, longer on a busy
 * machine) is never reported by the watch itself. The db host rescans soon after it starts watching
 * (`ARM_RESCAN_MS`), so such a change reaches the pages in about a second, not at the next slow rescan (10 s).
 *
 * The unarmed watch is stood in for by closing the host's watchers right after `start`: no event comes, as on a
 * machine where the change landed before the watch was live.
 */

import assert from 'node:assert/strict';
import type { FSWatcher } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { ARM_RESCAN_MS, DbHost } from '../src/db-host.ts';

describe('db host: a change made while the watch is armed', () => {
  let dir: string;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'open-artifact-db-arming-'));
    await mkdir(join(dir, 'db', 'elements'), { recursive: true });
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('is reported by the rescan soon after the watch starts', async () => {
    const heard: Array<{ changes: Record<string, unknown>; author: string }> = [];
    const external: string[][] = [];
    const host = new DbHost({
      root: dir,
      viewerName: 'Ana',
      emit: (name, payload) => {
        if (name === 'db') heard.push(payload as { changes: Record<string, unknown>; author: string });
      },
      onExternal: (paths) => external.push(paths),
    });
    host.start();
    // The watch hears nothing (not armed yet when the write lands).
    for (const watcher of (host as unknown as { watchers: FSWatcher[] }).watchers) watcher.close();
    const started = Date.now();
    await writeFile(join(dir, 'db', 'elements', 'pushed.json'), JSON.stringify({ type: 'note', text: 'From the laptop' }));
    try {
      const deadline = started + ARM_RESCAN_MS.at(-1)! + 2_000;
      while (!heard.length && Date.now() < deadline) await new Promise((done) => setTimeout(done, 25));
      assert.equal(heard.length, 1, 'reported by the arming rescan');
      assert.deepEqual(Object.keys(heard[0]!.changes), ['elements/pushed']);
      assert.equal(heard[0]!.author, 'agent');
      assert.deepEqual(external, [['elements/pushed']]);
      // Well before the slow rescan (10 s) would have found it.
      assert.ok(Date.now() - started < 5_000, `${Date.now() - started} ms`);
    } finally {
      host.stop();
    }
  });

  it('stops its catch-up rescans when it stops watching', async () => {
    let emits = 0;
    const host = new DbHost({ root: dir, viewerName: 'Ana', emit: () => void emits++ });
    host.start();
    host.stop();
    await writeFile(join(dir, 'db', 'elements', 'later.json'), JSON.stringify({ type: 'note', text: 'After stop' }));
    await new Promise((done) => setTimeout(done, ARM_RESCAN_MS[0]! + 400));
    assert.equal(emits, 0);
  });
});
