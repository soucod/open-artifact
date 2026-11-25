import type { DecimalSignName, SheetId } from '@open-artifact/sheets-core';
import type { CellPosition } from '../selection/model.ts';
import type { FormulaToken, StoredFormulaToken } from './tokenizer.ts';
import { tokenizeFormulaText, upperCaseAsciiLetters, isSignToken } from './tokenizer.ts';
import { findFormulaReferences, referenceCoversCell, isWholeLineReference } from './references.ts';
import { FUNCTIONS_AGENT_MAY_NOT_WRITE, PLAIN_ARRAY_FUNCTIONS } from './agent-prompt.ts';
import { isNonNullObject } from '../utils/objects.ts';
import { hasSpaceBetweenOperands } from './word-tokens.ts';
import { findFormulaFault } from './typed-faults.ts';
import { describeFunction } from './function-help.ts';
import { A1_CELL_PATTERN } from '../model/a1-references.ts';
import { ARRAY_FUNCTION_NAMES } from './agent-prompt-values.ts';
import type { WorkbookReads } from '../model/workbook.ts';
export function mightFormulaSpill(text: string, decimalSign: DecimalSignName): boolean {
  if (!ARRAY_FORMULA_PATTERN.test(text)) return false;
  let { tokens } = tokenizeFormulaText(text, decimalSign);
  return hasQuoteCharsOutsideTexts(text) || !quotesMatchTokens(text, tokens, decimalSign) || tokensMakeArray(tokens);
}
/** The texts with digits, and the numbers that read differently with `,` decimals, of a formula read with `,` decimals. */
export function commaNumbersIn(formula: string): string[] {
  let { tokens } = tokenizeFormulaText(formula, 'comma');
  return tokens.flatMap(({ kind, text }, index) => {
    if (kind === 'text') return /[\d.,]/.test(text) ? [text] : [];
    if (kind === 'number' && /^[1-9]\d{0,2},\d{3}(?:[eE]|$)/.test(text)) return [text];
    let [next, afterNext] = [tokens[index + 1], tokens[index + 2]];
    let isSeparatorNext = next?.kind === 'betweenArguments' || (next?.kind === 'betweenValues' && next.text !== ';');
    let looksLikeSplitNumber =
      kind === 'number' && /^\d+$/.test(text) && afterNext?.kind === 'number' && (!afterNext.text.includes(',') || /^\d{3},/.test(afterNext.text));
    return isSeparatorNext && looksLikeSplitNumber ? [`${text};${afterNext.text}`] : [];
  });
}
export function bringsNewCommaNumbers(answer: string, formulasBefore: readonly string[]): boolean {
  let numbersBefore = formulasBefore.flatMap(commaNumbersIn);
  return commaNumbersIn(answer).some((number) => {
    let index = numbersBefore.indexOf(number);
    if (index !== -1) numbersBefore.splice(index, 1);
    return index === -1;
  });
}
export function addsVolatileFunction(answer: string, before: string, decimalSign: DecimalSignName): boolean {
  let answerTokens = tokenizeFormulaText(answer, decimalSign).tokens;
  let beforeTokens = tokenizeFormulaText(before, decimalSign).tokens;
  let namesBefore = new Set(
    beforeTokens.flatMap(({ kind, text }) => (kind === 'name' ? [upperCaseAsciiLetters(text)] : [])),
  );
  return answerTokens.some((token, index) => {
    let name = upperCaseAsciiLetters(token.text);
    return isFunctionCallAt(answerTokens, index) && VOLATILE_FUNCTIONS.has(name) && !namesBefore.has(name);
  });
}
export function quotesMatchTokens(formula: string, tokens: readonly FormulaToken[], decimalSign: DecimalSignName): boolean {
  let { quoted } = findFormulaReferences(formula, decimalSign);
  let texts = tokens.filter(({ kind }) => kind === 'text');
  return (
    quoted.length === texts.length &&
    quoted.every(
      ({ start, end, isClosed }, index) =>
        isClosed && formula.slice(start, end) === texts[index]?.text,
    )
  );
}
export function isSafeArrayFormula(formula: string, decimalSign: DecimalSignName): boolean {
  let { tokens } = tokenizeFormulaText(formula, decimalSign);
  return (
    !hasQuoteCharsOutsideTexts(formula) &&
    tokensMakeArray(tokens) &&
    isPlainArrayFormula(tokens) &&
    quotesMatchTokens(formula, tokens, decimalSign)
  );
}
export function usesFunctionAgentMayNotWrite(formula: string, decimalSign: DecimalSignName): boolean {
  let { tokens } = tokenizeFormulaText(formula, decimalSign);
  let firstIndex = tokens.findIndex(({ kind, text }) => kind !== 'open' && !/^[-+]$/.test(text));
  return (
    tokensMakeArray(tokens.slice(firstIndex, firstIndex + 2)) ||
    tokens.some(
      ({ text }, index) =>
        isFunctionCallAt(tokens, index) && FUNCTIONS_AGENT_MAY_NOT_WRITE.has(upperCaseAsciiLetters(text)),
    )
  );
}
/**
 * The formula of the agent's answer as the person would type it, or `null` where it is not one to take: odd, faulty, reading
 * whole rows or columns, or reading the cell it is for.
 */
export function acceptFormulaFromAgent(answer: unknown, reads: WorkbookReads, sheetId: SheetId, cell: CellPosition): string | null {
  let formula = isNonNullObject(answer) ? answer.formula : null;
  if (typeof formula !== 'string' || !/^=[^=@]/.test(formula)) return null;
  if (formula.length > MAX_FORMULA_ANSWER_LENGTH || ODD_FORMULA_CHAR_PATTERN.test(formula)) return null;
  if (hasQuoteCharsOutsideTexts(formula)) return null;
  let sheets = reads.listSheets();
  if (hasSpaceBetweenOperands(formula)) return null;
  if (findFormulaFault(formula, sheets, sheetId, 'point', null) !== null) return null;
  let { tokens } = tokenizeFormulaText(formula, 'point');
  if (tokens.some(({ kind, text }) => kind === 'sign' && text === '\\')) return null;
  if (
    !tokens.every(({ kind, text }, index) => {
      if (kind !== 'name') return true;
      let name = upperCaseAsciiLetters(text);
      if (tokens[index + 1]?.kind === 'open') return describeFunction(name) !== null && !FUNCTIONS_AGENT_MAY_NOT_WRITE.has(name);
      return A1_CELL_PATTERN.test(text) || BOOLEAN_NAME_PATTERN.test(name);
    })
  )
    return null;
  if (tokensMakeArray(tokens) && !isSafeArrayFormula(formula, 'point')) return null;
  let sheetName = sheets.find(({ sheetId: candidateId }) => candidateId === sheetId)?.name.toLowerCase();
  let { references } = findFormulaReferences(formula, 'point');
  return references.some(
    (reference) =>
      (reference.sheetName === null || reference.sheetName.toLowerCase() === sheetName) && referenceCoversCell(reference, cell),
  ) || references.some(isWholeLineReference)
    ? null
    : reads.formulaAsTyped(formula);
}
export const MAX_FORMULA_ANSWER_LENGTH = 1000;
export const ODD_FORMULA_CHAR_PATTERN = /(?! )[\u2800\p{C}\p{Z}\p{Default_Ignorable_Code_Point}]| {2}/u;
export const QUOTED_TEXT_PATTERN = /"(?:[^"]|"")*"/g;
export const BOOLEAN_NAME_PATTERN = /^(?:TRUE|FALSE)$/;
export const hasQuoteCharsOutsideTexts = (formula: string): boolean => /['!‘’“”]/.test(formula.replaceAll(QUOTED_TEXT_PATTERN, ''));
export const isFunctionCallAt = (tokens: readonly StoredFormulaToken[], index: number): boolean =>
  tokens[index]?.kind === 'name' && tokens[index + 1]?.kind === 'open';
export const tokensMakeArray = (tokens: readonly FormulaToken[]): boolean =>
  tokens.some(
    (token, index) =>
      isSignToken(token, '{') || (isFunctionCallAt(tokens, index) && describeFunction(upperCaseAsciiLetters(token.text))?.answers === 'anArray'),
  );
export const ARRAY_FORMULA_PATTERN = new RegExp(`\\{|\\b(?:${ARRAY_FUNCTION_NAMES.join('|')})[^A-Za-z0-9]*\\(`, 'i');
export const VOLATILE_FUNCTIONS = new Set<string>(['NOW', 'TODAY', 'RAND', 'RANDBETWEEN']);
export const VOLATILE_CALL_PATTERN = new RegExp(`\\b(?:${[...VOLATILE_FUNCTIONS].join('|')})[ \\t\\n\\r]*\\(`, 'i');
export const callsVolatileFunction = (formula: string): boolean => VOLATILE_CALL_PATTERN.test(formula);
export const COMPARISON_SIGN_PATTERN = /^[=<>]$/;
export const isPlainArrayFormula = (tokens: readonly FormulaToken[]): boolean =>
  tokens.every(({ kind, text }, index) => {
    if (isFunctionCallAt(tokens, index)) return PLAIN_ARRAY_FUNCTIONS.has(upperCaseAsciiLetters(text));
    if (kind === 'sign') return text !== '&';
    let isCompared = [tokens[index - 1], tokens[index + 1]].some(
      (token) => token?.kind === 'sign' && COMPARISON_SIGN_PATTERN.test(token.text),
    );
    return kind !== 'text' || isCompared;
  });
