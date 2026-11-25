/**
 * The owner key (decision 17): personal mode signs in with a secret.
 *
 * - `OA_OWNER_KEY` (>= 24 characters) when set. Otherwise {@link ensureOwnerKey}
 *   generates one the first time, keeps only its SHA-256 in the catalog's
 *   `site`, and hands the clear key back once for the host to print
 *   (`<app>/auth/sign-in#key=<key>`).
 * - Sign-in is a POST of the key (form fields `key`, optional `name`,
 *   `return_to`), compared in constant time.
 * - Failed attempts are counted per site in `site` (so it works on Workers
 *   too): the first {@link FREE_FAILURES} are free, then each failure locks
 *   sign-in for 30 s doubling up to an hour. While locked every attempt is
 *   refused unchecked. A success clears the count; so do 24 quiet hours.
 * - Success is the identity `owner-key`/`owner`: the site's owner user,
 *   created on first use as a site admin (see `accounts.ts`).
 */

import { randomToken, sha256Hex, timingSafeEqual } from '../crypto.ts';
import { readBody, type BaseCtx } from '../http.ts';
import { SignInError } from './errors.ts';
import { redirect, safeReturnTo } from './flow.ts';
import type { ExternalIdentity, IdentityProvider } from './provider.ts';

export const OWNER_KEY_PROVIDER = 'owner-key';
/** The subject of the one owner-key identity. */
export const OWNER_SUBJECT = 'owner';
/** `site` key of the generated key's SHA-256. */
export const OWNER_KEY_HASH = 'owner_key_hash';
/** `site` key of the failed-attempt state. */
export const OWNER_KEY_ATTEMPTS = 'owner_key_attempts';
/** Failures allowed before back-off starts. */
export const FREE_FAILURES = 5;
const BASE_LOCK_MS = 30_000;
const MAX_LOCK_MS = 3600_000;
const FORGET_MS = 24 * 3600_000;

interface Attempts {
  failures: number;
  /** ISO time of the last failure. */
  last: string | null;
  /** ISO time until which sign-in is locked. */
  lockedUntil: string | null;
}

/**
 * The generated owner key, the first time only: null when `OA_OWNER_KEY` is
 * set, the site has no owner-key sign-in, or a key was generated before.
 */
export async function ensureOwnerKey(ctx: BaseCtx): Promise<string | null> {
  if (ctx.config.ownerKey) return null;
  if (!ctx.config.auth.some((auth) => auth.kind === 'owner-key')) return null;
  if ((await ctx.catalog.getSite(OWNER_KEY_HASH)) !== undefined) return null;
  const key = randomToken(24);
  return (await ctx.catalog.insertSiteIfAbsent(OWNER_KEY_HASH, await sha256Hex(key))) ? key : null;
}

async function readAttempts(ctx: BaseCtx): Promise<Attempts> {
  const text = await ctx.catalog.getSite(OWNER_KEY_ATTEMPTS);
  if (!text) return { failures: 0, last: null, lockedUntil: null };
  try {
    const value = JSON.parse(text) as Partial<Attempts>;
    return { failures: Number(value.failures) || 0, last: value.last ?? null, lockedUntil: value.lockedUntil ?? null };
  } catch {
    return { failures: 0, last: null, lockedUntil: null };
  }
}

/** Whether `key` is the owner key (constant time; false when the site has none). */
async function keyMatches(key: string, ctx: BaseCtx): Promise<boolean> {
  const expected = ctx.config.ownerKey ? await sha256Hex(ctx.config.ownerKey) : await ctx.catalog.getSite(OWNER_KEY_HASH);
  const given = await sha256Hex(key);
  if (!expected) {
    timingSafeEqual(given, given);
    return false;
  }
  return timingSafeEqual(given, expected);
}

/** Checks a posted owner key; throws `rate_limited` or `wrong_key`. */
export async function checkOwnerKey(key: string, ctx: BaseCtx): Promise<void> {
  const now = ctx.now().getTime();
  let attempts = await readAttempts(ctx);
  if (attempts.lockedUntil && Date.parse(attempts.lockedUntil) > now) {
    throw new SignInError('rate_limited', 'owner key locked', { retryAfter: Math.ceil((Date.parse(attempts.lockedUntil) - now) / 1000) });
  }
  if (attempts.last && now - Date.parse(attempts.last) > FORGET_MS) attempts = { failures: 0, last: null, lockedUntil: null };

  if (key !== '' && (await keyMatches(key, ctx))) {
    if (attempts.failures > 0 || attempts.lockedUntil) await ctx.catalog.deleteSite(OWNER_KEY_ATTEMPTS);
    return;
  }
  const failures = attempts.failures + 1;
  const lockMs = failures >= FREE_FAILURES ? Math.min(BASE_LOCK_MS * 2 ** (failures - FREE_FAILURES), MAX_LOCK_MS) : 0;
  const next: Attempts = { failures, last: new Date(now).toISOString(), lockedUntil: lockMs > 0 ? new Date(now + lockMs).toISOString() : null };
  await ctx.catalog.setSite(OWNER_KEY_ATTEMPTS, JSON.stringify(next));
  throw new SignInError('wrong_key', `failure ${failures}`);
}

/** The posted sign-in form's fields (at most 16 KiB). */
export async function readForm(request: Request): Promise<URLSearchParams> {
  const bytes = await readBody(request, 16 * 1024);
  return new URLSearchParams(new TextDecoder().decode(bytes));
}

export function ownerKeyProvider(): IdentityProvider {
  return {
    id: OWNER_KEY_PROVIDER,
    name: 'Owner key',

    async start(_request, _ctx, returnTo) {
      return redirect(`/auth/sign-in?return_to=${encodeURIComponent(returnTo)}`);
    },

    async finish(request, ctx) {
      const form = await readForm(request);
      await checkOwnerKey((form.get('key') ?? '').trim(), ctx);
      const name = (form.get('name') ?? '').trim().slice(0, 80);
      const owner = ctx.config.owners[0];
      const identity: ExternalIdentity = {
        provider: OWNER_KEY_PROVIDER,
        subject: OWNER_SUBJECT,
        // The operator configured this address, so it counts as verified.
        ...(owner ? { email: owner, emailVerified: true } : {}),
        ...(name ? { name } : {}),
      };
      return { identity, returnTo: safeReturnTo(form.get('return_to'), ctx.config) };
    },
  };
}
