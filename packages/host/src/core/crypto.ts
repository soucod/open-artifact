/**
 * Small cryptographic helpers over WebCrypto (`crypto.subtle`, `crypto.getRandomValues`),
 * so they run unchanged on Node and on Workers.
 *
 * - Random ids and secrets are base64url.
 * - Stored secrets are SHA-256 hex.
 * - HMAC-SHA256 signs with the first of a list of keys and verifies with any of them (key rotation).
 * - AES-GCM keeps a small string readable by the host only, with a key derived (HKDF) from a signing key and a purpose.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Bytes of a string (UTF-8) or the bytes themselves. */
function bytesOf(input: string | Uint8Array): Uint8Array<ArrayBuffer> {
  if (typeof input === 'string') return encoder.encode(input);
  const copy = new Uint8Array(input.byteLength);
  copy.set(input);
  return copy;
}

/** Bytes as unpadded base64url. */
export function base64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Unpadded (or padded) base64url → bytes; `null` when it is not base64url. */
export function base64urlDecode(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(text)) return null;
  const plain = text.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  if (plain.length % 4 === 1) return null;
  try {
    const binary = atob(plain + '='.repeat((4 - (plain.length % 4)) % 4));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** `bytes` random bytes. */
export function randomBytes(bytes: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(bytes);
  crypto.getRandomValues(out);
  return out;
}

/** A random secret: `bytes` random bytes as base64url (32 bytes → 43 characters). */
export function randomToken(bytes = 32): string {
  return base64urlEncode(randomBytes(bytes));
}

/** A random id, `<prefix>_<base64url>` (no prefix: just the base64url). 16 bytes by default. */
export function randomId(prefix?: string, bytes = 16): string {
  const body = randomToken(bytes);
  return prefix ? `${prefix}_${body}` : body;
}

/** SHA-256 of a string (UTF-8) or bytes, as lower-case hex. */
export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytesOf(input)));
  let hex = '';
  for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/** Whether two strings are equal, in time that depends only on their lengths. */
export function timingSafeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  const length = Math.max(x.length, y.length);
  for (let i = 0; i < length; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// HMAC

const hmacKeys = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = hmacKeys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    if (hmacKeys.size > 32) hmacKeys.clear();
    hmacKeys.set(secret, key);
  }
  return key;
}

function assertKeys(keys: readonly string[]): void {
  if (keys.length === 0 || keys.some((key) => key.length === 0)) throw new TypeError('No signing key: pass at least one non-empty key.');
}

/** HMAC-SHA256 of `data` with the first key, as base64url. */
export async function hmacSign(data: string | Uint8Array, keys: readonly string[]): Promise<string> {
  assertKeys(keys);
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(keys[0]!), bytesOf(data));
  return base64urlEncode(new Uint8Array(signature));
}

/** Whether `signature` (base64url) is the HMAC-SHA256 of `data` under any of the keys. */
export async function hmacVerify(data: string | Uint8Array, signature: string, keys: readonly string[]): Promise<boolean> {
  assertKeys(keys);
  const given = base64urlDecode(signature);
  if (!given || given.length !== 32) return false;
  const bytes = bytesOf(data);
  for (const secret of keys) {
    // `subtle.verify` compares in constant time.
    if (await crypto.subtle.verify('HMAC', await hmacKey(secret), given, bytes)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// AES-GCM

const SEALED_PREFIX = 'v1.';
const HKDF_SALT = encoder.encode('open-artifact-host');

async function aesKey(secret: string, purpose: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: encoder.encode(purpose) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypts a small string with AES-GCM under a key derived from the first signing key and `purpose`
 * (different purposes never share a key). The result is `v1.<iv>.<ciphertext>`, base64url.
 */
export async function encryptString(plain: string, keys: readonly string[], purpose: string): Promise<string> {
  assertKeys(keys);
  const iv = randomBytes(12);
  const sealed = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(keys[0]!, purpose), encoder.encode(plain));
  return `${SEALED_PREFIX}${base64urlEncode(iv)}.${base64urlEncode(new Uint8Array(sealed))}`;
}

/** The string {@link encryptString} encrypted, trying each key; `null` when no key and purpose open it or it is malformed. */
export async function decryptString(sealed: string, keys: readonly string[], purpose: string): Promise<string | null> {
  assertKeys(keys);
  if (!sealed.startsWith(SEALED_PREFIX)) return null;
  const [ivText, bodyText, extra] = sealed.slice(SEALED_PREFIX.length).split('.');
  if (ivText === undefined || bodyText === undefined || extra !== undefined) return null;
  const iv = base64urlDecode(ivText);
  const body = base64urlDecode(bodyText);
  if (!iv || iv.length !== 12 || !body) return null;
  for (const secret of keys) {
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await aesKey(secret, purpose), body);
      return decoder.decode(plain);
    } catch {
      // Not this key: try the next.
    }
  }
  return null;
}
