/**
 * The server half against a fake DSH context and the kit's fake daemon (`@open-artifact/harness-kit/testing`): tool
 * parameter schemas, tool calls, session attach and status, the wake message and where `wake.deliver` puts it by who
 * sent it, the inbox an attach hands over, `host.open` with its view and the Shell's messages, the tools the daemon
 * describes, and the skill.
 */
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { startFakeDaemon, type FakeDaemon, type FakeDaemonOptions } from '@open-artifact/harness-kit/testing';
import { AGENT_PROMPT, TOOL_DEFINITIONS, TOOL_SCHEMAS, WAKE_SOURCE_KIND, type ToolInputSchema, type WakeDeliverParams, type WakeSource } from '@open-artifact/protocol';
import type { DshAgent, DshContext, DshEvents, DshQuestionWait, DshRoute, DshSkillProvider, DshToolDefinition, DshUserMessage } from '../src/server/dsh.ts';
import { HostOpens } from '../src/server/host-open.ts';
import { dshParameters, setup, ToolError, wakeMessage, type Plugin } from '../src/server/index.ts';
import { packageRoot } from '../src/server/vendor.ts';
import { PATHS, type HostOpenRequest } from '../src/shared/routes.ts';

// ---------------------------------------------------------------- fakes

/** A DSH agent that records what it is handed. */
function fakeAgent(id: string, status: string, withCancel = true) {
  const got = { followup: [] as DshUserMessage[], inject: [] as DshUserMessage[], cancel: [] as unknown[] };
  const agent: DshAgent = {
    id,
    status,
    session: {},
    followup: (m) => void got.followup.push(m),
    inject: (m) => void got.inject.push(m),
    ...(withCancel ? { cancel: (cause: unknown, options: unknown) => void got.cancel.push([cause, options]) } : {}),
  } as DshAgent;
  return { agent, got };
}

interface FakeHost {
  agents?: Map<string, DshAgent>;
  resolveAgent?: (id: string) => DshAgent | undefined;
  waits?: Map<DshAgent, Map<string, DshQuestionWait>>;
  cwd?: string;
  /** What `ctx.tools.register` returns: a remover, or nothing (DSH's own says nothing about one). */
  removable?: boolean;
}

/** A DSH context with the services the plugin reads. */
function fakeContext(host: FakeHost = {}) {
  const tools = new Map<string, DshToolDefinition>();
  const registrations: string[] = [];
  const routes: DshRoute[] = [];
  const skills: DshSkillProvider[] = [];
  const sections: unknown[] = [];
  const listeners: { [K in keyof DshEvents]?: DshEvents[K][] } = {};
  const disposers: Array<() => void> = [];
  const services: Record<string, unknown> = {
    agents: { get: (id: string) => host.agents?.get(id) },
    sessionController: host.resolveAgent ? { resolveAgent: host.resolveAgent } : undefined,
    userQuestions: { waits: { get: (agent: DshAgent) => host.waits?.get(agent) } },
    workingDirectory: { ensure: async () => host.cwd ?? '/work' },
    systemPrompt: { section: (s: unknown) => sections.push(s) },
  };
  const ctx: DshContext = {
    tools: {
      register: (tool) => {
        tools.set(tool.name, tool);
        registrations.push(tool.name);
        return host.removable ? () => tools.get(tool.name) === tool && tools.delete(tool.name) : undefined;
      },
    },
    get: (name) => services[name],
    on: (name, listener) => {
      (listeners[name] ??= [] as never[]).push(listener as never);
      return () => {};
    },
    inject: (deps, callback) =>
      callback(
        (deps.includes('skills')
          ? { skills: { registerProvider: (provider: () => DshSkillProvider) => skills.push(provider()) } }
          : { connection: { fetch: { register: (route: DshRoute) => routes.push(route) } } }) as never,
      ),
    effect: (execute) => void disposers.push(execute()),
    logger: { warn: () => {}, info: () => {} },
  };
  const emit = <K extends keyof DshEvents>(name: K, ...args: Parameters<DshEvents[K]>) => {
    for (const listener of listeners[name] ?? []) (listener as (...a: unknown[]) => void)(...args);
  };
  return { ctx, tools, registrations, routes, skills, sections, emit, dispose: () => disposers.forEach((d) => d()) };
}

const source = (over: Partial<WakeSource> = {}): WakeSource => ({
  kind: WAKE_SOURCE_KIND,
  artifactId: 'a1',
  url: 'open-artifact://artifact/a1',
  title: 'Landing page',
  root: '/work/landing',
  viewUrl: 'http://127.0.0.1:4100/a/a1/',
  threads: [{ id: 't1', where: 'Hero', text: 'Bigger, please' }],
  requests: [],
  summary: 'A comment on Landing page',
  reason: 'comment',
  from: { kind: 'owner' },
  ...over,
});

const wake = (session: string | null, over: Partial<WakeSource> = {}): Partial<WakeDeliverParams> & { text: string } => ({
  session,
  workspace: '/work',
  artifact: 'open-artifact://artifact/a1',
  artifactId: 'a1',
  text: '[Open Artifact]\nA comment on Landing page: Bigger, please',
  source: source(over),
});

const COLLABORATOR = { from: { kind: 'collaborator', name: 'Ana', role: 'commenter' } } as const;

/** Waits until `check` holds. */
async function until(check: () => unknown, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((done) => setTimeout(done, 10));
  }
}

const daemons: FakeDaemon[] = [];
const plugins: Array<() => void> = [];
afterEach(async () => {
  for (const stop of plugins.splice(0)) stop();
  for (const fake of daemons.splice(0)) await fake.close();
});

/** The plugin set up in a fake context against a fake daemon, connected. */
async function started(host: FakeHost = {}, daemon: FakeDaemonOptions = {}, extra: { hostOpens?: HostOpens } = {}) {
  const fake = await startFakeDaemon(daemon);
  daemons.push(fake);
  const context = fakeContext(host);
  const plugin: Plugin = setup(context.ctx, {}, { harness: { home: fake.home, autoStart: false, reconnect: { minMs: 20, maxMs: 50 } }, ...extra });
  plugins.push(context.dispose);
  const harness = await plugin.harness();
  return { fake, plugin, harness, ...context };
}

// ---------------------------------------------------------------- tests

describe('dshParameters', () => {
  it('keeps primitive properties and loosens objects and arrays to described, untyped values', () => {
    const schema: ToolInputSchema = {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'What to do', enum: ['a', 'b'] },
        count: { type: 'integer' },
        args: { type: 'object', description: 'Anything' },
        files: { type: 'array', description: 'Paths', items: { type: 'string' } },
      },
      required: ['action'],
    } as ToolInputSchema;
    assert.deepEqual(dshParameters(schema), {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'What to do', enum: ['a', 'b'] },
        count: { type: 'integer' },
        args: { description: 'Anything' },
        files: { description: 'Paths' },
      },
      required: ['action'],
    });
  });

  it('turns every protocol tool schema into one DSH takes', () => {
    for (const [tool, schema] of Object.entries(TOOL_SCHEMAS)) {
      const out = dshParameters(schema);
      assert.equal(out.type, 'object', tool);
      assert.deepEqual(Object.keys(out.properties), Object.keys(schema.properties), tool);
      for (const prop of Object.values(out.properties)) {
        assert.ok(prop.type === undefined || ['string', 'number', 'integer', 'boolean'].includes(prop.type), tool);
      }
      if (schema.required?.length) assert.deepEqual(out.required, [...schema.required]);
      else assert.equal(out.required, undefined);
    }
  });
});

describe('wakeMessage', () => {
  it('is a frozen user message whose source is the structured copy, marked as a notice', () => {
    const message = wakeMessage({ text: 'hello', source: source() });
    assert.equal(message.role, 'user');
    assert.deepEqual(message.content, [{ type: 'text', text: 'hello' }]);
    assert.equal(message.source.kind, WAKE_SOURCE_KIND);
    assert.equal(message.source.form, 'notice');
    assert.equal(message.source.summary, 'A comment on Landing page');
    assert.equal((message.source as Record<string, unknown>).artifactId, 'a1');
    assert.ok(Object.isFrozen(message) && Object.isFrozen(message.source) && Object.isFrozen(message.content));
    assert.notEqual(wakeMessage({ text: 'x' }).id, message.id);
  });

  it('summarises by the first line that is not a bracketed header when the source has no summary', () => {
    const message = wakeMessage({ text: '[Open Artifact]\n\nPlease fix the header\nmore', source: null });
    assert.equal(message.source.summary, 'Please fix the header');
    assert.equal(message.source.kind, WAKE_SOURCE_KIND);
  });
});

describe('setup', () => {
  it('registers the three tools, the prompt section and the page routes, and says hello with what the plugin does', async () => {
    const { fake, tools, routes, skills, sections, dispose } = await started();
    assert.deepEqual(skills.map((s) => s.name), ['dsh-open-artifact']);
    assert.ok(routes.some((r) => r.path === PATHS.hostOpens));
    assert.ok(routes.some((r) => r.path === PATHS.shellCommand));
    assert.deepEqual([...tools.keys()].sort(), Object.keys(TOOL_SCHEMAS).sort());
    assert.deepEqual(sections, [{ name: 'open-artifact', order: 900, text: AGENT_PROMPT, interpolate: false }]);
    assert.ok(routes.length > 0 && routes.every((r) => r.path.startsWith('/api/open-artifact.artifacts')));
    const hello = fake.hellos[0]!;
    assert.equal(hello.harness, 'dsh');
    const { open, ...caps } = hello.caps as Record<string, unknown> & { open: { embed: string; origins: string[]; remote?: string } };
    assert.deepEqual(caps, { wake: { resume: true }, tools: 'native', library: 'own', agentName: 'Agent', commands: { names: ['open-artifact'] } });
    // Top-level views (the sidebar's Browser tab), with no frame origin of its own to declare.
    assert.equal(open.embed, 'view');
    assert.deepEqual(open.origins, []);
    // The Browser tab is a general-purpose browser: a remote type's page is shown like any other.
    assert.equal(open.remote, 'allow');
    assert.equal(hello.kit?.name, '@open-artifact/harness-kit');
    // The runtime is the plugin folder itself (scripts/open-artifact.mjs beside vendor/), which the daemon can record.
    assert.equal(hello.runtime?.dir, packageRoot());
    assert.equal(hello.runtime?.update, 'bundled');
    assert.ok(hello.runtime?.version);
    dispose();
    await until(() => !fake.connected);
  });

  it('calls a tool as the session, attaching the session once with its folder', async () => {
    const answers: unknown[] = [];
    const { fake, tools } = await started({ cwd: '/work/s1' }, { onToolCall: (name, args) => (answers.push([name, args]), { content: [{ type: 'text', text: 'done' }] }) });
    const exec = { agent: { id: 's1', status: 'running' } };
    const out = await tools.get('Artifact')!.execute({ action: 'list' }, exec);
    await tools.get('ArtifactData')!.execute(undefined, exec);
    assert.deepEqual(out, { content: [{ type: 'text', text: 'done' }] });
    assert.deepEqual(answers, [['Artifact', { action: 'list' }], ['ArtifactData', {}]]);
    const attaches = fake.calls.filter((c) => c.method === 'session.attach').map((c) => c.params);
    assert.deepEqual(attaches, [{ session: 's1', workspace: '/work/s1', status: 'running' }]);
    const calls = fake.calls.filter((c) => c.method === 'tools.call').map((c) => (c.params as { caller: unknown }).caller);
    assert.deepEqual(calls, [{ session: 's1', workspace: '/work/s1' }, { session: 's1', workspace: '/work/s1' }]);
  });

  it("throws the daemon's error with its fix and code", async () => {
    const { tools } = await started({}, { onToolCall: () => ({ error: { code: 'not_found', message: 'No such artifact.', fix: 'List them first.' } }) as never });
    await assert.rejects(tools.get('Artifact')!.execute({ action: 'read' }, { agent: { id: 's1' } }), (error: unknown) => {
      assert.ok(error instanceof ToolError);
      assert.equal(error.code, 'not_found');
      assert.equal(error.message, 'No such artifact. List them first.');
      return true;
    });
  });

  it("passes an attached session's agent status on, and nobody else's", async () => {
    const { fake, tools, emit } = await started();
    const statuses = () => fake.calls.filter((c) => c.method === 'session.status').map((c) => c.params);
    emit('agent/status', { agent: { id: 's1' }, status: 'idle' });
    await tools.get('Artifact')!.execute({}, { agent: { id: 's1', status: 'running' } });
    emit('agent/status', { agent: { id: 's1' }, status: 'idle' });
    emit('agent/status', { agent: { id: 's1' }, status: 'thinking' });
    emit('agent/status', { agent: { id: 's2' }, status: 'idle' });
    await fake.waitFor('session.status');
    await new Promise((done) => setTimeout(done, 30));
    assert.deepEqual(statuses(), [{ session: 's1', workspace: '/work', status: 'idle' }]);
  });

  it('re-registers a tool the daemon describes differently, when DSH hands back a way to remove it', async () => {
    const changed = TOOL_DEFINITIONS.map((tool) => (tool.name === 'ArtifactData' ? { ...tool, description: 'Newer words.' } : tool));
    const { tools, registrations } = await started({ removable: true }, { tools: changed });
    await until(() => tools.get('ArtifactData')?.description === 'Newer words.');
    assert.equal(registrations.filter((n) => n === 'ArtifactData').length, 2);
    assert.equal(registrations.filter((n) => n === 'Artifact').length, 1);
  });

  it("keeps the first definitions when DSH's register gives no way to remove them", async () => {
    const changed = TOOL_DEFINITIONS.map((tool) => (tool.name === 'ArtifactData' ? { ...tool, description: 'Newer words.' } : tool));
    const { fake, tools, registrations } = await started({}, { tools: changed });
    await fake.waitFor('tools.list');
    await new Promise((done) => setTimeout(done, 30));
    assert.notEqual(tools.get('ArtifactData')!.description, 'Newer words.');
    assert.equal(registrations.length, TOOL_DEFINITIONS.length);
  });
});

describe('wake.deliver', () => {
  it("wakes an idle agent with a new turn, and attaches the session as running", async () => {
    const { agent, got } = fakeAgent('s1', 'idle');
    const { fake } = await started({ agents: new Map([['s1', agent]]) });
    assert.deepEqual(await fake.wake(wake('s1')), { status: 'resumed' });
    assert.equal(got.followup.length, 1);
    assert.equal(got.inject.length, 0);
    assert.equal(got.followup[0]!.source.kind, WAKE_SOURCE_KIND);
    assert.equal(got.followup[0]!.content[0]!.text, wake('s1').text);
    assert.deepEqual((await fake.waitFor('session.attach')).params, { session: 's1', workspace: '/work', status: 'running' });
  });

  it('hands a busy agent the message at its next step', async () => {
    const { agent, got } = fakeAgent('s1', 'running');
    const { fake } = await started({ agents: new Map([['s1', agent]]) });
    assert.deepEqual(await fake.wake(wake('s1')), { status: 'delivered' });
    assert.equal(got.inject.length, 1);
    assert.equal(got.followup.length, 0);
    assert.equal(got.cancel.length, 0);
  });

  it("ends a blocking question on the owner's words: the turn is cancelled, keeping the inbox, and the message starts the next", async () => {
    const { agent, got } = fakeAgent('s1', 'running');
    const { fake, emit } = await started({ agents: new Map([['s1', agent]]) });
    emit('session/event', agent.session!, { type: 'tool/call', data: { name: 'ask_user_question', callId: 'c1' } });
    assert.deepEqual(await fake.wake(wake('s1')), { status: 'resumed' });
    assert.deepEqual(got.cancel, [[{ kind: 'user' }, { keepInbox: true }]]);
    assert.equal(got.followup.length, 1);
    assert.equal(got.inject.length, 0);
  });

  it("leaves a question to the owner open on a collaborator's message, which the agent reads next as a notice", async () => {
    const { agent, got } = fakeAgent('s1', 'running');
    const closed: unknown[] = [];
    const waits = new Map([[agent, new Map<string, DshQuestionWait>([['q1', { timeout: { kind: 'timeout' }, close: (reason) => closed.push(reason) }]])]]);
    const { fake, emit } = await started({ agents: new Map([['s1', agent]]), waits });
    emit('session/event', agent.session!, { type: 'tool/call', data: { name: 'ask_user_question', callId: 'c1' } });
    assert.deepEqual(await fake.wake(wake('s1', COLLABORATOR)), { status: 'delivered' });
    assert.deepEqual(got.cancel, []);
    assert.deepEqual(closed, []);
    assert.equal(got.inject.length, 1);
    assert.equal(got.inject[0]!.source.form, 'notice');
    assert.deepEqual((got.inject[0]!.source as Record<string, unknown>).from, COLLABORATOR.from);
  });

  it("starts a turn of an idle agent with a task's result, as a notice", async () => {
    const { agent, got } = fakeAgent('s1', 'idle');
    const { fake } = await started({ agents: new Map([['s1', agent]]) });
    const task = wake('s1', { reason: 'task', from: { kind: 'system' }, threads: [], task: { id: 'k1', action: 'export', ok: true } });
    assert.deepEqual(await fake.wake(task), { status: 'resumed' });
    assert.equal(got.followup.length, 1);
    assert.equal(got.cancel.length, 0);
  });

  it("reads an older daemon's wake (no reason or from) as the owner's, unless its text names someone else", async () => {
    const { agent, got } = fakeAgent('s1', 'running');
    const { fake, emit } = await started({ agents: new Map([['s1', agent]]) });
    emit('session/event', agent.session!, { type: 'tool/call', data: { name: 'ask_user_question', callId: 'c1' } });
    const { reason: _r, from: _f, ...old } = source();
    const text = '[Open Artifact]\nFrom: Ana (commenter, not the owner)\nBigger, please';
    assert.deepEqual(await fake.wake({ ...wake('s1'), text, source: old as WakeSource }), { status: 'delivered' });
    assert.equal(got.cancel.length, 0);
    assert.deepEqual(await fake.wake({ ...wake('s1'), source: old as WakeSource }), { status: 'resumed' });
    assert.equal(got.cancel.length, 1);
  });

  it('no longer counts a question once it is answered', async () => {
    const { agent, got } = fakeAgent('s1', 'running');
    const { fake, emit } = await started({ agents: new Map([['s1', agent]]) });
    emit('session/event', agent.session!, { type: 'tool/call', data: { name: 'ask_user_question', callId: 'c1' } });
    emit('session/event', agent.session!, { type: 'tool/result', data: { message: { toolCallId: 'c1' } } });
    assert.deepEqual(await fake.wake(wake('s1')), { status: 'delivered' });
    assert.equal(got.cancel.length, 0);
  });

  it('ends a timed question as its timeout would, and the turn reads the message next', async () => {
    const { agent, got } = fakeAgent('s1', 'running');
    const closed: unknown[] = [];
    const timeout = { kind: 'timeout' };
    const waits = new Map([[agent, new Map<string, DshQuestionWait>([['q1', { timeout, close: (reason) => closed.push(reason) }]])]]);
    const { fake } = await started({ agents: new Map([['s1', agent]]), waits });
    assert.deepEqual(await fake.wake(wake('s1')), { status: 'resumed' });
    assert.deepEqual(closed, [timeout]);
    assert.equal(got.inject.length, 1);
    assert.equal(got.cancel.length, 0);
  });

  it('resumes a session with no live agent through the session controller', async () => {
    const { agent, got } = fakeAgent('s9', 'idle');
    const { fake } = await started({ resolveAgent: (id) => (id === 's9' ? agent : undefined) });
    assert.deepEqual(await fake.wake(wake('s9')), { status: 'resumed' });
    assert.equal(got.followup.length, 1);
  });

  it('fails when there is no agent, so the daemon keeps the message in the inbox', async () => {
    const { fake } = await started();
    assert.deepEqual(await fake.wake(wake('gone')), { status: 'failed' });
    assert.deepEqual(await fake.wake(wake(null)), { status: 'failed' });
  });

  it("hands what waited in the session's inbox to its agent when the session attaches", async () => {
    const { agent, got } = fakeAgent('s1', 'idle');
    const fake = await startFakeDaemon();
    daemons.push(fake);
    fake.queueInbox('s1', { text: 'Waiting comment', source: source({ summary: 'Waiting' }) });
    const context = fakeContext({ agents: new Map([['s1', agent]]) });
    plugins.push(context.dispose);
    setup(context.ctx, {}, { harness: { home: fake.home, autoStart: false } });
    await context.tools.get('Artifact')!.execute({}, { agent: { id: 's1', status: 'idle' } });
    await until(() => got.followup.length === 1);
    assert.equal(got.followup[0]!.content[0]!.text, 'Waiting comment');
  });
});

describe('host.open', () => {
  it("hands the browser halves the view's embed address and ticket, and relays what its Shell says both ways", async () => {
    const hostOpens = new HostOpens(1_000);
    const seen: HostOpenRequest[] = [];
    hostOpens.listen((request) => {
      seen.push(request);
      hostOpens.answer(request.id, true);
    });
    const shell: unknown[] = [];
    hostOpens.listenShell((event) => shell.push(event));
    const { fake, routes } = await started({}, {}, { hostOpens });
    const embedUrl = `${fake.url}/a/a1/?oa_view=v1`;
    assert.deepEqual(await fake.open({ url: 'open-artifact://artifact/a1', session: 's1', title: 'Deck', view: 'v1', embed_url: embedUrl }), { opened: true });
    assert.deepEqual(seen.map(({ id: _id, ...rest }) => rest), [{ session: 's1', url: embedUrl, title: 'Deck', view: 'v1', agentName: 'Agent' }]);

    await fake.shellEvent('v1', { openArtifact: 'comment_summon', text: 'Bigger' } as never, 's1');
    assert.equal(shell.length, 1);
    assert.equal((shell[0] as { view: string }).view, 'v1');

    const route = routes.find((r) => r.path === PATHS.shellCommand)!;
    const post = (view: string, body: unknown) =>
      route.fetch(new Request(`http://app.local${PATHS.shellCommand}?view=${view}`, { method: 'POST', body: JSON.stringify(body) }));
    assert.equal((await post('v1', { openArtifact: 'goto', hash: '#slide-2' })).status, 200);
    assert.deepEqual(fake.shellCommands, [{ view: 'v1', command: { openArtifact: 'goto', hash: '#slide-2' } }]);
    // Only host messages a host may send, and only to a view the daemon opened.
    assert.equal((await post('v1', { openArtifact: 'new_session', prompt: 'x' })).status, 400);
    assert.notEqual((await post('v9', { openArtifact: 'goto', hash: '#x' })).status, 200);
  });

  it("shows a remote type's page in the Browser tab without asking, as before the kit", async () => {
    const hostOpens = new HostOpens(1_000);
    const seen: HostOpenRequest[] = [];
    hostOpens.listen((request) => {
      seen.push(request);
      hostOpens.answer(request.id, true);
    });
    const { fake } = await started({}, {}, { hostOpens });
    const embedUrl = `${fake.url}/a/a2/?oa_view=v2`;
    const opened = await fake.open({ url: 'open-artifact://artifact/a2', session: 's1', title: 'Remote deck', view: 'v2', embed_url: embedUrl, remote: { type: 'slides', origins: ['https://types.example.com'] } });
    assert.deepEqual(opened, { opened: true });
    assert.deepEqual(seen.map((r) => r.url), [embedUrl]);
  });

  it('answers false when no browser half shows it', async () => {
    const { fake } = await started({}, {}, { hostOpens: new HostOpens(30) });
    assert.deepEqual(await fake.open({ url: 'open-artifact://artifact/a1', session: 's1', view: 'v1' }), { opened: false });
  });
});

describe('skill', () => {
  it("is the daemon's rendering for DSH when it has skill.get", async () => {
    const asked: unknown[] = [];
    const { skills } = await started(
      {},
      {
        features: ['skill.get'],
        handle: (method, params) => {
          if (method !== 'skill.get') return undefined;
          asked.push(params);
          return { name: 'open-artifact', description: 'Daemon words.', argumentHint: '<type>', body: '# From the daemon\n\n## Installed types\n\n- `slides`: Slides', version: '9.9.9', etag: 'e' };
        },
      },
    );
    const provider = skills[0]!;
    const [candidate] = await provider.list();
    assert.equal(candidate!.name, 'open-artifact');
    assert.deepEqual(candidate!.invocation, { modelInvocable: false, userInvocable: true });
    const skill = await provider.get(candidate!);
    assert.ok(!('rank' in skill));
    assert.equal(skill.content, '# From the daemon\n\n## Installed types\n\n- `slides`: Slides\n');
    assert.equal(skill.description, 'Daemon words.');
    assert.deepEqual(asked, [{ command: 'open-artifact', agentName: 'Agent', tools: 'native', opens: 'host' }]);
  });

  it("is the kit's own without it, saying how to find the types", async () => {
    const { skills } = await started();
    const provider = skills[0]!;
    const [candidate] = await provider.list();
    const skill = await provider.get(candidate!);
    assert.doesNotMatch(skill.content, /^---/);
    assert.match(skill.content, /type_url/);
    assert.match(skill.content, /quickstart/);
  });
});
