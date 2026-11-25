import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sheetsEngine } from '@open-artifact/wasm-sheets/node';
import type { PackedCellBlock } from '@open-artifact/wasm-sheets';
import {
  EngineClient,
  NEWEST_FORMAT_VERSION,
  UtilityClient,
  type CellAt,
  type Edit,
  type IdRun,
  type InputsOfViewAnswer,
  type NamedViewToSet,
  type Op,
  type OpOf,
  type PivotTable,
  type PivotTableAtAnswer,
  type PlaceChanged,
  type QueueEditRequest,
  type RecordedEdit,
  type Refusal,
  type SheetId,
  type SyncState,
  type ValueContents,
  type ValuesOfFilteredColumnAnswer,
  type View,
} from '../src/engine/index.ts';

/** A synced workbook of one sheet, its edits saved as soon as they are sent. */
class Workbook {
  readonly client = new EngineClient(sheetsEngine().session());
  readonly sent: RecordedEdit[] = [];
  readonly sheetId: SheetId;
  private readonly rowBase: string;
  private readonly columnBase: string;
  private revision = 0;
  private edits = 0;

  constructor() {
    this.client.request({ kind: 'answerBeforeCalculating' });
    this.client.request({ kind: 'receiveServerRevision', revision: 0 });
    this.edit({ kind: 'addSheet', afterSheet: null, nameStem: 'Sheet' });
    const ops = this.sent.flatMap((edit) => edit.ops);
    const rows = ops.find((op): op is OpOf<'insertRows'> => op.kind === 'insertRows');
    const columns = ops.find((op): op is OpOf<'insertColumns'> => op.kind === 'insertColumns');
    assert.ok(rows && columns);
    this.sheetId = rows.sheetId;
    this.rowBase = rows.rows.base;
    this.columnBase = columns.columns.base;
  }

  row(index: number): string {
    return `${this.rowBase}.${index}`;
  }

  column(index: number): string {
    return `${this.columnBase}.${index}`;
  }

  /** A cell by its place when the sheet was made: row and column from 0. */
  at(row: number, column: number): CellAt {
    return { r: this.row(row), c: this.column(column) };
  }

  rows(...runs: [first: number, count: number][]): IdRun[] {
    return runs.map(([first, count]) => ({ base: this.rowBase, first, count }));
  }

  /** Queues an edit and saves what it sends; the recorded edits it sent. */
  edit(edit: Edit, more: Partial<QueueEditRequest> = {}): RecordedEdit[] {
    this.edits += 1;
    const answer = this.client.request({ kind: 'queueEdit', opId: `op${this.edits}`, newIdCode: this.code(), edit, ...more });
    assert.equal(answer.kind, 'editQueued', JSON.stringify(answer));
    assert.ok('syncState' in answer);
    return this.save(answer.syncState);
  }

  /** Queues an edit, saves what it sends, and gives the place it changed. */
  place(edit: Edit): PlaceChanged | null {
    this.edits += 1;
    const answer = this.client.request({ kind: 'queueEdit', opId: `op${this.edits}`, newIdCode: this.code(), edit });
    assert.equal(answer.kind, 'editQueued', JSON.stringify(answer));
    if (answer.kind !== 'editQueued') return null;
    this.save(answer.syncState);
    return answer.placeChanged;
  }

  /** Queues an edit the engine refuses; why it refuses. */
  refusal(edit: Edit): Refusal | string | undefined {
    this.edits += 1;
    const answer = this.client.request({ kind: 'queueEdit', opId: `op${this.edits}`, newIdCode: this.code(), edit });
    assert.equal(answer.kind, 'refused', JSON.stringify(answer));
    return answer.kind === 'refused' ? answer.refusal : undefined;
  }

  private code(): string {
    return `baaaaaaa${String.fromCharCode(97 + Math.floor(this.edits / 26))}${String.fromCharCode(97 + (this.edits % 26))}`;
  }

  undo(): RecordedEdit[] {
    this.edits += 1;
    const answer = this.client.request({ kind: 'queueNextUndo', opId: `op${this.edits}` });
    assert.equal(answer.kind, 'editQueued', JSON.stringify(answer));
    assert.ok('syncState' in answer);
    return this.save(answer.syncState);
  }

  type(cells: [row: number, column: number, text: string][]): void {
    this.edit({
      kind: 'pasteTexts',
      sheetId: this.sheetId,
      cells: cells.map(([row, column, text]) => ({ ...this.at(row, column), text })),
      pastedTextIs: 'asTyped',
      localeOfTexts: 'en-US',
    });
  }

  /** What a cell comes to: a formula's value, or what it holds. */
  value(row: number, column: number): ValueContents | undefined {
    this.client.request({ kind: 'calculate' });
    const answer = this.client.request({ kind: 'readCells', sheetId: this.sheetId, cells: [this.at(row, column)] });
    assert.equal(answer.kind, 'cellsContents');
    if (answer.kind !== 'cellsContents') return undefined;
    const [cell] = answer.cells;
    if (!cell) return undefined;
    if (cell.value) return cell.value;
    const { input } = cell;
    return input.kind === 'number' || input.kind === 'text' || input.kind === 'boolean' ? input : undefined;
  }

  free(): void {
    this.client.free();
  }

  private save(state: SyncState): RecordedEdit[] {
    const sent: RecordedEdit[] = [];
    while (state.nextStep?.kind === 'sendEdit') {
      const { opId, recordedEdit } = state.nextStep;
      sent.push(recordedEdit);
      this.revision += 1;
      const saved = this.client.request({ kind: 'receiveSendOutcome', opId, outcome: { kind: 'saved', revision: this.revision } });
      assert.equal(saved.kind, 'syncState', JSON.stringify(saved));
      if (saved.kind !== 'syncState') break;
      state = saved;
    }
    this.sent.push(...sent);
    return sent;
  }
}

const number = (value: number): ValueContents => ({ kind: 'number', value });

/** The sheets `readWorkbook` tells. */
const sheetsOf = (client: EngineClient) => {
  const workbook = client.request({ kind: 'readWorkbook' });
  assert.ok('sheets' in workbook, JSON.stringify(workbook));
  return workbook.sheets;
};

/** The cells each block holds (the third of the four counts that open a block). */
const cellsIn = (block: PackedCellBlock) => new DataView(block.lists.buffer, block.lists.byteOffset).getUint32(8, true);

test('the engine writes and reads the newest format version', () => {
  const described = new UtilityClient(sheetsEngine()).request({ kind: 'describeSharedCode' });
  assert.equal(described.kind, 'sharedCodeDescription', JSON.stringify(described).slice(0, 200));
  assert.ok('newestFormatVersion' in described);
  assert.equal(described.newestFormatVersion, NEWEST_FORMAT_VERSION);
  assert.ok('limits' in described);
  assert.equal(described.limits.mostNamedViewsInASheet, 20);
  assert.equal(described.limits.longestNameOfANamedViewInCharacters, 100);
});

test('a sort of whole rows puts them in order, and formulas read the rows at their places', () => {
  const book = new Workbook();
  try {
    book.type([[0, 0, 'Name'], [0, 1, 'Score'], [1, 0, 'b'], [1, 1, '3'], [2, 0, 'a'], [2, 1, '1'], [3, 0, 'c'], [3, 1, '2'], [4, 0, '=B2+B3'], [4, 1, '=SUM(B2:B4)']]);
    assert.deepEqual(book.value(4, 0), number(4));

    const [sorted] = book.edit({ kind: 'sortRows', sheetId: book.sheetId, oneRow: book.row(1), otherRow: book.row(3), byColumn: book.column(1), direction: 'ascending' });
    assert.ok(sorted);
    assert.equal(sorted.v, 42);
    const [reorder] = sorted.ops;
    assert.equal(reorder?.kind, 'reorderRows');
    if (reorder?.kind !== 'reorderRows') return;
    assert.deepEqual(reorder.rows.ids, [{ base: book.rows([1, 1])[0]!.base, runs: [[1, 3]] }]);
    assert.deepEqual(reorder.sortedBy, [{ c: book.column(1), direction: 'ascending' }]);

    // Rows keep their ids; B2 and B3 are now the rows of 1 and 2, the sum is the same.
    assert.deepEqual(book.value(1, 1), number(3));
    assert.deepEqual(book.value(4, 0), number(3));
    assert.deepEqual(book.value(4, 1), number(6));
    const layout = book.client.request({ kind: 'readSheetLayout', sheetId: book.sheetId });
    assert.equal(layout.kind, 'sheetLayout');

    const [undone] = book.undo();
    assert.equal(undone?.ops[0]?.kind, 'reorderRows');
    assert.deepEqual(book.value(4, 0), number(4));
  } finally {
    book.free();
  }
});

test('rows deleted in many runs are written as lists of runs, and their undo too', () => {
  const book = new Workbook();
  try {
    const runs = (from: number, count: number) => book.rows(...Array.from({ length: count }, (_, i): [number, number] => [from + i * 2, 1]));
    const [some] = book.edit({ kind: 'deleteRows', sheetId: book.sheetId, rows: runs(20, 99) });
    assert.equal(some?.v, 17);
    assert.deepEqual((some?.ops[0] as OpOf<'deleteRows'>).rows, runs(20, 99));

    const [many] = book.edit({ kind: 'deleteRows', sheetId: book.sheetId, rows: runs(300, 100) });
    assert.equal(many?.v, 43);
    const listed = (many?.ops[0] as OpOf<'deleteRows'>).rows;
    assert.equal(listed.length, 1);
    assert.ok(listed[0] && 'runs' in listed[0]);
    assert.equal(listed[0].runs.length, 100);
    assert.deepEqual(listed[0].runs[0], [300, 1]);

    const [undone] = book.undo();
    assert.equal(undone?.v, 43);
    const back = undone?.ops[0];
    assert.equal(back?.kind, 'undeleteRows');
    assert.ok(back?.kind === 'undeleteRows' && back.rows[0] && 'runs' in back.rows[0]);
  } finally {
    book.free();
  }
});

test('formulas with many words of their own are shown first only when the page says what it showed', () => {
  // Each weighs more than 40 (16 CJK characters of its own) and says something else, so none of them was seen.
  const formula = (i: number) => `=IF(A${i + 1}>=0,"第${i + 1}组高毛利核心产品线","常规需优化产品线")`;
  const paste = (book: Workbook, count: number): Edit => ({
    kind: 'pasteTexts',
    sheetId: book.sheetId,
    cells: Array.from({ length: count }, (_, i) => ({ ...book.at(i, 1), text: formula(i) })),
    pastedTextIs: 'asTyped',
    localeOfTexts: 'en-US',
  });
  const answer = (count: number, more: Partial<QueueEditRequest>) => {
    const book = new Workbook();
    try {
      return book.client.request({ kind: 'queueEdit', opId: 'paste', newIdCode: 'pasteaaaaa', edit: paste(book, count), ...more });
    } finally {
      book.free();
    }
  };
  // The page sends what the person was shown: none yet, so the texts are to be shown first, and more than 50 refuse.
  const asked = answer(50, { shownToThePerson: [] });
  assert.equal(asked.kind, 'toBeShownFirst');
  assert.equal(asked.kind === 'toBeShownFirst' && asked.textThatNoCellShows.length, 50);
  assert.deepEqual(answer(51, { shownToThePerson: [] }), { kind: 'refused', refusal: 'tooMuchThatNoCellShows' });
  // Null or left out (the agent's writes): nothing is shown first, however many there are.
  assert.equal(answer(51, { shownToThePerson: null }).kind, 'editQueued');
  const book = new Workbook();
  try {
    book.edit(paste(book, 60));
    assert.deepEqual(book.value(59, 1), { kind: 'text', value: '第60组高毛利核心产品线' });
  } finally {
    book.free();
  }
});

test('a fraction pattern shows a number as a fraction', () => {
  const book = new Workbook();
  try {
    book.type([[0, 0, '0.75'], [1, 0, '2.3333333'], [2, 0, '-1.5']]);
    book.edit(
      {
        kind: 'formatCells',
        cells: { sheetId: book.sheetId, rows: book.rows([0, 3]), oneColumn: book.column(0), otherColumn: book.column(0) },
        format: { numberFormat: { pattern: '# ?/?' } },
      },
      { makesRoomForNumbersIn: book.sheetId },
    );
    const answer = book.client.request({ kind: 'readCells', sheetId: book.sheetId, cells: [book.at(0, 0), book.at(1, 0), book.at(2, 0)] });
    assert.equal(answer.kind, 'cellsContents');
    if (answer.kind !== 'cellsContents') return;
    const shown = answer.cells.map((cell) => (cell.shown?.kind === 'text' ? cell.shown.text : null));
    assert.deepEqual(shown, [' 3/4', '2 1/3', '-1 1/2']);
  } finally {
    book.free();
  }
});

test('wrapping is written by name or as a flag and kept as wrapped, clipped or neither', () => {
  const book = new Workbook();
  try {
    const cells = { sheetId: book.sheetId, rows: book.rows([0, 1]), oneColumn: book.column(0), otherColumn: book.column(0) };
    const shared = () => {
      const answer = book.client.request({ kind: 'readSharedCellFormat', sheetId: book.sheetId, oneCorner: book.at(0, 0), otherCorner: book.at(0, 0) });
      assert.equal(answer.kind, 'sharedCellFormat');
      return answer.kind === 'sharedCellFormat' ? answer.format.alignment.wrap : undefined;
    };
    const [clipped] = book.edit({ kind: 'formatCells', cells, format: { alignment: { wrap: 'clip' } } });
    assert.equal(clipped?.v, 44);
    assert.deepEqual(clipped?.ops.map((op) => (op.kind === 'setCellFormats' ? op.formats[0]?.format.alignment?.wrap : op.kind)), ['clip']);
    assert.equal(shared(), 'clip');
    book.edit({ kind: 'formatCells', cells, format: { alignment: { wrap: 'wrap' } } });
    assert.equal(shared(), true);
    book.edit({ kind: 'formatCells', cells, format: { alignment: { wrap: 'overflow' } } });
    assert.equal(shared(), false);
    book.undo();
    assert.equal(shared(), true);
    const [flagged] = book.edit({ kind: 'formatCells', cells, format: { alignment: { wrap: false } } });
    assert.equal(flagged?.v, 23);
  } finally {
    book.free();
  }
});

test('a workbook whose cells are clipped by name loads', () => {
  const client = new EngineClient(sheetsEngine().session());
  try {
    const base = 'aaaaaaaaaa';
    const sheetId = `sht_${base}.0`;
    const ops: Op[] = [
      { kind: 'insertSheet', sheetId, name: 'Notes', after: null },
      { kind: 'insertRows', sheetId, after: null, rows: { base: `row_${base}`, first: 0, count: 2 } },
      { kind: 'insertColumns', sheetId, after: null, columns: { base: `col_${base}`, first: 0, count: 2 } },
      { kind: 'setCellFormats', sheetId, formats: [{ rows: [{ base: `row_${base}`, first: 0, count: 1 }], columns: [{ base: `col_${base}`, first: 0, count: 1 }], format: { alignment: { wrap: 'clip' } } }] },
    ];
    client.request({ kind: 'receiveServerRevision', revision: 1 });
    const loaded = client.request({ kind: 'receiveLoadPage', v: NEWEST_FORMAT_VERSION, revision: 1, from: 0, ops, next: null });
    assert.equal(loaded.kind === 'syncState' && loaded.isLoaded, true, JSON.stringify(loaded));
  } finally {
    client.free();
  }
});

test('PIVOT totals a column by the values of another, and tells why it is missing a field', () => {
  const book = new Workbook();
  try {
    book.type([
      [0, 0, 'Region'], [0, 1, 'Amount'], [1, 0, 'North'], [1, 1, '10'], [2, 0, 'South'], [2, 1, '5'],
      [3, 0, 'North'], [3, 1, '7'], [4, 0, 'East'], [4, 1, '3'],
      [0, 3, '=PIVOT(A1:A5,"sum",B1:B5)'],
      [9, 0, '=PIVOT(A5:A6,"sum")'],
    ]);
    book.client.request({ kind: 'calculate' });
    const workbook = book.client.request({ kind: 'readWorkbook' });
    assert.equal(workbook.kind, 'workbookContents');
    if (workbook.kind !== 'workbookContents') return;
    const spilled = workbook.sheets[0]?.spilledCells ?? [];
    const at = (row: number, column: number) => spilled.find((cell) => cell.r === book.row(row) && cell.c === book.column(column))?.value;
    // A header row of the totals and the groups, then a row of the total and each group's.
    assert.deepEqual([4, 5, 6, 7].map((c) => at(0, c)), ['Sum of Amount', 'East', 'North', 'South'].map((value) => ({ kind: 'text', value })));
    assert.deepEqual([4, 5, 6, 7].map((c) => at(1, c)), [25, 3, 17, 5].map(number));

    assert.deepEqual(book.value(9, 0), { kind: 'error', value: '#N/A' });
    const cause = book.client.request({ kind: 'readCauseOfError', sheetId: book.sheetId, cell: book.at(9, 0) });
    assert.deepEqual(cause, { kind: 'causeOfError', cause: { kind: 'argumentIsMissing', function: 'PIVOT', argument: 'field' } });
  } finally {
    book.free();
  }
});

test('readCells passes over a cell whose row the sheet does not have', () => {
  const book = new Workbook();
  try {
    book.type([[1, 1, '10']]);
    const answer = book.client.request({
      kind: 'readCells',
      sheetId: book.sheetId,
      cells: [book.at(1, 1), { r: 'row_zzzzzzzzzz.3', c: book.column(1) }, { r: book.row(99_999), c: book.column(0) }],
    });
    assert.deepEqual(answer, { kind: 'cellsContents', cells: [{ ...book.at(1, 1), input: number(10) }] });
  } finally {
    book.free();
  }
});

test('packed reads send the cells in blocks, row by row', () => {
  const book = new Workbook();
  try {
    book.type([[0, 0, 'a'], [0, 1, '1'], [1, 0, 'b'], [1, 1, '=B1*2'], [2, 0, 'TRUE'], [3, 2, 'x']]);
    book.client.request({ kind: 'calculate' });
    const plain = book.client.request({ kind: 'readWorkbook' });
    assert.equal(plain.kind, 'workbookContents');
    if (plain.kind !== 'workbookContents') return;

    const blocks: PackedCellBlock[] = [];
    const packed = book.client.requestWithCells({ kind: 'readWorkbookWithCellsPacked' }, (block) => blocks.push(block));
    assert.equal(packed.kind, 'workbookContentsWithCellsPacked');
    if (packed.kind !== 'workbookContentsWithCellsPacked') return;
    assert.equal(packed.revision, plain.revision);
    const [sheet] = packed.sheets;
    assert.deepEqual(sheet?.cells, [0]);
    assert.equal(blocks.length, 1);
    assert.equal(cellsIn(blocks[0]!), plain.sheets[0]?.cells.length);
    assert.ok(blocks[0]!.texts.includes('TRUE') || blocks[0]!.texts.includes('b'));

    blocks.length = 0;
    const rows = book.client.requestWithCells(
      { kind: 'readRowsWithCellsPacked', sheetId: book.sheetId, rows: [book.row(1), book.row(3), book.row(1)], columns: [book.column(1), book.column(0)] },
      (block) => blocks.push(block),
    );
    // Each answer counts its blocks from 0; rows named twice or missing are read once or passed over.
    assert.deepEqual(rows, { kind: 'rowsWithCellsPacked', cells: [0] });
    assert.equal(blocks.length, 1);
    assert.equal(cellsIn(blocks[0]!), 2);

    const unknownColumn = book.client.requestWithCells(
      { kind: 'readRowsWithCellsPacked', sheetId: book.sheetId, rows: null, columns: ['col_zzzzzzzzzz.0', book.column(0)] },
      () => assert.fail('no block for a refused read'),
    );
    assert.deepEqual(unknownColumn, { kind: 'refused', refusal: 'unknownColumn' });
  } finally {
    book.free();
  }
});

test('a sheet keeps its named views, each named once', () => {
  const book = new Workbook();
  try {
    const ops: Op[] = book.sent.flatMap((edit) => edit.ops);
    const view: NamedViewToSet = {
      namedViewId: 'nvw_baaaaaaaaa.0',
      namedView: { name: 'By score', cellTableId: 'tbl_baaaaaaaaa.0', filter: null, sortBy: [{ c: book.column(1), direction: 'descending' }] },
    };
    const set: Op = { kind: 'setNamedViews', sheetId: book.sheetId, namedViews: [view] };
    const other = new EngineClient(sheetsEngine().session());
    try {
      assert.deepEqual(other.request({ kind: 'load', ops: [...ops, set] }), { kind: 'loaded' });
      const twice = other.request({ kind: 'apply', ops: [{ ...set, namedViews: [view, view] }] });
      assert.deepEqual(twice, { kind: 'refused', refusal: 'namedViewNamedTwice' });
      const removed = other.request({ kind: 'apply', ops: [{ ...set, namedViews: [{ namedViewId: view.namedViewId, namedView: null }] }] });
      assert.equal(removed.kind, 'applied');
      if (removed.kind === 'applied') assert.deepEqual(removed.reverse, [set]);
    } finally {
      other.free();
    }
  } finally {
    book.free();
  }
});

test('a pivot table goes on a new sheet, reads back as its specification, and changes in place', () => {
  const book = new Workbook();
  try {
    book.type([[0, 0, 'Region'], [0, 1, 'Amount'], [1, 0, 'North'], [1, 1, '10'], [2, 0, 'South'], [2, 1, '5'], [3, 0, 'North'], [3, 1, '7'], [4, 0, 'East'], [4, 1, '3']]);
    book.client.request({ kind: 'calculate' });
    const pivotTable: PivotTable = {
      source: { sheetId: book.sheetId, headerRow: book.row(0) },
      rows: [{ column: book.column(0), by: null, order: 'ascending', name: null }],
      columns: null,
      values: [{ column: book.column(1), total: 'sum', order: null, name: null }],
      filters: [{ column: book.column(0), keeps: 'noneOf', listed: { kind: 'written', values: [{ kind: 'text', value: 'East' }, null] } }],
    };
    const place = book.place({ kind: 'insertPivotTable', place: { kind: 'newSheet', afterSheet: book.sheetId, name: 'Pivot' }, pivotTable });
    assert.ok(place?.cells);
    assert.notEqual(place.sheetId, book.sheetId);
    const cell = place.cells.topLeft;
    book.client.request({ kind: 'calculate' });

    const read = book.client.request({ kind: 'readPivotTableAt', sheetId: place.sheetId, cell });
    assert.equal(read.kind, 'pivotTableAt', JSON.stringify(read));
    const { read: found } = read as PivotTableAtAnswer;
    assert.ok(found);
    assert.deepEqual(found.cell, cell);
    assert.deepEqual(found.pivotTable, pivotTable);
    assert.equal(found.readsJustTheRecords, true);
    assert.deepEqual(found.table?.headerRows, { firstRow: book.row(0), lastRow: book.row(0) });

    const none = book.client.request({ kind: 'readPivotTableAt', sheetId: book.sheetId, cell: book.at(0, 0) });
    assert.deepEqual(none, { kind: 'pivotTableAt', read: null });

    const values = book.client.request({
      kind: 'readValuesToFilterPivotTableBy',
      source: pivotTable.source,
      c: book.column(0),
      keeps: 'noneOf',
      listed: [{ kind: 'text', value: 'East' }],
    });
    assert.deepEqual(values, {
      kind: 'valuesOfFilteredColumn',
      values: [
        { value: { kind: 'text', value: 'East' }, firstInRow: book.row(4), records: 1, meetsTheLinesOfItsColumn: false },
        { value: { kind: 'text', value: 'North' }, firstInRow: book.row(1), records: 2, meetsTheLinesOfItsColumn: true },
        { value: { kind: 'text', value: 'South' }, firstInRow: book.row(2), records: 1, meetsTheLinesOfItsColumn: true },
      ],
      areMoreLeftOut: false,
    } satisfies ValuesOfFilteredColumnAnswer);

    const changed: PivotTable = { ...pivotTable, filters: [], values: [{ column: book.column(1), total: 'average', order: 'descending', name: 'Mean' }] };
    book.edit({ kind: 'changePivotTable', sheetId: place.sheetId, cell, pivotTable: changed });
    const again = book.client.request({ kind: 'readPivotTableAt', sheetId: place.sheetId, cell });
    assert.deepEqual((again as PivotTableAtAnswer).read?.pivotTable, changed);

    assert.equal(book.refusal({ kind: 'changePivotTable', sheetId: book.sheetId, cell: book.at(0, 0), pivotTable }), 'noPivotTableAtTheCell');
    assert.equal(
      book.refusal({ kind: 'insertPivotTable', place: { kind: 'cell', sheetId: book.sheetId, cell: book.at(0, 1) }, pivotTable }),
      'pivotTableWouldReadItself',
    );
  } finally {
    book.free();
  }
});

test('columns moved among the cells of a table take their named views along', () => {
  const book = new Workbook();
  try {
    book.type([[0, 0, 'Name'], [0, 1, 'Score'], [0, 2, 'Team'], [1, 0, 'a'], [1, 1, '3'], [1, 2, 'x'], [2, 0, 'b'], [2, 1, '1'], [2, 2, 'y']]);
    book.edit({
      kind: 'declareCellTable',
      sheetId: book.sheetId,
      cellTable: { headerRows: { firstRow: book.row(0), lastRow: book.row(0) }, firstColumn: book.column(0), lastColumn: book.column(2), footerRows: null },
    });
    const cellTableId = sheetsOf(book.client)[0]?.cellTables?.[0]?.cellTableId;
    assert.ok(cellTableId);
    book.edit({
      kind: 'saveNamedView',
      sheetId: book.sheetId,
      namedViewId: null,
      namedView: { name: 'By score', cellTableId, filter: null, sortBy: [{ c: book.column(1), direction: 'descending' }] },
    });
    const [saved] = sheetsOf(book.client)[0]?.namedViews ?? [];
    assert.ok(saved);
    assert.match(saved.namedViewId, /^nvw_/);

    const cells = { sheetId: book.sheetId, oneCorner: book.at(0, 0), otherCorner: book.at(2, 2) };
    book.edit({ kind: 'moveColumnsOfCells', cells, oneColumn: book.column(1), otherColumn: book.column(1), afterColumn: null, widthsGoAlong: true });
    assert.deepEqual(book.value(0, 0), { kind: 'text', value: 'Score' });
    assert.deepEqual(book.value(0, 1), { kind: 'text', value: 'Name' });
    const sheet = sheetsOf(book.client)[0];
    assert.deepEqual(sheet?.namedViews, [
      { namedViewId: saved.namedViewId, namedView: { ...saved.namedView, sortBy: [{ c: book.column(0), direction: 'descending' }] } },
    ]);
    assert.equal(
      book.refusal({ kind: 'moveColumnsOfCells', cells, oneColumn: book.column(1), otherColumn: book.column(1), afterColumn: book.column(5), widthsGoAlong: false }),
      'movedColumnOutsideTheCells',
    );

    book.edit({ kind: 'removeNamedView', sheetId: book.sheetId, namedViewId: saved.namedViewId });
    assert.equal(sheetsOf(book.client)[0]?.namedViews, undefined);
    assert.equal(book.refusal({ kind: 'removeNamedView', sheetId: book.sheetId, namedViewId: saved.namedViewId }), 'unknownNamedView');
  } finally {
    book.free();
  }
});

test('a sheet that shows an interactive view takes its writes, keeps their defaults and resets to them', () => {
  // No edit makes an interactive element, so the workbook is loaded with one.
  const client = new EngineClient(sheetsEngine().session());
  try {
    const data = 'sht_baaaaaaaaa.0';
    const shown = 'sht_baaaaaaaaa.1';
    const viewId = 'viw_baaaaaaaaa.0';
    const at = (row: number) => ({ r: `row_baaaaaaaaa.${row}`, c: 'col_baaaaaaaaa.0' });
    const view: View = {
      name: 'Calculator',
      elements: [
        {
          kind: 'interactive',
          elementId: 'vel_baaaaaaaaa.0',
          embed: { ref: 'node/calculator', caption: 'Calculator' },
          inputs: [{ name: 'rate', range: { sheetId: data, topLeft: at(0), bottomRight: at(1) } }],
          writes: [{ input: 'rate', saved: [{ ...at(0), value: { kind: 'number', value: 1 } }, { ...at(1), value: null }] }],
        },
      ],
    };
    const ops: Op[] = [
      { kind: 'insertSheet', sheetId: data, name: 'Data', after: null },
      { kind: 'insertRows', sheetId: data, after: null, rows: { base: 'row_baaaaaaaaa', first: 0, count: 10 } },
      { kind: 'insertColumns', sheetId: data, after: null, columns: { base: 'col_baaaaaaaaa', first: 0, count: 5 } },
      { kind: 'setCells', sheetId: data, cells: [{ ...at(0), input: { kind: 'number', value: 1 } }] },
      { kind: 'insertSheet', sheetId: shown, name: 'Calculator', after: data },
      { kind: 'setViews', views: [{ viewId, view }] },
      { kind: 'setSheetSettings', sheets: [{ sheetId: shown, settings: { interactive: viewId } }] },
    ];
    client.request({ kind: 'answerBeforeCalculating' });
    client.request({ kind: 'receiveServerRevision', revision: 1 });
    const loaded = client.request({ kind: 'receiveLoadPage', from: 0, revision: 1, v: NEWEST_FORMAT_VERSION, ops, next: null });
    assert.equal(loaded.kind, 'syncState', JSON.stringify(loaded));
    const sheets = sheetsOf(client);
    assert.equal(sheets[1]?.interactive, viewId);
    assert.equal(sheets[0]?.interactive, undefined);

    let revision = 1;
    let edits = 0;
    const queue = (edit: Edit) => {
      edits += 1;
      const answer = client.request({ kind: 'queueEdit', opId: `op${edits}`, newIdCode: `caaaaaaa${String.fromCharCode(97 + edits)}`, edit });
      let state = answer.kind === 'editQueued' ? answer.syncState : null;
      const sent: RecordedEdit[] = [];
      while (state?.nextStep?.kind === 'sendEdit') {
        sent.push(state.nextStep.recordedEdit);
        revision += 1;
        const saved = client.request({ kind: 'receiveSendOutcome', opId: state.nextStep.opId, outcome: { kind: 'saved', revision } });
        state = saved.kind === 'syncState' ? saved : null;
      }
      return { answer, ops: sent.flatMap((edit) => edit.ops) };
    };
    const inputs = () => client.request({ kind: 'readInputsOfView', viewId }) as InputsOfViewAnswer;
    assert.deepEqual(inputs(), {
      kind: 'inputsOfView',
      viewId,
      elements: [{ elementId: 'vel_baaaaaaaaa.0', inputs: [{ name: 'rate', rows: [[{ value: 1, text: '1' }]] }] }],
    } satisfies InputsOfViewAnswer);

    const written = queue({ kind: 'writeFromInteractive', viewId, cells: [{ input: 'rate', row: 0, column: 0, value: { kind: 'number', value: 5 } }] });
    assert.deepEqual(written.ops.map((op) => op.kind), ['setCells']);
    assert.deepEqual(inputs(), {
      kind: 'inputsOfView',
      viewId,
      elements: [{ elementId: 'vel_baaaaaaaaa.0', inputs: [{ name: 'rate', rows: [[{ value: 5, text: '5' }]] }] }],
      canBeReset: true,
      hasDefaultsToSave: true,
    } satisfies InputsOfViewAnswer);

    const kept = queue({ kind: 'saveDefaultsOfInteractive', viewId });
    const [setViews] = kept.ops;
    assert.equal(setViews?.kind, 'setViews');
    const element = setViews?.kind === 'setViews' ? setViews.views[0]?.view?.elements[0] : undefined;
    assert.deepEqual(element?.kind === 'interactive' ? element.writes : undefined, [
      { input: 'rate', saved: [{ ...at(0), value: { kind: 'number', value: 5 } }, { ...at(1), value: null }] },
    ]);
    assert.equal(inputs().canBeReset, undefined);
    assert.equal(inputs().hasDefaultsToSave, undefined);

    queue({ kind: 'writeFromInteractive', viewId, cells: [{ input: 'rate', row: 0, column: 0, value: { kind: 'text', value: 'high' } }] });
    const reset = queue({ kind: 'resetInteractive', viewId });
    assert.deepEqual(reset.ops.map((op) => op.kind), ['setCells']);
    assert.equal(inputs().canBeReset, undefined);

    const refusal = (edit: Edit) => {
      const { answer } = queue(edit);
      return answer.kind === 'refused' ? answer.refusal : answer.kind;
    };
    assert.equal(refusal({ kind: 'resetInteractive', viewId: 'viw_zzzzzzzzzz.0' }), 'unknownInteractive');
    assert.equal(
      refusal({ kind: 'writeFromInteractive', viewId, cells: [{ input: 'rate', row: 3, column: 0, value: null }] }),
      'cellIsNotTheInteractives',
    );
    assert.equal(refusal({ kind: 'insertRows', sheetId: shown, afterRow: null, count: 1 }), 'sheetIsAnInteractive');
    assert.equal(refusal({ kind: 'setSheetSettings', sheetId: data, settings: { interactive: viewId } }), 'sheetForInteractiveIsNotEmpty');

    const off = queue({ kind: 'setSheetSettings', sheetId: shown, settings: { interactive: null } });
    assert.deepEqual(off.ops, [{ kind: 'setSheetSettings', sheets: [{ sheetId: shown, settings: { interactive: null } }] }]);
    assert.equal(sheetsOf(client)[1]?.interactive, undefined);
  } finally {
    client.free();
  }
});
