#!/usr/bin/env node
/**
 * The smallest complete headless host: one chat session that makes an artifact and then waits for what the person
 * says on its page.
 *
 *   node examples/harness-node/main.mjs [--workspace <dir>] [--type <type>] [--once]
 *
 * It connects (starting the daemon when needed), attaches session `chat-1`, registers the tools, installs the skill,
 * makes an artifact (quickstart → publish → write a file → open), reads the page context, and then prints every wake
 * until it is stopped (`--once`: until the first). Every line it prints starts with a word a script can match:
 * `connected`, `tools`, `skill`, `card`, `published`, `opened`, `context`, `ready`, `wake`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ScriptedAgent } from './agent.mjs';
import { followArtifacts } from './artifacts.mjs';
import { callerOf, connectHarness } from './harness.mjs';
import { installSkill } from './skill.mjs';
import { registerTools, reportWrites } from './tools.mjs';
import { describeWake, wakeHandler } from './wakes.mjs';

const { values: args } = parseArgs({
  options: { workspace: { type: 'string', default: process.cwd() }, type: { type: 'string' }, once: { type: 'boolean', default: false } },
});
const workspace = resolve(args.workspace);
const say = (line) => console.log(line);

const agent = new ScriptedAgent({ id: 'chat-1', workspace, title: 'Example chat' });
const sessions = new Map([[agent.id, agent]]);
let stopAfterWake = false;

const oa = await connectHarness({
  wake: wakeHandler(sessions, {
    onWake(params, route) {
      say(`wake ${route} ${describeWake(params)}`);
      if (stopAfterWake) setTimeout(() => void shutdown(0), 10);
    },
  }),
  log: (line) => process.stderr.write(`[kit] ${line}\n`),
});
say(`connected ${oa.connected ? 'yes' : 'no'} features=${oa.features.length}`);

async function shutdown(code) {
  await oa.detach(callerOf(agent)).catch(() => undefined);
  oa.close();
  process.exit(code);
}
process.on('SIGINT', () => void shutdown(0));
process.on('SIGTERM', () => void shutdown(0));

// The session: attached while it works, `idle` when its turn ends. What waited for it comes through `wake` here.
await oa.attach({ ...callerOf(agent), title: agent.title, status: 'running' });
say(`tools ${(await registerTools(oa, agent)).join(',')}`);

// The skill and the command menu: one command per installed type.
const skill = await installSkill(oa, join(workspace, '.example-skills'));
say(`skill ${skill.source} ${skill.written ? 'written' : 'unchanged'} commands=${skill.commands.map((c) => c.type).join(',')}`);

followArtifacts(oa, { onCard: (report, card) => say(`card ${report.change} ${card?.title ?? report.artifact.url}`) });

// One turn of the scripted agent: pick a type, create the artifact, fill it, show it.
const quick = await agent.runTool('Artifact', { action: 'quickstart', ...(args.type ? { type: args.type } : {}) });
if (!quick.create) throw new Error(`no type to create from: ${JSON.stringify(quick).slice(0, 300)}`);
const { open: _later, ...create } = quick.create;
const made = await agent.runTool('Artifact', { ...create, title: 'Hello from the example' });
if (made.error) throw new Error(made.error.message);
say(`published ${made.url} root=${made.root}`);

mkdirSync(made.root, { recursive: true });
const file = join(made.root, 'note.html');
writeFileSync(file, '<!doctype html><h1>Hello</h1><p>Written by the example agent.</p>\n');
await reportWrites(oa, agent, [file]);

const opened = await oa.open(made.url, callerOf(agent));
say(`opened ${opened.opened ? 'in-host' : 'by-address'} ${opened.view_url ?? ''}`.trim());

// Before the person's next message: what they selected on the page, as a block the agent reads with it.
if (oa.features.includes('view.context')) {
  const block = oa.contextBlock(await oa.context(made.url, callerOf(agent)));
  say(`context ${block ? 'selection' : 'none'}`);
}

await oa.status(callerOf(agent), 'idle');
agent.add('assistant', `Made ${made.url}. Comment on the page and I will see it.`);
stopAfterWake = args.once;
say(`ready ${made.url}`);
