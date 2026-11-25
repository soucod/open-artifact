/**
 * Whether an `open-artifact` command runs inside an agent's session, and which of the person's own decisions it then
 * refuses.
 *
 * The rule (decision 14, and section 21 for a dashboard's rows): only a person publishes an artifact to a site,
 * connects or disconnects a site, chooses the default site or turns automatic publishing on or off, and only a
 * person's own publish confirms that a dashboard's connector rows go to the site. The agent's tools never do these
 * (`Artifact {action: "share"}` only reports, unless the person set `remotes.<name>.agentMayPublish`). But an agent
 * that has a shell can run this command line too, and the daemon takes whoever holds its token for the person.
 *
 * So the command line looks for the variables the agent apps set in the commands their agents run (each harness
 * profile's `markers` and `sessionEnv`, the union over every profile file) and refuses those commands there, with one sentence telling the
 * agent what to do instead: ask the person. A person's own terminal has none of these variables, so nothing changes
 * for them. The one override is the person's setting `remotes.<name>.agentMayPublish` (publish and unpublish on that
 * site only); connecting, removing, the default site, automatic publishing and a dashboard's data have none: they
 * are done in the Share panel or a terminal of the person's own.
 *
 * This is a guard rail, not a security boundary. The agent runs as the person's operating-system user: it can unset
 * the variables, call the daemon's routes with the token in `daemon.json`, or edit `settings.json`. What the guard
 * does is make the honest path the easy one; what the daemon does (`daemon.ts`, `askedBy`) is write every publish,
 * unpublish, data confirmation, site change and auto-publish change to its log with who asked, so a person can see
 * what happened.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OpenArtifactSettings } from '@open-artifact/protocol';

/** An agent session a command runs in. */
export interface AgentSession {
  /** The harness, e.g. `claude-code`. */
  harness: string;
  /** The variable that gave it away, e.g. `CLAUDECODE`. */
  variable: string;
  /** The session id, from the harness profile's `sessionEnv`, when it is set. */
  session: string | null;
}

const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

/** What the profiles say about one harness's variables. */
interface HarnessVariables {
  /** Variables that mark its agent's commands (`markers`, then `sessionEnv`). */
  markers: string[];
  /** Variables that hold its session id (`sessionEnv`). */
  session: string[];
}

/**
 * Every harness's variables in these profile folders, in order (the folders in the order given, the files in each by
 * name). A harness with a file in more than one folder gets the union of them: whatever a later file says, it never
 * takes away a variable an earlier one named. Files of every source count, shipped, adapter-reported and the person's,
 * so no profile can switch off the guard for an agent another one recognises.
 */
function harnessVariables(profileDirs: readonly string[]): Map<string, HarnessVariables> {
  const found = new Map<string, HarnessVariables>();
  for (const dir of profileDirs) {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const file of names.sort()) {
      if (!file.endsWith('.json')) continue;
      const harness = file.slice(0, -'.json'.length);
      if (!NAME.test(harness)) continue;
      let profile: { markers?: unknown; sessionEnv?: unknown };
      try {
        profile = JSON.parse(readFileSync(join(dir, file), 'utf8')) as typeof profile;
      } catch {
        continue; // not a profile: skip it
      }
      if (!profile || typeof profile !== 'object') continue;
      let entry = found.get(harness);
      if (!entry) found.set(harness, (entry = { markers: [], session: [] }));
      const markers = Array.isArray(profile.markers) ? profile.markers.filter((m): m is string => typeof m === 'string' && VARIABLE.test(m)) : [];
      const sessionEnv = typeof profile.sessionEnv === 'string' && VARIABLE.test(profile.sessionEnv) ? profile.sessionEnv : null;
      for (const marker of [...markers, ...(sessionEnv ? [sessionEnv] : [])]) if (!entry.markers.includes(marker)) entry.markers.push(marker);
      if (sessionEnv && !entry.session.includes(sessionEnv)) entry.session.push(sessionEnv);
    }
  }
  return found;
}

/**
 * Every variable that marks an agent's command, by variable -> harness: each profile's `markers` and `sessionEnv` in
 * `profileDirs` (the shipped profiles, then the person's `<home>/harnesses`, which also holds what adapters reported).
 * A variable two harnesses name goes to the first. Tests and the e2e runner remove these from their own environment,
 * since they may themselves run inside an agent's session.
 */
export function agentVariables(profileDirs: readonly string[] = []): Map<string, string> {
  const all = new Map<string, string>();
  for (const [harness, { markers }] of harnessVariables(profileDirs)) for (const variable of markers) if (!all.has(variable)) all.set(variable, harness);
  return all;
}

/** The agent session this process runs in, from its environment, or `null` (a person's own terminal). */
export function agentSessionOf(env: Readonly<Record<string, string | undefined>>, profileDirs: readonly string[] = []): AgentSession | null {
  const harnesses = harnessVariables(profileDirs);
  for (const [variable, harness] of agentVariables(profileDirs)) {
    if (!env[variable]) continue;
    // The session id is the harness's own session variable when it is set (a marker such as CLAUDECODE says only
    // "in Claude Code").
    const sessionVariable = harnesses.get(harness)?.session.find((name) => env[name]);
    return { harness, variable, session: sessionVariable ? env[sessionVariable]! : null };
  }
  return null;
}

/** One of the person's own decisions the command line refuses inside an agent session. */
export type PersonAct =
  | 'publish'
  | 'unpublish'
  | 'data'
  | 'remote-add'
  | 'remote-remove'
  | 'remote-default'
  | 'remote-auto'
  | 'harness-add'
  | 'harness-remove'
  | 'runtime-update'
  | 'runtime-pin'
  | 'runtime-policy'
  | 'type-enable'
  | 'type-disable'
  | 'type-trust'
  | 'type-untrust'
  | 'type-install'
  | 'type-update'
  | 'type-uninstall'
  | 'type-publish'
  | 'type-unpublish';

/** What each act is, in the refusal. */
const ACT_TEXT: Record<PersonAct, { what: string; panel: string }> = {
  publish: { what: 'Publishing an artifact to a site', panel: 'publish it from the artifact’s Share panel' },
  unpublish: { what: 'Taking an artifact off its site', panel: 'unpublish it from the artifact’s Share panel' },
  data: { what: 'Publishing a dashboard’s data (the rows from their connectors)', panel: 'publish its data from the dashboard’s Share panel' },
  'remote-add': { what: 'Connecting this computer to a site', panel: 'connect the site from an artifact’s Share panel' },
  'remote-remove': { what: 'Removing a site', panel: 'remove it' },
  'remote-default': { what: 'Choosing the default site', panel: 'choose it in an artifact’s Share panel' },
  'remote-auto': { what: 'Turning automatic publishing on or off', panel: 'switch it in an artifact’s Share panel' },
  // A profile is standing configuration, and the person's own may carry a command the daemon runs (`nudge`).
  'harness-add': { what: 'Adding a harness profile', panel: 'read the profile and add it' },
  'harness-remove': { what: 'Removing a harness profile', panel: 'remove it' },
  // Code from the registry that the daemon will run: the person's call, like the profile.
  'runtime-update': { what: 'Updating the Open Artifact runtime', panel: 'run the update' },
  'runtime-pin': { what: 'Pinning the Open Artifact runtime to a version range', panel: 'set the pin' },
  'runtime-policy': { what: 'Changing the Open Artifact runtime update policy', panel: 'set the policy' },
  // Which types run on this computer: a project's types run code from that project once it is trusted.
  'type-enable': { what: 'Turning a type on', panel: 'switch it on in the Types tab of the home page' },
  'type-disable': { what: 'Turning a type off', panel: 'switch it off in the Types tab of the home page' },
  'type-trust': { what: "Trusting a project's types", panel: 'trust the project in the Types tab of the home page' },
  'type-untrust': { what: "Taking back the trust in a project's types", panel: 'run the command' },
  // Another publisher's type, whose instructions agents will be given: the person reads it and decides.
  'type-install': { what: 'Installing a type', panel: 'install it from the Types tab of the home page, where they read it first' },
  'type-update': { what: 'Updating an installed type', panel: 'update it from the Types tab of the home page' },
  'type-uninstall': { what: 'Uninstalling a type', panel: 'uninstall it from the Types tab of the home page' },
  // A type's pages and instructions go to everyone who opens its artifacts on the site: never an agent's to send.
  'type-publish': { what: 'Publishing a type to a site', panel: 'run the command' },
  'type-unpublish': { what: 'Taking a type off a site', panel: 'run the command' },
};

/**
 * Whether the person let agents do `act` on `remote`: `remotes.<remote>.agentMayPublish` for publish and unpublish;
 * nothing else has an override.
 */
export function agentMay(act: PersonAct, remote: string | null | undefined, settings: Pick<OpenArtifactSettings, 'remotes'>): boolean {
  if (act !== 'publish' && act !== 'unpublish') return false;
  return !!remote && settings.remotes?.[remote]?.agentMayPublish === true;
}

/**
 * The refusal for `act` inside `agent`, or `null` when it may go ahead (no agent session, or the person allowed it).
 * `command` is the command line to give the person, e.g. `open-artifact publish art_x --remote work`. The last
 * sentence is the one an agent acts on.
 */
export function personOnlyRefusal(
  act: PersonAct,
  agent: AgentSession | null,
  options: { remote?: string | null; settings: Pick<OpenArtifactSettings, 'remotes'>; command: string },
): string | null {
  if (!agent || agentMay(act, options.remote, options.settings)) return null;
  const text = ACT_TEXT[act];
  return (
    `${text.what} is the person's decision, and this command runs inside an agent session (${agent.harness}: ${agent.variable} is set), so it was not done.\n` +
    `Ask the person to ${text.panel}, or to run \`${options.command}\` in their own terminal.`
  );
}

/** What `open-artifact publish` does about a dashboard's live data once the page is published. */
export type DataChoice =
  /** Nothing to decide: no live query, or its data is published already. */
  | 'none'
  /** Ask the person at the terminal (the Share panel's question). */
  | 'ask'
  /** Published without its rows: no terminal to ask at. */
  | 'no-terminal'
  /** Published without its rows: an agent session never confirms data. */
  | 'agent';

/**
 * {@link DataChoice}: a dashboard with live queries whose data is not confirmed is asked about only when a person
 * can answer (stdin and stdout are a terminal, and no agent session); otherwise it is published without its rows and
 * the command says how to add them.
 */
export function dataChoice(options: { live: boolean; confirmed: boolean; agent: AgentSession | null; interactive: boolean }): DataChoice {
  if (!options.live || options.confirmed) return 'none';
  if (options.agent) return 'agent';
  return options.interactive ? 'ask' : 'no-terminal';
}

/** The question `open-artifact publish` asks at a terminal, as the Share panel does. */
export const DATA_QUESTION = 'This publishes the rows from your connectors to everyone the dashboard is shared with. Publish the data too? [y/N] ';

/** Whether an answer to {@link DATA_QUESTION} is yes. */
export function saidYes(answer: string): boolean {
  return /^\s*y(es)?\s*$/i.test(answer);
}

/** What `open-artifact publish` prints when a dashboard went up without its rows. */
export function dataLeftOut(id: string, choice: 'no-terminal' | 'agent'): string {
  const how = `Its live data was not published: the page there shows no figures until the person publishes the data, from the dashboard's Share panel ("Publish its data") or with \`open-artifact publish ${id}\` in their own terminal, which asks.`;
  return choice === 'agent' ? `${how} An agent session never publishes a dashboard's data.` : how;
}
