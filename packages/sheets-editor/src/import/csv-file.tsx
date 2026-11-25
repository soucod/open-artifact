import * as React from 'react';
import { sanitizeCellText } from '../model/cell-text.ts';
import { translateMessage } from '../i18n/messages.ts';
import { sheetMessages } from '../i18n/sheet-messages.ts';
import { defaultSheetName } from '../i18n/sheet-names.ts';
import { columnLetters } from '../model/a1-references.ts';
import type { AgentOfImport, ImportFile, ImportReadingWords } from '../state/initial-state.ts';
import type { FileToImportNotRead, FileToImportRead, ImportReading } from '../state/event-reducer.ts';
/** The signs a text file's values may be separated by. */
export type ImportDelimiter = ',' | ';' | '\t';
/** A file to read for import, or why none can be read. */
export type FileOrWhyNotRead = File | FileToImportNotRead['why'];
/** A kind of file the person may choose to import. */
export interface ImportFileChoice {
  /** For the file input's `accept`. */
  accept: string;
  inMenu: () => string;
}
export interface ImportFilePickerOptions {
  mostBytes: number;
  dispatch: (event: FileToImportRead | FileToImportNotRead) => void;
}
/** Names joined in a list, and how many more there are beyond them. */
export interface NamesListedWithMore {
  names: string;
  moreCount: number;
}
/** A text of the file with the row it would be on. */
export interface ImportTextOnRow {
  rowNumber: number;
  text: string;
}
export function decodeTextFileBytes(bytes: Uint8Array) {
  let [firstByte, secondByte] = bytes;
  if (firstByte === 255 && secondByte === 254) return new TextDecoder('utf-16le').decode(bytes);
  if (firstByte === 254 && secondByte === 255) return new TextDecoder('utf-16be').decode(bytes);
  try {
    return new TextDecoder('utf-8', {
      fatal: true,
    }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}
export function readTextFileBytes(bytes: Uint8Array) {
  let text = decodeTextFileBytes(bytes);
  return text.includes('\x00') ? null : text;
}
export function countFirstLineDelimiters(text: string) {
  let counts: Record<ImportDelimiter, number> = {
    ',': 0,
    ';': 0,
    '\t': 0,
  };
  let isInQuotes = false;
  let isAtValueStart = true;
  for (let index = 0; index < text.length; index += 1) {
    let char = text[index];
    if (isInQuotes) {
      if (char !== '"') continue;
      if (text[index + 1] === '"') index += 1;
      else isInQuotes = false;
      continue;
    }
    if (
      char ===
      `
`
    )
      break;
    isInQuotes = isAtValueStart && char === '"';
    isAtValueStart = char === ',' || char === ';' || char === '\t';
    if (char === ',' || char === ';' || char === '\t') counts[char] += 1;
  }
  return counts;
}
export function guessCsvDelimiter(text: string, filename: string): ImportDelimiter {
  if (/\.tsv$/i.test(filename)) return '\t';
  let counts = countFirstLineDelimiters(text);
  if (counts[','] >= counts[';'] && counts[','] >= counts['\t']) return ',';
  return counts[';'] >= counts['\t'] ? ';' : '\t';
}
export function parseCsvText(fileText: string, filename: string) {
  let text = fileText.replaceAll(
    /\r\n?/g,
    `
`,
  );
  let delimiter = guessCsvDelimiter(text, filename);
  if (text === '')
    return {
      delimiter,
      rows: [],
    };
  let valueEndPattern = delimiter === ',' ? /[,\n]/g : delimiter === ';' ? /[;\n]/g : /[\t\n]/g;
  let row: string[] = [];
  let rows = [row];
  let index = 0;
  for (;;) {
    let quotedPart = '';
    if (text[index] === '"') {
      index += 1;
      for (;;) {
        let closingQuote = text.indexOf('"', index);
        if (closingQuote === -1) {
          quotedPart += text.slice(index);
          index = text.length;
          break;
        }
        quotedPart += text.slice(index, closingQuote);
        index = closingQuote + 1;
        if (text[index] !== '"') break;
        quotedPart += '"';
        index += 1;
      }
    }
    valueEndPattern.lastIndex = index;
    let valueEnd = valueEndPattern.exec(text)?.index ?? text.length;
    row.push(sanitizeCellText(quotedPart + text.slice(index, valueEnd)));
    index = valueEnd;
    if (index >= text.length)
      return {
        delimiter,
        rows,
      };
    let isLineEnd =
      text[index] ===
      `
`;
    index += 1;
    if (!isLineEnd) continue;
    if (index >= text.length)
      return {
        delimiter,
        rows,
      };
    rows.push((row = []));
  }
}
export function describeFileLines({ lines, delimiter, columnCount }: ImportFile) {
  let lineCount = lines.length;
  if (columnCount <= 1)
    return translateMessage(
      {
        defaultMessage: '{lineCount, plural, one {# line} other {{lineCount, number} lines}}',
        id: 'gLDfl7D9Qh',
      },
      {
        lineCount,
      },
    );
  switch (delimiter) {
    case ',':
      return translateMessage(
        {
          defaultMessage: '{lineCount, plural, one {# line} other {{lineCount, number} lines}}, values separated by commas',
          id: '7A+Wu0DyA8',
        },
        {
          lineCount,
        },
      );
    case ';':
      return translateMessage(
        {
          defaultMessage: '{lineCount, plural, one {# line} other {{lineCount, number} lines}}, values separated by semicolons',
          id: 'vwtc/PQ/TI',
        },
        {
          lineCount,
        },
      );
    case '\t':
      return translateMessage(
        {
          defaultMessage: '{lineCount, plural, one {# line} other {{lineCount, number} lines}}, values separated by tabs',
          id: 'msfBzG5e1P',
        },
        {
          lineCount,
        },
      );
  }
}
export function columnReadingKindLabel(kind: ImportReading['kind']) {
  switch (kind) {
    case 'text':
      return translateMessage({
        defaultMessage: 'Plain text',
        id: '4fGtqT6+/R',
      });
    case 'number':
      return translateMessage({
        defaultMessage: 'Number',
        id: '3h0KepfPJc',
      });
    case 'currency':
      return translateMessage({
        defaultMessage: 'Currency',
        id: '6XD7sx4r2A',
      });
    case 'percent':
      return translateMessage({
        defaultMessage: 'Percent',
        id: 'jk7E6ihuJK',
      });
    case 'date':
      return translateMessage({
        defaultMessage: 'Date',
        id: 'YYS6f4WrGd',
      });
    case 'dateAndTime':
      return translateMessage({
        defaultMessage: 'Date and time',
        id: 'uaD8agzIY4',
      });
    case 'timeOfDay':
      return translateMessage({
        defaultMessage: 'Time',
        id: 'd2YWtAz/+m',
      });
    case 'trueOrFalse':
      return translateMessage({
        defaultMessage: 'True/false',
        id: 'QpjnY7RzX4',
      });
    case 'dropdown':
      return translateMessage({
        defaultMessage: 'Dropdown',
        id: 'XFASyapWGP',
      });
  }
}
export function columnReadingLabel(reading: ImportReading, optionCount: number | null) {
  if (reading.kind === 'currency')
    return translateMessage(
      {
        defaultMessage: 'Currency ({symbol})',
        id: 'fi50quZ6Id',
      },
      {
        symbol: reading.symbol,
      },
    );
  if (reading.kind === 'dropdown')
    return translateMessage(
      {
        defaultMessage: '{optionCount, plural, one {Dropdown (# option)} other {Dropdown (# options)}}',
        id: 'r+N49L9Ffq',
      },
      {
        optionCount: optionCount ?? 0,
      },
    );
  return columnReadingKindLabel(reading.kind);
}
export async function readFileToImport(file: File, mostBytes: number): Promise<FileToImportRead | FileToImportNotRead> {
  if (file.size > mostBytes)
    return {
      kind: 'fileToImportNotRead',
      why: 'tooLarge',
    };
  try {
    let text = readTextFileBytes(new Uint8Array(await file.arrayBuffer()));
    if (text === null)
      return {
        kind: 'fileToImportNotRead',
        why: 'notText',
      };
    let { delimiter, rows } = parseCsvText(text, file.name);
    let columnCount = rows.reduce((widest, row) => Math.max(widest, row.length), 0);
    return {
      kind: 'fileToImportRead',
      filename: file.name,
      delimiter,
      rows,
      words: importReadingWords(columnCount),
    };
  } catch {
    return {
      kind: 'fileToImportNotRead',
      why: 'notRead',
    };
  }
}
export function useImportFilePicker({ mostBytes, dispatch }: ImportFilePickerOptions) {
  let inputRef = React.useRef<HTMLInputElement>(null);
  let choose = React.useCallback((choices: ImportFileChoice[]) => {
    let inputElement = inputRef.current;
    if (inputElement === null) return;
    inputElement.accept = choices.map(({ accept }) => accept).join(',');
    inputElement.click();
  }, []);
  let readCountRef = React.useRef(0);
  let readFile = React.useCallback(
    async (fileOrWhy: FileOrWhyNotRead): Promise<void> => {
      readCountRef.current += 1;
      let readCount = readCountRef.current;
      let fileRead: FileToImportRead | FileToImportNotRead =
        fileOrWhy instanceof File
          ? await readFileToImport(fileOrWhy, mostBytes)
          : {
              kind: 'fileToImportNotRead',
              why: fileOrWhy,
            };
      if (readCount === readCountRef.current && inputRef.current !== null) dispatch(fileRead);
    },
    [mostBytes, dispatch],
  );
  let takeDropped = React.useCallback((fileOrWhy: FileOrWhyNotRead) => void readFile(fileOrWhy), [readFile]);
  let forget = React.useCallback(() => void (readCountRef.current += 1), []);
  let onInputChange = ({ target }: React.ChangeEvent<HTMLInputElement>) => {
    let file = target.files?.[0];
    target.value = '';
    if (file !== undefined) readFile(file);
  };
  return {
    choose,
    takeDropped,
    forget,
    input: <input ref={inputRef} type="file" hidden aria-label={sheetMessages.importFile()} onChange={onInputChange} />,
  };
}
export const csvFileMessages = {
  whatComesHere: () =>
    translateMessage({
      defaultMessage: 'Your file’s rows and columns will appear here',
      id: '4UA8p1JZM2',
    }),
  whatToChoose: () =>
    translateMessage({
      defaultMessage: 'Choose a .csv or .tsv file, or drop one here.',
      id: 'aQCgPHevr/',
    }),
  noRoom: () =>
    translateMessage({
      defaultMessage: 'This Sheet doesn’t have room for that much data.',
      id: 's1srid6yoj',
    }),
  smallerFile: () =>
    translateMessage({
      defaultMessage: 'Import a smaller file.',
      id: 's/Oc04oyD4',
    }),
  tooLarge: () =>
    translateMessage({
      defaultMessage: 'That file is too large to import.',
      id: 'n/ozerkR+Z',
    }),
  notRead: () =>
    translateMessage({
      defaultMessage: 'That file couldn’t be read.',
      id: '8rwPDINNdj',
    }),
  tryAgain: () =>
    translateMessage({
      defaultMessage: 'Try importing it again.',
      id: 'EHzsjIvmTx',
    }),
  isFolder: () =>
    translateMessage({
      defaultMessage: 'That’s a folder.',
      id: '69nqewpEkT',
    }),
  chooseCsvOrTsv: () =>
    translateMessage({
      defaultMessage: 'Choose a .csv or .tsv file.',
      id: 'J5iJrMaJzc',
    }),
  notCsv: () =>
    translateMessage({
      defaultMessage: 'That file isn’t a CSV or TSV file.',
      id: 'DW9Rkvunfz',
    }),
  saveAsCsv: () =>
    translateMessage({
      defaultMessage: 'Save it as a CSV file, then import it.',
      id: 'A5U52TLQvW',
    }),
  excelNotDropped: () =>
    translateMessage({
      defaultMessage: 'Excel files can’t be dropped here.',
      id: 'rIXwegh7dm',
    }),
  useButtonInstead: (button: string) =>
    translateMessage(
      {
        defaultMessage: 'Use “{button}” instead.',
        id: '4Q65pTJgJo',
      },
      { button },
    ),
  isEmpty: () =>
    translateMessage({
      defaultMessage: 'That file is empty.',
      id: 'N3QpdNpiki',
    }),
  cellTooLong: () =>
    translateMessage({
      defaultMessage: 'One of the cells in that file has too much text.',
      id: 'LTH8kmFXl0',
    }),
  shortenText: () =>
    translateMessage({
      defaultMessage: 'Shorten that text, then import the file again.',
      id: 'JqtwwLQxMP',
    }),
  letGo: () =>
    translateMessage({
      defaultMessage: 'Release to import',
      id: 'ZoWjP4JG5p',
    }),
};
export const importReviewMessages = {
  titleWithNoFile: () =>
    translateMessage({
      defaultMessage: 'Import CSV',
      id: 'jAyS/we/5h',
    }),
  import: () =>
    translateMessage({
      defaultMessage: 'Import',
      id: 'dsPkusPVZA',
    }),
  discardAsked: () =>
    translateMessage({
      defaultMessage: 'Discard this import?',
      id: 'eO8pVFG91t',
    }),
  whatDiscardCosts: () =>
    translateMessage({
      defaultMessage: 'The file won’t be imported, and your changes will be lost.',
      id: 'P1qbgbCCFX',
    }),
  keepEditing: () =>
    translateMessage({
      defaultMessage: 'Keep editing',
      id: 'PQLASE6bZs',
    }),
  discard: () =>
    translateMessage({
      defaultMessage: 'Discard',
      id: '9TsTuYrIS+',
    }),
  agentChangesThePlan: () =>
    translateMessage({
      defaultMessage: 'Agent is making that change…',
      id: 'H+xz6/GAgD',
    }),
  firstPlanFailed: () =>
    translateMessage({
      defaultMessage: 'Couldn’t finish setting up the columns.',
      id: 'SHqLhebees',
    }),
  settingsLeftToCheck: (count: number) =>
    translateMessage(
      {
        defaultMessage: '{count, plural, one {# setting uses a recommended choice.} other {# settings use a recommended choice.}}',
        id: 'wcGqcO/8Ua',
      },
      {
        count,
      },
    ),
  previewNotShown: () =>
    translateMessage({
      defaultMessage: 'Couldn’t show the preview.',
      id: 'XXlpz4ewE+',
    }),
  wishFailed: () =>
    translateMessage({
      defaultMessage: 'That change wasn’t made.',
      id: 'vIgMWuJ0NG',
    }),
  wishChangedNothing: () =>
    translateMessage({
      defaultMessage: 'Nothing changed.',
      id: 'X+IYDnyql4',
    }),
  wishMetWhatTheySet: ({ names, moreCount }: NamesListedWithMore) =>
    translateMessage(
      {
        defaultMessage:
          '{moreCount, plural, =0 {Nothing changed. Your own settings were kept: {names}.} one {Nothing changed. Your own settings were kept: {names} and {moreCount, number} more.} other {Nothing changed. Your own settings were kept: {names} and {moreCount, number} more.}}',
        id: '0FNbt/AnZ+',
      },
      {
        names,
        moreCount,
      },
    ),
  theirSettingsWereKept: ({ names, moreCount }: NamesListedWithMore) =>
    translateMessage(
      {
        defaultMessage:
          '{moreCount, plural, =0 {Your own settings were kept: {names}.} one {Your own settings were kept: {names} and {moreCount, number} more.} other {Your own settings were kept: {names} and {moreCount, number} more.}}',
        id: 'yXQCp96hka',
      },
      {
        names,
        moreCount,
      },
    ),
  tooMuchForAgent: () =>
    translateMessage({
      defaultMessage: 'There’s too much in this file for Agent to read.',
      id: '6I1UdzKYT2',
    }),
  agentIsNotAvailable: () =>
    translateMessage({
      defaultMessage: 'Agent isn’t available for this import.',
      id: 'DNFr2xTI7B',
    }),
  tryAgain: () =>
    translateMessage({
      defaultMessage: 'Try again',
      id: '1tK6aBfhuZ',
    }),
  wish: () =>
    translateMessage({
      defaultMessage: 'Ask Agent to change something',
      id: '1m8MH46q1A',
    }),
  sendWish: () =>
    translateMessage({
      defaultMessage: 'Send',
      id: 'FaeOrbIlG1',
    }),
  recommended: () =>
    translateMessage({
      defaultMessage: 'Recommended',
      id: '2SXG9/bBAE',
    }),
  answerStands: () =>
    translateMessage({
      defaultMessage:
        'Part of your request went against a choice you made in the settings above, so that part wasn’t done. You can change that setting.',
      id: 'XlXsuYydZU',
    }),
  stop: () =>
    translateMessage({
      defaultMessage: 'Stop',
      id: '5QWxhppQ2g',
    }),
  stopped: () =>
    translateMessage({
      defaultMessage: 'Agent was stopped.',
      id: 'vS/ybWBj6w',
    }),
  settingsTab: () =>
    translateMessage({
      defaultMessage: 'Settings',
      id: 'xjJOq979Vd',
    }),
  previewTab: () =>
    translateMessage({
      defaultMessage: 'Preview',
      id: 'i3KijCJL4w',
    }),
  settingsOrPreview: () =>
    translateMessage({
      defaultMessage: 'Settings or preview',
      id: 'dvZZP7OBnH',
    }),
};
export const joinImportWordsWithMiddleDots = ([first = '', ...rest]: string[]) =>
  rest.reduce(
    (before, after) =>
      translateMessage(
        {
          defaultMessage: '{before} · {after}',
          id: 'UY7IKnkwlQ',
        },
        {
          before,
          after,
        },
      ),
    first,
  );
export const importProgressMessages = {
  tableSought: () =>
    translateMessage({
      defaultMessage: 'Finding where the table starts and ends…',
      id: 'NQTScCzssp',
    }),
  columnsBeingRead: () =>
    translateMessage({
      defaultMessage: 'Working out what each column holds…',
      id: '6yD6y95nkw',
    }),
  placeSought: () =>
    translateMessage({
      defaultMessage: 'Working out where this belongs…',
      id: '7ByC7qYwOM',
    }),
};
export const agentUnavailableForImportWords = (why: Extract<AgentOfImport, { kind: 'isNotToBeHad' }>['why']) =>
  why === 'tooMuchToTell' ? importReviewMessages.tooMuchForAgent() : importReviewMessages.agentIsNotAvailable();
export const agentReasonWords = (reason: string) =>
  translateMessage(
    {
      defaultMessage: 'Agent: {reason}',
      id: '1PmSgiBvyN',
    },
    {
      reason,
    },
  );
export const moreImportColumnsWords = (columnCount: number) =>
  translateMessage(
    {
      defaultMessage: '{columnCount, plural, one {# more column} other {{columnCount, number} more columns}}',
      id: '9xvlZZ7sjy',
    },
    {
      columnCount,
    },
  );
export const joinImportWordsWithCommas = ([first = '', ...rest]: string[]) =>
  rest.reduce(
    (before, after) =>
      translateMessage(
        {
          defaultMessage: '{before}, {after}',
          id: '8ho6/PHE2C',
        },
        {
          before,
          after,
        },
      ),
    first,
  );
export const cellsStayTextWords = (cellCount: number) =>
  translateMessage(
    {
      defaultMessage: '{cellCount, plural, one {# cell stays text} other {{cellCount, number} cells stay text}}',
      id: 'MAnzUqo5rX',
    },
    {
      cellCount,
    },
  );
export const cellsFitFormatWords = (fitting: number, filled: number, format: string) =>
  translateMessage(
    {
      defaultMessage: '{fitting, number} of {filled, number} cells fit {format}',
      id: 'ZfjsTH5d6q',
    },
    {
      fitting,
      filled,
      format,
    },
  );
export const importRowLabel = (row: number) =>
  translateMessage(
    {
      defaultMessage: 'Row {row, number, ::group-off}',
      id: 'x6bAwmUIus',
    },
    {
      row,
    },
  );
export const andMoreWords = (count: number) =>
  translateMessage(
    {
      defaultMessage: '{count, plural, one {and # more} other {and # more}}',
      id: 'SY7ACKRLYd',
    },
    {
      count,
    },
  );
export const importLinesWithRowLabels = (lines: ImportTextOnRow[], lineCount: number) => ({
  lines: lines.map(
    ({ rowNumber, text }) => ({
      row: importRowLabel(rowNumber),
      text,
    }),
  ),
  more: lineCount > lines.length ? andMoreWords(lineCount - lines.length) : null,
});
export const textStaysTextWords = (text: string) =>
  translateMessage(
    {
      defaultMessage: '{text} stays text',
      id: 'Bv65pHf8y+',
    },
    {
      text,
    },
  );
export const textBecomesWords = (text: string, becomes: string) =>
  translateMessage(
    {
      defaultMessage: '“{text}” becomes “{becomes}”',
      id: 'JW6F1kbp2k',
    },
    {
      text,
      becomes,
    },
  );
export const columnNameAndKindLabel = (name: string, kind: string) =>
  translateMessage(
    {
      defaultMessage: '{name}: {kind}',
      id: 'HjTQnLHCo3',
    },
    {
      name,
      kind,
    },
  );
export const formatOfColumnLabel = (name: string) =>
  translateMessage(
    {
      defaultMessage: 'Format of {name}',
      id: 'VVm4zHHrYb',
    },
    {
      name,
    },
  );
export const nameOfColumnLabel = (name: string) =>
  translateMessage(
    {
      defaultMessage: 'Name of column {name}',
      id: 'YCRkLgYt6V',
    },
    {
      name,
    },
  );
export const lineOfFileLabel = (line: number) =>
  translateMessage(
    {
      defaultMessage: 'Line {line, number, ::group-off} of the file',
      id: 'SGPfa3sFJH',
    },
    {
      line,
    },
  );
export const rowAndLineOfFileLabel = (row: number, line: number) =>
  translateMessage(
    {
      defaultMessage: 'Row {row, number, ::group-off}, line {line, number, ::group-off} of the file',
      id: 'HnQ7ndn5wr',
    },
    {
      row,
      line,
    },
  );
export const importColumnMessages = {
  leftOut: () =>
    translateMessage({
      defaultMessage: 'Left out',
      id: '+IfFpDQIc+',
    }),
  dayFirst: () =>
    translateMessage({
      defaultMessage: 'Day first',
      id: 'OLq56A6rcq',
    }),
  monthFirst: () =>
    translateMessage({
      defaultMessage: 'Month first',
      id: 'j0Rbz9wIxU',
    }),
  yearFirst: () =>
    translateMessage({
      defaultMessage: 'Year first',
      id: 'QXBxnETrn6',
    }),
  rename: () =>
    translateMessage({
      defaultMessage: 'Rename',
      id: '32wVv+rgPp',
    }),
  leaveColumnOut: () =>
    translateMessage({
      defaultMessage: 'Leave this column out',
      id: '8rLQOxLfQk',
    }),
  bringColumnBack: () =>
    translateMessage({
      defaultMessage: 'Bring this column back',
      id: 'JGbwtXufp0',
    }),
  asHeadings: () =>
    translateMessage({
      defaultMessage: 'Use as headings',
      id: 'ZruBrGyewX',
    }),
  notHeadings: () =>
    translateMessage({
      defaultMessage: 'These aren’t headings',
      id: 'eaeihfbRvX',
    }),
  leaveRowOut: () =>
    translateMessage({
      defaultMessage: 'Leave this row out',
      id: 'IRGIlp0M0o',
    }),
};
export const kindWithNoteLabel = (kind: string, note: string) =>
  translateMessage(
    {
      defaultMessage: '{kind}, {note}',
      id: 'Wv35naZ4So',
    },
    {
      kind,
      note,
    },
  );
export const joinImportWordsWithSemicolons = ([first = '', ...rest]: string[]) =>
  rest.reduce(
    (before, after) =>
      translateMessage(
        {
          defaultMessage: '{before}; {after}',
          id: 's9gKdulFa6',
        },
        {
          before,
          after,
        },
      ),
    first,
  );
export const columnReadingWithNoteLabel = (reading: ImportReading, optionCount: number | null, cellsStayingText: number) =>
  cellsStayingText > 0
    ? kindWithNoteLabel(columnReadingLabel(reading, optionCount), cellsStayTextWords(cellsStayingText))
    : columnReadingLabel(reading, optionCount);
export const importReadingWords = (columnCount: number): ImportReadingWords => ({
  stemOfNewSheetNames: defaultSheetName(),
  names: {
    sheet: defaultSheetName(),
    columns: Array.from(
      {
        length: columnCount,
      },
      (_, columnIndex) =>
        translateMessage(
          {
            defaultMessage: 'Column {letters}',
            id: 'ZiTxtTmGTU',
          },
          {
            letters: columnLetters(columnIndex),
          },
        ),
    ),
  },
  dateOrder: {
    ask: translateMessage({
      defaultMessage: 'Which comes first in these dates, the month or the day?',
      id: 'kYNUcSTdul',
    }),
    monthFirst: translateMessage({
      defaultMessage: 'Month first',
      id: '8GnAK8JteY',
    }),
    dayFirst: translateMessage({
      defaultMessage: 'Day first',
      id: 'ulE9LmIK2z',
    }),
  },
  decimalSign: {
    ask: translateMessage({
      defaultMessage: 'Which marks decimals in these numbers, the comma or the period?',
      id: 'js5ZIGLXac',
    }),
    comma: translateMessage({
      defaultMessage: 'Comma',
      id: '/alnrLbAqf',
    }),
    point: translateMessage({
      defaultMessage: 'Period',
      id: 'Gw3d5qBJbM',
    }),
  },
});
export const importFileChoices: ImportFileChoice[] = [
  {
    accept: '.csv,.tsv,text/csv,text/tab-separated-values',
    inMenu: sheetMessages.importCsv,
  },
];
