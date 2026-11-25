import { UNREADABLE_PATTERN_REFUSALS, sampleValueOfFormatKind, choiceOfPattern, EMPTY_SHOWN_UNDER_PATTERN } from './number-format-choices.ts';
import { cellValueOf } from '../model/cell-values.ts';
import { activeAnchorCell, isSameSelection } from '../selection/model.ts';
import { isGeneralPattern, DEFAULT_CELL_FORMAT } from '../model/cell-format.ts';
import { newAwaitedHold, asLandedHold } from './answer-holds.ts';
import { checkAgentForFormulas } from '../formulas/from-words/offer.ts';
import { withNoEffects } from '../state/transitions.ts';
import { sanitizeCellText } from '../model/cell-text.ts';
import {
  MAX_PATTERN_LENGTH_FOR_AGENT,
  looksLikeWordsNotPattern,
  numberFormatFromWordsRequest,
  currencySignPlacement,
  ownDatePatternOf,
  SAMPLE_DATE_SERIAL,
  readPatternAnswer,
} from './custom-format-agent.ts';
import { dayMonthOrderOf } from '../import/import-basics.ts';
import { DEFAULT_TIME_OF_DAY_PATTERN } from '../model/workbook.ts';
import { ADDRESS_LIKE_PATTERN } from '../formulas/from-words/ask-agent.ts';
import { cleanTextForAgent } from '../agent/prompt-text.ts';
import type { AnswerHold, CustomNumberFormat, PageState } from '../state/initial-state.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { PageEvent } from '../state/event-reducer.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { CustomFormatProblem } from '../i18n/format-labels.ts';
import type { Edit, NumberFormat, ValueIn } from '@open-artifact/sheets-core';
/** Where a custom pattern is typed: the custom format dialog, or the search field of the list of number formats. */
export type CustomPatternTypedIn = 'dialog' | 'list';
/** What a typed custom pattern reads as. */
export type CustomPatternReading =
  | { kind: 'nothingTyped' }
  | { kind: 'refused'; why: CustomFormatProblem }
  | { kind: 'numberFormat'; numberFormat: NumberFormat; example: string | null };
/** Why an ask of the agent for a number format gave no pattern. */
export type WhyAgentCameToNothing = 'notAvailable' | 'callFailed' | 'noFormat';
/**
 * Where the agent stands with a custom pattern: asked to write it from the typed words, wrote it, came to nothing,
 * had its pattern typed on, or was waved off.
 */
export type CustomFormatAgent =
  | { kind: 'asked'; askId: number }
  | { kind: 'wrote'; words: string }
  | { kind: 'cameToNothing'; why: WhyAgentCameToNothing; isOfAskInList?: true }
  | { kind: 'typedOn' }
  | { kind: 'wavedOff' };
/** How a custom pattern is being typed. */
export interface HowPatternIsTyped {
  hasHeldTextOfOthers: boolean;
  typedIn: CustomPatternTypedIn;
}
/** How the agent's reply to an ask for a number format came out. */
export type NumberFormatReply =
  | { kind: 'notToBeHad' }
  | { kind: 'stopped' }
  | { kind: 'failed'; isRateLimited?: true }
  | { kind: 'answered'; answer: unknown; isMended?: true };
export function whyPatternRefused(refusal: string): CustomFormatProblem {
  if (refusal === 'characterNeedsQuotes') return 'textNeedsQuotationMarks';
  if (refusal === 'numberFormatNotPrintedYet') return 'notPrintedYet';
  return UNREADABLE_PATTERN_REFUSALS.has(refusal) ? 'unreadable' : 'notJudged';
}
export function readTypedPattern(state: PageState, reads: WorkbookReads, typed: string): CustomPatternReading {
  if (typed === '')
    return {
      kind: 'nothingTyped',
    };
  let activeValue = cellValueOf(reads.cellOnShowIn(activeAnchorCell(state, reads)));
  let patternRead = reads.patternRead(
    isGeneralPattern(typed) ? DEFAULT_CELL_FORMAT.numberFormat.pattern : typed,
    (formatKind) => (activeValue?.kind === 'number' ? activeValue.value : sampleValueOfFormatKind(formatKind)),
  );
  if (patternRead === null)
    return {
      kind: 'refused',
      why: 'notJudged',
    };
  if (patternRead.kind === 'refused')
    return {
      kind: 'refused',
      why: whyPatternRefused(patternRead.refusal),
    };
  let { numberFormat, shown } = patternRead;
  if (shown.kind === 'text')
    return {
      kind: 'numberFormat',
      numberFormat,
      example: shown.text,
    };
  return shown.reason === 'notPrintedYet'
    ? {
        kind: 'refused',
        why: 'notPrintedYet',
      }
    : {
        kind: 'numberFormat',
        numberFormat,
        example: null,
      };
}
export function nextAnswerHold(agent: CustomFormatAgent | null, hold: AnswerHold | null, typedIn: CustomPatternTypedIn): AnswerHold | null {
  if (agent?.kind === 'asked') return hold?.answerId === agent.askId ? hold : newAwaitedHold(agent.askId);
  if (!(agent?.kind === 'wrote' || (agent?.kind === 'cameToNothing' && (agent.why === 'callFailed' || typedIn === 'list')))) return null;
  return hold?.stands === 'seen' ? hold : asLandedHold(hold ?? newAwaitedHold(0));
}
export function sharedCustomPatternOf({ formatOfSelection }: Pick<PageState, 'formatOfSelection'>): string | null {
  let pattern = formatOfSelection.shared.numberFormat?.pattern;
  return pattern === undefined || pattern === DEFAULT_CELL_FORMAT.numberFormat.pattern ? null : pattern;
}
export function listAskOfPattern({ customNumberFormat }: Pick<PageState, 'customNumberFormat'>, pattern: string): CustomFormatAgent | null {
  if (customNumberFormat?.typedIn !== 'list' || customNumberFormat.pattern.trim() !== pattern) return null;
  return customNumberFormat.agent?.kind === 'cameToNothing' && customNumberFormat.agent.why === 'noFormat'
    ? {
        ...customNumberFormat.agent,
        isOfAskInList: true,
      }
    : null;
}
export function openCustomFormatDialog(state: PageState, reads: WorkbookReads, pattern: string | null = null) {
  let opened = {
    ...state,
    pickForWorkbook: null,
    lastDone: null,
    notice: null,
  };
  if (pattern !== null)
    return checkAgentForFormulas(
      withNoEffects(
        withCustomPatternTyped(
          opened,
          reads,
          sanitizeCellText(pattern),
          {
            hasHeldTextOfOthers: false,
            typedIn: 'dialog',
          },
          listAskOfPattern(state, pattern),
        ),
      ),
    );
  let sharedPattern = sharedCustomPatternOf(state);
  let hasShared = sharedPattern !== null;
  return checkAgentForFormulas(
    withNoEffects(
      withCustomPatternTyped(
        opened,
        reads,
        sharedPattern ?? '',
        {
          hasHeldTextOfOthers: hasShared,
          typedIn: 'dialog',
        },
        hasShared
          ? {
              kind: 'typedOn',
            }
          : null,
      ),
    ),
  );
}
export function keepsTypedOn(
  { pattern, agent, hasHeldTextOfOthers }: CustomNumberFormat,
  typed: string,
  isOfUndoOrRedo: boolean,
): boolean {
  if (isOfUndoOrRedo) return hasHeldTextOfOthers;
  let startsAnew = typed.length <= 1 || (pattern[0] !== typed[0] && pattern.at(-1) !== typed.at(-1));
  return (agent?.kind === 'wrote' || agent?.kind === 'typedOn') && !startsAnew;
}
export function typeCustomPattern(state: PageState, reads: WorkbookReads, typed: string, isOfUndoOrRedo: boolean): PageTransition {
  let customNumberFormat = state.customNumberFormat;
  if (customNumberFormat === null) return withNoEffects(state);
  let cleanTyped = sanitizeCellText(typed);
  let agentMark: CustomFormatAgent | null = keepsTypedOn(customNumberFormat, cleanTyped, isOfUndoOrRedo)
    ? {
        kind: 'typedOn',
      }
    : null;
  return withNoEffects(withCustomPatternTyped(state, reads, cleanTyped, customNumberFormat, agentMark));
}
export function typeCustomPatternInList(state: PageState, reads: WorkbookReads, typed: string) {
  let clipped = typed.slice(0, MAX_TYPED_PATTERN_LENGTH).replace(/[\uD800-\uDBFF]$/, '');
  let customNumberFormat = state.customNumberFormat;
  if (customNumberFormat?.typedIn === 'dialog' || state.contextBarMenu !== 'numberFormat') return withNoEffects(state);
  if (clipped.trim() === '')
    return withNoEffects({
      ...state,
      customNumberFormat: null,
    });
  if (customNumberFormat === null)
    return checkAgentForFormulas(
      withNoEffects(
        withCustomPatternTyped(state, reads, sanitizeCellText(clipped), {
          hasHeldTextOfOthers: false,
          typedIn: 'list',
        }),
      ),
    );
  let withWords =
    customNumberFormat.agent?.kind === 'wrote' ? withCustomPatternTyped(state, reads, customNumberFormat.agent.words, customNumberFormat) : state;
  return typeCustomPattern(withWords, reads, clipped, false);
}
export function customPatternListText({ customNumberFormat }: Pick<PageState, 'customNumberFormat'>): string {
  if (customNumberFormat?.typedIn !== 'list') return '';
  return customNumberFormat.agent?.kind === 'wrote' ? customNumberFormat.agent.words : customNumberFormat.pattern;
}
export function closeListCustomFormat(before: PageState, step: PageTransition, event: PageEvent): PageTransition {
  let { customNumberFormat, contextBarMenu } = step.state;
  if (contextBarMenu !== 'numberFormat')
    return customNumberFormat?.typedIn !== 'list'
      ? step
      : withStopAskingEffect(step.state, {
          ...step,
          state: {
            ...step.state,
            customNumberFormat: null,
          },
        });
  return customNumberFormat === null &&
    before.customNumberFormat?.typedIn === 'list' &&
    (event.kind === 'editAnswered' || event.kind === 'customNumberFormatEntered')
    ? {
        ...step,
        state: {
          ...step.state,
          contextBarMenu: null,
        },
      }
    : step;
}
export function canAskAgentForFormat({ customNumberFormat, formulaFromWords }: Pick<PageState, 'customNumberFormat' | 'formulaFromWords'>): boolean {
  if (customNumberFormat === null || formulaFromWords.agent !== 'available') return false;
  let { pattern, reading, agent } = customNumberFormat;
  return (
    (agent === null || (agent.kind === 'cameToNothing' && agent.why === 'callFailed')) &&
    pattern.length <= MAX_PATTERN_LENGTH_FOR_AGENT &&
    reading.kind === 'refused' &&
    (reading.why === 'textNeedsQuotationMarks' || reading.why === 'unreadable') &&
    looksLikeWordsNotPattern(pattern)
  );
}
export function askAgentForNumberFormat(state: PageState, reads: WorkbookReads): PageTransition {
  let { customNumberFormat, formulaFromWords } = state;
  if (customNumberFormat === null) return withNoEffects(state);
  let askId = formulaFromWords.askCount + 1;
  let sharedPattern = sharedCustomPatternOf(state);
  let isSharedReadable = sharedPattern !== null && readTypedPattern(state, reads, sharedPattern).kind === 'numberFormat';
  return {
    state: {
      ...withAgentOfCustomFormat(
        state,
        {
          ...customNumberFormat,
          isRefusalTold: false,
        },
        {
          kind: 'asked',
          askId,
        },
      ),
      formulaFromWords: {
        ...formulaFromWords,
        askCount: askId,
      },
    },
    effects: [
      {
        kind: 'askAgentForANumberFormat',
        askId,
        asked: numberFormatFromWordsRequest(customNumberFormat.pattern.trim(), isSharedReadable ? sharedPattern : null, {
          orderOfDayAndMonth: dayMonthOrderOf(reads),
          signsOfNumbers: reads.signsOfNumbers,
          currencySign: currencySignPlacement(reads.locale),
          clock: reads.patternOfATimeOfDay === DEFAULT_TIME_OF_DAY_PATTERN ? 'twelveHours' : 'twentyFourHours',
          ownDate: ownDatePatternOf(
            reads.shownWithRoomForAll(
              {
                kind: 'number',
                value: SAMPLE_DATE_SERIAL,
              },
              'm/d/yyyy',
            ),
          ),
        }),
      },
    ],
  };
}
export function patternShowsOddText(reads: WorkbookReads, pattern: string): boolean {
  let testNumbers = [...pattern.matchAll(CONDITION_NUMBER_PATTERN)]
    .map(([, digits]) => Number(digits))
    .flatMap((number) => [number - 1, number, number + 1, number * 2, number / 2])
    .filter((number) => Number.isFinite(number))
    .map(
      (number): ValueIn => ({
        kind: 'number',
        value: number,
      }),
    );
  return [
    pattern,
    ...[...PATTERN_TEST_VALUES, ...testNumbers].map((testValue) => reads.shownWithRoomForAll(testValue, pattern)),
  ].some((shown) => shown !== null && ADDRESS_LIKE_PATTERN.test(shown));
}
export function patternEchoesWords(reads: WorkbookReads, pattern: string, words: string): boolean {
  let shownHuge = reads.shownWithRoomForAll(
    {
      kind: 'number',
      value: 1000000000000000000000000000000,
    },
    pattern,
  );
  return shownHuge !== null && normalizedWords(shownHuge) === normalizedWords(cleanTextForAgent(words));
}
export function takeNumberFormatAnswer(state: PageState, reads: WorkbookReads, askId: number, reply: NumberFormatReply): PageState {
  let { customNumberFormat, formulaFromWords } = state;
  if (customNumberFormat?.agent?.kind !== 'asked' || customNumberFormat.agent.askId !== askId) return state;
  let cameToNothing = (why: WhyAgentCameToNothing) =>
    withAgentOfCustomFormat(state, customNumberFormat, {
      kind: 'cameToNothing',
      why,
    });
  switch (reply.kind) {
    case 'notToBeHad':
      return {
        ...cameToNothing('notAvailable'),
        formulaFromWords: {
          ...formulaFromWords,
          agent: 'notToBeHad',
        },
      };
    case 'stopped':
      return withAgentOfCustomFormat(state, customNumberFormat, null);
    case 'failed':
      return cameToNothing('callFailed');
    case 'answered': {
      let pattern = readPatternAnswer(reply.answer);
      if (pattern === null) return cameToNothing('noFormat');
      let wrote: CustomFormatAgent = {
        kind: 'wrote',
        words: customNumberFormat.pattern,
      };
      let withPattern = withCustomPatternTyped(state, reads, pattern, customNumberFormat, wrote);
      return withPattern.customNumberFormat?.reading.kind === 'numberFormat' &&
        !patternShowsOddText(reads, pattern) &&
        !patternEchoesWords(reads, pattern, customNumberFormat.pattern)
        ? withPattern
        : cameToNothing('noFormat');
    }
  }
}
export function leaveCustomFormat(state: PageState, reads: WorkbookReads) {
  let customNumberFormat = state.customNumberFormat;
  if (customNumberFormat === null) return state;
  if (canAskAgentForFormat(state) && customNumberFormat.typedIn === 'list') return state;
  if (canAskAgentForFormat(state))
    return customNumberFormat.isRefusalTold
      ? {
          ...state,
          customNumberFormat: null,
        }
      : withAgentOfCustomFormat(state, customNumberFormat, {
          kind: 'wavedOff',
        });
  let isNothingOfDialog = customNumberFormat.agent?.kind === 'cameToNothing' && !customNumberFormat.agent.isOfAskInList;
  if (customNumberFormat.agent?.kind === 'asked' || isNothingOfDialog) return withAgentOfCustomFormat(state, customNumberFormat, null);
  if (customNumberFormat.agent?.kind === 'wrote') return withCustomPatternTyped(state, reads, customNumberFormat.agent.words, customNumberFormat);
  return {
    ...state,
    customNumberFormat: null,
  };
}
export function withStopAskingEffect(before: PageState, step: PageTransition): PageTransition {
  let agent = before.customNumberFormat?.agent;
  return agent?.kind !== 'asked' || step.state.customNumberFormat?.agent === agent
    ? step
    : {
        ...step,
        effects: [
          ...step.effects,
          {
            kind: 'stopAskingAgentForAFormula',
          },
        ],
      };
}
export function formatOfCustomPattern({ reading }: CustomNumberFormat, reads: WorkbookReads) {
  if (reading.kind !== 'numberFormat') return null;
  let choice = choiceOfPattern(reading.numberFormat.pattern, reads);
  return choice === null
    ? {
        customNumberFormat: reading.numberFormat,
      }
    : {
        numberFormatChoice: choice,
      };
}
export function afterFormatApplied(customNumberFormat: CustomNumberFormat | null, edit: Edit, refusal: string | null): CustomNumberFormat | null {
  if (customNumberFormat === null || !isCustomPatternApplied(customNumberFormat, edit)) return customNumberFormat;
  if (refusal !== 'numberFormatNotPrintedYet') return null;
  let reading: CustomPatternReading = {
    kind: 'refused',
    why: whyPatternRefused(refusal),
  };
  let { hold, ...rest } = withPatternReading(customNumberFormat, reading);
  let isNewHold = hold !== null && hold !== customNumberFormat.hold;
  return {
    ...rest,
    // A new hold is never null.
    hold: isNewHold
      ? {
          ...hold!,
          actsHeld: hold!.actsHeld + 1,
        }
      : hold,
    isRefusalTold: true,
  };
}
export function rereadCustomPattern(before: PageState, state: PageState, reads: WorkbookReads): PageState {
  let customNumberFormat = state.customNumberFormat;
  if (customNumberFormat === null || customNumberFormat !== before.customNumberFormat) return state;
  if (!isSameSelection(before, state))
    return {
      ...state,
      customNumberFormat: null,
    };
  if (state.workbookChangeCount === before.workbookChangeCount && state.formulasWorkedOutCount === before.formulasWorkedOutCount) return state;
  let reading = readTypedPattern(state, reads, patternToRead(customNumberFormat));
  return customNumberFormat.reading.kind === 'refused' && reading.kind === 'numberFormat'
    ? state
    : {
        ...state,
        customNumberFormat: withPatternReading(customNumberFormat, reading),
      };
}
export const patternToRead = ({ pattern, typedIn, agent }: Pick<CustomNumberFormat, 'pattern' | 'typedIn' | 'agent'>): string =>
  typedIn === 'list' && agent?.kind !== 'wrote' ? pattern.trim() : pattern;
export const withCustomPatternTyped = (
  state: PageState,
  reads: WorkbookReads,
  pattern: string,
  { hasHeldTextOfOthers, typedIn }: HowPatternIsTyped,
  agent: CustomFormatAgent | null = null,
) => ({
  ...state,
  customNumberFormat: {
    pattern,
    reading: readTypedPattern(
      state,
      reads,
      patternToRead({
        pattern,
        typedIn,
        agent,
      }),
    ),
    isRefusalTold: false,
    agent,
    hold: nextAnswerHold(agent, state.customNumberFormat?.hold ?? null, typedIn),
    hasHeldTextOfOthers: hasHeldTextOfOthers || (agent?.kind === 'wrote' && typedIn === 'dialog'),
    typedIn,
    shownUnderPattern: EMPTY_SHOWN_UNDER_PATTERN,
  },
});
export const MAX_TYPED_PATTERN_LENGTH = 300;
export const withAgentOfCustomFormat = (state: PageState, customNumberFormat: CustomNumberFormat, agent: CustomFormatAgent | null) => ({
  ...state,
  customNumberFormat: {
    ...customNumberFormat,
    agent,
    hold: nextAnswerHold(agent, customNumberFormat.hold, customNumberFormat.typedIn),
  },
});
export const PATTERN_TEST_VALUES: ValueIn[] = [
  {
    kind: 'number',
    value: 1234.5,
  },
  {
    kind: 'number',
    value: -1234.5,
  },
  {
    kind: 'number',
    value: 1e9,
  },
  {
    kind: 'number',
    value: -1e9,
  },
  {
    kind: 'number',
    value: 0.3,
  },
  {
    kind: 'number',
    value: -0.3,
  },
  {
    kind: 'number',
    value: 0,
  },
  {
    kind: 'text',
    value: 'a',
  },
];
export const CONDITION_NUMBER_PATTERN = /\[(?:<=|>=|<>|[<>=])\s*([-+]?[\d.]+(?:e[-+]?\d+)?)\s*\]/gi;
export const normalizedWords = (words: string): string => words.replaceAll(/\s+/gu, ' ').trim().toLowerCase();
export const withRefusalTold = (customNumberFormat: CustomNumberFormat): CustomNumberFormat =>
  customNumberFormat.reading.kind === 'refused'
    ? {
        ...customNumberFormat,
        isRefusalTold: true,
      }
    : customNumberFormat;
export const withPatternReading = (customNumberFormat: CustomNumberFormat, reading: CustomPatternReading) => ({
  ...customNumberFormat,
  reading,
  hold:
    customNumberFormat.hold !== null &&
    customNumberFormat.hold.stands !== 'awaited' &&
    customNumberFormat.typedIn === 'list' &&
    reading.kind !== customNumberFormat.reading.kind
      ? {
          ...asLandedHold(customNumberFormat.hold),
          answerId: -customNumberFormat.hold.answerId - 1,
        }
      : customNumberFormat.hold,
});
export const isCustomPatternApplied = (customNumberFormat: CustomNumberFormat, edit: Edit): boolean =>
  customNumberFormat.reading.kind === 'numberFormat' &&
  edit.kind === 'formatCells' &&
  edit.format.numberFormat?.pattern === customNumberFormat.reading.numberFormat.pattern;
