import * as React from 'react';
import { CHANGE_HOLD_BASE_MS, CHANGE_HOLD_MAX_GROWTH_MS, CHANGE_HOLD_PER_CELL_MS, CHANGE_HOLD_TAIL_MS } from './changes-by-agent.ts';
import { ariaIndex } from '../grid/cell-drawing.tsx';
import { NO_CELLS_AS_BEFORE } from '../grid/grid-drawing.tsx';
import type { CellAsBefore, DrawnCell, DrawnRow } from '../grid/grid-drawing.tsx';
import { LINES_SLIDE_ANIMATION_ID } from '../grid/lines-slide.ts';
import { DEFAULT_CELL_FORMAT } from '../model/cell-format.ts';
import { cellColorsOfFormat } from '../format/cell-colors.ts';
import type { PaneRect } from '../grid/geometry.ts';
import type { DrawnBox } from '../grid/view-boxes.ts';
import type { CellArea } from '../selection/model.ts';
import type { ShiftOfView } from '../state/controller.ts';
/** A mark on the cells the agent changed, as the grid draws it. */
export interface ChangeMarkDrawn {
  key: string;
  revision: number;
  box: DrawnBox;
  area: CellArea;
  /** The box of the change's own cells, when the mark took in changes close by. */
  ownBox: PaneRect | null;
  /** The box the mark had before it grew to take this change in. */
  grewFrom: PaneRect | null;
  joinedRevisions: number[];
}
/** Of the drawn grid, what the changes of the agent come in over. */
export interface GridOfChangesComingIn {
  rows: readonly DrawnRow[];
  marksOnChangesByAgent: readonly ChangeMarkDrawn[];
  yetToGlide: ShiftOfView | null;
  latestRevisionByAgent: number;
  changesAskedFor: number;
}
/** How far the room of a mark is to reach, and by when. */
export interface ReachNeeded {
  size: number;
  neededAfterMs: number;
}
/** A step the room of a mark opens by: how far, from when, and for how long. */
export interface OpeningStep {
  opensBy: number;
  beginsAfterMs: number;
  takesMs: number;
}
/** A cell whose new text comes in, and when. */
export interface CellComingIn {
  rowNumber: number;
  columnNumber: number;
  comesAfterMs: number;
}
/** How a change of the agent comes in: the steps its room opens by, the cells as their text comes, and the cells kept as before until then. */
export interface ComingInPlan {
  stepsRight: OpeningStep[];
  stepsDown: OpeningStep[];
  cells: CellComingIn[];
  cellsAsBefore: CellAsBefore[];
}
/** The cells kept as before, and the grid they were worked out for. */
interface CellsAsBeforeHeld {
  drawn: GridOfChangesComingIn;
  cellsAsBefore: readonly CellAsBefore[];
}
/** A padding of a mark's room that opens, and the steps it opens by. */
type OpeningPart = [padding: 'paddingRight' | 'paddingBottom', steps: OpeningStep[]];
export function openingSteps(reaches: ReachNeeded[], wholeSize: number): OpeningStep[] {
  return reaches.flatMap((reach, index) => {
    let nextReach = reaches[index + 1];
    if (nextReach === undefined) return [];
    let gapMs = nextReach.neededAfterMs - reach.neededAfterMs;
    let takesMs = Math.min(nextReach.neededAfterMs, Math.max(CHANGE_HOLD_BASE_MS, STEP_DURATION_SHARE * gapMs));
    return [
      {
        opensBy: (index + 2 === reaches.length ? wholeSize : nextReach.size) - reach.size,
        beginsAfterMs: nextReach.neededAfterMs - takesMs,
        takesMs,
      },
    ];
  });
}
export function comingInPlan(mark: ChangeMarkDrawn, rows: readonly DrawnRow[], cellsBefore: Map<string, DrawnCell>): ComingInPlan | null {
  let { revision, box, area, grewFrom } = mark;
  let ownBox = mark.ownBox ?? box;
  let rowsInChange = rows
    .filter((row) => isInChangeSpan(row.rowNumber, area.topRowIndex, area.rowCount))
    .map(
      (row) => ({
        row,
        cells: row.cells.filter((cell) => isInChangeSpan(cell.columnNumber, area.leftColumnIndex, area.columnCount)),
      }),
    );
  let firstRow = rowsInChange[0];
  if (firstRow === undefined || firstRow.cells.length === 0) return null;
  let cellCount = rowsInChange.reduce((count, { cells }) => count + cells.length, 0);
  let msPerRow = Math.min(CHANGE_HOLD_MAX_GROWTH_MS, cellCount * CHANGE_HOLD_PER_CELL_MS) / rowsInChange.length;
  let growsFromSameCorner = grewFrom === null || (grewFrom.left === box.left && grewFrom.top === box.top);
  let growthHoldMs =
    grewFrom !== null && growsFromSameCorner && (grewFrom.width < box.width || grewFrom.height < box.height) ? CHANGE_HOLD_BASE_MS : 0;
  let comesAfterMs = (rowInChange: number, cell: Pick<DrawnCell, 'left'>) =>
    growthHoldMs + msPerRow * (rowInChange + clampToSize(cell.left - ownBox.left, ownBox.width) / ownBox.width);
  return {
    stepsRight: !growsFromSameCorner
      ? []
      : openingSteps(
          withGrownFrom(
            grewFrom?.width,
            firstRow.cells.map(
              (cell) => ({
                size: clampToSize(cell.left + cell.width - box.left, box.width),
                neededAfterMs: comesAfterMs(0, cell),
              }),
            ),
          ),
          box.width,
        ),
    stepsDown: !growsFromSameCorner
      ? []
      : openingSteps(
          withGrownFrom(
            grewFrom?.height,
            rowsInChange.map(
              ({ row }, rowInChange) => ({
                size: clampToSize(row.top + row.height - box.top, box.height),
                neededAfterMs: growthHoldMs + msPerRow * rowInChange,
              }),
            ),
          ),
          box.height,
        ),
    cells: rowsInChange.flatMap(
      ({ row, cells }, rowInChange) =>
        cells
          .filter((cell) => cell.text !== '' && cellsBefore.get(cellKeyInRow(row, cell))?.text !== cell.text)
          .map(
            (cell) => ({
              rowNumber: row.rowNumber,
              columnNumber: cell.columnNumber,
              comesAfterMs: comesAfterMs(rowInChange, cell),
            }),
          ),
    ),
    cellsAsBefore: rowsInChange.flatMap(
      ({ row, cells }, rowInChange) =>
        cells.flatMap((cell) => {
          let cellBefore = cellsBefore.get(cellKeyInRow(row, cell)) ?? blankDrawnCell(cell);
          if (!(cellBefore.text !== '' && cellBefore.text !== cell.text) && cellLooksKey(cellBefore) === cellLooksKey(cell)) return [];
          let goesAfterMs = comesAfterMs(rowInChange, cell);
          return [
            {
              keyOfMark: mark.key,
              revision,
              rowKey: row.key,
              cell: cellBefore,
              goesAfterMs,
            },
          ];
        }),
    ),
  };
}
export function scrollKeyOfRows({ rows }: Pick<GridOfChangesComingIn, 'rows'>): string {
  let frozenBottom = Math.max(0, ...rows.flatMap((row) => (row.isFrozen ? row.top + row.height : [])));
  let firstRowScrolled = rows.find(({ isFrozen, top, height }) => !isFrozen && top + height > frozenBottom);
  let cells = firstRowScrolled?.cells ?? [];
  let frozenRight = Math.max(
    0,
    ...cells.flatMap((cell) => (cell.frozenBy === 'column' ? cell.left + cell.width : [])),
  );
  let firstCellScrolled = cells.find(
    ({ left, width, frozenBy }) => frozenBy !== 'column' && left + width > frozenRight,
  );
  return [firstRowScrolled?.rowNumber, firstRowScrolled?.top, firstCellScrolled?.columnNumber, firstCellScrolled?.left].join();
}
export function movedByGlideAlone(drawn: GridOfChangesComingIn, before: GridOfChangesComingIn): boolean {
  let [{ x: glideX, y: glideY }, { x: glideXBefore, y: glideYBefore }] = [drawn.yetToGlide ?? NO_GLIDE, before.yetToGlide ?? NO_GLIDE];
  let rowsBefore = new Map(before.rows.map((row): [string, DrawnRow] => [row.key, row]));
  let row = drawn.rows.find(({ key, isFrozen }) => !isFrozen && rowsBefore.get(key)?.isFrozen === false);
  let rowBefore = row === undefined ? undefined : rowsBefore.get(row.key);
  if (row === undefined || rowBefore === undefined) return false;
  let cellsBefore = new Map(rowBefore.cells.map((cell): [string, DrawnCell] => [cell.key, cell]));
  let cell = row.cells.find(
    ({ key, frozenBy }) =>
      frozenBy !== 'column' && cellsBefore.has(key) && cellsBefore.get(key)?.frozenBy !== 'column',
  );
  let cellBefore = cell === undefined ? undefined : cellsBefore.get(cell.key);
  return (
    cell !== undefined &&
    cellBefore !== undefined &&
    row.rowNumber === rowBefore.rowNumber &&
    cell.columnNumber === cellBefore.columnNumber &&
    isWithinHalfPixel(row.top - glideY, rowBefore.top - glideYBefore) &&
    isWithinHalfPixel(cell.left - glideX, cellBefore.left - glideXBefore)
  );
}
export function marksMovedOrResized(drawn: GridOfChangesComingIn, before: GridOfChangesComingIn): ChangeMarkDrawn[] {
  let isGlideAlone = (drawn.yetToGlide !== null || before.yetToGlide !== null) && movedByGlideAlone(drawn, before);
  let hasScrolled = !isGlideAlone && scrollKeyOfRows(drawn) !== scrollKeyOfRows(before);
  let [glide, glideBefore] = [drawn.yetToGlide ?? NO_GLIDE, before.yetToGlide ?? NO_GLIDE];
  let staysPut = (edge: number, edgeBefore: number, axis: keyof ShiftOfView, shownEdge: number) =>
    isWithinHalfPixel(edge - glide[axis], edgeBefore - glideBefore[axis]) || (isWithinHalfPixel(edge, edgeBefore) && edge <= shownEdge);
  return drawn.marksOnChangesByAgent.filter(({ key, box }) => {
    let boxBefore = before.marksOnChangesByAgent.find((markBefore) => markBefore.key === key)?.box;
    if (boxBefore === undefined) return false;
    if (!isGlideAlone) return hasScrolled || boxBefore.width !== box.width || boxBefore.height !== box.height;
    let { showsIn } = box;
    return (
      !staysPut(box.left + box.width, boxBefore.left + boxBefore.width, 'x', showsIn.left + showsIn.width) ||
      !staysPut(box.top + box.height, boxBefore.top + boxBefore.height, 'y', showsIn.top + showsIn.height)
    );
  });
}
export function animateComingIn(
  container: ParentNode,
  markKey: string,
  plan: ComingInPlan,
  cellsComing: Set<Element>,
  runningByCell: Map<Element, Animation[]>,
): void {
  let animatedParts: OpeningPart[] = [
    ['paddingRight', plan.stepsRight],
    ['paddingBottom', plan.stepsDown],
  ];
  for (let room of roomsOfChangeMark(container, markKey))
    for (let [padding, steps] of animatedParts)
      for (let { opensBy, beginsAfterMs, takesMs } of steps)
        room.animate(
          {
            [padding]: [`${opensBy}px`, '0px'],
          },
          {
            delay: beginsAfterMs,
            duration: takesMs,
            fill: 'backwards',
            easing: CHANGE_STEP_EASING,
            composite: 'add',
          },
        );
  let cellsByRowNumber = new Map<number, Element[]>();
  for (let { rowNumber, columnNumber, comesAfterMs } of plan.cells) {
    if (!cellsByRowNumber.has(rowNumber)) {
      let rowElement = container.querySelector(`.sheet-rows > .sheet-row[aria-rowindex="${ariaIndex(rowNumber)}"]`);
      cellsByRowNumber.set(rowNumber, [...(rowElement?.children ?? [])]);
    }
    let cellElement = cellsByRowNumber
      .get(rowNumber)
      ?.find((element) => element.getAttribute('aria-colindex') === `${ariaIndex(columnNumber)}`);
    if (cellElement === undefined || cellsComing.has(cellElement)) continue;
    cellsComing.add(cellElement);
    for (let running of runningByCell.get(cellElement) ?? []) running.finish();
    let linksAmongText = cellElement.querySelectorAll('.sheet-text-that-runs-on .sheet-link-among-text');
    let animations = [cellElement, ...cellElement.children, ...linksAmongText].map(
      (part) =>
        part.animate(
          part === cellElement || part.matches('.sheet-text-that-runs-on')
            ? [
                {
                  color: 'transparent',
                },
                {},
              ]
            : {
                opacity: [0, 1],
              },
          {
            delay: comesAfterMs,
            duration: CHANGE_HOLD_TAIL_MS,
            fill: 'backwards',
            easing: 'ease-out',
          },
        ),
    );
    runningByCell.set(cellElement, animations);
  }
  for (let cellAsBefore of container.querySelectorAll<HTMLElement>(`.sheet-cell-as-before[data-mark="${markKey}"]`))
    cellAsBefore.animate(
      {
        visibility: ['visible', 'visible'],
      },
      Number(cellAsBefore.dataset.goesAfterMs),
    );
}
export function cellsAsBeforeOf(drawn: GridOfChangesComingIn, held: CellsAsBeforeHeld): readonly CellAsBefore[] {
  let marksOnChangesByAgent = drawn.marksOnChangesByAgent;
  let newMarks = marksOnChangesByAgent.filter((mark) => mark.revision > held.drawn.latestRevisionByAgent);
  if (held.cellsAsBefore.length === 0 && newMarks.length === 0) return NO_CELLS_AS_BEFORE;
  let cellsNow = drawnCellsByKey(drawn.rows);
  let keptCellsAsBefore =
    drawn.changesAskedFor === held.drawn.changesAskedFor
      ? held.cellsAsBefore.filter(
          (cellAsBefore) =>
            marksOnChangesByAgent.some(
              ({ revision, joinedRevisions }) =>
                revision === cellAsBefore.revision || joinedRevisions.includes(cellAsBefore.revision),
            ) && cellsNow.has(cellAsBeforeKey(cellAsBefore)),
        )
      : [];
  if (newMarks.length === 0) return keptCellsAsBefore.length === 0 ? NO_CELLS_AS_BEFORE : keptCellsAsBefore;
  let cellsBefore = drawnCellsByKey(held.drawn.rows);
  let newCellsAsBefore = newMarks.flatMap((mark) => comingInPlan(mark, drawn.rows, cellsBefore)?.cellsAsBefore ?? []);
  return [
    ...new Map(
      [...keptCellsAsBefore, ...newCellsAsBefore].map((cellAsBefore): [string, CellAsBefore] => [cellAsBeforeKey(cellAsBefore), cellAsBefore]),
    ).values(),
  ];
}
export function useCellsAsBefore(drawn: GridOfChangesComingIn): readonly CellAsBefore[] {
  let [held, setHeld] = React.useState<CellsAsBeforeHeld>({
    drawn,
    cellsAsBefore: NO_CELLS_AS_BEFORE,
  });
  if (held.drawn !== drawn)
    setHeld({
      drawn,
      cellsAsBefore: cellsAsBeforeOf(drawn, held),
    });
  return held.cellsAsBefore;
}
export function useChangesComingIn(containerRef: React.RefObject<HTMLElement | null>, drawn: GridOfChangesComingIn): void {
  let previousDrawnRef = React.useRef(drawn);
  let runningByCell = React.useRef(new Map<Element, Animation[]>());
  React.useLayoutEffect(() => {
    let drawnBefore = previousDrawnRef.current;
    previousDrawnRef.current = drawn;
    let container = containerRef.current;
    if (container === null) return;
    try {
      let isAskedAnew = drawn.changesAskedFor !== drawnBefore.changesAskedFor;
      let animationsToFinish = (isAskedAnew ? drawn.marksOnChangesByAgent : marksMovedOrResized(drawn, drawnBefore))
        .flatMap(({ key }) => roomsOfChangeMark(container, key))
        .flatMap((room) => room.getAnimations().filter(({ id }) => id !== LINES_SLIDE_ANIMATION_ID));
      for (let animation of animationsToFinish) animation.finish();
      let cellsDone = [...runningByCell.current].filter(
        ([, animations]) => isAskedAnew || animations.every((animation) => animation.playState === 'finished'),
      );
      for (let [cellElement, animations] of cellsDone) {
        for (let animation of animations) animation.finish();
        runningByCell.current.delete(cellElement);
      }
      let newMarks = drawn.marksOnChangesByAgent.filter((mark) => mark.revision > drawnBefore.latestRevisionByAgent);
      if (newMarks.length === 0 || container.ownerDocument.hidden) return;
      if (container.ownerDocument.defaultView?.matchMedia('(prefers-reduced-motion:reduce)')?.matches !== false) return;
      let cellsBefore = drawnCellsByKey(drawnBefore.rows);
      let cellsComing = new Set<Element>();
      newMarks.reverse();
      for (let mark of newMarks) {
        let plan = comingInPlan(mark, drawn.rows, cellsBefore);
        if (plan !== null) animateComingIn(container, mark.key, plan, cellsComing, runningByCell.current);
      }
    } catch (fault) {
      Promise.reject(fault);
    }
  });
}
export const STEP_DURATION_SHARE = 0.8;
export const CHANGE_STEP_EASING = 'cubic-bezier(0.65, 0, 0.35, 1)';
export const isInChangeSpan = (lineNumber: number, startIndex: number, count: number): boolean =>
  lineNumber > startIndex && lineNumber <= startIndex + count;
export const clampToSize = (offset: number, size: number): number => Math.max(0, Math.min(offset, size));
export const cellKeyInRow = (row: Pick<DrawnRow, 'key'>, cell: Pick<DrawnCell, 'key'>): string => `${row.key} ${cell.key}`;
export const cellLooksKey = (cell: DrawnCell): string =>
  JSON.stringify([
    cell.textColor,
    {
      ...cell.format,
      border: null,
    },
    cell.pill,
    cell.opensDropdownList,
    cell.opensPeopleList,
    cell.checkbox,
    cell.isPerson,
    cell.avatarUrl,
    cell.otherPeople,
    cell.linkUrl,
    cell.linkDrawnAs,
    cell.mergedRowCount,
    cell.mergedColumnCount,
  ]);
export const blankDrawnCell = (cell: DrawnCell): DrawnCell => ({
  ...cell,
  text: '',
  spokenText: null,
  textColor: null,
  isError: false,
  looksLikeError: false,
  isErrorMuted: false,
  format: DEFAULT_CELL_FORMAT,
  paints: cellColorsOfFormat(DEFAULT_CELL_FORMAT),
  pill: null,
  opensDropdownList: false,
  opensPeopleList: false,
  opensCalendar: false,
  checkbox: null,
  isPerson: false,
  avatarUrl: null,
  otherPeople: [],
  linkUrl: null,
  linkDrawnAs: null,
  linkCellKey: null,
  partsWithLinks: [],
  listLines: [],
});
export const drawnCellsByKey = (rows: readonly DrawnRow[]): Map<string, DrawnCell> =>
  new Map(
    rows.flatMap((row) => row.cells.map((cell): [string, DrawnCell] => [cellKeyInRow(row, cell), cell])),
  );
export const withGrownFrom = (grownFromSize: number | undefined, reaches: ReachNeeded[]): ReachNeeded[] =>
  grownFromSize === undefined
    ? reaches
    : [
        {
          size: grownFromSize,
          neededAfterMs: 0,
        },
        ...reaches.filter(({ size }) => size > grownFromSize),
      ];
export const roomsOfChangeMark = (container: ParentNode, markKey: string): Element[] => [
  ...container.querySelectorAll(`.sheet-room-of-change-by-agent[data-mark="${markKey}"]`),
];
export const cellAsBeforeKey = (cellAsBefore: Pick<CellAsBefore, 'rowKey' | 'cell'>): string => `${cellAsBefore.rowKey} ${cellAsBefore.cell.key}`;
export const isWithinHalfPixel = (value: number, other: number): boolean => Math.abs(value - other) < 0.5;
export const NO_GLIDE: ShiftOfView = {
  x: 0,
  y: 0,
};
