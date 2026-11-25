/**
 * Requests that read no workbook: how a value is shown under a number format,
 * what a typed day or a time zone name stands for, which locales and patterns
 * there are, how texts read under a column reading, and what the shared code
 * holds. Each is sent as `{"kind": …}` and answered `{"kind": …}`, or
 * `{"kind": "refused", "refusal": …}`.
 *
 * Where a request takes `locale`, leaving it out means `en-US`; a locale the
 * engine does not know is refused.
 */

import type { ListLine } from './ops.ts';
import type { NumberFormatKind, ShownValue } from './reads.ts';

// ---------------------------------------------------------------------------
// Values and rooms
// ---------------------------------------------------------------------------

/** An error a cell can hold. */
export type ErrorValue =
  | '#NULL!'
  | '#DIV/0!'
  | '#VALUE!'
  | '#REF!'
  | '#NAME?'
  | '#NUM!'
  | '#N/A'
  | '#SPILL!'
  | '#ERROR!'
  | '#TIMEOUT!';

/** A value to show. */
export type ValueIn =
  | { kind: 'number'; value: number }
  | { kind: 'text'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'error'; value: ErrorValue };

/** Where a value is shown: as text of any length, or in a cell holding at most so many characters. */
export type RoomIn =
  | { kind: 'asText' }
  | { kind: 'inACell'; mostCharacters: number };

/** A number format, told by its pattern. */
export interface NumberFormatIn {
  pattern: string;
}

/** Why a pattern of a number format is refused. */
export type PatternRefusal =
  | 'patternEmpty'
  | 'patternTooLong'
  | 'patternHoldsControlCharacter'
  | 'quoteNotClosed'
  | 'nothingAfterEscape'
  | 'bracketNotClosed'
  | 'bracketNotKnown'
  | 'characterNeedsQuotes'
  | 'tooManySections'
  | 'textSectionNotLast'
  | 'fourthSectionNotForText'
  | 'colorOutOfPlace'
  | 'conditionOutOfPlace'
  | 'currencyOrLanguageNamedTwice'
  | 'sectionMixesKinds'
  | 'secondDecimalPoint'
  | 'commaOutOfPlace'
  | 'exponentNotWellFormed'
  | 'fractionNotWellFormed'
  | 'textPlacedTwice'
  | 'secondFill'
  | 'elapsedTimeNotWellFormed'
  | 'tooManyDecimalsOfASecond';

// ---------------------------------------------------------------------------
// Column readings
// ---------------------------------------------------------------------------

/** The sign between whole numbers and decimals. */
export type DecimalSign = 'point' | 'comma';

/** The order a date is typed in. */
export type DateOrder = 'yearMonthDay' | 'dayMonthYear' | 'monthDayYear';

/** How a date read is shown. */
export type DateShownAs = 'yearMonthDay' | 'monthNameDayYear';

/** What a number typed without `%` stands for in a percent column. */
export type NumberAloneIs = 'percents' | 'aShareOfOne';

/** How the texts of a column are read. */
export type ColumnReading =
  | { kind: 'text' }
  | {
      kind: 'number';
      decimalSign: DecimalSign;
      /** 0 to 6. */
      decimalPlaces: number;
      groupsThousands: boolean;
    }
  | {
      kind: 'currency';
      decimalSign: DecimalSign;
      /** 0 to 6. */
      decimalPlaces: number;
      /** One to four letters or currency signs. */
      symbol: string;
    }
  | {
      kind: 'percent';
      decimalSign: DecimalSign;
      /** 0 to 6. */
      decimalPlaces: number;
      numberAloneIs: NumberAloneIs;
    }
  | { kind: 'date'; order: DateOrder; shownAs: DateShownAs }
  | { kind: 'dateAndTime'; order: DateOrder; shownAs: DateShownAs }
  | { kind: 'timeOfDay' }
  | { kind: 'dropdown'; isColored: boolean };

/** What a text entered under a column reading is read as. */
export type ReadInput =
  | { kind: 'number'; value: number }
  | { kind: 'text'; value: string };

/** How one text reads under a column reading. */
export type ReadText =
  | { kind: 'fits'; input: ReadInput; numberFormat: NumberFormatIn | null }
  | { kind: 'doesNotFit' }
  | { kind: 'blank' };

/** How the texts fit one of the readings asked about. Blank texts count for neither. */
export interface FitOfAColumnReading {
  fitting: number;
  notFitting: number;
  /** Positions of the first texts that do not fit, at most five. */
  firstNotFitting: number[];
  /** For a dropdown reading, how many different labels the texts give. */
  options: number | null;
  /** The first earlier reading of the same kind that reads every text the same. */
  sameAsReading: number | null;
}

/** A list line as a workbook keeps it, with its number when it is numbered. */
export interface ListLineAsKept {
  list: ListLine;
  number: number | null;
}

// ---------------------------------------------------------------------------
// Shared code
// ---------------------------------------------------------------------------

/** How wide text is reckoned to be. */
export interface WidthsOfNumbers {
  pixelsInTenPoints: number;
  widthOfADigit: number;
  widthOfABoldDigit: number;
  aroundTheTextInPixels: number;
  /** Characters half as wide as a digit. */
  halfAsWideAsADigit: string;
  /** Characters no wider than a digit. */
  noWiderThanADigit: string;
  widthOfAnyOtherCharacter: number;
}

/** The limits a workbook keeps to. */
export interface SharedLimits {
  mostCells: number;
  mostBytesOfCopiedCells: number;
  mostBytesOfATableToImport: number;
  longestSheetNameInCharacters: number;
  longestDropdownOptionInCharacters: number;
  mostOptionsInADropdown: number;
  mostUsersInACell: number;
  narrowestColumnInPixels: number;
  widestColumnInPixels: number;
  shortestRowInPixels: number;
  tallestRowInPixels: number;
  smallestFontSizeInPoints: number;
  largestFontSizeInPoints: number;
  deepestGroup: number;
  deepestLevelOfAListLine: number;
  mostConditionalFormats: number;
  mostRangesInAConditionalFormat: number;
  mostTestsInAConditionalFormat: number;
  longestTextOfAConditionInCharacters: number;
  largestCountInACondition: number;
  smallestSideOfAPlacementInPixels: number;
  largestSideOfAPlacementInPixels: number;
  largestOffsetOfAPlacementInPixels: number;
  mostCheckboxesOfOneInsert: number;
  mostEditsInAStep: number;
  mostNamedViewsInASheet: number;
  longestNameOfANamedViewInCharacters: number;
}

/** What chart code (SVG) may hold. */
export interface WhatChartCodeMayHold {
  tagsDrawn: string[];
  /** Tags kept out of the drawing. */
  tagsLeftOut: string[];
  attributesOfWords: string[];
  attributesOfPlaceAndPaint: string[];
  mostShapes: number;
  mostShapesOfWords: number;
  mostTooltips: number;
}

// ---------------------------------------------------------------------------
// Requests and answers
// ---------------------------------------------------------------------------

export interface DescribeSharedCodeRequest {
  kind: 'describeSharedCode';
}
/** The numbers the engine and the page share. */
export interface SharedCodeDescription {
  kind: 'sharedCodeDescription';
  newestFormatVersion: number;
  defaultColumnWidthInPixels: number;
  widthsOfNumbers: WidthsOfNumbers;
  limits: SharedLimits;
  workbookContentsVersion: number;
}

/** How a value is shown under a number format (or under General when `numberFormat` is null). */
export interface ReadShownValueRequest {
  kind: 'readShownValue';
  value: ValueIn;
  numberFormat: NumberFormatIn | null;
  room: RoomIn;
  locale?: string;
}
export interface ShownValueAnswer {
  kind: 'shownValue';
  shown: ShownValue;
}

/** The day a typed text stands for. */
export interface ReadTypedDayRequest {
  kind: 'readTypedDay';
  text: string;
  locale?: string;
}
export interface TypedDayAnswer {
  kind: 'typedDay';
  /** `yyyy-mm-dd`, or null when the text is no day. */
  day: string | null;
}

/** Every time zone the engine knows. */
export interface ReadTimeZonesRequest {
  kind: 'readTimeZones';
}
export interface TimeZonesAnswer {
  kind: 'timeZones';
  timeZones: string[];
}

/** The time zone a name stands for, its other names leading to it. */
export interface ReadTimeZoneNamedRequest {
  kind: 'readTimeZoneNamed';
  name: string;
}
export interface TimeZoneNamedAnswer {
  kind: 'timeZoneNamed';
  timeZone: string | null;
}

/** Every locale the engine knows. */
export interface ReadLocalesRequest {
  kind: 'readLocales';
}
export interface LocalesAnswer {
  kind: 'locales';
  locales: string[];
  localeOfANewWorkbook: string;
}

/** Patterns for money in a locale. */
export interface ReadPatternsOfMoneyRequest {
  kind: 'readPatternsOfMoney';
  locale?: string;
}
export interface PatternsOfMoneyAnswer {
  kind: 'patternsOfMoney';
  withTwoDecimals: string;
  withNoDecimals: string;
}

/** Patterns for dates with the month named, in a locale. */
export interface ReadPatternsOfDatesWithTheMonthNamedRequest {
  kind: 'readPatternsOfDatesWithTheMonthNamed';
  locale?: string;
}
export interface PatternsOfDatesWithTheMonthNamedAnswer {
  kind: 'patternsOfDatesWithTheMonthNamed';
  withTheMonthInFull: string;
  withTheMonthForShort: string;
  monthAndDay: string;
  monthAndYear: string;
}

/** A formula's text as written in a locale. */
export interface ReadFormulaTextInLocaleRequest {
  kind: 'readFormulaTextInLocale';
  text: string;
  locale?: string;
}
export interface FormulaTextInLocaleAnswer {
  kind: 'formulaTextInLocale';
  text: string;
}

/** The kind of number format a pattern makes. */
export interface ReadKindOfPatternRequest {
  kind: 'readKindOfPattern';
  pattern: string;
}
export interface KindOfPatternAnswer {
  kind: 'kindOfPattern';
  numberFormatKind: NumberFormatKind;
}

/** How texts read under one column reading. */
export interface ReadTextsUnderAColumnReadingRequest {
  kind: 'readTextsUnderAColumnReading';
  reading: ColumnReading;
  texts: string[];
  locale?: string;
}
export interface TextsUnderAColumnReadingAnswer {
  kind: 'textsUnderAColumnReading';
  /** One for each text, in order. */
  read: ReadText[];
  /** The number format the column takes under the reading. */
  numberFormat: NumberFormatIn | null;
}

/** How well texts fit each of several column readings. */
export interface ReadFitOfColumnReadingsRequest {
  kind: 'readFitOfColumnReadings';
  readings: ColumnReading[];
  texts: string[];
  locale?: string;
}
export interface FitOfColumnReadingsAnswer {
  kind: 'fitOfColumnReadings';
  /** One for each reading, in order. */
  fits: FitOfAColumnReading[];
}

/** The option labels a dropdown column of these texts would have. */
export interface ReadLabelsOfADropdownColumnRequest {
  kind: 'readLabelsOfADropdownColumn';
  texts: string[];
}
export interface LabelsOfADropdownColumnAnswer {
  kind: 'labelsOfADropdownColumn';
  labels: string[];
}

/** List lines as a workbook would keep them, one after another, with their numbers. */
export interface ReadListLinesAsKeptRequest {
  kind: 'readListLinesAsKept';
  lists: ListLine[];
}
export interface ListLinesAsKeptAnswer {
  kind: 'listLinesAsKept';
  /** One for each line, in order. */
  lines: ListLineAsKept[];
}

/** What chart code may hold. */
export interface ReadWhatChartCodeMayHoldRequest {
  kind: 'readWhatChartCodeMayHold';
}
export interface WhatChartCodeMayHoldAnswer {
  kind: 'whatChartCodeMayHold';
  mayHold: WhatChartCodeMayHold;
}

/** Each utility request by its kind, with its answer when it is not refused. */
export interface UtilityKinds {
  describeSharedCode: { request: DescribeSharedCodeRequest; answer: SharedCodeDescription };
  readShownValue: { request: ReadShownValueRequest; answer: ShownValueAnswer };
  readTypedDay: { request: ReadTypedDayRequest; answer: TypedDayAnswer };
  readTimeZones: { request: ReadTimeZonesRequest; answer: TimeZonesAnswer };
  readTimeZoneNamed: { request: ReadTimeZoneNamedRequest; answer: TimeZoneNamedAnswer };
  readLocales: { request: ReadLocalesRequest; answer: LocalesAnswer };
  readPatternsOfMoney: { request: ReadPatternsOfMoneyRequest; answer: PatternsOfMoneyAnswer };
  readPatternsOfDatesWithTheMonthNamed: {
    request: ReadPatternsOfDatesWithTheMonthNamedRequest;
    answer: PatternsOfDatesWithTheMonthNamedAnswer;
  };
  readFormulaTextInLocale: {
    request: ReadFormulaTextInLocaleRequest;
    answer: FormulaTextInLocaleAnswer;
  };
  readKindOfPattern: { request: ReadKindOfPatternRequest; answer: KindOfPatternAnswer };
  readTextsUnderAColumnReading: {
    request: ReadTextsUnderAColumnReadingRequest;
    answer: TextsUnderAColumnReadingAnswer;
  };
  readFitOfColumnReadings: {
    request: ReadFitOfColumnReadingsRequest;
    answer: FitOfColumnReadingsAnswer;
  };
  readLabelsOfADropdownColumn: {
    request: ReadLabelsOfADropdownColumnRequest;
    answer: LabelsOfADropdownColumnAnswer;
  };
  readListLinesAsKept: { request: ReadListLinesAsKeptRequest; answer: ListLinesAsKeptAnswer };
  readWhatChartCodeMayHold: {
    request: ReadWhatChartCodeMayHoldRequest;
    answer: WhatChartCodeMayHoldAnswer;
  };
}

export type UtilityKind = keyof UtilityKinds;

/** Any utility request. */
export type UtilityRequest = { [K in UtilityKind]: UtilityKinds[K]['request'] }[UtilityKind];

// ---------------------------------------------------------------------------
// Function descriptions
// ---------------------------------------------------------------------------

/** The family a function belongs to. */
export type FunctionFamily =
  | 'math'
  | 'statistical'
  | 'logical'
  | 'lookup'
  | 'text'
  | 'dateAndTime'
  | 'financial';

/** What an argument takes. */
export type ArgumentTakes = 'oneValue' | 'severalCells' | 'onlyThePlace' | 'aName';

/** What an error in an argument does. */
export type ErrorInArgument = 'isTheAnswer' | 'mayBePassedOver' | 'mayBeCaughtOrNeverRead';

/** What a function answers. */
export type FunctionAnswers = 'oneValue' | 'anArgumentAsItCame' | 'partOfAnArgument' | 'anArray';

/** One argument of a function. */
export interface FunctionArgument {
  name: string;
  isOptional: boolean;
  repeats: boolean;
  isHidden: boolean;
  takes: ArgumentTakes;
  errorInIt: ErrorInArgument;
}

/** One function a formula can call. */
export interface FunctionDescription {
  name: string;
  family: FunctionFamily;
  description: string;
  isCommon: boolean;
  arguments: FunctionArgument[];
  answers: FunctionAnswers;
  /** Whether it may answer `#N/A` with no `#N/A` in its arguments (a lookup that finds nothing, `NA()`). */
  canBeNotAvailableByItself: boolean;
}

/** Every function a formula can call, with the families in the order they are shown. */
export interface FunctionDescriptions {
  families: FunctionFamily[];
  functions: FunctionDescription[];
}
