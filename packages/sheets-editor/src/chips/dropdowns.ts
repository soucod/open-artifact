import type { CellsOfDropdownAnswer, Color, DropdownContents, StretchOfADropdown } from '@open-artifact/sheets-core';
import type { AtMenuOffer } from '../i18n/menu-labels.ts';
import { activeAnchorCell, selectionAtCell, scrollToShowActiveCell, moveActiveCellTo } from '../selection/model.ts';
import { cleanEnteredCellText } from '../format/shown-text.ts';
import {
  dropdownMenuItems,
  itemToHighlightForTyped,
  optionMenuKey,
  menuItemKey,
  optionIdOfMenuKey,
  dropdownAtCell,
  MAX_DROPDOWN_OPTIONS,
  isValidOptionLabel,
  isSameOptionLabel,
} from './dropdown-options.ts';
import { withNoEffects, clearPassingNotice, NAVIGATING_MODE } from '../state/transitions.ts';
import { openCardAtRow, listCardOfRow } from '../ui/list-cards.ts';
import { queueEdit, enterEntryEdit, IF_QUEUED_DEFAULTS } from '../model/edit-effects.ts';
import { cellRefOf } from '../model/workbook.ts';
import { colorForAddedOption, DROPDOWN_COLOR_CHOICES } from './dropdown-colors.ts';
import { colorKey, colorsEqual } from '../model/colors.ts';
import { commitDropdownOptions, startDropdownFromSet } from './dropdown-editor.ts';
import { pasteOptionLabels, cleanOptionLabel, readySetKeyOf } from './dropdown-pane-edits.ts';
import { dropdownEditorOfPane } from '../state/queries.ts';
import type { DropdownMenuItem } from './dropdown-options.ts';
import type { DropdownEditTarget, DropdownEditor } from './dropdown-pane-edits.ts';
import type { ColoredOption } from './dropdown-colors.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type {
  CardOfList,
  CueForCards,
  DropdownOptionsAddedDone,
  OptionOfDropdownInPane,
  PageState,
} from '../state/initial-state.ts';
import type { LocalizedDropdownPreset, NamedDropdownPreset } from '../i18n/chip-labels.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { CellFoundBy } from '../grid/geometry.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
/** What a row of a card on a list offers: a set of options by its name, a color for an option, or removing the option. */
export type ListCardRowLabel = string | { colorOffered: Color } | { removes: 'option' };
/** A color a row of a card shows, keyed by the option it is of. */
export interface ListCardSwatch {
  key: string;
  color: Color;
}
/** A row of a card open on a row of a list. */
export interface ListCardRow {
  key: string;
  label: ListCardRowLabel;
  marks: ListCardSwatch[];
  isChosen: boolean;
}
/** A card drawn on a row of a list: its rows, the one highlighted, and the row it is of. */
export interface ListCardDrawn {
  ofRow: string;
  rows: ListCardRow[];
  highlightedRow: number | null;
  isAsOpened?: true;
  heading?: string;
}
/** A dropdown, by the cell its list was opened at. */
export interface DropdownAtCell {
  ofCell: CellId;
  dropdownId: string;
}
/** The options of a dropdown found again at its cell, and the cells a change of them goes to. */
export interface DropdownFoundAgain {
  options: DropdownContents['options'];
  everywhere: DropdownEditTarget;
}
/** An option moved in the dropdown's list, to a place among the others. */
export interface OptionMovedInDropdown extends DropdownAtCell {
  optionId: string;
  toIndex: number;
}
/** Labels named for an option in the dropdown's list, or for new options when `optionId` is `null`. */
export interface OptionsNamedInDropdown extends DropdownAtCell {
  optionId: string | null;
  labels: string[];
}
export function dropdownMenuItemsAt(state: PageState, reads: WorkbookReads, { options }: Pick<DropdownContents, 'options'>): DropdownMenuItem[] {
  let cellText =
    reads.cellOf(activeAnchorCell(state, reads))?.dropdownOption !== undefined ? '' : cleanEnteredCellText(state.textToEditOfEntryCell);
  let hasReadySets = (state.readySets ?? []).length > 0;
  return dropdownMenuItems(options, typedTextInCell(state), cellText, hasReadySets);
}
export function dropdownListRows(state: PageState, reads: WorkbookReads): DropdownMenuItem[] | null {
  let dropdown = state.dropdown === null ? null : dropdownAtActiveCell(state, reads);
  return dropdown === null ? null : dropdownMenuItemsAt(state, reads, dropdown);
}
export function openDropdownList(state: PageState, reads: WorkbookReads): PageState {
  let dropdown = dropdownAtActiveCell(state, reads);
  if (dropdown === null) return closeDropdownList(state);
  let typed = typedTextInCell(state);
  let firstTypedRows = typed === null ? null : itemToHighlightForTyped(dropdownMenuItemsAt(state, reads, dropdown), typed);
  let chosenOptionId = reads.cellOf(activeAnchorCell(state, reads))?.dropdownOption?.optionId;
  let chosenRowKey = chosenOptionId === undefined ? null : optionMenuKey(chosenOptionId);
  let firstTypedRowKey = firstTypedRows === null ? null : menuItemKey(firstTypedRows);
  let highlighted = typed === null ? chosenRowKey : firstTypedRowKey;
  let { scrollLeft, scrollTop } = state;
  return {
    ...state,
    dropdown: {
      highlighted,
      scrollAsItOpened: {
        scrollLeft,
        scrollTop,
      },
      card: null,
      isCardOfPointerAlone: false,
      isWalkedByKeys: false,
      cueForCards: 'toCome',
      isNewOptionBeingNamed: false,
      timesNewOptionAsked: 0,
    },
  };
}
export function highlightDropdownRow(state: PageState, highlighted: string | null): PageState {
  if (state.dropdown === null) return state;
  let mayCueCards = optionIdOfMenuKey(highlighted) !== null && isCellTextUntouched(state) && state.mode.kind === 'navigating';
  let { cueForCards } = state.dropdown;
  let nextCueForCards: CueForCards = cueForCards === 'toCome' ? (mayCueCards ? 'now' : cueForCards) : 'given';
  return {
    ...state,
    dropdown: {
      ...state.dropdown,
      highlighted,
      isWalkedByKeys: true,
      cueForCards: nextCueForCards,
    },
  };
}
export function openDropdownEditorAt(state: PageState, reads: ReadsWithTextMeasurer, cell: CellId): PageState {
  let dropdown = reads.dropdownOf(cell);
  let cellsOfDropdown = dropdown === null ? null : reads.cellsOfTheDropdownAt(cell);
  if (dropdown === null || cellsOfDropdown === null) return state;
  return openDropdownEditor(state, reads, {
    dropdownId: dropdown.dropdownId,
    options: dropdown.options,
    stretches: cellsOfDropdown.stretches,
    indexOfOwnStretch: cellsOfDropdown.indexOfTheStretchWithTheCell,
    reach: 'everyCell',
    typed: null,
    isCustom: false,
  });
}
export function pickDropdownRow(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  rowKey: string,
  selectAfter: CellId,
  foundBy: CellFoundBy,
): PageTransition {
  let dropdown = state.dropdown === null ? null : dropdownAtActiveCell(state, reads);
  let pickedRow = (dropdown === null ? [] : dropdownMenuItemsAt(state, reads, dropdown)).find(
    (row) => menuItemKey(row) === rowKey,
  );
  let closedState = closeDropdownList(state);
  if (rowKey === 'addOption' && pickedRow === undefined && state.dropdown !== null)
    return withNoEffects({
      ...state,
      dropdown: {
        ...state.dropdown,
        isNewOptionBeingNamed: false,
      },
    });
  if (dropdown === null || pickedRow === undefined) return withNoEffects(closedState);
  let entryCell = activeAnchorCell(state, reads);
  if (pickedRow.kind === 'editOptions')
    return withNoEffects(
      openDropdownEditorAt(
        {
          ...clearPassingNotice(closedState),
          mode: NAVIGATING_MODE,
        },
        reads,
        entryCell,
      ),
    );
  if (pickedRow.kind === 'addOption')
    return withNoEffects({
      ...state,
      dropdown:
        state.dropdown === null
          ? null
          : {
              ...state.dropdown,
              card: null,
              isNewOptionBeingNamed: true,
              timesNewOptionAsked: state.dropdown.timesNewOptionAsked + 1,
            },
    });
  if (pickedRow.kind === 'startFromSet') {
    let card = openCardAtRow(rowKey, readySetCardRows(state, reads), foundBy);
    let stateWithCard = dropdownCard.withCard(state, card);
    return withNoEffects(highlightStartFromSet(unpinCardFromPointer(stateWithCard)));
  }
  let { sheetId } = entryCell;
  let { label } = pickedRow;
  return queueEdit(
    closedState,
    pickedRow.kind === 'option'
      ? enterEntryEdit(entryCell, {
          kind: 'dropdownOption',
          optionId: pickedRow.optionId,
        })
      : {
          kind: 'addDropdownOption',
          sheetId,
          cell: cellRefOf(entryCell),
          label,
          color: colorForAddedOption(label, dropdown.options),
        },
    {
      ...IF_QUEUED_DEFAULTS,
      select: selectionAtCell(selectAfter),
      foundBy,
      done: null,
    },
  );
}
export function readySetCardRows(state: PageState, reads: WorkbookReads): ListCardRow[] {
  let chosenSetKey = chosenReadySetKey(state, dropdownAtActiveCell(state, reads)?.options ?? []);
  return (state.readySets ?? []).map(
    ({ label, set }) => ({
      key: set.key,
      label,
      marks: set.options.map(
        (option: LocalizedDropdownPreset['options'][number]) => ({
          key: option.label,
          color: option.color,
        }),
      ),
      isChosen: set.key === chosenSetKey,
    }),
  );
}
export function optionColorCardRows(state: PageState, reads: WorkbookReads, optionId: string): ListCardRow[] {
  let options = dropdownAtActiveCell(state, reads)?.options ?? [];
  let option = options.find((held) => held.optionId === optionId);
  if (option === undefined || !isCellTextUntouched(state)) return [];
  return [
    ...DROPDOWN_COLOR_CHOICES.map(
      (colorChoice): ListCardRow => ({
        key: `${optionId} ${colorKey(colorChoice)}`,
        label: {
          colorOffered: colorChoice,
        },
        marks: [],
        isChosen: colorsEqual(colorChoice, option.color),
      }),
    ),
    ...(options.length === 1
      ? []
      : [
          {
            key: `${optionId} remove`,
            label: {
              removes: 'option',
            },
            marks: [],
            isChosen: false,
          } satisfies ListCardRow,
        ]),
  ];
}
export function drawDropdownCard(state: PageState, reads: WorkbookReads, rows: readonly DropdownMenuItem[]): ListCardDrawn | null {
  let card = listCardOfRow(
    state.dropdown?.card ?? null,
    rows.map(menuItemKey),
    (rowKey: string) => dropdownCardRowsAt(state, reads, rowKey),
  );
  let cardRow = rows.find((row) => menuItemKey(row) === card?.ofRow);
  if (card === null || card.rows.length === 0) return null;
  return cardRow?.kind === 'option'
    ? {
        ...card,
        heading: cardRow.label,
      }
    : card;
}
export function openOptionColorCard(state: PageState, reads: WorkbookReads, optionId: string): PageState {
  let rowKey = optionMenuKey(optionId);
  let colorRows = optionColorCardRows(state, reads, optionId);
  if (state.dropdown === null || colorRows.length === 0) return state;
  let chosenKey = colorRows.find(({ isChosen }) => isChosen)?.key ?? null;
  let card: CardOfList = {
    ofRow: rowKey,
    wentTo: chosenKey,
    isAsOpened: true,
  };
  return {
    ...state,
    dropdown: {
      ...state.dropdown,
      card,
      isCardOfPointerAlone: false,
      isWalkedByKeys: true,
      cueForCards: 'given',
    },
  };
}
export function resolveDropdownAt(state: PageState, reads: WorkbookReads, { ofCell, dropdownId }: DropdownAtCell): DropdownFoundAgain | null {
  let dropdown = ofCell.sheetId === state.sheetId ? dropdownAtCell(reads, ofCell) : null;
  let cellsOfDropdown = reads.cellsOfTheDropdownAt(ofCell);
  if (dropdown === null || cellsOfDropdown === null || dropdown.dropdownId !== dropdownId) return null;
  return {
    options: dropdown.options,
    everywhere: dropdownEditTarget(dropdown, cellsOfDropdown),
  };
}
export function moveDropdownOption(state: PageState, reads: WorkbookReads, { optionId, toIndex, ...target }: OptionMovedInDropdown): PageTransition {
  let found = resolveDropdownAt(state, reads, target);
  let option = found?.options.find((held) => held.optionId === optionId);
  if (found === null || option === undefined) return withNoEffects(state);
  let { options, everywhere } = found;
  let others = options.filter((held) => held !== option);
  let index = Math.max(0, Math.min(toIndex, others.length));
  if (options[index] === option) return withNoEffects(state);
  let reordered = [...others.slice(0, index), option, ...others.slice(index)];
  return commitDropdownOptions(state, reads, everywhere, reordered, 'goesOn', undefined, {
    what: 'dropdownOptionMoved',
    label: option.label,
    place: index + 1,
    optionCount: options.length,
  });
}
export function nameDropdownOptions(state: PageState, reads: WorkbookReads, { optionId, labels, ...target }: OptionsNamedInDropdown): PageTransition {
  let found = resolveDropdownAt(state, reads, target);
  if (found === null) return withNoEffects(state);
  let { options, everywhere } = found;
  if (optionId === null) {
    let { pasted, ...added } = pasteOptionLabels(options, options.length, labels, null);
    let lastDone: Omit<DropdownOptionsAddedDone, 'onlyIn'> = {
      what: 'dropdownOptionsAdded',
      ...added,
    };
    if (added.count === 0)
      return withNoEffects(
        labels.length > 1
          ? {
              ...state,
              lastDone: {
                ...lastDone,
                onlyIn: null,
              },
            }
          : state,
      );
    let stateForAdding: PageState =
      pasted.length >= MAX_DROPDOWN_OPTIONS && state.dropdown !== null
        ? {
            ...state,
            dropdown: {
              ...state.dropdown,
              isNewOptionBeingNamed: false,
            },
          }
        : state;
    return commitDropdownOptions(stateForAdding, reads, everywhere, pasted, 'goesOn', undefined, lastDone);
  }
  let label = cleanOptionLabel(labels[0] ?? '').trim();
  let option = options.find((held) => held.optionId === optionId);
  if (option === undefined || option.label === label || !isValidOptionLabel(label)) return withNoEffects(state);
  if (isOptionLabelTaken(options, optionId, label)) return withNoEffects(state);
  let { color } = option;
  let renamed = options.map(
    (held) =>
      held === option
        ? {
            optionId,
            label,
            color,
          }
        : held,
  );
  return commitDropdownOptions(state, reads, everywhere, renamed, 'goesOn');
}
export function takeColorCardRow(state: PageState, reads: WorkbookReads, optionId: string, rowKey: string): PageTransition {
  let dropdown = dropdownAtActiveCell(state, reads);
  let cellsOfDropdown = reads.cellsOfTheDropdownAt(activeAnchorCell(state, reads));
  let cardRow = optionColorCardRows(state, reads, optionId).find(({ key }) => key === rowKey);
  let option = dropdown?.options.find((held) => held.optionId === optionId);
  if (dropdown === null || cellsOfDropdown === null || option === undefined) return withNoEffects(state);
  let card = state.dropdown?.card ?? null;
  if (cardRow === undefined || card === null) return withNoEffects(state);
  let everywhere = dropdownEditTarget(dropdown, cellsOfDropdown);
  if (typeof cardRow.label === 'object' && 'colorOffered' in cardRow.label) {
    let { colorOffered } = cardRow.label;
    let stateWithCard = dropdownCard.withCard(state, {
      ofRow: card.ofRow,
      wentTo: rowKey,
    });
    let stateUnpinned = unpinCardFromPointer(stateWithCard);
    if (cardRow.isChosen) return withNoEffects(stateUnpinned);
    let recolored = dropdown.options.map(
      (held) =>
        held === option
          ? {
              ...held,
              color: colorOffered,
            }
          : held,
    );
    return commitDropdownOptions(stateUnpinned, reads, everywhere, recolored, 'goesOn');
  }
  let otherOptions = dropdown.options.filter((held) => held !== option);
  let stateWithoutCard = dropdownCard.withCard(state, null);
  let optionIdInCell = reads.cellOf(activeAnchorCell(state, reads))?.dropdownOption?.optionId;
  let rowOfOptionInCell = optionIdInCell === undefined || optionIdInCell === optionId ? null : optionMenuKey(optionIdInCell);
  let stateHighlighted =
    stateWithoutCard.dropdown === null
      ? stateWithoutCard
      : {
          ...stateWithoutCard,
          dropdown: {
            ...stateWithoutCard.dropdown,
            highlighted: rowOfOptionInCell,
          },
        };
  return commitDropdownOptions(stateHighlighted, reads, everywhere, otherOptions, 'goesOn', undefined, {
    what: 'dropdownOptionRemoved',
    label: option.label,
    isSaved: false,
  });
}
export const rangesOtherThanIndex = (stretches: readonly StretchOfADropdown[], ownIndex: number | null): string[] =>
  stretches.filter((_, index) => index !== ownIndex).map(({ range }) => range);
export const dropdownAtActiveCell = (state: PageState, reads: WorkbookReads): DropdownContents | null => dropdownAtCell(reads, activeAnchorCell(state, reads));
export const typedTextInCell = ({ mode }: Pick<PageState, 'mode'>): string | null =>
  mode.kind === 'editing' && mode.text !== mode.textAtStart ? cleanEnteredCellText(mode.text) : null;
export const isCellTextUntouched = (state: Pick<PageState, 'mode'>): boolean => typedTextInCell(state) === null;
export const closeDropdownList = (state: PageState): PageState =>
  state.dropdown === null
    ? state
    : {
        ...state,
        dropdown: null,
      };
export const closeSidePane = (state: PageState): PageState =>
  state.sidePane === null
    ? state
    : {
        ...state,
        sidePane: null,
      };
export const withDropdownPane = (state: PageState, editor: DropdownEditor | null): PageState => ({
  ...state,
  sidePane: {
    kind: 'dropdown',
    editor,
  },
});
export const entryCellHasDropdown = (state: PageState, reads: WorkbookReads): boolean => reads.dropdownOf(activeAnchorCell(state, reads)) !== null;
export const toggleDropdownPane = (state: PageState, reads: WorkbookReads): PageState =>
  state.sidePane?.kind !== 'dropdown' && entryCellHasDropdown(state, reads) ? withDropdownPane(state, null) : closeSidePane(state);
export const openDropdownEditor = (state: PageState, reads: ReadsWithTextMeasurer, editor: DropdownEditor): PageState =>
  withDropdownPane(
    {
      ...clearPassingNotice(scrollToShowActiveCell(state, reads)),
      dropdown: null,
      timesSidePaneAsked: state.timesSidePaneAsked + 1,
    },
    editor,
  );
export const openDropdownListOrEditor = (state: PageState, reads: ReadsWithTextMeasurer): PageState =>
  dropdownAtActiveCell(state, reads) === null
    ? openDropdownEditorAt(closeDropdownList(state), reads, activeAnchorCell(state, reads))
    : openDropdownList(scrollToShowActiveCell(state, reads), reads);
export const editDropdownOfEntryCell = (state: PageState, reads: ReadsWithTextMeasurer): PageState =>
  openDropdownEditorAt(state, reads, activeAnchorCell(state, reads));
export const chosenReadySetKey = (state: PageState, options: readonly ColoredOption[]): string | null =>
  dropdownEditorOfPane(state)?.isCustom === true ? null : readySetKeyOf(state, options);
export const dropdownCardRowsAt = (state: PageState, reads: WorkbookReads, rowKey: string): ListCardRow[] => {
  let optionId = optionIdOfMenuKey(rowKey);
  if (optionId !== null) return optionColorCardRows(state, reads, optionId);
  return rowKey === 'startFromSet' ? readySetCardRows(state, reads) : [];
};
export const highlightStartFromSet = (state: PageState): PageState =>
  state.dropdown === null
    ? state
    : {
        ...state,
        dropdown: {
          ...state.dropdown,
          highlighted: 'startFromSet',
        },
      };
export const unpinCardFromPointer = (state: PageState): PageState =>
  state.dropdown?.isCardOfPointerAlone === true
    ? {
        ...state,
        dropdown: {
          ...state.dropdown,
          isCardOfPointerAlone: false,
        },
      }
    : state;
export const dropdownCard = {
  card: (state: Pick<PageState, 'dropdown'>): CardOfList | null => state.dropdown?.card ?? null,
  isCardOfPointerAlone: (state: Pick<PageState, 'dropdown'>): boolean => state.dropdown?.isCardOfPointerAlone === true,
  doKeysGoRound: (state: Pick<PageState, 'dropdown'>): boolean => optionIdOfMenuKey(state.dropdown?.card?.ofRow ?? null) === null,
  withCard(state: PageState, card: CardOfList | null): PageState {
    if (state.dropdown === null) return state;
    let isPointerAlone = card !== null && (state.dropdown.card?.ofRow !== card.ofRow || state.dropdown.isCardOfPointerAlone);
    return {
      ...state,
      dropdown: {
        ...state.dropdown,
        card,
        isCardOfPointerAlone: isPointerAlone,
      },
    };
  },
  rowsAt: dropdownCardRowsAt,
  drawn: (state: PageState, reads: WorkbookReads): ListCardDrawn | null => drawDropdownCard(state, reads, dropdownListRows(state, reads) ?? []),
  take(state: PageState, reads: ReadsWithTextMeasurer, rowKey: string, cell: CellId, foundBy: CellFoundBy, goesToCell: boolean): PageTransition {
    let optionId = optionIdOfMenuKey(state.dropdown?.card?.ofRow ?? null);
    let closedState = {
      ...clearPassingNotice(state),
      mode: NAVIGATING_MODE,
    };
    if (optionId !== null && goesToCell) return withNoEffects(moveActiveCellTo(closeDropdownList(closedState), reads, cell));
    if (optionId !== null) return takeColorCardRow(state, reads, optionId, rowKey);
    let readySet = state.readySets?.find(({ set }) => set.key === rowKey);
    if (readySet === undefined) return withNoEffects(state);
    let stateHighlighted = highlightStartFromSet(dropdownCard.withCard(closedState, null));
    return startDropdownFromSet(stateHighlighted, reads, readySet.set, cell);
  },
};
export const openCardOfHighlighted = (state: PageState, reads: WorkbookReads): PageState => {
  let optionId = optionIdOfMenuKey(state.dropdown?.highlighted ?? null);
  return optionId === null ? state : openOptionColorCard(state, reads, optionId);
};
export const toggleOptionColorCard = (state: PageState, reads: WorkbookReads, optionId: string): PageState =>
  state.dropdown?.card?.ofRow === optionMenuKey(optionId) ? dropdownCard.withCard(state, null) : openOptionColorCard(state, reads, optionId);
export const dropdownEditTarget = ({ dropdownId }: Pick<DropdownContents, 'dropdownId'>, cellsOfDropdown: CellsOfDropdownAnswer): DropdownEditTarget => ({
  dropdownId,
  stretches: cellsOfDropdown.stretches,
  indexOfOwnStretch: cellsOfDropdown.indexOfTheStretchWithTheCell,
  reach: 'everyCell',
});
export const isOptionLabelTaken = (options: readonly OptionOfDropdownInPane[], optionId: string | null, label: string): boolean =>
  options.some((held) => held.optionId !== optionId && isSameOptionLabel(held.label, cleanOptionLabel(label).trim()));
export const withReadySetsAsked = ({ state, effects }: PageTransition): PageTransition =>
  state.readySets !== null || (state.dropdown === null && state.sidePane === null)
    ? {
        state,
        effects,
      }
    : {
        state,
        effects: [
          ...effects,
          {
            kind: 'readOffersUnderAt',
          },
        ],
      };
export const readySetsInOffers = (offers: readonly AtMenuOffer[]): NamedDropdownPreset[] =>
  offers.flatMap((offer): NamedDropdownPreset[] => {
    if (offer.kind === 'several') return readySetsInOffers(offer.offers);
    return offer.kind === 'dropdownOfSet'
      ? [
          {
            label: offer.label,
            set: offer.set,
          },
        ]
      : [];
  });
export const withReadySets = (state: PageState, offers: readonly AtMenuOffer[]): PageState => ({
  ...state,
  readySets: readySetsInOffers(offers),
});
