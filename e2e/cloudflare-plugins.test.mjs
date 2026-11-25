// End-to-end test of host plugins on the product Worker under `wrangler dev`. The plugins are bundled at build time
// from a module of their own (`OA_PLUGINS_MODULE=e2e/fixtures/host-plugins/cloudflare-plugins.mjs`, the five examples
// and the ten-line guard), built into a folder of their own (`OA_BUILD_DIST=deploy/cloudflare/dist-e2e-plugins`) so
// the other Cloudflare suites' `deploy/cloudflare/dist` is untouched, and chosen at run time by `OA_PLUGINS`.
//
// The Worker sits behind a stand-in sign-in proxy (`e2e/lib/proxy.mjs`), as a company runs it: the proxy adds the
// e-mail header and the shared secret to every request, and the site rechecks its session against them.
// Over HTTP: `header-auth` signs in whoever sends the e-mail header with the shared secret (and nobody without it);
// a session holds only while the proxy says the same person; the admin API lists the plugins for a site admin; `static-groups` makes Bob an editor of Ann's artifact (the site's
// isolate); the guard refuses the archive with its sentence.
// In Chrome (skipped with E2E_BROWSER=0): Bob opens Ann's artifact; the framed page's session, answered by the
// artifact's own Durable Object (another isolate, with its own copy of the plugins), says editor, and his edit is
// taken.
//
// Skipped (with the reason) when deploy/cloudflare has no node_modules.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { findChrome, launch } from './lib/browser.mjs';
import { DEPLOY, freePort, startWrangler, wranglerMissing, zipFolder } from './lib/cloudflare.mjs';
import { abilities } from './lib/host-page.mjs';
import { requestWithHost } from './lib/http.mjs';
import { startSignInProxy } from './lib/proxy.mjs';
import { browserOff, removeTmp, repoRoot, tmpDir } from './lib/target.mjs';

const T = { timeout: 300000 };
const SAMPLE = path.join(repoRoot, 'test-artifacts', 'whiteboard', 'elements');
const MODULE = path.join(repoRoot, 'e2e', 'fixtures', 'host-plugins', 'cloudflare-plugins.mjs');
const DIST = path.join(DEPLOY, 'dist-e2e-plugins');
const SIGNING_KEY = randomBytes(32).toString('hex');
const SECRET = randomBytes(24).toString('hex');
const REFUSAL = 'Downloads are turned off on this site; ask an administrator.';
const ANN = 'ann@corp.example';
const BOB = 'bob@corp.example';
const IGNORE = [/favicon\.ico/];
const DRAWN = "location.hostname.endsWith('.content.localhost') && document.getElementById('root')?.childElementCount > 0";

function browserSkip() {
  if (browserOff || !findChrome()) return 'no browser (E2E_BROWSER=0 or no Chrome)';
  const built = ['dist/daemon/shell/index.html', 'dist/server/editors/whiteboard/index.html', 'dist/server/support.js'];
  const missing = built.filter(f => !fs.existsSync(path.join(repoRoot, f)));
  return missing.length ? `the host's pages are not built (npm run build): no ${missing.join(', ')}` : false;
}

/**
 * Builds the Workers with the test plugins into `DIST`, and writes a wrangler config there (the paths of
 * `wrangler.jsonc`, relative to that folder; the build empties the folder, so it is written after).
 */
function buildWithPlugins() {
  const built = spawnSync(process.execPath, ['build.mjs'], { cwd: DEPLOY, encoding: 'utf8', env: { ...process.env, OA_PLUGINS_MODULE: MODULE, OA_BUILD_DIST: DIST } });
  if (built.status !== 0) throw new Error(`build failed:\n${built.stdout}\n${built.stderr}`);
  assert.match(built.stdout, /host plugins from .*cloudflare-plugins\.mjs/);
  const config = {
    name: 'open-artifact-e2e-plugins',
    main: 'site/worker.js',
    compatibility_date: '2026-11-01',
    compatibility_flags: ['nodejs_compat', 'enable_request_signal', 'request_signal_passthrough'],
    no_bundle: true,
    base_dir: 'site',
    rules: [{ type: 'CompiledWasm', globs: ['**/*.wasm'], fallthrough: false }],
    assets: { directory: 'assets', binding: 'ASSETS', html_handling: 'none', not_found_handling: 'none', run_worker_first: ['/_open-artifact/shell/index.html'] },
    d1_databases: [{ binding: 'DB', database_name: 'open-artifact', database_id: '00000000-0000-0000-0000-000000000000' }],
    durable_objects: { bindings: [{ name: 'ROOMS', class_name: 'ArtifactObject' }, { name: 'HUB', class_name: 'SiteHubObject' }] },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['ArtifactObject', 'SiteHubObject'] }],
  };
  const file = path.join(DIST, 'wrangler.json');
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  return file;
}

describe('cloudflare: host plugins bundled into the Worker, under wrangler dev', { skip: wranglerMissing() }, () => {
  const ctx = { sessions: {} };
  /** A request through the proxy as `email` (null: nobody), with that person's site session once they have one. */
  const as = (email, route, init = {}) => {
    const write = init.method && init.method !== 'GET';
    const cookies = [email ? `e2e_who=${encodeURIComponent(email)}` : '', email && ctx.sessions[email] ? `oa_session=${ctx.sessions[email]}` : ''].filter(Boolean).join('; ');
    return fetch(`${ctx.app}${route}`, { ...init, redirect: 'manual', headers: { ...(cookies ? { cookie: cookies } : {}), ...(write ? { origin: ctx.app } : {}), ...(init.headers ?? {}) } });
  };
  const signIn = async email => {
    const me = await as(email, '/api/open-artifact.auth.me');
    assert.equal(me.status, 200);
    const session = (me.headers.getSetCookie?.() ?? []).map(line => line.split(';')[0]).find(pair => pair.startsWith('oa_session='));
    if (session) ctx.sessions[email] = session.slice('oa_session='.length);
    return me.json();
  };

  before(async () => {
    const config = buildWithPlugins();
    ctx.state = tmpDir('cloudflare-plugins');
    ctx.port = await freePort();
    ctx.workerPort = await freePort();
    ctx.app = `http://localhost:${ctx.port}`;
    const list = [
      { use: 'header-auth', config: { secret: { env: 'PROXY_SECRET' } } },
      { use: 'static-groups', config: { groups: { design: BOB }, roles: { design: `editor:${ANN}` } } },
      { use: 'no-export' },
    ];
    ctx.proxy = await startSignInProxy(ctx.port, ctx.workerPort, SECRET);
    ctx.server = await startWrangler({
      port: ctx.workerPort,
      state: ctx.state,
      config,
      vars: {
        OA_APP_ORIGIN: ctx.app,
        OA_CONTENT_ORIGIN: `http://{id}.content.localhost:${ctx.port}`,
        OA_SIGNING_KEYS: SIGNING_KEY,
        // The owner-key sign-in stays on (the default); a Worker needs its key set.
        OA_OWNER_KEY: `owner-${randomBytes(12).toString('hex')}`,
        OA_OWNERS: ANN,
        OA_SIGNUP: 'open',
        OA_PLUGINS: JSON.stringify(list),
        PROXY_SECRET: SECRET,
      },
      ready: async origin => (await fetch(`${origin}/__open-artifact/health`)).status === 200,
    });
    await signIn(ANN);
    const made = await as(ANN, '/api/open-artifact.artifacts.import', { method: 'POST', headers: { 'content-type': 'application/zip' }, body: await zipFolder(SAMPLE) });
    assert.equal(made.status, 201, await made.clone().text());
    ctx.artifact = await made.json();
  });

  after(async () => {
    await ctx.browser?.close();
    await ctx.server?.stop();
    ctx.proxy?.close();
    fs.rmSync(DIST, { recursive: true, force: true });
    removeTmp();
  });

  it('header-auth signs in with the secret, and nobody without it; the admin API lists the bundled plugins', T, async () => {
    const bob = await signIn(BOB);
    assert.equal(bob.principal.kind, 'user');
    assert.equal(bob.principal.email, BOB);
    assert.equal(bob.site?.brand?.name, 'Acme Artifacts');
    // Straight to the Worker, with a guessed secret: nobody.
    // (Under the app's name: fetch would send the listener's, which is not the site's.)
    const forged = await requestWithHost(`http://127.0.0.1:${ctx.workerPort}/api/open-artifact.auth.me`, new URL(ctx.app).host, { headers: { 'x-forwarded-email': 'ceo@corp.example', 'x-proxy-secret': 'guess' } });
    assert.equal(forged.status, 200, forged.body);
    assert.equal(JSON.parse(forged.body).principal.kind, 'anonymous');
    // Bob's session with the proxy now saying Ann (someone else at this browser): Ann's. With the proxy saying no one
    // (signed out upstream): nobody, and the session is gone.
    const other = await fetch(`${ctx.app}/api/open-artifact.auth.me`, { headers: { cookie: `e2e_who=${encodeURIComponent(ANN)}; oa_session=${ctx.sessions[BOB]}` } });
    assert.equal((await other.json()).principal.email, ANN);
    await signIn(BOB);
    const gone = await fetch(`${ctx.app}/api/open-artifact.auth.me`, { headers: { cookie: `oa_session=${ctx.sessions[BOB]}` } });
    assert.equal((await gone.json()).principal.kind, 'anonymous');
    delete ctx.sessions[BOB];
    assert.equal((await signIn(BOB)).principal.email, BOB);
    const plugins = await as(ANN, '/api/open-artifact.admin.plugins');
    assert.equal(plugins.status, 200);
    const text = await plugins.text();
    assert.ok(!text.includes(SECRET));
    assert.deepEqual(JSON.parse(text).plugins.map(p => p.id), ['header-auth', 'static-groups', 'no-export']);
    assert.equal((await as(BOB, '/api/open-artifact.admin.plugins')).status, 403);
  });

  it("static-groups makes Bob an editor of Ann's artifact; the guard refuses the archive with its sentence", T, async () => {
    const view = await as(BOB, `/api/open-artifact.artifact?id=${ctx.artifact.id}`);
    assert.equal(view.status, 200, await view.clone().text());
    assert.equal((await view.json()).role, 'editor');
    const archive = await as(ANN, `/api/open-artifact.artifact.archive?id=${ctx.artifact.id}`);
    assert.equal(archive.status, 403);
    assert.deepEqual(await archive.json(), { code: 'not_granted', message: REFUSAL });
  });

  it("inside the artifact's room, Bob's framed page is an editor's: its session says so and his edit is taken", { ...T, skip: browserSkip() }, async () => {
    ctx.browser = await launch();
    const first = await ctx.browser.load(`${ctx.app}/__open-artifact/health`, { ready: 'true', ignore: IGNORE });
    await first.cdp('Network.setCookie', { name: 'e2e_who', value: encodeURIComponent(BOB), url: ctx.app, httpOnly: true, sameSite: 'Lax' });
    await first.cdp('Network.setCookie', { name: 'oa_session', value: ctx.sessions[BOB], url: ctx.app, httpOnly: true, sameSite: 'Lax' });
    await first.close();
    const page = await ctx.browser.load(`${ctx.app}/a/${ctx.artifact.id}`, { ready: DRAWN, timeout: 60000, ignore: IGNORE });
    assert.deepEqual(await abilities(page), { role: 'editor', comment: 200, edit: 200 });
    await page.close();
  });
});
