/**
 * Typed helpers for the daemon's Library API (`/api/open-artifact.*`), as the Shell and
 * the home page call it from the daemon's own origin: reads are `GET`,
 * writes are `POST` with a JSON body (same-origin writes need no token).
 */

import {
  LIBRARY_ROUTES,
  type ArtifactDetail,
  type ArtifactView,
  type AskRequest,
  type CreateArtifactRequest,
  type LibraryEvent,
  type OpenArtifactErrorCode,
  type ShareRequest,
  type ShareView,
  type ShellBoot,
  type TypesNewRequest,
  type TypesNewResponse,
  type TypesResponse,
  type TypePackagePreview,
  type TypesSettingResponse,
  type UpdateArtifactRequest,
} from '@open-artifact/protocol';
import { BOOT_TIMEOUT_MS } from '../shell/preboot.ts';
import type { CloudInfo, ConnectStart, ConnectWait, PublishResult, RemoteInfo, RemotesAnswer } from './publish.ts';
import { browserEnv, sharedStream, type SharedStreamEnv } from './shared-events.ts';

/** A failed Library API call: the daemon's `{ code, message, fix? }` and the HTTP status. */
export class ApiError extends Error {
  /** The protocol error code (`not_found`, `unsupported`…). */
  readonly code: OpenArtifactErrorCode;
  /** HTTP status of the answer (0 when the request did not reach the daemon). */
  readonly status: number;
  /** What the caller can do about it, when the daemon said. */
  readonly fix: string | undefined;

  constructor(code: OpenArtifactErrorCode, message: string, status: number, fix?: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.fix = fix;
  }
}

/** The `fetch` the helpers use; tests pass a fake. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * `POST /api/open-artifact.artifacts.ask`'s answer: how the message reached the owner
 * session (`live` or `wait`: delivered; `inbox`: waits for its next turn).
 * Not in `@open-artifact/protocol` yet.
 */
export interface AskResult {
  via: 'live' | 'wait' | 'inbox' | (string & {});
  status?: string;
}

/** `POST /api/open-artifact.artifacts.delete`'s answer. Not in `@open-artifact/protocol` yet. */
export interface DeleteResult {
  deleted: string;
  /** The folder, which stays on disk. */
  folderKept: string;
}

/** `POST /api/open-artifact.artifacts.open`'s answer (used by the Shell's dev boot). Not in `@open-artifact/protocol` yet. */
export interface OpenResult {
  view_url: string;
  page: string;
  page_url: string;
  shownInHarness?: boolean;
}

/** The Library API calls the Shell and the home page make. */
export interface LibraryApi {
  /** `GET artifacts`: every artifact. */
  artifacts(): Promise<ArtifactView[]>;
  /** `GET artifact?id=`: one artifact with its folder size. */
  artifact(id: string): Promise<ArtifactDetail>;
  /** `GET types`: the installed types and their roots. */
  types(): Promise<TypesResponse>;
  /** `POST types.new`: makes a starter type (the person's own, from the home page's "New type"). */
  typesNew(request: TypesNewRequest): Promise<TypesNewResponse>;
  /** `POST types.enable` / `types.disable`: turns a type on or off. */
  typesEnable(id: string, enabled: boolean): Promise<TypesSettingResponse>;
  /** `POST types.trust`: trusts a project folder's types (or stops). */
  typesTrust(dir: string, trusted: boolean): Promise<TypesSettingResponse>;
  /** `POST types.preview`: a package read and checked (a file's bytes, or an https address), kept for the install. */
  typesPreview(request: { url: string; as?: string } | { name: string; data: string; as?: string }): Promise<TypePackagePreview>;
  /** `POST types.install`: installs the package the preview of `sha256` kept. */
  typesInstall(sha256: string, as?: string): Promise<{ id: string; version: string }>;
  /** `POST types.uninstall`: removes an installed type (its artifacts stay). */
  typesUninstall(id: string): Promise<{ id: string; removed: true }>;
  /** `POST types.update`: without `sha256`, the preview of what its source holds now; with it, installs that preview. */
  typesUpdate(id: string, sha256?: string): Promise<TypePackagePreview & { id: string }>;
  /** `GET artifact.share?id=`: sharing state; throws `unsupported` for a type that cannot share. */
  share(id: string): Promise<ShareView>;
  /** `POST artifact.share`: changes sharing and answers the new state. */
  setShare(request: ShareRequest): Promise<ShareView>;
  /** `POST artifacts.create`. */
  create(request: CreateArtifactRequest): Promise<ArtifactView>;
  /** `POST artifacts.update`: rename or pin. */
  update(request: UpdateArtifactRequest): Promise<ArtifactView>;
  /** `POST artifacts.duplicate`: the copy. */
  duplicate(id: string, name?: string): Promise<ArtifactView>;
  /** `POST artifacts.delete`: drops the record, keeps the folder. */
  remove(id: string): Promise<DeleteResult>;
  /** `POST artifacts.restore`: brings back a record just deleted (on a cloud host: takes it out of the trash). */
  restore(id: string): Promise<ArtifactView>;
  /** `GET artifacts?trashed=1` (a cloud host): the person's artifacts in the trash. */
  trashed(): Promise<ArtifactView[]>;
  /** `POST artifacts.purge` (a cloud host): deletes a trashed artifact for good; 501 where the host cannot. */
  purge(id: string): Promise<{ purged: string }>;
  /** `POST artifacts.ask`: a message to the owner agent. */
  ask(request: AskRequest): Promise<AskResult>;
  /** `POST artifacts.open`: starts the page without telling a harness. */
  open(id: string): Promise<OpenResult>;
  /**
   * `GET artifacts.boot?id=`: the Shell's finished boot, once the page is open (which can take a while: up to
   * {@link BOOT_TIMEOUT_MS}). `fresh` opens the page again instead of taking the open the Shell's page started.
   */
  boot(id: string, options?: { fresh?: boolean }): Promise<ShellBoot>;
  /** `GET remotes`: the sites this computer publishes to, what each keeps in sync, and publishing by itself (`cloud`). */
  remotes(): Promise<RemotesAnswer>;
  /** `POST cloud.settings`: the default site and whether new artifacts are published by themselves (a person's choice). */
  cloudSettings(patch: { default?: string | null; publish?: 'auto' | 'manual' }): Promise<{ cloud: CloudInfo }>;
  /** `POST remotes.add`: starts connecting a site (a code to approve there). The panel shows the approval link, so the daemon opens no browser window. */
  connect(name: string, host: string): Promise<ConnectStart>;
  /** `POST remotes.add.cancel`: stops a connect waiting for approval (the daemon stops asking the site). */
  connectCancel(name: string): Promise<{ name: string; cancelled: boolean }>;
  /** `POST remotes.add.wait`: waits up to `ms` for the approval; a refusal or a code that ran out is thrown. */
  connectWait(name: string, ms: number): Promise<ConnectWait>;
  /**
   * `POST artifacts.publish`: publishes an artifact to a site. `data: true` is the person's word that a dashboard's
   * live data goes with it (the panel says so beside Publish); without it the daemon publishes no rows.
   */
  publish(id: string, remote: string, options?: { data?: boolean }): Promise<PublishResult>;
  /** `POST artifacts.unpublish`: takes it off its site (the folder stays). */
  unpublish(id: string): Promise<{ url: string; id: string; view_url: string }>;
  /**
   * `POST artifacts.data`: a Data dashboard's live data on its site: how it stands; `publish` confirms (or takes back)
   * that its data is published with it, `refresh` runs its queries on this computer now.
   */
  dataPublish(id: string, patch?: { publish?: boolean; refresh?: boolean }): Promise<DataPublishInfo>;
  /** The URL of the event stream. */
  readonly eventsUrl: string;
  /** `GET artifact.archive?id=`: the artifact's folder as a .zip (`HEAD` checks it can be zipped). */
  archiveUrl(id: string): string;
  /** The URL of a type's icon. */
  typeIconUrl(id: string): string;
}

/** `artifacts.data`'s answer: a dashboard's live data and its site (the daemon's `DataPublishStatus`). */
export interface DataPublishInfo {
  id: string;
  /** It has live queries (their rows would be published with it). */
  live: boolean;
  queries: string[];
  /** The person confirmed that its data is published with it. */
  publish: boolean;
  published: boolean;
  /** When the published rows were taken (ISO), or `null`. */
  at: string | null;
  lastError: string | null;
  running: boolean;
  /** Minutes between refreshes while linked (`0`: only when published or asked). */
  every: number;
}

/** Options of {@link createLibraryApi}. */
export interface LibraryApiOptions {
  /** Defaults to the global `fetch`. */
  fetch?: FetchLike;
  /** Daemon base URL; empty for the page's own origin. */
  base?: string;
}

/** Reads an answer body as JSON, or `{}` when it is not JSON. */
async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await response.json();
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** How long a read (`GET`) waits for the daemon's answer. */
export const READ_TIMEOUT_MS = 15_000;

/** A Library API answer: its JSON, or an {@link ApiError} with the daemon's `{ code, message, fix }`. */
export async function answerOf<T>(response: Response): Promise<T> {
  const out = await bodyOf(response);
  if (!response.ok) {
    const code = typeof out.code === 'string' ? out.code : 'error';
    const message = typeof out.message === 'string' ? out.message : `HTTP ${response.status}`;
    throw new ApiError(code, message, response.status, typeof out.fix === 'string' ? out.fix : undefined);
  }
  return out as T;
}

/** Creates the Library API helpers. */
export function createLibraryApi(options: LibraryApiOptions = {}): LibraryApi {
  const base = (options.base ?? '').replace(/\/$/, '');
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const url = (route: string, query?: Record<string, string>): string =>
    `${base}/api/open-artifact.${route}${query ? `?${new URLSearchParams(query)}` : ''}`;

  async function call<T>(route: string, request: { query?: Record<string, string>; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
    const init: RequestInit =
      request.body === undefined
        ? { cache: 'no-store' }
        : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request.body) };
    // A read that never answers (the browser's connections to the daemon all taken, a daemon stuck) fails
    // after a while instead of leaving its caller waiting forever.
    if (request.body === undefined && typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function')
      init.signal = AbortSignal.timeout(request.timeoutMs ?? READ_TIMEOUT_MS);
    let response: Response;
    try {
      response = await doFetch(url(route, request.query), init);
    } catch (error) {
      throw new ApiError('connect_failed', error instanceof Error ? error.message : String(error), 0);
    }
    return answerOf<T>(response);
  }

  return {
    async artifacts() {
      const out = await call<{ artifacts?: ArtifactView[] }>(LIBRARY_ROUTES.artifacts);
      return Array.isArray(out.artifacts) ? out.artifacts : [];
    },
    artifact: (id) => call<ArtifactDetail>(LIBRARY_ROUTES.artifact, { query: { id } }),
    async types() {
      const out = await call<Partial<TypesResponse>>(LIBRARY_ROUTES.types);
      return { roots: Array.isArray(out.roots) ? out.roots : [], types: Array.isArray(out.types) ? out.types : [], ...(Array.isArray(out.projects) ? { projects: out.projects } : {}) };
    },
    typesNew: (request) => call<TypesNewResponse>(LIBRARY_ROUTES.typesNew, { body: request }),
    typesEnable: (id, enabled) => call<TypesSettingResponse>(enabled ? LIBRARY_ROUTES.typesEnable : LIBRARY_ROUTES.typesDisable, { body: { id } }),
    typesTrust: (dir, trusted) => call<TypesSettingResponse>(LIBRARY_ROUTES.typesTrust, { body: { dir, trusted } }),
    typesPreview: (request) => call<TypePackagePreview>(LIBRARY_ROUTES.typesPreview, { body: request }),
    typesInstall: (sha256, as) => call<{ id: string; version: string }>(LIBRARY_ROUTES.typesInstall, { body: { sha256, ...(as ? { as } : {}) } }),
    typesUninstall: (id) => call<{ id: string; removed: true }>(LIBRARY_ROUTES.typesUninstall, { body: { id } }),
    typesUpdate: (id, sha256) => call<TypePackagePreview & { id: string }>(LIBRARY_ROUTES.typesUpdate, { body: { id, ...(sha256 ? { sha256 } : {}) } }),
    share: (id) => call<ShareView>(LIBRARY_ROUTES.share, { query: { id } }),
    setShare: (request) => call<ShareView>(LIBRARY_ROUTES.share, { body: request }),
    create: (request) => call<ArtifactView>(LIBRARY_ROUTES.create, { body: request }),
    update: (request) => call<ArtifactView>(LIBRARY_ROUTES.update, { body: request }),
    duplicate: (id, name) => call<ArtifactView>(LIBRARY_ROUTES.duplicate, { body: { id, ...(name && { name }) } }),
    remove: (id) => call<DeleteResult>(LIBRARY_ROUTES.delete, { body: { id } }),
    restore: (id) => call<ArtifactView>(LIBRARY_ROUTES.restore, { body: { id } }),
    async trashed() {
      const out = await call<{ artifacts?: ArtifactView[] }>(LIBRARY_ROUTES.artifacts, { query: { trashed: '1' } });
      return Array.isArray(out.artifacts) ? out.artifacts : [];
    },
    purge: (id) => call<{ purged: string }>('artifacts.purge', { body: { id } }),
    ask: (request) => call<AskResult>(LIBRARY_ROUTES.ask, { body: request }),
    open: (id) => call<OpenResult>(LIBRARY_ROUTES.open, { body: { id, host: false } }),
    boot: (id, options) => call<ShellBoot>(LIBRARY_ROUTES.boot, { query: options?.fresh ? { id, fresh: '1' } : { id }, timeoutMs: BOOT_TIMEOUT_MS }),
    async remotes() {
      const out = await call<{ remotes?: RemoteInfo[]; cloud?: CloudInfo }>('remotes');
      const cloud = out.cloud && typeof out.cloud === 'object' && Array.isArray(out.cloud.pending) ? out.cloud : null;
      return { remotes: Array.isArray(out.remotes) ? out.remotes : [], cloud };
    },
    cloudSettings: (patch) => call<{ cloud: CloudInfo }>('cloud.settings', { body: patch }),
    connect: (name, host) => call<ConnectStart>('remotes.add', { body: { name, host, browse: false } }),
    connectCancel: (name) => call<{ name: string; cancelled: boolean }>('remotes.add.cancel', { body: { name } }),
    connectWait: (name, ms) => call<ConnectWait>('remotes.add.wait', { body: { name, ms } }),
    publish: (id, remote, options = {}) => call<PublishResult>('artifacts.publish', { body: { id, remote, ...(options.data ? { data: true } : {}) } }),
    unpublish: (id) => call<{ url: string; id: string; view_url: string }>('artifacts.unpublish', { body: { id } }),
    dataPublish: (id, patch = {}) => call<DataPublishInfo>('artifacts.data', { body: { id, ...patch } }),
    eventsUrl: url(LIBRARY_ROUTES.events),
    archiveUrl: (id) => url(LIBRARY_ROUTES.archive, { id }),
    typeIconUrl: (id) => url('type.icon', { id }),
  };
}

/** The pages' API: the daemon is their own origin. */
export const api: LibraryApi = createLibraryApi();

/** The `message` of any thrown value. */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const EVENT_TYPES = new Set(['artifacts/changed', 'types/changed', 'harness/changed', 'wake/state']);

/** One `data:` line of `/api/open-artifact.events` → the event, or `null` when it is not one. */
export function parseLibraryEvent(data: string): LibraryEvent | null {
  try {
    const value: unknown = JSON.parse(data);
    if (!value || typeof value !== 'object') return null;
    const type = (value as { type?: unknown }).type;
    return typeof type === 'string' && EVENT_TYPES.has(type) ? (value as LibraryEvent) : null;
  } catch {
    return null;
  }
}

/** The constructor {@link subscribeLibraryEvents} uses; tests pass a fake. */
export type EventSourceLike = new (url: string) => {
  onmessage: ((event: MessageEvent<string>) => void) | null;
  close(): void;
};

/**
 * Listens to the daemon's event stream (`GET /api/open-artifact.events`). Returns a
 * function that stops listening. The pages of this origin share one stream
 * (shared-events.ts), so they do not use up the browser's six connections to
 * the daemon; a given `EventSource`, or a browser without Web Locks, gets a
 * stream of its own. Without `EventSource` it does nothing.
 */
export function subscribeLibraryEvents(
  onEvent: (event: LibraryEvent) => void,
  options: { url?: string; EventSource?: EventSourceLike; shared?: SharedStreamEnv | null } = {},
): () => void {
  const url = options.url ?? api.eventsUrl;
  const onData = (data: string): void => {
    const event = parseLibraryEvent(data);
    if (event) onEvent(event);
  };
  const env = options.shared !== undefined ? options.shared : options.EventSource ? null : browserEnv();
  if (env) return sharedStream(url, env).listen(onData);
  const Source = options.EventSource ?? (typeof EventSource === 'undefined' ? null : (EventSource as unknown as EventSourceLike));
  if (!Source) return () => {};
  let source: InstanceType<EventSourceLike>;
  try {
    source = new Source(url);
  } catch {
    return () => {};
  }
  source.onmessage = (message) => onData(message.data);
  return () => source.close();
}
