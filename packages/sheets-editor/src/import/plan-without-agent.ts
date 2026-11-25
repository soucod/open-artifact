import {
  dateShownAsForOrder,
  isNumericReading,
  isSameJson,
  looksLikeTrueOrFalseColumn,
  notFittingExamples,
  losesPrecisionInAny,
  isFitTooPoor,
  decimalSignOfReading,
  importTextAt,
  planWithAnswers,
  importColumnTexts,
  readingFittingTexts,
  fitOfReading,
} from './column-readings.ts';
import { READING_DECIMAL_SIGNS, profileImportFile, profileImportColumn } from './file-profile.ts';
import { dayMonthOrderOf, NEW_SHEET_DESTINATION, MAX_BROUGHT_DOWN_DECIMAL_PLACES } from './import-basics.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { ColumnReading, DateOrder, DecimalSign } from '@open-artifact/sheets-core';
import type { ImportFile, ImportPlan, ImportQuestion, ImportReadingWords } from '../state/initial-state.ts';
import type { ImportReading } from '../state/event-reducer.ts';
import type { DifferentText, ImportColumnProfile, ImportFileProfile } from './file-profile.ts';
/** How much the texts of a column say about which decimal sign they are written with. */
export type DecimalSignEvidence = 'settles' | 'leans' | 'saysLittle';
/** How a column of a file is guessed to read, without the agent. */
export interface ImportColumnGuess {
  reading: ImportReading;
  /** Its dates read as well day first as month first. */
  isOpenBetweenDayAndMonthFirst: boolean;
  /** The same reading with the other decimal sign, when that reads the texts differently. */
  withOtherDecimalSign: ColumnReading | null;
  ofDecimalSign: DecimalSignEvidence | null;
}
/** A row of the file and the row of the sheet it would merge into, with what the sheet's cell holds. */
export interface RowHeldInSheet {
  text: string;
  held: string | number;
  line: number;
}
/** A reading tried on texts, and how it reads them. */
export interface WayOfReading {
  reading: ImportReading;
  fitting: number;
  /** Read with the workbook's own decimal sign or day and month order. */
  isTheWorkbooksOwn: boolean;
  /** Each text as a number where the reading reads one, as itself otherwise; null when the texts cannot be read. */
  read(texts: string[]): (string | number)[] | null;
}
/** A reading that parses texts into values rather than keeping them as texts. */
export type ReadingParsed = Exclude<ImportReading, { kind: 'text' | 'dropdown' | 'trueOrFalse' }>;
export function isSomeBatchOfTexts(texts: string[], isTrueOfBatch: (batch: string[]) => boolean) {
  for (let start = 0; start < texts.length; start += TEXT_CHECK_BATCH)
    if (isTrueOfBatch(texts.slice(start, start + TEXT_CHECK_BATCH))) return true;
  return false;
}
export function refineReadingForTexts(
  reading: ImportReading,
  different: DifferentText[],
  reads: Pick<WorkbookReads, 'textsUnderAColumnReading' | 'fitOfColumnReadings'>,
): ImportReading {
  if (reading.kind === 'date' || reading.kind === 'dateAndTime')
    return {
      ...reading,
      shownAs: dateShownAsForOrder(reading.order),
    };
  if (!isNumericReading(reading) || !('decimalSign' in reading)) return reading;
  let [decimalCharacter, groupCharacter] = reading.decimalSign === 'point' ? ['.', ','] : [',', '.'];
  let decimalPlaces = decimalPlacesShownAfter(different, decimalCharacter);
  if (reading.kind === 'currency')
    return {
      ...reading,
      decimalPlaces,
    };
  if (reading.kind === 'number')
    return {
      ...reading,
      decimalPlaces,
      groupsThousands: anyTextIncludes(different, groupCharacter),
    };
  let textsWithoutPercent = different.filter(({ text }) => !text.includes('%'));
  let hasNumbersOverOne = (
    reads.textsUnderAColumnReading(
      {
        kind: 'number',
        decimalSign: reading.decimalSign,
        decimalPlaces: 0,
        groupsThousands: false,
      },
      textsWithoutPercent.map(({ text }) => text),
    )?.read ?? []
  ).some((read) => read.kind === 'fits' && read.input.kind === 'number' && Math.abs(read.input.value) > 1);
  if (!hasNumbersOverOne)
    return {
      ...reading,
      decimalPlaces,
      numberAloneIs: 'aShareOfOne',
    };
  let textsWithPercent = different.filter(({ text }) => text.includes('%'));
  if (
    !isSomeBatchOfTexts(
      textsWithPercent.map(({ text }) => text),
      (batch) => (reads.fitOfColumnReadings([reading], batch)?.[0]?.fitting ?? 0) > 0,
    ) ||
    countOfTexts(textsWithPercent) > countOfTexts(textsWithoutPercent)
  )
    return {
      ...reading,
      decimalPlaces,
      numberAloneIs: 'percents',
    };
  return {
    ...reading,
    decimalPlaces: decimalPlacesShownAfter(textsWithPercent, decimalCharacter),
    numberAloneIs: 'noPercentage',
  };
}
export function decimalSignOfLeadingZeros(texts: string[]): DecimalSign | null {
  let signs = new Set<string | undefined>();
  for (let text of texts) signs.add(/(?:^|[^\d.,])0([.,])\d+(?![\d.,])/.exec(text)?.[1]);
  signs.delete(undefined);
  if (signs.size !== 1) return null;
  return signs.has(',') ? 'comma' : 'point';
}
export function doDecimalSignsReadDifferently(
  reading: ColumnReading,
  otherReading: ColumnReading,
  texts: string[],
  reads: Pick<WorkbookReads, 'textsUnderAColumnReading'>,
) {
  let textsWithSign = texts.filter((text) => /[.,]/.test(text));
  return isSomeBatchOfTexts(textsWithSign, (batch) => {
    let otherReads = reads.textsUnderAColumnReading(otherReading, batch)?.read ?? [];
    return (reads.textsUnderAColumnReading(reading, batch)?.read ?? []).some((read, index) => {
      let otherRead = otherReads[index];
      return read.kind === 'fits' && otherRead?.kind === 'fits' && !isSameJson(read.input, otherRead.input);
    });
  });
}
export function guessColumnReading(
  { texts, different, readings, fits }: ImportColumnProfile,
  reads: Pick<WorkbookReads, 'textsUnderAColumnReading' | 'fitOfColumnReadings'>,
): ImportColumnGuess {
  let textGuess: ImportColumnGuess = {
    reading: {
      kind: 'text',
    },
    isOpenBetweenDayAndMonthFirst: false,
    withOtherDecimalSign: null,
    ofDecimalSign: null,
  };
  if (different.length === 0) return textGuess;
  if (looksLikeTrueOrFalseColumn(texts))
    return {
      ...textGuess,
      reading: {
        kind: 'trueOrFalse',
      },
    };
  let differentTexts = different.map(({ text }) => text);
  let differentFits: ReturnType<WorkbookReads['fitOfColumnReadings']> | undefined;
  let notFittingExamplesAt = (index: number) => (
    (differentFits ??= reads.fitOfColumnReadings([...readings], differentTexts) ?? []),
    notFittingExamples(differentFits[index], differentTexts)
  );
  let candidates = readings.flatMap((reading, index) => {
    let fit = fits[index];
    return fit !== undefined &&
      fit.sameAsReading === null &&
      fit.fitting > fit.notFitting &&
      !losesPrecisionInAny(reading, differentTexts) &&
      !isFitTooPoor(fit, () => notFittingExamplesAt(index))
      ? [
          {
            reading,
            notFitting: fit.notFitting,
          },
        ]
      : [];
  });
  let fewestNotFitting = candidates.reduce(
    (fewest, { notFitting }) => Math.min(fewest, notFitting),
    Number.POSITIVE_INFINITY,
  );
  let bestCandidates = candidates.filter(({ notFitting }) => notFitting === fewestNotFitting);
  let [best] = bestCandidates;
  const bestReading = (
    (best !== undefined && dateOrderOfReading(best.reading) === 'yearMonthDay'
      ? bestCandidates.find(({ reading }) => reading.kind === best.reading.kind && reading !== best.reading)
      : undefined) ?? best
  )?.reading;
  if (bestReading !== undefined) {
    let ordersOfKind = new Set(
      bestCandidates
        .filter(({ reading }) => reading.kind === bestReading.kind)
        .map(({ reading }) => dateOrderOfReading(reading)),
    );
    let isOtherDecimalSign = (reading: ColumnReading) =>
      reading.kind === bestReading.kind && decimalSignOfReading(reading) !== decimalSignOfReading(bestReading);
    let otherIndex = readings.findIndex(isOtherDecimalSign);
    let otherReading = candidates.find(({ reading }) => isOtherDecimalSign(reading))?.reading ?? null;
    let hasDecimalTexts = fits[otherIndex]?.sameAsReading === null && differentTexts.some((text) => /[.,]\d/.test(text));
    let signsDisagree = otherReading !== null && doDecimalSignsReadDifferently(bestReading, otherReading, differentTexts, reads);
    let isOtherAmongBest = bestCandidates.some(({ reading }) => reading === otherReading);
    let signOfLeadingZeros = hasDecimalTexts ? decimalSignOfLeadingZeros(differentTexts) : null;
    let [chosenReading, alternativeReading]: [ColumnReading, ColumnReading | null] =
      otherReading !== null && isOtherAmongBest && signOfLeadingZeros === decimalSignOfReading(otherReading)
        ? [otherReading, bestReading]
        : [bestReading, otherReading];
    let decimalSignEvidence = (): DecimalSignEvidence => {
      if (signOfLeadingZeros === decimalSignOfReading(chosenReading)) return 'settles';
      if (isOtherAmongBest) return 'saysLittle';
      let textsWithDecimals = texts.filter((text) => /[.,]\d/.test(text));
      let [fit] = reads.fitOfColumnReadings(readings.slice(otherIndex, otherIndex + 1), textsWithDecimals) ?? [];
      if (fit === undefined) return 'saysLittle';
      if (alternativeReading === null && fit.fitting < fit.notFitting) return 'settles';
      return fit.notFitting * DECIMAL_SIGN_LEAN_RATIO >= textsWithDecimals.length ? 'leans' : 'saysLittle';
    };
    return {
      reading: refineReadingForTexts(chosenReading, different, reads),
      isOpenBetweenDayAndMonthFirst: ordersOfKind.has('dayMonthYear') && ordersOfKind.has('monthDayYear'),
      withOtherDecimalSign: signsDisagree ? alternativeReading : null,
      ofDecimalSign: hasDecimalTexts ? decimalSignEvidence() : null,
    };
  }
  if (
    READING_DECIMAL_SIGNS.some(
      (decimalSign) =>
        losesPrecisionInAny(
          {
            kind: 'number',
            decimalSign,
            decimalPlaces: 0,
            groupsThousands: false,
          },
          differentTexts,
        ),
    )
  )
    return textGuess;
  let filledCount = different.reduce((sum, { count }) => sum + count, 0);
  if (
    !(
      different.length >= MIN_GUESSED_DROPDOWN_OPTIONS &&
      different.length <= MAX_GUESSED_DROPDOWN_OPTIONS &&
      filledCount >= different.length * MIN_DROPDOWN_REPEATS
    )
  )
    return textGuess;
  let dropdownReading: ColumnReading = {
    kind: 'dropdown',
    isColored: true,
  };
  let [dropdownFit] = reads.fitOfColumnReadings([dropdownReading], texts) ?? [];
  return dropdownFit !== undefined && dropdownFit.notFitting === 0
    ? {
        ...textGuess,
        reading: dropdownReading,
      }
    : textGuess;
}
export function decimalSignQuestion(
  guesses: ImportColumnGuess[],
  { columns }: Pick<ImportFileProfile, 'columns'>,
  { delimiter }: Pick<ImportFile, 'delimiter'>,
  reads: Pick<WorkbookReads, 'decimalSign' | 'textsUnderAColumnReading' | 'fitOfColumnReadings'>,
  labels: ImportReadingWords['decimalSign'],
): ImportQuestion | null {
  let columnsInDoubt = guesses.flatMap(
    ({ reading, withOtherDecimalSign: other }, columnIndex) =>
      other === null
        ? []
        : [
            {
              columnIndex,
              reading,
              other,
            },
          ],
  );
  let signsThat = (evidence: DecimalSignEvidence) =>
    new Set(
      guesses.flatMap((guess) => (guess.ofDecimalSign === evidence ? [decimalSignOfReading(guess.reading)] : [])),
    );
  let settledSigns = signsThat('settles');
  let leaningSigns = signsThat('leans');
  let defaultSign: DecimalSign = delimiter === ';' ? 'comma' : reads.decimalSign;
  let isDefaultInPlay = delimiter === ';' || (settledSigns.size === 0 && leaningSigns.size === 0);
  let signsInPlay = new Set([
    ...settledSigns,
    ...leaningSigns,
    ...signsThat('saysLittle'),
    ...(defaultSign === 'comma' && isDefaultInPlay ? [defaultSign] : []),
  ]);
  if (columnsInDoubt.length === 0 || signsInPlay.size < 2) return null;
  let decidingSigns = settledSigns.size > 0 ? settledSigns : leaningSigns;
  let choices: [DecimalSign, string][] = [
    ['comma', labels.comma],
    ['point', labels.point],
  ];
  return {
    id: 'decimal-sign',
    ask: labels.ask,
    options: choices.map(
      ([sign, label]) => ({
        label,
        readings: columnsInDoubt.map(
          ({ columnIndex, reading, other }) => ({
            columnIndex,
            reading: decimalSignOfReading(reading) === sign ? reading : refineReadingForTexts(other, columns[columnIndex]?.different ?? [], reads),
          }),
        ),
      }),
    ),
    recommendedIndex: (decidingSigns.size === 1 ? decidingSigns.has('comma') : defaultSign === 'comma') ? 0 : 1,
  };
}
/** A plan for importing a file made from its profile alone, before or without the agent. */
export function planImportWithoutAgent(file: ImportFile, profile: ImportFileProfile, reads: WorkbookReads, words: ImportReadingWords): ImportPlan {
  let guessReadings = ({ columns: columnProfiles }: Pick<ImportFileProfile, 'columns'>) =>
    columnProfiles.map((columnProfile) => guessColumnReading(columnProfile, reads));
  const headerLine = profile.headerLine;
  let guesses = guessReadings(profile);
  const isHeaderARecord = headerLine !== null && headerLineFitsReadings(file, headerLine, profile, guesses, reads);
  let linesLeftOut = isHeaderARecord
    ? Array.from(
        {
          length: headerLine - 1,
        },
        (_, index) => index + 1,
      )
    : profile.linesLeftOut;
  let planHeaderLine = isHeaderARecord ? null : headerLine;
  let planProfile = isHeaderARecord
    ? profileImportFile(file, reads, {
        headerLine: planHeaderLine,
        linesLeftOut,
      })
    : profile;
  let planGuesses = isHeaderARecord ? guessReadings(planProfile) : guesses;
  let dateColumnsInDoubt = planGuesses.flatMap(
    (guess, columnIndex) =>
      guess.isOpenBetweenDayAndMonthFirst
        ? [
            {
              columnIndex,
              reading: guess.reading,
            },
          ]
        : [],
  );
  let dateChoices: [DateOrder, string][] = [
    ['monthDayYear', words.dateOrder.monthFirst],
    ['dayMonthYear', words.dateOrder.dayFirst],
  ];
  let dateOrderQuestion: ImportQuestion = {
    id: 'date-order',
    ask: words.dateOrder.ask,
    options: dateChoices.map(
      ([order, label]) => ({
        label,
        readings: dateColumnsInDoubt.map(
          ({ columnIndex, reading }) => ({
            columnIndex,
            reading: withDateOrder(reading, order),
          }),
        ),
      }),
    ),
    recommendedIndex: dateChoices.findIndex(([order]) => order === dayMonthOrderOf(reads)),
  };
  let signQuestion = decimalSignQuestion(planGuesses, planProfile, file, reads, words.decimalSign);
  let columns = planGuesses.map(({ reading }, columnIndex) => {
    let heading = planHeaderLine === null ? '' : importTextAt(file, planHeaderLine, columnIndex).trim();
    return {
      name: heading === '' ? (words.names.columns[columnIndex] ?? '') : heading,
      reading,
    };
  });
  let questions = [...(dateColumnsInDoubt.length > 0 ? [dateOrderQuestion] : []), ...(signQuestion === null ? [] : [signQuestion])];
  return planWithAnswers(
    {
      sheetName: words.names.sheet,
      headerLine: planHeaderLine,
      linesLeftOut,
      columns,
      questions,
      notes: [],
      destination: NEW_SHEET_DESTINATION,
      whyThere: null,
      destinationQuestion: null,
    },
    {},
  );
}
/** A reading among the ways to try that reads the file's texts as more of the values the sheet holds than the way now does. */
export function readingKeepingMoreHeld(wayNow: WayOfReading, waysToTry: () => WayOfReading[], shared: RowHeldInSheet[]) {
  let texts = shared.map(({ text }) => text);
  let keptBy = (way: WayOfReading) => {
    const values = way.read(texts);
    if (values === null) return null;
    let isNumberLost = ({ held }: RowHeldInSheet, index: number) => typeof held === 'number' && typeof values[index] === 'string';
    return {
      left: shared.filter(({ held }, index) => held === values[index]).length,
      numbersLost: shared.filter(isNumberLost).length,
    };
  };
  let keptNow = keptBy(wayNow);
  if (keptNow === null || keptNow.left === shared.length) return null;
  let best: { way: WayOfReading; left: number } | null = null;
  for (let way of waysToTry()) {
    let kept = keptBy(way);
    if (kept === null) continue;
    let { left, numbersLost } = kept;
    if (numbersLost > keptNow.numbersLost || left < keptNow.left + 2) continue;
    if (
      best === null ||
      left > best.left ||
      (left === best.left &&
        (way.fitting > best.way.fitting || (way.fitting === best.way.fitting && way.isTheWorkbooksOwn && !best.way.isTheWorkbooksOwn)))
    )
      best = {
        way,
        left,
      };
  }
  return best?.way.reading ?? null;
}
export function wayOfReading(reading: ImportReading, fitting: number, reads: WorkbookReads): WayOfReading {
  return {
    reading,
    fitting,
    isTheWorkbooksOwn:
      ('decimalSign' in reading && reading.decimalSign === reads.decimalSign) || ('order' in reading && reading.order === dayMonthOrderOf(reads)),
    read(texts) {
      if (!isReadingParsed(reading)) return texts;
      let read = reads.textsUnderAColumnReading(reading, [...texts])?.read;
      if (read === undefined) return null;
      return texts.map((text, index) => {
        let readText = read[index];
        return readText?.kind === 'fits' && readText.input.kind === 'number' ? readText.input.value : text;
      });
    },
  };
}
export function waysToReadColumn(
  { different, readings, fits }: Pick<ImportColumnProfile, 'different' | 'readings' | 'fits'>,
  leastFitting: number | null,
  reads: WorkbookReads,
): WayOfReading[] {
  let texts = different.map(({ text }) => text);
  let fittingOf = (index: number) => fits[index]?.fitting ?? 0;
  let ways = readings.flatMap((reading, index) => {
    let fittingsOfKind = readings.map(
      (other, otherIndex) => (other.kind === reading.kind ? fittingOf(otherIndex) : 0),
    );
    return fittingOf(index) === 0 ||
      fits[index]?.sameAsReading !== null ||
      losesPrecisionInAny(reading, texts) ||
      (leastFitting !== null && fittingOf(index) < Math.max(leastFitting, ...fittingsOfKind))
      ? []
      : [wayOfReading(reading, fittingOf(index), reads)];
  });
  return [
    wayOfReading(
      {
        kind: 'text',
      },
      0,
      reads,
    ),
    ...ways,
  ];
}
/** A better reading of a column for the values the sheet already holds in the rows it shares with the file, if there is one. */
export function readingAsSheetHolds(
  file: Pick<ImportFile, 'lines'>,
  records: number[],
  columnIndex: number,
  reading: ImportReading,
  shared: RowHeldInSheet[],
  reads: WorkbookReads,
): ImportReading | null {
  if (shared.length < LEAST_SHARED_ROWS) return null;
  let texts = importColumnTexts(file, records, columnIndex);
  let fitting = readingFittingTexts(reading, texts);
  let wayNow = wayOfReading(fitting, 0, reads);
  let sharedLines = shared.map(({ line }) => line);
  if (
    readingKeepingMoreHeld(wayNow, () => waysToReadColumn(profileImportColumn(file, sharedLines, columnIndex, reads), null, reads), shared) === null
  )
    return null;
  let profile = profileImportColumn(file, records, columnIndex, reads);
  let fittingNow = isReadingParsed(fitting) ? (fitOfReading(fitting, texts, reads)?.fitting ?? 0) : 0;
  let better = readingKeepingMoreHeld(wayNow, () => waysToReadColumn(profile, fittingNow, reads), shared);
  if (better === null) return null;
  let refined = refineReadingForTexts(better, profile.different, reads);
  return refined.kind === 'percent' && better.kind === 'percent'
    ? {
        ...refined,
        numberAloneIs: better.numberAloneIs,
      }
    : refined;
}
export function scrambledIndex(index: number) {
  let hash = index + 1;
  hash = Math.imul(hash ^ (hash >>> 16), 73244475);
  hash = Math.imul(hash ^ (hash >>> 16), 73244475);
  return (hash ^ (hash >>> 16)) >>> 0;
}
export const MIN_GUESSED_DROPDOWN_OPTIONS = 2;
export const MAX_GUESSED_DROPDOWN_OPTIONS = 8;
export const MIN_DROPDOWN_REPEATS = 3;
export const anyTextIncludes = (different: DifferentText[], character: string) =>
  different.some(({ text }) => text.includes(character));
export const decimalPlacesShownAfter = (different: DifferentText[], decimalCharacter: string) =>
  different.reduce((places, { text }) => {
    let afterSign = text.slice(text.lastIndexOf(decimalCharacter) + 1);
    let digitCount = text.includes(decimalCharacter) ? (/^\d*/.exec(afterSign)?.[0].length ?? 0) : 0;
    return Math.min(MAX_BROUGHT_DOWN_DECIMAL_PLACES, Math.max(places, digitCount));
  }, 0);
export const countOfTexts = (texts: DifferentText[]) =>
  texts.reduce((total, { count }) => total + count, 0);
export const TEXT_CHECK_BATCH = 200;
export const dateOrderOfReading = (reading: ImportReading) =>
  reading.kind === 'date' || reading.kind === 'dateAndTime' ? reading.order : null;
export const DECIMAL_SIGN_LEAN_RATIO = 20;
export const isTextOrDropdownReading = ({ kind }: ImportReading) => kind === 'text' || kind === 'dropdown';
export const headerLineFitsReadings = (
  file: Pick<ImportFile, 'lines'>,
  headerLine: number,
  { columns }: Pick<ImportFileProfile, 'columns'>,
  guesses: ImportColumnGuess[],
  reads: Pick<WorkbookReads, 'fitOfColumnReadings'>,
) =>
  guesses.every(({ reading }, columnIndex) => {
    if (columns[columnIndex]?.different.length === 0) return true;
    if (isTextOrDropdownReading(reading)) return false;
    return fitOfReading(reading, [importTextAt(file, headerLine, columnIndex)], reads)?.notFitting === 0;
  });
export const withDateOrder = (reading: ImportReading, order: DateOrder): ImportReading =>
  reading.kind === 'date' || reading.kind === 'dateAndTime'
    ? {
        ...reading,
        order,
        shownAs: dateShownAsForOrder(order),
      }
    : reading;
export const LEAST_SHARED_ROWS = 2;
export const isReadingParsed = (reading: ImportReading): reading is ReadingParsed =>
  reading.kind !== 'text' && reading.kind !== 'dropdown' && reading.kind !== 'trueOrFalse';
export const SHARED_ROWS_COMPARED = 200;
export const SHARED_ROWS_KEPT = 20 * SHARED_ROWS_COMPARED;
