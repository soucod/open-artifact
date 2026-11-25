// End-to-end test of Link and remote MCP on the product Worker (`packages/host-cloudflare`) under `wrangler dev`: a real
// daemon (`open-artifact daemon run`, a temporary OPEN_ARTIFACT_HOME, a free port: never the default home or 4800) and
// Chrome, against the catalog in local D1 and each artifact in its own Durable Object.
//
// 1. The owner signs in with the owner key. `open-artifact remote add` prints the approval address; the owner approves
//    it in Chrome (`/link/device`, rendered and posted through the Worker). A local whiteboard folder and a local doc
//    are published. A file written in the local folder shows on the open cloud page with no reload; a note written on
//    the cloud page comes down into the working copy. A comment sent to the agent on the cloud page reaches the
//    owning session's inbox once; the agent's `ArtifactComments reply` shows on the page. With the daemon stopped, a
//    comment sent meanwhile is delivered once when it is back. Then both are unpublished.
// 2. The administrator mints a Link token with the Worker's admin API (`POST /api/open-artifact.admin.link-tokens`, the
//    stand-in for `open-artifact-host link-token`). A second daemon with only OPEN_ARTIFACT_REMOTE,
//    OPEN_ARTIFACT_REMOTE_TOKEN and OPEN_ARTIFACT_PUBLISH=auto links itself and publishes a new artifact by itself.
// 3. Measured with another minted token: what `link.hello` advertises, and what a room takes (a pushed file of 1, 8
//    and 16 MiB; a body past 32 MiB is refused).
// 4. Listing 25 artifacts costs the same number of D1 queries as listing one (`OA_DEBUG_STATS=1`).
// 5. Remote MCP: the OAuth code flow against `/mcp` (a configured client), `tools/list`, create a whiteboard, publish
//    files, read them back, open it in Chrome, and open a snapshot address in a browser with nothing in it.
//
// Skipped (with the reason) when deploy/cloudflare has no node_modules, with E2E_BROWSER=0, without Chrome, or before
// `npm run build`.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { findChrome, launch } from './lib/browser.mjs';
import { buildWorkers, d1, d1Cost, freePort, sqlValue, startWrangler, wranglerMissing, zipFolder } from './lib/cloudflare.mjs';
import { clickOn, cookieOf, inFrame, writeNote } from './lib/host-page.mjs';
import { until } from './lib/http.mjs';
import { browserOff, removeTmp, repoRoot, tmpDir } from './lib/target.mjs';

const T = { timeout: 300000 };
const CLI = path.join(repoRoot, 'packages', 'daemon', 'src', 'bin', 'open-artifact.ts');
const SAMPLE = path.join(repoRoot, 'test-artifacts', 'whiteboard', 'elements');
const OWNER_KEY = `owner-${randomBytes(12).toString('hex')}`;
const SIGNING_KEY = randomBytes(32).toString('hex');
const REDIRECT = 'http://127.0.0.1:9/callback';
const LINK = '/api/open-artifact.link.';
const ADMIN = '/api/open-artifact.admin.link-tokens';
const IMPORT = '/api/open-artifact.artifacts.import';
const IGNORE = [/favicon\.ico/];
const DRAWN = "location.hostname.endsWith('.content.localhost') && document.getElementById('root')?.childElementCount > 0";
const MiB = 1024 * 1024;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function skip() {
  const missing = wranglerMissing();
  if (missing) return missing;
  if (browserOff || !findChrome()) return 'no browser (E2E_BROWSER=0 or no Chrome)';
  const built = ['dist/daemon/shell/index.html', 'dist/daemon/home/index.html', 'dist/server/editors/whiteboard/index.html', 'dist/server/support.js'];
  const absent = built.filter(f => !fs.existsSync(path.join(repoRoot, f)));
  return absent.length ? `the host's pages are not built (npm run build): no ${absent.join(', ')}` : false;
}

/** Stops a child process: SIGTERM, then SIGKILL after five seconds. */
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([exited, sleep(5000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

/**
 * A real daemon on a free port with its own home (never the default one or port 4800). `extra` adds environment
 * (presets). Answers `{ home, workspace, env, log(), api(name, body), tool(name, args), cli(args), stop(), start() }`.
 */
async function daemon(label, extra = {}) {
  const home = tmpDir(`${label}-home`);
  const workspace = tmpDir(`${label}-agent`);
  const port = await freePort();
  assert.notEqual(port, 4800);
  const env = { ...process.env, OPEN_ARTIFACT_HOME: home, OPEN_ARTIFACT_BROWSER: 'none', OPEN_ARTIFACT_IDLE_MS: '0', OPEN_ARTIFACT_LINK_RESCAN_MS: '0', OPEN_ARTIFACT_LINK_RETRY_MS: '200', OPEN_ARTIFACT_HARNESS: 'cli', OPEN_ARTIFACT_SESSION: `e2e-${label}`, ...extra };
  for (const name of ['OPEN_ARTIFACT_EXTRA_TYPES', 'OPEN_ARTIFACT_BUILTIN_TYPES', 'OPEN_ARTIFACT_SHELL_DIR', 'OPEN_ARTIFACT_HOME_DIR', 'OPEN_ARTIFACT_REMOTE_NAME', 'OPEN_ARTIFACT_REMOTE_INSECURE_HTTP', 'OPEN_ARTIFACT_PLUGIN_REMOTE']) delete env[name];
  if (!extra.OPEN_ARTIFACT_REMOTE) for (const name of ['OPEN_ARTIFACT_REMOTE', 'OPEN_ARTIFACT_REMOTE_TOKEN', 'OPEN_ARTIFACT_PUBLISH']) delete env[name];
  const caller = { harness: 'cli', session: `e2e-${label}`, workspace };
  let child = null;
  let log = '';
  const d = {
    home,
    workspace,
    env,
    log: () => log,
    async start() {
      fs.rmSync(path.join(home, 'daemon.json'), { force: true });
      child = spawn(process.execPath, [CLI, 'daemon', 'run', '--port', String(port)], { env, cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', chunk => (log += chunk));
      child.stderr.on('data', chunk => (log += chunk));
      assert.ok(await until(() => fs.existsSync(path.join(home, 'daemon.json')), 30000), `the daemon did not start:\n${log}`);
      assert.ok(await until(async () => (await fetch(`${d.state().url}/__open-artifact/health`).catch(() => null))?.ok, 15000), 'the daemon does not answer');
    },
    async stop() {
      await stop(child);
    },
    state: () => JSON.parse(fs.readFileSync(path.join(home, 'daemon.json'), 'utf8')),
    async api(name, body) {
      const state = d.state();
      const res = await fetch(`${state.url}/api/open-artifact.${name}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${state.token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return res.json();
    },
    tool: (name, args) => d.api('tools.call', { name, arguments: args, caller }),
    /** The messages the owning session's next tool result carries. */
    messages: async () => (await d.tool('Artifact', { action: 'list' })).messages ?? [],
    cli: (args, onStderr) =>
      new Promise(resolve => {
        const run = spawn(process.execPath, [CLI, ...args], { env, cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '';
        let stderr = '';
        run.stdout.on('data', chunk => (stdout += chunk));
        run.stderr.on('data', chunk => {
          stderr += chunk;
          onStderr?.(stderr);
        });
        const timer = setTimeout(() => run.kill(), 90000);
        run.on('close', code => {
          clearTimeout(timer);
          resolve({ code, stdout, stderr });
        });
      }),
  };
  await d.start();
  return d;
}

/** A JSON-RPC call to `/mcp` with a Bearer token: the result (or the error, thrown). */
async function mcp(app, token, method, params = {}, id = Math.floor(Math.random() * 1e9)) {
  const res = await fetch(`${app}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  const text = await res.text();
  const body = (res.headers.get('content-type') ?? '').includes('event-stream') ? JSON.parse(/^data: (.*)$/m.exec(text)[1]) : JSON.parse(text);
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

const toolText = result => JSON.parse(result.content[0].text);

describe('cloudflare: Link and remote MCP on the product Worker under wrangler dev', { skip: skip() }, () => {
  const ctx = {};
  const notes = [];
  const note = (what, value) => {
    notes.push(`${what}: ${JSON.stringify(value)}`);
    console.log(`# cloudflare-link: ${what}: ${JSON.stringify(value)}`);
  };
  const asOwner = (route, init = {}) => fetch(`${ctx.app}${route}`, { ...init, headers: { cookie: `oa_session=${ctx.ownerSession}`, ...(init.headers ?? {}) } });
  /** The admin API from the owner's signed-in page (same origin, its own session). */
  const mint = (user, label) =>
    ctx.ownerPage.evaluate(`(async () => {
      const res = await fetch('${ADMIN}', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user: ${JSON.stringify(user)}, label: ${JSON.stringify(label)} }) });
      return { status: res.status, body: await res.json() };
    })()`);
  const catalogRow = id => d1(ctx.state, `SELECT id, type, title, owner_user, trashed_at FROM artifacts WHERE id = ${sqlValue(id)}`)[0];

  before(async () => {
    buildWorkers();
    ctx.state = tmpDir('cloudflare-link');
    ctx.port = await freePort();
    ctx.app = `http://localhost:${ctx.port}`;
    ctx.server = await startWrangler({
      port: ctx.port,
      state: ctx.state,
      vars: {
        OA_APP_ORIGIN: ctx.app,
        OA_CONTENT_ORIGIN: `http://{id}.content.localhost:${ctx.port}`,
        OA_SIGNING_KEYS: SIGNING_KEY,
        OA_OWNER_KEY: OWNER_KEY,
        OA_DEBUG_STATS: '1',
        OA_OAUTH_CLIENTS: JSON.stringify([{ client_id: 'e2e', client_name: 'E2E client', redirect_uris: [REDIRECT] }]),
      },
      ready: async origin => (await fetch(`${origin}/__open-artifact/health`)).status === 200,
    });
    ctx.owner = await launch();
    ctx.clean = await launch();
  });

  after(async () => {
    for (const browser of [ctx.owner, ctx.clean]) await browser?.close();
    await ctx.agent?.stop();
    await ctx.auto?.stop();
    await ctx.server?.stop();
    if (notes.length) console.log(`# cloudflare-link measurements:\n#   ${notes.join('\n#   ')}`);
    removeTmp();
  });

  it('links a daemon approved in Chrome; publishes; syncs both ways; delivers comments once, also after the daemon was off; unpublishes', T, async () => {
    const { owner, app } = ctx;
    // The owner signs in (the key fills the form from the address's fragment).
    const page = (ctx.ownerPage = await owner.load(`${app}/auth/sign-in#key=${OWNER_KEY}`, { ready: "document.getElementById('key')?.value.length > 0", ignore: IGNORE }));
    await clickOn(page, "document.querySelector('form[action=\"/auth/owner-key\"] button[type=submit]')", 'Sign in');
    assert.ok(await page.waitFor(`location.href === ${JSON.stringify(`${app}/`)}`, 20000), `not signed in: ${await page.evaluate('location.href')}`);
    ctx.ownerSession = await cookieOf(page, app, 'oa_session');
    assert.ok(ctx.ownerSession);

    // 1. remote add: the approval address is the Worker's own `/link/device`; the owner approves in Chrome.
    const agent = (ctx.agent = await daemon('cf-agent'));
    let approval = null;
    const linking = agent.cli(['remote', 'add', 'cloud', app], text => {
      approval ??= /^Open(?:ed)? (\S+) in (?:your|a) browser/m.exec(text)?.[1] ?? null;
    });
    assert.ok(await until(() => approval, 20000), 'remote add printed no address');
    assert.match(approval, new RegExp(`^${app}/link/device\\?`));
    const approve = await owner.load(approval, { ready: "document.querySelector('button[name=decision][value=approve]')", ignore: IGNORE });
    await clickOn(approve, "document.querySelector('button[name=decision][value=approve]')", 'Approve');
    const linked = await linking;
    assert.equal(linked.code, 0, linked.stderr + agent.log().slice(-1500));
    assert.match(linked.stdout, /^Linked cloud \(http:\/\/localhost:\d+\) as /);
    await approve.close();
    const ownerId = d1(ctx.state, 'SELECT user_id FROM agent_tokens ORDER BY created_at DESC LIMIT 1')[0]?.user_id;
    assert.ok(ownerId);
    // The daemon's event stream is open: the owner's agent is online on the Worker's hub.
    const hub = async () => (await (await asOwner('/__open-artifact/stats')).json()).hub;
    assert.ok(await until(async () => (await hub())?.links >= 1, 15000), `no Link stream on the hub: ${JSON.stringify(await hub())}`);

    // 2. A local whiteboard folder (the sample, renamed) and a new local doc, published.
    const folder = path.join(agent.workspace, 'linked-board');
    fs.cpSync(SAMPLE, folder, { recursive: true, filter: src => !/[\\/](_agent|history)([\\/]|$)/.test(src.slice(SAMPLE.length)) });
    const meta = path.join(folder, 'db', 'board', 'meta.json');
    fs.writeFileSync(meta, JSON.stringify({ ...JSON.parse(fs.readFileSync(meta, 'utf8')), title: 'Linked board' }));
    const adopted = await agent.tool('Artifact', { action: 'adopt', folder, type_url: 'open-artifact://type/whiteboard' });
    assert.equal(adopted.error, undefined, JSON.stringify(adopted));
    const board = /art_[0-9a-z]+/.exec(adopted.url)[0];
    // A doc folder adopted as it is (the folder's name is not the doc's): the doc's own name is its title.
    const docFolder = path.join(agent.workspace, 'docs-browser-qa');
    fs.cpSync(path.join(repoRoot, 'test-artifacts', 'docs', 'browser-qa'), docFolder, { recursive: true });
    const adoptedDoc = await agent.tool('Artifact', { action: 'adopt', folder: docFolder, type_url: 'open-artifact://type/docs' });
    assert.equal(adoptedDoc.error, undefined, JSON.stringify(adoptedDoc));
    const folderDoc = /art_[0-9a-z]+/.exec(adoptedDoc.url)[0];
    const madeDoc = await agent.tool('Artifact', { action: 'publish', type_url: 'open-artifact://type/docs', title: 'Plan doc' });
    assert.equal(madeDoc.error, undefined, JSON.stringify(madeDoc));
    const doc = /art_[0-9a-z]+/.exec(madeDoc.url)[0];
    const wroteDoc = await agent.tool('Artifact', { action: 'call', url: madeDoc.url, name: 'create', args: { call: { name: 'Plan doc', doc: { markdown: '# Plan\n\nFirst draft.' } } } });
    assert.equal(wroteDoc.error, undefined, JSON.stringify(wroteDoc));
    for (const id of [board, doc, folderDoc]) {
      const out = await agent.api('artifacts.publish', { id, remote: 'cloud' });
      assert.equal(out.code, undefined, JSON.stringify(out));
      assert.equal(out.view_url, `${app}/a/${id}`);
      assert.equal(catalogRow(id)?.owner_user, ownerId);
    }
    // An adopted folder is titled by what its content declares (the board's meta title, the doc's name), not by the
    // folder's name, on the computer and on the host; the home page lists them so.
    assert.deepEqual([catalogRow(board).type, catalogRow(board).title], ['whiteboard', 'Linked board']);
    assert.deepEqual([catalogRow(doc).type, catalogRow(doc).title], ['docs', 'Plan doc']);
    assert.deepEqual([catalogRow(folderDoc).type, catalogRow(folderDoc).title], ['docs', 'Docs Browser QA']);
    const listedHome = await owner.load(`${app}/`, { ready: "document.body.innerText.includes('Docs Browser QA')", ignore: IGNORE });
    const homeText = await listedHome.evaluate('document.body.innerText');
    assert.ok(homeText.includes('Docs Browser QA') && homeText.includes('Linked board'), `the home page does not list the content titles: ${homeText.slice(0, 600)}`);
    assert.ok(!homeText.includes('docs-browser-qa'), 'the home page shows the folder name');
    await listedHome.close();
    const docPage = await owner.load(`${app}/a/${doc}`, { ready: DRAWN, timeout: 45000, ignore: IGNORE });
    assert.ok(await docPage.waitFor("location.hostname.endsWith('.content.localhost') && document.body.innerText.includes('First draft')", 30000), 'the doc does not show its text on the cloud');
    await docPage.close();

    // 3. The cloud board in Chrome; a local write shows on it with no reload.
    const boardPage = await owner.load(`${app}/a/${board}`, { ready: DRAWN, timeout: 45000, ignore: IGNORE });
    assert.ok(await boardPage.waitFor("location.hostname.endsWith('.content.localhost') && document.querySelector('#wb-e1')", 30000), 'the cloud page did not draw the board');
    const loadedAt = await boardPage.evaluate('performance.timeOrigin');
    const framedAt = await inFrame(boardPage, 'async () => performance.timeOrigin');
    fs.writeFileSync(path.join(folder, 'db', 'elements', 'e2e-live.json'), JSON.stringify({ type: 'note', x: 40, y: 40, w: 220, h: 120, text: 'Written on the computer', color: 'yellow' }));
    const order = JSON.parse(fs.readFileSync(meta, 'utf8'));
    fs.writeFileSync(meta, JSON.stringify({ ...order, order: [...order.order, 'e2e-live'] }));
    assert.ok(await boardPage.waitFor("document.querySelector('#wb-e2e-live')?.innerText.includes('Written on the computer')", 30000), `the local write did not show on the cloud page\n${agent.log().slice(-1500)}`);
    assert.equal(await boardPage.evaluate('performance.timeOrigin'), loadedAt, 'the Shell reloaded');
    assert.equal(await inFrame(boardPage, 'async () => performance.timeOrigin'), framedAt, 'the framed page reloaded');

    // 4. A note written on the cloud page comes down into the working copy.
    assert.equal(await writeNote(boardPage, 'fromcloud', 'Written in the cloud', [400, 80]), 200);
    const pulled = path.join(folder, 'db', 'elements', 'fromcloud.json');
    assert.ok(await until(() => fs.existsSync(pulled) && fs.readFileSync(pulled, 'utf8').includes('Written in the cloud'), 20000), `the cloud edit was not pulled\n${agent.log().slice(-1500)}`);

    // 5. A comment sent to the agent from the cloud page reaches the owning session once.
    await agent.messages();
    const comment = text =>
      inFrame(
        boardPage,
        `async (base) => {
          const post = (path, body) => fetch(base + '_api/' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, body: await r.json() }));
          const created = await post('comments/create', { input: { anchor: '{"element":"e1"}', label: 'Note', text: ${JSON.stringify(text)} } });
          if (created.status !== 200) return created;
          const sent = await post('comments/send', { threadId: created.body.thread.id });
          return { status: sent.status, thread: created.body.thread.id };
        }`,
      );
    const first = await comment('Please make it blue');
    assert.equal(first.status, 200, JSON.stringify(first));
    const seen = [];
    assert.ok(await until(async () => (seen.push(...(await agent.messages())), seen.some(m => m.includes('Please make it blue'))), 30000, 500), `no message reached the session: ${JSON.stringify(seen)}\n${agent.log().slice(-1500)}`);
    assert.equal(seen.filter(m => m.includes('Please make it blue')).length, 1);
    assert.ok(await until(() => d1(ctx.state, `SELECT acked_at FROM outbox WHERE to_user = ${sqlValue(ownerId)} AND kind = 'wake'`).every(r => r.acked_at !== null), 15000, 500), 'the wake was not acknowledged');
    await sleep(1000);
    assert.equal((await agent.messages()).filter(m => m.includes('Please make it blue')).length, 0, 'the comment came twice');

    // 6. The agent replies from the daemon: the reply shows on the cloud page.
    const url = `open-artifact://artifact/${board}`;
    const replied = await agent.tool('ArtifactComments', { action: 'reply', url, thread_id: first.thread, text: 'Done, it is blue now' });
    assert.equal(replied.error, undefined, JSON.stringify(replied));
    const threadText = async () => inFrame(boardPage, `async (base) => JSON.stringify(await (await fetch(base + '_api/comments')).json())`);
    assert.ok(await until(async () => (await threadText())?.includes('Done, it is blue now'), 15000), `the reply is not on the page: ${await threadText()}`);

    // 7. With the daemon stopped, a comment sent meanwhile is kept, and delivered once when it is back.
    await agent.stop();
    assert.ok(await until(async () => (await hub())?.links === 0, 20000), 'the Link stream did not end');
    const away = await comment('While you were away');
    assert.equal(away.status, 200, JSON.stringify(away));
    assert.ok(d1(ctx.state, `SELECT payload_json FROM outbox WHERE to_user = ${sqlValue(ownerId)} AND kind = 'wake' AND acked_at IS NULL`).some(r => r.payload_json.includes('While you were away')), 'the wake is not kept in the outbox');
    await agent.start();
    const back = [];
    assert.ok(await until(async () => (back.push(...(await agent.messages())), back.some(m => m.includes('While you were away'))), 40000, 500), `not delivered after the restart: ${JSON.stringify(back)}\n${agent.log().slice(-1500)}`);
    await sleep(1500);
    back.push(...(await agent.messages()));
    assert.equal(back.filter(m => m.includes('While you were away')).length, 1, JSON.stringify(back));

    // 8. Unpublish them: off the host (in the trash), the working copies keep the cloud's changes.
    for (const id of [board, doc, folderDoc]) {
      const out = await agent.api('artifacts.unpublish', { id });
      assert.equal(out.code, undefined, JSON.stringify(out));
      assert.ok(catalogRow(id)?.trashed_at, `${id} is not in the trash`);
    }
    assert.ok(fs.readFileSync(pulled, 'utf8').includes('Written in the cloud'));
    assert.ok(await until(async () => (await inFrame(boardPage, `async (base) => (await fetch(base + '_api/session')).status`).catch(() => 0)) !== 200, 15000), 'the unpublished page still answers');
    await boardPage.close();
    assert.deepEqual(page.problems, []);
  });

  it('an admin-minted token presets a daemon that links and publishes by itself', T, async () => {
    const minted = await mint('ada@example.com', 'e2e laptop');
    assert.equal(minted.status, 201, JSON.stringify(minted.body));
    assert.equal(minted.body.remote, ctx.app);
    assert.match(minted.body.token, /^oa_rt_/);
    const auto = (ctx.auto = await daemon('cf-auto', { OPEN_ARTIFACT_REMOTE: ctx.app, OPEN_ARTIFACT_REMOTE_TOKEN: minted.body.token, OPEN_ARTIFACT_PUBLISH: 'auto' }));
    let listed = '';
    assert.ok(await until(async () => ((listed = (await auto.cli(['remote', 'list'])).stdout), listed.includes('\tada@example.com\t')), 30000), `the preset remote did not sign in:\n${listed}\n${auto.log().slice(-1500)}`);
    assert.match(listed, /\tdefault/);
    const created = await auto.tool('Artifact', { action: 'publish', type_url: 'open-artifact://type/whiteboard', title: 'Published by itself' });
    assert.equal(created.error, undefined, JSON.stringify(created));
    const id = /art_[0-9a-z]+/.exec(created.url)[0];
    assert.ok(await until(() => catalogRow(id)?.title === 'Published by itself', 30000, 500), `not published by itself\n${auto.log().slice(-1500)}`);
    const ada = d1(ctx.state, "SELECT id FROM users WHERE email = 'ada@example.com'")[0].id;
    assert.equal(catalogRow(id).owner_user, ada);
    // The minted token was used once (it rotates): it signs nobody in again.
    const reused = await fetch(`${ctx.app}${LINK}token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: minted.body.token }) });
    assert.equal(reused.status, 400);
    await auto.stop();
  });

  it('measures what hello advertises and what a room takes', T, async () => {
    const minted = await mint('measure@example.com', 'measurements');
    assert.equal(minted.status, 201);
    const token = await (await fetch(`${ctx.app}${LINK}token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: minted.body.token }) })).json();
    assert.ok(token.access_token, JSON.stringify(token));
    const bearer = { authorization: `Bearer ${token.access_token}` };
    const hello = await (await fetch(`${ctx.app}${LINK}hello`, { headers: bearer })).json();
    assert.deepEqual(hello.limits, { maxBodyBytes: 32 * MiB, maxFileBytes: 16 * MiB });
    note('link.hello limits', hello.limits);

    const id = `art_${randomBytes(8).toString('hex')}`;
    const imported = await fetch(`${ctx.app}${LINK}import?id=${id}&type=whiteboard`, { method: 'POST', headers: { ...bearer, 'content-type': 'application/zip' }, body: await zipFolder(SAMPLE) });
    assert.equal(imported.status, 201, await imported.text());
    const push = async (bytes, name) => {
      const started = Date.now();
      const res = await fetch(`${ctx.app}${LINK}files`, {
        method: 'POST',
        headers: { ...bearer, 'content-type': 'application/json' },
        body: JSON.stringify({ id, writes: [{ path: `media/${name}`, content: randomBytes(bytes).toString('base64') }] }),
      });
      return { status: res.status, ms: Date.now() - started, body: await res.text() };
    };
    for (const size of [1, 8, 16]) {
      const pushed = await push(size * MiB, `${size}mib.bin`);
      note(`push of a ${size} MiB file`, { status: pushed.status, ms: pushed.ms });
      assert.equal(pushed.status, 200, pushed.body.slice(0, 500));
      const read = await fetch(`${ctx.app}${LINK}files?id=${id}&path=media/${size}mib.bin`, { headers: bearer });
      assert.equal((await read.arrayBuffer()).byteLength, size * MiB);
    }
    // Past the cap the Worker answers 413 from the declared length without reading the body. The local runtime then
    // closes the socket while a client is still writing, so a whole 33 MiB body ends in a broken pipe before the
    // answer can be read (fetch and node:http both). So the request declares a 25 MiB file's body (about 33 MiB),
    // sends its first bytes, and reads the answer. (A body with no declared length is counted as it streams: unit test
    // `agents.test.ts`.)
    const declared = JSON.stringify({ id, writes: [{ path: 'media/too-big.bin', content: '' }] }).length + Math.ceil((25 * MiB) / 3) * 4;
    const tooBig = await new Promise((resolve, reject) => {
      const req = http.request(`${ctx.app}${LINK}files`, { method: 'POST', headers: { ...bearer, 'content-type': 'application/json', 'content-length': declared } }, res => {
        let text = '';
        res.on('data', chunk => (text += chunk));
        res.on('end', () => (resolve({ status: res.statusCode, body: text }), req.destroy()));
      });
      req.on('error', error => (error.code === 'EPIPE' || error.code === 'ECONNRESET' ? undefined : reject(error)));
      req.write(`{"id":"${id}","writes":[{"path":"media/too-big.bin","content":"`);
    });
    assert.ok(declared > 32 * MiB);
    note('push of a 25 MiB file (body ~33 MiB)', { status: tooBig.status });
    assert.equal(tooBig.status, 413, tooBig.body.slice(0, 300));
    const room = await (await asOwner(`/__open-artifact/stats?id=${id}`)).json();
    note('room after the pushes', { storage: room.room?.storage, d1: room.room?.d1 });
  });

  it('lists 25 artifacts with as many D1 queries as one', T, async () => {
    // The counts are the isolate's D1 calls while the request ran, so work an import left running after its answer
    // (its `waitUntil`: the catalog's record of the new artifact, one write) can be counted on the next request. Each
    // count is therefore taken after a pause, from the second of two lists in a row.
    const list = async () => {
      await sleep(500);
      await asOwner('/api/open-artifact.artifacts');
      const res = await asOwner('/api/open-artifact.artifacts');
      const body = await res.json();
      return { count: body.artifacts.length, cost: d1Cost(res) };
    };
    // The owner's live artifacts (the published two are in the trash): import until there is one, then 25.
    const zip = await zipFolder(SAMPLE);
    const importOne = async () => {
      const res = await asOwner(IMPORT, { method: 'POST', headers: { 'content-type': 'application/zip', origin: ctx.app }, body: zip });
      assert.equal(res.status, 201, await res.text());
    };
    let now = await list();
    while (now.count < 1) (await importOne(), (now = await list()));
    const one = now;
    while (now.count < 25) (await importOne(), (now = await list()));
    note(`artifact list with ${one.count}`, one.cost);
    note(`artifact list with ${now.count}`, now.cost);
    assert.ok(one.cost && now.cost, 'no D1 counts (OA_DEBUG_STATS=1)');
    assert.equal(now.cost.queries, one.cost.queries, 'the list costs more queries with more artifacts');
    note('home page with 25', d1Cost(await asOwner('/')));
  });

  it('remote MCP: OAuth, tools/list, create, publish files, read back, open in Chrome, a snapshot address in a clean browser', T, async () => {
    const { app } = ctx;
    const refused = await fetch(`${app}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) });
    assert.equal(refused.status, 401);
    const metadataUrl = /resource_metadata="([^"]+)"/.exec(refused.headers.get('www-authenticate') ?? '')?.[1];
    assert.ok(metadataUrl, refused.headers.get('www-authenticate'));
    const resource = await (await fetch(metadataUrl)).json();
    const server = await (await fetch(`${resource.authorization_servers[0]}/.well-known/oauth-authorization-server`)).json();
    const verifier = randomBytes(32).toString('base64url');
    const params = { response_type: 'code', client_id: 'e2e', redirect_uri: REDIRECT, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', state: 's1', resource: resource.resource };

    // The consent page in the owner's Chrome; the person presses Approve; the browser is sent to the client's
    // redirect address (nothing listens there: the address is read from the tab).
    const consent = await ctx.owner.load(`${server.authorization_endpoint}?${new URLSearchParams(params)}`, { ready: "document.querySelector('button[name=decision][value=approve]')", ignore: [...IGNORE, /127\.0\.0\.1:9|ERR_CONNECTION_REFUSED|ERR_UNSAFE_PORT|net::ERR/] });
    assert.match(await consent.evaluate('document.body.innerText'), /E2E client/);
    await clickOn(consent, "document.querySelector('button[name=decision][value=approve]')", 'Approve');
    let location = null;
    assert.ok(
      await until(async () => {
        const { targetInfos } = await consent.cdp('Target.getTargets').catch(() => ({ targetInfos: [] }));
        const href = targetInfos.map(t => t.url).find(u => u.startsWith(REDIRECT)) ?? (await consent.evaluate('location.href').catch(() => ''));
        location = href.startsWith(REDIRECT) ? new URL(href) : null;
        return location;
      }, 15000),
      'the consent did not redirect to the client',
    );
    assert.equal(location.searchParams.get('state'), 's1');
    const tokenRes = await fetch(server.token_endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: location.searchParams.get('code'), client_id: 'e2e', redirect_uri: REDIRECT, code_verifier: verifier }),
    });
    assert.equal(tokenRes.status, 200);
    const access = (await tokenRes.json()).access_token;
    await consent.close().catch(() => undefined);

    const init = await mcp(app, access, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '0' } });
    assert.ok(init.serverInfo, JSON.stringify(init));
    const tools = (await mcp(app, access, 'tools/list')).tools.map(t => t.name).sort();
    assert.deepEqual(tools, ['Artifact', 'ArtifactComments', 'ArtifactData', 'ShowArtifact']);
    const call = async (name, args) => toolText(await mcp(app, access, 'tools/call', { name, arguments: args }));
    const types = (await call('Artifact', { action: 'list', scope: 'types' })).types.map(t => t.id);
    assert.ok(types.includes('whiteboard') && types.includes('docs'), types.join(','));

    const created = await call('Artifact', { action: 'publish', type_url: 'open-artifact://type/whiteboard', title: 'Made over MCP' });
    assert.ok(!created.error, JSON.stringify(created));
    const url = String(created.url);
    const id = url.replace('open-artifact://artifact/', '');
    assert.equal(catalogRow(id)?.title, 'Made over MCP');
    const note1 = { type: 'note', x: 80, y: 80, w: 240, h: 120, text: 'Written over MCP', color: 'yellow' };
    const metaNow = await call('Artifact', { action: 'read', url, path: 'db/board/meta.json' });
    const boardMeta = JSON.parse(metaNow.content);
    const written = await call('Artifact', { action: 'publish', url, files: { 'db/elements/mcp1.json': JSON.stringify(note1), 'db/board/meta.json': JSON.stringify({ ...boardMeta, order: [...(boardMeta.order ?? []), 'mcp1'] }) } });
    assert.ok(!written.error, JSON.stringify(written));
    const read = await call('Artifact', { action: 'read', url, path: 'db/elements/mcp1.json' });
    assert.equal(JSON.parse(read.content).text, 'Written over MCP');

    // In the owner's Chrome.
    const seen = await ctx.owner.load(`${app}/a/${id}`, { ready: DRAWN, timeout: 45000, ignore: IGNORE });
    assert.ok(await seen.waitFor("document.querySelector('#wb-mcp1')?.innerText.includes('Written over MCP')", 30000), 'the MCP write does not show in Chrome');
    await seen.close();

    // A snapshot address, opened in a browser with nothing in it (no cookie): read-only, it draws.
    const snap = await call('Artifact', { action: 'call', url, name: 'snapshot', args: {} });
    assert.ok(!snap.error, JSON.stringify(snap));
    assert.match(String(snap.page_url), /\.content\.localhost:\d+\//);
    const clean = await ctx.clean.load(snap.page_url, { ready: "document.getElementById('root')?.childElementCount > 0", timeout: 45000, ignore: IGNORE });
    assert.ok(await clean.waitFor("document.querySelector('#wb-mcp1')?.innerText.includes('Written over MCP')", 30000), 'the snapshot address does not draw the board');
    const session = await clean.evaluate("fetch(location.origin + location.pathname + '_api/session').then(r => r.json())");
    assert.equal(session.viewer?.role, 'viewer', JSON.stringify(session));
    assert.deepEqual(clean.problems, []);
  });
});
