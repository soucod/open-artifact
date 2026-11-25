/**
 * What another host builds on: `createArtifactFiles` by its package path (`@open-artifact/host/files`, the Cloudflare
 * room's import), and the Node rooms closing an idle artifact by default.
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createArtifactFiles } from '@open-artifact/host/files';
import { ROOM_IDLE_CLOSE_MS } from '../src/node/rooms.ts';

test('`@open-artifact/host/files` reads and writes an artifact folder by archive path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'open-artifact-files-export-'));
  try {
    const root = join(dir, 'art_a');
    await mkdir(join(root, 'db', 'elements'), { recursive: true });
    await writeFile(join(root, '.artifact.json'), JSON.stringify({ id: 'art_a', type: 'whiteboard', title: 'Retro' }));
    await writeFile(join(root, 'db', 'elements', 'n1.json'), '{"type":"note"}');
    const files = createArtifactFiles((id) => join(dir, id));
    const manifest = await files.manifest('art_a');
    assert.ok(manifest['db/elements/n1.json'], `listed: ${Object.keys(manifest).join(', ')}`);
    const text = '{"type":"note","text":"Hi"}';
    const [written] = await files.write('art_a', [{ path: 'db/elements/n2.json', content: Buffer.from(text).toString('base64'), if_match: null }], 'test');
    assert.ok(written && !('conflict' in written) && typeof written.etag === 'string', JSON.stringify(written));
    assert.equal(new TextDecoder().decode((await files.read('art_a', 'db/elements/n2.json'))?.bytes), text);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the Node rooms close an idle artifact by default', () => {
  assert.ok(ROOM_IDLE_CLOSE_MS >= 60_000);
});
