/**
 * The Shell's capability broker: runs the page's `window.openartifact`
 * calls (`cap_*` in `@open-artifact/protocol`'s `shell.ts`) against the
 * page's backend, the way the frame shell brokers `window.openartifact`.
 *
 * The backend is the page's own type server API, reached from the Shell
 * with `createLocalProvider({base})`; the base comes with the page's
 * `cap_want` and is used only when it is on the page frame's origin (the
 * type server lets the Shell's origin in because the daemon named it when
 * it opened the page). One backend, and one event stream, per page base.
 *
 * What the Shell adds over a page calling its backend itself:
 *
 * - only the methods in `BROKERED_METHODS` run; anything else is refused;
 * - `agent.send` starts an agent turn only behind a click in the page
 *   (`MessageEvent.userActivation`, where the browser reports it); without
 *   one the request is staged instead;
 * - slow calls are acked (`cap_ack`) so the page waits for them;
 * - every call carries the generation it was sent under: after a rewire the
 *   page cuts its pending calls (`cap_rewired`) and the Shell refuses calls
 *   from the old generation (`STALE_MESSAGE`).
 */

import { CAP_NAME, CAP_PROTOCOL, STALE_MESSAGE, type CapError, type CapToPage, type CapToShell } from '@open-artifact/protocol';
import {
  BROKERED_EVENTS,
  BROKERED_METHODS,
  createLocalProvider,
  isArtifactError,
  type AgentDelivery,
  type CapabilityName,
  type CapabilityProvider,
} from '@open-artifact/runtime';
import { cloudProvider, type CloudPolicy } from './cloud-provider.ts';

/** Where answers go: the page's window at its origin. */
export type PagePost = (message: CapToPage, transfer?: Transferable[]) => void;

interface Backend {
  base: string;
  provider: CapabilityProvider;
  namespaces: Map<string, Promise<Record<string, unknown> | null>>;
  /** Event subscriptions to end when the backend goes. */
  stops: Array<() => void>;
  /** Capabilities granted under this backend. */
  granted: Set<string>;
}

/** Methods that may take long: acked at once so the page uses the long deadline. */
const SLOW = new Set(['artifact.publish', 'assets.upload', 'downloads.save', 'agent.send', 'db.write', 'comments.sendToAgent', 'history.restore', 'doc.call', 'doc.restore', 'doc.importFile', 'doc.exportFile']);

let gen = 0;
let backend: Backend | null = null;
/** Told where `downloads.save` put a file, when the page's server said (`savedTo`). */
let onSavedFile: ((path: string) => void) | null = null;

/** Listens for files the page's server saved (`downloads.save` → `savedTo`); `null` stops. */
export function setSavedFileListener(listener: ((path: string) => void) | null): void {
  onSavedFile = listener;
}
/** Creates the backend for a page base; replaced in tests. */
let makeProvider = (base: string): CapabilityProvider => createLocalProvider({ base });
/** Set when a cloud host serves the Shell: each backend is wrapped by {@link cloudProvider}. */
let cloudPolicy: CloudPolicy | null = null;

/**
 * Cloud mode (`policy`) or not (`null`): downloads save in the browser and `mcp` is not offered. Takes effect for the
 * next backend; set it before the page asks for anything.
 */
export function setCloudPolicy(policy: CloudPolicy | null): void {
  cloudPolicy = policy;
}

/** The current broker generation. */
export function brokerGen(): number {
  return gen;
}

/** Tests: use another backend factory and start over. */
export function resetBroker(factory?: (base: string) => CapabilityProvider): void {
  for (const stop of backend?.stops ?? []) stop();
  backend = null;
  gen = 0;
  cloudPolicy = null;
  if (factory) makeProvider = factory;
}

/**
 * Rewires the broker: a new generation, so calls the page sent before it
 * are cut on the page and refused here. With `post`, tells the page (and
 * which capabilities are still served).
 */
export function rewire(post?: PagePost, caps?: string[]): number {
  gen += 1;
  post?.({ openArtifact: 'cap_rewired', gen, ...(caps ? { caps } : {}) });
  return gen;
}

function toCapError(error: unknown): CapError {
  if (isArtifactError(error)) {
    const paths = (error as { paths?: unknown[] }).paths;
    return { code: error.code, message: error.message, ...(paths ? { paths } : {}), ...(error.retryable ? { retryable: true } : {}) };
  }
  return { code: 'unavailable', message: error instanceof Error ? error.message : String(error) };
}

/** The backend for `base`, made (and the old one dropped) when the base changes. */
function backendFor(base: string, post: PagePost): Backend {
  if (backend?.base === base) return backend;
  const previous = backend;
  for (const stop of previous?.stops ?? []) stop();
  const provider = makeProvider(base);
  backend = { base, provider: cloudPolicy ? cloudProvider(provider, cloudPolicy) : provider, namespaces: new Map(), stops: [], granted: new Set() };
  // A page that was already wired to another backend: its pending calls
  // went to the old one and will not be answered.
  if (previous?.granted.size) rewire(post, []);
  return backend;
}

function namespaceOf(target: Backend, cap: CapabilityName): Promise<Record<string, unknown> | null> {
  let found = target.namespaces.get(cap);
  if (!found) {
    found = Promise.resolve()
      .then(() => target.provider.get(cap))
      .then((ns) => (ns ? (ns as unknown as Record<string, unknown>) : null))
      .catch(() => null);
    target.namespaces.set(cap, found);
  }
  return found;
}

/** Forwards a granted capability's events to the page, once per backend. */
function follow(target: Backend, cap: CapabilityName, ns: Record<string, unknown>, post: PagePost): void {
  if (target.granted.has(cap)) return;
  target.granted.add(cap);
  // Each listener method (`onChange`, `onPeers`, `onMessage`…) feeds one `cap_ev` event.
  const events = (BROKERED_EVENTS as Partial<Record<CapabilityName, Readonly<Record<string, string>>>>)[cap] ?? {};
  for (const [method, event] of Object.entries(events)) {
    const subscribe = ns[method];
    if (typeof subscribe !== 'function') continue;
    const stop = (subscribe as (listener: (data: unknown) => void) => () => void).call(ns, (data) => {
      if (backend === target) post({ openArtifact: 'cap_ev', cap, event, data });
    });
    target.stops.push(stop);
  }
}

/** `cap_want`: grants the capability (with its config) or says no. */
export async function want(message: Extract<CapToShell, { openArtifact: 'cap_want' }>, pageOrigin: string, post: PagePost): Promise<void> {
  const cap = message.cap;
  const no = (): void => post({ openArtifact: 'cap_grant', cap: String(cap), ok: false, gen });
  if (typeof cap !== 'string' || !CAP_NAME.test(cap) || !Object.hasOwn(BROKERED_METHODS, cap)) return no();
  if (message.protocol !== CAP_PROTOCOL || typeof message.base !== 'string') return no();
  let base: URL;
  try {
    base = new URL(message.base);
  } catch {
    return no();
  }
  // The page may only point the Shell at its own origin.
  if (base.origin !== pageOrigin || !/^https?:$/.test(base.protocol)) return no();
  base.hash = '';
  base.search = '';
  const target = backendFor(base.toString(), post);
  const ns = await namespaceOf(target, cap as CapabilityName);
  if (!ns) return no();
  const config: Record<string, unknown> = {};
  if (cap === 'artifact') config.id = ns.id;
  // A host that saves in the browser (cloud-provider.ts) says so: the page then sends its files here for every role.
  if (cap === 'downloads' && ns.browser === true) config.browser = true;
  if (cap === 'user') {
    try {
      config.me = await (ns.me as () => Promise<unknown>)();
    } catch {
      // `me` is then asked for again by the page.
    }
  }
  follow(target, cap as CapabilityName, ns, post);
  post({ openArtifact: 'cap_grant', cap, ok: true, gen, config });
}

/** Whether the browser reported no click behind the message (unknown counts as a click). */
function withoutActivation(event: MessageEvent | null): boolean {
  const activation = (event as (MessageEvent & { userActivation?: { isActive?: boolean } }) | null)?.userActivation;
  return !!activation && activation.isActive === false;
}

/** `cap`: runs one call and answers with `cap_r`. */
export async function call(message: Extract<CapToShell, { openArtifact: 'cap' }>, event: MessageEvent | null, post: PagePost): Promise<void> {
  const { id, cap, method } = message;
  if (typeof id !== 'string' || !id) return;
  const fail = (error: CapError): void => post({ openArtifact: 'cap_r', id, error });
  if (message.gen !== gen) {
    // A missing user resolves to null rather than an error.
    if (cap === 'user') return post({ openArtifact: 'cap_r', id, result: null });
    return fail({ code: 'unavailable', message: STALE_MESSAGE });
  }
  const methods = Object.hasOwn(BROKERED_METHODS, cap) ? BROKERED_METHODS[cap as CapabilityName] : null;
  if (!methods || typeof method !== 'string' || !methods.includes(method)) return fail({ code: 'invalid', message: `unknown method ${String(cap)}.${String(method)}` });
  const target = backend;
  if (!target?.granted.has(cap)) return fail({ code: 'not_granted', message: `${cap} was not granted to this page.` });
  const ns = await namespaceOf(target, cap as CapabilityName);
  const fn = ns?.[method];
  if (typeof fn !== 'function') return fail({ code: 'not_granted', message: `${cap} is not available here.` });
  let args = Array.isArray(message.args) ? [...message.args] : [];
  if (cap === 'agent' && method === 'send' && withoutActivation(event)) {
    // No click behind it: put the request in the composer, never start a turn.
    const opts = (args[1] && typeof args[1] === 'object' ? args[1] : {}) as { deliver?: AgentDelivery };
    args = [args[0], { ...opts, deliver: 'stage' satisfies AgentDelivery }];
  }
  if (SLOW.has(`${cap}.${method}`)) post({ openArtifact: 'cap_ack', id });
  try {
    const result: unknown = await (fn as (...a: unknown[]) => unknown).apply(ns, args);
    if (backend !== target || message.gen !== gen) return fail({ code: 'unavailable', message: STALE_MESSAGE });
    const transfer = result instanceof Uint8Array && result.byteOffset === 0 && result.byteLength === result.buffer.byteLength && result.buffer instanceof ArrayBuffer ? [result.buffer] : undefined;
    post({ openArtifact: 'cap_r', id, result }, transfer);
    if (cap === 'downloads' && method === 'save' && result && typeof (result as { savedTo?: unknown }).savedTo === 'string') {
      try {
        onSavedFile?.((result as { savedTo: string }).savedTo);
      } catch {
        // The listener's error is its own.
      }
    }
  } catch (error) {
    fail(toCapError(error));
  }
}
