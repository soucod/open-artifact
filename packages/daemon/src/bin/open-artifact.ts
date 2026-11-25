#!/usr/bin/env node
/**
 * `open-artifact`: the Open Artifact command line.
 *
 *   open-artifact daemon run [--port <n>] | ensure | status | stop
 *   open-artifact mcp [--harness <name>] [--channel]     stdio MCP server, bridged to the daemon (--channel: push comment notices, claude/channel)
 *   open-artifact types [list] [--workspace <dir>]
 *   open-artifact types new <id> [--scope user|project] [--template page|data] [--name <name>] | check <id|dir> [--for-share]
 *   open-artifact types from <page artifact | saved page folder|.html> --id <id> [--scope user|project] | enable|disable <id> | trust|untrust [<dir>]
 *   open-artifact artifact '<json args>'                 the Artifact tool; also: open-artifact data '<json>', open-artifact comments '<json>'
 *   open-artifact open <url|id>                          print the view url (and ask the owner's harness to show it)
 *   open-artifact wait [--timeout <ms>]                  wait for this session's next messages (OPEN_ARTIFACT_SESSION / --session)
 *   open-artifact hook <event> [--harness <name>]        harness hooks: SessionStart, UserPromptSubmit, Stop
 *   open-artifact watch [--harness <name>]               print a line whenever comments wait for this session (a harness monitor)
 *   open-artifact chatgpt [--port <n>] [--workspace <dir>] [--rotate]   the tools over HTTP for ChatGPT on the web (behind an HTTPS tunnel)
 *   open-artifact home                                   print the Open Artifact home folder
 *   open-artifact skill render [--command X] [--harness H] [--form entry|full] | install --command X --dir D [...]   the skill for a harness
 *   open-artifact harness add <profile.json> | list [--json] | remove <name>   harness profiles of your own
 *   open-artifact harness --stdio --harness <name>       the Harness API as JSON-RPC lines on stdin/stdout (stdio-bridge.ts)
 *   open-artifact runtime status [--json] [--check] | update [--version <v>] | pin <range>|--clear | policy [<word>]   the runtime (cli-runtime.ts)
 *   open-artifact doctor [--harness <name> [--session <id>]] [--json]   check the setup (doctor.ts); with --session, the host's conformance steps (doctor-conformance.ts)
 *   open-artifact remote add <name> <https://host> [--insecure-http] [--no-browser] | list | remove <name> [--force] [--json] | status [--json]    cloud remotes
 *   open-artifact remote default <name> | --clear       the remote used when none is named
 *   open-artifact remote auto on|off                     publish new artifacts to the default remote by themselves
 *   open-artifact publish <id|folder> [--remote <name>]  publish an artifact (a folder not added yet is added first); unpublish <id> takes it off
 *   open-artifact --version | -v                         print this runtime's version (as the single-file executable does)
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { resolve as resolvePath, sep } from 'node:path';
import { createInterface } from 'node:readline';
import { LIBRARY_ROUTES, type DaemonState, type SessionRef, type ToolCallResult, type TypesFromResponse, type TypesNewResponse, type TypePackagePreview, type TypesSettingResponse, type TypesPublishResponse, type TypesUnpublishResponse } from '@open-artifact/protocol';
import { agentSessionOf, dataChoice, dataLeftOut, DATA_QUESTION, personOnlyRefusal, saidYes, type PersonAct } from '../agent-session.ts';
import { api, ensureDaemon, readDaemon } from '../client.ts';
import { harnessProfile, shippedProfilesDir } from '../harness.ts';
import { addUserProfile, listProfiles, removeProfile } from '../harness-profiles.ts';
import { hookDialectOf } from '../hook-dialects.ts';
import { clientShowsApps } from '../mcp-app.ts';
import { files, openArtifactHome } from '../paths.ts';
import { remoteRemovedText, remoteStatusText } from '../remote-status.ts';
import type { CloudStatus, RemoteStatus } from '../link.ts';
import { loadSettings } from '../settings.ts';
import { TypeRegistry } from '../types.ts';
import { checkType, typeDirOf } from '../type-authoring.ts';
import { isAddress, loadTypePackage, packType, previewText, typeSourceOf } from '../type-packages.ts';
import { skillCommand } from '../cli-skill.ts';
import { runtimeCommand } from '../cli-runtime.ts';
import { doctorText, runDoctor } from '../doctor.ts';
import { DOCTOR_CHECKS } from '../doctor-checks.ts';
import { runStdioBridge } from '../stdio-bridge.ts';
import pkg from '../../package.json' with { type: 'json' };

const argv = process.argv.slice(2);

const USAGE = `open-artifact daemon run [--port <n>] | ensure | status | stop
open-artifact mcp [--harness <name>] [--channel]     stdio MCP server, bridged to the daemon (--channel: push comment notices, claude/channel)
open-artifact types [list] [--workspace <dir>]   the types here (JSON): scope, source (builtin | local | installed), version, uid…
open-artifact types new <id> [--scope user|project] [--template page|data] [--name <name>]
                                                     make a starter type (default: in the user root, the page template)
open-artifact types check <id|folder> [--for-share]  what is wrong with a type (JSON); exits 1 when there are errors
open-artifact types from <page artifact | saved page> --id <id> [--scope user|project] [--name <name>]
                                                     make a type from a page artifact, or from a page saved
                                                     from claude.ai (a folder with index.html, or an .html file)
open-artifact types enable <id> | disable <id>       turn a type on or off (settings.json disabledTypes)
open-artifact types trust [<dir>] | untrust [<dir>]  trust a project folder's types (default: this folder) or stop
open-artifact types pack <id|folder> [--out <file|dir>]   check a type for sharing and write <id>-<version>.oatype
                                                     (prints its path, sha256 and size)
open-artifact types install <file.oatype|https://…> [--as <id>] [--yes]   show what the package is (name, version,
                                                     source, capabilities, network, its SKILL.md), ask, then install it
open-artifact types update <id> [--yes] | uninstall <id>   fetch an installed type again from its source, or remove it
open-artifact import <artifact.zip> [--folder <dir>] an artifact's archive (its Download zip) as an artifact here; its
                                                     type (the same uid) must be here
open-artifact artifact '<json args>'                 the Artifact tool; also: open-artifact data '<json>', open-artifact comments '<json>'
open-artifact open <url|id>                          print the view url (and ask the owner's harness to show it)
open-artifact wait [--timeout <ms>]                  wait for this session's next messages (OPEN_ARTIFACT_SESSION / --session)
open-artifact hook <event> [--harness <name>]        harness hooks: SessionStart, UserPromptSubmit, Stop
open-artifact watch [--harness <name>]               print a line whenever comments wait for this session (a harness monitor)
open-artifact chatgpt [--port <n>] [--workspace <dir>] [--rotate]   the tools over HTTP for ChatGPT on the web (behind an HTTPS tunnel)
open-artifact home                                   print the Open Artifact home folder
open-artifact skill render [--command <name>] [--harness <name>] [--form entry|full] [--workspace <dir>] [--json]
                                                     the /open-artifact skill as that harness gets it (its command, rules…)
open-artifact skill install --command <name> --dir <skills folder> [--harness <name>] [--form entry|full] [--force]
                                                     write <dir>/<name>/SKILL.md, only when it changed
open-artifact harness add <profile.json>             add your own profile of a harness (it wins over the shipped one
                                                     and over what the harness's adapter reports)
open-artifact harness list [--json]                  the harness profiles in effect, and where each comes from
open-artifact harness remove <name>                  remove a profile from <home>/harnesses (a shipped one stays)
open-artifact harness --stdio --harness <name>       the Harness API for a host, as JSON-RPC 2.0 lines on stdin/stdout
                                                     (starts the daemon, says hello, reconnects; logs on stderr)
open-artifact runtime status [--json] [--check]      the runtimes here, which one starts, updates (--check asks now)
open-artifact runtime update [--version <x.y.z>]     install the newest compatible runtime from npm (checked by sha512)
open-artifact runtime pin <range> | --clear          keep the runtime within a version range, e.g. ^0.14
open-artifact runtime policy [auto|prompt|bundled|default]   the update policy in effect and where it comes from; a word
                                                     sets yours (default removes it)
open-artifact doctor [--harness <name>] [--json]     check this computer's setup; exits non-zero when a check fails
open-artifact doctor --harness <name> --session <id> [--json]   also run the host's conformance steps as that session
                                                     (makes and removes a test artifact, asks the session once)
open-artifact remote add <name> <https://host> [--insecure-http] [--no-browser]   link this computer to a cloud host (signs
                                                     in in the browser; --no-browser prints the address and code instead;
                                                     http only on a private network, unless --insecure-http)
open-artifact remote list | status [--json] | remove <name> [--force] [--json]
open-artifact remote default <name> | --clear        the remote publish uses when none is named (the first one added)
open-artifact remote auto on|off                     publish every new artifact to the default remote by itself
open-artifact publish <id|folder> [--remote <name>]  publish an artifact to a cloud remote (its folder keeps syncing;
                                                     a folder not added yet is added first)
open-artifact unpublish <id>                         take it off the host; it is local only again
open-artifact --version | -v                         print this runtime's version
publish, unpublish and remote add / remove / default / auto are the person's decisions: run inside an agent's session,
they are refused, and the agent asks the person instead (so are harness add / remove, runtime update / pin / policy and
types enable / disable / trust / untrust / install / update / uninstall).`;

/** Takes `--name <value>` out of the arguments. */
function flag(name: string): string | undefined;
function flag(name: string, fallback: string): string;
function flag(name: string, fallback?: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const value = argv[i + 1];
  argv.splice(i, 2);
  return value ?? fallback;
}

const out = (value: unknown): void => void process.stdout.write(`${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`);

function die(message: string, code = 1): never {
  process.stderr.write(`open-artifact: ${message}\n`);
  process.exit(code);
}

/** The session id from the harness profile's own environment variable, if it names one. */
function sessionFromEnv(harness: string): string | undefined {
  const variable = harnessProfile(harness).sessionEnv;
  return process.env.OPEN_ARTIFACT_SESSION ?? (variable ? process.env[variable] : undefined);
}

/** Who this command runs for: `--session`, `OPEN_ARTIFACT_SESSION`, or the harness's own variable. */
function caller(): SessionRef {
  const harness = flag('harness') ?? process.env.OPEN_ARTIFACT_HARNESS ?? 'cli';
  const session = flag('session') ?? sessionFromEnv(harness) ?? null;
  return { harness, session, workspace: flag('workspace') ?? process.cwd() };
}

/** This process's ancestors' pids (a hook's parent may be a shell the harness started). */
/**
 * This process's folder as the caller's workspace, unless it is a plugin's own folder: agent apps (Codex, Antigravity)
 * start a plugin's MCP server and hooks there, and what is made must not land in the plugin. The skill's launcher
 * names its plugin (`OPEN_ARTIFACT_PLUGIN_DIR`); the apps name theirs too.
 */
function ownWorkspace(): string | null {
  const real = (dir: string): string => {
    try {
      return realpathSync(dir);
    } catch {
      return resolvePath(dir);
    }
  };
  const cwd = real(process.cwd());
  const env = process.env;
  const plugins = [env.OPEN_ARTIFACT_PLUGIN_DIR, env.PLUGIN_ROOT, env.CLAUDE_PLUGIN_ROOT, env.CURSOR_PLUGIN_ROOT].filter((dir): dir is string => !!dir);
  return plugins.some((dir) => {
    const root = real(dir);
    return cwd === root || cwd.startsWith(root + sep);
  })
    ? null
    : process.cwd();
}

function ancestors(start = process.ppid, depth = 4): number[] {
  const pids: number[] = [];
  let pid = start;
  for (let i = 0; i < depth && pid > 1; i++) {
    pids.push(pid);
    try {
      pid = Number(execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' }).trim());
    } catch {
      break;
    }
  }
  return pids;
}

async function tool(name: string, json: string | undefined): Promise<void> {
  let args: Record<string, unknown>;
  try {
    args = json ? (JSON.parse(json) as Record<string, unknown>) : {};
  } catch {
    die(`${name}: the argument is JSON, like '{"action": "list", "scope": "types"}'`);
  }
  const who = caller();
  const state = await ensureDaemon();
  const result = await api<ToolCallResult>(state, 'tools.call', { name, arguments: args, caller: who });
  out(result);
  if (result?.error) process.exitCode = 1;
}

/** The note a channel-mode bridge adds to the MCP `instructions`. */
const CHANNEL_NOTE =
  'Messages that arrive as <channel source="open-artifact" …> say that the person sent comments or requests from an artifact\'s page. Call ArtifactComments {action: "read", url} with the url they name: its result carries the messages. Then handle them as any "[Artifact comment sent to agent]" message.';

/**
 * Channel mode (`open-artifact mcp --channel`, for harnesses whose MCP client takes server-pushed messages, such as
 * Claude Code's `claude/channel`): watches the daemon's events and, when a comment or request for this session lands
 * in its inbox, pushes a short notice telling the agent to read it. The notice carries no comment text and takes
 * nothing from the inbox, so where the harness drops it (channels off) the messages still reach the agent through
 * its hooks or its next Open Artifact call.
 */
function watchWakes(options: {
  harness: string;
  session: string | undefined;
  daemon: () => Promise<DaemonState>;
  notify: (artifact: { url: string; title: string }) => void;
  depth?: number;
}): void {
  const pids = ancestors(process.ppid, options.depth ?? 2);
  let mine: SessionRef | null = options.session ? { harness: options.harness, session: options.session, workspace: ownWorkspace() } : null;
  const pending = new Map<string, ReturnType<typeof setTimeout>>();
  const resolveMine = async (state: DaemonState): Promise<SessionRef | null> => {
    if (mine) return mine;
    const body = await api<{ session?: SessionRef | null }>(state, 'session.resolve', { pids, harness: options.harness, workspace: ownWorkspace() }).catch(() => ({
      session: null,
    }));
    if (body.session?.session) mine = body.session;
    return mine;
  };
  const notice = async (state: DaemonState, id: string): Promise<void> => {
    const [me, artifact] = await Promise.all([
      resolveMine(state),
      api<{ url?: string; title?: string; owner?: { harness?: string; session?: string | null } | null }>(state, 'artifact', undefined, { query: { id } }).catch(() => null),
    ]);
    if (!me?.session || !artifact?.url || artifact.owner?.harness !== me.harness || artifact.owner?.session !== me.session) return;
    options.notify({ url: artifact.url, title: String(artifact.title ?? 'an artifact').replace(/\s+/g, ' ').slice(0, 120) });
  };
  const connect = async (): Promise<void> => {
    for (;;) {
      try {
        const state = await options.daemon();
        await resolveMine(state);
        const response = await fetch(new URL('/api/open-artifact.events', state.url), { headers: { Authorization: `Bearer ${state.token}` } });
        if (!response.ok || !response.body) throw new Error(`events: ${response.status}`);
        const decoder = new TextDecoder();
        let buffer = '';
        for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
          buffer += decoder.decode(chunk, { stream: true });
          let end: number;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const data = block
              .split('\n')
              .filter((l) => l.startsWith('data:'))
              .map((l) => l.slice(5).trim())
              .join('\n');
            if (!data) continue;
            let event: { type?: string; artifactId?: string; via?: string };
            try {
              event = JSON.parse(data) as typeof event;
            } catch {
              continue;
            }
            // Only what waits in an inbox: a live delivery or a wait that took it needs no notice.
            if (event.type !== 'wake/state' || event.via !== 'inbox' || !event.artifactId) continue;
            const id = event.artifactId;
            // Several comments sent at once make one notice.
            clearTimeout(pending.get(id));
            pending.set(
              id,
              setTimeout(() => {
                pending.delete(id);
                void notice(state, id);
              }, 1500),
            );
          }
        }
      } catch {
        // The daemon went away or restarted: try again shortly.
      }
      await new Promise((done) => setTimeout(done, 3000));
    }
  };
  void connect();
}

/** The one-line notice of comments waiting for the agent (it carries no comment text, so it cannot be forged from a page). */
function wakeNotice(url: string, title: string): string {
  return `The person sent comments or requests from the artifact "${title}". Call ArtifactComments {action: "read", url: "${url}"} to receive them, then handle them.`;
}

/**
 * `open-artifact watch [--harness <name>]`: prints one line per comment notice for this session, for as long as it
 * runs (a harness's background monitor, such as a Claude Code plugin monitor, turns each line into a notification).
 * The session is OPEN_ARTIFACT_SESSION / the profile's variable, else the one a hook registered for an ancestor
 * process. It waits for a daemon rather than starting one.
 */
async function watch(): Promise<void> {
  const harness = flag('harness', process.env.OPEN_ARTIFACT_HARNESS ?? 'mcp');
  const session = sessionFromEnv(harness);
  const daemon = async (): Promise<DaemonState> => {
    for (;;) {
      const state = await readDaemon();
      if (state) return state;
      await new Promise((done) => setTimeout(done, 5000));
    }
  };
  watchWakes({ harness, session, daemon, depth: 4, notify: ({ url, title }) => out(`Open Artifact: ${wakeNotice(url, title)}`) });
}

async function mcpBridge(): Promise<void> {
  const harness = flag('harness', process.env.OPEN_ARTIFACT_HARNESS ?? 'mcp');
  const channel = argv.includes('--channel') || process.env.OPEN_ARTIFACT_CHANNEL === '1';
  if (argv.includes('--channel')) argv.splice(argv.indexOf('--channel'), 1);
  const session = sessionFromEnv(harness);
  const workspace = ownWorkspace();
  const ppids = ancestors(process.ppid, 4).join(',');
  let state: DaemonState = await ensureDaemon();
  // The client shows MCP Apps (it said so in initialize): the daemon then offers ShowArtifact and its view.
  let apps = false;
  const headers = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${state.token}`,
    'X-Open-Artifact-Harness': harness,
    ...(workspace ? { 'X-Open-Artifact-Workspace': encodeURIComponent(workspace) } : {}),
    'X-Open-Artifact-PPID': ppids,
    ...(session ? { 'X-Open-Artifact-Session': session } : {}),
    ...(apps ? { 'X-Open-Artifact-UI': '1' } : {}),
  });
  const write = (line: string): void => void process.stdout.write(`${line}\n`);
  let watching = false;
  const send = async (line: string): Promise<void> => {
    let message: { id?: unknown; method?: string; params?: { capabilities?: unknown } };
    try {
      message = JSON.parse(line) as typeof message;
    } catch {
      return;
    }
    if (message.method === 'initialize') apps = clientShowsApps(message.params?.capabilities);
    if (channel && message.method === 'notifications/initialized' && !watching) {
      watching = true;
      watchWakes({
        harness,
        session,
        daemon: async () => (state = (await readDaemon()) ?? (await ensureDaemon())),
        notify: ({ url, title }) =>
          write(
            JSON.stringify({
              jsonrpc: '2.0',
              method: 'notifications/claude/channel',
              params: { content: wakeNotice(url, title), meta: { artifact_url: url, kind: 'artifact_comments' } },
            }),
          ),
      });
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(`${state.url}/mcp`, { method: 'POST', headers: headers(), body: JSON.stringify(message) });
        if (response.status === 401 && attempt === 0) {
          // The daemon restarted with a new token (e.g. after idle exit); refresh once and retry.
          state = await ensureDaemon();
          continue;
        }
        if (response.status === 202) return;
        let text = await response.text();
        if (channel && message.method === 'initialize' && text) {
          // Declare the channel and say what its messages mean.
          try {
            const reply = JSON.parse(text) as { result?: { capabilities?: Record<string, unknown>; instructions?: string } };
            if (reply.result) {
              const capabilities = reply.result.capabilities ?? {};
              capabilities.experimental = { ...((capabilities.experimental as object) ?? {}), 'claude/channel': {} };
              reply.result.capabilities = capabilities;
              reply.result.instructions = `${reply.result.instructions ?? ''}\n\n${CHANNEL_NOTE}`.trim();
              text = JSON.stringify(reply);
            }
          } catch {
            // not JSON: pass it on as it is
          }
        }
        if (text) write(text.replace(/\n/g, ' '));
        return;
      } catch {
        state = await ensureDaemon();
      }
    }
    if (message.id !== undefined) {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32002, message: 'The open-artifact daemon is not reachable.' } })}\n`);
    }
  };
  const lines = createInterface({ input: process.stdin });
  // Calls run concurrently (a wait must not hold the rest); answers go out as they come.
  lines.on('line', (line) => {
    if (line.trim()) void send(line);
  });
  lines.on('close', () => setTimeout(() => process.exit(0), 50));
}

/** A harness hook: registers the session and hands it what waited. */
async function hook(event: string | undefined): Promise<void> {
  if (!event) die('hook <event>');
  let input: Record<string, unknown> = {};
  try {
    const text = readFileSync(0, 'utf8');
    input = text.trim() ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    input = {};
  }
  const harness = flag('harness', process.env.OPEN_ARTIFACT_HARNESS ?? 'mcp');
  // The harness's hook format (its profile's `hookDialect`, see hook-dialects.ts): event names, input and answer.
  const dialect = hookDialectOf(harnessProfile(harness));
  const session = dialect.session(input) ?? sessionFromEnv(harness) ?? null;
  const workspace = dialect.workspace(input) ?? ownWorkspace();
  const canonical = dialect.event(event);
  const running = await readDaemon();
  if (!running && canonical !== 'SessionStart') return;
  const state = running ?? (await ensureDaemon());
  const take = !dialect.leaves(event, input);
  const body = await api<{ messages?: string[] }>(state, 'hook', { event: canonical, harness, session, workspace, pids: ancestors(process.ppid, 4), take }).catch(
    () => ({ messages: [] }),
  );
  const messages = body.messages ?? [];
  if (!messages.length) return;
  const answer = dialect.answer(event, messages.join('\n\n'), input);
  if (answer) out(answer);
}

/** `open-artifact chatgpt`: the ChatGPT connector, until stopped. */
async function chatgpt(): Promise<void> {
  const { chatgptSecret, serveChatGpt } = await import('../chatgpt.ts');
  const port = Number(flag('port', '4891'));
  const workspace = resolvePath(flag('workspace') ?? process.cwd());
  const secret = chatgptSecret(argv.includes('--rotate'));
  const server = await serveChatGpt({
    port,
    workspace,
    secret,
    daemon: async () => (await readDaemon()) ?? (await ensureDaemon()),
    log: (line) => process.stderr.write(`${line}\n`),
  });
  const local = `http://127.0.0.1:${port}/mcp/${secret}`;
  out(
    [
      `Open Artifact for ChatGPT, at ${local}`,
      `New artifacts go under ${workspace}/artifacts/.`,
      '',
      'To add it to ChatGPT on the web:',
      `1. Put it behind HTTPS, e.g. OpenAI's Secure MCP Tunnel or \`cloudflared tunnel --url http://127.0.0.1:${port}\`.`,
      `2. In ChatGPT (chatgpt.com/plugins), add a custom MCP server: the tunnel's https URL followed by /mcp/${secret}, with no authentication.`,
      '3. In a chat, pick the app and ask for a deck, design, board, sheet, dashboard, doc or animation.',
      '',
      'The secret path is the only key: share it with no one; --rotate makes a new one. Stop with Ctrl-C.',
    ].join('\n'),
  );
  const stop = (): void => {
    server.close();
    process.exit(0);
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, stop);
}

async function daemon(sub: string | undefined): Promise<void> {
  switch (sub) {
    case 'run': {
      const { startDaemon } = await import('../daemon.ts');
      const port = flag('port');
      // The signal handlers are in place before the daemon writes `daemon.json`: a signal that comes while it starts
      // is kept and acted on once it has started, so the daemon still closes and removes its files.
      let running: Awaited<ReturnType<typeof startDaemon>> | undefined;
      let asked: NodeJS.Signals | undefined;
      // Type servers in worker threads (node-children.ts) finish their clean-up before the process ends.
      const exit = (): void => void running?.drained().finally(() => process.exit(0));
      const stop = (signal: NodeJS.Signals): void => {
        if (!running) {
          asked ??= signal;
          return;
        }
        running.close(signal);
        exit();
      };
      for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, stop);
      const started = await startDaemon(port !== undefined ? { port: Number(port) } : {});
      running = started;
      started.on('exit', exit);
      if (asked) return stop(asked);
      process.on('uncaughtException', (error) => started.log(`uncaught: ${error?.stack ?? error}`));
      process.on('unhandledRejection', (error) => started.log(`unhandled: ${(error as Error)?.stack ?? error}`));
      process.stderr.write(`open-artifact daemon at ${started.origin}\n`);
      return;
    }
    case 'ensure': {
      const { token: _token, ...shown } = await ensureDaemon();
      return out(shown);
    }
    case 'status': {
      const state = await readDaemon();
      if (!state) return out({ running: false, home: openArtifactHome() });
      const { token: _token, ...shown } = state;
      return out({ running: true, home: openArtifactHome(), ...shown, ...(await api<object>(state, 'harnesses')) });
    }
    case 'stop': {
      const state = await readDaemon();
      if (!state) return out({ running: false });
      process.kill(state.pid, 'SIGTERM');
      return out({ stopped: state.pid });
    }
    default:
      die('daemon run | ensure | status | stop');
  }
}

/**
 * The agent session this command runs in (`agent-session.ts`: the variables agent apps set in their agents' commands),
 * or `null` in a person's own terminal.
 */
// The shipped profiles first, so a harness they name keeps its name; every profile's markers count (the union).
const AGENT = agentSessionOf(process.env, [shippedProfilesDir(), files.harnesses()]);

/**
 * Who this command line is, for the daemon's log of publishing and site changes: the CLI, and the agent session it
 * runs in when there is one (only where the person allowed the act, or it would have been refused here).
 */
function whoHeaders(): Record<string, string> {
  return {
    'X-Open-Artifact-Client': 'cli',
    ...(AGENT ? { 'X-Open-Artifact-Agent': encodeURIComponent(`${AGENT.harness}${AGENT.session ? ` session ${AGENT.session}` : ''}`) } : {}),
  };
}

/**
 * Ends the command when `act` is the person's to do and it runs inside an agent session they did not allow it in
 * (`agent-session.ts`); `command` is what to give the person to run themselves.
 */
function personOnly(act: PersonAct, command: string, remote?: string | null): void {
  const refusal = personOnlyRefusal(act, AGENT, { remote: remote ?? null, settings: loadSettings(), command });
  if (refusal) die(refusal);
}

/** An error's message, with its fix when it has one. */
function errorText(error: unknown): string {
  const e = error as { message?: unknown; fix?: unknown };
  return `${String(e?.message ?? error)}${typeof e?.fix === 'string' ? `\n  ${e.fix}` : ''}`;
}

/** A Library API call whose body is a file's bytes (`types.preview`, `artifacts.import`); a failure ends the command. */
async function daemonUpload<T>(name: string, bytes: Uint8Array, query: Record<string, string>): Promise<T> {
  const state = await ensureDaemon();
  const url = new URL(`/api/open-artifact.${name}`, state.url);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const response = await fetch(url, {
    method: 'POST',
    headers: { ...whoHeaders(), Authorization: `Bearer ${state.token}`, 'Content-Type': 'application/octet-stream' },
    body: Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) as unknown as BodyInit,
  });
  const answer = (await response.json().catch(() => ({ code: 'error', message: `The daemon answered ${response.status}.` }))) as T & { code?: unknown; message?: unknown; fix?: unknown };
  if (answer && typeof answer === 'object' && typeof answer.code === 'string' && typeof answer.message === 'string') {
    die(`${answer.message}${typeof answer.fix === 'string' ? `\n  ${answer.fix}` : ''}`);
  }
  return answer;
}

/** `open-artifact import <zip> [--folder <dir>]`: an artifact's archive made into an artifact of this computer. */
async function importCommand(file: string | undefined): Promise<void> {
  const folder = flag('folder');
  if (!file) die('import <artifact.zip> [--folder <dir>]');
  let bytes: Buffer;
  const path = resolvePath(file);
  try {
    bytes = readFileSync(path);
  } catch (error) {
    die(`import: cannot read ${path} (${(error as Error).message})`);
  }
  const answer = await daemonUpload<{ id: string; url?: string; root?: string; type?: string }>(LIBRARY_ROUTES.import, bytes, { name: path, ...(folder ? { folder: resolvePath(folder) } : {}) });
  out(answer);
}

/** A Library API call whose failure (`{code, message}`) ends the command. */
async function daemonCall<T>(name: string, body?: unknown): Promise<T> {
  const state = await ensureDaemon();
  const answer = await api<T & { code?: unknown; message?: unknown; fix?: unknown }>(state, name, body, { headers: whoHeaders() });
  if (answer && typeof answer === 'object' && typeof answer.code === 'string' && typeof answer.message === 'string') {
    die(`${answer.message}${typeof answer.fix === 'string' ? `\n  ${answer.fix}` : ''}`);
  }
  return answer;
}

/** `open-artifact remote ...`: the cloud remotes this daemon is linked to. */
async function remote(sub: string | undefined): Promise<void> {
  switch (sub) {
    case 'add': {
      const insecureHttp = argv.includes('--insecure-http');
      // `--no-browser`: print the address and the code and open nothing (scripts, a remote shell, an agent's terminal).
      const noBrowser = argv.includes('--no-browser');
      const [name, host] = argv.filter((a) => a !== '--insecure-http' && a !== '--no-browser');
      if (!name || !host) die('remote add <name> <https://host> [--insecure-http] [--no-browser]');
      personOnly('remote-add', `open-artifact remote add ${name} ${host}${insecureHttp ? ' --insecure-http' : ''}${noBrowser ? ' --no-browser' : ''}`);
      const started = await daemonCall<{ host: string; user_code: string; verification_uri_complete: string; opened: boolean; warning?: string }>('remotes.add', {
        name,
        host,
        ...(insecureHttp ? { insecureHttp: true } : {}),
        ...(noBrowser ? { browse: false } : {}),
      });
      if (started.warning) process.stderr.write(`Warning: ${started.warning}\n`);
      process.stderr.write(
        started.opened
          ? `Opened ${started.verification_uri_complete} in your browser: check that it shows the code ${started.user_code}, then approve.\nWaiting for the approval...\n`
          : `Open ${started.verification_uri_complete} in a browser where you are signed in to the site, check that it shows the code ${started.user_code}, then approve.\nWaiting for the approval...\n`,
      );
      for (;;) {
        const result = await daemonCall<{ status: 'done' | 'pending'; user?: { name?: string; email?: string; id?: string } }>('remotes.add.wait', { name, ms: 25_000 });
        if (result.status === 'done') {
          const who = result.user?.email || result.user?.name || result.user?.id || 'you';
          return out(`Linked ${name} (${started.host}) as ${who}.`);
        }
      }
    }
    case 'list':
    case undefined: {
      const { remotes } = await daemonCall<{ remotes: RemoteStatus[] }>('remotes');
      if (!remotes.length) return out('No remotes. Add one: open-artifact remote add <name> <https://host>');
      // The default remote ends with a `default` column.
      return out(
        remotes
          .map((r) => `${r.name}\t${r.host}\t${r.signedIn ? (r.user?.email ?? r.user?.name ?? 'signed in') : 'not signed in'}\t${r.artifacts.length} published${r.default ? '\tdefault' : ''}`)
          .join('\n'),
      );
    }
    case 'status': {
      // `--json`: the daemon's answer, `{remotes: [...], cloud: {...}}`.
      const answer = await daemonCall<{ remotes: RemoteStatus[]; cloud?: CloudStatus; presetProblem?: string }>('remotes');
      return out(argv.includes('--json') ? answer : remoteStatusText(answer.remotes, answer.cloud, answer.presetProblem));
    }
    case 'default': {
      const clear = argv.includes('--clear');
      const name = argv.find((a) => a !== '--clear');
      if (!clear && !name) die('remote default <name> | --clear');
      personOnly('remote-default', `open-artifact remote default ${clear ? '--clear' : name}`);
      const { cloud } = await daemonCall<{ cloud: CloudStatus }>('cloud.settings', { default: clear ? null : name });
      if (cloud.default) return out(`The default remote is ${cloud.default}.`);
      return out(
        `No default remote: publish asks which one (--remote <name>)${cloud.publish === 'auto' ? ', and automatic publishing has nowhere to go until you choose one (open-artifact remote default <name>)' : ''}.`,
      );
    }
    case 'auto': {
      const [mode] = argv;
      if (mode !== 'on' && mode !== 'off') die('remote auto on|off');
      personOnly('remote-auto', `open-artifact remote auto ${mode}`);
      const { cloud } = await daemonCall<{ cloud: CloudStatus }>('cloud.settings', { publish: mode === 'on' ? 'auto' : 'manual' });
      if (cloud.publish === 'manual') return out('New artifacts are published only when you publish them.');
      return out(
        cloud.default
          ? `New artifacts are now published to ${cloud.default} by themselves (artifacts made before are left as they are).`
          : 'Automatic publishing is on, but there is no default remote yet: add one (open-artifact remote add) or choose one (open-artifact remote default <name>).',
      );
    }
    case 'remove': {
      const force = argv.includes('--force');
      const name = argv.find((a) => a !== '--force' && a !== '--json');
      if (!name) die('remote remove <name> [--force] [--json]');
      personOnly('remote-remove', `open-artifact remote remove ${name}${force ? ' --force' : ''}`);
      const removed = await daemonCall<{ removed: string; unlinked: string[]; autoPublishOff?: boolean; default?: string | null }>('remotes.remove', { name, force });
      return out(argv.includes('--json') ? removed : remoteRemovedText(removed));
    }
    default:
      die('remote add <name> <https://host> [--insecure-http] [--no-browser] | list | status [--json] | remove <name> [--force] [--json] | default <name>|--clear | auto on|off');
  }
}

/** Asks a question at the terminal and resolves with the answer. */
function ask(question: string): Promise<string> {
  return new Promise((done) => {
    const lines = createInterface({ input: process.stdin, output: process.stdout });
    lines.question(question, (answer) => {
      lines.close();
      done(answer);
    });
    lines.on('close', () => done(''));
  });
}

/**
 * `open-artifact publish <id|folder> [--remote <name>]`. Inside an agent session it is refused unless the person let
 * agents publish to that remote (`agent-session.ts`). A dashboard with live queries goes up without its rows unless the
 * person says yes at the terminal (the Share panel's question); an agent session never says it.
 */
async function publish(target: string | undefined): Promise<void> {
  const name = flag('remote');
  const withType = argv.includes('--with-type');
  if (!target) die('publish <artifact id | folder> [--remote <name>] [--with-type]');
  const isId = /^(open-artifact:\/\/artifact\/)?art_[0-9a-z]+$/.test(target);
  const command = `open-artifact publish ${target}${name ? ` --remote ${name}` : ''}${withType ? ' --with-type' : ''}`;
  if (AGENT) {
    // Publishing its type is never an agent's, whatever the site allows.
    if (withType) personOnly('type-publish', command);
    // Which site it would go to decides whether the person allowed it: the one named, else the default.
    const remote = name ?? (await daemonCall<{ cloud?: CloudStatus }>('remotes')).cloud?.default ?? null;
    personOnly('publish', command, remote);
  }
  // A folder that holds an artifact the daemon does not know yet is added first (adopt), and says so.
  const answer = await daemonCall<{
    url: string;
    id: string;
    view_url: string;
    remote: string;
    adopted?: { type: string; title: string; root: string };
    data?: { live: boolean; publish: boolean };
  }>('artifacts.publish', {
    ...(isId ? { id: target } : { folder: resolvePath(target), adopt: true }),
    ...(name ? { remote: name } : {}),
    ...(withType ? { withType: true } : {}),
  });
  if (answer.adopted) out(`Added ${answer.adopted.root} as ${answer.url} (${answer.adopted.type}, "${answer.adopted.title}").`);
  out(`Published to ${answer.remote}: ${answer.view_url}`);
  const choice = dataChoice({
    live: answer.data?.live === true,
    confirmed: answer.data?.publish === true,
    agent: AGENT,
    interactive: !!process.stdin.isTTY && !!process.stdout.isTTY,
  });
  if (choice === 'none') return;
  if (choice === 'ask') {
    if (saidYes(await ask(DATA_QUESTION))) {
      await daemonCall<unknown>('artifacts.data', { id: answer.id, publish: true });
      return out('Its data is published too: this computer runs its live queries and puts the rows on the site.');
    }
    return out(`Its data stays on this computer: the page there shows no figures. Publish it later from the dashboard's Share panel, or run open-artifact publish ${answer.id} again.`);
  }
  out(dataLeftOut(answer.id, choice));
}

/** `open-artifact types …`: list, make, check and manage types (`type-authoring.ts`). */
async function types(sub: string | undefined): Promise<void> {
  switch (sub ?? 'list') {
    case 'list': {
      const registry = new TypeRegistry(loadSettings);
      const workspace = flag('workspace') ?? process.cwd();
      out(
        registry.list(workspace, { includeShadowed: true }).map((t) => ({
          id: t.id,
          title: t.title,
          scope: t.scope,
          // Where it came from: shipped with Open Artifact, a folder on this computer, or installed (and from where).
          ...typeSourceOf(t),
          version: t.version,
          uid: t.uid,
          runtime: t.runtime,
          runnable: t.runnable,
          enabled: t.enabled,
          shadowedBy: t.shadowedBy,
          ...(t.scope === 'project' ? { trusted: t.trusted } : {}),
          dir: t.dir,
          problems: t.problems,
        })),
      );
      registry.close();
      return;
    }
    case 'new': {
      const scope = flag('scope');
      const template = flag('template');
      const name = flag('name');
      const [id] = argv;
      if (!id) die('types new <id> [--scope user|project] [--template page|data] [--name <name>]');
      const cwd = process.cwd();
      return out(await daemonCall<TypesNewResponse>(LIBRARY_ROUTES.typesNew, { id, scope, template, name, project: cwd, workspace: cwd }));
    }
    case 'check': {
      const workspace = flag('workspace') ?? process.cwd();
      const forShare = argv.includes('--for-share');
      const [target] = argv.filter((a) => a !== '--for-share');
      if (!target) die('types check <id|folder> [--for-share]');
      const settings = loadSettings();
      const registry = new TypeRegistry(() => settings);
      try {
        const result = checkType(typeDirOf(target, registry, workspace), { settings, registry, workspace, forShare });
        out(result);
        if (!result.ok) process.exitCode = 1;
      } catch (error) {
        die((error as Error).message);
      } finally {
        registry.close();
      }
      return;
    }
    case 'from': {
      const id = flag('id');
      const scope = flag('scope');
      const name = flag('name');
      const [target] = argv;
      if (!target || !id) die('types from <page artifact url|id | saved page folder|.html> --id <id> [--scope user|project] [--name <name>]');
      const cwd = process.cwd();
      // A path that is there is a saved page (a folder, or an .html file); anything else names a page artifact.
      const saved = !/^(art_|open-artifact:\/\/)/.test(target) && existsSync(resolvePath(target));
      const from = saved ? { path: resolvePath(target) } : { artifact: target };
      return out(await daemonCall<TypesFromResponse>(LIBRARY_ROUTES.typesFrom, { ...from, id, scope, name, project: cwd, workspace: cwd }));
    }
    case 'enable':
    case 'disable': {
      const [id] = argv;
      if (!id) die(`types ${sub} <id>`);
      personOnly(sub === 'enable' ? 'type-enable' : 'type-disable', `open-artifact types ${sub} ${id}`);
      return out(await daemonCall<TypesSettingResponse>(sub === 'enable' ? LIBRARY_ROUTES.typesEnable : LIBRARY_ROUTES.typesDisable, { id }));
    }
    case 'trust':
    case 'untrust': {
      const dir = resolvePath(argv[0] ?? process.cwd());
      personOnly(sub === 'trust' ? 'type-trust' : 'type-untrust', `open-artifact types ${sub} ${dir}`);
      return out(await daemonCall<TypesSettingResponse>(LIBRARY_ROUTES.typesTrust, { dir, trusted: sub === 'trust' }));
    }
    case 'pack': {
      const outFile = flag('out');
      const workspace = flag('workspace') ?? process.cwd();
      const [target] = argv;
      if (!target) die('types pack <id|folder> [--out <file|folder>]');
      const settings = loadSettings();
      const registry = new TypeRegistry(() => settings);
      try {
        const packed = await packType(typeDirOf(target, registry, workspace), { settings, registry, workspace, ...(outFile ? { out: outFile } : {}) });
        out({ file: packed.file, sha256: packed.sha256, bytes: packed.bytes, id: packed.id, version: packed.version, files: packed.files });
      } catch (error) {
        die(errorText(error));
      } finally {
        registry.close();
      }
      return;
    }
    case 'install':
    case 'update': {
      const as = flag('as');
      const yes = argv.includes('--yes');
      const [target] = argv.filter((a) => a !== '--yes');
      if (!target) die(sub === 'install' ? 'types install <file.oatype|https://…> [--as <id>] [--yes]' : 'types update <id> [--yes]');
      const command = sub === 'install' ? `open-artifact types install ${target}${as ? ` --as ${as}` : ''}` : `open-artifact types update ${target}`;
      personOnly(sub === 'install' ? 'type-install' : 'type-update', command);
      let preview: TypePackagePreview;
      if (sub === 'update') preview = await daemonCall<TypePackagePreview>(LIBRARY_ROUTES.typesUpdate, { id: target });
      else if (isAddress(target)) preview = await daemonCall<TypePackagePreview>(LIBRARY_ROUTES.typesPreview, { url: target, ...(as ? { as } : {}) });
      else {
        let loaded: { bytes: Uint8Array; source: string };
        try {
          loaded = await loadTypePackage(target);
        } catch (error) {
          die(errorText(error));
        }
        preview = await daemonUpload<TypePackagePreview>(LIBRARY_ROUTES.typesPreview, loaded.bytes, { name: loaded.source, ...(as ? { as } : {}) });
      }
      process.stderr.write(`${previewText(preview)}\n`);
      if (!yes) {
        if (!process.stdin.isTTY || !process.stdout.isTTY) die(`Nothing was ${sub === 'install' ? 'installed' : 'updated'}: there is no terminal to ask at. Read the above, then run ${command} --yes.`);
        if (!saidYes(await ask(`${sub === 'install' ? 'Install' : 'Update'} ${preview.name} ${preview.version} as ${preview.id}? [y/N] `))) return out('Nothing was changed.');
      }
      const done = await daemonCall<object>(sub === 'install' ? LIBRARY_ROUTES.typesInstall : LIBRARY_ROUTES.typesUpdate, { sha256: preview.sha256, ...(sub === 'install' ? (as ? { as } : {}) : { id: target }) });
      return out(done);
    }
    case 'publish':
    case 'unpublish': {
      const remote = flag('remote');
      const visibility = sub === 'publish' ? flag('visibility') : undefined;
      const [id] = argv;
      if (!id) die(sub === 'publish' ? 'types publish <id> [--remote <site>] [--visibility private|site|link]' : 'types unpublish <id> [--remote <site>]');
      if (visibility !== undefined && visibility !== null && !['private', 'site', 'link'].includes(visibility)) die('--visibility is private, site or link.');
      const command = `open-artifact types ${sub} ${id}${remote ? ` --remote ${remote}` : ''}${visibility ? ` --visibility ${visibility}` : ''}`;
      personOnly(sub === 'publish' ? 'type-publish' : 'type-unpublish', command);
      if (sub === 'unpublish') return out(await daemonCall<TypesUnpublishResponse>(LIBRARY_ROUTES.typesUnpublish, { id, ...(remote ? { remote } : {}) }));
      const done = await daemonCall<TypesPublishResponse>(LIBRARY_ROUTES.typesPublish, { id, workspace: flag('workspace') ?? process.cwd(), ...(remote ? { remote } : {}), ...(visibility ? { visibility } : {}) });
      process.stderr.write(`${done.change === 'unchanged' ? 'Already on' : done.change === 'new' ? 'Published to' : `Published version ${done.type.version} (was ${done.previous}) to`} ${done.remote} (${done.host}): ${done.type.id} ${done.type.version}, visibility ${done.type.visibility}.\n`);
      return out(done);
    }
    case 'uninstall': {
      const [id] = argv;
      if (!id) die('types uninstall <id>');
      personOnly('type-uninstall', `open-artifact types uninstall ${id}`);
      return out(await daemonCall<object>(LIBRARY_ROUTES.typesUninstall, { id }));
    }
    default:
      die('types [list] | new <id> | check <id|folder> [--for-share] | from <page> --id <id> | enable <id> | disable <id> | trust [<dir>] | untrust [<dir>] | pack <id|folder> [--out <file>] | install <file|https://…> [--as <id>] [--yes] | update <id> [--yes] | uninstall <id> | publish <id> [--remote <site>] [--visibility private|site|link] | unpublish <id> [--remote <site>]');
  }
}

/** `open-artifact harness …`: the harness profiles in `<home>/harnesses/`. */
function harnessCommand(sub: string | undefined): void {
  switch (sub) {
    case 'add': {
      const [file] = argv;
      if (!file) die('harness add <profile.json>');
      // Standing configuration, which may carry a command the daemon runs (`nudge`): the person's to add.
      personOnly('harness-add', `open-artifact harness add ${resolvePath(file)}`);
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(resolvePath(file), 'utf8'));
      } catch (error) {
        die(`harness add: cannot read ${file} as JSON (${(error as Error).message})`);
      }
      const added = addUserProfile(raw);
      const replaced = added.replaced === 'adapter' ? ' (in place of the one its adapter reported)' : added.replaced === 'user' ? ' (in place of your earlier one)' : '';
      return out(`Added the profile of ${added.name}: ${added.file}${replaced}`);
    }
    case 'list': {
      const json = argv.includes('--json');
      const list = listProfiles();
      if (json) return out(list);
      if (!list.length) return out('No harness profiles.');
      const width = Math.max(...list.map((p) => p.name.length));
      return out(list.map((p) => `${p.name.padEnd(width)}  ${p.source.padEnd(7)}  ${p.title}${p.source !== 'shipped' ? `  ${p.file}` : ''}`).join('\n'));
    }
    case 'remove': {
      const [name] = argv;
      if (!name) die('harness remove <name>');
      personOnly('harness-remove', `open-artifact harness remove ${name}`);
      const removed = removeProfile(name);
      return out(`Removed ${removed.file}${harnessProfile(name).source === 'shipped' ? '; the shipped profile is in effect again' : ''}.`);
    }
    default:
      die('harness add <profile.json> | list [--json] | remove <name>');
  }
}

async function main(): Promise<void> {
  const [command, sub] = argv.splice(0, 2);
  switch (command) {
    case 'daemon':
      return daemon(sub);
    case 'mcp':
      if (sub) argv.unshift(sub);
      return mcpBridge();
    case 'types':
      // `types --workspace <dir>` lists, as `types list` does.
      if (sub?.startsWith('--')) {
        argv.unshift(sub);
        return types('list');
      }
      return types(sub);
    case 'artifact':
      return tool('Artifact', sub);
    case 'data':
      return tool('ArtifactData', sub);
    case 'comments':
      return tool('ArtifactComments', sub);
    case 'open':
      if (!sub) die('open <open-artifact://artifact/… | art_…>');
      return tool('Artifact', JSON.stringify({ action: 'open', url: sub }));
    case 'wait': {
      if (sub) argv.unshift(sub);
      const timeout = Number(flag('timeout', '600000'));
      return tool('ArtifactComments', JSON.stringify({ action: 'wait', timeout_ms: timeout }));
    }
    case 'hook':
      return hook(sub);
    case 'watch':
      if (sub) argv.unshift(sub);
      return watch();
    case 'chatgpt':
      if (sub) argv.unshift(sub);
      return chatgpt();
    case 'home':
      return out(openArtifactHome());
    case 'skill':
      return out(
        skillCommand(sub, (name) => flag(name), (name) => {
          const i = argv.indexOf(`--${name}`);
          if (i >= 0) argv.splice(i, 1);
          return i >= 0;
        }),
      );
    case 'harness':
      if (sub === '--stdio' || argv.includes('--stdio')) {
        if (sub && sub !== '--stdio') argv.unshift(sub);
        argv.splice(argv.indexOf('--stdio'), argv.includes('--stdio') ? 1 : 0);
        const name = flag('harness');
        if (!name) die('harness --stdio --harness <name>');
        return runStdioBridge({ harness: name, input: process.stdin, output: process.stdout, log: (line) => void process.stderr.write(`${line}\n`) }).then(() => process.exit(0));
      }
      return harnessCommand(sub);
    case 'runtime':
      // An error prints its fix line too.
      return runtimeCommand(sub, { args: argv, out, personOnly: (act, command) => personOnly(act, command) }).catch((error: unknown) => {
        const { message, fix } = error as { message?: string; fix?: string };
        die(`${message ?? String(error)}${fix ? `\n  ${fix}` : ''}`);
      });
    case 'doctor': {
      if (sub) argv.unshift(sub);
      const json = argv.includes('--json');
      const report = await runDoctor({ checks: DOCTOR_CHECKS, harness: flag('harness') ?? null, session: flag('session') ?? null });
      out(json ? report : doctorText(report));
      if (!report.ok) process.exitCode = 1;
      return;
    }
    case 'remote':
      return remote(sub);
    case 'publish':
      return publish(sub);
    case 'import':
      return importCommand(sub);
    case 'unpublish': {
      if (!sub) die('unpublish <artifact id>');
      if (AGENT) {
        // The site it is on decides whether the person allowed it.
        const record = await api<{ remote?: { name?: string } | null }>(await ensureDaemon(), 'artifact', undefined, { query: { id: sub } }).catch(() => null);
        personOnly('unpublish', `open-artifact unpublish ${sub}`, record?.remote?.name ?? null);
      }
      const answer = await daemonCall<{ url: string; view_url: string }>('artifacts.unpublish', { id: sub });
      return out(`Unpublished ${answer.url}; it opens at ${answer.view_url} again.`);
    }
    case '--version':
    case '-v':
      return out(pkg.version);
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      return out(USAGE);
    default:
      die(`unknown command ${command}; open-artifact help`);
  }
}

main().catch((error: unknown) => die((error as Error)?.message ?? String(error)));
