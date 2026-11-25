import { Popover } from '../../kit/popover.tsx';
import type { PopoverPopupProps } from '../../kit/popover.tsx';
import { Button } from '../../kit/button.tsx';
import * as React from 'react';
import { useLastNonNull, withListTabStops, isWithinPressGuard } from '../../ui/list-under-cell.tsx';
import { useActHoldAtAnswer, isBeforeAnswerSeen } from '../../agent/answer-holds.tsx';
import { swallowRestOfPress } from '../../ui/press-swallow.ts';
import { cancelEscapeDismissal } from './errors-notice.tsx';
import { popupPropsUnderHeader } from '../../shell/bottom-insets.ts';
import { preventMouseDownDefault } from '../../ui/dom-events.ts';
import { sheetMessages } from '../../i18n/sheet-messages.ts';
import type { SheetController } from '../../state/controller.ts';
import type { GridPoint } from '../../grid/geometry.ts';
import type { AnswerHold } from '../../state/initial-state.ts';
import type { HowActBegan } from '../../format/answer-holds.ts';
/** A piece of a formula after which a long formula may break onto the next line. */
export interface FormulaBreakPart {
  startsAt: number;
  text: string;
}
/** The key of the cell whose pill came last, and when it came. */
export interface KeyCame {
  key: string | null;
  atMs: number;
}
/** What the pill does with the fix it shows. */
export type FixPillAct = 'kept' | 'discarded';
/** Tells the page which waiting fix the pointer is over, a little late when it moves from one to another. */
export interface FixPointer {
  isOver(cell: Element | null, at: GridPoint | null): void;
  isOnPill(isOnPill: boolean): void;
  stop: () => void;
  forget(): void;
}
/** What the pill shows, kept while it closes. */
interface FixPillContent {
  shown: string;
  formulaIfCut: string | null;
  cellHeight: number;
}
/** A pointing that waits for its delay to pass. */
interface PointingLater {
  cell: Element | null;
  at: GridPoint | null;
}
export function formulaBreakParts(formula: string): FormulaBreakPart[] {
  let startsAt = 0;
  return formula.split(/(?<=[,;+\-*/&^<>=])(?![<>=])/).map((partText) => {
    let part = {
      startsAt,
      text: partText,
    };
    startsAt += partText.length;
    return part;
  });
}
export function fixWaitingUnderPointer({ target, clientX }: Pick<MouseEvent, 'target' | 'clientX'>): Element | null {
  let fixWaiting = target instanceof Element ? target.closest('[data-fix-waits]') : null;
  let isBesideText = target instanceof Element && target.closest('.sheet-lines-beside-text') !== null;
  return fixWaiting === null || !isBesideText || clientX < fixWaiting.getBoundingClientRect().right ? fixWaiting : null;
}
export function createFixPointer(store: Pick<SheetController, 'dispatch'>): FixPointer {
  let cellPointedAt: Element | null | undefined = null;
  let pending: PointingLater | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopWaiting = () => {
    if (timer !== null) clearTimeout(timer);
    [timer, pending] = [null, null];
  };
  let pointAt = (cell: Element | null, at: GridPoint | null) => {
    stopWaiting();
    cellPointedAt = cell;
    store.dispatch({
      kind: 'fixPointedAt',
      at,
    });
  };
  let pointAtLater = (cell: Element | null, at: GridPoint | null) => {
    pending = {
      cell,
      at,
    };
    timer ??= setTimeout(() => {
      if (pending !== null) pointAt(pending.cell, pending.at);
    }, FIX_POINTED_AT_DELAY_MS);
  };
  return {
    isOver(cell, at) {
      if (cell === cellPointedAt) stopWaiting();
      else if (cellPointedAt === null || cellPointedAt === undefined) pointAt(cell, at);
      else pointAtLater(cell, at);
    },
    isOnPill(isOnPill) {
      if (isOnPill) stopWaiting();
      else if (cellPointedAt !== null) pointAtLater(null, null);
    },
    stop: stopWaiting,
    forget() {
      if (pending === null) cellPointedAt = undefined;
      else pointAt(pending.cell, pending.at);
    },
  };
}
export function useFixPointer(store: Pick<SheetController, 'dispatch'>, pill: string | null): FixPointer {
  let fixPointer = React.useMemo(() => createFixPointer(store), [store]);
  React.useEffect(() => {
    if (pill === null) fixPointer.forget();
  }, [fixPointer, pill]);
  React.useEffect(() => fixPointer.stop, [fixPointer]);
  return fixPointer;
}
export function useWhenKeyCame(key: string | null): React.RefObject<KeyCame> {
  let keyCameRef = React.useRef<KeyCame>({
    key: null,
    atMs: 0,
  });
  React.useLayoutEffect(() => {
    keyCameRef.current = nextKeyCame(keyCameRef.current, key, performance.now());
  });
  return keyCameRef;
}
interface FixPillShownViewProps {
  shown: string;
}
export function FixPillShownView({ shown }: FixPillShownViewProps) {
  let isQuoted = shown.length > 1 && shown.startsWith(QUOTE_CHARACTER) && shown.endsWith(QUOTE_CHARACTER);
  return <span className="text-body me-auto flex max-w-48 min-w-0 pe-1 tabular-nums">{isQuoted &&
        <span className="flex-none">{QUOTE_CHARACTER}</span>}<bdi className={isQuoted ? 'overflow-hidden text-ellipsis whitespace-pre' : 'truncate'}>{isQuoted ? shown.slice(1, -1) : shown}</bdi>{isQuoted &&
        <span className="flex-none">{QUOTE_CHARACTER}</span>}</span>;
}
interface FixPillViewProps {
  cellKey: string | null;
  shown: string | null;
  formulaIfCut: string | null;
  cellHeight: number;
  came: React.RefObject<KeyCame>;
  anchor: PopoverPopupProps['anchor'];
  side: 'left' | 'right' | null;
  hold: AnswerHold | null;
  onActHeld: () => void;
  onActedOn: (act: FixPillAct, how: HowActBegan) => void;
  onPointed: (isOnPill: boolean) => void;
}
export function FixPillView({
  cellKey,
  shown,
  formulaIfCut,
  cellHeight,
  came,
  anchor,
  side,
  hold,
  onActHeld,
  onActedOn,
  onPointed,
}: FixPillViewProps) {
  let pillContent = React.useMemo(
    (): FixPillContent | null =>
      shown === null
        ? null
        : {
            shown,
            formulaIfCut,
            cellHeight,
          },
    [shown, formulaIfCut, cellHeight],
  );
  const contentShown: FixPillContent | null = useLastNonNull(pillContent);
  let sideShown: 'left' | 'right' | null = useLastNonNull(side);
  const isFormulaShown = contentShown !== null && contentShown.formulaIfCut !== null;
  let keySeenAtPressRef = React.useRef<string | null>(null);
  let heldAct = useActHoldAtAnswer({
    hold,
    tellOfActHeld: onActHeld,
    isNoAct: () => false,
  });
  let actOn =
    (outcome: FixPillAct) =>
    (clickEvent: React.MouseEvent<HTMLButtonElement>) => {
      if (!heldAct.isActRefused()) swallowRestOfPress(clickEvent, isInOpenFixPill);
      onActedOn(outcome, heldAct.howActBegan());
    };
  return withListTabStops(
    <Popover.Root open={cellKey !== null} onOpenChange={cancelEscapeDismissal}><Popover.Popup {...popupPropsUnderHeader()} anchor={anchor} side={sideShown ?? 'right'} align={isFormulaShown ? 'end' : 'center'} alignOffset={isFormulaShown ? (contentShown.cellHeight - FIX_PILL_ROW_HEIGHT) / 2 : 0} sideOffset={FIX_PILL_SIDE_OFFSET} padding="none" initialFocus={false} finalFocus={false} keepFocus aria-hidden data-pill-of-fix className="flex flex-col before:absolute before:inset-y-0 before:-left-1 before:w-1 data-[side=left]:before:-right-1 data-[side=left]:before:left-auto" onMouseDown={preventMouseDownDefault} onPointerEnter={() => onPointed(true)} onPointerLeave={() => onPointed(false)} onPointerDownCapture={(pointerEvent) => {
          heldAct.handlers.onPointerDownCapture(pointerEvent);
          keySeenAtPressRef.current = keySeenLongEnough(came.current, performance.now());
        }} onPointerUpCapture={heldAct.handlers.onPointerUpCapture} onPointerCancelCapture={heldAct.handlers.onPointerCancelCapture} onClickCapture={(clickEvent) => {
          heldAct.handlers.onClickCapture();
          if (!isSameNonNullKey(keySeenAtPressRef.current, cellKey)) clickEvent.stopPropagation();
          keySeenAtPressRef.current = null;
        }}>{contentShown !== null &&
            contentShown.formulaIfCut !== null &&
            (<div tabIndex={-1} className="text-body min-h-0 overflow-y-auto px-2 pt-2 font-mono wrap-anywhere">{formulaBreakParts(contentShown.formulaIfCut).map(
                ({ startsAt, text: partText }) =>
                  <React.Fragment key={startsAt}>{partText}<wbr /></React.Fragment>,
              )}</div>)}<div className="flex h-7 flex-none items-center justify-end gap-0.5 ps-2 pe-0.5 whitespace-nowrap"><FixPillShown shown={contentShown?.shown ?? ''} /><Button variant="ghost" size="xs" iconOnly icon="Check" tabIndex={-1} aria-label={sheetMessages.keepThisFix()} onClick={actOn('kept')} /><Button variant="ghost" size="xs" iconOnly icon="X" tabIndex={-1} aria-label={sheetMessages.discardThisFix()} onClick={actOn('discarded')} /></div></Popover.Popup></Popover.Root>,
  );
}
export const FIX_PILL_SIDE_OFFSET = 4;
export const FIX_PILL_ROW_HEIGHT = 28;
export const FIX_POINTED_AT_DELAY_MS = 150;
export const pointClampedToRight = (element: Element, { clientX, clientY }: Pick<MouseEvent, 'clientX' | 'clientY'>) => ({
  clientX: Math.min(clientX, element.getBoundingClientRect().right - 1),
  clientY,
});
export const nextKeyCame = (came: KeyCame, key: string | null, nowMs: number): KeyCame => ({
  key,
  atMs: came.key === key ? came.atMs : nowMs,
});
export const keySeenLongEnough = (came: KeyCame, nowMs: number): string | null => (isWithinPressGuard(came.atMs, nowMs) ? null : came.key);
export const isInOpenFixPill = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest('[data-pill-of-fix][data-open]') !== null;
export const isSameNonNullKey = (keySeen: string | null, cellKey: string | null): boolean => keySeen !== null && keySeen === cellKey;
export const fixFieldsOfKeyPress = (
  key: string,
  pillState: { cameForKeys: KeyCame; hold: AnswerHold | null },
  nowMs: number,
  isReadLate: boolean,
) => ({
  ...((key === 'Enter' || key === 'Escape') && {
    pillOfFixSeen: keySeenLongEnough(pillState.cameForKeys, nowMs),
    ...(isBeforeAnswerSeen(pillState.hold, nowMs) && {
      hasBegunBeforeAnswerWasSeen: true as const,
    }),
  }),
  ...(isReadLate && {
    isReadLate: true as const,
  }),
});
export const QUOTE_CHARACTER = '"';
export const FixPillShown = React.memo(FixPillShownView);
export const FixPill = React.memo(FixPillView);
