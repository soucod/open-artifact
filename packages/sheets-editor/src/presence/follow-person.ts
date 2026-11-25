import { isSameToldSelection, selectionInRowOrder, type SelectionCorners } from './selections.ts';
import { isViewFreeToFollow, showChangeByAgent, doesPersonTakeViewBack, stepFollowAgent } from '../agent/follow-agent.ts';
import { isSameCell, isSameSelection } from '../selection/model.ts';
import { stepShownByAgent } from '../agent/shown-by-agent.ts';
import type { FollowsOnOneSheet, PageState } from '../state/initial-state.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { PageContext, PageEvent } from '../state/event-reducer.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { FormatToCome } from '../state/formats-to-come.ts';
type SelectionsOfOthersIn = Pick<PageState, 'selectionsOfOthers'>;
type EntriesUnansweredIn = Pick<PageState, 'entriesUnanswered'>;
interface ReadsWithFormatsToComeCached {
  entriesUnanswered: PageState['entriesUnanswered'];
  shown: ReadsWithTextMeasurer;
}
/** The selection of the person that moved last, in whichever of their tabs. */
export function changedSelectionOfUser(
  before: SelectionsOfOthersIn,
  state: SelectionsOfOthersIn,
  userId: string,
): SelectionCorners | undefined {
  let selectionsBefore = new Map<string, SelectionCorners>(
    toldSelectionsOfUser(before, userId).map((told) => [told.tabKey, told.selection]),
  );
  return toldSelectionsOfUser(state, userId).findLast(({ tabKey, selection }) => {
    let selectionBefore = selectionsBefore.get(tabKey);
    return selectionBefore === undefined || !isSameToldSelection(selectionBefore, selection);
  })?.selection;
}
export function stepFollowPerson(
  before: PageState,
  step: PageTransition,
  event: PageEvent,
  { reads }: Pick<PageContext, 'reads'>,
): PageState {
  let { state } = step;
  if (event.kind === 'followAsked') {
    let { tabKey, userId } = event;
    if (tabKey === null)
      return {
        ...state,
        followed: null,
      };
    let toldOfUser = userId === null ? [] : toldSelectionsOfUser(state, userId);
    let told = toldOfUser.find((toldOfTab) => toldOfTab.tabKey === tabKey) ?? toldOfUser.at(-1);
    if (userId === null || told === undefined || !isViewFreeToFollow(state)) return state;
    let followed = {
      userId,
      tabKey,
      cells: told.selection,
    };
    let followingState: PageState = {
      ...state,
      followed,
      isFollowingAgent: false,
      followsOnOneSheet: 'no',
      hasPersonTakenViewBack: true,
      leftByCaret: null,
      placementSelected: null,
    };
    return showChangeByAgent(followingState, reads, {
      cells: selectionInRowOrder('seen', told.selection, reads),
    });
  }
  if (state.followed === null) return state;
  let { userId: followedUserId } = state.followed;
  let isTakenBack =
    event.kind === 'keyPressed' || (!isAnswerKeepingView(before, state, event) && doesPersonTakeViewBack(before, step, event));
  if (toldSelectionsOfUser(state, followedUserId).length === 0 || isTakenBack)
    return {
      ...state,
      followed: null,
    };
  let withoutAgent: PageState = state.isFollowingAgent
    ? {
        ...state,
        isFollowingAgent: false,
        followsOnOneSheet: 'no',
      }
    : state;
  let selection = changedSelectionOfUser(before, state, followedUserId);
  if (selection !== undefined)
    return showChangeByAgent(
      {
        ...withoutAgent,
        followed: {
          ...state.followed,
          cells: selection,
        },
      },
      reads,
      {
        cells: selectionInRowOrder('seen', selection, reads),
      },
    );
  return event.kind === 'workbookChanged'
    ? showChangeByAgent(withoutAgent, reads, {
        cells: selectionInRowOrder('seen', state.followed.cells, reads),
      })
    : withoutAgent;
}
export function withTellOthersWhomViewFollows(before: PageState, { state, effects }: PageTransition, event: PageEvent): PageTransition {
  let tabKey = state.followed?.tabKey ?? null;
  if (tabKey === (before.followed?.tabKey ?? null) && event.kind !== 'followAsked')
    return {
      state,
      effects,
    };
  return {
    state,
    effects: [
      ...effects,
      {
        kind: 'tellOthersWhomViewFollows',
        tabKey,
      },
    ],
  };
}
/** The reads with the formats that unanswered entries bring along shown as if answered. */
export function readsWithFormatsToCome(reads: ReadsWithTextMeasurer, { entriesUnanswered }: EntriesUnansweredIn): ReadsWithTextMeasurer {
  let toCome = formatsToComeOf({
    entriesUnanswered,
  });
  if (toCome.length === 0) return reads;
  let held = readsWithFormatsToComeCache.get(reads);
  if (held?.entriesUnanswered === entriesUnanswered) return held.shown;
  let formatsShown = new Map<CellId, ReturnType<WorkbookReads['formatOf']>>();
  let toComeAt = (cellId: CellId) => toCome.find((format) => isSameCell(format.cellId, cellId));
  let cellOf = (cellId: CellId): ReturnType<WorkbookReads['cellOf']> => {
    let cell = reads.cellOf(cellId);
    if (cell?.input.kind === 'boolean' || cell?.input.kind === 'formula' || toComeAt(cellId)?.look.cellControl?.kind !== 'checkbox') return cell;
    return {
      r: cellId.rowId,
      c: cellId.columnId,
      input: {
        kind: 'boolean',
        value: false,
      },
    };
  };
  let shown: ReadsWithTextMeasurer = {
    ...reads,
    formatOf(cellId) {
      let [format, coming] = [reads.formatOf(cellId), toComeAt(cellId)];
      if (coming === undefined) return format;
      let formatToShow = formatsShown.get(cellId) ?? {
        ...format,
        ...coming.look,
      };
      return (formatsShown.set(cellId, formatToShow), formatToShow);
    },
    dropdownOf: (cellId) => reads.dropdownOf(toComeAt(cellId)?.dropdownOf ?? cellId),
    cellOf,
    cellOnShowIn: (cellId) => cellOf(cellId) ?? reads.spilledCellOf(cellId),
    columnIndexesOnShowIn(sheetId, rowIndex) {
      let onShow = reads.columnIndexesOnShowIn(sheetId, rowIndex);
      let comingIndexes = toCome.flatMap(({ cellId }) => {
        let position = cellId.sheetId === sheetId ? reads.positionOfCell(cellId) : null;
        return position?.rowIndex === rowIndex && cellOf(cellId) !== null ? [position.columnIndex] : [];
      });
      if (comingIndexes.length === 0) return onShow;
      let indexes = [...new Set([...onShow, ...comingIndexes])];
      return (indexes.sort((a, b) => a - b), indexes);
    },
  };
  return (
    readsWithFormatsToComeCache.set(reads, {
      entriesUnanswered,
      shown,
    }),
    shown
  );
}
export const toldSelectionsOfUser = ({ selectionsOfOthers }: SelectionsOfOthersIn, userId: string): PageState['selectionsOfOthers'] =>
  selectionsOfOthers.filter((told) => told.userId === userId);
export const isAnswerKeepingView = (before: PageState, state: PageState, { kind }: Pick<PageEvent, 'kind'>): boolean =>
  (kind === 'editAnswered' || kind === 'undoOrRedoAnswered' || kind === 'takeBackAnswered') &&
  isViewFreeToFollow(state) &&
  isSameSelection(before, state) &&
  state.placementSelected === before.placementSelected;
export const stepViewFollowing = (before: PageState, step: PageTransition, event: PageEvent, context: PageContext): PageState => {
  let afterShown = stepShownByAgent(before, step, event, context);
  let afterAgent =
    (afterShown.shownByAgent?.place ?? null) === null
      ? stepFollowAgent(
          before,
          {
            ...step,
            state: afterShown,
          },
          event,
          context,
        )
      : afterShown;
  let afterPerson = stepFollowPerson(
    before,
    {
      ...step,
      state: afterAgent,
    },
    event,
    context,
  );
  let state = step.state;
  if (!(afterPerson.sheetId !== state.sheetId || afterPerson.scrollLeft !== state.scrollLeft || afterPerson.scrollTop !== state.scrollTop))
    return afterPerson;
  let followsOnOneSheet: FollowsOnOneSheet = afterPerson.followsOnOneSheet === 'no' ? 'no' : 'hasMoved';
  return {
    ...afterPerson,
    followsOnOneSheet,
    movesOfViewByItself: afterPerson.movesOfViewByItself + 1,
  };
};
export const formatsToComeOf = ({ entriesUnanswered }: EntriesUnansweredIn): FormatToCome[] =>
  entriesUnanswered.flatMap(({ formatsToCome = [] }) => formatsToCome);
export const readsWithFormatsToComeCache = new WeakMap<WorkbookReads, ReadsWithFormatsToComeCached>();
export const isFormatComingToCell = ({ entriesUnanswered }: EntriesUnansweredIn, cellId: CellId): boolean =>

  entriesUnanswered.some(
    ({ formatsToCome = [] }) =>
      formatsToCome.some((format: FormatToCome) => format.isOfEntry
 !== true && isSameCell(format.cellId, cellId)),
  );
