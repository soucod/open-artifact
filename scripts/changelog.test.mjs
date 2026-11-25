/**
 * `scripts/changelog.mjs`: the section reader, the Integrators rule's parts, and `--check` end to end against a small
 * git repository in a temporary folder (OPEN_ARTIFACT_CHANGELOG_ROOT).
 *
 * Run: node --test scripts/changelog.test.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { atLeast, hasIntegrators, integratorChanges, sectionOf } from './changelog.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'changelog.mjs');

describe('parts', () => {
  it('reads a section up to the next one or the links', () => {
    const text = '# Changelog\n\n## [1.1.0] - 2026-01-02\n\nNew.\n\n### Added\n\n- x\n\n## [1.0.0] - 2026-01-01\n\nFirst.\n\n[1.1.0]: https://example.com\n';
    assert.equal(sectionOf(text, 'v1.1.0'), 'New.\n\n### Added\n\n- x');
    assert.equal(sectionOf(text, '1.0.0'), 'First.');
    assert.equal(sectionOf(text, '2.0.0'), null);
  });

  it('knows the files that change what an integrator sees', () => {
    assert.deepEqual(
      integratorChanges([
        'packages/protocol/src/harness.ts',
        'packages/protocol/src/library.ts',
        'packages/harness-kit/src/client.ts',
        'packages/harness-kit/test/client.test.ts',
        'packages/daemon/harnesses/codex.json',
        'packages/daemon/src/stdio-bridge.ts',
        'packages/daemon/src/tools.ts',
        'docs/agent-guide.md',
      ]),
      ['packages/protocol/src/harness.ts', 'packages/harness-kit/src/client.ts', 'packages/daemon/harnesses/codex.json', 'packages/daemon/src/stdio-bridge.ts'],
    );
  });

  it('wants an Integrators section with something in it', () => {
    assert.equal(hasIntegrators('One line.\n\n### Integrators\n\n- hello says more.\n\n### Fixed\n\n- y'), true);
    assert.equal(hasIntegrators('One line.\n\n### Integrators\n\n### Fixed\n\n- y'), false);
    assert.equal(hasIntegrators('One line.\n\n### Added\n\n- Integrators get more.'), false);
  });

  it('holds from 0.14.0 on', () => {
    assert.equal(atLeast('0.13.9'), false);
    assert.equal(atLeast('v0.14.0'), true);
    assert.equal(atLeast('0.14.0-rc.1'), true);
    assert.equal(atLeast('1.0.0'), true);
  });
});

describe('--check against a repository', () => {
  const root = mkdtempSync(join(tmpdir(), 'oa-changelog-'));
  after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', ...args], { cwd: root, stdio: 'pipe' });
  const write = (file, text) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), text);
  };
  const check = (version) => spawnSync(process.execPath, [SCRIPT, '--check', version], { env: { ...process.env, OPEN_ARTIFACT_CHANGELOG_ROOT: root }, encoding: 'utf8' });
  const entry = (version, body) => `# Changelog\n\n## [${version}] - 2026-11-22\n\n${body}\n\n## [0.14.0] - 2026-11-01\n\nFirst.\n`;

  git('init', '-q');
  write('CHANGELOG.md', entry('0.14.0', 'First.'));
  write('packages/harness-kit/src/client.ts', 'export {};\n');
  git('add', '-A');
  git('commit', '-qm', 'first');
  git('tag', 'v0.14.0');

  it('passes a release that changes nothing integrators see', () => {
    write('packages/daemon/src/tools.ts', 'export {};\n');
    write('CHANGELOG.md', entry('0.14.1', 'Faster.\n\n### Fixed\n\n- x'));
    git('add', '-A');
    git('commit', '-qm', 'tools');
    const run = check('0.14.1');
    assert.equal(run.status, 0, run.stderr);
  });

  it('fails one that changes the kit without an Integrators section, naming the files', () => {
    write('packages/harness-kit/src/client.ts', 'export const x = 1;\n');
    git('add', '-A');
    git('commit', '-qm', 'kit');
    const run = check('0.14.1');
    assert.equal(run.status, 1);
    assert.match(run.stderr, /0\.14\.1 changes what integrators see \(packages\/harness-kit\/src\/client\.ts\); add an "### Integrators" section/);
  });

  it('passes it once the entry says what changed for integrators, also from the tag', () => {
    write('CHANGELOG.md', entry('0.14.1', 'Faster.\n\n### Integrators\n\n- `HarnessClient` exports x.\n\n### Fixed\n\n- x'));
    git('add', '-A');
    git('commit', '-qm', 'notes');
    assert.equal(check('0.14.1').status, 0);
    git('tag', 'v0.14.1');
    const tagged = check('v0.14.1');
    assert.equal(tagged.status, 0, tagged.stderr);
  });

  it('still refuses a version with no entry', () => {
    const run = check('0.15.0');
    assert.equal(run.status, 1);
    assert.match(run.stderr, /has no entry for 0\.15\.0/);
  });

  it('skips the rule with a warning in a shallow clone', () => {
    const shallow = mkdtempSync(join(tmpdir(), 'oa-changelog-shallow-'));
    try {
      execFileSync('git', ['clone', '-q', '--depth', '1', '--branch', 'v0.14.1', `file://${root}`, join(shallow, 'r')], { stdio: 'pipe' });
      // The tagged entry has Integrators; make one without it in the clone to see the rule is skipped, not passed.
      writeFileSync(join(shallow, 'r', 'CHANGELOG.md'), entry('0.14.1', 'Faster.'));
      const run = spawnSync(process.execPath, [SCRIPT, '--check', 'v0.14.1'], { env: { ...process.env, OPEN_ARTIFACT_CHANGELOG_ROOT: join(shallow, 'r') }, encoding: 'utf8' });
      assert.equal(run.status, 0, run.stderr);
      assert.match(run.stderr, /shallow clone.*not checked.*fetch-depth: 0/);
    } finally {
      rmSync(shallow, { recursive: true, force: true });
    }
  });
});
