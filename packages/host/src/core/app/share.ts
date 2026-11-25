/**
 * Sharing on the host: `GET`/`POST /api/open-artifact.artifact.share` (the Share panel) and `/s/<token>` (a role
 * link, decisions 18 and 20).
 *
 * Every role may read the share view (the export rule reads its settings); only a manager (the owner or a site
 * admin, signed in as a person) changes it, and a change is checked whole before any of it is applied.
 */

import type { CloudMember, GeneralAccess, ShareCloudView, ShareGuest, ShareRequest, ShareRole, ShareView } from '@open-artifact/protocol';
import { shellPath } from '@open-artifact/protocol';
import { principalRef, refKey, type CachedAccess } from '../authz/access.ts';
import { capRole, roleAtLeast } from '../authz/roles.ts';
import { readForm } from '../auth/owner-key.ts';
import { escapeHtml, htmlPage, pageLanguage, type PageLanguage } from '../auth/pages.ts';
import { redirect } from '../auth/flow.ts';
import { authenticate, guestCookie } from '../auth/session.ts';
import { SIGN_IN_PATH } from '../auth/routes.ts';
import { fetchSite, httpError, isTopLevelNavigation, json, readJson, serializeCookie, type Router } from '../http.ts';
import type { ArtifactRow, GrantRecord, GrantSubjectKind, LinkRecord, Principal, UserRecord } from '../types.ts';
import type { ShareChanges } from '@open-artifact/host-plugin';
import { emitEvent, eventBase, guards } from '../plugins/hooks.ts';
import type { AppCtx } from './services.ts';
import { personOf, reach } from './views.ts';

/** The link roles, most powerful first. */
export const SHARE_ROLES: readonly ShareRole[] = ['editor', 'commenter', 'viewer'];
/** Longest name a guest may give (as the type server's LAN sharing). */
export const MAX_GUEST_NAME = 40;
/** Cap on a share change's JSON body. */
export const SHARE_BODY_BYTES = 64 * 1024;
/** Most people one change may add, change or remove. */
export const MAX_MEMBER_CHANGES = 100;

const EMAIL = /^[^\s@,;<>()"]{1,64}@([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)$/;
const DOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const GROUP_PART = /^[A-Za-z0-9._@-][A-Za-z0-9._@ /-]{0,127}$/;
const LINK_TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
const DOCS_TARGET = /^[a-zA-Z0-9_-]{1,128}$/;

const isShareRole = (value: unknown): value is ShareRole => value === 'editor' || value === 'commenter' || value === 'viewer';
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const invalid = (message: string): Error => httpError('invalid_argument', message, { status: 400 });

/** A guest's name as it may show: no control or markup characters, spaces folded, at most {@link MAX_GUEST_NAME}. */
export function cleanGuestName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f<>"'`]/g, '').replace(/\s+/g, ' ').trim() : '';
  return [...name].slice(0, MAX_GUEST_NAME).join('');
}

/** Whether the principal may change sharing: the owner or a site admin, signed in as a person (not through an agent). */
export function mayManage(access: Pick<CachedAccess, 'principal' | 'role'>): boolean {
  return access.principal.kind === 'user' && access.role === 'owner';
}

// ---- the view ------------------------------------------------------------------------------------------------------

/** The share link address of a token. */
function linkUrl(ctx: AppCtx, token: string): string {
  return `${ctx.config.appOrigin}/s/${token}`;
}

/** The roles a link may have on this host (at most `linkMaxRole`). */
function linkRoles(ctx: AppCtx): ShareRole[] {
  return SHARE_ROLES.filter((role) => roleAtLeast(ctx.config.linkMaxRole, role));
}

/**
 * The artifact's links by role; a manager's first look makes the missing ones, on (decision 23): the general access
 * is the switch, so with `link` they work at once and with `restricted` they exist but let nobody in.
 */
async function linksOf(ctx: AppCtx, artifactId: string, create: boolean): Promise<Map<ShareRole, LinkRecord>> {
  const byRole = new Map<ShareRole, LinkRecord>();
  for (const link of await ctx.catalog.listLinks(artifactId)) byRole.set(link.role, link);
  if (create) {
    for (const role of linkRoles(ctx)) {
      if (byRole.has(role)) continue;
      try {
        byRole.set(role, (await ctx.catalog.createLink(artifactId, role)).link);
      } catch {
        // Made by a request running at the same time: read it.
        const made = (await ctx.catalog.listLinks(artifactId)).find((l) => l.role === role);
        if (made) byRole.set(role, made);
      }
    }
  }
  return byRole;
}

/** A grant as a Share panel member. */
function memberOf(grant: GrantRecord, users: ReadonlyMap<string, UserRecord>, manager: boolean): CloudMember | null {
  switch (grant.subjectKind) {
    case 'user': {
      const user = users.get(grant.subject);
      if (!user) return null;
      return {
        id: `user:${user.id}`,
        kind: 'user',
        label: user.name,
        ...(user.email && manager ? { email: user.email } : {}),
        ...(user.avatar ? { avatar: user.avatar } : {}),
        role: grant.role,
      };
    }
    case 'email':
      return { id: `email:${grant.subject}`, kind: 'email', label: grant.subject, email: grant.subject, role: grant.role, pending: true };
    case 'domain':
      return { id: `domain:${grant.subject}`, kind: 'domain', label: `@${grant.subject}`, role: grant.role };
    case 'group':
      return { id: `group:${grant.subject}`, kind: 'group', label: grant.subject.slice(grant.subject.indexOf(':') + 1), role: grant.role };
    default:
      return null;
  }
}

/**
 * The share view as this viewer may see it. A manager sees every link (made on first look); anyone else sees the
 * address of a link only while it works and only up to their own role, so nobody can hand out more than they have.
 */
export async function shareView(ctx: AppCtx, access: CachedAccess): Promise<ShareView> {
  const { artifact } = access;
  const manager = mayManage(access);
  const linkMap = await linksOf(ctx, artifact.id, manager);
  const linksOn = artifact.generalAccess !== 'restricted';
  const links: ShareView['links'] = {};
  for (const role of linkRoles(ctx)) {
    const link = linkMap.get(role);
    if (!link) continue;
    const on = link.enabled;
    const showUrl = manager || (on && linksOn && roleAtLeast(access.role, role));
    const token = showUrl ? await ctx.catalog.linkToken(link.id) : null;
    links[role] = { on, ...(token ? { url: linkUrl(ctx, token) } : {}) };
  }

  const online = new Set((await ctx.connected(artifact.id)).map(refKey));
  const linkById = new Map([...linkMap.values()].map((l) => [l.id, l]));
  const guests: ShareGuest[] = [];
  for (const guest of await ctx.catalog.listGuests(artifact.id)) {
    const link = linkById.get(guest.linkId);
    if (!link) continue;
    guests.push({
      id: guest.id,
      name: guest.name,
      role: capRole(link.role, ctx.config.linkMaxRole),
      joined: guest.joinedAt,
      ...(guest.seenAt ? { seen: guest.seenAt } : {}),
      online: online.has(refKey(guest.userId ? { kind: 'user', id: guest.userId } : { kind: 'guest', id: guest.id })),
      active: link.enabled && linksOn,
    });
  }

  // The owner and every user granted, in one read however many members there are.
  const grants = await ctx.catalog.listGrants(artifact.id);
  const users = await ctx.catalog.getUsers([artifact.ownerUser, ...grants.filter((g) => g.subjectKind === 'user').map((g) => g.subject)]);
  const owner = users.get(artifact.ownerUser);
  const members: CloudMember[] = [];
  for (const grant of grants) {
    const member = memberOf(grant, users, manager);
    if (member) members.push(member);
  }
  const cloud: ShareCloudView = {
    url: ctx.config.appOrigin + shellPath(artifact.id),
    access: artifact.generalAccess,
    owner: {
      id: artifact.ownerUser,
      name: owner?.name ?? 'Owner',
      ...(owner?.email ? { email: owner.email } : {}),
      ...(owner?.avatar ? { avatar: owner.avatar } : {}),
    },
    members,
    canManage: manager,
    settings: { ...artifact.settings },
  };
  return { lan: false, links, guests, cloud };
}

// ---- changes -------------------------------------------------------------------------------------------------------

/** One checked step of a share change. */
type Step =
  | { kind: 'access'; access: GeneralAccess }
  | { kind: 'grant'; subjectKind: GrantSubjectKind; subject: string; role: ShareRole }
  | { kind: 'ungrant'; subjectKind: GrantSubjectKind; subject: string }
  | { kind: 'settings'; settings: Partial<ShareCloudView['settings']> }
  | { kind: 'link'; role: ShareRole; on: boolean }
  | { kind: 'reset'; role: ShareRole }
  | { kind: 'guest'; id: string; role: ShareRole | null };

/** A member id (`user:`, `email:`, `domain:`, `group:<provider>:<name>`) as a grant subject, checked. */
async function subjectOf(ctx: AppCtx, artifact: ArtifactRow, id: string, adding: boolean): Promise<{ subjectKind: GrantSubjectKind; subject: string }> {
  const at = id.indexOf(':');
  const kind = at > 0 ? id.slice(0, at) : '';
  const value = at > 0 ? id.slice(at + 1) : '';
  switch (kind) {
    case 'user': {
      const user = value ? await ctx.catalog.getUser(value) : undefined;
      if (!user) throw invalid(`No person ${id}.`);
      if (user.id === artifact.ownerUser) throw invalid('The owner is not a member: they always have access.');
      return { subjectKind: 'user', subject: user.id };
    }
    case 'email': {
      const email = value.trim().toLowerCase();
      if (!EMAIL.test(email)) throw invalid(`Not an email address: ${value}.`);
      if (adding) {
        // Someone who signed in with this address (verified): a grant to them, not to the address.
        const user = await ctx.catalog.findUserByEmail(email);
        if (user && user.emailVerified && user.disabledAt === null) {
          if (user.id === artifact.ownerUser) throw invalid('The owner is not a member: they always have access.');
          return { subjectKind: 'user', subject: user.id };
        }
      }
      return { subjectKind: 'email', subject: email };
    }
    case 'domain': {
      const domain = value.trim().toLowerCase().replace(/^@/, '');
      if (!DOMAIN.test(domain)) throw invalid(`Not a domain: ${value}.`);
      return { subjectKind: 'domain', subject: domain };
    }
    case 'group': {
      const split = value.indexOf(':');
      const provider = split > 0 ? value.slice(0, split) : '';
      const name = split > 0 ? value.slice(split + 1) : '';
      if (!GROUP_PART.test(provider) || !GROUP_PART.test(name)) throw invalid(`Not a group: ${id} (group:<provider>:<name>).`);
      return { subjectKind: 'group', subject: `${provider}:${name}` };
    }
    default:
      throw invalid(`Not a member id: ${id} (user:, email:, domain: or group:).`);
  }
}

/** Checks a whole share change and turns it into steps; throws before anything changes. */
async function checkChange(ctx: AppCtx, artifact: ArtifactRow, body: Record<string, unknown>): Promise<Step[]> {
  const steps: Step[] = [];
  if (body.lan !== undefined) {
    if (body.lan === true) throw httpError('unsupported', 'A cloud host has no local network sharing.', { status: 400 });
    if (body.lan !== false) throw invalid('lan is true or false.');
  }
  if (body.access !== undefined) {
    const access = body.access;
    if (access !== 'restricted' && access !== 'link' && access !== 'public') throw invalid('access is restricted, link or public.');
    if (access === 'public' && !ctx.config.publicAccess) throw httpError('not_granted', 'This host does not allow public artifacts.', { status: 403 });
    steps.push({ kind: 'access', access });
  }
  if (body.members !== undefined) {
    if (!isRecord(body.members)) throw invalid('members is {<member id>: role or null}.');
    const entries = Object.entries(body.members);
    if (entries.length > MAX_MEMBER_CHANGES) throw invalid(`At most ${MAX_MEMBER_CHANGES} members per change.`);
    for (const [id, role] of entries) {
      if (role !== null && !isShareRole(role)) throw invalid('A member role is editor, commenter or viewer (null removes them).');
      const subject = await subjectOf(ctx, artifact, id, role !== null);
      steps.push(role === null ? { kind: 'ungrant', ...subject } : { kind: 'grant', ...subject, role });
    }
  }
  if (body.settings !== undefined) {
    if (!isRecord(body.settings)) throw invalid('settings is {viewersCanExport?, editorsCanAskAgent?}.');
    const settings: Partial<ShareCloudView['settings']> = {};
    for (const [name, on] of Object.entries(body.settings)) {
      if ((name !== 'viewersCanExport' && name !== 'editorsCanAskAgent') || typeof on !== 'boolean') throw invalid('settings is {viewersCanExport?, editorsCanAskAgent?} with true or false.');
      settings[name] = on;
    }
    steps.push({ kind: 'settings', settings });
  }
  if (body.links !== undefined) {
    if (!isRecord(body.links)) throw invalid('links is {editor|commenter|viewer: boolean}.');
    for (const [role, on] of Object.entries(body.links)) {
      if (!isShareRole(role) || typeof on !== 'boolean') throw invalid('links is {editor|commenter|viewer: boolean}.');
      if (on && !roleAtLeast(ctx.config.linkMaxRole, role)) throw httpError('not_granted', `Links on this host give at most ${ctx.config.linkMaxRole}.`, { status: 403 });
      steps.push({ kind: 'link', role, on });
    }
  }
  if (body.reset !== undefined) {
    const roles: unknown[] = Array.isArray(body.reset) ? body.reset : [body.reset];
    for (const role of roles) {
      if (!isShareRole(role)) throw invalid('reset lists editor, commenter or viewer.');
      steps.push({ kind: 'reset', role });
    }
  }
  if (body.guests !== undefined) {
    if (!isRecord(body.guests)) throw invalid('guests is {<guest id>: role or null}.');
    const links = await ctx.catalog.listLinks(artifact.id);
    for (const [id, role] of Object.entries(body.guests)) {
      const guest = await ctx.catalog.getGuest(id);
      if (!guest || guest.artifactId !== artifact.id) throw httpError('not_found', `No guest ${id}.`, { status: 404 });
      if (role === null) {
        steps.push({ kind: 'guest', id, role: null });
        continue;
      }
      if (!isShareRole(role)) throw invalid('A guest role is editor, commenter or viewer (null removes them).');
      const turnedOn = steps.some((s) => s.kind === 'link' && s.role === role && s.on);
      if (!turnedOn && !links.some((l) => l.role === role && l.enabled)) throw httpError('conflict', `The ${role} link is off.`, { status: 409 });
      steps.push({ kind: 'guest', id, role });
    }
  }
  return steps;
}

/** Applies checked steps, in the order the type server's LAN sharing does: links, resets, guests. */
async function applyChange(ctx: AppCtx, artifact: ArtifactRow, steps: readonly Step[], by: string): Promise<void> {
  const { catalog } = ctx;
  for (const step of steps) {
    switch (step.kind) {
      case 'access':
        await catalog.setGeneralAccess(artifact.id, step.access);
        break;
      case 'grant':
        await catalog.upsertGrant({ artifactId: artifact.id, subjectKind: step.subjectKind, subject: step.subject, role: step.role, createdBy: by });
        break;
      case 'ungrant':
        await catalog.removeGrant(artifact.id, step.subjectKind, step.subject);
        break;
      case 'settings':
        await catalog.setArtifactSettings(artifact.id, step.settings);
        break;
      case 'link': {
        const link = (await linksOf(ctx, artifact.id, true)).get(step.role);
        if (link) await catalog.setLinkEnabled(link.id, step.on);
        break;
      }
      case 'reset': {
        const link = (await catalog.listLinks(artifact.id)).find((l) => l.role === step.role);
        if (link) await catalog.resetLink(link.id);
        break;
      }
      case 'guest':
        if (step.role === null) await catalog.removeGuest(step.id);
        else await catalog.setGuestRole(step.id, step.role);
        break;
    }
  }
  // Settings do not change anyone's role but do change what the pages may do: drop the cached answers anyway.
  await catalog.bumpGrantsVersion(artifact.id);
}

/** A checked change as the plugins see it (`guard` `share.change`, the `share.changed` event). */
export function shareChangesOf(steps: readonly Step[]): ShareChanges {
  const changes: ShareChanges = {};
  for (const step of steps) {
    switch (step.kind) {
      case 'access':
        changes.access = step.access;
        break;
      case 'grant':
      case 'ungrant':
        (changes.grants ??= []).push({ subjectKind: step.subjectKind, subject: step.subject, role: step.kind === 'grant' ? step.role : null });
        break;
      case 'settings':
        changes.settings = { ...changes.settings, ...step.settings };
        break;
      case 'link':
        (changes.links ??= []).push({ role: step.role, enabled: step.on });
        break;
      case 'reset':
        (changes.links ??= []).push({ role: step.role, reset: true });
        break;
      case 'guest':
        (changes.guests ??= []).push({ id: step.id, role: step.role });
        break;
    }
  }
  return changes;
}

/**
 * Tells the plugins about an applied change: `share.changed`, then one `share.invited` for each person or address
 * given a role they did not have a grant for before.
 */
async function announceChange(ctx: AppCtx, artifact: ArtifactRow, by: Principal, steps: readonly Step[], changes: ShareChanges, before: readonly GrantRecord[]): Promise<void> {
  const plugins = ctx.plugins;
  if (!plugins) return;
  const base = eventBase(artifact, by);
  emitEvent(ctx, 'share.changed', { ...base, changes });
  if (!plugins.listens('share.invited')) return;
  const had = new Set(before.map((grant) => `${grant.subjectKind}\n${grant.subject}`));
  const invited = steps.filter((step): step is Extract<Step, { kind: 'grant' }> => step.kind === 'grant' && (step.subjectKind === 'user' || step.subjectKind === 'email') && !had.has(`${step.subjectKind}\n${step.subject}`));
  if (invited.length === 0) return;
  const users = await ctx.catalog.getUsers(invited.filter((step) => step.subjectKind === 'user').map((step) => step.subject));
  const url = ctx.config.appOrigin + shellPath(artifact.id);
  for (const step of invited) {
    const user = step.subjectKind === 'user' ? users.get(step.subject) : undefined;
    const invitee =
      step.subjectKind === 'email'
        ? { email: step.subject }
        : { userId: step.subject, ...(user?.name ? { name: user.name } : {}), ...(user?.email ? { email: user.email } : {}) };
    emitEvent(ctx, 'share.invited', { ...base, invitee, role: step.role, url });
  }
}

/** What an audit entry keeps of a change (no link tokens: there are none in a request). */
function auditDetail(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of ['access', 'members', 'settings', 'links', 'reset', 'guests', 'lan']) if (body[key] !== undefined) out[key] = body[key];
  return out;
}

/** Registers `GET`/`POST /api/open-artifact.artifact.share`. */
export function shareRoutes(router: Router<AppCtx>): void {
  router.get('/api/open-artifact.artifact.share', async (request, ctx) => {
    const id = new URL(request.url).searchParams.get('id') ?? '';
    const { access } = await reach(request, ctx, id);
    return json(await shareView(ctx, access));
  });

  router.post('/api/open-artifact.artifact.share', async (request, ctx) => {
    const body = await readJson<unknown>(request, SHARE_BODY_BYTES);
    if (!isRecord(body) || typeof body.id !== 'string') throw invalid('The body is {id, …changes}.');
    const { access } = await reach(request, ctx, body.id);
    if (!mayManage(access)) throw httpError('not_granted', 'Only the owner changes who may open this artifact.', { status: 403 });
    const steps = await checkChange(ctx, access.artifact, body as Record<string, unknown> & Partial<ShareRequest>);
    if (steps.length > 0) {
      const changes = ctx.plugins ? shareChangesOf(steps) : undefined;
      if (changes) await guards.share(ctx, access.principal, access.artifact, { changes });
      const before = ctx.plugins?.listens('share.invited') ? await ctx.catalog.listGrants(access.artifact.id) : [];
      await applyChange(ctx, access.artifact, steps, access.principal.kind === 'user' ? access.principal.id : 'unknown');
      await ctx.catalog.appendAudit({ actorKind: 'user', actorId: access.principal.kind === 'user' ? access.principal.id : null, artifactId: access.artifact.id, action: 'share.change', detail: auditDetail(body) });
      await ctx.refreshAccess(access.artifact.id);
      ctx.events.emit('access-changed', { id: access.artifact.id });
      if (changes) await announceChange(ctx, access.artifact, access.principal, steps, changes, before);
    }
    const after = await ctx.access.role(access.artifact.id, principalRef(access.principal));
    if (!after) throw httpError('not_found', 'The artifact is gone.', { status: 404 });
    return json(await shareView(ctx, after));
  });
}

// ---- /s/<token> ----------------------------------------------------------------------------------------------------

const LINK_WORDS = {
  en: {
    goneTitle: 'This link does not work',
    gone: 'The link was turned off or replaced, or the artifact is no longer shared. Ask its owner for a new one.',
    invited: (what: string) => `You were invited to ${what} this artifact.`,
    yourName: 'Your name (others see it on your comments and edits)',
    open: 'Open it',
    note: 'This browser keeps your place; the owner can remove it at any time.',
    signIn: 'Have an account? Sign in instead.',
    confirm: (who: string) => `Open it as ${who}? Your account joins this artifact through the link.`,
    roles: { editor: 'edit', commenter: 'comment on', viewer: 'view' } as Record<ShareRole, string>,
  },
  zh: {
    goneTitle: '链接已失效',
    gone: '这个链接已被关闭或重置，或者已停止分享。请向所有者要一个新链接。',
    invited: (what: string) => `你被邀请${what}这个 artifact。`,
    yourName: '你的名字（别人会在你的评论和编辑上看到它）',
    open: '打开',
    note: '这个浏览器会记住你的身份；所有者可以随时移除。',
    signIn: '有账号？改为登录。',
    confirm: (who: string) => `以 ${who} 的身份打开？你的账号会通过这个链接加入这个 artifact。`,
    roles: { editor: '编辑', commenter: '评论', viewer: '查看' } as Record<ShareRole, string>,
  },
} satisfies Record<PageLanguage, unknown>;

/** The link page for a link that does not let anyone in. */
async function goneLink(lang: PageLanguage): Promise<Response> {
  const w = LINK_WORDS[lang];
  return htmlPage({ title: w.goneTitle, lang, status: 404, body: `<h1>${escapeHtml(w.goneTitle)}</h1><p>${escapeHtml(w.gone)}</p>` });
}

/** The link and its artifact while the link lets people in (on, its artifact there and not restricted), else null. */
async function workingLink(ctx: AppCtx, token: string): Promise<{ link: LinkRecord; artifact: ArtifactRow } | null> {
  if (!LINK_TOKEN.test(token)) return null;
  const link = await ctx.catalog.findLinkByToken(token);
  if (!link || !link.enabled || !roleAtLeast(ctx.config.linkMaxRole, link.role)) return null;
  const artifact = await ctx.catalog.getArtifact(link.artifactId);
  if (!artifact || artifact.trashedAt !== null || artifact.generalAccess === 'restricted') return null;
  return { link, artifact };
}

/** Where a join lands: the artifact's Shell, with a Docs tab or comment passed on. */
function destinationOf(request: Request, artifact: ArtifactRow): string {
  const query = new URL(request.url).searchParams;
  const out = new URLSearchParams();
  if (artifact.type === 'docs') {
    for (const key of ['tab', 'comment']) {
      const value = query.get(key);
      if (value && DOCS_TARGET.test(value)) out.set(key, value);
    }
  }
  const search = out.toString();
  return shellPath(artifact.id) + (search ? `?${search}` : '');
}

/**
 * `/s/<token>`. A signed-in person joins at once (decision 20: a guest row with their user id, no cookie) unless
 * they already have at least the link's role. Anyone else: `GET` shows the name form (straight in for a guest
 * already in through this link); `POST` joins and sets the guest cookie (decision 18). A link that is off, reset,
 * over the host's maximum, or whose artifact is restricted, trashed or gone, "does not work".
 */
export function linkRoutes(router: Router<AppCtx>): void {
  const handle = async (request: Request, ctx: AppCtx & { params: Record<string, string> }): Promise<Response> => {
    const lang = pageLanguage(request);
    const found = await workingLink(ctx, ctx.params.token ?? '');
    if (!found) return goneLink(lang);
    const { link, artifact } = found;
    const to = destinationOf(request, artifact);
    const role = capRole(link.role, ctx.config.linkMaxRole);
    const auth = await authenticate(request, ctx, { artifactId: artifact.id });
    const person = personOf(auth.principal);

    if (person && auth.principal.kind === 'user') {
      const now = await ctx.access.role(artifact.id, principalRef(auth.principal));
      if (!now || !roleAtLeast(now.role, role)) {
        // A GET joins only when it is the person's own visit: a top-level navigation, and not one a sibling host of the
        // same site started (an artifact's page, in same-site mode). An <img>, a fetch, a frame or such a navigation
        // gets a page that asks, whose button posts back here (a write, so same-origin only).
        if (request.method !== 'POST' && (!isTopLevelNavigation(request) || fetchSite(request) === 'same-site')) {
          const w = LINK_WORDS[lang];
          return htmlPage({
            title: artifact.title,
            lang,
            body:
              `<h1>${escapeHtml(artifact.title)}</h1><p>${escapeHtml(w.invited(w.roles[role]))}</p>` +
              `<p>${escapeHtml(w.confirm(person.name))}</p><form method="post"><button type="submit">${escapeHtml(w.open)}</button></form>`,
          });
        }
        await ctx.catalog.joinUserGuest(link.id, person.id, person.name);
        await ctx.catalog.appendAudit({ actorKind: 'user', actorId: person.id, artifactId: artifact.id, action: 'share.join', detail: { role, via: 'link' } });
        ctx.access.invalidate(artifact.id);
        await ctx.refreshAccess(artifact.id);
        ctx.events.emit('access-changed', { id: artifact.id });
      }
      return redirect(to);
    }

    const current: Principal = auth.principal;
    if (request.method !== 'POST') {
      if (current.kind === 'guest' && current.link === link.id) return redirect(to);
      const w = LINK_WORDS[lang];
      const signIn = `${SIGN_IN_PATH}?${new URLSearchParams({ return_to: new URL(request.url).pathname + new URL(request.url).search })}`;
      const name = current.kind === 'guest' ? current.name : '';
      return htmlPage({
        title: artifact.title,
        lang,
        body:
          `<h1>${escapeHtml(artifact.title)}</h1><p>${escapeHtml(w.invited(w.roles[role]))}</p>` +
          `<form method="post"><label for="n">${escapeHtml(w.yourName)}</label>` +
          `<input id="n" name="name" maxlength="${MAX_GUEST_NAME}" value="${escapeHtml(name)}" required autofocus autocomplete="name">` +
          `<button type="submit">${escapeHtml(w.open)}</button></form>` +
          `<p class="note">${escapeHtml(w.note)}</p><p class="note"><a href="${escapeHtml(signIn)}">${escapeHtml(w.signIn)}</a></p>`,
      });
    }

    // POST: the same-origin check already ran for every write (a form from another site cannot make someone join).
    const form = await readForm(request);
    const name = cleanGuestName(form.get('name')) || 'Guest';
    const { guest, secret } = await ctx.catalog.joinGuest(link.id, name);
    await ctx.catalog.appendAudit({ actorKind: 'guest', actorId: guest.id, artifactId: artifact.id, action: 'share.join', detail: { role, via: 'link' } });
    ctx.log(`sharing ${artifact.id}: ${guest.name} joined as ${role}`);
    ctx.events.emit('access-changed', { id: artifact.id });
    const cookie = guestCookie(ctx.config, artifact.id);
    return redirect(to, [serializeCookie(cookie.name, secret, cookie.options)]);
  };
  router.get('/s/:token', handle);
  router.post('/s/:token', handle);
}
