/**
 * The Library API on the host (`/api/open-artifact.*`), as the Shell and the home page call it: the person's
 * artifacts with their role on each, rename and per-person pins, trash and restore, the archive, an uploaded
 * archive as a new artifact (decision 21), the Shell's boot, and Ask (a request into the owner's outbox).
 */

import { ARCHIVE_CONTENT_TYPE, type ArtifactDetail, type AskRequest, type CloudAskAnswer, type UpdateArtifactRequest, type WakeRequestItem } from '@open-artifact/protocol';
import { newArtifactId, purgeArtifact } from '../catalog/catalog.ts';
import { loadPrincipal, principalRef, type PrincipalRef } from '../authz/access.ts';
import { effectiveRole, roleAtLeast } from '../authz/roles.ts';
import { httpError, json, readBody, readJson, type Router } from '../http.ts';
import type { ArtifactRole, ArtifactRow } from '../types.ts';
import type { GrantSubjectQuery } from '../catalog/catalog.ts';
import { emitEvent, eventBase, guards } from '../plugins/hooks.ts';
import { userInfo } from '../plugins/registry.ts';
import { IMPORT_MAX_BYTES, type AppCtx } from './services.ts';
import { artifactView, artifactViewFor, cloudAgent, noArtifact, personOf, reach, shellBoot, signedIn, visit } from './views.ts';

/** Cap on a Library write's JSON body. */
export const LIBRARY_BODY_BYTES = 64 * 1024;
/** Longest title. */
export const MAX_TITLE = 200;
/** Longest Ask text, as the daemon keeps it. */
export const MAX_ASK_TEXT = 4000;

const invalid = (message: string): Error => httpError('invalid_argument', message, { status: 400 });
const refused = (message: string): Error => httpError('not_granted', message, { status: 403 });
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** The `id` of a JSON write body. */
async function bodyWithId<T extends { id: string }>(request: Request): Promise<T> {
  const body = await readJson<unknown>(request, LIBRARY_BODY_BYTES);
  if (!isRecord(body) || typeof body.id !== 'string' || !body.id) throw invalid('The body is {id, …}.');
  return body as unknown as T;
}

/** Whether the role may download the folder or export: anyone but a viewer, a viewer when the owner allows it. */
export function mayExport(role: ArtifactRole, artifact: Pick<ArtifactRow, 'settings'>): boolean {
  return role !== 'viewer' || artifact.settings.viewersCanExport;
}

/** Whether the role may ask the owner's agent: the owner, an editor when the owner allows it. */
export function mayAsk(role: ArtifactRole, artifact: Pick<ArtifactRow, 'settings'>): boolean {
  return role === 'owner' || (role === 'editor' && artifact.settings.editorsCanAskAgent);
}

/**
 * The artifacts a person (or their agent) can open, each with their role on it, the person's pin and whether it is
 * shared: what `AccessCache.role` answers row by row, worked out from one read ({@link Catalog.listArtifactsWithAccess})
 * so the number of queries does not grow with the list. The principal is loaded as the catalog has it now (decision
 * 15); `query` names who the grants are matched against. Without `trashed`, trashed artifacts are left out.
 */
export async function artifactsWithRoles(
  ctx: Pick<AppCtx, 'catalog' | 'config' | 'now'> & Partial<Pick<AppCtx, 'access' | 'plugins'>>,
  ref: PrincipalRef,
  query: GrantSubjectQuery,
  options: { trashed?: boolean } = {},
): Promise<Array<{ row: ArtifactRow; role: ArtifactRole; pinned: boolean; shared: boolean }>> {
  const [listed, principal] = await Promise.all([
    ctx.catalog.listArtifactsWithAccess(query, options),
    loadPrincipal(ctx.catalog, ctx.config, ref, { groupsOf: (id) => ctx.catalog.userGroups(id) }),
  ]);
  if (!principal) return [];
  // A plugin with `authz.role` may change each role, and one with `authz.artifacts` may add artifacts: one more
  // read for the access generation and one for the added rows, whatever the list's length.
  const access = ctx.access?.hasPluginRoles ? ctx.access : undefined;
  const rows: Array<ArtifactRow & { hasGrants: boolean }> = [...listed.rows];
  let generation = 1;
  if (ctx.plugins || access) {
    const [stamp, extra] = await Promise.all([
      access ? ctx.catalog.accessStamp() : undefined,
      ctx.plugins?.hasArtifactsHook && !options.trashed ? ctx.plugins.extraArtifacts(principal) : [],
    ]);
    if (stamp) generation = stamp.generation;
    const listedIds = new Set(rows.map((row) => row.id));
    const missing = extra.filter((id) => !listedIds.has(id));
    if (missing.length > 0) {
      for (const row of (await ctx.catalog.getArtifacts(missing)).values()) rows.push({ ...row, hasGrants: true }); // a plugin shares it
    }
  }
  const now = ctx.now();
  const out: Array<{ row: ArtifactRow; role: ArtifactRole; pinned: boolean; shared: boolean }> = [];
  for (const { hasGrants, ...row } of rows) {
    // Shared through a link the person opened (decision 20): only while that link still works.
    const userLinks = listed.guests.filter((guest) => guest.artifactId === row.id).map((guest) => guest.linkId);
    const links = userLinks.length > 0 ? listed.links.filter((link) => link.artifactId === row.id) : [];
    const hostRole = effectiveRole(principal, row, listed.grants, ctx.config, { links, userLinks, now });
    if (!options.trashed && row.trashedAt !== null) continue;
    const role = access ? await access.pluginRole(principal, row, hostRole ?? null, generation) : hostRole;
    if (!role) continue;
    out.push({ row, role, pinned: listed.pins.has(row.id), shared: row.generalAccess !== 'restricted' || hasGrants });
  }
  if (rows.length > listed.rows.length) out.sort((a, b) => (a.row.updatedAt < b.row.updatedAt ? 1 : a.row.updatedAt > b.row.updatedAt ? -1 : 0));
  return out;
}

/** Registers the Library routes. */
export function libraryRoutes(router: Router<AppCtx>): void {
  router.get('/api/open-artifact.artifacts', async (request, ctx) => {
    const { auth, person } = await signedIn(request, ctx);
    const trashed = new URL(request.url).searchParams.get('trashed') === '1';
    const query = { id: person.id, email: person.email ?? null, emailVerified: person.emailVerified === true, ...(person.groups ? { groups: person.groups } : {}) };
    const artifacts = (await artifactsWithRoles(ctx, principalRef(auth.principal), query, { trashed })).map(({ row, role, pinned, shared }) => artifactView(ctx, row, role, { pinned, shared }));
    const headers = auth.setCookie ? { 'set-cookie': auth.setCookie } : undefined;
    return json({ artifacts }, headers ? { headers } : {});
  });

  router.get('/api/open-artifact.artifact', async (request, ctx) => {
    const id = new URL(request.url).searchParams.get('id') ?? '';
    const { access, principal } = await reach(request, ctx, id);
    const view = await artifactViewFor(ctx, access.artifact, access.role, personOf(principal));
    // The folder's size is the platform's; the catalog does not keep it.
    const detail: ArtifactDetail = { ...view, bytes: 0, agent: await cloudAgent(ctx, access.artifact.ownerUser) };
    return json(detail);
  });

  router.get('/api/open-artifact.artifacts.boot', async (request, ctx) => {
    const id = new URL(request.url).searchParams.get('id') ?? '';
    const { access } = await reach(request, ctx, id);
    return json(await shellBoot(ctx, access.artifact, access.principal, access.role));
  });

  router.post('/api/open-artifact.artifacts.update', async (request, ctx) => {
    const body = await bodyWithId<UpdateArtifactRequest>(request);
    const { access, principal } = await reach(request, ctx, body.id);
    const person = personOf(principal);
    if (body.title !== undefined) {
      if (typeof body.title !== 'string') throw invalid('title is a string.');
      if (!roleAtLeast(access.role, 'editor')) throw refused('Only its owner and editors rename an artifact.');
      const title = body.title.trim().slice(0, MAX_TITLE);
      if (!title) throw invalid('The title is empty.');
      if (title !== access.artifact.title) {
        await ctx.catalog.touchArtifact(access.artifact.id, { title });
        ctx.events.emit('artifact-changed', { id: access.artifact.id });
        emitEvent(ctx, 'artifact.changed', { ...eventBase({ ...access.artifact, title }, principal), changes: { title } });
      }
    }
    if (body.pinned !== undefined) {
      if (typeof body.pinned !== 'boolean') throw invalid('pinned is true or false.');
      if (!person) throw refused('Sign in to pin an artifact.');
      await ctx.catalog.setPinned(person.id, access.artifact.id, body.pinned);
    }
    const row = (await ctx.catalog.getArtifact(access.artifact.id)) ?? access.artifact;
    return json(await artifactViewFor(ctx, row, access.role, person));
  });

  router.post('/api/open-artifact.artifacts.delete', async (request, ctx) => {
    const body = await bodyWithId<{ id: string }>(request);
    const { access, principal } = await reach(request, ctx, body.id);
    if (access.role !== 'owner' || principal.kind !== 'user') throw refused('Only its owner deletes an artifact.');
    await guards.delete(ctx, principal, access.artifact, { permanent: false });
    await ctx.catalog.trashArtifact(access.artifact.id);
    await ctx.catalog.appendAudit({ actorKind: 'user', actorId: principal.id, artifactId: access.artifact.id, action: 'artifact.trash' });
    await ctx.refreshAccess(access.artifact.id);
    ctx.events.emit('artifact-changed', { id: access.artifact.id });
    ctx.events.emit('access-changed', { id: access.artifact.id });
    emitEvent(ctx, 'artifact.trashed', eventBase(access.artifact, principal));
    // In the trash, not gone: the folder stays (there is no folder path to show on a host).
    return json({ deleted: access.artifact.id, folderKept: '' });
  });

  router.post('/api/open-artifact.artifacts.restore', async (request, ctx) => {
    const body = await bodyWithId<{ id: string }>(request);
    const seen = await visit(request, ctx, body.id);
    // The owner still has a trashed artifact (and nobody else does).
    if (!seen.access || seen.access.role !== 'owner' || seen.principal.kind !== 'user') throw noArtifact(seen.principal);
    await ctx.catalog.restoreArtifact(seen.access.artifact.id);
    await ctx.catalog.appendAudit({ actorKind: 'user', actorId: seen.principal.id, artifactId: seen.access.artifact.id, action: 'artifact.restore' });
    await ctx.refreshAccess(seen.access.artifact.id);
    ctx.events.emit('artifact-changed', { id: seen.access.artifact.id });
    ctx.events.emit('access-changed', { id: seen.access.artifact.id });
    emitEvent(ctx, 'artifact.restored', eventBase(seen.access.artifact, seen.principal));
    const row = (await ctx.catalog.getArtifact(seen.access.artifact.id)) ?? seen.access.artifact;
    return json(await artifactViewFor(ctx, row, 'owner', seen.principal));
  });

  router.post('/api/open-artifact.artifacts.purge', async (request, ctx) => {
    const body = await bodyWithId<{ id: string }>(request);
    const seen = await visit(request, ctx, body.id);
    // Only the owner, and only from the trash: deleting for good is the second step.
    if (!seen.access || seen.access.role !== 'owner' || seen.principal.kind !== 'user') throw noArtifact(seen.principal);
    if (seen.access.artifact.trashedAt === null) throw httpError('conflict', 'Move the artifact to the trash before deleting it for good.', { status: 409 });
    if (!ctx.removeArtifact) throw httpError('unsupported', 'This host cannot delete artifacts for good.', { status: 501 });
    const id = seen.access.artifact.id;
    await guards.delete(ctx, seen.principal, seen.access.artifact, { permanent: true });
    await purgeArtifact(ctx.catalog, (artifactId) => ctx.removeArtifact!(artifactId), { id, actor: { kind: 'user', id: seen.principal.id }, reason: 'owner' });
    // The object or folder is gone: forget cached answers rather than asking it to refresh.
    ctx.access.invalidate(id);
    ctx.events.emit('artifact-changed', { id });
    ctx.events.emit('access-changed', { id });
    emitEvent(ctx, 'artifact.deleted', { ...eventBase(seen.access.artifact, seen.principal), reason: 'owner' });
    return json({ purged: id });
  });

  router.get('/api/open-artifact.artifact.archive', async (request, ctx) => {
    const id = new URL(request.url).searchParams.get('id') ?? '';
    const { access, principal } = await reach(request, ctx, id);
    if (!mayExport(access.role, access.artifact)) throw refused('The owner does not let viewers download this artifact.');
    await guards.export(ctx, principal, access.artifact, { format: 'zip' });
    return ctx.archive(access.artifact.id, request.method === 'HEAD' ? 'HEAD' : 'GET');
  });

  router.post('/api/open-artifact.artifacts.import', async (request, ctx) => {
    const { auth, person } = await signedIn(request, ctx);
    const type = (request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (type !== ARCHIVE_CONTENT_TYPE && type !== 'application/x-zip-compressed') {
      throw httpError('invalid_argument', 'Send the artifact archive (the Shell\'s "Download .zip") as Content-Type: application/zip.', { status: 415 });
    }
    const bytes = await readBody(request, ctx.importMaxBytes ?? IMPORT_MAX_BYTES);
    if (bytes.byteLength === 0) throw invalid('The archive is empty.');
    await guards.import(ctx, auth.principal, { type: null, bytes: bytes.byteLength, via: 'library' });
    const id = newArtifactId(ctx.now());
    const imported = await ctx.importArchive(id, bytes);
    if (!ctx.typeInfo(imported.type)) throw httpError('unsupported', `The ${imported.type} type is not installed on this host.`, { status: 400 });
    const title = imported.title.trim().slice(0, MAX_TITLE) || 'Untitled';
    if (ctx.plugins) {
      // Now the type is known: a guard may still refuse it, and the unpacked folder goes with the refusal.
      try {
        await guards.create(ctx, auth.principal, { type: imported.type, title, via: 'import' });
      } catch (error) {
        await Promise.resolve(ctx.removeArtifact?.(id)).catch(() => undefined);
        throw error;
      }
    }
    const row = await ctx.catalog.createArtifact({ id, type: imported.type, title, ownerUser: person.id });
    await ctx.catalog.appendAudit({ actorKind: 'user', actorId: person.id, artifactId: id, action: 'artifact.import', detail: { type: imported.type, bytes: bytes.byteLength } });
    ctx.events.emit('artifact-changed', { id });
    emitEvent(ctx, 'artifact.created', { ...eventBase(row, auth.principal), via: 'import' });
    return json(await artifactViewFor(ctx, row, 'owner', person), { status: 201 });
  });

  router.post('/api/open-artifact.artifacts.ask', async (request, ctx) => {
    const body = await bodyWithId<AskRequest>(request);
    const { access, principal } = await reach(request, ctx, body.id);
    if (!mayAsk(access.role, access.artifact)) throw refused(access.role === 'editor' ? 'The owner does not let editors ask their agent.' : 'Only its owner and editors ask the agent.');
    const text = typeof body.text === 'string' ? body.text.trim().slice(0, MAX_ASK_TEXT) : '';
    if (!text) throw invalid('text is required.');
    const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 80) : undefined;
    await guards.ask(ctx, principal, access.artifact, { text, ...(label ? { label } : {}) });
    const sentAt = ctx.now().toISOString();
    const requestItem: WakeRequestItem = { id: `ask_${ctx.now().getTime().toString(36)}`, text, sentAt, ...(label ? { label } : {}) };
    const person = personOf(principal);
    const from = { name: person?.name ?? 'Guest', role: access.role };
    emitEvent(ctx, 'agent.requested', { ...eventBase(access.artifact, principal), owner: access.artifact.ownerUser, text, ...(label ? { label } : {}) });
    if (ctx.plugins) {
      // A plugin with `wake.deliver` may hand the request on itself (a chat bot, a queue): then no outbox entry.
      const owner = await ctx.catalog.getUser(access.artifact.ownerUser);
      const delivered = owner
        ? await ctx.plugins.deliverWake({ artifact: access.artifact, owner: userInfo(owner), payload: { kind: 'wake', requests: [{ ...requestItem, sentAt }] }, from: { ...from, ...(person ? { userId: person.id } : {}) } })
        : false;
      if (delivered) {
        const answer: CloudAskAnswer = { via: 'link', status: 'delivered' };
        return json(answer);
      }
    }
    await ctx.catalog.appendOutbox({
      artifactId: access.artifact.id,
      toUser: access.artifact.ownerUser,
      kind: 'wake',
      payload: { requests: [requestItem], from },
    });
    ctx.events.emit('outbox', { userId: access.artifact.ownerUser });
    // Kept in the outbox either way; a connected computer is told at once (the outbox event above reaches its stream).
    const online = await Promise.resolve(ctx.linkOnline?.(access.artifact.ownerUser) ?? false).catch(() => false);
    const answer: CloudAskAnswer = { via: 'link', status: online ? 'delivered' : 'inbox' };
    return json(answer);
  });
}
