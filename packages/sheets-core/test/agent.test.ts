import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sheetsEngine } from '@open-artifact/wasm-sheets/node';
import {
  AgentError,
  applyEdits,
  chartCodeErrors,
  chartModule,
  csvOf,
  describeEngine,
  describeStockChart,
  engineOf,
  type Engine,
  oldestFormatVersion,
  parseRange,
  personId,
  readWorkbook,
  recordEdits,
  type RecordingLog,
  serverIdOf,
  sha256Hex,
  STOCK_CHART_PROGRAMS,
  STOCK_KINDS,
  sheetsOf,
  stockKindOf,
  versionsOf,
  type WorkbookContents,
  workbookOf,
} from '../src/index.ts';

const engine: Engine = engineOf(sheetsEngine());
const { newest, localeOfANewWorkbook } = describeEngine(engine);
const oldest = oldestFormatVersion(engine, newest);

/** A log in memory: each edit's operations. */
function logOf(steps: unknown[][]): RecordingLog {
  return { engine, steps, newest, oldest, localeOfANewWorkbook, widgets: { get: () => null } };
}

function record(steps: unknown[][], edits: unknown[]): unknown[][] {
  const made = recordEdits(logOf(steps), (context) => {
    applyEdits(edits, context);
  });
  assert.ok(made, 'the edits recorded something');
  assert.ok(made.v >= oldest && made.v <= newest);
  return [...steps, made.ops];
}

/** The workbook after the log, its formulas worked out. */
function workbookAfter(steps: unknown[][]): { workbook: WorkbookContents; answer: (request: Record<string, unknown>) => Record<string, unknown> } {
  const session = engine.session();
  const ops = steps.flat();
  if (ops.length) assert.equal(session.answer({ kind: 'load', ops }).kind, 'loaded');
  for (let i = 0; i < 1000 && session.answer({ kind: 'calculate' }).calculation === 'unfinished'; i++);
  const workbook = workbookOf(session.answer({ kind: 'readWorkbook' }));
  assert.ok(workbook);
  return { workbook: { ...workbook, revision: steps.length }, answer: (request) => session.answer(request) };
}

const read = (steps: unknown[][], payload: unknown): Record<string, unknown> => {
  const { workbook, answer } = workbookAfter(steps);
  return readWorkbook(payload, { workbook, answer, utility: (request) => engine.utility(request), timeZone: null });
};

test('the agent writes a header, rows and a formula, and reads the result back', () => {
  let steps = record([], [{ kind: 'addSheet', name: 'Sheet1' }]);
  steps = record(steps, [
    { kind: 'renameSheet', sheet: 'Sheet1', name: 'Budget' },
    { kind: 'writeCells', sheet: 'Budget', topLeft: 'A1', rows: [['Item', 'Cost'], ['Rent', 1200], ['Zip', "'02139"], ['Total', '=SUM(B2:B3)']] },
  ]);
  const sheets = read(steps, { kind: 'readSheets' });
  assert.equal(sheets.revision, 2);
  assert.deepEqual((sheets.sheets as { name: string; filledRange: string }[]).map((s) => [s.name, s.filledRange]), [['Budget', 'A1:B4']]);
  const cells = read(steps, { kind: 'readCells', sheet: 'Budget', range: 'A1:B4' });
  assert.equal(cells.range, 'A1:B4');
  assert.deepEqual(cells.rows, {
    1: ['Item', 'Cost'],
    2: ['Rent', 1200],
    3: ['Zip', "'02139"],
    4: ['Total', { formula: '=SUM(B2:B3)', value: 1200 }],
  });
  const { workbook } = workbookAfter(steps);
  assert.equal(csvOf(sheetsOf(workbook)[0]!), 'Item,Cost\r\nRent,1200\r\nZip,02139\r\nTotal,1200\r\n');
});

test('nested totals distinguish aggregate options and ignore the rank argument when checking for nested totals', () => {
  const sheet = 'Sheet1';
  const formulas = ['=SUBTOTAL(9,B1:B1)', '=AGGREGATE(9,0,B1:B1)', '=AGGREGATE(9,4,B1:B1)', '=AGGREGATE(14,0,A1:A1,B1)'];
  const steps = record(record([], [{ kind: 'addSheet', name: sheet }]), [
    { kind: 'writeCells', sheet, topLeft: 'A1', rows: [[1, '=AGGREGATE(9,4,A1:A1)', ...formulas]] },
  ]);
  const cells = read(steps, { kind: 'readCells', sheet, range: 'C1:F1' });
  const error = { error: '#VALUE!' };
  assert.deepEqual(cells.rows, { 1: formulas.map((formula, index) => ({ formula, value: [error, error, 1, 1][index] })) });
});

test('writeCells takes formulas with many words of their own, in any script, and many of them at once', () => {
  // The page shows such formulas to the person before it pastes them (toBeShownFirst); the agent's writes show nothing.
  const sheet = 'Sheet1';
  const summary = '="数据区间 "&TEXT(MIN(A:A),"yyyy-mm-dd")&" 至 "&TEXT(MAX(A:A),"yyyy-mm-dd")&" · 共 "&C1&" 笔订单"';
  const cjk = '=IF(C1>=40,"高毛利核心产品线","常规需优化产品线")';
  const ascii = '=IF(C1>=40,"a high margin core product line","a regular line to optimize")';
  let steps = record(record([], [{ kind: 'addSheet', name: sheet }]), [
    { kind: 'writeCells', sheet, topLeft: 'A1', rows: [[{ date: '2026-01-05' }, summary, 42], [{ date: '2026-03-31' }, cjk, null], [null, ascii, null]] },
  ]);
  assert.deepEqual(read(steps, { kind: 'readCells', sheet, range: 'B1:B3' }).rows, {
    1: [{ formula: summary, value: '数据区间 2026-01-05 至 2026-03-31 · 共 42 笔订单' }],
    2: [{ formula: cjk, value: '高毛利核心产品线' }],
    3: [{ formula: ascii, value: 'a high margin core product line' }],
  });
  // More than the 50 texts a page may show first, each its own.
  const many = Array.from({ length: 60 }, (_, i) => [`=IF(C1>=40,"第${i + 1}组高毛利核心产品线","常规需优化产品线")`]);
  steps = record(steps, [{ kind: 'writeCells', sheet, topLeft: 'E1', rows: many }]);
  assert.deepEqual(read(steps, { kind: 'readCells', sheet, range: 'E60' }).rows, { 60: [{ formula: many[59]![0], value: '第60组高毛利核心产品线' }] });
});

test('a refusal names the edit and its word', () => {
  const steps = record([], [{ kind: 'addSheet', name: 'Sheet1' }]);
  assert.throws(
    () => recordEdits(logOf(steps), (context) => applyEdits([{ kind: 'writeCells', sheet: 'Sheet1', topLeft: 'A1', rows: [['ok']] }, { kind: 'writeCells', sheet: 'Nope', topLeft: 'A1', rows: [[1]] }], context)),
    (error: unknown) => error instanceof AgentError && error.code === 'unknownSheetName' && error.extra.editIndex === 1,
  );
  assert.throws(() => read(steps, { kind: 'readCells', sheet: 'Sheet1', range: 'A1:' }), (error: unknown) => error instanceof AgentError && error.code === 'rangeNotReadable');
});

test('conditional formats have a fingerprint', () => {
  const steps = record([], [{ kind: 'addSheet', name: 'Sheet1' }]);
  const rules = read(steps, { kind: 'readConditionalFormats', sheet: 'Sheet1' });
  assert.deepEqual(rules.rules, []);
  assert.equal(rules.fingerprint, sha256Hex('[]').slice(0, 16));
});

test('addresses, person ids and sha256', () => {
  assert.deepEqual(parseRange('C4:A1'), { top: 0, left: 0, bottom: 3, right: 2 });
  for (const id of ['local', 'guest-1234', 'agent']) {
    assert.match(personId(id), /^u_[0-9A-Za-z]{22}$/);
    assert.equal(serverIdOf(personId(id)), id);
  }
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('versions group edits by pauses and spans', () => {
  const at = (minutes: number): string => new Date(Date.UTC(2026, 0, 1) + minutes * 60_000).toISOString();
  const versions = versionsOf([
    { revision: 1, by: 'local', at: at(0) },
    { revision: 2, by: 'agent', at: at(2) },
    { revision: 3, by: 'local', at: at(20) },
    { revision: 4, by: 'local', at: at(24) },
    { revision: 5, by: 'local', at: at(28) },
    { revision: 6, by: 'local', at: at(52) },
  ]);
  assert.deepEqual(versions, [
    { first: 6, last: 6, by: ['local'] },
    { first: 3, last: 5, by: ['local'] },
    { first: 1, last: 2, by: ['agent', 'local'] },
  ]);
});

test('chart code: faults, the projection, and stock charts', () => {
  assert.deepEqual(chartCodeErrors(STOCK_CHART_PROGRAMS.bar), []);
  const faults = chartCodeErrors("import x from 'y';\nexport default () => <sheet.Embed />;");
  assert.deepEqual(faults.map((f) => f.line), [1, 2]);
  assert.match(faults[1]!.message, /sheet\.Embed/);
  assert.match(chartCodeErrors('const a = 1;')[0]!.message, /<sheet\.Visualize data-component=/);
  const module = chartModule('export default () => <svg width={10}>hi</svg>;');
  assert.match(module, /^export function init\(sheet, React, hooks, ds\)/);
  assert.match(module, /React\.createElement\("svg", \{width: 10\}, "hi"\)/);
  assert.equal(stockKindOf(` ${STOCK_CHART_PROGRAMS.pie}\n`), 'pie');
  const cell = (value: unknown, text: string) => ({ value, text });
  const rows = [[cell('Week', 'Week'), cell('Signups', 'Signups')], [cell('W1', 'W1'), cell(3, '3')], [cell('W2', 'W2'), cell(5, '5')]];
  assert.deepEqual(describeStockChart('bar', rows), { kind: 'bar', direction: 'vertical', stacking: 'none', data: { from: 'table', input: 'rows', seriesAre: 'columns', labelsLeftOut: [] } });
});

test('stock charts: every kind passes the code checks, is known by its text, and is described for the file', () => {
  for (const kind of STOCK_KINDS) {
    assert.deepEqual(chartCodeErrors(STOCK_CHART_PROGRAMS[kind]), [], kind);
    assert.equal(stockKindOf(STOCK_CHART_PROGRAMS[kind]), kind);
  }
  assert.equal(new Set(STOCK_KINDS.map((kind) => STOCK_CHART_PROGRAMS[kind])).size, STOCK_KINDS.length);
  const cell = (value: unknown, text: string) => ({ value, text });
  const table = { from: 'table', input: 'rows', seriesAre: 'columns', labelsLeftOut: [] };
  const rows = [[cell('Week', 'Week'), cell('Signups', 'Signups')], [cell('W1', 'W1'), cell(3, '3')], [cell('W2', 'W2'), cell(5, '5')]];
  assert.deepEqual(describeStockChart('area', rows), { kind: 'area', stacking: 'none', data: table });
  assert.deepEqual(describeStockChart('horizontalBar', rows), { kind: 'bar', direction: 'horizontal', stacking: 'none', data: table });
  // A scatter needs a number in the first column of every row under the headings.
  assert.equal(describeStockChart('scatter', rows), null);
  const points = [[cell('Price', 'Price'), cell('Sold', 'Sold')], [cell(10, '10'), cell(300, '300')], [cell(12, '12'), cell(260, '260')]];
  assert.deepEqual(describeStockChart('scatter', points), { kind: 'scatter', data: table });
  assert.equal(describeStockChart('scatter', [...points, [cell('n/a', 'n/a'), cell(1, '1')]]), null);
});
