// End-to-end test of a person's own type published to the Node site (`packages/host`) and artifacts of it, in Chrome.
//
// The real host on a free port (its app on `localhost`, each viewer's page on its own `*.content.localhost` page host)
// and two real daemons (`open-artifact daemon run`, each its own home, port and user types folder):
// - the owner's (a site admin), linked by the device flow in Chrome;
// - a member's, set up in advance with a Link token minted by `open-artifact-host link-token`.
// The types are synthetic (e2e/fixtures/site-type/team-poll: a poll with db rules, comments and the user).
//
// - `publish` of an artifact of a type the site does not have is refused, naming the type and both commands; an agent
//   session cannot publish a type; `types publish` puts it in the site's catalog; the artifact then publishes.
// - The owner opens it: its page runs on a page host with no page token in its address, which reads files only. A
//   second person joins by the share links as viewer, commenter and editor; the type's db rules decide what each writes.
// - A new version reaches the open page. `types unpublish` delists it (one artifact uses it): the artifact still opens.
// - `publish --with-type` sends a fresh type first. Who may publish under OA_TYPES_PUBLISH: admins (the default: the
//   member is refused), members (the member publishes), off (nobody), the host restarted on the same data each time.
//
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { findChrome, launch } from './lib/browser.mjs';
import { until } from './lib/http.mjs';
import { browserOff, removeTmp, repoRoot, tmpDir } from './lib/target.mjs';

const T = { timeout: 300000 };
const MAIN = path.join(repoRoot, 'packages', 'host', 'src', 'node', 'main.ts');
const CLI = path.join(repoRoot, 'packages', 'daemon', 'src', 'bin', 'open-artifact.ts');
const FIXTURE = path.join(repoRoot, 'e2e', 'fixtures', 'site-type', 'team-poll');
const MEMBER = 'ben@example.com';
/** In the page's own frame (a page host: `<idlabel>--<24 base32>`). */
const IN_PAGE = "/^art-[0-9a-z]+--[a-z2-7]{24}\\.content\\.localhost$/.test(location.hostname)";

function skip() {
  if (browserOff || !findChrome()) return 'no browser (E2E_BROWSER=0 or no Chrome)';
  const built = ['dist/daemon/shell/index.html', 'dist/daemon/home/index.html', 'dist/daemon/frame-host/client/shell.html', 'dist/daemon/frame-host/client/runtime.js'];
  const missing = built.filter(f => !fs.existsSync(path.join(repoRoot, f)));
  return missing.length ? `not built (npm run build): no ${missing.join(', ')}` : false;
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([exited, sleep(5000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

const centerOf = selector => `(() => { const e = ${selector}; if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`;

async function clickOn(page, selector, what = selector) {
  assert.ok(await page.waitFor(selector, 15000), `nothing to click: ${what}`);
  const at = await page.evaluate(centerOf(selector));
  assert.ok(at, `nothing to click: ${what}`);
  await page.click(...at);
}

/** `expression` in the page's own frame (undefined while there is none). */
const inPage = (page, expression) => page.evaluateAll(`(${IN_PAGE}) ? (${expression}) : undefined`).then(values => values.find(v => v !== undefined && v !== null), () => undefined);
const ready = page => until(async () => (await inPage(page, "document.getElementById('status')?.textContent")) === 'ready', 60000);

/** A plain request to the site with a Host header of our choosing (a page host). */
async function asHost(port, host, pathname) {
  const { request } = await import('node:http');
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: pathname, headers: { host } }, res => {
      let body = '';
      res.on('data', c => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

/** Copies the fixture type into `root` as `id` (another id and uid make it another type), at `version`. */
function placeType(root, id, { uid, version = '1.0.0' } = {}) {
  const dir = path.join(root, id);
  fs.cpSync(FIXTURE, dir, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'artifact-type.json'), 'utf8'));
  manifest.slug = id;
  manifest.intents = [id];
  manifest.version = version;
  if (uid) manifest.uid = uid;
  fs.writeFileSync(path.join(dir, 'artifact-type.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8').replaceAll('1.0.0', version).replace('var key = "team-poll";', `var key = ${JSON.stringify(id)};`);
  fs.writeFileSync(path.join(dir, 'index.html'), html);
  const skill = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8').replace('name: team-poll', `name: ${id}`);
  fs.writeFileSync(path.join(dir, 'SKILL.md'), skill);
  return dir;
}

const IGNORE = [/favicon\.ico/, /not_granted|forbidden|not available in this view/i, /HTTP 40[134]/, /Failed to load resource/, /Content Security Policy|Refused to connect/];

describe('a person\'s own type on the site in Chrome', { skip: skip() }, () => {
  const ctx = {};

  /** Starts the host on the data folder with `publish` as OA_TYPES_PUBLISH (unset: the default). */
  async function startHost(publish) {
    const env = { ...ctx.hostEnv };
    if (publish) env.OA_TYPES_PUBLISH = publish;
    ctx.log = '';
    ctx.host = spawn(process.execPath, [MAIN, 'serve'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    ctx.host.stdout.on('data', chunk => (ctx.log += chunk));
    ctx.host.stderr.on('data', chunk => (ctx.log += chunk));
    assert.ok(await until(() => /listening on/.test(ctx.log), 30000), `the host did not start:\n${ctx.log}`);
    await until(async () => (await fetch(`${ctx.app}/`).then(r => r.status, () => 0)) > 0, 30000);
  }

  before(async () => {
    const data = path.join(tmpDir('host-types'), 'data');
    ctx.data = data;
    ctx.port = await freePort();
    ctx.app = `http://localhost:${ctx.port}`;
    ctx.hostEnv = { ...process.env, OA_DATA_DIR: data, OA_PORT: String(ctx.port), OA_BIND: '127.0.0.1', OA_APP_ORIGIN: ctx.app, OA_CONTENT_ORIGIN: `http://{id}.content.localhost:${ctx.port}` };
    for (const name of ['OA_OWNER_KEY', 'OA_SIGNING_KEYS', 'OA_CONTENT_SAME_SITE', 'OA_PAGE_NETWORK', 'OA_TYPES_PUBLISH']) delete ctx.hostEnv[name];
    // The member's Link token, minted before the host serves (the same data folder).
    const minted = spawnSync(process.execPath, [MAIN, 'link-token', '--user', MEMBER, '--label', 'e2e member'], { env: ctx.hostEnv, encoding: 'utf8', timeout: 60000 });
    assert.equal(minted.status, 0, `link-token failed: ${minted.stderr}`);
    ctx.memberToken = /OPEN_ARTIFACT_REMOTE_TOKEN=(\S+)/.exec(minted.stdout)?.[1];
    assert.ok(ctx.memberToken, 'link-token printed no token');
    await startHost(null);
    const signIn = () => /(http:\/\/\S+\/auth\/sign-in#key=\S+)/.exec(ctx.log)?.[1];
    await until(signIn, 30000);
    ctx.signIn = signIn();
    assert.ok(ctx.signIn, `the host printed no sign-in address:\n${ctx.log}`);
    assert.match(ctx.log, /pages: +on/, 'the start says pages run');
    assert.match(ctx.log, /types: +/, 'the start says what it does with published types');
    ctx.owner = await launch();
    ctx.guest = await launch();
  });

  after(async () => {
    await ctx.owner?.close();
    await ctx.guest?.close();
    for (const name of ['daemon', 'member', 'host']) await stop(ctx[name]);
    removeTmp();
  });

  /** A daemon of its own (home, port, user types); `extra` env presets. Answers a CLI runner for it. */
  async function daemon(name, extra = {}) {
    const home = tmpDir(`${name}-home`);
    const workspace = tmpDir(`${name}-agent`);
    const types = tmpDir(`${name}-types`);
    const port = await freePort();
    const env = { ...process.env, OPEN_ARTIFACT_HOME: home, OPEN_ARTIFACT_USER_TYPES: types, OPEN_ARTIFACT_BROWSER: 'none', OPEN_ARTIFACT_IDLE_MS: '0', OPEN_ARTIFACT_HARNESS: 'cli', OPEN_ARTIFACT_SESSION: `e2e-${name}`, ...extra };
    for (const v of ['OPEN_ARTIFACT_EXTRA_TYPES', 'OPEN_ARTIFACT_BUILTIN_TYPES', 'OPEN_ARTIFACT_SHELL_DIR', 'OPEN_ARTIFACT_HOME_DIR', 'CLAUDECODE', 'OPEN_ARTIFACT_PUBLISH']) delete env[v];
    if (!extra.OPEN_ARTIFACT_REMOTE) for (const v of ['OPEN_ARTIFACT_REMOTE', 'OPEN_ARTIFACT_REMOTE_TOKEN', 'OPEN_ARTIFACT_REMOTE_NAME']) delete env[v];
    let log = '';
    const child = spawn(process.execPath, [CLI, 'daemon', 'run', '--port', String(port)], { env, cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => (log += chunk));
    child.stderr.on('data', chunk => (log += chunk));
    assert.ok(await until(() => fs.existsSync(path.join(home, 'daemon.json')), 30000), `the daemon did not start:\n${log}`);
    const cli = (args, { onStderr, env: more = {} } = {}) =>
      new Promise(resolve => {
        const run = spawn(process.execPath, [CLI, ...args], { env: { ...env, ...more }, cwd: workspace, stdio: ['ignore', 'pipe', 'pipe'] });
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
      });
    const artifactTool = async args => {
      const out = await cli(['artifact', JSON.stringify(args)]);
      assert.equal(out.code, 0, out.stdout + out.stderr);
      return JSON.parse(out.stdout);
    };
    return { child, cli, artifactTool, types, log: () => log };
  }

  it('publishes a type and its artifact, runs it per share role, follows a new version, delists it, and applies OA_TYPES_PUBLISH', T, async () => {
    const { owner, guest, app, port } = ctx;

    // 1. The owner signs in, and links their computer.
    const home = await owner.load(ctx.signIn, { ready: "document.getElementById('key')?.value.length > 0", ignore: IGNORE });
    await clickOn(home, "document.querySelector('form[action=\"/auth/owner-key\"] button[type=submit]')", 'Sign in');
    assert.ok(await home.waitFor(`location.href === ${JSON.stringify(`${app}/`)}`, 20000));
    const mine = await daemon('owner');
    ctx.daemon = mine.child;
    let approval = null;
    const linking = mine.cli(['remote', 'add', 'cloud', app], {
      onStderr: text => {
        approval ??= /^Open(?:ed)? (\S+) in (?:your|a) browser/m.exec(text)?.[1] ?? null;
      },
    });
    assert.ok(await until(() => approval, 20000), 'remote add printed no address');
    const approve = await owner.load(approval, { ready: "document.querySelector('button[name=decision][value=approve]')", ignore: IGNORE });
    await clickOn(approve, "document.querySelector('button[name=decision][value=approve]')", 'Approve');
    const linked = await linking;
    assert.equal(linked.code, 0, linked.stderr);
    await approve.close();

    // 2. The owner's own type, and an artifact of it the agent makes.
    const typeDir = placeType(mine.types, 'team-poll');
    const made = await mine.artifactTool({ action: 'publish', type_url: 'open-artifact://type/team-poll', title: 'Lunch poll', open: 'never' });
    const id = /art_[0-9a-z]+/.exec(made.url)?.[0];
    assert.ok(id, JSON.stringify(made));

    // 3. Not on the site yet: refused, naming the type and both commands.
    const refused = await mine.cli(['publish', id]);
    assert.notEqual(refused.code, 0, refused.stdout);
    assert.match(refused.stderr, /team-poll/);
    assert.match(refused.stderr, /open-artifact types publish team-poll --remote cloud/);
    assert.match(refused.stderr, /--with-type/);
    // An agent session never publishes a type.
    const asAgent = await mine.cli(['types', 'publish', 'team-poll'], { env: { CLAUDECODE: '1' } });
    assert.notEqual(asAgent.code, 0);
    assert.match(asAgent.stderr, /Publishing a type to a site is the person's decision/);

    // 4. The person publishes the type, then the artifact.
    const typed = await mine.cli(['types', 'publish', 'team-poll']);
    assert.equal(typed.code, 0, typed.stdout + typed.stderr);
    assert.match(typed.stderr, /^Published to cloud \(http:\/\/localhost:\d+\): team-poll 1\.0\.0, visibility private\./m);
    const first = JSON.parse(typed.stdout);
    assert.equal(first.change, 'new');
    assert.equal(first.type.uid, '0f6a3c1e-5b2d-4e8f-9a17-3c2b1d0e4f56');
    assert.ok(fs.existsSync(path.join(ctx.data, 'types', first.type.uid, '1.0.0', 'package.oatype')), 'the site keeps the package under its data folder');
    const published = await mine.cli(['publish', id]);
    assert.equal(published.code, 0, published.stdout + published.stderr);
    assert.equal(published.stdout.trim().split('\n')[0], `Published to cloud: ${app}/a/${id}`);

    // 5. The owner opens it: on a page host, no page token in the address, the type's own files.
    const page = await owner.load(`${app}/a/${id}`, { ready: 'true', ignore: IGNORE });
    assert.ok(await ready(page), `the page did not start: ${JSON.stringify(await page.evaluateAll('location.href + " " + (document.body?.innerText ?? "").slice(0, 200)'))}\nproblems: ${page.problems.slice(-10).join('\n')}\n${ctx.log.slice(-1500)}`);
    const href = await inPage(page, 'location.href');
    assert.match(href, /^http:\/\/art-[0-9a-z]+--[a-z2-7]{24}\.content\.localhost:\d+\/_f\/[^/]+\/$/, href);
    assert.equal(/v1\./.test(href), false, 'the page address holds no page token');
    assert.match(await inPage(page, 'pageTest.style()'), /system-ui/, 'the type\'s stylesheet loaded');
    assert.equal(await inPage(page, "document.body.dataset.version"), '1.0.0');
    assert.deepEqual(JSON.parse(await inPage(page, "document.getElementById('me').textContent")), { owner: true, canEdit: true });
    assert.equal(await inPage(page, "pageTest.vote('owner', 'noodles')"), 'ok');
    assert.equal(await inPage(page, "pageTest.ask('Lunch?')"), 'ok');
    const ownerHost = new URL(href).host;
    // The page host reads files only.
    const pageApi = await asHost(port, ownerHost, '/api/frame/session');
    assert.ok(pageApi.status >= 400 && !pageApi.body.includes('"grants"'), `the page host answered its API: ${pageApi.status}`);

    // 6. A second person by the share links: viewer, commenter, editor, as the type's db rules say.
    const share = async body => page.evaluate(`fetch('/api/open-artifact.artifact.share', { method: 'POST', headers: { 'content-type': 'application/json' }, body: ${JSON.stringify(JSON.stringify({ id, ...body }))} }).then(r => r.json())`);
    const view = await share({ access: 'link', links: { viewer: true, commenter: true, editor: true } });
    assert.ok(view.links?.viewer?.url, JSON.stringify(view));
    const join = await guest.load(view.links.viewer.url, { ready: "document.querySelector('input[name=name]')", ignore: IGNORE });
    await clickOn(join, "document.querySelector('input[name=name]')", 'the name field');
    await join.type('Vic');
    await clickOn(join, "document.querySelector('form button[type=submit]')", 'Open it');
    assert.ok(await join.waitFor(`location.pathname === '/a/${id}'`, 20000));
    assert.ok(await ready(join), 'the viewer\'s page did not start');
    const guestHref = await inPage(join, 'location.href');
    assert.notEqual(new URL(guestHref).host, ownerHost, 'the viewer has a page host of their own');
    assert.ok(await until(async () => (await inPage(join, "document.querySelector('[data-vote=owner]')?.textContent")) === 'noodles', 20000), 'the viewer does not see the votes');
    assert.deepEqual(JSON.parse(await inPage(join, "document.getElementById('me').textContent")), { owner: false, canEdit: false });
    assert.equal(await inPage(join, "pageTest.vote('vic', 'soup')"), 'ok', 'the type\'s db rules let a viewer vote');
    assert.notEqual(await inPage(join, "pageTest.ask('Dinner?')"), 'ok', 'a viewer does not change the question');
    assert.equal(await inPage(join, 'pageTest.comments()'), false, 'no comments for a viewer');
    const gid = (await share({})).guests?.find(g => g.name === 'Vic')?.id;
    assert.ok(gid, 'the guest is listed');
    await share({ guests: { [gid]: 'commenter' } });
    await join.close();
    const asCommenter = await guest.load(`${app}/a/${id}`, { ready: 'true', ignore: IGNORE });
    assert.ok(await ready(asCommenter));
    assert.equal(await inPage(asCommenter, 'pageTest.comments()'), true, 'a commenter has comments');
    assert.notEqual(await inPage(asCommenter, "pageTest.ask('Dinner?')"), 'ok', 'a commenter does not change the question');
    await share({ guests: { [gid]: 'editor' } });
    await asCommenter.close();
    const asEditor = await guest.load(`${app}/a/${id}`, { ready: 'true', ignore: IGNORE });
    assert.ok(await ready(asEditor));
    assert.deepEqual(JSON.parse(await inPage(asEditor, "document.getElementById('me').textContent")), { owner: false, canEdit: true });
    assert.equal(await inPage(asEditor, "pageTest.ask('Dinner?')"), 'ok', 'an editor changes the question');
    assert.ok(await until(async () => (await inPage(page, "document.getElementById('question').textContent")) === 'Dinner?', 20000), 'the owner does not see the editor\'s change');
    await asEditor.close();

    // 7. A new version reaches the open page, and the old version's files go.
    placeType(mine.types, 'team-poll', { version: '1.1.0' });
    assert.ok(fs.existsSync(typeDir));
    const next = await mine.cli(['types', 'publish', 'team-poll']);
    assert.equal(next.code, 0, next.stdout + next.stderr);
    assert.match(next.stderr, /^Published version 1\.1\.0 \(was 1\.0\.0\) to cloud/m);
    assert.ok(await until(async () => (await inPage(page, 'document.body.dataset.version')) === '1.1.0', 30000), 'the open page did not get the new version');
    assert.ok(await ready(page));
    assert.ok(await until(() => !fs.existsSync(path.join(ctx.data, 'types', first.type.uid, '1.0.0')), 10000), 'the old version\'s files stayed');

    // 8. Unpublished while an artifact uses it: delisted, and the artifact still opens.
    const off = await mine.cli(['types', 'unpublish', 'team-poll']);
    assert.equal(off.code, 0, off.stdout + off.stderr);
    const delisted = JSON.parse(off.stdout);
    assert.equal(delisted.removed, false);
    assert.equal(delisted.artifacts, 1);
    await page.close();
    const again = await owner.load(`${app}/a/${id}`, { ready: 'true', ignore: IGNORE });
    assert.ok(await ready(again), 'a delisted type\'s artifact no longer opens');
    assert.equal(await inPage(again, 'document.body.dataset.version'), '1.1.0');
    await again.close();
    // A new artifact of it is refused until the type is published again.
    const later = await mine.artifactTool({ action: 'publish', type_url: 'open-artifact://type/team-poll', title: 'Later poll', open: 'never' });
    const laterId = /art_[0-9a-z]+/.exec(later.url)?.[0];
    const laterOut = await mine.cli(['publish', laterId]);
    assert.notEqual(laterOut.code, 0);
    assert.match(laterOut.stderr, /unpublished/);

    // 9. --with-type on a fresh type: the type goes first (visibility link), then the artifact.
    placeType(mine.types, 'team-tally', { uid: '5d1e7a2b-8c3f-4a6e-b9d0-1f2e3a4b5c6d' });
    const tally = await mine.artifactTool({ action: 'publish', type_url: 'open-artifact://type/team-tally', title: 'Tally', open: 'never' });
    const tallyId = /art_[0-9a-z]+/.exec(tally.url)?.[0];
    const withType = await mine.cli(['publish', tallyId, '--with-type']);
    assert.equal(withType.code, 0, withType.stdout + withType.stderr);
    assert.equal(withType.stdout.trim().split('\n')[0], `Published to cloud: ${app}/a/${tallyId}`);
    const tallyPage = await owner.load(`${app}/a/${tallyId}`, { ready: 'true', ignore: IGNORE });
    assert.ok(await ready(tallyPage), 'the with-type artifact did not start');
    await tallyPage.close();

    // 10. Who may publish. admins (the default): the member is refused.
    const member = await daemon('member', { OPEN_ARTIFACT_REMOTE: app, OPEN_ARTIFACT_REMOTE_TOKEN: ctx.memberToken, OPEN_ARTIFACT_REMOTE_NAME: 'cloud' });
    ctx.member = member.child;
    placeType(member.types, 'ben-poll', { uid: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d' });
    assert.ok(await until(async () => /"signedIn": true/.test((await member.cli(['remote', 'status', '--json'])).stdout), 30000), 'the member\'s daemon did not sign in');
    const memberRefused = await member.cli(['types', 'publish', 'ben-poll']);
    assert.notEqual(memberRefused.code, 0);
    assert.match(memberRefused.stderr, /Only the site admins may publish types to this site \(OA_TYPES_PUBLISH=admins\)/);
    // members: the member publishes (with-type on their own artifact).
    await stop(ctx.host);
    await startHost('members');
    const benArt = await member.artifactTool({ action: 'publish', type_url: 'open-artifact://type/ben-poll', title: 'Ben poll', open: 'never' });
    const benId = /art_[0-9a-z]+/.exec(benArt.url)?.[0];
    const benOut = await member.cli(['publish', benId, '--with-type']);
    assert.equal(benOut.code, 0, benOut.stdout + benOut.stderr + ctx.log.slice(-800));
    // off: nobody, the admin included.
    await stop(ctx.host);
    await startHost('off');
    const adminOff = await mine.cli(['types', 'publish', 'team-poll']);
    assert.notEqual(adminOff.code, 0);
    assert.match(adminOff.stderr, /does not take published types \(OA_TYPES_PUBLISH=off\)/);
    // What is published keeps running.
    const stillThere = await owner.load(`${app}/a/${id}`, { ready: 'true', ignore: IGNORE });
    assert.ok(await ready(stillThere), 'an artifact of a published type stopped opening under off');
    await stillThere.close();
  });
});
