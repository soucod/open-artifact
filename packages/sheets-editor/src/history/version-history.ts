import { versionHistoryOfPane } from '../state/queries.ts';
import { withNoEffects, clearPassingNotice, type PageEffect, type PageTransition } from '../state/transitions.ts';
import { commitEntryInPlaceIfEditing } from '../editor/commit-entry.ts';
import { showChangedPlace } from '../state/edit-answers.ts';
import { editRefusalReason } from '../model/refusals.ts';
import type {
  HistoryWhy,
  LookAtVersion,
  PageState,
  TakingBack,
  VersionHistoryInPane,
  VersionOfWorkbook,
  VersionRestoredOffer,
  VersionsAwaited,
  WhatIsTakenBack,
} from '../state/initial-state.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type {
  EditsThatTakeBackOutcome,
  PageEvent,
  TakeBackAnswered,
  VersionHistoryAct,
  VersionHistoryCarriedOn,
  VersionsReadOutcome,
  WhyVersionNotShown,
} from '../state/event-reducer.ts';
import type { EditAuthor } from './requests.ts';
import type { ProfileOfPerson } from '../chips/people-list.ts';
import type { AgentUndoRefusalWhy } from '../i18n/agent-turn-labels.ts';

/** What is to be taken back, and how many times the store moved on before the edits that take it back were read. */
export interface TakingBackAsked {
  what: WhatIsTakenBack;
  timesMovedOn: number;
}
/** Edits that take back read from the store; `'storeMovedOn'` is handled, though no read gives it now. */
export type EditsThatTakeBackAnswer = EditsThatTakeBackOutcome | { kind: 'notRead'; why: 'storeMovedOn' };
/** The newest versions read, or the list as it stands with them taken in. */
interface VersionsListed {
  versions: VersionOfWorkbook[];
  hasOlder: boolean;
}
/** An author of a version as the pane shows it: a person's name is null while their profile is awaited. */
export type ShownAuthor = { kind: 'agent' } | { kind: 'person'; userId: string; name: string | null; avatarUrl: string };
/** A version as the pane lists it. */
export interface ShownVersion {
  revision: number;
  firstRevision: number;
  atMs: number;
  authors: ShownAuthor[];
  isCurrent: boolean;
  isBeingRestored: boolean;
}
/** The version looked at, or being opened to be looked at. */
export interface ShownVersionLook {
  firstRevision: number;
  atMs: number;
  isOpening: boolean;
}
/** The version history as the pane shows it. */
export interface ShownVersionHistory {
  versions: ShownVersion[] | null;
  whyNotRead: HistoryWhy | null;
  hasOlder: boolean;
  awaited: VersionsAwaited['of'] | null;
  isTakingBack: boolean;
  look: ShownVersionLook | null;
  picked: number | null;
  isCaretForCells: boolean;
  pickedLast: number | null;
  /** The change count the history is behind at, while it waits to be read again. */
  behindAtChangeCount: number | null;
}
/** The version history last shown, and what it was worked out from. */
interface ShownVersionHistoryKept {
  pane: VersionHistoryInPane;
  takingBack: TakingBack | null;
  profilesById: Map<string, ProfileOfPerson>;
  behindAtChangeCount: number | null;
  shown: ShownVersionHistory;
}

export let lastShownVersionHistory: ShownVersionHistoryKept | null;
export function askForVersions(state: PageState, history: VersionHistoryInPane, of: VersionsAwaited['of']): PageTransition {
  let askId = state.versionHistoryAskCount + 1;
  let { firstRevision }: Partial<VersionOfWorkbook> = (of === 'older' ? history.versions?.at(-1) : null) ?? {};
  let before = firstRevision === undefined ? null : { firstRevision };
  return {
    state: {
      ...state,
      versionHistoryAskCount: askId,
      sidePane: {
        kind: 'versionHistory',
        history: {
          ...history,
          whyNotRead: of === versionsAskedOf(history) ? history.whyNotRead : null,
          awaited: {
            askId,
            of,
            atChangeCount: state.saving === 'allSaved' ? state.workbookChangeCount : null,
          },
        },
      },
    },
    effects: [
      {
        kind: 'readVersions',
        askId,
        before,
      },
    ],
  };
}
export function toggleVersionHistory(state: PageState): PageTransition {
  let history = versionHistoryOfPane(state);
  if (history !== null)
    return {
      state: {
        ...state,
        sidePane: null,
      },
      effects:
        history.look === null
          ? []
          : [
              {
                kind: 'endLookAtVersion',
                pane: null,
                thenRestore: null,
                isByPerson: true,
              },
            ],
    };
  return askForVersions(
    {
      ...state,
      menu: null,
      dropdown: null,
    },
    {
      versions: null,
      hasOlder: false,
      whyNotRead: null,
      awaited: null,
      readAtChangeCount: null,
      authorsLookedUp: new Set(),
      authorsAwaited: new Set(),
      looksInVainInARow: 0,
      look: null,
      picked: null,
      isCaretForCells: false,
      pickedLast: null,
    },
    'newest',
  );
}
export function mergeNewestVersions(history: VersionHistoryInPane, { versions, hasOlder }: VersionsListed): VersionsListed {
  let oldestNew = versions.at(-1);
  let olderKept =
    oldestNew === undefined ? [] : (history.versions ?? []).filter(({ revision }) => revision < oldestNew.firstRevision);
  return olderKept.length === 0
    ? {
        versions,
        hasOlder,
      }
    : {
        versions: [...versions, ...olderKept],
        hasOlder: history.hasOlder,
      };
}
export function versionsAnswered(state: PageState, askId: number, answer: VersionsReadOutcome): PageTransition {
  let history = versionHistoryOfPane(state);
  if (history === null || history.awaited?.askId !== askId) return withNoEffects(state);
  let { of: awaitedOf, atChangeCount } = history.awaited;
  let historyAnswered = {
    ...history,
    awaited: null,
  };
  if (answer.kind === 'notRead') {
    let isNewestAgain = awaitedOf === 'newest' && history.versions !== null;
    return withNoEffects(
      setVersionHistoryPane(
        state,
        isNewestAgain
          ? {
              ...historyAnswered,
              readAtChangeCount: atChangeCount,
              looksInVainInARow: history.looksInVainInARow + 1,
            }
          : {
              ...historyAnswered,
              whyNotRead: answer.why,
            },
      ),
    );
  }
  let { versions, hasOlder } = answer;
  let userIdsToLookUp = authorsToLookUp(
    state,
    history,
    versions.flatMap(({ authors }) => authors),
  );
  let historyRead = {
    ...historyAnswered,
    whyNotRead: null,
    authorsLookedUp: new Set([...history.authorsLookedUp, ...userIdsToLookUp]),
    authorsAwaited: new Set([...history.authorsAwaited, ...userIdsToLookUp]),
  };
  return {
    state: setVersionHistoryPane(
      state,
      awaitedOf === 'older'
        ? {
            ...historyRead,
            versions: [...(history.versions ?? []), ...versions],
            hasOlder,
          }
        : {
            ...historyRead,
            ...mergeNewestVersions(history, answer),
            readAtChangeCount: atChangeCount,
            looksInVainInARow: 0,
          },
    ),
    effects:
      userIdsToLookUp.length === 0
        ? []
        : [
            {
              kind: 'lookUpPeople',
              userIds: userIdsToLookUp,
            },
          ],
  };
}
/** The user ids awaited, less those that arrived; the same set when none of them did. */
export function withoutAuthors(authors: Set<string>, arrived: string[]): Set<string> {
  if (!arrived.some((userId) => authors.has(userId))) return authors;
  let kept = new Set(authors);
  for (let userId of arrived) kept.delete(userId);
  return kept;
}
export function versionAuthorsArrived(state: PageState, userIds: string[]): PageState {
  let history = versionHistoryOfPane(state);
  if (history === null) return state;
  let awaited = withoutAuthors(history.authorsAwaited, userIds);
  return awaited === history.authorsAwaited
    ? state
    : setVersionHistoryPane(state, {
        ...history,
        authorsAwaited: awaited,
      });
}
export function isVersionHistoryBehind(state: PageState): boolean {
  let history = versionHistoryOfPane(state);
  return (
    history !== null &&
    history.versions !== null &&
    history.awaited === null &&
    state.takingBack === null &&
    history.look === null &&
    history.looksInVainInARow < MOST_LOOKS_IN_VAIN &&
    history.readAtChangeCount !== state.workbookChangeCount &&
    state.saving === 'allSaved'
  );
}
export function refreshVersionHistory(state: PageState): PageTransition {
  let history = versionHistoryOfPane(state);
  return history !== null && isVersionHistoryBehind(state) ? askForVersions(state, history, 'newest') : withNoEffects(state);
}
export function askForEditsThatTakeBack(state: PageState, takingBack: TakingBackAsked): PageTransition {
  let askId = state.versionHistoryAskCount + 1;
  let { what, timesMovedOn } = takingBack;
  return {
    state: {
      ...clearPassingNotice(state),
      versionHistoryAskCount: askId,
      takingBack: {
        ...takingBack,
        askId,
      },
    },
    effects: [
      {
        kind: 'readEditsThatTakeBack',
        askId,
        asked:
          what.kind === 'allSinceVersion'
            ? {
                kind: 'allSince',
                revision: what.version.revision,
              }
            : {
                kind: 'only',
                ranges: what.edits,
              },
        afterMs: timesMovedOn === 0 ? 0 : TAKE_BACK_RETRY_MS,
      },
    ],
  };
}
export function dropStaleTakingBack(state: PageState): PageState {
  if (state.takingBack === null) return state;
  let { what } = state.takingBack;
  return (what.kind === 'allSinceVersion' ? versionHistoryOfPane(state) !== null : state.undoOfTurnOffered?.edits === what.edits)
    ? state
    : {
        ...state,
        takingBack: null,
      };
}
export function startTakingBack(state: PageState, workbook: ReadsWithTextMeasurer, what: WhatIsTakenBack): PageTransition {
  if (state.takingBack !== null) return withNoEffects(state);
  let committed = commitEntryInPlaceIfEditing(state, workbook);
  let asked = askForEditsThatTakeBack(committed?.state ?? state, {
    what,
    timesMovedOn: 0,
  });
  return {
    state: asked.state,
    effects: [...(committed?.effects ?? []), ...asked.effects],
  };
}
export function lookAtVersion(state: PageState, history: VersionHistoryInPane, revision: number): PageTransition {
  let version = history.versions?.find((listed) => listed.revision === revision);
  if (version === undefined || state.takingBack !== null) return withNoEffects(state);
  if (history.look?.awaited?.version.revision === revision) return withNoEffects(state);
  let askId = state.versionHistoryAskCount + 1;
  let historyLooking = {
    ...history,
    look: {
      shown: history.look?.shown ?? null,
      awaited: {
        askId,
        version,
      },
    },
    picked: version.firstRevision,
    isCaretForCells: false,
    pickedLast: null,
  };
  return {
    state: {
      ...clearPassingNotice(state),
      versionHistoryAskCount: askId,
      notice: null,
      sidePane: {
        kind: 'versionHistory',
        history: historyLooking,
      },
    },
    effects: [
      {
        kind: 'lookAtVersion',
        askId,
        revision,
        pane: historyLooking,
      },
    ],
  };
}
export function carrySessionIntoState(
  state: PageState,
  history: VersionHistoryInPane | null,
  { profilesById, ...session }: VersionHistoryCarriedOn['kept'],
): PageState {
  let carried = {
    ...state,
    ...session,
    areStepsToUndoLost: false,
    profilesById: new Map([...profilesById, ...state.profilesById]),
  };
  if (history === null) return carried;
  let authorsLookedUp = new Set(history.authorsLookedUp);
  for (let userId of history.authorsAwaited) authorsLookedUp.delete(userId);
  return {
    ...carried,
    sidePane: {
      kind: 'versionHistory',
      history: {
        ...history,
        awaited: null,
        readAtChangeCount: null,
        authorsLookedUp,
        authorsAwaited: new Set(),
      },
    },
    timesSidePaneAsked: state.timesSidePaneAsked + 1,
  };
}
export function endVersionLook(state: PageState): PageState {
  let history = versionHistoryOfPane(state);
  return history === null
    ? state
    : setVersionHistoryPane(state, {
        ...history,
        look: null,
      });
}
export function endLookEffects(previousState: PageState, state: PageState, effects: PageEffect[], event: PageEvent): PageEffect[] {
  return !((versionHistoryOfPane(previousState)?.look ?? null) !== null && (versionHistoryOfPane(state)?.look ?? null) === null) ||
    effects.some(({ kind }) => kind === 'endLookAtVersion')
    ? effects
    : [
        ...effects,
        {
          kind: 'endLookAtVersion',
          pane: versionHistoryOfPane(state),
          thenRestore: null,
          ...(event.kind === 'keyPressed' && {
            isByPerson: true,
          }),
        },
      ];
}
export function versionLookAnswered(state: PageState, askId: number, failure: WhyVersionNotShown | null): PageTransition {
  let history = versionHistoryOfPane(state);
  let awaited = history?.look?.awaited ?? null;
  if (history === null || history.look === null || awaited?.askId !== askId) return withNoEffects(state);
  if (failure === null)
    return withNoEffects(
      setVersionHistoryPane(state, {
        ...history,
        look: {
          shown: awaited.version,
          awaited: null,
        },
      }),
    );
  let { shown: shownBefore } = history.look;
  let historyAfter = setVersionHistoryPane(
    state,
    shownBefore === null
      ? {
          ...history,
          look: null,
        }
      : {
          ...history,
          look: {
            shown: shownBefore,
            awaited: null,
          },
          picked: shownBefore.firstRevision,
        },
  );
  return withNoEffects(
    failure === 'calledOff'
      ? historyAfter
      : {
          ...historyAfter,
          notice: {
            kind: 'versionNotShown',
            why: failure,
          },
        },
  );
}
export function versionHistoryActed(state: PageState, workbook: ReadsWithTextMeasurer, action: VersionHistoryAct): PageTransition {
  let history = versionHistoryOfPane(state);
  if (history === null) return withNoEffects(state);
  switch (action.kind) {
    case 'look': {
      let committed = commitEntryInPlaceIfEditing(state, workbook);
      if (committed === null) return lookAtVersion(state, history, action.revision);
      let looking = lookAtVersion(committed.state, history, action.revision);
      return {
        state: looking.state,
        effects: [...committed.effects, ...looking.effects],
      };
    }
    case 'endLook': {
      if (history.look === null)
        return withNoEffects(
          setVersionHistoryPane(state, {
            ...history,
            picked: null,
          }),
        );
      let paneAfterLook = paneWithLookEnded(history, action, history.picked);
      return {
        state: setVersionHistoryPane(state, paneAfterLook),
        effects: [
          {
            kind: 'endLookAtVersion',
            pane: paneAfterLook,
            thenRestore: null,
          },
        ],
      };
    }
    case 'restore': {
      let versionToRestore = history.versions?.find((version) => version.revision === action.revision);
      if ((history.look?.shown ?? null) !== null) {
        let paneAfterLook = paneWithLookEnded(history, action, versionToRestore?.firstRevision ?? history.picked);
        return {
          state: setVersionHistoryPane(state, paneAfterLook),
          effects: [
            {
              kind: 'endLookAtVersion',
              pane: paneAfterLook,
              thenRestore: action.revision,
            },
          ],
        };
      }
      return versionToRestore === undefined
        ? withNoEffects(state)
        : startTakingBack(state, workbook, {
            kind: 'allSinceVersion',
            version: versionToRestore,
          });
    }
    case 'showOlder':
      return history.hasOlder && history.awaited?.of !== 'older' ? askForVersions(state, history, 'older') : withNoEffects(state);
    case 'tryAgain': {
      let askedOf = versionsAskedOf(history);
      return history.whyNotRead === null || history.awaited?.of === askedOf ? withNoEffects(state) : askForVersions(state, history, askedOf);
    }
  }
}
export function takeBackFailed(state: PageState, { what }: Pick<TakingBackAsked, 'what'>, why: AgentUndoRefusalWhy): PageState {
  let stateCleared = {
    ...state,
    takingBack: null,
    lastDone: null,
  };
  if (what.kind === 'allSinceVersion')
    return {
      ...stateCleared,
      notice: {
        kind: 'versionNotTakenBack',
        why: why === 'changedSince' ? 'refused' : why,
      },
    };
  return {
    ...stateCleared,
    undoOfTurnOffered: RETRYABLE_TAKE_BACK_FAULTS.has(why) ? state.undoOfTurnOffered : null,
    isUndoOfTurnNotToBeHad: state.isUndoOfTurnNotToBeHad || FATAL_TAKE_BACK_FAULTS.has(why),
    notice: {
      kind: 'turnOfAgentNotUndone',
      why,
    },
  };
}
export function retryTakingBack(state: PageState, takingBack: TakingBackAsked): PageTransition {
  let timesMovedOn = takingBack.timesMovedOn + 1;
  return timesMovedOn < MOST_TIMES_MOVED_ON
    ? askForEditsThatTakeBack(state, {
        ...takingBack,
        timesMovedOn,
      })
    : withNoEffects(takeBackFailed(state, takingBack, 'storeMovedOn'));
}
export function editsThatTakeBackRead(
  state: PageState,
  workbook: ReadsWithTextMeasurer,
  askId: number,
  answer: EditsThatTakeBackAnswer,
): PageTransition {
  let { takingBack } = state;
  if (takingBack === null || takingBack.askId !== askId) return withNoEffects(state);
  let committed = commitEntryInPlaceIfEditing(state, workbook);
  if (committed !== null && committed.effects.length > 0) {
    let retried = retryTakingBack(committed.state, takingBack);
    return {
      state: retried.state,
      effects: [...committed.effects, ...retried.effects],
    };
  }
  if (committed !== null) return editsThatTakeBackRead(committed.state, workbook, askId, answer);
  if (answer.kind === 'read') {
    let { builtOnRevision, edits } = answer;
    let { what } = takingBack;
    let offerIfMade: VersionRestoredOffer | null =
      what.kind === 'allSinceVersion'
        ? {
            kind: 'versionRestored',
            atMs: what.version.atMs,
            isSaved: false,
          }
        : null;
    return {
      state,
      effects: [
        {
          kind: 'queueEditsThatTakeBack',
          askId,
          builtOnRevision,
          edits,
          offerIfMade,
        },
      ],
    };
  }
  switch (answer.why) {
    case 'storeMovedOn':
      return retryTakingBack(state, takingBack);
    case 'unknownRevision': {
      let failed = takeBackFailed(state, takingBack, 'refused');
      let historyAfter = versionHistoryOfPane(failed);
      return historyAfter === null || takingBack.what.kind !== 'allSinceVersion'
        ? withNoEffects(failed)
        : askForVersions(failed, historyAfter, 'newest');
    }
    case 'changedSince':
    case 'storeDoesNotKnowHow':
    case 'recordDoesNotMatch':
    case 'tookTooLong':
    case 'busy':
    case 'noAnswer':
    case 'refused':
    case 'tooMuch':
    case 'notAccepted':
      return withNoEffects(takeBackFailed(state, takingBack, answer.why));
  }
}
export function takeBackAnswered(state: PageState, workbook: ReadsWithTextMeasurer, { askId, outcome, offerIfMade }: TakeBackAnswered): PageTransition {
  let takingBack = state.takingBack?.askId === askId ? state.takingBack : null;
  let stateCleared =
    takingBack === null
      ? state
      : {
          ...state,
          takingBack: null,
        };
  if (outcome.kind === 'made') {
    let stateMade = {
      ...clearPassingNotice(stateCleared),
      dragging: null,
    };
    let changedOnSheet = outcome.changed?.sheetId === stateMade.sheetId ? outcome.changed : null;
    return withNoEffects({
      ...stateMade,
      lastDone: offerIfMade === null ? showChangedPlace(stateMade, workbook, 'undone', changedOnSheet).lastDone : null,
      undoOffer: offerIfMade,
      undoOfTurnOffered: null,
    });
  }
  if (takingBack === null) return withNoEffects(state);
  switch (outcome.kind) {
    case 'builtOnAnotherRevision':
      return retryTakingBack(state, takingBack);
    case 'refused': {
      let reason = editRefusalReason(outcome.refusal);
      return withNoEffects(
        reason === 'fault'
          ? takeBackFailed(state, takingBack, reason)
          : {
              ...stateCleared,
              notice: {
                kind: 'editRefused',
                why: reason,
                asked: 'otherEdit',
              },
            },
      );
    }
    case 'nothingToChange':
      return withNoEffects(takeBackFailed(state, takingBack, outcome.kind));
  }
}
export function authorShown(author: EditAuthor, profilesById: Map<string, ProfileOfPerson>, awaitedAuthors: Set<string>): ShownAuthor {
  if (author.kind === 'agent') return author;
  let { name = '', avatarUrl = '' }: Partial<ProfileOfPerson> = profilesById.get(author.userId) ?? {};
  return {
    ...author,
    name: name === '' && awaitedAuthors.has(author.userId) ? null : name,
    avatarUrl,
  };
}
export function versionLookShown(look: LookAtVersion | null): ShownVersionLook | null {
  let version = look?.awaited?.version ?? look?.shown ?? null;
  if (look === null || version === null) return null;
  let { firstRevision, atMs } = version;
  return {
    firstRevision,
    atMs,
    isOpening: look.awaited !== null,
  };
}
export function shownVersionHistory(state: PageState): ShownVersionHistory | null {
  let [history, { profilesById }] = [versionHistoryOfPane(state), state];
  if (history === null) return null;
  let behindAtChangeCount = isVersionHistoryBehind(state) ? state.workbookChangeCount : null;
  let { takingBack } = state;
  let versionBeingRestored = takingBack?.what.kind === 'allSinceVersion' ? takingBack.what.version : null;
  if (
    lastShownVersionHistory?.pane === history &&
    lastShownVersionHistory.takingBack === takingBack &&
    lastShownVersionHistory.profilesById === profilesById &&
    lastShownVersionHistory.behindAtChangeCount === behindAtChangeCount
  )
    return lastShownVersionHistory.shown;
  let shown: ShownVersionHistory = {
    versions:
      history.versions?.map(
        (version, index) => ({
          revision: version.revision,
          firstRevision: version.firstRevision,
          atMs: version.atMs,
          authors: version.authors.map((author) => authorShown(author, profilesById, history.authorsAwaited)),
          isCurrent: index === 0,
          isBeingRestored: versionBeingRestored?.firstRevision === version.firstRevision,
        }),
      ) ?? null,
    whyNotRead: history.whyNotRead,
    hasOlder: history.hasOlder,
    awaited: history.awaited?.of ?? null,
    isTakingBack: takingBack !== null,
    look: versionLookShown(history.look),
    picked: history.picked,
    isCaretForCells: history.isCaretForCells,
    pickedLast: history.pickedLast,
    behindAtChangeCount,
  };
  lastShownVersionHistory = {
    pane: history,
    takingBack,
    profilesById,
    behindAtChangeCount,
    shown,
  };
  return shown;
}
export const MOST_LOOKS_IN_VAIN = 3;
export const MOST_TIMES_MOVED_ON = 3;
export const TAKE_BACK_RETRY_MS = 1000;
export const setVersionHistoryPane = (state: PageState, history: VersionHistoryInPane): PageState =>
  history === versionHistoryOfPane(state)
    ? state
    : {
        ...state,
        sidePane: {
          kind: 'versionHistory',
          history: history,
        },
      };
export const versionsAskedOf = ({ versions }: Pick<VersionHistoryInPane, 'versions'>): VersionsAwaited['of'] =>
  versions === null ? 'newest' : 'older';
/** The people among the authors whose profiles are still to be looked up. */
export const authorsToLookUp = (
  { profilesById }: Pick<PageState, 'profilesById'>,
  { authorsLookedUp }: { authorsLookedUp: Set<string> },
  authors: EditAuthor[],
): string[] =>
  [...new Set(authors.flatMap((author) => (author.kind === 'person' ? [author.userId] : [])))].filter(
    (userId) => !authorsLookedUp.has(userId) && (profilesById.get(userId)?.name ?? '') === '',
  );
export const paneWithLookEnded = (
  history: VersionHistoryInPane,
  { isFromBar, isByPointer }: { isFromBar?: true; isByPointer?: true },
  pickedLast: number | null,
): VersionHistoryInPane => ({
  ...history,
  look: null,
  picked: null,
  isCaretForCells: isFromBar === true || isByPointer === true,
  pickedLast,
});
export const RETRYABLE_TAKE_BACK_FAULTS = new Set<AgentUndoRefusalWhy>(['busy', 'noAnswer', 'storeMovedOn']);
export const FATAL_TAKE_BACK_FAULTS = new Set<AgentUndoRefusalWhy>(['storeDoesNotKnowHow', 'recordDoesNotMatch', 'tookTooLong']);
lastShownVersionHistory = null;
