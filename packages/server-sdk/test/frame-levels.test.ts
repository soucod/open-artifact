/**
 * Who may read, write and listen where in a frame artifact's db: every viewer level against every kind of rule the
 * declaration may hold (none, a plain prefix, a deeper override, a locked root, `{self}` with and without a rule at its
 * prefix, the `self` level, the built-in `data/users/{self}`, a rule opening `data/users`, and rules that fail closed),
 * through the frame core as a site mounts it. Each row says, per level (view, interact, admin, owner), whether a
 * `get` sees the document, a `query` lists it, a change event reaches that viewer's connection, and a `set` goes in.
 * The rule grammar's refusals are checked on access.ts directly.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { compileDbRules, dbLevels, meets, topicLevel, uploadLevel, userScopes } from '../src/frame/access.ts';
import { FrameCore, mountFrameCore, replyBytes } from '../src/frame/core.ts';
import type { CapabilityDecl } from '../src/frame/declaration.ts';
import type { FrameEnv, FrameLevel, FrameReply, FrameRequest, FrameViewer } from '../src/frame/env.ts';
import { PLAIN_GUARD } from '../src/frame/files.ts';
import type { FrameEvent } from '../src/frame/wire.ts';

const SHELL = 'https://inner.levels.example.test';
const PAGE = 'https://page.levels.example.test';
const LEVELS: FrameLevel[] = ['view', 'interact', 'admin', 'owner'];
const viewerAt = (level: FrameLevel): FrameViewer => ({
  id: `u_${level}`,
  name: level,
  email: null,
  avatarUrl: null,
  color: '#785ee8',
  level,
  guest: false,
  canComment: true,
});
const VIEWERS = Object.fromEntries(LEVELS.map((l) => [l, viewerAt(l)])) as Record<FrameLevel, FrameViewer>;
/** Someone else, whose subtrees the "other's" rows are about. */
const SUBJECT = 'u_subject';

const roots: string[] = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function envFor(db: CapabilityDecl): FrameEnv {
  return {
    id: 'art_levels0001',
    title: 'Levels',
    log: () => {},
    origins: { shell: SHELL, shellOrigins: [SHELL], content: PAGE, connectSrc: [], frameSrc: PAGE },
    viewer: (req) => VIEWERS[String(req.headers['x-viewer']) as FrameLevel],
    reader: () => null,
    pageOrigin: () => PAGE,
    people: () => [],
    withholdIdentity: true,
    admit: () => true,
    type: {
      label: 'levels type',
      fingerprint: () => 'fp',
      declaration: () => ({ key: 'levels', capabilities: { db, user: {} }, monitoring: {} }),
      manifest: () => ({}),
      indexHtml: () => '<!doctype html><title>levels</title>',
      file: () => null,
    },
    client: { file: () => null },
    watch: null,
    restricted: true,
    contentSecurityPolicy: null,
    page: false,
    guard: PLAIN_GUARD,
    debug: () => false,
    daemon: null,
    agentHook: { thread: async () => ({ status: 'delivered' }) as never, request: async () => ({ status: 'delivered' }) as never },
  };
}

function request(level: FrameLevel, body: unknown): FrameRequest {
  return {
    method: 'POST',
    url: '/api/frame/cap',
    headers: { origin: SHELL, 'x-viewer': level, 'content-type': 'application/json' },
    body: async () => Buffer.from(JSON.stringify(body)),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function cap(core: FrameCore, level: FrameLevel, method: string, args: unknown): Promise<any> {
  const r = (await core.request(request(level, { cap: 'db', method, args: [args] }))) as FrameReply;
  return JSON.parse(Buffer.from(replyBytes(r.body)!).toString('utf8'));
}

/** Per level, view → owner: 1 yes, 0 no. */
type Row4 = string;
const yes = (row: Row4, i: number): boolean => row[i] === '1';

interface Case {
  kind: string;
  db: CapabilityDecl;
  /** The document, for the viewer at hand: `ME` is that viewer's id. */
  path: string;
  read: Row4;
  write: Row4;
}

const CASES: Case[] = [
  { kind: 'no rules: shared', db: {}, path: 'notes/a', read: '1111', write: '0111' },
  { kind: 'no rules: own data/users subtree', db: {}, path: 'data/users/ME/prefs', read: '1111', write: '0111' },
  { kind: "no rules: someone else's data/users subtree", db: {}, path: `data/users/${SUBJECT}/prefs`, read: '0000', write: '0000' },
  { kind: 'plain prefix: write admin', db: { rules: [{ path: 'board', write: 'admin' }] }, path: 'board/a', read: '1111', write: '0011' },
  { kind: 'plain prefix: read and write admin', db: { rules: [{ path: 'secret', read: 'admin', write: 'admin' }] }, path: 'secret/a', read: '0011', write: '0011' },
  { kind: 'locked root', db: { rules: [{ path: '', read: 'interact', write: 'owner' }] }, path: 'x/a', read: '0111', write: '0001' },
  { kind: 'locked root: own data/users inherits it', db: { rules: [{ path: '', read: 'interact', write: 'owner' }] }, path: 'data/users/ME/p', read: '0111', write: '0001' },
  {
    kind: 'deeper rule overrides (looser)',
    db: { rules: [{ path: '', write: 'owner' }, { path: 'open', write: 'interact' }] },
    path: 'open/a',
    read: '1111',
    write: '0111',
  },
  {
    kind: 'deeper rule overrides (stricter)',
    db: { rules: [{ path: 'a', read: 'view', write: 'interact' }, { path: 'a/b/c', read: 'owner', write: 'owner' }] },
    path: 'a/b/c/d',
    read: '0001',
    write: '0001',
  },
  {
    kind: '{self} with a prefix rule: own',
    db: { rules: [{ path: 'votes', read: 'view', write: 'owner' }, { path: 'votes/{self}', write: 'interact' }] },
    path: 'votes/ME',
    read: '1111',
    write: '0111',
  },
  {
    kind: "{self} with a prefix rule: someone else's",
    db: { rules: [{ path: 'votes', read: 'view', write: 'owner' }, { path: 'votes/{self}', write: 'interact' }] },
    path: `votes/${SUBJECT}`,
    read: '1111',
    write: '0001',
  },
  { kind: '{self} without a prefix rule: own', db: { rules: [{ path: 'notes/{self}', write: 'interact' }] }, path: 'notes/ME/n/1', read: '1111', write: '0111' },
  { kind: "{self} without a prefix rule: someone else's", db: { rules: [{ path: 'notes/{self}', write: 'interact' }] }, path: `notes/${SUBJECT}/n/1`, read: '0000', write: '0000' },
  {
    kind: 'write self (sign-off sheet): own',
    db: { rules: [{ path: 'signoffs', read: 'view', write: 'self' }, { path: 'signoffs/{self}', read: 'view', write: 'interact' }] },
    path: 'signoffs/ME',
    read: '1111',
    write: '0111',
  },
  {
    kind: "write self (sign-off sheet): someone else's, the owner included",
    db: { rules: [{ path: 'signoffs', read: 'view', write: 'self' }, { path: 'signoffs/{self}', read: 'view', write: 'interact' }] },
    path: `signoffs/${SUBJECT}`,
    read: '1111',
    write: '0000',
  },
  {
    kind: "read admin, write self (suggestion box): someone else's",
    db: { rules: [{ path: 'box', read: 'admin', write: 'self' }, { path: 'box/{self}', read: 'view', write: 'interact' }] },
    path: `box/${SUBJECT}`,
    read: '0011',
    write: '0000',
  },
  {
    kind: 'read admin, write self (suggestion box): own',
    db: { rules: [{ path: 'box', read: 'admin', write: 'self' }, { path: 'box/{self}', read: 'view', write: 'interact' }] },
    path: 'box/ME',
    read: '1111',
    write: '0111',
  },
  {
    kind: "read self, write self (notebook): someone else's",
    db: { rules: [{ path: 'nb', read: 'self', write: 'self' }, { path: 'nb/{self}', read: 'view', write: 'interact' }] },
    path: `nb/${SUBJECT}`,
    read: '0000',
    write: '0000',
  },
  {
    kind: 'read self, write self (notebook): own',
    db: { rules: [{ path: 'nb', read: 'self', write: 'self' }, { path: 'nb/{self}', read: 'view', write: 'interact' }] },
    path: 'nb/ME',
    read: '1111',
    write: '0111',
  },
  {
    kind: "a rule at data/users opens someone else's subtree",
    db: { rules: [{ path: 'data/users', read: 'admin', write: 'owner' }] },
    path: `data/users/${SUBJECT}/prefs`,
    read: '0011',
    write: '0001',
  },
  {
    kind: 'a rule at data/users also sets the own subtree (the built-in {self} rule states no level)',
    db: { rules: [{ path: 'data/users', read: 'admin', write: 'owner' }] },
    path: 'data/users/ME/prefs',
    read: '0011',
    write: '0001',
  },
  {
    kind: "a rule at data beside data/{self} opens someone else's data/users subtree (at the data rule's levels)",
    db: { rules: [{ path: 'data', read: 'admin', write: 'owner' }, { path: 'data/{self}', write: 'interact' }] },
    path: `data/users/${SUBJECT}/prefs`,
    read: '0011',
    write: '0001',
  },
  {
    kind: 'data beside data/{self}: the own data/users subtree is a sibling one too (no {self} gain)',
    db: { rules: [{ path: 'data', read: 'admin', write: 'owner' }, { path: 'data/{self}', write: 'interact' }] },
    path: 'data/users/ME/prefs',
    read: '0011',
    write: '0001',
  },
  {
    kind: 'data beside data/{self}: a plain rule at data/users still applies there',
    db: { rules: [{ path: 'data', read: 'view', write: 'owner' }, { path: 'data/{self}', write: 'interact' }, { path: 'data/users', read: 'owner', write: 'owner' }] },
    path: `data/users/${SUBJECT}/prefs`,
    read: '0001',
    write: '0001',
  },
  {
    kind: "data/{self} without a rule at data: someone else's data/users subtree stays private",
    db: { rules: [{ path: 'data/{self}', write: 'interact' }] },
    path: `data/users/${SUBJECT}/prefs`,
    read: '0000',
    write: '0000',
  },
  {
    kind: 'data beside data/{self}: the own data/<id> subtree',
    db: { rules: [{ path: 'data', read: 'admin', write: 'owner' }, { path: 'data/{self}', read: 'view', write: 'interact' }] },
    path: 'data/ME/x/1',
    read: '1111',
    write: '0111',
  },
  { kind: 'refused rules (write below read) fail closed', db: { rules: [{ path: 'a', read: 'admin', write: 'view' }] }, path: 'x/a', read: '0001', write: '0001' },
  { kind: 'refused rules fail closed on the own subtree too', db: { rules: [{ path: 'a/{self}/b', write: 'view' }] }, path: 'data/users/ME/p', read: '0001', write: '0001' },
];

const pathFor = (c: Case, v: FrameViewer): string => c.path.replace('ME', v.id);
const collectionOf = (doc: string): string => doc.split('/').slice(0, -1).join('/');
const idOf = (doc: string): string => doc.split('/').at(-1)!;

function seed(root: string, doc: string): void {
  const file = join(root, 'db', `${doc}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, '{"seeded":true}\n');
}

describe('db access: every level × every rule kind × read / write / listen', () => {
  for (const c of CASES) {
    it(c.kind, async () => {
      const root = mkdtempSync(join(tmpdir(), 'oa-frame-levels-'));
      roots.push(root);
      const core = mountFrameCore(root, envFor(c.db));
      try {
        const heard: Record<string, FrameEvent[]> = {};
        for (const l of LEVELS) {
          heard[l] = [];
          core.connect(request(l, {}), `client_${l}_01`, { send: (e) => heard[l]!.push(e), end: () => {} });
        }
        for (const [i, l] of LEVELS.entries()) {
          const v = VIEWERS[l];
          const doc = pathFor(c, v);
          seed(root, doc);
          const what = `${l} on ${doc}`;
          // get: a document this viewer may not read looks like one that is not there.
          const got = await cap(core, l, 'get', { path: doc });
          assert.equal(got.result?.exists, yes(c.read, i), `get: ${what}`);
          // query: listed only when readable.
          const listed = await cap(core, l, 'query', { path: collectionOf(doc), spec: {} });
          assert.equal(
            (listed.result.docs as { id: string }[]).some((d) => d.id === idOf(doc)),
            yes(c.read, i),
            `query: ${what}`,
          );
          // listen: a change the host hands in reaches this viewer's connection only when readable.
          for (const k of LEVELS) heard[k]!.length = 0;
          core.noteChanges([`db/${doc}.json`]);
          const event = heard[l]!.find((e) => e.t === 'db') as Extract<FrameEvent, { t: 'db' }> | undefined;
          assert.equal(!!event?.paths.includes(doc), yes(c.read, i), `listen: ${what}`);
          // write: refused as invalid_argument.
          const set = await cap(core, l, 'set', { path: doc, data: { by: l } });
          if (yes(c.write, i)) assert.deepEqual(set, { result: {} }, `set: ${what}`);
          else assert.equal(set.error?.code, 'invalid_argument', `set refused: ${what}`);
          // add: a new id beside it asks what the document did, unless the document is the viewer's own `{self}`
          // (a new id there is nobody's subtree: the prefix rule decides, see the rows on someone else's).
          if (idOf(doc) !== v.id) {
            const add = await cap(core, l, 'add', { path: collectionOf(doc), data: { by: l } });
            if (yes(c.write, i)) assert.ok(add.result?.id, `add: ${what}`);
            else assert.equal(add.error?.code, 'invalid_argument', `add refused: ${what}`);
          }
        }
      } finally {
        core.close();
      }
    });
  }
});

describe('access.ts', () => {
  it('the owner meets every level but self; self is met by nobody', () => {
    for (const l of LEVELS) assert.equal(meets('owner', l), true);
    for (const l of LEVELS) assert.equal(meets(l, 'self'), false);
    assert.equal(meets('view', 'interact'), false);
    assert.equal(meets('admin', 'owner'), false);
  });

  it('a write level never falls below the read level in force', () => {
    const rules = compileDbRules({ rules: [{ path: 'a', read: 'admin' }] });
    assert.equal(rules.problem, null);
    assert.deepEqual(dbLevels(rules, 'u', ['a', 'b']), { read: 'admin', write: 'admin' });
  });

  it('refuses rules that break the grammar, and fails closed', () => {
    const refused: unknown[] = [
      'not a list',
      [{ path: 'a', write: 'everyone' }],
      [{ path: 'a', read: 'admin', write: 'interact' }],
      [{ path: 'a/{self}/b', write: 'interact' }],
      [{ path: '{self}', write: 'interact' }],
      [{ path: '', write: 'self' }],
      [{ path: 'a', write: 'self' }],
      [{ path: 'a', read: 'self', write: 'owner' }, { path: 'a/{self}', read: 'view', write: 'interact' }],
      [{ path: 'a/{self}', write: 'self' }],
      [{ path: 'a', read: 'view' }, { path: 'a/{self}', write: 'interact' }],
      [{ path: 'a', write: 'self', read: 'view' }, { path: 'a/{self}', write: 'interact' }],
      [{ path: 'a', write: 'admin' }, { path: 'a', write: 'owner' }],
      [{ path: 'a b', write: 'admin' }],
      [{ path: '../x', write: 'admin' }],
      Array.from({ length: 65 }, (_, i) => ({ path: `p${i}`, write: 'admin' })),
    ];
    for (const rules of refused) {
      const c = compileDbRules({ rules });
      assert.ok(c.problem, `refused: ${JSON.stringify(rules).slice(0, 80)}`);
      assert.deepEqual(dbLevels(c, 'u', ['x', 'y']), { read: 'owner', write: 'owner' }, 'only the owner');
    }
    assert.equal(compileDbRules({ rules: Array.from({ length: 64 }, (_, i) => ({ path: `p${i}`, write: 'admin' })) }).problem, null, '64 is the limit');
    assert.equal(compileDbRules(true).problem, null, 'db: true has the defaults');
  });

  it('room topics are admin-only unless opened to interact; uploads admin unless opened; scopes', () => {
    assert.equal(topicLevel({}, 'chat'), 'admin');
    assert.equal(topicLevel({ topics: { chat: 'interact' } }, 'chat'), 'interact');
    assert.equal(topicLevel({ topics: { chat: 'view' } }, 'chat'), 'admin', 'only interact widens');
    assert.equal(topicLevel({ topics: { chat: 'interact' } }, 'other'), 'admin');
    assert.equal(topicLevel({ topics: { constructor: 'interact' } }, 'toString'), 'admin');
    assert.equal(uploadLevel({}), 'admin');
    assert.equal(uploadLevel({ upload: 'interact' }), 'interact');
    assert.deepEqual(userScopes({}), { profile: false, email: false });
    assert.deepEqual(userScopes({ scopes: ['profile'] }), { profile: true, email: false });
    assert.deepEqual(userScopes({ scopes: ['profile', 'email'] }), { profile: true, email: true });
  });
});
