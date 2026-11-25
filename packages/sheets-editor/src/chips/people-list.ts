import { AGENT_NAME } from '../agent/agent-name.ts';
import { withoutOtherRanges } from '../selection/several-ranges.ts';
import { clearPassingNotice, NAVIGATING_MODE, withNoEffects } from '../state/transitions.ts';
import {
  selectedArea,
  selectionAtCell,
  activeAnchorCell,
  isSameCell,
  areaOfPosition,
  moveActiveCellTo,
  isSameSelection,
} from '../selection/model.ts';
import { hasFilteredRowsIn } from '../tables/filtered-rows.ts';
import { settleSelectionSeen } from '../state/selection-seen.ts';
import { applyFormatCommand } from '../format/format-commands.ts';
import { withIfQueued, queueEdit, enterEntryEdit, IF_QUEUED_DEFAULTS } from '../model/edit-effects.ts';
import { hasEntryLists } from '../editor/entry-looks.ts';
import { cleanEnteredCellText, normalizeLineBreaks } from '../format/shown-text.ts';
import { isMentionText, mentionQueryOf } from './people-typing.ts';
import { isFormulaText } from './dropdown-pane-edits.ts';
import { usersOfCell } from '../model/cell-values.ts';
import { closeDropdownList } from './dropdowns.ts';
import { leaveEntryEditing, commitEntry } from '../editor/commit-entry.ts';
import { startEntryEditing } from '../editor/start-entry.ts';
import { isPlainCellClick, isDropdownListOutOfPlace } from './dropdown-sync.ts';
import { areaToA1AsStored } from '../formulas/from-words/where.ts';
import { ownRowOrderOfSheet } from '../model/line-ids.ts';
import { openCardAtRow, dropUndrawableCard, listCardOfRow } from '../ui/list-cards.ts';
import { cellRefOf } from '../model/workbook.ts';
import { parseTsvCells } from '../clipboard/formats.ts';
import { dropdownAtCell } from './dropdown-options.ts';
import { doesCellTakeCalendar } from './calendar.ts';
import { isTimeCell } from '../editor/time-list.ts';
import { canTellAgentSelection } from '../agent/view-context.ts';
import type { Edit, Person } from '@open-artifact/sheets-core';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { CardOfList, PageState, PeopleInCellDone } from '../state/initial-state.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { PageEffect, PageMode, PageTransition } from '../state/transitions.ts';
import type { PageContext, PageEvent, PasteChosen } from '../state/event-reducer.ts';
import type { CellFoundBy, GridScroll } from '../grid/geometry.ts';
import type { AtMenuOffer } from '../i18n/menu-labels.ts';
import type { FieldStep } from '../keys/key-acts.ts';
import type { ListCardDrawn, ListCardRow, ListCardSwatch } from './dropdowns.ts';
/** A person as the page shows them: by their profile, or by the label a cell holds when no profile is known. */
export interface ProfileOfPerson {
  userId: string;
  name: string;
  avatarUrl: string;
  color: string | null;
  isViewer: boolean;
  isGuest: boolean;
}
/** The people found for a search. */
export interface PeopleSearchFound {
  searchedFor: string;
  people: ProfileOfPerson[];
}
/** The list of people (and of offers of the @ menu) open under a cell. */
export interface PeopleListOpen {
  cellId: CellId;
  searchedFor: string;
  found: PeopleSearchFound | null;
  /** The offers of the @ menu, or `null` while they are still to be read. */
  offers: AtMenuOffer[] | null;
  card: CardOfList | null;
  /** The key of the row gone to, or `WENT_UNDER_AGENT`. */
  wentTo: string | null;
  scrollAsItOpened: GridScroll;
  heldAsItOpened: ProfileOfPerson[];
  isOfPeopleAlone: boolean;
  isAskedByTool: boolean;
  /** The user whose chip in the cell is gone to. */
  chipGoneTo: string | null;
}
/** What the entry asks the list of people for: the text typed and what it searches for. */
export interface PeopleListAsk {
  typed: string | null;
  searchedFor: string;
  isOfPeopleAlone: boolean;
}
/** An offer of the @ menu that is taken as it is, and not by a card of offers. */
export type InsertOffer = Exclude<AtMenuOffer, { kind: 'several' }>;
/** A group of rows in the list of people, in the order of `PEOPLE_LIST_GROUP_ORDER`. */
export type PeopleListGroup = 'agent' | 'people' | 'dates' | 'dropdowns' | 'controls';
export interface PersonRow {
  kind: 'person';
  profile: ProfileOfPerson;
  isHeldByCell: boolean;
}
export interface OfferRow {
  kind: 'offer';
  offer: AtMenuOffer;
}
/** The row that keeps what was typed as text. */
export interface KeepAsTextRow {
  kind: 'keepAsText';
  text: string;
}
/** A row of the list of people. */
export type PeopleListRow = PersonRow | OfferRow | KeepAsTextRow;
/** Where a step among the people chips of a cell lands: on a chip (or the caret, `null`), or off the cell sideways. */
export type StepAmongPeopleChips = { columnDelta: number } | { chip: string | null };
/** How far a people search has come. */
export type PeopleSearchStage = 'none' | 'underWay' | 'over';
export function groupOfInsertOffer({ kind }: Pick<AtMenuOffer, 'kind'>): PeopleListGroup {
  if (kind === 'askAgent') return 'agent';
  if (kind === 'calendar' || kind === 'day') return 'dates';
  return kind === 'checkbox' ? 'controls' : 'dropdowns';
}
export function isFoundByPeopleSearch(text: string, searchedFor: string): boolean {
  let folded = foldForPeopleSearch(searchedFor);
  return [text, ...text.split(/\s+/)].some((word) => foldForPeopleSearch(word).startsWith(folded));
}
export function selectionForAskingAgent(state: PageState, workbook: ReadsWithTextMeasurer, cellId: CellId): PageState {
  let navigating: PageState = {
    ...withoutOtherRanges(clearPassingNotice(state)),
    mode: NAVIGATING_MODE,
  };
  let area = selectedArea(navigating, workbook);
  return area === null || hasFilteredRowsIn(navigating, workbook, area)
    ? stateSelectingOnlyCell(state, workbook, cellId)
    : settleSelectionSeen(null, navigating, workbook);
}
export function takeInsertOffer(
  state: PageState,
  workbook: ReadsWithTextMeasurer,
  offer: InsertOffer,
  cellId: CellId,
  cellAfter: CellId,
  foundBy: CellFoundBy,
  movesOn: boolean,
): PageTransition {
  if (offer.kind === 'askAgent')
    return {
      state: selectionForAskingAgent(state, workbook, cellId),
      effects: [
        {
          kind: 'dropWhatIsHeld',
        },
        {
          kind: 'askAgentAboutSelection',
        },
      ],
    };
  let stateAtCell = stateSelectingOnlyCell(state, workbook, cellId);
  let thenGoesOnTo = movesOn ? cellAfter : null;
  switch (offer.kind) {
    case 'newDropdown':
    case 'dropdownOfSet':
      return applyFormatCommand(stateAtCell, workbook, {
        dropdown: true,
        firstSet: offer.set,
        ...(offer.kind === 'dropdownOfSet'
          ? {
              isReadySetPicked: true,
            }
          : {
              setsByName: state.readySets ?? [],
            }),
        replacesFormulas: true,
        thenOpens: 'list',
        ...(thenGoesOnTo !== null && {
          thenGoesOnTo,
        }),
      });
    case 'checkbox': {
      let checkboxSet: PageTransition = applyFormatCommand(stateAtCell, workbook, {
        checkbox: true,
      });
      let [firstEffect] = checkboxSet.effects;
      return thenGoesOnTo !== null && firstEffect?.kind === 'queueEdit'
        ? {
            state: checkboxSet.state,
            effects: [
              withIfQueued(firstEffect, {
                thenGoesOnTo,
              }),
            ],
          }
        : checkboxSet;
    }
    case 'calendar':
      return applyFormatCommand(stateAtCell, workbook, {
        dateToPick: true,
        ...(thenGoesOnTo !== null && {
          thenGoesOnTo,
        }),
      });
    case 'day':
      return queueEdit(
        state,
        enterEntryEdit(cellId, {
          kind: 'day',
          day: offer.day,
        }),
        {
          ...IF_QUEUED_DEFAULTS,
          select: selectionAtCell(cellAfter),
          foundBy,
          done: null,
        },
      );
  }
}
export function uniqueProfilesByUser(profiles: readonly ProfileOfPerson[]): ProfileOfPerson[] {
  let byUserId = new Map<string, ProfileOfPerson>();
  for (let profile of profiles) if (!byUserId.has(profile.userId)) byUserId.set(profile.userId, profile);
  return [...byUserId.values()];
}
export function peopleListRowsFor(peopleList: PeopleListOpen, typed: string | null, heldByCell: readonly ProfileOfPerson[]): PeopleListRow[] {
  let found = peopleFoundSoFar(peopleList);
  if (peopleList.isOfPeopleAlone)
    return found
      .filter((profile) => !hasProfileOfUser(heldByCell, profile))
      .slice(0, MAX_PEOPLE_IN_PEOPLE_LIST)
      .map(
        (profile): PersonRow => ({
          kind: 'person',
          profile,
          isHeldByCell: false,
        }),
      );
  let heldFirst = peopleList.searchedFor === '' ? peopleList.heldAsItOpened.slice(0, 1) : [];
  let rows: PeopleListRow[] = [
    ...[...heldFirst, ...found.filter((profile) => !hasProfileOfUser(heldFirst, profile))].slice(0, MAX_PEOPLE_BESIDE_OFFERS).map(
      (profile): PersonRow => ({
        kind: 'person',
        profile,
        isHeldByCell: hasProfileOfUser(heldByCell, profile),
      }),
    ),
    ...insertOffersMatching(peopleList.offers ?? [], peopleList.searchedFor).map(offerRowOf),
  ];
  return [
    ...PEOPLE_LIST_GROUP_ORDER.flatMap((group) => rows.filter((row) => groupOfPeopleListRow(row) === group)),
    ...(typed === null
      ? []
      : [
          {
            kind: 'keepAsText',
            text: typed,
          } satisfies KeepAsTextRow,
        ]),
  ];
}
export function indexOfPeopleListRowGoneTo(
  peopleList: Pick<PeopleListOpen, 'wentTo' | 'isOfPeopleAlone' | 'searchedFor'>,
  rows: readonly PeopleListRow[],
): number {
  let index = rows.findIndex(
    (row) => (peopleList.wentTo === WENT_UNDER_AGENT ? row.kind === 'person' : peopleListRowKey(row) === peopleList.wentTo),
  );
  if (index !== -1) return index;
  if (peopleList.wentTo === WENT_UNDER_AGENT) return Math.min(1, rows.length - 1);
  if (peopleList.isOfPeopleAlone && peopleList.searchedFor === '') return -1;
  let isHighlightable = (row: PeopleListRow) => {
    if (row.kind !== 'offer' || row.offer.kind === 'askAgent') return true;
    return peopleList.searchedFor !== '' && insertOfferLabelMatches(row.offer, peopleList.searchedFor);
  };
  return Math.max(rows.findIndex(isHighlightable), 0);
}
export function profilesWithChanges(
  profilesById: Map<string, ProfileOfPerson>,
  profiles: readonly ProfileOfPerson[],
): Map<string, ProfileOfPerson> {
  let isKnownAsIs = (profile: ProfileOfPerson) => {
    let known = profilesById.get(profile.userId);
    return (
      known !== undefined &&
      known.name === profile.name &&
      known.avatarUrl === profile.avatarUrl &&
      known.color === profile.color &&
      known.isViewer === profile.isViewer &&
      known.isGuest === profile.isGuest
    );
  };
  let changed = profiles.filter(
    (profile) => !isKnownAsIs(profile) && (profile.name !== '' || !profilesById.has(profile.userId)),
  );
  if (changed.length === 0) return profilesById;
  return new Map([...profilesById, ...changed.map((profile): [string, ProfileOfPerson] => [profile.userId, profile])]);
}
export function peopleListAskOf(state: PageState, workbook: WorkbookReads, isAskedByTool: boolean = false): PeopleListAsk | null {
  let { mode } = state;
  let cellId = activeAnchorCell(state, workbook);
  let isListOfPeopleHere = state.peopleList?.isOfPeopleAlone === true && isSameCell(state.peopleList.cellId, cellId);
  let wantsPeople =
    isPeopleCell(workbook, cellId) || isAskedByTool || (isListOfPeopleHere && (workbook.cellOf(cellId) === null || state.peopleList!.isAskedByTool));
  if (mode.kind !== 'editing')
    return wantsPeople
      ? {
          typed: null,
          searchedFor: '',
          isOfPeopleAlone: true,
        }
      : null;
  if (mode.isExpanded === true || hasEntryLists(mode)) return null;
  let text = cleanEnteredCellText(mode.text);
  if (isMentionText(text))
    return {
      typed: text,
      searchedFor: mentionQueryOf(text),
      isOfPeopleAlone: isListOfPeopleHere,
    };
  return wantsPeople && mode.typingIn === 'cell' && (text.trim() !== '' || isListOfPeopleHere) && !isFormulaText(text)
    ? {
        typed: text,
        searchedFor: text.trim(),
        isOfPeopleAlone: true,
      }
    : null;
}
export function profileOfUser(profilesById: ReadonlyMap<string, ProfileOfPerson>, { userId, label }: Person): ProfileOfPerson {
  let profile = profilesById.get(userId);
  return profile !== undefined && profile.name !== ''
    ? profile
    : {
        userId,
        name: label,
        avatarUrl: '',
        color: null,
        isViewer: false,
        isGuest: false,
      };
}
export function peopleListRows(state: PageState, workbook: WorkbookReads): PeopleListRow[] | null {
  let ask = peopleListAskOf(state, workbook);
  if (state.peopleList === null || ask === null) return null;
  let heldAsItOpened = state.peopleList.heldAsItOpened.map(
    ({ userId, name }) =>
      profileOfUser(state.profilesById, {
        userId,
        label: name,
      }),
  );
  return peopleListRowsFor(
    {
      ...state.peopleList,
      heldAsItOpened,
    },
    ask.typed,
    profilesHeldByCell(state, workbook, activeAnchorCell(state, workbook)),
  );
}
export function withPeopleFound(state: PageState, workbook: WorkbookReads, found: PeopleSearchFound): PageState {
  let { peopleList } = state;
  if (peopleList === null) return state;
  let rows = !peopleList.isOfPeopleAlone && peopleList.searchedFor === '' ? null : peopleListRows(state, workbook);
  if (rows === null)
    return {
      ...state,
      peopleList: {
        ...peopleList,
        found,
      },
    };
  let people = rows.flatMap((row) => (row.kind === 'person' ? [row.profile] : []));
  let highlighted = rows[indexOfPeopleListRowGoneTo(peopleList, rows)];
  let chosen =
    highlighted?.kind === 'offer' && highlighted.offer.kind === 'askAgent'
      ? rows.find(({ kind }) => kind === 'person')
      : highlighted;
  let peopleUpToChosen =
    chosen?.kind === 'person' && (isViewerOrInWorkbookTest(workbook)(chosen.profile) || peopleList.wentTo === peopleListRowKey(chosen))
      ? people.slice(0, people.indexOf(chosen.profile) + 1)
      : [];
  let peopleFirst = peopleList.isOfPeopleAlone ? people : peopleUpToChosen;
  let peopleShown = uniqueProfilesByUser([...peopleFirst, ...found.people, ...people]).map(
    (profile) => state.profilesById.get(profile.userId) ?? profile,
  );
  return {
    ...state,
    peopleList: {
      ...peopleList,
      found: {
        ...found,
        people: peopleShown,
      },
      wentTo:
        !peopleList.isOfPeopleAlone || peopleList.searchedFor === '' || highlighted === undefined ? peopleList.wentTo : peopleListRowKey(highlighted),
    },
  };
}
export function isEnterHeldInPeopleList(state: PageState, workbook: WorkbookReads, hasWaited: boolean): boolean {
  let { peopleList } = state;
  let rows = peopleListRows(state, workbook);
  if (peopleList === null || rows === null) return false;
  if ((peopleList.wentTo !== null && peopleList.wentTo !== WENT_UNDER_AGENT) || !(isPeopleSearchUnderWay(peopleList) || hasWaited)) return false;
  let highlighted = rows[indexOfPeopleListRowGoneTo(peopleList, rows)];
  if (peopleList.wentTo === WENT_UNDER_AGENT) return highlighted?.kind !== 'person';
  return (
    (highlighted?.kind === 'keepAsText' ||
      (highlighted?.kind === 'offer' && (highlighted.offer.kind === 'day' || highlighted.offer.kind === 'checkbox'))) &&
    usersOfCell(workbook.cellOf(peopleList.cellId)).length > 0
  );
}
export function shouldWaitForPeopleOnEnter(state: PageState, workbook: WorkbookReads): boolean {
  let { peopleList } = state;
  let rows = peopleListRows(state, workbook);
  if (peopleList === null || rows === null || peopleList.isOfPeopleAlone) return false;
  if (!isPeopleSearchUnderWay(peopleList)) return false;
  let highlighted = rows[indexOfPeopleListRowGoneTo(peopleList, rows)];
  if (peopleList.wentTo === WENT_UNDER_AGENT) return highlighted?.kind !== 'person';
  return peopleList.wentTo === null && isPeopleSearchLongEnough(peopleList.searchedFor) && highlighted?.kind === 'keepAsText';
}
export function peopleListOffersAgent(state: PageState, workbook: WorkbookReads): boolean {
  if (state.peopleList === null) return false;
  return (peopleListRows(state, workbook) ?? []).some((row) => row.kind === 'offer' && row.offer.kind === 'askAgent');
}
export function stepOffUnderAgent(state: PageState, workbook: WorkbookReads): PageState | null {
  let rows = peopleListRows(state, workbook);
  if (state.peopleList?.wentTo !== WENT_UNDER_AGENT || rows === null) return null;
  let highlighted = rows[indexOfPeopleListRowGoneTo(state.peopleList, rows)];
  if (highlighted === undefined || highlighted.kind === 'person') return null;
  return {
    ...state,
    peopleList: {
      ...state.peopleList,
      wentTo: peopleListRowKey(highlighted),
    },
  };
}
export function moveInPeopleList(
  state: PageState,
  workbook: WorkbookReads,
  step: (index: number, count: number) => number | null,
  isDownByOne: boolean,
): PageState {
  let rows = peopleListRows(state, workbook);
  if (state.peopleList === null || rows === null) return state;
  let index = indexOfPeopleListRowGoneTo(state.peopleList, rows);
  let next = rows[step(index, rows.length) ?? -1];
  if (next === undefined) return state;
  let current = rows[index];
  let wentTo =
    isDownByOne &&
    current?.kind === 'offer' &&
    current.offer.kind === 'askAgent' &&
    rows[index + 1] === next &&
    next.kind !== 'person' &&
    isPeopleSearchUnderWay(state.peopleList)
      ? WENT_UNDER_AGENT
      : peopleListRowKey(next);
  return {
    ...state,
    peopleList: {
      ...state.peopleList,
      wentTo,
      chipGoneTo: null,
    },
  };
}
export function refreshPeopleList(state: PageState, workbook: WorkbookReads, isAskedByTool: boolean = false): PageState {
  let ask = peopleListAskOf(state, workbook, isAskedByTool);
  if (ask === null)
    return state.peopleList === null
      ? state
      : {
          ...state,
          peopleList: null,
        };
  let cellId = activeAnchorCell(state, workbook);
  let listOfCell = state.peopleList !== null && isSameCell(state.peopleList.cellId, cellId) ? state.peopleList : null;
  let namedProfiles = [...state.profilesById.values()].filter(({ name }) => name !== '');
  let isSearchNew = listOfCell?.searchedFor !== ask.searchedFor || listOfCell.isOfPeopleAlone !== ask.isOfPeopleAlone;
  let peopleToShow = () => {
    if (ask.isOfPeopleAlone) return namedProfiles;
    let foundBefore = listOfCell?.isOfPeopleAlone === false ? (listOfCell.found?.people ?? []) : [];
    return uniqueProfilesByUser([
      ...namedProfiles.filter((profile) => profile.isViewer),
      ...foundBefore,
      ...namedProfiles.filter(isViewerOrInWorkbookTest(workbook)),
    ]).map((profile) => state.profilesById.get(profile.userId) ?? profile);
  };
  let waitsForSearch = !ask.isOfPeopleAlone && ask.searchedFor === '';
  let { scrollLeft, scrollTop } = state;
  let peopleList: PeopleListOpen = {
    cellId,
    searchedFor: ask.searchedFor,
    found: !isSearchNew
      ? listOfCell!.found
      : waitsForSearch
        ? null
        : {
            searchedFor: '',
            people: peopleToShow(),
          },
    offers: ask.isOfPeopleAlone ? [] : null,
    card: null,
    wentTo: null,
    scrollAsItOpened: {
      scrollLeft,
      scrollTop,
    },
    heldAsItOpened: profilesHeldByCell(state, workbook, cellId),
    isOfPeopleAlone: ask.isOfPeopleAlone,
    isAskedByTool: isAskedByTool || listOfCell?.isAskedByTool === true,
    chipGoneTo: null,
  };
  return {
    ...closeDropdownList(state),
    peopleList,
    calendar: null,
  };
}
export function isAtSignTypedAlone(mode: PageMode): boolean {
  if (mode.kind !== 'editing') return false;
  let text = cleanEnteredCellText(mode.text);
  return isMentionText(text) && mentionQueryOf(text) === '';
}
export function openPeopleListToAskPerson(state: PageState, workbook: ReadsWithTextMeasurer): PageState {
  if (state.mode.kind === 'editing' && !isAtSignTypedAlone(state.mode)) return state;
  let navigating = state.mode.kind === 'editing' ? leaveEntryEditing(state) : state;
  let listState = refreshPeopleList(navigating, workbook, true);
  return refreshPeopleList(startEntryEditing(listState, workbook, '', 'cell'), workbook);
}
export function notePeopleListScroll(state: PageState, workbook: WorkbookReads): PageState {
  let { peopleList, scrollLeft, scrollTop } = state;
  if (peopleList === null || peopleListRows(state, workbook) === null) return state;
  return {
    ...closeDropdownList(state),
    peopleList: {
      ...peopleList,
      scrollAsItOpened: {
        scrollLeft,
        scrollTop,
      },
    },
    calendar: null,
  };
}
export function closePeopleListOnCellClick(
  before: PageState,
  clicked: PageTransition,
  isSelectionExtended: boolean,
  workbook: WorkbookReads,
): PageTransition {
  if (!isPlainCellClick(clicked, isSelectionExtended)) return clicked;
  let { state } = clicked;
  let isOnSameCell = before.peopleList !== null && isSameCell(state.activeCell, before.activeCell);
  return withNoEffects(
    isOnSameCell
      ? {
          ...state,
          peopleList: null,
        }
      : refreshPeopleList(state, workbook),
  );
}
export function a1OfCellId(workbook: WorkbookReads, cellId: CellId): string | null {
  let position = workbook.positionOfCell(cellId);
  return position === null ? null : areaToA1AsStored(areaOfPosition(position), ownRowOrderOfSheet(workbook, cellId.sheetId));
}
export function peopleReplacedNews(name: string, workbook: WorkbookReads, cellId: CellId, leastCount: number = 2): PeopleInCellDone | null {
  let [count, a1] = [usersOfCell(workbook.cellOf(cellId)).length, a1OfCellId(workbook, cellId)];
  return count < leastCount || a1 === null
    ? null
    : {
        what: 'peopleReplaced',
        name,
        cell: a1,
        replacedCount: count,
        isSaved: false,
      };
}
export function takePeopleListRow(
  state: PageState,
  workbook: ReadsWithTextMeasurer,
  rowKey: string,
  cellAfter: CellId,
  foundBy: CellFoundBy,
  movesOn: boolean,
  hasWaitedForPeople: boolean = false,
): PageTransition {
  let row = peopleListRows(state, workbook)?.find((listed) => peopleListRowKey(listed) === rowKey);
  let closed: PageState = {
    ...state,
    peopleList: null,
  };
  let closedState: PageState = {
    ...closed,
    lastDone: null,
  };
  if (row === undefined) return withNoEffects(state);
  if (state.peopleList === null) return withNoEffects(closed);
  let { cellId: listCellId } = state.peopleList;
  if (row.kind === 'keepAsText') {
    let replaced = peopleReplacedNews(row.text, workbook, listCellId);
    return commitEntry(closedState, workbook, cellAfter, foundBy, replaced);
  }
  if (row.kind === 'offer') {
    let { offer } = row;
    if (offer.kind !== 'several') return takeInsertOffer(closed, workbook, offer, listCellId, cellAfter, foundBy, movesOn);
    let card = openCardAtRow(rowKey, offer.offers.map(subOfferCardRow), foundBy);
    return withNoEffects(card === null ? state : peopleListCard.withCard(state, card));
  }
  if (state.peopleList.isOfPeopleAlone) return addPersonToCell(state, workbook, row.profile, movesOn ? cellAfter : null, foundBy);
  if (row.isHeldByCell) return withNoEffects(moveActiveCellTo(leaveEntryEditing(closed), workbook, cellAfter, foundBy));
  let { userId, name } = row.profile;
  let a1 = a1OfCellId(workbook, listCellId);
  let added: PeopleInCellDone | null =
    hasWaitedForPeople && a1 !== null
      ? {
          what: 'personAdded',
          name,
          cell: a1,
          heldNowCount: 1,
        }
      : null;
  return queueEdit(
    closedState,
    enterEntryEdit(listCellId, {
      kind: 'user',
      userId,
      name,
    }),
    {
      ...IF_QUEUED_DEFAULTS,
      select: selectionAtCell(cellAfter),
      foundBy,
      done: peopleReplacedNews(name, workbook, listCellId, hasWaitedForPeople ? 1 : 2) ?? added,
    },
  );
}
export function addPersonToCell(
  state: PageState,
  workbook: WorkbookReads,
  { userId, name }: Pick<ProfileOfPerson, 'userId' | 'name'>,
  cellAfter: CellId | null,
  foundBy: CellFoundBy,
): PageTransition {
  if (state.peopleList === null) return withNoEffects(state);
  let { cellId: listCellId } = state.peopleList;
  let cell = workbook.cellOf(listCellId);
  let edit: Edit =
    cell === null
      ? enterEntryEdit(listCellId, {
          kind: 'user',
          userId,
          name,
        })
      : {
          kind: 'addUserToCell',
          sheetId: listCellId.sheetId,
          cell: cellRefOf(listCellId),
          userId,
          name,
        };
  let [heldCount, a1] = [usersOfCell(cell).length, a1OfCellId(workbook, listCellId)];
  let done: PeopleInCellDone | null =
    a1 === null
      ? null
      : cell !== null && heldCount === 0
        ? {
            what: 'contentsReplaced',
            name,
            cell: a1,
            isSaved: false,
          }
        : {
            what: 'personAdded',
            name,
            cell: a1,
            heldNowCount: heldCount + 1,
          };
  let stateWithoutDone: PageState = {
    ...state,
    lastDone: null,
  };
  if (cellAfter !== null)
    return queueEdit(
      {
        ...stateWithoutDone,
        peopleList: null,
      },
      edit,
      {
        ...IF_QUEUED_DEFAULTS,
        select: selectionAtCell(cellAfter),
        foundBy,
        done,
      },
    );
  let peopleList: PeopleListOpen = {
    ...state.peopleList,
    wentTo: null,
    chipGoneTo: null,
  };
  return queueEdit(
    {
      ...stateWithoutDone,
      peopleList,
    },
    edit,
    {
      ...IF_QUEUED_DEFAULTS,
      select: null,
      foundBy,
      done,
      thenPeopleList: 'staysOpen',
    },
  );
}
export function removePersonFromCell(state: PageState, workbook: WorkbookReads, userId: string | null, foundBy: CellFoundBy): PageTransition {
  if (state.peopleList === null || !state.peopleList.isOfPeopleAlone) return withNoEffects(state);
  let { cellId: listCellId } = state.peopleList;
  let users = usersOfCell(workbook.cellOf(listCellId));
  let chipGoneTo = chipGoneToInPeopleCell(state, workbook);
  let userToRemove = userId ?? chipGoneTo;
  let index = userToRemove === null ? users.length - 1 : users.findIndex((user) => user.userId === userToRemove);
  let removed = users[index];
  if (removed === undefined) return withNoEffects(state);
  let nextChip = userId === null && chipGoneTo !== null ? (users[index - 1] ?? users[index + 1]) : undefined;
  let [{ name }, a1] = [profileOfUser(state.profilesById, removed), a1OfCellId(workbook, listCellId)];
  let done: PeopleInCellDone | null =
    a1 === null
      ? null
      : {
          what: 'personRemoved',
          name,
          cell: a1,
          heldNowCount: users.length - 1,
          isSaved: false,
        };
  return queueEdit(
    {
      ...state,
      lastDone: null,
      peopleList: {
        ...state.peopleList,
        chipGoneTo: nextChip?.userId ?? null,
      },
    },
    {
      kind: 'removeUserFromCell',
      sheetId: listCellId.sheetId,
      cell: cellRefOf(listCellId),
      userId: removed.userId,
    },
    {
      ...IF_QUEUED_DEFAULTS,
      select: null,
      foundBy,
      done,
      thenPeopleList: 'staysOpen',
      leavesEntryOpen: state.mode.kind === 'editing',
    },
  );
}
export function pasteIntoPeopleCell(
  state: PageState,
  workbook: ReadsWithTextMeasurer,
  { copiedCellsAsText, text, pastedTextIs }: Pick<PasteChosen, 'copiedCellsAsText' | 'text' | 'pastedTextIs'>,
): PageState | null {
  if (state.mode.kind !== 'navigating' || peopleChipsOfListCell(state, workbook) === null) return null;
  let [firstText, ...otherTexts] = parseTsvCells(text)
    .flat()
    .map((cellText: string) => cellText.trim())
    .filter((cellText: string) => cellText !== '');
  if (copiedCellsAsText !== null || pastedTextIs !== 'asTyped' || otherTexts.length > 0) return null;
  if (firstText === undefined) return state;
  if (isFormulaText(firstText)) return null;
  return refreshPeopleList(startEntryEditing(state, workbook, normalizeLineBreaks(firstText), 'cell'), workbook);
}
export function chipGoneToInPeopleCell(state: PageState, workbook: WorkbookReads): string | null {
  let chipGoneTo = state.peopleList?.chipGoneTo ?? null;
  return peopleChipsOfListCell(state, workbook)?.some(({ userId }) => userId === chipGoneTo) === true ? chipGoneTo : null;
}
export function stepAmongPeopleChips(state: PageState, workbook: WorkbookReads, where: FieldStep): StepAmongPeopleChips {
  let chips = peopleChipsOfListCell(state, workbook) ?? [];
  let chipGoneTo = chipGoneToInPeopleCell(state, workbook);
  let index = chipGoneTo === null ? chips.length : chips.findIndex(({ userId }) => userId === chipGoneTo);
  if (where === 'after' && index === chips.length)
    return {
      columnDelta: 1,
    };
  if (where === 'before' && index === 0)
    return {
      columnDelta: -1,
    };
  let nextIndex = (
    {
      before: index - 1,
      after: index + 1,
      first: 0,
      caret: chips.length,
    } satisfies Record<FieldStep, number>
  )[where];
  return {
    chip: chips[nextIndex]?.userId ?? null,
  };
}
export function personInCellMatchingSearch(state: PageState, workbook: WorkbookReads): ProfileOfPerson | null {
  let rows = peopleListRows(state, workbook);
  if (state.peopleList === null || rows === null || !isNoOneFound(state.peopleList, rows)) return null;
  let searchedFor = state.peopleList.searchedFor;
  return peopleChipsOfListCell(state, workbook)?.find(({ name }) => isFoundByPeopleSearch(name, searchedFor)) ?? null;
}
export function peopleChipsOfListCell(state: PageState, workbook: WorkbookReads): ProfileOfPerson[] | null {
  return state.peopleList?.isOfPeopleAlone === true && peopleListRows(state, workbook) !== null
    ? profilesHeldByCell(state, workbook, state.peopleList.cellId)
    : null;
}
export function settlePeopleList(before: PageState, state: PageState, workbook: ReadsWithTextMeasurer): PageState {
  let { peopleList } = state;
  if (peopleList === null) return state;
  let isSameListCell = before.peopleList !== null && isSameCell(before.peopleList.cellId, peopleList.cellId);
  if (
    isSameCell(peopleList.cellId, activeAnchorCell(state, workbook)) &&
    (!isSameListCell || state.mode.kind === 'editing' || isSameSelection(before, state)) &&
    (state.mode.kind === 'editing' || peopleList.searchedFor === '') &&
    (isTypingInFormulaBar(state) || !isDropdownListOutOfPlace(state, workbook, peopleList.scrollAsItOpened)) &&
    state.menu === null &&
    state.dragging?.kind !== 'resizing' &&
    peopleListAskOf(state, workbook) !== null
  ) {
    let dropsCard = peopleListCard.isCardOfPointerAlone(state) && before.peopleList?.wentTo !== peopleList.wentTo;
    return dropUndrawableCard(peopleListCard, dropsCard ? peopleListCard.withCard(state, null) : state, workbook);
  }
  return peopleList.isOfPeopleAlone && state.mode.kind === 'editing' && isSameCell(peopleList.cellId, activeAnchorCell(state, workbook))
    ? leaveEntryEditing({
        ...state,
        peopleList: null,
      })
    : {
        ...state,
        peopleList: null,
      };
}
export function peopleListEffects(before: PageState, { state, effects }: PageTransition, workbook: WorkbookReads): PageTransition {
  let { peopleList } = state;
  let isSameSearch =
    before.peopleList !== null &&
    peopleList !== null &&
    before.peopleList.searchedFor === peopleList.searchedFor &&
    before.peopleList.isOfPeopleAlone === peopleList.isOfPeopleAlone &&
    isSameCell(before.peopleList.cellId, peopleList.cellId);
  let askEffects: PageEffect[] = [
    ...(peopleList === null || peopleList.offers !== null
      ? []
      : [
          {
            kind: 'readOffersUnderAt',
          } satisfies PageEffect,
        ]),
    ...(peopleList === null || isSameSearch
      ? []
      : [
          {
            kind: 'findPeople',
            searchedFor: peopleList.searchedFor,
          } satisfies PageEffect,
        ]),
  ];
  if (state.peopleLookedUpAtChangeCount === state.workbookChangeCount)
    return {
      state,
      effects: [...effects, ...askEffects],
    };
  let userIds = workbook.userIds();
  return {
    state: {
      ...state,
      peopleLookedUpAtChangeCount: state.workbookChangeCount,
    },
    effects: [
      ...effects,
      ...askEffects,
      ...(userIds.length === 0
        ? []
        : [
            {
              kind: 'lookUpPeople',
              userIds,
            } satisfies PageEffect,
          ]),
    ],
  };
}
export const PEOPLE_LIST_GROUP_ORDER: PeopleListGroup[] = ['agent', 'people', 'dates', 'dropdowns', 'controls'];
export const insertOfferKey = (offer: AtMenuOffer): string =>
  offer.kind === 'day' ? offer.day : offer.kind === 'dropdownOfSet' ? offer.set.key : offer.kind;
export const foldForPeopleSearch = (text: string): string => text.toLowerCase().replaceAll('’', "'");
/** The agent's name as the host gives it (read when asked: it may change after this module loads). */
export const askAgentOfferLabel = (): string => AGENT_NAME;
export const insertOfferLabelMatches = (offer: AtMenuOffer, searchedFor: string): boolean =>
  isFoundByPeopleSearch(offer.kind === 'askAgent' ? askAgentOfferLabel() : offer.label, searchedFor);
export const insertOfferMatches = (offer: AtMenuOffer, searchedFor: string): boolean =>
  insertOfferLabelMatches(offer, searchedFor) || (offer.kind === 'dropdownOfSet' && isFoundByPeopleSearch(offer.alsoFoundBy, searchedFor));
export const insertOffersMatching = (offers: readonly AtMenuOffer[], searchedFor: string): AtMenuOffer[] =>
  searchedFor === ''
    ? [...offers]
    : offers.flatMap((offer): AtMenuOffer[] => {
        if (offer.kind === 'several') return insertOffersMatching(offer.offers, searchedFor);
        return insertOfferMatches(offer, searchedFor) ? [offer] : [];
      });
export const stateSelectingOnlyCell = (state: PageState, workbook: ReadsWithTextMeasurer, cellId: CellId): PageState =>
  settleSelectionSeen(
    null,
    {
      ...withoutOtherRanges(clearPassingNotice(state)),
      mode: NAVIGATING_MODE,
      ...selectionAtCell(cellId),
    },
    workbook,
  );
export const isPeopleSearchUnderWay = ({ searchedFor, found }: Pick<PeopleListOpen, 'searchedFor' | 'found'>): boolean => found?.searchedFor !== searchedFor;
export const personMatchesPeopleSearch = (searchedFor: string, { name }: Pick<ProfileOfPerson, 'name'>): boolean =>
  searchedFor !== '' && isFoundByPeopleSearch(name, searchedFor);
export const peopleFoundSoFar = (peopleList: Pick<PeopleListOpen, 'searchedFor' | 'found'>): ProfileOfPerson[] =>
  isPeopleSearchUnderWay(peopleList)
    ? (peopleList.found?.people ?? []).filter((profile) => personMatchesPeopleSearch(peopleList.searchedFor, profile))
    : (peopleList.found?.people ?? []);
export const groupOfPeopleListRow = (row: PeopleListRow): PeopleListGroup | null =>
  row.kind === 'person' ? 'people' : row.kind === 'offer' ? groupOfInsertOffer(row.offer) : null;
export const peopleListRowKey = (row: PeopleListRow): string =>
  row.kind === 'person' ? `person-${row.profile.userId}` : row.kind === 'offer' ? `offer-${insertOfferKey(row.offer)}` : row.kind;
export const offerRowOf = (offer: AtMenuOffer): OfferRow => ({
  kind: 'offer',
  offer,
});
export const hasProfileOfUser = (profiles: readonly ProfileOfPerson[], { userId }: Pick<ProfileOfPerson, 'userId'>): boolean =>
  profiles.some((profile) => profile.userId === userId);
export const isViewerOrInWorkbookTest = (workbook: WorkbookReads) => {
  let userIds = new Set(workbook.userIds());
  return ({ isViewer, userId }: Pick<ProfileOfPerson, 'isViewer' | 'userId'>): boolean => isViewer || userIds.has(userId);
};
export const MAX_PEOPLE_BESIDE_OFFERS = 4;
export const MAX_PEOPLE_IN_PEOPLE_LIST = 8;
export const subOffersOfRow = (rows: readonly PeopleListRow[], rowKey: string): AtMenuOffer[] => {
  let row = rows.find((listed) => peopleListRowKey(listed) === rowKey);
  return row?.kind === 'offer' && row.offer.kind === 'several' ? row.offer.offers : [];
};
export const optionMarksOfOffer = (offer: AtMenuOffer): ListCardSwatch[] =>
  offer.kind === 'dropdownOfSet'
    ? offer.set.options.map(
        ({ label, color }) => ({
          key: label,
          color,
        }),
      )
    : [];
export const subOfferCardRow = (offer: AtMenuOffer): ListCardRow => ({
  key: peopleListRowKey(offerRowOf(offer)),
  label: offer.label,
  marks: optionMarksOfOffer(offer),
  isChosen: false,
});
export const drawnPeopleListCard = (peopleList: Pick<PeopleListOpen, 'card'>, rows: readonly PeopleListRow[]): ListCardDrawn | null =>
  listCardOfRow(peopleList.card, rows.map(peopleListRowKey), (rowKey: string) => subOffersOfRow(rows, rowKey).map(subOfferCardRow));
export const WENT_UNDER_AGENT = 'underAgent';
export const peopleSearchStage = (peopleList: Pick<PeopleListOpen, 'searchedFor' | 'found'>): PeopleSearchStage => {
  if (peopleList.searchedFor === '') return 'none';
  return isPeopleSearchUnderWay(peopleList) ? 'underWay' : 'over';
};
export const isPeopleSearchLongEnough = (searchedFor: string): boolean => Array.from(searchedFor.trim()).length >= 3;
export const isNoOneFound = (
  peopleList: Pick<PeopleListOpen, 'searchedFor' | 'found' | 'isOfPeopleAlone'>,
  rows: readonly PeopleListRow[],
): boolean =>
  peopleList.searchedFor !== '' &&
  !isPeopleSearchUnderWay(peopleList) &&
  !rows.some((row) => row.kind === 'person') &&
  (peopleList.isOfPeopleAlone || (peopleList.found?.people.length === 0 && isPeopleSearchLongEnough(peopleList.searchedFor)));
export const isPeopleCell = (workbook: WorkbookReads, cellId: CellId): boolean =>
  usersOfCell(workbook.cellOf(cellId)).length > 0 &&
  dropdownAtCell(workbook, cellId) === null &&
  !doesCellTakeCalendar(workbook, cellId) &&
  !isTimeCell(workbook, cellId);
export const profilesHeldByCell = ({ profilesById }: Pick<PageState, 'profilesById'>, workbook: WorkbookReads, cellId: CellId): ProfileOfPerson[] =>
  usersOfCell(workbook.cellOf(cellId)).map((user) => profileOfUser(profilesById, user));
export const isPeopleCellEditedWithoutList = (state: PageState, workbook: WorkbookReads): boolean =>
  state.peopleList === null && state.mode.kind === 'editing' && usersOfCell(workbook.cellOf(activeAnchorCell(state, workbook))).length > 0;
export const isAskAgentRowBusy = (rowKey: string, state: PageState, context: PageContext): boolean =>
  rowKey ===
    peopleListRowKey(
      offerRowOf({
        kind: 'askAgent',
        label: '',
      }),
    ) &&
  !canTellAgentSelection(state, context) &&
  (context.wasEventHeld || state.entriesUnanswered.length > 0 || (state.saving !== 'saving' && state.saving !== 'allSaved'));
export const askPersonActions = (mode: PageMode): PageEvent[] =>
  isAtSignTypedAlone(mode)
    ? [
        {
          kind: 'personAsked',
        },
      ]
    : [
        {
          kind: 'entryLeft',
        },
        {
          kind: 'personAsked',
        },
      ];
export const withPeopleChipGoneTo = (state: PageState, chipGoneTo: string | null): PageState =>
  state.peopleList === null
    ? state
    : {
        ...state,
        peopleList: {
          ...state.peopleList,
          chipGoneTo,
          wentTo: null,
        },
      };
export const isEntryAmongPeople = (state: PageState, workbook: WorkbookReads): boolean =>
  isPeopleCell(workbook, activeAnchorCell(state, workbook)) || peopleChipsOfListCell(state, workbook) !== null;
export const isEntryInChipCell = (state: PageState, workbook: WorkbookReads): boolean =>
  isEntryAmongPeople(state, workbook) || dropdownAtCell(workbook, activeAnchorCell(state, workbook)) !== null;
export const caretInEntryOutsideChips = <Caret>(state: PageState, workbook: WorkbookReads, caretInEntry: Caret): Caret | undefined =>
  isEntryInChipCell(state, workbook) ? undefined : caretInEntry;
export const keepPeopleListOpen = (state: PageState, workbook: WorkbookReads): PageState =>
  state.peopleList === null || state.peopleList.searchedFor === '' ? state : refreshPeopleList(state, workbook);
export const peopleListCard = {
  card: (state: PageState): CardOfList | null => state.peopleList?.card ?? null,
  isCardOfPointerAlone: (state: PageState): boolean => state.peopleList?.card?.wentTo === null,
  doKeysGoRound: (): boolean => true,
  withCard: (state: PageState, card: CardOfList | null): PageState =>
    state.peopleList === null
      ? state
      : {
          ...state,
          peopleList: {
            ...state.peopleList,
            card,
            wentTo: card === null || card.wentTo === null ? state.peopleList.wentTo : card.ofRow,
          },
        },
  rowsAt: (state: PageState, workbook: WorkbookReads, rowKey: string): ListCardRow[] =>
    subOffersOfRow(peopleListRows(state, workbook) ?? [], rowKey).map(subOfferCardRow),
  drawn(state: PageState, workbook: WorkbookReads): ListCardDrawn | null {
    let rows = peopleListRows(state, workbook);
    return state.peopleList === null || rows === null ? null : drawnPeopleListCard(state.peopleList, rows);
  },
  take(state: PageState, workbook: ReadsWithTextMeasurer, key: string, cellAfter: CellId, foundBy: CellFoundBy, movesOn: boolean): PageTransition {
    let { peopleList } = state;
    let rows = peopleListRows(state, workbook);
    if (peopleList === null || peopleList.card === null || rows === null) return withNoEffects(state);
    let offer = subOffersOfRow(rows, peopleList.card.ofRow).find((subOffer) => subOfferCardRow(subOffer).key === key);
    if (offer === undefined || offer.kind === 'several') return withNoEffects(state);
    let closedState: PageState = {
      ...state,
      peopleList: null,
    };
    return takeInsertOffer(closedState, workbook, offer, peopleList.cellId, cellAfter, foundBy, movesOn);
  },
};
export const withProfilesLearned = (state: PageState, profiles: readonly ProfileOfPerson[]): PageState => {
  let profilesById = profilesWithChanges(state.profilesById, profiles);
  return profilesById === state.profilesById
    ? state
    : {
        ...state,
        profilesById,
      };
};
export const isTypingInFormulaBar = ({ mode }: Pick<PageState, 'mode'>): boolean => mode.kind === 'editing' && mode.typingIn === 'formulaBar';
