/**
 * The pieces every interactive sign-in shares: where to go afterwards
 * (`return_to`, same-origin paths only) and the short-lived, signed, HttpOnly
 * cookie that carries a redirect sign-in's `state`, `nonce` and PKCE verifier
 * from its start to its callback.
 */

import { base64urlDecode, base64urlEncode, hmacSign, hmacVerify, timingSafeEqual } from '../crypto.ts';
import { parseCookies, serializeCookie, type CookieOptions } from '../http.ts';
import type { HostConfig } from '../types.ts';

/** How long a started sign-in may take: 10 minutes. */
export const FLOW_TTL_SECONDS = 600;

/**
 * A `return_to` that cannot leave the app origin: a path that starts with one
 * `/` (not `//`, no backslash, no control characters, no scheme), resolved
 * against the app origin and still on it. Anything else, or nothing, is `/`.
 */
export function safeReturnTo(value: string | null | undefined, config: Pick<HostConfig, 'appOrigin'>): string {
  if (!value || value.length > 2048) return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  if (/[\u0000-\u001f\u007f]/.test(value)) return '/';
  let url: URL;
  try {
    url = new URL(value, config.appOrigin);
  } catch {
    return '/';
  }
  if (url.origin !== config.appOrigin) return '/';
  return `${url.pathname}${url.search}${url.hash}`;
}

/** What a redirect sign-in remembers between its start and its callback. */
export interface FlowState {
  /** The provider id. */
  p: string;
  /** OAuth `state`. */
  s: string;
  /** OIDC `nonce`. */
  n?: string;
  /** PKCE code verifier. */
  v?: string;
  /** Where to go afterwards (already checked). */
  r: string;
  /** Unix seconds. */
  exp: number;
}

/** The flow cookie: `__Host-oa_flow` on https, `oa_flow` on http; Path=/, HttpOnly, SameSite=Lax (it must come back on the provider's top-level redirect). */
export function flowCookie(config: Pick<HostConfig, 'appOrigin'>): { name: string; options: CookieOptions } {
  const secure = config.appOrigin.startsWith('https:');
  return { name: secure ? '__Host-oa_flow' : 'oa_flow', options: { path: '/', secure, httpOnly: true, sameSite: 'Lax' } };
}

const FLOW_PURPOSE = 'oa-flow.';

/** A `Set-Cookie` value carrying a started sign-in. */
export async function sealFlow(state: Omit<FlowState, 'exp'>, config: Pick<HostConfig, 'appOrigin' | 'signingKeys'>, now: Date): Promise<string> {
  const payload = base64urlEncode(new TextEncoder().encode(JSON.stringify({ ...state, exp: Math.floor(now.getTime() / 1000) + FLOW_TTL_SECONDS })));
  const signature = await hmacSign(FLOW_PURPOSE + payload, config.signingKeys);
  const { name, options } = flowCookie(config);
  return serializeCookie(name, `${payload}.${signature}`, { ...options, maxAge: FLOW_TTL_SECONDS });
}

/** A `Set-Cookie` value that deletes the flow cookie. */
export function clearFlow(config: Pick<HostConfig, 'appOrigin'>): string {
  const { name, options } = flowCookie(config);
  return serializeCookie(name, '', { ...options, maxAge: 0 });
}

/**
 * The started sign-in for `provider` whose `state` is `state`, or null when the
 * cookie is missing, forged, expired, for another provider or another state.
 */
export async function openFlow(request: Request, provider: string, state: string | null, config: Pick<HostConfig, 'appOrigin' | 'signingKeys'>, now: Date): Promise<FlowState | null> {
  if (!state) return null;
  const raw = parseCookies(request.headers.get('cookie'))[flowCookie(config).name];
  if (!raw) return null;
  const dot = raw.indexOf('.');
  if (dot <= 0) return null;
  const payload = raw.slice(0, dot);
  if (!(await hmacVerify(FLOW_PURPOSE + payload, raw.slice(dot + 1), config.signingKeys))) return null;
  const bytes = base64urlDecode(payload);
  if (!bytes) return null;
  let flow: FlowState;
  try {
    flow = JSON.parse(new TextDecoder().decode(bytes)) as FlowState;
  } catch {
    return null;
  }
  if (typeof flow !== 'object' || flow === null || typeof flow.s !== 'string' || typeof flow.r !== 'string' || typeof flow.exp !== 'number') return null;
  if (flow.p !== provider) return null;
  if (flow.exp <= Math.floor(now.getTime() / 1000)) return null;
  if (!timingSafeEqual(flow.s, state)) return null;
  return { ...flow, r: safeReturnTo(flow.r, config) };
}

/** Base64url SHA-256 of a PKCE verifier (the S256 challenge). */
export async function pkceChallenge(verifier: string): Promise<string> {
  return base64urlEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
}

/** A 303 to `location` with cookies. */
export function redirect(location: string, cookies: readonly string[] = []): Response {
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  return new Response(null, { status: 303, headers });
}
