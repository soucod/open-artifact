
























import type { ChromeAction, ChromeCommand, ChromeExportItem, ChromeFormat, ChromeReport, ChromeWhy, PageToShell, ShellToPage } from '@open-artifact/protocol';
import type { CapErrorBody, FrameEvent, FrameInit, FrameSession } from '../wire.ts';
import type { FrameCommentsUi, PageThread } from './comments-ui/main.tsx';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

(() => {
  'use strict';
  const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
  const params = new URLSearchParams(location.search);
  const LOCAL_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d{1,5}$/;
  const askedOuter = params.get('open_artifact_shell') || '';
  // A loopback Shell is taken at once; any other only when the session names it (a site's app origin), so a page
  // that frames this one under a made-up parameter speaks to no one. Its messages until then wait in `outerEarly`.
  let outerOrigin: string | null = LOCAL_ORIGIN.test(askedOuter) ? askedOuter : null;
  let outer: Window | null = outerOrigin && window.parent !== window ? window.parent : null;
  const outerPending = !outer && !!askedOuter && window.parent !== window;
  const outerEarly: unknown[] = [];
  const client = randomId(16);
  const api = (name: string): string => new URL(`api/frame/${name}`, location.href).href;
  const CHROME_PROTOCOL = 1;
  const STALE_MESSAGE = 'not run: the artifact was updated';
  const UNDECLARED_MESSAGE = 'the version this view runs does not declare it';
  const DEFAULT_CAP_BUDGETS = { mcp: { callTool: 130_000 }, sample: { sample: 330_000 }, endpoints: { fetch: 130_000 }, assets: { upload: 270_000 } };
  /** Calls answered after a decision or a long upload: acked so the page waits 900 s instead of its short timer. */
  const ACKED = new Set(['assets.upload', 'comments.sendToAgent', 'room.sendToAgentSession', 'artifact.publish']);
  /** A snapshot's view (`session.snapshot`): the page has this long to say it is ready, and to hold its reveal. */
  const SNAPSHOT_READY_S = 8;
  const SNAPSHOT_HOLD_MS = 5_000;

  let session: FrameSession | null = null;
  let frame: HTMLIFrameElement | null = null;
  let pageWin: Window | null = null;
  let contentOrigin = '';
  let ver = '';
  /** The broker generation: a call stamped with another is refused. */
  let gen = 1;
  let ready = false;
  let readyTimer: ReturnType<typeof setTimeout> | null = null;
  let revealHeld = false;
  let revealed = false;
  let connected = false;
  const subs = new Map<string, { kind: 'doc' | 'query'; path: string; spec: unknown; gen: number }>();
  const rerun = new Set<string>();
  let rerunTimer: ReturnType<typeof setTimeout> | null = null;

  function randomId(n: number): string {
    const a = new Uint8Array(n);
    crypto.getRandomValues(a);
    return Array.from(a, (b) => 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[b % 62]).join('');
  }

  // ---- talking to the backend ---------------------------------------------------------------------------------------

  async function post(name: string, body: unknown): Promise<Any> {
    const r = await fetch(api(name), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
    const out = await r.json().catch(() => ({ error: { code: 'upstream_error', message: `HTTP ${r.status}` } }));
    if (!r.ok && !out.error) out.error = { code: 'upstream_error', message: `HTTP ${r.status}` };
    return out;
  }

  /**
   * One capability call. `own`: the shell's own (its comments UI), which a site answers with full author names; a call
   * relayed from the page never sets it, and gets what the declaration's `user` scopes allow.
   */
  async function cap(capName: string, method: string, arg: unknown, own = false): Promise<Any> {
    const out = await post('cap', { cap: capName, method, args: [arg], client, brokerGen: gen, ...(own ? { shell: true } : {}) });
    if (out.error) throw out.error;
    return out.result;
  }

  // ---- the event stream ---------------------------------------------------------------------------------------------

  let backoff = 500;
  function openStream(): void {
    const u = new URL(api(`events?c=${client}`));
    u.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let ws: WebSocket;
    try {
      ws = new WebSocket(u.href, 'baoyu-sse');
    } catch {
      setTimeout(openStream, backoff);
      return;
    }
    ws.onmessage = (ev) => {
      let m: FrameEvent;
      try {
        m = JSON.parse(String(ev.data)) as FrameEvent;
      } catch {
        return;
      }
      onEvent(m);
    };
    ws.onopen = () => {
      backoff = 500;
    };
    ws.onclose = () => {
      if (connected) {
        connected = false;
        toPage({ __frame_room_ev: true, kind: 'connection', connected: false });
      }
      setTimeout(openStream, backoff);
      backoff = Math.min(backoff * 2, 10_000);
    };
  }

  function onEvent(m: FrameEvent): void {
    if (m.t === 'hello') {
      connected = true;
      toPage({ __frame_room_ev: true, kind: 'connection', connected: true });
      toPage({ __frame_room_ev: true, kind: 'peers', peers: m.peers || [] });
      for (const id of subs.keys()) rerun.add(id);
      scheduleRerun();
      // The count is the open threads' messages, worked out from the list.
      void refreshThreads();
      // Missed while the stream was down: the server moved on.
      if (typeof m.brokerGen === 'number' && m.brokerGen !== gen) void rewired({ t: 'rewired', brokerGen: m.brokerGen, caps: session?.grants ?? [], reason: 'type' });
      else if (m.ver && ver && m.ver !== ver) reloadPage(m.ver);
    } else if (m.t === 'db') {
      const paths = Array.isArray(m.paths) ? m.paths : [];
      for (const [id, s] of subs) if (!paths.length || paths.some((p) => touches(s, p))) rerun.add(id);
      scheduleRerun();
    } else if (m.t === 'room') {
      toPage({ __frame_room_ev: true, kind: 'msg', topic: m.topic, data: m.data, from: m.from, by: m.by });
    } else if (m.t === 'peers') {
      toPage({ __frame_room_ev: true, kind: 'peers', peers: m.peers || [] });
    } else if (m.t === 'files') {
      if (m.from === client) {
        ver = m.ver;
        return;
      }
      reloadPage(m.ver);
    } else if (m.t === 'comments') {
      void refreshThreads();
    } else if (m.t === 'rewired') {
      void rewired(m);
    }
  }

  /**
   * The server rewired (the type or the files changed under the page): cut
   * the page's pending calls (`__frame_cap_rewired`), take the new session,
   * and reload the page when the type itself changed (a files change reloads
   * on its own `files` event).
   */
  async function rewired(m: Extract<FrameEvent, { t: 'rewired' }>): Promise<void> {
    gen = m.brokerGen;
    toPage({ __frame_cap_rewired: true, caps: m.caps.map((c) => (c === 'artifact' ? 'self' : c)).concat(m.caps.includes('artifact') ? ['artifact'] : []), brokerGen: gen });
    try {
      const r = await fetch(api('session'), { credentials: 'same-origin' });
      if (r.ok) session = (await r.json()) as FrameSession;
    } catch {
      // keep the old one
    }
    if (m.reason === 'type') reloadPage(session?.ver ?? ver);
  }

  function touches(sub: { kind: string; path: string }, docPath: string): boolean {
    if (sub.kind === 'doc') return sub.path === docPath;
    return docPath.split('/').slice(0, -1).join('/') === sub.path;
  }

  function scheduleRerun(): void {
    if (rerunTimer) return;
    rerunTimer = setTimeout(() => {
      rerunTimer = null;
      const ids = [...rerun];
      rerun.clear();
      for (const id of ids) void runSub(id);
    }, 30);
  }

  async function runSub(id: string): Promise<void> {
    const s = subs.get(id);
    if (!s) return;
    const n = ++s.gen;
    try {
      const msg: Record<string, unknown> = { __frame_db_ev: true, sub: id };
      if (s.kind === 'doc') {
        const r = await cap('db', 'get', { path: s.path });
        msg.exists = !!r.exists;
        if (r.exists) msg.data = r.data;
      } else {
        const r = await cap('db', 'query', { path: s.path, spec: s.spec || {} });
        msg.docs = r.docs;
      }
      if (subs.get(id) === s && n === s.gen) toPage(msg);
    } catch (error) {
      if (subs.get(id) === s) toPage({ __frame_db_ev: true, sub: id, error });
    }
  }

  // ---- the page -----------------------------------------------------------------------------------------------------

  function toPage(msg: unknown): void {
    if (!pageWin || !contentOrigin) return;
    try {
      pageWin.postMessage(msg, contentOrigin);
    } catch {
      // the page is reloading
    }
  }

  const pageUrl = (v: string): string => `${contentOrigin}/_f/${encodeURIComponent(v)}/${location.hash}`;

  function mountPage(): void {
    const f = document.createElement('iframe');
    frame = f;
    f.title = session?.title || 'Artifact';
    // `*`, not the default (the src's origin): an artifact id has a '_', and the browser does not delegate a feature to
    // an origin whose host has one, so the page got none of these. The outer page's frame-src keeps this frame on page
    // origins of this server.
    f.allow = 'clipboard-read *; clipboard-write *; fullscreen *; autoplay *';
    f.referrerPolicy = 'origin';
    // A restricted type's page (installed, or a project not trusted yet): no popups and no top navigation. Set before
    // src, so the first document has it.
    if (session?.sandbox) f.setAttribute('sandbox', session.sandbox);
    f.src = pageUrl(ver);
    f.addEventListener('load', () => {
      pageWin = f.contentWindow;
      chrome.answered = 0;
      chrome.sent = 0;
    });
    // pageWin stays null until the page loads or speaks: before that the frame holds the initial about:blank, which
    // has this shell's origin, and anything sent there is lost.
    $('stage').append(f);
    armReadyTimer();
  }

  function reloadPage(nextVer: string): void {
    if (!frame) return;
    ver = nextVer;
    ready = false;
    revealed = false;
    revealHeld = false;
    shows(null);
    subs.clear();
    closeCard();
    comments.custom = false;
    comments.customPins = false;
    comments.movable = false;
    comments.pageButton = false;
    setPlaced({});
    views?.setPageButton(false);
    views?.setMovable(false);
    chrome.snapshot = null;
    lastSnapshotText = '';
    chrome.pendingExport = null;
    frame.src = pageUrl(nextVer);
    armReadyTimer();
    sendReport();
  }

  function armReadyTimer(): void {
    if (readyTimer) clearTimeout(readyTimer);
    // A snapshot's camera waits about ten seconds for what this shows to be final: a page not ready by then is shown
    // as the problem it is.
    const s = Math.min(session?.snapshot ? SNAPSHOT_READY_S : Infinity, Math.max(5, Number(session?.readyTimeoutS) || 60));
    readyTimer = setTimeout(() => {
      if (!ready) showProblem('This page did not start', `It did not say it was ready within ${s} seconds.`);
    }, s * 1000);
  }

  /**
   * What the shell shows is final (`data-open-artifact-shell` on <html>, which a snapshot's camera waits for): the page,
   * revealed after its own load (an empty page artifact's empty state too), or the problem card. null: not yet.
   */
  function shows(state: 'revealed' | 'problem' | null): void {
    if (state) document.documentElement.dataset.openArtifactShell = state;
    else delete document.documentElement.dataset.openArtifactShell;
  }

  function reveal(): void {
    if (revealed) return;
    revealed = true;
    shows('revealed');
    toPage({ __frame_revealed: true });
    toPage({ __frame_size_poke: true });
  }

  const theme = (): 'light' | 'dark' => (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const hostVisible = (): boolean => document.visibilityState !== 'hidden';

  function initMessage(): { __frame_init: FrameInit } {
    const s = session!;
    const capabilities: FrameInit['capabilities'] = {};
    for (const c of s.grants) capabilities[c] = { config: s.configs[c] ?? {} };
    return {
      __frame_init: {
        contract: s.contract,
        changes: [],
        flags: s.flags,
        capabilities,
        usable: [...s.grants, ...Object.keys(s.stubs)],
        theme: theme(),
        hostVisible: hostVisible(),
        hostOverlays: [],
        hostSides: {},
        // Here: no host keys (the outer Shell takes its own shortcuts in its own frame).
        hostKeys: [],
        hot: { gen: 0, phase: 'final', from: null },
        capBudgets: DEFAULT_CAP_BUDGETS,
        capWants: true,
        brokerGen: gen,
        client,
      },
    };
  }

  function viewportMessage(): unknown {
    return {
      __frame_viewport: true,
      composer: { available: false, visible: false, unread: 0 },
      safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      bottomInset: 0,
      topInset: 0,
    };
  }

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (!m || typeof m !== 'object') return;
    if (frame && ev.source === frame.contentWindow && ev.origin === contentOrigin) {
      pageWin = ev.source as Window;
      void fromPage(m);
      return;
    }
    if (outer && ev.source === outer && ev.origin === outerOrigin) fromOuter(m as ShellToPage);
    else if (outerPending && !session && ev.source === window.parent && ev.origin === askedOuter && outerEarly.length < 50) outerEarly.push(m);
  });

  async function fromPage(m: Any): Promise<void> {
    if (m.__frame_connect === true) {
      toPage(initMessage());
      toPage(viewportMessage());
      toPage({ __frame_host_visible: { visible: hostVisible() } });
      sendCommentsState();
      // A page reloaded while commenting comes back into comment mode.
      if (comments.on) toPage({ __open_artifact_comments: true, op: 'mode', on: true });
      void refreshThreads();
      return;
    }
    if (m.__frame_cap === true && typeof m.id === 'string') return answerCap(m);
    if (m.__frame_cap_want === true) return answerWant(m);
    if (m.__frame_ready === true) {
      if (!ready) {
        ready = true;
        if (readyTimer) clearTimeout(readyTimer);
        hideProblem();
      }
      if (!revealHeld) reveal();
      openAskedThread();
      return;
    }
    if (m.__frame_reveal_hold === true) {
      revealHeld = true;
      setTimeout(() => {
        revealHeld = false;
        if (ready) reveal();
      }, session?.snapshot ? SNAPSHOT_HOLD_MS : 15_000);
      return;
    }
    if (m.__frame_reveal_ready === true) {
      revealHeld = false;
      reveal();
      return;
    }
    if (m.__frame_flags_ask === true) return toPage({ __frame_flags: true, values: session?.flags ?? {} });
    if (m.__frame_health === true) {
      if (m.level === 'error' || m.fatal) console.warn('[frame health]', m);
      return;
    }
    if (m.__frame_chrome_hello === true) return chromeHello();
    if (m.__frame_chrome_report === true) return chromeReport(m.snapshot);
    if (m.__frame_chrome_decline === true) return exportEnded(m.request, 'declined');
    if (m.__open_artifact_export_done === true) return exportEnded(m.request, 'done');
    if (m.__frame_title_from_content === true && typeof m.title === 'string') {
      const out = await post('title', { title: m.title, ifUnnamed: m.ifUnnamed !== false }).catch(() => null);
      if (out && out.applied) document.title = out.title;
      return;
    }
    if (m.__frame_agent_activity_ask === true) {
      if (activity.asks++ < 8) {
        activity.asked = true;
        void pollActivity();
      }
      return;
    }
    if (m.__frame_comments_request === true) return commentsRequest(m);
    if (m.__open_artifact_comments_placed === true) {
      if (session?.grants.includes('comments')) onPlaced(m.map);
      return;
    }
    if (m.__frame_escape === true) return onEscape();
    if (m.__frame_bare_keys_want === true) return toPage({ __frame_bare_keys: !views?.open() && !comments.listOpen });
    if (m.__frame_anchor === true || m.type === 'current_anchor') return onAnchor(m.fragment);
    if (m.__open_artifact_console === true) {
      (m.level === 'warn' ? console.warn : console.error)('[page]', String(m.text || ''));
      return;
    }
    if (m.__open_artifact_comments_sent === true) {
      const done = sendTickets.get(m.ticket);
      // The page has listeners and is working on it: wait for its answer (up to two minutes).
      if (m.pending === true) return done?.(m);
      sendTickets.delete(m.ticket);
      done?.(m);
      return;
    }
    if (m.__open_artifact_comments_moved === true) return void onMoved(m);
    // Others (__frame_host_key, __frame_size, __frame_layout, __frame_nav, __frame_idle, analytics) need nothing here.
  }

  
  async function answerCap(m: Any): Promise<void> {
    const reply = (body: { result?: unknown; error?: CapErrorBody }): void => toPage({ __frame_cap_r: true, id: m.id, ...body });
    const capName = m.cap === 'self' ? 'artifact' : String(m.cap);
    const a = Array.isArray(m.args) && m.args[0] && typeof m.args[0] === 'object' ? m.args[0] : {};
    if (m.brokerGen !== undefined && m.brokerGen !== gen) {
      if (capName === 'user') return reply({ result: null });
      return reply({ error: { code: ['db', 'downloads', 'files', 'paste', 'reads'].includes(capName) ? 'unavailable' : 'upstream_error', message: STALE_MESSAGE } });
    }
    // Usage telemetry the type pages send on their own: nothing to report it to locally, so it is dropped quietly.
    if (capName === 'analytics') return reply({ result: null });
    if (session && !session.grants.includes(capName) && !(capName in session.stubs)) {
      return reply({ error: { code: 'not_granted', message: `${capName}: ${UNDECLARED_MESSAGE}` } });
    }
    const key = `${capName}.${m.method}`;
    if (ACKED.has(key)) toPage({ __frame_cap_ack: true, id: m.id });
    try {
      if (key === 'db.subscribe') {
        if (typeof a.sub !== 'string') throw { code: 'invalid_argument', message: 'subscribe needs an id.' };
        subs.set(a.sub, { kind: a.kind === 'doc' ? 'doc' : 'query', path: String(a.path), spec: a.spec || null, gen: 0 });
        reply({ result: {} });
        return void runSub(a.sub);
      }
      if (key === 'db.unsubscribe') {
        subs.delete(a.sub);
        return reply({ result: {} });
      }
      if (key === 'assets.upload') {
        if (!(a.blob instanceof Blob)) throw { code: 'invalid_request', message: 'upload() takes a Blob.' };
        const type = String(a.type || a.blob.type || '');
        const r = await fetch(api(`upload?type=${encodeURIComponent(type)}&gen=${gen}`), { method: 'POST', body: a.blob, headers: { 'Content-Type': 'application/octet-stream' } });
        const out = await r.json().catch(() => ({ error: { code: 'upstream_error', message: `HTTP ${r.status}` } }));
        if (out.error) throw out.error;
        return reply({ result: out.result });
      }
      if (capName === 'comments' && ['compose', 'open', 'placed', 'custom', 'mode'].includes(m.method)) return reply({ result: commentsUi(m.method, a) });
      if (key === 'comments.sendToAgent') return reply({ result: await sendToAgent(a) });
      if (key === 'room.sendToAgentSession' && a.deliver === 'stage') {
        const text = typeof a.data === 'string' ? a.data : JSON.stringify(a.data);
        await navigator.clipboard?.writeText(text).catch(() => {});
        toast('Copied for the agent session.');
        return reply({ result: { to: 'clipboard' } });
      }
      const result = await cap(capName, m.method, a);
      if (capName === 'comments' && ['create', 'reply', 'resolve', 'delete', 'move'].includes(m.method)) void refreshThreads();
      reply({ result });
    } catch (error) {
      const e = (error ?? {}) as Any;
      reply({ error: { ...e, code: e.code || 'upstream_error', message: e.message || String(error) } });
    }
  }

  /** `__frame_cap_want`: a grant with the cap's config, or none (the page's use() resolves null). */
  function answerWant(m: Any): void {
    const name = typeof m.cap === 'string' && /^[a-z][a-z0-9]{0,23}$/.test(m.cap) ? m.cap : null;
    if (!name || typeof m.ver !== 'string' || m.ver.length < 1 || m.ver.length > 128) return;
    const c = name === 'self' ? 'artifact' : name;
    const granted = !!session && c !== 'network' && session.grants.includes(c);
    toPage({ __frame_cap_grant: true, cap: m.cap, ver: m.ver, ...(granted ? { grant: { config: session!.configs[c] ?? {} } } : {}), brokerGen: gen });
  }

  // ---- the page's chrome -------------------------------------------------------

  interface Snapshot {
    v: 1;
    saved?: 'saved' | 'saving' | 'unsaved' | 'reconnecting' | 'readonly';
    unresolved?: number;
    leaveLosesWork?: true;
    actions?: { id: string; disabled?: boolean; why?: string }[];
    exports?: { format: string; disabled?: boolean; interactive?: boolean; bundle?: boolean; variants?: { id: string; disabled?: boolean }[] }[];
    handoffs?: { format: string; disabled?: boolean }[];
    destinations?: { id: string; name?: string; disabled?: boolean }[];
    [k: string]: unknown;
  }

  const chrome = {
    snapshot: null as Snapshot | null,
    /** Hellos answered and none/pokes sent for this load. */
    answered: 0,
    sent: 0,
    lastExportAt: 0,
    /** The export the page is running; `outer` when the outer Shell asked for it (it hears the outcome). */
    pendingExport: null as { request: string; at: number; outer: boolean } | null,
    lastActionAt: 0,
    /** What the outer Shell draws (`draws` of its last `chrome_hello`). */
    outerDraws: new Set<string>(),
  };

  /**
   * Whether the outer Shell draws the page's save state (it said so in its
   * `chrome_hello`). Then the page gets a poke and leaves its own save badge
   * out; otherwise `__frame_chrome_none`, and the page keeps drawing it.
   */
  function hostDrawsSave(): boolean {
    return !!outer && chrome.outerDraws.has('saved');
  }

  




  function toPageCmd(cmd: Record<string, unknown>): void {
    toPage({ __frame_chrome_cmd: true, ...cmd, ...(hostDrawsSave() ? {} : { rows: false }) });
  }

  function chromeHello(): void {
    if (chrome.answered >= 8) return;
    chrome.answered++;
    sendChromeAnswer();
  }

  function sendChromeAnswer(): void {
    if (chrome.sent >= 8) return;
    chrome.sent++;
    if (hostDrawsSave()) toPage({ __frame_chrome_poke: true, words: ['readonly'] });
    else toPage({ __frame_chrome_none: true });
  }

  const SAVED = ['saved', 'saving', 'unsaved', 'reconnecting', 'readonly'];
  const WHY = ['older_version', 'agent_working', 'draft_open', 'comments_on', 'needs_chat', 'unsaved', 'other'];
  const ACTION_ID = /^[a-z][a-z0-9_-]{0,31}$/;
  const FORMAT = /^[a-z0-9]{1,8}$/;
  const isObj = (v: unknown): v is Record<string, Any> => typeof v === 'object' && v !== null && !Array.isArray(v);
  const optBool = (v: unknown): boolean => v === undefined || typeof v === 'boolean';
  const clampN = (v: number): number => Math.max(0, Math.min(9999, v));

  
  function validateSnapshot(raw: unknown): Snapshot | null {
    if (!isObj(raw) || raw.v !== 1) return null;
    const out: Snapshot = { v: 1 };
    if (raw.saved !== undefined) {
      if (!SAVED.includes(raw.saved)) return null;
      out.saved = raw.saved;
    }
    if (raw.unresolved !== undefined) {
      if (typeof raw.unresolved !== 'number' || !Number.isFinite(raw.unresolved)) return null;
      out.unresolved = clampN(Math.floor(raw.unresolved));
    }
    if (raw.leaveLosesWork !== undefined) {
      if (raw.leaveLosesWork !== true) return null;
      out.leaveLosesWork = true;
    }
    if (raw.actions !== undefined) {
      if (!Array.isArray(raw.actions) || raw.actions.length > 18) return null;
      const seen = new Set<string>();
      out.actions = [];
      for (const a of raw.actions) {
        if (!isObj(a) || typeof a.id !== 'string' || !ACTION_ID.test(a.id) || !optBool(a.disabled)) return null;
        if (a.why !== undefined && !WHY.includes(a.why)) return null;
        if (seen.has(a.id)) continue;
        seen.add(a.id);
        out.actions.push({ id: a.id, ...(a.disabled ? { disabled: true } : {}), ...(a.why ? { why: a.why } : {}) });
      }
    }
    const formats = new Set<string>();
    if (raw.exports !== undefined) {
      if (!Array.isArray(raw.exports) || raw.exports.length > 8) return null;
      out.exports = [];
      for (const x of raw.exports) {
        if (!isObj(x) || typeof x.format !== 'string' || !FORMAT.test(x.format) || formats.has(x.format)) return null;
        if (!optBool(x.disabled) || !optBool(x.interactive) || !optBool(x.bundle)) return null;
        let variants: { id: string; disabled?: boolean }[] | undefined;
        if (x.variants !== undefined) {
          if (!Array.isArray(x.variants) || x.variants.length > 8) return null;
          variants = [];
          for (const v of x.variants) {
            if (!isObj(v) || typeof v.id !== 'string' || !ACTION_ID.test(v.id) || !optBool(v.disabled)) return null;
            variants.push({ id: v.id, ...(v.disabled ? { disabled: true } : {}) });
          }
        }
        formats.add(x.format);
        out.exports.push({ format: x.format, ...(x.disabled ? { disabled: true } : {}), ...(x.interactive ? { interactive: true } : {}), ...(x.bundle ? { bundle: true } : {}), ...(variants ? { variants } : {}) });
      }
    }
    if (raw.handoffs !== undefined) {
      if (!Array.isArray(raw.handoffs)) return null;
      out.handoffs = [];
      for (const h of raw.handoffs) {
        if (!isObj(h) || typeof h.format !== 'string' || !FORMAT.test(h.format) || formats.has(h.format) || !optBool(h.disabled)) return null;
        formats.add(h.format);
        out.handoffs.push({ format: h.format, ...(h.disabled ? { disabled: true } : {}) });
      }
      if (formats.size > 8) return null;
    }
    if (raw.destinations !== undefined) {
      if (!Array.isArray(raw.destinations) || raw.destinations.length > 8) return null;
      out.destinations = [];
      for (const d of raw.destinations) {
        if (!isObj(d) || typeof d.id !== 'string' || !optBool(d.disabled)) return null;
        // eslint-disable-next-line no-control-regex
        if (d.name !== undefined && (typeof d.name !== 'string' || [...d.name].length > 48 || /[\u0000-\u001f\u007f]/.test(d.name))) return null;
        out.destinations.push({ id: d.id, ...(d.name !== undefined ? { name: d.name } : {}), ...(d.disabled ? { disabled: true } : {}) });
      }
    }
    if (raw.shareNotice !== undefined) {
      const n = raw.shareNotice;
      if (!isObj(n) || typeof n.text !== 'string' || n.text.length > 2000 || n.tone !== 'warning') return null;
      out.shareNotice = { text: n.text, tone: 'warning' };
    }
    if (raw.hasContent !== undefined) {
      if (typeof raw.hasContent !== 'boolean') return null;
      out.hasContent = raw.hasContent;
    }
    if (raw.ownChat !== undefined) {
      if (raw.ownChat !== true) return null;
      out.ownChat = true;
    }
    if (raw.ground !== undefined) {
      if (typeof raw.ground !== 'string' || !/^#[0-9a-f]{6}$/i.test(raw.ground)) return null;
      out.ground = raw.ground;
    }
    for (const k of ['footInset', 'footSlotX', 'footSlotY', 'footSlotW']) {
      if (raw[k] === undefined) continue;
      if (typeof raw[k] !== 'number' || !Number.isFinite(raw[k])) return null;
      out[k] = clampN(raw[k]);
    }
    return out;
  }

  let lastSnapshotText = '';
  function chromeReport(raw: unknown): void {
    
    if (raw === null && chrome.snapshot) {
      chrome.snapshot = null;
      lastSnapshotText = '';
      sendReport();
      return;
    }
    const snap = validateSnapshot(raw);
    if (!snap) return;
    const text = JSON.stringify(snap);
    const first = chrome.snapshot === null;
    chrome.snapshot = snap;
    if (first && hostDrawsSave()) sendChromeAnswer();
    if (text === lastSnapshotText) return;
    lastSnapshotText = text;
    sendReport();
  }

  /** The export entries the outer Shell lists: one per format (and variant), labelled by format. */
  function exportItems(): { item: ChromeExportItem; format: string; variant?: string; interactive?: boolean }[] {
    const out: { item: ChromeExportItem; format: string; variant?: string; interactive?: boolean }[] = [];
    for (const x of chrome.snapshot?.exports ?? []) {
      if (x.disabled) continue;
      const label = x.format.toUpperCase();
      const live = (x.variants ?? []).filter((v) => !v.disabled);
      if (live.length) for (const v of live) out.push({ item: { label: `${label} (${v.id})` }, format: x.format, variant: v.id, ...(x.interactive ? { interactive: true } : {}) });
      else out.push({ item: { label, ...(x.interactive ? { description: 'Opens the page’s export options' } : {}) }, format: x.format, ...(x.interactive ? { interactive: true } : {}) });
    }
    return out;
  }

  const REQUEST = /^[A-Za-z0-9_-]{16,64}$/;

  /**
   * Starts an export in the page (`__frame_chrome_cmd {cmd:'export'}`) when the
   * format (and variant) is declared and enabled, rate-limited.
   */
  function startExport(format: string, variant: string | undefined, request: string, fromOuter: boolean): 'started' | 'busy' | 'unsupported' {
    const x = chrome.snapshot?.exports?.find((e) => e.format === format);
    if (!x || x.disabled) return 'unsupported';
    if (variant !== undefined && !(x.variants ?? []).some((v) => v.id === variant && !v.disabled)) return 'unsupported';
    const now = Date.now();
    if (now - chrome.lastExportAt < 250) return 'busy';
    if (chrome.pendingExport && now - chrome.pendingExport.at < 5000) return 'busy';
    chrome.lastExportAt = now;
    chrome.pendingExport = { request, at: now, outer: fromOuter };
    toPageCmd({ cmd: 'export', format, request, interactive: true, ...(variant ? { variant } : {}), sender: 'viewer' });
    return 'started';
  }

  /** `export {label}` from a v1 outer Shell. */
  function runExport(label: string): void {
    const hit = exportItems().find((x) => x.item.label === label);
    if (hit) startExport(hit.format, hit.variant, randomId(24), false);
  }

  /** `export_format` from the outer Shell: its request id goes to the page as it is, and the outcome back. */
  function runExportFormat(c: Extract<ChromeCommand, { cmd: 'export_format' }>): void {
    const request = typeof c.request === 'string' ? c.request : '';
    if (!REQUEST.test(request)) return;
    const variant = typeof c.variant === 'string' ? c.variant : undefined;
    const state = typeof c.format === 'string' ? startExport(c.format, variant, request, true) : 'unsupported';
    toOuter({ openArtifact: 'chrome_export', request, state });
  }

  /** The page declined an export, or its file was saved. */
  function exportEnded(request: unknown, state: 'declined' | 'done'): void {
    const pending = chrome.pendingExport;
    if (!pending || pending.request !== request) return;
    chrome.pendingExport = null;
    if (pending.outer) toOuter({ openArtifact: 'chrome_export', request: pending.request, state });
  }

  /** `action {id}` from the outer Shell: runs a declared, enabled page action. */
  function runAction(id: unknown): void {
    if (typeof id !== 'string') return;
    const action = chrome.snapshot?.actions?.find((a) => a.id === id);
    if (!action || action.disabled) return;
    const now = Date.now();
    if (now - chrome.lastActionAt < 250) return;
    chrome.lastActionAt = now;
    toPageCmd({ cmd: 'action', id });
  }

  
  const WHY_OUT: Record<string, ChromeWhy> = { needs_chat: 'needs_agent' };
  const whyOut = (why: string | undefined): ChromeWhy | undefined => (why ? (WHY_OUT[why] ?? (why as ChromeWhy)) : undefined);

  /** The snapshot's actions and export formats, as the outer Shell's report has them. */
  function snapshotChrome(snap: Snapshot | null): Pick<ChromeReport, 'saved' | 'leaveLosesWork' | 'actions' | 'formats' | 'shareNotice' | 'hasContent'> {
    if (!snap) return {};
    const actions: ChromeAction[] | undefined = snap.actions?.map((a) => {
      const why = whyOut(a.why);
      return { id: a.id, ...(a.disabled ? { disabled: true } : {}), ...(why ? { why } : {}) };
    });
    const formats: ChromeFormat[] | undefined = snap.exports?.map((x) => ({
      format: x.format,
      ...(x.disabled ? { disabled: true } : {}),
      ...(x.interactive ? { interactive: true } : {}),
      ...(x.variants?.length ? { variants: x.variants.map((v) => ({ id: v.id, ...(v.disabled ? { disabled: true } : {}) })) } : {}),
    }));
    return {
      ...(snap.saved ? { saved: snap.saved } : {}),
      ...(snap.leaveLosesWork ? { leaveLosesWork: true } : {}),
      ...(actions ? { actions } : {}),
      ...(formats ? { formats } : {}),
      ...(snap.shareNotice ? { shareNotice: snap.shareNotice as { text: string; tone: 'warning' } } : {}),
      ...(typeof snap.hasContent === 'boolean' ? { hasContent: snap.hasContent } : {}),
    };
  }

  // ---- the Open Artifact Shell (outer) ------------------------------------------------------------------------------

  const activity = { asked: false, asks: 0, working: false, timer: null as ReturnType<typeof setTimeout> | null };

  function toOuter(msg: PageToShell): void {
    if (!outer || !outerOrigin) return;
    try {
      outer.postMessage(msg, outerOrigin);
    } catch {
      // the Shell went away
    }
  }

  function sendReport(): void {
    const snap = chrome.snapshot;
    // The page's own count when it keeps comments elsewhere; ours when they are in comments.json.
    const count = session?.comments?.available ? comments.count : (snap?.unresolved ?? 0);
    const report: ChromeReport = {
      comments: { available: !!session?.comments?.available, on: comments.on, open: comments.listOpen, count, pageButton: comments.pageButton },
      agent: { available: !!session?.agent?.available, listening: false, busy: activity.working },
      history: false,
      share: false,
      shareOn: false,
      // Older Shells list these by label (`exports` / `export`); newer ones use `formats`.
      exports: exportItems().length > 0,
      ...snapshotChrome(snap),
    };
    toOuter({ openArtifact: 'chrome_report', protocol: CHROME_PROTOCOL, report });
  }

  function fromOuter(m: ShellToPage): void {
    if (m.openArtifact === 'chrome_hello') {
      const draws = new Set(Array.isArray(m.draws) ? m.draws.filter((d): d is NonNullable<typeof d> => typeof d === 'string') : []);
      const before = hostDrawsSave();
      chrome.outerDraws = draws;
      // The outer Shell started (or stopped) drawing the save state: tell the page, so it hides (or shows) its badge.
      if (hostDrawsSave() !== before && chrome.snapshot) {
        chrome.sent = Math.min(chrome.sent, 7);
        sendChromeAnswer();
      }
      return sendReport();
    }
    // This host watches the artifact's files itself (a change reloads the page here).
    if (m.openArtifact === 'files_changed') return toOuter({ openArtifact: 'files_changed_ok' });
    if (m.openArtifact !== 'chrome_cmd') return;
    const c = m as ChromeCommand;
    if (c.cmd === 'comments_mode') setMode(c.on ?? !comments.on);
    else if (c.cmd === 'comments_list') setList(c.open ?? !comments.listOpen);
    else if (c.cmd === 'exports') toOuter({ openArtifact: 'chrome_exports', id: c.id, items: exportItems().map((x) => x.item) });
    else if (c.cmd === 'export') runExport(c.label);
    else if (c.cmd === 'export_format') runExportFormat(c);
    else if (c.cmd === 'action') runAction(c.id);
  }

  async function pollActivity(): Promise<void> {
    if (activity.timer) clearTimeout(activity.timer);
    const out = await post('activity', {}).catch(() => null);
    const working = !!out?.working;
    if (working !== activity.working || activity.asked) {
      activity.asked = false;
      activity.working = working;
      toPage({ __frame_agent_activity: true, working });
      sendReport();
    }
    if (session?.agent?.available) activity.timer = setTimeout(pollActivity, 10_000);
  }

  // ---- anchors (the page's #fragment) ---------------------------------------------------------------------------------

  const RESERVED_FRAGMENT = /^(sidebar|settings|customize|upgrade|downloads)$/;
  const validFragment = (f: unknown): string => (typeof f === 'string' && /^[A-Za-z0-9._~-]{1,128}$/.test(f) && !f.startsWith('comment-') && !RESERVED_FRAGMENT.test(f) ? f : '');
  let anchorTimer: ReturnType<typeof setTimeout> | null = null;

  /** The page reports where it is: this shell's own URL follows (replaceState only; here: no pushState history). */
  function onAnchor(fragment: unknown): void {
    const frag = validFragment(fragment);
    if (anchorTimer) clearTimeout(anchorTimer);
    anchorTimer = setTimeout(() => {
      const current = location.hash.slice(1);
      if (frag === current || (!frag && current && !validFragment(current))) return;
      history.replaceState(history.state, '', `${location.pathname}${location.search}${frag ? `#${frag}` : ''}`);
    }, 250);
  }

  // ---- keys -------------------------------------------------------------------------------------------------------------

  function onEscape(): void {
    if (views?.open()) closeCard();
    else if (comments.listOpen) setList(false);
    else if (comments.on) setMode(false);
  }

  // ---- comments -----------------------------------------------------------------------------------------------------
  
  // and the list; the threads live behind the `comments` capability.

  type Point = { x: number; y: number } | null | undefined;

  
  const LINK_RETRY_MS = 300;
  const LINK_TRIES = 30;
  /** Most pins one `placed` map carries. */
  const MAX_PLACED = 256;

  const comments = {
    on: false,
    listOpen: false,
    count: 0,
    threads: [] as PageThread[],
    /** The threads were listed at least once. */
    listed: false,
    /** The page registered custom anchors (`customAnchors`). */
    custom: false,
    /** …and wants its pins drawn outside comment mode too (`pinsOutsideMode`). */
    customPins: false,
    /** …and can move a thread to where a pin is dropped (`move`). */
    movable: false,
    /** The page draws its own comments button (`__frame_comments_request {drawn}`). */
    pageButton: false,
    placed: {} as Record<string, Point>,
  };
  const sendTickets = new Map<string, (m: Any) => void>();

  /** The comment views (comments.js), mounted once the bundle is there. */
  let views: FrameCommentsUi | null | undefined;
  function ui(): FrameCommentsUi | null {
    if (views !== undefined) return views;
    const bundle = window.__openArtifactFrameComments;
    if (!bundle) return null;
    views = bundle.mount(
      $('comments-ui'),
      {
        cap: (method, arg) => cap('comments', method, arg, true),
        sendToAgent: (a) => sendToAgent(a, true),
        refresh: refreshThreads,
        agent: () => ({ available: !!session?.agent?.available, name: agentName(), ...(session?.agent?.wakesIdle === false ? { wakesIdle: false } : {}) }),
        activeChanged: () => pushThreads(),
        listChanged: (open) => setList(open),
        modeChanged: (on) => setMode(on),
        composingChanged: (open) => toPage({ __open_artifact_comments: true, op: 'composing', state: open }),
        reveal: (id) => {
          // The page only reveals threads it has.
          pushThreads();
          toPage({ __open_artifact_comments: true, op: 'reveal', id });
        },
        move: (id, at) => movePin(id, at),
        toast,
      },
      
      { launcher: !outer },
    );
    views.setThreads(comments.threads);
    views.setPlaced(comments.placed);
    views.setMode(comments.on);
    views.setPageButton(comments.pageButton);
    views.setMovable(comments.movable);
    return views;
  }
  /** The views, or a note that they did not load (frame-host from source, not built). */
  function needUi(): FrameCommentsUi | null {
    const out = ui();
    if (!out) toast('Comments need the frame client built: node scripts/build.mjs --only frame');
    return out;
  }

  function setCount(n: number): void {
    if (n === comments.count) return;
    comments.count = n;
    sendCommentsState();
    sendReport();
  }

  function sendCommentsState(): void {
    const available = !!session?.comments?.available;
    toPage({ __frame_comments: true, offered: available, available, showsList: available, on: comments.on, listOpen: comments.listOpen, count: comments.count });
  }

  function setMode(on: boolean): void {
    if (!session?.comments?.available) return;
    on = !!on;
    if (on === comments.on) return;
    comments.on = on;
    if (!on) {
      closeCard();
      if (!comments.customPins) setPlaced({});
    }
    ui()?.setMode(on);
    toPage({ __open_artifact_comments: true, op: 'mode', on });
    sendCommentsState();
    sendReport();
  }

  function setList(open: boolean): void {
    if (comments.listOpen === !!open) return;
    const views = open ? needUi() : ui();
    if (open && !views) return;
    comments.listOpen = !!open;
    views?.setList(comments.listOpen);
    sendCommentsState();
    sendReport();
  }

  /** `__frame_comments_request`: `{drawn}` the page draws its own comments button; `{show}` opens or closes the list. */
  function commentsRequest(m: Any): void {
    if (typeof m.drawn === 'boolean' && m.drawn !== comments.pageButton) {
      comments.pageButton = m.drawn;
      ui()?.setPageButton(m.drawn);
      sendReport();
    }
    if (typeof m.show === 'boolean') setList(m.show);
  }

  function setPlaced(map: Record<string, Point>): void {
    comments.placed = map;
    views?.setPlaced(map);
  }

  /** Where the page put each pin (viewport points): kept only while pins show, at most 256, each null or finite. */
  function onPlaced(raw: unknown): void {
    if (!comments.on && !comments.customPins) return;
    const out: Record<string, Point> = {};
    if (raw && typeof raw === 'object') {
      let n = 0;
      for (const [k, v] of Object.entries(raw as Record<string, Any>)) {
        if (n++ >= MAX_PLACED) break;
        out[k] = v && typeof v === 'object' && Number.isFinite(v.x) && Number.isFinite(v.y) ? { x: v.x, y: v.y } : null;
      }
    }
    setPlaced(out);
    // Pins show as soon as the page places them, before any card is opened.
    if (Object.keys(out).length) ui();
  }

  async function refreshThreads(): Promise<void> {
    if (!session?.comments?.available) return;
    try {
      const r = await cap('comments', 'list', { all: true }, true);
      comments.threads = r.threads || [];
      comments.listed = true;
    } catch {
      return;
    }
    
    setCount(comments.threads.reduce((n, t) => (t.resolved ? n : n + (t.messages?.length || 0)), 0));
    if (comments.threads.length) ui()?.setThreads(comments.threads);
    else views?.setThreads(comments.threads);
    pushThreads();
  }

  function pushThreads(): void {
    const active = views?.active() ?? null;
    toPage({ __open_artifact_comments: true, op: 'threads', threads: comments.threads.map((t) => ({ id: t.id, anchor: t.anchor, resolved: t.resolved, active: t.id === active })) });
  }

  function commentsUi(method: string, a: Any): unknown {
    if (method === 'custom') {
      comments.custom = !!a.on;
      comments.customPins = !!a.on && !!a.pins;
      comments.movable = !!a.on && !!a.move;
      views?.setMovable(comments.movable);
      if (!a.on) setPlaced({});
      // the current state right after registering.
      if (a.on && comments.on) toPage({ __open_artifact_comments: true, op: 'mode', on: true });
      if (a.on) pushThreads();
      return {};
    }
    if (method === 'mode') {
      setMode(!!a.on);
      return {};
    }
    if (method === 'placed') {
      onPlaced(a.map);
      return {};
    }
    if (method === 'compose') {
      // While registered, compose is the viewer's click: it turns comment mode on.
      if (comments.custom && a.click && !comments.on) setMode(true);
      const views = needUi();
      if (!views) return { opened: false };
      const typed = views.draftText();
      // A composer with text in it stays (an area is drawn on purpose, so it replaces it).
      if (typed !== null && typed.trim() && !a.area) return { opened: false };
      // A click while an empty composer or a card is open closes it first.
      if (a.click && !a.area && views.open()) {
        views.close();
        return { opened: false };
      }
      views.compose(a.anchor, a.at, typeof a.label === 'string' ? a.label : undefined, typeof a.detail === 'string' ? a.detail : undefined);
      return { opened: true };
    }
    if (method === 'open') {
      return { opened: !!needUi()?.openThread(String(a.id ?? ''), a.at || comments.placed[a.id]) };
    }
    return {};
  }

  /** Closes the card or composer (the views tell the page which thread is open). */
  function closeCard(): void {
    views?.close();
  }

  // A press in the page outside comment mode: the card closes, and an empty composer.
  window.addEventListener('blur', () => {
    setTimeout(() => {
      if (!comments.on && frame && document.activeElement === frame) views?.outsidePress();
    });
  });

  /** A pin dropped at a viewport point: the page says what is there, then the thread moves. */
  let moveSeq = 0;
  const moves = new Map<number, string>();
  function movePin(id: string, at: { x: number; y: number }): void {
    if (!comments.movable) return;
    const n = ++moveSeq;
    moves.set(n, id);
    setTimeout(() => moves.delete(n), 5000);
    toPage({ __open_artifact_comments: true, op: 'move', n, id, x: at.x, y: at.y });
  }
  async function onMoved(m: Any): Promise<void> {
    const id = moves.get(m.n);
    moves.delete(m.n);
    if (!id || m.refused || m.anchor === undefined) return;
    try {
      await cap('comments', 'move', { threadId: id, anchor: m.anchor, ...(typeof m.label === 'string' ? { label: m.label } : {}), ...(typeof m.detail === 'string' ? { detail: m.detail } : {}) }, true);
    } catch (error) {
      toast((error as Any)?.message || 'Could not move the comment.');
    }
    void refreshThreads();
  }

  function boundedCommentText(value: unknown, maxBytes: number): string | undefined {
    if (typeof value !== 'string' || value.length > maxBytes || !value.trim()) return undefined;
    return new TextEncoder().encode(value).length <= maxBytes ? value : undefined;
  }

  const agentName = (): string => session?.agent?.name || 'the agent';

  /** A comment for the agent: a page that takes it itself (onSendToAgent) says so; otherwise the server wakes the agent. */
  /** `own`: from the shell's comments UI (see {@link cap}); a page's call returns what the page may see. */
  async function sendToAgent(a: Record<string, unknown>, own = false): Promise<unknown> {
    const ticket = randomId(10);
    const asked = new Promise<Any>((resolve) => {
      let timer = setTimeout(() => {
        if (sendTickets.delete(ticket)) resolve({ handled: false });
      }, 1500);
      sendTickets.set(ticket, (m) => {
        if (m?.pending === true) {
          // The page's listeners are working on it: give them two minutes.
          clearTimeout(timer);
          timer = setTimeout(() => {
            if (sendTickets.delete(ticket)) resolve({ handled: false });
          }, 120_000);
          return;
        }
        clearTimeout(timer);
        resolve(m);
      });
    });
    toPage({ __open_artifact_comments: true, op: 'send', ticket, payload: a });
    const r = await asked;
    const reply = boundedCommentText(r?.reply, 500);
    if (r?.handled === true) return { status: 'handled', ...(reply && { reply }) };
    const handoffNote = boundedCommentText(r?.handoffNote, 2000);
    const out = await cap('comments', 'sendToAgent', { ...a, handoffNote }, own);
    void refreshThreads();
    return reply ? { ...out, reply } : out;
  }

  /** `?comment=<id>`: the thread is shown once the threads are listed, retried until the page placed its pin. */
  let askedThreadDone = false;
  function openAskedThread(): void {
    const id = params.get('comment');
    if (!id || askedThreadDone) return;
    askedThreadDone = true;
    const url = new URL(location.href);
    url.searchParams.delete('comment');
    history.replaceState(history.state, '', url.href);
    const start = (waits: number): void => {
      if (!comments.listed) {
        if (waits > 0) setTimeout(() => start(waits - 1), LINK_RETRY_MS);
        return;
      }
      const t = comments.threads.find((x) => x.id === id || x.id.startsWith(id));
      if (!t) return;
      const attempt = (n: number): void => {
        needUi()?.show(t.id);
        if (comments.placed[t.id] || n <= 1) return;
        setTimeout(() => attempt(n - 1), LINK_RETRY_MS);
      };
      attempt(LINK_TRIES);
    };
    start(LINK_TRIES);
  }

  // ---- problems, toasts ---------------------------------------------------------------------------------------------

  function showProblem(title: string, text: string): void {
    $('problemTitle').textContent = title;
    $('problemText').textContent = text;
    $('problemAgent').hidden = !session?.agent?.available;
    $('problemNote').textContent = '';
    $('problem').hidden = false;
    shows('problem');
  }
  const hideProblem = (): void => {
    $('problem').hidden = true;
    if (document.documentElement.dataset.openArtifactShell === 'problem') shows(null);
  };
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  function toast(text: string): void {
    // A snapshot's picture has nothing of the shell's own on it.
    if (session?.snapshot) return;
    const t = $('toast');
    t.textContent = text;
    t.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 3500);
  }

  $('problemReload').onclick = () => {
    hideProblem();
    reloadPage(ver);
  };
  $('problemAgent').onclick = async () => {
    const b = $<HTMLButtonElement>('problemAgent');
    b.disabled = true;
    const out = await post('agent', { text: `The ${session?.key} page of this artifact did not start within ${session?.readyTimeoutS} seconds. Please look at why.` }).catch((e) => ({ error: e }));
    b.disabled = false;
    $('problemNote').textContent = out?.error ? `Could not reach the agent: ${out.error.message || out.error}` : 'The agent has been asked.';
  };
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') onEscape();
  });
  document.addEventListener('visibilitychange', () => toPage({ __frame_host_visible: { visible: hostVisible() } }));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => toPage({ __frame_theme: { theme: theme() } }));
  window.addEventListener('resize', () => toPage(viewportMessage()));
  window.addEventListener('pageshow', () => {
    chrome.sent = Math.min(chrome.sent, 7);
    if (chrome.snapshot) sendChromeAnswer();
  });
  window.addEventListener('popstate', () => {
    const frag = validFragment(location.hash.slice(1));
    if (frag) toPage({ __frame_anchor_goto: { fragment: frag } });
  });

  // ---- start --------------------------------------------------------------------------------------------------------

  void (async () => {
    try {
      const r = await fetch(api('session'), { credentials: 'same-origin' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      session = (await r.json()) as FrameSession;
    } catch (error) {
      showProblem('This artifact cannot open', `The type server did not answer (${(error as Error)?.message || error}).`);
      return;
    }
    if (outerPending && session.outerOrigins?.includes(askedOuter)) {
      outerOrigin = askedOuter;
      outer = window.parent;
    }
    const early = outer ? outerEarly.splice(0) : [];
    outerEarly.length = 0;
    contentOrigin = session.contentOrigin;
    ver = session.ver;
    gen = session.brokerGen;
    document.title = session.title || 'Artifact';
    comments.count = session.comments?.count || 0;
    openStream();
    mountPage();
    // No outer Shell: the views (and their launcher) are there from the start.
    if (!outer && session.comments?.available) ui();
    sendReport();
    for (const m of early) fromOuter(m as ShellToPage);
  })();
})();
