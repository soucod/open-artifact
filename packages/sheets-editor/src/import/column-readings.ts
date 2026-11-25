import type { DateOrder, DecimalSign, FitOfAColumnReading } from '@open-artifact/sheets-core';
import { parseBooleanText, booleanText } from '../model/cell-text.ts';
import { MAX_IMPORT_QUESTIONS } from './import-basics.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { ImportFile, ImportPlan, ImportQuestion, ImportQuestionOption } from '../state/initial-state.ts';
import type { ImportReading } from '../state/event-reducer.ts';
/** A question of an import plan with the option chosen for it. */
export interface ImportAnswerChosen {
  question: ImportQuestion;
  chosenIndex: number;
}
/** The lines of a file that a plan takes as headings and leaves out. */
export type ImportLineChoice = Pick<ImportPlan, 'headerLine' | 'linesLeftOut'>;
/** A reading of one column of the file, as a question option sets it. */
export type ImportColumnReading = ImportQuestionOption['readings'][number];
export function precisionLossOfDigits(text: string, decimalSign: DecimalSign) {
  let trimmed = text.trim();
  if (!DIGITS_TEXT_PATTERN.test(trimmed)) return null;
  if (/^0\d/.test(trimmed)) return 'leadingZeros';
  let [wholePart = ''] = trimmed.split(decimalSign === 'point' ? '.' : ',');
  return wholePart.replaceAll(/\D/g, '').length > MAX_EXACT_DIGITS ? 'lastDigits' : null;
}
export function stripNumberDecorations(reading: ImportReading, text: string) {
  let symbol = reading.kind === 'currency' ? reading.symbol : '%';
  let bare = (reading.kind === 'currency' || reading.kind === 'percent' ? text.replace(symbol, '') : text)
    .replace(/^[-+(\s]+/, '')
    .trimEnd();
  return bare.endsWith(')') || bare.endsWith('-') ? bare.slice(0, -1) : bare;
}
export function isPlainDecimalText(reading: ImportReading, text: string, wholeDigits: string, fractionText: string) {
  if (wholeDigits.length > MAX_EXACT_DIGITS || !/^\d*$/.test(wholeDigits)) return false;
  let unsigned = text.startsWith('-') ? text.slice(1) : text;
  let bare = reading.kind === 'currency' && unsigned.startsWith(reading.symbol) ? unsigned.slice(reading.symbol.length) : unsigned;
  return bare === `${wholeDigits}${fractionText}` || (reading.kind === 'percent' && bare === `${wholeDigits}${fractionText}%`);
}
export function decimalPlacesRead(reading: ImportReading, text: string) {
  if (!('decimalSign' in reading)) return null;
  const isWithoutPercentSign = reading.kind === 'percent' && !text.includes('%');
  if (isWithoutPercentSign && reading.numberAloneIs === 'noPercentage') return null;
  let decimalChar = reading.decimalSign === 'point' ? '.' : ',';
  let [wholePart = '', fractionPart, ...extraParts] = stripNumberDecorations(reading, text).split(decimalChar);
  if (fractionPart === undefined || extraParts.length > 0 || !/^\d+$/.test(fractionPart)) return null;
  if (!/^[\d\s'.,]*$/.test(wholePart)) return null;
  let isShareOfOne = isWithoutPercentSign && reading.numberAloneIs === 'aShareOfOne';
  let significantLength = fractionPart.length;
  while (fractionPart[significantLength - 1] === '0') significantLength -= 1;
  return {
    places: Math.max(0, significantLength - (isShareOfOne ? 2 : 0)),
    isPlain: isPlainDecimalText(reading, text, wholePart, `${decimalChar}${fractionPart}`),
  };
}
export function readingFittingTexts(reading: ImportReading, texts: string[]): ImportReading {
  if (reading.kind === 'trueOrFalse' && !canAllReadAsTrueOrFalse(texts))
    return {
      kind: 'text',
    };
  if (reading.kind === 'percent' && reading.numberAloneIs === 'noPercentage' && !texts.some((text) => text.includes('%')))
    return {
      ...reading,
      numberAloneIs: 'percents',
    };
  return reading;
}
export function trueOrFalseTextOf(text: string) {
  let trimmed = text.trim();
  let booleanValue = parseBooleanText(trimmed);
  if (booleanValue !== null) return booleanText(booleanValue);
  if (trimmed === '') return '';
  return isWordTextWithoutNumbers(text) ? text : null;
}
export function trueOrFalseFit(texts: string[]): FitOfAColumnReading {
  let filledIndexes = texts.flatMap((text, index) => (text.trim() === '' ? [] : [index]));
  let notFittingIndexes = filledIndexes.filter((index) => parseBooleanText((texts[index] ?? '').trim()) === null);
  return {
    fitting: filledIndexes.length - notFittingIndexes.length,
    notFitting: notFittingIndexes.length,
    firstNotFitting: notFittingIndexes.slice(0, MAX_NOT_FITTING_EXAMPLES),
    options: null,
    sameAsReading: null,
  };
}
export function notFittingExamples(fit: FitOfAColumnReading | undefined, texts: string[]) {
  return fit !== undefined && fit.notFitting <= MAX_NOT_FITTING_EXAMPLES && fit.firstNotFitting.length === fit.notFitting
    ? fit.firstNotFitting.map((index) => texts[index] ?? '')
    : null;
}
export function isFitTooPoor({ fitting, notFitting }: Pick<FitOfAColumnReading, 'fitting' | 'notFitting'>, getExamples: () => string[] | null) {
  if (fitting === 0) return true;
  if (notFitting <= 1 || notFitting * POOR_FIT_RATIO <= fitting + notFitting) return false;
  if (fitting <= notFitting) return true;
  let examples = getExamples();
  return examples === null || examples.some((example) => /\p{N}/u.test(example));
}
export function looksLikeTrueOrFalseColumn(texts: string[]) {
  let fit = trueOrFalseFit(texts);
  if (fit.fitting <= fit.notFitting || !canAllReadAsTrueOrFalse(texts)) return false;
  return !isFitTooPoor(fit, () => {
    let differentTexts = [...new Set(texts.map((text) => text.trim()))];
    return notFittingExamples(trueOrFalseFit(differentTexts), differentTexts);
  });
}
export function dataLineNumbers(table: Pick<ImportFile, 'lines'>, { headerLine, linesLeftOut }: ImportLineChoice) {
  let leftOut = new Set(linesLeftOut);
  let lineNumbers: number[] = [];
  for (let lineNumber = (headerLine ?? 0) + 1; lineNumber <= table.lines.length; lineNumber++)
    if (!leftOut.has(lineNumber) && !(table.lines[lineNumber - 1] ?? []).every(isBlankImportText)) lineNumbers.push(lineNumber);
  return lineNumbers;
}
export function lastDataLineNumber(table: Pick<ImportFile, 'lines'>, linesLeftOut: number[]) {
  let leftOut = new Set(linesLeftOut);
  for (let lineNumber = table.lines.length; lineNumber >= 1; lineNumber--)
    if (!leftOut.has(lineNumber) && !(table.lines[lineNumber - 1] ?? []).every(isBlankImportText)) return lineNumber;
  return null;
}
export function planWithAnswers(plan: ImportPlan, answers: Record<string, number>): ImportPlan {
  let columns = [...plan.columns];
  for (let question of plan.questions) {
    let chosenOption = question.options[answers[question.id] ?? question.recommendedIndex];
    for (let { columnIndex, reading } of chosenOption?.readings ?? []) {
      let column = columns[columnIndex];
      if (column !== undefined)
        columns[columnIndex] = {
          ...column,
          reading,
        };
    }
  }
  return {
    ...plan,
    columns,
  };
}
export function alignQuestionDecimalSigns(plan: ImportPlan, question: ImportQuestion): ImportQuestion {
  let answeredColumns = new Set(plan.questions.flatMap(questionColumnIndexes));
  let readsDistinctly = (columnIndex: number) => {
    let signs = question.options.map(({ readings }) => {
      let match = readings.find((columnReading) => columnReading.columnIndex === columnIndex);
      return match === undefined ? null : decimalSignOfReading(match.reading);
    });
    return !signs.includes(null) && new Set(signs).size === signs.length;
  };
  let alignableColumns = new Set(
    questionColumnIndexes(question).filter((columnIndex) => readsDistinctly(columnIndex) && !answeredColumns.has(columnIndex)),
  );
  let options = question.options.map(
    ({ label, readings }) => ({
      label,
      readings: readings.map((columnReading): ImportColumnReading => {
        let planned = plan.columns[columnReading.columnIndex]?.reading;
        if (planned === undefined || !alignableColumns.has(columnReading.columnIndex)) return columnReading;
        if (!('decimalSign' in planned) || !('decimalSign' in columnReading.reading)) return columnReading;
        if (planned.decimalSign === columnReading.reading.decimalSign)
          return {
            ...columnReading,
            reading: planned,
          };
        if (planned.kind === columnReading.reading.kind) return columnReading;
        let { decimalSign, decimalPlaces } = columnReading.reading;
        return {
          ...columnReading,
          reading: {
            ...planned,
            decimalSign,
            decimalPlaces,
          },
        };
      }),
    }),
  );
  return {
    ...question,
    options,
  };
}
export function mergeImportQuestions(plan: ImportPlan, previousAnswers: ImportAnswerChosen[], newQuestions: ImportQuestion[] = []) {
  let readingStands = ({ columnIndex, reading }: ImportColumnReading) =>
    isSameJson(plan.columns[columnIndex]?.reading, reading);
  let keptAnswers = previousAnswers.flatMap(({ question, chosenIndex }, answerIndex) => {
    let aligned = alignQuestionDecimalSigns(plan, question);
    let keptOptions = optionsLimitedToColumns(
      aligned,
      (columnIndex) =>
        aligned.options.some(
          ({ readings }) =>
            readings.some((columnReading) => columnReading.columnIndex === columnIndex && readingStands(columnReading)),
        ),
    );
    let chosenReadings = keptOptions[chosenIndex]?.readings ?? [];
    if (!doOptionsDiffer(keptOptions)) return [];
    return [
      {
        question: {
          ...aligned,
          id: `answered-${answerIndex + 1}`,
          options: keptOptions,
        },
        chosenIndex,
        isInDoubt: !chosenReadings.every(readingStands),
      },
    ];
  });
  let answeredColumns = new Set(
    keptAnswers.flatMap(({ question }) => questionColumnIndexes(question)),
  );
  let keptQuestions = plan.questions.flatMap((question) => {
    let keptOptions = optionsLimitedToColumns(question, (columnIndex) => !answeredColumns.has(columnIndex));
    return doOptionsDiffer(keptOptions)
      ? [
          {
            ...question,
            options: keptOptions,
          },
        ]
      : [];
  });
  let coveredColumns = new Set([...answeredColumns, ...keptQuestions.flatMap(questionColumnIndexes)]);
  let addedQuestions = newQuestions
    .flatMap((question, questionIndex) => {
      let aligned = alignQuestionDecimalSigns(plan, question);
      let isRecommendedStanding = aligned.options[aligned.recommendedIndex]?.readings.every(readingStands);
      let isCovered = questionColumnIndexes(aligned).some((columnIndex) => coveredColumns.has(columnIndex));
      return isRecommendedStanding === true && !isCovered
        ? [
            {
              ...aligned,
              id: `unanswered-${questionIndex + 1}`,
            },
          ]
        : [];
    })
    .slice(0, Math.max(0, MAX_IMPORT_QUESTIONS - keptQuestions.length));
  let newQuestionOrder = (question: ImportQuestion) => {
    let matchIndex = newQuestions.findIndex(
      (newQuestion) => isSameJson(questionColumnIndexes(newQuestion), questionColumnIndexes(question)),
    );
    return matchIndex < 0 ? newQuestions.length : matchIndex;
  };
  let questions = [...addedQuestions, ...keptQuestions].toSorted(
    (question, otherQuestion) => newQuestionOrder(question) - newQuestionOrder(otherQuestion),
  );
  return {
    plan: {
      ...plan,
      questions: [...questions, ...keptAnswers.map(({ question }) => question)],
    },
    answers: Object.fromEntries(keptAnswers.map(({ question, chosenIndex }) => [question.id, chosenIndex])),
    isAnAnswerInDoubt: keptAnswers.some(({ isInDoubt }) => isInDoubt),
  };
}
export const MAX_NOT_FITTING_EXAMPLES = 3;
export const MAX_EXACT_DIGITS = 15;
export const DIGITS_TEXT_PATTERN = /^\d[\d\s'.,]*$/;
export const isNumericReading = ({ kind }: ImportReading) => kind === 'number' || kind === 'currency' || kind === 'percent';
export const precisionLossOf = (reading: ImportReading, text: string) =>
  'decimalSign' in reading ? precisionLossOfDigits(stripNumberDecorations(reading, text), reading.decimalSign) : null;
export const losesPrecisionInAny = (reading: ImportReading, texts: string[]) =>
  texts.some((text) => precisionLossOf(reading, text) !== null);
export const KNOWN_CURRENCY_CODES = new Set(Intl.supportedValuesOf('currency'));
export const CURRENCY_CODE_PATTERN = /^[A-Z]{3}$/;
export const isUnknownCurrencyCode = (code: string) => CURRENCY_CODE_PATTERN.test(code) && !KNOWN_CURRENCY_CODES.has(code);
export const isWordTextWithoutNumbers = (text: string) => !/\p{N}/u.test(text) && !/^\s*[='\uFF1D]/u.test(text);
export const canAllReadAsTrueOrFalse = (texts: string[]) =>
  texts.every((text) => trueOrFalseTextOf(text) !== null);
export const fitOfReading = (reading: ImportReading, texts: string[], workbook: Pick<WorkbookReads, 'fitOfColumnReadings'>) =>
  reading.kind === 'trueOrFalse' ? trueOrFalseFit(texts) : workbook.fitOfColumnReadings([reading], texts)?.[0];
export const POOR_FIT_RATIO = 10;
export const MISSING_VALUE_TEXT_PATTERN = /^(?:n\/?a|#n\/a|nan|null|none|nil|-+|\?|\.)$/i;
export const isTrueOrFalseColumn = (texts: string[]) =>
  looksLikeTrueOrFalseColumn(texts) &&
  texts.every((text) => {
    let trimmed = text.trim();
    return trimmed === '' || parseBooleanText(trimmed) !== null || MISSING_VALUE_TEXT_PATTERN.test(trimmed);
  });
export const decimalSignOfReading = (reading: ImportReading) => ('decimalSign' in reading ? reading.decimalSign : null);
export const dateShownAsForOrder = (order: DateOrder) => (order === 'yearMonthDay' ? 'yearMonthDay' : 'monthNameDayYear');
export const isBlankImportText = (text: string) => text.trim() === '';
export const importTextAt = (table: Pick<ImportFile, 'lines'>, lineNumber: number, columnIndex: number) =>
  table.lines[lineNumber - 1]?.[columnIndex] ?? '';
export const importColumnTexts = (table: Pick<ImportFile, 'lines'>, lineNumbers: number[], columnIndex: number) =>
  lineNumbers.map((lineNumber) => importTextAt(table, lineNumber, columnIndex));
export const planWithAgentRecommendations = (plan: ImportPlan) =>
  planWithAnswers(
    plan,
    Object.fromEntries(
      plan.questions.flatMap(
        ({ id, recommendedByAgentIndex }): [string, number][] =>
          recommendedByAgentIndex === undefined ? [] : [[id, recommendedByAgentIndex]],
      ),
    ),
  );
export const isSameJson = <Value>(value: Value, otherValue: Value) => JSON.stringify(value) === JSON.stringify(otherValue);
export const chosenAnswersOf = (plan: ImportPlan, answers: Record<string, number>) =>
  plan.questions.flatMap((question): ImportAnswerChosen[] => {
    let chosenIndex = answers[question.id];
    return chosenIndex === undefined
      ? []
      : [
          {
            question,
            chosenIndex,
          },
        ];
  });
export const questionColumnIndexes = ({ options }: Pick<ImportQuestion, 'options'>) =>
  (options[0]?.readings ?? []).map(({ columnIndex }) => columnIndex);
export const optionsLimitedToColumns = ({ options }: Pick<ImportQuestion, 'options'>, keepColumn: (columnIndex: number) => boolean) =>
  options.map(
    ({ label, readings }) => ({
      label,
      readings: readings.filter(({ columnIndex }) => keepColumn(columnIndex)),
    }),
  );
export const doOptionsDiffer = ([firstOption, ...otherOptions]: ImportQuestionOption[]) =>
  otherOptions.some(({ readings }) => !isSameJson(readings, firstOption?.readings));
