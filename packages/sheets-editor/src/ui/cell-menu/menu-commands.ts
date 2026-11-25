import type { SortDirection } from '@open-artifact/sheets-core';
import type { MenuCommand } from '../search-menu/matching.ts';
import type { PageView } from '../../view/page-view.ts';
import type { OwnFilterByCellChosen, SheetChange, SortPaneAsked } from '../../state/event-reducer.ts';
import type { FormatCommand } from '../../format/format-commands.ts';
import type { PasteAsked, WhatLastPutHereHolds } from '../../clipboard/page-clipboard.ts';
import type { KeyInstead } from '../../i18n/notice-labels.ts';
import type { FreezeChoice } from '../../grid/freeze.ts';
import type { LinesAxisName } from '../../grid/geometry.ts';
import type { CommandWithSynonyms } from '../../messages/command-search.ts';
import { oneRangeActOfCommand } from '../../selection/several-ranges.ts';
import type { CommandOfOneRange } from '../../selection/several-ranges.ts';
import { commandSearchSynonyms } from '../../messages/command-search.ts';
import { oneRangeNeededText, pasteFromMenuHint, pasteValuesFromMenuHint } from '../../i18n/notice-labels.ts';
import {
  sortTableUnclearHint,
  ascendingLabel,
  descendingLabel,
  freezeRowsLabel,
  freezeColumnsLabel,
  insertRowsAboveLabel,
  insertRowsBelowLabel,
  insertColumnsLeftLabel,
  insertColumnsRightLabel,
  moveRowsUpLabel,
  moveRowsDownLabel,
  moveColumnsLeftLabel,
  moveColumnsRightLabel,
  deleteRowsLabel,
  deleteColumnsLabel,
  resizeRowsLabel,
  resizeColumnsLabel,
  sortMenuLabel,
  sortRangeLabel,
  sortSheetLabel,
  rowsFromFirstLabel,
  columnsFromFirstLabel,
} from '../../i18n/grid-action-labels.ts';
import { toolLabelWithValue } from '../../tools/search-words.ts';
import { customSortMessages, sortAndFilterMessages } from '../../tables/sort-filter-labels.ts';
import { sheetMessages, textStyleLabel } from '../../i18n/sheet-messages.ts';
import { shortcutKeysFor } from '../../keys/shortcut-list.ts';
import { expandGroupsLabel, collapseGroupsLabel, groupLinesLabel, ungroupLinesLabel } from '../../messages/line-groups.ts';
import { shortcutFor } from '../../keys/key-press.ts';
import { linkEditMessages } from '../../links/link-hover-card.tsx';
import { OPEN_LINK_SHORTCUT } from '../../links/cell-links-view.tsx';
import { suggestedFreezeChoice } from '../../grid/freeze.ts';
import { filterMessages, showOnlyValueLabel, leaveOutValueLabel } from '../../tables/filter-messages.ts';
import { FONT_MARKS } from '../../editor/text-looks.ts';
import { formatToggleShortcut } from '../toolbar/text-menus.tsx';
import { CONDITIONAL_FORMATTING_WORDS } from '../../messages/conditional-format.ts';
import { cellHistoryMessages } from '../../history/cell-history-popover.tsx';
import { pivotTableMessages } from '../../tables/pivot-table-messages.tsx';
/** What the cell menu offers, as the page sees it, and what it does when a command is chosen. */
export interface CellMenuCommandsProps
  extends Pick<
    PageView,
    | 'selectionIsOf'
    | 'selectedRowCount'
    | 'selectedColumnCount'
    | 'selectedCellCount'
    | 'rowCountToSize'
    | 'columnCountToSize'
    | 'isOneRangeNeeded'
    | 'canMergeSelection'
    | 'canUnmergeSelection'
    | 'canMoveSelectionBack'
    | 'canMoveSelectionOn'
    | 'freezeChoices'
    | 'groupChoices'
    | 'canDeleteSelectedRows'
    | 'canDeleteSelectedColumns'
    | 'areWholeRowsSelected'
    | 'areWholeColumnsSelected'
    | 'columnToSortBy'
    | 'canSortSelectedRange'
    | 'canSortTableAtCell'
    | 'formatOfSelection'
    | 'ownFilterOffers'
    | 'formatAsTableOffer'
    | 'linkByHandOffered'
    | 'doesKeyOpenLinkForm'
    | 'isCommentOffered'
  > {
  linkUrl: PageView['linkOfActiveCell'];
  linkInWordsUrl: PageView['linkOfActiveCell'];
  heldToPaste: WhatLastPutHereHolds | null;
  keyThatPastes: KeyInstead;
  areDropdownsSelected: boolean;
  isCellHistoryOffered: boolean;
  iconOfChange(change: SheetChange): MenuCommand['icon'];
  onChangeChosen(change: SheetChange): void;
  onSortPaneAsked(of: SortScope): void;
  onFreezeChosen(lines: LinesAxisName, count: number): void;
  onLinkOpened(url: NonNullable<PageView['linkOfActiveCell']>): void;
  onLinkCopied(url: NonNullable<PageView['linkOfActiveCell']>): void;
  onLinkFormAsked(): void;
  onCopyOrCutChosen(asked: 'copy' | 'cut'): void;
  onPasteChosen(asked: PasteAsked): void;
  onCommentChosen(): void;
  onClearChosen(): void;
  onSortAndFilterAsked(): void;
  onOwnFilterByCellChosen(keeps: OwnFilterByCellChosen['keeps']): void;
  onOwnFilterRemoved(tableKey: string): void;
  onFormatAsTableChosen(isOn: boolean): void;
  onFormatChosen(choice: FormatCommand): void;
  onConditionalFormatsAsked(askedFrom: 'menu'): void;
  onCellHistoryAsked(): void;
  isActiveCellOfPivotTable: boolean;
  onPivotTableAsked(): void;
}
/** Where a sort goes: the whole sheet's table, or the selected range alone. */
export type SortScope = SortPaneAsked['of'];
/** What a sheet change's command may carry besides its id, label, icon and run. */
type ChangeCommandParts = Partial<Pick<MenuCommand, 'actsOn' | 'keys' | 'isWeighty' | 'whyNot'>>;
export function cellMenuCommands(props: CellMenuCommandsProps): MenuCommand[] {
  const { selectionIsOf, selectedRowCount, selectedColumnCount } = props;
  const {
    isOneRangeNeeded,
    heldToPaste,
    keyThatPastes,
    formatOfSelection,
  } = props;
  const changeCommand = (change: SheetChange, label: string, { whyNot = null, actsOn = 'cells', ...rest }: ChangeCommandParts = {}): MenuCommand => {
    let oneRangeAct = isOneRangeNeeded ? oneRangeActOfCommand(change) : null;
    let otherWordsKey = OTHER_WORDS_KEYS_OF_CHANGES[change];
    return {
      id: `menu.${change}`,
      label,
      ...(otherWordsKey !== undefined && {
        otherWords: commandSearchSynonyms(otherWordsKey),
      }),
      icon: props.iconOfChange(change),
      actsOn,
      whyNot: oneRangeAct === null ? whyNot : oneRangeNeededText(oneRangeAct),
      ...rest,
      run: () => props.onChangeChosen(change),
    };
  };
  const sortCommands = (scope: SortScope, heading: string, needsTable = false) => {
    const shared: ChangeCommandParts = {
      isWeighty: true,
      actsOn: scope === 'sheet' ? 'sheet' : 'cells',
      ...(needsTable &&
        !props.canSortTableAtCell && {
          whyNot: sortTableUnclearHint(props.isActiveCellOfPivotTable),
        }),
    };
    return [
      changeCommand(SORT_CHANGES[scope].ascending, toolLabelWithValue(heading, ascendingLabel()), shared),
      changeCommand(SORT_CHANGES[scope].descending, toolLabelWithValue(heading, descendingLabel()), shared),
    ];
  };
  const customSortCommand = (scope: SortScope, heading: string | null): MenuCommand => ({
    id: `menu.customSort.${scope}`,
    label: heading === null ? customSortMessages.customSort() : toolLabelWithValue(heading, customSortMessages.customSort()),
    otherWords: commandSearchSynonyms('customSort'),
    icon: 'Sort',
    actsOn: 'opens',
    home: 'pane',
    whyNot: isOneRangeNeeded && scope === 'range' ? oneRangeNeededText(oneRangeActOfCommand(SORT_CHANGES.range.ascending) ?? 'sortCells') : null,
    run: () => props.onSortPaneAsked(scope),
  });
  const freezeCommand = (
    lines: LinesAxisName,
    { count, isRoom }: Pick<FreezeChoice, 'count' | 'isRoom'>,
    labelled: Pick<MenuCommand, 'label' | 'icon' | 'isTicked'>,
  ): MenuCommand => ({
    id: `menu.freeze.${lines}.${count}`,
    ...labelled,
    otherWords: commandSearchSynonyms(FREEZE_OTHER_WORDS_KEYS[lines][count === 0 ? 'none' : 'some']),
    actsOn: 'sheet',
    whyNot: isRoom ? null : lines === 'rows' ? sheetMessages.tooManyRowsToFreeze() : sheetMessages.tooManyColumnsToFreeze(),
    run: () => props.onFreezeChosen(lines, count),
  });
  const groupCommand = (change: SheetChange, label: string, shortcutName: string) =>
    changeCommand(change, label, {
      keys: shortcutKeysFor(shortcutName),
      isWeighty: true,
    });
  const groupCommandsOf = ({
    of: lines,
    canUngroup,
    collapseCount,
    expandCount,
  }: NonNullable<PageView['groupChoices']>) => {
    const { group: groupChange, ungroup: ungroupChange, collapse: collapseChange, expand: expandChange } = GROUP_CHANGES[lines];
    return [
      ...(expandCount > 0 ? [groupCommand(expandChange, expandGroupsLabel(expandCount), 'expandGroup')] : []),
      ...(collapseCount > 0 ? [groupCommand(collapseChange, collapseGroupsLabel(collapseCount), 'collapseGroup')] : []),
      groupCommand(groupChange, groupLinesLabel(lines, lines === 'rows' ? selectedRowCount : selectedColumnCount), 'group'),
      ...(canUngroup ? [groupCommand(ungroupChange, ungroupLinesLabel(lines), 'ungroup')] : []),
    ];
  };
  const isSelectionOf = (kind: PageView['selectionIsOf']) => selectionIsOf === kind;
  const shortcutUnlessCells = (act: string) =>
    isSelectionOf('cells')
      ? {}
      : {
          keys: shortcutFor(act),
        };
  const canActOnRows = isSelectionOf('cells') || isSelectionOf('rows');
  const canActOnColumns = isSelectionOf('cells') || isSelectionOf('columns');
  const { linkUrl, linkInWordsUrl } = props;
  const isLinkEdit = isSelectionOf('cells') && props.linkByHandOffered === 'edit';
  const linkByHandCommand: MenuCommand = {
    id: 'menu.linkByHand',
    label: isLinkEdit ? sheetMessages.editLink() : linkEditMessages.insertLink(),
    otherWords: commandSearchSynonyms('linkByHand'),
    icon: isLinkEdit ? 'Edit' : 'Link',
    ...(props.doesKeyOpenLinkForm && {
      keys: shortcutKeysFor('addLink'),
    }),
    actsOn: 'opens',
    whyNot: props.linkByHandOffered === 'notOnFormula' ? linkEditMessages.whyNoLinkByHand() : null,
    run: props.onLinkFormAsked,
  };
  const ownFilter = props.ownFilterOffers?.filter;
  const valueOfCellToFilter = props.ownFilterOffers?.valueOfCell ?? null;
  const { formatAsTableOffer } = props;
  const formatAsTableCommands: MenuCommand[] =
    formatAsTableOffer === null
      ? []
      : [
          {
            id: 'menu.formatAsTable',
            label: sheetMessages.formatAsTable(),
            otherWords: commandSearchSynonyms('formatAsTable'),
            icon: 'Table',
            isTicked: formatAsTableOffer.isOn,
            ...(formatAsTableOffer.isForEveryone
              ? {
                  actsOn: 'sheet',
                  isWeighty: true,
                }
              : {
                  actsOn: 'view',
                }),
            whyNot: null,
            run: () => props.onFormatAsTableChosen(!formatAsTableOffer.isOn),
          },
        ];
  return [
    ...(props.isCommentOffered
      ? [
          {
            id: 'menu.comment',
            label: sheetMessages.comment(),
            otherWords: commandSearchSynonyms('comment'),
            icon: 'Comment',
            keys: 'alt+cmd+m',
            actsOn: 'handsOver',
            whyNot: null,
            run: props.onCommentChosen,
          },
        ] satisfies MenuCommand[]
      : []),
    ...(linkUrl === null
      ? []
      : [
          {
            id: 'menu.openLink',
            label: sheetMessages.openLink(),
            otherWords: commandSearchSynonyms('openLink'),
            icon: 'ArrowOutSquare',
            keys: OPEN_LINK_SHORTCUT,
            actsOn: 'opens',
            whyNot: null,
            isWeighty: true,
            run: () => props.onLinkOpened(linkUrl),
          },
        ] satisfies MenuCommand[]),
    ...(linkInWordsUrl === null
      ? []
      : [
          {
            id: 'menu.copyLinkAddress',
            label: sheetMessages.copyLinkAddress(),
            otherWords: commandSearchSynonyms('copyLinkAddress'),
            icon: 'Copy',
            actsOn: 'cells',
            whyNot: null,
            run: () => props.onLinkCopied(linkInWordsUrl),
          },
        ] satisfies MenuCommand[]),
    ...(isLinkEdit ? [linkByHandCommand] : []),
    {
      id: 'menu.cut',
      label: sheetMessages.cut(),
      otherWords: commandSearchSynonyms('cut'),
      icon: 'Scissors',
      keys: 'cmd+x',
      actsOn: 'cells',
      whyNot: isOneRangeNeeded ? oneRangeNeededText('cut') : null,
      run: () => props.onCopyOrCutChosen('cut'),
    },
    {
      id: 'menu.copy',
      label: sheetMessages.copy(),
      otherWords: commandSearchSynonyms('copy'),
      icon: 'Copy',
      keys: 'cmd+c',
      actsOn: 'cells',
      whyNot: null,
      run: () => props.onCopyOrCutChosen('copy'),
    },
    {
      id: 'menu.paste',
      label: sheetMessages.paste(),
      otherWords: commandSearchSynonyms('paste'),
      icon: 'Clipboard',
      keys: 'cmd+v',
      actsOn: 'cells',
      whyNot: heldToPaste === null ? pasteFromMenuHint(keyThatPastes) : null,
      isWeighty: true,
      run: () => props.onPasteChosen('all'),
    },
    {
      id: 'menu.pasteValuesOnly',
      label: sheetMessages.pasteValuesOnly(),
      otherWords: commandSearchSynonyms('pasteValuesOnly'),
      icon: 'PasteValues',
      keys: 'shift+cmd+v',
      actsOn: 'cells',
      whyNot: heldToPaste === 'copiedCells' ? null : pasteValuesFromMenuHint(heldToPaste, keyThatPastes),
      isWeighty: true,
      run: () => props.onPasteChosen('valuesOnly'),
    },
    ...(['rows', 'columns'] satisfies LinesAxisName[]).flatMap((lines) => {
      const choice = isSelectionOf(lines) ? suggestedFreezeChoice(props.freezeChoices?.[lines] ?? []) : null;
      if (choice === null) return [];
      const label = (lines === 'rows' ? freezeRowsLabel : freezeColumnsLabel)(choice.count);
      return [
        freezeCommand(lines, choice, {
          label,
          icon: choice.count === 0 ? 'PinSlash' : 'Pin',
        }),
      ];
    }),
    ...(canActOnRows
      ? [
          changeCommand('insertRowAbove', insertRowsAboveLabel(selectedRowCount), {
            isWeighty: true,
            ...shortcutUnlessCells('insertRowsOrColumns'),
          }),
          changeCommand('insertRowBelow', insertRowsBelowLabel(selectedRowCount), {
            isWeighty: true,
          }),
        ]
      : []),
    ...(canActOnColumns
      ? [
          changeCommand('insertColumnLeft', insertColumnsLeftLabel(selectedColumnCount), {
            isWeighty: true,
            ...shortcutUnlessCells('insertRowsOrColumns'),
          }),
          changeCommand('insertColumnRight', insertColumnsRightLabel(selectedColumnCount), {
            isWeighty: true,
          }),
        ]
      : []),
    ...(isSelectionOf('cells') && !isLinkEdit && props.linkByHandOffered !== null ? [linkByHandCommand] : []),
    ...(isSelectionOf('rows') && props.canMoveSelectionBack
      ? [
          changeCommand('moveRowsUp', moveRowsUpLabel(selectedRowCount), {
            isWeighty: true,
          }),
        ]
      : []),
    ...(isSelectionOf('rows') && props.canMoveSelectionOn
      ? [
          changeCommand('moveRowsDown', moveRowsDownLabel(selectedRowCount), {
            isWeighty: true,
          }),
        ]
      : []),
    ...(isSelectionOf('columns') && props.canMoveSelectionBack
      ? [
          changeCommand('moveColumnsLeft', moveColumnsLeftLabel(selectedColumnCount), {
            isWeighty: true,
          }),
        ]
      : []),
    ...(isSelectionOf('columns') && props.canMoveSelectionOn
      ? [
          changeCommand('moveColumnsRight', moveColumnsRightLabel(selectedColumnCount), {
            isWeighty: true,
          }),
        ]
      : []),
    {
      id: 'menu.clearContents',
      label: sheetMessages.clearContents(),
      otherWords: commandSearchSynonyms('clearContents'),
      icon: 'Eraser',
      keys: 'backspace',
      actsOn: 'cells',
      whyNot: null,
      isWeighty: true,
      run: props.onClearChosen,
    },
    ...(props.areDropdownsSelected
      ? [
          {
            id: 'menu.removeDropdown',
            label: sheetMessages.removeDropdown(),
            icon: 'Minus',
            actsOn: 'cells',
            whyNot: null,
            isWeighty: true,
            run: () =>
              props.onFormatChosen({
                removesDropdown: true,
              }),
          },
        ] satisfies MenuCommand[]
      : []),
    ...(canActOnRows
      ? [
          changeCommand('deleteRows', deleteRowsLabel(selectedRowCount), {
            whyNot: props.canDeleteSelectedRows ? null : sheetMessages.sheetNeedsARow(),
            isWeighty: true,
            ...shortcutUnlessCells('deleteRowsOrColumns'),
          }),
        ]
      : []),
    ...(canActOnColumns
      ? [
          changeCommand('deleteColumns', deleteColumnsLabel(selectedColumnCount), {
            whyNot: props.canDeleteSelectedColumns ? null : sheetMessages.sheetNeedsAColumn(),
            isWeighty: true,
            ...shortcutUnlessCells('deleteRowsOrColumns'),
          }),
        ]
      : []),
    ...(props.areWholeRowsSelected
      ? [
          changeCommand('resizeRows', resizeRowsLabel(props.rowCountToSize), {
            actsOn: 'opens',
          }),
        ]
      : []),
    ...(props.areWholeColumnsSelected
      ? [
          changeCommand('resizeColumns', resizeColumnsLabel(props.columnCountToSize), {
            actsOn: 'opens',
          }),
        ]
      : []),
    ...(props.groupChoices === null ? [] : groupCommandsOf(props.groupChoices)),
    ...(props.columnToSortBy === null
      ? []
      : props.selectedCellCount === 1
        ? [...sortCommands('sheet', sortMenuLabel(), true), customSortCommand('range', null)]
        : [
            ...(props.canSortSelectedRange ? [...sortCommands('range', sortRangeLabel()), customSortCommand('range', sortRangeLabel())] : []),
            ...sortCommands('sheet', sortSheetLabel()),
            customSortCommand('sheet', sortSheetLabel()),
          ]),
    ...(ownFilter === undefined
      ? []
      : [
          {
            id: 'menu.sortAndFilter',
            label: sortAndFilterMessages.sortAndFilter(),
            otherWords: commandSearchSynonyms('sortAndFilter'),
            icon: 'FilterLines',
            actsOn: 'opens',
            home: 'toolbar',
            whyNot: null,
            run: props.onSortAndFilterAsked,
          } satisfies MenuCommand,
          ...(ownFilter.kind === 'turnOn'
            ? []
            : [
                {
                  id: 'menu.clearOwnFilter',
                  label: filterMessages.clearFilter(),
                  icon: 'FilterLines',
                  actsOn: 'view',
                  whyNot: null,
                  run: () => props.onOwnFilterRemoved(ownFilter.tableKey),
                },
              ] satisfies MenuCommand[]),
        ]),
    ...(valueOfCellToFilter === null
      ? []
      : [
          {
            id: 'menu.ownFilter.only',
            label: showOnlyValueLabel(valueOfCellToFilter),
            icon: 'FilterLines',
            actsOn: 'view',
            whyNot: null,
            run: () => props.onOwnFilterByCellChosen('only'),
          },
          {
            id: 'menu.ownFilter.allBut',
            label: leaveOutValueLabel(valueOfCellToFilter),
            icon: 'FilterLines',
            actsOn: 'view',
            whyNot: null,
            run: () => props.onOwnFilterByCellChosen('allBut'),
          },
        ] satisfies MenuCommand[]),
    ...(isSelectionOf('cells')
      ? (['rows', 'columns'] satisfies LinesAxisName[]).flatMap(
          (lines) =>
            (props.freezeChoices?.[lines] ?? []).map((choice) => {
              const linesFromFirstLabel = lines === 'rows' ? rowsFromFirstLabel : columnsFromFirstLabel;
              const label = toolLabelWithValue(sheetMessages.freeze(), linesFromFirstLabel(choice.count));
              return freezeCommand(lines, choice, {
                label,
                icon: 'Pin',
                isTicked: choice.isInForce,
              });
            }),
        )
      : []),
    ...(props.canMergeSelection
      ? [
          changeCommand('mergeCells', sheetMessages.mergeCells(), {
            isWeighty: true,
          }),
        ]
      : []),
    ...(props.canUnmergeSelection
      ? [
          changeCommand('unmergeCells', sheetMessages.unmergeCells(), {
            isWeighty: true,
          }),
        ]
      : []),
    ...(formatOfSelection === null
      ? []
      : [
          ...(formatOfSelection.holdsTextToConvert
            ? [
                changeCommand('convertTexts', sheetMessages.convertTextToNumbers(), {
                  isWeighty: true,
                }),
              ]
            : []),
          ...FONT_MARKS.map(
            (mark): MenuCommand => ({
              id: `menu.${mark}`,
              label: textStyleLabel(mark),
              icon: null,
              keys: formatToggleShortcut(mark),
              isTicked: formatOfSelection.togglesOn[mark],
              actsOn: 'cells',
              whyNot: null,
              run: () =>
                props.onFormatChosen({
                  toggle: mark,
                }),
            }),
          ),
          {
            id: 'menu.clearFormatting',
            label: sheetMessages.clearFormatting(),
            otherWords: commandSearchSynonyms('clearFormatting'),
            icon: 'Eraser',
            keys: shortcutFor('clearFormatting'),
            actsOn: 'cells',
            whyNot: null,
            isWeighty: true,
            run: () =>
              props.onFormatChosen({
                clearsFormatting: true,
              }),
          } satisfies MenuCommand,
          ...formatAsTableCommands,
          {
            id: 'menu.conditionalFormatting',
            label: CONDITIONAL_FORMATTING_WORDS.conditionalFormatting(),
            otherWords: commandSearchSynonyms('conditionalFormatting'),
            icon: 'ConditionalFormat',
            actsOn: 'opens',
            home: 'toolbar',
            whyNot: null,
            run: () => props.onConditionalFormatsAsked('menu'),
          } satisfies MenuCommand,
          {
            id: 'menu.pivotTable',
            label: props.isActiveCellOfPivotTable ? pivotTableMessages.edit() : pivotTableMessages.pivotTable(),
            otherWords: commandSearchSynonyms('pivotTable'),
            icon: 'Table',
            ...(props.isActiveCellOfPivotTable
              ? {
                  actsOn: 'opens',
                  home: 'pane',
                }
              : {
                  actsOn: 'file',
                }),
            whyNot: null,
            run: props.onPivotTableAsked,
          } satisfies MenuCommand,
        ]),
    ...(props.isCellHistoryOffered
      ? [
          {
            id: 'menu.cellHistory',
            label: cellHistoryMessages.show(),
            otherWords: commandSearchSynonyms('cellHistory'),
            icon: 'History',
            actsOn: 'opens',
            whyNot: null,
            run: props.onCellHistoryAsked,
          },
        ] satisfies MenuCommand[]
      : []),
  ];
}
/** How merged commands run: as from the cell menu, or as from the bar. */
export interface MergedCommandsRun {
  runsAs: 'menu' | 'bar';
}
export function mergeMenuAndBarCommands(
  menuCommands: readonly MenuCommand[],
  barCommands: readonly MenuCommand[],
  { runsAs }: MergedCommandsRun = {
    runsAs: 'menu',
  },
): MenuCommand[] {
  const barCommandById = new Map(barCommands.map((command) => [command.id, command]));
  const mergedBarIds = new Set<string>();
  return [
    ...menuCommands.map((command) => {
      const barCommand = barCommandById.get(BAR_COMMAND_OF_MENU_COMMAND[command.id] ?? '');
      if (barCommand === undefined) return command;
      mergedBarIds.add(barCommand.id);
      const otherWords = [...new Set([...(command.otherWords ?? []), ...(barCommand.otherWords ?? [])])];
      return {
        ...command,
        icon: command.icon ?? barCommand.icon,
        ...(otherWords.length > 0 && {
          otherWords,
        }),
        ...(runsAs === 'bar' &&
          TEXT_STYLE_MENU_COMMAND_IDS.has(command.id) && {
            run: barCommand.run,
          }),
      };
    }),
    ...barCommands.filter(({ id }) => !mergedBarIds.has(id)),
  ];
}
export const SORT_CHANGES: Record<SortScope, Record<SortDirection, SheetChange & CommandOfOneRange>> = {
  sheet: {
    ascending: 'sortAscending',
    descending: 'sortDescending',
  },
  range: {
    ascending: 'sortRangeAscending',
    descending: 'sortRangeDescending',
  },
};
/** The sheet changes that group, ungroup, collapse and expand rows or columns. */
export interface GroupChanges {
  group: SheetChange;
  ungroup: SheetChange;
  collapse: SheetChange;
  expand: SheetChange;
}
export const GROUP_CHANGES: Record<LinesAxisName, GroupChanges> = {
  rows: {
    group: 'groupRows',
    ungroup: 'ungroupRows',
    collapse: 'collapseRows',
    expand: 'expandRows',
  },
  columns: {
    group: 'groupColumns',
    ungroup: 'ungroupColumns',
    collapse: 'collapseColumns',
    expand: 'expandColumns',
  },
};
export const OTHER_WORDS_KEYS_OF_CHANGES: Partial<Record<SheetChange, CommandWithSynonyms>> = {
  insertRowAbove: 'insertRowAbove',
  insertRowBelow: 'insertRowBelow',
  insertColumnLeft: 'insertColumnLeft',
  insertColumnRight: 'insertColumnRight',
  moveRowsUp: 'moveRowsUp',
  moveRowsDown: 'moveRowsDown',
  moveColumnsLeft: 'moveColumnsLeft',
  moveColumnsRight: 'moveColumnsRight',
  deleteRows: 'deleteRows',
  deleteColumns: 'deleteColumns',
  resizeRows: 'resizeRows',
  resizeColumns: 'resizeColumns',
  groupRows: 'groupLines',
  groupColumns: 'groupLines',
  ungroupRows: 'ungroupLines',
  ungroupColumns: 'ungroupLines',
  collapseRows: 'collapseGroups',
  collapseColumns: 'collapseGroups',
  expandRows: 'expandGroups',
  expandColumns: 'expandGroups',
  [SORT_CHANGES.range.ascending]: 'sortAscending',
  [SORT_CHANGES.sheet.ascending]: 'sortAscending',
  [SORT_CHANGES.range.descending]: 'sortDescending',
  [SORT_CHANGES.sheet.descending]: 'sortDescending',
  mergeCells: 'mergeCells',
  unmergeCells: 'unmergeCells',
  convertTexts: 'convertTexts',
};
export const FREEZE_OTHER_WORDS_KEYS: Record<LinesAxisName, Record<'none' | 'some', CommandWithSynonyms>> = {
  rows: {
    none: 'unfreezeRows',
    some: 'freezeRows',
  },
  columns: {
    none: 'unfreezeColumns',
    some: 'freezeColumns',
  },
};
export const BAR_COMMAND_OF_MENU_COMMAND: Partial<Record<string, string>> = {
  'menu.bold': 'bar.bold',
  'menu.italic': 'bar.italic',
  'menu.underline': 'bar.underline',
  'menu.strikethrough': 'bar.strikethrough',
  'menu.conditionalFormatting': 'bar.conditionalFormatting',
  'menu.mergeCells': 'bar.mergeCells',
  'menu.unmergeCells': 'bar.unmergeCells',
  'menu.insertRowAbove': 'bar.insertRowAbove',
  'menu.insertRowBelow': 'bar.insertRowBelow',
  'menu.insertColumnLeft': 'bar.insertColumnLeft',
  'menu.insertColumnRight': 'bar.insertColumnRight',
  'menu.customSort.sheet': 'bar.customSort',
  'menu.customSort.range': 'bar.customSort',
  'menu.sortAndFilter': 'bar.sortAndFilter',
};
export const TEXT_STYLE_MENU_COMMAND_IDS: ReadonlySet<string> = new Set(['menu.bold', 'menu.italic', 'menu.underline', 'menu.strikethrough']);
export const isTextStyleMenuCommand = (id: string) => TEXT_STYLE_MENU_COMMAND_IDS.has(id);
