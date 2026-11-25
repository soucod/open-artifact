import { AgentMark } from '../../kit/agent-mark.tsx';
import { ShimmerText } from '../../kit/shimmer-text.tsx';
import { useUiWindow } from '../../kit/theme.tsx';
import { Tooltip } from '../../kit/tooltip.tsx';
import * as React from 'react';
import { isOfferLitOnItsOwn, formulaReadForOffer, isReadingHighlighted, isOfferEmptyWithoutAgent } from './offer.ts';
import {
  reportTimeAfterNextPaint,
  isWithinClickAfterUp,
  getLastPointerPoint,
  isPointerStillAt,
  listAnswerSettlesAtMs,
  LIST_ANSWER_SETTLE_MS,
  useLastNonNull,
  ListRow,
  ListRowQuietText,
  ListUnderCell,
  ListSeparator,
  ListHeading,
} from '../../ui/list-under-cell.tsx';
import { useSpentInputGuard } from '../../ui/ask-list/spent-input-guard.ts';
import {
  writeThisFormulaLabel,
  keepTypingLabel,
  writingFormulaWords,
  keepFormulaLabel,
  formulaResultPreview,
  discardFormulaLabel,
  escapeKeyHint,
  writingFormulaForWords,
  formulaReadingHint,
  twoFormulaReadingsHint,
  formulaNotWrittenWords,
  notAFormulaHint,
  agentWritingFormulaWords,
  agentWroteFormulaWords,
  agentWroteOneFormulaWords,
  formulaNotWrittenReason,
  formulaOfferGoneWords,
  stopWritingFormulaLabel,
  formulaOptionsLabel,
} from '../../messages/formula-writing.ts';
import { tabKeyLabel } from '../../i18n/menu-labels.ts';
import { FUNCTION_POINT_DELAY_MS, functionRowAnchor, useCaretAnchor } from '../function-list.tsx';
import { proposedFixesOf } from './actions.ts';
import { useCoveredUnderCells, popupCollisionPadding } from '../../shell/bottom-insets.ts';
import { cellEntryBoxStyle, entryGridlineOverlap } from '../../grid/grid-drawing.tsx';
import { paintDataAttributes, entryFontStyle, fillPaintStyle, textPaintStyle } from '../../grid/cell-drawing.tsx';
import { LiveAnnouncer } from '../../ui/live-announcer.tsx';
import { StopKeyHint } from '../../agent/agent-rows.tsx';
import { isPressTaken } from '../../ui/ask-agent-to-fix-button.tsx';
import { describeFunction } from '../function-help.ts';
import { entryEditorOf } from '../../dom/entry-editor.ts';
import type { AgentMarkState } from '../../kit/agent-mark.tsx';
import type { FormulaFromWords, FormulaFromWordsStage, FormulaOffered, FormulaCameToNothing } from '../../state/initial-state.ts';
import type { PageEvent } from '../../state/event-reducer.ts';
import type { EntryBoxes } from '../../editor/entry-boxes.ts';
import type { EditingMode } from '../../state/transitions.ts';
import type { AnchorOnPage } from '../../chips/people-list-view.tsx';
import type { GridView } from '../../grid/grid-view.ts';
import type { StyleWithVariables } from '../../grid/cell-drawing.tsx';
import type { FormulaAndValue } from '../../messages/formula-writing.ts';
/** The stages whose wand moves: while offered, and while the agent writes. */
export type OfferWandKind = 'offered' | 'asked';
/** How long a press in the list is guarded: while the agent writes, once its answer is in, or otherwise. */
export type PressGuardStand = 'whileAgentWrites' | 'withAnswer' | 'otherwise';
/** Takes an event of the formula offer to the page. */
export type DispatchOfOffer = (event: PageEvent) => void;
/** A row of the formula offer, or of the fixes offered for errors. */
export interface OfferListRow {
  words: string;
  onChosen: (() => void) | null;
  isShimmering?: boolean;
  isStopAtEnd?: boolean;
  isKeyOfStopUnheard?: boolean;
  hint?: string;
  detail?: string;
  isFormula?: true;
  isDetailHidden?: boolean;
  saidToo?: string;
}
/** Where the pointer last was, and whether it had not moved since the move before. */
export interface PointerPoint {
  x: number;
  y: number;
  isWhereItWas: boolean;
}
/** A piece of a formula, and where in the formula it starts. */
export interface FormulaChunk {
  text: string;
  start: number;
}
/** A formula read from the words, as its row shows it. */
export interface ReadingRow {
  row: 'read' | 'readOtherwise';
  formula: string;
  comesTo: string;
}
/** The fix row the pointer rests on, in the stage it was pointed at in. */
export interface FixRowPointed {
  atRow: number;
  in: FormulaFromWordsStage | null;
}
/** When a proposed formula began to show, and whether it is drawn in yet. */
interface FormulaArrival {
  sinceMs: number;
  isDrawnIn: boolean;
  lastActAtMs: number;
  timer?: ReturnType<typeof setTimeout>;
}
/** What was last read out of the formula offer. */
interface OfferSaid {
  words: string | null;
  ofKind: FormulaFromWordsStage['kind'] | null;
  ofRead: string | null;
  wasAgentOffered: boolean;
}
/** The handlers that keep a press meant for a row that moved from choosing the row now under it. */
export interface OfferPressGuard {
  onPointerDownCapture: (event: React.PointerEvent) => void;
  onPointerMoveCapture: (event: React.PointerEvent) => void;
  onPointerCancelCapture: (event: React.PointerEvent) => void;
  onTransitionEndCapture: () => void;
  onClickCapture: (event: React.MouseEvent) => void;
}
/** What decides whether a click in the list is held rather than taken. */
export interface ClickToHold {
  isMeantForStop: boolean;
  isAgentWriting: boolean;
  isOfRunThatAsked: boolean;
  rowsShownAtMs: number;
  wentDownAtMs: number | null;
  atMs: number;
}
export function highlightedOfferRowId(offer: FormulaFromWordsStage | null): string | null {
  if (isOfferLitOnItsOwn(offer)) return null;
  if (offer?.kind === 'offered' && offer.isDrawn) return FORMULA_OFFER_ROW_IDS[offer.highlighted];
  if (offer?.kind !== 'proposed') return null;
  if (offer.isDiscardHighlighted) return FORMULA_KEEP_TYPING_ROW_ID;
  if (offer.isArriving) return null;
  return fixRowId(
    Math.max(
      0,
      (offer.fixes ?? []).findIndex(({ formula }) => formula === offer.formula),
    ),
  );
}
interface OfferWandProps {
  kind: OfferWandKind;
}
export function OfferWand({ kind }: OfferWandProps) {
  let [wand, setWand] = React.useState({
    of: kind,
    isOver: false,
  });
  if (wand.of !== kind)
    setWand({
      of: kind,
      isOver: false,
    });
  let [startState, endState] = OFFER_WAND_STATES[kind];
  return <span aria-hidden className="flex shrink-0 items-center text-agent"><AgentMark size={14} state={wand.of === kind && wand.isOver ? endState : startState} onEnd={() =>
        setWand({
          of: kind,
          isOver: true,
        })} /></span>;
}
interface WordsInTurnProps {
  words: string;
  isShimmering: boolean;
  takeAPlace: boolean;
  doWordsWrap?: boolean;
}
export function WordsInTurn({ words, isShimmering, takeAPlace, doWordsWrap = false }: WordsInTurnProps) {
  let [turn, setTurn] = React.useState<{ now: string; before: string | null }>({
    now: words,
    before: null,
  });
  if (turn.now !== words)
    setTurn({
      now: words,
      before: takeAPlace ? turn.now : null,
    });
  let wordsBefore = turn.now === words ? turn.before : null;
  let wordsRef = React.useRef<HTMLSpanElement>(null);
  let leftBeforeRef = React.useRef<number | null>(null);
  React.useLayoutEffect(() => {
    leftBeforeRef.current = wordsRef.current?.offsetLeft ?? null;
  });
  return <span ref={wordsRef} className={doWordsWrap ? 'relative wrap-anywhere whitespace-normal' : 'relative shrink-0 grow whitespace-nowrap'}>{wordsBefore !== null &&
        (<span key={wordsBefore} ref={(element) => {
              if (prefersReducedMotionAt(element))
                setTurn({
                  now: words,
                  before: null,
                });
              let shift = (leftBeforeRef.current ?? 0) - (wordsRef.current?.offsetLeft ?? leftBeforeRef.current ?? 0);
              if (element !== null && shift !== 0) element.style.translate = `${String(shift)}px`;
            }} aria-hidden className="sheet-words-that-go" onAnimationEnd={() =>
              setTurn({
                now: words,
                before: null,
              })}>{wordsBefore}</span>)}<span key={words} className={wordsBefore === null ? undefined : 'sheet-words-in-turn'}>{isShimmering
            ? <ShimmerText>{words}</ShimmerText>
            : words}</span></span>;
}
export function formulaArgumentChunks(formula: string): FormulaChunk[] {
  let chunks: FormulaChunk[] = [];
  let chunkStart = 0;
  let isInQuotes = false;
  for (let at = 0; at < formula.length; at += 1) {
    let char = formula[at];
    if (char === '"') isInQuotes = !isInQuotes;
    else if (!isInQuotes && (char === '(' || char === ',' || char === ';')) {
      chunks.push({
        text: formula.slice(chunkStart, at + 1),
        start: chunkStart,
      });
      chunkStart = at + 1;
    }
  }
  if (chunkStart < formula.length)
    chunks.push({
      text: formula.slice(chunkStart),
      start: chunkStart,
    });
  return chunks;
}
export function formulaTermChunks(formula: string): FormulaChunk[] {
  let chunks: FormulaChunk[] = [];
  let chunkStart = 0;
  let depth = 0;
  let isInQuotes = false;
  for (let at = 0; at < formula.length; at += 1) {
    let char = formula[at];
    if (char === '"') isInQuotes = !isInQuotes;
    else if (isInQuotes) continue;
    else if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (char === '+' && depth === 0 && at > chunkStart) {
      chunks.push({
        text: formula.slice(chunkStart, at),
        start: chunkStart,
      });
      chunkStart = at;
    }
  }
  chunks.push({
    text: formula.slice(chunkStart),
    start: chunkStart,
  });
  return chunks;
}
interface FormulaAndResultProps {
  formula: string;
  result: string | null;
  isResultHidden?: boolean;
}
export function FormulaAndResult({ formula, result, isResultHidden = false }: FormulaAndResultProps) {
  return <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2"><span className="min-w-0">{formulaTermChunks(formula).map(
          (term) =>
            (<span key={term.start} className="inline-block max-w-full">{formulaArgumentChunks(term.text).map(
                  ({ text: chunkText, start }) =>
                    <span key={start} className="inline-block max-w-full [overflow-wrap:anywhere] whitespace-pre-wrap">{chunkText}</span>,
                )}</span>),
        )}</span><span className={isResultHidden
          ? 'sheet-quiet-text-in-row invisible ms-auto min-w-0 truncate text-secondary tabular-nums'
          : 'sheet-quiet-text-in-row ms-auto min-w-0 truncate text-secondary tabular-nums'}>{result}</span></span>;
}
export function useOfferPressGuard(stands: PressGuardStand | null, boxRef: React.RefObject<HTMLElement | null>, onHeld: () => void): OfferPressGuard {
  let ownWindow = useUiWindow();
  let nowMs = () => (ownWindow ?? globalThis).performance.now();
  let shownRef = React.useRef<{ stand: PressGuardStand | null; atMs: number }>({
    stand: null,
    atMs: Number.NEGATIVE_INFINITY,
  });
  React.useLayoutEffect(() => {
    if (shownRef.current.stand === stands) return;
    return reportTimeAfterNextPaint(ownWindow, (atMs: number) => {
      shownRef.current = {
        stand: stands,
        atMs,
      };
    });
  }, [stands, ownWindow]);
  let fieldRef = React.useRef<HTMLElement>(null);
  let { onButtonsMoved, ...guard } = useSpentInputGuard({
    box: boxRef,
    field: fieldRef,
    stands: stands ?? 'otherwise',
  });
  let isAgentWriting = stands === 'whileAgentWrites';
  React.useEffect(() => {
    let boxWindow = boxRef.current?.ownerDocument.defaultView ?? null;
    if (!isAgentWriting || boxWindow === null) return;
    return afterTwoFrames(boxWindow, onButtonsMoved);
  });
  let isGuarding = stands !== null;
  let { forget } = guard;
  React.useLayoutEffect(() => {
    if (!isGuarding) forget();
  }, [isGuarding, forget]);
  let isPressSpent = (event: Pick<MouseEvent, 'clientX' | 'clientY'>, isByMouse: boolean): boolean =>
    guard.isPressSpent({
      clientX: event.clientX,
      clientY: event.clientY,
      isByMouse,
      wentDownAtMs: nowMs(),
      shownAtMs: shownRef.current.atMs,
    });
  let pressRef = React.useRef<{ wentDownAtMs: number; isMeantForStop: boolean } | null>(null);
  let isRunFromAskRef = React.useRef(false);
  React.useLayoutEffect(() => {
    if (isAgentWriting) isRunFromAskRef.current = true;
  }, [isAgentWriting]);
  return {
    onPointerDownCapture: (event: React.PointerEvent) => {
      if (!event.isPrimary || event.button !== 0) return;
      pressRef.current = {
        wentDownAtMs: nowMs(),
        isMeantForStop: isPressSpent(event, event.pointerType === 'mouse'),
      };
    },
    onPointerMoveCapture: (event: React.PointerEvent) => {
      onButtonsMoved();
      guard.onPointerMoved(event);
    },
    onPointerCancelCapture: () => {
      pressRef.current = null;
      forget();
    },
    onTransitionEndCapture: onButtonsMoved,
    onClickCapture: (event: React.MouseEvent) => {
      let atMs = nowMs();
      let press = pressRef.current !== null && isWithinClickAfterUp(pressRef.current.wentDownAtMs, atMs) ? pressRef.current : null;
      pressRef.current = null;
      if (event.detail <= 1) isRunFromAskRef.current = !isAgentWriting;
      if (
        !isClickToHold({
          isMeantForStop: press?.isMeantForStop ?? isPressSpent(event, false),
          isAgentWriting,
          isOfRunThatAsked: event.detail > 1 && isRunFromAskRef.current,
          rowsShownAtMs: shownRef.current.atMs,
          wentDownAtMs: press?.wentDownAtMs ?? null,
          atMs,
        })
      )
        return;
      event.stopPropagation();
      onHeld();
    },
  };
}
export function fixRowsClickWatch() {
  let pointWhenRowsCame: PointerPoint | null = null;
  let isNextClickDropped = false;
  return {
    rowsCame: (haveCome: boolean) => {
      pointWhenRowsCame = haveCome ? getLastPointerPoint() : null;
    },
    pointerMoved: () => {
      if (!isPointerStillAt(pointWhenRowsCame)) pointWhenRowsCame = null;
    },
    pressWentDown: ({ pointerType, buttons }: Pick<PointerEvent, 'pointerType' | 'buttons'>, isOnFirstRow: boolean) => {
      isNextClickDropped = !isOnFirstRow && pointerType === 'mouse' && buttons !== 0 && isPointerStillAt(pointWhenRowsCame);
    },
    isClickDropped: () => {
      let isDropped = isNextClickDropped;
      isNextClickDropped = false;
      return isDropped;
    },
  };
}
export function offerRowsOf(stage: Exclude<FormulaFromWordsStage, FormulaCameToNothing>, dispatch: DispatchOfOffer): OfferListRow[] {
  switch (stage.kind) {
    case 'offered':
      return [
        {
          words: writeThisFormulaLabel(),
          onChosen: () =>
            dispatch({
              kind: 'formulaOfferRowChosen',
              row: 'write',
            }),
        },
        {
          words: keepTypingLabel(),
          ...(stage.isDrawn &&
            stage.hasRested === true && {
              hint: tabKeyLabel(),
            }),
          onChosen: () =>
            dispatch({
              kind: 'formulaOfferRowChosen',
              row: 'keepTyping',
            }),
        },
      ];
    case 'asked':
      return [
        {
          words: writingFormulaWords(),
          isShimmering: true,
          isStopAtEnd: true,
          onChosen: () =>
            dispatch({
              kind: 'formulaAskStopped',
            }),
        },
        {
          words: keepTypingLabel(),
          onChosen: null,
        },
      ];
    case 'proposed':
      return [
        fixRowsOf(stage, dispatch)[0] ??
          (stage.isArriving
            ? {
                words: keepFormulaLabel(),
                onChosen: null,
              }
            : {
                words: keepFormulaLabel(),
                detail: formulaResultPreview(stage.value.shown) ?? undefined,
                onChosen: () =>
                  dispatch({
                    kind: 'formulaOfAgentKept',
                  }),
              }),
        {
          words: discardFormulaLabel(),
          hint: escapeKeyHint(),
          onChosen: () =>
            dispatch({
              kind: 'wordsOfFormulaAskedBack',
            }),
        },
      ];
  }
}
export function afterTwoFrames(ownWindow: Window, callback: () => void): () => void {
  let cancel = () => {
    ownWindow.cancelAnimationFrame(frame);
    ownWindow.clearTimeout(timer);
  };
  let callOnce = () => {
    cancel();
    callback();
  };
  let frame = ownWindow.requestAnimationFrame(() => {
    frame = ownWindow.requestAnimationFrame(callOnce);
  });
  let timer = ownWindow.setTimeout(callOnce, TWO_FRAMES_FALLBACK_MS);
  return cancel;
}
interface FixDescriptionTipProps {
  stage: FormulaFromWordsStage | null;
  pointed: FixRowPointed | null;
  isRoomBeside: boolean;
  inPage: React.RefObject<HTMLElement | null>;
}
export function FixDescriptionTip({ stage, pointed, isRoomBeside, inPage }: FixDescriptionTipProps) {
  let pointedRow = pointed !== null && pointed.in === stage ? pointed.atRow : null;
  let [settledRow, setSettledRow] = React.useState<number | null>(null);
  React.useEffect(() => {
    let timer = setTimeout(() => setSettledRow(pointedRow), pointedRow === null ? 0 : FUNCTION_POINT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [pointedRow]);
  let fixes = proposedFixesOf({
    stage,
  });
  let highlightedIndex = fixes.findIndex((fix, index) => fixRowId(index) === highlightedOfferRowId(stage));
  let shownIndex = pointedRow !== null && settledRow === pointedRow ? pointedRow : highlightedIndex;
  let description = setApartDescription(fixes[shownIndex]?.setApartBy);
  let coveredUnderCells = useCoveredUnderCells();
  let anchor = React.useMemo(
    () => (description === null ? null : functionRowAnchor(fixRowId(shownIndex), inPage)),
    [description, shownIndex, inPage],
  );
  if (anchor === null || description === null) return null;
  return <Tooltip anchor={anchor} open={isRoomBeside} side="right" align="start" sideOffset={8} collisionPadding={popupCollisionPadding(coveredUnderCells)} collisionAvoidance={{
      fallbackAxisSide: 'none',
    }} className="max-w-[194px]" content={<span aria-hidden>{description}</span>} />;
}
interface WaitForFormulaProps {
  stage: FormulaFromWordsStage | null;
}
export function WaitForFormula({ stage }: WaitForFormulaProps) {
  if (stage?.kind !== 'asked') return null;
  return <span aria-hidden className="sheet-wait-for-formula"><ShimmerText>{stage.isFix === true ? writingFormulaWords() : writingFormulaForWords(stage.words.slice(1).trim())}</ShimmerText></span>;
}
export function msUntilFormulaArrives({ sinceMs, isDrawnIn, lastActAtMs }: Omit<FormulaArrival, 'timer'>, nowMs: number): number | null {
  let arrivesAtMs: number = isDrawnIn
    ? listAnswerSettlesAtMs({
        answerShownAtMs: sinceMs,
        lastActAtMs,
      })
    : sinceMs + LIST_ANSWER_SETTLE_MS;
  return arrivesAtMs === Number.POSITIVE_INFINITY ? null : arrivesAtMs - nowMs;
}
interface FormulaArrivingProps {
  grid: Pick<GridView, 'body' | 'editorKeepsClear' | 'editorBox' | 'editorLineCount' | 'editorFoldsAt' | 'editorScale' | 'editorFormat' | 'editorPaints'>;
  stage: FormulaFromWordsStage | null;
  actsHeld: number;
  text: string;
  isInFontOfFormulas: boolean;
  dispatch: DispatchOfOffer;
}
export function FormulaArriving({
  grid: {
    body,
    editorKeepsClear,
    editorBox,
    editorLineCount,
    editorFoldsAt,
    editorScale,
    editorFormat,
    editorPaints,
  },
  stage,
  actsHeld,
  text,
  isInFontOfFormulas,
  dispatch,
}: FormulaArrivingProps) {
  let isArriving = stage?.kind === 'proposed' && stage.isArriving;
  let hasEditorBox = editorBox !== null;
  let wordsRef = React.useRef<HTMLSpanElement>(null);
  let arrivalRef = React.useRef<FormulaArrival>({
    sinceMs: 0,
    isDrawnIn: false,
    lastActAtMs: Number.NEGATIVE_INFINITY,
  });
  let ownWindow = useUiWindow();
  let clock = ownWindow?.performance ?? performance;
  let scheduleArrival = React.useCallback(() => {
    clearTimeout(arrivalRef.current.timer);
    let msLeft = msUntilFormulaArrives(arrivalRef.current, clock.now());
    if (msLeft !== null)
      arrivalRef.current.timer = setTimeout(
        () =>
          dispatch({
            kind: 'formulaOfAgentArrived',
          }),
        msLeft,
      );
  }, [dispatch, clock]);
  React.useLayoutEffect(() => {
    if (!isArriving) return;
    let arrival = arrivalRef.current;
    arrival.isDrawnIn = !hasEditorBox || prefersReducedMotionAt(wordsRef.current);
    let stopWatching = reportTimeAfterNextPaint(ownWindow, (sinceMs: number) => {
      arrival.sinceMs = sinceMs;
      scheduleArrival();
    });
    return () => {
      stopWatching();
      clearTimeout(arrival.timer);
    };
  }, [isArriving, hasEditorBox, ownWindow, scheduleArrival]);
  let actsHeldRef = React.useRef(actsHeld);
  React.useEffect(() => {
    if (actsHeldRef.current === actsHeld) return;
    actsHeldRef.current = actsHeld;
    arrivalRef.current.lastActAtMs = clock.now();
    if (isArriving) scheduleArrival();
  }, [actsHeld, isArriving, clock, scheduleArrival]);
  if (editorBox === null || (stage?.kind !== 'asked' && !isArriving)) return null;
  let tokens = formulaTokens(text);
  let { lineHeightInPixels, ...boxStyle } = cellEntryBoxStyle(editorBox, body, editorFormat, editorKeepsClear, {
    lineCount: editorLineCount,
    foldsAt: editorFoldsAt,
    scale: editorScale,
  });
  return <span ref={wordsRef} aria-hidden className="sheet-words-for-agent" data-is-arriving={isArriving || undefined} data-starts-on-line-at-left={entryGridlineOverlap(editorBox, editorScale).x > 0 || undefined} {...paintDataAttributes(editorPaints)} style={{
      ...boxStyle,
      ...entryFontStyle(editorFormat.font, isInFontOfFormulas),
      ...(lineHeightInPixels !== undefined && {
        lineHeight: `${lineHeightInPixels}px`,
      }),
      ...fillPaintStyle(editorPaints.fill),
      ...textPaintStyle(editorPaints.text),
    }}>{isArriving
      ? tokens.map(
          ({ text: pieceText, start }, index) =>
            (<span key={start} className="sheet-piece-of-formula" style={formulaArrivalStyle(start / text.length)} onAnimationEnd={index === tokens.length - 1
                    ? () => {
                        arrivalRef.current.isDrawnIn = true;
                        scheduleArrival();
                      }
                    : undefined}>{pieceText}</span>),
        )
      : editorPaints.fill === null && editorPaints.text === null
        ? <ShimmerText variant="secondary">{text}</ShimmerText>
        : <span data-shimmers>{text}</span>}</span>;
}
export function readFormulaAndValue(stage: FormulaFromWordsStage | null): FormulaAndValue {
  const formula = formulaReadForOffer(stage) ?? '';
  const isReadOfFormula = stage?.kind === 'offered' && stage.read?.formula === formula;
  return [formula, isReadOfFormula ? stage.read!.value.shown : ''];
}
export function readingRowsOf(stage: FormulaFromWordsStage | null): ReadingRow[] {
  if (formulaReadForOffer(stage) === null || stage?.kind !== 'offered') return [];
  let [formula, comesTo] = readFormulaAndValue(stage);
  let { readOtherwise } = stage;
  return [
    {
      row: 'read',
      formula,
      comesTo,
    },
    ...(readOtherwise === undefined
      ? []
      : [
          {
            row: 'readOtherwise',
            formula: readOtherwise.formula,
            comesTo: readOtherwise.value.shown,
          } satisfies ReadingRow,
        ]),
  ];
}
export function offerAnnouncement(stage: FormulaFromWordsStage | null, wasOfferSaid: boolean): string | null {
  switch (stage?.kind) {
    case 'offered':
      if (stage.toWorkOut?.isLitIfAlone === true && stage.isLightMovedByPerson !== true) return null;
      if (isReadingHighlighted(stage.highlighted)) {
        let row = readingRowsOf(stage).find(({ row: readingRow }) => readingRow === stage.highlighted);
        return row === undefined ? null : formulaReadingHint(row.formula, row.comesTo);
      }
      if (stage.readOtherwise !== undefined && stage.isLightMovedByPerson !== true && !stage.hasCallFailed)
        return twoFormulaReadingsHint(
          readFormulaAndValue(stage),
          [stage.readOtherwise.formula, stage.readOtherwise.value.shown],
          stage.highlighted === 'write',
        );
      if (stage.isAgentLeftOut === true) return null;
      if (stage.highlighted === 'keepTyping' && !stage.hasCallFailed) return null;
      return stage.hasCallFailed ? formulaNotWrittenWords() : notAFormulaHint();
    case 'asked':
      return agentWritingFormulaWords();
    case 'proposed':
      if (stage.isArriving) return agentWritingFormulaWords();
      if (stage.fixes?.[0] !== undefined) return agentWroteFormulaWords(stage.fixes.length, stage.fixes[0].formula, stage.fixes[0].value.shown);
      return agentWroteOneFormulaWords(stage.formula, stage.value.shown);
    case 'cameToNothing':
      return formulaNotWrittenReason(stage.why);
    case undefined:
      return wasOfferSaid ? formulaOfferGoneWords() : null;
  }
}
export function announcedOfferKind(stage: FormulaFromWordsStage | null): FormulaFromWordsStage['kind'] | null {
  if (stage?.kind === 'offered' && !stage.isDrawn) return null;
  return stage?.kind === 'proposed' && stage.isArriving ? 'asked' : (stage?.kind ?? null);
}
export function isOfferSaidAtOnce(stage: FormulaFromWordsStage | null, isWavedOff: boolean): boolean {
  let kind = announcedOfferKind(stage);
  let isRestedOnNoReading =
    kind === 'offered' &&
    stage?.kind === 'offered' &&
    stage.hasRested === true &&
    !isReadingHighlighted(stage.highlighted) &&
    (stage.readOtherwise === undefined || stage.hasCallFailed);
  return (kind !== null && kind !== 'offered') || isRestedOnNoReading || isWavedOff;
}
interface FormulaOfferAnnouncerProps {
  formulaFromWords: Pick<FormulaFromWords, 'stage' | 'isWavedOff'>;
  isEntryOpen: boolean;
}
export function FormulaOfferAnnouncer({ formulaFromWords: { stage, isWavedOff }, isEntryOpen }: FormulaOfferAnnouncerProps) {
  let kind = announcedOfferKind(stage);
  let readKey =
    kind === 'offered' && stage?.kind === 'offered' && (isReadingHighlighted(stage.highlighted) || stage.readOtherwise !== undefined)
      ? [stage.highlighted, ...readingRowsOf(stage).flatMap(({ formula, comesTo }) => [formula, comesTo])].join(
          ' ',
        )
      : null;
  let isAgentOffered = kind === 'offered' && stage?.kind === 'offered' && stage.isAgentLeftOut !== true;
  let [said, setSaid] = React.useState<OfferSaid>({
    words: null,
    ofKind: null,
    ofRead: null,
    wasAgentOffered: false,
  });
  React.useEffect(() => {
    let sayNow = () =>
      setSaid(
        (saidBefore) =>
          saidBefore.ofKind === kind && saidBefore.ofRead === readKey && saidBefore.wasAgentOffered === isAgentOffered
            ? saidBefore
            : {
                words: isEntryOpen
                  ? offerAnnouncement(kind === null ? null : stage, saidBefore.ofKind === 'offered' && saidBefore.words !== null && !isWavedOff)
                  : null,
                ofKind: kind,
                ofRead: readKey,
                wasAgentOffered: isAgentOffered,
              },
      );
    if (isOfferSaidAtOnce(stage, isWavedOff)) return sayNow();
    let timer = setTimeout(sayNow, OFFER_ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [kind, readKey, isAgentOffered, stage, isWavedOff, isEntryOpen]);
  return <LiveAnnouncer words={said.words} />;
}
export function useIsComposing({ formulaBar }: Pick<EntryBoxes, 'formulaBar'>): boolean {
  let [isComposing, setIsComposing] = React.useState(false);
  React.useEffect(() => {
    let ownerDocument = formulaBar.current?.ownerDocument;
    let onStart = () => setIsComposing(true);
    let onEnd = () => setIsComposing(false);
    ownerDocument?.addEventListener('compositionstart', onStart, true);
    ownerDocument?.addEventListener('compositionend', onEnd, true);
    return () => {
      ownerDocument?.removeEventListener('compositionstart', onStart, true);
      ownerDocument?.removeEventListener('compositionend', onEnd, true);
    };
  }, [formulaBar]);
  return isComposing;
}
interface FormulaFromWordsHelpProps extends Omit<FormulaOfferListProps, 'formulaFromWords' | 'anchor' | 'onFixPointedAt' | 'onRoomBesideMeasured'> {
  formulaFromWords: Pick<FormulaFromWords, 'stage' | 'isWavedOff'>;
  typingIn: EditingMode['typingIn'] | null;
  isFormulaTyped: boolean;
  cellAnchor: AnchorOnPage;
}
export function FormulaFromWordsHelp({ typingIn, isFormulaTyped, cellAnchor, ...props }: FormulaFromWordsHelpProps) {
  let isInFormulaBar = useLastNonNull(typingIn) === 'formulaBar';
  let barAnchor = useCaretAnchor(props.boxes.formulaBar, 1);
  let { stage } = props.formulaFromWords;
  let [pointed, setPointed] = React.useState<FixRowPointed | null>(null);
  let onFixPointedAt = React.useCallback(
    (atRow: number | null) =>
      setPointed((pointedBefore) => {
        if (atRow === null) return null;
        return pointedBefore?.atRow === atRow && pointedBefore.in === stage
          ? pointedBefore
          : {
              atRow,
              in: stage,
            };
      }),
    [stage],
  );
  let [isRoomBeside, setIsRoomBeside] = React.useState(true);
  return <><FormulaOfferList {...props} anchor={isInFormulaBar ? barAnchor : cellAnchor} onFixPointedAt={onFixPointedAt} onRoomBesideMeasured={setIsRoomBeside} /><FixDescriptionTip stage={stage} pointed={pointed} isRoomBeside={isRoomBeside} inPage={props.boxes.formulaBar} /><FormulaOfferAnnouncer formulaFromWords={props.formulaFromWords} isEntryOpen={typingIn !== null} /></>;
}
export const FORMULA_FROM_WORDS_LIST_ID = 'formula-from-words';
export const FORMULA_READ_ROW_ID = `${FORMULA_FROM_WORDS_LIST_ID}-read`;
export const FORMULA_WRITE_ROW_ID = `${FORMULA_FROM_WORDS_LIST_ID}-first`;
export const FORMULA_KEEP_TYPING_ROW_ID = `${FORMULA_FROM_WORDS_LIST_ID}-second`;
export const fixRowId = (index: number): string =>
  index === 0 ? FORMULA_WRITE_ROW_ID : `${FORMULA_FROM_WORDS_LIST_ID}-fix-${String(index + 1)}`;
export const FORMULA_OFFER_ROW_IDS = {
  read: FORMULA_READ_ROW_ID,
  readOtherwise: `${FORMULA_FROM_WORDS_LIST_ID}-read-otherwise`,
  write: FORMULA_WRITE_ROW_ID,
  keepTyping: FORMULA_KEEP_TYPING_ROW_ID,
} satisfies Record<FormulaOffered['highlighted'], string>;
export const formulaOfferActiveDescendant = ({ stage }: Pick<FormulaFromWords, 'stage'>) =>
  stage === null || stage.kind === 'cameToNothing' || isOfferEmptyWithoutAgent(stage)
    ? null
    : {
        id: FORMULA_FROM_WORDS_LIST_ID,
        highlightedRowId: stage.kind === 'offered' && stage.hasRested !== true ? null : highlightedOfferRowId(stage),
      };
export const prefersReducedMotionAt = (element: Element | null): boolean =>
  element?.ownerDocument.defaultView?.matchMedia('(prefers-reduced-motion:reduce)').matches === true;
export const wandKindOf = (kind: FormulaFromWordsStage['kind'] | null): OfferWandKind | null => (kind === 'offered' || kind === 'asked' ? kind : null);
export const OFFER_WAND_STATES = {
  offered: ['entrance', 'idle'],
  asked: ['tickle', 'thinking'],
} satisfies Record<OfferWandKind, [AgentMarkState, AgentMarkState]>;
interface OfferRowProps {
  row: OfferListRow;
  id: string;
  placeInList: number;
  rowsInList?: number;
  isHighlighted: boolean;
  isEveryClickHeard: boolean;
  isListNew: boolean;
  onPointedAt?: () => void;
  onPointerLeave?: () => void;
  children?: React.ReactNode;
}
export const OfferRow = ({
  row,
  id,
  placeInList,
  rowsInList = 2,
  isHighlighted,
  isEveryClickHeard,
  isListNew,
  onPointedAt,
  onPointerLeave,
  children,
}: OfferRowProps) =>
  <ListRow id={id} placeInList={placeInList} rowsInList={rowsInList} isHighlighted={isHighlighted} onChosen={row.onChosen} isEveryClickHeard={isEveryClickHeard} {...(onPointedAt !== undefined && {
      onPointedAt,
      tellsOfEveryMove: true,
    })} isOnlyTintedByPointer {...(onPointerLeave !== undefined && {
      onPointerLeave,
    })}>{children}{row.isFormula === true
        ? <FormulaAndResult formula={row.words} result={row.detail ?? null} isResultHidden={row.isDetailHidden === true} />
        : <WordsInTurn words={row.words} isShimmering={row.isShimmering === true} takeAPlace={!isListNew} />}{row.isFormula !== true &&
        row.detail !== undefined &&
        <span className="sheet-words-in-turn sheet-quiet-text-in-row min-w-0 truncate text-secondary tabular-nums">{row.detail}</span>}{row.saidToo !== undefined &&
        <span className="sr-only">{row.saidToo}</span>}{row.hint !== undefined &&
        <ListRowQuietText isKey>{row.hint}</ListRowQuietText>}<StopKeyHint word={stopWritingFormulaLabel()} keyInWords={escapeKeyHint()} isKeyUnheard={row.isKeyOfStopUnheard === true} isShown={row.isStopAtEnd === true} /></ListRow>;
interface RowsThatFoldProps {
  isFolded: boolean;
  doesEase: boolean;
  children: React.ReactNode;
}
export const RowsThatFold = ({ isFolded, doesEase, children }: RowsThatFoldProps) =>
  <div className="sheet-rows-that-fold" data-folded={isFolded || undefined} data-eases={doesEase || undefined} aria-hidden={isFolded || undefined} inert={isFolded}><div>{children}</div></div>;
export const offerKeptWhileAsked = (stage: FormulaFromWordsStage | null, keptOffer: FormulaOffered | null): FormulaOffered | null => {
  if (stage?.kind === 'offered') return stage;
  return stage?.kind === 'asked' ? keptOffer : null;
};
export const isClickToHold = (click: ClickToHold): boolean =>
  click.isMeantForStop || (click.isAgentWriting && (click.isOfRunThatAsked || !isPressTaken(click.rowsShownAtMs, click.wentDownAtMs, click.atMs)));
export const pressGuardStandOf = (kind: FormulaFromWordsStage['kind'] | null): PressGuardStand | null => {
  if (kind === null || kind === 'cameToNothing') return null;
  if (kind === 'asked') return 'whileAgentWrites';
  return kind === 'proposed' ? 'withAnswer' : 'otherwise';
};
export const setApartDescription = (functionName: string | undefined): string | null =>
  functionName === undefined ? null : (describeFunction(functionName)?.description ?? null);
export const fixRowsOf = (stage: FormulaFromWordsStage | null, dispatch: DispatchOfOffer): OfferListRow[] =>
  proposedFixesOf({
    stage,
  }).map(({ formula, value, setApartBy }) => {
    let isArriving = stage?.kind === 'proposed' && stage.isArriving;
    return {
      words: formula,
      isFormula: true,
      detail: formulaResultPreview(value.shown) ?? undefined,
      isDetailHidden: isArriving,
      saidToo: setApartDescription(setApartBy) ?? undefined,
      onChosen: isArriving
        ? null
        : () =>
            dispatch({
              kind: 'formulaOfAgentKept',
              fix: formula,
            }),
    };
  });
export const TWO_FRAMES_FALLBACK_MS = 50;
export const OFFER_REST_DELAY_MS = 300;
interface FormulaOfferListProps {
  formulaFromWords: Pick<FormulaFromWords, 'stage'>;
  anchor: AnchorOnPage;
  cellElementId: string | null;
  boxes: EntryBoxes;
  dispatch: DispatchOfOffer;
  onFixPointedAt: (atRow: number | null) => void;
  onRoomBesideMeasured: (isRoomBeside: boolean) => void;
}
export const FormulaOfferList = React.memo(function ({
  formulaFromWords,
  anchor,
  cellElementId,
  boxes,
  dispatch,
  onFixPointedAt,
  onRoomBesideMeasured,
}: FormulaOfferListProps) {
  let stage = isOfferEmptyWithoutAgent(formulaFromWords.stage) ? null : formulaFromWords.stage;
  const shownStage: FormulaFromWordsStage | null = useLastNonNull(stage);
  let isWaitingToDraw = stage?.kind === 'offered' && !stage.isDrawn;
  React.useEffect(() => {
    let ownWindow = boxes.formulaBar.current?.ownerDocument.defaultView ?? null;
    if (!isWaitingToDraw || ownWindow === null) return;
    return afterTwoFrames(
      ownWindow,
      () =>
        dispatch({
          kind: 'formulaOfferDrawn',
          isDrawn: true,
        }),
    );
  }, [isWaitingToDraw, boxes, dispatch]);
  let isWaitingToRest = stage?.kind === 'offered' && stage.hasRested !== true;
  React.useEffect(() => {
    let ownWindow = boxes.formulaBar.current?.ownerDocument.defaultView ?? null;
    if (!isWaitingToRest || ownWindow === null) return;
    let timer = ownWindow.setTimeout(
      () =>
        dispatch({
          kind: 'formulaOfferDrawn',
          isDrawn: true,
          hasRested: true,
        }),
      OFFER_REST_DELAY_MS,
    );
    return () => ownWindow.clearTimeout(timer);
  }, [isWaitingToRest, boxes, dispatch]);
  let [opening, setOpening] = React.useState<{ wasOpen: boolean; kind: FormulaFromWordsStage['kind'] | null }>({
    wasOpen: false,
    kind: null,
  });
  let kind = stage?.kind ?? null;
  if (opening.wasOpen !== (stage !== null) || (opening.kind !== null && opening.kind !== kind))
    setOpening({
      wasOpen: stage !== null,
      kind: opening.wasOpen ? null : kind,
    });
  let isListNew = opening.kind !== null && opening.kind === kind;
  let offerRows = shownStage === null || shownStage.kind === 'cameToNothing' ? null : offerRowsOf(shownStage, dispatch);
  let isAsked = shownStage?.kind === 'asked';
  let [keptOffer, setKeptOffer] = React.useState<FormulaOffered | null>(null);
  let offerWhileAsked = offerKeptWhileAsked(stage, keptOffer);
  if (offerWhileAsked !== keptOffer) setKeptOffer(offerWhileAsked);
  let readingRows = readingRowsOf(isAsked ? offerWhileAsked : shownStage);
  let readingCount = isAsked ? 0 : readingRows.length;
  let isAgentLeftOut = shownStage?.kind === 'offered' && shownStage.isAgentLeftOut === true;
  let doesFoldEase = (isAsked ? offerWhileAsked : shownStage?.kind === 'offered' ? shownStage : null)?.hasCallFailed !== true;
  let rowsRef = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    let list = rowsRef.current?.closest('[data-list-under-cell]');
    let isOverCell = kind === 'asked' && list?.getAttribute('data-side') === 'top';
    list?.toggleAttribute('data-offer-was-over-cell', isOverCell);
  }, [kind]);
  let pressGuard = useOfferPressGuard(
    pressGuardStandOf(kind),
    rowsRef,
    () =>
      dispatch({
        kind: 'pressInListOfFormulaHeld',
      }),
  );
  let moreFixRows = fixRowsOf(shownStage, dispatch).slice(1);
  let rowCount = isAsked ? 1 : readingCount + moreFixRows.length + (isAgentLeftOut && readingCount > 0 ? 1 : 2);
  let highlightedRowId = highlightedOfferRowId(shownStage);
  let hasFixes =
    proposedFixesOf({
      stage,
    }).length > 0;
  let [clickWatch] = React.useState(fixRowsClickWatch);
  let fixCount = proposedFixesOf({
    stage,
  }).length;
  React.useLayoutEffect(() => clickWatch.rowsCame(fixCount > 0), [clickWatch, fixCount]);
  let ownWindow = useUiWindow();
  React.useEffect(() => {
    if (fixCount === 0) return;
    ownWindow?.addEventListener('pointermove', clickWatch.pointerMoved, true);
    return () => ownWindow?.removeEventListener('pointermove', clickWatch.pointerMoved, true);
  }, [clickWatch, fixCount, ownWindow]);
  let pointingAt = (atRow: number) =>
    hasFixes
      ? {
          onPointedAt: () => onFixPointedAt(atRow),
          onPointerLeave: () => onFixPointedAt(null),
        }
      : {};
  let wandKind = isAgentLeftOut ? null : wandKindOf(shownStage?.kind ?? null);
  let isProposed = kind === 'proposed';
  return <ListUnderCell id={FORMULA_FROM_WORDS_LIST_ID} isOpen={stage !== null} anchor={anchor} cellElementId={cellElementId} label={formulaOptionsLabel()} className="w-[304px]" rowsAre={kind === null || kind === 'asked' ? undefined : `${kind}${readingCount}${rowCount}`} doesQuietEnd={isProposed} areRowsComing={stage?.kind === 'proposed' && stage.isArriving} onClickDropped={() =>
      dispatch({
        kind: 'pressInListOfFormulaHeld',
      })} onPressLetGo={kind === 'asked'
        ? () =>
            dispatch({
              kind: 'pressInListOfFormulaHeld',
            })
        : undefined} canBeShut={stage?.kind === 'offered'} onRoomBesideMeasured={hasFixes ? onRoomBesideMeasured : undefined} onShut={(event: Event) => {
      let isInBox = entryEditorOf(event.target) === boxes.cell.current || event.target === boxes.formulaBar.current;
      if (event.type !== 'keydown' && !isInBox && stage?.kind === 'offered')
        dispatch({
          kind: 'formulaOfferShut',
        });
    }}>{offerRows !== null &&
        shownStage !== null &&
        (<div ref={rowsRef} className="contents" {...pressGuard} onPointerDownCapture={(event) => {
            pressGuard.onPointerDownCapture?.(event);
            let option = event.target instanceof Element ? event.target.closest('[role=option]') : null;
            clickWatch.pressWentDown(event, option?.id === FORMULA_WRITE_ROW_ID);
          }} onClickCapture={(event) => {
            let isDropped = clickWatch.isClickDropped();
            pressGuard.onClickCapture?.(event);
            if (event.isPropagationStopped() || !isDropped) return;
            event.stopPropagation();
            dispatch({
              kind: 'pressInListOfFormulaHeld',
            });
          }}>{readingRows.length > 0 &&
              (<RowsThatFold isFolded={isAsked} doesEase={doesFoldEase}>{readingRows.map(
                    ({ row, formula, comesTo }, index) =>
                      (<ListRow key={row} id={FORMULA_OFFER_ROW_IDS[row]} placeInList={index + 1} rowsInList={rowCount} isHighlighted={highlightedRowId === FORMULA_OFFER_ROW_IDS[row]} onChosen={() =>
                            dispatch({
                              kind: 'formulaOfferRowChosen',
                              row,
                            })}>{wandKind !== null &&
                              <span aria-hidden className="w-[14px] shrink-0" />}<FormulaAndResult formula={formula} result={formulaResultPreview(comesTo)} /></ListRow>),
                  )}<ListSeparator /></RowsThatFold>)}{!isAgentLeftOut &&
              (<OfferRow row={offerRows[0]} id={FORMULA_WRITE_ROW_ID} placeInList={readingCount + 1} rowsInList={rowCount} isHighlighted={highlightedRowId === FORMULA_WRITE_ROW_ID} isEveryClickHeard={isProposed || kind === 'asked'} isListNew={isListNew} {...pointingAt(0)}>{wandKind !== null &&
                  <OfferWand kind={wandKind} />}</OfferRow>)}<RowsThatFold isFolded={isAsked} doesEase={doesFoldEase}>{moreFixRows.map(
                  (fixRow, index) =>
                    <OfferRow key={fixRow.words} row={fixRow} id={fixRowId(index + 1)} placeInList={readingCount + index + 2} rowsInList={rowCount} isHighlighted={highlightedRowId === fixRowId(index + 1)} isEveryClickHeard isListNew {...pointingAt(index + 1)} />,
                )}{moreFixRows.length > 0 && <ListSeparator />}<OfferRow key={isAsked ? 'folded' : 'shown'} row={isAsked && offerWhileAsked !== null
                        ? {
                            ...offerRowsOf(offerWhileAsked, dispatch)[1],
                            onChosen: null,
                          }
                        : offerRows[1]} id={FORMULA_KEEP_TYPING_ROW_ID} placeInList={rowCount} rowsInList={rowCount} isHighlighted={highlightedRowId === FORMULA_KEEP_TYPING_ROW_ID} isEveryClickHeard={isProposed} isListNew={isListNew}>{wandKind !== null &&
                      <span aria-hidden className="w-[14px] shrink-0" />}</OfferRow></RowsThatFold></div>)}{shownStage?.kind === 'offered' &&
        shownStage.hasCallFailed &&
        <ListHeading>{formulaNotWrittenWords()}</ListHeading>}{shownStage?.kind === 'cameToNothing' &&
        <ListHeading>{formulaNotWrittenReason(shownStage.why)}</ListHeading>}</ListUnderCell>;
});
export const FORMULA_TOKEN_PATTERN =
  /"(?:[^"]|"")*"|\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?|[\p{L}_][\p{L}\p{N}_.]*|\d[\d.]*|\s+|./gsu;
export const formulaTokens = (formula: string): FormulaChunk[] =>
  [...formula.matchAll(FORMULA_TOKEN_PATTERN)].map(
    ({ 0: tokenText, index }) => ({
      text: tokenText,
      start: index,
    }),
  );
export const formulaArrivalStyle = (part: number): StyleWithVariables => ({
  '--sheet-part-of-arrival': String(part),
});
export const OFFER_ANNOUNCE_DELAY_MS = 500;
export const withoutOfferWhenComposing = (formulaFromWords: FormulaFromWords, isComposing: boolean): FormulaFromWords =>
  isComposing && formulaFromWords.stage?.kind === 'offered'
    ? {
        ...formulaFromWords,
        stage: null,
      }
    : formulaFromWords;
