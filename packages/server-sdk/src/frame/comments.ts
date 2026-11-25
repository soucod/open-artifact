/**
 * Comment threads of a frame artifact, in the shared `comments.json` format
 * (version 1) the other Open Artifact types write:
 * `{version: 1, threads: [{id: 'c_…', anchor, label, detail?, location, status, agent?, createdAt, updatedAt,
 * resolvedAt?, messages: [{id: 'm_…', author: {kind, name}, text, at, editedAt?, to?, reactions?}]}]}`.
 *
 * An original page anchors a comment with its own object; it is kept whole
 * under `location.custom` and `anchor` is its stable JSON text, so the page
 * gets back exactly what it gave. Writes take `comments.json.lock` (O_EXCL)
 * and replace the file through a dot temp file; the file exists only once
 * there is a thread. A store whose process is the only writer of the folder
 * (`lock: 'process'`, a host's own storage) locks within the process instead,
 * never waits on a file, and removes a lock file a crash left behind.
 */

import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FrameError, LINK_GUARD, type PathGuard } from './files.ts';
import type { Author, CommentMessage, ThreadAgentState, Thread } from './page-values.ts';

export type { Author, MessageReaction, CommentMessage, ThreadAgentState, Thread } from './page-values.ts';

export const COMMENTS_FILE = 'comments.json';
export const TEXT_MAX = 10_000;
const LOCK_STALE_MS = 10_000;
const LOCK_WAIT_MS = 5_000;

export const AGENT_AUTHOR: Readonly<Author> = Object.freeze({ kind: 'agent', name: 'agent' });

/** At most this many recipients on a message. */
const TO_MAX = 20;
/** The longest emoji a reaction may be (a sequence with modifiers). */
const EMOJI_MAX = 32;

interface CommentsDoc {
  version: 1;
  threads: Thread[];
}

/**
 * How a {@link CommentStore} keeps two writes apart: `file`, the O_EXCL lock file every process honours (the agent's
 * CLI and the type server write the same folder); `process`, within this process alone, for a store whose process is
 * the only writer (no file is made, and nothing waits).
 */
export type CommentLock = 'file' | 'process';

/** Files being written under the `process` lock, by path: a write that comes back to the same file while it runs. */
const writing = new Set<string>();

const newId = (prefix: string): string => `${prefix}${randomBytes(5).toString('hex')}`;
const now = (): string => new Date().toISOString();

export class CommentStore {
  readonly root: string;
  readonly file: string;

  readonly lock: CommentLock;
  private readonly guard: PathGuard;

  /** `guard`: how it keeps inside the artifact folder (default {@link LINK_GUARD}: links followed). */
  constructor(root: string, options: { lock?: CommentLock; guard?: PathGuard } = {}) {
    this.root = root;
    this.file = join(root, COMMENTS_FILE);
    this.lock = options.lock ?? 'file';
    this.guard = options.guard ?? LINK_GUARD;
    // The only writer: a lock file here was left by a write that never finished (a crash), and nobody holds it.
    if (this.lock === 'process') rmSync(`${this.file}.lock`, { force: true });
  }

  load(): CommentsDoc {
    try {
      // A comments.json that is a link to a file outside the artifact folder is not read (and a write replaces the link).
      if (!this.guard.inside(this.root, this.file)) return { version: 1, threads: [] };
      const doc = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<CommentsDoc> | null;
      if (doc && Array.isArray(doc.threads)) return { ...doc, version: 1, threads: doc.threads };
    } catch {
      // none yet, or unreadable: an empty list
    }
    return { version: 1, threads: [] };
  }

  threads({ all = false }: { all?: boolean } = {}): Thread[] {
    const list = this.load().threads.filter((t) => all || t.status !== 'resolved');
    return list.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  }

  openCount(): number {
    return this.load().threads.filter((t) => t.status !== 'resolved').length;
  }

  find(doc: CommentsDoc, idOrPrefix: unknown): Thread {
    const id = String(idOrPrefix ?? '');
    const exact = doc.threads.find((t) => t.id === id);
    if (exact) return exact;
    if (id.length >= 3) {
      const hits = doc.threads.filter((t) => t.id.startsWith(id));
      if (hits.length === 1) return hits[0]!;
      if (hits.length > 1) throw new FrameError('invalid_argument', `${id} matches ${hits.length} threads.`);
    }
    throw new FrameError('not_found', `No comment thread ${id}.`, 404);
  }

  /** Runs `fn(doc)` under the lock and writes the result back. */
  mutate<T>(fn: (doc: CommentsDoc) => T): T {
    if (this.lock === 'process') {
      // A write runs to its end in one turn of this process, so the only other writer can be `fn` itself.
      if (writing.has(this.file)) throw new FrameError('unavailable', 'comments.json is being written.', 409);
      writing.add(this.file);
      try {
        return this.write(fn);
      } finally {
        writing.delete(this.file);
      }
    }
    const lock = `${this.file}.lock`;
    const started = Date.now();
    let fd: number;
    for (;;) {
      try {
        fd = openSync(lock, 'wx');
        break;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        try {
          if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) {
            rmSync(lock, { force: true });
            continue;
          }
        } catch {
          continue;
        }
        if (Date.now() - started > LOCK_WAIT_MS) throw new FrameError('unavailable', 'comments.json is locked by another writer.', 409);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
      }
    }
    try {
      return this.write(fn);
    } finally {
      closeSync(fd);
      rmSync(lock, { force: true });
    }
  }

  /** Reads, applies `fn` and replaces the file (the caller holds the lock). */
  private write<T>(fn: (doc: CommentsDoc) => T): T {
    const doc = this.load();
    const out = fn(doc);
    if (doc.threads.length || existsSync(this.file)) {
      const tmp = join(this.root, `.${COMMENTS_FILE}.${randomBytes(4).toString('hex')}.tmp`);
      writeFileSync(tmp, `${JSON.stringify({ version: 1, threads: doc.threads }, null, 2)}\n`);
      renameSync(tmp, this.file);
    }
    return out;
  }

  create(input: { anchor?: unknown; label?: unknown; detail?: unknown; location?: unknown; text: unknown; to?: unknown; author?: Author }): Thread {
    const body = checkText(input.text);
    const to = checkTo(input.to);
    return this.mutate((doc) => {
      const at = now();
      const thread: Thread = {
        id: newId('c_'),
        anchor: typeof input.anchor === 'string' ? input.anchor : JSON.stringify(input.anchor ?? null),
        label: typeof input.label === 'string' && input.label ? input.label.slice(0, 200) : 'the page',
        ...(typeof input.detail === 'string' && input.detail ? { detail: input.detail.slice(0, 2000) } : {}),
        location: isObject(input.location) ? input.location : {},
        status: 'open',
        createdAt: at,
        updatedAt: at,
        messages: [{ id: newId('m_'), author: input.author ?? { ...AGENT_AUTHOR }, text: body, at, ...(to ? { to } : {}) }],
      };
      doc.threads.push(thread);
      return thread;
    });
  }

  addMessage(threadId: unknown, author: Author, text: unknown, { resolve = false, to }: { resolve?: boolean; to?: unknown } = {}): { thread: Thread; message: CommentMessage } {
    const body = checkText(text);
    const recipients = checkTo(to);
    return this.mutate((doc) => {
      const thread = this.find(doc, threadId);
      const at = now();
      const message: CommentMessage = { id: newId('m_'), author, text: body, at, ...(recipients ? { to: recipients } : {}) };
      thread.messages.push(message);
      thread.updatedAt = at;
      if (author.kind === 'agent') {
        if (thread.agent?.unaskedAt) message.joined = true;
        const { unaskedAt: _answered, ...agent } = thread.agent ?? { status: 'replied' as const };
        thread.agent = { ...agent, status: 'replied', repliedAt: at };
        if (resolve) setStatus(thread, 'resolved', at, author);
      } else if (thread.status === 'resolved') {
        setStatus(thread, 'open', at);
      }
      return { thread, message };
    });
  }

  /** Changes the text (and recipients, when given) of `author`'s own message. */
  editMessage(threadId: unknown, messageId: unknown, author: Author, text: unknown, to?: unknown): Thread {
    const body = checkText(text);
    const recipients = to === undefined ? undefined : checkTo(to);
    return this.mutate((doc) => {
      const thread = this.find(doc, threadId);
      const message = findMessage(thread, messageId);
      if (!sameAuthor(message.author, author)) throw new FrameError('forbidden', 'Only its author edits a comment.', 403);
      const at = now();
      message.text = body;
      message.editedAt = at;
      if (to !== undefined) {
        if (recipients) message.to = recipients;
        else delete message.to;
      }
      thread.updatedAt = at;
      return thread;
    });
  }

  /** Adds (`on`) or takes back `author`'s `emoji` on a message; adding one already there changes nothing. */
  react(threadId: unknown, messageId: unknown, author: Author, emoji: unknown, on: boolean): Thread {
    if (typeof emoji !== 'string' || !emoji.trim() || emoji.length > EMOJI_MAX) throw new FrameError('invalid_argument', 'A reaction is one emoji.');
    return this.mutate((doc) => {
      const thread = this.find(doc, threadId);
      const message = findMessage(thread, messageId);
      const reactions = message.reactions ?? [];
      const mine = reactions.findIndex((r) => r.emoji === emoji && sameAuthor(r.author, author));
      if (on && mine < 0) reactions.push({ emoji, author, at: now() });
      if (!on && mine >= 0) reactions.splice(mine, 1);
      if (reactions.length) message.reactions = reactions;
      else delete message.reactions;
      return thread;
    });
  }

  setResolved(threadId: unknown, resolved: boolean, by?: Author): Thread {
    return this.mutate((doc) => {
      const thread = this.find(doc, threadId);
      setStatus(thread, resolved ? 'resolved' : 'open', now(), by);
      return thread;
    });
  }

  move(threadId: unknown, anchor: unknown, location?: unknown): Thread {
    return this.mutate((doc) => {
      const thread = this.find(doc, threadId);
      thread.anchor = typeof anchor === 'string' ? anchor : JSON.stringify(anchor ?? null);
      if (isObject(location)) thread.location = location;
      thread.updatedAt = now();
      return thread;
    });
  }

  remove(threadId: unknown, messageId?: unknown): { deleted: 'message' | 'thread' } {
    return this.mutate((doc) => {
      const thread = this.find(doc, threadId);
      if (messageId) {
        thread.messages = thread.messages.filter((m) => m.id !== messageId);
        if (thread.messages.length) {
          thread.updatedAt = now();
          return { deleted: 'message' as const };
        }
      }
      doc.threads = doc.threads.filter((t) => t !== thread);
      return { deleted: 'thread' as const };
    });
  }

  markDelivered(threadId: unknown, via: string): Thread {
    return this.mutate((doc) => {
      const thread = this.find(doc, threadId);
      const at = now();
      thread.agent = { status: 'delivered', sentAt: thread.agent?.sentAt ?? at, deliveredAt: at, via };
      return thread;
    });
  }

  /**
   * Marks the thread sent to the agent. `unasked`: a reply that does not ask the agent, sent because it already took
   * part in the thread; only such a thread can be, and it keeps its status (nothing waits on the agent). One the agent
   * had answered remembers it (`unaskedAt`), so the agent's next reply there is marked `joined`.
   */
  markSent(threadId: unknown, { unasked = false }: { unasked?: boolean } = {}): Thread {
    return this.mutate((doc) => {
      const thread = this.find(doc, threadId);
      if (!unasked) {
        thread.agent = { status: 'pending', sentAt: now() };
        return thread;
      }
      if (!thread.agent && !thread.messages.some((m) => m.author?.kind === 'agent')) {
        throw new FrameError('invalid_argument', 'Only a thread the agent took part in is sent to it without asking it.');
      }
      const agent: ThreadAgentState = thread.agent ?? { status: 'replied' };
      thread.agent = agent.status === 'replied' ? { ...agent, unaskedAt: now() } : agent;
      return thread;
    });
  }
}

function setStatus(thread: Thread, status: Thread['status'], at: string, by?: Author): void {
  thread.status = status;
  thread.updatedAt = at;
  if (status === 'resolved') {
    thread.resolvedAt = at;
    if (by) thread.resolvedBy = { ...by };
    else delete thread.resolvedBy;
  } else {
    delete thread.resolvedAt;
    delete thread.resolvedBy;
  }
}

function findMessage(thread: Thread, messageId: unknown): CommentMessage {
  const message = thread.messages.find((m) => m.id === messageId);
  if (!message) throw new FrameError('not_found', `No message ${String(messageId)} in thread ${thread.id}.`, 404);
  return message;
}

const sameAuthor = (a: Author | undefined, b: Author): boolean => a?.kind === b.kind && a.name === b.name;

/** The recipients a message names: short non-empty strings, without repeats; none is `undefined`. */
function checkTo(to: unknown): string[] | undefined {
  if (to === undefined || to === null) return undefined;
  if (!Array.isArray(to) || to.length > TO_MAX || !to.every((name) => typeof name === 'string' && name && name.length <= 200)) {
    throw new FrameError('invalid_argument', `to is a list of at most ${TO_MAX} names.`);
  }
  const names = [...new Set(to as string[])];
  return names.length ? names : undefined;
}

function checkText(text: unknown): string {
  if (typeof text !== 'string' || !text.trim()) throw new FrameError('invalid_argument', 'A comment needs text.');
  if (text.length > TEXT_MAX) throw new FrameError('invalid_argument', `A comment is at most ${TEXT_MAX} characters.`);
  return text;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** What the agent reads of a thread. */
export function agentView(thread: Thread, n?: number): Record<string, unknown> {
  return {
    id: thread.id,
    ...(n !== undefined ? { n } : {}),
    status: thread.status,
    ...(typeof thread.location?.file === 'string' ? { file: thread.location.file } : {}),
    where: thread.label,
    ...(thread.detail ? { detail: thread.detail } : {}),
    location: thread.location ?? {},
    anchor: thread.label,
    ...(thread.agent ? { agent: thread.agent } : {}),
    messages: thread.messages.map((m) => ({
      from: m.author?.kind ?? 'user',
      name: m.author?.name ?? '',
      text: m.text,
      at: m.at,
      ...(m.editedAt ? { editedAt: m.editedAt } : {}),
      ...(m.to?.length ? { to: m.to } : {}),
      ...(m.reactions?.length ? { reactions: m.reactions.map((r) => `${r.emoji} ${r.author.kind === 'agent' ? 'agent' : r.author.name}`) } : {}),
      ...(m.joined ? { joined: true } : {}),
    })),
  };
}
