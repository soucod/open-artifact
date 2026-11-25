import type {
  ColumnId,
  ConditionalFormatSuggestion,
  ConditionalFormatSuggestionsAnswer,
  DropdownOption,
  Matches,
  RangeCorners,
  RuleInIds,
  SheetId,
} from '@open-artifact/sheets-core';
import { areasOfRuleRanges } from './descriptions.ts';
import { defaultRuleForRanges, suggestedRulesFor } from './rule-edits.ts';
import { isInSpan } from '../../grid/geometry.ts';
import { measureOfColumn } from '../../words/column-holds.ts';
import { matchTotalOfRules, sumMatches, isUsefulSuggestion } from './agent-rules.ts';
import {
  ruleOfConditionalFormat,
  isSameRulesJson,
  whatRuleLooksFor,
  conditionalFormatRuleById,
  tableOfRuleRange,
  withConditionalFormatsPane,
} from './pane-state.ts';
import { lightenedFillColor } from '../cell-colors.ts';
import { matchesOfRules, canRulesRunToSheetEnd, withRuleRangesMapped, originalOfStretchedRules } from './selection-target.ts';
import { mergedAreaOrCellOf } from '../../selection/model.ts';
import { tableAtCellIfAny } from '../../model/workbook.ts';
import { rangesOfAreas } from './editor-edits.ts';
import { conditionalRulesOfPane } from '../../state/queries.ts';
import { tableColumnSummary } from './editor-view.ts';
import type { PageState } from '../../state/initial-state.ts';
import type { CellId, SheetRead, WorkbookReads } from '../../model/workbook.ts';
import type { CellArea } from '../../selection/model.ts';
import type { IfQueued } from '../../state/event-reducer.ts';
import type { CellsPickedByPage, RulesForSelection } from './pane-state.ts';

/** What dropdown color suggestions of a sheet worked out: the matches of each rule list, and the lists stretched to the sheet's end. */
export interface DropdownSuggestionsCache {
  matches: Map<string, (Matches | null)[] | null>;
  runOn: Map<string, RuleInIds[]>;
}

/** The body of a table, as a range and as an area. */
export interface TableBody {
  range: RangeCorners;
  area: CellArea;
}

/** A rule that colors the cells holding a dropdown option. */
interface RuleOfOption {
  optionId: DropdownOption['optionId'];
  rule: RuleInIds;
}
export function columnIdsWithCells(reads: WorkbookReads, sheetId: SheetId): Set<ColumnId> | null {
  let columnIds = new Set<ColumnId>();
  let cellsSeen = 0;
  for (let cellsOfRow of reads.cellsHeldByRow(sheetId).values()) {
    cellsSeen += cellsOfRow.size;
    if (cellsSeen > MOST_HELD_CELLS_FOR_COLUMNS) return null;
    for (let columnId of cellsOfRow.keys()) columnIds.add(columnId);
  }
  return columnIds;
}
export function suggestionsForSelectedBlock(
  reads: WorkbookReads,
  anchorCell: CellId,
  focusCell: CellId,
  suggestions: ConditionalFormatSuggestionsAnswer,
): ConditionalFormatSuggestionsAnswer | null {
  let { sheetId } = anchorCell;
  if ((anchorCell.rowId === focusCell.rowId && anchorCell.columnId === focusCell.columnId) || !suggestions.isWidenedToColumn) return null;
  let [anchorAt, focusAt] = [reads.positionOfCell(anchorCell), reads.positionOfCell(focusCell)];
  if (anchorAt === null || focusAt === null) return null;
  let [topCell, bottomCell] = anchorAt.rowIndex > focusAt.rowIndex ? [focusCell, anchorCell] : [anchorCell, focusCell];
  let [leftCell, rightCell] = anchorAt.columnIndex > focusAt.columnIndex ? [focusCell, anchorCell] : [anchorCell, focusCell];
  let [recordsArea] = areasOfRuleRanges(reads, sheetId, [suggestions.table.records]);
  if (recordsArea === undefined || Math.min(anchorAt.rowIndex, focusAt.rowIndex) < recordsArea.topRowIndex) return null;
  let about: RangeCorners = {
    topLeft: {
      r: topCell.rowId,
      c: leftCell.columnId,
    },
    bottomRight: {
      r: bottomCell.rowId,
      c: rightCell.columnId,
    },
  };
  return {
    ...suggestions,
    about,
    isWidenedToColumn: false,
    suggestions: numberRuleSuggestions(reads, sheetId, {
      about,
      table: suggestions.table,
    }),
    ruleToStartFrom: defaultRuleForRanges([about]),
  };
}
export function sameKindNumberColumnsIn(
  reads: WorkbookReads,
  sheetId: SheetId,
  { about, table }: Pick<ConditionalFormatSuggestionsAnswer, 'about' | 'table'>,
): RangeCorners | null {
  let [aboutArea] = areasOfRuleRanges(reads, sheetId, [about]);
  let isWholeTableWide = table.columns[0].c === table.records.topLeft.c && table.columns.at(-1)?.c === table.records.bottomRight.c;
  if (aboutArea === undefined || !isWholeTableWide) return null;
  let numberColumns = table.columns.flatMap(({ c, kind }) => {
    let columnIndex = reads.columnIndexOf(sheetId, c) ?? -1;
    return isInSpan(columnIndex, aboutArea.leftColumnIndex, aboutArea.columnCount) &&
      measureOfColumn({
        kind,
      }) === 'numbers'
      ? [
          {
            c,
            kind,
            at: columnIndex,
          },
        ]
      : [];
  });
  let [firstColumn, lastColumn] = [numberColumns[0], numberColumns.at(-1)];
  if (firstColumn === undefined || lastColumn === undefined) return null;
  return lastColumn.at - firstColumn.at === numberColumns.length - 1 &&
    numberColumns.every(({ kind }) => kind === firstColumn.kind)
    ? {
        topLeft: {
          r: about.topLeft.r,
          c: firstColumn.c,
        },
        bottomRight: {
          r: about.bottomRight.r,
          c: lastColumn.c,
        },
      }
    : null;
}
export function numberRuleSuggestions(
  reads: WorkbookReads,
  sheetId: SheetId,
  suggestionsFor: Pick<ConditionalFormatSuggestionsAnswer, 'about' | 'table'>,
): ConditionalFormatSuggestion[] {
  let columnsRange = sameKindNumberColumnsIn(reads, sheetId, suggestionsFor);
  if (columnsRange === null) return [];
  let { scale, ofNegatives, ofTheLargest, ofAnyNumber } = suggestedRulesFor([columnsRange]);
  let withMatches = (rule: RuleInIds): ConditionalFormatSuggestion => ({
    rules: [rule],
    matches: matchTotalOfRules(reads, sheetId, [rule]),
  });
  let [anyNumberCount, negatives, largest] = [matchedCellsOf(withMatches(ofAnyNumber)), withMatches(ofNegatives), withMatches(ofTheLargest)];
  let hasLargestApart = matchedCellsOf(largest) > 0 && matchedCellsOf(largest) < anyNumberCount;
  return [
    ...(hasLargestApart && anyNumberCount >= LEAST_CELLS_FOR_COLOR_SCALE
      ? [
          {
            rules: [scale],
            matches: null,
          },
        ]
      : []),
    ...(matchedCellsOf(negatives) > 0 && matchedCellsOf(negatives) < anyNumberCount ? [negatives] : []),
    ...(hasLargestApart && matchedCellsOf(largest) === 1 ? [largest] : []),
  ];
}
export function firstDropdownCellIn(reads: WorkbookReads, sheetId: SheetId, range: RangeCorners): CellId | null {
  let [area] = areasOfRuleRanges(reads, sheetId, [range]);
  if (area === undefined) return null;
  for (let rowOffset = 0; rowOffset < Math.min(area.rowCount, MOST_ROWS_LOOKED_AT_FOR_DROPDOWN); rowOffset += 1) {
    let cellId = reads.cellIdAt(sheetId, area.topRowIndex + rowOffset, area.leftColumnIndex);
    if (cellId !== null && reads.dropdownOf(cellId) !== null) return cellId;
  }
  return null;
}
export function dropdownSuggestionsCacheOf(reads: WorkbookReads, sheetId: SheetId): DropdownSuggestionsCache | null {
  let sheetNow = reads.sheetAsItStands(sheetId);
  if (sheetNow === null) return null;
  let cache = dropdownSuggestionsCache.get(sheetNow) ?? {
    matches: new Map(),
    runOn: new Map(),
  };
  dropdownSuggestionsCache.set(sheetNow, cache);
  return cache;
}
export function tableBodyOfCell(reads: WorkbookReads, cell: CellId): TableBody | null {
  let table = tableAtCellIfAny(reads, cell)?.table;
  if (table === undefined) return null;
  let bodyRange: RangeCorners = {
    topLeft: {
      r: table.firstRowOfBody,
      c: table.firstColumn,
    },
    bottomRight: {
      r: table.lastRowOfBody,
      c: table.lastColumn,
    },
  };
  let [bodyArea] = areasOfRuleRanges(reads, cell.sheetId, [bodyRange]);
  return bodyArea === undefined
    ? null
    : {
        range: bodyRange,
        area: bodyArea,
      };
}
export function tableBodyRowsWithin(reads: WorkbookReads, sheetId: SheetId, { range, area }: TableBody, within: RangeCorners): RangeCorners | null {
  let [withinArea] = areasOfRuleRanges(reads, sheetId, [within]);
  let rows = reads.linesOf(sheetId)?.rows;
  if (withinArea === undefined || rows === undefined) return null;
  let topRowIndex = Math.max(area.topRowIndex, withinArea.topRowIndex);
  let endRowIndex = Math.min(area.topRowIndex + area.rowCount, withinArea.topRowIndex + withinArea.rowCount);
  let [topRowId, bottomRowId] = [rows.idAt(topRowIndex), rows.idAt(endRowIndex - 1)];
  return topRowIndex >= endRowIndex || topRowId === null || bottomRowId === null
    ? null
    : {
        topLeft: {
          ...range.topLeft,
          r: topRowId,
        },
        bottomRight: {
          ...range.bottomRight,
          r: bottomRowId,
        },
      };
}
export function dropdownColorSuggestions(
  reads: WorkbookReads,
  sheetId: SheetId,
  about: RangeCorners,
  dropdownCell: CellId | null,
): ConditionalFormatSuggestion[] {
  let c = about.topLeft.c;
  if (c !== about.bottomRight.c) return [];
  let cellWithDropdown = dropdownCell ?? firstDropdownCellIn(reads, sheetId, about);
  let dropdown = cellWithDropdown === null ? null : reads.dropdownOf(cellWithDropdown);
  let tableBody = cellWithDropdown === null || dropdown === null ? null : tableBodyOfCell(reads, cellWithDropdown);
  if (cellWithDropdown === null || dropdown === null || tableBody === null) return [];
  let ruleRange = dropdownCell === null ? tableBodyRowsWithin(reads, sheetId, tableBody, about) : tableBody.range;
  let [ruleArea] = ruleRange === null ? [] : areasOfRuleRanges(reads, sheetId, [ruleRange]);
  let rows = reads.linesOf(sheetId)?.rows;
  let lastRowId = rows?.idAt(rows.count - 1) ?? null;
  let cache = dropdownSuggestionsCacheOf(reads, sheetId);
  if (ruleRange === null || ruleArea === undefined || lastRowId === null || cache === null) return [];
  let existingRules = reads.conditionalFormatsOf(sheetId).flatMap((format) => ruleOfConditionalFormat(format) ?? []);
  let optionRules = dropdown.options.flatMap(({ optionId, label, color }): RuleOfOption[] => {
    let fillColor = lightenedFillColor(color);
    if (fillColor === null) return [];
    return [
      {
        optionId,
        rule: {
          ranges: [ruleRange],
          effect: {
            kind: 'formatWhere',
            allOf: [
              {
                tested: {
                  kind: 'sameRowInColumn',
                  c,
                },
                condition: {
                  kind: 'textIs',
                  text: label,
                },
              },
            ],
            format: {
              fillColor,
            },
          },
        },
      },
    ];
  });
  let newOptionRules = optionRules.filter(
    ({ rule }) =>
      !existingRules.some(
        (existing) =>
          isSameRulesJson(whatRuleLooksFor(existing), whatRuleLooksFor(rule)) &&
          areasOfRuleRanges(reads, sheetId, existing.ranges).some((area) => areaContainsArea(area, ruleArea)),
      ),
  );
  let asSuggestion = (rules: RuleInIds[]): ConditionalFormatSuggestion[] => {
    let cacheKey = JSON.stringify(rules);
    let matches = cache.matches.get(cacheKey) ?? matchesOfRules(reads, sheetId, rules);
    if (matches !== null) cache.matches.set(cacheKey, matches);
    let matchTotal = sumMatches(matches ?? []);
    if (!isUsefulSuggestion(reads, sheetId, rules, matchTotal)) return [];
    let runsToSheetEnd =
      cache.runOn.has(cacheKey) ||
      (isSameRulesJson(ruleRange, tableBody.range) && canRulesRunToSheetEnd(reads, sheetId, ruleRange.bottomRight.r, rules, matches));
    let rulesShown = !runsToSheetEnd
      ? rules
      : (cache.runOn.get(cacheKey) ??
        withRuleRangesMapped(
          rules,
          (range) => ({
            ...range,
            bottomRight: {
              ...range.bottomRight,
              r: lastRowId,
            },
          }),
        ));
    if (runsToSheetEnd) cache.runOn.set(cacheKey, rulesShown);
    if (runsToSheetEnd) originalOfStretchedRules.set(rulesShown, rules);
    dropdownColorRuleLists.add(rulesShown);
    return [
      {
        rules: rulesShown,
        matches: matchTotal,
      },
    ];
  };
  let cellOption = dropdownCell === null ? undefined : reads.cellOf(dropdownCell)?.dropdownOption;
  let ruleOfCellOption = newOptionRules.find(({ optionId }) => optionId === cellOption?.optionId);
  let [firstRule, ...otherRules] = newOptionRules.map(({ rule }) => rule);
  return [
    ...(ruleOfCellOption === undefined ? [] : asSuggestion([ruleOfCellOption.rule])),
    ...(firstRule === undefined || otherRules.length === 0 || optionRules.length > MOST_DROPDOWN_OPTIONS_FOR_COLORS
      ? []
      : asSuggestion([firstRule, ...otherRules])),
  ];
}
export function withCellsToAskAgentAbout(
  reads: WorkbookReads,
  sheetId: SheetId,
  suggestions: ConditionalFormatSuggestionsAnswer,
): RulesForSelection {
  let { about, table } = suggestions;
  let [aboutArea] = areasOfRuleRanges(reads, sheetId, [about]);
  let [recordsArea] = areasOfRuleRanges(reads, sheetId, [table.records]);
  let columns = reads.linesOf(sheetId)?.columns;
  if (aboutArea === undefined || recordsArea === undefined || columns === undefined) return suggestions;
  let leftIndex = Math.max(aboutArea.leftColumnIndex, recordsArea.leftColumnIndex);
  let endIndex = Math.min(aboutArea.leftColumnIndex + aboutArea.columnCount, recordsArea.leftColumnIndex + recordsArea.columnCount);
  let [leftColumnId, rightColumnId] = [columns.idAt(leftIndex), columns.idAt(endIndex - 1)];
  return endIndex - leftIndex < 2 || endIndex - leftIndex === aboutArea.columnCount || leftColumnId === null || rightColumnId === null
    ? suggestions
    : {
        ...suggestions,
        toAskAgentAbout: {
          topLeft: {
            r: about.topLeft.r,
            c: leftColumnId,
          },
          bottomRight: {
            r: about.bottomRight.r,
            c: rightColumnId,
          },
        },
      };
}
export function suggestionsForCells(
  reads: WorkbookReads,
  anchorCell: CellId,
  focusCell: CellId,
  mergedArea: CellArea | null = null,
): RulesForSelection | null {
  let { sheetId } = anchorCell;
  let suggestions = reads.conditionalFormatSuggestions(anchorCell, focusCell);
  let blockSuggestions = suggestions === null ? null : suggestionsForSelectedBlock(reads, anchorCell, focusCell, suggestions);
  if (blockSuggestions !== null) return withCellsToAskAgentAbout(reads, sheetId, blockSuggestions);
  let anchorColumnIndex = reads.columnIndexOf(sheetId, anchorCell.columnId);
  let focusColumnIndex = reads.columnIndexOf(sheetId, focusCell.columnId);
  let columnsWithCells =
    anchorColumnIndex === null || focusColumnIndex === null || anchorColumnIndex === focusColumnIndex ? null : columnIdsWithCells(reads, sheetId);
  if (anchorColumnIndex === null || focusColumnIndex === null || columnsWithCells === null) {
    const isMergedColumn =
      isSameRulesJson(anchorCell, focusCell) &&
      mergedArea !== null &&
      mergedArea.rowCount > 1 &&
      !isSameRulesJson(mergedArea, mergedAreaOrCellOf(reads, anchorCell));
    let dropdownCell = isSameRulesJson(anchorCell, focusCell) && !isMergedColumn ? anchorCell : null;
    let [mergedColumnRange] =
      !isMergedColumn || anchorColumnIndex === null
        ? []
        : (rangesOfAreas(reads, sheetId, [
            {
              ...mergedArea,
              leftColumnIndex: anchorColumnIndex,
              columnCount: 1,
            },
          ]) ?? []);
    let dropdownColorSuggestionsFound =
      suggestions === null ? [] : dropdownColorSuggestions(reads, sheetId, mergedColumnRange ?? suggestions.about, dropdownCell);
    return suggestions === null || dropdownColorSuggestionsFound.length === 0
      ? suggestions
      : {
          ...suggestions,
          suggestions: [...dropdownColorSuggestionsFound, ...suggestions.suggestions],
        };
  }
  let columns = reads.linesOf(sheetId)?.columns;
  let columnSuggestions = Array.from(
    {
      length: Math.abs(anchorColumnIndex - focusColumnIndex) + 1,
    },
    (unfilledSpot, offset) => columns?.idAt(Math.min(anchorColumnIndex, focusColumnIndex) + offset) ?? null,
  )
    .flatMap((columnId) => (columnId !== null && columnsWithCells.has(columnId) ? [columnId] : []))
    .slice(0, MOST_COLUMNS_FOR_SUGGESTIONS)
    .flatMap(
      (columnId) =>
        reads.conditionalFormatSuggestions(
          {
            ...anchorCell,
            columnId,
          },
          {
            ...focusCell,
            columnId,
          },
        ) ?? [],
    );
  let suggestionLists = columnSuggestions.map(({ suggestions: ofColumn }) => ofColumn);
  let longestList = Math.max(0, ...suggestionLists.map((list) => list.length));
  let interleaved = Array.from(
    {
      length: longestList,
    },
    (unfilledSpot, rank) => suggestionLists.flatMap((list) => list[rank] ?? []),
  ).flat();
  let dropdownSuggestions = columnSuggestions.flatMap(
    ({ about }) => dropdownColorSuggestions(reads, sheetId, about, null),
  );
  return suggestions === null
    ? null
    : {
        ...suggestions,
        suggestions: [...dropdownSuggestions, ...interleaved],
      };
}
export function openRuleEditor(
  state: PageState,
  reads: WorkbookReads,
  conditionalFormatId: string,
  cellsPickedByPage: CellsPickedByPage,
): PageState {
  let pane = conditionalRulesOfPane(state);
  let rule = pane === null ? null : conditionalFormatRuleById(reads, pane.sheetId, conditionalFormatId);
  if (pane === null || rule === null) return state;
  let table = tableOfRuleRange(reads, pane.sheetId, rule);
  return withConditionalFormatsPane(state, {
    ...pane,
    drawnAs: 'pane',
    editor: {
      ...{
        conditionalFormatId,
        table,
        cellsPickedByPage,
        typed: null,
      },
      testBeingAdded: null,
    },
    offer: null,
    pointedAt: null,
    inWords: null,
  });
}
export function openEditorOfTopRule(
  state: PageState,
  reads: WorkbookReads,
  { cellsPickedByPage }: NonNullable<IfQueued['thenEditorOfTopRule']>,
): PageState {
  let [topFormat] = reads.conditionalFormatsOf(conditionalRulesOfPane(state)?.sheetId ?? state.sheetId);
  return topFormat === undefined ? state : openRuleEditor(state, reads, topFormat.conditionalFormatId, cellsPickedByPage);
}
export const MOST_COLUMNS_FOR_SUGGESTIONS = 6;
export const MOST_HELD_CELLS_FOR_COLUMNS = 20000;
export const PAGE_SUGGESTIONS_FOR_BLOCK = 4;
export const PAGE_SUGGESTIONS_BESIDE_AGENT = 2;
export const LEAST_CELLS_FOR_COLOR_SCALE = 3;
export const matchedCellsOf = ({ matches }: Pick<ConditionalFormatSuggestion, 'matches'>): number => matches?.cells ?? 0;
export const MOST_ROWS_LOOKED_AT_FOR_DROPDOWN = 10;
export const dropdownSuggestionsCache = new WeakMap<SheetRead, DropdownSuggestionsCache>();
export const areaContainsArea = (area: CellArea, inner: CellArea): boolean =>
  area.topRowIndex <= inner.topRowIndex &&
  area.topRowIndex + area.rowCount >= inner.topRowIndex + inner.rowCount &&
  area.leftColumnIndex <= inner.leftColumnIndex &&
  area.leftColumnIndex + area.columnCount >= inner.leftColumnIndex + inner.columnCount;
export const MOST_DROPDOWN_OPTIONS_FOR_COLORS = 8;
export const dropdownColorRuleLists = new WeakSet<RuleInIds[]>();
export const columnNameOfAbout = ({ about, table }: Pick<ConditionalFormatSuggestionsAnswer, 'about' | 'table'>): string | null =>
  about.topLeft.c === about.bottomRight.c && about.topLeft.r === table.records.topLeft.r && about.bottomRight.r === table.records.bottomRight.r
    ? tableColumnSummary(table, about.topLeft.c).name
    : null;
