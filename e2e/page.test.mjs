// End-to-end test of the built-in `page` type, in Chrome: a real daemon (in this process, from source, in a temporary
// home). The agent's side goes through the Artifact tool: create a page declaring `db`, which first shows its empty
// state, then write the fixture's index.html (e2e/fixtures/page/), which takes `const claude = window.claude` at the top level of a classic script, asks `claude.use("db")` for the
// database and writes a vote. The page renders inside the Shell, the vote lands on disk under the artifact's db/,
// the artifact takes the page's <title>, and a page that declares nothing gets no db.
//
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { findChrome, launch } from './lib/browser.mjs';
import { browserOff, removeTmp, repoRoot, tmpDir } from './lib/target.mjs';
import { readPng } from '../packages/server-sdk/test/png.ts';

const T = { timeout: 60000 };
const FIXTURE = path.join(repoRoot, 'e2e', 'fixtures', 'page', 'index.html');
/** In the page's own frame. */
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

describe('the page type', { skip: skip() }, () => {
  const ctx = {};
  const tool = async args => {
    const out = await ctx.daemon.tools.call('Artifact', args, ctx.caller);
    assert.equal(out.error, undefined, JSON.stringify(out.error));
    return out;
  };
  /** The page's own frame answers `expression`, or undefined. */
  const inPage = async expression => (await ctx.page.evaluateAll(`${IN_PAGE} ? (${expression}) : undefined`).catch(() => [])).find(v => v !== undefined);

  before(async () => {
    const tmp = tmpDir('page');
    const workspace = path.join(tmp, 'workspace');
    fs.mkdirSync(workspace, { recursive: true });
    for (const name of ['OPEN_ARTIFACT_EXTRA_TYPES', 'OPEN_ARTIFACT_SHELL_DIR', 'OPEN_ARTIFACT_HOME_DIR', 'OPEN_ARTIFACT_REMOTE', 'OPEN_ARTIFACT_REMOTE_TOKEN', 'OPEN_ARTIFACT_HARNESS', 'OPEN_ARTIFACT_SESSION']) delete process.env[name];
    Object.assign(process.env, {
      OPEN_ARTIFACT_HOME: path.join(tmp, 'home'),
      OPEN_ARTIFACT_USER_TYPES: path.join(tmp, 'types'),
      OPEN_ARTIFACT_TYPE_SERVER_HOME: path.join(tmp, 'servers'),
    });
    const { startDaemon } = await import('../packages/daemon/src/daemon.ts');
    ctx.daemon = await startDaemon({ port: await freePort(), idleMs: 0, quiet: true, browse: null });
    ctx.caller = { harness: 'dsh', session: 'e2e-page', workspace };
    const made = await tool({ action: 'publish', type_url: 'open-artifact://type/page', title: 'Untitled page', capabilities: { db: true, network: true }, open: 'never' });
    assert.deepEqual(made.capabilities, { db: true, network: true });
    ctx.url = made.url;
    ctx.root = made.root;
    ctx.id = ctx.daemon.store.require(made.url).id;
    ctx.browser = await launch({ width: 1100, height: 760 });
  });

  after(async () => {
    await ctx.browser?.close();
    await ctx.daemon?.close();
    removeTmp();
  });

  it('shows a neutral empty state before index.html exists', T, async () => {
    assert.equal(fs.existsSync(path.join(ctx.root, 'index.html')), false);
    ctx.page = await ctx.browser.load(`${ctx.daemon.origin}/a/${ctx.id}`, { ready: `${IN_PAGE} && !!document.querySelector('[data-open-artifact-empty]')`, ignore: [/favicon\.ico/] });
    assert.deepEqual(ctx.page.problems, []);
    assert.match(String(await inPage('document.body.innerText')), /empty for now/);
  });

  it('renders the index.html the agent writes, and its db write lands on disk', T, async () => {
    await tool({ action: 'publish', url: ctx.url, files: { 'index.html': fs.readFileSync(FIXTURE, 'utf8') } });
    assert.ok(await ctx.page.waitFor(`${IN_PAGE} && document.getElementById('status')?.textContent === 'voted'`, 20000), `the page did not vote: ${await inPage("document.getElementById('status')?.textContent")}`);
    assert.equal(await inPage("document.querySelector('h1').textContent"), 'Lunch vote');
    assert.equal(await inPage('claude === window.openArtifact && window.claude === window.openArtifact'), true, 'the page\'s own top-level const claude ran');
    assert.ok(await ctx.page.waitFor(`${IN_PAGE} && document.querySelector('[data-vote="first"]')?.textContent === 'noodles'`, 10000), 'the snapshot did not render the vote');
    const file = path.join(ctx.root, 'db', 'votes', 'first.json');
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { choice: 'noodles', at: 1 });
    assert.equal(ctx.daemon.store.require(ctx.url).title, 'Lunch vote', "the page's <title> is the artifact's");
  });

  it('reads immutable snapshots and the external origins granted to this page', T, async () => {
    const result = await inPage(`(async () => {
      const db = await window.openArtifact.use('db');
      const network = await window.openArtifact.use('network');
      const votes = await db.collection('votes').get();
      const origins = await network.origins();
      origins.push('https://discard.example');
      return { origins: await network.origins(), frozen: Object.isFrozen(votes.docs[0].data()), changes: votes.docChanges().map(c => c.doc.id) };
    })()`);
    assert.deepEqual(result, { origins: [], frozen: true, changes: ['first'] });
  });

  it('imports a database, builds and cancels a subscription synchronously, and writes a document', T, async () => {
    assert.ok(await ctx.page.waitFor(`${IN_PAGE} && document.getElementById('modules')?.textContent === 'module_checks/first'`, 10000), 'the capability module did not finish');
    const file = path.join(ctx.root, 'db', 'module_checks', 'first.json');
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { choice: 'rice' });
  });

  it('snapshot: a PNG in the dark scheme, by a read-only viewer the open view never sees; a built-in type keeps its own', T, async () => {
    const listed = await tool({ action: 'read', url: ctx.url });
    assert.ok(listed.actions.some(a => a.name === 'snapshot'), `snapshot is not among the actions: ${listed.actions.map(a => a.name)}`);
    await inPage('(window.__openView = 7)');
    const dbDir = path.join(ctx.root, 'db');
    const files = dir => fs.readdirSync(dir, { recursive: true }).sort().map(name => [name, fs.statSync(path.join(dir, name)).mtimeMs]);
    const before = files(dbDir);
    const titled = ctx.daemon.store.require(ctx.url).title;
    const snap = await tool({ action: 'call', url: ctx.url, name: 'snapshot', args: { width: 400, height: 900, scheme: 'dark' } });
    assert.equal(snap.scheme, 'dark');
    assert.deepEqual([snap.width, snap.height], [400, 900]);
    assert.ok(snap.image.startsWith(path.join(ctx.root, '_agent', 'snapshots') + path.sep), snap.image);
    const png = readPng(fs.readFileSync(snap.image));
    assert.deepEqual([png.width, png.height], [400, 900]);
    // The fixture writes a vote on load: the camera's view was refused it, so the store is as it was.
    assert.deepEqual(files(dbDir), before, 'the db is unchanged');
    assert.equal(ctx.daemon.store.require(ctx.url).title, titled);
    assert.equal(await inPage('window.__openView'), 7, 'the open view did not reload');
    assert.equal(await inPage("document.getElementById('status')?.textContent"), 'voted');
    // _agent/ is not part of the artifact: not in its files' version or its archive.
    const after = await tool({ action: 'call', url: ctx.url, name: 'info' });
    assert.ok(!after.info.files.some(f => f.path.startsWith('_agent')), JSON.stringify(after.info.files));
    // A built-in type's snapshot (the type server's) still draws.
    const design = await tool({ action: 'publish', type_url: 'open-artifact://type/design', title: 'Snapshot check', open: 'never' });
    const builtIn = await tool({ action: 'call', url: design.url, name: 'snapshot', args: { width: 640, height: 480 } });
    assert.ok(fs.existsSync(builtIn.image), JSON.stringify(builtIn));
    assert.deepEqual([readPng(fs.readFileSync(builtIn.image)).width, builtIn.height], [640, 480]);
  });

  it('with the declaration cleared, the page reloads and gets no db', T, async () => {
    const out = await tool({ action: 'publish', url: ctx.url, capabilities: {} });
    assert.deepEqual(out.capabilities, {});
    let status;
    for (let i = 0; i < 100 && status !== 'no db'; i++) {
      await sleep(100);
      status = await inPage("document.getElementById('status')?.textContent");
    }
    assert.equal(status, 'no db');
    assert.ok(await ctx.page.waitFor(`${IN_PAGE} && document.getElementById('modules')?.textContent === 'not_granted'`, 10000), 'the imported capability observed the cleared grant');
  });
});
