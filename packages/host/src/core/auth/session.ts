/**
 * Sessions and who makes a request.
 *
 * - A session is an opaque random id in the session cookie (decision 11,
 *   {@link sessionCookie}); the catalog keeps only its SHA-256. It lasts 30
 *   days from the last use; use is recorded (and the cookie re-sent) at most
 *   once an hour.
 * - {@link authenticate} looks at, in order: `Authorization: Bearer <access
 *   token>` (an agent, only where the caller takes agents: `{agents: true}`),
 *   the session cookie (a user), the artifact's guest cookie (decision 18;
 *   only when an artifact is named). A user session wins over a guest cookie.
 *   A credential that is expired, revoked, unknown or belongs to a disabled
 *   user counts as none, but the answer says so (`invalid`), so a Bearer
 *   caller can be answered 401.
 * - A platform that signs people in before the request comes (Cloudflare Access, `cloudflare-access.ts`): a
 *   request whose verified assertion names someone gets a session (and its cookie) at once; a session cookie of
 *   anyone else than that person is ended first. A request without the assertion goes by its cookies as usual.
 * - A plugin's `auth.authenticate` works the same way: an identity it answers gets a session at once, which records
 *   the plugin and the subject (`per_request`). Each later request of that session asks the plugin again (unless it
 *   sets `auth.recheck: false`): the same subject keeps the session; another identity ends it and signs that one in;
 *   no one ends it. A plugin that fails (throws, times out, answers nonsense) makes that one request anonymous but
 *   keeps the session: "the upstream says no one" is an answer (`null`), "the plugin could not say" is a failure.
 *   Sessions from any other provider never ask a plugin. Each request asks each plugin at most once, however many
 *   routes authenticate it on its way ({@link signedInOnce}).
 * - Agent tokens are good only on the Link API and `/mcp` (which reads its
 *   own). Everywhere else a Bearer token is refused, never read as anonymous:
 *   the app handler answers it 401 before any route runs
 *   (`createAppHandler`), and {@link authenticate} without `agents` marks it
 *   `invalid` too. Another `Authorization` scheme (a proxy's Basic login) is
 *   not ours there and is ignored.
 */

import { contentHostLabel } from '@open-artifact/protocol';
import { httpError, parseCookies, serializeCookie, sessionCookie, type BaseCtx, type CookieOptions } from '../http.ts';
import type { HostConfig, Principal, UserPrincipal, UserRecord } from '../types.ts';
import { signInWith } from './accounts.ts';
import { SignInError, type SignInFailure } from './errors.ts';
import { providersOf, type ExternalIdentity } from './provider.ts';

export const SESSION_TTL_MS = 30 * 24 * 3600_000;
/** Use is recorded at most this often. */
export const SESSION_TOUCH_MS = 3600_000;
const GUEST_COOKIE_MAX_AGE = 365 * 24 * 3600;

/** Which credential a request carried. */
export type CredentialKind = 'bearer' | 'session' | 'guest';

export interface Authentication {
  principal: Principal;
  /** The credential the principal came from; null when the request carried none that worked. */
  credential: CredentialKind | null;
  /**
   * Credentials the request carried that did not work (expired, revoked,
   * unknown, disabled user, malformed `Authorization`). A request with an
   * invalid `bearer` should be answered 401 rather than treated as anonymous.
   */
  invalid: CredentialKind[];
  /** A `Set-Cookie` the answer should carry (the rolled session cookie). */
  setCookie?: string;
  /** The session's stored id (SHA-256 of the cookie value), when signed in by session. */
  sessionId?: string;
  /** A plugin's `auth.authenticate` named someone, but signing them in was refused (the signup rule, `auth.identity`). */
  refused?: SignInRefusal;
}

/** A user record as a principal. */
export async function userPrincipal(user: UserRecord, ctx: BaseCtx): Promise<UserPrincipal> {
  const groups = await ctx.catalog.userGroups(user.id);
  return {
    kind: 'user',
    id: user.id,
    name: user.name,
    ...(user.email ? { email: user.email, emailVerified: user.emailVerified } : {}),
    ...(user.avatar ? { avatar: user.avatar } : {}),
    ...(groups.length > 0 ? { groups } : {}),
    siteRole: user.siteRole,
  };
}

function sessionCookieValue(config: Pick<HostConfig, 'appOrigin'>, token: string): string {
  const { name, options } = sessionCookie(config);
  return serializeCookie(name, token, { ...options, maxAge: SESSION_TTL_MS / 1000 });
}

/** Starts a session for a user; returns the `Set-Cookie` value. */
export async function startSession(user: Pick<UserRecord, 'id'>, request: Request, ctx: BaseCtx, identity?: Pick<ExternalIdentity, 'provider' | 'subject'>): Promise<string> {
  const userAgent = request.headers.get('user-agent')?.slice(0, 256) ?? null;
  const { token } = await ctx.catalog.createSession({ userId: user.id, ttlMs: SESSION_TTL_MS, userAgent, provider: identity?.provider ?? null, subject: identity?.subject ?? null });
  return sessionCookieValue(ctx.config, token);
}

/** A `Set-Cookie` value that deletes the session cookie. */
export function clearSessionCookie(config: Pick<HostConfig, 'appOrigin'>): string {
  const { name, options } = sessionCookie(config);
  return serializeCookie(name, '', { ...options, maxAge: 0 });
}

/** Ends the request's session (if any) and returns the `Set-Cookie` that deletes the cookie, with the ended session's user. */
export async function endSession(request: Request, ctx: BaseCtx): Promise<{ setCookie: string; userId: string | null }> {
  const token = parseCookies(request.headers.get('cookie'))[sessionCookie(ctx.config).name];
  let userId: string | null = null;
  if (token) {
    const session = await ctx.catalog.findSession(token);
    if (session) {
      userId = session.userId;
      await ctx.catalog.revokeSession(session.idHash);
    }
  }
  return { setCookie: clearSessionCookie(ctx.config), userId };
}

/**
 * The guest cookie of an artifact on the app origin (decision 18):
 * `oa_guest_<label>` (`__Host-` prefixed and `Secure` on https), the guest
 * secret as value, HttpOnly, SameSite=Lax, Path=/, one year.
 */
export function guestCookie(config: Pick<HostConfig, 'appOrigin'>, artifactId: string): { name: string; options: CookieOptions } {
  const secure = config.appOrigin.startsWith('https:');
  const name = `${secure ? '__Host-' : ''}oa_guest_${contentHostLabel(artifactId)}`;
  return { name, options: { path: '/', secure, httpOnly: true, sameSite: 'Lax', maxAge: GUEST_COOKIE_MAX_AGE } };
}

const ANONYMOUS: Principal = { kind: 'anonymous' };

/** Whether a request carries an `Authorization: Bearer …` credential. */
export function hasBearer(request: Request): boolean {
  return /^Bearer(?:\s|$)/i.test(request.headers.get('authorization')?.trim() ?? '');
}

/**
 * Who makes this request, with the details a caller needs to answer it (see the module comment). `agents`: this route
 * takes agent tokens (the Link API); without it a Bearer token is `invalid`, never an agent.
 */
export async function authenticate(request: Request, ctx: BaseCtx, options: { artifactId?: string; agents?: boolean } = {}): Promise<Authentication> {
  const { catalog } = ctx;
  const now = ctx.now().getTime();

  if (!options.agents && hasBearer(request)) return { principal: ANONYMOUS, credential: null, invalid: ['bearer'] };
  const authorization = options.agents ? request.headers.get('authorization') : null;
  if (authorization !== null) {
    const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization);
    const token = match ? await catalog.findAgentTokenByAccess(match[1]!) : undefined;
    const user = token ? await catalog.getUser(token.userId) : undefined;
    if (token && user && !user.disabledAt) {
      if (!token.usedAt || now - Date.parse(token.usedAt) >= SESSION_TOUCH_MS) await catalog.markAgentTokenUsed(token.id);
      return {
        principal: { kind: 'agent', id: token.id, user: await userPrincipal(user, ctx), label: token.label, ...(token.harness ? { harness: token.harness } : {}), scopes: token.scopes },
        credential: 'bearer',
        invalid: [],
      };
    }
    // A bad Bearer never falls back to the cookies: the caller asked to be an agent.
    return { principal: ANONYMOUS, credential: null, invalid: ['bearer'] };
  }

  const signed = await signedInOnce(request, ctx);
  if (signed.principal) {
    return {
      principal: signed.principal,
      credential: 'session',
      invalid: [...signed.invalid],
      ...(signed.setCookie ? { setCookie: signed.setCookie } : {}),
      ...(signed.sessionId ? { sessionId: signed.sessionId } : {}),
    };
  }
  const invalid = [...signed.invalid];
  const refused = signed.refused ? { refused: signed.refused } : {};

  if (options.artifactId) {
    const secret = parseCookies(request.headers.get('cookie'))[guestCookie(ctx.config, options.artifactId).name];
    if (secret) {
      const guest = await catalog.findGuestBySecret(secret);
      if (guest && guest.artifactId === options.artifactId) {
        if (!guest.seenAt || now - Date.parse(guest.seenAt) >= SESSION_TOUCH_MS) await catalog.seeGuest(guest.id);
        return { principal: { kind: 'guest', id: guest.id, name: guest.name, link: guest.linkId, artifact: guest.artifactId }, credential: 'guest', invalid, ...refused };
      }
      invalid.push('guest');
    }
  }

  return { principal: ANONYMOUS, credential: null, invalid, ...refused };
}

/** What the session cookie, a platform's sign-in and the plugins' `auth.authenticate` make of a request. */
interface SignedIn {
  principal: UserPrincipal | null;
  invalid: CredentialKind[];
  setCookie?: string;
  sessionId?: string;
  refused?: SignInRefusal;
}

/**
 * {@link signedIn} once per request where plugins authenticate: a request is authenticated by several routes on its
 * way (the app handler, then the route), and each plugin call (and each session it makes) should happen once.
 */
const SIGNED_IN = new WeakMap<Request, { catalog: BaseCtx['catalog']; answer: Promise<SignedIn> }>();

function signedInOnce(request: Request, ctx: BaseCtx): Promise<SignedIn> {
  if (!ctx.plugins?.hasAuthenticate) return signedIn(request, ctx);
  const known = SIGNED_IN.get(request);
  // The same site (a router hands each route its own ctx, with the path's params): its catalog.
  if (known && known.catalog === ctx.catalog) return known.answer;
  const answer = signedIn(request, ctx);
  SIGNED_IN.set(request, { catalog: ctx.catalog, answer });
  // A failed attempt is not kept: the next caller tries again.
  answer.catch(() => SIGNED_IN.delete(request));
  return answer;
}

async function signedIn(request: Request, ctx: BaseCtx): Promise<SignedIn> {
  const invalid: CredentialKind[] = [];
  const { catalog } = ctx;
  const now = ctx.now().getTime();
  const sessionToken = parseCookies(request.headers.get('cookie'))[sessionCookie(ctx.config).name];
  // A sign-in the platform did before the request came (Cloudflare Access): asked only when the request carries one.
  let presented = await presentedIdentity(request, ctx);
  // The plugin a re-check just asked (not to be asked twice), and whether it could not answer.
  let asked: string | undefined;
  let recheckFailed = false;
  if (sessionToken) {
    const session = await catalog.findSession(sessionToken);
    let user = session ? await catalog.getUser(session.userId) : undefined;
    if (session && user && presented) {
      // The session is someone else's than the one the platform signed in now (another person on this browser): it ends.
      const known = await catalog.findIdentity(presented.provider, presented.subject);
      if (!known || known.userId !== user.id) {
        await catalog.revokeSession(session.idHash);
        user = undefined;
      }
    }
    if (session && user && !presented && session.perRequest && session.provider && ctx.plugins) {
      // A session a plugin's `auth.authenticate` made holds only while that plugin still says the same person.
      const answer = await ctx.plugins.recheck(session.provider, request);
      if (answer.kind === 'failed') {
        // The plugin could not say (threw, timed out): anonymous for this request, the session kept for the next.
        user = undefined;
        recheckFailed = true;
      } else if (answer.kind === 'answer') {
        asked = session.provider.slice('plugin:'.length);
        if (!answer.identity || answer.identity.subject !== session.subject) {
          await catalog.revokeSession(session.idHash);
          user = undefined;
          if (answer.identity) presented = { ...answer.identity, provider: session.provider };
        }
      }
    }
    if (session && user && !user.disabledAt) {
      const result: SignedIn = { principal: await userPrincipal(user, ctx), invalid, sessionId: session.idHash };
      if (now - Date.parse(session.seenAt) >= SESSION_TOUCH_MS) {
        await catalog.touchSession(session.idHash, SESSION_TTL_MS);
        result.setCookie = sessionCookieValue(ctx.config, sessionToken);
      }
      return result;
    }
    if (recheckFailed) return { principal: null, invalid };
  }

  // A plugin's `auth.authenticate` (a header from a proxy, another app's cookie): asked when there is no session.
  let perRequest = false;
  if (presented) perRequest = asked !== undefined;
  else if (ctx.plugins?.hasAuthenticate) {
    const found = await ctx.plugins.authenticate(request, asked ? { except: asked } : {});
    if (found) {
      presented = { ...found.identity, provider: found.provider };
      perRequest = true;
    }
  }
  if (sessionToken && !presented) invalid.push('session');

  if (presented) {
    try {
      const user = await signInWith(presented, ctx);
      const { token, session } = await catalog.createSession({
        userId: user.id,
        ttlMs: SESSION_TTL_MS,
        userAgent: request.headers.get('user-agent')?.slice(0, 256) ?? null,
        provider: presented.provider,
        subject: presented.subject,
        perRequest,
      });
      await catalog.appendAudit({ actorKind: 'user', actorId: user.id, action: 'auth.sign_in', detail: { provider: presented.provider } });
      return { principal: await userPrincipal(user, ctx), invalid, sessionId: session.idHash, setCookie: sessionCookieValue(ctx.config, token) };
    } catch (error) {
      if (!(error instanceof SignInError)) throw error;
      ctx.log(`sign-in refused (${presented.provider}): ${error.message}`);
      await auditRefusalOnce(ctx, presented, error);
      // A plugin's own sign-in is told to the person (the app handler shows why); Access goes on as before.
      if (perRequest) return { principal: null, invalid, refused: refusalOf(presented.provider, error) };
    }
  }
  return { principal: null, invalid };
}

/** Why a request's own proof of who it comes from (a plugin's `auth.authenticate`) did not sign anyone in. */
export interface SignInRefusal {
  provider: string;
  reason: SignInFailure;
  /** The refusing plugin's sentence, for `plugin_refused`. */
  sentence?: string;
  error: SignInError;
}

function refusalOf(provider: string, error: SignInError): SignInRefusal {
  return { provider, reason: error.reason, ...(error.plugin ? { sentence: error.plugin.sentence } : {}), error };
}

/** How long a refused sign-in of one identity is audited once. */
export const REFUSAL_AUDIT_MS = 3600_000;
const REFUSALS_AUDITED = new Map<string, number>();

/**
 * Audits a refused sign-in at most once an hour per identity and reason: a proxy that signs everyone in by header
 * would otherwise write an entry on every request of someone the signup rule refuses. Kept in memory first (this
 * process or isolate), then checked against the audit log itself (another isolate, a restart), so the once-an-hour
 * holds across a Worker's isolates too.
 */
async function auditRefusalOnce(ctx: BaseCtx, identity: ExternalIdentity, error: SignInError): Promise<void> {
  const detail = { provider: identity.provider, subject: identity.subject, reason: error.reason, ...(error.plugin ? { plugin: error.plugin.id } : {}) };
  const key = JSON.stringify(detail);
  const now = ctx.now().getTime();
  const last = REFUSALS_AUDITED.get(key);
  if (last !== undefined && now - last < REFUSAL_AUDIT_MS) return;
  if (REFUSALS_AUDITED.size > 10_000) REFUSALS_AUDITED.clear();
  REFUSALS_AUDITED.set(key, now);
  if (await ctx.catalog.hasAuditSince({ action: 'auth.sign_in_refused', detail, since: new Date(now - REFUSAL_AUDIT_MS).toISOString() })) return;
  await ctx.catalog.appendAudit({ actorKind: 'anonymous', action: 'auth.sign_in_refused', detail });
}

/** The identity a request proves by itself (a provider with `fromRequest`: Cloudflare Access), verified, or null. */
async function presentedIdentity(request: Request, ctx: BaseCtx): Promise<ExternalIdentity | null> {
  if (!ctx.config.auth.some((auth) => auth.kind === 'cloudflare-access')) return null;
  for (const provider of providersOf(ctx.config)) {
    if (!provider.fromRequest) continue;
    const identity = await provider.fromRequest(request, ctx);
    if (identity) return identity;
  }
  return null;
}

/** Who makes this request: an agent (Authorization: Bearer <access token>, with `agents`), a signed-in user (session cookie), a link guest of `artifactId` (its guest cookie, decision 18), else anonymous. */
export async function resolvePrincipal(request: Request, ctx: BaseCtx, options: { artifactId?: string; agents?: boolean } = {}): Promise<Principal> {
  return (await authenticate(request, ctx, options)).principal;
}

/** The 401 for a request whose Bearer token did not work (`unauthorized`, with a `WWW-Authenticate` challenge to set). */
export function invalidBearer(): { error: ReturnType<typeof httpError>; challenge: string } {
  return {
    error: httpError('unauthorized', 'The access token is expired, revoked or unknown.', { status: 401, fix: 'Refresh the token, or sign in again.' }),
    challenge: 'Bearer error="invalid_token"',
  };
}
