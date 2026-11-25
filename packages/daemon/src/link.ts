/**
 * Link: the daemon's side of keeping published artifacts in step with cloud hosts.
 *
 * A published artifact keeps its folder: it becomes the working copy, and the host is the authority. The agent keeps
 * writing files there with its own tools; {@link LinkHub} watches the folder (and rescans after a tool wrote, on a
 * timer and when the host says files changed) and settles each path by comparing three etags: the working copy's,
 * the host's (`link.manifest`) and `base`, the one both had at the last sync (`ArtifactRecord.remote.base`):
 *
 * - only the working copy changed: pushed with `if_match` = the base etag (`null` for a new file);
 * - only the host changed: pulled into the working copy (atomically) and recorded as the person's edit, so the
 *   agent's next `Artifact read` lists it in `changed_files`;
 * - both changed (or a push is refused): the host's version goes to the path, the working copy's is kept under
 *   `_agent/conflicts/<path>`, and the owning session is told in its next tool result.
 *
 * Deletions follow the same rules. Only the paths `linkSynced` allows travel (no `.artifact.json`, no `history/`, nothing
 * the export zip leaves out), and `doc/` and `sheet/` (written only by the host's server) are pulled as a read-only
 * mirror, never pushed. When the host cannot be reached the writes stay in the working copy and the sync is retried
 * with back-off.
 *
 * A pulled path counts as a person's edit (`changed_files`) when a `files` event named it, or when nothing explains
 * it otherwise: not when the agent's own forwarded call wrote it (a `link.call` is not echoed as an event), and never
 * for `comments.json` (comments reach the agent as wakes).
 *
 * Each remote has one event stream (`link.events`): `wake` goes to the wake router as a page's wake does, `files`
 * starts a sync, `artifact` renames or unlinks, `data-refresh` asks for a dashboard's live data to be run again here
 * (`data-refresh.ts` holds that rule). Each event is acknowledged once handled.
 */

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, watch, type Dirent, type FSWatcher } from 'node:fs';
import { dirname, extname, join, sep } from 'node:path';
import {
  OpenArtifactError,
  artifactUrl,
  linkSynced,
  serverWrittenPath,
  type ArtifactRecord,
  type ArtifactRemote,
  type CloudPublishMode,
  type CloudSettings,
  type LinkDeviceStart,
  type LinkEvent,
  type LinkUser,
  type LinkWrite,
  type OpenArtifactSettings,
  type RemoteErrorCode,
  type WakeRequestItem,
  type WakeSender,
  type WakeThread,
  type SiteTypeVisibility,
  type TypesPublishResponse,
  type TypesUnpublishResponse,
} from '@open-artifact/protocol';
import type { Inbox } from './inbox.ts';
import { inside, writeFileAtomic } from './paths.ts';
import { tokenHash, type CloudPreset } from './preset.ts';
import {
  LinkClient,
  REMOTE_NAME,
  RemotesFile,
  checkHost,
  insecureOrigin,
  insecureWarning,
  linkDevice,
  linkToken,
  parseLinkEvent,
  pollDeviceToken,
  readSse,
  remoteErrorCode,
  remoteNameFor,
  tokenFields,
  type StoredRemote,
} from './remote.ts';
import { sessionKeyOf, userEditsAfter, type ArtifactStore } from './store.ts';
import { PAGE_NO_SITE, typePublishRefusal, type TypeInfo } from './types.ts';
import type { PackedType } from './type-packages.ts';
import { UNOWNED_KEY, type WakeItem, type WakeResult } from './wake.ts';

/**
 * Actions that always run on the working copy, published or not: `check`, and the ones the host refuses because they
 * need this computer's disk or browser (`upload`, `snapshot`, `share`, Docs `duplicate`). Docs `import` is not here:
 * it writes `doc/`, which a sync never pushes, so the host's refusal is passed on rather than losing the import.
 */
const LOCAL_ACTIONS = new Set(['check', 'upload', 'snapshot', 'share', 'duplicate']);
/**
 * Rendering actions of a type that run on the working copy even when its store is the server's (decision 26: the host
 * never runs a browser): read-only, they draw or write files on this computer with its own headless Chrome and tools.
 * A sync brings the host's latest first ({@link LinkHub.freshen}). `snapshot` is local for every type
 * ({@link LOCAL_ACTIONS}); Motion stills are the type server's `stills` command on the folder, not an action.
 */
const LOCAL_RENDERS: Readonly<Record<string, ReadonlySet<string>>> = { docs: new Set(['export']) };
/** Actions forwarded to the host for a published artifact, whatever its type. */
const FORWARDED_ACTIONS = new Set(['context', 'asking', 'summary']);
/** Stores whose files only their server writes: every action of such a type (but {@link LOCAL_ACTIONS}) is forwarded. */
const SERVER_STORES = new Set(['doc', 'workbook']);
/**
 * Syncs soon after an artifact's watch starts, ms after it. The OS arms a new watch in the background (FSEvents on
 * macOS): a write made in that moment is never reported, and without these it would wait for the rescan timer.
 */
const ARM_SYNC_MS: readonly number[] = [300, 1_500];
/** Largest batch of pushes in one `link.files` request, bytes before base64. */
const PUSH_BATCH_BYTES = 4 << 20;
/** Event ids remembered per remote, so a redelivered event is acknowledged but not handled twice. */
const HANDLED_KEEP = 2000;
/** How long a path the agent wrote through `link.call` waits to be pulled as the agent's own, ms. */
const AGENT_PATH_MS = 60_000;
/** After a forwarded call, how long pulled paths no person's event names count as the agent's, ms. */
const AGENT_CALL_MS = 3000;
/** Pulled, but never a person's edit of the content. */
const NOT_AN_EDIT = new Set(['comments.json']);

const envMs = (name: string, fallback: number): number => {
  const value = Number(process.env[name]);
  return process.env[name] && Number.isFinite(value) && value >= 0 ? value : fallback;
};

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

const message = (error: unknown): string => (error as Error)?.message ?? String(error);

/** A wake event's sender, when it is a well-formed non-owner (the owner sends with no `from`), else undefined. */
export function wakeSenderOf(value: unknown): WakeSender | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { name, role } = value as { name?: unknown; role?: unknown };
  if (typeof name !== 'string' || !name.trim()) return undefined;
  if (role !== 'editor' && role !== 'commenter' && role !== 'viewer') return undefined;
  return { name: name.trim().slice(0, 80), role };
}

/** A path under `_agent/conflicts/` that is not taken yet. */
function conflictFile(root: string, path: string): string {
  const first = inside(root, `_agent/conflicts/${path}`);
  if (!existsSync(first)) return first;
  const ext = extname(first);
  const stem = first.slice(0, first.length - ext.length);
  for (let n = 2; ; n++) {
    const next = `${stem}.${n}${ext}`;
    if (!existsSync(next)) return next;
  }
}

/** What the CLI's `remote add` gets back to show the person. */
export interface SignInStart {
  name: string;
  host: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  /** Whether the approval page was opened in the browser. */
  opened: boolean;
  /** Said when the host is reached over plain http beyond this computer ({@link insecureWarning}). */
  warning?: string;
}

/** A device sign-in under way. */
interface SignInFlow {
  host: string;
  start: LinkDeviceStart;
  /** When the code runs out (ms). */
  expiresAt: number;
  abort: AbortController;
  done: Promise<LinkUser>;
  outcome: { user: LinkUser } | { error: OpenArtifactError } | null;
}

/** The sync state of one published artifact (in memory). */
interface SyncState {
  watcher: FSWatcher | null;
  debounce: ReturnType<typeof setTimeout> | undefined;
  rescan: ReturnType<typeof setInterval> | undefined;
  /** The catch-up syncs after the watch starts ({@link ARM_SYNC_MS}). */
  arming: ReturnType<typeof setTimeout>[];
  retry: ReturnType<typeof setTimeout> | undefined;
  running: Promise<void> | null;
  again: boolean;
  attempt: number;
  /** Paths of the working copy not on the host yet. */
  pending: string[];
  lastError: string | null;
  /** {@link lastError} as a stable code. */
  lastCode: RemoteErrorCode | null;
  lastSyncAt: string | null;
  /** Paths the agent wrote on the host (an event by the agent, or its own `link.call`), until they are pulled: path -> until when (ms). */
  agentPaths: Map<string, number>;
  /** Paths a person's `files` event named, until they are pulled. */
  personPaths: Set<string>;
  /** Until when (ms) pulled paths no person's event names are the agent's (after a forwarded write). */
  agentUntil: number;
  /** Etag cache of the working copy: path -> size, mtime and etag. */
  hashes: Map<string, { size: number; mtimeMs: number; etag: string }>;
}

/** The event stream of one remote. */
interface EventStream {
  abort: AbortController;
  connected: boolean;
  attempt: number;
  lastError: string | null;
  /** {@link lastError} as a stable code. */
  lastCode: RemoteErrorCode | null;
}

/** What a status or a tool result says while a host cannot be reached. */
export function queuedNote(host: string): string {
  return `${host} cannot be reached now. Edits made in the folder are kept and queued on this computer, and they sync when it is back (open-artifact remote status lists what is pending). Actions that run on the host (ArtifactData, ArtifactComments, a Docs or Sheets call) wait until then.`;
}

/** What `remote status` shows of one remote. */
export interface RemoteStatus {
  name: string;
  host: string;
  user: LinkUser | null;
  signedIn: boolean;
  connected: boolean;
  reachable: boolean;
  lastEventId: string | null;
  lastError: string | null;
  /** {@link lastError} as a stable code, `null` with it: what the Shell acts on (the text is for people). */
  code: RemoteErrorCode | null;
  /** While the host cannot be reached: says plainly that edits are queued on this computer ({@link queuedNote}). */
  note?: string;
  /** The remote used when none is named (`settings.cloud.default`, or the only one); absent when it is not. */
  default?: boolean;
  /** Added by an install-time preset (`OPEN_ARTIFACT_REMOTE`, `preset.json`). */
  preset?: boolean;
  /** Reached over plain http beyond this computer: not encrypted. */
  insecure?: boolean;
  /**
   * A preset remote that is not signed in: the approval the person opens to sign this computer in (no browser is
   * opened for them). Absent while none is under way.
   */
  approval?: RemoteApproval;
  artifacts: RemoteArtifactStatus[];
}

/** A device sign-in waiting for the person, as {@link RemoteStatus.approval}. */
export interface RemoteApproval {
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  /** When the code runs out (ISO). */
  expires_at: string;
}

/** Automatic publishing as a whole, beside the remotes in `GET remotes` and `remote status`. */
export interface CloudStatus {
  /** The default remote's name, or `null` when there is none to use. */
  default: string | null;
  publish: CloudPublishMode;
  /** Artifacts waiting to be published by themselves (being published, or retried after a failure). */
  pending: AutoPublishStatus[];
}

/** One artifact automatic publishing has not got onto its site yet. */
export interface AutoPublishStatus {
  id: string;
  url: string;
  title: string;
  /** The remote it goes to, `null` when there is none. */
  remote: string | null;
  attempts: number;
  lastError: string | null;
  code: RemoteErrorCode | null;
  /** When it is tried again (ISO), while a retry waits. */
  nextAt: string | null;
}

/** The state of one artifact automatic publishing works on (in memory). */
interface AutoState {
  timer: ReturnType<typeof setTimeout> | undefined;
  running: Promise<void> | null;
  attempts: number;
  lastError: string | null;
  lastCode: RemoteErrorCode | null;
  nextAt: number | null;
  /** The agent was told about a failure (once). */
  told: boolean;
}

/** One published artifact in {@link RemoteStatus}: where it is, when it last synced, what waits, and why it failed. */
export interface RemoteArtifactStatus {
  id: string;
  url: string;
  title: string;
  view_url: string;
  syncedAt: string | null;
  lastSyncAt: string | null;
  pending: string[];
  lastError: string | null;
  /** {@link lastError} as a stable code, `null` with it. */
  code: RemoteErrorCode | null;
}

/** Options of {@link LinkHub}. */
export interface LinkHubOptions {
  store: ArtifactStore;
  inbox: Inbox;
  settings: () => OpenArtifactSettings;
  /** Routes a comment thread or page request to the artifact's owner, as the Type API's wake does. */
  wake: (id: string, item: WakeItem) => Promise<WakeResult>;
  /** The artifact's folder as a zip, from its type server's archive. */
  archive: (record: ArtifactRecord) => Promise<Uint8Array>;
  /** Opens the sign-in page in this computer's browser; `null` never does. */
  browse: ((url: string) => boolean) | null;
  log: (line: string) => void;
  version: string;
  fetch?: typeof fetch;
  /** Saves a change to `settings.cloud` (the default remote) and makes it the settings in effect. */
  saveCloud?: (patch: { [K in keyof CloudSettings]?: CloudSettings[K] | null }) => void;
  /** Plain http is allowed for any host (`OPEN_ARTIFACT_REMOTE_INSECURE_HTTP=1`). */
  insecureHttp?: () => boolean;
  /** Live data of published dashboards (`data-refresh.ts`): told of publishes, unpublishes and refresh requests. */
  data?: LinkDataHooks;
  /**
   * Why an artifact cannot go to a site at all (its type has no site support yet: a `page`), or `null`. Such an
   * artifact is never published, by hand or by itself.
   */
  localOnly?: (record: ArtifactRecord) => string | null;
  /**
   * Whether the artifact is a page (the built-in `page` type): it goes only to a site whose `hello` says
   * `features.pages`, and its declared capabilities travel by `link.capabilities` and the `artifact` event.
   */
  needsPages?: (record: ArtifactRecord) => boolean;
  /**
   * The artifact's type when it is a custom type a site runs once it is published there (`isSiteKindType`), else
   * null: such an artifact goes only to a site whose catalog has its type (the same uid). Automatic publishing leaves
   * it alone: its type goes to a site by the person's hand.
   */
  siteType?: (record: ArtifactRecord) => TypeInfo | null;
  /** Packs a type folder for a site (`packTypeBytes`: the `--for-share` checks first). */
  packType?: (type: TypeInfo, workspace: string | null) => Promise<PackedType>;
}

/** Why a site takes no published types: older, or its app and pages share one domain. */
const TYPES_NO_SITE = 'This site keeps no published types (it is older than this Open Artifact, or it serves everything on one domain).';

/** {@link LinkHubOptions.data}. */
export interface LinkDataHooks {
  /** An artifact was published (by a person, an agent or by itself). */
  published(id: string): void;
  /** A page on the host asked for its live data to be refreshed (`queries`: dataset ids, else all). */
  requested(id: string, queries?: string[]): void;
  /** An artifact is no longer published (unpublished here, or removed on the host). */
  unpublished(record: ArtifactRecord): void;
}

/** A page record's declared capabilities, `{}` when it declares none. */
function capabilitiesOfRecord(record: ArtifactRecord): Record<string, unknown> {
  return record.capabilities && typeof record.capabilities === 'object' ? record.capabilities : {};
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Whether two JSON values are the same, keys in any order. */
function sameJson(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(norm) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm((v as Record<string, unknown>)[k])])) : v;
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

/** How long after a create the first automatic publish is tried, ms (the tool's answer goes out first). */
const AUTO_FIRST_MS = 200;

/** Links the daemon to its cloud remotes. */
export class LinkHub {
  readonly remotes = new RemotesFile();
  private readonly o: LinkHubOptions;
  private readonly clients = new Map<string, LinkClient>();
  private readonly streams = new Map<string, EventStream>();
  private readonly flows = new Map<string, SignInFlow>();
  private readonly syncs = new Map<string, SyncState>();
  private readonly handled = new Map<string, Set<string>>();
  private readonly autos = new Map<string, AutoState>();
  /** Preset remotes waiting for the person's approval, whose link the agent was told about (once per remote). */
  private readonly approvalsTold = new Set<string>();
  /** Preset remotes whose approval is being started (one device code at a time). */
  private readonly approvalsStarting = new Set<string>();
  /** Why the preset could not be applied, for `remote status` (no secret in it). */
  presetProblem: string | null = null;
  private presetRetry: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  constructor(options: LinkHubOptions) {
    this.o = options;
  }

  private get retryMs(): number {
    return envMs('OPEN_ARTIFACT_LINK_RETRY_MS', 1000);
  }

  private get rescanMs(): number {
    return envMs('OPEN_ARTIFACT_LINK_RESCAN_MS', 30_000);
  }

  /** Back-off after `attempt` failures, with jitter: 1, 2, 4 ... times the base, at most 60 times it. */
  private backoff(attempt: number): number {
    const base = this.retryMs;
    const wait = Math.min(base * 2 ** attempt, base * 60);
    return Math.round(wait * (0.7 + Math.random() * 0.6));
  }

  /**
   * Connects the remotes and starts syncing what is published (nothing happens without a remote), after applying the
   * install-time `preset` (a remote to add, a token to sign in with); artifacts waiting to be published by themselves
   * are tried again.
   */
  start(preset: CloudPreset = {}): void {
    for (const [name, remote] of Object.entries(this.remotes.list())) if (remote.refreshToken) this.connect(name);
    for (const record of this.o.store.list()) {
      if (record.remote) this.track(record.id);
      else if (record.autoPublish === 'pending') this.scheduleAuto(record.id, AUTO_FIRST_MS);
    }
    void this.applyPreset(preset, 0);
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.presetRetry);
    for (const flow of this.flows.values()) flow.abort.abort();
    for (const stream of this.streams.values()) stream.abort.abort();
    for (const id of [...this.syncs.keys()]) this.untrack(id);
    for (const state of this.autos.values()) clearTimeout(state.timer);
    this.autos.clear();
  }

  // ---- the default remote and presets --------------------------------------------------------------------------------

  /** The remote used when none is named: `settings.cloud.default` while it exists, else the only remote, else `null`. */
  defaultRemote(): string | null {
    const names = Object.keys(this.remotes.list());
    const chosen = this.o.settings().cloud?.default;
    if (chosen && names.includes(chosen)) return chosen;
    return names.length === 1 ? names[0]! : null;
  }

  /** Whether new artifacts are published by themselves (`settings.cloud.publish`). */
  autoMode(): boolean {
    return this.o.settings().cloud?.publish === 'auto';
  }

  /** Makes a remote the default the first time one is added (a person's later choice is never replaced). */
  private firstDefault(name: string): void {
    const chosen = this.o.settings().cloud?.default;
    if (chosen && this.remotes.get(chosen)) return;
    this.o.saveCloud?.({ default: name });
  }

  /**
   * Applies the install-time preset (`preset.ts`): adds the preset remote once (as the default when none is chosen),
   * signs in with the preset token when it is not signed in, else starts the approval the person opens (no browser).
   * A host that cannot be reached is asked again with back-off. The token is never logged.
   */
  async applyPreset(preset: CloudPreset, attempt: number): Promise<void> {
    if (attempt === 0 && preset.warning) this.o.log(`link: preset: warning: ${preset.warning}`);
    if (!preset.remote || this.closed) return;
    let host: string;
    try {
      host = checkHost(preset.remote, { insecureHttp: preset.insecureHttp === true || this.o.insecureHttp?.() === true });
    } catch (error) {
      this.presetProblem = `OPEN_ARTIFACT_REMOTE: ${message(error)}`;
      this.o.log(`link: preset: ${this.presetProblem}`);
      return;
    }
    let name = Object.entries(this.remotes.list()).find(([, remote]) => remote.host === host)?.[0];
    if (!name) {
      // Removed by the person after a preset added it: their change stands.
      if (this.remotes.presetAdded(host)) return;
      const taken = Object.keys(this.remotes.list());
      name = preset.name && REMOTE_NAME.test(preset.name) && !taken.includes(preset.name) ? preset.name : remoteNameFor(host, taken);
      this.remotes.addPreset(name, { host, user: null, accessToken: null, refreshToken: null, expiresAt: null, lastEventId: null, addedAt: new Date().toISOString(), preset: true });
      this.o.log(`link: added the preset remote ${name} (${host})${insecureOrigin(host) ? ` over plain http: ${insecureWarning(host)}` : ''}`);
      this.firstDefault(name);
    }
    const stored = this.remotes.get(name)!;
    if (stored.refreshToken) return;
    if (preset.token && stored.presetToken !== tokenHash(preset.token)) {
      let answer: Awaited<ReturnType<typeof linkToken>>;
      try {
        answer = await linkToken(host, { grant_type: 'refresh_token', refresh_token: preset.token }, this.o.fetch);
      } catch (error) {
        // Not reached (or it failed on its side): the token was not used up, so it is tried again later.
        this.presetProblem = `could not sign in to ${name} with the preset token: ${message(error)}`;
        this.o.log(`link: preset: ${this.presetProblem}`);
        if (!this.closed) {
          this.presetRetry = setTimeout(() => void this.applyPreset(preset, attempt + 1), this.backoff(attempt));
          this.presetRetry.unref?.();
        }
        return;
      }
      if (this.closed) return;
      this.remotes.patch(name, { presetToken: tokenHash(preset.token) });
      if ('token' in answer) {
        this.remotes.patch(name, tokenFields(answer.token));
        this.presetProblem = null;
        this.o.log(`link: signed in to ${name} (${host}) with the preset token as ${answer.token.user.name || answer.token.user.id}`);
        this.connect(name);
        this.signedIn(name);
        return;
      }
      this.presetProblem = `the preset token for ${name} was refused (${answer.refused.error}): approve this computer instead`;
      this.o.log(`link: preset: ${this.presetProblem}`);
    }
    await this.ensureApproval(name);
  }

  /**
   * For a preset remote that is not signed in: a device sign-in under way whose link the person opens (`remote status`,
   * the Share panel, the agent's next tool result). Nothing is opened in a browser. Started again once a code ran out.
   */
  async ensureApproval(name: string): Promise<void> {
    const stored = this.remotes.get(name);
    if (!stored?.preset || stored.refreshToken || this.closed) return;
    const flow = this.flows.get(name);
    if ((flow && !flow.outcome && flow.expiresAt > Date.now()) || this.approvalsStarting.has(name)) return;
    this.approvalsStarting.add(name);
    try {
      await this.signIn(name, stored.host, { browse: false, insecureHttp: true });
    } catch (error) {
      if (!this.closed) this.o.log(`link: ${name}: could not start the approval: ${message(error)}`);
    } finally {
      this.approvalsStarting.delete(name);
    }
  }

  /** A remote got signed in: what waits to be published by itself goes now. */
  private signedIn(name: string): void {
    for (const record of this.o.store.list()) if (record.autoPublish === 'pending' && !record.remote) this.scheduleAuto(record.id, 0, true);
    this.approvalsTold.delete(name);
  }

  /**
   * One-time notes for the agent's next tool result (any session): a preset site waiting for the person to approve
   * this computer, with the link to give them. Each is said once per daemon run.
   */
  notices(): string[] {
    const out: string[] = [];
    for (const [name, remote] of Object.entries(this.remotes.list())) {
      if (!remote.preset || remote.refreshToken || this.approvalsTold.has(name)) continue;
      const flow = this.flows.get(name);
      if (!flow || flow.outcome || flow.expiresAt <= Date.now()) {
        void this.ensureApproval(name);
        continue;
      }
      this.approvalsTold.add(name);
      out.push(
        `[Open Artifact] This computer is set up to publish artifacts to ${remote.host} (${name}), but it is not signed in there yet. ` +
          `Ask the person to open ${flow.start.verification_uri_complete} and approve the code ${flow.start.user_code}; until then artifacts stay on this computer.`,
      );
    }
    return out;
  }

  /** Changes the cloud settings a person chose (`remote default`, `remote auto`, the Share panel). */
  setCloud(patch: { default?: string | null; publish?: CloudPublishMode }): CloudStatus {
    if (patch.default !== undefined && patch.default !== null && !this.remotes.get(patch.default)) {
      throw new OpenArtifactError('not_found', `No remote ${patch.default}.`, { fix: 'open-artifact remote list shows the remotes.' });
    }
    if (patch.publish !== undefined && patch.publish !== 'auto' && patch.publish !== 'manual') throw new OpenArtifactError('invalid_argument', 'publish is "auto" or "manual".');
    // The only remote is the default whatever the setting says (`defaultRemote`): clearing could not hold, so it is
    // refused with what does what the person wants instead. With several, clearing holds: publish then asks which one,
    // and automatic publishing has nowhere to go until one is chosen (`remote status` says so).
    const names = Object.keys(this.remotes.list());
    if (patch.default === null && names.length === 1) {
      throw new OpenArtifactError('invalid_argument', `${names[0]} is the only remote, so it is always the default: publishing without --remote uses it.`, {
        fix: `To stop new artifacts going there by themselves: open-artifact remote auto off. To stop using the site: open-artifact remote remove ${names[0]}.`,
      });
    }
    const was = this.autoMode();
    this.o.saveCloud?.({ ...(patch.default !== undefined ? { default: patch.default } : {}), ...(patch.publish ? { publish: patch.publish } : {}) });
    if (patch.publish) this.o.log(`link: publishing new artifacts ${patch.publish === 'auto' ? 'automatically' : 'by hand only'}`);
    if (!was && this.autoMode()) for (const record of this.o.store.list()) if (record.autoPublish === 'pending' && !record.remote) this.scheduleAuto(record.id, 0, true);
    if (was && !this.autoMode()) {
      for (const state of this.autos.values()) clearTimeout(state.timer);
      this.autos.clear();
    }
    return this.cloudStatus();
  }

  /** {@link CloudStatus}. */
  cloudStatus(): CloudStatus {
    const name = this.defaultRemote();
    const pending = this.o.store
      .list()
      .filter((record) => record.autoPublish === 'pending' && !record.remote)
      .map((record) => {
        const state = this.autos.get(record.id);
        return {
          id: record.id,
          url: artifactUrl(record.id),
          title: record.title,
          remote: name,
          attempts: state?.attempts ?? 0,
          lastError: state?.lastError ?? null,
          code: state?.lastError ? (state.lastCode ?? 'error') : null,
          nextAt: state?.nextAt ? new Date(state.nextAt).toISOString() : null,
        };
      });
    return { default: name, publish: this.autoMode() ? 'auto' : 'manual', pending };
  }

  // ---- publishing by itself -------------------------------------------------------------------------------------------

  /**
   * A new artifact was made (an agent's create, the home page, adopt of a folder). With automatic publishing on, it is
   * marked to be published and the publish starts in the background; `true` then (the tool says so). Never throws.
   */
  created(record: ArtifactRecord): boolean {
    if (!this.autoMode() || record.remote || record.autoPublish || this.o.localOnly?.(record) || this.o.siteType?.(record)) return false;
    try {
      this.o.store.update(record.id, { autoPublish: 'pending', updatedAt: record.updatedAt });
    } catch {
      return false;
    }
    this.scheduleAuto(record.id, AUTO_FIRST_MS);
    return true;
  }

  /** Waits to be published by itself (the tool result's note). */
  autoPending(record: ArtifactRecord): boolean {
    return record.autoPublish === 'pending' && !record.remote && this.autoMode();
  }

  /** Where an artifact waiting to be published goes, for the tool's note: the default remote's host, or `null`. */
  autoTarget(): string | null {
    const name = this.defaultRemote();
    return name ? (this.remotes.get(name)?.host ?? null) : null;
  }

  private scheduleAuto(id: string, delay: number, reset = false): void {
    if (this.closed) return;
    let state = this.autos.get(id);
    if (!state) this.autos.set(id, (state = { timer: undefined, running: null, attempts: 0, lastError: null, lastCode: null, nextAt: null, told: false }));
    if (reset) state.attempts = 0;
    if (state.running) return;
    clearTimeout(state.timer);
    state.nextAt = Date.now() + delay;
    state.timer = setTimeout(() => void this.autoPublish(id), delay);
    state.timer.unref?.();
  }

  /** One automatic publish of an artifact; a failure is kept, told to the agent once, and tried again with back-off. */
  private async autoPublish(id: string): Promise<void> {
    const state = this.autos.get(id);
    if (!state || state.running || this.closed) return;
    const record = this.o.store.get(id);
    if (!record || record.remote || record.autoPublish !== 'pending' || !this.autoMode() || this.o.localOnly?.(record) || this.o.siteType?.(record)) {
      this.autos.delete(id);
      return;
    }
    state.nextAt = null;
    state.running = (async () => {
      const name = this.defaultRemote();
      try {
        if (!name) throw new OpenArtifactError('not_found', 'There is no site to publish to.', { fix: 'Add one: open-artifact remote add <name> <https://host>, or choose the default with open-artifact remote default <name>.' });
        await this.publish(record, name);
        this.o.store.update(id, { autoPublish: null, updatedAt: this.o.store.get(id)?.updatedAt ?? record.updatedAt });
        this.o.log(`link: published ${id} to ${name} by itself`);
        this.autos.delete(id);
      } catch (error) {
        state.attempts++;
        state.lastError = message(error);
        state.lastCode = remoteErrorCode(error);
        this.o.log(`link: publishing ${id} by itself failed (attempt ${state.attempts}): ${state.lastError}`);
        const fresh = this.o.store.get(id);
        if (fresh && !state.told) {
          state.told = true;
          const where = name ? (this.remotes.get(name)?.host ?? name) : 'the cloud';
          this.tell(
            fresh,
            `[Open Artifact] "${fresh.title}" (${artifactUrl(id)}) could not be published to ${where} yet: ${state.lastError} It stays on this computer (view_url is the local address) and is tried again by itself; open-artifact remote status shows how it stands. Nothing for you to do unless the person asks.`,
          );
        }
        // A site that does not run this artifact (a page on an older site) refuses it every time: no retry until the
        // daemon starts again (the site may be updated by then).
        if ((error as OpenArtifactError).code === 'unsupported') {
          if (this.autos.get(id) === state) this.autos.delete(id);
          return;
        }
        if (!this.closed && this.autos.get(id) === state) {
          const wait = this.backoff(state.attempts - 1);
          state.nextAt = Date.now() + wait;
          state.timer = setTimeout(() => void this.autoPublish(id), wait);
          state.timer.unref?.();
        }
      }
    })().finally(() => {
      state.running = null;
    });
    await state.running;
  }

  /** The client of a remote; throws `not_found` when there is no such remote. */
  client(name: string): LinkClient {
    if (!this.remotes.get(name)) throw new OpenArtifactError('not_found', `No remote ${name}.`, { fix: 'open-artifact remote list shows the remotes; open-artifact remote add <name> <https://host> adds one.' });
    let client = this.clients.get(name);
    if (!client) this.clients.set(name, (client = new LinkClient({ name, remotes: this.remotes, ...(this.o.fetch ? { fetch: this.o.fetch } : {}) })));
    return client;
  }

  /** Whether the remote answered its last call (true until a call fails to reach it). */
  reachable(name: string): boolean {
    return !this.clients.get(name)?.offline;
  }

  /** While the artifact's host cannot be reached: a note that edits are queued on this computer ({@link queuedNote}). */
  offlineNote(record: ArtifactRecord): string | null {
    return record.remote && !this.reachable(record.remote.name) ? queuedNote(record.remote.host) : null;
  }

  /** Whether something is still to be pushed (the daemon then stays up). */
  busy(): boolean {
    for (const state of this.syncs.values()) if (state.pending.length || state.running) return true;
    return false;
  }

  // ---- signing in ----------------------------------------------------------------------------------------------------

  /**
   * Starts a device sign-in for remote `name` at `host`; the daemon polls in the background. The approval page opens in
   * this computer's browser unless `browse` is false (the Shell shows the link itself).
   */
  async signIn(name: string, rawHost: unknown, options: { browse?: boolean; insecureHttp?: boolean } = {}): Promise<SignInStart> {
    if (!REMOTE_NAME.test(name)) throw new OpenArtifactError('invalid_argument', 'A remote name is letters, digits, - and _ (at most 32), like work.');
    const host = checkHost(rawHost, { insecureHttp: options.insecureHttp === true || this.o.insecureHttp?.() === true });
    const have = this.remotes.get(name);
    if (have && have.host !== host) throw new OpenArtifactError('conflict', `The remote ${name} is ${have.host}.`, { fix: `Remove it first (open-artifact remote remove ${name}), or choose another name.` });
    this.flows.get(name)?.abort.abort();
    const start = await linkDevice(host, { client: { name: 'Open Artifact daemon', harness: 'open-artifact', version: this.o.version } }, this.o.fetch);
    // Closed while the host answered: nothing polls after the daemon stops.
    if (this.closed) throw new OpenArtifactError('timeout', 'The daemon is stopping.');
    const abort = new AbortController();
    const flow: SignInFlow = { host, start, expiresAt: Date.now() + start.expires_in * 1000, abort, outcome: null, done: Promise.resolve({ id: '', name: '' }) };
    flow.done = pollDeviceToken(host, start, { signal: abort.signal, ...(this.o.fetch ? { fetch: this.o.fetch } : {}) }).then(
      (token) => {
        // Cancelled while the approving answer was on its way: nothing is kept.
        if (abort.signal.aborted) {
          flow.outcome = { error: new OpenArtifactError('timeout', 'The sign-in was given up.') };
          throw flow.outcome.error;
        }
        const existing = this.remotes.get(name);
        const remote: StoredRemote = {
          ...(existing?.host === host ? existing : {}),
          host,
          lastEventId: existing?.host === host ? existing.lastEventId : null,
          addedAt: existing?.addedAt ?? new Date().toISOString(),
          ...tokenFields(token),
        };
        this.remotes.set(name, remote);
        this.o.log(`link: signed in to ${name} (${host}) as ${token.user.name || token.user.id}`);
        const client = this.clients.get(name);
        if (client) {
          client.offline = false;
          client.lastError = null;
          client.lastCode = null;
        }
        this.connect(name);
        this.firstDefault(name);
        this.signedIn(name);
        flow.outcome = { user: token.user };
        return token.user;
      },
      (error: unknown) => {
        const failure = error instanceof OpenArtifactError ? error : new OpenArtifactError('error', message(error));
        flow.outcome = { error: failure };
        throw failure;
      },
    );
    flow.done.catch(() => undefined);
    this.flows.set(name, flow);
    const opened = options.browse !== false && this.o.browse ? this.o.browse(start.verification_uri_complete) : false;
    return {
      name,
      host,
      user_code: start.user_code,
      verification_uri: start.verification_uri,
      verification_uri_complete: start.verification_uri_complete,
      expires_in: start.expires_in,
      opened,
      ...(insecureOrigin(host) ? { warning: insecureWarning(host) } : {}),
    };
  }

  /** Waits up to `ms` for a sign-in: `done` with the user, or `pending`; a refusal or a code that ran out is thrown. */
  async signInResult(name: string, ms: number): Promise<{ status: 'done'; user: LinkUser } | { status: 'pending' }> {
    const flow = this.flows.get(name);
    if (!flow) throw new OpenArtifactError('not_found', `No sign-in to ${name} is under way.`, { fix: `open-artifact remote add ${name} <https://host>` });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([flow.done.catch(() => undefined), new Promise((done) => (timer = setTimeout(done, ms)))]);
    } finally {
      clearTimeout(timer);
    }
    if (!flow.outcome) return { status: 'pending' };
    if (this.flows.get(name) === flow) this.flows.delete(name);
    if ('error' in flow.outcome) throw flow.outcome.error;
    return { status: 'done', user: flow.outcome.user };
  }

  /**
   * Stops a sign-in under way (the person cancelled it): the daemon stops polling and keeps nothing. `cancelled` is
   * false when none was under way (it ended, or never started). A remote already signed in is left as it is.
   */
  cancelSignIn(name: string): { name: string; cancelled: boolean } {
    const flow = this.flows.get(name);
    if (!flow) return { name, cancelled: false };
    this.flows.delete(name);
    flow.abort.abort();
    return { name, cancelled: !flow.outcome };
  }

  /**
   * Forgets a remote. Artifacts published there are refused unless `force`, which leaves them local only. When automatic
   * publishing was on and no site is left to take it (the removed one was the default and no other is), it is turned
   * off, saved as the person's choice (so a preset's `auto` does not turn it back on), and `autoPublishOff` says so:
   * otherwise the next site connected would start receiving every new artifact without anyone deciding it.
   */
  removeRemote(name: string, force: boolean): { removed: string; unlinked: string[]; autoPublishOff?: true; default?: string | null } {
    if (!this.remotes.get(name)) throw new OpenArtifactError('not_found', `No remote ${name}.`);
    const published = this.o.store.list().filter((record) => record.remote?.name === name);
    if (published.length && !force) {
      throw new OpenArtifactError('conflict', `${published.length} artifact${published.length === 1 ? ' is' : 's are'} published to ${name}: ${published.map((r) => r.id).join(', ')}.`, {
        fix: `Unpublish ${published.length === 1 ? 'it' : 'them'} first (open-artifact unpublish <id>), or pass --force to keep ${published.length === 1 ? 'it' : 'them'} local only.`,
      });
    }
    for (const record of published) {
      this.untrack(record.id);
      this.o.store.update(record.id, { remote: null, updatedAt: record.updatedAt });
    }
    this.flows.get(name)?.abort.abort();
    this.flows.delete(name);
    this.streams.get(name)?.abort.abort();
    this.streams.delete(name);
    this.clients.delete(name);
    this.handled.delete(name);
    this.approvalsTold.delete(name);
    this.remotes.remove(name);
    if (this.o.settings().cloud?.default === name) this.o.saveCloud?.({ default: null });
    const left = this.defaultRemote();
    if (this.autoMode() && !left) {
      this.setCloud({ publish: 'manual' });
      return { removed: name, unlinked: published.map((r) => r.id), autoPublishOff: true, default: null };
    }
    return { removed: name, unlinked: published.map((r) => r.id), default: left };
  }

  /** The remotes, without their tokens, and what each syncs. */
  status(): RemoteStatus[] {
    const records = this.o.store.list();
    const chosen = this.defaultRemote();
    return Object.entries(this.remotes.list()).map(([name, remote]) => {
      const client = this.clients.get(name);
      const stream = this.streams.get(name);
      // The stream's failure first, then the last call's, then a remote with no tokens.
      const failure: [string, RemoteErrorCode] | null = stream?.lastError
        ? [stream.lastError, stream.lastCode ?? 'error']
        : client?.lastError
          ? [client.lastError, client.lastCode ?? 'error']
          : remote.refreshToken
            ? null
            : [`not signed in to ${name}`, 'signed_out'];
      return {
        name,
        host: remote.host,
        user: remote.user,
        signedIn: !!remote.refreshToken,
        connected: !!stream?.connected,
        reachable: !client?.offline,
        lastEventId: remote.lastEventId,
        lastError: failure?.[0] ?? null,
        code: failure?.[1] ?? null,
        ...(client?.offline ? { note: queuedNote(remote.host) } : {}),
        ...(name === chosen ? { default: true } : {}),
        ...(remote.preset ? { preset: true } : {}),
        ...(insecureOrigin(remote.host) ? { insecure: true } : {}),
        ...this.approvalOf(name, remote),
        artifacts: records
          .filter((record) => record.remote?.name === name)
          .map((record) => {
            const state = this.syncs.get(record.id);
            return {
              id: record.id,
              url: artifactUrl(record.id),
              title: record.title,
              view_url: record.remote!.url,
              syncedAt: record.remote!.syncedAt,
              lastSyncAt: state?.lastSyncAt ?? null,
              pending: state?.pending ?? [],
              lastError: state?.lastError ?? null,
              code: state?.lastError ? (state.lastCode ?? 'error') : null,
            };
          }),
      };
    });
  }

  /** A preset remote's approval under way, as {@link RemoteStatus.approval}; one is started when none is. */
  private approvalOf(name: string, remote: StoredRemote): { approval?: RemoteApproval } {
    if (!remote.preset || remote.refreshToken) return {};
    const flow = this.flows.get(name);
    if (!flow || flow.outcome || flow.expiresAt <= Date.now()) {
      void this.ensureApproval(name);
      return {};
    }
    return {
      approval: {
        user_code: flow.start.user_code,
        verification_uri: flow.start.verification_uri,
        verification_uri_complete: flow.start.verification_uri_complete,
        expires_at: new Date(flow.expiresAt).toISOString(),
      },
    };
  }

  // ---- publishing ----------------------------------------------------------------------------------------------------

  /** Whether the person lets the agent publish to `name` (`remotes.<name>.agentMayPublish` in settings). */
  agentMayPublish(name: string): boolean {
    return this.o.settings().remotes?.[name]?.agentMayPublish === true;
  }

  /**
   * Publishes an artifact to a remote: its zip goes to `link.import` under its own id, and the record remembers where
   * it went (`remote`), with `base` from what the host took. The working copy syncs from then on.
   */
  async publish(record: ArtifactRecord, name: string, o: { withType?: boolean } = {}): Promise<ArtifactRecord> {
    const localOnly = this.o.localOnly?.(record);
    if (localOnly) throw new OpenArtifactError('unsupported', localOnly, { fix: 'Keep it on this computer for now; open it here with Artifact {action: "open"}.' });
    if (record.remote) {
      if (record.remote.name === name) return record;
      throw new OpenArtifactError('conflict', `${artifactUrl(record.id)} is published to ${record.remote.name} already.`, { fix: 'Unpublish it first (open-artifact unpublish <id>).' });
    }
    const client = this.client(name);
    if (!client.signedIn()) throw new OpenArtifactError('unauthorized', `not signed in to ${name}`, { fix: `Sign in again: open-artifact remote add ${name} ${client.host}` });
    const page = this.o.needsPages?.(record) === true;
    // A site that does not run pages (older, or single-origin) would refuse the type: say why here instead.
    if (page && (await client.hello()).features?.pages !== 1) {
      throw new OpenArtifactError('unsupported', PAGE_NO_SITE, { fix: `Keep it on this computer for now; it can go to ${client.host} once that site is updated.` });
    }
    // A custom type: the site's catalog must have it (the same uid); `withType` publishes it there first.
    const custom = this.o.siteType?.(record) ?? null;
    let typeError: OpenArtifactError | null = null;
    if (custom) {
      if ((await client.hello()).features?.types !== 1) {
        throw new OpenArtifactError('unsupported', `${TYPES_NO_SITE} An artifact of the type ${custom.id} stays on this computer.`, { fix: `Keep it on this computer for now; it can go to ${client.host} once that site takes published types.` });
      }
      const uid = record.typeUid ?? custom.uid;
      if (custom.uid && record.typeUid && record.typeUid !== custom.uid) {
        throw new OpenArtifactError('type_mismatch', `${artifactUrl(record.id)} was made with another type ${custom.id} (uid ${record.typeUid}) than the one on this computer (uid ${custom.uid}).`);
      }
      if (o.withType) typeError = await this.withType(client, custom, uid, name, record.owner?.workspace ?? null);
    }
    const zip = await this.o.archive(record);
    let imported;
    try {
      imported = await client.import(zip, { id: record.id, type: record.type, title: record.title });
    } catch (error) {
      const code = (error as OpenArtifactError).code;
      if (custom && typeError && (code === 'type_missing' || code === 'not_granted' || code === 'type_mismatch')) throw typeError;
      if (custom && (code === 'type_missing' || (code === 'not_granted' && /unpublished/.test((error as Error).message)))) {
        throw new OpenArtifactError(code, `${(error as Error).message} The artifact was not published.`, {
          fix: `Publish the type first: open-artifact types publish ${custom.id} --remote ${name}; or publish both at once: open-artifact publish ${record.id} --remote ${name} --with-type.`,
        });
      }
      if (code === 'type_missing' || code === 'type_mismatch') throw error;
      if ((error as OpenArtifactError).code === 'conflict' || (error as OpenArtifactError).status === 409) {
        // An artifact this person unpublished there (in their trash) is replaced: what is left is one still published
        // (from another computer) or someone else's.
        throw new OpenArtifactError('conflict', `${client.host} already has an artifact with the id ${record.id} that is still published there or is not yours: it could not be published there.`, {
          fix: 'If it is this artifact published from another computer, unpublish it there first (one you unpublished is replaced when you publish it again); otherwise publish a copy (Duplicate) instead.',
        });
      }
      throw error;
    }
    const base = Object.fromEntries(Object.entries(imported.files ?? {}).map(([path, file]) => [path, file.etag]));
    const remote: ArtifactRemote = { name, host: client.host, url: imported.url || `${client.host}/a/${record.id}`, base, syncedAt: new Date().toISOString() };
    // A page's capabilities are in its `.artifact.json`, which the zip carries: the host took them as they are.
    if (page) remote.capabilities = capabilitiesOfRecord(record);
    // The host titles it from its content (a doc's name) when the content has a title: the record follows.
    const hostTitle = typeof imported.title === 'string' ? imported.title.trim().slice(0, 200) : '';
    const next = this.o.store.update(record.id, { remote, updatedAt: record.updatedAt, ...(hostTitle && hostTitle !== record.title ? { title: hostTitle } : {}) });
    this.o.log(`link: published ${record.id} to ${name} (${remote.url})`);
    this.track(record.id);
    if (!this.streams.has(name)) this.connect(name);
    this.o.data?.published(record.id);
    return next;
  }

  /**
   * `publish --with-type`: the type goes to the site first, unless the site has it already (the same uid, listed, and
   * the same version or someone else's). A new one is published with `link` visibility: it is not listed to the
   * site's members, and the artifact runs it. Answers the refusal of the type's publish when there was one (the
   * artifact's import is still tried: a site may have the type where this person cannot list it), else null.
   */
  private async withType(client: LinkClient, type: TypeInfo, uid: string | null, name: string, workspace: string | null): Promise<OpenArtifactError | null> {
    const listed = (await client.typesList()).types.find((t) => t.id === type.id);
    if (listed && listed.uid === uid && !listed.unpublished && (listed.version === type.version || !listed.mine)) return null;
    try {
      await this.publishType(type, name, listed ? undefined : 'link', workspace);
      return null;
    } catch (error) {
      if (error instanceof OpenArtifactError && (error.code === 'not_granted' || error.code === 'conflict')) return error;
      throw error;
    }
  }

  /**
   * `open-artifact types publish`: a type of this computer packed (the `--for-share` checks) and sent to a site's
   * catalog (`link.types.import`). `visibility` is for a new type (default `private`) or to change it.
   */
  async publishType(type: TypeInfo, name: string, visibility?: SiteTypeVisibility, workspace: string | null = null): Promise<TypesPublishResponse> {
    const refusal = typePublishRefusal(type);
    if (refusal) throw new OpenArtifactError('invalid_argument', refusal);
    if (!this.o.packType) throw new OpenArtifactError('unsupported', 'This daemon cannot pack types.');
    const client = this.client(name);
    if (!client.signedIn()) throw new OpenArtifactError('unauthorized', `not signed in to ${name}`, { fix: `Sign in again: open-artifact remote add ${name} ${client.host}` });
    if ((await client.hello()).features?.types !== 1) throw new OpenArtifactError('unsupported', TYPES_NO_SITE, { fix: `Keep the type on this computer; ${client.host} takes it once that site is updated.` });
    const packed = await this.o.packType(type, workspace);
    const result = await client.typesImport(packed.bytes, visibility);
    this.o.log(`link: published the type ${type.id} ${result.type.version} to ${name} (${result.change}, visibility ${result.type.visibility}, sha256 ${result.type.sha256})`);
    return { ...result, remote: name, host: client.host };
  }

  /** `open-artifact types unpublish`: delisted on the site while artifacts use it, else removed. */
  async unpublishType(id: string, name: string): Promise<TypesUnpublishResponse> {
    const client = this.client(name);
    if (!client.signedIn()) throw new OpenArtifactError('unauthorized', `not signed in to ${name}`, { fix: `Sign in again: open-artifact remote add ${name} ${client.host}` });
    if ((await client.hello()).features?.types !== 1) throw new OpenArtifactError('unsupported', TYPES_NO_SITE);
    const result = await client.typesUnpublish(id);
    this.o.log(`link: unpublished the type ${id} from ${name} (${result.removed ? 'removed' : `delisted: ${result.artifacts} artifact(s) use it`})`);
    return { ...result, remote: name, host: client.host };
  }

  /** Takes an artifact off its host: a last sync brings the host's version home, then the record is local only. */
  async unpublish(record: ArtifactRecord): Promise<ArtifactRecord> {
    if (!record.remote) throw new OpenArtifactError('invalid_argument', `${artifactUrl(record.id)} is not published.`);
    const client = this.client(record.remote.name);
    await this.syncNow(record.id);
    const state = this.syncs.get(record.id);
    if (state?.lastError) throw new OpenArtifactError('connect_failed', `Could not bring the host's version home first: ${state.lastError}`, { fix: 'Try again once the host is reachable.' });
    await client.unpublish(record.id);
    this.untrack(record.id);
    this.o.log(`link: unpublished ${record.id} from ${record.remote.name}`);
    // The person took it off: automatic publishing never puts it back.
    const next = this.o.store.update(record.id, { remote: null, autoPublish: 'off', updatedAt: record.updatedAt });
    this.o.data?.unpublished(next);
    return next;
  }

  // ---- forwarding ----------------------------------------------------------------------------------------------------

  /** Whether an action on this artifact runs on the host instead of the local type server. */
  forwards(record: ArtifactRecord, type: TypeInfo | null, action: string): boolean {
    if (!record.remote || LOCAL_ACTIONS.has(action) || this.renders(record, type, action)) return false;
    if (action.startsWith('open-artifact.comments.') || action.startsWith('open-artifact.db.')) return true;
    if (FORWARDED_ACTIONS.has(action)) return true;
    return !!type?.store && SERVER_STORES.has(type.store);
  }

  /** Whether an action on a published artifact renders its working copy here (`snapshot`, Docs `export`). */
  renders(record: ArtifactRecord, type: TypeInfo | null, action: string): boolean {
    return !!record.remote && (action === 'snapshot' || (!!type && LOCAL_RENDERS[type.id]?.has(action) === true));
  }

  /**
   * Brings a published artifact's working copy up to date before it is rendered here: a sync now (or the one under
   * way). `note` is null when it is current; else it says what is drawn is the working copy as it is, which may miss
   * the latest changes made on the host (unreachable, signed out, a failed sync). `reload`: the type's store is its
   * server's (Docs, Sheets), which the local type server keeps in memory: it must be reopened to read the pull.
   */
  async freshen(record: ArtifactRecord, type: TypeInfo | null): Promise<{ note: string | null; reload: boolean }> {
    const remote = record.remote;
    if (!remote) return { note: null, reload: false };
    if (!this.syncs.has(record.id)) this.track(record.id);
    await this.syncNow(record.id);
    // A server store (doc/, sheet/) is read once by the local type server: it reads the pulled files anew.
    const reload = !!type?.store && SERVER_STORES.has(type.store);
    const failed = this.syncs.get(record.id)?.lastError ?? (this.reachable(remote.name) ? null : `${remote.host} is not reachable`);
    if (!failed) return { note: null, reload };
    const note = `Rendered the working copy on this computer as it is: it could not be brought up to date with ${remote.host} (${failed}), so changes made there since the last sync may be missing.`;
    return { note, reload };
  }

  /**
   * Runs an action on the host (`link.call`). A db write first pushes what waits, so it sees the agent's files. A write
   * comes home at once (the host does not echo the Link's own changes as events): the paths it names, and what else the
   * sync right after it pulls without a person's event, are the agent's own, not people's edits.
   */
  async call(record: ArtifactRecord, action: string, args: Record<string, unknown>, effect: 'read' | 'write' = 'write'): Promise<unknown> {
    const remote = record.remote;
    if (!remote) throw new OpenArtifactError('invalid_argument', `${artifactUrl(record.id)} is not published.`);
    if (action.startsWith('open-artifact.db.')) await this.syncNow(record.id).catch(() => undefined);
    let out: unknown;
    try {
      out = await this.client(remote.name).call(record.id, action, this.inlineFiles(action, args));
    } catch (error) {
      if ((error as OpenArtifactError).code !== 'connect_failed') throw error;
      throw new OpenArtifactError('connect_failed', `${(error as Error).message}. ${queuedNote(remote.host)}`, { fix: 'Try the action again later; meanwhile edit the files in the folder, which sync when the host is back.' });
    }
    const state = this.syncs.get(record.id);
    if (effect === 'write' && state) {
      const until = Date.now() + AGENT_PATH_MS;
      const written = action === 'open-artifact.db.write' ? (out as { writes?: Array<{ path?: unknown }> } | null)?.writes : undefined;
      for (const write of Array.isArray(written) ? written : []) if (typeof write?.path === 'string' && write.path) state.agentPaths.set(`db/${write.path}.json`, until);
      state.agentUntil = Date.now() + AGENT_CALL_MS;
      await this.syncNow(record.id).catch(() => undefined);
    }
    return out;
  }

  /** A db write's `file_path` (a file on this computer) becomes its `data`: the host cannot read this computer's files. */
  private inlineFiles(action: string, args: Record<string, unknown>): Record<string, unknown> {
    if (action !== 'open-artifact.db.write' || !Array.isArray(args.writes)) return args;
    const writes = (args.writes as Array<Record<string, unknown>>).map((write) => {
      if (typeof write?.file_path !== 'string' || !write.file_path) return write;
      let data: unknown;
      try {
        data = JSON.parse(readFileSync(write.file_path, 'utf8'));
      } catch (error) {
        throw new OpenArtifactError('invalid_argument', `file_path ${write.file_path}: ${message(error)}`);
      }
      const { file_path: _file, ...rest } = write;
      return { ...rest, data };
    });
    return { ...args, writes };
  }

  // ---- the working copy ----------------------------------------------------------------------------------------------

  /** A tool wrote into the artifact's folder: sync soon. */
  wrote(record: ArtifactRecord): void {
    if (record.remote && this.syncs.has(record.id)) this.schedule(record.id, 50);
    else if (!record.remote && record.autoPublish === 'pending' && this.autoMode()) {
      // Written before its automatic publish went through: try now, unless a retry after a failure already waits.
      const state = this.autos.get(record.id);
      if (!state || (!state.running && !state.lastError)) this.scheduleAuto(record.id, 0);
    }
  }

  /** Starts watching and syncing a published artifact. */
  track(id: string): void {
    if (this.closed || this.syncs.has(id)) {
      this.schedule(id, 0);
      return;
    }
    const record = this.o.store.get(id);
    if (!record?.remote) return;
    const state: SyncState = {
      watcher: null,
      debounce: undefined,
      rescan: undefined,
      arming: [],
      retry: undefined,
      running: null,
      again: false,
      attempt: 0,
      pending: [],
      lastError: null,
      lastCode: null,
      lastSyncAt: null,
      agentPaths: new Map(),
      personPaths: new Set(),
      agentUntil: 0,
      hashes: new Map(),
    };
    this.syncs.set(id, state);
    try {
      state.watcher = watch(record.root, { recursive: true, persistent: false }, (_event, name) => {
        const rel = String(name ?? '').split(sep).join('/');
        // `.artifact.json` never travels as a file, but a page's capabilities in it do (`link.capabilities`).
        if (rel && !linkSynced(rel) && rel !== '.artifact.json') return;
        this.schedule(id, 200);
      });
      state.watcher.on('error', () => {
        state.watcher?.close();
        state.watcher = null;
      });
      state.arming = ARM_SYNC_MS.map((ms) => {
        const timer = setTimeout(() => this.syncs.get(id) === state && this.schedule(id, 0), ms);
        timer.unref?.();
        return timer;
      });
    } catch (error) {
      this.o.log(`link: cannot watch ${record.root}: ${message(error)} (the rescan timer still syncs it)`);
    }
    if (this.rescanMs > 0) {
      state.rescan = setInterval(() => this.schedule(id, 0), this.rescanMs);
      state.rescan.unref?.();
    }
    this.schedule(id, 0);
  }

  private untrack(id: string): void {
    const state = this.syncs.get(id);
    if (!state) return;
    this.syncs.delete(id);
    state.watcher?.close();
    clearTimeout(state.debounce);
    clearTimeout(state.retry);
    clearInterval(state.rescan);
    for (const timer of state.arming) clearTimeout(timer);
  }

  private schedule(id: string, delay: number): void {
    const state = this.syncs.get(id);
    if (!state || this.closed) return;
    clearTimeout(state.debounce);
    state.debounce = setTimeout(() => void this.syncNow(id).catch(() => undefined), delay);
    state.debounce.unref?.();
  }

  /** Syncs the artifact now (joining a sync under way, which then runs once more). Failures are kept, not thrown. */
  syncNow(id: string): Promise<void> {
    const state = this.syncs.get(id);
    if (!state) return Promise.resolve();
    if (state.running) {
      state.again = true;
      return state.running;
    }
    clearTimeout(state.retry);
    state.retry = undefined;
    state.running = (async () => {
      do {
        state.again = false;
        try {
          await this.reconcile(id, state);
          state.lastError = null;
          state.lastCode = null;
          state.attempt = 0;
          state.lastSyncAt = new Date().toISOString();
        } catch (error) {
          state.lastError = message(error);
          state.lastCode = remoteErrorCode(error);
          this.o.log(`link: sync of ${id} failed: ${state.lastError}`);
          if ((error as OpenArtifactError).code !== 'unauthorized' && this.syncs.get(id) === state && !this.closed) {
            const wait = this.backoff(state.attempt++);
            state.retry = setTimeout(() => void this.syncNow(id), wait);
            state.retry.unref?.();
          }
        }
      } while (state.again && this.syncs.get(id) === state);
    })().finally(() => {
      state.running = null;
    });
    return state.running;
  }

  /** The working copy's paths that travel, with their etags (re-hashed only when size or time changed). */
  private scan(root: string, state: SyncState): Map<string, string> {
    const out = new Map<string, string>();
    const walk = (dir: string, rel: string): void => {
      let entries: Dirent[];
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const path = rel ? `${rel}/${entry.name}` : entry.name;
        if (!linkSynced(path)) continue;
        const file = join(dir, entry.name);
        if (entry.isDirectory()) walk(file, path);
        else if (entry.isFile()) {
          try {
            const stat = statSync(file);
            const known = state.hashes.get(path);
            if (known && known.size === stat.size && known.mtimeMs === stat.mtimeMs) out.set(path, known.etag);
            else {
              const etag = sha256(readFileSync(file));
              state.hashes.set(path, { size: stat.size, mtimeMs: stat.mtimeMs, etag });
              out.set(path, etag);
            }
          } catch {
            /* gone meanwhile */
          }
        }
      }
    };
    walk(root, '');
    for (const path of state.hashes.keys()) if (!out.has(path)) state.hashes.delete(path);
    return out;
  }

  /** The working copy's etag of one path now, `null` when it is not there. */
  private hashNow(root: string, path: string): string | null {
    try {
      return sha256(readFileSync(inside(root, path)));
    } catch {
      return null;
    }
  }

  /** One sync pass: the three-way comparison described at the top of this file. */
  private async reconcile(id: string, state: SyncState): Promise<void> {
    const record = this.o.store.get(id);
    if (!record?.remote) return;
    const remote = record.remote;
    const root = record.root;
    const client = this.client(remote.name);
    const base: Record<string, string> = { ...remote.base };
    const local = this.scan(root, state);
    const pushable = (path: string): boolean => !serverWrittenPath(path);
    state.pending = [...new Set([...local.keys(), ...Object.keys(base)])].filter((p) => pushable(p) && (local.get(p) ?? null) !== (base[p] ?? null)).sort();

    await this.pushCapabilities(record, client);
    const manifest = await client.manifest(id);
    const host = new Map<string, string>();
    for (const [path, file] of Object.entries(manifest.files ?? {})) {
      if (linkSynced(path) && file && typeof file.etag === 'string') host.set(path, file.etag);
    }

    const pushes: LinkWrite[] = [];
    const pulls: string[] = [];
    const conflicts: string[] = [];
    let baseChanged = false;
    const setBase = (path: string, etag: string | null): void => {
      if ((base[path] ?? null) === etag) return;
      if (etag === null) delete base[path];
      else base[path] = etag;
      baseChanged = true;
    };
    for (const path of [...new Set([...local.keys(), ...host.keys(), ...Object.keys(base)])].sort()) {
      const l = local.get(path) ?? null;
      const h = host.get(path) ?? null;
      const b = base[path] ?? null;
      if (l === h) {
        setBase(path, h);
        continue;
      }
      if (!pushable(path)) {
        // The host's server writes these: the working copy mirrors it.
        if (h !== b || l !== b) pulls.push(path);
        continue;
      }
      const localChanged = l !== b;
      const hostChanged = h !== b;
      if (localChanged && !hostChanged) pushes.push({ path, content: null, if_match: b });
      else if (!localChanged && hostChanged) pulls.push(path);
      else conflicts.push(path);
    }

    // Pushes, read now (what is sent is what base records), in batches.
    let batch: LinkWrite[] = [];
    let batchBytes = 0;
    /** The title the host answered a push with (the push renamed the artifact); newer than the manifest's. */
    let pushedTitle: string | undefined;
    const flush = async (): Promise<void> => {
      if (!batch.length) return;
      const sent = batch;
      batch = [];
      batchBytes = 0;
      const answer = await client.writeFiles(id, sent);
      if (typeof answer.title === 'string' && answer.title) pushedTitle = answer.title;
      for (const result of answer.results ?? []) {
        if ('conflict' in result && result.conflict) conflicts.push(result.path);
        else setBase(result.path, result.etag);
      }
    };
    for (const write of pushes) {
      let content: string | null = null;
      try {
        const bytes = readFileSync(inside(root, write.path));
        content = bytes.toString('base64');
        batchBytes += bytes.length;
      } catch {
        content = null;
      }
      batch.push({ path: write.path, content, if_match: write.if_match ?? null });
      if (batchBytes >= PUSH_BATCH_BYTES) await flush();
    }
    await flush();

    const edited: string[] = [];
    const kept: string[] = [];
    /** Puts the host's version of `path` in the working copy (or removes it); true when something changed. */
    const pull = async (path: string): Promise<void> => {
      const file = inside(root, path);
      const got = host.has(path) || conflicts.includes(path) ? await client.readFile(id, path) : null;
      if (got) {
        mkdirSync(dirname(file), { recursive: true });
        writeFileAtomic(file, got.bytes);
        setBase(path, sha256(got.bytes));
      } else {
        rmSync(file, { force: true });
        setBase(path, null);
      }
      state.hashes.delete(path);
      edited.push(path);
    };
    /** Keeps the working copy's version under `_agent/conflicts/`, when it has one. */
    const keep = (path: string): void => {
      const file = inside(root, path);
      if (!existsSync(file)) return;
      const copy = conflictFile(root, path);
      mkdirSync(dirname(copy), { recursive: true });
      writeFileAtomic(copy, readFileSync(file));
      kept.push(path);
    };
    for (const path of pulls) {
      // Written since the scan: that is a conflict now, not a pull.
      if (pushable(path) && this.hashNow(root, path) !== (local.get(path) ?? null)) {
        conflicts.push(path);
        continue;
      }
      await pull(path);
    }
    for (const path of [...new Set(conflicts)]) {
      keep(path);
      await pull(path);
    }

    state.pending = state.pending.filter((p) => (base[p] ?? null) !== (local.get(p) ?? null) && !conflicts.includes(p));
    const fresh = this.o.store.get(id);
    if (!fresh?.remote || fresh.remote.name !== remote.name) return; // unpublished meanwhile
    const patch: Partial<ArtifactRecord> = { updatedAt: fresh.updatedAt };
    if (baseChanged || !fresh.remote.syncedAt) patch.remote = { ...fresh.remote, base, syncedAt: new Date().toISOString() };
    const hostTitle = pushedTitle ?? manifest.title;
    if (hostTitle && hostTitle !== fresh.title) patch.title = hostTitle.slice(0, 200);
    const now = Date.now();
    const agentCall = now < state.agentUntil;
    const people = edited.filter((path) => !NOT_AN_EDIT.has(path) && (state.personPaths.has(path) || (!state.agentPaths.has(path) && !agentCall)));
    for (const path of edited) {
      state.agentPaths.delete(path);
      state.personPaths.delete(path);
    }
    for (const [path, until] of state.agentPaths) if (until < now) state.agentPaths.delete(path);
    if (people.length) {
      const at = new Date().toISOString();
      patch.lastUserEditAt = at;
      patch.userEdits = userEditsAfter(fresh, people, at);
    }
    if (Object.keys(patch).length > 1) this.o.store.update(id, patch);
    if (edited.length) this.o.log(`link: ${id}: pulled ${edited.length} file(s) from ${remote.name}`);
    if (kept.length || conflicts.length) {
      const paths = [...new Set(conflicts)];
      this.tell(
        fresh,
        `[Open Artifact] People changed ${paths.length === 1 ? 'a file' : `${paths.length} files`} of "${fresh.title}" (${artifactUrl(id)}) on ${remote.host} that you changed too: ${paths.join(', ')}. ` +
          `Their version is now in the folder${kept.length ? `; yours is kept under ${root}/_agent/conflicts/` : ''}. Read ${paths.length === 1 ? 'it' : 'them'} again (Artifact {action: "read", url, paths}) and re-apply your change.`,
      );
    }
  }

  /**
   * Sends a page's declared capabilities to its host when they differ from the last agreed ones
   * (`ArtifactRemote.capabilities`): an agent changed them here. The host does not echo a Link write back.
   */
  private async pushCapabilities(record: ArtifactRecord, client: LinkClient): Promise<void> {
    if (!record.remote || this.o.needsPages?.(record) !== true) return;
    const mine = capabilitiesOfRecord(record);
    if (record.remote.capabilities && sameJson(mine, record.remote.capabilities)) return;
    await client.setCapabilities(record.id, mine);
    const fresh = this.o.store.get(record.id);
    if (fresh?.remote && fresh.remote.name === record.remote.name) {
      this.o.store.update(record.id, { remote: { ...fresh.remote, capabilities: mine }, updatedAt: fresh.updatedAt });
    }
  }

  /** A message for the artifact's owning session, given with its next tool result. */
  private tell(record: ArtifactRecord, text: string): void {
    const key = (record.owner && sessionKeyOf(record.owner)) || UNOWNED_KEY;
    this.o.inbox.append(key, { kind: 'link', artifact: artifactUrl(record.id), artifactId: record.id, text });
  }

  // ---- events --------------------------------------------------------------------------------------------------------

  /** Opens (or keeps) the remote's event stream. */
  connect(name: string): void {
    if (this.closed) return;
    const have = this.streams.get(name);
    if (have && !have.abort.signal.aborted) return;
    const stream: EventStream = { abort: new AbortController(), connected: false, attempt: 0, lastError: null, lastCode: null };
    this.streams.set(name, stream);
    void this.runStream(name, stream);
  }

  private async runStream(name: string, stream: EventStream): Promise<void> {
    const signal = stream.abort.signal;
    while (!signal.aborted && !this.closed) {
      try {
        const client = this.client(name);
        if (!client.signedIn()) {
          stream.lastError = `not signed in to ${name}`;
          stream.lastCode = 'signed_out';
          break;
        }
        const response = await client.events(this.remotes.get(name)?.lastEventId ?? null, signal);
        stream.connected = true;
        stream.attempt = 0;
        stream.lastError = null;
        stream.lastCode = null;
        // Syncs that waited for the host try again now that it answers.
        for (const [id, state] of this.syncs) if (state.lastError && this.o.store.get(id)?.remote?.name === name) this.schedule(id, 0);
        for await (const sse of readSse(response.body!)) {
          const event = parseLinkEvent(sse);
          if (event) await this.handleEvent(name, event);
          else this.o.log(`link: ${name}: an event that is not a Link event: ${sse.data.slice(0, 200)}`);
        }
        stream.lastError = 'the host closed the event stream';
        stream.lastCode = 'unreachable';
      } catch (error) {
        if (signal.aborted) break;
        stream.lastError = message(error);
        stream.lastCode = remoteErrorCode(error);
        this.o.log(`link: ${name}: events: ${stream.lastError}`);
        if ((error as OpenArtifactError).code === 'unauthorized' || (error as OpenArtifactError).code === 'not_found') break;
      }
      stream.connected = false;
      if (signal.aborted || this.closed) break;
      const wait = this.backoff(stream.attempt++);
      await new Promise<void>((done) => {
        const timer = setTimeout(done, wait);
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            done();
          },
          { once: true },
        );
      });
    }
    stream.connected = false;
    if (this.streams.get(name) === stream && (signal.aborted || this.closed)) this.streams.delete(name);
  }

  /** Handles an event once (a redelivered one is only acknowledged), then acknowledges it. */
  async handleEvent(name: string, event: LinkEvent): Promise<void> {
    let seen = this.handled.get(name);
    if (!seen) this.handled.set(name, (seen = new Set()));
    if (!seen.has(event.id)) {
      seen.add(event.id);
      if (seen.size > HANDLED_KEEP) seen.delete(seen.values().next().value!);
      try {
        await this.apply(name, event);
      } catch (error) {
        this.o.log(`link: ${name}: event ${event.id} (${event.type}): ${message(error)}`);
      }
    }
    try {
      await this.client(name).ack([event.id]);
      this.remotes.patch(name, { lastEventId: event.id });
    } catch (error) {
      this.o.log(`link: ${name}: ack of ${event.id} failed: ${message(error)}`);
    }
  }

  private async apply(name: string, event: LinkEvent): Promise<void> {
    const record = this.o.store.get(event.artifact);
    if (!record || record.remote?.name !== name) {
      this.o.log(`link: ${name}: event ${event.id} (${event.type}) for ${event.artifact}, which is not published from here: acknowledged`);
      return;
    }
    switch (event.type) {
      case 'wake': {
        const threads = Array.isArray(event.threads) ? event.threads.filter((t): t is WakeThread => !!t && typeof t === 'object' && !!t.id) : [];
        const requests = Array.isArray(event.requests) ? event.requests.filter((r) => !!r && typeof r === 'object' && typeof r.text === 'string') : [];
        // Who sent it, when not the owner (an editor the owner lets ask): named in the agent's message. Only the
        // event's own `from`, checked, is taken; one on an item is dropped.
        const from = wakeSenderOf(event.from);
        const by = <T extends { from?: unknown }>(item: T): Omit<T, 'from'> & { from?: WakeSender } => {
          const { from: _ignored, ...rest } = item;
          return from ? { ...rest, from } : rest;
        };
        const waits = [
          ...threads.map((thread) => this.o.wake(record.id, { thread: by(thread) })),
          ...requests.map((r) => this.o.wake(record.id, { request: by({ ...r, id: r.id ?? `req_${Date.now().toString(36)}${randomBytes(3).toString('hex')}` }) as WakeRequestItem })),
        ];
        await Promise.all(waits);
        return;
      }
      case 'files': {
        const state = this.syncs.get(record.id);
        const byAgent = /^agent\b/.test(String(event.author ?? ''));
        if (state) for (const path of event.paths ?? []) byAgent ? state.agentPaths.set(path, Date.now() + AGENT_PATH_MS) : state.personPaths.add(path);
        if (event.title && event.title !== record.title) this.o.store.update(record.id, { title: event.title.slice(0, 200), updatedAt: record.updatedAt });
        if (!state) this.track(record.id);
        await this.syncNow(record.id);
        return;
      }
      case 'artifact': {
        if (event.removed) {
          this.untrack(record.id);
          const local = this.o.store.update(record.id, { remote: null, autoPublish: 'off', updatedAt: record.updatedAt });
          this.o.data?.unpublished(local);
          this.o.log(`link: ${record.id} was removed from ${name}: local only now`);
          this.tell(
            record,
            `[Open Artifact] "${record.title}" (${artifactUrl(record.id)}) was removed from ${record.remote.host}: it is a local artifact again, its folder ${record.root} as it was at the last sync. Its view_url is local again.`,
          );
          return;
        }
        if (event.title && event.title !== record.title) this.o.store.update(record.id, { title: event.title.slice(0, 200), updatedAt: record.updatedAt });
        // The owner changed a page's capabilities on the host (its MCP): they come home, and are the agreed ones.
        if (isRecordValue(event.capabilities) && this.o.needsPages?.(record) === true) {
          const caps = event.capabilities;
          const fresh = this.o.store.setCapabilities(record.id, Object.keys(caps).length ? caps : null);
          if (fresh.remote) this.o.store.update(record.id, { remote: { ...fresh.remote, capabilities: caps }, updatedAt: fresh.updatedAt });
          this.o.log(`link: ${record.id}: capabilities set on ${name}`);
        }
        return;
      }
      case 'data-refresh': {
        // Not awaited: the queries may take a while, and the stream's other events should not wait for them.
        const queries = Array.isArray(event.queries) ? event.queries.filter((q): q is string => typeof q === 'string' && q.length > 0).slice(0, 200) : [];
        this.o.data?.requested(record.id, queries.length ? queries : undefined);
        return;
      }
    }
  }

  /** The name of the account an artifact is published under (the remote's signed-in person), or `''`. */
  ownerName(record: ArtifactRecord): string {
    return (record.remote && this.remotes.get(record.remote.name)?.user?.name) || '';
  }
}
