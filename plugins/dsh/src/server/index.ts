/**
 * dsh-open-artifact: the DeepSeek Harness (DSH) adapter of Open Artifact, a level-3 harness integration built on
 * `@open-artifact/harness-kit` (bundled into lib/index.js: DSH installs no dependencies).
 *
 * - Connection: `createHarness` finds or starts the daemon, reconnects, attaches the sessions again after a reconnect
 *   and hands what waited in a session's inbox to the `wake` callback. `hello` declares the runtime this plugin carries
 *   (vendor.ts), so an older daemon running on this computer is replaced by it.
 * - Tools: `Artifact`, `ArtifactData` and `ArtifactComments`, registered in `ctx.tools` from the kit's definitions, and
 *   again from the daemon's once connected when they differ and DSH handed back a way to remove the first ones. Each
 *   call goes to the daemon with the calling session as the caller: `{ session: <agent id>, workspace: <its folder> }`.
 * - Wake: the daemon calls `wake.deliver` when someone sends a comment or a request from an artifact's page, or a task
 *   ends. The owner's words reach the session's agent as wake.ts describes (they may end its question to the person);
 *   a collaborator's message or a task's result goes in as a notice that leaves those questions alone. A session with
 *   no live agent is resumed through the session controller when the host has one; when nothing can take it the answer
 *   is `failed` and the daemon keeps the message in the session's inbox, which its next attach hands over.
 * - Open: the daemon calls `host.open` when the agent opens an artifact (or its share or export panel); the browser
 *   half shows the Shell's `embed_url` in the session's Browser in the right sidebar and answers the Shell through the
 *   host routes (host-open.ts). What the Shell says (`shell.event`) goes to the browser halves on the same stream.
 * - Status: an attached session's agent going `running` and back to `idle` is passed on, so an artifact's Shell shows
 *   the agent working only while it is.
 * - System prompt: one short section saying the tools exist.
 * - Skill: `/open-artifact <type> …` makes an artifact of that type (skill.ts), rendered by the daemon for DSH.
 * - Routes: the Open Artifact page's (routes.ts), with its update check (updates.ts) and release notes (changelog.ts).
 *   The page itself is the browser half (`lib/client.js`, from src/client).
 *
 * Not wired, for want of a DSH API: cards of the artifacts a turn made (`on('artifact')`; DSH has no place to attach
 * them to a message), the person's selection on the page as context (`context`; no hook before a message is sent) and
 * `agent.wrote` (no event carries the paths DSH's own file tools wrote).
 */
import { createHarness, localSkill, renderSkill, type Harness, type HarnessOptions } from '@open-artifact/harness-kit';
import { AGENT_PROMPT, TOOL_DEFINITIONS, WAKE_SOURCE_KIND, type ToolDefinition, type ToolInputSchema, type WakeDeliverParams } from '@open-artifact/protocol';
import {
  service,
  type DshAgent,
  type DshAgents,
  type DshContentPart,
  type DshContext,
  type DshSkillsContext,
  type DshParameter,
  type DshParameters,
  type DshSessionController,
  type DshSessions,
  type DshSystemPrompt,
  type DshToolExecution,
  type DshUserQuestions,
  type DshWorkingDirectory,
} from './dsh.ts';
import { changelogReader } from './changelog.ts';
import { HostOpens } from './host-open.ts';
import { HARNESS, libraryApi, registerRoutes } from './routes.ts';
import { updateChecker, type PluginManager } from './updates.ts';
import { skillProvider, SKILL_NAME, SKILL_RENDER } from './skill.ts';
import { daemonOptions, PACKAGE_NAME, packageRoot, runtimeOf } from './vendor.ts';
import { deliverNotice, deliverWake, fromOwner, QuestionTracker, timedWaits, wakeMessage } from './wake.ts';

export { wakeMessage } from './wake.ts';

/** Cordis plugin identity. */
export const name = 'open-artifact';

/** Services the plugin needs before it applies. `workingDirectory`: the session's folder, as the built-in tools get it. */
export const inject = ['tools', 'workingDirectory'];

/** The source kind of a wake message: the structured copy of the event the browser half draws a card for. */
export const SOURCE_KIND = WAKE_SOURCE_KIND;

/** The plugin's config (`cordis.patch.yml`). */
export interface Config {
  /** What the Shell calls the agent. Default `Agent`. */
  agentName?: string;
  /** Start the daemon when none runs. Default true. */
  autoStart?: boolean;
  /**
   * The `open-artifact.mjs` to start, skipping the runtime choice (default: the newest compatible runtime on this
   * computer, the vendored one among them).
   */
  daemonBin?: string;
  /** The folder new artifacts go to when a session has none. */
  workspace?: string;
}

/** What {@link setup} can be given instead of the real thing, for tests. */
export interface SetupDeps {
  /** Overrides of the harness options (a test's `home`, `autoStart: false`, a short `reconnect`). */
  harness?: Partial<HarnessOptions>;
  /** Registers the page's routes. */
  registerRoutes?: typeof registerRoutes;
  /** The `host.open` channel to the browser halves. */
  hostOpens?: HostOpens;
}

/** What {@link setup} returns. */
export interface Plugin {
  /** The connection, once made (a new one after the plugin was turned off and on). */
  harness(): Promise<Harness>;
  hostOpens: HostOpens;
}

/**
 * DSH's tool parameter schemas are a subset of JSON Schema: free-form objects and arrays become untyped values, which
 * accept anything, with their description kept.
 */
export function dshParameters(schema: ToolInputSchema): DshParameters {
  const properties: Record<string, DshParameter> = {};
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    const description = prop.description ? { description: prop.description } : {};
    if (prop.type === 'object' || prop.type === 'array') {
      properties[key] = description;
      continue;
    }
    properties[key] = {
      ...(prop.type ? { type: prop.type } : {}),
      ...description,
      ...(prop.enum ? { enum: [...prop.enum] } : {}),
    };
  }
  return { type: 'object', properties, ...(schema.required?.length ? { required: [...schema.required] } : {}) };
}

/** A tool's result as DSH shows it: the text, or the JSON. */
export function renderResult(_args: unknown, value: unknown): DshContentPart[] {
  return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }];
}

/** An error a tool call throws for the daemon's `{ error }` answer, with its code. */
export class ToolError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'ToolError';
    this.code = code;
  }
}

/** What a tool registration depends on: two definitions with the same key register the same DSH tool. */
const toolKey = (tool: ToolDefinition): string => JSON.stringify([tool.description, dshParameters(tool.inputSchema)]);

/** Applies the plugin: the Cordis entry point. */
export function apply(ctx: DshContext, config: Config = {}): Plugin {
  return setup(ctx, config);
}

/** {@link apply}, with what it builds on replaceable. */
export function setup(ctx: DshContext, config: Config = {}, deps: SetupDeps = {}): Plugin {
  const log = (level: 'warn' | 'info', message: string) => ctx.logger?.[level]?.(`open-artifact: ${message}`);
  const agentName = config.agentName ?? 'Agent';
  const hostOpens = deps.hostOpens ?? new HostOpens();

  /**
   * The session's working folder, where the daemon puts new artifacts: what the built-in tools use, else the session
   * record, else `config.workspace`. Never the process's own folder, which in the desktop app is the profile's.
   */
  const cwdOf = async (exec: DshToolExecution | undefined): Promise<string | null> => {
    const wd = service<DshWorkingDirectory>(ctx, 'workingDirectory');
    if (exec?.agent && typeof wd?.ensure === 'function') {
      try {
        const dir = await wd.ensure(exec.agent, exec.signal);
        if (typeof dir === 'string' && dir) return dir;
      } catch (error) {
        log('warn', `no working folder for ${exec.agent.id}: ${(error as Error).message}`);
      }
    }
    const session = exec?.agent?.id;
    const record = session ? service<DshSessions>(ctx, 'sessions')?.get?.(session) : undefined;
    return record?.meta?.cwd ?? record?.cwd ?? config.workspace ?? null;
  };

  /** The session's live agent, or the one the session controller resumes. */
  const agentOf = async (session: string | null): Promise<DshAgent | undefined> => {
    if (!session) return undefined;
    const live = service<DshAgents>(ctx, 'agents')?.get?.(session);
    if (live) return live;
    const controller = service<DshSessionController>(ctx, 'sessionController');
    return typeof controller?.resolveAgent === 'function' ? await controller.resolveAgent(session) : undefined;
  };

  const questions = new QuestionTracker();
  const waitsOf = (agent: DshAgent) => {
    try {
      return timedWaits(service<DshUserQuestions>(ctx, 'userQuestions')?.waits?.get(agent));
    } catch {
      return [];
    }
  };

  /** Whether the agent is asking the person something, and how its timed questions end early, for deliverWake. */
  const waitingOf = (agent: DshAgent) => ({
    asking: questions.asking(agent.session) || waitsOf(agent).length > 0,
    endTimedWaits: () => {
      const waits = waitsOf(agent);
      for (const wait of waits) wait.close(wait.timeout);
      return waits.length > 0;
    },
  });

  // ---- the connection ----

  /** The harness while the plugin is on. */
  let current: Promise<Harness> | null = null;
  /** session id → the workspaces it is attached with. */
  const attached = new Map<string, Set<string | null>>();
  /** `session|workspace` keys attached now (the kit attaches them again after a reconnect). */
  const attachedKeys = new Set<string>();

  /** Hands one wake to the session's agent: the owner's words as wake.ts says, anyone else's as a notice. */
  const onWake = async (params: WakeDeliverParams) => {
    const agent = await agentOf(params.session);
    if (!agent) {
      log('warn', `a message for ${params.session ?? 'no session'} has no agent to go to; the daemon keeps it`);
      return 'failed' as const;
    }
    const message = wakeMessage(params);
    // Woken, the session works again: attached, the Shell shows it live and working until it is idle.
    if (params.session) {
      const session = params.session;
      queueMicrotask(() => void track(session, params.workspace ?? null, 'running').catch((e: Error) => log('warn', `session.attach: ${e.message}`)));
    }
    return fromOwner(params.source) ? deliverWake(agent, message, waitingOf(agent)) : deliverNotice(agent, message);
  };

  const connect = (): Promise<Harness> => {
    const made = createHarness({
      harness: HARNESS,
      agentName,
      commands: [SKILL_NAME],
      caps: { wake: { resume: true }, tools: 'native', library: 'own' },
      // Pages open in the session's Browser tab, a top-level view: the Shell talks to the daemon, never to a parent frame.
      // That tab is a general-purpose browser that goes anywhere the person or the agent sends it, with no allowlist of
      // ours to widen, so a remote type's page (from another computer) is shown like any other: `allow`, as before the
      // kit, when such pages opened in the same tab. `ask` would need an `allowRemote` dialog DSH has no API for.
      embed: { origins: [], mode: 'view', remote: 'allow' },
      runtime: runtimeOf(),
      daemon: daemonOptions(config),
      autoStart: config.autoStart !== false,
      log: (line) => log('warn', line),
      wake: onWake,
      open: (request) => hostOpens.open(request.session, request.embedUrl, request.title ?? '', { ...(request.view ? { view: request.view } : {}), agentName }),
      ...deps.harness,
    });
    made.then(
      (harness) => {
        harness.on('shell', (event) => hostOpens.shell(event));
        harness.on('state', (state) => state === 'connected' && void syncTools(harness));
        void syncTools(harness);
      },
      (error: Error) => log('warn', `the daemon connection: ${error.message}`),
    );
    return made;
  };
  const harness = (): Promise<Harness> => (current ??= connect());

  /**
   * Attaches the session (once per workspace) with its agent's status; `agent/status` keeps that current. A session is
   * attached by its first tool call, or by a wake that reaches it after the app restarted. What waited in its inbox
   * goes to {@link onWake} on the way (the kit hands it over).
   */
  const track = async (session: string, workspace: string | null, status: string | undefined): Promise<void> => {
    const key = `${session}|${workspace ?? ''}`;
    if (attachedKeys.has(key)) return;
    attachedKeys.add(key);
    const workspaces = attached.get(session) ?? new Set<string | null>();
    workspaces.add(workspace);
    attached.set(session, workspaces);
    try {
      const { inbox } = await (await harness()).attach({ session, workspace, status: status === 'idle' ? 'idle' : 'running' });
      if (inbox.length) log('warn', `${inbox.length} inbox message(s) for ${session} could not be handed to its agent; the next attach returns them`);
    } catch (error) {
      attachedKeys.delete(key);
      throw error;
    }
  };

  if (typeof ctx.on === 'function') {
    ctx.on('session/event', (session, event) => questions.observe(session, event), { global: true });
    ctx.on(
      'agent/status',
      ({ agent, status } = {}) => {
        const workspaces = agent?.id ? attached.get(agent.id) : undefined;
        if (!agent?.id || !workspaces || (status !== 'idle' && status !== 'running')) return;
        for (const workspace of workspaces) {
          void harness()
            .then((h) => h.status({ session: agent.id!, workspace }, status))
            .catch((e: Error) => log('warn', `session.status: ${e.message}`));
        }
      },
      { global: true },
    );
  }

  // ---- tools ----

  const call = async (tool: string, args: Record<string, unknown> | undefined, exec: DshToolExecution | undefined) => {
    const session = exec?.agent?.id ?? null;
    const caller = { session, workspace: await cwdOf(exec) };
    if (session) await track(session, caller.workspace, exec?.agent?.status);
    const out = await (await harness()).call(tool, args ?? {}, caller);
    if (out && typeof out.error === 'object' && out.error) {
      throw new ToolError([out.error.message, out.error.fix].filter(Boolean).join(' '), out.error.code);
    }
    return out;
  };

  /** The tools registered now, by name: the definition's key and how DSH removes it (when it said). */
  const registered = new Map<string, { key: string; remove: (() => void) | null }>();
  const register = (tool: ToolDefinition): void => {
    const remove = ctx.tools.register({
      name: tool.name,
      description: tool.description,
      parameters: dshParameters(tool.inputSchema),
      output: { schema: {}, render: renderResult },
      execute: (args, exec) => call(tool.name, args, exec),
    });
    registered.set(tool.name, { key: toolKey(tool), remove: typeof remove === 'function' ? (remove as () => void) : null });
  };
  // The kit's definitions now, so the tools are there before the daemon is.
  for (const tool of TOOL_DEFINITIONS) register(tool);

  /**
   * The daemon's definitions, once connected: a tool whose description or parameters changed is registered again, a
   * new one is added and one the daemon dropped is removed, when DSH's `register` returned a way to remove a tool.
   * Without one the first definitions stay (their calls still reach the daemon, which checks the arguments).
   */
  let synced: Promise<void> = Promise.resolve();
  const syncTools = (h: Harness): Promise<void> =>
    (synced = synced.then(async () => {
      if (!h.connected) return;
      const tools = await h.tools();
      const names = new Set<string>(tools.map((t) => t.name));
      for (const tool of tools) {
        const had = registered.get(tool.name);
        if (had?.key === toolKey(tool)) continue;
        if (had && !had.remove) {
          log('info', `the daemon describes ${tool.name} differently; DSH cannot replace a tool, so the first description stays`);
          continue;
        }
        had?.remove?.();
        register(tool);
      }
      for (const [name, had] of registered) {
        if (names.has(name) || !had.remove) continue;
        had.remove();
        registered.delete(name);
      }
    }).catch((error: Error) => log('warn', `tools.list: ${error.message}`)));

  const prompt = service<DshSystemPrompt>(ctx, 'systemPrompt');
  if (typeof prompt?.section === 'function') prompt.section({ name: 'open-artifact', order: 900, text: AGENT_PROMPT, interpolate: false });

  // ---- the page, its routes and the skill ----

  // The Library API of the daemon the harness reached (or starts).
  const library = libraryApi({
    daemon: async () => {
      const h = await harness();
      await h.ready();
      const state = h.client.state;
      if (!state) throw new Error('The open-artifact daemon is not reachable.');
      return state;
    },
  });

  // Whether a newer release is out, for the page to offer (src/client/updates.tsx installs it).
  const updates = updateChecker([PACKAGE_NAME], () => service<PluginManager>(ctx, 'pluginManager'));
  // What this release and the offered one bring, for the page's "What's new" and its changelog.
  const changelog = changelogReader({ name: PACKAGE_NAME, root: packageRoot(), updates });

  // The page's routes, in a context of their own that goes with the app's route registry (the `connection` service).
  const routes = deps.registerRoutes ?? registerRoutes;
  ctx.inject?.(['connection'], (sub) => {
    try {
      routes(
        { register: (route) => sub.connection.fetch.register(route) },
        { library, hostOpens, updates, changelog, shellCommand: async (view, command) => (await harness()).shellCommand(view, command) },
      );
    } catch (error) {
      log('warn', `the Open Artifact page's routes: ${(error as Error).message}`);
    }
  });

  // `/open-artifact <type> …`, in the app's skill registry when it has one: the daemon's rendering for DSH, else the kit's.
  const skillParams = { ...SKILL_RENDER, agentName };
  ctx.inject?.<DshSkillsContext>(['skills'], (sub) => {
    try {
      sub.skills.registerProvider(() =>
        skillProvider({
          packageRoot: packageRoot(),
          description: localSkill(skillParams).description,
          render: async () => {
            const h = await harness();
            await h.ready().catch(() => undefined);
            return (await renderSkill(h.client, skillParams)).skill;
          },
        }),
      );
    } catch (error) {
      log('warn', `the /open-artifact skill: ${(error as Error).message}`);
    }
  });

  ctx.effect(() => {
    void harness().catch(() => undefined);
    return () => {
      const closing = current;
      current = null;
      attachedKeys.clear();
      attached.clear();
      void closing?.then((h) => h.close(), () => undefined);
    };
  }, 'open-artifact: the daemon connection');

  return { harness, hostOpens };
}
