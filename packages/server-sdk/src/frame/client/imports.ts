/** ES module served on the page origin. All grants and operations belong to the injected frame runtime. */
import type { FramePageRuntime, PageImportOptions, PageReference } from '../page-api.ts';

type Namespace = Readonly<Record<string, unknown>>;
interface Reference { namespace: Namespace; ready: Promise<void> }

const references = new Map<string, Reference>();
const reserved = new Set(['then', 'toJSON', 'constructor', '__proto__', 'prototype']);
const reservedNames = new Set(['constructor', 'prototype', 'use', 'contract']);
const listenerErrorArgument: Record<string, number> = {
  'room.on': 2, 'room.onPeers': 1, 'room.onConnection': 1, 'room.onFollow': 1, 'comments.onSendToAgent': 1,
};
const namePattern = /^[a-z][a-z0-9]{0,23}$/;
const blocked = (name: string) => Object.assign(new Error(`This page does not have the ${name} capability.`), { code: 'not_granted' });

function reference(name: string, options?: PageImportOptions): Reference {
  if (typeof name !== 'string' || !namePattern.test(name) || reservedNames.has(name)) throw new TypeError('A capability name must be a lowercase identifier.');
  const frame = (globalThis as typeof globalThis & { openArtifact?: FramePageRuntime }).openArtifact;
  if (options?.contract !== undefined && options.contract !== frame?.contract) {
    throw new RangeError(`This frame does not serve contract ${options.contract}.`);
  }
  const key = name === 'self' ? 'artifact' : name;
  const existing = references.get(key);
  if (existing) return existing;

  // The injected runtime exposes only this page's initial grants as own namespace objects.
  // Its builder and subscription methods can be used synchronously, including before the handshake.
  const initial = frame && Object.hasOwn(frame, key) ? Reflect.get(frame, key) as unknown : null;
  let current: Namespace | null = typeof initial === 'object' && initial !== null ? initial as Namespace : null;
  const ready = frame ? frame.use(key).then(granted => { current = granted; }) : Promise.resolve();
  let pending = 0;
  const invoke = async (member: string, args: unknown[], enabled = () => true): Promise<unknown> => {
    if (pending >= 256) throw Object.assign(new Error('Too many capability calls are waiting for the frame.'), { code: 'queue_overflow' });
    pending++;
    try {
      const captured = args.map(value => {
        try { return structuredClone(value); } catch { return value; }
      });
      await ready;
      if (!enabled()) return;
      if (!current) throw blocked(key);
      const method = current[member];
      if (typeof method !== 'function') throw new TypeError(`${key}.${member} is not a method.`);
      return Reflect.apply(method, current, captured);
    } finally { pending--; }
  };

  const target: Namespace = Object.create(null);
  const namespace = new Proxy(target, {
    get(_target, member) {
      if (typeof member !== 'string' || reserved.has(member)) return undefined;
      if (member === 'available') return current !== null;
      if (current) return current[member];
      const listener = `${key}.${member}`;
      if (Object.hasOwn(listenerErrorArgument, listener)) {
        return (...args: unknown[]) => {
          let cancelled = false;
          let stop: (() => void) | undefined;
          void invoke(member, args, () => !cancelled).then(result => {
            if (typeof result !== 'function') return;
            if (cancelled) result(); else stop = () => result();
          }, error => {
            if (cancelled) return;
            const handler = args[listenerErrorArgument[listener]!];
            if (typeof handler === 'function') handler(error); else globalThis.reportError(error);
          });
          return () => { cancelled = true; stop?.(); stop = undefined; };
        };
      }
      return (...args: unknown[]) => invoke(member, args);
    },
    has(_target, member) {
      return member === 'available' || (typeof member === 'string' && !reserved.has(member) && !!current && Object.hasOwn(current, member));
    },
    ownKeys() {
      return ['available', ...Object.keys(current ?? {}).filter(key => key !== 'available' && !reserved.has(key))];
    },
    getOwnPropertyDescriptor(_target, member) {
      if (member === 'available') return { configurable: true, enumerable: false, writable: false, value: current !== null };
      if (!current || typeof member !== 'string' || reserved.has(member) || !Object.hasOwn(current, member)) return undefined;
      return { configurable: true, enumerable: true, writable: false, value: current[member] };
    },
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
    setPrototypeOf: () => false,
    preventExtensions: () => false,
  });
  const slot = { namespace, ready };
  references.set(key, slot);
  return slot;
}

/** A stable capability reference, usable synchronously for granted builders and listeners. */
export function at<Name extends string>(name: Name, options?: PageImportOptions): PageReference<Name>;
export function at(name: string, options?: PageImportOptions): object {
  return reference(name, options).namespace;
}

/** Wait for the frame handshake and return the same reference that at() provides. */
export default function use<Name extends string>(name: Name, options?: PageImportOptions): Promise<PageReference<Name>>;
export default async function use(name: string, options?: PageImportOptions): Promise<object> {
  const slot = reference(name, options);
  await slot.ready;
  return slot.namespace;
}
