import { tempDir } from './helpers.ts';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { artifactIdOf, type DaemonState, type ToolCallResult } from '@open-artifact/protocol';
import { api, readDaemon } from '../src/client.ts';
import { startDaemon, type Daemon } from '../src/daemon.ts';
import { parseActions } from '../src/servers.ts';
import { checkArgs } from '../src/tools.ts';

let daemon: Daemon;
let state: DaemonState;
let typeServer: Server;
/** `GET /__open-artifact/actions` answered so far. */
let listed = 0;
/** The last arguments of the reserved actions. */
const seen: { read?: any; write?: any; replies: any[] } = { replies: [] };
const SHA_A = 'a'.repeat(64);
const SHA_STALE = 'b'.repeat(64);
const THREADS = [
  {
    id: 't1',
    status: 'open',
    agent: { status: 'replied' },
    messages: [
      { from: 'user', text: 'Fix it', at: '2026-01-01T00:00:00.000Z' },
      { from: 'agent', text: 'Done.', at: '2026-01-02T00:00:00.000Z' },
    ],
  },
  { id: 't2', status: 'open', messages: [{ from: 'user', text: 'Not for the agent', at: '2026-03-01T00:00:00.000Z' }] },
  { id: 't3', status: 'resolved', agent: { status: 'replied' }, messages: [{ from: 'user', text: 'Old', at: '2025-12-01T00:00:00.000Z' }] },
];

/** The reserved open-artifact.db.* and open-artifact.comments.* actions, enough to see what the daemon sends and does with the answers. */
function reserved(name: string, args: any): [number, unknown] {
  switch (name) {
    case 'open-artifact.db.read':
      seen.read = args;
      if (args.path === 'notes/a') return [200, { path: 'notes/a', exists: true, sha256: SHA_A, data: { t: 1 } }];
      if (args.path === 'old') return [200, { collection: 'old', docs: [{ id: 'x', data: {} }] }];
      return [200, { collection: args.path, ...(args.query ? { query: true } : {}), docs: [{ id: 'a', path: `${args.path}/a`, sha256: SHA_A, data: { t: 1 } }], total: 1 }];
    case 'open-artifact.db.write':
      seen.write = args;
      if (args.writes.some((w: any) => w.if_match === SHA_STALE)) {
        return [409, { code: 'conflict', message: 'notes/a changed since you read it: nothing was written.', fix: 'Merge, then write again.', current: { 'notes/a': { exists: true, sha256: SHA_A, data: { t: 1 } } } }];
      }
      return [200, { writes: args.writes.map((w: any) => ({ op: w.op, path: w.path, sha256: w.op === 'delete' ? null : 'c'.repeat(64) })) }];
    case 'open-artifact.comments.read':
      return [200, { threads: THREADS.filter((t) => args.all || t.status !== 'resolved'), sent_tracked: true }];
    case 'open-artifact.comments.reply':
      seen.replies.push(args);
      return [200, { thread: { id: args.thread_id } }];
    case 'open-artifact.comments.resolve':
      return [200, { thread: { id: args.thread_id, status: args.reopen ? 'open' : 'resolved' } }];
    default:
      return [404, { code: 'unknown_action', message: 'No such action.' }];
  }
}
const workspace = tempDir('open-artifact-ws-');
const caller = { harness: 'dsh', session: 'tools-1', workspace };
const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

/** A type server for the `greeter` URL type: three actions and a hidden one. */
function greeterServer(): Promise<number> {
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
        listed += 1;
        return send(200, {
          actions: [
            { name: 'greet', title: 'Say hello', effect: 'read', schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
            { name: 'check', title: 'Check the card' },
            { name: 'fail', title: 'Always fails' },
            { name: 'render', title: 'Render the card (long)', effect: 'write', long: true },
            { name: 'restyle', title: 'Restyle the card; the open page saves it' },
            { name: 'open-artifact.db.read', title: 'reserved' },
            { name: 'bad name!', title: 'not a name' },
          ],
        });
      }
      if (req.url?.startsWith('/__open-artifact/actions/open-artifact.')) return send(...reserved(req.url.slice('/__open-artifact/actions/'.length), body.args ?? {}));
      if (req.url === '/__open-artifact/actions/greet') return send(200, { hello: body.args?.name });
      if (req.url === '/__open-artifact/actions/check') return send(200, { check: { problems: 0, findings: [] } });
      if (req.url === '/__open-artifact/actions/fail') return send(400, { code: 'invalid_argument', message: 'Not today.', fix: 'Try tomorrow.' });
      if (req.url === '/__open-artifact/actions/render') return send(200, { task: `task_${String((body as { id?: string }).id)}`, pending: true, note: 'runs in the background' });
      if (req.url === '/__open-artifact/actions/restyle') {
        // The page saves what the action changed: a touch with the person's name, while the action runs.
        const id = String((body as { id?: string }).id);
        void typeApi('touch', { id, author: 'Ada', paths: ['style.css'] }).then(() => send(200, { restyled: true }));
        return;
      }
      return send(404, { code: 'unknown_action', message: 'No such action.' });
    });
  });
  return new Promise((done) => typeServer.listen(0, '127.0.0.1', () => done((typeServer.address() as { port: number }).port)));
}

before(async () => {
  const port = await greeterServer();
  const dir = join(process.env.OPEN_ARTIFACT_USER_TYPES!, 'greeter');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'artifact-type.json'),
    JSON.stringify({
      name: 'Greeter',
      description: 'Greeting cards as local files. A second sentence.',
      when: 'The person wants a greeting card.',
      intents: ['greeting'],
      entry: { url: `http://127.0.0.1:${port}/{id}`, actions: true },
      openArtifact: { exports: ['txt'], uses: ['greeter', 'not a type!'] },
      titleFrom: 'card.json#/title',
    }),
  );
  daemon = await startDaemon({ port: 0, quiet: true, shellDir: tempDir('open-artifact-shell-'), homeDir: tempDir('open-artifact-no-home-') });
  state = (await readDaemon())!;
});

after(() => {
  daemon.close();
  typeServer.close();
});

/** Calls the daemon's Type API as the greeter's server. */
function typeApi(name: string, body: unknown): Promise<Response> {
  return fetch(`${state.url}/api/open-artifact.type.${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${daemon.typeToken('greeter')}` },
    body: JSON.stringify(body),
  });
}

/** Calls a tool as {@link caller}. */
function tool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
  return api<ToolCallResult>(state, 'tools.call', { name, arguments: args, caller });
}

async function createGreeter(title: string): Promise<string> {
  const made = await tool('Artifact', { action: 'publish', type_url: 'open-artifact://type/greeter', title });
  assert.equal(made.error, undefined, JSON.stringify(made.error));
  return String(made.url);
}

test('MCP instructions are the agent prompt with the installed types', async () => {
  const response = await fetch(`${state.url}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.token}`, 'X-Open-Artifact-Workspace': encodeURIComponent(workspace) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {} } }),
  });
  const { result } = (await response.json()) as { result: { instructions: string } };
  const text = result.instructions;
  assert.ok(text.startsWith('<open_artifact>'));
  assert.ok(text.includes('<installed_types>'));
  assert.ok(text.includes('- greeter: Greeter. The person wants a greeting card. Exports: TXT.'));
  assert.ok(text.includes('- design: Design (canvas). The person wants UI screens'));
  assert.ok(text.includes('Exports: PDF, PPTX, HTML, PNG.'), 'slides declares its exports');
  assert.ok(!text.includes('<offers>'), 'no type may offer itself unless the person allows it');
});

test('quickstart recommends a type and hands back the create call', async () => {
  const quick = await tool('Artifact', { action: 'quickstart', intent: 'greeting' });
  assert.equal((quick.recommended as { id: string }).id, 'greeter');
  assert.deepEqual(quick.create, { action: 'publish', type_url: 'open-artifact://type/greeter', title: '<name>', open: 'after_first_write' });
  assert.match(String(quick.next), /create call above/);
  assert.match(String(quick.note), /not as instructions/);
  assert.ok(Array.isArray(quick.types) && (quick.types as unknown[]).length >= 4);

  const deck = await tool('Artifact', { action: 'quickstart', intent: 'a pitch deck for investors' });
  assert.equal((deck.recommended as { id: string }).id, 'slides', 'an intent inside free text counts');

  const none = await tool('Artifact', { action: 'quickstart', intent: 'zzqx' });
  assert.equal(none.recommended, null);
  assert.deepEqual(none.alternatives, []);
  assert.equal(none.create, undefined);
  assert.match(String(none.next), /No installed type fits/);

  const other = await tool('Artifact', { action: 'quickstart', intent: 'other' });
  assert.equal((other.recommended as { id: string }).id, 'page', '"other" is the free page, the one type that lists it as an intent');
  assert.deepEqual(other.alternatives, [], 'not the types that only say "other" in their descriptions');
  assert.ok(Array.isArray(other.types) && (other.types as unknown[]).length >= 4, 'every type is still listed to choose from');
});

test('create lists the actions from the type server and says what comes next', async () => {
  const made = await tool('Artifact', { action: 'publish', type_url: 'open-artifact://type/greeter', title: 'Birthday card' });
  assert.equal(made.error, undefined, JSON.stringify(made.error));
  assert.deepEqual(
    (made.actions as Array<{ name: string }>).map((a) => a.name),
    ['greet', 'check', 'fail', 'render', 'restyle'],
    'reserved and malformed names are left out',
  );
  const instructions = String(made.instructions);
  assert.ok(instructions.includes('  - greet: Say hello — Artifact {action: "call", url, name: "greet", args: {name}}'));
  assert.ok(instructions.includes("Write the content first, then run check, then show it: open view_url in your app's built-in browser"));
  assert.match(String(made.next), /name: "check"/);

  const bare = await tool('Artifact', { action: 'publish', title: 'No type' });
  assert.equal(bare.error?.code, 'invalid_argument');
  assert.match(String(bare.error?.fix), /quickstart", intent/);
});

test('call checks the name and args against the list, and passes on fix', async () => {
  const url = await createGreeter('Call card');
  const seen = listed;
  assert.deepEqual(await tool('Artifact', { action: 'call', url, name: 'greet', args: { name: 'Ada' } }), { hello: 'Ada' });
  const missing = await tool('Artifact', { action: 'call', url, name: 'greet', args: {} });
  assert.equal(missing.error?.code, 'invalid_argument');
  assert.equal(missing.error?.message, 'greet needs args.name.');
  const wrong = await tool('Artifact', { action: 'call', url, name: 'greet', args: { name: 3 } });
  assert.equal(wrong.error?.message, 'greet: args.name must be string.');
  const unknown = await tool('Artifact', { action: 'call', url, name: 'nope' });
  assert.equal(unknown.error?.code, 'unknown_action');
  assert.match(String(unknown.error?.fix), /This type's actions: greet, check, fail, render, restyle\./);
  const failed = await tool('Artifact', { action: 'call', url, name: 'fail' });
  assert.deepEqual(failed.error, { code: 'invalid_argument', message: 'Not today.', fix: 'Try tomorrow.' });
  assert.equal(listed, seen, 'the action list is kept');
});

test('publish with if_match writes only what is unchanged; read gives sha256', async () => {
  const url = await createGreeter('Hash card');
  const root = String((await tool('Artifact', { action: 'read', url })).root);
  const first = await tool('Artifact', { action: 'publish', url, files: { 'a.txt': 'one' } });
  assert.deepEqual(first.written, [{ path: 'a.txt', bytes: 3, sha256: sha('one') }]);
  const read = await tool('Artifact', { action: 'read', url, path: 'a.txt' });
  assert.equal(read.sha256, sha('one'));
  assert.equal(read.content, 'one');

  const stale = await tool('Artifact', { action: 'publish', url, files: { 'a.txt': 'two', 'c.txt': 'new' }, if_match: { 'a.txt': '0'.repeat(64) } });
  assert.equal(stale.error?.code, 'conflict');
  assert.deepEqual((stale.current as Record<string, { content: string; sha256: string }>)['a.txt']!.content, 'one');
  assert.equal(readFileSync(join(root, 'a.txt'), 'utf8'), 'one', 'nothing was written');
  assert.throws(() => readFileSync(join(root, 'c.txt')));

  const exists = await tool('Artifact', { action: 'publish', url, files: { 'a.txt': 'two' }, if_match: { 'a.txt': null } });
  assert.equal(exists.error?.code, 'conflict');
  const fresh = await tool('Artifact', { action: 'publish', url, files: { 'b.txt': 'bee' }, if_match: { 'b.txt': null } });
  assert.equal(fresh.error, undefined);
  const bad = await tool('Artifact', { action: 'publish', url, files: { 'a.txt': 'two' }, if_match: { 'a.txt': 'abc' } });
  assert.equal(bad.error?.code, 'invalid_argument');

  const checked = await tool('Artifact', { action: 'publish', url, files: { 'a.txt': 'two' }, if_match: { 'a.txt': sha('one') }, check: true });
  assert.equal(checked.error, undefined, JSON.stringify(checked.error));
  assert.deepEqual(checked.check, { problems: 0, findings: [] });
  assert.equal(readFileSync(join(root, 'a.txt'), 'utf8'), 'two');

  const several = await tool('Artifact', { action: 'read', url, paths: ['a.txt', 'b.txt', 'missing.txt'] });
  const files = several.files as Array<{ path: string; content?: string; sha256?: string; error?: { code: string } }>;
  assert.deepEqual(
    files.map((f) => f.content ?? f.error?.code),
    ['two', 'bee', 'not_found'],
  );
  assert.equal(files[1]!.sha256, sha('bee'));

  const record = await tool('Artifact', { action: 'read', url });
  assert.equal(record.type_url, 'open-artifact://type/greeter');
  assert.equal(record.type_title, 'Greeter');
  assert.equal(record.userEdits, undefined);
  assert.deepEqual(
    (record.files as Array<{ path: string; sha256?: string }>).map((f) => [f.path, f.sha256]),
    [
      ['a.txt', sha('two')],
      ['b.txt', sha('bee')],
    ],
  );
  assert.deepEqual(
    (record.actions as Array<{ name: string }>).map((a) => a.name),
    ['greet', 'check', 'fail', 'render', 'restyle'],
  );
});

test("the person's edits show as changed and changed_files until the agent reads", async () => {
  const url = await createGreeter('Touched card');
  const id = artifactIdOf(url)!;
  await tool('Artifact', { action: 'read', url });
  await new Promise((done) => setTimeout(done, 5));
  const touched = await fetch(`${state.url}/api/open-artifact.type.touch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${daemon.typeToken('greeter')}` },
    body: JSON.stringify({ id, author: 'Ada', paths: ['a.txt', 'card/b.txt'] }),
  });
  assert.equal(touched.status, 200);

  const found = await tool('Artifact', { action: 'list', query: 'touched' });
  const entry = (found.artifacts as Array<{ url: string; changed: boolean; owner: string }>)[0]!;
  assert.equal(entry.url, url);
  assert.equal(entry.changed, true);
  assert.equal(entry.owner, 'dsh:tools-1');
  assert.ok(Array.isArray(found.notes));

  const read = await tool('Artifact', { action: 'read', url });
  assert.deepEqual([...(read.changed_files as string[])].sort(), ['a.txt', 'card/b.txt']);
  assert.match((read.notes as string[])[0]!, /The person changed 2 files \(changed_files\)/);
  assert.ok(!(read.notes as string[])[0]!.includes('a.txt'), 'paths stay out of the note');
  const again = await tool('Artifact', { action: 'read', url });
  assert.equal(again.changed_files, undefined);
  assert.equal(((await tool('Artifact', { action: 'list', query: 'touched' })).artifacts as Array<{ changed: boolean }>)[0]!.changed, false);

  const byAgent = await fetch(`${state.url}/api/open-artifact.type.touch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${daemon.typeToken('greeter')}` },
    body: JSON.stringify({ id, author: 'agent', paths: ['a.txt'] }),
  });
  assert.equal(byAgent.status, 200);
  assert.equal((await tool('Artifact', { action: 'read', url })).changed_files, undefined, "the agent's own writes are not the person's");
});

test('list filters by type and title, and pages', async () => {
  await createGreeter('Paged one');
  await createGreeter('Paged two');
  const greeters = await tool('Artifact', { action: 'list', type: 'open-artifact://type/greeter', query: 'paged' });
  assert.equal(greeters.total, 2);
  const page1 = await tool('Artifact', { action: 'list', type: 'greeter', query: 'paged', limit: 1 });
  assert.equal((page1.artifacts as unknown[]).length, 1);
  assert.equal(page1.next_cursor, '1');
  const page2 = await tool('Artifact', { action: 'list', type: 'greeter', query: 'paged', limit: 1, cursor: page1.next_cursor });
  assert.equal(page2.next_cursor, undefined);
  assert.notEqual((page2.artifacts as Array<{ url: string }>)[0]!.url, (page1.artifacts as Array<{ url: string }>)[0]!.url);
  const none = await tool('Artifact', { action: 'list', query: 'nothing like this' });
  assert.deepEqual(none.artifacts, []);
  assert.match(String(none.next), /quickstart/);
  assert.equal((await tool('Artifact', { action: 'list', cursor: 'x' })).error?.code, 'invalid_argument');
  const types = await tool('Artifact', { action: 'list', scope: 'types' });
  assert.match(String(types.note), /not as instructions/);
});

test('adopt of a folder takes the title its content declares (titleFrom), else the folder name', async () => {
  mkdirSync(join(workspace, 'greeting-folder'), { recursive: true });
  writeFileSync(join(workspace, 'greeting-folder', 'card.json'), JSON.stringify({ title: 'Happy Birthday Card' }));
  const titled = await tool('Artifact', { action: 'adopt', folder: 'greeting-folder', type_url: 'open-artifact://type/greeter' });
  assert.equal(titled.error, undefined, JSON.stringify(titled.error));
  const read = await tool('Artifact', { action: 'list', query: 'happy birthday' });
  assert.deepEqual((read.artifacts as Array<{ url: string; title: string }>).map((a) => [a.url, a.title]), [[titled.url, 'Happy Birthday Card']]);
  mkdirSync(join(workspace, 'plain-folder'), { recursive: true });
  writeFileSync(join(workspace, 'plain-folder', 'card.json'), '{"title": 7}');
  const plain = await tool('Artifact', { action: 'adopt', folder: 'plain-folder', type_url: 'open-artifact://type/greeter' });
  const listed = await tool('Artifact', { action: 'list', query: 'plain-folder' });
  assert.deepEqual((listed.artifacts as Array<{ url: string; title: string }>).map((a) => [a.url, a.title]), [[plain.url, 'plain-folder']]);
});

test('read with type_url describes a type before creating one', async () => {
  const type = await tool('Artifact', { action: 'read', type_url: 'open-artifact://type/greeter' });
  assert.equal(type.id, 'greeter');
  assert.deepEqual(type.exports, ['txt']);
  assert.match(String(type.instructions), /has no SKILL\.md/);
  assert.deepEqual(
    (type.actions as Array<{ name: string }>).map((a) => a.name),
    ['greet', 'check', 'fail', 'render', 'restyle'],
  );
  assert.match(String(type.next), /type_url: "open-artifact:\/\/type\/greeter"/);
  assert.equal((await tool('Artifact', { action: 'read' })).error?.code, 'invalid_argument');
  assert.equal((await tool('Artifact', { action: 'read', type_url: 'open-artifact://type/nothing' })).error?.code, 'type_missing');
});

test('checkArgs and parseActions', () => {
  const schema = { type: 'object', properties: { size: { type: 'integer' }, mode: { enum: ['a', 'b'] } }, additionalProperties: false };
  assert.equal(checkArgs('x', schema, { size: 2, mode: 'a' }), null);
  assert.equal(checkArgs('x', schema, { size: 2.5 }), 'x: args.size must be integer.');
  assert.equal(checkArgs('x', schema, { mode: 'c' }), 'x: args.mode must be one of "a", "b".');
  assert.equal(checkArgs('x', schema, { other: 1 }), 'x takes no args.other; it takes size, mode.');
  assert.equal(checkArgs('x', undefined, { anything: true }), null);
  assert.deepEqual(parseActions([{ name: 'go' }, { name: 'open-artifact.db.read' }, 'x', { name: 'b c' }, { name: 'ok', title: ' Two\n lines ', long: true, effect: 'write' }]), [
    { name: 'go', title: 'go' },
    { name: 'ok', title: 'Two lines', effect: 'write', long: true },
  ]);
});

test('ArtifactData passes paging, queries, if_match and str_replace through, and lifts a conflict\'s current', async () => {
  const url = await createGreeter('Data');
  const got = await tool('ArtifactData', { action: 'get', url, path: 'notes/a' });
  assert.equal(got.sha256, SHA_A);
  assert.equal(got.notes, undefined);
  await tool('ArtifactData', { action: 'list', url, collection: 'notes' });
  assert.deepEqual(seen.read, { path: 'notes', limit: 100 });
  await tool('ArtifactData', { action: 'list', url, collection: 'notes', limit: 2, cursor: '2' });
  assert.deepEqual(seen.read, { path: 'notes', limit: 2, cursor: '2' });
  assert.equal((await tool('ArtifactData', { action: 'list', url, collection: 'notes', limit: 5000 })).error?.code, 'invalid_argument');
  const found = await tool('ArtifactData', { action: 'query', url, collection: 'notes', where: [{ field: 't', op: '==', value: 1 }], order_by: { field: 't', dir: 'desc' } });
  assert.deepEqual((seen.read as any).query, { where: [{ field: 't', op: '==', value: 1 }], orderBy: { field: 't', dir: 'desc' } });
  assert.equal(found.query, true);
  assert.equal((await tool('ArtifactData', { action: 'query', url })).error?.code, 'invalid_argument');
  // An older server: the query is not run and there is no sha256; the notes say so.
  const old = await tool('ArtifactData', { action: 'query', url, collection: 'old', where: [] });
  assert.equal((old.notes as string[]).length, 2);
  assert.match((old.notes as string[])[0]!, /does not run queries/);

  await tool('ArtifactData', { action: 'set', url, path: 'notes/a', data: { t: 2 }, if_match: SHA_A, ignored: 1 });
  assert.deepEqual(seen.write, { writes: [{ op: 'set', path: 'notes/a', data: { t: 2 }, if_match: SHA_A }], require_if_match: true });
  await tool('ArtifactData', { action: 'str_replace', url, collection: 'notes', doc_id: 'a', field: 'body', old: 'x', new: 'y' });
  assert.deepEqual(seen.write.writes, [{ op: 'str_replace', path: 'notes/a', field: 'body', old: 'x', new: 'y' }]);
  await tool('ArtifactData', { action: 'batch', url, writes: [{ op: 'update', path: 'notes/b', file_path: 'b.json' }] });
  assert.equal((seen.write as any).writes[0].file_path, join(workspace, 'b.json'));

  const conflict = await tool('ArtifactData', { action: 'set', url, path: 'notes/a', data: {}, if_match: SHA_STALE });
  assert.equal(conflict.error?.code, 'conflict');
  assert.equal((conflict.error as Record<string, unknown>).current, undefined);
  assert.deepEqual((conflict.current as Record<string, { data: unknown }>)['notes/a']!.data, { t: 1 });

  const saved = await tool('ArtifactData', { action: 'list', url, collection: 'notes', out_file: 'out/notes.json' });
  assert.equal(saved.out_file, join(workspace, 'out', 'notes.json'));
  assert.equal(saved.count, 1);
  assert.equal(saved.docs, undefined);
  assert.equal(JSON.parse(readFileSync(join(workspace, 'out', 'notes.json'), 'utf8')).docs.length, 1);
  const root = String((await tool('Artifact', { action: 'read', url })).root);
  assert.equal((await tool('ArtifactData', { action: 'get', url, path: 'notes/a', out_file: join(root, 'x.json') })).error?.code, 'bad_path');
});

test('ArtifactComments filters threads and keeps replies to the threads sent to the agent', async () => {
  const url = await createGreeter('Comments');
  assert.deepEqual(((await tool('ArtifactComments', { action: 'read', url })).threads as Array<{ id: string }>).map((t) => t.id), ['t1', 't2']);
  assert.deepEqual(((await tool('ArtifactComments', { action: 'read', url, thread_id: 't3' })).threads as Array<{ id: string }>).map((t) => t.id), ['t3']);
  assert.deepEqual(((await tool('ArtifactComments', { action: 'read', url, since: '2026-02-01T00:00:00Z' })).threads as Array<{ id: string }>).map((t) => t.id), ['t2']);
  assert.equal((await tool('ArtifactComments', { action: 'read', url, thread_id: 'nope' })).error?.code, 'not_found');
  assert.equal((await tool('ArtifactComments', { action: 'read', url, since: 'yesterday-ish' })).error?.code, 'invalid_argument');

  const notSent = await tool('ArtifactComments', { action: 'reply', url, thread_id: 't2', text: 'Hi' });
  assert.equal(notSent.replied, false);
  assert.match(String(notSent.note), /not sent to you/);
  assert.equal((await tool('ArtifactComments', { action: 'resolve', url, thread_id: 't2' })).changed, false);
  assert.equal(seen.replies.length, 0);

  const again = await tool('ArtifactComments', { action: 'reply', url, thread_id: 't1', text: '  Done. ' });
  assert.equal(again.error?.code, 'duplicate');
  assert.match(String(again.error?.fix), /acknowledge_duplicate/);
  const tooLong = await tool('ArtifactComments', { action: 'reply', url, thread_id: 't1', text: 'é'.repeat(2049) });
  assert.equal(tooLong.error?.code, 'invalid_argument');
  assert.equal(seen.replies.length, 0);

  assert.equal((await tool('ArtifactComments', { action: 'reply', url, thread_id: 't1', text: 'Done.', acknowledge_duplicate: true })).replied, true);
  assert.equal((await tool('ArtifactComments', { action: 'reply', url, thread_id: 't1', text: 'Shortened the title.', resolve: true })).replied, true);
  assert.deepEqual(seen.replies.at(-1), { thread_id: 't1', text: 'Shortened the title.', resolve: true });
  assert.equal((await tool('ArtifactComments', { action: 'resolve', url, thread_id: 't1' })).changed, true);
});

test('a long action answers with its task; its end comes to the caller as a task message', async () => {
  const url = await createGreeter('Long card');
  const id = artifactIdOf(url)!;
  const started = await tool('Artifact', { action: 'call', url, name: 'render' });
  assert.equal(started.error, undefined, JSON.stringify(started.error));
  assert.equal(started.task, `task_${id}`);
  assert.equal(started.pending, true);

  // A page write while the write action runs is the agent's doing.
  assert.equal((await typeApi('touch', { id, author: 'Ada', paths: ['card.png'] })).status, 200);
  assert.equal((await tool('Artifact', { action: 'read', url })).changed_files, undefined, 'page writes during the task are not the person\'s edits');

  const done = await typeApi('task', { task: `task_${id}`, done: true, result: { image: 'card.png' } });
  assert.equal(done.status, 200);
  await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  const next = await tool('Artifact', { action: 'list', query: 'long card' });
  const messages = (next.messages ?? []) as string[];
  const message = messages.find((m) => m.startsWith('[Artifact task finished]'));
  assert.ok(message, `a task message among ${JSON.stringify(messages)}`);
  assert.ok(message!.includes(`Artifact: ${url}`));
  assert.ok(message!.includes(`Task: task_${id} (render)`));
  assert.ok(message!.includes('"image": "card.png"'));

  // An end that comes before the start is known still reaches the caller; a failure carries its error.
  const early = await createGreeter('Early card');
  const earlyId = artifactIdOf(early)!;
  await typeApi('task', { task: `task_${earlyId}`, done: true, error: { code: 'failed', message: 'No ink.' } });
  const second = await tool('Artifact', { action: 'call', url: early, name: 'render' });
  await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  const failed = [...((second.messages ?? []) as string[]), ...(((await tool('Artifact', { action: 'list', query: 'early card' })).messages ?? []) as string[])];
  assert.ok(failed.some((m) => m.startsWith('[Artifact task finished]') && m.includes('No ink.')), JSON.stringify(failed));
});

test("page writes during a write action are the agent's; after it, the person's again", async () => {
  const url = await createGreeter('Restyled card');
  const id = artifactIdOf(url)!;
  await tool('Artifact', { action: 'read', url });
  const out = await tool('Artifact', { action: 'call', url, name: 'restyle' });
  assert.equal(out.restyled, true, JSON.stringify(out));
  assert.equal((await tool('Artifact', { action: 'read', url })).changed_files, undefined);

  // A read action opens no window.
  const other = await createGreeter('Greeted card');
  const otherId = artifactIdOf(other)!;
  await tool('Artifact', { action: 'call', url: other, name: 'greet', args: { name: 'Ada' } });
  await typeApi('touch', { id: otherId, author: 'Ada', paths: ['b.txt'] });
  assert.deepEqual((await tool('Artifact', { action: 'read', url: other })).changed_files, ['b.txt']);
  void id;
});

test('open on create: after_first_write needs an app that shows pages; a bad value is refused', async () => {
  const made = await tool('Artifact', { action: 'publish', type_url: 'open-artifact://type/greeter', title: 'Opened card', open: 'after_first_write' });
  assert.equal(made.error, undefined, JSON.stringify(made.error));
  assert.equal(made.open, undefined, 'no app here can show pages');
  assert.match(String(made.note), /cannot show pages/);
  assert.match(String(made.next), /then show it: open view_url in your app's built-in browser/);

  const bad = await tool('Artifact', { action: 'publish', type_url: 'open-artifact://type/greeter', title: 'Bad open', open: 'later' });
  assert.equal(bad.error?.code, 'invalid_argument');
});

test('quickstart lists related artifacts of the types the recommended one builds on', async () => {
  const newest = await createGreeter('Newest related card');
  const quick = await tool('Artifact', { action: 'quickstart', intent: 'greeting' });
  assert.deepEqual((quick.recommended as { uses: string[] }).uses, ['greeter'], 'malformed ids are left out');
  const related = quick.related as Array<{ url: string; type: string; mine: boolean }>;
  assert.ok(related.length > 0 && related.length <= 10);
  assert.equal(related[0]!.url, newest, 'newest first');
  assert.ok(related.every((a) => a.type === 'greeter' && a.mine));
  assert.match(String(quick.next), /related lists the person's artifacts/);

  const without = await tool('Artifact', { action: 'quickstart', intent: 'greeting', related: false });
  assert.equal(without.related, undefined);
  assert.equal((await tool('Artifact', { action: 'read', type_url: 'open-artifact://type/greeter' })).uses?.toString(), 'greeter');
});

test('sharing is the person\'s: share only reports, open shows its panel, publish leaves .sharing.json alone', async () => {
  const url = await createGreeter('Card to share');
  const change = await tool('Artifact', { action: 'share', url, lan: true });
  assert.equal(change.error?.code, 'not_granted');
  assert.match(String(change.error?.fix), /panel: "share"/);
  assert.equal((await tool('Artifact', { action: 'share', url, links: { viewer: true } })).error?.code, 'not_granted');
  assert.equal((await tool('Artifact', { action: 'share', url })).error?.code, 'unsupported', 'the greeter cannot share');

  const id = artifactIdOf(url)!;
  const shared = await tool('Artifact', { action: 'open', url, panel: 'share' });
  assert.equal(shared.error, undefined, JSON.stringify(shared.error));
  assert.equal(shared.view_url, `${state.url}/a/${id}?panel=share`);
  assert.equal(shared.opened, false, 'no app here shows pages');
  const exported = await tool('Artifact', { action: 'open', url, panel: 'export' });
  assert.equal(exported.view_url, `${state.url}/a/${id}?panel=export`);
  assert.equal(exported.note, undefined, 'the greeter declares an export format');
  assert.equal((await tool('Artifact', { action: 'open', url })).view_url, `${state.url}/a/${id}`);
  assert.equal((await tool('Artifact', { action: 'open', url, panel: 'comments' })).error?.code, 'invalid_argument');

  for (const path of ['.sharing.json', 'sub/.sharing.json']) {
    const wrote = await tool('Artifact', { action: 'publish', url, files: { [path]: '{"lan": true}' } });
    assert.equal(wrote.error?.code, 'bad_path', path);
  }
});
