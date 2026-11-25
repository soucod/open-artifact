/**
 * Live timers in this isolate: what would keep a Durable Object busy (and billed) while no page is open.
 *
 * `trackTimers()` wraps `setTimeout`/`setInterval` once per isolate and keeps each live one with the line that made it,
 * so `stats()` can list them. Several objects share an isolate, so the list is the isolate's, not one object's.
 */

export interface LiveTimer {
  kind: 'timeout' | 'interval';
  ms: number;
  /** Where it was made (two stack frames). */
  site: string;
  /** How long it has been live, ms. */
  ageMs: number;
}

const live = new Map<unknown, { kind: 'timeout' | 'interval'; ms: number; site: string; at: number }>();
let installed = false;

/** A timer handle as a map key (Node's are objects with a numeric primitive; workerd's are numbers). */
function keyOf(handle: unknown): unknown {
  if (typeof handle === 'object' && handle !== null) {
    const primitive = (handle as { [Symbol.toPrimitive]?: () => unknown })[Symbol.toPrimitive];
    return primitive ? primitive.call(handle) : handle;
  }
  return handle;
}

function siteOf(): string {
  return (new Error().stack ?? '')
    .split('\n')
    .slice(3, 5)
    .map((line) => line.trim().replace(/^at /, ''))
    .join(' < ');
}

/** Starts tracking (once per isolate; later calls do nothing). */
export function trackTimers(): void {
  if (installed) return;
  installed = true;
  const g = globalThis as unknown as Record<string, (...args: unknown[]) => unknown>;
  const realTimeout = g.setTimeout!.bind(globalThis);
  const realInterval = g.setInterval!.bind(globalThis);
  const realClearTimeout = g.clearTimeout!.bind(globalThis);
  const realClearInterval = g.clearInterval!.bind(globalThis);
  g.setTimeout = (fn: unknown, ms?: unknown, ...rest: unknown[]) => {
    const site = siteOf();
    let handle: unknown;
    const run = (...args: unknown[]): void => {
      live.delete(keyOf(handle));
      (fn as (...a: unknown[]) => void)(...args);
    };
    handle = realTimeout(run, ms, ...rest);
    live.set(keyOf(handle), { kind: 'timeout', ms: Number(ms ?? 0), site, at: Date.now() });
    return handle;
  };
  g.setInterval = (fn: unknown, ms?: unknown, ...rest: unknown[]) => {
    const handle = realInterval(fn, ms, ...rest);
    live.set(keyOf(handle), { kind: 'interval', ms: Number(ms ?? 0), site: siteOf(), at: Date.now() });
    return handle;
  };
  g.clearTimeout = (handle: unknown) => {
    live.delete(keyOf(handle));
    return realClearTimeout(handle);
  };
  g.clearInterval = (handle: unknown) => {
    live.delete(keyOf(handle));
    return realClearInterval(handle);
  };
}

/** The live timers (empty until {@link trackTimers} ran). */
export function liveTimers(): LiveTimer[] {
  const now = Date.now();
  return [...live.values()].map(({ at, ...timer }) => ({ ...timer, ageMs: now - at }));
}
