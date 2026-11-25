/**
 * Embedding Shell pages in a harness's own UI.
 *
 * - `embed.origins` (and `GET /api/open-artifact.embed`): where artifact pages are served from, for the host's allow
 *   list: the daemon (the Shell), the per-artifact origins of static types (one pattern), local type servers (each
 *   with the pattern of the per-artifact origins on its port) and the
 *   addresses of URL-entry types, which may be anywhere on the web (`remote`). The two layers stay two origins: the
 *   page in the Shell's frame runs the type's and the agent's code and must not reach the Shell or the daemon.
 *   Subscribed adapters get `embed/origins` when the answer changes.
 * - Top-level views (`caps.open.embed: 'view'`): `host.open` carries a one-time ticket (`view`) and the Shell address
 *   with it (`embed_url`). A Shell loaded with a ticket and no parent frame claims it over `GET
 *   /api/open-artifact.view` (an event stream): the claim gives it a key only it knows, and from then on what it would
 *   have posted to a parent frame goes to `POST /api/open-artifact.view` with that key, and on to the adapter as
 *   `shell.event`; the adapter's `shell.command` comes down the stream. A ticket is used once, belongs to the adapter
 *   connection it was issued to, expires unclaimed after {@link TICKET_MS}, and ends with that connection. Commands
 *   sent before the Shell connects wait (at most {@link MAX_QUEUED}). A Shell that reloads may come back with its key
 *   within {@link GRACE_MS}.
 *
 * What the Shell and the host send each other is data: both directions are reduced to the fields of their message
 * type, with text cut to `MAX_HOST_TEXT`.
 */

import { randomBytes } from 'node:crypto';
import {
  MAX_HOST_DESTINATIONS,
  MAX_HOST_TEXT,
  OpenArtifactError,
  VIEW_TICKET_PARAM,
  artifactIdOf,
  entryLocation,
  hostToShellOf,
  isLoopbackHost,
  shellToHostOf,
  type AdapterToDaemon,
  type EmbedOriginEntry,
  type EmbedOriginsResult,
  type HarnessEvent,
  type HostOpenParams,
  type HostToShell,
  type ResolvedEntry,
  type SessionRef,
  type ShellEventParams,
  type ShellToHost,
} from '@open-artifact/protocol';
import type { AdapterConnection } from './harness.ts';

/** `host.open`'s `remote`: the type of a remote artifact and the origins its page comes from. */
export type HostOpenRemote = NonNullable<HostOpenParams['remote']>;

/** The methods this module answers. */
export const EMBED_METHODS = ['embed.origins', 'shell.command'] as const satisfies ReadonlyArray<keyof AdapterToDaemon>;

/** How long an issued ticket waits for its Shell, ms. */
export const TICKET_MS = 2 * 60_000;
/** How long a view whose Shell went away (a reload) may be claimed again with its key, ms. */
export const GRACE_MS = 30_000;
/** Most host commands kept for a Shell that has not connected yet. */
export const MAX_QUEUED = 32;
/** Most open views per adapter connection. */
const MAX_VIEWS_PER_CONNECTION = 64;

/** What the handler is given about the calling adapter. */
export interface EmbedCallContext {
  harness: string;
  caller: SessionRef;
  conn: AdapterConnection;
  /** The hub's views and origins. */
  views: EmbedViews;
}

/** Answers `embed.origins` and `shell.command`. */
export async function handleEmbedCall(method: (typeof EMBED_METHODS)[number], params: Record<string, unknown>, context: EmbedCallContext): Promise<unknown> {
  if (method === 'embed.origins') return context.views.origins();
  return context.views.command(context.conn, params);
}

/** Sends a Shell message to the adapter whose view it came from (`shell.event`). False without a connection. */
export function sendShellEvent(conn: AdapterConnection | null, params: ShellEventParams): boolean {
  if (!conn) return false;
  void conn.call('shell.event', params).catch(() => undefined);
  return true;
}

// ---- origins ---------------------------------------------------------------------------------------------------

/** Whether an origin's host is this computer (`127.0.0.1`, `[::1]`, `localhost`, `*.localhost`). */
export function isLoopbackOrigin(origin: string): boolean {
  try {
    return isLoopbackHost(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/** The origin of an `http(s)` address (a URL template's placeholders left out), or `null`. */
export function originOfTemplate(url: string): string | null {
  try {
    const at = new URL(url.replace(/\{[a-z]+\}/g, 'x'));
    return /^https?:$/.test(at.protocol) ? at.origin : null;
  } catch {
    return null;
  }
}

/** What {@link embedOrigins} is built from. */
export interface EmbedOriginsInput {
  /** The daemon's origin. */
  daemon: string;
  /** The daemon's port (static types are framed from `http://<id>.frame.localhost:<port>`). */
  port: number;
  /** The installed types: their id and entry (`kind`, and `url` for URL and server entries). */
  types: Array<{ id: string; entry: { kind: string; url?: string | null | undefined } | null | undefined }>;
  /** The local type servers running now, by type: their base address. */
  running: Array<{ type: string; base: string }>;
}

/** The `embed.origins` answer for a daemon in this state. */
export function embedOrigins(input: EmbedOriginsInput): EmbedOriginsResult {
  const entries: EmbedOriginEntry[] = [{ origin: input.daemon, kind: 'daemon', remote: false }];
  const seen = new Set<string>([input.daemon]);
  const add = (entry: EmbedOriginEntry): void => {
    const key = entry.origin ?? entry.pattern!;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push(entry);
  };
  if (input.types.some((t) => t.entry?.kind === 'static')) add({ pattern: `http://*.frame.localhost:${input.port}`, kind: 'frame', remote: false });
  for (const type of input.types) {
    const entry = type.entry;
    if (!entry || entry.kind === 'static' || typeof entry.url !== 'string') continue;
    const origin = originOfTemplate(entry.url);
    if (origin) add({ origin, kind: entry.kind === 'url' ? 'url' : 'server', type: type.id, remote: !isLoopbackOrigin(origin) });
  }
  for (const server of input.running) {
    const origin = originOfTemplate(server.base);
    if (!origin) continue;
    add({ origin, kind: 'server', type: server.type, remote: !isLoopbackOrigin(origin) });
    // A local server may give each artifact an origin of its own on its port (frame-host does for original types).
    const port = new URL(origin).port;
    if (isLoopbackOrigin(origin) && port) add({ pattern: `http://*.frame.localhost:${port}`, kind: 'frame', type: server.type, remote: false });
  }
  return { origins: entries.map((e) => (e.origin ?? e.pattern)!), entries };
}

/**
 * `host.open`'s `remote` for an artifact: its type's origin when the type is remote (`entryLocation`), and the origin
 * of the page the type's server gave (`page`), when that is elsewhere again. `null` for a local type.
 */
export function remoteOf(type: { id: string; entry: ResolvedEntry | null | undefined } | null | undefined, page?: string | null): HostOpenRemote | null {
  const where = entryLocation(type?.entry);
  if (!type || !where.remote || !where.origin) return null;
  const origins = [where.origin];
  const pageOrigin = page ? originOfTemplate(page) : null;
  if (pageOrigin && !origins.includes(pageOrigin) && !isLoopbackOrigin(pageOrigin)) origins.push(pageOrigin);
  return { type: type.id, origins };
}

// ---- messages ----------------------------------------------------------------------------------------------------

/** A host origin as an adapter declares it (`app://myagent`, `http://127.0.0.1:5173`), or `null`. */
export function hostOriginOf(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 200) return null;
  const origin = value.replace(/\/+$/, '');
  return /^[a-z][a-z0-9+.-]*:\/\/[^\s/?#*]+$/i.test(origin) ? origin : null;
}

/** A Shell's message to its host, reduced to its fields (`shellToHostOf`). */
export const shellEventOf = shellToHostOf;
/** A host's message to the Shell, reduced to its fields (`hostToShellOf`). */
export const hostCommandOf = hostToShellOf;

// ---- views -------------------------------------------------------------------------------------------------------

/** Where a claimed view's host commands go: the Shell's event stream. */
export interface ViewSink {
  send(command: HostToShell): void;
  end(): void;
}

interface View {
  id: string;
  conn: AdapterConnection;
  session: string | null;
  artifactId: string;
  /** The key the claiming Shell got; `null` until claimed. */
  key: string | null;
  sink: ViewSink | null;
  queue: HostToShell[];
  /** When it goes if nobody (re)claims it, ms since the epoch; `Infinity` while a Shell is connected. */
  expires: number;
}

/** Options of {@link EmbedViews}. */
export interface EmbedViewsOptions {
  /** Sends an event to subscribed adapters. */
  broadcast: (event: HarnessEvent) => void;
  /** The adapter connections now. */
  connections: () => Iterable<AdapterConnection>;
  log?: (line: string) => void;
  ticketMs?: number;
  graceMs?: number;
  now?: () => number;
}

/** The daemon's side of embedding: the origins, the hosts' origins, and the top-level views with their tickets. */
export class EmbedViews {
  private readonly options: EmbedViewsOptions;
  private readonly views = new Map<string, View>();
  private source: () => EmbedOriginsResult = () => ({ origins: [], entries: [] });
  private last = '';
  private readonly sweeper: ReturnType<typeof setInterval>;

  constructor(options: EmbedViewsOptions) {
    this.options = options;
    this.sweeper = setInterval(() => this.sweep(), 10_000);
    this.sweeper.unref?.();
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  /** Where the origins come from (the daemon sets it); the first answer is remembered, not broadcast. */
  setOrigins(source: () => EmbedOriginsResult): void {
    this.source = source;
    this.last = JSON.stringify(this.origins());
  }

  /** The local Shell address of an artifact id (the daemon sets it); a view always loads the local Shell. */
  setShellUrl(shellUrl: (id: string) => string): void {
    this.shellUrl = shellUrl;
  }

  private shellUrl: ((id: string) => string) | null = null;

  /** Where an artifact's remote type serves its page from, or `null` for a local type (the daemon sets it). */
  setRemoteOf(remoteOf: (id: string) => HostOpenRemote | null): void {
    this.remoteOf = remoteOf;
  }

  private remoteOf: ((id: string) => HostOpenRemote | null) | null = null;

  /**
   * What `host.open` carries for this connection beyond `url`/`view_url`: for a top-level-view adapter a ticket and
   * the local Shell address with it; for one that frames the Shell the local Shell address; and, for an artifact of a
   * remote type, `remote` (its type and the origins its page comes from), so the host decides whether to let it in.
   * Nothing before the daemon set the Shell address or for an artifact address it cannot read.
   */
  openExtras(conn: AdapterConnection, session: string | null, url: string): { view?: string; embed_url?: string; remote?: HostOpenRemote } {
    const id = artifactIdOf(url);
    if (!id || !this.shellUrl) return {};
    let remote: HostOpenRemote | null = null;
    try {
      remote = this.remoteOf?.(id) ?? null;
    } catch (error) {
      this.options.log?.(`embed remote of ${id}: ${(error as Error)?.message ?? error}`);
    }
    return { ...this.issue(conn, { session, artifactId: id, shellUrl: this.shellUrl(id) }), ...(remote ? { remote } : {}) };
  }

  /** The `embed.origins` answer. */
  origins(): EmbedOriginsResult {
    try {
      return this.source();
    } catch (error) {
      this.options.log?.(`embed origins: ${(error as Error)?.message ?? error}`);
      return { origins: [], entries: [] };
    }
  }

  /** Something the origins depend on changed: subscribed adapters hear the new answer when it differs. */
  originsChanged(): void {
    const now = this.origins();
    const text = JSON.stringify(now);
    if (text === this.last) return;
    this.last = text;
    this.options.broadcast({ type: 'embed/origins', ...now });
  }

  /** The origins connected adapters embed the Shell from (`caps.open.origins`); empty when none declared any. */
  hostOrigins(): string[] {
    const out = new Set<string>();
    for (const conn of this.options.connections()) {
      if (!conn.authed || !conn.caps.open || typeof conn.caps.open !== 'object') continue;
      for (const origin of Array.isArray(conn.caps.open.origins) ? conn.caps.open.origins : []) {
        const ok = hostOriginOf(origin);
        if (ok) out.add(ok);
      }
    }
    return [...out];
  }

  /**
   * A ticket for a top-level view of the adapter's (`caps.open.embed: 'view'`), with the Shell address that carries
   * it; `null` for an adapter that embeds in a frame (it gets the plain Shell address as `embed_url`).
   */
  issue(conn: AdapterConnection, params: { session: string | null; artifactId: string; shellUrl: string }): { view?: string; embed_url: string } {
    const open = conn.caps.open;
    if (!open || typeof open !== 'object' || open.embed !== 'view') return { embed_url: params.shellUrl };
    this.sweep();
    const mine = [...this.views.values()].filter((v) => v.conn === conn).sort((a, b) => a.expires - b.expires);
    // Too many: the oldest waiting ticket goes.
    if (mine.length >= MAX_VIEWS_PER_CONNECTION) this.end(mine.find((v) => !v.sink) ?? mine[0]!);
    const id = randomBytes(24).toString('base64url');
    this.views.set(id, { id, conn, session: params.session, artifactId: params.artifactId, key: null, sink: null, queue: [], expires: this.now() + (this.options.ticketMs ?? TICKET_MS) });
    const at = new URL(params.shellUrl);
    at.searchParams.set(VIEW_TICKET_PARAM, id);
    return { view: id, embed_url: at.href };
  }

  /**
   * The Shell of artifact `artifactId` claims view `id` (first time: no key) or comes back to it (with the key it got).
   * Answers the key; throws `not_found` for an unknown, used, expired or other artifact's ticket and a wrong key.
   */
  claim(id: string, artifactId: string, key: string | null, sink: ViewSink): { key: string; session: string | null } {
    this.sweep();
    const view = this.views.get(id);
    const refuse = (): never => {
      throw new OpenArtifactError('not_found', 'No such view: the ticket was used, expired or belongs to another artifact.', { status: 404 });
    };
    if (!view || view.artifactId !== artifactId) return refuse();
    if (view.key === null) {
      if (key) return refuse();
      view.key = randomBytes(24).toString('base64url');
    } else if (!key || key !== view.key) {
      return refuse();
    }
    // The same Shell back (a reload) before its old stream was seen to close: the old one ends.
    const old = view.sink;
    view.sink = sink;
    old?.end();
    view.expires = Infinity;
    for (const command of view.queue.splice(0)) sink.send(command);
    return { key: view.key, session: view.session };
  }

  /** The Shell's stream of view `id` closed: it may come back with its key for a while. */
  detach(id: string, sink: ViewSink): void {
    const view = this.views.get(id);
    if (!view || view.sink !== sink) return;
    view.sink = null;
    view.expires = this.now() + (this.options.graceMs ?? GRACE_MS);
  }

  /** The Shell of view `id` says something to its host: on to the adapter as `shell.event`. */
  event(id: string, key: string, raw: unknown): { ok: true } {
    const view = this.views.get(String(id));
    if (!view || !view.key || key !== view.key) throw new OpenArtifactError('not_found', 'No such view.', { status: 404 });
    const event = shellEventOf(raw);
    if (!event) throw new OpenArtifactError('invalid_argument', 'event: a Shell message to its host.');
    sendShellEvent(view.conn, { view: view.id, session: view.session, event });
    return { ok: true };
  }

  /** `shell.command`: an adapter's message for the Shell of one of its views. */
  command(conn: AdapterConnection, params: Record<string, unknown>): { ok: true } {
    this.sweep();
    const view = this.views.get(String(params.view ?? ''));
    // Another connection's view is answered as an unknown one.
    if (!view || view.conn !== conn) throw new OpenArtifactError('not_found', 'No such view of this connection.');
    const command = hostCommandOf(params.command);
    if (!command) throw new OpenArtifactError('invalid_argument', 'command: host_hello or goto.');
    if (view.sink) view.sink.send(command);
    else {
      view.queue.push(command);
      if (view.queue.length > MAX_QUEUED) view.queue.splice(0, view.queue.length - MAX_QUEUED);
    }
    return { ok: true };
  }

  /** How many views are open or waiting (tests and diagnostics). */
  get size(): number {
    return this.views.size;
  }

  private end(view: View): void {
    this.views.delete(view.id);
    view.sink?.end();
  }

  /** An adapter went away: its views end. */
  dropConnection(conn: AdapterConnection): void {
    for (const view of [...this.views.values()]) if (view.conn === conn) this.end(view);
  }

  /** Forgets expired tickets and views whose Shell did not come back. */
  sweep(): void {
    const now = this.now();
    for (const view of [...this.views.values()]) if (!view.sink && view.expires <= now) this.end(view);
  }

  close(): void {
    clearInterval(this.sweeper);
    for (const view of [...this.views.values()]) this.end(view);
  }
}
