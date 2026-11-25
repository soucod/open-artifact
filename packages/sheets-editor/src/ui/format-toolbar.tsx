import { Menu } from '../kit/menu.tsx';
import { Popover } from '../kit/popover.tsx';
import { Toolbar } from '../kit/toolbar.tsx';
import { Button } from '../kit/button.tsx';
import { Icon } from '../kit/icon.tsx';
import * as React from 'react';
import type { Color, SharedCellFormat } from '@open-artifact/sheets-core';
import type { IconName } from '../kit/icon.tsx';
import type { MenuOpenType, MenuPopupProps } from '../kit/menu.tsx';
import type { PopupPadding } from '../kit/popup-frame.tsx';
import type { TooltipSide } from '../kit/tooltip.tsx';
import type { CaretTarget } from '../tables/own-filter-bar-view.tsx';
import type { MenuOpenChange } from './sheet-tabs/add-sheet.tsx';
import type { MenuField } from './menu-with-field.tsx';
import type { FoundWords } from './search-announcer.tsx';
import type { ToolTriggerHandlers } from './toolbar-tooltip.tsx';
import type { ActHoldHandlers, CustomFormatInList } from '../format/custom-format-row.tsx';
import type { ColorProperty } from '../i18n/format-labels.ts';
import type { ColorPickerChoices } from '../view/page-view.ts';
import type { FormatOfSelection } from '../state/selection-seen.ts';
import type { FontMark } from '../state/initial-state.ts';
import type { FiguresOfNumbers } from '../state/figures-of-selection.ts';
import type { FormatCommand } from '../format/format-commands.ts';
import type { BorderChoice, BorderLine } from '../format/borders.ts';
import type { MergeAct } from '../format/merge-cells.ts';
import type { InsertLinesCommand } from '../edits/insert-lines.ts';
import type { CellControlInPlaceOfFormat, CellControlInsertChoice, WorkbookInFormatMenu } from '../format/number-format-search.tsx';
import type { BarPicker, InsertRowsOrColumnsTools } from './search-menu/bar-commands.tsx';
import type { ContextTool, ContextToolsShape } from './toolbar/context-tools.ts';
import type { ToolOfBarLine } from './toolbar/fold.tsx';
import type { DockedBarChoice } from './docked-bar.tsx';
import { usePopupRoomAtFoot, popupPropsUnderHeader } from '../shell/bottom-insets.ts';
import { isTrustedEscapeClose } from '../app/page-guards.ts';
import { swallowPressAfterItemPress, swallowPressAfterTriggerPress, swallowRestOfPress } from './press-swallow.ts';
import { menuTakesCaretOnSmallTouch } from './menu-initial-focus.ts';
import { isTouchBelowSm, useCoarsePointerMedia } from '../app/media-queries.ts';
import { isGridOrGridPopupTrigger } from '../dom/grid-role.ts';
import { toolbarTabStopOf, useToolbarArrowKeysHint } from './toolbar/keys-hint.tsx';
import { CONTEXT_BAR_PART_ATTRIBUTE, ToolbarTooltip } from './toolbar-tooltip.tsx';
import { TypedSearchAnnouncer } from './search-announcer.tsx';
import { preventMouseDownDefault, wrapTabFocusInBar } from './dom-events.ts';
import { blockRepeatedEnterOrSpace } from './repeated-key-guards.ts';
import { MenuWithField } from './menu-with-field.tsx';
import { useBarIcon, useBarIconSize, BarIconButton, useCoarseBarIconSize, BarSeparator } from './bar-buttons.tsx';
import { SplitTool } from './split-tool.tsx';
import { disabledWithWhyNot } from './why-not.tsx';
import { MenuTriggerButton } from './menu-trigger.tsx';
import { usePopupGivenUpOnBlur } from './popup-given-up-on-blur.ts';
import { sheetMessages, textStyleLabel } from '../i18n/sheet-messages.ts';
import { colorButtonLabel, numberFormatChoiceLabel, bordersButtonLabel, textWrappingButtonLabel } from '../i18n/format-labels.ts';
import { COLOR_POPUP_PADDING, SheetColorPicker } from '../format/color-picker.tsx';
import {
  COLOR_TOOL_ICONS,
  MERGE_TOOL_ICONS,
  INSERT_ROW_COLUMN_TOOLS,
  CHECKBOX_SETTING_TOOLS,
  TEXT_TOGGLE_ICONS,
} from './search-menu/bar-commands.tsx';
import { fillPaintStyle } from '../grid/cell-drawing.tsx';
import { shownCellColor } from '../format/cell-colors.ts';
import { NO_COLOR } from '../model/colors.ts';
import { useBarTooltipSide, DecimalPlacesButton } from './toolbar/decimal-places.tsx';
import {
  useFoldedTools,
  TOOLS_OF_BAR,
  TOOLBAR_LINES,
  toolNeighbours,
  BarTool,
  BAR_FORM_ATTRIBUTE,
  barForm,
  BarToolsProvider,
} from './toolbar/fold.tsx';
import { useSwipedToolRow } from './toolbar/swiped-row.ts';
import { contextToolSlotCount, contextToolsThatFit, contextToolsLeftOver, CONTEXT_TOOLS_IN_ORDER } from './toolbar/context-tools.ts';
import {
  cellControlsInMenuOrder,
  numberFormatIconOf,
  NumberFormatMenuItems,
  SheetSettingsMenuItems,
  CONTEXT_TOOL_OF_CELL_CONTROL,
} from './toolbar/number-format-menu.tsx';
import type { CellTypeOptions } from './toolbar/number-format-menu.tsx';
import { cellTypeOfChoice } from '../format/number-format-choices.ts';
import { useCustomFormatList, CustomFormatListAnnouncer } from '../format/custom-format-row.tsx';
import { numberFormatSearchField } from '../format/number-format-search.tsx';
import { useFontSizeField } from './toolbar/font-size-field.tsx';
import { TOOLS_WITH_PICKERS, submenuOrWhyOff, MoreToolsMenu } from './toolbar/more-menu.tsx';
import { oneRangeActOfCommand } from '../selection/several-ranges.ts';
import { oneRangeNeededText } from '../i18n/notice-labels.ts';
import { SUM_BAR_AGGREGATES } from '../state/transitions.ts';
import { figureNameLabel, insertLinesLabel } from '../i18n/grid-action-labels.ts';
import { MenuItemWithWhyOff } from './menu-item-why-off.tsx';
import { sortAndFilterMessages } from '../tables/sort-filter-labels.ts';
import { CHART_MESSAGES } from '../charts/chart-words.ts';
import { toolUnavailableText } from '../i18n/chip-labels.ts';
import { DockedBarChoices } from './docked-bar.tsx';
import {
  formatToggleShortcut,
  TEXT_ALIGN_ICONS,
  AlignMenuItems,
  FontSizeItems,
  isWrapTextOn,
  wrapTextToggled,
  TextWrappingItems,
} from './toolbar/text-menus.tsx';
import { textWrappingOf } from '../grid/text-overflow.ts';
import { summarizeAreaBorders } from '../grid/borders.ts';
import { BordersOfBlockIcon, BordersPicker } from '../format/borders-picker.tsx';
import { CONDITIONAL_FORMATTING_WORDS } from '../messages/conditional-format.ts';
import { numberFormatButtonLabel, fontSizeButtonLabel, fontSizeText } from '../i18n/menu-labels.ts';
import { DECIMAL_PLACE_CHANGES } from '../format/decimal-places.ts';
/** How a toolbar menu or popover was opened, as its `initialFocus` is told. */
export type PopupOpenType = MenuOpenType | 'touch' | 'pen';
/** What the root of a menu or popover tells when it opens or shuts. */
export interface PopupOpenChangeDetails {
  reason: string;
  event: Event;
}
/** What a menu or popover of the toolbar needs to decide where the caret goes when it opens and shuts. */
export interface ToolbarPopupFocusAsked {
  isOpen: boolean;
  side: TooltipSide;
  onOpenChange: MenuOpenChange;
  whatHasCaretAfter: () => CaretTarget;
  /** Whether what was chosen opens a list under the cell, which then takes the caret. */
  opensListUnderCell?: () => boolean;
  /** A picker opened from this menu is open in its place; shutting the menu then moves the caret only if it was opened by key. */
  isPickerInItsPlace?: boolean;
  toolbar: React.RefObject<HTMLElement | null>;
  anchor?: React.RefObject<HTMLElement | null>;
  isAskedByKey?: () => boolean;
  isAskedByKeyFromCells?: () => boolean;
  takesCaretAtOnce?: boolean;
  isMenu?: boolean;
}
/** The field of a toolbar menu, before the menu adds what only it knows. */
export interface ToolbarMenuField extends Omit<MenuField, 'takesCaretAtFirst' | 'onShutByEnter'> {
  /** What is said of the rows found for the typed text, with their count or without. */
  saidOf: (typed: string, isCounted: boolean) => FoundWords;
  handlers?: ActHoldHandlers;
  /** Takes a key before the menu does; true when it did. */
  takeKeyFirst?: (event: React.KeyboardEvent) => boolean;
}
export interface ToolbarMenuProps extends Omit<ToolbarPopupFocusAsked, 'takesCaretAtOnce' | 'isMenu'> {
  button: React.ReactElement<ToolTriggerHandlers>;
  /** The name the tooltip of the button shows, or null for no tooltip. */
  tooltip: string | null;
  isTooltipShut?: boolean;
  tooltipSide?: TooltipSide;
  placedBy?: Pick<MenuPopupProps, 'align' | 'anchor'>;
  isOfContextBar?: boolean | 'more';
  field?: ToolbarMenuField;
  children: React.ReactNode;
}
export interface SplitToolButtonProps extends Omit<ToolbarMenuProps, 'button' | 'tooltip' | 'isTooltipShut' | 'placedBy' | 'isOfContextBar' | 'field'> {
  icon: IconName;
  label: string;
  shortcut?: string;
  pressed?: boolean;
  whyNot: string | null;
  /** The caret goes back to the sheet once a row of the list is chosen. */
  leavesFocusToSheet?: boolean;
  onPress: () => void;
  listLabel: string;
}
export interface ToolbarPopoverProps extends Omit<ToolbarPopupFocusAsked, 'isMenu'> {
  name: string;
  buttonLabel: string;
  icon: IconName | React.ReactElement;
  whyNot: string | null;
  isLit?: boolean;
  padding?: PopupPadding;
  tooltipSide?: TooltipSide;
  children: React.ReactNode;
}
export interface ColorToolPopoverProps extends Omit<ToolbarPopoverProps, 'name' | 'buttonLabel' | 'icon' | 'padding' | 'children'> {
  property: ColorProperty;
  shared: SharedCellFormat;
  whatColorPickerShows: () => ColorPickerChoices;
  onChosen: (color: Color) => void;
}
export interface HideableBarToolProps {
  isShown: boolean;
  hasNoButtonWhileHidden?: boolean;
  children: React.ReactNode;
}
export interface MergeCellsButtonProps {
  change: MergeAct;
  whyNot: string | null;
  onChosen: (change: MergeAct) => void;
}
export interface MoreOfRowCaretProps {
  at: 'start' | 'end';
}
/** The line drawn with the text, which shares one tool on the bar. */
export type LineOfTextMark = Extract<FontMark, 'underline' | 'strikethrough'>;
/** How a picker of the toolbar was asked for from the cells' menu, if it was. */
export type PickerAskedInCellsMenuBy = 'key' | 'pointer' | null;
export interface FormattingToolbarProps {
  ref?: React.Ref<HTMLDivElement>;
  whyNoToolForCells: string | null;
  formatOfSelection: FormatOfSelection;
  sectionShows: ContextToolsShape;
  onSectionRestedOn: (isRestedOn: boolean) => void;
  arePeopleSelected: boolean;
  selectedRowCount: number;
  selectedColumnCount: number;
  canMergeSelection: boolean;
  canUnmergeSelection: boolean;
  isOneRangeNeeded: boolean;
  onMergeChangeChosen: (change: MergeAct) => void;
  onCheckboxesSet: (isChecking: boolean) => void;
  onSheetChangeChosen: (change: InsertLinesCommand) => void;
  canWriteFigures: boolean;
  onFigureChosen: (figure: keyof FiguresOfNumbers) => void;
  isPaneOfDropdownOpen: boolean;
  canDropdownBeRemoved: boolean;
  onPaneOfDropdownAsked: () => void;
  /** The menu of the bar that is open, by its tool. */
  openMenu: string | null;
  isSwipedRow: boolean;
  isEntryOpen: boolean;
  isSheetMenuOpen: boolean;
  onFormatChosen: (command: FormatCommand) => void;
  onChosenByOwnTool: (format: 'currency' | 'percent') => void;
  workbookInFormatMenu: WorkbookInFormatMenu;
  formatInList: CustomFormatInList;
  borderPen: BorderLine;
  onBordersChosen: (choice: BorderChoice) => void;
  onBorderPenChanged: (change: Partial<BorderLine>) => void;
  areGridlinesHidden: boolean;
  onGridlinesToggled: () => void;
  whatColorPickerShows: () => ColorPickerChoices;
  onMenuOpenChange: (menu: string, isOpen: boolean, event: Event | null) => void;
  howPickerWasAskedInCellsMenu: () => PickerAskedInCellsMenuBy;
  onSheetMenuAsked: (button: HTMLElement, isByKey: boolean) => void;
  areConditionalFormatsOpen: boolean;
  onConditionalFormatsAsked: (by: 'button' | 'menu') => void;
  isPickerAskedByKeyRef: React.RefObject<boolean>;
  cardOfConditionalFormats: React.ReactNode;
  cardOfChart: React.ReactNode;
  cardOfSortAndFilter: React.ReactNode;
  isSortAndFilterOnBar: boolean;
  whyNoChart: string | null;
  whatHasCaretAfterMenu: () => CaretTarget;
  onKeyDown: React.KeyboardEventHandler<HTMLDivElement>;
  comment?: React.ReactNode;
  inserts: CellControlInsertChoice[];
  onInsertChosen: (what: CellControlInPlaceOfFormat) => void;
}
export let insertColumnsTool: InsertRowsOrColumnsTools;
export let insertRowsTool: InsertRowsOrColumnsTools;
export function useToolbarPopupFocus({
  isOpen,
  side,
  onOpenChange,
  whatHasCaretAfter,
  opensListUnderCell = () => false,
  isPickerInItsPlace = false,
  toolbar,
  anchor,
  isAskedByKey = () => false,
  isAskedByKeyFromCells = () => false,
  takesCaretAtOnce = false,
  isMenu = false,
}: ToolbarPopupFocusAsked) {
  let takesCaretNow = takesCaretAtOnce && !isMenu;
  let aboveComposer = usePopupRoomAtFoot(isOpen && side === 'top', () => toolbar.current, takesCaretNow);
  let pressedTargetRef = React.useRef<EventTarget | null>(null);
  let wasOpenedByKeyRef = React.useRef(false);
  let wasAskedFromCellsRef = React.useRef(false);
  let wasOutsidePressRef = React.useRef(false);
  let closeOnUnmount = React.useEffectEvent(() => {
    if (isOpen) onOpenChange(false, null);
  });
  React.useEffect(() => () => closeOnUnmount(), []);
  let [timesLeftOpen, setTimesLeftOpen] = React.useState(0);
  let leaveOnBlur = React.useEffectEvent((event: FocusEvent) => {
    if (!isOpen || takesCaretNow) return;
    setTimesLeftOpen((times) => times + 1);
    onOpenChange(false, event);
  });
  React.useEffect(() => {
    let view = toolbar.current?.ownerDocument.defaultView ?? null;
    if (view === null) return;
    let onBlur = (event: FocusEvent) => leaveOnBlur(event);
    view.addEventListener('blur', onBlur);
    return () => view.removeEventListener('blur', onBlur);
  }, [toolbar]);
  return {
    timesLeftOpen,
    wasOpenedByKey: () => wasOpenedByKeyRef.current,
    aboveComposer: aboveComposer ?? popupPropsUnderHeader(),
    onRootOpenChange: (open: boolean, { reason, event }: PopupOpenChangeDetails) => {
      pressedTargetRef.current = isTrustedEscapeClose(reason, event) ? event.target : null;
      wasOutsidePressRef.current = reason === 'outside-press';
      swallowPressAfterItemPress(reason, event);
      if (menuTakesCaretOnSmallTouch(toolbar.current) || (takesCaretNow && isTouchBelowSm())) swallowPressAfterTriggerPress(reason, event);
      onOpenChange(open, event);
    },
    initialFocus: (openedBy: PopupOpenType) => {
      pressedTargetRef.current = null;
      wasOutsidePressRef.current = false;
      wasAskedFromCellsRef.current = isAskedByKeyFromCells();
      wasOpenedByKeyRef.current = openedBy === 'keyboard' || isAskedByKey() || wasAskedFromCellsRef.current;
      if (wasOpenedByKeyRef.current || takesCaretAtOnce) return true;
      return menuTakesCaretOnSmallTouch(toolbar.current);
    },
    finalFocus: () => {
      if (isPickerInItsPlace && !wasOpenedByKeyRef.current) return false;
      let caretAfter = whatHasCaretAfter();
      if (wasAskedFromCellsRef.current) return caretAfter;
      let pressedTarget = pressedTargetRef.current;
      let goesBackToGrid = wasOpenedByKeyRef.current && !wasOutsidePressRef.current && isCaretBackToGrid(caretAfter, opensListUnderCell());
      let caretGoesElsewhere = (pressedTarget !== null && pressedTarget !== caretAfter) || goesBackToGrid;
      let isNotGridElement = caretAfter !== false && !isGridOrGridPopupTrigger(caretAfter);
      let isTakenAtOnce = takesCaretAtOnce && !wasOpenedByKeyRef.current;
      if (!caretGoesElsewhere || isTakenAtOnce || (isNotGridElement && !wasOpenedByKeyRef.current)) return caretAfter;
      if (!wasOpenedByKeyRef.current) return anchor?.current ?? true;
      return toolbarTabStopOf(toolbar.current) ?? true;
    },
  };
}
export function ToolbarMenu({
  isOpen,
  button,
  tooltip,
  isTooltipShut = false,
  side,
  tooltipSide = side,
  placedBy,
  isOfContextBar,
  field,
  children,
  ...rest
}: ToolbarMenuProps) {
  let isPointerCoarse = useCoarsePointerMedia();
  let {
    timesLeftOpen,
    onRootOpenChange,
    wasOpenedByKey,
    aboveComposer,
    ...focusProps
  } = useToolbarPopupFocus({
    isOpen,
    side,
    ...rest,
    ...(field !== undefined && {
      takesCaretAtOnce: !isPointerCoarse,
      isMenu: true,
    }),
  });
  let popupProps = {
    side,
    ...aboveComposer,
    ...placedBy,
    ...focusProps,
    [CONTEXT_BAR_PART_ATTRIBUTE]: isOfContextBar,
  };
  let typed = field?.typed ?? '';
  let [shownTyped, setShownTyped] = React.useState(typed);
  if (isOpen && shownTyped !== typed) setShownTyped(typed);
  return <Menu.Root key={timesLeftOpen} modal={false} open={isOpen} onOpenChange={onRootOpenChange} onOpenChangeComplete={(isNowOpen) => {
        if (!isNowOpen) setShownTyped('');
      }}>{field !== undefined &&
          <TypedSearchAnnouncer typed={field.typed} found={(isNotComposing) => isOpen && field.saidOf(field.typed, isNotComposing)} />}{tooltip === null
          ? button
          : <ToolbarTooltip name={tooltip} side={tooltipSide} isShut={isOpen || isTooltipShut}>{button}</ToolbarTooltip>}{field === undefined
          ? <Menu.Popup {...popupProps} onMouseDown={preventMouseDownDefault} onKeyDownCapture={blockRepeatedEnterOrSpace}>{children}</Menu.Popup>
          : (<MenuWithField {...popupProps} isAtTool {...field.handlers} field={{
                ...field,
                renderRowsFor: (typedNow: string, ...restArgs: []) =>
                  field.renderRowsFor(isOpen ? typedNow : shownTyped, ...restArgs),
                takesCaretAtFirst: isOpen,
                onShutByEnter: () => rest.onOpenChange(false, null),
              }} onMouseDownCapture={(event) => {
                if (event.target instanceof HTMLInputElement) event.stopPropagation();
              }} onKeyDownCapture={(event) => {
                field.handlers?.onKeyDownCapture(event);
                if (field.takeKeyFirst?.(event) === true) {
                  event.preventDefault();
                  event.stopPropagation();
                  return;
                }
                blockRepeatedEnterOrSpace(event);
                if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                let clearsTyped = event.key === 'Escape' && field.typed.trim() !== '';
                let leavesByTab = event.key === 'Tab' && !wasOpenedByKey();
                if (!clearsTyped && !leavesByTab) return;
                event.preventDefault();
                event.stopPropagation();
                if (leavesByTab) {
                  rest.onOpenChange(false, null);
                  return;
                }
                field.onTyped('');
                event.currentTarget.querySelector('input')?.focus({
                  preventScroll: true,
                });
              }}>{children}</MenuWithField>)}</Menu.Root>;
}
export function SplitToolButton({
  icon,
  label,
  shortcut,
  pressed,
  whyNot,
  leavesFocusToSheet,
  onPress,
  listLabel,
  side,
  tooltipSide = side,
  children,
  ...rest
}: SplitToolButtonProps) {
  let anchorRef = React.useRef<HTMLElement | null>(null);
  let setAnchor = React.useCallback((element: HTMLElement | null) => {
    anchorRef.current = element;
  }, []);
  let iconOf = useBarIcon();
  let hasFace = !useCoarsePointerMedia() || whyNot !== null;
  return <SplitTool ref={setAnchor} label={label} hasFace={hasFace}>{hasFace &&
        (<ToolbarTooltip name={label} shortcut={shortcut} side={tooltipSide} isShut={rest.isOpen || whyNot !== null}><Button variant="ghost" iconOnly icon={iconOf(icon, pressed)} aria-label={label} tooltip={false} {...(shortcut !== undefined && {
              shortcut,
            })} {...(pressed !== undefined && {
              pressed,
            })} {...disabledWithWhyNot(label, whyNot, tooltipSide)} onClick={onPress} /></ToolbarTooltip>)}<ToolbarMenu {...rest} isOfContextBar side={side} tooltipSide={tooltipSide} placedBy={{
          align: 'start',
          anchor: anchorRef,
        }} {...(leavesFocusToSheet === true && {
          opensListUnderCell: () => true,
        })} tooltip={listLabel} button={<MenuTriggerButton variant="ghost" aria-label={listLabel} chevron="barAtSelection" {...disabledWithWhyNot(listLabel, whyNot, tooltipSide)} {...(hasFace
            ? {
                className: 'w-4 px-0',
              }
            : {
                icon: iconOf(icon, pressed),
                ...(pressed !== undefined && {
                  pressed,
                }),
                className: 'ps-2.5 pe-1.5',
              })}>{null}</MenuTriggerButton>}>{children}</ToolbarMenu></SplitTool>;
}
export function ToolbarPopover({
  isOpen,
  name,
  buttonLabel,
  icon,
  whyNot,
  isLit,
  padding = 'sm',
  anchor,
  side,
  tooltipSide = side,
  children,
  ...rest
}: ToolbarPopoverProps) {
  let iconOf = useBarIcon();
  let {
    timesLeftOpen,
    onRootOpenChange,
    initialFocus,
    finalFocus,
    aboveComposer,
  } = useToolbarPopupFocus({
    isOpen,
    side,
    ...(anchor !== undefined && {
      anchor,
    }),
    ...rest,
  });
  let {
    isGivenUp,
    holdPopup,
    noteFocus,
  } = usePopupGivenUpOnBlur(isOpen && rest.takesCaretAtOnce === true, () => rest.onOpenChange(false, null));
  let setPopup = holdPopup;
  return <Popover.Root key={timesLeftOpen} open={isOpen && !isGivenUp} onOpenChange={onRootOpenChange}>{anchor === undefined &&
          (<ToolbarTooltip name={name} side={tooltipSide} isShut={isOpen || whyNot !== null}><Popover.Trigger disabled={whyNot !== null} render={<Button variant="ghost" iconOnly aria-label={buttonLabel} tooltip={false} icon={typeof icon === 'string' ? iconOf(icon, isLit) : icon} {...disabledWithWhyNot(buttonLabel, whyNot, tooltipSide)} {...(isLit !== undefined && {
                  pressed: isLit,
                })} />} /></ToolbarTooltip>)}<Popover.Popup ref={setPopup} {...(anchor !== undefined && {
            anchor,
          })} side={side} {...aboveComposer} {...(rest.takesCaretAtOnce === true && {
            align: anchor === undefined ? 'start' : 'end',
            collisionAvoidance: {
              side: 'none',
              align: 'shift',
              fallbackAxisSide: 'none',
            },
          })} padding={padding} aria-label={name} initialFocus={initialFocus} finalFocus={finalFocus} keepFocus onFocus={noteFocus} {...{
            [CONTEXT_BAR_PART_ATTRIBUTE]: true,
          }} onMouseDown={(event) => event.stopPropagation()} onKeyDown={wrapTabFocusInBar}>{children}</Popover.Popup></Popover.Root>;
}
export function ColorToolPopover({
  property,
  shared,
  whatColorPickerShows,
  onChosen,
  ...rest
}: ColorToolPopoverProps) {
  let iconSize = useBarIconSize();
  let [color, otherColor] = property === 'fillColor' ? [shared.fillColor, shared.font.color] : [shared.font.color, shared.fillColor];
  return <ToolbarPopover {...rest} name={property === 'fillColor' ? sheetMessages.cellColor() : sheetMessages.textColor()} buttonLabel={colorButtonLabel(property, color)} padding={COLOR_POPUP_PADDING} icon={<span className="sheet-color-glyph"><Icon name={COLOR_TOOL_ICONS[property]} size={iconSize} /><span className="sheet-color-bar" data-has-fill={(color !== null && color.kind !== 'none') || undefined} data-is-mixed={color === null || undefined} style={fillPaintStyle(color === null ? null : shownCellColor(property, color, otherColor ?? NO_COLOR))} /></span>}><SheetColorPicker property={property} color={color} whatIsColored={{
        kind: 'cells',
        otherColor,
      }} whatItShows={whatColorPickerShows} onChosen={onChosen} onDone={() => rest.onOpenChange(false, null)} /></ToolbarPopover>;
}
export function HideableBarTool({ isShown, hasNoButtonWhileHidden = false, children }: HideableBarToolProps) {
  let wrapperRef = React.useRef<HTMLSpanElement>(null);
  React.useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (isShown || wrapper === null || !wrapper.contains(wrapper.ownerDocument.activeElement)) return;
    let section = wrapper.closest('.sheet-section-of-bar');
    let enabledButtons = Array.from<HTMLButtonElement>(section?.querySelectorAll<HTMLButtonElement>('[data-tool]:not([hidden]) button:enabled') ?? []);
    let isAfter = (button: HTMLButtonElement) => (wrapper.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    (enabledButtons.find(isAfter) ?? enabledButtons.at(-1) ?? section?.previousElementSibling?.querySelector('button'))?.focus({
      preventScroll: true,
    });
  }, [isShown]);
  if (!isShown && !CAN_CHECK_VISIBILITY && !hasNoButtonWhileHidden) return null;
  return <span ref={wrapperRef} hidden={!isShown} className="contents">{children}</span>;
}
export const CHEVRON_BUTTON_PADDING = {
  className: 'not-pointer-coarse:ps-2 not-pointer-coarse:pe-1 not-pointer-coarse:[@media(hover:hover)]:pe-0',
};
export const FONT_SIZE_BUTTON_PADDING = {
  className: `${CHEVRON_BUTTON_PADDING.className} not-pointer-coarse:[@media(hover:hover)]:ps-1`,
};
export const TOOLBAR_POPUP_SIDE: TooltipSide = 'top';
export const isCaretBackToGrid = (caretAfter: CaretTarget, opensListUnderCell: boolean) =>
  caretAfter !== false && isGridOrGridPopupTrigger(caretAfter) && !opensListUnderCell;
export const CAN_CHECK_VISIBILITY = typeof Element === 'undefined' || 'checkVisibility' in Element.prototype;
export const MergeCellsButton = React.memo(function ({ change, whyNot, onChosen }: MergeCellsButtonProps) {
  let tooltipSide = useBarTooltipSide();
  let choose = React.useCallback(() => onChosen(change), [change, onChosen]);
  return <BarIconButton icon={MERGE_TOOL_ICONS[change]} label={sheetMessages[change]()} tooltipSide={tooltipSide} whyNot={whyNot} onClick={choose} />;
});
export const LINE_OF_TEXT_TOGGLES: LineOfTextMark[] = ['underline', 'strikethrough'];
export const MoreOfRowCaret = ({ at }: MoreOfRowCaretProps) =>
  <span aria-hidden className="sheet-more-of-row" data-at={at}><Icon name={at === 'start' ? 'CaretLeft' : 'CaretRight'} size="sm" /></span>;
export const FOLDED_CHOICE_LABELS: Record<DockedBarChoice, () => string> = {
  align: sheetMessages.align,
  fontSize: sheetMessages.fontSize,
  numberFormat: sheetMessages.cellType,
  textColor: sheetMessages.textColor,
  fillColor: sheetMessages.cellColor,
};
export const INSERT_TOOL_OF_CHIP: Record<CellControlInPlaceOfFormat, ContextTool> = {
  dropdown: 'insertDropdown',
  person: 'insertPerson',
  date: 'insertDate',
  checkbox: 'insertCheckbox',
};
[insertColumnsTool, insertRowsTool] = INSERT_ROW_COLUMN_TOOLS;
/** Whether the pointer or the caret rests on the part of the bar that changes with the selection. */
interface SectionRestedOn {
  pointer: boolean;
  focus: boolean;
}
export const FormattingToolbar = React.memo(function ({
  ref,
  whyNoToolForCells,
  formatOfSelection,
  formatOfSelection: {
    shared,
    togglesOn,
    numberFormat,
    decimalPlaces,
    formatsThatFit,
    alignmentOfActiveCellAsDrawn,
    bordersOfBlock,
    areBordersOfBlockFromSample,
    checkboxesToSet,
  },
  sectionShows,
  onSectionRestedOn,
  arePeopleSelected,
  selectedRowCount,
  selectedColumnCount,
  canMergeSelection,
  canUnmergeSelection,
  isOneRangeNeeded,
  onMergeChangeChosen,
  onCheckboxesSet,
  onSheetChangeChosen,
  canWriteFigures,
  onFigureChosen,
  isPaneOfDropdownOpen,
  canDropdownBeRemoved,
  onPaneOfDropdownAsked,
  openMenu,
  isSwipedRow,
  isEntryOpen,
  isSheetMenuOpen,
  onFormatChosen,
  onChosenByOwnTool,
  workbookInFormatMenu,
  formatInList,
  borderPen,
  onBordersChosen,
  onBorderPenChanged,
  areGridlinesHidden,
  onGridlinesToggled,
  whatColorPickerShows,
  onMenuOpenChange,
  howPickerWasAskedInCellsMenu,
  onSheetMenuAsked,
  areConditionalFormatsOpen,
  onConditionalFormatsAsked,
  isPickerAskedByKeyRef,
  cardOfConditionalFormats,
  cardOfChart,
  cardOfSortAndFilter,
  isSortAndFilterOnBar,
  whyNoChart,
  whatHasCaretAfterMenu,
  onKeyDown,
  comment = null,
  inserts,
  onInsertChosen,
}: FormattingToolbarProps) {
  let tooltipSide = useBarTooltipSide();
  let barSize = useCoarseBarIconSize();
  let isPointerCoarse = useCoarsePointerMedia();
  let barIcon = useBarIcon();
  let scrollerRef = React.useRef<HTMLDivElement>(null);
  let toolsOffBar = useFoldedTools({
    scroller: scrollerRef,
    isBusy: openMenu !== null || isSheetMenuOpen,
    isSwipedRow,
  });
  let closeMenu = React.useCallback((menu: string) => onMenuOpenChange(menu, false, null), [onMenuOpenChange]);
  let {
    choicesInPlace,
    goBackToTools,
    showAllChoices,
    noteFocusAsChoicesGo,
    ofScroller,
  } = useSwipedToolRow({
    isSwipedRow,
    isEntryOpen,
    openMenu,
    scrollerRef,
    closeMenu,
  });
  let menuOpenOnBar = choicesInPlace === null ? openMenu : null;
  let sectionRoom = contextToolSlotCount(toolsOffBar, isSwipedRow);
  let fitOptions = React.useMemo(
    () => ({
      isByFinger: isPointerCoarse,
      hasSortAndFilter: isSortAndFilterOnBar,
      formatsThatFit,
    }),
    [isPointerCoarse, isSortAndFilterOnBar, formatsThatFit],
  );
  let sectionTools = React.useMemo(
    () => contextToolsThatFit(sectionShows, sectionRoom, fitOptions),
    [sectionShows, sectionRoom, fitOptions],
  );
  let foldedTools = React.useMemo(
    () =>
      contextToolsLeftOver(sectionShows, sectionRoom, fitOptions).filter(
        (tool) => !(tool === 'wrapText' && sectionShows === 'mergedOnly'),
      ),
    [sectionShows, sectionRoom, fitOptions],
  );
  let barTools = React.useMemo(() => TOOLS_OF_BAR.filter((tool) => !toolsOffBar.includes(tool)), [toolsOffBar]);
  let toolsWithButton = React.useMemo(() => [...barTools, ...sectionTools], [barTools, sectionTools]);
  let barToolsWithEnd = React.useMemo(() => [...barTools, ...CONTEXT_TOOLS_IN_ORDER], [barTools]);
  let moreButtonRef = React.useRef<HTMLElement>(null);
  let clickedToolRef = React.useRef<Element | false | null>(null);
  let sectionRef = React.useCallback(
    (section: HTMLSpanElement) => {
      let restState: SectionRestedOn = {
        pointer: false,
        focus: false,
      };
      let noteRest = (change: Partial<SectionRestedOn>) => {
        Object.assign(restState, change);
        onSectionRestedOn(restState.pointer || restState.focus);
      };
      let controller = new AbortController();
      let listen = (eventType: 'pointerenter' | 'pointerleave' | 'focusin' | 'focusout', restOf: (event: Event) => Partial<SectionRestedOn>) =>
        section.addEventListener(eventType, (event) => noteRest(restOf(event)), {
          signal: controller.signal,
        });
      listen(
        'pointerenter',
        () => ({
          pointer: true,
        }),
      );
      listen(
        'pointerleave',
        () => ({
          pointer: false,
        }),
      );
      listen(
        'focusin',
        () => ({
          focus: true,
        }),
      );
      listen(
        'focusout',
        (event) => ({
          focus: section.contains(
            event instanceof FocusEvent && event.relatedTarget instanceof Node ? event.relatedTarget : section.ownerDocument.activeElement,
          ),
        }),
      );
      return () => {
        controller.abort();
        noteRest({
          pointer: false,
          focus: false,
        });
      };
    },
    [onSectionRestedOn],
  );
  let opensListUnderCellRef = React.useRef(false);
  let onInsertChosenNoting = React.useCallback(
    (chip: CellControlInPlaceOfFormat) => {
      opensListUnderCellRef.current = chip === 'dropdown';
      onInsertChosen(chip);
    },
    [onInsertChosen],
  );
  let inPlaceOfFormat = React.useMemo(() => cellControlsInMenuOrder(inserts), [inserts]);
  let numberFormatOptions = React.useMemo(
    (): CellTypeOptions => ({
      decimalPlaces,
      checkboxesToSet,
      areSeveralCheckboxes: sectionShows === 'checkboxes',
      isPaneOfDropdownOpen,
      canDropdownBeRemoved,
      onStepChosen: (step) =>
        onFormatChosen({
          stepOfDecimalPlaces: step,
        }),
      onCheckboxesSet,
      onPaneOfDropdownAsked,
    }),
    [decimalPlaces, checkboxesToSet, sectionShows, isPaneOfDropdownOpen, canDropdownBeRemoved, onFormatChosen, onCheckboxesSet, onPaneOfDropdownAsked],
  );
  const numberFormatChoice = arePeopleSelected ? 'person' : numberFormat.choice;
  const numberFormatName = arePeopleSelected ? 'person' : numberFormat.name;
  let hasCellControl = shared.cellControl?.kind !== 'none';
  let formatList = useCustomFormatList(formatInList, !hasCellControl);
  let formatField = numberFormatSearchField({
    written: formatList,
    choiceOfSelection: numberFormatChoice,
    inPlaceOfFormat,
    onInsertChosen: onInsertChosenNoting,
    areFormatsOnOffer: formatsThatFit.includes('general'),
    formatsThatFit,
    doesFormatTakeControlOff: hasCellControl,
    onChosen: onFormatChosen,
    workbookInFormatMenu,
    patternOfSelection: shared.numberFormat?.pattern ?? null,
    isPointerCoarse,
  });
  let fontSizeField = useFontSizeField({
    shared,
    onChosen: onFormatChosen,
  });
  let pickerAnchorOf = (tool: BarPicker) =>
    !toolsWithButton.includes(tool)
      ? {
          anchor: moreButtonRef,
          isAskedByKey: () => howPickerWasAskedInCellsMenu() === null && isPickerAskedByKeyRef.current,
          isAskedByKeyFromCells: () => howPickerWasAskedInCellsMenu() === 'key',
        }
      : {
          isAskedByKeyFromCells: () => howPickerWasAskedInCellsMenu() === 'key',
        };
  let isPickerOfMoreOpen = ([...TOOLS_WITH_PICKERS, 'sort'] satisfies BarPicker[]).some(
    (tool) => tool === openMenu && !toolsWithButton.includes(tool),
  );
  let hasComment = comment !== null;
  let barRows = React.useMemo(
    () =>
      TOOLBAR_LINES.map(
        (row) =>
          row.flatMap((tool) => {
            if (tool === 'section') return sectionTools;
            return toolsOffBar.includes(tool) ? [] : [tool];
          }),
      ),
    [toolsOffBar, sectionTools],
  );
  let besides = React.useMemo(() => toolNeighbours(barRows, hasComment ? 'tool' : 'end'), [barRows, hasComment]);
  let separatorBefore = (tool: ToolOfBarLine) => {
    let rowIndex = TOOLBAR_LINES.findIndex((row) => row.includes(tool));
    let rowsShown = barRows.map(({ length: rowLength }) => rowLength > 0);
    return <BarSeparator isHidden={rowsShown[rowIndex] !== true || !rowsShown.slice(0, rowIndex).includes(true)} />;
  };
  let whyNoFigure = canWriteFigures
    ? null
    : selectedColumnCount > 1
      ? sheetMessages.oneColumnNeededForFigure()
      : sheetMessages.noRoomForFigure();
  let whyNoSheetChange = (change: InsertLinesCommand) => {
    let range = isOneRangeNeeded ? oneRangeActOfCommand(change) : null;
    return range === null ? null : oneRangeNeededText(range);
  };
  let returnCaret = () => {
    let caretAfter = whatHasCaretAfterMenu();
    if (caretAfter !== false)
      caretAfter.focus({
        preventScroll: true,
      });
  };
  let notingListUnderCell =
    (act: () => void) =>
    () => {
      opensListUnderCellRef.current = true;
      act();
    };
  let figureItems = SUM_BAR_AGGREGATES.map(
    (figure) =>
      <Menu.Item key={figure} onClick={notingListUnderCell(() => onFigureChosen(figure))}>{figureNameLabel(figure)}</Menu.Item>,
  );
  let countOf = (of: InsertRowsOrColumnsTools['of']) => (of === 'columns' ? selectedColumnCount : selectedRowCount);
  let sheetChangeItems = ({ of, first, second }: InsertRowsOrColumnsTools) =>
    [first, second].map(
      ({ change, icon, inWords }) =>
        <MenuItemWithWhyOff key={change} icon={icon} disabled={whyNoSheetChange(change) !== null} whyOff={whyNoSheetChange(change)} onClick={() => onSheetChangeChosen(change)}>{inWords(countOf(of))}</MenuItemWithWhyOff>,
    );
  let sheetChangeSubmenu = ({ of, first, second }: InsertRowsOrColumnsTools) =>
    submenuOrWhyOff(
      of === 'rows' ? sheetMessages.insertRows() : sheetMessages.insertColumns(),
      whyNoToolForCells ?? whyNoSheetChange(first.change),
      <>{[first, second].map(
          ({ change, icon, inListInWords }) =>
            <Menu.Item key={change} icon={icon} onClick={() => onSheetChangeChosen(change)}>{inListInWords(countOf(of))}</Menu.Item>,
        )}</>,
    );
  let insertToolOfSection = sectionShows === 'rows' ? insertRowsTool : sectionShows === 'columns' ? insertColumnsTool : null;
  let rowsThatInsertLines =
    insertToolOfSection === null
      ? <>{sheetChangeSubmenu(insertRowsTool)}{sheetChangeSubmenu(insertColumnsTool)}</>
      : toolsWithButton.includes(insertToolOfSection.insert)
        ? null
        : sheetChangeSubmenu(insertToolOfSection);
  let whyNoWrap = sectionShows === 'mergedOnly' ? sheetMessages.mergedCellsDoNotWrap() : null;
  let onNumberFormatTool = (format: 'currency' | 'percent') => {
    onFormatChosen({
      numberFormatChoice: format,
    });
    onChosenByOwnTool(format);
  };
  let rowWhileFolded = (tool: ContextTool) => {
    switch (tool) {
      case 'currency':
      case 'percent':
        return <Menu.Item onClick={() => onNumberFormatTool(tool)}>{numberFormatChoiceLabel(tool)}</Menu.Item>;
      case 'sum':
        return submenuOrWhyOff(
          sheetMessages.calculations(),
          whyNoFigure,
          <>{figureItems}</>,
        );
      case 'sort':
        return <Menu.Item onClick={(event) => {
            swallowRestOfPress(event);
            isPickerAskedByKeyRef.current = event.detail === 0;
            onMenuOpenChange('sort', true, null);
          }}>{sortAndFilterMessages.sortAndFilter()}</Menu.Item>;
      case 'optionsOfDropdown':
        return <Menu.Item checked={isPaneOfDropdownOpen} onClick={onPaneOfDropdownAsked}>{sheetMessages.optionsOfDropdownInFull()}</Menu.Item>;
      case 'checkAll':
      case 'uncheckAll': {
        let { isChecking, inWords, whyNot } = CHECKBOX_SETTING_TOOLS[tool];
        return <MenuItemWithWhyOff disabled={whyNot(checkboxesToSet) !== null} whyOff={whyNot(checkboxesToSet)} onClick={() => onCheckboxesSet(isChecking)}>{inWords()}</MenuItemWithWhyOff>;
      }
    }
  };
  let whyNoChartNow = whyNoToolForCells ?? whyNoChart;
  let chartTool = <BarTool tool="chart" isDrawnWithNoButton><ToolbarPopover {...pickerAnchorOf('chart')} isOpen={openMenu === 'chart'} whyNot={whyNoChartNow} name={CHART_MESSAGES.insertChart()} buttonLabel={CHART_MESSAGES.insertChart()} icon="Chart" padding="none" takesCaretAtOnce side={TOOLBAR_POPUP_SIDE} tooltipSide={tooltipSide} onOpenChange={(isOpen, event) => {
        if (isOpen || !(event instanceof MouseEvent && event.detail > 1)) onMenuOpenChange('chart', isOpen, event);
      }} whatHasCaretAfter={whatHasCaretAfterMenu} toolbar={scrollerRef}>{cardOfChart}</ToolbarPopover></BarTool>;
  let sortTool = <ToolbarPopover {...pickerAnchorOf('sort')} isOpen={openMenu === 'sort'} whyNot={whyNoToolForCells} name={sortAndFilterMessages.sortAndFilter()} buttonLabel={sortAndFilterMessages.sortAndFilter()} icon="FilterLines" padding="none" takesCaretAtOnce side={TOOLBAR_POPUP_SIDE} tooltipSide={tooltipSide} onOpenChange={(isOpen, event) => {
      if (isOpen || !(event instanceof MouseEvent && event.detail > 1)) onMenuOpenChange('sort', isOpen, event);
    }} whatHasCaretAfter={whatHasCaretAfterMenu} toolbar={scrollerRef}>{cardOfSortAndFilter}</ToolbarPopover>;
  let sectionTool = (tool: ContextTool, children: React.ReactNode) =>
    <BarTool key={tool} tool={tool} isDrawn={sectionTools.includes(tool)}><HideableBarTool isShown={sectionTools.includes(tool)}>{children}</HideableBarTool></BarTool>;
  let insertTool = ({ what, icon, label, fits, whyNotNow }: CellControlInsertChoice, toolLabel: string) =>
    <BarIconButton icon={icon} label={toolLabel} tooltipSide={tooltipSide} whyNot={whyNoToolForCells ?? (fits ? (whyNotNow ?? null) : toolUnavailableText(label))} onClick={() => {
        onInsertChosen(what);
        returnCaret();
      }} />;
  let menuPropsOf = (menu: string) => ({
    isOpen: openMenu === menu,
    onOpenChange: (isOpen: boolean, event: Event | null) => onMenuOpenChange(menu, isOpen, event),
    whatHasCaretAfter: whatHasCaretAfterMenu,
    toolbar: scrollerRef,
    side: TOOLBAR_POPUP_SIDE,
    tooltipSide,
  });
  let [lineOfText, setLineOfText] = React.useState<LineOfTextMark>('underline');
  let whyNoMergeOfRange = isOneRangeNeeded ? oneRangeNeededText('mergeCells') : sheetMessages.moreCellsNeededToMerge();
  let moreMenuState = {
    folded: foldedTools,
    withButton: toolsWithButton,
    isFontSizeUnderAlign: toolsWithButton.includes('align') && !isSwipedRow,
    format: formatOfSelection,
    canUnmergeSelection,
    whyNoMerge: canMergeSelection ? null : whyNoMergeOfRange,
  };
  let tooltipPropsOf = (label: string) => disabledWithWhyNot(label, whyNoToolForCells, tooltipSide);
  let toolbarSentence = useToolbarArrowKeysHint();
  return <div ref={scrollerRef} className="sheet-scroller scroll-fade-x" data-size={barSize} {...{
      [BAR_FORM_ATTRIBUTE]: barForm(toolsOffBar, isSwipedRow),
    }} {...ofScroller}><div ref={ref} role="presentation" className="sheet-row-of-tools w-max min-w-full" onKeyDown={onKeyDown}>{toolbarSentence.sentence}{isSwipedRow &&
          <MoreOfRowCaret at="start" />}<Toolbar {...toolbarSentence.ofToolbar} flush className="py-0" label={choicesInPlace === null ? sheetMessages.formatting() : FOLDED_CHOICE_LABELS[choicesInPlace]()} divider={false}>{choicesInPlace !== null &&
              <DockedBarChoices of={choicesInPlace} shared={shared} numberFormatOfSelection={numberFormat.choice} examplesOfNumberFormats={workbookInFormatMenu.examples} onChosen={onFormatChosen} onBack={goBackToTools} onAllAsked={showAllChoices} onGoing={noteFocusAsChoicesGo} />}<BarToolsProvider ofBar={barToolsWithEnd} besides={besides} isHidden={choicesInPlace !== null}>{(['bold', 'italic'] satisfies FontMark[]).map(
                  (tool) =>
                    (<BarTool key={tool} tool={tool}><BarIconButton icon={TEXT_TOGGLE_ICONS[tool].icon} label={textStyleLabel(tool)} shortcut={formatToggleShortcut(tool)} tooltipSide={tooltipSide} pressed={togglesOn[tool]} whyNot={whyNoToolForCells} onClick={() =>
                            onFormatChosen({
                              toggle: tool,
                            })} /></BarTool>),
                )}{isSwipedRow &&
                  LINE_OF_TEXT_TOGGLES.map(
                    (toggle) =>
                      (<BarIconButton key={toggle} icon={TEXT_TOGGLE_ICONS[toggle].icon} label={textStyleLabel(toggle)} tooltipSide={tooltipSide} pressed={togglesOn[toggle]} whyNot={whyNoToolForCells} onClick={() =>
                            onFormatChosen({
                              toggle,
                            })} />),
                  )}<BarTool tool="underline"><SplitToolButton icon={TEXT_TOGGLE_ICONS[lineOfText].icon} label={textStyleLabel(lineOfText)} shortcut={formatToggleShortcut(lineOfText)} pressed={togglesOn[lineOfText]} whyNot={whyNoToolForCells} onPress={() =>
                      onFormatChosen({
                        toggle: lineOfText,
                      })} listLabel={sheetMessages.underlineOrStrikethrough()} isOpen={openMenu === 'lineOfText'} onOpenChange={(isOpen, event) => onMenuOpenChange('lineOfText', isOpen, event)} whatHasCaretAfter={whatHasCaretAfterMenu} toolbar={scrollerRef} side={TOOLBAR_POPUP_SIDE} tooltipSide={tooltipSide}>{LINE_OF_TEXT_TOGGLES.map(
                      (toggle) =>
                        (<Menu.Item key={toggle} icon={TEXT_TOGGLE_ICONS[toggle].icon} checked={togglesOn[toggle]} shortcut={formatToggleShortcut(toggle)} onClick={() => {
                              setLineOfText(toggle);
                              onFormatChosen({
                                toggle,
                              });
                            }}>{textStyleLabel(toggle)}</Menu.Item>),
                    )}</SplitToolButton></BarTool><BarTool tool="align"><ToolbarMenu isOpen={menuOpenOnBar === 'align'} isOfContextBar button={<MenuTriggerButton variant="ghost" icon={barIcon(TEXT_ALIGN_ICONS[alignmentOfActiveCellAsDrawn])} aria-label={sheetMessages.align()} {...CHEVRON_BUTTON_PADDING} {...tooltipPropsOf(sheetMessages.align())} chevron="barAtSelection">{null}</MenuTriggerButton>} tooltip={sheetMessages.align()} onOpenChange={(isOpen, event) => onMenuOpenChange('align', isOpen, event)} whatHasCaretAfter={whatHasCaretAfterMenu} toolbar={scrollerRef} side={TOOLBAR_POPUP_SIDE} tooltipSide={tooltipSide}><AlignMenuItems shared={shared} onChosen={onFormatChosen} hasRowsWithLists /></ToolbarMenu></BarTool>{separatorBefore('textColor')}{(['textColor', 'fillColor'] satisfies ColorProperty[]).map(
                  (tool) =>
                    (<BarTool key={tool} tool={tool} isDrawnWithNoButton><ColorToolPopover {...pickerAnchorOf(tool)} property={tool} whyNot={whyNoToolForCells} isOpen={menuOpenOnBar === tool} shared={shared} whatColorPickerShows={whatColorPickerShows} onChosen={(color) =>
                            onFormatChosen(
                              tool === 'fillColor'
                                ? {
                                    fillColor: color,
                                  }
                                : {
                                    textColor: color,
                                  },
                            )} onOpenChange={(isOpen, event) => onMenuOpenChange(tool, isOpen, event)} whatHasCaretAfter={whatHasCaretAfterMenu} toolbar={scrollerRef} side={TOOLBAR_POPUP_SIDE} tooltipSide={tooltipSide} /></BarTool>),
                )}<BarTool tool="borders" isDrawnWithNoButton><ToolbarPopover {...pickerAnchorOf('borders')} isOpen={openMenu === 'borders'} whyNot={whyNoToolForCells} name={sheetMessages.borders()} buttonLabel={bordersButtonLabel(summarizeAreaBorders(bordersOfBlock, areBordersOfBlockFromSample))} icon={<BordersOfBlockIcon lines={bordersOfBlock} />} side={TOOLBAR_POPUP_SIDE} tooltipSide={tooltipSide} onOpenChange={(isOpen, event) => onMenuOpenChange('borders', isOpen, event)} whatHasCaretAfter={whatHasCaretAfterMenu} toolbar={scrollerRef}><BordersPicker pen={borderPen} whatColorPickerShows={whatColorPickerShows} whatHasCaretAfter={whatHasCaretAfterMenu} onChosen={onBordersChosen} onPenChanged={onBorderPenChanged} areGridlinesHidden={areGridlinesHidden} onGridlinesToggled={onGridlinesToggled} /></ToolbarPopover></BarTool><BarTool tool="conditionalFormatting" isDrawnWithNoButton><ToolbarPopover {...pickerAnchorOf('conditionalFormatting')} isOpen={openMenu === 'conditionalFormatting'} whyNot={null} name={CONDITIONAL_FORMATTING_WORDS.conditionalFormatting()} buttonLabel={CONDITIONAL_FORMATTING_WORDS.conditionalFormatting()} icon="ConditionalFormat" isLit={areConditionalFormatsOpen} padding="none" takesCaretAtOnce side={TOOLBAR_POPUP_SIDE} tooltipSide={tooltipSide} onOpenChange={(isOpen, event) => {
                      if (isOpen && areConditionalFormatsOpen) onConditionalFormatsAsked('button');
                      else onMenuOpenChange('conditionalFormatting', isOpen, event);
                    }} whatHasCaretAfter={whatHasCaretAfterMenu} toolbar={scrollerRef}>{cardOfConditionalFormats}</ToolbarPopover></BarTool>{chartTool}{separatorBefore('numberFormat')}<BarTool tool="numberFormat"><ToolbarMenu isOpen={menuOpenOnBar === 'numberFormat'} isOfContextBar button={<MenuTriggerButton variant="ghost" icon={barIcon(numberFormatIconOf(numberFormatName).icon)} aria-label={numberFormatButtonLabel(numberFormatName)} {...CHEVRON_BUTTON_PADDING} {...tooltipPropsOf(numberFormatButtonLabel(numberFormatName))} chevron="barAtSelection">{null}</MenuTriggerButton>} tooltip={sheetMessages.cellType()} onOpenChange={(isOpen, event) => {
                        if (isOpen) opensListUnderCellRef.current = false;
                        onMenuOpenChange('numberFormat', isOpen, event);
                      }} opensListUnderCell={() => opensListUnderCellRef.current} whatHasCaretAfter={whatHasCaretAfterMenu} toolbar={scrollerRef} side={TOOLBAR_POPUP_SIDE} tooltipSide={tooltipSide} field={{
                        ...formatField,
                        handlers: formatList.handlers,
                      }}><NumberFormatMenuItems choiceOfSelection={numberFormatChoice} typeOfCells={cellTypeOfChoice(numberFormatName)} inPlaceOfFormat={inPlaceOfFormat} inserts={inserts} onInsertChosen={onInsertChosenNoting} formatsThatFit={formatsThatFit} onChosen={onFormatChosen} examples={workbookInFormatMenu.examples} options={numberFormatOptions} />{(formatsThatFit.includes('general') || inPlaceOfFormat.length > 0) && <Menu.Separator />}<SheetSettingsMenuItems workbookInFormatMenu={workbookInFormatMenu} /></ToolbarMenu><CustomFormatListAnnouncer list={formatList} /></BarTool>{sectionRoom === 0 && sortTool}{sectionRoom !== 0 &&
                  (<span ref={sectionRef} className="sheet-section-of-bar" onClickCapture={(event) => {
                      let toolElement = event.target instanceof Element && event.target.closest('[data-tool]');
                      if (event.detail < 2) clickedToolRef.current = toolElement;
                      else if (toolElement !== clickedToolRef.current) event.stopPropagation();
                    }}><BarTool tool="sort" isDrawn={sectionTools.includes('sort')}><HideableBarTool isShown={sectionTools.includes('sort')} hasNoButtonWhileHidden>{sortTool}</HideableBarTool></BarTool>{inserts.map(
                        (chip) => sectionTool(INSERT_TOOL_OF_CHIP[chip.what], insertTool(chip, chip.label)),
                      )}{sectionTool(
                        'fontSize',
                        (<ToolbarMenu isOpen={menuOpenOnBar === 'fontSize'} isOfContextBar button={<MenuTriggerButton variant="ghost" aria-label={fontSizeButtonLabel(shared.font.size)} {...FONT_SIZE_BUTTON_PADDING} {...tooltipPropsOf(fontSizeButtonLabel(shared.font.size))} chevron="barAtSelection"><span className="sheet-font-size-of-selection" data-widest="00" data-is-mixed={shared.font.size === null || undefined}>{fontSizeText(shared.font.size)}</span></MenuTriggerButton>} tooltip={sheetMessages.fontSize()} onOpenChange={(isOpen, event) => onMenuOpenChange('fontSize', isOpen, event)} whatHasCaretAfter={whatHasCaretAfterMenu} toolbar={scrollerRef} side={TOOLBAR_POPUP_SIDE} tooltipSide={tooltipSide} {...(!isPointerCoarse && {
                            field: fontSizeField,
                          })}><FontSizeItems shared={shared} onChosen={onFormatChosen} /></ToolbarMenu>),
                      )}{sectionTool(
                        'optionsOfDropdown',
                        <ToolbarTooltip name={sheetMessages.optionsOfDropdownInFull()} side={tooltipSide}><Button variant="ghost" aria-label={sheetMessages.optionsOfDropdownInFull()} pressed={isPaneOfDropdownOpen} onClick={onPaneOfDropdownAsked}>{sheetMessages.optionsOfDropdown()}</Button></ToolbarTooltip>,
                      )}{(['checkAll', 'uncheckAll'] satisfies ContextTool[]).map((tool) => {
                        let { isChecking, icon, inWords, whyNot } = CHECKBOX_SETTING_TOOLS[tool];
                        return sectionTool(
                          tool,
                          <BarIconButton icon={icon} label={inWords()} tooltipSide={tooltipSide} whyNot={whyNoToolForCells ?? whyNot(checkboxesToSet)} onClick={() => onCheckboxesSet(isChecking)} />,
                        );
                      })}{DECIMAL_PLACE_CHANGES.map(
                        (step) =>
                          sectionTool(
                            `${step}DecimalPlaces`,
                            <DecimalPlacesButton step={step} decimalPlaces={decimalPlaces} whyNoToolForCells={whyNoToolForCells} onChosen={onFormatChosen} />,
                          ),
                      )}{(['currency', 'percent'] satisfies ContextTool[]).map(
                        (format) =>
                          sectionTool(
                            format,
                            <BarIconButton icon={format === 'currency' ? 'DollarSign' : 'PercentSign'} label={numberFormatChoiceLabel(format)} tooltipSide={tooltipSide} whyNot={whyNoToolForCells} onClick={() => onNumberFormatTool(format)} />,
                          ),
                      )}{sectionTool(
                        'sum',
                        (<SplitToolButton {...menuPropsOf('sum')} icon="Sigma" label={figureNameLabel('sum')} whyNot={whyNoToolForCells ?? whyNoFigure} onPress={() => {
                            onFigureChosen('sum');
                            returnCaret();
                          }} leavesFocusToSheet listLabel={sheetMessages.moreCalculations()}>{figureItems}</SplitToolButton>),
                      )}{INSERT_ROW_COLUMN_TOOLS.map((rowOrColumnInserts) => {
                        let { of, insert, first } = rowOrColumnInserts;
                        let count = countOf(of);
                        return sectionTool(
                          insert,
                          <SplitToolButton {...menuPropsOf('insert')} isOpen={openMenu === 'insert' && sectionTools.includes(insert)} icon={first.icon} label={first.inWords(count)} whyNot={whyNoToolForCells ?? whyNoSheetChange(first.change)} onPress={() => onSheetChangeChosen(first.change)} listLabel={insertLinesLabel(of, count)}>{sheetChangeItems(rowOrColumnInserts)}</SplitToolButton>,
                        );
                      })}{sectionTool(
                        'wrapText',
                        isPointerCoarse
                          ? <BarIconButton icon="TextWrap" label={sheetMessages.wrapText()} tooltipSide={tooltipSide} pressed={isWrapTextOn(shared)} whyNot={whyNoToolForCells ?? whyNoWrap} onClick={() => onFormatChosen(wrapTextToggled(shared))} />
                          : <ToolbarMenu isOpen={menuOpenOnBar === 'textWrapping'} isOfContextBar button={<MenuTriggerButton variant="ghost" icon={barIcon('TextWrap')} aria-label={textWrappingButtonLabel(textWrappingOf(shared))} {...CHEVRON_BUTTON_PADDING} {...disabledWithWhyNot(textWrappingButtonLabel(textWrappingOf(shared)), whyNoToolForCells ?? whyNoWrap, tooltipSide)} chevron="barAtSelection">{null}</MenuTriggerButton>} tooltip={sheetMessages.textWrapping()} onOpenChange={(isOpen, event) => onMenuOpenChange('textWrapping', isOpen, event)} whatHasCaretAfter={whatHasCaretAfterMenu} toolbar={scrollerRef} side={TOOLBAR_POPUP_SIDE} tooltipSide={tooltipSide}><TextWrappingItems shared={shared} onChosen={onFormatChosen} hasHeading={false} /></ToolbarMenu>,
                      )}{inserts.map((choice) => {
                        let contextTool = CONTEXT_TOOL_OF_CELL_CONTROL[choice.what];
                        return contextTool !== undefined && sectionTool(contextTool, insertTool(choice, choice.label));
                      })}{sectionTool(
                        'mergeCells',
                        <MergeCellsButton change="mergeCells" whyNot={whyNoToolForCells ?? (canMergeSelection ? null : whyNoMergeOfRange)} onChosen={onMergeChangeChosen} />,
                      )}{sectionTool(
                        'unmergeCells',
                        <MergeCellsButton change="unmergeCells" whyNot={whyNoToolForCells} onChosen={onMergeChangeChosen} />,
                      )}</span>)}<BarTool tool="more"><ToolbarMenu isOpen={openMenu === 'more'} isOfContextBar="more" button={<Menu.Trigger render={<Button ref={moreButtonRef} variant="ghost" iconOnly icon={barIcon('DotsHorizontal')} tooltip={false} aria-label={sheetMessages.more()} className={isPickerOfMoreOpen || isSheetMenuOpen ? 'bg-fill-ghost-hover' : undefined} />} />} tooltip={sheetMessages.more()} isTooltipShut={isPickerOfMoreOpen || isSheetMenuOpen} onOpenChange={(isOpen, event) => {
                      if (isOpen) opensListUnderCellRef.current = false;
                      onMenuOpenChange('more', isOpen, event);
                    }} opensListUnderCell={() => opensListUnderCellRef.current} isPickerInItsPlace={isPickerOfMoreOpen} whatHasCaretAfter={whatHasCaretAfterMenu} toolbar={scrollerRef} side={TOOLBAR_POPUP_SIDE} tooltipSide={tooltipSide}><MoreToolsMenu {...moreMenuState} rowWhileFolded={rowWhileFolded} onFormatChosen={onFormatChosen} onMergeChangeChosen={onMergeChangeChosen} onPickerAsked={(picker, isByKey) => {
                        isPickerAskedByKeyRef.current = isByKey;
                        if (picker === 'conditionalFormatting') onConditionalFormatsAsked('menu');
                        else onMenuOpenChange(picker, true, null);
                      }} rowsThatInsertLines={rowsThatInsertLines} whyNoChart={whyNoChartNow} onSheetMenuAsked={(isByKey) => {
                        if (moreButtonRef.current !== null) onSheetMenuAsked(moreButtonRef.current, isByKey);
                      }} /></ToolbarMenu></BarTool>{comment !== null &&
                  <span data-before="tool" data-after="end" className="flex flex-none">{comment}</span>}</BarToolsProvider></Toolbar>{isSwipedRow &&
          <MoreOfRowCaret at="end" />}</div></div>;
});
