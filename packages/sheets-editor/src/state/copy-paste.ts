import type { CellBlock, CopiedWidgetNode, Edit, SheetId, TextThatNoCellShows } from '@open-artifact/sheets-core';
import type { CellId, SheetSummary, WorkbookReads } from '../model/workbook.ts';
import type { LineSizes, ScrollPosition } from '../model/line-sizes.ts';
import type { CellArea } from '../selection/model.ts';
import type { EntryLooks, FontMark, PageState } from './initial-state.ts';
import type { ChartNodesCopiedFor, IfQueued, PasteChosen } from './event-reducer.ts';
import type { PageEffect, PageTransition } from './transitions.ts';
import type { decodeChartFromClipboard } from '../clipboard/chart-marker.ts';
import { selectedArea, selectionOfArea, isSameCell } from '../selection/model.ts';
import { withNoEffects, clearPassingNotice } from './transitions.ts';
import { refuseWhenSeveralRanges, hasOtherRanges } from '../selection/several-ranges.ts';
import { refuseIfRowsOutOfViewInTheWay, noticeRowsOutOfViewInTheWay, actOfEdit } from '../edits/rows-out-of-view.ts';
import { filteredRowRunsIn } from '../tables/filtered-rows.ts';
import { areaToA1AsStored } from '../formulas/from-words/where.ts';
import { ownRowOrderOfSheet } from '../model/line-ids.ts';
import { areaRefBetween, cellRefOf, embedRefsOfView } from '../model/workbook.ts';
import { shownCellBlockOfCorners, landingRowsSkippingFilters, unbrokenCellBlockOfCorners, rowCountOfRuns } from '../model/cell-blocks.ts';
import { selectedRangeOf, IF_QUEUED_DEFAULTS, enterEntryEdit, queueEdit } from '../model/edit-effects.ts';
import { plainerPasteOfAnotherProgram, hasPastedRichText, readMarkdownTables } from '../clipboard/other-programs.ts';
import { isOverByteLimit } from '../agent/prompt-text.ts';
import { parseTsvCells } from '../clipboard/formats.ts';
import { sanitizeTypedCellInput } from '../model/cell-text.ts';
import { unescapeClipboardText } from '../clipboard/text-escaping.ts';
import { markEditByPage } from '../editor/unanswered-entries.ts';
import { MAX_TYPED_MARKS, readTypedMarks } from '../editor/entry-looks.ts';
import { doesCellReadMarkSigns } from '../editor/start-entry.ts';
import { fontMarksOfStyle, plainLooks, richTextFromLooks } from '../editor/text-looks.ts';
import { placementById, placementAnchorOf, columnAnchorOf, rowAnchorOf, scrollToPlacedView, selectPlacement } from '../charts/placed-views.ts';
import { layoutOfView } from '../grid/layout.ts';
import { scrollPositionAtPixel, pixelOfScrollPosition } from '../model/line-sizes.ts';
import { MARK_SIGN_CHARS } from '../editor/entry-looks-values.ts';
import type { ReadsWithTextMeasurer } from './controller.ts';
export function copyOrCutSelection(state: PageState, workbook: WorkbookReads, cutToken: string | null): PageTransition {
  let area = selectedArea(state, workbook);
  if (area === null) return withNoEffects(state);
  let refusal = cutToken === null ? null : (refuseWhenSeveralRanges(state, 'cut') ?? refuseIfRowsOutOfViewInTheWay(state, workbook, 'cut'));
  if (refusal !== null)
    return {
      ...refusal,
      effects: [
        {
          kind: 'putNothingOnClipboard',
        },
      ],
    };
  let rowsLeftOut = filteredRowRunsIn(state, workbook, area);
  let copiedWhat: CopiedOrCutDone['what'] = rowsLeftOut.length === 0 ? 'copied' : 'copiedWithoutRowsOutOfView';
  let done: CopiedOrCutDone['what'] = cutToken === null ? copiedWhat : 'cut';
  return {
    state: {
      ...clearPassingNotice(state),
      lastDone: {
        what: done,
        cells: areaToA1AsStored(area, ownRowOrderOfSheet(workbook, state.sheetId)),
      },
    },
    effects: [
      {
        kind: 'putOnClipboard',
        sheetId: state.sheetId,
        area,
        rowsLeftOut,
        cutToken,
      },
    ],
  };
}
export function blockOfArea(workbook: WorkbookReads, sheetId: SheetId, block: CellArea) {
  let topLeftCell = workbook.cellIdAt(sheetId, block.topRowIndex, block.leftColumnIndex);
  let bottomRightCell = workbook.cellIdAt(sheetId, block.topRowIndex + block.rowCount - 1, block.leftColumnIndex + block.columnCount - 1);
  return topLeftCell !== null && bottomRightCell !== null ? areaRefBetween(topLeftCell, bottomRightCell) : null;
}
export function cutBlockToMove({ copiedCells }: Pick<PageState, 'copiedCells'>, workbook: WorkbookReads, cutToken: string | null) {
  if (copiedCells === null || cutToken === null || copiedCells.cutToken !== cutToken) return null;
  let area = selectedArea(copiedCells, workbook);
  return area === null ? null : blockOfArea(workbook, copiedCells.activeCell.sheetId, area);
}
export function pasteTopLeft(state: PageState, workbook: WorkbookReads): PasteTopLeft | null {
  let area = selectedArea(state, workbook);
  let selection = area === null ? null : selectionOfArea(state, workbook, area);
  let inView = selection === null ? null : shownCellBlockOfCorners(state, workbook, selectedRangeOf(selection));
  if (inView === null) return null;
  let [{ base: rowBase, first: rowFirst }] = inView.rows;
  let topLeft: CellId = {
    sheetId: state.sheetId,
    rowId: `${rowBase}.${rowFirst}`,
    columnId: inView.oneColumn,
  };
  return {
    inView,
    topLeft,
  };
}
export function pasteIntoSelection(state: PageState, workbook: WorkbookReads, paste: PasteChosen, shownToThePerson?: TextThatNoCellShows[]): PageTransition {
  let queueEditOf = (edit: Edit, ifQueued: IfQueued): PageTransition => ({
    state,
    effects: [
      {
        kind: 'queueEdit',
        edit,
        ifQueued: {
          ...ifQueued,
          pasteChosen: paste,
        },
        ...(shownToThePerson !== undefined && {
          shownToThePerson,
        }),
      },
    ],
  });
  let {
    cutToken,
    copiedCellsAsText,
    ofAnotherProgram,
    text,
    isPlainText,
    pastedTextIs,
  } = paste;
  let area = state.mode.kind === 'navigating' ? selectedArea(state, workbook) : null;
  let topLeftInView = area === null ? null : pasteTopLeft(state, workbook);
  if (area === null || topLeftInView === null) return withNoEffects(state);
  let { inView, topLeft } = topLeftInView;
  let [{ base: rowBase, first: rowFirst }] = inView.rows;
  let pastesOverSelection = !hasOtherRanges(state) && area.rowCount * area.columnCount > 1;
  let oneCellLanding: CellBlock = {
    ...inView,
    rows: [
      {
        base: rowBase,
        first: rowFirst,
        count: 1,
      },
    ],
    otherColumn: inView.oneColumn,
  };
  let landing = {
    selected: pastesOverSelection && paste.landsOnce !== true ? inView : oneCellLanding,
  };
  let queueLandingEdit = (rowCount: number | null, edit: PasteEdit, ifQueued: IfQueued): PageTransition => {
    let rowsToLandIn = landingRowsSkippingFilters(state, workbook, state.sheetId, topLeft.rowId, rowCount);
    return rowsToLandIn === null
      ? noticeRowsOutOfViewInTheWay(state, actOfEdit(edit))
      : queueEditOf(
          {
            ...edit,
            ...rowsToLandIn,
          },
          ifQueued,
        );
  };
  let isOfAllRows = area.rowCount === workbook.linesOf(state.sheetId)?.rows.count;
  let landingAllRows = isOfAllRows
    ? {
        ...landing,
        selected: {
          ...landing.selected,
          rows: oneCellLanding.rows,
        },
      }
    : landing;
  let cutBlock = cutBlockToMove(state, workbook, cutToken);
  if (cutBlock !== null && cutToken !== null) {
    let cellsToMove = unbrokenCellBlockOfCorners(state, workbook, cutBlock);
    if (cellsToMove === null) return noticeRowsOutOfViewInTheWay(state, 'moveCells');
    return queueLandingEdit(
      rowCountOfRuns(cellsToMove.rows),
      {
        kind: 'moveCells',
        cells: cellsToMove,
        toSheetId: state.sheetId,
        toTopLeft: cellRefOf(topLeft),
      },
      {
        ...IF_QUEUED_DEFAULTS,
        select: 'placeChanged',
        done: 'moved',
        movesCut: {
          token: cutToken,
          toTopLeft: topLeft,
        },
      },
    );
  }
  let { cutJustMoved } = state;
  if (cutJustMoved !== null && cutJustMoved.token === cutToken && isSameCell(cutJustMoved.toTopLeft, topLeft)) return withNoEffects(state);
  if (paste.valuesOfCopiedCells !== null)
    return queueLandingEdit(
      null,
      {
        kind: 'pasteValuesOfCopiedCells',
        ...landing,
        copiedCellsAsText: paste.valuesOfCopiedCells.copiedCellsAsAnswered,
        values: paste.valuesOfCopiedCells.values,
      },
      {
        ...IF_QUEUED_DEFAULTS,
        select: 'placeChanged',
        done: 'pasted',
        pasteOfTextInstead: {
          ...paste,
          valuesOfCopiedCells: null,
          landsOnce: true,
        },
      },
    );
  let ownRowOrder = paste.areFormulasLeftOut ? ownRowOrderOfSheet(workbook, state.sheetId) : null;
  if (ownRowOrder !== null) {
    let firstRow = ownRowOrder.seen.indexOf(topLeft.rowId) ?? area.topRowIndex;
    let pastedRowCount = parseTsvCells(text).length;
    let rowAfter = pastedRowCount === 1 && landing.selected === inView ? area.topRowIndex + area.rowCount : firstRow + pastedRowCount;
    if (firstRow < ownRowOrder.firstIndex + ownRowOrder.count && ownRowOrder.firstIndex < rowAfter)
      return withNoEffects({
        ...state,
        lastDone: null,
        notice: {
          kind: 'ownSortInTheWay',
          act: 'paste',
        },
      });
  }
  if (copiedCellsAsText !== null)
    return queueLandingEdit(
      null,
      {
        kind: 'pasteCopiedCells',
        ...landing,
        copiedCellsAsText,
        copiedColors: 'arePasted',
      },
      {
        ...IF_QUEUED_DEFAULTS,
        select: 'placeChanged',
        done: 'pasted',
        pasteOfTextInstead: {
          ...paste,
          copiedCellsAsText: null,
          landsOnce: true,
        },
        ...(filteredRowRunsIn(state, workbook, area).length > 0 && {
          isMadeAroundRowsOutOfView: true,
        }),
      },
    );
  if (ofAnotherProgram !== null)
    return queueLandingEdit(
      ofAnotherProgram.rows.length,
      {
        kind: 'pasteCellsOfAnotherProgram',
        ...landingAllRows,
        ...ofAnotherProgram,
      },
      {
        ...IF_QUEUED_DEFAULTS,
        select: 'placeChanged',
        done: 'pasted',
        pasteOfTextInstead: {
          ...paste,
          ofAnotherProgram: plainerPasteOfAnotherProgram(ofAnotherProgram),
          ...(!hasPastedRichText(ofAnotherProgram.rows) && {
            landsOnce: true,
          }),
        },
      },
    );
  if (isOverByteLimit(text, workbook.mostBytesOfATableToImport()))
    return withNoEffects({
      ...state,
      notice: {
        kind: 'editRefused',
        why: 'tableTooLarge',
        asked: 'paste',
      },
    });
  let markdownTables = paste.markdownIs === undefined ? null : readMarkdownTables(text);
  let rows: string[][] = (markdownTables?.map(({ cells }: { cells: string[] }) => cells) ?? parseTsvCells(text)).map(
    (row: string[]) => row.map((cellText: string) => sanitizeTypedCellInput(isPlainText ? unescapeClipboardText(cellText) : cellText)),
  );
  if (rows.length === 0) return withNoEffects(state);
  let isOfAllColumns = area.columnCount === workbook.linesOf(state.sheetId)?.columns.count;
  let isRepeatedOverSelection =
    pastesOverSelection &&
    ((rows.length === 1 && area.rowCount > 1 && !isOfAllRows) ||
      (rows.every((row: string[]) => row.length <= 1) && area.columnCount > 1 && !isOfAllColumns));
  let rowsOfTables = rows.map((row: string[], index: number) => (markdownTables?.[index]?.isOfTable === true ? row : []));
  let isMarkdownRead = paste.markdownIs === 'read';
  let marked: MarkedText[] | null =
    markdownTables === null || isRepeatedOverSelection || isMarkReadingTooMuch(rowsOfTables)
      ? []
      : marksOfPastedTexts(workbook, topLeft, rowsOfTables, isMarkdownRead);
  let editsOfMarks = marked !== null && isMarkdownRead ? editsOfPastedMarks(state, workbook, marked) : [];
  let isPastedAsTyped = marked === null || editsOfMarks === null;
  let textsWithoutSigns = new Map<string, string>(marked?.map((cell: MarkedText): [string, string] => [`${cell.down} ${cell.across}`, cell.text]));
  let edit: Extract<Edit, { kind: 'pasteRowsOfTexts' }> = {
    kind: 'pasteRowsOfTexts',
    ...landingAllRows,
    rows: isPastedAsTyped
      ? rows
      : rows.map(
          (row: string[], down: number) =>
            row.map((cellText: string, across: number) => textsWithoutSigns.get(`${down} ${across}`) ?? cellText),
        ),
    pastedTextIs,
    ...localeOfTextsOption(workbook, paste.localeOfTexts),
  };
  let ifQueued: IfQueued = {
    ...IF_QUEUED_DEFAULTS,
    select: 'placeChanged',
    done: 'pasted',
  };
  if (isPastedAsTyped || editsOfMarks!.length === 0) return queueLandingEdit(rows.length, edit, ifQueued);
  let editsThatGoAlong = editsOfMarks!.map(markEditByPage);
  let pasteQueued = queueLandingEdit(rows.length, edit, {
    ...ifQueued,
    select: areaOfPastedTexts(workbook, edit) ?? 'placeChanged',
  });
  let effects = pasteQueued.effects.map(
    (effect: PageEffect): PageEffect =>
      effect.kind === 'queueEdit'
        ? {
            ...effect,
            editsThatGoAlong,
          }
        : effect,
  );
  return {
    ...pasteQueued,
    effects,
  };
}
export function isMarkReadingTooMuch(rows: readonly string[][]): boolean {
  let work: number = 0;
  for (let row of rows)
    for (let text of row) {
      let signCount = text.match(MARK_SIGNS_PATTERN)?.length ?? 0;
      work += Math.min(signCount / 2, MAX_TYPED_MARKS) * text.length;
      if (work > MOST_MARK_READING_WORK) return true;
    }
  return false;
}
export function marksOfPastedTexts(reads: WorkbookReads, topLeft: CellId, rows: readonly string[][], isMarkdownRead: boolean): MarkedText[] | null {
  let position = reads.positionOfCell(topLeft);
  if (position === null) return [];
  let marked: MarkedText[] = [];
  let mixedCount: number = 0;
  for (let [down, row] of rows.entries())
    for (let [across, text] of row.entries()) {
      let cellId = reads.cellIdAt(topLeft.sheetId, position.rowIndex + down, position.columnIndex + across);
      if (cellId !== null && !doesCellReadMarkSigns(reads, cellId)) continue;
      let marksOfCell = cellId === null ? [] : fontMarksOfStyle(reads.formatOf(cellId));
      let looks = plainLooks(text, marksOfCell);
      let read = readTypedMarks(text, looks, 0, text.length);
      if (read === null) continue;
      mixedCount += isOfOneLook(read) ? 0 : 1;
      if (isMarkdownRead && (cellId === null || mixedCount > MOST_MARKED_PASTED_CELLS)) return null;
      marked.push({
        down,
        across,
        cellId,
        text: read.text,
        looks: read.looks,
      });
    }
  return marked;
}
export function editsOfPastedMarks(state: PageState, reads: WorkbookReads, marked: readonly MarkedText[]): Edit[] | null {
  let cellsInSheet = marked.flatMap(
    ({ cellId, ...rest }: MarkedText): MarkedTextInSheet[] =>
      cellId === null
        ? []
        : [
            {
              cellId,
              ...rest,
            },
          ],
  );
  let mixedCells = cellsInSheet.filter((cell: MarkedTextInSheet) => !isOfOneLook(cell));
  if (cellsInSheet.length < marked.length || mixedCells.length > MOST_MARKED_PASTED_CELLS) return null;
  let runsByColumnAndMarks = new Map<string, [MarkedTextInSheet, MarkedTextInSheet][]>();
  for (let cell of cellsInSheet.filter(isOfOneLook)) {
    let key = `${cell.cellId.columnId} ${cell.looks.stretches[0]?.marks.join(' ')}`;
    let runs = runsByColumnAndMarks.get(key) ?? [];
    let lastRun = runs.at(-1);
    if (lastRun?.[1].down === cell.down - 1) lastRun[1] = cell;
    else runs.push([cell, cell]);
    runsByColumnAndMarks.set(key, runs);
  }
  let edits = [
    ...[...runsByColumnAndMarks.values()].flatMap((runs: [MarkedTextInSheet, MarkedTextInSheet][]): Edit[] => {
      let [firstBlock, ...otherBlocks] = runs.flatMap(
        ([first, last]: [MarkedTextInSheet, MarkedTextInSheet]) => shownCellBlockOfCorners(state, reads, areaRefBetween(first.cellId, last.cellId)) ?? [],
      );
      let marks = runs[0]?.[0].looks.stretches[0]?.marks.filter((mark: FontMark) => mark !== 'underline') ?? [];
      if (firstBlock === undefined) return [];
      let blockRows = [...firstBlock.rows, ...otherBlocks.flatMap((block: CellBlock) => block.rows)];
      let font = Object.fromEntries(marks.map((mark: FontMark): [FontMark, boolean] => [mark, true]));
      return [
        {
          kind: 'formatCells',
          cells: {
            ...firstBlock,
            rows: blockRows,
          },
          format: {
            font,
          },
        },
      ];
    }),
    ...mixedCells.map(({ cellId, text, looks }: MarkedTextInSheet) => enterEntryEdit(cellId, richTextFromLooks(text, looks))),
  ];
  return edits.length > MOST_MARKED_PASTED_CELLS ? null : edits;
}
export function areaOfPastedTexts(workbook: WorkbookReads, edit: Edit): CellArea | null {
  if (edit.kind !== 'pasteRowsOfTexts') return null;
  let { selected, rows } = edit;
  let { sheetId } = selected;
  let [{ base: rowBase, first: rowFirst }] = selected.rows;
  let position = workbook.positionOfCell({
    sheetId,
    rowId: `${rowBase}.${rowFirst}`,
    columnId: selected.oneColumn,
  });
  let sheet = workbook.listSheets().find((sheetListed: SheetSummary) => sheetListed.sheetId === sheetId);
  let hasText = rows.some((row: string[]) => row.some((text: string) => text !== ''));
  if (position === null || sheet === undefined || !hasText) return null;
  let columnCount = rows.reduce((most: number, row: string[]) => Math.max(most, row.length), 0);
  return {
    topRowIndex: position.rowIndex,
    leftColumnIndex: position.columnIndex,
    rowCount: Math.min(rows.length, sheet.rowCount - position.rowIndex),
    columnCount: Math.min(columnCount, sheet.columnCount - position.columnIndex),
  };
}
export function copyChartNodesThen(
  state: PageState,
  sources: string[],
  copiedFor: ChartNodesCopiedFor,
  then: (copiedNodes: ChartNodeCopies) => PageTransition,
): PageTransition {
  if (new Set<string>(sources).size < sources.length) return then('never');
  return sources.length === 0
    ? then([])
    : {
        state,
        effects: [
          {
            kind: 'copyChartNodes',
            sources,
            copiedFor,
          },
        ],
      };
}
export function chartPastePosition(state: PageState, workbook: ReadsWithTextMeasurer) {
  let { placementSelected } = state;
  let placement = placementSelected === null ? null : placementById(state, workbook, placementSelected);
  if (placement === null) {
    let landing = pasteTopLeft(state, workbook);
    let position = landing === null ? null : workbook.positionOfCell(landing.topLeft);
    return position === null
      ? null
      : {
          ...position,
          offsetFromAnchorCell: {
            xInPixels: 0,
            yInPixels: 0,
          },
        };
  }
  let { rowEdges, columnEdges } = layoutOfView(state, workbook);
  let offsetAnchor = (edges: LineSizes, anchor: ScrollPosition) =>
    scrollPositionAtPixel(edges, pixelOfScrollPosition(edges, anchor) + CHART_PASTE_OFFSET);
  return placementAnchorOf(offsetAnchor(columnEdges, columnAnchorOf(placement)), offsetAnchor(rowEdges, rowAnchorOf(placement)));
}
export function finishPasteOfChart(
  state: PageState,
  { chart, toSheetId, topLeft, offsetFromAnchorCell }: PasteOfChart,
  copiedNodes: ChartNodeCopies,
): PageTransition {
  if (typeof copiedNodes === 'string')
    return {
      state: refusePasteOfChart(state, copiedNodes === 'notNow' ? 'chartsNotCopied' : 'chartNeverCopied'),
      effects: [
        {
          kind: 'dropWhatIsHeld',
        },
      ],
    };
  return queueEdit(
    state,
    {
      kind: 'copyPlacedView',
      ...chart,
      toSheetId,
      topLeft,
      offsetFromAnchorCell,
      copiedWidgetNodes: [...copiedNodes],
    },
    {
      ...IF_QUEUED_DEFAULTS,
      select: 'placeChanged',
      done: 'pasted',
      dropsWhatIsHeld: 'always',
    },
  );
}
export function pasteChart(state: PageState, workbook: ReadsWithTextMeasurer, chart: ChartOnClipboard): PageTransition {
  let position = state.mode.kind === 'navigating' ? chartPastePosition(state, workbook) : null;
  let anchorCell = position === null ? null : workbook.cellIdAt(state.sheetId, position.rowIndex, position.columnIndex);
  if (position === null || anchorCell === null) return withNoEffects(state);
  let placement = chart === 'ofAnotherSheet' ? null : placementById(chart, workbook, chart.placementId);
  if (chart === 'ofAnotherSheet' || placement === null) return withNoEffects(refusePasteOfChart(state, 'chartNotInWorkbook'));
  let paste: PasteOfChart = {
    kind: 'pasteOfChart',
    chart,
    toSheetId: state.sheetId,
    topLeft: cellRefOf(anchorCell),
    offsetFromAnchorCell: position.offsetFromAnchorCell,
  };
  let stateWithoutLastDone: PageState = {
    ...state,
    lastDone: null,
  };
  return copyChartNodesThen(
    stateWithoutLastDone,
    embedRefsOfView(workbook.viewAsItStands(placement.viewId)),
    paste,
    (copiedNodes: ChartNodeCopies) => finishPasteOfChart(stateWithoutLastDone, paste, copiedNodes),
  );
}
export function selectPastedChart(state: PageState, workbook: ReadsWithTextMeasurer, placementId: string): PageState | null {
  let placement = placementById(state, workbook, placementId);
  if (placement === null) return null;
  return {
    ...scrollToPlacedView(selectPlacement(state, placementId), workbook, placement),
    lastDone: {
      what: 'chartPasted',
    },
  };
}
export const localeOfTextsOption = (workbook: WorkbookReads, locale: string | null): { localeOfTexts?: string } =>
  locale !== null && workbook.locales()?.includes(locale) === true
    ? {
        localeOfTexts: locale,
      }
    : {};
export const MOST_MARKED_PASTED_CELLS = 30;
export const MOST_MARK_READING_WORK = 5e6;
export const MARK_SIGNS_PATTERN = new RegExp(`[${MARK_SIGN_CHARS}]`, 'g');
export const isOfOneLook = ({ looks }: Pick<MarkedText, 'looks'>): boolean => looks.stretches.length === 1;
export const CHART_PASTE_OFFSET = 28;
export const refusePasteOfChart = (state: PageState, why: ChartPasteRefusal): PageState => ({
  ...state,
  lastDone: null,
  notice: {
    kind: 'editRefused',
    why,
    asked: 'paste',
  },
});
/** Where a paste lands: the cells in view from the selection's first cell, and that first cell. */
export interface PasteTopLeft {
  inView: CellBlock;
  topLeft: CellId;
}
/** The edits a paste or a move makes, that may land past rows filtered out of view. */
export type PasteEdit = Extract<
  Edit,
  { kind: 'moveCells' | 'pasteValuesOfCopiedCells' | 'pasteCopiedCells' | 'pasteCellsOfAnotherProgram' | 'pasteRowsOfTexts' }
>;
/** A pasted text read for the marks typed in it (`**bold**`), at its place among the pasted rows. */
export interface MarkedText {
  down: number;
  across: number;
  cellId: CellId | null;
  text: string;
  looks: EntryLooks;
}
/** A pasted text read for its marks, landing in a cell of the sheet. */
export interface MarkedTextInSheet extends MarkedText {
  cellId: CellId;
}
/** The widget nodes of charts copied, or why they were not: not now (try again), or never. */
export type ChartNodeCopies = readonly CopiedWidgetNode[] | 'notNow' | 'never';
/** A chart read from the clipboard, or word that it was copied from another sheet's page. */
export type ChartOnClipboard = NonNullable<ReturnType<typeof decodeChartFromClipboard>>;
/** A chart pasted, waiting on its widget nodes being copied. */
export type PasteOfChart = Extract<ChartNodesCopiedFor, { kind: 'pasteOfChart' }>;
/** Why a chart is not pasted. */
export type ChartPasteRefusal = 'chartsNotCopied' | 'chartNeverCopied' | 'chartNotInWorkbook';
/** The notice that a paste is refused. */
export interface PasteRefusedNotice {
  kind: 'editRefused';
  why: ChartPasteRefusal | 'tableTooLarge';
  asked: 'paste';
}
/** What the page last did when it copied or cut cells, and which. */
export interface CopiedOrCutDone {
  what: 'copied' | 'copiedWithoutRowsOutOfView' | 'cut';
  cells: ReturnType<typeof areaToA1AsStored>;
}
/** What the page last did when a chart it pasted is selected. */
export interface ChartPastedDone {
  what: 'chartPasted';
}
