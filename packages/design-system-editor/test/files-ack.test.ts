import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isDirty, useFiles } from '../src/state/files.ts';

const start = (text: string): void => {
  useFiles.setState({ undo: [], redo: [], conflicts: [], preview: null });
  useFiles.getState().load({ title: 'T', readOnly: false, listing: { 'notes.md': { hash: 'h0', size: text.length } }, server: { 'notes.md': text } });
};

describe('a save answered after the viewer changed the file', () => {
  it('keeps a change that went back to the text the server held before the save', () => {
    start('A');
    useFiles.getState().edit({ 'notes.md': 'B' });
    // The save of B goes out; meanwhile undo puts A back, the text the server still holds.
    useFiles.getState().undoStep();
    assert.equal(useFiles.getState().texts['notes.md'], 'A');
    useFiles.getState().acknowledge({ 'notes.md': { text: 'B', hash: 'h1', adopt: false, keep: true } });
    assert.equal(useFiles.getState().texts['notes.md'], 'A');
    assert.equal(useFiles.getState().server['notes.md'], 'B');
    assert.ok(isDirty(useFiles.getState()), 'the undo is left to save');
  });

  it('follows the server when the working copy had no change of its own', () => {
    start('A');
    useFiles.getState().acknowledge({ 'notes.md': { text: 'C', hash: 'h1' } });
    assert.equal(useFiles.getState().texts['notes.md'], 'C');
    assert.ok(!isDirty(useFiles.getState()));
  });
});
