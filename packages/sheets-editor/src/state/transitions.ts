import type { CopiedWidgetNode, Edit, EngineCellTable, EngineRecordedEdit, IdRun, SheetId, TextThatNoCellShows } from '@open-artifact/sheets-core';
import type { CellId } from '../model/workbook.ts';
import type { LineSpan } from '../model/line-ids.ts';
import type { CellArea, SelectionPositions } from '../selection/model.ts';
import type { NewCommentPlace } from '../comments/comment-state.ts';
import type { CellHistoryScope, EntryLooks, EntryLooksInHistory, PageState, SelectedToldToAgent, UndoOfTurnOffered, VersionHistoryInPane, VersionRestoredOffer } from './initial-state.ts';
import type { SelectionCorners } from '../presence/selections.ts';
import type { MarksToTypeIn } from '../editor/entry-looks.ts';
import type { FiguresOfNumbers } from './figures-of-selection.ts';
import type { AgentPrompt } from '../format/conditional/agent-prompts.ts';
import type { ChartNodesCopiedFor, IfQueued, KeyPressed, PageEvent } from './event-reducer.ts';
/** An edit worked out to be queued on the workbook, with what the page does once it is answered. */
export interface QueueEditEffect {
  kind: 'queueEdit';
  edit: Edit;
  ifQueued: IfQueued;
  editsBefore?: { edit: Edit; isPointedAt: boolean }[];
  editsThatGoAlong?: Edit[];
  shownToThePerson?: TextThatNoCellShows[];
  /** The sheet whose columns are widened to show the numbers the edit gives a format. */
  makesRoomForNumbersIn?: SheetId;
}
export interface UndoOrRedoEffect {
  kind: 'undoOrRedo';
  direction: 'undo' | 'redo';
  takesBackFor?: PageState['notice'];
}
/** An ask of the agent, known by `askId` when its answer comes. */
interface AskOfAgent {
  askId: number;
}
/** What the page asks of the controller after an event: edits, reads, asks of the agent and the store, and what to tell others. */
export type PageEffect =
  | QueueEditEffect
  | { kind: 'declareCellTable'; sheetId: SheetId; cellTable: EngineCellTable; isAskedFor?: true }
  | UndoOrRedoEffect
  | { kind: 'putOnClipboard'; sheetId: SheetId; area: CellArea; rowsLeftOut: readonly LineSpan[]; cutToken: string | null }
  | { kind: 'putNothingOnClipboard' }
  | { kind: 'workOutFormulasLeft'; thenEvent: PageEvent }
  | { kind: 'readOffersUnderAt' }
  | { kind: 'askAgentAboutSelection' }
  | { kind: 'oweAgentAnAsk' }
  | { kind: 'giveUpAskOwedToAgent' }
  | { kind: 'findPeople'; searchedFor: string }
  | { kind: 'copyChartNodes'; sources: string[]; copiedFor: ChartNodesCopiedFor }
  | { kind: 'discardChartNodes'; copies: readonly CopiedWidgetNode[] }
  | { kind: 'waitForPeople'; searchedFor: string; key: KeyPressed }
  | { kind: 'dropWhatIsHeld' }
  | { kind: 'lookUpPeople'; userIds: string[] }
  | { kind: 'tellOthersOwnSelection'; selection: SelectionCorners | null }
  | { kind: 'tellOthersWhomViewFollows'; tabKey: string | null }
  | { kind: 'copyLinkToSheet'; sheetId: SheetId }
  | ({ kind: 'openCommentBox'; isForAgent: boolean } & NewCommentPlace)
  | { kind: 'openComment'; handle: string; isKeyboardLeft?: true }
  | { kind: 'shutComment' }
  | { kind: 'shutCommentBox' }
  | { kind: 'endCommentMode'; isAskNext: boolean }
  | { kind: 'tellAgentWhatIsSelected'; selected: SelectedToldToAgent }
  | ({ kind: 'askAgentAboutImport'; asked: AgentPrompt } & AskOfAgent)
  | { kind: 'stopAskingAgentAboutImport' }
  | ({ kind: 'askAgentAboutConditionalFormats'; asked: AgentPrompt } & AskOfAgent)
  | { kind: 'stopAskingAgentAboutConditionalFormats' }
  | ({ kind: 'askAgentWhichRowsAreAskedFor'; asked: { words: string; data: string }; isAtEnter: boolean } & AskOfAgent)
  | ({ kind: 'askAgentAheadWhichRowsAreAskedFor'; words: string } & AskOfAgent)
  | ({ kind: 'tellAgentWhichRowsAreAskedFor'; rest: { typed: string; data: string } } & AskOfAgent)
  | { kind: 'stopAskingAgentWhichRowsAreAskedFor' }
  | { kind: 'checkAgentForConditionalFormats' }
  | { kind: 'workOutFormulaRead'; formula: string }
  | { kind: 'checkAgentForFormulas' }
  | ({ kind: 'askAgentForAFormula'; asked: AgentPrompt } & AskOfAgent)
  | ({ kind: 'askAgentForANumberFormat'; asked: { words: string; data: null } } & AskOfAgent)
  | { kind: 'stopAskingAgentForAFormula' }
  | ({ kind: 'askAgentForAFix'; asked: AgentPrompt } & AskOfAgent)
  | { kind: 'stopAskingAgentForFixes' }
  | ({ kind: 'readVersions'; before: { firstRevision: number } | null } & AskOfAgent)
  | ({ kind: 'lookAtVersion'; revision: number; pane: VersionHistoryInPane } & AskOfAgent)
  | { kind: 'endLookAtVersion'; pane: VersionHistoryInPane | null; thenRestore: number | null; isByPerson?: true }
  | ({ kind: 'readCellHistory'; cell: CellId; scope: CellHistoryScope } & AskOfAgent)
  | ({ kind: 'readEditsThatTakeBack'; asked: EditsToTakeBack; afterMs: number } & AskOfAgent)
  | { kind: 'seeRowsInOwnOrder'; sheetId: SheetId; rows: readonly IdRun[] | null; staysAt: StaysAt }
  | ({ kind: 'queueEditsThatTakeBack'; builtOnRevision: number; edits: EngineRecordedEdit[]; offerIfMade: VersionRestoredOffer | null } & AskOfAgent);
/** Where the selection is, by rows and columns, so it can stay put when the rows change order. */
/** The edits asked for to take back: all made since a revision, or only the runs of a turn of the agent. */
export type EditsToTakeBack = { kind: 'allSince'; revision: number } | { kind: 'only'; ranges: UndoOfTurnOffered['edits'] };
/** Where the view stays once rows are seen in a new order: `null` for a sheet not shown. */
export type StaysAt = SelectionPositions | { scrollTop: number } | null;
/** The page's state after an event, and what the controller is to do about it. */
export interface PageTransition {
  state: PageState;
  effects: PageEffect[];
}
export const isMenuHoldingSizeField = (menu: PageState['menu']): boolean => menu?.holds === 'columnWidthField' || menu?.holds === 'rowHeightField';
export const isMenuHoldingField = (menu: PageState['menu']): boolean => isMenuHoldingSizeField(menu) || menu?.holds === 'cellsToSort';
export const cellsToSortOfMenu = (menu: PageState['menu']) => (menu?.holds === 'cellsToSort' ? (menu.cellsToSort ?? null) : null);
export const sortColumnOfMenu = (menu: PageState['menu'], key: 'sheet' | 'range') =>
  (key === 'sheet' ? menu?.sortColumnPicked : undefined) ?? menu?.sortColumnsPointedAt?.[key] ?? null;
/** The figures the bar under the grid shows of the selected cells, in its order. */
export const SUM_BAR_AGGREGATES: (keyof FiguresOfNumbers)[] = ['sum', 'average', 'min', 'max', 'count'];
export const NAVIGATING_MODE: NavigatingMode = {
  kind: 'navigating',
};
export const isOneLineEditor = ({ holdsOneLine, isInBoxOfOneLine }: EditingMode): boolean =>
  holdsOneLine === true || isInBoxOfOneLine === true;
export const withNoEffects = (state: PageState): PageTransition => ({
  state,
  effects: [],
});
export const isIdleOrTapping = ({ dragging }: Pick<PageState, 'dragging'>): boolean => dragging === null || dragging.kind === 'tapping';
export const lastDoneWorthKeeping = ({ lastDone }: Pick<PageState, 'lastDone'>) =>
  (lastDone?.what === 'formatted' && lastDone.cellEnteredIn !== undefined) ||
  lastDone?.what === 'typedTextEntered' ||
  lastDone?.what === 'typedTextChangedNothing' ||
  lastDone?.what === 'formulaOfAgentEntered' ||
  lastDone?.what === 'fixKept' ||
  lastDone?.what === 'entryCameToError'
    ? lastDone
    : null;
export const withFormulasLeftToWorkOut = (state: PageState, thenEvent: PageEvent): PageTransition => ({
  state,
  effects: [
    {
      kind: 'workOutFormulasLeft',
      thenEvent,
    },
  ],
});
export const clearPassingNotice = (state: PageState): PageState =>
  state.notice === null ||
  state.notice.kind === 'entriesNotKept' ||
  (state.notice.kind === 'fixesGoneWithChange' && state.fixesOnCells.isEndToldDuringAct)
    ? state
    : {
        ...state,
        notice: null,
      };
export interface NavigatingMode {
  kind: 'navigating';
}
export interface EditingMode {
  kind: 'editing';
  text: string;
  textAtStart: string;
  typingIn: 'cell' | 'formulaBar';
  looks?: EntryLooks;
  looksInHistory?: EntryLooksInHistory;
  marksToTypeIn?: MarksToTypeIn;
  selectedInEntry?: { start: number; end: number };
  caretToPut?: { text: string; at: number };
  numbersOfLines?: (number | null)[];
  textOfOthersHeld?: string;
  holdsOneLine?: true;
  isInBoxOfOneLine?: true;
  isTypedOverCell?: true;
  wasEmptied?: true;
  mayHoldTextOfOthers?: true;
  holdsWhatWasNotTyped?: true;
  isExpanded?: true;
  isSumForSelectedCells?: true;
  areSignsLeftAsTyped?: true;
  isBegunToListFunctions?: true;
  formulaOfAgent?: 'mayBeHeld' | 'wasHeld';
  arrowsActOn?: 'cells' | 'text';
  savedWhileOpen?: 'typedText' | 'boxesAlone';
}
export type PageMode = NavigatingMode | EditingMode;
