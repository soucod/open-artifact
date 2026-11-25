import { useReducedMotion } from '../kit/platform.ts';
import type { SheetId } from '@open-artifact/sheets-core';
import type { LineIndex, LineSpan } from '../model/line-ids.ts';
import type { LineSizes } from '../model/line-sizes.ts';
import type { LinesAxisName, PaneRect } from './geometry.ts';
import * as React from 'react';
import { PRESS_LIFT_REPEAT_MAX_MS } from '../ui/press-swallow.ts';
/** The lines of one axis on show: their order, those out of sight, their edges, how many are frozen, and how far the rest are scrolled. */
export interface AxisLinesOnShow {
  order: LineIndex | null;
  outOfSight: readonly LineSpan[];
  edges: LineSizes;
  frozenCount: number;
  scroll: number;
}
/** The rows and the columns on show of a sheet. */
export interface LinesOnShow {
  sheetId: SheetId;
  rows: AxisLinesOnShow;
  columns: AxisLinesOnShow;
}
/** What of a drawn row a slide of lines reads. */
export interface RowToSlide {
  key: string;
  rowNumber: number;
  top: number;
  height: number;
  isFrozen: boolean;
  cells: readonly { key: string }[];
}
/** What of a drawn column header a slide of lines reads. */
export interface ColumnHeaderToSlide {
  key: string;
  columnNumber: number;
  left: number;
  width: number;
  isFrozen: boolean;
}
/** What of the drawn grid a slide of lines reads. */
export interface GridToSlide {
  rows: readonly RowToSlide[];
  columnHeaders: readonly ColumnHeaderToSlide[];
  body: Pick<PaneRect, 'left' | 'top'>;
}
/** A row or a column as drawn: its key, its index, and where it starts and how big it is along its axis. */
export interface LineDrawn {
  key: string;
  index: number;
  start: number;
  size: number;
}
/** A line as drawn, with where it starts on the other side of a change. */
export interface LineDrawnElsewhere extends LineDrawn {
  elsewhere: number;
}
/** Where a line starts on screen and how big it is. */
export interface LineOnScreen {
  start: number;
  size: number;
}
/** How far a line slides, by its key. */
export interface LineSlid {
  key: string;
  by: number;
}
/** How far a line drawn before a change slides away, and whether it ends out of sight. */
export interface LineSlidAway extends LineSlid {
  isOutOfSight: boolean;
}
/** A run of lines that slide together, and how much of its end the band after it covers. */
export interface BandOfSlide {
  start: number;
  size: number;
  by: number;
  covered: number;
}
/** Lines of one axis sliding to their new places: those drawn now, those drawn before, and the bands they move in. */
export interface SlideOfAxis {
  axis: LinesAxisName;
  now: LineSlid[];
  asBefore: LineSlidAway[];
  bandsNow: BandOfSlide[];
  bandsAsBefore: BandOfSlide[];
}
/** A veil laid over lines that slide out of sight. */
export interface VeilOfSlide {
  start: number;
  size: number;
  by: number;
}
/** Drawn rows that slide away together. */
export interface GroupOfLinesGoing<Row> {
  by: number;
  rows: Row[];
}
/** The lines drawn before a slide, kept on screen while they slide away. */
export interface LinesAsBefore<Grid extends GridToSlide> {
  grid: Grid | null;
  slide: SlideOfAxis | null;
  veils: VeilOfSlide[];
  groups: GroupOfLinesGoing<Grid['rows'][number]>[];
  columnHeaders: Grid['columnHeaders'][number][];
}
/** How often lines of an axis have slid of late, and how long to rest before they slide again. */
export interface SlidePace {
  isFirstPlayOver: boolean;
  inARow: number;
  nextRestMs: number;
  restUntilMs: number;
}
/** How long a slide takes, and its easing. */
export interface SlideTiming {
  duration: number;
  easing: string;
}
/** Where a mark over the grid stood: its top, left, height and width. */
export type MarkPlace = [number, number, number, number];
/** The marks over the grid that slide with the lines, and where each stood. */
export type MarksOfGrid = Map<HTMLElement | SVGElement, MarkPlace>;
/** The slide being played, told to whoever draws the grid. */
export interface SlideTold {
  tell(slideNow: SlideOfAxis | null): void;
  now: () => SlideOfAxis | null;
  subscribe(listener: () => void): () => void;
}
/** The grid as drawn, with the lines on show it was drawn with. */
export interface GridWithLines<Grid extends GridToSlide> {
  grid: Grid;
  lines: LinesOnShow;
}
/** A slide planned when the grid was drawn again, and the grid it slides from. */
export interface SlideDrawnAgain<Grid extends GridToSlide> {
  slide: SlideOfAxis;
  from: Grid;
  plannedAtMs: number;
}
/** The grid last drawn, the one before it, and the slide between them. */
export interface SlideState<Grid extends GridToSlide> {
  grid: Grid | null;
  before: GridWithLines<Grid> | null;
  now: GridWithLines<Grid> | null;
  slide: SlideOfAxis | null;
  marksBefore: MarksOfGrid;
  drawnAgain: SlideDrawnAgain<Grid> | null;
}
/** The animations of a slide: of what stays drawn, and of what goes. */
export interface SlideAnimations {
  staying: Animation[];
  going: Animation[];
}
/** A slide paused while a press is held. */
export interface SlidePausedByPress {
  these: SlideAnimations;
  pointerId: number;
}
/** What lines slide in: the grid as drawn, the lines on show, and where the slide is told. */
export interface LinesSlideProps<Grid extends GridToSlide> {
  grid: Grid;
  lines: LinesOnShow | null;
  slideTold: SlideTold;
}
export let slideTiming: SlideTiming | null;
export function bandClipPath(axis: LinesAxisName, bodyStart: number, band: Pick<BandOfSlide, 'start' | 'size'>, covered: number = 0): string {
  let [from, to] = [`${bodyStart + band.start}px`, `calc(100% - ${bodyStart + band.start + band.size - covered}px)`];
  return axis === 'rows' ? `inset(${from} 0 ${to} 0)` : `inset(0 ${to} 0 ${from})`;
}
export function startOfHiddenRunAt(index: number, outOfSight: readonly LineSpan[]): number {
  let [low, high] = [0, outOfSight.length - 1];
  while (low < high) {
    let middle = Math.ceil((low + high) / 2);
    if ((outOfSight[middle]?.firstIndex ?? 0) <= index) low = middle;
    else high = middle - 1;
  }
  return outOfSight[low]?.firstIndex ?? index;
}
export function bandsOfSlide(lines: readonly LineDrawn[], moves: readonly LineSlid[], isNow: boolean): BandOfSlide[] {
  let byOfKey = new Map(moves.map(({ key, by }: LineSlid): [string, number] => [key, by]));
  let bands: BandOfSlide[] = [];
  for (let { key, start, size } of lines) {
    let [by, last] = [byOfKey.get(key) ?? (isNow ? 0 : null), bands.at(-1)];
    if (by === null) continue;
    if (last?.by === by && last.start + last.size === start)
      bands[bands.length - 1] = {
        ...last,
        size: last.size + size,
      };
    else
      bands.push({
        start,
        size,
        by,
        covered: 0,
      });
  }
  if (!isNow) return bands;
  return bands.map(
    ({ start, size, by }: BandOfSlide, index: number): BandOfSlide => ({
      start,
      size,
      by,
      covered: Math.max(0, by - (bands[index + 1]?.by ?? by)),
    }),
  );
}
export function spanOfLinesFrom(lines: readonly LineDrawn[], firstIndex: number): [number, number] | null {
  let [first, last] = [lines.find(({ index }: LineDrawn) => index >= firstIndex), lines.at(-1)];
  return first === undefined || last === undefined ? null : [first.start, last.start + last.size];
}
export function slideDistances(lines: readonly LineDrawnElsewhere[], frozenCount: number, span: [number, number] | null): number[] {
  let distances = lines.map(({ start, elsewhere }: LineDrawnElsewhere) => elsewhere - start);
  if (span === null) return distances;
  let firstAfter = lines.findIndex(
    ({ index, elsewhere }: LineDrawnElsewhere) => index >= frozenCount && elsewhere >= span[1],
  );
  let lastBefore = -1;
  return (
    lines.forEach(({ index, size, elsewhere }: LineDrawnElsewhere, position: number) => {
      if (index >= frozenCount && elsewhere + size <= span[0]) lastBefore = position;
    }),
    distances.map((distance: number, position: number) => {
      let [after, before] = [lines[firstAfter], lines[lastBefore]];
      if (after !== undefined && position >= firstAfter) return span[1] - after.start;
      return before !== undefined && position <= lastBefore && (lines[position]?.index ?? 0) >= frozenCount
        ? span[0] - before.start - before.size
        : distance;
    })
  );
}
export function startElsewhere({ index, start }: Pick<LineDrawn, 'index' | 'start'>, [linesThere, linesHere]: readonly AxisLinesOnShow[] = []): number {
  let there = lineSpanOf(linesHere, index);
  if (there.size > 0) return there.start;
  return start + there.start - lineSpanOf(linesThere, startOfHiddenRunAt(index, linesHere.outOfSight)).start;
}
export function slideOfAxis(
  axis: LinesAxisName,
  [gridBefore, gridNow]: readonly GridToSlide[] = [],
  [linesBefore, linesNow]: readonly AxisLinesOnShow[] = [],
): SlideOfAxis | null {
  let [drawnBefore, drawnNow] = [linesDrawnOf(gridBefore, axis), linesDrawnOf(gridNow, axis)];
  let frozenCount = Math.max(linesBefore.frozenCount, linesNow.frozenCount);
  let wasOutOfSight = (line: LineDrawn): boolean => lineSpanOf(linesBefore, line.index).size === 0;
  let nowWithPlaceBefore = drawnNow.map(
    (line: LineDrawn): LineDrawnElsewhere => ({
      ...line,
      elsewhere: startElsewhere(line, [linesNow, linesBefore]),
    }),
  );
  let distancesNow = slideDistances(nowWithPlaceBefore, frozenCount, spanOfLinesFrom(drawnBefore, frozenCount));
  let now = drawnNow.flatMap((line: LineDrawn, position: number): LineSlid[] => {
    let by = distancesNow[position] ?? 0;
    return by === 0 && !wasOutOfSight(line)
      ? []
      : [
          {
            key: line.key,
            by,
          },
        ];
  });
  let keysNow = new Set(drawnNow.map(({ key }: LineDrawn) => key));
  let gone = drawnBefore.filter(({ key }: LineDrawn) => !keysNow.has(key));
  let distancesGone = slideDistances(
    gone.map(
      (line: LineDrawn): LineDrawnElsewhere => ({
        ...line,
        elsewhere: startElsewhere(line, [linesBefore, linesNow]),
      }),
    ),
    frozenCount,
    spanOfLinesFrom(drawnNow, frozenCount),
  );
  let asBefore = gone.map(
    ({ key, index }: LineDrawn, position: number): LineSlidAway => ({
      key,
      by: distancesGone[position] ?? 0,
      isOutOfSight: lineSpanOf(linesNow, index).size === 0,
    }),
  );
  return now.length === 0 && asBefore.length === 0
    ? null
    : {
        axis,
        now,
        asBefore,
        bandsNow: bandsOfSlide(drawnNow, now, true),
        bandsAsBefore: bandsOfSlide(drawnBefore, asBefore, false),
      };
}
export function slideBetween(before: GridWithLines<GridToSlide>, now: GridWithLines<GridToSlide>): SlideOfAxis | null {
  let [linesBefore, linesNow] = [before.lines, now.lines];
  if (linesBefore.sheetId !== linesNow.sheetId) return null;
  let axis = (['rows', 'columns'] as const).find(
    (lineAxis: LinesAxisName) =>
      linesBefore[lineAxis].order !== null &&
      linesBefore[lineAxis].order === linesNow[lineAxis].order &&
      !areSameOutOfSight(linesBefore[lineAxis].outOfSight, linesNow[lineAxis].outOfSight),
  );
  return axis === undefined ? null : slideOfAxis(axis, [before.grid, now.grid], [linesBefore[axis], linesNow[axis]]);
}
export function mostCommonOf(values: readonly number[]): number {
  let counts = new Map<number, number>();
  for (let value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].reduce((most: [number, number], entry: [number, number]) => (entry[1] > most[1] ? entry : most), [0, 0])[0];
}
export function haveLinesMoved(before: GridWithLines<GridToSlide>, now: GridWithLines<GridToSlide>): boolean {
  let [linesBefore, linesNow] = [before.lines, now.lines];
  if (linesBefore.sheetId !== linesNow.sheetId) return true;
  if (
    (['rows', 'columns'] as const).some(
      (axis: LinesAxisName) =>
        linesBefore[axis].order !== linesNow[axis].order || !areSameOutOfSight(linesBefore[axis].outOfSight, linesNow[axis].outOfSight),
    )
  )
    return true;
  let [row, column] = [
    now.grid.rows.find(({ isFrozen }: RowToSlide) => !isFrozen),
    now.grid.columnHeaders.find(({ isFrozen }: ColumnHeaderToSlide) => !isFrozen),
  ];
  return (
    (row !== undefined && lineSpanOf(linesBefore.rows, row.rowNumber - 1).start !== row.top) ||
    (column !== undefined && lineSpanOf(linesBefore.columns, column.columnNumber - 1).start !== column.left)
  );
}
export function veilsOfSlide(
  grid: GridToSlide,
  { axis, asBefore }: Pick<SlideOfAxis, 'axis' | 'asBefore'> = {} as Pick<SlideOfAxis, 'axis' | 'asBefore'>,
): VeilOfSlide[] {
  let byOfKey = new Map(
    asBefore.flatMap(({ key, by, isOutOfSight }: LineSlidAway): [string, number][] => (isOutOfSight ? [[key, by]] : [])),
  );
  let veils: VeilOfSlide[] = [];
  for (let { key, start, size } of linesDrawnOf(grid, axis)) {
    let [by, last] = [byOfKey.get(key), veils.at(-1)];
    if (by === undefined) continue;
    if (last?.by === by && last.start + last.size === start) last.size += size;
    else
      veils.push({
        start,
        size,
        by,
      });
  }
  return veils;
}
export function linesAsBeforeOf<Grid extends GridToSlide>(grid: Grid, slide: SlideOfAxis): LinesAsBefore<Grid> {
  let byOfKey = new Map(slide.asBefore.map(({ key, by }: LineSlidAway): [string, number] => [key, by]));
  let veils = veilsOfSlide(grid, slide);
  if (slide.axis === 'columns')
    return {
      grid,
      slide,
      veils,
      groups: [
        {
          by: mostCommonOf([...byOfKey.values()]),
          rows: grid.rows.map(
            (row: Grid['rows'][number]): Grid['rows'][number] => ({
              ...row,
              cells: row.cells.filter(({ key }: { key: string }) => byOfKey.has(key)),
            }),
          ),
        },
      ],
      columnHeaders: grid.columnHeaders.filter(({ key }: ColumnHeaderToSlide) => byOfKey.has(key)),
    };
  let groups: GroupOfLinesGoing<Grid['rows'][number]>[] = [];
  for (let row of grid.rows) {
    let [by, last] = [byOfKey.get(row.key), groups.at(-1)];
    if (by === undefined) continue;
    if (last?.by === by) last.rows.push(row);
    else
      groups.push({
        by,
        rows: [row],
      });
  }
  return {
    groups,
    columnHeaders: [],
    veils,
    grid,
    slide,
  };
}
export function paceAfterSlide(pace: SlidePace, tookMs: number, nowMs: number): SlidePace {
  if (!pace.isFirstPlayOver)
    return {
      ...pace,
      isFirstPlayOver: true,
    };
  if (tookMs <= SLIDE_SETTLE_MS)
    return {
      ...pace,
      inARow: 0,
      nextRestMs: FIRST_SLIDE_REST_MS,
    };
  if (pace.inARow === 0)
    return {
      ...pace,
      inARow: 1,
    };
  return {
    ...pace,
    inARow: 0,
    nextRestMs: Math.min(4 * pace.nextRestMs, LONGEST_SLIDE_REST_MS),
    restUntilMs: nowMs + pace.nextRestMs,
  };
}
export function createSlideTold(): SlideTold {
  let slide: SlideOfAxis | null = null;
  let listeners = new Set<() => void>();
  return {
    tell(slideNow: SlideOfAxis | null) {
      if (slideNow === slide) return;
      slide = slideNow;
      for (let listener of listeners) listener();
    },
    now: () => slide,
    subscribe(listener: () => void) {
      return (listeners.add(listener), () => void listeners.delete(listener));
    },
  };
}
export function marksOfGrid(element: Element): MarksOfGrid {
  let marks: MarksOfGrid = new Map();
  for (let mark of element.closest('.sheet-with-group-margins')?.querySelectorAll(MARKS_THAT_SLIDE) ?? [])
    if ((mark instanceof HTMLElement || mark instanceof SVGElement) && mark.closest(MARKS_INSIDE_LINES) === null)
      marks.set(mark, [
        Number.parseFloat(mark.style.top),
        Number.parseFloat(mark.style.left),
        Number.parseFloat(mark.style.height),
        Number.parseFloat(mark.style.width),
      ]);
  return marks;
}
export function marksMovedBy(
  slide: SlideOfAxis,
  [marksBefore, marksNow]: readonly MarksOfGrid[] = [],
  parent: Element,
  body: Pick<PaneRect, 'left' | 'top'>,
): [HTMLElement | SVGElement, number][] {
  let [place, bodyStart] = slide.axis === 'rows' ? [0, body.top] : [1, body.left];
  return [...marksNow].flatMap(([mark, placeNow]: [HTMLElement | SVGElement, MarkPlace]): [HTMLElement | SVGElement, number][] => {
    let by =
      mark.parentElement === parent
        ? slideByAt(slide, placeNow[place] - bodyStart + 2)
        : (marksBefore.get(mark)?.[place] ?? placeNow[place]) - placeNow[place];
    let scale = mark instanceof HTMLElement ? Number.parseFloat(mark.style.scale) : Number.NaN;
    return by === 0 || Number.isNaN(by) ? [] : [[mark, Number.isNaN(scale) ? by : by / scale]];
  });
}
export function filterOutlinesResized(
  { axis }: Pick<SlideOfAxis, 'axis'>,
  [marksBefore, marksNow]: readonly MarksOfGrid[] = [],
): (HTMLElement | SVGElement)[] {
  let place = axis === 'rows' ? 2 : 3;
  return [...marksNow].flatMap(
    ([mark, placeNow]: [HTMLElement | SVGElement, MarkPlace]) =>
      mark.matches(OWN_FILTER_OUTLINE_SELECTOR) && marksBefore.get(mark)?.[place] !== placeNow[place] ? [mark] : [],
  );
}
export function slideTimingOf(element: Element): SlideTiming {
  return (slideTiming ??= readSlideTiming(element));
}
export function readSlideTiming(element: Element): SlideTiming {
  let style = (element.ownerDocument.defaultView ?? window).getComputedStyle(element);
  let duration = style.getPropertyValue('--ui-dur-base').trim();
  let easing = style.getPropertyValue('--ui-ease-out').trim();
  let durationMs = Number.parseFloat(duration) * (duration.endsWith('ms') ? 1 : 1000);
  return {
    duration: Number.isNaN(durationMs) ? 200 : durationMs,
    easing: easing === '' ? 'ease-out' : easing,
  };
}
export function linesMovedBy(
  { axis }: Pick<SlideOfAxis, 'axis'>,
  moves: readonly LineSlid[],
  parent: Element,
  columnHeaders: readonly ColumnHeaderToSlide[],
): [Element, number][] {
  let byOfKey = new Map(moves.map(({ key, by }: LineSlid): [string, number] => [key, by]));
  if (axis === 'rows')
    return [...parent.querySelectorAll(':scope > [data-row]')].flatMap((row: Element): [Element, number][] => {
      let by = byOfKey.get(row.getAttribute('data-row') ?? '');
      return by === undefined ? [] : [[row, by]];
    });
  let byOfColumn = new Map(
    columnHeaders.map(({ key, columnNumber }: ColumnHeaderToSlide): [string, number] => [String(columnNumber + 1), byOfKey.get(key) ?? 0]),
  );
  let rowBy = mostCommonOf([0, ...byOfColumn.values()]);
  let moved: [Element, number][] = [];
  for (let row of parent.querySelectorAll(':scope > [role="row"]')) {
    moved.push([row, rowBy]);
    for (let cell of row.children) moved.push([cell, (byOfColumn.get(cell.getAttribute('aria-colindex') ?? '') ?? 0) - rowBy]);
  }
  return moved;
}
export function nextSlideState<Grid extends GridToSlide>(
  { now: before, drawnAgain }: Pick<SlideState<Grid>, 'now' | 'drawnAgain'>,
  grid: Grid,
  lines: LinesOnShow | null,
  parent: Element | null,
  isReducedMotion: boolean,
): SlideState<Grid> {
  let now: GridWithLines<Grid> | null =
    lines === null
      ? null
      : {
          grid,
          lines,
        };
  let still: SlideState<Grid> = {
    grid,
    before,
    now,
    slide: null,
    marksBefore: NO_MARKS,
    drawnAgain,
  };
  if (before === null || now === null || parent === null || isReducedMotion) return still;
  let slide = slideBetween(before, now);
  let plannedAtMs = slide === null ? 0 : performance.now();
  if (slide === null || plannedAtMs < slidePaceByAxis[slide.axis].restUntilMs) return still;
  return {
    grid,
    before,
    now,
    slide,
    marksBefore: marksOfGrid(parent),
    drawnAgain: {
      slide,
      from: before.grid,
      plannedAtMs,
    },
  };
}
export function useLinesSlide<Grid extends GridToSlide>({
  grid,
  lines,
  slideTold: { tell, now: slideNow, subscribe },
}: LinesSlideProps<Grid>): [LinesAsBefore<Grid>, (element: HTMLElement | null) => void] {
  let [element, setElement] = React.useState<HTMLElement | null>(null);
  let parent = element?.parentElement ?? null;
  let win = element?.ownerDocument.defaultView ?? null;
  let [slideState, setSlideState] = React.useState<SlideState<Grid>>(NO_SLIDE_STATE);
  let isReducedMotion = useReducedMotion();
  if (slideState.grid !== grid) setSlideState(nextSlideState(slideState, grid, lines, parent, isReducedMotion));
  let [slideEnded, setSlideEnded] = React.useState<SlideOfAxis | null>(null);
  let { drawnAgain } = slideState;
  let asBefore = React.useMemo<LinesAsBefore<Grid>>(
    () => (drawnAgain === null || drawnAgain.slide === slideEnded ? NO_LINES_AS_BEFORE : linesAsBeforeOf(drawnAgain.from, drawnAgain.slide)),
    [drawnAgain, slideEnded],
  );
  let animations = React.useRef<SlideAnimations>({
    staying: [],
    going: [],
  });
  let slideOn = React.useRef<SlideOfAxis | null>(null);
  let slidePlayed = React.useRef<SlideOfAxis | null>(null);
  let pausedByPress = React.useRef<SlidePausedByPress | null>(null);
  let endSlide = React.useCallback(() => {
    if (slideOn.current === null) return;
    setSlideEnded(slideOn.current);
    slideOn.current = null;
    pausedByPress.current = null;
    for (let animation of animations.current.staying) animation.cancel();
    for (let animation of animations.current.going) if (animation.playState === 'paused') animation.finish();
    animations.current = {
      staying: [],
      going: [],
    };
    tell(null);
  }, [tell]);
  let animateStaying = React.useCallback(
    (target: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) =>
      void animations.current.staying.push(
        target.animate(keyframes, {
          ...options,
          id: LINES_SLIDE_ANIMATION_ID,
        }),
      ),
    [],
  );
  React.useLayoutEffect(() => {
    let { before, now, slide, marksBefore } = slideState;
    if (now === null || before === null || parent === null) return;
    if (slide === null) {
      if (haveLinesMoved(before, now)) endSlide();
      return;
    }
    endSlide();
    slideOn.current = slide;
    queueMicrotask(() => {
      if (slideOn.current !== slide) return;
      for (let [line, by] of linesMovedBy(slide, slide.now, parent, now.grid.columnHeaders)) {
        if (by === 0 && slide.axis === 'columns') continue;
        animateStaying(
          line,
          [
            {
              transform: translateAlong(slide.axis, by),
            },
            {
              transform: 'none',
            },
          ],
          slideTimingOf(parent),
        );
      }
      let marks = [marksBefore, marksOfGrid(parent)];
      for (let [mark, by] of marksMovedBy(slide, marks, parent, now.grid.body))
        animateStaying(
          mark,
          [
            {
              transform: translateAlong(slide.axis, by),
            },
            {
              transform: 'none',
            },
          ],
          slideTimingOf(parent),
        );
      for (let outline of filterOutlinesResized(slide, marks))
        animateStaying(outline, FADE_IN_LATE, {
          ...slideTimingOf(parent),
          easing: 'linear',
        });
      tell(slide);
    });
  }, [slideState, parent, endSlide, animateStaying, tell]);
  let slideShown = React.useSyncExternalStore(subscribe, slideNow, slideNow);
  return (
    React.useLayoutEffect(() => {
      if (slideShown === null || slideShown !== asBefore.slide || slideShown !== slideOn.current || element === null) return;
      if (slidePlayed.current === slideShown) return;
      slidePlayed.current = slideShown;
      let { axis, asBefore: movesBefore } = slideShown;
      let timing: KeyframeAnimationOptions = {
        ...slideTimingOf(element),
        fill: 'forwards',
      };
      let animateGoing = (target: Element, by: number, extra: [Keyframe, Keyframe] = [{}, {}]) =>
        void animations.current.going.push(
          target.animate(
            [
              {
                transform: 'none',
                ...extra[0],
              },
              {
                transform: translateAlong(axis, by),
                ...extra[1],
              },
            ],
            timing,
          ),
        );
      let byOfColumn = new Map(
        asBefore.columnHeaders.map(
          ({ key, columnNumber }: ColumnHeaderToSlide): [string, number | undefined] => [
            String(columnNumber + 1),
            movesBefore.find((move: LineSlidAway) => move.key === key)?.by,
          ],
        ),
      );
      for (let group of element.querySelectorAll(':scope > .sheet-lines-that-go')) {
        let groupBy = Number(group.getAttribute('data-goes-by'));
        animateGoing(group, groupBy);
        for (let cell of axis === 'rows' ? [] : group.querySelectorAll(':scope > [role="row"] > *')) {
          let cellBy = byOfColumn.get(cell.getAttribute('aria-colindex') ?? '') ?? groupBy;
          if (cellBy !== groupBy) animateGoing(cell, cellBy - groupBy);
        }
      }
      for (let veil of element.querySelectorAll(':scope > .sheet-veil-over-lines-that-go'))
        animateGoing(veil, Number(veil.getAttribute('data-goes-by')), [
          {
            opacity: 0,
          },
          {
            opacity: VEIL_OPACITY,
          },
        ]);
      let bandsIn = (container: Element | null): Element[] => [...(container?.querySelectorAll(':scope > [data-band]') ?? [])];
      bandsIn(element).forEach((band: Element, index: number) => animateGoing(band, slideShown.bandsAsBefore[index]?.by ?? 0));
      let bodyStart = axis === 'rows' ? asBefore.grid?.body.top : asBefore.grid?.body.left;
      let [firstStaying] = animations.current.staying;
      let bandAnimations: Animation[] = [];
      bandsIn(element.parentElement).forEach((band: Element, index: number) => {
        let bandNow = slideShown.bandsNow[index];
        if (bandNow === undefined || bodyStart === undefined) return;
        let keyframes: Keyframe[] = [
          {
            transform: translateAlong(axis, bandNow.by),
            clipPath: bandClipPath(axis, bodyStart, bandNow, bandNow.covered),
          },
          {
            transform: 'none',
            clipPath: bandClipPath(axis, bodyStart, bandNow),
          },
        ];
        bandAnimations.push(band.animate(keyframes, slideTimingOf(band)));
      });
      animations.current.staying.push(...bandAnimations);
      let these = animations.current;
      let all = [...these.staying, ...these.going];
      if (firstStaying !== undefined) for (let animation of bandAnimations) animation.pause();
      let plannedAtMs = slideState.drawnAgain?.plannedAtMs ?? performance.now();
      let isPaceNoted = false;
      let notePace = () => {
        if (!isPaceNoted) slidePaceByAxis[axis] = paceAfterSlide(slidePaceByAxis[axis], performance.now() - plannedAtMs, performance.now());
        isPaceNoted = true;
      };
      let endIfStill = () => void (animations.current === these && pausedByPress.current === null && endSlide());
      firstStaying?.ready.then(
        () => {
          notePace();
          if (animations.current !== these) return;
          win?.setTimeout(endIfStill, Number(timing.duration) + SLIDE_SETTLE_MS);
          if (pausedByPress.current === null) for (let animation of bandAnimations) animation.startTime = firstStaying.startTime;
          return;
        },
        () => void (animations.current === these && endSlide()),
      );
      if (firstStaying === undefined) win?.setTimeout(endIfStill, Number(timing.duration) + SLIDE_SETTLE_MS);
      win?.setTimeout(() => {
        if (firstStaying?.pending !== true) return;
        notePace();
        endIfStill();
      }, START_WAIT_MS);
      Promise.allSettled(all.map(({ finished }: Animation) => finished)).then(() => {
        if (animations.current === these) endSlide();
        return;
      });
    }, [slideShown, asBefore, element, win, slideState, endSlide]),
    React.useLayoutEffect(() => {
      if (element === null || win === null) return;
      slideTimingOf(element);
      let endAfter = (these: SlideAnimations, ms: number) =>
        void win.setTimeout(() => void (animations.current === these && endSlide()), ms);
      let onPointerDown = ({ target, button, isPrimary, pointerId }: PointerEvent) => {
        if (slideOn.current === null || !isWithin(target, GRID_AREA_SELECTOR)) return;
        if (button !== 0 || !isPrimary || !isWithin(target, PRESSABLE_SELECTOR) || isWithin(target, '.sheet-row')) return endSlide();
        let these = animations.current;
        pausedByPress.current = {
          these,
          pointerId,
        };
        for (let animation of [...these.staying, ...these.going]) animation.pause();
        return endAfter(these, PAUSED_PRESS_MS);
      };
      let onPointerUp = ({ pointerId }: PointerEvent) => {
        if (pausedByPress.current?.pointerId === pointerId) endAfter(pausedByPress.current.these, PRESS_LIFT_REPEAT_MAX_MS);
      };
      let onClick = () => void (pausedByPress.current !== null && endSlide());
      let onPointerCancel = ({ pointerId }: PointerEvent) =>
        void (pausedByPress.current?.pointerId === pointerId && endSlide());
      let onKeyDown = ({ target }: KeyboardEvent) => void (isWithin(target, DIALOG_SELECTOR) || endSlide());
      let onBlur = ({ target }: FocusEvent) => void (target === win && endSlide());
      let listening = new AbortController();
      let options: AddEventListenerOptions = {
        capture: true,
        signal: listening.signal,
      };
      return (
        win.addEventListener('pointerdown', onPointerDown, options),
        win.addEventListener('pointerup', onPointerUp, options),
        win.addEventListener('pointercancel', onPointerCancel, options),
        win.addEventListener('click', onClick, options),
        win.addEventListener('keydown', onKeyDown, options),
        win.addEventListener('blur', onBlur, options),
        win.addEventListener('contextmenu', endSlide, options),
        win.addEventListener('dragstart', endSlide, options),
        win.document.addEventListener('visibilitychange', endSlide, options),
        () => {
          listening.abort();
          endSlide();
        }
      );
    }, [element, win, endSlide]),
    [asBefore, setElement]
  );
}
export const LINES_SLIDE_ANIMATION_ID = 'lines-slide';
export const linesDrawnOf = (grid: GridToSlide, axis: LinesAxisName): LineDrawn[] =>
  axis === 'rows'
    ? grid.rows.map(
        (row: RowToSlide): LineDrawn => ({
          key: row.key,
          index: row.rowNumber - 1,
          start: row.top,
          size: row.height,
        }),
      )
    : grid.columnHeaders.map(
        (column: ColumnHeaderToSlide): LineDrawn => ({
          key: column.key,
          index: column.columnNumber - 1,
          start: column.left,
          size: column.width,
        }),
      );
export const lineSpanOf = ({ edges, frozenCount, scroll }: Pick<AxisLinesOnShow, 'edges' | 'frozenCount' | 'scroll'>, index: number): LineOnScreen => ({
  start: edges.startOf(index) - (index < frozenCount ? 0 : scroll),
  size: edges.sizeOf(index),
});
export const areSameOutOfSight = (one: readonly LineSpan[], other: readonly LineSpan[]): boolean =>
  one === other ||
  (one.length === other.length &&
    one.every(
      ({ firstIndex, count }: LineSpan, index: number) =>
        firstIndex === other[index]?.firstIndex && count === other[index].count,
    ));
export const slideByAt = ({ bandsNow }: Pick<SlideOfAxis, 'bandsNow'>, at: number): number =>
  bandsNow.find(({ start, size }: BandOfSlide) => at >= start && at < start + size)?.by ?? 0;
export const NO_LINES_AS_BEFORE: LinesAsBefore<never> = {
  groups: [],
  columnHeaders: [],
  veils: [],
  grid: null,
  slide: null,
};
export const groupIndexAt = ({ groups }: { groups: readonly GroupOfLinesGoing<Pick<RowToSlide, 'top'>>[] }, top: number): number =>
  Math.max(
    0,
    groups.findLastIndex(({ rows }: GroupOfLinesGoing<Pick<RowToSlide, 'top'>>) => (rows[0]?.top ?? 0) <= top),
  );
export const SLIDE_SETTLE_MS = 150;
export const FIRST_SLIDE_REST_MS = 30000;
export const LONGEST_SLIDE_REST_MS = 64 * FIRST_SLIDE_REST_MS;
export const SLIDE_PACE_START: SlidePace = {
  isFirstPlayOver: false,
  inARow: 0,
  nextRestMs: FIRST_SLIDE_REST_MS,
  restUntilMs: 0,
};
export const MARKS_THAT_SLIDE = [
  'selection',
  'selection-summary',
  'active-cell-outline',
  'edge-to-move-cells-by',
  'fill-handle',
  'fill-preview',
  'copied-cells',
  'table-outline',
  'handle-of-table',
  'spill-outline',
  'own-filter-outline',
  'own-filter-button',
  'ground-of-filter-button-held',
  'outline-of-other',
  'name-flags-of-others',
  'room-of-change-by-agent',
  'agent-at-work',
  'comment-wash',
  'comment-mark',
  'found',
  'mark-of-reference',
  'text-under-mark-of-reference',
  'reach-of-editor',
  'offers-at-selection',
  'placed-view',
  'group-bracket',
  'group-mark',
  'seam',
]
  .map((name: string) => `.sheet-${name}`)
  .join(',');
export const MARKS_INSIDE_LINES =
  '.sheet-row, .sheet-header-row, .sheet-header-kept, .sheet-cells-held, .sheet-lines-as-before, [data-is-in-view="false"]';
export const NO_MARKS: MarksOfGrid = new Map();
export const OWN_FILTER_OUTLINE_SELECTOR = '.sheet-own-filter-outline';
export const FADE_IN_LATE: Keyframe[] = [
  {
    opacity: 0,
  },
  {
    opacity: 0,
    offset: 0.5,
  },
  {
    opacity: 1,
  },
];
slideTiming = null;
export const VEIL_OPACITY = 0.4;
export const translateAlong = (axis: LinesAxisName, by: number): string => (axis === 'rows' ? `translateY(${by}px)` : `translateX(${by}px)`);
export const NO_SLIDE_STATE: SlideState<never> = {
  grid: null,
  before: null,
  now: null,
  slide: null,
  marksBefore: NO_MARKS,
  drawnAgain: null,
};
export const PRESSABLE_SELECTOR = ['button', 'a', '[role="button"]'].join(',');
export const GRID_AREA_SELECTOR = '.sheet-grid-zoomed, .sheet-group-lanes';
export const PAUSED_PRESS_MS = 1000;
export const START_WAIT_MS = 500;
export const slidePaceByAxis: Record<LinesAxisName, SlidePace> = {
  rows: SLIDE_PACE_START,
  columns: SLIDE_PACE_START,
};
export const DIALOG_SELECTOR = '[role="dialog"]';
export const isWithin = (target: EventTarget | null, selector: string): boolean => target instanceof Element && target.closest(selector) !== null;
