import type { SheetId } from '@open-artifact/sheets-core';
import { layoutOfView, findSheetById } from '../grid/layout.ts';
import type { LayoutView } from '../grid/layout.ts';
import { heightCoveredByStickyHeaders } from '../grid/sticky-headers.ts';
import { scrollToShowCell, clampScroll } from '../grid/geometry.ts';
import type { GridScroll } from '../grid/geometry.ts';
import { cachedSelectedArea } from '../presence/selections.ts';
import { revealAreaInCollapsedGroups } from '../grid/outline-groups.ts';
import { unhideAreaIfAllFiltered } from '../tables/filtered-rows.ts';
import { scrollToPlacedView } from '../charts/placed-views.ts';
import { showSheet } from '../state/sheet-tabs.ts';
import { changesSpanWholeLines } from './changes-by-agent.ts';
import type { CellsOfChange } from './changes-by-agent.ts';
import { unionOfAreas, isSameSelection } from '../selection/model.ts';
import type { CellArea } from '../selection/model.ts';
import { shownLineAtOrAfter } from '../model/line-sizes.ts';
import { pointDoneCardAtSheet, isAgentWorkingOnBlank, isChangeNotYetCounted } from './turn-of-agent.ts';
import { isNothingOpen, isEffectAnEdit } from '../state/edit-refusals.ts';
import type {
  CellsChanged,
  CellsChangedInSheet,
  GoneTo,
  PageState,
  RunOfAgentGoneTo,
  SheetShownForDone,
} from '../state/initial-state.ts';
import type { PlacementOnGrid, WorkbookReads } from '../model/workbook.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { AgentActivityChanged, ChangeArrivedFromAgent, PageContext, PageEvent } from '../state/event-reducer.ts';
import type { PageTransition } from '../state/transitions.ts';
/** A change to bring into view: its cells, the groups of them that lie apart, and the chart it placed. */
export interface ChangeToShow extends CellsChangedInSheet {
  chart?: PlacementOnGrid;
}
/** A change whose cells may also lie in other sheets. */
type ChangeOverSheets = CellsOfChange & Pick<ChangeArrivedFromAgent, 'inOtherSheets'>;
export function scrollAreaIntoView(state: PageState, reads: ReadsWithTextMeasurer, area: CellArea): PageState {
  let layout = layoutOfView(state, reads);
  let frozenView = {
    gridWidth: state.gridWidth - SCROLLBAR_ROOM / state.zoom,
    gridHeight: state.gridHeight,
    heightUnderWhatFloats: Math.max(state.heightUnderWhatFloats, FLOATING_FOOT_HEIGHT / state.zoom),
    noticesAtFoot: null,
  };
  let topLeft = {
    rowIndex: snapPastFrozenLines(area.topRowIndex, area.rowCount, layout.frozenRowCount),
    columnIndex: snapPastFrozenLines(area.leftColumnIndex, area.columnCount, layout.frozenColumnCount),
  };
  let view = {
    rowIndex: Math.max(0, topLeft.rowIndex - 1),
    columnIndex: Math.max(0, topLeft.columnIndex - 1),
  };
  let bottomRight = {
    rowIndex: area.topRowIndex + area.rowCount - 1,
    columnIndex: area.leftColumnIndex + area.columnCount - 1,
  };
  let { scrollLeft, scrollTop } = [bottomRight, view, topLeft].reduce<GridScroll>(
    (scroll, cell) => {
      let heightCovered = heightCoveredByStickyHeaders(state, reads, cell, layout);
      return scrollToShowCell(
        scroll,
        {
          ...cell,
          heightCovered,
        },
        layout,
        frozenView,
        'key',
      );
    },
    state,
  );
  let scrolled = {
    scrollLeft: area.columnCount < layout.columnCount ? scrollLeft : state.scrollLeft,
    scrollTop: area.rowCount < layout.rowCount ? scrollTop : state.scrollTop,
  };
  return {
    ...state,
    ...clampScroll(scrolled, layout, state),
  };
}
export function showChangeByAgent(state: PageState, reads: ReadsWithTextMeasurer, change: ChangeToShow): PageState {
  let { sheetId } = change.cells.activeCell;
  let sheetName = findSheetById(reads, sheetId)?.name;
  let areas = [change.cells, ...(change.groupsApart ?? []).slice(-1)].map((cells) => cachedSelectedArea(cells, reads));
  if (areas[0] === null || sheetName === undefined) return state;
  let { chart } = change;
  let showOnSheet = (onSheet: PageState) => {
    let shown = areas.reduce<PageState>(
      (view, area) =>
        area === null
          ? view
          : scrollAreaIntoView(revealAreaInCollapsedGroups(unhideAreaIfAllFiltered(view, reads, area), reads, area), reads, area),
      onSheet,
    );
    return chart === undefined ? shown : scrollToPlacedView(shown, reads, chart);
  };
  if (sheetId === state.sheetId) return showOnSheet(state);
  let withSheetShown = showSheet(state, reads, sheetId);
  if (withSheetShown === state) return state;
  let lastDone: SheetShownForDone = {
    what: 'sheetShownToFollow',
    name: sheetName,
  };
  return showOnSheet({
    ...withSheetShown,
    notice: state.notice,
    lastDone,
  });
}
export function mergeChangedAreas(
  areas: CellsChanged[],
  changes: ChangeOverSheets[],
  reads: WorkbookReads,
  isAppended: boolean = false,
): CellsChanged[] {
  return changes
    .flatMap((change) => [change, ...(change.inOtherSheets ?? [])])
    .reduce((merged, { cells }) => {
      let { sheetId } = cells.activeCell;
      const changedArea = cachedSelectedArea(cells, reads);
      if (
        changedArea === null ||
        (!isAppended &&
          changesSpanWholeLines(
            [
              {
                cells,
              },
            ],
            reads,
          ))
      )
        return merged;
      let onSameSheet = merged.find(isOnSheet(sheetId));
      let areaOnSameSheet = onSameSheet === undefined ? null : cachedSelectedArea(onSameSheet, reads);
      let joinedArea = areaOnSameSheet === null ? changedArea : unionOfAreas(areaOnSameSheet, changedArea);
      let topLeftCell = reads.cellIdAt(sheetId, joinedArea.topRowIndex, joinedArea.leftColumnIndex);
      let bottomRightCell = reads.cellIdAt(
        sheetId,
        joinedArea.topRowIndex + joinedArea.rowCount - 1,
        joinedArea.leftColumnIndex + joinedArea.columnCount - 1,
      );
      return topLeftCell === null || bottomRightCell === null
        ? merged
        : [
            ...merged.filter((cellsOfSheet) => cellsOfSheet !== onSameSheet),
            {
              activeCell: topLeftCell,
              selectionCorner: bottomRightCell,
            },
          ];
    }, areas);
}
export function isChangeInView(state: LayoutView, reads: ReadsWithTextMeasurer, cells: CellsChanged): boolean {
  let area = cachedSelectedArea(cells, reads);
  if (area === null) return false;
  let { rowEdges, columnEdges } = layoutOfView(
    {
      ...state,
      sheetId: cells.activeCell.sheetId,
    },
    reads,
  );
  return (
    shownLineAtOrAfter(rowEdges, area.topRowIndex) < area.topRowIndex + area.rowCount &&
    shownLineAtOrAfter(columnEdges, area.leftColumnIndex) < area.leftColumnIndex + area.columnCount
  );
}
export function changesInView(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  changes: ChangeToShow & Pick<ChangeArrivedFromAgent, 'inOtherSheets'>,
): ChangeToShow[] {
  let isShownHere = (cells: CellsChanged) => isOnSheet(state.sheetId)(cells) && isChangeInView(state, reads, cells);
  return [changes, ...(changes.inOtherSheets ?? [])].flatMap(({ cells, groupsApart = [] }) => {
    let groups = groupsApart.length === 0 ? [cells] : groupsApart;
    let groupsShown = groups.filter(isShownHere);
    let { chart }: Pick<ChangeToShow, 'chart'> = cells === changes.cells ? changes : {};
    return groupsShown.length === groups.length
      ? [
          {
            cells,
            groupsApart,
            ...(chart !== undefined && {
              chart,
            }),
          },
        ]
      : groupsShown.map(
          (group) => ({
            cells: group,
          }),
        );
  });
}
export function nextRunOfAgentGoneTo(
  run: RunOfAgentGoneTo | null,
  reads: WorkbookReads,
  { revision, inRunSince = revision }: Pick<ChangeArrivedFromAgent, 'revision' | 'inRunSince'>,
  { cells, chart }: ChangeToShow,
): RunOfAgentGoneTo {
  let runArea =
    run?.since === inRunSince && isOnSheet(cells.activeCell.sheetId)(run.cells) && chart === undefined ? cachedSelectedArea(run.cells, reads) : null;
  let area = cachedSelectedArea(cells, reads);
  if (run === null || runArea === null || area === null)
    return {
      since: inRunSince,
      cells,
    };
  let isRowsApart =
    area.topRowIndex > runArea.topRowIndex + runArea.rowCount + 1 || runArea.topRowIndex > area.topRowIndex + area.rowCount + 1;
  let isColumnsApart =
    area.leftColumnIndex >= runArea.leftColumnIndex + runArea.columnCount || runArea.leftColumnIndex >= area.leftColumnIndex + area.columnCount;
  let [merged = cells] =
    isRowsApart || isColumnsApart
      ? []
      : mergeChangedAreas(
          [run.cells],
          [
            {
              cells,
            },
          ],
          reads,
          true,
        );
  return {
    since: inRunSince,
    cells: merged,
  };
}
export function changeToShowFirst(state: PageState, reads: ReadsWithTextMeasurer): CellsChanged | undefined {
  let {
    changedSinceRest,
    changedOffShowSinceRest,
    followsOnOneSheet,
    sheetId,
  } = state;
  if (followsOnOneSheet === 'no')
    return reads.listSheets().flatMap(({ sheetId: sheetIdInOrder }) => changedSinceRest.filter(isOnSheet(sheetIdInOrder)))[0];
  if (changedOffShowSinceRest === null) return changedSinceRest.find(isOnSheet(sheetId));
  let sizeOf = (cells: CellsChanged) => {
    let area = cachedSelectedArea(cells, reads);
    return area === null ? 0 : area.rowCount * area.columnCount;
  };
  return changedOffShowSinceRest
    .filter((cells) => isChangeInView(state, reads, cells))
    .reduce<CellsChanged | undefined>(
      (largest, cells) => (largest === undefined || sizeOf(cells) >= sizeOf(largest) ? cells : largest),
      undefined,
    );
}
export function chartGoneToAtSelection(
  { chartGoneToSinceRest }: Pick<PageState, 'chartGoneToSinceRest'>,
  workbook: WorkbookReads,
  cells: CellsChanged,
): PlacementOnGrid | undefined {
  if (chartGoneToSinceRest === null) return;
  let placement = workbook
    .placementsIn(cells.activeCell.sheetId)
    .find(({ placementId }) => placementId === chartGoneToSinceRest);
  let area = cachedSelectedArea(cells, workbook);
  return area?.rowCount === 1 && area.columnCount === 1 && area.topRowIndex === placement?.rowIndex && area.leftColumnIndex === placement.columnIndex
    ? placement
    : undefined;
}
export function changeToShowAtRest(state: PageState, reads: ReadsWithTextMeasurer, lastGoneTo: GoneTo | null): ChangeToShow | undefined {
  if (lastGoneTo === null) {
    let cells = changeToShowFirst(state, reads);
    let chart = cells === undefined ? undefined : chartGoneToAtSelection(state, reads, cells);
    return cells === undefined
      ? undefined
      : {
          cells,
          ...(chart !== undefined && {
            chart,
          }),
        };
  }
  let { cells, chart: chartId } = lastGoneTo;
  let placement = reads.placementsIn(cells.activeCell.sheetId).find((placed) => placed.placementId === chartId);
  return changesInView(state, reads, {
    cells,
    ...(placement !== undefined && {
      chart: placement,
    }),
  }).at(-1);
}
export function showChangesAtAgentRest(
  state: PageState,
  workbook: ReadsWithTextMeasurer,
  target: ChangeToShow | undefined,
  isFirstShow: boolean,
): PageState {
  let restState: PageState = {
    ...followStateAtRest(state),
    changedOffShowSinceRest: [],
  };
  if (target === undefined) return restState;
  let shownBefore = (
    isFirstShow && state.followsOnOneSheet === 'no' && cachedSelectedArea(target.cells, workbook) !== null ? state.changedSinceRest : []
  )
    .filter((cells) => isChangeInView(state, workbook, cells))
    .reduce<PageState>(
      (shown, cells) =>
        showChangeByAgent(shown, workbook, {
          cells,
        }),
      restState,
    );
  let shown = showChangeByAgent(shownBefore, workbook, target);
  let withDoneKept: PageState =
    shown.sheetId === state.sheetId
      ? {
          ...shown,
          lastDone: state.lastDone,
        }
      : shown;
  return pointDoneCardAtSheet(withDoneKept, workbook);
}
export function stepFollowAgent(before: PageState, step: PageTransition, event: PageEvent, context: PageContext): PageState {
  let { reads: workbook } = context;
  let state: PageState =
    (before.shownByAgent?.place ?? null) === null
      ? step.state
      : {
          ...followStateAtRest(step.state),
          isFirstBuild: step.state.isFirstBuild && workbook.isEveryCellBlank,
        };
  if (state.isAgentWorking && !before.isAgentWorking) {
    const isAsSpreadsheetOpens = event.kind === 'agentActivityChanged' && event.isAsSpreadsheetOpens === true;
    let mayEdit = context.refusalOfEveryEdit === null;
    let startsFollowing =
      (((before.isFollowingAgent && before.followsOnOneSheet === 'no') || isAsSpreadsheetOpens) && mayEdit) || isAgentWorkingOnBlank(state, context);
    let isToFollowOnOneSheet = !startsFollowing && mayEdit && event.kind === 'agentActivityChanged' && event.isPersonAtWorkInPage !== true;
    let isFree = isViewFreeToFollow(state);
    let followsOnOneSheetBefore = before.isFollowingAgent ? before.followsOnOneSheet : 'yetToMove';
    let followingState: PageState = {
      ...state,
      isFollowingAgent: (startsFollowing || isToFollowOnOneSheet) && isFree,
      followsOnOneSheet: isToFollowOnOneSheet && isFree ? followsOnOneSheetBefore : 'no',
    };
    if (before.isFollowingAgent) return followingState;
    let changesSoFar = isAsSpreadsheetOpens
      ? state.changesByAgent.flatMap((change) => [...change.joinedWith, change])
      : [];
    let areasOfNewSheet = isAsSpreadsheetOpens && event.isSheetJustMade === true ? wholeSheetsAsChanges(workbook) : [];
    let [changed, heldAsSheetOpened] = [
      mergeChangedAreas([], changesSoFar, workbook),
      mergeChangedAreas([], areasOfNewSheet, workbook, true),
    ];
    return {
      ...followingState,
      ...changesSinceRestState(changed.length > 0, changed, heldAsSheetOpened, workbook),
      changedOffShowSinceRest: [],
      chartGoneToSinceRest: null,
      lastGoneTo: null,
    };
  }
  if (!state.isFollowingAgent) return state;
  if (doesPersonTakeViewBack(before, step, event))
    return {
      ...state,
      isFollowingAgent: false,
      followsOnOneSheet: 'no',
      hasPersonTakenViewBack: true,
    };
  if (event.kind === 'agentActivityChanged' && before.isAgentWorking && !state.isAgentWorking) {
    let isPersonAtWork = event.isPersonAtWorkInPage === true;
    let lastGoneTo = before.isFirstBuild ? null : state.lastGoneTo;
    let target = isPersonAtWork ? undefined : changeToShowAtRest(state, workbook, lastGoneTo);
    let shown = showChangesAtAgentRest(state, workbook, target, lastGoneTo === null);
    return state.saidOfAgent === before.saidOfAgent && shown.saidOfAgent !== before.saidOfAgent
      ? {
          ...shown,
          saidOfAgent: before.saidOfAgent,
        }
      : shown;
  }
  if (event.kind !== 'changesByAgentChanged') return state;
  let isOnOneSheet = state.isFollowingAgent && state.followsOnOneSheet !== 'no';
  let isFollowed = ({ cells, isOfViewer, isOfLayoutAlone }: ChangeArrivedFromAgent) =>
    ((state.isAgentWorking && !isOnOneSheet) || isOfViewer === true) &&
    isOfLayoutAlone !== true &&
    (isOnOneSheet || event.isPersonAtWorkInPage !== true || cells.activeCell.sheetId === state.sheetId);
  let changes = event.changes.filter((change) => isChangeNotYetCounted(before)(change) && isFollowed(change));
  let followedChanges: ChangeToShow[] = isOnOneSheet ? changes.flatMap((change) => changesInView(state, workbook, change)) : changes;
  let lastChange = followedChanges.at(-1);
  if (lastChange === undefined) {
    let { changedOffShowSinceRest } = state;
    if (changedOffShowSinceRest === null || !state.isAgentWorking || changes.length === 0) return state;
    let offShow = mergeChangedAreas(changedOffShowSinceRest, changes, workbook).filter(
      (cells) => !isOnSheet(state.sheetId)(cells),
    );
    let chartGoneTo =
      changes.findLast(({ cells, chart }) => chart !== undefined && !isOnSheet(state.sheetId)(cells))?.chart
        ?.placementId ?? state.chartGoneToSinceRest;
    return {
      ...state,
      changedOffShowSinceRest: offShow,
      chartGoneToSinceRest: chartGoneTo,
    };
  }
  let changedSinceRest = mergeChangedAreas(state.changedSinceRest, followedChanges, workbook);
  let chartGoneTo =
    followedChanges.findLast(({ chart }) => chart !== undefined)?.chart?.placementId ?? state.chartGoneToSinceRest;
  let nextState: PageState = {
    ...state,
    ...changesSinceRestState(true, changedSinceRest, state.heldAsSheetOpened, workbook),
    changedOffShowSinceRest: null,
    chartGoneToSinceRest: chartGoneTo,
  };
  let runOfAgentGoneTo = changes.reduce<RunOfAgentGoneTo | null>((run, change) => {
    let inView = (isOnOneSheet ? changesInView(state, workbook, change) : [change]).at(-1);
    return inView === undefined ? run : nextRunOfAgentGoneTo(run, workbook, change, inView);
  }, state.runOfAgentGoneTo);
  let shownChange: ChangeToShow =
    runOfAgentGoneTo === null || runOfAgentGoneTo.cells === lastChange.cells
      ? lastChange
      : {
          cells: runOfAgentGoneTo.cells,
        };
  let lastGoneTo: GoneTo = {
    cells: shownChange.groupsApart?.at(-1) ?? shownChange.cells,
    chart: shownChange.chart?.placementId ?? null,
  };
  let followingState: PageState = {
    ...nextState,
    runOfAgentGoneTo,
    lastGoneTo,
    isFollowingAgent: true,
  };
  return showChangeByAgent(followingState, workbook, shownChange);
}
export const FLOATING_FOOT_HEIGHT = 146;
export const SCROLLBAR_ROOM = 24;
export const snapPastFrozenLines = (start: number, length: number, frozenEnd: number): number =>
  start < frozenEnd && start + length > frozenEnd ? frozenEnd : start;
export const isOnSheet =
  (sheetId: SheetId) =>
  ({ activeCell }: Pick<CellsChanged, 'activeCell'>): boolean =>
    activeCell.sheetId === sheetId;
export const wholeSheetsAsChanges = (reads: WorkbookReads): CellsOfChange[] =>
  reads.listSheets().flatMap(({ sheetId, rowCount, columnCount }) => {
    let wholeSheet = {
      topRowIndex: 0,
      leftColumnIndex: 0,
      rowCount,
      columnCount,
    };
    let areaOnShow = reads.areaOnShowIn(sheetId, wholeSheet);
    if (areaOnShow === null) return [];
    let topLeftCell = reads.cellIdAt(sheetId, areaOnShow.topRowIndex, areaOnShow.leftColumnIndex);
    let bottomRightCell = reads.cellIdAt(
      sheetId,
      areaOnShow.topRowIndex + areaOnShow.rowCount - 1,
      areaOnShow.leftColumnIndex + areaOnShow.columnCount - 1,
    );
    return topLeftCell === null || bottomRightCell === null
      ? []
      : [
          {
            cells: {
              activeCell: topLeftCell,
              selectionCorner: bottomRightCell,
            },
          },
        ];
  });
export const changesSinceRestState = (
  isFollowing: boolean,
  changedSinceRest: CellsChanged[],
  heldAsSheetOpened: CellsChanged[],
  reads: WorkbookReads,
): Pick<PageState, 'changedSinceRest' | 'heldAsSheetOpened'> =>
  !isFollowing
    ? {
        changedSinceRest,
        heldAsSheetOpened,
      }
    : {
        changedSinceRest: mergeChangedAreas(
          changedSinceRest,
          heldAsSheetOpened.map(
            (cells) => ({
              cells,
            }),
          ),
          reads,
          true,
        ),
        heldAsSheetOpened: [],
      };
export const nextIsFirstBuild = (
  { isFirstBuild }: Pick<PageState, 'isFirstBuild'>,
  activity: Pick<AgentActivityChanged, 'isWorking' | 'isAsSpreadsheetOpens' | 'isSheetJustMade'>,
  { isEveryCellBlank }: Pick<WorkbookReads, 'isEveryCellBlank'>,
): boolean =>
  activity.isWorking
    ? isFirstBuild || isEveryCellBlank || (activity.isAsSpreadsheetOpens === true && activity.isSheetJustMade === true)
    : isFirstBuild && isEveryCellBlank;
export const followStateAtRest = (state: PageState): PageState => ({
  ...state,
  changedSinceRest: [],
  heldAsSheetOpened: [],
  chartGoneToSinceRest: null,
  lastGoneTo: null,
});
export const isViewFreeToFollow = (state: PageState) =>
  state.mode.kind === 'navigating' &&
  state.dragging === null &&
  !state.isActShownAsCalculated &&
  state.contextBarMenu === null &&
  state.caretAtEnd === null &&
  state.ownFilterList === null &&
  isNothingOpen(state);
export const doesPersonTakeViewBack = (before: PageState, { state, effects }: PageTransition, event: PageEvent): boolean =>
  event.kind === 'viewTakenBack' ||
  event.kind === 'wheelTurned' ||
  event.kind === 'rowsPutOutOfViewByOwnFilters' ||
  event.kind === 'ownFilterAsked' ||
  event.kind === 'ownFilterByCellChosen' ||
  event.kind === 'ownFilterLineRemoved' ||
  event.kind === 'ownFilterListSortChosen' ||
  event.kind === 'ownSortRemoved' ||
  event.kind === 'namedViewPicked' ||
  event.kind === 'ownFiltersCleared' ||
  event.kind === 'ownFiltersRefreshed' ||
  event.kind === 'ownFilterListActedIn' ||
  event.kind === 'rowsAskedForActedOn' ||
  (event.kind !== 'editOfChartAsked' && effects.some(isEffectAnEdit)) ||
  (event.kind === 'editAnswered' && event.ifQueued.askOfChart === undefined) ||
  event.kind === 'undoOrRedoAnswered' ||
  event.kind === 'takeBackAnswered' ||
  !isViewFreeToFollow(state) ||
  (event.kind !== 'workbookChanged' && event.kind !== 'ownRowOrderSeen' && !isSameSelection(before, state));
