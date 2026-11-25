import type { ColumnReading, DateOrder, DecimalSign, FitOfAColumnReading } from '@open-artifact/sheets-core';
import { isUnknownCurrencyCode, importColumnTexts, dataLineNumbers, trueOrFalseFit, decimalSignOfReading } from './column-readings.ts';
import type { ImportLineChoice } from './column-readings.ts';
import { truncateToCleanText } from './import-basics.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { ImportFile } from '../state/initial-state.ts';
import type { ImportReading } from '../state/event-reducer.ts';
/** A text of a column, trimmed, and how many cells hold it. */
export interface DifferentText {
  text: string;
  count: number;
}
/** A column of a file as the engine reads it: its texts and how well each reading fits them. */
export interface ImportColumnProfile {
  texts: string[];
  /** Most common first. */
  different: DifferentText[];
  readings: ColumnReading[];
  /** By reading. */
  fits: FitOfAColumnReading[];
}
/** A file read column by column, over the lines a choice of headings and lines left out leaves. */
export interface ImportFileProfile extends ImportLineChoice {
  records: number[];
  columns: ImportColumnProfile[];
}
/** Cells that do not fit readings that fit most of a column. */
export interface CellsThatDoNotFit {
  /** The readings they do not fit, described. */
  under: string[];
  cells: string[];
}
export function currencySymbolOfText(text: string) {
  let match = LEADING_CURRENCY_PATTERN.exec(text) ?? TRAILING_CURRENCY_PATTERN.exec(text);
  let symbol = match?.[1] ?? match?.[2] ?? null;
  return symbol === null || isUnknownCurrencyCode(symbol) ? null : symbol;
}
export function currencyReadingsOf(differentTexts: DifferentText[]): ColumnReading[] {
  let countsBySymbol = new Map<string, number>();
  for (let { text, count } of differentTexts) {
    let symbol = currencySymbolOfText(text);
    if (symbol !== null) countsBySymbol.set(symbol, (countsBySymbol.get(symbol) ?? 0) + count);
  }
  let [[mostCommonSymbol] = []] = [...countsBySymbol].toSorted(([, countA], [, countB]) => countB - countA);
  if (mostCommonSymbol === undefined) return [];
  return READING_DECIMAL_SIGNS.map(
    (decimalSign) => ({
      kind: 'currency',
      decimalSign,
      decimalPlaces: 2,
      symbol: mostCommonSymbol,
    }),
  );
}
export function countDifferentTexts(texts: string[]): DifferentText[] {
  let counts = new Map<string, number>();
  for (let text of texts) {
    let trimmed = text.trim();
    if (trimmed !== '') counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
  }
  let different = [...counts].map(
    ([text, count]) => ({
      text,
      count,
    }),
  );
  different.sort((text, otherText) => otherText.count - text.count);
  return different;
}
export function filledCellCountOfLine(cells: string[]) {
  let length = cells.length;
  while (length > 0 && !isFilledText(cells[length - 1] ?? '')) length--;
  return length;
}
export function guessHeaderLine(file: Pick<ImportFile, 'lines'>) {
  let lineCountByLength = new Map<number, number>();
  for (let line of file.lines) {
    let count = filledCellCountOfLine(line);
    if (count > 0) lineCountByLength.set(count, (lineCountByLength.get(count) ?? 0) + 1);
  }
  let usualLength = 0;
  for (let [lineLength, count] of lineCountByLength) {
    let usualCount = lineCountByLength.get(usualLength) ?? 0;
    if (count > usualCount || (count === usualCount && lineLength > usualLength)) usualLength = lineLength;
  }
  let headerIndex = file.lines.findIndex((line) => line.filter(isFilledText).length * 2 > usualLength);
  return headerIndex < 0 ? 1 : headerIndex + 1;
}
export function profileImportColumn(
  file: Pick<ImportFile, 'lines'>,
  records: number[],
  columnIndex: number,
  core: Pick<WorkbookReads, 'fitOfColumnReadings'>,
): ImportColumnProfile {
  let texts = importColumnTexts(file, records, columnIndex);
  let different = countDifferentTexts(texts);
  let readings = [...BASIC_COLUMN_READINGS, ...currencyReadingsOf(different)];
  return {
    texts,
    different,
    readings,
    fits: core.fitOfColumnReadings(readings, texts) ?? [],
  };
}
export function profileImportFile(
  file: ImportFile,
  core: Pick<WorkbookReads, 'fitOfColumnReadings'>,
  lineChoice: ImportLineChoice = {
    headerLine: guessHeaderLine(file),
    linesLeftOut: [],
  },
): ImportFileProfile {
  let records = dataLineNumbers(file, lineChoice);
  return {
    ...lineChoice,
    records,
    columns: Array.from(
      {
        length: file.columnCount,
      },
      (_, columnIndex) => profileImportColumn(file, records, columnIndex, core),
    ),
  };
}
export function profileLineNumbers(file: Pick<ImportFile, 'lines'>) {
  let lineCount = file.lines.length;
  let headerLine = guessHeaderLine(file);
  return Array.from(
    {
      length: lineCount,
    },
    (_, index) => index + 1,
  ).filter(
    (line) =>
      line <= PROFILE_FIRST_LINES || line > lineCount - PROFILE_LAST_LINES || (line >= headerLine && line <= headerLine + PROFILE_LINES_AFTER_HEADER),
  );
}
export function shortenProfileCell(text: string) {
  let shortened = truncateToCleanText(text, PROFILE_CELL_MAX_LENGTH);
  return shortened === truncateToCleanText(text, text.length) ? shortened : `${shortened}${IMPORT_ELLIPSIS}`;
}
export function cellsThatDoNotFit(
  { texts, different, readings, fits }: ImportColumnProfile,
  fitAsTrueOrFalse: FitOfAColumnReading,
  core: Pick<WorkbookReads, 'fitOfColumnReadings'>,
): CellsThatDoNotFit[] {
  let areFitsWhole = fits.every((fit) => !isMostlyFitting(fit) || fit.firstNotFitting.length === fit.notFitting);
  let differentTexts = different.map(({ text }) => text);
  let textsToRead = areFitsWhole ? texts : differentTexts;
  let fitsToUse = areFitsWhole ? fits : (core.fitOfColumnReadings([...readings], textsToRead) ?? []);
  let groups = new Map<string, CellsThatDoNotFit>();
  let addGroup = (reading: ImportReading, indexes: number[], textsOfFit: string[]) => {
    let cells = [...new Set(indexes.map((index) => (textsOfFit[index] ?? '').trim()))]
      .map(shortenProfileCell)
      .filter((cell) => cell !== '');
    if (cells.length === 0) return;
    let group = groups.get(JSON.stringify(cells));
    if (group === undefined)
      groups.set(JSON.stringify(cells), {
        under: [describeReadingWithSymbol(reading)],
        cells,
      });
    else group.under.push(describeReadingWithSymbol(reading));
  };
  fits.forEach((fit, index) => {
    let reading = readings[index];
    if (reading !== undefined && isMostlyFitting(fit)) addGroup(reading, fitsToUse[index]?.firstNotFitting ?? [], textsToRead);
  });
  if (isMostlyFitting(fitAsTrueOrFalse))
    addGroup(
      {
        kind: 'trueOrFalse',
      },
      trueOrFalseFit(differentTexts).firstNotFitting,
      differentTexts,
    );
  return [...groups.values()];
}
export function fileProfileForAgent(file: ImportFile, profile: ImportFileProfile, core: Pick<WorkbookReads, 'fitOfColumnReadings'>) {
  let headerLine = profile.headerLine ?? 0;
  let budget = DO_NOT_FIT_BUDGET;
  return {
    fileName: shortenWithEllipsis(file.fileName, 80),
    lines: file.lines.length,
    columns: file.columnCount,
    countsAreOverTheLinesAfter: headerLine,
    someLines: profileLineNumbers(file).map(
      (line) => ({
        line,
        cells: (file.lines[line - 1] ?? []).map((cell) => shortenWithEllipsis(cell, 40)),
      }),
    ),
    profileOfEachColumn: profile.columns.map((columnProfile, columnIndex) => {
      let { texts, different, readings, fits } = columnProfile;
      let filled = different.reduce((sum, { count }) => sum + count, 0);
      let fitsByLabel: Record<string, string> = {};
      let noteFit = (reading: ImportReading | undefined, fit: FitOfAColumnReading) => {
        if (reading === undefined || fit.fitting === 0) return;
        fitsByLabel[describeReadingWithSymbol(reading)] = fit.notFitting === 0 ? 'all' : `${fit.fitting} of ${filled}`;
      };
      fits.forEach((fit, index) => {
        noteFit(readings[index], fit);
      });
      let fitAsTrueOrFalse = trueOrFalseFit(texts);
      noteFit(
        {
          kind: 'trueOrFalse',
        },
        fitAsTrueOrFalse,
      );
      let doNotFit = budget < 0 ? [] : cellsThatDoNotFit(columnProfile, fitAsTrueOrFalse, core);
      if (doNotFit.length > 0) budget -= JSON.stringify(doNotFit).length;
      let isDoNotFitShown = doNotFit.length > 0 && budget >= 0;
      return {
        column: columnIndex + 1,
        headerSays: shortenWithEllipsis(file.lines[headerLine - 1]?.[columnIndex] ?? '', 60),
        filled,
        blank: texts.length - filled,
        different: different.length,
        mostCommon: different.slice(0, PROFILE_MOST_COMMON_COUNT).map(
          ({ text, count }) => ({
            text: shortenWithEllipsis(text, 60),
            count,
          }),
        ),
        longest: different.reduce((longest, { text }) => Math.max(longest, text.length), 0),
        digitsThatStartWithZero: different
          .filter(({ text }) => /^0\d+$/.test(text))
          .reduce((sum, { count }) => sum + count, 0),
        fits: fitsByLabel,
        ...(isDoNotFitShown && {
          doNotFit,
        }),
      };
    }),
  };
}
export const READING_DECIMAL_SIGNS: DecimalSign[] = ['point', 'comma'];
export const READING_DATE_ORDERS: DateOrder[] = ['yearMonthDay', 'dayMonthYear', 'monthDayYear'];
export const BASIC_COLUMN_READINGS: ColumnReading[] = [
  ...READING_DECIMAL_SIGNS.map(
    (decimalSign): ColumnReading => ({
      kind: 'number',
      decimalSign,
      decimalPlaces: 0,
      groupsThousands: false,
    }),
  ),
  ...READING_DECIMAL_SIGNS.map(
    (decimalSign): ColumnReading => ({
      kind: 'percent',
      decimalSign,
      decimalPlaces: 0,
      numberAloneIs: 'percents',
    }),
  ),
  ...READING_DATE_ORDERS.map(
    (order): ColumnReading => ({
      kind: 'date',
      order,
      shownAs: 'yearMonthDay',
    }),
  ),
  ...READING_DATE_ORDERS.map(
    (order): ColumnReading => ({
      kind: 'dateAndTime',
      order,
      shownAs: 'yearMonthDay',
    }),
  ),
  {
    kind: 'timeOfDay',
  },
];
export const CURRENCY_SIGN_SOURCE = String.raw`(?:[A-Za-z]{0,3}\p{Sc})`;
export const CURRENCY_CODE_SOURCE = '[A-Z]{3}';
export const LEADING_CURRENCY_PATTERN = new RegExp(
  String.raw`^[-+(\s]*(?:(${CURRENCY_SIGN_SOURCE})\s*|(${CURRENCY_CODE_SOURCE})\s+)[-+]?[\d.,]`,
  'u',
);
export const TRAILING_CURRENCY_PATTERN = new RegExp(
  String.raw`\d[.-]?(?:\s*(${CURRENCY_SIGN_SOURCE})|\s+(${CURRENCY_CODE_SOURCE}))\s*\)?$`,
  'u',
);
export const describeReading = (reading: ImportReading) =>
  [reading.kind, decimalSignOfReading(reading), 'order' in reading ? reading.order : null]
    .filter((part) => part !== null)
    .join(' ');
export const describeReadingWithSymbol = (reading: ImportReading) =>
  'symbol' in reading ? `${describeReading(reading)} ${reading.symbol}` : describeReading(reading);
export const IMPORT_ELLIPSIS = '…';
export const shortenWithEllipsis = (text: string, maxLength: number) =>
  text.length > maxLength ? `${text.slice(0, maxLength)}${IMPORT_ELLIPSIS}` : text;
export const isFilledText = (text: string) => text.trim() !== '';
export const PROFILE_FIRST_LINES = 12;
export const PROFILE_LAST_LINES = 4;
export const PROFILE_LINES_AFTER_HEADER = 3;
export const PROFILE_MOST_COMMON_COUNT = 12;
export const PROFILE_CELL_MAX_LENGTH = 30;
export const DO_NOT_FIT_BUDGET = 2000;
export const isMostlyFitting = ({ fitting, notFitting }: Pick<FitOfAColumnReading, 'fitting' | 'notFitting'>) => notFitting > 0 && fitting > notFitting;
