import type { KeyShortcutAct, KeyShortcutGroupName } from '../keys/shortcut-list.ts';
import { translateMessage } from '../i18n/messages.ts';
import { sheetMessages, textStyleLabel } from '../i18n/sheet-messages.ts';
import { findBarMessages } from '../i18n/find-labels.ts';
import { expandGroupsLabel, collapseGroupsLabel } from './line-groups.ts';
import { linkEditMessages } from '../links/link-hover-card.tsx';
import { listKindName } from './import.ts';
import { numberFormatChoiceLabel } from '../i18n/format-labels.ts';
export function shortcutGroupLabel(group: KeyShortcutGroupName): string {
  switch (group) {
    case 'general':
      return translateMessage({
        defaultMessage: 'General',
        id: 'jMKqyV9z74',
      });
    case 'navigation':
      return translateMessage({
        defaultMessage: 'Navigation',
        id: 'vLP2UvkuOC',
      });
    case 'selection':
      return translateMessage({
        defaultMessage: 'Selection',
        id: 'qLyJTOnob+',
      });
    case 'rowsColumnsAndSheets':
      return translateMessage({
        defaultMessage: 'Rows, columns, and sheets',
        id: 'jgNPFV+1jT',
      });
    case 'groups':
      return translateMessage({
        defaultMessage: 'Groups of rows and columns',
        id: '8z4vgSbKaJ',
      });
    case 'editing':
      return translateMessage({
        defaultMessage: 'Editing',
        id: 'DsLiebvSAm',
      });
    case 'typing':
      return translateMessage({
        defaultMessage: 'While typing in a cell',
        id: 'hAZUKl+2k6',
      });
    case 'typingAFormula':
      return translateMessage({
        defaultMessage: 'While typing a formula',
        id: 'RjcyU0E9Fz',
      });
    case 'formatting':
      return sheetMessages.formatting();
    case 'numberFormats':
      return translateMessage({
        defaultMessage: 'Number formats',
        id: 'DB+bo6FhKP',
      });
  }
}
/** The label of a listed key's act. */
export function shortcutActionLabel(action: KeyShortcutAct): string {
  switch (action) {
    case 'listKeys':
      return shortcutListMessages.title();
    case 'find':
      return translateMessage({
        defaultMessage: 'Find in this sheet',
        id: 'HThSLJgPl/',
      });
    case 'findNext':
      return findBarMessages.next();
    case 'findPrevious':
      return findBarMessages.previous();
    case 'findAndReplace':
      return findBarMessages.findAndReplace();
    case 'undo':
      return sheetMessages.undo();
    case 'redo':
      return translateMessage({
        defaultMessage: 'Redo',
        id: 'azvnmF0sgQ',
      });
    case 'showFormulas':
      return translateMessage({
        defaultMessage: 'Show or hide formulas',
        id: '4FKHkwnf9p',
      });
    case 'copyLinkToSheet':
      return translateMessage({
        defaultMessage: 'Copy link to sheet',
        id: 'hMSe8OFm8s',
      });
    case 'comment':
      return sheetMessages.comment();
    case 'openMenu':
      return translateMessage({
        defaultMessage: 'Open the menu for the selected cells',
        id: '3kZK0uRRuj',
      });
    case 'searchMenu':
      return translateMessage({
        defaultMessage: 'Search the menus',
        id: 'HUWGfyaBVU',
      });
    case 'goToNextPart':
      return translateMessage({
        defaultMessage: 'Go to the next part of the page',
        id: 't4b334tc86',
      });
    case 'goToPartBefore':
      return translateMessage({
        defaultMessage: 'Go to the previous part of the page',
        id: 'UHJnRJayZ/',
      });
    case 'closeWhatIsOpen':
      return translateMessage({
        defaultMessage: 'Close a message or pane',
        id: 'iOm2kIVE9u',
      });
    case 'leaveCells':
      return translateMessage({
        defaultMessage: 'Leave the cells',
        id: 'Sj3FOlFs0l',
      });
    case 'leaveSheet':
      return translateMessage({
        defaultMessage: 'Leave the Sheet',
        id: 'mOPClGmhJj',
      });
    case 'moveByOneCell':
      return translateMessage({
        defaultMessage: 'Move one cell',
        id: 'SG8SjMcyHu',
      });
    case 'moveToNextCell':
      return translateMessage({
        defaultMessage: 'Move one cell right',
        id: 'o+2OZsvHy2',
      });
    case 'moveToCellBefore':
      return translateMessage({
        defaultMessage: 'Move one cell left',
        id: 'p2k0mAaL5Q',
      });
    case 'moveToEdgeOfData':
      return translateMessage({
        defaultMessage: 'Move to the edge of the data',
        id: 'utXwYaPC+b',
      });
    case 'moveToStartOfRow':
      return translateMessage({
        defaultMessage: 'Move to the start of the row',
        id: 'iMjVK9oy/z',
      });
    case 'moveToEndOfRow':
      return translateMessage({
        defaultMessage: 'Move to the end of the row',
        id: 'meoCmbcATa',
      });
    case 'moveToStartOfSheet':
      return translateMessage({
        defaultMessage: 'Move to the first cell',
        id: 'wffze0ugcb',
      });
    case 'moveToEndOfSheet':
      return translateMessage({
        defaultMessage: 'Move to the last cell',
        id: '343sVgtamU',
      });
    case 'moveUpAScreen':
      return translateMessage({
        defaultMessage: 'Move up one screen',
        id: 'g4FuETlPPD',
      });
    case 'moveDownAScreen':
      return translateMessage({
        defaultMessage: 'Move down one screen',
        id: 'ZzzQ2lCT0h',
      });
    case 'showNextSheet':
      return translateMessage({
        defaultMessage: 'Go to the next sheet',
        id: 'PhqJlj31RD',
      });
    case 'openOwnFilterList':
      return translateMessage({
        defaultMessage: 'Open a column’s filter, from its header cell',
        id: 'CXNFB5Cqor',
      });
    case 'showSheetBefore':
      return translateMessage({
        defaultMessage: 'Go to the previous sheet',
        id: 'Nv9BSe4qFG',
      });
    case 'selectMore':
      return translateMessage({
        defaultMessage: 'Extend the selection',
        id: 'd2wIOuBmU4',
      });
    case 'selectToEdgeOfData':
      return translateMessage({
        defaultMessage: 'Extend the selection to the edge of the data',
        id: 'h0BYM771bi',
      });
    case 'selectRow':
      return translateMessage({
        defaultMessage: 'Select the row',
        id: 'zyoF/CJ5jM',
      });
    case 'selectColumn':
      return translateMessage({
        defaultMessage: 'Select the column',
        id: 'A1ouNbEaxe',
      });
    case 'selectAll':
      return translateMessage({
        defaultMessage: 'Select all',
        id: 'w7aWR9Zb0D',
      });
    case 'insertRowsOrColumns':
      return translateMessage({
        defaultMessage: 'Insert rows or columns',
        id: 'Hb9XIT/pCe',
      });
    case 'deleteRowsOrColumns':
      return translateMessage({
        defaultMessage: 'Delete rows or columns',
        id: 'QqEzxmbhoA',
      });
    case 'addSheet':
      return sheetMessages.addSheet();
    case 'clearFormatting':
      return sheetMessages.clearFormatting();
    case 'group':
      return translateMessage({
        defaultMessage: 'Group rows or columns',
        id: '7V+YW0MhYY',
      });
    case 'ungroup':
      return translateMessage({
        defaultMessage: 'Ungroup rows or columns',
        id: 'BfDuj1/jaP',
      });
    case 'expandGroup':
      return expandGroupsLabel(1);
    case 'collapseGroup':
      return collapseGroupsLabel(1);
    case 'editCell':
      return translateMessage({
        defaultMessage: 'Edit the cell',
        id: 'JRsqjXjZaK',
      });
    case 'startFormula':
      return translateMessage({
        defaultMessage: 'Start a formula',
        id: 'CDANvqYZrO',
      });
    case 'insertByAt':
      return translateMessage({
        defaultMessage: 'Insert a person, date, or dropdown',
        id: 'SzxM3OChcC',
      });
    case 'addLink':
      return linkEditMessages.insertLink();
    case 'clearCells':
      return sheetMessages.clearContents();
    case 'cut':
      return sheetMessages.cut();
    case 'copy':
      return sheetMessages.copy();
    case 'paste':
      return translateMessage({
        defaultMessage: 'Paste',
        id: 'XKpazlipJj',
      });
    case 'pasteValuesOnly':
      return sheetMessages.pasteValuesOnly();
    case 'fillDown':
      return translateMessage({
        defaultMessage: 'Fill down',
        id: 'ZltcryQhRo',
      });
    case 'fillRight':
      return translateMessage({
        defaultMessage: 'Fill right',
        id: 'gvzBLgdhsW',
      });
    case 'enterToday':
      return translateMessage({
        defaultMessage: 'Insert today’s date',
        id: 'WihkwMG8Ia',
      });
    case 'sumUp':
      return translateMessage({
        defaultMessage: 'Insert a sum',
        id: 'jghqaiaZP5',
      });
    case 'tickCheckbox':
      return translateMessage({
        defaultMessage: 'Check or uncheck a checkbox',
        id: 'T/BBxDznn7',
      });
    case 'openLink':
      return sheetMessages.openLink();
    case 'finishAndMoveDown':
      return translateMessage({
        defaultMessage: 'Finish and move down',
        id: '3D3K2/oWjA',
      });
    case 'finishAndMoveUp':
      return translateMessage({
        defaultMessage: 'Finish and move up',
        id: '5Iq8SKFoaZ',
      });
    case 'finishAndMoveRight':
      return translateMessage({
        defaultMessage: 'Finish and move right',
        id: 'Dl7pGwf3DL',
      });
    case 'finishAndMoveLeft':
      return translateMessage({
        defaultMessage: 'Finish and move left',
        id: '93BE4LF9Ua',
      });
    case 'finishInAllSelected':
      return translateMessage({
        defaultMessage: 'Finish and fill every selected cell, if there are several',
        id: 'fUtQTTKab1',
      });
    case 'breakLine':
      return translateMessage({
        defaultMessage: 'Start a new line',
        id: 'MK9olc8lIR',
      });
    case 'finishExpandedCell':
      return translateMessage({
        defaultMessage: 'Finish the edit in an expanded cell',
        id: 'SXcSng3WKc',
      });
    case 'expandCell':
      return translateMessage({
        defaultMessage: 'Expand or collapse the cell',
        id: '0PjJDWMIaD',
      });
    case 'startNextListItem':
      return translateMessage({
        defaultMessage: 'Start the next list item',
        id: 'EYqYHVVvK5',
      });
    case 'checkBoxOfLine':
      return translateMessage({
        defaultMessage: 'Check or uncheck a checklist item',
        id: 'oNQMI+u1+Y',
      });
    case 'moveCaretByArrows':
      return translateMessage({
        defaultMessage: 'Move through the text with the arrow keys',
        id: '59gSgGCCbG',
      });
    case 'cancelEntry':
      return translateMessage({
        defaultMessage: 'Cancel the edit',
        id: 'kOWEjUtQJe',
      });
    case 'pickCell':
      return translateMessage({
        defaultMessage: 'Pick a cell',
        id: 'dg4e+IoqKJ',
      });
    case 'pickMoreCells':
      return translateMessage({
        defaultMessage: 'Pick a range of cells',
        id: 'Lb65V4Qq2d',
      });
    case 'pickCellInNextSheet':
      return translateMessage({
        defaultMessage: 'Pick a cell in the next sheet',
        id: '8RbIFiRtvP',
      });
    case 'pickCellInSheetBefore':
      return translateMessage({
        defaultMessage: 'Pick a cell in the previous sheet',
        id: 'VaN9x6vtYF',
      });
    case 'switchArrows':
      return translateMessage({
        defaultMessage: 'Switch the arrow keys between cells and text',
        id: 'r1OzuGogkS',
      });
    case 'turnDollars':
      return translateMessage({
        defaultMessage: 'Switch between relative and absolute references',
        id: 'MC9JxnjJf0',
      });
    case 'bold':
      return textStyleLabel('bold');
    case 'italic':
      return textStyleLabel('italic');
    case 'underline':
      return textStyleLabel('underline');
    case 'strikethrough':
      return textStyleLabel('strikethrough');
    case 'numberedList':
      return listKindName('numbered');
    case 'bulletedList':
      return listKindName('bullet');
    case 'checklist':
      return listKindName('checkbox');
    case 'alignLeft':
      return translateMessage({
        defaultMessage: 'Align left',
        id: '18L8IBvk0U',
      });
    case 'alignCenter':
      return translateMessage({
        defaultMessage: 'Align center',
        id: 'qeAGWnETuk',
      });
    case 'formatAsNumber':
      return numberFormatChoiceLabel('number');
    case 'formatAsTime':
      return numberFormatChoiceLabel('time');
    case 'formatAsDate':
      return numberFormatChoiceLabel('date');
    case 'formatAsCurrency':
      return numberFormatChoiceLabel('currency');
    case 'formatAsPercent':
      return numberFormatChoiceLabel('percent');
    case 'formatAsScientific':
      return numberFormatChoiceLabel('scientific');
  }
}
export const shortcutListMessages = {
  title: () =>
    translateMessage({
      defaultMessage: 'Keyboard shortcuts',
      id: '5quANI3nS3',
    }),
  keyThatOpensIt: (isMac: boolean): string =>
    isMac
      ? translateMessage({
          defaultMessage: 'Press Command+Slash for keyboard shortcuts.',
          id: 'VGsPHwlln2',
        })
      : translateMessage({
          defaultMessage: 'Press Ctrl+Slash for keyboard shortcuts.',
          id: 'pgh4vd/HTR',
        }),
  keysThatLeaveCells: () =>
    translateMessage({
      defaultMessage: 'Press Escape, then Tab, to leave the cells.',
      id: '2Ic5ZA+9gH',
    }),
  or: () =>
    translateMessage({
      defaultMessage: 'or',
      id: '8hASn91gui',
    }),
};
