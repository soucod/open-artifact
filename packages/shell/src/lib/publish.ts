/**
 * Publishing a local artifact to the web: the daemon's cloud remotes (`remotes`, `remotes.add`, `remotes.add.wait`,
 * `artifacts.publish`, `artifacts.unpublish`) as the local Share panel shows them. Pure: no DOM, no store, so it runs
 * under `node --test`.
 *
 * The panel never says "remote", "host" or "device flow": a remote is a place that gives the artifact a web address,
 * linking one is "connecting", and sending the artifact there is "publishing".
 */

import { httpAllowance, type RemoteErrorCode } from '@open-artifact/protocol';
import type { MessageKey } from './i18n.ts';

/** Who a remote is signed in as (`LinkUser`). */
export interface RemoteUser {
  id: string;
  name: string;
  email?: string;
}

/** One published artifact as `GET remotes` lists it under its remote (the daemon's `RemoteStatus.artifacts`). */
export interface RemoteArtifact {
  id: string;
  url: string;
  title: string;
  /** The artifact's web address. */
  view_url: string;
  /** When its files last matched the host's (kept across restarts). */
  syncedAt: string | null;
  /** When the last sync pass ended well (this run of the daemon only). */
  lastSyncAt: string | null;
  /** Paths changed here and not on the host yet. */
  pending: string[];
  /** Why the last sync failed, in English (shown as is), or `null`. */
  lastError: string | null;
  /** {@link lastError} as a stable code: what the panel decides by. */
  code: RemoteErrorCode | null;
}

/** One remote as `GET remotes` answers it (the daemon's `RemoteStatus`). Not in `@open-artifact/protocol` yet. */
export interface RemoteInfo {
  name: string;
  host: string;
  user: RemoteUser | null;
  signedIn: boolean;
  /** Its event stream is up. */
  connected: boolean;
  /** Its last call reached it. */
  reachable: boolean;
  lastEventId: string | null;
  lastError: string | null;
  /** {@link lastError} as a stable code. */
  code: RemoteErrorCode | null;
  /** The site used when none is named (and for publishing by itself). Older daemons leave it out. */
  default?: boolean;
  /** Added by an install-time preset. */
  preset?: boolean;
  /** Reached over plain http beyond this computer: not encrypted. */
  insecure?: boolean;
  /** A preset site waiting for the person to approve this computer there. */
  approval?: RemoteApproval;
  artifacts: RemoteArtifact[];
}

/** A preset site's approval under way (the daemon's `RemoteApproval`). */
export interface RemoteApproval {
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_at: string;
}

/** One artifact publishing by itself has not got onto its site yet (the daemon's `AutoPublishStatus`). */
export interface AutoPending {
  id: string;
  url: string;
  title: string;
  remote: string | null;
  attempts: number;
  lastError: string | null;
  code: RemoteErrorCode | null;
  nextAt: string | null;
}

/** `GET remotes`'s `cloud`: the default site and publishing by itself (the daemon's `CloudStatus`). */
export interface CloudInfo {
  default: string | null;
  publish: 'auto' | 'manual';
  pending: AutoPending[];
}

/** `GET remotes` whole. An older daemon answers no `cloud`: `null`. */
export interface RemotesAnswer {
  remotes: RemoteInfo[];
  cloud: CloudInfo | null;
}

/** `POST remotes.add`'s answer: the code to approve and where (the daemon's `SignInStart`). */
export interface ConnectStart {
  name: string;
  host: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  /** The daemon opened the approval page in this computer's browser itself. */
  opened: boolean;
  /** Said when the site is reached over plain http beyond this computer. */
  warning?: string;
}

/** `POST remotes.add.wait`'s answer. */
export type ConnectWait = { status: 'done'; user: RemoteUser } | { status: 'pending' };

/** `POST artifacts.publish`'s answer. */
export interface PublishResult {
  url: string;
  id: string;
  remote?: string;
  view_url?: string;
}

/** A message key and what fills it. */
export interface Said {
  key: MessageKey;
  vars?: Record<string, string | number>;
}

// ---- the connect form ----------------------------------------------------------------------------------------------

/** A remote's name, as the daemon allows it (`REMOTE_NAME`). */
export const REMOTE_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/i;

/** The host name of an address typed without a scheme (`oa.lan:4900/x` -> `oa.lan`, `[fd00::1]:80` -> `[fd00::1]`). */
function bareHostName(text: string): string {
  const match = /^(\[[^\]]*\]|[^/:?#]+)/.exec(text);
  return match?.[1] ?? '';
}

/**
 * The address typed in the connect form as the host's origin, checked like the daemon checks it: `https`, or `http`
 * on this computer or a private network (`httpAllowance`: decided by the name as written). A bare public name
 * (`oa.example.com`) means https; a bare private one (`localhost:4900`, `192.168.1.20:4900`, `nas.lan`) means http.
 * `insecure`: plain http beyond this computer, which the form warns about.
 */
export function checkHostAddress(raw: string): { ok: true; host: string; insecure?: true } | { ok: false; reason: Said } {
  const text = raw.trim();
  if (!text) return { ok: false, reason: { key: 'pubHostEmpty' } };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `${httpAllowance(bareHostName(text)) === 'refused' ? 'https' : 'http'}://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, reason: { key: 'pubHostInvalid' } };
  }
  if (!url.hostname || (url.protocol !== 'https:' && url.protocol !== 'http:')) return { ok: false, reason: { key: 'pubHostInvalid' } };
  if (url.username || url.password) return { ok: false, reason: { key: 'pubHostInvalid' } };
  if (url.protocol !== 'http:') return { ok: true, host: url.origin };
  const allowance = httpAllowance(url.hostname);
  if (allowance === 'refused') return { ok: false, reason: { key: 'pubHostNotHttps' } };
  return allowance === 'private' ? { ok: true, host: url.origin, insecure: true } : { ok: true, host: url.origin };
}

// ---- the default site and publishing by itself ---------------------------------------------------------------------

/** The site Publish uses when none is picked: the daemon's default, else the only one, else `null`. */
export function defaultSite(remotes: readonly RemoteInfo[] | null, cloud: CloudInfo | null): string | null {
  if (!remotes?.length) return null;
  const named = cloud?.default ?? remotes.find((r) => r.default)?.name ?? null;
  if (named && remotes.some((r) => r.name === named)) return named;
  return remotes.length === 1 ? remotes[0]!.name : null;
}

/** Whether the panel offers a default-site picker: only when more than one site is connected. */
export function offersDefaultPicker(remotes: readonly RemoteInfo[] | null): boolean {
  return (remotes?.length ?? 0) > 1;
}

/** How publishing by itself stands for this artifact, or `null` when it is not waiting for it. */
export type AutoView = { kind: 'publishing'; site: string | null } | { kind: 'failed'; site: string | null; attempts: number; error: string; code: RemoteErrorCode };

/** {@link AutoView} of an artifact from `GET remotes`'s `cloud`. */
export function autoView(cloud: CloudInfo | null, id: string): AutoView | null {
  const item = cloud?.pending.find((p) => p.id === id);
  if (!item) return null;
  if (item.lastError) return { kind: 'failed', site: item.remote, attempts: item.attempts, error: item.lastError, code: item.code ?? 'error' };
  return { kind: 'publishing', site: item.remote };
}

/** {@link AutoView} in words. */
export function autoText(view: AutoView, remotes: readonly RemoteInfo[] | null): Said {
  const remote = remotes?.find((r) => r.name === view.site);
  const host = remote ? hostLabel(remote.host) : (view.site ?? '');
  if (view.kind === 'publishing') return { key: 'pubAutoPublishing', vars: { host } };
  if (view.code === 'signed_out') return { key: 'pubAutoSignedOut', vars: { host } };
  if (view.code === 'unreachable') return { key: 'pubAutoUnreachable', vars: { host } };
  return { key: 'pubAutoFailed', vars: { host, error: view.error } };
}

/**
 * A name for a new remote from its address, not among `taken`: the host name's first word (`oa.example.com` -> `oa`,
 * `localhost:4900` -> `localhost`), then `-2`, `-3`… when taken.
 */
export function suggestName(host: string, taken: readonly string[]): string {
  let word = 'web';
  try {
    const label = new URL(host).hostname.split('.')[0] ?? '';
    const clean = label.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[-_]+/, '').slice(0, 28);
    if (clean && REMOTE_NAME.test(clean)) word = clean;
  } catch {
    // Not an address yet: the default word.
  }
  const used = new Set(taken.map((n) => n.toLowerCase()));
  if (!used.has(word)) return word;
  for (let n = 2; ; n++) if (!used.has(`${word}-${n}`)) return `${word}-${n}`;
}

/** Why a name typed in the connect form cannot be used, or `null`. */
export function checkName(name: string): Said | null {
  return REMOTE_NAME.test(name.trim()) ? null : { key: 'pubNameInvalid' };
}

// ---- what the panel shows ------------------------------------------------------------------------------------------

/** Where an artifact is published, from `GET remotes`: its remote and its entry there, or `null`. */
export function publishedOf(remotes: readonly RemoteInfo[] | null, id: string): { remote: RemoteInfo; artifact: RemoteArtifact } | null {
  for (const remote of remotes ?? []) {
    const artifact = remote.artifacts.find((a) => a.id === id);
    if (artifact) return { remote, artifact };
  }
  return null;
}

/** A remote's state as its row shows it. */
export type RemoteState = 'connected' | 'connecting' | 'unreachable' | 'signed_out';

/** A remote's row state: signed out first (it needs the person), then unreachable, then whether its stream is up. */
export function remoteState(remote: Pick<RemoteInfo, 'signedIn' | 'reachable' | 'connected'>): RemoteState {
  if (!remote.signedIn) return 'signed_out';
  if (!remote.reachable) return 'unreachable';
  return remote.connected ? 'connected' : 'connecting';
}

/** The sync state of a published artifact, as the panel says it. */
export type SyncView =
  | { kind: 'in_sync'; at: string | null }
  | { kind: 'waiting'; count: number }
  | { kind: 'offline'; count: number }
  | { kind: 'signed_out'; count: number }
  | { kind: 'failed'; error: string; count: number };

/**
 * What the daemon reports of a published artifact, as one state: signed out (nothing moves until the person connects
 * again), the host unreachable (changes wait here), a failed sync, changes waiting, or in sync.
 */
export function syncView(remote: Pick<RemoteInfo, 'signedIn' | 'reachable'>, artifact: RemoteArtifact): SyncView {
  const count = artifact.pending.length;
  if (!remote.signedIn) return { kind: 'signed_out', count };
  if (!remote.reachable) return { kind: 'offline', count };
  if (artifact.lastError) {
    if (artifact.code === 'unreachable') return { kind: 'offline', count };
    if (artifact.code === 'signed_out') return { kind: 'signed_out', count };
    return { kind: 'failed', error: artifact.lastError, count };
  }
  if (count) return { kind: 'waiting', count };
  return { kind: 'in_sync', at: artifact.lastSyncAt ?? artifact.syncedAt };
}

/** The sync state as a sentence (`ago` formats a time for "in sync"). */
export function syncText(view: SyncView, host: string, ago: (iso: string) => string): Said {
  switch (view.kind) {
    case 'in_sync':
      return view.at ? { key: 'pubInSyncAt', vars: { when: ago(view.at) } } : { key: 'pubInSync' };
    case 'waiting':
      return { key: view.count === 1 ? 'pubWaitingOne' : 'pubWaiting', vars: { count: view.count } };
    case 'offline':
      return { key: 'pubOffline', vars: { host: hostLabel(host) } };
    case 'signed_out':
      return { key: 'pubSignedOutSync', vars: { host: hostLabel(host) } };
    case 'failed':
      return { key: 'pubSyncFailed', vars: { error: view.error } };
  }
}

/** A host's address without `https://`, as the panel names it. */
export function hostLabel(host: string): string {
  try {
    const url = new URL(host);
    return url.protocol === 'https:' ? url.host : `${url.protocol}//${url.host}`;
  } catch {
    return host;
  }
}

// ---- failures in plain words -----------------------------------------------------------------------------------------

/** A failed call as the daemon answered it (`ApiError`'s fields). */
export interface Failure {
  code: string;
  message: string;
  status: number;
}

/** Why connecting failed, in plain words (denied, ran out, unreachable, not https…). */
export function connectFailure(error: Failure, host: string): Said {
  const at = { host: hostLabel(host) };
  if (error.status === 0) return { key: 'pubNoDaemon' };
  switch (error.code) {
    case 'not_granted':
    case 'access_denied':
      return { key: 'pubConnectDenied', vars: at };
    case 'timeout':
    case 'expired_token':
      return { key: 'pubConnectExpired' };
    case 'connect_failed':
      return { key: 'pubConnectUnreachable', vars: at };
    case 'not_found':
      // No such route on the host, or no device flow under way any more.
      return /sign-in to .* is under way/i.test(error.message) ? { key: 'pubConnectExpired' } : { key: 'pubConnectNotHost', vars: at };
    case 'conflict':
      return { key: 'pubNameTaken' };
    case 'invalid_argument':
      if (/https/i.test(error.message)) return { key: 'pubHostNotHttps' };
      if (/remote name/i.test(error.message)) return { key: 'pubNameInvalid' };
      return { key: 'pubHostInvalid' };
    case 'server_failed':
      return /without a code|is it an Open Artifact host/i.test(error.message) ? { key: 'pubConnectNotHost', vars: at } : { key: 'pubConnectFailed', vars: { error: error.message } };
    default:
      return { key: 'pubConnectFailed', vars: { error: error.message } };
  }
}

/** Why publishing failed, in plain words with what to do (id taken there, too large, signed out, unreachable…). */
export function publishFailure(error: Failure, host: string): Said {
  const at = { host: hostLabel(host) };
  if (error.status === 0) return { key: 'pubNoDaemon' };
  switch (error.code) {
    case 'conflict':
      return /published to .* already/i.test(error.message) ? { key: 'pubAlreadyElsewhere' } : { key: 'pubIdTaken', vars: at };
    case 'too_large':
      return { key: 'pubTooLarge', vars: at };
    case 'unauthorized':
      return { key: 'pubSignedOut', vars: at };
    case 'not_granted':
      return { key: 'pubNotAllowed', vars: at };
    case 'connect_failed':
      return { key: 'pubUnreachable', vars: at };
    case 'unsupported':
      return { key: 'pubUnsupported', vars: at };
    default:
      return error.status === 413 ? { key: 'pubTooLarge', vars: at } : { key: 'pubFailed', vars: { error: error.message } };
  }
}

/** Why unpublishing failed, in plain words. */
export function unpublishFailure(error: Failure, host: string): Said {
  const at = { host: hostLabel(host) };
  if (error.status === 0) return { key: 'pubNoDaemon' };
  switch (error.code) {
    case 'connect_failed':
      return { key: 'unpubUnreachable', vars: at };
    case 'unauthorized':
      return { key: 'pubSignedOut', vars: at };
    default:
      return { key: 'unpubFailed', vars: { error: error.message } };
  }
}
