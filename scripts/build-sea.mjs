#!/usr/bin/env node
/**
 * Builds the single executable for the platform it runs on (design 11, 15): `dist/sea/open-artifact-<platform>-<arch>`
 * (`.exe` on Windows), Node with the runtime inside, for a host that has neither Node nor Electron. It has the same
 * command line as `open-artifact`; on first use it unpacks the runtime into `<OPEN_ARTIFACT_HOME>/runtime/<version>/`
 * and runs it from there, and it runs the runtime's own processes (the daemon, type servers) as Node would
 * (packages/daemon/src/sea.ts).
 *
 *   dist/sea/stage/package/        the runtime: skills/open-artifact/ (scripts/, vendor/, SKILL.md) with the package.json
 *                                  @open-artifact/cli publishes (scripts/build-npm.mjs), so the unpacked folder is that
 *                                  package
 *   dist/sea/stage/runtime.tgz     that folder as one gzip tarball (the asset `runtime.tgz`)
 *   dist/sea/stage/runtime.json    its version, sha512 and protocols (the asset `runtime.json`)
 *   dist/sea/stage/main.cjs        the entry, sea.ts bundled
 *   dist/sea/stage/sea-config.json Node's single executable configuration
 *
 * Needs `npm run build` and `node scripts/build-skill.mjs` first (the skill's vendor/ is the runtime), and a Node that
 * can build a single executable: an official build (nodejs.org) of Node 25.5 or newer, which has `--build-sea`. That
 * Node is also the one inside the executable. Node 22 and 24 builds need the separate `postject` injector, which this
 * script does not use; a Node built without single executable support (Homebrew's, which links libnode) cannot be one.
 * On macOS the result is signed ad hoc (`codesign --sign -`), which Apple Silicon requires to run it at all.
 *
 *   node scripts/build-sea.mjs [--node <path to node>] [--out <file>]
 *
 * `--node` (or `$OPEN_ARTIFACT_SEA_NODE`) is the Node to build with and embed; default: the one running this script.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, readSync, closeSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { buildSync } from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = join(ROOT, 'skills', 'open-artifact');
const OUT_DIR = join(ROOT, 'dist', 'sea');
const STAGE = join(OUT_DIR, 'stage');
/** The fuse Node's single executable support looks for (`:0` until a blob is injected). */
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const log = (line) => console.log(`sea build: ${line}`);

/** Thrown for what stops the build; the message says what to do. */
export class SeaBuildError extends Error {}

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/** The executable's file name for a platform and architecture. */
export function executableName(platform = process.platform, arch = process.arch) {
  return `open-artifact-${platform}-${arch}${platform === 'win32' ? '.exe' : ''}`;
}

/** Whether the file carries Node's single executable fuse (read in pieces; a Node binary is 100 MB or more). */
function hasFuse(file) {
  const needle = Buffer.from(FUSE);
  const fd = openSync(file, 'r');
  try {
    const chunk = Buffer.alloc(8 << 20);
    let carry = Buffer.alloc(0);
    for (;;) {
      const read = readSync(fd, chunk, 0, chunk.length, null);
      if (!read) return false;
      const window = Buffer.concat([carry, chunk.subarray(0, read)]);
      if (window.includes(needle)) return true;
      carry = window.subarray(Math.max(0, window.length - needle.length));
    }
  } finally {
    closeSync(fd);
  }
}

/**
 * Checks that `node` can build and be a single executable: its version, `--build-sea`, and the fuse in the file
 * itself (not in a shared library it loads). Returns its version.
 */
export function checkBaseNode(node) {
  if (!existsSync(node)) throw new SeaBuildError(`${node} does not exist.`);
  const version = execFileSync(node, ['-p', 'process.versions.node'], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } }).trim();
  const [major = 0, minor = 0] = version.split('.').map(Number);
  const help = spawnSync(node, ['--help'], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } }).stdout ?? '';
  const official = 'Pass --node <file> (or set OPEN_ARTIFACT_SEA_NODE) with an official Node.js build (https://nodejs.org/download/release/) of 25.5 or newer for this platform.';
  if (!help.includes('--build-sea')) {
    throw new SeaBuildError(`Node ${version} at ${node} has no --build-sea (it came in Node 25.5; ${major} ≤ 24 needs the postject injector, which this build does not use). ${official}`);
  }
  if (!hasFuse(node)) {
    throw new SeaBuildError(`${node} (Node ${version}) has no single executable fuse in its own file: it was built without single executable support or keeps Node in a shared library (Homebrew's node loads libnode). ${official}`);
  }
  if (major < 22 || (major === 22 && minor < 18)) throw new SeaBuildError(`Node ${version} is older than the runtime needs (22.18). ${official}`);
  return version;
}

/** Every file under `dir`, relative to it, sorted (so the tarball is the same from the same input). */
function walk(dir, base = dir) {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      const stat = statSync(path);
      if (stat.isDirectory()) return name === 'node_modules' ? [] : walk(path, base);
      return stat.isFile() ? [relative(base, path).split(sep).join('/')] : [];
    });
}

/** One 512-byte ustar header. */
function ustarHeader({ name, size, mode, type }) {
  const block = Buffer.alloc(512);
  const put = (text, at, length) => block.write(text, at, length, 'utf8');
  const octal = (value, at, length) => put(`${value.toString(8).padStart(length - 1, '0')}\0`, at, length);
  put(name, 0, 100);
  octal(mode, 100, 8);
  octal(0, 108, 8);
  octal(0, 116, 8);
  octal(size, 124, 12);
  octal(0, 136, 12);
  block.fill(0x20, 148, 156);
  put(type, 156, 1);
  put('ustar\0', 257, 6);
  put('00', 263, 2);
  let sum = 0;
  for (const byte of block) sum += byte;
  put(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  return block;
}

/** A pax record `<length> <key>=<value>\n`, whose length counts itself. */
function paxRecord(key, value) {
  const body = ` ${key}=${value}\n`;
  let length = Buffer.byteLength(body) + 1;
  while (String(length).length + Buffer.byteLength(body) !== length) length = String(length).length + Buffer.byteLength(body);
  return `${length}${body}`;
}

const pad = (size) => Buffer.alloc((512 - (size % 512)) % 512);

/**
 * `dir` as a gzip tarball with one top folder (`package/`, as npm packs), regular files only, a long path in a pax
 * header: what `readTarball` in packages/daemon/src/runtime.ts reads.
 */
export function packFolder(dir) {
  const parts = [];
  for (const rel of walk(dir)) {
    const file = join(dir, rel);
    const data = readFileSync(file);
    const mode = statSync(file).mode & 0o111 ? 0o755 : 0o644;
    const name = `package/${rel}`;
    if (Buffer.byteLength(name) > 99) {
      const pax = Buffer.from(paxRecord('path', name));
      parts.push(ustarHeader({ name: 'PaxHeader', size: pax.length, mode: 0o644, type: 'x' }), pax, pad(pax.length));
    }
    const short = Buffer.byteLength(name) > 99 ? name.slice(0, 99) : name;
    parts.push(ustarHeader({ name: short, size: data.length, mode, type: '0' }), data, pad(data.length));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts), { level: 9 });
}

/** The runtime folder the executable carries: the skill folder with the package.json npm publishes. */
function stageRuntime() {
  if (!existsSync(join(SKILL, 'vendor', 'open-artifact.mjs'))) {
    throw new SeaBuildError('skills/open-artifact/vendor is missing: run npm run build, then node scripts/build-skill.mjs.');
  }
  const dir = join(STAGE, 'package');
  rmSync(dir, { recursive: true, force: true });
  cpSync(SKILL, dir, { recursive: true, filter: (path) => basename(path) !== 'node_modules' });
  const daemon = readJson(join(ROOT, 'packages', 'daemon', 'package.json'));
  const own = existsSync(join(SKILL, 'vendor', 'runtime.json')) ? readJson(join(SKILL, 'vendor', 'runtime.json')) : {};
  const pkg = {
    name: '@open-artifact/cli',
    version: daemon.version,
    type: 'module',
    bin: { 'open-artifact': 'scripts/open-artifact.mjs' },
    engines: readJson(join(ROOT, 'package.json')).engines,
    license: daemon.license ?? 'Apache-2.0',
    ...(own.protocols ? { openArtifact: { protocols: own.protocols } } : {}),
  };
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  for (const name of ['LICENSE', 'NOTICE']) if (existsSync(join(ROOT, name))) cpSync(join(ROOT, name), join(dir, name));
  return { dir, version: pkg.version, protocols: own.protocols };
}

/** sea.ts bundled as the executable's CommonJS entry. */
function bundleEntry(file) {
  buildSync({
    stdin: { contents: "import { seaMain } from './sea.ts';\nvoid seaMain();\n", resolveDir: join(ROOT, 'packages', 'daemon', 'src'), sourcefile: 'sea-entry.ts', loader: 'ts' },
    outfile: file,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    charset: 'utf8',
    legalComments: 'none',
    logLevel: 'warning',
  });
}

/** Signs the executable where the platform needs it after injection; says what was done. */
function sign(file) {
  if (process.platform === 'darwin') {
    const which = spawnSync('codesign', ['--version']);
    if (which.error) return 'not signed: codesign is not on this Mac (Xcode command line tools); Apple Silicon will not run it unsigned';
    execFileSync('codesign', ['--sign', '-', '--force', file], { stdio: 'inherit' });
    return 'signed ad hoc (codesign --sign -); a release signs with a Developer ID and notarizes';
  }
  if (process.platform === 'win32') return 'not signed (the injection invalidated Node\'s signature; a release signs it with signtool)';
  return 'no signature needed on Linux';
}

/** Builds the executable; returns where it is and what it carries. */
export function buildSea({ node = process.env.OPEN_ARTIFACT_SEA_NODE || process.execPath, out } = {}) {
  const nodeVersion = checkBaseNode(node);
  mkdirSync(STAGE, { recursive: true });
  const runtime = stageRuntime();
  const tgz = packFolder(runtime.dir);
  const integrity = `sha512-${createHash('sha512').update(tgz).digest('base64')}`;
  writeFileSync(join(STAGE, 'runtime.tgz'), tgz);
  const manifest = { version: runtime.version, integrity, ...(runtime.protocols ? { protocols: runtime.protocols } : {}) };
  writeFileSync(join(STAGE, 'runtime.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  bundleEntry(join(STAGE, 'main.cjs'));
  const output = resolve(out ?? join(OUT_DIR, executableName()));
  mkdirSync(dirname(output), { recursive: true });
  rmSync(output, { force: true });
  const config = {
    main: join(STAGE, 'main.cjs'),
    output,
    executable: node,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
    assets: { 'runtime.tgz': join(STAGE, 'runtime.tgz'), 'runtime.json': join(STAGE, 'runtime.json') },
  };
  writeFileSync(join(STAGE, 'sea-config.json'), `${JSON.stringify(config, null, 2)}\n`);
  const built = spawnSync(node, ['--build-sea', join(STAGE, 'sea-config.json')], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } });
  if (built.status !== 0 || !existsSync(output)) {
    throw new SeaBuildError(`${node} --build-sea failed (exit ${built.status ?? built.signal}):\n${(built.stderr || built.stdout || '').trim()}`);
  }
  chmodSync(output, 0o755);
  const signed = sign(output);
  return { file: output, size: statSync(output).size, version: runtime.version, node: nodeVersion, payload: tgz.length, signed };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : undefined;
  };
  try {
    const node = arg('node');
    const out = arg('out');
    const result = buildSea({ ...(node ? { node: resolve(node) } : {}), ...(out ? { out } : {}) });
    const mb = (n) => `${(n / (1 << 20)).toFixed(1)} MB`;
    log(`${relative(process.cwd(), result.file) || result.file}: Open Artifact ${result.version} on Node ${result.node}, ${mb(result.size)} (runtime ${mb(result.payload)} compressed); ${result.signed}`);
  } catch (error) {
    console.error(`sea build: ${error instanceof SeaBuildError ? error.message : error?.stack ?? error}`);
    process.exit(1);
  }
}
