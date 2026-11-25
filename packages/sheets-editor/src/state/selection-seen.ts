import type { CellControl, SharedCellFormat, SheetId } from '@open-artifact/sheets-core';
import type { WholeCellFormat } from '../model/cell-format.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { CellArea, CellPosition, SelectionKind } from '../selection/model.ts';
import type { CheckboxesToSet, PageState } from './initial-state.ts';
import type { PageEvent } from './event-reducer.ts';
import { areasOfAllRanges, hasOtherRanges, coveredCellCount } from '../selection/several-ranges.ts';
import { selectionKindOf, isSameCell, activeAnchorCell, selectedArea, isSameSelection } from '../selection/model.ts';
import { layoutOfView } from '../grid/layout.ts';
import { cellsSeenIn } from '../selection/cells-seen.ts';
import { isAreaToChartUnchanged, areaToChart } from '../selection/table-select.ts';
import { choicesForCells, hasCellsNotSpilledIn, formatChoiceOf } from '../format/number-format-choices.ts';
import { selectionOfShownPieces } from '../tables/filtered-rows.ts';
import { sharedFormatOfAllRanges, formatOfSelectionWithEntries } from '../selection/shared-format.ts';
import { shownHorizontalAlignment } from '../format/toolbar-choices.ts';
import { cellValueOf } from '../model/cell-values.ts';
import { NO_AREA_BORDERS, readAreaBorders } from '../grid/borders.ts';
import { NO_NUMBERS_DECIMAL_CHANGES, decimalPlaceChanges } from '../format/decimal-places.ts';
import { hasConvertibleTexts } from '../format/texts-to-numbers.ts';
import { checkboxesOfSelection, NO_CHECKBOXES_TO_TOGGLE } from '../chips/checkbox-presses.ts';
import { chartKindsOfferedForCells } from '../charts/chart-offers.ts';
import { fontMarksOfFormat } from '../editor/text-looks.ts';
import type { ReadsWithTextMeasurer } from './controller.ts';
export function selectionSeenOf(state: PageState, workbook: ReadsWithTextMeasurer, area: CellArea | null): SelectionSeen {
  let areas = areasOfAllRanges(state, workbook);
  let kind: SelectionKind = area === null ? 'cells' : selectionKindOf(area, layoutOfView(state, workbook));
  let mergedAreas = area === null || hasOtherRanges(state) ? [] : workbook.mergedAreasIn(state.sheetId, area);
  let cellShape: SelectionShape = coveredCellCount(areas) > 1 ? 'cells' : 'cell';
  let mergedShape: SelectionShape =
    mergedAreas.reduce((sum: number, mergedArea: CellArea) => sum + mergedArea.rowCount * mergedArea.columnCount, 0) ===
    coveredCellCount(areas)
      ? 'mergedOnly'
      : 'merged';
  let shapeOfCells = mergedAreas.length > 0 ? mergedShape : cellShape;
  return {
    ...cellsSeenIn(workbook, state.sheetId, areas),
    shape: kind === 'cells' ? shapeOfCells : kind,
  };
}
export function settleSelectionSeen(before: PageState | null, state: PageState, workbook: ReadsWithTextMeasurer): PageState {
  if (
    before !== null &&
    state.workbookChangeCount === before.workbookChangeCount &&
    state.formulasWorkedOutCount === before.formulasWorkedOutCount &&
    (state.mode.kind === 'editing') === (before.mode.kind === 'editing') &&
    state.entriesUnanswered === before.entriesUnanswered &&
    isSameCell(state.activeCell, before.activeCell) &&
    isSameCell(state.selectionCorner, before.selectionCorner) &&
    state.rangeWalked === before.rangeWalked &&
    state.otherRanges === before.otherRanges &&
    state.rowsOutOfViewByOwnFilters === before.rowsOutOfViewByOwnFilters &&
    state.tablesRead === before.tablesRead &&
    (state.contextBarMenu === 'chart') === (before.contextBarMenu === 'chart') &&
    isAreaToChartUnchanged(before, state, workbook)
  )
    return state;
  let activeCell = activeAnchorCell(state, workbook);
  let area = selectedArea(state, workbook);
  let formatsThatFit = area === null ? [] : choicesForCells(workbook, state.sheetId, area);
  let formatsThatFitHere = hasOtherRanges(state) ? formatsThatFit.filter((kind: FormatOfSelection['formatsThatFit'][number]) => kind !== 'dropdown') : formatsThatFit;
  let shownSelection = selectionOfShownPieces(state, workbook, 'theFirstParts');
  let sharedFormat = sharedFormatOfAllRanges(shownSelection, workbook) ?? workbook.formatOf(activeCell);
  let sharedWithEntries = formatOfSelectionWithEntries(shownSelection, workbook, sharedFormat);
  let selectionSeen = selectionSeenOf(state, workbook, area);
  let formatOfSelection = makeFormatOfSelection(
    sharedWithEntries,
    workbook,
    formatsThatFitHere,
    formatsThatFit.includes('dropdown') || (area !== null && hasCellsNotSpilledIn(workbook, state.sheetId, area)),
    shownHorizontalAlignment(workbook.formatOf(activeCell), cellValueOf(workbook.cellOnShowIn(activeCell))),
    area === null
      ? {
          lines: NO_AREA_BORDERS,
          isFromSample: false,
        }
      : bordersOfSelectedBlock(workbook, state.sheetId, area),
    area === null
      ? NO_NUMBERS_DECIMAL_CHANGES
      : decimalPlaceChanges(workbook, {
          sheetId: state.sheetId,
          ranges: areasOfAllRanges(shownSelection, workbook),
          activeCell,
          shared: sharedFormat,
        }),
    hasConvertibleTexts(state, workbook),
    selectionSeen.cellsAre === 'checkbox' && selectionSeen.areAllRead ? checkboxesOfSelection(state, workbook) : NO_CHECKBOXES_TO_TOGGLE,
  );
  let isFormatSame = JSON.stringify(formatOfSelection) === JSON.stringify(state.formatOfSelection);
  let isSelectionSeenSame =
    selectionSeen.cellsAre === state.selectionSeen.cellsAre &&
    selectionSeen.isSoOfEveryCell === state.selectionSeen.isSoOfEveryCell &&
    selectionSeen.areAllRead === state.selectionSeen.areAllRead &&
    selectionSeen.shape === state.selectionSeen.shape;
  let chartArea = hasOtherRanges(state) ? null : areaToChart(state, workbook, selectionSeen.shape === 'cell');
  let chartsOnOffer = chartArea === null ? [] : chartKindsOfferedForCells(workbook, state.sheetId, chartArea);
  let areChartsSame = JSON.stringify(chartsOnOffer) === JSON.stringify(state.chartsOnOffer);
  if (isFormatSame && isSelectionSeenSame && areChartsSame) return state;
  return {
    ...state,
    formatOfSelection: isFormatSame ? state.formatOfSelection : formatOfSelection,
    selectionSeen: isSelectionSeenSame ? state.selectionSeen : selectionSeen,
    chartsOnOffer: areChartsSame ? state.chartsOnOffer : chartsOnOffer,
  };
}
export function noteSelectionLeftByPerson(before: PageState, state: PageState, event: PageEvent): PageState {
  return (
    'readsBefore' in event
      ? event.kind === 'workbookChanged' && !event.isUnasked && state.selectionSeen !== before.selectionSeen
      : !state.isFollowingAgent &&
        state.followed === null &&
        (state.shownByAgent?.place ?? null) === null &&
        !(isSameSelection(before, state) && state.otherRanges === before.otherRanges)
  )
    ? {
        ...state,
        selectionLeftByPerson: {
          ...state.selectionSeen,
        },
      }
    : state;
}
export const makeFormatOfSelection = (
  shared: SharedCellFormat,
  workbook: WorkbookReads,
  formatsThatFit: FormatOfSelection['formatsThatFit'],
  takesDropdownFromInsert: boolean,
  alignmentAsDrawn: FormatOfSelection['alignmentOfActiveCellAsDrawn'],
  borders: BordersOfBlock,
  decimalPlaces: FormatOfSelection['decimalPlaces'] = NO_NUMBERS_DECIMAL_CHANGES,
  holdsTextToConvert: boolean = false,
  checkboxesToSet: CheckboxesToSet = NO_CHECKBOXES_TO_TOGGLE,
): FormatOfSelection => ({
  shared,
  togglesOn: fontMarksOfFormat(shared),
  numberFormat: formatChoiceOf(shared, workbook),
  decimalPlaces,
  formatsThatFit,
  takesDropdownFromInsert,
  holdsTextToConvert,
  alignmentOfActiveCellAsDrawn: alignmentAsDrawn,
  bordersOfBlock: borders.lines,
  areBordersOfBlockFromSample: borders.isFromSample,
  checkboxesToSet,
});
export const bordersOfSelectedBlock = (workbook: WorkbookReads, sheetId: SheetId, area: CellArea): BordersOfBlock => {
  let formatsByPlace = new Map<string, WholeCellFormat | null>();
  return readAreaBorders({
    area,
    mergedAreas: workbook.mergedAreasIn(sheetId, area),
    bordersMayChangeBefore: workbook.bordersMayChangeBefore(sheetId, area),
    formatAt: ({ rowIndex, columnIndex }: CellPosition) => {
      let key = `${rowIndex} ${columnIndex}`;
      let cached = formatsByPlace.get(key);
      if (cached !== undefined) return cached;
      let cellId: CellId | null = workbook.cellIdAt(sheetId, rowIndex, columnIndex);
      let format = cellId === null ? null : workbook.formatOf(cellId);
      formatsByPlace.set(key, format);
      return format;
    },
  });
};
export type SeenKindOfCells =
  | Exclude<CellControl['kind'], 'none'>
  | 'person'
  | 'date'
  | 'number'
  | 'text'
  | 'trueOrFalse'
  | 'neverWraps'
  | 'empty'
  | 'mixed';
export type SelectionShape = 'cell' | 'cells' | 'merged' | 'mergedOnly' | 'columns' | 'rows';
export interface SelectionSeen {
  cellsAre: SeenKindOfCells;
  isSoOfEveryCell: boolean;
  areAllRead: boolean;
  shape: SelectionShape;
}
/** The borders of the block selected, and whether they were read from a sample of its cells. */
export type BordersOfBlock = ReturnType<typeof readAreaBorders>;
/** The format the selection shares, as the toolbar and the menus show it. */
export interface FormatOfSelection {
  shared: SharedCellFormat;
  togglesOn: ReturnType<typeof fontMarksOfFormat>;
  numberFormat: ReturnType<typeof formatChoiceOf>;
  decimalPlaces: ReturnType<typeof decimalPlaceChanges>;
  formatsThatFit: ReturnType<typeof choicesForCells>;
  takesDropdownFromInsert: boolean;
  holdsTextToConvert: boolean;
  alignmentOfActiveCellAsDrawn: ReturnType<typeof shownHorizontalAlignment>;
  bordersOfBlock: BordersOfBlock['lines'];
  areBordersOfBlockFromSample: boolean;
  checkboxesToSet: CheckboxesToSet;
}
