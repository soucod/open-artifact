import type { ColumnId } from '@open-artifact/sheets-core';
import { ownRowOrderOfSheet, type OwnRowOrder } from '../model/line-ids.ts';
import { rowNumberAsStored, columnLetters } from '../model/a1-references.ts';
import { selectedArea, mergedAreaOrCellOf, isSameArea, activeAnchorCell, scrollToShowActiveCell, isSameCell } from '../selection/model.ts';
import { hasOtherRanges } from '../selection/several-ranges.ts';
import { isModalOpen } from '../ui/find.ts';
import { withNoEffects, type PageTransition } from '../state/transitions.ts';
import { MOST_LOOKS_IN_VAIN, authorsToLookUp, withoutAuthors, authorShown, type ShownAuthor } from './version-history.ts';
import { stickyHeadersOverRow } from '../grid/sticky-headers.ts';
import { headingTextAt } from '../ui/sort-menu.ts';
import { lookStampOfWorkbook } from '../tables/own-filters.ts';
import { areaToA1AsStored } from '../formulas/from-words/where.ts';
import { cellInputText } from '../model/cell-values.ts';
import type { CellHistory, CellHistoryScope, PageState } from '../state/initial-state.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { CellPosition } from '../selection/model.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { CellHistoryChange, CellHistoryOutcome, HeldContent } from '../state/event-reducer.ts';

/** Where the cell of the history is: its address and the number of its row, as stored. */
export interface CellHistoryPlace {
  address: string;
  rowNumber: number;
}
/** How a column is named in the history: by its heading when that names it alone, or by its letters. */
export type ColumnOfHistory = { kind: 'lettered'; letters: string } | { kind: 'named'; name: string };
/** Where a column a change touched stands in the row of the history. */
export interface ColumnOfChange {
  columnIndex: number;
  address: string;
  column: ColumnOfHistory;
}
/** A cell a change touched, as the history shows it. */
export interface ShownChangedCell {
  columnId: ColumnId;
  held: HeldContent;
  address: string;
  column: ColumnOfHistory;
}
/** A change of the history, as the card lists it. */
export interface ShownCellChange {
  revision: number;
  atMs: number;
  cells: ShownChangedCell[];
  author: ShownAuthor | null;
}
/** The history of a cell or its row, as the card shows it. */
export interface ShownCellHistory {
  address: string;
  rowNumber: number;
  scope: CellHistoryScope;
  canRowBeRead: boolean;
  isAwaited: boolean;
  changes: ShownCellChange[] | null;
  areEarlierLeftOut: boolean;
  whyNotRead: Extract<CellHistoryOutcome, { kind: 'notRead' }>['why'] | null;
  /** The change count the history is behind at, while it waits to be read again. */
  behindAtChangeCount: number | null;
}
/** The cell history last shown, and what it was worked out from. */
interface ShownCellHistoryKept {
  open: CellHistory;
  profilesById: PageState['profilesById'];
  tablesRead: PageState['tablesRead'];
  ownFilters: PageState['ownFilters'];
  asOfWorkbook: number;
  behindAtChangeCount: number | null;
  /** The columns of the changes and where they stand, as JSON. */
  places: string;
  shown: ShownCellHistory;
}

export let lastShownCellHistory: ShownCellHistoryKept | null;
export function cellHistoryPlace(cellId: CellId, workbook: WorkbookReads): CellHistoryPlace | null {
  let position = workbook.positionOfCell(cellId);
  let ownRowOrder = ownRowOrderOfSheet(workbook, cellId.sheetId);
  return position === null
    ? null
    : {
        address: singleCellAddress(position, ownRowOrder),
        rowNumber: rowNumberAsStored(position.rowIndex, ownRowOrder),
      };
}
/** What the row of the cell holds now, as JSON of the column ids and texts of its cells that hold something. */
export function rowHeldNow({ sheetId, rowId }: Pick<CellId, 'sheetId' | 'rowId'>, workbook: WorkbookReads): string {
  let rowIndex = workbook.rowIndexOf(sheetId, rowId);
  let columnCount = workbook.linesOf(sheetId)?.columns.count ?? 0;
  if (rowIndex === null) return '';
  let held: [ColumnId, string][] = [];
  for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
    let cellId = workbook.cellIdAt(sheetId, rowIndex, columnIndex);
    let shown = cellId === null ? '' : shownTextOfCell(cellId, workbook);
    if (cellId !== null && shown !== '') held.push([cellId.columnId, shown]);
  }
  held.sort(([columnIdA], [columnIdB]) => columnIdA.localeCompare(columnIdB));
  return JSON.stringify(held);
}
export function canOpenCellHistory(state: PageState, workbook: WorkbookReads): boolean {
  let area = selectedArea(state, workbook);
  let cellArea = mergedAreaOrCellOf(workbook, state.activeCell);
  return (
    state.mode.kind === 'navigating' &&
    !hasOtherRanges(state) &&
    area !== null &&
    cellArea !== null &&
    (isSameArea(area, cellArea) || (area.rowCount === 1 && area.topRowIndex === cellArea.topRowIndex))
  );
}
export function openCellHistory(state: PageState, workbook: ReadsWithTextMeasurer): PageState {
  let cell = activeAnchorCell(state, workbook);
  let place = cellHistoryPlace(cell, workbook);
  if (
    place === null ||
    !canOpenCellHistory(state, workbook) ||
    isModalOpen({
      ...state,
      menu: null,
    })
  )
    return state;
  return {
    ...scrollToShowActiveCell(state, workbook, 'cellAlone'),
    menu: null,
    cellHistory: {
      cell,
      scope: 'row',
      ...place,
      canRowBeRead: true,
      heldNow: heldNowInScope(cell, 'row', workbook),
      heldAtChangeCount: state.workbookChangeCount,
      awaited: 'toBePut',
      read: null,
      hasChangedSinceAsked: false,
      looksInVainInARow: 0,
      authorsLookedUp: new Set(),
      authorsAwaited: new Set(),
    },
  };
}
export function setCellHistoryScope(state: PageState, workbook: WorkbookReads, scope: CellHistoryScope): PageState {
  let cellHistory = state.cellHistory;
  if (cellHistory === null || cellHistory.scope === scope) return state;
  return {
    ...state,
    cellHistory: {
      ...cellHistory,
      scope,
      heldNow: heldNowInScope(cellHistory.cell, scope, workbook),
      heldAtChangeCount: state.workbookChangeCount,
      awaited: 'toBePut',
      read: null,
      hasChangedSinceAsked: false,
      looksInVainInARow: 0,
    },
  };
}
export function followCellHistory(state: PageState, workbook: WorkbookReads): PageState {
  let cellHistory = state.cellHistory;
  if (cellHistory === null) return state;
  let place =
    isSameCell(cellHistory.cell, activeAnchorCell(state, workbook)) &&
    !isModalOpen({
      ...state,
      cellHistory: null,
    })
      ? cellHistoryPlace(cellHistory.cell, workbook)
      : null;
  if (place === null)
    return {
      ...state,
      cellHistory: null,
    };
  let changeCount = state.workbookChangeCount;
  let heldNow =
    changeCount === cellHistory.heldAtChangeCount ? cellHistory.heldNow : heldNowInScope(cellHistory.cell, cellHistory.scope, workbook);
  if (place.address === cellHistory.address && heldNow === cellHistory.heldNow && changeCount === cellHistory.heldAtChangeCount) return state;
  let hasChanged = cellHistory.hasChangedSinceAsked || heldNow !== cellHistory.heldNow;
  return {
    ...state,
    cellHistory: {
      ...cellHistory,
      ...place,
      heldNow,
      heldAtChangeCount: changeCount,
      hasChangedSinceAsked: hasChanged,
    },
  };
}
export function cellHistoryAnswered(state: PageState, workbook: WorkbookReads, askId: number, answer: CellHistoryOutcome): PageTransition {
  let cellHistory = state.cellHistory;
  if (cellHistory === null || cellHistory.awaited !== askId) return withNoEffects(state);
  if (cellHistory.scope === 'row' && answer.kind === 'notRead' && answer.why === 'storeDoesNotKnowHow') {
    let rowUnreadable = {
      ...state,
      cellHistory: {
        ...cellHistory,
        canRowBeRead: false,
      },
    };
    return withNoEffects(setCellHistoryScope(rowUnreadable, workbook, 'cell'));
  }
  let looksInVain = cellHistory.looksInVainInARow + 1;
  if (answer.kind === 'notRead' && cellHistory.read?.kind === 'read' && looksInVain < MOST_LOOKS_IN_VAIN)
    return withNoEffects({
      ...state,
      cellHistory: {
        ...cellHistory,
        awaited: null,
        hasChangedSinceAsked: true,
        looksInVainInARow: looksInVain,
      },
    });
  let authors = answer.kind === 'read' ? answer.changes.flatMap(({ author }) => author ?? []) : [];
  let userIdsToLookUp = authorsToLookUp(state, cellHistory, authors);
  return {
    state: {
      ...state,
      cellHistory: {
        ...cellHistory,
        awaited: null,
        read: answer,
        looksInVainInARow: 0,
        authorsLookedUp: new Set([...cellHistory.authorsLookedUp, ...userIdsToLookUp]),
        authorsAwaited: new Set([...cellHistory.authorsAwaited, ...userIdsToLookUp]),
      },
    },
    effects:
      userIdsToLookUp.length === 0
        ? []
        : [
            {
              kind: 'lookUpPeople',
              userIds: userIdsToLookUp,
            },
          ],
  };
}
export function askForCellHistory({ state, effects }: PageTransition, workbook: WorkbookReads): PageTransition {
  let followed = followCellHistory(state, workbook);
  let cellHistory = followed.cellHistory;
  if (cellHistory === null || cellHistory.awaited !== 'toBePut' || followed.saving === 'saving')
    return {
      state: followed,
      effects,
    };
  let askId = followed.versionHistoryAskCount + 1;
  let asking = {
    ...followed,
    versionHistoryAskCount: askId,
    cellHistory: {
      ...cellHistory,
      awaited: askId,
      hasChangedSinceAsked: false,
    },
  };
  if (followed.saving === 'allSaved')
    return {
      state: asking,
      effects: [
        ...effects,
        {
          kind: 'readCellHistory',
          askId,
          cell: cellHistory.cell,
          scope: cellHistory.scope,
        },
      ],
    };
  let answered = cellHistoryAnswered(asking, workbook, askId, {
    kind: 'notRead',
    why: 'noAnswer',
  });
  return {
    state: answered.state,
    effects: [...effects, ...answered.effects],
  };
}
export function cellHistoryAuthorsArrived(state: PageState, userIds: string[]): PageState {
  let cellHistory = state.cellHistory;
  if (cellHistory === null) return state;
  let awaited = withoutAuthors(cellHistory.authorsAwaited, userIds);
  return awaited === cellHistory.authorsAwaited
    ? state
    : {
        ...state,
        cellHistory: {
          ...cellHistory,
          authorsAwaited: awaited,
        },
      };
}
/** The headings over the row that name their columns alone, by column index. */
export function headingNamesOfColumns(
  state: PageState,
  workbook: WorkbookReads,
  rowIndex: number,
  columnIndexes: number[],
): Map<number, string> {
  let headings = stickyHeadersOverRow(state, workbook, rowIndex).flatMap(
    ({ header, columns }) =>
      Array.from(
        {
          length: columns.last - columns.first + 1,
        },
        (_unused, offset): [number, string] => {
          let columnIndex = columns.first + offset;
          let heading = headingTextAt(
            state,
            workbook,
            {
              rowIndex: header.last,
              columnIndex,
            },
            true,
          );
          return [columnIndex, heading];
        },
      ),
  );
  let allColumnIndexes = new Set([...columnIndexes, ...headings.map(([columnIndex]) => columnIndex)]);
  let nameCounts = new Map<string, number>();
  for (let name of [...[...allColumnIndexes].map(columnLetters), ...headings.map(([, heading]) => heading)])
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  return new Map(headings.filter(([, heading]) => heading !== '' && nameCounts.get(heading) === 1));
}
/** The columns the changes touched that are still in the row, by column id. */
export function columnsOfCellChanges(
  state: PageState,
  workbook: WorkbookReads,
  { sheetId, rowId }: Pick<CellId, 'sheetId' | 'rowId'>,
  changes: CellHistoryChange[],
): Map<ColumnId, ColumnOfChange> {
  let columns = [
    ...new Set(
      changes.flatMap(({ cells }) => cells.map(({ columnId }) => columnId)),
    ),
  ].flatMap((columnId) => {
    let position = workbook.positionOfCell({
      sheetId,
      rowId,
      columnId,
    });
    return position === null
      ? []
      : [
          {
            columnId,
            at: position,
          },
        ];
  });
  let rowIndex = workbook.rowIndexOf(sheetId, rowId);
  let columnIndexes = columns.map(({ at: position }) => position.columnIndex);
  let headingNames = rowIndex === null ? null : headingNamesOfColumns(state, workbook, rowIndex, columnIndexes);
  return new Map(
    columns.map(({ columnId, at: position }): [ColumnId, ColumnOfChange] => {
      let headingName = headingNames?.get(position.columnIndex);
      return [
        columnId,
        {
          columnIndex: position.columnIndex,
          address: singleCellAddress(position, ownRowOrderOfSheet(workbook, sheetId)),
          column:
            headingName === undefined
              ? {
                  kind: 'lettered',
                  letters: columnLetters(position.columnIndex),
                }
              : {
                  kind: 'named',
                  name: headingName,
                },
        },
      ];
    }),
  );
}
export function changedCellsShown(cells: CellHistoryChange['cells'], columns: Map<ColumnId, ColumnOfChange>): ShownChangedCell[] {
  let shownCells = cells.flatMap(({ columnId, held }) => {
    let column = columns.get(columnId);
    return column === undefined
      ? []
      : [
          {
            columnId,
            held,
            ...column,
          },
        ];
  });
  shownCells.sort((cellA, cellB) => cellA.columnIndex - cellB.columnIndex);
  return shownCells.map(
    ({ columnId, held, address, column }) => ({
      columnId,
      held,
      address,
      column,
    }),
  );
}
export function shownCellHistory(state: PageState, workbook: WorkbookReads): ShownCellHistory | null {
  let {
    cellHistory,
    profilesById,
    tablesRead,
    ownFilters,
    workbookChangeCount,
  } = state;
  if (cellHistory === null) {
    lastShownCellHistory = null;
    return null;
  }
  let behindAtChangeCount = isCellHistoryOutdated(state) ? workbookChangeCount : null;
  let asOfWorkbook = lookStampOfWorkbook(state);
  let isSameOpen =
    lastShownCellHistory !== null &&
    isSameOpenCellHistory(lastShownCellHistory.open, cellHistory) &&
    lastShownCellHistory.profilesById === profilesById &&
    lastShownCellHistory.behindAtChangeCount === behindAtChangeCount;
  if (
    isSameOpen &&
    lastShownCellHistory?.asOfWorkbook === asOfWorkbook &&
    lastShownCellHistory.tablesRead === tablesRead &&
    lastShownCellHistory.ownFilters === ownFilters
  )
    return lastShownCellHistory.shown;
  let { read } = cellHistory;
  let columns = columnsOfCellChanges(state, workbook, cellHistory.cell, read?.kind === 'read' ? read.changes : []);
  let places = JSON.stringify([...columns]);
  if (isSameOpen && lastShownCellHistory?.places === places) {
    lastShownCellHistory = {
      ...lastShownCellHistory,
      tablesRead,
      ownFilters,
      asOfWorkbook,
    };
    return lastShownCellHistory.shown;
  }
  let shown: ShownCellHistory = {
    address: cellHistory.address,
    rowNumber: cellHistory.rowNumber,
    scope: cellHistory.scope,
    canRowBeRead: cellHistory.canRowBeRead,
    isAwaited: cellHistory.awaited !== null,
    changes:
      read?.kind !== 'read'
        ? null
        : read.changes.flatMap(({ revision, atMs, cells, author }) => {
            let shownCells = changedCellsShown(cells, columns);
            if (shownCells.length === 0) return [];
            return [
              {
                revision,
                atMs,
                cells: shownCells,
                author: author === null ? null : authorShown(author, profilesById, cellHistory.authorsAwaited),
              },
            ];
          }),
    areEarlierLeftOut: read?.kind === 'read' && read.areEarlierLeftOut,
    whyNotRead: read?.kind === 'notRead' ? read.why : null,
    behindAtChangeCount,
  };
  lastShownCellHistory = {
    open: cellHistory,
    profilesById,
    tablesRead,
    ownFilters,
    asOfWorkbook,
    behindAtChangeCount,
    places,
    shown,
  };
  return shown;
}
export const singleCellAddress = (position: CellPosition, ownRowOrder: OwnRowOrder | null): string =>
  areaToA1AsStored(
    {
      topRowIndex: position.rowIndex,
      leftColumnIndex: position.columnIndex,
      rowCount: 1,
      columnCount: 1,
    },
    ownRowOrder,
  );
export const shownTextOfCell = (cellId: CellId, workbook: WorkbookReads): string =>
  cellInputText(workbook.cellOf(cellId), workbook.decimalSign);
export const heldNowInScope = (cellId: CellId, scope: CellHistoryScope, workbook: WorkbookReads): string =>
  scope === 'row' ? rowHeldNow(cellId, workbook) : shownTextOfCell(cellId, workbook);
export const askCellHistoryAgain = (state: PageState): PageState =>
  state.cellHistory === null || state.cellHistory.awaited !== null
    ? state
    : {
        ...state,
        cellHistory: {
          ...state.cellHistory,
          awaited: 'toBePut',
          looksInVainInARow: 0,
        },
      };
export const isCellHistoryOutdated = ({ cellHistory, saving }: Pick<PageState, 'cellHistory' | 'saving'>): boolean =>
  cellHistory !== null &&
  cellHistory.read?.kind === 'read' &&
  cellHistory.awaited === null &&
  cellHistory.hasChangedSinceAsked &&
  saving === 'allSaved';
export const refreshCellHistory = (state: PageState): PageState =>
  state.cellHistory !== null && isCellHistoryOutdated(state)
    ? {
        ...state,
        cellHistory: {
          ...state.cellHistory,
          awaited: 'toBePut',
        },
      }
    : state;
export const isCellHistoryAwaiting = ({ cellHistory }: Pick<PageState, 'cellHistory'>, askId: number): boolean =>
  cellHistory?.awaited === askId;
lastShownCellHistory = null;
export const isSameOpenCellHistory = (lastOpen: CellHistory, cellHistory: CellHistory): boolean =>
  lastOpen.cell === cellHistory.cell &&
  lastOpen.scope === cellHistory.scope &&
  lastOpen.address === cellHistory.address &&
  lastOpen.canRowBeRead === cellHistory.canRowBeRead &&
  (lastOpen.awaited === null) === (cellHistory.awaited === null) &&
  lastOpen.read === cellHistory.read &&
  lastOpen.authorsAwaited === cellHistory.authorsAwaited;
