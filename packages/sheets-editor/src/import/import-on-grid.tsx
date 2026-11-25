import { prefersReducedMotion } from '../kit/platform.ts';
import * as React from 'react';
import { isImportPlanComing, importPlanSoFar } from './import-review.ts';
import { isCompactLayout, useCoarsePointerMedia } from '../app/media-queries.ts';
import { SIDE_PANE_DEFAULT_WIDTH } from '../ui/side-pane/side-pane.tsx';
import { importDestinationSort } from './settings-to-check.ts';
import { NOTHING_DRAWN_ANYWAY, importColumnsOutOfDrawing, importDrawnPositions, importRecordCount, importColumnsOverLimit } from './bring-in.ts';
import { useImportPicture, importColumnWidth, importColumnWidthOf, ImportShimmer, ImportProposalOverlay } from './import-picture.tsx';
import { importPictureLineCount } from './picture-lines-and-focus.ts';
import type { CellThatStaysText, ImportPictureSize, LinesAndColumnsUnfolded, PlayedImportPicture } from './import-picture.tsx';
import type { ImportFile, ImportOfAFile, ImportPreview, PageState } from '../state/initial-state.ts';
import type { GridOfPage, ListedSheet } from '../view/page-view.ts';
/** The agent's plan shown coming in column by column, over the table it is a plan of. */
export interface ColumnsReveal {
  of: ImportFile;
  revealed: number;
  /** The column being shown coming in, if one is. */
  inHand: number | null;
  stepEndsAtMs: number;
  /** When the last column is to be shown, while the plan is still coming. */
  lastColumnByMs: number | null;
}
/** How many columns of the plan are known so far, of how many, and whether the rest is still coming. */
export interface ColumnsToReveal {
  known: number;
  count: number;
  isAwaited: boolean;
}
/** The room the grid gives the picture of an import. */
export type ImportGridRoom = Pick<PageState, 'gridWidth' | 'gridHeight'>;
/** The picture of an import on the grid, as the import dialog shows it and acts on it. */
export interface ImportOnGrid {
  picture: GridOfPage | null;
  zoom: number;
  proposal: React.ReactElement | null;
  shimmer: React.ReactElement | null;
  isPlanDrawn: boolean;
  cannotBeDrawn: boolean;
  columnsRevealed: number | null;
  lastRow: number;
  onRoomMeasured: (room: ImportGridRoom) => void;
  onColumnsPointedAt: (columns: number[]) => void;
  onNoRowPointedAt: () => void;
  onColumnWanted: (columnIndex: number) => void;
  /** The first cells of each column that would stay text, by column. */
  firstTextCells: ReadonlyMap<number, CellThatStaysText[]>;
  columnsUnfolded: number[];
  hasLinesUnfolded: boolean;
  onLeftOutShown: (unfolded: LinesAndColumnsUnfolded) => void;
}
/** What the import dialog takes from the picture of an import on the grid. */
export interface ImportOnGridDialog {
  onGrid: ImportOnGrid | null;
  onConfirmed: (plansHeardCount: number) => void;
  onDropped: () => void;
  onEscaped: (isWishTyped: boolean) => void;
}
interface ImportOnGridWanted {
  open: ImportOfAFile | null;
  listedSheets: ListedSheet[];
  locale: string;
  sizeOfGrid: ImportPictureSize;
  isImportAsNewSheetUnanswered: boolean;
  zoom: number;
  onConfirmed: (plansHeardCount: number) => void;
  onDropped: () => void;
  onEscaped: (isWishTyped: boolean) => void;
}
export function nextColumnReveal(reveal: ColumnsReveal, { known, count, isAwaited }: ColumnsToReveal, nowMs: number): ColumnsReveal | 'over' {
  if (reveal.revealed < known) {
    let lastColumnByMs = isAwaited ? null : (reveal.lastColumnByMs ?? nowMs + COLUMN_REVEAL_EXPECTED_MS);
    let stepMs =
      lastColumnByMs === null
        ? COLUMN_REVEAL_STEP_MS
        : Math.min(COLUMN_REVEAL_STEP_MS, Math.max(0, lastColumnByMs - nowMs) / (count - reveal.revealed));
    return {
      ...reveal,
      lastColumnByMs,
      revealed: reveal.revealed + 1,
      inHand: reveal.revealed,
      stepEndsAtMs: nowMs + (reveal.revealed + 1 < count ? stepMs : LAST_COLUMN_REVEAL_MS),
    };
  }
  if (!isAwaited) return 'over';
  let inHand = reveal.revealed < count ? reveal.revealed : null;
  return reveal.inHand === inHand
    ? reveal
    : {
        ...reveal,
        inHand,
      };
}
export function useColumnsReveal(open: ImportOfAFile | null) {
  let [reveal, setReveal] = React.useState<ColumnsReveal | null>(null);
  let [tableRevealed, setTableRevealed] = React.useState<ImportFile | null>(null);
  let table = open?.table ?? null;
  let isAwaited = open !== null && isImportPlanComing(open);
  if (reveal !== null && reveal.of !== table) setReveal(null);
  if (table !== null && table !== tableRevealed && reveal?.of !== table)
    if (isAwaited && !prefersReducedMotion())
      setReveal({
        of: table,
        revealed: 0,
        inHand: 0,
        stepEndsAtMs: 0,
        lastColumnByMs: null,
      });
    else setTableRevealed(table);
  let isPlanByHand = reveal !== null && open !== null && !isAwaited && !open.isPlanByAgent;
  if (isPlanByHand) {
    setReveal(null);
    setTableRevealed(table);
  }
  let columnCount = open === null ? 0 : importPlanSoFar(open).plan.columns.length;
  let columnsKnown = open === null ? 0 : isAwaited ? importPlanSoFar(open).columnsReadCount : columnCount;
  React.useEffect(() => {
    if (reveal === null) return;
    let timer = setTimeout(
      () => {
        let nextReveal = nextColumnReveal(
          reveal,
          {
            known: columnsKnown,
            count: columnCount,
            isAwaited,
          },
          performance.now(),
        );
        if (nextReveal === 'over') {
          setReveal(null);
          setTableRevealed(reveal.of);
        } else if (nextReveal !== reveal) setReveal(nextReveal);
      },
      Math.max(0, reveal.stepEndsAtMs - performance.now()),
    );
    return () => clearTimeout(timer);
  }, [reveal, columnsKnown, columnCount, isAwaited]);
  return reveal === null || reveal.of !== table || isPlanByHand ? null : reveal;
}
export function importGridRoomGuess() {
  let { innerWidth: viewWidth, innerHeight: viewHeight } = window;
  let margin = viewWidth < 640 ? 16 : 64;
  if (isCompactLayout())
    return {
      gridWidth: viewWidth - margin,
      gridHeight: Math.min(viewHeight - margin, 1024) - COMPACT_IMPORT_CHROME_PX,
    };
  return {
    gridWidth: Math.min(viewWidth - 64, 1760) - SIDE_PANE_DEFAULT_WIDTH,
    gridHeight: Math.min(viewHeight - 64, 1024) - 138,
  };
}
export function columnDrawnIndex(columnIndex: number, leftOutColumns: number[]) {
  return leftOutColumns.includes(columnIndex) ? null : columnIndex - leftOutColumns.filter((columnOut) => columnOut < columnIndex).length;
}
export function firstTextCellsByColumn(previewColumns: ImportPreview['columns'], leftOutColumns: number[], textCellsDrawn: CellThatStaysText[]) {
  return new Map(
    previewColumns
      .filter(
        ({ columnIndex, keptAsTextCount }) =>
          keptAsTextCount > 0 && !leftOutColumns.includes(columnIndex),
      )
      .map(({ columnIndex }): [number, CellThatStaysText[]] => {
        let drawnIndex = columnDrawnIndex(columnIndex, leftOutColumns);
        let cellsOfColumn = textCellsDrawn.filter(({ columnDrawn }) => columnDrawn === drawnIndex);
        return [columnIndex, cellsOfColumn.slice(0, FIRST_TEXT_CELLS_SHOWN)];
      }),
  );
}
export function useImportOnGrid({
  open,
  listedSheets,
  locale,
  sizeOfGrid,
  isImportAsNewSheetUnanswered,
  zoom,
  onConfirmed,
  onDropped,
  onEscaped,
}: ImportOnGridWanted) {
  let importKind = open === null ? null : importDestinationSort(open);
  let isChangesToASheet = importKind === 'changesToASheet';
  let sheetToCome = importKind === 'sheetToCome' ? open : null;
  let [measuredRoom, setMeasuredRoom] = React.useState<ImportGridRoom | null>(null);
  let { density } = sizeOfGrid;
  let isSheetToCome = sheetToCome !== null;
  let importZoom = useCoarsePointerMedia() ? COARSE_POINTER_IMPORT_ZOOM : 1;
  let gridRoom = React.useMemo(() => {
    let { gridWidth: roomWidth, gridHeight: roomHeight } = measuredRoom ?? (isSheetToCome ? importGridRoomGuess() : NO_GRID_ROOM);
    return {
      gridWidth: roomWidth / importZoom,
      gridHeight: roomHeight / importZoom,
      density,
    };
  }, [measuredRoom, isSheetToCome, density, importZoom]);
  let columnsReveal = useColumnsReveal(sheetToCome);
  let columnsRevealed = columnsReveal?.revealed ?? null;
  let isPlayed = columnsReveal !== null;
  let [unfolded, setUnfolded] = React.useState(NOTHING_DRAWN_ANYWAY);
  if (sheetToCome === null && unfolded !== NOTHING_DRAWN_ANYWAY) setUnfolded(NOTHING_DRAWN_ANYWAY);
  let {
    picture,
    pictureFromTheTop,
    showColumn,
    showRow,
    showRowNoLonger,
    endAt,
    isPlanDrawn,
    plainPicture,
    unfoldedInPicture,
    cellsThatStayText,
    cannotBeDrawn,
  } = useImportPicture({
    open: sheetToCome,
    locale,
    size: gridRoom,
    zoom: importZoom,
    unfolded,
    isPlayed,
  });
  let [columnsPointedAt, setColumnsPointedAt] = React.useState(NO_COLUMN_INDEXES);
  if (sheetToCome === null && columnsPointedAt !== NO_COLUMN_INDEXES) setColumnsPointedAt(NO_COLUMN_INDEXES);
  let [pictureAfterImport, setPictureAfterImport] = React.useState<GridOfPage | null>(null);
  if (open === null && !isImportAsNewSheetUnanswered && pictureAfterImport !== null) setPictureAfterImport(null);
  let pictureOverGrid = open === null ? pictureAfterImport : null;
  React.useEffect(() => {
    if (pictureOverGrid === null) return;
    let timer = setTimeout(() => setPictureAfterImport(null), PICTURE_OVER_GRID_MS);
    return () => clearTimeout(timer);
  }, [pictureOverGrid]);
  let hasPicture = picture !== null;
  let leftOutColumns = React.useMemo(
    () => (sheetToCome === null ? NO_COLUMN_INDEXES : importColumnsOutOfDrawing(sheetToCome, unfoldedInPicture)),
    [sheetToCome, unfoldedInPicture],
  );
  let unfoldedRowsAndColumns = React.useMemo(
    () =>
      sheetToCome === null
        ? {
            rowNumbers: [],
            columnsDrawn: [],
          }
        : importDrawnPositions(sheetToCome, unfoldedInPicture, importColumnWidth(sheetToCome)),
    [sheetToCome, unfoldedInPicture],
  );
  let [firstUnfoldedRow] = unfoldedRowsAndColumns.rowNumbers;
  let columnInHandOfReveal = columnsReveal === null ? undefined : columnsReveal.inHand;
  let columnDrawnInHand = React.useMemo(() => {
    if (columnInHandOfReveal !== undefined) {
      if (columnInHandOfReveal === null || sheetToCome === null) return null;
      let { length: columnCount } = importPlanSoFar(sheetToCome).plan.columns;
      let columnIndex = columnInHandOfReveal;
      while (columnIndex < columnCount && leftOutColumns.includes(columnIndex)) columnIndex += 1;
      return columnIndex < columnCount ? columnDrawnIndex(columnIndex, leftOutColumns) : null;
    }
    if (sheetToCome === null || !isImportPlanComing(sheetToCome)) return null;
    let { plan, columnsReadCount } = importPlanSoFar(sheetToCome);
    return columnsReadCount < plan.columns.length ? columnDrawnIndex(columnsReadCount, leftOutColumns) : null;
  }, [sheetToCome, leftOutColumns, columnInHandOfReveal]);
  let columnsLit = React.useMemo(
    () => columnsPointedAt.flatMap((columnIndex) => columnDrawnIndex(columnIndex, leftOutColumns) ?? []),
    [columnsPointedAt, leftOutColumns],
  );
  let sheetsWithSheetToCome = React.useMemo((): ListedSheet[] => {
    let [firstSheet] = listedSheets;
    if (sheetToCome === null || firstSheet === undefined) return listedSheets;
    let sheetsHidden = listedSheets.map(
      (sheet) => ({
        ...sheet,
        isShown: false,
      }),
    );
    let sheetToComeIndex =
      sheetToCome.newSheet?.comesFirst === true ? 0 : listedSheets.findIndex(({ isShown }) => isShown) + 1;
    let sheetToComeEntry = {
      ...firstSheet,
      sheetId: SHEET_TO_COME_ID,
      name: isImportPlanComing(sheetToCome)
        ? importPlanSoFar(sheetToCome).plan.sheetName
        : (sheetToCome.newSheet?.name ?? importPlanSoFar(sheetToCome).plan.sheetName),
      isShown: true,
      holdsOpenEntry: false,
      renaming: null,
      facesOfOthers: [],
      openCommentCount: 0,
      isWhereAgentWorks: isImportPlanComing(sheetToCome),
    };
    return [...sheetsHidden.slice(0, sheetToComeIndex), sheetToComeEntry, ...sheetsHidden.slice(sheetToComeIndex)];
  }, [listedSheets, sheetToCome]);
  const [sheetsAtConfirm, setSheetsAtConfirm] = React.useState<ListedSheet[] | null>(null);
  const isSheetListHeld = pictureOverGrid !== null && sheetsAtConfirm !== null && listedSheets.length < sheetsAtConfirm.length;
  if (sheetsAtConfirm !== null && pictureAfterImport === null) setSheetsAtConfirm(null);
  let mostRecords = sheetToCome === null ? 0 : importColumnWidth(sheetToCome);
  let recordsDrawn =
    mostRecords + unfoldedRowsAndColumns.rowNumbers.filter((rowNumber) => rowNumber > mostRecords + 1).length;
  let recordsNotDrawn = React.useMemo(
    () =>
      sheetToCome === null || isImportPlanComing(sheetToCome) ? 0 : Math.max(0, importRecordCount(sheetToCome) - importColumnWidth(sheetToCome)),
    [sheetToCome],
  );
  let lastRow = React.useMemo(() => {
    if (sheetToCome === null) return 0;
    return importPictureLineCount(sheetToCome, importColumnWidthOf(sheetToCome), unfoldedRowsAndColumns.rowNumbers.length);
  }, [sheetToCome, unfoldedRowsAndColumns]);
  let columnsNotDrawn = React.useMemo(() => (sheetToCome === null ? 0 : importColumnsOverLimit(sheetToCome).length), [sheetToCome]);
  let columnsComingIn = sheetToCome === null ? 0 : importPlanSoFar(sheetToCome).plan.columns.length - leftOutColumns.length;
  let endOfTable = React.useMemo(
    () => ({
      row: lastRow,
      column: columnsComingIn,
    }),
    [lastRow, columnsComingIn],
  );
  React.useEffect(() => {
    if (hasPicture) endAt(endOfTable);
  }, [endOfTable, hasPicture, endAt]);
  let [firstColumnLit] = columnsLit;
  let { gridWidth } = gridRoom;
  let isPictureDrawn = picture !== null;
  React.useEffect(() => {
    if (firstColumnLit !== undefined && isPictureDrawn && gridWidth > 0) showColumn(firstColumnLit);
  }, [firstColumnLit, gridWidth, isPictureDrawn, showColumn]);
  let firstTextCells = React.useMemo(
    () =>
      sheetToCome === null || !isPlanDrawn || unfoldedInPicture.lines.length > 0
        ? NO_FIRST_TEXT_CELLS_BY_COLUMN
        : firstTextCellsByColumn(importPlanSoFar(sheetToCome).preview.columns, leftOutColumns, cellsThatStayText),
    [sheetToCome, isPlanDrawn, unfoldedInPicture, leftOutColumns, cellsThatStayText],
  );
  React.useEffect(() => {
    if (firstUnfoldedRow !== undefined && unfolded !== NOTHING_DRAWN_ANYWAY) showRow(firstUnfoldedRow);
    else if (firstColumnLit !== undefined) showRow(1);
  }, [firstUnfoldedRow, unfolded, firstColumnLit, showRow]);
  let isOnGrid = sheetToCome !== null;
  let played = React.useMemo(
    (): PlayedImportPicture | null =>
      columnsRevealed === null || plainPicture === null
        ? null
        : {
            plain: plainPicture,
            columnsRevealed: columnsRevealed - leftOutColumns.filter((columnOut) => columnOut < columnsRevealed).length,
          },
    [columnsRevealed, plainPicture, leftOutColumns],
  );
  let shimmer = React.useMemo(
    () =>
      played === null || picture === null
        ? null
        : <ImportShimmer picture={picture} endOfTable={endOfTable} columnsRevealed={played.columnsRevealed} isGone={columnDrawnInHand === null} zoom={importZoom} />,
    [played, picture, endOfTable, columnDrawnInHand, importZoom],
  );
  let proposal = React.useMemo(
    () =>
      <ImportProposalOverlay picture={picture} columnInHand={columnDrawnInHand} columnsLit={columnsLit} cellsThatStayText={cellsThatStayText} rowsUnfolded={unfoldedRowsAndColumns.rowNumbers} columnsUnfolded={unfoldedRowsAndColumns.columnsDrawn} columnsNotDrawn={columnsNotDrawn} recordsDrawn={recordsDrawn} recordsNotDrawn={recordsNotDrawn} zoom={importZoom} endOfTable={endOfTable} played={played} />,
    [
      importZoom,
      picture,
      columnDrawnInHand,
      columnsLit,
      cellsThatStayText,
      unfoldedRowsAndColumns,
      recordsDrawn,
      recordsNotDrawn,
      columnsNotDrawn,
      endOfTable,
      played,
    ],
  );
  let dialogOnGrid = React.useMemo(
    (): ImportOnGrid | null =>
      isOnGrid
        ? {
            picture,
            zoom: importZoom,
            proposal,
            shimmer,
            isPlanDrawn: (isPlanDrawn || cannotBeDrawn) && columnsRevealed === null,
            cannotBeDrawn,
            columnsRevealed,
            lastRow,
            onRoomMeasured: setMeasuredRoom,
            onColumnsPointedAt: setColumnsPointedAt,
            onNoRowPointedAt: showRowNoLonger,
            onColumnWanted: showColumn,
            firstTextCells,
            columnsUnfolded: unfoldedInPicture.columns,
            hasLinesUnfolded: unfoldedInPicture.lines.length > 0,
            onLeftOutShown: setUnfolded,
          }
        : null,
    [
      isOnGrid,
      importZoom,
      picture,
      proposal,
      shimmer,
      isPlanDrawn,
      cannotBeDrawn,
      columnsRevealed,
      lastRow,
      unfoldedInPicture,
      showColumn,
      showRowNoLonger,
      firstTextCells,
    ],
  );
  let sheetsWithSheetToComeRef = React.useRef(sheetsWithSheetToCome);
  React.useEffect(() => {
    sheetsWithSheetToComeRef.current = sheetsWithSheetToCome;
  });
  let confirmImportOnGrid = React.useCallback(
    (plansHeardCount: number) => {
      if (isOnGrid) setPictureAfterImport(unfoldedInPicture === NOTHING_DRAWN_ANYWAY ? pictureFromTheTop(sizeOfGrid) : null);
      if (isOnGrid) setSheetsAtConfirm(sheetsWithSheetToComeRef.current);
      onConfirmed(plansHeardCount);
    },
    [isOnGrid, unfoldedInPicture, pictureFromTheTop, sizeOfGrid, onConfirmed],
  );
  return {
    pictureOverGrid: <ImportProposalOverlay picture={pictureOverGrid} columnInHand={null} columnsLit={NO_COLUMN_INDEXES} rowsUnfolded={NO_COLUMN_INDEXES} columnsUnfolded={NO_COLUMN_INDEXES} columnsNotDrawn={0} recordsDrawn={recordsDrawn} recordsNotDrawn={0} zoom={zoom} endOfTable={null} />,
    listedSheets: isSheetListHeld ? sheetsAtConfirm : listedSheets,
    dialog: {
      onGrid: isChangesToASheet ? IMPORT_ON_GRID_IDLE : dialogOnGrid,
      onConfirmed: confirmImportOnGrid,
      onDropped,
      onEscaped,
    } satisfies ImportOnGridDialog,
  };
}
export const COLUMN_REVEAL_STEP_MS = 140;
export const COLUMN_REVEAL_EXPECTED_MS = 2500;
export const LAST_COLUMN_REVEAL_MS = 440;
export const COARSE_POINTER_IMPORT_ZOOM = 1.25;
export const SHEET_TO_COME_ID = 'sheet-to-come';
export const PICTURE_OVER_GRID_MS = 8000;
export const NO_COLUMN_INDEXES: number[] = [];
export const NO_GRID_ROOM: ImportGridRoom = {
  gridWidth: 0,
  gridHeight: 0,
};
export const COMPACT_IMPORT_CHROME_PX = 290;
export const FIRST_TEXT_CELLS_SHOWN = 5;
export const NO_FIRST_TEXT_CELLS_BY_COLUMN: ReadonlyMap<number, CellThatStaysText[]> = new Map();
export const importOnGridNoop = () => {
  return;
};
export const IMPORT_ON_GRID_IDLE: ImportOnGrid = {
  picture: null,
  zoom: 1,
  proposal: null,
  shimmer: null,
  isPlanDrawn: true,
  cannotBeDrawn: false,
  columnsRevealed: null,
  lastRow: 0,
  onRoomMeasured: importOnGridNoop,
  onColumnsPointedAt: importOnGridNoop,
  onNoRowPointedAt: importOnGridNoop,
  onColumnWanted: importOnGridNoop,
  firstTextCells: new Map(),
  columnsUnfolded: [],
  hasLinesUnfolded: false,
  onLeftOutShown: importOnGridNoop,
};
