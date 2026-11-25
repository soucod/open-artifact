/**
 * Sign-in with GitHub: the OAuth web flow (`state` in the signed flow
 * cookie), then `GET /user` and `GET /user/emails`. The email is the primary
 * one, and counts as verified only when GitHub says so.
 */

import { randomToken } from '../crypto.ts';
import type { AuthConfig } from '../types.ts';
import { SignInError } from './errors.ts';
import { callbackUrl, fetchJson, stringField } from './fetch.ts';
import { openFlow, redirect, sealFlow } from './flow.ts';
import type { ExternalIdentity, IdentityProvider } from './provider.ts';

type GithubConfig = Extract<AuthConfig, { kind: 'github' }>;

/** GitHub's addresses; overridable for GitHub Enterprise and tests. */
export interface GithubEndpoints {
  /** Where people authorize, `https://github.com`. */
  web: string;
  /** The REST API, `https://api.github.com`. */
  api: string;
}

export const GITHUB_ENDPOINTS: GithubEndpoints = { web: 'https://github.com', api: 'https://api.github.com' };

export function githubProvider(config: GithubConfig, fetcher: typeof fetch, endpoints: Partial<GithubEndpoints> = {}): IdentityProvider {
  const id = 'github';
  const web = (endpoints.web ?? GITHUB_ENDPOINTS.web).replace(/\/+$/, '');
  const api = (endpoints.api ?? GITHUB_ENDPOINTS.api).replace(/\/+$/, '');

  return {
    id,
    name: 'GitHub',

    async start(_request, ctx, returnTo) {
      const state = randomToken(16);
      const url = new URL(`${web}/login/oauth/authorize`);
      url.searchParams.set('client_id', config.clientId);
      url.searchParams.set('redirect_uri', callbackUrl(ctx.config, id));
      url.searchParams.set('scope', 'read:user user:email');
      url.searchParams.set('state', state);
      url.searchParams.set('allow_signup', 'false');
      return redirect(url.toString(), [await sealFlow({ p: id, s: state, r: returnTo }, ctx.config, ctx.now())]);
    },

    async finish(request, ctx) {
      const query = new URL(request.url).searchParams;
      const flow = await openFlow(request, id, query.get('state'), ctx.config, ctx.now());
      if (!flow) throw new SignInError('bad_state');
      const error = query.get('error');
      if (error) throw new SignInError('cancelled', error);
      const code = query.get('code');
      if (!code) throw new SignInError('provider_error', 'the callback has no code');

      try {
        const form = new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, code, redirect_uri: callbackUrl(ctx.config, id) });
        const tokens = await fetchJson(fetcher, `${web}/login/oauth/access_token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() });
        const accessToken = stringField(tokens, 'access_token');
        if (!accessToken) throw new Error(`no access token (${stringField(tokens, 'error') ?? 'unknown error'})`);
        const headers = { authorization: `Bearer ${accessToken}`, accept: 'application/vnd.github+json', 'user-agent': 'open-artifact-host' };
        const user = await fetchJson(fetcher, `${api}/user`, { headers });
        const userId = typeof user === 'object' && user !== null ? (user as { id?: unknown }).id : undefined;
        if (typeof userId !== 'number' && typeof userId !== 'string') throw new Error('GET /user has no id');
        const emails = await fetchJson(fetcher, `${api}/user/emails`, { headers });
        const primary = Array.isArray(emails)
          ? (emails as Array<{ email?: unknown; primary?: unknown; verified?: unknown }>).find((entry) => entry && entry.primary === true && typeof entry.email === 'string')
          : undefined;
        const name = stringField(user, 'name') ?? stringField(user, 'login');
        const avatar = stringField(user, 'avatar_url');
        const identity: ExternalIdentity = {
          provider: id,
          subject: String(userId),
          ...(primary ? { email: (primary.email as string).toLowerCase(), emailVerified: primary.verified === true } : {}),
          ...(name ? { name } : {}),
          ...(avatar ? { avatar } : {}),
        };
        return { identity, returnTo: flow.r };
      } catch (error) {
        throw new SignInError('provider_error', error instanceof Error ? error.message : String(error));
      }
    },
  };
}
