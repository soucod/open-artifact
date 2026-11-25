/**
 * Sign-in methods. Each configured `AuthConfig` becomes an
 * {@link IdentityProvider} that turns a browser round trip (or, for the owner
 * key, a posted form) into an {@link ExternalIdentity}; `accounts.ts` then
 * maps that identity to a user.
 */

import type { BaseCtx } from '../http.ts';
import type { HostConfig } from '../types.ts';
import { cloudflareAccessProvider } from './cloudflare-access.ts';
import { githubProvider, type GithubEndpoints } from './github.ts';
import { oidcProvider } from './oidc.ts';
import { ownerKeyProvider } from './owner-key.ts';

export { callbackUrl } from './fetch.ts';

/** Who a provider says someone is. */
export interface ExternalIdentity {
  /** The provider id: `owner-key`, `oidc:<id>`, `github`, `cloudflare-access`. */
  provider: string;
  /** The provider's stable id for the account. */
  subject: string;
  email?: string;
  /** Whether the provider vouches for `email`; only a verified email links accounts or satisfies a policy. */
  emailVerified?: boolean;
  name?: string;
  avatar?: string;
  /** The provider's group names, as it sent them (stored as `<provider>:<group>`). */
  groups?: string[];
}

export interface IdentityProvider {
  /** `owner-key`, `oidc:<id>`, `github`. */
  readonly id: string;
  /** Button label. */
  readonly name: string;
  /** Starts an interactive sign-in: a redirect (or a page). */
  start?(request: Request, ctx: BaseCtx, returnTo: string): Promise<Response>;
  /** Completes it: the provider's callback (or the posted form). */
  finish?(request: Request, ctx: BaseCtx): Promise<{ identity: ExternalIdentity; returnTo: string }>;
  /**
   * For platforms that sign people in before the request arrives (Cloudflare Access): the identity a request proves
   * by itself, verified, or null. `authenticate` asks it when the request has no session, and turns it into one.
   */
  fromRequest?(request: Request, ctx: BaseCtx): Promise<ExternalIdentity | null>;
}

/** What providers reach the outside world with (tests stub these). */
export interface ProviderDeps {
  /** Every outbound call (discovery, keys, token exchange, user info). */
  fetch?: typeof fetch;
  /** GitHub's addresses (GitHub Enterprise, tests). */
  github?: Partial<GithubEndpoints>;
}

/** Instances per configuration, then per `deps` object (the empty default shares one entry). */
const cache = new WeakMap<HostConfig, WeakMap<ProviderDeps, IdentityProvider[]>>();
const NO_DEPS: ProviderDeps = {};

/**
 * The providers of a configuration, in its order. The same configuration and
 * `deps` object give the same instances, so OIDC discovery and keys stay
 * cached across requests (`authRoutes` passes one `deps` object throughout).
 */
export function providersOf(config: HostConfig, deps: ProviderDeps = NO_DEPS): IdentityProvider[] {
  const key = deps.fetch || deps.github ? deps : NO_DEPS;
  let byDeps = cache.get(config);
  if (!byDeps) {
    byDeps = new WeakMap();
    cache.set(config, byDeps);
  }
  const cached = byDeps.get(key);
  if (cached) return cached;
  const fetcher = deps.fetch ?? ((input, init) => fetch(input, init));
  const providers = config.auth.map((auth): IdentityProvider => {
    switch (auth.kind) {
      case 'owner-key':
        return ownerKeyProvider();
      case 'oidc':
        return oidcProvider(auth, fetcher);
      case 'github':
        return githubProvider(auth, fetcher, deps.github);
      case 'cloudflare-access':
        return cloudflareAccessProvider(auth, fetcher);
    }
  });
  byDeps.set(key, providers);
  return providers;
}

/** The provider with this id, or undefined. */
export function providerById(config: HostConfig, id: string, deps: ProviderDeps = NO_DEPS): IdentityProvider | undefined {
  return providersOf(config, deps).find((provider) => provider.id === id);
}
