import { readsAsStored } from '../../model/workbook.ts';
import { canAskAgentForFormula, withFormulaFromWordsStage, FRESH_FORMULA_OFFER } from './offer.ts';
import { withNoEffects } from '../../state/transitions.ts';
import type { EditingMode, PageTransition } from '../../state/transitions.ts';
import { activeAnchorCell, areaOfPosition } from '../../selection/model.ts';
import { describeSheetForAgent, formulaFromWordsPrompt } from '../agent-prompt.ts';
import { lineRunsOfSheet } from '../../format/conditional/ask-agent.ts';
import { areaToA1AsStored } from './where.ts';
import { proposedFormulaResult } from '../proposed-result.ts';
import { isSafeArrayFormula, acceptFormulaFromAgent } from '../agent-answer-checks.ts';
import { startEntryEditing } from '../../editor/start-entry.ts';
import { cancelEntryIfEditing } from '../../editor/commit-entry.ts';
import { isFixNoBetter, countCellsRead, areasReadOnlyBy } from '../fix/answer-checks.ts';
import { isSameJsonValue } from '../../model/same-json.ts';
import { formulasInAnswer } from '../fix-prompt.ts';
import { findFormulaReferences, resolveFormulaReference } from '../references.ts';
import { tokenizeFormulaText, upperCaseAsciiLetters } from '../tokenizer.ts';
import type { DecimalSignName, ValueContents } from '@open-artifact/sheets-core';
import type { CellId, WorkbookReads } from '../../model/workbook.ts';
import type {
  FormulaAsked,
  FormulaWithResult,
  OthersMayFitBecause,
  PageState,
  ProposedFormulaResult,
  WhyFixCameToNothing,
} from '../../state/initial-state.ts';
import type { ReadsWithTextMeasurer } from '../../state/controller.ts';
import type { CellPosition } from '../../selection/model.ts';
import type { ProposedFormulaResultRead } from '../proposed-result.ts';
import type { NumberFormatReply } from '../../format/custom-number-format.ts';
/** What a formula comes to in a cell, or why it cannot be taken. */
export type FormulaResultChecked = ProposedFormulaResultRead | 'ranOutOfTime' | 'error' | 'noFormula' | 'makesAnAddress';
/** A formula the agent answered with, or why it cannot be offered. */
export type FormulaFromAnswer = FormulaWithResult | 'noFormula' | 'ranOutOfTime' | 'makesAnAddress';
export function askAgentForFormula(state: PageState, workbookSeen: WorkbookReads): PageTransition {
  let workbook = readsAsStored(workbookSeen);
  let { mode, formulaFromWords } = state;
  if (mode.kind !== 'editing' || !canAskAgentForFormula(state)) return withNoEffects(state);
  let words = mode.text;
  let activeCell = activeAnchorCell(state, workbook);
  let position = workbook.positionOfCell(activeCell);
  let sheetDescription = position === null ? null : describeSheetForAgent(workbook, activeCell.sheetId, position, '', true);
  let linesAsTold = lineRunsOfSheet(workbook, activeCell.sheetId);
  if (position === null || sheetDescription === null || linesAsTold === null)
    return withNoEffects(
      withFormulaFromWordsStage(state, {
        kind: 'cameToNothing',
        words,
        why: 'sheetTooLarge',
      }),
    );
  let asked = formulaFromWordsPrompt(
    words.slice(1).trim(),
    areaToA1AsStored(areaOfPosition(position), null),
    sheetDescription,
    workbook.decimalSign,
  );
  let askId = formulaFromWords.askCount + 1;
  return {
    state: withFormulaFromWordsStage(
      state,
      {
        kind: 'asked',
        askId,
        words,
        linesAsTold,
      },
      {
        askCount: askId,
      },
    ),
    effects: [
      {
        kind: 'askAgentForAFormula',
        askId,
        asked,
      },
    ],
  };
}
export function checkFormulaResult(workbook: WorkbookReads, cellId: CellId, formula: string): FormulaResultChecked {
  let comesTo = proposedFormulaResult(workbook, cellId, formula);
  if (comesTo === 'ranOutOfTime' || comesTo === 'error') return comesTo;
  if (comesTo === null) return 'noFormula';
  if (comesTo.fillsOtherCells === true && !isSafeArrayFormula(formula, workbook.decimalSign)) return 'noFormula';
  let shownText = `${comesTo.shown} ${comesTo.text ?? ''}`;
  return ADDRESS_LIKE_PATTERN.test(`${formula} ${shownText} ${shownText.replace(/[\t\n\r]/g, '')}`) ? 'makesAnAddress' : comesTo;
}
export function differsFromResult({ result }: ProposedFormulaResult, cameTo: ValueContents | null): boolean {
  if (cameTo === null) return false;
  if (cameTo.kind !== 'number' || result?.kind !== 'number') return cameTo.kind !== result?.kind || cameTo.value !== result.value;
  return Math.abs(cameTo.value - result.value) > numberTolerance(cameTo.value, result.value);
}
export function withEntryFormulaText(
  state: PageState,
  workbook: ReadsWithTextMeasurer,
  text: string,
  formulaOfAgent?: EditingMode['formulaOfAgent'],
): PageState {
  if (state.mode.kind !== 'editing') return state;
  let started = startEntryEditing(state, workbook, text, state.mode.typingIn);
  let caret = {
    text,
    start: text.length,
    end: text.length,
  };
  return {
    ...started,
    ...(started.mode.kind === 'editing' &&
      formulaOfAgent !== undefined && {
        mode: {
          ...started.mode,
          formulaOfAgent,
          ...(formulaOfAgent === 'mayBeHeld' &&
            started.mode.textOfOthersHeld
              ?.split(
                `
`,
              )
              .includes(text) !== true && {
              textOfOthersHeld: `${started.mode.textOfOthersHeld ?? ''}
${text}`,
            }),
        },
      }),
    formulaHelp: {
      ...started.formulaHelp,
      caret,
      caretAfterPick: caret,
    },
  };
}
export function takeAgentsFormulaAnswer(
  state: PageState,
  workbook: ReadsWithTextMeasurer,
  askId: number,
  answer: NumberFormatReply,
): PageTransition {
  let taken = proposeFormulaFromAnswer(state, workbook, askId, answer);
  const { stage } = state.formulaFromWords;
  if (!(stage?.kind === 'asked' && stage.askId === askId && stage.isFix === true) || taken.state.formulaFromWords.stage?.kind === 'proposed')
    return taken;
  let stageAfter = taken.state.formulaFromWords.stage;
  let hasCallFailed = stageAfter?.kind === 'offered' && stageAfter.hasCallFailed;
  let isAnsweredWithNothing = answer.kind === 'answered' && !hasCallFailed;
  const whyFailed = answer.kind === 'failed' ? whyCallFailed(answer) : 'other';
  const why = isAnsweredWithNothing ? 'noFormula' : whyFailed;
  return {
    ...taken,
    state: endFixThatCameToNothing(taken.state, workbook, why, hasCallFailed),
  };
}
export function endFixThatCameToNothing(
  state: PageState,
  workbook: WorkbookReads,
  why: WhyFixCameToNothing,
  mayGoBetterAgain = false,
): PageState {
  let activeCell = activeAnchorCell(state, workbook);
  return withFixThatCameToNothing(cancelEntryIfEditing(state, workbook), activeCell, why, mayGoBetterAgain);
}
export function formulaFromAnswer(
  workbook: WorkbookReads,
  activeCell: CellId,
  position: CellPosition,
  stage: FormulaAsked,
  answer: unknown,
): FormulaFromAnswer {
  let formula = acceptFormulaFromAgent(answer, workbook, activeCell.sheetId, position);
  if (
    formula === null ||
    (stage.isFix === true &&
      isFixNoBetter(
        workbook,
        activeCell,
        formula,
        stage.words,
        stage.formulaBeforeASortOrMove ?? null,
        stage.callsForNoNewCell === true,
        stage.isLabelOrHeadingTold === true,
        stage.areOwnWords === true,
      ))
  )
    return 'noFormula';
  if ((countCellsRead(formula, workbook.decimalSign) ?? 1 / 0) < (stage.fewestCellsToRead ?? 0)) return 'noFormula';
  let comesTo = checkFormulaResult(workbook, activeCell, formula);
  if (stage.isFix === true && stage.areOwnWords !== true && fillsOtherCells(comesTo)) return 'noFormula';
  if (typeof comesTo === 'string') return comesTo === 'error' ? 'noFormula' : comesTo;
  return differsFromResult(comesTo, stage.cameToBeforeASort ?? null)
    ? 'noFormula'
    : {
        formula,
        value: comesTo,
      };
}
export function isTrulyOtherFix(
  workbook: WorkbookReads,
  activeCell: CellId,
  othersMayFit: OthersMayFitBecause,
  formula: string,
  other: string,
): boolean {
  let { decimalSign } = workbook;
  let [lines, otherLines] = [formulaTokenLines(formula, decimalSign), formulaTokenLines(other, decimalSign)];
  if (lines.includes(otherLines) || otherLines.includes(lines)) return false;
  if (othersMayFit === 'cellsDeleted') return areasReadOnlyBy(workbook, activeCell, formula, [other]).length > 0;
  let [calls, otherCalls] = [functionsCalledIn(formula, decimalSign), functionsCalledIn(other, decimalSign)];
  return calls.some((name) => !otherCalls.includes(name)) || otherCalls.some((name) => !calls.includes(name));
}
export function otherFixesOfAnswer(
  others: { formula: string }[],
  main: FormulaWithResult,
  workbook: WorkbookReads,
  activeCell: CellId,
  position: CellPosition,
  stage: FormulaAsked,
  othersMayFit: OthersMayFitBecause,
): FormulaWithResult[] | 'makesAnAddress' {
  if (others.some(({ formula }) => ADDRESS_LIKE_PATTERN.test(formula))) return 'makesAnAddress';
  if (
    others
      .map((answer) => acceptFormulaFromAgent(answer, workbook, activeCell.sheetId, position))
      .map((formula) => formula !== null && checkFormulaResult(workbook, activeCell, formula))
      .includes('makesAnAddress')
  )
    return 'makesAnAddress';
  let kept: FormulaWithResult[] = [];
  for (const answer of others) {
    let fix = formulaFromAnswer(workbook, activeCell, position, stage, answer);
    if (typeof fix === 'string' || quotesSpacedTextNotInWords(fix.formula, stage.words, workbook.decimalSign)) continue;
    if (fix.value.text !== null && main.value.text === null) continue;
    if (
      [main, ...kept].every(
        ({ formula, value }) =>
          isTrulyOtherFix(workbook, activeCell, othersMayFit, fix.formula, formula) && !comeToSameValue(fix.value, value),
      )
    )
      kept.push(fix);
  }
  return kept;
}
export function proposeFormulaFromAnswer(
  state: PageState,
  workbookSeen: ReadsWithTextMeasurer,
  askId: number,
  answer: NumberFormatReply,
): PageTransition {
  let workbook = readsAsStored(workbookSeen);
  const { stage } = state.formulaFromWords;
  if (stage?.kind !== 'asked' || stage.askId !== askId) return withNoEffects(state);
  let { words, linesAsTold } = stage;
  if (answer.kind === 'notToBeHad')
    return withNoEffects(
      withFormulaFromWordsStage(
        state,
        {
          kind: 'cameToNothing',
          words,
          why: 'notAvailable',
        },
        {
          agent: 'notToBeHad',
        },
      ),
    );
  if (answer.kind === 'stopped') return withNoEffects(withFormulaFromWordsStage(state, null));
  let activeCell = activeAnchorCell(state, workbook);
  let position = workbook.positionOfCell(activeCell);
  let areLinesUnchanged = isSameJsonValue(lineRunsOfSheet(workbook, activeCell.sheetId), linesAsTold);
  if (answer.kind === 'failed' || !areLinesUnchanged || position === null)
    return withNoEffects(
      withFormulaFromWordsStage(state, {
        ...FRESH_FORMULA_OFFER,
        hasCallFailed: true,
        isDrawn: true,
        hasRested: true,
      }),
    );
  let othersMayFit = stage.othersMayFit ?? null;
  let otherAnswers = othersMayFit === null ? [] : formulasInAnswer(answer.answer).slice(1);
  if (otherAnswers.length >= TOO_MANY_OTHER_FIXES)
    return withNoEffects(
      withFormulaFromWordsStage(state, {
        kind: 'cameToNothing',
        words,
        why: 'noFormula',
      }),
    );
  let main = formulaFromAnswer(workbook, activeCell, position, stage, answer.answer);
  if (typeof main === 'string')
    return withNoEffects(
      withFormulaFromWordsStage(state, {
        kind: 'cameToNothing',
        words,
        why: main,
      }),
    );
  let others = othersMayFit === null ? [] : otherFixesOfAnswer(otherAnswers, main, workbook, activeCell, position, stage, othersMayFit);
  if (others === 'makesAnAddress')
    return withNoEffects(
      withFormulaFromWordsStage(state, {
        kind: 'cameToNothing',
        words,
        why: others,
      }),
    );
  let fixes = othersMayFit === 'nameNotKnown' ? withWhatSetsFixesApart([main, ...others], workbook.decimalSign) : [main, ...others];
  let { formula, value: comesTo } = main;
  let typedAreaKeys = new Set(state.referencesInEntry.map(({ area }) => areaToA1AsStored(area, null)));
  let lightsAtPart: Record<string, number> = {};
  for (const reference of findFormulaReferences(formula, workbook.decimalSign).references) {
    let area = resolveFormulaReference(reference, activeCell.sheetId, workbookSeen.listSheets())?.area;
    let areaKey = area === undefined ? null : areaToA1AsStored(area, null);
    if (areaKey !== null && !typedAreaKeys.has(areaKey)) lightsAtPart[areaKey] ??= reference.start / formula.length;
  }
  return withNoEffects(
    withFormulaFromWordsStage(withEntryFormulaText(state, workbookSeen, formula, 'mayBeHeld'), {
      kind: 'proposed',
      words,
      formula,
      isArriving: true,
      isDiscardHighlighted: false,
      lightsAtPart,
      value: comesTo,
      ...(stage.isFix === true && {
        isFix: true,
      }),
      ...(stage.areOwnWords === true && {
        areOwnWords: true,
      }),
      ...(others.length > 0 && {
        fixes,
      }),
    }),
  );
}
export const ADDRESS_LIKE_PATTERN = /:\/\/|\b(?:https?|ftp|wss?):|\bwww\.|\bmailto:|\.[a-z]{2,}[/?]/i;
export const fillsOtherCells = (comesTo: FormulaResultChecked): boolean => typeof comesTo !== 'string' && comesTo.fillsOtherCells === true;
export const numberTolerance = (value: number, other: number): number =>
  0.000000000001 * Math.max(1e6, Math.abs(value), Math.abs(other));
export const whyCallFailed = (failure: Extract<NumberFormatReply, { kind: 'failed' }>): Extract<WhyFixCameToNothing, 'rateLimited' | 'callFailed'> =>
  failure.isRateLimited === true ? 'rateLimited' : 'callFailed';
export const withFixThatCameToNothing = (
  state: PageState,
  cellId: CellId,
  why: WhyFixCameToNothing,
  mayGoBetterAgain = false,
): PageState => ({
  ...state,
  formulaFromWords: {
    ...state.formulaFromWords,
    stage: null,
    fixThatCameToNothing: {
      cellId,
      atChangeCount: state.workbookChangeCount,
      isNoticeUp: true,
      mayGoBetterAgain,
      why,
    },
  },
});
export const TOO_MANY_OTHER_FIXES = 3;
export const functionsCalledIn = (text: string, decimalSign: DecimalSignName, withNameArgumentOnly = false): string[] => {
  let { tokens } = tokenizeFormulaText(text, decimalSign);
  let isCallAt = (index: number) => tokens[index]?.kind === 'name' && tokens[index + 1]?.kind === 'open';
  let takesNameArgument = (index: number) => {
    for (let at = index + 1, depth = 0; at < tokens.length; at += 1) {
      if (tokens[at]?.kind === 'open') depth += 1;
      if (tokens[at]?.kind === 'close' && (depth -= 1) === 0) return false;
      if (tokens[at]?.kind === 'name' && !isCallAt(at)) return true;
    }
    return false;
  };
  return tokens.flatMap(
    ({ text: tokenText }, index) =>
      isCallAt(index) && (!withNameArgumentOnly || takesNameArgument(index)) ? [upperCaseAsciiLetters(tokenText)] : [],
  );
};
export const withWhatSetsFixesApart = (fixes: FormulaWithResult[], decimalSign: DecimalSignName): FormulaWithResult[] =>
  fixes.map(({ formula, value }) => {
    let others = fixes.filter((other) => other.formula !== formula);
    let calledByOthers = new Set(others.flatMap((other) => functionsCalledIn(other.formula, decimalSign)));
    let [only, ...more] = [...new Set(functionsCalledIn(formula, decimalSign))].filter(
      (name) => !calledByOthers.has(name),
    );
    return only === undefined || more.length > 0 || !functionsCalledIn(formula, decimalSign, true).includes(only)
      ? {
          formula,
          value,
        }
      : {
          formula,
          value,
          setApartBy: only,
        };
  });
export const comeToSameValue = (value: ProposedFormulaResult, other: ProposedFormulaResult): boolean =>
  value.shown === other.shown || (other.result !== undefined && !differsFromResult(value, other.result));
export const formulaTokenLines = (text: string, decimalSign: DecimalSignName): string => `
${tokenizeFormulaText(text, decimalSign).tokens.map(({ text: tokenText }) => upperCaseAsciiLetters(tokenText).replaceAll('$', '')).join(`
`)}
`;
export const quotedTextsOf = (text: string, decimalSign: DecimalSignName): string[] =>
  tokenizeFormulaText(text, decimalSign).tokens.flatMap(({ kind, text: tokenText }) => (kind === 'text' ? [tokenText] : []));
export const quotesSpacedTextNotInWords = (formula: string, words: string, decimalSign: DecimalSignName): boolean =>
  quotedTextsOf(formula, decimalSign).some((text) => /\s/.test(text) && !quotedTextsOf(words, decimalSign).includes(text));
export const PLAIN_NUMBER_SHOWN_PATTERN = /^(?:[\p{Nd}\p{Zs}\p{Sc}.,'%()+\-/:]|(?<=\p{Nd})E(?=[+\-\p{Nd}]))*$/u;
export const TWO_CURRENCY_SIGNS_PATTERN = /\p{Sc}.*\p{Sc}/u;
export const UNSHOWABLE_CHARACTER_PATTERN =
  /(?!\u00AD|\u061C|[\u180B-\u180D]|\u180F|[\u200B-\u200F]|[\uFE00-\uFE0F]|[\u{E0100}-\u{E01EF}])[\u2800\p{C}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/gu;
export const UNSHOWABLE_CHARACTER_STAND_IN = String.fromCharCode(65533);
export const quoteShownText = (shown: string): string =>
  `"${shown
    .replaceAll(/[\t\n\r]+/g, ' ')
    .replaceAll(UNSHOWABLE_CHARACTER_PATTERN, UNSHOWABLE_CHARACTER_STAND_IN)
    .replaceAll('"', '""')}"`;
