/**
 * Who is asking about which artifact, and the objects the Shell and the home page read: `ArtifactView`, `ShellBoot`,
 * `HomeBoot`.
 */

import { ARTIFACT_ID, shellPath, type ArtifactView, type CloudAgentView, type HomeBoot, type ShellBoot, type ShellCloud } from '@open-artifact/protocol';
import { principalRef, type CachedAccess } from '../authz/access.ts';
import { authenticate, type Authentication } from '../auth/session.ts';
import { SIGN_IN_PATH, SIGN_OUT_PATH } from '../auth/routes.ts';
import { httpError } from '../http.ts';
import { MCP_HARNESS, MCP_PRESENT_MS } from '../mcp/oauth.ts';
import { siteUi } from '../plugins/hooks.ts';
import type { ArtifactRole, ArtifactRow, Principal, UserPrincipal } from '../types.ts';
import { IMPORT_MAX_BYTES, type AppCtx } from './services.ts';

/** The agent name pages show when the owner has never linked one (as the rooms say). */
export const DEFAULT_AGENT_NAME = 'Agent';

/** A request's principal and their live access to one artifact. */
export interface Visit {
  auth: Authentication;
  principal: Principal;
  /** Null: no such artifact, or no access. A trashed artifact still answers for its owner (see {@link live}). */
  access: CachedAccess | null;
  /** The plugin whose `authz.role` failed on this request (then `access` is null: fail closed), else null. */
  checkFailed: string | null;
}

/** What a signed-in person is told when a permission plugin's check failed (the operator sees why in the audit log). */
export const CHECK_FAILED_SENTENCE = "A permission check could not be completed just now. Try again in a moment; if it persists, the site's operator can see why in the audit log.";

/** Who makes the request (a guest of `artifactId` by its cookie too) and their role on it now. A bad Bearer is a 401. */
export async function visit(request: Request, ctx: AppCtx, artifactId: string): Promise<Visit> {
  const auth = await authenticate(request, ctx, ARTIFACT_ID.test(artifactId) ? { artifactId } : {});
  if (auth.invalid.includes('bearer')) throw httpError('unauthorized', 'The access token is expired, revoked or unknown.', { status: 401 });
  let checkFailed: string | null = null;
  const access = ARTIFACT_ID.test(artifactId) ? await ctx.access.role(artifactId, principalRef(auth.principal), { onCheckFailed: (plugin) => void (checkFailed = plugin) }) : null;
  return { auth, principal: auth.principal, access, checkFailed };
}

/** The access when the artifact is not in the trash. */
export function live(access: CachedAccess | null): CachedAccess | null {
  return access && access.artifact.trashedAt === null ? access : null;
}

/** The person behind a principal (an agent's user), or null for a guest or anonymous visitor. */
export function personOf(principal: Principal): UserPrincipal | null {
  if (principal.kind === 'agent') return principal.user;
  return principal.kind === 'user' ? principal : null;
}

/** The same answer for "no such artifact" and "not yours to see": nothing is revealed either way. */
export function noArtifact(principal: Principal): Error {
  if (principal.kind === 'anonymous') return httpError('unauthorized', 'Sign in to open this artifact.', { status: 401 });
  return httpError('not_found', 'No such artifact, or it is not shared with you.', { status: 404 });
}

/** The artifact the request may reach (not trashed), or the {@link noArtifact} error. */
export async function reach(request: Request, ctx: AppCtx, artifactId: string): Promise<Visit & { access: CachedAccess }> {
  const seen = await visit(request, ctx, artifactId);
  const access = live(seen.access);
  if (!access && seen.checkFailed && personOf(seen.principal)) throw httpError('not_granted', CHECK_FAILED_SENTENCE, { status: 403 });
  if (!access) throw noArtifact(seen.principal);
  return { ...seen, access };
}

/** A signed-in person (session or agent token), or a 401. */
export async function signedIn(request: Request, ctx: AppCtx): Promise<{ auth: Authentication; person: UserPrincipal }> {
  const auth = await authenticate(request, ctx);
  if (auth.invalid.includes('bearer')) throw httpError('unauthorized', 'The access token is expired, revoked or unknown.', { status: 401 });
  const person = personOf(auth.principal);
  if (!person) throw httpError('unauthorized', 'Sign in first.', { status: 401, fix: `Sign in at ${ctx.config.appOrigin}${SIGN_IN_PATH}.` });
  return { auth, person };
}

/** The artifact's Shell address on the host. */
export function artifactUrl(ctx: AppCtx, id: string): string {
  return ctx.config.appOrigin + shellPath(id);
}

/** A Library list item of an artifact, as the viewer sees it. */
export function artifactView(ctx: AppCtx, row: ArtifactRow, role: ArtifactRole, extra: { pinned: boolean; shared: boolean }): ArtifactView {
  const type = ctx.typeInfo(row.type);
  const url = artifactUrl(ctx, row.id);
  return {
    id: row.id,
    url,
    title: row.title,
    type: row.type,
    typeTitle: type?.title ?? row.type,
    typeMissing: !type,
    root: '',
    view_url: url,
    // The bare page needs a page token minted for one person; the list does not mint them.
    page_url: url,
    owner: null,
    pinned: extra.pinned,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    openedAt: null,
    contentAt: row.updatedAt,
    thumbnail: null,
    shared: extra.shared,
    open: false,
    role,
    // Only a trashed one says when it went (the trash list): a live artifact's view is unchanged.
    ...(row.trashedAt !== null ? { trashedAt: row.trashedAt } : {}),
  };
}

/** {@link artifactView} with the pin and shared flags read for this person. */
export async function artifactViewFor(ctx: AppCtx, row: ArtifactRow, role: ArtifactRole, person: UserPrincipal | null): Promise<ArtifactView> {
  const pinned = person ? (await ctx.catalog.pinnedBy(person.id)).has(row.id) : false;
  return artifactView(ctx, row, role, { pinned, shared: await isShared(ctx, row) });
}

/** Whether anyone but the owner may open it: access past `restricted`, or anyone named. */
export async function isShared(ctx: AppCtx, row: ArtifactRow): Promise<boolean> {
  return row.generalAccess !== 'restricted' || (await ctx.catalog.listGrants(row.id)).length > 0;
}

/** The account part both boots carry. */
function cloudAccount(ctx: AppCtx, principal: Principal, returnTo: string): Omit<ShellCloud, 'role' | 'settings'> {
  const person = personOf(principal);
  const site = siteUi(ctx);
  return {
    user: person ? { id: person.id, name: person.name, ...(person.email ? { email: person.email } : {}), ...(person.avatar ? { avatar: person.avatar } : {}) } : null,
    appOrigin: ctx.config.appOrigin,
    signInUrl: `${ctx.config.appOrigin}${SIGN_IN_PATH}?${new URLSearchParams({ return_to: returnTo })}`,
    signOutUrl: `${ctx.config.appOrigin}${SIGN_OUT_PATH}`,
    ...(site ? { site } : {}),
  };
}

/** The home page's boot. */
export function homeBoot(ctx: AppCtx, principal: Principal): HomeBoot {
  return {
    cloud: {
      ...cloudAccount(ctx, principal, '/'),
      ...(ctx.trashDays !== undefined ? { trashDays: ctx.trashDays } : {}),
      limits: { importBytes: ctx.importMaxBytes ?? IMPORT_MAX_BYTES },
    },
  };
}

/**
 * The owner's agent as the Ask pane says it ({@link CloudAgentView}): a linked computer connected now, one linked but
 * away, else an MCP client used within {@link MCP_PRESENT_MS}, else none. Each named by its own token's label.
 */
export async function cloudAgent(ctx: AppCtx, userId: string): Promise<CloudAgentView> {
  const [tokens, online] = await Promise.all([ctx.catalog.listAgentTokens(userId), Promise.resolve(ctx.linkOnline?.(userId) ?? false).catch(() => false)]);
  const live = tokens.filter((t) => t.revokedAt === null);
  const latest = (list: typeof live) => [...list].sort((a, b) => (b.usedAt ?? b.createdAt).localeCompare(a.usedAt ?? a.createdAt))[0];
  const computer = latest(live.filter((t) => t.harness !== MCP_HARNESS));
  if (online) return { state: 'online', name: computer?.label || DEFAULT_AGENT_NAME };
  const since = ctx.now().getTime() - MCP_PRESENT_MS;
  const mcp = latest(live.filter((t) => t.harness === MCP_HARNESS && t.usedAt !== null && Date.parse(t.usedAt) >= since));
  if (mcp) return { state: 'mcp', name: mcp.label || DEFAULT_AGENT_NAME };
  if (computer) return { state: 'offline', name: computer.label || DEFAULT_AGENT_NAME };
  return { state: 'none', name: DEFAULT_AGENT_NAME };
}

/** The label of the owner's most recently used agent token, else {@link DEFAULT_AGENT_NAME}. */
async function agentNameOf(ctx: AppCtx, userId: string): Promise<string> {
  const tokens = (await ctx.catalog.listAgentTokens(userId)).filter((t) => t.revokedAt === null);
  tokens.sort((a, b) => (b.usedAt ?? b.createdAt).localeCompare(a.usedAt ?? a.createdAt));
  return tokens[0]?.label || DEFAULT_AGENT_NAME;
}

/**
 * The Shell's finished boot for this principal and role (never `pending`: minting a page address is quick). No
 * `typeServer`: that is the type server's own guest Shell; a host's Shell reads `cloud.role`.
 */
export async function shellBoot(ctx: AppCtx, artifact: ArtifactRow, principal: Principal, role: ArtifactRole): Promise<ShellBoot> {
  const page = await ctx.pageFor(artifact, principal, role);
  const owner = await ctx.catalog.getUser(artifact.ownerUser);
  const type = ctx.typeInfo(artifact.type);
  return {
    id: artifact.id,
    url: artifactUrl(ctx, artifact.id),
    title: artifact.title,
    type: artifact.type,
    typeTitle: type?.title ?? artifact.type,
    root: '',
    page: page.url,
    pageUrl: page.pageUrl,
    pageKind: 'server',
    problem: type ? null : `The ${artifact.type} type is not installed on this host.`,
    empty: false,
    prompt: null,
    owner: null,
    agentName: await agentNameOf(ctx, artifact.ownerUser),
    userName: owner?.name ?? 'Owner',
    version: ctx.version,
    cloud: { ...cloudAccount(ctx, principal, shellPath(artifact.id)), role, settings: { ...artifact.settings }, agent: await cloudAgent(ctx, artifact.ownerUser) },
  };
}
