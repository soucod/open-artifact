import { useUiWindow } from '../kit/theme.tsx';
import { Tooltip } from '../kit/tooltip.tsx';
import * as React from 'react';
import { useCoveredUnderCells, popupCollisionPadding } from '../shell/bottom-insets.ts';
import { MODIFIER_KEYS } from '../state/escape.ts';
import { LiveAnnouncer } from './live-announcer.tsx';
import { shortcutListMessages, shortcutActionLabel } from '../messages/shortcut-labels.ts';
import { shortcutKeysFor } from '../keys/shortcut-list.ts';
/** Where the hint of the keys that leave the cells stands: not yet earned, due to show, or over for good. */
export type LeaveCellsHintStage = 'notYet' | 'due' | 'over';
/** Where the spoken words of that hint stand: not said yet, being said now, or heard. */
export type LeaveCellsWordsSaid = 'notYet' | 'now' | 'heard';
export interface LeaveCellsHintState {
  tabsInARow: number;
  hint: LeaveCellsHintStage;
  said: LeaveCellsWordsSaid;
  timesSaid: number;
}
/** What happened that moves the hint on. */
export type LeaveCellsHappening =
  | 'pointerUsed'
  | 'steppedOutOfCells'
  | 'wordsStoodLongEnough'
  | 'restedFromTab'
  | 'tabFromCellToCell'
  | 'anythingElseWithHintInSight'
  | 'anythingElse';
export interface LeaveCellsHintProps {
  cells: React.RefObject<HTMLElement | null>;
  doesEscapeStepOut: boolean;
  isCardUnderCell: boolean;
  hasEscapeSteppedOut: boolean;
}
export function leaveCellsHintReducer(state: LeaveCellsHintState, happening: LeaveCellsHappening): LeaveCellsHintState {
  if (state.hint === 'over' && state.said === 'heard') return state;
  if (happening === 'pointerUsed' || happening === 'steppedOutOfCells')
    return {
      ...state,
      tabsInARow: 0,
      hint: 'over',
      said: 'heard',
    };
  if (happening === 'wordsStoodLongEnough')
    return state.said === 'now'
      ? {
          ...state,
          said: 'heard',
        }
      : state;
  if (happening === 'restedFromTab')
    return state.tabsInARow >= 2 && state.said === 'notYet'
      ? {
          ...state,
          said: 'now',
          timesSaid: state.timesSaid + 1,
        }
      : state;
  let wasSaidNow = state.said === 'now';
  const nextSaid = wasSaidNow ? (state.timesSaid >= 3 ? 'heard' : 'notYet') : state.said;
  if (happening === 'tabFromCellToCell') {
    let tabsInARow = state.tabsInARow + 1;
    const nextHint = state.hint === 'over' ? 'over' : tabsInARow >= 2 ? 'due' : 'notYet';
    return {
      ...state,
      tabsInARow,
      hint: nextHint,
      said: nextSaid,
    };
  }
  const hint = happening === 'anythingElseWithHintInSight' || state.hint === 'over' ? 'over' : 'notYet';
  return state.tabsInARow === 0 && hint === state.hint && !wasSaidNow
    ? state
    : {
        ...state,
        tabsInARow: 0,
        hint,
        said: nextSaid,
      };
}
export const LEAVE_CELLS_HINT_START: LeaveCellsHintState = {
  tabsInARow: 0,
  hint: 'notYet',
  said: 'notYet',
  timesSaid: 0,
};
export const CELLS_AREA_SELECTOR = '.sheet-rows, [data-is-waiting]';
export const LEAVE_CELLS_REST_MS = 1500;
export const LEAVE_CELLS_WORDS_MS = 4000;
export const LeaveCellsHint = React.memo(function ({
  cells,
  doesEscapeStepOut,
  isCardUnderCell,
  hasEscapeSteppedOut,
}: LeaveCellsHintProps) {
  let canHintShow = doesEscapeStepOut && !isCardUnderCell;
  let [hintState, tellHint] = React.useReducer(leaveCellsHintReducer, LEAVE_CELLS_HINT_START);
  let barRoom = useCoveredUnderCells();
  let pageWindow = useUiWindow();
  let isHintDone = hintState.hint === 'over' && hintState.said === 'heard';
  if (hasEscapeSteppedOut && !isHintDone) tellHint('steppedOutOfCells');
  let isHintShown = hintState.hint === 'due' && canHintShow;
  React.useEffect(() => {
    if (isHintDone || pageWindow === undefined) return;
    let isInCells = (target: EventTarget | null) => target instanceof pageWindow.Element && target.matches(CELLS_AREA_SELECTOR);
    let onAnythingElse = () => tellHint(isHintShown ? 'anythingElseWithHintInSight' : 'anythingElse');
    let onKeyDownCapture = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' && !MODIFIER_KEYS.has(event.key)) onAnythingElse();
    };
    let onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      if (event.defaultPrevented && isInCells(event.target)) tellHint('tabFromCellToCell');
      else onAnythingElse();
    };
    let onPointerUsed = () => tellHint('pointerUsed');
    let onFocusIn = (event: FocusEvent) => {
      if (!isInCells(event.target)) onAnythingElse();
    };
    let onBlur = () => tellHint('anythingElse');
    let controller = new AbortController();
    let { signal } = controller;
    pageWindow.addEventListener('keydown', onKeyDownCapture, {
      capture: true,
      signal,
    });
    pageWindow.addEventListener('keydown', onKeyDown, {
      signal,
    });
    pageWindow.addEventListener('pointerdown', onPointerUsed, {
      capture: true,
      signal,
    });
    pageWindow.addEventListener('wheel', onPointerUsed, {
      capture: true,
      passive: true,
      signal,
    });
    pageWindow.addEventListener('focusin', onFocusIn, {
      signal,
    });
    pageWindow.addEventListener('blur', onBlur, {
      signal,
    });
    return () => controller.abort();
  }, [pageWindow, isHintDone, isHintShown]);
  React.useEffect(() => {
    if (hintState.tabsInARow < 2 || hintState.said !== 'notYet' || !canHintShow) return;
    let timer = pageWindow?.setTimeout(() => tellHint('restedFromTab'), LEAVE_CELLS_REST_MS);
    return () => pageWindow?.clearTimeout(timer);
  }, [hintState, canHintShow, pageWindow]);
  let isSaidNow = hintState.said === 'now';
  React.useEffect(() => {
    if (!isSaidNow) return;
    let timer = pageWindow?.setTimeout(() => tellHint('wordsStoodLongEnough'), LEAVE_CELLS_WORDS_MS);
    return () => pageWindow?.clearTimeout(timer);
  }, [isSaidNow, pageWindow]);
  return <><LiveAnnouncer words={isSaidNow && shortcutListMessages.keysThatLeaveCells()} timesSaid={hintState.timesSaid} />{hintState.hint !== 'over' &&
        <Tooltip content={shortcutActionLabel('leaveCells')} shortcut={shortcutKeysFor('leaveCells')} open={isHintShown} anchor={() => cells.current?.querySelector('.sheet-active-cell-outline') ?? null} side="bottom" align="start" collisionPadding={popupCollisionPadding(barRoom)} />}</>;
});
