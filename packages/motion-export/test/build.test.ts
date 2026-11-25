import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { extname } from 'node:path';
import { describe, it } from 'node:test';
import { RASTER_FRAME_ENTRY, STANDALONE_AUDIO_ENTRY, buildExportScriptFresh, buildRasterFrame, buildStandaloneAudio } from '../src/build.ts';

describe('the export scripts the build helper bundles', () => {
  it('names its entries with no extension, so the names hold for the sources and for the compiled package', () => {
    for (const entry of [RASTER_FRAME_ENTRY, STANDALONE_AUDIO_ENTRY]) assert.equal(extname(entry), '', entry);
  });

  it('builds the raster frame from the entry beside it, and says which files went in', async () => {
    const built = await buildExportScriptFresh(RASTER_FRAME_ENTRY);
    assert.ok(built.script.length > 1000, 'a script');
    assert.ok(built.inputs.some((input) => /raster[\\/]frame-entry\.ts$/.test(input)), built.inputs.join('\n'));
    assert.ok(built.inputs.every((input) => existsSync(input)), 'every input is a file on disk');
    assert.equal(await buildRasterFrame(), built.script);
  });

  it('builds the standalone audio', async () => {
    const script = await buildStandaloneAudio();
    assert.match(script, /filmAudio/);
    assert.equal(await buildStandaloneAudio(), script, 'built once');
  });
});
