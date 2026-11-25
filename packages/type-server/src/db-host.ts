/**
 * The document store and comment threads of a db-backed type (the
 * Whiteboard): the page routes (`_api/db/*`, `_api/comments*`), the reserved
 * agent actions (`open-artifact.db.*`, `open-artifact.comments.*`) and the watcher that turns edits
 * made on disk into page events.
 *
 * Storage is server-sdk's: documents are JSON files at
 * `<root>/db/<collection>/<doc>.json` ({@link DbStore}) and threads live in
 * `<root>/comments.json` ({@link CommentStore}). An agent may change either
 * with its own file tools, through `ArtifactData` / `ArtifactComments` (the
 * reserved actions) or with the CLI; every way ends in a `db` or `comments`
 * event for the open pages.
 *
 * Echoes: a page's write updates {@link DbHost}'s picture of the disk before
 * the watcher fires, so the watcher never reports it again, and the event for
 * it skips the writing client.
 *
 * Order: every `db` event carries the host's {@link DbOrder} (one `seq` per
 * event, a new `epoch` per host). A listing says the `seq` it was read at, and
 * a page's write is answered with the `seq` after it and the documents as
 * stored ({@link DbReceipt}), so a page keeps, per document, whichever of
 * them is newest, however their answers and the events interleave.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, watch, type FSWatcher } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import {
  DB_LIMITS,
  type CommentAuthor,
  type CommentReaction,
  type CommentThread,
  type DbChangeEvent,
  type DbDocument,
  type DbOrder,
  type DbReceipt,
  type DbWrite,
  type JsonRecord,
  type Role,
} from '@open-artifact/runtime/capabilities';
import {
  API,
  type CommentCreateRequest,
  type CommentMoveRequest,
  type CommentRemoveRequest,
  type CommentReplyRequest,
  type CommentResolveRequest,
  type CommentSendRequest,
  type CommentEditRequest,
  type CommentReactRequest,
  type CommentsResponse,
  type CommentThreadResponse,
  type DbGetResponse,
  type DbListResponse,
  type DbWriteRequest,
  type DbWriteResponse,
  type ServerEvents,
} from '@open-artifact/runtime/http-api';
import { AGENT_AUTHOR, COMMENTS_FILE, CommentStore, agentView, type Author, type CommentLock, type MessageReaction, type Thread } from '@open-artifact/server-sdk/comments';
import type { WakeSender } from '@open-artifact/protocol';
import { DB_DIR, DbStore, docPathsOf, docSha256, splitPath } from '@open-artifact/server-sdk/db';
import { clearAsking, countEdits, resetEdits } from './agent.ts';
import { HttpError, readJson, sendJson } from './http.ts';

/** Largest JSON body of a page's db write batch. */
const MAX_WRITE_BODY = 64 * 1024 * 1024;
/** Largest JSON body of a comment route. */
const MAX_COMMENT_BODY = 256 * 1024;
/** Debounce of the disk watcher, ms. */
const WATCH_DEBOUNCE_MS = 120;
/** Full rescan interval when the platform cannot watch, ms. */
const POLL_MS = 2_000;
/**
 * Full rescans soon after a watch starts, ms after it. A new watch is armed by the OS in the background (FSEvents on
 * macOS): a change made in that moment, such as a Link push just as a page opens, is never reported, and the slow
 * rescan would show it only after `POLL_MS * 5`.
 */
export const ARM_RESCAN_MS: readonly number[] = [300, 1_500];

/** What a {@link DbHost} reports to its server. */
export interface DbHostOptions {
  /** The artifact folder. */
  root: string;
  /** Display name of the local viewer (comment author). */
  viewerName: string;
  /** Pushes an event to the artifact's pages; `except` skips one client. */
  emit<N extends 'db' | 'comments'>(name: N, payload: ServerEvents[N], except?: string): void;
  /** A change made outside the pages (the agent) was seen; db paths or `comments.json`. */
  onExternal?(paths: string[]): void;
  /** A page wrote these document paths. */
  onWrite?(paths: string[], client: string): void;
  /** Hands a thread to the agent (`unasked`: a reply that does not ask it); resolves whether it was delivered now. */
  sendThread?(thread: Thread, how?: SendHow): Promise<'delivered' | 'drafted' | 'queued' | 'failed'>;
  log?(message: string): void;
  /**
   * False for a type that keeps comments but no document store (its files
   * live under `project/`): only the comment routes and actions are served,
   * and no `db/` folder is made or watched. Default true.
   */
  documents?: boolean;
  /** Refuses an agent's batch the type's page would drop part of (the type's `writesProblem`). */
  writesProblem?(writes: readonly unknown[], read: (path: string) => unknown): { code: string; message: string } | null;
  /** The documents a commenter may write, by their id (the type's `commenterWrites`); without it, none. */
  commenterWrites?(path: string, guestId: string): boolean;
  /**
   * `events`: this process is the only writer and `fs.watch` reports every write at once (a host's own storage), so
   * no rescan runs on a timer (none while arming the watch, no slow poll); if a watch cannot start, the poll does.
   * Default `poll`.
   */
  watch?: 'poll' | 'events';
  /** How comment writes are locked (`CommentStore`): `file` (default) across processes, `process` within this one. */
  commentLock?: CommentLock;
}

/** A guest of a share link, as the server passes them to {@link DbHost.handle}. */
export interface DbGuest {
  name: string;
  /** Who their writes are by, for events. */
  client: string;
  /** Their viewer id (`guest-…`) and role, for what they may write. */
  id?: string;
  role?: Role;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const isPlain = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Applies a JSON merge patch (RFC 7396): objects merge, arrays and scalars
 * replace, `null` removes a key. A missing target starts empty.
 */
export function applyMergePatch(target: unknown, patch: Record<string, unknown>): JsonRecord {
  const out: Record<string, unknown> = isPlain(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch)) {
    if (key === '__proto__') continue;
    if (value === null) delete out[key];
    else if (isPlain(value)) out[key] = applyMergePatch(out[key], value);
    else if (value !== undefined) out[key] = value;
  }
  return out as JsonRecord;
}

/** Nesting depth of a JSON value (a scalar is 0); stops past `limit`. */
function depthOf(value: unknown, limit: number, depth = 0): number {
  if (depth > limit) return depth;
  if (Array.isArray(value)) return value.reduce<number>((max, v) => Math.max(max, depthOf(v, limit, depth + 1)), depth);
  if (isPlain(value)) return Object.values(value).reduce<number>((max, v) => Math.max(max, depthOf(v, limit, depth + 1)), depth);
  return depth;
}

/** True when a value carries server-sdk's `{__delete__: true}` marker somewhere. */
function hasDeleteMarker(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasDeleteMarker);
  if (!isPlain(value)) return false;
  return value.__delete__ === true || Object.values(value).some(hasDeleteMarker);
}

/** Refuses a document the store would not keep. */
function checkDocument(path: string, data: JsonRecord): void {
  const bytes = Buffer.byteLength(JSON.stringify(data));
  if (bytes > DB_LIMITS.maxDocumentBytes) throw new HttpError(400, 'invalid', `${path}: a document is at most ${DB_LIMITS.maxDocumentBytes} bytes (this one is ${bytes}).`);
  if (depthOf(data, DB_LIMITS.maxDepth) > DB_LIMITS.maxDepth) throw new HttpError(400, 'invalid', `${path}: a document nests at most ${DB_LIMITS.maxDepth} levels.`);
  if (hasDeleteMarker(data)) throw new HttpError(400, 'invalid', `${path}: {__delete__: true} is not data; use null in an update to remove a key.`);
}

/** Turns a server-sdk `FrameError` (or anything else) into an {@link HttpError}. */
export function toHttpError(error: unknown): unknown {
  if (error instanceof HttpError) return error;
  const candidate = error as { code?: unknown; status?: unknown; message?: unknown; extra?: Record<string, unknown> } | null;
  if (!candidate || typeof candidate.code !== 'string') return error;
  const message = typeof candidate.message === 'string' ? candidate.message : String(error);
  // FrameError's fix and current (a conflict's documents as they are now) go along.
  const extra = candidate.extra && typeof candidate.extra === 'object' ? candidate.extra : undefined;
  switch (candidate.code) {
    case 'invalid_argument':
    case 'too_large':
      return new HttpError(400, 'invalid', message, extra);
    case 'conflict':
      return new HttpError(409, 'conflict', message, extra);
    case 'not_found':
      return new HttpError(404, 'not_found', message);
    case 'forbidden':
      return new HttpError(403, 'forbidden', message);
    default:
      return new HttpError(503, 'unavailable', message);
  }
}

/** Runs `task`, rethrowing store errors as HTTP errors. */
function guarded<T>(task: () => T): T {
  try {
    return task();
  } catch (error) {
    throw toHttpError(error);
  }
}

/** A stored document's JSON, normalized so equal data compares equal. */
function canonical(text: string): string | null {
  try {
    const data = JSON.parse(text) as unknown;
    return isPlain(data) ? JSON.stringify(data) : null;
  } catch {
    return null;
  }
}

/** A document people edit as content (elements and the board's title and order), not page state. */
function isContentPath(path: string): boolean {
  return path.startsWith('elements/') || path === 'board/meta';
}

/** A thread as pages see it (the runtime's {@link CommentThread}). */
export function pageThread(thread: Thread): CommentThread {
  return {
    id: thread.id,
    anchor: thread.anchor,
    label: thread.label,
    ...(thread.detail ? { detail: thread.detail } : {}),
    location: (isPlain(thread.location) ? thread.location : {}) as JsonRecord,
    status: thread.status === 'resolved' ? 'resolved' : 'open',
    ...(thread.agent ? { agent: { status: thread.agent.status, ...(thread.agent.status === 'delivered' && thread.agent.via === 'drafted' ? { drafted: true as const } : {}) } } : {}),
    ...(thread.status === 'resolved' && thread.resolvedBy ? { resolvedBy: pageAuthor(thread.resolvedBy) } : {}),
    messages: thread.messages.map((message) => ({
      id: message.id,
      author: pageAuthor(message.author),
      text: message.text,
      at: message.at,
      ...(message.editedAt ? { editedAt: message.editedAt } : {}),
      ...(message.to?.length ? { to: [...message.to] } : {}),
      ...(message.reactions?.length ? { reactions: pageReactions(message.reactions) } : {}),
      ...(message.joined ? { joined: true } : {}),
    })),
  };
}

function pageAuthor(author: Author | undefined): CommentAuthor {
  return { kind: author?.kind === 'agent' ? 'agent' : 'person', name: author?.name ?? '' };
}

/** Reactions grouped by emoji, in the order each emoji first appeared. */
function pageReactions(reactions: readonly MessageReaction[]): CommentReaction[] {
  const byEmoji = new Map<string, CommentAuthor[]>();
  for (const reaction of reactions) {
    const authors = byEmoji.get(reaction.emoji) ?? [];
    authors.push(pageAuthor(reaction.author));
    byEmoji.set(reaction.emoji, authors);
  }
  return [...byEmoji].map(([emoji, authors]) => ({ emoji, authors }));
}

/** How a thread goes to the agent: `unasked`, a reply that does not @mention it, in a thread it took part in. */
export interface SendHow {
  unasked?: boolean;
  /** Who sent the thread, when not the owner (an editor on a hosted artifact whose owner lets editors ask). */
  from?: WakeSender;
}

/** The text of the request that hands a thread to the agent (the thread itself travels as data). */
export function threadRequestText(thread: Thread, how: SendHow = {}): string {
  if (how.unasked) {
    return `A new reply in the comment thread on "${thread.label}", which you took part in, was sent to you without being addressed to you (it does not @mention you). Read the thread (ArtifactComments read, or the context below) and decide whether the reply is for you. If it is, do what it asks and answer briefly in the thread; if it is a note for the writer or for someone else, leave it: no reply is needed.`;
  }
  return `A comment thread on "${thread.label}" was sent to you. Read it (ArtifactComments read, or the context below), act on it, and reply in the thread.`;
}

/* -------------------------------------------------------------------------- */
/* The host                                                                   */
/* -------------------------------------------------------------------------- */

/** The db store and comments of one open (or acted-on) artifact. */
export class DbHost {
  /** This host's order: a new epoch per instance, one `seq` per db event. */
  private readonly epoch = randomUUID();
  private seq = 0;
  readonly root: string;
  readonly db: DbStore;
  readonly comments: CommentStore;
  private readonly options: DbHostOptions;
  /** Document path → canonical JSON as last seen on disk (or written by us). */
  private readonly known = new Map<string, string>();
  /** `comments.json` text as last seen or written. */
  private commentsText: string | null = null;
  private watchers: FSWatcher[] = [];
  private poll: NodeJS.Timeout | null = null;
  private arming: NodeJS.Timeout[] = [];
  private timer: NodeJS.Timeout | null = null;
  private dirty = new Set<string>();
  private fullScan = false;
  private commentsDirty = false;
  private started = false;

  constructor(options: DbHostOptions) {
    this.options = options;
    this.root = options.root;
    this.db = new DbStore(options.root);
    this.comments = new CommentStore(options.root, { lock: options.commentLock ?? 'file' });
  }

  /* ---- watching ---------------------------------------------------------- */

  /** True when this host keeps a document store (not only comments). */
  get documents(): boolean {
    return this.options.documents !== false;
  }

  /** Takes a picture of the disk and starts watching it (idempotent). */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.snapshot();
    let watching = true;
    try {
      if (this.documents) {
        mkdirSync(this.db.dir, { recursive: true });
        const dbWatcher = watch(this.db.dir, { recursive: true }, (_event, name) => {
          if (typeof name === 'string' && name) for (const path of docPathsOf([`${DB_DIR}/${name.split('\\').join('/')}`])) this.dirty.add(path);
          else this.fullScan = true;
          this.schedule();
        });
        dbWatcher.on('error', () => undefined);
        this.watchers.push(dbWatcher);
      }
      const rootWatcher = watch(this.root, (_event, name) => {
        if (name === null || name === COMMENTS_FILE) {
          this.commentsDirty = true;
          this.schedule();
        }
      });
      rootWatcher.on('error', () => undefined);
      this.watchers.push(rootWatcher);
    } catch (error) {
      watching = false;
      if (this.options.watch === 'events') this.options.log?.(`cannot watch ${this.root} (${error instanceof Error ? error.message : String(error)}); polling it`);
    }
    // A single writer's watch reports every write and is armed when `watch` returns: nothing to poll for.
    if (watching && this.options.watch === 'events') return;
    // A slow full rescan covers platforms without (recursive) watching and missed events.
    this.poll = setInterval(
      () => {
        this.fullScan = true;
        this.commentsDirty = true;
        this.schedule();
      },
      watching ? POLL_MS * 5 : POLL_MS,
    );
    this.poll.unref?.();
    if (watching) this.arming = ARM_RESCAN_MS.map((ms) => {
      const timer = setTimeout(() => {
        this.fullScan = true;
        this.commentsDirty = true;
        this.schedule();
      }, ms);
      timer.unref?.();
      return timer;
    });
  }

  /** Stops watching. */
  stop(): void {
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
    if (this.poll) clearInterval(this.poll);
    for (const timer of this.arming) clearTimeout(timer);
    this.arming = [];
    if (this.timer) clearTimeout(this.timer);
    this.poll = null;
    this.timer = null;
    this.started = false;
  }

  private snapshot(): void {
    this.known.clear();
    if (this.documents) for (const { path } of this.db.listAll()) {
      const text = this.readText(path);
      if (text !== null) this.known.set(path, text);
    }
    this.commentsText = this.readCommentsText();
  }

  private readText(path: string): string | null {
    try {
      return canonical(readFileSync(join(this.db.dir, ...path.split('/')) + '.json', 'utf8'));
    } catch {
      return null;
    }
  }

  private readCommentsText(): string | null {
    try {
      return readFileSync(this.comments.file, 'utf8');
    } catch {
      return null;
    }
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        this.rescan();
      } catch (error) {
        this.options.log?.(`db rescan failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, WATCH_DEBOUNCE_MS);
  }

  /** Compares the disk with the picture; reports what someone else changed. */
  rescan(): void {
    const paths = new Set(this.dirty);
    this.dirty.clear();
    if (this.fullScan) {
      this.fullScan = false;
      if (this.documents) for (const { path } of this.db.listAll()) paths.add(path);
      for (const path of this.known.keys()) paths.add(path);
    }
    const changes: Record<string, JsonRecord | null> = {};
    for (const path of paths) {
      const exists = existsSync(join(this.db.dir, ...path.split('/')) + '.json');
      const text = exists ? this.readText(path) : null;
      // Half-written (unparsable) files wait for the next event.
      if (exists && text === null) continue;
      const before = this.known.get(path) ?? null;
      if (text === before) continue;
      if (text === null) this.known.delete(path);
      else this.known.set(path, text);
      changes[path] = text === null ? null : (JSON.parse(text) as JsonRecord);
    }
    const changed = Object.keys(changes);
    if (changed.length) {
      this.emitDb(changes, 'agent');
      this.options.onExternal?.(changed);
    }
    if (this.commentsDirty) {
      this.commentsDirty = false;
      const text = this.readCommentsText();
      if (text !== this.commentsText) {
        this.commentsText = text;
        this.options.emit('comments', this.pageThreads());
        this.options.onExternal?.([COMMENTS_FILE]);
      }
    }
  }

  /* ---- documents --------------------------------------------------------- */

  /** Where the documents stand now. */
  order(): DbOrder {
    return { epoch: this.epoch, seq: this.seq };
  }

  /** Reports changes to the pages (`except` skips one client), as the next change in this host's order. */
  private emitDb(changes: Record<string, JsonRecord | null>, author: string, except?: string): void {
    this.seq += 1;
    this.options.emit('db', { changes, author, epoch: this.epoch, seq: this.seq } satisfies DbChangeEvent, except);
  }

  /** One document, or `null`. */
  get(path: string): JsonRecord | null {
    return guarded(() => this.db.readDoc(path) as JsonRecord | null);
  }

  /** Every document of one collection, sorted by path. */
  list(collection: string): DbDocument[] {
    const segments = guarded(() => splitPath(collection, 'collection'));
    const prefix = segments.join('/');
    return guarded(() => this.db.listCollection(prefix)).map((doc) => ({ path: `${prefix}/${doc.id}`, data: doc.data as JsonRecord }));
  }

  /**
   * Applies a page's batch in order, all or nothing: every write is checked
   * against the documents as the batch leaves them before anything is
   * stored, a write's `ifMatch` too (any that fails refuses the batch with
   * `conflict`). Returns the changed paths (an event goes to every other client).
   */
  write(writes: unknown, author: string, except?: string): string[] {
    return this.commit(writes, author, except).changed;
  }

  /** {@link write}, with the batch's {@link DbReceipt}: the order after it and every written document as stored. */
  commit(writes: unknown, author: string, except?: string): { changed: string[]; receipt: DbReceipt } {
    if (!Array.isArray(writes) || writes.length === 0) throw new HttpError(400, 'invalid', 'writes is a non-empty array.');
    if (writes.length > DB_LIMITS.maxWrites) throw new HttpError(400, 'invalid', `At most ${DB_LIMITS.maxWrites} writes in one batch.`);
    const staged = new Map<string, JsonRecord | null>();
    const current = (path: string): JsonRecord | null => (staged.has(path) ? staged.get(path)! : (this.db.readDoc(path) as JsonRecord | null));
    const conflicts: { path: string; expected: string | null; actual: string | null }[] = [];
    for (const raw of writes as Array<Partial<DbWrite> & { data?: unknown; patch?: unknown }>) {
      const op = raw?.op;
      const path = guarded(() => splitPath(raw?.path, 'doc')).join('/');
      // `ifMatch`: only while the document is still the one the page read (checked as the batch leaves it so far).
      if (raw.ifMatch !== undefined) {
        if (raw.ifMatch !== null && !(typeof raw.ifMatch === 'string' && /^[0-9a-f]{64}$/.test(raw.ifMatch))) {
          throw new HttpError(400, 'invalid', `${String(op)} ${path}: ifMatch is the document's sha256 or null.`);
        }
        const have = current(path);
        const actual = have ? docSha256(have) : null;
        if (actual !== raw.ifMatch) conflicts.push({ path, expected: raw.ifMatch, actual });
      }
      if (op === 'delete') {
        staged.set(path, null);
      } else if (op === 'set') {
        if (!isPlain(raw.data)) throw new HttpError(400, 'invalid', `set ${path}: data is a JSON object.`);
        const data = raw.data as JsonRecord;
        checkDocument(path, data);
        staged.set(path, data);
      } else if (op === 'update') {
        if (!isPlain(raw.patch)) throw new HttpError(400, 'invalid', `update ${path}: patch is a JSON object.`);
        const data = applyMergePatch(current(path), raw.patch);
        checkDocument(path, data);
        staged.set(path, data);
      } else {
        throw new HttpError(400, 'invalid', `Unknown op ${JSON.stringify(op)}.`);
      }
    }
    if (conflicts.length) {
      const what = conflicts.length === 1 ? `${conflicts[0]!.path} changed` : `${conflicts.length} documents changed`;
      throw new HttpError(409, 'conflict', `${what} since it was read: nothing was written.`, { paths: conflicts });
    }
    const changes: Record<string, JsonRecord | null> = {};
    const documents: Record<string, JsonRecord | null> = {};
    for (const [path, data] of staged) {
      documents[path] = data;
      // Always store (the picture may lag the disk); report only real changes.
      const text = data === null ? null : JSON.stringify(data);
      const before = this.known.get(path) ?? null;
      if (data === null) {
        guarded(() => this.db.delete(path));
        this.known.delete(path);
      } else {
        guarded(() => this.db.set(path, data));
        this.known.set(path, text!);
      }
      if (text !== before) changes[path] = data;
    }
    const changed = Object.keys(changes);
    if (changed.length) this.emitDb(changes, author, except);
    // People's edits of the content since the agent last read it (the view context's `edits`).
    countEdits(this.root, changed.filter(isContentPath).length);
    return { changed, receipt: { ...this.order(), documents } };
  }

  /* ---- comments ---------------------------------------------------------- */

  /** Every thread, as pages see them. */
  pageThreads(): CommentThread[] {
    return this.comments.threads({ all: true }).map(pageThread);
  }

  /** Records the new `comments.json` and tells every page. */
  private commentsChanged(): void {
    this.commentsText = this.readCommentsText();
    this.options.emit('comments', this.pageThreads());
  }

  private viewer(name?: string): Author {
    return { kind: 'user', name: name ?? this.options.viewerName };
  }

  private threadById(id: string): Thread {
    return guarded(() => this.comments.find(this.comments.load(), id));
  }

  /**
   * `send`: marks the thread for the agent and hands it over. `unasked` (a reply that does not ask the agent, in a
   * thread it took part in) keeps the thread's status: the agent may leave it.
   */
  async sendThread(threadId: string, how: SendHow = {}): Promise<Thread> {
    const unasked = how.unasked === true;
    let thread = guarded(() => this.comments.markSent(threadId, { unasked }));
    this.commentsChanged();
    const outcome = this.options.sendThread ? await this.options.sendThread(thread, { ...(unasked ? { unasked } : {}), ...(how.from ? { from: how.from } : {}) }) : 'queued';
    if (outcome === 'failed') throw new HttpError(503, 'unavailable', 'The agent could not be reached; the thread stays marked for it.');
    if ((outcome === 'delivered' || outcome === 'drafted') && !unasked) {
      // `drafted`: in the agent's conversation, waiting for the person to send it there.
      thread = guarded(() => this.comments.markDelivered(thread.id, outcome === 'drafted' ? 'drafted' : 'hook'));
      this.commentsChanged();
    }
    return thread;
  }

  /**
   * Throws `not_writer` (403) unless every write of a commenter's batch is to a document the type lets them write,
   * checked before anything is written.
   */
  private assertCommenterWrites(writes: unknown, guestId: string): void {
    if (!Array.isArray(writes)) return;
    const may = this.options.commenterWrites;
    for (const raw of writes as Array<{ path?: unknown } | null>) {
      const path = guarded(() => splitPath(raw?.path, 'doc')).join('/');
      if (may === undefined || guestId === '' || !may(path, guestId)) {
        throw new HttpError(403, 'not_writer', `A commenter can write only their own documents, not ${path}.`);
      }
    }
  }

  /* ---- page routes ------------------------------------------------------- */

  /**
   * Answers a page route this host owns; `false` when the route is not one.
   * `as` names a guest of a share link: their comments carry their name, and
   * their writes their author.
   */
  async handle(route: string, req: IncomingMessage, res: ServerResponse, url: URL, as?: DbGuest): Promise<boolean> {
    const method = req.method ?? 'GET';
    const postOnly = (): void => {
      if (method !== 'POST') throw new HttpError(405, 'invalid', 'POST only.');
    };
    // A comments-only host leaves the document routes unanswered (404).
    if (!this.documents && (route === API.dbGet || route === API.dbList || route === API.dbWrite)) return false;
    switch (route) {
      case API.dbGet: {
        const body: DbGetResponse = { data: this.get(url.searchParams.get('path') ?? '') };
        sendJson(res, 200, body);
        return true;
      }
      case API.dbList: {
        // Read synchronously after taking the order: the documents are as of `seq`.
        const body: DbListResponse = { ...this.order(), documents: this.list(url.searchParams.get('collection') ?? '') };
        sendJson(res, 200, body);
        return true;
      }
      case API.dbWrite: {
        postOnly();
        const body = await readJson<Partial<DbWriteRequest>>(req, MAX_WRITE_BODY);
        if (as?.role === 'commenter') this.assertCommenterWrites(body.writes, as.id ?? '');
        const client = typeof body.client === 'string' ? body.client : '';
        const { changed, receipt } = this.commit(body.writes, client || as?.client || 'owner', client || undefined);
        if (changed.length) this.options.onWrite?.(changed, client);
        sendJson(res, 200, { ok: true, ...receipt } satisfies DbWriteResponse);
        return true;
      }
      case API.comments: {
        const body: CommentsResponse = { threads: this.pageThreads() };
        sendJson(res, 200, body);
        return true;
      }
      case API.commentsCreate: {
        postOnly();
        const { input } = await readJson<Partial<CommentCreateRequest>>(req, MAX_COMMENT_BODY);
        if (!isPlain(input) || typeof input.anchor !== 'string') throw new HttpError(400, 'invalid', 'input {anchor, label, text} is required.');
        const thread = guarded(() =>
          this.comments.create({ anchor: input.anchor, label: input.label, detail: input.detail, location: input.location, text: input.text, to: input.to, author: this.viewer(as?.name) }),
        );
        this.commentsChanged();
        sendJson(res, 200, { thread: pageThread(thread) } satisfies CommentThreadResponse);
        return true;
      }
      case API.commentsReply: {
        postOnly();
        const body = await readJson<Partial<CommentReplyRequest>>(req, MAX_COMMENT_BODY);
        const { thread } = guarded(() => this.comments.addMessage(body.threadId, this.viewer(as?.name), body.text, { to: body.to }));
        this.commentsChanged();
        sendJson(res, 200, { thread: pageThread(thread) } satisfies CommentThreadResponse);
        return true;
      }
      case API.commentsEdit: {
        postOnly();
        const body = await readJson<Partial<CommentEditRequest>>(req, MAX_COMMENT_BODY);
        const thread = guarded(() => this.comments.editMessage(body.threadId, body.messageId, this.viewer(as?.name), body.text, body.to));
        this.commentsChanged();
        sendJson(res, 200, { thread: pageThread(thread) } satisfies CommentThreadResponse);
        return true;
      }
      case API.commentsReact: {
        postOnly();
        const body = await readJson<Partial<CommentReactRequest>>(req, MAX_COMMENT_BODY);
        const thread = guarded(() => this.comments.react(body.threadId, body.messageId, this.viewer(as?.name), body.emoji, body.on !== false));
        this.commentsChanged();
        sendJson(res, 200, { thread: pageThread(thread) } satisfies CommentThreadResponse);
        return true;
      }
      case API.commentsResolve: {
        postOnly();
        const body = await readJson<Partial<CommentResolveRequest>>(req, MAX_COMMENT_BODY);
        const thread = guarded(() => this.comments.setResolved(body.threadId, body.resolved !== false, this.viewer(as?.name)));
        this.commentsChanged();
        sendJson(res, 200, { thread: pageThread(thread) } satisfies CommentThreadResponse);
        return true;
      }
      case API.commentsMove: {
        postOnly();
        const body = await readJson<Partial<CommentMoveRequest>>(req, MAX_COMMENT_BODY);
        if (typeof body.anchor !== 'string') throw new HttpError(400, 'invalid', 'anchor is a string.');
        const thread = guarded(() => this.comments.move(body.threadId, body.anchor, body.location));
        this.commentsChanged();
        sendJson(res, 200, { thread: pageThread(thread) } satisfies CommentThreadResponse);
        return true;
      }
      case API.commentsRemove: {
        postOnly();
        const body = await readJson<Partial<CommentRemoveRequest>>(req, MAX_COMMENT_BODY);
        guarded(() => this.comments.remove(body.threadId, body.messageId));
        this.commentsChanged();
        sendJson(res, 200, { threads: this.pageThreads() } satisfies CommentsResponse);
        return true;
      }
      case API.commentsSend: {
        postOnly();
        const body = await readJson<Partial<CommentSendRequest>>(req, MAX_COMMENT_BODY);
        if (typeof body.threadId !== 'string') throw new HttpError(400, 'invalid', 'threadId is required.');
        this.threadById(body.threadId);
        // A guest gets here only when the role check let them send (an editor whose owner lets editors ask).
        const from = as?.role && as.role !== 'owner' ? { name: as.name, role: as.role } : undefined;
        const thread = await this.sendThread(body.threadId, { unasked: body.unasked === true, ...(from ? { from } : {}) });
        sendJson(res, 200, { thread: pageThread(thread) } satisfies CommentThreadResponse);
        return true;
      }
      default:
        return false;
    }
  }

  /* ---- the agent's reserved actions -------------------------------------- */

  /**
   * Runs `open-artifact.db.read|write` and `open-artifact.comments.read|reply|resolve` (what the
   * daemon's ArtifactData and ArtifactComments tools call). Writes are
   * reported to every open page as the agent's.
   */
  runReserved(name: string, args: Record<string, unknown>): unknown {
    if (!this.documents && name.startsWith('open-artifact.db.')) throw new HttpError(404, 'unknown_action', `No action ${name}: this type keeps no document store.`);
    switch (name) {
      case 'open-artifact.db.read':
        resetEdits(this.root);
        clearAsking(this.root);
        return guarded(() => this.db.readDb(typeof args.path === 'string' && args.path ? args.path : undefined, { query: args.query, limit: args.limit, cursor: args.cursor }));
      case 'open-artifact.db.write': {
        const writes = Array.isArray(args.writes) ? args.writes : [];
        const problem = this.options.writesProblem?.(writes, (path) => {
          try {
            return this.db.readDoc(path);
          } catch {
            return null;
          }
        });
        if (problem) throw new HttpError(400, 'invalid', `${problem.message} Nothing was written.`, { refused: problem.code });
        const results = guarded(() => this.db.writeDb(writes, { requireIfMatch: args.require_if_match === true }));
        const changes: Record<string, JsonRecord | null> = {};
        for (const result of results) {
          const path = String(result.path);
          const text = this.readText(path);
          if (text === (this.known.get(path) ?? null)) continue;
          if (text === null) this.known.delete(path);
          else this.known.set(path, text);
          changes[path] = text === null ? null : (JSON.parse(text) as JsonRecord);
        }
        if (Object.keys(changes).length) {
          this.emitDb(changes, 'agent');
          this.options.onExternal?.(Object.keys(changes));
        }
        return { writes: results };
      }
      case 'open-artifact.comments.read':
        return {
          threads: this.comments.threads({ all: !!args.all }).map((thread, index) => agentView(thread, index + 1)),
          // A thread without `agent` was not sent to the agent: the daemon keeps the agent's replies off it.
          sent_tracked: true,
        };
      case 'open-artifact.comments.reply': {
        const { thread } = guarded(() => this.comments.addMessage(args.thread_id, { ...AGENT_AUTHOR }, args.text, { resolve: !!args.resolve }));
        this.commentsChanged();
        return { thread: agentView(thread) };
      }
      case 'open-artifact.comments.resolve': {
        const thread = guarded(() => this.comments.setResolved(args.thread_id, !args.reopen, { ...AGENT_AUTHOR }));
        this.commentsChanged();
        return { thread: agentView(thread) };
      }
      default:
        throw new HttpError(404, 'unknown_action', `No action ${name}.`);
    }
  }
}

/** Reads every document of a db folder, keyed by document path, as raw text (for checks). */
export function readDbFiles(root: string): Map<string, string> {
  const store = new DbStore(root);
  const files = new Map<string, string>();
  for (const { path } of store.listAll()) {
    try {
      files.set(path, readFileSync(join(store.dir, ...path.split('/')) + '.json', 'utf8'));
    } catch {
      files.set(path, '');
    }
  }
  return files;
}
