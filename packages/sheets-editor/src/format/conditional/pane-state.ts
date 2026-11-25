import type {
  CellCondition,
  Color,
  ColumnId,
  ConditionalFormatAsIf,
  ConditionalFormatContents,
  ConditionalFormatSuggestionsAnswer,
  Edit,
  Effect,
  FormatsGivenAnswer,
  IdRun,
  Matches,
  RangeCorners,
  RowId,
  RuleInIds,
  SheetId,
  TestedCell,
} from '@open-artifact/sheets-core';
import { withNoEffects } from '../../state/transitions.ts';
import { conditionalRulesOfPane } from '../../state/queries.ts';
import { closeSidePane } from '../../chips/dropdowns.ts';
import { isSameJsonValue } from '../../model/same-json.ts';
import { IF_QUEUED_DEFAULTS } from '../../model/edit-effects.ts';
import { withAddedTest } from './rule-edits.ts';
import type { FontMark, PageState } from '../../state/initial-state.ts';
import type { ColorProperty } from '../../i18n/format-labels.ts';
import type { PageTransition, QueueEditEffect } from '../../state/transitions.ts';
import type { IfQueued } from '../../state/event-reducer.ts';
import type { CellId, FormatsGiven, WorkbookReads } from '../../model/workbook.ts';
import type { CellArea } from '../../selection/model.ts';
import type {
  ConditionChoice,
  ConditionalFormatDone,
  OperandKind,
  RuleDescription,
  RuleEntry,
  RulePreset,
  ScaleAnchorKind,
  ScaleStop,
} from '../../messages/conditional-format.ts';
import type { AgentPrompt } from './agent-prompts.ts';
import type { TableOfRecords } from './conditions.ts';
import type { NumberOperandField, RuleEditorView } from './editor-view.ts';

/** How the conditional formats are drawn: in the side pane, on a card by the cells, or in the menu. */
export type ConditionalFormatsDrawnAs = 'pane' | 'card' | 'menu';

/** What the page offers for the selected cells, with where to ask the agent about and how the cells were found. */
export interface RulesForSelection extends ConditionalFormatSuggestionsAnswer {
  /** Cells wider than `about` to ask the agent about (a table's records, or the columns of a block). */
  toAskAgentAbout?: RangeCorners;
  isOverSeveralTables?: boolean;
  isInPlaceOfWhatIsSelected?: boolean;
  isFarFromWhatIsSelected?: boolean;
}

/** The ids of the rows and columns of a sheet, in order, as the agent was told them. */
export interface LineRuns {
  rows: IdRun[];
  columns: IdRun[];
}

/** What the agent is asked about rules. */
export type AgentAbout = 'moreSuggestions' | 'request' | 'change';

interface AgentAskOfAnyKind {
  asked: AgentPrompt;
  attempt: number;
  linesAsTold: LineRuns;
}

/** Asking the agent for more suggestions for some cells. */
export interface AskForMoreSuggestions extends AgentAskOfAnyKind {
  about: 'moreSuggestions';
  forCells: RangeCorners;
  /** Set when the agent is told the whole columns, not the selected cells. */
  areWholeColumns: boolean;
}

/** How far rules the agent writes may be stretched: down to the end of the selection, past the last row it was told. */
export interface ReachOfAgentRules {
  selected: CellArea | null;
  lastRowTold: RowId;
}

/** Asking the agent for rules from the person's words. */
export interface AskForRulesFromWords extends AgentAskOfAnyKind {
  about: 'request';
  words: string;
  canChatTakeIt: boolean;
  reach: ReachOfAgentRules | null;
}

/** Asking the agent to change the rule being edited. */
export interface AskToChangeRule extends AgentAskOfAnyKind {
  about: 'change';
  words: string;
}

export type AgentAskAboutRules = AskForMoreSuggestions | AskForRulesFromWords | AskToChangeRule;

export type AgentAskedAboutRules = AgentAskAboutRules & { kind: 'isAsked'; askId: number };

export interface AgentFailedForRules {
  kind: 'hasFailed';
  about: AgentAbout;
  /** Set when the agent found the words ask for something rules cannot do. */
  isBeyondRules: boolean;
}

/** Where the agent stands with the rules pane. */
export type AgentForRules = { kind: 'isIdle' } | AgentAskedAboutRules | AgentFailedForRules | { kind: 'isNotToBeHad' };

/** The rule lists the agent suggested, by the key of the cells they were asked for (`cellRangeKey`). */
export type RulesOfAgentByCells = Record<string, RuleInIds[][]>;

/** The agent's rule lists for the selected cells, as last worked out: matches of each and the lists shown. */
export interface AgentRulesForSelection {
  written: RuleInIds[][];
  ofEach: { matches: Matches | null; mayGoOn: boolean }[];
  listed: RuleInIds[][];
}

/** The agent's suggestions kept when the menu or card closes, to show again on the same sheet and workbook. */
export interface KeptRulesOfAgent {
  sheetId: SheetId;
  workbookChangeCount: number;
  byCells: RulesOfAgentByCells;
  stillAsked: AgentAskedAboutRules | null;
}

/** A part of a test that is typed in. */
export type TestField = 'count' | 'text' | 'operand' | 'oneEnd' | 'otherEnd';

/** A box of the rule editor: the cells, a stop of a color scale, or a part of a test (`"0.text"`). */
export type RuleField = 'cells' | ScaleStop | `${number}.${TestField}`;

/** What is typed in a box of the rule editor, with the rule it gives (`null` when it gives none) and the rule the box opened on. */
export interface TypedInEditor {
  field: RuleField;
  text: string;
  rule: RuleInIds | null;
  ruleWithBox: RuleInIds | null;
}

/** A test being added to the rule, not saved until it has a condition. */
export interface TestBeingAdded {
  tested: TestedCell;
  condition: CellCondition | null;
}

/** Typing entered that gave no rule, with the rule it was typed over. */
export interface RefusedTyping {
  field: RuleField;
  text: string;
  over: RuleInIds;
}

/** Set when the page moved the rule's cells to a column of numbers. */
export type CellsPickedByPage = 'movedToNumbers' | null;

/** The rule open in the editor. */
export interface RuleEditorState {
  conditionalFormatId: string;
  table: TableOfRecords | null;
  cellsPickedByPage: CellsPickedByPage;
  typed: TypedInEditor | null;
  testBeingAdded: TestBeingAdded | null;
  refused?: RefusedTyping[];
}

/** Rules read from the person's words: the rules (stretched where they may be), as said, and what they give. */
export interface RulesReadFromWords {
  rules: RuleInIds[];
  asSaid: RuleInIds[];
  gives: FormatsGivenAnswer;
}

/** The words typed for rules, the day they were read on, and the rules read from them. */
export interface RulesInWords {
  words: string;
  /** The day, as an ISO date. */
  today: string;
  read: RulesReadFromWords | null;
  /** While the words are still being typed, the rules tried for the words before. */
  stillTried: RuleInIds[] | null;
}

/** The formats the sheet gives as if some rules were added or changed. */
export interface RulesPreviewed {
  asIf: ConditionalFormatAsIf[];
  gives: FormatsGivenAnswer | null;
}

/** A suggestion as the pane shows it. */
export interface ShownSuggestion {
  rules: RuleInIds[];
  toSay: RuleEntry;
  isFromAgent: boolean;
}

/** Rules shown with a description of each. */
export interface ShownRulesWithEach extends ShownSuggestion {
  each: RuleDescription[];
}

/** A rule of the sheet as the pane shows it. */
export interface ShownRule {
  conditionalFormatId: string;
  toSay: RuleDescription;
}

/** The cells the pane is about, as written, and the name of their column when they are one. */
export interface CellsShownAbout {
  cells: string;
  nameOfColumn: string | null;
}

/** The rule editor as the pane shows it. */
export interface ShownRuleEditor extends RuleEditorView {
  conditionalFormatId: string;
}

/** What the pane shows, as last worked out. */
export interface ShownInRulesPane {
  about: CellsShownAbout | null;
  suggestions: ShownSuggestion[];
  offer: ShownRulesWithEach | null;
  readAtOnce: ShownRulesWithEach | null;
  rules: ShownRule[];
  notWorkedOut: FormatsGiven['notWorkedOut'];
  editor: ShownRuleEditor | null;
}

/** The conditional formats open in the side pane, on a card or in the menu. */
export interface ConditionalFormatsPane {
  drawnAs: ConditionalFormatsDrawnAs;
  /** The words typed in the menu, when it opened from them. */
  wordsOfMenu: string | null;
  sheetId: SheetId;
  openedAtChangeCount: number;
  isAskedForRules: boolean;
  forSelection: RulesForSelection | null;
  fromAgent: RulesOfAgentByCells;
  ofAgentForSelection: AgentRulesForSelection | null;
  agent: AgentForRules;
  /** Rules the agent wrote, offered to keep. */
  offer: RuleInIds[] | null;
  /** The suggestion pointed at, previewed on the sheet. */
  pointedAt: RuleInIds[] | null;
  inWords: RulesInWords | null;
  editor: RuleEditorState | null;
  tried: ConditionalFormatAsIf[];
  previewed: RulesPreviewed | null;
  shown: ShownInRulesPane;
}

/** What is done in the rules pane (or its card or menu), with what it is done to. */
export type RulesPaneAction =
  | { kind: 'pointAtSuggestion'; rules: RuleInIds[] | null }
  | { kind: 'takeSuggestion'; rules: RuleInIds[] }
  | { kind: 'showInPane' }
  | { kind: 'askForMoreSuggestions' }
  | { kind: 'typeWords'; words: string; today: string }
  | { kind: 'restAfterWords'; words: string }
  | { kind: 'takeReadAtOnce'; words: string; today: string; canChatTakeIt: boolean }
  | { kind: 'askAgent'; words: string; canChatTakeIt: boolean }
  | { kind: 'keepOffer' }
  | { kind: 'editOffer' }
  | { kind: 'discardOffer' }
  /** Without `effect` the default rule for the selection is started. */
  | { kind: 'startRule'; effect?: Effect['kind'] }
  | { kind: 'editRule'; conditionalFormatId: string }
  | { kind: 'removeRule'; conditionalFormatId: string }
  | { kind: 'useSelectionFor'; conditionalFormatId: string }
  | { kind: 'moveRule'; conditionalFormatId: string; toIndex: number }
  | { kind: 'previewRested' }
  | { kind: 'stepBack' }
  | { kind: 'leaveEditor' }
  | { kind: 'chooseKindOfEffect'; effect: Effect['kind'] }
  | { kind: 'type'; field: RuleField; text: string }
  | { kind: 'enterTyped' }
  | { kind: 'dropTyped'; field: RuleField }
  | { kind: 'useSelection' }
  | { kind: 'chooseTested'; test: number; tested: TestedCell }
  | { kind: 'chooseCondition'; test: number; choice: ConditionChoice }
  | { kind: 'chooseOperand'; test: number; slot: NumberOperandField; choice: OperandKind }
  | { kind: 'chooseOperandColumn'; test: number; slot: NumberOperandField; c: ColumnId }
  | { kind: 'chooseDay'; test: number; slot: NumberOperandField; day: string }
  | { kind: 'chooseText'; test: number; text: string }
  | { kind: 'addTest' }
  | { kind: 'removeTest'; test: number }
  | { kind: 'choosePreset'; preset: RulePreset }
  | { kind: 'chooseColor'; property: ColorProperty; color: Color }
  | { kind: 'toggleStyle'; style: FontMark }
  | { kind: 'chooseAnchor'; stop: ScaleStop; choice: ScaleAnchorKind }
  | { kind: 'chooseStopDay'; stop: ScaleStop; day: string }
  | { kind: 'chooseStopColor'; stop: ScaleStop; color: Color }
  | { kind: 'setMiddleStop'; isOn: boolean };

/** Hands an action of the pane to the page; `onDone` is told whether the page changed for it. */
export type ActInRulesPane = (action: RulesPaneAction, onDone?: (isDone: boolean) => void) => void;

export function ruleOfConditionalFormat({ liveRanges, effect }: Pick<ConditionalFormatContents, 'liveRanges' | 'effect'>): RuleInIds | null {
  let [firstRange, ...otherRanges] = liveRanges;
  return firstRange === undefined
    ? null
    : {
        ranges: [firstRange, ...otherRanges],
        effect,
      };
}
export function conditionalFormatRuleById(reads: WorkbookReads, sheetId: SheetId, conditionalFormatId: string): RuleInIds | null {
  let conditionalFormat = reads
    .conditionalFormatsOf(sheetId)
    .find((format) => format.conditionalFormatId === conditionalFormatId);
  return conditionalFormat === undefined ? null : ruleOfConditionalFormat(conditionalFormat);
}
export function conditionalFormatChangeEffect(
  sheetId: SheetId,
  conditionalFormatId: string,
  oldRule: RuleInIds,
  newRule: RuleInIds,
  done: ConditionalFormatDone = {
    what: 'ruleChanged',
  },
): QueueEditEffect | null {
  let [isSameRanges, isSameEffect] = [isSameRulesJson(newRule.ranges, oldRule.ranges), isSameRulesJson(newRule.effect, oldRule.effect)];
  if (isSameRanges && isSameEffect) return null;
  return queueRuleEditEffect(
    {
      kind: 'changeConditionalFormat',
      sheetId,
      conditionalFormatId,
      ...(isSameRanges
        ? {}
        : {
            ranges: newRule.ranges,
          }),
      ...(isSameEffect
        ? {}
        : {
            effect: newRule.effect,
          }),
    },
    done,
  );
}
export function stepBackInRulesPane(state: PageState, pane: ConditionalFormatsPane): PageTransition {
  if (pane.offer !== null)
    return withNoEffects(
      withConditionalFormatsPane(state, {
        ...pane,
        offer: null,
      }),
    );
  if (!isAskingAgentForRules(pane)) return withNoEffects(state);
  return {
    state: {
      ...withConditionalFormatsPane(state, {
        ...pane,
        agent: {
          kind: 'isIdle',
        },
      }),
      lastDone: {
        what: 'agentStopped',
      },
    },
    effects: [
      {
        kind: 'stopAskingAgentAboutConditionalFormats',
      },
    ],
  };
}
export function clearChosenTestBeingAdded(state: PageState): PageState {
  let pane = conditionalRulesOfPane(state);
  let editor = pane?.editor ?? null;
  return pane === null || editor === null || (editor.testBeingAdded?.condition ?? null) === null
    ? state
    : withConditionalFormatsPane(state, {
        ...pane,
        editor: {
          ...editor,
          testBeingAdded: null,
        },
      });
}
export function dropUnfinishedTestBeingAdded(state: PageState): PageTransition | null {
  let pane = conditionalRulesOfPane(state);
  return pane?.editor?.testBeingAdded?.condition === null
    ? withNoEffects(
        withConditionalFormatsPane(state, {
          ...pane,
          editor: {
            ...pane.editor,
            testBeingAdded: null,
          },
        }),
      )
    : null;
}
export function rulesOfAgentKeptNow(state: PageState) {
  let rulesOfAgentKept = state.rulesOfAgentKept;
  return rulesOfAgentKept !== null && rulesOfAgentKept.sheetId === state.sheetId && rulesOfAgentKept.workbookChangeCount === state.workbookChangeCount
    ? rulesOfAgentKept
    : null;
}
export function withRulesOfAgentKept(state: PageState, pane: ConditionalFormatsPane): ConditionalFormatsPane {
  if (!isPlainRulesMenu(pane)) return pane;
  let kept = rulesOfAgentKeptNow(state);
  return {
    ...pane,
    fromAgent: kept?.byCells ?? {},
    agent: kept?.stillAsked ?? pane.agent,
  };
}
export function rulesOfAgentToKeep({ workbookChangeCount }: Pick<PageState, 'workbookChangeCount'>, pane: ConditionalFormatsPane): KeptRulesOfAgent {
  let isUnchanged = workbookChangeCount === pane.openedAtChangeCount;
  let isStillAsked = pane.agent.kind === 'isAsked' && isAskingAgentForMoreSuggestions(pane);
  return {
    sheetId: pane.sheetId,
    workbookChangeCount,
    byCells: isUnchanged ? pane.fromAgent : {},
    // `isStillAsked` holds only while the agent is asked.
    stillAsked: isUnchanged && isStillAsked ? (pane.agent as AgentAskedAboutRules) : null,
  };
}
export function openConditionalFormatsAs(state: PageState, drawnAs: ConditionalFormatsDrawnAs): PageState {
  let pane = conditionalRulesOfPane(state);
  if (pane?.drawnAs === 'menu' && drawnAs === 'card') {
    let rulesKept = isPlainRulesMenu(pane) ? state.rulesOfAgentKept : rulesOfAgentToKeep(state, pane);
    return openConditionalFormatsAs(
      {
        ...closeSidePane(state),
        rulesOfAgentKept: rulesKept,
      },
      'card',
    );
  }
  if (pane !== null) return pane.drawnAs !== 'pane' && drawnAs === 'pane' ? showRulesInPane(state, pane) : closeSidePane(state);
  let kept = rulesOfAgentKeptNow(state);
  return withConditionalFormatsPane(
    {
      ...state,
      menu: null,
      dropdown: null,
    },
    {
      drawnAs,
      wordsOfMenu: null,
      sheetId: state.sheetId,
      openedAtChangeCount: state.workbookChangeCount,
      isAskedForRules: false,
      forSelection: null,
      fromAgent: kept?.byCells ?? {},
      ofAgentForSelection: null,
      agent: kept?.stillAsked ?? {
        kind: 'isIdle',
      },
      offer: null,
      pointedAt: null,
      inWords: null,
      editor: null,
      tried: [],
      previewed: null,
      shown: NOTHING_SHOWN_IN_RULES_PANE,
      ...(state.hasViewNoAgentForRules && {
        agent: {
          kind: 'isNotToBeHad',
        },
      }),
    },
  );
}
export function openConditionalFormatsPane(state: PageState): PageState {
  let pane = conditionalRulesOfPane(state);
  if (pane === null) return openConditionalFormatsAs(state, 'pane');
  return pane.drawnAs !== 'pane'
    ? showRulesInPane(state, pane)
    : {
        ...state,
        menu: null,
        timesSidePaneAsked: state.timesSidePaneAsked + 1,
      };
}
export function tableColumnsInAbout({ about, table: { columns } }: Pick<ConditionalFormatSuggestionsAnswer, 'about' | 'table'>) {
  let firstIndex = columns.findIndex(({ c }) => c === about.topLeft.c);
  let lastIndex = columns.findIndex(({ c }) => c === about.bottomRight.c);
  return firstIndex === -1 ? [] : columns.slice(firstIndex, lastIndex === -1 ? undefined : lastIndex + 1);
}
export const CONDITIONAL_FORMATTING_PRESS = 'Conditional formatting';
export const NOTHING_SHOWN_IN_RULES_PANE: ShownInRulesPane = {
  about: null,
  suggestions: [],
  offer: null,
  readAtOnce: null,
  rules: [],
  notWorkedOut: null,
  editor: null,
};
export const isSameRulesJson = isSameJsonValue;
export const whatRuleLooksFor = ({ effect }: Pick<RuleInIds, 'effect'>) => (effect.kind === 'formatWhere' ? effect.allOf : effect.kind);
export const rangesAndLooksForOf = (rule: RuleInIds) => ({
  ranges: rule.ranges,
  looksFor: whatRuleLooksFor(rule),
});
export const areSameRulesIgnoringFormat = (rules: RuleInIds[], otherRules: RuleInIds[]): boolean =>
  isSameRulesJson(rules.map(rangesAndLooksForOf), otherRules.map(rangesAndLooksForOf));
export const cellRangeKey = ({ topLeft, bottomRight }: RangeCorners): string => JSON.stringify([topLeft, bottomRight]);
export const queueRuleEditEffect = (edit: Edit, done: ConditionalFormatDone, ifQueued: Partial<IfQueued> = {}): QueueEditEffect => ({
  kind: 'queueEdit',
  edit,
  ifQueued: {
    ...IF_QUEUED_DEFAULTS,
    select: null,
    done,
    leavesEntryOpen: true,
    ...ifQueued,
  },
});
export const withConditionalFormatsPane = (state: PageState, pane: ConditionalFormatsPane): PageState => ({
  ...state,
  sidePane: {
    kind: 'conditionalFormats',
    rules: pane,
  },
});
export const isAskingAgentForMoreSuggestions = ({ agent }: Pick<ConditionalFormatsPane, 'agent'>): boolean =>
  agent.kind === 'isAsked' && agent.about === 'moreSuggestions';
export const isAskingAgentForRules = ({ agent }: Pick<ConditionalFormatsPane, 'agent'>): boolean =>
  agent.kind === 'isAsked' && agent.about !== 'moreSuggestions';
export const isAgentOfferPendingOrAsked = (pane: Pick<ConditionalFormatsPane, 'offer' | 'agent'>): boolean =>
  pane.offer !== null || isAskingAgentForRules(pane);
export const ruleWithTestBeingAdded = (rule: RuleInIds, testBeingAdded: TestBeingAdded | null): RuleInIds =>
  rule.effect.kind === 'formatWhere' && testBeingAdded !== null && testBeingAdded.condition !== null
    ? {
        ...rule,
        effect: withAddedTest(rule.effect, {
          ...testBeingAdded,
          condition: testBeingAdded.condition,
        }),
      }
    : rule;
export const isPlainRulesMenu = (pane: Pick<ConditionalFormatsPane, 'drawnAs' | 'wordsOfMenu'> | null): boolean =>
  pane?.drawnAs === 'menu' && pane.wordsOfMenu === null;
export const showRulesInPane = (state: PageState, pane: ConditionalFormatsPane): PageState =>
  withConditionalFormatsPane(
    {
      ...state,
      menu: null,
      timesSidePaneAsked: state.timesSidePaneAsked + 1,
    },
    {
      ...withRulesOfAgentKept(state, pane),
      drawnAs: 'pane',
      wordsOfMenu: null,
      inWords: null,
    },
  );
export const cornerCellIdsOf = (sheetId: SheetId, { topLeft, bottomRight }: RangeCorners): [CellId, CellId] => [
  {
    sheetId,
    rowId: topLeft.r,
    columnId: topLeft.c,
  },
  {
    sheetId,
    rowId: bottomRight.r,
    columnId: bottomRight.c,
  },
];
export const tableOfRuleRange = (reads: WorkbookReads, sheetId: SheetId, { ranges: [firstRange] }: Pick<RuleInIds, 'ranges'>): TableOfRecords | null =>
  reads.conditionalFormatSuggestions(...cornerCellIdsOf(sheetId, firstRange))?.table ?? null;
export const isCardFarFromSelection = ({ drawnAs, forSelection }: Pick<ConditionalFormatsPane, 'drawnAs' | 'forSelection'>): boolean =>
  drawnAs === 'card' && forSelection?.isFarFromWhatIsSelected === true;
export const cellsToAskAgentAbout = ({ about, toAskAgentAbout = about }: Pick<RulesForSelection, 'about' | 'toAskAgentAbout'>): RangeCorners =>
  toAskAgentAbout;
