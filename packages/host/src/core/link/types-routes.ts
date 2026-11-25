/**
 * The Link's type catalog routes (`/api/open-artifact.link.types.*`, `protocol/src/link.ts`): publishing a type
 * package to the site, listing the site's types, downloading one, and unpublishing. The rules are the catalog's
 * (`catalog/site-types.ts`); the package's bytes and files are the platform's (`SiteTypeServices`).
 *
 * `types.import`, in order: who may publish (`OA_TYPES_PUBLISH`), the package read and checked (nothing kept yet),
 * the catalog's rules (id, uid, publisher, version), the `type.publish` guard, then the files, the row, the running
 * artifacts told, the old version's files deleted, and an audit entry.
 */

import { ARCHIVE_CONTENT_TYPE, LINK_API_PREFIX, LINK_ROUTES, SITE_TYPE_VISIBILITIES, THIRD_PARTY_NOTICE, TYPE_ID, type LinkSiteType, type LinkTypeImportResult, type LinkTypeUnpublishResult, type LinkTypesResult, type SiteTypeVisibility } from '@open-artifact/protocol';
import { httpError, json, readBody, readJson, type BaseCtx, type Router } from '../http.ts';
import type { AgentPrincipal } from '../types.ts';
import { guards } from '../plugins/hooks.ts';
import { managesSiteType, mayDownloadSiteType, mayListSiteType, SiteTypes, typesPublishRefusal, type SiteTypeActor, type SiteTypeRow } from '../catalog/site-types.ts';
import { LINK_JSON_BYTES, LINK_MAX_BODY_BYTES, type SiteTypeServices } from './services.ts';

type AgentRoute<C extends BaseCtx> = (handler: (request: Request, ctx: C & { params: Record<string, string> }, agent: AgentPrincipal) => Promise<Response>) => (request: Request, ctx: C & { params: Record<string, string> }) => Promise<Response>;

const actorOf = (agent: AgentPrincipal): SiteTypeActor => ({ id: agent.user.id, siteRole: agent.user.siteRole });

/** A row as the Link shows it. */
export async function linkSiteTypes(ctx: BaseCtx, rows: SiteTypeRow[], me: string): Promise<LinkSiteType[]> {
  const users = await ctx.catalog.getUsers([...new Set(rows.map((r) => r.publisherUser))]);
  return rows.map((row) => ({
    id: row.id,
    uid: row.uid,
    name: row.name,
    version: row.version,
    description: row.description,
    visibility: row.visibility,
    publisher: { id: row.publisherUser, name: users.get(row.publisherUser)?.name ?? null },
    mine: row.publisherUser === me,
    unpublished: row.unpublished,
    sha256: row.sha256,
    bytes: row.bytes,
    capabilities: row.capabilities,
    network: row.network,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

function visibilityOf(value: string | null): SiteTypeVisibility | undefined {
  if (value === null || value === '') return undefined;
  if (!(SITE_TYPE_VISIBILITIES as readonly string[]).includes(value)) throw httpError('invalid_argument', `visibility is private, site or link, not ${JSON.stringify(value)}.`, { status: 400 });
  return value as SiteTypeVisibility;
}

/** Registers the `types.*` routes (`withAgent` is the Link's Bearer check). */
export function linkTypeRoutes<C extends BaseCtx>(router: Router<C>, services: SiteTypeServices | undefined, withAgent: AgentRoute<C>): void {
  const route = (name: string): string => `${LINK_API_PREFIX}${name}`;
  const need = (): SiteTypeServices => {
    if (!services) throw httpError('unsupported', 'This host keeps no published types.', { status: 400 });
    return services;
  };

  router.post(
    route(LINK_ROUTES.typesImport),
    withAgent(async (request, ctx, agent) => {
      const site = need();
      const refusal = typesPublishRefusal(ctx.config.typesPublish ?? 'admins', agent.user.siteRole, ctx.config.contentSameSite === true);
      if (refusal) throw httpError('not_granted', refusal, { status: 403, fix: 'Ask a site admin, or keep the type on your computer.' });
      const visibility = visibilityOf(new URL(request.url).searchParams.get('visibility'));
      const contentType = (request.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
      if (contentType !== ARCHIVE_CONTENT_TYPE && contentType !== 'application/x-zip-compressed') throw httpError('invalid_argument', 'Send the type package as Content-Type: application/zip.', { status: 415 });
      const bytes = await readBody(request, LINK_MAX_BODY_BYTES);
      if (bytes.byteLength === 0) throw httpError('invalid_argument', 'The package is empty.', { status: 400 });
      const candidate = await site.read(bytes);
      const catalog = new SiteTypes(ctx.catalog.driver, () => ctx.now());
      const actor = actorOf(agent);
      const plan = await catalog.plan(candidate, actor);
      const kept = plan.change === 'new' ? undefined : plan.previous;
      const finalVisibility = visibility ?? kept?.visibility ?? 'private';
      await guards.typePublish(ctx, agent, { id: candidate.id, uid: candidate.uid, version: candidate.version, bytes: candidate.bytes, visibility: finalVisibility, replaces: plan.change !== 'new' });
      if (plan.change !== 'unchanged') await site.store(candidate, bytes);
      const row = await catalog.save(candidate, actor, plan, visibility);
      if (plan.change !== 'unchanged' || kept?.unpublished || (visibility && visibility !== kept?.visibility)) await site.activated(row);
      if (plan.change === 'version') await site.removeFiles(row.uid, plan.previous.version).catch((error: unknown) => ctx.log(`types: removing ${row.id} ${plan.previous.version}: ${error instanceof Error ? error.message : String(error)}`));
      await ctx.catalog.appendAudit({
        actorKind: 'agent',
        actorId: agent.id,
        action: 'type.publish',
        detail: { id: row.id, uid: row.uid, version: row.version, change: plan.change, ...(kept ? { previous: kept.version } : {}), visibility: row.visibility, bytes: row.bytes, sha256: row.sha256, user: agent.user.id },
      });
      const [type] = await linkSiteTypes(ctx, [row], agent.user.id);
      const answer: LinkTypeImportResult = { type: type!, change: plan.change, ...(plan.change === 'version' ? { previous: plan.previous.version } : {}) };
      return json(answer, { status: plan.change === 'new' ? 201 : 200 });
    }),
  );

  router.get(
    route(LINK_ROUTES.typesList),
    withAgent(async (_request, ctx, agent) => {
      need();
      const actor = actorOf(agent);
      const rows = (await new SiteTypes(ctx.catalog.driver, () => ctx.now()).all()).filter((row) => mayListSiteType(row, actor));
      // The names and descriptions are the publishers' words: an agent reading them is told so.
      const result: LinkTypesResult & { notice: string } = { types: await linkSiteTypes(ctx, rows, agent.user.id), notice: THIRD_PARTY_NOTICE };
      return json(result);
    }),
  );

  router.get(
    route(LINK_ROUTES.typesArchive),
    withAgent(async (request, ctx, agent) => {
      const site = need();
      const id = new URL(request.url).searchParams.get('id') ?? '';
      if (!TYPE_ID.test(id)) throw httpError('invalid_argument', 'id is a type id.', { status: 400 });
      const row = await new SiteTypes(ctx.catalog.driver, () => ctx.now()).byId(id);
      if (!row || !mayDownloadSiteType(row, actorOf(agent))) throw httpError('not_found', `No type ${id} you may see on this site.`, { status: 404 });
      const bytes = await site.package(row.uid, row.version);
      if (!bytes) throw httpError('not_found', `The package of ${id} ${row.version} is missing on this site.`, { status: 404 });
      return new Response(request.method === 'HEAD' ? null : (bytes as Uint8Array<ArrayBuffer>), {
        headers: {
          'content-type': ARCHIVE_CONTENT_TYPE,
          'content-length': String(bytes.byteLength),
          'content-disposition': `attachment; filename="${row.id}-${row.version}.oatype"`,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        },
      });
    }),
  );

  router.post(
    route(LINK_ROUTES.typesUnpublish),
    withAgent(async (request, ctx, agent) => {
      const site = need();
      const body = await readJson<unknown>(request, LINK_JSON_BYTES);
      const id = body && typeof body === 'object' && typeof (body as { id?: unknown }).id === 'string' ? (body as { id: string }).id : '';
      if (!TYPE_ID.test(id)) throw httpError('invalid_argument', 'The body is {id: "<type id>"}.', { status: 400 });
      const catalog = new SiteTypes(ctx.catalog.driver, () => ctx.now());
      const row = await catalog.byId(id);
      if (!row || !mayListSiteType(row, actorOf(agent))) throw httpError('not_found', `No type ${id} you may see on this site.`, { status: 404 });
      if (!managesSiteType(row, actorOf(agent))) throw httpError('not_granted', `${id} was published by someone else: only its publisher or a site admin may unpublish it.`, { status: 403 });
      const artifacts = await catalog.artifactCount(id);
      if (artifacts > 0) {
        await catalog.delist(row.uid);
        await site.activated((await catalog.get(row.uid))!);
      } else {
        await catalog.remove(row.uid);
        await site.removed(row);
        await site.removeFiles(row.uid).catch((error: unknown) => ctx.log(`types: removing ${row.id}: ${error instanceof Error ? error.message : String(error)}`));
      }
      await ctx.catalog.appendAudit({ actorKind: 'agent', actorId: agent.id, action: 'type.unpublish', detail: { id, uid: row.uid, version: row.version, removed: artifacts === 0, artifacts, user: agent.user.id } });
      const answer: LinkTypeUnpublishResult = { id, uid: row.uid, removed: artifacts === 0, artifacts };
      return json(answer);
    }),
  );
}
