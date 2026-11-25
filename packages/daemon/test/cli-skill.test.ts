import { tempDir } from './helpers.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { skillFileKey } from '@open-artifact/protocol';
import { installSkillFile, renderSkillFor, skillCommand } from '../src/cli-skill.ts';

const BIN = resolve(import.meta.dirname, '..', 'src', 'bin', 'open-artifact.ts');

test('skill render: the built-in types after the skill, for the harness asked', () => {
  const skill = renderSkillFor({ command: 'artifact', form: 'entry', cli: 'open-artifact' });
  assert.equal(skill.name, 'artifact');
  assert.ok(skill.body.includes('`/artifact`'));
  assert.ok(skill.body.includes('- `slides`: Slides'), 'the built-in types are listed');
  assert.throws(() => renderSkillFor({ form: 'short' }), /--form/);
});

test('skill install: writes <dir>/<command>/SKILL.md once, and never over a file of the person', () => {
  const dir = tempDir('open-artifact-skills-');
  const first = installSkillFile({ command: 'artifact', dir, cli: 'open-artifact' });
  assert.equal(first.written, true);
  const text = readFileSync(join(dir, 'artifact', 'SKILL.md'), 'utf8');
  assert.match(String(skillFileKey(text, 'generated-by')), /^open-artifact \d/);
  assert.equal(skillFileKey(text, 'etag'), first.etag);
  assert.equal(installSkillFile({ command: 'artifact', dir, cli: 'open-artifact' }).written, false, 'unchanged');
  assert.equal(installSkillFile({ command: 'artifact', dir, cli: 'open-artifact', form: 'entry' }).written, true, 'another form is another text');

  mkdirSync(join(dir, 'mine'), { recursive: true });
  writeFileSync(join(dir, 'mine', 'SKILL.md'), '---\nname: mine\n---\n');
  assert.throws(() => installSkillFile({ command: 'mine', dir }), /not written by Open Artifact/);
  assert.throws(() => installSkillFile({ command: 'Bad!', dir }), /--command/);
});

test('skill command: parses its flags; the bin dispatches to it', () => {
  const flags: Record<string, string> = { command: 'oa', form: 'entry' };
  const text = skillCommand('render', (name) => flags[name], () => false);
  assert.ok(text.startsWith('---\nname: oa\n'));
  assert.throws(() => skillCommand('nope', () => undefined, () => false), /skill render/);
  const printed = execFileSync(process.execPath, [BIN, 'skill', 'render', '--command', 'oa', '--form', 'entry', '--json'], { encoding: 'utf8', env: process.env });
  assert.equal(JSON.parse(printed).name, 'oa');
});
