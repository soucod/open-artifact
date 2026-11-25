import type { Menu, NewsOfLoss, Notice, PageState, SidePane } from './initial-state.ts';
import type { PageEvent, RefusalOfEveryEdit } from './event-reducer.ts';
import type { PageEffect, PageTransition } from './transitions.ts';
import { isEditRefusalReason } from '../model/refusals.ts';
import { discardCopiedChartNodes } from '../charts/copied-chart-nodes.ts';
import { leaveEntryEditing, entryCellTextAsEdited } from '../editor/commit-entry.ts';
import { withNoEffects } from './transitions.ts';
import { stopArrowsActingOnCells } from '../editor/start-entry.ts';
import { withStopImportAskEffect } from '../import/bring-in.ts';
import { isSidePaneShownAsPane } from './queries.ts';
/** Why every edit is refused. */
export type EditRefusalWhy = NonNullable<RefusalOfEveryEdit>;
/** The notice that an edit is refused, and what was asked. */
export interface EditRefusedNotice {
  kind: 'editRefused';
  why: EditRefusalWhy | 'commentModeIsOn';
  asked: 'otherEdit';
}
export function isEffectAnEdit(effect: PageEffect) {
  switch (effect.kind) {
    case 'queueEdit':
    case 'undoOrRedo':
    case 'queueEditsThatTakeBack':
      return true;
    case 'readEditsThatTakeBack':
      return true;
    case 'copyChartNodes':
      return true;
    case 'declareCellTable':
    case 'seeRowsInOwnOrder':
    case 'putOnClipboard':
    case 'putNothingOnClipboard':
    case 'readOffersUnderAt':
    case 'askAgentAboutSelection':
    case 'oweAgentAnAsk':
    case 'giveUpAskOwedToAgent':
    case 'workOutFormulasLeft':
    case 'workOutFormulaRead':
    case 'findPeople':
    case 'discardChartNodes':
    case 'waitForPeople':
    case 'dropWhatIsHeld':
    case 'lookUpPeople':
    case 'tellOthersOwnSelection':
    case 'tellOthersWhomViewFollows':
    case 'copyLinkToSheet':
    case 'openCommentBox':
    case 'openComment':
    case 'shutComment':
    case 'shutCommentBox':
    case 'endCommentMode':
    case 'tellAgentWhatIsSelected':
    case 'askAgentAboutImport':
    case 'stopAskingAgentAboutImport':
    case 'askAgentAboutConditionalFormats':
    case 'stopAskingAgentAboutConditionalFormats':
    case 'askAgentWhichRowsAreAskedFor':
    case 'askAgentAheadWhichRowsAreAskedFor':
    case 'tellAgentWhichRowsAreAskedFor':
    case 'stopAskingAgentWhichRowsAreAskedFor':
    case 'checkAgentForConditionalFormats':
    case 'checkAgentForFormulas':
    case 'askAgentForAFormula':
    case 'askAgentForANumberFormat':
    case 'stopAskingAgentForAFormula':
    case 'askAgentForAFix':
    case 'stopAskingAgentForFixes':
    case 'readVersions':
    case 'readCellHistory':
    case 'lookAtVersion':
    case 'endLookAtVersion':
      return false;
  }
}
export function isNoticeOfEditAttempt(notice: Notice | NewsOfLoss) {
  switch (notice.kind) {
    case 'mergeWouldClearCells':
    case 'cellHoldsNoMorePeople':
    case 'groupsTooDeep':
    case 'tooManyNamedViews':
    case 'dropdownCellsRefused':
    case 'fileNotImported':
    case 'alreadySorted':
    case 'matchesNotReplaced':
    case 'textsNotConverted':
    case 'versionNotTakenBack':
    case 'turnOfAgentNotUndone':
    case 'chartNotCut':
      return true;
    case 'versionNotShown':
      return false;
    case 'oneRangeNeeded':
    case 'rowsOutOfViewInTheWay':
    case 'ownSortInTheWay':
      return true;
    case 'editRefused':
      return !isEditRefusalReason(notice.why) && notice.why !== 'nothingLeftInSight';
    case 'sheetNameRefused':
      return !isEditRefusalReason(notice.refused.why);
    case 'cellsNotCopied':
    case 'chartsBeingCopied':
    case 'chartsLeftBehindByDuplicate':
    case 'changedSinceEdit':
    case 'formatsTooMixedSinceEdit':
    case 'nothingElseLeftSinceEdit':
    case 'sheetNameTakenSinceEdit':
    case 'sheetNotBroughtBack':
    case 'stepGivenUp':
    case 'editsDropped':
    case 'undoStepsLeftInEarlierPage':
    case 'entryDroppedByMerge':
    case 'entryDroppedByRemoval':
    case 'entriesNotKept':
    case 'entryNotForCheckbox':
    case 'linkNotCopied':
    case 'linkHeldByCommentMode':
    case 'noTableToFilter':
    case 'filteredTableIsGone':
    case 'ownSortIsOver':
    case 'ownFilterNotWorkedOut':
    case 'fixesCameToNothing':
    case 'callsForFixesFailed':
    case 'fixesGoneWithChange':
      return false;
  }
}
export function editsOfEffect(effect: PageEffect) {
  if (effect.kind === 'discardChartNodes') return [effect];
  return effect.kind === 'queueEdit' ? discardCopiedChartNodes(effect.edit) : [];
}
export function triesToEdit(state: PageState, { state: transition, effects }: PageTransition) {
  return (
    effects.some(isEffectAnEdit) ||
    effects.some(isCutToClipboard) ||
    (transition.mode.kind === 'editing' && state.mode.kind !== 'editing') ||
    (transition.sheetBeingRenamed !== null && state.sheetBeingRenamed === null) ||
    (transition.customNumberFormat?.typedIn === 'dialog' && state.customNumberFormat?.typedIn !== 'dialog') ||
    (transition.pasteThatWaits !== null && state.pasteThatWaits === null) ||
    (transition.pickForWorkbook !== null && state.pickForWorkbook === null) ||
    (transition.importOfAFile !== null && state.importOfAFile === null) ||
    (transition.fileAwaited !== null && state.fileAwaited === null) ||
    (transition.linkForm !== null && state.linkForm === null) ||
    (transition.notice !== null && transition.notice !== state.notice && isNoticeOfEditAttempt(transition.notice)) ||
    ((transition.lastDone?.what === 'noDateEntered' ||
      transition.lastDone?.what === 'markSetInEntry' ||
      transition.lastDone?.what === 'linkSetInEntry' ||
      transition.lastDone?.what === 'listSetInEntry' ||
      transition.lastDone?.what === 'boxOfLineSet') &&
      transition.lastDone !== state.lastDone)
  );
}
export function refuseEditsInCommentMode(state: PageState, transition: PageTransition, { kind }: PageEvent): PageTransition {
  if (
    kind === 'editAnswered' ||
    kind === 'undoOrRedoAnswered' ||
    kind === 'takeBackAnswered' ||
    kind === 'editsThatTakeBackRead' ||
    kind === 'chartNodesCopied' ||
    !triesToEdit(state, transition)
  )
    return transition;
  return {
    state: {
      ...state,
      dragging: kind === 'pointerReleased' ? null : state.dragging,
      isPressToComment: kind === 'pointerReleased' ? false : state.isPressToComment,
      hasCommentModeRefused: true,
      notice: {
        kind: 'editRefused',
        why: 'commentModeIsOn',
        asked: 'otherEdit',
      },
    },
    effects: transition.effects.some(isCutToClipboard)
      ? [
          {
            kind: 'putNothingOnClipboard',
          },
        ]
      : [],
  };
}
export function menuAfterEdit(state: PageState, { menu }: Pick<PageState, 'menu'>): Menu | null {
  if (menu === null || menu.holds === 'noEdits') return menu;
  return menu.holds === 'all' && menu !== state.menu
    ? {
        ...menu,
        holds: 'noEdits',
      }
    : null;
}
export function closeEverythingOpen(state: PageState, why: EditRefusalWhy, menu: Menu | null, sidePane: SidePane | null): PageState {
  let isNoticeOfAttemptUp = state.notice !== null && isNoticeOfEditAttempt(state.notice);
  let waysIn: PageState['waysIn'] = why === 'editingPaused' ? state.waysIn : 'areNotToCome';
  let isAllShut =
    state.menu === menu &&
    state.sidePane === sidePane &&
    isNothingOpen({
      ...state,
      menu: null,
      sidePane: null,
    }) &&
    state.waysIn === waysIn;
  let isUndoOffered = state.undoOffer !== null || state.undoOfTurnOffered !== null;
  if (isAllShut && !isUndoOffered && !isNoticeOfAttemptUp) return state;
  return {
    ...(state.linkForm?.opensEntry === true ? leaveEntryEditing(state) : state),
    menu,
    customNumberFormat: null,
    pasteThatWaits: null,
    pickForWorkbook: null,
    importOfAFile: null,
    fileAwaited: null,
    cellHistory: null,
    calendar: null,
    linkForm: null,
    dropdown: null,
    sidePane,
    waysIn,
    peopleList: null,
    timeList: null,
    sheetBeingRenamed: null,
    undoOffer: null,
    undoOfTurnOffered: null,
    notice: isNoticeOfAttemptUp ? null : state.notice,
  };
}
export function refuseEditsOfTransition(state: PageState, transition: PageTransition, why: EditRefusalWhy): PageTransition {
  if (leavesEntryUnchanged(state, transition))
    return refuseEditsOfTransition(
      state,
      withNoEffects({
        ...leaveEntryEditing(state),
        dropdown: null,
        peopleList: null,
      }),
      why,
    );
  let notice: Notice | EditRefusedNotice =
    state.notice?.kind === 'entriesNotKept'
      ? state.notice
      : {
          kind: 'editRefused',
          why,
          asked: 'otherEdit',
        };
  let isEarlierVersionShown = why === 'earlierVersionShown';
  let sidePaneKept = ({ sidePane }: Pick<PageState, 'sidePane'>) =>
    isEarlierVersionShown && sidePane?.kind === 'versionHistory' ? sidePane : null;
  if (triesToEdit(state, transition)) {
    let heldEdits = stopArrowsActingOnCells(state);
    let heldUntilAnswered = transition.state.heldUntilAnswered === null ? null : state.heldUntilAnswered;
    return withStopImportAskEffect(state, {
      state: closeEverythingOpen(
        {
          ...heldEdits,
          notice,
          heldUntilAnswered,
        },
        why,
        null,
        sidePaneKept(heldEdits),
      ),
      effects: [
        ...(transition.effects.some(isCutToClipboard)
          ? [
              {
                kind: 'putNothingOnClipboard',
              } satisfies PageEffect,
            ]
          : []),
        ...transition.effects.flatMap(editsOfEffect),
      ],
    });
  }
  let menu = menuAfterEdit(state, transition.state);
  let isMenuShut = menu === null && transition.state.menu !== null && transition.state.menu !== state.menu;
  let isCalendarKeptShut = transition.state.calendar !== null && state.calendar === null && transition.state.mode.kind === 'navigating';
  let isListKeptShut =
    ((transition.state.dropdown !== null && state.dropdown === null) ||
      (transition.state.peopleList !== null && state.peopleList === null) ||
      (transition.state.sidePane !== null && state.sidePane === null && !isEarlierVersionShown)) &&
    transition.state.dragging === null &&
    transition.state.mode.kind === 'navigating';
  let isHistoryKeptShut = transition.state.cellHistory !== null && state.cellHistory === null;
  let shut = closeEverythingOpen(transition.state, why, menu, sidePaneKept(transition.state));
  let isRefusalTold = isMenuShut || isCalendarKeptShut || isListKeptShut || isHistoryKeptShut;
  return withStopImportAskEffect(transition.state, {
    state: isRefusalTold
      ? {
          ...shut,
          notice,
        }
      : shut,
    effects: transition.effects.filter(
      ({ kind }: PageEffect) =>
        kind !== 'askAgentAboutImport' &&
        kind !== 'askAgentAboutConditionalFormats' &&
        kind !== 'askAgentForAFormula' &&
        kind !== 'askAgentForANumberFormat' &&
        kind !== 'askAgentForAFix' &&
        (kind !== 'readVersions' || isEarlierVersionShown) &&
        !(isEarlierVersionShown && EFFECTS_KEPT_IN_VERSION_HISTORY.has(kind)),
    ),
  });
}
export const EFFECTS_KEPT_IN_VERSION_HISTORY = new Set<string>([
  'askAgentAboutSelection',
  'oweAgentAnAsk',
  'openCommentBox',
  'openComment',
  'copyLinkToSheet',
]);
export const isNoticeOfOtherEditRefused = (notice: Notice | null) =>
  notice?.kind === 'editRefused' && notice.asked === 'otherEdit' && (isEditRefusalReason(notice.why) || notice.why === 'commentModeIsOn');
export const isCutToClipboard = (effect: PageEffect) => effect.kind === 'putOnClipboard' && effect.cutToken !== null;
export const isNothingOpen = (state: PageState) =>
  state.menu === null &&
  state.customNumberFormat === null &&
  state.pasteThatWaits === null &&
  state.pickForWorkbook === null &&
  state.importOfAFile === null &&
  state.fileAwaited === null &&
  state.cellHistory === null &&
  state.calendar === null &&
  state.linkForm === null &&
  state.dropdown === null &&
  state.sidePane === null &&
  state.peopleList === null &&
  state.timeList === null &&
  state.sheetBeingRenamed === null;
export const isNothingOpenButPane = (state: PageState) =>
  isNothingOpen(
    isSidePaneShownAsPane(state)
      ? {
          ...state,
          sidePane: null,
        }
      : state,
  );
export const leavesEntryUnchanged = (state: PageState, { effects }: PageTransition) =>
  state.mode.kind === 'editing' &&
  [state.mode.textAtStart, entryCellTextAsEdited(state)].includes(state.mode.text) &&
  effects.some((effect) => effect.kind === 'queueEdit' && effect.edit.kind === 'enter' && !effect.ifQueued.leavesEntryOpen);
