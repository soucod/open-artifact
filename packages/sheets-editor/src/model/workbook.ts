import type {
  CellAt,
  CellContents,
  CellReadByAnInput,
  CellsOfDropdownAnswer,
  CellsThatADropdownWouldClearAnswer,
  CellsToCopyAnswer,
  CellTable,
  CellTableContents,
  CellTableRead,
  ColumnId,
  ColumnReading,
  ConditionalFormatAsIf,
  ConditionalFormatContents,
  ConditionalFormatSuggestionsAnswer,
  DecimalSignName,
  DropdownContents,
  DropdownToPointAt,
  EngineWorkbookContents,
  FilteredRowsAnswer,
  Filter,
  FitOfAColumnReading,
  FormatsGivenAnswer,
  GroupContents,
  GroupSignName,
  IdRun,
  InputOfAWidget,
  InputsOfViewAnswer,
  NamedViewContents,
  ListLine,
  ListLineAsKept,
  NumberFormatKind,
  OffsetOfAPlacement,
  PivotKeeps,
  PivotTableAtAnswer,
  PivotTableSource,
  PivotWrittenValue,
  PlacementContents,
  ReadRowsInSortedOrderRequest,
  Refused,
  RowHeightContents,
  RowId,
  RowsInSortedOrderAnswer,
  RuleByAddress,
  RuleInIds,
  RulesRead,
  CauseCell,
  CauseOfError,
  CellFormatContents,
  SharedCellFormat,
  SharedCodeDescription,
  SheetId,
  SheetLayoutContents,
  ShownValue,
  SizesOfGroupsName,
  SpilledCell,
  TableIntoSheet,
  TableInIds,
  TablesOfSheetAnswer,
  TableWithColumns,
  TextsUnderAColumnReadingAnswer,
  ValueIn,
  ValuesOfFilteredColumnAnswer,
  View,
  ViewContents,
  WhatATableChangesAnswer,
} from '@open-artifact/sheets-core';
import type { CellArea, CellPosition } from '../selection/model.ts';
import type { CellFormatLookup, FormatAtIndexes, IndexRunsOfEntry, KindedNumberFormat, KindOfPattern, NumberFormatAtIndexes, WholeCellFormat } from './cell-format.ts';
import type { LineIndex, LineSpan, OwnRowOrder } from './line-ids.ts';
import type { LineSizes } from './line-sizes.ts';
import {
  DEFAULT_CELL_FORMAT,
  createCellFormatLookup,
  anyEntryHasBorderLine,
  borderEntryRuns,
  wrapEntryRuns,
  numberFormatEntryRuns,
  formatEntryRuns,
  customHexColorsOfSheet,
  sharedFormatOfArea,
  rowLookKey,
  borderEdgesNear,
  numberFormatPatternsWithin,
  clipsWithin,
} from './cell-format.ts';
import { usersOfCell, listLinesOfCell, cellValueOf } from './cell-values.ts';
import { reuseLineIndex, createCachedLineIndex, createLineIndex, coveringRowSpanIn } from './line-ids.ts';
import { createLineSizes } from './line-sizes.ts';
import { spanOfIndexes } from './a1-references.ts';
import { tableReadIn, cellTableIn, rowEndsAsSeen } from '../tables/own-row-order.ts';
import type { RowEnds } from '../tables/own-row-order.ts';
import type { PackedRowCells } from '../engine/packed-cells.ts';

/** A cell by its sheet, row and column ids. */
export interface CellId {
  sheetId: SheetId;
  rowId: RowId;
  columnId: ColumnId;
}
/** What a cell holds, or what spills into it. */
export type CellOnShow = CellContents | SpilledCell;
export type CellsByRow = Map<RowId, ReadonlyMap<ColumnId, CellContents>>;
/** A sheet's rows of cells as the engine packs them, by row. */
export type RowsOfCells = Map<RowId, PackedRowCells>;
export type SpilledCellsByRow = Map<RowId, ReadonlyMap<ColumnId, SpilledCell>>;
/** A row as it stands: the cells it holds, those spilled into it, or a mark that it has both. */
export type RowAsItStands = ReadonlyMap<ColumnId, CellContents> | ReadonlyMap<ColumnId, SpilledCell> | Record<never, never>;
/** A sheet's cells, kept by row. */
export interface SheetCells {
  cellsByRow: RowsOfCells;
  spilledCellsByRow: SpilledCellsByRow;
  cellsWithSpillByRow: CellsByRow;
  cellsWithListsByRow: CellsByRow;
  rowsAsTheyStand: Map<RowId, RowAsItStands>;
  cellCountByUserId: Map<string, number>;
  columnIndexesOnShowByRow: Map<RowId, number[]>;
}
/** A row of an input as a view reads it. */
export type InputRow = CellReadByAnInput[];
/** The inputs of a view's elements, by element and then by name; or why they could not be read. */
export type ViewInputs = Refused | { byElement: Map<string, Record<string, InputRow[]>> };
export interface ViewWithInputs {
  view: View;
  inputs: ViewInputs;
  canBeReset?: true;
  hasDefaultsToSave?: true;
}
export interface InputsOfViewRead {
  viewId: string;
  answer: InputsOfViewAnswer | Refused;
}
export interface RowSizing extends LineSpan {
  heightInPixels: number | null;
  largestFontSizeInPoints: number;
}
interface EdgeOfARowHeight {
  at: number;
  isStart: boolean;
  heightInPixels: number;
}
interface EdgeOfAFontSize {
  at: number;
  isStart: boolean;
  fontSizeInPoints: number;
}
type EdgeOfRowSizing = EdgeOfARowHeight | EdgeOfAFontSize;
/** A group of rows or columns by the indexes it covers. */
export interface GroupOnGrid extends LineSpan {
  groupId: string;
  depth: number;
  isCollapsed: boolean;
}
/** A view placed on a sheet, at the indexes of its anchor cell. */
export interface PlacementOnGrid {
  placementId: string;
  viewId: string;
  rowIndex: number;
  columnIndex: number;
  offsetFromAnchorCell: OffsetOfAPlacement;
  widthInPixels: number;
  heightInPixels: number;
}
/** The rows of a sheet seen in an order of the page's own, as a layout tells them. */
export interface OwnRowOrderToRead extends LineSpan {
  asStored: Partial<SheetLayoutContents> & Pick<SheetLayoutContents, 'rows'>;
}
/** A sheet's layout to read, with the order its rows are seen in when that is the page's own. */
export interface SheetLayoutToRead extends SheetLayoutContents {
  ownRowOrder?: OwnRowOrderToRead | 'givenUp';
}
export interface SheetToRead extends SheetLayoutToRead {
  cells: RowsOfCells;
}
export interface WorkbookToRead extends Omit<EngineWorkbookContents, 'kind' | 'sheets'> {
  sheets: SheetToRead[];
}
export interface WorkbookDescription extends Pick<SharedCodeDescription, 'defaultColumnWidthInPixels' | 'limits'> {
  localeOfANewWorkbook: string;
}
export type FormatsGiven = Omit<FormatsGivenAnswer, 'kind'>;
export interface FormatsGivenOfSheet {
  sheetId: SheetId;
  formatsGiven: FormatsGiven;
}
/** What the grid shows of a sheet as a whole. */
export interface SheetSummary {
  sheetId: SheetId;
  name: string;
  rowCount: number;
  columnCount: number;
  columnEdges: LineSizes;
  frozenRowCount: number;
  frozenColumnCount: number;
  areGridlinesHidden: boolean;
  /** The interactive view the sheet shows in place of its grid. */
  interactive: string | null;
  rowGroups: GroupOnGrid[];
  columnGroups: GroupOnGrid[];
  ownRowOrder: OwnRowOrder | null;
  isOwnRowOrderGivenUp: boolean;
}
/** A sheet's layout as read: its lines, formats and what lies on it; the costlier parts worked out when asked. */
export interface SheetLayoutRead {
  summary: SheetSummary;
  rows: LineIndex;
  columns: LineIndex;
  isLaidOutAsNew: boolean;
  cellFormats: CellFormatLookup;
  rowSizing(): RowSizing[];
  hasBorderLine(): boolean;
  entriesWithBorders(): IndexRunsOfEntry[];
  entriesThatWrapText(): IndexRunsOfEntry[];
  numberFormats(): NumberFormatAtIndexes[];
  formats(): FormatAtIndexes[];
  hexColors(): string[];
  dropdownsById: Map<string, DropdownContents>;
  conditionalFormats: ConditionalFormatContents[];
  placements: PlacementOnGrid[];
  cellTables: CellTableContents[];
  namedViews: NamedViewContents[];
  /** The layout with its rows in the order they are stored in; `null` where they are seen in that order. */
  asStored(): SheetLayoutRead | null;
  mergedAreas: CellArea[];
}
export interface SheetRead extends SheetLayoutRead, SheetCells {
  formatsGiven: FormatsGiven;
}
export interface SignsOfNumbers {
  decimalSign: DecimalSignName;
  groupSign: GroupSignName;
  sizesOfGroups: SizesOfGroupsName;
}
export interface LimitsOfConditionalFormats {
  mostRangesInAConditionalFormat: number;
  mostTestsInAConditionalFormat: number;
  longestTextOfAConditionInCharacters: number;
  largestCountInACondition: number;
}
export interface LimitsOfPlacements {
  smallestSideOfAPlacementInPixels: number;
  largestSideOfAPlacementInPixels: number;
}
export interface LimitsOfNamedViews {
  mostNamedViewsInASheet: number;
  longestNameOfANamedViewInCharacters: number;
}
/** The workbook as the page has read it. */
export interface WorkbookRead {
  sheets: SheetRead[];
  views: Map<string, ViewWithInputs>;
  calculationTookTooLong: boolean;
  timeZone: string | null;
  locale: string;
  decimalSign: DecimalSignName;
  signsOfNumbers: SignsOfNumbers;
  patternOfATimeOfDay: string;
  defaultColumnWidthInPixels: number;
  mostBytesOfATableToImport: number;
  mostOptionsInADropdown: number;
  longestSheetNameInCharacters: number;
  mostCells: number;
  limitsOfNamedViews: LimitsOfNamedViews;
  deepestGroup: number;
  mostCheckboxesOfOneInsert: number;
  mostEditsInAStep: number;
  limitsOfConditionalFormats: LimitsOfConditionalFormats;
  limitsOfPlacements: LimitsOfPlacements;
  kindOfPattern: KindOfPattern;
}
/** A sheet's changes as read from the engine. */
export interface SheetChangesRead {
  sheetId: SheetId;
  /** The rows read again: every row the sheet had, or those named. */
  rowsListed: RowId[] | 'all';
  cellsNow: RowsOfCells;
  spilledCellsNow: SpilledCell[];
  layoutNow: SheetLayoutToRead | null;
  formatsGivenNow: FormatsGiven | null;
}
export interface ViewChangesRead {
  viewsNow: ViewContents[];
  inputsNow: InputsOfViewRead[];
}
/** The patterns a locale writes money and named months with. */
export interface LocalePatterns {
  currency: string;
  roundedCurrency: string;
  mediumDate: string;
  longDate: string;
  monthAndDay: string;
  monthAndYear: string;
}
/** A number format read in a locale, and what a sample of its kind shows under it. */
export interface PatternRead {
  kind: 'numberFormat';
  numberFormat: { pattern: string };
  shown: ShownValue;
}
export interface CauseOfErrorSaid {
  cause: CauseOfError | null;
  passedOnFrom: CauseCell | null;
}
/** What was said of why a formula comes to its error, and whether it is about the cell as it is now. */
export interface CauseOfErrorRead {
  said: CauseOfErrorSaid;
  isLatest: boolean;
}
export type CellTablesRead = CellTableRead[] | 'tookTooLong' | null;
export type RowsToSort = Omit<ReadRowsInSortedOrderRequest, 'kind'>;
/**
 * What a workbook's reads ask of the engine beyond what was read: locale facts, and answers about cells.
 * `null` where no answer can be had now.
 */
export interface WorkbookServices {
  dayTypedInLocaleAs(locale: string, text: string): string | null;
  shownInLocaleWithRoomForAll(locale: string, value: ValueIn, pattern: string): string | null;
  patternReadInLocale(locale: string, pattern: string, sampleOfKind: (kind: NumberFormatKind) => number): PatternRead | Refused | null;
  formulaInLocale(locale: string, text: string): string | null;
  patternsOfLocale(locale: string): LocalePatterns | null;
  fitOfColumnReadingsInLocale(locale: string, readings: ColumnReading[], texts: string[]): FitOfAColumnReading[] | null;
  textsUnderAColumnReadingInLocale(locale: string, reading: ColumnReading, texts: string[]): TextsUnderAColumnReadingAnswer | null;
  labelsOfADropdownColumn(texts: string[]): string[] | null;
  listLinesAsKept(lists: Iterable<ListLine>): ListLineAsKept[] | null;
  timeZones(): string[] | null;
  timeZoneNamed(name: string): string | null;
  locales(): string[] | null;
  cellsToCopy(oneCorner: CellId, otherCorner: CellId, rowsOutOfView: readonly IdRun[]): CellsToCopyAnswer | null;
  dropdownOptionsToOffer(oneCorner: CellId, otherCorner: CellId): { label: string }[] | null;
  cellsThatADropdownWouldClear(oneCorner: CellId, otherCorner: CellId, dropdown: DropdownToPointAt): CellsThatADropdownWouldClearAnswer | null;
  cellsOfTheDropdownAt(cell: CellId): CellsOfDropdownAnswer | null;
  whatATableChanges(table: TableIntoSheet): WhatATableChangesAnswer | Refused | null;
  formatsGivenAsIf(sheetId: SheetId, asIf: Iterable<ConditionalFormatAsIf>): FormatsGivenAnswer | null;
  conditionalFormatSuggestions(oneCorner: CellId, otherCorner: CellId): ConditionalFormatSuggestionsAnswer | null;
  /** `'nowhere'`: no table at the cell. */
  tableAtCell(cell: CellId): TableWithColumns | 'nowhere' | null;
  cellTableAt(cell: CellId): CellTableRead | null;
  cellTables(sheetId: SheetId): CellTablesRead;
  cellTableDeclaredAs(sheetId: SheetId, cellTable: CellTable): CellTableRead | 'tookTooLong' | 'nowhere' | null;
  conditionalFormatsAsAgentIsTold(oneCorner: CellId, otherCorner: CellId): string | null;
  conditionalFormatsInIds(sheetId: SheetId, written: unknown): RulesRead | null;
  conditionalFormatsByAddress(sheetId: SheetId, rules: Iterable<RuleInIds>): (RuleByAddress | null)[] | null;
  proposedFormulaValue(cell: CellId, text: string): { cell: CellContents | null } | null;
  filteredRows(table: TableInIds, filter: Filter): FilteredRowsAnswer | Refused | null;
  valuesOfFilteredColumn(table: TableInIds, filter: Filter | null, columnId: ColumnId): ValuesOfFilteredColumnAnswer | Refused | null;
  rowsInSortedOrder(toSort: RowsToSort): RowsInSortedOrderAnswer | Refused | null;
  tablesOfSheet(sheetId: SheetId): TablesOfSheetAnswer | Refused | null;
  pivotTableAt(cell: CellId): PivotTableAtAnswer | Refused | null;
  valuesToFilterPivotTableBy(
    source: PivotTableSource,
    columnId: ColumnId,
    keeps: PivotKeeps,
    listed: Iterable<PivotWrittenValue | null>,
  ): ValuesOfFilteredColumnAnswer | Refused | null;
  causeOfError(cell: CellId, cellNow: string): CauseOfErrorRead | null;
}
/** The locale readers of the services, bound to the workbook's locale. */
export interface LocaleHelpers {
  dayTypedAs(text: string): string | null;
  shownWithRoomForAll(value: ValueIn, pattern: string): string | null;
  patternRead(pattern: string, sampleOfKind: (kind: NumberFormatKind) => number): PatternRead | Refused | null;
  formulaAsTyped(text: string): string | null;
  patternsOfItsLocale: LocalePatterns;
  fitOfColumnReadings(readings: ColumnReading[], texts: string[]): FitOfAColumnReading[] | null;
  textsUnderAColumnReading(reading: ColumnReading, texts: string[]): TextsUnderAColumnReadingAnswer | null;
}
/** The cells a formula's array fills, and the formula. */
export interface SpillOver {
  formulaText: string;
  area: CellArea;
}
/** Everything the page reads of a workbook: what was read, and the services. */
export interface WorkbookReads extends WorkbookServices, LocaleHelpers {
  listSheets(): SheetSummary[];
  /** The reads with every sheet's rows in the order they are stored in; `null` where no sheet has an order of its own. */
  asStored(): WorkbookReads | null;
  sheetAsItStands(sheetId: SheetId): SheetRead | null;
  rowsAsTheyStand(sheetId: SheetId): Map<RowId, RowAsItStands>;
  cellsHeldByRow(sheetId: SheetId): RowsOfCells;
  cellsWithSpillIn(sheetId: SheetId): CellContents[];
  isSheetAsNew(sheetId: SheetId): boolean;
  mostBytesOfATableToImport(): number;
  mostOptionsInADropdown(): number;
  longestSheetNameInCharacters(): number;
  mostFilledCells(): number;
  limitsOfNamedViews(): LimitsOfNamedViews;
  deepestGroup(): number;
  mostCheckboxesOfOneInsert(): number;
  mostEditsInAStep(): number;
  limitsOfConditionalFormats(): LimitsOfConditionalFormats;
  limitsOfPlacements(): LimitsOfPlacements;
  positionOfCell(cell: CellId): CellPosition | null;
  rowIndexOf(sheetId: SheetId, rowId: RowId): number | null;
  columnIndexOf(sheetId: SheetId, columnId: ColumnId): number | null;
  cellIdAt(sheetId: SheetId, rowIndex: number, columnIndex: number): CellId | null;
  linesOf(sheetId: SheetId): SheetRead | null;
  cellOf(cell: CellId): CellContents | null;
  spilledCellOf(cell: CellId): SpilledCell | null;
  cellOnShowIn(cell: CellId): CellOnShow | null;
  formatOf(cell: CellId): WholeCellFormat;
  sharedFormatBetween(oneCorner: CellId, otherCorner: CellId): SharedCellFormat | null;
  lookOfRow(sheetId: SheetId, rowIndex: number): string;
  conditionalFormatsOf(sheetId: SheetId): ConditionalFormatContents[];
  formatsGivenIn(sheetId: SheetId): FormatsGiven;
  placementsIn(sheetId: SheetId): PlacementOnGrid[];
  cellTablesDeclaredIn(sheetId: SheetId): CellTableContents[];
  namedViewsIn(sheetId: SheetId): NamedViewContents[];
  viewAsItStands(viewId: string): ViewWithInputs | null;
  rowSizingOf(sheetId: SheetId): RowSizing[];
  whereTextWraps(sheetId: SheetId): IndexRunsOfEntry[];
  cellsWithListsIn(sheetId: SheetId): CellsByRow;
  hasBorderLine(sheetId: SheetId): boolean;
  bordersMayChangeBefore(sheetId: SheetId, area: CellArea): { rows: number[]; columns: number[] };
  /** Whether a cell of the area clips its text. */
  isTextClippedIn(sheetId: SheetId, area: CellArea): boolean;
  numberFormatPatternsIn(sheetId: SheetId, area: CellArea): string[];
  hexColorsOf(sheetId: SheetId): string[];
  dropdownOf(cell: CellId): DropdownContents | null;
  spillOver(cell: CellId): SpillOver | null;
  filledCellsIn(sheetId: SheetId, area: CellArea): CellId[];
  cellsOnShowIn(sheetId: SheetId, area: CellArea): CellId[];
  areaOnShowIn(sheetId: SheetId, area: CellArea): CellArea | null;
  columnIndexesOnShowIn(sheetId: SheetId, rowIndex: number): number[];
  mergedAreaAt(sheetId: SheetId, position: CellPosition): CellArea | null;
  mergedAreasIn(sheetId: SheetId, area: CellArea): CellArea[];
  userIds(): string[];
  isEveryCellBlank: boolean;
  filledCellCount(): number;
  calculationTookTooLong: boolean;
  timeZone: string | null;
  locale: string;
  decimalSign: DecimalSignName;
  signsOfNumbers: SignsOfNumbers;
  patternOfATimeOfDay: string;
}
interface LastSpill {
  key: string;
  over: SpillOver | null;
}

export function rowCountBeforeNextBlock(rowsOfInputs: readonly (readonly InputRow[])[]): number {
  let rowCount = Math.max(0, ...rowsOfInputs.map((rows) => rows.length));
  let numberColumnsOfInputs = rowsOfInputs.map(() => new Set<number>());
  let headersSeen = new Set<string>();
  let filledRowCount = 0;
  let firstBlankIndex: number | null = null;
  for (let index = 0; index < rowCount; index += 1) {
    let rowOfInputs = rowsOfInputs.map((rows) => rows[index]);
    if (rowOfInputs.every(isInputRowBlank)) {
      firstBlankIndex ??= index;
      continue;
    }
    let hasNumber = rowOfInputs.some((row: InputRow = []) => row.some(({ value }) => typeof value === 'number'));
    let hasTextOverNumbers = rowOfInputs.some(
      (row: InputRow = [], inputIndex) =>
        row.some(
          ({ value, text }, columnIndex) =>
            typeof value === 'string' && text !== '' && inputIndex + columnIndex > 0 && numberColumnsOfInputs[inputIndex]?.has(columnIndex) === true,
        ),
    );
    if (!hasNumber) {
      let header = JSON.stringify(rowOfInputs.map((row: InputRow = []) => row.map(({ text }) => text)));
      let isNewHeader = !headersSeen.has(header);
      if (firstBlankIndex !== null && filledRowCount >= 2 && hasTextOverNumbers && isNewHeader) return firstBlankIndex;
      headersSeen.add(header);
    }
    firstBlankIndex = null;
    filledRowCount += 1;
    for (let [inputIndex, row] of rowOfInputs.entries())
      for (let [columnIndex, { value }] of (row ?? []).entries())
        if (typeof value === 'number') numberColumnsOfInputs[inputIndex]?.add(columnIndex);
  }
  return rowCount;
}
export function viewsWithInputs(
  previousViews: ReadonlyMap<string, ViewWithInputs>,
  views: readonly ViewContents[],
  inputs: readonly InputsOfViewRead[],
): Map<string, ViewWithInputs> {
  let inputsByView = new Map(inputs.map((input) => [input.viewId, input]));
  return new Map(
    views.map(({ viewId, view }) => {
      let entry = inputsByView.get(viewId);
      let viewNow =
        entry === undefined
          ? previousViews.get(viewId)
          : viewInputsFromAnswer(view, entry);
      if (viewNow === undefined) throw Error('sheets-core named a view whose inputs the page has not read');
      return [viewId, viewNow];
    }),
  );
}
export function rowSizingRuns(rows: LineIndex, rowHeights: readonly RowHeightContents[], cellFormats: readonly CellFormatContents[]): RowSizing[] {
  let edges: EdgeOfRowSizing[] = [];
  let addEdges = (spans: readonly LineSpan[], sizedBy: Pick<EdgeOfARowHeight, 'heightInPixels'> | Pick<EdgeOfAFontSize, 'fontSizeInPoints'>) => {
    for (let { firstIndex, count } of spans)
      edges.push(
        {
          at: firstIndex,
          isStart: true,
          ...sizedBy,
        },
        {
          at: firstIndex + count,
          isStart: false,
          ...sizedBy,
        },
      );
  };
  for (let { rows: rowRun, heightInPixels: heightOfRun } of rowHeights)
    addEdges(rows.stretchesOf(rowRun), {
      heightInPixels: heightOfRun,
    });
  for (let { rows: rowRuns, format } of cellFormats) {
    let fontSize = format.font?.size;
    if (fontSize === undefined || fontSize <= DEFAULT_CELL_FORMAT.font.size) continue;
    for (let rowRun of rowRuns)
      addEdges(rows.stretchesOf(rowRun), {
        fontSizeInPoints: fontSize,
      });
  }
  edges.sort((edge, otherEdge) => (edge.at === otherEdge.at ? Number(edge.isStart) - Number(otherEdge.isStart) : edge.at - otherEdge.at));
  let sizing: RowSizing[] = [];
  let heightInPixels: number | null = null;
  let fontSizeCounts = new Map<number, number>();
  edges.forEach((edge, edgeIndex) => {
    if ('heightInPixels' in edge) heightInPixels = edge.isStart ? edge.heightInPixels : null;
    else {
      let fontSizeInPoints = edge.fontSizeInPoints;
      let countNow = (fontSizeCounts.get(fontSizeInPoints) ?? 0) + (edge.isStart ? 1 : -1);
      if (countNow === 0) fontSizeCounts.delete(fontSizeInPoints);
      else fontSizeCounts.set(fontSizeInPoints, countNow);
    }
    let nextEdge = edges[edgeIndex + 1];
    if (nextEdge === undefined || nextEdge.at === edge.at) return;
    let largestFontSize = Math.max(DEFAULT_CELL_FORMAT.font.size, ...fontSizeCounts.keys());
    if (heightInPixels === null && fontSizeCounts.size === 0) return;
    let lastSizing = sizing.at(-1);
    let isSameAsLast =
      lastSizing !== undefined &&
      lastSizing.firstIndex + lastSizing.count === edge.at &&
      lastSizing.heightInPixels === heightInPixels &&
      lastSizing.largestFontSizeInPoints === largestFontSize;
    if (isSameAsLast) sizing.pop();
    sizing.push({
      firstIndex: isSameAsLast ? lastSizing!.firstIndex : edge.at,
      count: nextEdge.at - (isSameAsLast ? lastSizing!.firstIndex : edge.at),
      heightInPixels,
      largestFontSizeInPoints: largestFontSize,
    });
  });
  return sizing;
}
export function tableAtCellIfAny(services: Pick<WorkbookServices, 'tableAtCell'>, cell: CellId): TableWithColumns | null {
  let read = services.tableAtCell(cell);
  return read === 'nowhere' ? null : read;
}
/** A sheet's row map once the rows listed are read again: an entry for each row of the cells read. */
export function rowsWithCells<Cell extends CellAt>(
  byRow: ReadonlyMap<RowId, ReadonlyMap<ColumnId, Cell>>,
  rowIdsListed: Iterable<RowId>,
  cells: Iterable<Cell>,
): Map<RowId, ReadonlyMap<ColumnId, Cell>> {
  let rows = new Map(byRow);
  if (rows.size > 0) for (let rowId of rowIdsListed) rows.delete(rowId);
  let cellsByRow = new Map<RowId, Map<ColumnId, Cell>>();
  for (let cell of cells) {
    let row = cellsByRow.get(cell.r) ?? new Map<ColumnId, Cell>();
    cellsByRow.set(cell.r, row.set(cell.c, cell));
  }
  for (let [rowId, row] of cellsByRow) rows.set(rowId, row);
  return rows;
}
/** A sheet's cells once whole rows are read again: every row it had, or those listed, as the engine packs them. */
export function applyRowChanges(
  sheetCells: SheetCells,
  rowsListed: readonly RowId[] | 'all',
  rowsNow: RowsOfCells,
  spilledCellsNow: readonly SpilledCell[],
  keepColumnIndexes: boolean,
): SheetCells {
  let rowIdsListed = rowsListed === 'all' ? [...sheetCells.rowsAsTheyStand.keys()] : rowsListed;
  let cellCountByUserId = new Map(sheetCells.cellCountByUserId);
  let countUsers = (cell: CellContents, change: number) => {
    for (let { userId } of usersOfCell(cell)) {
      let count = (cellCountByUserId.get(userId) ?? 0) + change;
      if (count === 0) cellCountByUserId.delete(userId);
      else cellCountByUserId.set(userId, count);
    }
  };
  let columnIndexesOnShowByRow = new Map(keepColumnIndexes ? sheetCells.columnIndexesOnShowByRow : []);
  let cellsByRow = new Map(sheetCells.cellsByRow);
  for (let rowId of rowIdsListed) {
    for (let cell of cellsByRow.get(rowId)?.cellsWithUsersARichTextOrASpill() ?? []) countUsers(cell, -1);
    if (!rowsNow.has(rowId)) cellsByRow.delete(rowId);
    columnIndexesOnShowByRow.delete(rowId);
  }
  let cellsWithSpill: CellContents[] = [];
  let cellsWithLists: CellContents[] = [];
  for (let [rowId, row] of rowsNow) {
    if (sheetCells.cellsByRow.size > 0 && cellsByRow.get(rowId)?.goesOnAs(row) !== true) cellsByRow.set(rowId, row);
    for (let cell of row.cellsWithUsersARichTextOrASpill()) {
      if ((countUsers(cell, 1), cell.spill !== undefined)) cellsWithSpill.push(cell);
      if (listLinesOfCell(cell).length > 0) cellsWithLists.push(cell);
    }
  }
  let rowsOfCells = sheetCells.cellsByRow.size > 0 ? cellsByRow : rowsNow;
  let spilledCellsByRow = rowsWithCells(sheetCells.spilledCellsByRow, rowIdsListed, spilledCellsNow);
  let rowsAsTheyStand = spilledCellsByRow.size === 0 ? null : new Map(sheetCells.rowsAsTheyStand);
  if (rowsAsTheyStand !== null)
    for (let rowId of new Set([...rowIdsListed, ...rowsNow.keys(), ...spilledCellsNow.map(({ r }) => r)])) {
      let [cells, spilledCells] = [rowsOfCells.get(rowId), spilledCellsByRow.get(rowId)];
      if (cells === sheetCells.cellsByRow.get(rowId) && spilledCells === sheetCells.spilledCellsByRow.get(rowId)) continue;
      let rowAsItStands: RowAsItStands | undefined = cells !== undefined && spilledCells !== undefined ? {} : (cells ?? spilledCells);
      if (rowAsItStands === undefined) rowsAsTheyStand.delete(rowId);
      else rowsAsTheyStand.set(rowId, rowAsItStands);
    }
  return {
    cellsByRow: rowsOfCells,
    spilledCellsByRow,
    cellsWithSpillByRow: rowsWithCells(sheetCells.cellsWithSpillByRow, rowIdsListed, cellsWithSpill),
    cellsWithListsByRow: rowsWithCells(sheetCells.cellsWithListsByRow, rowIdsListed, cellsWithLists),
    rowsAsTheyStand: rowsAsTheyStand ?? rowsOfCells,
    cellCountByUserId,
    columnIndexesOnShowByRow,
  };
}
export function readSheetLayout(
  layout: SheetLayoutToRead,
  defaultColumnWidth: number,
  kindOfPattern: KindOfPattern,
  previous?: SheetLayoutRead,
): SheetLayoutRead {
  let { sheetId, name, rows: rowRuns, columns: columnRuns, ownRowOrder } = layout;
  let { mergedRanges = [], columnWidths = [], rowHeights = [] } = layout;
  let { cellFormats = [], dropdowns = [], rowGroups = [], columnGroups = [] } = layout;
  let { conditionalFormats = [], placements = [], cellTables = NO_CELL_TABLES } = layout;
  let rows = reuseLineIndex(previous?.rows, rowRuns);
  let columns = reuseLineIndex(previous?.columns, columnRuns, createCachedLineIndex);
  let lastFrozenRowIndex = layout.lastFrozenRow === undefined ? -1 : rows.indexOf(layout.lastFrozenRow);
  let lastFrozenColumnIndex = layout.lastFrozenColumn === undefined ? -1 : columns.indexOf(layout.lastFrozenColumn);
  if (lastFrozenRowIndex === null || lastFrozenColumnIndex === null) throw Error('sheets-core named a frozen row or column that is not in the sheet');
  let sizedColumns = columnWidths.map(({ columns: columnRun, widthInPixels }) => {
    let firstIndex = columns.indexOf(`${columnRun.base}.${columnRun.first}`);
    let lastIndex = columns.indexOf(`${columnRun.base}.${columnRun.first + columnRun.count - 1}`);
    if (firstIndex === null || lastIndex === null || lastIndex - firstIndex !== columnRun.count - 1)
      throw Error('sheets-core named sized columns that are not side by side in the sheet');
    return {
      firstIndex,
      count: columnRun.count,
      sizeInPixels: widthInPixels,
    };
  });
  let rowSizing: RowSizing[] | null = null;
  let hexColors: string[] | null = null;
  let hasBorderLine: boolean | null = null;
  let entriesWithBorders: IndexRunsOfEntry[] | null = null;
  let entriesThatWrapText: IndexRunsOfEntry[] | null = null;
  let numberFormats: NumberFormatAtIndexes[] | null = null;
  let formats: FormatAtIndexes[] | null = null;
  let layoutAsStored: SheetLayoutRead | null = null;
  return {
    summary: {
      sheetId,
      name,
      rowCount: rows.count,
      columnCount: columns.count,
      columnEdges: createLineSizes(columns.count, sizedColumns, defaultColumnWidth),
      frozenRowCount: lastFrozenRowIndex + 1,
      frozenColumnCount: lastFrozenColumnIndex + 1,
      areGridlinesHidden: layout.areGridlinesHidden === true,
      interactive: layout.interactive ?? null,
      rowGroups: groupsOnGrid(rowGroups, rows),
      columnGroups: groupsOnGrid(columnGroups, columns),
      ownRowOrder:
        ownRowOrder === undefined || ownRowOrder === 'givenUp'
          ? null
          : {
              stored: createLineIndex(ownRowOrder.asStored.rows),
              seen: rows,
              firstIndex: ownRowOrder.firstIndex,
              count: ownRowOrder.count,
            },
      isOwnRowOrderGivenUp: ownRowOrder === 'givenUp',
    },
    rows,
    columns,
    isLaidOutAsNew:
      layout.lastFrozenRow === undefined &&
      layout.lastFrozenColumn === undefined &&
      layout.areGridlinesHidden !== true &&
      layout.interactive === undefined &&
      [mergedRanges, columnWidths, rowHeights, cellFormats, rowGroups, columnGroups, conditionalFormats, placements].every(
        ({ length }) => length === 0,
      ),
    cellFormats: createCellFormatLookup(cellFormats, kindOfPattern),
    rowSizing: () => (rowSizing ??= rowSizingRuns(rows, rowHeights, cellFormats)),
    hasBorderLine: () => (hasBorderLine ??= anyEntryHasBorderLine(cellFormats)),
    entriesWithBorders: () => (entriesWithBorders ??= borderEntryRuns(cellFormats, rows, columns)),
    entriesThatWrapText: () => (entriesThatWrapText ??= wrapEntryRuns(cellFormats, rows, columns)),
    numberFormats: () => (numberFormats ??= numberFormatEntryRuns(cellFormats, rows, columns)),
    formats: () => (formats ??= formatEntryRuns(cellFormats, rows, columns, kindOfPattern)),
    hexColors: () => (hexColors ??= customHexColorsOfSheet(cellFormats, dropdowns)),
    dropdownsById: new Map(dropdowns.map((dropdown) => [dropdown.dropdownId, dropdown])),
    conditionalFormats,
    placements: placementsOnGrid(placements, rows, columns),
    cellTables,
    namedViews: layout.namedViews ?? NO_NAMED_VIEWS,
    asStored() {
      if (ownRowOrder === undefined || ownRowOrder === 'givenUp') return null;
      let { ownRowOrder: _ownRowOrder, ...layoutAsSeen } = layout;
      return (layoutAsStored ??= readSheetLayout(
        {
          ...layoutAsSeen,
          ...ownRowOrder.asStored,
        },
        defaultColumnWidth,
        kindOfPattern,
      ));
    },
    mergedAreas: mergedRanges.map(({ liveTopLeft, liveBottomRight }) => {
      let area = areaBetweenCells(
        {
          rows,
          columns,
        },
        liveTopLeft,
        liveBottomRight,
      );
      if (area === null) throw Error('sheets-core named merged cells that are not in the sheet');
      return area;
    }),
  };
}
export function columnIndexesOnShow(sheet: SheetRead, rowIndex: number): number[] {
  let rowId = sheet.rows.idAt(rowIndex);
  if (rowId === null) return [];
  let cells = sheet.cellsByRow.get(rowId);
  let spilledCells = sheet.spilledCellsByRow.get(rowId);
  if (cells === undefined && spilledCells === undefined) return [];
  let cached = sheet.columnIndexesOnShowByRow.get(rowId);
  if (cached !== undefined) return cached;
  let columnIndexes = [...(cells?.keys() ?? []), ...(spilledCells?.keys() ?? [])]
    .map((columnId) => sheet.columns.indexOf(columnId))
    .filter((columnIndex) => columnIndex !== null);
  columnIndexes.sort((columnIndex, otherColumnIndex) => columnIndex - otherColumnIndex);
  sheet.columnIndexesOnShowByRow.set(rowId, columnIndexes);
  return columnIndexes;
}
export function cellsInArea(sheet: SheetRead, cellsByRow: ReadonlyMap<RowId, ReadonlyMap<ColumnId, unknown>>, area: CellArea): CellId[] {
  let { sheetId } = sheet.summary;
  let cellIds: CellId[] = [];
  let addRow = (rowId: RowId, cellsOfRow: ReadonlyMap<ColumnId, unknown>) => {
    for (let columnId of cellsOfRow.keys()) {
      let columnIndex = sheet.columns.indexOf(columnId);
      if (columnIndex !== null && isIndexWithin(columnIndex, area.leftColumnIndex, area.columnCount))
        cellIds.push({
          sheetId,
          rowId,
          columnId,
        });
    }
  };
  if (area.rowCount < cellsByRow.size) {
    for (let index = 0; index < area.rowCount; index += 1) {
      let rowId = sheet.rows.idAt(area.topRowIndex + index);
      let cellsOfRow = rowId === null ? undefined : cellsByRow.get(rowId);
      if (rowId !== null && cellsOfRow !== undefined) addRow(rowId, cellsOfRow);
    }
    return cellIds;
  }
  for (let [rowId, cellsOfRow] of cellsByRow) {
    let rowIndex = sheet.rows.indexOf(rowId);
    if (rowIndex !== null && isIndexWithin(rowIndex, area.topRowIndex, area.rowCount)) addRow(rowId, cellsOfRow);
  }
  return cellIds;
}
export function filledAreaWithin(sheet: SheetRead, area: CellArea): CellArea | null {
  let [top, bottom, left, right] = [1 / 0, -1 / 0, 1 / 0, -1 / 0];
  let visitRow = (rowIndex: number) => {
    let matches = columnIndexesOnShow(sheet, rowIndex).filter((columnIndex) => isIndexWithin(columnIndex, area.leftColumnIndex, area.columnCount));
    let [firstMatch, lastMatch] = [matches[0], matches.at(-1)];
    if (firstMatch === undefined || lastMatch === undefined) return;
    [top, bottom] = [Math.min(top, rowIndex), Math.max(bottom, rowIndex)];
    [left, right] = [Math.min(left, firstMatch), Math.max(right, lastMatch)];
  };
  if (area.rowCount < sheet.cellsByRow.size + sheet.spilledCellsByRow.size)
    for (let index = 0; index < area.rowCount; index += 1) visitRow(area.topRowIndex + index);
  else
    for (let rowId of [...sheet.cellsByRow.keys(), ...sheet.spilledCellsByRow.keys()]) {
      let rowIndex = sheet.rows.indexOf(rowId);
      if (rowIndex !== null && isIndexWithin(rowIndex, area.topRowIndex, area.rowCount)) visitRow(rowIndex);
    }
  return top === 1 / 0
    ? null
    : {
        topRowIndex: top,
        leftColumnIndex: left,
        rowCount: bottom - top + 1,
        columnCount: right - left + 1,
      };
}
export function areaBetweenCells(
  { rows, columns }: { rows: LineIndex; columns: LineIndex },
  topLeft: CellAt,
  bottomRight: CellAt,
): CellArea | null {
  let topRow = rows.indexOf(topLeft.r);
  let leftColumn = columns.indexOf(topLeft.c);
  let bottomRow = rows.indexOf(bottomRight.r);
  let rightColumn = columns.indexOf(bottomRight.c);
  return topRow === null || leftColumn === null || bottomRow === null || rightColumn === null
    ? null
    : {
        topRowIndex: topRow,
        leftColumnIndex: leftColumn,
        rowCount: bottomRow - topRow + 1,
        columnCount: rightColumn - leftColumn + 1,
      };
}
export function spanBetweenIds(lineIndex: LineIndex, firstId: string, lastId: string): LineSpan | null {
  let [firstIndex, lastIndex] = [lineIndex.indexOf(firstId), lineIndex.indexOf(lastId)];
  return firstIndex === null || lastIndex === null ? null : spanOfIndexes([firstIndex, lastIndex]);
}
export function spillAreaOver(sheet: SheetRead, { rowId, columnId }: CellId): SpillOver | null {
  let rowIndex = sheet.rows.indexOf(rowId);
  let columnIndex = sheet.columns.indexOf(columnId);
  if (rowIndex === null || columnIndex === null) return null;
  let cell = sheet.cellsByRow.get(rowId)?.get(columnId);
  let spillSource = sheet.spilledCellsByRow.get(rowId)?.get(columnId)?.from;
  let sourceCell = spillSource === undefined ? undefined : sheet.cellsByRow.get(spillSource.r)?.get(spillSource.c);
  let candidates =
    (cell ?? sourceCell) === undefined
      ? [...sheet.cellsWithSpillByRow.values()].flatMap((cellsOfRow) => Array.from<CellContents>(cellsOfRow.values()))
      : [cell ?? sourceCell];
  for (let candidate of candidates) {
    if (candidate?.spill?.kind !== 'fills' || candidate.formulaText === undefined) continue;
    let area = areaBetweenCells(sheet, candidate, candidate.spill.to);
    if (area !== null && isIndexWithin(rowIndex, area.topRowIndex, area.rowCount) && isIndexWithin(columnIndex, area.leftColumnIndex, area.columnCount))
      return {
        formulaText: candidate.formulaText,
        area,
      };
  }
  return null;
}
export function readWorkbook(
  {
    sheets,
    calculationTookTooLong,
    timeZone,
    locale,
    decimalSign = 'point',
    groupSign = 'comma',
    sizesOfGroups = 'threes',
    patternOfATimeOfDay = DEFAULT_TIME_OF_DAY_PATTERN,
    views = [],
  }: WorkbookToRead & { calculationTookTooLong?: boolean },
  {
    defaultColumnWidthInPixels,
    localeOfANewWorkbook,
    limits: {
      mostBytesOfATableToImport,
      mostOptionsInADropdown,
      longestSheetNameInCharacters,
      mostCells,
      mostNamedViewsInASheet,
      longestNameOfANamedViewInCharacters,
      deepestGroup,
      mostCheckboxesOfOneInsert,
      mostEditsInAStep,
      mostRangesInAConditionalFormat,
      mostTestsInAConditionalFormat,
      longestTextOfAConditionInCharacters,
      largestCountInACondition,
      smallestSideOfAPlacementInPixels,
      largestSideOfAPlacementInPixels,
    },
  }: WorkbookDescription,
  kindOfPattern: KindOfPattern,
  formatsGivenBySheet: readonly FormatsGivenOfSheet[] = [],
  viewInputs: readonly InputsOfViewRead[] = [],
): WorkbookRead {
  return {
    sheets: sheets.map((sheet) => ({
      ...readSheetLayout(sheet, defaultColumnWidthInPixels, kindOfPattern),
      ...applyRowChanges(EMPTY_SHEET_CELLS, [], sheet.cells, sheet.spilledCells ?? [], false),
      formatsGiven: formatsGivenBySheet.find(({ sheetId }) => sheetId === sheet.sheetId)?.formatsGiven ?? NO_FORMATS_GIVEN,
    })),
    views: viewsWithInputs(new Map(), views, viewInputs),
    calculationTookTooLong: calculationTookTooLong === true,
    timeZone: timeZone ?? null,
    locale: locale ?? localeOfANewWorkbook,
    decimalSign,
    signsOfNumbers: {
      decimalSign,
      groupSign,
      sizesOfGroups,
    },
    patternOfATimeOfDay,
    defaultColumnWidthInPixels,
    mostBytesOfATableToImport,
    mostOptionsInADropdown,
    longestSheetNameInCharacters,
    mostCells,
    limitsOfNamedViews: {
      mostNamedViewsInASheet,
      longestNameOfANamedViewInCharacters,
    },
    deepestGroup,
    mostCheckboxesOfOneInsert,
    mostEditsInAStep,
    limitsOfConditionalFormats: {
      mostRangesInAConditionalFormat,
      mostTestsInAConditionalFormat,
      longestTextOfAConditionInCharacters,
      largestCountInACondition,
    },
    limitsOfPlacements: {
      smallestSideOfAPlacementInPixels,
      largestSideOfAPlacementInPixels,
    },
    kindOfPattern,
  };
}
export function applyWorkbookChanges(
  workbook: WorkbookRead,
  sheetChanges: readonly SheetChangesRead[],
  viewChanges: ViewChangesRead | null = null,
): WorkbookRead {
  let { defaultColumnWidthInPixels: defaultColumnWidth, kindOfPattern } = workbook;
  let changesBySheet = new Map(sheetChanges.map((changes) => [changes.sheetId, changes]));
  if (changesBySheet.size < sheetChanges.length) throw Error('sheets-core listed a sheet twice');
  let sheets = workbook.sheets.map((sheet) => {
    let entry = changesBySheet.get(sheet.summary.sheetId);
    if (entry === undefined) return sheet;
    changesBySheet.delete(sheet.summary.sheetId);
    let { rowsListed, cellsNow, spilledCellsNow, layoutNow, formatsGivenNow } = entry;
    return {
      ...(layoutNow === null ? sheet : readSheetLayout(layoutNow, defaultColumnWidth, kindOfPattern, sheet)),
      ...applyRowChanges(sheet, rowsListed, cellsNow, spilledCellsNow, layoutNow === null),
      formatsGiven: formatsGivenNow ?? sheet.formatsGiven,
    };
  });
  if (changesBySheet.size > 0) throw Error('sheets-core listed a sheet that the page has not read');
  return {
    ...workbook,
    sheets,
    views: viewChanges === null ? workbook.views : viewsWithInputs(workbook.views, viewChanges.viewsNow, viewChanges.inputsNow),
  };
}
export function createWorkbookAccessor(workbook: WorkbookRead, services: WorkbookServices): WorkbookReads {
  let {
    sheets,
    calculationTookTooLong,
    timeZone,
    locale,
    decimalSign,
  } = workbook;
  let { signsOfNumbers, patternOfATimeOfDay } = workbook;
  let sheetsById = new Map(sheets.map((sheet) => [sheet.summary.sheetId, sheet]));
  let summaries = sheets.map(({ summary }) => summary);
  let userIdSet = new Set<string>();
  for (let sheet of sheets) for (let userId of sheet.cellCountByUserId.keys()) userIdSet.add(userId);
  let userIds = [...userIdSet];
  let lastSpill: LastSpill | null = null;
  let accessorAsStored: WorkbookReads | null = null;
  let hasOwnRowOrder = summaries.some(({ ownRowOrder }) => ownRowOrder !== null);
  let accessor: WorkbookReads = {
    listSheets: () => summaries,
    asStored: () =>
      !hasOwnRowOrder
        ? null
        : (accessorAsStored ??= createWorkbookAccessor(
            {
              ...workbook,
              sheets: sheets.map((sheet) => ({
                ...sheet,
                ...sheet.asStored(),
              })),
            },
            servicesAsStored(services, (sheetId) => sheetsById.get(sheetId)?.summary.ownRowOrder ?? null),
          )),
    sheetAsItStands: (sheetId) => sheetsById.get(sheetId) ?? null,
    rowsAsTheyStand: (sheetId) => (sheetsById.get(sheetId) ?? EMPTY_SHEET_CELLS).rowsAsTheyStand,
    cellsHeldByRow: (sheetId) => (sheetsById.get(sheetId) ?? EMPTY_SHEET_CELLS).cellsByRow,
    cellsWithSpillIn: (sheetId) =>
      [...(sheetsById.get(sheetId) ?? EMPTY_SHEET_CELLS).cellsWithSpillByRow.values()].flatMap((cellsOfRow) =>
        Array.from<CellContents>(cellsOfRow.values()),
      ),
    isSheetAsNew(sheetId) {
      let entry = sheetsById.get(sheetId);
      return entry !== undefined && entry.isLaidOutAsNew && entry.cellsByRow.size === 0;
    },
    mostBytesOfATableToImport: () => workbook.mostBytesOfATableToImport,
    mostOptionsInADropdown: () => workbook.mostOptionsInADropdown,
    longestSheetNameInCharacters: () => workbook.longestSheetNameInCharacters,
    mostFilledCells: () => workbook.mostCells,
    limitsOfNamedViews: () => workbook.limitsOfNamedViews,
    deepestGroup: () => workbook.deepestGroup,
    mostCheckboxesOfOneInsert: () => workbook.mostCheckboxesOfOneInsert,
    mostEditsInAStep: () => workbook.mostEditsInAStep,
    limitsOfConditionalFormats: () => workbook.limitsOfConditionalFormats,
    limitsOfPlacements: () => workbook.limitsOfPlacements,
    positionOfCell({ sheetId, rowId, columnId }) {
      let entry = sheetsById.get(sheetId);
      let rowIndex = entry?.rows.indexOf(rowId) ?? null;
      let columnIndex = entry?.columns.indexOf(columnId) ?? null;
      return rowIndex === null || columnIndex === null
        ? null
        : {
            rowIndex,
            columnIndex,
          };
    },
    rowIndexOf: (sheetId, rowId) => sheetsById.get(sheetId)?.rows.indexOf(rowId) ?? null,
    columnIndexOf: (sheetId, columnId) => sheetsById.get(sheetId)?.columns.indexOf(columnId) ?? null,
    cellIdAt(sheetId, rowIndex, columnIndex) {
      let entry = sheetsById.get(sheetId);
      let rowId = entry?.rows.idAt(rowIndex) ?? null;
      let columnId = entry?.columns.idAt(columnIndex) ?? null;
      return rowId === null || columnId === null
        ? null
        : {
            sheetId,
            rowId,
            columnId,
          };
    },
    linesOf: (sheetId) => sheetsById.get(sheetId) ?? null,
    cellOf: ({ sheetId, rowId, columnId }) => sheetsById.get(sheetId)?.cellsByRow.get(rowId)?.get(columnId) ?? null,
    spilledCellOf: ({ sheetId, rowId, columnId }) =>
      sheetsById.get(sheetId)?.spilledCellsByRow.get(rowId)?.get(columnId) ?? null,
    cellOnShowIn({ sheetId, rowId, columnId }) {
      let entry = sheetsById.get(sheetId);
      return entry?.cellsByRow.get(rowId)?.get(columnId) ?? entry?.spilledCellsByRow.get(rowId)?.get(columnId) ?? null;
    },
    formatOf: ({ sheetId, rowId, columnId }) =>
      sheetsById.get(sheetId)?.cellFormats.formatOf(rowId, columnId) ?? DEFAULT_CELL_FORMAT,
    sharedFormatBetween(oneCorner, otherCorner) {
      let entry = sheetsById.get(oneCorner.sheetId);
      if (entry === undefined || oneCorner.sheetId !== otherCorner.sheetId) return null;
      let rowSpan = spanBetweenIds(entry.rows, oneCorner.rowId, otherCorner.rowId);
      let columnSpan = spanBetweenIds(entry.columns, oneCorner.columnId, otherCorner.columnId);
      if (rowSpan === null || columnSpan === null) return null;
      return sharedFormatOfArea(entry.formats(), {
        topRowIndex: rowSpan.firstIndex,
        leftColumnIndex: columnSpan.firstIndex,
        rowCount: rowSpan.count,
        columnCount: columnSpan.count,
      });
    },
    lookOfRow: (sheetId, rowIndex) => rowLookKey(sheetsById.get(sheetId)?.formats() ?? [], rowIndex),
    conditionalFormatsOf: (sheetId) => sheetsById.get(sheetId)?.conditionalFormats ?? [],
    formatsGivenIn: (sheetId) => sheetsById.get(sheetId)?.formatsGiven ?? NO_FORMATS_GIVEN,
    placementsIn: (sheetId) => sheetsById.get(sheetId)?.placements ?? NO_PLACEMENTS,
    cellTablesDeclaredIn: (sheetId) => sheetsById.get(sheetId)?.cellTables ?? NO_CELL_TABLES,
    namedViewsIn: (sheetId) => sheetsById.get(sheetId)?.namedViews ?? NO_NAMED_VIEWS,
    viewAsItStands: (viewId) => workbook.views.get(viewId) ?? null,
    rowSizingOf: (sheetId) => sheetsById.get(sheetId)?.rowSizing() ?? [],
    whereTextWraps: (sheetId) => sheetsById.get(sheetId)?.entriesThatWrapText() ?? [],
    cellsWithListsIn: (sheetId) => sheetsById.get(sheetId)?.cellsWithListsByRow ?? EMPTY_SHEET_CELLS.cellsWithListsByRow,
    hasBorderLine: (sheetId) => sheetsById.get(sheetId)?.hasBorderLine() ?? false,
    bordersMayChangeBefore: (sheetId, area) => borderEdgesNear(sheetsById.get(sheetId)?.entriesWithBorders() ?? [], area),
    isTextClippedIn: (sheetId, area) => clipsWithin(sheetsById.get(sheetId)?.formats() ?? [], area),
    numberFormatPatternsIn: (sheetId, area) => numberFormatPatternsWithin(sheetsById.get(sheetId)?.numberFormats() ?? [], area),
    hexColorsOf: (sheetId) => sheetsById.get(sheetId)?.hexColors() ?? [],
    dropdownOf({ sheetId, rowId, columnId }) {
      let entry = sheetsById.get(sheetId);
      let cellControl = entry?.cellFormats.formatOf(rowId, columnId).cellControl;
      if (entry === undefined || cellControl?.kind !== 'dropdown') return null;
      let dropdown = entry.dropdownsById.get(cellControl.dropdownId);
      if (dropdown === undefined) throw Error('sheets-core named a dropdown that is not among the sheet’s');
      return dropdown;
    },
    spillOver(cell) {
      let key = `${cell.sheetId} ${cell.rowId} ${cell.columnId}`;
      if (lastSpill?.key === key) return lastSpill.over;
      let entry = sheetsById.get(cell.sheetId);
      let ownRowOrder = entry?.summary.ownRowOrder ?? null;
      let spillAsStored = ownRowOrder === null ? null : (accessor.asStored()?.spillOver(cell) ?? null);
      let rowSpanAsSeen =
        spillAsStored === null
          ? null
          : coveringRowSpanIn('seen', ownRowOrder, {
              firstIndex: spillAsStored.area.topRowIndex,
              count: spillAsStored.area.rowCount,
            });
      let spillAsSeen =
        spillAsStored === null || rowSpanAsSeen === null
          ? null
          : {
              ...spillAsStored,
              area: {
                ...spillAsStored.area,
                topRowIndex: rowSpanAsSeen.firstIndex,
                rowCount: rowSpanAsSeen.count,
              },
            };
      let over = entry === undefined || ownRowOrder !== null ? spillAsSeen : spillAreaOver(entry, cell);
      lastSpill = {
        key,
        over,
      };
      return over;
    },
    filledCellsIn(sheetId, area) {
      let entry = sheetsById.get(sheetId);
      return entry === undefined ? [] : cellsInArea(entry, entry.cellsByRow, area);
    },
    cellsOnShowIn(sheetId, area) {
      let entry = sheetsById.get(sheetId);
      if (entry === undefined) return [];
      let cellIds = cellsInArea(entry, entry.cellsByRow, area);
      return entry.spilledCellsByRow.size === 0 ? cellIds : [...cellIds, ...cellsInArea(entry, entry.spilledCellsByRow, area)];
    },
    areaOnShowIn(sheetId, area) {
      let entry = sheetsById.get(sheetId);
      return entry === undefined ? null : filledAreaWithin(entry, area);
    },
    columnIndexesOnShowIn(sheetId, rowIndex) {
      let entry = sheetsById.get(sheetId);
      return entry === undefined ? [] : columnIndexesOnShow(entry, rowIndex);
    },
    mergedAreaAt: (sheetId, { rowIndex, columnIndex }) =>
      sheetsById
        .get(sheetId)
        ?.mergedAreas.find(
          (merged) => isIndexWithin(rowIndex, merged.topRowIndex, merged.rowCount) && isIndexWithin(columnIndex, merged.leftColumnIndex, merged.columnCount),
        ) ?? null,
    mergedAreasIn: (sheetId, area) => sheetsById.get(sheetId)?.mergedAreas.filter((merged) => areasOverlap(merged, area)) ?? [],
    userIds: () => userIds,
    isEveryCellBlank: sheets.every(({ cellsByRow }) => cellsByRow.size === 0),
    filledCellCount() {
      let count = 0;
      for (let { cellsByRow } of sheets) for (let cellsOfRow of cellsByRow.values()) count += cellsOfRow.size;
      return count;
    },
    calculationTookTooLong,
    timeZone,
    locale,
    decimalSign,
    signsOfNumbers,
    patternOfATimeOfDay,
    ...services,
    ...bindLocaleHelpers(locale, services),
  };
  return accessor;
}
export function servicesAsStored(services: WorkbookServices, ownRowOrderOf: (sheetId: SheetId) => OwnRowOrder | null): WorkbookServices {
  return {
    ...services,
    tableAtCell(cell) {
      let [table, ownRowOrder] = [services.tableAtCell(cell), ownRowOrderOf(cell.sheetId)];
      return ownRowOrder === null || table === 'nowhere' ? table : tableReadIn('stored', ownRowOrder, table);
    },
    cellTableAt(cell) {
      let [cellTable, ownRowOrder] = [services.cellTableAt(cell), ownRowOrderOf(cell.sheetId)];
      return ownRowOrder === null || cellTable === null ? cellTable : cellTableIn('stored', ownRowOrder, cellTable);
    },
    cellTables(sheetId) {
      let [cellTables, ownRowOrder] = [services.cellTables(sheetId), ownRowOrderOf(sheetId)];
      return ownRowOrder === null || cellTables === null || cellTables === 'tookTooLong'
        ? cellTables
        : cellTables.map((cellTable) => cellTableIn('stored', ownRowOrder, cellTable));
    },
    conditionalFormatsAsAgentIsTold(oneCell, otherCell) {
      let [rowIds, ownRowOrder]: [RowEnds, OwnRowOrder | null] = [[oneCell.rowId, otherCell.rowId], ownRowOrderOf(oneCell.sheetId)];
      let [oneRowId, otherRowId] = ownRowOrder === null ? rowIds : rowEndsAsSeen(ownRowOrder, rowIds);
      return services.conditionalFormatsAsAgentIsTold({ ...oneCell, rowId: oneRowId }, { ...otherCell, rowId: otherRowId });
    },
  };
}
export function readsAsStored(reads: WorkbookReads): WorkbookReads {
  let asStored = reads.asStored();
  if (asStored === null) return reads;
  let merged = readsAsStoredCache.get(reads) ?? {
    ...reads,
    ...asStored,
  };
  return (readsAsStoredCache.set(reads, merged), merged);
}
export function isFormulaCell(workbook: WorkbookReads, cellId: CellId): boolean {
  let cell = workbook.cellOf(cellId);
  return cell === null ? workbook.spillOver(cellId) !== null : cell.input.kind === 'formula';
}
export function fullShownTextOfCell(workbook: WorkbookReads, cellId: CellId): string | null {
  let cell = workbook.cellOnShowIn(cellId);
  if (cell?.shown?.kind !== 'text') return null;
  let value = cellValueOf(cell);
  let { pattern } = numberFormatOfCell(workbook, cellId);
  return value?.kind === 'number' && GENERAL_OR_TEXT_PATTERN.test(pattern)
    ? (workbook.shownWithRoomForAll(value, pattern) ?? cell.shown.text)
    : cell.shown.text;
}
export const embedRefsOfView = (viewWithInputs: ViewWithInputs | null | undefined): string[] =>
  (viewWithInputs?.view.elements ?? []).map(({ embed }) => embed.ref);
export const isInputRowBlank = (row: InputRow | undefined): boolean =>
  row === undefined || row.every(({ value, text }) => text === '' && (value === null || value === ''));
export const inputRangeKey = ({ range: { sheetId, topLeft, bottomRight } }: InputOfAWidget): string =>
  JSON.stringify([sheetId, ...(topLeft.r < bottomRight.r ? [topLeft.r, bottomRight.r] : [bottomRight.r, topLeft.r])]);
export const rowsByInputName = (inputs: readonly { name: string; rows: InputRow[] }[]): Record<string, InputRow[]> =>
  Object.fromEntries(inputs.map(({ name, rows }) => [name, rows]));
export const inputsOfAnswer = ({ answer }: InputsOfViewRead, view: View): ViewInputs =>
  'refusal' in answer
    ? answer
    : {
        byElement: new Map(
          answer.elements.map(({ elementId, inputs }) => {
            let elementAsked = view.elements.find((element) => element.elementId === elementId);
            // An interactive element's inputs are kept whole, by name.
            if (elementAsked?.kind === 'interactive') return [elementId, rowsByInputName(inputs)];
            let inputsAsked = elementAsked?.inputs;
            let rangeKeys = inputs.map(({ name }) => {
              let inputAsked = inputsAsked?.find((input) => input.name === name);
              return inputAsked === undefined ? JSON.stringify(name) : inputRangeKey(inputAsked);
            });
            return [
              elementId,
              Object.fromEntries(
                inputs.map(({ name, rows }, index) => {
                  let inputsOfSameRows = inputs.filter((_input, otherIndex) => rangeKeys[otherIndex] === rangeKeys[index]);
                  let rowCount = rowCountBeforeNextBlock(inputsOfSameRows.map((input) => input.rows));
                  return [name, rowCount < rows.length ? rows.slice(0, rowCount) : rows];
                }),
              ),
            ];
          }),
        ),
      };
export const viewInputsFromAnswer = (view: View, entry: InputsOfViewRead): ViewWithInputs => ({
  view,
  inputs: inputsOfAnswer(entry, view),
  ...('canBeReset' in entry.answer && {
    canBeReset: true,
  }),
  ...('hasDefaultsToSave' in entry.answer && {
    hasDefaultsToSave: true,
  }),
});
export const ZERO_ANCHOR_OFFSET: OffsetOfAPlacement = {
  xInPixels: 0,
  yInPixels: 0,
};
export const placementsOnGrid = (placements: readonly PlacementContents[], rows: LineIndex, columns: LineIndex): PlacementOnGrid[] =>
  placements.map(({ placementId, placement, liveTopLeft }) => {
    let [rowIndex, columnIndex] = [rows.indexOf(liveTopLeft.r), columns.indexOf(liveTopLeft.c)];
    if (rowIndex === null || columnIndex === null) throw Error('sheets-core placed a view at a cell that is not in the sheet');
    let { shows, widthInPixels, heightInPixels } = placement;
    return {
      placementId,
      viewId: shows.viewId,
      rowIndex,
      columnIndex,
      offsetFromAnchorCell: placement.offsetFromAnchorCell ?? ZERO_ANCHOR_OFFSET,
      widthInPixels,
      heightInPixels,
    };
  });
export const cellRefOf = ({ rowId, columnId }: Pick<CellId, 'rowId' | 'columnId'>): CellAt => ({
  r: rowId,
  c: columnId,
});
export const areaRefBetween = (oneCorner: CellId, otherCorner: CellId): { sheetId: SheetId; oneCorner: CellAt; otherCorner: CellAt } => ({
  sheetId: oneCorner.sheetId,
  oneCorner: cellRefOf(oneCorner),
  otherCorner: cellRefOf(otherCorner),
});
export const DEFAULT_LOCALE_PATTERNS: LocalePatterns = {
  currency: '$#,##0.00',
  roundedCurrency: '$#,##0',
  mediumDate: 'mmm d, yyyy',
  longDate: 'mmmm d, yyyy',
  monthAndDay: 'mmm d',
  monthAndYear: 'mmm yyyy',
};
export const NO_PLACEMENTS: PlacementOnGrid[] = [];
export const NO_CELL_TABLES: CellTableContents[] = [];
export const NO_NAMED_VIEWS: NamedViewContents[] = [];
export const NO_FORMATS_GIVEN: FormatsGiven = {
  notWorkedOut: null,
  formats: [],
  colorScales: [],
  matches: [],
};
export const EMPTY_SHEET_CELLS: SheetCells = {
  cellsByRow: new Map(),
  spilledCellsByRow: new Map(),
  cellsWithSpillByRow: new Map(),
  cellsWithListsByRow: new Map(),
  rowsAsTheyStand: new Map(),
  cellCountByUserId: new Map(),
  columnIndexesOnShowByRow: new Map(),
};
export const groupsOnGrid = (groups: readonly GroupContents[], lineIndex: LineIndex): GroupOnGrid[] =>
  groups.map(({ groupId, ends, depth, isCollapsed }) => {
    let [firstIndex, lastIndex] = [lineIndex.indexOf(ends.first), lineIndex.indexOf(ends.last)];
    if (firstIndex === null || lastIndex === null || lastIndex < firstIndex) throw Error('sheets-core named a group whose ends are not in the sheet in that order');
    return {
      groupId,
      firstIndex,
      count: lastIndex - firstIndex + 1,
      depth,
      isCollapsed,
    };
  });
export const isIndexWithin = (index: number, first: number, count: number): boolean => index >= first && index < first + count;
export const areasOverlap = (area: CellArea, otherArea: CellArea): boolean =>
  area.topRowIndex < otherArea.topRowIndex + otherArea.rowCount &&
  otherArea.topRowIndex < area.topRowIndex + area.rowCount &&
  area.leftColumnIndex < otherArea.leftColumnIndex + otherArea.columnCount &&
  otherArea.leftColumnIndex < area.leftColumnIndex + area.columnCount;
export const DEFAULT_TIME_OF_DAY_PATTERN = 'h:mm AM/PM';
export const bindLocaleHelpers = (
  locale: string,
  {
    dayTypedInLocaleAs,
    shownInLocaleWithRoomForAll,
    patternReadInLocale,
    formulaInLocale,
    patternsOfLocale,
    fitOfColumnReadingsInLocale,
    textsUnderAColumnReadingInLocale,
  }: WorkbookServices,
): LocaleHelpers => ({
  dayTypedAs: (...args: [text: string]) => dayTypedInLocaleAs(locale, ...args),
  shownWithRoomForAll: (...args: [value: ValueIn, pattern: string]) => shownInLocaleWithRoomForAll(locale, ...args),
  patternRead: (...args: [pattern: string, sampleOfKind: (kind: NumberFormatKind) => number]) => patternReadInLocale(locale, ...args),
  formulaAsTyped: (text: string) => formulaInLocale(locale, text),
  patternsOfItsLocale: patternsOfLocale(locale) ?? DEFAULT_LOCALE_PATTERNS,
  fitOfColumnReadings: (...args: [readings: ColumnReading[], texts: string[]]) => fitOfColumnReadingsInLocale(locale, ...args),
  textsUnderAColumnReading: (...args: [reading: ColumnReading, texts: string[]]) => textsUnderAColumnReadingInLocale(locale, ...args),
});
export const readsAsStoredCache = new WeakMap<WorkbookReads, WorkbookReads>();
export const GENERAL_OR_TEXT_PATTERN = /general|@/i;
export const numberFormatOfCell = (workbook: WorkbookReads, cellId: CellId): KindedNumberFormat =>
  workbook.cellOnShowIn(cellId)?.numberFormatBrought ?? workbook.formatOf(cellId).numberFormat;
