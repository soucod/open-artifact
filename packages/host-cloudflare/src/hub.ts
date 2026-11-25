/**
 * The site hub: one Durable Object for the deployment (`idFromName('hub')`) where the host's in-process events meet.
 *
 * The Node host is one process: a write emits a `HostEvents` event and the Library streams in the same process hear
 * it. A Worker has no such process, so the hub is it:
 *
 * - Its own {@link HostEvents}. The Worker and the artifacts' objects call `emit` (`POST /emit`, {@link HubClient});
 *   every listener in the hub hears it.
 * - The Library's event stream (`GET /api/open-artifact.events`, the core's `eventRoutes`) is served from inside the
 *   hub: the Worker forwards the browser's request, the hub authenticates it against D1 and listens. An idle stream
 *   is written an SSE comment every {@link STREAM_HEARTBEAT_MS}: that write is how a client that left is noticed (the
 *   abort signal of a forwarded request does not always reach an object), and its listeners go.
 * - The Link's event stream (`GET /api/open-artifact.link.events`, the core's `linkApiRoutes`) is served here too, for
 *   the same reason: the Worker forwards the daemon's request (its Bearer token), the hub authenticates it and sends
 *   the user's outbox rows, with the core's own delivery (the atomic `claimOutbox` of a wake, redelivery of what was
 *   not acknowledged, every open connection of a user pumped on each `outbox` event). The same heartbeat ends a
 *   stream whose daemon left.
 * - The outbox feed (`startLinkFeed`): people's edits (`artifact-touched`, `artifact-changed`) become outbox rows for
 *   a linked owner, as in the Node host. The Link's own pushes carry the author `agent` and are not fed back.
 * - A presence registry (`POST /presence`, `GET /presence?user=&room=`): which users have an agent connected over Link
 *   (the Link streams above count themselves in); the rooms read it for the page's agent status. A room that asks
 *   names itself, and when the user's answer flips the hub calls each such room (`agent-changed`, {@link
 *   SiteHubOptions.notifyRoom}) so its pages hear at once; a room whose artifact closed says so (`POST
 *   /presence/forget`) and is not called again until it asks again. That list is in memory: a hub evicted forgets it,
 *   and rooms fall back to re-asking after their short cache ({@link PRESENCE_MS} in `room-host.ts`) when a page asks.
 *
 * - A registry of awake rooms whose roles a plugin decides (`POST /rooms/awake`, dropped by `/presence/forget`): when a
 *   plugin forgets every cached role (`ctx.host.access.invalidate()`), `POST /rooms/refresh` asks each of them, and
 *   each room that asked about presence, to work its pages' roles out again ({@link SiteHubOptions.refreshRoom}).
 *
 * Eviction or a redeploy ends the hub's instance: its streams close, and browsers' `EventSource` reconnects (the
 * Library then reads its list again, as after any reconnect). Nothing is lost that matters: wakes are in the D1 outbox,
 * the presence registry refills as Links reconnect (a Link whose stream closed reconnects too).
 */

import { LINK_API_PREFIX, LINK_ROUTES } from '@open-artifact/protocol';
import {
  AccessCache,
  Catalog,
  HostEvents,
  LinkPresenceCounter,
  Router,
  eventRoutes,
  errorResponse,
  httpError,
  linkApiRoutes,
  startLinkFeed,
  type EventStreamCtx,
  type HostConfig,
  type HostEventMap,
  type HostEventName,
  type LinkServices,
} from '@open-artifact/host';
import type { FetchStub } from './room-calls.ts';
import type { HubLink } from './room-host.ts';

/** How often an idle Library stream is written a comment, ms. */
export const STREAM_HEARTBEAT_MS = 5_000;
/** Marks a request as a call of the Worker or an object to the hub (never forwarded from a browser). */
export const HUB_CALL_HEADER = 'x-open-artifact-hub-call';
/** The Library stream's path (forwarded to the hub). */
export const EVENTS_PATH = '/api/open-artifact.events';
/** The Link's event stream's path (forwarded to the hub). */
export const LINK_EVENTS_PATH = `${LINK_API_PREFIX}${LINK_ROUTES.events}`;
const BASE = 'https://hub.internal/';

const EVENT_NAMES: ReadonlySet<string> = new Set<HostEventName>(['artifact-touched', 'artifact-changed', 'access-changed', 'outbox', 'agent-changed']);

export interface SiteHubOptions {
  config: HostConfig;
  /** The catalog (migrated). */
  catalog: () => Promise<Catalog>;
  now?: () => Date;
  log?: (line: string) => void;
  heartbeatMs?: number;
  /** The host's version (the Link routes' services). */
  version?: string;
  /** Run the outbox feed of people's edits (default true). */
  linkFeed?: boolean;
  /** Tells an artifact's room that its owner's agent came or went (the product: the room's `agent-changed` call). */
  notifyRoom?: (artifactId: string) => Promise<void>;
  /** Asks an artifact's room to drop the pages whose role moved (the product: the room's `refresh` call). */
  refreshRoom?: (artifactId: string) => Promise<unknown>;
}

/** What the hub reports. */
export interface HubStats {
  streams: number;
  listeners: Record<HostEventName, number>;
  online: number;
  /** Link event streams open. */
  links: number;
  emitted: number;
  /** Rooms told of their owner's presence changes. */
  watchingRooms: number;
  /** Rooms told so far. */
  notified: number;
  /** Rooms whose roles a plugin decides that said they are awake. */
  awakeRooms: number;
}

export class SiteHub {
  readonly events: HostEvents;
  readonly #options: SiteHubOptions;
  readonly #router = new Router<EventStreamCtx>();
  readonly #access: Promise<AccessCache>;
  /** user id → the connection keys that hold them online. */
  readonly #online = new Map<string, Set<string>>();
  /** Users with a Link event stream open here. */
  readonly #links = new LinkPresenceCounter();
  /** user id → the rooms (artifact ids) that asked about them, and room → its user. */
  readonly #watchers = new Map<string, Set<string>>();
  readonly #roomUser = new Map<string, string>();
  /** Rooms with pages open whose roles a plugin decides (see the module comment). */
  readonly #awake = new Set<string>();
  #notified = 0;
  /** Settles once the outbox feed listens: an `emit` call waits for it, so no edit is missed while the hub starts. */
  readonly #feed: Promise<void>;
  #streams = 0;
  #linkStreams = 0;
  #emitted = 0;

  constructor(options: SiteHubOptions) {
    this.#options = options;
    const log = options.log ?? ((line: string) => console.log(line));
    this.events = new HostEvents({ onError: (error, name) => log(`hub event ${name}: ${error instanceof Error ? error.message : String(error)}`) });
    this.#access = options.catalog().then((catalog) => new AccessCache(catalog, options.config, { groupsOf: (id) => catalog.userGroups(id), ...(options.now ? { now: options.now } : {}) }));
    this.#access.catch(() => undefined);
    eventRoutes(this.#router);
    linkApiRoutes(this.#router, this.#linkServices(options.version ?? '0.0.0'));
    this.#feed =
      options.linkFeed === false
        ? Promise.resolve()
        : options.catalog().then(
            (catalog) => {
              startLinkFeed({ catalog, events: this.events, log });
            },
            (error: unknown) => log(`hub: the outbox feed did not start: ${error instanceof Error ? error.message : String(error)}`),
          );
  }

  /** The Link services the hub's event stream uses: presence and events; it serves no other Link route. */
  #linkServices(version: string): LinkServices {
    const elsewhere = (): never => {
      throw httpError('not_found', 'The hub serves only the Link event stream.', { status: 404 });
    };
    return {
      files: { manifest: elsewhere, read: elsewhere, write: elsewhere },
      importArchive: elsewhere,
      removeArtifact: elsewhere,
      archive: elsewhere,
      action: elsewhere,
      contentTitle: elsewhere,
      refreshAccess: elsewhere,
      presence: {
        connected: (userId) => {
          this.#linkStreams++;
          this.#flipping(userId, () => this.#links.connected(userId));
        },
        disconnected: (userId) => {
          this.#linkStreams--;
          this.#flipping(userId, () => this.#links.disconnected(userId));
        },
        online: (userId) => this.#links.online(userId),
      },
      events: this.events,
      version,
    };
  }

  /** Emits an event to the hub's listeners. */
  emit<N extends HostEventName>(name: N, payload: HostEventMap[N]): void {
    this.#emitted++;
    this.events.emit(name, payload);
  }

  /** Marks a Link connection of a user online or not (CF3). */
  setOnline(userId: string, connection: string, online: boolean): void {
    this.#flipping(userId, () => {
      let set = this.#online.get(userId);
      if (online) {
        if (!set) this.#online.set(userId, (set = new Set()));
        set.add(connection);
      } else if (set) {
        set.delete(connection);
        if (set.size === 0) this.#online.delete(userId);
      }
    });
  }

  isOnline(userId: string): boolean {
    return (this.#online.get(userId)?.size ?? 0) > 0 || this.#links.online(userId);
  }

  /** Whether `userId` is online, remembering that room `room` asks (it is told when the answer flips). */
  online(userId: string, room?: string): boolean {
    if (room && userId) {
      const before = this.#roomUser.get(room);
      if (before !== userId) {
        if (before) this.forget(room);
        this.#roomUser.set(room, userId);
        let rooms = this.#watchers.get(userId);
        if (!rooms) this.#watchers.set(userId, (rooms = new Set()));
        rooms.add(room);
      }
    }
    return this.isOnline(userId);
  }

  /** Room `room` no longer wants presence changes (its artifact closed). */
  forget(room: string): void {
    this.#awake.delete(room);
    const userId = this.#roomUser.get(room);
    if (userId === undefined) return;
    this.#roomUser.delete(room);
    const rooms = this.#watchers.get(userId);
    rooms?.delete(room);
    if (rooms?.size === 0) this.#watchers.delete(userId);
  }

  /** Runs a change of `userId`'s connections and tells the rooms that asked when it flipped the answer. */
  #flipping(userId: string, change: () => void): void {
    const before = this.isOnline(userId);
    change();
    if (this.isOnline(userId) === before) return;
    // The Shells listening here: their owner's agent came or went (the Ask pane's words). Not counted in `emitted`
    // (the events other objects send here).
    this.events.emit('agent-changed', { userId });
    const notify = this.#options.notifyRoom;
    if (!notify) return;
    for (const room of this.#watchers.get(userId) ?? []) {
      this.#notified++;
      notify(room).catch((error: unknown) => this.#options.log?.(`hub: telling ${room} of a presence change failed: ${error instanceof Error ? error.message : String(error)}`));
    }
  }

  /** Room `room` has pages open whose roles a plugin decides. */
  awake(room: string): void {
    this.#awake.add(room);
    if (this.#awake.size > 100_000) this.#awake.delete(this.#awake.values().next().value!);
  }

  /** Asks every awake room (and every room that asked about presence) to work its pages' roles out again. */
  async refreshRooms(): Promise<number> {
    const refresh = this.#options.refreshRoom;
    if (!refresh) return 0;
    const rooms = new Set([...this.#awake, ...this.#roomUser.keys()]);
    await Promise.all(
      [...rooms].map((room) => refresh(room).catch((error: unknown) => this.#options.log?.(`hub: refreshing ${room} failed: ${error instanceof Error ? error.message : String(error)}`))),
    );
    return rooms.size;
  }

  /** Settles once the outbox feed listens (tests). */
  feedReady(): Promise<void> {
    return this.#feed;
  }

  stats(): HubStats {
    const listeners = {} as Record<HostEventName, number>;
    for (const name of EVENT_NAMES) listeners[name as HostEventName] = this.events.listenerCount(name as HostEventName);
    return { streams: this.#streams, listeners, online: this.#online.size, links: this.#linkStreams, emitted: this.#emitted, watchingRooms: this.#roomUser.size, notified: this.#notified, awakeRooms: this.#awake.size };
  }

  /** The hub's `fetch`: its calls (with {@link HUB_CALL_HEADER}) and the Library stream. */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.headers.get(HUB_CALL_HEADER) === '1') {
      try {
        return await this.#call(request, url);
      } catch (error) {
        return errorResponse(error, this.#options.log);
      }
    }
    if ((url.pathname === EVENTS_PATH || url.pathname === LINK_EVENTS_PATH) && request.method === 'GET') return this.#stream(request);
    return Response.json({ code: 'not_found', message: `No hub route ${url.pathname}.` }, { status: 404 });
  }

  async #call(request: Request, url: URL): Promise<Response> {
    switch (url.pathname) {
      case '/emit': {
        const { name, payload } = (await request.json()) as { name: string; payload: unknown };
        if (!EVENT_NAMES.has(name)) return Response.json({ code: 'invalid_argument', message: `No event ${name}.` }, { status: 400 });
        await this.#feed;
        this.emit(name as HostEventName, payload as HostEventMap[HostEventName]);
        return Response.json({ ok: true });
      }
      case '/presence': {
        if (request.method === 'POST') {
          const body = (await request.json()) as { userId: string; connection: string; online: boolean };
          this.setOnline(body.userId, body.connection, body.online === true);
          return Response.json({ ok: true });
        }
        return Response.json({ online: this.online(url.searchParams.get('user') ?? '', url.searchParams.get('room') ?? undefined) });
      }
      case '/presence/forget': {
        const body = (await request.json()) as { room?: unknown };
        if (typeof body.room === 'string') this.forget(body.room);
        return Response.json({ ok: true });
      }
      case '/rooms/awake': {
        const body = (await request.json()) as { room?: unknown };
        if (typeof body.room === 'string') this.awake(body.room);
        return Response.json({ ok: true });
      }
      case '/rooms/refresh':
        return Response.json({ rooms: await this.refreshRooms() });
      case '/stats':
        return Response.json(this.stats());
      default:
        return Response.json({ code: 'not_found', message: `No hub call ${url.pathname}.` }, { status: 404 });
    }
  }

  /** The Library's or the Link's stream: the core's route, with a heartbeat that notices a client that left. */
  async #stream(request: Request): Promise<Response> {
    const catalog = await this.#options.catalog();
    const access = await this.#access;
    const abort = new AbortController();
    const signal = AbortSignal.any([abort.signal, request.signal]);
    const inner = new Request(request, { signal });
    const ctx: EventStreamCtx = {
      config: this.#options.config,
      catalog,
      now: this.#options.now ?? (() => new Date()),
      log: this.#options.log ?? ((line) => console.log(line)),
      events: this.events,
      access,
    };
    const response = await this.#router.handle(inner, ctx);
    if (!response.ok || !response.body) return response;
    this.#streams++;
    const heartbeatMs = this.#options.heartbeatMs ?? STREAM_HEARTBEAT_MS;
    const reader = response.body.getReader();
    const ping = new TextEncoder().encode(': ping\n\n');
    let timer: ReturnType<typeof setInterval> | null = null;
    let ended = false;
    const end = (): void => {
      if (ended) return;
      ended = true;
      this.#streams--;
      if (timer) clearInterval(timer);
      abort.abort();
      reader.cancel().catch(() => undefined);
    };
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        let last = Date.now();
        const send = (chunk: Uint8Array): void => {
          try {
            controller.enqueue(chunk);
            last = Date.now();
          } catch {
            end();
          }
        };
        timer = setInterval(() => {
          if (Date.now() - last >= heartbeatMs / 2) send(ping);
        }, heartbeatMs);
        void (async () => {
          try {
            for (;;) {
              const step = await reader.read();
              if (step.done) break;
              send(step.value);
            }
          } catch {
            /* ended */
          }
          const wasEnded = ended;
          end();
          if (!wasEnded) {
            try {
              controller.close();
            } catch {
              /* already */
            }
          }
        })();
      },
      cancel() {
        end();
      },
    });
    return new Response(body, { status: response.status, headers: response.headers });
  }
}

/** The hub as the Worker and the objects call it. */
export class HubClient implements HubLink {
  readonly #stub: () => FetchStub;

  /**
   * `stub` makes the hub's stub. A Worker makes one per call: a stub made while answering one request cannot be used
   * while answering another ("Cannot perform I/O on behalf of a different request").
   */
  constructor(stub: () => FetchStub) {
    this.#stub = stub;
  }

  async #call(path: string, init: { method?: string; json?: unknown } = {}): Promise<Response> {
    const headers = new Headers({ [HUB_CALL_HEADER]: '1' });
    if (init.json !== undefined) headers.set('content-type', 'application/json');
    const response = await this.#stub().fetch(
      new Request(new URL(path, BASE), { method: init.method ?? (init.json !== undefined ? 'POST' : 'GET'), headers, ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}) }),
    );
    if (!response.ok) throw new Error(`The hub answered HTTP ${response.status} to ${path}.`);
    return response;
  }

  async emit<N extends HostEventName>(name: N, payload: HostEventMap[N]): Promise<void> {
    await (await this.#call('emit', { json: { name, payload } })).body?.cancel();
  }

  async online(userId: string, room?: string): Promise<boolean> {
    const url = `presence?user=${encodeURIComponent(userId)}${room ? `&room=${encodeURIComponent(room)}` : ''}`;
    return ((await (await this.#call(url)).json()) as { online: boolean }).online === true;
  }

  async forget(room: string): Promise<void> {
    await (await this.#call('presence/forget', { json: { room } })).body?.cancel();
  }

  async awake(room: string): Promise<void> {
    await (await this.#call('rooms/awake', { json: { room } })).body?.cancel();
  }

  /** Asks every awake room to drop the pages whose role moved (a plugin forgot every role). */
  async refreshRooms(): Promise<void> {
    await (await this.#call('rooms/refresh', { method: 'POST' })).body?.cancel();
  }

  /** Marks a Link connection online or not (CF3). */
  async setOnline(userId: string, connection: string, online: boolean): Promise<void> {
    await (await this.#call('presence', { json: { userId, connection, online } })).body?.cancel();
  }

  async stats(): Promise<HubStats> {
    return (await (await this.#call('stats')).json()) as HubStats;
  }

  /** Forwards a browser's Library stream request (its cookies), or a daemon's Link stream (its Bearer token), to the hub. */
  stream(request: Request): Promise<Response> {
    const headers = new Headers(request.headers);
    headers.delete(HUB_CALL_HEADER);
    return this.#stub().fetch(new Request(request, { headers }));
  }
}

/**
 * The Worker's `HostEvents`: an event emitted while answering a request goes to the hub too (after the answer, through
 * `waitUntil`). The Worker has no listeners of its own.
 */
export class ForwardingEvents extends HostEvents {
  readonly #hub: HubLink;
  readonly #later: (promise: Promise<unknown>) => void;

  constructor(hub: HubLink, later: (promise: Promise<unknown>) => void, log: (line: string) => void) {
    super({ onError: (error, name) => log(`event ${name}: ${error instanceof Error ? error.message : String(error)}`) });
    this.#hub = hub;
    this.#later = later;
  }

  override emit<N extends HostEventName>(name: N, payload: HostEventMap[N]): void {
    super.emit(name, payload);
    this.#later(this.#hub.emit(name, payload).catch(() => undefined));
  }
}
