/**
 * OAuth Client ID Metadata Documents (the MCP authorization spec's preferred registration): a client's id is an
 * https URL whose JSON document describes it. The fetcher is strict, since a client id is attacker-chosen:
 *
 * - https only, a path and no fragment, user info, dot segments or non-default oddities;
 * - no private, loopback or link-local address, by name or (with a resolver) by what the name resolves to, unless
 *   the app origin is itself local (development);
 * - no redirects to another host (at most two on the same origin); a time cap and a size cap;
 * - the document's `client_id` must equal the URL exactly, its `redirect_uris` must be usable, and it must be a
 *   public client (`token_endpoint_auth_method` `none`).
 *
 * A fetched document is cached in the catalog for {@link CIMD_TTL_MS}.
 *
 * A resolver checks the addresses a name has at the time of the check; the fetch resolves the name again. A name
 * that changes its answer in between (DNS rebinding) is not caught here: the platform's egress rules are the
 * stronger guard on a public deployment.
 */

import { httpError } from '../http.ts';
import { isLocalHostname, isPrivateAddress, redirectUriProblem } from './config.ts';

/** How long a fetched document is trusted before it is fetched again. */
export const CIMD_TTL_MS = 3600_000;
/** The largest document read. */
export const CIMD_MAX_BYTES = 5 * 1024;
/** How long a fetch may take. */
export const CIMD_TIMEOUT_MS = 5000;

/** What the fetcher needs from the platform. */
export interface CimdDeps {
  /** `fetch` (tests pass a stub). */
  fetch(url: string, init: RequestInit): Promise<Response>;
  /** The addresses a host name resolves to; without it only literal addresses and local names are checked. */
  lookup?(hostname: string): Promise<string[]>;
  /** The app origin is local: private and loopback addresses are allowed. */
  allowPrivate?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
}

/** A client as its metadata document describes it. */
export interface ClientMetadata {
  clientId: string;
  name: string;
  redirectUris: string[];
  clientUri: string | null;
}

/** Whether a client id is a metadata document URL (rather than an id this host issued or was configured with). */
export function isMetadataClientId(clientId: string): boolean {
  return /^https?:\/\//i.test(clientId);
}

const refused = (message: string): Error => httpError('invalid_argument', `The client metadata document ${message}`);

/** Why a URL may not be a client id, or null. */
export function clientIdUrlProblem(value: string, allowPrivate = false): string | null {
  if (value.length > 2000) return 'URL is too long.';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'URL is not a URL.';
  }
  if (url.protocol !== 'https:') return 'URL must use https.';
  if (url.username || url.password) return 'URL may not carry a user name or password.';
  if (url.hash || value.includes('#')) return 'URL may not have a fragment.';
  if (url.pathname === '/' || url.pathname === '') return 'URL must have a path.';
  if (/(^|\/)\.\.?(\/|$)/.test(value.replace(/^https:\/\/[^/]+/i, ''))) return 'URL may not have dot segments.';
  if (url.href !== value) return 'URL must be written in its normal form.';
  if (!allowPrivate && isLocalHostname(url.hostname)) return 'URL names a private or local address.';
  return null;
}

async function readCapped(response: Response, max: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) throw refused(`is larger than ${max} bytes.`);
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    size += step.value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      throw refused(`is larger than ${max} bytes.`);
    }
    chunks.push(step.value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(out);
}

/** Fetches and checks a client's metadata document (see the module comment). Throws `invalid_argument` on any problem. */
export async function fetchClientMetadata(clientId: string, deps: CimdDeps): Promise<ClientMetadata> {
  const allowPrivate = deps.allowPrivate === true;
  const problem = clientIdUrlProblem(clientId, allowPrivate);
  if (problem) throw refused(problem);
  const timeout = deps.timeoutMs ?? CIMD_TIMEOUT_MS;
  const max = deps.maxBytes ?? CIMD_MAX_BYTES;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    let target = clientId;
    let response: Response | null = null;
    for (let hop = 0; hop <= 2; hop++) {
      const host = new URL(target).hostname;
      if (!allowPrivate && deps.lookup) {
        let addresses: string[];
        try {
          addresses = await deps.lookup(host);
        } catch {
          throw refused('host name does not resolve.');
        }
        if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a))) throw refused('host resolves to a private or local address.');
      }
      try {
        response = await deps.fetch(target, { method: 'GET', redirect: 'manual', signal: controller.signal, headers: { accept: 'application/json' }, credentials: 'omit' });
      } catch {
        throw refused(controller.signal.aborted ? `took longer than ${timeout} ms.` : 'could not be fetched.');
      }
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => undefined);
      const next = location ? new URL(location, target) : null;
      if (!next || next.origin !== new URL(clientId).origin || next.protocol !== 'https:') throw refused('redirects to another host.');
      target = next.href;
      response = null;
    }
    if (!response) throw refused('redirects too many times.');
    if (!response.ok) throw refused(`answered HTTP ${response.status}.`);
    const text = await readCapped(response, max);
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch {
      throw refused('is not JSON.');
    }
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw refused('is not a JSON object.');
    const record = doc as Record<string, unknown>;
    if (record.client_id !== clientId) throw refused('names another client_id than its own URL.');
    const uris = record.redirect_uris;
    if (!Array.isArray(uris) || uris.length === 0 || uris.length > 20) throw refused('must list 1 to 20 redirect_uris.');
    for (const uri of uris) {
      const bad = redirectUriProblem(uri);
      if (bad) throw refused(`has a redirect URI that ${bad}.`);
    }
    const method = record.token_endpoint_auth_method;
    if (method !== undefined && method !== 'none') throw refused('describes a confidential client; only public clients (token_endpoint_auth_method "none") are supported.');
    if (Array.isArray(record.grant_types) && !record.grant_types.includes('authorization_code')) throw refused('does not use the authorization_code grant.');
    const name = typeof record.client_name === 'string' ? cleanName(record.client_name) : '';
    let clientUri: string | null = null;
    if (typeof record.client_uri === 'string') {
      try {
        const url = new URL(record.client_uri);
        if (url.protocol === 'https:') clientUri = url.href;
      } catch {
        clientUri = null;
      }
    }
    return { clientId, name: name || new URL(clientId).hostname, redirectUris: uris as string[], clientUri };
  } finally {
    clearTimeout(timer);
  }
}

/** A display name a client gave: control characters out, trimmed, at most 80 characters. */
export function cleanName(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}
