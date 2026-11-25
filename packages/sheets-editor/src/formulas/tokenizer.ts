import type { DecimalSignName, Reference, StoredFormula } from '@open-artifact/sheets-core';
import { arrayColumnSeparator, formulaArgumentSeparator } from '../format/number-signs.ts';
export type FormulaTokenKind =
  | 'text'
  | 'sheetName'
  | 'sign'
  | 'error'
  | 'name'
  | 'number'
  | 'betweenValues'
  | 'betweenArguments'
  | 'open'
  | 'close';
/** A piece of a formula's text. */
export interface FormulaToken {
  kind: FormulaTokenKind;
  text: string;
}
/** A reference of a stored formula, in place among the tokens of the text around it. */
export interface ReferenceToken {
  kind: 'reference';
  reference: Reference;
}
export type StoredFormulaToken = FormulaToken | ReferenceToken;
export interface TokenizedFormula {
  tokens: FormulaToken[];
  /** The text ends inside a `"` that is not closed. */
  isQuotationLeftOpen: boolean;
}
/** An array literal still open: from the index of its `{`, its rows of items, each item a run of tokens. */
export interface ArrayLiteralOpen {
  from: number;
  rows: FormulaToken[][][];
}
/** An array literal, from its `{` to the index after its `}`. */
export interface ArrayLiteral extends ArrayLiteralOpen {
  to: number;
}
export function tokenizeFormula(text: string, decimalSign: DecimalSignName): TokenizedFormula {
  let tokens: FormulaToken[] = [];
  let position = 0;
  let isInArray = false;
  let readMatch = (pattern: RegExp) => {
    pattern.lastIndex = position;
    let match = pattern.exec(text);
    if (match !== null) position += match[0].length;
    return match;
  };
  while (position < text.length) {
    if (readMatch(FORMULA_SPACE_PATTERN) !== null) continue;
    if (text[position] === '"') {
      let textMatch = readMatch(FORMULA_TEXT_PATTERN);
      if (textMatch === null)
        return {
          tokens,
          isQuotationLeftOpen: true,
        };
      tokens.push({
        kind: 'text',
        text: textMatch[0],
      });
      continue;
    }
    if (text[position] === "'") {
      let quotedName = readMatch(QUOTED_SHEET_NAME_PATTERN)?.[1];
      if (quotedName === undefined)
        return {
          tokens: [
            ...tokens,
            {
              kind: 'sign',
              text: "'",
            },
          ],
          isQuotationLeftOpen: false,
        };
      tokens.push({
        kind: 'sheetName',
        text: quotedName.replaceAll("''", "'"),
      });
      continue;
    }
    let errorMatch = readMatch(FORMULA_ERROR_PATTERN);
    if (errorMatch !== null) {
      tokens.push({
        kind: 'error',
        text: upperCaseAsciiLetters(errorMatch[0]),
      });
      continue;
    }
    let nameMatch = readMatch(FORMULA_NAME_PATTERN);
    if (nameMatch !== null) {
      let isSheetName = text[position] === '!' && text[position + 1] !== '=';
      if (isSheetName) position += 1;
      tokens.push({
        kind: isSheetName ? 'sheetName' : 'name',
        text: nameMatch[0],
      });
      continue;
    }
    let followsValue = VALUE_ENDING_TOKEN_KINDS.has(tokens.at(-1)?.kind ?? 'open') || isSignToken(tokens.at(-1), '%}');
    let numberMatch =
      readMatch(FORMULA_NUMBER_PATTERNS[decimalSign]) ?? (followsValue ? null : readMatch(FORMULA_FRACTION_PATTERNS[decimalSign]));
    if (numberMatch !== null) {
      tokens.push({
        kind: 'number',
        text: numberMatch[0],
      });
      continue;
    }
    let sign = readMatch(FORMULA_ANY_CHARACTER_PATTERN)?.[0] ?? '';
    if (isInArray && [arrayColumnSeparator(decimalSign), ';'].includes(sign)) {
      tokens.push({
        kind: 'betweenValues',
        text: sign,
      });
      continue;
    }
    if (sign === '{' || sign === '}') isInArray = sign === '{';
    let kind: FormulaTokenKind =
      sign === formulaArgumentSeparator(decimalSign) ? 'betweenArguments' : (PARENTHESIS_TOKEN_KINDS[sign] ?? 'sign');
    tokens.push({
      kind,
      text: sign,
    });
  }
  return {
    tokens,
    isQuotationLeftOpen: false,
  };
}
export function findArrayLiterals(tokens: readonly FormulaToken[]): { arrays: ArrayLiteral[]; isOneLeftOpen: boolean } {
  let arrays: ArrayLiteral[] = [];
  let openArray: ArrayLiteralOpen | null = null;
  for (let [index, token] of tokens.entries())
    if (openArray === null) {
      if (isSignToken(token, '{'))
        openArray = {
          from: index,
          rows: [[[]]],
        };
    } else if (isSignToken(token, '}')) {
      arrays.push({
        ...openArray,
        to: index + 1,
      });
      openArray = null;
    } else if (token.kind !== 'betweenValues') openArray.rows.at(-1)?.at(-1)?.push(token);
    else if (token.text === ';') openArray.rows.push([[]]);
    else openArray.rows.at(-1)?.push([]);
  return {
    arrays,
    isOneLeftOpen: openArray !== null,
  };
}
export const FORMULA_SPACE_PATTERN = /[ \t\n\r]+/y;
export const FORMULA_TEXT_PATTERN = /"(?:[^"]|"")*"/y;
export const QUOTED_SHEET_NAME_PATTERN = /'((?:[^']|'')+)'!/y;
export const FORMULA_ERROR_PATTERN = /#(?:NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A|ERROR!|TIMEOUT!)/iy;
export const FORMULA_NAME_PATTERN = /[$\p{L}_][\p{L}\p{N}_.$]*/uy;
export const FORMULA_NUMBER_PATTERNS: Record<DecimalSignName, RegExp> = {
  point: /\d+\.?\d*(?:[eE][+-]?\d+)?/y,
  comma: /\d+(?:,\d+)?(?:[eE][+-]?\d+)?/y,
};
export const FORMULA_FRACTION_PATTERNS: Record<DecimalSignName, RegExp> = {
  point: /\.\d+(?:[eE][+-]?\d+)?/y,
  comma: /,\d+(?:[eE][+-]?\d+)?/y,
};
export const VALUE_ENDING_TOKEN_KINDS = new Set<FormulaTokenKind>(['text', 'name', 'number', 'error', 'close']);
export const FORMULA_ANY_CHARACTER_PATTERN = /./suy;
export const PARENTHESIS_TOKEN_KINDS: { readonly [sign: string]: 'open' | 'close' | undefined } = {
  '(': 'open',
  ')': 'close',
};
/** Whether the token is a sign, and one of the characters of `signs`. */
export const isSignToken = (token: StoredFormulaToken | undefined, signs: string): boolean =>
  token?.kind === 'sign' && signs.includes(token.text);
export const upperCaseAsciiLetters = (text: string): string =>
  text.replaceAll(/[a-z]/g, (letter) => letter.toUpperCase());
export const withoutLeadingEquals = (text: string): string => (text.startsWith('=') ? text.slice(1) : text);
export const tokenizeFormulaText = (text: string, decimalSign: DecimalSignName): TokenizedFormula =>
  tokenizeFormula(withoutLeadingEquals(text), decimalSign);
export const tokenizeFormulaWithReferences = ({ textBetweenReferences, references }: StoredFormula): StoredFormulaToken[] =>
  textBetweenReferences.flatMap((text, index): StoredFormulaToken[] => {
    let reference = references[index];
    return [
      ...tokenizeFormula(index === 0 ? withoutLeadingEquals(text) : text, 'point').tokens,
      ...(reference === undefined
        ? []
        : [
            {
              kind: 'reference' as const,
              reference,
            },
          ]),
    ];
  });
