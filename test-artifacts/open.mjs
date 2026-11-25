#!/usr/bin/env node
// Opens one test artifact with its type's own CLI (no daemon, no home page) and prints its URL.
//   node test-artifacts/open.mjs                                  lists the test artifacts
//   node test-artifacts/open.mjs whiteboard/elements              opens one
//   node test-artifacts/open.mjs whiteboard/elements --stop       stops its server
//   node test-artifacts/open.mjs whiteboard/elements --reset      rebuilds it from its .gen.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeTestConnectors } from './test-connectors.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const name = argv.find((arg) => !arg.startsWith('--'))?.replace(/\/+$/, '');

/** `<type>/<name>` for every artifact folder here. */
function artifacts() {
  const folders = (dir) => readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).map((entry) => entry.name);
  return folders(HERE).flatMap((type) => folders(path.join(HERE, type)).map((artifact) => `${type}/${artifact}`));
}

if (!name) {
  console.log('Test artifacts (node test-artifacts/open.mjs <name> [--stop | --reset]):');
  for (const artifact of artifacts()) console.log(`  ${artifact}`);
  process.exit(0);
}
const root = path.join(HERE, name);
if (!existsSync(root)) {
  console.error(`No test artifact ${name}. There are: ${artifacts().join(', ')}`);
  process.exit(1);
}
const run = (script, ...args) => spawnSync(process.execPath, [script, ...args], { stdio: 'inherit' }).status ?? 1;

if (argv.includes('--reset')) {
  const generator = `${root}.gen.mjs`;
  if (!existsSync(generator)) {
    console.error(`${name} has no ${path.basename(generator)} to rebuild it from.`);
    process.exit(1);
  }
  process.exit(run(generator));
}
const type = name.split('/')[0];
const cli = path.join(HERE, '..', 'artifact-types', type, 'scripts', 'cli.mjs');
if (!existsSync(cli)) {
  console.error(`No ${type} CLI yet: run npm run build first.`);
  process.exit(1);
}
if (type === 'data') {
  const state = path.join(HERE, '.home', 'data-cli');
  process.env.OPEN_ARTIFACT_TYPE_SERVER_HOME = state;
  process.env.OPEN_ARTIFACT_CONNECTORS = writeTestConnectors(state);
}
process.exit(argv.includes('--stop') ? run(cli, 'stop', root) : run(cli, 'open', root, '--type', type, '--json'));
