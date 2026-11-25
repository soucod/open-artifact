import { readsAsStored, cellRefOf } from '../model/workbook.ts';
import { areasAsSeen } from '../model/a1-references.ts';
import { ownRowOrderOfSheet } from '../model/line-ids.ts';
import { referenceHue } from '../formulas/reference-pointing.ts';
import { layoutOfView, clampScrollOfView } from '../grid/layout.ts';
import {
  rangeSpansOnScreen,
  cellsAreaWidth,
  cellsAreaHeight,
  scrollToShowBoxInCell,
  clampBetween,
  DRAG_START_DISTANCE,
  freezeCountAtPointer,
  cellUnderPointer,
  columnsEndOnScreen,
  rowsEndOnScreen,
  cellsHeightAboveFloats,
} from '../grid/geometry.ts';
import { heightCoveredByStickyHeaders } from '../grid/sticky-headers.ts';
import { ROW_HEADER_WIDTH } from '../grid/cell-metrics-values.ts';
import { COLUMN_HEADER_HEIGHT } from '../grid/cell-metrics.ts';
import { scrollPositionAtPixel, pixelOfScrollPosition, lineNextToScrollPosition, clampPixelsPast } from '../model/line-sizes.ts';
import { withNoEffects } from '../state/transitions.ts';
import { queueEdit, IF_QUEUED_DEFAULTS, holdUntilAnswered } from '../model/edit-effects.ts';
import { scrollToShowSelection, scrollToShowPosition, BOTH_AXES, isSameCell, isSameSelection } from '../selection/model.ts';
import { areaToA1AsStored } from '../formulas/from-words/where.ts';
import type { InputRow, PlacementOnGrid, ViewWithInputs, WorkbookReads } from '../model/workbook.ts';
import type { MovingPlacedViewDrag, PageState, PlacedViewHold, SizingPlacedViewDrag } from '../state/initial-state.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { KeyPress, PageContext, PageEvent, PlacedViewAct, PlacedViewActedOn } from '../state/event-reducer.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { GridPoint, GridScroll } from '../grid/geometry.ts';
import type { GridLayout } from '../grid/layout.ts';
import type { DrawnBox } from '../grid/view-boxes.ts';
import type { OffsetOfAPlacement } from '@open-artifact/sheets-core';
import type { OwnRowOrder } from '../model/line-ids.ts';
import type { CellArea, CellPosition } from '../selection/model.ts';
import type { KeyAct } from '../keys/key-acts.ts';
import type { ScrollPosition } from '../model/line-sizes.ts';
import type { StepShown } from '../state/edit-answers.ts';

/** Where a placed view is anchored: the cell its top left lies in, and how far into that cell. */
export type PlacementAnchor = Pick<PlacementOnGrid, 'rowIndex' | 'columnIndex' | 'offsetFromAnchorCell'>;
/** Where a placed view is anchored and how large it is, whether or not it is placed yet. */
export type PlacementSpot = PlacementAnchor & Pick<PlacementOnGrid, 'widthInPixels' | 'heightInPixels'>;
/** Why a view shows no chart. */
export type NoChartWhy = 'notAChart' | 'tooMuchToRead' | 'inputsNotRead';
/** What a view shows: a chart drawn by the code of a node from these inputs, or no chart and why. */
export type ChartOfView =
  | { kind: 'none'; why: NoChartWhy }
  | { kind: 'code'; nodeId: string; inputs: Record<string, InputRow[]> };
/** Where the box to ask the agent about a chart stands, from the chart's top left, and whether there is room for it. */
export interface AskBoxStand {
  left: number;
  top: number;
  width: number;
  isRoomEnough: boolean;
}
/** A view placed on the sheet shown, as the grid draws it. */
export interface PlacedViewToDraw {
  placementId: string;
  viewId: string;
  name: string;
  caption: string;
  box: DrawnBox;
  isInView: boolean;
  chart: ChartOfView;
  isSelected: boolean;
  canBeChanged: boolean;
  doesMouseBringTools: boolean;
  isHeld: boolean;
  isHeldOnTheSpot: boolean;
  askBoxStands: AskBoxStand | null;
}
/** An area a selected chart reads, in the hue its input is marked with. */
export interface ChartInputArea {
  area: CellArea;
  hue: string;
}
/** The way an arrow key moves or sizes a placed view. */
type StepDirection = Extract<PlacedViewAct, { kind: 'moveByStep' | 'sizeByStep' }>['toward'];

export function placedViewKeyAct({ key, isShiftHeld, isModifierHeld, isAltHeld }: KeyPress): PlacedViewAct | null {
  if (isModifierHeld || isAltHeld) return null;
  const direction = Object.hasOwn(ARROW_KEY_DIRECTIONS, key) ? ARROW_KEY_DIRECTIONS[key] : undefined;
  if (direction !== undefined)
    return {
      kind: isShiftHeld ? 'sizeByStep' : 'moveByStep',
      toward: direction,
    };
  if (isShiftHeld) return null;
  if (key === 'Escape')
    return {
      kind: 'leave',
      isForCells: true,
    };
  return key === 'Delete' || key === 'Backspace'
    ? {
        kind: 'delete',
        isByKey: true,
      }
    : null;
}
export function selectedPlacedViewId(state: PageState, reads: WorkbookReads): string | null {
  const { placementSelected } = state;
  if (placementSelected === null) return null;
  return placementById(state, reads, placementSelected)?.viewId ?? null;
}
export function selectedChartInputAreas(state: PageState, reads: WorkbookReads): ChartInputArea[] {
  const viewId = selectedPlacedViewId(state, reads);
  const viewAsItStands = viewId === null ? null : reads.viewAsItStands(viewId);
  const element = viewAsItStands?.view.elements[0];
  if (viewAsItStands === null || element === undefined) return [];
  const inputsOfElement = 'refusal' in viewAsItStands.inputs ? undefined : viewAsItStands.inputs.byElement.get(element.elementId);
  const readsStored = readsAsStored(reads);
  return element.inputs.flatMap(
    ({ name: inputName, range: { sheetId, topLeft, bottomRight } }, index) => {
      const values = inputsOfElement?.[inputName] ?? [];
      const [topRow, bottomRow] = [readsStored.rowIndexOf(sheetId, topLeft.r), readsStored.rowIndexOf(sheetId, bottomRight.r)];
      const [leftColumn, rightColumn] = [reads.columnIndexOf(sheetId, topLeft.c), reads.columnIndexOf(sheetId, bottomRight.c)];
      const topRowIndex = lowerIndexOrFallback(topRow, bottomRow, isIndexAfter(leftColumn, rightColumn));
      const leftColumnIndex = lowerIndexOrFallback(leftColumn, rightColumn, isIndexAfter(topRow, bottomRow));
      return sheetId !== state.sheetId || topRowIndex === null || leftColumnIndex === null || values[0] === undefined
        ? []
        : areasAsSeen(
            {
              topRowIndex,
              leftColumnIndex,
              rowCount: values.length,
              columnCount: values[0].length,
            },
            ownRowOrderOfSheet(reads, sheetId),
          ).map(
            (area) => ({
              area,
              hue: referenceHue(index),
            }),
          );
    },
  );
}
export function placementAsDragged(state: PageState, reads: WorkbookReads, placement: PlacementOnGrid): PlacementOnGrid {
  const held = isDraggingPlacedView(state) ? state.dragging : state.heldUntilAnswered?.held;
  if (held?.kind === 'movingPlacedView' && held.placementId === placement.placementId) {
    if (held.landing === null) return placement;
    const { topLeft, offsetFromAnchorCell: landing } = held.landing;
    const position = reads.positionOfCell(topLeft);
    return position === null
      ? placement
      : {
          ...placement,
          ...position,
          offsetFromAnchorCell: landing,
        };
  }
  if (held?.kind === 'sizingPlacedView' && held.placementId === placement.placementId) {
    if (held.sized === null) return placement;
    const { topLeft, ...sized } = held.sized;
    const position = reads.positionOfCell(topLeft);
    return position === null
      ? placement
      : {
          ...placement,
          ...position,
          ...sized,
        };
  }
  return placement;
}
export function placedViewBox(state: PageState, reads: ReadsWithTextMeasurer, placement: PlacementSpot): DrawnBox {
  const { rowIndex, columnIndex } = placement;
  const anchorArea = {
    topRowIndex: rowIndex,
    leftColumnIndex: columnIndex,
    rowCount: 1,
    columnCount: 1,
  };
  const layout = layoutOfView(state, reads);
  const { across, down } = rangeSpansOnScreen(anchorArea, state, layout, state);
  const offset = anchorOffsetPixels(layout, placement);
  return {
    left: across.start + offset.left,
    top: down.start + offset.top,
    width: placement.widthInPixels,
    height: placement.heightInPixels,
    showsIn: {
      left: across.showFrom,
      top: down.showFrom,
      width: cellsAreaWidth(state) - across.showFrom,
      height: cellsAreaHeight(state) - down.showFrom,
    },
  };
}
/** Scrolls to show a placed view, with room under it for the ask box or for so many pixels. */
export function scrollToPlacedView(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  placement: PlacementSpot,
  shownUnder: number | 'askBox' = 0,
): PageState {
  const layout = layoutOfView(state, reads);
  const { widthInPixels: width, heightInPixels: height } = placement;
  const heightUnder = shownUnder === 'askBox' ? (ASK_BOX_SIZE.gap + ASK_BOX_SIZE.height) / state.zoom : shownUnder;
  const target = {
    ...anchorOffsetPixels(layout, placement),
    width,
    height,
    heightShownUnder: heightUnder,
    around: PLACED_VIEW_MARGIN,
  };
  const placementCovered = {
    ...placement,
    heightCovered: heightCoveredByStickyHeaders(state, reads, placement, layout),
  };
  return {
    ...state,
    ...scrollToShowBoxInCell(state, placementCovered, target, layout, state),
  };
}
export function isPointOnSelectedPlacement(state: PageState, reads: ReadsWithTextMeasurer, point: GridPoint): boolean {
  const { placementSelected } = state;
  const placement = placementSelected === null ? null : placementById(state, reads, placementSelected);
  if (placement === null) return false;
  const { left, top, width, height, showsIn } = placedViewBox(state, reads, placement);
  const [x, y] = [point.x - ROW_HEADER_WIDTH, point.y - COLUMN_HEADER_HEIGHT];
  return x >= Math.max(left, showsIn.left) && x < left + width && y >= Math.max(top, showsIn.top) && y < top + height;
}
export function chartOfView(viewAsItStands: ViewWithInputs | null): ChartOfView {
  const element = viewAsItStands?.view.elements[0];
  const nodeId = element === undefined ? null : nodeIdOfRef(element.embed.ref);
  if (viewAsItStands === null || element === undefined || nodeId === null)
    return {
      kind: 'none',
      why: 'notAChart',
    };
  if ('refusal' in viewAsItStands.inputs) {
    const { refusal } = viewAsItStands.inputs;
    return {
      kind: 'none',
      why: refusal === 'tooManyRowsInAnInput' || refusal === 'inputTooLarge' ? 'tooMuchToRead' : 'inputsNotRead',
    };
  }
  const inputs = viewAsItStands.inputs.byElement.get(element.elementId);
  return inputs === undefined
    ? {
        kind: 'none',
        why: 'notAChart',
      }
    : {
        kind: 'code',
        nodeId,
        inputs,
      };
}
export function cachedChartOfView(viewAsItStands: ViewWithInputs | null): ChartOfView {
  const cached = viewAsItStands === null ? undefined : chartOfViewCache.get(viewAsItStands);
  if (cached !== undefined) return cached;
  const chart = chartOfView(viewAsItStands);
  if (viewAsItStands !== null) chartOfViewCache.set(viewAsItStands, chart);
  return chart;
}
export function askBoxStand(
  { left, top, width, height, showsIn }: DrawnBox,
  zoom: number,
  bottomLimit: number,
): AskBoxStand {
  const gap = ASK_BOX_SIZE.gap / zoom;
  const boxWidth = ASK_BOX_SIZE.width / zoom;
  const [minLeft, minTop] = [showsIn.left + gap, showsIn.top + gap];
  const maxLeft = showsIn.left + showsIn.width - gap - boxWidth;
  const maxTop = Math.min(showsIn.top + showsIn.height, bottomLimit) - ASK_BOX_SIZE.height / zoom;
  return {
    left: clampBetween(left + (width - boxWidth) / 2, minLeft, maxLeft) - left,
    top: clampBetween(top + height + gap, minTop, maxTop) - top,
    width: boxWidth,
    isRoomEnough: maxLeft >= minLeft && maxTop >= minTop,
  };
}
export function placementTopLeftCell(state: PageState, reads: ReadsWithTextMeasurer, placement: PlacementAnchor): CellPosition {
  const { rowEdges, columnEdges } = layoutOfView(state, reads);
  return {
    rowIndex: scrollPositionAtPixel(rowEdges, pixelOfScrollPosition(rowEdges, rowAnchorOf(placement))).index,
    columnIndex: scrollPositionAtPixel(columnEdges, pixelOfScrollPosition(columnEdges, columnAnchorOf(placement))).index,
  };
}
export function movePlacedView(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  placement: PlacementOnGrid,
  target: PlacementAnchor,
): PageTransition {
  const { sheetId } = state;
  const topLeftCell = reads.cellIdAt(sheetId, target.rowIndex, target.columnIndex);
  if (topLeftCell === null || isSameAnchor(target, placement)) return withNoEffects(state);
  const cellAddress = cellAddressAt(placementTopLeftCell(state, reads, target), ownRowOrderOfSheet(reads, sheetId));
  return queueEdit(
    state,
    {
      kind: 'movePlacedView',
      sheetId,
      placementId: placement.placementId,
      topLeft: cellRefOf(topLeftCell),
      offsetFromAnchorCell: target.offsetFromAnchorCell,
    },
    {
      ...IF_QUEUED_DEFAULTS,
      select: null,
      done: {
        what: 'placedViewMoved',
        name: placedViewName(reads, placement),
        cell: cellAddress,
      },
    },
  );
}
export function resizePlacedView(state: PageState, reads: WorkbookReads, placement: PlacementOnGrid, target: PlacementSpot): PageTransition {
  const { sheetId } = state;
  const topLeftCell = reads.cellIdAt(sheetId, target.rowIndex, target.columnIndex);
  const { widthInPixels, heightInPixels } = target;
  const isUnchanged =
    isSameAnchor(target, placement) && widthInPixels === placement.widthInPixels && heightInPixels === placement.heightInPixels;
  if (topLeftCell === null || isUnchanged) return withNoEffects(state);
  return queueEdit(
    state,
    {
      kind: 'resizePlacedView',
      sheetId,
      placementId: placement.placementId,
      topLeft: cellRefOf(topLeftCell),
      offsetFromAnchorCell: target.offsetFromAnchorCell,
      widthInPixels,
      heightInPixels,
    },
    {
      ...IF_QUEUED_DEFAULTS,
      select: null,
      done: {
        what: 'placedViewSized',
        name: placedViewName(reads, placement),
        widthInPixels,
        heightInPixels,
      },
    },
  );
}
export function showPlacedViewChange(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  placementId: string,
  how: StepShown,
): PageState | null {
  const placement = placementById(state, reads, placementId);
  if (placement === null) return null;
  const what = how === 'undone' ? 'placedViewChangeUndone' : 'placedViewChangeRedone';
  return {
    ...scrollToPlacedView(selectPlacement(state, placementId), reads, placement),
    lastDone: {
      what,
      name: placedViewName(reads, placement),
    },
  };
}
export function clampPlacementSide(reads: WorkbookReads, pixels: number): number {
  const { smallestSideOfAPlacementInPixels: smallest, largestSideOfAPlacementInPixels: largest } = reads.limitsOfPlacements();
  return Math.max(smallest, Math.min(Math.round(pixels), largest));
}
export function stepPlacementAnchor(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  placement: PlacementAnchor,
  direction: StepDirection,
): PlacementAnchor | null {
  const { rowEdges, columnEdges } = layoutOfView(state, reads);
  const side = direction === 'up' || direction === 'left' ? 'before' : 'after';
  if (direction === 'up' || direction === 'down') {
    const rowIndex = lineNextToScrollPosition(rowEdges, rowAnchorOf(placement), side);
    return rowIndex === null
      ? null
      : placementAnchorOf(columnAnchorOf(placement), {
          index: rowIndex,
          pixelsPast: 0,
        });
  }
  const columnIndex = lineNextToScrollPosition(columnEdges, columnAnchorOf(placement), side);
  return columnIndex === null
    ? null
    : placementAnchorOf(
        {
          index: columnIndex,
          pixelsPast: 0,
        },
        rowAnchorOf(placement),
      );
}
export function reducePlacedViewAct(
  state: PageState,
  { placementId, act }: PlacedViewActedOn,
  { reads, refusalOfEveryEdit }: PageContext,
): PageTransition {
  if (act.kind === 'leave') {
    if (state.placementSelected !== placementId) return withNoEffects(state);
    const deselected = {
      ...state,
      placementSelected: null,
      menu: state.menu?.ofChart === undefined ? state.menu : null,
    };
    return withNoEffects(act.isForCells && !isDraggingPlacedView(state) ? scrollToShowSelection(deselected, reads) : deselected);
  }
  const placement = placementById(state, reads, placementId);
  if (placement === null) return withNoEffects(state);
  const selectedState =
    state.placementSelected === placementId && state.menu === null
      ? state
      : {
          ...state,
          placementSelected: placementId,
          menu: null,
        };
  switch (act.kind) {
    case 'select': {
      if (isDraggingPlacedView(state)) return withNoEffects(selectedState);
      const selected = selectPlacement(state, placementId);
      const shownUnder = act.isForAskBox === true ? 'askBox' : act.hasJustArrived === true ? heightOfAddedChartCard(state) : 0;
      const scrolled =
        act.isByKey || act.isForAskBox === true || !isBoxInView(placedViewBox(state, reads, placement))
          ? scrollToPlacedView(selected, reads, placement, shownUnder)
          : selected;
      return withNoEffects(
        act.hasJustArrived === true
          ? {
              ...scrolled,
              scrolledForNewChart: {
                placementId,
                cell: state.activeCell,
                from: scrollPositionOf(state),
                to: scrollPositionOf(scrolled),
              },
            }
          : scrolled,
      );
    }
    case 'takeHold': {
      if (refusalOfEveryEdit !== null) return withNoEffects(selectedState);
      const { at: pressedAt, sides } = act;
      const { left: boxLeft, top: boxTop, showsIn } = placedViewBox(state, reads, placement);
      const hold = {
        placementId,
        pressedAt,
        leastDrag: (act.isByFinger ? DRAG_START_DISTANCE : PLACED_VIEW_LEAST_DRAG) / state.zoom,
        isCornerUnderFrozenLines: {
          columns: boxLeft < showsIn.left,
          rows: boxTop < showsIn.top,
        },
      };
      if (sides !== null)
        return withNoEffects({
          ...selectedState,
          dragging: {
            ...hold,
            kind: 'sizingPlacedView',
            sides,
            sized: null,
          },
        });
      const grip = {
        x: pressedAt.x - ROW_HEADER_WIDTH - boxLeft,
        y: pressedAt.y - COLUMN_HEADER_HEIGHT - boxTop,
      };
      return withNoEffects({
        ...selectedState,
        dragging: {
          ...hold,
          kind: 'movingPlacedView',
          grip,
          landing: null,
        },
      });
    }
    case 'moveByStep': {
      const anchor = stepPlacementAnchor(state, reads, placement, act.toward);
      if (anchor === null) return withNoEffects(selectedState);
      return movePlacedView(
        scrollToPlacedView(selectedState, reads, {
          ...placement,
          ...anchor,
        }),
        reads,
        placement,
        anchor,
      );
    }
    case 'sizeByStep': {
      const { widthInPixels: width, heightInPixels: height } = placement;
      const sign = act.toward === 'right' || act.toward === 'down' ? 1 : -1;
      const isAcross = act.toward === 'left' || act.toward === 'right';
      const step = sign * PLACED_VIEW_SIZE_STEP;
      return resizePlacedView(selectedState, reads, placement, {
        ...placement,
        widthInPixels: isAcross ? clampPlacementSide(reads, width + step) : width,
        heightInPixels: isAcross ? height : clampPlacementSide(reads, height + step),
      });
    }
    case 'askForMenu': {
      if (refusalOfEveryEdit !== null) return withNoEffects(selectedState);
      if (act.isForNobody === true || state.mode.kind === 'editing') return withNoEffects(selectedState);
      const selected = selectPlacement(state, placementId);
      const scrolled = act.at === null ? scrollToPlacedView(selected, reads, placement) : selected;
      const { left, top, showsIn } = placedViewBox(scrolled, reads, placement);
      const inset = CHART_MENU_INSET / state.zoom;
      return withNoEffects({
        ...scrolled,
        menu: {
          at: act.at ?? {
            x: ROW_HEADER_WIDTH + Math.max(left, showsIn.left) + inset,
            y: COLUMN_HEADER_HEIGHT + Math.max(top, showsIn.top) + inset,
          },
          side: null,
          isAskedByKey: act.at === null,
          holds: 'chart',
          ofChart: {
            placementId,
            canAgentChangeIt: act.canAgentChangeIt,
          },
        },
      });
    }
    case 'delete': {
      const deselected = {
        ...selectedState,
        placementSelected: null,
      };
      const scrolledBack = state.scrolledForNewChart?.placementId === placementId ? scrollBackFromNewChart(deselected, reads) : deselected;
      return queueEdit(
        act.isByKey ? scrollToShowSelection(scrolledBack, reads) : scrolledBack,
        {
          kind: 'deletePlacedView',
          sheetId: state.sheetId,
          placementId,
        },
        {
          ...IF_QUEUED_DEFAULTS,
          select: null,
          done: null,
          undoOffer: {
            kind: 'placedViewDeleted',
            name: placedViewName(reads, placement),
            isSaved: false,
          },
        },
      );
    }
  }
}
export function anchorAtPoint(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  point: GridPoint,
  { isCornerUnderFrozenLines }: Pick<PlacedViewHold, 'isCornerUnderFrozenLines'>,
  placement: PlacementSpot,
): PlacementAnchor {
  const layout = layoutOfView(state, reads);
  const { left, top } = placedViewBox(state, reads, placement);
  return placementAnchorOf(
    Math.abs(point.x - ROW_HEADER_WIDTH - left) < 0.5
      ? columnAnchorOf(placement)
      : freezeCountAtPointer(point, state, layout, 'columns', isCornerUnderFrozenLines.columns),
    Math.abs(point.y - COLUMN_HEADER_HEIGHT - top) < 0.5
      ? rowAnchorOf(placement)
      : freezeCountAtPointer(point, state, layout, 'rows', isCornerUnderFrozenLines.rows),
  );
}
export function autoScrollWhileDragging(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  { pressedAt }: Pick<PlacedViewHold, 'pressedAt'>,
  pointer: GridPoint,
): PageState {
  const layout = layoutOfView(state, reads);
  const scrollTarget = cellUnderPointer(pointer, state, layout, state);
  const { scrollLeft, scrollTop } = scrollToShowPosition(state, reads, scrollTarget, BOTH_AXES, 'pointer');
  const [x, y] = [pointer.x - ROW_HEADER_WIDTH, pointer.y - COLUMN_HEADER_HEIGHT];
  const isXInView = x >= Math.max(0, columnsEndOnScreen(state, layout)) && x < cellsAreaWidth(state);
  const isYInView = y >= Math.max(0, rowsEndOnScreen(state, layout)) && y < cellsAreaHeight(state);
  return {
    ...state,
    scrollLeft: !isXInView && (scrollLeft - state.scrollLeft) * (pointer.x - pressedAt.x) > 0 ? scrollLeft : state.scrollLeft,
    scrollTop: !isYInView && (scrollTop - state.scrollTop) * (pointer.y - pressedAt.y) > 0 ? scrollTop : state.scrollTop,
  };
}
export function dragPlacedView(state: PageState, dragging: MovingPlacedViewDrag, pointer: GridPoint, reads: ReadsWithTextMeasurer): PageState {
  const placement = placementById(state, reads, dragging.placementId);
  if (placement === null) return state;
  if (dragging.landing === null && isWithinLeastDrag(dragging, pointer)) return state;
  const scrolledState = autoScrollWhileDragging(state, reads, dragging, pointer);
  const gripPoint = {
    x: pointer.x - dragging.grip.x,
    y: pointer.y - dragging.grip.y,
  };
  const {
    rowIndex,
    columnIndex,
    offsetFromAnchorCell,
  } = anchorAtPoint(scrolledState, reads, gripPoint, dragging, placement);
  const topLeftCell = reads.cellIdAt(state.sheetId, rowIndex, columnIndex);
  return topLeftCell === null ||
    (dragging.landing !== null &&
      isSameCell(topLeftCell, dragging.landing.topLeft) &&
      isSameOffset(offsetFromAnchorCell, dragging.landing.offsetFromAnchorCell) &&
      scrolledState.scrollLeft === state.scrollLeft &&
      scrolledState.scrollTop === state.scrollTop)
    ? state
    : {
        ...scrolledState,
        dragging: {
          ...dragging,
          landing: {
            topLeft: topLeftCell,
            offsetFromAnchorCell,
          },
        },
      };
}
export function sizePlacedView(state: PageState, dragging: SizingPlacedViewDrag, pointer: GridPoint, reads: ReadsWithTextMeasurer): PageState {
  const placement = placementById(state, reads, dragging.placementId);
  if (placement === null) return state;
  if (dragging.sized === null && isWithinLeastDrag(dragging, pointer)) return state;
  const { left, top } = placedViewBox(state, reads, placement);
  const [isLeftSide, isTopSide] = [dragging.sides.x === 'left', dragging.sides.y === 'top'];
  const [dragX, dragY] = [pointer.x - dragging.pressedAt.x, pointer.y - dragging.pressedAt.y];
  const sizeChange = (isMovingSide: boolean, size: number, drag: number) =>
    isMovingSide ? clampPlacementSide(reads, size - drag) - size : 0;
  const cornerPoint = {
    x: ROW_HEADER_WIDTH + left - sizeChange(isLeftSide, placement.widthInPixels, dragX),
    y: COLUMN_HEADER_HEIGHT + top - sizeChange(isTopSide, placement.heightInPixels, dragY),
  };
  const anchor = isLeftSide || isTopSide ? anchorAtPoint(state, reads, cornerPoint, dragging, placement) : placement;
  const movedBox =
    anchor === placement
      ? {
          left,
          top,
        }
      : placedViewBox(state, reads, {
          ...placement,
          ...anchor,
        });
  const widthInPixels = clampPlacementSide(reads, placement.widthInPixels + (dragging.sides.x === 'right' ? dragX : left - movedBox.left));
  const heightInPixels = clampPlacementSide(reads, placement.heightInPixels + (dragging.sides.y === 'bottom' ? dragY : top - movedBox.top));
  const topLeftCell = reads.cellIdAt(state.sheetId, anchor.rowIndex, anchor.columnIndex);
  if (topLeftCell === null) return state;
  const { offsetFromAnchorCell } = anchor;
  const sized = dragging.sized;
  return sized !== null &&
    isSameCell(sized.topLeft, topLeftCell) &&
    isSameOffset(sized.offsetFromAnchorCell, offsetFromAnchorCell) &&
    sized.widthInPixels === widthInPixels &&
    sized.heightInPixels === heightInPixels
    ? state
    : {
        ...state,
        dragging: {
          ...dragging,
          sized: {
            topLeft: topLeftCell,
            offsetFromAnchorCell,
            widthInPixels,
            heightInPixels,
          },
        },
      };
}
export function dropPlacedView(
  state: PageState,
  dragging: MovingPlacedViewDrag | SizingPlacedViewDrag,
  { reads, refusalOfEveryEdit }: PageContext,
): PageTransition {
  const stateDropped = {
    ...state,
    dragging: null,
  };
  const placement = placementById(state, reads, dragging.placementId);
  const draggedPlacement = placement === null ? null : placementAsDragged(state, reads, placement);
  if (placement === null || draggedPlacement === null || draggedPlacement === placement) return withNoEffects(stateDropped);
  if (refusalOfEveryEdit !== null)
    return withNoEffects({
      ...stateDropped,
      notice: {
        kind: 'editRefused',
        why: refusalOfEveryEdit,
        asked: 'otherEdit',
      },
    });
  return holdUntilAnswered(
    dragging.kind === 'movingPlacedView'
      ? movePlacedView(stateDropped, reads, placement, draggedPlacement)
      : resizePlacedView(stateDropped, reads, placement, draggedPlacement),
    dragging,
  );
}
/** Keeps the placed view selected, and its drag, only while the event leaves them standing. */
export function reconcilePlacementSelection(previousState: PageState, state: PageState, event: PageEvent, reads: WorkbookReads): PageState {
  const { placementSelected, dragging } = state;
  const isDraggingPlacement = dragging?.kind === 'movingPlacedView' || dragging?.kind === 'sizingPlacedView';
  if (placementSelected === null && !isDraggingPlacement) return state;
  const keepsSelection =
    placementSelected !== null &&
    event.kind !== 'pointerPressed' &&
    state.mode.kind !== 'editing' &&
    (placementSelected !== previousState.placementSelected ||
      (state.sheetId === previousState.sheetId &&
        ((event.kind === 'workbookChanged' && event.isUnasked) || isSameSelection(previousState, state)))) &&
    placementById(state, reads, placementSelected) !== null;
  if (keepsSelection && (!isDraggingPlacement || dragging.placementId === placementSelected)) return state;
  return {
    ...state,
    placementSelected: keepsSelection ? placementSelected : null,
    dragging: isDraggingPlacement ? null : dragging,
  };
}
export function scrollBackFromNewChart(state: PageState, reads: ReadsWithTextMeasurer): PageState {
  const { scrolledForNewChart } = state;
  const withoutScroll = {
    ...state,
    scrolledForNewChart: null,
  };
  if (
    !(
      scrolledForNewChart !== null &&
      isSameCell(scrolledForNewChart.cell, state.activeCell) &&
      scrolledForNewChart.to.scrollLeft === state.scrollLeft &&
      scrolledForNewChart.to.scrollTop === state.scrollTop
    )
  )
    return withoutScroll;
  const scrolledBack = clampScrollOfView(
    {
      ...withoutScroll,
      ...scrolledForNewChart.from,
    },
    reads,
  );
  return scrolledBack.scrollLeft !== state.scrollLeft || scrolledBack.scrollTop !== state.scrollTop
    ? {
        ...scrolledBack,
        movesOfViewByItself: state.movesOfViewByItself + 1,
      }
    : scrolledBack;
}
export function scrollBackIfNewChartGone(state: PageState, reads: ReadsWithTextMeasurer): PageState {
  const { scrolledForNewChart } = state;
  return scrolledForNewChart !== null &&
    !reads
      .placementsIn(scrolledForNewChart.cell.sheetId)
      .some(({ placementId }) => placementId === scrolledForNewChart.placementId)
    ? scrollBackFromNewChart(state, reads)
    : state;
}
export const ARROW_KEY_DIRECTIONS: Readonly<Record<string, StepDirection>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};
export const isUndoOrFormulasToggle = ({ kind }: Pick<KeyAct, 'kind'>): boolean => kind === 'undoOrRedo' || kind === 'showOrHideFormulas';
export const PLACED_VIEW_SIZE_STEP = 10;
export const PLACED_VIEW_LEAST_DRAG = 3;
export const placementById = ({ sheetId }: Pick<PageState, 'sheetId'>, reads: WorkbookReads, placementId: string): PlacementOnGrid | null =>
  reads.placementsIn(sheetId).find((placement) => placement.placementId === placementId) ?? null;
export const placedViewName = (reads: WorkbookReads, { viewId }: Pick<PlacementOnGrid, 'viewId'>): string =>
  reads.viewAsItStands(viewId)?.view.name ?? '';
export const lowerIndexOrFallback = (first: number | null, second: number | null, prefersSecond: boolean): number | null =>
  first !== null && second !== null ? Math.min(first, second) : prefersSecond ? second : first;
export const isIndexAfter = (first: number | null, second: number | null): boolean => first !== null && second !== null && first > second;
export const columnAnchorOf = ({ columnIndex, offsetFromAnchorCell }: PlacementAnchor): ScrollPosition => ({
  index: columnIndex,
  pixelsPast: offsetFromAnchorCell.xInPixels,
});
export const rowAnchorOf = ({ rowIndex, offsetFromAnchorCell }: PlacementAnchor): ScrollPosition => ({
  index: rowIndex,
  pixelsPast: offsetFromAnchorCell.yInPixels,
});
export const placementAnchorOf = (column: ScrollPosition, row: ScrollPosition): PlacementAnchor => ({
  rowIndex: row.index,
  columnIndex: column.index,
  offsetFromAnchorCell: {
    xInPixels: column.pixelsPast,
    yInPixels: row.pixelsPast,
  },
});
export const anchorOffsetPixels = (
  { columnEdges, rowEdges }: Pick<GridLayout, 'columnEdges' | 'rowEdges'>,
  placement: PlacementAnchor,
): { left: number; top: number } => ({
  left: clampPixelsPast(columnEdges, columnAnchorOf(placement)),
  top: clampPixelsPast(rowEdges, rowAnchorOf(placement)),
});
export const scrollPositionOf = ({ scrollLeft, scrollTop }: GridScroll): GridScroll => ({
  scrollLeft,
  scrollTop,
});
export const isDraggingPlacedView = ({ dragging }: Pick<PageState, 'dragging'>): boolean =>
  dragging?.kind === 'movingPlacedView' || dragging?.kind === 'sizingPlacedView';
export const CHART_MENU_INSET = 16;
export const PLACED_VIEW_MARGIN = 8;
export const ASK_BOX_SIZE = {
  gap: 12,
  height: 249,
  width: 312,
};
export const ADDED_CHART_CARD_SIZE = {
  height: 40,
  gap: 8,
};
export const heightOfAddedChartCard = ({ zoom }: Pick<PageState, 'zoom'>): number =>
  (ADDED_CHART_CARD_SIZE.gap + ADDED_CHART_CARD_SIZE.height) / zoom;
export const isBoxInView = ({ left, top, width, height, showsIn }: DrawnBox): boolean =>
  left + width > showsIn.left && top + height > showsIn.top && left < showsIn.left + showsIn.width && top < showsIn.top + showsIn.height;
export const NODE_REF_PATTERN = /^node\/(.+)$/;
export const nodeIdOfRef = (ref: string): string | null => NODE_REF_PATTERN.exec(ref)?.[1] ?? null;
export const nodeRefOf = (nodeId: string): string => `node/${nodeId}`;
export const chartOfViewCache = new WeakMap<ViewWithInputs, ChartOfView>();
export const placedViewsToDraw = (state: PageState, reads: ReadsWithTextMeasurer, isReadOnly: boolean): PlacedViewToDraw[] =>
  reads.placementsIn(state.sheetId).map((placement) => {
    const { placementId, viewId } = placement;
    const box = placedViewBox(state, reads, placementAsDragged(state, reads, placement));
    const { dragging } = state;
    return {
      placementId,
      viewId,
      name: placedViewName(reads, placement),
      caption: reads.viewAsItStands(viewId)?.view.elements[0]?.embed.caption ?? '',
      box,
      isInView: isBoxInView(box),
      chart: cachedChartOfView(reads.viewAsItStands(viewId)),
      isSelected: state.placementSelected === placementId,
      canBeChanged: !isReadOnly,
      doesMouseBringTools: !isReadOnly && state.mode.kind === 'navigating' && dragging === null,
      isHeld: (dragging?.kind === 'movingPlacedView' || dragging?.kind === 'sizingPlacedView') && dragging.placementId === placementId,
      isHeldOnTheSpot: dragging?.kind === 'movingPlacedView' && dragging.placementId === placementId && dragging.landing === null,
      askBoxStands: isReadOnly ? null : askBoxStand(box, state.zoom, cellsHeightAboveFloats(state)),
    };
  });
export const cellAddressAt = ({ rowIndex, columnIndex }: CellPosition, ownRowOrder: OwnRowOrder | null): string =>
  areaToA1AsStored(
    {
      topRowIndex: rowIndex,
      leftColumnIndex: columnIndex,
      rowCount: 1,
      columnCount: 1,
    },
    ownRowOrder,
  );
export const isSameOffset = (offset: OffsetOfAPlacement, otherOffset: OffsetOfAPlacement): boolean =>
  offset.xInPixels === otherOffset.xInPixels && offset.yInPixels === otherOffset.yInPixels;
export const isSameAnchor = (target: PlacementAnchor, placement: PlacementAnchor): boolean =>
  target.rowIndex === placement.rowIndex &&
  target.columnIndex === placement.columnIndex &&
  isSameOffset(target.offsetFromAnchorCell, placement.offsetFromAnchorCell);
export const selectPlacement = (state: PageState, placementId: string): PageState => ({
  ...state,
  placementSelected: placementId,
  menu: state.menu?.ofChart?.placementId === placementId ? state.menu : null,
  contextBarMenu: null,
});
export const isWithinLeastDrag = ({ pressedAt, leastDrag }: Pick<PlacedViewHold, 'pressedAt' | 'leastDrag'>, pointer: GridPoint): boolean =>
  Math.hypot(pointer.x - pressedAt.x, pointer.y - pressedAt.y) < leastDrag;
