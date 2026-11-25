import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { gotoCommand, placeOf } from '../src/shell/place.ts';

describe('the place the host is told about', () => {
  it('takes the place a page reports for its own type', () => {
    assert.equal(placeOf('slides', { openArtifact: 'current_slide', hash: '#slide-~7' }), '#slide-~7');
    assert.equal(placeOf('slides', { openArtifact: 'current_slide', hash: '#slide-~7.only.2.5' }), '#slide-~7.only.2.5');
    assert.equal(placeOf('docs', { openArtifact: 'doc_place', hash: '#0123abcd-4567' }), '#0123abcd-4567');
    assert.equal(placeOf('sheets', { openArtifact: 'sheet_page', page: 'Budget 2' }), '#page=Budget+2');
  });

  it('ignores places of another type, malformed ones and other messages', () => {
    assert.equal(placeOf('design', { openArtifact: 'current_slide', hash: '#slide-~7' }), null);
    assert.equal(placeOf('slides', { openArtifact: 'current_slide', hash: '#slide-~7.only.2' }), null);
    assert.equal(placeOf('sheets', { openArtifact: 'sheet_page', page: null }), null);
    assert.equal(placeOf('slides', { openArtifact: 'files_changed_ok' }), null);
  });

  it('turns a place the host sends into the command that shows it', () => {
    assert.deepEqual(gotoCommand('slides', '#slide-~7.only'), { cmd: 'goto_slide', hash: '#slide-~7.only' });
    assert.deepEqual(gotoCommand('slides', '#slide-3'), { cmd: 'goto_slide', hash: '#slide-3' });
    assert.deepEqual(gotoCommand('docs', '#0123abcd-4567.intro'), { cmd: 'goto_doc', hash: '#0123abcd-4567.intro' });
    assert.deepEqual(gotoCommand('sheets', '#page=Budget'), { cmd: 'goto_sheet', page: 'Budget' });
    assert.deepEqual(gotoCommand('sheets', '#sheet-s2'), { cmd: 'goto_sheet', page: 's2' });
  });

  it('turns down a place that is not one of this type', () => {
    assert.equal(gotoCommand('slides', '#view-inline'), null);
    assert.equal(gotoCommand('slides', 7), null);
    assert.equal(gotoCommand('docs', '#slide-~7'), null);
    assert.equal(gotoCommand('design', '#page=a'), null);
    assert.equal(gotoCommand('slides', '#slide-~' + 'a'.repeat(2000)), null);
  });
});
