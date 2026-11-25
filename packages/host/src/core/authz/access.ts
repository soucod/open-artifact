/**
 * Live access: who a page token names, and their role on the artifact now.
 *
 * A page token is identity only (decision 15): its role and `grants_version`
 * are hints. Every content-origin request loads the principal it names again
 * and works out their current role from the catalog, so removing a grant or
 * changing a role takes effect on the next request without new tokens.
 *
 * {@link currentRole} does the work; {@link AccessCache} keeps its answers per
 * artifact while the artifact's `grants_version` and the site epoch stay put.
 *
 * Pure over the catalog: no Node APIs.
 */

import type { Catalog } from '../catalog/catalog.ts';
import type { Plugins } from '../plugins/registry.ts';
import type { ArtifactRole, ArtifactRow, GrantRecord, HostConfig, LinkRecord, Principal, UserPrincipal } from '../types.ts';
import { effectiveRole } from './roles.ts';

/** A principal named in a page token: enough to load it again. */
export interface PrincipalRef {
  kind: 'user' | 'guest' | 'agent' | 'anonymous';
  /** User id, guest id, agent token id, or `anonymous`. */
  id: string;
}

/** A principal's role on an artifact right now. */
export interface CurrentAccess {
  role: ArtifactRole;
  principal: Principal;
  artifact: ArtifactRow;
}

/** What {@link currentRole} may also be told. */
export interface CurrentRoleOptions {
  /**
   * A user's identity-provider groups (`<provider>:<group>` each). The catalog does not keep them, so without this
   * group grants do not count for a principal loaded from a page token.
   */
  groupsOf?: (userId: string) => Promise<readonly string[] | undefined>;
}

/** The ref a principal is named by in a page token (`p` and `k` of its claims). */
export function principalRef(principal: Principal): PrincipalRef {
  return principal.kind === 'anonymous' ? { kind: 'anonymous', id: 'anonymous' } : { kind: principal.kind, id: principal.id };
}

/** A stable string for a ref (cache key). */
export function refKey(ref: PrincipalRef): string {
  return `${ref.kind}:${ref.id}`;
}

async function loadUser(catalog: Catalog, config: Pick<HostConfig, 'owners'>, id: string, options: CurrentRoleOptions): Promise<UserPrincipal | null> {
  const record = await catalog.getUser(id);
  if (!record || record.disabledAt !== null) return null;
  const email = record.email ?? undefined;
  // A site owner by configuration is an admin even before the catalog says so (a verified address only).
  const configured = !!email && record.emailVerified && config.owners.includes(email.toLowerCase());
  const groups = options.groupsOf ? await options.groupsOf(id) : undefined;
  return {
    kind: 'user',
    id: record.id,
    name: record.name,
    ...(email ? { email, emailVerified: record.emailVerified } : {}),
    ...(record.avatar ? { avatar: record.avatar } : {}),
    ...(groups && groups.length > 0 ? { groups: [...groups] } : {}),
    siteRole: record.siteRole === 'admin' || configured ? 'admin' : 'member',
  };
}

/** Loads the principal a ref names, or null when it no longer exists (deleted guest, disabled user, revoked agent token). */
export async function loadPrincipal(catalog: Catalog, config: Pick<HostConfig, 'owners'>, ref: PrincipalRef, options: CurrentRoleOptions = {}): Promise<Principal | null> {
  switch (ref.kind) {
    case 'anonymous':
      return { kind: 'anonymous' };
    case 'user':
      return loadUser(catalog, config, ref.id, options);
    case 'guest': {
      const guest = await catalog.getGuest(ref.id);
      return guest ? { kind: 'guest', id: guest.id, name: guest.name, link: guest.linkId, artifact: guest.artifactId } : null;
    }
    case 'agent': {
      const token = await catalog.getAgentToken(ref.id);
      if (!token || token.revokedAt !== null) return null;
      const user = await loadUser(catalog, config, token.userId, options);
      if (!user) return null;
      return { kind: 'agent', id: token.id, user, label: token.label, ...(token.harness ? { harness: token.harness } : {}), scopes: token.scopes };
    }
    default:
      return null;
  }
}

/** {@link currentRole} with the earliest future grant expiry it relied on (when the answer may change on its own). */
async function computeAccess(
  catalog: Catalog,
  config: Pick<HostConfig, 'owners' | 'linkMaxRole' | 'publicAccess'>,
  artifactId: string,
  ref: PrincipalRef,
  now: Date,
  options: CurrentRoleOptions,
): Promise<{ access: CurrentAccess | null; artifact: ArtifactRow | undefined; changesAt: number | null; principal?: Principal; role?: ArtifactRole | null }> {
  const artifact = await catalog.getArtifact(artifactId);
  if (!artifact) return { access: null, artifact, changesAt: null };
  const principal = await loadPrincipal(catalog, config, ref, options);
  if (!principal) return { access: null, artifact, changesAt: null };
  const person = principal.kind === 'agent' ? principal.user : principal;
  const grants: GrantRecord[] = person.kind === 'user' ? await catalog.listGrants(artifactId) : [];
  // Decision 20: the links a signed-in user opened count for them as for a guest.
  const userLinks = person.kind === 'user' ? (await catalog.listUserGuests(person.id, artifactId)).map((g) => g.linkId) : [];
  const links: LinkRecord[] = person.kind === 'guest' || userLinks.length > 0 ? await catalog.listLinks(artifactId) : [];
  const role = effectiveRole(principal, artifact, grants, config, { links, userLinks, now });
  let changesAt: number | null = null;
  for (const grant of grants) {
    if (grant.expiresAt === null) continue;
    const at = Date.parse(grant.expiresAt);
    if (at > now.getTime() && (changesAt === null || at < changesAt)) changesAt = at;
  }
  return { access: role ? { role, principal, artifact } : null, artifact, changesAt, principal, role };
}

/**
 * The principal's role on the artifact right now, or null (no such artifact or principal, or no access). Loads the
 * user / guest / agent, the artifact's grants and links (and a user's link rows, decision 20), and applies
 * {@link effectiveRole}.
 */
export async function currentRole(
  catalog: Catalog,
  config: Pick<HostConfig, 'owners' | 'linkMaxRole' | 'publicAccess'>,
  artifactId: string,
  ref: PrincipalRef,
  now: Date,
  options: CurrentRoleOptions = {},
): Promise<CurrentAccess | null> {
  return (await computeAccess(catalog, config, artifactId, ref, now, options)).access;
}

/** An {@link AccessCache} answer: the access, and the site epoch read with it (page tokens are checked against it). */
export interface CachedAccess extends CurrentAccess {
  epoch: number;
}

export interface AccessCacheOptions extends CurrentRoleOptions {
  /** The clock (default: now). */
  now?: () => Date;
  /**
   * Longest an answer is kept, ms (default 10 s). Every sharing change raises the artifact's `grants_version`, which
   * drops the artifact's answers at once; this bounds what does not (a user disabled or made admin, an agent token
   * revoked, an email verified, group membership).
   */
  maxAgeMs?: number;
  /** Most artifacts kept (default 2000); the least recently filled go first. */
  maxArtifacts?: number;
  /**
   * The site's plugins. Only when one has `authz.role` does anything change: its chain runs after the host's own
   * role, and its answer is reused for at most the plugins' `cacheSeconds` (see {@link AccessCache}).
   */
  plugins?: Plugins;
}

interface Entry {
  grantsVersion: number;
  epoch: number;
  /** The plugins' access generation (1 when no plugin has `authz.role`). */
  generation: number;
  roles: Map<string, { value: CurrentAccess | null; until: number }>;
}

/**
 * Caches {@link currentRole} per artifact. Each lookup re-reads the artifact's row and the site epoch (two indexed
 * single-row reads) and drops the artifact's answers when its `grants_version` or the epoch moved, so a grant
 * changed through any `Catalog` over the same database applies on the next request, with nobody calling
 * {@link invalidate}. Re-reading is chosen over a short TTL because it is exact for every sharing change and still
 * saves the principal, grant and link reads of a full lookup.
 *
 * With an `authz.role` plugin (and only then) the host's role goes through the plugins' chain, and the chain's answer
 * is kept for at most its `cacheSeconds` (0: asked every time), keyed by the host's role so a sharing change still
 * applies at once. `ctx.host.access.invalidate` raises the artifact's `grants_version` (one artifact) or the site's
 * access generation (all), which this cache reads with the epoch in the same query, so every cache over the database
 * drops those answers on its next lookup.
 */
export class AccessCache {
  readonly #catalog: Catalog;
  readonly #config: Pick<HostConfig, 'owners' | 'linkMaxRole' | 'publicAccess'>;
  readonly #options: CurrentRoleOptions;
  readonly #now: () => Date;
  readonly #maxAgeMs: number;
  readonly #maxArtifacts: number;
  readonly #entries = new Map<string, Entry>();
  readonly #plugins: Plugins | undefined;
  /** The plugins' answers: `artifact \n principal \n host role` → role and until when it may be reused. */
  readonly #pluginAnswers = new Map<string, { role: ArtifactRole | null; until: number; generation: number; grantsVersion: number }>();

  constructor(catalog: Catalog, config: Pick<HostConfig, 'owners' | 'linkMaxRole' | 'publicAccess'>, options: AccessCacheOptions = {}) {
    this.#catalog = catalog;
    this.#config = config;
    this.#options = options.groupsOf ? { groupsOf: options.groupsOf } : {};
    this.#now = options.now ?? (() => new Date());
    this.#maxAgeMs = options.maxAgeMs ?? 10_000;
    this.#maxArtifacts = options.maxArtifacts ?? 2000;
    this.#plugins = options.plugins?.hasRoleHook ? options.plugins : undefined;
  }

  /** The principal's current role on the artifact (with the fresh artifact row and the site epoch), or null. */
  async role(artifactId: string, ref: PrincipalRef, options: { onCheckFailed?: (plugin: string) => void } = {}): Promise<CachedAccess | null> {
    const plugins = this.#plugins;
    const [artifact, stamp] = await Promise.all([
      this.#catalog.getArtifact(artifactId),
      plugins ? this.#catalog.accessStamp() : this.#catalog.siteEpoch().then((epoch) => ({ epoch, generation: 1 })),
    ]);
    const { epoch, generation } = stamp;
    if (!artifact) {
      this.#entries.delete(artifactId);
      return null;
    }
    let entry = this.#entries.get(artifactId);
    if (!entry || entry.grantsVersion !== artifact.grantsVersion || entry.epoch !== epoch || entry.generation !== generation) {
      entry = { grantsVersion: artifact.grantsVersion, epoch, generation, roles: new Map() };
      this.#entries.delete(artifactId);
      this.#entries.set(artifactId, entry);
      while (this.#entries.size > this.#maxArtifacts) this.#entries.delete(this.#entries.keys().next().value!);
    }
    const now = this.#now();
    const key = refKey(ref);
    const kept = entry.roles.get(key);
    if (kept && kept.until > now.getTime()) return kept.value ? { ...kept.value, artifact, epoch } : null;

    const computed = await computeAccess(this.#catalog, this.#config, artifactId, ref, now, this.#options);
    let access = computed.access;
    let until = now.getTime() + this.#maxAgeMs;
    if (computed.changesAt !== null && computed.changesAt < until) until = computed.changesAt;
    if (plugins && computed.principal && computed.artifact) {
      const decided = await this.#pluginRole(plugins, computed.principal, computed.artifact, computed.role ?? null, now.getTime(), generation);
      if (decided.failed) options.onCheckFailed?.(decided.failed);
      access = decided.role ? { role: decided.role, principal: computed.principal, artifact: computed.artifact } : null;
      if (decided.until < until) until = decided.until;
    }
    // Keep the answer only when it was worked out at the version this entry stands for.
    if (computed.artifact?.grantsVersion === entry.grantsVersion && this.#entries.get(artifactId) === entry) {
      entry.roles.set(key, { value: access, until });
    }
    return access ? { ...access, artifact, epoch } : null;
  }

  /** The plugins' chain over the host's role, reusing an answer for its `cacheSeconds`. */
  async #pluginRole(plugins: Plugins, principal: Principal, artifact: ArtifactRow, hostRole: ArtifactRole | null, now: number, generation: number): Promise<{ role: ArtifactRole | null; until: number; failed?: string }> {
    const key = `${artifact.id}\n${refKey(principalRef(principal))}\n${hostRole ?? '-'}`;
    const kept = this.#pluginAnswers.get(key);
    if (kept && kept.until > now && kept.generation === generation && kept.grantsVersion === artifact.grantsVersion) return { role: kept.role, until: kept.until };
    const answer = await plugins.role({ principal, artifact, role: hostRole });
    const seconds = answer.cacheSeconds ?? 0;
    const until = now + seconds * 1000;
    if (seconds > 0) {
      this.#pluginAnswers.delete(key);
      this.#pluginAnswers.set(key, { role: answer.role, until, generation, grantsVersion: artifact.grantsVersion });
      while (this.#pluginAnswers.size > this.#maxArtifacts * 20) this.#pluginAnswers.delete(this.#pluginAnswers.keys().next().value!);
    }
    return { role: answer.role, until, ...(answer.failed ? { failed: answer.failed } : {}) };
  }

  /**
   * The plugins' chain over a role the host worked out elsewhere (the home list), with the same reuse as
   * {@link role}; the role as it is when no plugin has `authz.role`. `generation` is from `Catalog.accessStamp`.
   */
  async pluginRole(principal: Principal, artifact: ArtifactRow, hostRole: ArtifactRole | null, generation: number): Promise<ArtifactRole | null> {
    if (!this.#plugins) return hostRole;
    return (await this.#pluginRole(this.#plugins, principal, artifact, hostRole, this.#now().getTime(), generation)).role;
  }

  /** Whether a plugin has `authz.role` (the home list then asks {@link pluginRole}). */
  get hasPluginRoles(): boolean {
    return this.#plugins !== undefined;
  }

  /** Forgets the answers of one artifact, or of all. */
  invalidate(artifactId?: string): void {
    if (artifactId === undefined) {
      this.#entries.clear();
      this.#pluginAnswers.clear();
    } else {
      this.#entries.delete(artifactId);
      for (const key of this.#pluginAnswers.keys()) if (key.startsWith(`${artifactId}\n`)) this.#pluginAnswers.delete(key);
    }
  }
}
