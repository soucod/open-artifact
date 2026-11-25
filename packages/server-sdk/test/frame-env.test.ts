/**
 * The frame core on an environment of its own, as a hosted site will mount it: no `fs.watch`, the client files and
 * the type handed over as strings (no client folder, no type folder), plain-data requests, and two viewers who are not
 * `local` on one instance at once. Each gets its own identity, a write by one reaches the other's listener through the
 * core's own events, and a restricted page on the inner shell's origin is refused at mount. What each level may do is
 * frame-levels.test.ts and frame-site.test.ts. Also: the core's import graph carries none of the APIs a Worker lacks.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, describe, it } from 'node:test';
import { FrameCore, mountFrameCore, replyBytes } from '../src/frame/core.ts';
import type { FrameEnv, FrameEventsAsk, FrameReply, FrameRequest, FrameViewer } from '../src/frame/env.ts';
import { FrameError, PLAIN_GUARD } from '../src/frame/files.ts';
import type { FrameEvent, FrameSession } from '../src/frame/wire.ts';

const SHELL = 'https://inner.sites.example.test';
const PAGE = 'https://page.sites.example.test';
const TYPE_HTML =
  '<!doctype html><html><head><title>Fake type</title><script>\n// artifact.json\nvar key = "fake";\nvar capabilities = {"db": {}, "user": {}, "room": {}, "comments": {}};\nvar monitoring = {};\n// end\n</script></head><body>FAKE-TYPE-PAGE</body></html>';
const CLIENT: Record<string, string> = {
  'shell.html': '<!doctype html><title>FAKE-SHELL</title>',
  'shell.js': '/* FAKE-SHELL-JS */',
  'runtime.js': '/* FAKE-RUNTIME-JS */',
  'shell.css': '/* FAKE-SHELL-CSS */',
};
const CSP = "default-src 'self'";

const VIEWERS: Record<string, FrameViewer> = {
  alice: { id: 'u_alice', name: 'Alice', email: 'alice@example.test', avatarUrl: null, color: '#785ee8', level: 'admin', guest: false, canComment: true },
  bob: { id: 'u_bob', name: 'Bob', email: null, avatarUrl: null, color: '#dc3c3d', level: 'view', guest: true, canComment: false },
};

const roots: string[] = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

/** A site-like environment: viewers by token, nothing read from disk but the artifact's own storage. */
function fakeEnv(over: Partial<FrameEnv> = {}): FrameEnv & { asked: string[] } {
  const asked: string[] = [];
  const env: FrameEnv & { asked: string[] } = {
    asked,
    id: 'art_fakeenv01',
    title: 'Fake',
    log: () => {},
    origins: { shell: SHELL, shellOrigins: [SHELL], content: PAGE, connectSrc: [`wss://inner.sites.example.test`], frameSrc: PAGE },
    viewer: (req) => {
      const who = VIEWERS[String(req.headers['x-viewer'])];
      if (!who) throw new Error('no viewer');
      return who;
    },
    admit: (req) => req.headers['x-token'] === 'verified',
    reader: () => VIEWERS.alice!,
    pageOrigin: () => PAGE,
    people: () => [],
    withholdIdentity: true,
    type: {
      label: 'fake type',
      fingerprint: () => 'fp-1',
      // `user` with both scopes: the identity assertions below are about who asks, not about what the scopes withhold.
      declaration: () => ({ key: 'fake', capabilities: { db: {}, user: { scopes: ['profile', 'email'] }, room: {}, comments: {} }, monitoring: {} }),
      manifest: () => ({ openArtifact: { flags: {} } }),
      indexHtml: () => TYPE_HTML,
      file: (rel) => {
        asked.push(`type:${rel}`);
        if (rel !== 'artifact-type/app.css') return null;
        const body = Buffer.from('/* FAKE-TYPE-CSS */');
        return { size: body.length, mtimeMs: 1000, body };
      },
    },
    client: {
      file: (name) => {
        asked.push(`client:${name}`);
        const text = CLIENT[name];
        if (text === undefined) return null;
        const body = Buffer.from(text);
        return { size: body.length, mtimeMs: null, body };
      },
    },
    watch: null,
    restricted: true,
    contentSecurityPolicy: CSP,
    page: false,
    guard: PLAIN_GUARD,
    debug: () => false,
    daemon: null,
    agentHook: { thread: async () => ({ status: 'delivered' }) as never, request: async () => ({ status: 'delivered' }) as never },
    ...over,
  };
  return env;
}

function newRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'oa-frame-env-'));
  roots.push(root);
  return root;
}

/** A plain-data request; `body` may be a promise the test settles later. */
function req(who: string | null, method: string, url: string, opts: { body?: unknown; bodyLater?: Promise<unknown>; headers?: Record<string, string> } = {}): FrameRequest {
  const headers: Record<string, string> = { 'x-token': 'verified', origin: SHELL, ...(who ? { 'x-viewer': who } : {}), ...opts.headers };
  if (opts.body !== undefined || opts.bodyLater) headers['content-type'] = 'application/json';
  return {
    method,
    url,
    headers,
    body: async () => Buffer.from(JSON.stringify(opts.bodyLater ? await opts.bodyLater : (opts.body ?? {}))),
  };
}

function reply(r: FrameReply | FrameEventsAsk): FrameReply {
  assert.ok(!('events' in r), 'an answer, not a stream');
  return r as FrameReply;
}

const text = (r: FrameReply): string => Buffer.from(replyBytes(r.body) ?? new Uint8Array()).toString('utf8');
const jsonOf = (r: FrameReply): any => JSON.parse(text(r)); // eslint-disable-line @typescript-eslint/no-explicit-any

async function cap(core: FrameCore, who: string, capName: string, method: string, args: unknown, client = ''): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = reply(await core.request(req(who, 'POST', '/api/frame/cap', { body: { cap: capName, method, args: [args], client } })));
  assert.equal(r.status, 200);
  return jsonOf(r);
}

describe('frame core on a site-like environment', () => {
  it('reports only host-granted origins to pages declaring network', async () => {
    for (const [network, expected] of [[{ origins: ['https://page.example'] }, ['https://allowed.example']], [{ optional: true }, []], [undefined, undefined]] as const) {
      const env = fakeEnv({ allowedNetworkOrigins: ['https://allowed.example'] });
      env.type.declaration = () => ({ key: 'fake', capabilities: { ...(network && { network }) }, monitoring: {} });
      const core = mountFrameCore(newRoot(), env);
      try {
        const session = jsonOf(reply(await core.request(req('alice', 'GET', '/api/frame/session'))));
        assert.deepEqual(session.configs.network?.origins, expected);
        assert.equal(session.grants.includes('network'), !!network);
      } finally {
        core.close();
      }
    }
  });

  it('two viewers on one instance each get their own identity, also with requests interleaved', async () => {
    const core = mountFrameCore(newRoot(), fakeEnv());
    try {
      const [a, b] = await Promise.all([core.request(req('alice', 'GET', '/api/frame/session')), core.request(req('bob', 'GET', '/api/frame/session'))]);
      const sa = jsonOf(reply(a)) as FrameSession;
      const sb = jsonOf(reply(b)) as FrameSession;
      assert.equal(sa.me.id, 'u_alice');
      assert.equal(sa.me.name, 'Alice');
      assert.equal(sa.me.email, 'alice@example.test');
      assert.equal(sa.me.isOwner, false);
      assert.equal(sa.me.canEdit, true, 'admin edits');
      assert.equal(sb.me.id, 'u_bob');
      assert.equal(sb.me.canEdit, false);
      assert.equal(sa.configs.user!.id, 'u_alice');
      assert.equal(sb.configs.user!.id, 'u_bob');
      assert.equal(sa.sandbox !== undefined, true, 'restricted: the page is framed with a sandbox');
      assert.equal(sa.shellOrigin, SHELL);
      assert.equal(sa.contentOrigin, PAGE);

      // Alice's call waits on its body while Bob is answered: the viewer comes with the request, not the instance.
      let release!: (v: unknown) => void;
      const later = new Promise((r) => (release = r));
      const pending = core.request(req('alice', 'POST', '/api/frame/cap', { bodyLater: later }));
      const bobMe = await cap(core, 'bob', 'user', 'me', {});
      assert.equal(bobMe.result.id, 'u_bob');
      release({ cap: 'user', method: 'me', args: [{}] });
      assert.equal(jsonOf(reply(await pending)).result.id, 'u_alice');

      const profiles = await cap(core, 'bob', 'user', 'profiles', { ids: ['u_bob', 'u_alice'] });
      assert.deepEqual(Object.keys(profiles.result), ['u_bob'], 'only oneself');
      assert.equal(profiles.result.u_bob.guest, true);
      const access = await cap(core, 'alice', 'user', 'access', { ids: ['u_alice', 'u_bob'] });
      assert.deepEqual(access.result, { u_alice: 'admin', u_bob: null });
    } finally {
      core.close();
    }
  });

  it('a write by one viewer reaches the other through the core, with no watcher', async () => {
    const root = newRoot();
    const core = mountFrameCore(root, fakeEnv());
    try {
      const seen: Record<string, FrameEvent[]> = { alice: [], bob: [] };
      const ended: string[] = [];
      const open = (who: string, client: string): (() => void) =>
        core.connect(req(who, 'GET', `/api/frame/events?c=${client}`), client, { send: (e) => seen[who]!.push(e), end: () => ended.push(who) });
      const asked = core.request(req('alice', 'GET', '/api/frame/events?c=aliceclient1'));
      assert.deepEqual(await asked, { events: true }, 'the stream is the adapter’s to open');
      assert.throws(() => open('alice', 'bad id'), (e: unknown) => e instanceof FrameError && e.code === 'invalid_request', 'a client id is checked by the core');
      const closeAlice = open('alice', 'aliceclient1');
      open('bob', 'bobclient001');
      assert.equal(seen.alice![0]!.t, 'hello');
      const peers = seen.alice!.filter((e) => e.t === 'peers').at(-1) as Extract<FrameEvent, { t: 'peers' }>;
      assert.deepEqual(
        peers.peers.map((p) => [p.peer, p.by, p.name]),
        [
          ['aliceclient1', 'u_alice', 'Alice'],
          ['bobclient001', 'u_bob', 'Bob'],
        ],
      );

      // Alice (admin) writes; Bob (view) may not, but hears it.
      await cap(core, 'alice', 'db', 'set', { path: 'votes/one', data: { n: 1 } });
      assert.ok(
        seen.bob!.some((e) => e.t === 'db' && e.paths.includes('votes/one')),
        'bob hears alice’s db write',
      );
      assert.deepEqual(JSON.parse(readFileSync(join(root, 'db', 'votes', 'one.json'), 'utf8')), { n: 1 });

      await cap(core, 'alice', 'room', 'emit', { topic: 'hi', data: 1 }, 'aliceclient1');
      const room = seen.bob!.find((e) => e.t === 'room') as Extract<FrameEvent, { t: 'room' }>;
      assert.equal(room.by, 'u_alice');
      assert.equal(room.from, 'aliceclient1');

      // Bob cannot patch Alice's presence by naming her client id: a connection is its viewer's.
      await cap(core, 'bob', 'room', 'presence', { patch: { x: 1 } }, 'aliceclient1');
      const peersNow = (await cap(core, 'alice', 'room', 'peers', {})).result as { peer: string; presence: unknown }[];
      assert.deepEqual(peersNow.find((p) => p.peer === 'aliceclient1')!.presence, {});

      const made = await cap(core, 'alice', 'comments', 'create', { anchor: { x: 1 }, text: 'From Alice' });
      assert.equal(made.result.thread.messages[0].author.name, 'Alice');
      assert.ok(seen.alice!.some((e) => e.t === 'comments'));
      assert.ok(!seen.bob!.some((e) => e.t === 'comments'), 'bob may not comment: he hears nothing of them');

      await cap(core, 'alice', 'artifact', 'publish', { files: { 'notes.txt': { text: 'hello' } } }, 'aliceclient1');
      assert.ok(seen.bob!.some((e) => e.t === 'files' && e.paths.includes('notes.txt')));

      // A write the host makes itself, handed in: no watcher needed.
      writeFileSync(join(root, 'other.txt'), 'host');
      const before = core.brokerGen;
      core.noteChanges(['other.txt']);
      assert.equal(core.brokerGen, before + 1);
      assert.ok(seen.bob!.some((e) => e.t === 'files' && e.paths.includes('other.txt')));

      closeAlice();
      const last = seen.bob!.filter((e) => e.t === 'peers').at(-1) as Extract<FrameEvent, { t: 'peers' }>;
      assert.deepEqual(
        last.peers.map((p) => p.by),
        ['u_bob'],
      );
    } finally {
      core.close();
    }
  });

  it('serves the client files and the type from the environment, never from a folder', async () => {
    const env = fakeEnv();
    const core = mountFrameCore(newRoot(), env);
    try {
      const shell = reply(await core.request(req('alice', 'GET', '/')));
      assert.equal(shell.status, 200);
      assert.match(text(shell), /FAKE-SHELL/);
      const policy = String(shell.headers['Content-Security-Policy']);
      assert.match(policy, /connect-src 'self' wss:\/\/inner\.sites\.example\.test/);
      assert.match(policy, new RegExp(`frame-src ${PAGE.replace(/\./g, '\\.')}`));
      assert.match(text(reply(await core.request(req('alice', 'GET', '/shell.js')))), /FAKE-SHELL-JS/);
      assert.equal(reply(await core.request(req('alice', 'GET', '/comments.js'))).status, 404, 'the environment has none');

      const runtime = await core.contentRequest(req(null, 'GET', '/_runtime/open-artifact-frame.js', { headers: { origin: PAGE } }));
      assert.match(text(runtime), /FAKE-RUNTIME-JS/);
      assert.equal(runtime.headers['Content-Security-Policy'], CSP, 'the page origin answers with its policy');
      const index = await core.contentRequest(req(null, 'GET', `/_f/${core.ver}/`, { headers: { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'cross-site', referer: `${SHELL}/` } }));
      assert.equal(index.status, 200);
      assert.match(text(index), /FAKE-TYPE-PAGE/);
      assert.match(text(index), /window\.__OPEN_ARTIFACT_FRAME=/);
      assert.equal(index.headers['Content-Security-Policy'], CSP);
      const css = await core.contentRequest(req(null, 'GET', `/_f/${core.ver}/artifact-type/app.css`));
      assert.match(text(css), /FAKE-TYPE-CSS/);
      assert.equal((await core.contentRequest(req(null, 'GET', `/_f/${core.ver}/artifact-type/missing.css`))).status, 404);
      assert.deepEqual(env.asked.sort(), ['client:comments.js', 'client:runtime.js', 'client:shell.html', 'client:shell.js', 'type:artifact-type/app.css', 'type:artifact-type/missing.css']);

      assert.equal(reply(await core.request(req('alice', 'GET', '/', { headers: { 'x-token': 'forged' } }))).status, 403, 'not admitted');
      assert.equal(reply(await core.request(req('alice', 'GET', '/api/frame/session', { headers: { origin: PAGE } }))).status, 403, 'not the inner shell');
    } finally {
      core.close();
    }
  });

  it('refuses to mount a restricted page on an origin the inner shell uses', () => {
    const same = (shellOrigins: string[], content: string, restricted: boolean): unknown => {
      try {
        mountFrameCore(newRoot(), fakeEnv({ restricted, origins: { shell: SHELL, shellOrigins, content, connectSrc: [], frameSrc: content } })).close();
        return null;
      } catch (error) {
        return error;
      }
    };
    const refused = same([SHELL], SHELL, true);
    assert.ok(refused instanceof FrameError);
    assert.equal(refused.code, 'same_origin');
    assert.match(refused.message, /origin of its own/);
    assert.equal((same([SHELL, PAGE], `${PAGE}/`, true) as FrameError)?.code, 'same_origin', 'any origin the shell is loaded from');
    assert.equal(same([SHELL], PAGE, true), null, 'distinct origins mount');
    assert.equal(same([SHELL], SHELL, false), null, 'an unrestricted page has no sandbox to break');
  });
});

describe('the frame core’s import graph', () => {
  it('reaches no API a Worker lacks', () => {
    const src = resolve(import.meta.dirname, '..', 'src');
    const forbidden = [
      /\bfrom ['"]node:(http|https|net|os|module|url|vm|child_process|worker_threads)['"]/,
      /\bimport\.meta\b/,
      /\bcreateReadStream\b/,
      /(?<![\w.])watch\(/,
      /\buserInfo\b/,
      /\bstripTypeScriptTypes\b/,
      /\bfileURLToPath\b/,
      /\binstanceof ServerResponse\b/,
      /\bprocess\.(env|cwd)\b/,
    ];
    const seen = new Set<string>();
    const visit = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      const code = readFileSync(file, 'utf8');
      // Value imports only: `import type` and `export type` are erased.
      for (const m of code.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?from\s+['"](\.[^'"]+)['"]/gms)) visit(resolve(dirname(file), m[1]!));
      const body = code.replace(/^\s*(?:\/\/|\*|\/\*).*$/gm, '');
      for (const re of forbidden) assert.ok(!re.test(body), `${file.slice(src.length + 1)} uses ${re}`);
    };
    visit(join(src, 'frame', 'core.ts'));
    const files = [...seen].map((f) => f.slice(src.length + 1)).sort();
    assert.ok(!files.includes('frame/local.ts'), 'the local environment stays out');
    assert.ok(!files.includes('serve.ts') && !files.includes('daemon.ts'), 'serve() and the Type API client are types only');
    assert.deepEqual(files, ['frame/access.ts', 'frame/comments.ts', 'frame/core.ts', 'frame/db.ts', 'frame/files.ts', 'frame/wire.ts']);
  });
});
