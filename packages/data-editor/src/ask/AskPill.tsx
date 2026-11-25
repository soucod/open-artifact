/**
 * The selection pill: over selected text (or a picked piece), "Ask the
 * agent", Edit (when the text is one editable run of words) and "See where
 * this comes from" (when the text shows source data). Escape dismisses it for
 * that selection; Tab walks its buttons from where focus was and back, and
 * the arrow keys, Home and End move between them.
 * Touch and pen selections get no pill.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Database, MessagesSquare, Pencil } from 'lucide-react';
import { Card, ChromeButton, ChromeDivider } from '@open-artifact/editor-kit/react';
import { ASK_AGENT_LABEL } from '../drafts/words.ts';
import { intersectsVertically, type Box } from '../edit/geometry.ts';
import { EDIT_PILL_LABEL, EDIT_PILL_TITLE, SELECTION_ACTIONS, SOURCE_INSPECT_LABEL } from '../edit/labels.ts';
import { hasOpenOverlay } from '../edit/marks.tsx';
import { getToolbarKeyTarget } from '@open-artifact/editor-kit';
import { findWordsRange, getScrollContainer, getViewportRoom } from '../edit/pieces.ts';
import {
  describeElementPoint,
  describeElementSelection,
  describeRangePoint,
  describeRangeSelection,
  getDashboardTextSelection,
  type ElementSelection,
  type SelectionPoint,
} from '../page/selection.ts';
import { useCanReachAgent } from './ask.ts';
import { ASK_PILL_GAP, ASK_PILL_SELECTOR, SELECTION_UPDATE_DELAY_MS, positionSelectionPill, settleWordsTop, type PillGeometry } from './place.ts';

/** Opens what the selected text shows from its sources, or null when it shows none. */
export type RangeDataReader = (range: Range) => (() => void) | null;

export interface AskPillProps {
  root: HTMLElement;
  /** Hide the pill (comments on, edit mode on, a dialog open…). */
  off: boolean;
  /** The picked piece's id (null when none): a new one shows the pill again after Escape. */
  picked?: number | null;
  /** Bumped when the same piece is picked again. */
  picks?: number;
  pickedAt?: () => Element | null;
  onAsk: (selection: ElementSelection) => void;
  /** Edit mode on the selected words; null (or left out) shows no Edit. */
  onEdit?: (() => void) | null;
  dataAt?: RangeDataReader;
  /** Where the selection is, for presence; null when nothing is selected. */
  onPoint?: (point: SelectionPoint | null) => void;
}

interface PillAnchor extends PillGeometry {
  pick(): ElementSelection | null;
  data: (() => void) | null;
  edit: boolean;
}

const noPicked = (): Element | null => null;
const noData: RangeDataReader = () => null;

function firstVisibleRect(target: Element | Range): DOMRect {
  return [...target.getClientRects()].find((rect) => rect.width > 0) ?? target.getBoundingClientRect();
}

function isUnoccluded(element: Element, x: number, y: number): boolean {
  const top = document.elementFromPoint(x, y);
  return top === null || top.closest(ASK_PILL_SELECTOR) !== null || element.contains(top) || top.contains(element);
}

function rangeAnchor(root: Element, room: Box, dataAt: RangeDataReader, canEdit: boolean): PillAnchor | null {
  const range = getDashboardTextSelection(root);
  if (range === null) return null;
  const first = firstVisibleRect(range);
  if (!intersectsVertically(first, room)) return null;
  return {
    anchor: first,
    under: range.getBoundingClientRect().bottom + ASK_PILL_GAP,
    room,
    words: { text: range.toString(), top: first.top },
    pick: () => describeRangeSelection(range, root),
    data: dataAt(range),
    edit: canEdit && findWordsRange(range, root) !== null,
  };
}

function markAnchor(root: Element, room: Box, element: Element | null): PillAnchor | null {
  if (element === null) return null;
  const bounds = element.getBoundingClientRect();
  if (!intersectsVertically(bounds, room)) return null;
  const left = Math.max(bounds.left, room.left);
  const right = Math.min(bounds.right, room.left + room.width);
  if (!isUnoccluded(element, (left + right) / 2, Math.max(bounds.top, room.top))) return null;
  return {
    anchor: bounds,
    under: bounds.bottom + ASK_PILL_GAP,
    room,
    words: null,
    pick: () => (element.isConnected ? describeElementSelection(element, root) : null),
    data: null,
    edit: false,
  };
}

export function AskPill({ root, off, picked = null, picks = 0, pickedAt = noPicked, onAsk, onEdit = null, dataAt = noData, onPoint }: AskPillProps): ReactNode {
  const [anchor, setAnchor] = useState<PillAnchor | null>(null);
  const [placed, setPlaced] = useState<'above' | 'below'>('above');
  const pillRef = useRef<HTMLDivElement | null>(null);
  const canAsk = useCanReachAgent();
  const canEdit = anchor?.edit === true && onEdit !== null;
  const visible = anchor !== null && (canAsk || anchor.data !== null || canEdit) ? anchor : null;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const optionsRef = useRef({ picked, pickedAt, off, dataAt, canEdit: onEdit !== null });
  optionsRef.current = { picked, pickedAt, off, dataAt, canEdit: onEdit !== null };
  const dismissedRef = useRef<{ words: string | null; picked: number | null }>({ words: null, picked: null });
  const pointerRef = useRef({ down: false, byTouch: false });

  const update = useCallback((): void => {
    const options = optionsRef.current;
    if (options.off) {
      setAnchor(null);
      return;
    }
    const room = getViewportRoom(getScrollContainer(root));
    const range = pointerRef.current.byTouch ? null : rangeAnchor(root, room, options.dataAt, options.canEdit);
    if (range !== null && range.words !== null && range.words.text !== dismissedRef.current.words) {
      const words = settleWordsTop(anchorRef.current?.words ?? null, range.words);
      if (words !== null) {
        setAnchor({ ...range, words });
        return;
      }
      dismissedRef.current.words = range.words.text;
    }
    setAnchor(options.picked === null || options.picked === dismissedRef.current.picked ? null : markAnchor(root, room, options.pickedAt()));
  }, [root]);

  const reportPoint = useCallback((): void => {
    if (onPoint === undefined) return;
    const { off: hidden, picked: pickedId, pickedAt: at } = optionsRef.current;
    const range = hidden || pointerRef.current.byTouch ? null : getDashboardTextSelection(root);
    const element = hidden || pickedId === null ? null : at();
    onPoint((range === null ? null : describeRangePoint(range, root)) ?? (element?.isConnected === true ? describeElementPoint(element, root) : null));
  }, [root, onPoint]);

  useEffect(() => {
    dismissedRef.current.picked = null;
    update();
    reportPoint();
  }, [update, reportPoint, picked, picks, off]);

  const focusBackRef = useRef<Element | null>(null);
  const shown = visible !== null && !off;
  const returnSource = useCallback((): Element | null => {
    const current = visibleRef.current;
    if (current === null) return null;
    return current.words === null ? optionsRef.current.pickedAt() : focusBackRef.current;
  }, []);
  const returnTarget = useCallback((): HTMLElement | SVGElement | null => {
    const target = returnSource();
    return (target instanceof HTMLElement || target instanceof SVGElement) &&
      target !== document.body &&
      target.isConnected &&
      pillRef.current?.contains(document.activeElement) === true
      ? target
      : null;
  }, [returnSource]);
  const selectedText = shown && visible.words !== null ? visible.words.text : null;

  useEffect(() => {
    if (selectedText !== null && pillRef.current?.contains(document.activeElement) !== true) focusBackRef.current = document.activeElement;
  }, [selectedText]);

  useEffect(() => {
    let settle: ReturnType<typeof setTimeout> | undefined;
    let point: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    const both = (): void => {
      update();
      reportPoint();
    };
    const onPointerDown = (event: PointerEvent): void => {
      pointerRef.current = { down: true, byTouch: event.pointerType === 'touch' || event.pointerType === 'pen' };
    };
    const onMouseUp = (): void => {
      pointerRef.current.down = false;
      both();
    };
    const onSelectionChange = (): void => {
      dismissedRef.current.words = null;
      setAnchor((current) => (current === null || current.words === null ? current : null));
      clearTimeout(settle);
      if (!pointerRef.current.down) settle = setTimeout(both, SELECTION_UPDATE_DELAY_MS);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      returnTarget()?.focus();
      const current = visibleRef.current;
      if (event.defaultPrevented || hasOpenOverlay() || current === null || current.words === null) return;
      event.preventDefault();
      dismissedRef.current.words = current.words.text;
      setAnchor(null);
    };
    const resizes = new ResizeObserver(update);
    resizes.observe(root);
    const mutations = new MutationObserver(() => {
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        update();
        clearTimeout(point);
        point = setTimeout(reportPoint, SELECTION_UPDATE_DELAY_MS);
      });
    });
    mutations.observe(root, { subtree: true, attributes: true, childList: true });
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('mouseup', onMouseUp, true);
    window.addEventListener('scroll', update, true);
    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      clearTimeout(settle);
      clearTimeout(point);
      cancelAnimationFrame(frame);
      resizes.disconnect();
      mutations.disconnect();
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('mouseup', onMouseUp, true);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('selectionchange', onSelectionChange);
    };
  }, [root, update, reportPoint, returnTarget]);

  useEffect(() => {
    if (!shown) return;
    let enteredByTab = false;
    const onFocusOut = (event: FocusEvent): void => {
      const pill = pillRef.current;
      if (pill !== null && event.target instanceof Node && pill.contains(event.target) && !(event.relatedTarget instanceof Node && pill.contains(event.relatedTarget)))
        enteredByTab = false;
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      const buttons = [...(pillRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])];
      const active = document.activeElement;
      const index = buttons.findIndex((button) => button === active);
      if (index === -1) {
        const first = buttons[0];
        if (event.shiftKey || first === undefined || !(active === returnSource() || active === null || active === document.body)) return;
        event.preventDefault();
        enteredByTab = true;
        first.focus();
        return;
      }
      const next = buttons[index + (event.shiftKey ? -1 : 1)];
      if (next !== undefined) {
        event.preventDefault();
        next.focus();
        return;
      }
      const back = enteredByTab ? returnTarget() : null;
      if (back === null) return;
      back.focus();
      if (event.shiftKey && document.activeElement === back) event.preventDefault();
    };
    window.addEventListener('focusout', onFocusOut, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('focusout', onFocusOut, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [shown, returnSource, returnTarget]);

  useLayoutEffect(() => {
    const pill = pillRef.current;
    if (pill === null || visible === null) return;
    const place = positionSelectionPill(visible, pill.offsetWidth, pill.offsetHeight);
    pill.style.left = `${place.left}px`;
    pill.style.top = `${place.top}px`;
    setPlaced(place.placed);
  }, [visible, canAsk]);

  // Arrow keys, Home and End move focus among the pill's buttons once one of them has it.
  useEffect(() => {
    const moveFocus = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
      const pillButtons = [...(pillRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])];
      const to = getToolbarKeyTarget(event.key, pillButtons.indexOf(document.activeElement as HTMLElement), pillButtons.length);
      if (to === null) return;
      event.preventDefault();
      pillButtons[to]?.focus();
    };
    if (shown) window.addEventListener('keydown', moveFocus, true);
    return () => window.removeEventListener('keydown', moveFocus, true);
  }, [shown]);

  if (visible === null || off) return null;
  const data = visible.data;
  const ask = (): void => {
    const selection = visible.pick();
    returnTarget()?.focus();
    if (visible.words === null) dismissedRef.current.picked = optionsRef.current.picked;
    else document.getSelection()?.removeAllRanges();
    setAnchor(null);
    if (selection !== null) onAsk(selection);
  };
  const edit = (): void => {
    setAnchor(null);
    onEdit?.();
  };
  const openData = (): void => {
    if (data === null) return;
    returnTarget()?.focus();
    document.getSelection()?.removeAllRanges();
    setAnchor(null);
    data();
  };

  return createPortal(
    <div ref={pillRef} className="dash-ask-pill" data-placed={placed} data-uncommentable="" data-mc-chrome="">
      <Card role="toolbar" aria-label={SELECTION_ACTIONS} className="p-1">
        {canAsk && (
          <ChromeButton onClick={ask}>
            <MessagesSquare size={16} aria-hidden />
            {ASK_AGENT_LABEL}
          </ChromeButton>
        )}
        {canAsk && (data !== null || canEdit) && <ChromeDivider />}
        {canEdit && (
          <ChromeButton className="dash-ask-pill-edit" aria-label={EDIT_PILL_LABEL} title={EDIT_PILL_TITLE} onClick={edit}>
            <Pencil size={16} aria-hidden />
            <span className="dash-ask-pill-edit-word">{EDIT_PILL_LABEL}</span>
          </ChromeButton>
        )}
        {data !== null && (
          <ChromeButton square className="dash-ask-pill-data" aria-label={SOURCE_INSPECT_LABEL} title={SOURCE_INSPECT_LABEL} onClick={openData}>
            <Database size={16} aria-hidden />
          </ChromeButton>
        )}
      </Card>
    </div>,
    document.body,
  );
}
