import type {
  CauseCell,
  CauseOfError,
  CellContents,
  CellsOfDropdownAnswer,
  CellsThatADropdownWouldClearAnswer,
  CellsToCopyAnswer,
  CellTableAtAnswer,
  CellTableRead,
  ColumnId,
  ColumnReading,
  ConditionalFormatAsIf,
  ConditionalFormatSuggestionsAnswer,
  DropdownOptionsToOfferAnswer,
  DropdownToPointAt,
  EngineCellTable,
  EngineWorkbookContents,
  Filter,
  FilteredRowsAnswer,
  FitOfAColumnReading,
  FormatsGivenAnswer,
  IdRun,
  ListLine,
  ListLineAsKept,
  LocalesAnswer,
  NumberFormatIn,
  NumberFormatKind,
  PivotTableAtAnswer,
  ReadRowsWithCellsPackedRequest,
  ReadXlsxFileRequest,
  Refused,
  RoomIn,
  RowId,
  RowsInSortedOrderAnswer,
  RuleByAddress,
  RuleInIds,
  RulesRead,
  SessionRequest,
  SharedCodeDescription,
  SheetChanges,
  SheetId,
  ShownValue,
  SpilledCell,
  TableInIds,
  TableIntoSheet,
  TableOfASheet,
  TablesOfSheetAnswer,
  TableWithColumns,
  TextsUnderAColumnReadingAnswer,
  TimeZoneAnswer,
  ValueIn,
  ValuesOfFilteredColumnAnswer,
  WhatATableChangesAnswer,
  XlsxFileAnswer,
} from '@open-artifact/sheets-core';
import type { KindOfPattern } from '../model/cell-format.ts';
import { areaRefBetween, cellRefOf, readWorkbook, applyWorkbookChanges, createWorkbookAccessor } from '../model/workbook.ts';
import type {
  CauseOfErrorRead,
  CellId,
  CellTablesRead,
  FormatsGivenOfSheet,
  InputsOfViewRead,
  LocalePatterns,
  PatternRead,
  RowsToSort,
  SheetChangesRead,
  SheetToRead,
  ViewChangesRead,
  WorkbookRead,
  WorkbookReads,
  WorkbookServices,
} from '../model/workbook.ts';
import { NO_CAUSE_OF_ERROR } from './cause-of-error-cache.ts';
import type { SessionAnswers, SheetContentsWithBlocks, SheetsUtilities, WorkbookContentsWithBlocks } from './wasm-bindings.ts';
import { rowsOfPackedCells, type CellsPacked } from './packed-cells.ts';

/** The engine's readings of locales, patterns and time zones, which need no workbook. */
export interface LocaleReaders {
  dayTypedInLocaleAs(locale: string, text: string): string | null;
  shownInLocaleWithRoomForAll(locale: string, value: ValueIn, pattern: string): string | null;
  patternReadInLocale(locale: string, pattern: string, sampleOfKind: (kind: NumberFormatKind) => number): PatternRead | Refused;
  formulaInLocale(locale: string, text: string): string | null;
  patternsOfLocale(locale: string): LocalePatterns;
  fitOfColumnReadingsInLocale(locale: string, readings: ColumnReading[], texts: string[]): FitOfAColumnReading[] | null;
  textsUnderAColumnReadingInLocale(locale: string, reading: ColumnReading, texts: string[]): TextsUnderAColumnReadingAnswer | null;
  labelsOfADropdownColumn(texts: string[]): string[];
  listLinesAsKept(lists: Iterable<ListLine>): ListLineAsKept[];
  timeZones(): string[];
  timeZoneNamed(name: string): string | null;
  locales(): string[];
}

/** The engine's answers about the cells of a workbook; `null` where it refuses. */
export interface WorkbookQueries {
  cellsToCopy(oneCorner: CellId, otherCorner: CellId, rowsOutOfView: readonly IdRun[]): CellsToCopyAnswer | null;
  dropdownOptionsToOffer(oneCorner: CellId, otherCorner: CellId): DropdownOptionsToOfferAnswer['options'] | null;
  cellsThatADropdownWouldClear(oneCorner: CellId, otherCorner: CellId, dropdown: DropdownToPointAt): CellsThatADropdownWouldClearAnswer | null;
  cellsOfTheDropdownAt(cell: CellId): CellsOfDropdownAnswer | null;
  whatATableChanges(table: TableIntoSheet): WhatATableChangesAnswer | Refused;
  formatsGivenAsIf(sheetId: SheetId, asIf: Iterable<ConditionalFormatAsIf>): FormatsGivenAnswer | null;
  conditionalFormatSuggestions(oneCorner: CellId, otherCorner: CellId): ConditionalFormatSuggestionsAnswer | null;
  /** `'nowhere'`: no table at the cell. */
  tableAtCell(cell: CellId): TableWithColumns | 'nowhere' | null;
  cellTableAt(cell: CellId): CellTableRead | null;
  cellTables(sheetId: SheetId): CellTablesRead;
  cellTableDeclaredAs(sheetId: SheetId, cellTable: EngineCellTable): CellTableRead | 'tookTooLong' | 'nowhere';
  conditionalFormatsAsAgentIsTold(oneCorner: CellId, otherCorner: CellId): string | null;
  conditionalFormatsInIds(sheetId: SheetId, written: unknown): RulesRead | null;
  conditionalFormatsByAddress(sheetId: SheetId, rules: Iterable<RuleInIds>): (RuleByAddress | null)[] | null;
  proposedFormulaValue(cell: CellId, text: string): { cell: CellContents | null } | null;
  filteredRows(table: TableInIds, filter: Filter): FilteredRowsAnswer | Refused;
  valuesOfFilteredColumn(table: TableInIds, filter: Filter | null, columnId: ColumnId): ValuesOfFilteredColumnAnswer | Refused;
  rowsInSortedOrder(toSort: RowsToSort): RowsInSortedOrderAnswer | Refused;
  tablesOfSheet: WorkbookServices['tablesOfSheet'] extends (...args: infer A) => unknown ? (...args: A) => TablesOfSheetAnswer | Refused : never;
  pivotTableAt(cell: CellId): PivotTableAtAnswer | Refused;
  valuesToFilterPivotTableBy: WorkbookServices['valuesToFilterPivotTableBy'] extends (...args: infer A) => unknown
    ? (...args: A) => ValuesOfFilteredColumnAnswer | Refused
    : never;
  causeOfError(cell: CellId, cellNow: string): CauseOfErrorRead;
}

/** Every service the engine gives a workbook's reads, before a workbook may be broken. */
export interface CoreUtilities extends LocaleReaders, WorkbookQueries {}

/** All of a workbook as the engine reads it at first. */
export interface EverythingRead {
  kind: 'everything';
  description: SharedCodeDescription;
  localeOfANewWorkbook: string;
  contents: WorkbookContentsWithBlocks;
  given: FormatsGivenOfSheet[];
  inputsOfViews: InputsOfViewRead[];
}

/** A sheet's changes as the engine reads them: its rows read again, their cells packed. */
export interface SheetChangesPacked extends Omit<SheetChangesRead, 'cellsNow'> {
  cellsNow: CellsPacked[];
}
/** What changed in a workbook since the last reading. */
export interface ChangedRead {
  kind: 'changed';
  sheets: SheetChangesPacked[];
  views: ViewChangesRead | null;
  timeZone: TimeZoneAnswer | null;
}

/** A reading from the engine: everything, or what changed. */
export type CoreRead = EverythingRead | ChangedRead;

/** Rows of a sheet as the engine reads them again: those named, or every row, their cells packed. */
export interface RowsRead {
  rowsListed: RowId[] | 'all';
  cellsNow: CellsPacked[];
  spilledCellsNow: SpilledCell[];
}
/** The columns a read of rows takes: between two columns, either way round, or `null` for every column. */
export type ColumnsToRead = ReadRowsWithCellsPackedRequest['columns'];
/** How much was read of a sheet: whole, and in rows since then. */
interface SizeRead {
  whole: number;
  since: number;
}
/** What notes how much is read of each sheet, and says when reading the sheet whole would read less. */
export interface ReadSizes {
  note(read: CoreRead): void;
  mayBeTwiceWhatIsNeededIn(sheetId: SheetId): boolean;
}
/** What reads a workbook from the engine: all of it, then what changed. */
export interface WorkbookReader {
  readEverything(): WorkbookReads;
  readChanged(changedSheets: readonly SheetChanges[], changedViewIds: readonly string[], isTimeZoneChanged: boolean): WorkbookReads;
  /** Some rows (some columns of them) read into a workbook of their own; the readout is left as it is. */
  readWithCellsIn(sheetId: SheetId, rowIds: RowId[] | 'all', columnIds: ColumnsToRead): WorkbookReads | null;
}

/** `'nowhere'` when the engine reads no table at the cell; `null` when it refuses. */
export function readTableAtCell(core: SessionAnswers, cell: CellId): TableWithColumns | 'nowhere' | null {
  let answer = core.answer({
    kind: 'readTableAtCell',
    sheetId: cell.sheetId,
    cell: cellRefOf(cell),
  });
  if (answer.kind === 'table') return answer.read ?? 'nowhere';
  if (answer.kind === 'refused') return null;
  throw Error('sheets-core did not say where a table is');
}
export function readTablesOfSheetFromCore(core: SessionAnswers, sheetId: SheetId): TableOfASheet[] | null {
  let answer = core.answer({
    kind: 'readTablesOfSheet',
    sheetId,
  });
  if (answer.kind === 'tablesOfSheet') return answer.tables;
  if (answer.kind === 'refused') return null;
  throw Error('sheets-core did not list the tables of a sheet');
}
export function cellTableOfAnswer(answer: CellTableAtAnswer | Refused): CellTableRead | null {
  if (answer.kind === 'cellTableAt') return answer.cellTable;
  if (answer.kind === 'refused') return null;
  throw Error('sheets-core did not say where a cell table is');
}
export function readXlsxFile(core: SessionAnswers, request: Omit<ReadXlsxFileRequest, 'kind'>): XlsxFileAnswer | null {
  let answer = core.answer({
    kind: 'readXlsxFile',
    ...request,
  });
  if (answer.kind === 'xlsxFile') return answer;
  if (answer.kind !== 'refused') throw Error('sheets-core did not write the workbook as a file');
  return (request.charts ?? []).length > 0
    ? readXlsxFile(core, {
        ...request,
        charts: [],
      })
    : null;
}
export function readLocales(core: SheetsUtilities): LocalesAnswer {
  let answer = core.answer({
    kind: 'readLocales',
  });
  if (answer.kind !== 'locales') throw Error('sheets-core did not list the locales');
  return answer;
}
export function createLocaleReaders(core: SheetsUtilities): LocaleReaders {
  let dayTypedInLocaleAs: LocaleReaders['dayTypedInLocaleAs'] = (locale, text) => {
    let answer = core.answer({
      kind: 'readTypedDay',
      text,
      locale,
    });
    if (answer.kind === 'typedDay') return answer.day;
    if (answer.kind === 'refused') return null;
    throw Error('sheets-core did not say which day a text spells');
  };
  let shownInLocale = (locale: string, value: ValueIn, pattern: string): ShownValue => {
    let room: RoomIn = {
      kind: 'asText',
    };
    let numberFormat: NumberFormatIn = {
      pattern,
    };
    let answer = core.answer({
      kind: 'readShownValue',
      value,
      numberFormat,
      room,
      locale,
    });
    if (answer.kind !== 'shownValue') throw Error('sheets-core did not say what a cell shows');
    return answer.shown;
  };
  return {
    dayTypedInLocaleAs,
    shownInLocaleWithRoomForAll: (locale, value, pattern) => {
      let shown = shownInLocale(locale, value, pattern);
      return shown.kind === 'text' ? shown.text : null;
    },
    patternReadInLocale: (locale, pattern, sampleOfKind) => {
      let answer = core.answer({
        kind: 'readKindOfPattern',
        pattern,
      });
      if (answer.kind === 'refused') return answer;
      if (answer.kind !== 'kindOfPattern') throw Error('sheets-core did not read a pattern');
      let sample: ValueIn = {
        kind: 'number',
        value: sampleOfKind(answer.numberFormatKind),
      };
      let shown = shownInLocale(locale, sample, pattern);
      return {
        kind: 'numberFormat',
        numberFormat: {
          pattern,
        },
        shown,
      };
    },
    formulaInLocale: (locale, text) => {
      let answer = core.answer({
        kind: 'readFormulaTextInLocale',
        text,
        locale,
      });
      if (answer.kind === 'formulaTextInLocale') return answer.text;
      if (answer.kind === 'refused') return null;
      throw Error('sheets-core did not write a formula in a locale');
    },
    patternsOfLocale: (locale) => {
      let moneyAnswer = core.answer({
        kind: 'readPatternsOfMoney',
        locale,
      });
      if (moneyAnswer.kind !== 'patternsOfMoney') throw Error('sheets-core did not say how a locale writes its money');
      let datesAnswer = core.answer({
        kind: 'readPatternsOfDatesWithTheMonthNamed',
        locale,
      });
      if (datesAnswer.kind !== 'patternsOfDatesWithTheMonthNamed')
        throw Error('sheets-core did not say how a locale writes a date with the month named');
      return {
        currency: moneyAnswer.withTwoDecimals,
        roundedCurrency: moneyAnswer.withNoDecimals,
        mediumDate: datesAnswer.withTheMonthForShort,
        longDate: datesAnswer.withTheMonthInFull,
        monthAndDay: datesAnswer.monthAndDay,
        monthAndYear: datesAnswer.monthAndYear,
      };
    },
    fitOfColumnReadingsInLocale: (locale, readings, texts) => {
      let answer = core.answer({
        kind: 'readFitOfColumnReadings',
        readings,
        texts,
        locale,
      });
      if (answer.kind === 'fitOfColumnReadings') return answer.fits;
      if (answer.kind === 'refused') return null;
      throw Error('sheets-core did not say how a column takes its readings');
    },
    textsUnderAColumnReadingInLocale: (locale, reading, texts) => {
      let answer = core.answer({
        kind: 'readTextsUnderAColumnReading',
        reading,
        texts,
        locale,
      });
      if (answer.kind === 'textsUnderAColumnReading') return answer;
      if (answer.kind === 'refused') return null;
      throw Error('sheets-core did not read the texts of a column');
    },
    labelsOfADropdownColumn: (texts) => {
      let answer = core.answer({
        kind: 'readLabelsOfADropdownColumn',
        texts,
      });
      if (answer.kind !== 'labelsOfADropdownColumn') throw Error('sheets-core did not say what the options of a column would say');
      return answer.labels;
    },
    listLinesAsKept: (lists) => {
      let answer = core.answer({
        kind: 'readListLinesAsKept',
        lists: [...lists],
      });
      if (answer.kind !== 'listLinesAsKept') throw Error('sheets-core did not say how a cell keeps the lines of lists');
      return answer.lines;
    },
    timeZones: () => {
      let answer = core.answer({
        kind: 'readTimeZones',
      });
      if (answer.kind !== 'timeZones') throw Error('sheets-core did not list the time zones');
      return answer.timeZones;
    },
    timeZoneNamed: (name) => {
      let answer = core.answer({
        kind: 'readTimeZoneNamed',
        name,
      });
      if (answer.kind === 'timeZoneNamed') return answer.timeZone;
      if (answer.kind === 'refused') return null;
      throw Error('sheets-core did not say which time zone a name stands for');
    },
    locales: () => readLocales(core).locales,
  };
}
export function createWorkbookQueries(core: SessionAnswers, makeIdCode: () => string, nowMs: () => number): WorkbookQueries {
  let cellsToCopy: WorkbookQueries['cellsToCopy'] = (activeCell, selectionCorner, rowsOutOfView) => {
    if (activeCell.sheetId !== selectionCorner.sheetId) return null;
    let answer = core.answer({
      kind: 'readCellsToCopy',
      cells: areaRefBetween(activeCell, selectionCorner),
      ...(rowsOutOfView.length > 0 && {
        rowsOutOfView: [...rowsOutOfView],
      }),
    });
    if (answer.kind === 'cellsToCopy') return answer;
    if (answer.kind === 'refused') return null;
    throw Error('sheets-core did not write cells for a copy');
  };
  let dropdownOptionsToOffer: WorkbookQueries['dropdownOptionsToOffer'] = (activeCell, selectionCorner) => {
    if (activeCell.sheetId !== selectionCorner.sheetId) return null;
    let answer = core.answer({
      kind: 'readDropdownOptionsToOffer',
      ...areaRefBetween(activeCell, selectionCorner),
    });
    if (answer.kind === 'dropdownOptionsToOffer') return answer.options;
    if (answer.kind === 'refused') return null;
    throw Error('sheets-core did not say which options to offer');
  };
  let cellsThatADropdownWouldClear: WorkbookQueries['cellsThatADropdownWouldClear'] = (activeCell, selectionCorner, dropdown) => {
    if (activeCell.sheetId !== selectionCorner.sheetId) return null;
    let answer = core.answer({
      kind: 'readCellsThatADropdownWouldClear',
      cells: areaRefBetween(activeCell, selectionCorner),
      dropdown,
    });
    if (answer.kind === 'cellsThatADropdownWouldClear') return answer;
    if (answer.kind === 'refused') return null;
    throw Error('sheets-core did not say what a dropdown would clear');
  };
  let cellsOfTheDropdownAt: WorkbookQueries['cellsOfTheDropdownAt'] = (cell) => {
    let answer = core.answer({
      kind: 'readCellsOfTheDropdownAt',
      sheetId: cell.sheetId,
      cell: cellRefOf(cell),
    });
    if (answer.kind === 'cellsOfDropdown') return answer;
    if (answer.kind === 'refused') return null;
    throw Error('sheets-core did not say where the cells of a dropdown are');
  };
  let whatATableChanges: WorkbookQueries['whatATableChanges'] = (table) => {
    let answer = core.answer({
      kind: 'readWhatATableChanges',
      table,
      newIdCode: makeIdCode(),
    });
    if (answer.kind === 'whatATableChanges' || answer.kind === 'refused') return answer;
    throw Error('sheets-core did not say what a table changes in a sheet');
  };
  let formatsGivenAsIf: WorkbookQueries['formatsGivenAsIf'] = (sheetId, edits) => {
    let answer = core.answer({
      kind: 'readFormatsGiven',
      sheetId,
      asIf: [...edits],
    });
    if (answer.kind === 'formatsGiven') return answer.notWorkedOut === null ? answer : null;
    if (answer.kind === 'refused') return null;
    throw Error('sheets-core did not say what conditional formats would give');
  };
  let conditionalFormatSuggestions: WorkbookQueries['conditionalFormatSuggestions'] = (activeCell, selectionCorner) => {
    if (activeCell.sheetId !== selectionCorner.sheetId) return null;
    let cells = areaRefBetween(activeCell, selectionCorner);
    let answer = core.answer({
      kind: 'readConditionalFormatSuggestions',
      cells,
    });
    if (answer.kind === 'conditionalFormatSuggestions') return answer;
    if (answer.kind === 'refused') return null;
    throw Error('sheets-core did not suggest conditional formats');
  };
  let tableAtCell: WorkbookQueries['tableAtCell'] = (cell) => readTableAtCell(core, cell);
  let cellTableAt: WorkbookQueries['cellTableAt'] = (cell) => {
    let [{ sheetId }, cellAddress] = [cell, cellRefOf(cell)];
    return cellTableOfAnswer(
      core.answer({
        kind: 'readCellTableAt',
        sheetId,
        cell: cellAddress,
      }),
    );
  };
  let cellTableDeclaredAs: WorkbookQueries['cellTableDeclaredAs'] = (sheetId, cellTable) => {
    let answer = core.answer({
      kind: 'readCellTableDeclaredAs',
      sheetId,
      cellTable,
    });
    if (answer.kind === 'refused' && answer.refusal === 'readTookTooLong') return 'tookTooLong';
    return cellTableOfAnswer(answer) ?? 'nowhere';
  };
  let cellTables: WorkbookQueries['cellTables'] = (sheetId) => {
    let answer = core.answer({
      kind: 'readCellTables',
      sheetId,
    });
    if (answer.kind === 'cellTables') return answer.cellTables;
    if (answer.kind === 'refused') return answer.refusal === 'readTookTooLong' ? 'tookTooLong' : null;
    throw Error('sheets-core did not list the cell tables of a sheet');
  };
  let conditionalFormatsAsAgentIsTold: WorkbookQueries['conditionalFormatsAsAgentIsTold'] = (activeCell, selectionCorner) => {
    if (activeCell.sheetId !== selectionCorner.sheetId) return null;
    let cells = areaRefBetween(activeCell, selectionCorner);
    let answer = core.answer({
      kind: 'readConditionalFormatsAsAgentIsTold',
      cells,
    });
    if (answer.kind === 'conditionalFormatsAsAgentIsTold') return answer.told;
    if (answer.kind === 'refused') return null;
    throw Error('sheets-core did not say what Agent is told of conditional formats');
  };
  let conditionalFormatsInIds: WorkbookQueries['conditionalFormatsInIds'] = (sheetId, written) => {
    let answer = core.answer({
      kind: 'readConditionalFormatsInIds',
      sheetId,
      written,
    });
    if (answer.kind === 'conditionalFormatsInIds') return answer.read;
    if (answer.kind === 'refused') return null;
    throw Error('sheets-core did not read conditional formats in ids');
  };
  let conditionalFormatsByAddress: WorkbookQueries['conditionalFormatsByAddress'] = (sheetId, rules) => {
    let answer = core.answer({
      kind: 'readConditionalFormatsByAddress',
      sheetId,
      rules: [...rules],
    });
    if (answer.kind === 'conditionalFormatsByAddress') return answer.rules;
    if (answer.kind === 'refused') return null;
    throw Error('sheets-core did not read conditional formats by address');
  };
  let proposedFormulaValue: WorkbookQueries['proposedFormulaValue'] = (cell, text) => {
    let answer = core.answer({
      kind: 'readProposedFormulaValue',
      sheetId: cell.sheetId,
      cell: cellRefOf(cell),
      text,
    });
    if (answer.kind === 'proposedFormulaValue')
      return {
        cell: answer.cell,
      };
    if (answer.kind === 'refused') return null;
    throw Error('sheets-core did not say what an entry comes to');
  };
  let filteredRows: WorkbookQueries['filteredRows'] = (table, filter) => {
    let answer = core.answer({
      kind: 'readFilteredRows',
      table,
      filter,
    });
    if (answer.kind === 'filteredRows' || answer.kind === 'refused') return answer;
    throw Error('sheets-core did not say which rows a filter takes out of view');
  };
  let valuesOfFilteredColumn: WorkbookQueries['valuesOfFilteredColumn'] = (table, filter, columnId) => {
    let answer = core.answer({
      kind: 'readValuesOfFilteredColumn',
      table,
      filter,
      c: columnId,
    });
    if (answer.kind === 'valuesOfFilteredColumn' || answer.kind === 'refused') return answer;
    throw Error('sheets-core did not say what a column of a filtered table holds');
  };
  let rowsInSortedOrder: WorkbookQueries['rowsInSortedOrder'] = (toSort) => {
    let answer = core.answer({
      kind: 'readRowsInSortedOrder',
      ...toSort,
    });
    if (answer.kind === 'rowsInSortedOrder' || answer.kind === 'refused') return answer;
    throw Error('sheets-core did not say in which order a sort would put rows');
  };
  let tablesOfSheet: WorkbookQueries['tablesOfSheet'] = (sheetId) => {
    let answer = core.answer({
      kind: 'readTablesOfSheet',
      sheetId,
    });
    if (answer.kind === 'tablesOfSheet' || answer.kind === 'refused') return answer;
    throw Error('sheets-core did not say which tables a sheet has');
  };
  let pivotTableAt: WorkbookQueries['pivotTableAt'] = (cell) => {
    let [{ sheetId }, cellAddress] = [cell, cellRefOf(cell)];
    let answer = core.answer({
      kind: 'readPivotTableAt',
      sheetId,
      cell: cellAddress,
    });
    if (answer.kind === 'pivotTableAt' || answer.kind === 'refused') return answer;
    throw Error('sheets-core did not say which pivot table a cell is part of');
  };
  let valuesToFilterPivotTableBy: WorkbookQueries['valuesToFilterPivotTableBy'] = (source, columnId, keeps, listed) => {
    let answer = core.answer({
      kind: 'readValuesToFilterPivotTableBy',
      source,
      c: columnId,
      keeps,
      listed: [...listed],
    });
    if (answer.kind === 'valuesOfFilteredColumn' || answer.kind === 'refused') return answer;
    throw Error('sheets-core did not say what a pivot table can be filtered by');
  };
  let readCauseOfError = ({ sheetId, cell }: CauseCell): CauseOfError | null | undefined => {
    let answer = core.answer({
      kind: 'readCauseOfError',
      sheetId,
      cell,
    });
    if (answer.kind === 'causeOfError') return answer.cause;
    if (answer.kind === 'refused') return;
    throw Error('sheets-core did not say why a formula comes to an error');
  };
  return {
    filteredRows,
    valuesOfFilteredColumn,
    rowsInSortedOrder,
    tablesOfSheet,
    pivotTableAt,
    valuesToFilterPivotTableBy,
    proposedFormulaValue,
    causeOfError: (cell) => {
      let cause = readCauseOfError({
        sheetId: cell.sheetId,
        cell: cellRefOf(cell),
      });
      if (cause === undefined)
        return {
          said: NO_CAUSE_OF_ERROR,
          isLatest: true,
        };
      let deadlineMs = nowMs() + ERROR_CHAIN_BUDGET_MS;
      let passedOnFrom: CauseCell | null = null;
      let step: CauseOfError | null | undefined = cause;
      for (
        let stepsLeft: number = MAX_ERROR_CHAIN_STEPS;
        stepsLeft > 0 && step?.kind === 'showsTheSameError' && nowMs() < deadlineMs;
        stepsLeft -= 1
      ) {
        passedOnFrom = step.cell;
        step = readCauseOfError(passedOnFrom);
      }
      let isChainEnded = step?.kind !== 'showsTheSameError';
      return {
        said: {
          cause,
          passedOnFrom: isChainEnded ? passedOnFrom : null,
        },
        isLatest: true,
      };
    },
    formatsGivenAsIf,
    conditionalFormatSuggestions,
    tableAtCell,
    cellTableAt,
    cellTables,
    cellTableDeclaredAs,
    conditionalFormatsAsAgentIsTold,
    conditionalFormatsInIds,
    conditionalFormatsByAddress,
    cellsToCopy,
    dropdownOptionsToOffer,
    cellsThatADropdownWouldClear,
    cellsOfTheDropdownAt,
    whatATableChanges,
  };
}
export function readFormatsGiven(core: SessionAnswers, sheetId: SheetId): FormatsGivenAnswer {
  let answer = core.answer({
    kind: 'readFormatsGiven',
    sheetId,
  });
  if (answer.kind !== 'formatsGiven') throw Error('sheets-core did not say what conditional formats give');
  return answer;
}
export function readInputsOfView(core: SessionAnswers, viewId: string): InputsOfViewRead {
  let answer = core.answer({
    kind: 'readInputsOfView',
    viewId,
  });
  if (answer.kind !== 'inputsOfView' && answer.kind !== 'refused') throw Error('sheets-core did not read the inputs of a view');
  return {
    viewId,
    answer,
  };
}
export function readEverythingFromCore(core: SessionAnswers, sharedCore: SheetsUtilities): EverythingRead {
  let description = sharedCore.answer({
    kind: 'describeSharedCode',
  });
  if (description.kind !== 'sharedCodeDescription') throw Error('sheets-core did not describe itself');
  let contents = core.answer({
    kind: 'readWorkbookWithCellsPacked',
  });
  if (contents.kind !== 'workbookContentsWithCellsPacked') throw Error('sheets-core did not read the workbook');
  let given = contents.sheets.flatMap(
    (sheet): FormatsGivenOfSheet[] =>
      sheet.conditionalFormats === undefined
        ? []
        : [
            {
              sheetId: sheet.sheetId,
              formatsGiven: readFormatsGiven(core, sheet.sheetId),
            },
          ],
  );
  let inputsOfViews = (contents.views ?? []).map(({ viewId }) => readInputsOfView(core, viewId));
  let { localeOfANewWorkbook } = readLocales(sharedCore);
  return {
    kind: 'everything',
    description,
    localeOfANewWorkbook,
    contents,
    given,
    inputsOfViews,
  };
}
export function readViewsFromCore(core: SessionAnswers, viewIds: readonly string[]): ViewChangesRead {
  let answer = core.answer({
    kind: 'readViews',
  });
  if (answer.kind !== 'views') throw Error('sheets-core did not read the views');
  let viewIdsNow = new Set<string>(answer.views.map(({ viewId }) => viewId));
  return {
    viewsNow: answer.views,
    inputsNow: viewIds
      .filter((viewId) => viewIdsNow.has(viewId))
      .map((viewId) => readInputsOfView(core, viewId)),
  };
}
/** The cells of whole rows, packed: every row, or those named; every column, or only some. */
export function readRowsFromCore(core: SessionAnswers, sheetId: SheetId, rowIds: RowId[] | 'all', columnIds: ColumnsToRead): RowsRead | null {
  if (rowIds.length === 0)
    return {
      rowsListed: rowIds,
      cellsNow: [],
      spilledCellsNow: [],
    };
  let rows = rowIds === 'all' ? null : rowIds;
  let answer = core.answer({
    kind: 'readRowsWithCellsPacked',
    sheetId,
    rows,
    columns: columnIds,
  });
  if (answer.kind === 'refused') return null;
  if (answer.kind !== 'rowsWithCellsPacked') throw Error('sheets-core did not read rows');
  return {
    rowsListed: rowIds,
    cellsNow: answer.cells,
    spilledCellsNow: answer.spilledCells ?? [],
  };
}
/**
 * Reads the rows of the cells listed, or the whole sheet when what was read of it since it was read whole may be
 * twice what it needs; and the time zone too when it changed.
 */
export function readChangedFromCore(
  core: SessionAnswers,
  changedSheets: readonly SheetChanges[],
  changedViewIds: readonly string[],
  isTimeZoneChanged: boolean,
  mayBeTwiceWhatIsNeededIn: (sheetId: SheetId) => boolean,
): ChangedRead {
  let readSheet = ({
    sheetId,
    cells,
    isLayoutChanged,
    areFormatsGivenChanged,
  }: SheetChanges): SheetChangesPacked => {
    let rowIds: RowId[] | 'all' = mayBeTwiceWhatIsNeededIn(sheetId) ? 'all' : [...new Set(cells.map(({ r: rowId }) => rowId))];
    let rowsRead = readRowsFromCore(core, sheetId, rowIds, null);
    if (rowsRead === null) throw Error('sheets-core did not read rows');
    let layout = isLayoutChanged
      ? core.answer({
          kind: 'readSheetLayout',
          sheetId,
        })
      : null;
    if (layout !== null && layout.kind !== 'sheetLayout') throw Error('sheets-core did not read the layout of a sheet');
    return {
      sheetId,
      ...rowsRead,
      layoutNow: layout,
      formatsGivenNow: areFormatsGivenChanged === true ? readFormatsGiven(core, sheetId) : null,
    };
  };
  let timeZoneAnswer = isTimeZoneChanged
    ? core.answer({
        kind: 'readTimeZone',
      })
    : null;
  if (timeZoneAnswer !== null && timeZoneAnswer.kind !== 'timeZone') throw Error('sheets-core did not read the time zone');
  return {
    kind: 'changed',
    sheets: changedSheets.map(readSheet),
    views: changedViewIds.length === 0 ? null : readViewsFromCore(core, changedViewIds),
    timeZone: timeZoneAnswer,
  };
}
export function applyCoreReadout(readout: WorkbookRead | null, read: CoreRead, sharedCore: SheetsUtilities): WorkbookRead {
  if (read.kind === 'everything') {
    let { contents } = read;
    return readWorkbook(
      {
        ...contents,
        sheets: contents.sheets.map(withRowsOfCells),
      },
      {
        ...read.description,
        localeOfANewWorkbook: read.localeOfANewWorkbook,
      },
      readNumberFormatKindWith(sharedCore),
      read.given,
      read.inputsOfViews,
    );
  }
  if (readout === null) throw Error('changes were listed to a page that has read nothing');
  let changed = applyWorkbookChanges(readout, read.sheets.map(withRowsOfCellsNow), read.views);
  return read.timeZone === null
    ? changed
    : {
        ...changed,
        timeZone: read.timeZone.timeZone,
      };
}
export function createReadSizes(): ReadSizes {
  let sizes = new Map<SheetId, SizeRead>();
  return {
    note(read) {
      if (read.kind === 'everything') {
        let { sheets } = read.contents;
        sizes = new Map(
          sheets.map(({ sheetId, cells }): [SheetId, SizeRead] => [
            sheetId,
            {
              whole: packedSizeOf(cells),
              since: 0,
            },
          ]),
        );
        return;
      }
      for (let { sheetId, rowsListed, cellsNow } of read.sheets) {
        let { whole = 0, since = 0 } = sizes.get(sheetId) ?? {};
        let size = packedSizeOf(cellsNow);
        sizes.set(
          sheetId,
          rowsListed === 'all'
            ? {
                whole: size,
                since: 0,
              }
            : {
                whole,
                since: since + size,
              },
        );
      }
    },
    mayBeTwiceWhatIsNeededIn(sheetId) {
      let { whole = 0, since = 0 } = sizes.get(sheetId) ?? {};
      return since > Math.max(whole, BYTES_READ_BEFORE_A_WHOLE_READ);
    },
  };
}
/**
 * `onRead` hears each read with its packed cells (the readout gets them as rows); with an `onRead` the read is
 * kept without its cells. `readWithCellsIn` reads some rows (some columns of them) into a workbook of its own,
 * leaving the readout as it is.
 */
export function createWorkbookReader(
  core: SessionAnswers,
  sharedCore: SheetsUtilities,
  utilities: WorkbookServices = createCoreUtilities(core, sharedCore),
  onRead?: (read: CoreRead) => void,
): WorkbookReader {
  let readout: WorkbookRead | null = null;
  let readSizes = createReadSizes();
  let take = (read: CoreRead): WorkbookReads => {
    readSizes.note(read);
    let kept = onRead === undefined ? read : withoutCells(read);
    readout = applyCoreReadout(readout, kept, sharedCore);
    onRead?.(read);
    return createWorkbookAccessor(readout, utilities);
  };
  return {
    readEverything: () => take(readEverythingFromCore(core, sharedCore)),
    readChanged(changedSheets, changedViewIds, isTimeZoneChanged) {
      if (readout === null) throw Error('changes were listed to a page that has read nothing');
      return take(readChangedFromCore(core, changedSheets, changedViewIds, isTimeZoneChanged, readSizes.mayBeTwiceWhatIsNeededIn));
    },
    readWithCellsIn(sheetId, rowIds, columnIds) {
      let rowsRead = readRowsFromCore(core, sheetId, rowIds, columnIds);
      if (readout === null || rowsRead === null) return null;
      let sheetRead = withRowsOfCellsNow({
        sheetId,
        ...rowsRead,
        layoutNow: null,
        formatsGivenNow: null,
      });
      return createWorkbookAccessor(applyWorkbookChanges(readout, [sheetRead]), utilities);
    },
  };
}
export const newIdCode = (): string =>
  [...crypto.getRandomValues(new Uint8Array(10))]
    .map((byte) => 'abcdefghijkmnpqrstuvwxyz23456789'[byte % 32])
    .join('');
export const numberFormatKindCache = new Map<string, NumberFormatKind>();
export const readNumberFormatKindWith =
  (core: SheetsUtilities): KindOfPattern =>
  (pattern) => {
    let cached = numberFormatKindCache.get(pattern);
    if (cached !== undefined) return cached;
    let answer = core.answer({
      kind: 'readKindOfPattern',
      pattern,
    });
    if (answer.kind !== 'kindOfPattern') throw Error('sheets-core did not read the pattern of a number format that a cell has');
    numberFormatKindCache.set(pattern, answer.numberFormatKind);
    return answer.numberFormatKind;
  };
export const timeCoreAnswers = <Started>(
  core: SessionAnswers,
  startTiming: () => Started,
  noteTiming: (kind: SessionRequest['kind'], started: Started) => void,
): SessionAnswers => ({
  answer(request) {
    let started = startTiming();
    try {
      return core.answer(request);
    } finally {
      // A read of some columns of rows is timed apart from a read of whole rows: it is not counted.
      if (!(request.kind === 'readRowsWithCellsPacked' && (request as ReadRowsWithCellsPackedRequest).columns !== null)) noteTiming(request.kind, started);
    }
  },
});
export const MAX_ERROR_CHAIN_STEPS = 39;
export const ERROR_CHAIN_BUDGET_MS = 50;
export const createCoreUtilities = (
  core: SessionAnswers,
  sharedCore: SheetsUtilities,
  makeIdCode: () => string = newIdCode,
  nowMs: () => number = () => performance.now(),
): CoreUtilities => ({
  ...createLocaleReaders(sharedCore),
  ...createWorkbookQueries(core, makeIdCode, nowMs),
});
export const withCellsTaken = (read: CoreRead, takeCells: () => CellsPacked[]): CoreRead =>
  read.kind === 'everything'
    ? {
        ...read,
        contents: {
          ...read.contents,
          sheets: read.contents.sheets.map((sheet) => ({
            ...sheet,
            cells: takeCells(),
          })),
        },
      }
    : {
        ...read,
        sheets: read.sheets.map((sheet) => ({
          ...sheet,
          cellsNow: takeCells(),
        })),
      };
export const withoutCells = (read: CoreRead): CoreRead =>
  read.kind === 'everything'
    ? {
        ...read,
        contents: {
          ...read.contents,
          sheets: read.contents.sheets.map((sheet) => ({
            ...sheet,
            cells: [],
            spilledCells: [],
          })),
        },
      }
    : {
        ...read,
        sheets: read.sheets.map((sheet) => ({
          ...sheet,
          rowsListed: [],
          cellsNow: [],
          spilledCellsNow: [],
        })),
      };
export const withRowsOfCellsNow = (sheetRead: SheetChangesPacked): SheetChangesRead => ({
  ...sheetRead,
  cellsNow: rowsOfPackedCells(sheetRead.cellsNow),
});
export const withRowsOfCells = (sheet: SheetContentsWithBlocks): SheetToRead => ({
  ...sheet,
  cells: rowsOfPackedCells(sheet.cells),
});
export const BYTES_OF_A_BLOCK = 1500;
export const packedSizeOf = (blocks: readonly CellsPacked[]): number =>
  blocks.reduce((size, { lists, texts }) => size + BYTES_OF_A_BLOCK + lists.byteLength + texts.length, 0);
export const BYTES_READ_BEFORE_A_WHOLE_READ = 8388608;
