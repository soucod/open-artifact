import type { Edit } from '@open-artifact/sheets-core';
import { sheetOfView, layoutOfView, findSheetById, clampScrollOfView, keepScrollAnchoredAcrossChange } from './layout.ts';
import { withOwnCollapsing, groupsNotInsideCollapsed, collapsedIndexRuns, clipIndexRuns } from './line-runs.ts';
import {
  selectedArea,
  selectionAreaAndKind,
  isSameCell,
  mergedAreaOrCellOf,
  moveActiveCellTo,
  selectionAtCell,
  scrollToShowSelection,
} from '../selection/model.ts';
import { shownLineAtOrBefore, shownLineAtOrAfter, collapseLineSizes, nearestShownLine } from '../model/line-sizes.ts';
import { isSelectionOneCell } from '../selection/keyboard.ts';
import { withoutOtherRanges } from '../selection/several-ranges.ts';
import { queueEdit, IF_QUEUED_DEFAULTS } from '../model/edit-effects.ts';
import { withNoEffects } from '../state/transitions.ts';
import { defaultRowHeightAtDensity, ROW_HEADER_WIDTH } from './cell-metrics-values.ts';
import { COLUMN_HEADER_HEIGHT } from './cell-metrics.ts';
import { rowPanes, columnPanes, rowRunSpanOnScreen, columnRunSpanOnScreen } from './geometry.ts';
import { rowLabelEnds, columnLabelEnds } from '../model/a1-references.ts';
import type { GroupOnGrid, SheetSummary, WorkbookReads } from '../model/workbook.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { LineSpan } from '../model/line-ids.ts';
import type { LineSizes } from '../model/line-sizes.ts';
import type { LabelEnds } from '../model/a1-references.ts';
import type { CellArea } from '../selection/model.ts';
import type { GroupDone, GroupsDone, PageState, ShownToLevelDone } from '../state/initial-state.ts';
import type { PageContext } from '../state/event-reducer.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { OutlineGroupAct } from '../keys/key-acts.ts';
import type { GridLayout, LayoutView } from './layout.ts';
import type { GridPane, LinesAxisName, SpanOnScreen } from './geometry.ts';
import type { Place } from '../state/places.ts';
/** The acts that collapse or expand groups. */
export type GroupToggleAct = Extract<OutlineGroupAct, 'collapse' | 'expand'>;
/** The acts that group lines or ungroup them. */
export type GroupingAct = Extract<OutlineGroupAct, 'group' | 'ungroup'>;
/** The commands that group, ungroup, collapse or expand rows or columns. */
export type OutlineCommand =
  | 'groupRows'
  | 'groupColumns'
  | 'ungroupRows'
  | 'ungroupColumns'
  | 'collapseRows'
  | 'collapseColumns'
  | 'expandRows'
  | 'expandColumns';
/** What is said to be done when groups are collapsed, expanded or shown to a level. */
export type GroupCollapsingDone = GroupDone | GroupsDone | ShownToLevelDone;
/** What of the page the outline groups are read and changed with. */
export type OutlineContext = Pick<PageContext, 'reads' | 'refusalOfEveryEdit'>;
/** Of the view, what places the outline on screen. */
export type OutlineScreenView = Pick<PageState, 'scrollTop' | 'scrollLeft' | 'gridHeight' | 'gridWidth'>;
/** Of the view, what the outline margin is drawn from. */
export type OutlineGutterView = OutlineScreenView & Pick<PageState, 'sheetId' | 'ownCollapsing' | 'density'>;
/** The lines of a layout along one axis: their edges and how many there are. */
export interface LinesOnAxis {
  edges: LineSizes;
  count: number;
}
/** Groups side by side at one depth, collapsed together, drawn as one mark. */
export interface OutlineRun extends GroupOnGrid {
  groupIds: string[];
}
/** The bracket drawn along an open group, from its mark to its end. */
export interface OutlineBracket {
  start: number;
  end: number;
  endsInView: boolean;
  startsBeforeMark: boolean;
}
/** A group's mark in the outline margin: its lane, where it sits, its labels, and its bracket when it is open. */
export interface OutlineMark extends LabelEnds {
  key: string;
  groupIds: string[];
  lane: number;
  isCollapsed: boolean;
  markAt: number;
  line: OutlineBracket | null;
}
/** The outline margin along one axis: how much room it takes, its level buttons and its marks. */
export interface OutlineGutter {
  of: LinesAxisName;
  size: number;
  beforeBody: number;
  levelCount: number;
  hasLevelButtons: boolean;
  groups: OutlineMark[];
}
/** The outline margins of the rows and the columns, when there are groups on them. */
export interface OutlineGutters {
  rows: OutlineGutter | null;
  columns: OutlineGutter | null;
}
/** A seam drawn where lines are out of sight, and the lines it stands for. */
export interface HiddenLineSeam {
  at: number;
  lines: LineSpan;
}
export function outlineGroupsOfView(view: Pick<PageState, 'sheetId' | 'ownCollapsing'>, reads: WorkbookReads, axis: LinesAxisName): readonly GroupOnGrid[] {
  let sheet = sheetOfView(view, reads);
  return sheet === undefined ? [] : withOwnCollapsing(view.ownCollapsing, outlineGroupsOnAxis(sheet, axis));
}
export function collapsibleGroupsAtSelection(view: PageState, reads: WorkbookReads, axis: LinesAxisName): GroupOnGrid[] {
  let area = selectedArea(view, reads);
  if (area === null) return [];
  let span = areaSpanOnAxis(area, axis);
  let openGroups = groupsNotInsideCollapsed(outlineGroupsOfView(view, reads, axis)).filter(
    (group: GroupOnGrid) => !group.isCollapsed && doSpansOverlap(group, span),
  );
  return openGroups.filter((group: GroupOnGrid, index: number) => {
    let next = openGroups[index + 1];
    return next === undefined || !isSpanWithin(next, group);
  });
}
export function expandableGroupsAtSelection(view: PageState, reads: ReadsWithTextMeasurer, axis: LinesAxisName): GroupOnGrid[] {
  let area = selectedArea(view, reads);
  if (area === null) return [];
  let span = areaSpanOnAxis(area, axis);
  let { edges } = layoutLinesOnAxis(layoutOfView(view, reads), axis);
  let firstShown = shownLineAtOrBefore(edges, span.firstIndex - 1) + 1;
  let shownSpan: LineSpan = {
    firstIndex: firstShown,
    count: shownLineAtOrAfter(edges, outlineSpanEnd(span)) - firstShown,
  };
  return groupsNotInsideCollapsed(outlineGroupsOfView(view, reads, axis)).filter(
    (group: GroupOnGrid) => group.isCollapsed && isSpanWithin(group, shownSpan),
  );
}
export function outlineAxisForAct(view: PageState, reads: ReadsWithTextMeasurer, act: OutlineGroupAct): LinesAxisName {
  if (selectionAreaAndKind(view, reads)?.kind === 'columns') return 'columns';
  if (view.movedClearOfColumnsTo === null || (act !== 'collapse' && act !== 'expand')) return 'rows';
  return GROUP_TOGGLE_FINDERS[act](view, reads, 'columns').length > 0 ? 'columns' : 'rows';
}
export function dropStaleMovedClearOfColumns(view: PageState, reads: WorkbookReads): PageState {
  let { movedClearOfColumnsTo: movedTo } = view;
  return movedTo === null || (isSameCell(movedTo, view.activeCell) && isSelectionOneCell(view, reads))
    ? view
    : {
        ...view,
        movedClearOfColumnsTo: null,
      };
}
export function ungroupableGroupsAtSelection(view: PageState, reads: WorkbookReads, axis: LinesAxisName): GroupOnGrid[] {
  let area = selectedArea(view, reads);
  if (area === null) return [];
  let span = areaSpanOnAxis(area, axis);
  let groups = outlineGroupsOfView(view, reads, axis);
  let innermostHolding = groups.findLast((group: GroupOnGrid) => isSpanWithin(span, group));
  if (innermostHolding !== undefined) return [innermostHolding];
  let within = groups.filter((group: GroupOnGrid) => isSpanWithin(group, span));
  return within.filter((group: GroupOnGrid) => !within.some((other: GroupOnGrid) => other !== group && isSpanWithin(group, other)));
}
export function groupableAxes(view: PageState, reads: WorkbookReads): LinesAxisName[] {
  if (view.mode.kind === 'editing') return ['rows', 'columns'];
  let area = selectedArea(view, reads);
  let sheet = findSheetById(reads, view.activeCell.sheetId);
  if (area === null || sheet === undefined) return ['rows', 'columns'];
  return [...(area.rowCount < sheet.rowCount ? ['rows' as const] : []), ...(area.columnCount < sheet.columnCount ? ['columns' as const] : [])];
}
export function moveSelectionClearOfHiddenLines(view: PageState, reads: ReadsWithTextMeasurer, axis: LinesAxisName, collapsedRuns: readonly LineSpan[]): PageState {
  let area = mergedAreaOrCellOf(reads, view.activeCell);
  if (area === null || !groupableAxes(view, reads).includes(axis)) return view;
  let lines = layoutLinesOnAxis(layoutOfView(view, reads), axis);
  let edgesAfter = collapseLineSizes(lines.edges, collapsedRuns);
  let span = areaSpanOnAxis(area, axis);
  let lineAfter = shownLineAtOrAfter(edgesAfter, span.firstIndex);
  if (lineAfter < outlineSpanEnd(span)) return view;
  let line = lineAfter < lines.count ? lineAfter : shownLineAtOrBefore(edgesAfter, span.firstIndex);
  let otherAxis: LinesAxisName = axis === 'rows' ? 'columns' : 'rows';
  let otherLines = layoutLinesOnAxis(layoutOfView(view, reads), otherAxis);
  let otherLine = nearestShownLine(otherLines.edges, otherLines.count, areaSpanOnAxis(area, otherAxis).firstIndex, 1);
  let cellId = axis === 'rows' ? reads.cellIdAt(view.sheetId, line, otherLine) : reads.cellIdAt(view.sheetId, otherLine, line);
  if (cellId === null) return view;
  let { scrollTop, scrollLeft } = view;
  let moved = moveActiveCellTo(withoutOtherRanges(view), reads, cellId);
  let movedClearOfColumnsTo = axis === 'columns' ? moved.activeCell : null;
  return {
    ...moved,
    scrollTop,
    scrollLeft,
    movedClearOfColumnsTo,
  };
}
export function queueCollapseEditKeepingSelection(view: PageState, next: PageState, edit: Edit, done: GroupCollapsingDone): PageTransition {
  if (next.activeCell === view.activeCell)
    return queueEdit(next, edit, {
      ...IF_QUEUED_DEFAULTS,
      select: null,
      done,
    });
  let {
    activeCell,
    selectionCorner,
    rangeWalked,
    otherRanges,
    movedClearOfColumnsTo,
  } = view;
  return queueEdit(next, edit, {
    ...IF_QUEUED_DEFAULTS,
    select: selectionAtCell(next.activeCell),
    done,
    selectionIfRefused: {
      activeCell,
      selectionCorner,
      rangeWalked,
      otherRanges,
      movedClearOfColumnsTo,
    },
  });
}
export function nextOwnCollapsing(
  { ownCollapsing }: Pick<PageState, 'ownCollapsing'>,
  groups: readonly GroupOnGrid[],
  isCollapsedOf: (group: GroupOnGrid) => boolean,
): Map<string, boolean> {
  let next = new Map(ownCollapsing);
  for (let group of groups) {
    let isCollapsed = isCollapsedOf(group);
    if (isCollapsed === group.isCollapsed) next.delete(group.groupId);
    else next.set(group.groupId, isCollapsed);
  }
  return next;
}
export function changeGroupCollapsing(
  view: PageState,
  { reads, refusalOfEveryEdit }: OutlineContext,
  axis: LinesAxisName,
  isCollapsedOf: (group: GroupOnGrid) => boolean,
  isAsked: (group: GroupOnGrid) => boolean,
  edit: Edit,
  done: GroupCollapsingDone,
): PageTransition {
  let sheet = sheetOfView(view, reads);
  if (sheet === undefined) return withNoEffects(view);
  let groups = outlineGroupsOnAxis(sheet, axis);
  if (groups.length === 0) return withNoEffects(view);
  let collapsedRuns = collapsedIndexRuns(
    groups.map(
      (group: GroupOnGrid): GroupOnGrid => ({
        ...group,
        isCollapsed: isCollapsedOf(group),
      }),
    ),
  );
  let cleared: PageState = {
    ...view,
    lastDone: null,
    notice: null,
  };
  let moved = moveSelectionClearOfHiddenLines(cleared, reads, axis, collapsedRuns);
  let changesWorkbook = groups.some((group: GroupOnGrid) => isAsked(group) && isCollapsedOf(group) !== group.isCollapsed);
  if (refusalOfEveryEdit === null && changesWorkbook) {
    let differsFromShown = (group: GroupOnGrid) =>
      isCollapsedOf(group) !== (view.ownCollapsing.get(group.groupId) ?? group.isCollapsed);
    let ownCollapsing = nextOwnCollapsing(view, groups.filter(differsFromShown), (group: GroupOnGrid) => group.isCollapsed);
    return queueCollapseEditKeepingSelection(view, applyOwnCollapsing(moved, reads, ownCollapsing), edit, done);
  }
  if (wouldHideEveryLine(collapsedRuns, layoutLinesOnAxis(layoutOfView(view, reads), axis).count))
    return withNoEffects({
      ...view,
      lastDone: null,
      notice: {
        kind: 'editRefused',
        why: 'nothingLeftInSight',
        asked: 'otherEdit',
      },
    });
  let ownCollapsing = nextOwnCollapsing(view, groups, isCollapsedOf);
  let next: PageState = {
    ...applyOwnCollapsing(moved, reads, ownCollapsing),
    lastDone: done,
  };
  return withNoEffects(moved.activeCell === view.activeCell ? next : scrollToShowSelection(next, reads));
}
export function groupCollapsingDoneNote(groups: readonly GroupOnGrid[], axis: LinesAxisName, isCollapsed: boolean): GroupDone | GroupsDone | null {
  let [first, ...others] = collapsedIndexRuns(
    groups.map(
      (group: GroupOnGrid): GroupOnGrid => ({
        ...group,
        isCollapsed: true,
      }),
    ),
  );
  if (first === undefined) return null;
  return others.length === 0
    ? {
        what: isCollapsed ? 'collapsed' : 'expanded',
        of: axis,
        ...spanLabelEnds(first, axis),
      }
    : {
        what: isCollapsed ? 'groupsCollapsed' : 'groupsExpanded',
        of: axis,
        groupCount: groups.length,
      };
}
export function setOutlineGroupsCollapsed(
  view: PageState,
  context: OutlineContext,
  axis: LinesAxisName,
  groupIds: readonly string[],
  isCollapsed: boolean,
): PageTransition {
  let { sheetId } = view;
  let asked = new Set(groupIds);
  let groups = outlineGroupsOfView(view, context.reads, axis).filter(({ groupId }: GroupOnGrid) => asked.has(groupId));
  let [firstGroupId, ...otherGroupIds] = groups.map(({ groupId }: GroupOnGrid) => groupId);
  let done = groupCollapsingDoneNote(groups, axis, isCollapsed);
  if (firstGroupId === undefined || done === null) return withNoEffects(view);
  return changeGroupCollapsing(
    view,
    context,
    axis,
    (group: GroupOnGrid) => (asked.has(group.groupId) ? isCollapsed : (view.ownCollapsing.get(group.groupId) ?? group.isCollapsed)),
    (group: GroupOnGrid) => asked.has(group.groupId),
    {
      kind: axis === 'rows' ? 'setRowGroupsCollapsed' : 'setColumnGroupsCollapsed',
      sheetId,
      groupIds: [firstGroupId, ...otherGroupIds],
      isCollapsed,
    },
    done,
  );
}
export function showOutlineGroupsToLevel(view: PageState, context: OutlineContext, axis: LinesAxisName, level: number): PageTransition {
  let depth = level - 1;
  return changeGroupCollapsing(
    view,
    context,
    axis,
    (group: GroupOnGrid) => group.depth > depth,
    () => true,
    {
      kind: axis === 'rows' ? 'showRowGroupsToDepth' : 'showColumnGroupsToDepth',
      sheetId: view.sheetId,
      depth,
    },
    {
      what: 'shownToLevel',
      of: axis,
      level,
    },
  );
}
export function queueGroupingEdit(view: PageState, context: Pick<PageContext, 'reads'>, act: GroupingAct, axis: LinesAxisName): PageTransition {
  let { reads } = context;
  let viewOneRange = withoutOtherRanges(view);
  let area = selectedArea(viewOneRange, reads);
  if (area === null) return withNoEffects(viewOneRange);
  let { sheetId } = viewOneRange;
  let { topRowIndex, leftColumnIndex, rowCount, columnCount } = area;
  let topLeft = reads.cellIdAt(sheetId, topRowIndex, leftColumnIndex);
  let bottomRight = reads.cellIdAt(sheetId, topRowIndex + rowCount - 1, leftColumnIndex + columnCount - 1);
  if (topLeft === null || bottomRight === null) return withNoEffects(viewOneRange);
  let span = areaSpanOnAxis(area, axis);
  let edit: Edit =
    axis === 'rows'
      ? {
          kind: `${act}Rows`,
          sheetId,
          oneRow: topLeft.rowId,
          otherRow: bottomRight.rowId,
        }
      : {
          kind: `${act}Columns`,
          sheetId,
          oneColumn: topLeft.columnId,
          otherColumn: bottomRight.columnId,
        };
  let [onlyGroup, ...otherGroups] = act === 'ungroup' ? ungroupableGroupsAtSelection(viewOneRange, reads, axis) : [];
  let doneSpan = onlyGroup !== undefined && otherGroups.length === 0 ? onlyGroup : span;
  let done: GroupDone = {
    what: GROUPING_DONE_KIND[act],
    of: axis,
    ...spanLabelEnds(doneSpan, axis),
  };
  return queueEdit(viewOneRange, edit, {
    ...IF_QUEUED_DEFAULTS,
    select: null,
    done,
  });
}
export function actOnOutlineGroups(view: PageState, context: OutlineContext, act: OutlineGroupAct, axis: LinesAxisName): PageTransition {
  let { reads } = context;
  if (act !== 'collapse' && act !== 'expand') return queueGroupingEdit(view, context, act, axis);
  return setOutlineGroupsCollapsed(
    view,
    context,
    axis,
    GROUP_TOGGLE_FINDERS[act](view, reads, axis).map(({ groupId }: GroupOnGrid) => groupId),
    act === 'collapse',
  );
}
export function outlineGroupsById(reads: WorkbookReads): Map<string, GroupOnGrid> {
  let byId = new Map<string, GroupOnGrid>();
  for (let { rowGroups, columnGroups } of reads.listSheets())
    for (let groups of [rowGroups, columnGroups]) for (let group of groups) byId.set(group.groupId, group);
  return byId;
}
export function pruneSettledOwnCollapsing(view: PageState, readsBefore: WorkbookReads, reads: WorkbookReads): PageState {
  if (view.ownCollapsing.size === 0) return view;
  let [before, after] = [outlineGroupsById(readsBefore), outlineGroupsById(reads)];
  let kept = [...view.ownCollapsing].filter(([groupId, isCollapsed]: [string, boolean]) => {
    let group = after.get(groupId);
    return group !== undefined && group.isCollapsed !== isCollapsed && group.isCollapsed === (before.get(groupId)?.isCollapsed ?? group.isCollapsed);
  });
  return kept.length === view.ownCollapsing.size
    ? view
    : {
        ...view,
        ownCollapsing: new Map(kept),
      };
}
export function collapsedGroupsHidingSpanStart(
  view: Pick<PageState, 'sheetId' | 'ownCollapsing'>,
  reads: WorkbookReads,
  { edges }: Pick<LinesOnAxis, 'edges'>,
  span: LineSpan,
  axis: LinesAxisName,
): GroupOnGrid[] {
  if (shownLineAtOrAfter(edges, span.firstIndex) < outlineSpanEnd(span)) return [];
  let firstLine: LineSpan = {
    firstIndex: span.firstIndex,
    count: 1,
  };
  return outlineGroupsOfView(view, reads, axis).filter((group: GroupOnGrid) => group.isCollapsed && isSpanWithin(firstLine, group));
}
export function expandGroupsLocally(view: PageState, groups: readonly Pick<GroupOnGrid, 'groupId'>[]): PageState {
  if (groups.length === 0) return view;
  let ownCollapsing = new Map(view.ownCollapsing);
  for (let { groupId } of groups) ownCollapsing.set(groupId, false);
  return {
    ...view,
    ownCollapsing,
  };
}
export function revealActiveCellLocally(view: PageState, reads: ReadsWithTextMeasurer, justCollapsed: ReadonlySet<string> = NO_NEWLY_COLLAPSED_GROUPS): PageState {
  let { sheetId } = view.activeCell;
  let sheet = findSheetById(reads, sheetId);
  if (sheet === undefined) return view;
  if (sheet.rowGroups.length === 0 && sheet.columnGroups.length === 0) return view;
  let area = mergedAreaOrCellOf(reads, view.activeCell);
  if (area === null) return view;
  let viewOfSheet: PageState = {
    ...view,
    sheetId,
  };
  let layout = layoutOfView(viewOfSheet, reads);
  let hiding = groupableAxes(view, reads).flatMap(
    (axis: LinesAxisName) =>
      collapsedGroupsHidingSpanStart(viewOfSheet, reads, layoutLinesOnAxis(layout, axis), areaSpanOnAxis(area, axis), axis),
  );
  return hiding.some(({ groupId }: GroupOnGrid) => justCollapsed.has(groupId)) ? view : expandGroupsLocally(view, hiding);
}
export function revealAreaInCollapsedGroups(view: PageState, reads: ReadsWithTextMeasurer, area: CellArea): PageState {
  let layout = layoutOfView(view, reads);
  return expandGroupsLocally(
    view,
    (['rows', 'columns'] as const).flatMap(
      (axis: LinesAxisName) => collapsedGroupsHidingSpanStart(view, reads, layoutLinesOnAxis(layout, axis), areaSpanOnAxis(area, axis), axis),
    ),
  );
}
export function newlyCollapsedGroupIds(readsBefore: WorkbookReads, reads: WorkbookReads): ReadonlySet<string> {
  let collapsed = [...outlineGroupsById(reads).values()].filter(({ isCollapsed }: GroupOnGrid) => isCollapsed);
  if (collapsed.length === 0 || readsBefore === reads) return NO_NEWLY_COLLAPSED_GROUPS;
  let groupsBefore = outlineGroupsById(readsBefore);
  return new Set(
    collapsed.flatMap(({ groupId }: GroupOnGrid) => (groupsBefore.get(groupId)?.isCollapsed === true ? [] : groupId)),
  );
}
export function moveSelectionsOutOfNewlyCollapsed(view: PageState, reads: ReadsWithTextMeasurer, justCollapsed: ReadonlySet<string>): PageState {
  if (justCollapsed.size === 0) return view;
  let moveClear = (place: PageState) =>
    (['rows', 'columns'] as const).reduce((current: PageState, axis: LinesAxisName) => {
      let area = mergedAreaOrCellOf(reads, current.activeCell);
      if (area === null) return current;
      let lines = layoutLinesOnAxis(layoutOfView(current, reads), axis);
      return collapsedGroupsHidingSpanStart(current, reads, lines, areaSpanOnAxis(area, axis), axis).some(
        ({ groupId }: GroupOnGrid) => justCollapsed.has(groupId),
      )
        ? moveSelectionClearOfHiddenLines(current, reads, axis, [])
        : current;
    }, place);
  let moved = view.activeCell.sheetId === view.sheetId ? moveClear(view) : view;
  let placesLeft = view.placesLeft.map((place: Place): Place => {
    let { activeCell } = moveClear({
      ...view,
      ...place,
    });
    return activeCell === place.activeCell
      ? place
      : {
          ...place,
          ...selectionAtCell(activeCell),
        };
  });
  return {
    ...(moved === view ? view : scrollToShowSelection(moved, reads)),
    placesLeft,
  };
}
export function revealActiveCellAfterMove(viewBefore: Pick<PageState, 'activeCell'>, view: PageState, reads: ReadsWithTextMeasurer): PageState {
  let revealed = revealActiveCellLocally(view, reads);
  if (revealed === view) return view;
  return view.activeCell === viewBefore.activeCell ? revealed : scrollToShowSelection(revealed, reads);
}
export function mergeAdjacentCollapsedGroups(groups: readonly GroupOnGrid[]): OutlineRun[] {
  let runs: OutlineRun[] = [];
  let runByDepth = new Map<number, number>();
  for (let group of groups) {
    let runIndex = group.isCollapsed ? runByDepth.get(group.depth) : undefined;
    let run = runIndex === undefined ? undefined : runs[runIndex];
    if (runIndex !== undefined && run !== undefined && run.firstIndex + run.count === group.firstIndex) {
      runs[runIndex] = {
        ...run,
        count: run.count + group.count,
        groupIds: [...run.groupIds, group.groupId],
      };
      continue;
    }
    if (group.isCollapsed) runByDepth.set(group.depth, runs.length);
    runs.push({
      ...group,
      groupIds: [group.groupId],
    });
  }
  return runs;
}
export function outlineGutterOnAxis(view: OutlineGutterView, reads: WorkbookReads, layout: GridLayout, axis: LinesAxisName): OutlineGutter | null {
  let groups = outlineGroupsOfView(view, reads, axis);
  if (groups.length === 0) return null;
  let maxDepth = groups.reduce((deepest: number, { depth }: GroupOnGrid) => Math.max(deepest, depth), 0);
  let halfMark = Math.ceil(OUTLINE_MARK_SIZE / 2);
  let edges = axis === 'rows' ? layout.rowEdges : layout.columnEdges;
  let nextFreeByLane = new Map<number, number>();
  let placeMark = (lane: number, wanted: number) => {
    let at = Math.max(wanted, nextFreeByLane.get(lane) ?? wanted);
    nextFreeByLane.set(lane, at + OUTLINE_MARK_SIZE);
    return at;
  };
  let marks = mergeAdjacentCollapsedGroups(groupsNotInsideCollapsed(groups)).flatMap((run: OutlineRun): OutlineMark[] => {
    let { start, end, showFrom, showTo } = outlineRunOnScreen(run, axis, view, layout);
    let lane = run.depth - 1;
    let mark = {
      key: run.groupId,
      groupIds: run.groupIds,
      lane,
      isCollapsed: run.isCollapsed,
      ...spanLabelEnds(run, axis),
    };
    let firstShownLine = shownLineAtOrAfter(edges, run.firstIndex);
    let center = start + Math.ceil(Math.min(edges.sizeOf(firstShownLine), defaultRowHeightAtDensity(view.density)) / 2);
    if (run.isCollapsed) {
      if (start < showFrom || start > showTo) return [];
      let markAt = placeMark(lane, Math.max(showFrom + halfMark, Math.min(center, showTo - halfMark)));
      return [
        {
          ...mark,
          markAt,
          line: null,
        },
      ];
    }
    if (end <= showFrom || start >= showTo || end === start) return [];
    let wantedAt = Math.min(Math.max(center, showFrom + halfMark), end - halfMark);
    let placedAt = placeMark(lane, wantedAt);
    let startsBeforeMark = placedAt > wantedAt && start >= showFrom && placedAt + halfMark <= Math.min(end, showTo);
    return [
      {
        ...mark,
        markAt: placedAt,
        line: {
          start: startsBeforeMark ? start : placedAt,
          end: Math.max(placedAt, Math.min(end, showTo)),
          endsInView: end <= showTo,
          startsBeforeMark,
        },
      },
    ];
  });
  return {
    of: axis,
    size: maxDepth * OUTLINE_LANE_SIZE,
    beforeBody: axis === 'rows' ? COLUMN_HEADER_HEIGHT : ROW_HEADER_WIDTH,
    levelCount: maxDepth + 1,
    hasLevelButtons: maxDepth > 1,
    groups: marks,
  };
}
export function hiddenLineSeams(view: OutlineScreenView, layout: GridLayout, axis: LinesAxisName): HiddenLineSeam[] {
  let [hiddenRuns, panes] =
    axis === 'rows' ? [layout.rowsOutOfSight, rowPanes(view, layout, view)] : [layout.columnsOutOfSight, columnPanes(view, layout, view)];
  return panes
    .flatMap(
      ({ first, count }: GridPane) =>
        clipIndexRuns(hiddenRuns, {
          firstIndex: first - 1,
          count: count + 2,
        }),
    )
    .flatMap((run: LineSpan): HiddenLineSeam[] => {
      let { start, showFrom, showTo } = outlineRunOnScreen(run, axis, view, layout);
      return start < showFrom || start > showTo
        ? []
        : [
            {
              at: start,
              lines: run,
            },
          ];
    });
}
export function findRunEndingAfter(runs: readonly LineSpan[], index: number): LineSpan | undefined {
  let [low, high] = [0, runs.length];
  while (low < high) {
    let middle = Math.floor((low + high) / 2);
    let run = runs[middle];
    if (run !== undefined && run.firstIndex + run.count <= index) low = middle + 1;
    else high = middle;
  }
  return runs[low];
}
export function outlineGutters(view: OutlineGutterView & LayoutView, reads: ReadsWithTextMeasurer): OutlineGutters {
  let layout = layoutOfView(view, reads);
  return {
    rows: outlineGutterOnAxis(view, reads, layout, 'rows'),
    columns: outlineGutterOnAxis(view, reads, layout, 'columns'),
  };
}
export const outlineGroupsOnAxis = ({ rowGroups, columnGroups }: Pick<SheetSummary, 'rowGroups' | 'columnGroups'>, axis: LinesAxisName): GroupOnGrid[] =>
  axis === 'rows' ? rowGroups : columnGroups;
export const layoutLinesOnAxis = (layout: GridLayout, axis: LinesAxisName): LinesOnAxis =>
  axis === 'rows'
    ? {
        edges: layout.rowEdges,
        count: layout.rowCount,
      }
    : {
        edges: layout.columnEdges,
        count: layout.columnCount,
      };
export const areaSpanOnAxis = (area: CellArea, axis: LinesAxisName): LineSpan =>
  axis === 'rows'
    ? {
        firstIndex: area.topRowIndex,
        count: area.rowCount,
      }
    : {
        firstIndex: area.leftColumnIndex,
        count: area.columnCount,
      };
export const outlineSpanEnd = ({ firstIndex, count }: LineSpan): number => firstIndex + count;
export const doSpansOverlap = (span: LineSpan, other: LineSpan): boolean =>
  span.firstIndex < outlineSpanEnd(other) && other.firstIndex < outlineSpanEnd(span);
export const isSpanWithin = (inner: LineSpan, outer: LineSpan): boolean =>
  inner.firstIndex >= outer.firstIndex && outlineSpanEnd(inner) <= outlineSpanEnd(outer);
export const spanLabelEnds = ({ firstIndex, count }: LineSpan, axis: LinesAxisName): LabelEnds =>
  axis === 'rows'
    ? rowLabelEnds(
        {
          topRowIndex: firstIndex,
          rowCount: count,
          leftColumnIndex: 0,
          columnCount: 1,
        },
        null,
      )
    : columnLabelEnds({
        topRowIndex: 0,
        rowCount: 1,
        leftColumnIndex: firstIndex,
        columnCount: count,
      } as CellArea);
export const GROUP_TOGGLE_FINDERS: Record<GroupToggleAct, (view: PageState, reads: ReadsWithTextMeasurer, axis: LinesAxisName) => GroupOnGrid[]> = {
  collapse: collapsibleGroupsAtSelection,
  expand: expandableGroupsAtSelection,
};
export const wouldHideEveryLine = ([firstRun]: readonly LineSpan[], lineCount: number): boolean =>
  firstRun?.firstIndex === 0 && firstRun.count === lineCount;
export const applyOwnCollapsing = (view: PageState, reads: ReadsWithTextMeasurer, ownCollapsing: Map<string, boolean>): PageState =>
  clampScrollOfView(
    keepScrollAnchoredAcrossChange(
      {
        ...view,
        ownCollapsing,
      },
      reads,
      reads,
      view,
    ),
    reads,
  );
export const GROUPING_DONE_KIND: Record<GroupingAct, GroupDone['what']> = {
  group: 'grouped',
  ungroup: 'ungrouped',
};
export const OUTLINE_COMMAND_ACTS: Record<OutlineCommand, [OutlineGroupAct, LinesAxisName]> = {
  groupRows: ['group', 'rows'],
  groupColumns: ['group', 'columns'],
  ungroupRows: ['ungroup', 'rows'],
  ungroupColumns: ['ungroup', 'columns'],
  collapseRows: ['collapse', 'rows'],
  collapseColumns: ['collapse', 'columns'],
  expandRows: ['expand', 'rows'],
  expandColumns: ['expand', 'columns'],
};
export const runOutlineCommand = (view: PageState, context: OutlineContext, command: OutlineCommand): PageTransition =>
  actOnOutlineGroups(view, context, ...OUTLINE_COMMAND_ACTS[command]);
export const NO_NEWLY_COLLAPSED_GROUPS: ReadonlySet<string> = new Set<string>();
export const ownCollapsingAfterReadsChange = (
  view: PageState,
  readsBefore: WorkbookReads,
  reads: ReadsWithTextMeasurer,
  justCollapsed: ReadonlySet<string>,
): Map<string, boolean> =>
  revealActiveCellLocally(pruneSettledOwnCollapsing(view, readsBefore, reads), reads, justCollapsed).ownCollapsing;
export const OUTLINE_LANE_SIZE = 20;
export const OUTLINE_MARK_SIZE = 20;
export const outlineRunOnScreen = (run: LineSpan, axis: LinesAxisName, view: OutlineScreenView, layout: GridLayout): SpanOnScreen =>
  axis === 'rows' ? rowRunSpanOnScreen(run, view, layout, view) : columnRunSpanOnScreen(run, view, layout, view);
export const hiddenLineSeamPositions = (view: OutlineScreenView, layout: GridLayout, axis: LinesAxisName): number[] => [
  ...new Set(hiddenLineSeams(view, layout, axis).map(({ at }: HiddenLineSeam) => at)),
];
export const ownFilterSeamPositions = (view: OutlineScreenView, layout: GridLayout, ownFilterRuns: readonly LineSpan[]): number[] => [
  ...new Set(
    hiddenLineSeams(view, layout, 'rows')
      .filter(({ lines }: HiddenLineSeam) => {
        let hiddenRun: LineSpan = findRunEndingAfter(layout.rowsOutOfSight, lines.firstIndex) ?? {
          firstIndex: lines.firstIndex,
          count: 1,
        };
        let filterRun = findRunEndingAfter(ownFilterRuns, hiddenRun.firstIndex);
        return filterRun !== undefined && filterRun.firstIndex < hiddenRun.firstIndex + hiddenRun.count;
      })
      .map(({ at }: HiddenLineSeam) => at),
  ),
];
