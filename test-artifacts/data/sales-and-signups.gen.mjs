#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeTestConnectors } from '../test-connectors.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const cli = path.join(repo, 'artifact-types', 'data', 'scripts', 'cli.mjs');
const load = path.join(repo, 'e2e', 'fixtures', 'data', 'load.mjs');
const root = path.join(here, 'sales-and-signups');

if (!existsSync(cli)) {
  console.error('No data CLI yet: run npm run build first.');
  process.exit(1);
}

const state = path.join(here, '..', '.home', 'data-cli');
const env = { ...process.env, OPEN_ARTIFACT_CONNECTORS: writeTestConnectors(state), OPEN_ARTIFACT_TYPE_SERVER_HOME: state };
for (const name of ['db', '_blobs']) rmSync(path.join(root, name), { recursive: true, force: true });
execFileSync(process.execPath, [load, cli, root], { env });
execFileSync(process.execPath, [cli, 'check', root], { env, stdio: 'inherit' });
