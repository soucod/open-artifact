import { Tooltip } from '../kit/tooltip.tsx';
import type { TooltipProps, TooltipSide } from '../kit/tooltip.tsx';
import * as React from 'react';
import { SMALL_BAR_SELECTOR } from './toolbar/fold.tsx';
import { MODIFIER_KEYS } from '../state/escape.ts';
import { sheetMessages } from '../i18n/sheet-messages.ts';
import { TOAST_SELECTOR } from '../shell/ui-root.tsx';
/** A part of the page that holds what was touched, found by its selector in `TOUCH_PLACES`. */
export type TouchPlaceOfHolder =
  | 'bar_more'
  | 'bar'
  | 'menu'
  | 'top'
  | 'tabs'
  | 'filter_bar'
  | 'find_box'
  | 'first_screen'
  | 'pane'
  | 'dialog'
  | 'toast'
  | 'undo_card'
  | 'cells';
/** Where the person last touched the page: a part of it, or how they did it when no part holds it. */
export type TouchPlace = TouchPlaceOfHolder | 'menu_search' | 'bar_small' | 'card' | 'key' | 'other' | 'dropped_file' | 'host';
/** The arrow key that moves on to the next tool. */
export type NextToolArrowKey = 'left' | 'right';
export function touchPlaceOf(target: Element, isKey: boolean, lastPlace: TouchPlace): TouchPlace {
  const holder = target.closest(TOUCH_PLACES_SELECTOR);
  const place = TOUCH_PLACES.find(([, selector]) => holder?.matches(selector) === true)?.[0];
  const typed: unknown = place === 'menu' ? Reflect.get(holder?.querySelector('input') ?? {}, 'value') : '';
  if (typeof typed === 'string' && typed !== '') return 'menu_search';
  const isMoreOpen = () =>
    lastPlace === 'bar_more' || (target.closest(':root')?.querySelector(`${MORE_TOOLS_SELECTOR}:not([data-ending-style])`) ?? null) !== null;
  if (place === 'bar' && target.closest(PORTAL_SELECTOR) !== null && isMoreOpen()) return 'bar_more';
  if (place === 'bar' && (target.closest(':root')?.querySelector(SMALL_BAR_SELECTOR) ?? null) !== null) return 'bar_small';
  if (place !== undefined && !(place === 'cells' && isKey)) return place;
  if (target.closest(PORTAL_SELECTOR) !== null) return lastPlace === 'cells' || lastPlace === 'key' ? 'card' : lastPlace;
  return isKey ? 'key' : 'other';
}
export function watchTouchedPlaces(
  win: Window,
  countAct: (act: string, place: TouchPlace | 'page') => void,
  isLoading: () => boolean,
) {
  let lastPlace: TouchPlace = 'other';
  const onEvent = (event: Event) => {
    const key: unknown = Reflect.get(event, 'key');
    if (MODIFIER_KEYS.has(String(key)) || Reflect.get(event, 'isReplay') === true) return;
    if (event.type === 'drop') lastPlace = 'dropped_file';
    else if (hasClosestMethod(event.target)) lastPlace = touchPlaceOf(event.target, key !== undefined, lastPlace);
    countAct('touched', lastPlace);
    for (const pointerType of COUNTED_POINTER_TYPES)
      if (Reflect.get(event, 'pointerType') === pointerType) countAct(`pointer_${pointerType}`, 'page');
    if (
      (event.type === 'pointerdown' || event.type === 'mousedown') &&
      isLoading() &&
      hasClosestMethod(event.target) &&
      event.target.closest(PLACEHOLDER_MOUNT_SELECTOR) !== null
    )
      countAct('pressed_while_loading', 'page');
  };
  for (const type of TOUCH_EVENT_TYPES)
    win.addEventListener(type, onEvent, {
      capture: true,
      passive: true,
    });
  win.addEventListener('message', ({ data, origin }: MessageEvent<unknown>) => {
    if (origin === 'null') return;
    if (typeof data === 'object' && data !== null && '__frame_chrome_cmd' in data) lastPlace = 'host';
  });
  return () => lastPlace;
}
export function nextToolArrowKey({ currentTarget, relatedTarget }: Pick<React.FocusEvent, 'currentTarget' | 'relatedTarget'>): NextToolArrowKey | null {
  const toolbar = currentTarget.closest('[role="toolbar"]');
  if (toolbar === null || isWithinToolbarOrContextBar(toolbar, relatedTarget) || !currentTarget.matches(':focus-visible')) return null;
  return currentTarget.ownerDocument.defaultView?.getComputedStyle(toolbar).direction === 'rtl' ? 'left' : 'right';
}
/** The handlers of a tool that its tooltip wraps, so it can call them on. */
export interface ToolTriggerHandlers {
  onFocus?: (event: React.FocusEvent) => void;
  onBlur?: (event: React.FocusEvent) => void;
  onPointerDown?: (event: React.PointerEvent) => void;
  onPointerMove?: (event: React.PointerEvent) => void;
  onKeyDownCapture?: (event: React.KeyboardEvent) => void;
}
export interface ToolbarTooltipProps {
  name: TooltipProps['content'];
  shortcut?: string;
  side: TooltipSide;
  isShut?: boolean;
  children: React.ReactElement<ToolTriggerHandlers>;
}
export function ToolbarTooltip({ name, shortcut, side, isShut = false, children }: ToolbarTooltipProps) {
  const [nextToolKey, setNextToolKey] = React.useState<NextToolArrowKey | null>(null);
  const childProps = children.props;
  const handlers = {
    onFocus: (event: React.FocusEvent) => {
      childProps.onFocus?.(event);
      setNextToolKey(nextToolArrowKey(event));
    },
    onBlur: (event: React.FocusEvent) => {
      childProps.onBlur?.(event);
      setNextToolKey(null);
    },
    onPointerDown: (event: React.PointerEvent) => {
      childProps.onPointerDown?.(event);
      setNextToolKey(null);
    },
    onPointerMove: (event: React.PointerEvent) => {
      childProps.onPointerMove?.(event);
      setNextToolKey(null);
    },
    onKeyDownCapture: (event: React.KeyboardEvent) => {
      childProps.onKeyDownCapture?.(event);
      if (!event.repeat && event.key !== 'Shift') setNextToolKey(null);
    },
  };
  return <Tooltip content={name} {...(shortcut !== undefined && {
      shortcut,
    })} {...(nextToolKey !== null &&
      side !== 'bottom' && {
        secondaryHint: {
          label: sheetMessages.nextTool(),
          shortcut: nextToolKey,
        },
      })} side={side} hoverable={false} {...(isShut && {
      open: false,
    })}>{React.cloneElement(children, handlers)}</Tooltip>;
}
export const CONTEXT_BAR_PART_ATTRIBUTE = 'data-part-of-context-bar';
export const isInClosingContextBar = (element: Element | null) =>
  (element?.closest('[data-part-of-context-bar][data-ending-style]') ?? null) !== null;
export const isWithinToolbarOrContextBar = (toolbar: Element, relatedTarget: Element | null) =>
  relatedTarget !== null && (toolbar.contains(relatedTarget) || relatedTarget.closest('[data-part-of-context-bar]') !== null);
export const MORE_TOOLS_SELECTOR = `[${CONTEXT_BAR_PART_ATTRIBUTE}=more]`;
export const TOUCH_PLACES: [TouchPlaceOfHolder, string][] = [
  ['bar_more', MORE_TOOLS_SELECTOR],
  ['bar', '.sheet-menu-at-tool'],
  ['menu', '.sheet-menu-with-field'],
  ['bar', `.sheet-context-bar,[${CONTEXT_BAR_PART_ATTRIBUTE}]`],
  ['top', '.sheet-formula-row,.sheet-view-tools,.sheet-pivot-table-bar'],
  ['tabs', '.sheet-bar'],
  ['filter_bar', '.sheet-own-filter-bar'],
  ['find_box', '.sheet-find-over-grid'],
  ['first_screen', '.sheet-ways-in'],
  ['pane', 'aside'],
  ['dialog', '[data-ui=Dialog],[data-ui=ConfirmationDialog]'],
  ['toast', TOAST_SELECTOR],
  ['undo_card', '.sheet-done-by-agent'],
  ['cells', '.sheet-grid,.sheet-group-margin'],
];
export const TOUCH_PLACES_SELECTOR = TOUCH_PLACES.map(([, selector]) => selector).join(',');
export const PORTAL_SELECTOR = '[data-base-ui-portal]';
export const hasClosestMethod = (value: EventTarget | null): value is Element => typeof value === 'object' && value !== null && 'closest' in value;
export const TOUCH_EVENT_TYPES = ['keydown', 'pointerdown', 'mousedown', 'wheel', 'drop'];
export const COUNTED_POINTER_TYPES = ['touch', 'pen'];
export const PLACEHOLDER_MOUNT_SELECTOR = '.sheet-placeholder-mount';
