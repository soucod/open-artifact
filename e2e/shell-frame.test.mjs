// End-to-end test of the Shell's cover over a static page, in Chrome: a real daemon (in this process, from source, in a
// temporary home) with a user type `linked`, a static page of two files that link to each other.
//
// A static page never reports to the Shell, so the Shell shows it on its `load`. A link the person follows inside the
// page brings a new document into the frame: it shows at once, with no cover over it. The Shell's own Refresh covers
// the page and shows it again on its `load`, well before the Shell's fallback for pages that say nothing.
//
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { findChrome, launch } from './lib/browser.mjs';
import { byText, clickOn } from './lib/host-page.mjs';
import { browserOff, removeTmp, repoRoot, tmpDir } from './lib/target.mjs';

const T = { timeout: 60000 };
/** The Shell's fallback for a page that never reports (`FRAME_READY_FALLBACK_MS` in packages/shell). */
const FALLBACK_MS = 1500;
/** In the static page's frame. */
const IN_PAGE = "location.hostname.endsWith('.frame.localhost')";

function skip() {
  if (browserOff || !findChrome()) return 'no browser (E2E_BROWSER=0 or no Chrome)';
  return fs.existsSync(path.join(repoRoot, 'dist', 'daemon', 'shell', 'index.html')) ? false : 'the Shell is not built (npm run build)';
}

/** A TCP port nobody listens on now. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** The Shell's cover, and which file the page in its frame is. */
async function state(page) {
  const cover = await page.evaluate("!!document.querySelector('[data-shell-loading]')").catch(() => null);
  const file = (await page.evaluateAll(`${IN_PAGE} ? (location.pathname.split('/').pop() || 'index.html') : undefined`).catch(() => [])).find(v => v !== undefined) ?? null;
  return { cover, file };
}

/** Samples the Shell every few milliseconds for `ms` after `action`. */
async function watch(page, ms, action) {
  const rows = [];
  const start = Date.now();
  await action();
  while (Date.now() - start < ms) {
    rows.push({ t: Date.now() - start, ...(await state(page)) });
    await sleep(10);
  }
  return rows;
}

/** Follows the page's only link, as the person would. */
async function followLink(page) {
  const at = (await page.evaluateAll(`${IN_PAGE} ? (() => { const r = document.querySelector('a').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })() : undefined`)).find(v => v !== undefined);
  assert.ok(at, 'the page has no link');
  const frame = await page.evaluate("(() => { const r = document.querySelector('iframe').getBoundingClientRect(); return [r.x, r.y]; })()");
  await page.click(frame[0] + at[0], frame[1] + at[1]);
}

describe('the Shell over a static page', { skip: skip() }, () => {
  const ctx = {};

  before(async () => {
    const tmp = tmpDir('shell-frame');
    const type = path.join(tmp, 'types', 'linked');
    fs.mkdirSync(type, { recursive: true });
    fs.writeFileSync(path.join(type, 'artifact-type.json'), JSON.stringify({ name: 'Linked', description: 'Two static pages that link to each other.', when: 'Never.' }));
    const pageOf = (title, link) => `<!doctype html><meta charset="utf-8"><title>${title}</title><h1>${title}</h1><p><a href="${link}" style="font-size:32px">Go on</a></p>\n`;
    fs.writeFileSync(path.join(type, 'index.html'), pageOf('One', 'two.html'));
    fs.writeFileSync(path.join(type, 'two.html'), pageOf('Two', 'index.html'));
    const root = path.join(tmp, 'artifact');
    fs.mkdirSync(root);
    for (const name of ['OPEN_ARTIFACT_EXTRA_TYPES', 'OPEN_ARTIFACT_SHELL_DIR', 'OPEN_ARTIFACT_HOME_DIR', 'OPEN_ARTIFACT_REMOTE', 'OPEN_ARTIFACT_REMOTE_TOKEN', 'OPEN_ARTIFACT_HARNESS', 'OPEN_ARTIFACT_SESSION']) delete process.env[name];
    Object.assign(process.env, {
      OPEN_ARTIFACT_HOME: path.join(tmp, 'home'),
      OPEN_ARTIFACT_USER_TYPES: path.join(tmp, 'types'),
      OPEN_ARTIFACT_TYPE_SERVER_HOME: path.join(tmp, 'servers'),
    });
    const { startDaemon } = await import('../packages/daemon/src/daemon.ts');
    ctx.daemon = await startDaemon({ port: await freePort(), idleMs: 0, quiet: true, browse: null });
    ctx.id = ctx.daemon.store.create({ root, type: 'linked', title: 'Linked pages' }).id;
    ctx.browser = await launch({ width: 1100, height: 760 });
    ctx.page = await ctx.browser.load(`${ctx.daemon.origin}/a/${ctx.id}`, { ready: `${IN_PAGE} && !!document.querySelector('a')`, ignore: [/favicon\.ico/] });
    assert.ok(await ctx.page.waitFor("!document.querySelector('[data-shell-loading]')", 10000), 'the Shell never showed the page');
  });

  after(async () => {
    await ctx.browser?.close();
    await ctx.daemon?.close();
    removeTmp();
  });

  it('shows each page a link brings into the frame at once, with no cover', T, async () => {
    const { page } = ctx;
    for (const [from, to] of [['index.html', 'two.html'], ['two.html', 'index.html']]) {
      assert.equal((await state(page)).file, from);
      const rows = await watch(page, FALLBACK_MS + 1000, () => followLink(page));
      assert.equal(rows.at(-1).file, to, `the link from ${from} did not open ${to}`);
      const covered = rows.filter(r => r.cover);
      assert.deepEqual(covered.map(r => `${r.t}ms on ${r.file}`), [], `the Shell covered the page after the link from ${from}`);
    }
  });

  it('covers the page on Refresh and shows it on its load, not at the fallback', T, async () => {
    const { page } = ctx;
    await clickOn(page, "document.querySelector('header [aria-label=\"Artifact options\"]')", 'the artifact options');
    const refresh = byText('Refresh');
    const rows = await watch(page, FALLBACK_MS + 1000, () => clickOn(page, refresh, 'Refresh'));
    const first = rows.findIndex(r => r.cover);
    assert.ok(first >= 0, 'Refresh did not cover the page');
    const shown = rows.slice(first).find(r => !r.cover);
    assert.ok(shown, 'the cover stayed');
    assert.ok(shown.t < FALLBACK_MS - 300, `the page showed at ${shown.t}ms, at the fallback rather than on its load`);
    assert.equal(shown.file, 'index.html');
  });
});
