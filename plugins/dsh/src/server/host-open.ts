/**
 * `host.open` in DSH: the daemon asks the harness to show an artifact (the agent called `open`, or asked for its share
 * or export panel). The server half has no window of its own, so it hands the request to the browser halves following
 * the host routes (routes.ts), which show it in the session's Browser in the right sidebar, and waits for one of them to
 * say it did. With no browser half listening, or none that could show it in time, the answer is `false` and the agent
 * gets the link to give the person.
 *
 * The plugin declares top-level views (`caps.open.embed: 'view'`), so a request carries the page's `embed_url` and its
 * view ticket: the Shell in the Browser tab talks to the daemon, and what it says comes back here as `shell.event`
 * ({@link HostOpens.shell}), which goes on to the browser halves on the same stream; their answers go back through the
 * shell-command route.
 */
import { randomUUID } from 'node:crypto';
import type { ShellEventParams } from '@open-artifact/protocol';
import type { HostOpenRequest } from '../shared/routes.ts';

/** How long a browser half has to show an artifact. */
export const HOST_OPEN_WAIT_MS = 8_000;

type Listener = (request: HostOpenRequest) => void;
type ShellListener = (event: ShellEventParams) => void;

interface Pending {
  /** The listeners that have not answered yet. */
  waiting: number;
  resolve(opened: boolean): void;
  timer: ReturnType<typeof setTimeout>;
}

/** The `host.open` requests between the daemon connection and the browser halves. */
export class HostOpens {
  private readonly listeners = new Set<Listener>();
  private readonly shellListeners = new Set<ShellListener>();
  private readonly pending = new Map<string, Pending>();

  private readonly waitMs: number;

  constructor(waitMs = HOST_OPEN_WAIT_MS) {
    this.waitMs = waitMs;
  }

  /** Follows the requests; the returned function stops. */
  listen(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Follows what the Shells of the views opened here say; the returned function stops. */
  listenShell(listener: ShellListener): () => void {
    this.shellListeners.add(listener);
    return () => this.shellListeners.delete(listener);
  }

  /** What the Shell of a view said (`shell.event`), for every browser half: the one that shows the view takes it. */
  shell(event: ShellEventParams): void {
    for (const listener of [...this.shellListeners]) {
      try {
        listener(event);
      } catch {
        // one browser half's stream is gone: the others still get it
      }
    }
  }

  /** How many browser halves follow the requests. */
  get size(): number {
    return this.listeners.size;
  }

  /**
   * Asks the browser halves to show an artifact: true once one did, false when none could. `extra.view` is the view
   * ticket of a top-level view (`url` is then its `embed_url`).
   */
  open(session: string | null, url: string, title = '', extra: Pick<HostOpenRequest, 'view' | 'agentName'> = {}): Promise<boolean> {
    if (!session || !url || this.listeners.size === 0) return Promise.resolve(false);
    const id = randomUUID();
    return new Promise<boolean>((resolve) => {
      const done = (opened: boolean) => {
        const entry = this.pending.get(id);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.pending.delete(id);
        resolve(opened);
      };
      this.pending.set(id, { waiting: this.listeners.size, resolve: done, timer: setTimeout(() => done(false), this.waitMs) });
      const request: HostOpenRequest = { id, session, url, title, ...(extra.view ? { view: extra.view } : {}), ...(extra.agentName ? { agentName: extra.agentName } : {}) };
      for (const listener of [...this.listeners]) {
        try {
          listener(request);
        } catch {
          this.answer(id, false);
        }
      }
    });
  }

  /** One browser half's answer to a request. */
  answer(id: string, opened: boolean): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    if (opened) return entry.resolve(true);
    entry.waiting -= 1;
    if (entry.waiting <= 0) entry.resolve(false);
  }
}
