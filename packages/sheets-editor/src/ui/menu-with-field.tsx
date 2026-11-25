import { ContextMenu } from '../kit/context-menu.tsx';
import { Menu } from '../kit/menu.tsx';
import { useUiWindow } from '../kit/theme.tsx';
import type { MenuPopupProps } from '../kit/menu.tsx';
import type { PagePoint } from '../comments/page-comments.ts';
import type { MenuCommand } from './search-menu/matching.ts';
import * as React from 'react';
import { listenForKeysToHandOff } from './keyboard-handoff.ts';
import { useCoarsePointerMedia } from '../app/media-queries.ts';
import { isCommandToConfirm } from './search-menu/matching.ts';
import { MenuItemWithWhyOff } from './menu-item-why-off.tsx';
import { commandGroupMessages } from './search-menu/command-groups.ts';
import { AskAgentMenuItems } from '../agent/ask-agent-menu.tsx';
/** What Enter in a menu field did: the menu stays open, shuts, or lights the row that is out of use. */
export type MenuFieldEntered = 'stay' | 'shut' | 'lightOutOfUse';
/** The field at the top of a menu: what is typed in it, and the rows that typing finds. */
export interface MenuField {
  /** Placeholder and accessible name of the field. */
  name: string;
  typed: string;
  onTyped: (typed: string) => void;
  takesCaretAtFirst: boolean;
  /** The rows found for what is typed, or null when nothing is typed. */
  renderRowsFor: (typed: string) => React.ReactNode;
  onEntered: (typed: string) => MenuFieldEntered;
  onShutByEnter: () => void;
  hasRowsAtRest?: boolean;
  isOverNumbers?: boolean;
  isRowToTakeKeyboard?: boolean;
  mostUnits?: number;
  onPastedWithNothingTyped?: (event: ClipboardEvent) => void;
}
/** Where a menu with a field opens, worked out from its anchor and the room in the window. */
export interface MenuPlacedWithField {
  anchor: MenuPopupProps['anchor'];
  align: MenuAlign;
  widthOfWide: number;
}
export type MenuAlign = 'start' | 'end';
/** Where the pointer came to rest over the menu; 'somewhere' until it moves again. */
export type PointerRest = PagePoint | 'somewhere' | null;
/** What a key pressed in a menu with a field does. */
export type MenuFieldKeyAction = 'backToField' | 'typeInField' | 'typeSpace' | 'pastLitRow' | 'nothing' | 'enter';
/** What a key press in a menu with a field is read from. */
export interface MenuFieldKeyPress {
  key: string;
  isInField: boolean;
  isOnFirstRow: boolean;
  isRowAfterLitRow: boolean;
  isOnRowWithOpenList: boolean;
  isOnRowOfMenuItself: boolean;
  isWrittenFromRight: boolean;
  isAnythingTyped: boolean;
  isWithModifier: boolean;
  isShiftHeld: boolean;
  isOfInputMethod: boolean;
  isHeldDown: boolean;
}
export function createLateEnterTracker() {
  let compositionEndedAt = Number.NEGATIVE_INFINITY;
  return {
    compositionEnded: ({ timeStamp }: Pick<Event, 'timeStamp'>) => {
      compositionEndedAt = timeStamp;
    },
    isLateEnter({ key, timeStamp }: Pick<KeyboardEvent, 'key' | 'timeStamp'>, vendor: string) {
      const msSinceComposition = timeStamp - compositionEndedAt;
      compositionEndedAt = Number.NEGATIVE_INFINITY;
      return key === 'Enter' && isSafariLateEnter(msSinceComposition, vendor);
    },
  };
}
export function menuAlignForRoom(anchorStart: number, anchorSize: number, roomSize: number, isRtl: boolean): MenuAlign {
  const wideNeeded = MENU_NUDGE + WIDE_MENU_WIDTH + MENU_EDGE_GAP;
  const fitsAfter = anchorStart + wideNeeded <= roomSize;
  const fitsBefore = anchorStart + anchorSize - wideNeeded >= 0;
  const [prefersFirst, prefersSecond] = isRtl ? [fitsBefore, fitsAfter] : [fitsAfter, fitsBefore];
  if (prefersFirst || prefersSecond) return prefersFirst ? 'start' : 'end';
  const [roomAfter, roomBefore] = [roomSize - anchorStart, anchorStart + anchorSize];
  return (isRtl ? roomAfter > roomBefore : roomBefore > roomAfter) ? 'end' : 'start';
}
export function placeMenuWithField(anchor: MenuPopupProps['anchor'], ownWindow: Window | undefined): MenuPlacedWithField {
  if (ownWindow === undefined || anchor === null || typeof anchor !== 'object' || !('getBoundingClientRect' in anchor) || 'nodeType' in anchor)
    return {
      anchor,
      align: 'start',
      widthOfWide: WIDE_MENU_WIDTH,
    };
  const isRtl = ownWindow.getComputedStyle(ownWindow.document.documentElement).direction === 'rtl';
  const { x: anchorX, width: anchorWidth } = anchor.getBoundingClientRect();
  const align = menuAlignForRoom(anchorX, anchorWidth, ownWindow.innerWidth, isRtl);
  const opensTowardStart = (align === 'start') === isRtl;
  return {
    align,
    widthOfWide: wideMenuWidth(opensTowardStart ? anchorX + anchorWidth : ownWindow.innerWidth - anchorX),
    anchor: {
      getBoundingClientRect() {
        const { x, y, width, height } = anchor.getBoundingClientRect();
        return new DOMRect(x + (opensTowardStart ? -MENU_NUDGE : MENU_NUDGE), y, width, height);
      },
    },
  };
}
export function holdMenuHeight(menu: HTMLElement, isHeld: boolean, height: number = menu.getBoundingClientRect().height, rowsRoom?: number) {
  const holder = menu.parentElement;
  if (holder === null || isHeld === (holder.style.minBlockSize !== '')) return;
  holder.style.minBlockSize = isHeld ? `${height}px` : '';
  holder.style.pointerEvents = isHeld ? 'none' : '';
  menu.style.pointerEvents = isHeld ? 'auto' : '';
  if (isHeld && rowsRoom !== undefined) menu.style.setProperty('--sheet-room-for-rows', `${rowsRoom}px`);
  if (!isHeld) menu.style.removeProperty('--sheet-room-for-rows');
}
export interface MenuRoomForRowsProps {
  anchor: MenuPopupProps['anchor'];
  paddingAtFoot: number;
  ownWindow: Window | undefined;
}
export function MenuRoomForRows(props: MenuRoomForRowsProps) {
  const { anchor, paddingAtFoot, ownWindow } = props;
  const markerRef = React.useRef<HTMLSpanElement>(null);
  React.useLayoutEffect(() => {
    const menu = markerRef.current?.closest<HTMLElement>('[role="menu"]') ?? null;
    if (menu === null || ownWindow === undefined) return;
    const room = roomForRows(anchorBottom(anchor), ownWindow.innerHeight - paddingAtFoot);
    holdMenuHeight(menu, true, room);
    menu.style.setProperty('--sheet-room-for-rows', `${room}px`);
    return () => holdMenuHeight(menu, false);
  }, [anchor, paddingAtFoot, ownWindow]);
  return <span ref={markerRef} hidden />;
}
export interface MenuWidthOfWideProps {
  width: number;
}
export function MenuWidthOfWide({ width }: MenuWidthOfWideProps) {
  const markerRef = React.useRef<HTMLSpanElement>(null);
  React.useLayoutEffect(() => {
    const menu = markerRef.current?.closest<HTMLElement>('[role="menu"]') ?? null;
    menu?.style.setProperty('--sheet-width-of-wide', `${width}px`);
    return () => void menu?.style.removeProperty('--sheet-width-of-wide');
  }, [width]);
  return <span ref={markerRef} hidden />;
}
export interface MenuFieldMaxLengthProps {
  /** Most UTF-16 units the field takes. */
  mostUnits: number;
}
export function MenuFieldMaxLength({ mostUnits }: MenuFieldMaxLengthProps) {
  const markerRef = React.useRef<HTMLSpanElement>(null);
  React.useLayoutEffect(() => {
    const field = markerRef.current?.closest('[role="menu"]')?.querySelector('input') ?? null;
    if (field !== null) field.maxLength = mostUnits;
  }, [mostUnits]);
  return <span ref={markerRef} hidden />;
}
export interface OnMenuOpenedProps {
  onOpened: () => void;
}
export function OnMenuOpened({ onOpened }: OnMenuOpenedProps) {
  React.useLayoutEffect(onOpened, [onOpened]);
  return null;
}
export interface MenuKeyboardTakerProps {
  onShut: () => void;
  /** Keys that do not type go to the rows rather than the field. */
  isRowToTakeKeyboard: boolean;
}
export function MenuKeyboardTaker({ onShut, isRowToTakeKeyboard }: MenuKeyboardTakerProps) {
  const markerRef = React.useRef<HTMLSpanElement>(null);
  const shut = React.useEffectEvent(onShut);
  const isKeyForRow = React.useEffectEvent((event: KeyboardEvent) => isRowToTakeKeyboard && !isMenuFieldTypingKey(event));
  const isClipboardKeyForRow = React.useEffectEvent((event: KeyboardEvent) => isRowToTakeKeyboard && isClipboardKey(event));
  React.useLayoutEffect(() => {
    const menu = markerRef.current?.closest<HTMLElement>('[role="menu"]') ?? null;
    const field = menu?.querySelector('input') ?? null;
    if (menu === null || field === null || menu.contains(menu.ownerDocument.activeElement)) return;
    return listenForKeysToHandOff(menu.ownerDocument, {
      holds: (target: EventTarget | null) => target instanceof Element && target.closest('[role="menu"]') !== null,
      takes: (event: KeyboardEvent) => !isClipboardKeyForRow(event),
      takeKeyboard(event: KeyboardEvent) {
        (isKeyForRow(event) ? menu : field).focus({
          preventScroll: true,
        });
        return menu.contains(menu.ownerDocument.activeElement);
      },
      handOn(event: KeyboardEvent) {
        if (!isKeyForRow(event) || event.ctrlKey || event.metaKey) return;
        event.preventDefault();
        menu.ownerDocument.activeElement?.dispatchEvent(new KeyboardEvent('keydown', event));
      },
      shut,
    });
  }, []);
  return <span ref={markerRef} hidden />;
}
export function pointerAtRest(restPoint: PointerRest, point: PagePoint): PagePoint | null {
  if (restPoint === null) return null;
  if (restPoint === 'somewhere') return point;
  return Math.hypot(point.x - restPoint.x, point.y - restPoint.y) < POINTER_REST_DISTANCE ? restPoint : null;
}
export function menuFieldKeyAction(press: MenuFieldKeyPress): MenuFieldKeyAction | null {
  if (press.isOfInputMethod) return null;
  if (press.key === (press.isWrittenFromRight ? 'ArrowRight' : 'ArrowLeft') && press.isOnRowOfMenuItself) return 'backToField';
  if (press.isWithModifier) return null;
  if (press.key === 'ArrowUp' && press.isOnFirstRow && !press.isShiftHeld) return 'backToField';
  if (press.isOnRowWithOpenList && press.key.length === 1 && press.key !== ' ') return 'typeInField';
  if (!press.isAnythingTyped) return null;
  if (press.key === ' ' && !press.isInField) return 'typeSpace';
  if (press.key === 'ArrowDown' && press.isInField && press.isRowAfterLitRow && !press.isShiftHeld) return 'pastLitRow';
  if (press.key !== 'Enter' || press.isShiftHeld) return null;
  if (!press.isInField) return null;
  return press.isHeldDown ? 'nothing' : 'enter';
}
export function rowAfterLitRow(rows: HTMLElement[]) {
  const litIndex = rows.findIndex(({ classList }) => classList.contains('sheet-row-under-enter'));
  return litIndex === -1 ? null : (rows[litIndex + 1] ?? null);
}
export function applyMenuFieldKeyAction(action: MenuFieldKeyAction, event: React.KeyboardEvent, field: HTMLInputElement | null) {
  if (action !== 'typeInField') event.preventDefault();
  event.stopPropagation();
  if (action === 'typeSpace' || action === 'typeInField' || action === 'backToField')
    field?.focus({
      preventScroll: true,
    });
}
export interface MenuWithFieldProps extends MenuPopupProps {
  field: MenuField | null;
  /** The menu opens from a tool of the toolbar rather than on the cells. */
  isAtTool?: boolean;
  isOpen?: boolean;
}
/** What a menu with a field and its rows at rest look like when drawn elsewhere. */
export type MenuWithFieldRender = (menu: { field: MenuField | null; atRest: React.ReactNode }) => React.ReactNode;
interface MenuWithFieldPlacement {
  anchor: MenuPopupProps['anchor'];
  ownWindow: Window | undefined;
  isAtTool: boolean;
  isOpen: boolean;
  placed: MenuPlacedWithField | null;
}
export function MenuWithField({
  field,
  isAtTool = false,
  isOpen = true,
  children,
  onKeyDownCapture,
  ...popupProps
}: MenuWithFieldProps) {
  const [focusedField, setFocusedField] = React.useState<HTMLInputElement | null>(null);
  const compositionEndRef = React.useRef(Number.NEGATIVE_INFINITY);
  const heldMenuRef = React.useRef<HTMLElement | null>(null);
  const pointerRef = React.useRef<PagePoint | null>(null);
  const restPointRef = React.useRef<PointerRest>(null);
  const forgetPointer = React.useCallback(() => {
    pointerRef.current = null;
    restPointRef.current = null;
  }, []);
  const markPointerAtRest = (menu: Element, restPoint: PointerRest) => {
    restPointRef.current = restPoint;
    menu.toggleAttribute(POINTER_AT_REST_ATTRIBUTE, restPoint !== null);
  };
  const ownWindow = useUiWindow();
  const isPointerCoarse = useCoarsePointerMedia();
  const { anchor } = popupProps;
  const [placement, setPlacement] = React.useState<MenuWithFieldPlacement | null>(null);
  if (
    placement === null ||
    placement.anchor !== anchor ||
    placement.ownWindow !== ownWindow ||
    placement.isAtTool !== isAtTool ||
    placement.isOpen !== isOpen
  )
    setPlacement({
      anchor,
      ownWindow,
      isAtTool,
      isOpen,
      placed:
        !isOpen && placement !== null && placement.ownWindow === ownWindow && placement.isAtTool === isAtTool
          ? placement.placed
          : isAtTool
            ? null
            : placeMenuWithField(anchor, ownWindow),
    });
  const placed = placement !== null && placement.anchor === anchor ? placement.placed : null;
  const isNothingTyped = field === null || field.typed === '';
  const hasRowsAtRest = field?.hasRowsAtRest !== false;
  React.useLayoutEffect(() => {
    if (!isNothingTyped) return;
    if (heldMenuRef.current !== null && hasRowsAtRest) holdMenuHeight(heldMenuRef.current, false);
    pointerRef.current = null;
    restPointRef.current = null;
    heldMenuRef.current?.removeAttribute(POINTER_AT_REST_ATTRIBUTE);
  }, [isNothingTyped, hasRowsAtRest]);
  const renderOverride = React.use(MenuWithFieldRenderContext);
  if (renderOverride !== null)
    return renderOverride({
      field,
      atRest: children,
    });
  if (field === null)
    return <ContextMenu.Popup {...popupProps} onKeyDownCapture={onKeyDownCapture}>{children}</ContextMenu.Popup>;
  const {
    name,
    typed,
    onTyped,
    takesCaretAtFirst,
    renderRowsFor,
    onEntered,
    onShutByEnter,
  } = field;
  const rowsFound = renderRowsFor(typed);
  const isKeyboardYetToCome = !(isAtTool && isPointerCoarse) && focusedField?.isConnected !== true;
  const takesCaretNow = takesCaretAtFirst && isKeyboardYetToCome;
  return <Menu.SearchablePopup key={placed?.align} {...popupProps} {...(placed !== null && {
        align: placed.align,
        anchor: placed.anchor,
        sideOffset: -5,
      })} className={`sheet-menu-with-field ${isAtTool ? 'sheet-menu-at-tool' : ''} ${field.isOverNumbers === true ? 'sheet-menu-of-numbers' : ''}`} {...(!hasRowsAtRest &&
        rowsFound === null && {
          'data-is-field-alone': '',
        })} {...(isMenuWide({
        hasRowsFound: rowsFound !== null,
        hasRowsAtRest,
      }) && {
        'data-is-wide': '',
      })} onPointerMoveCapture={(event) => {
        const { clientX: x, clientY: y } = event;
        pointerRef.current = {
          x,
          y,
        };
        markPointerAtRest(
          event.currentTarget,
          pointerAtRest(restPointRef.current, {
            x,
            y,
          }),
        );
        if (restPointRef.current !== null) event.stopPropagation();
      }} onMouseMoveCapture={(event) => {
        if (restPointRef.current !== null) event.stopPropagation();
      }} onInputCapture={({ currentTarget: menu, target }) => {
        markPointerAtRest(menu, pointerRef.current ?? 'somewhere');
        heldMenuRef.current = menu;
        if (isAtTool) return;
        const isFieldEmpty = target instanceof HTMLInputElement && target.value === '';
        holdMenuHeight(
          menu,
          !isFieldEmpty || !hasRowsAtRest,
          undefined,
          hasRowsAtRest && ownWindow !== undefined
            ? ownWindow.innerHeight - bottomPaddingOf(popupProps.collisionPadding) - menu.getBoundingClientRect().top
            : undefined,
        );
      }} searchLabel={name} fieldFocusOnOpen={takesCaretAtFirst && !takesCaretNow} onFocus={(event) => {
        popupProps.onFocus?.(event);
        const fieldElement = event.currentTarget.querySelector('input');
        if (event.target === fieldElement && event.relatedTarget instanceof Element && event.relatedTarget.closest('[role^="menuitem"]') !== null)
          markPointerAtRest(event.currentTarget, pointerRef.current ?? 'somewhere');
        if (event.target !== event.currentTarget) return setFocusedField(fieldElement);
        const cameFromOpenPopup = event.relatedTarget instanceof Element && event.relatedTarget.hasAttribute('data-popup-open');
        if (takesCaretNow || (typed !== '' && !cameFromOpenPopup && !isPointerCoarse))
          fieldElement?.focus({
            preventScroll: true,
          });
      }} onPasteCapture={(event) => {
        popupProps.onPasteCapture?.(event);
        if (typed === '') field.onPastedWithNothingTyped?.(event.nativeEvent);
      }} query={typed} onQueryChange={onTyped} onCompositionEndCapture={({ nativeEvent }) => {
        compositionEndRef.current = nativeEvent.timeStamp;
      }} onKeyDownCapture={(event) => {
        const msSinceComposition = event.nativeEvent.timeStamp - compositionEndRef.current;
        compositionEndRef.current = Number.NEGATIVE_INFINITY;
        onKeyDownCapture?.(event);
        if (event.isPropagationStopped()) return;
        const fieldElement = event.currentTarget.querySelector('input');
        const rowAfterLit =
          event.key === 'ArrowDown' && !isPointerCoarse
            ? rowAfterLitRow([...event.currentTarget.querySelectorAll<HTMLElement>(ENABLED_MENU_ITEM_SELECTOR)])
            : null;
        const action = menuFieldKeyAction({
          key: event.key,
          isInField: event.target === fieldElement,
          isOnFirstRow:
            event.target === event.currentTarget.querySelector(ENABLED_MENU_ITEM_SELECTOR) ||
            event.target === event.currentTarget.querySelector(MENU_ITEM_SELECTOR),
          isRowAfterLitRow: rowAfterLit !== null,
          isOnRowWithOpenList: event.target instanceof Element && isRowWithOpenList(event.currentTarget, event.target),
          isOnRowOfMenuItself:
            event.target instanceof Element && event.target !== fieldElement && event.target.closest('[role="menu"]') === event.currentTarget,
          isWrittenFromRight: ownWindow?.getComputedStyle(event.currentTarget).direction === 'rtl',
          isAnythingTyped: rowsFound !== null,
          isWithModifier: event.altKey || event.ctrlKey || event.metaKey,
          isShiftHeld: event.shiftKey,
          isOfInputMethod:
            event.nativeEvent.isComposing ||
            event.keyCode === 229 ||
            (event.key === 'Enter' && isSafariLateEnter(msSinceComposition, navigator.vendor)),
          isHeldDown: event.repeat,
        });
        if (action === null || (action === 'typeSpace' && field.isOverNumbers === true)) return;
        if (action === 'typeSpace') onTyped(`${typed} `);
        applyMenuFieldKeyAction(action, event, fieldElement);
        if (action === 'pastLitRow')
          rowAfterLit?.focus({
            focusVisible: true,
          });
        if (action !== 'enter') return;
        const entered = onEntered(typed);
        if (entered === 'shut') onShutByEnter();
        if (entered !== 'lightOutOfUse') return;
        event.currentTarget.querySelector<HTMLElement>(DISABLED_COMMAND_SELECTOR)?.focus({
          focusVisible: true,
        });
      }}>{() =>
        (<>{placed !== null &&
              <MenuWidthOfWide width={placed.widthOfWide} />}{!hasRowsAtRest &&
              <MenuRoomForRows anchor={popupProps.anchor} paddingAtFoot={bottomPaddingOf(popupProps.collisionPadding)} ownWindow={ownWindow} />}<OnMenuOpened onOpened={forgetPointer} />{field.mostUnits !== undefined &&
              <MenuFieldMaxLength mostUnits={field.mostUnits} />}{takesKeyboardAtOnce({
              ...field,
              isKeyboardYetToCome,
            }) &&
              <MenuKeyboardTaker onShut={onShutByEnter} isRowToTakeKeyboard={field.isRowToTakeKeyboard === true} />}{rowsFound ?? (hasRowsAtRest ? children : null)}</>)}</Menu.SearchablePopup>;
}
/** What a row of a command shows. */
export type CommandOfRow = Pick<MenuCommand, 'id' | 'label' | 'icon' | 'keys' | 'isUnderEnter' | 'isTicked' | 'whyNot' | 'keepsOpen'>;
export interface CommandRowsProps<Command extends CommandOfRow> {
  commands: readonly Command[];
  isPointerCoarse: boolean;
  /** The second line of a row, or null for none. */
  describe: (command: Command) => string | null;
  /** Called with whether the row was taken by key rather than by pointer. */
  onTaken: (command: Command, isByKey: boolean) => void;
  onPointedAt?: (command: Command, isPointedAt: boolean) => void;
  /** Lights the row Enter would take. */
  isRowUnderEnterLit?: boolean;
  hintOf?: (command: Command) => string | null;
  /** The rows are choices of one setting, ticked as radio rows. */
  isOneChoice?: boolean;
  /** The row whose command waits for Enter again to confirm. */
  idOfRowAskedAgain?: string | null;
}
export function CommandRows<Command extends CommandOfRow>(props: CommandRowsProps<Command>) {
  const { commands, isPointerCoarse, describe, onTaken, onPointedAt } = props;
  const { isRowUnderEnterLit = false, hintOf = null, isOneChoice = false } = props;
  const { idOfRowAskedAgain = null } = props;
  return <>{commands.map((command) => {
      const {
        id,
        label,
        icon,
        keys,
        isUnderEnter,
        isTicked,
        whyNot,
        keepsOpen,
      } = command;
      const description = describe(command);
      const isAskedAgain = id === idOfRowAskedAgain;
      const isConfirmLit = isAskedAgain && isRowUnderEnterLit && isUnderEnter === true && isCommandToConfirm(command);
      const hint = whyNot === null && !isAskedAgain ? (hintOf?.(command) ?? null) : null;
      return (<MenuItemWithWhyOff key={id} data-command={id} icon={icon} {...(keys !== undefined &&
            !isAskedAgain && {
              shortcut: keys,
            })} {...(hint !== null && {
            hint,
          })} {...(isAskedAgain && {
            trailing: <span className="sheet-enter-again -my-[0.125em] max-w-[160px] shrink-0 truncate py-[0.125em] text-footnote">{commandGroupMessages.enterAgainToConfirm()}</span>,
          })} {...(isTicked !== undefined && {
            checked: isTicked,
          })} {...(isTicked !== undefined &&
            isOneChoice && {
              checkedRole: 'radio',
            })} {...(keepsOpen === true && {
            keepOpen: true,
          })} {...(description !== null && {
            description,
            descriptionDir: 'auto',
          })} {...(isConfirmLit && {
            variant: 'danger',
          })} {...(isRowUnderEnterLit &&
            isUnderEnter === true && {
              className: `sheet-row-under-enter${isConfirmLit ? ` ${ROW_ASKS_IN_RED_CLASSES}` : ''}`,
            })} disabled={whyNot !== null} whyOff={whyNot} isPointerCoarse={isPointerCoarse} {...(onPointedAt !== undefined && {
            onFocus: () => onPointedAt(command, true),
            onBlur: () => onPointedAt(command, false),
            onPointerMove: () => onPointedAt(command, true),
            onPointerLeave: () => onPointedAt(command, false),
          })} onClick={(event) => onTaken(command, event.detail === 0)}>{label}</MenuItemWithWhyOff>);
    })}</>;
}
export const NOT_DISABLED_SELECTOR = ':not([aria-disabled="true"])';
export const MENU_ITEM_SELECTOR = '[role^="menuitem"]';
export const DISABLED_COMMAND_SELECTOR = '[data-command][aria-disabled="true"]';
export const ENABLED_MENU_ITEM_SELECTOR = `${MENU_ITEM_SELECTOR}${NOT_DISABLED_SELECTOR}`;
export const MenuWithFieldRenderContext = React.createContext<MenuWithFieldRender | null>(null);
export const isSafariLateEnter = (msSinceComposition: number, vendor: string) =>
  /Apple Computer/.test(vendor) && Math.abs(msSinceComposition) < 500;
export const anchorBottom = (anchor: MenuPopupProps['anchor']) =>
  anchor !== null && typeof anchor === 'object' && 'getBoundingClientRect' in anchor ? anchor.getBoundingClientRect().bottom : 0;
export const bottomPaddingOf = (collisionPadding: MenuPopupProps['collisionPadding']) =>
  typeof collisionPadding === 'number' ? collisionPadding : (collisionPadding?.bottom ?? 5);
export const WIDE_MENU_WIDTH = 392;
export const NARROW_MENU_WIDTH = 272;
export const MENU_EDGE_GAP = 8;
export const MENU_NUDGE = 2;
export const isMenuWide = (rowsShown: { hasRowsFound: boolean; hasRowsAtRest: boolean }) => rowsShown.hasRowsFound || !rowsShown.hasRowsAtRest;
export const wideMenuWidth = (room: number) =>
  Math.min(Math.max(room - MENU_NUDGE - MENU_EDGE_GAP, NARROW_MENU_WIDTH), WIDE_MENU_WIDTH);
export const roomForRows = (top: number, bottom: number) => Math.min(Math.max(bottom - top, 300), 500);
export const isMenuFieldTypingKey = (event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>) => {
  const hasCommandModifier = (event.metaKey || event.ctrlKey) && !event.altKey;
  const isOneCharacter = event.key.length === String.fromCodePoint(event.key.codePointAt(0) ?? 0).length;
  return /^(Escape|Backspace|Delete|Process|Dead|Unidentified)$/.test(event.key) || (isOneCharacter && !hasCommandModifier);
};
export const isClipboardKey = (event: Pick<KeyboardEvent, 'key' | 'code' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey'>) => {
  if (/^(Paste|Copy|Cut)$/.test(event.key)) return true;
  if (event.key === 'Insert') return event.shiftKey || event.ctrlKey;
  const letter = /^[\x20-\x7e]$/.test(event.key) ? event.key.toLowerCase() : event.code.replace(/^Key/, '').toLowerCase();
  const isClipboardLetter = event.shiftKey ? letter === 'v' : /^[acvx]$/.test(letter);
  return (event.ctrlKey || event.metaKey) && !event.altKey && isClipboardLetter;
};
export const takesKeyboardAtOnce = (field: Pick<MenuField, 'takesCaretAtFirst' | 'isRowToTakeKeyboard'> & { isKeyboardYetToCome: boolean }) =>
  field.isKeyboardYetToCome && (field.takesCaretAtFirst || field.isRowToTakeKeyboard === true);
export const POINTER_REST_DISTANCE = 4;
export const POINTER_AT_REST_ATTRIBUTE = 'data-is-pointer-at-rest';
export const isRowWithOpenList = (menu: Element, row: Element) =>
  row.closest('[role="menu"]') === menu && row.getAttribute('aria-expanded') === 'true';
export const enabledCommandRow = (commandId: string, root: Element) =>
  root.querySelector<HTMLElement>(`[data-command="${commandId}"]:not([aria-disabled="true"])`);
export const ROW_ASKS_IN_RED_CLASSES = [
  'sheet-row-asks-in-red',
  'bg-danger-soft',
  'text-danger',
].join(' ');
export type CommentNextRowProps = Omit<React.ComponentProps<typeof AskAgentMenuItems>, 'isCommentNext'>;
export const CommentNextRow = (props: CommentNextRowProps) =>
  <AskAgentMenuItems {...props} isCommentNext />;
