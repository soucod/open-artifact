import type {
  ColumnId,
  ColumnOfRecords,
  ConditionalFormatSuggestionsAnswer,
  Matches,
  RangeCorners,
  RowId,
  RuleInIds,
  SheetId,
} from '@open-artifact/sheets-core';
import { areasOfRuleRanges } from './descriptions.ts';
import { measureOfColumn } from '../../words/column-holds.ts';
import { cornerCellIdsOf, tableColumnsInAbout, isSameRulesJson } from './pane-state.ts';
import { dropdownColorRuleLists, suggestionsForCells } from './suggestions.ts';
import { isSelectionOneCell } from '../../selection/keyboard.ts';
import { asNewRules } from './agent-rules.ts';
import type { PageState } from '../../state/initial-state.ts';
import type { CellId, WorkbookReads } from '../../model/workbook.ts';
import type { CellArea } from '../../selection/model.ts';
import type { TableOfRecords } from './conditions.ts';
import type { RulesForSelection } from './pane-state.ts';

/** A table of one row, kept in case no larger table is found. */
interface OneRowTable {
  records: RangeCorners;
  columnCount: number;
}
export function isOneTextColumnTable(reads: WorkbookReads, sheetId: SheetId, table: TableOfRecords): boolean {
  let [recordsArea] = areasOfRuleRanges(reads, sheetId, [table.records]);
  let [firstColumn = table.columns[0], ...otherColumns] = table.columns.filter((column) => isColumnFilled(column) || column.name !== null);
  return otherColumns.length === 0 && firstColumn.kind === 'text' && (recordsArea?.rowCount ?? 0) < 2;
}
export function looksLikeRecordsTable(reads: WorkbookReads, sheetId: SheetId, table: TableOfRecords): boolean {
  let [recordsArea] = areasOfRuleRanges(reads, sheetId, [table.records]);
  let filledColumns = table.columns.filter(isColumnFilled);
  return (
    recordsArea !== undefined &&
    recordsArea.rowCount > 1 &&
    recordsArea.columnCount === table.columns.length &&
    filledColumns.some(
      ({ kind, name }) =>
        name !== null &&
        measureOfColumn({
          kind,
        }) !== 'numbers',
    )
  );
}
export function mainTableCornersOnSheet(reads: WorkbookReads, sheetId: SheetId): [CellId, CellId] | null {
  let heldRows = [...reads.cellsHeldByRow(sheetId)].flatMap(([rowId, cells]) => {
    let rowIndex = reads.rowIndexOf(sheetId, rowId);
    return cells.size === 0 || rowIndex === null
      ? []
      : [
          {
            rowId,
            at: rowIndex,
            cells,
          },
        ];
  });
  heldRows.sort(
    (row, otherRow) =>
      row.cells.size === otherRow.cells.size ? row.at - otherRow.at : otherRow.cells.size - row.cells.size,
  );
  let tablesSeen: CellArea[] = [];
  let oneRowTable: OneRowTable | null = null;
  for (let { rowId, at: rowIndex, cells } of heldRows) {
    if (tablesSeen.length === MOST_TABLES_LOOKED_AT) break;
    let leftmostCell: { columnId: ColumnId; at: number } | null = null;
    for (let columnId of cells.keys()) {
      let columnIndex = reads.columnIndexOf(sheetId, columnId);
      if (columnIndex === null || (leftmostCell !== null && columnIndex >= leftmostCell.at)) continue;
      if (!tablesSeen.some((tableArea) => isCellInArea(tableArea, rowIndex, columnIndex)))
        leftmostCell = {
          columnId,
          at: columnIndex,
        };
    }
    if (leftmostCell === null) continue;
    let cell = {
      sheetId,
      rowId,
      columnId: leftmostCell.columnId,
    };
    let table = reads.conditionalFormatSuggestions(cell, cell)?.table ?? null;
    if (table === null) return null;
    let [recordsArea] = areasOfRuleRanges(reads, sheetId, [table.records]);
    if (recordsArea === undefined) return cornerCellIdsOf(sheetId, table.records);
    let isSmallOneColumnTable =
      recordsArea.columnCount === 1 && recordsArea.rowCount <= MOST_ROWS_OF_ONE_COLUMN_TABLE && (oneRowTable?.columnCount ?? 1) > 1;
    if (recordsArea.rowCount > 1 && !isSmallOneColumnTable) return cornerCellIdsOf(sheetId, table.records);
    if (recordsArea.rowCount === 1)
      oneRowTable ??= {
        records: table.records,
        columnCount: recordsArea.columnCount,
      };
    tablesSeen.push({
      ...recordsArea,
      topRowIndex: recordsArea.topRowIndex - 1,
      rowCount: recordsArea.rowCount + 1,
    });
  }
  return oneRowTable === null ? null : cornerCellIdsOf(sheetId, oneRowTable.records);
}
export function tableInPlaceOfEmptySelection(
  reads: WorkbookReads,
  sheetId: SheetId,
  suggestions: ConditionalFormatSuggestionsAnswer,
): [CellId, CellId] | null {
  if (tableColumnsInAbout(suggestions).some(isColumnFilled)) return null;
  let { about } = suggestions;
  if (areasOfRuleRanges(reads, sheetId, [about]).some((area) => reads.filledCellsIn(sheetId, area).length > 0)) return null;
  return suggestions.table.columns.some(isColumnFilled)
    ? cornerCellIdsOf(sheetId, suggestions.table.records)
    : mainTableCornersOnSheet(reads, sheetId);
}
export function tableInPlaceOfSelection(
  reads: WorkbookReads,
  sheetId: SheetId,
  suggestions: ConditionalFormatSuggestionsAnswer,
  hasOneCellSelected: boolean,
): [CellId, CellId] | null {
  let inPlaceOfEmpty = tableInPlaceOfEmptySelection(reads, sheetId, suggestions);
  if (!hasOneCellSelected || !isOneTextColumnTable(reads, sheetId, suggestions.table)) return inPlaceOfEmpty;
  let mainTable = mainTableCornersOnSheet(reads, sheetId);
  let mainSuggestions = mainTable === null ? null : reads.conditionalFormatSuggestions(...mainTable);
  return mainSuggestions !== null && looksLikeRecordsTable(reads, sheetId, mainSuggestions.table) ? mainTable : inPlaceOfEmpty;
}
export function stretchRangeToAreaEnd(
  reads: WorkbookReads,
  sheetId: SheetId,
  selectionArea: CellArea | null,
): (range: RangeCorners) => RangeCorners {
  let lastRowIndex = selectionArea === null ? null : selectionArea.topRowIndex + selectionArea.rowCount - 1;
  let lastRowId = lastRowIndex === null ? null : (reads.linesOf(sheetId)?.rows.idAt(lastRowIndex) ?? null);
  if (selectionArea === null || lastRowIndex === null || lastRowId === null) return (range) => range;
  return (range) => {
    let [topRowIndex, bottomRowIndex] = [range.topLeft.r, range.bottomRight.r].map(
      (rowId) => reads.rowIndexOf(sheetId, rowId),
    );
    return topRowIndex !== null &&
      topRowIndex !== undefined &&
      bottomRowIndex !== null &&
      bottomRowIndex !== undefined &&
      topRowIndex >= selectionArea.topRowIndex &&
      bottomRowIndex < lastRowIndex
      ? {
          ...range,
          bottomRight: {
            ...range.bottomRight,
            r: lastRowId,
          },
        }
      : range;
  };
}
export function stretchSuggestionsToSelection(
  reads: WorkbookReads,
  sheetId: SheetId,
  selectionArea: CellArea | null,
  suggestions: RulesForSelection,
): RulesForSelection {
  let stretchRange = stretchRangeToAreaEnd(reads, sheetId, selectionArea);
  let stretchRule = (rule: RuleInIds): RuleInIds => {
    let [firstRange, ...otherRanges] = rule.ranges;
    return isBlankCellsRule(rule)
      ? rule
      : {
          ...rule,
          ranges: [stretchRange(firstRange), ...otherRanges.map(stretchRange)],
        };
  };
  return {
    ...suggestions,
    suggestions: suggestions.suggestions.map((suggestion) => {
      if (dropdownColorRuleLists.has(suggestion.rules)) return suggestion;
      let [firstRule, ...otherRules] = suggestion.rules;
      let stretchedRules = [stretchRule(firstRule), ...otherRules.map(stretchRule)];
      originalOfStretchedRules.set(stretchedRules, suggestion.rules);
      return {
        ...suggestion,
        rules: stretchedRules,
      };
    }),
    ruleToStartFrom: stretchRule(suggestions.ruleToStartFrom),
  };
}
export function canRulesRunToSheetEnd(
  reads: WorkbookReads,
  sheetId: SheetId,
  lastRowId: RowId,
  rules: RuleInIds[],
  matches: (Matches | null)[] | null,
): boolean {
  let lastRowIndex = reads.rowIndexOf(sheetId, lastRowId);
  let rows = reads.linesOf(sheetId)?.rows;
  let sheetEndRowId = rows?.idAt(rows.count - 1) ?? null;
  if (rows === undefined || sheetEndRowId === null || matches === null) return false;
  if (
    !areasOfRuleRanges(
      reads,
      sheetId,
      rules.flatMap(({ ranges }) => ranges),
    ).every((area) => {
      let endRowIndex = area.topRowIndex + area.rowCount;
      let areaBelow = {
        ...area,
        topRowIndex: endRowIndex,
        rowCount: rows.count - endRowIndex,
      };
      return endRowIndex - 1 === lastRowIndex && reads.cellsOnShowIn(sheetId, areaBelow).length === 0;
    })
  )
    return false;
  let rulesToSheetEnd = withRuleRangesMapped(
    rules,
    (range) => ({
      ...range,
      bottomRight: {
        ...range.bottomRight,
        r: sheetEndRowId,
      },
    }),
  );
  return isSameRulesJson(matches, matchesOfRules(reads, sheetId, rulesToSheetEnd));
}
export function doesSelectionGoPastTable(
  reads: WorkbookReads,
  sheetId: SheetId,
  selected: CellArea | null,
  { about, table }: Pick<ConditionalFormatSuggestionsAnswer, 'about' | 'table'>,
): boolean {
  let [, bottomRightCell] = cornerCellIdsOf(sheetId, about);
  let topRowOfTableThere = reads.conditionalFormatSuggestions(bottomRightCell, bottomRightCell)?.table.records.topLeft.r;
  let [aboutArea] = areasOfRuleRanges(reads, sheetId, [about]);
  let rows = reads.linesOf(sheetId)?.rows;
  if (topRowOfTableThere !== table.records.topLeft.r || aboutArea === undefined || rows === undefined) return true;
  if (selected?.rowCount !== rows.count) return false;
  let belowAbout = aboutArea.topRowIndex + aboutArea.rowCount;
  let areaBelow = {
    ...aboutArea,
    topRowIndex: belowAbout,
    rowCount: rows.count - belowAbout,
  };
  return reads.cellsOnShowIn(sheetId, areaBelow).length > 0;
}
export function isAreaApartFromTable(area: CellArea | null, tableArea: CellArea | undefined): boolean {
  if (area === null || tableArea === undefined) return false;
  let rowGap = spanGapLength(area.topRowIndex, area.rowCount, tableArea.topRowIndex - 1, tableArea.rowCount + 1);
  let columnGap = spanGapLength(area.leftColumnIndex, area.columnCount, tableArea.leftColumnIndex, tableArea.columnCount);
  return rowGap > 0 || columnGap > 0;
}
export function rulesForSelection(
  reads: WorkbookReads,
  anchorCell: CellId,
  focusCell: CellId,
  mergedArea: CellArea | null,
  hasOneCellSelected: boolean,
): RulesForSelection | null {
  let { sheetId } = anchorCell;
  let suggestions = suggestionsForCells(reads, anchorCell, focusCell, mergedArea);
  if (suggestions === null) return null;
  let [aboutArea] = areasOfRuleRanges(reads, sheetId, [suggestions.about]);
  let suggestionsInTable: RulesForSelection =
    mergedArea !== null &&
    aboutArea !== undefined &&
    aboutArea.topRowIndex + aboutArea.rowCount < mergedArea.topRowIndex + mergedArea.rowCount &&
    doesSelectionGoPastTable(reads, sheetId, mergedArea, suggestions)
      ? {
          ...suggestions,
          isOverSeveralTables: true,
        }
      : stretchSuggestionsToSelection(reads, sheetId, mergedArea, suggestions);
  let tableInPlace = tableInPlaceOfSelection(reads, sheetId, suggestionsInTable, hasOneCellSelected);
  let suggestionsInPlace = tableInPlace === null ? null : suggestionsForCells(reads, ...tableInPlace);
  if (suggestionsInPlace === null)
    return hasOneCellSelected && looksLikeRecordsTable(reads, sheetId, suggestionsInTable.table)
      ? {
          ...suggestionsInTable,
          toAskAgentAbout: suggestionsInTable.table.records,
        }
      : suggestionsInTable;
  return {
    ...suggestionsInPlace,
    ruleToStartFrom: suggestionsInTable.ruleToStartFrom,
    isInPlaceOfWhatIsSelected: true,
    ...(isAreaApartFromTable(mergedArea, areasOfRuleRanges(reads, sheetId, [suggestionsInPlace.table.records])[0]) && {
      isFarFromWhatIsSelected: true,
    }),
  };
}
export const isColumnFilled = ({ filled }: Pick<ColumnOfRecords, 'filled'>): boolean => filled > 0;
export const MOST_TABLES_LOOKED_AT = 4;
export const MOST_ROWS_OF_ONE_COLUMN_TABLE = 3;
export const isCellInArea = (area: CellArea, rowIndex: number, columnIndex: number): boolean =>
  rowIndex >= area.topRowIndex &&
  rowIndex < area.topRowIndex + area.rowCount &&
  columnIndex >= area.leftColumnIndex &&
  columnIndex < area.leftColumnIndex + area.columnCount;
export const isOneCellSelectedOnly = (state: PageState, reads: WorkbookReads): boolean =>
  state.otherRanges.length === 0 && isSelectionOneCell(state, reads);
export const isBlankCellsRule = ({ effect }: Pick<RuleInIds, 'effect'>): boolean =>
  effect.kind === 'formatWhere' && effect.allOf.every(({ condition }) => condition.kind === 'isBlank');
/** The rules a list was stretched from, by the stretched list. */
export const originalOfStretchedRules = new WeakMap<RuleInIds[], RuleInIds[]>();
export const originalRulesOf = (rules: RuleInIds[]): RuleInIds[] => originalOfStretchedRules.get(rules) ?? rules;
export const withRuleRangesMapped = (rules: RuleInIds[], mapRange: (range: RangeCorners) => RangeCorners): RuleInIds[] => {
  if (rules.some(({ ranges }) => ranges.some((range) => mapRange(range) === range))) return rules;
  let withRangesMapped = ({ ranges: [firstRange, ...otherRanges], ...rule }: RuleInIds): RuleInIds => ({
    ...rule,
    ranges: [mapRange(firstRange), ...otherRanges.map(mapRange)],
  });
  let [firstRule, ...otherRules] = rules;
  return [withRangesMapped(firstRule), ...otherRules.map(withRangesMapped)];
};
export const matchesOfRules = (reads: WorkbookReads, sheetId: SheetId, rules: RuleInIds[]): (Matches | null)[] | null =>
  reads.formatsGivenAsIf(sheetId, asNewRules(rules))?.matches.slice(0, rules.length) ?? null;
export const spanGapLength = (start: number, length: number, otherStart: number, otherLength: number): number =>
  Math.max(0, otherStart - (start + length), start - (otherStart + otherLength));
