/**
 * `open-artifact harness --stdio` (`stdio-bridge.ts`, design 11): JSON-RPC 2.0 lines on stdin/stdout.
 *
 * In process against the kit's fake daemon: the daemon's calls reach the host and its answers go back, events only
 * after `subscribe`, and the framing errors. End to end: the command starts a real daemon, says hello without the
 * token crossing stdio, registers the host's runtime, and after the daemon goes away starts it again and attaches the
 * host's sessions again.
 */

import { TEST_HOME, tempDir, until } from './helpers.ts';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { readDaemon, readRuntimesFile } from '@open-artifact/harness-kit';
import { RPC_ERRORS, rpcErrorCode } from '@open-artifact/protocol';
import { startFakeDaemon } from '@open-artifact/harness-kit/testing';
import { runStdioBridge } from '../src/stdio-bridge.ts';
import { makeRuntime } from './runtime-fixtures.ts';

const BIN = fileURLToPath(new URL('../src/bin/open-artifact.ts', import.meta.url));

type Message = { jsonrpc: '2.0'; id?: string | number | null; method?: string; params?: any; result?: any; error?: any };

/** A host's end of a bridge: send lines, read lines. */
function host(write: (line: string) => void) {
  const seen: Message[] = [];
  let next = 1;
  const take = (line: string): void => {
    if (line.trim()) seen.push(JSON.parse(line));
  };
  const find = (match: (m: Message) => boolean, timeoutMs = 10_000): Promise<Message> => until(() => seen.find(match), timeoutMs);
  return {
    seen,
    take,
    find,
    raw: write,
    notify: (method: string, params: unknown): void => write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`),
    answer: (id: string | number, result: unknown): void => write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`),
    async call(method: string, params: unknown = {}, timeoutMs = 20_000): Promise<Message> {
      const id = next++;
      write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      return find((m) => m.id === id && m.method === undefined, timeoutMs);
    },
  };
}

function lines(stream: NodeJS.ReadableStream, onLine: (line: string) => void): void {
  let buffer = '';
  stream.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    let at: number;
    while ((at = buffer.indexOf('\n')) >= 0) {
      onLine(buffer.slice(0, at));
      buffer = buffer.slice(at + 1);
    }
  });
}

test('in process: the daemon\'s calls reach the host, events follow subscribe, framing errors are answered', async () => {
  const home = tempDir('open-artifact-fake-home-');
  // A newer fake than this build, so the bridge never tries to replace it.
  const fake = await startFakeDaemon({ home, version: '999.0.0', features: ['hello.runtime', 'runtime.update'] });
  const input = new PassThrough();
  const output = new PassThrough();
  const logs: string[] = [];
  const h = host((line) => input.write(line));
  lines(output, h.take);
  const running = runStdioBridge({ harness: 'testhost', input, output, log: (line) => logs.push(line), daemon: { home, env: { ...process.env, OPEN_ARTIFACT_HOME: home } } });

  assert.equal((await h.call('tools.list')).error.data.code, 'unauthorized');
  h.raw('not json\n');
  assert.equal((await h.find((m) => m.id === null && !!m.error)).error.code, -32700);
  const wrongName = await h.call('hello', { harness: 'other' });
  assert.match(wrongName.error.message, /--harness testhost/);
  // The same JSON-RPC numbers as the WebSocket (harness-api.test.ts): invalid_argument is invalidParams.
  assert.equal(wrongName.error.data.code, 'invalid_argument');
  assert.equal(wrongName.error.code, RPC_ERRORS.invalidParams);
  assert.equal((await h.call('tools.list')).error.code, rpcErrorCode('unauthorized'));

  const hello = await h.call('hello', { caps: { wake: { mode: 'auto' } }, token: 'not sent on' });
  assert.equal(hello.result.daemon, '999.0.0');
  assert.deepEqual(hello.result.features, ['hello.runtime', 'runtime.update']);
  assert.equal(fake.hellos[0]?.token, fake.token, 'the bridge says the token from daemon.json');
  assert.ok(!JSON.stringify(h.seen).includes(fake.token), 'the token never crosses stdio');
  assert.ok(logs.some((l) => /carried a token; ignored/.test(l)));

  // No events before subscribe.
  fake.emit({ type: 'types/changed' });
  assert.deepEqual((await h.call('subscribe', { on: true })).result, { ok: true });
  fake.runtimeUpdate('1000.0.0');
  const event = await h.find((m) => m.method === 'event');
  assert.deepEqual(event.params, { type: 'runtime/update', current: '999.0.0', available: '1000.0.0', installed: false });
  assert.equal(h.seen.filter((m) => m.method === 'event').length, 1);

  // The daemon calls the host; the host answers.
  const attach = await h.call('session.attach', { session: 's1', workspace: '/w' });
  assert.equal(attach.result.key, 'testhost:s1');
  const delivered = fake.wake({ session: 's1', text: 'a comment' });
  const ask = await h.find((m) => m.method === 'wake.deliver');
  assert.equal(ask.id, 'd1');
  assert.equal(ask.params.text, 'a comment');
  h.answer(ask.id as string, { delivered: true });
  assert.deepEqual(await delivered, { delivered: true });

  // The host declared no `open`: host.open is not forwarded (the kit answers methodNotFound), and the host sees nothing.
  await assert.rejects(fake.open({ url: 'open-artifact://artifact/a1' }), /No handler for host.open/);
  assert.ok(!h.seen.some((m) => m.method === 'host.open'));

  // runtime.* pass through.
  assert.equal((await h.call('runtime.status')).result.running, '999.0.0');
  assert.equal((await h.call('no.such.method')).error.code, -32601);

  input.end();
  await running;
  await fake.close();
});

test('end to end: starts the daemon, registers the host runtime, reconnects and re-attaches after the daemon goes away', async (t) => {
  const runtimeDir = makeRuntime(tempDir('open-artifact-host-runtime-'), '0.0.1');
  const child: ChildProcess = spawn(process.execPath, [BIN, 'harness', '--stdio', '--harness', 'stdiohost'], { env: { ...process.env, OPEN_ARTIFACT_HOME: TEST_HOME }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr!.on('data', (chunk) => (stderr += chunk));
  const h = host((line) => child.stdin!.write(line));
  lines(child.stdout!, h.take);
  t.after(async () => {
    child.stdin!.end();
    const state = await readDaemon(TEST_HOME);
    if (state) process.kill(state.pid, 'SIGTERM');
  });

  const hello = await h.call('hello', { caps: { wake: { mode: 'auto' } }, runtime: { dir: runtimeDir, version: '0.0.1', update: 'bundled' } }, 30_000);
  assert.equal(hello.error, undefined, JSON.stringify(hello.error) + stderr);
  assert.equal(hello.result.protocol, 1);
  assert.ok(hello.result.features.includes('hello.runtime'));
  const daemonJson = JSON.parse(readFileSync(join(TEST_HOME, 'daemon.json'), 'utf8'));
  assert.ok(!JSON.stringify(h.seen).includes(daemonJson.token), 'the token never crosses stdio');
  const record = readRuntimesFile(TEST_HOME).runtimes.find((r) => r.harness === 'stdiohost');
  assert.deepEqual({ dir: record?.dir, version: record?.version, update: record?.update }, { dir: runtimeDir, version: '0.0.1', update: 'bundled' });

  assert.equal((await h.call('session.attach', { session: 'e2e', workspace: TEST_HOME })).result.key, 'stdiohost:e2e');
  const tools = (await h.call('tools.list')).result.tools.map((d: { name: string }) => d.name);
  assert.ok(tools.includes('Artifact'));
  const status = (await h.call('runtime.status')).result;
  assert.equal(status.running, daemonJson.version);
  assert.equal(status.policy.update, 'bundled');

  // The daemon goes away: the bridge says so, starts it again, and attaches the session again.
  process.kill(daemonJson.pid, 'SIGTERM');
  await h.find((m) => m.method === 'bridge.state' && m.params.state === 'disconnected', 15_000);
  const reattached = await h.find((m) => m.method === 'bridge.reattached', 40_000);
  assert.equal(reattached.params.params.session, 'e2e');
  assert.deepEqual(reattached.params.inbox, []);
  const again = await readDaemon(TEST_HOME);
  assert.ok(again && again.pid !== daemonJson.pid);
  assert.equal((await h.call('tools.list')).result.tools.length > 0, true);
  // Nothing but JSON-RPC on stdout.
  assert.ok(h.seen.every((m) => m.jsonrpc === '2.0'));
});
