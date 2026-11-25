import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseTitleFrom, readArtifactTitle, readTitleFrom, TITLE_FROM, valueAtPointer } from '../src/title.ts';
import { TYPES, type TypeName } from '../src/types.ts';

const ARTIFACT_TYPES = new URL('../../../artifact-types/', import.meta.url);

test('TITLE_FROM matches every built-in manifest', async () => {
  for (const type of Object.keys(TYPES) as TypeName[]) {
    const manifest = JSON.parse(await readFile(new URL(`${type}/artifact-type.json`, ARTIFACT_TYPES), 'utf8')) as { titleFrom?: string };
    if (manifest.titleFrom !== undefined) assert.equal(TITLE_FROM[type], manifest.titleFrom, type);
    else assert.ok(parseTitleFrom(TITLE_FROM[type]), type);
  }
});

test('parseTitleFrom and valueAtPointer', () => {
  assert.deepEqual(parseTitleFrom('doc/doc.json#/name'), { file: 'doc/doc.json', pointer: '/name' });
  assert.equal(parseTitleFrom('../x.json#/title'), null);
  assert.equal(parseTitleFrom('/etc/x.json#/title'), null);
  assert.equal(parseTitleFrom('x.json#title'), null);
  const value = { a: { 'b/c': [{ '~d': 'deep' }] }, name: 'N' };
  assert.equal(valueAtPointer(value, '/name'), 'N');
  assert.equal(valueAtPointer(value, '/a/b~1c/0/~0d'), 'deep');
  assert.equal(valueAtPointer(value, '/a/missing'), undefined);
  assert.equal(valueAtPointer(value, '/a/b~1c/x'), undefined);
  assert.equal(valueAtPointer(value, '/toString'), undefined);
});

test('readArtifactTitle reads the title where the type keeps it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'open-artifact-title-'));
  try {
    assert.equal(await readArtifactTitle(root, 'docs'), undefined);
    await mkdir(join(root, 'doc'), { recursive: true });
    await writeFile(join(root, 'doc/doc.json'), JSON.stringify({ name: '  Docs Browser QA ', title: 'not this' }));
    assert.equal(await readArtifactTitle(root, 'docs'), 'Docs Browser QA');
    await mkdir(join(root, 'db/board'), { recursive: true });
    await writeFile(join(root, 'db/board/meta.json'), JSON.stringify({ v: 1, title: 'Board' }));
    assert.equal(await readArtifactTitle(root, 'whiteboard'), 'Board');
    await writeFile(join(root, 'db/board/meta.json'), JSON.stringify({ v: 1, title: '   ' }));
    assert.equal(await readArtifactTitle(root, 'whiteboard'), undefined);
    await writeFile(join(root, 'broken.json'), '{');
    assert.equal(await readTitleFrom(root, 'broken.json#/title'), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
