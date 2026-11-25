/**
 * Frame Runtime of frame-host. Loaded first in an original page's <head>, on
 * the page's own origin. It defines `window.openArtifact` (and `window.claude`, the
 * same object): `use(name)` and the granted capabilities. Every call is a `__frame_cap` postMessage to the inner
 * shell (the parent frame, whose origin the server wrote into
 * `window.__OPEN_ARTIFACT_FRAME`); the shell carries it to the local backend and
 * answers. Nothing here talks to the network by itself.
 *
 * Follows the frame runtime where a page can tell: the call envelope
 * and ids, `{code, message}` errors, per-capability timeouts and what they
 * do, acks (900 s once acked), `__frame_cap_rewired` with brokerGen, lazy
 * `__frame_cap_want` / `__frame_cap_grant`, the `user` config answered
 * locally. Deviations are marked "Here:".
 *
 * A plain script: types are imported, nothing else, so Node can serve it from
 * source with its types stripped, and esbuild builds it as one IIFE.
 */

import type { FrameComments, FrameAnchorCallbacks, PageElementAnchor, PagePoint, PageThreadPin, PageCommentListener, PageCommentSend, PageCommentThread, PageAnchorController } from '../page-comments.ts';
import type {
  FrameServices, PageArtifactInfo, PageFileWrite, PagePermissionState, PagePerson,
  PageRoom, PageRoomMessageListener, PageRoomPeer, PageRoomSender, PageSendStatus,
} from '../page-services.ts';
import type { BlobInfo, BlobList, FileEntry, FrameLevel, Json, PublishResult } from '../page-values.ts';
import type {
  FrameCollectionRef, FrameDatabase, FrameDbError, FrameDbValue, FrameDocument, FrameDocumentChange,
  FrameDocRef, FrameDocSnapshot, FrameLease, FrameQuery, FrameQuerySnapshot, FrameSnapshotListener, FrameWhereOp,
} from '../page-db.ts';
import type { FrameBoot, Peer } from '../wire.ts';
import type { FramePageRuntime, PageCapabilities, PageNamespace } from '../page-api.ts';

(() => {
  'use strict';
  const w = window as Window & { __OPEN_ARTIFACT_FRAME?: FrameBoot; openArtifact?: FramePageRuntime & { __openArtifactFrame?: boolean } };
  function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object';
  }
  if (w.openArtifact && w.openArtifact.__openArtifactFrame) return;

  const boot: Partial<FrameBoot> = w.__OPEN_ARTIFACT_FRAME || {};
  const SHELL = boot.shellOrigin || '';
  const parentWin = window.parent;
  const framed = !!SHELL && !!parentWin && parentWin !== window;
  const INIT_TIMEOUT_MS = 10_000;
  const WANT_TIMEOUT_MS = 10_000;
  const ACKED_MS = 900_000;
  const BUDGET_MAX_MS = 600_000;
  const REWIRED_MESSAGE = 'may not have run: the artifact was updated before this call was answered';
  const grants: string[] = Array.isArray(boot.grants) ? boot.grants.slice() : [];
  const stubs: string[] = Array.isArray(boot.stubs) ? boot.stubs.slice() : [];

  
  const TIMEOUTS: Record<string, [number, string | null, number]> = {
    downloads: [150_000, 'unavailable', 0],
    assets: [130_000, 'upstream_error', ACKED_MS],
    user: [20_000, null, 0],
    artifact: [130_000, 'upstream_error', 0],
    comments: [130_000, 'upstream_error', ACKED_MS],
    permissions: [130_000, 'upstream_error', ACKED_MS],
    room: [130_000, 'upstream_error', 0],
    db: [130_000, 'unavailable', 0],
  };
  
  const PREFIX: Record<string, string> = { downloads: 'd', assets: 'e', permissions: 'p', user: 'u', artifact: 's', room: 'r', comments: 'k', db: 'b' };
  /** Calls sent with the user's activation. */
  const ACTIVATED: Record<string, true> = { 'permissions.request': true, 'room.sendToAgentSession': true };

  interface Pending {
    cap: string;
    method: string;
    resolve(v: unknown): void;
    reject(e: unknown): void;
    timer: ReturnType<typeof setTimeout> | null;
  }

  let seq = 0;
  const salt = new Uint32Array(1);
  const pending = new Map<string, Pending>();
  interface PageSession {
    client?: string;
    grants: Set<string>;
    capBudgets: Record<string, unknown>;
    usable: string[];
    capWants: boolean;
  }
  let init: PageSession | null = null;
  let initDone = false;
  let initWaiters: ((v: PageSession | null) => void)[] = [];
  /** The broker generation this page knows (from init, a grant or a rewire). */
  let brokerGen: number | undefined;
  const configs: Record<string, Record<string, unknown>> = Object.create(null);

  function post(msg: unknown, activation = false): void {
    if (!framed) return;
    try {
      // includeUserActivation: Chromium's, ignored elsewhere.
      if (activation) parentWin.postMessage(msg, { targetOrigin: SHELL, includeUserActivation: true } as WindowPostMessageOptions);
      else parentWin.postMessage(msg, SHELL);
    } catch {
      // the shell went away
    }
  }

  function frameError(code: unknown, message: unknown, extra?: unknown, name?: string): Error & { code: string } {
    const err = Object.assign(new Error(typeof message === 'string' && message ? message : String(code || 'error')), {
      name: name || 'FrameError',
      code: typeof code === 'string' && code ? code : 'upstream_error',
    });
    if (isRecord(extra)) for (const k of Object.keys(extra)) {
      if (k !== 'message' && k !== 'name' && k !== 'stack' && k !== 'code') Reflect.set(err, k, extra[k]);
    }
    return err;
  }

  function whenInit(): Promise<PageSession | null> {
    if (initDone) return Promise.resolve(init);
    return new Promise((resolve) => initWaiters.push(resolve));
  }

  function finishInit(packet: Record<string, unknown> | null): void {
    if (initDone) return;
    initDone = true;
    if (packet) {
      if (typeof packet.brokerGen === 'number') brokerGen = packet.brokerGen;
      const grants = new Set<string>();
      if (isRecord(packet.capabilities)) {
        for (const [name, grant] of Object.entries(packet.capabilities)) {
          if (!grant) continue;
          grants.add(name);
          configs[name] = isRecord(grant) && isRecord(grant.config) ? grant.config : {};
        }
      }
      init = {
        client: typeof packet.client === 'string' ? packet.client : undefined, grants,
        usable: Array.isArray(packet.usable) ? packet.usable.filter((name: unknown): name is string => typeof name === 'string') : [],
        capBudgets: isRecord(packet.capBudgets) ? packet.capBudgets : {}, capWants: packet.capWants === true,
      };
    }
    const list = initWaiters;
    initWaiters = [];
    for (const fn of list) fn(init);
  }

  function timeoutOf(cap: string, method: string): [number, string | null] {
    const t = TIMEOUTS[cap] || [130_000, 'upstream_error', 0];
    const methods = init?.capBudgets[cap];
    const budget = isRecord(methods) ? methods[method] : undefined;
    if (typeof budget === 'number' && budget > 0) return [Math.min(budget, BUDGET_MAX_MS) + 2000, t[1]];
    return [t[0], t[1]];
  }

  function arm(id: string, p: Pending, ms: number, code: string | null): void {
    if (p.timer) clearTimeout(p.timer);
    p.timer = setTimeout(() => {
      if (!pending.delete(id)) return;
      if (code === null) p.resolve(null);
      else p.reject({ code, message: `${p.cap}.${p.method} did not answer in time.` });
    }, ms);
  }

  function call<Result = unknown>(cap: string, method: string, arg: unknown, errorName?: string, transfer?: Transferable[]): Promise<Result> {
    if (!framed) return Promise.reject(frameError('unavailable', 'This page is not inside its frame shell.', null, errorName));
    return new Promise((resolve, reject) => {
      crypto.getRandomValues(salt);
      const id = `${PREFIX[cap] || 'x'}${salt[0]!.toString(36)}.${++seq}`;
      const p: Pending = {
        cap,
        method,
        resolve: (v) => {
          if (p.timer) clearTimeout(p.timer);
          resolve(v as Result);
        },
        reject: (reason: unknown) => {
          const e = isRecord(reason) ? reason : undefined;
          if (p.timer) clearTimeout(p.timer);
          if (boot.debug) post({ __open_artifact_console: true, level: 'warn', text: `${cap}.${method} → ${(e && e.code) || 'error'}: ${(e && e.message) || ''}` });
          reject(frameError(e && e.code, e && e.message, e, errorName));
        },
        timer: null,
      };
      pending.set(id, p);
      const [ms, code] = timeoutOf(cap, method);
      arm(id, p, ms, code);
      const msg: Record<string, unknown> = { __frame_cap: true, cap, id, method, args: [arg] };
      if (brokerGen !== undefined) msg.brokerGen = brokerGen;
      if (cap === 'assets') msg.holds = true;
      const activation = cap === 'comments' || ACTIVATED[`${cap}.${method}`] === true;
      try {
        if (transfer && transfer.length) parentWin.postMessage(msg, { targetOrigin: SHELL, transfer });
        else if (activation) parentWin.postMessage(msg, { targetOrigin: SHELL, includeUserActivation: true } as WindowPostMessageOptions);
        else parentWin.postMessage(msg, SHELL);
      } catch (e) {
        pending.delete(id);
        p.reject({ code: 'invalid_argument', message: String((e as Error)?.message || e) });
      }
    });
  }

  // ---- messages from the shell ------------------------------------------------------------------------------------

  const dbSubs = new Map<string, { deliver(d: Record<string, unknown>): void; resubscribe(): void; revoke(): void }>();
  const roomHandlers = new Map<string, Set<PageRoomMessageListener>>();
  const peerHandlers = new Set<(peers: PageRoomPeer[]) => void>();
  const connHandlers = new Set<(connected: boolean) => void>();
  const wants = new Map<string, (grant: Record<string, unknown>) => void>();
  let anchors: { callbacks: FrameAnchorCallbacks } | null = null;
  let commentsMode = false;

  window.addEventListener('message', (ev: MessageEvent<unknown>) => {
    if (ev.source !== parentWin || ev.origin !== SHELL) return;
    const d = ev.data;
    if (!isRecord(d)) return;
    if (isRecord(d.__frame_init)) return finishInit(d.__frame_init);
    if (d.__frame_cap_r === true) {
      if (typeof d.id !== 'string') return;
      const p = pending.get(d.id);
      if (!p) return;
      pending.delete(d.id);
      if (d.error != null) p.reject(d.error);
      else p.resolve(d.result);
      return;
    }
    if (d.__frame_cap_ack === true) {
      if (typeof d.id !== 'string') return;
      const p = pending.get(d.id);
      const t = p && TIMEOUTS[p.cap];
      if (p && t && t[2]) arm(d.id, p, t[2], t[1]);
      return;
    }
    if (d.__frame_cap_rewired === true) return onRewired(d);
    if (d.__frame_cap_grant === true) {
      if (typeof d.cap !== 'string') return;
      const fn = wants.get(d.cap === 'self' ? 'artifact' : d.cap);
      if (fn) fn(d);
      return;
    }
    if (d.__frame_db_ev === true) {
      if (typeof d.sub !== 'string') return;
      const sub = dbSubs.get(d.sub);
      if (sub) sub.deliver(d);
      return;
    }
    if (d.__frame_room_ev === true) return onRoomEvent(d);
    if (d.__open_artifact_comments === true) onCommentsEvent(d);
  });

  
  function onRewired(d: Record<string, unknown>): void {
    const changed = typeof d.brokerGen === 'number' && brokerGen !== undefined && d.brokerGen !== brokerGen;
    if (typeof d.brokerGen === 'number') brokerGen = d.brokerGen;
    const caps: string[] | null = Array.isArray(d.caps) && d.caps.every((c: unknown) => typeof c === 'string') ? d.caps : null;
    const gone = (cap: string): boolean => !!caps && caps.indexOf(cap) < 0 && !(cap === 'artifact' && caps.indexOf('self') >= 0);
    for (const [id, p] of [...pending]) {
      if (gone(p.cap) && p.cap === 'db') {
        pending.delete(id);
        p.reject({ code: 'revoked', message: 'The document store is no longer available to this artifact.' });
      } else if (changed) {
        pending.delete(id);
        if (p.cap === 'user') p.resolve(null);
        else p.reject({ code: p.cap === 'db' || p.cap === 'downloads' ? 'unavailable' : 'upstream_error', message: REWIRED_MESSAGE });
      }
    }
    // A listener may subscribe again from its error callback. Only retire the watches in this update.
    if (gone('db')) for (const s of [...dbSubs.values()]) s.revoke();
    else if (changed) for (const s of dbSubs.values()) s.resubscribe();
    if (gone('room')) {
      connected = false;
      for (const fn of connHandlers) safely(fn, false);
    }
  }

  function connect(): void {
    if (!framed) return finishInit(null);
    let tries = 0;
    // Here: `__frame_connect` repeats every 400 ms.
    const tick = (): void => {
      if (initDone) return;
      post({ __frame_connect: true, contract: boot.contract, key: boot.key });
      if (++tries * 400 < INIT_TIMEOUT_MS) setTimeout(tick, 400);
      else finishInit(null);
    };
    tick();
  }

  function safely<Args extends unknown[]>(fn: (...args: Args) => unknown, ...args: Args): void {
    try {
      fn(...args);
    } catch (e) {
      setTimeout(() => {
        throw e;
      });
    }
  }

  // ---- db -----------------------------------------------------------------------------------------------------------
  // Here: the db wire is this host's own (one object argument; subscriptions re-run by the shell, delivered as
  

  const SEG = /^[A-Za-z0-9_\-.~:@+]+$/;
  const enc = new TextEncoder();
  function segsOf(path: unknown, kind: 'doc' | 'collection'): string[] {
    if (typeof path !== 'string') throw new TypeError('A db path is a string.');
    const t = path;
    if (!t) throw new TypeError('An empty db path.');
    if (enc.encode(t).length > 1000) throw new TypeError('A db path is at most 1000 bytes.');
    const segs = t.split('/');
    if (segs.length > 16) throw new TypeError('A db path has at most 16 segments.');
    for (const s of segs) {
      if (!SEG.test(s) || s === '.' || s === '..' || enc.encode(s).length > 200) throw new TypeError(`Bad db path segment ${JSON.stringify(s)}.`);
    }
    if (kind === 'doc' && segs.length % 2 !== 0) throw new TypeError(`${t} names a collection, not a document.`);
    if (kind === 'collection' && segs.length % 2 !== 1) throw new TypeError(`${t} names a document, not a collection.`);
    return segs;
  }
  const clone = <T>(value: T): T => value === undefined ? value : JSON.parse(JSON.stringify(value)) as T;

  function fieldOf(data: FrameDocument | undefined, field: string): FrameDbValue | undefined {
    let value: FrameDbValue | undefined = data;
    for (const key of String(field).split('.')) {
      if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
      value = (value as FrameDocument)[key];
    }
    return value;
  }

  const META = Object.freeze({ fromCache: false, hasPendingWrites: false });

  function freezeData<T extends FrameDbValue | undefined>(value: T): T {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      for (const child of Object.values<FrameDbValue>(value)) freezeData(child);
      Object.freeze(value);
    }
    return value;
  }

  function sameData(left: unknown, right: unknown): boolean {
    if (left === right) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
      return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item: unknown, i) => sameData(item, right[i]));
    }
    if (!isRecord(left) || !isRecord(right)) return false;
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every((key) => Object.hasOwn(right, key) && sameData(left[key], right[key]));
  }

  function docSnap(ref: FrameDocRef, data: FrameDocument | undefined): FrameDocSnapshot {
    const value = freezeData(data);
    return Object.freeze({
      id: ref.id, ref, exists: data !== undefined, metadata: META,
      data: () => value,
      get: (field: string) => fieldOf(value, field),
    });
  }

  type DbRow = { id: string; data: FrameDocument };
  type DbRead = { exists: false } | { exists: true; data: FrameDocument };
  interface DbReply {
    get: DbRead;
    query: { docs: DbRow[] };
    add: { path: string };
    acquire: FrameLease;
    release: { released: boolean };
    set: unknown; update: unknown; delete: unknown; subscribe: unknown; unsubscribe: unknown;
  }
  const dbCall = <M extends keyof DbReply>(method: M, arg: unknown): Promise<DbReply[M]> =>
    call<DbReply[M]>('db', method, arg, 'DbError');

  function observer<T>(next: FrameSnapshotListener<T>, error?: (reason: FrameDbError) => void) {
    const handler = typeof next === 'function' ? next : next?.next?.bind(next);
    if (typeof handler !== 'function') throw new TypeError('onSnapshot needs a callback.');
    const onError = typeof next === 'object' ? next?.error?.bind(next) : error;
    return { next: handler, error: onError ?? ((reason: FrameDbError) => { throw reason; }) };
  }

  interface PageQuery {
    where?: { field: string; op: FrameWhereOp; value: FrameDbValue }[];
    orderBy?: { field: string; dir: 'asc' | 'desc' };
    limit?: number;
  }

  function subscribe(kind: 'doc' | 'query', path: string, spec: PageQuery | null, onData: (event: Record<string, unknown>) => void, onError: (reason: FrameDbError) => void): () => void {
    const id = `sub${++seq}`;
    let active = true;
    let generation = 0;
    const stop = (): void => {
      if (!active) return;
      active = false;
      if (dbSubs.delete(id)) dbCall('unsubscribe', { sub: id }).catch(() => {});
    };
    const fail = (error: FrameDbError): void => {
      if (!active) return;
      stop();
      safely(onError, error);
    };
    if (dbSubs.size >= 64) {
      queueMicrotask(() => fail(frameError('resource_exhausted', 'At most 64 db subscriptions.', null, 'DbError')));
      return stop;
    }
    const start = (): void => {
      const current = ++generation;
      dbCall('subscribe', { sub: id, kind, path, spec }).catch((error) => {
        if (current === generation) fail(error);
      });
    };
    dbSubs.set(id, {
      deliver: (event: Record<string, unknown>) => {
        if (event.error) {
          const reason = isRecord(event.error) ? event.error : {};
          fail(frameError(reason.code, reason.message, null, 'DbError'));
        } else onData(event);
      },
      resubscribe: start,
      revoke: () => fail(frameError('revoked', 'The document store is no longer available to this artifact.', null, 'DbError')),
    });
    start();
    return stop;
  }

  let holder: string | null = null;
  const holderId = (): string => (holder ||= `tab-${Math.random().toString(36).slice(2, 10)}`);

  function docRef(path: string): FrameDocRef {
    const segs = segsOf(path, 'doc');
    const full = segs.join('/');
    const ref: FrameDocRef = {
      id: segs[segs.length - 1],
      path: full,
      get parent() {
        return collectionRef(segs.slice(0, -1).join('/'));
      },
      collection: (sub: string) => collectionRef(`${full}/${sub}`),
      get: () => dbCall('get', { path: full }).then((r) => docSnap(ref, r && r.exists ? r.data : undefined)),
      set: (data) => dbCall('set', { path: full, data: clone(data) }).then(() => {}),
      update: (data) => dbCall('update', { path: full, data: clone(data) }).then(() => {}),
      delete: () => dbCall('delete', { path: full }).then(() => {}),
      acquire: (opts) => {
        const o = opts || {};
        return dbCall('acquire', { path: full, options: { holder: o.holder || holderId(), ttlMs: o.ttlMs === undefined ? 30000 : o.ttlMs, data: o.data } });
      },
      release: (h?: string) => dbCall('release', { path: full, holder: h || holderId() }),
      onSnapshot: (next, error) => {
        const o = observer(next, error);
        let previous: ReturnType<typeof docSnap> | undefined;
        return subscribe('doc', full, null, (d) => {
          const data = d.exists && isDocumentData(d.data) ? d.data : undefined;
          if (!previous || !sameData(previous.data(), data)) {
            previous = docSnap(ref, data);
            o.next(previous);
          }
        }, o.error);
      },
    };
    return ref;
  }

  // The store validates document contents before the shell sends these records.
  function isDocumentData(value: unknown): value is FrameDocument {
    return isRecord(value) && !Array.isArray(value);
  }
  function isDbRow(value: unknown): value is DbRow {
    return isRecord(value) && typeof value.id === 'string' && isDocumentData(value.data);
  }

  function querySnapshot(path: string, rows: readonly DbRow[], previous: readonly FrameDocSnapshot[] | null): FrameQuerySnapshot {
    const old = new Map(previous?.map((doc) => [doc.id, doc]));
    const next = Object.freeze(rows.map(({ id, data }) => {
      const doc = old.get(id);
      return doc && sameData(data, doc.data()) ? doc : docSnap(docRef(`${path}/${id}`), data);
    }));
    const retained = new Set(next.map((doc) => doc.id));
    const order = previous?.map((doc) => doc.id) ?? [];
    const changes: FrameDocumentChange[] = [];
    for (let i = order.length - 1; i >= 0; i--) {
      const id = order[i]!;
      if (retained.has(id)) continue;
      changes.push(Object.freeze({ type: 'removed', doc: old.get(id)!, oldIndex: i, newIndex: -1 }));
      order.splice(i, 1);
    }
    // Each index addresses the list after the preceding changes have been applied.
    next.forEach((doc, newIndex) => {
      const oldIndex = order[newIndex] === doc.id ? newIndex : order.indexOf(doc.id, newIndex);
      if (oldIndex === newIndex && old.get(doc.id) === doc) return;
      if (oldIndex >= 0) order.splice(oldIndex, 1);
      order.splice(newIndex, 0, doc.id);
      changes.push(Object.freeze({ type: oldIndex === -1 ? 'added' : 'modified', doc, oldIndex, newIndex }));
    });
    const frozenChanges = Object.freeze(changes);
    return Object.freeze<FrameQuerySnapshot>({
      docs: next, size: next.length, empty: next.length === 0, metadata: META,
      forEach: (fn, thisArg) => next.forEach(fn, thisArg),
      docChanges: () => frozenChanges,
    });
  }

  const OPS = ['==', '!=', '<', '<=', '>', '>=', 'in', 'not-in', 'array-contains'];
  function query(path: string, spec: PageQuery): FrameQuery {
    return {
      where: (field, op, value) => {
        if (OPS.indexOf(op) < 0) throw new TypeError(`where(): unknown operator ${op}`);
        return query(path, { ...spec, where: (spec.where || []).concat([{ field: String(field), op, value: clone(value) }]) });
      },
      orderBy: (field: string, dir?: string) => {
        if (spec.orderBy) throw new TypeError('One orderBy() per query.');
        return query(path, { ...spec, orderBy: { field: String(field), dir: dir === 'desc' ? 'desc' : 'asc' } });
      },
      limit: (n: number) => {
        if (!Number.isInteger(n) || n < 1 || n > 1000) throw new TypeError('limit() takes 1 to 1000.');
        return query(path, { ...spec, limit: n });
      },
      get: () => dbCall('query', { path, spec }).then((r) => querySnapshot(path, (r && r.docs) || [], null)),
      onSnapshot: (next, error) => {
        const o = observer(next, error);
        let prev: readonly FrameDocSnapshot[] | null = null;
        return subscribe(
          'query',
          path,
          spec,
          (d) => {
            const docs = d.docs || [];
            if (!Array.isArray(docs) || !docs.every(isDbRow)) return;
            const snap = querySnapshot(path, docs, prev);
            const first = prev === null;
            prev = snap.docs;
            if (first || snap.docChanges().length) o.next(snap);
          },
          o.error,
        );
      },
    };
  }

  function collectionRef(path: string): FrameCollectionRef {
    const segs = segsOf(path, 'collection');
    const full = segs.join('/');
    const collection = Object.assign(query(full, {}), { id: segs[segs.length - 1]!, path: full });
    const withParent = Object.defineProperty(
      collection, 'parent', { get: () => (segs.length > 1 ? docRef(segs.slice(0, -1).join('/')) : null) },
    ) as typeof collection & Pick<FrameCollectionRef, 'parent'>;
    return Object.assign(withParent, {
      doc(id?: string) {
        const key = id === undefined ? Array.from(crypto.getRandomValues(new Uint8Array(20)), (byte) => (byte % 36).toString(36)).join('') : id;
        if (typeof key !== 'string' || !SEG.test(key)) throw new TypeError('A document id must be one path segment.');
        return docRef(`${full}/${key}`);
      },
      add: (data: FrameDocument) => dbCall('add', { path: full, data: clone(data) }).then((r) => docRef(r.path)),
    });
  }

  const network = {
    async origins(): Promise<string[]> {
      await whenInit();
      const origins = configs.network?.origins;
      return Array.isArray(origins) && origins.every((value) => typeof value === 'string') ? [...origins] : [];
    },
  };

  const db: FrameDatabase = {
    collection: (path: string) => collectionRef(path),
    doc: (path: string) => docRef(path),
  };

  // ---- artifact (self) ----------------------------------------------------------------------------------------------

  function bytesToB64(bytes: Uint8Array): string {
    let out = '';
    for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
    return btoa(out);
  }

  async function encodeContent(value: unknown): Promise<Record<string, unknown>> {
    if (typeof value === 'string') return { text: value };
    if (value instanceof Blob) return { b64: bytesToB64(new Uint8Array(await value.arrayBuffer())), ...(value.type ? { contentType: value.type } : {}) };
    if (value instanceof ArrayBuffer) return { b64: bytesToB64(new Uint8Array(value)) };
    if (ArrayBuffer.isView(value)) return { b64: bytesToB64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
    throw frameError('invalid_content', 'A file is a string, Blob or bytes.');
  }

  const isBytes = (v: unknown): v is Blob | ArrayBuffer | ArrayBufferView => v instanceof Blob || v instanceof ArrayBuffer || ArrayBuffer.isView(v);

  async function publish(files: string | Record<string, PageFileWrite>, opts?: { ifMatch?: Record<string, string | null> }): Promise<PublishResult> {
    // A whole document: in page mode it replaces the artifact's index.html while the files are still this view's
    // version (else conflict), and every view reloads. Here: for any other type index.html is the type's, and the
    // server answers read_only_path.
    if (typeof files === 'string') return call<PublishResult>('artifact', 'publish', { html: files, ver: pageVer });
    if (!files || typeof files !== 'object') throw frameError('invalid_content', 'publish() takes a map of files.');
    const guards = opts && opts.ifMatch && typeof opts.ifMatch === 'object' ? opts.ifMatch : null;
    const paths = Object.keys(files);
    if (paths.length < 1 || paths.length > 256) throw frameError('too_large', 'publish() takes 1 to 256 paths.');
    const out: Record<string, unknown> = {};
    for (const p of paths) {
      const v = files[p];
      const guard = guards && Object.prototype.hasOwnProperty.call(guards, p) ? { ifMatch: guards[p] } : {};
      if (v === null) out[p] = { delete: true, ...guard };
      else if (v && typeof v === 'object' && !isBytes(v)) {
        const g = 'ifMatch' in v ? { ifMatch: v.ifMatch } : guard;
        if ('delete' in v && v.delete === true) out[p] = { delete: true, ...g };
        else out[p] = { ...(await encodeContent('content' in v ? v.content : undefined)), ...('contentType' in v && v.contentType ? { contentType: v.contentType } : {}), ...g };
      } else out[p] = { ...(await encodeContent(v)), ...guard };
    }
    return call<PublishResult>('artifact', 'publish', { files: out });
  }

  const self: FrameServices['artifact'] = {
    get id() {
      const id = configs.artifact?.id;
      // The host puts the id in the boot object before exposing the page API.
      return typeof id === 'string' && id ? id : boot.id!;
    },
    publish,
    sync: () => call<{ version: string; files: Record<string, FileEntry> }>('artifact', 'sync', {}),
    metadata: refs => call<Record<string, PageArtifactInfo>>('artifact', 'metadata', { refs: Array.isArray(refs) ? refs : [refs] }),
    search: (q, o) => call<{ results: PageArtifactInfo[] }>('artifact', 'search', { q: String(q || ''), ...(o || {}) }),
    edit: () => Promise.reject(frameError('capability_disabled', 'edit() is for live documents; publish the files instead.')),
  };

  // ---- assets, downloads, permissions --------------------------------------------------------------------------------

  const assets: FrameServices['assets'] = {
    upload: (blob, opts) => {
      if (!(blob instanceof Blob)) return Promise.reject(frameError('invalid_request', 'upload() takes a Blob.'));
      return call<BlobInfo>('assets', 'upload', { blob, type: (opts && opts.type) || blob.type || '' });
    },
    list: () => call<BlobList>('assets', 'list', {}),
    delete: ref => call<{ deleted: boolean }>('assets', 'delete', { ref: typeof ref === 'object' && ref ? ref.id || ref.url : ref }),
  };

  
  // shell, which asks before saving.
  const downloads: FrameServices['downloads'] = {
    save: opts => {
      const o: Partial<typeof opts> = opts || {};
      const filename = String(o.filename || 'download').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').slice(0, 200) || 'download';
      const data = o.data;
      const blob: Blob = data instanceof Blob ? data : new Blob([typeof data === 'string' || data instanceof ArrayBuffer || ArrayBuffer.isView(data) ? (data as BlobPart) : JSON.stringify(data)]);
      try {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.rel = 'noopener';
        a.style.display = 'none';
        (document.body || document.documentElement).appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        if (typeof o.request === 'string') post({ __open_artifact_export_done: true, request: o.request });
        return Promise.resolve({ status: 'saved' });
      } catch (e) {
        return Promise.reject(frameError('unavailable', String((e as Error)?.message || e)));
      }
    },
  };

  // Here: answered in the page; the person on this computer holds every capability the type declared.
  function permissionState(name: string): Promise<PagePermissionState> {
    if (grants.indexOf(name === 'self' ? 'artifact' : name) >= 0) return Promise.resolve('granted');
    const perms = navigator.permissions;
    if (perms && typeof perms.query === 'function') {
      return perms.query({ name } as PermissionDescriptor).then(
        (s) => s.state,
        () => 'unavailable',
      );
    }
    return Promise.resolve('unavailable');
  }
  async function permissionMap(list: readonly string[]): Promise<Record<string, PagePermissionState>> {
    const out: Record<string, PagePermissionState> = {};
    await Promise.all(list.map(async (n) => (out[String(n)] = await permissionState(String(n)))));
    return out;
  }
  function stateOfPermissions(): Promise<Record<string, PagePermissionState>>;
  function stateOfPermissions(name: string): Promise<PagePermissionState>;
  function stateOfPermissions(name?: string): Promise<PagePermissionState | Record<string, PagePermissionState>>;
  function stateOfPermissions(name?: string) {
    return name === undefined ? permissionMap(grants) : permissionState(String(name));
  }
  const permissions: FrameServices['permissions'] = {
    state: stateOfPermissions,
    request: names => permissionMap(names === undefined ? grants : Array.isArray(names) ? names : [names]),
    manage: () => Promise.resolve(),
  };

  // ---- user ----------------------------------------------------------------------------------------------------------
  // The grant's config supplies id, isOwner, canEdit, can and the colour; profile, email, profiles,
  // access and search go to the shell; every method swallows errors into a default.

  const FALLBACK_COLOR = '#c7c9d1';
  const userConfig = async (): Promise<Record<string, unknown>> => {
    await whenInit();
    return configs.user || {};
  };
  type Profile = Partial<Pick<PagePerson, 'name' | 'avatarUrl'>>;
  let profileCache: Promise<Profile | null> | null = null;
  const profile = (): Promise<Profile | null> =>
    (profileCache ||= userConfig().then((c) =>
      c.profile === true
        ? call<Profile | null>('user', 'profile', {}).catch(() => {
            profileCache = null;
            return {};
          })
        : {},
    ));
  const colorOf = (c: Record<string, unknown>): string => (typeof c.color === 'string' && /^#[0-9a-f]{6}$/.test(c.color) ? c.color : FALLBACK_COLOR);
  const user: FrameServices['user'] = {
    id: () => userConfig().then((c) => (typeof c.id === 'string' ? c.id : null)),
    isOwner: () => userConfig().then((c) => c.owner === true),
    canEdit: () => userConfig().then((c) => c.canEdit === true),
    // Here: with no `can` list, the owner can do anything; otherwise permissions are checked.
    can: (permission: unknown) =>
      userConfig().then((c) => (Array.isArray(c.can) ? typeof permission === 'string' && c.can.indexOf(permission) >= 0 : c.owner === true ? typeof permission === 'string' && permission.length > 0 : null)),
    me: () =>
      Promise.all([userConfig(), profile(), user.email()]).then(
        ([c, p, email]) => ({ id: typeof c.id === 'string' ? c.id : null, name: p?.name ?? '', avatarUrl: p?.avatarUrl ?? null, color: colorOf(c), email, isOwner: c.owner === true, canEdit: c.canEdit === true }),
        () => ({ id: null, name: '', avatarUrl: null, color: FALLBACK_COLOR, email: null, isOwner: false, canEdit: false }),
      ),
    name: () => profile().then((p) => p?.name ?? '', () => ''),
    avatarUrl: () => profile().then((p) => p?.avatarUrl ?? null, () => null),
    email: () => userConfig().then((c) => (c.email === true ? call<string | null>('user', 'email', {}) : null)).catch(() => null),
    profiles: (ids: unknown) => call<Record<string, PagePerson> | null>('user', 'profiles', { ids: Array.isArray(ids) ? ids : [ids] }).catch(() => ({})),
    access: (ids: unknown) => call<Record<string, FrameLevel | null> | null>('user', 'access', { ids: Array.isArray(ids) ? ids : [ids] }).catch(() => ({})),
    search: (q: unknown) => call<PagePerson[] | null>('user', 'search', { q: String(q || '') }).catch(() => []),
  };

  // ---- room ----------------------------------------------------------------------------------------------------------

  let peersNow: PageRoomPeer[] = [];
  let connected = false;

  function isRoomPeer(value: unknown): value is Peer {
    return isRecord(value) && typeof value.peer === 'string' && (value.by === null || typeof value.by === 'string') &&
      typeof value.name === 'string' && value.kind === 'user' && isRecord(value.presence);
  }

  function onRoomEvent(d: Record<string, unknown>): void {
    if (d.kind === 'msg') {
      if (typeof d.topic !== 'string' || typeof d.from !== 'string' || !(d.by === null || typeof d.by === 'string')) return;
      const listeners = roomHandlers.get(d.topic);
      if (!listeners) return;
      const mine = !!init && d.from === init.client;
      const sender: PageRoomSender = { peer: d.from, by: d.by, isMe: mine, sameTab: mine, kind: 'user', guest: false };
      // Room payloads reached the shell through the server's JSON event stream.
      for (const listener of listeners) safely(listener, clone(d.data) as Json, { ...sender });
    } else if (d.kind === 'peers') {
      const peers: unknown[] = Array.isArray(d.peers) ? d.peers : [];
      peersNow = peers.filter(isRoomPeer).map(peer => ({ ...peer, isMe: !!init && peer.peer === init.client }));
      for (const fn of peerHandlers) safely(fn, peersNow.slice());
    } else if (d.kind === 'connection') {
      connected = !!d.connected;
      for (const fn of connHandlers) safely(fn, connected);
    }
  }
  function makeRoom(prefix: string): PageRoom {
    const t = (topic: unknown): string => prefix + String(topic);
    return {
      emit: (topic, data) => call<Record<string, never>>('room', 'emit', { topic: t(topic), data: clone(data) }),
      on: (topic, handler: PageRoomMessageListener) => {
        const key = t(topic);
        if (!roomHandlers.has(key)) roomHandlers.set(key, new Set());
        roomHandlers.get(key)!.add(handler);
        return () => roomHandlers.get(key)?.delete(handler);
      },
      presence: patch => call<Record<string, never>>('room', 'presence', { patch: clone(patch || {}) }),
      peers: () => peersNow.slice(),
      onPeers: fn => {
        peerHandlers.add(fn);
        return () => peerHandlers.delete(fn);
      },
      connected: () => connected,
      onConnection: fn => {
        connHandlers.add(fn);
        return () => connHandlers.delete(fn);
      },
      sendToAgentSession: (data, opts) => {
        const o = opts || {};
        const report: (status: PageSendStatus) => void = typeof o.onStatus === 'function' ? o.onStatus : () => {};
        report('sending');
        return call<{ to: string }>('room', 'sendToAgentSession', { data: clone(data), deliver: o.deliver === 'stage' ? 'stage' : 'send' }).then(
          (r) => {
            report('sent');
            return r;
          },
          (e) => {
            report('failed');
            throw e;
          },
        );
      },
      canSendToAgentSession: () => call<boolean>('room', 'canSendToAgentSession', {}),
      join: (name: unknown) => makeRoom(`${prefix}${String(name)}/`),
    };
  }
  const room = makeRoom('');

  // ---- comments ------------------------------------------------------------------------------------------------------
  // Here: the composer, cards and list are the inner shell's; the page talks to them through `comments.*` calls and
  // `__open_artifact_comments` events rather than a side channel.

  function cssPath(start: Element | null): string {
    const parts: string[] = [];
    let el = start;
    while (el && el.nodeType === 1 && el !== document.documentElement && parts.length < 12) {
      if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) {
        parts.unshift(`#${el.id}`);
        break;
      }
      let i = 1;
      let sib = el.previousElementSibling;
      for (; sib; sib = sib.previousElementSibling) if (sib.tagName === el.tagName) i++;
      parts.unshift(`${el.tagName.toLowerCase()}:nth-of-type(${i})`);
      el = el.parentElement;
    }
    return parts.join(' > ');
  }
  function anchorFor(el: Element | null, ev?: MouseEvent): PageElementAnchor {
    if (!el || !el.getBoundingClientRect) return { path: '', x: 0.5, y: 0.5 };
    const r = el.getBoundingClientRect();
    const x = ev && r.width ? (ev.clientX - r.left) / r.width : 0.5;
    const y = ev && r.height ? (ev.clientY - r.top) / r.height : 0.5;
    return { path: cssPath(el), x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
  }
  function labelFor(el: Element | null): string {
    const text = String((el && (el.getAttribute('aria-label') || el.textContent)) || '')
      .replace(/\s+/g, ' ')
      .trim();
    return text ? text.slice(0, 80) : el ? el.tagName.toLowerCase() : 'the page';
  }
  /** A document point (or an element: its centre) as a viewport point. */
  function viewportPoint(at: Element | PagePoint | null | undefined): PagePoint | null {
    if (!at) return null;
    if (typeof Element !== 'undefined' && at instanceof Element) {
      const r = at.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return { x: (Number('x' in at ? at.x : 0) || 0) - window.scrollX, y: (Number('y' in at ? at.y : 0) || 0) - window.scrollY };
  }

  // ---- where pins go -------------------------------------------------------------------------------------------------
  // The shell draws the pins; the page reports where they go in viewport points, again whenever it scrolls or resizes
  // A page with custom anchors gives document points; for the fallback's
  // `{path, x, y}` anchors this script finds the element.

  /** The last `placed` map of custom anchors, in document points. */
  let placedDoc: Record<string, Element | PagePoint | null> | null = null;
  /** The threads the shell sent last. */
  let shellThreads: PageThreadPin[] = [];
  /** The fallback composer's anchor, while it is open. */
  let fallbackDraft: PageElementAnchor | null = null;
  let placeFrame = 0;
  let placeQueued = false;
  let placeObserver: MutationObserver | null = null;

  function pinsShown(): boolean {
    if (anchors) return !!placedDoc && (commentsMode || (anchors.callbacks.pinsOutsideMode === true && shellThreads.length > 0));
    return fallbackOn;
  }
  function fallbackPoint(anchor: unknown): PagePoint | null {
    if (!isRecord(anchor)) return null;
    let el: Element | null = null;
    try {
      el = anchor.path ? document.querySelector(String(anchor.path)) : document.documentElement;
    } catch {
      el = null;
    }
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    const fx = typeof anchor.x === 'number' && Number.isFinite(anchor.x) ? anchor.x : 0.5;
    const fy = typeof anchor.y === 'number' && Number.isFinite(anchor.y) ? anchor.y : 0.5;
    return { x: r.left + r.width * fx, y: r.top + r.height * fy };
  }
  function sendPlaced(): void {
    placeQueued = false;
    placeFrame = 0;
    if (!pinsShown()) return;
    const map: Record<string, PagePoint | null> = {};
    if (anchors) {
      for (const k of Object.keys(placedDoc || {})) map[k] = placedDoc![k] ? viewportPoint(placedDoc![k]) : null;
    } else {
      for (const t of shellThreads) map[t.id] = fallbackPoint(t.anchor);
      if (fallbackDraft) map.composer = fallbackPoint(fallbackDraft);
    }
    post({ __open_artifact_comments_placed: true, map });
  }
  /** A report soon: after the current task (a microtask), or on the next frame (scroll, resize, DOM changes). */
  function queuePlaced(frame = false): void {
    if (frame) {
      if (!placeFrame) placeFrame = requestAnimationFrame(sendPlaced);
      return;
    }
    if (placeQueued) return;
    placeQueued = true;
    queueMicrotask(sendPlaced);
  }
  const onPlaceMove = (): void => {
    if (pinsShown()) queuePlaced(true);
  };
  window.addEventListener('scroll', onPlaceMove, { capture: true, passive: true });
  window.addEventListener('resize', onPlaceMove);
  /** The fallback's pins follow the page's layout while comment mode is on. */
  function watchLayout(on: boolean): void {
    if (on && !placeObserver && typeof MutationObserver === 'function' && document.body) {
      placeObserver = new MutationObserver(onPlaceMove);
      placeObserver.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    } else if (!on && placeObserver) {
      placeObserver.disconnect();
      placeObserver = null;
    }
  }

  const sendListeners = new Set<PageCommentListener>();

  function commentResponseText(value: unknown, maxBytes: number): string | undefined {
    if (typeof value !== 'string' || value.length > maxBytes || !value.trim()) return undefined;
    return enc.encode(value).length <= maxBytes ? value : undefined;
  }

  async function answerCommentSend(ticket: string, payload: PageCommentSend): Promise<void> {
    let reply: string | undefined;
    let handoffNote: string | undefined;
    for (const listener of [...sendListeners]) {
      if (!sendListeners.has(listener)) continue;
      try {
        const result = await listener(payload);
        if (result?.handled === true) {
          post({ __open_artifact_comments_sent: true, ticket, handled: true, reply: commentResponseText(result.reply, 500) });
          return;
        }
        reply ??= commentResponseText(result?.reply, 500);
        handoffNote ??= commentResponseText(result?.handoffNote, 2000);
      } catch {
        // Other listeners and the person's original send can still proceed.
      }
    }
    post({ __open_artifact_comments_sent: true, ticket, handled: false, reply, handoffNote });
  }
  let fallbackOn = false;
  /** The editor kit's comment cursor (COMMENT_CURSOR in editor-kit's CommentViews.tsx), spelled out: this script imports nothing. */
  const COMMENT_CURSOR =
    'url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2728%27%20height=%2728%27%20viewBox=%270%200%2028%2028%27%3E%3Cpath%20d=%27M%202%2026%20L%202%2014%20A%2012%2012%200%201%201%2014%2026%20Z%27%20fill=%27%23000%27%20stroke=%27%23fff%27%20stroke-width=%272%27/%3E%3C/svg%3E") 2 26, crosshair';
  let cursorStyle: HTMLStyleElement | null = null;
  /** The outline of the element under the pointer while commenting, as in the editors. */
  let hoverBox: HTMLDivElement | null = null;
  let hoverFrame = 0;
  let hoverEvent: MouseEvent | null = null;
  function fallbackTarget(ev: Event): Element | null {
    const target = ev.target as Node | null;
    return target && target.nodeType === 1 ? (target as Element) : (target && target.parentElement) || null;
  }
  function paintHover(): void {
    hoverFrame = 0;
    const ev = hoverEvent;
    const el = ev ? fallbackTarget(ev) : null;
    if (!el || el === document.documentElement || el === document.body || !el.getBoundingClientRect) {
      if (hoverBox) hoverBox.style.display = 'none';
      return;
    }
    if (!hoverBox) {
      hoverBox = document.createElement('div');
      hoverBox.setAttribute('aria-hidden', 'true');
      Object.assign(hoverBox.style, {
        position: 'fixed',
        zIndex: '2147483647',
        pointerEvents: 'none',
        boxSizing: 'border-box',
        border: '2px solid rgba(245, 158, 11, 0.8)',
        borderRadius: '2px',
      });
      document.documentElement.append(hoverBox);
    }
    const r = el.getBoundingClientRect();
    Object.assign(hoverBox.style, { display: 'block', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  }
  function fallbackMove(ev: MouseEvent): void {
    hoverEvent = ev;
    if (!hoverFrame) hoverFrame = requestAnimationFrame(paintHover);
  }
  function fallbackLeave(): void {
    hoverEvent = null;
    if (hoverBox) hoverBox.style.display = 'none';
  }
  function fallbackClick(ev: MouseEvent): void {
    if (!commentsMode || anchors) return;
    ev.preventDefault();
    ev.stopPropagation();
    const el = fallbackTarget(ev);
    fallbackLeave();
    const anchor = anchorFor(el, ev);
    call<{ opened: boolean }>('comments', 'compose', { anchor, at: { x: ev.clientX, y: ev.clientY }, label: labelFor(el), click: true })
      .then((r) => {
        fallbackDraft = r && r.opened ? anchor : null;
        queuePlaced();
      })
      .catch(() => {});
  }
  function setFallback(on: boolean): void {
    if (on === fallbackOn) return;
    fallbackOn = on;
    if (on) {
      document.addEventListener('click', fallbackClick, true);
      document.addEventListener('mousemove', fallbackMove, true);
      document.addEventListener('mouseleave', fallbackLeave);
      document.addEventListener('scroll', fallbackLeave, true);
      document.documentElement.style.cursor = COMMENT_CURSOR;
      // Elements with a cursor of their own too (a page whose CSP refuses this sheet keeps theirs).
      cursorStyle = document.createElement('style');
      cursorStyle.textContent = `*, *::before, *::after { cursor: ${COMMENT_CURSOR} !important; }`;
      document.head.append(cursorStyle);
      watchLayout(true);
      queuePlaced();
    } else {
      document.removeEventListener('click', fallbackClick, true);
      document.removeEventListener('mousemove', fallbackMove, true);
      document.removeEventListener('mouseleave', fallbackLeave);
      document.removeEventListener('scroll', fallbackLeave, true);
      document.documentElement.style.cursor = '';
      cursorStyle?.remove();
      cursorStyle = null;
      fallbackLeave();
      watchLayout(false);
      fallbackDraft = null;
    }
  }

  function onCommentsEvent(d: Record<string, unknown>): void {
    const cb = anchors && anchors.callbacks;
    if (d.op === 'mode') {
      commentsMode = !!d.on;
      if (cb && typeof cb.mode === 'function') safely(() => cb.mode?.(commentsMode));
      else if (!anchors) setFallback(commentsMode);
      if (commentsMode) queuePlaced();
    } else if (d.op === 'threads') {
      const rows: unknown[] = Array.isArray(d.threads) ? d.threads : [];
      shellThreads = rows.filter(isRecord).map(t => ({ id: String(t.id), anchor: t.anchor, resolved: !!t.resolved, active: !!t.active }));
      if (cb && typeof cb.threads === 'function') safely(() => cb.threads?.(shellThreads.map((t) => ({ ...t }))));
      queuePlaced();
    } else if (d.op === 'reveal') {
      const id = d.id;
      if (cb && typeof cb.reveal === 'function' && typeof id === 'string') safely(() => cb.reveal?.(id));
      else if (!anchors) revealFallback(d.id);
    } else if (d.op === 'composing') {
      if (d.state === false) fallbackDraft = null;
      const state = typeof d.state === 'boolean' ? d.state : null;
      if (cb && typeof cb.composing === 'function') safely(() => cb.composing?.(state));
    } else if (d.op === 'move') {
      void answerMove(cb, d);
    } else if (d.op === 'send') {
      // The person sent a comment to the agent from the shell: a page that handles it itself says so (and, while its
      // listeners work, that it is on it, so the shell waits).
      if (typeof d.ticket !== 'string' || !isRecord(d.payload)) return;
      if (sendListeners.size) post({ __open_artifact_comments_sent: true, ticket: d.ticket, pending: true });
      void answerCommentSend(d.ticket, d.payload);
    }
  }

  /** A fallback thread brought into view: its element scrolled to, then its pin follows. */
  function revealFallback(id: unknown): void {
    const t = shellThreads.find((x) => x.id === id);
    if (!t || !isRecord(t.anchor)) return;
    try {
      const el = t.anchor.path ? document.querySelector(String(t.anchor.path)) : null;
      el?.scrollIntoView({ block: 'center', inline: 'nearest' });
    } catch {
      // a path this page no longer has
    }
    queuePlaced(true);
  }

  /** A pin dropped at a viewport point: the page's `move` callback names the anchor there (within two seconds). */
  async function answerMove(cb: FrameAnchorCallbacks | null, d: Record<string, unknown>): Promise<void> {
    const refuse = (): void => post({ __open_artifact_comments_moved: true, n: d.n, refused: true });
    if (!cb || typeof cb.move !== 'function' || typeof d.x !== 'number' || !Number.isFinite(d.x) || typeof d.y !== 'number' || !Number.isFinite(d.y)) return refuse();
    try {
      const answer = await Promise.race([
        Promise.resolve(cb.move(String(d.id), { x: d.x + window.scrollX, y: d.y + window.scrollY })),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
      ]);
      if (!answer || typeof answer !== 'object' || typeof answer.anchor !== 'string') return refuse();
      post({
        __open_artifact_comments_moved: true,
        n: d.n,
        anchor: answer.anchor,
        ...(typeof answer.label === 'string' ? { label: answer.label } : {}),
        ...(typeof answer.detail === 'string' ? { detail: answer.detail } : {}),
      });
    } catch {
      refuse();
    }
  }

  // Escape in comment mode reaches the shell (cards, the list, then the mode close there).
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && commentsMode && !ev.defaultPrevented) post({ __frame_escape: true });
  });

  const comments: FrameComments = {
    openComposer: (opts) => {
      const el: Element | null = (opts && opts.element) || null;
      const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      return call<{ opened: boolean }>('comments', 'compose', {
        anchor: el ? anchorFor(el) : { path: '', x: 0.5, y: 0.5 },
        at: r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null,
        label: el ? labelFor(el) : 'the page',
      });
    },
    anchorFor: (el: Element) => anchorFor(el),
    create: (o) => call<{ threadId: string; commentId: string }>('comments', 'create', { anchor: clone(o && o.anchor), text: o && o.text, label: o && o.label }).then((r) => ({ threadId: r.threadId, commentId: r.commentId })),
    reply: (a: string | { threadId: string; text: string }, b?: string) => {
      const o = typeof a === 'object' && a ? a : { threadId: a, text: b };
      return call<{ threadId: string; commentId: string }>('comments', 'reply', { threadId: o.threadId, text: o.text }).then((r) => ({ threadId: r.threadId, commentId: r.commentId }));
    },
    resolve: (threadId: string, resolved?: boolean) => call('comments', 'resolve', { threadId, resolved: resolved !== false }).then(() => {}),
    delete: (threadId: string, commentId?: string) => call('comments', 'delete', { threadId, commentId }).then(() => {}),
    list: () => call<{ threads: PageCommentThread[] }>('comments', 'list', {}).then((r) => r.threads),
    sendToAgent: (o) => call('comments', 'sendToAgent', clone(o || {})),
    canSendToAgent: () => call('comments', 'canSendToAgent', {}),
    onSendToAgent: (fn) => {
      sendListeners.add(fn);
      return () => sendListeners.delete(fn);
    },
    customAnchors: (callbacks) => {
      const mine = { callbacks: callbacks || {} };
      anchors = mine;
      placedDoc = null;
      setFallback(false);
      const ctl: PageAnchorController = {
        // While registered, compose is the viewer's click (the shell turns comment mode on, or closes what is open).
        compose: (anchor, at, opts) => {
          const o = opts || {};
          return call<{ opened: boolean }>('comments', 'compose', { anchor: clone(anchor), at: viewportPoint(at), label: o.label, detail: o.detail, area: !!o.area, click: true });
        },
        open: (id, at) => call('comments', 'open', { id, at: viewportPoint(at) }),
        // Kept in document points: reported now, and again on every scroll and resize.
        placed: (map) => {
          if (anchors !== mine) return;
          const doc: Record<string, Element | PagePoint | null> = {};
          for (const k of Object.keys(map || {})) {
            const v = map[k];
            doc[k] = v && typeof v === 'object' ? (typeof Element !== 'undefined' && v instanceof Element ? v : { x: Number('x' in v ? v.x : undefined), y: Number('y' in v ? v.y : undefined) }) : null;
          }
          placedDoc = doc;
          queuePlaced();
        },
        domAnchor: (el: Element, ev?: MouseEvent) => anchorFor(el, ev),
        exitMode: () => void call('comments', 'mode', { on: false }).catch(() => {}),
        release: () => {
          if (anchors === mine) {
            anchors = null;
            placedDoc = null;
            // Click-to-comment works again.
            setFallback(commentsMode);
          }
          call('comments', 'custom', { on: false }).catch(() => {});
        },
        areas: undefined,
      };
      return call('comments', 'custom', { on: true, pins: callbacks && callbacks.pinsOutsideMode === true, move: !!callbacks && typeof callbacks.move === 'function' }).then(() => ctl);
    },
  };

  // ---- stubs, use(), window.openArtifact -----------------------------------------------------------------------------------

  /** A declared capability this host cannot serve: every method answers its error code. */
  function stub(name: string): object {
    return new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (typeof prop === 'symbol' || prop === 'then' || prop === 'toJSON') return undefined;
          if (prop === 'available') return true;
          return () => call(name, String(prop), {});
        },
      },
    );
  }

  // Here: no hot updates; `openArtifact.hot` is the inert shape a page can feature-test.
  const hot = Object.freeze({ data: undefined, from: null, gen: 0, signal: undefined, snapshot() {}, ready() {}, accept() {}, restart() {} });
  const namespaces = { db, artifact: self, assets, downloads, user, permissions, room, comments, network } satisfies Omit<PageCapabilities, 'self' | 'hot'>;
  const mounted: Record<string, object> = Object.create(null);
  
  function namespaceOf(key: string): object | null {
    if (stubs.indexOf(key) >= 0) return (mounted[key] ||= stub(key));
    if (!Object.hasOwn(namespaces, key)) return null;
    if (!mounted[key]) {
      const ns: Record<string, unknown> = Object.create(null);
      const src = namespaces[key as keyof typeof namespaces];
      for (const k of Object.keys(src)) Object.defineProperty(ns, k, Object.getOwnPropertyDescriptor(src, k)!);
      delete ns.then;
      mounted[key] = Object.freeze(ns);
    }
    return mounted[key];
  }

  /** The `/_f/<ver>/` segment of this page: the `ver` of a `__frame_cap_want`. */
  const pageVer = ((/^\/_f\/([^/]{1,128})\//.exec(location.pathname) || [])[1] as string | undefined) || '0';

  function want(cap: string): Promise<object | null> {
    return new Promise((resolve) => {
      const done = (value: object | null): void => {
        clearTimeout(timer);
        wants.delete(cap);
        resolve(value);
      };
      const timer = setTimeout(() => done(null), WANT_TIMEOUT_MS);
      wants.set(cap, (g) => {
        if (typeof g.brokerGen === 'number') brokerGen = g.brokerGen;
        if (!isRecord(g.grant) || cap === 'network') return done(null);
        configs[cap] = isRecord(g.grant.config) ? g.grant.config : {};
        done(namespaceOf(cap));
      });
      post({ __frame_cap_want: true, cap: cap === 'artifact' ? 'self' : cap, ver: pageVer });
    });
  }

  const slots = new Map<string, Promise<object | null>>();
  const KNOWN = /^[a-z][a-z0-9]{0,23}$/;
  function use<Name extends string>(name: Name): Promise<PageNamespace<Name> | null>;
  function use(name: unknown): Promise<object | null> {
    if (typeof name !== 'string') return Promise.resolve(null);
    if (name === 'hot') return Promise.resolve(hot);
    const key = name === 'self' ? 'artifact' : name;
    if (!KNOWN.test(key) || (!Object.hasOwn(namespaces, key) && stubs.indexOf(key) < 0)) return Promise.resolve(null);
    let slot = slots.get(key);
    if (!slot) {
      slot = whenInit().then((got) => {
        if (!got) return null;
        if (stubs.indexOf(key) >= 0) return namespaceOf(key);
        if (got.grants.has(key)) return namespaceOf(key);
        if (got.capWants && got.usable.includes(key)) return want(key);
        return null;
      });
      if (boot.debug) slot.then((ns) => ns || post({ __open_artifact_console: true, level: 'warn', text: `use(${name}) → null` }));
      slots.set(key, slot);
    }
    return slot;
  }

  const openArtifact: Record<string, unknown> = { __openArtifactFrame: true, contract: boot.contract, use };
  // Here: the declared capabilities are also direct properties from the start (the original pages read
  
  for (const g of grants) {
    const ns = namespaceOf(g);
    if (ns) openArtifact[g] = ns;
  }
  if (grants.indexOf('artifact') >= 0) openArtifact.self = namespaceOf('artifact');
  openArtifact.hot = hot;
  for (const s of stubs) openArtifact[s] = namespaceOf(s);
  Object.defineProperty(window, 'openArtifact', { value: Object.freeze(openArtifact), configurable: false, writable: false, enumerable: false });
  // `window.claude`: the same frozen object, for pages written against that name. Not writable, but configurable, so a
  // classic script's top-level `const claude = window.claude` (or a `let`/`function`/`class claude`) still runs; a page
  // that redefines it changes only its own realm. A page that defined its own `window.claude` before this script keeps it.
  if (!Object.prototype.hasOwnProperty.call(window, 'claude')) {
    Object.defineProperty(window, 'claude', { value: w.openArtifact, configurable: true, writable: false, enumerable: false });
  }

  // OPEN_ARTIFACT_FRAME_DEBUG: the page's errors and warnings also go to the inner shell's console (a page on its own origin is
  // often out of reach of a developer tool attached to the top frame).
  if (boot.debug && framed) {
    const relay = (level: string, args: ArrayLike<unknown>): void => {
      const text = Array.prototype.map
        .call(args, (a: unknown) => {
          if (a instanceof Error) return a.stack || a.message;
          if (typeof a === 'string') return a;
          try {
            return JSON.stringify(a);
          } catch {
            return String(a);
          }
        })
        .join(' ')
        .slice(0, 4000);
      post({ __open_artifact_console: true, level, text });
    };
    for (const level of ['error', 'warn'] as const) {
      const orig = console[level];
      console[level] = (...args: unknown[]) => {
        relay(level, args);
        orig.apply(console, args);
      };
    }
    window.addEventListener('error', (ev) => relay('error', [ev.error || ev.message]));
    window.addEventListener('unhandledrejection', (ev) => relay('error', ['unhandled rejection:', ev.reason]));
  }

  // On leaving, the page's subscriptions end.
  window.addEventListener('pagehide', (event) => {
    if (event.persisted) return;
    for (const id of [...dbSubs.keys()]) dbCall('unsubscribe', { sub: id }).catch(() => {});
    dbSubs.clear();
  });

  connect();
  const signalReady = (): void => post({ __frame_ready: true, gate: 'init' });
  if (document.readyState === 'complete') setTimeout(signalReady, 0);
  else window.addEventListener('load', signalReady, { once: true });
})();
