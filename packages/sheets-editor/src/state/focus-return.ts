import type { SheetId } from '@open-artifact/sheets-core';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { CellsChanged, CellsChangedInSheet, CellsOfComment, CommentOnPage, PageState, PeopleList } from './initial-state.ts';
import type { EditingMode, PageTransition } from './transitions.ts';
import type { ChangeArrivedFromAgent, PageContext, PageEvent } from './event-reducer.ts';
import type { Wait } from './calculating-shown.ts';
import { finishRenamingSheet, cleanSheetName, startRenamingSheet } from './sheet-tabs.ts';
import { findSheetById } from '../grid/layout.ts';
import { isSameCell, selectionAtCell, activeAnchorCell } from '../selection/model.ts';
import { startEntryEditing, textToEditAt } from '../editor/start-entry.ts';
import { refreshPeopleList } from '../chips/people-list.ts';
import { looksOfRichCellText } from '../editor/entry-looks.ts';
import { looksAfterTyping } from '../editor/text-looks.ts';
import { eventEffectOnDrag } from './drag-events.ts';
import { AGENT_CHANGE_MAX_WAIT_MS } from '../agent/changes-by-agent.ts';
import { isChangeNotYetCounted } from '../agent/turn-of-agent.ts';
import { cachedSelectedArea, selectedAreaAsSeen } from '../presence/selections.ts';
import { areasOverlap } from '../model/workbook.ts';
export function keepEntryLeftByCaret(state: PageState, transition: PageTransition): PageTransition {
  let { mode, peopleList, activeCell } = state;
  if (mode.kind === 'editing') {
    let entryLeft: EntryLeftByCaret = {
      what: 'entry',
      mode,
      peopleList,
      cellId: activeCell,
      since: null,
    };
    return {
      ...transition,
      state: {
        ...transition.state,
        leftByCaret: entryLeft,
      },
    };
  }
  if (peopleList === null) return transition;
  return {
    ...transition,
    state: {
      ...transition.state,
      leftByCaret: {
        what: 'peopleField',
        peopleList,
      },
    },
  };
}
export function leaveSheetNameEntry(state: PageState, reads: WorkbookReads, mayComeBack: boolean): PageTransition {
  let renamingFinished = finishRenamingSheet(state, reads, true);
  if (!mayComeBack || state.sheetBeingRenamed === null) return renamingFinished;
  let { sheetId, typed, nameWhenOpened } = state.sheetBeingRenamed;
  let sheetNameLeft: SheetNameLeftByCaret = {
    what: 'sheetName',
    sheetId,
    typed,
    nameWhenOpened,
  };
  return {
    ...renamingFinished,
    state: {
      ...renamingFinished.state,
      leftByCaret: sheetNameLeft,
    },
  };
}
export function restoreWhatCaretLeft(
  state: PageState,
  isAsItLeft: boolean,
  { reads, refusalOfEveryEdit }: Pick<PageContext, 'reads' | 'refusalOfEveryEdit'>,
): PageState {
  let { leftByCaret } = state;
  if (leftByCaret === null) return state;
  let stateWithoutLeft: PageState = {
    ...state,
    leftByCaret: null,
  };
  if (!isAsItLeft || refusalOfEveryEdit !== null) return stateWithoutLeft;
  if (leftByCaret.what === 'sheetName') {
    let currentName = findSheetById(reads, leftByCaret.sheetId)?.name;
    if (currentName !== cleanSheetName(leftByCaret.typed) && currentName !== leftByCaret.nameWhenOpened) return stateWithoutLeft;
    let { sheetBeingRenamed } = startRenamingSheet(stateWithoutLeft, reads, leftByCaret.sheetId);
    if (sheetBeingRenamed === null) return stateWithoutLeft;
    return {
      ...stateWithoutLeft,
      sheetBeingRenamed: {
        ...sheetBeingRenamed,
        typed: leftByCaret.typed,
      },
    };
  }
  if (leftByCaret.what === 'peopleField')
    return {
      ...stateWithoutLeft,
      peopleList: leftByCaret.peopleList,
    };
  let { since } = leftByCaret;
  if (!(since !== null && isSameCell(state.activeCell, leftByCaret.cellId) && state.textToEditOfEntryCell === since.textToEdit))
    return stateWithoutLeft;
  let { isInBoxOfOneLine, savedWhileOpen, ...modeWithoutBox } = leftByCaret.mode;
  let restoredMode = {
    ...modeWithoutBox,
    textAtStart: since.textToEdit,
  };
  let isWorkbookUnchanged = state.workbookChangeCount === since.workbookChangeCount;
  let { peopleList } = leftByCaret;
  let restoredState = {
    ...stateWithoutLeft,
    ...(isWorkbookUnchanged ? {} : selectionAtCell(leftByCaret.cellId)),
    mode: restoredMode,
    peopleList,
  };
  let editingState = startEntryEditing(restoredState, reads, restoredMode.text, restoredMode.typingIn);
  if (peopleList === null) return editingState;
  let withPeopleList = refreshPeopleList(editingState, reads);
  return withPeopleList.peopleList?.isOfPeopleAlone === peopleList.isOfPeopleAlone ? withPeopleList : stateWithoutLeft;
}
export function restoreEntryOfPageBefore(
  state: PageState,
  { cellId, mode }: EntryOfPageBefore,
  { reads, refusalOfEveryEdit }: Pick<PageContext, 'reads' | 'refusalOfEveryEdit'>,
): PageState {
  if (state.mode.kind !== 'navigating' || refusalOfEveryEdit !== null) return state;
  if (!isSameCell(state.activeCell, cellId) || !isSameCell(activeAnchorCell(state, reads), cellId)) return state;
  let textNow = textToEditAt(state, reads, cellId);
  if (textNow !== mode.textAtStart && textNow !== mode.text) return state;
  let cellLooks = mode.isTypedOverCell === true ? undefined : looksOfRichCellText(reads, cellId, textNow);
  let looks = mode.looks ?? (cellLooks === undefined ? undefined : looksAfterTyping(cellLooks, textNow, mode.text));
  let restoredMode: EditingMode = {
    ...mode,
    textAtStart: textNow,
    mayHoldTextOfOthers: true,
    ...(looks !== undefined && {
      looks,
    }),
  };
  let { isInBoxOfOneLine, savedWhileOpen, ...modeWithoutBox } = restoredMode;
  return {
    ...startEntryEditing(
      {
        ...state,
        ...selectionAtCell(cellId),
        mode: modeWithoutBox,
      },
      reads,
      modeWithoutBox.text,
      modeWithoutBox.typingIn,
    ),
    scrollLeft: state.scrollLeft,
    scrollTop: state.scrollTop,
  };
}
export function trackLeftByCaret(stateBefore: PageState, state: PageState, event: PageEvent): PageState {
  let { leftByCaret, mode, textToEditOfEntryCell: textToEdit, workbookChangeCount } = state;
  if (leftByCaret === null) return state;
  let letsGo = event.kind !== 'sheetListShut' && eventEffectOnDrag(event) === 'letsGo';
  if (leftByCaret === stateBefore.leftByCaret && letsGo)
    return {
      ...state,
      leftByCaret: null,
    };
  let isEntrySettled = mode.kind === 'navigating' && state.entriesUnanswered.length === 0;
  if (leftByCaret.what !== 'entry' || !isEntrySettled) return state;
  return leftByCaret.since === null
    ? {
        ...state,
        leftByCaret: {
          ...leftByCaret,
          since: {
            textToEdit,
            workbookChangeCount,
          },
        },
      }
    : state;
}
export function trackCommentsWithAgent(stateBefore: PageState, state: PageState, event: PageEvent, reads: WorkbookReads): PageState {
  let commentsWithAgent = state.commentsWithAgent;
  let withHandles = (handles: string[], wait: Wait): PageState =>
    handles.length === (commentsWithAgent?.handles.length ?? 0) && wait === (commentsWithAgent?.wait ?? wait)
      ? state
      : {
          ...state,
          commentsWithAgent:
            handles.length === 0
              ? null
              : {
                  handles,
                  wait,
                },
        };
  if (event.kind === 'commentsTold') {
    let { sentToAgent, repliedTo = [] } = event;
    let handles = [...(commentsWithAgent?.handles ?? []), ...(sentToAgent === undefined ? [] : [sentToAgent])].filter(
      (handle: string) =>
        !repliedTo.includes(handle) &&
        state.comments?.some((comment: CommentOnPage) => comment.handle === handle && !comment.isResolved) === true,
    );
    let ms = state.isAgentWorking ? AGENT_CHANGE_MAX_WAIT_MS : COMMENTS_WITH_AGENT_WAIT_MS;
    return withHandles(
      handles,
      sentToAgent === undefined && commentsWithAgent !== null
        ? commentsWithAgent.wait
        : {
            ms,
          },
    );
  }
  if (commentsWithAgent === null) return state;
  if (event.kind === 'workShownLongEnough') return event.wait === commentsWithAgent.wait ? withHandles([], commentsWithAgent.wait) : state;
  if (event.kind === 'agentActivityChanged' && stateBefore.isAgentWorking !== state.isAgentWorking) {
    let ms = state.isAgentWorking ? AGENT_CHANGE_MAX_WAIT_MS : COMMENTS_WITH_AGENT_AFTER_WORK_MS;
    return withHandles(commentsWithAgent.handles, {
      ms,
    });
  }
  if (event.kind !== 'changesByAgentChanged') return state;
  let cellsChanged = event.changes.flatMap(
    (change: ChangeArrivedFromAgent) =>
      change.isOfViewer === true && change.isOfLayoutAlone !== true && isChangeNotYetCounted(stateBefore)(change)
        ? [change, ...(change.inOtherSheets ?? [])].flatMap(({ cells, groupsApart }: CellsChangedInSheet) => groupsApart ?? [cells])
        : [],
  );
  let isCommentChanged = (handle: string) =>
    state.comments?.some(
      (comment: CommentOnPage) =>
        comment.handle === handle && cellsChanged.some((cells: CellsChanged) => isChangeOnCommentCells(cells, comment.cells, reads)),
    ) === true;
  return withHandles(
    commentsWithAgent.handles.filter((handle: string) => !isCommentChanged(handle)),
    commentsWithAgent.wait,
  );
}
export const COMMENTS_WITH_AGENT_WAIT_MS = 60000;
export const COMMENTS_WITH_AGENT_AFTER_WORK_MS = 1e4;
export const isChangeOnCommentCells = (cellsChanged: CellsChanged, commentCells: CellsOfComment, reads: WorkbookReads): boolean => {
  let [areaChanged, commentArea] = [cachedSelectedArea(cellsChanged, reads), selectedAreaAsSeen(commentCells, reads)];
  return (
    cellsChanged.activeCell.sheetId === commentCells.activeCell.sheetId &&
    areaChanged !== null &&
    commentArea !== null &&
    areasOverlap(areaChanged, commentArea)
  );
};
/** When an entry left by the caret was settled: the text the cell then held to edit, and how many changes the workbook had. */
export interface EntrySettled {
  textToEdit: string;
  workbookChangeCount: number;
}
/** An entry open in a cell when the page lost focus, to open again as it was when focus comes back. */
export interface EntryLeftByCaret {
  what: 'entry';
  mode: EditingMode;
  peopleList: PeopleList | null;
  cellId: CellId;
  since: EntrySettled | null;
}
/** A field picking people, open when the page lost focus. */
export interface PeopleFieldLeftByCaret {
  what: 'peopleField';
  peopleList: PeopleList;
}
/** A sheet's name being typed when the page lost focus. */
export interface SheetNameLeftByCaret {
  what: 'sheetName';
  sheetId: SheetId;
  typed: string;
  nameWhenOpened: string;
}
/** What the caret was in when the page lost focus. */
export type WhatCaretLeft = EntryLeftByCaret | PeopleFieldLeftByCaret | SheetNameLeftByCaret;
/** An entry kept while the page before was left, found again as this page opens. */
interface EntryOfPageBefore {
  cellId: CellId;
  mode: EditingMode;
}
