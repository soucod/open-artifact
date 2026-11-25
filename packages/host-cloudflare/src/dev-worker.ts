/**
 * A Worker for testing this package under `wrangler dev` — NOT the product. It routes every request to the room of
 * one artifact with a permissive {@link RoomHost}: anyone holding any token is let in, `owner` as the owner and any
 * other token as an editor of that name. Never deploy it: the product's Worker (the next package) verifies page tokens
 * with the host core.
 *
 * Addresses (`<port>` is wrangler's):
 *
 *     http://<id>.localhost:<port>/<type>/<token>/…    an artifact's pages (its content origin; Chrome resolves
 *                                                      *.localhost to loopback). A client that cannot resolve it
 *                                                      sends the request to localhost with the artifact in the
 *                                                      `x-open-artifact-artifact` header instead.
 *     http://localhost:<port>/_dev/shell/<id>/<type>/<token>   a bare frame around the page (the type server sends
 *                                                      top-level visits to the page back to its Shell: this).
 *     http://localhost:<port>/_dev/<id>/<call>         the room's calls: POST seed (JSON {path: base64}),
 *                                                      POST import (zip bytes), GET archive, GET manifest,
 *                                                      GET file?path=, POST files ({writes, author}),
 *                                                      POST action/<name> (JSON args), GET connected,
 *                                                      POST disconnect ({keep}), GET stats, POST destroy.
 *
 * `/_open-artifact/**` (the editors, the Shell, `support.js`) is served by the platform from static assets before
 * this runs (`run_worker_first: false`).
 */
import { Buffer } from 'node:buffer';
import type { TypeApiPresence, TypeApiWakeResult } from '@open-artifact/protocol';
import type { Viewer } from '@open-artifact/runtime/capabilities';
import { isTypeName } from '@open-artifact/type-server';
import { ARTIFACT_HEADER, ArtifactRoom, type AssetsBinding, type RoomHost, type RoomState } from './room.ts';

/** A Durable Object namespace, as far as this uses it. */
interface Namespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}

interface DevEnv {
  ASSETS: AssetsBinding;
  ARTIFACT: Namespace;
  OA_ROOM_IDLE_CLOSE_MS?: string;
  OA_SSE_HEARTBEAT_MS?: string;
}

/** The room's idle close and event-stream heartbeat from `OA_ROOM_IDLE_CLOSE_MS` / `OA_SSE_HEARTBEAT_MS`, when set. */
function roomTimings(env: DevEnv): { idleCloseMs?: number; sseHeartbeatMs?: number } {
  const idle = Number(env.OA_ROOM_IDLE_CLOSE_MS);
  const beat = Number(env.OA_SSE_HEARTBEAT_MS);
  return { ...(env.OA_ROOM_IDLE_CLOSE_MS && Number.isFinite(idle) ? { idleCloseMs: idle } : {}), ...(env.OA_SSE_HEARTBEAT_MS && Number.isFinite(beat) ? { sseHeartbeatMs: beat } : {}) };
}

/** The origins pages and the Shell are served on, learnt from the first request (wrangler picks the port). */
const origins = { app: 'http://localhost:8787', base: 'localhost:8787', protocol: 'http:' };

function learnOrigin(url: URL): void {
  const host = url.host.split('.');
  const base = host.length > 1 && host[host.length - 1]!.startsWith('localhost') ? host[host.length - 1]! : url.host;
  origins.base = base;
  origins.protocol = url.protocol;
  origins.app = `${url.protocol}//${base}`;
}

/** The artifact a content-origin request is for: the label before `.localhost`, else the header. */
function artifactOf(request: Request, url: URL): string | null {
  const labels = url.hostname.split('.');
  if (labels.length === 2 && labels[1] === 'localhost') return labels[0]!;
  return request.headers.get(ARTIFACT_HEADER);
}

/** The type a request names: its first path segment, or its page's (the Referer) for `/_blob/` and the like. */
function typeOf(request: Request): string | null {
  const first = new URL(request.url).pathname.split('/')[1] ?? '';
  if (isTypeName(first)) return first;
  const referer = request.headers.get('referer');
  if (!referer) return null;
  try {
    const named = new URL(referer).pathname.split('/')[1] ?? '';
    return isTypeName(named) ? named : null;
  } catch {
    return null;
  }
}

const wakes: Record<string, unknown[]> = {};

/** Everyone in: the token names the person (`owner` is the owner). */
const devHost: RoomHost = {
  async resolve(artifactId, token, _use, request) {
    const type = typeOf(request);
    if (!type || !token) return null;
    const viewer: Viewer = token === 'owner' ? { id: 'owner', name: 'Dev Owner', role: 'owner', kind: 'user' } : { id: token, name: token, role: 'editor', kind: 'user' };
    return { title: `Dev ${type} ${artifactId}`, type, viewer, principal: { kind: 'user', id: token === 'owner' ? 'dev-owner' : token } };
  },
  pageBase: (id) => `${origins.protocol}//${id}.${origins.base}/`,
  shellUrl: (id) => `${origins.app}/_dev/shell/${id}`,
  appOrigin: () => origins.app,
  ownerName: async () => 'Dev Owner',
  typeApi: {
    async wake(id, body = {}): Promise<TypeApiWakeResult> {
      (wakes[id] ??= []).push(body);
      return { status: 'inbox', via: 'link' };
    },
    async presence(): Promise<TypeApiPresence> {
      return { presence: 'offline', canSend: true, canSendSession: false, busy: false, agentName: 'Dev Agent', wakesIdle: false };
    },
    async touch() {
      return {};
    },
  },
};

/** The Durable Object class: a room with the permissive host, plus the `/_dev/<id>/<call>` routes. */
export class DevArtifactObject {
  private readonly room: ArtifactRoom;

  constructor(state: RoomState, env: DevEnv) {
    this.room = new ArtifactRoom(state, env, { host: devHost, trackTimers: true, ...roomTimings(env) });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    learnOrigin(new URL(request.headers.get('x-dev-origin') ?? url.origin));
    const parts = url.pathname.split('/');
    if (parts[1] !== '_dev') return this.room.fetch(request);
    const id = parts[2]!;
    const call = parts.slice(3).join('/');
    try {
      return await this.call(id, call, request, url);
    } catch (error) {
      const status = typeof (error as { status?: unknown }).status === 'number' ? (error as { status: number }).status : 500;
      const code = typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : 'server_failed';
      return Response.json({ code, message: error instanceof Error ? error.message : String(error) }, { status });
    }
  }

  private async call(id: string, call: string, request: Request, url: URL): Promise<Response> {
    const room = this.room;
    switch (call) {
      case 'seed': {
        const files = (await request.json()) as Record<string, string>;
        return Response.json(await room.seed(id, Object.fromEntries(Object.entries(files).map(([path, b64]) => [path, Buffer.from(b64, 'base64')]))));
      }
      case 'import':
        return Response.json(await room.importArchive(new Uint8Array(await request.arrayBuffer()), { id }));
      case 'archive':
        await room.ready(id);
        return new Response((await room.archive())!, { headers: { 'content-type': 'application/zip' } });
      case 'manifest':
        await room.ready(id);
        return Response.json(await room.manifest());
      case 'file': {
        await room.ready(id);
        const file = await room.readFile(url.searchParams.get('path') ?? '');
        return file ? new Response(file.bytes as BodyInit, { headers: { etag: file.etag } }) : Response.json({ code: 'not_found' }, { status: 404 });
      }
      case 'files': {
        await room.ready(id);
        const body = (await request.json()) as { writes: Parameters<ArtifactRoom['writeFiles']>[0]; author?: string };
        return Response.json(await room.writeFiles(body.writes, body.author ?? 'dev'));
      }
      case 'connected':
        await room.ready(id);
        return Response.json(room.connected());
      case 'disconnect': {
        await room.ready(id);
        const body = (await request.json().catch(() => ({}))) as { keep?: string[] };
        room.disconnect(body.keep);
        return Response.json({ ok: true });
      }
      case 'stats':
        await room.ready(id);
        return Response.json(await room.stats());
      case 'destroy':
        await room.ready(id);
        await room.destroy();
        return Response.json({ ok: true });
      case 'wakes':
        return Response.json(wakes[id] ?? []);
      default:
        if (call.startsWith('action/')) {
          await room.ready(id);
          return Response.json(await room.action(decodeURIComponent(call.slice('action/'.length)), (await request.json().catch(() => ({}))) as Record<string, unknown>));
        }
        return Response.json({ code: 'not_found', message: `No dev call ${call}.` }, { status: 404 });
    }
  }
}

/** The frame a page lives in under `wrangler dev` (the product's Shell brokers capabilities; this only frames). */
function devShell(id: string, type: string, token: string): Response {
  const page = new URL(`${type}/${encodeURIComponent(token)}/`, devHost.pageBase(id));
  page.searchParams.set('open_artifact_shell', origins.app);
  const html = `<!doctype html><meta charset="utf-8"><title>dev ${type} ${id}</title>
<style>html,body,iframe{margin:0;border:0;width:100%;height:100%;display:block}</style>
<iframe src="${page.href.replace(/"/g, '&quot;')}" allow="clipboard-read; clipboard-write"></iframe>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;

export default {
  async fetch(request: Request, env: DevEnv): Promise<Response> {
    const url = new URL(request.url);
    learnOrigin(url);
    const parts = url.pathname.split('/');
    if (parts[1] === '_dev' && parts[2] === 'shell') {
      const [id, type, token] = parts.slice(3);
      if (id && type && isTypeName(type)) return devShell(id, type, token || 'owner');
      return new Response('Usage: /_dev/shell/<id>/<type>/<token>', { status: 400 });
    }
    const id = parts[1] === '_dev' ? parts[2] : artifactOf(request, url);
    if (!id || !ID.test(id)) return new Response('No artifact named: use http://<id>.localhost:<port>/ or the x-open-artifact-artifact header.', { status: 404 });
    const headers = new Headers(request.headers);
    headers.set(ARTIFACT_HEADER, id);
    headers.set('x-dev-origin', url.origin);
    const stub = env.ARTIFACT.get(env.ARTIFACT.idFromName(id));
    return stub.fetch(new Request(request, { headers }));
  },
};
