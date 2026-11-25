import { cleanSheetName } from '../state/sheet-tabs.ts';
import { sanitizeCellText } from '../model/cell-text.ts';
import { unescapeLoneCellText, unescapeFirstCsvCellText, unescapeCsvCellText } from '../clipboard/text-escaping.ts';
import { filledCellCountOfLine } from './file-profile.ts';
import { withNoEffects } from '../state/transitions.ts';
import { closeImportOfAFile } from './bring-in.ts';
import { awaitFileAgain } from './file-awaited.ts';
import { startImportOfAFile } from './import-flow.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { EditRefusedOnPage, PageState } from '../state/initial-state.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { FileToImportRead, PageEvent } from '../state/event-reducer.ts';
export function sheetNameOfFileName(fileName: string) {
  let stem = cleanSheetName(sanitizeCellText(fileName.replace(/\.[^.]*$/, '')));
  return stem === '' ? cleanSheetName(sanitizeCellText(fileName)) : stem;
}
export function unescapedImportLines(rows: string[][], isCsv: boolean): string[][] {
  let lines =
    unescapedLinesCache.get(rows) ??
    rows.map(
      (row, rowIndex) =>
        row.map(
          (text, columnIndex) =>
            !isCsv ? unescapeLoneCellText(text) : rowIndex === 0 && columnIndex === 0 ? unescapeFirstCsvCellText(text) : unescapeCsvCellText(text),
        ),
    );
  unescapedLinesCache.set(rows, lines);
  return lines;
}
export function importReadFile(
  state: PageState,
  workbook: WorkbookReads,
  { filename, delimiter, rows, words }: Pick<FileToImportRead, 'filename' | 'delimiter' | 'rows' | 'words'>,
): PageTransition {
  let lines = unescapedImportLines(rows, delimiter === ',');
  let columnCount = lines.reduce((widest, line) => Math.max(widest, filledCellCountOfLine(line)), 0);
  if (columnCount === 0)
    return withNoEffects({
      ...state,
      notice: {
        kind: 'fileNotImported',
        why: 'empty',
      },
    });
  let longTexts = lines.flatMap(
    (line) => line.filter((text) => text.length > LONG_IMPORTED_TEXT_LENGTH),
  );
  let [fit] =
    longTexts.length > 0
      ? (workbook.fitOfColumnReadings(
          [
            {
              kind: 'text',
            },
          ],
          longTexts,
        ) ?? [])
      : [];
  if (fit !== undefined && fit.notFitting > 0)
    return withNoEffects({
      ...state,
      notice: {
        kind: 'editRefused',
        why: 'textTooLong',
        asked: 'import',
      },
    });
  let filledCount = 0;
  for (let line of lines) for (let text of line) if (text.trim() !== '') filledCount += 1;
  if (filledCount > workbook.mostFilledCells()) {
    let refusal: EditRefusedOnPage = {
      kind: 'editRefused',
      why: 'noRoomInWorkbook',
      asked: 'import',
    };
    let closed = closeImportOfAFile(state);
    return {
      ...closed,
      state: awaitFileAgain(closed.state, state.fileAwaited, refusal),
    };
  }
  let nameStem = sheetNameOfFileName(filename);
  let sheetName = nameStem === '' ? words.names.sheet : nameStem;
  let file = {
    fileName: filename,
    delimiter,
    lines,
    columnCount,
  };
  let wordsWithName = {
    ...words,
    names: {
      ...words.names,
      sheet: sheetName,
    },
  };
  return startImportOfAFile(state, workbook, file, wordsWithName);
}
export const EVENTS_BEFORE_FILE_IMPORT: PageEvent[] = [
  {
    kind: 'sheetNameLeft',
  },
  {
    kind: 'sheetListOpened',
  },
];
export const LONG_IMPORTED_TEXT_LENGTH = 1e4;
export const unescapedLinesCache = new WeakMap<string[][], string[][]>();
