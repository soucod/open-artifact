import { translateMessage, MESSAGE_LOCALE } from './messages.ts';
import { undoAgentChangesLabel } from './change-labels.ts';
import { truncateGraphemes, SHEET_NAME_IN_NOTICE_MAX_CHARACTERS } from './grid-action-labels.ts';
import { columnLetters } from '../model/a1-references.ts';
import type { WrittenOfTurn } from '../agent/turn-of-agent.ts';
/** The cells the agent changed in one turn, as told to the user. */
export interface CellsChangedByAgent {
  count: number;
  isInSeveralSheets: boolean;
  /** The one sheet the changes were on, when it is not the sheet in view. */
  otherSheet: string | null;
  sheetNames: readonly string[];
  /** The changed areas of the sheet, in A1 notation. */
  places: readonly string[];
}
/** What the agent did in one turn; `cells` is null when it changed no cells. */
export interface ChangesByAgent {
  cells: CellsChangedByAgent | null;
}
/** Why the agent's changes were not undone. */
export type AgentUndoRefusalWhy =
  | 'changedSince'
  | 'nothingToChange'
  | 'notAccepted'
  | 'refused'
  | 'fault'
  | 'tooMuch'
  | 'tookTooLong'
  | 'recordDoesNotMatch'
  | 'storeDoesNotKnowHow'
  | 'busy'
  | 'noAnswer'
  | 'storeMovedOn';
/** What is said about the agent's turn: it is still working, or what it changed. */
export type AgentTurnSaid =
  | { what: 'isWorking' }
  | {
      what: 'madeChanges';
      done?: ChangesByAgent;
      written?: WrittenOfTurn;
      isUndoOffered?: true;
    };
export function agentBubbleTips(isCoarsePointer: boolean): string[] {
  let keyboardTips = [
    translateMessage({
      defaultMessage: 'Type @ in a cell to add a person, date, or dropdown.',
      id: 'S15ClZdf4W',
    }),
    translateMessage({
      defaultMessage: 'Type = in a cell to start a formula.',
      id: 'J3etNwDo91',
    }),
    translateMessage({
      defaultMessage: 'Double-click a cell to edit it.',
      id: 'cwEslVgIka',
    }),
  ];
  return [
    agentIsWorkingText(),
    translateMessage({
      defaultMessage: 'Select any cells to ask Agent about them.',
      id: '2gHOZcW9SH',
    }),
    ...(isCoarsePointer ? [] : keyboardTips),
    translateMessage({
      defaultMessage: 'Ask Agent to change anything in this sheet.',
      id: 'yTMgS2Z6mK',
    }),
  ];
}
export function agentTurnSaidText(said: AgentTurnSaid): string {
  if (said.what === 'isWorking') return agentIsWorkingText();
  let { isUndoOffered, ...turn } = said;
  let changesText = agentChangesText(turn);
  if (isUndoOffered !== true) return changesText;
  return translateMessage(
    {
      defaultMessage: '{done}. To undo Agent’s changes, use the “{button}” button.',
      id: 'yTcG0Ex0N2',
    },
    {
      done: changesText.replace(/\.$/, ''),
      button: undoAgentChangesLabel(),
    },
  );
}
export function agentWroteSomewhereText({ places, otherSheet }: Pick<WrittenOfTurn, 'places' | 'otherSheet'>): string {
  let placesListed = new Intl.ListFormat(MESSAGE_LOCALE).format(places);
  return otherSheet === null
    ? translateMessage(
        {
          defaultMessage: 'Agent made changes, including in {places}',
          id: 'tF9OhFsA71',
        },
        {
          places: placesListed,
        },
      )
    : translateMessage(
        {
          defaultMessage: 'Agent made changes, including on {sheet} in {places}',
          id: 'W6jWMbmj5t',
        },
        {
          places: placesListed,
          sheet: otherSheet,
        },
      );
}
export function agentChangesText(turn: { done?: ChangesByAgent; written?: WrittenOfTurn }): string {
  let placesText = turn.done === undefined ? null : agentUpdatedPlacesText(turn.done);
  if (placesText !== null) return placesText;
  if (turn.done !== undefined && turn.done.cells !== null) return agentUpdatedCellsText(turn.done);
  if (turn.written !== undefined) return agentWroteSomewhereText(turn.written);
  return translateMessage({
    defaultMessage: 'Agent made changes',
    id: 'ez9cJ/5p6E',
  });
}
export function agentUpdatedPlacesText({ cells }: ChangesByAgent): string | null {
  if (cells === null) return null;
  let { count, otherSheet, sheetNames } = cells;
  if (sheetNames.length > 1 && !areSheetNamesListable(sheetNames)) return null;
  if (sheetNames.length > 1)
    return translateMessage(
      {
        defaultMessage: '{cellCount, plural, one {Agent updated # cell on {sheets}} other {Agent updated # cells on {sheets}}}',
        id: '6ADChVdLiT',
      },
      {
        cellCount: count,
        sheets: new Intl.ListFormat(MESSAGE_LOCALE).format(sheetNames),
      },
    );
  if (cells.places.length === 0) return null;
  let places = new Intl.ListFormat(MESSAGE_LOCALE).format(cells.places);
  return otherSheet === null
    ? translateMessage(
        {
          defaultMessage: '{cellCount, plural, one {Agent updated # cell in {places}} other {Agent updated # cells in {places}}}',
          id: 'NcwhFlnXGr',
        },
        {
          cellCount: count,
          places,
        },
      )
    : translateMessage(
        {
          defaultMessage:
            '{cellCount, plural, one {Agent updated # cell on {sheet}, in {places}} other {Agent updated # cells on {sheet}, in {places}}}',
          id: 'R+WVAZydkv',
        },
        {
          cellCount: count,
          sheet: otherSheet,
          places,
        },
      );
}
export function agentUpdatedCellsText({ cells }: ChangesByAgent): string {
  if (cells === null)
    return translateMessage({
      defaultMessage: 'Agent updated this Sheet',
      id: 'DUQk1fopcj',
    });
  let { count, isInSeveralSheets, otherSheet } = cells;
  if (otherSheet !== null)
    return translateMessage(
      {
        defaultMessage: '{cellCount, plural, one {Agent updated # cell on {sheet}} other {Agent updated # cells on {sheet}}}',
        id: 'RZq70lyM8T',
      },
      {
        cellCount: count,
        sheet: truncateGraphemes(otherSheet, SHEET_NAME_IN_NOTICE_MAX_CHARACTERS),
      },
    );
  if (isInSeveralSheets)
    return translateMessage(
      {
        defaultMessage: '{cellCount, plural, one {Agent updated # cell on several sheets} other {Agent updated # cells on several sheets}}',
        id: 'LSO/e2D02K',
      },
      {
        cellCount: count,
      },
    );
  return translateMessage(
    {
      defaultMessage: '{cellCount, plural, one {Agent updated # cell} other {Agent updated # cells}}',
      id: 'CJOMlCgwXg',
    },
    {
      cellCount: count,
    },
  );
}
export function agentUndoRefusalText({ why }: { why: AgentUndoRefusalWhy }): string {
  switch (why) {
    case 'changedSince':
      return translateMessage({
        defaultMessage:
          'Agent’s changes can’t be undone on their own, because some of the same cells have changed since. You can restore an earlier version from Version history.',
        id: 'fO2Ld7Hdn6',
      });
    case 'nothingToChange':
      return translateMessage({
        defaultMessage: 'Agent’s changes are already undone.',
        id: 'vpFBwL+C/4',
      });
    case 'notAccepted':
    case 'refused':
    case 'fault':
      return translateMessage({
        defaultMessage: 'Agent’s changes can’t be undone. You can restore an earlier version from Version history.',
        id: 'qJ/SPDccgY',
      });
    case 'tooMuch':
    case 'tookTooLong':
    case 'recordDoesNotMatch':
    case 'storeDoesNotKnowHow':
      return translateMessage({
        defaultMessage: 'Agent’s changes can’t be undone.',
        id: 'aKofuC80Wh',
      });
    case 'busy':
    case 'noAnswer':
      return translateMessage({
        defaultMessage: 'Couldn’t undo Agent’s changes. Try again in a few minutes.',
        id: 'JTjfdjG2l4',
      });
    case 'storeMovedOn':
      return translateMessage({
        defaultMessage: 'The Sheet changed before Agent’s changes could be undone. Try again.',
        id: 'hPr9sEksvX',
      });
  }
}
export const agentIsWorkingText = (): string =>
  translateMessage({
    defaultMessage: 'Agent is working…',
    id: 'Hcg1/BIJPf',
  });
export const frozeRowsText = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, =0 {Unfroze rows} =1 {Froze row 1} one {Froze rows 1 to {last}} other {Froze rows 1 to {last}}}',
      id: 'J5M1qiAQ6J',
    },
    {
      count,
      last: String(count),
    },
  );
export const frozeColumnsText = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, =0 {Unfroze columns} =1 {Froze column A} one {Froze columns A to {last}} other {Froze columns A to {last}}}',
      id: 'JD6FPcsQfs',
    },
    {
      count,
      last: columnLetters(Math.max(0, count - 1)),
    },
  );
export const MAX_SHEET_NAMES_LISTED = 3;
export const areSheetNamesListable = (sheetNames: readonly string[]): boolean =>
  sheetNames.length <= MAX_SHEET_NAMES_LISTED &&
  sheetNames.every((name) => truncateGraphemes(name, SHEET_NAME_IN_NOTICE_MAX_CHARACTERS) === name);
