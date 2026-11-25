import type { ParagraphList } from '@open-artifact/sheets-core';
import type { TableImportedIntoSheetOffer } from '../state/initial-state.ts';
import type { DuplicateRefusedNotice } from '../state/sheet-tabs.ts';
import { translateMessage, MESSAGE_LOCALE } from '../i18n/messages.ts';
import { refusalMessageKey } from '../model/refusals.ts';

/** A column of a sheet as import notes name it: its letters, and its heading when it has one. */
export interface ImportColumnLabel {
  letters: string;
  name: string | null;
}

/** New dropdown options an import adds to one column. */
export interface DropdownOptionsAdded {
  column: ImportColumnLabel;
  labels: string[];
}

/** What importing a file into a sheet would change. */
export interface ImportIntoSheetChanges {
  isReplaced: boolean;
  addedCount: number;
  changedCount: number;
  sameCount: number;
  goneCount: number;
  untouchedCount: number;
  /** The rows previewed; only their number is read here. */
  rows: readonly unknown[];
  optionsAdded: DropdownOptionsAdded[];
  columnsCleared: ImportColumnLabel[];
  formulasWrittenOver: { count: number; columns: ImportColumnLabel[] };
}

/** The notes shown under an import's preview. */
export interface ImportNotes {
  words: string;
  variant: 'neutral' | 'warning';
}

/** How a row of the sheet changes in an import. */
export type ImportRowChange = 'added' | 'changed' | 'gone';

/** A kind of list a cell's lines can be. */
export type ParagraphListKind = Exclude<ParagraphList['kind'], 'none'>;

/** Why an interactive sheet shows a problem in place of its panel. */
export type InteractiveTroubleWhy = 'cantBeShown' | 'tooMuchData' | 'notLoaded' | 'tookKeyboard' | 'stoppedAnswering';

/** The title and advice shown in place of an interactive sheet's panel. */
export interface InteractiveTroubleWords {
  title: string;
  advice: string;
}

/** Why a sheet that shows an interactive was not duplicated. */
export type InteractiveNotDuplicatedWhy = Exclude<DuplicateRefusedNotice['why'], 'chartsNotCopied'>;

export function importPlanSummary(plan: ImportIntoSheetChanges, sheetName: string): string {
  let { addedCount, changedCount, goneCount } = plan;
  if (isImportChangeless(plan))
    return translateMessage(
      {
        defaultMessage: '{sheetName} already has all of these rows.',
        id: 'Zykp65BlLS',
      },
      {
        sheetName,
      },
    );
  let currentRowCount = changedCount + plan.sameCount + goneCount;
  if (plan.isReplaced && currentRowCount > 0)
    return translateMessage(
      {
        defaultMessage:
          '{writtenCount, plural, one {# row will replace {currentRows} in {sheetName}.} other {{writtenCount, number} rows will replace {currentRows} in {sheetName}.}}',
        id: 'WOXybZ+Wic',
      },
      {
        writtenCount: addedCount + changedCount + plan.sameCount,
        currentRows: currentRowsWords(currentRowCount),
        sheetName,
      },
    );
  if (changedCount === 0)
    return translateMessage(
      {
        defaultMessage: '{addedCount, plural, one {# row} other {{addedCount, number} rows}} will be added to {sheetName}.',
        id: 'QeyocxOjqi',
      },
      {
        addedCount,
        sheetName,
      },
    );
  if (addedCount === 0)
    return translateMessage(
      {
        defaultMessage: '{changedCount, plural, one {# row} other {{changedCount, number} rows}} will be updated in {sheetName}.',
        id: 'W8EMotcBE4',
      },
      {
        changedCount,
        sheetName,
      },
    );
  return translateMessage(
    {
      defaultMessage: '{updatedRows} will be updated and {addedRows} added in {sheetName}.',
      id: 'TDY8bLk6/N',
    },
    {
      updatedRows: importRowCountWords(changedCount),
      addedRows: importRowCountWords(addedCount),
      sheetName,
    },
  );
}
export function importDoneWords({
  sheetName,
  isReplaced,
  addedCount,
  changedCount,
  isSaved,
}: TableImportedIntoSheetOffer): string {
  if (!isSaved)
    return translateMessage(
      {
        defaultMessage: 'Importing to {sheetName}…',
        id: '+VtCAxqtib',
      },
      {
        sheetName,
      },
    );
  if (isReplaced)
    return translateMessage(
      {
        defaultMessage: 'Replaced the rows in {sheetName}',
        id: 'YfGi8uLiM/',
      },
      {
        sheetName,
      },
    );
  if (changedCount === 0)
    return translateMessage(
      {
        defaultMessage: 'Added {addedCount, plural, one {# row} other {{addedCount, number} rows}} to {sheetName}',
        id: 'sh8j9Vt8uQ',
      },
      {
        addedCount,
        sheetName,
      },
    );
  if (addedCount === 0)
    return translateMessage(
      {
        defaultMessage: 'Updated {changedCount, plural, one {# row} other {{changedCount, number} rows}} in {sheetName}',
        id: 'fz9vWsInVJ',
      },
      {
        changedCount,
        sheetName,
      },
    );
  return translateMessage(
    {
      defaultMessage: 'Updated {updatedRows} and added {addedRows} in {sheetName}',
      id: 'voi3l3S4fx',
    },
    {
      updatedRows: importRowCountWords(changedCount),
      addedRows: importRowCountWords(addedCount),
      sheetName,
    },
  );
}
export function moreRowsChangeWords(plan: ImportIntoSheetChanges): string | null {
  let { addedCount, changedCount, sameCount, goneCount, isReplaced } = plan;
  let moreCount = addedCount + changedCount + (isReplaced ? sameCount : goneCount) - plan.rows.length;
  return moreCount <= 0
    ? null
    : translateMessage(
        {
          defaultMessage: '{moreCount, plural, one {# more row changes.} other {{moreCount, number} more rows change.}}',
          id: '7LbR+4lazF',
        },
        {
          moreCount,
        },
      );
}
export function rowsStayWords(plan: ImportIntoSheetChanges): string | null {
  let { sameCount, untouchedCount, isReplaced } = plan;
  let stayCount = isReplaced ? 0 : sameCount + untouchedCount;
  return stayCount <= 0
    ? null
    : translateMessage(
        {
          defaultMessage: '{staysCount, plural, one {# row stays as it is.} other {{staysCount, number} rows stay as they are.}}',
          id: 'gMeGvgA3NY',
        },
        {
          staysCount: stayCount,
        },
      );
}
export function dropdownOptionsAddedWords(optionLabels: readonly string[], column: ImportColumnLabel, sheetName: string): string {
  let shownOptions = optionLabels.slice(0, MAX_OPTIONS_NAMED_IN_IMPORT_NOTES).map(quotedOptionLabel);
  let moreCount = optionLabels.length - shownOptions.length;
  let [columnName = ''] = importColumnNames([column]);
  if (moreCount > 0)
    return translateMessage(
      {
        defaultMessage:
          '{moreCount, plural, one {{labels}, and # more will be added to the {columnName} dropdown in {sheetName}.} other {{labels}, and # more will be added to the {columnName} dropdown in {sheetName}.}}',
        id: 'zThKZeY9y5',
      },
      {
        moreCount,
        labels: new Intl.ListFormat(MESSAGE_LOCALE, {
          type: 'unit',
        }).format(shownOptions),
        columnName,
        sheetName,
      },
    );
  return translateMessage(
    {
      defaultMessage:
        '{count, plural, one {{labels} will be added to the {columnName} dropdown in {sheetName}.} other {{labels} will be added to the {columnName} dropdown in {sheetName}.}}',
      id: 'IAj8MRqaKK',
    },
    {
      count: shownOptions.length,
      labels: new Intl.ListFormat(MESSAGE_LOCALE).format(shownOptions),
      columnName,
      sheetName,
    },
  );
}
export function dropdownsOptionsAddedNotes(optionsByColumn: readonly DropdownOptionsAdded[], sheetName: string): string[] {
  if (optionsByColumn.length <= MAX_COLUMNS_NAMED_IN_IMPORT_NOTES)
    return optionsByColumn.map(({ labels, column }) => dropdownOptionsAddedWords(labels, column, sheetName));
  return [
    translateMessage(
      {
        defaultMessage:
          '{count, plural, one {# new option will be added to {columnCount, number, ::group-off} dropdowns in {sheetName}.} other {{count, number, ::group-off} new options will be added to {columnCount, number, ::group-off} dropdowns in {sheetName}.}}',
        id: 'SrZGHAG9MR',
      },
      {
        count: optionsByColumn.reduce((total, { labels }) => total + labels.length, 0),
        columnCount: optionsByColumn.length,
        sheetName,
      },
    ),
  ];
}
export function columnsClearedWords(columns: readonly ImportColumnLabel[], sheetName: string): string {
  if (columns.length > MAX_COLUMNS_NAMED_IN_IMPORT_NOTES)
    return translateMessage(
      {
        defaultMessage:
          '{count, plural, one {# other column in {sheetName} will be cleared too, including any formulas, because the file doesn’t have it.} other {{count, number} other columns in {sheetName} will be cleared too, including any formulas, because the file doesn’t have them.}}',
        id: 'AZaSnvbLCY',
      },
      {
        count: columns.length,
        sheetName,
      },
    );
  let columnNames = importColumnNames(columns);
  return translateMessage(
    {
      defaultMessage:
        '{count, plural, one {{names} will be cleared too, including any formulas, because the file doesn’t have that column.} other {{names} will be cleared too, including any formulas, because the file doesn’t have those columns.}}',
      id: 'OBtXG3GZVF',
    },
    {
      count: columnNames.length,
      names: new Intl.ListFormat(MESSAGE_LOCALE).format(columnNames),
    },
  );
}
export function formulasWrittenOverWords(count: number, columns: readonly ImportColumnLabel[], sheetName: string): string {
  if (columns.length > MAX_COLUMNS_NAMED_IN_IMPORT_NOTES)
    return translateMessage(
      {
        defaultMessage:
          '{count, plural, one {# formula in {columnCount, number} columns of {sheetName} will be replaced with the file’s value and stop updating.} other {{count, number} formulas in {columnCount, number} columns of {sheetName} will be replaced with the file’s values and stop updating.}}',
        id: 'vzEoKmohJ6',
      },
      {
        count,
        columnCount: columns.length,
        sheetName,
      },
    );
  return translateMessage(
    {
      defaultMessage:
        '{count, plural, one {# formula in {names} will be replaced with the file’s value and stop updating.} other {{count, number} formulas in {names} will be replaced with the file’s values and stop updating.}}',
      id: 'Z2E4++736w',
    },
    {
      count,
      names: new Intl.ListFormat(MESSAGE_LOCALE).format(importColumnNames(columns)),
    },
  );
}
export function importLossWarning(
  { columnsCleared, formulasWrittenOver }: Pick<ImportIntoSheetChanges, 'columnsCleared' | 'formulasWrittenOver'>,
  sheetName: string,
): string | null {
  let { count, columns } = formulasWrittenOver;
  let lines = [
    ...(columnsCleared.length > 0 ? [columnsClearedWords(columnsCleared, sheetName)] : []),
    ...(count > 0 ? [formulasWrittenOverWords(count, columns, sheetName)] : []),
  ];
  return lines.length > 0 ? lines.join(' ') : null;
}
export function importNotes(plan: ImportIntoSheetChanges, sheetName: string): ImportNotes | null {
  let lossWarning = importLossWarning(plan, sheetName);
  let optionNotes = dropdownsOptionsAddedNotes(plan.optionsAdded, sheetName);
  if (lossWarning === null && optionNotes.length === 0) return null;
  return {
    words: [...(lossWarning === null ? [] : [lossWarning]), ...optionNotes].join(' '),
    variant: lossWarning === null ? 'neutral' : 'warning',
  };
}
export function importRefusalWords(refusal: string, sheetName: string, keyName: string | null): string {
  if (refusal === 'keyRepeats')
    return translateMessage(
      {
        defaultMessage:
          'Rows can’t be matched by {keyName} because some of its values repeat. You can match by another column or choose another option.',
        id: '4moqi/iy7W',
      },
      {
        keyName: keyName ?? '',
      },
    );
  if (refusal === 'cellCoveredByMergedRange')
    return translateMessage(
      {
        defaultMessage: '{sheetName} has merged cells where these rows would go. You can import to a new sheet.',
        id: 'qH/OCmFt5s',
      },
      {
        sheetName,
      },
    );
  if (refusal === 'tooManyDropdownOptions')
    return translateMessage(
      {
        defaultMessage:
          'A dropdown in {sheetName} can have up to 100 options, and this file has too many new values for it. You can import to a new sheet.',
        id: 'HC+4wWXfaj',
      },
      {
        sheetName,
      },
    );
  if (refusal === 'dropdownOptionTooLong' || refusal === 'dropdownOptionHoldsControlCharacter')
    return translateMessage(
      {
        defaultMessage:
          'Some values in this file are over 100 characters or have line breaks, so they can’t be dropdown options in {sheetName}. You can import to a new sheet.',
        id: 'jhyC4NPZWS',
      },
      {
        sheetName,
      },
    );
  if (refusalMessageKey(refusal) === 'noRoomInWorkbook')
    return translateMessage({
      defaultMessage: 'This Sheet doesn’t have room for that much data. Import a smaller file.',
      id: 'dYGkEJ/GES',
    });
  return translateMessage(
    {
      defaultMessage: 'This file can’t go into {sheetName}. You can import to a new sheet.',
      id: '8q2XGzq7ck',
    },
    {
      sheetName,
    },
  );
}
export function listKindName(kind: ParagraphListKind): string {
  switch (kind) {
    case 'bullet':
      return translateMessage({
        defaultMessage: 'Bulleted list',
        id: '3cPsFM4vaz',
      });
    case 'numbered':
      return translateMessage({
        defaultMessage: 'Numbered list',
        id: 'Q8Yu8zRwwm',
      });
    case 'checkbox':
      return translateMessage({
        defaultMessage: 'Checklist',
        id: 'fGEcnqeBe8',
      });
  }
}
export function listKindOnOffWords(kind: ParagraphListKind, isOn: boolean): string {
  switch (kind) {
    case 'bullet':
      return translateMessage(
        {
          defaultMessage: '{isOn, select, true {Bulleted list on} other {Bulleted list off}}',
          id: 'NVvCzIKwD9',
        },
        {
          isOn: String(isOn),
        },
      );
    case 'numbered':
      return translateMessage(
        {
          defaultMessage: '{isOn, select, true {Numbered list on} other {Numbered list off}}',
          id: 'S8rD6WgwrV',
        },
        {
          isOn: String(isOn),
        },
      );
    case 'checkbox':
      return translateMessage(
        {
          defaultMessage: '{isOn, select, true {Checklist on} other {Checklist off}}',
          id: 'VggFzlOIrF',
        },
        {
          isOn: String(isOn),
        },
      );
  }
}
export function interactiveTroubleWords(why: InteractiveTroubleWhy): InteractiveTroubleWords {
  switch (why) {
    case 'cantBeShown':
      return {
        title: translateMessage({
          defaultMessage: 'This interactive sheet can’t be shown',
          id: 'gz3ZQBc11x',
        }),
        advice: translateMessage({
          defaultMessage: 'Ask Agent to fix it.',
          id: 'xpztOt0Is4',
        }),
      };
    case 'tooMuchData':
      return {
        title: translateMessage({
          defaultMessage: 'Too much data for this interactive sheet',
          id: 'A7BmxDMlv9',
        }),
        advice: translateMessage({
          defaultMessage: 'Ask Agent to use fewer rows.',
          id: 'YpTBAsyZYz',
        }),
      };
    case 'notLoaded':
      return {
        title: translateMessage({
          defaultMessage: 'This interactive sheet didn’t load',
          id: 'it7zGnN4UW',
        }),
        advice: translateMessage({
          defaultMessage: 'Reload the page to try again.',
          id: '81HAebivqR',
        }),
      };
    case 'tookKeyboard':
      return {
        title: interactiveStoppedTitle(),
        advice: translateMessage({
          defaultMessage: 'It kept interrupting your typing.',
          id: 'tbjGnRUhz6',
        }),
      };
    case 'stoppedAnswering':
      return {
        title: interactiveStoppedTitle(),
        advice: translateMessage({
          defaultMessage: 'It stopped responding.',
          id: 'YQLvLkdBw2',
        }),
      };
  }
}
export function interactiveFixAsk(why: InteractiveTroubleWhy): string | null {
  if (why === 'cantBeShown')
    return translateMessage({
      defaultMessage: 'Fix this interactive sheet. It can’t be shown.',
      id: 'LcfPjmY4X7',
    });
  if (why === 'tooMuchData')
    return translateMessage({
      defaultMessage: 'Fix this interactive sheet. It has too much data.',
      id: 'bLQwFxbtpn',
    });
  return null;
}
export const importMessages = {
  addRows: () =>
    translateMessage({
      defaultMessage: 'Add rows',
      id: 'QB0amnfU/j',
    }),
  merge: () =>
    translateMessage({
      defaultMessage: 'Merge rows',
      id: 'mb6YYOl2Ub',
    }),
  replace: () =>
    translateMessage({
      defaultMessage: 'Replace rows',
      id: 'jcX2M5CKcY',
    }),
  into: () =>
    translateMessage({
      defaultMessage: 'Into',
      id: 'S1wjiJtkLA',
    }),
  previewOfChanges: () =>
    translateMessage({
      defaultMessage: 'Preview of changes',
      id: '7TQl/d4o+C',
    }),
  change: () =>
    translateMessage({
      defaultMessage: 'Change',
      id: 'myL34/kyb3',
    }),
};
export const intoSheetLabel = (sheetName: string): string =>
  translateMessage(
    {
      defaultMessage: 'Into sheet: {sheetName}',
      id: 'sqHvAwPm2a',
    },
    {
      sheetName,
    },
  );
export const importRowChangeLabel = (change: ImportRowChange): string => {
  switch (change) {
    case 'added':
      return translateMessage({
        defaultMessage: 'New',
        id: 'beRcxrFyjU',
      });
    case 'changed':
      return translateMessage({
        defaultMessage: 'Updated',
        id: 'hV1ifnGjpV',
      });
    case 'gone':
      return translateMessage({
        defaultMessage: 'Removed',
        id: 'XJtRP08k8J',
      });
  }
};
export const importCellWasLabel = (before: string): string =>
  before === ''
    ? translateMessage({
        defaultMessage: 'Was empty',
        id: 'xrNFgOG061',
      })
    : translateMessage(
        {
          defaultMessage: 'Was {before}',
          id: '6poHQVBU3J',
        },
        {
          before,
        },
      );
export const isImportChangeless = ({ addedCount, changedCount, goneCount }: Pick<ImportIntoSheetChanges, 'addedCount' | 'changedCount' | 'goneCount'>): boolean =>
  addedCount + changedCount + goneCount === 0;
export const importRowCountWords = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, one {# row} other {{count, number} rows}}',
      id: 'Jc0XtqqN8o',
    },
    {
      count,
    },
  );
export const currentRowsWords = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, one {the # current row} other {the {count, number} current rows}}',
      id: 'AA4pRpLMU7',
    },
    {
      count,
    },
  );
export const columnsNotImportedWords = (columnNames: readonly string[], sheetName: string): string =>
  translateMessage(
    {
      defaultMessage:
        '{count, plural, one {{names} isn’t a column in {sheetName}, so it won’t be imported.} other {{names} aren’t columns in {sheetName}, so they won’t be imported.}}',
      id: '5IzfOMg148',
    },
    {
      count: columnNames.length,
      names: new Intl.ListFormat(MESSAGE_LOCALE).format(columnNames),
      sheetName,
    },
  );
export const MAX_COLUMNS_NAMED_IN_IMPORT_NOTES = 4;
export const importColumnNames = (columns: readonly ImportColumnLabel[]): string[] =>
  columns.map(
    ({ letters, name }) =>
      name ??
      translateMessage(
        {
          defaultMessage: 'column {letters}',
          id: '2/57AGYjYs',
        },
        {
          letters,
        },
      ),
  );
export const MAX_OPTIONS_NAMED_IN_IMPORT_NOTES = 4;
export const quotedOptionLabel = (value: string): string =>
  translateMessage(
    {
      defaultMessage: '“{value}”',
      id: 'd1bsfuzx+j',
    },
    {
      value,
    },
  );
export const checkedStateWords = (isChecked: boolean): string =>
  translateMessage(
    {
      defaultMessage: '{isChecked, select, true {Checked} other {Not checked}}',
      id: 'mjCtbKVuni',
    },
    {
      isChecked: String(isChecked),
    },
  );
export const interactiveSheetMessages = {
  interactive: () =>
    translateMessage({
      defaultMessage: 'Interactive sheet',
      id: 'cfhEhpJF/T',
    }),
  wayIn: () =>
    translateMessage({
      defaultMessage: 'Press Enter to use the interactive sheet, and Escape to leave it.',
      id: 'GrIJEcXdBC',
    }),
  bar: () =>
    translateMessage({
      defaultMessage: 'Interactive sheet tools',
      id: 'KIIscWluCD',
    }),
  reset: () =>
    translateMessage({
      defaultMessage: 'Reset',
      id: 'zQu6oc8jCp',
    }),
  saveAsDefault: () =>
    translateMessage({
      defaultMessage: 'Save as default',
      id: 'hznlpI0F/s',
    }),
  runAgain: () =>
    translateMessage({
      defaultMessage: 'Run again',
      id: '4J21ZOpvFM',
    }),
};
export const interactiveStoppedTitle = (): string =>
  translateMessage({
    defaultMessage: 'This interactive sheet was stopped',
    id: 'mg5IfZPrNF',
  });
export const interactiveNotWritableText = (): string =>
  translateMessage({
    defaultMessage: 'This control can’t change its cell. Ask Agent to fix the interactive sheet.',
    id: 'HeJ32Pn9qA',
  });
export const interactiveWritesTooLargeText = (): string =>
  translateMessage({
    defaultMessage: 'Nothing was saved, because this interactive sheet changes too much data. You can ask Agent to fix it.',
    id: 'tQzhEyo3h+',
  });
export const interactiveNotDuplicatedText = (why: InteractiveNotDuplicatedWhy): string =>
  why === 'interactiveNotCopied'
    ? translateMessage({
        defaultMessage: 'Nothing was duplicated, because that interactive sheet couldn’t be copied. Try again.',
        id: '+UxE9FqS0t',
      })
    : translateMessage({
        defaultMessage: 'Nothing was duplicated, because that interactive sheet can’t be copied. You can ask Agent to make a new one.',
        id: '5ORD0glPds',
      });
export const interactiveDoneText = ({ what }: { what: 'interactiveReset' | 'interactiveDefaultsSaved' }): string =>
  what === 'interactiveReset'
    ? translateMessage({
        defaultMessage: 'Interactive sheet reset',
        id: 'aA2jRCp7YB',
      })
    : translateMessage({
        defaultMessage: 'Saved as default',
        id: 't46TGIzzNq',
      });
