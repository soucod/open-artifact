import { tempDir, TEST_HOME } from './helpers.ts';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { MCP_ACTIONS_META, TOOL_ACTION_KINDS, type DaemonState, type HarnessProfile, type ToolCallResult } from '@open-artifact/protocol';
import { api, readDaemon } from '../src/client.ts';
import { startDaemon, type Daemon } from '../src/daemon.ts';
import { homeProfileFile } from '../src/harness-profiles.ts';
import { commandsFor, skillFor } from '../src/harness-skill.ts';
import type { ListedType } from '../src/types.ts';

let daemon: Daemon;
let state: DaemonState;
let typeServer: Server;
const workspace = tempDir('open-artifact-perm-ws-');
const elsewhere = tempDir('open-artifact-perm-other-');

/** A profile of the person's own (`<home>/harnesses/<name>.json`). */
function profile(name: string, fields: Partial<HarnessProfile>): void {
  const file = homeProfileFile(name);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ title: name, agentName: 'Perm', level: 'L3', entry: 'harness-api', wake: ['live'], ...fields }));
}

/** The `stamp` URL type's server: a read action, a write action, comments and a document store. */
function stampServer(): Promise<number> {
  typeServer = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      const send = (status: number, body: unknown): void => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body));
      };
      const body = raw ? (JSON.parse(raw) as { args?: Record<string, unknown> }) : {};
      if (req.method === 'GET' && req.url === '/__open-artifact/actions') {
        return send(200, { actions: [{ name: 'look', title: 'Look', effect: 'read' }, { name: 'poke', title: 'Poke', effect: 'write' }, { name: 'check', title: 'Check' }] });
      }
      const name = req.url?.slice('/__open-artifact/actions/'.length);
      switch (name) {
        case 'look':
        case 'poke':
        case 'check':
          return send(200, { done: name });
        case 'open-artifact.comments.read':
          return send(200, { threads: [{ id: 't1', status: 'open', agent: { status: 'sent' }, messages: [{ from: 'user', text: 'Hi' }] }], sent_tracked: true });
        case 'open-artifact.comments.reply':
        case 'open-artifact.comments.resolve':
          return send(200, { thread: { id: (body.args as { thread_id?: string })?.thread_id } });
        case 'open-artifact.db.read':
          return send(200, { collection: 'c', docs: [], total: 0 });
        case 'open-artifact.db.write':
          return send(200, { writes: ((body.args as { writes?: Array<{ op: string; path: string }> })?.writes ?? []).map((w) => ({ op: w.op, path: w.path, sha256: 'c'.repeat(64) })) });
        default:
          return send(404, { code: 'unknown_action', message: 'No such action.' });
      }
    });
  });
  return new Promise((done) => typeServer.listen(0, '127.0.0.1', () => done((typeServer.address() as { port: number }).port)));
}

before(async () => {
  const port = await stampServer();
  const dir = join(process.env.OPEN_ARTIFACT_USER_TYPES!, 'stamp');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'artifact-type.json'),
    JSON.stringify({ name: 'Stamp', description: 'Stamps as local files.', intents: ['stamp'], entry: { url: `http://127.0.0.1:${port}/{id}`, actions: true } }),
  );
  profile('perm-app', {
    title: 'Perm App',
    commands: ['artifact'],
    rules: 'Never use emoji in titles.',
    policy: { reuse: 'workspace', confirm: ['remove'], roles: { subagent: { create: false, remove: false }, reviewer: { create: false, modify: false, remove: false } } },
  });
  profile('session-app', { policy: { reuse: 'session' } });
  profile('none-app', { policy: { reuse: 'none' } });
  daemon = await startDaemon({ port: 0, quiet: true, shellDir: tempDir('open-artifact-shell-'), homeDir: tempDir('open-artifact-no-home-') });
  state = (await readDaemon())!;
});

after(() => {
  daemon.close();
  typeServer.close();
});

type Who = { harness: string; session: string; workspace: string };

/** Attaches a session the way a polling adapter does (`session.attach`), with what it may do. */
function attach(who: Who, extra: { may?: Record<string, boolean>; role?: string } = {}): void {
  daemon.harnesses.pollAttach({ ...who, ...extra });
}

function tool(who: Who, name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
  return api<ToolCallResult>(state, 'tools.call', { name, arguments: args, caller: who });
}

async function make(who: Who, type: string, title: string): Promise<string> {
  const made = await tool(who, 'Artifact', { action: 'publish', type_url: `open-artifact://type/${type}`, title, open: 'never' });
  assert.equal(made.error, undefined, JSON.stringify(made.error));
  return String(made.url);
}

const refused = (result: ToolCallResult, words: RegExp): void => {
  const error = result.error as { code?: string; message?: string; fix?: string } | undefined;
  assert.equal(error?.code, 'not_granted', JSON.stringify(result));
  assert.match(String(error?.message), words);
  assert.ok(error?.fix, 'a refusal says what to do instead');
};

test('permissions: role defaults come from policy.roles, an explicit may wins', async () => {
  const sub: Who = { harness: 'perm-app', session: 'sub-1', workspace };
  attach(sub, { role: 'subagent' });
  refused(await tool(sub, 'Artifact', { action: 'publish', type_url: 'open-artifact://type/stamp', title: 'Nope' }), /A subagent session may not create artifacts/);
  // Reads are never refused.
  assert.equal((await tool(sub, 'Artifact', { action: 'list' })).error, undefined);
  assert.equal((await tool(sub, 'Artifact', { action: 'quickstart', intent: 'stamp' })).error, undefined);

  const allowed: Who = { harness: 'perm-app', session: 'sub-2', workspace };
  attach(allowed, { role: 'subagent', may: { create: true } });
  await make(allowed, 'stamp', 'Allowed stamp');

  // A role the profile does not list, and no may: everything.
  const plain: Who = { harness: 'perm-app', session: 'plain-1', workspace };
  attach(plain, { role: 'stranger' });
  await make(plain, 'stamp', 'Plain stamp');
});

test('permissions: modify covers publish {url}, write actions and ArtifactData writes', async () => {
  const owner: Who = { harness: 'perm-app', session: 'owner-m', workspace };
  attach(owner);
  const url = await make(owner, 'stamp', 'Modify target');
  const ro: Who = { harness: 'perm-app', session: 'ro-1', workspace };
  attach(ro, { may: { modify: false } });
  refused(await tool(ro, 'Artifact', { action: 'publish', url, files: { 'a.txt': 'x' } }), /This session may not change artifacts/);
  refused(await tool(ro, 'Artifact', { action: 'call', url, name: 'poke' }), /poke/);
  refused(await tool(ro, 'Artifact', { action: 'call', url, name: 'check' }), /check/);
  refused(await tool(ro, 'ArtifactData', { action: 'set', url, path: 'c/a', data: {}, if_match: '*' }), /ArtifactData set/);
  refused(await tool(ro, 'ArtifactData', { action: 'batch', url, writes: [{ op: 'delete', path: 'c/a' }] }), /ArtifactData batch/);
  assert.deepEqual((await tool(ro, 'Artifact', { action: 'call', url, name: 'look' })).done, 'look', 'a read action runs');
  assert.equal((await tool(ro, 'ArtifactData', { action: 'list', url, collection: 'c' })).error, undefined);
  assert.equal((await tool(ro, 'Artifact', { action: 'read', url })).error, undefined);
  assert.equal((await tool(ro, 'ArtifactComments', { action: 'read', url })).error, undefined);
  // The owner may.
  assert.equal((await tool(owner, 'Artifact', { action: 'call', url, name: 'poke' })).done, 'poke');
});

test('permissions: remove covers delete and adopting another session\'s artifact; create covers adopting a folder', async () => {
  const owner: Who = { harness: 'perm-app', session: 'owner-r', workspace };
  attach(owner);
  const url = await make(owner, 'stamp', 'Remove target');
  const sub: Who = { harness: 'perm-app', session: 'sub-r', workspace };
  attach(sub, { role: 'subagent' });
  refused(await tool(sub, 'Artifact', { action: 'delete', url }), /A subagent session may not delete artifacts or take them over/);
  refused(await tool(sub, 'Artifact', { action: 'adopt', url }), /another session's artifact/);
  // Adopting its own is a change, which a subagent may make.
  assert.equal((await tool(owner, 'Artifact', { action: 'adopt', url })).error, undefined);

  const reviewer: Who = { harness: 'perm-app', session: 'rev-r', workspace };
  attach(reviewer, { role: 'reviewer' });
  const folder = join(workspace, 'loose-stamp');
  mkdirSync(folder, { recursive: true });
  refused(await tool(reviewer, 'Artifact', { action: 'adopt', folder, type_url: 'open-artifact://type/stamp' }), /A reviewer session may not create artifacts/);
  assert.equal((await tool(owner, 'Artifact', { action: 'delete', url })).error, undefined, 'the owner may delete');
});

test('permissions: reply covers answering, resolving and reopening threads', async () => {
  const owner: Who = { harness: 'perm-app', session: 'owner-c', workspace };
  attach(owner);
  const url = await make(owner, 'stamp', 'Comment target');
  const quiet: Who = { harness: 'perm-app', session: 'quiet-1', workspace };
  attach(quiet, { may: { reply: false } });
  refused(await tool(quiet, 'ArtifactComments', { action: 'reply', url, thread_id: 't1', text: 'Done.' }), /may not answer comment threads/);
  refused(await tool(quiet, 'ArtifactComments', { action: 'resolve', url, thread_id: 't1' }), /resolve/);
  refused(await tool(quiet, 'ArtifactComments', { action: 'reopen', url, thread_id: 't1' }), /reopen/);
  assert.equal((await tool(owner, 'ArtifactComments', { action: 'reply', url, thread_id: 't1', text: 'Done.' })).replied, true);
});

test('quickstart: type skips matching and answers steps, rules and replaces for the harness', async () => {
  const who: Who = { harness: 'perm-app', session: 'qs-1', workspace };
  const quick = await tool(who, 'Artifact', { action: 'quickstart', type: 'stamp', intent: 'zzqx nothing matches this' });
  assert.equal((quick.recommended as { id: string }).id, 'stamp');
  assert.deepEqual(quick.alternatives, []);
  assert.deepEqual(quick.create, { action: 'publish', type_url: 'open-artifact://type/stamp', title: '<name>', open: 'after_first_write' });
  const steps = String(quick.steps);
  assert.ok(steps.includes('**Create it** with the `create` call'));
  assert.ok(steps.includes('"Send to Perm"'));
  assert.ok(steps.includes('the app will ask the person first'), 'policy.confirm changes the wording');
  assert.ok(steps.includes('Artifact delete'));
  assert.match(String(quick.rules), /^The rules of Perm App, the app you work in\. They win over everything else/);
  assert.ok(String(quick.rules).includes('Never use emoji in titles.'));
  assert.ok((quick.replaces as string[]).includes('Artifact {action: "list", scope: "types"}'));
  assert.match(String(quick.next), /rules are your app's own/);

  const missing = await tool(who, 'Artifact', { action: 'quickstart', type: 'no-such-type' });
  assert.equal((missing.error as { code?: string }).code, 'type_missing');
  // Without a harness profile: no rules.
  const plain = await tool({ harness: 'mcp', session: 'qs-2', workspace }, 'Artifact', { action: 'quickstart', intent: 'stamp' });
  assert.equal(plain.rules, undefined);
  assert.ok(String(plain.steps).includes('"Send to agent"'));
});

test('quickstart: existing lists similar artifacts of the type within policy.reuse', async () => {
  const a: Who = { harness: 'perm-app', session: 'ex-a', workspace };
  await make(a, 'stamp', 'Quarterly sales stamp');
  await make(a, 'stamp', 'Holiday greetings');
  const far: Who = { harness: 'perm-app', session: 'ex-far', workspace: elsewhere };
  await make(far, 'stamp', 'Quarterly sales elsewhere');

  // workspace: another session in the same folder sees it; the other folder's does not show.
  const b = await tool({ harness: 'perm-app', session: 'ex-b', workspace }, 'Artifact', { action: 'quickstart', type: 'stamp', intent: 'a quarterly sales stamp' });
  const titles = (b.existing as Array<{ title: string; mine: boolean }>).map((x) => x.title);
  assert.deepEqual(titles, ['Quarterly sales stamp']);
  assert.match(String(b.next), /existing lists artifacts of this type/);

  // session: only the caller's own.
  const s1: Who = { harness: 'session-app', session: 'ex-s1', workspace };
  await make(s1, 'stamp', 'Weekly report stamp');
  const other = await tool({ harness: 'session-app', session: 'ex-s2', workspace }, 'Artifact', { action: 'quickstart', type: 'stamp', intent: 'weekly report' });
  assert.equal(other.existing, undefined);
  const own = await tool(s1, 'Artifact', { action: 'quickstart', type: 'stamp', intent: 'weekly report' });
  assert.deepEqual((own.existing as Array<{ title: string; mine: boolean }>).map((x) => [x.title, x.mine]), [['Weekly report stamp', true]]);

  // none: never looked for.
  const n1: Who = { harness: 'none-app', session: 'ex-n1', workspace };
  await make(n1, 'stamp', 'Monthly budget stamp');
  const none = await tool(n1, 'Artifact', { action: 'quickstart', type: 'stamp', intent: 'monthly budget' });
  assert.equal(none.existing, undefined);
  assert.ok(!(none.replaces as string[]).some((r) => r.includes('existing has already looked')));

  // Only words that say something: the type's own name matches nothing.
  const generic = await tool({ harness: 'perm-app', session: 'ex-c', workspace }, 'Artifact', { action: 'quickstart', type: 'stamp', intent: 'stamp' });
  assert.equal(generic.existing, undefined);
});

test('action kinds: tools.list and MCP tools/list carry them; type actions carry their effect', async () => {
  const listed = await api<{ tools: Array<{ name: string; actions?: Record<string, string> }> }>(state, 'tools');
  for (const definition of listed.tools) assert.deepEqual(definition.actions, TOOL_ACTION_KINDS[definition.name as keyof typeof TOOL_ACTION_KINDS]);

  const response = await fetch(`${state.url}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
  });
  const { result } = (await response.json()) as { result: { tools: Array<Record<string, unknown>> } };
  const artifact = result.tools.find((t) => t.name === 'Artifact')!;
  assert.equal(artifact.actions, undefined, 'not a field of its own in MCP');
  assert.equal((artifact._meta as Record<string, Record<string, string>>)[MCP_ACTIONS_META]!.delete, 'remove');

  const who: Who = { harness: 'perm-app', session: 'kinds-1', workspace };
  const made = await tool(who, 'Artifact', { action: 'publish', type_url: 'open-artifact://type/stamp', title: 'Kinds' });
  assert.deepEqual(
    (made.actions as Array<{ name: string; effect: string }>).map((a) => [a.name, a.effect]),
    [['look', 'read'], ['poke', 'write'], ['check', 'write']],
  );
  assert.ok(String(made.instructions).includes('name: "look"} (read)'));
});

/** A listed type for the catalog of the unit tests below. */
function listed(id: string, extra: Partial<ListedType> = {}): ListedType {
  return { id, title: id[0]!.toUpperCase() + id.slice(1), description: `${id} things. More.`, summary: null, when: null, i18n: {}, templates: [], exports: [], offer: null, enabled: true, runnable: true, shadowedBy: null, ...extra } as unknown as ListedType;
}

const catalogOf = (types: ListedType[], offers: string[] = []) => ({ skillCatalog: () => ({ types, offers }) });

test('skill.get: the harness renders its command, rules and types; the etag follows the text, not the version', () => {
  const caller = { harness: 'perm-app', session: null, workspace };
  const one = skillFor({}, { harness: 'perm-app', caller, version: '1.0.0', tools: catalogOf([listed('alpha')]) });
  assert.equal(one.name, 'artifact', "the harness's first command");
  assert.ok(one.body.includes('# Make an artifact: `/artifact <type> <what to make>`'));
  assert.ok(one.body.includes("## Perm App's rules"));
  assert.ok(one.body.includes('- `alpha`: Alpha. alpha things.'));
  assert.ok(one.prompt?.includes('<installed_types>'));

  const again = skillFor({}, { harness: 'perm-app', caller, version: '2.0.0', tools: catalogOf([listed('alpha')]) });
  assert.equal(again.etag, one.etag, 'a new runtime with the same text keeps the etag');
  const more = skillFor({}, { harness: 'perm-app', caller, version: '1.0.0', tools: catalogOf([listed('alpha'), listed('beta')]) });
  assert.notEqual(more.etag, one.etag, 'another type changes it');
  const entry = skillFor({ form: 'entry' }, { harness: 'perm-app', caller, version: '1.0.0', tools: catalogOf([listed('alpha')]) });
  assert.notEqual(entry.etag, one.etag, 'another body changes it');
  // Disabled, broken and shadowed types are not listed.
  const hidden = skillFor({}, { harness: 'perm-app', caller, tools: catalogOf([listed('alpha'), listed('off', { enabled: false }), listed('broken', { runnable: false })]) });
  assert.equal(hidden.etag, skillFor({}, { harness: 'perm-app', caller, tools: catalogOf([listed('alpha')]) }).etag);
  assert.throws(() => skillFor({ command: '/Bad' }, { harness: 'perm-app', caller }), /command/);
});

test('skill.get: policy.offer "asked" leaves the offers out of prompt', () => {
  profile('asked-app', { policy: { offer: 'asked' } });
  const caller = { harness: 'asked-app', session: null, workspace };
  const types = [listed('alpha', { offer: 'When a stamp would help.' })];
  assert.ok(!skillFor({}, { harness: 'asked-app', caller, tools: catalogOf(types, ['alpha']) }).prompt?.includes('<offers>'));
  assert.ok(skillFor({}, { harness: 'perm-app', caller: { ...caller, harness: 'perm-app' }, tools: catalogOf(types, ['alpha']) }).prompt?.includes('<offers>'));
});

test('commands.list: one entry per type, localized, author text cleaned', () => {
  const caller = { harness: 'perm-app', session: null, workspace };
  const types = [
    listed('zeta', {
      i18n: { 'zh-CN': { title: '泽塔', summary: '中文<script>说明</script>' } },
      templates: [{ id: 'pitch', name: 'Pitch <b>deck</b>', prompt: 'Make a pitch\n\ndeck <now>' }, { id: 'empty', name: 'Empty', prompt: '  ' }],
    } as Partial<ListedType>),
    listed('alpha'),
  ];
  const { commands } = commandsFor({ locale: 'zh' }, { harness: 'perm-app', caller, tools: catalogOf(types) });
  assert.deepEqual(commands.map((c) => c.text), ['/artifact alpha ', '/artifact zeta ']);
  const zeta = commands[1]!;
  assert.equal(zeta.title, '泽塔');
  assert.equal(zeta.description, '中文script说明/script');
  assert.deepEqual(zeta.templates, [{ id: 'pitch', name: 'Pitch bdeck/b', prompt: 'Make a pitch deck now' }]);
  assert.equal(commands[0]!.templates, undefined);
  assert.equal(commandsFor({ command: 'oa' }, { harness: 'perm-app', caller, tools: catalogOf(types) }).commands[0]!.text, '/oa alpha ');
});

test('pollAttach keeps may and role too', () => {
  daemon.harnesses.pollAttach({ harness: 'perm-app', session: 'poll-may', workspace, may: { reply: false }, role: 'subagent' });
  const session = [...daemon.harnesses.sessions.values()].find((s) => s.ref.session === 'poll-may')!;
  assert.deepEqual(session.may, { reply: false });
  assert.equal(session.role, 'subagent');
  assert.ok(TEST_HOME);
});
