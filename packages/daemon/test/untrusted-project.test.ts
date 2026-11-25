import { tempDir } from './helpers.ts';
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import {
  artifactIdOf,
  installedTypeCsp,
  LIBRARY_ROUTES,
  PAGE_CONTENT_NOTICE,
  RESTRICTED_FRAME_SANDBOX,
  UNTRUSTED_PROJECT_NOTICE,
  type DaemonState,
  type ToolCallResult,
  type TypeCheckResult,
  type TypesResponse,
} from '@open-artifact/protocol';
import { api, readDaemon } from '../src/client.ts';
import { BOOT_PLACEHOLDER, startDaemon, type Daemon } from '../src/daemon.ts';
import { files } from '../src/paths.ts';

/**
 * Restrictions follow trust, not scope: a type of a project the person has not trusted yet gets what an installed type
 * gets (the page policy, the sandbox on a static page's frame, the notice, no instruction to run its files, the notice
 * on what its page may have written), and trusting the project lifts all of it, a running frame-host restarted.
 */

const R = LIBRARY_ROUTES;
const project = tempDir('open-artifact-untrusted-project-');
const caller = { harness: 'dsh', session: 'untrusted-1', workspace: project };
const NETWORK = ['https://api.example.com'];

let daemon: Daemon;
let state: DaemonState;
const token = (): Record<string, string> => ({ Authorization: `Bearer ${state.token}` });

function call(method: string, port: number, path: string, o: { headers?: Record<string, string>; body?: unknown } = {}): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; text: string }> {
  return new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers: { Host: `127.0.0.1:${port}`, 'Content-Type': 'application/json', ...o.headers } }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (text += c));
      res.on('end', () => done({ status: res.statusCode ?? 0, headers: res.headers, text }));
    });
    req.on('error', fail);
    req.end(o.body === undefined ? undefined : JSON.stringify(o.body));
  });
}

async function tool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
  const r = await call('POST', daemon.port, '/api/open-artifact.tools.call', { headers: token(), body: { name, arguments: args, caller } });
  assert.equal(r.status, 200, r.text);
  return JSON.parse(r.text) as ToolCallResult;
}

const listed = async (id: string): Promise<Record<string, any>> =>
  (await api<TypesResponse>(state, R.types, undefined, { query: { workspace: project } })).types.find((t) => t.id === id) as Record<string, any>;

/** Opens the artifact (no browser): the port of the frame-host serving it, and its page's path there. */
async function framePage(url: string): Promise<{ port: number; path: string }> {
  const r = await call('POST', daemon.port, `/api/open-artifact.${R.open}`, { headers: token(), body: { id: artifactIdOf(url), host: false } });
  assert.equal(r.status, 200, r.text);
  const page = new URL(String((JSON.parse(r.text) as { page: string }).page));
  return { port: Number(page.port), path: page.pathname };
}

before(async () => {
  writeFileSync(files.settings(), JSON.stringify({ homeWorkspace: project }));
  const shellDir = tempDir('open-artifact-shell-');
  writeFileSync(join(shellDir, 'index.html'), `<!doctype html><title>shell</title><script>window.__OPEN_ARTIFACT_BOOT__ = ${BOOT_PLACEHOLDER};</script>`);
  daemon = await startDaemon({ port: 0, quiet: true, shellDir, homeDir: join(shellDir, 'no-home') });
  state = (await readDaemon())!;
  // A frame type (the data template) and a static type, both in the project's folder.
  await api(state, R.typesNew, { id: 'pf', scope: 'project', project, workspace: project, template: 'data' });
  const dir = join(project, '.agents', 'artifact-types', 'ps');
  mkdirSync(dir, { recursive: true });
  const manifest = { slug: 'ps', uid: '7c1a3e52-9d0b-4f6e-8a21-3b5c7d9e0f12', name: 'Plain', title: 'Plain', description: 'A plain page.', artifactTitle: 'Untitled plain', version: '1.0.0', skill: 'SKILL.md', intents: ['ps'], openArtifact: { network: NETWORK } };
  writeFileSync(join(dir, 'artifact-type.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>plain</title><p>plain</p>\n');
  writeFileSync(join(dir, 'SKILL.md'), '---\nname: ps\ndescription: A plain page.\n---\n\n# Plain\n\nWrite index.html.\n');
  // A type that points at another address: its page would come from there, without the policy.
  const remote = join(project, '.agents', 'artifact-types', 'pu');
  mkdirSync(remote, { recursive: true });
  writeFileSync(join(remote, 'artifact-type.json'), `${JSON.stringify({ ...manifest, slug: 'pu', uid: '0d4e6f81-2a3b-4c5d-9e7f-8a1b2c3d4e5f', entry: { url: 'https://types.example.com/{id}' } }, null, 2)}\n`);
  writeFileSync(join(remote, 'SKILL.md'), '---\nname: pu\ndescription: A remote page.\n---\n\n# Remote\n');
});

after(() => daemon.close());

describe('a type of a project not trusted yet', () => {
  let frameUrl: string;
  let staticUrl: string;

  test('is listed, made and read with the untrusted-project notice, and no instruction to run its files', async () => {
    const pf = await listed('pf');
    assert.equal(pf.source, 'local');
    assert.equal(pf.trusted, false);
    assert.equal(pf.notice, UNTRUSTED_PROJECT_NOTICE);
    const made = await tool('Artifact', { action: 'publish', type_url: 'open-artifact://type/pf', title: 'Untrusted frame' });
    assert.equal(made.error, undefined, JSON.stringify(made.error));
    frameUrl = String(made.url);
    assert.equal(made.source, 'local');
    assert.equal(made.third_party_notice, UNTRUSTED_PROJECT_NOTICE);
    assert.match(String(made.instructions), /project folder the person has not trusted yet/);
    assert.match(String(made.instructions), /Do not run any of its files/);
    assert.doesNotMatch(String(made.instructions), /"scripts\/\.\.\." means|as written works too/);
    const read = await tool('Artifact', { action: 'read', url: frameUrl });
    assert.equal(read.third_party_notice, `${UNTRUSTED_PROJECT_NOTICE} ${PAGE_CONTENT_NOTICE}`);
    const made2 = await tool('Artifact', { action: 'publish', type_url: 'open-artifact://type/ps', title: 'Untrusted static' });
    staticUrl = String(made2.url);
    assert.equal(made2.third_party_notice, UNTRUSTED_PROJECT_NOTICE);
  });

  test("what its page may have written (data, comments, a file) carries the page-content notice", async () => {
    const data = await tool('ArtifactData', { action: 'list', url: frameUrl, collection: 'notes' });
    assert.equal(data.error, undefined, JSON.stringify(data.error));
    assert.equal(data.third_party_notice, PAGE_CONTENT_NOTICE);
    const comments = await tool('ArtifactComments', { action: 'read', url: frameUrl });
    assert.equal(comments.error, undefined, JSON.stringify(comments.error));
    assert.equal(comments.third_party_notice, PAGE_CONTENT_NOTICE);
    assert.equal((await tool('Artifact', { action: 'publish', url: staticUrl, files: { 'index.html': '<p>hi</p>' } })).error, undefined);
    const one = await tool('Artifact', { action: 'read', url: staticUrl, path: 'index.html' });
    assert.equal(one.third_party_notice, PAGE_CONTENT_NOTICE);
  });

  test('its frame page gets the policy and the sandbox; its static page the policy, the sandbox and the Shell frame-src', async () => {
    const { port, path } = await framePage(frameUrl);
    const page = await call('GET', port, '/_f/x/', { headers: { Host: `${artifactIdOf(frameUrl)}.frame.localhost:${port}` } });
    assert.equal(page.status, 200);
    assert.equal(page.headers['content-security-policy'], installedTypeCsp([]));
    const session = JSON.parse((await call('GET', port, `${path}api/frame/session`)).text) as { sandbox?: string };
    assert.equal(session.sandbox, RESTRICTED_FRAME_SANDBOX);

    const sp = await call('GET', daemon.port, '/', { headers: { Host: `${artifactIdOf(staticUrl)}.frame.localhost:${daemon.port}` } });
    assert.equal(sp.status, 200);
    assert.equal(sp.headers['content-security-policy'], installedTypeCsp(NETWORK));
    const boot = JSON.parse((await call('GET', daemon.port, `/api/open-artifact.${R.boot}?id=${artifactIdOf(staticUrl)}`, { headers: token() })).text) as { sandbox?: string };
    assert.equal(boot.sandbox, RESTRICTED_FRAME_SANDBOX);
    const shell = await call('GET', daemon.port, `/a/${artifactIdOf(staticUrl)}`);
    assert.equal(shell.headers['content-security-policy'], `frame-src http://*.frame.localhost:${daemon.port}`);
  });

  test("a static page's address never serves a link to a file outside the type's or the artifact's folder", async () => {
    const outside = tempDir('open-artifact-outside-');
    writeFileSync(join(outside, 'secret.txt'), 'outside-secret');
    symlinkSync(join(outside, 'secret.txt'), join(project, '.agents', 'artifact-types', 'ps', 'leak.txt'));
    const root = String((await tool('Artifact', { action: 'read', url: staticUrl })).root);
    symlinkSync(join(outside, 'secret.txt'), join(root, 'leak.txt'));
    const host = { Host: `${artifactIdOf(staticUrl)}.frame.localhost:${daemon.port}` };
    for (const path of ['/leak.txt', '/_root/leak.txt']) {
      const r = await call('GET', daemon.port, path, { headers: host });
      assert.equal(r.status, 404, path);
      assert.equal(r.text.includes('outside-secret'), false, path);
    }
    assert.equal((await call('GET', daemon.port, '/_root/index.html', { headers: host })).status, 200, "the artifact's own file is served");
  });

  test('never points at another address (entry.url)', async () => {
    const pu = await listed('pu');
    assert.notEqual(pu.runtime, 'url');
    assert.notEqual(pu.remote, true);
    assert.ok((pu.problems as string[]).some((p) => /not trusted yet cannot point at an address/.test(p)), JSON.stringify(pu.problems));
  });

  test('types check warns what it is limited to until the project is trusted', async () => {
    const pf = await api<TypeCheckResult>(state, R.typesCheck, { id: 'pf', workspace: project });
    assert.ok(pf.warnings.some((w) => w.code === 'untrusted_restricted' && /reaches only its own origin and nothing else/.test(w.message)), JSON.stringify(pf.warnings));
    const ps = await api<TypeCheckResult>(state, R.typesCheck, { id: 'ps', workspace: project });
    assert.ok(ps.warnings.some((w) => w.code === 'untrusted_restricted' && w.message.includes('https://api.example.com')), JSON.stringify(ps.warnings));
  });

  test('trusting the project lifts all of it, and the running frame-host restarts without the policy', async () => {
    await api(state, R.typesTrust, { dir: project });
    const pf = await listed('pf');
    assert.equal(pf.trusted, true);
    assert.equal(pf.notice, undefined);
    const made = await tool('Artifact', { action: 'publish', type_url: 'open-artifact://type/pf', title: 'Trusted frame' });
    assert.equal(made.third_party_notice, undefined);
    assert.doesNotMatch(String(made.instructions), /Do not run any of its files/);
    assert.equal((await tool('Artifact', { action: 'read', url: frameUrl })).third_party_notice, undefined);
    assert.equal((await tool('ArtifactData', { action: 'list', url: frameUrl, collection: 'notes' })).third_party_notice, undefined);
    assert.equal((await tool('ArtifactComments', { action: 'read', url: frameUrl })).third_party_notice, undefined);

    const { port, path } = await framePage(frameUrl);
    const page = await call('GET', port, '/_f/x/', { headers: { Host: `${artifactIdOf(frameUrl)}.frame.localhost:${port}` } });
    assert.equal(page.status, 200);
    assert.equal(page.headers['content-security-policy'], undefined);
    assert.equal((JSON.parse((await call('GET', port, `${path}api/frame/session`)).text) as { sandbox?: string }).sandbox, undefined);

    const sp = await call('GET', daemon.port, '/', { headers: { Host: `${artifactIdOf(staticUrl)}.frame.localhost:${daemon.port}` } });
    assert.equal(sp.headers['content-security-policy'], undefined);
    const boot = JSON.parse((await call('GET', daemon.port, `/api/open-artifact.${R.boot}?id=${artifactIdOf(staticUrl)}`, { headers: token() })).text) as { sandbox?: string };
    assert.equal(boot.sandbox, undefined);
    assert.equal((await call('GET', daemon.port, `/a/${artifactIdOf(staticUrl)}`)).headers['content-security-policy'], undefined);
    const check = await api<TypeCheckResult>(state, R.typesCheck, { id: 'pf', workspace: project });
    assert.equal(check.warnings.some((w) => w.code === 'untrusted_restricted'), false);
    const pu = await listed('pu');
    assert.equal(pu.runtime, 'url');
    assert.equal((pu.problems as string[]).some((p) => /not trusted yet/.test(p)), false);
  });
});
