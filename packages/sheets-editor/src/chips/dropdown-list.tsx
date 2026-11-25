import { useUiWindow } from '../kit/theme.tsx';
import { Icon } from '../kit/icon.tsx';
import * as React from 'react';
import { cleanOptionLabel, labelsOfPastedText } from './dropdown-pane-edits.ts';
import {
  withListCardIds,
  ListRowTooltip,
  ListRowLead,
  ListRowLabel,
  ListRowCaret,
  ListRow,
  ListSeparator,
  useLastNonNull,
  useListCardHover,
  ListUnderCell,
  PlainListBox,
  OptionsListCard,
  listRowIdOf,
} from '../ui/list-under-cell.tsx';
import { CellChip } from '../grid/cell-drawing.tsx';
import { cachedOptionChipColors } from '../format/cell-colors.ts';
import { dropdownPaneMessages } from '../i18n/format-labels.ts';
import { optionListForCellLabel, addOptionText, optionAlreadyExistsText, dropdownOptionsForCellLabel } from '../i18n/chip-labels.ts';
import { optionRightArrowToEditLabel, optionPlaceInListLabel, opensMoreRowsLabel, editCardHeadingLabel } from '../i18n/menu-labels.ts';
import { optionIdOfMenuKey, menuItemKey, MAX_DROPDOWN_OPTIONS, optionMenuKey } from './dropdown-options.ts';
import { IS_IOS_BROWSER } from '../grid/cell-drawing-values.ts';
import { isOptionLabelTaken } from './dropdowns.ts';
import { isCopiedFromSheets } from '../clipboard/formats.ts';
import { fieldInListAfterListChange, FieldInList } from '../ui/field-in-list.tsx';
import { useReorderRows, isDropAPressOnRow } from '../ui/reorder-rows.ts';
import { colorForAddedOption } from './dropdown-colors.ts';
import type { DropdownMenuItem } from './dropdown-options.ts';
import type { OptionMovedInDropdown, OptionsNamedInDropdown } from './dropdowns.ts';
import type { AnchorOnPage, ListboxIds } from './people-list-view.tsx';
import type { DropdownListView } from '../view/page-view.ts';
import type { CellId } from '../model/workbook.ts';
/** The list of a dropdown as drawn: the one open, or an empty one while the list shuts. */
export interface DropdownListShown extends Omit<DropdownListView, 'ofCell'> {
  ofCell: CellId | null;
}
/** Some rows of a dropdown's list, and which of them is highlighted. */
export interface DropdownRowsInList {
  rows: DropdownMenuItem[];
  highlightedRow: number | null;
}
/** The props a row of the list takes while its options are being reordered. */
export interface ReorderedRowProps {
  className: string;
  'data-reorder'?: string;
  style?: React.CSSProperties;
}
/** How the rows of options are pressed and drawn while they can be reordered. */
export interface RowPressesInList {
  ofRow: (optionId: string, index: number) => ReorderedRowProps;
  pressOnRowItself: (event: React.PointerEvent<HTMLDivElement>, optionId: string, index: number) => void;
}
/** A row of options let go after being held: whether it was dropped or the drag was called off, and where. */
export interface OptionRowLetGo {
  key: string;
  how: 'dropped' | 'canceled';
  hasLeftItsPlace: boolean;
  isLetGoOverRow: boolean;
}
/** The field of an option that has the caret, and what is typed in it but not yet entered. */
export interface OptionFieldInFocus {
  ofOption: string | null;
  typed: string | null;
  field: HTMLInputElement;
}
export interface DropdownListRowContentProps {
  row: DropdownMenuItem;
  isCardBeside: boolean;
  hasCard: boolean;
}
export interface OptionCardOpenerProps {
  isOpen: boolean;
  onPressed: () => void;
}
export interface DropdownListUnderCellProps {
  list: DropdownListView | null;
  anchor: AnchorOnPage;
  cellElementId: string | null;
  isCardBeside: boolean;
  onRoomBesideMeasured: (hasRoomBeside: boolean) => void;
  onRowChosen: (rowKey: string) => void;
  onCardAsked: (ofRow: string) => void;
  onCardOfOptionAsked: (optionId: string) => void;
  onOptionsNamed: (naming: OptionsNamedInDropdown, onDone: (listAfter: DropdownListView | null) => void) => void;
  onNewOptionNoLongerNamed: () => void;
  onOptionMoved: (move: OptionMovedInDropdown, onDone: (isDone: boolean) => void) => void;
  onCaretGivenBack: () => void;
  onCardRowChosen: (rowKey: string) => void;
  onCardShut: () => void;
  onShut: (event: Event) => void;
}
/** What the rows of a dropdown's list do when chosen, pointed at, or left. */
export interface DropdownListRowActs {
  onRowChosen: (rowKey: string) => void;
  onCardOfOptionAsked: (optionId: string) => void;
  onRowPointedAt: (rowKey: string) => void;
  onOpenerLeft: () => void;
}
export interface DropdownListRowsProps
  extends DropdownRowsInList,
    Pick<DropdownListShown, 'card' | 'haveOptionsCards'>,
    DropdownListRowActs {
  isCardBeside: boolean;
  reorder?: RowPressesInList;
  arePlacesInNames?: boolean;
}
export function splitDropdownListRows({
  rows,
  highlightedRow,
}: DropdownRowsInList): [DropdownRowsInList, DropdownRowsInList | null] {
  let highlighted = rows[highlightedRow ?? -1];
  let rowsOfKind = (isOther: boolean): DropdownRowsInList => {
    let kindRows = rows.filter(({ kind }) => (kind !== 'option' && kind !== 'add') === isOther);
    let highlightedAt = highlighted === undefined ? -1 : kindRows.indexOf(highlighted);
    return {
      rows: kindRows,
      highlightedRow: highlightedAt === -1 ? null : highlightedAt,
    };
  };
  let [optionRows, otherRows] = [rowsOfKind(false), rowsOfKind(true)];
  return optionRows.rows.length === 0 ? [otherRows, null] : [optionRows, otherRows];
}
export function areOptionsNamedInList(
  list: DropdownListView | null,
  { dropdownId, optionId, labels }: Pick<OptionsNamedInDropdown, 'dropdownId' | 'optionId' | 'labels'>,
): boolean {
  if (labels.length > 1 || list?.dropdownId !== dropdownId) return true;
  let label = cleanOptionLabel(labels[0] ?? '').trim();
  return list.rows.some((row) => row.kind === 'option' && row.label === label && (optionId === null || row.optionId === optionId));
}
export function dropdownListIds(list: DropdownListView): ListboxIds {
  let highlighted = list.rows[list.highlightedRow ?? -1];
  let highlightedRowId = highlighted === undefined ? null : dropdownListRowId(highlighted);
  let listIds: ListboxIds = withListCardIds(
    {
      id: DROPDOWN_LIST_ID,
      highlightedRowId,
    },
    list.card,
  );
  return splitDropdownListRows(list)[1] === null
    ? listIds
    : {
        ...listIds,
        id: `${listIds.id} ${DROPDOWN_LIST_OTHERS_ID}`,
      };
}
export function DropdownListRowContent({ row, isCardBeside, hasCard }: DropdownListRowContentProps) {
  switch (row.kind) {
    case 'option':
      return <><span className="flex min-w-0 flex-1"><CellChip optionPaints={cachedOptionChipColors(row.color)}><ListRowTooltip className="block">{row.label}</ListRowTooltip></CellChip></span>{hasCard &&
            <span aria-hidden className="w-6 flex-none pointer-coarse:w-9" />}</>;
    case 'add':
      return <><ListRowLead icon="Add" /><ListRowLabel>{dropdownListRowWords(row)}</ListRowLabel></>;
    case 'addOption':
      return <><ListRowLead icon="Add" /><ListRowLabel>{dropdownListRowWords(row)}</ListRowLabel></>;
    case 'editOptions':
      return <><ListRowLead icon="Edit" /><ListRowLabel>{dropdownListRowWords(row)}</ListRowLabel></>;
    case 'startFromSet':
      return <><ListRowLead icon="Templates" /><span aria-hidden className="flex min-w-0 flex-1"><ListRowLabel>{dropdownPaneMessages.presets()}</ListRowLabel></span><span className="sr-only">{dropdownListRowWords(row)}</span><ListRowCaret isCardBeside={isCardBeside} /></>;
  }
}
export function dropdownListCardHandlers(
  { card, isCardOfPointerAlone }: Pick<DropdownListShown, 'card' | 'isCardOfPointerAlone'>,
  isCardBeside: boolean,
  cardHover: ReturnType<typeof useListCardHover>,
  handlers: Pick<DropdownListUnderCellProps, 'onRowChosen' | 'onCardOfOptionAsked' | 'onCardShut'>,
  isCaretInOptionField = false,
) {
  return {
    onRowChosen(row: string) {
      cardHover.overCard();
      if (!isCardBeside && row === 'startFromSet' && card?.ofRow === row) handlers.onCardShut();
      else handlers.onRowChosen(row);
    },
    onCardOfOptionAsked(optionId: string) {
      cardHover.overCard();
      handlers.onCardOfOptionAsked(optionId);
    },
    onRowPointedAt(row: string) {
      if (!isCardBeside) return;
      if (row === 'startFromSet') cardHover.overOpener(row);
      else if (row === card?.ofRow || isCaretInOptionField) cardHover.overCard();
      else cardHover.overOtherRow();
    },
    onOpenerLeft: cardHover.offOpener,
    onCardRowPointedAt: cardHover.overCard,
    onRowsScrolled(element: Element) {
      if (card === null) return;
      if (!isCardOfPointerAlone) return cardHover.rowsScrolled(element.ownerDocument.getElementById(dropdownListRowIdOfKey(card.ofRow)));
      cardHover.overCard();
      return handlers.onCardShut();
    },
    onPointerInOrOut(isIn: boolean) {
      if (isIn) cardHover.overCard();
      else if (isCardOfPointerAlone) cardHover.overOtherRow();
    },
  };
}
export function dropdownListSpokenWords({
  cell,
  rows,
  highlightedRow,
  isCueForCardsDue,
}: Pick<DropdownListView, 'cell' | 'rows' | 'highlightedRow' | 'isCueForCardsDue'>): string {
  let optionRows = rows.filter(({ kind }) => kind === 'option');
  let highlighted = rows[highlightedRow ?? -1];
  if (highlighted === undefined) return optionListForCellLabel(cell, optionRows.length);
  if (highlighted.kind !== 'option') return dropdownListRowWords(highlighted);
  return (isCueForCardsDue ? optionRightArrowToEditLabel : optionPlaceInListLabel)(
    highlighted.label,
    optionRows.indexOf(highlighted) + 1,
    optionRows.length,
  );
}
export const DROPDOWN_LIST_ID = 'dropdown-list';
export const dropdownListRowId = (row: DropdownMenuItem): string =>
  row.kind === 'option' ? `${DROPDOWN_LIST_ID}-option-${row.optionId}` : `${DROPDOWN_LIST_ID}-${row.kind}`;
export const DROPDOWN_LIST_OTHERS_ID = `${DROPDOWN_LIST_ID}-others`;
export const dropdownListRowIdOfKey = (rowKey: string): string => {
  let optionId = optionIdOfMenuKey(rowKey);
  return optionId === null ? `${DROPDOWN_LIST_ID}-${rowKey}` : `${DROPDOWN_LIST_ID}-option-${optionId}`;
};
export const firstDropdownListRowId = ({ rows: [row] }: Pick<DropdownListView, 'rows'>): string | null =>
  row === undefined ? null : dropdownListRowId(row);
export const NO_DROPDOWN_LIST: DropdownListShown = {
  cell: '',
  rows: [],
  highlightedRow: null,
  card: null,
  haveOptionsCards: false,
  isCueForCardsDue: false,
  isCardOfPointerAlone: false,
  isNewOptionBeingNamed: false,
  timesNewOptionAsked: 0,
  ofCell: null,
  dropdownId: null,
};
export const dropdownListRowWords = (row: DropdownMenuItem): string => {
  switch (row.kind) {
    case 'option':
      return row.label;
    case 'add':
      return addOptionText(row.label);
    case 'addOption':
      return dropdownPaneMessages.addOption();
    case 'editOptions':
      return dropdownPaneMessages.editOptions();
    case 'startFromSet':
      return opensMoreRowsLabel(dropdownPaneMessages.presets());
  }
};
export const OptionCardOpener = ({ isOpen, onPressed }: OptionCardOpenerProps) =>
  <button type="button" aria-hidden tabIndex={-1} data-popup-open={isOpen || undefined} className="ui-reset absolute inset-y-0.5 end-0.5 grid w-7 place-items-center rounded text-muted hover:bg-fill-ghost-hover hover:text-primary active:bg-fill-ghost-selected data-[popup-open]:bg-fill-ghost-selected data-[popup-open]:text-primary pointer-coarse:w-10 forced-colors:data-[popup-open]:outline-2 forced-colors:data-[popup-open]:-outline-offset-2 forced-colors:data-[popup-open]:outline-[color:Highlight] forced-colors:data-[popup-open]:outline-solid" onPointerDown={(event) => event.stopPropagation()} onClick={({ detail }) => {
      if (detail <= 1) onPressed();
    }}><Icon name="DotsHorizontal" size="sm" /></button>;
export const HELD_ROW_CLASSES = {
  className: 'data-[reorder=held]:opacity-70',
};
export const withHeldRowClasses = (rowProps: ReorderedRowProps): ReorderedRowProps => ({
  ...rowProps,
  className: `${rowProps.className} ${HELD_ROW_CLASSES.className}`,
});
export const DropdownListRows = ({
  rows,
  highlightedRow,
  card,
  haveOptionsCards,
  isCardBeside,
  onRowChosen,
  onCardOfOptionAsked,
  onRowPointedAt,
  onOpenerLeft,
  reorder,
  arePlacesInNames = IS_IOS_BROWSER,
}: DropdownListRowsProps) => {
  let optionRows = rows.filter(({ kind }) => kind === 'option');
  return rows.flatMap((row, index) => {
    let rowElement = <ListRow id={dropdownListRowId(row)} name={arePlacesInNames && row.kind === 'option' ? optionPlaceInListLabel(row.label, optionRows.indexOf(row) + 1, optionRows.length) : undefined} placeInList={index + 1} rowsInList={rows.length} isHighlighted={index === highlightedRow && (card === null || card.highlightedRow === null)} hasCardOpen={card?.ofRow === menuItemKey(row)} onChosen={() => onRowChosen(menuItemKey(row))} onPointedAt={() => onRowPointedAt(menuItemKey(row))} isOnlyTintedByPointer tellsOfEveryMove {...(row.kind === 'startFromSet' && {
        onPointerLeave: onOpenerLeft,
      })}><DropdownListRowContent row={row} isCardBeside={isCardBeside} hasCard={haveOptionsCards} /></ListRow>;
    return [
      ...((row.kind !== 'option' && rows[index - 1]?.kind === 'option') || rows[index - 1]?.kind === 'addOption'
        ? [<ListSeparator key="rule" />]
        : []),
      <div key={menuItemKey(row)} role="presentation" className="relative" {...(row.kind === 'option' &&
            reorder !== undefined && {
              ...withHeldRowClasses(reorder.ofRow(row.optionId, index)),
              onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
                reorder.pressOnRowItself(event, row.optionId, index);
              },
            })} {...(row.kind === 'option' &&
            haveOptionsCards && {
              onContextMenu(event: React.MouseEvent<HTMLDivElement>) {
                event.preventDefault();
                event.stopPropagation();
                if (card?.ofRow !== menuItemKey(row)) onCardOfOptionAsked(row.optionId);
              },
            })}>{rowElement}{row.kind === 'option' &&
              haveOptionsCards &&
              <OptionCardOpener isOpen={card?.ofRow === menuItemKey(row)} onPressed={() => onCardOfOptionAsked(row.optionId)} />}</div>,
    ];
  });
};
export const NO_ROOM_AT_LIST_ENDS = {
  start: 0,
  end: 0,
};
export const DROPDOWN_ROW_HEIGHT_PX = 28;
export const DropdownListUnderCell = React.memo(function ({
  list,
  anchor,
  cellElementId,
  isCardBeside,
  onRoomBesideMeasured,
  onRowChosen,
  onCardAsked,
  onCardOfOptionAsked,
  onOptionsNamed,
  onNewOptionNoLongerNamed,
  onOptionMoved,
  onCaretGivenBack,
  onCardRowChosen,
  onCardShut,
  onShut,
}: DropdownListUnderCellProps) {
  let shownList: DropdownListShown = useLastNonNull(list) ?? NO_DROPDOWN_LIST;
  let isCardOpen = list !== null && list.card !== null;
  let rowKeys = list?.rows.map(menuItemKey).join() ?? null;
  let fieldInFocusRef = React.useRef<OptionFieldInFocus | null>(null);
  let [isCaretInOptionField, setIsCaretInOptionField] = React.useState(false);
  let [isCaretInNewOption, setIsCaretInNewOption] = React.useState(false);
  if (isCaretInNewOption && list?.isNewOptionBeingNamed !== true) setIsCaretInNewOption(false);
  let cardRow = list?.card?.ofRow ?? null;
  let [lastCardRow, setLastCardRow] = React.useState(cardRow);
  if (cardRow !== lastCardRow) {
    setLastCardRow(cardRow);
    setIsCaretInOptionField(false);
  }
  let isCardKeptOpen = React.useCallback(() => fieldInFocusRef.current !== null && fieldInFocusRef.current.ofOption !== null, []);
  let cardHover = useListCardHover({
    rowsListed: rowKeys,
    isOpen: isCardOpen,
    onAsked: onCardAsked,
    onShut: onCardShut,
    isKeptOpen: isCardKeptOpen,
  });
  let {
    onPointerInOrOut,
    onRowsScrolled,
    onCardRowPointedAt,
    ...rowHandlers
  } = dropdownListCardHandlers(
    shownList,
    isCardBeside,
    cardHover,
    {
      onRowChosen,
      onCardOfOptionAsked,
      onCardShut,
    },
    isCaretInOptionField,
  );
  let rowsProps = {
    ...rowHandlers,
    isCardBeside,
  };
  let [mainRows, otherRows] = splitDropdownListRows(
    isCaretInNewOption
      ? {
          ...shownList,
          highlightedRow: null,
        }
      : shownList,
  );
  let optionRows = shownList.rows.filter((row) => row.kind === 'option');
  let whyOptionRefused = (optionId: string | null, label: string) => {
    if (isOptionLabelTaken(optionRows, optionId, label)) return optionAlreadyExistsText(label.trim());
    return optionId === null && optionRows.length >= MAX_DROPDOWN_OPTIONS ? dropdownPaneMessages.mostOptionsReached() : null;
  };
  let { ofCell, dropdownId } = shownList;
  let nameOptions = (optionId: string | null, labels: string[], onDone: (isDone: boolean) => void) => {
    if (dropdownId === null || ofCell === null) return onDone(false);
    let naming: OptionsNamedInDropdown = {
      ofCell,
      dropdownId,
      optionId,
      labels,
    };
    return onOptionsNamed(naming, (listAfter) => onDone(areOptionsNamedInList(listAfter, naming)));
  };
  let optionFieldProps = (optionId: string | null) => ({
    asTyped: cleanOptionLabel,
    namesPasted: (clipboard: DataTransfer) => labelsOfPastedText(clipboard.getData('text'), isCopiedFromSheets(clipboard.getData('text/html'))),
    whyRefused: (label: string) => whyOptionRefused(optionId, label),
    onEntered: (labels: string[], onDone: (isThere: boolean) => void) => nameOptions(optionId, labels, onDone),
    onCaretChange(hasCaret: boolean, field: HTMLInputElement) {
      fieldInFocusRef.current = hasCaret
        ? {
            ofOption: optionId,
            typed: null,
            field,
          }
        : null;
      setIsCaretInOptionField(hasCaret && optionId !== null);
      setIsCaretInNewOption(hasCaret && optionId === null);
    },
    onTypedChange(typed: string | null) {
      if (fieldInFocusRef.current?.ofOption === optionId)
        fieldInFocusRef.current = {
          ...fieldInFocusRef.current,
          typed,
        };
    },
  });
  let pageDocument = useUiWindow()?.document;
  let isShut = list === null;
  React.useLayoutEffect(() => {
    let fieldInFocus = fieldInFocusRef.current;
    if (fieldInFocus === null || pageDocument === undefined) return;
    let afterChange = fieldInListAfterListChange(fieldInFocus.typed, {
      isFieldGone: !fieldInFocus.field.isConnected,
      isCaretOnBody: pageDocument.activeElement === pageDocument.body,
      isListShutting: isShut,
    });
    if (afterChange === 'staysAsItIs') return;
    fieldInFocusRef.current = null;
    if (afterChange === 'textIsEnteredAndCaretGoesBack' && fieldInFocus.typed !== null)
      nameOptions(fieldInFocus.ofOption, [fieldInFocus.typed], () => {});
    onCaretGivenBack();
  });
  let newOptionIndex = shownList.isNewOptionBeingNamed ? optionRows.length : null;
  React.useLayoutEffect(() => {
    let listElement = pageDocument?.getElementById(DROPDOWN_LIST_ID) ?? null;
    if (newOptionIndex !== null && listElement !== null) listElement.scrollTop = listElement.scrollHeight;
  }, [newOptionIndex, pageDocument]);
  let rowsListRef = React.useRef<HTMLDivElement>(null);
  let canReorder = shownList.haveOptionsCards && optionRows.length > 1;
  let reorder = useReorderRows({
    listRef: rowsListRef,
    keys: canReorder ? optionRows.map(({ optionId }) => optionId) : [],
    onMoved(optionId: string, toIndex: number, onDone: (isDone: boolean) => void) {
      if (dropdownId === null || ofCell === null) onDone(false);
      else
        onOptionMoved(
          {
            ofCell,
            dropdownId,
            optionId,
            toIndex,
          },
          onDone,
        );
    },
    isRowPutBackPressed: false,
    onDragEnded(heldRow: OptionRowLetGo) {
      if (isDropAPressOnRow(heldRow)) rowHandlers.onRowChosen(optionMenuKey(heldRow.key));
    },
    roomKeptAtEnds: () => NO_ROOM_AT_LIST_ENDS,
  });
  let isPressJudgedRef = React.useRef(false);
  let notePressJudged = React.useCallback((isJudged: boolean) => {
    isPressJudgedRef.current = isJudged;
  }, []);
  let rowPressProps: RowPressesInList = {
    ofRow: reorder.ofRow,
    pressOnRowItself(...pressArgs: Parameters<RowPressesInList['pressOnRowItself']>) {
      if (!isPressJudgedRef.current) reorder.pressOnRowItself(...pressArgs);
    },
  };
  let { isRowHeld } = reorder;
  React.useEffect(() => {
    if (isRowHeld && isCardOpen) onCardShut();
  }, [isRowHeld, isCardOpen, onCardShut]);
  let cardOption = optionRows.find((option) => menuItemKey(option) === shownList.card?.ofRow);
  return <><ListUnderCell id={DROPDOWN_LIST_ID} isOpen={list !== null} onPressJudged={notePressJudged} anchor={anchor} cellElementId={cellElementId} label={dropdownOptionsForCellLabel(shownList.cell)} className="w-[220px] max-h-[var(--available-height)]" mostHeightOfRows="252px" leastHeightOfRows={`${Math.min(mainRows.rows.length, 2) * DROPDOWN_ROW_HEIGHT_PX}px`} onShut={onShut} onRowsScrolled={onRowsScrolled} onRoomBesideMeasured={onRoomBesideMeasured} onPointerInOrOut={onPointerInOrOut} under={<>{shownList.isNewOptionBeingNamed &&
              React.createElement(FieldInList, {
                ...optionFieldProps(null),
                key: dropdownId,
                name: dropdownPaneMessages.optionName(),
                value: '',
                placeholder: dropdownPaneMessages.optionName(),
                isForNew: true,
                asChip: (typed: string) => ({
                  paints: cachedOptionChipColors(colorForAddedOption(cleanOptionLabel(typed).trim(), optionRows)),
                  isPillDrawn: typed.trim() !== '',
                }),
                doesPressAskForNext: ({ id }: Element) =>
                  id ===
                  dropdownListRowId({
                    kind: 'addOption',
                  }),
                timesAsked: shownList.timesNewOptionAsked,
                onOverWithoutKey: onNewOptionNoLongerNamed,
                onLeftByKey: () => {
                  onNewOptionNoLongerNamed();
                  onCaretGivenBack();
                },
              })}{otherRows !== null &&
              <>{otherRows.rows[0]?.kind !== 'addOption' && <ListSeparator />}<PlainListBox id={DROPDOWN_LIST_OTHERS_ID} label={dropdownPaneMessages.moreForDropdown()}><DropdownListRows {...shownList} {...otherRows} {...rowsProps} /></PlainListBox></>}</>}><div ref={rowsListRef} role="presentation"><DropdownListRows {...shownList} {...mainRows} {...rowsProps} reorder={canReorder ? rowPressProps : undefined} /></div></ListUnderCell>{list !== null &&
        shownList.card !== null &&
        (<OptionsListCard listId={DROPDOWN_LIST_ID} card={shownList.card} label={shownList.card.heading === undefined ? dropdownPaneMessages.presets() : editCardHeadingLabel(shownList.card.heading)} rowId={dropdownListRowIdOfKey(shownList.card.ofRow)} head={cardOption === undefined
              ? undefined
              : React.createElement(FieldInList, {
                  ...optionFieldProps(cardOption.optionId),
                  key: cardOption.optionId,
                  name: dropdownPaneMessages.optionName(),
                  value: cardOption.label,
                  doesPressDropText: ({ id }: Element) => id === listRowIdOf(DROPDOWN_LIST_ID, `${cardOption.optionId} remove`),
                  onLeftByKey: () => {
                    onCaretGivenBack();
                    onCardShut();
                  },
                })} cell={anchor} isBeside={isCardBeside} onRowChosen={onCardRowChosen} onRowPointedAt={onCardRowPointedAt} onPointerInOrOut={onPointerInOrOut} />)}</>;
});
