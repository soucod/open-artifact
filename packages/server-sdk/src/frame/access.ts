/**
 * Who may do what in a frame artifact: the viewer levels and the declaration's access settings, as pure functions the
 * core (core.ts) calls on every request. No I/O and no imports beyond types, so a test can run every level against
 * every rule kind (test/frame-levels.test.ts).
 *
 * The semantics are the Frame Runtime contract's (0.2.92):
 *
 * - Levels, lowest first: `view` (reads), `interact` (also writes shared data), `admin` (also publishes files and
 *   assets), `owner` (the artifact's own owner). `self` is a fifth word for db rules that nobody holds, not even the
 *   owner: it only ever opens a viewer's own `{self}` subtree.
 * - `db` rules (`capabilities.db.rules`: `[{path, read?, write?}]`): a rule applies to its path and everything below,
 *   a deeper rule overrides it there, an unset level inherits from the nearest rule above, and the root defaults to
 *   `read: "view", write: "interact"`. A path ending in `/{self}` names each viewer's own subtree under that prefix:
 *   on one's own subtree the better of the prefix rule and the `{self}` rule applies; on someone else's only the
 *   prefix rule does, and with no rule declared AT the prefix that subtree is private (nobody else reads or writes
 *   it, the owner included). `data/users/{self}` is always there, so `data/users/<id>/` is private unless a rule at
 *   `data/users` opens it, or a rule at `data` beside `data/{self}` does: `data/users` is then a sibling's subtree
 *   (the one named `users`), at the `data` rule's levels, and a {self} rule inside a subtree so opened does not make
 *   it private again (the contract: unless a version declared "a rule at `data/users`, or at `data` beside
 *   `data/{self}`, nobody else has ever reached it"). Writing implies reading: a write level is never below the read level in force.
 * - A declaration whose rules break the contract's grammar is refused at publish there; here it fails closed: only
 *   the owner reads or writes (see {@link compileDbRules}).
 */

import type { FrameLevel } from './env.ts';

/** A level a rule may ask for: a viewer level, or `self` (nobody holds it). */
export type RuleLevel = FrameLevel | 'self';

const RANK: Readonly<Record<RuleLevel, number>> = { view: 0, interact: 1, admin: 2, owner: 3, self: 4 };
const RULE_LEVELS = new Set<string>(['view', 'interact', 'admin', 'owner', 'self']);
/** The db path grammar's segment (as db.ts checks it). */
const SEGMENT = /^[A-Za-z0-9_\-.~:@+]+$/;
/** At most this many rules (the contract's limit). */
export const RULES_MAX = 64;
/** The prefix whose `{self}` rule is always there. */
const USERS = 'data/users';

/** Whether `level` meets `min`. `self` is met by nobody. */
export function meets(level: FrameLevel, min: RuleLevel): boolean {
  return min !== 'self' && RANK[level] >= RANK[min];
}

const easier = (a: RuleLevel, b: RuleLevel): RuleLevel => (RANK[a] <= RANK[b] ? a : b);
const harder = (a: RuleLevel, b: RuleLevel): RuleLevel => (RANK[a] >= RANK[b] ? a : b);

interface RuleLevels {
  read?: RuleLevel;
  write?: RuleLevel;
}

/** A declaration's db rules, ready to check paths against. */
export interface DbRules {
  /** Rules on a plain path (`''` is the root), by path. */
  plain: ReadonlyMap<string, RuleLevels>;
  /** `{self}` rules, by their prefix (`votes` for `votes/{self}`); `data/users` is always one. */
  self: ReadonlyMap<string, RuleLevels>;
  /** Why the declared rules were refused (they then fail closed), or null. */
  problem: string | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The rules nobody but the owner gets past: what a refused declaration falls back to. */
function closed(problem: string): DbRules {
  return { plain: new Map([['', { read: 'owner', write: 'owner' }]]), self: new Map([[USERS, {}]]), problem };
}

/**
 * Reads `capabilities.db` (`true`, `{}` or `{rules: [...]}`). No rules: the defaults. Rules that break the contract
 * (a bad level or path, `{self}` not last, `self` where it may not go, a prefix rule beside a `{self}` rule missing a
 * level, a write below its read, a path twice, more than {@link RULES_MAX}) fail closed, with `problem` saying why.
 */
export function compileDbRules(db: unknown): DbRules {
  const rules = isObject(db) ? db.rules : undefined;
  const plain = new Map<string, RuleLevels>();
  const self = new Map<string, RuleLevels>();
  if (rules === undefined || rules === null) {
    self.set(USERS, {});
    return { plain, self, problem: null };
  }
  if (!Array.isArray(rules)) return closed('db.rules is a list.');
  if (rules.length > RULES_MAX) return closed(`db.rules holds at most ${RULES_MAX} rules.`);
  for (const [i, raw] of rules.entries()) {
    if (!isObject(raw) || typeof raw.path !== 'string') return closed(`db.rules[${i}] needs a path.`);
    const path = raw.path.replace(/^\/+|\/+$/g, '');
    const segs = path === '' ? [] : path.split('/');
    const selfAt = segs.indexOf('{self}');
    if (selfAt !== -1 && selfAt !== segs.length - 1) return closed(`db.rules[${i}]: {self} is the last segment.`);
    const named = selfAt === -1 ? segs : segs.slice(0, -1);
    if (named.some((s) => !SEGMENT.test(s) || s === '.' || s === '..')) return closed(`db.rules[${i}]: ${JSON.stringify(raw.path)} is not a db path.`);
    if (selfAt === 0) return closed(`db.rules[${i}]: {self} needs a prefix.`);
    const levels: RuleLevels = {};
    for (const action of ['read', 'write'] as const) {
      const v = raw[action];
      if (v === undefined) continue;
      if (typeof v !== 'string' || !RULE_LEVELS.has(v)) return closed(`db.rules[${i}].${action}: one of view, interact, admin, owner, self.`);
      levels[action] = v as RuleLevel;
    }
    if (levels.read && levels.write && RANK[levels.write] < RANK[levels.read]) return closed(`db.rules[${i}]: write is never below read.`);
    if (levels.read === 'self' && levels.write !== 'self') return closed(`db.rules[${i}]: read "self" goes only with write "self".`);
    const key = named.join('/');
    const into = selfAt === -1 ? plain : self;
    if (into.has(key)) return closed(`db.rules: ${JSON.stringify(raw.path)} is there twice.`);
    into.set(key, levels);
  }
  // `self` goes only on the rule AT the prefix of a declared {self} rule, and that rule then sets both levels.
  for (const [key, levels] of plain) {
    const usesSelf = levels.read === 'self' || levels.write === 'self';
    if (usesSelf && (key === '' || !self.has(key))) return closed(`db.rules: "self" goes only on the rule at the prefix of a {self} rule (${JSON.stringify(key)}).`);
    if (self.has(key) && (!levels.read || !levels.write)) return closed(`db.rules: the rule at ${JSON.stringify(key)}, beside ${key}/{self}, sets both read and write.`);
  }
  for (const [key, levels] of self) {
    if (levels.read === 'self' || levels.write === 'self') return closed(`db.rules: "self" does not go on ${key}/{self} itself.`);
    const prefix = plain.get(key);
    if (prefix && (prefix.read === 'self' || prefix.write === 'self') && (!levels.read || !levels.write)) {
      return closed(`db.rules: beside a prefix rule that uses "self", ${key}/{self} states both levels.`);
    }
  }
  if (!self.has(USERS)) self.set(USERS, {});
  return { plain, self, problem: null };
}

/** The levels a db path asks of one viewer (`id`): to read it and to write it. `self` means nobody may. */
export function dbLevels(rules: DbRules, viewerId: string, segs: readonly string[]): { read: RuleLevel; write: RuleLevel } {
  let read: RuleLevel = 'view';
  let write: RuleLevel = 'interact';
  const root = rules.plain.get('');
  if (root) {
    read = root.read ?? read;
    write = root.write ?? write;
  }
  // Inside someone else's subtree that a rule at its prefix opened: a {self} rule further down (the built-in
  // `data/users/{self}` below `data/{self}`) no longer makes it private; the opened levels and plain rules go on.
  let opened = false;
  for (let k = 1; k <= segs.length; k++) {
    const prefix = segs.slice(0, k - 1).join('/');
    const own = rules.self.get(prefix);
    if (own) {
      if (segs[k - 1] === viewerId) {
        // One's own subtree: whichever of the prefix's rule and the {self} rule gives more (unset: the prefix's).
        read = easier(read, own.read ?? read);
        write = easier(write, own.write ?? write);
      } else if (rules.plain.has(prefix)) {
        opened = true;
      } else if (!opened) {
        // Someone else's subtree with no rule at the prefix: private, whatever is declared below it.
        return { read: 'self', write: 'self' };
      }
    }
    const here = rules.plain.get(segs.slice(0, k).join('/'));
    if (here) {
      read = here.read ?? read;
      write = here.write ?? write;
    }
  }
  return { read, write: harder(write, read) };
}

/** Whether a viewer (`id`, `level`) may read / write the db path `segs` (a document's, or a collection's). */
export function dbAllows(rules: DbRules, viewer: { id: string; level: FrameLevel }, segs: readonly string[], action: 'read' | 'write'): boolean {
  return meets(viewer.level, dbLevels(rules, viewer.id, segs)[action]);
}

/** The level a room topic asks to send on: `capabilities.room.topics[topic]` when it is `interact`, else `admin`. */
export function topicLevel(room: unknown, topic: string): FrameLevel {
  const topics = isObject(room) && isObject(room.topics) ? room.topics : {};
  const v = Object.prototype.hasOwnProperty.call(topics, topic) ? topics[topic] : undefined;
  // The contract opens a topic to `interact` only; `view` (or anything else) keeps it admin-only.
  return v === 'interact' ? 'interact' : 'admin';
}

/** The level uploads ask: `admin`, or `interact` when `capabilities.assets.upload` is `"interact"`. */
export function uploadLevel(assets: unknown): FrameLevel {
  return isObject(assets) && assets.upload === 'interact' ? 'interact' : 'admin';
}

/** The `user` scopes a declaration grants: `profile` (names, avatars, search) and `email`. */
export function userScopes(user: unknown): { profile: boolean; email: boolean } {
  const scopes = isObject(user) && Array.isArray(user.scopes) ? user.scopes : [];
  return { profile: scopes.includes('profile'), email: scopes.includes('email') };
}
