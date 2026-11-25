/**
 * Page tokens and content hosts.
 *
 * A page token is what a content-origin page carries in its path
 * (`/<type>/<token>/…`) instead of a cookie: the app origin works out who
 * the viewer is and their role, and signs that for one artifact.
 *
 * Format: `v1.<base64url(JSON payload)>.<base64url(HMAC-SHA256 of "v1.<payload>")>`,
 * payload `{a, p, k, n, r, gv, ep, exp}` and, on a snapshot token, `s: 1` (see {@link PageTokenClaims}).
 *
 * A snapshot token is the read-only page address a remote agent gets from `Artifact {action: "call", name:
 * "snapshot"}` over MCP, to open with its own browser tool: role at most `viewer`, a short life
 * ({@link SNAPSHOT_TOKEN_TTL_SECONDS}) and no grace after `exp` on any request. The page it opens loads on its own (no
 * Shell), and what it writes is dropped.
 *
 * Content hosts: one host name per artifact, from the `contentOrigin`
 * template with `{id}` replaced by the artifact's label (the id with its `_`
 * made `-`: `art_abc` → `art-abc`).
 */

import { artifactIdOfLabel, contentHostLabel } from '@open-artifact/protocol';
import { base64urlDecode, base64urlEncode, hmacSign, hmacVerify } from './crypto.ts';
import { pageHostOf } from './page-host.ts';
import type { ArtifactRole, HostConfig, Principal } from './types.ts';

/** A page token's lifetime: 12 hours. */
export const PAGE_TOKEN_TTL_SECONDS = 12 * 60 * 60;
/** How long past `exp` an `api` request still accepts a token: 24 hours (an open page keeps working mid-edit). */
export const PAGE_TOKEN_API_GRACE_SECONDS = 24 * 60 * 60;

/**
 * A snapshot token's lifetime: 5 minutes. Long enough for an agent to hand the address to its browser tool and look
 * (a page draws in seconds), short enough that an address left in a transcript or a tool log is soon worthless; the
 * agent asks again for a new one at no cost.
 */
export const SNAPSHOT_TOKEN_TTL_SECONDS = 5 * 60;

const VERSION = 'v1';
const ROLES: ReadonlySet<string> = new Set(['owner', 'editor', 'commenter', 'viewer']);
const KINDS: ReadonlySet<string> = new Set(['user', 'guest', 'agent', 'anonymous']);

/** What a page token says. */
export interface PageTokenClaims {
  /** Artifact id. */
  a: string;
  /** Principal id (user, guest or agent token id; `anonymous`). */
  p: string;
  /** Principal kind. */
  k: Principal['kind'];
  /** Display name. */
  n: string;
  /** Role on the artifact. */
  r: ArtifactRole;
  /** The artifact's `grants_version` when signed. */
  gv: number;
  /** The site epoch when signed. */
  ep: number;
  /** Expiry, Unix seconds. */
  exp: number;
  /** `1` on a snapshot token (read-only, standalone page, no grace after `exp`); absent otherwise. */
  s?: 1;
}

/** What a request with a page token is: the page document, the WebSocket handshake, or an `_api/*` / sub-resource call. */
export type PageTokenUse = 'document' | 'socket' | 'api';

/** Signs claims into a token with the first key. */
export async function signPageToken(claims: PageTokenClaims, keys: readonly string[]): Promise<string> {
  // A fixed key order keeps tokens stable for equal claims.
  const ordered: PageTokenClaims = { a: claims.a, p: claims.p, k: claims.k, n: claims.n, r: claims.r, gv: claims.gv, ep: claims.ep, exp: claims.exp, ...(claims.s === 1 ? { s: 1 as const } : {}) };
  const head = `${VERSION}.${base64urlEncode(new TextEncoder().encode(JSON.stringify(ordered)))}`;
  return `${head}.${await hmacSign(head, keys)}`;
}

/** The claims of a well-formed token signed by any of the keys, else `null`. Does not check expiry or versions: see {@link checkPageToken}. */
export async function verifyPageToken(token: string, keys: readonly string[]): Promise<PageTokenClaims | null> {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== VERSION) return null;
  const [, payload, signature] = parts as [string, string, string];
  if (!(await hmacVerify(`${VERSION}.${payload}`, signature, keys))) return null;
  const bytes = base64urlDecode(payload);
  if (!bytes) return null;
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  return claimsOf(value);
}

function claimsOf(value: unknown): PageTokenClaims | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.a !== 'string' || typeof v.p !== 'string' || typeof v.n !== 'string') return null;
  if (typeof v.k !== 'string' || !KINDS.has(v.k) || typeof v.r !== 'string' || !ROLES.has(v.r)) return null;
  if (!Number.isInteger(v.gv) || !Number.isInteger(v.ep) || !Number.isInteger(v.exp)) return null;
  if (v.s !== undefined && v.s !== 1) return null;
  // A snapshot token never carries more than `viewer`.
  if (v.s === 1 && v.r !== 'viewer') return null;
  return { a: v.a, p: v.p, k: v.k as PageTokenClaims['k'], n: v.n, r: v.r as ArtifactRole, gv: v.gv as number, ep: v.ep as number, exp: v.exp as number, ...(v.s === 1 ? { s: 1 as const } : {}) };
}

/** Why a verified token is refused for this request. */
export type PageTokenRefusal = 'artifact' | 'grants' | 'epoch' | 'expired';

/**
 * Whether verified claims hold for this request: the token is for this
 * artifact, signed at its current `grants_version` and the current site
 * epoch, and not expired. `exp` is enforced for `document` and `socket`;
 * an `api` request accepts the token up to {@link PAGE_TOKEN_API_GRACE_SECONDS} past `exp`, except a snapshot
 * token's: it expires for good, on every request.
 */
export function checkPageToken(
  claims: PageTokenClaims,
  expected: { artifact: string; grantsVersion: number; epoch: number; now: Date; use: PageTokenUse },
): { ok: true } | { ok: false; reason: PageTokenRefusal } {
  if (claims.a !== expected.artifact) return { ok: false, reason: 'artifact' };
  if (claims.gv !== expected.grantsVersion) return { ok: false, reason: 'grants' };
  if (claims.ep !== expected.epoch) return { ok: false, reason: 'epoch' };
  const now = Math.floor(expected.now.getTime() / 1000);
  const limit = expected.use === 'api' && claims.s !== 1 ? claims.exp + PAGE_TOKEN_API_GRACE_SECONDS : claims.exp;
  if (now >= limit) return { ok: false, reason: 'expired' };
  return { ok: true };
}

/** The `p`, `k` and `n` claims of a principal. */
export function principalClaims(principal: Principal): Pick<PageTokenClaims, 'p' | 'k' | 'n'> {
  switch (principal.kind) {
    case 'user':
    case 'guest':
      return { p: principal.id, k: principal.kind, n: principal.name };
    case 'agent':
      return { p: principal.id, k: 'agent', n: principal.label };
    case 'anonymous':
      return { p: 'anonymous', k: 'anonymous', n: 'Anonymous' };
  }
}

/** Claims for a principal's page on an artifact, expiring {@link PAGE_TOKEN_TTL_SECONDS} from `now`. */
export function pageTokenClaims(input: { artifact: string; principal: Principal; role: ArtifactRole; grantsVersion: number; epoch: number; now: Date }): PageTokenClaims {
  return {
    a: input.artifact,
    ...principalClaims(input.principal),
    r: input.role,
    gv: input.grantsVersion,
    ep: input.epoch,
    exp: Math.floor(input.now.getTime() / 1000) + PAGE_TOKEN_TTL_SECONDS,
  };
}

/**
 * Claims for a snapshot token: the principal's read-only page of an artifact (role `viewer` whatever theirs is),
 * expiring `ttlSeconds` (default {@link SNAPSHOT_TOKEN_TTL_SECONDS}) from `now`.
 */
export function snapshotTokenClaims(input: { artifact: string; principal: Principal; grantsVersion: number; epoch: number; now: Date; ttlSeconds?: number }): PageTokenClaims {
  const ttl = input.ttlSeconds ?? SNAPSHOT_TOKEN_TTL_SECONDS;
  return { ...pageTokenClaims({ ...input, role: 'viewer' }), exp: Math.floor(input.now.getTime() / 1000) + ttl, s: 1 };
}

// ---------------------------------------------------------------------------
// Content hosts

/** The content origin of an artifact, e.g. `https://art-abc.content.example`. */
export function contentOriginOf(config: Pick<HostConfig, 'contentOrigin'>, artifactId: string): string {
  return config.contentOrigin.replace('{id}', contentHostLabel(artifactId));
}

/**
 * The artifact a content host name belongs to, from a `Host` header value
 * (`art-abc.content.example`, with or without the port), or `null` when the
 * host is not one of this deployment's content hosts.
 */
export function artifactOfContentHost(config: Pick<HostConfig, 'contentOrigin'>, host: string | null | undefined): string | null {
  if (!host) return null;
  const template = new URL(config.contentOrigin.replace('{id}', 'oa-id-placeholder'));
  const defaultPort = template.protocol === 'https:' ? '443' : '80';
  const [prefix, suffix] = template.host.split('oa-id-placeholder') as [string, string];
  let given = host.trim().toLowerCase();
  // `art-x.content.example:443` is `art-x.content.example` on https.
  if (!template.port && given.endsWith(`:${defaultPort}`)) given = given.slice(0, -defaultPort.length - 1);
  if (!given.startsWith(prefix) || !given.endsWith(suffix) || given.length <= prefix.length + suffix.length) return null;
  const label = given.slice(prefix.length, given.length - suffix.length);
  if (label.includes('.') || label.includes(':')) return null;
  return artifactIdOfLabel(label);
}

/**
 * What a request's host name is to this site:
 * - `app`: exactly the app origin's host (and port, where the origin has one; a default port written out counts as
 *   none, case does not matter, an IPv6 literal is compared in its canonical form);
 * - `content`: one of the artifacts' content hosts (`id` is the artifact's; it may not exist);
 * - `page`: one of the page hosts a `page` artifact's page runs on (`<idlabel>--<opaque>`, `page-host.ts`): never a
 *   content host, so nothing that takes a page token answers it;
 * - `stray`: a well-formed name that is neither (another name the DNS or a wildcard route sends here, a name with a
 *   trailing dot, which a browser treats as another origin). The app never answers it: a sign-in page under a name of
 *   someone else's choosing, maybe same-site with every artifact, is what the two origins exist to prevent;
 * - `malformed`: no `Host`, or one that cannot form a URL (spaces, `@`, a path, two ports, `www.127.0.0.1`).
 *
 * `scheme` is the request's (`http` or `https`); a default port is dropped for it.
 */
export type HostKind = { kind: 'app' } | { kind: 'content'; id: string } | { kind: 'page'; id: string; opaque: string } | { kind: 'stray'; host: string } | { kind: 'malformed' };

/** The longest `Host` value looked at (a DNS name is at most 253 characters, plus a port). */
const MAX_HOST_LENGTH = 300;
/** The characters a `Host` value may have: a DNS name or IPv4 address, an IPv6 literal in brackets, and a port. */
const HOST_CHARS = /^[a-z0-9._\-[\]:]+$/;

export function hostKindOf(config: Pick<HostConfig, 'appOrigin' | 'contentOrigin'>, host: string | null | undefined, scheme?: string): HostKind {
  const given = (host ?? '').trim().toLowerCase();
  if (!given || given.length > MAX_HOST_LENGTH || !HOST_CHARS.test(given)) return { kind: 'malformed' };
  const app = new URL(config.appOrigin);
  let parsed: URL;
  try {
    parsed = new URL(`${scheme === 'http' || scheme === 'https' ? scheme : app.protocol.slice(0, -1)}://${given}/`);
  } catch {
    return { kind: 'malformed' };
  }
  // A value `URL` reads as more than a host (it cannot here, given the characters, but the check is cheap).
  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return { kind: 'malformed' };
  const id = artifactOfContentHost(config, parsed.host);
  if (id) return { kind: 'content', id };
  const page = pageHostOf(config, parsed.host);
  if (page) return { kind: 'page', ...page };
  if (parsed.host === app.host) return { kind: 'app' };
  return { kind: 'stray', host: parsed.host };
}

/**
 * The plain answer for a request whose host the site does not serve: 421 for a stray name, 400 for a malformed one.
 * No cookie, no redirect, no page: nothing of the app is shown under that name.
 */
export function wrongHostResponse(kind: Extract<HostKind, { kind: 'stray' | 'malformed' }>): Response {
  const body =
    kind.kind === 'stray'
      ? `${kind.host} is not this site's app host nor an artifact's: Open Artifact does not answer it.\n`
      : 'The request has no valid Host header.\n';
  return new Response(body, { status: kind.kind === 'stray' ? 421 : 400, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}
