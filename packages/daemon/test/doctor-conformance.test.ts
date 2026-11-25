/**
 * The conformance script (`doctor-conformance.ts`) and the remote-type checks (`doctor-remote.ts`), against an
 * in-process daemon and hosts made with the kit's `createHarness`:
 *  - a host that declares everything passes every step, gets one `host.open` and one wake, keeps its session, and
 *    nothing doctor made is left;
 *  - a host that declares nothing beyond tools gets `n/a` (with the reason) for open, wake, commands and rules;
 *  - a failing step fails, and cleanup still removes what was made; a session that is not attached fails the steps
 *    after it and makes nothing;
 *  - remote types: an answering one is ok with its actions listed, an unreachable one fails, a host with
 *    `embed.remote: deny` is warned with the fallback, and the type server never hears a token, a secret or a body.
 */

import { TEST_HOME, tempDir } from './helpers.ts';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { createHarness, type Harness, type OpenRequest } from '@open-artifact/harness-kit';
import type { DaemonState, WakeDeliverParams } from '@open-artifact/protocol';
import { readDaemon } from '../src/client.ts';
import { startDaemon, type Daemon } from '../src/daemon.ts';
import { doctorText, runDoctor, type DoctorReport } from '../src/doctor.ts';
import { CONFORMANCE_CHECKS, CONFORMANCE_STEPS, CONFORMANCE_TITLE } from '../src/doctor-conformance.ts';
import { REMOTE_CHECKS } from '../src/doctor-remote.ts';
import { templateBase } from '../src/servers.ts';

let daemon: Daemon;
let state: DaemonState;

before(async () => {
  daemon = await startDaemon({ port: 0, quiet: true, shellDir: tempDir('open-artifact-shell-'), homeDir: tempDir('open-artifact-no-home-') });
  state = (await readDaemon())!;
});

after(() => daemon.close());

const steps = (report: DoctorReport, step: string) => report.findings.filter((f) => f.id === `conformance.${step}`);
const verdict = (report: DoctorReport, step: string) => steps(report, step)[0]?.status;

/** Every artifact record doctor's test title names. */
const leftovers = () => daemon.store.list().filter((a) => a.title.startsWith(CONFORMANCE_TITLE));

test('a host that declares everything passes every step, and doctor leaves nothing behind', async () => {
  const opened: OpenRequest[] = [];
  const woken: WakeDeliverParams[] = [];
  const host: Harness = await createHarness({
    harness: 'fullapp',
    home: TEST_HOME,
    autoStart: false,
    agentName: 'Fully',
    commands: ['artifact'],
    rules: 'Never publish without asking the person in this app.',
    policy: { roles: { subagent: { create: false } } },
    embed: { origins: ['http://127.0.0.1:1'], mode: 'frame' },
    caps: { wake: { resume: true }, tools: 'native', library: 'own' },
    open: (request) => void opened.push(request),
    wake: (params) => (woken.push(params), 'delivered'),
  });
  try {
    const workspace = tempDir('open-artifact-ws-');
    await host.attach({ session: 'full-1', workspace });
    const report = await runDoctor({ checks: CONFORMANCE_CHECKS, harness: 'fullapp', session: 'full-1' });
    const text = doctorText(report);
    assert.equal(report.ok, true, text);
    assert.equal(report.session, 'full-1');
    assert.deepEqual([...new Set(report.findings.map((f) => f.id))], CONFORMANCE_STEPS.map((s) => `conformance.${s}`), 'every step reports, in order');
    for (const step of CONFORMANCE_STEPS) assert.equal(verdict(report, step), 'ok', `${step}\n${text}`);
    assert.match(steps(report, 'tools')[0]!.message, /owned by full-1/);
    assert.match(steps(report, 'rules').map((f) => f.message).join('\n'), /subagent session may not create \(not_granted\)/);
    // What needs a person or a browser is n/a with the reason, never ok.
    assert.ok(steps(report, 'open').some((f) => f.status === 'n/a' && /real browser/.test(f.fix ?? '')));
    assert.ok(steps(report, 'wake').some((f) => f.status === 'n/a' && /other than the owner/.test(f.message)));
    for (const f of report.findings) assert.ok(!f.message.includes('\n') && !(f.fix ?? '').includes('\n'), 'one line each');
    assert.equal(report.counts['n/a'], report.findings.filter((f) => f.status === 'n/a').length);
    assert.match(text, /n\/a  /);

    assert.equal(opened.length, 1, 'one host.open');
    assert.equal(woken.length, 1, 'one wake');
    assert.equal(woken[0]!.session, 'full-1');
    assert.equal(woken[0]!.source?.from?.kind, 'owner');
    assert.equal(leftovers().length, 0, 'the test artifact is gone');
    // The host keeps its session: doctor never attached it.
    const sessions = (await (await fetch(`${state.url}/api/open-artifact.harnesses`, { headers: { Authorization: `Bearer ${state.token}` } })).json()) as { sessions: Array<{ session: string; live: boolean }>; adapters: Array<{ harness: string; sessions: string[] }> };
    assert.equal(sessions.sessions.find((s) => s.session === 'full-1')?.live, true);
    assert.equal(sessions.adapters.filter((a) => a.harness === 'fullapp').length, 1, 'doctor\'s own connection is closed');
    const folder = /removed .*?(\/\S*open-artifact-doctor-\S+)/.exec(steps(report, 'cleanup')[0]!.message)?.[1];
    assert.ok(folder && !existsSync(folder), `the temporary folder is gone: ${steps(report, 'cleanup')[0]!.message}`);
  } finally {
    host.close();
  }
});

test('a host that declares only tools: open, wake, commands and rules are n/a with the reason', async () => {
  const host = await createHarness({ harness: 'bareapp', home: TEST_HOME, autoStart: false, caps: { tools: 'cli' } });
  try {
    await host.attach({ session: 'bare-1', workspace: tempDir('open-artifact-ws-') });
    const report = await runDoctor({ checks: CONFORMANCE_CHECKS, harness: 'bareapp', session: 'bare-1' });
    assert.equal(report.ok, true, doctorText(report));
    for (const step of ['open', 'wake', 'commands', 'rules']) {
      assert.deepEqual(steps(report, step).map((f) => f.status), ['n/a'], step);
      assert.ok(steps(report, step)[0]!.fix, `${step} says why`);
    }
    for (const step of ['discovery', 'session', 'tools', 'context', 'registration', 'cleanup']) assert.equal(verdict(report, step), 'ok', step);
    assert.equal(leftovers().length, 0);
  } finally {
    host.close();
  }
});

test('a failing step fails and cleanup still removes the test artifact; a missing session makes nothing', async () => {
  const host = await createHarness({ harness: 'badwake', home: TEST_HOME, autoStart: false, caps: { wake: { resume: true } }, wake: () => 'failed' });
  try {
    await host.attach({ session: 'bad-1', workspace: tempDir('open-artifact-ws-') });
    const report = await runDoctor({ checks: CONFORMANCE_CHECKS, harness: 'badwake', session: 'bad-1' });
    assert.equal(report.ok, false, doctorText(report));
    assert.equal(verdict(report, 'wake'), 'fail');
    assert.ok(steps(report, 'wake')[0]!.fix);
    assert.equal(verdict(report, 'cleanup'), 'ok');
    assert.equal(leftovers().length, 0);

    const missing = await runDoctor({ checks: CONFORMANCE_CHECKS, harness: 'badwake', session: 'nobody' });
    assert.equal(verdict(missing, 'session'), 'fail');
    assert.match(steps(missing, 'tools')[0]!.message, /not run \(session nobody is not attached\)/);
    assert.match(steps(missing, 'cleanup')[0]!.message, /nothing was made/);

    const noHarness = await runDoctor({ checks: CONFORMANCE_CHECKS, session: 'bad-1' });
    assert.equal(verdict(noHarness, 'discovery'), 'fail');
    assert.match(steps(noHarness, 'discovery')[0]!.fix ?? '', /--harness <name> --session <id>/);

    const notAsked = await runDoctor({ checks: CONFORMANCE_CHECKS, harness: 'badwake' });
    assert.equal(notAsked.findings.length, 0, 'without --session the steps do not run');
  } finally {
    host.close();
  }
});

test('remote types: reachable, actions listed, deny warned with the fallback, unreachable failed, nothing sent', async () => {
  const got: Array<{ method: string; path: string; auth: string | undefined; body: string }> = [];
  const stub: Server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const path = new URL(req.url ?? '/', 'http://x').pathname;
      got.push({ method: req.method ?? '', path, auth: req.headers.authorization, body });
      if (path === '/r/__open-artifact/health') return void res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"openArtifact":1}');
      if (path === '/r/__open-artifact/actions') return void res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"actions":[{"name":"stamp","title":"Stamp","effect":"read"}]}');
      res.writeHead(404).end();
    });
  });
  await new Promise<void>((done) => stub.listen(0, '127.0.0.1', done));
  const port = (stub.address() as { port: number }).port;
  // A port nothing listens on.
  const closed = createServer();
  await new Promise<void>((done) => closed.listen(0, '127.0.0.1', done));
  const downPort = (closed.address() as { port: number }).port;
  await new Promise<void>((done) => closed.close(() => done()));

  const types = process.env.OPEN_ARTIFACT_USER_TYPES!;
  const add = (id: string, entry: unknown) => {
    mkdirSync(join(types, id), { recursive: true });
    writeFileSync(join(types, id, 'artifact-type.json'), JSON.stringify({ name: id, description: `${id} remote`, entry }));
  };
  add('farfar', { url: `http://0.0.0.0:${port}/r/{id}`, open: true, actions: true });
  add('gonegone', { url: `http://0.0.0.0:${downPort}/g/{id}`, open: true });
  const host = await createHarness({ harness: 'denyapp', home: TEST_HOME, autoStart: false, embed: { origins: ['http://127.0.0.1:2'], remote: 'deny' }, open: () => true });
  try {
    await host.ready();
    const report = await runDoctor({ checks: REMOTE_CHECKS, harness: 'denyapp' });
    const lines = report.findings.map((f) => `${f.status} ${f.message}`);
    assert.ok(lines.some((l) => /^ok Remote type farfar \(http:\/\/0\.0\.0\.0:\d+\) answers/.test(l)), lines.join('\n'));
    assert.ok(lines.some((l) => /^ok Remote type farfar: \/r\/__open-artifact\/actions lists 1 action$/.test(l)), lines.join('\n'));
    assert.ok(lines.some((l) => /^fail Remote type gonegone .* could not be reached/.test(l)), lines.join('\n'));
    const deny = report.findings.find((f) => f.status === 'warn' && /farfar/.test(f.message));
    assert.match(deny?.message ?? '', /embed\.remote deny.*they open in the link/);
    assert.equal(report.ok, false);
    assert.ok(got.length >= 2);
    for (const request of got) {
      assert.equal(request.method, 'GET');
      assert.equal(request.auth, undefined, 'no token or secret');
      assert.equal(request.body, '', 'no body');
    }

    const allowed = await runDoctor({ checks: REMOTE_CHECKS });
    assert.ok(!allowed.findings.some((f) => /embed\.remote/.test(f.message)), 'no host asked: no host line');
  } finally {
    host.close();
    rmSync(join(types, 'farfar'), { recursive: true, force: true });
    rmSync(join(types, 'gonegone'), { recursive: true, force: true });
    stub.close();
  }
  const none = await runDoctor({ checks: REMOTE_CHECKS });
  assert.deepEqual(none.findings.map((f) => f.message), ['Remote types: none turned on']);
});

test('templateBase reads a URL template the way the daemon does', () => {
  assert.equal(templateBase('http://0.0.0.0:9/r/{id}'), 'http://0.0.0.0:9/r/');
  assert.equal(templateBase('https://types.example.com/app'), 'https://types.example.com/app/');
});
