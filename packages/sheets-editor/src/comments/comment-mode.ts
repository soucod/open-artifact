import * as React from 'react';
import type { SheetController } from '../state/controller.ts';
import { IS_APPLE_PLATFORM } from '../ui/dom-events.ts';
import { placementIdOfElement } from '../charts/placed-views-layer.tsx';
import { isInAtEndOfSheet } from '../grid/add-at-end.tsx';
import { SELECTION_SUMMARY_ID } from '../grid/cell-drawing.tsx';
/** What the comment shortcut needs of the page: whether it is offered where the key went, and what it does. */
interface CommentShortcutHooks {
  isOffered(target: EventTarget | null): boolean;
  comment(): void;
}
/** What leaving comment mode by a press needs of the page. */
interface CommentModeLeaving {
  mayLeave(): boolean;
  leave(isReleased: boolean): void;
  readMark(): void;
  later(run: () => void, delayMs: number): void;
}
export function listenForCommentShortcut(
  view: Window,
  { isOffered, comment }: CommentShortcutHooks,
  isMac: boolean = IS_APPLE_PLATFORM,
): () => void {
  let onKeyDown = (event: KeyboardEvent) => {
    if (!isCommentShortcut(event, isMac) || !isOffered(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!event.repeat) comment();
  };
  view.addEventListener('keydown', onKeyDown, true);
  return () => view.removeEventListener('keydown', onKeyDown, true);
}
export function leaveCommentModeOnPress(view: Window, { mayLeave, leave, readMark, later }: CommentModeLeaving): () => void {
  let isLeavingPress = (target: EventTarget | null) => mayLeave() && closestOf(target, LEAVES_COMMENT_MODE_SELECTOR) !== null;
  let leaveAndReadLater = () => {
    leave(true);
    later(readMark, 800);
  };
  let releaseTypes = ['pointerup', 'pointercancel'];
  let onRelease = ({ type }: Event) => {
    for (let releaseType of releaseTypes) view.removeEventListener(releaseType, onRelease, true);
    later(type === 'pointercancel' ? readMark : leaveAndReadLater, 0);
  };
  let onPointerDown = ({ target }: PointerEvent) => {
    if (!isLeavingPress(target)) return;
    leave(false);
    for (let releaseType of releaseTypes) view.addEventListener(releaseType, onRelease, true);
  };
  let onLeavingAct = (event: Event) => {
    if (
      !(event.type === 'click'
        ? 'detail' in event && event.detail === 0
        : event.type === 'keydown'
          ? 'key' in event && event.key === 'Escape'
          : closestOf(event.target, FORMULA_FIELD_SELECTOR) !== null) ||
      !isLeavingPress(event.target)
    )
      return;
    leave(false);
    leaveAndReadLater();
  };
  view.addEventListener('pointerdown', onPointerDown, true);
  view.addEventListener('click', onLeavingAct, true);
  view.addEventListener('beforeinput', onLeavingAct, true);
  view.addEventListener('keydown', onLeavingAct, true);
  return () => {
    view.removeEventListener('pointerdown', onPointerDown, true);
    view.removeEventListener('click', onLeavingAct, true);
    view.removeEventListener('beforeinput', onLeavingAct, true);
    view.removeEventListener('keydown', onLeavingAct, true);
    for (let releaseType of releaseTypes) view.removeEventListener(releaseType, onRelease, true);
  };
}
export function useCommentMode(
  editor: Pick<SheetController, 'dispatch' | 'getView'>,
  frameRef: React.RefObject<HTMLElement | null>,
  isLeavingAllowed: () => boolean,
): void {
  React.useEffect(() => {
    let documentElement = frameRef.current?.ownerDocument.documentElement;
    let view = documentElement?.ownerDocument.defaultView ?? null;
    if (documentElement === undefined || view === null) return;
    let isCommentModeOn = () => documentElement.hasAttribute(COMMENT_MODE_ATTRIBUTE);
    // The Shell's comment layer leaves picking the cells to comment on to the page.
    let isToolForEditors = true;
    let readMark = () =>
      editor.dispatch({
        kind: 'commentModeChanged',
        isOn: isCommentModeOn(),
        isToolForEditors,
      });
    readMark();
    let markTimer: ReturnType<typeof setTimeout> | undefined;
    let observer = new view.MutationObserver(() => {
      clearTimeout(markTimer);
      markTimer = setTimeout(readMark, 0);
    });
    observer.observe(documentElement, {
      attributes: true,
      attributeFilter: [COMMENT_MODE_ATTRIBUTE],
    });
    let swallowPress = (event: Event) => {
      let { target } = event;
      if (event.type === 'click' && 'detail' in event && event.detail === 0) return;
      if (!(target instanceof view.Element) || target.closest(COMMENT_PASS_SELECTOR) !== null) return;
      if (
        !(placementIdOfElement(target) !== null || isInAtEndOfSheet(target) || target.id === SELECTION_SUMMARY_ID) ||
        !editor.getView().isPressOrEnterAComment
      )
        return;
      event.preventDefault();
      event.stopPropagation();
    };
    let timers = new Set<ReturnType<typeof setTimeout>>();
    let stopLeaving = leaveCommentModeOnPress(view, {
      mayLeave: () =>
        editor.getView().doesCommentModePickCells &&
        editor.getView().viewOnlyBecause === null &&
        editor.getView().mode.kind === 'navigating' &&
        isLeavingAllowed(),
      leave: (isReleased) =>
        editor.dispatch({
          kind: 'commentModeLeftByPress',
          isReleased,
        }),
      readMark,
      later: (run, delayMs) => void timers.add(setTimeout(run, delayMs)),
    });
    let pressTypes = ['pointerdown', 'mousedown', 'click', 'contextmenu'];
    for (let pressType of pressTypes) documentElement.addEventListener(pressType, swallowPress, true);
    let stopShortcut = listenForCommentShortcut(view, {
      isOffered: (target) =>
        editor.getView().isCommentOffered &&
        target instanceof view.Node &&
        frameRef.current?.contains(target) === true &&
        placementIdOfElement(target) === null,
      comment: () =>
        editor.dispatch({
          kind: 'commentChosen',
        }),
    });
    return () => {
      observer.disconnect();
      clearTimeout(markTimer);
      for (let timer of timers) clearTimeout(timer);
      stopLeaving();
      for (let pressType of pressTypes) documentElement.removeEventListener(pressType, swallowPress, true);
      stopShortcut();
    };
  }, [editor, frameRef, isLeavingAllowed]);
}
export const COMMENT_MODE_ATTRIBUTE = 'data-comment-mode';
export const COMMENT_PASS_SELECTOR = '[data-comment-pass]';
export const FORMULA_FIELD_SELECTOR = '.sheet-formula-field';
export const LEAVES_COMMENT_MODE_SELECTOR = `[role=toolbar], ${FORMULA_FIELD_SELECTOR}`;
export const isCommentShortcut = (event: KeyboardEvent, isMac: boolean): boolean =>
  event.altKey &&
  !event.shiftKey &&
  (isMac ? event.metaKey && !event.ctrlKey && event.code === 'KeyM' : event.ctrlKey && !event.metaKey && (event.key === 'm' || event.key === 'M'));
export const canClosest = (target: EventTarget | null): target is Element => target !== null && 'closest' in target;
export const closestOf = (target: EventTarget | null, selector: string): Element | null => (canClosest(target) ? target.closest(selector) : null);
