/**
 * The host's configuration from environment variables.
 *
 * `parseConfig` reads a plain record (Node passes `process.env`, Workers pass
 * `env`) and throws a {@link ConfigError} naming the variable at fault.
 *
 * | Variable | Default |
 * |---|---|
 * | `OA_APP_ORIGIN` | `http://localhost:4900` |
 * | `OA_CONTENT_ORIGIN` | `http://{id}.content.localhost:4900` |
 * | `OA_SIGNING_KEYS` | required: comma-separated, each at least 32 characters; the first signs |
 * | `OA_AUTH` | `[{"kind":"owner-key"}]` (JSON array of `AuthConfig`) |
 * | `OA_OWNERS` | none (comma-separated emails) |
 * | `OA_SIGNUP` | `invite` (`owners-only`, `invite`, `domain:<name>`, `open`) |
 * | `OA_LINK_MAX_ROLE` | `editor` |
 * | `OA_PUBLIC_ACCESS` | `true` |
 * | `OA_OWNER_KEY` | none: the owner-key sign-in secret, at least 24 characters (without it the host generates one) |
 * | `OA_OWNER_NAME` | none: the name the owner-key user starts with (`Owner`) |
 * | `OA_ALLOW_HTTP` | `false`: `true` allows plain http for any host name, not only this computer and a private network |
 * | `OA_CONTENT_SAME_SITE` | `false`: `true` lets the content origin be on the app origin's registrable domain (one domain for both) |
 * | `OA_TYPES_PUBLISH` | `admins` (`off`, `admins`, `members`): who may publish artifact types to the site; always `off` with `OA_CONTENT_SAME_SITE` |
 *
 * The content origin is on another site than the app origin (another registrable domain) unless
 * `OA_CONTENT_SAME_SITE` is on. That mode is weaker, and how is written down in `docs/hosting.md` ("One domain for
 * both"): browsers send the app's `SameSite=Lax` cookies on requests an artifact page makes, and a page may set cookies
 * for the shared parent domain. Even then the hosts stay apart: the app's host is never a content host, nor under one.
 *
 * Plain http is accepted for `OA_APP_ORIGIN` and `OA_CONTENT_ORIGIN` on this computer and on a private network, judged
 * by the name as written (`isPrivateNetworkHostName`: private addresses, `.local`, `.lan`, `.home.arpa`, `.internal`,
 * one-word names, nip.io/sslip.io names that spell a private address); anything else needs https or `OA_ALLOW_HTTP`.
 * Over http the session cookie drops its `__Host-` prefix and `Secure` flag, which browsers only keep over https.
 */

import { isPrivateNetworkHostName, PRIVATE_NETWORK_HTTP_RULE, TYPES_PUBLISH_POLICIES, type TypesPublishPolicy } from '@open-artifact/protocol';
import type { AuthConfig, HostConfig, ShareRole, SignupPolicy } from './types.ts';

export const DEFAULT_APP_ORIGIN = 'http://localhost:4900';
export const DEFAULT_CONTENT_ORIGIN = 'http://{id}.content.localhost:4900';
/** The shortest signing key accepted. */
export const MIN_SIGNING_KEY_LENGTH = 32;
/** The shortest owner key accepted (`OA_OWNER_KEY`). */
export const MIN_OWNER_KEY_LENGTH = 24;

/** A configuration mistake; `variable` is the environment variable at fault. */
export class ConfigError extends Error {
  readonly variable: string;
  constructor(variable: string, message: string) {
    super(`${variable}: ${message}`);
    this.name = 'ConfigError';
    this.variable = variable;
  }
}

/** The host configuration from environment variables. */
export function parseConfig(env: Record<string, string | undefined>): HostConfig {
  const value = (name: string): string | undefined => {
    const v = env[name]?.trim();
    return v ? v : undefined;
  };

  const allowHttp = parseBoolean('OA_ALLOW_HTTP', value('OA_ALLOW_HTTP') ?? 'false');
  const appOrigin = parseOrigin('OA_APP_ORIGIN', value('OA_APP_ORIGIN') ?? DEFAULT_APP_ORIGIN, allowHttp);
  const contentOrigin = parseContentOrigin(value('OA_CONTENT_ORIGIN') ?? DEFAULT_CONTENT_ORIGIN, allowHttp);
  const contentSameSite = parseBoolean('OA_CONTENT_SAME_SITE', value('OA_CONTENT_SAME_SITE') ?? 'false');
  const hostProblem = contentHostProblem(appOrigin, contentOrigin);
  if (hostProblem) throw new ConfigError('OA_CONTENT_ORIGIN', hostProblem);
  if (!contentSameSite && siteOf(new URL(appOrigin)) === siteOf(new URL(contentOrigin.replace('{id}', 'art-0000000000')))) {
    throw new ConfigError(
      'OA_CONTENT_ORIGIN',
      `must be a different site from OA_APP_ORIGIN (${appOrigin}), so that artifact pages cannot reach the session cookie: use another registrable domain. ` +
        `With only one domain, OA_CONTENT_SAME_SITE=true allows it, at a cost: read "One domain for both" in docs/hosting.md first.`,
    );
  }

  const keysText = value('OA_SIGNING_KEYS');
  if (!keysText) throw new ConfigError('OA_SIGNING_KEYS', `is required: one or more random secrets of at least ${MIN_SIGNING_KEY_LENGTH} characters, comma-separated (the first signs).`);
  const signingKeys = keysText.split(',').map((key) => key.trim()).filter(Boolean);
  if (signingKeys.length === 0) throw new ConfigError('OA_SIGNING_KEYS', 'lists no key.');
  if (signingKeys.some((key) => key.length < MIN_SIGNING_KEY_LENGTH)) throw new ConfigError('OA_SIGNING_KEYS', `every key must be at least ${MIN_SIGNING_KEY_LENGTH} characters.`);

  const auth = parseAuth(value('OA_AUTH'));
  const owners = (value('OA_OWNERS') ?? '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean);
  for (const email of owners) if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new ConfigError('OA_OWNERS', `"${email}" is not an email address.`);

  const signup = parseSignup(value('OA_SIGNUP') ?? 'invite');
  const linkMaxRole = value('OA_LINK_MAX_ROLE') ?? 'editor';
  if (!isShareRole(linkMaxRole)) throw new ConfigError('OA_LINK_MAX_ROLE', `must be editor, commenter or viewer, not "${linkMaxRole}".`);
  const publicAccess = parseBoolean('OA_PUBLIC_ACCESS', value('OA_PUBLIC_ACCESS') ?? 'true');

  const ownerKey = value('OA_OWNER_KEY');
  if (ownerKey !== undefined && ownerKey.length < MIN_OWNER_KEY_LENGTH) throw new ConfigError('OA_OWNER_KEY', `must be at least ${MIN_OWNER_KEY_LENGTH} characters (leave it unset and the host generates one).`);
  const ownerName = value('OA_OWNER_NAME');
  const typesPublish = parseTypesPublish(value('OA_TYPES_PUBLISH'), contentSameSite);

  return {
    appOrigin,
    contentOrigin,
    signingKeys,
    auth,
    owners,
    signup,
    linkMaxRole,
    publicAccess,
    typesPublish,
    ...(ownerKey !== undefined ? { ownerKey } : {}),
    ...(ownerName !== undefined ? { ownerName } : {}),
    ...(contentSameSite ? { contentSameSite: true } : {}),
  };
}

/**
 * Why the app's host name cannot sit beside these content hosts, or null when it can: it must not be a content host
 * itself nor a name under one (`x.art-abc.example.com`), because an artifact page could then set cookies the app reads
 * as its own and would be the app's own site. Cookies ignore ports, so the names are compared without them. (A content
 * host under the app's host, `art-abc.nas.lan` beside `nas.lan`, is the usual one-domain layout and is fine.)
 */
function contentHostProblem(appOrigin: string, contentOrigin: string): string | null {
  const app = new URL(appOrigin).hostname.toLowerCase();
  const suffix = new URL(contentOrigin.replace('{id}', 'oa-id-placeholder')).hostname.toLowerCase().slice('oa-id-placeholder'.length);
  if (!app.endsWith(suffix)) return null;
  const label = app.slice(0, app.length - suffix.length).split('.').at(-1) ?? '';
  if (!label.startsWith('art-')) return null;
  return `the app's host name (${app}) is, or is under, an artifact's content host (${label}${suffix}): an artifact page could set the app's cookies. Give the app a host name whose label next to ${suffix.slice(1)} does not start with art-.`;
}

function isShareRole(value: string): value is ShareRole {
  return value === 'editor' || value === 'commenter' || value === 'viewer';
}

function parseBoolean(variable: string, text: string): boolean {
  const lower = text.toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(lower)) return true;
  if (['false', '0', 'no', 'off'].includes(lower)) return false;
  throw new ConfigError(variable, `must be true or false, not "${text}".`);
}

function parseSignup(text: string): SignupPolicy {
  if (text === 'owners-only' || text === 'invite' || text === 'open') return text;
  if (text.startsWith('domain:')) {
    const domain = text.slice('domain:'.length).trim().toLowerCase();
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return `domain:${domain}`;
  }
  throw new ConfigError('OA_SIGNUP', `must be owners-only, invite, open or domain:<name>, not "${text}".`);
}

/** Whether a host name is one https is not required for (local development). */
function isLocalHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '127.0.0.1';
}

/** A checked origin, normalised (`https://Example.com/` → `https://example.com`); `allowHttp`: http for any name. */
function parseOrigin(variable: string, text: string, allowHttp = false): string {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new ConfigError(variable, `"${text}" is not a URL.`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new ConfigError(variable, `must be http(s), not ${url.protocol}`);
  if (url.protocol === 'http:' && !allowHttp && !isPrivateNetworkHostName(url.hostname)) {
    throw new ConfigError(
      variable,
      `must use https (${PRIVATE_NETWORK_HTTP_RULE}; OA_ALLOW_HTTP=true allows any): ${text}`,
    );
  }
  if (url.username || url.password || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
    throw new ConfigError(variable, `must be an origin only (scheme, host and port), not ${text}`);
  }
  return url.origin;
}

/** Why the content origin needs `{id}` as a host label, and the two ways to get one on a LAN. */
const ID_LABEL_HELP =
  'every artifact is served from its own host name, so pages of different artifacts cannot read each other. That needs a wildcard name: ' +
  'a wildcard DNS record (*.oa-content.lan pointing at the host, then http://{id}.oa-content.lan:4900), ' +
  'or nip.io, which answers any name spelling an address (http://{id}.192-168-1-20.nip.io:4900 for 192.168.1.20). ' +
  'A bare address such as http://192.168.1.20:4900 cannot be the content origin.';

function parseContentOrigin(text: string, allowHttp = false): string {
  const variable = 'OA_CONTENT_ORIGIN';
  const count = text.split('{id}').length - 1;
  if (count !== 1) throw new ConfigError(variable, `must contain {id} exactly once, where the artifact's host label goes (${text}): ${ID_LABEL_HELP}`);
  const match = /^(https?:\/\/)\{id\}\.([^/]+)\/?$/i.exec(text);
  if (!match) throw new ConfigError(variable, `{id} must be the first label of the host name, e.g. https://{id}.content.example.net (${text}): ${ID_LABEL_HELP}`);
  const sample = parseOrigin(variable, text.replace('{id}', 'art-0000000000'), allowHttp);
  return sample.replace('art-0000000000', '{id}');
}

/** Second-level labels under which registrations sit one level deeper (`example.co.uk`). */
const SECOND_LEVEL = new Set(['co', 'com', 'net', 'org', 'ac', 'gov', 'edu', 'ne', 'or', 'go']);

/** Suffixes of two labels under which every name is its own site (they are on the Public Suffix List, or reserved for homes). */
const TWO_LABEL_SUFFIXES = new Set(['nip.io', 'sslip.io', 'home.arpa']);

/**
 * An approximation of a URL's site (scheme + registrable domain) without the
 * Public Suffix List: the last two labels, or three under a two-letter
 * country code with a common second level (`co.uk`, `com.au`). IPs and
 * `localhost` are their own site.
 */
function siteOf(url: URL): string {
  const host = url.hostname.toLowerCase();
  if (/^[\d.]+$/.test(host) || host.startsWith('[')) return `${url.protocol}//${host}`;
  const labels = host.split('.');
  let take = 2;
  if (labels.length >= 3 && labels.at(-1)!.length === 2 && SECOND_LEVEL.has(labels.at(-2)!)) take = 3;
  if (labels.length >= 3 && TWO_LABEL_SUFFIXES.has(labels.slice(-2).join('.'))) take = 3;
  return `${url.protocol}//${labels.slice(-take).join('.')}`;
}

/** `OA_AUTH`: a JSON array of sign-in methods. */
function parseAuth(text: string | undefined): AuthConfig[] {
  const variable = 'OA_AUTH';
  if (!text) return [{ kind: 'owner-key' }];
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ConfigError(variable, 'is not JSON (expected an array such as [{"kind":"owner-key"}]).');
  }
  if (!Array.isArray(value) || value.length === 0) throw new ConfigError(variable, 'must be a non-empty JSON array of sign-in methods.');
  const ids = new Set<string>();
  return value.map((entry: unknown, index): AuthConfig => {
    const where = `entry ${index}`;
    if (typeof entry !== 'object' || entry === null) throw new ConfigError(variable, `${where} is not an object.`);
    const e = entry as Record<string, unknown>;
    const str = (key: string, required: boolean): string | undefined => {
      const v = e[key];
      if (v === undefined && !required) return undefined;
      if (typeof v !== 'string' || !v) throw new ConfigError(variable, `${where} (${String(e.kind)}) needs "${key}" as a non-empty string.`);
      return v;
    };
    let out: AuthConfig;
    switch (e.kind) {
      case 'owner-key':
        out = { kind: 'owner-key' };
        break;
      case 'github':
        out = { kind: 'github', clientId: str('clientId', true)!, clientSecret: str('clientSecret', true)! };
        break;
      case 'oidc': {
        const issuer = str('issuer', true)!;
        try {
          if (new URL(issuer).protocol !== 'https:' && !isLocalHost(new URL(issuer).hostname)) throw new Error('http');
        } catch {
          throw new ConfigError(variable, `${where} (oidc) needs "issuer" as an https URL, not ${issuer}`);
        }
        const scopes = e.scopes;
        if (scopes !== undefined && (!Array.isArray(scopes) || scopes.some((s) => typeof s !== 'string'))) throw new ConfigError(variable, `${where} (oidc) "scopes" must be an array of strings.`);
        const id = str('id', true)!;
        if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) throw new ConfigError(variable, `${where} (oidc) "id" must be lower-case letters, digits, - and _: ${id}`);
        const clientSecret = str('clientSecret', false);
        out = {
          kind: 'oidc',
          id,
          name: str('name', true)!,
          issuer,
          clientId: str('clientId', true)!,
          ...(clientSecret !== undefined ? { clientSecret } : {}),
          ...(scopes !== undefined ? { scopes: scopes as string[] } : {}),
        };
        break;
      }
      case 'cloudflare-access': {
        const raw = str('teamDomain', true)!;
        let team: URL;
        try {
          team = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
        } catch {
          throw new ConfigError(variable, `${where} (cloudflare-access) needs "teamDomain" as https://<team>.cloudflareaccess.com, not ${raw}`);
        }
        if (team.protocol !== 'https:' || team.pathname.replace(/\/+$/, '') !== '' || team.search || team.username || team.password) {
          throw new ConfigError(variable, `${where} (cloudflare-access) needs "teamDomain" as https://<team>.cloudflareaccess.com, not ${raw}`);
        }
        out = { kind: 'cloudflare-access', teamDomain: team.origin, aud: str('aud', true)! };
        break;
      }
      default:
        throw new ConfigError(variable, `${where} has an unknown kind ${JSON.stringify(e.kind)} (owner-key, oidc, github or cloudflare-access).`);
    }
    const key = out.kind === 'oidc' ? `oidc:${out.id}` : out.kind;
    if (ids.has(key)) throw new ConfigError(variable, `${where} repeats ${key}.`);
    ids.add(key);
    return out;
  });
}

/**
 * `OA_TYPES_PUBLISH`: who may publish artifact types to the site. A published type's pages run on the content origin,
 * and with one domain for both (`OA_CONTENT_SAME_SITE`) page artifacts do not run at all, so publishing is `off`
 * there whatever the variable says (the `types.import` route says why).
 */
function parseTypesPublish(raw: string | undefined, sameSite: boolean): TypesPublishPolicy {
  const v = raw?.toLowerCase();
  if (v !== undefined && !(TYPES_PUBLISH_POLICIES as readonly string[]).includes(v)) {
    throw new ConfigError('OA_TYPES_PUBLISH', `must be off, admins or members, not "${raw}".`);
  }
  if (sameSite) return 'off';
  return (v as TypesPublishPolicy | undefined) ?? 'admins';
}
