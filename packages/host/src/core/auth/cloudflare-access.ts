/**
 * Sign-in through Cloudflare Access: the site sits behind an Access application, which signs people in before a
 * request reaches the host and sends who they are as a JWT in the `Cf-Access-Jwt-Assertion` header.
 *
 * The header is never trusted as it comes (a request could reach the host some other way, e.g. the `workers.dev`
 * address, or name the header itself). It counts only when:
 *
 * - it is a compact JWS signed RS256 (or ES256) by a key of the team's JWKS
 *   (`<teamDomain>/cdn-cgi/access/certs`, cached an hour; a token naming an unknown `kid` refetches it once, for key
 *   rotation);
 * - `iss` is the team domain, `aud` contains the configured AUD (another Access application's token is refused);
 * - `exp` is in the future and `nbf`, when present, is not (with a minute's leeway);
 * - it names a person: a `sub` and an `email`. A service token's assertion (no `sub`, a `common_name`) is no person
 *   and signs nobody in.
 *
 * The identity is `sub`, `email` (Access has checked it with its identity provider, so it counts as verified) and
 * `groups` when the token carries them (group names, or `{ name }` objects). `authenticate` (`session.ts`) turns a
 * valid assertion into a session; sign-out explains that Access keeps its own session and links to the team's
 * logout address ({@link accessLogoutUrl}).
 */

import type { AuthConfig } from '../types.ts';
import { decodeJwt, jwkFits, verifyJws, type JwtAlgorithm, type PublicJwk } from './jwt.ts';
import type { ExternalIdentity, IdentityProvider } from './provider.ts';

/** The request header Access puts its assertion in. */
export const ACCESS_JWT_HEADER = 'cf-access-jwt-assertion';
/** The provider id (identities are stored under it). */
export const CLOUDFLARE_ACCESS_PROVIDER = 'cloudflare-access';
/** How long the team's keys are kept, ms. */
export const ACCESS_KEYS_MS = 3600_000;
/** Allowed clock difference with Access, seconds. */
const SKEW_SECONDS = 60;

export type CloudflareAccessConfig = Extract<AuthConfig, { kind: 'cloudflare-access' }>;

/** The team's logout address (ends the Access session; the host's own cookie is cleared separately). */
export function accessLogoutUrl(config: Pick<CloudflareAccessConfig, 'teamDomain'>): string {
  return `${config.teamDomain}/cdn-cgi/access/logout`;
}

/** The team's key set address. */
export function accessCertsUrl(config: Pick<CloudflareAccessConfig, 'teamDomain'>): string {
  return `${config.teamDomain}/cdn-cgi/access/certs`;
}

/** Group names from a token's `groups` claim (strings, or objects with a `name`). */
function groupsOf(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const names = value
    .map((entry) => (typeof entry === 'string' ? entry : entry && typeof entry === 'object' && typeof (entry as { name?: unknown }).name === 'string' ? (entry as { name: string }).name : ''))
    .map((name) => name.trim())
    .filter((name) => name !== '' && name.length <= 200);
  return [...new Set(names)].slice(0, 100);
}

/**
 * The Access provider. `fetcher` fetches the team's keys (tests stub it); `log` hears why an assertion was refused.
 */
export function cloudflareAccessProvider(config: CloudflareAccessConfig, fetcher: typeof fetch, log?: (line: string) => void): IdentityProvider & {
  verify(token: string, nowMs: number): Promise<ExternalIdentity | null>;
} {
  let keys: { value: PublicJwk[]; at: number } | null = null;
  let loading: Promise<PublicJwk[]> | null = null;

  async function load(): Promise<PublicJwk[]> {
    const response = await fetcher(accessCertsUrl(config), { headers: { accept: 'application/json' }, redirect: 'manual' });
    if (!response.ok) throw new Error(`${accessCertsUrl(config)} answered HTTP ${response.status}`);
    const doc = (await response.json()) as { keys?: unknown };
    if (!Array.isArray(doc.keys)) throw new Error(`${accessCertsUrl(config)} is not a JWKS`);
    return doc.keys.filter((key): key is PublicJwk => typeof key === 'object' && key !== null);
  }

  async function jwks(nowMs: number, refresh: boolean): Promise<PublicJwk[]> {
    if (keys && !refresh && nowMs - keys.at < ACCESS_KEYS_MS) return keys.value;
    // One fetch at a time, however many requests ask together.
    loading ??= load().finally(() => {
      loading = null;
    });
    const value = await loading;
    keys = { value, at: nowMs };
    return value;
  }

  const pick = (list: PublicJwk[], alg: JwtAlgorithm, kid: string | undefined): PublicJwk[] => {
    const fitting = list.filter((key) => jwkFits(key, alg));
    return kid !== undefined ? fitting.filter((key) => key.kid === kid) : fitting;
  };

  const refuse = (why: string): null => {
    log?.(`cloudflare access: assertion refused (${why})`);
    return null;
  };

  async function verify(token: string, nowMs: number): Promise<ExternalIdentity | null> {
    const jwt = decodeJwt(token.trim());
    if (!jwt) return refuse('not a JWT');
    const alg = jwt.header.alg;
    if (alg !== 'RS256' && alg !== 'ES256') return refuse(`alg ${alg}`);
    let candidates: PublicJwk[];
    try {
      candidates = pick(await jwks(nowMs, false), alg, jwt.header.kid);
      if (candidates.length === 0) candidates = pick(await jwks(nowMs, true), alg, jwt.header.kid);
    } catch (error) {
      return refuse(`keys: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (candidates.length === 0) return refuse(`no key ${jwt.header.kid ?? '(no kid)'}`);
    let verified = false;
    for (const key of candidates) if ((verified = await verifyJws(jwt, key))) break;
    if (!verified) return refuse('bad signature');

    const c = jwt.claims;
    const now = Math.floor(nowMs / 1000);
    if (typeof c.iss !== 'string' || c.iss.replace(/\/+$/, '') !== config.teamDomain) return refuse('wrong iss');
    const aud = typeof c.aud === 'string' ? [c.aud] : Array.isArray(c.aud) ? c.aud.filter((a): a is string => typeof a === 'string') : [];
    if (!aud.includes(config.aud)) return refuse('wrong aud');
    if (typeof c.exp !== 'number' || c.exp + SKEW_SECONDS <= now) return refuse('expired');
    if (typeof c.nbf === 'number' && c.nbf - SKEW_SECONDS > now) return refuse('not yet valid');
    if (typeof c.sub !== 'string' || c.sub === '') return refuse('no sub (a service token?)');
    const email = typeof c.email === 'string' && c.email.includes('@') ? c.email.trim().toLowerCase() : undefined;
    if (!email) return refuse('no email');
    const groups = groupsOf(c.groups);
    const name = typeof c.name === 'string' && c.name.trim() ? c.name.trim().slice(0, 80) : undefined;
    return { provider: CLOUDFLARE_ACCESS_PROVIDER, subject: c.sub, email, emailVerified: true, ...(name ? { name } : {}), ...(groups ? { groups } : {}) };
  }

  return {
    id: CLOUDFLARE_ACCESS_PROVIDER,
    name: 'Cloudflare Access',
    async fromRequest(request, ctx) {
      const token = request.headers.get(ACCESS_JWT_HEADER);
      if (!token) return null;
      return verify(token, ctx.now().getTime());
    },
    verify,
  };
}
