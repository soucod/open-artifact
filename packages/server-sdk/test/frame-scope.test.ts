/**
 * frame-host's bin, started as the daemon starts it: the Content-Security-Policy a restricted type's pages get
 * (`OPEN_ARTIFACT_TYPE_RESTRICTED=1`, for an installed type or one of a project not trusted yet, with the manifest's
 * `openArtifact.network`), none for a trusted type whatever its scope,
 * and the artifact's archive (`/__open-artifact/archive`) through the zip code the type server shares.
 */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { after, before, describe, it } from 'node:test';
import { installedTypeCsp } from '@open-artifact/protocol';
import { zipEntries } from '../src/zip.ts';

const BIN = join(import.meta.dirname, '..', 'bin', 'frame-host.ts');
const SECRET = 'scope-secret-0123456789';
const ID = 'art_scopetest01';
const NETWORK = ['https://fonts.example.com', 'https://cdn.example.org'];

function writeType(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'artifact-type.json'),
    JSON.stringify({ slug: 'scoped', name: 'Scoped', version: '1.0.0', description: 'test', uid: '0b6f0a52-3c1e-4c9e-9a51-6a8f0b0c2d11', openArtifact: { network: NETWORK } }),
  );
  writeFileSync(join(dir, 'index.html'), '<!doctype html><script>\n// artifact.json\nvar capabilities = { artifact: {} };\n\n// the page\n</script><p>scoped</p>\n');
}

function get(port: number, path: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }> {
  return new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port, path, headers: { Host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => done({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', fail);
    req.end();
  });
}

async function post(port: number, path: string, body: unknown): Promise<{ status: number; json: any }> {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
}

/** Starts the bin for `typeDir` with `scope` (restricted or not) and opens the artifact at `root`; its port. */
async function start(typeDir: string, root: string, scope: string | undefined, restricted: boolean, children: ChildProcess[]): Promise<number> {
  const env: Record<string, string | undefined> = { ...process.env, OPEN_ARTIFACT_PORT: '0', OPEN_ARTIFACT_TYPE: 'scoped', OPEN_ARTIFACT_SECRET: SECRET, OPEN_ARTIFACT_DAEMON_URL: '', OPEN_ARTIFACT_TYPE_TOKEN: '', OPEN_ARTIFACT_TYPE_DIR: typeDir };
  if (scope) env.OPEN_ARTIFACT_TYPE_SCOPE = scope;
  else delete env.OPEN_ARTIFACT_TYPE_SCOPE;
  env.OPEN_ARTIFACT_TYPE_RESTRICTED = restricted ? '1' : '0';
  const child = spawn(process.execPath, ['--no-warnings', BIN], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  const line = await new Promise<string>((resolve, reject) => {
    createInterface({ input: child.stdout! }).once('line', resolve);
    child.once('exit', (code) => reject(new Error(`exited with ${code}`)));
    setTimeout(() => reject(new Error('no ready line')), 10_000).unref();
  });
  const port = Number(new URL((JSON.parse(line) as { url: string }).url).port);
  const opened = await post(port, '/__open-artifact/open', { id: ID, root, title: 'Scoped' });
  assert.equal(opened.status, 200, JSON.stringify(opened.json));
  return port;
}

describe('frame-host: an installed type and one of this computer', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'open-artifact-frame-scope-'));
  const typeDir = join(tmp, 'type');
  const root = join(tmp, 'artifact');
  const children: ChildProcess[] = [];
  let installed: number;
  let local: number;
  let untrustedProject: number;
  let trustedProject: number;

  before(async () => {
    writeType(typeDir);
    mkdirSync(join(root, 'notes'), { recursive: true });
    writeFileSync(join(root, 'content.json'), '{"title":"x"}\n');
    writeFileSync(join(root, 'notes', 'a.txt'), 'a\n');
    writeFileSync(join(root, '.artifact.json'), JSON.stringify({ type: 'scoped', id: ID, typeUid: '0b6f0a52-3c1e-4c9e-9a51-6a8f0b0c2d11' }));
    writeFileSync(join(root, '.sharing.json'), '{}');
    installed = await start(typeDir, root, 'installed', true, children);
    local = await start(typeDir, root, 'user', false, children);
    untrustedProject = await start(typeDir, root, 'project', true, children);
    trustedProject = await start(typeDir, root, 'project', false, children);
  });

  after(() => {
    for (const child of children) child.kill('SIGTERM');
    rmSync(tmp, { recursive: true, force: true });
  });

  const content = (port: number, path: string) => get(port, path, { Host: `${ID}.frame.localhost:${port}` });

  it("an installed type's page document and its files carry the policy, with the manifest's network origins", async () => {
    const page = await content(installed, '/_f/x/');
    assert.equal(page.status, 200);
    const csp = String(page.headers['content-security-policy']);
    assert.equal(csp, installedTypeCsp(NETWORK));
    assert.match(csp, /connect-src 'self' data: blob: https:\/\/fonts\.example\.com https:\/\/cdn\.example\.org/);
    assert.match(csp, /script-src 'self' 'unsafe-inline'/);
    assert.doesNotMatch(csp, /\*/, 'no wildcard host');
    const file = await content(installed, '/_root/content.json');
    assert.equal(String(file.headers['content-security-policy']), csp);
  });

  it("a type of this computer's pages carry no policy, as before", async () => {
    const page = await content(local, '/_f/x/');
    assert.equal(page.status, 200);
    assert.equal(page.headers['content-security-policy'], undefined);
  });

  it('restriction follows trust, not scope: an untrusted project type gets the policy, a trusted one none', async () => {
    const untrusted = await content(untrustedProject, '/_f/x/');
    assert.equal(String(untrusted.headers['content-security-policy']), installedTypeCsp(NETWORK));
    const trusted = await content(trustedProject, '/_f/x/');
    assert.equal(trusted.status, 200);
    assert.equal(trusted.headers['content-security-policy'], undefined);
  });

  it('/__open-artifact/archive zips the artifact folder with the export rules, behind the secret', async () => {
    assert.equal((await get(installed, `/__open-artifact/archive?id=${ID}`)).status, 401);
    assert.equal((await get(installed, '/__open-artifact/archive?id=art_unknown0001', { authorization: `Bearer ${SECRET}` })).status, 404);
    const zip = await get(installed, `/__open-artifact/archive?id=${ID}`, { authorization: `Bearer ${SECRET}` });
    assert.equal(zip.status, 200);
    assert.equal(zip.headers['content-type'], 'application/zip');
    assert.match(String(zip.headers['content-disposition']), /attachment; filename="artifact-/);
    const names = zipEntries(zip.body).entries.map((e) => e.name).sort();
    assert.deepEqual(names, ['artifact/.artifact.json', 'artifact/content.json', 'artifact/notes/a.txt']);
  });
});
