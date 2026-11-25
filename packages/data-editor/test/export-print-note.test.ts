import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Dataset, DatasetRun, OkRun } from '@open-artifact/data-core';
import { MISSING_DATA_SENTENCE, PRINT_NOTE_ATTRIBUTE, dataAsOfSentence, getPrintDataNote } from '../src/export/print-note.ts';
import { PRINT_CSS, PRINT_PATH_ATTRIBUTE, hasPagePrintLayout } from '../src/export/print.ts';

const AT = Date.UTC(2026, 2, 4, 15, 30);
const query = (id: string): Dataset => ({
  id,
  title: id,
  description: '',
  source: { kind: 'query', connector: 'crm', tool: 'list_deals', args: '{}' },
  updated: null,
  schedule: '',
  staleAfterHours: null,
});
const ok = (at: number, cut?: 'rows'): OkRun => ({ status: 'ok', at, table: { columns: ['n'], rows: [{ n: 1 }], ...(cut ? { cut } : {}) } });
const runs = (byId: Record<string, DatasetRun>) => (id: string): DatasetRun => byId[id] ?? { status: 'idle' };

describe('the printed data note', () => {
  it('gives the oldest load time when every source loaded', () => {
    const note = getPrintDataNote([query('a'), query('b')], runs({ a: ok(AT + 60_000), b: ok(AT) }));
    assert.equal(note, dataAsOfSentence(AT));
    assert.match(note, /^Data as of Mar 4, 2026/);
  });

  it('adds that some data is missing when a source failed, is loading or was cut short', () => {
    const failed: DatasetRun = { status: 'failed', at: AT, message: 'no', kept: ok(AT) };
    assert.equal(getPrintDataNote([query('a'), query('b')], runs({ a: ok(AT), b: failed })), `${dataAsOfSentence(AT)} ${MISSING_DATA_SENTENCE}`);
    assert.equal(getPrintDataNote([query('a')], runs({ a: ok(AT, 'rows') })), `${dataAsOfSentence(AT)} ${MISSING_DATA_SENTENCE}`);
    assert.equal(getPrintDataNote([query('a')], runs({ a: { status: 'running', startedAt: AT, prev: null } })), MISSING_DATA_SENTENCE);
  });

  it('says nothing for a page without sources', () => {
    assert.equal(getPrintDataNote([], runs({})), '');
  });

  it('is shown by the print rules only when it has words', () => {
    assert.ok(PRINT_CSS.includes(`[${PRINT_PATH_ATTRIBUTE}]>[${PRINT_NOTE_ATTRIBUTE}]:not(:empty){display:block!important`));
    assert.ok(PRINT_CSS.startsWith('@media print{'));
  });

  it('hides what sits beside the dashboard, never the dashboard’s own content', () => {
    // #dash-root carries the path mark too: a rule hiding every unmarked child of a marked element emptied the sheet.
    const hide = /([^{}]*)\{display:none!important\}/.exec(PRINT_CSS.slice('@media print{'.length));
    assert.ok(hide, 'no rule hides the page’s surroundings');
    assert.equal(hide[1], `[${PRINT_PATH_ATTRIBUTE}]:not(:where(#dash-root))>:not([${PRINT_PATH_ATTRIBUTE}])`);
  });

  it('recognises when a dashboard already brings its own print rules', () => {
    assert.equal(hasPagePrintLayout([{ text: 'body { color: black; }' }]), false);
    assert.equal(hasPagePrintLayout([{ text: '@media print { .tabs { display: block; } }' }]), true);
    assert.equal(hasPagePrintLayout([{ text: 'window.addEventListener("beforeprint", showAll);' }]), true);
  });
});
