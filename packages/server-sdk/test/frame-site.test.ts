/**
 * Site mode: one frame core, as a hosted site mounts it, serving four people of different levels at once (the owner,
 * an editor, a member at `interact`, a viewer at `view` who may not comment), plus the page's read-only token. What
 * each may do is checked on the server, trusting nothing the page or the inner shell says: a low level cannot write,
 * does not get (by get, query or a listener's event) rows it may not read, cannot publish or upload, learns no more of
 * other people than the declared scopes allow, cannot send as another client, cannot comment without `canComment`,
 * and cannot reach the owner's agent; the read-only token opens none of the inner shell's routes and no db data.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';
import { FrameCore, mountFrameCore, replyBytes } from '../src/frame/core.ts';
import type { CapabilityDecl } from '../src/frame/declaration.ts';
import type { FrameEnv, FrameEventsAsk, FramePerson, FrameReply, FrameRequest, FrameViewer } from '../src/frame/env.ts';
import { FrameError, PLAIN_GUARD } from '../src/frame/files.ts';
import type { FrameEvent, FrameSession } from '../src/frame/wire.ts';

const SHELL = 'https://inner.site.example.test';
const PAGE = 'https://page.site.example.test';

const VIEWERS: Record<string, FrameViewer> = {
  owner: { id: 'u_owner', name: 'Olga', email: 'olga@example.test', avatarUrl: null, color: '#785ee8', level: 'owner', guest: false, canComment: true },
  editor: { id: 'u_editor', name: 'Edda', email: 'edda@example.test', avatarUrl: 'https://a.example.test/e.png', color: '#dc3c3d', level: 'admin', guest: false, canComment: true },
  member: { id: 'u_member', name: 'Mona', email: 'mona@example.test', avatarUrl: null, color: '#019c7f', level: 'interact', guest: false, canComment: true },
  viewer: { id: 'u_viewer', name: 'Vic', email: 'vic@example.test', avatarUrl: null, color: '#fbb315', level: 'view', guest: false, canComment: false },
};
/** Who can reach the artifact (the site's list). Not `u_stranger`. */
const PEOPLE: FramePerson[] = Object.values(VIEWERS).map((v) => ({ id: v.id, name: v.name, email: v.email, avatarUrl: v.avatarUrl, level: v.level }));
/** The page's read-only tokens, one per viewer, carried as the page origin's host label (`<token>.page.…`). */
const READ_TOKENS: Record<string, string> = { 'rt-owner': 'owner', 'rt-editor': 'editor', 'rt-member': 'member', 'rt-viewer': 'viewer' };
const pageHost = (token: string): string => `${token}.page.site.example.test`;
/** The read token in a page-origin request's Host. */
const tokenOfHost = (host: string | undefined): string | undefined => /^([a-z0-9-]+)\.page\.site\.example\.test$/.exec(String(host))?.[1];

const DECLARATION: Record<string, CapabilityDecl> = {
  db: { rules: [{ path: 'staff', read: 'admin', write: 'admin' }] },
  user: { scopes: ['profile'] },
  room: { topics: { react: 'interact' } },
  comments: {},
  assets: {},
};

const roots: string[] = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

interface Site {
  core: FrameCore;
  agent: string[];
}

/** `page`: page mode, the artifact's own index.html, with these capabilities in its `.artifact.json`. */
function mount(capabilities: Record<string, CapabilityDecl> = DECLARATION, page?: Record<string, unknown>): Site {
  const agent: string[] = [];
  const env: FrameEnv = {
    id: 'art_site000001',
    title: 'Site',
    log: () => {},
    origins: { shell: SHELL, shellOrigins: [SHELL], content: PAGE, connectSrc: [], frameSrc: 'https://*.page.site.example.test' },
    viewer: (req) => {
      // The page's read-only token, brought to the inner shell's origin (`x-read` here): the site places it, and says so.
      const read = READ_TOKENS[String(req.headers['x-read'])];
      if (read) return { ...VIEWERS[read]!, readOnly: true };
      const who = VIEWERS[String(req.headers['x-viewer'])];
      if (!who) throw new Error('no viewer');
      return who;
    },
    reader: (req) => {
      const who = READ_TOKENS[tokenOfHost(req.headers.host) ?? ''];
      return who ? VIEWERS[who]! : null;
    },
    pageOrigin: (v) => `https://${pageHost(Object.entries(READ_TOKENS).find(([, w]) => VIEWERS[w]!.id === v.id)![0])}`,
    people: async () => PEOPLE,
    withholdIdentity: true,
    admit: (req) => req.headers['x-token'] === 'verified' || !!req.headers['x-read'],
    type: {
      label: 'site type',
      fingerprint: () => 'fp',
      declaration: () => ({ key: 'site', capabilities, monitoring: {} }),
      manifest: () => ({}),
      indexHtml: () => '<!doctype html><html><head><title>site</title></head><body>SITE-PAGE</body></html>',
      file: () => null,
    },
    client: {
      file: (name) => {
        const body = Buffer.from(`/* ${name} */`);
        return { size: body.length, mtimeMs: null, body };
      },
    },
    watch: null,
    restricted: true,
    contentSecurityPolicy: "default-src 'self'",
    page: !!page,
    guard: PLAIN_GUARD,
    debug: () => false,
    daemon: { available: true, touch: async () => ({}) as never, presence: async () => ({ canSend: true }) as never },
    agentHook: {
      thread: async () => {
        agent.push('thread');
        return { status: 'delivered' } as never;
      },
      request: async (r: { text: string }) => {
        agent.push(`request:${r.text}`);
        return { status: 'delivered' } as never;
      },
    },
  };
  const root = mkdtempSync(join(tmpdir(), 'oa-frame-site-'));
  roots.push(root);
  if (page) {
    writeFileSync(join(root, '.artifact.json'), JSON.stringify({ type: 'page', id: env.id, capabilities: page }));
    writeFileSync(join(root, 'index.html'), '<!doctype html><title>p</title>');
  }
  return { core: mountFrameCore(root, env), agent };
}

function req(who: string, method: string, url: string, opts: { body?: unknown; raw?: () => Promise<Uint8Array>; headers?: Record<string, string> } = {}): FrameRequest {
  const headers: Record<string, string> = { 'x-token': 'verified', origin: SHELL, 'x-viewer': who, ...opts.headers };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return { method, url, headers, body: opts.raw ?? (async () => Buffer.from(JSON.stringify(opts.body ?? {}))) };
}

const reply = (r: FrameReply | FrameEventsAsk): FrameReply => {
  assert.ok(!('events' in r), 'an answer, not a stream');
  return r as FrameReply;
};
const text = (r: FrameReply): string => Buffer.from(replyBytes(r.body) ?? new Uint8Array()).toString('utf8');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const jsonOf = (r: FrameReply): any => JSON.parse(text(r));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function cap(core: FrameCore, who: string, capName: string, method: string, args: unknown, client = ''): Promise<any> {
  const r = reply(await core.request(req(who, 'POST', '/api/frame/cap', { body: { cap: capName, method, args: [args], client } })));
  assert.equal(r.status, 200);
  return jsonOf(r);
}

/** Opens a connection per person; what each one heard. */
function listen(core: FrameCore): Record<string, FrameEvent[]> {
  const heard: Record<string, FrameEvent[]> = {};
  for (const who of Object.keys(VIEWERS)) {
    heard[who] = [];
    core.connect(req(who, 'GET', `/api/frame/events?c=${who}client01`), `${who}client01`, { send: (e) => heard[who]!.push(e), end: () => {} });
  }
  return heard;
}
const dbPaths = (events: FrameEvent[]): string[] => events.flatMap((e) => (e.t === 'db' ? e.paths : []));

describe('site mode: several people of different levels on one instance', () => {
  it('a low level cannot write, and gets no row it may not read (get, query, listener)', async () => {
    const { core } = mount();
    try {
      const heard = listen(core);
      assert.equal((await cap(core, 'viewer', 'db', 'set', { path: 'notes/a', data: { x: 1 } })).error.code, 'invalid_argument', 'view reads only');
      assert.equal((await cap(core, 'viewer', 'db', 'add', { path: 'notes', data: { x: 1 } })).error.code, 'invalid_argument');
      assert.deepEqual(await cap(core, 'member', 'db', 'set', { path: 'notes/a', data: { x: 1 } }), { result: {} }, 'interact writes shared data');
      assert.ok(dbPaths(heard.viewer!).includes('notes/a'), 'everyone hears a shared write');

      // A member's own subtree: nobody else gets it, the owner included.
      for (const k of Object.keys(heard)) heard[k]!.length = 0;
      assert.deepEqual(await cap(core, 'member', 'db', 'set', { path: 'data/users/u_member/prefs', data: { theme: 'dark' } }), { result: {} });
      assert.deepEqual(dbPaths(heard.member!), ['data/users/u_member/prefs']);
      for (const who of ['owner', 'editor', 'viewer']) {
        assert.deepEqual(dbPaths(heard[who]!), [], `${who} hears nothing of it`);
        assert.deepEqual((await cap(core, who, 'db', 'get', { path: 'data/users/u_member/prefs' })).result, { exists: false }, `${who}: get`);
        assert.deepEqual((await cap(core, who, 'db', 'query', { path: 'data/users/u_member' })).result.docs, [], `${who}: query`);
        assert.equal((await cap(core, who, 'db', 'set', { path: 'data/users/u_member/prefs', data: {} })).error.code, 'invalid_argument', `${who}: write`);
      }
      assert.equal((await cap(core, 'member', 'db', 'get', { path: 'data/users/u_member/prefs' })).result.data.theme, 'dark');

      // A declared rule: staff/ is admin-only to read and write.
      for (const k of Object.keys(heard)) heard[k]!.length = 0;
      assert.deepEqual(await cap(core, 'editor', 'db', 'set', { path: 'staff/plan', data: { secret: 1 } }), { result: {} });
      assert.deepEqual(await cap(core, 'editor', 'db', 'set', { path: 'staff/memo', data: { secret: 2 } }), { result: {} });
      assert.ok(dbPaths(heard.owner!).includes('staff/plan'));
      for (const who of ['member', 'viewer']) {
        assert.deepEqual(dbPaths(heard[who]!), [], `${who} hears nothing of staff/`);
        assert.deepEqual((await cap(core, who, 'db', 'get', { path: 'staff/plan' })).result, { exists: false });
        assert.deepEqual((await cap(core, who, 'db', 'query', { path: 'staff' })).result.docs, []);
      }
      assert.equal((await cap(core, 'owner', 'db', 'query', { path: 'staff', spec: { limit: 1 } })).result.docs.length, 1, 'the limit counts readable rows');

      // A lease is the viewer's: a page cannot take over another's by naming its holder, and is not told who holds it.
      const got = await cap(core, 'member', 'db', 'acquire', { path: 'notes/lock', options: { holder: 'tab-1', ttlMs: 60_000 } });
      assert.equal(got.result.acquired, true);
      assert.equal(got.result.holder, 'tab-1', 'its own string, echoed');
      const busy = await cap(core, 'editor', 'db', 'acquire', { path: 'notes/lock', options: { holder: 'tab-1', ttlMs: 60_000 } });
      assert.equal(busy.result.acquired, false, 'the same string from another viewer is another holder');
      assert.equal(busy.result.holder, undefined, 'and never learns who holds it');
      const ownBusy = await cap(core, 'member', 'db', 'acquire', { path: 'notes/lock', options: { holder: 'tab-2', ttlMs: 60_000 } });
      assert.deepEqual([ownBusy.result.acquired, ownBusy.result.holder], [false, 'tab-1'], 'its own other tab, it is told');
      assert.deepEqual((await cap(core, 'editor', 'db', 'release', { path: 'notes/lock', holder: 'tab-1' })).result, { released: false });
      assert.equal((await cap(core, 'viewer', 'db', 'acquire', { path: 'notes/lock2', options: { holder: 'x' } })).error.code, 'invalid_argument', 'view takes no lease');
      assert.deepEqual((await cap(core, 'member', 'db', 'release', { path: 'notes/lock', holder: 'tab-1' })).result, { released: true });
    } finally {
      core.close();
    }
  });

  it('only editors publish; below admin, sync, publish and edit answer not_writer', async () => {
    const { core } = mount();
    try {
      for (const who of ['viewer', 'member']) {
        assert.equal((await cap(core, who, 'artifact', 'publish', { files: { 'a.txt': { text: 'x' } } })).error.code, 'not_writer', who);
        assert.equal((await cap(core, who, 'artifact', 'sync', {})).error.code, 'not_writer', who);
        assert.equal((await cap(core, who, 'artifact', 'edit', {})).error.code, 'not_writer', who);
        assert.equal(jsonOf(reply(await core.request(req(who, 'POST', '/api/frame/title', { body: { title: 'Mine now' } })))).applied, false, `${who}: title`);
      }
      assert.equal((await cap(core, 'editor', 'artifact', 'publish', { files: { 'a.txt': { text: 'x' } } })).result.changed.length, 1);
      const userCfg = (jsonOf(reply(await core.request(req('member', 'GET', '/api/frame/session')))) as FrameSession).configs.user!;
      assert.deepEqual(userCfg.can, ['data.write'], 'a member is told it writes shared data, nothing else');
      assert.equal((jsonOf(reply(await core.request(req('owner', 'GET', '/api/frame/session')))) as FrameSession).configs.user!.can, undefined, 'the owner holds all');
    } finally {
      core.close();
    }
  });

  it('publish: false — on a site the page writes itself for nobody, the owner included; this computer as before', async () => {
    const { core } = mount({ ...DECLARATION, artifact: { publish: false } });
    try {
      for (const who of ['owner', 'editor', 'member']) {
        assert.equal((await cap(core, who, 'artifact', 'publish', { files: { 'a.txt': { text: 'x' } } })).error.code, 'not_granted', `${who}: publish`);
        assert.equal((await cap(core, who, 'artifact', 'sync', {})).error.code, 'not_granted', `${who}: sync`);
        assert.equal((await cap(core, who, 'artifact', 'edit', {})).error.code, 'not_granted', `${who}: edit`);
      }
      assert.equal((await cap(core, 'member', 'artifact', 'metadata', { refs: ['self'] })).error, undefined, 'metadata works the same');
      const s = jsonOf(reply(await core.request(req('owner', 'GET', '/api/frame/session')))) as FrameSession;
      assert.equal(s.configs.artifact!.publish, false, 'the page is told');
      assert.equal(((jsonOf(reply(await core.request(req('editor', 'GET', '/api/frame/session')))) as FrameSession).configs.user!.can as string[]).includes('files.write'), false);
      (core as unknown as { env: FrameEnv }).env.withholdIdentity = false;
      assert.equal((await cap(core, 'owner', 'artifact', 'publish', { files: { 'a.txt': { text: 'x' } } })).result.changed.length, 1, 'this computer: as before');
    } finally {
      core.close();
    }
  });

  it('uploads: admin by default, checked before the body is read; upload: "interact" lets members list and delete only their own', async () => {
    const { core } = mount();
    try {
      let read = 0;
      const raw = async (): Promise<Uint8Array> => {
        read++;
        return Buffer.from('GIF89a');
      };
      for (const who of ['viewer', 'member']) {
        const r = jsonOf(reply(await core.request(req(who, 'POST', '/api/frame/upload?type=image/gif', { raw }))));
        assert.equal(r.error.code, 'not_granted', who);
        assert.equal((await cap(core, who, 'assets', 'list', {})).error.code, 'not_granted');
      }
      assert.equal(read, 0, 'no body was read for a refused upload');
      const up = jsonOf(reply(await core.request(req('editor', 'POST', '/api/frame/upload?type=image/gif', { raw }))));
      assert.match(up.result.id, /^[0-9a-f]{32}$/);
      assert.equal((jsonOf(reply(await core.request(req('member', 'GET', '/api/frame/session')))) as FrameSession).grants.includes('assets'), false);
    } finally {
      core.close();
    }
    const open = mount({ ...DECLARATION, assets: { upload: 'interact' } });
    try {
      const upload = async (who: string, body: string): Promise<string> =>
        jsonOf(reply(await open.core.request(req(who, 'POST', '/api/frame/upload?type=image/png', { raw: async () => Buffer.from(body) })))).result?.id;
      assert.equal(jsonOf(reply(await open.core.request(req('viewer', 'POST', '/api/frame/upload?type=image/png', { raw: async () => Buffer.from('v') })))).error.code, 'not_granted');
      const editors = await upload('editor', 'editor-file');
      const mine = await upload('member', 'member-file');
      const listed = (await cap(open.core, 'member', 'assets', 'list', {})).result;
      assert.deepEqual(
        listed.assets.map((a: { id: string }) => a.id),
        [mine],
        'a member lists only its own',
      );
      assert.equal(listed.usage.files, 2, 'the usage counts the whole artifact');
      assert.equal((await cap(open.core, 'member', 'assets', 'delete', { ref: editors })).error.code, 'not_uploader');
      assert.equal((await cap(open.core, 'editor', 'assets', 'list', {})).result.assets.length, 2, 'an editor lists all');
      assert.deepEqual((await cap(open.core, 'member', 'assets', 'delete', { ref: mine })).result, { deleted: true });
      assert.equal(JSON.parse(text(reply(await open.core.request(req('member', 'GET', '/api/frame/session'))))).configs.user.can.includes('assets.write'), false);
    } finally {
      open.core.close();
    }
  });

  it('uploads: the same bytes from two people are one asset both claim; each deletes only its claim', async () => {
    VIEWERS.member2 = { ...VIEWERS.member!, id: 'u_member2', name: 'Moe', email: 'moe@example.test' };
    const { core } = mount({ ...DECLARATION, assets: { upload: 'interact' } });
    try {
      const upload = async (who: string, body: string): Promise<string> =>
        jsonOf(reply(await core.request(req(who, 'POST', '/api/frame/upload?type=image/png', { raw: async () => Buffer.from(body) })))).result?.id;
      const ids = async (who: string): Promise<string[]> => (await cap(core, who, 'assets', 'list', {})).result.assets.map((a: { id: string }) => a.id);
      const a = await upload('member', 'same-bytes');
      assert.equal(await upload('member2', 'same-bytes'), a, 'one asset');
      assert.deepEqual([await ids('member'), await ids('member2')], [[a], [a]], 'both list it as theirs');
      assert.deepEqual((await cap(core, 'member2', 'assets', 'delete', { ref: a })).result, { deleted: true });
      assert.deepEqual([await ids('member'), await ids('member2')], [[a], []], 'only the claim went');
      assert.equal(reply(await core.request(req('viewer', 'GET', `/_blob/${a}`))).status, 200, 'the bytes stay while a claim is left');
      assert.equal((await cap(core, 'member2', 'assets', 'delete', { ref: a })).error.code, 'not_uploader', 'no claim, no delete');
      assert.deepEqual((await cap(core, 'member', 'assets', 'delete', { ref: a })).result, { deleted: true });
      assert.equal(reply(await core.request(req('viewer', 'GET', `/_blob/${a}`))).status, 404, 'the last claim takes the bytes');

      // An editor's delete removes the asset outright, whoever claims it.
      const b = await upload('member', 'shared');
      await upload('member2', 'shared');
      assert.deepEqual((await cap(core, 'editor', 'assets', 'delete', { ref: b })).result, { deleted: true });
      assert.deepEqual([await ids('member'), await ids('member2'), await ids('editor')], [[], [], []]);

      // Older metadata: one `uploader`, or none (the owner's), reads as before.
      const dir = (core as unknown as { blobs: { dir: string } }).blobs.dir;
      const legacy = await upload('editor', 'legacy-one');
      const none = await upload('editor', 'legacy-none');
      const meta = (id: string): Record<string, unknown> => JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf8'));
      const { uploaders: _u1, ...m1 } = meta(legacy);
      writeFileSync(join(dir, `${legacy}.json`), JSON.stringify({ ...m1, uploader: 'u_member' }));
      const { uploaders: _u2, ...m2 } = meta(none);
      writeFileSync(join(dir, `${none}.json`), JSON.stringify(m2));
      assert.deepEqual(await ids('member'), [legacy], 'a single `uploader` is a claim');
      assert.equal((await cap(core, 'member', 'assets', 'delete', { ref: none })).error.code, 'not_uploader', 'none: the owner’s');
      assert.deepEqual((await cap(core, 'owner', 'assets', 'list', {})).result.assets.map((x: { id: string }) => x.id).sort(), [legacy, none].sort());
      assert.equal(await upload('member2', 'legacy-one'), legacy);
      assert.deepEqual(meta(legacy).uploaders, ['u_member', 'u_member2'], 'a second claim converts it');
      assert.equal(meta(legacy).uploader, undefined);
    } finally {
      core.close();
      delete VIEWERS.member2;
    }
  });

  it('user: only people who can reach the artifact, and only the fields the scopes allow', async () => {
    const { core } = mount();
    try {
      const profiles = (await cap(core, 'viewer', 'user', 'profiles', { ids: ['u_editor', 'u_stranger', 'u_viewer'] })).result;
      assert.deepEqual(Object.keys(profiles).sort(), ['u_editor', 'u_viewer'], 'nobody outside the artifact');
      assert.equal(profiles.u_editor.name, 'Edda', 'names under "profile"');
      assert.equal(profiles.u_editor.email, null, 'no email without "email"');
      assert.equal(profiles.u_viewer.isMe, true);
      assert.equal((await cap(core, 'editor', 'user', 'email', {})).result, null, 'not even one’s own');
      const session = jsonOf(reply(await core.request(req('editor', 'GET', '/api/frame/session')))) as FrameSession;
      assert.equal(session.me.email, null, 'what the inner shell is handed follows the scopes too');
      assert.equal(session.me.name, 'Edda');
      assert.deepEqual((await cap(core, 'viewer', 'user', 'search', { q: 'ed' })).result, [], 'a viewer who can neither edit nor comment searches nobody');
      const hits = (await cap(core, 'member', 'user', 'search', { q: 'ed' })).result as { id: string; email: unknown }[];
      assert.deepEqual(
        hits.map((h) => [h.id, h.email]),
        [['u_editor', null]],
      );
      assert.deepEqual((await cap(core, 'member', 'user', 'search', { q: 'edda@' })).result, [], 'no search by email without "email"');
      assert.deepEqual((await cap(core, 'member', 'user', 'access', { ids: ['u_member', 'u_editor'] })).result, { u_member: 'interact', u_editor: null });
      assert.deepEqual((await cap(core, 'editor', 'user', 'access', { ids: ['u_member', 'u_stranger'] })).result, { u_member: 'interact', u_stranger: null });
    } finally {
      core.close();
    }
    const bare = mount({ ...DECLARATION, user: {} });
    try {
      const me = (await cap(bare.core, 'editor', 'user', 'me', {})).result;
      assert.deepEqual([me.id, me.name, me.avatarUrl], ['u_editor', '', null], 'user: {} gives the id, no name');
      const peersNow = (await cap(bare.core, 'editor', 'room', 'peers', {})).result;
      assert.deepEqual(peersNow, []);
      const heard = listen(bare.core);
      const peers = heard.viewer!.filter((e) => e.t === 'peers').at(-1) as Extract<FrameEvent, { t: 'peers' }>;
      assert.ok(peers.peers.every((p) => p.name === ''), 'no names in the room without "profile"');
    } finally {
      bare.core.close();
    }
    const none = mount({ db: {}, room: {} });
    try {
      const heard = listen(none.core);
      const peers = heard.viewer!.filter((e) => e.t === 'peers').at(-1) as Extract<FrameEvent, { t: 'peers' }>;
      assert.ok(peers.peers.every((p) => p.by === null), 'no ids in the room without `user`');
    } finally {
      none.core.close();
    }
  });

  it('room: the sender is the connection, never the body; topics are admin-only unless opened', async () => {
    const { core } = mount();
    try {
      const heard = listen(core);
      assert.equal((await cap(core, 'viewer', 'room', 'emit', { topic: 'react', data: 1 }, 'viewerclient01')).error.code, 'not_permitted', 'react is interact');
      assert.equal((await cap(core, 'member', 'room', 'emit', { topic: 'cursor', data: 1 }, 'memberclient01')).error.code, 'not_permitted', 'cursor is admin-only');
      assert.equal((await cap(core, 'member', 'room', 'emit', { topic: 'lobby2/react', data: 1 }, 'memberclient01')).error, undefined, 'a named room’s topic is the topic’s');

      for (const k of Object.keys(heard)) heard[k]!.length = 0;
      // The member names the editor's client id: nothing is sent as the editor.
      await cap(core, 'member', 'room', 'emit', { topic: 'react', data: 'forged' }, 'editorclient01');
      assert.ok(!heard.owner!.some((e) => e.t === 'room'), 'a client id that is not the viewer’s own sends nothing');
      await cap(core, 'member', 'room', 'emit', { topic: 'react', data: 'mine' }, 'memberclient01');
      const got = heard.viewer!.find((e) => e.t === 'room') as Extract<FrameEvent, { t: 'room' }>;
      assert.deepEqual([got.from, got.by, got.data], ['memberclient01', 'u_member', 'mine'], 'everyone hears it, from the real sender');

      // The publish echo marks only the publisher's own connection.
      for (const k of Object.keys(heard)) heard[k]!.length = 0;
      await cap(core, 'editor', 'artifact', 'publish', { files: { 'b.txt': { text: 'y' } } }, 'memberclient01');
      const files = heard.member!.find((e) => e.t === 'files') as Extract<FrameEvent, { t: 'files' }>;
      assert.equal(files.from, undefined, 'the editor cannot make the member’s page skip its reload');
      // Presence of another's client is not patched.
      await cap(core, 'viewer', 'room', 'presence', { patch: { x: 1 } }, 'editorclient01');
      const peers = (await cap(core, 'owner', 'room', 'peers', {})).result as { peer: string; presence: unknown }[];
      assert.deepEqual(peers.find((p) => p.peer === 'editorclient01')!.presence, {});
    } finally {
      core.close();
    }
  });

  it('comments: only with canComment, authored as the viewer; moderation is the starter’s or an editor’s', async () => {
    const { core } = mount();
    try {
      const heard = listen(core);
      assert.equal(heard.viewer!.find((e) => e.t === 'hello')?.t, 'hello');
      assert.equal((heard.viewer!.find((e) => e.t === 'hello') as Extract<FrameEvent, { t: 'hello' }>).count, 0);
      assert.equal((await cap(core, 'viewer', 'comments', 'create', { anchor: {}, text: 'hi' })).error.code, 'not_granted');
      assert.equal((await cap(core, 'viewer', 'comments', 'list', {})).error.code, 'not_granted');
      const session = jsonOf(reply(await core.request(req('viewer', 'GET', '/api/frame/session')))) as FrameSession;
      assert.equal(session.comments.available, false);
      assert.equal(session.grants.includes('comments'), false);

      const byEditor = (await cap(core, 'editor', 'comments', 'create', { anchor: {}, text: 'from the editor', author: { name: 'Olga' } })).result;
      assert.equal(byEditor.thread.messages[0].author.name, 'Edda', 'the author is the viewer, not the body');
      assert.equal(byEditor.thread.messages[0].author.principal, 'u_editor');
      assert.ok(!heard.viewer!.some((e) => e.t === 'comments'), 'a viewer who may not comment hears nothing of them');
      assert.ok(heard.member!.some((e) => e.t === 'comments'));
      assert.equal((await cap(core, 'member', 'comments', 'resolve', { threadId: byEditor.threadId })).error.code, 'forbidden');
      assert.equal((await cap(core, 'member', 'comments', 'delete', { threadId: byEditor.threadId })).error.code, 'forbidden');
      const own = (await cap(core, 'member', 'comments', 'create', { anchor: {}, text: 'mine' })).result;
      assert.equal((await cap(core, 'member', 'comments', 'resolve', { threadId: own.threadId })).result.thread.resolved, true);
      assert.equal((await cap(core, 'editor', 'comments', 'resolve', { threadId: own.threadId, resolved: false })).result.thread.resolved, false, 'an editor moderates');
    } finally {
      core.close();
    }
  });

  it('comments: what reaches the page names authors only as the scopes allow; the shell’s own UI keeps names', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const authors = (r: any): any[] => r.result.threads.flatMap((t: any) => t.messages.map((m: any) => m.author));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const asShell = async (c: FrameCore, who: string, method: string, args: unknown): Promise<any> =>
      jsonOf(reply(await c.request(req(who, 'POST', '/api/frame/cap', { body: { cap: 'comments', method, args: [args], client: '', shell: true } }))));
    for (const [label, user, named, vouched] of [
      ['user: {} (no profile)', {}, false, true],
      ['no user', undefined, false, false],
      ['user: profile', { scopes: ['profile'] }, true, true],
    ] as const) {
      const { user: _drop, ...rest } = DECLARATION;
      const { core } = mount(user === undefined ? rest : { ...rest, user });
      try {
        const t = (await cap(core, 'editor', 'comments', 'create', { anchor: {}, text: 'by edda' })).result;
        await cap(core, 'member', 'comments', 'reply', { threadId: t.threadId, text: 'by mona' });
        const [edda, mona] = authors(await cap(core, 'member', 'comments', 'list', {}));
        assert.equal(edda.name, named ? 'Edda' : '', `${label}: name`);
        assert.equal(edda.principal, vouched ? 'u_editor' : undefined, `${label}: principal`);
        assert.equal(edda.mine, undefined, label);
        assert.equal(mona.mine, true, `${label}: the viewer's own stays recognisable`);
        assert.equal(mona.name, named ? 'Mona' : '', label);
        const created = (await cap(core, 'member', 'comments', 'create', { anchor: {}, text: 'x' })).result;
        assert.equal(created.thread.messages[0].mine, undefined, 'the message itself carries no flag');
        assert.equal(created.thread.messages[0].author.mine, true);
        assert.equal(created.thread.messages[0].author.name, named ? 'Mona' : '', `${label}: create's answer too`);
        // The shell's own comments UI: the names, whatever the scopes.
        const full = authors(await asShell(core, 'member', 'list', {}));
        assert.deepEqual([full[0].name, full[0].principal], ['Edda', 'u_editor'], `${label}: the shell keeps names`);
        (core as unknown as { env: FrameEnv }).env.withholdIdentity = false;
        assert.equal(authors(await cap(core, 'member', 'comments', 'list', {}))[0].name, 'Edda', `${label}: this computer as before`);
      } finally {
        core.close();
      }
    }
  });

  it('the agent: only an editor who may comment reaches it', async () => {
    const { core, agent } = mount();
    try {
      assert.equal((await cap(core, 'viewer', 'comments', 'sendToAgent', { anchor: {}, text: 'do it' })).error.code, 'not_granted');
      assert.equal((await cap(core, 'member', 'comments', 'sendToAgent', { anchor: {}, text: 'do it' })).error.code, 'forbidden');
      assert.equal((await cap(core, 'member', 'comments', 'canSendToAgent', {})).result, 'writers_only');
      for (const who of ['viewer', 'member']) {
        assert.equal((await cap(core, who, 'room', 'sendToAgentSession', { data: { do: 'it' } })).error.code, 'not_permitted', who);
        assert.equal((await cap(core, who, 'room', 'canSendToAgentSession', {})).result, false);
        const asked = reply(await core.request(req(who, 'POST', '/api/frame/agent', { body: { text: 'do it' } })));
        assert.equal(asked.status, 403);
        assert.equal(jsonOf(asked).error.code, 'forbidden');
        assert.deepEqual(jsonOf(reply(await core.request(req(who, 'POST', '/api/frame/activity', { body: {} })))), { working: false, available: false });
        assert.equal((jsonOf(reply(await core.request(req(who, 'GET', '/api/frame/session')))) as FrameSession).agent.available, false);
      }
      assert.deepEqual(agent, [], 'nothing reached the agent');
      assert.equal((await cap(core, 'editor', 'room', 'sendToAgentSession', { data: 'ok' })).result.to, 'agent');
      assert.equal((await cap(core, 'editor', 'comments', 'sendToAgent', { anchor: {}, text: 'please' })).result.status, 'delivered');
      assert.deepEqual(agent, ['request:ok', 'thread']);
    } finally {
      core.close();
    }
  });

  it('downloads and permissions answer when a call comes here; unknown methods stay refused', async () => {
    const { core } = mount({ ...DECLARATION, downloads: {} });
    try {
      assert.equal((await cap(core, 'viewer', 'downloads', 'save', { filename: 'a' })).error.code, 'unavailable');
      assert.equal((await cap(core, 'viewer', 'permissions', 'state', { name: 'comments' })).result, 'unavailable', 'not granted to this viewer');
      assert.equal((await cap(core, 'editor', 'permissions', 'state', { name: 'comments' })).result, 'granted');
      assert.equal((await cap(core, 'viewer', 'permissions', 'request', { names: ['db', 'assets'] })).result.assets, 'unavailable');
      assert.equal((await cap(core, 'viewer', 'permissions', 'manage', {})).error.code, 'unavailable');
      assert.equal((await cap(core, 'owner', 'db', 'drop', {})).error.code, 'invalid_request');
    } finally {
      core.close();
    }
  });

  it('the page’s read-only token: files of the page’s origin only, no capability, no db, no stream', async () => {
    const { core } = mount();
    try {
      await cap(core, 'member', 'db', 'set', { path: 'data/users/u_member/prefs', data: { secret: 'mona' } });
      const asReader = (url: string, method = 'GET', headers: Record<string, string> = {}): FrameRequest => ({
        method,
        url,
        headers: { origin: SHELL, 'x-read': 'rt-viewer', ...headers },
        body: async () => Buffer.from(JSON.stringify({ cap: 'db', method: 'get', args: [{ path: 'data/users/u_member/prefs' }] })),
      });
      // On the inner shell's origin: refused everywhere.
      for (const [method, url] of [
        ['GET', '/'],
        ['GET', '/api/frame/session'],
        ['GET', '/api/frame/events?c=readerclient1'],
        ['POST', '/api/frame/cap'],
        ['POST', '/api/frame/upload?type=image/gif'],
        ['POST', '/api/frame/agent'],
      ] as const) {
        const r = reply(await core.request(asReader(url, method, method === 'POST' ? { 'content-type': 'application/json' } : {})));
        assert.equal(r.status, 403, `${method} ${url}`);
        assert.ok(!text(r).includes('mona'));
      }
      assert.equal(core.acceptsStream(asReader('/api/frame/events?c=readerclient1')), false, 'no WebSocket either');
      assert.throws(() => core.connect(asReader('/api/frame/events'), 'readerclient1', { send: () => {}, end: () => {} }), (e: unknown) => e instanceof FrameError && e.code === 'forbidden');

      // On the page's origin, with the token in the Host as a browser sends it: the addresses the page really uses.
      const up = jsonOf(reply(await core.request(req('editor', 'POST', '/api/frame/upload?type=image/gif', { raw: async () => Buffer.from('GIF89a-page') }))));
      const page = (url: string, method = 'GET', headers: Record<string, string> = {}): FrameRequest => ({
        method,
        url,
        headers: { host: pageHost('rt-viewer'), ...headers },
        body: async () => new Uint8Array(),
      });
      const top = await core.contentRequest(page('/'));
      assert.equal(top.status, 302);
      assert.equal(top.headers.Location, `/_f/${core.ver}/`, 'a root-relative redirect: it stays on the token’s host');
      const index = await core.contentRequest(page(`/_f/${core.ver}/`, 'GET', { 'sec-fetch-dest': 'iframe', 'sec-fetch-site': 'cross-site', referer: `${SHELL}/` }));
      assert.equal(index.status, 200);
      assert.match(text(index), /<script src="\/_runtime\/open-artifact-frame\.js">/);
      const boot = /window\.__OPEN_ARTIFACT_FRAME=(\{.*?\});/.exec(text(index))![1]!;
      assert.equal(JSON.parse(boot).grants.includes('comments'), false, 'the page is told its reader’s grants');
      assert.ok(!text(index).includes('verified') && !text(index).includes('rt-viewer'), 'no token in the page');
      assert.equal((await core.contentRequest(page('/_runtime/open-artifact-frame.js'))).status, 200);
      assert.equal((await core.contentRequest(page(up.result.url))).status, 200, 'an asset by the url upload() gave');
      for (const url of [
        `/_f/${core.ver}/db/data/users/u_member/prefs.json`,
        `/_f/${core.ver}/..%2Fdb%2Fdata%2Fusers%2Fu_member%2Fprefs.json`,
        `/_f/${core.ver}/comments.json`,
        `/_f/${core.ver}/_blobs/${up.result.id}.json`,
        `/_f/${core.ver}/_blobs/${up.result.id}`,
      ]) {
        const r = await core.contentRequest(page(url));
        assert.equal(r.status, 404, url);
        assert.ok(!text(r).includes('mona') && !text(r).includes('u_editor'), url);
      }
      assert.equal((await core.contentRequest(page(`/_f/${core.ver}/_files.json`, 'POST'))).status, 405);
      for (const host of [undefined, 'page.site.example.test', 'rt-forged.page.site.example.test']) {
        const r = await core.contentRequest({ method: 'GET', url: `/_f/${core.ver}/_files.json`, headers: host ? { host } : {}, body: async () => new Uint8Array() });
        assert.equal(r.status, 403, `the page origin needs a read token (${host})`);
      }
    } finally {
      core.close();
    }
  });

  it('origins: the API answers only the inner shell’s origin, blobs only once admitted, and neither origin sends a referrer', async () => {
    const { core } = mount();
    try {
      const up = jsonOf(reply(await core.request(req('editor', 'POST', '/api/frame/upload?type=image/gif', { raw: async () => Buffer.from('GIF89a-x') }))));
      const blob = `/_blob/${up.result.id}`;
      const outsider: FrameRequest = { method: 'GET', url: blob, headers: {}, body: async () => new Uint8Array() };
      assert.equal(reply(await core.request(outsider)).status, 403, 'a blob on the shell origin is not served before admit');
      assert.equal(reply(await core.request(req('viewer', 'GET', blob))).status, 200);
      assert.equal(core.acceptsStream(req('viewer', 'GET', '/api/frame/events?c=viewerclient01', { headers: { origin: PAGE } })), false, 'a WebSocket from the page’s origin');
      assert.equal(core.acceptsStream(req('viewer', 'GET', '/api/frame/events?c=viewerclient01')), true);
      assert.equal(reply(await core.request(req('viewer', 'GET', '/api/frame/events?c=viewerclient01', { headers: { origin: PAGE } }))).status, 403);
      for (const origin of [PAGE, `https://${pageHost('rt-viewer')}`, 'https://evil.example.test']) {
        const r = reply(await core.request(req('editor', 'POST', '/api/frame/cap', { body: { cap: 'db', method: 'get', args: [{ path: 'notes/a' }] }, headers: { origin } })));
        assert.equal(r.status, 403, `a capability call from ${origin}`);
      }
      for (const r of [
        reply(await core.request(req('viewer', 'GET', '/'))),
        reply(await core.request(req('viewer', 'GET', '/api/frame/session'))),
        reply(await core.request(outsider)),
        await core.contentRequest({ method: 'GET', url: `/_f/${core.ver}/_files.json`, headers: { host: pageHost('rt-viewer') }, body: async () => new Uint8Array() }),
        await core.contentRequest({ method: 'GET', url: '/nothing', headers: {}, body: async () => new Uint8Array() }),
      ]) {
        assert.equal(r.headers['Referrer-Policy'], 'no-referrer');
      }
      const shell = reply(await core.request(req('viewer', 'GET', '/')));
      assert.match(String(shell.headers['Content-Security-Policy']), /frame-src https:\/\/\*\.page\.site\.example\.test(;|$)/);
      const session = jsonOf(reply(await core.request(req('viewer', 'GET', '/api/frame/session')))) as FrameSession;
      assert.equal(session.contentOrigin, `https://${pageHost('rt-viewer')}`, 'the page is framed on its read-only origin');
      assert.equal((jsonOf(reply(await core.request(req('member', 'GET', '/api/frame/session')))) as FrameSession).contentOrigin, `https://${pageHost('rt-member')}`, 'one per viewer');
      assert.ok(!session.contentOrigin.includes('verified'), 'never the viewer’s token');
    } finally {
      core.close();
    }
  });

  it('this computer (identity not withheld): search, the room and the publish echo answer as before', async () => {
    const { core } = mount();
    try {
      (core as unknown as { env: FrameEnv }).env.withholdIdentity = false;
      const heard = listen(core);
      assert.deepEqual((await cap(core, 'owner', 'user', 'search', { q: 'ed' })).result, [], 'no one to search for');
      await cap(core, 'owner', 'room', 'emit', { topic: 'react', data: 'x' }, 'notconnected1');
      assert.equal((heard.viewer!.find((e) => e.t === 'room') as Extract<FrameEvent, { t: 'room' }>).from, 'notconnected1', 'the client id as given');
      await cap(core, 'owner', 'artifact', 'publish', { files: { 'c.txt': { text: 'z' } } }, 'notconnected1');
      assert.equal((heard.viewer!.find((e) => e.t === 'files') as Extract<FrameEvent, { t: 'files' }>).from, 'notconnected1');
    } finally {
      core.close();
    }
  });

  it('page mode: the rules `.artifact.json` declares are the ones enforced', async () => {
    const { core } = mount(undefined, { db: { rules: [{ path: '', write: 'admin' }] }, assets: { upload: 'interact' } });
    try {
      assert.equal((await cap(core, 'member', 'db', 'set', { path: 'board/a', data: { n: 1 } })).error.code, 'invalid_argument', 'the marker locks writes to admin');
      await cap(core, 'editor', 'db', 'set', { path: 'board/a', data: { n: 1 } });
      assert.equal((await cap(core, 'viewer', 'db', 'get', { path: 'board/a' })).result.data.n, 1, 'read stays at view');
      assert.equal(reply(await core.request(req('member', 'POST', '/api/frame/upload?type=image/gif', { raw: async () => Buffer.from('GIF89a-m') }))).status, 200, 'upload: "interact" from the marker');
    } finally {
      core.close();
    }
  });

  it('a page origin the inner shell runs on, or one with a path, is refused per viewer', async () => {
    const { core } = mount();
    try {
      (core as unknown as { env: FrameEnv }).env.pageOrigin = () => `https://${pageHost('rt-viewer')}/r/x/`;
      const path = reply(await core.request(req('viewer', 'GET', '/api/frame/session')));
      assert.equal(path.status, 500, 'an origin, never a path');
      (core as unknown as { env: FrameEnv }).env.pageOrigin = () => SHELL;
      const r = reply(await core.request(req('viewer', 'GET', '/api/frame/session')));
      assert.equal(r.status, 500);
      assert.equal(jsonOf(r).error.code, 'same_origin');
    } finally {
      core.close();
    }
  });
});
