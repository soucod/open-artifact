/**
 * `fs.watch`, emulated. Every change goes through this file system, so every change is known: each one is reported
 * to every watcher whose path covers it (the path itself, an entry directly in it, or anything below it when the
 * watcher is recursive), after the call that made it returned and committed — on a later macrotask, as Node reports
 * the kernel's events. A change rolled back reports nothing.
 *
 * Events: `rename` when an entry appears or goes (create, delete, either side of a rename), `change` when a file's
 * bytes or times change. The filename is relative to the watched path (its own name when a file is watched), with `/`
 * separators.
 */
import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';
import type { Encoding } from './types.ts';

export type WatchEvent = 'rename' | 'change';
export type WatchListener = (event: WatchEvent, filename: string | Buffer | null) => void;

const watchers = new Set<FSWatcher>();

export class FSWatcher extends EventEmitter {
  private closed = false;
  private refed = true;
  private keepAlive: ReturnType<typeof setInterval> | null = null;

  readonly path: string;
  readonly recursive: boolean;
  private readonly encoding: Encoding;

  constructor(path: string, recursive: boolean, encoding: Encoding, persistent: boolean) {
    super();
    this.path = path;
    this.recursive = recursive;
    this.encoding = encoding;
    watchers.add(this);
    if (persistent) this.ref();
    else this.unref();
  }

  /** Stops reporting; emits `close`. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    watchers.delete(this);
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.keepAlive = null;
    queueMicrotask(() => this.emit('close'));
  }

  /** Keeps the process alive while open (only meaningful in Node; a Worker has no event loop to hold). */
  ref(): this {
    this.refed = true;
    if (!this.closed && !this.keepAlive && typeof process !== 'undefined' && process.release?.name === 'node' && !isWorkerd()) {
      this.keepAlive = setInterval(() => undefined, 2 ** 30);
    }
    return this;
  }

  unref(): this {
    this.refed = false;
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.keepAlive = null;
    return this;
  }

  hasRef(): boolean {
    return this.refed;
  }

  /** @internal Reports a change at `path` when it is this watcher's. */
  report(path: string, event: WatchEvent): void {
    if (this.closed) return;
    let filename: string;
    if (path === this.path) filename = path.slice(path.lastIndexOf('/') + 1);
    else if (path.startsWith(this.path === '/' ? '/' : this.path + '/')) {
      filename = path.slice(this.path === '/' ? 1 : this.path.length + 1);
      if (!this.recursive && filename.includes('/')) return;
    } else return;
    const name = this.encoding === 'buffer' ? Buffer.from(filename) : filename;
    this.emit('change', event, name);
  }
}

function isWorkerd(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers';
}

/** Changes of the call running now, reported once it has committed. */
let pending: { path: string; event: WatchEvent }[] = [];

/** Notes a change made by the current call. */
export function changed(path: string, event: WatchEvent): void {
  if (watchers.size > 0) pending.push({ path, event });
}

/** The current call committed: report its changes on a later macrotask. */
export function flushChanges(): void {
  if (pending.length === 0) return;
  const batch = pending;
  pending = [];
  setTimeout(() => {
    for (const { path, event } of batch) for (const watcher of [...watchers]) watcher.report(path, event);
  }, 0);
}

/** The current call failed: what it noted did not happen. */
export function dropChanges(): void {
  pending = [];
}

/** Closes every watcher on or below `root` (its file system is going away). */
export function closeWatchersUnder(root: string): void {
  for (const watcher of [...watchers]) if (watcher.path === root || watcher.path.startsWith(root + '/')) watcher.close();
}

export function watcherCount(): number {
  return watchers.size;
}
