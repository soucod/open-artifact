#!/usr/bin/env node
/**
 * Stages the npm packages in dist/npm/<folder>/, one folder per package, ready for `npm publish` from there. The
 * workspace's own package.json files stay private, so nothing is published from the repository by mistake.
 *
 *   @open-artifact/<library>  the libraries in LIBRARIES, compiled from TypeScript to JavaScript with .d.ts files
 *                             (src/ keeps its layout; exports point at the .js and .d.ts files)
 *   @open-artifact/cli        the skill folder (skills/open-artifact/): the `open-artifact` command with the daemon,
 *                             the Shell and the built-in types vendored
 *   dsh-open-artifact         the DeepSeek Harness plugin (plugins/dsh/), its `files`
 *
 * Needs a build first: `npm run build` (the frame client, the DSH plugin) and `node scripts/build-skill.mjs`.
 *
 *   node scripts/build-npm.mjs              stage every package; prints them in publishing order
 *   node scripts/build-npm.mjs --order      print the folders in publishing order (dependencies first)
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { relativeTsSpecifiers, rewriteDeclarationSpecifiers } from './declaration-specifiers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist', 'npm');
const TSC_OUT = join(ROOT, 'dist', 'npm-tsc');
const REPOSITORY = 'https://github.com/JimLiu/open-artifact';

/** The workspace packages published as libraries (folders under packages/). Apps and the daemon stay private. */
const LIBRARIES = [
  'protocol',
  'harness-kit',
  'host-plugin',
  'runtime',
  'server-sdk',
  'ui',
  'editor-kit',
  'export-kit',
  'canvas-engine',
  'dc',
  'design-core',
  'design-system-core',
  'slides-core',
  'live-store',
  'whiteboard-core',
  'data-core',
  'sheets-core',
  'docs-core',
  'motion-core',
  'motion-stage',
  'motion-audio',
  'motion-export',
  'wasm-canvas',
  'wasm-export',
  'wasm-wb-geom',
  'wasm-data-rules',
  'wasm-sheets',
  'wasm-motion',
];
/** Imported by a library but left to the app that uses it, which brings its own copy. */
const PEERS = new Set(['react', 'react-dom']);

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const log = (line) => console.log(`npm build: ${line}`);
const fail = (line) => {
  console.error(`npm build: ${line}`);
  process.exit(1);
};

/** Every file under `dir`, as paths relative to it. */
function walk(dir, base = dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path, base) : [relative(base, path)];
  });
}

const rootPkg = readJson(join(ROOT, 'package.json'));
const workspace = new Map(
  readdirSync(join(ROOT, 'packages'))
    .filter((dir) => existsSync(join(ROOT, 'packages', dir, 'package.json')))
    .map((dir) => [readJson(join(ROOT, 'packages', dir, 'package.json')).name, dir]),
);
const builtins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);

/** The version range a published package asks for `name`. */
function versionOf(name, own) {
  const dir = workspace.get(name);
  if (dir) {
    if (!LIBRARIES.includes(dir)) fail(`a library imports ${name}, which is not published`);
    return readJson(join(ROOT, 'packages', dir, 'package.json')).version;
  }
  const declared = own[name] ?? rootPkg.dependencies?.[name] ?? rootPkg.devDependencies?.[name];
  if (declared) return /^\d/.test(declared) ? `^${declared}` : declared;
  const installed = join(ROOT, 'node_modules', name, 'package.json');
  if (existsSync(installed)) return `^${readJson(installed).version}`;
  fail(`no version for ${name}`);
}

/** The packages the files in `dir` import (bare specifiers, by package name). */
function importsOf(dir) {
  const names = new Set();
  // `import … from 'x'`, `export … from 'x'`, `import 'x'`, `import('x')`, with x a package name.
  const pattern = /(?:^\s*(?:import|export)\b[^'"`;]*?\bfrom\s*|^\s*import\s*|\bimport\s*\(\s*)['"]((?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(?:\/[\w./-]*)?)['"]/gm;
  for (const file of walk(dir).filter((f) => /\.(js|mjs|d\.ts)$/.test(f))) {
    for (const [, spec] of readFileSync(join(dir, file), 'utf8').matchAll(pattern)) {
      if (builtins.has(spec) || spec.startsWith('node:')) continue;
      const parts = spec.split('/');
      names.add(spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]);
    }
  }
  return names;
}

/** The fields every published package.json shares. */
function common(pkg, directory) {
  return {
    license: pkg.license ?? 'Apache-2.0',
    author: { name: 'Jim Liu 宝玉', url: 'https://github.com/JimLiu' },
    homepage: `${REPOSITORY}#readme`,
    repository: { type: 'git', url: `git+${REPOSITORY}.git`, directory },
    bugs: { url: `${REPOSITORY}/issues` },
    publishConfig: { access: 'public' },
  };
}

function copyLegal(dir) {
  for (const file of ['LICENSE', 'NOTICE']) cpSync(join(ROOT, file), join(dir, file));
}

// ---------------------------------------------------------------- libraries

function compileLibraries() {
  rmSync(TSC_OUT, { recursive: true, force: true });
  mkdirSync(TSC_OUT, { recursive: true });
  const tsconfig = {
    extends: '../../tsconfig.json',
    compilerOptions: {
      noEmit: false,
      declaration: true,
      rewriteRelativeImportExtensions: true,
      rootDir: '../../packages',
      outDir: './out',
      sourceMap: false,
    },
    include: [
      ...LIBRARIES.flatMap((dir) => [`../../packages/${dir}/src/**/*.ts`, `../../packages/${dir}/src/**/*.tsx`]),
      '../../packages/server-sdk/bin/*.ts',
    ],
    // The frame client is browser scripts, built on their own into dist/daemon/frame-host/client.
    exclude: ['../../packages/server-sdk/src/frame/client/**'],
  };
  writeJson(join(TSC_OUT, 'tsconfig.json'), tsconfig);
  try {
    execFileSync(process.execPath, [join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', join(TSC_OUT, 'tsconfig.json')], {
      cwd: ROOT,
      stdio: 'inherit',
    });
  } catch {
    fail('tsc failed');
  }
}

/** `./src/x.ts` → `{ types, default }` of the compiled file; other paths stay. */
function compiledExport(target) {
  if (typeof target !== 'string' || !/\.tsx?$/.test(target)) return target;
  const base = target.replace(/\.tsx?$/, '');
  return { types: `${base}.d.ts`, default: `${base}.js` };
}

function stageLibrary(dir) {
  const source = join(ROOT, 'packages', dir);
  const pkg = readJson(join(source, 'package.json'));
  const out = join(OUT, dir);
  const compiled = join(TSC_OUT, 'out', dir);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  cpSync(join(compiled, 'src'), join(out, 'src'), { recursive: true });
  // What the compiler does not carry: authored declarations and assets next to the sources.
  for (const file of walk(join(source, 'src')).filter((f) => f.endsWith('.d.ts') || !/\.tsx?$/.test(f))) {
    if (dir === 'server-sdk' && file.startsWith(join('frame', 'client'))) continue;
    mkdirSync(dirname(join(out, 'src', file)), { recursive: true });
    cpSync(join(source, 'src', file), join(out, 'src', file));
  }
  const assets = ['generated', ...(dir === 'motion-core' ? ['fonts'] : [])]
    .filter((name) => existsSync(join(source, name)));
  for (const name of assets) cpSync(join(source, name), join(out, name), { recursive: true });
  if (existsSync(join(compiled, 'bin'))) cpSync(join(compiled, 'bin'), join(out, 'bin'), { recursive: true });
  if (dir === 'server-sdk') {
    const client = join(ROOT, 'dist', 'daemon', 'frame-host', 'client');
    if (!existsSync(client)) fail('dist/daemon/frame-host/client is missing; run npm run build first');
    cpSync(client, join(out, 'src', 'frame', 'client'), { recursive: true });
  }
  // A worker started by URL keeps the `.ts` the compiler does not rewrite.
  for (const file of walk(out).filter((f) => f.endsWith('.js'))) {
    const path = join(out, file);
    const text = readFileSync(path, 'utf8');
    const fixed = text.replace(/new URL\((['"])(\.\.?\/[^'"]+)\.tsx?\1/g, 'new URL($1$2.js$1');
    if (fixed !== text) writeFileSync(path, fixed);
  }
  // Declarations, compiled or authored: tsc rewrites `./x.ts` to `./x.js` in the JavaScript only, so a consumer that
  // reads the specifiers as they are (node16/nodenext without allowImportingTsExtensions) would look for a missing file.
  for (const file of walk(out).filter((f) => /\.d\.[cm]?ts$/.test(f))) {
    const path = join(out, file);
    const text = readFileSync(path, 'utf8');
    const fixed = rewriteDeclarationSpecifiers(text);
    if (fixed !== text) writeFileSync(path, fixed);
    const left = relativeTsSpecifiers(fixed);
    if (left.length) fail(`dist/npm/${dir}/${file} still imports ${left.join(', ')}`);
  }

  const own = { ...pkg.dependencies, ...pkg.peerDependencies };
  const dependencies = {};
  const peerDependencies = {};
  for (const name of [...importsOf(out)].sort()) {
    if (name === pkg.name) continue;
    if (name === '@types/react' || name === 'csstype') continue;
    (PEERS.has(name) ? peerDependencies : dependencies)[name] = versionOf(name, own);
  }
  // Packages a stylesheet imports: Tailwind is the app's own build tool (an optional peer), the rest dependencies.
  const peerDependenciesMeta = {};
  for (const file of walk(join(out, 'src')).filter((f) => f.endsWith('.css'))) {
    for (const [, spec] of readFileSync(join(out, 'src', file), 'utf8').matchAll(/^@import\s+["']([^"'./][^"']*)["']/gm)) {
      const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
      if (name === pkg.name || name in dependencies) continue;
      if (name === 'tailwindcss') {
        peerDependencies[name] = versionOf(name, own);
        peerDependenciesMeta[name] = { optional: true };
      } else dependencies[name] = versionOf(name, own);
    }
  }

  const exports = Object.fromEntries(Object.entries(pkg.exports ?? {}).map(([key, target]) => [key, compiledExport(target)]));
  exports['./package.json'] = './package.json';
  const bin = pkg.bin
    ? Object.fromEntries(Object.entries(pkg.bin).map(([name, path]) => [name, path.replace(/^\.\//, '').replace(/\.tsx?$/, '.js')]))
    : undefined;
  const published = {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description,
    type: 'module',
    ...(bin ? { bin } : {}),
    exports,
    files: ['src', ...assets, ...(bin ? ['bin'] : []), 'LICENSE', 'NOTICE'],
    ...(Object.keys(dependencies).length ? { dependencies } : {}),
    ...(Object.keys(peerDependencies).length ? { peerDependencies } : {}),
    ...(Object.keys(peerDependenciesMeta).length ? { peerDependenciesMeta } : {}),
    ...(pkg.engines ? { engines: pkg.engines } : {}),
    sideEffects: pkg.sideEffects,
    ...common(pkg, `packages/${dir}`),
  };
  writeJson(join(out, 'package.json'), published);
  copyLegal(out);
  if (existsSync(join(source, 'README.md'))) cpSync(join(source, 'README.md'), join(out, 'README.md'));
  else {
    writeFileSync(
      join(out, 'README.md'),
      `# ${pkg.name}\n\n${pkg.description ?? ''}\n\nPart of [Open Artifact](${REPOSITORY}): slide decks, design canvases and whiteboards an agent makes\nand you view, edit and comment on in one local page. Source: [\`packages/${dir}\`](${REPOSITORY}/tree/main/packages/${dir}).\n`,
    );
  }
  return published;
}

// ---------------------------------------------------------------- @open-artifact/cli

function stageCli() {
  const skill = join(ROOT, 'skills', 'open-artifact');
  if (!existsSync(join(skill, 'vendor', 'open-artifact.mjs'))) fail('skills/open-artifact/vendor is missing; run node scripts/build-skill.mjs first');
  // The motion type's `stills` command loads this page; it comes from node scripts/build.mjs, beside the shared cli.mjs.
  if (!existsSync(join(skill, 'vendor', 'type-server', 'motion-tools.html')))
    fail('the vendored type server has no motion-tools.html; run node scripts/build.mjs, then node scripts/build-skill.mjs');
  const out = join(OUT, 'cli');
  rmSync(out, { recursive: true, force: true });
  cpSync(skill, out, { recursive: true });
  const daemon = readJson(join(ROOT, 'packages', 'daemon', 'package.json'));
  const published = {
    name: '@open-artifact/cli',
    version: daemon.version,
    description:
      'The open-artifact command: the local Open Artifact daemon with its Shell and the built-in types (slides, design, design system, whiteboard, sheets, data, docs, motion, page), an MCP server for agent apps, and the hooks that bring page comments back to the agent.',
    type: 'module',
    bin: { 'open-artifact': 'scripts/open-artifact.mjs' },
    files: ['scripts', 'vendor', 'reference', 'SKILL.md', 'LICENSE', 'NOTICE'],
    engines: rootPkg.engines,
    keywords: ['artifacts', 'slides', 'design', 'design-system', 'whiteboard', 'sheets', 'spreadsheet', 'data', 'docs', 'motion', 'animation', 'dashboard', 'page', 'mcp', 'agent'],
    ...common(daemon, 'skills/open-artifact'),
    // The Harness API versions this runtime speaks: runtime updates install only versions every adapter here speaks.
    ...(existsSync(join(skill, 'vendor', 'runtime.json')) ? { openArtifact: { protocols: readJson(join(skill, 'vendor', 'runtime.json')).protocols } } : {}),
  };
  writeJson(join(out, 'package.json'), published);
  copyLegal(out);
  writeFileSync(
    join(out, 'README.md'),
    `# @open-artifact/cli

The \`open-artifact\` command of [Open Artifact](${REPOSITORY}): slide decks, design canvases and whiteboards an agent
makes as folders of files, which you view, edit, comment on and export in one local page. Comments sent from the
page come back to the agent. Needs Node.js 22.18 or later.

\`\`\`bash
npx @open-artifact/cli artifact '{"action":"list","scope":"types"}'   # the Artifact tool from the command line
npx @open-artifact/cli mcp --harness <name>                           # a stdio MCP server for an agent app
npx @open-artifact/cli daemon status
npx @open-artifact/cli help
\`\`\`

It carries the daemon, the Shell and the built-in types, and starts the one local daemon when none runs. The same
folder is the \`open-artifact\` skill (\`SKILL.md\`); the plugins for Claude Code, Codex, Cursor, Copilot and
Antigravity carry it too. See the [repository](${REPOSITORY}) for them.
`,
  );
  return published;
}

// ---------------------------------------------------------------- dsh-open-artifact

function stageDsh() {
  const source = join(ROOT, 'plugins', 'dsh');
  const pkg = readJson(join(source, 'package.json'));
  if (!existsSync(join(source, 'lib', 'index.js')) || !existsSync(join(source, 'vendor'))) fail('plugins/dsh is not built; run npm run build first');
  const out = join(OUT, 'dsh-open-artifact');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const entry of pkg.files) {
    if (!existsSync(join(source, entry))) fail(`plugins/dsh/${entry} is missing`);
    cpSync(join(source, entry), join(out, entry), { recursive: true });
  }
  const { private: _private, devDependencies: _dev, scripts: _scripts, ...rest } = pkg;
  const published = { ...rest, files: [...pkg.files, 'LICENSE'], ...common(pkg, 'plugins/dsh') };
  writeJson(join(out, 'package.json'), published);
  copyLegal(out);
  return published;
}

// ---------------------------------------------------------------- order

/** Folders under dist/npm/, dependencies first. */
function publishingOrder(packages) {
  const byName = new Map(packages.map((p) => [p.pkg.name, p]));
  const done = new Set();
  const order = [];
  const visit = (p) => {
    if (done.has(p.pkg.name)) return;
    done.add(p.pkg.name);
    for (const dep of Object.keys(p.pkg.dependencies ?? {})) if (byName.has(dep)) visit(byName.get(dep));
    order.push(p.folder);
  };
  for (const p of packages) visit(p);
  return order;
}

if (process.argv.includes('--order')) {
  const packages = readdirSync(OUT)
    .filter((folder) => existsSync(join(OUT, folder, 'package.json')))
    .map((folder) => ({ folder, pkg: readJson(join(OUT, folder, 'package.json')) }));
  console.log(publishingOrder(packages).join('\n'));
  process.exit(0);
}

compileLibraries();
const staged = LIBRARIES.map((dir) => ({ folder: dir, pkg: stageLibrary(dir) }));
staged.push({ folder: 'cli', pkg: stageCli() });
staged.push({ folder: 'dsh-open-artifact', pkg: stageDsh() });
rmSync(TSC_OUT, { recursive: true, force: true });
for (const folder of publishingOrder(staged)) {
  const { pkg } = staged.find((p) => p.folder === folder);
  log(`dist/npm/${folder}  ${pkg.name}@${pkg.version}`);
}
