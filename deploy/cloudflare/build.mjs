// Bundles the Cloudflare host for workerd (run `npm run build` at the repository root first: it needs dist/server and
// dist/daemon):
//
//   dist/site/worker.js    the product Worker, packages/host-cloudflare/src/worker.ts (wrangler.jsonc)
//   dist/rooms/worker.js   the rooms test Worker, src/dev-worker.ts (wrangler.rooms.jsonc; never deploy it)
//   dist/*/sheets.wasm     the Sheets engine, beside each bundle (workerd compiles it at upload)
//   dist/assets/           static assets: _open-artifact/{editors,shell,home,support.js,frame/<hash>} and _headers
//
// Each Worker's folder holds its bundle and its wasm and nothing else: with `no_bundle`, wrangler uploads as modules
// every file under the entry's folder (`base_dir`) that a module rule matches (`find_additional_modules`), so the
// static assets, and the other Worker, live in sibling folders outside it.
//
// The product bundle imports `open-artifact:build`, made here: the version, the type table (each type's id and the
// title the Library shows, its manifest and skill text, from artifact-types/*) and the Shell's and home page's
// index.html templates (served with their boot by the Worker; not static assets), and the frame engine's (`frames`):
// the `page` type (its manifest and artifact-type/ files, a few KiB) and where the frame client's browser files are in
// the static assets (_open-artifact/frame/<hash>/, the hash of their bytes, so a path never serves two builds). It imports `open-artifact:plugins`
// too: plugins.mjs here (the host plugins OA_PLUGINS may name), or the file OA_PLUGINS_MODULE names when set. A plugin
// imports `@open-artifact/host-plugin` (and `/testing`, `/contract`) from the repository's copy, wherever its file is.
//
// Aliases: `node:fs` and `node:fs/promises` (and the bare `fs`, `fs/promises`) become the SQLite file system of
// packages/host-cloudflare/src/fs, for every importer but that file system itself; `@open-artifact/wasm-sheets/node`
// becomes packages/host-cloudflare/src/wasm/sheets.ts, whose `.wasm` import is left to workerd. Every other `node:*`
// stays a workerd built-in (nodejs_compat).
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../..');
const pkg = join(repo, 'packages/host-cloudflare/src');
const fsDir = join(pkg, 'fs') + '/';
// OA_BUILD_DIST builds into another folder (a test's Worker with other plugins, beside the one `wrangler dev` serves).
const dist = process.env.OA_BUILD_DIST?.trim() ? resolve(process.env.OA_BUILD_DIST.trim()) : join(here, 'dist');
const server = join(repo, 'dist/server');
const daemon = join(repo, 'dist/daemon');
const wasm = join(repo, 'packages/wasm-sheets/generated/open_artifact_sheets_bg.wasm');
// The frame client's browser files (the inner shell, the page runtime, the comment views), built by `npm run build`.
const frameClient = join(daemon, 'frame-host', 'client');
// The bundled host plugins (`open-artifact:plugins`).
const pluginsModule = process.env.OA_PLUGINS_MODULE?.trim() ? resolve(process.env.OA_PLUGINS_MODULE.trim()) : join(here, 'plugins.mjs');
if (!existsSync(pluginsModule)) {
  console.error(`build: ${pluginsModule} is missing (the host plugins to bundle; OA_PLUGINS_MODULE names another file).`);
  process.exit(1);
}

for (const [dir, what] of [[join(server, 'editors'), 'editors'], [join(daemon, 'home', 'index.html'), 'home page'], [join(daemon, 'shell', 'index.html'), 'Shell'], [join(frameClient, 'runtime.js'), 'frame client']]) {
  if (!existsSync(dir)) {
    console.error(`build: ${relative(process.cwd(), dir)} is missing (the ${what}): run \`npm run build\` at the repository root first.`);
    process.exit(1);
  }
}

/** A type's skill text without its front matter (as the Node host's `skillBody`), or null. */
function skillOf(dir, manifest) {
  try {
    const text = readFileSync(join(dir, typeof manifest.skill === 'string' ? manifest.skill : 'SKILL.md'), 'utf8');
    const front = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text);
    return (front ? text.slice(front[0].length) : text).trim();
  } catch {
    return null;
  }
}

/** What `open-artifact:build` holds. */
async function buildInfo() {
  const { TYPES, isTypeName } = await import(pathToFileURL(join(repo, 'packages/type-server/src/types.ts')).href);
  const version = JSON.parse(readFileSync(join(repo, 'packages/host-cloudflare/package.json'), 'utf8')).version;
  const typesDir = join(repo, 'artifact-types');
  const types = [];
  for (const folder of readdirSync(typesDir, { withFileTypes: true })) {
    if (!folder.isDirectory()) continue;
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(join(typesDir, folder.name, 'artifact-type.json'), 'utf8'));
    } catch {
      continue;
    }
    const id = typeof manifest.slug === 'string' ? manifest.slug : folder.name;
    if (!isTypeName(id)) continue;
    types.push({ id, title: TYPES[id].title, manifest, skill: skillOf(join(typesDir, folder.name), manifest) });
  }
  types.sort((a, b) => a.id.localeCompare(b.id));
  return {
    version,
    types,
    frames: frameInfo(typesDir),
    shellHtml: readFileSync(join(daemon, 'shell', 'index.html'), 'utf8'),
    homeHtml: readFileSync(join(daemon, 'home', 'index.html'), 'utf8'),
    // Named by the Worker when OA_PLUGINS uses a module this file does not export.
    pluginsModule: pluginsModule.startsWith(repo + '/') ? relative(repo, pluginsModule) : pluginsModule,
  };
}

/** Every file under a folder, path relative to `base` → bytes, sorted. */
function filesUnder(dir, base) {
  const out = [];
  const walk = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) out.push([relative(base, path).split('\\').join('/'), readFileSync(path)]);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

/** A hash of named files' bytes, 16 hex characters. */
function hashOf(files) {
  const hash = createHash('sha256');
  for (const [name, bytes] of files) hash.update(`\n${name}\0${bytes.length}\0`).update(bytes);
  return hash.digest('hex').slice(0, 16);
}

/**
 * The frame engine's part of `open-artifact:build`: the free-page type `page` (the Node site runs it the same way; the
 * frame types of a type catalog are a later step), and the frame client's files in the static assets.
 */
function frameInfo(typesDir) {
  const types = [];
  const dir = join(typesDir, 'page');
  const manifest = JSON.parse(readFileSync(join(dir, 'artifact-type.json'), 'utf8'));
  if (manifest.openArtifact?.style !== 'page') throw new Error('build: artifact-types/page is not a page type (openArtifact.style).');
  const own = filesUnder(join(dir, 'artifact-type'), dir);
  let indexHtml = null;
  try {
    indexHtml = readFileSync(join(dir, 'index.html'), 'utf8');
  } catch {
    indexHtml = null;
  }
  types.push({
    id: 'page',
    label: 'artifact-types/page',
    fingerprint: hashOf([['index.html', Buffer.from(indexHtml ?? '-')], ...own]),
    manifest,
    skill: skillOf(dir, manifest),
    indexHtml,
    files: Object.fromEntries(own.map(([rel, bytes]) => [rel, bytes.toString('base64')])),
    page: true,
  });
  const client = filesUnder(frameClient, frameClient);
  return { types, client: { base: `/_open-artifact/frame/${hashOf(client)}/`, files: client.map(([name]) => name) } };
}

const aliases = {
  'node:fs': join(fsDir, 'index.ts'),
  fs: join(fsDir, 'index.ts'),
  'node:fs/promises': join(fsDir, 'promises.ts'),
  'fs/promises': join(fsDir, 'promises.ts'),
  '@open-artifact/wasm-sheets/node': join(pkg, 'wasm/sheets.ts'),
};
const hostPluginApi = {
  '@open-artifact/host-plugin': join(repo, 'packages/host-plugin/src/index.ts'),
  '@open-artifact/host-plugin/testing': join(repo, 'packages/host-plugin/src/testing.ts'),
  '@open-artifact/host-plugin/contract': join(repo, 'packages/host-plugin/src/contract.ts'),
};
// workerd's inflate checks maxOutputLength against its buffer, not the bytes unpacked (src/zlib.ts).
const zlibShim = join(pkg, 'zlib.ts');

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, 'site'), { recursive: true });
mkdirSync(join(dist, 'rooms'), { recursive: true });
const info = await buildInfo();

async function bundle(entry, outfile) {
  const result = await esbuild.build({
    entryPoints: [join(pkg, entry)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    outfile,
    metafile: true,
    logLevel: 'warning',
    external: ['cloudflare:*'],
    conditions: ['workerd', 'worker'],
    // workerd's import.meta.url is no usable base; several modules make file URLs from it when they load.
    define: { 'import.meta.url': '"file:///bundle/worker.js"' },
    plugins: [
      {
        name: 'open-artifact-cloudflare',
        setup(build) {
          build.onResolve({ filter: /^(node:)?fs(\/promises)?$|^@open-artifact\/wasm-sheets\/node$/ }, (args) => {
            if (args.importer.startsWith(fsDir)) return null;
            return { path: aliases[args.path] };
          });
          build.onResolve({ filter: /^(node:)?zlib$/ }, (args) => (args.importer === zlibShim ? null : { path: zlibShim }));
          // The engine: a module workerd compiles at upload, beside the bundle.
          build.onResolve({ filter: /\.wasm$/ }, () => ({ path: './sheets.wasm', external: true }));
          build.onResolve({ filter: /^open-artifact:build$/ }, () => ({ path: 'open-artifact:build', namespace: 'open-artifact-build' }));
          build.onResolve({ filter: /^open-artifact:plugins$/ }, () => ({ path: pluginsModule }));
          // A plugin imports the plugin API without installing it, wherever its file lives (as on the Node host):
          // the host's own copy.
          build.onResolve({ filter: /^@open-artifact\/host-plugin(\/(testing|contract))?$/ }, (args) => ({ path: hostPluginApi[args.path] }));
          build.onLoad({ filter: /.*/, namespace: 'open-artifact-build' }, () => ({ contents: `export default ${JSON.stringify(info)};`, loader: 'js' }));
        },
      },
    ],
  });
  cpSync(wasm, join(dirname(outfile), 'sheets.wasm'));
  const out = Object.values(result.metafile.outputs)[0];
  const builtins = [...new Set(out.imports.filter((i) => i.external).map((i) => i.path))].sort();
  console.log(`build: ${relative(here, outfile)} ${(out.bytes / 1024 / 1024).toFixed(1)} MB from ${Object.keys(result.metafile.inputs).length} files; built-ins left to workerd: ${builtins.join(' ')}`);
}

await bundle('worker.ts', join(dist, 'site', 'worker.js'));
await bundle('dev-worker.ts', join(dist, 'rooms', 'worker.js'));

const assets = join(dist, 'assets/_open-artifact');
mkdirSync(assets, { recursive: true });
cpSync(join(server, 'editors'), join(assets, 'editors'), { recursive: true });
cpSync(join(server, 'shell'), join(assets, 'shell'), { recursive: true });
cpSync(join(server, 'support.js'), join(assets, 'support.js'));
// The frame client under its content hash (the Worker fetches each file once per isolate and serves it itself, from the
// artifact's object, `no-store`: the inner shell's addresses are relative to a page token; see src/frames.ts).
cpSync(frameClient, join(dist, 'assets', info.frames.client.base), { recursive: true });
// The home page's files; its index.html is a template the Worker serves with its boot (in `open-artifact:build`).
cpSync(join(daemon, 'home'), join(assets, 'home'), { recursive: true, filter: (source) => source !== join(daemon, 'home', 'index.html') });
// Headers the platform adds to static assets (the Node host's: hashed Shell and home files cached a year, nosniff, and
// Origin-Agent-Cluster, which every page of both origins carries, since a browser keys a cluster by the first it sees;
// a Worker's origins are always potentially trustworthy, https or localhost under wrangler dev, so it takes effect).
writeFileSync(
  join(dist, 'assets', '_headers'),
  [
    '/_open-artifact/*',
    '  X-Content-Type-Options: nosniff',
    '  Origin-Agent-Cluster: ?1',
    '/_open-artifact/shell/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '/_open-artifact/home/assets/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '/_open-artifact/frame/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '',
  ].join('\n'),
);
console.log(`build: host plugins from ${relative(here, pluginsModule) || pluginsModule}`);
console.log(`build: sheets.wasm ${(statSync(wasm).size / 1024 / 1024).toFixed(1)} MB; ${info.types.length} types (${info.types.map((t) => t.id).join(', ')}); version ${info.version}; frame types ${info.frames.types.map((t) => t.id).join(', ')}, frame client at ${info.frames.client.base}`);
