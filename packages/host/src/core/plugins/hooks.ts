/**
 * Where the host's code meets the plugins: one helper per guarded action and per event, each a no-op (one property
 * read) when the site runs no plugin, so a host without plugins does no extra work per request.
 *
 * Every path that performs a guarded action (an app route, a Link route, an MCP tool, a sign-in page) calls the one
 * helper for it, so the plugins hear the same question whichever way the action comes. `test/plugins-guard.test.ts`
 * walks {@link GUARD_PATHS} and checks each path asks.
 *
 * Platform neutral.
 */

import type { ArtifactRef, GuardDetails, PluginEventMap, PluginEventName } from '@open-artifact/host-plugin';
import type { CloudSiteUi } from '@open-artifact/protocol';
import type { AuditRecord, ArtifactRow, Principal } from '../types.ts';
import type { BaseCtx } from '../http.ts';
import { OpenArtifactError } from '@open-artifact/protocol';
import { actorOf, artifactRef, userInfo, type Plugins } from './registry.ts';
import type { Catalog } from '../catalog/catalog.ts';
import type { WakeRequestItem } from '@open-artifact/protocol';

/** What a guard helper needs: the context's plugins (absent: no plugin runs). */
type GuardCtx = Pick<BaseCtx, 'plugins'>;

/**
 * Every guarded action and the paths that perform it (route or tool names), for the coverage test and the docs.
 * A path added for an action must call that action's helper below.
 */
export const GUARD_PATHS: Readonly<Record<keyof GuardDetails, readonly string[]>> = {
  'artifact.create': ['POST /api/open-artifact.artifacts.import (after unpacking)', 'POST /api/open-artifact.link.import (a new id)', 'MCP Artifact publish (create)'],
  'artifact.import': ['POST /api/open-artifact.artifacts.import'],
  'artifact.delete': ['POST /api/open-artifact.artifacts.delete', 'POST /api/open-artifact.artifacts.purge', 'POST /api/open-artifact.link.unpublish', 'MCP Artifact delete'],
  'artifact.export': ['GET /api/open-artifact.artifact.archive', 'GET /api/open-artifact.link.export'],
  'share.change': ['POST /api/open-artifact.artifact.share'],
  'link.connect': ['POST /link/device (approve)'],
  'link.publish': ['POST /api/open-artifact.link.import'],
  'type.publish': ['POST /api/open-artifact.link.types.import'],
  'mcp.connect': ['POST /oauth/authorize (approve)'],
  'agent.ask': ['POST /api/open-artifact.artifacts.ask'],
};

async function ask<A extends keyof GuardDetails>(ctx: GuardCtx, action: A, principal: Principal, artifact: ArtifactRow | undefined, detail: GuardDetails[A]): Promise<void> {
  const plugins = ctx.plugins;
  if (!plugins) return;
  await plugins.guard(action, { principal, ...(artifact ? { artifact } : {}), detail });
}

/** Throws the plugin's refusal (403 `not_granted`, its sentence) when a guard denies; otherwise returns. */
export const guards = {
  create: (ctx: GuardCtx, principal: Principal, detail: GuardDetails['artifact.create']) => ask(ctx, 'artifact.create', principal, undefined, detail),
  import: (ctx: GuardCtx, principal: Principal, detail: GuardDetails['artifact.import']) => ask(ctx, 'artifact.import', principal, undefined, detail),
  delete: (ctx: GuardCtx, principal: Principal, artifact: ArtifactRow, detail: GuardDetails['artifact.delete']) => ask(ctx, 'artifact.delete', principal, artifact, detail),
  export: (ctx: GuardCtx, principal: Principal, artifact: ArtifactRow, detail: GuardDetails['artifact.export']) => ask(ctx, 'artifact.export', principal, artifact, detail),
  share: (ctx: GuardCtx, principal: Principal, artifact: ArtifactRow, detail: GuardDetails['share.change']) => ask(ctx, 'share.change', principal, artifact, detail),
  linkConnect: (ctx: GuardCtx, principal: Principal, detail: GuardDetails['link.connect']) => ask(ctx, 'link.connect', principal, undefined, detail),
  linkPublish: (ctx: GuardCtx, principal: Principal, artifact: ArtifactRow | undefined, detail: GuardDetails['link.publish']) => ask(ctx, 'link.publish', principal, artifact, detail),
  typePublish: (ctx: GuardCtx, principal: Principal, detail: GuardDetails['type.publish']) => ask(ctx, 'type.publish', principal, undefined, detail),
  mcpConnect: (ctx: GuardCtx, principal: Principal, detail: GuardDetails['mcp.connect']) => ask(ctx, 'mcp.connect', principal, undefined, detail),
  ask: (ctx: GuardCtx, principal: Principal, artifact: ArtifactRow, detail: GuardDetails['agent.ask']) => ask(ctx, 'agent.ask', principal, artifact, detail),
};

/**
 * For a page (not an API): runs `check` and answers the refusal's sentence when a guard denies, or null when it
 * lets the action happen. Any other error is thrown on.
 */
export async function guardSentence(check: () => Promise<void>): Promise<string | null> {
  try {
    await check();
    return null;
  } catch (error) {
    if (error instanceof OpenArtifactError && error.code === 'not_granted') return error.message;
    throw error;
  }
}

/**
 * Hands an event to the plugins after the fact, never waiting (the request's `waitUntil` keeps it alive on a
 * Worker). A no-op without plugins.
 */
export function emitEvent<E extends PluginEventName>(ctx: Pick<BaseCtx, 'plugins' | 'waitUntil'>, event: E, payload: PluginEventMap[E]): void {
  const plugins = ctx.plugins;
  if (!plugins) return;
  plugins.emit(event, payload, ctx.waitUntil);
}

/** An artifact row and who acted, as most events carry them. */
export function eventBase(artifact: Pick<ArtifactRow, 'id' | 'type' | 'title' | 'ownerUser'>, by: Principal): { artifact: ArtifactRef; by: ReturnType<typeof actorOf> } {
  return { artifact: artifactRef(artifact), by: actorOf(by) };
}

/**
 * The one wrapper every audit entry goes through to the plugins (`on.audit`): set as the catalog's `onAudit` when a
 * plugin listens to `audit`. `waitUntil` is the platform's (on a Worker the request's work is kept alive by the
 * host calling `plugins.idle()` under `waitUntil` once the response is out).
 */
export function auditToPlugins(plugins: Plugins): (record: AuditRecord) => void {
  return (record) => {
    plugins.emit('audit', {
      action: record.action,
      actor: { kind: record.actorKind, id: record.actorId },
      artifact: record.artifactId,
      detail: record.detail,
      at: record.at,
    });
  };
}

/**
 * Whether a plugin's link or logo address may reach a page: a path on this site, an `https:` URL, or this site's own
 * address (`http:` only for a site served over `http:`).
 */
export function pageSafeHref(href: string, appOrigin: string): boolean {
  if (href.startsWith('/')) return !href.startsWith('//') && !href.startsWith('/\\') && !/[\u0000-\u001f\u007f\\]/.test(href);
  try {
    const url = new URL(href);
    return url.protocol === 'https:' || url.origin === appOrigin;
  } catch {
    return false;
  }
}

/** What the site's plugins add to its pages ({@link CloudSiteUi}), or undefined when nothing (or no plugin). */
export function siteUi(ctx: Pick<BaseCtx, 'plugins' | 'config'>): CloudSiteUi | undefined {
  if (!ctx.plugins) return undefined;
  const ui = ctx.plugins.ui();
  const links = ui.links.filter((link) => pageSafeHref(link.href, ctx.config.appOrigin)).map(({ label, href, where }) => ({ label, href, where }));
  const brand = ui.brand
    ? { ...(ui.brand.name ? { name: ui.brand.name } : {}), ...(ui.brand.logoUrl && pageSafeHref(ui.brand.logoUrl, ctx.config.appOrigin) ? { logoUrl: ui.brand.logoUrl } : {}) }
    : undefined;
  const hasBrand = brand !== undefined && (brand.name !== undefined || brand.logoUrl !== undefined);
  if (links.length === 0 && !hasBrand) return undefined;
  return { ...(links.length > 0 ? { links } : {}), ...(hasBrand ? { brand } : {}) };
}

/**
 * Offers a page's wake (its requests to the owner's agent) to the plugins with `wake.deliver` before the host puts
 * it in the owner's outbox: true when one delivered it (then there is no outbox entry). A wake that also carries
 * comment threads, or carries no request, is not offered: those go to the outbox as always. False without plugins.
 */
export async function offerWake(
  plugins: Plugins | undefined,
  catalog: Pick<Catalog, 'getUser'>,
  artifact: ArtifactRow,
  body: { requests?: ReadonlyArray<Omit<WakeRequestItem, 'id'> & { id?: string }>; threads?: readonly unknown[] },
  now: () => Date,
): Promise<boolean> {
  if (!plugins || !body.requests || body.requests.length === 0 || (body.threads && body.threads.length > 0)) return false;
  const owner = await catalog.getUser(artifact.ownerUser);
  if (!owner) return false;
  const from = body.requests.find((request) => request.from)?.from;
  const requests = body.requests.map((request, index) => ({ id: request.id ?? `wake_${now().getTime().toString(36)}_${index}`, text: request.text, sentAt: request.sentAt ?? now().toISOString(), ...(request.label ? { label: request.label } : {}) }));
  return plugins.deliverWake({ artifact, owner: userInfo(owner), payload: { kind: 'wake', requests }, from: from ?? { name: owner.name, role: 'owner', userId: owner.id } });
}
