import { tempDir } from './helpers.ts';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import {
  LIBRARY_ROUTES,
  readStaticDeclaration,
  type DaemonState,
  type ToolCallResult,
  type TypeCheckResult,
  type TypesFromResponse,
  type TypesNewResponse,
  type TypesResponse,
} from '@open-artifact/protocol';
import { api, readDaemon } from '../src/client.ts';
import { BOOT_PLACEHOLDER, startDaemon, type Daemon } from '../src/daemon.ts';
import { files } from '../src/paths.ts';
import { loadSettings } from '../src/settings.ts';
import { capabilitiesUsed, checkType, newType, pageNotes, SAVED_PAGE_NOTE, setProjectTrusted, setTypeEnabled, stripFrameRuntime, withDeclaration, withInferredCapabilities } from '../src/type-authoring.ts';
import { TypeRegistry } from '../src/types.ts';

const userTypes = process.env.OPEN_ARTIFACT_USER_TYPES!;
const R = LIBRARY_ROUTES;

let daemon: Daemon;
let state: DaemonState;
const shellDir = tempDir('open-artifact-shell-');
const workspace = tempDir('open-artifact-ws-');

before(async () => {
  writeFileSync(join(shellDir, 'index.html'), `<!doctype html><title>shell</title><script>window.__OPEN_ARTIFACT_BOOT__ = ${BOOT_PLACEHOLDER};</script>`);
  daemon = await startDaemon({ port: 0, quiet: true, shellDir, homeDir: join(shellDir, 'no-home') });
  state = (await readDaemon())!;
});

after(() => daemon.close());

/** A raw POST to a Library route, with whatever headers a test gives (no token unless it says so). */
function post(name: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: Record<string, any> }> {
  return new Promise((done, fail) => {
    const req = request(
      { host: '127.0.0.1', port: daemon.port, path: `/api/open-artifact.${name}`, method: 'POST', headers: { 'Content-Type': 'application/json', Host: `127.0.0.1:${daemon.port}`, ...headers } },
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
    req.end(JSON.stringify(body));
  });
}

const token = (): Record<string, string> => ({ Authorization: `Bearer ${state.token}` });
const savedSettings = (): Record<string, any> => {
  try {
    return JSON.parse(readFileSync(files.settings(), 'utf8')) as Record<string, any>;
  } catch {
    return {};
  }
};
const options = () => {
  const settings = loadSettings();
  return { settings, registry: new TypeRegistry(() => settings), workspace };
};

describe('types new', () => {
  test('the page template: a frame type that passes types check', async () => {
    const made = await api<TypesNewResponse>(state, R.typesNew, { id: 'notes', name: 'Notes' });
    assert.equal(made.scope, 'user');
    assert.equal(made.dir, join(userTypes, 'notes'));
    assert.deepEqual(made.files, ['SKILL.md', 'artifact-type.json', 'artifact-type/style.css', 'index.html']);
    assert.equal(made.check.ok, true, JSON.stringify(made.check));
    assert.deepEqual(made.check.warnings, []);
    const manifest = JSON.parse(readFileSync(join(made.dir, 'artifact-type.json'), 'utf8'));
    assert.match(manifest.uid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(manifest.uid, made.uid);
    assert.equal(manifest.slug, 'notes');
    assert.equal(manifest.version, '0.1.0');
    assert.equal(manifest.openArtifact, undefined, 'the page template keeps its content in files');
    const decl = readStaticDeclaration(readFileSync(join(made.dir, 'index.html'), 'utf8'))!;
    assert.equal(decl.key, 'notes');
    assert.deepEqual(decl.capabilities, { artifact: {}, downloads: {} });
    assert.match(readFileSync(join(made.dir, 'SKILL.md'), 'utf8'), /^---\nname: notes\ndescription: >-\n  \S/);
    assert.match(made.prompt, /open-artifact types check notes/);
    // The daemon sees it at once, as a runnable frame type.
    const listed = await api<TypesResponse>(state, R.types);
    const view = listed.types.find((t) => t.id === 'notes')!;
    assert.equal(view.runtime, 'frame');
    assert.equal(view.runnable, true);
    assert.equal(view.uid, made.uid);
    assert.equal(view.dir, made.dir);
  });

  test('the data template keeps its content in db', async () => {
    const made = await api<TypesNewResponse>(state, R.typesNew, { id: 'todo', template: 'data' });
    assert.equal(made.check.ok, true, JSON.stringify(made.check));
    const manifest = JSON.parse(readFileSync(join(made.dir, 'artifact-type.json'), 'utf8'));
    assert.deepEqual(manifest.openArtifact, { store: 'db' });
    assert.equal(manifest.name, 'Todo');
    const decl = readStaticDeclaration(readFileSync(join(made.dir, 'index.html'), 'utf8'))!;
    assert.deepEqual(decl.capabilities, { db: {} });
    assert.match(readFileSync(join(made.dir, 'SKILL.md'), 'utf8'), /ArtifactData/);
  });

  test('a project type goes under the project folder', async () => {
    const project = tempDir('open-artifact-project-');
    const made = await api<TypesNewResponse>(state, R.typesNew, { id: 'board', scope: 'project', project, workspace: project });
    assert.equal(made.dir, join(project, '.agents', 'artifact-types', 'board'));
    // Step C: an untrusted project's frame type runs (frame-host is the daemon's program); only a server of its own
    // (`entry.start`) waits for trust, so a frame starter gets no `untrusted` warning.
    assert.ok(!made.check.warnings.some((w) => w.code === 'untrusted'), JSON.stringify(made.check.warnings));
  });

  test('refuses an invalid id, an existing folder, a built-in id and a reserved one', async () => {
    for (const id of ['', 'Bad Id', '../up', 'UPPER', '-dash', 'a'.repeat(65)]) {
      const out = await api<{ code: string }>(state, R.typesNew, { id });
      assert.equal(out.code, 'invalid_argument', id);
    }
    assert.equal((await api<{ code: string }>(state, R.typesNew, { id: 'notes' })).code, 'conflict');
    assert.equal((await api<{ code: string }>(state, R.typesNew, { id: 'page' })).code, 'conflict');
    assert.equal((await api<{ code: string }>(state, R.typesNew, { id: 'slides' })).code, 'conflict');
    assert.equal((await api<{ code: string }>(state, R.typesNew, { id: 'new-type' })).code, 'invalid_argument');
    assert.equal((await api<{ code: string }>(state, R.typesNew, { id: 'fresh', template: 'game' })).code, 'invalid_argument');
    assert.equal((await api<{ code: string }>(state, R.typesNew, { id: 'fresh', scope: 'installed' })).code, 'invalid_argument');
    assert.equal(existsSync(join(userTypes, 'fresh')), false, 'nothing is left behind');
  });

  test('a new type makes artifacts at once', async () => {
    const made = await api<ToolCallResult>(state, 'tools.call', {
      name: 'Artifact',
      arguments: { action: 'publish', type_url: 'open-artifact://type/notes', title: 'Lisbon', open: 'never' },
      caller: { harness: 'dsh', session: 's-new', workspace },
    });
    assert.equal(made.error, undefined, JSON.stringify(made.error));
    assert.match(String(made.instructions), /content\.json/);
  });
});

describe('types check', () => {
  const folder = (id: string, files: Record<string, string>): string => {
    const dir = join(tempDir('open-artifact-check-'), id);
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(join(dir, rel, '..'), { recursive: true });
      writeFileSync(join(dir, rel), text);
    }
    return dir;
  };
  const skill = (id: string): string => `---\nname: ${id}\ndescription: A thing.\n---\n# ${id}\n`;
  const manifest = (id: string, extra: Record<string, unknown> = {}): string =>
    JSON.stringify({ slug: id, uid: '00000000-0000-4000-8000-000000000000', name: id, version: '1.0.0', description: 'A thing.', ...extra });
  const page = (block: string): string => `<!doctype html><title>t</title><script>\n// artifact.json\n${block}\n// end\n</script>`;
  const codes = (r: TypeCheckResult): { errors: string[]; warnings: string[] } => ({ errors: r.errors.map((e) => e.code), warnings: r.warnings.map((w) => w.code) });
  const good = (id: string, block = `var key = "${id}"; var capabilities = { db: {} };`, extra: Record<string, string> = {}): Record<string, string> => ({
    'artifact-type.json': manifest(id),
    'SKILL.md': skill(id),
    'index.html': page(block),
    ...extra,
  });

  test('a good type passes', () => {
    const r = checkType(folder('fine', good('fine')), options());
    assert.deepEqual(codes(r), { errors: [], warnings: [] });
    assert.deepEqual(r.capabilities, { backed: ['db'], stubbed: [], unknown: [] });
  });

  test('errors: id, manifest, declaration, capability, skill', () => {
    assert.ok(codes(checkType(folder('Bad id', good('x')), options())).errors.includes('id_invalid'));
    assert.ok(codes(checkType(folder('slides', good('slides')), options())).errors.includes('id_builtin'));
    assert.ok(codes(checkType(folder('new-type', good('new-type')), options())).errors.includes('id_reserved'));
    assert.ok(codes(checkType(folder('m1', { ...good('m1'), 'artifact-type.json': '{ not json' }), options())).errors.includes('manifest_invalid'));
    assert.ok(codes(checkType(folder('m2', { ...good('m2'), 'artifact-type.json': '[1]' }), options())).errors.includes('manifest_invalid'));
    const decl = checkType(folder('d1', good('d1', 'var key = "d1"; var capabilities = { db: fetch("/x") };')), options());
    assert.ok(codes(decl).errors.includes('declaration_invalid'));
    assert.match(decl.errors[0]!.message, /line 3, column \d+/);
    assert.ok(codes(checkType(folder('d2', good('d2', 'var key = "d2"; const capabilities = { db: {} };')), options())).errors.includes('declaration_lexical'));
    assert.ok(codes(checkType(folder('c1', good('c1', 'var key = "c1"; var capabilities = { files: {} };')), options())).errors.includes('capability_unknown'));
    assert.ok(codes(checkType(folder('c2', good('c2', 'var key = "c2"; var capabilities = { db: 3 };')), options())).errors.includes('capabilities_invalid'));
    const noSkill = good('s1');
    delete noSkill['SKILL.md'];
    assert.ok(codes(checkType(folder('s1', noSkill), options())).errors.includes('skill_missing'));
    assert.deepEqual(codes(checkType(folder('s2', { ...good('s2'), 'SKILL.md': '---\nname: s2\n---\n' }), options())).errors, ['skill_frontmatter']);
    assert.deepEqual(codes(checkType(folder('s3', { ...good('s3'), 'SKILL.md': '# no frontmatter' }), options())).errors, ['skill_frontmatter', 'skill_frontmatter']);
    assert.deepEqual(codes(checkType(folder('s4', { 'artifact-type.json': manifest('s4', { skill: false }), 'index.html': page('var key = "s4";') }), options())).errors, []);
    const none = checkType(folder('e1', { 'artifact-type.json': manifest('e1'), 'SKILL.md': skill('e1') }), options());
    assert.ok(codes(none).errors.includes('type_problem') || codes(none).errors.includes('not_runnable'), JSON.stringify(none.errors));
    assert.deepEqual(codes(checkType(join(workspace, 'nothing-here'), options())).errors, ['not_found']);
  });

  test('warnings: stubbed capability, false, key, slug, unread name, uid and version', () => {
    assert.deepEqual(codes(checkType(folder('w1', good('w1', 'var key = "w1"; var capabilities = { tts: {}, flags: { keys: [] }, self: {} };')), options())), {
      errors: [],
      warnings: ['capability_stubbed'],
    });
    assert.deepEqual(codes(checkType(folder('w2', good('w2', 'var key = "w2"; var capabilities = { db: false };')), options())).warnings, ['capability_false']);
    assert.deepEqual(codes(checkType(folder('w3', good('w3', 'var capabilities = {};')), options())).warnings, ['declaration_key_missing']);
    assert.deepEqual(codes(checkType(folder('w4', good('w4', 'var key = "other";')), options())).warnings, ['declaration_key_mismatch']);
    assert.deepEqual(codes(checkType(folder('w5', good('w5', 'var key = "w5"; var extra = 1;')), options())).warnings, ['declaration_name_unread']);
    assert.deepEqual(codes(checkType(folder('w6', { ...good('w6'), 'artifact-type.json': JSON.stringify({ slug: 'other', name: 'w6' }) }), options())).warnings, [
      'slug_mismatch',
      'uid_missing',
      'version_missing',
    ]);
    const bare = good('w7');
    delete bare['artifact-type.json'];
    assert.deepEqual(codes(checkType(folder('w7', bare), options())).warnings, ['manifest_missing']);
  });

  test('warnings: turned off, shadowed and shadowing', async () => {
    setTypeEnabled('todo', false);
    try {
      const o = options();
      assert.ok(codes(checkType(join(userTypes, 'todo'), o)).warnings.includes('disabled'));
    } finally {
      setTypeEnabled('todo', true);
    }
    const project = tempDir('open-artifact-shadow-');
    const shadow = join(project, '.agents', 'artifact-types', 'notes');
    mkdirSync(shadow, { recursive: true });
    for (const [rel, text] of Object.entries(good('notes'))) writeFileSync(join(shadow, rel), text);
    const settings = loadSettings();
    const o = { settings, registry: new TypeRegistry(() => settings), workspace: project };
    assert.ok(codes(checkType(shadow, o)).warnings.includes('shadows'));
    assert.ok(codes(checkType(join(userTypes, 'notes'), o)).warnings.includes('shadowed'));
  });

  test('--for-share: fields, entry, links, dotfiles and sizes', () => {
    const share = { ...options(), forShare: true };
    assert.deepEqual(codes(checkType(folder('ok', good('ok')), share)).errors, []);
    const bare = checkType(folder('f1', { ...good('f1'), 'artifact-type.json': JSON.stringify({ skill: 'SKILL.md' }) }), share);
    assert.deepEqual(codes(bare).errors, ['share_field_missing', 'share_field_missing', 'share_field_missing', 'share_field_missing', 'share_field_missing']);
    const start = checkType(folder('f3', { ...good('f3'), 'artifact-type.json': manifest('f3', { entry: { start: { command: 'node' } } }) }), share);
    assert.ok(codes(start).errors.includes('share_entry_start'));
    const url = checkType(folder('f4', { ...good('f4'), 'artifact-type.json': manifest('f4', { entry: { url: 'https://example.com' } }) }), share);
    assert.ok(codes(url).errors.includes('share_entry_url'));
    const outside = checkType(folder('f5', { ...good('f5'), 'artifact-type.json': manifest('f5', { entry: '../x.html' }) }), share);
    assert.ok(codes(outside).errors.includes('share_entry_outside'));
    const dot = checkType(folder('f6', { ...good('f6'), '.env': 'x', 'artifact-type/.cache/a': 'x' }), share);
    assert.deepEqual(codes(dot).errors, ['share_dotfile', 'share_dotfile']);
    const linked = folder('f7', good('f7'));
    symlinkSync('/etc/hosts', join(linked, 'hosts'));
    assert.deepEqual(codes(checkType(linked, share)).errors, ['share_symlink']);
    const big = folder('f8', good('f8'));
    writeFileSync(join(big, 'big.bin'), Buffer.alloc(16 * 1024 * 1024 + 1));
    assert.deepEqual(codes(checkType(big, share)).errors, ['share_file_too_large']);
    const many = folder('f9', good('f9'));
    mkdirSync(join(many, 'artifact-type'), { recursive: true });
    for (let i = 0; i < 2000; i++) writeFileSync(join(many, 'artifact-type', `f${i}.txt`), '');
    assert.deepEqual(codes(checkType(many, share)).errors, ['share_too_many_files']);
    const total = folder('f10', good('f10'));
    for (let i = 0; i < 5; i++) writeFileSync(join(total, `part${i}.bin`), Buffer.alloc(14 * 1024 * 1024));
    assert.deepEqual(codes(checkType(total, share)).errors, ['share_too_large']);
    // Without --for-share none of these count.
    assert.deepEqual(codes(checkType(dot.dir, options())).errors, []);
  });

  test('the route checks a type by id, never a path', async () => {
    const r = await api<TypeCheckResult>(state, R.typesCheck, { id: 'notes' });
    assert.equal(r.ok, true);
    assert.equal((await api<{ code: string }>(state, R.typesCheck, { id: '/etc' })).code, 'not_found');
  });
});

describe('types from', () => {
  test('a page artifact becomes a type: its page with the capabilities declared, and what was left behind', async () => {
    const made = await api<ToolCallResult>(state, 'tools.call', {
      name: 'Artifact',
      arguments: { action: 'publish', type_url: 'open-artifact://type/page', title: 'Lunch poll', capabilities: { db: true, downloads: {} }, open: 'never' },
      caller: { harness: 'dsh', session: 's-from', workspace },
    });
    assert.equal(made.error, undefined, JSON.stringify(made.error));
    const root = String(made.root);
    writeFileSync(join(root, 'index.html'), '<!doctype html><html><head><title>Lunch poll</title></head><body><script>let key = 1;</script></body></html>');
    writeFileSync(join(root, 'app.js'), 'console.log(1)');
    mkdirSync(join(root, 'db', 'votes'), { recursive: true });
    writeFileSync(join(root, 'db', 'votes', 'a.json'), '{}');
    mkdirSync(join(root, 'artifact-type'), { recursive: true });
    writeFileSync(join(root, 'artifact-type', 'logo.svg'), '<svg/>');
    const from = await api<TypesFromResponse>(state, R.typesFrom, { artifact: made.url, id: 'lunch-poll' });
    assert.equal(from.check.ok, true, JSON.stringify(from.check));
    assert.deepEqual(from.files, ['SKILL.md', 'artifact-type.json', 'artifact-type/logo.svg', 'index.html']);
    assert.ok(from.skipped.includes('app.js'), JSON.stringify(from.skipped));
    assert.ok(from.skipped.includes('db/'), JSON.stringify(from.skipped));
    assert.ok(!from.skipped.some((p) => p.startsWith('db/votes')), 'db/ is named once');
    assert.ok(from.notes?.length, 'the result says what to move');
    const html = readFileSync(join(from.dir, 'index.html'), 'utf8');
    const decl = readStaticDeclaration(html)!;
    assert.deepEqual(decl.capabilities, { db: true, downloads: {} });
    assert.equal(decl.key, 'lunch-poll');
    assert.match(html, /<script type="text\/plain" id="artifact-json">/, 'in a script that never runs: no clash with the page\'s own `let key`');
    const manifest = JSON.parse(readFileSync(join(from.dir, 'artifact-type.json'), 'utf8'));
    assert.equal(manifest.name, 'Lunch poll');
    assert.ok(manifest.uid);
    assert.match(readFileSync(join(from.dir, 'SKILL.md'), 'utf8'), /^---\nname: lunch-poll\n/);
  });

  test('refuses an artifact that is not a page', async () => {
    const made = await api<ToolCallResult>(state, 'tools.call', {
      name: 'Artifact',
      arguments: { action: 'publish', type_url: 'open-artifact://type/notes', title: 'Not a page', open: 'never' },
      caller: { harness: 'dsh', session: 's-from2', workspace },
    });
    const out = await api<{ code: string }>(state, R.typesFrom, { artifact: made.url, id: 'nope' });
    assert.equal(out.code, 'unsupported');
    assert.equal(existsSync(join(userTypes, 'nope')), false);
  });

  test('withDeclaration replaces a declaration the page already has', () => {
    const html = '<script>\n  // artifact.json\n  var key = "old";\n  var capabilities = {};\n  // the rest\n  boot();\n</script>';
    const next = withDeclaration(html, '// artifact.json\nvar key = "new";\nvar capabilities = { "db": {} };\nvar monitoring = {};\n// end of artifact.json');
    const decl = readStaticDeclaration(next)!;
    assert.equal(decl.key, 'new');
    assert.deepEqual(decl.capabilities, { db: {} });
    assert.match(next, /\/\/ the rest\n  boot\(\);/);
    assert.ok(!next.includes('"old"'));
  });
});

describe('types from a saved page', () => {
  // A synthetic page in the shape of one saved from another host: an inlined runtime between markers, a declaration
  // without capabilities, literal use() calls and notes for the agent.
  const RUNTIME = '<!-- frame-runtime --><script>window.__inlined_runtime = true;</script><!-- /frame-runtime -->';
  const savedPage = (o: { declaration?: string; notes?: boolean } = {}) => `<!doctype html><html><head>${RUNTIME}
<meta charset="utf-8"><title>Reading &amp; notes</title>
<script>(() => {
  ${o.declaration ?? '// artifact.json\n  var key = "saved-reader";\n  var monitoring = { readyTimeoutS: 20 };'}

  // the page
  const go = async () => { const db = await claude.use("db"); const d = await openArtifact.use('downloads'); const s = await window.claude.use('sample'); const x = await useCap("telepathy"); const h = await use('hot'); };
  go();
})();</script>
<script type=module>import network from '/_/openartifact:network';</script>
${o.notes === false ? '' : '<script type="text/plain" id="notes-for-claude">\nKeep each reading in db collection "readings".\n</script>'}
</head><body><p>reader</p></body></html>
`;

  function savedFolder(o: { meta?: unknown; icon?: { name: string; data?: string; link?: boolean }; declaration?: string; notes?: boolean } = {}): string {
    const dir = tempDir('open-artifact-saved-page-');
    writeFileSync(join(dir, 'index.html'), savedPage(o));
    if (o.meta !== undefined) writeFileSync(join(dir, 'metadata.json'), typeof o.meta === 'string' ? o.meta : JSON.stringify(o.meta));
    if (o.icon) {
      if (o.icon.link) symlinkSync(join(dir, 'index.html'), join(dir, o.icon.name));
      else writeFileSync(join(dir, o.icon.name), o.icon.data ?? '<svg xmlns="http://www.w3.org/2000/svg"/>');
    }
    writeFileSync(join(dir, 'preview.webp'), 'x');
    return dir;
  }

  test('a saved folder becomes a type: runtime out, capabilities declared after the key, metadata and notes taken', async () => {
    const dir = savedFolder({
      meta: { name: 'Saved reader', title: 'Saved reader, the long title', description: 'Track readings.\nOn two lines.', summary: 'Readings', artifactTitle: 'Untitled readings', category: 'Study', icon: { file: 'icon.svg' }, partner: { name: 'x' } },
      icon: { name: 'icon.svg' },
    });
    const from = await api<TypesFromResponse>(state, R.typesFrom, { path: dir, id: 'saved-reader' });
    assert.equal(from.check.ok, true, JSON.stringify(from.check));
    assert.equal(from.source, dir);
    assert.deepEqual(from.files, ['SKILL.md', 'artifact-type.json', 'icon.svg', 'index.html']);
    assert.deepEqual(from.skipped, ['preview.webp']);
    assert.deepEqual(from.capabilities, { inferred: ['db', 'downloads', 'sample', 'network'], stubbed: ['sample'], unknown: ['telepathy'] });
    assert.ok(from.notes?.includes(SAVED_PAGE_NOTE), 'says the page was written by someone else');
    assert.ok(from.notes?.some((n) => /sample answers only an error \(tools_unavailable\)/.test(n)), JSON.stringify(from.notes));
    assert.ok(from.notes?.some((n) => /telepathy, which Open Artifact does not know/.test(n)), JSON.stringify(from.notes));
    const html = readFileSync(join(from.dir, 'index.html'), 'utf8');
    assert.ok(!html.includes('frame-runtime') && !html.includes('__inlined_runtime'), 'the inlined runtime is gone');
    assert.match(html, /var key = "saved-reader";\n  var capabilities = \{"db":\{\},"downloads":\{\},"sample":\{\},"network":\{\}\};\n  var monitoring/);
    const decl = readStaticDeclaration(html)!;
    assert.deepEqual(decl.capabilities, { db: {}, downloads: {}, sample: {}, network: {} });
    assert.deepEqual(decl.monitoring, { readyTimeoutS: 20 }, 'the rest of the block is kept');
    const manifest = JSON.parse(readFileSync(join(from.dir, 'artifact-type.json'), 'utf8'));
    assert.equal(manifest.slug, 'saved-reader');
    assert.equal(manifest.version, '1.0.0');
    assert.match(manifest.uid, /^[0-9a-f-]{36}$/);
    assert.equal(manifest.name, 'Saved reader');
    assert.equal(manifest.title, 'Saved reader, the long title');
    assert.equal(manifest.description, 'Track readings. On two lines.', 'one line');
    assert.equal(manifest.summary, 'Readings');
    assert.equal(manifest.artifactTitle, 'Untitled readings');
    assert.equal(manifest.category, 'Study');
    assert.deepEqual(manifest.icon, { file: 'icon.svg' });
    assert.equal(manifest.partner, undefined, 'only the named fields are taken');
    const skill = readFileSync(join(from.dir, 'SKILL.md'), 'utf8');
    assert.match(skill, /^---\nname: saved-reader\ndescription: >-\n  Track readings\. On two lines\.\n---\n/);
    assert.match(skill, /Keep each reading in db collection "readings"\./);
    assert.match(skill, /as whoever wrote the page wrote them/);
  });

  test('an .html file, no metadata: the name from --name or the <title>; a page with no declaration gets one', async () => {
    const dir = tempDir('open-artifact-saved-file-');
    const file = join(dir, 'page.html');
    writeFileSync(file, savedPage({ declaration: '// no declaration here', notes: false }));
    const from = await api<TypesFromResponse>(state, R.typesFrom, { path: file, id: 'saved-file' });
    assert.equal(from.check.ok, true, JSON.stringify(from.check));
    assert.deepEqual(from.skipped, []);
    const manifest = JSON.parse(readFileSync(join(from.dir, 'artifact-type.json'), 'utf8'));
    assert.equal(manifest.name, 'Reading & notes');
    const decl = readStaticDeclaration(readFileSync(join(from.dir, 'index.html'), 'utf8'))!;
    assert.equal(decl.key, 'saved-file');
    assert.deepEqual(decl.capabilities, { db: {}, downloads: {}, sample: {}, network: {} });
    assert.match(readFileSync(join(from.dir, 'SKILL.md'), 'utf8'), /had no notes for Claude/);
    const named = await api<TypesFromResponse>(state, R.typesFrom, { path: file, id: 'saved-file-2', name: 'My  reader' });
    assert.equal(JSON.parse(readFileSync(join(named.dir, 'artifact-type.json'), 'utf8')).name, 'My reader');
  });

  test("a declaration with capabilities is kept as it is; the page's key is left alone", async () => {
    const dir = savedFolder({ declaration: '// artifact.json\n  var key = "other-key";\n  var capabilities = { db: {} };', meta: '{not json' });
    const from = await api<TypesFromResponse>(state, R.typesFrom, { path: dir, id: 'saved-declared' });
    assert.deepEqual(from.capabilities, { inferred: [], stubbed: [], unknown: ['telepathy'], declared: ['db'] });
    const decl = readStaticDeclaration(readFileSync(join(from.dir, 'index.html'), 'utf8'))!;
    assert.equal(decl.key, 'other-key');
    assert.deepEqual(decl.capabilities, { db: {} });
    assert.ok(from.check.warnings.some((w) => w.code === 'declaration_key_mismatch'));
    assert.ok(from.notes?.includes('metadata.json does not parse: it was not read.'));
  });

  test('an icon that breaks the rules is not copied; an existing folder is not overwritten; no unclosed runtime', async () => {
    for (const [icon, why] of [
      [{ name: 'icon.svg', link: true }, /a link or a folder/],
      [{ name: 'icon.exe' }, /not an image/],
    ] as const) {
      const id = `saved-icon-${icon.name.replace('.', '-')}${'link' in icon ? '-l' : ''}`;
      const from = await api<TypesFromResponse>(state, R.typesFrom, { path: savedFolder({ meta: { icon: { file: icon.name } }, icon }), id });
      assert.ok(from.notes?.some((n) => why.test(n)), JSON.stringify(from.notes));
      assert.equal(existsSync(join(from.dir, icon.name)), false);
      assert.equal(JSON.parse(readFileSync(join(from.dir, 'artifact-type.json'), 'utf8')).icon, undefined);
    }
    const outside = await api<TypesFromResponse>(state, R.typesFrom, { path: savedFolder({ meta: { icon: { file: '../secret.svg' } } }), id: 'saved-icon-up' });
    assert.ok(outside.notes?.some((n) => /a file name in the folder/.test(n)));
    const again = await api<{ code: string }>(state, R.typesFrom, { path: savedFolder(), id: 'saved-reader' });
    assert.equal(again.code, 'conflict');
    const broken = tempDir('open-artifact-saved-broken-');
    writeFileSync(join(broken, 'index.html'), '<!doctype html><!-- frame-runtime --><script>1</script>');
    assert.equal((await api<{ code: string }>(state, R.typesFrom, { path: broken, id: 'saved-broken' })).code, 'invalid_argument');
    assert.equal(existsSync(join(userTypes, 'saved-broken')), false);
    assert.equal((await api<{ code: string }>(state, R.typesFrom, { path: tempDir('open-artifact-empty-'), id: 'saved-empty' })).code, 'not_found');
  });

  test('with a path, the route needs the token: the home page (same origin, no token) is refused', async () => {
    const own = { Origin: `http://127.0.0.1:${daemon.port}`, 'Sec-Fetch-Site': 'same-origin' };
    const res = await post(R.typesFrom, { path: savedFolder(), id: 'saved-from-home' }, own);
    assert.equal(res.status, 403, JSON.stringify(res.body));
    assert.equal(existsSync(join(userTypes, 'saved-from-home')), false);
    assert.equal((await api<{ code: string }>(state, R.typesFrom, { path: 'relative/dir', id: 'saved-rel' })).code, 'invalid_argument');
  });

  test('the pieces: stripFrameRuntime, capabilitiesUsed, withInferredCapabilities, pageNotes', () => {
    assert.equal(stripFrameRuntime(`a${RUNTIME}b${RUNTIME}c`), 'abc');
    assert.throws(() => stripFrameRuntime('<!-- frame-runtime -->x'), /no <!-- \/frame-runtime -->/);
    assert.deepEqual(capabilitiesUsed(`use('self'); x.use("room"); useCap('mcp'); use(name); use('hot'); claude.use('network')`), { inferred: ['artifact', 'room', 'mcp', 'network'], stubbed: ['mcp'], unknown: [] });
    assert.deepEqual(capabilitiesUsed(`
      <p>import x from '/_/openartifact:files'</p>
      <!-- <script type="module">import '/_/openartifact:files';</script> -->
      <script type="text/plain">import '/_/openartifact:files';</script>
      <script type=module>
        import net from '/_/openartifact:network@0.2.92';
        // import '/_/openartifact:desktop';
        const example = "import x from '/_/openartifact:files'";
        import db from 'https://example.test/_/openartifact:db';
        import {at} from '/_/openartifact:use';
        use('room');
        import /* inline comment */ sample from '/_/openartifact:sample';
        import('/_/openartifact:reads');
        export {default as myself} from '/_/openartifact:self';
        import '/_/openartifact:telepathy';
      </script>`), { inferred: ['network', 'room', 'sample', 'artifact'], stubbed: ['sample'], unknown: ['telepathy'] });
    const noKey = withInferredCapabilities('<script>\n  // artifact.json\n  var monitoring = {};\n  // rest\n</script>', 'x', ['db']);
    assert.deepEqual(readStaticDeclaration(noKey.html)!.capabilities, { db: {} });
    assert.equal(readStaticDeclaration(noKey.html)!.key, null, 'no key is added to a block that has none');
    assert.equal(pageNotes('<script id="notes-for-claude" type="text/plain">  hi  </script>'), 'hi');
    assert.equal(pageNotes('<script id="notes-for-claude">hi</script>'), null, 'only a text/plain script');
  });
});

describe('types enable, disable, trust', () => {
  test('enable and disable write disabledTypes, and the daemon sees it at once', async () => {
    const off = await api<{ disabledTypes: string[] }>(state, R.typesDisable, { id: 'todo' });
    assert.deepEqual(off.disabledTypes, ['todo']);
    assert.deepEqual(savedSettings().disabledTypes, ['todo']);
    assert.equal((await api<TypesResponse>(state, R.types)).types.find((t) => t.id === 'todo')!.enabled, false);
    const refused = await api<ToolCallResult>(state, 'tools.call', {
      name: 'Artifact',
      arguments: { action: 'publish', type_url: 'open-artifact://type/todo', title: 'x', open: 'never' },
      caller: { harness: 'dsh', session: 's-off', workspace },
    });
    assert.equal((refused.error as { code?: string } | undefined)?.code, 'unsupported');
    assert.deepEqual((await api<{ disabledTypes: string[] }>(state, R.typesDisable, { id: 'todo' })).disabledTypes, ['todo'], 'twice is once');
    const on = await api<{ disabledTypes: string[] }>(state, R.typesEnable, { id: 'todo' });
    assert.deepEqual(on.disabledTypes, []);
    assert.equal((await api<TypesResponse>(state, R.types)).types.find((t) => t.id === 'todo')!.enabled, true);
    assert.equal((await api<{ code: string }>(state, R.typesDisable, { id: '../x' })).code, 'invalid_argument');
  });

  test('trust and untrust write trustedProjects', async () => {
    const project = tempDir('open-artifact-trust-');
    await api(state, R.typesNew, { id: 'local-board', scope: 'project', project });
    const view = async () => (await api<TypesResponse>(state, R.types, undefined, { query: { workspace: project } })).types.find((t) => t.id === 'local-board')!;
    assert.equal((await view()).trusted, false);
    // Made here, so the home page lists the project (untrusted) for the person to trust.
    const before = (await api<TypesResponse>(state, R.types)).projects?.find((p) => p.dir === project);
    assert.equal(before?.trusted, false);
    assert.deepEqual(before?.types.map((t) => t.id), ['local-board']);
    const trusted = await api<{ trustedProjects: string[] }>(state, R.typesTrust, { dir: project });
    assert.deepEqual(trusted.trustedProjects, [project]);
    assert.equal((await view()).trusted, true);
    // The home page, which lists no workspace, finds the trusted project's types under `projects`.
    const listed = (await api<TypesResponse>(state, R.types)).projects?.find((p) => p.dir === project);
    assert.equal(listed?.trusted, true);
    assert.deepEqual(listed?.types.map((t) => t.id), ['local-board']);
    const untrusted = await api<{ trustedProjects: string[] }>(state, R.typesTrust, { dir: project, trusted: false });
    assert.deepEqual(untrusted.trustedProjects, []);
    assert.equal((await view()).trusted, false);
    assert.equal((await api<{ code: string }>(state, R.typesTrust, { dir: 'relative/dir' })).code, 'invalid_argument');
  });

  test('the settings functions keep what else the file holds', () => {
    writeFileSync(files.settings(), JSON.stringify({ homeWorkspace: '~/Elsewhere', disabledTypes: ['a'] }));
    setTypeEnabled('b', false);
    setProjectTrusted('/tmp/p', true);
    assert.deepEqual(savedSettings(), { homeWorkspace: '~/Elsewhere', disabledTypes: ['a', 'b'], trustedProjects: ['/tmp/p'] });
    writeFileSync(files.settings(), '{}');
  });
});

describe('who may call the types routes', () => {
  const frameOrigin = (): string => `http://art_0abcdefghi1234.frame.localhost:${daemon.port}`;
  const writes: Array<[string, Record<string, unknown>]> = [
    [R.typesNew, { id: 'from-a-page' }],
    [R.typesFrom, { artifact: 'art_0abcdefghi1234', id: 'from-a-page' }],
    [R.typesEnable, { id: 'todo' }],
    [R.typesDisable, { id: 'todo' }],
    [R.typesTrust, { dir: '/tmp/evil' }],
    [R.typesCheck, { id: 'notes' }],
  ];

  test('a call from an artifact page (frame origin) is refused, with the token or without', async () => {
    for (const [name, body] of writes) {
      const bare = await post(name, body, { Origin: frameOrigin() });
      assert.equal(bare.status, 403, `${name} without the token`);
      const withToken = await post(name, body, { Origin: frameOrigin(), ...token() });
      assert.equal(withToken.status, 403, `${name} with the token`);
      assert.equal(withToken.body.code, 'not_granted');
    }
    assert.equal(existsSync(join(userTypes, 'from-a-page')), false);
    assert.equal(savedSettings().trustedProjects, undefined);
  });

  test('a request to a frame host never reaches the API', async () => {
    const res = await post(R.typesDisable, { id: 'todo' }, { Host: `art_0abcdefghi1234.frame.localhost:${daemon.port}`, Origin: frameOrigin(), ...token() });
    assert.notEqual(res.status, 200);
    assert.equal(savedSettings().disabledTypes, undefined);
  });

  test("a type server's page (another port) and another site are refused", async () => {
    for (const origin of [`http://127.0.0.1:${daemon.port + 1}`, 'http://evil.example', `https://127.0.0.1:${daemon.port}`, 'null']) {
      for (const [name, body] of writes) {
        assert.equal((await post(name, body, { Origin: origin, ...token() })).status, 403, `${name} from ${origin}`);
        assert.equal((await post(name, body, { Origin: origin })).status, 403, `${name} from ${origin} without the token`);
      }
    }
  });

  test('a cross-site request is refused even with no Origin', async () => {
    for (const [name, body] of writes) assert.equal((await post(name, body, { 'Sec-Fetch-Site': 'cross-site', ...token() })).status, 403, name);
    for (const [name, body] of writes) assert.equal((await post(name, body, { 'Sec-Fetch-Site': 'same-site', ...token() })).status, 403, name);
  });

  test("the daemon's own page may call them (same origin, JSON)", async () => {
    const own = { Origin: `http://127.0.0.1:${daemon.port}`, 'Sec-Fetch-Site': 'same-origin' };
    const off = await post(R.typesDisable, { id: 'notes' }, own);
    assert.equal(off.status, 200, JSON.stringify(off.body));
    const on = await post(R.typesEnable, { id: 'notes' }, { ...own, Origin: `http://localhost:${daemon.port}`, Host: `localhost:${daemon.port}` });
    assert.equal(on.status, 200);
    // Without the token, the Origin is what makes it a write at all.
    assert.equal((await post(R.typesEnable, { id: 'notes' }, {})).status, 403);
  });

  test('inside an agent session, enable, disable and trust are refused; new and from are not', async () => {
    const agent = { ...token(), 'X-Open-Artifact-Client': 'cli', 'X-Open-Artifact-Agent': 'claude-code%20session%20x' };
    for (const name of [R.typesEnable, R.typesDisable]) {
      const res = await post(name, { id: 'notes' }, agent);
      assert.equal(res.status, 403, name);
      assert.match(res.body.message, /person/);
    }
    assert.equal((await post(R.typesTrust, { dir: '/tmp/agent-project' }, agent)).status, 403);
    assert.equal(savedSettings().trustedProjects, undefined);
    const made = await post(R.typesNew, { id: 'agent-made' }, agent);
    assert.equal(made.status, 200, JSON.stringify(made.body));
  });

  test('GET is refused', async () => {
    const res = await fetch(`${state.url}/api/open-artifact.${R.typesNew}?id=x`, { headers: token() });
    assert.equal(res.status, 405);
  });

  test('the audit log names who asked', () => {
    const log = readFileSync(files.daemonLog(), 'utf8');
    assert.match(log, /audit: made the type agent-made .*inside the agent session claude-code session x/);
    assert.match(log, /audit: turned the type notes off, asked by a page of this daemon/);
  });
});

test('quickstart for new-type points to making a type', async () => {
  const out = await api<ToolCallResult>(state, 'tools.call', { name: 'Artifact', arguments: { action: 'quickstart', intent: 'a type', type: 'new-type' }, caller: { harness: 'dsh', session: 's-q', workspace } });
  const error = out.error as { code?: string; message?: string; fix?: string } | undefined;
  assert.equal(error?.code, 'type_missing');
  assert.match(String(error?.message), /not a type/);
  assert.match(String(error?.fix), /reference\/new-type\.md/);
  assert.match(String(error?.fix), /types new <id>/);
});

test('type.icon is a Library read, not the Type API', async () => {
  const dir = join(userTypes, 'with-icon');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'artifact-type.json'), JSON.stringify({ name: 'With icon', skill: false }));
  writeFileSync(join(dir, 'index.html'), '<script>\n// artifact.json\nvar key = "with-icon";\n// end\n</script>');
  writeFileSync(join(dir, 'icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const res = await fetch(`${state.url}/api/open-artifact.type.icon?id=with-icon`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /<svg/);
  assert.equal((await fetch(`${state.url}/api/open-artifact.type.icon?id=no-such-type`)).status, 404);
  // The rest of type.* is still the Type API.
  assert.equal((await fetch(`${state.url}/api/open-artifact.type.artifact?id=x`)).status, 401);
});

test('newType makes the user root when it is not there yet', () => {
  const root = join(tempDir('open-artifact-root-'), 'not', 'yet');
  const settings = { ...loadSettings(), typeRoots: { user: root, project: '.agents/artifact-types', extra: [] } };
  const made = newType({ id: 'first' }, { settings, registry: new TypeRegistry(() => settings), workspace });
  assert.equal(made.dir, join(root, 'first'));
  assert.equal(made.check.ok, true, JSON.stringify(made.check));
});
