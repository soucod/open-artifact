import type { RuleByAddress, RulesRead } from '@open-artifact/sheets-core';
import { isOverByteLimit } from '../../agent/prompt-text.ts';
/** What the agent is given: instructions in `words`, and the data they refer to in `data`. */
export interface AgentPrompt {
  words: string;
  data: string;
}
/** How rules are written, apart from what is known of the sheet (its `<sheet>` data). */
export interface ConditionalFormatBrief {
  howAllIsWritten: string;
  knownOfTheSheet: string;
}
/** What one picked cell holds, as the agent is told: `null` for nothing or an error. */
export type PickedHold = string | number | boolean | null;
export interface PickedRow {
  row: number;
  label: string | null;
  holds: PickedHold[];
}
/** The selected cells, as the agent is told how they lie in their table. */
export interface PickedCells {
  form: 'partOfAColumn' | 'oneRowAcross' | 'block';
  rowCount: number;
  columnCount: number;
  rows: PickedRow[] | null;
}
export function splitConditionalFormatBrief(brief: string): ConditionalFormatBrief | null {
  let dataStart = brief.lastIndexOf(SHEET_DATA_OPENING);
  return dataStart < 0 || !brief.endsWith(SHEET_DATA_CLOSING)
    ? null
    : {
        howAllIsWritten: brief.slice(0, dataStart),
        knownOfTheSheet: brief.slice(dataStart).trimEnd(),
      };
}
export function pickedCellsData(picked: PickedCells): string {
  let data = taggedJson('picked', picked);
  return isOverByteLimit(data, MAX_PICKED_DATA_BYTES)
    ? taggedJson('picked', {
        ...picked,
        rows: null,
      })
    : data;
}
export const CONDITIONAL_FORMAT_PROMPT_INTRO =
  'You set up conditional formatting in a spreadsheet app, for a person who is at work in a sheet. First comes how rules are written, then how what is known of the sheet is written, which is itself in the data, and last what is asked of you.';
export const SHEET_DATA_OPENING = `<sheet>
`;
export const SHEET_DATA_CLOSING = `
</sheet>
`;
export const ESCAPED_IN_DATA_PATTERN = /(?! )[<>\u2800\p{C}\p{Z}\p{Default_Ignorable_Code_Point}]/gu;
export const escapeAsUnicode = (text: string): string =>
  Array.from(
    {
      length: text.length,
    },
    (_, index) => `\\u${text.charCodeAt(index).toString(16).padStart(4, '0')}`,
  ).join('');
export const taggedJson = (tag: string, value: unknown): string => `<${tag}>
${JSON.stringify(value).replace(ESCAPED_IN_DATA_PATTERN, escapeAsUnicode)}
</${tag}>`;
export const MAX_CONDITIONAL_FORMAT_SUGGESTIONS = 3;
export const conditionalFormatPrompt = (
  { howAllIsWritten, knownOfTheSheet }: ConditionalFormatBrief,
  asked: string,
  ...moreData: string[]
): AgentPrompt => ({
  words: `${CONDITIONAL_FORMAT_PROMPT_INTRO}

${howAllIsWritten}
${asked}`,
  data: [knownOfTheSheet, ...moreData].join(`
`),
});
export const MAX_PICKED_CELLS_LISTED = 50;
export const MAX_PICKED_TEXT_LENGTH = 100;
export const MAX_PICKED_DATA_BYTES = 8192;
export const PICKED_ROWS_INSTRUCTIONS = `Every suggestion also has to keep to the rows of the selected cells: no RANGE in it reaches above their first row or below their last, even where the records go on. The person picked those rows, and a suggestion that gives a look to any other row is dropped, however useful.

How the selected cells lie in the table is in the data too, as JSON on the one line between <picked> and </picked>. form is "partOfAColumn", "oneRowAcross" for cells side by side in one row, or "block". rowCount and columnCount say how many rows and columns they take up. rows has each picked row in which a picked cell holds something: row is its number in the sheet, and holds has what each of its picked cells holds, from left to right: a number, dates among them, a text, true or false, and null for nothing or an error. label is the first text in that row to the left of the picked cells, which mostly says what the row is, and null if there is none. A text is cut off after ${MAX_PICKED_TEXT_LENGTH} characters. rows is null for more than ${MAX_PICKED_CELLS_LISTED} cells, or where they hold too much to tell.

Cells picked across a row whose columns hold the same kind of thing, such as one line of a budget over the years, are a series that runs across. Compare them with each other, and not with the cells above and below, which are other things: test theCellItself against a number or against one column of the same row, ask for the largest or smallest among just these cells, or lay a colorScale over just these cells.

Leave out a rule that would hold for none of the selected cells, or for all of them.

`;
export const suggestConditionalFormatsPrompt = (
  brief: ConditionalFormatBrief,
  offered: RuleByAddress[],
  picked: PickedCells | null,
): AgentPrompt =>
  conditionalFormatPrompt(
    brief,
    `For the selected cells the app already offers the person some rules, which only take counting. They are in the data, as a JSON list on the one line between <offered> and </offered>.

Suggest up to ${MAX_CONDITIONAL_FORMAT_SUGGESTIONS} more that take an understanding of what the data means: which values are good or bad, which columns belong together, what stops mattering once something else is true. Prefer whole rows where a row is one record. Pick colors by meaning. Suggest nothing that the sheet's rules or the app's offers already do, and nothing at all if nothing is worth it.

Every suggestion has to go by the selected cells: a TEST or an OPERAND in it looks at their column, alone or beside tests of other columns. Any other is dropped, however useful.

${picked === null ? '' : PICKED_ROWS_INSTRUCTIONS}A suggestion is a list of rules that the person takes or leaves as one, and most hold one rule. What they take is added to the sheet's rules and applies before them.

Answer with a JSON list of suggestions alone, such as [[RULE],[RULE,RULE]], or [] for none.`,
    taggedJson('offered', offered),
    ...(picked === null ? [] : [pickedCellsData(picked)]),
  );
export const CONDITIONAL_FORMAT_SCOPE_INSTRUCTIONS = `They ask it of the selected cells. Unless their words say otherwise, cells keeps to selected: no column and no row that is not selected. Of several selected columns, cells has only those whose kind fits the words: a plain number to compare with fits number, currency and percent, and not date, though a date is held as a number. Where their words name another column, cells is that column over the selected rows. Where they ask for whole rows, cells is the selected rows, and no others, across all the columns of the records. Where they speak of all or of every one, cells reaches over all the records. Where only one cell is selected, they mostly mean its whole column: take the rows of the records, unless their words speak of that one cell.

`;
export const NAMED_DAYS_INSTRUCTIONS = `A day that they name, such as Nov 20 or 11/5, stays that day: write it as a number, counted from today's. Only words that move with the days, such as today, overdue, this week or the next 7 days, are daysFromToday.

`;
export const LASTING_RULES_INSTRUCTIONS =
  "Rules do it only if they go on being right as days pass and as rows are added or changed. So answer [] where they could be right only today: for a calendar period that moves with today, such as this month, last month or next year, which no count of days from today follows; for a share of the cells, such as the upper third or the lowest 2%, which no fixed count follows; for the day of the week that a date falls on; for every other row; and for what is unusual for its column. What stays right is written as rules: a month, a year or a span of days that they name, such as in March or from June 1 to June 15, is fixed days; late, or due within two weeks, is counted from today; the best three, or the one cheapest, newest or longest, is a count; and a day's name in a column of texts is a text.";
export const conditionalFormatFromWordsPrompt = (
  brief: ConditionalFormatBrief,
  words: string,
  keepsToSelection: boolean,
  canChatTakeIt: boolean,
): AgentPrompt =>
  conditionalFormatPrompt(
    brief,
    `The person asks, in their own words: ${JSON.stringify(words)}

Write the rule or rules that do this. They are added to the sheet's rules and apply before them.

${keepsToSelection ? CONDITIONAL_FORMAT_SCOPE_INSTRUCTIONS : ''}${NAMED_DAYS_INSTRUCTIONS}Answer with the JSON list of rules alone. If such rules cannot do it, answer [].${canChatTakeIt ? ` ${LASTING_RULES_INSTRUCTIONS}` : ''}`,
  );
export const editConditionalFormatRulePrompt = (brief: ConditionalFormatBrief, rule: RuleByAddress, words: string): AgentPrompt =>
  conditionalFormatPrompt(
    brief,
    `The person is editing one rule of the sheet's. It is in the data, as a JSON list of that one rule on the one line between <edited> and </edited>.

They ask, in their own words: ${JSON.stringify(words)}

Write the rule as it should be now, changing only what they ask for. It takes the place of the rule as it is, where that stands among the sheet's rules.

Answer with a JSON list of that one rule alone. If it cannot be done, answer [].`,
    taggedJson('edited', [rule]),
  );
export const refusedAnswerPrompt = (answer: unknown, why: Exclude<RulesRead, { kind: 'rules' }>): AgentPrompt => ({
  words:
    'You answered that with the list that is in the data, on the one line between <refused> and </refused>. That list cannot be taken. Why not is in the data too, on the one line between <why> and </why>. Write the whole list again, and nothing else.',
  data: `${taggedJson('refused', answer)}
${taggedJson('why', why)}`,
});
export const suggestionsFromAnswer = (answer: unknown): unknown[] =>
  Array.isArray(answer) ? answer.slice(0, MAX_CONDITIONAL_FORMAT_SUGGESTIONS) : [];
export const rulesFromAnswer = (answer: unknown): unknown[] | null => (Array.isArray(answer) && answer.length > 0 ? answer : null);
export const isNoRulesAnswer = (answer: unknown): boolean => Array.isArray(answer) && answer.length === 0;
