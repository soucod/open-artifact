/**
 * Keeping keyboard focus in the Sources panel when what held it goes away: a fix button that disappears once the fix
 * worked, a failure notice that clears, the row or Back button that a step in or out of a source replaces. Without
 * this, focus drops to the page's body and a keyboard or screen-reader user starts over from the top.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, type RefCallback } from 'react';
import { announce, useAnnouncer } from '@open-artifact/editor-kit';

/** The parts of a document these helpers read. */
export interface FocusDocument {
  readonly activeElement: unknown;
  readonly body: unknown;
  hasFocus(): boolean;
}

/** Focus is nowhere in particular: on the body, or on nothing at all. */
export function isFocusLost(doc: Pick<FocusDocument, 'activeElement' | 'body'>): boolean {
  return doc.activeElement === null || doc.activeElement === doc.body;
}

interface FocusEventLike {
  readonly relatedTarget: unknown;
}

/** The parts of an element {@link watchFocusInside} listens on. */
export interface FocusContainer {
  addEventListener(type: 'focusin' | 'focusout', listener: (event: FocusEventLike) => void): void;
  removeEventListener(type: 'focusin' | 'focusout', listener: (event: FocusEventLike) => void): void;
  contains(other: unknown): boolean;
}

/**
 * Follows whether focus is (or was last) inside `container`. Focus that leaves for nowhere, as when a focused button
 * is disabled while it works, still counts as inside; only focus moving to another element outside ends it. The
 * returned function stops listening and tells whether focus was inside, so the caller can hand it on.
 */
export function watchFocusInside(container: FocusContainer, doc: Pick<FocusDocument, 'activeElement'>): () => boolean {
  let inside = container.contains(doc.activeElement);
  const enter = (): void => {
    inside = true;
  };
  const leave = (event: FocusEventLike): void => {
    if (event.relatedTarget !== null && !container.contains(event.relatedTarget)) inside = false;
  };
  container.addEventListener('focusin', enter);
  container.addEventListener('focusout', leave);
  return () => {
    container.removeEventListener('focusin', enter);
    container.removeEventListener('focusout', leave);
    return inside;
  };
}

/**
 * A ref for an element that may go away while it holds focus. When it is removed with focus inside, and focus then
 * lands nowhere, `onGone` puts it somewhere sensible.
 */
export function useFocusHandoff<T extends HTMLElement>(onGone: () => void): RefCallback<T> {
  const latest = useRef(onGone);
  latest.current = onGone;
  return useCallback((node: T | null) => {
    if (node === null) return;
    const stop = watchFocusInside(node, document);
    return () => {
      if (!stop()) return;
      queueMicrotask(() => {
        if (isFocusLost(document)) latest.current();
      });
    };
  }, []);
}

/**
 * Focus for stepping into and out of a source: into one, focus goes to the Back button and the source's name is read
 * out, unless something else was just announced as it opened (a failure, say); back out, focus returns to the row
 * that was opened. Nothing moves when focus is elsewhere or the window isn't focused.
 */
export function useSourceStepFocus(selectedId: string | null, selectedName: string | null): {
  back: RefCallback<HTMLButtonElement>;
  row: (id: string) => RefCallback<HTMLButtonElement>;
  focusBack: () => void;
} {
  const backButton = useRef<HTMLButtonElement | null>(null);
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const shown = useRef(selectedId);
  const spokenBefore = useRef(0);
  const rowRefs = useRef(new Map<string, RefCallback<HTMLButtonElement>>());

  useLayoutEffect(() => {
    spokenBefore.current = useAnnouncer.getState().serial;
  }, [selectedId]);

  useEffect(() => {
    const previous = shown.current;
    shown.current = selectedId;
    if (previous === selectedId || !document.hasFocus() || !isFocusLost(document)) return;
    if (selectedId === null) {
      if (previous !== null) rows.current.get(previous)?.focus();
      return;
    }
    backButton.current?.focus();
    if (selectedName !== null && useAnnouncer.getState().serial === spokenBefore.current) announce(selectedName);
  }, [selectedId, selectedName]);

  const back = useCallback((node: HTMLButtonElement | null) => {
    backButton.current = node;
  }, []);
  const row = useCallback((id: string): RefCallback<HTMLButtonElement> => {
    let ref = rowRefs.current.get(id);
    if (ref === undefined) {
      ref = (node) => {
        if (node === null) rows.current.delete(id);
        else rows.current.set(id, node);
      };
      rowRefs.current.set(id, ref);
    }
    return ref;
  }, []);
  const focusBack = useCallback(() => backButton.current?.focus(), []);
  return { back, row, focusBack };
}
