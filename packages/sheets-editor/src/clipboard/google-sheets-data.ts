import type { ValueOfAnotherProgram } from '@open-artifact/sheets-core';

/** An object read from JSON: its fields are whatever the JSON held. */
export interface JsonObject {
  [key: string]: unknown;
}

/** A cell read from the data another program put on the clipboard beside its HTML. */
export interface CellDataOfAnotherProgram {
  value: ValueOfAnotherProgram | null;
  isError: boolean;
  /** Its formula, its references by offsets from its cell. */
  formulaByOffsets: string | null;
  numberFormatPattern: string | null;
}

export interface GoogleSheetsClipboard {
  rowCount: number;
  columnCount: number;
  cells: CellDataOfAnotherProgram[];
}

export interface SequenceReader<Item> {
  next: () => Item | undefined;
  isAtEnd: () => boolean;
}

export function expandRunLengths(json: unknown, most: number): number[] | null {
  const items = optionalJsonArray(json);
  if (items === null) return null;
  const expanded: number[] = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const isRun = typeof item === 'number' && item < 0;
    const runLength = isRun ? -item : 1;
    const runValue = isRun ? items[(index += 1)] : item;
    if (!isJsonCount(runLength) || !isJsonCount(runValue) || expanded.length + runLength > most) return null;
    for (let repeat = 0; repeat < runLength; repeat += 1) expanded.push(runValue);
  }
  return expanded;
}
export function sequenceReader<Item>(items: readonly Item[]): SequenceReader<Item> {
  let index = 0;
  return {
    next: () => items[index++],
    isAtEnd: () => index === items.length,
  };
}
/** The number format pattern of a format entry: `null` where it sets none, `undefined` where it cannot be read. */
export function googleNumberFormatPatternOf(formatEntry: unknown): string | null | undefined {
  const numberFormat = isPlainJsonObject(formatEntry) ? optionalJsonObject(formatEntry['3']) : null;
  if (numberFormat === null) return;
  const pattern = numberFormat['2'];
  return pattern === undefined ? null : isWellFormedText(pattern) ? pattern : undefined;
}
export function formulasLookLocalized(formulas: readonly string[]): boolean {
  let formulasWithoutStrings = formulas.map((formula) => formula.replaceAll(/"[^"]*"|'[^']*'|[RC]\d+/g, '""'));
  let anyFormulaMatches = (testPattern: RegExp) =>
    formulasWithoutStrings.some((formula) => testPattern.test(formula));
  let formulasWithoutBraces = formulasWithoutStrings.map((formula) => formula.replaceAll(/\{[^{}]*\}/g, ''));
  if (anyFormulaMatches(/\\/) || formulasWithoutBraces.some((formula) => formula.includes(';'))) return true;
  return anyFormulaMatches(/\d,\d/) && !anyFormulaMatches(/\D,|,\D|\d\.\d/);
}
export function readGoogleSheetsClipboard(json: string, mostCells: number): GoogleSheetsClipboard | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const root = asPlainJsonObject(parsed);
  let grid = asPlainJsonObject(root?.['15']);
  const values = optionalJsonObject(root?.['3']);
  const [rowCount, columnCount] = [grid?.['1'], grid?.['2']];
  if (root === null || values === null || !isJsonCount(rowCount) || !isJsonCount(columnCount)) return null;
  let cellCount = rowCount * columnCount;
  if (cellCount === 0 || cellCount > mostCells) return null;
  if (root['1'] !== 1 || root['20'] !== cellCount) return null;
  const cellFlags = expandRunLengths(root['2'], cellCount);
  const valueKinds = expandRunLengths(values['1'], cellCount);
  const formatNumbers = expandRunLengths(root['5'], cellCount);
  const formulaNumbers = expandRunLengths(root['9'], cellCount);
  const [numbers, texts, others] = [optionalJsonArray(values['3']), optionalJsonArray(values['4']), optionalJsonArray(values['5'])];
  const numberFormats = optionalJsonArray(root['4'])?.map(googleNumberFormatPatternOf);
  const formulas = optionalJsonArray(root['8']);
  if (
    cellFlags?.length !== cellCount ||
    valueKinds === null ||
    formatNumbers === null ||
    formulaNumbers === null ||
    numbers === null ||
    texts === null ||
    others === null ||
    numberFormats === undefined ||
    formulas === null ||
    !formulas.every(isWellFormedText) ||
    formulasLookLocalized(formulas)
  )
    return null;
  let readers = {
    kinds: sequenceReader(valueKinds),
    numbers: sequenceReader(numbers),
    texts: sequenceReader(texts),
    others: sequenceReader(others),
    formatNumbers: sequenceReader(formatNumbers),
    formulaNumbers: sequenceReader(formulaNumbers),
  };
  let readValue = (): ValueOfAnotherProgram | 'error' | undefined => {
    switch (readers.kinds.next()) {
      case 1: {
        let value = readers.numbers.next();
        if (typeof value !== 'number' || !Number.isFinite(value)) return;
        return {
          kind: 'number',
          value,
        };
      }
      case 2:
      case 4: {
        let value = readers.texts.next();
        return isWellFormedText(value)
          ? {
              kind: 'text',
              value,
            }
          : undefined;
      }
      case 3: {
        const otherValue = asPlainJsonObject(readers.others.next());
        if (otherValue?.['1'] === 5) return 'error';
        return otherValue?.['1'] === 4 && (otherValue['4'] === 0 || otherValue['4'] === 1)
          ? {
              kind: 'boolean',
              value: otherValue['4'] === 1,
            }
          : undefined;
      }
      case undefined:
      default:
        return;
    }
  };
  let keepsFormulas =
    formulaNumbers.reduce((total, formulaNumber) => total + (formulas[formulaNumber]?.length ?? 0), 0) <=
    MOST_FORMULA_CHARACTERS;
  const cells: CellDataOfAnotherProgram[] = [];
  for (let flags of cellFlags) {
    let value = (flags & CELL_HAS_VALUE) === 0 ? null : readValue();
    let numberFormatPattern = (flags & CELL_HAS_FORMAT) === 0 ? null : numberFormats[readers.formatNumbers.next() ?? -1];
    let formula = (flags & CELL_HAS_FORMULA) === 0 ? null : formulas[readers.formulaNumbers.next() ?? -1];
    if (value === undefined || numberFormatPattern === undefined || formula === undefined) return null;
    cells.push({
      value: value === 'error' ? null : value,
      isError: value === 'error',
      formulaByOffsets: keepsFormulas ? formula : null,
      numberFormatPattern,
    });
  }
  return Object.values(readers).every((reader) => reader.isAtEnd())
    ? {
        rowCount,
        columnCount,
        cells,
      }
    : null;
}
export const isPlainJsonObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);
export const asPlainJsonObject = (value: unknown): JsonObject | null => (isPlainJsonObject(value) ? value : null);
export const optionalJsonObject = (value: unknown): JsonObject | null => (value === undefined ? {} : asPlainJsonObject(value));
export const optionalJsonArray = (value: unknown): unknown[] | null => (value === undefined ? [] : Array.isArray(value) ? value : null);
export const isJsonCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
export const CELL_HAS_VALUE = 1;
export const CELL_HAS_FORMAT = 2;
export const CELL_HAS_FORMULA = 8;
export const PASTED_LONE_SURROGATE_PATTERN = /\p{Cs}/u;
export const isWellFormedText = (value: unknown): value is string => typeof value === 'string' && !PASTED_LONE_SURROGATE_PATTERN.test(value);
export const MOST_FORMULA_CHARACTERS = 1048576;
