/**
 * Just enough JWS to check an OpenID Connect ID token with WebCrypto:
 * compact serialization, RS256 and ES256, keys from a JWKS.
 */

import { base64urlDecode } from '../crypto.ts';

export type JwtAlgorithm = 'RS256' | 'ES256';

export interface DecodedJwt {
  header: { alg: string; kid?: string; typ?: string };
  claims: Record<string, unknown>;
  /** `<header>.<payload>`, the signed bytes. */
  signingInput: string;
  signature: Uint8Array<ArrayBuffer>;
}

/** A JWK as published in a JWKS (the fields this module reads). */
export interface PublicJwk {
  kty?: string;
  kid?: string;
  alg?: string;
  use?: string;
  crv?: string;
  n?: string;
  e?: string;
  x?: string;
  y?: string;
}

function decodeJson(part: string): Record<string, unknown> | null {
  const bytes = base64urlDecode(part);
  if (!bytes) return null;
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The parts of a compact JWS, or null when it is not one. */
export function decodeJwt(token: string): DecodedJwt | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  const header = decodeJson(h);
  const claims = decodeJson(p);
  const signature = base64urlDecode(s);
  if (!header || !claims || !signature || typeof header.alg !== 'string') return null;
  return {
    header: { alg: header.alg, ...(typeof header.kid === 'string' ? { kid: header.kid } : {}), ...(typeof header.typ === 'string' ? { typ: header.typ } : {}) },
    claims,
    signingInput: `${h}.${p}`,
    signature,
  };
}

/** Whether a JWK can verify `alg`. */
export function jwkFits(jwk: PublicJwk, alg: JwtAlgorithm): boolean {
  if (jwk.use !== undefined && jwk.use !== 'sig') return false;
  if (jwk.alg !== undefined && jwk.alg !== alg) return false;
  if (alg === 'RS256') return jwk.kty === 'RSA' && typeof jwk.n === 'string' && typeof jwk.e === 'string';
  return jwk.kty === 'EC' && jwk.crv === 'P-256' && typeof jwk.x === 'string' && typeof jwk.y === 'string';
}

/** Whether `jwt`'s signature verifies under `jwk` with the algorithm its header names. */
export async function verifyJws(jwt: DecodedJwt, jwk: PublicJwk): Promise<boolean> {
  const alg = jwt.header.alg;
  if (alg !== 'RS256' && alg !== 'ES256') return false;
  if (!jwkFits(jwk, alg)) return false;
  const data = new TextEncoder().encode(jwt.signingInput);
  try {
    if (alg === 'RS256') {
      const key = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
      return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, jwt.signature, data);
    }
    // JWS ES256 signatures are raw r||s, which is what WebCrypto's ECDSA takes.
    if (jwt.signature.length !== 64) return false;
    const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, jwt.signature, data);
  } catch {
    return false;
  }
}
