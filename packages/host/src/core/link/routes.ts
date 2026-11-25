/**
 * The Link API on the app origin (`/api/open-artifact.link.*`, `protocol/src/link.ts`): how a local daemon publishes
 * artifacts to the host, keeps their files in step, hears wakes and people's edits, and runs actions on them.
 *
 * Every route but `device` and `token` (see `device.ts`) takes `Authorization: Bearer <access token>` only (a
 * session cookie does not count): a token that is expired, revoked or unknown is answered 401 with a
 * `WWW-Authenticate` challenge, a token without the `link` scope 403. In this version Link reaches only the
 * artifacts the token's user owns (decision 14): any other artifact, and a trashed one, is `not_found`.
 *
 * `events` is a server-sent-event stream: while it is open the user's Link counts as online (presence). It first
 * sends the user's unacknowledged outbox rows after `?after=` (or `Last-Event-ID`), then each new row as it is
 * written. Rows are sent to every open stream of the user (two computers each get every event) and again on every
 * new connection until `ack` marks them. A wake row is first claimed (`claimOutbox`), so one an MCP call took is not
 * sent, and one a stream sent is no MCP call's.
 *
 * `import` takes a new id, or the id of an artifact the same person unpublished (in their trash): that one is
 * replaced, its folder, sharing, links, guests and pins gone. Any other id in use is a `conflict`.
 */

import { ARCHIVE_CONTENT_TYPE, ARTIFACT_ID, LINK_API_PREFIX, LINK_ROUTES, shellPath, type LinkArtifact, type LinkArtifactSummary, type LinkArtifactsResult, type LinkFile, type LinkHello, type LinkFilesResult, type LinkManifest, type LinkWrite } from '@open-artifact/protocol';
import { invalidBearer, authenticate } from '../auth/session.ts';
import { httpError, json, readBody, readJson, type BaseCtx, type Router } from '../http.ts';
import type { AgentPrincipal, ArtifactRow } from '../types.ts';
import { emitEvent, eventBase, guards } from '../plugins/hooks.ts';
import { linkDeviceRoutes, linkUserOf, type DeviceRateLimit } from './device.ts';
import { LINK_AUTHOR, linkEventOf } from './outbox.ts';
import { linkTypeRoutes } from './types-routes.ts';
import { LINK_JSON_BYTES, LINK_MAX_BODY_BYTES, LINK_MAX_FILE_BYTES, LINK_MAX_WRITES, LINK_SCOPE, type LinkServices } from './services.ts';

/** How often a comment keeps an event stream open through proxies, ms. */
export const LINK_HEARTBEAT_MS = 25_000;
/** Longest title an import takes. */
const MAX_TITLE = 200;
/** An action name a `call` may carry. */
const ACTION_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/**
 * Actions a Link may not run on the host: they read or write a path on the host's own computer, need Chrome, or copy
 * the folder (`upload`, `snapshot`, LAN `share`, Docs `duplicate` and `import`). `check`, `upload` and `snapshot`
 * run on the daemon's working copy instead (decision 13). Anything else goes to the type server, which answers an
 * unknown action itself.
 */
export const LINK_REFUSED_ACTIONS: ReadonlySet<string> = new Set(['upload', 'snapshot', 'share', 'duplicate', 'import']);

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const invalid = (message: string): Error => httpError('invalid_argument', message, { status: 400 });

type AgentHandler<C extends BaseCtx> = (request: Request, ctx: C & { params: Record<string, string> }, agent: AgentPrincipal) => Promise<Response>;

/** The 401 for a request without a working Bearer token. */
function bearerRefused(message?: string): Response {
  const { error, challenge } = invalidBearer();
  const body = message ? { ...error.toJSON(), message } : error.toJSON();
  return json(body, { status: 401, headers: { 'www-authenticate': message ? 'Bearer' : challenge } });
}

/** A route that needs a Link token (see the module comment). */
function withAgent<C extends BaseCtx>(handler: AgentHandler<C>): (request: Request, ctx: C & { params: Record<string, string> }) => Promise<Response> {
  return async (request, ctx) => {
    if (!request.headers.has('authorization')) return bearerRefused('Link routes need Authorization: Bearer <access token>.');
    const auth = await authenticate(request, ctx, { agents: true });
    if (auth.principal.kind !== 'agent') return bearerRefused();
    if (!auth.principal.scopes.includes(LINK_SCOPE)) {
      throw httpError('not_granted', 'This token is not a Link token (it lacks the "link" scope).', { status: 403, fix: 'Sign in with open-artifact link.' });
    }
    return handler(request, ctx, auth.principal);
  };
}

/** The artifact `id` names when the token's user owns it and it is not in the trash; else `not_found`. */
async function ownedArtifact(ctx: BaseCtx, agent: AgentPrincipal, id: unknown): Promise<ArtifactRow> {
  if (typeof id !== 'string' || !ARTIFACT_ID.test(id)) throw invalid('id is an artifact id.');
  const artifact = await ctx.catalog.getArtifact(id);
  if (!artifact || artifact.ownerUser !== agent.user.id || artifact.trashedAt !== null) throw httpError('not_found', `No artifact ${id} of yours on this host.`, { status: 404 });
  return artifact;
}

/** A JSON body that is an object with a string `id`. */
async function bodyWithId(request: Request, maxBytes = LINK_JSON_BYTES): Promise<Record<string, unknown> & { id: string }> {
  const body = await readJson<unknown>(request, maxBytes);
  if (!isRecord(body) || typeof body.id !== 'string' || !body.id) throw invalid('The body is {id, …}.');
  return body as Record<string, unknown> & { id: string };
}

/** The `writes` of a `files` push, shape-checked (the paths are the files service's to check). */
function writesOf(value: unknown): LinkWrite[] {
  if (!Array.isArray(value) || value.length === 0) throw invalid('writes is a non-empty array of {path, content, if_match?}.');
  if (value.length > LINK_MAX_WRITES) throw httpError('too_large', `At most ${LINK_MAX_WRITES} writes per request.`);
  return value.map((write, index) => {
    if (!isRecord(write) || typeof write.path !== 'string' || !write.path) throw invalid(`writes[${index}].path is required.`);
    if (write.content !== null && typeof write.content !== 'string') throw invalid(`writes[${index}].content is base64 text, or null to delete.`);
    if (write.if_match !== undefined && write.if_match !== null && typeof write.if_match !== 'string') throw invalid(`writes[${index}].if_match is an etag, null, or left out.`);
    return { path: write.path, content: write.content, ...(write.if_match !== undefined ? { if_match: write.if_match } : {}) };
  });
}

/** Registers the Link routes, the device sign-in included. */
export function linkApiRoutes<C extends BaseCtx>(router: Router<C>, services: LinkServices, options: { deviceRate?: DeviceRateLimit } = {}): Router<C> {
  linkDeviceRoutes(router, options);
  const route = (name: string): string => `${LINK_API_PREFIX}${name}`;

  const linkArtifact = async (ctx: BaseCtx, artifact: ArtifactRow, files?: Record<string, LinkFile>): Promise<LinkArtifact> => ({
    id: artifact.id,
    url: `${ctx.config.appOrigin}${shellPath(artifact.id)}`,
    type: artifact.type,
    title: artifact.title,
    files: files ?? (await services.files.manifest(artifact.id)),
  });

  router.get(
    route(LINK_ROUTES.hello),
    withAgent<C>(async (_request, ctx, agent) => {
      const features: NonNullable<LinkHello['features']> = {
        ...(services.pages ? { pages: 1 as const } : {}),
        ...(services.siteTypes ? { types: 1 as const } : {}),
      };
      const hello: LinkHello = {
        openArtifact: 1,
        version: services.version,
        user: linkUserOf(agent.user),
        limits: { maxBodyBytes: LINK_MAX_BODY_BYTES, maxFileBytes: LINK_MAX_FILE_BYTES },
        ...(Object.keys(features).length ? { features } : {}),
        ...(services.siteTypes ? { typesPublish: ctx.config.typesPublish ?? 'admins' } : {}),
      };
      return json(hello);
    }),
  );

  router.get(
    route(LINK_ROUTES.artifacts),
    withAgent<C>(async (request, ctx, agent) => {
      const rows = (await ctx.catalog.listArtifactsFor({ id: agent.user.id })).filter((row) => row.ownerUser === agent.user.id && row.trashedAt === null);
      // The files only when asked: a manifest per artifact (on Cloudflare, a call to each artifact's object).
      const withFiles = new URL(request.url).searchParams.get('files') === '1';
      const artifacts: LinkArtifactSummary[] = [];
      for (const row of rows) {
        const summary: LinkArtifactSummary = { id: row.id, url: `${ctx.config.appOrigin}${shellPath(row.id)}`, type: row.type, title: row.title };
        if (withFiles) {
          try {
            summary.files = await services.files.manifest(row.id);
          } catch {
            // A record without a folder (removed by hand): listed with no files.
            summary.files = {};
          }
        }
        artifacts.push(summary);
      }
      const result: LinkArtifactsResult = { artifacts };
      return json(result);
    }),
  );

  router.post(
    route(LINK_ROUTES.import),
    withAgent<C>(async (request, ctx, agent) => {
      const query = new URL(request.url).searchParams;
      const id = query.get('id') ?? '';
      if (!ARTIFACT_ID.test(id)) throw invalid('id is an artifact id (art_ + 10 to 40 lower-case letters and digits).');
      const type = (request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      if (type !== ARCHIVE_CONTENT_TYPE && type !== 'application/x-zip-compressed') throw httpError('invalid_argument', 'Send the artifact archive as Content-Type: application/zip.', { status: 415 });
      const existing = await ctx.catalog.getArtifact(id);
      // The id is taken, unless by an artifact this person unpublished (it is in their trash): publishing it again
      // from the same computer replaces it, its sharing included. Anyone else's, or one not trashed, is a conflict.
      const replaces = existing !== undefined && existing.trashedAt !== null && existing.ownerUser === agent.user.id;
      if (existing && !replaces) throw httpError('conflict', `The id ${id} is in use on this host.`, { status: 409, fix: 'Mint another id and import again.' });
      const bytes = await readBody(request, LINK_MAX_BODY_BYTES);
      if (bytes.byteLength === 0) throw invalid('The archive is empty.');
      // Replacing removes the old one first, so a guard is asked before that, with the type the daemon names (or
      // the old one's), and again below if the archive turns out to hold another type.
      const askedType = existing && replaces ? (query.get('type') ?? '').trim() || existing.type : undefined;
      if (existing && replaces && askedType) await guards.linkPublish(ctx, agent, existing, { type: askedType, bytes: bytes.byteLength, replaces: true });
      if (existing && replaces) {
        await services.removeArtifact(id);
        await ctx.catalog.deleteArtifact(id);
        await ctx.catalog.appendAudit({ actorKind: 'agent', actorId: agent.id, artifactId: id, action: 'link.import_replaced', detail: { title: existing.title, trashedAt: existing.trashedAt, user: agent.user.id } });
        await services.refreshAccess(id);
      }
      let imported: { type: string; title: string };
      try {
        imported = await services.importArchive(id, bytes);
      } catch (error) {
        if ((error as { code?: unknown }).code === 'exists') throw httpError('conflict', `The id ${id} is in use on this host.`, { status: 409, fix: 'Mint another id and import again.' });
        throw error;
      }
      // The title the content declares (its type's `titleFrom`, e.g. a doc's name) wins, as it does on every later
      // change; the daemon's title (a folder name for an adopted folder) only stands in when the content has none.
      const declared = (await services.contentTitle(id, imported.type).catch(() => undefined))?.trim().slice(0, MAX_TITLE);
      const title = declared || (query.get('title') ?? '').trim().slice(0, MAX_TITLE) || imported.title.trim().slice(0, MAX_TITLE) || 'Untitled';
      if (ctx.plugins) {
        try {
          if (imported.type !== askedType) await guards.linkPublish(ctx, agent, undefined, { type: imported.type, bytes: bytes.byteLength, replaces });
          if (!replaces) await guards.create(ctx, agent, { type: imported.type, title, via: 'link' });
        } catch (error) {
          await services.removeArtifact(id).catch(() => undefined);
          throw error;
        }
      }
      const row = await ctx.catalog.createArtifact({ id, type: imported.type, title, ownerUser: agent.user.id });
      emitEvent(ctx, 'artifact.created', { ...eventBase(row, agent), via: 'link' });
      await ctx.catalog.appendAudit({ actorKind: 'agent', actorId: agent.id, artifactId: id, action: 'link.import', detail: { type: imported.type, bytes: bytes.byteLength, user: agent.user.id } });
      services.events.emit('artifact-changed', { id, author: LINK_AUTHOR });
      return json(await linkArtifact(ctx, row), { status: 201 });
    }),
  );

  router.get(
    route(LINK_ROUTES.export),
    withAgent<C>(async (request, ctx, agent) => {
      const artifact = await ownedArtifact(ctx, agent, new URL(request.url).searchParams.get('id'));
      await guards.export(ctx, agent, artifact, { format: 'zip' });
      return services.archive(artifact.id, request.method === 'HEAD' ? 'HEAD' : 'GET');
    }),
  );

  router.get(
    route(LINK_ROUTES.manifest),
    withAgent<C>(async (request, ctx, agent) => {
      const artifact = await ownedArtifact(ctx, agent, new URL(request.url).searchParams.get('id'));
      const manifest: LinkManifest = { id: artifact.id, title: artifact.title, files: await services.files.manifest(artifact.id) };
      return json(manifest);
    }),
  );

  router.get(
    route(LINK_ROUTES.files),
    withAgent<C>(async (request, ctx, agent) => {
      const query = new URL(request.url).searchParams;
      const artifact = await ownedArtifact(ctx, agent, query.get('id'));
      const path = query.get('path') ?? '';
      const file = path ? await services.files.read(artifact.id, path) : null;
      if (!file) throw httpError('not_found', `No file ${path} in ${artifact.id}.`, { status: 404 });
      return new Response(file.bytes as Uint8Array<ArrayBuffer>, {
        headers: { 'content-type': 'application/octet-stream', etag: `"${file.etag}"`, 'content-length': String(file.bytes.byteLength), 'cache-control': 'no-store' },
      });
    }),
  );

  router.post(
    route(LINK_ROUTES.files),
    withAgent<C>(async (request, ctx, agent) => {
      const body = await bodyWithId(request, LINK_MAX_BODY_BYTES);
      const artifact = await ownedArtifact(ctx, agent, body.id);
      const writes = writesOf(body.writes);
      const results = await services.files.write(artifact.id, writes, LINK_AUTHOR);
      const paths = results.filter((result) => !('conflict' in result)).map((result) => result.path);
      let title: string | undefined;
      if (paths.length > 0) {
        // A push of the file the type reads its title from renames the artifact; the answer says so.
        const held = await services.contentTitle(artifact.id, artifact.type);
        if (held && held !== artifact.title) title = held;
        await ctx.catalog.touchArtifact(artifact.id, title ? { title } : {});
        services.events.emit('artifact-touched', { id: artifact.id, author: LINK_AUTHOR, paths, ...(title ? { title } : {}) });
        emitEvent(ctx, 'artifact.changed', { ...eventBase(title ? { ...artifact, title } : artifact, agent), changes: { files: paths, ...(title ? { title } : {}) } });
      }
      const answer: LinkFilesResult = { results, ...(title ? { title } : {}) };
      return json(answer);
    }),
  );

  // A page artifact's declared capabilities: `.artifact.json` never travels in a file push, so they have their own route.
  router.post(
    route(LINK_ROUTES.capabilities),
    withAgent<C>(async (request, ctx, agent) => {
      const body = await bodyWithId(request);
      const artifact = await ownedArtifact(ctx, agent, body.id);
      if (!services.pages) throw httpError('unsupported', 'This host runs no page artifacts.', { status: 400 });
      if (!isRecord(body.capabilities)) throw invalid('capabilities is an object (the `.artifact.json` block).');
      await services.pages.setCapabilities(artifact.id, body.capabilities, LINK_AUTHOR);
      return json({});
    }),
  );

  router.post(
    route(LINK_ROUTES.call),
    withAgent<C>(async (request, ctx, agent) => {
      const body = await bodyWithId(request, LINK_MAX_BODY_BYTES);
      const artifact = await ownedArtifact(ctx, agent, body.id);
      const action = body.action;
      if (typeof action !== 'string' || !ACTION_NAME.test(action)) throw invalid('action is the name of an action.');
      if (LINK_REFUSED_ACTIONS.has(action)) throw httpError('unsupported', `${action} is not available on a hosted server; run it on the working copy.`, { status: 400 });
      if (body.args !== undefined && body.args !== null && !isRecord(body.args)) throw invalid('args is an object.');
      const args = isRecord(body.args) ? body.args : {};
      return json(await services.action(artifact.id, action, args));
    }),
  );

  router.post(
    route(LINK_ROUTES.unpublish),
    withAgent<C>(async (request, ctx, agent) => {
      const body = await bodyWithId(request);
      const artifact = await ownedArtifact(ctx, agent, body.id);
      await guards.delete(ctx, agent, artifact, { permanent: false });
      await ctx.catalog.trashArtifact(artifact.id);
      await ctx.catalog.appendAudit({ actorKind: 'agent', actorId: agent.id, artifactId: artifact.id, action: 'link.unpublish', detail: { user: agent.user.id } });
      await services.refreshAccess(artifact.id);
      services.events.emit('artifact-changed', { id: artifact.id, author: LINK_AUTHOR });
      services.events.emit('access-changed', { id: artifact.id });
      emitEvent(ctx, 'artifact.trashed', eventBase(artifact, agent));
      return json({});
    }),
  );

  linkTypeRoutes(router, services.siteTypes, withAgent<C>);

  router.post(
    route(LINK_ROUTES.ack),
    withAgent<C>(async (request, ctx, agent) => {
      const body = await readJson<unknown>(request, LINK_JSON_BYTES);
      if (!isRecord(body) || !Array.isArray(body.ids)) throw invalid('The body is {ids: ["<event id>", …]}.');
      if (body.ids.length > LINK_MAX_WRITES) throw httpError('too_large', `At most ${LINK_MAX_WRITES} ids per request.`);
      const ids: number[] = [];
      for (const value of body.ids) {
        const id = typeof value === 'string' && /^\d{1,15}$/.test(value) ? Number(value) : typeof value === 'number' && Number.isSafeInteger(value) ? value : NaN;
        if (!(id > 0)) throw invalid('Each id is an event id from link.events.');
        ids.push(id);
      }
      await ctx.catalog.ackOutbox(agent.user.id, ids);
      return json({});
    }),
  );

  router.get(
    route(LINK_ROUTES.events),
    withAgent<C>(async (request, ctx, agent) => {
      const userId = agent.user.id;
      const cursorText = new URL(request.url).searchParams.get('after') ?? request.headers.get('last-event-id') ?? '';
      let cursor = /^\d{1,15}$/.test(cursorText.trim()) ? Number(cursorText.trim()) : 0;
      const encoder = new TextEncoder();
      let closed = false;
      let off: (() => void) | null = null;
      let timer: ReturnType<typeof setInterval> | null = null;
      let queue = Promise.resolve();

      const finish = (): void => {
        if (closed) return;
        closed = true;
        off?.();
        if (timer) clearInterval(timer);
        services.presence.disconnected(userId);
      };

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const close = (): void => {
            finish();
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          };
          const send = (text: string): boolean => {
            if (closed) return false;
            try {
              controller.enqueue(encoder.encode(text));
              return true;
            } catch {
              close();
              return false;
            }
          };
          /** Sends every row after the cursor, a page at a time. */
          const pump = (): void => {
            queue = queue
              .then(async () => {
                for (;;) {
                  if (closed) return;
                  const rows = await ctx.catalog.listOutbox(userId, cursor, 100);
                  const sent: number[] = [];
                  for (const row of rows) {
                    if (closed) return;
                    cursor = row.id;
                    const event = linkEventOf(row);
                    if (!event) continue;
                    // A wake goes to a Link or to an MCP call, never both: take it first (the same atomic claim).
                    if (row.kind === 'wake' && !(await ctx.catalog.claimOutbox(row.id, userId, 'link'))) continue;
                    if (send(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`)) sent.push(row.id);
                  }
                  await ctx.catalog.markOutboxDelivered(sent);
                  if (rows.length < 100) return;
                }
              })
              .catch((error: unknown) => ctx.log(`link events: ${error instanceof Error ? error.message : String(error)}`));
          };
          services.presence.connected(userId);
          off = services.events.on('outbox', (payload) => {
            if (payload.userId === userId) pump();
          });
          timer = setInterval(() => send(': ping\n\n'), LINK_HEARTBEAT_MS);
          request.signal.addEventListener('abort', close, { once: true });
          send(': hello\n\n');
          if (request.signal.aborted) close();
          else pump();
        },
        cancel() {
          finish();
        },
      });
      return new Response(stream, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
    }),
  );

  return router;
}
