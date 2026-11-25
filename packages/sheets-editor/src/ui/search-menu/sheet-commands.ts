import { sheetCommandSynonyms, blankSheetWord, sheetWord } from '../../messages/sheet-command-words.ts';
import { shortcutActionLabel } from '../../messages/shortcut-labels.ts';
import { shortcutKeysFor } from '../../keys/shortcut-list.ts';
import { sheetMessages } from '../../i18n/sheet-messages.ts';
import { versionHistoryMessages } from '../../history/version-text.ts';
import { functionListLabel } from '../../messages/formula-autocomplete.ts';
import { FILE_UPLOAD_ICON, IMPORT_FILE_SOURCES, type ImportFileSource } from '../../import/file-sources.tsx';
import { importFileChoices } from '../../import/csv-file.tsx';
import { shortcutFor } from '../../keys/key-press.ts';
import { copiedSheetNameAffixes } from '../../i18n/sheet-names.ts';
import { toolLabelWithValue } from '../../tools/search-words.ts';
import type { IconName } from '../../kit/icon.tsx';
import type { MenuCommand } from './matching.ts';
import type { ImportFileChoice } from '../../import/csv-file.tsx';
import type { ListedSheet, PageView } from '../../view/page-view.ts';
import type {
  KeyPressed,
  SheetDeleteChosen,
  SheetDuplicateChosen,
  SheetLinkCopyChosen,
  SheetMoveChosen,
  SheetRenameChosen,
} from '../../state/event-reducer.ts';
/** What the sheet commands of the search menu read of the page. */
export interface SheetSearchState {
  sheet: Pick<ListedSheet, 'sheetId' | 'canBeDeleted'>;
  isOnlySheet: boolean;
  placeAmongTabs: { index: number; count: number };
  viewOnlyBecause: PageView['viewOnlyBecause'];
  isVersionHistoryOpen: boolean;
  filesForAgent: readonly ImportFileSource[];
  whyNoToolForCells: string | null;
}
/** An event a sheet command of the search menu sends. */
export type SheetSearchEvent =
  | SheetMoveChosen
  | SheetLinkCopyChosen
  | SheetRenameChosen
  | SheetDuplicateChosen
  | SheetDeleteChosen
  | KeyPressed;
/** What the sheet commands of the search menu do when they are taken. */
export interface SheetSearchActions {
  dispatch: (event: SheetSearchEvent) => void;
  onBlankChosen: () => void;
  onImportChosen: (choices: ImportFileChoice[]) => void;
  onFileForAgentChosen: (source: ImportFileSource) => void;
  onVersionHistoryAsked: () => void;
  onAllFunctionsAsked: () => void;
  onAllSheetsAsked: (() => void) | null;
}
/** A fill done by a key, offered in the search menu. */
export interface FillCommand {
  id: string;
  does: 'fillDown' | 'fillRight';
  key: string;
}
export function sheetSearchCommands(state: SheetSearchState, actions: SheetSearchActions): MenuCommand[] {
  let { sheetId, canBeDeleted } = state.sheet;
  let { index: tabIndex, count: tabCount } = state.placeAmongTabs;
  let { onAllSheetsAsked } = actions;
  let canEdit = state.viewOnlyBecause === null;
  let moveCommand = (id: string, label: string, icon: IconName, toIndex: number): MenuCommand => ({
    id,
    label: sheetCommandLabel(label),
    otherWords: sheetCommandSynonyms('move'),
    icon,
    actsOn: 'file',
    whyNot: null,
    isWeighty: true,
    run: () =>
      actions.dispatch({
        kind: 'sheetMoveChosen',
        sheetId,
        toIndex,
      }),
  });
  let copyLinkCommand: MenuCommand = {
    id: 'sheet.tab.copyLink',
    label: sheetCommandLabel(shortcutActionLabel('copyLinkToSheet')),
    otherWords: sheetCommandSynonyms('copyLink'),
    icon: 'Link',
    keys: shortcutKeysFor('copyLinkToSheet'),
    actsOn: 'sheet',
    whyNot: null,
    run: () =>
      actions.dispatch({
        kind: 'sheetLinkCopyChosen',
        sheetId,
      }),
  };
  let allSheetsCommands: MenuCommand[] =
    onAllSheetsAsked === null
      ? []
      : [
          {
            id: 'sheet.allSheets',
            label: sheetMessages.allSheets(),
            otherWords: sheetCommandSynonyms('allSheets'),
            icon: 'ListBullet',
            actsOn: 'opens',
            home: 'sheetTab',
            whyNot: null,
            run: onAllSheetsAsked,
          },
        ];
  if (!canEdit) return [...allSheetsCommands, copyLinkCommand];
  return [
    {
      id: 'sheet.versionHistory',
      label: versionHistoryMessages.title(),
      otherWords: sheetCommandSynonyms('versionHistory'),
      icon: 'History',
      isTicked: state.isVersionHistoryOpen,
      actsOn: 'opens',
      home: 'pane',
      whyNot: null,
      run: actions.onVersionHistoryAsked,
    },
    {
      id: 'sheet.functions',
      label: functionListLabel(),
      otherWords: sheetCommandSynonyms('functions'),
      icon: 'Function',
      actsOn: 'activeCell',
      whyNot: null,
      run: actions.onAllFunctionsAsked,
    },
    ...allSheetsCommands,
    ...(state.filesForAgent ?? []).map((source): MenuCommand => ({
      id: `sheet.add.${source}`,
      label: addSheetCommandLabel(IMPORT_FILE_SOURCES[source].name()),
      otherWords: sheetCommandSynonyms('addFromFile'),
      icon: IMPORT_FILE_SOURCES[source].mark,
      actsOn: 'handsOver',
      isWeighty: true,
      whyNot: null,
      run: () => actions.onFileForAgentChosen(source),
    })),
    ...importFileChoices.map(
      (choice, index): MenuCommand => ({
        id: index === 0 ? 'sheet.add.importCsv' : `sheet.add.import${index}`,
        label: addSheetCommandLabel(choice.inMenu()),
        otherWords: sheetCommandSynonyms('addFromFile'),
        icon: FILE_UPLOAD_ICON,
        actsOn: 'opens',
        isWeighty: true,
        whyNot: null,
        run: () => actions.onImportChosen([choice]),
      }),
    ),
    {
      id: 'sheet.add.blank',
      label: addSheetCommandLabel(blankSheetWord()),
      otherWords: sheetCommandSynonyms('addBlank'),
      icon: 'File',
      keys: shortcutFor('addSheet'),
      actsOn: 'file',
      isWeighty: true,
      whyNot: null,
      run: actions.onBlankChosen,
    },
    {
      id: 'sheet.tab.rename',
      label: sheetCommandLabel(sheetMessages.renameSheet()),
      otherWords: sheetCommandSynonyms('rename'),
      icon: 'Edit',
      actsOn: 'opens',
      home: 'sheetTab',
      whyNot: null,
      run: () =>
        actions.dispatch({
          kind: 'sheetRenameChosen',
          sheetId,
        }),
    },
    {
      id: 'sheet.tab.duplicate',
      label: sheetCommandLabel(sheetMessages.duplicateSheet()),
      otherWords: sheetCommandSynonyms('duplicate'),
      icon: 'Copy',
      actsOn: 'file',
      isWeighty: true,
      whyNot: null,
      run: () =>
        actions.dispatch({
          kind: 'sheetDuplicateChosen',
          sheetId,
          wordsAroundName: copiedSheetNameAffixes(),
        }),
    },
    copyLinkCommand,
    ...(tabIndex > 0 ? [moveCommand('sheet.tab.moveLeft', sheetMessages.moveSheetLeft(), 'ArrowLeft', tabIndex - 1)] : []),
    ...(tabIndex < tabCount - 1 ? [moveCommand('sheet.tab.moveRight', sheetMessages.moveSheetRight(), 'ArrowRight', tabIndex + 1)] : []),
    ...(canBeDeleted || state.isOnlySheet
      ? [
          {
            id: 'sheet.tab.delete',
            label: sheetCommandLabel(sheetMessages.deleteSheet()),
            otherWords: sheetCommandSynonyms('delete'),
            icon: 'Trash',
            actsOn: 'file',
            whyNot: canBeDeleted ? null : sheetMessages.onlySheet(),
            isWeighty: true,
            run: () =>
              actions.dispatch({
                kind: 'sheetDeleteChosen',
                sheetId,
              }),
          },
        ] satisfies MenuCommand[]
      : []),
    ...FILL_COMMANDS.map(
      ({ id, does, key }): MenuCommand => ({
        id,
        label: shortcutActionLabel(does),
        otherWords: sheetCommandSynonyms('fill'),
        icon: null,
        keys: shortcutKeysFor(does),
        actsOn: 'cells',
        whyNot: state.whyNoToolForCells,
        isWeighty: true,
        run: () => actions.dispatch(modifierKeyPressedAction(key)),
      }),
    ),
  ];
}
export const modifierKeyPressedAction = (key: string): KeyPressed => ({
  kind: 'keyPressed',
  key,
  isShiftHeld: false,
  isModifierHeld: true,
  isAltHeld: false,
  isRepeat: false,
});
export const sheetCommandLabel = (label: string | undefined) => toolLabelWithValue(sheetWord(), label);
export const addSheetCommandLabel = (label: string) => toolLabelWithValue(sheetMessages.addSheet(), label);
export const FILL_COMMANDS: FillCommand[] = [
  {
    id: 'sheet.fillDown',
    does: 'fillDown',
    key: 'd',
  },
  {
    id: 'sheet.fillRight',
    does: 'fillRight',
    key: 'r',
  },
];
