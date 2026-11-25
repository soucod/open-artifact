/**
 * Why a sign-in did not happen, typed so the sign-in page can explain it in
 * the visitor's language without echoing anything a provider sent.
 */

export type SignInFailure =
  /** The account exists but an admin disabled it. */
  | 'disabled'
  /** The signup policy does not let this person create an account. */
  | 'not_invited'
  /** The owner key was wrong (or the site has none). */
  | 'wrong_key'
  /** Too many wrong owner keys: wait (`retryAfter` seconds). */
  | 'rate_limited'
  /** The sign-in's `state` cookie is missing, expired or does not match: start again. */
  | 'bad_state'
  /** The person cancelled at the provider, or it refused. */
  | 'cancelled'
  /** The provider could not be reached or answered something unusable. */
  | 'provider_error'
  /** The provider's ID token failed validation. */
  | 'invalid_token'
  /** No such sign-in method on this site. */
  | 'unknown_provider'
  /** A plugin's `auth.identity` refused the person: the page shows its sentence (`plugin.sentence`). */
  | 'plugin_refused';

/** A refused or failed sign-in. `detail` is for the log only, never for a page. */
export class SignInError extends Error {
  readonly reason: SignInFailure;
  readonly detail: string | undefined;
  /** Seconds to wait, for `rate_limited`. */
  readonly retryAfter: number | undefined;
  /**
   * For `plugin_refused`: which plugin refused, and its sentence for the person (plain text the page shows inside
   * the host's own words, escaped).
   */
  readonly plugin: { id: string; sentence: string } | undefined;
  constructor(reason: SignInFailure, detail?: string, options: { retryAfter?: number; plugin?: { id: string; sentence: string } } = {}) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = 'SignInError';
    this.reason = reason;
    this.detail = detail;
    this.retryAfter = options.retryAfter;
    this.plugin = options.plugin;
  }
}

/** The HTTP status a sign-in page answers a failure with. */
export function statusOfFailure(reason: SignInFailure): number {
  switch (reason) {
    case 'disabled':
    case 'not_invited':
    case 'plugin_refused':
      return 403;
    case 'wrong_key':
      return 401;
    case 'rate_limited':
      return 429;
    case 'provider_error':
      return 502;
    case 'unknown_provider':
      return 404;
    default:
      return 400;
  }
}
