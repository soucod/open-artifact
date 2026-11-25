import { Surface } from '../kit/surface.tsx';
import { Skeleton } from '../kit/skeleton.tsx';
import * as React from 'react';
import type { PaneRect } from '../grid/geometry.ts';
import type { ChartBeingMadeShown } from './chart-being-made-state.ts';
import type { StyleWithCustomProperties } from './chart-placeholders.tsx';
import type { ChartKindOrAny } from './chart-words.ts';
import type { StockKind } from './stock-programs.ts';
export let SKETCH_WIDTH: number;
export let SKETCH_HEIGHT: number;
export let MARK_DELAY_BASE_S: number;
export let MARK_DELAY_SPAN_S: number;
export let SKETCH_PIE_OUTER_RADIUS: number;
export let SKETCH_PIE_INNER_RADIUS: number;
/** One of the sketches drawn while a chart of a kind is being made. */
export interface ChartSketchShape {
  kind: StockKind;
  nth: number;
}
/** One mark of a sketch: where across the sketch it is (0 to 1), and whether it grows up from the foot. */
export interface SketchMark {
  id: string;
  at: number;
  risesFromFoot: boolean;
  drawn: React.ReactNode;
}
/** How the card of a chart being made stands: while the agent writes, until the chart is drawn, or on its way out. */
export type ChartBeingMadeStands = 'whileAgentWrites' | 'untilChartIsDrawn' | 'leaving';
/** How one sketch stands as the next takes its place. */
type SketchStands = 'atRest' | 'coming' | 'going' | 'fading';
export function barSketch(nth: number): SketchMark[] {
  let heights = SKETCH_BAR_HEIGHTS[nth] ?? SKETCH_BAR_HEIGHTS[0];
  let [slotWidth, barWidth] = [SKETCH_WIDTH / heights.length, 34];
  return heights.map((height, index) => {
    let x = index * slotWidth + (slotWidth - barWidth) / 2;
    return {
      id: String(index),
      at: (x + barWidth / 2) / SKETCH_WIDTH,
      risesFromFoot: true,
      drawn: <path d={sketchBarPath(x, barWidth, SKETCH_HEIGHT * (1 - height / 100), SKETCH_HEIGHT, true)} fillOpacity={SKETCH_OPACITIES[0]} />,
    };
  });
}
export function stackedBarSketch(nth: number): SketchMark[] {
  let heights = SKETCH_BAR_HEIGHTS[nth] ?? SKETCH_BAR_HEIGHTS[0];
  let [slotWidth, barWidth] = [SKETCH_WIDTH / SKETCH_STACK_COLUMNS.length, 44];
  return SKETCH_STACK_COLUMNS.map((column, index) => {
    let x = index * slotWidth + (slotWidth - barWidth) / 2;
    let columnHeight = (SKETCH_HEIGHT * (heights[column] ?? 0)) / 100;
    let shares = SKETCH_STACK_SHARES[(index + nth) % SKETCH_STACK_SHARES.length] ?? SKETCH_STACK_SHARES[0];
    let top = SKETCH_HEIGHT;
    return {
      id: String(index),
      at: (x + barWidth / 2) / SKETCH_WIDTH,
      risesFromFoot: true,
      drawn: <>{shares.map((share, part) => {
          let [bottom, isTopPart] = [top, part === shares.length - 1];
          top -= columnHeight * share;
          return <path key={share} d={sketchBarPath(x, barWidth, top + (isTopPart ? 0 : SKETCH_STACK_GAP), bottom, isTopPart)} fillOpacity={SKETCH_OPACITIES[part]} />;
        })}</>,
    };
  });
}
export function lineSketch(nth: number): SketchMark[] {
  return [SKETCH_BAR_HEIGHTS[nth] ?? SKETCH_BAR_HEIGHTS[0], SKETCH_SECOND_LINE[nth] ?? SKETCH_SECOND_LINE[0]].flatMap(
    (values, lineIndex) => {
      let points = values.map(
        (value, index) => ({
          x: 20 + ((SKETCH_WIDTH - 40) * index) / (values.length - 1),
          y: SKETCH_HEIGHT * (1 - value / 100),
        }),
      );
      return points.slice(1).map((point, index) => {
        let previous = points[index] ?? point;
        return {
          id: `${String(lineIndex)}-${String(index)}`,
          at: (previous.x + point.x) / 2 / SKETCH_WIDTH,
          risesFromFoot: false,
          drawn: <path d={`M${previous.x} ${previous.y}L${point.x} ${point.y}`} className="sheet-line-of-chart-being-made" strokeOpacity={SKETCH_LINE_OPACITIES[lineIndex]} />,
        };
      });
    },
  );
}
export function pieMarksOfChartBeingMade(nth: number): SketchMark[] {
  let slices = SKETCH_PIE_SLICES[nth] ?? SKETCH_PIE_SLICES[0];
  let [radius, ringWidth] = [(SKETCH_PIE_OUTER_RADIUS + SKETCH_PIE_INNER_RADIUS) / 2, SKETCH_PIE_OUTER_RADIUS - SKETCH_PIE_INNER_RADIUS];
  let sliceStart = 0;
  return slices.map((share, index) => {
    let startOfSlice = sliceStart;
    sliceStart += share;
    return {
      id: String(index),
      at: 0.5 + (radius * Math.sin(((startOfSlice + share / 2) / 100) * 2 * Math.PI)) / SKETCH_WIDTH,
      risesFromFoot: false,
      drawn: <circle cx={SKETCH_WIDTH / 2} cy={SKETCH_HEIGHT / 2} r={radius} pathLength={100} fill="none" stroke="currentColor" strokeWidth={ringWidth} strokeDasharray={`${share - SKETCH_PIE_GAP} 100`} strokeDashoffset={-startOfSlice} strokeOpacity={SKETCH_OPACITIES[index]} transform={`rotate(-90 ${SKETCH_WIDTH / 2} ${SKETCH_HEIGHT / 2})`} />,
    };
  });
}
export function timeOfEaseOutQuartProgress(progress: number): number {
  let [low, high] = [0, 1];
  for (let step = 0; step < 24; step += 1) {
    let mid = (low + high) / 2;
    if (3 * (1 - mid) * (1 - mid) * mid * 0.84 + 3 * (1 - mid) * mid * mid + mid * mid * mid < progress) low = mid;
    else high = mid;
  }
  let solvedTime = (low + high) / 2;
  return (
    3 * (1 - solvedTime) * (1 - solvedTime) * solvedTime * 0.165 +
    3 * (1 - solvedTime) * solvedTime * solvedTime * 0.44 +
    solvedTime * solvedTime * solvedTime
  );
}
interface ChartBeingMadeShapeProps {
  shape: ChartSketchShape;
  stands: SketchStands;
  hasFoot: boolean;
}
export function ChartBeingMadeShape({ shape: { kind, nth }, stands, hasFoot }: ChartBeingMadeShapeProps) {
  return <svg viewBox={`0 0 ${String(SKETCH_WIDTH)} ${String(SKETCH_HEIGHT)}`} data-stands={stands} {...(kind !== 'pie' && {
      preserveAspectRatio: 'none',
    })}>{hasFoot &&
        kind !== 'pie' &&
        <g style={changeReachesMarkStyle(0.5)}>{chartBeingMadeFootLine}</g>}{marksOfChartBeingMade(kind, nth).map(
        (mark) =>
          <g key={mark.id} data-rises-from-foot={mark.risesFromFoot} style={changeReachesMarkStyle(mark.at)}>{mark.drawn}</g>,
      )}</svg>;
}
interface ChartBeingMadePassProps {
  kind: ChartKindOrAny;
  /** How many sketches have been drawn before this one. */
  pass: number;
}
export function ChartBeingMadePass({ kind, pass }: ChartBeingMadePassProps) {
  let shapes = shapesOfChartKind(kind);
  let shapeOfPass = (passIndex: number): ChartSketchShape =>
    shapes[passIndex % shapes.length] ?? {
      kind: 'bar',
      nth: 0,
    };
  let [previousShape, currentShape] = [pass === 0 ? null : shapeOfPass(pass - 1), shapeOfPass(pass)];
  let showsFootAlone = isChartShapeWithFoot(currentShape) && (previousShape === null || isChartShapeWithFoot(previousShape));
  return <>{showsFootAlone &&
        <svg viewBox={`0 0 ${String(SKETCH_WIDTH)} ${String(SKETCH_HEIGHT)}`} preserveAspectRatio="none"><g>{chartBeingMadeFootLine}</g></svg>}{previousShape !== null &&
        <ChartBeingMadeShape key={pass - 1} shape={previousShape} stands={previousShape.kind === currentShape.kind && isChartShapeWithFoot(currentShape) ? 'going' : 'fading'} hasFoot={!showsFootAlone} />}<ChartBeingMadeShape key={pass} shape={currentShape} stands={previousShape === null ? 'atRest' : 'coming'} hasFoot={!showsFootAlone} /></>;
}
interface ChartBeingMadeProps {
  beingMade: ChartBeingMadeShown | null;
  body: PaneRect;
  /** The placements whose charts have told of how they are drawn. */
  placesToldOf: ReadonlySet<string>;
  onGone: (nth: number) => void;
}
interface ChartBeingMadeCardProps extends ChartBeingMadeProps {
  /** The chart being made as the card draws it, which stays after the page lets go of it. */
  drawn: ChartBeingMadeShown;
}
export function ChartBeingMadeCard({
  drawn: { nth, box, kind, isAdded, isInView },
  beingMade,
  body,
  placesToldOf,
  onGone,
}: ChartBeingMadeCardProps) {
  let [isLeaving, setIsLeaving] = React.useState(false);
  let [settledStands, setSettledStands] = React.useState<ChartBeingMadeStands | null>(null);
  let isBeingMade = beingMade !== null;
  let { hasLandedElsewhere = false }: Partial<ChartBeingMadeShown> = beingMade ?? {};
  let [placementId, setPlacementId] = React.useState<string | null>(null);
  let newPlacementId = beingMade?.placementId ?? null;
  if (newPlacementId !== null && newPlacementId !== placementId) setPlacementId(newPlacementId);
  if (
    !isLeaving &&
    settledStands === null &&
    isChartBeingMadeDone({
      isBeingMade,
      placementId,
      hasLandedElsewhere,
      placesToldOf,
    })
  )
    setIsLeaving(true);
  let stands: ChartBeingMadeStands = settledStands ?? (isLeaving ? 'leaving' : isAdded || placementId !== null ? 'untilChartIsDrawn' : 'whileAgentWrites');
  return <div aria-hidden className="sheet-room-of-placed-view" style={{
      left: body.left + box.showsIn.left,
      top: body.top + box.showsIn.top,
      width: box.showsIn.width,
      height: box.showsIn.height,
    }}><div className="sheet-placed-view sheet-place-of-chart-being-made" data-stands={stands} style={{
        left: box.left - box.showsIn.left,
        top: box.top - box.showsIn.top,
        width: box.width,
        height: box.height,
      }} onAnimationStart={({ target, currentTarget, animationName }) => {
        let standsOfAnimation = STANDS_OF_CHART_BEING_MADE_ANIMATION.get(animationName);
        if (target === currentTarget && standsOfAnimation !== undefined && standsOfAnimation === stands) setSettledStands(standsOfAnimation);
      }} onAnimationEnd={({ target, currentTarget }) => {
        if (target === currentTarget) onGone(nth);
      }}><div className="sheet-face-of-chart-being-made size-full"><Surface elevation="panel" className="sheet-ground-of-chart size-full">{isInView &&
            <div className="sheet-chart-on-its-way" data-comes-at-once><Skeleton decorative width="45%" className="flex-none text-heading" /><ChartBeingMadeSketch kind={kind} /></div>}</Surface></div></div></div>;
}
export function ChartBeingMade(props: ChartBeingMadeProps) {
  let { beingMade, onGone } = props;
  let [drawn, setDrawn] = React.useState(beingMade);
  let [goneNth, setGoneNth] = React.useState<number | null>(null);
  if (beingMade !== null && beingMade !== drawn && beingMade.nth !== goneNth) setDrawn(beingMade);
  if (drawn === null) return null;
  return <ChartBeingMadeCard key={drawn.nth} {...props} beingMade={beingMade?.nth === drawn.nth ? beingMade : null} drawn={drawn} onGone={(nth) => {
        setGoneNth(nth);
        setDrawn((current) => (current?.nth === nth ? null : current));
        onGone(nth);
      }} />;
}
[SKETCH_WIDTH, SKETCH_HEIGHT] = [432, 188];
[MARK_DELAY_BASE_S, MARK_DELAY_SPAN_S] = [0.08, 1.863];
export const MARK_DELAY_EASE_SCALE = 0.85;
export const SKETCHES_PER_KIND = 8;
export const SKETCH_BAR_HEIGHTS = [
  [38, 52, 44, 66, 58, 80, 72, 92],
  [90, 72, 78, 58, 64, 44, 50, 32],
  [34, 54, 74, 92, 84, 66, 48, 38],
  [86, 66, 48, 36, 42, 58, 76, 90],
  [62, 40, 74, 50, 86, 58, 94, 68],
  [58, 88, 76, 62, 68, 48, 54, 40],
  [30, 42, 56, 64, 78, 90, 70, 82],
  [44, 70, 56, 38, 60, 88, 72, 50],
];
export const SKETCH_SECOND_LINE = [
  [18, 24, 34, 30, 44, 40, 56, 52],
  [50, 54, 42, 44, 32, 34, 20, 18],
  [20, 30, 40, 52, 48, 38, 30, 26],
  [48, 38, 30, 22, 20, 30, 40, 50],
  [26, 22, 36, 30, 46, 38, 54, 48],
  [30, 50, 44, 36, 38, 28, 30, 22],
  [16, 20, 28, 36, 40, 52, 44, 46],
  [24, 36, 30, 20, 32, 48, 40, 28],
];
export const SKETCH_PIE_SLICES = [
  [34, 24, 18, 14, 10],
  [44, 32, 24],
  [28, 24, 18, 14, 10, 6],
  [40, 26, 20, 14],
  [30, 22, 20, 16, 12],
  [38, 34, 28],
  [46, 20, 14, 12, 8],
  [32, 28, 22, 18],
];
export const SKETCH_STACK_SHARES = [
  [0.44, 0.33, 0.23],
  [0.52, 0.26, 0.22],
  [0.36, 0.38, 0.26],
];
export const SKETCH_STACK_COLUMNS = [0, 1, 2, 4, 5, 7];
export const SKETCH_OPACITIES = [0.53, 0.37, 0.24, 0.37, 0.24, 0.37];
export const SKETCH_LINE_OPACITIES = [0.8, 0.45];
export const SKETCH_FOOT_OPACITY = 0.45;
export const SKETCH_BAR_CORNER_RADIUS = 4;
export const SKETCH_STACK_GAP = 1.5;
export const SKETCH_PIE_GAP = 1.2;
[SKETCH_PIE_OUTER_RADIUS, SKETCH_PIE_INNER_RADIUS] = [SKETCH_HEIGHT / 2 - 4, 0.6 * (SKETCH_HEIGHT / 2 - 4)];
export const ANY_KIND_SKETCHES: readonly ChartSketchShape[] = [
  {
    kind: 'bar',
    nth: 0,
  },
  {
    kind: 'line',
    nth: 2,
  },
  {
    kind: 'pie',
    nth: 0,
  },
  {
    kind: 'stackedBar',
    nth: 4,
  },
  {
    kind: 'bar',
    nth: 7,
  },
  {
    kind: 'line',
    nth: 5,
  },
  {
    kind: 'pie',
    nth: 1,
  },
  {
    kind: 'stackedBar',
    nth: 6,
  },
];
export const sketchBarPath = (x: number, width: number, top: number, bottom: number, isRoundedTop: boolean) =>
  isRoundedTop
    ? `M${x} ${bottom}V${top + SKETCH_BAR_CORNER_RADIUS}q0 ${-SKETCH_BAR_CORNER_RADIUS} ${SKETCH_BAR_CORNER_RADIUS} ${-SKETCH_BAR_CORNER_RADIUS}H${x + width - SKETCH_BAR_CORNER_RADIUS}q${SKETCH_BAR_CORNER_RADIUS} 0 ${SKETCH_BAR_CORNER_RADIUS} ${SKETCH_BAR_CORNER_RADIUS}V${bottom}z`
    : `M${x} ${bottom}V${top}H${x + width}V${bottom}z`;
export const marksOfChartBeingMade = (kind: StockKind, nth: number): SketchMark[] =>
  (
    ({
      bar: barSketch,
      stackedBar: stackedBarSketch,
      line: lineSketch,
      pie: pieMarksOfChartBeingMade,
      area: lineSketch,
      horizontalBar: barSketch,
      scatter: lineSketch,
    }) satisfies Record<StockKind, (nth: number) => SketchMark[]>
  )[kind](nth);
export const secondsUntilChangeReaches = (at: number) =>
  MARK_DELAY_BASE_S + MARK_DELAY_SPAN_S * timeOfEaseOutQuartProgress(at * MARK_DELAY_EASE_SCALE);
export const shapesOfChartKind = (kind: ChartKindOrAny): readonly ChartSketchShape[] =>
  kind === 'any'
    ? ANY_KIND_SKETCHES
    : Array.from(
        {
          length: SKETCHES_PER_KIND,
        },
        (unused, nth) => ({
          kind,
          nth,
        }),
      );
export const changeReachesMarkStyle = (at: number): StyleWithCustomProperties => ({
  '--sheet-change-reaches-mark': `${secondsUntilChangeReaches(at).toFixed(3)}s`,
});
export const chartBeingMadeFootLine = <path d={`M0 ${String(SKETCH_HEIGHT)}H${String(SKETCH_WIDTH)}`} className="sheet-foot-of-chart-being-made" strokeOpacity={SKETCH_FOOT_OPACITY} />;
export const isChartShapeWithFoot = ({ kind }: ChartSketchShape) => kind !== 'pie';
export const CHART_BEING_MADE_CLOCK_ANIMATION = 'sheet-clock-of-chart-being-made';
interface ChartBeingMadeSketchProps {
  kind: ChartKindOrAny;
}
export const ChartBeingMadeSketch = React.memo(function ({ kind }: ChartBeingMadeSketchProps) {
  let [pass, setPass] = React.useState(0);
  return <div aria-hidden className="sheet-chart-being-made" onAnimationIteration={({ target, currentTarget, animationName }) => {
      if (target === currentTarget && animationName === CHART_BEING_MADE_CLOCK_ANIMATION) setPass((count) => count + 1);
    }}><ChartBeingMadePass kind={kind} pass={pass} /></div>;
});
/** Whether a chart is still being made, where it was placed, and whether it has been drawn there. */
export interface ChartBeingMadeProgress {
  isBeingMade: boolean;
  placementId: string | null;
  hasLandedElsewhere: boolean;
  placesToldOf: ReadonlySet<string>;
}
export const isChartBeingMadeDone = (progress: ChartBeingMadeProgress) =>
  !progress.isBeingMade || progress.hasLandedElsewhere || (progress.placementId !== null && progress.placesToldOf.has(progress.placementId));
export const STANDS_OF_CHART_BEING_MADE_ANIMATION: ReadonlyMap<string, ChartBeingMadeStands> = new Map<string, ChartBeingMadeStands>([
  ['sheet-chart-being-made-goes-unfinished', 'whileAgentWrites'],
  ['sheet-chart-being-made-goes-at-last', 'untilChartIsDrawn'],
]);
