import { AgentMark } from '../kit/agent-mark.tsx';
import { Avatar } from '../kit/avatar.tsx';
import { PERSON_AVATAR_LOOK } from './person-avatar-look.ts';
import { Icon } from '../kit/icon.tsx';
import * as React from 'react';
import {
  withListCardIds,
  ListRowLead,
  ListRowLabel,
  ListRowCaret,
  ListRowSwatches,
  ListRowQuietText,
  OptionsListCard,
  ListRow,
  ListHeading,
  ListGroup,
  ListSeparator,
  useLastNonNull,
  useListCardHover,
  ListUnderCell,
} from '../ui/list-under-cell.tsx';
import {
  personAlreadyInCellText,
  keepAsTextLabel,
  opensMoreRowsLabel,
  atMenuSectionTitle,
  peopleForCellLabel,
  insertInCellLabel,
} from '../i18n/menu-labels.ts';
import { peoplePickerMessages, personRowLabel } from '../i18n/chip-labels.ts';
import {
  isPeopleSearchLongEnough,
  optionMarksOfOffer,
  peopleListRowKey,
  groupOfInsertOffer,
  groupOfPeopleListRow,
  PEOPLE_LIST_GROUP_ORDER,
} from './people-list.ts';
import { ASK_AGENT_ICON_SIZE } from '../agent/ask-agent-menu.tsx';
import type { PeopleListView } from '../view/page-view.ts';
import type { PeopleListRow, ProfileOfPerson } from './people-list.ts';
/** What a list under a cell is placed against: anything that tells where it is on the page. */
export interface AnchorOnPage {
  getBoundingClientRect(): DOMRect;
}
/** The ids a combobox points to: of its list, and of the row highlighted in it. */
export interface ListboxIds {
  id: string;
  highlightedRowId: string | null;
}
/** What the list of people tells of a person besides the name: that it is the viewer, or a guest. */
export type PersonTag = 'you' | 'guest';
export interface PeopleListRowContentProps {
  row: PeopleListRow;
  isCardBeside?: boolean;
}
/** What the rows of the list of people do when chosen, pointed at, or scrolled. */
export interface PeopleListRowActs {
  onRowChosen: (rowKey: string) => void;
  onRowPointedAt: (rowKey: string) => void;
  onCardRowPointedAt: () => void;
  onPointerInOrOut: (isIn: boolean) => void;
}
/** What the sections of the list of people are drawn from. */
export interface PeopleListSectionsOf
  extends Pick<
      PeopleListView,
      'rows' | 'highlightedRow' | 'card' | 'search' | 'isNothingFound' | 'foundInField' | 'isOfPeopleAlone' | 'searchedFor'
    >,
    PeopleListRowActs {
  anchor: AnchorOnPage;
  isCardBeside: boolean;
  onOpenerLeft: () => void;
  onCardRowChosen: (rowKey: string) => void;
}
export interface PeopleListProps {
  list: PeopleListView | null;
  cellAnchor: AnchorOnPage;
  formulaBarAnchor: AnchorOnPage;
  cellElementId: string | null;
  isCardBeside: boolean;
  onRoomBesideMeasured: (hasRoomBeside: boolean) => void;
  onRowChosen: (rowKey: string) => void;
  onCardAsked: (ofRow: string) => void;
  onCardRowChosen: (rowKey: string) => void;
  onCardShut: () => void;
  onShut: (event: Event) => void;
}
export function peopleListCardIds({ rows, highlightedRow, card }: Pick<PeopleListView, 'rows' | 'highlightedRow' | 'card'>): ListboxIds {
  let row = rows[highlightedRow];
  let highlightedRowId = row === undefined ? null : peopleListRowElementId(row);
  return withListCardIds(
    {
      id: PEOPLE_LIST_ID,
      highlightedRowId,
    },
    card,
  );
}
export function peopleListNote({
  isNothingFound,
  foundInField,
  isOfPeopleAlone,
  searchedFor,
}: Pick<PeopleListView, 'isNothingFound' | 'foundInField' | 'isOfPeopleAlone' | 'searchedFor'>): string | null {
  if (foundInField !== null) return personAlreadyInCellText(foundInField.name);
  if (!isNothingFound) return null;
  if (!isOfPeopleAlone) return peoplePickerMessages.noMatches();
  return isPeopleSearchLongEnough(searchedFor) ? peoplePickerMessages.noMatchingPeople() : peoplePickerMessages.keepTyping();
}
export function peopleListRowWords(row: PeopleListRow) {
  switch (row.kind) {
    case 'keepAsText':
      return keepAsTextLabel(row.text);
    case 'offer':
      return row.offer.kind === 'several' ? opensMoreRowsLabel(row.offer.spokenLabel) : row.offer.label;
    case 'person':
      return personRowLabel(row.profile.name, personTagOf(row.profile), row.isHeldByCell);
  }
}
export function PeopleListRowContent({ row, isCardBeside = true }: PeopleListRowContentProps) {
  if (row.kind === 'keepAsText')
    return <><ListRowLead icon="PlainText" isQuiet /><ListRowLabel>{keepAsTextLabel(row.text)}</ListRowLabel></>;
  if (row.kind === 'offer' && row.offer.kind === 'several')
    return <><span aria-hidden className="flex min-w-0 flex-1 text-secondary"><ListRowLabel>{row.offer.label}</ListRowLabel></span><span className="sr-only">{opensMoreRowsLabel(row.offer.spokenLabel)}</span><ListRowCaret isCardBeside={isCardBeside} /></>;
  if (row.kind === 'offer' && row.offer.kind === 'askAgent')
    return <><ListRowLead icon={<AgentMark size={ASK_AGENT_ICON_SIZE} />} /><ListRowLabel>{row.offer.label}</ListRowLabel></>;
  if (row.kind === 'offer') {
    let { kind: offerKind } = row.offer;
    return <><ListRowLead icon={offerKind === 'calendar' || offerKind === 'day' ? 'Calendar' : offerKind === 'checkbox' ? 'CheckSquare' : 'Dropdown'} isQuiet /><ListRowLabel>{row.offer.label}</ListRowLabel>{row.offer.kind === 'dropdownOfSet' &&
          <ListRowSwatches marks={optionMarksOfOffer(row.offer)} />}</>;
  }
  let { name: personName, avatarUrl } = row.profile;
  let personTag = personTagOf(row.profile);
  return <><ListRowLead icon={<Avatar {...PERSON_AVATAR_LOOK} name={personName} src={avatarUrl} size="xs" aria-hidden />} /><span aria-hidden className="flex min-w-0 flex-1 items-center gap-xs"><ListRowLabel>{personName}</ListRowLabel>{personTag !== null &&
            <ListRowQuietText>{peoplePickerMessages[personTag]()}</ListRowQuietText>}{row.isHeldByCell &&
            <Icon name="Check" size="sm" className="text-accent" />}</span><span className="sr-only">{personRowLabel(personName, personTag, row.isHeldByCell)}</span></>;
}
export function peopleListSections({
  rows,
  highlightedRow,
  card,
  search,
  isNothingFound,
  foundInField,
  isOfPeopleAlone,
  searchedFor,
  anchor,
  isCardBeside,
  onRowChosen,
  onRowPointedAt,
  onOpenerLeft,
  onCardRowChosen,
  onCardRowPointedAt,
  onPointerInOrOut,
}: PeopleListSectionsOf) {
  let cardOfRow = (row: PeopleListRow) =>
    card !== null &&
    card.ofRow === peopleListRowKey(row) &&
    row.kind === 'offer' &&
    (<OptionsListCard key={card.ofRow} listId={PEOPLE_LIST_ID} card={card} label={atMenuSectionTitle(groupOfInsertOffer(row.offer)) ?? row.offer.label} rowId={peopleListRowElementId(row)} cell={anchor} isBeside={isCardBeside} lead={DROPDOWN_ROW_LEAD} onRowChosen={onCardRowChosen} onRowPointedAt={onCardRowPointedAt} onPointerInOrOut={onPointerInOrOut} />);
  let rowElements = rows.map(
    (row, rowIndex) => ({
      section: groupOfPeopleListRow(row),
      element: <ListRow key={peopleListRowKey(row)} id={peopleListRowElementId(row)} placeInList={rowIndex + 1} rowsInList={rows.length} isHighlighted={rowIndex === highlightedRow && (card === null || card.highlightedRow === null)} hasCardOpen={card?.ofRow === peopleListRowKey(row)} onChosen={() => onRowChosen(peopleListRowKey(row))} isOnlyTintedByPointer tellsOfEveryMove onPointedAt={() => onRowPointedAt(peopleListRowKey(row))} {...(row.kind === 'offer' &&
            row.offer.kind === 'several' && {
              onPointerLeave: onOpenerLeft,
            })}><PeopleListRowContent row={row} isCardBeside={isCardBeside} /></ListRow>,
    }),
  );
  let note = peopleListNote({
    isNothingFound,
    foundInField,
    isOfPeopleAlone,
    searchedFor,
  });
  return {
    cardOfRow: rows.map(cardOfRow),
    sections: <>{note !== null &&
          <ListHeading>{note}</ListHeading>}{PEOPLE_LIST_GROUP_ORDER.map((section) => {
          let sectionRows = rowElements.filter((rowElement) => rowElement.section === section);
          return sectionRows.length === 0
            ? null
            : <ListGroup key={section} headingId={`${PEOPLE_LIST_ID}-heading-${section}`} heading={isOfPeopleAlone ? null : atMenuSectionTitle(section)}>{sectionRows.map(({ element }) => element)}</ListGroup>;
        })}</>,
    foot: <>{search === 'underWay' &&
          <ListHeading>{peoplePickerMessages.searching()}</ListHeading>}{rowElements.some(({ section }) => section === null) &&
          (isNothingFound || search === 'underWay' || rowElements.some(({ section }) => section !== null)) &&
          <ListSeparator />}{rowElements.filter(({ section }) => section === null).map(({ element }) => element)}</>,
  };
}
export function peopleListMostHeight(rows: readonly PeopleListRow[]): string | undefined {
  let sections = rows.map(groupOfPeopleListRow).filter((section) => section !== null);
  let dropdownSections = sections.filter((section) => PEOPLE_LIST_GROUP_ORDER.indexOf(section) <= DROPDOWNS_GROUP_INDEX);
  if (sections.length - dropdownSections.length <= 1) return;
  let headingsHeight =
    new Set(dropdownSections.filter((section) => atMenuSectionTitle(section) !== null)).size *
      GROUP_HEADING_HEIGHT_PX +
    PEOPLE_LIST_EXTRA_HEIGHT_PX;
  return `calc(${String(dropdownSections.length)} * var(--ui-h-control) + ${String(headingsHeight)}px)`;
}
export function peopleListRowHandlers(
  { rows, card, isCardOfPointerAlone }: Pick<PeopleListView, 'rows' | 'card' | 'isCardOfPointerAlone'>,
  isPointerFine: boolean,
  cardPlace: ReturnType<typeof useListCardHover>,
  handlers: Pick<PeopleListProps, 'onRowChosen' | 'onCardShut'>,
) {
  return {
    onRowChosen(rowKey: string) {
      cardPlace.overCard();
      if (!isPointerFine && card?.ofRow === rowKey) handlers.onCardShut();
      else handlers.onRowChosen(rowKey);
    },
    onRowPointedAt(rowKey: string) {
      if (!isPointerFine) return;
      let row = rows.find((listedRow) => peopleListRowKey(listedRow) === rowKey);
      if (row?.kind === 'offer' && row.offer.kind === 'several') cardPlace.overOpener(rowKey);
      else cardPlace.overOtherRow();
    },
    onCardRowPointedAt: cardPlace.overCard,
    onRowsScrolled(rowsElement: Element) {
      if (card === null) return;
      if (!isCardOfPointerAlone) return cardPlace.rowsScrolled(rowsElement.ownerDocument.getElementById(peopleListElementId(card.ofRow)));
      cardPlace.overCard();
      return handlers.onCardShut();
    },
    onPointerInOrOut(isIn: boolean) {
      if (isIn) cardPlace.overCard();
      else if (isCardOfPointerAlone) cardPlace.overOtherRow();
    },
  };
}
export const PEOPLE_LIST_ID = 'people-list';
export const peopleListElementId = (rowKey: string): string => `${PEOPLE_LIST_ID}-${rowKey}`;
export const peopleListRowElementId = (row: PeopleListRow): string => peopleListElementId(peopleListRowKey(row));
export const EMPTY_PEOPLE_LIST: PeopleListView = {
  cell: '',
  under: 'cell',
  rows: [],
  highlightedRow: 0,
  card: null,
  isCardOfPointerAlone: false,
  isNothingFound: false,
  search: 'none',
  searchedFor: '',
  isOfPeopleAlone: false,
  inField: null,
  chipGoneTo: null,
  foundInField: null,
};
export const personTagOf = ({ isViewer, isGuest }: Pick<ProfileOfPerson, 'isViewer' | 'isGuest'>): PersonTag | null => (isViewer ? 'you' : isGuest ? 'guest' : null);
export const isPeopleListShown = ({ inField, rows, isNothingFound, search }: Pick<PeopleListView, 'inField' | 'rows' | 'isNothingFound' | 'search'>): boolean =>
  inField === null || rows.length > 0 || isNothingFound || search === 'underWay';
export const peopleListLabel = ({ isOfPeopleAlone, cell }: Pick<PeopleListView, 'isOfPeopleAlone' | 'cell'>): string =>
  isOfPeopleAlone ? peopleForCellLabel(cell) : insertInCellLabel(cell);
export const DROPDOWN_ROW_LEAD = <ListRowLead icon="Dropdown" isQuiet />;
export const DROPDOWNS_GROUP_INDEX = PEOPLE_LIST_GROUP_ORDER.indexOf('dropdowns');
export const GROUP_HEADING_HEIGHT_PX = 25;
export const PEOPLE_LIST_EXTRA_HEIGHT_PX = 28;
export const PeopleList = React.memo(function ({
  list,
  cellAnchor,
  formulaBarAnchor,
  cellElementId,
  isCardBeside,
  onRoomBesideMeasured,
  onRowChosen,
  onCardAsked,
  onCardRowChosen,
  onCardShut,
  onShut,
}: PeopleListProps) {
  let listShown: PeopleListView = useLastNonNull(list) ?? EMPTY_PEOPLE_LIST;
  let rowsListed = list?.rows.map((row) => (row.kind === 'keepAsText' ? row.text : peopleListRowKey(row))).join() ?? null;
  let cardPlace = useListCardHover({
    rowsListed,
    isOpen: list !== null && list.card !== null,
    onAsked: onCardAsked,
    onShut: onCardShut,
  });
  let { onRowsScrolled, ...rowHandlers } = peopleListRowHandlers(listShown, isCardBeside, cardPlace, {
    onRowChosen,
    onCardShut,
  });
  let anchor = listShown.under === 'cell' ? cellAnchor : formulaBarAnchor;
  let {
    sections,
    foot,
    cardOfRow,
  } = peopleListSections({
    ...listShown,
    anchor,
    isCardBeside,
    ...rowHandlers,
    onOpenerLeft: cardPlace.offOpener,
    onCardRowChosen,
  });
  let listUnderCell = <ListUnderCell id={PEOPLE_LIST_ID} isOpen={list !== null && isPeopleListShown(list)} hasRows={listShown.rows.length > 0} anchor={anchor} cellElementId={cellElementId} label={peopleListLabel(listShown)} className={(listShown.inField === null ? 'w-[280px]' : 'w-[var(--anchor-width)] max-w-none min-w-[280px]') +
      (listShown.searchedFor === '' ? '' : ' max-h-[min(450px,var(--available-height))]')} isMovedOnlyAsFarAsNeeded={listShown.inField !== null} onShut={onShut} foot={foot} mostHeightOfRows={listShown.searchedFor === '' ? peopleListMostHeight(listShown.rows) : undefined} onRowsScrolled={onRowsScrolled} onRoomBesideMeasured={onRoomBesideMeasured} onPointerInOrOut={rowHandlers.onPointerInOrOut}>{sections}</ListUnderCell>;
  return <>{listUnderCell}{list !== null && cardOfRow}</>;
});
