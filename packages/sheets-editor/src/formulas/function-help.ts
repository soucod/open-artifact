import type { DecimalSignName } from '@open-artifact/sheets-core';
import type { BracketPair } from '../state/initial-state.ts';
import type { CatalogFunction, FunctionArgument } from './function-catalog.ts';
import { formulaArgumentSeparator } from '../format/number-signs.ts';
import { upperCaseAsciiLetters } from './tokenizer.ts';
import { FUNCTION_CATALOG } from './function-catalog.ts';
/** A `(` not yet closed: where it is, and where the separators between its arguments are. */
export interface OpenBracket {
  at: number;
  dividedAt: number[];
}
/** How far a scan of a formula's text has come: the brackets open, the quote it is inside of, and whether it is between `{` and `}`. */
export interface BracketScan {
  open: OpenBracket[];
  quotedBy: string | null;
  isBetweenCurlyBrackets: boolean;
}
/** A function's name, upper-cased, and where it starts. */
export interface FunctionNameAt {
  name: string;
  start: number;
}
/** A call whose brackets are open at the end of a text, and the index of the argument being written. */
export interface CallAtEnd extends FunctionNameAt {
  argumentAt: number;
}
/** A name being typed at the end of a text, and where it starts. */
export interface NameTyped {
  start: number;
  typed: string;
}
export function requiredArgumentsAfterRepeats({ arguments: functionArguments }: CatalogFunction): FunctionArgument[] {
  let lastRepeatIndex = functionArguments.findLastIndex(({ repeats }) => repeats);
  return lastRepeatIndex === -1
    ? []
    : functionArguments.slice(lastRepeatIndex + 1).filter(({ isOptional }) => !isOptional);
}
export function acceptsArgumentCount({ arguments: functionArguments }: CatalogFunction, argumentCount: number): boolean {
  let repeatingCount = functionArguments.filter(({ repeats }) => repeats).length;
  let optionalCount = functionArguments.filter(({ isOptional }) => isOptional).length;
  let requiredCount = functionArguments.length - optionalCount;
  if (repeatingCount === 0) return argumentCount >= requiredCount && argumentCount <= functionArguments.length;
  return argumentCount >= requiredCount && (argumentCount - requiredCount) % repeatingCount <= optionalCount;
}
export function describedArgumentAt(
  described: CatalogFunction,
  argumentIndex: number,
  argumentCount: number | null,
): FunctionArgument | undefined {
  let { arguments: functionArguments } = described;
  let firstRepeatIndex = functionArguments.findIndex(({ repeats }) => repeats);
  let repeatingCount = functionArguments.filter(({ repeats }) => repeats).length;
  if (repeatingCount === 0 || argumentIndex < firstRepeatIndex + repeatingCount) return functionArguments[argumentIndex];
  let trailingRequired = requiredArgumentsAfterRepeats(described);
  if (argumentCount !== null && acceptsArgumentCount(described, argumentCount) && argumentIndex >= argumentCount - trailingRequired.length)
    return trailingRequired[argumentIndex - (argumentCount - trailingRequired.length)];
  return functionArguments[firstRepeatIndex + ((argumentIndex - firstRepeatIndex) % repeatingCount)];
}
export function scanBracketChar(scan: BracketScan, text: string, position: number, argumentSeparator: string | null): void {
  let char = text[position];
  if (scan.quotedBy !== null) {
    if (char === scan.quotedBy) scan.quotedBy = null;
  } else if (char === '"' || char === "'") scan.quotedBy = char;
  else if (char === '{' || char === '}') scan.isBetweenCurlyBrackets = char === '{';
  else if (char === '(')
    scan.open.push({
      at: position,
      dividedAt: [],
    });
  else if (char === ')') scan.open.pop();
  else if (char === argumentSeparator && !scan.isBetweenCurlyBrackets) scan.open.at(-1)?.dividedAt.push(position);
}
export function scanBrackets(text: string, argumentSeparator: string | null): BracketScan {
  let scan: BracketScan = {
    open: [],
    quotedBy: null,
    isBetweenCurlyBrackets: false,
  };
  for (let position = 0; position < text.length; position += 1) scanBracketChar(scan, text, position, argumentSeparator);
  return scan;
}
export function isOutsideQuotesAndArrays(text: string): boolean {
  let { quotedBy, isBetweenCurlyBrackets } = scanBrackets(text, null);
  return quotedBy === null && !isBetweenCurlyBrackets;
}
export function functionNameBefore(text: string, bracketAt: number): FunctionNameAt | null {
  let nameEnd = bracketAt;
  while (nameEnd > 0 && FORMULA_SPACE.test(text.charAt(nameEnd - 1))) nameEnd -= 1;
  let nameStart = nameEnd;
  while (nameStart > 0 && FUNCTION_NAME_CHAR.test(text.charAt(nameStart - 1))) nameStart -= 1;
  while (nameStart < nameEnd && !FUNCTION_NAME_START.test(text.charAt(nameStart))) nameStart += 1;
  return nameStart === nameEnd
    ? null
    : {
        name: text.slice(nameStart, nameEnd).toUpperCase(),
        start: nameStart,
      };
}
export function nameBeingTyped(textBeforeCaret: string): NameTyped | null {
  let typed = NAME_TYPED_AT_END.exec(textBeforeCaret)?.[1];
  if (typed === undefined || NA_ERROR_AT_END.test(textBeforeCaret)) return null;
  if (!isOutsideQuotesAndArrays(textBeforeCaret)) return null;
  return {
    start: textBeforeCaret.length - typed.length,
    typed,
  };
}
export function isTypingNameArgument(
  textBeforeCaret: string,
  textAfterCaret: string,
  { start: typedStart, typed }: NameTyped,
  decimalSign: DecimalSignName,
): boolean {
  let argumentSeparator = formulaArgumentSeparator(decimalSign);
  let { open: openBrackets } = scanBrackets(textBeforeCaret, argumentSeparator);
  return openBrackets
    .flatMap((bracket) => {
      let described = describeFunction(functionNameBefore(textBeforeCaret, bracket.at)?.name ?? '');
      return described !== null && takesNameArgument(described)
        ? [
            {
              bracket,
              described,
            },
          ]
        : [];
    })
    .some(({ bracket: { at: bracketAt, dividedAt }, described }) => {
      let takesNameAt = (argumentIndex: number) => describedArgumentAt(described, argumentIndex, null)?.takes === 'aName';
      let argumentTextBefore = (argumentIndex: number, end: number) =>
        textBeforeCaret.slice((dividedAt[argumentIndex - 1] ?? bracketAt) + 1, end).replaceAll(EDGE_SPACES, '');
      let currentArgumentIndex = dividedAt.length;
      let isTypingCurrentName =
        bracketAt === openBrackets.at(-1)?.at &&
        takesNameAt(currentArgumentIndex) &&
        argumentTextBefore(currentArgumentIndex, typedStart) === '' &&
        (currentArgumentIndex === 0 || NEXT_NON_SPACE_CHAR.exec(textAfterCaret)?.[1] === argumentSeparator);
      let repeatsEarlierName = dividedAt
        .slice(0, -1)
        .some(
          (dividerAt, argumentIndex) =>
            takesNameAt(argumentIndex) && upperCaseAsciiLetters(argumentTextBefore(argumentIndex, dividerAt)) === upperCaseAsciiLetters(typed),
        );
      return isTypingCurrentName || repeatsEarlierName;
    });
}
export function enclosingCallAtEnd(textBeforeCaret: string, decimalSign: DecimalSignName): CallAtEnd | null {
  let { open: openBrackets } = scanBrackets(textBeforeCaret, formulaArgumentSeparator(decimalSign));
  for (let bracketIndex = openBrackets.length - 1; bracketIndex >= 0; bracketIndex -= 1) {
    let bracket = openBrackets[bracketIndex];
    let call = bracket === undefined ? null : functionNameBefore(textBeforeCaret, bracket.at);
    if (bracket !== undefined && call !== null)
      return {
        ...call,
        argumentAt: bracket.dividedAt.length,
      };
  }
  return null;
}
export function isBareNameArgumentAtCaret(textBeforeCaret: string, textAfterCaret: string, decimalSign: DecimalSignName): boolean {
  let argumentSeparator = formulaArgumentSeparator(decimalSign);
  let scan = scanBrackets(textBeforeCaret, argumentSeparator);
  let callBracket = scan.open.findLast(({ at: bracketAt }) => functionNameBefore(textBeforeCaret, bracketAt) !== null);
  if (callBracket === undefined) return false;
  let wholeText = `${textBeforeCaret}${textAfterCaret}`;
  let argumentStart = (callBracket.dividedAt.at(-1) ?? callBracket.at) + 1;
  let dividerCount = callBracket.dividedAt.length;
  let outerBrackets = scan.open.slice(0, scan.open.indexOf(callBracket));
  let argumentEnd: number | null = null;
  for (let scanAt = textBeforeCaret.length; scanAt < wholeText.length; scanAt += 1) {
    scanBracketChar(scan, wholeText, scanAt, argumentSeparator);
    let hasLeftArgument = !scan.open.includes(callBracket) || callBracket.dividedAt.length > dividerCount;
    if (argumentEnd === null && hasLeftArgument) argumentEnd = scanAt;
  }
  if (argumentEnd !== null && wholeText[argumentEnd] !== ')') return false;
  if (argumentEnd !== null && !outerBrackets.some((outerBracket) => scan.open.includes(outerBracket))) return true;
  return !BARE_NAME_OR_EMPTY.test(wholeText.slice(argumentStart, argumentEnd ?? wholeText.length));
}
export function bracketPairAtCaret(text: string, caret: number): BracketPair | null {
  if (!/[()]/.test(text.slice(Math.max(0, caret - 1), caret + 1))) return null;
  let scan: BracketScan = {
    open: [],
    quotedBy: null,
    isBetweenCurlyBrackets: false,
  };
  let pairAfterCaret: BracketPair | null = null;
  for (let position = 0; position < text.length; position += 1) {
    let [innermost, openCount] = [scan.open.at(-1), scan.open.length];
    scanBracketChar(scan, text, position, null);
    if (innermost === undefined || scan.open.length >= openCount) continue;
    let pair = {
      opensAt: innermost.at,
      closesAt: position,
    };
    if (pair.opensAt === caret - 1 || pair.closesAt === caret - 1) return pair;
    if (pair.opensAt === caret || pair.closesAt === caret) pairAfterCaret = pair;
  }
  return pairAfterCaret;
}
export const CATALOG_FUNCTIONS_BY_NAME = new Map<string, CatalogFunction>(
  FUNCTION_CATALOG.map((catalogEntry) => [catalogEntry.name, catalogEntry]),
);
export const describeFunction = (functionName: string): CatalogFunction | null => CATALOG_FUNCTIONS_BY_NAME.get(functionName) ?? null;
export const isBooleanLiteralName = (functionName: string): boolean => functionName === 'TRUE' || functionName === 'FALSE';
export const takesNameArgument = ({ arguments: functionArguments }: CatalogFunction): boolean =>
  functionArguments.some(({ takes }) => takes === 'aName');
export const FORMULA_SPACE_CLASS = '[ \\t\\n\\r]';
export const FORMULA_SPACE = new RegExp(FORMULA_SPACE_CLASS);
export const NAME_TYPED_AT_END = new RegExp(`(?:^=|[-+*/(,;^<>&=])${FORMULA_SPACE_CLASS}*([A-Za-z][A-Za-z0-9_.]*)$`);
export const OPERAND_EXPECTED_AT_END = new RegExp(`(?:^=|[-+*/(,;^<>&=])${FORMULA_SPACE_CLASS}*$`);
export const NA_ERROR_AT_END = /#N\/A$/i;
export const OPEN_BRACKET_AHEAD = new RegExp(`^${FORMULA_SPACE_CLASS}*\\(`);
export const NEXT_NON_SPACE_CHAR = new RegExp(`^${FORMULA_SPACE_CLASS}*([^])`);
export const EDGE_SPACES = new RegExp(`^${FORMULA_SPACE_CLASS}+|${FORMULA_SPACE_CLASS}+$`, 'g');
export const FUNCTION_NAME_CHAR = /[A-Za-z0-9_.]/;
export const FUNCTION_NAME_START = /[A-Za-z_]/;
export const BARE_NAME_OR_EMPTY = new RegExp(
  `^${FORMULA_SPACE_CLASS}*(?:[A-Za-z_\\P{ASCII}][A-Za-z0-9_.\\P{ASCII}]*${FORMULA_SPACE_CLASS}*)?$`,
  'u',
);
export const isInsideArrayLiteral = (text: string): boolean => scanBrackets(text, null).isBetweenCurlyBrackets;
export const expectsOperandAtEnd = (textBeforeCaret: string): boolean =>
  OPERAND_EXPECTED_AT_END.test(textBeforeCaret) && isOutsideQuotesAndArrays(textBeforeCaret);
export const openBracketAhead = (textAfterCaret: string): string | null => OPEN_BRACKET_AHEAD.exec(textAfterCaret)?.[0] ?? null;
