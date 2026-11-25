/**
 * The catalog: the site's records (users, sessions, artifacts, who may open
 * them, links and guests, agent tokens, device and OAuth codes, the outbox
 * to agents, the audit log and site settings) over a {@link SqlDriver}.
 *
 * - Secrets (session ids, link tokens, guest secrets, agent and refresh
 *   tokens, device and OAuth codes) are generated here, handed back in clear
 *   once, and stored as SHA-256 hex. A link's token is also stored encrypted
 *   (`token_enc`) so {@link Catalog.linkToken} can show it again.
 * - Every change to who may open an artifact (grants, general access, links,
 *   guests, trash) raises its `grants_version` in the same transaction, which
 *   invalidates the page tokens signed before.
 * - Times are ISO-8601 strings from the `now` clock given to the constructor.
 */

import { ARTIFACT_ID } from '@open-artifact/protocol';
import { decryptString, encryptString, randomBytes, randomId, randomToken, sha256Hex } from '../crypto.ts';
import { httpError } from '../http.ts';
import type {
  AgentTokenRecord,
  ArtifactRow,
  ArtifactSettings,
  AuditRecord,
  DeviceClient,
  DeviceCodeRecord,
  DeviceCodeStatus,
  GeneralAccess,
  GrantRecord,
  GrantSubjectKind,
  GuestRecord,
  IdentityRecord,
  LinkRecord,
  OAuthClientRecord,
  OAuthCodeRecord,
  OutboxRecord,
  SessionRecord,
  ShareRole,
  SiteRole,
  SqlDriver,
  SqlStatement,
  SqlValue,
  UserRecord,
} from '../types.ts';
import { migrate } from './schema.ts';

/** The AES-GCM purpose label link tokens are encrypted under. */
const LINK_TOKEN_PURPOSE = 'link-token';
/** Settings a new artifact starts with. */
export const DEFAULT_ARTIFACT_SETTINGS: ArtifactSettings = { viewersCanExport: true, editorsCanAskAgent: false };
/** The `site` key of the site epoch. */
const EPOCH_KEY = 'epoch';
/** The `site` key of the plugins' access generation (see {@link Catalog.accessStamp}). */
const ACCESS_GENERATION_KEY = 'plugins.access_generation';

/** Who to match grants against: a user's id, verified email and groups. */
export interface GrantSubjectQuery {
  id: string;
  email?: string | null;
  emailVerified?: boolean;
  /** `<provider>:<group>` each. */
  groups?: readonly string[];
}

export interface CatalogOptions {
  /** HMAC secrets of the site (`HostConfig.signingKeys`); the first encrypts link tokens. */
  signingKeys: readonly string[];
  /** The clock. */
  now?: () => Date;
}

// ---------------------------------------------------------------------------
// Row shapes (snake_case, as stored)

interface UserRow {
  id: string;
  name: string;
  email: string | null;
  email_verified: number;
  avatar: string | null;
  site_role: string;
  created_at: string;
  disabled_at: string | null;
}
interface IdentityRow {
  provider: string;
  subject: string;
  user_id: string;
  created_at: string;
}
interface SessionRow {
  id_hash: string;
  user_id: string;
  created_at: string;
  seen_at: string;
  expires_at: string;
  user_agent: string | null;
  provider: string | null;
  subject: string | null;
  per_request: number | null;
}
interface ArtifactDbRow {
  id: string;
  type: string;
  type_release: string | null;
  title: string;
  owner_user: string;
  workspace_id: string | null;
  general_access: string;
  settings_json: string;
  grants_version: number;
  created_at: string;
  updated_at: string;
  trashed_at: string | null;
}
interface GrantRow {
  artifact_id: string;
  subject_kind: string;
  subject: string;
  role: string;
  created_by: string;
  created_at: string;
  expires_at: string | null;
}
interface LinkRow {
  id: string;
  artifact_id: string;
  role: string;
  token_enc: string;
  enabled: number;
  created_at: string;
}
interface GuestRow {
  id: string;
  link_id: string;
  artifact_id: string;
  name: string;
  joined_at: string;
  seen_at: string | null;
  user_id: string | null;
}
interface AgentTokenRow {
  id: string;
  user_id: string;
  label: string;
  harness: string | null;
  scopes: string;
  created_at: string;
  access_expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
}
interface DeviceCodeRow {
  device_code_hash: string;
  user_code: string;
  client_json: string;
  status: string;
  user_id: string | null;
  created_at: string;
  expires_at: string;
  poll_interval: number;
  last_polled_at: string | null;
}
interface OAuthClientRow {
  id: string;
  metadata_url: string | null;
  name: string;
  redirect_uris: string;
  created_at: string;
}
interface OAuthCodeRow {
  client_id: string;
  user_id: string;
  redirect_uri: string;
  code_challenge: string;
  scopes: string;
  resource: string | null;
  created_at: string;
  expires_at: string;
  used_at: string | null;
}
interface OutboxRow {
  id: number;
  artifact_id: string;
  to_user: string;
  kind: string;
  payload_json: string;
  created_at: string;
  delivered_at: string | null;
  acked_at: string | null;
}
interface AuditRow {
  id: string;
  at: string;
  actor_kind: string;
  actor_id: string | null;
  artifact_id: string | null;
  action: string;
  detail_json: string | null;
  ip: string | null;
}

function parseJson<T>(text: string | null, fallback: T): T {
  if (text === null) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

const toUser = (r: UserRow): UserRecord => ({
  id: r.id,
  name: r.name,
  email: r.email,
  emailVerified: Number(r.email_verified) === 1,
  avatar: r.avatar,
  siteRole: r.site_role === 'admin' ? 'admin' : 'member',
  createdAt: r.created_at,
  disabledAt: r.disabled_at,
});
const toIdentity = (r: IdentityRow): IdentityRecord => ({ provider: r.provider, subject: r.subject, userId: r.user_id, createdAt: r.created_at });
const toSession = (r: SessionRow): SessionRecord => ({ idHash: r.id_hash, userId: r.user_id, createdAt: r.created_at, seenAt: r.seen_at, expiresAt: r.expires_at, userAgent: r.user_agent, provider: r.provider ?? null, subject: r.subject ?? null, perRequest: Number(r.per_request ?? 0) === 1 });
const toArtifact = (r: ArtifactDbRow): ArtifactRow => ({
  id: r.id,
  type: r.type,
  typeRelease: r.type_release,
  title: r.title,
  ownerUser: r.owner_user,
  workspaceId: r.workspace_id,
  generalAccess: (['restricted', 'link', 'public'].includes(r.general_access) ? r.general_access : 'restricted') as GeneralAccess,
  settings: { ...DEFAULT_ARTIFACT_SETTINGS, ...parseJson<Partial<ArtifactSettings>>(r.settings_json, {}) },
  grantsVersion: Number(r.grants_version),
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  trashedAt: r.trashed_at,
});
const toGrant = (r: GrantRow): GrantRecord => ({
  artifactId: r.artifact_id,
  subjectKind: r.subject_kind as GrantSubjectKind,
  subject: r.subject,
  role: r.role as ShareRole,
  createdBy: r.created_by,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
});
const toLink = (r: LinkRow): LinkRecord => ({ id: r.id, artifactId: r.artifact_id, role: r.role as ShareRole, enabled: Number(r.enabled) === 1, createdAt: r.created_at });
const toGuest = (r: GuestRow): GuestRecord => ({ id: r.id, linkId: r.link_id, artifactId: r.artifact_id, name: r.name, joinedAt: r.joined_at, seenAt: r.seen_at, userId: r.user_id ?? null });
const toAgentToken = (r: AgentTokenRow): AgentTokenRecord => ({
  id: r.id,
  userId: r.user_id,
  label: r.label,
  harness: r.harness,
  scopes: parseJson<string[]>(r.scopes, []),
  createdAt: r.created_at,
  accessExpiresAt: r.access_expires_at,
  usedAt: r.used_at,
  revokedAt: r.revoked_at,
});
const toDeviceCode = (r: DeviceCodeRow): DeviceCodeRecord => ({
  deviceCodeHash: r.device_code_hash,
  userCode: r.user_code,
  client: parseJson<DeviceClient>(r.client_json, { name: 'unknown' }),
  status: r.status as DeviceCodeStatus,
  userId: r.user_id,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  interval: Number(r.poll_interval),
  lastPolledAt: r.last_polled_at,
});
const toOAuthClient = (r: OAuthClientRow): OAuthClientRecord => ({ id: r.id, metadataUrl: r.metadata_url, name: r.name, redirectUris: parseJson<string[]>(r.redirect_uris, []), createdAt: r.created_at });
const toOAuthCode = (r: OAuthCodeRow): OAuthCodeRecord => ({
  clientId: r.client_id,
  userId: r.user_id,
  redirectUri: r.redirect_uri,
  codeChallenge: r.code_challenge,
  scopes: parseJson<string[]>(r.scopes, []),
  resource: r.resource,
  createdAt: r.created_at,
  expiresAt: r.expires_at,
  usedAt: r.used_at,
});
const toOutbox = (r: OutboxRow): OutboxRecord => ({
  id: Number(r.id),
  artifactId: r.artifact_id,
  toUser: r.to_user,
  kind: r.kind,
  payload: parseJson<unknown>(r.payload_json, null),
  createdAt: r.created_at,
  deliveredAt: r.delivered_at,
  ackedAt: r.acked_at,
});
const toAudit = (r: AuditRow): AuditRecord => ({
  id: r.id,
  at: r.at,
  actorKind: r.actor_kind as AuditRecord['actorKind'],
  actorId: r.actor_id,
  artifactId: r.artifact_id,
  action: r.action,
  detail: parseJson<unknown>(r.detail_json, null),
  ip: r.ip,
});

/** A new artifact id in the daemon's format: `art_` + base36 time + 16 hex digits. */
export function newArtifactId(now: Date = new Date()): string {
  const time = now.getTime().toString(36).padStart(9, '0');
  let hex = '';
  for (const byte of randomBytes(8)) hex += byte.toString(16).padStart(2, '0');
  return `art_${time}${hex}`;
}

const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';

/** A device sign-in code a person types, `XXXX-XXXX` (consonants only, so no words and no 0/O, 1/I). */
function newUserCode(): string {
  let out = '';
  while (out.length < 8) {
    for (const byte of randomBytes(16)) {
      // Rejection sampling keeps every letter equally likely.
      if (byte >= 240 || out.length >= 8) continue;
      out += USER_CODE_ALPHABET[byte % USER_CODE_ALPHABET.length];
    }
  }
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

/** A typed user code in the stored form (`bcdf ghjk` → `BCDF-GHJK`), or `null`. */
export function normalizeUserCode(text: string): string | null {
  const letters = text.toUpperCase().replace(/[^A-Z]/g, '');
  if (letters.length !== 8 || [...letters].some((c) => !USER_CODE_ALPHABET.includes(c))) return null;
  return `${letters.slice(0, 4)}-${letters.slice(4)}`;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** The stored subject of a grant (emails and domains lower case). */
function normalizeSubject(kind: GrantSubjectKind, subject: string): string {
  return kind === 'email' || kind === 'domain' ? subject.trim().toLowerCase() : subject;
}

/** The statement that invalidates an artifact's page tokens. */
function bump(artifactId: string): SqlStatement {
  return { sql: 'UPDATE artifacts SET grants_version = grants_version + 1 WHERE id = ?', params: [artifactId] };
}

/** SQL `IN (?, ?, …)` placeholders. */
function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

/** Grants that match a user: `WHERE` text and its parameters (expiry included). */
function grantMatch(who: GrantSubjectQuery, now: string): { where: string; params: SqlValue[] } {
  const terms = ["(subject_kind = 'user' AND subject = ?)"];
  const params: SqlValue[] = [who.id];
  if (who.email && who.emailVerified) {
    const email = normalizeEmail(who.email);
    terms.push("(subject_kind = 'email' AND subject = ?)");
    params.push(email);
    const domain = email.slice(email.lastIndexOf('@') + 1);
    if (domain) {
      terms.push("(subject_kind = 'domain' AND subject = ?)");
      params.push(domain);
    }
  }
  if (who.groups && who.groups.length > 0) {
    terms.push(`(subject_kind = 'group' AND subject IN (${placeholders(who.groups.length)}))`);
    params.push(...who.groups);
  }
  return { where: `(expires_at IS NULL OR expires_at > ?) AND (${terms.join(' OR ')})`, params: [now, ...params] };
}

/** The site's records. Create with {@link Catalog.open} (which migrates) or `new Catalog` on a migrated database. */
export class Catalog {
  readonly driver: SqlDriver;
  readonly #keys: readonly string[];
  readonly #now: () => Date;

  constructor(driver: SqlDriver, options: CatalogOptions) {
    if (options.signingKeys.length === 0) throw new TypeError('The catalog needs at least one signing key.');
    this.driver = driver;
    this.#keys = options.signingKeys;
    this.#now = options.now ?? (() => new Date());
  }

  /** Migrates the database, then returns a catalog over it. */
  static async open(driver: SqlDriver, options: CatalogOptions): Promise<Catalog> {
    await migrate(driver);
    return new Catalog(driver, options);
  }

  #iso(offsetMs = 0): string {
    return new Date(this.#now().getTime() + offsetMs).toISOString();
  }

  // -------------------------------------------------------------------------
  // Users

  async createUser(input: { id?: string; name: string; email?: string | null; emailVerified?: boolean; avatar?: string | null; siteRole?: SiteRole }): Promise<UserRecord> {
    const id = input.id ?? randomId('usr');
    const email = input.email ? normalizeEmail(input.email) : null;
    await this.driver.run('INSERT INTO users (id, name, email, email_verified, avatar, site_role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      id,
      input.name,
      email,
      input.emailVerified ? 1 : 0,
      input.avatar ?? null,
      input.siteRole ?? 'member',
      this.#iso(),
    ]);
    return (await this.getUser(id))!;
  }

  async getUser(id: string): Promise<UserRecord | undefined> {
    const row = await this.driver.get<UserRow>('SELECT * FROM users WHERE id = ?', [id]);
    return row && toUser(row);
  }

  /**
   * Several users by id, in one query however many (the ids go as one JSON parameter, so no limit on bound
   * parameters applies): id → user; unknown ids are left out.
   */
  async getUsers(ids: readonly string[]): Promise<Map<string, UserRecord>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.driver.all<UserRow>('SELECT * FROM users WHERE id IN (SELECT value FROM json_each(?))', [JSON.stringify(unique)]);
    return new Map(rows.map((row) => [row.id, toUser(row)]));
  }

  async findUserByEmail(email: string): Promise<UserRecord | undefined> {
    const row = await this.driver.get<UserRow>('SELECT * FROM users WHERE email = ?', [normalizeEmail(email)]);
    return row && toUser(row);
  }

  async listUsers(): Promise<UserRecord[]> {
    return (await this.driver.all<UserRow>('SELECT * FROM users ORDER BY created_at, id')).map(toUser);
  }

  /** Changes a user's name, email, verification or avatar (fields left out stay). */
  async updateUser(id: string, patch: { name?: string; email?: string | null; emailVerified?: boolean; avatar?: string | null }): Promise<UserRecord | undefined> {
    const sets: string[] = [];
    const params: SqlValue[] = [];
    if (patch.name !== undefined) sets.push('name = ?'), params.push(patch.name);
    if (patch.email !== undefined) sets.push('email = ?'), params.push(patch.email ? normalizeEmail(patch.email) : null);
    if (patch.emailVerified !== undefined) sets.push('email_verified = ?'), params.push(patch.emailVerified ? 1 : 0);
    if (patch.avatar !== undefined) sets.push('avatar = ?'), params.push(patch.avatar);
    if (sets.length > 0) await this.driver.run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
    return this.getUser(id);
  }

  async setSiteRole(id: string, role: SiteRole): Promise<boolean> {
    return (await this.driver.run('UPDATE users SET site_role = ? WHERE id = ?', [role, id])).changes === 1;
  }

  /** How many users the site has (disabled ones included). */
  async countUsers(): Promise<number> {
    return Number((await this.driver.get<{ n: number }>('SELECT COUNT(*) AS n FROM users'))?.n ?? 0);
  }

  /** A user's identity-provider groups, each `<provider>:<group>`. */
  async userGroups(id: string): Promise<string[]> {
    const row = await this.driver.get<{ groups_json: string | null }>('SELECT groups_json FROM users WHERE id = ?', [id]);
    return parseJson<string[]>(row?.groups_json ?? null, []);
  }

  /** Replaces the groups one provider reported for a user (`groups` already `<provider>:<group>`), keeping other providers' groups. */
  async setUserGroups(id: string, provider: string, groups: readonly string[]): Promise<string[]> {
    const prefix = `${provider}:`;
    const kept = (await this.userGroups(id)).filter((group) => !group.startsWith(prefix));
    const next = [...new Set([...kept, ...groups])].sort();
    await this.driver.run('UPDATE users SET groups_json = ? WHERE id = ?', [next.length > 0 ? JSON.stringify(next) : null, id]);
    return next;
  }

  /** Disables a user and ends their sessions and agent tokens. */
  async disableUser(id: string): Promise<void> {
    const now = this.#iso();
    await this.driver.batch([
      { sql: 'UPDATE users SET disabled_at = ? WHERE id = ? AND disabled_at IS NULL', params: [now, id] },
      { sql: 'DELETE FROM sessions WHERE user_id = ?', params: [id] },
      { sql: 'UPDATE agent_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', params: [now, id] },
    ]);
  }

  // -------------------------------------------------------------------------
  // Identities

  /** Binds an external account to a user (rebinding it if it was bound elsewhere). */
  async linkIdentity(provider: string, subject: string, userId: string): Promise<IdentityRecord> {
    await this.driver.run('INSERT INTO identities (provider, subject, user_id, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (provider, subject) DO UPDATE SET user_id = excluded.user_id', [
      provider,
      subject,
      userId,
      this.#iso(),
    ]);
    return (await this.findIdentity(provider, subject))!;
  }

  async findIdentity(provider: string, subject: string): Promise<IdentityRecord | undefined> {
    const row = await this.driver.get<IdentityRow>('SELECT * FROM identities WHERE provider = ? AND subject = ?', [provider, subject]);
    return row && toIdentity(row);
  }

  async listIdentities(userId: string): Promise<IdentityRecord[]> {
    return (await this.driver.all<IdentityRow>('SELECT * FROM identities WHERE user_id = ? ORDER BY created_at', [userId])).map(toIdentity);
  }

  // -------------------------------------------------------------------------
  // Sessions

  /** Starts a session; `token` (the cookie value) is returned only here. */
  async createSession(input: {
    userId: string;
    ttlMs: number;
    userAgent?: string | null;
    /** The provider that signed the person in, and the subject it named (see {@link SessionRecord.provider}). */
    provider?: string | null;
    subject?: string | null;
    perRequest?: boolean;
  }): Promise<{ token: string; session: SessionRecord }> {
    const token = randomToken(32);
    const idHash = await sha256Hex(token);
    const now = this.#iso();
    await this.driver.run('INSERT INTO sessions (id_hash, user_id, created_at, seen_at, expires_at, user_agent, provider, subject, per_request) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      idHash,
      input.userId,
      now,
      now,
      this.#iso(input.ttlMs),
      input.userAgent ?? null,
      input.provider ?? null,
      input.subject ?? null,
      input.perRequest ? 1 : 0,
    ]);
    return { token, session: (await this.#sessionByHash(idHash))! };
  }

  async #sessionByHash(idHash: string): Promise<SessionRecord | undefined> {
    const row = await this.driver.get<SessionRow>('SELECT * FROM sessions WHERE id_hash = ?', [idHash]);
    return row && toSession(row);
  }

  /** The unexpired session of a cookie value whose user is not disabled. */
  async findSession(token: string): Promise<SessionRecord | undefined> {
    const row = await this.driver.get<SessionRow>(
      'SELECT s.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ? AND s.expires_at > ? AND u.disabled_at IS NULL',
      [await sha256Hex(token), this.#iso()],
    );
    return row && toSession(row);
  }

  /** Marks a session seen and extends it to `ttlMs` from now (rolling expiry). */
  async touchSession(idHash: string, ttlMs: number): Promise<void> {
    await this.driver.run('UPDATE sessions SET seen_at = ?, expires_at = ? WHERE id_hash = ?', [this.#iso(), this.#iso(ttlMs), idHash]);
  }

  async listSessions(userId: string): Promise<SessionRecord[]> {
    return (await this.driver.all<SessionRow>('SELECT * FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY seen_at DESC', [userId, this.#iso()])).map(toSession);
  }

  async revokeSession(idHash: string): Promise<boolean> {
    return (await this.driver.run('DELETE FROM sessions WHERE id_hash = ?', [idHash])).changes === 1;
  }

  async revokeUserSessions(userId: string): Promise<number> {
    return (await this.driver.run('DELETE FROM sessions WHERE user_id = ?', [userId])).changes;
  }

  /** Deletes expired sessions; returns how many. */
  async purgeExpiredSessions(): Promise<number> {
    return (await this.driver.run('DELETE FROM sessions WHERE expires_at <= ?', [this.#iso()])).changes;
  }

  // -------------------------------------------------------------------------
  // Artifacts

  async createArtifact(input: {
    id?: string;
    type: string;
    typeRelease?: string | null;
    title: string;
    ownerUser: string;
    workspaceId?: string | null;
    generalAccess?: GeneralAccess;
    settings?: Partial<ArtifactSettings>;
  }): Promise<ArtifactRow> {
    const id = input.id ?? newArtifactId(this.#now());
    if (!ARTIFACT_ID.test(id)) throw httpError('invalid_argument', `Not an artifact id: ${id}`);
    const now = this.#iso();
    await this.driver.run(
      'INSERT INTO artifacts (id, type, type_release, title, owner_user, workspace_id, general_access, settings_json, grants_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
      [
        id,
        input.type,
        input.typeRelease ?? null,
        input.title,
        input.ownerUser,
        input.workspaceId ?? null,
        input.generalAccess ?? 'restricted',
        JSON.stringify({ ...DEFAULT_ARTIFACT_SETTINGS, ...input.settings }),
        now,
        now,
      ],
    );
    return (await this.getArtifact(id))!;
  }

  /**
   * Artifacts outside the trash in id order, `after` an id, at most `limit`, only `owner`'s when given: one indexed
   * query (the primary key, or `artifacts_owner`). Plugins' `ctx.host.artifacts.list`.
   */
  async listArtifactSummaries(options: { owner?: string; after?: string; limit: number }): Promise<Array<{ id: string; title: string; type: string; owner: string; updatedAt: string }>> {
    const where = ['trashed_at IS NULL'];
    const params: SqlValue[] = [];
    if (options.owner) where.push('owner_user = ?'), params.push(options.owner);
    if (options.after) where.push('id > ?'), params.push(options.after);
    const rows = await this.driver.all<{ id: string; title: string; type: string; owner_user: string; updated_at: string }>(
      `SELECT id, title, type, owner_user, updated_at FROM artifacts WHERE ${where.join(' AND ')} ORDER BY id LIMIT ?`,
      [...params, options.limit],
    );
    return rows.map((r) => ({ id: r.id, title: r.title, type: r.type, owner: r.owner_user, updatedAt: r.updated_at }));
  }

  async getArtifact(id: string): Promise<ArtifactRow | undefined> {
    const row = await this.driver.get<ArtifactDbRow>('SELECT * FROM artifacts WHERE id = ?', [id]);
    return row && toArtifact(row);
  }

  /** Several artifacts by id, in one query (as {@link getUsers}): id → row; unknown ids are left out. */
  async getArtifacts(ids: readonly string[]): Promise<Map<string, ArtifactRow>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map();
    const rows = await this.driver.all<ArtifactDbRow>('SELECT * FROM artifacts WHERE id IN (SELECT value FROM json_each(?))', [JSON.stringify(unique)]);
    return new Map(rows.map((row) => [row.id, toArtifact(row)]));
  }

  /**
   * The artifacts a user sees in their library: the ones they own plus the
   * ones an unexpired user, verified-email, domain or group grant shares with
   * them (not public access), plus the ones they opened through a share link
   * while signed in (decision 20: whether that link still works is the
   * caller's to check, with the role), most recently updated first.
   * `trashed: true` lists their own trashed artifacts instead.
   */
  async listArtifactsFor(user: GrantSubjectQuery, options: { trashed?: boolean } = {}): Promise<ArtifactRow[]> {
    if (options.trashed) {
      const rows = await this.driver.all<ArtifactDbRow>('SELECT * FROM artifacts WHERE owner_user = ? AND trashed_at IS NOT NULL ORDER BY trashed_at DESC', [user.id]);
      return rows.map(toArtifact);
    }
    const match = grantMatch(user, this.#iso());
    const rows = await this.driver.all<ArtifactDbRow>(
      `SELECT * FROM artifacts WHERE trashed_at IS NULL AND (owner_user = ? OR id IN (SELECT artifact_id FROM grants WHERE ${match.where}) OR id IN (SELECT artifact_id FROM guests WHERE user_id = ?)) ORDER BY updated_at DESC, id`,
      [user.id, ...match.params, user.id],
    );
    return rows.map(toArtifact);
  }

  /**
   * {@link listArtifactsFor} with what working out the person's role on each needs, in a fixed number of queries
   * (five, however many artifacts): the rows (each with whether it has any grant, for the Library's "shared" flag), the
   * grants that name this person, their link-guest rows and those links, and their pins. Subqueries rather than id
   * lists, so the number of bound parameters does not grow with the list (D1 allows 100).
   */
  async listArtifactsWithAccess(
    user: GrantSubjectQuery,
    options: { trashed?: boolean } = {},
  ): Promise<{ rows: Array<ArtifactRow & { hasGrants: boolean }>; grants: GrantRecord[]; guests: GuestRecord[]; links: LinkRecord[]; pins: Set<string> }> {
    const now = this.#iso();
    const match = grantMatch(user, now);
    const hasGrants = 'EXISTS (SELECT 1 FROM grants g WHERE g.artifact_id = artifacts.id) AS oa_has_grants';
    const rows = options.trashed
      ? await this.driver.all<ArtifactDbRow & { oa_has_grants: number }>(`SELECT artifacts.*, ${hasGrants} FROM artifacts WHERE owner_user = ? AND trashed_at IS NOT NULL ORDER BY trashed_at DESC`, [user.id])
      : await this.driver.all<ArtifactDbRow & { oa_has_grants: number }>(
          `SELECT artifacts.*, ${hasGrants} FROM artifacts WHERE trashed_at IS NULL AND (owner_user = ? OR id IN (SELECT artifact_id FROM grants WHERE ${match.where}) OR id IN (SELECT artifact_id FROM guests WHERE user_id = ?)) ORDER BY updated_at DESC, id`,
          [user.id, ...match.params, user.id],
        );
    const [grants, guests, links, pins] = await Promise.all([
      this.driver.all<GrantRow>(`SELECT * FROM grants WHERE ${match.where} ORDER BY created_at, subject_kind, subject`, match.params),
      this.driver.all<GuestRow>('SELECT * FROM guests WHERE user_id = ? ORDER BY joined_at, id', [user.id]),
      this.driver.all<LinkRow>('SELECT * FROM links WHERE artifact_id IN (SELECT artifact_id FROM guests WHERE user_id = ?) ORDER BY created_at, role', [user.id]),
      this.pinnedBy(user.id),
    ]);
    return {
      rows: rows.map((row) => ({ ...toArtifact(row), hasGrants: Number(row.oa_has_grants) === 1 })),
      grants: grants.map(toGrant),
      guests: guests.map(toGuest),
      links: links.map(toLink),
      pins,
    };
  }

  /** Records an edit: `updated_at` now, and the title and type release when given. */
  async touchArtifact(id: string, patch: { title?: string; typeRelease?: string | null } = {}): Promise<ArtifactRow | undefined> {
    const sets = ['updated_at = ?'];
    const params: SqlValue[] = [this.#iso()];
    if (patch.title !== undefined) sets.push('title = ?'), params.push(patch.title);
    if (patch.typeRelease !== undefined) sets.push('type_release = ?'), params.push(patch.typeRelease);
    await this.driver.run(`UPDATE artifacts SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
    return this.getArtifact(id);
  }

  /** Moves an artifact to the trash (only its owner and admins may open it there); false when missing or already there. */
  async trashArtifact(id: string): Promise<boolean> {
    const artifact = await this.getArtifact(id);
    if (!artifact || artifact.trashedAt !== null) return false;
    await this.driver.batch([{ sql: 'UPDATE artifacts SET trashed_at = ? WHERE id = ?', params: [this.#iso(), id] }, bump(id)]);
    return true;
  }

  /** Takes an artifact out of the trash; false when missing or not trashed. */
  async restoreArtifact(id: string): Promise<boolean> {
    const artifact = await this.getArtifact(id);
    if (!artifact || artifact.trashedAt === null) return false;
    await this.driver.batch([{ sql: 'UPDATE artifacts SET trashed_at = NULL WHERE id = ?', params: [id] }, bump(id)]);
    return true;
  }

  /** Trashed artifacts whose `trashed_at` is before `cutoff` (ISO), oldest first, at most `limit`. */
  async listTrashedBefore(cutoff: string, limit = 100): Promise<ArtifactRow[]> {
    const rows = await this.driver.all<ArtifactDbRow>('SELECT * FROM artifacts WHERE trashed_at IS NOT NULL AND trashed_at < ? ORDER BY trashed_at, id LIMIT ?', [cutoff, limit]);
    return rows.map(toArtifact);
  }

  /** Deletes an artifact's record with its grants, links, guests, pins, outbox entries and what MCP agents saw of it (its files are the caller's). */
  async deleteArtifact(id: string): Promise<void> {
    await this.driver.batch([
      { sql: 'DELETE FROM guests WHERE artifact_id = ?', params: [id] },
      { sql: 'DELETE FROM links WHERE artifact_id = ?', params: [id] },
      { sql: 'DELETE FROM grants WHERE artifact_id = ?', params: [id] },
      { sql: 'DELETE FROM outbox WHERE artifact_id = ?', params: [id] },
      { sql: 'DELETE FROM pins WHERE artifact_id = ?', params: [id] },
      { sql: 'DELETE FROM mcp_seen WHERE artifact_id = ?', params: [id] },
      { sql: 'DELETE FROM artifacts WHERE id = ?', params: [id] },
    ]);
  }

  async setGeneralAccess(id: string, access: GeneralAccess): Promise<ArtifactRow | undefined> {
    await this.driver.batch([{ sql: 'UPDATE artifacts SET general_access = ? WHERE id = ?', params: [access, id] }, bump(id)]);
    return this.getArtifact(id);
  }

  /** Merges settings (does not change who may access, so page tokens stay valid). */
  async setArtifactSettings(id: string, patch: Partial<ArtifactSettings>): Promise<ArtifactRow | undefined> {
    const current = await this.getArtifact(id);
    if (!current) return undefined;
    await this.driver.run('UPDATE artifacts SET settings_json = ? WHERE id = ?', [JSON.stringify({ ...current.settings, ...patch }), id]);
    return this.getArtifact(id);
  }

  /** Hands an artifact to another user; false when it is missing. */
  async setArtifactOwner(id: string, userId: string): Promise<boolean> {
    if (!(await this.getArtifact(id))) return false;
    await this.driver.batch([{ sql: 'UPDATE artifacts SET owner_user = ? WHERE id = ?', params: [userId, id] }, bump(id)]);
    return true;
  }

  /** Invalidates the artifact's page tokens; returns the new version (undefined when it is missing). */
  async bumpGrantsVersion(id: string): Promise<number | undefined> {
    const statement = bump(id);
    await this.driver.run(statement.sql, statement.params);
    return (await this.getArtifact(id))?.grantsVersion;
  }

  // -------------------------------------------------------------------------
  // Grants

  async listGrants(artifactId: string): Promise<GrantRecord[]> {
    return (await this.driver.all<GrantRow>('SELECT * FROM grants WHERE artifact_id = ? ORDER BY created_at, subject_kind, subject', [artifactId])).map(toGrant);
  }

  /** Adds a grant or changes its role and expiry. */
  async upsertGrant(input: { artifactId: string; subjectKind: GrantSubjectKind; subject: string; role: ShareRole; createdBy: string; expiresAt?: string | null }): Promise<GrantRecord> {
    const subject = normalizeSubject(input.subjectKind, input.subject);
    await this.driver.batch([
      {
        sql: 'INSERT INTO grants (artifact_id, subject_kind, subject, role, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (artifact_id, subject_kind, subject) DO UPDATE SET role = excluded.role, expires_at = excluded.expires_at',
        params: [input.artifactId, input.subjectKind, subject, input.role, input.createdBy, this.#iso(), input.expiresAt ?? null],
      },
      bump(input.artifactId),
    ]);
    const row = await this.driver.get<GrantRow>('SELECT * FROM grants WHERE artifact_id = ? AND subject_kind = ? AND subject = ?', [input.artifactId, input.subjectKind, subject]);
    return toGrant(row!);
  }

  async removeGrant(artifactId: string, subjectKind: GrantSubjectKind, subject: string): Promise<void> {
    await this.driver.batch([
      { sql: 'DELETE FROM grants WHERE artifact_id = ? AND subject_kind = ? AND subject = ?', params: [artifactId, subjectKind, normalizeSubject(subjectKind, subject)] },
      bump(artifactId),
    ]);
  }

  /** The unexpired grants, across artifacts, that match a user (by id, verified email and its domain, groups). */
  async grantsMatching(user: GrantSubjectQuery): Promise<GrantRecord[]> {
    const match = grantMatch(user, this.#iso());
    return (await this.driver.all<GrantRow>(`SELECT * FROM grants WHERE ${match.where} ORDER BY artifact_id`, match.params)).map(toGrant);
  }

  // -------------------------------------------------------------------------
  // Links

  async listLinks(artifactId: string): Promise<LinkRecord[]> {
    return (await this.driver.all<LinkRow>('SELECT * FROM links WHERE artifact_id = ? ORDER BY created_at, role', [artifactId])).map(toLink);
  }

  async getLink(id: string): Promise<LinkRecord | undefined> {
    const row = await this.driver.get<LinkRow>('SELECT * FROM links WHERE id = ?', [id]);
    return row && toLink(row);
  }

  async #linkStatement(id: string, artifactId: string, role: ShareRole, enabled: boolean): Promise<{ token: string; statement: SqlStatement }> {
    const token = randomToken(24);
    return {
      token,
      statement: {
        sql: 'INSERT INTO links (id, artifact_id, role, token_hash, token_enc, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        params: [id, artifactId, role, await sha256Hex(token), await encryptString(token, this.#keys, LINK_TOKEN_PURPOSE), enabled ? 1 : 0, this.#iso()],
      },
    };
  }

  /** Creates the artifact's link for a role (`conflict` when it has one); the clear token comes back here and from {@link linkToken}. */
  async createLink(artifactId: string, role: ShareRole, options: { enabled?: boolean } = {}): Promise<{ link: LinkRecord; token: string }> {
    if (await this.driver.get('SELECT id FROM links WHERE artifact_id = ? AND role = ?', [artifactId, role])) {
      throw httpError('conflict', `The artifact already has a ${role} link.`, { fix: 'Reset it to get a new address.' });
    }
    const id = randomId('lnk');
    const { token, statement } = await this.#linkStatement(id, artifactId, role, options.enabled ?? true);
    await this.driver.batch([statement, bump(artifactId)]);
    return { link: (await this.getLink(id))!, token };
  }

  /** The link a clear token opens (enabled or not). */
  async findLinkByToken(token: string): Promise<LinkRecord | undefined> {
    const row = await this.driver.get<LinkRow>('SELECT * FROM links WHERE token_hash = ?', [await sha256Hex(token)]);
    return row && toLink(row);
  }

  async setLinkEnabled(id: string, enabled: boolean): Promise<LinkRecord | undefined> {
    const link = await this.getLink(id);
    if (!link) return undefined;
    await this.driver.batch([{ sql: 'UPDATE links SET enabled = ? WHERE id = ?', params: [enabled ? 1 : 0, id] }, bump(link.artifactId)]);
    return this.getLink(id);
  }

  /** Gives a link a new token; the old token stops working and the guests who joined through it are removed. */
  async resetLink(id: string): Promise<{ link: LinkRecord; token: string } | undefined> {
    const link = await this.getLink(id);
    if (!link) return undefined;
    const token = randomToken(24);
    await this.driver.batch([
      { sql: 'UPDATE links SET token_hash = ?, token_enc = ? WHERE id = ?', params: [await sha256Hex(token), await encryptString(token, this.#keys, LINK_TOKEN_PURPOSE), id] },
      { sql: 'DELETE FROM guests WHERE link_id = ?', params: [id] },
      bump(link.artifactId),
    ]);
    return { link: (await this.getLink(id))!, token };
  }

  /** A link's clear token, decrypted (null when no signing key opens it, e.g. after every old key was dropped). */
  async linkToken(id: string): Promise<string | null> {
    const row = await this.driver.get<{ token_enc: string }>('SELECT token_enc FROM links WHERE id = ?', [id]);
    return row ? decryptString(row.token_enc, this.#keys, LINK_TOKEN_PURPOSE) : null;
  }

  // -------------------------------------------------------------------------
  // Guests

  /** Someone joins through a link under a name; `secret` (their credential) is returned only here. */
  async joinGuest(linkId: string, name: string): Promise<{ guest: GuestRecord; secret: string }> {
    const link = await this.getLink(linkId);
    if (!link) throw httpError('not_found', 'No such link.');
    const id = randomId('gst');
    const secret = randomToken(32);
    await this.driver.run('INSERT INTO guests (id, link_id, artifact_id, name, secret_hash, joined_at) VALUES (?, ?, ?, ?, ?, ?)', [
      id,
      linkId,
      link.artifactId,
      name,
      await sha256Hex(secret),
      this.#iso(),
    ]);
    return { guest: (await this.getGuest(id))!, secret };
  }

  /**
   * A signed-in user opens a share link (decision 20): they get a guest row with their user id and no secret anyone
   * holds, so the link's role counts for them while the link works, and resetting or turning off the link takes it
   * away. Opening the same link again returns their row. Raises the artifact's `grants_version` (their role changed).
   */
  async joinUserGuest(linkId: string, userId: string, name: string): Promise<GuestRecord> {
    const link = await this.getLink(linkId);
    if (!link) throw httpError('not_found', 'No such link.');
    const kept = await this.driver.get<GuestRow>('SELECT * FROM guests WHERE link_id = ? AND user_id = ?', [linkId, userId]);
    if (kept) return toGuest(kept);
    const id = randomId('gst');
    await this.driver.batch([
      {
        sql: 'INSERT INTO guests (id, link_id, artifact_id, name, secret_hash, joined_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        // Nobody holds this secret: the row is found by user id, never by a cookie.
        params: [id, linkId, link.artifactId, name, await sha256Hex(randomToken(32)), this.#iso(), userId],
      },
      bump(link.artifactId),
    ]);
    return (await this.getGuest(id))!;
  }

  /** The guest rows a signed-in user holds through share links, on one artifact or on all. */
  async listUserGuests(userId: string, artifactId?: string): Promise<GuestRecord[]> {
    const rows = artifactId
      ? await this.driver.all<GuestRow>('SELECT * FROM guests WHERE user_id = ? AND artifact_id = ? ORDER BY joined_at, id', [userId, artifactId])
      : await this.driver.all<GuestRow>('SELECT * FROM guests WHERE user_id = ? ORDER BY joined_at, id', [userId]);
    return rows.map(toGuest);
  }

  async getGuest(id: string): Promise<GuestRecord | undefined> {
    const row = await this.driver.get<GuestRow>('SELECT * FROM guests WHERE id = ?', [id]);
    return row && toGuest(row);
  }

  async findGuestBySecret(secret: string): Promise<GuestRecord | undefined> {
    const row = await this.driver.get<GuestRow>('SELECT * FROM guests WHERE secret_hash = ?', [await sha256Hex(secret)]);
    return row && toGuest(row);
  }

  async listGuests(artifactId: string): Promise<GuestRecord[]> {
    return (await this.driver.all<GuestRow>('SELECT * FROM guests WHERE artifact_id = ? ORDER BY joined_at, id', [artifactId])).map(toGuest);
  }

  async seeGuest(id: string): Promise<void> {
    await this.driver.run('UPDATE guests SET seen_at = ? WHERE id = ?', [this.#iso(), id]);
  }

  /** Changes a guest's role by moving them to the artifact's link for that role (created, disabled, when missing). */
  async setGuestRole(id: string, role: ShareRole): Promise<GuestRecord | undefined> {
    const guest = await this.getGuest(id);
    if (!guest) return undefined;
    const statements: SqlStatement[] = [];
    let target = (await this.driver.get<{ id: string }>('SELECT id FROM links WHERE artifact_id = ? AND role = ?', [guest.artifactId, role]))?.id;
    if (!target) {
      target = randomId('lnk');
      statements.push((await this.#linkStatement(target, guest.artifactId, role, false)).statement);
    }
    statements.push({ sql: 'UPDATE guests SET link_id = ? WHERE id = ?', params: [target, id] }, bump(guest.artifactId));
    await this.driver.batch(statements);
    return this.getGuest(id);
  }

  async removeGuest(id: string): Promise<boolean> {
    const guest = await this.getGuest(id);
    if (!guest) return false;
    await this.driver.batch([{ sql: 'DELETE FROM guests WHERE id = ?', params: [id] }, bump(guest.artifactId)]);
    return true;
  }

  // -------------------------------------------------------------------------
  // Pins (per person)

  /** Pins or unpins an artifact for one person. */
  async setPinned(userId: string, artifactId: string, pinned: boolean): Promise<void> {
    if (pinned) await this.driver.run('INSERT INTO pins (user_id, artifact_id, pinned_at) VALUES (?, ?, ?) ON CONFLICT (user_id, artifact_id) DO NOTHING', [userId, artifactId, this.#iso()]);
    else await this.driver.run('DELETE FROM pins WHERE user_id = ? AND artifact_id = ?', [userId, artifactId]);
  }

  /** The ids of the artifacts a person pinned. */
  async pinnedBy(userId: string): Promise<Set<string>> {
    const rows = await this.driver.all<{ artifact_id: string }>('SELECT artifact_id FROM pins WHERE user_id = ?', [userId]);
    return new Set(rows.map((r) => r.artifact_id));
  }

  // -------------------------------------------------------------------------
  // Agent tokens

  /**
   * Issues an agent an access token (expiring in `accessTtlMs`) and a refresh token (expiring in `refreshTtlMs` when
   * given, else never); both clear values are returned only here.
   */
  async issueAgentToken(input: { userId: string; label: string; harness?: string | null; scopes: readonly string[]; accessTtlMs: number; refreshTtlMs?: number }): Promise<{ token: AgentTokenRecord; accessToken: string; refreshToken: string }> {
    const id = randomId('agt');
    const accessToken = `oa_at_${randomToken(32)}`;
    const refreshToken = `oa_rt_${randomToken(32)}`;
    await this.driver.run(
      'INSERT INTO agent_tokens (id, user_id, label, harness, scopes, token_hash, refresh_hash, created_at, access_expires_at, refresh_expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        id,
        input.userId,
        input.label,
        input.harness ?? null,
        JSON.stringify(input.scopes),
        await sha256Hex(accessToken),
        await sha256Hex(refreshToken),
        this.#iso(),
        this.#iso(input.accessTtlMs),
        input.refreshTtlMs === undefined ? null : this.#iso(input.refreshTtlMs),
      ],
    );
    return { token: (await this.getAgentToken(id))!, accessToken, refreshToken };
  }

  async getAgentToken(id: string): Promise<AgentTokenRecord | undefined> {
    const row = await this.driver.get<AgentTokenRow>('SELECT * FROM agent_tokens WHERE id = ?', [id]);
    return row && toAgentToken(row);
  }

  /** The unrevoked, unexpired token an access token belongs to. */
  async findAgentTokenByAccess(accessToken: string): Promise<AgentTokenRecord | undefined> {
    const row = await this.driver.get<AgentTokenRow>('SELECT * FROM agent_tokens WHERE token_hash = ? AND revoked_at IS NULL AND access_expires_at > ?', [
      await sha256Hex(accessToken),
      this.#iso(),
    ]);
    return row && toAgentToken(row);
  }

  /** The unrevoked token a refresh token belongs to, while the refresh token has not run out. */
  async findAgentTokenByRefresh(refreshToken: string): Promise<AgentTokenRecord | undefined> {
    const row = await this.driver.get<AgentTokenRow>('SELECT * FROM agent_tokens WHERE refresh_hash = ? AND revoked_at IS NULL AND (refresh_expires_at IS NULL OR refresh_expires_at > ?)', [
      await sha256Hex(refreshToken),
      this.#iso(),
    ]);
    return row && toAgentToken(row);
  }

  /**
   * The token (revoked or not) whose refresh token was `refreshToken` before its last rotation: a refresh token
   * used a second time, which OAuth's security practice answers by revoking the whole token.
   */
  async findAgentTokenByReusedRefresh(refreshToken: string): Promise<AgentTokenRecord | undefined> {
    const row = await this.driver.get<AgentTokenRow>('SELECT * FROM agent_tokens WHERE prev_refresh_hash = ?', [await sha256Hex(refreshToken)]);
    return row && toAgentToken(row);
  }

  /**
   * Replaces both tokens of an agent token, given its current refresh token
   * (so a refresh token works once; the old one is remembered to detect its
   * reuse). `refreshTtlMs` restarts the refresh token's lifetime (rolling);
   * without it the lifetime is kept. Undefined when the refresh token is not
   * the current one, has run out, or the token is revoked.
   */
  async rotateAgentToken(refreshToken: string, accessTtlMs: number, options: { refreshTtlMs?: number } = {}): Promise<{ token: AgentTokenRecord; accessToken: string; refreshToken: string } | undefined> {
    const accessToken = `oa_at_${randomToken(32)}`;
    const nextRefresh = `oa_rt_${randomToken(32)}`;
    const oldHash = await sha256Hex(refreshToken);
    const now = this.#iso();
    const refreshExpiry = options.refreshTtlMs === undefined ? 'refresh_expires_at' : '?';
    const { changes } = await this.driver.run(
      `UPDATE agent_tokens SET token_hash = ?, refresh_hash = ?, prev_refresh_hash = ?, access_expires_at = ?, refresh_expires_at = ${refreshExpiry} WHERE refresh_hash = ? AND revoked_at IS NULL AND (refresh_expires_at IS NULL OR refresh_expires_at > ?)`,
      [
        await sha256Hex(accessToken),
        await sha256Hex(nextRefresh),
        oldHash,
        this.#iso(accessTtlMs),
        ...(options.refreshTtlMs === undefined ? [] : [this.#iso(options.refreshTtlMs)]),
        oldHash,
        now,
      ],
    );
    if (changes !== 1) return undefined;
    const token = await this.findAgentTokenByRefresh(nextRefresh);
    return token && { token, accessToken, refreshToken: nextRefresh };
  }

  async markAgentTokenUsed(id: string): Promise<void> {
    await this.driver.run('UPDATE agent_tokens SET used_at = ? WHERE id = ?', [this.#iso(), id]);
  }

  async revokeAgentToken(id: string): Promise<boolean> {
    return (await this.driver.run('UPDATE agent_tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', [this.#iso(), id])).changes === 1;
  }

  /** A user's agent tokens, revoked ones included, newest first. */
  async listAgentTokens(userId: string): Promise<AgentTokenRecord[]> {
    return (await this.driver.all<AgentTokenRow>('SELECT * FROM agent_tokens WHERE user_id = ? ORDER BY created_at DESC, id', [userId])).map(toAgentToken);
  }

  // -------------------------------------------------------------------------
  // Device codes (the Link sign-in)

  /** Starts a device sign-in; `deviceCode` (the client's secret) is returned only here. */
  async createDeviceCode(input: { client: DeviceClient; ttlMs: number; interval: number }): Promise<{ record: DeviceCodeRecord; deviceCode: string; userCode: string }> {
    const deviceCode = randomToken(32);
    const hash = await sha256Hex(deviceCode);
    for (let attempt = 0; ; attempt++) {
      const userCode = newUserCode();
      try {
        await this.driver.run(
          'INSERT INTO device_codes (device_code_hash, user_code, client_json, status, user_id, created_at, expires_at, poll_interval) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)',
          [hash, userCode, JSON.stringify(input.client), 'pending', this.#iso(), this.#iso(input.ttlMs), input.interval],
        );
        return { record: (await this.#deviceByHash(hash))!, deviceCode, userCode };
      } catch (error) {
        // A user code already in use: draw another.
        if (attempt >= 4) throw error;
      }
    }
  }

  async #deviceByHash(hash: string): Promise<DeviceCodeRecord | undefined> {
    const row = await this.driver.get<DeviceCodeRow>('SELECT * FROM device_codes WHERE device_code_hash = ?', [hash]);
    return row && toDeviceCode(row);
  }

  /** The unexpired sign-in a typed user code names (any spacing or case). */
  async findDeviceCodeByUserCode(userCode: string): Promise<DeviceCodeRecord | undefined> {
    const code = normalizeUserCode(userCode);
    if (!code) return undefined;
    const row = await this.driver.get<DeviceCodeRow>('SELECT * FROM device_codes WHERE user_code = ? AND expires_at > ?', [code, this.#iso()]);
    return row && toDeviceCode(row);
  }

  /** The sign-in of a device code, expired or not (the token route answers `expired_token` itself). */
  async findDeviceCodeByDeviceCode(deviceCode: string): Promise<DeviceCodeRecord | undefined> {
    return this.#deviceByHash(await sha256Hex(deviceCode));
  }

  /** Records a poll; returns the sign-in as it was before this poll (for `slow_down`). */
  async recordDevicePoll(deviceCode: string): Promise<DeviceCodeRecord | undefined> {
    const hash = await sha256Hex(deviceCode);
    const before = await this.#deviceByHash(hash);
    if (before) await this.driver.run('UPDATE device_codes SET last_polled_at = ? WHERE device_code_hash = ?', [this.#iso(), hash]);
    return before;
  }

  async #decideDevice(userCode: string, status: 'approved' | 'denied', userId: string | null): Promise<boolean> {
    const code = normalizeUserCode(userCode);
    if (!code) return false;
    const { changes } = await this.driver.run("UPDATE device_codes SET status = ?, user_id = ? WHERE user_code = ? AND status = 'pending' AND expires_at > ?", [status, userId, code, this.#iso()]);
    return changes === 1;
  }

  /** A signed-in person approves a pending sign-in for their account. */
  approveDeviceCode(userCode: string, userId: string): Promise<boolean> {
    return this.#decideDevice(userCode, 'approved', userId);
  }

  denyDeviceCode(userCode: string): Promise<boolean> {
    return this.#decideDevice(userCode, 'denied', null);
  }

  /** Takes an approved, unexpired sign-in once (the client then gets its tokens); undefined otherwise. */
  async consumeDeviceCode(deviceCode: string): Promise<DeviceCodeRecord | undefined> {
    const hash = await sha256Hex(deviceCode);
    const { changes } = await this.driver.run("UPDATE device_codes SET status = 'consumed' WHERE device_code_hash = ? AND status = 'approved' AND expires_at > ?", [hash, this.#iso()]);
    return changes === 1 ? this.#deviceByHash(hash) : undefined;
  }

  /** Deletes expired sign-ins; returns how many. */
  async expireDeviceCodes(): Promise<number> {
    return (await this.driver.run('DELETE FROM device_codes WHERE expires_at <= ?', [this.#iso()])).changes;
  }

  // -------------------------------------------------------------------------
  // OAuth (remote MCP)

  async createOAuthClient(input: { id?: string; name: string; redirectUris: readonly string[]; metadataUrl?: string | null }): Promise<OAuthClientRecord> {
    const id = input.id ?? randomId('oac');
    await this.driver.run('INSERT INTO oauth_clients (id, metadata_url, name, redirect_uris, created_at) VALUES (?, ?, ?, ?, ?)', [
      id,
      input.metadataUrl ?? null,
      input.name,
      JSON.stringify(input.redirectUris),
      this.#iso(),
    ]);
    return (await this.getOAuthClient(id))!;
  }

  async getOAuthClient(id: string): Promise<OAuthClientRecord | undefined> {
    const row = await this.driver.get<OAuthClientRow>('SELECT * FROM oauth_clients WHERE id = ?', [id]);
    return row && toOAuthClient(row);
  }

  /** Issues an authorization code; the clear `code` is returned only here. */
  async createOAuthCode(input: { clientId: string; userId: string; redirectUri: string; codeChallenge: string; scopes: readonly string[]; resource?: string | null; ttlMs: number }): Promise<{ code: string; record: OAuthCodeRecord }> {
    const code = randomToken(32);
    const hash = await sha256Hex(code);
    await this.driver.run(
      'INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, code_challenge, scopes, resource, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [hash, input.clientId, input.userId, input.redirectUri, input.codeChallenge, JSON.stringify(input.scopes), input.resource ?? null, this.#iso(), this.#iso(input.ttlMs)],
    );
    return { code, record: (await this.#oauthCodeByHash(hash))! };
  }

  async #oauthCodeByHash(hash: string): Promise<OAuthCodeRecord | undefined> {
    const row = await this.driver.get<OAuthCodeRow>('SELECT * FROM oauth_codes WHERE code_hash = ?', [hash]);
    return row && toOAuthCode(row);
  }

  /** Takes an unused, unexpired code once; undefined on the second try or after expiry. */
  async consumeOAuthCode(code: string): Promise<OAuthCodeRecord | undefined> {
    const hash = await sha256Hex(code);
    const { changes } = await this.driver.run('UPDATE oauth_codes SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at > ?', [this.#iso(), hash, this.#iso()]);
    return changes === 1 ? this.#oauthCodeByHash(hash) : undefined;
  }

  // -------------------------------------------------------------------------
  // Outbox (messages to a user's agent, delivered over Link)

  /** Queues a message for a user's agent; ids increase. */
  async appendOutbox(input: { artifactId: string; toUser: string; kind: string; payload: unknown }): Promise<OutboxRecord> {
    const payload = JSON.stringify(input.payload ?? null);
    for (let attempt = 0; ; attempt++) {
      const top = await this.driver.get<{ n: number | null }>('SELECT MAX(id) AS n FROM outbox');
      const id = Number(top?.n ?? 0) + 1;
      try {
        await this.driver.run('INSERT INTO outbox (id, artifact_id, to_user, kind, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?)', [id, input.artifactId, input.toUser, input.kind, payload, this.#iso()]);
        const row = await this.driver.get<OutboxRow>('SELECT * FROM outbox WHERE id = ?', [id]);
        return toOutbox(row!);
      } catch (error) {
        // Another append took this id first: try the next.
        if (attempt >= 4) throw error;
      }
    }
  }

  /** A user's messages not yet acknowledged, after the cursor `after` (an id), oldest first. */
  async listOutbox(toUser: string, after = 0, limit = 100): Promise<OutboxRecord[]> {
    return (await this.driver.all<OutboxRow>('SELECT * FROM outbox WHERE to_user = ? AND acked_at IS NULL AND id > ? ORDER BY id LIMIT ?', [toUser, after, limit])).map(toOutbox);
  }

  /**
   * Takes one outbox row for one way of delivery, atomically: a single conditional UPDATE, whose `changes` says who
   * won (the same on SQLite and Postgres). A `wake` row reaches the owner's agent once, by a Link stream or by an MCP
   * call, never both:
   *
   * - `link`: marks it delivered (keeping the first delivery time) while it is not acknowledged. A row a Link took
   *   before (delivered, not acknowledged) is taken again, so a reconnecting stream, or a second computer of the same
   *   person, gets it again until the Link acknowledges it.
   * - `mcp`: marks it delivered and acknowledged while it is neither, so it is gone for every other taker.
   *
   * Whichever UPDATE runs first makes the other's condition false. True when this caller took the row.
   */
  async claimOutbox(id: number, toUser: string, taker: 'link' | 'mcp'): Promise<boolean> {
    const now = this.#iso();
    const { changes } =
      taker === 'link'
        ? await this.driver.run('UPDATE outbox SET delivered_at = COALESCE(delivered_at, ?) WHERE id = ? AND to_user = ? AND acked_at IS NULL', [now, id, toUser])
        : await this.driver.run('UPDATE outbox SET delivered_at = ?, acked_at = ? WHERE id = ? AND to_user = ? AND delivered_at IS NULL AND acked_at IS NULL', [now, now, id, toUser]);
    return changes === 1;
  }

  /**
   * {@link claimOutbox} with `mcp` for several rows in one statement: the ids this caller took (each is gone for every
   * other taker), in no particular order.
   */
  async claimOutboxForMcp(ids: readonly number[], toUser: string): Promise<number[]> {
    if (ids.length === 0) return [];
    const now = this.#iso();
    const rows = await this.driver.all<{ id: number }>(
      'UPDATE outbox SET delivered_at = ?, acked_at = ? WHERE to_user = ? AND delivered_at IS NULL AND acked_at IS NULL AND id IN (SELECT value FROM json_each(?)) RETURNING id',
      [now, now, toUser, JSON.stringify([...ids])],
    );
    return rows.map((row) => Number(row.id));
  }

  async markOutboxDelivered(ids: readonly number[]): Promise<void> {
    if (ids.length === 0) return;
    await this.driver.run(`UPDATE outbox SET delivered_at = ? WHERE delivered_at IS NULL AND id IN (${placeholders(ids.length)})`, [this.#iso(), ...ids]);
  }

  /** The user's agent confirms messages; returns how many it acknowledged (others' ids are ignored). */
  async ackOutbox(toUser: string, ids: readonly number[]): Promise<number> {
    if (ids.length === 0) return 0;
    return (await this.driver.run(`UPDATE outbox SET acked_at = ? WHERE to_user = ? AND acked_at IS NULL AND id IN (${placeholders(ids.length)})`, [this.#iso(), toUser, ...ids])).changes;
  }

  // -------------------------------------------------------------------------
  // Audit

  async appendAudit(input: { actorKind: AuditRecord['actorKind']; actorId?: string | null; artifactId?: string | null; action: string; detail?: unknown; ip?: string | null }): Promise<AuditRecord> {
    const id = randomId('aud');
    await this.driver.run('INSERT INTO audit (id, at, actor_kind, actor_id, artifact_id, action, detail_json, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
      id,
      this.#iso(),
      input.actorKind,
      input.actorId ?? null,
      input.artifactId ?? null,
      input.action,
      input.detail === undefined ? null : JSON.stringify(input.detail),
      input.ip ?? null,
    ]);
    const row = await this.driver.get<AuditRow>('SELECT * FROM audit WHERE id = ?', [id]);
    const record = toAudit(row!);
    this.onAudit?.(record);
    return record;
  }

  /**
   * Told of every audit entry once it is written (the host hands it to plugins' `audit` handlers). It must not throw
   * and must not wait: set by the host when a plugin listens, absent otherwise.
   */
  onAudit: ((record: AuditRecord) => void) | undefined;

  /** Audit entries, newest first; filtered by artifact, and before a time (exclusive) for paging. */
  /**
   * Whether an entry of `action` with exactly this `detail` was written after `since` (ISO-8601): for writing a
   * repeated entry at most once in a while. Rides the `audit_at` index, so it reads only the entries since then.
   */
  async hasAuditSince(input: { action: string; detail: unknown; since: string }): Promise<boolean> {
    const row = await this.driver.get<{ n: number }>('SELECT 1 AS n FROM audit WHERE at > ? AND action = ? AND detail_json = ? LIMIT 1', [input.since, input.action, JSON.stringify(input.detail)]);
    return row !== undefined;
  }

  /**
   * Audit entries, newest first. `before` is a time (entries strictly earlier); `after` a page's last entry
   * (`{at, id}`), so the next page neither repeats nor skips entries written in the same millisecond.
   */
  async listAudit(options: { artifactId?: string; actorId?: string; actionPrefix?: string; before?: string; after?: { at: string; id: string }; limit?: number } = {}): Promise<AuditRecord[]> {
    const where: string[] = [];
    const params: SqlValue[] = [];
    if (options.artifactId) where.push('artifact_id = ?'), params.push(options.artifactId);
    if (options.actorId) where.push('actor_id = ?'), params.push(options.actorId);
    // A prefix by range (`auth.` → [`auth.`, `auth.\uffff`)): no LIKE, so `_` and `%` in it mean themselves.
    if (options.actionPrefix) where.push('action >= ? AND action < ?'), params.push(options.actionPrefix, `${options.actionPrefix}\uffff`);
    if (options.before) where.push('at < ?'), params.push(options.before);
    // Entries of one millisecond keep the order they were written in (rowid), so a page boundary inside one is exact.
    if (options.after) where.push('(at < ? OR (at = ? AND rowid < (SELECT rowid FROM audit WHERE id = ?)))'), params.push(options.after.at, options.after.at, options.after.id);
    const sql = `SELECT * FROM audit ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY at DESC, rowid DESC LIMIT ?`;
    return (await this.driver.all<AuditRow>(sql, [...params, options.limit ?? 100])).map(toAudit);
  }

  // -------------------------------------------------------------------------
  // Site

  async getSite(key: string): Promise<string | undefined> {
    return (await this.driver.get<{ value: string }>('SELECT value FROM site WHERE key = ?', [key]))?.value;
  }

  async setSite(key: string, value: string): Promise<void> {
    await this.driver.run('INSERT INTO site (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [key, value]);
  }

  /** Sets a site value only when the key has none; true when this call set it. */
  async insertSiteIfAbsent(key: string, value: string): Promise<boolean> {
    return (await this.driver.run('INSERT INTO site (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING', [key, value])).changes === 1;
  }

  async deleteSite(key: string): Promise<void> {
    await this.driver.run('DELETE FROM site WHERE key = ?', [key]);
  }

  /** The site epoch (1 until first bumped); page tokens carry it. */
  async siteEpoch(): Promise<number> {
    const value = Number(await this.getSite(EPOCH_KEY));
    return Number.isInteger(value) && value > 0 ? value : 1;
  }

  /**
   * The site epoch and the plugins' access generation, in one query. The generation moves when a plugin drops every
   * cached role answer (`ctx.host.access.invalidate()`); only a site with an `authz.role` plugin reads it.
   */
  async accessStamp(): Promise<{ epoch: number; generation: number }> {
    const rows = await this.driver.all<{ key: string; value: string }>('SELECT key, value FROM site WHERE key IN (?, ?)', [EPOCH_KEY, ACCESS_GENERATION_KEY]);
    const read = (key: string): number => {
      const value = Number(rows.find((row) => row.key === key)?.value);
      return Number.isInteger(value) && value > 0 ? value : 1;
    };
    return { epoch: read(EPOCH_KEY), generation: read(ACCESS_GENERATION_KEY) };
  }

  /** Moves the plugins' access generation on (every role answer a plugin gave is dropped everywhere). */
  async bumpAccessGeneration(): Promise<void> {
    await this.driver.run(
      "INSERT INTO site (key, value) VALUES (?, '2') ON CONFLICT (key) DO UPDATE SET value = CAST(CAST(site.value AS INTEGER) + 1 AS TEXT)",
      [ACCESS_GENERATION_KEY],
    );
  }

  /** Invalidates every page token on the site; returns the new epoch. */
  async bumpSiteEpoch(): Promise<number> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const stored = await this.getSite(EPOCH_KEY);
      const next = (await this.siteEpoch()) + 1;
      const { changes } =
        stored === undefined
          ? await this.driver.run('INSERT INTO site (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING', [EPOCH_KEY, String(next)])
          : await this.driver.run('UPDATE site SET value = ? WHERE key = ? AND value = ?', [String(next), EPOCH_KEY, stored]);
      if (changes === 1) return next;
    }
    throw httpError('conflict', 'The site epoch kept changing; try again.');
  }
}

export * from './trash.ts';
