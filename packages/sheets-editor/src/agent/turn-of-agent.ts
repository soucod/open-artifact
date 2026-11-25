import type { SheetId } from '@open-artifact/sheets-core';
import { mergeChangedCellAreas, mergeClustersOfChangedCells, changesSpanWholeLines, AGENT_CHANGE_MAX_WAIT_MS, mergeChangesByAgent, type CellsOfChange } from './changes-by-agent.ts';
import { areaOfPosition, areaGrownOverMerges, unionOfAreas, type CellArea } from '../selection/model.ts';
import { areaToA1AsStored } from '../formulas/from-words/where.ts';
import { cellsAreaWidth, cellsAreaHeight } from '../grid/geometry.ts';
import { findSheetById } from '../grid/layout.ts';
import { cachedSelectedArea } from '../presence/selections.ts';
import { canCommentModePickNow } from '../comments/comment-state.ts';
import { keyActInState } from '../keys/key-pressed.ts';
import { filterButtonAtActiveCell } from '../tables/own-filter-list.ts';
import { withNoEffects, type PageEffect } from '../state/transitions.ts';
import { startTakingBack } from '../history/version-history.ts';
import type { CellsChanged, CellsWrittenInTurn, CellsDoneByAgent, ChangeByAgent, DoneByAgent, PageState, SaidOfAgent } from '../state/initial-state.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { AgentActivityChanged, ChangeArrivedFromAgent, ChangedInTurnOfAgent, PageContext, PageEvent } from '../state/event-reducer.ts';
import type { Wait } from '../state/calculating-shown.ts';
import type { KeyAct } from '../keys/key-acts.ts';
import type { RevisionRun } from './turn-changes.ts';
/** What the page knows of the workbook and its edits when the agent's turn starts or ends. */
export type TurnContext = Pick<PageContext, 'reads' | 'refusalOfEveryEdit'>;
/** The offer to take back the agent's last turn: the runs of edits to take back, and the blocks of cells they changed. */
export interface UndoOfTurnOfAgent {
  cells: CellsDoneByAgent | null;
  edits: RevisionRun[];
  blocks: CellsChanged[];
  wait: Wait;
}
/** Where the cells written in the agent's turn lie: their places in A1, the sheet they are on, and that sheet's name when it is not the one shown. */
export interface WrittenOfTurn {
  places: string[];
  sheetName: string;
  otherSheet: string | null;
}
/** The cells the viewer wrote while the agent works, and how long to wait for the agent's next edit. */
export interface WrittenInTurnOfAgent {
  writtenInTurnOfAgent: CellsWrittenInTurn[];
  waitForNextEditOfAgent: Wait;
}
/** What is heard of the agent's activity, to be told to the page as an event. */
export interface AgentActivityHeard {
  isWorking: boolean;
  isFirstWord: boolean;
  hasShellAnswered: boolean;
  isSheetJustMade: boolean;
  hasPersonActedInSheet: boolean;
  changedInTurn: ChangedInTurnOfAgent | null;
}
export function placesOfDoneCells(cellIds: CellId[], sheetId: SheetId, workbook: WorkbookReads): CellArea[] {
  if (cellIds.length > MOST_DONE_CELLS) return [];
  let positions = cellIds.flatMap((cellId) => workbook.positionOfCell(cellId) ?? []);
  if (positions.length < cellIds.length) return [];
  let mergedAreas = mergeChangedCellAreas(positions, sheetId, workbook);
  return fewestDonePlaces(mergedAreas, positions.map(areaOfPosition), sheetId, workbook);
}
export function fewestDonePlaces(mergedAreas: CellArea[] | null, areas: CellArea[], sheetId: SheetId, workbook: WorkbookReads): CellArea[] {
  if (mergedAreas !== null && mergedAreas.length <= MOST_DONE_PLACES) return mergedAreas;
  let [firstArea, ...otherAreas] = mergedAreas ?? areas;
  return firstArea === undefined ? [] : [areaGrownOverMerges(workbook, sheetId, otherAreas.reduce(unionOfAreas, firstArea))];
}
export function writtenOfTurn(
  written: CellsChanged[],
  shownSheetId: SheetId,
  { reads, revisionHeld }: Pick<PageContext, 'reads' | 'revisionHeld'> = {} as Pick<PageContext, 'reads' | 'revisionHeld'>,
): WrittenOfTurn | null {
  let sheetId = written[0]?.activeCell.sheetId;
  let sheet = reads.listSheets().find((one) => one.sheetId === sheetId);
  let isOnOneSheet = written.every(({ activeCell }) => activeCell.sheetId === sheetId);
  if (sheet === undefined || !isOnOneSheet || revisionHeld === null) return null;
  if (sheet.ownRowOrder !== null) return null;
  let areas = written.flatMap((cells) => cachedSelectedArea(cells, reads) ?? []);
  let places = fewestDonePlaces(mergeClustersOfChangedCells(areas, sheet.sheetId, reads), areas, sheet.sheetId, reads);
  if (places.length === 0) return null;
  return {
    places: places.map((place) => areaToA1AsStored(place, null)),
    sheetName: sheet.name,
    otherSheet: sheet.sheetId === shownSheetId ? null : sheet.name,
  };
}
export function doneByAgentOf(
  changes: ChangedInTurnOfAgent | null,
  sheetId: SheetId,
  { reads, revisionHeld }: Pick<PageContext, 'reads' | 'revisionHeld'>,
): DoneByAgent | null {
  if (changes === null) return null;
  let cellsOfSheet = (sheetIdOfCells: SheetId) => changes.cellsBySheet?.get(sheetIdOfCells) ?? [];
  let cellCountOf = (sheetIdOfCells: SheetId) => cellsOfSheet(sheetIdOfCells).length;
  let [firstSheet, ...otherSheets] = reads.listSheets().filter(({ sheetId: sheetIdOfSummary }) => cellCountOf(sheetIdOfSummary) > 0);
  let wait = {
    ms: DONE_CARD_WAIT_MS,
  };
  if (firstSheet === undefined)
    return {
      cells: null,
      isCardUp: true,
      wait,
    };
  let count = [firstSheet, ...otherSheets].reduce(
    (total, { sheetId: sheetIdOfSummary }) => total + cellCountOf(sheetIdOfSummary),
    0,
  );
  let sheetsWithPlaces = revisionHeld === null || count > MOST_DONE_CELLS ? [] : [firstSheet, ...otherSheets];
  let placesBySheet = new Map(
    sheetsWithPlaces.map(({ sheetId: sheetIdOfSummary }) => [
      sheetIdOfSummary,
      placesOfDoneCells(cellsOfSheet(sheetIdOfSummary), sheetIdOfSummary, reads),
    ]),
  );
  return {
    cells: {
      count,
      isInSeveralSheets: otherSheets.length > 0,
      otherSheet: otherSheets.length === 0 && firstSheet.sheetId !== sheetId ? firstSheet.name : null,
      sheetNames: [firstSheet, ...otherSheets].map(({ name }) => name),
      placesBySheet,
      places:
        otherSheets.length === 0
          ? (placesBySheet.get(firstSheet.sheetId) ?? []).map((area) => areaToA1AsStored(area, firstSheet.ownRowOrder))
          : [],
    },
    isCardUp: true,
    wait,
  };
}
export function undoOfTurnOf(
  { edits }: Pick<ChangedInTurnOfAgent, 'edits'>,
  { cells, wait }: DoneByAgent,
  workbook: WorkbookReads,
): UndoOfTurnOfAgent | null {
  if (edits === null) return null;
  let [firstSheetName = null] = cells?.sheetNames ?? [];
  let otherSheet = cells?.isInSeveralSheets === false && workbook.listSheets().length > 1 ? firstSheetName : null;
  let blocks = Array.from(
    cells?.placesBySheet ?? [],
    ([sheetId, areas]) =>
      areas.flatMap(
        ({ topRowIndex, leftColumnIndex, rowCount, columnCount }) => {
          let activeCell = workbook.cellIdAt(sheetId, topRowIndex, leftColumnIndex);
          let selectionCorner = workbook.cellIdAt(sheetId, topRowIndex + rowCount - 1, leftColumnIndex + columnCount - 1);
          return activeCell === null || selectionCorner === null
            ? []
            : [
                {
                  activeCell,
                  selectionCorner,
                },
              ];
        },
      ),
  ).flat();
  return {
    cells:
      cells === null
        ? null
        : {
            ...cells,
            otherSheet,
          },
    edits,
    blocks,
    wait: {
      ...wait,
    },
  };
}
export function workingLineAt(elapsedMs: number, lineCount: number): { line: number; forMs: number } {
  let sinceFirst = elapsedMs - WORKING_LINE_FIRST_MS;
  if (sinceFirst < 0)
    return {
      line: 0,
      forMs: -sinceFirst,
    };
  let sinceRound = sinceFirst - (lineCount - 1) * WORKING_LINE_MS;
  let [lineOffset, intoPeriod, periodMs] = sinceRound < 0 ? [1, sinceFirst, WORKING_LINE_MS] : [0, sinceRound, WORKING_LINE_LATER_MS];
  return {
    line: (lineOffset + Math.floor(intoPeriod / periodMs)) % lineCount,
    forMs: periodMs - (intoPeriod % periodMs),
  };
}
export function workingCardRoom(
  state: PageState,
  workbook: WorkbookReads,
  isEveryEditRefused: boolean,
): { width: number; height: number } | null {
  let room = {
    width: cellsAreaWidth(state),
    height: cellsAreaHeight(state) - state.heightUnderWhatFloats,
  };
  return room.width >= WORKING_CARD_SIZE.width &&
    room.height >= WORKING_CARD_SIZE.height &&
    showsWorkingOnBlankSheet(state, workbook, isEveryEditRefused)
    ? room
    : null;
}
export function writtenInTurnOfAgentWith(
  written: CellsChanged[],
  changes: ChangeByAgent[],
  workbook: WorkbookReads,
  moreChanges: CellsOfChange[] = [],
): WrittenInTurnOfAgent | undefined {
  let changesOfViewer = changes.filter(
    ({ isOfViewer, cells }) =>
      isOfViewer === true &&
      !changesSpanWholeLines(
        [
          {
            cells,
          },
        ],
        workbook,
      ),
  );
  if (changesOfViewer.length + moreChanges.length === 0) return;
  return {
    writtenInTurnOfAgent: [
      ...written,
      ...moreChanges.map(({ cells }): CellsWrittenInTurn => ({
        ...cells,
        isGuess: true,
      })),
      ...changesOfViewer.map(({ cells }) => cells),
    ],
    waitForNextEditOfAgent: {
      ms: AGENT_CHANGE_MAX_WAIT_MS,
    },
  };
}
export function setAgentWorking(
  state: PageState,
  isWorking: boolean,
  turnChanges: ChangedInTurnOfAgent | null,
  writtenBefore: CellsOfChange[],
  turnContext: PageContext,
): PageState {
  if (isWorking === state.isAgentWorking) return state;
  let done = isWorking || turnContext.refusalOfEveryEdit !== null ? null : doneByAgentOf(turnChanges, state.sheetId, turnContext);
  let undoOfTurn =
    done === null || turnChanges === null || state.isUndoOfTurnNotToBeHad ? null : undoOfTurnOf(turnChanges, done, turnContext.reads);
  let doneShown =
    done !== null && undoOfTurn !== null
      ? {
          ...done,
          isCardUp: false,
        }
      : done;
  let workingState: PageState = {
    ...state,
    isAgentWorking: isWorking,
    turnOfAgent: 'nothingSaid',
    writtenInTurnOfAgent: [],
    waitForNextEditOfAgent: null,
    ...(isWorking && writtenInTurnOfAgentWith([], state.changesByAgent.filter(isChangeOfAgentSettled), turnContext.reads, writtenBefore)),
    doneByAgent: doneShown,
    undoOfTurnOffered: undoOfTurn,
  };
  if (isWorking) {
    let hasEdited = turnContext.refusalOfEveryEdit === null && state.changesByAgent.some(isChangeOfAgentSettled);
    if (isAgentWorkingOnBlank(workingState, turnContext))
      return {
        ...workingState,
        turnOfAgent: hasEdited ? 'saidAndHasEdited' : 'saidToBeWorking',
        saidOfAgent: {
          what: 'isWorking',
          staysWhileCursorShows: true,
        },
      };
    return hasEdited ? sayAgentHasEdited(workingState) : workingState;
  }
  let writtenSure = state.writtenInTurnOfAgent.filter(({ isGuess }) => isGuess !== true);
  let written = (done?.cells ?? null) === null ? writtenOfTurn(writtenSure, state.sheetId, turnContext) : null;
  let writtenSaid = written !== null && {
    written,
  };
  if (doneShown !== null)
    return {
      ...workingState,
      saidOfAgent: {
        what: 'madeChanges',
        done: doneShown,
        ...writtenSaid,
        ...(undoOfTurn !== null && {
          isUndoOffered: true,
        }),
      },
    };
  if (state.turnOfAgent === 'saidAndHasEdited')
    return {
      ...workingState,
      saidOfAgent: {
        what: 'madeChanges',
        ...writtenSaid,
      },
    };
  return state.saidOfAgent?.what === 'isWorking'
    ? {
        ...workingState,
        saidOfAgent: null,
      }
    : workingState;
}
export function pointDoneCardAtSheet(state: PageState, workbook: WorkbookReads): PageState {
  let { doneByAgent, saidOfAgent } = state;
  let otherSheetOf = (sheetName: string | null) => (sheetName === findSheetById(workbook, state.sheetId)?.name ? null : sheetName);
  let written = saidOfAgent?.what === 'madeChanges' ? saidOfAgent.written : undefined;
  let saidPointed =
    saidOfAgent?.what !== 'madeChanges' || written === undefined || written.otherSheet === otherSheetOf(written.sheetName)
      ? saidOfAgent
      : {
          ...saidOfAgent,
          written: {
            ...written,
            otherSheet: otherSheetOf(written.sheetName),
          },
        };
  if (doneByAgent === null || doneByAgent.cells === null || doneByAgent.cells.isInSeveralSheets)
    return saidPointed === saidOfAgent
      ? state
      : {
          ...state,
          saidOfAgent: saidPointed,
        };
  let [sheetName = null] = doneByAgent.cells.sheetNames;
  let done = {
    ...doneByAgent,
    cells: {
      ...doneByAgent.cells,
      otherSheet: otherSheetOf(sheetName),
    },
  };
  return {
    ...state,
    doneByAgent: done,
    saidOfAgent:
      saidPointed?.what === 'madeChanges'
        ? {
            ...saidPointed,
            done,
          }
        : saidPointed,
  };
}
export function changesByAgentArrived(
  state: PageState,
  changes: ChangeArrivedFromAgent[],
  { refusalOfEveryEdit, reads }: TurnContext,
): PageState {
  let merged = mergeChangesByAgent(state.changesByAgent, changes, reads);
  let stateMerged: PageState = {
    ...state,
    changesByAgent: merged,
    ...(state.isAgentWorking && writtenInTurnOfAgentWith(state.writtenInTurnOfAgent, merged.filter(isChangeNotYetCounted(state)), reads)),
  };
  if (!changes.some(isChangeNotYetCounted(state)) || !state.isAgentWorking || refusalOfEveryEdit !== null) return stateMerged;
  return state.turnOfAgent === 'nothingSaid'
    ? sayAgentHasEdited(stateMerged)
    : {
        ...stateMerged,
        turnOfAgent: 'saidAndHasEdited',
      };
}
export function doesEventKeepUndoOffer(state: PageState, event: PageEvent, context: TurnContext): boolean {
  if (event.kind === 'menuAsked') return event.inContextBar !== undefined;
  if (event.kind === 'pointerPressed') return canCommentModePickNow(state);
  if (event.kind !== 'keyPressed') return false;
  let isPlainKey = !event.isShiftHeld && !event.isModifierHeld && !event.isAltHeld && !event.isRepeat;
  if (event.key === 'Enter' && isPlainKey && canCommentModePickNow(state)) return true;
  let keyAct = keyActInState(state, event, context);
  let opensFilterList =
    keyAct?.kind === 'showSheetBeside' && keyAct.by === 1 && filterButtonAtActiveCell(state, context.reads, state.activeCell) !== null;
  return keyAct === null || (KEY_ACTS_KEEPING_UNDO_OFFER.has(keyAct.kind) && !opensFilterList);
}
export function dropUndoOfTurnOnEdit(
  before: PageState,
  state: PageState,
  event: PageEvent,
  effects: PageEffect[],
  context: TurnContext,
): PageState {
  let isTakingBackTurn = before.takingBack?.what.kind === 'turnOfAgent' || state.takingBack?.what.kind === 'turnOfAgent';
  if (state.undoOfTurnOffered === null || isTakingBackTurn) return state;
  let isEntryUnchanged = event.kind === 'editTextChanged' && state.mode.kind === 'editing' && state.mode.text === state.mode.textAtStart;
  return (state.mode.kind === 'editing' &&
    (before.mode.kind !== 'editing' || (before.mode.text === before.mode.textAtStart && before.mode.text !== state.mode.text)) &&
    !EVENTS_KEEPING_UNDO_WHILE_EDITING.has(event.kind) &&
    !isEntryUnchanged) ||
    effects.some(({ kind }) => kind === 'queueEdit') ||
    (doesEventDropDoneCard(event) && !doesEventKeepUndoOffer(before, event, context))
    ? {
        ...state,
        undoOfTurnOffered: null,
      }
    : state;
}
export function dropDoneCardOnEvent(state: PageState, event: PageEvent): PageState {
  let { doneByAgent, mode, isChatBehindButton, isComposerOpen } = state;
  let isDroppedByEvent = mode.kind === 'editing' || doesEventDropDoneCard(event);
  let isChatShown = !isChatBehindButton || isComposerOpen;
  return doneByAgent?.isCardUp === true && (isDroppedByEvent || isChatShown)
    ? {
        ...state,
        doneByAgent: {
          ...doneByAgent,
          isCardUp: false,
        },
      }
    : state;
}
export const DONE_CARD_WAIT_MS = 8000;
export const MOST_DONE_PLACES = 3;
export const MOST_DONE_CELLS = 1e4;
export const undoTurnOfAgent = (state: PageState, workbook: ReadsWithTextMeasurer) =>
  state.undoOfTurnOffered === null
    ? withNoEffects(state)
    : startTakingBack(state, workbook, {
        kind: 'turnOfAgent',
        edits: state.undoOfTurnOffered.edits,
      });
export const KEY_ACTS_KEEPING_UNDO_OFFER = new Set<KeyAct['kind']>([
  'move',
  'extendSelection',
  'jump',
  'selectAll',
  'selectTableOrAll',
  'selectWhole',
  'showOrHideFormulas',
  'showSheetBeside',
  'goOnOutOfGrid',
  'letGo',
  'cancelEdit',
  'collapseEntry',
  'undoOrRedo',
]);
export const EVENTS_KEEPING_UNDO_WHILE_EDITING = new Set<PageEvent['kind']>(['focusCameBack', 'entryOfPageBeforeFound']);
export const dropUndoOfTurnWaitedOut = (state: PageState, wait: Wait): PageState =>
  state.undoOfTurnOffered?.wait === wait && state.takingBack?.what.kind !== 'turnOfAgent'
    ? {
        ...state,
        undoOfTurnOffered: null,
      }
    : state;
export const agentActivityChangedEvent = (activity: AgentActivityHeard): AgentActivityChanged => ({
  kind: 'agentActivityChanged',
  isWorking: activity.isWorking,
  ...(activity.changedInTurn !== null && {
    changedInTurn: activity.changedInTurn,
  }),
  ...(activity.isFirstWord
    ? {
        isAsSpreadsheetOpens: true,
      }
    : undefined),
  ...(activity.isSheetJustMade && !activity.hasPersonActedInSheet
    ? {
        isSheetJustMade: true,
      }
    : undefined),
  ...(activity.isFirstWord && activity.hasShellAnswered
    ? {
        hasShellAnswered: true,
      }
    : undefined),
});
export const showsWorkingOnBlankSheet = (
  { isAgentWorking, mode }: Pick<PageState, 'isAgentWorking' | 'mode'>,
  reads: WorkbookReads,
  isEveryEditRefused: boolean,
): boolean => isAgentWorking && reads.isEveryCellBlank && mode.kind === 'navigating' && !isEveryEditRefused;
export const WORKING_CARD_SIZE = {
  width: 176,
  height: 56,
};
export const WORKING_LINE_FIRST_MS = 3000;
export const WORKING_LINE_MS = 5000;
export const WORKING_LINE_LATER_MS = 1e4;
export const isAgentWorkingOnBlank = (state: Pick<PageState, 'isAgentWorking' | 'mode'>, { reads, refusalOfEveryEdit }: TurnContext): boolean =>
  showsWorkingOnBlankSheet(state, reads, refusalOfEveryEdit !== null);
export const sayAgentHasEdited = (state: PageState): PageState => ({
  ...state,
  turnOfAgent: 'saidAndHasEdited',
  saidOfAgent: {
    what: 'isWorking',
    staysWhileCursorShows: false,
  },
});
export const isChangeOfAgentSettled = ({ fadeBeginsAtMs }: Pick<ChangeByAgent, 'fadeBeginsAtMs'>): boolean => fadeBeginsAtMs === null;
export const isChangeNotYetCounted =
  ({ changesByAgent }: Pick<PageState, 'changesByAgent'>) =>
  ({ revision }: Pick<ChangeByAgent, 'revision'>): boolean =>
    !changesByAgent.some(
      (change) => [change, ...change.joinedWith].some((joinedChange) => joinedChange.revision === revision),
    );
export const stopSayingWorkingWhenCursorGone = (state: PageState, turnContext: TurnContext): PageState =>
  state.saidOfAgent?.what === 'isWorking' && state.saidOfAgent.staysWhileCursorShows && !isAgentWorkingOnBlank(state, turnContext)
    ? {
        ...state,
        saidOfAgent: {
          what: 'isWorking',
          staysWhileCursorShows: false,
        },
      }
    : state;
export const EVENTS_THAT_DROP_DONE_CARD = new Set<PageEvent['kind']>([
  'keyPressed',
  'pointerPressed',
  'copyChosen',
  'cutChosen',
  'pasteChosen',
  'chartPasteChosen',
  'menuAsked',
  'linesAtEndAsked',
]);
export const doesEventDropDoneCard = (event: PageEvent): boolean =>
  EVENTS_THAT_DROP_DONE_CARD.has(event.kind) || (event.kind === 'placedViewActedOn' && event.act.kind === 'takeHold' && !event.act.isByFinger);
export const isMadeChangesWaitingFor = (said: SaidOfAgent | null, doneByAgent: DoneByAgent | null): boolean =>
  said?.what === 'madeChanges' && said.done !== undefined && said.done.wait === doneByAgent?.wait;
