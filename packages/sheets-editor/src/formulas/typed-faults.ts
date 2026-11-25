import type { DecimalSignName, Reference, SheetId } from '@open-artifact/sheets-core';
import type { ErrorTell } from '../messages/formula-errors.ts';
import type { SheetSize } from '../model/a1-references.ts';
import type { SheetSummary } from '../model/workbook.ts';
import type { WrittenLineSpan, WrittenReference } from './references.ts';
import type { ArrayLiteral, FormulaToken, FormulaTokenKind } from './tokenizer.ts';
import { isSignToken, upperCaseAsciiLetters, findArrayLiterals, tokenizeFormulaText } from './tokenizer.ts';
import { A1_CELL_PATTERN, isA1CellInSheet, normalizeA1Reference, columnLetters } from '../model/a1-references.ts';
import { formulaArgumentSeparator } from '../format/number-signs.ts';
import { findFormulaReferences, isWholeLineReference, resolveFormulaReference, formulaHasMoreReferencesThan } from './references.ts';
export function lastOrFirstIndex({ first, count }: WrittenLineSpan, index: number): number {
  let last = first + (count ?? 1) - 1;
  return last >= index ? last : first;
}
export function isConstantTokens(tokens: readonly FormulaToken[]): boolean {
  let [first, second] = tokens;
  if (tokens.length === 2) return isSignToken(first, '+-') && second?.kind === 'number';
  if (tokens.length !== 1 || first === undefined) return false;
  return ['number', 'text', 'error'].includes(first.kind) || (first.kind === 'name' && ['TRUE', 'FALSE'].includes(upperCaseAsciiLetters(first.text)));
}
export function faultOfArrayLiteral({ rows }: ArrayLiteral): ErrorTell | null {
  let nonConstants = rows.flat().filter((itemTokens) => !isConstantTokens(itemTokens));
  if (nonConstants.some(isArrayLiteralItem)) return null;
  if (nonConstants.length > 0)
    return {
      cause: 'notOnlyValuesInCurlyBrackets',
    };
  return rows.some((items) => items.length !== rows[0]?.length)
    ? {
        cause: 'rowsOfDifferentLengthsInCurlyBrackets',
      }
    : null;
}
/** The first fault of the formula's array literals, and the tokens outside them (each array's `{` and `}` with them). */
export function findArrayLiteralFaults(tokens: readonly FormulaToken[]): { fault: ErrorTell | null; outside: FormulaToken[] } {
  let { arrays, isOneLeftOpen } = findArrayLiterals(tokens);
  let outside: FormulaToken[] = [];
  let fault: ErrorTell | null = null;
  let index = 0;
  for (let array of arrays) {
    fault ??= faultOfArrayLiteral(array);
    outside.push(...tokens.slice(index, array.from + 1));
    index = array.to - 1;
  }
  outside.push(...tokens.slice(index));
  return {
    fault:
      fault ??
      (isOneLeftOpen
        ? {
            cause: 'curlyBracketNotClosed',
          }
        : null),
    outside,
  };
}
/**
 * A fault of a formula as typed that the person can be told of, or `null`. `knownReferences`, the references of the formula as
 * the cell keeps it, are for telling whether it would read more of them if entered again (`null`: not to be told).
 */
export function findFormulaFault(
  text: string,
  sheets: readonly SheetSummary[],
  sheetId: SheetId,
  decimalSign: DecimalSignName,
  knownReferences: readonly Reference[] | null,
): ErrorTell | null {
  let { tokens, isQuotationLeftOpen } = tokenizeFormulaText(text, decimalSign);
  if (isQuotationLeftOpen)
    return {
      cause: 'quotationMarkNotClosed',
    };
  if (tokens.some((token) => isSignToken(token, QUOTE_CHARACTERS))) return null;
  let countOfKind = (kind: FormulaTokenKind) => tokens.filter((token) => token.kind === kind).length;
  if (countOfKind('open') > countOfKind('close'))
    return {
      cause: 'parenthesisNotClosed',
    };
  if (countOfKind('close') > countOfKind('open'))
    return {
      cause: 'tooManyClosingParentheses',
    };
  let sheetNames = sheets.map(({ name }) => name.toLowerCase());
  let unknownSheet = tokens.find(({ kind, text: tokenText }, index) => {
    let before = tokens[index - 1];
    let isAtOperandStart =
      before === undefined || before.kind === 'open' || before.kind === 'betweenArguments' || isSignToken(before, '+-*/^=<>');
    let lowerText = tokenText.toLowerCase();
    return (
      kind === 'sheetName' &&
      isAtOperandStart &&
      !A1_CELL_PATTERN.test(tokenText) &&
      !tokenText.includes('$') &&
      !sheetNames.some((sheetName) => sheetName.endsWith(lowerText))
    );
  });
  if (unknownSheet !== undefined)
    return {
      cause: 'noSuchSheet',
      name: unknownSheet.text,
    };
  let sheet = sheets.find(({ sheetId: listedSheetId }) => listedSheetId === sheetId);
  let outsideRange = tokens.find((token, index) => {
    let isRangeEnd = isSignToken(tokens[index - 1], ':') || isSignToken(tokens[index + 1], ':');
    let isAfterSheetName =
      isSheetNameToken(tokens[index - 1]) || (isSignToken(tokens[index - 1], ':') && isSheetNameToken(tokens[index - 3]));
    return (
      isCellAddressToken(token) &&
      tokens[index + 1]?.kind !== 'open' &&
      isRangeEnd &&
      !isAfterSheetName &&
      sheet !== undefined &&
      !isA1CellInSheet(token.text, sheet)
    );
  });
  if (outsideRange !== undefined)
    return {
      cause: 'noSuchCellInARange',
      address: normalizeA1Reference(outsideRange.text),
    };
  let { fault, outside } = findArrayLiteralFaults(tokens);
  if (fault !== null) return fault;
  if (outside.some((token) => isSignToken(token, decimalSign === 'comma' ? ',' : ';')))
    return {
      cause: 'wrongSignBetweenArguments',
      rightSign: formulaArgumentSeparator(decimalSign),
    };
  if (isSignToken(tokens.at(-1), '+-*/^&=<>'))
    return {
      cause: 'somethingMissingAtTheEnd',
    };
  let outsideReference = findFormulaReferences(text, decimalSign).references.find(
    (reference) =>
      reference.sheetName === null &&
      reference.otherSheetName === null &&
      isWholeLineReference(reference) &&
      reference.ends.every(({ letters }) => letters.length <= 3) &&
      resolveFormulaReference(reference, sheetId, sheets) === null,
  );
  if (outsideReference !== undefined && sheet !== undefined)
    return {
      cause: 'noSuchCellInARange',
      address: addressOfReferenceEnd(outsideReference, sheet),
    };
  return knownReferences !== null && formulaHasMoreReferencesThan(text, decimalSign, sheetId, sheets, knownReferences)
    ? {
        cause: 'readIfEnteredAgain',
      }
    : null;
}
export const QUOTE_CHARACTERS = "'‘’“”";
export const isCellAddressToken = (token: FormulaToken): boolean => token.kind === 'name' && A1_CELL_PATTERN.test(token.text);
export const isSheetNameToken = (token: FormulaToken | undefined): boolean => token?.kind === 'sheetName' || isSignToken(token, '!');
export const addressOfReferenceEnd = ({ rows, columns }: WrittenReference, sheet: SheetSize): string =>
  `${columnLetters(lastOrFirstIndex(columns, sheet.columnCount))}${lastOrFirstIndex(rows, sheet.rowCount) + 1}`;
export const isArrayLiteralItem = (items: readonly FormulaToken[]): boolean =>
  items.every((token) => isSignToken(token, ',\\') || isConstantTokens([token]));
