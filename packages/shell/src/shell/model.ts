/**
 * The Shell's pure logic: what the bar shows for a given state. No DOM, no
 * store, so it runs under `node --test`.
 */

import { INLINE_VIEW_FRAGMENT, SLIDE_FRAGMENT, hostToShellOf } from '@open-artifact/protocol';
import {
  CHROME_PEER_KEY,
  FRAME_DENIED_REASONS,
  MAX_CHROME_PEERS,
  SHELL_PARAMS,
  type ArtifactView,
  type ChromeAction,
  type ChromeFormat,
  type ChromePeer,
  type ChromeReport,
  type ChromeSaved,
  type ChromeWhy,
  type FrameDeniedReason,
  type HostCaps,
  type HostDestination,
  type HostTheme,
  type HostToShell,
  type ShellToHost,
  type ShareGuest,
  type ShareRole,
  type ShareView,
  type ShellBoot,
} from '@open-artifact/protocol';
import { isCloudShared } from '../lib/cloud.ts';

/** The owner session as the library reports it. */
export type Owner = NonNullable<ArtifactView['owner']>;

/** The host that embeds the Shell, once it said `host_hello`. */
export interface HostInfo {
  /** The host's origin: host messages go only there (`view`: the daemon's view channel). */
  origin: string;
  caps: HostCaps;
  /** What the host calls its agent, when it said. */
  agentName: string | null;
  /**
   * A connected adapter declared this origin (`caps.open.origins`), or the host is the adapter's own top-level view:
   * it gets prompts, comment text, links and saved files. An undeclared host (no adapter declared any origin) gets
   * what it got before, with no prompt or comment text.
   */
  declared: boolean;
  /** How host messages travel: to the parent frame, or through the daemon to the adapter that opened the view. */
  via: 'frame' | 'view';
  /** The host's colour scheme, when it gave one. */
  theme: HostTheme | null;
  /** Where the host can send an export (a declared host's only, at most `MAX_HOST_DESTINATIONS`). */
  destinations: HostDestination[];
}

/**
 * Whether a `host_hello` from `origin` is taken: `declared` when a connected adapter declared the origin, `refused`
 * when adapters declared others, `undeclared` when none declared any (or the list could not be read: `null`).
 */
export function hostVerdict(origin: string, hosts: readonly string[] | null): 'declared' | 'undeclared' | 'refused' {
  if (!hosts || !hosts.length) return 'undeclared';
  return hosts.includes(origin) ? 'declared' : 'refused';
}

/** The host a `host_hello` makes, reduced to its fields; `null` for anything else. */
export function hostOf(message: unknown, origin: string, declared: boolean, via: HostInfo['via'] = 'frame'): HostInfo | null {
  const hello = hostToShellOf(message);
  if (!hello || hello.openArtifact !== 'host_hello') return null;
  return {
    origin,
    caps: hello.caps,
    agentName: hello.agentName ?? null,
    declared,
    via,
    theme: hello.theme ?? null,
    destinations: declared ? (hello.destinations ?? []) : [],
  };
}

/**
 * What a Shell message to `host` carries: an undeclared host gets no prompt or comment text, and neither links nor
 * saved files (`null`: not sent).
 */
export function toHostMessage(host: HostInfo, message: ShellToHost): ShellToHost | null {
  if (host.declared) return message;
  switch (message.openArtifact) {
    case 'new_session':
      return { ...message, prompt: '' };
    case 'comment_summon':
      return { ...message, text: '' };
    case 'open_external':
    case 'saved_file':
      return null;
    default:
      return message;
  }
}

/** The page request a destination's pick sends the agent (data: the host's label and id, quoted). */
export function destinationRequest(destination: HostDestination, artifactTitle: string): string {
  return `Export "${artifactTitle}" and send it to the destination the person picked in the Export tab: "${destination.label}" (destination id: ${destination.id}). The host app that embeds the Shell offered this destination.`;
}

/**
 * The CSS variables a host's accent sets (`--open-artifact-accent`, its text colour and soft tint); none for no accent
 * or one that is not `#rrggbb`.
 */
export function accentVars(accent: string | null): Record<string, string> {
  if (!accent || !/^#[0-9a-f]{6}$/i.test(accent)) return {};
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(accent.slice(i, i + 2), 16) / 255);
  const lin = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
  return {
    '--open-artifact-accent': accent.toLowerCase(),
    '--open-artifact-accent-fg': luminance > 0.4 ? '#0b1220' : '#ffffff',
    '--open-artifact-accent-soft': `${accent.toLowerCase()}1f`,
  };
}

/** A goto or host_hello for the Shell; the parsed form of a host's message. */
export type HostMessage = HostToShell;

/** Share roles, most rights first. */
export const ROLES: readonly ShareRole[] = ['editor', 'commenter', 'viewer'];

/** The agent's display name: the host's, else the boot's, else a generic one. */
export function agentNameOf(host: HostInfo | null, boot: Pick<ShellBoot, 'agentName'> | null, fallback: string): string {
  return host?.agentName || boot?.agentName || fallback;
}

/**
 * The agent is at work: the owner session runs; with no owner known, the page says its agent is busy. The page's word
 * is the daemon's presence as its type server last passed it on, so it can be stale (a type server stopped mid-turn
 * never says idle); the owner, which the Shell refreshes on every harness change, decides when there is one.
 */
export function isWorking(owner: Owner | null | undefined, report: ChromeReport): boolean {
  if (owner) return owner.live && owner.status === 'running';
  return !!report.agent?.busy;
}

/** What the owner status chip says. */
export type OwnerState = 'none' | 'working' | 'idle' | 'offline';

/** The owner status chip's state. */
export function ownerState(owner: Owner | null | undefined, report: ChromeReport): OwnerState {
  if (isWorking(owner, report)) return 'working';
  if (!owner) return 'none';
  return owner.live ? 'idle' : 'offline';
}

/** The host can show the owner session: it offers sessions and a session owns the artifact. */
export function canOpenSession(host: HostInfo | null, owner: Owner | null | undefined): boolean {
  return !!(host?.caps.sessions && owner?.session);
}

/** The comments button shows when the page has comments and no button of its own. */
export function showsComments(report: ChromeReport): boolean {
  return !!(report.comments?.available && !report.comments.pageButton);
}

/** The count badge: empty for none, `99+` past 99. */
export function countText(count: number | undefined): string {
  if (!count || count < 0) return '';
  return count > 99 ? '99+' : String(count);
}

/** When an artifact last changed, for sorting. */
export function changedAt(a: Pick<ArtifactView, 'openedAt' | 'contentAt' | 'updatedAt' | 'createdAt'>): number {
  return Date.parse(a.openedAt || a.contentAt || a.updatedAt || a.createdAt || '') || 0;
}

/**
 * Switch artifact's list: the owner session's artifacts when it has more
 * than one, else every artifact; the most recent first.
 */
export function switchPool(library: ArtifactView[], owner: Owner | null | undefined): { inSession: boolean; list: ArtifactView[] } {
  const bySession = owner?.session
    ? library.filter((a) => a.owner && a.owner.harness === owner.harness && a.owner.session === owner.session)
    : [];
  const inSession = bySession.length > 1;
  const pool = inSession ? bySession : library;
  return { inSession, list: [...pool].sort((a, b) => changedAt(b) - changedAt(a)) };
}

/** A readable Design link to a page, an artboard or a running artboard; the editor resolves the name. */
const DESIGN_PLACE_FRAGMENT = /^#(?:page|artboard|play)-[^=&]+$/;

/** The shareable page of a Design canvas. Keep only its page id from the fragment. */
export function designPageFragment(fragment: string): string {
  const page = new URLSearchParams(fragment.replace(/^#/, '')).get('page');
  return page ? '#' + new URLSearchParams({ page }).toString() : '';
}

/** The page parameter is shared with Design. Old Sheet links used #sheet- followed by the sheet ID. */
export function sheetPageFragment(fragment: string): string {
  if (fragment.startsWith('#sheet-') && !fragment.includes('=')) {
    const id = fragment.slice('#sheet-'.length);
    return id ? '#' + new URLSearchParams({ page: id }).toString() : '';
  }
  return designPageFragment(fragment);
}

/** The types with a read-only view for another page to frame at {@link INLINE_VIEW_FRAGMENT}. */
const INLINE_VIEW_TYPES: ReadonlySet<string> = new Set(['slides', 'data']);

/**
 * A deck or a dashboard framed by another page at {@link INLINE_VIEW_FRAGMENT}: no bar, and the page shows the
 * read-only view.
 */
export function inlineView(boot: Pick<ShellBoot, 'type'>, shellHref: string, embedded: boolean): boolean {
  return embedded && INLINE_VIEW_TYPES.has(boot.type) && new URL(shellHref).hash === INLINE_VIEW_FRAGMENT;
}

/**
 * The page's address in the frame: the boot's page with `open_artifact_shell`, `open_artifact_id`
 * and the `comment` thread taken from the Shell's own address. `null` when
 * there is no page.
 */
export function pageAddress(boot: Pick<ShellBoot, 'page' | 'id'> & Partial<Pick<ShellBoot, 'type' | 'typeServer'>>, shellHref: string, embedded = false): string | null {
  if (!boot.page) return null;
  const shell = new URL(shellHref);
  const thread = shell.searchParams.get(SHELL_PARAMS.comment);
  try {
    const at = new URL(boot.page, shell.href);
    at.searchParams.set(SHELL_PARAMS.shell, shell.origin);
    at.searchParams.set(SHELL_PARAMS.id, boot.id);
    if (boot.type === 'slides' && SLIDE_FRAGMENT.test(shell.hash)) at.hash = shell.hash;
    if (boot.type !== undefined && inlineView({ type: boot.type }, shell.href, embedded)) at.hash = shell.hash;
    if (boot.type === 'docs') {
      at.searchParams.set('doc_link_base', boot.typeServer?.invite || shell.origin + shell.pathname);
      const tab = shell.searchParams.get('tab');
      if (tab) at.searchParams.set('tab', tab);
      at.hash = shell.hash;
    }
    if (boot.type === 'sheets') at.hash = sheetPageFragment(shell.hash);
    if (boot.type === 'design') {
      const hash = DESIGN_PLACE_FRAGMENT.test(shell.hash) ? shell.hash : designPageFragment(shell.hash);
      if (hash) at.hash = hash;
    }
    if (boot.type === 'design' || boot.type === 'slides') {
      if (shell.searchParams.get('open_artifact_engine') === 'off') at.searchParams.set('open_artifact_engine', 'off');
      if (shell.searchParams.get('open_artifact_live') === 'all') at.searchParams.set('open_artifact_live', 'all');
    }
    if (thread) at.searchParams.set(SHELL_PARAMS.comment, thread);
    return at.href;
  } catch {
    return boot.page;
  }
}

/** The Shell's address without the parameter `name`, or `null` when it has none. */
export function addressWithout(shellHref: string, name: string): string | null {
  const url = new URL(shellHref);
  if (!url.searchParams.has(name)) return null;
  url.searchParams.delete(name);
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The Shell's address without the `comment` thread (it is the page's to read), or `null` when unchanged. */
export function addressWithoutThread(shellHref: string): string | null {
  return addressWithout(shellHref, SHELL_PARAMS.comment);
}

/** The panel the Shell's address asks to open on load (`?panel=share` or `?panel=export`), or `null`. */
export function panelOf(shellHref: string): 'share' | 'export' | null {
  const value = new URL(shellHref).searchParams.get(SHELL_PARAMS.panel);
  return value === 'share' || value === 'export' ? value : null;
}

/** The page's own origin: chrome messages go only there and come only from there. */
export function pageOriginOf(page: string | null, shellHref: string): string {
  try {
    return page ? new URL(page, shellHref).origin : new URL(shellHref).origin;
  } catch {
    return new URL(shellHref).origin;
  }
}

/**
 * The Share button shows "shared": from the share state when loaded (on a cloud host: anyone named, or access past
 * them), else the page or the library.
 */
export function isShared(view: ShareView | null, report: ChromeReport, artifact: Pick<ArtifactView, 'shared'> | null): boolean {
  if (view?.cloud) return isCloudShared(view.cloud);
  return view ? view.lan : !!(report.shareOn || artifact?.shared);
}

/** The people who joined, online first, then the most recently seen. */
export function sortedGuests(view: ShareView): ShareGuest[] {
  return [...(view.guests ?? [])].sort((a, b) => Number(b.online) - Number(a.online) || (b.seen ?? b.joined).localeCompare(a.seen ?? a.joined));
}

/** The network addresses the panel names, with the port; the Tailscale address has a line of its own. */
export function shownAddresses(view: ShareView): string[] {
  const all = view.addresses ?? [];
  const lan = all.filter((a) => a !== view.tailnet?.address);
  const port = view.port ? `:${view.port}` : '';
  return (lan.length ? lan : all).map((a) => `${a.includes(':') ? `[${a}]` : a}${port}`);
}

/** The link that gives away the least among those that are on, or `null`. */
export function leastRole(view: ShareView): ShareRole | null {
  return [...ROLES].reverse().find((role) => view.links[role]?.on) ?? null;
}

/**
 * The link to give someone else, as the Export tab's Copy link and the title menu's give it: a cloud host's own
 * address, or the invite link of the least role that is on (at the network address, not 127.0.0.1). `null` when every
 * link is off: then only the Shell's own address is left.
 */
export function givenLink(view: ShareView): { which: string; url: string } | null {
  if (view.cloud) return view.cloud.url ? { which: 'cloud', url: view.cloud.url } : null;
  const role = leastRole(view);
  const url = role ? view.links[role]?.url : undefined;
  return role && url ? { which: role, url } : null;
}

/** How a message reached the owner session, from `artifacts.ask`'s `via`. */
export type Delivery = 'delivered' | 'drafted' | 'inbox' | 'failed';

/** The {@link Delivery} of an `artifacts.ask` answer. */
export function deliveryOf(via: string | undefined, status?: string): Delivery {
  // The harness put it in the conversation for the person to send there: delivered, but not yet to the agent.
  if (via === 'live' && status === 'drafted') return 'drafted';
  if (via === 'live' || via === 'wait') return 'delivered';
  // A cloud host whose owner's computer is connected: it has it now.
  if (via === 'link' && status === 'delivered') return 'delivered';
  // `link`: a cloud host keeps it until the owner's computer connects; like the inbox, the agent sees it later.
  if (via === 'inbox' || via === 'link') return 'inbox';
  return 'failed';
}

/** One message the person sent from the Shell (kept in session storage). */
export interface SentMessage {
  text: string;
  /** ISO time. */
  at: string;
  delivery: Delivery;
}

/** Appends a sent message, keeping the last `limit`. */
export function appendSent(list: SentMessage[], message: SentMessage, limit = 50): SentMessage[] {
  return [...list, message].slice(-limit);
}

/** Parses stored sent messages, dropping anything malformed. */
export function parseSent(raw: string | null): SentMessage[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter(
      (m): m is SentMessage =>
        !!m && typeof m === 'object' && typeof (m as SentMessage).text === 'string' && typeof (m as SentMessage).at === 'string',
    ).map((m) => ({ text: m.text, at: m.at, delivery: m.delivery === 'inbox' || m.delivery === 'failed' || m.delivery === 'drafted' ? m.delivery : 'delivered' }));
  } catch {
    return [];
  }
}

// ---- the boot and the page's frame ---------------------------------------------------------------------------------

/**
 * The finished boot `artifacts.boot` answered for the pending boot `pending`: the same artifact, not pending. Throws
 * when the answer is not one.
 */
export function finishedBoot(value: unknown, pending: Pick<ShellBoot, 'id'>): ShellBoot {
  const boot = value as Partial<ShellBoot> | null;
  if (!boot || typeof boot !== 'object' || boot.id !== pending.id || typeof boot.title !== 'string' || typeof boot.type !== 'string') {
    throw new Error(`No boot for ${pending.id}.`);
  }
  const { pending: _pending, ...rest } = boot as ShellBoot;
  return rest;
}

/** The boot while its page is being opened (again): what the bar needs stays, the page goes. */
export function pendingBoot(boot: ShellBoot): ShellBoot {
  return { ...boot, page: null, pageUrl: null, pageKind: null, problem: null, pending: true };
}

/** The boot that shows `problem` instead of the page. */
export function problemBoot(boot: ShellBoot, problem: string): ShellBoot {
  const { pending: _pending, ...rest } = boot;
  return { ...rest, page: null, pageUrl: null, pageKind: null, problem };
}

/**
 * Why a page server refused the frame (`frame_denied`), or `null` when the message is not one. An unknown reason
 * reads as `not_open`: the address is asked for again either way.
 */
export function frameDeniedReason(message: unknown): FrameDeniedReason | null {
  const m = message as { openArtifact?: unknown; reason?: unknown } | null;
  if (!m || typeof m !== 'object' || m.openArtifact !== 'frame_denied') return null;
  return (FRAME_DENIED_REASONS as readonly unknown[]).includes(m.reason) ? (m.reason as FrameDeniedReason) : 'not_open';
}

/** What a `frame_denied` does: ask for the page's address again (once), or show the problem. */
export function afterFrameDenied(boot: Pick<ShellBoot, 'typeServer'>, retried: boolean): 'reopen' | 'problem' {
  // A type server's own Shell has no Library API to ask: its page is the one it served.
  return retried || boot.typeServer ? 'problem' : 'reopen';
}

/**
 * The frame's page shows once it says so (its first `chrome_report`). A page that is not a type server's may never
 * speak the chrome protocol: it shows on `load`.
 */
export function readyOnLoad(pageKind: ShellBoot['pageKind']): boolean {
  return pageKind !== 'server';
}

/** The longest the cover stays after the frame's `load` when its page has not said it is ready. */
export const FRAME_READY_FALLBACK_MS = 1_500;
/** How long the cover takes to fade. */
export const COVER_FADE_MS = 150;

/**
 * A boot for development, when the daemon did not inject one: built from
 * `artifacts.open` and `artifact` answers.
 */
export function devBoot(
  detail: ArtifactView,
  page: { page: string; page_url: string } | null,
  problem: string | null,
): ShellBoot {
  return {
    id: detail.id,
    url: detail.url,
    title: detail.title,
    type: detail.type,
    typeTitle: detail.typeTitle,
    root: detail.root,
    page: page?.page ?? null,
    pageUrl: page?.page_url ?? null,
    pageKind: null,
    problem: page ? null : problem,
    empty: false,
    prompt: null,
    owner: detail.owner ? { harness: detail.owner.harness, key: null } : null,
    agentName: '',
    userName: '',
    version: 'dev',
  };
}

// ---- the page's report (chrome protocol) --------------------------------------------------------------------------

const SAVED: readonly ChromeSaved[] = ['saved', 'saving', 'unsaved', 'reconnecting', 'readonly'];
const WHY: readonly ChromeWhy[] = ['older_version', 'agent_working', 'draft_open', 'comments_on', 'needs_agent', 'unsaved', 'other'];
const ACTION_ID = /^[a-z][a-z0-9_-]{0,31}$/;
/** Formats a page may list, and variants per format (Design's PNG has nine). */
export const MAX_FORMATS = 8;
export const MAX_VARIANTS = 16;
const FORMAT = /^[a-z0-9]{1,8}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** A short display string from the page: trimmed, no control characters, at most `max` characters. */
function shortText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  const text = [...value.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()].slice(0, max).join('');
  return text || undefined;
}

function whyOf(value: unknown): ChromeWhy | undefined {
  return WHY.includes(value as ChromeWhy) ? (value as ChromeWhy) : undefined;
}

/**
 * The page's report as the Shell keeps it. The v1 parts pass as they are;
 * the newer ones are checked one entry at a time (a bad entry is dropped,
 * not the report), and lists are capped.
 */
export function normalizeReport(raw: unknown): ChromeReport {
  if (!isRecord(raw)) return {};
  const out: ChromeReport = {};
  if (typeof raw.title === 'string') out.title = raw.title.trim().slice(0, 256);
  for (const key of ['comments', 'agent'] as const) if (isRecord(raw[key])) (out as Record<string, unknown>)[key] = raw[key];
  for (const key of ['ready', 'history', 'share', 'shareOn', 'exports', 'leaveLosesWork', 'hasContent'] as const) {
    if (typeof raw[key] === 'boolean') out[key] = raw[key];
  }
  if (SAVED.includes(raw.saved as ChromeSaved)) out.saved = raw.saved as ChromeSaved;
  if (Array.isArray(raw.actions)) {
    const seen = new Set<string>();
    const actions: ChromeAction[] = [];
    for (const entry of raw.actions) {
      if (!isRecord(entry) || typeof entry.id !== 'string' || !ACTION_ID.test(entry.id) || seen.has(entry.id)) continue;
      seen.add(entry.id);
      const label = shortText(entry.label, 48);
      const why = whyOf(entry.why);
      actions.push({ id: entry.id, ...(label ? { label } : {}), ...(entry.disabled === true ? { disabled: true } : {}), ...(why ? { why } : {}) });
      if (actions.length === 18) break;
    }
    out.actions = actions;
  }
  if (Array.isArray(raw.formats)) {
    const seen = new Set<string>();
    const formats: ChromeFormat[] = [];
    for (const entry of raw.formats) {
      if (!isRecord(entry) || typeof entry.format !== 'string' || !FORMAT.test(entry.format) || seen.has(entry.format)) continue;
      seen.add(entry.format);
      const label = shortText(entry.label, 48);
      const description = shortText(entry.description, 160);
      const why = whyOf(entry.why);
      const reason = shortText(entry.disabledReason, 160);
      const variants = Array.isArray(entry.variants)
        ? entry.variants
            .filter((v): v is Record<string, unknown> => isRecord(v) && typeof v.id === 'string' && ACTION_ID.test(v.id))
            .slice(0, MAX_VARIANTS)
            .map((v) => {
              const vLabel = shortText(v.label, 80);
              const vReason = shortText(v.disabledReason, 160);
              return { id: v.id as string, ...(vLabel ? { label: vLabel } : {}), ...(v.disabled === true ? { disabled: true } : {}), ...(vReason ? { disabledReason: vReason } : {}) };
            })
        : undefined;
      formats.push({
        format: entry.format,
        ...(label ? { label } : {}),
        ...(description ? { description } : {}),
        ...(entry.disabled === true ? { disabled: true } : {}),
        ...(why ? { why } : {}),
        ...(reason ? { disabledReason: reason } : {}),
        ...(entry.interactive === true ? { interactive: true } : {}),
        ...(entry.more === true ? { more: true } : {}),
        ...(variants?.length ? { variants } : {}),
      });
      if (formats.length === MAX_FORMATS) break;
    }
    out.formats = formats;
  }
  if (isRecord(raw.shareNotice) && raw.shareNotice.tone === 'warning' && typeof raw.shareNotice.text === 'string' && raw.shareNotice.text.trim()) {
    out.shareNotice = { text: raw.shareNotice.text.slice(0, 2000), tone: 'warning' };
  }
  if (Array.isArray(raw.peers)) out.peers = peersOf(raw.peers);
  if (raw.following === null) out.following = null;
  else if (typeof raw.following === 'string' && CHROME_PEER_KEY.test(raw.following)) out.following = raw.following;
  return out;
}

/** The peers of a report: valid keys, once each, at most {@link MAX_CHROME_PEERS}. */
function peersOf(raw: unknown[]): ChromePeer[] {
  const seen = new Set<string>();
  const peers: ChromePeer[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.key !== 'string' || !CHROME_PEER_KEY.test(entry.key) || seen.has(entry.key)) continue;
    const name = shortText(entry.name, 80);
    if (!name) continue;
    seen.add(entry.key);
    peers.push({
      key: entry.key,
      name,
      ...(typeof entry.color === 'string' && COLOR.test(entry.color) ? { color: entry.color.toLowerCase() } : {}),
      ...(entry.self === true ? { self: true } : {}),
      ...(entry.followsYou === true ? { followsYou: true } : {}),
    });
    if (peers.length === MAX_CHROME_PEERS) break;
  }
  return peers;
}

/** The page offers following someone's view. */
export function offersFollow(report: ChromeReport): boolean {
  return report.following !== undefined;
}

/** The peer this view follows, while they are still listed. */
export function followedPeer(report: ChromeReport): ChromePeer | null {
  const key = report.following;
  return key ? (report.peers?.find((peer) => peer.key === key) ?? null) : null;
}

/** Peer colours, as the pages pick them (editor-kit's palette), for a peer the page gave none. */
const PEER_COLORS = ['#dc3c3d', '#019c7f', '#fbb315', '#ce447d', '#10a122', '#257de0', '#d25f25', '#785ee8'];

/** A peer's colour: theirs, else one picked from their key. */
export function peerColorOf(peer: Pick<ChromePeer, 'key' | 'color'>): string {
  if (peer.color) return peer.color;
  let hash = 0;
  for (const char of peer.key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return PEER_COLORS[hash % PEER_COLORS.length]!;
}

/** Text colour that reads on a peer colour. */
export function inkOnColor(hex: string): '#0b0b0b' | '#ffffff' {
  const channel = (at: number) => {
    const c = parseInt(hex.slice(at, at + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  return luminance > 0.4 ? '#0b0b0b' : '#ffffff';
}

/** Initials for a peer's avatar: the first letters of the first two words. */
export function peerInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((word) => [...word][0] ?? '');
  return (letters.join('') || '?').toUpperCase();
}

/** The page offers exports: detailed formats, or v1 items. */
export function hasExports(report: ChromeReport): boolean {
  return !!(report.formats?.length || report.exports);
}

/**
 * The Export tab offers the whole folder as a zip, last: on any page but a
 * read-only one (an older version's page, which the folder no longer is).
 */
export function offersArchive(report: ChromeReport): boolean {
  return report.saved !== 'readonly';
}

/** The Share panel has an Export tab: the page's exports, or the folder's zip. */
export function hasExportTab(report: ChromeReport): boolean {
  return hasExports(report) || offersArchive(report);
}

/** The page's action with this id, when declared. */
export function actionOf(report: ChromeReport, id: string): ChromeAction | undefined {
  return report.actions?.find((action) => action.id === id);
}

/** Actions the Shell's own controls stand for, never listed as page actions. */
const DRAWN_ELSEWHERE = new Set(['chat_toggle']);

/** The actions the artifact menu lists. */
export function menuActions(report: ChromeReport): ChromeAction[] {
  return (report.actions ?? []).filter((action) => !DRAWN_ELSEWHERE.has(action.id));
}

/**
 * How long a page must keep saving before the bar says "Saving…", ms. Pages report `saving` for every edit (it covers
 * the write debounce too), so a quick save never shows.
 */
export const SAVING_SHOWN_AFTER_MS = 500;

/** What the save indicator shows. */
export type SaveIndicator = 'none' | 'saving' | 'reconnecting' | 'unsaved' | 'retry' | 'readonly';

/**
 * The save indicator: Read-only always; Saving…
 * and Reconnecting… only for pages that declare `save_now` (others save
 * too often for it to be worth a flicker); a failed save always, as a
 * retry button when `save_now` can run.
 */
export function saveIndicator(report: ChromeReport): SaveIndicator {
  const save = actionOf(report, 'save_now');
  switch (report.saved) {
    case 'readonly':
      return 'readonly';
    case 'unsaved':
      return save && !save.disabled ? 'retry' : 'unsaved';
    case 'saving':
    case 'reconnecting':
      return save ? report.saved : 'none';
    default:
      return 'none';
  }
}

const FORMAT_NAMES: Record<string, string> = {
  pdf: 'PDF',
  pptx: 'PowerPoint',
  docx: 'Word',
  xlsx: 'Excel',
  png: 'PNG',
  jpg: 'JPEG',
  jpeg: 'JPEG',
  svg: 'SVG',
  gif: 'GIF',
  mp4: 'MP4',
  webm: 'WebM',
  html: 'HTML',
  md: 'Markdown',
  csv: 'CSV',
  json: 'JSON',
  zip: 'ZIP',
  txt: 'Text',
};

/** `all_slides` → `All slides`. */
export function humanize(id: string): string {
  const words = id.replace(/[_-]+/g, ' ').trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : id;
}

/** One row of the Export tab: a format, or one variant of it. */
export interface ExportEntry {
  key: string;
  label: string;
  /** The format's own name (for its icon). */
  kind: string;
  description?: string;
  format: string;
  variant?: string;
  interactive: boolean;
  /** The row opens something first: a chevron instead of the download arrow. */
  more: boolean;
  disabled: boolean;
  why?: ChromeWhy;
  /** Why it is disabled, in the page's words (wins over `why`). */
  disabledReason?: string;
}

/** The Export tab's rows for the page's formats: one per format, or one per variant. */
export function exportEntries(report: ChromeReport): ExportEntry[] {
  const empty = report.hasContent === false;
  const out: ExportEntry[] = [];
  for (const f of report.formats ?? []) {
    const name = f.label ?? FORMAT_NAMES[f.format] ?? f.format.toUpperCase();
    const base = { kind: `${name} ${f.format}`, format: f.format, interactive: !!f.interactive, more: !!(f.more || f.interactive), ...(f.why ? { why: f.why } : {}) };
    if (f.variants?.length) {
      for (const v of f.variants) {
        const off = !!f.disabled || !!v.disabled;
        // The variant's own reason when it alone is off, else the format's.
        const reason = off ? ((v.disabled && v.disabledReason) || f.disabledReason) : undefined;
        out.push({
          ...base,
          key: `${f.format}:${v.id}`,
          label: `${name} · ${v.label ?? humanize(v.id)}`,
          ...(f.description ? { description: f.description } : {}),
          variant: v.id,
          disabled: empty || off,
          ...(reason ? { disabledReason: reason } : {}),
        });
      }
    } else {
      out.push({ ...base, key: f.format, label: name, ...(f.description ? { description: f.description } : {}), disabled: empty || !!f.disabled, ...(f.disabled && f.disabledReason ? { disabledReason: f.disabledReason } : {}) });
    }
  }
  return out;
}

const REQUEST_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** A fresh export request id (matches `CHROME_REQUEST`). */
export function exportRequestId(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return [...random(24)].map((b) => REQUEST_ALPHABET[b % REQUEST_ALPHABET.length]).join('');
}
