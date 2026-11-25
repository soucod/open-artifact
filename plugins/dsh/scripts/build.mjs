#!/usr/bin/env node
/**
 * Builds dsh-open-artifact. DSH links a plugin folder in place and installs none of its dependencies, so everything
 * the plugin runs is in these files:
 *
 *   lib/index.js   the server half (src/server/index.ts), one Node ESM file with the protocol and @open-artifact/harness-kit in it
 *   lib/client.js  the browser half (src/client/index.tsx), CommonJS in the app's `window.__ModuleLoader__.load`
 *                  wrapper, with React and the app's platform modules left to the loader
 *   vendor/        the daemon (`open-artifact.mjs`), the built Shell and home pages, frame-host (the type server from dist/daemon/frame-host), the harness profiles, the type server (type-server/) and the built-in types that run it;
 *                  a piece that is not there is skipped with a warning; and `runtime.json`, the daemon's version and protocols
 *   scripts/open-artifact.mjs  the open-artifact skill's launcher (skills/open-artifact/scripts/open-artifact.mjs), so this
 *                  folder is a runtime folder: the daemon records it from the plugin's `hello`, and another harness on
 *                  this computer can start it
 *   LICENSE, NOTICE the repository's license files, copied here so the npm package carries them
 *   CHANGELOG.md   the repository's release notes: the page's "What's new" and changelog (src/server/changelog.ts)
 *   skills/open-artifact/SKILL.md  the skill from the protocol's template, the file the skill candidate's `path` names
 *
 * The page's CSS is plain CSS in src/client/styles.ts, on the app's own design tokens, with every class prefixed.
 *
 *   node plugins/dsh/scripts/build.mjs
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';
import { PROTOCOL_MAX, PROTOCOL_MIN } from '../../../packages/protocol/src/harness.ts';
import { vendorTypes } from '../../../scripts/vendor-types.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const repo = join(root, '..', '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

/** The modules the app's loader provides to a client bundle; nothing else may stay a `require`. */
const PLATFORM_MODULES = ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'];

const warn = (message) => console.warn(`dsh-open-artifact build: ${message}`);
// The built-in types: the protocol's list (BUILTIN_TYPE_IDS), which the daemon and a site share.
const BUILTIN_TYPES = JSON.parse(
  /BUILTIN_TYPE_IDS[^=]*=\s*(?:Object\.freeze\()?(\[[^\]]*\])/.exec(readFileSync(join(repo, 'packages', 'protocol', 'src', 'type-authoring.ts'), 'utf8'))[1].replace(/'/g, '"'),
);
const log = (message) => console.log(`dsh-open-artifact build: ${message}`);

// ---------------------------------------------------------------- bundles

function buildServer() {
  buildSync({
    entryPoints: [join(root, 'src', 'server', 'index.ts')],
    outfile: join(root, 'lib', 'index.js'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    charset: 'utf8',
    legalComments: 'none',
    logLevel: 'warning',
    banner: { js: `// ${pkg.name} ${pkg.version}: the DSH plugin (server half). Built by scripts/build.mjs; do not edit.` },
  });
}

/** The client bundle in the app's module loader wrapper. */
function buildClient() {
  const result = buildSync({
    entryPoints: [join(root, 'src', 'client', 'index.tsx')],
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'cjs',
    target: 'es2022',
    jsx: 'automatic',
    charset: 'utf8',
    legalComments: 'none',
    logLevel: 'warning',
    external: PLATFORM_MODULES,
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const body = result.outputFiles[0].text
    .split('\n')
    .filter((line) => !/^\/\/ (src|scripts|\.\.\/|node_modules)\//.test(line))
    .map((line) => (line ? `\t\t${line}` : line))
    .join('\n');
  const out = [
    `// ${pkg.name} ${pkg.version}: the DSH plugin (browser half). Built by scripts/build.mjs; do not edit.`,
    'window.__ModuleLoader__.load({',
    `\tid: ${JSON.stringify(pkg.name)},`,
    '\tfactory: (require) => {',
    '\t\tvar module = { exports: {} };',
    '\t\tvar exports = module.exports;',
    body,
    '\t\treturn module.exports;',
    '\t},',
    '});',
    '',
  ].join('\n');
  const stray = [...out.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]).filter((id) => !PLATFORM_MODULES.includes(id));
  if (stray.length > 0) throw new Error(`lib/client.js requires modules the app does not provide: ${[...new Set(stray)].join(', ')}`);
  writeFileSync(join(root, 'lib', 'client.js'), out);
}

// ---------------------------------------------------------------- vendor

const isDir = (path) => existsSync(path) && statSync(path).isDirectory();

/** Copies a folder into vendor/, leaving out node_modules; warns when it is not there. */
function vendorCopy(from, to, what) {
  if (!isDir(from)) return warn(`${what}: ${relative(repo, from)} is not there; skipped.`);
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true, filter: (path) => basename(path) !== 'node_modules' });
}

function buildVendor() {
  const vendor = join(root, 'vendor');
  mkdirSync(vendor, { recursive: true });
  const entry = join(repo, 'packages', 'daemon', 'src', 'bin', 'open-artifact.ts');
  if (!existsSync(entry)) warn('the daemon: packages/daemon/src/bin/open-artifact.ts is not there; vendor/open-artifact.mjs skipped.');
  else {
    try {
      buildSync({
        entryPoints: [entry],
        outfile: join(vendor, 'open-artifact.mjs'),
        bundle: true,
        platform: 'node',
        format: 'esm',
        target: 'node22',
        charset: 'utf8',
        legalComments: 'none',
        logLevel: 'silent',
        // Bundled ESM still meets CommonJS dependencies that call require().
        banner: { js: "import { createRequire as __openArtifactCreateRequire } from 'node:module'; const require = __openArtifactCreateRequire(import.meta.url);" },
      });
    } catch (error) {
      rmSync(join(vendor, 'open-artifact.mjs'), { force: true });
      warn(`the daemon did not bundle; vendor/open-artifact.mjs skipped: ${error.message.split('\n')[0]}`);
    }
  }
  vendorCopy(join(repo, 'dist', 'daemon', 'shell'), join(vendor, 'shell'), 'the Shell');
  vendorCopy(join(repo, 'dist', 'daemon', 'home'), join(vendor, 'home'), 'the home page');
  // The daemon looks for it next to itself: vendor/frame-host/frame-host.mjs.
  vendorCopy(join(repo, 'dist', 'daemon', 'frame-host'), join(vendor, 'frame-host'), 'frame-host');
  vendorCopy(join(repo, 'packages', 'daemon', 'harnesses'), join(vendor, 'harnesses'), 'the harness profiles');
  // The built-in types, with one type server for them all, not a copy in each (scripts/vendor-types.mjs).
  vendorTypes({ repo, vendor, types: BUILTIN_TYPES, warn });
  buildRuntimeFolder(vendor);
}

/**
 * What makes the plugin folder a runtime folder (harness-kit `runtimeInfo`): `scripts/open-artifact.mjs`, the skill's
 * launcher, which runs `vendor/open-artifact.mjs` with the vendored folders, and `vendor/runtime.json`, the version
 * and the protocol range of the daemon just bundled.
 */
function buildRuntimeFolder(vendor) {
  const launcher = join(repo, 'skills', 'open-artifact', 'scripts', 'open-artifact.mjs');
  if (!existsSync(join(vendor, 'open-artifact.mjs'))) return;
  if (!existsSync(launcher)) return warn('the launcher: skills/open-artifact/scripts/open-artifact.mjs is not there; scripts/open-artifact.mjs skipped.');
  cpSync(launcher, join(root, 'scripts', 'open-artifact.mjs'));
  writeFileSync(join(vendor, 'runtime.json'), `${JSON.stringify({ version: pkg.version, protocols: { min: PROTOCOL_MIN, max: PROTOCOL_MAX } }, null, 2)}\n`);
}

// ---------------------------------------------------------------- main

/**
 * skills/open-artifact/SKILL.md: the protocol's template as the kit renders it without a daemon (no installed types),
 * so the skill candidate's `path` names a real file. DSH's registry reads the skill through the provider's `get`,
 * which renders it fresh each time (src/server/skill.ts).
 */
export async function writeSkill(into = root) {
  const { localSkill } = await import('../../../packages/harness-kit/src/skill.ts');
  const { renderedSkillFile } = await import('../../../packages/protocol/src/skill.ts');
  const { SKILL_RENDER, skillFile } = await import('../src/server/skill.ts');
  const file = skillFile(into);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, renderedSkillFile(localSkill({ ...SKILL_RENDER, agentName: 'Agent' })));
  return file;
}

/** The whole build; `--no-vendor` leaves vendor/ as it is. */
async function main() {
  mkdirSync(join(root, 'lib'), { recursive: true });
  for (const file of ['LICENSE', 'NOTICE', 'CHANGELOG.md']) cpSync(join(repo, file), join(root, file));
  buildServer();
  log('lib/index.js');
  buildClient();
  log('lib/client.js');
  await writeSkill();
  log('skills/open-artifact/SKILL.md');
  if (process.argv.includes('--no-vendor')) log('vendor/ skipped (--no-vendor)');
  else {
    buildVendor();
    log('vendor/');
  }
}

// Run as a script; imported (to check the CSS scoping), it only exports.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
