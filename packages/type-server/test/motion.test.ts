/**
 * The Motion type on the type server: detection by its marker, the scaffold,
 * the check (code parsed as the player runs it) and the writes it refuses.
 */

import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { detectType } from '../src/index.ts';
import { TYPES } from '../src/types.ts';
import { motionHistoryIgnores, motionSyntaxError } from '../src/motion.ts';

const none = (): unknown => undefined;

describe('motion type', () => {
  it('scaffolds the marker and is detected by it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'oa-motion-'));
    try {
      const files = TYPES.motion.scaffold('Fox', join(root, 'db'));
      assert.deepEqual(Object.keys(files), ['film/meta.json']);
      await mkdir(join(root, 'db', 'film'), { recursive: true });
      await writeFile(join(root, 'db', 'film', 'meta.json'), files['film/meta.json']!);
      assert.equal(await detectType(root), 'motion');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('parses code as the player runs it, with the line of the error', () => {
    assert.equal(motionSyntaxError('window.CUT = kit.scenes();', 'cut.js'), null);
    assert.equal(motionSyntaxError('const kit = 1;', 'cut.js')?.message.includes('kit'), true);
    assert.equal(motionSyntaxError('let a = 1;\nlet b = (;', 'cut.js')?.line, 2);
    // A classic script, as the player runs it (no `node:vm`: the same on a host without it).
    assert.equal(motionSyntaxError('(;', 'cut.js')?.line, 1);
    assert.notEqual(motionSyntaxError('await thing;', 'cut.js'), null);
    assert.notEqual(motionSyntaxError('return 1;', 'cut.js'), null);
    assert.equal(motionSyntaxError('const f = async () => { await 1; };\nclass A { #x = 1 }\nlet y = a?.b ?? 2n;', 'cut.js'), null);
    assert.doesNotMatch(motionSyntaxError('let b = (;', 'cut.js')!.message, /\(\d+:\d+\)/);
    const findings = TYPES.motion.check(new Map([['film/script', JSON.stringify({ code: 'window.CUT = (' })]]));
    assert.ok(findings.some((finding) => finding.file === 'db/film/script.json' && /does not parse/.test(finding.message)));
  });

  it('refuses page-only records, also when the data comes from a file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'oa-motion-writes-'));
    try {
      const file = join(dir, 'module.json');
      await writeFile(file, JSON.stringify({ kind: 'js' }));
      const refuse = TYPES.motion.writesProblem!;
      assert.equal(refuse([{ op: 'set', path: 'modules/retouched.json', data: { v: 1, layers: [] } }], none)?.code, 'READ_ONLY_PATH');
      assert.match(refuse([{ op: 'set', path: 'modules/a.js', file_path: file }], none)?.message ?? '', /modules\/a\.js needs/);
      assert.equal(refuse([{ op: 'set', path: 'modules/a.js', data: { kind: 'js', text: '' } }], none), null);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('leaves people’s own documents out of the history', () => {
    assert.equal(motionHistoryIgnores('data/users/owner/x'), true);
    assert.equal(motionHistoryIgnores('modules/recut.json'), false);
  });
});
