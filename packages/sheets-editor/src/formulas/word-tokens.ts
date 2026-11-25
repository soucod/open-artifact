import type { DecimalSignName } from '@open-artifact/sheets-core';
import type { CatalogFunction } from './function-catalog.ts';
import { formulaArgumentSeparator } from '../format/number-signs.ts';
import { describeFunction, describedArgumentAt } from './function-help.ts';
import { upperCaseAsciiLetters } from './tokenizer.ts';
export type WordTokenKind = 'operand' | 'call' | 'word' | 'close' | 'sign';
/** A piece of a formula read for words: a word is a run of letters that names nothing a formula knows. */
export interface WordToken {
  kind: WordTokenKind;
  text: string;
  isAfterSpace: boolean;
}
export function endOfQuotedWord(text: string, start: number): number | null {
  let quote = text[start];
  let position = start + 1;
  while (position < text.length)
    if (text[position] !== quote) position += 1;
    else if (text[position + 1] === quote) position += 2;
    else return position + 1;
  return null;
}
export function tokenizeFormulaWords(text: string): WordToken[] {
  let tokens: WordToken[] = [];
  let position = 0;
  let isAfterSpace = false;
  let takeMatch = (pattern: RegExp) => {
    pattern.lastIndex = position;
    let match = pattern.exec(text)?.[0] ?? null;
    if (match !== null) position += match.length;
    return match;
  };
  let matchesHere = (pattern: RegExp) => ((pattern.lastIndex = position), pattern.test(text));
  let pushToken = (kind: WordTokenKind, tokenText: string) => {
    tokens.push({
      kind,
      text: tokenText,
      isAfterSpace,
    });
    isAfterSpace = false;
  };
  let takeSheetBang = () => {
    if (text[position] !== '!' || text[position + 1] === '=') return false;
    position += 1;
    takeMatch(WORD_NAME_AT);
    return true;
  };
  while (position < text.length) {
    if (takeMatch(WORD_SPACES_AT) !== null) {
      isAfterSpace = true;
      continue;
    }
    let tokenStart = position;
    if (text[position] === '"' || text[position] === "'") {
      position = endOfQuotedWord(text, position) ?? text.length;
      if (text[tokenStart] === "'") takeSheetBang();
      pushToken('operand', text.slice(tokenStart, position));
      continue;
    }
    let nameMatch = takeMatch(WORD_NAME_AT);
    if (nameMatch !== null) {
      if (takeSheetBang()) pushToken('operand', text.slice(tokenStart, position));
      else if (matchesHere(WORD_CALL_BRACKET_AT)) pushToken('call', nameMatch);
      else {
        let isWord = nameMatch.length > 1 && LETTERS_ONLY_WORD.test(nameMatch) && !BOOLEAN_WORD.test(nameMatch);
        pushToken(isWord ? 'word' : 'operand', nameMatch);
      }
      continue;
    }
    let numberOrError = takeMatch(WORD_NUMBER_AT) ?? takeMatch(WORD_ERROR_AT);
    if (numberOrError !== null) {
      pushToken('operand', numberOrError);
      continue;
    }
    position += 1;
    pushToken(text[tokenStart] === ')' ? 'close' : 'sign', text.slice(tokenStart, position));
  }
  return tokens;
}
export function hasSpaceBetweenOperands(formula: string): boolean {
  let tokens = tokenizeFormulaWords(formula.slice(1));
  return tokens.some((token, tokenIndex) => isSpaceBetweenOperands(tokens[tokenIndex - 1], token));
}
/** The words written where a function takes a name (as `LET` and `LAMBDA` do), which the formula declares. */
export function namesDeclaredInNameArguments(tokens: readonly WordToken[], decimalSign: DecimalSignName): Set<string> {
  let isSign = (candidate: WordToken | undefined, sign: string) => candidate?.kind === 'sign' && candidate.text === sign;
  let argumentSeparator = formulaArgumentSeparator(decimalSign);
  let declaredNames = new Set<string>();
  let openCalls: { called: CatalogFunction | null; argumentAt: number }[] = [];
  let isInArrayLiteral = false;
  for (let [tokenIndex, token] of tokens.entries()) {
    let [previousToken, nextToken, innermostCall] = [tokens[tokenIndex - 1], tokens[tokenIndex + 1], openCalls.at(-1)];
    if (isSign(token, '{') || isSign(token, '}')) isInArrayLiteral = token.text === '{';
    if (isInArrayLiteral) continue;
    if (token.kind === 'close') openCalls.pop();
    else if (isSign(token, '('))
      openCalls.push({
        called: previousToken?.kind === 'call' ? describeFunction(upperCaseAsciiLetters(previousToken.text)) : null,
        argumentAt: 0,
      });
    else if (isSign(token, argumentSeparator) && innermostCall !== undefined) innermostCall.argumentAt += 1;
    if (
      !(
        token.kind === 'word' &&
        (isSign(previousToken, '(') || isSign(previousToken, argumentSeparator)) &&
        (nextToken === undefined || isSign(nextToken, argumentSeparator))
      ) ||
      innermostCall === undefined ||
      innermostCall.called === null
    )
      continue;
    if (describedArgumentAt(innermostCall.called, innermostCall.argumentAt, null)?.takes === 'aName') declaredNames.add(token.text);
  }
  return declaredNames;
}
export function formulaReadsAsWords(formula: string, sheetNames: readonly string[], decimalSign: DecimalSignName): boolean {
  if (!formula.startsWith('=')) return false;
  let tokens = tokenizeFormulaWords(formula.slice(1));
  let declaredNames = namesDeclaredInNameArguments(tokens, decimalSign);
  return tokens.some((token, tokenIndex) => {
    let previousToken = tokens[tokenIndex - 1];
    if (isSpaceBetweenOperands(previousToken, token) && (previousToken.kind === 'word' || token.kind === 'word')) return true;
    return (
      token.kind === 'word' &&
      SCRIPT_WITHOUT_SPACES.test(token.text) &&
      ![...sheetNames, ...declaredNames].some((knownName) => knownName.startsWith(token.text))
    );
  });
}
export const WORD_SPACES_AT = /[ \t\n\r]+/y;
export const WORD_NAME_AT = /[$\p{L}_][\p{L}\p{M}\p{N}_.$]*(?:['’][\p{L}\p{M}]+)*/uy;
export const WORD_NUMBER_AT = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?%*/y;
export const WORD_ERROR_AT = /#[\w/]+[!?]?/y;
export const WORD_CALL_BRACKET_AT = /[ \t\n\r]*\(/y;
export const LETTERS_ONLY_WORD = /^\p{L}[\p{L}\p{M}]*(?:['’][\p{L}\p{M}]+)*$/u;
export const BOOLEAN_WORD = /^(?:true|false)$/i;
export const SCRIPT_WITHOUT_SPACES =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
export const KINDS_BEFORE_SPACE = new Set<WordTokenKind>(['word', 'operand', 'close']);
export const KINDS_AFTER_SPACE = new Set<WordTokenKind>(['word', 'operand', 'call']);
export const isSpaceBetweenOperands = (previousToken: WordToken | undefined, token: WordToken): boolean =>
  previousToken !== undefined && token.isAfterSpace && KINDS_BEFORE_SPACE.has(previousToken.kind) && KINDS_AFTER_SPACE.has(token.kind);
