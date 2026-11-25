import { tempDir } from './helpers.ts';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import { dirname, join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { artifactIdOf, installedTypeCsp, LIBRARY_ROUTES, PAGE_CONTENT_NOTICE, THIRD_PARTY_NOTICE, type DaemonState, type ToolCallResult } from '@open-artifact/protocol';
import { zipEntries } from '@open-artifact/server-sdk/zip';
import { rawZip } from '../../server-sdk/test/zip-builder.ts';
import { readDaemon } from '../src/client.ts';
import { BOOT_PLACEHOLDER, startDaemon, type Daemon } from '../src/daemon.ts';
import { files } from '../src/paths.ts';
import { loadSettings } from '../src/settings.ts';
import { starterFiles } from '../src/type-authoring.ts';
import { fetchTypePackage, packType, readTypePackage, typeMismatch } from '../src/type-packages.ts';
import { TypeRegistry } from '../src/types.ts';

/**
 * Type packages end to end through the daemon: `types pack`, the preview and install routes (and the sha256 they
 * record), `--as`, a built-in id, another type of the same id, update, uninstall; the trust split (an installed type
 * never starts a program, even when its folder is changed after the install); the typeUid rules on open and write;
 * `source` and the notice in tool results; the policy on an installed static type's page; a static type's archive and
 * `artifacts.import`; the routes' refusals; and `fetchTypePackage`'s rules.
 */

const R = LIBRARY_ROUTES;
const userTypes = process.env.OPEN_ARTIFACT_USER_TYPES!;
const installedRoot = process.env.OPEN_ARTIFACT_INSTALLED_TYPES!;
const workspace = tempDir('open-artifact-pkg-ws-');
const author = tempDir('open-artifact-pkg-author-');
const out = tempDir('open-artifact-pkg-out-');
const caller = { harness: 'dsh', session: 'pkg-1', workspace };
const KIT_UID = randomUUID();
const NETWORK = ['https://api.example.com'];

let daemon: Daemon;
let state: DaemonState;

const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const token = (): Record<string, string> => ({ Authorization: `Bearer ${state.token}` });

/** Writes a frame type (the `types new` page starter) at `dir`, with `version` and `network`. */
function writeFrameType(dir: string, o: { id: string; uid: string; version?: string; network?: string[] }): void {
  rmSync(dir, { recursive: true, force: true });
  for (const [path, text] of Object.entries(starterFiles({ id: o.id, uid: o.uid, name: `Kit ${o.id}`, template: 'page' }))) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  const manifest = JSON.parse(readFileSync(join(dir, 'artifact-type.json'), 'utf8')) as Record<string, unknown>;
  manifest.version = o.version ?? '0.1.0';
  if (o.network) manifest.openArtifact = { network: o.network };
  writeFileSync(join(dir, 'artifact-type.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Writes a static type (an index.html without a declaration) at `dir`. */
function writeStaticType(dir: string, o: { id: string; uid: string; network?: string[] }): void {
  mkdirSync(dir, { recursive: true });
  const manifest = { slug: o.id, uid: o.uid, name: `Plain ${o.id}`, title: `Plain ${o.id}`, description: 'A plain page.', artifactTitle: 'Untitled plain', version: '1.0.0', skill: 'SKILL.md', intents: [o.id], engines: { openArtifact: '>=1' }, ...(o.network ? { openArtifact: { network: o.network } } : {}) };
  writeFileSync(join(dir, 'artifact-type.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>plain</title><p>plain</p>\n');
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${o.id}\ndescription: A plain page.\n---\n\n# Plain ${o.id}\n\nWrite index.html.\n`);
}

function pack(dir: string, into = out) {
  const settings = loadSettings();
  return packType(dir, { settings, registry: new TypeRegistry(() => settings), workspace: null, out: into });
}

/** A POST to a Library route: JSON, or bytes as `application/octet-stream`. */
function post(name: string, body: unknown, o: { headers?: Record<string, string>; query?: string; bytes?: Uint8Array; type?: string } = {}): Promise<{ status: number; body: Record<string, any> }> {
  return new Promise((done, fail) => {
    const payload = o.bytes ? Buffer.from(o.bytes) : Buffer.from(JSON.stringify(body));
    const req = request(
      {
        host: '127.0.0.1',
        port: daemon.port,
        path: `/api/open-artifact.${name}${o.query ? `?${o.query}` : ''}`,
        method: 'POST',
        headers: { 'Content-Type': o.type ?? (o.bytes ? 'application/octet-stream' : 'application/json'), Host: `127.0.0.1:${daemon.port}`, ...o.headers },
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (text += c));
        res.on('end', () => {
          let parsed: Record<string, any> = {};
          try {
            parsed = JSON.parse(text) as Record<string, any>;
          } catch {
            parsed = { text };
          }
          done({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on('error', fail);
    req.end(payload);
  });
}

/** A GET to the daemon (or any port) with a Host header of its own. */
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

async function tool(args: Record<string, unknown>): Promise<ToolCallResult> {
  const r = await post('tools.call', { name: 'Artifact', arguments: args, caller }, { headers: token() });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body as ToolCallResult;
}

/** Preview then install the package file `file` (`as` optional), as the command line does. */
async function install(file: string, as?: string): Promise<Record<string, any>> {
  const query = `name=${encodeURIComponent(file)}${as ? `&as=${as}` : ''}`;
  const preview = await post(R.typesPreview, null, { bytes: readFileSync(file), query, headers: token() });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  const done = await post(R.typesInstall, { sha256: preview.body.sha256, ...(as ? { as } : {}) }, { headers: token() });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  return done.body;
}

async function listTypes(): Promise<Array<Record<string, any>>> {
  const r = await get(daemon.port, `/api/open-artifact.${R.types}`, token());
  return (JSON.parse(r.body.toString('utf8')) as { types: Array<Record<string, any>> }).types;
}

const marker = (root: string): Record<string, any> => JSON.parse(readFileSync(join(root, '.artifact.json'), 'utf8')) as Record<string, any>;
const leftovers = (): string[] => readdirSync(installedRoot).filter((n) => n.startsWith('.'));

before(async () => {
  writeFileSync(files.settings(), JSON.stringify({ homeWorkspace: workspace }));
  const shellDir = tempDir('open-artifact-shell-');
  writeFileSync(join(shellDir, 'index.html'), `<!doctype html><title>shell</title><script>window.__OPEN_ARTIFACT_BOOT__ = ${BOOT_PLACEHOLDER};</script>`);
  daemon = await startDaemon({ port: 0, quiet: true, shellDir, homeDir: join(shellDir, 'no-home') });
  state = (await readDaemon())!;
});

after(() => daemon.close());

describe('pack, install, --as, update, uninstall', () => {
  const kitDir = join(author, 'kit');
  let kitFile: string;

  test('pack, then preview and install through the routes: the sha256 is of the bytes, and recorded', async () => {
    writeFrameType(kitDir, { id: 'kit', uid: KIT_UID, network: NETWORK });
    const packed = await pack(kitDir);
    kitFile = packed.file;
    assert.equal(packed.file, join(out, 'kit-0.1.0.oatype'));
    const bytes = readFileSync(kitFile);
    assert.equal(packed.sha256, sha(bytes));

    const preview = await post(R.typesPreview, null, { bytes, query: `name=${encodeURIComponent(kitFile)}`, headers: token() });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(preview.body.sha256, packed.sha256);
    assert.equal(preview.body.id, 'kit');
    assert.equal(preview.body.uid, KIT_UID);
    assert.deepEqual(preview.body.capabilities, ['artifact', 'downloads']);
    assert.deepEqual(preview.body.network, NETWORK);
    assert.equal(preview.body.skill.text, readFileSync(join(kitDir, 'SKILL.md'), 'utf8'), 'the SKILL.md in full');
    assert.equal(existsSync(join(installedRoot, 'kit')), false, 'a preview installs nothing');

    const done = await post(R.typesInstall, { sha256: preview.body.sha256 }, { headers: token() });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.sha256, packed.sha256);
    assert.equal(done.body.source, kitFile);
    const index = JSON.parse(readFileSync(files.typesIndex(), 'utf8')) as { types: Record<string, any> };
    assert.equal(index.types.kit.sha256, packed.sha256);
    assert.equal(index.types.kit.uid, KIT_UID);
    assert.equal(index.types.kit.version, '0.1.0');
    assert.equal(readFileSync(join(installedRoot, 'kit', 'SKILL.md'), 'utf8'), readFileSync(join(kitDir, 'SKILL.md'), 'utf8'));
    assert.deepEqual(leftovers(), []);

    const listed = (await listTypes()).find((t) => t.id === 'kit')!;
    assert.equal(listed.source, 'installed');
    assert.equal(listed.installedFrom, kitFile);
    assert.deepEqual(listed.network, NETWORK);
    assert.deepEqual(listed.capabilities, ['artifact', 'downloads']);
    assert.equal(listed.notice, THIRD_PARTY_NOTICE);

    // The bytes the preview kept are installed once.
    assert.equal((await post(R.typesInstall, { sha256: preview.body.sha256 }, { headers: token() })).status, 404);
  });

  test('an installed type never takes a built-in id, with --as or by its slug', async () => {
    await assert.rejects(readTypePackage(readFileSync(kitFile), kitFile, { as: 'slides' }), /built-in type's id/);
    const r = await post(R.typesPreview, null, { bytes: readFileSync(kitFile), query: 'name=kit.oatype&as=slides', headers: token() });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /built-in/);
    const slidesDir = join(tempDir('open-artifact-pkg-slides-'), 'slides');
    writeFrameType(slidesDir, { id: 'slides', uid: randomUUID() });
    const bytes = rawZip(
      readdirSync(slidesDir, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => {
          const path = join(e.parentPath, e.name);
          return { name: `slides/${path.slice(slidesDir.length + 1)}`, data: readFileSync(path) };
        }),
    );
    await assert.rejects(readTypePackage(bytes, 'slides.oatype'), /built-in type's id/);
  });

  test('another type of the same id is refused without --as, and installs with it', async () => {
    const otherDir = join(tempDir('open-artifact-pkg-other-'), 'kit');
    const otherUid = randomUUID();
    writeFrameType(otherDir, { id: 'kit', uid: otherUid });
    const packed = await pack(otherDir, join(out, 'other-kit.oatype'));
    const refused = await post(R.typesPreview, null, { bytes: readFileSync(packed.file), query: 'name=other-kit.oatype', headers: token() });
    assert.equal(refused.status, 409, JSON.stringify(refused.body));
    assert.match(refused.body.message, new RegExp(`uid ${KIT_UID}`));
    assert.match(refused.body.fix, /--as <id>/);
    const done = await install(packed.file, 'kit-b');
    assert.equal(done.id, 'kit-b');
    assert.equal(done.uid, otherUid);
    assert.equal(JSON.parse(readFileSync(join(installedRoot, 'kit-b', 'artifact-type.json'), 'utf8')).uid, otherUid);
    assert.equal(JSON.parse(readFileSync(join(installedRoot, 'kit', 'artifact-type.json'), 'utf8')).uid, KIT_UID, 'the first is untouched');
  });

  test('create, read and quickstart say where the type comes from, with the notice for an installed one', async () => {
    const made = await tool({ action: 'publish', type_url: 'open-artifact://type/kit', title: 'From a package' });
    assert.equal(made.error, undefined, JSON.stringify(made.error));
    assert.equal(made.source, 'installed');
    assert.equal(made.third_party_notice, THIRD_PARTY_NOTICE);
    assert.match(String(made.instructions), /Do not run any of its files, its scripts included, with node or a shell/);
    assert.doesNotMatch(String(made.instructions), /"scripts\/\.\.\." means|as written works too/);
    const read = await tool({ action: 'read', url: made.url });
    assert.equal(read.source, 'installed');
    assert.equal(read.installed_from, kitFile);
    // A read returns what the page may have written too: the type's notice, then the one for page content.
    assert.equal(read.third_party_notice, `${THIRD_PARTY_NOTICE} ${PAGE_CONTENT_NOTICE}`);
    const readType = await tool({ action: 'read', type_url: 'open-artifact://type/kit' });
    assert.equal(readType.source, 'installed');
    assert.equal(readType.third_party_notice, THIRD_PARTY_NOTICE);
    const m = marker(String(made.root));
    assert.equal(m.typeUid, KIT_UID);
    assert.equal(m.typeSource, 'kit-0.1.0.oatype', 'the name of the package file, never its path here');

    const quick = await tool({ action: 'quickstart', intent: 'kit' });
    const listed = JSON.stringify(quick);
    assert.match(listed, /"source":"installed"/);
    assert.ok(listed.includes(JSON.stringify(THIRD_PARTY_NOTICE)), 'quickstart carries the notice');
    assert.ok(listed.includes(`"installed_from":${JSON.stringify(kitFile)}`));

    const builtin = await tool({ action: 'publish', type_url: 'open-artifact://type/slides', title: 'Built in' });
    assert.equal(builtin.source, 'builtin');
    assert.equal(builtin.third_party_notice, undefined);
  });

  test("the daemon starts an installed frame type's server with its scope: its page carries the policy", async () => {
    const made = await tool({ action: 'publish', type_url: 'open-artifact://type/kit', title: 'Policy' });
    const opened = await post(R.open, { id: artifactIdOf(String(made.url)), host: false }, { headers: token() });
    assert.equal(opened.status, 200, JSON.stringify(opened.body));
    // The page frame-host serves on the artifact's own origin (`<id>.frame.localhost`), not its outer page.
    const port = Number(new URL(String(opened.body.page)).port);
    const res = await get(port, '/_f/x/', { Host: `${artifactIdOf(String(made.url))}.frame.localhost:${port}` });
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-security-policy'], installedTypeCsp(NETWORK));
  });

  test('an installed type never starts a program: its folder changed after the install to add entry.start is not run', async () => {
    const made = await tool({ action: 'publish', type_url: 'open-artifact://type/kit-b', title: 'Tampered' });
    assert.equal(made.error, undefined, JSON.stringify(made.error));
    const ran = join(tempDir('open-artifact-pkg-ran-'), 'ran');
    const manifestFile = join(installedRoot, 'kit-b', 'artifact-type.json');
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as Record<string, unknown>;
    manifest.entry = { start: { command: process.execPath, args: ['-e', `require('fs').writeFileSync(${JSON.stringify(ran)}, 'ran')`] }, open: true };
    writeFileSync(manifestFile, JSON.stringify(manifest));
    const opened = await post(R.open, { id: artifactIdOf(String(made.url)), host: false }, { headers: token() });
    // The registry gives an installed type no entry of its own (types.ts); servers.ts refuses entry.start of an
    // untrusted root again, for any root that is not trusted.
    assert.equal(opened.status, 400, JSON.stringify(opened.body));
    assert.equal(opened.body.code, 'type_not_runnable');
    assert.match(opened.body.message, /installed type cannot start a program/);
    const listed = (await listTypes()).find((t) => t.id === 'kit-b')!;
    assert.equal(listed.runnable, false);
    await new Promise((done) => setTimeout(done, 300));
    assert.equal(existsSync(ran), false, 'nothing ran');
    writeFileSync(manifestFile, JSON.stringify({ ...manifest, entry: undefined }));
  });

  test('a package installs as plain files: an execute bit in it is dropped', async () => {
    const dir = join(tempDir('open-artifact-pkg-exec-'), 'kit-exec');
    writeFrameType(dir, { id: 'kit-exec', uid: randomUUID() });
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    writeFileSync(join(dir, 'scripts', 'run.sh'), '#!/bin/sh\necho ran\n');
    const bytes = rawZip(
      readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => {
          const path = join(e.parentPath, e.name);
          const rel = path.slice(dir.length + 1);
          // Every file executable in the package, as a zip made on another computer may say.
          return { name: `kit-exec/${rel}`, data: readFileSync(path), mode: 0o100755 };
        }),
    );
    const file = join(out, 'kit-exec.oatype');
    writeFileSync(file, bytes);
    await install(file);
    const installed = join(installedRoot, 'kit-exec');
    const modes = readdirSync(installed, { recursive: true, withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => [join(e.parentPath, e.name).slice(installed.length + 1), (statSync(join(e.parentPath, e.name)).mode & 0o777).toString(8)]);
    assert.ok(modes.some(([rel]) => rel === join('scripts', 'run.sh')));
    for (const [rel, mode] of modes) assert.equal(mode, '644', `${rel} is ${mode}`);
  });

  test('update reads the recorded source again, previews, then installs those bytes', async () => {
    writeFrameType(kitDir, { id: 'kit', uid: KIT_UID, version: '0.2.0', network: NETWORK });
    const repacked = await pack(kitDir, kitFile);
    const preview = await post(R.typesUpdate, { id: 'kit' }, { headers: token() });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.equal(preview.body.version, '0.2.0');
    assert.equal(preview.body.replaces.version, '0.1.0');
    assert.equal(preview.body.sha256, repacked.sha256);
    const done = await post(R.typesUpdate, { id: 'kit', sha256: preview.body.sha256 }, { headers: token() });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.version, '0.2.0');
    assert.equal(done.body.replaced, true);
    assert.equal(JSON.parse(readFileSync(files.typesIndex(), 'utf8')).types.kit.sha256, repacked.sha256);
    assert.deepEqual(leftovers(), []);

    // The source now holds another type: not installed over this one.
    writeFrameType(kitDir, { id: 'kit', uid: randomUUID(), version: '0.3.0' });
    await pack(kitDir, kitFile);
    const other = await post(R.typesUpdate, { id: 'kit' }, { headers: token() });
    assert.equal(other.status, 409, JSON.stringify(other.body));
    assert.equal(JSON.parse(readFileSync(join(installedRoot, 'kit', 'artifact-type.json'), 'utf8')).version, '0.2.0');
    writeFrameType(kitDir, { id: 'kit', uid: KIT_UID, version: '0.2.0', network: NETWORK });
    await pack(kitDir, kitFile);
  });

  test('uninstall removes the folder and its entry; its artifacts stay; a local or built-in type is not uninstalled', async () => {
    const before = (await tool({ action: 'list' })) as unknown as { artifacts?: unknown[] };
    const r = await post(R.typesUninstall, { id: 'kit-b' }, { headers: token() });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(existsSync(join(installedRoot, 'kit-b')), false);
    assert.equal(JSON.parse(readFileSync(files.typesIndex(), 'utf8')).types['kit-b'], undefined);
    assert.equal((await listTypes()).some((t) => t.id === 'kit-b'), false);
    const after = (await tool({ action: 'list' })) as unknown as { artifacts?: unknown[] };
    assert.equal(JSON.stringify(after.artifacts?.length), JSON.stringify(before.artifacts?.length), 'artifacts stay');
    assert.equal((await post(R.typesUninstall, { id: 'slides' }, { headers: token() })).status, 404);
    assert.equal((await post(R.typesUninstall, { id: '../kit' }, { headers: token() })).status, 400);
    assert.deepEqual(leftovers(), []);
  });
});

describe('typeUid', () => {
  const record = (typeUid?: string) => ({ id: 'art_x', title: 'X', type: 'kit', ...(typeUid ? { typeUid } : {}) });
  const type = (uid: string | null) => ({ id: 'kit', uid, scope: 'installed' as const, dir: '/types/kit' });

  test('the three rules: no uid recorded is not checked; the same uid opens; another uid (or none) is type_mismatch', () => {
    assert.equal(typeMismatch(record(), type('u-1') as never), null);
    assert.equal(typeMismatch(record('u-1'), type('u-1') as never), null);
    assert.equal(typeMismatch(record('u-1'), type('u-2') as never)?.code, 'type_mismatch');
    assert.equal(typeMismatch(record('u-1'), type(null) as never)?.code, 'type_mismatch');
  });

  test('a local type of the same id and another uid neither opens nor writes an artifact made with the installed one', async () => {
    const made = await tool({ action: 'publish', type_url: 'open-artifact://type/kit', title: 'Uid' });
    const id = artifactIdOf(String(made.url));
    const shadow = join(userTypes, 'kit');
    writeFrameType(shadow, { id: 'kit', uid: randomUUID() });
    try {
      const opened = await post(R.open, { id, host: false }, { headers: token() });
      assert.equal(opened.status, 400, JSON.stringify(opened.body));
      assert.equal(opened.body.code, 'type_mismatch');
      assert.match(opened.body.message, new RegExp(KIT_UID));
      const wrote = await tool({ action: 'publish', url: made.url, files: { 'content.json': '{"title":"no"}' } });
      assert.equal(wrote.error?.code, 'type_mismatch');
      assert.equal(existsSync(join(String(made.root), 'content.json')) && readFileSync(join(String(made.root), 'content.json'), 'utf8').includes('"no"'), false);
    } finally {
      rmSync(shadow, { recursive: true, force: true });
    }
    assert.equal((await post(R.open, { id, host: false }, { headers: token() })).status, 200, 'opens again once the shadow is gone');
  });
});

describe('static types: the policy, the archive, import', () => {
  const PLAIN_UID = randomUUID();
  let installedUrl: string;
  let localUrl: string;

  before(async () => {
    const dir = join(author, 'plain');
    writeStaticType(dir, { id: 'plain', uid: PLAIN_UID, network: NETWORK });
    const packed = await pack(dir);
    await install(packed.file);
    writeStaticType(join(userTypes, 'plain-local'), { id: 'plain-local', uid: randomUUID(), network: NETWORK });
    installedUrl = String((await tool({ action: 'publish', type_url: 'open-artifact://type/plain', title: 'Installed plain' })).url);
    const wrote = await tool({ action: 'publish', url: installedUrl, files: { 'notes/a.txt': 'a' } });
    assert.equal(wrote.error, undefined, JSON.stringify(wrote.error));
    localUrl = String((await tool({ action: 'publish', type_url: 'open-artifact://type/plain-local', title: 'Local plain' })).url);
  });

  const page = (url: string, path = '/') => get(daemon.port, path, { Host: `${artifactIdOf(url)}.frame.localhost:${daemon.port}` });

  test("an installed static type's page and files carry the policy; a local one's do not", async () => {
    const installed = await page(installedUrl);
    assert.equal(installed.status, 200);
    assert.equal(installed.headers['content-security-policy'], installedTypeCsp(NETWORK));
    assert.equal((await page(installedUrl, '/_root/notes/a.txt')).headers['content-security-policy'], installedTypeCsp(NETWORK));
    const local = await page(localUrl);
    assert.equal(local.status, 200);
    assert.equal(local.headers['content-security-policy'], undefined);
  });

  let archive: Buffer;

  test("the daemon zips a static type's artifact itself", async () => {
    const r = await get(daemon.port, `/api/open-artifact.${R.archive}?id=${artifactIdOf(installedUrl)}`, token());
    assert.equal(r.status, 200, r.body.toString('utf8'));
    assert.equal(r.headers['content-type'], 'application/zip');
    archive = r.body;
    const names = zipEntries(archive).entries.map((e) => e.name.slice(e.name.indexOf('/') + 1)).sort();
    assert.ok(names.includes('.artifact.json'));
    assert.ok(names.includes('notes/a.txt'));
  });

  test('import: the archive opens with the type of its uid, as a new artifact in the home workspace', async () => {
    const r = await post(R.import, null, { bytes: archive, type: 'application/zip', query: 'name=plain.zip', headers: token() });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.type, 'plain');
    assert.notEqual(r.body.id, artifactIdOf(installedUrl));
    assert.ok(String(r.body.root).startsWith(workspace));
    assert.equal(readFileSync(join(String(r.body.root), 'notes', 'a.txt'), 'utf8'), 'a');
    const m = marker(String(r.body.root));
    assert.equal(m.typeUid, PLAIN_UID);
    assert.equal(m.type, 'plain');
    // From the home page: JSON with base64.
    const again = await post(R.import, { name: '/somewhere/plain.zip', data: archive.toString('base64') }, { headers: { Origin: `http://127.0.0.1:${daemon.port}`, 'Sec-Fetch-Site': 'same-origin' } });
    assert.equal(again.status, 201, JSON.stringify(again.body));
    assert.notEqual(again.body.root, r.body.root);
  });

  /** An archive of one artifact whose marker is `markerData`. */
  const archiveOf = (markerData: Record<string, unknown>, extra: Array<{ name: string; data: string }> = []) =>
    rawZip([{ name: 'thing/.artifact.json', data: JSON.stringify(markerData) }, { name: 'thing/index.html', data: '<p>x</p>' }, ...extra]);

  test('import: no type of that uid here is type_missing, naming its id, uid and source; nothing is left', async () => {
    const before = readdirSync(workspace).sort();
    const missing = await post(R.import, null, { bytes: archiveOf({ type: 'ghost', typeUid: 'uid-ghost', typeSource: 'https://types.example.com/ghost-1.0.0.oatype' }), type: 'application/zip', headers: token() });
    assert.equal(missing.status, 400, JSON.stringify(missing.body));
    assert.equal(missing.body.code, 'type_missing');
    assert.match(missing.body.message, /ghost/);
    assert.match(missing.body.message, /uid-ghost/);
    assert.match(missing.body.message, /https:\/\/types\.example\.com\/ghost-1\.0\.0\.oatype/);
    assert.match(missing.body.fix, /open-artifact types install https:\/\/types\.example\.com\/ghost-1\.0\.0\.oatype/);

    const mismatched = await post(R.import, null, { bytes: archiveOf({ type: 'plain', typeUid: randomUUID(), typeSource: 'plain-1.0.0.oatype' }), type: 'application/zip', headers: token() });
    assert.equal(mismatched.body.code, 'type_missing', 'a type of the same id and another uid does not open it');
    assert.match(mismatched.body.message, /has that uid/);

    const hostile = await post(R.import, null, { bytes: archiveOf({ type: 'plain', typeUid: PLAIN_UID }, [{ name: 'thing/../escape.txt', data: 'x' }]), type: 'application/zip', headers: token() });
    assert.equal(hostile.body.code, 'bad_archive');
    const notOne = await post(R.import, null, { bytes: rawZip([{ name: 'thing/index.html', data: 'x' }]), type: 'application/zip', headers: token() });
    assert.equal(notOne.body.code, 'bad_archive');
    assert.deepEqual(readdirSync(workspace).sort(), before);
  });
});

describe('the routes are the command line and the home page only', () => {
  const frameOrigin = (): string => `http://art_0abcdefghi1234.frame.localhost:${daemon.port}`;
  const routes = (): Array<[string, unknown]> => [
    [R.typesPreview, { url: 'https://types.example.com/x.oatype' }],
    [R.typesInstall, { sha256: '0'.repeat(64) }],
    [R.typesUninstall, { id: 'kit' }],
    [R.typesUpdate, { id: 'kit' }],
    [R.import, { name: 'x.zip', data: '' }],
  ];

  test('a page (frame origin, a type server, another site) is refused, with the token or without', async () => {
    for (const origin of [frameOrigin(), `http://127.0.0.1:${daemon.port + 1}`, 'http://evil.example', `https://127.0.0.1:${daemon.port}`, 'null']) {
      for (const [name, body] of routes()) {
        const withToken = await post(name, body, { headers: { Origin: origin, ...token() } });
        assert.equal(withToken.status, 403, `${name} from ${origin}`);
        assert.equal(withToken.body.code, 'not_granted');
        assert.equal((await post(name, body, { headers: { Origin: origin } })).status, 403, `${name} from ${origin} without the token`);
      }
    }
    assert.ok(existsSync(join(installedRoot, 'kit')), 'nothing was uninstalled');
  });

  test('a cross-site or same-site request is refused even with no Origin', async () => {
    for (const site of ['cross-site', 'same-site']) {
      for (const [name, body] of routes()) assert.equal((await post(name, body, { headers: { 'Sec-Fetch-Site': site, ...token() } })).status, 403, `${name} ${site}`);
    }
  });

  test('raw bytes need the token too', async () => {
    assert.equal((await post(R.typesPreview, null, { bytes: Buffer.from('x') })).status, 403);
    assert.equal((await post(R.import, null, { bytes: Buffer.from('x'), type: 'application/zip' })).status, 403);
  });

  test("inside an agent's session, install, update and uninstall are refused; a preview is not", async () => {
    const agent = { ...token(), 'X-Open-Artifact-Client': 'cli', 'X-Open-Artifact-Agent': 'claude-code%20session%20x' };
    for (const [name, body] of routes().filter(([n]) => n !== R.typesPreview && n !== R.import)) {
      const r = await post(name, body, { headers: agent });
      assert.equal(r.status, 403, name);
      assert.match(r.body.message, /person/);
    }
    const kitFile = join(out, 'kit-0.1.0.oatype');
    const preview = await post(R.typesPreview, null, { bytes: readFileSync(kitFile), query: 'name=kit.oatype', headers: agent });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.ok(existsSync(join(installedRoot, 'kit')));
  });

  test('the audit log names what was installed, with its sha256, and who asked', () => {
    const log = readFileSync(files.daemonLog(), 'utf8');
    assert.match(log, /audit: installed the type kit 0\.1\.0 \(uid [0-9a-f-]+, sha256 [0-9a-f]{64}\) from .*kit-0\.1\.0\.oatype/);
    assert.match(log, /audit: updated the type kit 0\.2\.0/);
    assert.match(log, /audit: uninstalled the type kit-b/);
    assert.match(log, /audit: imported plain\.zip as art_/);
  });
});

describe('fetchTypePackage', () => {
  let server: Server;
  let base: string;
  const seen: Array<Record<string, unknown>> = [];
  const BYTES = Buffer.from('package bytes');

  before(async () => {
    server = createServer((req, res) => {
      seen.push({ ...req.headers });
      switch (req.url) {
        case '/pkg':
          return res.writeHead(200, { 'Content-Type': 'application/zip' }).end(BYTES);
        case '/same':
          return res.writeHead(302, { Location: '/pkg' }).end();
        case '/to-https':
          return res.writeHead(302, { Location: 'https://127.0.0.1:9/pkg' }).end();
        case '/to-file':
          return res.writeHead(302, { Location: 'file:///etc/passwd' }).end();
        case '/to-elsewhere':
          return res.writeHead(302, { Location: 'http://types.example.com/pkg' }).end();
        case '/to-credentials':
          return res.writeHead(302, { Location: `http://user:secret@127.0.0.1:${(server.address() as { port: number }).port}/pkg` }).end();
        case '/loop':
          return res.writeHead(302, { Location: '/loop' }).end();
        case '/declared':
          return res.writeHead(200, { 'Content-Length': '100000' }).end(Buffer.alloc(100_000));
        case '/chunked':
          res.writeHead(200);
          for (let i = 0; i < 20; i++) res.write(Buffer.alloc(1000));
          return res.end();
        case '/slow':
          res.writeHead(200);
          res.write('x');
          return;
        default:
          return res.writeHead(404).end();
      }
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });

  after(() => server.closeAllConnections?.() ?? server.close());

  test('plain http from this computer, and a redirect of the same scheme; no credentials or cookies sent', async () => {
    assert.deepEqual(Buffer.from(await fetchTypePackage(`${base}/pkg`)), BYTES);
    assert.deepEqual(Buffer.from(await fetchTypePackage(`${base}/same`)), BYTES);
    for (const headers of seen) {
      assert.equal(headers.authorization, undefined);
      assert.equal(headers.cookie, undefined);
    }
  });

  test('refuses plain http elsewhere, other schemes, and an address with a user or password', async () => {
    await assert.rejects(fetchTypePackage('http://types.example.com/x.oatype'), /https:\/\//);
    await assert.rejects(fetchTypePackage('ftp://types.example.com/x.oatype'), /https:\/\//);
    await assert.rejects(fetchTypePackage('file:///etc/passwd'), /https:\/\//);
    await assert.rejects(fetchTypePackage(`http://user:secret@127.0.0.1:1/x`), /user name or password/);
  });

  test('refuses a redirect to another scheme', async () => {
    await assert.rejects(fetchTypePackage(`${base}/to-https`), (e: any) => e.code === 'redirected');
    await assert.rejects(fetchTypePackage(`${base}/to-file`), /https:\/\//);
  });

  test('checks every redirect target as it checks the address: no plain http elsewhere, no credentials, at most 5 hops', async () => {
    await assert.rejects(fetchTypePackage(`${base}/to-elsewhere`), /https:\/\//);
    await assert.rejects(fetchTypePackage(`${base}/to-credentials`), /user name or password/);
    await assert.rejects(fetchTypePackage(`${base}/loop`), (e: any) => e.code === 'download_failed' && /redirect/.test(e.message));
  });

  test('stops at the size cap, by the declared length and while reading', async () => {
    await assert.rejects(fetchTypePackage(`${base}/declared`, { maxBytes: 10_000 }), (e: any) => e.code === 'too_large');
    await assert.rejects(fetchTypePackage(`${base}/chunked`, { maxBytes: 10_000 }), (e: any) => e.code === 'too_large' && /sent more/.test(e.message));
  });

  test('gives up after the timeout, the body included', async () => {
    await assert.rejects(fetchTypePackage(`${base}/slow`, { timeoutMs: 200 }), (e: any) => e.code === 'timeout');
  });

  test('the preview route fetches an address once and records it as the source', async () => {
    const kit = readFileSync(join(out, 'kit-0.1.0.oatype'));
    const pkgServer = createServer((_req, res) => res.writeHead(200).end(kit));
    await new Promise<void>((done) => pkgServer.listen(0, '127.0.0.1', done));
    try {
      const address = `http://127.0.0.1:${(pkgServer.address() as { port: number }).port}/kit-0.1.0.oatype`;
      const r = await post(R.typesPreview, { url: address, as: 'kit-web' }, { headers: token() });
      assert.equal(r.status, 200, JSON.stringify(r.body));
      assert.equal(r.body.source, address);
      assert.equal(r.body.sha256, sha(kit));
      assert.equal(r.body.id, 'kit-web');
    } finally {
      pkgServer.close();
    }
  });
});
