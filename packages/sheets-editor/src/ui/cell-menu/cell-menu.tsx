import { armTouchOpenGuard, releaseTouchOpenGuard, touchGuardCancelsClose } from '../../kit/touch-open-guard.ts';
import { ContextMenu } from '../../kit/context-menu.tsx';
import { Menu } from '../../kit/menu.tsx';
import type { TouchGuardKey } from '../../kit/touch-open-guard.ts';
import type { IconName } from '../../kit/icon.tsx';
import type { PopupFinalFocus } from '../../kit/popup-frame.tsx';
import type { SortDirection } from '@open-artifact/sheets-core';
import type { MenuCommand, RememberedCommand, SearchableCommand } from '../search-menu/matching.ts';
import type { CommandsUnderHeading } from '../search-menu/command-groups.ts';
import type { ColumnToSortByChosen, FigureChosen, GroupLevelChosen, SheetChange } from '../../state/event-reducer.ts';
import type { LinesAxisName } from '../../grid/geometry.ts';
import type { PageView, ConditionalFormatsView } from '../../view/page-view.ts';
import type { AnchorOnPage } from '../../chips/people-list-view.tsx';
import type { PagePoint } from '../../comments/page-comments.ts';
import type { ItemLitInMenu } from '../../tables/table-handle-menu.ts';
import type { CardUnderChart, placementIdAttributes } from '../../charts/placed-views-layer.tsx';
import type { SumFigure } from '../../selection/figures.ts';
import type { ShownSuggestion } from '../../format/conditional/pane-state.ts';
import type { AskForCommands } from '../ask-for-commands.ts';
import type { CellControlInPlaceOfFormat } from '../../format/number-format-search.tsx';
import type { IconOfChoice, NumberFormatMenuItemsProps, CellTypeOptions } from '../toolbar/number-format-menu.tsx';
import type { ExamplesOfNumberFormats } from '../../state/initial-state.ts';
import type { CommandOfOneRange } from '../../selection/several-ranges.ts';
import type { MenuField } from '../menu-with-field.tsx';
import type { EnteredCommand, EnterMeaningKind } from './handyman-state.ts';
import type { CellMenuCommandsProps, SortScope } from './menu-commands.ts';
import type { RulesAskedFor, SuggestedRuleActions } from './rule-commands.tsx';
import * as React from 'react';
import { tableKeyOfHandleAt } from '../../tables/table-handle.tsx';
import {
  isTickedVariant,
  correctedCommandQuery,
  searchCommands,
  commandMatchesDistinctWord,
  oneCommandPerStem,
  commandsSharingWords,
  hasSearchWords,
  commandToRunForQuery,
  isRememberedCommandOutOfUse,
  labelMatchesWordsInOrder,
} from '../search-menu/matching.ts';
import { goToLabel } from '../go-to-commands.ts';
import { SORT_DIRECTION_ICONS } from '../icons/sort-direction.tsx';
import { MERGE_TOOL_ICONS } from '../search-menu/bar-commands.tsx';
import {
  rowsFromFirstLabel,
  freezeRowsLabel,
  columnsFromFirstLabel,
  freezeColumnsLabel,
  sortOrderLabel,
  sortTableUnclearHint,
  sortRangeLabel,
  sortSheetLabel,
  ascendingLabel,
  descendingLabel,
  byColumnLabel,
  byHeadingLabel,
  sortByText,
  columnLetterLabel,
  figureWithValueLabel,
  rowsAboveLabel,
  rowsBelowLabel,
  columnsLeftLabel,
  columnsRightLabel,
  insertRowsAboveLabel,
  insertRowsBelowLabel,
  insertColumnsLeftLabel,
  insertColumnsRightLabel,
  moveRowsUpLabel,
  moveRowsDownLabel,
  moveColumnsLeftLabel,
  moveColumnsRightLabel,
  rowCountLabel,
  columnCountLabel,
  deleteRowsLabel,
  deleteColumnsLabel,
  resizeRowsLabel,
  resizeColumnsLabel,
  sortMenuLabel,
  addFormulaUnderNumbersLabel,
  shortHeadingLabel,
} from '../../i18n/grid-action-labels.ts';
import { sheetMessages, textStyleLabel } from '../../i18n/sheet-messages.ts';
import { CLOSED_MENU_ITEM_LATCH, latchMenuItemWhileOpen, askAgentMenuLabel, AskAgentMenuItems } from '../../agent/ask-agent-menu.tsx';
import { useCoarsePointerMedia, useTouchBelowSm } from '../../app/media-queries.ts';
import { isCommentToAgentOffered, canAskAgentHere, whatAskFieldDoes, askAgentVia } from '../../agent/chat-or-comment.ts';
import { useShutOnWindowLeave } from './window-leave.ts';
import { useHandyman, nowMs, MenuFieldFocusKeeper, HandymanRows, SuggestToolsItem, enterOnHandyman, handymanStatusWords } from './handyman.tsx';
import {
  NO_ENTER_MEANING,
  withCommandsOfNow,
  isCommandAskedAgain,
  nextEnterMeaning,
  isEnterMeaningSettled,
  enterOnTypedCommand,
  doesKeyDropAskedAgain,
} from './handyman-state.ts';
import { cellControlInsertChoices, cellControlsInMenuOrder, NumberFormatMenuItemsView, cellTypeMenuItems } from '../toolbar/number-format-menu.tsx';
import { cellTypeOfChoice } from '../../format/number-format-choices.ts';
import { cellTypeLabel } from '../../i18n/format-labels.ts';
import { pivotTableMessages } from '../../tables/pivot-table-messages.tsx';
import { labelWithCount } from '../ask-list/ask-or-pick-list.tsx';
import { useBottomInsetWhileOpen, popupCollisionPadding } from '../../shell/bottom-insets.ts';
import { CONTEXT_BAR_PART_ATTRIBUTE } from '../toolbar-tooltip.tsx';
import { oneRangeActOfCommand } from '../../selection/several-ranges.ts';
import { Fragment } from 'react/jsx-runtime';
import { MenuItemWithWhyOff } from '../menu-item-why-off.tsx';
import { oneRangeNeededText, pasteFromMenuHint, pasteValuesFromMenuHint } from '../../i18n/notice-labels.ts';
import { suggestedFreezeChoice } from '../../grid/freeze.ts';
import { toolUnavailableText } from '../../i18n/chip-labels.ts';
import { customSortMessages, sortAndFilterMessages } from '../../tables/sort-filter-labels.ts';
import { MENU_MAX_VISIBLE_ITEMS, centerCheckedItemRef } from '../menu-scroll.ts';
import { ListRowTooltip } from '../list-under-cell.tsx';
import { GROUP_CHANGES, cellMenuCommands, mergeMenuAndBarCommands, isTextStyleMenuCommand } from './menu-commands.ts';
import {
  groupLinesLabel,
  expandGroupsLabel,
  lineGroupsLabel,
  ungroupLinesLabel,
  collapseGroupsLabel,
  showToLevelLabel,
} from '../../messages/line-groups.ts';
import { CHART_MESSAGES } from '../../charts/chart-words.ts';
import { shortcutFor } from '../../keys/key-press.ts';
import { filterMessages, showOnlyValueLabel, leaveOutValueLabel, filterForWhomLabel } from '../../tables/filter-messages.ts';
import { SUM_BAR_AGGREGATES } from '../../state/transitions.ts';
import { formatNumberWithSigns } from '../../format/number-signs.ts';
import { shortcutKeysFor } from '../../keys/shortcut-list.ts';
import { linkEditMessages } from '../../links/link-hover-card.tsx';
import { suggestedRuleCommands, ruleCommands, suggestedRulesFirst } from './rule-commands.tsx';
import { toolSearchMessages } from '../../messages/tool-search-words.ts';
import { wordsToFind, FindInSheetItem, findInSheetLabel } from './find-in-sheet.tsx';
import { useRuleTryOn, SuggestedRulesWanted, SuggestedRulesSubmenu } from './suggested-rules.tsx';
import { CommentNextRow, CommandRows, MenuWithField, enabledCommandRow } from '../menu-with-field.tsx';
import { shortBreakableUrl, OPEN_LINK_SHORTCUT, breakableUrlText } from '../../links/cell-links-view.tsx';
import { commandHint, groupFoundCommands, commandGroupMessages } from '../search-menu/command-groups.ts';
import { menuMatchCountWords, menuMatchCountChooseRowWords, pressEnterAgainToConfirmWords } from '../../messages/command-search.ts';
import { TypedSearchAnnouncer } from '../search-announcer.tsx';
import { swallowPressAfterItemPress } from '../press-swallow.ts';
import { chartMessages } from '../../messages/charts.ts';
import { builtLinkWarning } from '../../i18n/status-labels.ts';
import { FONT_MARKS } from '../../editor/text-looks.ts';
import { formatToggleShortcut, TextWrappingItems } from '../toolbar/text-menus.tsx';
import { CONDITIONAL_FORMATTING_WORDS } from '../../messages/conditional-format.ts';
import { cellHistoryMessages } from '../../history/cell-history-popover.tsx';
export function passPointerDownToCells(event: PointerEvent) {
  const { currentTarget: portal, target } = event;
  if (!(portal instanceof HTMLElement)) return;
  if ((target instanceof Element && target.closest('[role="menu"]') !== null) || event.pointerType === 'touch' || event.button !== 0) return;
  let elementBelow = portal.ownerDocument
    .elementsFromPoint(event.clientX, event.clientY)
    .find((element) => !portal.contains(element));
  if (portal.querySelector(`[${MENU_OF_HANDLE_ATTRIBUTE}]`) !== null && tableKeyOfHandleAt(elementBelow ?? null) !== undefined)
    return event.stopPropagation();
  if (elementBelow === undefined || elementBelow.closest('.sheet-grid') === null) return;
  elementBelow.dispatchEvent(new PointerEvent('pointerdown', event));
  event.stopPropagation();
}
export function passPortalPointerDownToCells(menu: HTMLElement) {
  let portal = menu.closest<HTMLElement>('[data-base-ui-portal]');
  if (portal === null) reportError(Error('The menu is in no Base UI portal, so a click outside it will not reach the cells'));
  else portal.addEventListener('pointerdown', passPointerDownToCells);
}
export function passWheelThroughMenu(menu: HTMLElement, close: () => void) {
  let portal = menu.closest<HTMLElement>('[data-base-ui-portal]');
  let wheelDistance = 0;
  let resetWheelDistance = () => {
    wheelDistance = 0;
  };
  let onWheel = (event: WheelEvent) => {
    let target = event.target instanceof Element && !event.ctrlKey ? event.target : null;
    for (let element = target; element !== null && element !== portal; element = element.parentElement) {
      if (canScrollVertically(element)) return;
      if (Array.from(element.children).some(canScrollVertically)) return event.preventDefault();
    }
    if (!event.ctrlKey) event.preventDefault();
    let isOpen = menu.hasAttribute('data-open');
    let isPixelDelta = event.deltaMode === WheelEvent.DOM_DELTA_PIXEL && !event.ctrlKey;
    wheelDistance = isOpen ? wheelDistance + (isPixelDelta ? Math.hypot(event.deltaX, event.deltaY) : 1 / 0) : 0;
    if (isOpen && wheelDistance <= WHEEL_SLACK_BEFORE_CLOSE_PX) return;
    if (isOpen) close();
    if (
      menu.ownerDocument
        .elementsFromPoint(event.clientX, event.clientY)
        .find((elementBelow) => portal?.contains(elementBelow) === false)
        ?.dispatchEvent(new WheelEvent('wheel', event)) === false
    )
      event.preventDefault();
  };
  portal?.addEventListener('pointerdown', resetWheelDistance);
  portal?.addEventListener('wheel', onWheel, {
    passive: false,
  });
  return () => {
    portal?.removeEventListener('pointerdown', resetWheelDistance);
    portal?.removeEventListener('wheel', onWheel);
  };
}
export function cellTypeMenuPropsOf(
  { numberFormat, formatsThatFit, takesDropdownFromInsert, decimalPlaces, checkboxesToSet }: NonNullable<CellMenuShown['formatOfSelection']>,
  { arePeopleSelected, examples, ...options }: CellTypesOfMenu,
  { isOneRangeNeeded, isPointerCoarse, onChosen, onInsertChosen, onClosed }: CellTypeMenuCalls,
): NumberFormatMenuItemsProps {
  let inserts = cellControlInsertChoices({
    formatsThatFit,
    takesDropdown: takesDropdownFromInsert,
    isOneRangeNeeded,
    isDropdown: numberFormat.choice === 'dropdown',
  });
  return {
    choiceOfSelection: arePeopleSelected ? 'person' : numberFormat.choice,
    typeOfCells: cellTypeOfChoice(arePeopleSelected ? 'person' : numberFormat.name),
    inPlaceOfFormat: cellControlsInMenuOrder(inserts),
    inserts,
    onInsertChosen(chip) {
      if (chip === 'person') onClosed();
      onInsertChosen(chip);
    },
    formatsThatFit,
    onChosen,
    examples,
    isPointerCoarse,
    options: {
      ...options,
      decimalPlaces,
      checkboxesToSet,
      onCheckboxesSet(isChecking) {
        (onClosed(), options.onCheckboxesSet(isChecking));
      },
      onPaneOfDropdownAsked() {
        (onClosed(), options.onPaneOfDropdownAsked());
      },
    },
  };
}
export const MAX_COMMANDS_FOUND = 8;
export const MAX_GUESSED_COMMANDS = 4;
export const MAX_MENU_FIELD_LENGTH = 200;
export const clipMenuFieldText = (text: string) => text.slice(0, MAX_MENU_FIELD_LENGTH).replace(/[\uD800-\uDBFF]$/u, '');
export const isCommandEnabled = ({ whyNot }: Pick<SearchableCommand, 'whyNot'>) => whyNot === null;
export const asEnabledCommand = <Command extends SearchableCommand>(command: Command) => ({
  ...command,
  whyNot: null,
});
export const withSingleOtherWords = <Command extends SearchableCommand>(command: Command) => ({
  ...command,
  otherWords: (command.otherWords ?? []).filter((word) => !/[\s-]/.test(word)),
});
export const isLightCommand = (command: SearchableCommand) =>
  isCommandEnabled(command) && command.isWeighty !== true && !isTickedVariant(command);
export const isFunctionCommand = ({ id }: Pick<SearchableCommand, 'id'>) => id.startsWith('function.');
export const normalizeMenuWords = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ');
export const lettersAndNumbersOf = (text: string) => normalizeMenuWords(text.replace(/[^\p{L}\p{M}\p{N}]+/gu, ' '));
export const labelsMatch = (label: string, typed: string) => lettersAndNumbersOf(label) === lettersAndNumbersOf(typed);
export const isGoToTyped = (typed: string) => {
  let goToWords = normalizeMenuWords(goToLabel()).split(' ');
  return normalizeMenuWords(typed)
    .split(' ')
    .every((typedWord) => goToWords.some((goToWord) => goToWord.startsWith(typedWord)));
};
export const GROUP_ICON: IconOfChoice = {
  icon: 'Group',
};
export const UNGROUP_ICON: IconOfChoice = {
  icon: 'Ungroup',
};
export const CONVERT_TEXTS_ICON: IconOfChoice = {
  icon: 'Numbers',
};
export const CHANGE_ICONS: Partial<Record<SheetChange, MenuCommand['icon']>> = {
  insertRowAbove: 'TableRowInsertAbove',
  insertRowBelow: 'TableRowInsertBelow',
  insertColumnLeft: 'TableColumnInsertLeft',
  insertColumnRight: 'TableColumnInsertRight',
  moveRowsUp: 'ArrowUp',
  moveRowsDown: 'ArrowDown',
  moveColumnsLeft: 'ArrowLeft',
  moveColumnsRight: 'ArrowRight',
  resizeRows: 'RowHeight',
  resizeColumns: 'ColumnWidth',
  deleteRows: 'TableRowDelete',
  deleteColumns: 'TableColumnDelete',
  sortAscending: SORT_DIRECTION_ICONS.ascending,
  sortDescending: SORT_DIRECTION_ICONS.descending,
  sortRangeAscending: SORT_DIRECTION_ICONS.ascending,
  sortRangeDescending: SORT_DIRECTION_ICONS.descending,
  groupRows: GROUP_ICON.icon,
  groupColumns: GROUP_ICON.icon,
  ungroupRows: UNGROUP_ICON.icon,
  ungroupColumns: UNGROUP_ICON.icon,
  collapseRows: null,
  collapseColumns: null,
  expandRows: null,
  expandColumns: null,
  ...MERGE_TOOL_ICONS,
  convertTexts: CONVERT_TEXTS_ICON.icon,
};
export const iconOfChange = (change: SheetChange) => CHANGE_ICONS[change];
export const SORT_CHANGES_BY_SCOPE: Record<SortScope, Record<SortDirection, SheetChange & CommandOfOneRange>> = {
  sheet: {
    ascending: 'sortAscending',
    descending: 'sortDescending',
  },
  range: {
    ascending: 'sortRangeAscending',
    descending: 'sortRangeDescending',
  },
};
/** The lines the freeze rows of the menu are for, and how the menu words them. */
export interface FreezeMenuLines {
  what: LinesAxisName;
  inWords(count: number): string;
  forWholeLinesInWords(count: number): string;
  whyNoRoom(): string;
}
export const FREEZE_MENU_LINES: FreezeMenuLines[] = [
  {
    what: 'rows',
    inWords: rowsFromFirstLabel,
    forWholeLinesInWords: freezeRowsLabel,
    whyNoRoom: sheetMessages.tooManyRowsToFreeze,
  },
  {
    what: 'columns',
    inWords: columnsFromFirstLabel,
    forWholeLinesInWords: freezeColumnsLabel,
    whyNoRoom: sheetMessages.tooManyColumnsToFreeze,
  },
];
export const MENU_OF_HANDLE_ATTRIBUTE = 'data-menu-of-handle';
export const isOnlyAltPressed = ({ altKey, shiftKey, ctrlKey, metaKey }: Pick<KeyboardEvent, 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey'>) =>
  altKey && !shiftKey && !ctrlKey && !metaKey;
export const WHEEL_SLACK_BEFORE_CLOSE_PX = 8;
export const canScrollVertically = (element: Element) =>
  element.scrollHeight > element.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(element).overflowY);
export const CELL_MENU_TOUCH_GUARD: TouchGuardKey = {};
export const FORMATTING_MENU_MAX_VISIBLE_ITEMS = 22;
export const MENU_ON_CELLS_ATTRIBUTE = 'data-menu-on-cells';
export const armCellMenuTouchGuard = (menu: Element) => armTouchOpenGuard(CELL_MENU_TOUCH_GUARD, menu.ownerDocument, menu);
/** The chart a menu opened on, and the attributes that mark the menu as its. */
export interface ChartOfMenu extends NonNullable<NonNullable<PageView['menu']>['ofChart']> {
  mark: ReturnType<typeof placementIdAttributes>;
}
/** What the cell type rows of the menu read of the selection, and what they call besides choosing a format. */
export type CellTypesOfMenu = {
  arePeopleSelected: boolean;
  areCellsBlank: boolean;
  examples: ExamplesOfNumberFormats;
} & Omit<CellTypeOptions, 'decimalPlaces' | 'checkboxesToSet'>;
/** What the cell type rows of the menu call, and how the menu stands. */
interface CellTypeMenuCalls {
  isOneRangeNeeded: boolean;
  isPointerCoarse: boolean;
  onChosen: NumberFormatMenuItemsProps['onChosen'];
  onInsertChosen(what: CellControlInPlaceOfFormat): void;
  onClosed(): void;
}
/** What the cell menu shows of the page; kept as it was while the menu closes. */
export interface CellMenuShown
  extends Omit<CellMenuCommandsProps, 'iconOfChange' | 'keyThatPastes' | `on${string}`>,
    Pick<
      PageView,
      | 'isSelectionCutByOwnFilters'
      | 'isSelectionCutByOwnSort'
      | 'menuSortsFor'
      | 'columnToSortSelectedRangeBy'
      | 'columnsOfferedToSortBy'
      | 'headingToSortBy'
      | 'headingToSortSelectedRangeBy'
      | 'keysToSortBy'
      | 'keysToSortSelectedRangeBy'
    > {
  side: NonNullable<PageView['menu']>['side'];
  isLinkInWordsBuilt: boolean;
  isOfContextBar: boolean;
  holdsOnlyFigures: boolean;
  isOfHandleOfTable: boolean;
  holdsNoEdits: boolean;
  ofChart: ChartOfMenu | null;
  canInsertChart: boolean;
  canCellsMakeChart: boolean;
  figures: SumFigure | null;
  canPasteValuesOnly: boolean;
  isChatToBeHad: boolean | null;
  hasAddressForAgent: boolean;
  addressOfActiveCell: string | null;
  doCellsShowError: boolean;
  rulesSuggested: readonly ShownSuggestion[] | null;
  canActiveCellBeFixedHere: boolean;
  isFixOfActiveCellYetToBeKnown: boolean;
  cellTypes: CellTypesOfMenu;
}
/** The commands typed words stand for, and whether the first of them is the one meant. */
export interface CommandsOfTypedWords {
  commands: MenuCommand[];
  isFirstMeant: boolean;
}
export interface CellContextMenuProps
  extends CellMenuShown,
    Pick<
      CellMenuCommandsProps,
      | 'keyThatPastes'
      | 'onLinkOpened'
      | 'onLinkCopied'
      | 'onLinkFormAsked'
      | 'onCopyOrCutChosen'
      | 'onPasteChosen'
      | 'onCommentChosen'
      | 'onClearChosen'
      | 'onChangeChosen'
      | 'onSortAndFilterAsked'
      | 'onOwnFilterByCellChosen'
      | 'onOwnFilterRemoved'
      | 'onFormatAsTableChosen'
      | 'onFreezeChosen'
      | 'onFormatChosen'
      | 'onConditionalFormatsAsked'
      | 'onSortPaneAsked'
      | 'onCellHistoryAsked'
      | 'onPivotTableAsked'
    > {
  isOpen: boolean;
  isAskedByKey: boolean;
  placeAsked: PagePoint | null;
  onWindowLeftWithMenuAskedAt(at: PagePoint): void;
  staysOpenAsWindowIsLeft(): boolean;
  isAskedToSearch: boolean;
  anchor: AnchorOnPage;
  whatHasCaretAfter: PopupFinalFocus;
  onClosed(): void;
  onLinkCardAsked(): void;
  onPasteMeantForCells(event: ClipboardEvent): void;
  onOwnFilterAsked(): void;
  onChartCardAsked(isByKey: boolean): void;
  onKeyDownInMenuOfHandle(event: React.KeyboardEvent<HTMLDivElement>, lit: ItemLitInMenu): void;
  cardUnderChart: React.RefObject<CardUnderChart | null>;
  onChartCopyChosen(): void;
  onChartDeleteChosen(isByKey: boolean): void;
  onColumnToSortByChosen(columnId: ColumnToSortByChosen['columnId']): void;
  onGroupLevelChosen(lines: GroupLevelChosen['of'], level: GroupLevelChosen['level']): void;
  onInsertChosen(what: CellControlInPlaceOfFormat): void;
  onFigureChosen(figure: FigureChosen['figure']): void;
  onAgentAsked(doCellsShowError: boolean): void;
  onFixAsked(): void;
  onAgentAskedInComment(): void;
  onFindAskedFor(words: string): void;
  commandsOfBar(): MenuCommand[];
  commandsOfTyped(words: string): CommandsOfTypedWords | null;
  commandsByName(words: string): CommandsUnderHeading<MenuCommand>[];
  onSearchBegun(): void;
  askForCommands: AskForCommands;
  canAskForCommands(): Promise<boolean>;
  isAgentForToolsExpected: boolean;
  onOpened(): void;
  couldCommentGoToAgent(): boolean;
  mightChatLeaveSheet(): boolean;
  canRuleBeAskedInWords: boolean;
  rulesInMenu: ConditionalFormatsView | null;
  onSuggestedRulesWanted(): void;
  onSuggestedRulePointedAt: SuggestedRuleActions['onPointedAt'];
  onSuggestedRuleTaken: SuggestedRuleActions['onTaken'];
  onRulesAsked(askedFor: RulesAskedFor): void;
  onRuleAskedInWords(words: string): void;
  onRuleLetGo(): void;
  onRuleKept(): void;
  onRuleStopped(): void;
  /** Runs `take` as a command taken from the menu, by key or by pointer. */
  onCommandTaken(isByKey: boolean, take: () => void): void;
  wasChatToBeHad: boolean;
}
/** The commands of the cell menu: the ids of its own rows, and all it can find. */
interface CommandsOfMenu {
  idsOfMenu: Set<string>;
  all: MenuCommand[];
}
/** The commands found for typed words, as the search field remembers them. */
interface TypedCommands {
  ofTyped: CommandsOfTypedWords | null;
  byName: CommandsUnderHeading<MenuCommand>[];
}
/** The commands the field lists for typed words, and whether they are only a guess. */
interface FoundCommands {
  commands: MenuCommand[];
  isGuess: boolean;
}
/** The rows the field shows for some words, kept so rows do not jump as commands go out of use. */
interface ShownFind {
  words: string;
  ids: string[];
  isOfNamedOutOfUse: boolean;
  isGuess: boolean;
  idsOutOfUse: string[];
  hadRules: boolean;
}
/** What the search finds for typed words when Enter takes a command. */
interface EnterFind {
  isAnyFound: boolean;
  idTaken: string | null;
}
/** What Enter in the field would do with the words typed. */
type WhatEnterDoes =
  | { does: 'takes'; command: MenuCommand }
  | { does: 'finds'; words: string }
  | { does: 'showsWhyNot' | 'nothing' | 'asksForTools' | 'asksAgent' };
/** The field of the cell menu, which also tells what a screen reader should say of its rows. */
interface CellMenuField extends MenuField {
  saidOf(query: string, isSettled: boolean): string;
}
/** The words of a row a sheet change makes, besides its label. */
interface ChangeItemWords {
  hint?: string | null;
  foundByTyping?: string | null;
}
/** A submenu, or in its place a row that tells why it is off. */
interface SubmenuOrOff {
  icon: IconName | MenuCommand['icon'] | undefined;
  label: string;
  whyOff: string | null;
  rows: React.ReactNode;
}
export const CellContextMenu = React.memo(function ({
  isOpen,
  isAskedByKey,
  placeAsked,
  onWindowLeftWithMenuAskedAt,
  staysOpenAsWindowIsLeft,
  isAskedToSearch,
  anchor,
  whatHasCaretAfter,
  onClosed,
  onLinkOpened,
  onLinkCopied,
  onLinkFormAsked,
  onLinkCardAsked,
  onCopyOrCutChosen,
  keyThatPastes,
  onPasteChosen,
  onPasteMeantForCells,
  onCommentChosen,
  onClearChosen,
  onChangeChosen,
  onOwnFilterAsked,
  onSortAndFilterAsked,
  onChartCardAsked,
  onKeyDownInMenuOfHandle,
  cardUnderChart,
  onChartCopyChosen,
  onChartDeleteChosen,
  onOwnFilterByCellChosen,
  onOwnFilterRemoved,
  onFormatAsTableChosen,
  onColumnToSortByChosen,
  onFreezeChosen,
  onGroupLevelChosen,
  onFormatChosen,
  onInsertChosen,
  onConditionalFormatsAsked,
  onSortPaneAsked,
  onFigureChosen,
  onCellHistoryAsked,
  onPivotTableAsked,
  onAgentAsked,
  onFixAsked,
  onAgentAskedInComment,
  onFindAskedFor,
  commandsOfBar,
  commandsOfTyped,
  commandsByName,
  onSearchBegun,
  askForCommands,
  canAskForCommands,
  isAgentForToolsExpected,
  onOpened,
  couldCommentGoToAgent,
  mightChatLeaveSheet,
  canRuleBeAskedInWords,
  rulesInMenu,
  onSuggestedRulesWanted,
  onSuggestedRulePointedAt,
  onSuggestedRuleTaken,
  onRulesAsked,
  onRuleAskedInWords,
  onRuleLetGo,
  onRuleKept,
  onRuleStopped,
  onCommandTaken,
  wasChatToBeHad,
  ...menuProps
}: CellContextMenuProps) {
  let [keptMenuProps, setKeptMenuProps] = React.useState(menuProps);
  let areKeptPropsSame =
    keptMenuProps.side === menuProps.side &&
    keptMenuProps.linkUrl === menuProps.linkUrl &&
    keptMenuProps.linkInWordsUrl === menuProps.linkInWordsUrl &&
    keptMenuProps.isLinkInWordsBuilt === menuProps.isLinkInWordsBuilt &&
    keptMenuProps.linkByHandOffered === menuProps.linkByHandOffered &&
    keptMenuProps.doesKeyOpenLinkForm === menuProps.doesKeyOpenLinkForm &&
    keptMenuProps.isOfContextBar === menuProps.isOfContextBar &&
    keptMenuProps.holdsOnlyFigures === menuProps.holdsOnlyFigures &&
    keptMenuProps.isOfHandleOfTable === menuProps.isOfHandleOfTable &&
    keptMenuProps.ofChart === menuProps.ofChart &&
    keptMenuProps.canInsertChart === menuProps.canInsertChart &&
    keptMenuProps.holdsNoEdits === menuProps.holdsNoEdits &&
    keptMenuProps.ownFilterOffers?.filter.kind === menuProps.ownFilterOffers?.filter.kind &&
    keptMenuProps.ownFilterOffers?.valueOfCell === menuProps.ownFilterOffers?.valueOfCell &&
    keptMenuProps.formatAsTableOffer?.isOn === menuProps.formatAsTableOffer?.isOn &&
    keptMenuProps.formatOfSelection === menuProps.formatOfSelection &&
    keptMenuProps.cellTypes === menuProps.cellTypes &&
    keptMenuProps.selectionIsOf === menuProps.selectionIsOf &&
    keptMenuProps.selectedRowCount === menuProps.selectedRowCount &&
    keptMenuProps.selectedColumnCount === menuProps.selectedColumnCount &&
    keptMenuProps.selectedCellCount === menuProps.selectedCellCount &&
    keptMenuProps.rowCountToSize === menuProps.rowCountToSize &&
    keptMenuProps.columnCountToSize === menuProps.columnCountToSize &&
    keptMenuProps.isOneRangeNeeded === menuProps.isOneRangeNeeded &&
    keptMenuProps.isSelectionCutByOwnFilters === menuProps.isSelectionCutByOwnFilters &&
    keptMenuProps.isSelectionCutByOwnSort === menuProps.isSelectionCutByOwnSort &&
    keptMenuProps.heldToPaste === menuProps.heldToPaste &&
    keptMenuProps.canPasteValuesOnly === menuProps.canPasteValuesOnly &&
    keptMenuProps.canDeleteSelectedRows === menuProps.canDeleteSelectedRows &&
    keptMenuProps.canDeleteSelectedColumns === menuProps.canDeleteSelectedColumns &&
    keptMenuProps.areWholeRowsSelected === menuProps.areWholeRowsSelected &&
    keptMenuProps.areWholeColumnsSelected === menuProps.areWholeColumnsSelected &&
    keptMenuProps.columnToSortBy === menuProps.columnToSortBy &&
    keptMenuProps.canSortSelectedRange === menuProps.canSortSelectedRange &&
    keptMenuProps.columnToSortSelectedRangeBy === menuProps.columnToSortSelectedRangeBy &&
    keptMenuProps.columnsOfferedToSortBy === menuProps.columnsOfferedToSortBy &&
    keptMenuProps.headingToSortBy === menuProps.headingToSortBy &&
    keptMenuProps.headingToSortSelectedRangeBy === menuProps.headingToSortSelectedRangeBy &&
    keptMenuProps.keysToSortBy === menuProps.keysToSortBy &&
    keptMenuProps.canSortTableAtCell === menuProps.canSortTableAtCell &&
    keptMenuProps.menuSortsFor === menuProps.menuSortsFor &&
    keptMenuProps.keysToSortSelectedRangeBy === menuProps.keysToSortSelectedRangeBy &&
    keptMenuProps.canMergeSelection === menuProps.canMergeSelection &&
    keptMenuProps.canUnmergeSelection === menuProps.canUnmergeSelection &&
    keptMenuProps.canMoveSelectionBack === menuProps.canMoveSelectionBack &&
    keptMenuProps.canMoveSelectionOn === menuProps.canMoveSelectionOn &&
    keptMenuProps.freezeChoices === menuProps.freezeChoices &&
    keptMenuProps.groupChoices === menuProps.groupChoices &&
    keptMenuProps.figures === menuProps.figures &&
    keptMenuProps.areDropdownsSelected === menuProps.areDropdownsSelected &&
    keptMenuProps.isCellHistoryOffered === menuProps.isCellHistoryOffered &&
    keptMenuProps.isActiveCellOfPivotTable === menuProps.isActiveCellOfPivotTable &&
    keptMenuProps.isChatToBeHad === menuProps.isChatToBeHad &&
    keptMenuProps.hasAddressForAgent === menuProps.hasAddressForAgent &&
    keptMenuProps.addressOfActiveCell === menuProps.addressOfActiveCell &&
    keptMenuProps.isCommentOffered === menuProps.isCommentOffered &&
    keptMenuProps.doCellsShowError === menuProps.doCellsShowError &&
    keptMenuProps.rulesSuggested === menuProps.rulesSuggested &&
    keptMenuProps.canActiveCellBeFixedHere === menuProps.canActiveCellBeFixedHere &&
    keptMenuProps.isFixOfActiveCellYetToBeKnown === menuProps.isFixOfActiveCellYetToBeKnown;
  if (isOpen && !areKeptPropsSame) setKeptMenuProps(menuProps);
  let [askAgentLatch, setAskAgentLatch] = React.useState(CLOSED_MENU_ITEM_LATCH);
  let isPointerCoarse = useCoarsePointerMedia();
  let offersCommentToAgent = isCommentToAgentOffered({
    isFieldOnTop:
      !menuProps.holdsOnlyFigures &&
      !menuProps.holdsNoEdits &&
      !menuProps.isOfContextBar &&
      !menuProps.isOfHandleOfTable &&
      menuProps.ofChart === null &&
      !isPointerCoarse,
    isChatToBeHad: menuProps.isChatToBeHad ?? wasChatToBeHad,
    isCommentOffered: menuProps.isCommentOffered,
    doCellsShowError: menuProps.doCellsShowError,
    couldCommentGoToAgent: couldCommentGoToAgent(),
  });
  let askAgentLatched = latchMenuItemWhileOpen(askAgentLatch, isOpen, offersCommentToAgent ? true : menuProps.isChatToBeHad, wasChatToBeHad);
  if (askAgentLatched !== askAgentLatch) setAskAgentLatch(askAgentLatched);
  let [fixLatch, setFixLatch] = React.useState(CLOSED_MENU_ITEM_LATCH);
  let fixLatched = latchMenuItemWhileOpen(
    fixLatch,
    isOpen,
    menuProps.canActiveCellBeFixedHere || menuProps.isFixOfActiveCellYetToBeKnown,
    false,
  );
  if (fixLatched !== fixLatch) setFixLatch(fixLatched);
  let [makeChartLatch, setMakeChartLatch] = React.useState(CLOSED_MENU_ITEM_LATCH);
  let makeChartLatched = latchMenuItemWhileOpen(makeChartLatch, isOpen, menuProps.canCellsMakeChart, false);
  if (makeChartLatched !== makeChartLatch) setMakeChartLatch(makeChartLatched);
  let { isShut, isWindowLeft } = useShutOnWindowLeave({
    isOpen,
    placeAsked,
    close: onWindowLeftWithMenuAskedAt,
    staysOpen: staysOpenAsWindowIsLeft,
  });
  let [wasAskedByKey, setWasAskedByKey] = React.useState(isAskedByKey);
  if (isOpen && wasAskedByKey !== isAskedByKey) setWasAskedByKey(isAskedByKey);
  let [wasAskedToSearch, setWasAskedToSearch] = React.useState(isAskedToSearch);
  if (isOpen && wasAskedToSearch !== isAskedToSearch) setWasAskedToSearch(isAskedToSearch);
  let [typed, setTyped] = React.useState('');
  let handymanHook = useHandyman(askForCommands, isOpen, anchor, onRuleAskedInWords, rulesInMenu);
  let [enterMeaning, setEnterMeaning] = React.useState(NO_ENTER_MEANING);
  let [askedToConfirm, setAskedToConfirm] = React.useState<EnteredCommand | null>(null);
  let [isAgentHadForTools, setIsAgentHadForTools] = React.useState(isAgentForToolsExpected);
  React.useEffect(() => {
    if (!isOpen) return;
    let isStillWanted = true;
    canAskForCommands()
      .catch(() => false)
      .then((canAsk) => {
        if (isStillWanted) setIsAgentHadForTools(canAsk);
        return;
      });
    return () => {
      isStillWanted = false;
    };
  }, [isOpen, canAskForCommands]);
  React.useEffect(() => {
    if (isOpen) onOpened();
  }, [isOpen, onOpened]);
  let [rememberedCommand, setRememberedCommand] = React.useState<RememberedCommand | null>(null);
  let [seenAnchor, setSeenAnchor] = React.useState(anchor);
  if (anchor !== seenAnchor) {
    setSeenAnchor(anchor);
    setTyped('');
    setEnterMeaning(NO_ENTER_MEANING);
    setAskedToConfirm(null);
    setRememberedCommand(null);
  }
  const {
    side,
    linkUrl,
    linkInWordsUrl,
    isLinkInWordsBuilt,
    linkByHandOffered,
    doesKeyOpenLinkForm,
    isOfContextBar,
    holdsOnlyFigures,
    isOfHandleOfTable,
    ofChart,
    canInsertChart,
    holdsNoEdits,
    ownFilterOffers,
    formatAsTableOffer,
    formatOfSelection,
    cellTypes,
    figures,
    freezeChoices,
    groupChoices,
    selectionIsOf,
    selectedRowCount,
    selectedColumnCount,
    selectedCellCount,
    rowCountToSize,
    columnCountToSize,
    isOneRangeNeeded,
    isSelectionCutByOwnFilters,
    isSelectionCutByOwnSort,
    heldToPaste,
    canPasteValuesOnly,
    canDeleteSelectedRows,
    canDeleteSelectedColumns,
    areWholeRowsSelected,
    areWholeColumnsSelected,
    columnToSortBy,
    canSortSelectedRange,
    columnToSortSelectedRangeBy,
    columnsOfferedToSortBy: columnsOfferedToSortByOfSheet,
    headingToSortBy: headingToSortByOfSheet,
    headingToSortSelectedRangeBy,
    keysToSortBy,
    canSortTableAtCell,
    menuSortsFor,
    keysToSortSelectedRangeBy,
    canMergeSelection,
    canUnmergeSelection,
    canMoveSelectionBack,
    canMoveSelectionOn,
    areDropdownsSelected,
    isCellHistoryOffered,
    isActiveCellOfPivotTable,
    isChatToBeHad,
    hasAddressForAgent,
    addressOfActiveCell,
    isCommentOffered,
    doCellsShowError,
    rulesSuggested,
    canActiveCellBeFixedHere,
    isFixOfActiveCellYetToBeKnown,
  } = isOpen ? menuProps : keptMenuProps;
  let cellTypeMenu =
    formatOfSelection === null
      ? null
      : cellTypeMenuPropsOf(formatOfSelection, cellTypes, {
          isOneRangeNeeded,
          isPointerCoarse,
          onChosen: onFormatChosen,
          onInsertChosen,
          onClosed,
        });
  let hidesLinks = holdsOnlyFigures || ofChart !== null;
  let linkToOpen = hidesLinks ? null : linkUrl;
  let linkToCopy = hidesLinks ? null : linkInWordsUrl;
  let openLinkItemRef = React.useRef<HTMLElement | null>(null);
  let focusedInMenuRef = React.useRef<Element | null>(null);
  React.useEffect(() => {
    if (!isOpen || isShut) focusedInMenuRef.current = null;
    let documentOfLostFocus = focusedInMenuRef.current?.isConnected === false ? focusedInMenuRef.current.ownerDocument : null;
    let menuWithFocus = documentOfLostFocus?.activeElement?.closest('[role="menu"]') ?? null;
    if (documentOfLostFocus?.hasFocus() === true && menuWithFocus === null) onClosed();
  });
  React.useEffect(() => (isOpen ? () => releaseTouchOpenGuard(CELL_MENU_TOUCH_GUARD) : undefined), [isOpen]);
  let bottomInset = useBottomInsetWhileOpen(isOpen, false);
  let isTouchBelowSm = useTouchBelowSm();
  let isFieldOnTop = !holdsOnlyFigures && !holdsNoEdits && !isOfContextBar && !isOfHandleOfTable && ofChart === null && !isPointerCoarse;
  let padsForBottomInset = side === null && bottomInset > 0;
  let collisionProps = React.useMemo(
    () =>
      padsForBottomInset
        ? {
            collisionPadding: popupCollisionPadding(bottomInset),
          }
        : {},
    [padsForBottomInset, bottomInset],
  );
  let contextBarPartProps = menuProps.isOfContextBar
    ? {
        [CONTEXT_BAR_PART_ATTRIBUTE]: 'more',
      }
    : {};
  let menuRef = React.useCallback(
    (menu: HTMLDivElement | null) => {
      if (menu === null) return;
      passPortalPointerDownToCells(menu);
      let stopWheel = passWheelThroughMenu(menu, onClosed);
      return () => {
        stopWheel();
      };
    },
    [onClosed],
  );
  let changeItem = (
    change: SheetChange,
    label: string,
    isOff = false,
    whyOff: string | null = null,
    shortcut: string | null = null,
    hasIcon = true,
    { hint = null, foundByTyping = null }: ChangeItemWords = {},
  ) => {
    let oneRangeAct = isOneRangeNeeded ? oneRangeActOfCommand(change) : null;
    return <MenuItemWithWhyOff {...(hasIcon && {
        icon: CHANGE_ICONS[change],
      })} {...(shortcut !== null && {
        shortcut,
      })} {...(hint !== null && {
        hint,
      })} {...(foundByTyping !== null && {
        label: foundByTyping,
      })} disabled={isOff || oneRangeAct !== null} whyOff={oneRangeAct === null ? whyOff : oneRangeNeededText(oneRangeAct)} isPointerCoarse={isPointerCoarse} onClick={() => onChangeChosen(change)}>{label}</MenuItemWithWhyOff>;
  };
  let freezeItems = () => {
    let freezeLines = FREEZE_MENU_LINES.find(({ what }) => what === selectionIsOf);
    if (freezeLines === undefined || freezeChoices === null) return null;
    let choice = suggestedFreezeChoice(freezeChoices[freezeLines.what]);
    if (choice === null) return null;
    return <><MenuItemWithWhyOff icon={choice.count === 0 ? 'PinSlash' : 'Pin'} disabled={!choice.isRoom} whyOff={choice.isRoom ? null : freezeLines.whyNoRoom()} isPointerCoarse={isPointerCoarse} onClick={() => onFreezeChosen(freezeLines.what, choice.count)}>{freezeLines.forWholeLinesInWords(choice.count)}</MenuItemWithWhyOff><ContextMenu.Separator /></>;
  };
  let whyNoDeleteLines = isOneRangeNeeded
    ? sheetMessages.oneRangeNeededToDeleteLines()
    : canDeleteSelectedRows || canDeleteSelectedColumns
      ? null
      : sheetMessages.sheetNeedsARowAndAColumn();
  let countedChangeItem = (
    change: SheetChange,
    labelOfCount: (count: number) => string,
    count: number,
    isOff = false,
    whyOff: string | null = null,
  ) =>
    changeItem(change, labelOfCount(count), isOff, whyOff, null, true, {
      foundByTyping: labelOfCount(1),
    });
  let submenuOrOff = ({ icon, label, whyOff, rows }: SubmenuOrOff) =>
    whyOff === null
      ? <ContextMenu.Submenu><ContextMenu.SubmenuTrigger icon={icon}>{label}</ContextMenu.SubmenuTrigger><ContextMenu.SubmenuPopup {...contextBarPartProps}>{rows}</ContextMenu.SubmenuPopup></ContextMenu.Submenu>
      : <MenuItemWithWhyOff icon={icon} disabled whyOff={whyOff} isPointerCoarse={isPointerCoarse}>{label}</MenuItemWithWhyOff>;
  let sortItem = (scope: SortScope, direction: SortDirection, label: string, hasIcon: boolean) => {
    let keys = scope === 'range' ? keysToSortSelectedRangeBy : keysToSortBy;
    let hint = keys === null ? null : sortOrderLabel(keys, direction);
    let isUnclear = selectedCellCount === 1 && !canSortTableAtCell;
    let whyOff = isUnclear ? sortTableUnclearHint(isActiveCellOfPivotTable) : null;
    return changeItem(SORT_CHANGES_BY_SCOPE[scope][direction], label, isUnclear, whyOff, null, hasIcon, {
      hint,
    });
  };
  let sortGroup = (scope: SortScope) =>
    <ContextMenu.Group><Menu.GroupLabel>{labelWithCount(sortMenuLabel(), filterForWhomLabel(menuSortsFor?.[scope] ?? null))}</Menu.GroupLabel>{sortItem(scope, 'ascending', ascendingLabel(), false)}{sortItem(scope, 'descending', descendingLabel(), false)}</ContextMenu.Group>;
  let sortSubmenu = (scope: SortScope, columnLetters: string | null) => {
    let heading = scope === 'range' ? headingToSortSelectedRangeBy : headingToSortByOfSheet;
    let label = scope === 'range' ? sortRangeLabel() : sortSheetLabel();
    let oneRangeAct = isOneRangeNeeded && scope === 'range' ? oneRangeActOfCommand(SORT_CHANGES_BY_SCOPE.range.ascending) : null;
    if (oneRangeAct !== null)
      return <MenuItemWithWhyOff icon="Sort" disabled whyOff={oneRangeNeededText(oneRangeAct)} isPointerCoarse={isPointerCoarse}>{label}</MenuItemWithWhyOff>;
    let columnsOffered = scope === 'sheet' ? (columnsOfferedToSortByOfSheet ?? []) : [];
    let directionItems = sortGroup(scope);
    let customSortItem = <ContextMenu.Item onClick={() => onSortPaneAsked(scope)}>{customSortMessages.customSort()}</ContextMenu.Item>;
    return <ContextMenu.Submenu>{columnLetters === null || heading === '' || isTouchBelowSm
          ? (<ContextMenu.SubmenuTrigger icon="Sort" {...(columnLetters !== null && {
                hint: heading === '' ? byColumnLabel(columnLetters) : byHeadingLabel(heading),
                hintDir: 'auto',
              })}>{label}</ContextMenu.SubmenuTrigger>)
          : <ContextMenu.SubmenuTrigger icon="Sort" label={label}><span className="flex items-baseline justify-between gap-md"><span className="shrink-0">{label}</span><span className="-my-[0.125em] max-w-[160px] min-w-0 truncate py-[0.125em] text-footnote text-muted">{byHeadingLabel(heading)}</span></span></ContextMenu.SubmenuTrigger>}{columnsOffered.length < 2
          ? <ContextMenu.SubmenuPopup {...contextBarPartProps}>{directionItems}<ContextMenu.Separator />{customSortItem}</ContextMenu.SubmenuPopup>
          : (<ContextMenu.SubmenuPopup {...contextBarPartProps} header={<>{directionItems}<ContextMenu.Separator /></>} footer={<><ContextMenu.Separator />{customSortItem}</>} maxVisibleItems={MENU_MAX_VISIBLE_ITEMS}><ContextMenu.Group><Menu.GroupLabel>{sortByText()}</Menu.GroupLabel>{columnsOffered.map(({ columnId, letters, heading: headingOfColumn }) => {
                    let columnLabel = headingOfColumn === '' ? columnLetterLabel(letters) : headingOfColumn;
                    return (<ContextMenu.Item key={columnId} ref={letters === columnLetters ? centerCheckedItemRef : undefined} checked={letters === columnLetters} checkedRole="radio" label={columnLabel} onClick={() => onColumnToSortByChosen(columnId)}><span className="flex min-w-0 items-baseline justify-between gap-md"><ListRowTooltip className="min-w-0" dir="auto">{columnLabel}</ListRowTooltip>{headingOfColumn !== '' &&
                              <span className="shrink-0 text-footnote text-muted">{letters}</span>}</span></ContextMenu.Item>);
                  })}</ContextMenu.Group></ContextMenu.SubmenuPopup>)}</ContextMenu.Submenu>;
  };
  let groupItems = ({
    of: lines,
    canUngroup,
    collapseCount,
    expandCount,
    levelCount,
  }: NonNullable<PageView['groupChoices']>) => {
    let selectedCount = lines === 'rows' ? selectedRowCount : selectedColumnCount;
    let changes = GROUP_CHANGES[lines];
    let hasLevels = levelCount > 0;
    let groupItem = (change: SheetChange, label: string, shortcut: string) =>
      changeItem(change, label, false, null, shortcut, !hasLevels);
    let groupLinesItem = groupItem(changes.group, groupLinesLabel(lines, selectedCount), 'alt+shift+right');
    return <>{expandCount > 0 && changeItem(changes.expand, expandGroupsLabel(expandCount), false, null, 'alt+shift+down')}{!hasLevels
          ? groupLinesItem
          : (<ContextMenu.Submenu><ContextMenu.SubmenuTrigger icon={CHANGE_ICONS[changes.group]}>{lineGroupsLabel(lines)}</ContextMenu.SubmenuTrigger><ContextMenu.SubmenuPopup {...contextBarPartProps}>{groupLinesItem}{canUngroup && groupItem(changes.ungroup, ungroupLinesLabel(lines), 'alt+shift+left')}{collapseCount > 0 && groupItem(changes.collapse, collapseGroupsLabel(collapseCount), 'alt+shift+up')}<ContextMenu.Separator />{Array.from(
                      {
                        length: levelCount,
                      },
                      (_slot, index) => index + 1,
                    ).map(
                      (level) =>
                        <ContextMenu.Item key={level} onClick={() => onGroupLevelChosen(lines, level)}>{showToLevelLabel(lines, level)}</ContextMenu.Item>,
                    )}</ContextMenu.SubmenuPopup></ContextMenu.Submenu>)}</>;
  };
  let copyItem = <ContextMenu.Item icon="Copy" shortcut="cmd+c" onClick={() => onCopyOrCutChosen('copy')}>{sheetMessages.copy()}</ContextMenu.Item>;
  let makeChartItem =
    canInsertChart &&
    (<ContextMenu.Item icon="Chart" onClick={({ detail }) => onChartCardAsked(detail === 0)}>{CHART_MESSAGES.makeChart()}</ContextMenu.Item>);
  let makeChartItemShown = makeChartLatched.isIn && !isOfContextBar && makeChartItem;
  let isPivotTableOffered = formatAsTableOffer !== null || ownFilterOffers?.filter.kind === 'remove';
  let pivotTableItem =
    (isActiveCellOfPivotTable || isPivotTableOffered) &&
    <ContextMenu.Item icon="Table" onClick={onPivotTableAsked}>{isActiveCellOfPivotTable ? pivotTableMessages.edit() : pivotTableMessages.pivotTable()}</ContextMenu.Item>;
  let clearSubmenu = <ContextMenu.Submenu><ContextMenu.SubmenuTrigger icon="Eraser">{sheetMessages.clear()}</ContextMenu.SubmenuTrigger><ContextMenu.SubmenuPopup {...contextBarPartProps}><ContextMenu.Item aria-label={sheetMessages.clearContents()} shortcut="backspace" onClick={onClearChosen}>{sheetMessages.contentsToClear()}</ContextMenu.Item><ContextMenu.Item aria-label={sheetMessages.clearFormatting()} shortcut={shortcutFor('clearFormatting')} onClick={() =>
              onFormatChosen({
                clearsFormatting: true,
              })}>{sheetMessages.formattingToClear()}</ContextMenu.Item></ContextMenu.SubmenuPopup></ContextMenu.Submenu>;
  let filterItems =
    ownFilterOffers !== null &&
    (<>{!holdsNoEdits &&
          <ContextMenu.Item icon="FilterLines" onClick={onSortAndFilterAsked}>{sortAndFilterMessages.sortAndFilter()}</ContextMenu.Item>}{ownFilterOffers.filter.kind === 'turnOn'
          ? holdsNoEdits &&
            <ContextMenu.Item icon="FilterLines" onClick={onOwnFilterAsked}>{filterMessages.filter()}</ContextMenu.Item>
          : (<ContextMenu.Item icon="FilterLines" onClick={() => {
                if (ownFilterOffers.filter.kind === 'remove') onOwnFilterRemoved(ownFilterOffers.filter.tableKey);
              }}>{filterMessages.clearFilter()}</ContextMenu.Item>)}{ownFilterOffers.valueOfCell !== null &&
          <><ContextMenu.Item icon="FilterLines" onClick={() => onOwnFilterByCellChosen('only')}><bdi className="sheet-menu-value">{showOnlyValueLabel(ownFilterOffers.valueOfCell)}</bdi></ContextMenu.Item><ContextMenu.Item icon="FilterLines" onClick={() => onOwnFilterByCellChosen('allBut')}><bdi className="sheet-menu-value">{leaveOutValueLabel(ownFilterOffers.valueOfCell)}</bdi></ContextMenu.Item></>}</>);
  let formatAsTableItem =
    formatAsTableOffer !== null &&
    (<ContextMenu.Item {...(holdsNoEdits && {
        icon: 'Table',
      })} checked={formatAsTableOffer.isOn} onClick={() => onFormatAsTableChosen(!formatAsTableOffer.isOn)}>{sheetMessages.formatAsTable()}</ContextMenu.Item>);
  let figureItems =
    figures !== null &&
    SUM_BAR_AGGREGATES.map(
      (aggregate) =>
        <ContextMenu.Item key={aggregate} onClick={() => onFigureChosen(aggregate)}>{figureWithValueLabel(aggregate, formatNumberWithSigns(figures[aggregate], figures.signsOfNumbers))}</ContextMenu.Item>,
    );
  let isLinkByHandOffered = !isOfContextBar && selectionIsOf === 'cells' && linkByHandOffered !== null;
  let isLinkEdit = isLinkByHandOffered && linkByHandOffered === 'edit';
  let linkByHandItem = <MenuItemWithWhyOff icon={linkByHandOffered === 'edit' ? 'Edit' : 'Link'} {...(doesKeyOpenLinkForm && {
      shortcut: shortcutKeysFor('addLink'),
    })} disabled={linkByHandOffered === 'notOnFormula'} whyOff={linkByHandOffered === 'notOnFormula' ? linkEditMessages.whyNoLinkByHand() : null} isPointerCoarse={isPointerCoarse} onClick={onLinkFormAsked}>{linkByHandOffered === 'edit' ? sheetMessages.editLink() : linkEditMessages.insertLink()}</MenuItemWithWhyOff>;
  let menuCommands = (): MenuCommand[] =>
    cellMenuCommands({
      ...(isOpen ? menuProps : keptMenuProps),
      iconOfChange,
      keyThatPastes,
      onLinkOpened,
      onLinkCopied,
      onLinkFormAsked,
      onCopyOrCutChosen,
      onPasteChosen,
      onCommentChosen,
      onClearChosen,
      onChangeChosen,
      onSortAndFilterAsked,
      onOwnFilterByCellChosen,
      onOwnFilterRemoved,
      onFormatAsTableChosen,
      onFreezeChosen,
      onFormatChosen,
      onConditionalFormatsAsked,
      onSortPaneAsked,
      onCellHistoryAsked,
      onPivotTableAsked,
    });
  const areRulesSuggested = isFieldOnTop && rulesSuggested !== null;
  let ruleSuggestionCommands = suggestedRuleCommands(areRulesSuggested ? rulesSuggested : [], {
    onPointedAt: onSuggestedRulePointedAt,
    onTaken: onSuggestedRuleTaken,
  });
  let ruleCommandsOfMenu = areRulesSuggested ? ruleCommands(onRulesAsked) : [];
  let suggestedRuleOf = ({ id }: Pick<SearchableCommand, 'id'>) => ruleSuggestionCommands.find((suggestion) => suggestion.id === id);
  let commandsCache: CommandsOfMenu | null = null;
  let gatherCommands = (): CommandsOfMenu => {
    let ownCommands = menuCommands();
    return {
      idsOfMenu: new Set([...ownCommands, ...ruleSuggestionCommands, ...ruleCommandsOfMenu].map(({ id }) => id)),
      all: [
        ...mergeMenuAndBarCommands(ownCommands, commandsOfBar()).filter(
          ({ id }) => !areRulesSuggested || id !== 'menu.conditionalFormatting',
        ),
        ...ruleSuggestionCommands,
        ...ruleCommandsOfMenu,
      ],
    };
  };
  let commandsOfMenu = () => ((commandsCache ??= gatherCommands()), commandsCache);
  let littleWords = React.useMemo(() => toolSearchMessages.littleWords(), []);
  let namesOfAgent = React.useMemo(() => toolSearchMessages.namesOfAgent(), []);
  let namesAgent = (text: string) =>
    normalizeMenuWords(text)
      .split(/[^\p{L}\p{M}\p{N}]+/u)
      .some((word) => word !== '' && namesOfAgent.has(word));
  let wordsOfAQuestion = React.useMemo(() => toolSearchMessages.wordsOfAQuestion(), []);
  let isQuestion = (text: string) =>
    normalizeMenuWords(text)
      .split(/[^\p{L}\p{M}\p{N}]+/u)
      .some((word) => word !== '' && wordsOfAQuestion.has(word));
  let typedCommandsCache = new Map<string, TypedCommands>();
  let typedCommandsOf = (query: string) => {
    let cached = typedCommandsCache.get(query);
    if (cached !== undefined) return cached;
    let ofTyped = commandsOfTyped(query);
    let found: TypedCommands = {
      ofTyped,
      byName: ofTyped === null ? commandsByName(query) : [],
    };
    typedCommandsCache.set(query, found);
    return found;
  };
  let commandsOfTypedWords = (query: string) => typedCommandsOf(query).ofTyped;
  let commandsNamedBy = (query: string) => typedCommandsOf(query).byName;
  let guessedCommands = (query: string): MenuCommand[] => {
    let commands = commandsOfMenu().all.filter(({ id }) => !id.startsWith('menu.ownFilter.'));
    let corrected = correctedCommandQuery(commands, query, littleWords);
    let found = (
      corrected === null ? [] : searchCommands(commands.map(asEnabledCommand), corrected, MAX_COMMANDS_FOUND, littleWords)
    ).flatMap(({ id }) => commands.find((command) => command.id === id) ?? []);
    let sharesDistinctWord = commandMatchesDistinctWord(commands, corrected ?? query, littleWords);
    let fewest = (candidates: readonly MenuCommand[]) =>
      oneCommandPerStem(candidates.filter((command) => isLightCommand(command) && sharesDistinctWord(command))).slice(
        0,
        MAX_GUESSED_COMMANDS,
      );
    let [first] = found;
    if (first !== undefined) return isLightCommand(first) ? fewest(found) : [];
    if (isQuestion(query)) return [];
    return fewest(commandsSharingWords(commands.filter(isCommandEnabled), corrected ?? query, littleWords));
  };
  let commandsLabelled = (query: string) => {
    let labelled = commandsOfMenu().all.filter(({ label }) => labelsMatch(label, query));
    return labelled.some(isCommandEnabled) ? [] : labelled;
  };
  let foundCommandsCache = new Map<string, FoundCommands>();
  let foundCommands = (query: string) => {
    let found = foundCommandsCache.get(query) ?? findCommands(query);
    foundCommandsCache.set(query, found);
    return found;
  };
  let findCommands = (query: string): FoundCommands => {
    let sure = commandsFound(query);
    let commands = sure ?? guessedCommands(query);
    return {
      commands,
      isGuess: sure === null && commands.length > 0,
    };
  };
  let commandsFound = (query: string): MenuCommand[] | null => {
    let ofTyped = commandsOfTypedWords(query);
    if (ofTyped !== null) return ofTyped.commands.filter(isCommandEnabled);
    let labelled = commandsLabelled(query);
    if (labelled.length > 0) return labelled;
    if (namesAgent(query)) return [];
    let found = searchCommands(commandsOfMenu().all.filter(isCommandEnabled), query, MAX_COMMANDS_FOUND, littleWords);
    if (found.length > 0) return suggestedRulesFirst(found, query);
    if (
      wordsToFind(query) !== null ||
      searchCommands(commandsOfMenu().all, query, 1, littleWords).length > 0 ||
      commandsNamedBy(query).some(({ commands }) => commands.length > 0)
    )
      return [];
    let [, beforeBy] = /^(.+?)\sby\s/i.exec(query.trim()) ?? [];
    let sortCommands = commandsOfMenu()
      .all.filter(({ id, whyNot }) => whyNot === null && /\.(customSort|sortAndFilter)(\.|$)/.test(id))
      .map(withSingleOtherWords);
    let sortFound = (beforeBy === undefined ? [] : searchCommands(sortCommands, beforeBy, MAX_COMMANDS_FOUND, littleWords)).flatMap(
      ({ id }) => commandsOfMenu().all.find((command) => command.id === id) ?? [],
    );
    return sortFound.length > 0 ? sortFound : null;
  };
  let isSearchTyped = (query: string) => hasSearchWords(query) || commandsOfTypedWords(query) !== null;
  let [shownFind, setShownFind] = React.useState<ShownFind | null>(null);
  let isSearching = isFieldOnTop && isSearchTyped(typed);
  if (isSearching && (shownFind?.words !== typed || shownFind.hadRules !== areRulesSuggested)) {
    let foundIds = foundCommands(typed).commands.map(({ id }) => id);
    let isNewlyOutOfUse = (command: MenuCommand) => !isCommandEnabled(command) && !foundIds.includes(command.id);
    setShownFind({
      words: typed,
      ids: foundIds,
      isOfNamedOutOfUse: commandsOfTypedWords(typed) === null && commandsLabelled(typed).length > 0,
      isGuess: foundCommands(typed).isGuess,
      idsOutOfUse: (
        commandsOfTypedWords(typed)?.commands.filter(isNewlyOutOfUse) ??
        searchCommands(commandsOfMenu().all.filter(isNewlyOutOfUse), typed, MAX_COMMANDS_FOUND, littleWords)
      ).map(({ id }) => id),
      hadRules: areRulesSuggested,
    });
  }
  if (!isSearching && shownFind !== null) setShownFind(null);
  let commandsWithIds = (query: string, ids: readonly string[]) => {
    let commands = commandsOfTypedWords(query)?.commands ?? commandsOfMenu().all;
    return ids.flatMap((id) => commands.find((command) => command.id === id) ?? []);
  };
  let idsBackInUse =
    isSearching && shownFind?.words === typed
      ? commandsWithIds(typed, shownFind.idsOutOfUse)
          .filter(isCommandEnabled)
          .map(({ id }) => id)
      : [];
  if (shownFind !== null && shownFind.hadRules === areRulesSuggested && idsBackInUse.length > 0)
    setShownFind({
      ...shownFind,
      ids: [...shownFind.ids, ...idsBackInUse],
      idsOutOfUse: shownFind.idsOutOfUse.filter((id) => !idsBackInUse.includes(id)),
    });
  let isOfNamedOutOfUse = (query: string) =>
    shownFind?.words === query ? shownFind.isOfNamedOutOfUse : commandsOfTypedWords(query) === null && commandsLabelled(query).length > 0;
  let rowsFor = (query: string) =>
    shownFind?.words === query ? commandsWithIds(query, shownFind.ids) : foundCommands(query).commands;
  let isGuessFor = (query: string) => (shownFind?.words === query ? shownFind.isGuess : foundCommands(query).isGuess);
  let ruleTryOn = useRuleTryOn(
    isOpen && isSearching ? rowsFor(typed).flatMap((command) => suggestedRuleOf(command) ?? []) : [],
  );
  let [anchorDoneWith, setAnchorDoneWith] = React.useState<AnchorOnPage | null>(null);
  let takeCommand = (command: MenuCommand, isByKey: boolean) =>
    onCommandTaken(isByKey, () => {
      if (command.keepsOpen !== true) setAnchorDoneWith(anchor);
      if (
        (!commandsOfMenu().idsOfMenu.has(command.id) || (handyman.state.is !== 'resting' && isTextStyleMenuCommand(command.id))) &&
        command.keepsOpen !== true
      )
        onClosed();
      command.run();
    });
  let stopRule = () => {
    onRuleStopped();
    onRuleLetGo();
    handyman.noteRuleLetGo();
  };
  let barCommands = () =>
    mergeMenuAndBarCommands(menuCommands(), commandsOfBar(), {
      runsAs: 'bar',
    });
  let askHandyman = (query: string) => handymanHook.ask(query, barCommands(), canRuleBeAskedInWords);
  let handyman =
    handymanHook.state.is === 'answered'
      ? {
          ...handymanHook,
          state: withCommandsOfNow(handymanHook.state, barCommands(), toolUnavailableText),
        }
      : handymanHook;
  let askHandymanAgain = (query: string) => {
    onRuleLetGo();
    askHandyman(query);
  };
  let canAttachToChat = isChatToBeHad === true && hasAddressForAgent;
  let askContext = () => ({
    isFieldOnTop,
    isChatToBeHad,
    isCommentOffered,
    doCellsShowError,
    couldCommentGoToAgent: couldCommentGoToAgent(),
  });
  let canAttach = canAttachToChat || (hasAddressForAgent && isCommentToAgentOffered(askContext()));
  let isCutByOwnFilters = isSelectionCutByOwnFilters && canAskAgentHere(askContext());
  let isCutByOwnSort = isSelectionCutByOwnSort && canAskAgentHere(askContext());
  let isPlaceToAsk = (query: string, rows: readonly MenuCommand[]) =>
    (rows.length === 0 || isGuessFor(query) || /\s/.test(query.trim())) && !isOfContextBar;
  let offersSuggestTools = (query: string, rows: readonly MenuCommand[]) => isPlaceToAsk(query, rows) && isAgentHadForTools;
  let enterFindCache = new Map<string, EnterFind>();
  let enterFindOf = (query: string) => {
    let cached = enterFindCache.get(query);
    if (cached !== undefined) return cached;
    let commands = commandsOfMenu().all.map(asEnabledCommand);
    let found = searchCommands(commands, query, MAX_COMMANDS_FOUND, littleWords);
    let enterFind: EnterFind = {
      isAnyFound: found.length > 0,
      idTaken: commandToRunForQuery(found, query, commands, littleWords)?.id ?? null,
    };
    enterFindCache.set(query, enterFind);
    return enterFind;
  };
  let isEnterSureOf = (query: string, command: Pick<SearchableCommand, 'id'>) =>
    commandsOfMenu().all.every(isCommandEnabled) || enterFindOf(query).idTaken === command.id;
  let isAnyFoundFor = (query: string) => enterFindOf(query).isAnyFound;
  let isAskAgentShown = askAgentLatched.isIn && !isOfContextBar;
  let whatEnterDoes = (query: string, rows: readonly MenuCommand[]): WhatEnterDoes => {
    let sureRows = isGuessFor(query) ? [] : rows;
    let ofTyped = commandsOfTypedWords(query);
    let command =
      ofTyped === null
        ? commandToRunForQuery(sureRows, query, commandsOfMenu().all, littleWords)
        : ofTyped.isFirstMeant
          ? commandToRunForQuery(sureRows, null)
          : null;
    if (command !== null && (ofTyped !== null || isEnterSureOf(query, command)))
      return {
        does: 'takes',
        command,
      };
    if (sureRows.length > 0 && !sureRows.some(isCommandEnabled))
      return {
        does: isOfNamedOutOfUse(query) ? 'showsWhyNot' : 'nothing',
      };
    if (isRememberedCommandOutOfUse(rememberedCommand, query, commandsOfMenu().all))
      return {
        does: 'nothing',
      };
    let namedCommand = commandToRunForQuery(
      commandsNamedBy(query).flatMap(({ commands }) => commands),
      null,
    );
    let hasOtherUse =
      sureRows.some(isCommandEnabled) || (namedCommand !== null && (isFunctionCommand(namedCommand) || isGoToTyped(query) || isAnyFoundFor(query)));
    if (!hasOtherUse && namedCommand !== null)
      return {
        does: 'takes',
        command: namedCommand,
      };
    let findWords = hasOtherUse ? null : wordsToFind(query);
    if (findWords !== null)
      return {
        does: 'finds',
        words: findWords,
      };
    let asks = whatAskFieldDoes({
      isPlaceToAsk: isPlaceToAsk(query, sureRows),
      isAgentToBeHadForTools: isAgentHadForTools,
      canAskAgent: isAskAgentShown && canAttach,
    });
    if (asks === 'tools')
      return {
        does: 'asksForTools',
      };
    let wouldLeaveSheet = askAgentVia(askContext()) === 'chat' && mightChatLeaveSheet();
    if (asks === 'agent' && !wouldLeaveSheet)
      return {
        does: 'asksAgent',
      };
    let words = wordsToFind(query) ?? query.trim();
    return words === ''
      ? {
          does: 'nothing',
        }
      : {
          does: 'finds',
          words,
        };
  };
  let enteredCommandOf = (command: MenuCommand, words: string): EnteredCommand => ({
    commandId: command.id,
    label: command.label,
    words,
    isWeighty: command.isWeighty === true,
    isItsLabelAlone: labelMatchesWordsInOrder(command, words, littleWords),
  });
  let commandAskedAgainOf = (query: string) => {
    if (askedToConfirm === null || handyman.state.is !== 'resting') return null;
    let enter = whatEnterDoes(query, rowsFor(query));
    return enter.does === 'takes' && isCommandAskedAgain(askedToConfirm, enteredCommandOf(enter.command, query)) ? enter.command : null;
  };
  let enterMeaningOf = (query: string): EnterMeaningKind => {
    if (!isSearchTyped(query)) return 'none';
    let rows = rowsFor(query);
    let { does } = whatEnterDoes(query, rows);
    if (does === 'takes') return 'command';
    let hasOtherRows = rows.some(isCommandEnabled) || commandsNamedBy(query).length > 0;
    return does === 'showsWhyNot' || does === 'nothing' || hasOtherRows ? 'none' : 'ask';
  };
  let askAgentNow = () => {
    if (askAgentVia(askContext()) === 'comment') onAgentAskedInComment();
    else onAgentAsked(doCellsShowError);
  };
  let askAgentRow = (isUnderEnter = false) =>
    <CommentNextRow isUnderEnter={isUnderEnter} isIn={askAgentLatched.isIn} isMenuOfContextBar={isOfContextBar} canAttach={canAttach} isOneRangeNeeded={isOneRangeNeeded} isCutByOwnFilters={isCutByOwnFilters} isCutByOwnSort={isCutByOwnSort} doCellsShowError={doCellsShowError} isPointerCoarse={isPointerCoarse} onAsked={askAgentNow} />;
  let findInSheet = (words: string) => {
    setAnchorDoneWith(anchor);
    onClosed();
    onFindAskedFor(words);
  };
  let describeCommand = ({ id }: Pick<MenuCommand, 'id'>) =>
    id === 'menu.openLink' && linkToOpen !== null ? shortBreakableUrl(linkToOpen) : null;
  let hintOfCommand = (command: MenuCommand) =>
    commandHint(command, {
      activeCell: addressOfActiveCell,
      cellCount: selectedCellCount,
    });
  let searchField: CellMenuField = {
    name: sheetMessages.searchInCellsMenu(),
    typed,
    mostUnits: MAX_MENU_FIELD_LENGTH,
    onTyped(text) {
      let clipped = clipMenuFieldText(text);
      if (typed === '' && clipped !== '') onSearchBegun();
      setTyped(clipped);
      handyman.noteTyped(clipped);
      if (clipped.trim() !== typed.trim() && rulesInMenu !== null) onRuleLetGo();
      setEnterMeaning(nextEnterMeaning(enterMeaning, enterMeaningOf(clipped), nowMs()));
      setAskedToConfirm(null);
    },
    takesCaretAtFirst: !wasAskedByKey && !isShut && !isWindowLeft && isOpen,
    isRowToTakeKeyboard: wasAskedByKey && !isShut && !isWindowLeft && isOpen,
    ...(!wasAskedToSearch && {
      onPastedWithNothingTyped: onPasteMeantForCells,
    }),
    hasRowsAtRest: !wasAskedToSearch,
    renderRowsFor(query) {
      if (!isSearchTyped(query)) return null;
      if (handyman.state.is !== 'resting')
        return <><MenuFieldFocusKeeper isMenuOpen={isOpen} /><HandymanRows handyman={handyman} rules={rulesInMenu} onRuleKept={onRuleKept} onRuleStopped={stopRule} onAskedAgain={() => askHandymanAgain(query)} isPointerCoarse={isPointerCoarse} describe={describeCommand} hintOf={hintOfCommand} onTaken={takeCommand} wayOnToChat={<>{askAgentLatched.isIn && <ContextMenu.Separator />}{askAgentRow()}</>} /></>;
      let rows = rowsFor(query);
      let enter = whatEnterDoes(query, rows);
      let offersTools = offersSuggestTools(query, rows);
      let isNoneEnabled =
        !rows.some(({ whyNot }) => whyNot === null) && enter.does !== 'finds' && enter.does !== 'showsWhyNot';
      let asksSomeone = enter.does === 'asksForTools' || enter.does === 'asksAgent';
      let groups = groupFoundCommands(
        rows.map(
          (row) =>
            enter.does === 'takes' && enter.command.id === row.id
              ? {
                  ...row,
                  isUnderEnter: true,
                }
              : row,
        ),
      );
      let idOfRowAskedAgain = commandAskedAgainOf(query)?.id ?? null;
      let commandRows = (commands: readonly MenuCommand[]) =>
        <CommandRows commands={commands} isRowUnderEnterLit idOfRowAskedAgain={idOfRowAskedAgain} hintOf={(command) => (suggestedRuleOf(command) === undefined ? hintOfCommand(command) : null)} isPointerCoarse={isPointerCoarse} describe={(command) => suggestedRuleOf(command)?.where ?? describeCommand(command)} onPointedAt={ruleTryOn.tryOnCells} onTaken={(command, isByKey) => {
            ruleTryOn.noteTaken();
            takeCommand(command, isByKey);
          }} />;
      let namedGroups = commandsNamedBy(query).map(
        ({ heading, commands }) => ({
          heading,
          commands: commands.map(
            (command) =>
              enter.does === 'takes' && enter.command.id === command.id
                ? {
                    ...command,
                    isUnderEnter: true,
                  }
                : command,
          ),
        }),
      );
      let openersGroup = namedGroups.length === 0 && groups.at(-1)?.isOfWhatOpens === true ? groups.at(-1) : undefined;
      let hasOpenersAmongGroups = openersGroup === undefined && groups.some((group) => group.isOfWhatOpens);
      let askRows = <>{offersTools &&
            <SuggestToolsItem isUnderEnter={enter.does === 'asksForTools'} onAsked={() => askHandyman(query)} />}{isAskAgentShown && askAgentRow(enter.does === 'asksAgent')}</>;
      let hasAskRows = offersTools || isAskAgentShown;
      let findWords = wordsToFind(query) ?? query.trim();
      let isFindLabelled =
        wordsToFind(query) !== null &&
        rows.some(
          ({ label, whyNot }) => whyNot === null && label.toLowerCase().startsWith(query.trim().toLowerCase()),
        );
      let shownGroups = [...groups.filter((group) => group !== openersGroup), ...namedGroups];
      let findItem =
        (!isFindLabelled || enter.does === 'finds') &&
        (<FindInSheetItem words={findWords} isUnderEnter={enter.does === 'finds'} hint={commandGroupMessages.topBar()} onAsked={() => findInSheet(findWords)} />);
      let isFindFirst = enter.does === 'finds' && shownGroups.length > 0;
      return <><MenuFieldFocusKeeper isMenuOpen={isOpen} />{isOpen &&
            <SuggestedRulesWanted onAsked={onSuggestedRulesWanted} />}{asksSomeone && askRows}{isFindFirst && findItem}{(asksSomeone || isFindFirst) && shownGroups[0]?.heading === null && <ContextMenu.Separator />}{shownGroups.map(
            ({ heading, commands }, index) =>
              (<ContextMenu.Group key={heading ?? ''}>{heading === null && index > 0 && <ContextMenu.Separator />}{heading !== null &&
                      <Menu.GroupLabel>{heading}</Menu.GroupLabel>}{commandRows(commands)}</ContextMenu.Group>),
          )}{rows.length === 0 &&
            namedGroups.length === 0 &&
            !hasAskRows &&
            <div className="px-md py-sm text-footnote text-muted">{menuMatchCountWords(0)}</div>}{!asksSomeone && isNoneEnabled && hasAskRows && shownGroups.length > 0 && <ContextMenu.Separator />}{!asksSomeone && isNoneEnabled && askRows}{(!isFindFirst || openersGroup !== undefined || hasAskRows) &&
            (<ContextMenu.Group>{hasOpenersAmongGroups
                  ? <ContextMenu.Separator />
                  : <Menu.GroupLabel>{commandGroupMessages.open()}</Menu.GroupLabel>}{enter.does !== 'finds' && openersGroup !== undefined && commandRows(openersGroup.commands)}{!isFindFirst && findItem}{enter.does === 'finds' && openersGroup !== undefined && commandRows(openersGroup.commands)}{!asksSomeone && !isNoneEnabled && askRows}</ContextMenu.Group>)}</>;
    },
    onEntered(query) {
      if (!isOpen || anchorDoneWith === anchor) return 'stay';
      if (handyman.state.is !== 'resting') return enterOnHandyman(handyman, takeCommand, onRuleKept, () => askHandymanAgain(query));
      let enter = whatEnterDoes(query, rowsFor(query));
      let isMeaningSettled = isEnterMeaningSettled(enterMeaning, nowMs());
      if (enter.does !== 'takes' && !isMeaningSettled) return 'stay';
      switch (enter.does) {
        case 'takes': {
          let entered = enteredCommandOf(enter.command, query);
          let outcome = enterOnTypedCommand(askedToConfirm, entered, isMeaningSettled);
          if (outcome === 'asks') setAskedToConfirm(entered);
          if (outcome !== 'takes') return 'stay';
          setAskedToConfirm(null);
          if ((takeCommand(enter.command, true), enter.command.keepsOpen !== true)) return 'shut';
          setRememberedCommand({
            id: enter.command.id,
            words: query,
          });
          return 'stay';
        }
        case 'finds':
          findInSheet(enter.words);
          return 'shut';
        case 'asksForTools':
          askHandyman(query);
          return 'stay';
        case 'asksAgent':
          setAnchorDoneWith(anchor);
          askAgentNow();
          return 'shut';
        case 'showsWhyNot':
          return 'lightOutOfUse';
        case 'nothing':
          return 'stay';
      }
    },
    onShutByEnter: onClosed,
    saidOf(query, isSettled = true) {
      let rows = rowsFor(query);
      let enter = whatEnterDoes(query, rows);
      let enterWords = (
        {
          takes: enter.does === 'takes' ? enter.command.label : null,
          finds: enter.does === 'finds' ? findInSheetLabel(enter.words) : null,
          asksForTools: toolSearchMessages.suggestTools(),
          asksAgent: askAgentMenuLabel(doCellsShowError),
          showsWhyNot: null,
          nothing: null,
        } satisfies Record<WhatEnterDoes['does'], string | null>
      )[enter.does];
      let whyNot = isOfNamedOutOfUse(query) ? (rows[0]?.whyNot ?? null) : null;
      if (whyNot !== null) return whyNot;
      let sayEnter = enterWords === null || !isSettled ? null : enterWords;
      let count = rows.length + commandsNamedBy(query).flatMap(({ commands }) => commands).length;
      return sayEnter === null ? menuMatchCountWords(count) : menuMatchCountChooseRowWords(count, sayEnter);
    },
  };
  let isAnnouncing = isOpen && !isShut && anchorDoneWith !== anchor && isSearching;
  let handymanWords = handymanStatusWords(handyman.state, rulesInMenu, menuMatchCountWords);
  let commandAskedAgain = commandAskedAgainOf(typed);
  if (askedToConfirm !== null && commandAskedAgain === null) setAskedToConfirm(null);
  let confirmAgainWords = commandAskedAgain === null ? null : pressEnterAgainToConfirmWords(commandAskedAgain.label);
  return <div className="contents" onPointerDown={({ pointerType }) => {
      if (pointerType !== 'touch') onClosed();
    }} onContextMenu={(event) => {
      if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
    }} onPointerMove={({ target }) => {
      if (commandAskedAgain === null || !(target instanceof Element)) return;
      let row = target.closest('[role^="menuitem"]');
      if (row !== null && row.getAttribute('data-command') !== commandAskedAgain.id) setAskedToConfirm(null);
    }}><TypedSearchAnnouncer typed={typed} found={(isNotComposing) => isAnnouncing && handymanWords === null && confirmAgainWords === null && searchField.saidOf(typed, isNotComposing)} atOnce={isAnnouncing ? (confirmAgainWords ?? handymanWords) : null} /><ContextMenu.Root open={isOpen && !isShut} onOpenChange={(open, details) => {
          if (touchGuardCancelsClose(CELL_MENU_TOUCH_GUARD, open, details)) return;
          if (open) return;
          swallowPressAfterItemPress(details.reason, details.event);
          onClosed();
        }}><MenuWithField field={isFieldOnTop ? searchField : null} ref={menuRef} {...(!isOfContextBar && {
            [MENU_ON_CELLS_ATTRIBUTE]: '',
          })} {...contextBarPartProps} {...(isOfHandleOfTable && {
            [MENU_OF_HANDLE_ATTRIBUTE]: '',
          })} {...ofChart?.mark} aria-label={holdsOnlyFigures
            ? sheetMessages.figures()
            : isOfHandleOfTable
              ? sheetMessages.menuOfTable()
              : ofChart !== null
                ? chartMessages.menuOfChart()
                : sheetMessages.menu()} anchor={anchor} isOpen={isOpen} side={side ?? undefined} {...collisionProps} finalFocus={whatHasCaretAfter} onPointerDown={(event) => event.stopPropagation()} onKeyDownCapture={(event) => {
            let dropsAskedAgain = commandAskedAgain !== null && doesKeyDropAskedAgain(event.key, event.repeat);
            if (dropsAskedAgain) setAskedToConfirm(null);
            if (isOfHandleOfTable) {
              let litIndex = [...event.currentTarget.querySelectorAll('[role^="menuitem"]')].findIndex(
                (item) => item.hasAttribute('data-highlighted'),
              );
              onKeyDownInMenuOfHandle(event, litIndex === -1 ? 'none' : litIndex === 0 ? 'first' : 'other');
            }
            if (event.isPropagationStopped()) return;
            if (dropsAskedAgain && event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            let doesEscapeStepBack = rulesInMenu?.doesEscapeStepBack === true;
            if (event.key === 'Escape' && (handyman.state.is === 'asking' || doesEscapeStepBack)) {
              event.preventDefault();
              event.stopPropagation();
              if (doesEscapeStepBack) stopRule();
              else handyman.stop();
              return;
            }
            let opensLink = (linkToOpen ?? linkToCopy) !== null && event.key === 'Enter' && isOnlyAltPressed(event);
            let isRepeatedPress = event.repeat && (event.key === 'Enter' || event.key === ' ');
            if (!opensLink && !isRepeatedPress) return;
            event.preventDefault();
            event.stopPropagation();
            let openLinkItem = openLinkItemRef.current ?? enabledCommandRow('menu.openLink', event.currentTarget);
            if (!isRepeatedPress) openLinkItem?.click();
            if (isRepeatedPress || linkToCopy === null) return;
            onClosed();
            onLinkCardAsked();
          }} onMouseUpCapture={(event) => {
            let { x: anchorX, y: anchorY } = anchor.getBoundingClientRect();
            let isAtAnchor = Math.hypot(event.clientX - anchorX, event.clientY - anchorY) < 4;
            if (event.button === 2 && isAtAnchor) event.stopPropagation();
          }} onFocus={({ target, currentTarget, relatedTarget }) => {
            if (isOpen && !isShut) focusedInMenuRef.current = target;
            if (commandAskedAgain !== null && target.matches('[role^="menuitem"]') && target.getAttribute('data-command') !== commandAskedAgain.id)
              setAskedToConfirm(null);
            if (!isAskedByKey || target !== currentTarget) return;
            if (currentTarget.contains(relatedTarget)) return;
            currentTarget
              .querySelector<HTMLElement>('[role^="menuitem"]:is(:not([aria-disabled="true"]), [data-keeps-highlight]):not([data-not-lit-first])')
              ?.focus({
                focusVisible: true,
              });
          }}>{holdsNoEdits &&
              isCommentOffered &&
              !isOfContextBar &&
              <><ContextMenu.Item icon="Comment" shortcut="alt+cmd+m" onClick={onCommentChosen}>{sheetMessages.comment()}</ContextMenu.Item><ContextMenu.Separator /></>}{holdsNoEdits &&
              <>{copyItem}{ownFilterOffers !== null && <ContextMenu.Separator />}{filterItems}{formatAsTableOffer !== null && <ContextMenu.Separator />}{formatAsTableItem}</>}{isOfHandleOfTable &&
              (<><ContextMenu.Item icon="FilterLines" onClick={onSortAndFilterAsked}>{sortAndFilterMessages.sortAndFilter()}</ContextMenu.Item>{makeChartItem}{copyItem}{formatAsTableOffer?.isOn === true &&
                    <><ContextMenu.Separator /><ContextMenu.Item icon="Table" onClick={() => onFormatAsTableChosen(false)}>{sheetMessages.removeTableFormat()}</ContextMenu.Item></>}</>)}{ofChart !== null &&
              (<>{ofChart.canAgentChangeIt &&
                    <><ContextMenu.Item icon="Edit" onClick={() => cardUnderChart.current?.edit(ofChart.placementId)}>{chartMessages.editWithAgent()}</ContextMenu.Item><ContextMenu.Separator /></>}<ContextMenu.Item icon="Copy" shortcut="cmd+c" onClick={onChartCopyChosen}>{chartMessages.copyChart()}</ContextMenu.Item><ContextMenu.Separator /><ContextMenu.Item variant="danger" icon="Trash" shortcut="backspace" onClick={({ detail }) => onChartDeleteChosen(detail === 0)}>{chartMessages.deleteChart()}</ContextMenu.Item></>)}{!holdsOnlyFigures &&
              !holdsNoEdits &&
              !isOfHandleOfTable &&
              ofChart === null &&
              (<>{isOpen &&
                    isFieldOnTop &&
                    <SuggestedRulesWanted onAsked={onSuggestedRulesWanted} />}<AskAgentMenuItems isIn={askAgentLatched.isIn || fixLatched.isIn} isMenuOfContextBar={isOfContextBar} canAttach={isFieldOnTop ? canAttach : canAttachToChat} isOneRangeNeeded={isOneRangeNeeded} isCutByOwnFilters={isCutByOwnFilters} isCutByOwnSort={isCutByOwnSort} doCellsShowError={doCellsShowError} isPointerCoarse={isPointerCoarse} isCommentNext={isCommentOffered} onAsked={isFieldOnTop ? askAgentNow : onAgentAsked} onFixAsked={canActiveCellBeFixedHere ? onFixAsked : null} isFixYetToBeKnown={isFixOfActiveCellYetToBeKnown || (!askAgentLatched.isIn && !canActiveCellBeFixedHere)} />{isCommentOffered &&
                    (<><ContextMenu.Item icon="Comment" shortcut="alt+cmd+m" {...(isOfContextBar && {
                            'data-not-lit-first': '',
                          })} onClick={onCommentChosen}>{sheetMessages.comment()}</ContextMenu.Item><ContextMenu.Separator /></>)}{linkToOpen !== null &&
                    <><ContextMenu.Item ref={openLinkItemRef} icon="ArrowOutSquare" shortcut={OPEN_LINK_SHORTCUT} description={shortBreakableUrl(linkToOpen)} descriptionDir="auto" onClick={() => onLinkOpened(linkToOpen)}>{sheetMessages.openLink()}</ContextMenu.Item>{!isLinkEdit && <ContextMenu.Separator />}</>}{linkToCopy !== null &&
                    <><ContextMenu.Item icon="Copy" description={isLinkInWordsBuilt ? builtLinkWarning(breakableUrlText(linkToCopy)) : breakableUrlText(linkToCopy)} descriptionDir="auto" onClick={() => onLinkCopied(linkToCopy)}>{sheetMessages.copyLinkAddress()}</ContextMenu.Item>{!isLinkEdit && <ContextMenu.Separator />}</>}{isLinkEdit &&
                    <>{linkByHandItem}<ContextMenu.Separator /></>}<MenuItemWithWhyOff icon="Scissors" shortcut="cmd+x" disabled={isOneRangeNeeded} whyOff={isOneRangeNeeded ? oneRangeNeededText('cut') : null} isPointerCoarse={isPointerCoarse} onClick={() => onCopyOrCutChosen('cut')}>{sheetMessages.cut()}</MenuItemWithWhyOff>{copyItem}<MenuItemWithWhyOff icon="Clipboard" shortcut="cmd+v" disabled={heldToPaste === null} whyOff={heldToPaste === null ? pasteFromMenuHint(keyThatPastes) : null} isPointerCoarse={isPointerCoarse} onClick={() => onPasteChosen('all')}>{sheetMessages.paste()}</MenuItemWithWhyOff><MenuItemWithWhyOff icon="PasteValues" shortcut="shift+cmd+v" disabled={!canPasteValuesOnly} whyOff={canPasteValuesOnly ? null : pasteValuesFromMenuHint(heldToPaste, keyThatPastes)} isPointerCoarse={isPointerCoarse} onClick={() => onPasteChosen('valuesOnly')}>{sheetMessages.pasteValuesOnly()}</MenuItemWithWhyOff><ContextMenu.Separator />{freezeItems()}{selectionIsOf === 'cells' &&
                    submenuOrOff({
                      icon: CHANGE_ICONS.insertRowAbove,
                      label: sheetMessages.insertRows(),
                      whyOff: isOneRangeNeeded ? oneRangeNeededText('insertRows') : null,
                      rows: <>{countedChangeItem('insertRowAbove', rowsAboveLabel, selectedRowCount)}{countedChangeItem('insertRowBelow', rowsBelowLabel, selectedRowCount)}</>,
                    })}{selectionIsOf === 'cells' &&
                    submenuOrOff({
                      icon: CHANGE_ICONS.insertColumnLeft,
                      label: sheetMessages.insertColumns(),
                      whyOff: isOneRangeNeeded ? oneRangeNeededText('insertColumns') : null,
                      rows: <>{countedChangeItem('insertColumnLeft', columnsLeftLabel, selectedColumnCount)}{countedChangeItem('insertColumnRight', columnsRightLabel, selectedColumnCount)}</>,
                    })}{selectionIsOf === 'cells' && makeChartItemShown}{selectionIsOf === 'cells' && pivotTableItem}{isLinkByHandOffered && !isLinkEdit && linkByHandItem}{selectionIsOf === 'rows' &&
                    <>{changeItem('insertRowAbove', insertRowsAboveLabel(selectedRowCount), false, null, shortcutFor('insertRowsOrColumns'))}{changeItem('insertRowBelow', insertRowsBelowLabel(selectedRowCount))}</>}{selectionIsOf === 'columns' &&
                    <>{changeItem('insertColumnLeft', insertColumnsLeftLabel(selectedColumnCount), false, null, shortcutFor('insertRowsOrColumns'))}{changeItem('insertColumnRight', insertColumnsRightLabel(selectedColumnCount))}</>}{selectionIsOf !== 'cells' && makeChartItemShown}{selectionIsOf === 'rows' &&
                    <><ContextMenu.Separator />{changeItem('moveRowsUp', moveRowsUpLabel(selectedRowCount), !canMoveSelectionBack)}{changeItem('moveRowsDown', moveRowsDownLabel(selectedRowCount), !canMoveSelectionOn)}</>}{selectionIsOf === 'columns' &&
                    <><ContextMenu.Separator />{changeItem('moveColumnsLeft', moveColumnsLeftLabel(selectedColumnCount), !canMoveSelectionBack)}{changeItem('moveColumnsRight', moveColumnsRightLabel(selectedColumnCount), !canMoveSelectionOn)}</>}<ContextMenu.Separator />{clearSubmenu}{areDropdownsSelected &&
                    (<ContextMenu.Item icon="Minus" onClick={() =>
                        onFormatChosen({
                          removesDropdown: true,
                        })}>{sheetMessages.removeDropdown()}</ContextMenu.Item>)}{selectionIsOf === 'cells' &&
                    submenuOrOff({
                      icon: 'Trash',
                      label: sheetMessages.deleteLines(),
                      whyOff: whyNoDeleteLines,
                      rows: (<>{countedChangeItem('deleteRows', rowCountLabel, selectedRowCount, !canDeleteSelectedRows, sheetMessages.sheetNeedsARow())}{countedChangeItem(
                            'deleteColumns',
                            columnCountLabel,
                            selectedColumnCount,
                            !canDeleteSelectedColumns,
                            sheetMessages.sheetNeedsAColumn(),
                          )}</>),
                    })}{selectionIsOf === 'rows' &&
                    changeItem(
                      'deleteRows',
                      deleteRowsLabel(selectedRowCount),
                      !canDeleteSelectedRows,
                      sheetMessages.sheetNeedsARow(),
                      shortcutFor('deleteRowsOrColumns'),
                    )}{selectionIsOf === 'columns' &&
                    changeItem(
                      'deleteColumns',
                      deleteColumnsLabel(selectedColumnCount),
                      !canDeleteSelectedColumns,
                      sheetMessages.sheetNeedsAColumn(),
                      shortcutFor('deleteRowsOrColumns'),
                    )}{(areWholeRowsSelected || areWholeColumnsSelected || groupChoices !== null) &&
                    <><ContextMenu.Separator />{areWholeRowsSelected && changeItem('resizeRows', resizeRowsLabel(rowCountToSize))}{areWholeColumnsSelected && changeItem('resizeColumns', resizeColumnsLabel(columnCountToSize))}{groupChoices !== null && groupItems(groupChoices)}</>}{columnToSortBy !== null &&
                    (<><ContextMenu.Separator />{selectedCellCount === 1
                          ? <ContextMenu.Submenu><ContextMenu.SubmenuTrigger icon="Sort">{sortMenuLabel()}</ContextMenu.SubmenuTrigger><ContextMenu.SubmenuPopup {...contextBarPartProps}>{sortGroup('sheet')}<ContextMenu.Separator /><ContextMenu.Item onClick={() => onSortPaneAsked('range')}>{customSortMessages.customSort()}</ContextMenu.Item></ContextMenu.SubmenuPopup></ContextMenu.Submenu>
                          : <>{canSortSelectedRange && sortSubmenu('range', columnToSortSelectedRangeBy)}{sortSubmenu('sheet', columnToSortBy)}</>}</>)}{ownFilterOffers !== null &&
                    <>{columnToSortBy === null && <ContextMenu.Separator />}{filterItems}</>}{freezeChoices !== null &&
                    selectionIsOf === 'cells' &&
                    (<>{columnToSortBy === null && ownFilterOffers === null && <ContextMenu.Separator />}<ContextMenu.Submenu><ContextMenu.SubmenuTrigger icon="Pin">{sheetMessages.freeze()}</ContextMenu.SubmenuTrigger><ContextMenu.SubmenuPopup {...contextBarPartProps}>{FREEZE_MENU_LINES.map(
                                ({ what, inWords, whyNoRoom }) =>
                                  (<React.Fragment key={what}>{what === 'columns' && <ContextMenu.Separator />}<ContextMenu.Group>{freezeChoices[what].map(
                                            ({ count, isInForce, isRoom }) =>
                                              <MenuItemWithWhyOff key={count} checked={isInForce} checkedRole="radio" disabled={!isRoom} whyOff={isRoom ? null : whyNoRoom()} isPointerCoarse={isPointerCoarse} onClick={() => onFreezeChosen(what, count)}>{inWords(count)}</MenuItemWithWhyOff>,
                                          )}</ContextMenu.Group></React.Fragment>),
                              )}</ContextMenu.SubmenuPopup></ContextMenu.Submenu></>)}{!isOfContextBar &&
                    (canMergeSelection || canUnmergeSelection) &&
                    <><ContextMenu.Separator />{canMergeSelection && changeItem('mergeCells', sheetMessages.mergeCells())}{canUnmergeSelection && changeItem('unmergeCells', sheetMessages.unmergeCells())}</>}{formatOfSelection !== null &&
                    (<><ContextMenu.Separator />{!isOfContextBar &&
                      cellTypeMenu !== null &&
                      <ContextMenu.Submenu><ContextMenu.SubmenuTrigger icon="Dropdown" {...(cellTypeMenu.typeOfCells !== null && {
                            hint: cellTypeLabel(cellTypeMenu.typeOfCells),
                          })}>{sheetMessages.cellType()}</ContextMenu.SubmenuTrigger><ContextMenu.SubmenuPopup>{NumberFormatMenuItemsView({
                              ...cellTypeMenu,
                              isEachOnePress: true,
                              areCellsBlank: cellTypes.areCellsBlank,
                            })}</ContextMenu.SubmenuPopup></ContextMenu.Submenu>}{formatOfSelection.holdsTextToConvert && changeItem('convertTexts', sheetMessages.convertTextToNumbers())}<ContextMenu.Submenu><ContextMenu.SubmenuTrigger icon="TextAa">{sheetMessages.formatting()}</ContextMenu.SubmenuTrigger><ContextMenu.SubmenuPopup {...contextBarPartProps} maxVisibleItems={FORMATTING_MENU_MAX_VISIBLE_ITEMS}>{!isOfContextBar && cellTypeMenu !== null && cellTypeMenuItems(cellTypeMenu)}{FONT_MARKS.map(
                                  (mark) =>
                                    (<ContextMenu.Item key={mark} checked={formatOfSelection.togglesOn[mark]} shortcut={formatToggleShortcut(mark)} onClick={() =>
                                          onFormatChosen({
                                            toggle: mark,
                                          })}>{textStyleLabel(mark)}</ContextMenu.Item>),
                                )}<ContextMenu.Separator /><TextWrappingItems shared={formatOfSelection.shared} onChosen={onFormatChosen} hasHeading />{formatAsTableOffer !== null && <ContextMenu.Separator />}{formatAsTableItem}</ContextMenu.SubmenuPopup></ContextMenu.Submenu>{!isOfContextBar &&
                          !areRulesSuggested &&
                          <ContextMenu.Item icon="ConditionalFormat" onClick={() => onConditionalFormatsAsked('menu')}>{CONDITIONAL_FORMATTING_WORDS.conditionalFormatting()}</ContextMenu.Item>}{areRulesSuggested &&
                          <SuggestedRulesSubmenu icon="ConditionalFormat" label={CONDITIONAL_FORMATTING_WORDS.conditionalFormatting()} headingOfSuggestions={CONDITIONAL_FORMATTING_WORDS.suggested()} suggestions={ruleSuggestionCommands} openers={ruleCommandsOfMenu} isPointerCoarse={isPointerCoarse} onTaken={takeCommand} />}</>)}{figures !== null &&
                    (<><ContextMenu.Separator /><ContextMenu.Submenu><ContextMenu.SubmenuTrigger icon="Sigma">{addFormulaUnderNumbersLabel(null)}</ContextMenu.SubmenuTrigger><ContextMenu.SubmenuPopup {...contextBarPartProps}>{figures.heading === null
                                  ? figureItems
                                  : <ContextMenu.Group><Menu.GroupLabel><bdi>{shortHeadingLabel(figures.heading)}</bdi></Menu.GroupLabel>{figureItems}</ContextMenu.Group>}</ContextMenu.SubmenuPopup></ContextMenu.Submenu></>)}{isCellHistoryOffered &&
                    <><ContextMenu.Separator /><ContextMenu.Item icon="History" onClick={onCellHistoryAsked}>{cellHistoryMessages.show()}</ContextMenu.Item></>}</>)}{holdsOnlyFigures &&
              figures !== null &&
              <ContextMenu.Group><Menu.GroupLabel>{addFormulaUnderNumbersLabel(figures.heading)}</Menu.GroupLabel>{figureItems}</ContextMenu.Group>}</MenuWithField></ContextMenu.Root></div>;
});
