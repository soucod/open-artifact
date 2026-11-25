/**
 * The Worker's calls to an artifact's object, over the object's `fetch`: `https://room.internal/<call>?id=<artifact>`
 * with the {@link ROOM_CALL_HEADER} set. The Worker strips that header from every request it forwards from a browser,
 * so a page cannot make one (see `site.ts`). Fetch rather than RPC so a refusal keeps its code and HTTP status: an
 * error answers `{ code, message }` with its status, which {@link RoomClient} throws again as an `OpenArtifactError`.
 *
 * | Call | What it does |
 * | --- | --- |
 * | `POST import` (zip bytes) | unpacks a new artifact's folder: `{ type, title }` |
 * | `GET archive?folder=` (`HEAD`: only checks it can be zipped) | the folder as a zip |
 * | `POST refresh` | after a sharing change: drops the connections whose holder's role moved |
 * | `GET connected` | who has a page open (principal refs) |
 * | `POST action/<name>` (JSON args) | a type server action |
 * | `GET manifest`, `GET file?path=`, `POST files` (`{ writes, author }`) | files, for the Link and remote MCP |
 * | `POST create` (`{ type, title }`) | a new artifact's folder, scaffolded (remote MCP) |
 * | `GET title?type=` | the title the artifact's own files hold (`{ title }`, null when none) |
 * | `GET stats` | rows, bytes, connections, whether the artifact is open |
 * | `GET capabilities`, `POST capabilities` (`{ capabilities }`) | a page artifact's declared capabilities (`{ capabilities }`, null: not a page here); set: `{ changed }` |
 * | `POST agent-changed` | the owner's agent came or went (from the hub): pages are told; boots nothing |
 * | `POST destroy` | deletes everything the object stored (permanent deletion) |
 */

import { OpenArtifactError, type LinkFile, type LinkWrite, type LinkWriteResult, type OpenArtifactErrorCode } from '@open-artifact/protocol';
import type { PrincipalRef } from '@open-artifact/host';
import type { ImportLimits } from '@open-artifact/type-server';
import type { ArtifactRoom, RoomStats } from './room.ts';

/** Marks a request as the Worker's call to an object (never forwarded from a browser). */
export const ROOM_CALL_HEADER = 'x-open-artifact-room-call';
const BASE = 'https://room.internal/';

/** A Durable Object stub, as far as the calls use one. */
export interface FetchStub {
  fetch(request: Request): Promise<Response>;
}

/** What the object does for {@link handleRoomCall} besides the room itself: the host side of a refresh. */
export interface RoomCallHost {
  /** After a sharing change: forget cached access and drop the connections whose holder's role moved. */
  refresh(room: ArtifactRoom, artifactId: string): Promise<{ dropped: number }>;
  /** Import limits (the isolate's memory). */
  limits?: ImportLimits;
  /** More to report with `stats` (the object's D1 counts). */
  extraStats?(): Record<string, unknown>;
}

/** Whether a request is one of the Worker's calls. */
export function isRoomCall(request: Request): boolean {
  return request.headers.get(ROOM_CALL_HEADER) === '1';
}

function statusOfError(error: unknown): number {
  const status = (error as { status?: unknown }).status;
  if (typeof status === 'number') return status;
  if (error instanceof OpenArtifactError) return 400;
  return 500;
}

/** The object's side: answers one call. */
export async function handleRoomCall(room: ArtifactRoom, host: RoomCallHost, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const id = url.searchParams.get('id') ?? '';
  const call = url.pathname.slice(1);
  try {
    switch (call) {
      case 'import': {
        const bytes = new Uint8Array(await request.arrayBuffer());
        return Response.json(await room.importArtifact(bytes, { id, ...(host.limits ? { limits: host.limits } : {}) }));
      }
      case 'archive': {
        await room.ready(id);
        const folder = url.searchParams.get('folder') ?? undefined;
        const head = request.method === 'HEAD';
        const body = await room.archive({ ...(folder ? { folder } : {}), head });
        return new Response(head ? null : body, { headers: { 'content-type': 'application/zip' } });
      }
      case 'refresh':
        await room.ready(id);
        return Response.json(await host.refresh(room, id));
      case 'connected':
        await room.ready(id);
        return Response.json(room.connected());
      case 'manifest':
        await room.ready(id);
        return Response.json(await room.manifest());
      case 'file': {
        await room.ready(id);
        const file = await room.readFile(url.searchParams.get('path') ?? '');
        if (!file) return Response.json({ code: 'not_found', message: 'No such file.' }, { status: 404 });
        return new Response(file.bytes as BodyInit, { headers: { etag: file.etag } });
      }
      case 'files': {
        await room.ready(id);
        const body = (await request.json()) as { writes: LinkWrite[]; author: string };
        return Response.json(await room.writeFiles(body.writes, body.author));
      }
      case 'create': {
        const body = (await request.json()) as { type: string; title: string };
        await room.create({ id, type: body.type, title: body.title });
        return Response.json({ ok: true });
      }
      case 'title':
        await room.ready(id);
        return Response.json({ title: await room.contentTitle(url.searchParams.get('type') ?? '') });
      case 'stats':
        await room.ready(id);
        return Response.json({ ...(await room.stats()), ...(host.extraStats?.() ?? {}) });
      case 'capabilities': {
        await room.ready(id);
        if (request.method === 'POST') {
          const body = (await request.json()) as { capabilities?: unknown };
          const caps = body.capabilities;
          if (!caps || typeof caps !== 'object' || Array.isArray(caps)) return Response.json({ code: 'invalid_argument', message: 'capabilities must be an object.' }, { status: 400 });
          return Response.json({ changed: await room.setCapabilities(caps as Record<string, unknown>) });
        }
        return Response.json({ capabilities: await room.capabilities() });
      }
      case 'agent-changed':
        // Not `ready`: a room with nothing open has no page to tell, and is not booted for it.
        room.agentChanged();
        return Response.json({ ok: true });
      case 'destroy':
        await room.ready(id);
        await room.destroy();
        return Response.json({ ok: true });
      default:
        if (call.startsWith('action/')) {
          await room.ready(id);
          const args = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          return Response.json(await room.action(decodeURIComponent(call.slice('action/'.length)), args));
        }
        return Response.json({ code: 'not_found', message: `No room call ${call}.` }, { status: 404 });
    }
  } catch (error) {
    const code = typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : 'server_failed';
    return Response.json({ code, message: error instanceof Error ? error.message : String(error) }, { status: statusOfError(error), headers: { 'cache-control': 'no-store' } });
  }
}

/** The Worker's side: one artifact's object. */
export class RoomClient {
  readonly #stub: FetchStub;
  readonly #id: string;

  constructor(stub: FetchStub, artifactId: string) {
    this.#stub = stub;
    this.#id = artifactId;
  }

  /** Sends a call; a refusal is thrown as an `OpenArtifactError` with the object's code and status. */
  async call(call: string, init: { method?: string; query?: Record<string, string>; body?: BodyInit; json?: unknown } = {}): Promise<Response> {
    const url = new URL(call, BASE);
    url.searchParams.set('id', this.#id);
    for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, value);
    const headers = new Headers({ [ROOM_CALL_HEADER]: '1' });
    let body: BodyInit | undefined = init.body;
    if (init.json !== undefined) {
      headers.set('content-type', 'application/json');
      body = JSON.stringify(init.json);
    }
    const response = await this.#stub.fetch(new Request(url, { method: init.method ?? (body !== undefined ? 'POST' : 'GET'), headers, ...(body !== undefined ? { body } : {}) }));
    if (response.ok) return response;
    const error = (await response.json().catch(() => null)) as { code?: unknown; message?: unknown } | null;
    const code = (typeof error?.code === 'string' ? error.code : 'server_failed') as OpenArtifactErrorCode;
    const message = typeof error?.message === 'string' ? error.message : `The artifact's object answered HTTP ${response.status}.`;
    throw new OpenArtifactError(code, message, { status: response.status });
  }

  async importArtifact(bytes: Uint8Array): Promise<{ type: string; title: string }> {
    return (await this.call('import', { method: 'POST', body: bytes as BodyInit })).json() as Promise<{ type: string; title: string }>;
  }

  /** The zip (`HEAD`: no body, after checking it can be zipped). */
  async archive(method: 'GET' | 'HEAD', folder?: string): Promise<ReadableStream<Uint8Array> | null> {
    const response = await this.call('archive', { method, ...(folder ? { query: { folder } } : {}) });
    return method === 'HEAD' ? null : response.body;
  }

  async refresh(): Promise<{ dropped: number }> {
    return (await this.call('refresh', { method: 'POST' })).json() as Promise<{ dropped: number }>;
  }

  async connected(): Promise<PrincipalRef[]> {
    return (await this.call('connected')).json() as Promise<PrincipalRef[]>;
  }

  async action(name: string, args: Record<string, unknown>): Promise<unknown> {
    return (await this.call(`action/${encodeURIComponent(name)}`, { method: 'POST', json: args })).json();
  }

  async manifest(): Promise<Record<string, LinkFile>> {
    return (await this.call('manifest')).json() as Promise<Record<string, LinkFile>>;
  }

  async readFile(path: string): Promise<{ bytes: Uint8Array; etag: string } | null> {
    try {
      const response = await this.call('file', { query: { path } });
      return { bytes: new Uint8Array(await response.arrayBuffer()), etag: response.headers.get('etag') ?? '' };
    } catch (error) {
      if (error instanceof OpenArtifactError && error.status === 404) return null;
      throw error;
    }
  }

  async writeFiles(writes: LinkWrite[], author: string): Promise<LinkWriteResult[]> {
    return (await this.call('files', { method: 'POST', json: { writes, author } })).json() as Promise<LinkWriteResult[]>;
  }

  /** Scaffolds a new artifact's folder (`exists` when it has one). */
  async create(type: string, title: string): Promise<void> {
    await (await this.call('create', { method: 'POST', json: { type, title } })).body?.cancel();
  }

  /** The title the artifact's own files hold, or undefined. */
  async contentTitle(type: string): Promise<string | undefined> {
    const { title } = (await (await this.call('title', { query: { type } })).json()) as { title: string | null };
    return title ?? undefined;
  }

  async stats(): Promise<RoomStats & Record<string, unknown>> {
    return (await this.call('stats')).json() as Promise<RoomStats & Record<string, unknown>>;
  }

  async destroy(): Promise<void> {
    await this.call('destroy', { method: 'POST' });
  }

  /** A page artifact's declared capabilities, or null when it is not a page here. */
  async capabilities(): Promise<Record<string, unknown> | null> {
    return ((await (await this.call('capabilities')).json()) as { capabilities: Record<string, unknown> | null }).capabilities;
  }

  /** Replaces a page artifact's declared capabilities (`invalid_argument` for another type); whether they changed. */
  async setCapabilities(capabilities: Record<string, unknown>): Promise<boolean> {
    return ((await (await this.call('capabilities', { method: 'POST', json: { capabilities } })).json()) as { changed: boolean }).changed;
  }

  /** The owner's agent came or went (the hub's call). */
  async agentChanged(): Promise<void> {
    await (await this.call('agent-changed', { method: 'POST' })).body?.cancel();
  }
}
