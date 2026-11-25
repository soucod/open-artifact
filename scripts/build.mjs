#!/usr/bin/env node
/**
 * Builds everything the type server serves into `dist/server/`:
 *
 *   dist/server/cli.mjs                 the `open-artifact-type-server` CLI and type server (one file, Node ≥ 22)
 *   dist/server/motion-tools.html       the page the CLI's `stills` draws a motion artifact's stills in (headless Chromium)
 *   dist/server/support.js              the board runtime loaded by every artboard
 *   dist/server/editors/<type>/         each editor page (Vite)
 *   dist/server/pdf-reader.mjs          PDF.js, loaded only when a PDF is imported into a doc
 *   dist/server/pdf-cmaps/              its character maps
 *
 * and then copies the whole of `dist/server/` into `artifact-types/<type>/scripts/`
 * (git ignores it), so a type folder works on its own once installed. Every
 * copy carries every editor: the CLI shares one background server between
 * types, and whichever copy starts it must serve both pages.
 *
 * It also builds the daemon's pages and the DSH plugin:
 *
 *   dist/daemon/shell/, dist/daemon/home/   the Shell and home page (Vite, packages/shell)
 *   dist/daemon/frame-host/                 frame-host and its
 *                                           browser scripts in client/
 *   plugins/dsh/lib, vendor/                the DSH plugin and its vendored daemon
 *
 * Usage: node scripts/build.mjs [--only cli|support|editors|types|shell|frame|dsh]
 *        node scripts/build.mjs --only sea [--node <file>]   the single executable (scripts/build-sea.mjs), never by default
 */

import { build as esbuild } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { chmod, cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist/server');
const VITE_BIN = join(ROOT, 'node_modules/vite/bin/vite.js');

/** Runs one Vite build in its own process so memory from eight editors does not pile up in one heap. */
function runVite(config) {
  execFileSync(process.execPath, [VITE_BIN, 'build', '--config', config, '--logLevel', 'warn'], { cwd: ROOT, stdio: 'inherit' });
}

/** Editors by type name → their package folder. */
const EDITORS = {
  design: 'packages/design-editor',
  'design-system': 'packages/design-system-editor',
  whiteboard: 'packages/whiteboard-editor',
  data: 'packages/data-editor',
  slides: 'packages/slides-editor',
  sheets: 'packages/sheets-editor',
  docs: 'packages/docs-editor',
  motion: 'packages/motion-editor',
};

const only = (() => {
  const index = process.argv.indexOf('--only');
  return index > 0 ? process.argv[index + 1] : null;
})();
const wants = (part) => !only || only === part;

/** The board runtime: one classic script, React included. */
async function buildSupport() {
  await esbuild({
    entryPoints: [join(ROOT, 'packages/dc/src/runtime/index.ts')],
    outfile: join(OUT, 'support.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    minify: true,
    legalComments: 'none',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'warning',
  });
}

/** The CLI and server, bundled with the workspace packages it imports. */
async function buildCli() {
  const outfile = join(OUT, 'cli.mjs');
  await esbuild({
    entryPoints: [join(ROOT, 'packages/type-server/src/cli.ts')],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    // The entry's own shebang is kept by esbuild.
    legalComments: 'none',
    logLevel: 'warning',
  });
  await chmod(outfile, 0o755);
  // The workbook engine, read from beside the bundle (`@open-artifact/wasm-sheets/node`).
  await cp(join(ROOT, 'packages/wasm-sheets/generated/open_artifact_sheets_bg.wasm'), join(OUT, 'sheets.wasm'));
  // The page `stills` loads a motion artifact into in a headless Chromium: the stage runtime and its driver, in one file.
  const { buildToolsPage } = await import('../packages/motion-stage/src/build.ts');
  const { STILLS_TOOLS_PAGE } = await import('../packages/motion-stage/src/stills.ts');
  await writeFile(join(OUT, STILLS_TOOLS_PAGE), await buildToolsPage());
}

/**
 * PDF.js on its own, loaded only when a PDF is imported (type-server/src/docs/import-pdf.ts looks for
 * pdf-reader.mjs and pdf-cmaps/ beside the CLI). Its canvas is optional, for drawing pages, which an import doesn't do.
 */
async function buildPdfReader() {
  await rm(join(OUT, 'pdf-cmaps'), { recursive: true, force: true });
  await esbuild({
    entryPoints: [join(ROOT, 'packages/type-server/src/docs/pdf-reader.ts')],
    outfile: join(OUT, 'pdf-reader.mjs'),
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    external: ['@napi-rs/canvas'],
    legalComments: 'none',
    logLevel: 'warning',
    banner: { js: '// PDF.js (Apache-2.0), bundled for importing PDFs into a doc.' },
  });
  const pdfjs = dirname(createRequire(join(ROOT, 'packages/type-server/package.json')).resolve('pdfjs-dist/package.json'));
  await cp(join(pdfjs, 'cmaps'), join(OUT, 'pdf-cmaps'), { recursive: true });
}

async function buildEditors() {
  for (const [type, folder] of Object.entries(EDITORS)) {
    const config = join(ROOT, folder, 'vite.config.ts');
    if (!existsSync(join(ROOT, folder, 'index.html'))) {
      console.warn(`skip ${type}: ${folder} has no index.html yet`);
      continue;
    }
    runVite(config);
  }
}

/** The daemon's Shell and home pages. */
async function buildShell() {
  for (const config of ['vite.config.ts', 'vite.home.config.ts']) {
    runVite(join(ROOT, 'packages/shell', config));
  }
}

/**
 * frame-host: the bin as one Node ESM file, and next to it client/ with the
 * scripts it serves (runtime.js in each page, shell.js in the inner shell)
 * built from packages/server-sdk/src/frame/client/ as plain classic scripts,
 * and the inner shell's comment views (comments.js, comments.css: Vite).
 * The daemon starts dist/daemon/frame-host/frame-host.mjs (or the DSH
 * plugin's vendor/frame-host/frame-host.mjs); the bundle finds client/ next
 * to itself.
 */
async function buildFrame() {
  const src = join(ROOT, 'packages/server-sdk');
  const out = join(ROOT, 'dist/daemon/frame-host');
  await rm(out, { recursive: true, force: true });
  await esbuild({
    entryPoints: [join(src, 'bin/frame-host.ts')],
    outfile: join(out, 'frame-host.mjs'),
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    legalComments: 'none',
    logLevel: 'warning',
  });
  await chmod(join(out, 'frame-host.mjs'), 0o755);
  for (const name of ['runtime', 'shell', 'imports']) {
    await esbuild({
      entryPoints: [join(src, `src/frame/client/${name}.ts`)],
      outfile: join(out, 'client', `${name}.js`),
      bundle: true,
      format: name === 'imports' ? 'esm' : 'iife',
      platform: 'browser',
      target: 'es2022',
      charset: 'utf8',
      legalComments: 'none',
      logLevel: 'warning',
    });
  }
  for (const file of ['shell.html', 'shell.css']) await cp(join(src, 'src/frame/client', file), join(out, 'client', file));
  // The comment views (React and the editor kit's): comments.js and comments.css beside them.
  runVite(join(src, 'vite.frame.config.ts'));
}

/** The DSH plugin (it vendors the daemon, the Shell, frame-host and the design type, so it runs last). */
async function buildDsh() {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(process.execPath, [join(ROOT, 'plugins/dsh/scripts/build.mjs')], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error('the DSH plugin build failed');
}

/** Copies the built server into each type folder. */
async function copyIntoTypes() {
  for (const type of Object.keys(EDITORS)) {
    const target = join(ROOT, 'artifact-types', type, 'scripts');
    await rm(target, { recursive: true, force: true });
    await cp(OUT, target, { recursive: true });
  }
}

await mkdir(OUT, { recursive: true });
if (!only) await rm(join(OUT, 'editors'), { recursive: true, force: true });
const started = Date.now();
if (wants('support')) await buildSupport();
if (wants('cli')) await buildCli();
if (wants('cli')) await buildPdfReader();
if (wants('editors')) await buildEditors();
const copyTypes = wants('types') || ['editors', 'cli', 'support'].includes(only);
if (wants('shell') || (copyTypes && !existsSync(join(OUT, 'shell/index.html')))) {
  await buildShell();
  await rm(join(OUT, 'shell'), { recursive: true, force: true });
  await cp(join(ROOT, 'dist/daemon/shell'), join(OUT, 'shell'), { recursive: true });
}
if (copyTypes) await copyIntoTypes();
if (only === 'shell') {
  for (const type of Object.keys(EDITORS)) {
    const target = join(ROOT, 'artifact-types', type, 'scripts/shell');
    await rm(target, { recursive: true, force: true });
    await cp(join(OUT, 'shell'), target, { recursive: true });
  }
}
if (wants('frame')) await buildFrame();
if (wants('dsh')) await buildDsh();
// The single executable (scripts/build-sea.mjs): only when asked, never part of the whole build; `--node <file>` passes on.
if (only === 'sea') {
  const { spawnSync } = await import('node:child_process');
  const node = process.argv.indexOf('--node');
  const result = spawnSync(process.execPath, [join(ROOT, 'scripts/build-sea.mjs'), ...(node > 0 ? ['--node', process.argv[node + 1]] : [])], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log(`built ${only ?? 'everything'} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
