#!/usr/bin/env node
// Serves the test artifacts on a home page: a daemon of their own (home folder test-artifacts/.home), with every
// artifact in this folder in its library. Click one to open it in its editor.
//   npm run test-artifacts                    serves the home page and prints its URL (Ctrl+C stops it)
//   npm run test-artifacts -- --port 4800     on another port
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeTestConnectors } from './test-connectors.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.dirname(HERE);
const HOME = path.join(HERE, '.home');
const argv = process.argv.slice(2);
const portAt = argv.indexOf('--port');
const port = portAt >= 0 ? Number(argv[portAt + 1]) : 4790;

if (!existsSync(path.join(REPO, 'dist', 'daemon', 'home', 'index.html'))) {
  console.error('The home page is not built yet: run npm run build first.');
  process.exit(1);
}

// Everything the daemon keeps goes under .home, never into the real Open Artifact home folder.
Object.assign(process.env, {
  OPEN_ARTIFACT_HOME: path.join(HOME, 'daemon'),
  OPEN_ARTIFACT_USER_TYPES: path.join(HOME, 'types'),
  OPEN_ARTIFACT_TYPE_SERVER_HOME: path.join(HOME, 'servers'),
  OPEN_ARTIFACT_CONNECTORS: writeTestConnectors(HOME),
});

/** `{ type, name, root }` for every artifact folder here (`<type>/<name>/`). */
function artifacts() {
  const folders = (dir) =>
    readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name);
  return folders(HERE).flatMap((type) => folders(path.join(HERE, type)).map((name) => ({ type, name, root: path.join(HERE, type, name) })));
}

const { startDaemon } = await import('../packages/daemon/src/daemon.ts');
let daemon;
try {
  daemon = await startDaemon({ port, idleMs: 0, quiet: true, browse: null });
} catch (error) {
  let running = null;
  try {
    running = JSON.parse(readFileSync(path.join(HOME, 'daemon', 'daemon.json'), 'utf8'));
  } catch {
    // no state file: nothing of ours is running
  }
  if (running?.port) console.error(`The test artifacts are already being served at http://127.0.0.1:${running.port}/`);
  else console.error(`Could not start: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

const found = artifacts();
for (const { type, name, root } of found) {
  if (!daemon.store.byRoot(root)) daemon.store.create({ root, type, title: `${type}/${name}` });
}
// Forget the ones whose folder is gone.
for (const record of daemon.store.list()) {
  if (record.root.startsWith(HERE + path.sep) && !existsSync(record.root)) daemon.store.remove(record.id);
}

console.log(`Test artifacts (${found.length}): ${daemon.origin}/`);
const stop = async () => {
  await daemon.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
