/**
 * The host's shared types: who is asking (`Principal`), the deployment's
 * configuration (`HostConfig`), the SQL seam every platform implements
 * (`SqlDriver`) and the catalog's records.
 *
 * Platform neutral: no Node or DOM-only APIs.
 */

import type { ArtifactRole, ShareRole, TypesPublishPolicy } from '@open-artifact/protocol';

export type { ArtifactRole, ShareRole };

// ---------------------------------------------------------------------------
// SQL

/** A value a statement binds or a row holds. Booleans are integers (0/1); times are ISO-8601 strings. */
export type SqlValue = string | number | null | Uint8Array;

/**
 * The database seam. Each platform supplies one (`node:sqlite`, D1, Postgres).
 * SQL uses `?` placeholders and stays in the SQLite/Postgres common subset.
 */
export interface SqlDriver {
  all<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  get<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T | undefined>;
  run(sql: string, params?: SqlValue[]): Promise<{ changes: number }>;
  /** Every statement in one transaction. */
  batch(statements: Array<{ sql: string; params?: SqlValue[] }>): Promise<void>;
}

/** One statement of a {@link SqlDriver.batch}. */
export interface SqlStatement {
  sql: string;
  params?: SqlValue[];
}

// ---------------------------------------------------------------------------
// Who is asking

/** A signed-in person. */
export interface UserPrincipal {
  kind: 'user';
  id: string;
  name: string;
  email?: string;
  /** Whether the identity provider vouched for `email`; email and domain grants need it. */
  emailVerified?: boolean;
  avatar?: string;
  /** Identity-provider groups, each `<provider>:<group>` (how group grants name them). */
  groups?: string[];
  siteRole: 'admin' | 'member';
}

/** Someone who joined an artifact through one of its share links. */
export interface GuestPrincipal {
  kind: 'guest';
  id: string;
  name: string;
  /** The link they joined through. */
  link: string;
  /** The artifact that link belongs to. */
  artifact: string;
}

/** An agent acting for a user with an agent token. */
export interface AgentPrincipal {
  kind: 'agent';
  /** The agent token's id. */
  id: string;
  user: UserPrincipal;
  label: string;
  harness?: string;
  scopes: string[];
}

/** Nobody in particular: a public, read-only visit. */
export interface AnonymousPrincipal {
  kind: 'anonymous';
}

/** Who a request comes from. Never derived from the peer address. */
export type Principal = UserPrincipal | GuestPrincipal | AgentPrincipal | AnonymousPrincipal;

// ---------------------------------------------------------------------------
// Configuration

/** How people sign in. A site may enable several. */
export type AuthConfig =
  | { kind: 'owner-key' }
  | { kind: 'oidc'; id: string; name: string; issuer: string; clientId: string; clientSecret?: string; scopes?: string[] }
  | { kind: 'github'; clientId: string; clientSecret: string }
  /** People signed in by Cloudflare Access in front of the site: `teamDomain` is `https://<team>.cloudflareaccess.com`, `aud` the application's AUD tag. */
  | { kind: 'cloudflare-access'; teamDomain: string; aud: string };

/** Who may create an account. */
export type SignupPolicy = 'owners-only' | 'invite' | `domain:${string}` | 'open';

/** A deployment's configuration (see `parseConfig`). */
export interface HostConfig {
  /** Origin of the Shell, home, auth, Library API, Link API and `/mcp`, e.g. `https://artifacts.example.com`. */
  appOrigin: string;
  /** Origin template of an artifact's content host, with `{id}` where the host label goes. */
  contentOrigin: string;
  /** HMAC secrets. The first signs; all verify. */
  signingKeys: string[];
  auth: AuthConfig[];
  /** Site admins, by (lower-case) email. */
  owners: string[];
  signup: SignupPolicy;
  /** The highest role a link guest may hold. */
  linkMaxRole: ShareRole;
  /** Whether `general_access = 'public'` takes effect on this site. */
  publicAccess: boolean;
  /** The owner-key sign-in secret (`OA_OWNER_KEY`); without it the host generates one and keeps only its hash. */
  ownerKey?: string;
  /** The name the owner-key user is created with (`OA_OWNER_NAME`, default `Owner`). */
  ownerName?: string;
  /**
   * `OA_CONTENT_SAME_SITE`: the content origin may be on the app origin's registrable domain (one domain for both).
   * Absent means two sites, which `parseConfig` enforces. What it weakens is in `docs/hosting.md`.
   */
  contentSameSite?: boolean;
  /**
   * `OA_TYPES_PUBLISH`: who may publish artifact types to the site (`off`, `admins`, `members`). Absent reads as
   * `admins`; `parseConfig` always sets it, and to `off` with `contentSameSite`.
   */
  typesPublish?: TypesPublishPolicy;
}

// ---------------------------------------------------------------------------
// Catalog records

export type SiteRole = 'admin' | 'member';

export interface UserRecord {
  id: string;
  name: string;
  /** Lower case. */
  email: string | null;
  emailVerified: boolean;
  avatar: string | null;
  siteRole: SiteRole;
  createdAt: string;
  disabledAt: string | null;
}

/** An external account `(provider, subject)` bound to a user. */
export interface IdentityRecord {
  provider: string;
  subject: string;
  userId: string;
  createdAt: string;
}

export interface SessionRecord {
  /** SHA-256 hex of the session id; the clear id lives only in the cookie. */
  idHash: string;
  userId: string;
  createdAt: string;
  seenAt: string;
  expiresAt: string;
  userAgent: string | null;
  /**
   * The provider that signed this session in (`password`, `github`, `cloudflare-access`, `plugin:<id>`, …) and the
   * subject it named; null for sessions from before migration 9 and ones started without a provider (an owner key).
   */
  provider: string | null;
  subject: string | null;
  /** Made from the request's own proof (a plugin's `auth.authenticate`), so asked again on each request. */
  perRequest: boolean;
}

/** An artifact's "general access" tier. */
export type GeneralAccess = 'restricted' | 'link' | 'public';

/** Per-artifact switches the owner sets in the Share panel. */
export interface ArtifactSettings {
  viewersCanExport: boolean;
  editorsCanAskAgent: boolean;
}

export interface ArtifactRow {
  id: string;
  type: string;
  typeRelease: string | null;
  title: string;
  ownerUser: string;
  workspaceId: string | null;
  generalAccess: GeneralAccess;
  settings: ArtifactSettings;
  /** Raised by every change to who may access the artifact; page tokens carry it. */
  grantsVersion: number;
  createdAt: string;
  updatedAt: string;
  trashedAt: string | null;
}

/** What a grant names. `link` access lives in `links`, `public` in `general_access`. */
export type GrantSubjectKind = 'user' | 'email' | 'domain' | 'group';

export interface GrantRecord {
  artifactId: string;
  subjectKind: GrantSubjectKind;
  /** User id, lower-case email, lower-case domain, or `<provider>:<group>`. */
  subject: string;
  role: ShareRole;
  createdBy: string;
  createdAt: string;
  expiresAt: string | null;
}

/** One share link of an artifact (at most one per role). */
export interface LinkRecord {
  id: string;
  artifactId: string;
  role: ShareRole;
  enabled: boolean;
  createdAt: string;
}

export interface GuestRecord {
  id: string;
  linkId: string;
  artifactId: string;
  name: string;
  joinedAt: string;
  seenAt: string | null;
  /** Decision 20: the signed-in user who opened the link (no cookie); null for a named link guest. */
  userId: string | null;
}

export interface AgentTokenRecord {
  id: string;
  userId: string;
  label: string;
  harness: string | null;
  scopes: string[];
  createdAt: string;
  /** When the current access token stops working (the refresh token does not expire; revoke it). */
  accessExpiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
}

export type DeviceCodeStatus = 'pending' | 'approved' | 'denied' | 'consumed';

/** The client a device sign-in was started from. */
export interface DeviceClient {
  name: string;
  harness?: string;
  version?: string;
}

export interface DeviceCodeRecord {
  /** SHA-256 hex of the device code. */
  deviceCodeHash: string;
  /** What the person types, `XXXX-XXXX`. */
  userCode: string;
  client: DeviceClient;
  status: DeviceCodeStatus;
  userId: string | null;
  createdAt: string;
  expiresAt: string;
  /** Seconds the client must wait between polls. */
  interval: number;
  lastPolledAt: string | null;
}

export interface OAuthClientRecord {
  id: string;
  metadataUrl: string | null;
  name: string;
  redirectUris: string[];
  createdAt: string;
}

export interface OAuthCodeRecord {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  scopes: string[];
  resource: string | null;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
}

export interface OutboxRecord {
  /** Increasing; the Link `events` cursor. */
  id: number;
  artifactId: string;
  toUser: string;
  kind: string;
  payload: unknown;
  createdAt: string;
  deliveredAt: string | null;
  ackedAt: string | null;
}

export interface AuditRecord {
  id: string;
  at: string;
  actorKind: Principal['kind'] | 'system';
  actorId: string | null;
  artifactId: string | null;
  action: string;
  detail: unknown;
  ip: string | null;
}
