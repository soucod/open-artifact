/**
 * `OpenArtifactErrorCode` names every code the platform throws: a scan of `new OpenArtifactError('…'` and
 * `httpError('…'` in the daemon, the kit, the protocol and the hosts, and of the `newer_release` refusal.
 */

import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const PACKAGES = fileURLToPath(new URL('../../', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'node_modules' || name === 'generated' ? [] : sources(path);
    return /\.(ts|mjs)$/.test(name) ? [path] : [];
  });
}

test('every code thrown by the platform is in OpenArtifactErrorCode', () => {
  const declared = new Set([...readFileSync(join(PACKAGES, 'protocol/src/errors.ts'), 'utf8').matchAll(/^\s*\| '([a-z_]+)'/gm)].map((m) => m[1]));
  const thrown = new Map<string, string>();
  for (const pkg of ['daemon', 'harness-kit', 'protocol', 'host', 'host-cloudflare']) {
    for (const file of sources(join(PACKAGES, pkg, 'src'))) {
      const text = readFileSync(file, 'utf8');
      for (const [, code] of text.matchAll(/(?:new OpenArtifactError|httpError)\(\s*'([a-z_]+)'/g)) thrown.set(code!, file);
    }
  }
  thrown.set('newer_release', 'daemon/src/release-guard.ts');
  assert.ok(thrown.size > 20, [...thrown.keys()].join(', '));
  const missing = [...thrown].filter(([code]) => !declared.has(code)).map(([code, file]) => `${code} (${file})`);
  assert.deepEqual(missing, []);
});
