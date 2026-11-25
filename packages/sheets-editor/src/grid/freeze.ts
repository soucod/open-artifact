import type { Edit, SheetId } from '@open-artifact/sheets-core';
import type { CellId } from '../model/workbook.ts';
import type { FreezingDrag } from '../state/initial-state.ts';
import type { FreezeChosen, IfQueued, PageContext, PointerPressed } from '../state/event-reducer.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { GridPoint, LinesAxisName } from './geometry.ts';
import { layoutOfView, sheetOfViewOrEmpty, clampScrollOfView } from './layout.ts';
import { frozenCountsThatFit, freezeGripAt, dropIndexAtPointer } from './geometry.ts';
import { selectedArea } from '../selection/model.ts';
import { queueEdit, IF_QUEUED_DEFAULTS } from '../model/edit-effects.ts';
import { shownCellText } from '../format/shown-text.ts';
import { cellBlockOfCorners } from '../model/cell-blocks.ts';
import { areaRefBetween } from '../model/workbook.ts';
import { LIGHT_GRAY_HEX } from '../model/cell-format.ts';
import { withNoEffects } from '../state/transitions.ts';
import { holdFreezingAndKeepActiveCellInView } from '../selection/keep-in-view.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { PageState } from '../state/initial-state.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
/** A count of rows or columns the menu offers to freeze. */
export interface FreezeChoice {
  count: number;
  isInForce: boolean;
  /** Whether that many frozen lines leave room to scroll the rest. */
  isRoom: boolean;
  isUpToSelection: boolean;
}
/** How a freeze edit is queued; the fields past those of any queued edit are set only by `freezeFirstRows`, and nothing reads them yet. */
export interface IfFreezeQueued extends Omit<IfQueued, 'select'> {
  isOfOneAct?: true;
  thenEdits?: Edit[];
  isOnlyDressing?: true;
  isLeftUnselectedByUndo?: true;
}
/** A pointer over the grid, and whether it is a finger. */
export type PointerOverGrip = GridPoint & Pick<PointerPressed, 'isByFinger'>;
/** A header cell the first rows are dressed by, and its text. */
interface HeaderToDress {
  cellId: CellId;
  text: string;
}
export function freezeChoiceList(countInForce: number, countUpToSelection: number, roomFor: number, shownCount: number): FreezeChoice[] {
  let counts = [...new Set([...FREEZE_COUNTS_OFFERED, countUpToSelection])].filter(
    (count) => count < shownCount && count !== countInForce,
  );
  counts.push(countInForce);
  counts.sort((count, otherCount) => count - otherCount);
  return counts.map(
    (count) => ({
      count,
      isInForce: count === countInForce,
      isRoom: count <= roomFor,
      isUpToSelection: count === countUpToSelection,
    }),
  );
}
export function suggestedFreezeChoice(choices: readonly FreezeChoice[]): FreezeChoice | null {
  let countInForce = choices.find((choice) => choice.isInForce)?.count ?? 0;
  let upToSelection = choices.find((choice) => choice.isUpToSelection && choice.count > countInForce);
  if (upToSelection?.isRoom === true || countInForce === 0) return upToSelection ?? null;
  return choices.find((choice) => choice.count === 0) ?? null;
}
export function freezeChoicesOf(state: PageState, workbook: ReadsWithTextMeasurer): Record<LinesAxisName, FreezeChoice[]> {
  let layout = layoutOfView(state, workbook);
  let frozen = sheetOfViewOrEmpty(state, workbook);
  let fitting = frozenCountsThatFit(
    {
      frozenRowCount: layout.rowCount,
      frozenColumnCount: layout.columnCount,
    },
    layout,
    state,
  );
  let areaSelected = selectedArea(state, workbook);
  return {
    rows: freezeChoiceList(
      frozen.frozenRowCount,
      areaSelected === null ? 0 : areaSelected.topRowIndex + areaSelected.rowCount,
      fitting.frozenRowCount,
      layout.rowCount,
    ),
    columns: freezeChoiceList(
      frozen.frozenColumnCount,
      areaSelected === null ? 0 : areaSelected.leftColumnIndex + areaSelected.columnCount,
      fitting.frozenColumnCount,
      layout.columnCount,
    ),
  };
}
export function queueFreezeEdit(
  state: PageState,
  workbook: WorkbookReads,
  what: LinesAxisName,
  count: number,
  ifQueued: IfFreezeQueued,
): PageTransition {
  let { sheetId } = state;
  let lastFrozenCell = what === 'rows' ? workbook.cellIdAt(sheetId, count - 1, 0) : workbook.cellIdAt(sheetId, 0, count - 1);
  let settings =
    what === 'rows'
      ? {
          lastFrozenRow: lastFrozenCell?.rowId ?? null,
        }
      : {
          lastFrozenColumn: lastFrozenCell?.columnId ?? null,
        };
  return queueEdit(
    state,
    {
      kind: 'setSheetSettings',
      sheetId,
      settings,
    },
    {
      ...IF_QUEUED_DEFAULTS,
      select: null,
      ...ifQueued,
    },
  );
}
export function headerDressingEdits(workbook: WorkbookReads, sheetId: SheetId, rowCount: number): Edit[] {
  let headers: HeaderToDress[] = [];
  while (headers.length < MOST_HEADER_COLUMNS_DRESSED) {
    let cellId = workbook.cellIdAt(sheetId, rowCount - 1, headers.length);
    let cell = cellId === null ? null : workbook.cellOf(cellId);
    if (cellId === null || cell === null) break;
    headers.push({
      cellId,
      text: shownCellText(cell, 1 / 0, workbook.decimalSign).text,
    });
  }
  let firstCell = workbook.cellIdAt(sheetId, 0, 0);
  let lastHeader = headers.at(-1);
  let headerArea =
    firstCell === null || lastHeader === undefined ? null : cellBlockOfCorners(workbook, areaRefBetween(firstCell, lastHeader.cellId));
  if (firstCell === null || lastHeader === undefined || headerArea === null) return [];
  let hasLongTextBelow = (columnIndex: number) =>
    Array.from(
      {
        length: ROWS_SCANNED_FOR_LONG_TEXT,
      },
      (_slot, rowIndex) => workbook.cellIdAt(sheetId, rowIndex, columnIndex),
    ).some((cellId) => {
      let cell = cellId === null ? null : workbook.cellOf(cellId);
      return cell !== null && shownCellText(cell, 1 / 0, workbook.decimalSign).text.length > HEADER_WIDTH_CAP.inCharacters;
    });
  return [
    {
      kind: 'formatCells',
      cells: headerArea,
      format: {
        fillColor: {
          kind: 'rgb',
          hex: LIGHT_GRAY_HEX,
        },
      },
    },
    {
      kind: 'fitColumns',
      sheetId,
      oneColumn: firstCell.columnId,
      otherColumn: lastHeader.cellId.columnId,
      noNarrowerThan: headers.map(
        ({ cellId, text }) => ({
          column: cellId.columnId,
          widthInPixels: Math.min(HEADER_WIDTH_CAP.inPixels, Math.ceil(text.length * HEADER_FIT_WIDTHS.ofACharacter) + HEADER_FIT_WIDTHS.besideText),
        }),
      ),
    },
    ...headers.flatMap(
      ({ cellId: { columnId } }, columnIndex): Edit[] =>
        hasLongTextBelow(columnIndex)
          ? [
              {
                kind: 'setColumnWidths',
                sheetId,
                oneColumn: columnId,
                otherColumn: columnId,
                widthInPixels: HEADER_WIDTH_CAP.inPixels,
              },
            ]
          : [],
    ),
  ];
}
export function applyFreezeChoice(
  state: PageState,
  workbook: ReadsWithTextMeasurer,
  { what, count }: Pick<FreezeChosen, 'what' | 'count'>,
): PageTransition {
  let choice = freezeChoicesOf(state, workbook)[what].find((offered) => offered.count === count);
  if (choice === undefined || !choice.isRoom || choice.isInForce) return withNoEffects(state);
  return queueFreezeEdit(state, workbook, what, count, {
    done: {
      what: what === 'rows' ? 'rowsFrozen' : 'columnsFrozen',
      count,
    },
  });
}
export function startFreezeDrag(
  state: PageState,
  pointer: PointerOverGrip,
  { reads, refusalOfEveryEdit }: Pick<PageContext, 'reads' | 'refusalOfEveryEdit'>,
): PageState | null {
  if (refusalOfEveryEdit !== null || state.mode.kind === 'editing' || pointer.isByFinger) return null;
  let layout = layoutOfView(state, reads);
  let what = freezeGripAt(pointer, layout);
  if (what === null) return null;
  let { sheetId } = state;
  let pressedAt = {
    x: pointer.x,
    y: pointer.y,
  };
  let countAtPress = what === 'rows' ? layout.frozenRowCount : layout.frozenColumnCount;
  return {
    ...state,
    menu: null,
    calendar: null,
    dropdown: null,
    peopleList: null,
    dragging: {
      kind: 'freezing',
      sheetId,
      what,
      pressedAt,
      countAtPress,
      count: null,
    },
  };
}
export function dragFreezeTo(state: PageState, dragging: FreezingDrag, pointer: GridPoint, reads: ReadsWithTextMeasurer): PageState {
  let scrolled = scrollToStartAlong(state, dragging.what);
  let layout = layoutOfView(scrolled, reads);
  let shownCount = dragging.what === 'rows' ? layout.rowCount : layout.columnCount;
  let count = Math.min(dropIndexAtPointer(pointer, scrolled, layout, scrolled, dragging.what), shownCount - 1);
  let fitting = frozenCountsThatFit(
    {
      frozenRowCount: count,
      frozenColumnCount: count,
    },
    layout,
    scrolled,
  );
  let countThatFits = dragging.what === 'rows' ? fitting.frozenRowCount : fitting.frozenColumnCount;
  return countThatFits === dragging.count
    ? state
    : {
        ...state,
        dragging: {
          ...dragging,
          count: countThatFits,
        },
      };
}
export function finishFreezeDrag(
  state: PageState,
  drag: FreezingDrag,
  { reads, refusalOfEveryEdit }: Pick<PageContext, 'reads' | 'refusalOfEveryEdit'>,
): PageTransition {
  let view = clampScrollOfView(
    {
      ...state,
      dragging: null,
    },
    reads,
  );
  if (drag.count === null || drag.count === drag.countAtPress) return withNoEffects(view);
  if (drag.sheetId !== view.sheetId) return withNoEffects(view);
  if (refusalOfEveryEdit !== null)
    return withNoEffects({
      ...view,
      notice: {
        kind: 'editRefused',
        why: refusalOfEveryEdit,
        asked: 'otherEdit',
      },
    });
  let scrolledView = scrollToStartAlong(
    {
      ...view,
      lastDone: null,
    },
    drag.what,
  );
  let { rowCount, columnCount } = layoutOfView(view, reads);
  let count = Math.min(drag.count, (drag.what === 'rows' ? rowCount : columnCount) - 1);
  let { scrollLeft, scrollTop } = view;
  let scrollIfRefused = {
    scrollLeft,
    scrollTop,
  };
  let queued = queueFreezeEdit(scrolledView, reads, drag.what, count, {
    done: null,
    scrollIfRefused,
  });
  return holdFreezingAndKeepActiveCellInView(
    scrolledView,
    queued,
    {
      ...drag,
      count,
    },
    reads,
  );
}
export const FREEZE_COUNTS_OFFERED = [0, 1, 2];
export const freezeFirstRows = (state: PageState, workbook: WorkbookReads, rowCount: number, { isThenDressed }: { isThenDressed: boolean }): PageTransition =>
  queueFreezeEdit(state, workbook, 'rows', rowCount, {
    done: null,
    isOfOneAct: true,
    ...(isThenDressed && {
      thenEdits: headerDressingEdits(workbook, state.sheetId, rowCount),
      undoOffer: state.undoOffer,
      isOnlyDressing: true,
      isLeftUnselectedByUndo: true,
    }),
  });
export const HEADER_FIT_WIDTHS = {
  ofACharacter: 7.6,
  besideText: 44,
};
export const HEADER_WIDTH_CAP = {
  inCharacters: 48,
  inPixels: 360,
};
export const ROWS_SCANNED_FOR_LONG_TEXT = 60;
export const MOST_HEADER_COLUMNS_DRESSED = 1000;
export const scrollToStartAlong = <View extends Pick<PageState, 'scrollTop' | 'scrollLeft'>>(state: View, what: LinesAxisName): View =>
  what === 'rows'
    ? {
        ...state,
        scrollTop: 0,
      }
    : {
        ...state,
        scrollLeft: 0,
      };
