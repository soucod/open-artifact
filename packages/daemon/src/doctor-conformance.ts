/**
 * The conformance script (design 12): `open-artifact doctor --harness <name> --session <id>` checks a running host
 * against the integration table, one step at a time, as that host's session. Each step says `ok`, `warn`, `fail` or
 * `n/a`, with one line of what to do; `n/a` means the host did not declare that capability, or the step needs a
 * person or a real browser (it never says `ok` for what it could not see).
 *
 * How it acts. Doctor opens a Harness API connection of its own under the host's harness name, with no caps (so the
 * daemon never sends it `wake.deliver` or `host.open`), and calls tools *as* the host's session through `caller`. It
 * never attaches the host's session, so the host keeps it. What it makes it removes in the last step (`cleanup`),
 * which runs whatever failed before it.
 *
 * Steps, in order (ids `conformance.<step>`):
 *  - `discovery`: the daemon runs, doctor's own `hello` is answered, and an adapter of the harness is connected.
 *  - `profile`: the harness's profile and the caps its adapter said; session markers when this command runs where
 *    the agent's commands run.
 *  - `session`: the session is attached, through which adapter, live or not, with which status.
 *  - `tools`: `tools.list` has Artifact, ArtifactData and ArtifactComments; `quickstart` and `publish` make a test
 *    artifact (a local type, in a temporary folder, `open: "never"`) owned by the session.
 *  - `commands`: `skill.get` renders the body for the host's first command (and `commands.list` when it has a menu).
 *  - `open`: `Artifact open` reaches the host's `host.open`, answered within the daemon's 30 s.
 *  - `wake`: a request from the page (`artifacts.ask`, what the Shell's Ask sends) reaches the session live and the
 *    host answers `resumed`, `delivered` or `drafted`. This starts a turn of the host's agent; its text says there is
 *    nothing to do.
 *  - `rules`: the profile's `rules` reach `quickstart`; a role of `policy.roles` that may not create (or modify, or
 *    remove) is refused `not_granted` (doctor attaches a probe session of that role on its own connection, then
 *    detaches it; the probe stays in the daemon's list of known sessions, as any detached session does).
 *  - `context`: `view.context` answers for the test artifact.
 *  - `registration`: `artifacts/changed` events arrive for the test artifact on create and on a write, and its owner
 *    is the session (what the kit's `on('artifact')` reports it under).
 *  - `cleanup`: removes the test artifact's record and the folder doctor made, detaches the probe, closes doctor's
 *    connection.
 *
 * `--json` (stable for a host's CI; fields are only ever added):
 *
 *     {
 *       "ok": boolean,                    // no finding is "fail"
 *       "home": string,                   // OPEN_ARTIFACT_HOME
 *       "harness": string | null,         // --harness
 *       "session": string | null,         // --session
 *       "findings": [                     // in run order; the setup checks first, then remote-types, then these
 *         { "id": "conformance.<step>",   // one of the steps above (a step may report several findings, in a fixed
 *                                         // order: its verdict first, then its n/a parts)
 *           "status": "ok" | "warn" | "fail" | "n/a",
 *           "message": string,            // one line
 *           "fix"?: string }              // one line: what to do (warn, fail), or why it is n/a
 *       ],
 *       "counts": { "ok": n, "warn": n, "fail": n, "n/a": n }
 *     }
 *
 * A CI gate reads `findings` whose `id` starts with `conformance.` and fails on `status: "fail"`. The process exits
 * 1 when `ok` is false.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HarnessClient, api } from '@open-artifact/harness-kit';
import type {
  AdapterCaps,
  AdapterInfo,
  AdapterOpenCaps,
  DaemonState,
  HarnessEvent,
  HarnessesResponse,
  HelloResult,
  SessionMay,
  ToolCallResult,
} from '@open-artifact/protocol';
import type { DoctorCheck, DoctorContext, DoctorFinding } from './doctor.ts';
import { harnessProfile } from './harness-profiles.ts';
import { files } from './paths.ts';
import pkg from '../package.json' with { type: 'json' };

type Found = Omit<DoctorFinding, 'id'>;

/** The steps, in order. */
export const CONFORMANCE_STEPS = ['discovery', 'profile', 'session', 'tools', 'commands', 'open', 'wake', 'rules', 'context', 'registration', 'cleanup'] as const;
export type ConformanceStep = (typeof CONFORMANCE_STEPS)[number];

/** The title the test artifact gets. */
export const CONFORMANCE_TITLE = 'open-artifact doctor test';
/** What the test wake says to the host's agent. */
export const CONFORMANCE_WAKE_TEXT = 'open-artifact doctor is checking that a request from the page reaches you. Nothing to do: reply in one line that you got it.';
/** The tools every host must list. */
const TOOLS = ['Artifact', 'ArtifactData', 'ArtifactComments'];
/** Types the test artifact prefers (small, no server of their own), then any local runnable one. */
const PREFERRED_TYPES = ['whiteboard', 'docs', 'sheets'];
/** The daemon waits 30 s for `host.open` and `wake.deliver`; doctor waits a little longer. */
const HOST_MS = 35_000;
const CALL_MS = 15_000;
const EVENT_MS = 5_000;

const E2E = 'npm run e2e -- --only harness-compat (in the open-artifact repository) checks it with the reference host';

/** What the steps share during one run. */
interface Run {
  state: DaemonState | null;
  client: HarnessClient | null;
  hello: HelloResult | null;
  /** The host's adapter that holds the session (or, before the session is found, the first of the harness's). */
  adapter: AdapterInfo | null;
  caps: AdapterCaps;
  workspace: string | null;
  /** Why the steps after the first failure cannot run. */
  blocked: string | null;
  events: HarnessEvent[];
  type: string | null;
  typeUrl: string | null;
  quickstart: ToolCallResult | null;
  artifact: { url: string; id: string } | null;
  /** The temporary folder doctor made (removed in cleanup). */
  folder: string | null;
  probe: string | null;
  /** Artifacts a probe made against expectations: removed in cleanup too. */
  extra: string[];
}

const runs = new WeakMap<DoctorContext, Run>();

function runOf(context: DoctorContext): Run {
  let run = runs.get(context);
  if (!run) {
    run = { state: null, client: null, hello: null, adapter: null, caps: {}, workspace: null, blocked: null, events: [], type: null, typeUrl: null, quickstart: null, artifact: null, folder: null, probe: null, extra: [] };
    runs.set(context, run);
  }
  return run;
}

function within<T>(ms: number, what: string, work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not answer within ${Math.round(ms / 1000)} s`)), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

const message = (error: unknown): string => String((error as Error)?.message ?? error).split('\n')[0]!;
const codeOf = (error: unknown): string | undefined => (error as { code?: string; data?: { code?: string } })?.code ?? (error as { data?: { code?: string } })?.data?.code;

/** A tool call as the session; a result's `error` is thrown (with its code). */
async function call(run: Run, context: DoctorContext, name: string, args: Record<string, unknown>, session = context.session): Promise<ToolCallResult> {
  const result = await within(CALL_MS, `tools.call ${name} ${String(args.action ?? '')}`.trim(), run.client!.request('tools.call', { name, arguments: args, caller: { session: session!, workspace: run.workspace ?? undefined } } as never));
  if (result?.error) throw Object.assign(new Error(result.error.message), { code: result.error.code });
  return result;
}

/** A step that cannot run because an earlier one failed. */
const blocked = (step: ConformanceStep, run: Run): Found => ({ status: 'fail', message: `Conformance ${step}: not run (${run.blocked})`, fix: 'Fix the first failing conformance step, then run doctor again.' });

const na = (step: ConformanceStep, what: string, why: string): Found => ({ status: 'n/a', message: `Conformance ${step}: ${what}`, fix: why });

const openCaps = (caps: AdapterCaps): AdapterOpenCaps | null => (caps.open && typeof caps.open === 'object' ? caps.open : null);

/** One line of the caps an adapter said. */
export function describeCaps(caps: AdapterCaps): string {
  const open = openCaps(caps);
  const parts = [
    `tools ${caps.tools ?? '(not said)'}`,
    caps.wake ? `wake${caps.wake.resume ? ' resume' : ''}${caps.wake.mode ? ` ${caps.wake.mode}` : ''}` : 'no wake',
    open ? `open ${open.embed} (${open.origins.length} origin${open.origins.length === 1 ? '' : 's'}, remote ${open.remote ?? 'ask'})` : caps.open ? 'open' : 'no open',
    caps.commands?.names.length ? `commands ${caps.commands.names.join(', ')}${caps.commands.menu ? ' (menu)' : ''}` : 'no commands',
    `library ${caps.library ?? '(not said)'}`,
  ];
  return parts.join('; ');
}

const discovery: DoctorCheck = {
  id: 'conformance.discovery',
  title: 'Conformance: discovery',
  applies: ({ session }) => !!session,
  run: async (context) => {
    const run = runOf(context);
    if (!context.harness) {
      run.blocked = 'no --harness';
      return { status: 'fail', message: 'Conformance discovery: --session needs --harness, the host\'s harness name', fix: 'Run open-artifact doctor --harness <name> --session <id>.' };
    }
    run.state = await context.daemon();
    if (!run.state) {
      run.blocked = 'the daemon is not running';
      return { status: 'fail', message: 'Conformance discovery: the daemon is not running', fix: `Start ${context.harness} (its adapter starts the daemon), then run doctor again.` };
    }
    run.client = new HarnessClient({
      harness: context.harness,
      caps: {},
      hello: { kit: { name: 'open-artifact-doctor', version: (pkg as { version?: string }).version ?? '0.0.0' } },
      autoStart: false,
      daemon: { home: context.home },
      reconnect: { minMs: 60_000, maxMs: 60_000 },
      onEvent: (event) => void run.events.push(event),
    });
    try {
      run.hello = await within(CALL_MS, 'hello', run.client.connect());
    } catch (error) {
      run.blocked = 'hello failed';
      return { status: 'fail', message: `Conformance discovery: hello failed: ${message(error)}`, fix: 'Check daemon.json is readable and the daemon answers (open-artifact daemon status).' };
    }
    const answer = await api<HarnessesResponse>(run.state, 'harnesses');
    const adapters = (answer.adapters ?? []).filter((a) => a.harness === context.harness && a.id !== run.hello!.connection);
    if (!adapters.length) {
      run.blocked = `no adapter of ${context.harness} is connected`;
      return { status: 'fail', message: `Conformance discovery: no adapter of ${context.harness} is connected`, fix: `Open ${context.harness}; its adapter connects to ${run.state.url} with hello {harness: "${context.harness}"}.` };
    }
    const key = (answer.sessions ?? []).find((s) => s.harness === context.harness && s.session === context.session)?.key;
    run.adapter = adapters.find((a) => key && a.sessions.includes(key)) ?? adapters[0]!;
    run.caps = run.adapter.caps ?? {};
    return {
      status: 'ok',
      message: `Conformance discovery: daemon ${run.hello.daemon} at ${run.state.url}, protocol ${run.hello.protocol}, ${run.hello.features.length} features; ${adapters.length} adapter${adapters.length === 1 ? '' : 's'} of ${context.harness} connected`,
    };
  },
};

const profileStep: DoctorCheck = {
  id: 'conformance.profile',
  title: 'Conformance: profile',
  applies: ({ session }) => !!session,
  run: (context) => {
    const run = runOf(context);
    if (run.blocked) return blocked('profile', run);
    const profile = harnessProfile(context.harness!);
    const found: Found[] = [];
    found.push(
      profile.source
        ? { status: 'ok', message: `Conformance profile: ${context.harness} (${profile.source}), agent "${profile.agentName}"; adapter caps: ${describeCaps(run.caps)}` }
        : { status: 'warn', message: `Conformance profile: no profile of ${context.harness} (the defaults apply); adapter caps: ${describeCaps(run.caps)}`, fix: 'Send profile in hello (the kit does from createHarness options), or add one with open-artifact harness add.' },
    );
    if (!run.caps.tools) found.push({ status: 'warn', message: 'Conformance profile: the adapter did not say how its agent reaches the tools (caps.tools)', fix: 'Say caps.tools: "native", "mcp" or "cli" in hello.' });
    const markers = profile.markers ?? [];
    if (!markers.length) found.push(na('profile', 'the profile declares no session markers', 'Markers matter for an agent that runs open-artifact commands; a native-tools host needs none.'));
    else {
      const set = markers.filter((m) => context.env[m]);
      found.push(
        set.length
          ? { status: 'ok', message: `Conformance profile: marker${set.length === 1 ? '' : 's'} ${set.join(', ')} set in this environment` }
          : na('profile', `markers ${markers.join(', ')} are not set here`, 'They are only set where the agent runs its commands: run doctor from a command the agent runs to check them.'),
      );
    }
    return found;
  },
};

const sessionStep: DoctorCheck = {
  id: 'conformance.session',
  title: 'Conformance: session',
  applies: ({ session }) => !!session,
  run: async (context) => {
    const run = runOf(context);
    if (run.blocked) return blocked('session', run);
    const answer = await api<HarnessesResponse>(run.state!, 'harnesses');
    const entry = (answer.sessions ?? []).find((s) => s.harness === context.harness && s.session === context.session);
    const holder = entry ? (answer.adapters ?? []).find((a) => a.sessions.includes(entry.key) && a.id !== run.hello?.connection) : undefined;
    if (!entry || !holder) {
      run.blocked = `session ${context.session} is not attached`;
      return { status: 'fail', message: `Conformance session: ${context.session} is not attached by an adapter of ${context.harness}`, fix: 'The host calls session.attach {session, workspace} when the session starts; pass the id it attached.' };
    }
    run.adapter = holder;
    run.caps = holder.caps ?? {};
    run.workspace = entry.workspace ?? null;
    const found: Found[] = [
      entry.live
        ? { status: 'ok', message: `Conformance session: ${context.session} attached through adapter ${holder.id}, ${entry.status}, workspace ${entry.workspace ?? '(none)'}` }
        : { status: 'warn', message: `Conformance session: ${context.session} is known but not live`, fix: 'Keep the adapter connection open while the session runs.' },
    ];
    found.push(na('session', 'status follows the agent\'s turns (session.status running / idle)', 'Needs a real turn of the agent: watch the status in open-artifact doctor while it works.'));
    return found;
  },
};

const toolsStep: DoctorCheck = {
  id: 'conformance.tools',
  title: 'Conformance: tools',
  applies: ({ session }) => !!session,
  run: async (context) => {
    const run = runOf(context);
    if (run.blocked) return blocked('tools', run);
    const listed = await within(CALL_MS, 'tools.list', run.client!.request('tools.list', {}));
    const names = new Set<string>((listed.tools ?? []).map((t) => t.name));
    const missing = TOOLS.filter((n) => !names.has(n));
    if (missing.length) {
      run.blocked = 'the tools are missing';
      return { status: 'fail', message: `Conformance tools: tools.list lacks ${missing.join(', ')}`, fix: 'Restart the daemon (open-artifact daemon stop) and reconnect the host.' };
    }
    try {
      const types = ((await call(run, context, 'Artifact', { action: 'list', scope: 'types' })).types ?? []) as Array<{ id: string; type_url: string; runnable?: boolean; enabled?: boolean; remote?: boolean }>;
      const usable = types.filter((t) => t.runnable !== false && t.enabled !== false && !t.remote);
      const type = PREFERRED_TYPES.map((id) => usable.find((t) => t.id === id)).find(Boolean) ?? usable[0];
      if (!type) {
        run.blocked = 'no local type to make a test artifact of';
        return { status: 'fail', message: 'Conformance tools: no runnable local type is installed', fix: 'Reinstall Open Artifact (its built-in types are missing), or turn one on in settings.' };
      }
      run.type = type.id;
      run.quickstart = await call(run, context, 'Artifact', { action: 'quickstart', type: type.id });
      const create = run.quickstart.create as Record<string, unknown> | undefined;
      if (!create?.type_url) throw new Error(`quickstart answered no create call for ${type.id}`);
      run.typeUrl = String(create.type_url);
      run.folder = mkdtempSync(join(tmpdir(), 'open-artifact-doctor-'));
      const made = await call(run, context, 'Artifact', { ...create, title: CONFORMANCE_TITLE, folder: join(run.folder, 'artifact'), open: 'never' });
      const url = String(made.url ?? '');
      run.artifact = { url, id: url.split('/').pop() ?? '' };
      const detail = await api<{ owner?: { harness?: string; session?: string | null } | null; code?: string; message?: string }>(run.state!, 'artifact', undefined, { query: { id: run.artifact.id } });
      if (detail.owner?.session !== context.session || detail.owner?.harness !== context.harness) {
        return { status: 'fail', message: `Conformance tools: ${url} was made, but its owner is ${detail.owner ? `${detail.owner.harness}/${detail.owner.session}` : 'nobody'}`, fix: 'Pass caller {session, workspace} with tools.call (the kit does), so artifacts belong to the session.' };
      }
      return { status: 'ok', message: `Conformance tools: ${TOOLS.join(', ')} listed; quickstart and publish made ${url} (${type.id}) owned by ${context.session}` };
    } catch (error) {
      if (!run.artifact) run.blocked = 'no test artifact';
      return { status: 'fail', message: `Conformance tools: ${message(error)}`, fix: codeOf(error) === 'not_granted' ? `The session may not create artifacts (its may or role): run doctor with a session that may.` : `See the daemon log (${files.daemonLog()}) for the call.` };
    }
  },
};

const commandsStep: DoctorCheck = {
  id: 'conformance.commands',
  title: 'Conformance: commands',
  applies: ({ session }) => !!session,
  run: async (context) => {
    const run = runOf(context);
    if (run.blocked && !run.client) return blocked('commands', run);
    const names = run.caps.commands?.names ?? [];
    if (!names.length) return na('commands', 'the host declares no commands (caps.commands)', 'Nothing to check: its agent finds the skill another way.');
    const command = names[0]!;
    const found: Found[] = [];
    try {
      const skill = await within(CALL_MS, 'skill.get', run.client!.request('skill.get', { command, ...(run.caps.tools ? { tools: run.caps.tools } : {}), agentName: run.caps.agentName ?? harnessProfile(context.harness!).agentName }));
      const problems = [skill.name !== command ? `name is ${skill.name}` : null, !skill.body.includes(`/${command}`) ? `the body never says /${command}` : null, !skill.etag ? 'no etag' : null].filter(Boolean);
      found.push(problems.length ? { status: 'fail', message: `Conformance commands: skill.get for /${command}: ${problems.join('; ')}`, fix: 'Report this with the output of open-artifact doctor --json.' } : { status: 'ok', message: `Conformance commands: skill.get renders /${command} (${skill.body.length} characters, etag ${skill.etag.slice(0, 12)})` });
      if (run.caps.commands?.menu) {
        const menu = await within(CALL_MS, 'commands.list', run.client!.request('commands.list', { command }));
        found.push(menu.commands.length ? { status: 'ok', message: `Conformance commands: commands.list gives ${menu.commands.length} entries for the menu` } : { status: 'warn', message: 'Conformance commands: commands.list is empty', fix: 'Check that types are installed and turned on (open-artifact types).' });
      }
    } catch (error) {
      found.push({ status: 'fail', message: `Conformance commands: ${message(error)}`, fix: 'Check the daemon speaks skill.get (its hello features).' });
    }
    found.push(na('commands', 'the host installed the skill where its agent reads it and refreshes it when the etag changes', 'That is on the host\'s side; check its skills folder.'));
    return found;
  },
};

const openStep: DoctorCheck = {
  id: 'conformance.open',
  title: 'Conformance: open',
  applies: ({ session }) => !!session,
  run: async (context) => {
    const run = runOf(context);
    if (!run.caps.open) return na('open', 'the host does not take host.open (caps.open)', 'The daemon falls back to the browser or the link.');
    if (run.blocked || !run.artifact) return blocked('open', run);
    const found: Found[] = [];
    const started = Date.now();
    try {
      const result = await within(HOST_MS, 'Artifact open', call(run, context, 'Artifact', { action: 'open', url: run.artifact.url }));
      const ms = Date.now() - started;
      if (result.opened && result.opened_in !== 'browser') found.push({ status: 'ok', message: `Conformance open: host.open answered opened in ${ms} ms` });
      else if (ms >= 29_000) found.push({ status: 'fail', message: `Conformance open: host.open did not answer within the daemon's 30 s`, fix: 'Answer host.open at once ({opened: true} once the page is shown, or {opened: false}); show the page after answering.' });
      else found.push({ status: 'warn', message: `Conformance open: host.open answered not opened in ${ms} ms${result.opened_in === 'browser' ? ' (the daemon opened the browser instead)' : ''}`, fix: 'Answer {opened: true} when the host shows the page; not opened is right only when the person declined.' });
    } catch (error) {
      found.push({ status: 'fail', message: `Conformance open: ${message(error)}`, fix: 'Answer host.open within 30 s.' });
    }
    const embed = openCaps(run.caps);
    found.push(na('open', `the Shell's handshake from ${embed ? `the declared origins (${embed.origins.join(', ') || 'none'})` : 'the host'}`, `Needs a real browser: ${E2E}.`));
    return found;
  },
};

const wakeStep: DoctorCheck = {
  id: 'conformance.wake',
  title: 'Conformance: wake',
  applies: ({ session }) => !!session,
  run: async (context) => {
    const run = runOf(context);
    if (!run.caps.wake) return na('wake', 'the host does not take wake.deliver (caps.wake)', 'Requests from the page wait in the inbox or nudge the session (the profile\'s wake).');
    if (run.blocked || !run.artifact) return blocked('wake', run);
    const found: Found[] = [];
    try {
      const answer = await within(HOST_MS + 5_000, 'artifacts.ask', api<{ via?: string; status?: string; code?: string; message?: string }>(run.state!, 'artifacts.ask', { id: run.artifact.id, text: CONFORMANCE_WAKE_TEXT }));
      if (answer.code) throw new Error(answer.message ?? answer.code);
      const how = `via ${answer.via}${answer.status ? `, ${answer.status}` : ''}`;
      if (answer.via === 'live' && ['resumed', 'delivered', 'drafted'].includes(answer.status ?? '')) found.push({ status: 'ok', message: `Conformance wake: a request from the page reached ${context.session} (${how})` });
      // The session step saw it attached and live: a request that waits means the host did not take it.
      else if (answer.via === 'inbox' || answer.via === 'wait') found.push({ status: 'fail', message: `Conformance wake: the request waited (${how}) instead of reaching the live session`, fix: 'Answer wake.deliver with resumed, delivered or drafted while the session is attached (failed only when it is gone).' });
      else found.push({ status: 'fail', message: `Conformance wake: the request was not delivered (${how})`, fix: 'Answer wake.deliver within 30 s with resumed, delivered or drafted (failed only when the session is gone).' });
    } catch (error) {
      found.push({ status: 'fail', message: `Conformance wake: ${message(error)}`, fix: 'Answer wake.deliver within 30 s.' });
    }
    found.push(na('wake', 'a comment from someone other than the owner arrives as a notice, not a turn', `Needs a collaborator or a type server's wake (source.from); ${E2E.replace(' checks it', ' covers the owner path')}, and examples/harness-node tests routeOf.`));
    found.push(na('wake', 'the agent replies in the comment thread', 'Needs the agent to act on the request: watch the page.'));
    return found;
  },
};

/** The first thing a role may not do, among create, modify, remove. */
function refusedOf(roles: Record<string, SessionMay> | undefined): { role: string; need: 'create' | 'modify' | 'remove' } | null {
  for (const need of ['create', 'modify', 'remove'] as const) {
    for (const [role, may] of Object.entries(roles ?? {})) if (may?.[need] === false) return { role, need };
  }
  return null;
}

const rulesStep: DoctorCheck = {
  id: 'conformance.rules',
  title: 'Conformance: rules',
  applies: ({ session }) => !!session,
  run: async (context) => {
    const run = runOf(context);
    const profile = harnessProfile(context.harness ?? 'unknown');
    const refused = refusedOf(profile.policy?.roles);
    if (!profile.rules?.trim() && !refused) return na('rules', 'the host declares no rules and no policy.roles that refuse anything', 'Nothing to check.');
    if (run.blocked || !run.artifact) return blocked('rules', run);
    const found: Found[] = [];
    if (profile.rules?.trim()) {
      const said = String(run.quickstart?.rules ?? '');
      found.push(said.includes(profile.rules.trim().slice(0, 40)) ? { status: 'ok', message: 'Conformance rules: quickstart carries the profile\'s rules first' } : { status: 'fail', message: 'Conformance rules: quickstart does not carry the profile\'s rules', fix: 'Send rules in the profile of hello (createHarness {rules}).' });
    }
    if (refused) {
      run.probe = `doctor-probe-${Math.random().toString(36).slice(2, 10)}`;
      try {
        await run.client!.attach({ session: run.probe, ...(run.workspace ? { workspace: run.workspace } : {}), role: refused.role });
        const args = refused.need === 'create' ? { action: 'publish', type_url: run.typeUrl, title: `${CONFORMANCE_TITLE} (probe)`, folder: join(run.folder!, 'probe'), open: 'never' } : refused.need === 'modify' ? { action: 'publish', url: run.artifact.url, files: { 'doctor-probe.txt': 'probe' } } : { action: 'delete', url: run.artifact.url };
        try {
          const made = await call(run, context, 'Artifact', args, run.probe);
          if (typeof made.url === 'string' && refused.need === 'create') run.extra.push(made.url);
          if (refused.need === 'remove') run.artifact = null;
          found.push({ status: 'fail', message: `Conformance rules: a ${refused.role} session was let ${refused.need}, which policy.roles refuses`, fix: 'Report this with the output of open-artifact doctor --json.' });
        } catch (error) {
          found.push(codeOf(error) === 'not_granted' ? { status: 'ok', message: `Conformance rules: a ${refused.role} session may not ${refused.need} (not_granted)` } : { status: 'fail', message: `Conformance rules: the ${refused.role} probe failed otherwise: ${message(error)}`, fix: `See the daemon log (${files.daemonLog()}).` });
        }
      } finally {
        await run.client!.detach({ session: run.probe }).catch(() => undefined);
        run.probe = null;
      }
    }
    if (profile.policy?.confirm?.length) found.push(na('rules', `the host asks the person to confirm ${profile.policy.confirm.join(', ')}`, 'That is the host\'s own approval UI: needs a person.'));
    return found;
  },
};

const contextStep: DoctorCheck = {
  id: 'conformance.context',
  title: 'Conformance: context',
  applies: ({ session }) => !!session,
  run: async (context) => {
    const run = runOf(context);
    if (run.blocked || !run.artifact) return blocked('context', run);
    const found: Found[] = [];
    try {
      const result = await within(CALL_MS, 'view.context', run.client!.request('view.context', { url: run.artifact.url, session: context.session! }));
      found.push({ status: 'ok', message: `Conformance context: view.context answers (${result.at ? `reported ${result.at}` : 'no page reported yet'})` });
    } catch (error) {
      found.push({ status: 'fail', message: `Conformance context: ${message(error)}`, fix: 'Check the daemon speaks view.context (its hello features).' });
    }
    found.push(na('context', 'the person\'s selection on the page reaches the agent\'s next turn', 'Needs a person selecting on the page.'));
    return found;
  },
};

const registrationStep: DoctorCheck = {
  id: 'conformance.registration',
  title: 'Conformance: registration',
  applies: ({ session }) => !!session,
  run: async (context) => {
    const run = runOf(context);
    if (run.blocked || !run.artifact) return blocked('registration', run);
    const id = run.artifact.id;
    const seen = (): number => run.events.filter((e) => e.type === 'artifacts/changed' && (e as { id?: string }).id === id).length;
    const wait = async (count: number): Promise<boolean> => {
      const deadline = Date.now() + EVENT_MS;
      while (seen() < count && Date.now() < deadline) await new Promise((done) => setTimeout(done, 25));
      return seen() >= count;
    };
    const found: Found[] = [];
    const onCreate = await wait(1);
    const before = seen();
    let onWrite = false;
    try {
      await call(run, context, 'Artifact', { action: 'publish', url: run.artifact.url, files: { 'doctor-probe.txt': `written by open-artifact doctor ${new Date().toISOString()}\n` } });
      onWrite = await wait(before + 1);
    } catch (error) {
      found.push({ status: 'fail', message: `Conformance registration: writing to the test artifact failed: ${message(error)}`, fix: `See the daemon log (${files.daemonLog()}).` });
    }
    const detail = await api<{ owner?: { session?: string | null } | null }>(run.state!, 'artifact', undefined, { query: { id } });
    const owned = detail.owner?.session === context.session;
    if (onCreate && onWrite && owned) found.unshift({ status: 'ok', message: `Conformance registration: artifacts/changed arrived for ${id} on create and on a write; its owner is ${context.session}` });
    else {
      const missing = [!onCreate ? 'no event on create' : null, !onWrite ? 'no event on a write' : null, !owned ? `owner is ${detail.owner?.session ?? 'nobody'}` : null].filter(Boolean).join('; ');
      found.unshift({ status: 'fail', message: `Conformance registration: ${missing}`, fix: 'Subscribe ({on: true}) to get artifacts/changed, and pass caller with tools.call.' });
    }
    found.push(na('registration', 'the host keeps the link in its message and opens it again after a restart', 'Needs the host\'s UI.'));
    return found;
  },
};

const cleanup: DoctorCheck = {
  id: 'conformance.cleanup',
  title: 'Conformance: cleanup',
  applies: ({ session }) => !!session,
  run: async (context) => {
    const run = runOf(context);
    const left: string[] = [];
    const removed: string[] = [];
    const urls = [...(run.artifact ? [run.artifact.url] : []), ...run.extra];
    for (const url of urls) {
      let gone = false;
      if (run.client?.connected) gone = await call(run, context, 'Artifact', { action: 'delete', url }).then(() => true, () => false);
      if (!gone && run.state) gone = await api<{ deleted?: string }>(run.state, 'artifacts.delete', { url, id: url.split('/').pop() }).then((r) => !!r.deleted, () => false);
      (gone ? removed : left).push(url);
    }
    if (run.probe && run.client) await run.client.detach({ session: run.probe }).catch(() => undefined);
    if (run.folder) {
      try {
        rmSync(run.folder, { recursive: true, force: true });
        removed.push(run.folder);
      } catch (error) {
        left.push(`${run.folder} (${message(error)})`);
      }
    }
    run.client?.close();
    runs.delete(context);
    if (left.length) return { status: 'warn', message: `Conformance cleanup: could not remove ${left.join(', ')}`, fix: 'Remove them by hand (the Library page, or rm -r the folder).' };
    return { status: 'ok', message: removed.length ? `Conformance cleanup: removed ${removed.join(', ')}` : 'Conformance cleanup: nothing was made' };
  },
};

/** The conformance steps, in order (appended to `DOCTOR_CHECKS`). */
export const CONFORMANCE_CHECKS: readonly DoctorCheck[] = [discovery, profileStep, sessionStep, toolsStep, commandsStep, openStep, wakeStep, rulesStep, contextStep, registrationStep, cleanup];
