import * as React from 'react';
import { translateMessage, MESSAGE_LOCALE } from '../i18n/messages.ts';
import { createInitialPageState } from '../state/initial-state.ts';
import { clampScrollOfView } from '../grid/layout.ts';
import { showSheet } from '../state/sheet-tabs.ts';
import { pageViewOf } from '../view/page-view.ts';
import { loadSheetsEngineOnce } from '../engine/loader.ts';
import { createWorkbookReader, newIdCode } from '../engine/core-reads.ts';
import { importPreviewOnGrid, NOTHING_DRAWN_ANYWAY } from './bring-in.ts';
import { importPlanSoFar, isImportPlanComing } from './import-review.ts';
import { importPictureLineCount } from './picture-lines-and-focus.ts';
import { gridlinesDataAttribute, PlainGridDrawing } from '../grid/grid-drawing.tsx';
import { zoomedStyle } from '../grid/zoom.ts';
import { joinImportWordsWithCommas, moreImportColumnsWords } from './csv-file.tsx';
import { MAX_PREVIEW_COLUMNS } from './preview.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { Edit, SheetId } from '@open-artifact/sheets-core';
import type { ImportOfAFile, PageState } from '../state/initial-state.ts';
import type { ReadsWithTextMeasurer, TextMeasurer } from '../state/controller.ts';
import type { GridOfPage } from '../view/page-view.ts';
import type { ImportTextOnRow } from './csv-file.tsx';
import type { ImportColumnQuestion } from './settings-to-check.ts';
/** A workbook made to draw the picture of an import in, and the sheet of it that holds the picture. */
export interface FilledImportPicture {
  reads: ReadsWithTextMeasurer;
  sheetId: SheetId;
}
/** The room the picture of an import is drawn in. */
export type ImportPictureSize = Pick<PageState, 'gridWidth' | 'gridHeight' | 'density'>;
/** How far the picture of an import is scrolled. */
export type ScrollOfPicture = Pick<PageState, 'scrollTop' | 'scrollLeft'>;
/** Lines and columns the plan leaves out that are drawn all the same. */
export interface LinesAndColumnsUnfolded {
  lines: number[];
  columns: number[];
}
/** The last row and column of the table, by number, in the picture. */
export interface EndOfImportTable {
  row: number;
  column: number;
}
/** A finger on the picture, and where it last was. */
export interface FingerOnPicture {
  id: number;
  x: number;
  y: number;
}
/** A cell of the picture that would stay text though its column reads as something else. */
export interface CellThatStaysText extends ImportTextOnRow {
  columnDrawn: number;
}
/** The picture as the plan was before the agent's plan came in, and how many columns of the new plan are shown over it. */
export interface PlayedImportPicture {
  plain: GridOfPage;
  columnsRevealed: number;
}
/** The picture drawn of an import, with what it was drawn of. */
interface DrawnImportPicture {
  of: ImportOfAFile;
  cellsThatStayText: CellThatStaysText[];
  unfolded: LinesAndColumnsUnfolded;
  picture: GridOfPage;
  plain: GridOfPage | null;
}
/** A workbook filled with the plan as it was, for the picture to play from. */
interface FilledToPlayFrom {
  /** The plan and widths the workbook was filled for. */
  of: string;
  filled: FilledImportPicture;
}
interface ImportPictureWanted {
  open: ImportOfAFile | null;
  locale: string;
  size: ImportPictureSize;
  zoom: number;
  unfolded: LinesAndColumnsUnfolded;
  /** Whether the agent's plan is being shown coming in over the plan before it. */
  isPlayed: boolean;
}
interface ImportShimmerProps {
  picture: GridOfPage;
  endOfTable: EndOfImportTable;
  columnsRevealed: number;
  isGone: boolean;
  zoom: number;
}
interface ImportProposalOverlayProps {
  picture: GridOfPage | null;
  columnInHand: number | null;
  columnsLit: number[];
  cellsThatStayText?: CellThatStaysText[];
  rowsUnfolded: number[];
  columnsUnfolded: number[];
  recordsDrawn: number;
  recordsNotDrawn: number;
  columnsNotDrawn: number;
  zoom: number;
  endOfTable: EndOfImportTable | null;
  played?: PlayedImportPicture | null;
}
export function fingerMoveFrom(finger: FingerOnPicture | null, touches: Touch[]) {
  let touch = touches.find(({ identifier }) => identifier === finger?.id);
  if (finger === null || touch === undefined) return null;
  return {
    right: finger.x - touch.clientX,
    down: finger.y - touch.clientY,
    finger: {
      id: finger.id,
      x: touch.clientX,
      y: touch.clientY,
    },
  };
}
export function importQuestionHeading(about: ImportColumnQuestion['about'], example: string | null, names: string[]) {
  if (about === 'date' && example !== null)
    return translateMessage(
      {
        defaultMessage: 'Which date is {text}?',
        id: 'qyIa4M7BE7',
      },
      {
        text: example,
      },
    );
  if (about === 'number' && example !== null)
    return translateMessage(
      {
        defaultMessage: 'Which number is {text}?',
        id: 'qeaKXe/8nl',
      },
      {
        text: example,
      },
    );
  return translateMessage(
    {
      defaultMessage: 'How should {names} be read?',
      id: '6MIRbUR0Ka',
    },
    {
      names: new Intl.ListFormat(MESSAGE_LOCALE).format(names.map(quotedName)),
    },
  );
}
export function canScrollAroundPicture(target: EventTarget | null, deltaY: number) {
  let scroller = target instanceof Element ? target.closest(`[${SCROLLS_AROUND_PICTURE_ATTRIBUTE}]`) : null;
  if (scroller === null) return false;
  return deltaY > 0 ? scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1 : scroller.scrollTop > 0;
}
export function cellsThatStayTextIn(reads: WorkbookReads, sheetId: SheetId, rowsToScan: number) {
  let cells: CellThatStaysText[] = [];
  for (let columnIndex = 0; ; columnIndex += 1) {
    let headingCellId = reads.cellIdAt(sheetId, 0, columnIndex);
    let firstCellId = reads.cellIdAt(sheetId, 1, columnIndex);
    if (headingCellId === null || firstCellId === null || reads.cellOf(headingCellId) === null) return cells;
    let { kind: numberFormatKind } = reads.formatOf(firstCellId).numberFormat;
    if (numberFormatKind === 'text') continue;
    let textCells: CellThatStaysText[] = [];
    let hasTrueOrFalse = false;
    for (let rowIndex = 1; rowIndex < rowsToScan; rowIndex += 1) {
      let cellId = reads.cellIdAt(sheetId, rowIndex, columnIndex);
      if (cellId === null) break;
      let cellInput = reads.cellOf(cellId)?.input;
      if (cellInput?.kind === 'text')
        textCells.push({
          rowNumber: rowIndex + 1,
          columnDrawn: columnIndex,
          text: cellInput.value,
        });
      if (numberFormatKind === 'general' && cellInput !== undefined) {
        let cellFormatKind = reads.formatOf(cellId).numberFormat.kind;
        if (cellFormatKind !== 'text') numberFormatKind = cellFormatKind;
      }
      if (cellInput?.kind === 'boolean') hasTrueOrFalse = true;
    }
    if (numberFormatKind !== 'general' || hasTrueOrFalse) cells.push(...textCells);
  }
}
export function importPictureView({ reads, sheetId }: FilledImportPicture, size: ImportPictureSize, scroll: ScrollOfPicture) {
  let pageState = createInitialPageState(reads, null);
  return pageState === null
    ? null
    : clampScrollOfView(
        {
          ...showSheet(pageState, reads, sheetId),
          ...size,
          ...scroll,
        },
        reads,
      );
}
export function importPictureColumnWidths(filled: FilledImportPicture, size: ImportPictureSize) {
  let view = importPictureView(
    filled,
    {
      ...size,
      gridWidth: WIDE_PICTURE_WIDTH,
      gridHeight: PICTURE_COLUMN_MEASURE_HEIGHT,
    },
    TOP_LEFT_SCROLL,
  );
  return view === null ? [] : pageViewOf(view, filled.reads, null).grid.columnHeaders.map(({ width }) => width);
}
export async function fillImportPictureCore(
  open: ImportOfAFile,
  locale: string,
  unfolded: LinesAndColumnsUnfolded,
  isStillWanted: () => boolean,
  columnWidths: number[] | null = null,
): Promise<FilledImportPicture | 'notWanted' | null> {
  let engine = await loadSheetsEngineOnce();
  if (engine.kind !== 'loaded') return null;
  let core = await engine.newCore();
  if (!isStillWanted()) return 'notWanted';
  let reader = createWorkbookReader(core, engine.utilities);
  let readEverything = (): ReadsWithTextMeasurer => ({
    ...reader.readEverything(),
    ...NO_TEXT_MEASURES,
  });
  let queueEdit = (edit: Edit) =>
    core.answer({
      kind: 'queueEdit',
      opId: crypto.randomUUID(),
      newIdCode: newIdCode(),
      edit,
    });
  queueEdit({
    kind: 'setLocale',
    locale,
  });
  let mostRecords = columnWidths !== null ? MIN_IMPORT_COLUMN_WIDTH : importColumnWidthOf(open);
  let importEdit = importPreviewOnGrid(open, readEverything(), mostRecords, unfolded, columnWidths === null ? null : 0);
  let answer = importEdit === null ? null : queueEdit(importEdit);
  if (answer?.kind !== 'editQueued' || answer.placeChanged === null) return null;
  let { sheetId } = answer.placeChanged;
  let reads = columnWidths === null ? null : readEverything();
  for (let [columnIndex, width] of (columnWidths ?? []).entries()) {
    let columnId = reads?.cellIdAt(sheetId, 0, columnIndex)?.columnId;
    if (columnId !== undefined)
      queueEdit({
        kind: 'setColumnWidths',
        sheetId,
        oneColumn: columnId,
        otherColumn: columnId,
        widthInPixels: width,
      });
  }
  return {
    reads: readEverything(),
    sheetId,
  };
}
export function useImportPicture({ open, locale, size, zoom, unfolded, isPlayed }: ImportPictureWanted) {
  let [openShown, setOpenShown] = React.useState(open);
  if (!isSameImportOpen(open, openShown)) setOpenShown(open);
  const [drawnPicture, setDrawnPicture] = React.useState<DrawnImportPicture | null>(null);
  /** The import whose picture could not be drawn. */
  let [cannotDraw, setCannotDraw] = React.useState<ImportOfAFile | null>(null);
  let filledRef = React.useRef<FilledImportPicture | null>(null);
  let playedRef = React.useRef<FilledToPlayFrom | null>(null);
  let isPlayedRef = React.useRef(isPlayed);
  React.useEffect(() => {
    isPlayedRef.current = isPlayed;
    if (!isPlayed) playedRef.current = null;
  }, [isPlayed]);
  let scrollRef = React.useRef(TOP_LEFT_SCROLL);
  let mostScrollTopRef = React.useRef(0);
  let sizeRef = React.useRef(size);
  let zoomRef = React.useRef(zoom);
  React.useEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);
  let plainPictureAt = React.useCallback((scroll: ScrollOfPicture) => {
    let played = playedRef.current?.filled ?? null;
    let view =
      played === null
        ? null
        : importPictureView(played, sizeRef.current, {
            scrollTop: scroll.scrollTop,
            scrollLeft: scroll.scrollLeft,
          });
    return played === null || view === null ? null : pageViewOf(view, played.reads, null).grid;
  }, []);
  React.useEffect(() => {
    if (openShown === null) return;
    let run = {
      isStill: true,
    };
    let isStill = () => run.isStill;
    (async (): Promise<void> => {
      try {
        let filled = await fillImportPictureCore(openShown, locale, unfolded, () => run.isStill);
        if (!run.isStill || filled === 'notWanted') return;
        let view = filled === null ? null : importPictureView(filled, sizeRef.current, scrollRef.current);
        if (filled === null || view === null) return setCannotDraw(openShown);
        if (isPlayedRef.current) {
          let columnWidths = importPictureColumnWidths(filled, sizeRef.current);
          let { headerLine, linesLeftOut } = importPlanSoFar(openShown).plan;
          let filledFor = JSON.stringify([headerLine, linesLeftOut, unfolded, columnWidths]);
          if (playedRef.current?.of !== filledFor) {
            let filledToPlayFrom = await fillImportPictureCore(openShown, locale, unfolded, isStill, columnWidths);
            if (!isStill() || filledToPlayFrom === 'notWanted') return;
            playedRef.current =
              filledToPlayFrom === null
                ? null
                : {
                    of: filledFor,
                    filled: filledToPlayFrom,
                  };
          }
        }
        filledRef.current = filled;
        setDrawnPicture({
          of: openShown,
          cellsThatStayText: cellsThatStayTextIn(
            filled.reads,
            filled.sheetId,
            importPictureLineCount(openShown, importColumnWidthOf(openShown), unfolded.lines.length),
          ),
          unfolded,
          picture: pageViewOf(view, filled.reads, null).grid,
          plain: plainPictureAt(view),
        });
        setCannotDraw(null);
      } catch {
        if (run.isStill) setCannotDraw(openShown);
      }
    })();
    return () => {
      run.isStill = false;
    };
  }, [openShown, locale, unfolded, plainPictureAt]);
  let endAtRef = React.useRef<EndOfImportTable>(END_AT_INFINITY);
  let redraw = React.useCallback(() => {
    let filled = filledRef.current;
    if (filled === null) return;
    let pictureAt = (scroll: ScrollOfPicture, pictureSize: ImportPictureSize) => {
      let view = importPictureView(filled, pictureSize, scroll);
      if (view === null) return null;
      if (pictureSize === sizeRef.current)
        scrollRef.current = {
          scrollTop: view.scrollTop,
          scrollLeft: view.scrollLeft,
        };
      return pageViewOf(view, filled.reads, null).grid;
    };
    let picture = pictureAt(scrollRef.current, sizeRef.current);
    if (picture === null) return;
    let rowHeight = picture.rowsDrawn.find(({ rowNumber }) => rowNumber > 1)?.height ?? 0;
    let mostScrollTop = Math.max(0, endAtRef.current.row * rowHeight - picture.body.height + PICTURE_END_SLACK_PX);
    mostScrollTopRef.current = mostScrollTop;
    let { scrollTop, scrollLeft } = scrollRef.current;
    let endColumn = (
      scrollLeft === 0
        ? null
        : pictureAt(TOP_LEFT_SCROLL, {
            ...sizeRef.current,
            gridWidth: WIDE_PICTURE_WIDTH,
          })
    )?.columnHeaders.find(({ columnNumber }) => columnNumber === endAtRef.current.column);
    let mostScrollLeft =
      endColumn === undefined ? scrollLeft : Math.max(0, endColumn.left + endColumn.width - picture.body.width + PICTURE_END_SLACK_PX);
    let clampedPicture =
      scrollTop > mostScrollTop || scrollLeft > mostScrollLeft
        ? pictureAt(
            {
              scrollTop: Math.min(scrollTop, mostScrollTop),
              scrollLeft: Math.min(scrollLeft, mostScrollLeft),
            },
            sizeRef.current,
          )
        : picture;
    if (clampedPicture === null) return;
    let plain = plainPictureAt(scrollRef.current);
    setDrawnPicture(
      (drawn) =>
        drawn === null
          ? null
          : {
              ...drawn,
              picture: clampedPicture,
              plain,
            },
    );
  }, [plainPictureAt]);
  let endAt = React.useCallback(
    (end: EndOfImportTable) => {
      endAtRef.current = end;
      redraw();
    },
    [redraw],
  );
  React.useEffect(() => {
    sizeRef.current = size;
    redraw();
  }, [size, redraw]);
  let showColumn = React.useCallback(
    (columnIndex: number) => {
      let filled = filledRef.current;
      let view =
        filled === null
          ? null
          : importPictureView(
              filled,
              {
                ...sizeRef.current,
                gridWidth: WIDE_PICTURE_WIDTH,
              },
              TOP_LEFT_SCROLL,
            );
      if (filled === null || view === null) return;
      let { columnHeaders, body } = pageViewOf(view, filled.reads, null).grid;
      let columnHeader = columnHeaders.find(({ columnNumber }) => columnNumber - 1 === columnIndex);
      if (columnHeader === undefined) return;
      let bodyWidth = sizeRef.current.gridWidth - body.left;
      let { scrollLeft } = scrollRef.current;
      let leastScrollLeft = columnHeader.left + columnHeader.width - bodyWidth;
      scrollRef.current = {
        ...scrollRef.current,
        scrollLeft: Math.max(Math.min(scrollLeft, columnHeader.left), leastScrollLeft, 0),
      };
      redraw();
    },
    [redraw],
  );
  let scrollTopBeforeShowRowRef = React.useRef<number | null>(null);
  let showRow = React.useCallback(
    (rowNumber: number) => {
      let filled = filledRef.current;
      let view = filled === null ? null : importPictureView(filled, sizeRef.current, TOP_LEFT_SCROLL);
      if (filled === null || view === null) return;
      let { rowsDrawn } = pageViewOf(view, filled.reads, null).grid;
      let rowHeight = rowsDrawn.find((row) => row.rowNumber === 2)?.height ?? 0;
      scrollTopBeforeShowRowRef.current ??= scrollRef.current.scrollTop;
      scrollRef.current = {
        ...scrollRef.current,
        scrollTop: Math.max(0, (rowNumber - 1 - ROWS_ABOVE_SHOWN_ROW) * rowHeight),
      };
      redraw();
    },
    [redraw],
  );
  let showRowNoLonger = React.useCallback(() => {
    if (scrollTopBeforeShowRowRef.current === null) return;
    scrollRef.current = {
      ...scrollRef.current,
      scrollTop: scrollTopBeforeShowRowRef.current,
    };
    scrollTopBeforeShowRowRef.current = null;
    redraw();
  }, [redraw]);
  let pictureFromTheTop = React.useCallback((pictureSize: ImportPictureSize) => {
    let filled = filledRef.current;
    let view = filled === null ? null : importPictureView(filled, pictureSize, TOP_LEFT_SCROLL);
    return filled === null || view === null ? null : pageViewOf(view, filled.reads, null).grid;
  }, []);
  let table = openShown?.table;
  let isTableNotDrawable = table !== undefined && cannotDraw?.table === table;
  React.useEffect(() => {
    if (table === undefined || isTableNotDrawable) return;
    let frame = 0;
    let scrollBy = (right: number, down: number) => {
      let { activeElement } = document;
      if (activeElement instanceof HTMLInputElement && activeElement.closest(IMPORT_HEADINGS_SELECTOR) !== null && document.hasFocus())
        activeElement.parentElement?.querySelector('button')?.focus({
          preventScroll: true,
        });
      scrollTopBeforeShowRowRef.current = null;
      scrollRef.current = {
        scrollTop: scrollRef.current.scrollTop + down,
        scrollLeft: scrollRef.current.scrollLeft + right,
      };
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(redraw);
    };
    let isForPageToScroll = (target: EventTarget | null, right: number, down: number) =>
      Math.abs(down) > Math.abs(right) &&
      (down > 0 ? scrollRef.current.scrollTop >= mostScrollTopRef.current : scrollRef.current.scrollTop <= 0) &&
      canScrollAroundPicture(target, down);
    let onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      if (!isInPictureBox(event.target)) return;
      if (isForPageToScroll(event.target, event.deltaX, event.deltaY)) return;
      event.preventDefault();
      let scale = event.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? 1 / zoomRef.current : LINE_SCROLL_PX;
      scrollBy(event.deltaX * scale, event.deltaY * scale);
    };
    let finger: FingerOnPicture | null = null;
    let onTouchStart = ({ touches, target }: TouchEvent) => {
      let isOutsideCells = !isInPictureBox(target) || (target instanceof Element && target.closest(IMPORT_HEADINGS_SELECTOR) !== null);
      finger = singleFingerOf([...touches], isOutsideCells);
    };
    let onTouchMove = (event: TouchEvent) => {
      let move = fingerMoveFrom(finger, [...event.touches]);
      if (move === null) return;
      if (isForPageToScroll(event.target, move.right, move.down)) {
        finger = null;
        return;
      }
      event.preventDefault();
      scrollBy(move.right / zoomRef.current, move.down / zoomRef.current);
      finger = move.finger;
    };
    let onTouchEnd = () => {
      finger = null;
    };
    window.addEventListener('wheel', onWheel, {
      passive: false,
    });
    window.addEventListener('touchstart', onTouchStart, {
      passive: true,
    });
    window.addEventListener('touchmove', onTouchMove, {
      passive: false,
    });
    window.addEventListener('touchend', onTouchEnd);
    window.addEventListener('touchcancel', onTouchEnd);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
      filledRef.current = null;
      scrollRef.current = TOP_LEFT_SCROLL;
      scrollTopBeforeShowRowRef.current = null;
    };
  }, [table, isTableNotDrawable, redraw]);
  const isPictureOfOpen = open !== null && drawnPicture?.of.table === open.table;
  return {
    picture: isPictureOfOpen ? drawnPicture.picture : null,
    pictureFromTheTop,
    showColumn,
    isPlanDrawn: isPictureOfOpen && isSameImportOpen(drawnPicture.of, open),
    plainPicture: isPictureOfOpen && isPlayed ? drawnPicture.plain : null,
    unfoldedInPicture: isPictureOfOpen ? drawnPicture.unfolded : NOTHING_DRAWN_ANYWAY,
    cellsThatStayText: isPictureOfOpen ? drawnPicture.cellsThatStayText : NO_CELLS_THAT_STAY_TEXT,
    showRow,
    showRowNoLonger,
    endAt,
    cannotBeDrawn: open !== null && cannotDraw?.table === open.table,
  };
}
export function lastColumnEdges({ body, columnHeaders }: Pick<GridOfPage, 'body' | 'columnHeaders'>, endOfTable: EndOfImportTable | null) {
  let lastColumnHeader = columnHeaders.find(({ columnNumber }) => columnNumber === endOfTable?.column);
  let endOfLastColumn = lastColumnHeader === undefined ? null : body.left + lastColumnHeader.left + lastColumnHeader.width;
  let doesLastColumnRunOn = endOfLastColumn !== null && body.left + body.width - endOfLastColumn < LAST_COLUMN_RUN_ON_PX;
  return {
    endOfLastColumn,
    doesLastColumnRunOn,
    boxOfColumn: (columnIndex: number | null) => {
      let columnHeader = columnHeaders.find(({ columnNumber }) => columnNumber - 1 === columnIndex);
      if (columnHeader === undefined) return null;
      let width = columnHeader === lastColumnHeader && doesLastColumnRunOn ? body.width - columnHeader.left : columnHeader.width;
      return {
        left: body.left + columnHeader.left,
        width,
      };
    },
  };
}
export function revealedColumnsEdge(
  picture: Pick<GridOfPage, 'body' | 'columnHeaders'>,
  endOfTable: EndOfImportTable | null,
  columnsRevealed: number,
) {
  let { body, columnHeaders } = picture;
  let box = lastColumnEdges(picture, endOfTable).boxOfColumn(columnsRevealed - 1);
  if (box !== null) return box.left + box.width;
  return columnsRevealed < (columnHeaders[0]?.columnNumber ?? 1) ? body.left : body.left + body.width;
}
export function ImportShimmer(props: ImportShimmerProps) {
  let { picture, endOfTable, columnsRevealed, isGone, zoom } = props;
  let { left: bodyLeft, top: bodyTop, width: bodyWidth, height: bodyHeight } = picture.body;
  let lastColumnBox = lastColumnEdges(picture, endOfTable).boxOfColumn(endOfTable.column - 1);
  let roomWidth = lastColumnBox === null ? bodyWidth : lastColumnBox.left + lastColumnBox.width - bodyLeft;
  let lastRow = picture.rowsDrawn.find(({ rowNumber }) => rowNumber === endOfTable.row);
  let roomHeight = bodyTop + (lastRow === undefined ? bodyHeight : lastRow.top + lastRow.height);
  let revealedWidth = revealedColumnsEdge(picture, endOfTable, columnsRevealed) - bodyLeft;
  let shimmerAt = revealedWidth >= roomWidth ? roomWidth + IMPORT_SHIMMER_WIDTH_PX / zoom : revealedWidth;
  return <div aria-hidden className="sheet-import-shimmer-room" style={{
      left: bodyLeft * zoom,
      width: roomWidth * zoom,
      height: roomHeight * zoom,
    }}><div className="sheet-import-shimmer" data-crosses data-is-gone={columnsRevealed > 0 || isGone || undefined} /><div className="sheet-import-shimmer" data-is-gone={columnsRevealed === 0 || isGone || undefined} style={{
          transform: `translateX(${Math.max(IMPORT_SHIMMER_WIDTH_PX, shimmerAt * zoom)}px)`,
        }} /></div>;
}
export function ImportProposalOverlay({
  picture,
  columnInHand,
  columnsLit,
  cellsThatStayText = NO_CELLS_THAT_STAY_TEXT,
  rowsUnfolded,
  columnsUnfolded,
  recordsDrawn,
  recordsNotDrawn,
  columnsNotDrawn,
  zoom,
  endOfTable,
  played = null,
}: ImportProposalOverlayProps) {
  if (picture === null) return null;
  let { body, rowsDrawn } = picture;
  let {
    endOfLastColumn,
    doesLastColumnRunOn,
    boxOfColumn,
  } = lastColumnEdges(picture, endOfTable);
  let columnInHandBox = boxOfColumn(columnInHand);
  let playedEdge = played === null ? null : revealedColumnsEdge(picture, endOfTable, played.columnsRevealed);
  let rowAfterRecords = rowsDrawn.find(({ rowNumber }) => rowNumber === recordsDrawn + 1);
  let lastTableRow = rowsDrawn.find(({ rowNumber }) => rowNumber === endOfTable?.row);
  let rowBeforeMore = recordsNotDrawn > 0 ? rowAfterRecords : lastTableRow;
  let namesRow = rowsDrawn.find(({ rowNumber }) => rowNumber === 1);
  let namesRowBottom = namesRow === undefined ? 0 : namesRow.top + namesRow.height;
  let rowsByNumber = new Map(rowsDrawn.map((row): [number, typeof row] => [row.rowNumber, row]));
  let boxOfCell = ({ rowNumber, columnDrawn }: Pick<CellThatStaysText, 'rowNumber' | 'columnDrawn'>) => {
    let row = rowsByNumber.get(rowNumber);
    let columnBox = row === undefined ? null : boxOfColumn(columnDrawn);
    if (row === undefined || columnBox === null) return null;
    let hiddenHeight = Math.max(0, namesRowBottom - row.top);
    return hiddenHeight >= row.height
      ? null
      : {
          ...columnBox,
          top: body.top + row.top,
          height: row.height,
          hidden: hiddenHeight,
        };
  };
  return <div aria-hidden inert className="sheet-grid sheet-import-proposal" {...gridlinesDataAttribute(picture)}><div style={zoomedStyle(zoom)}>{played === null || playedEdge === null
          ? <PlainGridDrawing grid={picture} />
          : (<><div className="sheet-import-proposal-layer"><PlainGridDrawing grid={played.plain} /></div><div className="sheet-import-proposal-layer" style={{
                    clipPath: `inset(0 calc(100% - ${playedEdge}px) 0 0)`,
                  }}><PlainGridDrawing grid={picture} /></div></>)}{played === null &&
          columnInHandBox !== null &&
          <div key={columnInHand} className="sheet-import-proposal-in-hand" style={columnInHandBox} />}{played === null &&
          cellsThatStayText.map((cell) => {
            let box = boxOfCell(cell);
            return box === null
              ? null
              : (<div key={`${cell.rowNumber} ${cell.columnDrawn}`} className="sheet-import-proposal-stays-text" style={{
                      left: box.left,
                      top: box.top,
                      width: box.width,
                      height: box.height,
                      clipPath: `inset(${box.hidden}px 1px 1px 0)`,
                    }} />);
          })}{columnsLit.map((columnIndex) => {
          let box = boxOfColumn(columnIndex);
          return box === null
            ? null
            : <div key={columnIndex} className="sheet-import-proposal-lit" style={box} />;
        })}{columnsUnfolded.map((columnIndex) => {
          let box = boxOfColumn(columnIndex);
          return box === null
            ? null
            : (<div key={columnIndex} className="sheet-import-proposal-left-out" style={{
                    ...box,
                    top: 0,
                    bottom: 0,
                  }} />);
        })}{rowsDrawn
          .filter(({ rowNumber }) => rowsUnfolded.includes(rowNumber))
          .map(
            ({ key, top, height }) =>
              (<div key={key} className="sheet-import-proposal-left-out" style={{
                    top: body.top + top,
                    height,
                    left: 0,
                    right: 0,
                  }} />),
          )}{endOfLastColumn !== null &&
          !doesLastColumnRunOn &&
          (<div className="sheet-import-past-the-table" style={{
              left: endOfLastColumn,
              top: 0,
            }} />)}{endOfLastColumn !== null &&
          doesLastColumnRunOn &&
          (<><div className="sheet-import-no-line" data-is-on-headers style={{
                  left: endOfLastColumn - 1,
                  top: 0,
                  height: body.top - 1,
                }} />{rowsDrawn.map(
                ({ key, top, height, rowNumber }) =>
                  (<div key={key} className="sheet-import-no-line" data-is-frozen={rowNumber === 1 || undefined} style={{
                        left: endOfLastColumn - 1,
                        top: body.top + top,
                        height: height - 1,
                      }} />),
              )}</>)}{lastTableRow !== undefined &&
          (<div className="sheet-import-past-the-table" style={{
              left: 0,
              top: body.top + lastTableRow.top + lastTableRow.height,
            }} />)}{recordsNotDrawn + columnsNotDrawn > 0 &&
          rowBeforeMore !== undefined &&
          (<div className="sheet-import-proposal-more" style={{
              top: body.top + rowBeforeMore.top + rowBeforeMore.height,
              left: body.left,
            }}>{joinImportWordsWithCommas([
              ...(recordsNotDrawn > 0 ? [moreRowsLabel(recordsNotDrawn)] : []),
              ...(columnsNotDrawn > 0 ? [moreImportColumnsWords(columnsNotDrawn)] : []),
            ])}</div>)}</div></div>;
}
export const singleFingerOf = ([firstTouch, secondTouch]: Touch[], isOutsideCells: boolean): FingerOnPicture | null =>
  firstTouch === undefined || secondTouch !== undefined || isOutsideCells
    ? null
    : {
        id: firstTouch.identifier,
        x: firstTouch.clientX,
        y: firstTouch.clientY,
      };
export const NO_TEXT_MEASURES: TextMeasurer = {
  lineCountsOfWrappedTexts: (texts) => texts.map(() => 1),
  widthOfCharacters: () => 0,
};
export const quotedName = (name: string) =>
  translateMessage(
    {
      defaultMessage: '“{name}”',
      id: '9dQoGQZQEq',
    },
    {
      name,
    },
  );
export const importDialogLabels = {
  apply: () =>
    translateMessage({
      defaultMessage: 'Apply',
      id: 'BbM/u7dITQ',
    }),
  importCsv: () =>
    translateMessage({
      defaultMessage: 'Import CSV',
      id: 'Ge8FxxsPo8',
    }),
  whatToDo: () =>
    translateMessage({
      defaultMessage: 'A preview of your new sheet. Change column types, headings or rows before you apply.',
      id: 'Z4baBNLyK6',
    }),
  columnsToCheck: () =>
    translateMessage({
      defaultMessage: 'Columns to check',
      id: '+OeUgANjWY',
    }),
  discard: () =>
    translateMessage({
      defaultMessage: 'Discard',
      id: 'dfmH4faikb',
    }),
  sheet: () =>
    translateMessage({
      defaultMessage: 'Sheet',
      id: '40Qvd5GZiU',
    }),
  empty: () =>
    translateMessage({
      defaultMessage: 'Empty',
      id: 'OpzlbeZf1O',
    }),
  importTitle: () =>
    translateMessage({
      defaultMessage: 'Import',
      id: '6NxWwU70kQ',
    }),
};
export const columnsToCheckLabel = (count: number) =>
  translateMessage(
    {
      defaultMessage: '{count, plural, one {# column to check} other {# columns to check}}',
      id: 'LSa7gkQzV2',
    },
    {
      count,
    },
  );
export const columnNthLabel = (nth: number) =>
  translateMessage(
    {
      defaultMessage: 'Column {nth, number}',
      id: 'Q+VabMaG/a',
    },
    {
      nth,
    },
  );
export const addBackColumnLabel = (nth: number) =>
  translateMessage(
    {
      defaultMessage: 'Add back column {nth, number}',
      id: '+ctqvSRUxj',
    },
    {
      nth,
    },
  );
export const notInSheetLabel = (sheetName: string) =>
  translateMessage(
    {
      defaultMessage: 'Not in {sheetName}',
      id: 'Pi6p8qrQLi',
    },
    {
      sheetName,
    },
  );
export const addBackLineLabel = (line: number) =>
  translateMessage(
    {
      defaultMessage: 'Add back line {line, number}',
      id: 'C+wRun33Z7',
    },
    {
      line,
    },
  );
export const rowsAndColumnsLabel = (rowCount: number, columnCount: number) =>
  translateMessage(
    {
      defaultMessage: '{rows}, {columns}',
      id: 'hX//3Owf+3',
    },
    {
      rows: importRowCountLabel(rowCount),
      columns: translateMessage(
        {
          defaultMessage: '{count, plural, one {# column} other {# columns}}',
          id: 'utQTtS3cKE',
        },
        {
          count: columnCount,
        },
      ),
    },
  );
export const importRowCountLabel = (count: number) =>
  translateMessage(
    {
      defaultMessage: '{count, plural, one {# row} other {# rows}}',
      id: '11/Nh1thhB',
    },
    {
      count,
    },
  );
export const moreRowsLabel = (count: number) =>
  translateMessage(
    {
      defaultMessage: '{count, plural, one {# more row} other {# more rows}}',
      id: 'SMumWlrxR+',
    },
    {
      count,
    },
  );
export const previewBeingReadLabel = (fileName: string) =>
  translateMessage(
    {
      defaultMessage: 'A preview of “{fileName}”. Nothing is saved yet. Agent is reading it.',
      id: 'IvYPDtSb0g',
    },
    {
      fileName,
    },
  );
export const readyToApplyWords = (sheetName: string, rowCount: number, openCount: number) =>
  [
    translateMessage(
      {
        defaultMessage:
          '{rowCount, plural, one {“{sheetName}” is ready to apply, with # row.} other {“{sheetName}” is ready to apply, with # rows.}}',
        id: 'GfjxJmDh3f',
      },
      {
        sheetName,
        rowCount,
      },
    ),
    translateMessage(
      {
        defaultMessage:
          '{openCount, plural, =0 {Nothing is saved yet.} one {Nothing is saved yet. # setting is left to check.} other {Nothing is saved yet. # settings are left to check.}}',
        id: 'cCcimqDdJA',
      },
      {
        openCount,
      },
    ),
    translateMessage({
      defaultMessage: 'Apply it to read its cells. Undo removes it again.',
      id: 'sAQu5gAf9J',
    }),
  ].join(' ');
export const IMPORT_TABLE_WIDTH_BUDGET = 4000;
export const MIN_IMPORT_COLUMN_WIDTH = 60;
export const importColumnWidth = ({ table }: Pick<ImportOfAFile, 'table'>) =>
  Math.max(MIN_IMPORT_COLUMN_WIDTH, Math.floor(IMPORT_TABLE_WIDTH_BUDGET / Math.min(table.columnCount, MAX_PREVIEW_COLUMNS)));
export const importColumnWidthOf = (open: ImportOfAFile) =>
  isImportPlanComing(open) ? MIN_IMPORT_COLUMN_WIDTH : importColumnWidth(open);
export const POPUP_SURFACE_SELECTOR = '[role=menu],[role=listbox],[role=alertdialog],[data-ui=Popover]';
export const PICTURE_BOX_CLASS = 'sheet-import-picture-box';
export const SCROLLS_AROUND_PICTURE_ATTRIBUTE = 'data-scrolls-around-the-picture';
export const IMPORT_HEADINGS_SELECTOR = '.sheet-import-headings';
export const WIDE_PICTURE_WIDTH = 1e5;
export const PICTURE_END_SLACK_PX = 48;
export const LAST_COLUMN_RUN_ON_PX = 48;
export const END_AT_INFINITY: EndOfImportTable = {
  row: 1 / 0,
  column: 1 / 0,
};
export const ROWS_ABOVE_SHOWN_ROW = 8;
export const LINE_SCROLL_PX = 24;
export const isInPictureBox = (target: EventTarget | null) =>
  target instanceof Element && target.closest(`.${PICTURE_BOX_CLASS}`) !== null && target.closest(POPUP_SURFACE_SELECTOR) === null;
export const TOP_LEFT_SCROLL: ScrollOfPicture = {
  scrollTop: 0,
  scrollLeft: 0,
};
export const NO_CELLS_THAT_STAY_TEXT: CellThatStaysText[] = [];
export const isSameImportOpen = (first: ImportOfAFile | null, second: ImportOfAFile | null) =>
  first === second ||
  (first !== null &&
    second !== null &&
    first.table === second.table &&
    first.plan === second.plan &&
    first.soFar?.plan === second.soFar?.plan &&
    first.byHand === second.byHand &&
    first.answers === second.answers &&
    first.destinationChosen === second.destinationChosen);
export const PICTURE_COLUMN_MEASURE_HEIGHT = 96;
export const IMPORT_SHIMMER_WIDTH_PX = 100;
