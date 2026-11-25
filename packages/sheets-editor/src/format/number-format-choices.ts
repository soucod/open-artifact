import type { NumberFormat, NumberFormatKind, PatternRefusal, SharedCellFormat, SheetId, ShownValue } from '@open-artifact/sheets-core';
import type { CellFormatChoiceName, NumberFormatGroup } from '../i18n/format-labels.ts';
import type { CellArea } from '../selection/model.ts';
import type { LocalePatterns } from '../model/workbook.ts';
import type { ShownCell } from '../grid/formulas-shown.ts';
import type { ExamplesOfNumberFormats } from '../state/initial-state.ts';
import type { NamedNumberFormatChoice } from './number-format-choices-values.ts';
import { NUMBER_FORMAT_CHOICE_PATTERNS } from './number-format-choices-values.ts';
import { EN_US_LOCALE } from './number-signs.ts';
import { isFormulaCell, DEFAULT_LOCALE_PATTERNS } from '../model/workbook.ts';
import { isInSpan, rowPanes, shownRowIndicesInPane, columnPanes, shownColumnIndicesInPane } from '../grid/geometry.ts';
import { isCheckboxFormat } from '../chips/checkboxes.ts';
import { cellValueOf } from '../model/cell-values.ts';
import { readsWithUnansweredEntries } from '../editor/unanswered-entries.ts';
import { layoutOfView } from '../grid/layout.ts';
import { areasOfAllRanges } from '../selection/several-ranges.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { PageState } from '../state/initial-state.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
export type { NamedNumberFormatChoice } from './number-format-choices-values.ts';
/** A currency the number format menu offers by its code, beside the locale's own. */
export type CurrencyCode = (typeof CURRENCY_CODES)[number];
/** A number format the number format menu offers by name: one with a pattern of its own, or a foreign currency. */
export type NumberFormatChoice = NamedNumberFormatChoice | CurrencyCode;
/** A number format the menu offers by name, or a control (dropdown, checkbox) cells can take. */
export type NumberFormatOrControlChoice = NumberFormatChoice | 'dropdown' | 'checkbox';
/** An entry of the number format menu: a choice of its own, a group of choices, or the custom format. */
export type NumberFormatMenuEntry = 'general' | 'text' | NumberFormatGroup | 'customFormat';
/** The type of cells the number format menu names: a group of formats, or a format or control that stands alone. */
export type CellType = NumberFormatGroup | 'general' | 'text' | 'checkbox' | 'dropdown' | 'person';
/** Which cells a choice can be given to: any, or only those that hold no formula. */
export type CellsAChoiceAppliesTo = 'any' | 'withoutFormula';
/** The format cells are shown in, named as the number format menu names it, and the choice it is when it is one. */
export interface FormatChoiceOfCells {
  name: CellFormatChoiceName;
  choice: NumberFormatOrControlChoice | null;
}
/** Where a section of a pattern writes its decimal places: the `.` (or the place for one) and how many characters follow. */
export interface DecimalPlacesSpan {
  at: number;
  length: number;
}
/** A section of a number format pattern between `;`, and where it writes its decimal places. */
export interface PatternSection {
  text: string;
  places: DecimalPlacesSpan | null;
}
/** The patterns a workbook's locale gives the choices that depend on it. */
export type PatternsOfChoices = Pick<WorkbookReads, 'locale' | 'patternOfATimeOfDay' | 'patternsOfItsLocale'>;
/** What numbers show under a pattern being typed; `null` where the pattern could not be read for that number. */
export type ShownUnderPattern = Map<number, ShownValue | null>;
export function decimalPlacesSpan(section: string, isFirst: boolean): DecimalPlacesSpan | null {
  let exponentAt = section.search(/e[+-]/i);
  let mantissa = exponentAt === -1 ? section : section.slice(0, exponentAt);
  if (/[a-z@/]/i.test(mantissa)) return null;
  let pointAt = mantissa.indexOf('.');
  if (pointAt !== -1)
    return {
      at: pointAt,
      length: /^\.[0#?]*/.exec(mantissa.slice(pointAt))?.[0].length ?? 1,
    };
  let lastDigitEnd = mantissa.search(/[0#?][^0#?]*$/) + 1;
  return (isFirst ? lastDigitEnd > 0 : /[0#]/.test(mantissa))
    ? {
        at: lastDigitEnd,
        length: 0,
      }
    : null;
}
export function patternSections(pattern: string): PatternSection[] {
  let offset = 0;
  return blankOutLiterals(pattern)
    .split(';')
    .map((blankedSection, index) => {
      let section = pattern.slice(offset, offset + blankedSection.length);
      offset += blankedSection.length + 1;
      return {
        text: section,
        places: decimalPlacesSpan(blankedSection, index === 0),
      };
    });
}
export function decimalPlacesOfPattern(pattern: string): number | null {
  let places = patternSections(pattern)[0]?.places ?? null;
  return places === null ? null : Math.max(0, places.length - 1);
}
export function withDecimalPlacesInSection(section: string, { at, length: placesLength }: DecimalPlacesSpan, decimals: number): string {
  let digit = /^\?+$/.test(section.slice(at + 1, at + placesLength)) ? '?' : '0';
  let leadingZero = /[0#?]/.test(blankOutLiterals(section).slice(0, at)) ? '' : '0';
  return section.slice(0, at) + (decimals === 0 ? leadingZero : `.${digit.repeat(decimals)}`) + section.slice(at + placesLength);
}
export function withDecimalPlaces(pattern: string, decimals: number): string {
  let sections = patternSections(pattern);
  if ((sections[0]?.places ?? null) === null) return pattern;
  return sections
    .map(({ text, places }) => (places === null ? text : withDecimalPlacesInSection(text, places, decimals)))
    .join(';');
}
export function currencyFormatOf(currency: CurrencyCode, locale: string): Intl.NumberFormat {
  let currencyStyle: Intl.NumberFormatOptions = {
    style: 'currency',
    currency,
  };
  try {
    return new Intl.NumberFormat([locale, EN_US_LOCALE], currencyStyle);
  } catch {
    return new Intl.NumberFormat(EN_US_LOCALE, currencyStyle);
  }
}
export function currencyPatternOf(currency: CurrencyCode, locale: string, patternOfLocale: string): string {
  let cacheKey = `${currency} ${locale} ${patternOfLocale}`;
  let known = currencyPatternsKnown.get(cacheKey);
  if (known !== undefined) return known;
  let money = currencyFormatOf(currency, locale);
  let symbol = money.formatToParts(1).find(({ type }) => type === 'currency')?.value ?? currency;
  let written = symbol === '$' ? symbol : `[$${symbol}]`;
  let withSymbol = patternOfLocale
    .replaceAll(CURRENCY_BEFORE_NUMBER, (_whole: string, gap: string) => `${written}${/\p{L}$/u.test(symbol) ? ' ' : gap}`)
    .replaceAll(CURRENCY_AFTER_NUMBER, (_whole: string, gap: string) => `${/^\p{L}/u.test(symbol) ? ' ' : gap}${written}`);
  let pattern = withDecimalPlaces(withSymbol, money.resolvedOptions().maximumFractionDigits ?? 2);
  currencyPatternsKnown.set(cacheKey, pattern);
  return pattern;
}
export function patternOfChoice(
  choice: NumberFormatChoice,
  { locale, patternOfATimeOfDay, patternsOfItsLocale }: PatternsOfChoices,
): string {
  if (choice === 'time') return patternOfATimeOfDay;
  if (choice === 'dateAndTime') return `${NUMBER_FORMAT_CHOICE_PATTERNS.date.pattern} ${patternOfATimeOfDay}`;
  if (isCurrencyCodeOffered(choice)) return currencyPatternOf(choice, locale, patternsOfItsLocale.roundedCurrency);
  return isLocaleDependentChoice(choice) ? patternsOfItsLocale[choice] : NUMBER_FORMAT_CHOICE_PATTERNS[choice].pattern;
}
export function sampleValueOfFormatKind(formatKind: NumberFormatKind): number {
  switch (formatKind) {
    case 'percent':
      return 0.125;
    case 'date':
    case 'time':
    case 'dateAndTime':
      return SAMPLE_DATE_TIME_SERIAL;
    case 'duration':
      return 1.0423958333333334;
    case 'general':
    case 'number':
    case 'currency':
    case 'scientific':
    case 'fraction':
    case 'text':
      return 1234.5;
  }
}
export function numberFormatExamples(reads: WorkbookReads): ExamplesOfNumberFormats {
  let { locale } = reads;
  if (locale === EN_US_LOCALE)
    return {
      locale,
      byChoice: new Map<NumberFormatChoice, string>(),
    };
  let examples = NUMBER_FORMAT_CHOICES.flatMap((choice): [NumberFormatChoice, string][] => {
    if (choice === 'text') return [];
    let sign = choice === 'numberInParentheses' ? -1 : 1;
    let read = reads.patternRead(
      patternOfChoice(choice, reads),
      (formatKind) => sign * sampleValueOfFormatKind(formatKind),
    );
    return read?.kind === 'numberFormat' && read.shown.kind === 'text' ? [[choice, read.shown.text]] : [];
  });
  return {
    locale,
    byChoice: new Map(examples),
  };
}
export function withNumberFormatExamples(state: PageState, reads: WorkbookReads): PageState {
  return state.examplesOfNumberFormats.locale === reads.locale
    ? state
    : {
        ...state,
        examplesOfNumberFormats: numberFormatExamples(reads),
      };
}
export function groupOfChoice(
  choice: NumberFormatOrControlChoice | 'person' | null,
): NumberFormatGroup | NumberFormatOrControlChoice | 'person' | null {
  let hasChoice = (group: NumberFormatGroup) => NUMBER_FORMAT_GROUPS[group].some((member) => member === choice);
  return NUMBER_FORMAT_GROUP_NAMES.find(hasChoice) ?? choice;
}
export function choicesOfGroup(group: CellType): NumberFormatChoice[] {
  let groupName = NUMBER_FORMAT_GROUP_NAMES.find((name) => name === group);
  return groupName === undefined ? [] : NUMBER_FORMAT_GROUPS[groupName];
}
export function choicesForCells(workbook: WorkbookReads, sheetId: SheetId, area: CellArea): NumberFormatOrControlChoice[] {
  let cells = workbook.cellsOnShowIn(sheetId, area).filter((cell) => isFormulaCell(workbook, cell));
  return CELL_FORMAT_CHOICES.filter((choice) =>
    isCurrencyCodeOffered(choice)
      ? choiceOfPattern(patternOfChoice(choice, workbook), workbook) === choice
      : CHOICE_APPLIES_TO[choice] === 'any' || cells.every((cell) => workbook.formatOf(cell).cellControl.kind === choice),
  );
}
export function hasCellsNotSpilledIn(workbook: WorkbookReads, sheetId: SheetId, area: CellArea): boolean {
  let isInArea = ({ topRowIndex, leftColumnIndex }: CellArea) =>
    isInSpan(topRowIndex, area.topRowIndex, area.rowCount) && isInSpan(leftColumnIndex, area.leftColumnIndex, area.columnCount);
  return (
    workbook.cellsOnShowIn(sheetId, area).filter((cell) => {
      let spillArea = workbook.cellOf(cell) === null ? workbook.spillOver(cell)?.area : undefined;
      return spillArea !== undefined && !isInArea(spillArea);
    }).length <
    area.rowCount * area.columnCount
  );
}
export function choiceOfPatternIgnoringDecimals(pattern: string, patterns: PatternsOfChoices): NumberFormatChoice | null {
  let wholePattern = withDecimalPlaces(pattern, 0);
  return NUMBER_FORMAT_CHOICES.find((choice) => withDecimalPlaces(patternOfChoice(choice, patterns), 0) === wholePattern) ?? null;
}
export function formatChoiceOf(format: SharedCellFormat, patterns: PatternsOfChoices): FormatChoiceOfCells {
  let { numberFormat, cellControl } = format;
  if (cellControl?.kind === 'dropdown')
    return {
      name: 'dropdown',
      choice: 'dropdown',
    };
  if (isCheckboxFormat(format))
    return {
      name: 'checkbox',
      choice: 'checkbox',
    };
  if (numberFormat === null || cellControl === null) return MIXED_FORMAT_CHOICE;
  let { kind, pattern } = numberFormat;
  let choice = choiceOfPattern(pattern, patterns) ?? choiceOfPatternIgnoringDecimals(pattern, patterns);
  return {
    name: choice ?? kind,
    choice,
  };
}
export function withShownUnderPattern<Cell extends ShownCell>(cell: Cell | null, shownByValue: ShownUnderPattern): Cell | null {
  let value = cellValueOf(cell);
  let shown = value?.kind === 'number' ? shownByValue.get(value.value) : undefined;
  return cell === null || shown === undefined || shown === null
    ? cell
    : {
        ...cell,
        shown,
      };
}
export function numbersInSelection(state: PageState, workbook: ReadsWithTextMeasurer): Set<number> {
  let numbers = new Set<number>();
  let { sheetId } = state;
  if (state.activeCell.sheetId !== sheetId) return numbers;
  let reads = readsWithUnansweredEntries(workbook, state);
  let layout = layoutOfView(state, workbook);
  let shownRows = rowPanes(state, layout, state).flatMap((pane) => shownRowIndicesInPane(pane, layout));
  let shownColumns = columnPanes(state, layout, state).flatMap((pane) => shownColumnIndicesInPane(pane, layout));
  let addNumberAt = (rowIndex: number, columnIndex: number) => {
    let cellId = reads.cellIdAt(sheetId, rowIndex, columnIndex);
    if (cellId === null) return;
    let cellValue = cellValueOf(reads.cellOf(cellId) ?? reads.spilledCellOf(cellId));
    if (cellValue?.kind === 'number') numbers.add(cellValue.value);
  };
  for (let area of areasOfAllRanges(state, reads)) {
    let rowsInArea = shownRows.filter((rowIndex) => isInSpan(rowIndex, area.topRowIndex, area.rowCount));
    let columnsInArea = shownColumns.filter(
      (columnIndex) => isInSpan(columnIndex, area.leftColumnIndex, area.columnCount),
    );
    let [topRow, leftColumn] = [rowsInArea[0], columnsInArea[0]];
    if (topRow === undefined || leftColumn === undefined) continue;
    for (let rowIndex of rowsInArea) for (let columnIndex of columnsInArea) addNumberAt(rowIndex, columnIndex);
    let shownArea = {
      topRowIndex: topRow,
      leftColumnIndex: leftColumn,
      rowCount: (rowsInArea.at(-1) ?? topRow) - topRow + 1,
      columnCount: (columnsInArea.at(-1) ?? leftColumn) - leftColumn + 1,
    };
    for (let overlappingMerge of reads.mergedAreasIn(sheetId, shownArea)) addNumberAt(overlappingMerge.topRowIndex, overlappingMerge.leftColumnIndex);
  }
  return numbers;
}
export function refreshShownUnderPattern(before: PageState, state: PageState, reads: ReadsWithTextMeasurer): PageState {
  let customNumberFormat = state.customNumberFormat;
  if (customNumberFormat === null || !isAgentWrittenListPattern(state)) return state;
  let shown: ShownUnderPattern =
    state.workbookChangeCount === before.workbookChangeCount && state.formulasWorkedOutCount === before.formulasWorkedOutCount
      ? customNumberFormat.shownUnderPattern
      : EMPTY_SHOWN_UNDER_PATTERN;
  let newNumbers = [...numbersInSelection(state, reads)].filter((number) => !shown.has(number));
  if (newNumbers.length === 0 && shown === customNumberFormat.shownUnderPattern) return state;
  let shownUnderPattern = new Map(shown);
  for (let number of newNumbers) {
    let read = reads.patternRead(customNumberFormat.pattern, () => number);
    shownUnderPattern.set(number, read?.kind === 'numberFormat' ? read.shown : null);
  }
  return {
    ...state,
    customNumberFormat: {
      ...customNumberFormat,
      shownUnderPattern,
    },
  };
}
export const MAX_DECIMAL_PLACES = 30;
export const ELAPSED_TIME_BRACKET = /^\[[hms]+\]$/i;
export const blankOutLiterals = (pattern: string): string =>
  pattern.replaceAll(
    /"[^"]*"|[\\_*].|\[[^\]]*\]/gsu,
    (part) => (ELAPSED_TIME_BRACKET.test(part) ? part : ' '.repeat(part.length)),
  );
export const CURRENCY_CODES = [
  'USD',
  'EUR',
  'JPY',
  'GBP',
  'CNY',
  'CHF',
  'AUD',
  'CAD',
  'HKD',
  'SGD',
  'INR',
  'KRW',
  'SEK',
  'MXN',
  'NZD',
  'NOK',
  'TWD',
  'BRL',
  'ZAR',
  'PLN',
] as const;
export const isCurrencyCodeOffered = (choice: string | null | undefined): choice is CurrencyCode =>
  CURRENCY_CODES.some((code) => code === choice);
export const CURRENCY_BEFORE_NUMBER = /(?:\[\$[^\]]*\]|\$)( ?)(?=-?#)/g;
export const CURRENCY_AFTER_NUMBER = /(?<=0)( ?)(?:\[\$[^\]]*\]|\$)/g;
export const currencyPatternsKnown = new Map<string, string>();
export const NUMBER_FORMAT_CHOICES_BUT_CURRENCY_CODES: NamedNumberFormatChoice[] = [
  'general',
  'number',
  'roundedNumber',
  'numberInParentheses',
  'currency',
  'roundedCurrency',
  'percent',
  'roundedPercent',
  'scientific',
  'date',
  'mediumDate',
  'longDate',
  'monthAndDay',
  'monthAndYear',
  'time',
  'dateAndTime',
  'duration',
  'text',
];
export const NUMBER_FORMAT_CHOICES: NumberFormatChoice[] = [...NUMBER_FORMAT_CHOICES_BUT_CURRENCY_CODES, ...CURRENCY_CODES];
export const isLocaleDependentChoice = (choice: NumberFormatChoice): choice is keyof LocalePatterns => choice in DEFAULT_LOCALE_PATTERNS;
export const PHONE_NUMBER_FORMAT = {
  pattern: '[<=9999999]###-####;(###) ###-####',
  example: '(555) 555-1234',
};
export const isNorthAmericanLocale = (locale: string): boolean => /-(?:US|CA)$/.test(locale);
export const SAMPLE_DATE_TIME_SERIAL = 46096.604166666664;
export const defaultExampleOfChoice = (choice: NumberFormatChoice): string =>
  isCurrencyCodeOffered(choice)
    ? currencyFormatOf(choice, EN_US_LOCALE).format(sampleValueOfFormatKind('currency')).replace(/\s/u, ' ')
    : NUMBER_FORMAT_CHOICE_PATTERNS[choice].example;
export const exampleOfChoice = ({ byChoice }: ExamplesOfNumberFormats, choice: NumberFormatChoice): string =>
  byChoice.get(choice) ?? defaultExampleOfChoice(choice);
export const numberFormatOfChoice = (choice: NumberFormatChoice, patterns: PatternsOfChoices): NumberFormat => ({
  pattern: patternOfChoice(choice, patterns),
});
export const CELL_FORMAT_CHOICES: NumberFormatOrControlChoice[] = [...NUMBER_FORMAT_CHOICES, 'dropdown', 'checkbox'];
export const NUMBER_FORMAT_GROUPS: Record<NumberFormatGroup, NumberFormatChoice[]> = {
  numbers: ['number', 'roundedNumber', 'numberInParentheses', 'scientific'],
  percents: ['percent', 'roundedPercent'],
  currencies: ['currency', 'roundedCurrency', ...CURRENCY_CODES],
  datesAndTimes: ['date', 'mediumDate', 'longDate', 'monthAndDay', 'monthAndYear', 'time', 'dateAndTime', 'duration'],
};
export const FIRST_CHOICE_OF_GROUP: Record<NumberFormatGroup, NamedNumberFormatChoice> = {
  numbers: 'number',
  percents: 'percent',
  currencies: 'currency',
  datesAndTimes: 'date',
};
export const NUMBER_FORMAT_GROUP_NAMES: NumberFormatGroup[] = ['numbers', 'percents', 'currencies', 'datesAndTimes'];
export const NUMBER_FORMAT_MENU_SECTIONS: NumberFormatMenuEntry[][] = [['general', 'text'], NUMBER_FORMAT_GROUP_NAMES, ['customFormat']];
export const NUMBER_FORMAT_MENU_CHOICES: (NamedNumberFormatChoice | 'customFormat')[] = [
  ...NUMBER_FORMAT_CHOICES_BUT_CURRENCY_CODES,
  'customFormat',
];
export const GROUP_OF_CELL_TYPE: Partial<Record<CellFormatChoiceName | 'person', CellType>> = {
  general: 'general',
  text: 'text',
  fraction: 'numbers',
  checkbox: 'checkbox',
  dropdown: 'dropdown',
  person: 'person',
};
export const cellTypeOfChoice = (choice: CellFormatChoiceName | 'person'): CellType | null =>
  NUMBER_FORMAT_GROUP_NAMES.find((group) => NUMBER_FORMAT_GROUPS[group].some((member) => member === choice)) ??
  GROUP_OF_CELL_TYPE[choice] ??
  null;
export const CHOICE_APPLIES_TO: Record<Exclude<NumberFormatOrControlChoice, CurrencyCode>, CellsAChoiceAppliesTo> = {
  general: 'any',
  text: 'any',
  number: 'any',
  roundedNumber: 'any',
  numberInParentheses: 'any',
  currency: 'any',
  roundedCurrency: 'any',
  percent: 'any',
  roundedPercent: 'any',
  scientific: 'any',
  date: 'any',
  mediumDate: 'any',
  longDate: 'any',
  monthAndDay: 'any',
  monthAndYear: 'any',
  time: 'any',
  dateAndTime: 'any',
  duration: 'any',
  dropdown: 'withoutFormula',
  checkbox: 'any',
};
export const choiceOfPattern = (pattern: string, patterns: PatternsOfChoices): NumberFormatChoice | null =>
  NUMBER_FORMAT_CHOICES.find((choice) => patternOfChoice(choice, patterns) === pattern) ?? null;
export const MIXED_FORMAT_CHOICE: FormatChoiceOfCells = {
  name: 'mixed',
  choice: null,
};
export const EMPTY_SHOWN_UNDER_PATTERN: ShownUnderPattern = new Map();
export const isAgentWrittenListPattern = ({ customNumberFormat }: Pick<PageState, 'customNumberFormat'>): boolean =>
  customNumberFormat?.typedIn === 'list' && customNumberFormat.agent?.kind === 'wrote' && customNumberFormat.reading.kind === 'numberFormat';
export const shownUnderPatternOf = (state: PageState): ShownUnderPattern | null =>
  isAgentWrittenListPattern(state) ? (state.customNumberFormat?.shownUnderPattern ?? null) : null;
export const CUSTOM_FORMAT_PLACEHOLDERS = {
  withDecimals: '#,##0.00',
  withUnit: '0.0 "kg"',
  withUnitAndDecimals: '0.00 "kg"',
};
export const UNREADABLE_PATTERN_REFUSALS: ReadonlySet<string> = new Set<PatternRefusal>([
  'patternTooLong',
  'patternHoldsControlCharacter',
  'quoteNotClosed',
  'nothingAfterEscape',
  'bracketNotClosed',
  'bracketNotKnown',
  'tooManySections',
  'textSectionNotLast',
  'fourthSectionNotForText',
  'colorOutOfPlace',
  'conditionOutOfPlace',
  'currencyOrLanguageNamedTwice',
  'sectionMixesKinds',
  'secondDecimalPoint',
  'commaOutOfPlace',
  'exponentNotWellFormed',
  'fractionNotWellFormed',
  'textPlacedTwice',
  'secondFill',
  'elapsedTimeNotWellFormed',
  'tooManyDecimalsOfASecond',
]);
export { NUMBER_FORMAT_CHOICE_PATTERNS } from './number-format-choices-values.ts';
