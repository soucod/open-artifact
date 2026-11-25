import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { shellSaved } from '../src/services/save-state.ts';

describe('the save badge the deck reports to the Shell', () => {
  it('calls edits waiting out the debounce, or being written, saving', () => {
    assert.equal(shellSaved('dirty'), 'saving');
    assert.equal(shellSaved('saving'), 'saving');
    assert.equal(shellSaved('saved'), 'saved');
  });

  it('calls a save that failed and is retried reconnecting, never unsaved', () => {
    assert.equal(shellSaved('offline'), 'reconnecting');
  });

  it('calls a deck that cannot be written read-only', () => {
    assert.equal(shellSaved('readonly'), 'readonly');
  });
});
