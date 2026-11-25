import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shellSaved } from '../src/services/save-state.ts';

describe('the save badge the board reports to the Shell', () => {
  it('calls edits waiting out the debounce, or being written, saving', () => {
    assert.equal(shellSaved({ status: 'dirty', loadState: 'live', pending: 1 }), 'saving');
    assert.equal(shellSaved({ status: 'saving', loadState: 'live', pending: 1 }), 'saving');
    assert.equal(shellSaved({ status: 'ready', loadState: 'live', pending: 0 }), 'saved');
  });

  it('calls a failed save unsaved', () => {
    assert.equal(shellSaved({ status: 'error', loadState: 'live', pending: 2 }), 'unsaved');
  });

  it('says nothing for a board that could not load and has no edits waiting', () => {
    assert.equal(shellSaved({ status: 'error', loadState: 'failed', pending: 0 }), undefined);
    // Edits made on a saved copy that then failed to load are still unsaved.
    assert.equal(shellSaved({ status: 'error', loadState: 'failed', pending: 1 }), 'unsaved');
  });

  it('says nothing while loading', () => {
    assert.equal(shellSaved({ status: 'loading', loadState: 'loading', pending: 0 }), undefined);
  });
});
