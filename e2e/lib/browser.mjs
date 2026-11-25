// Headless Chrome over the DevTools protocol, with Node's own WebSocket: no Playwright, nothing to install.
//
// findChrome() → the Chrome to run (E2E_CHROME, else the usual places), or null when there is none.
// launch() → a browser; browser.load(url, {ready}) opens a tab and returns once `ready` (an expression) is truthy in
// the page or in any of its frames, sandboxed and out-of-process ones too (never in a worker: workers are watched for
// problems, not asked). `page.problems` is what went wrong on the
// way, in the page and its frames: uncaught exceptions, console errors, failed requests and HTTP errors; `page.urls`
// every URL it requested. Both keep filling while the page stays open.
// An editor that shows its crash card, or whose React root went empty after it had drawn something (what React
// leaves after an uncaught render error with no error boundary; see findCrash), is a problem too, `crashed: …`,
// reported the moment it happens; `page.crashed()` looks at every frame now, and `crashes()` hands over the crashes on
// every page of every browser in this process not yet handed over (editor.mjs's failOnCrash fails the case with them).
// A tab whose renderer crashed, or that Chrome let go of while the page was still in use, is a problem too (`tab gone:
// …`); a call on a tab that is gone fails with what became of it (closed by the test, crashed, let go of, Chrome gone).
// Input goes through the DevTools protocol as real events: `page.click`, `page.clickTimes` (2 = a word, 3 = a
// paragraph), `page.rightClick` (a context menu), `page.hover` (the mouse over a point, nothing pressed),
// `page.dragMouse` (pressed, moved, let go), `page.type` (keys, to whatever has focus), `page.press` (a named key or a
// shortcut) and `page.typeIme` (composed text, as pinyin sends it). E2E_HEADFUL=1 runs Chrome with a window, to watch a
// case; the default is headless.
//
// A DevTools call Chrome does not answer within a bound (E2E_CALL_TIMEOUT_MS, default 60 s; `launch({callTimeout})`,
// or per call) fails naming the call, and is a problem on its page (`unanswered: …`), so a test that would hang fails
// and says why. That error, and `outstanding()` (printed by `browser.close()` when calls are still waiting, as after a
// test timed out), list every call still waiting (method, session, context, age) and the last frame and context events
// of each session involved.
//
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

export function findChrome() {
  if (process.env.E2E_CHROME) return fs.existsSync(process.env.E2E_CHROME) ? process.env.E2E_CHROME : null;
  return CANDIDATES.find(p => fs.existsSync(p)) ?? null;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Whether the editor in this frame crashed, or null. Run in the frame (it is passed in as source, so it closes over
 * nothing). An editor with an error boundary (design, slides) shows a card marked `data-testid="<type>-crashed"`
 * instead of what failed to render. One without renders into `#root`, where an uncaught render error unmounts the whole
 * tree and leaves `#root` empty: the whole page is blank and cannot be used. A root that never drew anything yet (still
 * loading) is not a crash; one that drew and then went empty is. Artboard frames have no `#root` and are passed over.
 */
function findCrash() {
  if (typeof document === 'undefined') return null;
  const card = document.querySelector('[data-testid$="-crashed"]');
  if (card) return `the editor showed its crash card, ${card.getAttribute('data-testid')} (in ${location.href.slice(0, 160)})`;
  const root = document.getElementById('root');
  if (!root) return null;
  const drawn = Symbol.for('open-artifact e2e root drawn');
  if (root.childElementCount > 0) {
    globalThis[drawn] = true;
    return null;
  }
  return globalThis[drawn] ? `the editor's React root went empty, as an uncaught render error leaves it (in ${location.href.slice(0, 160)})` : null;
}

/** Why a call on a tab that crashed or was let go of fails (it would otherwise wait for an answer that never comes). */
const TAB_GONE = 'the tab went away';
/**
 * Why a call on a frame that went away fails: a frame in a process of its own (its own DevTools session) that was
 * removed, navigated away or crashed while a call on it was waiting. Chrome never answers such a call.
 */
export const FRAME_GONE = 'the frame was detached';

/** The binding a frame calls with findCrash's answer (Runtime.addBinding: a function on its global object). */
const CRASH_BINDING = '__openArtifactE2ePageCrashed';

/** Installed in every frame's main world: tell CRASH_BINDING once when findCrash first answers. */
function watchCrash(binding, find) {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  const key = Symbol.for('open-artifact e2e crash watch');
  if (globalThis[key]) return;
  Object.defineProperty(globalThis, key, { value: true });
  const observer = new MutationObserver(() => check());
  const check = () => {
    const what = find();
    if (what === null) return;
    observer.disconnect();
    globalThis[binding]?.(what);
  };
  observer.observe(document, { subtree: true, childList: true });
  check();
}

const CRASH_FIND = `(${findCrash})()`;
const CRASH_WATCH = `(${watchCrash})(${JSON.stringify(CRASH_BINDING)}, ${findCrash})`;

/** `promise`, or `fallback` once `ms` have gone by (a page held by a dialog never answers an evaluate). */
const within = (promise, ms, fallback) => Promise.race([promise, sleep(ms).then(() => fallback)]);

/** How long a DevTools call may go unanswered before it fails (a diagnostic bound: Chrome answers in milliseconds). */
const CALL_TIMEOUT_MS = Number(process.env.E2E_CALL_TIMEOUT_MS) || 60000;
/** Events kept per session for the report of an unanswered call: how frames and contexts came and went. */
const RECENT_EVENTS = 24;
const KEPT_EVENT = /^(Target\.(attachedToTarget|detachedFromTarget|targetDestroyed|targetCrashed)|Inspector\.|Page\.(frameNavigated|frameDetached|frameAttached|navigatedWithinDocument|loadEventFired)|Runtime\.(executionContext|exceptionThrown))/;
const browsersOpen = new Set(); // every open browser's `outstanding` report

/** Every DevTools call still waiting in any browser of this process, with each session's last events; '' when none. */
export function outstanding() {
  return [...browsersOpen].map(report => report()).filter(Boolean).join('\n');
}

const pagesOpen = new Set(); // every browser's open pages
const pagesStuck = new WeakSet(); // ones that did not answer crashes(): not asked again
const crashLog = []; // crashes on any page, open or closed, not yet handed over by crashes()

/**
 * Every crash on any page in this process (`crashed: …`, as in its `problems`) since the last call, closed pages' too.
 * Each open page is looked at now (one that does not answer, held by a dialog, is passed over from then on), and a
 * crash is handed over once.
 */
export async function crashes() {
  for (const page of [...pagesOpen]) {
    if (pagesStuck.has(page)) continue;
    if ((await within(page.crashed().then(() => true, () => true), 3000, false)) === false) pagesStuck.add(page);
  }
  return crashLog.splice(0);
}

/**
 * `args`: more Chrome switches, such as `--host-resolver-rules=MAP *.lan 127.0.0.1` for made-up LAN names.
 * `callTimeout`: ms a DevTools call may wait for its answer (0: for ever).
 */
export async function launch({ chrome = findChrome(), width = 1440, height = 900, args = [], callTimeout = CALL_TIMEOUT_MS } = {}) {
  if (!chrome) throw new Error('no Chrome found (set E2E_CHROME)');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'open-artifact-e2e-chrome-'));
  // 2026-11-02: stderr goes to a file, not a pipe. Chrome's crash handler and Google's updater inherit it and can outlive
  // Chrome by minutes; while one held a pipe open, the test file could not exit, however its cases went.
  const stderr = path.join(profile, 'chrome-stderr.log');
  const fd = fs.openSync(stderr, 'a');
  const child = spawn(chrome, [
    ...(process.env.E2E_HEADFUL ? [] : ['--headless=new']), '--remote-debugging-port=0', `--user-data-dir=${profile}`, `--window-size=${width},${height}`,
    // Keep the test profile independent of the macOS login keychain.
    ...(process.platform === 'darwin' ? ['--use-mock-keychain'] : []),
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking',
    '--disable-sync', '--disable-component-update', '--mute-audio', ...args, 'about:blank',
  ], { stdio: ['ignore', 'ignore', fd] });
  fs.closeSync(fd);
  // A test file that is signalled runs no `after` hook, so the browser goes when the process does (see target.mjs).
  const removeProfile = () => fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  const atExit = () => {
    child.kill('SIGKILL');
    removeProfile();
  };
  process.on('exit', atExit);
  let ws;
  try {
    const endpoint = await new Promise((resolve, reject) => {
      const text = () => fs.readFileSync(stderr, 'utf8');
      const settle = (fn, value) => {
        clearInterval(poll);
        clearTimeout(timer);
        child.off('exit', onExit);
        fn(value);
      };
      const onExit = code => settle(reject, new Error(`Chrome exited (${code}): ${text().slice(-500)}`));
      const poll = setInterval(() => {
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(text());
        if (m) settle(resolve, m[1]);
      }, 50);
      const timer = setTimeout(() => settle(reject, new Error(`Chrome did not start: ${text().slice(-500)}`)), 20000);
      child.on('exit', onExit);
    });
    ws = new WebSocket(endpoint);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', () => reject(new Error('could not connect to Chrome')), { once: true });
    });
  } catch (e) {
    process.off('exit', atExit);
    atExit();
    throw e;
  }

  let chromeExit = null; // {code, signal, at} once Chrome is gone
  let closingAt = null; // when browser.close() was called
  child.on('exit', (code, signal) => (chromeExit = { code, signal, at: Date.now() }));
  let nextId = 1;
  const pending = new Map(); // id → {resolve, reject, method, sessionId, contextId, what, at, timer, onUnanswered}
  const listeners = new Set();
  const pages = new Set(); // this browser's open pages (also in pagesOpen)
  const recent = new Map(); // session ('browser' for none) → its last frame/context events, oldest first
  const labels = new Map(); // session → what it is ('tab <url>', 'iframe <url>', 'worker <url>')
  /** Keep `msg` (an event) in its session's ring of recent events. Cheap: only frame and context events are kept. */
  const remember = msg => {
    if (!KEPT_EVENT.test(msg.method)) return;
    const key = msg.sessionId ?? 'browser';
    let ring = recent.get(key);
    if (!ring) recent.set(key, (ring = []));
    ring.push({ at: Date.now(), method: msg.method, params: msg.params });
    if (ring.length > RECENT_EVENTS) ring.shift();
  };
  /** The answer (or error) to call `id` arrived, or it was given up: it stops waiting. */
  const settle = id => {
    const p = pending.get(id);
    if (!p) return null;
    pending.delete(id);
    clearTimeout(p.timer);
    return p;
  };
  ws.addEventListener('message', event => {
    const msg = JSON.parse(String(event.data));
    if (msg.id !== undefined) {
      const p = settle(msg.id);
      if (!p) return;
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
      else p.resolve(msg.result);
    } else {
      remember(msg);
      for (const fn of listeners) fn(msg);
    }
  });
  // Once the connection to Chrome is gone, nothing more will answer: what was waiting fails, and so does what comes later.
  const CLOSED = 'the connection to Chrome closed';
  ws.addEventListener('close', () => {
    for (const id of [...pending.keys()]) {
      const p = settle(id);
      p.reject(new Error(`${p.method}: ${CLOSED}`));
    }
  });
  const short = id => (id ? `${id.slice(0, 8)}…` : 'browser');
  const sessionName = id => `${short(id)}${labels.has(id) ? ` (${labels.get(id)})` : ''}`;
  const brief = params => {
    if (!params) return '';
    const parts = [];
    if (params.executionContextId !== undefined) parts.push(`context ${params.executionContextId}`);
    if (params.context) parts.push(`context ${params.context.id}${params.context.auxData?.isDefault ? ' (default)' : ''} ${params.context.origin}`);
    if (params.sessionId) parts.push(`session ${short(params.sessionId)}`);
    if (params.targetInfo) parts.push(`${params.targetInfo.type} ${params.targetInfo.url.slice(0, 100)}`);
    if (params.targetId && !params.targetInfo) parts.push(`target ${params.targetId.slice(0, 8)}…`);
    if (params.frame) parts.push(`frame ${params.frame.id.slice(0, 8)}…${params.frame.parentId ? '' : ' (main)'} ${params.frame.url.slice(0, 100)}`);
    if (params.frameId && !params.frame) parts.push(`frame ${params.frameId.slice(0, 8)}…${params.reason ? ` (${params.reason})` : ''}`);
    if (params.reason && !params.frameId) parts.push(params.reason);
    return parts.join(', ');
  };
  /** The calls still waiting and the last events of each session they wait on (and the browser's own); '' when none. */
  const report = () => {
    const now = Date.now();
    const waiting = [...pending.entries()].filter(([, p]) => p.method !== 'Browser.close');
    if (!waiting.length) return '';
    const lines = [`outstanding DevTools calls (browser pid ${child.pid}): ${waiting.length}`];
    const involved = new Set(['browser']);
    for (const [id, p] of waiting) {
      involved.add(p.sessionId ?? 'browser');
      lines.push(`  #${id} ${p.method} on ${sessionName(p.sessionId)}${p.contextId !== undefined ? `, context ${p.contextId}` : ''}, waiting ${now - p.at} ms${p.what ? `: ${p.what}` : ''}`);
    }
    for (const key of involved) {
      const ring = recent.get(key) ?? [];
      lines.push(`  last events of ${key === 'browser' ? 'the browser' : sessionName(key)}:${ring.length ? '' : ' none'}`);
      for (const e of ring) lines.push(`    ${e.at - now} ms ${e.method} ${brief(e.params)}`);
    }
    return lines.join('\n');
  };
  browsersOpen.add(report);
  /**
   * Call `method` on `sessionId` (the browser's own session when omitted). `what`: what an evaluate runs, for the
   * error if its frame goes away first. `timeout`: ms to wait for the answer (0: for ever); past it the call fails
   * naming itself and the report above, and `onUnanswered` (a page's) is told.
   */
  const send = (method, params = {}, sessionId, what, { timeout = callTimeout, onUnanswered } = {}) => new Promise((resolve, reject) => {
    if (ws.readyState !== WebSocket.OPEN) return reject(new Error(`${method}: ${CLOSED}`));
    const id = nextId++;
    const entry = { resolve, reject, method, sessionId, contextId: params.contextId, what, at: Date.now(), timer: null };
    if (timeout > 0) {
      entry.timer = setTimeout(() => {
        const dump = report();
        if (!settle(id)) return;
        const text = `${method} on ${sessionName(sessionId)} got no answer from Chrome in ${timeout} ms${what ? ` (evaluating: ${what})` : ''}`;
        onUnanswered?.(text);
        // Printed too: a caller that catches the error (a retry loop) must not hide why the call hung.
        console.log(`# ${text}\n${dump}`.replace(/\n/g, '\n# '));
        reject(new Error(`${text}\n${dump}`));
      }, timeout);
    }
    pending.set(id, entry);
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  /**
   * Fail what waits on a session that will not answer any more (a crashed tab, a frame that was removed: Chrome never
   * answers those), or, with `contextId`, only what runs in that execution context of it.
   */
  const dropSession = (sessionId, why, contextId) => {
    for (const [id, p] of [...pending]) {
      if (p.sessionId !== sessionId) continue;
      if (contextId !== undefined && p.contextId !== contextId) continue;
      settle(id);
      p.reject(new Error(`${p.method}: ${why}${p.what ? ` while evaluating: ${p.what}` : ''}`));
    }
  };
  // Target.targetDestroyed is sent only to a client that discovers targets.
  await send('Target.setDiscoverTargets', { discover: true });

  /**
   * Open `url` in a new tab. `ready`: an expression, true in the page or one of its frames once it is up.
   * `ignore`: regexps for problems that are expected. `userAgent`: the tab's user agent, in its requests and
   * `navigator.userAgent` (a host browser that is not Chrome). `cache: false`: the tab and its frames and workers
   * take nothing from the HTTP cache, so it fetches every file as a browser that never loaded the page would (built
   * files are kept for good, and an earlier tab of this browser may hold them). Returns {problems, evaluate,
   * evaluateAll, crashed, click, close}.
   */
  async function load(url, { ready = 'true', timeout = 30000, settle = 1000, ignore = [], userAgent, cache = true } = {}) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId: top } = await send('Target.attachToTarget', { targetId, flatten: true });
    const sessions = new Set([top]);
    const parents = new Map(); // a frame's or worker's session → the session it was attached under
    const targets = new Map(); // target id → its session
    targets.set(targetId, top);
    labels.set(top, `tab ${url.slice(0, 100)}`);
    const contexts = new Map(); // `${session} ${contextId}` → {session, id}: the frames' contexts, never a worker's
    const kinds = new Map(); // an attached session → its target's type ('iframe', 'worker', …)
    const requests = new Map();
    const urls = new Set();
    const problems = [];
    const crashesSeen = new Set();
    const openedAt = Date.now();
    let closedAt = null; // when page.close() was called
    let gone = null; // {why, at}: the tab crashed or Chrome let go of it
    let loaded = false;
    const add = text => {
      if (!ignore.some(re => re.test(text))) problems.push(text);
    };
    /** `send` for this page: a call Chrome never answers is a problem of the page (never ignored). */
    const call = (method, params, session, what, options = {}) => send(method, params, session, what, { onUnanswered: text => problems.push(`unanswered: ${text}`), ...options });
    /** A crash findCrash saw, once per page: a problem, and in crashLog for crashes(). */
    const noteCrash = what => {
      if (typeof what !== 'string' || crashesSeen.has(what)) return;
      crashesSeen.add(what);
      const text = `crashed: ${what}`;
      if (ignore.some(re => re.test(text))) return;
      problems.push(text);
      crashLog.push(text);
    };
    /** The tab crashed, or Chrome let go of it, while the page was still in use: a problem, and why for a later call. */
    const noteGone = why => {
      if (gone || closedAt || closingAt) return;
      gone = { why, at: Date.now() };
      add(`tab gone: ${why}`);
      dropSession(top, TAB_GONE);
    };
    /**
     * Frames whose renderer crashed (`renderer crashed: <frame>`), each also a problem of the page. Chrome draws such a
     * frame as gone and the page around it carries on, so without this a test sees only a frame that is not there (a
     * wait that times out, `inFrame` finding nothing). `waitFor` and `inFrame` name these when they give up.
     * 2026-11-22: the whiteboard's content frame on the Cloudflare suites, about one load in ten under load and once in
     * a plain full run: Chrome 157.0.8103.80 stopped the renderer at a CHECK of its own (`brk #0` in Google Chrome
     * Framework +0x12622ac, no out-of-memory keys in the minidump), the same place in every dump.
     */
    const crashedFrames = [];
    const noteFrameCrash = (session, detail = '') => {
      const what = `renderer crashed: ${labels.get(session) ?? session}${detail}`;
      if (crashedFrames.some(c => c.startsWith(`renderer crashed: ${labels.get(session) ?? session}`))) return;
      crashedFrames.push(what);
      problems.push(what);
    };
    /**
     * A frame's session ended (removed, navigated away, crashed): its contexts go, what waits on it fails, and so does
     * every session attached under it (a worker of that frame, a frame inside it).
     * 2026-11-22: Chrome does not always say so of those. A content frame's drawing worker, attached under the frame's
     * session, got no detach when the guest's tab navigated to sign-in; an evaluate sent to it then was never answered
     * and held the test until its timeout (`e2e/cloudflare-host.test.mjs` step 7, about one run in ten).
     */
    const endSession = (session, why) => {
      if (session === top || !sessions.has(session)) return;
      sessions.delete(session);
      for (const [key, c] of contexts) if (c.session === session) contexts.delete(key);
      dropSession(session, why);
      for (const [child, parent] of [...parents]) {
        if (parent !== session) continue;
        parents.delete(child);
        endSession(child, `${why} (the frame it belonged to went)`);
      }
    };
    /**
     * The tab's main frame loaded another document: every frame and worker of the old one went with it, whether or not
     * Chrome says so of each. A session attached from now on belongs to the new document; those already here do not.
     */
    const endChildSessions = why => {
      for (const session of [...sessions]) if (session !== top) endSession(session, why);
    };
    /**
     * Whether a session's contexts are asked by evaluateFrames, evaluateAll, waitFor and `ready`: the tab's and its
     * frames', not a worker's or a worklet's. Those calls ask "every frame", and what they ask is written for a page.
     * 2026-11-23: asking a worker also crashed the renderer. Chrome 157.0.8103.80 stops it at a CHECK of its own when
     * `location` is read in a module worker whose script has not all arrived (`WorkerGlobalScope.location`, in every
     * minidump: Google Chrome Framework +0x12622ac), and the suites' usual question starts with `location.hostname`.
     * The whiteboard starts a module worker (`whiteboard-looks`) while a test still waits for the board, so its content
     * frame went, about one first load in four on the Cloudflare suites, where the script takes longest to arrive
     * (`renderer crashed: iframe …/whiteboard/…` in `cloudflare-link`). `e2e/browser-lib.test.mjs` holds a worker's
     * script back and asks.
     */
    const askable = session => session === top || ['page', 'iframe'].includes(kinds.get(session));
    const enable = session => Promise.all([
      // Before Runtime.enable, so the frames' contexts have it by the time CRASH_WATCH goes into them.
      call('Runtime.addBinding', { name: CRASH_BINDING }, session),
      call('Runtime.enable', {}, session),
      call('Inspector.enable', {}, session),
      call('Log.enable', {}, session),
      call('Network.enable', {}, session),
      call('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, session),
      ...(cache ? [] : [call('Network.setCacheDisabled', { cacheDisabled: true }, session).catch(() => {})]),
    ]).catch(() => {});
    const onEvent = msg => {
      const session = msg.sessionId;
      const p = msg.params;
      // The tab's own session is attached from the browser, so Chrome says it let go of it there.
      if (session === undefined && msg.method === 'Target.detachedFromTarget') {
        if (p.sessionId === top) noteGone('Chrome detached from the tab');
        else endSession(p.sessionId, FRAME_GONE);
      }
      if (session === undefined && msg.method === 'Target.targetCrashed' && targets.has(p.targetId) && targets.get(p.targetId) !== top) {
        noteFrameCrash(targets.get(p.targetId), ` (${p.status}, error code ${p.errorCode})`);
      }
      // The target behind a session is gone: nothing will answer on that session, detach or not.
      if (session === undefined && msg.method === 'Target.targetDestroyed' && targets.has(p.targetId)) {
        const ended = targets.get(p.targetId);
        targets.delete(p.targetId);
        if (ended === top) noteGone('Chrome destroyed the tab');
        else endSession(ended, `${FRAME_GONE} (its target was destroyed)`);
      }
      if (!sessions.has(session)) return;
      switch (msg.method) {
        case 'Inspector.targetCrashed':
          if (session === top) noteGone('its renderer crashed');
          else {
            noteFrameCrash(session);
            endSession(session, `${FRAME_GONE} (its renderer crashed)`);
          }
          break;
        case 'Inspector.detached':
          if (session === top) noteGone(`Chrome detached from the tab (${p.reason})`);
          else endSession(session, `${FRAME_GONE} (${p.reason})`);
          break;
        case 'Target.attachedToTarget':
          // A frame in a process of its own (a sandboxed iframe, a worker): watch it like the page.
          sessions.add(p.sessionId);
          parents.set(p.sessionId, session);
          kinds.set(p.sessionId, p.targetInfo.type);
          targets.set(p.targetInfo.targetId, p.sessionId);
          labels.set(p.sessionId, `${p.targetInfo.type} ${p.targetInfo.url.slice(0, 100)}`);
          enable(p.sessionId);
          break;
        case 'Target.targetInfoChanged':
          if (targets.has(p.targetInfo.targetId) && targets.get(p.targetInfo.targetId) !== top) labels.set(targets.get(p.targetInfo.targetId), `${p.targetInfo.type} ${p.targetInfo.url.slice(0, 100)}`);
          break;
        case 'Target.detachedFromTarget':
          endSession(p.sessionId, FRAME_GONE);
          break;
        case 'Page.loadEventFired':
          loaded = true;
          break;
        case 'Page.frameNavigated':
          if (session === top && !p.frame.parentId) endChildSessions(`${FRAME_GONE} (the tab loaded ${p.frame.url.slice(0, 100)})`);
          break;
        case 'Runtime.executionContextCreated':
          // A worker is watched (its errors, its requests, its crash) and never asked: see askable.
          if (!askable(session)) break;
          contexts.set(`${session} ${p.context.id}`, { session, id: p.context.id });
          // A frame's own world (not an isolated one): watch it for a crash from now on.
          if (p.context.auxData?.isDefault) call('Runtime.evaluate', { expression: CRASH_WATCH, contextId: p.context.id }, session).catch(() => {});
          break;
        case 'Runtime.bindingCalled':
          if (p.name === CRASH_BINDING) noteCrash(p.payload);
          break;
        case 'Runtime.executionContextDestroyed':
          contexts.delete(`${session} ${p.executionContextId}`);
          dropSession(session, `${FRAME_GONE} (its context was destroyed)`, p.executionContextId);
          break;
        case 'Runtime.executionContextsCleared':
          for (const [key, c] of contexts) {
            if (c.session !== session) continue;
            contexts.delete(key);
            dropSession(session, `${FRAME_GONE} (it navigated away)`, c.id);
          }
          if (session === top) endChildSessions(`${FRAME_GONE} (the tab navigated away)`);
          break;
        case 'Runtime.exceptionThrown': {
          const d = p.exceptionDetails;
          add(`exception: ${(d.exception?.description ?? d.text).split('\n').slice(0, 3).join(' | ')}`);
          break;
        }
        case 'Runtime.consoleAPICalled':
          if (p.type === 'error' || p.type === 'assert') {
            add(`console.${p.type}: ${p.args.map(a => a.value ?? a.description ?? a.type).join(' ')}`.slice(0, 400));
          }
          break;
        case 'Log.entryAdded':
          // Network errors are reported below, with their URL.
          if (p.entry.level === 'error' && p.entry.source !== 'network') add(`log: ${p.entry.text}`.slice(0, 400));
          break;
        case 'Network.requestWillBeSent':
          requests.set(p.requestId, p.request.url);
          urls.add(p.request.url);
          break;
        case 'Network.responseReceived':
          if (p.response.status >= 400) add(`HTTP ${p.response.status}: ${p.response.url}`);
          break;
        case 'Network.loadingFailed':
          if (!p.canceled) add(`failed (${p.errorText}): ${requests.get(p.requestId) ?? p.requestId}`);
          break;
      }
    };
    listeners.add(onEvent);

    /**
     * `send` on the tab's own session. A call on a tab that is gone ("Session with given id not found") fails with what
     * became of it, so a case that dies on one says whether the test closed the tab, it crashed, or Chrome let go of it.
     */
    const onTop = async (method, params, what, options) => {
      if (gone) throw await whyGone(new Error(`${method}: ${TAB_GONE}`));
      return call(method, params, top, what, options).catch(async e => {
        throw /Session with given id not found|No session with given id|Target closed|connection to Chrome closed|the tab went away/i.test(e.message) ? await whyGone(e) : e;
      });
    };
    async function whyGone(e) {
      const now = Date.now();
      const ago = at => `${now - at} ms ago`;
      const facts = [`opened ${ago(openedAt)} (${url})`];
      facts.push(closedAt ? `page.close() was called ${ago(closedAt)}` : 'page.close() was not called');
      facts.push(gone ? `${gone.why}, ${ago(gone.at)}` : 'Chrome sent no word of the tab crashing or being let go of');
      if (closingAt) facts.push(`browser.close() was called ${ago(closingAt)}`);
      if (chromeExit) facts.push(`Chrome exited (${chromeExit.signal ?? chromeExit.code}) ${ago(chromeExit.at)}`);
      else {
        const infos = await within(send('Target.getTargets').then(r => r.targetInfos, () => null), 2000, null);
        facts.push(infos === null ? 'Chrome did not answer Target.getTargets' : infos.some(t => t.targetId === targetId) ? 'the tab is still open in Chrome' : 'the tab is no longer open in Chrome');
      }
      const recent = problems.slice(-8);
      return new Error(`${e.message}\n  what became of the tab:\n    ${facts.join('\n    ')}${recent.length ? `\n  last problems:\n    ${recent.join('\n    ')}` : ''}`, { cause: e });
    }

    /**
     * Evaluate in every frame's main world: `values`, one per frame that answered, and `detached`, why a frame went
     * away (removed, navigated, crashed) before it answered (FRAME_GONE: the caller may look for the frame again).
     * Frames only: a worker is never asked (see askable).
     * `timeout`: ms each frame may take to answer (the browser's call bound by default). `userGesture`: run as if from
     * a click.
     */
    async function evaluateFrames(expression, { timeout, userGesture = false } = {}) {
      const values = [];
      const detached = [];
      const what = expression.slice(0, 80);
      for (const { session, id } of [...contexts.values()]) {
        try {
          // userGesture: the frame gets transient activation, as from a click (a popup or a top navigation may need it).
          const params = { expression, contextId: id, returnByValue: true, awaitPromise: true, ...(userGesture ? { userGesture: true } : {}) };
          const r = await (session === top ? onTop('Runtime.evaluate', params, what, { timeout }) : call('Runtime.evaluate', params, session, what, { timeout }));
          if (!r.exceptionDetails) values.push(r.result?.value);
        } catch (e) {
          if (/the frame was detached|Execution context was destroyed|Cannot find context|Session with given id not found|No session with given id/i.test(e.message)) detached.push(e.message);
        }
      }
      return { values, detached };
    }
    /** Evaluate in every frame's main world; one value per frame that answered. */
    async function evaluateAll(expression, options) {
      return (await evaluateFrames(expression, options)).values;
    }
    /**
     * What the first frame fallen to its error boundary shows (see findCrash), or null. Looks now, in every frame; the
     * watch in each frame reports the same into `problems` by itself, a moment after it shows.
     */
    async function crashed() {
      const found = (await evaluateAll(CRASH_FIND)).filter(v => typeof v === 'string');
      for (const what of found) noteCrash(what);
      return found[0] ?? null;
    }
    /** Evaluate in the page itself. `timeout`: ms it may take (the browser's call bound by default). */
    async function evaluate(expression, { timeout } = {}) {
      const r = await onTop('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, expression.slice(0, 80), { timeout });
      if (r.exceptionDetails) throw new Error(`${expression}: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
      return r.result?.value;
    }
    /** Wait until `expression` is truthy in some frame; false after `ms`. */
    async function waitFor(expression, ms = timeout) {
      const until = Date.now() + ms;
      while (Date.now() < until) {
        if ((await evaluateAll(`Boolean(${expression})`)).includes(true)) return true;
        await sleep(200);
      }
      // Not a page that is slow: a frame of it is gone for good.
      if (crashedFrames.length) throw new Error(`waiting for ${expression.slice(0, 120)}: ${crashedFrames.join('; ')}`);
      return false;
    }
    /**
     * Click with the real mouse at (x, y) in the page's viewport: Chrome finds the frame there, out-of-process ones too.
     * `{meta: true}` holds Command (Control on other systems' shortcuts: `{ctrl: true}`), as ⌘-click on a link does.
     */
    async function click(x, y, { ctrl = false, meta = false, shift = false } = {}) {
      const modifiers = (ctrl ? 2 : 0) | (meta ? 4 : 0) | (shift ? 8 : 0);
      await onTop('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, modifiers });
      for (const type of ['mousePressed', 'mouseReleased']) await onTop('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, modifiers });
    }
    /** Move the real mouse to (x, y) and press nothing: what shows on hover (a card's buttons) shows. */
    async function hover(x, y) {
      await onTop('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    }
    /**
     * Drag with the real mouse from `[x, y]` to `[toX, toY]`: press, move there in `steps` moves, release. A page that
     * waits for the pointer to move some way before it starts a drag sees it start.
     */
    async function dragMouse([x, y], [toX, toY], { steps = 10 } = {}) {
      await onTop('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await onTop('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
      for (let n = 1; n <= steps; n++) {
        await onTop('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + ((toX - x) * n) / steps, y: y + ((toY - y) * n) / steps, button: 'left', buttons: 1 });
        await sleep(16);
      }
      await onTop('Input.dispatchMouseEvent', { type: 'mouseReleased', x: toX, y: toY, button: 'left', buttons: 0, clickCount: 1 });
    }
    /** Click with the real mouse's right button at (x, y): the page gets a contextmenu event, as from a person. */
    async function rightClick(x, y) {
      await onTop('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      for (const type of ['mousePressed', 'mouseReleased']) await onTop('Input.dispatchMouseEvent', { type, x, y, button: 'right', buttons: 2, clickCount: 1 });
    }
    /** Click with the real mouse `count` times in a row (2 selects a word, 3 a paragraph). */
    async function clickTimes(x, y, count) {
      await onTop('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      for (let n = 1; n <= count; n++) {
        for (const type of ['mousePressed', 'mouseReleased']) await onTop('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: n });
      }
    }
    /** Type with the real keyboard: a key down and up for each character, to whatever has focus. */
    async function type(text) {
      for (const ch of text) {
        await onTop('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, text: ch });
        await onTop('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
      }
    }
    /**
     * Press a key that is not a character (Escape, Enter, an arrow…), or a letter with Control or Command held
     * (`{ctrl: true}`, `{meta: true}`, either with `shift`: a shortcut, such as Command-Z on a Mac): a key down and up, to
     * whatever has focus. `commands` names the editing commands the key runs (`['copy']`, `['paste']`): on a Mac the
     * menu, not the key, copies and pastes, so Command-C needs them to reach the page as a copy.
     */
    async function press(key, { ctrl = false, meta = false, shift = false, commands } = {}) {
      const letter = /^[a-z]$/.test(key) && (ctrl || meta);
      const keyCode = letter ? key.toUpperCase().charCodeAt(0) : { Backspace: 8, Tab: 9, Enter: 13, Escape: 27, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46 }[key];
      if (!keyCode) throw new Error(`press: no key code for ${key}`);
      const code = letter ? `Key${key.toUpperCase()}` : key;
      const modifiers = (ctrl ? 2 : 0) | (meta ? 4 : 0) | (shift ? 8 : 0);
      const text = key === 'Enter' && !ctrl && !meta ? '\r' : undefined;
      await onTop('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key, code, windowsVirtualKeyCode: keyCode, modifiers, text, ...(commands ? { commands } : {}) });
      await onTop('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, modifiers });
    }
    /** Type through an input method: the text is composed in steps and then committed, as pinyin does (the keys come as 229). */
    async function typeIme(text) {
      let composing = '';
      for (const ch of text) {
        composing += ch;
        await onTop('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Process', windowsVirtualKeyCode: 229 });
        await onTop('Input.imeSetComposition', { text: composing, selectionStart: composing.length, selectionEnd: composing.length });
        await onTop('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
      }
      await onTop('Input.insertText', { text: composing });
    }
    /** A raw DevTools call on the page's own session (benchmarks: Input, Performance, Memory). */
    const cdp = (method, params = {}, options) => call(method, params, top, undefined, options);
    const page = { problems, crashedFrames, urls, evaluate, evaluateAll, evaluateFrames, crashed, waitFor, click, clickTimes, rightClick, hover, dragMouse, type, typeIme, press, close, cdp };
    async function close() {
      closedAt ??= Date.now();
      pagesOpen.delete(page);
      pages.delete(page);
      listeners.delete(onEvent);
      // Nothing more will answer what still waits on the tab or its frames.
      for (const session of sessions) dropSession(session, 'the page was closed');
      await send('Target.closeTarget', { targetId }).catch(() => {});
    }

    try {
      await send('Page.enable', {}, top);
      await enable(top);
      if (userAgent) await send('Emulation.setUserAgentOverride', { userAgent }, top);
      pagesOpen.add(page);
      pages.add(page);
      await send('Page.navigate', { url }, top);
      const until = Date.now() + timeout;
      while (!loaded && Date.now() < until) await sleep(100);
      if (!loaded) problems.push(`no load event after ${timeout} ms`);
      else if (!(await waitFor(ready, until - Date.now()))) problems.push(`not ready after ${timeout} ms: ${ready}`);
      await sleep(settle);
      return page;
    } catch (e) {
      await close();
      throw e;
    }
  }

  async function close() {
    closingAt ??= Date.now();
    process.off('exit', atExit);
    // Calls still waiting now (as after a test that timed out) are what held it: say which, before they are dropped.
    const waiting = report();
    if (waiting) console.log(waiting.replace(/^/gm, '# '));
    browsersOpen.delete(report);
    for (const page of pages) pagesOpen.delete(page);
    // Chrome answers before it goes; one that never answers is killed below.
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 3000);
      send('Browser.close').catch(() => {}).finally(() => {
        clearTimeout(timer);
        resolve();
      });
    });
    ws.close();
    await new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 3000);
      child.on('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    removeProfile();
  }

  /** Let pages download into `dir` (headless Chrome refuses downloads until told where they go). */
  const downloadsTo = dir => send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
  /** Cancel every download without a word to the page, as some embedded browsers do. */
  const dropDownloads = () => send('Browser.setDownloadBehavior', { behavior: 'deny' });

  return { load, close, downloadsTo, dropDownloads, pid: child.pid };
}
