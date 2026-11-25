/**
 * Host events: what happened to artifacts and outboxes inside this process, for the app layer to pass on (the
 * Library's event stream, Link `files` / `artifact` / `wake` events).
 *
 * A tiny typed emitter on plain Maps and Sets (no Node `EventEmitter`: the core runs on Workers too). Listeners run
 * synchronously in the order they were added; one that throws does not stop the others (its error goes to
 * `onError`).
 */

/** The events and their payloads. */
export interface HostEventMap {
  /** People wrote through a page: `author` is the type server's (`owner`, `guest:<name>`, …), `paths` what changed. */
  'artifact-touched': { id: string; author: string; paths: string[]; title?: string };
  /** The artifact's record changed (title, trash, owner, …); `author` is `agent` when a Link made the change. */
  'artifact-changed': { id: string; author?: string; capabilities?: Record<string, unknown> };
  /** Who may open the artifact changed (grants, links, general access). */
  'access-changed': { id: string };
  /** A user's outbox has a new entry for their agent. */
  outbox: { userId: string };
  /** A user's linked computer connected or went away (the first Link stream opened, or the last one closed). */
  'agent-changed': { userId: string };
}

export type HostEventName = keyof HostEventMap;
export type HostEventListener<N extends HostEventName> = (payload: HostEventMap[N]) => void;

export class HostEvents {
  readonly #listeners = new Map<HostEventName, Set<(payload: never) => void>>();
  readonly #onError: (error: unknown, name: HostEventName) => void;

  constructor(options: { onError?: (error: unknown, name: HostEventName) => void } = {}) {
    this.#onError = options.onError ?? (() => undefined);
  }

  /** Adds a listener; returns what removes it. */
  on<N extends HostEventName>(name: N, listener: HostEventListener<N>): () => void {
    let set = this.#listeners.get(name);
    if (!set) this.#listeners.set(name, (set = new Set()));
    const stored = listener as (payload: never) => void;
    set.add(stored);
    return () => {
      set.delete(stored);
    };
  }

  /** Calls the event's listeners with `payload`. */
  emit<N extends HostEventName>(name: N, payload: HostEventMap[N]): void {
    const set = this.#listeners.get(name);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        (listener as HostEventListener<N>)(payload);
      } catch (error) {
        this.#onError(error, name);
      }
    }
  }

  /** How many listeners an event has. */
  listenerCount(name: HostEventName): number {
    return this.#listeners.get(name)?.size ?? 0;
  }
}
