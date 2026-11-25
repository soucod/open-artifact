/**
 * Cloud remotes: the hosts this daemon is linked to (`remotes.json`, mode 0600) and a client for each host's Link API
 * (`/api/open-artifact.link.*`, see the protocol's `link.ts`).
 *
 * Signing in is a device flow: the daemon asks `link.device` for a code, shows the person the approval page, and
 * polls `link.token` until they approve ({@link pollDeviceToken}). The access token it gets back is short lived;
 * {@link LinkClient} trades the refresh token for a new pair when it runs out or a route answers 401, one trade at a
 * time however many calls wait for it. A refresh token the host no longer takes means the person must sign in again:
 * calls then fail with `not signed in to <name>`.
 */

import {
  LINK_API_PREFIX,
  LINK_ROUTES,
  OpenArtifactError,
  type LinkArtifact,
  type LinkDeviceRequest,
  type LinkDeviceStart,
  type LinkEvent,
  type LinkFilesResult,
  type LinkHello,
  type LinkManifest,
  type LinkToken,
  type LinkTokenError,
  type LinkTokenRequest,
  type LinkUser,
  type LinkTypeImportResult,
  type LinkTypesResult,
  type LinkTypeUnpublishResult,
  type LinkWrite,
  type RemoteErrorCode,
  type SiteTypeVisibility,
  httpAllowance,
  PRIVATE_NETWORK_HTTP_RULE,
} from '@open-artifact/protocol';
import { files, readJson, writeJson } from './paths.ts';

/** How a remote is kept in `remotes.json`. */
export interface StoredRemote {
  /** The host's app origin, e.g. `https://artifacts.example.com`. */
  host: string;
  user: LinkUser | null;
  accessToken: string | null;
  refreshToken: string | null;
  /** When the access token runs out (ISO). */
  expiresAt: string | null;
  /** The last `link.events` event this daemon handled and acknowledged. */
  lastEventId: string | null;
  addedAt: string;
  /** Added from an install-time preset (`OPEN_ARTIFACT_REMOTE`, `preset.json`) rather than by a person. */
  preset?: boolean;
  /** SHA-256 of the preset token last tried for it: the same token is never sent twice (a refresh token works once). */
  presetToken?: string;
}

interface RemotesFileShape {
  version: 1;
  remotes: Record<string, StoredRemote>;
  /** Host origins a preset added once: not added again after the person removed the remote. */
  presetHosts?: string[];
}

/** A remote's name: what the person types after `remote add`. */
export const REMOTE_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/i;

/** Options of {@link checkHost}. */
export interface CheckHostOptions {
  /** Allow plain http for any host name (`--insecure-http`, `OPEN_ARTIFACT_REMOTE_INSECURE_HTTP=1`). */
  insecureHttp?: boolean;
}

/**
 * The warning `remote add` prints for a host reached over plain http: on a private network, a reminder; for a public
 * host name (only possible with `--insecure-http` / `OPEN_ARTIFACT_REMOTE_INSECURE_HTTP=1`), a loud one, because the
 * sign-in token and every published artifact then cross the internet in clear text.
 */
export function insecureWarning(host: string): string {
  let hostname = '';
  try {
    hostname = new URL(host).hostname;
  } catch {
    // not an origin: the stronger warning
  }
  if (httpAllowance(hostname) === 'refused') {
    return `${host} uses plain http and is NOT on this computer or a private network: it was allowed only because of --insecure-http (OPEN_ARTIFACT_REMOTE_INSECURE_HTTP=1). The sign-in token and everything published there cross the internet unencrypted, readable and changeable by anyone on the way. Use its https address instead.`;
  }
  return `${host} uses plain http: the connection is not encrypted, so use it only on a network you trust.`;
}

/**
 * A host's app origin from what the person typed. `https`, or plain `http` for a host NAME on this computer or on a
 * private network (`isPrivateNetworkHostName`: RFC 1918 / RFC 4193 / link-local addresses, `.local`, `.lan`,
 * `.home.arpa`, `.internal`, single-label names, `*.localhost`, nip.io-style names spelling a private address). The
 * name is not resolved: a public name that points at a private address is refused unless `insecureHttp`.
 */
export function checkHost(raw: unknown, options: CheckHostOptions = {}): string {
  let url: URL;
  try {
    url = new URL(String(raw ?? '').trim());
  } catch {
    throw new OpenArtifactError('invalid_argument', `Not a host address: ${JSON.stringify(raw)}. Give it as https://host.example.com.`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new OpenArtifactError('invalid_argument', `${url.origin}: a host must use https.`);
  if (url.protocol === 'http:' && !options.insecureHttp && httpAllowance(url.hostname) === 'refused') {
    throw new OpenArtifactError('invalid_argument', `${url.origin}: a host must use https (${PRIVATE_NETWORK_HTTP_RULE}).`, {
      fix: 'Use its https address. If it really is on a network you trust and has no https, add it with --insecure-http (OPEN_ARTIFACT_REMOTE_INSECURE_HTTP=1).',
    });
  }
  if (url.username || url.password) throw new OpenArtifactError('invalid_argument', 'A host address carries no user name or password.');
  return url.origin;
}

/** Whether a checked origin is reached without encryption beyond this computer (what {@link insecureWarning} is for). */
export function insecureOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.protocol === 'http:' && httpAllowance(url.hostname) !== 'loopback';
  } catch {
    return false;
  }
}

/** A remote name from a host's address: its first label (`oa.example.com` -> `oa`, `192.168.1.20` -> `192-168-1-20`), `-2`... when taken. */
export function remoteNameFor(host: string, taken: readonly string[]): string {
  let word = 'site';
  try {
    const name = new URL(host).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const label = /^[\d.]+$/.test(name) || name.includes(':') ? name.replace(/[.:]+/g, '-') : (name.split('.')[0] ?? '');
    const clean = label.replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+/, '').slice(0, 28);
    if (clean && REMOTE_NAME.test(clean)) word = clean;
  } catch {
    // not an address: the default word
  }
  const used = new Set(taken.map((n) => n.toLowerCase()));
  if (!used.has(word)) return word;
  for (let n = 2; ; n++) if (!used.has(`${word}-${n}`)) return `${word}-${n}`;
}

/** The remotes file. Read on every call (it is small and the CLI may have changed it). */
export class RemotesFile {
  private read(): RemotesFileShape {
    const raw = readJson<Partial<RemotesFileShape> | null>(files.remotes(), null);
    return {
      version: 1,
      remotes: raw?.remotes && typeof raw.remotes === 'object' ? raw.remotes : {},
      ...(Array.isArray(raw?.presetHosts) ? { presetHosts: raw.presetHosts.filter((h): h is string => typeof h === 'string') } : {}),
    };
  }

  private write(data: RemotesFileShape): void {
    writeJson(files.remotes(), data, 0o600);
  }

  /** Every remote by name. */
  list(): Record<string, StoredRemote> {
    return this.read().remotes;
  }

  get(name: string): StoredRemote | null {
    return this.read().remotes[name] ?? null;
  }

  set(name: string, remote: StoredRemote): void {
    const data = this.read();
    data.remotes[name] = remote;
    this.write(data);
  }

  /** Merges `patch` into a remote; nothing when it is gone. */
  patch(name: string, patch: Partial<StoredRemote>): StoredRemote | null {
    const data = this.read();
    const have = data.remotes[name];
    if (!have) return null;
    data.remotes[name] = { ...have, ...patch };
    this.write(data);
    return data.remotes[name]!;
  }

  remove(name: string): boolean {
    const data = this.read();
    if (!data.remotes[name]) return false;
    delete data.remotes[name];
    this.write(data);
    return true;
  }

  /** Whether a preset added a remote for this host origin before (even if it was removed since). */
  presetAdded(host: string): boolean {
    return this.read().presetHosts?.includes(host) === true;
  }

  /** Adds a remote from a preset and remembers its host, so it is added only once. */
  addPreset(name: string, remote: StoredRemote): void {
    const data = this.read();
    data.remotes[name] = remote;
    data.presetHosts = [...new Set([...(data.presetHosts ?? []), remote.host])];
    this.write(data);
  }
}

type Fetch = typeof fetch;

/** The address of a Link route on a host. */
export function linkUrl(host: string, route: string, query?: Record<string, string | undefined>): URL {
  const url = new URL(`${LINK_API_PREFIX}${route}`, host);
  for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined) url.searchParams.set(key, value);
  return url;
}

/** The statuses `fetch` would follow. */
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/**
 * Link requests carry a token (an `Authorization` header, or a refresh token or device code in the body) and are sent
 * with `redirect: 'manual'`: a redirect is never followed, so a host on `http://nas.lan` that answers with a redirect
 * to `http://evil.example` (or to its own http address from https) cannot carry the token, which `fetch` would resend
 * in a 307/308 body, to a host that `checkHost` never judged. The redirect is an error the person sees instead.
 */
function refuseRedirect(response: Response, host: string): void {
  if (response.type !== 'opaqueredirect' && !REDIRECTS.has(response.status)) return;
  void response.body?.cancel().catch(() => undefined);
  const to = response.headers.get('location');
  throw new OpenArtifactError('redirected', `${host} answered with a redirect${to ? ` to ${to}` : ''}: Link requests are not sent anywhere else, so nothing was sent there.`, {
    status: response.status,
    fix: 'If the site moved, remove this remote and add it again with its new https address.',
  });
}

/** A failure a host answered, as an error with the host's code (its body is `{code, message, fix?}`). */
async function hostError(response: Response, what: string): Promise<OpenArtifactError> {
  type Body = { code?: unknown; message?: unknown; fix?: unknown; error?: unknown; error_description?: unknown };
  const body = (await response.json().catch(() => null)) as Body | null;
  const code = typeof body?.code === 'string' ? body.code : typeof body?.error === 'string' ? body.error : response.status === 404 ? 'not_found' : response.status === 409 ? 'conflict' : response.status === 413 ? 'too_large' : response.status === 401 ? 'unauthorized' : response.status === 403 ? 'not_granted' : 'server_failed';
  const message = typeof body?.message === 'string' ? body.message : typeof body?.error_description === 'string' ? body.error_description : `${what} answered ${response.status}.`;
  return new OpenArtifactError(code, message, { status: response.status, ...(typeof body?.fix === 'string' ? { fix: body.fix } : {}) });
}

/** `POST link.device`: starts a device sign-in. */
export async function linkDevice(host: string, request: LinkDeviceRequest, fetchImpl: Fetch = fetch): Promise<LinkDeviceStart> {
  let response: Response;
  try {
    response = await fetchImpl(linkUrl(host, LINK_ROUTES.device), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new OpenArtifactError('connect_failed', `${host} is not reachable: ${(error as Error)?.message ?? error}`);
  }
  refuseRedirect(response, host);
  if (!response.ok) throw await hostError(response, `${host} link.device`);
  const start = (await response.json()) as Partial<LinkDeviceStart>;
  if (typeof start.device_code !== 'string' || typeof start.user_code !== 'string' || typeof start.verification_uri !== 'string') {
    throw new OpenArtifactError('server_failed', `${host} answered link.device without a code: is it an Open Artifact host?`);
  }
  return {
    device_code: start.device_code,
    user_code: start.user_code,
    verification_uri: start.verification_uri,
    verification_uri_complete: typeof start.verification_uri_complete === 'string' ? start.verification_uri_complete : start.verification_uri,
    expires_in: Number(start.expires_in) > 0 ? Number(start.expires_in) : 600,
    interval: Number(start.interval) > 0 ? Number(start.interval) : 5,
  };
}

/** `POST link.token`: the token, or the host's refusal (`authorization_pending`, `slow_down`, ...). */
export async function linkToken(host: string, request: LinkTokenRequest, fetchImpl: Fetch = fetch): Promise<{ token: LinkToken } | { refused: LinkTokenError; status: number }> {
  let response: Response;
  try {
    response = await fetchImpl(linkUrl(host, LINK_ROUTES.token), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    throw new OpenArtifactError('connect_failed', `${host} is not reachable: ${(error as Error)?.message ?? error}`);
  }
  refuseRedirect(response, host);
  const body = (await response.json().catch(() => null)) as (Partial<LinkToken> & Partial<LinkTokenError>) | null;
  if (response.ok && typeof body?.access_token === 'string' && typeof body.refresh_token === 'string') {
    return { token: { access_token: body.access_token, refresh_token: body.refresh_token, expires_in: Number(body.expires_in) || 3600, user: body.user ?? { id: '', name: '' } } };
  }
  if (response.status >= 500) throw new OpenArtifactError('server_failed', `${host} link.token answered ${response.status}.`);
  const error = typeof body?.error === 'string' ? body.error : 'access_denied';
  return { refused: { error: error as LinkTokenError['error'], ...(typeof body?.error_description === 'string' ? { error_description: body.error_description } : {}) }, status: response.status };
}

/** Options of {@link pollDeviceToken}. */
export interface PollOptions {
  fetch?: Fetch;
  /** Waits `ms` (tests pass one that does not). */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  signal?: AbortSignal;
  /** How much longer to wait after `slow_down`, ms (RFC 8628: 5 s). */
  slowDownMs?: number;
}

const sleepFor = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((done) => {
    const timer = setTimeout(done, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        done();
      },
      { once: true },
    );
  });

/**
 * Polls `link.token` with a device code every `interval` seconds until the person approves (the token), refuses
 * (`not_granted`) or the code runs out (`timeout`). `slow_down` makes the wait longer for the rest of the flow; a
 * host that cannot be reached is asked again at the next interval.
 */
export async function pollDeviceToken(host: string, start: LinkDeviceStart, options: PollOptions = {}): Promise<LinkToken> {
  const sleep = options.sleep ?? sleepFor;
  const now = options.now ?? Date.now;
  const deadline = now() + start.expires_in * 1000;
  let interval = Math.max(50, start.interval * 1000);
  for (;;) {
    await sleep(interval, options.signal);
    if (options.signal?.aborted) throw new OpenArtifactError('timeout', 'The sign-in was given up.');
    if (now() > deadline) throw new OpenArtifactError('timeout', 'The sign-in code ran out before it was approved. Start again.');
    let answer: Awaited<ReturnType<typeof linkToken>>;
    try {
      answer = await linkToken(host, { grant_type: 'device_code', device_code: start.device_code }, options.fetch);
    } catch (error) {
      if ((error as OpenArtifactError).code === 'connect_failed' || (error as OpenArtifactError).code === 'server_failed') continue;
      throw error;
    }
    if ('token' in answer) return answer.token;
    switch (answer.refused.error) {
      case 'authorization_pending':
        continue;
      case 'slow_down':
        interval += options.slowDownMs ?? 5000;
        continue;
      case 'expired_token':
        throw new OpenArtifactError('timeout', 'The sign-in code ran out before it was approved. Start again.');
      case 'access_denied':
        throw new OpenArtifactError('not_granted', 'The sign-in was refused on the host.');
      default:
        throw new OpenArtifactError('server_failed', `${host} refused the sign-in: ${answer.refused.error_description ?? answer.refused.error}.`);
    }
  }
}

/** What the stored remote looks like after a token answer. */
export function tokenFields(token: LinkToken, now = Date.now()): Pick<StoredRemote, 'accessToken' | 'refreshToken' | 'expiresAt' | 'user'> {
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: new Date(now + token.expires_in * 1000).toISOString(),
    user: token.user,
  };
}

/** Options of one {@link LinkClient.request}. */
export interface LinkRequest {
  method?: 'GET' | 'POST';
  query?: Record<string, string | undefined>;
  /** A JSON body. */
  json?: unknown;
  /** A raw body, with its content type. */
  body?: { bytes: Uint8Array; type: string };
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Ms before giving up (not for a stream). Default 60 s. */
  timeoutMs?: number | null;
}

/** Options of {@link LinkClient}. */
export interface LinkClientOptions {
  name: string;
  remotes: RemotesFile;
  fetch?: Fetch;
  now?: () => number;
}

/**
 * A failure as one stable code, for the Shell and `remote status --json` to act on without reading the message: the host
 * could not be reached, the person must sign in again, the id is taken there, the artifact is too large, the host
 * refused (any other 4xx), or anything else.
 */
export function remoteErrorCode(error: unknown): RemoteErrorCode {
  const code = (error as OpenArtifactError | null)?.code;
  const status = (error as OpenArtifactError | null)?.status;
  if (code === 'connect_failed' || code === 'timeout' || lostConnection(error)) return 'unreachable';
  if (code === 'unauthorized' || status === 401) return 'signed_out';
  if (code === 'conflict' || status === 409) return 'conflict';
  if (code === 'too_large' || status === 413) return 'too_large';
  if (code === 'not_granted' || code === 'forbidden' || (typeof status === 'number' && status >= 400 && status < 500)) return 'refused';
  return 'error';
}

/** Socket-level failures (Node's fetch, undici): the connection went away, timed out or was never made. */
const NETWORK_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EPIPE', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_SOCKET', 'UND_ERR_CLOSED', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT']);

/**
 * Whether a raw error is the connection failing rather than the host answering: a request cut off while its answer
 * was read (`TypeError: terminated`), a socket error, or a timeout. Requests are wrapped as `connect_failed`, but a body
 * read after the headers came is not.
 */
function lostConnection(error: unknown): boolean {
  if (!(error instanceof Error) || error instanceof OpenArtifactError) return false;
  if (error.name === 'TimeoutError') return true;
  const cause = (error as Error & { cause?: { code?: unknown } }).cause;
  const code = (error as Error & { code?: unknown }).code ?? cause?.code;
  if (typeof code === 'string' && NETWORK_CODES.has(code)) return true;
  return error.name === 'TypeError' && /^(terminated|fetch failed)$/.test(error.message);
}

/** Refresh an access token this long before it runs out. */
const REFRESH_EARLY_MS = 30_000;

/** A client of one remote's Link API, as the signed-in person. */
export class LinkClient {
  readonly name: string;
  /** The last call could not reach the host (cleared by the next one that does). */
  offline = false;
  /** The last failure, for `remote status`. */
  lastError: string | null = null;
  /** {@link lastError} as a stable code ({@link remoteErrorCode}). */
  lastCode: RemoteErrorCode | null = null;
  lastOkAt: number | null = null;
  private readonly remotes: RemotesFile;
  private readonly fetchImpl: Fetch;
  private readonly now: () => number;
  private refreshing: Promise<string> | null = null;

  constructor(options: LinkClientOptions) {
    this.name = options.name;
    this.remotes = options.remotes;
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  private stored(): StoredRemote {
    const remote = this.remotes.get(this.name);
    if (!remote) throw new OpenArtifactError('not_found', `No remote ${this.name}.`, { fix: 'open-artifact remote list shows the remotes.' });
    return remote;
  }

  /** The host's app origin. */
  get host(): string {
    return this.stored().host;
  }

  private notSignedIn(): OpenArtifactError {
    const host = this.remotes.get(this.name)?.host ?? '<host>';
    return new OpenArtifactError('unauthorized', `not signed in to ${this.name}`, { fix: `Sign in again: open-artifact remote add ${this.name} ${host}` });
  }

  /** A usable access token, refreshed first when it runs out soon. */
  private async accessToken(): Promise<string> {
    const remote = this.stored();
    const expires = remote.expiresAt ? Date.parse(remote.expiresAt) : 0;
    if (remote.accessToken && expires - REFRESH_EARLY_MS > this.now()) return remote.accessToken;
    return this.refresh(remote.accessToken);
  }

  /**
   * Trades the refresh token for a new pair. One trade at a time: callers that come while it runs share it. `stale`
   * is the access token the caller found wanting; when another trade replaced it meanwhile, the new one is used.
   */
  private refresh(stale: string | null): Promise<string> {
    if (this.refreshing) return this.refreshing;
    const current = this.remotes.get(this.name);
    if (current?.accessToken && current.accessToken !== stale && Date.parse(current.expiresAt ?? '') - REFRESH_EARLY_MS > this.now()) {
      return Promise.resolve(current.accessToken);
    }
    this.refreshing = (async () => {
      const remote = this.stored();
      if (!remote.refreshToken) throw this.notSignedIn();
      let answer: Awaited<ReturnType<typeof linkToken>>;
      try {
        answer = await linkToken(remote.host, { grant_type: 'refresh_token', refresh_token: remote.refreshToken }, this.fetchImpl);
      } catch (error) {
        this.failed(error);
        throw error;
      }
      if ('refused' in answer) {
        // The refresh token is no good any more: the person signs in again.
        this.remotes.patch(this.name, { accessToken: null, refreshToken: null, expiresAt: null });
        this.lastError = `not signed in to ${this.name}`;
        this.lastCode = 'signed_out';
        throw this.notSignedIn();
      }
      this.remotes.patch(this.name, tokenFields(answer.token, this.now()));
      return answer.token.access_token;
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private failed(error: unknown): void {
    const code = (error as OpenArtifactError)?.code;
    if (code === 'connect_failed') this.offline = true;
    this.lastError = (error as Error)?.message ?? String(error);
    this.lastCode = remoteErrorCode(error);
  }

  /** Whether the remote has tokens at all (it may still have to refresh). */
  signedIn(): boolean {
    return !!this.remotes.get(this.name)?.refreshToken;
  }

  /** Sends a request with the access token; a 401 refreshes once and tries again. Network failures are `connect_failed`. */
  async request(route: string, init: LinkRequest = {}): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const token = await this.accessToken();
      const timeout = init.timeoutMs === null ? null : AbortSignal.timeout(init.timeoutMs ?? 60_000);
      const signal = timeout && init.signal ? AbortSignal.any([timeout, init.signal]) : (timeout ?? init.signal);
      let response: Response;
      try {
        response = await this.fetchImpl(linkUrl(this.stored().host, route, init.query), {
          method: init.method ?? (init.json !== undefined || init.body ? 'POST' : 'GET'),
          headers: {
            Authorization: `Bearer ${token}`,
            ...(init.json !== undefined ? { 'Content-Type': 'application/json' } : init.body ? { 'Content-Type': init.body.type } : {}),
            ...init.headers,
          },
          ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : init.body ? { body: init.body.bytes as Uint8Array<ArrayBuffer> } : {}),
          redirect: 'manual',
          ...(signal ? { signal } : {}),
        });
      } catch (error) {
        if (init.signal?.aborted) throw error;
        const wrapped = new OpenArtifactError('connect_failed', `${this.name} (${this.stored().host}) is not reachable: ${(error as Error)?.message ?? error}`);
        this.failed(wrapped);
        throw wrapped;
      }
      this.offline = false;
      try {
        refuseRedirect(response, `${this.name} (${this.stored().host})`);
      } catch (error) {
        this.failed(error);
        throw error;
      }
      if (response.status === 401) {
        await response.body?.cancel();
        if (attempt > 0) {
          this.lastError = `not signed in to ${this.name}`;
          this.lastCode = 'signed_out';
          throw this.notSignedIn();
        }
        await this.refresh(token);
        continue;
      }
      this.lastOkAt = this.now();
      return response;
    }
  }

  /** A JSON route's answer; a failure is thrown with the host's code and message. */
  async json<T>(route: string, init: LinkRequest = {}): Promise<T> {
    const response = await this.request(route, init);
    if (!response.ok) {
      const error = await hostError(response, `${this.name} ${route}`);
      this.lastError = error.message;
      this.lastCode = remoteErrorCode(error);
      throw error;
    }
    this.lastError = null;
    this.lastCode = null;
    return (await response.json()) as T;
  }

  hello(): Promise<LinkHello> {
    return this.json<LinkHello>(LINK_ROUTES.hello);
  }

  /** `link.import`: the artifact's zip, under its own id. */
  import(zip: Uint8Array, meta: { id: string; type: string; title: string }): Promise<LinkArtifact> {
    return this.json<LinkArtifact>(LINK_ROUTES.import, { method: 'POST', query: meta, body: { bytes: zip, type: 'application/zip' }, timeoutMs: 300_000 });
  }

  manifest(id: string): Promise<LinkManifest> {
    return this.json<LinkManifest>(LINK_ROUTES.manifest, { query: { id } });
  }

  /** One file's bytes and etag; `null` when the host has no such file. */
  async readFile(id: string, path: string): Promise<{ bytes: Uint8Array; etag: string | null } | null> {
    const response = await this.request(LINK_ROUTES.files, { query: { id, path }, timeoutMs: 300_000 });
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) throw await hostError(response, `${this.name} files`);
    const etag = response.headers.get('etag');
    return { bytes: new Uint8Array(await response.arrayBuffer()), etag: etag ? etag.replace(/^W\//, '').replace(/"/g, '') : null };
  }

  /** `link.capabilities`: a page artifact's declared capabilities, on a host whose `hello` says `features.pages`. */
  setCapabilities(id: string, capabilities: Record<string, unknown>): Promise<Record<string, never>> {
    return this.json<Record<string, never>>(LINK_ROUTES.capabilities, { method: 'POST', json: { id, capabilities } });
  }

  writeFiles(id: string, writes: LinkWrite[]): Promise<LinkFilesResult> {
    return this.json<LinkFilesResult>(LINK_ROUTES.files, { method: 'POST', json: { id, writes }, timeoutMs: 300_000 });
  }

  /** The event stream after `after` (a response whose body is the stream). */
  async events(after: string | null, signal: AbortSignal): Promise<Response> {
    const response = await this.request(LINK_ROUTES.events, { query: { after: after ?? undefined }, headers: { Accept: 'text/event-stream' }, signal, timeoutMs: null });
    if (!response.ok || !response.body) throw await hostError(response, `${this.name} events`);
    return response;
  }

  async ack(ids: string[]): Promise<void> {
    await this.json<unknown>(LINK_ROUTES.ack, { method: 'POST', json: { ids } });
  }

  call(id: string, action: string, args: unknown): Promise<unknown> {
    return this.json<unknown>(LINK_ROUTES.call, { method: 'POST', json: { id, action, args }, timeoutMs: 120_000 });
  }

  async unpublish(id: string): Promise<void> {
    await this.json<unknown>(LINK_ROUTES.unpublish, { method: 'POST', json: { id } });
  }

  /** `link.types.import`: a type package to the site's catalog (`visibility` only for a new one, or to change it). */
  typesImport(bytes: Uint8Array, visibility?: SiteTypeVisibility): Promise<LinkTypeImportResult> {
    return this.json<LinkTypeImportResult>(LINK_ROUTES.typesImport, { method: 'POST', query: visibility ? { visibility } : {}, body: { bytes, type: 'application/zip' }, timeoutMs: 300_000 });
  }

  /** `link.types.list`: the site's types this person may see. */
  typesList(): Promise<LinkTypesResult> {
    return this.json<LinkTypesResult>(LINK_ROUTES.typesList);
  }

  /** `link.types.unpublish`: delisted while artifacts use it, else removed. */
  typesUnpublish(id: string): Promise<LinkTypeUnpublishResult> {
    return this.json<LinkTypeUnpublishResult>(LINK_ROUTES.typesUnpublish, { method: 'POST', json: { id } });
  }
}

/** One parsed server-sent event. */
export interface SseMessage {
  id: string | null;
  event: string | null;
  data: string;
}

/** The events of a `text/event-stream` body, as they arrive. */
export async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage> {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n?/g, '\n');
    let end: number;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let id: string | null = null;
      let event: string | null = null;
      const data: string[] = [];
      for (const line of block.split('\n')) {
        if (!line || line.startsWith(':')) continue;
        const colon = line.indexOf(':');
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
        if (field === 'id') id = value;
        else if (field === 'event') event = value;
        else if (field === 'data') data.push(value);
      }
      if (data.length) yield { id, event, data: data.join('\n') };
    }
  }
}

/** A {@link LinkEvent} from an event's data, or `null` when it is not one. */
export function parseLinkEvent(message: SseMessage): LinkEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(message.data);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const event = value as Partial<LinkEvent>;
  const id = typeof event.id === 'string' ? event.id : message.id;
  if (!id || typeof event.artifact !== 'string' || (event.type !== 'wake' && event.type !== 'files' && event.type !== 'artifact' && event.type !== 'data-refresh')) return null;
  return { ...event, id } as LinkEvent;
}
