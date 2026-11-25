/**
 * The Shell and the home page served by a cloud host instead of the local daemon. Pure: no DOM, no store, so it runs
 * under `node --test`.
 *
 * The switch is data: a boot with `cloud` ({@link ShellCloud}) is cloud mode, and a share view with `cloud`
 * ({@link ShareCloudView}) is a host's sharing. Without either, the pages behave as they always did.
 *
 * One notion of "my role" serves both servers of the Shell: a cloud host's `boot.cloud.role`, else a type server's
 * `boot.typeServer.role` (its LAN guests), else the owner (the local daemon only serves its owner).
 */

import type { ArtifactRole, CloudAgentView, CloudSiteUi, GeneralAccess, HomeBoot, ShareCloudView, ShareRequest, ShareRole, ShareView, ShellBoot } from '@open-artifact/protocol';
import type { MessageKey } from './i18n.ts';

export type { HomeBoot };

/**
 * What the home page knows of a cloud host: {@link HomeBoot.cloud}, with how many days the host keeps trashed
 * artifacts (`trashDays`; 0 = until their owner deletes them) and the largest archive it takes (`limits.importBytes`)
 * when it says.
 */
export type HomeCloud = NonNullable<HomeBoot['cloud']>;

/** The home page's boot as the page reads it ({@link homeBootOf}). */
export interface HomeBootRead {
  cloud?: HomeCloud;
}

/** The global a cloud host fills in the home page's `index.html`, replacing {@link HOME_BOOT_PLACEHOLDER}. */
export const HOME_BOOT_GLOBAL = '__OPEN_ARTIFACT_HOME__';
/** The placeholder in the home page's `index.html` the host replaces with a {@link HomeBoot} as JSON. */
export const HOME_BOOT_PLACEHOLDER = '/*__OPEN_ARTIFACT_HOME__*/null';

/** A boot (the Shell's or the home page's) that a cloud host served. */
export function isCloud<B extends { cloud?: unknown }>(boot: B | null | undefined): boot is B & { cloud: NonNullable<B['cloud']> } {
  return !!boot?.cloud;
}

/** The home page's boot from what the page found inlined: anything malformed reads as no boot (local). */
export function homeBootOf(value: unknown): HomeBootRead {
  if (!value || typeof value !== 'object') return {};
  const cloud = (value as { cloud?: unknown }).cloud;
  if (!cloud || typeof cloud !== 'object') return {};
  const c = cloud as Partial<HomeCloud>;
  if (typeof c.signInUrl !== 'string' || typeof c.signOutUrl !== 'string' || typeof c.appOrigin !== 'string') return {};
  const user = c.user && typeof c.user === 'object' && typeof c.user.id === 'string' && typeof c.user.name === 'string' ? c.user : null;
  const trashDays = typeof c.trashDays === 'number' && Number.isInteger(c.trashDays) && c.trashDays >= 0 ? c.trashDays : undefined;
  const importBytes = c.limits && typeof c.limits === 'object' ? c.limits.importBytes : undefined;
  const limits = typeof importBytes === 'number' && Number.isInteger(importBytes) && importBytes > 0 ? { importBytes } : undefined;
  const site = siteUiOf(c.site);
  return {
    cloud: {
      user,
      appOrigin: c.appOrigin,
      signInUrl: c.signInUrl,
      signOutUrl: c.signOutUrl,
      ...(trashDays !== undefined ? { trashDays } : {}),
      ...(limits ? { limits } : {}),
      ...(site ? { site } : {}),
    },
  };
}

// ---- the site's own additions (its plugins' links and brand) -------------------------------------------------------

/** An address a page may link to or load: a path on this site, or an `https:`/`http:` URL. */
function safeHref(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value)) return false;
  if (value.startsWith('/')) return !value.startsWith('//') && !value.includes('\\');
  return /^https?:\/\//i.test(value);
}

/** A plain-text label of a sensible length, or null. */
function plainText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length > 0 && text.length <= max ? text : null;
}

/**
 * {@link CloudSiteUi} as a page may draw it: labels as plain text and only safe addresses (the host checked them;
 * this is the page's own check). Undefined when nothing is left.
 */
export function siteUiOf(value: unknown): CloudSiteUi | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as { links?: unknown; brand?: unknown };
  const links: NonNullable<CloudSiteUi['links']> = [];
  if (Array.isArray(raw.links)) {
    for (const link of raw.links as unknown[]) {
      if (!link || typeof link !== 'object') continue;
      const { label, href, where } = link as { label?: unknown; href?: unknown; where?: unknown };
      const text = plainText(label, 80);
      if (text && safeHref(href) && (where === 'account-menu' || where === 'home')) links.push({ label: text, href, where });
    }
  }
  let brand: CloudSiteUi['brand'];
  if (raw.brand && typeof raw.brand === 'object') {
    const { name, logoUrl } = raw.brand as { name?: unknown; logoUrl?: unknown };
    const text = plainText(name, 80);
    if (text || safeHref(logoUrl)) brand = { ...(text ? { name: text } : {}), ...(safeHref(logoUrl) ? { logoUrl } : {}) };
  }
  if (links.length === 0 && !brand) return undefined;
  return { ...(links.length > 0 ? { links } : {}), ...(brand ? { brand } : {}) };
}

/** The site's links for one place (`account-menu` or `home`). */
export function siteLinks(site: CloudSiteUi | undefined, where: 'account-menu' | 'home'): Array<{ label: string; href: string }> {
  return (siteUiOf(site)?.links ?? []).filter((link) => link.where === where).map(({ label, href }) => ({ label, href }));
}

/** Whether a link leaves this site (opened in a new tab) rather than being a path here. */
export function leavesSite(href: string, origin: string): boolean {
  if (href.startsWith('/')) return false;
  try {
    return new URL(href).origin !== origin;
  } catch {
    return true;
  }
}

// ---- roles ---------------------------------------------------------------------------------------------------------

/** The person's role on the artifact the Shell shows. */
export function roleOf(boot: Pick<ShellBoot, 'typeServer' | 'cloud'> | null | undefined): ArtifactRole {
  return boot?.cloud?.role ?? boot?.typeServer?.role ?? 'owner';
}

/** The role may change the artifact (and so rename it). */
export function mayEdit(role: ArtifactRole): boolean {
  return role === 'owner' || role === 'editor';
}

/** The role may comment: everyone but a viewer. */
export function mayComment(role: ArtifactRole): boolean {
  return role !== 'viewer';
}

/**
 * The role may send the owner's agent a request: the owner; an editor unless the owner turned that off (unknown
 * settings count as on: the host refuses it if not).
 */
export function mayAsk(role: ArtifactRole, settings?: Pick<ShareCloudView['settings'], 'editorsCanAskAgent'> | null): boolean {
  if (role === 'owner') return true;
  return role === 'editor' && (settings?.editorsCanAskAgent ?? true);
}

/** The role may download or export: anyone but a viewer, and a viewer when the owner allows it. */
export function mayExport(role: ArtifactRole, settings?: Pick<ShareCloudView['settings'], 'viewersCanExport'> | null): boolean {
  return role !== 'viewer' || !!settings?.viewersCanExport;
}

// ---- asking the owner's agent --------------------------------------------------------------------------------------

/** A message key and what fills it. */
export interface CloudSaid {
  key: MessageKey;
  vars?: Record<string, string | number>;
}

/**
 * What the Ask pane says of the owner's agent on a cloud host ({@link CloudAgentView}): whether a request reaches it
 * now, later, or waits for one to be connected. `owner`: the viewer is the owner (the words say "you").
 */
export function cloudAskLine(agent: CloudAgentView, owner: boolean): CloudSaid {
  const vars = { agent: agent.name };
  switch (agent.state) {
    case 'online':
      return { key: 'askCloudOnline', vars };
    case 'offline':
      return { key: 'askCloudOffline', vars };
    case 'mcp':
      return { key: 'askCloudMcp', vars };
    case 'none':
      return { key: owner ? 'askCloudNone' : 'askCloudNoneOther' };
  }
}

/**
 * What the Ask pane says once the host answered a request (`artifacts.ask`: `status` `delivered` when the owner's
 * computer is connected, else `inbox`), with what the pane knew of the agent for a request that waits.
 */
export function cloudSentLine(status: string | undefined, agent: CloudAgentView): CloudSaid {
  const vars = { agent: agent.name };
  if (status === 'delivered') return { key: 'sentCloudDelivered', vars };
  if (agent.state === 'mcp') return { key: 'sentCloudMcp', vars };
  if (agent.state === 'offline' || agent.state === 'online') return { key: 'sentCloudOffline', vars };
  return { key: 'sentCloudNone' };
}

/** The status dot of the owner's agent on a cloud host (`working` comes from the page, as it does locally). */
export function cloudAgentBadge(agent: CloudAgentView | null | undefined): 'idle' | 'offline' | 'none' {
  if (!agent || agent.state === 'none') return 'none';
  return agent.state === 'online' ? 'idle' : 'offline';
}

// ---- the account ---------------------------------------------------------------------------------------------------

/**
 * Where "Sign in" goes: the host's sign-in address with `return_to` set to `path` (the Shell's or the home page's own
 * path), unless the host already put one there. Same-origin paths only.
 */
export function signInHref(signInUrl: string, path: string, origin: string): string {
  let url: URL;
  try {
    url = new URL(signInUrl, origin);
  } catch {
    return signInUrl;
  }
  if (!url.searchParams.has('return_to') && path.startsWith('/') && !path.startsWith('//')) url.searchParams.set('return_to', path);
  return url.origin === origin ? `${url.pathname}${url.search}${url.hash}` : url.href;
}

/**
 * Where to go once the host's sign-out answered: behind Cloudflare Access the host's own cookie is not the whole
 * session, and its JSON answer names Access's logout address (`accessLogoutUrl`); going there ends that one too.
 * `null`: nothing more to end, load the page again.
 */
export function signOutTarget(answer: unknown): string | null {
  if (!answer || typeof answer !== 'object') return null;
  const url = (answer as { accessLogoutUrl?: unknown }).accessLogoutUrl;
  if (typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

/**
 * The site signs people in through Cloudflare Access (`auth.me` names Access's logout address, or, from a host that
 * does not yet, names Access among its providers): sign-out ends that too.
 */
export function signsInThroughAccess(me: unknown): boolean {
  if (!me || typeof me !== 'object') return false;
  if (accessLogoutOf(me)) return true;
  const providers = (me as { providers?: unknown }).providers;
  return Array.isArray(providers) && providers.some((p) => !!p && typeof p === 'object' && (p as { id?: unknown }).id === 'cloudflare-access');
}

/**
 * Access's logout address as `auth.me` names it (`accessLogoutUrl`), or null. Sign-out goes there even when the
 * sign-out answer does not say it (the host's session was already gone: a 401 with no body).
 */
export function accessLogoutOf(me: unknown): string | null {
  return signOutTarget(me);
}

// ---- cloud sharing -------------------------------------------------------------------------------------------------

/** One person or group the "Add people" field names. */
export interface MemberInput {
  /** {@link CloudMember.id}: `email:<address>` or `domain:<name>`. */
  id: string;
  kind: 'email' | 'domain';
  /** The address or domain as it shows. */
  label: string;
}

const EMAIL = /^[^\s@,;<>()"]+@([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)$/i;
const DOMAIN = /^@([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)$/i;

/** One entry of the field: `name@example.com` → an email, `@example.com` → a whole domain; anything else is `null`. */
export function parseMember(text: string): MemberInput | null {
  const value = text.trim().replace(/^<|>$/g, '').toLowerCase();
  if (DOMAIN.test(value)) {
    const domain = value.slice(1);
    return { id: `domain:${domain}`, kind: 'domain', label: `@${domain}` };
  }
  if (EMAIL.test(value)) return { id: `email:${value}`, kind: 'email', label: value };
  return null;
}

/** Every entry of the field (separated by commas, semicolons or white space), each once, and the ones that are not. */
export function parseMembers(text: string): { members: MemberInput[]; invalid: string[] } {
  const members: MemberInput[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const part of text.split(/[\s,;]+/)) {
    if (!part) continue;
    const member = parseMember(part);
    if (!member) invalid.push(part);
    else if (!seen.has(member.id)) {
      seen.add(member.id);
      members.push(member);
    }
  }
  return { members, invalid };
}

/** What a {@link CloudMember.id} names: its kind and the rest (`group:<provider>:<name>` keeps both parts). */
export function memberIdOf(id: string): { kind: 'user' | 'email' | 'domain' | 'group'; value: string } | null {
  const at = id.indexOf(':');
  if (at <= 0 || at === id.length - 1) return null;
  const kind = id.slice(0, at);
  const value = id.slice(at + 1);
  if (kind === 'group') return value.includes(':') && !value.startsWith(':') && !value.endsWith(':') ? { kind, value } : null;
  return kind === 'user' || kind === 'email' || kind === 'domain' ? { kind, value } : null;
}

/** The share change that gives each of `members` the role `role`. */
export function addMembersRequest(members: readonly MemberInput[], role: ShareRole): Pick<ShareRequest, 'members'> {
  return { members: Object.fromEntries(members.map((member) => [member.id, role])) };
}

/** The share change that gives one member another role, or removes them (`null`). */
export function memberRoleRequest(id: string, role: ShareRole | null): Pick<ShareRequest, 'members'> {
  return { members: { [id]: role } };
}

/** The share change of general access. */
export function accessRequest(access: GeneralAccess): Pick<ShareRequest, 'access'> {
  return { access };
}

/** The share change of one setting. */
export function settingRequest(name: keyof ShareCloudView['settings'], on: boolean): Pick<ShareRequest, 'settings'> {
  return { settings: { [name]: on } };
}

/** The role links show only while they let someone in: general access is not `restricted`. */
export function showsRoleLinks(access: GeneralAccess): boolean {
  return access !== 'restricted';
}

/** The artifact is shared on the host: anyone named, or open past them. */
export function isCloudShared(cloud: Pick<ShareCloudView, 'access' | 'members'>): boolean {
  return cloud.access !== 'restricted' || cloud.members.length > 0;
}

/**
 * The share view as it will be once `change` is done, to show at once (the host's answer replaces it). Members added
 * by address show as pending until the host says who they are.
 */
export function applyCloudChange(view: ShareView, change: Omit<ShareRequest, 'id'>): ShareView {
  const cloud = view.cloud;
  if (!cloud) return view;
  let members = cloud.members;
  for (const [id, role] of Object.entries(change.members ?? {})) {
    if (role === null) members = members.filter((m) => m.id !== id);
    else if (members.some((m) => m.id === id)) members = members.map((m) => (m.id === id ? { ...m, role } : m));
    else {
      const parsed = memberIdOf(id);
      if (!parsed || (parsed.kind !== 'email' && parsed.kind !== 'domain')) continue;
      members = [...members, { id, kind: parsed.kind, label: parsed.kind === 'domain' ? `@${parsed.value}` : parsed.value, role, pending: parsed.kind === 'email' }];
    }
  }
  const links = { ...view.links };
  for (const [role, on] of Object.entries(change.links ?? {}) as Array<[ShareRole, boolean]>) {
    const link = links[role];
    if (link) links[role] = { ...link, on };
  }
  return {
    ...view,
    links,
    cloud: {
      ...cloud,
      members,
      access: change.access ?? cloud.access,
      settings: { ...cloud.settings, ...change.settings },
    },
  };
}
