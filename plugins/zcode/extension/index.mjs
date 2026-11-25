/**
 * ZCode sessions live inside the desktop app, where nothing outside them — the daemon included — can start a
 * turn, and ZCode has no declarative monitors; this extension therefore holds the daemon's harness
 * connection itself, so page messages reach an idle session the moment they are sent.
 *
 * The connection is `@open-artifact/harness-kit`'s `createHarness`: it finds the daemon (never starts one: the
 * skill's hooks and commands do that), says hello with wake caps, reconnects with backoff, attaches every session
 * again after a reconnect and hands what waited in a session's inbox to `wake`. ZCode loads this file as it is, with
 * no dependencies, so `node scripts/build-plugins.mjs` bundles the kit into `dist/plugins/zcode/extension/index.mjs`;
 * here, in the repository, it imports the kit from the workspace.
 */

import { createHarness } from '@open-artifact/harness-kit';

/** How long the reconnect backoff waits, first and at most. */
const RECONNECT = { minMs: 1000, maxMs: 8000 };

/**
 * One extension: what `activate` and `deactivate` share. `options.home` and `options.reconnect` are for tests (the
 * home defaults to `$OPEN_ARTIFACT_HOME`, then `~/.agents/open-artifact`).
 */
export function createExtension(options = {}) {
  /** The activation generation: each `activate` takes the next number for its callbacks, and `deactivate` moves the
   * count past them — a harness that connects after the next activation began fails its `run === mine` check and
   * closes instead of running beside the new one: two connections, every session attached twice. */
  let run = 0;
  let grantAsked = false;
  let refused = false;
  /** The harness of this activation, once the session list started it. */
  let harness = null;
  /** Its connection, once made: calls before it wait for the list's first sessions to be attached. */
  let connection = null;
  const attached = new Map();
  let listing = null;

  async function granted(ctx) {
    if (!grantAsked) {
      grantAsked = true;
      const ok = (await ctx.grants.request().catch(() => null))?.granted;
      ctx.log.info(`sessions.write: ${ok ? 'granted' : 'not granted'}`);
      if (ok) return true;
    }
    refuse(ctx);
    return false;
  }

  /** Takes the daemon connection down and keeps it down for this activation; presence must not lie while ungranted. */
  function refuse(ctx) {
    if (refused) return;
    refused = true;
    ctx.log.warn('sessions.write does not stand: no daemon connection for this activation');
    connection?.close();
    connection = null;
  }

  /**
   * Delivers one message to a session — its text verbatim as the turn prompt, the same text the hooks would inject,
   * so nothing the daemon sends is rewritten on the way. An idle session starts a turn at once and a busy one queues
   * it; `not-granted` goes through `granted`, whose refusal takes the connection down. A session that refuses the
   * prompt does not throw: the call resolves with its `admission`, and only `accepted` took the text — anything else
   * it may resolve with (`rejected`, an answer that cannot be read) answers `failed`, never `ok`, for the daemon
   * parks a message it is told failed, while one acked away is lost. Answers `ok` only there, `gone` when the
   * session is no more (`forbidden`: its list entry is already on its way out), and `failed` otherwise — the daemon
   * then parks the message for the hooks and `wait`.
   */
  async function deliver(ctx, session, item) {
    for (let retry = false; ; retry = true) {
      try {
        const result = await ctx.sessions.sendToSession({ sessionId: session, prompt: item.text });
        if (result?.admission === 'accepted') {
          ctx.log.info(`delivered ${item.artifactId} to ${session}: ${result?.delivery ?? 'unknown'}`);
          return 'ok';
        }
        ctx.log.warn(`could not deliver ${item.artifactId} to ${session}: ${result?.admission ?? 'unknown'}`);
        return 'failed';
      } catch (error) {
        const code = error?.code ?? 'unknown';
        if (code === 'forbidden') return 'gone';
        if (code !== 'not-granted' || retry || !(await granted(ctx))) {
          ctx.log.warn(`could not deliver ${item.artifactId} to ${session}: ${code}`);
          return 'failed';
        }
      }
    }
  }

  /** `wake.deliver`, and each message an attach hands over: `delivered`, or `failed` for the daemon to keep it. */
  async function wake(ctx, params) {
    if (refused || !params.session) return 'failed';
    const outcome = await deliver(ctx, params.session, params);
    if (outcome === 'gone') await detach(params.session);
    return outcome === 'ok' ? 'delivered' : 'failed';
  }

  /**
   * Attaches a session; what waited in its inbox goes to `wake` on the way. A drained item `wake` could not hand on
   * has no ack back — the daemon kept no copy — so it is logged with its text, the record to recover it by. An
   * attach that cannot go out (no daemon yet, the connection changing under it) is kept by the kit, which attaches
   * the session when the connection comes back.
   */
  async function attach(ctx, params) {
    if (!connection) return;
    try {
      const { inbox } = await connection.attach(params);
      for (const item of inbox) ctx.log.error(`a message drained from ${params.session}'s inbox was not delivered (${item.artifactId}): ${item.text}`);
    } catch {
      // not connected: attached on the reconnect
    }
  }

  async function detach(session) {
    attached.delete(session);
    await connection?.detach(session).catch(() => undefined);
  }

  /**
   * Records one session of the app's list — attached when it is new, its status restated when it moved
   * (`needs_attention` and `unknown` read as idle: the daemon knows only idle and running).
   */
  function upsert(ctx, row) {
    const params = {
      session: row.session.sessionId,
      workspace: row.session.workspacePath,
      title: row.title,
      status: row.status === 'running' ? 'running' : 'idle',
    };
    const was = attached.get(params.session);
    attached.set(params.session, params);
    if (!was) void attach(ctx, params);
    else if (was.status !== params.status) void connection?.status(params.session, params.status).catch(() => undefined);
  }

  /** Connects for this activation and attaches the sessions listed so far. */
  function start(ctx, mine) {
    let up = false;
    let ever = false;
    harness = createHarness({
      harness: 'zcode',
      // Wake caps are what make the daemon route a session's messages here live instead of parking them.
      wake: (params) => wake(ctx, params),
      autoStart: false,
      reconnect: options.reconnect ?? RECONNECT,
      ...(options.home ? { home: options.home } : {}),
      log: () => undefined,
    }).then((made) => {
      if (run !== mine || refused) {
        made.close();
        return null;
      }
      made.on('state', (state) => {
        if (state === 'connected' && !up) {
          up = true;
          ever = true;
          ctx.log.info('attached to the daemon');
        } else if (state === 'disconnected' && up) {
          up = false;
          ctx.log.warn('lost the daemon; re-attaching');
        }
      });
      if (made.connected) {
        up = ever = true;
        ctx.log.info('attached to the daemon');
      } else ctx.log.info('could not attach to the daemon; retrying');
      connection = made;
      for (const params of attached.values()) void attach(ctx, params);
      return made;
    });
    return harness;
  }

  /**
   * The app's session list, snapshot first and deltas after — the one source of what to attach. A session that
   * appears is attached (an attach arrives with what waited in its inbox), one that leaves is detached. The first
   * event also starts the connection: the list cannot be read without `sessions.write`, so its arrival is the grant
   * standing — the connection never opens on spec.
   */
  function listed(ctx, mine, event) {
    if (!harness && !refused) void start(ctx, mine);
    if (event?.kind === 'snapshot') {
      const known = new Set(event.sessions.map((row) => row.session.sessionId));
      for (const session of [...attached.keys()]) if (!known.has(session)) void detach(session);
      for (const row of event.sessions) upsert(ctx, row);
      return;
    }
    if (event?.kind === 'delta') {
      for (const ref of event.removed) void detach(ref.sessionId);
      for (const row of event.upserted) upsert(ctx, row);
    }
  }

  function watch(ctx, mine) {
    listing = ctx.sessions.onDidChangeList(
      (event) => listed(ctx, mine, event),
      (error) => void listFailed(ctx, mine, error),
    );
  }

  /**
   * The session list could not be kept. Only a missing grant gets a second chance: a fresh install's list cannot so
   * much as start without `sessions.write` — and with no list there is no connection, so `deliver`'s grant path, the
   * dialog's other door, never runs — so the dialog is offered here, once per activation, and the list starts over
   * when the grant lands; one that will not stand refuses the connection inside `granted`. Anything else just ends
   * the list.
   */
  async function listFailed(ctx, mine, error) {
    if (error?.code !== 'not-granted') {
      ctx.log.warn(`session list: ${error?.code ?? 'unknown'}`);
      return;
    }
    // The dialog can outlast its activation, so the restart re-proves `mine` once the ask has answered.
    if (run !== mine || !(await granted(ctx)) || run !== mine) return;
    watch(ctx, mine);
  }

  return {
    /** Returns at once: activation must finish far inside ZCode's timeout. */
    activate(ctx) {
      const mine = ++run;
      grantAsked = false;
      refused = false;
      harness = null;
      connection = null;
      attached.clear();
      watch(ctx, mine);
    },
    deactivate() {
      run += 1;
      listing?.dispose();
      listing = null;
      connection?.close();
      connection = null;
      harness = null;
    },
    /** The harness of this activation (tests). */
    harness: () => harness,
  };
}

const extension = createExtension();

export function activate(ctx) {
  extension.activate(ctx);
}

export function deactivate() {
  extension.deactivate();
}
