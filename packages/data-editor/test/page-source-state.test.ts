import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DatasetRun, OkRun } from '@open-artifact/data-core';
import { rootPageState, runSourceState, strongestMarkState } from '../src/page/source-state.ts';

const AT = Date.UTC(2026, 0, 1);
const good: OkRun = { status: 'ok', at: AT, table: { columns: ['n'], rows: [{ n: 1 }] } };

describe('source states on a page', () => {
  it('stamps a failed run that kept its rows as stale, and one with nothing as error', () => {
    const kept: DatasetRun = { status: 'failed', at: AT + 1, message: 'timed out', kept: good };
    const bare: DatasetRun = { status: 'failed', at: AT + 1, message: 'timed out' };
    assert.equal(runSourceState(kept, false), 'stale');
    assert.equal(runSourceState(bare, false), 'error');
    assert.equal(runSourceState({ status: 'connect', at: AT, message: 'sign in', kept: good }, false), 'stale');
    assert.equal(runSourceState({ status: 'connect', at: AT, message: 'sign in' }, false), 'error');
  });

  it('keeps loading, refreshing and quiet runs as before', () => {
    assert.equal(runSourceState({ status: 'idle' }, true), 'loading');
    assert.equal(runSourceState({ status: 'idle' }, false), undefined);
    assert.equal(runSourceState({ status: 'running', startedAt: AT, prev: null }, false), 'loading');
    assert.equal(runSourceState({ status: 'running', startedAt: AT, prev: good }, false), 'refreshing');
    assert.equal(runSourceState(good, true), undefined);
  });

  it('lets error, loading and refreshing win over stale on one mark', () => {
    assert.equal(strongestMarkState(['stale', 'refreshing']), 'refreshing');
    assert.equal(strongestMarkState(['stale', 'error']), 'error');
    assert.equal(strongestMarkState(['stale', undefined]), 'stale');
    assert.equal(strongestMarkState([undefined]), undefined);
  });

  it('counts stale as an error on the root, under the loading spell', () => {
    assert.equal(rootPageState(['stale'], false), 'error');
    assert.equal(rootPageState(['refreshing', undefined], false), undefined);
    assert.equal(rootPageState(['stale'], true), 'loading');
  });
});
