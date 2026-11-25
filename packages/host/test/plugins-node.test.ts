/**
 * Plugins on the Node host: the list (`OA_PLUGINS`, the list file), resolving each `use`, the `plugin` commands, and
 * the five examples in `examples/host-plugins` running in a real host over HTTP against local stand-ins for the
 * services they call (a proxy's JWKS, a permission service, a webhook receiver, a mail API).
 */

import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as signWith, createHmac } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, request, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it, test } from 'node:test';
import type { ArtifactView } from '@open-artifact/protocol';
import { HOME_BOOT_PLACEHOLDER, SHELL_BOOT_PLACEHOLDER } from '../src/core/app/pages.ts';
import { parseConfig } from '../src/core/config.ts';
import { PluginConfigError } from '../src/core/plugins/config.ts';
import { parseNodeEnv } from '../src/node/env.ts';
import { startHost, type RunningHost } from '../src/node/host.ts';
import { main } from '../src/node/main.ts';
import { changePluginList, loadSitePlugins, pluginListFile, readPluginListSource, resolvePluginUse, RESTART_NOTE } from '../src/node/plugins.ts';

const EXAMPLES = fileURLToPath(new URL('../../../examples/host-plugins/', import.meta.url));

async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'open-artifact-host-plugins-'));
}

const PLUGIN_SOURCE = `export default { id: 'tiny', apiVersion: 1, name: 'Tiny', version: '1.2.3', on: { 'artifact.changed': () => undefined } };\n`;

describe('the plugin list and its modules', () => {
  it('OA_PLUGINS wins over the list file; the file defaults to <dataDir>/plugins.json; OA_PLUGINS_FILE moves it', async () => {
    const dir = await tempDir();
    try {
      assert.equal(pluginListFile({}, dir), join(dir, 'plugins.json'));
      assert.equal(pluginListFile({ OA_PLUGINS_FILE: join(dir, 'x.json') }, dir), join(dir, 'x.json'));
      const none = await readPluginListSource({}, dir);
      assert.equal(none.text, undefined);
      await writeFile(join(dir, 'plugins.json'), '[{"use":"./tiny.mjs"}]');
      const file = await readPluginListSource({}, dir);
      assert.deepEqual([file.source, file.baseDir], [join(dir, 'plugins.json'), dir]);
      const inline = await readPluginListSource({ OA_PLUGINS: '[]' }, dir);
      assert.deepEqual([inline.source, inline.text, inline.baseDir], ['OA_PLUGINS', '[]', process.cwd()]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('resolves a path (from the list file\'s folder), a package in <dataDir>/plugins/node_modules, and says how to install a missing one', async () => {
    const dir = await tempDir();
    try {
      await writeFile(join(dir, 'tiny.mjs'), PLUGIN_SOURCE);
      const byPath = await resolvePluginUse('./tiny.mjs', { baseDir: dir, dataDir: dir });
      assert.ok('url' in byPath && byPath.url.endsWith('/tiny.mjs'));
      const pkg = join(dir, 'plugins', 'node_modules', '@acme', 'oa-tiny');
      await mkdir(join(pkg, 'dist'), { recursive: true });
      await writeFile(join(pkg, 'package.json'), JSON.stringify({ name: '@acme/oa-tiny', type: 'module', exports: { '.': { import: './dist/index.js' } } }));
      await writeFile(join(pkg, 'dist', 'index.js'), PLUGIN_SOURCE);
      const byPackage = await resolvePluginUse('@acme/oa-tiny', { baseDir: dir, dataDir: dir });
      assert.ok('url' in byPackage && byPackage.url.endsWith('/dist/index.js'), JSON.stringify(byPackage));
      const missing = await resolvePluginUse('@acme/oa-missing', { baseDir: dir, dataDir: dir });
      assert.ok('error' in missing);
      assert.match(missing.error, new RegExp(`install it with: npm install --prefix ${join(dir, 'plugins').replace(/[/\\]/g, '.')} @acme/oa-missing`));
      const absent = await resolvePluginUse('./nope.mjs', { baseDir: dir, dataDir: dir });
      assert.deepEqual(absent, { error: `there is no file ${join(dir, 'nope.mjs')} ("./nope.mjs" from ${dir})` });

      await writeFile(join(dir, 'plugins.json'), JSON.stringify([{ use: './tiny.mjs' }, { use: '@acme/oa-tiny', enabled: false }, { use: './nope.mjs', optional: true }]));
      const { loaded } = await loadSitePlugins({}, dir);
      assert.equal((loaded[0]!.plugin as { id: string }).id, 'tiny');
      assert.equal((loaded[1]!.plugin as { id: string }).id, 'tiny');
      assert.match(loaded[2]!.loadError ?? '', /there is no file/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('plugin add|disable|enable|remove change the list file (mode 0600) and say a restart applies it; refused while OA_PLUGINS is set', async () => {
    const dir = await tempDir();
    try {
      await writeFile(join(dir, 'tiny.mjs'), PLUGIN_SOURCE);
      const file = join(dir, 'plugins.json');
      const at = { cwd: dir, as: 'open-artifact-host' };
      const added = await changePluginList({}, dir, 'add', ['./tiny.mjs', '--config', '{"a":1}', '--optional', '--timeout-ms=2000', '--cache-seconds', '10'], at);
      assert.deepEqual(added.slice(0, 2), [`Added ./tiny.mjs to ${file}.`, RESTART_NOTE]);
      assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), [{ use: './tiny.mjs', config: { a: 1 }, optional: true, timeoutMs: 2000, cacheSeconds: 10 }]);
      if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777, 0o600);
      await assert.rejects(changePluginList({}, dir, 'add', ['./tiny.mjs'], at), /is in the list already/);
      // By its id as well as its use.
      assert.deepEqual(await changePluginList({}, dir, 'disable', ['tiny']), [`Disabled ./tiny.mjs in ${file}.`, RESTART_NOTE]);
      assert.equal((JSON.parse(await readFile(file, 'utf8')) as Array<{ enabled?: boolean }>)[0]!.enabled, false);
      await changePluginList({}, dir, 'enable', ['./tiny.mjs']);
      assert.equal((JSON.parse(await readFile(file, 'utf8')) as Array<{ enabled?: boolean }>)[0]!.enabled, undefined);
      await assert.rejects(changePluginList({}, dir, 'remove', ['other']), /No plugin "other" in/);
      assert.match((await changePluginList({}, dir, 'remove', ['tiny']))[0]!, /^Removed \.\/tiny\.mjs from .*Its stored data \(ctx\.kv\) is kept\.$/);
      assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), []);
      await assert.rejects(changePluginList({ OA_PLUGINS: '[]' }, dir, 'add', ['./tiny.mjs'], at), (error: unknown) => {
        assert.ok(error instanceof PluginConfigError);
        assert.match(error.message, /OA_PLUGINS is set, and it wins over the plugin list file: change OA_PLUGINS instead \(or unset it to use the file\)\./);
        return true;
      });
      await assert.rejects(changePluginList({}, dir, 'add', ['./tiny.mjs', '--bogus'], at), /unknown option --bogus/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('plugin add of a relative path stores the file the person named: relative to the list file inside the data folder, absolute outside it', async () => {
    const dir = await tempDir();
    try {
      const data = join(dir, 'data');
      await mkdir(join(data, 'plugins'), { recursive: true });
      await mkdir(join(dir, 'elsewhere'), { recursive: true });
      await writeFile(join(data, 'plugins', 'tiny.mjs'), PLUGIN_SOURCE);
      await writeFile(join(dir, 'elsewhere', 'other.mjs'), PLUGIN_SOURCE.replace("'tiny'", "'other'"));
      const file = join(data, 'plugins.json');
      // Typed from the data folder's parent: written from the list file's folder.
      const added = await changePluginList({}, data, 'add', ['./data/plugins/tiny.mjs'], { cwd: dir, as: 'node packages/host/src/node/main.ts' });
      assert.equal(added[0], `Added ./plugins/tiny.mjs to ${file}.`);
      assert.ok(added.includes('Run `node packages/host/src/node/main.ts plugin check` to see whether it can run.'), added.join('\n'));
      // Outside the data folder: absolute.
      await changePluginList({}, data, 'add', ['../elsewhere/other.mjs'], { cwd: data });
      assert.deepEqual((JSON.parse(await readFile(file, 'utf8')) as Array<{ use: string }>).map((e) => e.use), ['./plugins/tiny.mjs', join(dir, 'elsewhere', 'other.mjs')]);
      const { loaded } = await loadSitePlugins({}, data);
      assert.deepEqual(loaded.map((l) => (l.plugin as { id: string }).id), ['tiny', 'other']);
      // A file that is not there is refused, naming the file looked for.
      await assert.rejects(changePluginList({}, data, 'add', ['./nope.mjs'], { cwd: dir }), new RegExp(`there is no file ${join(dir, 'nope.mjs').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('plugin set and unset change an entry\'s settings, checked against the plugin first; --secret writes {"env": …}', async () => {
    const dir = await tempDir();
    try {
      await writeFile(
        join(dir, 'conf.mjs'),
        `export default { id: 'conf', apiVersion: 1, config: { url: { type: 'string', required: true }, retries: { type: 'number', default: 1 }, on: { type: 'boolean' }, tags: { type: 'string[]' }, token: { type: 'secret' } }, validate: (c) => c.url.startsWith('https:') ? undefined : 'url must be https', on: { 'artifact.changed': () => undefined } };\n`,
      );
      const file = join(dir, 'plugins.json');
      await writeFile(file, JSON.stringify([{ use: './conf.mjs', config: { url: 'https://a.example' } }]));
      const at = { as: 'open-artifact-host' };
      const read = async (): Promise<Record<string, unknown>> => (JSON.parse(await readFile(file, 'utf8')) as Array<Record<string, unknown>>)[0]!;
      const said = await changePluginList({ TOKEN_VAR: 'x'.repeat(20) }, dir, 'set', ['conf', 'retries=3', 'on=true', 'tags=a, b', '--secret', 'token=TOKEN_VAR', '--timeout-ms', '9000', '--cache-seconds=20', '--optional'], at);
      assert.equal(said[0], `Set retries, on, tags, token, timeoutMs, cacheSeconds, optional of conf in ${file}.`);
      assert.deepEqual(await read(), { use: './conf.mjs', config: { url: 'https://a.example', retries: 3, on: true, tags: ['a', 'b'], token: { env: 'TOKEN_VAR' } }, timeoutMs: 9000, cacheSeconds: 20, optional: true });
      // Checked before writing: an unknown setting, a wrong type, the plugin's own validate.
      await assert.rejects(changePluginList({}, dir, 'set', ['conf', 'colour=red'], at), /unknown setting "colour"/);
      await assert.rejects(changePluginList({}, dir, 'set', ['conf', 'retries=many'], at), /setting "retries": expected a number/);
      await assert.rejects(changePluginList({}, dir, 'set', ['conf', 'url=http://a.example'], at), /url must be https/);
      await assert.rejects(changePluginList({}, dir, 'set', ['conf', '--secret', 'token=not a name'], at), /not an environment variable name/);
      assert.deepEqual((await read()).config, { url: 'https://a.example', retries: 3, on: true, tags: ['a', 'b'], token: { env: 'TOKEN_VAR' } }, 'nothing written');
      // A variable only the host's environment has is named, not held against the change.
      const elsewhere = await changePluginList({}, dir, 'set', ['conf', 'retries=4'], at);
      assert.match(elsewhere.join('\n'), /Not set in this shell: TOKEN_VAR\. The host needs it in its environment/);
      // unset.
      await changePluginList({ TOKEN_VAR: 'x'.repeat(20) }, dir, 'unset', ['conf', 'token', 'tags'], at);
      assert.deepEqual((await read()).config, { url: 'https://a.example', retries: 4, on: true });
      await assert.rejects(changePluginList({}, dir, 'unset', ['conf', 'url'], at), /setting "url" is required/);
      await assert.rejects(changePluginList({}, dir, 'unset', ['conf', 'nothing'], at), /has no setting "nothing"/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('plugin list and plugin check print each plugin; check fails when the host would not start', async () => {
    const dir = await tempDir();
    const lines: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => void lines.push(args.join(' '));
    const before = process.exitCode;
    try {
      await writeFile(join(dir, 'tiny.mjs'), PLUGIN_SOURCE);
      const env = { OA_DATA_DIR: dir, OA_SIGNING_KEYS: 'k'.repeat(40), OA_OWNER_KEY: 'o'.repeat(30) };
      await main(['plugin', 'list'], env);
      assert.ok(lines.some((line) => line.startsWith('No plugins')), lines.join('\n'));
      await writeFile(join(dir, 'plugins.json'), JSON.stringify([{ use: './tiny.mjs' }]));
      lines.length = 0;
      await main(['plugin', 'check'], env);
      assert.ok(lines.some((line) => /^ {2}on {6}tiny 1\.2\.3 {2}\(\.\/tiny\.mjs\)$/.test(line)), lines.join('\n'));
      assert.ok(lines.includes('All 1 plugin(s) that are on can run.'), lines.join('\n'));
      await writeFile(join(dir, 'plugins.json'), JSON.stringify([{ use: './tiny.mjs' }, { use: './nope.mjs' }]));
      lines.length = 0;
      await main(['plugin', 'check'], env);
      assert.equal(process.exitCode, 1);
      assert.ok(lines.some((line) => line.startsWith('The host would not start: ')), lines.join('\n'));
      // A plugin that cannot run is `failed`, with why, naming the file actually looked for and where from.
      assert.ok(lines.some((line) => /^ {2}failed {2}\.\/nope\.mjs/.test(line)), lines.join('\n'));
      assert.ok(lines.some((line) => line.includes(`there is no file ${join(dir, 'nope.mjs')} ("./nope.mjs" from ${dir})`)), lines.join('\n'));
      // Disabled is `off`.
      await writeFile(join(dir, 'plugins.json'), JSON.stringify([{ use: './tiny.mjs', enabled: false }]));
      lines.length = 0;
      await main(['plugin', 'list'], env);
      assert.ok(lines.some((line) => /^ {2}off {5}tiny/.test(line)), lines.join('\n'));
    } finally {
      console.log = original;
      process.exitCode = before;
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// The five examples in a real host

interface Answer {
  status: number;
  headers: IncomingMessage['headers'];
  body: string;
}

function call(port: number, method: string, url: string, headers: Record<string, string> = {}, body?: string): Promise<Answer> {
  const target = new URL(url);
  return new Promise((resolvePromise, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path: target.pathname + target.search, headers: { host: target.host, ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return (server.address() as AddressInfo).port;
}

/** A local server that records each request's body and answers with `answer(path, body)`. */
function stub(answer: (path: string, body: string, headers: IncomingMessage['headers']) => { status?: number; json: unknown }): { server: Server; seen: Array<{ path: string; body: string; headers: IncomingMessage['headers'] }> } {
  const seen: Array<{ path: string; body: string; headers: IncomingMessage['headers'] }> = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      seen.push({ path: req.url ?? '', body, headers: req.headers });
      const out = answer(req.url ?? '', body, req.headers);
      res.writeHead(out.status ?? 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out.json));
    });
  });
  return { server, seen };
}

const b64url = (value: Buffer | string): string => Buffer.from(value).toString('base64url');

describe('the five example plugins in a real Node host', () => {
  let dir: string;
  let host: RunningHost;
  let port: number;
  let app: string;
  const servers: Server[] = [];
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'ES256', use: 'sig' };
  let jwks: ReturnType<typeof stub>;
  let perms: ReturnType<typeof stub>;
  let hook: ReturnType<typeof stub>;
  let mail: ReturnType<typeof stub>;
  /** What the permission service answers Bob. */
  let bobRole: string | null = 'editor';
  const PERMS_SECRET = 'p'.repeat(40);

  const jwt = (claims: Record<string, unknown>): string => {
    const head = b64url(JSON.stringify({ alg: 'ES256', kid: 'k1', typ: 'JWT' }));
    const body = b64url(JSON.stringify({ iss: 'https://proxy.test', aud: 'artifacts', exp: Math.floor(Date.now() / 1000) + 300, ...claims }));
    const signature = signWith('sha256', Buffer.from(`${head}.${body}`), { key: privateKey, dsaEncoding: 'ieee-p1363' });
    return `${head}.${body}.${b64url(signature)}`;
  };
  const at = (method: string, path: string, headers: Record<string, string> = {}, body?: unknown): Promise<Answer> =>
    call(port, method, app + path, { ...(method !== 'GET' ? { origin: app, 'content-type': 'application/json' } : {}), ...headers }, body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body));
  const cookieOf = (answer: Answer): string => (answer.headers['set-cookie'] ?? []).map((line) => line.split(';')[0]!).join('; ');
  /**
   * Signs in through the proxy's JWT (header-auth): the headers of this person's later requests. The proxy sends the
   * JWT on every request, and the host asks header-auth again on each (the session holds only while it says the same).
   */
  const signIn = async (email: string): Promise<Record<string, string>> => {
    const token = jwt({ sub: email, email });
    const me = await at('GET', '/api/open-artifact.auth.me', { 'x-proxy-jwt': token });
    assert.equal(me.status, 200, me.body);
    const cookie = cookieOf(me);
    assert.ok(cookie, 'a session cookie');
    return { cookie, 'x-proxy-jwt': token };
  };

  before(async () => {
    dir = await tempDir();
    jwks = stub(() => ({ json: { keys: [jwk] } }));
    perms = stub((_path, body) => {
      const asked = JSON.parse(body) as { user: { email: string | null } };
      return { json: asked.user.email === 'bob@example.com' ? { role: bobRole } : {} };
    });
    hook = stub(() => ({ json: { ok: true } }));
    mail = stub(() => ({ json: { id: 'm1' } }));
    const ports = await Promise.all([jwks, perms, hook, mail].map(async (s) => {
      servers.push(s.server);
      return listen(s.server);
    }));
    const [jwksPort, permsPort, hookPort, mailPort] = ports;

    const uiDir = join(dir, 'ui');
    await mkdir(join(uiDir, 'shell'), { recursive: true });
    await mkdir(join(uiDir, 'home'), { recursive: true });
    await writeFile(join(uiDir, 'shell', 'index.html'), `<!doctype html><script>window.boot=${SHELL_BOOT_PLACEHOLDER};</script>`);
    await writeFile(join(uiDir, 'home', 'index.html'), `<!doctype html><script>window.home=${HOME_BOOT_PLACEHOLDER};</script>`);

    const probe = createServer();
    port = await listen(probe);
    await new Promise<void>((done) => probe.close(() => done()));
    app = `http://localhost:${port}`;
    const list = [
      { use: join(EXAMPLES, 'header-auth.mjs'), config: { jwtHeader: 'x-proxy-jwt', jwksUrl: `http://127.0.0.1:${jwksPort}/jwks`, issuer: 'https://proxy.test', audience: 'artifacts' } },
      { use: join(EXAMPLES, 'static-groups.mjs'), config: { groups: { staff: '@staff.example' }, roles: { staff: 'viewer' } } },
      { use: join(EXAMPLES, 'http-authz.mjs'), config: { url: `http://127.0.0.1:${permsPort}/check`, secret: { env: 'PERMS_SECRET' } } },
      { use: join(EXAMPLES, 'webhook-events.mjs'), config: { url: { env: 'HOOK_URL' }, events: ['artifact.changed', 'share.invited'], signingSecret: { env: 'HOOK_SECRET' } } },
      { use: join(EXAMPLES, 'invite-email.mjs'), config: { apiUrl: `http://127.0.0.1:${mailPort}/send`, apiKey: { env: 'MAIL_KEY' }, from: 'Artifacts <a@example.com>' } },
    ];
    const pluginEnv = { PERMS_SECRET, HOOK_URL: `http://127.0.0.1:${hookPort}/hook`, HOOK_SECRET: 'h'.repeat(32), MAIL_KEY: 'mail-key' };
    const { loaded } = await loadSitePlugins({ OA_PLUGINS: JSON.stringify(list) }, join(dir, 'data'));
    const config = parseConfig({ OA_APP_ORIGIN: app, OA_CONTENT_ORIGIN: `http://{id}.content.localhost:${port}`, OA_SIGNING_KEYS: 'e'.repeat(40), OA_OWNER_KEY: 'o'.repeat(30), OA_SIGNUP: 'open' });
    const env = parseNodeEnv({ OA_DATA_DIR: join(dir, 'data'), OA_PORT: String(port), OA_BIND: '127.0.0.1' });
    host = await startHost({ config, env, uiDir, log: () => undefined, plugins: loaded, pluginEnv });
  });

  after(async () => {
    await host?.stop();
    for (const server of servers) server.close();
    await rm(dir, { recursive: true, force: true });
  });

  it('all five run', () => {
    assert.deepEqual(host.plugins?.describe().map((p) => [p.id, p.enabled]), [
      ['header-auth', true],
      ['static-groups', true],
      ['http-authz', true],
      ['webhook-events', true],
      ['invite-email', true],
    ]);
  });

  it('header-auth signs a person in from a JWT the proxy signs (keys from its JWKS), and nobody from a bad one', async () => {
    const me = await at('GET', '/api/open-artifact.auth.me', { 'x-proxy-jwt': jwt({ sub: 'ada@example.com', email: 'ada@example.com' }) });
    assert.equal(me.status, 200);
    assert.deepEqual((JSON.parse(me.body) as { principal: { kind: string; email: string } }).principal.email, 'ada@example.com');
    assert.ok(jwks.seen.length >= 1);
    const forged = jwt({ sub: 'x@example.com', email: 'x@example.com' }).replace(/\.[^.]+$/, `.${b64url(Buffer.alloc(64))}`);
    const refused = await at('GET', '/api/open-artifact.auth.me', { 'x-proxy-jwt': forged });
    assert.equal(cookieOf(refused), '');
    assert.equal((JSON.parse(refused.body) as { principal: { kind: string } }).principal.kind, 'anonymous');
    // A plain header without the JWT proves nothing.
    const plain = await at('GET', '/api/open-artifact.auth.me', { 'x-forwarded-email': 'ceo@example.com' });
    assert.equal(cookieOf(plain), '');
  });

  it('http-authz asks the permission service (signed); its invalidate route forgets the answer; static-groups gives staff a viewer role', async () => {
    const ada = await signIn('ada@example.com');
    const bob = await signIn('bob@example.com');
    const sam = await signIn('sam@staff.example');
    const eve = await signIn('eve@example.com');
    const owner = host.catalog;
    const adaUser = await owner.findUserByEmail('ada@example.com');
    const board = await owner.createArtifact({ type: 'whiteboard', title: 'Plan', ownerUser: adaUser!.id });
    const roleOf = async (who: Record<string, string>): Promise<string | number> => {
      const answer = await at('GET', `/api/open-artifact.artifact?id=${board.id}`, who);
      return answer.status === 200 ? ((JSON.parse(answer.body) as ArtifactView).role ?? 'none') : answer.status;
    };
    assert.equal(await roleOf(ada), 'owner');
    assert.equal(await roleOf(bob), 'editor');
    assert.equal(await roleOf(sam), 'viewer');
    assert.equal(await roleOf(eve), 404);
    const question = perms.seen.find((s) => s.body.includes('bob@example.com'))!;
    const expected = createHmac('sha256', PERMS_SECRET).update(question.body).digest('hex');
    assert.equal(question.headers['x-oa-signature'], `sha256=${expected}`);

    bobRole = 'viewer';
    assert.equal(await roleOf(bob), 'editor', 'the answer is reused (60 s)');
    const body = JSON.stringify({ artifactId: board.id });
    const unsigned = await call(port, 'POST', `${app}/plugins/http-authz/invalidate`, { 'content-type': 'application/json' }, body);
    assert.equal(unsigned.status, 401);
    const signature = createHmac('sha256', PERMS_SECRET).update(body).digest('hex');
    const done = await call(port, 'POST', `${app}/plugins/http-authz/invalidate`, { 'content-type': 'application/json', 'x-oa-signature': `sha256=${signature}` }, body);
    assert.equal(done.status, 200, done.body);
    assert.equal(await roleOf(bob), 'viewer');
  });

  it('webhook-events posts the chosen events (signed); invite-email mails the person invited', async () => {
    const ada = await signIn('ada@example.com');
    const adaUser = await host.catalog.findUserByEmail('ada@example.com');
    const board = await host.catalog.createArtifact({ type: 'whiteboard', title: 'Roadmap', ownerUser: adaUser!.id });
    assert.equal((await at('POST', '/api/open-artifact.artifacts.update', ada, { id: board.id, title: 'Roadmap 2' })).status, 200);
    const shared = await at('POST', '/api/open-artifact.artifact.share', ada, { id: board.id, members: { 'email:zoe@example.com': 'commenter' } });
    assert.equal(shared.status, 200, shared.body);
    await host.plugins!.idle();
    const events = hook.seen.map((s) => JSON.parse(s.body) as { event: string });
    assert.ok(events.some((e) => e.event === 'artifact.changed'), JSON.stringify(events));
    assert.ok(events.some((e) => e.event === 'share.invited'), JSON.stringify(events));
    const posted = hook.seen[0]!;
    assert.equal(posted.headers['x-oa-signature'], `sha256=${createHmac('sha256', 'h'.repeat(32)).update(posted.body).digest('hex')}`);
    const sent = mail.seen.map((s) => ({ auth: s.headers.authorization, ...(JSON.parse(s.body) as { to: string; subject: string; text: string }) }));
    const zoe = sent.find((m) => m.to === 'zoe@example.com');
    assert.ok(zoe, JSON.stringify(sent));
    assert.equal(zoe.auth, 'Bearer mail-key');
    assert.match(zoe.subject, /shared "Roadmap 2" with you/);
    assert.match(zoe.text, new RegExp(`${app}/a/${board.id}`));
    // The plugin's own audit entry.
    const audit = await host.catalog.listAudit({ limit: 50 });
    assert.ok(audit.some((entry) => entry.action === 'invite.sent' && entry.actorId === 'plugin:invite-email'));
  });
});

test('a list that cannot run stops startHost with every problem named', async () => {
  const dir = await tempDir();
  try {
    const { loaded } = await loadSitePlugins({ OA_PLUGINS: JSON.stringify([{ use: join(EXAMPLES, 'header-auth.mjs') }]) }, dir);
    const config = parseConfig({ OA_SIGNING_KEYS: 'e'.repeat(40), OA_OWNER_KEY: 'o'.repeat(30) });
    const env = parseNodeEnv({ OA_DATA_DIR: join(dir, 'data'), OA_PORT: '0', OA_BIND: '127.0.0.1' });
    await assert.rejects(startHost({ config, env, uiDir: dir, log: () => undefined, plugins: loaded, pluginEnv: {} }), (error: unknown) => {
      assert.ok(error instanceof PluginConfigError);
      assert.match(error.message, /header-auth/);
      assert.match(error.message, /anyone could send the header/);
      return true;
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a plugin copied anywhere imports @open-artifact/host-plugin (and /testing) without installing it: .mjs and .ts', async () => {
  // A folder outside the repository, with no node_modules anywhere above it.
  const dir = await tempDir();
  try {
    await writeFile(
      join(dir, 'anywhere.mjs'),
      `import { verifyJwt, timingSafeEqual } from '@open-artifact/host-plugin';\nimport { createPluginHarness } from '@open-artifact/host-plugin/testing';\n` +
        `export default { id: 'anywhere', apiVersion: 1, helpers: { verifyJwt, timingSafeEqual, createPluginHarness }, on: { 'artifact.changed': () => undefined } };\n`,
    );
    await writeFile(
      join(dir, 'typed.ts'),
      `import { verifyJwt, type HostPlugin } from '@open-artifact/host-plugin';\n` +
        `const plugin: HostPlugin & { helpers: { verifyJwt: typeof verifyJwt } } = { id: 'typed', apiVersion: 1, helpers: { verifyJwt }, on: { 'artifact.changed': () => undefined } };\nexport default plugin;\n`,
    );
    const { loaded } = await loadSitePlugins({ OA_PLUGINS: JSON.stringify([{ use: join(dir, 'anywhere.mjs') }, { use: join(dir, 'typed.ts') }]) }, join(dir, 'data'));
    assert.deepEqual(loaded.map((l) => l.loadError), [undefined, undefined]);
    const api = await import('@open-artifact/host-plugin');
    const testing = await import('@open-artifact/host-plugin/testing');
    const [mjs, ts] = loaded.map((l) => (l.plugin as { helpers: Record<string, unknown> }).helpers);
    assert.equal(mjs!.verifyJwt, api.verifyJwt, "the host's own copy");
    assert.equal(mjs!.createPluginHarness, testing.createPluginHarness);
    assert.equal(ts!.verifyJwt, api.verifyJwt);
    // Any other package a plugin imports is still its own to install.
    await writeFile(join(dir, 'other.mjs'), `import 'left-pad-not-installed';\nexport default { id: 'other', apiVersion: 1 };\n`);
    const other = await loadSitePlugins({ OA_PLUGINS: JSON.stringify([{ use: join(dir, 'other.mjs') }]) }, join(dir, 'data'));
    assert.match(other.loaded[0]!.loadError ?? '', /left-pad-not-installed/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
