/**
 * Generic OpenID Connect sign-in: discovery, authorization code with PKCE
 * (S256), `state` and `nonce` in the signed flow cookie, the token exchange
 * (`client_secret_post`, or a public client without a secret), and the ID
 * token checked with WebCrypto against the issuer's JWKS (RS256, ES256;
 * `iss`, `aud`, `azp`, `exp`, `nbf`, `nonce`).
 *
 * Discovery and keys are cached on the provider instance (an hour); an ID
 * token naming an unknown `kid` refetches the keys once (key rotation).
 */

import { randomToken } from '../crypto.ts';
import type { AuthConfig } from '../types.ts';
import { SignInError } from './errors.ts';
import { callbackUrl, fetchJson, stringField } from './fetch.ts';
import { openFlow, pkceChallenge, redirect, sealFlow } from './flow.ts';
import { decodeJwt, jwkFits, verifyJws, type JwtAlgorithm, type PublicJwk } from './jwt.ts';
import type { ExternalIdentity, IdentityProvider } from './provider.ts';

type OidcConfig = Extract<AuthConfig, { kind: 'oidc' }>;

interface Discovery {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
}

const CACHE_MS = 3600_000;
/** Allowed clock difference with the issuer. */
const SKEW_SECONDS = 60;

const trimSlash = (url: string): string => url.replace(/\/+$/, '');

export function oidcProvider(config: OidcConfig, fetcher: typeof fetch): IdentityProvider {
  const id = `oidc:${config.id}`;
  let discovery: { value: Discovery; at: number } | null = null;
  let keys: { value: PublicJwk[]; at: number } | null = null;

  async function discover(now: number): Promise<Discovery> {
    if (discovery && now - discovery.at < CACHE_MS) return discovery.value;
    const url = `${trimSlash(config.issuer)}/.well-known/openid-configuration`;
    const doc = await fetchJson(fetcher, url);
    const issuer = stringField(doc, 'issuer');
    const authorizationEndpoint = stringField(doc, 'authorization_endpoint');
    const tokenEndpoint = stringField(doc, 'token_endpoint');
    const jwksUri = stringField(doc, 'jwks_uri');
    if (!issuer || !authorizationEndpoint || !tokenEndpoint || !jwksUri) throw new Error(`${url} lacks issuer, authorization_endpoint, token_endpoint or jwks_uri`);
    if (trimSlash(issuer) !== trimSlash(config.issuer)) throw new Error(`${url} names another issuer (${issuer})`);
    const value = { issuer, authorizationEndpoint, tokenEndpoint, jwksUri };
    discovery = { value, at: now };
    return value;
  }

  async function jwks(uri: string, now: number, refresh: boolean): Promise<PublicJwk[]> {
    if (keys && !refresh && now - keys.at < CACHE_MS) return keys.value;
    const doc = await fetchJson(fetcher, uri);
    const list = typeof doc === 'object' && doc !== null ? (doc as { keys?: unknown }).keys : undefined;
    if (!Array.isArray(list)) throw new Error(`${uri} is not a JWKS`);
    const value = list.filter((key): key is PublicJwk => typeof key === 'object' && key !== null);
    keys = { value, at: now };
    return value;
  }

  /** The key that should verify a token: by `kid`, else the only fitting one. Null when none. */
  function pick(list: PublicJwk[], alg: JwtAlgorithm, kid: string | undefined): PublicJwk[] {
    const fitting = list.filter((key) => jwkFits(key, alg));
    return kid !== undefined ? fitting.filter((key) => key.kid === kid) : fitting;
  }

  async function failing<T>(step: () => Promise<T>): Promise<T> {
    try {
      return await step();
    } catch (error) {
      if (error instanceof SignInError) throw error;
      throw new SignInError('provider_error', error instanceof Error ? error.message : String(error));
    }
  }

  return {
    id,
    name: config.name,

    async start(_request, ctx, returnTo) {
      const doc = await failing(() => discover(ctx.now().getTime()));
      const state = randomToken(16);
      const nonce = randomToken(16);
      const verifier = randomToken(32);
      const url = new URL(doc.authorizationEndpoint);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', config.clientId);
      url.searchParams.set('redirect_uri', callbackUrl(ctx.config, id));
      url.searchParams.set('scope', (config.scopes ?? ['openid', 'email', 'profile']).join(' '));
      url.searchParams.set('state', state);
      url.searchParams.set('nonce', nonce);
      url.searchParams.set('code_challenge', await pkceChallenge(verifier));
      url.searchParams.set('code_challenge_method', 'S256');
      return redirect(url.toString(), [await sealFlow({ p: id, s: state, n: nonce, v: verifier, r: returnTo }, ctx.config, ctx.now())]);
    },

    async finish(request, ctx) {
      const query = new URL(request.url).searchParams;
      const flow = await openFlow(request, id, query.get('state'), ctx.config, ctx.now());
      if (!flow || !flow.n || !flow.v) throw new SignInError('bad_state');
      const error = query.get('error');
      if (error) throw new SignInError('cancelled', error);
      const code = query.get('code');
      if (!code) throw new SignInError('provider_error', 'the callback has no code');

      const nowMs = ctx.now().getTime();
      const doc = await failing(() => discover(nowMs));
      const form = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: callbackUrl(ctx.config, id), client_id: config.clientId, code_verifier: flow.v });
      if (config.clientSecret) form.set('client_secret', config.clientSecret);
      const tokens = await failing(() => fetchJson(fetcher, doc.tokenEndpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() }));
      const idToken = stringField(tokens, 'id_token');
      if (!idToken) throw new SignInError('provider_error', 'the token answer has no id_token');

      const jwt = decodeJwt(idToken);
      if (!jwt) throw new SignInError('invalid_token', 'not a JWT');
      const alg = jwt.header.alg;
      if (alg !== 'RS256' && alg !== 'ES256') throw new SignInError('invalid_token', `unsupported alg ${alg}`);
      let candidates = pick(await failing(() => jwks(doc.jwksUri, nowMs, false)), alg, jwt.header.kid);
      if (candidates.length === 0) candidates = pick(await failing(() => jwks(doc.jwksUri, nowMs, true)), alg, jwt.header.kid);
      if (candidates.length === 0) throw new SignInError('invalid_token', `no key ${jwt.header.kid ?? '(no kid)'} for ${alg}`);
      let verified = false;
      for (const key of candidates) if ((verified = await verifyJws(jwt, key))) break;
      if (!verified) throw new SignInError('invalid_token', 'bad signature');

      const c = jwt.claims;
      const now = Math.floor(nowMs / 1000);
      if (typeof c.iss !== 'string' || trimSlash(c.iss) !== trimSlash(doc.issuer)) throw new SignInError('invalid_token', 'wrong iss');
      const aud = typeof c.aud === 'string' ? [c.aud] : Array.isArray(c.aud) ? c.aud.filter((a): a is string => typeof a === 'string') : [];
      if (!aud.includes(config.clientId)) throw new SignInError('invalid_token', 'wrong aud');
      if (aud.length > 1 && c.azp !== config.clientId) throw new SignInError('invalid_token', 'wrong azp');
      if (typeof c.exp !== 'number' || c.exp + SKEW_SECONDS <= now) throw new SignInError('invalid_token', 'expired');
      if (typeof c.nbf === 'number' && c.nbf - SKEW_SECONDS > now) throw new SignInError('invalid_token', 'not yet valid');
      if (typeof c.nonce !== 'string' || c.nonce !== flow.n) throw new SignInError('invalid_token', 'wrong nonce');
      if (typeof c.sub !== 'string' || c.sub === '') throw new SignInError('invalid_token', 'no sub');

      const email = typeof c.email === 'string' && c.email.includes('@') ? c.email.trim().toLowerCase() : undefined;
      const groups = Array.isArray(c.groups) ? c.groups.filter((g): g is string => typeof g === 'string' && g !== '') : typeof c.groups === 'string' && c.groups ? [c.groups] : undefined;
      const name = stringField(c, 'name') ?? stringField(c, 'preferred_username');
      const avatar = stringField(c, 'picture');
      const identity: ExternalIdentity = {
        provider: id,
        subject: c.sub,
        ...(email ? { email, emailVerified: c.email_verified === true || c.email_verified === 'true' } : {}),
        ...(name ? { name } : {}),
        ...(avatar ? { avatar } : {}),
        ...(groups ? { groups } : {}),
      };
      return { identity, returnTo: flow.r };
    },
  };
}
