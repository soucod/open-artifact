import {
  dataLineNumbers,
  readingFittingTexts,
  trueOrFalseFit,
  precisionLossOf,
  decimalPlacesRead,
  isSameJson,
  fitOfReading,
} from './column-readings.ts';
import { profileImportColumn } from './file-profile.ts';
import { dayMonthOrderOf } from './import-basics.ts';
import { refineReadingForTexts } from './plan-without-agent.ts';
import { exampleOfReading } from './preview.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { ImportDigitsLost, ImportFile, ImportReadingKind } from '../state/initial-state.ts';
import type { ImportReading } from '../state/event-reducer.ts';
import type { ImportLineChoice } from './column-readings.ts';
/** The best reading of a kind found for a column, and how many of its fields it fits. */
interface FitOfReadingKind {
  reading: ImportReading;
  fitting: number;
  notFitting: number;
}
type DigitsLoss = NonNullable<ReturnType<typeof precisionLossOf>>;
/** The ways to read a column of the file, one of each kind, in the order they are offered. */
export function readingKindsOfColumn(
  file: ImportFile,
  plan: ImportLineChoice,
  columnIndex: number,
  chosenReadings: ImportReading[],
  agentsReading: ImportReading | null,
  reads: WorkbookReads,
  maxDropdownOptions: number,
): ImportReadingKind[] {
  let lineNumbers = dataLineNumbers(file, plan);
  let { texts, different, readings, fits } = profileImportColumn(file, lineNumbers, columnIndex, reads);
  let filledCount = different.reduce((sum, { count }) => sum + count, 0);
  let noneFit = {
    fitting: 0,
    notFitting: filledCount,
  };
  let allFit = {
    fitting: filledCount,
    notFitting: 0,
  };
  let trueOrFalse: ImportReading = {
    kind: 'trueOrFalse',
  };
  let bestByKind = new Map<ImportReading['kind'], FitOfReadingKind>([
    [
      'text',
      {
        reading: {
          kind: 'text',
        },
        ...allFit,
      },
    ],
    [
      'trueOrFalse',
      {
        reading: trueOrFalse,
        ...(readingFittingTexts(trueOrFalse, texts) === trueOrFalse ? trueOrFalseFit(texts) : noneFit),
      },
    ],
    [
      'dropdown',
      {
        reading: {
          kind: 'dropdown',
          isColored: true,
        },
        ...(different.length <= maxDropdownOptions ? allFit : noneFit),
      },
    ],
  ]);
  let [decimalSign = reads.decimalSign] = chosenReadings.flatMap(
    (reading) => ('decimalSign' in reading ? [reading.decimalSign] : []),
  );
  let [dateOrder = dayMonthOrderOf(reads)] = chosenReadings.flatMap((reading) => ('order' in reading ? [reading.order] : []));
  let isChosenOrder = (reading: ImportReading) =>
    ('decimalSign' in reading && reading.decimalSign === decimalSign) || ('order' in reading && reading.order === dateOrder);
  readings.forEach((reading, index) => {
    let { fitting, notFitting } = fits[index] ?? noneFit;
    let best = bestByKind.get(reading.kind);
    if (
      best === undefined ||
      fitting > best.fitting ||
      (fitting === best.fitting && !isChosenOrder(best.reading) && (isChosenOrder(reading) || 'order' in reading))
    )
      bestByKind.set(reading.kind, {
        reading,
        fitting,
        notFitting,
      });
  });
  let digitsLostUnder = (reading: ImportReading): [text: string, loss: DigitsLoss][] | null => {
    if (reading.kind === 'trueOrFalse') return [];
    let lossByText = different.flatMap(({ text }): [string, DigitsLoss][] => {
      const loss = precisionLossOf(reading, text);
      return loss === null ? [] : [[text, loss]];
    });
    let unsure = lossByText.filter(([text]) => !ALL_DIGITS_PATTERN.test(text));
    if (unsure.length > MAX_TEXTS_RECHECKED) return null;
    let read =
      unsure.length === 0
        ? undefined
        : reads.textsUnderAColumnReading(
            reading,
            unsure.map(([text]) => text),
          )?.read;
    let fitting = new Set(unsure.filter((textAndLoss, index) => read?.[index]?.kind === 'fits'));
    return lossByText.filter((textAndLoss) => ALL_DIGITS_PATTERN.test(textAndLoss[0]) || fitting.has(textAndLoss));
  };
  let digitsOf = (reading: ImportReading): ImportDigitsLost[] => {
    let isText = reading.kind === 'text';
    let numberReadings = (['number', 'currency', 'percent'] satisfies ImportReading['kind'][]).flatMap(
      (kind) => bestByKind.get(kind)?.reading ?? [],
    );
    let losses = (isText ? numberReadings : [reading]).map(digitsLostUnder);
    if (losses.includes(null)) return [];
    let lossByText = new Map(losses.flatMap((lossesOfReading) => lossesOfReading ?? []));
    return (['leadingZeros', 'lastDigits'] satisfies ('leadingZeros' | 'lastDigits')[]).flatMap((digits) => {
      let count = different
        .filter(({ text }) => lossByText.get(text) === digits)
        .reduce((sum, differentText) => sum + differentText.count, 0);
      return count === 0
        ? []
        : {
            digits,
            isKept: isText,
            count,
            filled: filledCount,
          };
    });
  };
  let decimalPlacesLostUnder = (reading: ImportReading): ImportDigitsLost[] => {
    if (!('decimalPlaces' in reading)) return [];
    let moreDecimals = different.flatMap((differentText) => {
      let places = decimalPlacesRead(reading, differentText.text);
      return places !== null && places.places > reading.decimalPlaces
        ? [
            {
              ...differentText,
              isPlain: places.isPlain,
            },
          ]
        : [];
    });
    if (moreDecimals.length === 0) return [];
    let unsure = moreDecimals.filter(({ isPlain }) => !isPlain);
    if (unsure.length > MAX_TEXTS_RECHECKED) return [];
    let plainSample = moreDecimals.filter(({ isPlain }) => isPlain).slice(0, 1);
    let checked = [...unsure, ...plainSample];
    let read = reads.textsUnderAColumnReading(
      reading,
      checked.map(({ text }) => text),
    )?.read;
    let fitting = new Set(checked.filter((differentText, index) => read?.[index]?.kind === 'fits'));
    if (read === undefined || plainSample.some((differentText) => !fitting.has(differentText))) return [];
    let count = moreDecimals
      .filter((differentText) => differentText.isPlain || fitting.has(differentText))
      .reduce((sum, differentText) => sum + differentText.count, 0);
    return count === 0
      ? []
      : [
          {
            digits: 'decimalPlaces',
            shown: reading.decimalPlaces,
            count,
            filled: filledCount,
          },
        ];
  };
  const chosenReading = chosenReadings[0] === undefined ? undefined : readingFittingTexts(chosenReadings[0], texts);
  let agentsFittingReading = agentsReading !== null && readingFittingTexts(agentsReading, texts) === agentsReading ? agentsReading : null;
  return READING_KIND_ORDER.flatMap((kind): ImportReadingKind | [] => {
    const isChosen = chosenReading?.kind === kind;
    let isAgents = agentsFittingReading?.kind === kind;
    let best = bestByKind.get(kind);
    let refined =
      best === undefined || best.reading.kind === 'trueOrFalse' ? best?.reading : refineReadingForTexts(best.reading, different, reads);
    let reading = (isAgents ? agentsFittingReading : refined) ?? (isChosen ? chosenReading : undefined);
    if (reading === undefined) return [];
    let isBest = best !== undefined && isSameJson(reading, refined);
    let { fitting, notFitting } = (isBest ? best : fitOfReading(reading, texts, reads)) ?? {
      fitting: 0,
      notFitting: 0,
    };
    let shownReading = isChosen ? chosenReading : reading;
    let isPicked = isChosen || isAgents;
    return {
      reading,
      fitting,
      notFitting,
      isAgentsPick: isAgents,
      digits: isPicked ? [...digitsOf(shownReading), ...decimalPlacesLostUnder(shownReading)] : [],
      example: isPicked || fitting > 0 ? exampleOfReading(shownReading, texts, reads) : null,
    };
  });
}
export const withoutDecimalPlacesDigits = (readingKind: ImportReadingKind): ImportReadingKind => ({
  ...readingKind,
  digits: readingKind.digits.filter(({ digits }) => digits !== 'decimalPlaces'),
});
export const ALL_DIGITS_PATTERN = /^\d+$/;
export const MAX_TEXTS_RECHECKED = 1000;
export const READING_KIND_ORDER: ImportReading['kind'][] = ['text', 'number', 'currency', 'percent', 'date', 'dateAndTime', 'timeOfDay', 'trueOrFalse', 'dropdown'];
