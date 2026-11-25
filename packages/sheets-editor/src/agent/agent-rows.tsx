import { ShimmerText } from '../kit/shimmer-text.tsx';
import { AgentMark } from '../kit/agent-mark.tsx';
import { useUiWindow } from '../kit/theme.tsx';
import { Shortcut } from '../kit/shortcut.tsx';
import { Button } from '../kit/button.tsx';
import * as React from 'react';
import { CardRowTexts, CardSectionHeading, cardRowFrameProps, cardRowButtonProps } from '../ui/card-rows.tsx';
import { STANDS_FOR_BUTTON_PROPS } from '../ui/ask-list/spent-input-guard.ts';
import { useCoarsePointer } from '../app/media-queries.ts';
import { isPressTaken } from '../ui/ask-agent-to-fix-button.tsx';
import { isRepeatedEnterOrSpace } from '../ui/repeated-key-guards.ts';
import { reportTimeAfterNextPaint, isWithinClickAfterUp, isWithinPressGuard } from '../ui/list-under-cell.tsx';
import type { AskBoxRow } from '../format/conditional/ask-box.tsx';
/** A row known by its key. */
export interface KeyedRow {
  key: string;
}
interface SampleRowProps {
  row: Pick<AskBoxRow, 'sample' | 'title' | 'second'>;
}
export interface StopKeyHintProps {
  word: string;
  isSmall?: boolean;
  /** The key that stops, in words, for those who hear the page. */
  keyInWords?: string;
  /** Whether the key that stops is neither shown nor said. */
  isKeyUnheard?: boolean;
  isShown: boolean;
  /** Whether the hint goes at once when it is no longer shown, rather than fading. */
  goesAtOnce?: boolean;
}
/** Whether the stop hint was shown last time, and whether it is fading away. */
interface StopHintShown {
  wasShown: boolean;
  isGoing: boolean;
}
interface AgentRowContentProps {
  icon: React.ReactNode;
  isAmongSamples?: boolean;
  end?: React.ReactNode;
  children: React.ReactNode;
}
interface SuggestedHeadingProps {
  id: string;
  words: { suggested: string; suggestedSaid: string };
  isSaidInFull: boolean;
}
/** The words of a row while the agent writes: what it writes, and the word that stops it. */
export interface AgentWritingWords {
  writes: string;
  stop: string;
}
interface AgentWritingRowProps {
  words: AgentWritingWords;
  isAmongRowsOfList?: boolean;
  sizeOfWandInList?: number;
  onStopped: () => void;
  /** Whether, among the rows of a list, the stop is a row of its own. */
  isStopARow?: boolean;
}
interface KeepOrDiscardBarProps {
  words: { keep: string; discard: string };
  onKept: () => void;
  onDiscarded: () => void;
}
/** How the field to ask the agent in stands: at rest, with a draft of the agent's to keep, or while the agent writes. */
export type AskFieldStands = 'atRest' | 'withDraft' | 'whileAgentWrites';
/** The field to ask the agent in, as a key pressed in it finds it. */
export interface AskFieldNow {
  typed: string;
  stands: AskFieldStands;
  isRowHighlighted?: boolean;
}
/** A key pressed in the field to ask the agent in. */
export type KeyInAskField = Pick<React.KeyboardEvent, 'ctrlKey' | 'metaKey' | 'key' | 'repeat'>;
/** What a key does in the field to ask the agent in; null when the field leaves it to others. */
export type AskFieldKeyAction = 'isOfField' | 'nothing' | 'keep' | 'ask' | 'empty' | null;
/** A press that may click on rows as they come: when it began, and when it ended. */
interface PressOnRows {
  atMs: number;
  endedAtMs: number | null;
}
interface ClickGuardOnComingRows {
  rows: readonly KeyedRow[];
  /** Where the coming rows begin; rows from it on are guarded. */
  whereRowsCome: React.RefObject<Node | null>;
  easeInMs: number;
}
/** A click on rows as they ease in: when its press began, and how long the rows take to ease in. */
export interface ClickOnComingRows {
  atMs: number;
  easeInMs: number;
}
export function SampleRow({ row }: SampleRowProps) {
  let { sample, title, second } = row;
  return <>{sample}<CardRowTexts title={title} {...(second !== undefined && {
          second,
        })} /></>;
}
export function stopKeyHintOf({
  word,
  isSmall = false,
  keyInWords,
  isKeyUnheard = false,
  isShown,
  goesAtOnce = false,
}: StopKeyHintProps) {
  let [shownState, setShownState] = React.useState<StopHintShown>({
    wasShown: isShown,
    isGoing: false,
  });
  let isGoing = !goesAtOnce && (shownState.wasShown === isShown ? shownState.isGoing : !isShown);
  if (shownState.wasShown !== isShown || shownState.isGoing !== isGoing)
    setShownState({
      wasShown: isShown,
      isGoing,
    });
  if (!isShown && !isGoing) return null;
  let hint = <span data-size={isSmall ? 'xs' : undefined} className="-my-1 flex flex-none items-center font-control text-body font-normal whitespace-nowrap text-primary [--ui-shortcut-cap-ink:var(--ui-text-secondary)]">{word}{keyInWords !== undefined &&
        !isKeyUnheard &&
        <span className="sr-only pointer-coarse:hidden">{' '}{keyInWords}</span>}{!isKeyUnheard &&
        <Shortcut aria-hidden keys="esc" className="ms-1 pointer-coarse:hidden" />}</span>;
  if (isShown)
    return <span key="shown" {...STANDS_FOR_BUTTON_PROPS} className="sheet-stop-that-comes -my-2 -me-2.5 flex flex-none self-center py-2 pe-2.5">{hint}</span>;
  return <span key="going" aria-hidden className="relative flex-none"><span ref={(element) => {
          let view = element?.ownerDocument.defaultView;
          if (element !== null && view?.getComputedStyle(element).animationName === 'none')
            setShownState({
              wasShown: false,
              isGoing: false,
            });
        }} className="sheet-stop-that-goes flex" onAnimationEnd={() =>
          setShownState({
            wasShown: false,
            isGoing: false,
          })}>{hint}</span></span>;
}
export function AgentRowContent(props: AgentRowContentProps) {
  let { icon, isAmongSamples = false, end, children } = props;
  return <><span className={`flex flex-none items-center justify-center ${isAmongSamples ? 'me-2 w-8' : 'size-icon'}`}>{icon}</span><span className="min-w-0 flex-1 truncate">{children}</span>{end}</>;
}
export function SuggestedHeading(props: SuggestedHeadingProps) {
  let { id, words, isSaidInFull } = props;
  return <CardSectionHeading id={id} className="sheet-comes-in-pane">{isSaidInFull
      ? <DrawnAndSaid drawn={words.suggested} said={words.suggestedSaid} />
      : <span>{words.suggested}</span>}</CardSectionHeading>;
}
export function AgentWritingRow(props: AgentWritingRowProps) {
  let { words, isAmongRowsOfList = false, sizeOfWandInList = 14, onStopped } = props;
  let { isStopARow = false } = props;
  let isCoarsePointer = useCoarsePointer();
  let win = useUiWindow();
  let nowMs2 = () => (win ?? globalThis).performance.now();
  let mountedAtRef = React.useRef(Number.NEGATIVE_INFINITY);
  React.useLayoutEffect(() => {
    mountedAtRef.current = (win ?? globalThis).performance.now();
  }, [win]);
  let downAtRef = React.useRef<number | null>(null);
  let stopPressProps = {
    onPointerDown: ({ isPrimary, button }: React.PointerEvent<HTMLElement>) => {
      downAtRef.current = isPrimary && button === 0 ? nowMs2() : null;
    },
    onPointerCancel: () => {
      downAtRef.current = null;
    },
    onMouseDown: (event: React.MouseEvent<HTMLElement>) => {
      if (!isPressTaken(mountedAtRef.current, downAtRef.current, nowMs2())) event.preventDefault();
    },
    onClick: () => {
      let isTaken = isPressTaken(mountedAtRef.current, downAtRef.current, nowMs2());
      downAtRef.current = null;
      if (isTaken) onStopped();
    },
  };
  let writingText = <ShimmerText>{words.writes}</ShimmerText>;
  let stopButton = <Button variant="ghost" {...(!isCoarsePointer &&
      !isAmongRowsOfList && {
        size: 'xs',
      })} shortcut="esc" {...stopPressProps}>{words.stop}</Button>;
  let writingLine = <div className="flex min-h-control w-full items-center gap-2 px-md py-1 text-body text-primary"><span className="flex w-5 flex-none justify-center"><AgentMark size={sizeOfWandInList} /></span><span className="min-w-0 flex-1 truncate">{writingText}</span>{!isStopARow &&
        <span className="-my-1 -me-1.25 flex flex-none">{stopButton}</span>}</div>;
  if (isAmongRowsOfList && isStopARow)
    return <>{writingLine}<button type="button" className="flex min-h-control w-full items-center gap-2 rounded px-md py-1 text-start font-control text-body font-normal text-primary select-none outline-fill-accent hover:bg-fill-ghost-hover focus-visible:outline-2 focus-visible:-outline-offset-2" {...stopPressProps}><span className="w-5 flex-none" /><span className="min-w-0 flex-1 truncate">{words.stop}</span><span className="shrink-0 text-footnote text-muted"><Shortcut aria-hidden keys="esc" variant="text" className="pointer-coarse:hidden" /></span></button></>;
  if (isAmongRowsOfList) return writingLine;
  return <div className={cardRowFrameProps.className}><div className={agentRowClassProps.className}><AgentRowContent icon={<AgentMark size={AGENT_ROW_WAND_SIZE} />} end={stopButton}>{writingText}</AgentRowContent></div></div>;
}
export function KeepOrDiscardBar({ words, onKept, onDiscarded }: KeepOrDiscardBarProps) {
  return <div className="sheet-comes-in-pane flex items-center justify-end gap-xs"><Button variant="ghost" shortcut="esc" onClick={onDiscarded}>{words.discard}</Button><Button variant="primary" shortcut="enter" onClick={onKept}>{words.keep}</Button></div>;
}
export function askFieldKeyAction(event: KeyInAskField, field: AskFieldNow): AskFieldKeyAction {
  let { typed, stands, isRowHighlighted = false } = field;
  if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase()))
    return stands === 'atRest' && typed !== '' ? 'isOfField' : null;
  if (event.key === 'Enter') {
    if (isRepeatedEnterOrSpace(event) || stands === 'whileAgentWrites') return 'nothing';
    if (stands === 'withDraft') return 'keep';
    if (isRowHighlighted) return null;
    return typed.trim() === '' ? 'nothing' : 'ask';
  }
  if (event.key !== 'Escape' || stands !== 'atRest' || typed === '') return null;
  return event.repeat ? 'nothing' : 'empty';
}
export function useFocusAskField(fieldRef: React.RefObject<HTMLElement | null>): () => void {
  let isCoarsePointer = useCoarsePointer();
  return () => {
    if (!isCoarsePointer)
      fieldRef.current?.focus({
        preventScroll: true,
      });
  };
}
export function useLastByKey<Value>(value: Value | null, keyOf: (value: Value) => string): Value | null {
  let [lastNonNull, setLastNonNull] = React.useState<Value | null>(value);
  if (value !== null && (lastNonNull === null || keyOf(value) !== keyOf(lastNonNull))) setLastNonNull(value);
  return value ?? lastNonNull;
}
export function clampedEventTime(timeStamp: number): number {
  let nowMs2 = performance.now();
  return timeStamp <= nowMs2 && nowMs2 - timeStamp <= CLICK_TIME_SKEW_MS ? timeStamp : nowMs2;
}
export function useClickGuardOnComingRows({ rows, whereRowsCome, easeInMs }: ClickGuardOnComingRows) {
  let win = useUiWindow();
  let rowsCameAtRef = React.useRef(-1 / 0);
  let pressRef = React.useRef<PressOnRows | null>(null);
  let rowKeys = rowKeysStamp(rows);
  React.useLayoutEffect(
    () =>
      rowKeys === ''
        ? undefined
        : reportTimeAfterNextPaint(win, (atMs: number) => {
            rowsCameAtRef.current = atMs;
          }),
    [rowKeys, win],
  );
  return {
    onPointerDownCapture: ({ timeStamp, isPrimary }: React.PointerEvent<HTMLElement>) => {
      if (isPrimary)
        pressRef.current = {
          atMs: clampedEventTime(timeStamp),
          endedAtMs: null,
        };
    },
    onPointerUpCapture: ({ timeStamp, isPrimary }: React.PointerEvent<HTMLElement>) => {
      if (isPrimary && pressRef.current !== null) pressRef.current.endedAtMs = clampedEventTime(timeStamp);
    },
    onClickCapture: (event: React.MouseEvent<HTMLElement>) => {
      let [press, rowsStart, { target }] = [pressRef.current, whereRowsCome.current, event];
      pressRef.current = null;
      if (press === null || press.endedAtMs === null) return;
      if (!isWithinClickAfterUp(press.endedAtMs, clampedEventTime(event.timeStamp))) return;
      let isOnComingRows =
        target instanceof Node &&
        (target === rowsStart || ((rowsStart?.compareDocumentPosition(target) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0);
      let prefersReducedMotion2 = win?.matchMedia('(prefers-reduced-motion:reduce)').matches === true;
      let isGuarded = isRowsEaseInGuarded(rowsCameAtRef.current, {
        atMs: press.atMs,
        easeInMs: prefersReducedMotion2 ? 0 : easeInMs,
      });
      if (isOnComingRows && isGuarded) event.stopPropagation();
    },
  };
}
export const StopKeyHint = (props: StopKeyHintProps) => stopKeyHintOf(props);
export const DrawnAndSaid = ({ drawn, said }: { drawn: React.ReactNode; said: string }) =>
  <span className="relative"><span aria-hidden>{drawn}</span><span className="absolute inset-0 overflow-hidden whitespace-nowrap opacity-0 select-none">{said}</span></span>;
export const rowKeysStamp = (rows: readonly KeyedRow[]): string => rows.map(({ key }) => key).join();
export const agentRowButtonProps = cardRowButtonProps;
export const AGENT_ROW_WAND_SIZE = 14;
export const agentRowClassProps = {
  className:
    'flex min-h-control min-w-0 flex-1 cursor-default items-center gap-xs rounded px-2 text-start font-control text-body font-normal text-primary outline-none focus-visible:shadow-focus focus-visible:outline-hidden pointer-coarse:min-h-12',
};
export const WriteWithAgentRow = ({ words }: { words: { write: string } }) =>
  <AgentRowContent icon={<AgentMark size={AGENT_ROW_WAND_SIZE} />}>{words.write}</AgentRowContent>;
export const agentRowHighlightProps = {
  className:
    'bg-fill-ghost-selected forced-colors:outline-2 forced-colors:-outline-offset-2 forced-colors:outline-[color:Highlight] forced-colors:outline-solid',
};
export const AskForMoreRow = ({ words }: { words: { askForMore: string } }) =>
  <AgentRowContent icon={<AgentMark size={AGENT_ROW_WAND_SIZE} />} isAmongSamples>{words.askForMore}</AgentRowContent>;
export const LineWhileAgentLooks = ({ isOnBox = false }: { isOnBox?: boolean }) =>
  <span aria-hidden className="sheet-line-while-agent-looks" data-is-on-box={isOnBox || undefined} />;
export const isRowsEaseInGuarded = (sinceMs: number, click: ClickOnComingRows): boolean => isWithinPressGuard(sinceMs + click.easeInMs, click.atMs);
export const CLICK_TIME_SKEW_MS = 1000;
