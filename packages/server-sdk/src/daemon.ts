/**
 * The Type API client: what a type server started by the daemon calls back
 * (`/api/open-artifact.type.*`, Bearer `OPEN_ARTIFACT_TYPE_TOKEN`).
 *
 * It reads `OPEN_ARTIFACT_DAEMON_URL` and `OPEN_ARTIFACT_TYPE_TOKEN`. A server without them
 * (started by hand, or remote) gets a client whose calls fail with
 * `no_daemon`; its pages simply cannot wake the agent.
 */

import {
  OpenArtifactError,
  TYPE_API_ROUTES,
  type TypeApiArtifact,
  type TypeApiEvent,
  type TypeApiPresence,
  type TypeApiTask,
  type TypeApiTouch,
  type TypeApiWakeRequest,
  type TypeApiWakeResult,
  type TypeServerEnv,
} from '@open-artifact/protocol';

/** The `OPEN_ARTIFACT_*` variable names of {@link TypeServerEnv}. */
const ENV_KEYS = ['OPEN_ARTIFACT_PROTOCOL', 'OPEN_ARTIFACT_TYPE', 'OPEN_ARTIFACT_TYPE_DIR', 'OPEN_ARTIFACT_PORT', 'OPEN_ARTIFACT_SECRET', 'OPEN_ARTIFACT_DAEMON_URL', 'OPEN_ARTIFACT_TYPE_TOKEN', 'OPEN_ARTIFACT_STATE_DIR'] as const;

/**
 * The `OPEN_ARTIFACT_*` variables the daemon passed, without empty ones. Every field is
 * missing when the server was started by hand.
 */
export function typeServerEnv(env: NodeJS.ProcessEnv = process.env): Partial<TypeServerEnv> {
  const out: Partial<TypeServerEnv> = {};
  for (const key of ENV_KEYS) {
    const value = env[key];
    if (value) out[key] = value;
  }
  return out;
}

/** A Type API route name. */
export type TypeApiRoute = (typeof TYPE_API_ROUTES)[keyof typeof TYPE_API_ROUTES];

/** Options of {@link TypeApi}. `null` means "none"; `undefined` reads the environment. */
export interface TypeApiOptions {
  /** Base URL of the daemon (default `OPEN_ARTIFACT_DAEMON_URL`). */
  url?: string | null;
  /** Bearer token of the Type API (default `OPEN_ARTIFACT_TYPE_TOKEN`). */
  token?: string | null;
  /** Per-request timeout, ms. Default 15 s. */
  timeoutMs?: number;
}

/** What {@link TypeApi.wake} hands to the owner's session. */
export type TypeApiWakeBody = Omit<TypeApiWakeRequest, 'id'>;

/**
 * The part of the Type API a type server calls back: what an embedder (a cloud host running the type server in its
 * own process) implements in place of a daemon.
 */
export type TypeApiLike = Pick<TypeApi, 'wake' | 'presence' | 'touch'>;

/** The Type API client. */
export class TypeApi {
  /** Base URL of the daemon without a trailing slash, or `null` when standalone. */
  readonly url: string | null;
  /** Bearer token, or `null` when standalone. */
  readonly token: string | null;
  /** Per-request timeout, ms. */
  readonly timeoutMs: number;

  /** Reads the daemon address and token from `options`, else from the environment. */
  constructor(options: TypeApiOptions = {}) {
    const url = options.url === undefined ? process.env.OPEN_ARTIFACT_DAEMON_URL : options.url;
    const token = options.token === undefined ? process.env.OPEN_ARTIFACT_TYPE_TOKEN : options.token;
    this.url = url ? url.replace(/\/+$/, '') : null;
    this.token = token || null;
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  /** True when the server was started by a daemon and can call it. */
  get available(): boolean {
    return !!(this.url && this.token);
  }

  /**
   * Calls `open-artifact.type.<name>`: `GET` with `query`, or `POST` with `body`.
   * Throws an {@link OpenArtifactError} (`no_daemon`, `daemon_failed`, or the daemon's
   * own code) on failure.
   */
  async call<T>(name: TypeApiRoute, init: { query?: Record<string, string | number>; body?: unknown } = {}): Promise<T> {
    if (!this.available) {
      throw new OpenArtifactError('no_daemon', 'This server was not started by an Open Artifact daemon (no OPEN_ARTIFACT_DAEMON_URL / OPEN_ARTIFACT_TYPE_TOKEN).');
    }
    const url = new URL(`${this.url}/api/open-artifact.type.${name}`);
    for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, String(value));
    const post = init.body !== undefined;
    let response: Response;
    try {
      response = await fetch(url, {
        method: post ? 'POST' : 'GET',
        headers: { authorization: `Bearer ${this.token}`, ...(post ? { 'content-type': 'application/json' } : {}) },
        ...(post ? { body: JSON.stringify(init.body) } : {}),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new OpenArtifactError('daemon_failed', `The Open Artifact daemon did not answer (${error instanceof Error ? error.message : String(error)}).`);
    }
    const out = (await response.json().catch(() => ({}))) as { code?: unknown; message?: unknown; fix?: unknown };
    if (!response.ok) {
      throw new OpenArtifactError(
        typeof out.code === 'string' ? out.code : 'daemon_failed',
        typeof out.message === 'string' ? out.message : `open-artifact.type.${name}: HTTP ${response.status}`,
        typeof out.fix === 'string' ? { fix: out.fix } : {},
      );
    }
    return out as T;
  }

  /** The daemon's record of an artifact. */
  artifact(id: string): Promise<TypeApiArtifact> {
    return this.call<TypeApiArtifact>(TYPE_API_ROUTES.artifact, { query: { id } });
  }

  /** Hands comment threads and page requests to the owner's session. */
  wake(id: string, { threads, requests }: TypeApiWakeBody = {}): Promise<TypeApiWakeResult> {
    const body: TypeApiWakeRequest = { id, ...(threads ? { threads } : {}), ...(requests ? { requests } : {}) };
    return this.call<TypeApiWakeResult>(TYPE_API_ROUTES.wake, { body });
  }

  /** Whether an agent is there to receive, and whether it is busy. */
  presence(id: string): Promise<TypeApiPresence> {
    return this.call<TypeApiPresence>(TYPE_API_ROUTES.presence, { query: { id } });
  }

  /** Reports a write: `author` is a viewer name, `guest:<name>` or `agent`. */
  touch(id: string, { author, paths, title }: Omit<TypeApiTouch, 'id'>): Promise<unknown> {
    const body: TypeApiTouch = { id, author, paths, ...(title ? { title } : {}) };
    return this.call(TYPE_API_ROUTES.touch, { body });
  }

  /** Reports that the owner's view context of an artifact changed (`at`: when, ISO); the daemon tells adapters. */
  context(id: string, at: string): Promise<unknown> {
    return this.call(TYPE_API_ROUTES.context, { body: { id, at } });
  }

  /** Reports progress or the end of a long action. */
  task(task: string, report: Omit<TypeApiTask, 'task'> = {}): Promise<unknown> {
    const body: TypeApiTask = { task, ...report };
    return this.call(TYPE_API_ROUTES.task, { body });
  }

  /**
   * Follows presence and artifact events of some artifacts (server-sent
   * events). Calls `onEvent` for each one and reconnects after a drop until
   * the returned function is called. Does nothing when standalone.
   */
  events(ids: string[], onEvent: (event: TypeApiEvent) => void): () => void {
    let stopped = false;
    let controller: AbortController | null = null;
    const run = async (): Promise<void> => {
      while (!stopped) {
        controller = new AbortController();
        try {
          const url = `${this.url}/api/open-artifact.type.${TYPE_API_ROUTES.events}?ids=${encodeURIComponent(ids.join(','))}`;
          const response = await fetch(url, { headers: { authorization: `Bearer ${this.token}` }, signal: controller.signal });
          if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffered = '';
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffered += decoder.decode(value, { stream: true });
            let at: number;
            while ((at = buffered.indexOf('\n\n')) >= 0) {
              const block = buffered.slice(0, at);
              buffered = buffered.slice(at + 2);
              const data = block
                .split('\n')
                .filter((line) => line.startsWith('data: '))
                .map((line) => line.slice(6))
                .join('\n');
              if (!data) continue;
              try {
                onEvent(JSON.parse(data) as TypeApiEvent);
              } catch {
                // A listener's error is its own.
              }
            }
          }
        } catch {
          // Dropped or refused: try again.
        }
        if (!stopped) await new Promise<void>((done) => setTimeout(done, 2000).unref());
      }
    };
    if (this.available) void run();
    return () => {
      stopped = true;
      controller?.abort();
    };
  }
}
