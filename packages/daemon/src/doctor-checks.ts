/**
 * The checks `open-artifact doctor` runs, in order (the runner is `doctor.ts`).
 *
 * To add checks from another module: export a `DoctorCheck[]` there and spread it into {@link DOCTOR_CHECKS} below
 * (stage R's remote checks and the conformance suite come this way). Each finding is one line, and a `warn` or `fail`
 * carries one line of what to do.
 */

import { accessSync, constants, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { api } from '@open-artifact/harness-kit';
import { HARNESS_NAME, type DaemonHealth, type HarnessesResponse, type ToolDefinition } from '@open-artifact/protocol';
import type { DoctorCheck } from './doctor.ts';
import { CONFORMANCE_CHECKS } from './doctor-conformance.ts';
import { REMOTE_CHECKS } from './doctor-remote.ts';
import { ownRuntime } from './client.ts';
import { harnessProfile } from './harness-profiles.ts';
import { files, runnerFacts } from './paths.ts';
import { runtimeStatus } from './runtime.ts';
import { loadSettings } from './settings.ts';
import { TypeRegistry } from './types.ts';

/** The oldest Node.js the runtime runs on. */
const NODE_MIN = [22, 18];

const node: DoctorCheck = {
  id: 'node',
  title: 'Node.js',
  run: () => {
    const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
    const ok = major > NODE_MIN[0]! || (major === NODE_MIN[0] && minor >= NODE_MIN[1]!);
    const facts = runnerFacts();
    // The single-file executable carries its own Node.js: say so, since no `node` need be installed.
    const which = facts.sea ? `Node.js ${process.versions.node} (inside the single-file executable ${facts.execPath})` : `Node.js ${process.versions.node}`;
    return ok
      ? { status: 'ok', message: which }
      : { status: 'fail', message: `${which} is older than ${NODE_MIN.join('.')}`, fix: facts.sea ? 'Update Open Artifact: this executable carries its own Node.js.' : `Install Node.js ${NODE_MIN.join('.')} or newer.` };
  },
};

const home: DoctorCheck = {
  id: 'home',
  title: 'Open Artifact home',
  run: ({ home }) => {
    if (!existsSync(home)) return { status: 'warn', message: `The home ${home} does not exist yet`, fix: 'Nothing to do: it is made when the daemon first starts (open-artifact daemon ensure).' };
    try {
      accessSync(home, constants.W_OK);
    } catch {
      return { status: 'fail', message: `The home ${home} is not writable`, fix: `Give your user write access to ${home} (or set OPEN_ARTIFACT_HOME to a folder of yours).` };
    }
    return { status: 'ok', message: `Home ${home}` };
  },
};

const daemon: DoctorCheck = {
  id: 'daemon',
  title: 'Daemon',
  run: async ({ daemon }) => {
    const state = await daemon();
    if (!state) return { status: 'warn', message: 'The daemon is not running', fix: 'Nothing to do if no agent is using Open Artifact; it starts on demand (or: open-artifact daemon ensure).' };
    const found = [{ status: 'ok' as const, message: `Daemon ${state.version ?? '?'} running at ${state.url} (pid ${state.pid})` }];
    if (process.platform !== 'win32') {
      try {
        const mode = statSync(files.daemon()).mode & 0o777;
        if (mode & 0o077) return [...found, { status: 'fail' as const, message: `daemon.json (which holds the token) is readable by others (mode ${mode.toString(8)})`, fix: `chmod 600 ${files.daemon()}` }];
      } catch {
        /* gone meanwhile */
      }
    }
    return found;
  },
};

/** How the running daemon runs its Node.js type servers (`node-children.ts`), as its health answer says. */
const nodeChildren: DoctorCheck = {
  id: 'node-children',
  title: 'Type server processes',
  run: async ({ daemon }) => {
    const state = await daemon();
    if (!state) return { status: 'n/a', message: 'The daemon is not running' };
    let health: DaemonHealth | null = null;
    try {
      health = (await (await fetch(`${state.url}/__open-artifact/health`, { signal: AbortSignal.timeout(3000) })).json()) as DaemonHealth;
    } catch {
      return { status: 'warn', message: 'The daemon did not answer its health check', fix: 'Run open-artifact doctor again; if it persists, restart the daemon (open-artifact daemon stop).' };
    }
    const choice = health?.nodeChildren;
    if (!choice) return { status: 'n/a', message: `Daemon ${health?.version ?? '?'} does not say how it runs type servers (older than 0.14.1)` };
    const why = choice.reason === 'env' ? 'set by OPEN_ARTIFACT_NODE_CHILDREN' : choice.reason === 'node' ? 'plain Node.js' : choice.detail;
    return {
      status: 'ok',
      message:
        choice.mode === 'threads'
          ? `Type servers run in worker threads of the daemon (${why}); no memory isolation from the daemon`
          : `Type servers run as child processes (${why})`,
    };
  },
};

const runtime: DoctorCheck = {
  id: 'runtime',
  title: 'Runtime',
  run: async ({ daemon }) => {
    const state = await daemon();
    const status = runtimeStatus({ running: state?.version ?? null, own: ownRuntime() });
    const found: Array<{ status: 'ok' | 'warn' | 'fail'; message: string; fix?: string }> = [];
    if (!status.selected) found.push({ status: 'fail', message: 'No runtime compatible with this command was found', fix: 'Reinstall the agent app plugin, or run: npx @open-artifact/cli daemon ensure.' });
    else found.push({ status: 'ok', message: `Runtime ${status.selected.version} starts the daemon (${status.selected.source}${status.selected.dir ? `, ${status.selected.dir}` : ''})${status.pin ? `, pinned to ${status.pin}` : ''}` });
    if (status.pending) found.push({ status: 'warn', message: `Runtime ${status.pending} is installed; the daemon (${status.running}) switches to it once idle`, fix: 'Nothing to do; close open artifact pages to switch sooner, or run open-artifact daemon stop.' });
    for (const gone of status.missing) found.push({ status: 'warn', message: `${gone.harness ?? 'A host'} registered runtime ${gone.version} at ${gone.dir}, which is gone`, fix: 'Nothing to do if that app was uninstalled; it is skipped.' });
    const policy = status.policy;
    if (policy.update === 'off') found.push({ status: 'ok', message: 'Runtime updates are off for this computer' });
    else if (status.check?.error) found.push({ status: 'warn', message: `The last update check failed: ${status.check.error}`, fix: `Check the registry (${status.registry}) is reachable, or set OPEN_ARTIFACT_REGISTRY.` });
    else if (status.check?.available) found.push({ status: 'warn', message: `Runtime ${status.check.available} is available (updates: ${policy.update}, ${policy.source})`, fix: 'Run open-artifact runtime update.' });
    else found.push({ status: 'ok', message: `Runtime updates: ${policy.update} (${policy.source})${status.check ? `, checked ${status.check.at}` : ', not checked yet'}` });
    return found;
  },
};

const types: DoctorCheck = {
  id: 'types',
  title: 'Artifact types',
  run: () => {
    const registry = new TypeRegistry(loadSettings);
    try {
      const listed = registry.list(process.cwd(), { includeShadowed: true });
      const broken = listed.filter((t) => t.problems?.length);
      if (!listed.length) return { status: 'fail', message: 'No artifact types are installed', fix: 'Reinstall Open Artifact (its built-in types are missing).' };
      if (!broken.length) return { status: 'ok', message: `${listed.length} artifact types` };
      return broken.map((t) => ({ status: 'warn' as const, message: `Type ${t.id} (${t.dir}): ${t.problems!.join('; ')}`, fix: 'Fix or remove that type folder (open-artifact types lists them).' }));
    } finally {
      registry.close();
    }
  },
};

const harnessProfileCheck: DoctorCheck = {
  id: 'harness-profile',
  title: 'Harness profile',
  applies: ({ harness }) => !!harness,
  run: ({ harness }) => {
    if (!HARNESS_NAME.test(harness!)) return { status: 'fail', message: `${harness} is not a harness name`, fix: 'A harness name is lowercase letters, digits, . _ -.' };
    const profile = harnessProfile(harness!);
    if (!profile.source) return { status: 'warn', message: `No profile of ${harness}: the defaults apply (agent name "Agent", no session markers)`, fix: `Connect its adapter once (it reports a profile), or add one: open-artifact harness add <profile.json>.` };
    const markers = profile.markers?.length ? `markers ${profile.markers.join(', ')}` : 'no session markers';
    return { status: 'ok', message: `Profile of ${harness} (${profile.source}): agent "${profile.agentName}", ${markers}` };
  },
};

const harnessAdapter: DoctorCheck = {
  id: 'harness-adapter',
  title: 'Adapter connection',
  applies: ({ harness }) => !!harness,
  run: async ({ harness, daemon }) => {
    const state = await daemon();
    if (!state) return { status: 'warn', message: `No adapter of ${harness} can be connected: the daemon is not running`, fix: `Open ${harness}; its adapter starts the daemon.` };
    const answer = await api<HarnessesResponse>(state, 'harnesses');
    const adapters = (answer.adapters ?? []).filter((a) => a.harness === harness);
    if (!adapters.length) return { status: 'warn', message: `No adapter of ${harness} is connected`, fix: `Open ${harness} (or check its Open Artifact plugin is installed and enabled).` };
    const sessions = adapters.reduce((n, a) => n + a.sessions.length, 0);
    return { status: 'ok', message: `${adapters.length} adapter${adapters.length === 1 ? '' : 's'} of ${harness} connected, ${sessions} session${sessions === 1 ? '' : 's'} attached` };
  },
};

const tools: DoctorCheck = {
  id: 'tools',
  title: 'Tools',
  run: async ({ daemon }) => {
    const state = await daemon();
    if (!state) return { status: 'ok', message: 'Tools: not checked (the daemon is not running)' };
    const answer = await api<{ tools?: ToolDefinition[] }>(state, 'tools');
    const names = new Set<string>((answer.tools ?? []).map((t) => t.name));
    const missing = ['Artifact', 'ArtifactData', 'ArtifactComments'].filter((name) => !names.has(name));
    return missing.length
      ? { status: 'fail', message: `The daemon does not list ${missing.join(', ')}`, fix: 'Restart the daemon (open-artifact daemon stop), then try again.' }
      : { status: 'ok', message: `Tools: ${[...names].join(', ')}` };
  },
};

/** Settings that do not parse are read as the defaults; say so. */
const settings: DoctorCheck = {
  id: 'settings',
  title: 'Settings',
  run: ({ home }) => {
    const file = join(home, 'settings.json');
    if (!existsSync(file)) return { status: 'ok', message: 'Settings: the defaults (no settings.json)' };
    try {
      JSON.parse(readFileSync(file, 'utf8'));
      return { status: 'ok', message: `Settings: ${file}` };
    } catch (error) {
      return { status: 'fail', message: `settings.json is not valid JSON (${(error as Error).message})`, fix: `Fix or remove ${file}; until then the defaults apply.` };
    }
  },
};

/** Every check, in the order they run. Append another module's checks here. */
export const DOCTOR_CHECKS: readonly DoctorCheck[] = [node, home, settings, daemon, nodeChildren, runtime, types, harnessProfileCheck, harnessAdapter, tools, ...REMOTE_CHECKS, ...CONFORMANCE_CHECKS];
