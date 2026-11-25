import { isPromptDataTooLong } from '../../agent/prompt-text.ts';
import {
  withConditionalFormatsPane,
  isCardFarFromSelection,
  cellRangeKey,
  cellsToAskAgentAbout,
  cornerCellIdsOf,
  tableColumnsInAbout,
} from './pane-state.ts';
import { readsAsStored } from '../../model/workbook.ts';
import { splitConditionalFormatBrief, MAX_PICKED_TEXT_LENGTH, MAX_PICKED_CELLS_LISTED, suggestConditionalFormatsPrompt } from './agent-prompts.ts';
import { areasOfRuleRanges } from './descriptions.ts';
import { cellValueOf } from '../../model/cell-values.ts';
import { rowNumberAsStored } from '../../model/a1-references.ts';
import { ownRowOrderOfSheet } from '../../model/line-ids.ts';
import { conditionalRulesOfPane } from '../../state/queries.ts';
import { withNoEffects } from '../../state/transitions.ts';
import type { ConditionalFormatSuggestionsAnswer, SheetId } from '@open-artifact/sheets-core';
import type { CellId, WorkbookReads } from '../../model/workbook.ts';
import type { PageState } from '../../state/initial-state.ts';
import type { PageTransition } from '../../state/transitions.ts';
import type { ConditionalFormatBrief, PickedCells } from './agent-prompts.ts';
import type { AgentAbout, AgentAskAboutRules, ConditionalFormatsPane, LineRuns } from './pane-state.ts';
/** How the agent's search for more suggestions stands, as the pane tells it. */
export type AgentSuggestionsStatus = 'isLookedFor' | 'couldNotBeLookedFor' | 'canBeAskedFor' | 'isNone';
export function askAgentAboutRules(state: PageState, pane: ConditionalFormatsPane, ask: AgentAskAboutRules): PageTransition {
  let mayRetry = ask.about !== 'moreSuggestions' && ask.attempt < MOST_AGENT_ATTEMPTS;
  if (isPromptDataTooLong(ask.asked, mayRetry ? ROOM_KEPT_FOR_RETRY : 0)) return agentAskFailed(state, pane, ask.about);
  let askId = state.conditionalFormatsAskCount + 1;
  return {
    state: {
      ...withConditionalFormatsPane(state, {
        ...pane,
        agent: {
          ...ask,
          kind: 'isAsked',
          askId,
        },
      }),
      conditionalFormatsAskCount: askId,
    },
    effects: [
      {
        kind: 'askAgentAboutConditionalFormats',
        askId,
        asked: ask.asked,
      },
    ],
  };
}
export function lineRunsOfSheet(reads: WorkbookReads, sheetId: SheetId): LineRuns | null {
  let lines = readsAsStored(reads).linesOf(sheetId);
  if (lines === null) return null;
  let [rowRuns, columnRuns] = [lines.rows, lines.columns].map(
    (line) =>
      line.runsIn({
        firstIndex: 0,
        count: line.count,
      }),
  );
  return rowRuns === undefined || columnRuns === undefined
    ? null
    : {
        rows: rowRuns,
        columns: columnRuns,
      };
}
export function rulesBriefForAgent(
  reads: WorkbookReads,
  oneCorner: CellId,
  otherCorner: CellId,
): { told: ConditionalFormatBrief; linesAsTold: LineRuns } | null {
  let asTold = reads.conditionalFormatsAsAgentIsTold(oneCorner, otherCorner);
  let told = asTold === null ? null : splitConditionalFormatBrief(asTold);
  let linesAsTold = lineRunsOfSheet(reads, oneCorner.sheetId);
  return told === null || linesAsTold === null
    ? null
    : {
        told,
        linesAsTold,
      };
}
export function agentSuggestionsStatus(pane: ConditionalFormatsPane): AgentSuggestionsStatus | null {
  let { agent, forSelection, fromAgent } = pane;
  if (pane.editor !== null || isCardFarFromSelection(pane)) return null;
  let isAboutMore = 'about' in agent && agent.about === 'moreSuggestions';
  if (agent.kind === 'isAsked' && isAboutMore) return 'isLookedFor';
  if (canAskAgentForSuggestions(pane)) return isAboutMore ? 'couldNotBeLookedFor' : 'canBeAskedFor';
  return forSelection !== null &&
    fromAgent[cellRangeKey(cellsToAskAgentAbout(forSelection))] !== undefined &&
    !pane.shown.suggestions.some(({ isFromAgent }) => isFromAgent)
    ? 'isNone'
    : null;
}
export function selectedCellsForAgent(
  reads: WorkbookReads,
  sheetId: SheetId,
  { about, table }: Pick<ConditionalFormatSuggestionsAnswer, 'about' | 'table'>,
): PickedCells | null {
  let [aboutArea] = areasOfRuleRanges(reads, sheetId, [about]);
  let [recordsArea] = areasOfRuleRanges(reads, sheetId, [table.records]);
  if (aboutArea === undefined || recordsArea === undefined) return null;
  let { topRowIndex, leftColumnIndex, rowCount, columnCount } = aboutArea;
  if (topRowIndex <= recordsArea.topRowIndex && topRowIndex + rowCount >= recordsArea.topRowIndex + recordsArea.rowCount) return null;
  let shownAt = (rowIndex: number, columnIndex: number) => {
    let cellId = reads.cellIdAt(sheetId, rowIndex, columnIndex);
    let shown = cellId === null ? null : cellValueOf(reads.cellOnShowIn(cellId));
    return shown?.value === '' ? null : shown;
  };
  let holdAt = (rowIndex: number, columnIndex: number) => {
    let shown = shownAt(rowIndex, columnIndex);
    if (shown === null || shown.kind === 'error') return null;
    return shown.kind === 'text' ? shown.value.slice(0, MAX_PICKED_TEXT_LENGTH) : shown.value;
  };
  let labelOfRow = (rowIndex: number) => {
    for (let columnIndex = 0; columnIndex < leftColumnIndex; columnIndex += 1) {
      let hold = holdAt(rowIndex, columnIndex);
      if (typeof hold === 'string') return hold;
    }
    return null;
  };
  let columnIndexes = Array.from(
    {
      length: columnCount,
    },
    (unfilledSpot, offset) => leftColumnIndex + offset,
  );
  return {
    form: columnCount === 1 ? 'partOfAColumn' : rowCount === 1 ? 'oneRowAcross' : 'block',
    rowCount,
    columnCount,
    rows:
      rowCount * columnCount > MAX_PICKED_CELLS_LISTED
        ? null
        : Array.from(
            {
              length: rowCount,
            },
            (unfilledSpot, offset) => topRowIndex + offset,
          )
            .filter((rowIndex) => columnIndexes.some((columnIndex) => shownAt(rowIndex, columnIndex) !== null))
            .map(
              (rowIndex) => ({
                row: rowNumberAsStored(rowIndex, ownRowOrderOfSheet(reads, sheetId)),
                label: labelOfRow(rowIndex),
                holds: columnIndexes.map((columnIndex) => holdAt(rowIndex, columnIndex)),
              }),
            ),
  };
}
export function askAgentForMoreSuggestions(state: PageState, reads: WorkbookReads) {
  let pane: ConditionalFormatsPane | null = conditionalRulesOfPane(state);
  if (pane === null || pane.forSelection === null || !canAskAgentForSuggestions(pane)) return withNoEffects(state);
  let forCells = cellsToAskAgentAbout(pane.forSelection);
  let brief = rulesBriefForAgent(reads, ...cornerCellIdsOf(pane.sheetId, forCells));
  if (brief === null) return agentAskFailed(state, pane, 'moreSuggestions');
  let { told, linesAsTold } = brief;
  let shownRules = reads.conditionalFormatsByAddress(
    pane.sheetId,
    pane.shown.suggestions.flatMap(({ rules, isFromAgent }) => (isFromAgent ? [] : rules)),
  );
  let promptFor = (cells: PickedCells | null, withShownRules = true) =>
    suggestConditionalFormatsPrompt(told, withShownRules ? (shownRules ?? []).flatMap((rule) => rule ?? []) : [], cells);
  let selectedCells = selectedCellsForAgent(reads, pane.sheetId, {
    about: forCells,
    table: pane.forSelection.table,
  });
  let asked =
    [
      ...(selectedCells === null
        ? []
        : [
            selectedCells,
            {
              ...selectedCells,
              rows: null,
            },
          ]),
      null,
    ]
      .flatMap((cells) => [promptFor(cells), promptFor(cells, false)])
      .find((prompt) => !isPromptDataTooLong(prompt)) ?? promptFor(null, false);
  return askAgentAboutRules(state, pane, {
    about: 'moreSuggestions',
    forCells,
    areWholeColumns: selectedCells === null,
    asked,
    attempt: 1,
    linesAsTold,
  });
}
export const MOST_RULE_WORDS_FOR_AGENT = 2000;
export const MOST_AGENT_ATTEMPTS = 2;
export const ROOM_KEPT_FOR_RETRY = 4096;
export const agentAskFailed = (state: PageState, pane: ConditionalFormatsPane, about: AgentAbout): PageTransition => ({
  state: withConditionalFormatsPane(state, {
    ...pane,
    agent: {
      kind: 'hasFailed',
      about,
      isBeyondRules: false,
    },
  }),
  effects:
    pane.agent.kind === 'isAsked'
      ? [
          {
            kind: 'stopAskingAgentAboutConditionalFormats',
          },
        ]
      : [],
});
export const isAgentFreeForRules = ({ agent }: Pick<ConditionalFormatsPane, 'agent'>): boolean => agent.kind === 'isIdle' || agent.kind === 'hasFailed';
export const canAskAgentForSuggestions = (pane: ConditionalFormatsPane): boolean =>
  pane.editor === null &&
  pane.offer === null &&
  pane.forSelection !== null &&
  isAgentFreeForRules(pane) &&
  tableColumnsInAbout({
    about: cellsToAskAgentAbout(pane.forSelection),
    table: pane.forSelection.table,
  }).some(({ filled }) => filled > 0) &&
  pane.fromAgent[cellRangeKey(cellsToAskAgentAbout(pane.forSelection))] === undefined;
