import type {
  CellConditionKind,
  ColumnId,
  ColumnOfATable,
  DecimalSignName,
  FormatOfACondition,
  RangeCorners,
  RuleInIds,
  SheetId,
  Test,
} from '@open-artifact/sheets-core';
import type { TableHolds } from '../state/initial-state.ts';
import type { CellArea } from '../selection/model.ts';
import type { RuleDescription } from '../messages/conditional-format.ts';
import type { FormatWhereEffect } from '../format/conditional/rule-edits.ts';
import type { FilterLine } from '../tables/filter-model.ts';
import type { RowsNotRecords } from './table-holds.ts';
import type { RuleWordsNotRead } from './rule-formats.ts';
import type { ColumnTest, RuleWordsSituation } from './rule-tests.ts';
import {
  rowsThatAreNotRecords,
  MOST_NAME_CHARACTERS,
  RULE_WORDS_NOT_READ,
  tableAtCellCached,
  tableHoldsOf,
  isTooMuchToRead,
  MOST_RULE_RANGES,
} from './table-holds.ts';
import { cellValueOf } from '../model/cell-values.ts';
import { numberFormatOfCell } from '../model/workbook.ts';
import { MOST_CHARACTERS_OF_WORDS } from './vocabulary.ts';
import { parseA1AreaAsSeen } from '../model/a1-references.ts';
import { areasOfRuleRanges, describeRule } from '../format/conditional/descriptions.ts';
import { readRuleFromWords, namesAColumn, columnsOfConditionClause } from './read-rule.ts';
import { measureOfColumn } from './column-holds.ts';
import { suggestedRulesFor } from '../format/conditional/rule-edits.ts';
import type { CellId, SheetRead, WorkbookReads } from '../model/workbook.ts';
/** Where the words of a rule were typed, and what reading them needs to know of the page. */
export interface RuleWordsPlace {
  /** A cell of the table the rule is for. */
  inTable: CellId;
  /** The selected cells, or `null` when several ranges are selected. */
  selected: CellArea | null;
  isOneCellSelected: boolean;
  viewer: string | null;
  /** The day, as an ISO date. */
  today: string;
  /** The look a rule gets when its words name none. */
  lookToStartFrom: FormatOfACondition;
}
/** The rules read from words, and whether they may run on to the last record of the table. */
export type RulesReadInTable = { kind: 'read'; rules: RuleInIds[]; endAtLastRecord: boolean } | RuleWordsNotRead;
/** Rows around a table that are not its records, and whether the sheet holds more than the table. */
export interface RecordsAroundTable {
  noRecords: RowsNotRecords;
  isMoreOnTheSheet: boolean;
}
export function isMoreOnTheSheetThan(
  reads: WorkbookReads,
  sheetId: SheetId,
  { topRowIndex, rowCount, columnCount }: Pick<CellArea, 'topRowIndex' | 'rowCount' | 'columnCount'>,
): boolean {
  for (let [rowId, cellsHeld] of reads.cellsHeldByRow(sheetId)) {
    if (cellsHeld.size < 2) continue;
    let rowIndex = reads.rowIndexOf(sheetId, rowId);
    if (!(rowIndex !== null && rowIndex >= topRowIndex && rowIndex < topRowIndex + rowCount) || cellsHeld.size >= columnCount + 2) return true;
  }
  return false;
}
export function recordsAroundTableCached(
  reads: WorkbookReads,
  sheetId: SheetId,
  tableArea: CellArea,
  recordsArea: CellArea,
): RecordsAroundTable {
  let sheetNow = reads.sheetAsItStands(sheetId);
  let cacheKey = JSON.stringify([tableArea, recordsArea]);
  let cached = sheetNow === null ? undefined : recordsAroundTableCache.get(sheetNow)?.get(cacheKey);
  if (cached !== undefined) return cached;
  let around: RecordsAroundTable = {
    noRecords: rowsThatAreNotRecords(reads, sheetId, tableArea),
    isMoreOnTheSheet: isMoreOnTheSheetThan(reads, sheetId, recordsArea),
  };
  if (sheetNow !== null)
    recordsAroundTableCache.set(sheetNow, (recordsAroundTableCache.get(sheetNow) ?? new Map<string, RecordsAroundTable>()).set(cacheKey, around));
  return around;
}
export function hasMixedNumberKinds(
  reads: WorkbookReads,
  sheetId: SheetId,
  { topRowIndex, rowCount, leftColumnIndex, columnCount }: CellArea,
): boolean {
  let kindsSeen = new Set<string>();
  for (let rowOffset = 0; rowOffset < rowCount; rowOffset += 1) {
    if (rowOffset === MOST_ROWS_SCANNED_EACH_END && rowCount > 2 * rowOffset) rowOffset = rowCount - MOST_ROWS_SCANNED_EACH_END;
    for (let columnOffset = 0; columnOffset < columnCount; columnOffset += 1) {
      let cellId = reads.cellIdAt(sheetId, topRowIndex + rowOffset, leftColumnIndex + columnOffset);
      let shown = cellId === null ? null : cellValueOf(reads.cellOnShowIn(cellId));
      if (shown?.kind === 'text' && /\d/.test(shown.value)) return true;
      if (cellId === null || shown?.kind !== 'number') continue;
      let { kind, pattern } = numberFormatOfCell(reads, cellId);
      if (kind === 'time' || kind === 'duration') return true;
      kindsSeen.add(kind + (/[$€£¥]/.exec(pattern)?.[0] ?? ''));
      if (kindsSeen.size > 1) return true;
    }
  }
  return false;
}
export function numbersSaidIn(words: string): Set<number> {
  let numbers = Array.from(
    words.matchAll(/(\d[\d,]*(?:\.\d+)?|\.\d+)(k)?/gi),
    ([, digits = '', thousands]) => Number(digits.replaceAll(',', '')) * (thousands === undefined ? 1 : 1000),
  );
  return new Set<number>([...(/\b(?:zero|negative|positive)\b/i.test(words) ? [0] : []), ...numbers]);
}
export function doesDateTextMatchWords(text: string, words: string): boolean {
  let digitRuns = digitRunsOf(text);
  if (/^-?[\d.,]+$/.test(text) || digitRuns.length + (/\p{L}/u.test(text) ? 1 : 0) < 3) return false;
  let datesSaid = words.match(/(?<![\d/.-])\d{1,2}(?:\/\d{1,2}|([/.-])\d{1,2}\1\d{1,4})(?![\d/])/g) ?? [];
  return (
    /\p{L}/u.test(text) ||
    (digitRuns[0] ?? 0) > 31 ||
    datesSaid.length === 0 ||
    datesSaid.some(
      (dateSaid) =>
        digitRunsOf(dateSaid).every((run, runIndex) => run % 100 === (digitRuns[runIndex] ?? -1) % 100),
    )
  );
}
export function areDescribedNumbersInWords(rule: RuleDescription, words: string, decimalSign: DecimalSignName): boolean {
  if (rule.does.kind !== 'formatWhere') return true;
  let numbersSaid = numbersSaidIn(words);
  return rule.does.tests.every(
    ({ isOfDates, condition }) =>
      Object.values(condition).every((operand) => {
        if (
          typeof operand !== 'object' ||
          operand === null ||
          !('kind' in operand) ||
          operand.kind !== 'shown' ||
          !('text' in operand) ||
          typeof operand.text !== 'string'
        )
          return true;
        if (isOfDates) return doesDateTextMatchWords(operand.text, words);
        let [groupMark, decimalMark] = decimalSign === 'comma' ? ['.', ','] : [',', '.'];
        let plainText = operand.text.replaceAll(groupMark, '').replace(decimalMark, '.');
        let [, numberText] = /^[^\d:]*?(\d+(?:\.\d+)?)[^\d:]*$/.exec(plainText) ?? [];
        return numberText !== undefined && numbersSaid.has(Number(numberText));
      }),
  );
}
export function isColumnInThousands({ name }: Pick<ColumnOfATable, 'name'>, isScaleWordAllowed: boolean): boolean {
  if (name === null || name.length > MOST_NAME_CHARACTERS) return false;
  if (/\bin\s+(?:thousands|millions|billions)\b/i.test(name)) return true;
  let [, noteText = ''] = /\(([^(]*)$/.exec(name) ?? /(\S*[$€£¥].*)$/.exec(name) ?? [];
  let hasCurrency = noteText.search(currencyMarkPattern) !== -1;
  return noteText
    .replace(currencyMarkPattern, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .some(
      (word) =>
        /^(?:k|mn|bn|000s?|thousands?|millions?|billions?)$/i.test(word) ||
        ((hasCurrency || isScaleWordAllowed) && /^(?:mm?|b)$/i.test(word)) ||
        (isScaleWordAllowed && /^km$/i.test(word)),
    );
}
export function withoutParenthesesInColumnNames(holds: TableHolds): TableHolds {
  let cached = holdsWithoutNameNotesCache.get(holds);
  if (cached !== undefined) return cached;
  let trimmed: TableHolds = {
    ...holds,
    columns: holds.columns.map((column) => {
      let { name } = column;
      return name === null || name.length > MOST_NAME_CHARACTERS || !trailingParenthesisPattern.test(name)
        ? column
        : {
            ...column,
            name: name.replace(/\s*\([^()]*\)\s*$/, ''),
          };
    }),
  };
  holdsWithoutNameNotesCache.set(holds, trimmed);
  return trimmed;
}
export function readConditionalFormatFromWords(reads: WorkbookReads, words: string, context: RuleWordsPlace): RulesReadInTable {
  let { inTable, viewer, today, lookToStartFrom } = context;
  let { sheetId } = inTable;
  if (words.length > MOST_CHARACTERS_OF_WORDS) return RULE_WORDS_NOT_READ;
  let isQuoted = /["“”]/.test(words);
  let [rangeSaid, ...moreRangesSaid] = isQuoted ? [] : (words.match(cellRangeInWordsPattern) ?? []);
  let sheet = reads.listSheets().find((listed) => listed.sheetId === sheetId);
  let rangeAreaSaid =
    rangeSaid === undefined || sheet === undefined ? null : parseA1AreaAsSeen(rangeSaid.replace(/^.*\s/s, '').replaceAll('$', ''), sheet);
  if (rangeSaid !== undefined && (rangeAreaSaid === null || moreRangesSaid.length > 0)) return RULE_WORDS_NOT_READ;
  const targetArea = rangeAreaSaid ?? context.selected;
  let isOneCellOnly = rangeAreaSaid === null && context.isOneCellSelected;
  let wordsWithoutRange = rangeSaid === undefined ? words : words.replace(rangeSaid, ' ');
  let wordsToRead = isQuoted ? wordsWithoutRange : wordsWithoutRange.replaceAll(wholeColumnInWordsPattern, 'column $1');
  let tableAt = tableAtCellCached(reads, inTable);
  if (tableAt === null || tableAt.table.header === null) return RULE_WORDS_NOT_READ;
  let { table } = tableAt;
  let { header } = tableAt.table;
  let bodyRange = {
    topLeft: {
      r: table.firstRowOfBody,
      c: table.firstColumn,
    },
    bottomRight: {
      r: table.lastRowOfBody,
      c: table.lastColumn,
    },
  };
  let [bodyArea] = areasOfRuleRanges(reads, sheetId, [bodyRange]);
  let headerRowIndex = reads.rowIndexOf(sheetId, header.firstRow);
  const lines = reads.linesOf(sheetId);
  if (bodyArea === undefined || headerRowIndex === null || lines === null) return RULE_WORDS_NOT_READ;
  let bodyEndRow = bodyArea.topRowIndex + bodyArea.rowCount;
  const isTargetInTable =
    targetArea !== null &&
    targetArea.leftColumnIndex >= bodyArea.leftColumnIndex &&
    targetArea.leftColumnIndex + targetArea.columnCount <= bodyArea.leftColumnIndex + bodyArea.columnCount &&
    targetArea.topRowIndex < bodyEndRow &&
    targetArea.topRowIndex + targetArea.rowCount > headerRowIndex;
  let selectedColumnIds = isTargetInTable
    ? Array.from(
        {
          length: targetArea.columnCount,
        },
        (_slot, columnOffset) => lines.columns.idAt(targetArea.leftColumnIndex + columnOffset) ?? [],
      ).flat()
    : [];
  let holds = tableHoldsOf(reads, tableAt);
  if (isTooMuchToRead(holds)) return RULE_WORDS_NOT_READ;
  let readContext: RuleWordsSituation = {
    today,
    signsOfNumbers: reads.signsOfNumbers,
    isMonthFirst: reads.locale === 'en-US',
    selected: selectedColumnIds,
    areSeveralCellsSelected: isTargetInTable && !isOneCellOnly,
    columnLettered: (letters) => {
      let area = parseA1AreaAsSeen(letters + '1', {
        ownRowOrder: null,
        rowCount: lines.rows.count,
        columnCount: lines.columns.count,
      });
      return area === null ? null : lines.columns.idAt(area.leftColumnIndex);
    },
  };
  let read = readRuleFromWords(wordsToRead, holds, viewer, readContext);
  let readUsed =
    read.kind === 'read' || !holds.columns.some(({ name }) => trailingParenthesisPattern.test(name ?? ''))
      ? read
      : readRuleFromWords(wordsToRead, withoutParenthesesInColumnNames(holds), viewer, readContext);
  if (readUsed.kind === 'notRead') return read.kind === 'notRead' ? read : readUsed;
  let isColumnNamedInWords = namesAColumn(wordsToRead, holds) || namesAColumn(wordsToRead, withoutParenthesesInColumnNames(holds));
  if (!header.isSure && !isColumnNamedInWords) return RULE_WORDS_NOT_READ;
  if (rangeAreaSaid !== null && !readUsed.isAboutSelected) return RULE_WORDS_NOT_READ;
  let recordsArea = {
    ...bodyArea,
    topRowIndex: headerRowIndex,
    rowCount: bodyArea.topRowIndex + bodyArea.rowCount - headerRowIndex,
  };
  let recordsAround = recordsAroundTableCached(reads, sheetId, bodyArea, recordsArea);
  let goesPastRecords = targetArea !== null && targetArea.topRowIndex + targetArea.rowCount > recordsArea.topRowIndex + recordsArea.rowCount;
  if (recordsAround.isMoreOnTheSheet && (!isTargetInTable || (goesPastRecords && !isOneCellOnly))) return RULE_WORDS_NOT_READ;
  if (recordsAround.noRecords.isOneEmpty) return RULE_WORDS_NOT_READ;
  let firstRowIndex = rangeAreaSaid?.topRowIndex ?? Math.max(bodyArea.topRowIndex, targetArea?.topRowIndex ?? 0);
  let endRowIndex =
    rangeAreaSaid === null
      ? Math.min(bodyEndRow, (targetArea?.topRowIndex ?? 0) + (targetArea?.rowCount ?? 0))
      : firstRowIndex + rangeAreaSaid.rowCount;
  let isPartOfColumn =
    !isOneCellOnly &&
    isTargetInTable &&
    wordsToRead === wordsWithoutRange &&
    firstRowIndex < endRowIndex &&
    (firstRowIndex !== bodyArea.topRowIndex || endRowIndex !== bodyEndRow);
  let [firstRowId, lastRowId] = isPartOfColumn
    ? [lines.rows.idAt(firstRowIndex), lines.rows.idAt(endRowIndex - 1)]
    : [lines.rows.idAt(bodyArea.topRowIndex), lines.rows.idAt(bodyEndRow - 1)];
  if (firstRowId === null || lastRowId === null) return RULE_WORDS_NOT_READ;
  let lastColumnId: ColumnId = readUsed.isAboutSelected ? (selectedColumnIds.at(-1) ?? readUsed.c) : readUsed.c;
  let ruleRange: RangeCorners = readUsed.isForRows
    ? {
        topLeft: {
          r: firstRowId,
          c: table.firstColumn,
        },
        bottomRight: {
          r: lastRowId,
          c: table.lastColumn,
        },
      }
    : {
        topLeft: {
          r: firstRowId,
          c: readUsed.c,
        },
        bottomRight: {
          r: lastRowId,
          c: lastColumnId,
        },
      };
  let endAtLastRecord = rangeAreaSaid === null && !isPartOfColumn;
  const { rule } = readUsed;
  let columnsUsed =
    rule.kind === 'colorScale' ? [] : [...(readUsed.isAboutSelected ? selectedColumnIds : []), ...rule.allOf.flatMap(columnsOfConditionClause)];
  if (/\dk\b/i.test(wordsToRead) && holds.columns.some((column) => isColumnInThousands(column, columnsUsed.includes(column.c))))
    return RULE_WORDS_NOT_READ;
  let rankedColumns =
    rule.kind === 'colorScale'
      ? [readUsed.c]
      : rule.allOf.flatMap(({ c, condition: { kind } }) => (RANKED_CONDITION_KINDS.has(kind) ? [c] : []));
  const [ruleArea] = areasOfRuleRanges(reads, sheetId, [ruleRange]);
  if (ruleArea === undefined) return RULE_WORDS_NOT_READ;
  let nonRecordRows = recordsAround.noRecords.rows.filter(
    (rowIndex) => rowIndex >= ruleArea.topRowIndex && rowIndex < ruleArea.topRowIndex + ruleArea.rowCount,
  );
  let mostRanges = Math.min(MOST_RULE_RANGES, reads.limitsOfConditionalFormats().mostRangesInAConditionalFormat);
  if (nonRecordRows.length > mostRanges) return RULE_WORDS_NOT_READ;
  if (rankedColumns.length > 0 && (nonRecordRows.length > 0 || recordsAround.noRecords.isMiddleUnread)) return RULE_WORDS_NOT_READ;
  let numberColumns =
    rule.kind === 'colorScale'
      ? [readUsed.c]
      : rule.allOf.flatMap(
          (test) =>
            'operand' in test.condition ||
            'oneEnd' in test.condition ||
            'count' in test.condition ||
            (test.condition.kind === 'appearsMoreThanOnce' &&
              measureOfColumn(
                tableAt.columns.find(({ c }) => c === test.c) ?? {
                  kind: 'text',
                },
              ) !== null)
              ? columnsOfConditionClause(test)
              : [],
        );
  let columnArea = (columnId: ColumnId): CellArea | null => {
    let columnIndex = reads.columnIndexOf(sheetId, columnId);
    if (readUsed.isAboutSelected) return ruleArea;
    return columnIndex === null
      ? null
      : {
          ...ruleArea,
          leftColumnIndex: columnIndex,
          columnCount: 1,
        };
  };
  if (
    numberColumns.some((columnId) => {
      let area = columnArea(columnId);
      return area === null || hasMixedNumberKinds(reads, sheetId, area);
    })
  )
    return RULE_WORDS_NOT_READ;
  if (rule.kind === 'colorScale')
    return {
      kind: 'read',
      rules: [suggestedRulesFor([ruleRange]).scale],
      endAtLastRecord,
    };
  if (rule.allOf.length > reads.limitsOfConditionalFormats().mostTestsInAConditionalFormat) return RULE_WORDS_NOT_READ;
  let toTest = ({ c, condition }: ColumnTest): Test => ({
    tested:
      !readUsed.isForRows && c === readUsed.c
        ? {
            kind: 'theCellItself',
          }
        : {
            kind: 'sameRowInColumn',
            c,
          },
    condition,
  });
  let [firstTest, ...otherTests] = rule.allOf;
  let effect: FormatWhereEffect = {
    kind: 'formatWhere',
    allOf: [toTest(firstTest), ...otherTests.map(toTest)],
    format: rule.format ?? lookToStartFrom,
  };
  let ruleToAdd: RuleInIds = {
    ranges: [ruleRange],
    effect,
  };
  if (!areDescribedNumbersInWords(describeRule(reads, sheetId, ruleToAdd, null), wordsWithoutRange, reads.decimalSign)) return RULE_WORDS_NOT_READ;
  let columnsOfRule = [...(readUsed.isAboutSelected ? selectedColumnIds : []), ...rule.allOf.flatMap(columnsOfConditionClause)];
  let hasValueInRow = (rowIndex: number): boolean =>
    columnsOfRule.some((columnId) => {
      let columnIndex = reads.columnIndexOf(sheetId, columnId);
      let cellId = columnIndex === null ? null : reads.cellIdAt(sheetId, rowIndex, columnIndex);
      return cellId !== null && reads.cellOnShowIn(cellId) !== null;
    });
  if (nonRecordRows.some(hasValueInRow)) return RULE_WORDS_NOT_READ;
  let rowRangesAt = (rowIndex: number): RangeCorners[] => {
    let rowId = lines.rows.idAt(rowIndex);
    return rowId === null
      ? []
      : [
          {
            topLeft: {
              ...ruleRange.topLeft,
              r: rowId,
            },
            bottomRight: {
              ...ruleRange.bottomRight,
              r: rowId,
            },
          },
        ];
  };
  let [firstRowRange, ...otherRowRanges] = nonRecordRows.flatMap(rowRangesAt);
  let givenOnRows =
    firstRowRange === undefined
      ? null
      : reads.formatsGivenAsIf(sheetId, [
          {
            ranges: [firstRowRange, ...otherRowRanges],
            effect,
            inPlaceOf: null,
          },
        ]);
  if (firstRowRange !== undefined && (givenOnRows?.matches[0]?.cells ?? 1) > 0) return RULE_WORDS_NOT_READ;
  if (readUsed.isAboutSelected && selectedColumnIds.length > 1)
    return {
      kind: 'read',
      rules: [ruleToAdd],
      endAtLastRecord,
    };
  let bodyColumnsRange = {
    topLeft: {
      ...ruleRange.topLeft,
      r: table.firstRowOfBody,
    },
    bottomRight: {
      ...ruleRange.bottomRight,
      r: table.lastRowOfBody,
    },
  };
  let isMergedInRow = (rowIndex: number): boolean =>
    columnsOfRule.some((columnId) => {
      let columnIndex = reads.columnIndexOf(sheetId, columnId);
      let mergedArea =
        columnIndex === null
          ? null
          : reads.mergedAreaAt(sheetId, {
              rowIndex,
              columnIndex,
            });
      return mergedArea !== null && mergedArea.rowCount > 1;
    });
  let rowsLeftOut =
    rankedColumns.length > 0 || recordsAround.noRecords.isMiddleUnread || recordsAround.noRecords.rows.some(isMergedInRow)
      ? []
      : recordsAround.noRecords.rows.slice(0, mostRanges);
  let [firstLeftOut, ...otherLeftOut] = rowsLeftOut.flatMap(rowRangesAt);
  let given = reads.formatsGivenAsIf(
    sheetId,
    firstLeftOut === undefined
      ? [
          {
            ranges: [bodyColumnsRange],
            effect,
            inPlaceOf: null,
          },
        ]
      : [
          {
            ranges: [bodyColumnsRange],
            effect,
            inPlaceOf: null,
          },
          {
            ranges: [firstLeftOut, ...otherLeftOut],
            effect,
            inPlaceOf: null,
          },
        ],
  );
  let matchedLeftOut = firstLeftOut === undefined ? 0 : (given?.matches[1]?.rows ?? NaN);
  let matchedRows = (given?.matches[0]?.rows ?? NaN) - matchedLeftOut;
  let filtered = reads.filteredRows(table, {
    allOf: [filterClauseOfRuleTest(firstTest), ...otherTests.map(filterClauseOfRuleTest)],
  });
  if (filtered?.kind !== 'filteredRows') return RULE_WORDS_NOT_READ;
  let rowsOutOfView = filtered.rowsOutOfView;
  let isRowInView = (rowIndex: number): boolean => {
    let rowId = lines.rows.idAt(rowIndex) ?? '';
    return !rowsOutOfView.some(({ base, first, count }) => {
      let number = Number(rowId.slice(base.length + 1));
      return rowId.startsWith(base + '.') && number >= first && number < first + count;
    });
  };
  return (firstLeftOut === undefined
    ? filtered.recordsInView
    : bodyArea.rowCount -
      rowsOutOfView.reduce((total, { count }) => total + count, 0) -
      rowsLeftOut.filter(isRowInView).length) === matchedRows
    ? {
        kind: 'read',
        rules: [ruleToAdd],
        endAtLastRecord,
      }
    : RULE_WORDS_NOT_READ;
}
export const recordsAroundTableCache = new WeakMap<SheetRead, Map<string, RecordsAroundTable>>();
export const MOST_ROWS_SCANNED_EACH_END = 300;
export const digitRunsOf = (text: string): number[] => (text.match(/\d+/g) ?? []).map(Number);
export const RANKED_CONDITION_KINDS = new Set<CellConditionKind>(['isAmongTheLargest', 'isAmongTheSmallest', 'appearsMoreThanOnce']);
export const currencyMarkPattern = /[$€£¥]|usd|eur|gbp|jpy|cad|aud|chf/gi;
export const trailingParenthesisPattern = /\S\s*\([^()]*\)\s*$/;
export const holdsWithoutNameNotesCache = new WeakMap<TableHolds, TableHolds>();
export const filterClauseOfRuleTest = ({ c, condition }: ColumnTest): FilterLine => ({
  anyOf: [
    {
      c,
      asked: {
        kind: 'meets',
        condition,
      },
    },
  ],
});
export const cellRangeInWordsPattern = /(?:\b(?:in|on|for|of|cells|range)\s+)*\$?[a-z]{1,3}\$?\d+:\$?[a-z]{1,3}\$?\d+(?![\w:])/gi;
export const wholeColumnInWordsPattern = /(?<![\w:$])\$?([a-z]{1,3}):\$?\1(?![\w:])/gi;
