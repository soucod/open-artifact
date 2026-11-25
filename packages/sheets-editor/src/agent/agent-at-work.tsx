import * as React from 'react';
import { WORKING_CARD_SIZE, workingLineAt } from './turn-of-agent.ts';
import { agentBubbleTips, agentIsWorkingText } from '../i18n/agent-turn-labels.ts';
import { useCoarsePointer } from '../app/media-queries.ts';
import { frameSchedulerOf } from '../grid/frame-scheduler.ts';
import type { FrameScheduler } from '../grid/frame-scheduler.ts';
/** Gives a number from 0 up to but not including 1. */
type Random = () => number;
/** A point of the cursor, measured from the middle of where it roams. */
export interface CursorPoint {
  x: number;
  y: number;
}
/** One stroke of the cursor: when it starts (`t0`) and how long it takes (`T`) in seconds, how far it goes, and how far it bows sideways. */
export interface CursorStroke {
  t0: number;
  T: number;
  dx: number;
  dy: number;
  bend: number;
}
/** How far the cursor may roam from the middle, across and down. */
export interface RoamRadii {
  rx: number;
  ry: number;
}
/** Strokes of the cursor and the point it rests at after them. */
export interface CursorPath {
  strokes: CursorStroke[];
  rest: CursorPoint;
}
/** The path the cursor comes in by, and the point it starts from. */
export interface CursorIntroPath extends CursorPath {
  from: CursorPoint;
}
/** A window the cursor moves in, with its own constructors. */
type WindowOfCursor = Window & typeof globalThis;
interface AgentAtWorkProps {
  style: React.CSSProperties;
}
interface AgentWordsCrossfadeProps {
  words: string;
}
/** The width the words take, and whether they got narrower than before. */
interface WordsMeasured {
  width: number;
  isNarrower: boolean;
}
export function createSeededRandom(seed: number): Random {
  let state = seed >>> 0;
  return () => {
    state = (state + 1831565813) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}
export function cursorPositionAt(start: CursorPoint, strokes: readonly CursorStroke[], atSeconds: number): CursorPoint {
  let { x: atX, y: atY } = start;
  for (let stroke of strokes) {
    let progress = (atSeconds - stroke.t0) / stroke.T;
    if (progress <= 0) continue;
    let eased = cursorMotionEase(progress);
    atX += stroke.dx * eased;
    atY += stroke.dy * eased;
    let length = Math.hypot(stroke.dx, stroke.dy);
    if (length > 0 && stroke.bend !== 0 && progress < 1) {
      let sideways = (stroke.bend * cursorBendEnvelope(progress)) / length;
      atX += -stroke.dy * sideways;
      atY += stroke.dx * sideways;
    }
  }
  return {
    x: atX,
    y: atY,
  };
}
export function createCursorMotion(random: Random, from: CursorPoint, to: CursorPoint, startsAt: number, bendSide: number): CursorStroke[] {
  let deltaX = to.x - from.x;
  let deltaY = to.y - from.y;
  let distance = Math.hypot(deltaX, deltaY);
  let overshoot = random() < 0.75 ? 0.05 + 0.08 * random() : -(0.05 + 0.06 * random());
  let skew = (random() - 0.5) * 0.1;
  let firstStroke = {
    t0: startsAt,
    T: 0.9 + 0.25 * random() + Math.min(0.2, distance / 600),
    dx: deltaX * (1 + overshoot) - deltaY * skew,
    dy: deltaY * (1 + overshoot) + deltaX * skew,
    bend: bendSide * (0.1 + 0.1 * random()) * distance,
  };
  return [
    firstStroke,
    {
      t0: startsAt + (0.7 + 0.08 * random()) * firstStroke.T,
      T: 0.5 + 0.2 * random(),
      dx: deltaX - firstStroke.dx,
      dy: deltaY - firstStroke.dy,
      bend: 0,
    },
  ];
}
export function createCursorIntroPath(random: Random, { rx, ry }: RoamRadii, restsAtMiddle: boolean = false): CursorIntroPath {
  let side = random() < 0.65 ? 1 : -1;
  let rest = restsAtMiddle
    ? {
        x: 0,
        y: 0,
      }
    : {
        x: (random() - 0.5) * 0.3 * rx,
        y: (random() - 0.3) * 0.4 * ry,
      };
  let bendSide = random() < 0.7 ? side : -side;
  let lift = bendSide === side ? 0 : 0.2;
  let from = {
    x: side * (0.72 + 0.2 * random()) * rx,
    y: (0.65 - lift + 0.3 * random()) * ry,
  };
  if (random() < 0.6)
    return {
      from: from,
      strokes: createCursorMotion(random, from, rest, 0, bendSide),
      rest: rest,
    };
  let via = {
    x: rest.x + side * (0.1 + 0.3 * random()) * rx,
    y: rest.y - (0.4 + 0.4 * random()) * ry,
  };
  let firstStroke = {
    t0: 0,
    T: 0.85 + 0.2 * random(),
    dx: via.x - from.x,
    dy: via.y - from.y,
    bend: bendSide * 0.12 * Math.hypot(via.x - from.x, via.y - from.y),
  };
  return {
    from: from,
    strokes: [firstStroke, ...createCursorMotion(random, via, rest, (0.5 + 0.1 * random()) * firstStroke.T, -bendSide)],
    rest: rest,
  };
}
export function createCursorIdleMotion(
  random: Random,
  from: CursorPoint,
  { rx, ry }: RoamRadii,
  startsAt: number,
  comesBack: boolean = false,
): CursorPath {
  let clampWithin = (length: number, limit: number) => Math.min(limit, Math.max(-limit, length));
  let farthest = from;
  let farthestDistance = -1;
  for (let index = 0; index < 8 && farthestDistance < 30; index++) {
    let angle = random() * 2 * Math.PI;
    let reach = 30 + 50 * random();
    let candidate = {
      x: clampWithin(from.x + reach * Math.cos(angle), 0.62 * rx),
      y: clampWithin(from.y + 0.6 * reach * Math.sin(angle), 0.5 * ry),
    };
    let distance = Math.hypot(candidate.x - from.x, candidate.y - from.y);
    if (distance > farthestDistance) {
      farthestDistance = distance;
      farthest = candidate;
    }
  }
  let strokesOut = createCursorMotion(random, from, farthest, startsAt, random() < 0.5 ? 1 : -1);
  if (!comesBack)
    return {
      strokes: strokesOut,
      rest: farthest,
    };
  return {
    strokes: [...strokesOut, ...createCursorMotion(random, farthest, from, cursorMotionEndTime(strokesOut) + 1 + 2 * random(), random() < 0.5 ? 1 : -1)],
    rest: from,
  };
}
export function runAgentCursorMotion(
  view: WindowOfCursor,
  frames: FrameScheduler,
  area: Element,
  cursorElement: ElementCSSInlineStyle,
  bubbleElement: ElementCSSInlineStyle,
  widthBubbleElement: HTMLElement,
  isReducedMotion: boolean,
): () => void {
  let { clientWidth: areaWidth, clientHeight: areaHeight } = area;
  let { offsetWidth: bubbleWidth } = widthBubbleElement;
  let roamRadii = (): RoamRadii => ({
    rx: Math.max(0, (areaWidth - Math.max(WORKING_CARD_SIZE.width, AGENT_CURSOR_BUBBLE_GAP + bubbleWidth) - 2 * AGENT_CURSOR_MARGIN) / 2),
    ry: Math.max(0, (areaHeight - WORKING_CARD_SIZE.height - 2 * AGENT_CURSOR_MARGIN) / 2),
  });
  let random = createSeededRandom(Math.random() * 4294967296);
  let introPath = createCursorIntroPath(random, roamRadii());
  let { from, strokes } = introPath;
  let shownAt: CursorPoint | null = null;
  let velocity = {
    x: 0,
    y: 0,
  };
  let timeSeconds = AGENT_CURSOR_START_TIME;
  let lastFrameMs: number | null = null;
  let frameRequest: number | null = null;
  let idleTimer: number | undefined;
  let step = (nowMs: number) => {
    let elapsedSeconds = lastFrameMs === null ? 0 : Math.min(0.05, Math.max(0, (nowMs - lastFrameMs) / 1000));
    lastFrameMs = nowMs;
    timeSeconds += elapsedSeconds;
    let { rx, ry } = roamRadii();
    let pathPoint = isReducedMotion ? introPath.rest : cursorPositionAt(from, strokes, timeSeconds);
    let targetX = AGENT_CURSOR_MARGIN + rx + Math.min(rx, Math.max(-rx, pathPoint.x));
    let targetY = AGENT_CURSOR_MARGIN + ry + Math.min(ry, Math.max(-ry, pathPoint.y));
    let shown =
      isReducedMotion || shownAt === null
        ? {
            x: targetX,
            y: targetY,
          }
        : shownAt;
    for (let secondsLeft = elapsedSeconds; secondsLeft > 0; secondsLeft -= AGENT_CURSOR_STEP_SECONDS) {
      let stepSeconds = Math.min(AGENT_CURSOR_STEP_SECONDS, secondsLeft);
      velocity = {
        x: velocity.x + (AGENT_CURSOR_SPRING.stiffness * (targetX - shown.x) - AGENT_CURSOR_SPRING.damping * velocity.x) * stepSeconds,
        y: velocity.y + (AGENT_CURSOR_SPRING.stiffness * (targetY - shown.y) - AGENT_CURSOR_SPRING.damping * velocity.y) * stepSeconds,
      };
      shown = {
        x: shown.x + velocity.x * stepSeconds,
        y: shown.y + velocity.y * stepSeconds,
      };
    }
    let isMoving =
      !isReducedMotion &&
      (timeSeconds < cursorMotionEndTime(strokes) ||
        Math.abs(targetX - shown.x) + Math.abs(targetY - shown.y) > 0.05 ||
        Math.abs(velocity.x) + Math.abs(velocity.y) > 1);
    if (!isMoving) {
      shown = {
        x: targetX,
        y: targetY,
      };
      velocity = {
        x: 0,
        y: 0,
      };
    }
    shownAt = shown;
    placeElementAt(cursorElement, targetX, targetY);
    placeElementAt(bubbleElement, shown.x, shown.y);
    return isMoving;
  };
  let startFrames = () => {
    lastFrameMs = null;
    frameRequest = frames.requestAnimationFrame(onFrame);
  };
  let onFrame = (nowMs: number) => {
    if (step(nowMs)) {
      frameRequest = frames.requestAnimationFrame(onFrame);
      return;
    }
    frameRequest = null;
    idleTimer = view.setTimeout(
      () => {
        from = cursorPositionAt(from, strokes, timeSeconds);
        ({ strokes } = createCursorIdleMotion(random, from, roamRadii(), timeSeconds));
        startFrames();
      },
      (AGENT_CURSOR_IDLE_MIN_SECONDS + AGENT_CURSOR_IDLE_SPREAD_SECONDS * random()) * 1000,
    );
  };
  let resizeObserver = new view.ResizeObserver(() => {
    ({ clientWidth: areaWidth, clientHeight: areaHeight } = area);
    ({ offsetWidth: bubbleWidth } = widthBubbleElement);
    if (frameRequest !== null) return;
    shownAt = null;
    step(lastFrameMs ?? view.performance.now());
  });
  resizeObserver.observe(area);
  resizeObserver.observe(widthBubbleElement);
  step(view.performance.now());
  if (!isReducedMotion) startFrames();
  return () => {
    if (frameRequest !== null) frames.cancelAnimationFrame(frameRequest);
    view.clearTimeout(idleTimer);
    resizeObserver.disconnect();
  };
}
export function useWorkingLineIndex(lineCount: number): number {
  let [lineIndex, setLineIndex] = React.useState(0);
  React.useEffect(() => {
    let startMs = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tick = () => {
      let line = workingLineAt(performance.now() - startMs, lineCount);
      setLineIndex(line.line);
      timer = setTimeout(tick, Math.max(50, line.forMs));
    };
    tick();
    return () => clearTimeout(timer);
  }, [lineCount]);
  return lineIndex;
}
export function AgentAtWork({ style }: AgentAtWorkProps) {
  let areaRef = React.useRef<HTMLDivElement | null>(null);
  let cursorRef = React.useRef<SVGSVGElement | null>(null);
  let bubbleRef = React.useRef<HTMLSpanElement | null>(null);
  let widthBubbleRef = React.useRef<HTMLSpanElement | null>(null);
  let lines = agentBubbleTips(useCoarsePointer());
  let lineIndex = useWorkingLineIndex(lines.length);
  React.useLayoutEffect(() => {
    let [area, cursor, bubble] = [areaRef.current, cursorRef.current, bubbleRef.current];
    let widthBubble = widthBubbleRef.current;
    let view = area?.ownerDocument.defaultView ?? null;
    let frames = frameSchedulerOf(area);
    if (area === null || cursor === null || bubble === null || widthBubble === null) return;
    if (view === null || frames === null) return;
    let reducedMotionQuery = view.matchMedia('(prefers-reduced-motion:reduce)');
    let stopMotion = runAgentCursorMotion(view, frames, area, cursor, bubble, widthBubble, reducedMotionQuery.matches);
    let restartMotion = () => {
      stopMotion();
      stopMotion = runAgentCursorMotion(view, frames, area, cursor, bubble, widthBubble, reducedMotionQuery.matches);
    };
    reducedMotionQuery.addEventListener('change', restartMotion);
    return () => {
      reducedMotionQuery.removeEventListener('change', restartMotion);
      stopMotion();
    };
  }, []);
  return <div aria-hidden className="sheet-agent-at-work" style={style}><div ref={areaRef}><span ref={widthBubbleRef} className="sheet-bubble-of-agent" data-is-for-width>{lines.map(
            (line) =>
              <span key={line}>{line}</span>,
          )}</span><span ref={bubbleRef} className="sheet-bubble-of-agent"><AgentWordsCrossfade words={lines[lineIndex] ?? agentIsWorkingText()} /></span><svg ref={cursorRef} width="16" height="16" viewBox="0 0 16 16"><path d="M1.64838 2.00811C1.39707 1.20393 2.19198 0.468453 2.97425 0.781363L13.5673 5.01857C14.4224 5.36064 14.3996 6.57901 13.5322 6.88879L9.87018 8.19667C9.33014 8.38954 8.89887 8.80494 8.6859 9.33737L7.06512 13.3893C6.71565 14.263 5.46282 14.2143 5.18216 13.3162L1.64838 2.00811Z" fill="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg></div></div>;
}
export const clampCursorProgress = (progress: number): number => (progress < 0 ? 0 : progress > 1 ? 1 : progress);
export const cursorMotionEase = (progress: number): number => {
  let curved = Math.pow(clampCursorProgress(progress), 0.86);
  return curved * curved * curved * (10 + curved * (6 * curved - 15));
};
export const cursorBendEnvelope = (progress: number): number => {
  let hump = clampCursorProgress(progress) * (1 - clampCursorProgress(progress));
  return 16 * hump * hump;
};
export const cursorMotionEndTime = (strokes: readonly CursorStroke[]): number =>
  strokes.reduce((endTime, stroke) => Math.max(endTime, stroke.t0 + stroke.T), 0);
export const AGENT_CURSOR_MARGIN = 8;
export const AGENT_CURSOR_BUBBLE_GAP = 12;
export const AGENT_CURSOR_SPRING = {
  stiffness: 1600,
  damping: 76,
};
export const AGENT_CURSOR_STEP_SECONDS = 0.008;
export const AGENT_CURSOR_IDLE_MIN_SECONDS = 12;
export const AGENT_CURSOR_IDLE_SPREAD_SECONDS = 14;
export const AGENT_CURSOR_START_TIME = 0.18;
export const placeElementAt = (element: ElementCSSInlineStyle, x: number, y: number): void => {
  element.style.transform = `translate(${x.toFixed(2)}px,${y.toFixed(2)}px)`;
};
export const AgentWordsCrossfade = React.memo(function ({ words }: AgentWordsCrossfadeProps) {
  let [pair, setPair] = React.useState({
    first: words,
    second: '',
    isFirstShown: true,
  });
  let [measured, setMeasured] = React.useState<WordsMeasured | null>(null);
  let measureRef = React.useRef<HTMLSpanElement | null>(null);
  if ((pair.isFirstShown ? pair.first : pair.second) !== words)
    setPair(
      pair.isFirstShown
        ? {
            ...pair,
            second: words,
            isFirstShown: false,
          }
        : {
            ...pair,
            first: words,
            isFirstShown: true,
          },
    );
  let measureWidth = React.useCallback(() => {
    let width = (measureRef.current?.offsetWidth ?? 0) + 1;
    if (width === 1) return;
    setMeasured(
      (previous) =>
        previous?.width === width
          ? previous
          : {
              width,
              isNarrower: previous !== null && width < previous.width,
            },
    );
  }, []);
  React.useLayoutEffect(measureWidth);
  React.useEffect(() => {
    let element = measureRef.current;
    let view = element?.ownerDocument.defaultView ?? null;
    if (element === null || view === null) return;
    let resizeObserver = new view.ResizeObserver(measureWidth);
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, [measureWidth]);
  return <span className="sheet-words-of-agent" data-is-narrower={measured?.isNarrower === true} style={{
      width: measured?.width,
    }}><span ref={measureRef}>{words}</span><span data-is-shown={pair.isFirstShown}>{pair.first}</span><span data-is-shown={!pair.isFirstShown}>{pair.second}</span></span>;
});
