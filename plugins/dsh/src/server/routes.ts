/**
 * The Artifacts page's Host routes. The page is served by the DSH app at the app's origin, and the daemon answers only
 * its own origin or its token: these routes carry the page's calls to the daemon's Library API (`/api/open-artifact.*`) with the
 * token, and answer in the page's shapes (src/shared/routes.ts). Nothing here keeps state of its own: the library, the
 * opened times and the thumbnails are the daemon's, so every harness's page sees the same.
 */
import { ensureDaemon, type EnsureDaemonOptions } from '@open-artifact/harness-kit';
import { LIBRARY_ROUTES, hostToShellOf, type ArtifactView, type DaemonState, type HostToShell, type TypeView } from '@open-artifact/protocol';
import { PATHS, SHELL_EVENT, type ArtifactList, type DeleteAnswer, type OpenAnswer, type PageArtifact, type TypeTile, type UpdateCheck } from '../shared/routes.ts';
import type { ChangelogAnswer } from '../shared/changelog.ts';
import type { DshRoute } from './dsh.ts';
import type { HostOpens } from './host-open.ts';

/** The harness name the plugin attaches its sessions with: an owner of it is a DSH session. */
export const HARNESS = 'dsh';

const NO_STORE = { 'cache-control': 'no-store' };
const json = (body: unknown, status = 200): Response => Response.json(body, { status, headers: NO_STORE });

/**
 * The version a thumbnail was taken at. The daemon names it either by the stamp itself or by a URL carrying it as `v`
 * (`/api/open-artifact.artifacts.thumbnail?id=…&v=…`).
 */
export function thumbnailStamp(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && !value.startsWith('/')) return value;
  try {
    return new URL(value, 'http://localhost').searchParams.get('v') ?? value;
  } catch {
    return value;
  }
}

/** One artifact of the daemon's library as the page reads one. */
export function pageView(a: Partial<ArtifactView>): PageArtifact {
  const created = a.createdAt ?? '';
  const owner = a.owner ?? null;
  return {
    id: a.id ?? '',
    root: a.root ?? '',
    type: a.type ?? '',
    typeTitle: a.typeTitle ?? a.type ?? '',
    sessionId: owner?.harness === HARNESS && typeof owner.session === 'string' ? owner.session : '',
    ownerStatus: owner ? (owner.live === false ? 'offline' : (owner.status ?? null)) : null,
    title: a.title ?? '',
    openedAt: a.openedAt ?? created,
    createdAt: created,
    updatedAt: a.contentAt ?? a.updatedAt ?? created,
    pinned: !!a.pinned,
    shared: !!a.shared,
    thumbnail: thumbnailStamp(a.thumbnail),
    openable: !a.typeMissing,
    viewUrl: a.view_url ?? '',
  };
}

/** The installed types a new session can make one of, as the page's tiles read them. */
export function typeTiles(types: Partial<TypeView>[]): TypeTile[] {
  return types
    .filter((t) => typeof t.id === 'string' && t.enabled !== false && t.runnable !== false && !t.shadowedBy && !(t.problems?.length))
    .map((t) => ({ id: t.id!, title: t.title || t.id!, description: t.description ?? '' }));
}

/** A failure the daemon answered with: its words, and the status the route answers with. */
export class DaemonError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'DaemonError';
    this.status = status;
  }
}

/** HTTP statuses of the daemon's error codes. */
const STATUS: Record<string, number> = { not_found: 404, invalid_argument: 400, bad_path: 400, not_granted: 403, unsupported: 409, conflict: 409 };

/** What registers a route: the app's route registry. */
export interface RouteRegistry {
  register(route: DshRoute): unknown;
}

/** Options of {@link registerRoutes}. */
export interface RouteOptions {
  /** Finds (or starts) the daemon. Default: `ensureDaemon(daemonOptions)`. */
  daemon?: () => Promise<Pick<DaemonState, 'url' | 'token'>>;
  /** Passed to `ensureDaemon` by the default `daemon`. */
  daemonOptions?: EnsureDaemonOptions;
  /** The Library API to use; made from `daemon` / `daemonOptions` when not given. */
  library?: LibraryApi;
  /** The daemon's `host.open` requests, which the browser halves follow (the host routes). */
  hostOpens?: HostOpens;
  /** Sends a browser half's host message to the Shell of a view (the shell-command route; none without it). */
  shellCommand?: (view: string, command: HostToShell) => Promise<void>;
  /** Whether this plugin has a newer release (the updates route); no route without it. */
  updates?: () => Promise<UpdateCheck>;
  /** The release notes (the changelog route); no route without it. `upcoming`: the offered release's too. */
  changelog?: (upcoming: boolean) => Promise<ChangelogAnswer>;
}

export interface ApiCall {
  method?: 'GET' | 'POST';
  query?: Record<string, string | null | undefined>;
  body?: unknown;
  /** Send `body` as these bytes of this type instead of JSON. */
  contentType?: string;
  signal?: AbortSignal;
}

/** The daemon's Library API, over HTTP with its token. */
export interface LibraryApi {
  /** One call, as the daemon's Response. A daemon that restarted (other port or token) is found again, once. */
  send(name: string, call?: ApiCall): Promise<Response>;
  /** One call: its JSON answer, or a {@link DaemonError} with its words. */
  api<T>(name: string, call?: ApiCall): Promise<T>;
}

/** The Library API of the daemon `options` finds (or starts). */
export function libraryApi(options: RouteOptions = {}): LibraryApi {
  const daemon = options.daemon ?? (() => ensureDaemon(options.daemonOptions));
  type Reached = Promise<Pick<DaemonState, 'url' | 'token'>>;
  let state: Reached | null = null;
  /**
   * The daemon, found (or started) once, and found again when a call could not use `stale`. Calls that failed on the
   * same state share one new lookup; a failed lookup is not kept.
   */
  const reach = (stale?: Reached): Reached => {
    if (state === null || (stale !== undefined && state === stale)) {
      const lookup: Reached = daemon().catch((error: unknown) => {
        if (state === lookup) state = null;
        throw error;
      });
      state = lookup;
    }
    return state;
  };

  const send = async (name: string, call: ApiCall = {}): Promise<Response> => {
    const attempt = async (s: Pick<DaemonState, 'url' | 'token'>) => {
      const url = new URL(`/api/open-artifact.${name}`, s.url);
      for (const [key, value] of Object.entries(call.query ?? {})) if (value != null && value !== '') url.searchParams.set(key, value);
      const headers: Record<string, string> = { Authorization: `Bearer ${s.token}` };
      if (call.body !== undefined) headers['Content-Type'] = call.contentType ?? 'application/json';
      return fetch(url, {
        method: call.method ?? (call.body === undefined ? 'GET' : 'POST'),
        headers,
        ...(call.body !== undefined ? { body: call.contentType ? (call.body as BodyInit) : JSON.stringify(call.body) } : {}),
        ...(call.signal ? { signal: call.signal } : {}),
      });
    };
    const current = reach();
    try {
      const response = await attempt(await current);
      // A daemon that restarted on the same port has another token: it refuses the old one.
      if (response.status !== 401 && response.status !== 403) return response;
    } catch (error) {
      if (call.signal?.aborted) throw error;
    }
    return attempt(await reach(current));
  };

  const api = async <T>(name: string, call: ApiCall = {}): Promise<T> => {
    const response = await send(name, call);
    const out = (await response.json().catch(() => ({}))) as T & { code?: string; message?: string };
    if (!response.ok) throw new DaemonError(out.message ?? `HTTP ${response.status}`, STATUS[out.code ?? ''] ?? response.status);
    return out;
  };

  return { send, api };
}

/** Registers every route the page calls. */
export function registerRoutes(routes: RouteRegistry, options: RouteOptions = {}): void {
  const { send, api } = options.library ?? libraryApi(options);

  const param = (request: Request, name: string) => new URL(request.url).searchParams.get(name) ?? '';
  const route = (path: string, methods: string[], handle: (request: Request) => Promise<Response>) =>
    routes.register({
      path,
      methods,
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          return await handle(request);
        } catch (error) {
          return json({ error: (error as Error)?.message ?? String(error) }, error instanceof DaemonError ? error.status : 502);
        }
      },
    });

  route(PATHS.list, ['GET'], async () => {
    const [list, types] = await Promise.all([
      api<{ artifacts?: ArtifactView[] }>(LIBRARY_ROUTES.artifacts),
      api<{ types?: TypeView[] }>(LIBRARY_ROUTES.types),
    ]);
    const body: ArtifactList = { artifacts: (list.artifacts ?? []).map(pageView), types: typeTiles(types.types ?? []) };
    return json(body);
  });

  route(PATHS.open, ['POST'], async (request) => {
    const id = param(request, 'id');
    // The page shows it in its session's Browser itself: the daemon's own host.open would open it a second time.
    const opened = await api<{ view_url?: string }>(LIBRARY_ROUTES.open, { body: { id, host: false } });
    const view = pageView(await api<ArtifactView>(LIBRARY_ROUTES.artifact, { query: { id } }));
    const body: OpenAnswer = { url: opened.view_url ?? view.viewUrl, sessionId: view.sessionId, title: view.title };
    return json(body);
  });

  route(PATHS.preview, ['POST'], async (request) => {
    const out = await api<{ page_url?: string }>(LIBRARY_ROUTES.preview, { body: { id: param(request, 'id') } });
    return json({ url: out.page_url ?? null });
  });

  route(PATHS.thumbnail, ['GET', 'POST'], async (request) => {
    const query = { id: param(request, 'id'), v: param(request, 'v') };
    if (request.method === 'GET') {
      const response = await send(LIBRARY_ROUTES.thumbnail, { query });
      if (!response.ok) return json({ error: 'no thumbnail yet' }, 404);
      const headers = { 'content-type': response.headers.get('content-type') ?? 'image/jpeg', 'cache-control': response.headers.get('cache-control') ?? 'no-store' };
      return new Response(await response.arrayBuffer(), { headers });
    }
    const bytes = new Uint8Array(await request.arrayBuffer());
    const saved = await api<{ thumbnail?: string }>(LIBRARY_ROUTES.thumbnail, { method: 'POST', query, body: bytes, contentType: 'image/jpeg' });
    return json({ thumbnail: thumbnailStamp(saved.thumbnail) ?? (query.v || null) });
  });

  route(PATHS.update, ['POST'], async (request) => {
    const patch = (await request.json().catch(() => ({}))) as { title?: unknown; pinned?: unknown };
    const body: { id: string; title?: string; pinned?: boolean } = { id: param(request, 'id') };
    if (typeof patch.title === 'string') body.title = patch.title;
    if (typeof patch.pinned === 'boolean') body.pinned = patch.pinned;
    return json(pageView(await api<ArtifactView>(LIBRARY_ROUTES.update, { body })));
  });

  route(PATHS.delete, ['POST'], async (request) => {
    const id = param(request, 'id');
    const out = await api<{ deleted?: string; folderKept?: string }>(LIBRARY_ROUTES.delete, { body: { id } });
    const body: DeleteAnswer = { trash: out.deleted ?? id, path: out.folderKept ?? '' };
    return json(body);
  });

  route(PATHS.restore, ['POST'], async (request) => {
    return json(pageView(await api<ArtifactView>(LIBRARY_ROUTES.restore, { body: { id: param(request, 'trash') } })));
  });

  route(PATHS.events, ['GET'], async (request) => {
    const response = await send(LIBRARY_ROUTES.events, { signal: request.signal });
    if (!response.ok || response.body === null) return json({ error: `HTTP ${response.status}` }, 502);
    return new Response(response.body, { headers: { 'content-type': 'text/event-stream', ...NO_STORE } });
  });

  const updates = options.updates;
  if (updates !== undefined) route(PATHS.updates, ['GET'], async () => json(await updates()));

  const changelog = options.changelog;
  if (changelog !== undefined) route(PATHS.changelog, ['GET'], async (request) => json(await changelog(param(request, 'upcoming') === '1')));

  const hostOpens = options.hostOpens;
  if (hostOpens === undefined) return;

  // The daemon's host.open requests, as server-sent events, for the browser halves to show (host-open.ts).
  route(PATHS.hostOpens, ['GET'], async (request) => {
    const encoder = new TextEncoder();
    let stop = () => {};
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const write = (text: string) => {
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            stop();
          }
        };
        const unlistenOpens = hostOpens.listen((open) => write(`data: ${JSON.stringify(open)}\n\n`));
        const unlistenShell = hostOpens.listenShell((event) => write(`event: ${SHELL_EVENT}\ndata: ${JSON.stringify(event)}\n\n`));
        const unlisten = () => {
          unlistenOpens();
          unlistenShell();
        };
        // A comment now and then keeps proxies and the app's fetch layer from closing a quiet stream.
        const ping = setInterval(() => write(': ping\n\n'), 25_000);
        stop = () => {
          clearInterval(ping);
          unlisten();
        };
        request.signal?.addEventListener('abort', () => {
          stop();
          try {
            controller.close();
          } catch {
            // closed already
          }
        });
        write(': open\n\n');
      },
      cancel: () => stop(),
    });
    return new Response(body, { headers: { 'content-type': 'text/event-stream', ...NO_STORE } });
  });

  route(PATHS.hostOpened, ['POST'], async (request) => {
    hostOpens.answer(param(request, 'id'), param(request, 'opened') === '1');
    return json({ ok: true });
  });

  const shellCommand = options.shellCommand;
  if (shellCommand === undefined) return;

  // A browser half's answer to the Shell of a view it shows: only the host messages a host may send.
  route(PATHS.shellCommand, ['POST'], async (request) => {
    const view = param(request, 'view');
    const command = hostToShellOf(await request.json().catch(() => null));
    if (!view || !command) return json({ error: 'A view and a host message (host_hello or goto) are needed.' }, 400);
    await shellCommand(view, command);
    return json({ ok: true });
  });
}
