import { tempDir } from './helpers.ts';

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import type { SessionRef } from '@open-artifact/protocol';
import { startDaemon, type Daemon } from '../src/daemon.ts';

// Pages the agent opens go to this computer's browser for harnesses whose profile says `open: "browser"`.
let daemon: Daemon;
const browsed: string[] = [];
const workspace = tempDir('open-artifact-browser-ws-');
const plugin: SessionRef = { harness: 'claude-code', session: 'browser-test', workspace };
const plain: SessionRef = { harness: 'cli', session: null, workspace };
let boardView = '';

before(async () => {
  const shellDir = tempDir('open-artifact-shell-');
  daemon = await startDaemon({ port: 0, quiet: true, shellDir, homeDir: shellDir, browse: (url) => (browsed.push(url), true) });
});

after(() => daemon.close());

const create = async (caller: SessionRef, title: string) =>
  (await daemon.tools.call('Artifact', { action: 'publish', type_url: 'open-artifact://type/whiteboard', title, open: 'after_first_write' }, caller)) as Record<string, any>;

test('browser: open shows the page in the browser for a plugin harness, and nowhere for one without', async () => {
  const made = await create(plugin, 'Board');
  const opened = (await daemon.tools.call('Artifact', { action: 'open', url: made.url, panel: 'share' }, plugin)) as Record<string, any>;
  assert.equal(opened.opened, true);
  assert.equal(opened.opened_in, 'browser');
  assert.equal(browsed.at(-1), opened.view_url);
  assert.match(String(opened.view_url), /\/a\/art_.*\?panel=share$/);
  boardView = made.view_url;

  const count = browsed.length;
  const theirs = await create(plain, 'Plain board');
  assert.equal(theirs.open, undefined);
  assert.ok(theirs.note);
  const shown = (await daemon.tools.call('Artifact', { action: 'open', url: theirs.url }, plain)) as Record<string, any>;
  assert.equal(shown.opened, false);
  assert.equal(browsed.length, count);
});

test('browser: a page never opens in the computer\'s browser by itself; the agent opens it, in its built-in browser first', async () => {
  // Agent apps with a browser of their own (Codex, Cursor, Claude) show the page there: a second copy in the
  // computer's browser would be in the way.
  const made = await create(plugin, 'Later board');
  assert.equal(made.open, undefined);
  assert.match(String(made.note), /Nothing opens by itself here.*built-in browser/);
  assert.match(String(made.next), /open view_url in your app's built-in browser.*Artifact \{action: "open", url\}/);
  const count = browsed.length;
  writeFileSync(join(made.root, 'board.json'), '{}');
  await new Promise((done) => setTimeout(done, 3000)); // longer than the daemon's poll and settle for a first write
  assert.equal(browsed.length, count);
  assert.equal(browsed.filter((u) => u.startsWith(boardView)).length, 1);
});

test('browser: an openEarly type (motion) tells the agent to show the page right after the first playable batch', async () => {
  const made = (await daemon.tools.call(
    'Artifact',
    { action: 'publish', type_url: 'open-artifact://type/motion', title: 'Early preview', open: 'after_first_write' },
    plugin,
  )) as Record<string, any>;
  assert.equal(made.open, undefined);
  assert.match(String(made.note), /right after the first playable batch.*built-in browser/);
  assert.match(String(made.instructions), /Show the page right after your first playable batch.*built-in browser/);
  assert.match(String(made.next), /write the first playable batch into root, then show it right away.*built-in browser/);
});
