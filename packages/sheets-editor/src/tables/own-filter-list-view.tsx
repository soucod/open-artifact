import { FieldRoot } from '../kit/field.tsx';
import { TextInput } from '../kit/text-input.tsx';
import { CheckboxMark } from '../kit/checkbox.tsx';
import { Combobox } from '../kit/combobox.tsx';
import { Popover } from '../kit/popover.tsx';
import { Button } from '../kit/button.tsx';
import { Icon } from '../kit/icon.tsx';
import type { SortDirection } from '@open-artifact/sheets-core';
import type { ConditionChoice } from '../messages/conditional-format.ts';
import type { PopoverPopupProps } from '../kit/popover.tsx';
import type { OwnFilterListAct } from '../state/event-reducer.ts';
import type { FilterValueDrawn, OwnFilterConditionHeld } from '../state/initial-state.ts';
import type { OwnFilterConditionDrawn, OwnFilterListDrawn } from './own-filter-list.ts';
import type { CaretTarget } from './own-filter-bar-view.tsx';
import type { AskListRow } from '../ui/ask-list/ask-or-pick-list.tsx';
import * as React from 'react';
import { inputsOfFilterChoice, isIsoDateText } from './own-filter-conditions.ts';
import { Fragment } from 'react/jsx-runtime';
import { PaneSelect } from '../ui/side-pane/side-pane.tsx';
import { controlWithChoiceLabel, CONDITIONAL_FORMATTING_WORDS, ruleColumnName } from '../messages/conditional-format.ts';
import {
  filterChoiceLabel,
  filterMessages,
  wholeNumberRangeHint,
  describeFilterLineAlternatives,
  removeFilterLineLabel,
  describeFilterCondition,
  conditionJoinHint,
  changeConditionLabel,
  readyFilterLabel,
  rowsInViewOfAllText,
  filterByColumnLabel,
  searchOrFilterColumnLabel,
} from './filter-messages.ts';
import { SheetDateInput } from '../chips/date-input.tsx';
import { isElementFocused } from './own-filter-bar-view.tsx';
import { joinMessageParts } from '../i18n/messages.ts';
import { WordsWithColumnNames } from '../ui/card-rows.tsx';
import { ARROW_STOP_ATTRIBUTES, labelWithCount, AskOrPickList, askListFoundSaid } from '../ui/ask-list/ask-or-pick-list.tsx';
import { MAX_FILTER_CONDITIONS } from './filter-model.ts';
import { CellChip } from '../grid/cell-drawing.tsx';
import { sortByColumnLabel, sortDirectionWords, filterViewChoiceLabel, rowCountWords, sortAndFilterMessages } from './sort-filter-labels.ts';
import { MOST_CHARACTERS_OF_WORDS } from '../words/vocabulary.ts';
import { TABLE_CARD_WIDTH } from './hung-card-place.ts';
import { usePopupGivenUpOnBlur } from '../ui/popup-given-up-on-blur.ts';
import { usePopupFieldFocus } from '../ui/popup-field-focus.ts';
import { isOnPhone, useTouchBelowSm } from '../app/media-queries.ts';
import { useBottomInsetWhileOpen, popupCollisionPadding } from '../shell/bottom-insets.ts';
import { wrapTabFocusInBar } from '../ui/dom-events.ts';
export type OwnFilterListActs = (act: OwnFilterListAct) => void;
export type OwnFilterListSorts = (direction: SortDirection) => void;
export interface OwnFilterConditionEditorProps {
  condition: OwnFilterConditionDrawn;
  list: Pick<OwnFilterListDrawn, 'choices' | 'isOfDays' | 'mostCounted'>;
  box: (element: HTMLDivElement | null) => void;
  /** The button that removes the condition, drawn at the end of the row. */
  x: React.ReactNode;
  onAct: OwnFilterListActs;
  onChanged: () => void;
  onDone: (held: OwnFilterConditionHeld, from: Element) => void;
}
export interface OwnFilterConditionControlsProps {
  list: OwnFilterListDrawn;
  onAct: OwnFilterListActs;
}
/** Where focus goes once a condition is drawn again, open or shut, after the person moved it. */
export interface FocusToMove {
  key: number;
  isOpen: boolean;
  from: Element | null;
}
export interface OwnFilterListBodyProps {
  list: OwnFilterListDrawn;
  isColumnNamedAbove: boolean;
  onAct: OwnFilterListActs;
  onSort: OwnFilterListSorts | null;
}
export interface OwnFilterListPopoverProps {
  list: OwnFilterListDrawn | null;
  anchor: PopoverPopupProps['anchor'];
  clearAtFoot: number;
  onDrawn: ((popup: HTMLElement | null) => void) | null;
  whatHasCaretAfter: () => CaretTarget;
  onAct: OwnFilterListActs;
  onSort: OwnFilterListSorts | null;
  onShut: () => void;
  onActedWithin: () => void;
  onGone: () => void;
  onBack: ((isByKey: boolean) => void) | null;
}
export type OwnFilterListProps = OwnFilterListPopoverProps;
/** A row the first found row of the list is read from. */
export interface FoundRowSaid {
  words: string;
  count?: string;
}
/** A row the typed words found: a ready-made filter or a sort. */
export interface FoundListRow extends FoundRowSaid {
  id: string;
  drawn: React.ReactNode;
  underHeading?: string;
  atEnd?: React.ReactNode;
  isChecked?: boolean;
  isOutOfUse?: boolean;
}
/** Where the caret goes once the own filter list is shut. */
export interface CaretAfterFilterList {
  isOtherCardOpen: boolean;
  opener: HTMLElement | null;
  isLeftByPress: boolean;
  otherwise: () => CaretTarget;
}
export function OwnFilterConditionEditor({
  condition,
  list: { choices, isOfDays, mostCounted },
  box,
  x: removeButton,
  onAct,
  onChanged,
  onDone,
}: OwnFilterConditionEditorProps) {
  let [held, setHeld] = React.useState(condition.held);
  let editorRef = React.useRef<HTMLDivElement | null>(null);
  let mistypedNoteId = React.useId();
  let changeHeld = (nextHeld: OwnFilterConditionHeld) => {
    setHeld(nextHeld);
    onChanged();
    onAct({
      kind: 'changeCondition',
      key: condition.key,
      held: nextHeld,
    });
  };
  let fieldKinds = inputsOfFilterChoice(held.choice, isOfDays);
  let areFieldsFilled = fieldKinds.every(
    (fieldKind, fieldIndex) => (fieldIndex === 0 ? held.first : held.second).trim() !== '',
  );
  let choicesShown = choices.includes(held.choice) ? choices : [held.choice, ...choices];
  return <div ref={(element) => {
      editorRef.current = element;
      box(element);
    }} className="flex shrink-0 items-start ps-md"><div className="-ms-[var(--ui-gap-xs)] flex min-w-0 flex-1 flex-wrap items-center gap-x-xs"><div className="flex max-w-full flex-none"><PaneSelect isFlush isSamePickTold name={controlWithChoiceLabel(CONDITIONAL_FORMATTING_WORDS.condition(), filterChoiceLabel(held.choice, isOfDays))} value={held.choice} items={choicesShown.map(
                (choice) => ({
                  value: choice,
                  label: filterChoiceLabel(choice, isOfDays),
                }),
              )} onChange={(choice: ConditionChoice) => {
                let needsNoFields = inputsOfFilterChoice(choice, isOfDays).length === 0;
                if (choice !== held.choice)
                  changeHeld({
                    ...held,
                    choice,
                  });
                if (needsNoFields && editorRef.current !== null)
                  onDone(
                    {
                      ...held,
                      choice,
                    },
                    editorRef.current,
                  );
              }} /></div>{fieldKinds.map((fieldKind, fieldIndex) => {
            const heldSide = fieldIndex === 0 ? 'first' : 'second';
            let fieldLabel =
              fieldKinds.length === 1 ? CONDITIONAL_FORMATTING_WORDS.value() : fieldIndex === 0 ? filterMessages.from() : filterMessages.to();
            return (<div key={heldSide} className={`min-w-0 ${fieldKind === 'day' ? 'flex-[1_1_7.5rem]' : fieldKind === 'text' ? 'flex-[1_1_5rem]' : 'flex-[1_1_4rem]'}`}>{fieldKind === 'day'
                    ? (<SheetDateInput aria-label={fieldLabel} size="sm" className={UNDERLINED_FIELD_PROPS.className} value={isIsoDateText(held[heldSide]) ? held[heldSide] : null} onValueCommitted={(day) =>
                          changeHeld({
                            ...held,
                            [heldSide]: day ?? '',
                          })} />)
                    : (<FieldRoot invalid={condition.isMistyped[fieldIndex] === true}><TextInput fullWidth aria-label={fieldLabel} aria-describedby={condition.isMistyped[fieldIndex] === true ? mistypedNoteId : undefined} placeholder={fieldLabel} inputMode={fieldKind === 'count' ? 'numeric' : undefined} autoCapitalize="off" autoCorrect="off" className={`${COARSE_POINTER_TALL_CLASS} ${UNDERLINED_FIELD_PROPS.className}`} value={held[heldSide]} onChange={({ currentTarget }) =>
                            changeHeld({
                              ...held,
                              [heldSide]: currentTarget.value,
                            })} onKeyDown={(keyEvent) => {
                            let isComposing = keyEvent.nativeEvent.isComposing || keyEvent.keyCode === 229;
                            if (keyEvent.key !== 'Enter' || isComposing || !areFieldsFilled) return;
                            keyEvent.preventDefault();
                            onDone(held, keyEvent.currentTarget);
                          }} /></FieldRoot>)}</div>);
          })}{condition.isMistyped.includes(true) &&
            <p id={mistypedNoteId} className="basis-full pb-1 text-caption leading-snug text-danger">{fieldKinds.includes('count') ? wholeNumberRangeHint(mostCounted) : CONDITIONAL_FORMATTING_WORDS.enterANumber()}</p>}</div>{removeButton}</div>;
}
export function OwnFilterConditionControls({ list, onAct }: OwnFilterConditionControlsProps) {
  let [editingKey, setEditingKey] = React.useState<number | null>(null);
  let [heldAtDone, setHeldAtDone] = React.useState<OwnFilterConditionHeld | null>(null);
  let focusToMoveRef = React.useRef<FocusToMove | null>(null);
  let noteFocusToMove = (key: number, isOpen: boolean, { ownerDocument }: Pick<Element, 'ownerDocument'>) => {
    focusToMoveRef.current = {
      key,
      isOpen,
      from: ownerDocument.activeElement,
    };
  };
  let takeFocusWhenShown =
    (key: number, isOpen: boolean) =>
    (element: HTMLElement | null) => {
      let owed = focusToMoveRef.current;
      if (element === null || owed?.key !== key || owed.isOpen !== isOpen) return;
      focusToMoveRef.current = null;
      if (isFocusStillNear(element, owed.from)) element.querySelector('button')?.focus();
    };
  let hasChoices = list.choices.length > 0;
  let addConditionRef = React.useRef<HTMLButtonElement | null>(null);
  let focusAddWhenShownRef = React.useRef(false);
  let pressedRemoveRef = React.useRef<HTMLElement | null>(null);
  let removeButtonRef = React.useCallback(
    (button: HTMLElement) =>
      () => {
        if (pressedRemoveRef.current !== button) return;
        pressedRemoveRef.current = null;
        if (!isElementFocused(button)) return;
        if (addConditionRef.current !== null) addConditionRef.current.focus();
        else if (hasChoices) focusAddWhenShownRef.current = true;
        else button.closest('[role="dialog"]')?.querySelector('input')?.focus();
      },
    [hasChoices],
  );
  let addConditionButtonRef = React.useCallback((button: HTMLButtonElement | null) => {
    addConditionRef.current = button;
    if (button === null) return;
    if (focusAddWhenShownRef.current && isFocusStillNear(button, null)) button.focus();
    focusAddWhenShownRef.current = false;
  }, []);
  let renderRemoveButton = (label: string, action: OwnFilterListAct) =>
    <span className="flex h-control flex-none items-center ps-xs pe-md pointer-coarse:h-10"><Button ref={removeButtonRef} variant="ghost" size="xs" iconOnly icon="X" flush="end" aria-label={label} className="text-secondary" onClick={({ currentTarget }) => {
          pressedRemoveRef.current = currentTarget;
          onAct(action);
        }} /></span>;
  let { conditions, join } = list;
  return <>{list.otherLines.map(({ lineIndex, line }) => {
        let lineWords = describeFilterLineAlternatives(line);
        return (<div key={lineIndex} className="flex shrink-0 items-center ps-md"><span className="min-w-0 flex-1 truncate text-body" title={joinMessageParts(lineWords)}><WordsWithColumnNames words={lineWords} /></span>{renderRemoveButton(removeFilterLineLabel(joinMessageParts(lineWords)), {
                kind: 'removeLine',
                lineIndex,
              })}</div>);
      })}{conditions.map((condition, conditionIndex) => {
        let { key: conditionKey, held: conditionHeld, said } = condition;
        let saidText = said === null ? null : describeFilterCondition(said);
        let removeButton = renderRemoveButton(saidText === null ? filterMessages.removeCondition() : removeFilterLineLabel(saidText), {
          kind: 'removeCondition',
          key: conditionKey,
        });
        return (<React.Fragment key={conditionKey}>{conditionIndex > 0 &&
                (<div className="flex shrink-0 ps-md"><Button variant="ghost" size="xs" flush="start" className="text-secondary pointer-coarse:h-10" aria-label={conditionJoinHint(join)} onClick={() =>
                      onAct({
                        kind: 'joinConditions',
                        by: join === 'and' ? 'or' : 'and',
                      })}>{join === 'and' ? filterMessages.and() : filterMessages.or()}</Button></div>)}{saidText === null || (conditionKey === editingKey && !isSameHeldCondition(conditionHeld, heldAtDone))
                ? (<OwnFilterConditionEditor condition={condition} list={list} box={takeFocusWhenShown(conditionKey, true)} x={removeButton} onAct={onAct} onChanged={() => {
                      focusToMoveRef.current = null;
                      setHeldAtDone(null);
                      setEditingKey(conditionKey);
                    }} onDone={(doneHeld, doneFrom) => {
                      noteFocusToMove(conditionKey, false, doneFrom);
                      setHeldAtDone(doneHeld);
                      setEditingKey(conditionKey);
                    }} />)
                : (<div ref={takeFocusWhenShown(conditionKey, false)} className="flex shrink-0 items-center"><Combobox.FooterAction {...ARROW_STOP_ATTRIBUTES} className={`min-w-0 flex-1 ${FOCUS_SHADOW_CLASS}`} aria-label={changeConditionLabel(saidText)} onClick={({ currentTarget }) => {
                          noteFocusToMove(conditionKey, true, currentTarget);
                          setHeldAtDone(null);
                          setEditingKey(conditionKey);
                        }}><span className="min-w-0 flex-1 truncate text-start" title={saidText}>{saidText}</span></Combobox.FooterAction>{removeButton}</div>)}</React.Fragment>);
      })}{hasChoices &&
        conditions.length < MAX_FILTER_CONDITIONS &&
        (<Combobox.FooterAction ref={addConditionButtonRef} {...ARROW_STOP_ATTRIBUTES} className={FOCUS_SHADOW_CLASS} onClick={({ currentTarget }) => {
            let newKey = Math.max(-1, ...conditions.map((condition) => condition.key)) + 1;
            noteFocusToMove(newKey, true, currentTarget);
            setHeldAtDone(null);
            setEditingKey(newKey);
            onAct({
              kind: 'addCondition',
              key: newKey,
            });
          }}><Icon name="Add" size="md" className="flex-none" /><span className="min-w-0 flex-1 truncate text-start">{filterMessages.addCondition()}</span></Combobox.FooterAction>)}</>;
}
export function filterValueRow(filterValue: FilterValueDrawn) {
  let label = filterValueLabel(filterValue);
  return {
    id: `value ${filterValue.index}`,
    mark: listRowMarkSlot(
      <CheckboxMark checked={filterValue.isTicked} />,
    ),
    isTicked: filterValue.isTicked,
    laysItselfOut: true,
    drawn:
      filterValue.optionPaints === null
        ? <span className={`min-w-0 flex-1 truncate ${filterValue.text === null ? 'text-secondary' : ''}`}>{label}</span>
        : <span className="sheet-own-filter-option flex-1"><CellChip optionPaints={filterValue.optionPaints}>{label}</CellChip></span>,
    atEnd: tabularCount(filterValue.records),
    inFull: label,
  };
}
export function OwnFilterListBody({ list, isColumnNamedAbove = false, onAct, onSort }: OwnFilterListBodyProps) {
  let [typedWords, setTypedWords] = React.useState('');
  let pointedRowRef = React.useRef<string | null>(null);
  let isTouchBelowSm = useTouchBelowSmAtOpen();
  let isSearching = typedWords.trim() !== '';
  let { answer, values } = list;
  let hasConditionControls = list.choices.length > 0 || list.conditions.length > 0 || list.otherLines.length > 0;
  let sortRows =
    list.sort === null || onSort === null
      ? []
      : FILTER_LIST_SORT_DIRECTIONS.map((direction) => {
          let sortKeys = list.sort?.keys ?? null;
          let sortWords = sortByColumnLabel({
            column: list.column,
            direction,
            holds: sortKeys,
          });
          return {
            id: direction,
            words: sortWords,
            underHeading: sortDirectionWords(sortKeys, direction),
            drawn: sortWords,
            isChecked: list.sort?.inForce === direction,
            isOutOfUse: !list.canSortNow,
          };
        });
  let readyRows = list.ready.map(({ what, label, records }) => {
    let readyWords =
      what === 'mine'
        ? filterViewChoiceLabel({
            kind: what,
          })
        : what === 'allBut'
          ? filterViewChoiceLabel({
              kind: what,
              label: label ?? '',
            })
          : readyFilterLabel(what);
    let count = rowCountWords(records);
    return {
      id: what,
      words: readyWords,
      drawn: readyWords,
      atEnd: tabularCount(count),
      count,
    };
  });
  let searchedFor = typedWords.trim().toLowerCase();
  let readyMatches = (answer === null ? readyRows : []).filter(
    ({ words }) => words.toLowerCase().includes(searchedFor),
  );
  let sortMatches = sortRows.filter(
    ({ words, underHeading }) =>
      searchedFor.length >= MIN_CHARACTERS_TO_MATCH_SORTS &&
      [underHeading, words].some((candidate) => candidate.toLowerCase().startsWith(searchedFor)),
  );
  let foundRows: FoundListRow[] = [...readyMatches, ...sortMatches];
  let answerWords = answer === null ? null : describeFilterLineAlternatives(answer.line);
  let answerRow =
    answer === null || answerWords === null
      ? null
      : withTwoLineDrawing(
          {
            id: FILTER_ANSWER_ROW_ID,
            inFull: joinMessageParts(answerWords),
          },
          <WordsWithColumnNames words={answerWords} />,
          <span className="min-h-[1lh] text-footnote text-muted">{answer.records === null ? '' : tabularCount(rowCountWords(answer.records))}</span>,
        );
  let valueRows: AskListRow[] =
    values === null || values.length === 0
      ? []
      : [
          {
            id: SELECT_ALL_ROW_ID,
            mark: listRowMarkSlot(
              <CheckboxMark checked={list.ticked === 'all'} indeterminate={list.ticked === 'some'} />,
            ),
            isTicked: list.ticked === 'some' ? 'some' : list.ticked === 'all',
            drawn: filterMessages.selectAll(),
          },
          ...values.map(filterValueRow),
          ...(list.areMoreLeftOut
            ? [
                {
                  id: MORE_VALUES_ROW_ID,
                  drawn: filterMessages.moreValuesLeftOut(),
                  isOutOfUse: true,
                },
              ]
            : []),
        ];
  let sections = (isSearching ? [answerRow === null ? [] : [answerRow], foundRows, valueRows] : [readyRows, valueRows]).flatMap(
    (rows, sectionIndex) =>
      rows.length === 0
        ? []
        : [
            {
              id: String(sectionIndex),
              heading:
                rows === readyRows
                  ? sortAndFilterMessages.suggested()
                  : rows === valueRows
                    ? labelWithCount(filterMessages.values(), list.records === null ? null : rowsInViewOfAllText(list.records), false)
                    : null,
              rows,
            },
          ],
  );
  let [settledWords, setSettledWords] = React.useState<string | null>(null);
  React.useEffect(() => {
    let timer = setTimeout(() => setSettledWords(typedWords), TYPED_WORDS_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [typedWords]);
  let listNote =
    values === null
      ? filterMessages.valuesNotListed()
      : isSearching && sections.length === 0 && (!list.areWordsOnTheirWay || settledWords === typedWords)
        ? filterMessages.noMatches()
        : null;
  let answerSaid =
    answer === null || answerWords === null
      ? undefined
      : {
          words: joinMessageParts(answerWords),
          ...(answer.records !== null && {
            count: rowCountWords(answer.records),
          }),
        };
  let firstFound = !isSearching
    ? null
    : (answerSaid ?? foundRows.find(({ isOutOfUse }) => isOutOfUse !== true) ?? null);
  let readyRowOf = (rowId: string | null) =>
    rowId === FILTER_ANSWER_ROW_ID ? 'answer' : (list.ready.find(({ what }) => what === rowId)?.what ?? null);
  let takeRow = (rowId: string) => {
    let [rowKind, valueIndex] = rowId.split(' ');
    let [sortDirection, readyRow] = [
      FILTER_LIST_SORT_DIRECTIONS.find((direction) => direction === rowId),
      readyRowOf(rowId),
    ];
    if (sortDirection !== undefined) return onSort?.(sortDirection);
    if (readyRow !== null)
      return onAct({
        kind: 'take',
        row: readyRow,
      });
    if (rowId === SELECT_ALL_ROW_ID)
      return onAct({
        kind: list.ticked === 'all' ? 'tickNone' : 'tickAll',
      });
    return rowKind === 'value'
      ? onAct({
          kind: 'tick',
          index: Number(valueIndex),
        })
      : undefined;
  };
  return <AskOrPickList nameOfField={filterByColumnLabel(list.column)} nameOfList={sortAndFilterMessages.waysToSortAndFilter()} placeholder={isColumnNamedAbove ? filterMessages.searchOrFilter() : searchOrFilterColumnLabel(list.column)} text={typedWords} mostCharacters={MOST_CHARACTERS_OF_WORDS} stands="atRest" isAgentAtWork={false} said={isSearching ? null : listNote} foundSaid={isSearching ? filterListFoundSaid(firstFound, listNote) : askListFoundSaid(null)} note={listNote === null
        ? null
        : <p className="px-md py-1.5 text-body text-secondary">{listNote}</p>} sections={sections} doesFirstRowAnswer={firstFound !== null} overList={isSearching
      ? []
      : [
          ...(sortRows.length === 0
            ? []
            : [
                {
                  id: 'sorts',
                  heading: labelWithCount(
                    filterMessages.sorts(),
                    list.sort?.isForOneself === true ? filterMessages.forYouOnly() : filterMessages.forEveryone(),
                  ),
                  controls: sortRows.map(
                    ({ id: sortDirection, underHeading, isChecked }) =>
                      (<Combobox.FooterAction key={sortDirection} {...ARROW_STOP_ATTRIBUTES} className={`${FOCUS_SHADOW_CLASS} disabled:opacity-disabled`} aria-current={isChecked} disabled={!list.canSortNow} onClick={() => onSort?.(sortDirection)}><span className="min-w-0 flex-1 truncate text-start">{underHeading}</span>{isChecked &&
                              <span className="flex flex-none text-accent"><Icon name="Check" size="md" /></span>}</Combobox.FooterAction>),
                  ),
                },
              ]),
          ...(hasConditionControls
            ? [
                {
                  id: 'conditions',
                  heading: labelWithCount(filterMessages.filters(), filterMessages.forYouOnly()),
                  controls: <OwnFilterConditionControls list={list} onAct={onAct} />,
                },
              ]
            : []),
        ]} foot={null} wordsOfFoot={{
      keep: '',
      discard: '',
      stop: '',
    }} height={isTouchBelowSm
      ? '100%'
      : {
          atMost: '520px',
        }} isUnderTitle={isColumnNamedAbove} width={TABLE_CARD_WIDTH} onTextChange={(words: string) => {
      pointedRowRef.current = null;
      setTypedWords(words);
      onAct({
        kind: 'type',
        words,
        blank: filterMessages.blankAsAValue(),
      });
    }} onRowPointedAt={(rowId: string | null) => {
      let readyRow = readyRowOf(rowId);
      if (readyRow === pointedRowRef.current) return;
      pointedRowRef.current = readyRow;
      onAct({
        kind: 'pointAt',
        row: readyRow,
      });
    }} onRowTaken={takeRow} onEntered={() =>
      onAct({
        kind: 'take',
        row: 'answer',
      })} onKept={() => {}} onSteppedBack={() => {}} />;
}
export function OwnFilterListPopover({
  list,
  anchor,
  clearAtFoot,
  onDrawn,
  whatHasCaretAfter,
  onAct,
  onSort,
  onShut,
  onActedWithin,
  onGone,
  onBack,
}: OwnFilterListPopoverProps) {
  let [listShown, setListShown] = React.useState(list);
  if (list !== null && list !== listShown) setListShown(list);
  let popupRef = React.useRef<HTMLElement | null>(null);
  let goBack = React.useCallback(({ detail }: Pick<React.MouseEvent, 'detail'>) => onBack?.(detail === 0), [onBack]);
  let { isGivenUp, holdPopup, noteFocus } = usePopupGivenUpOnBlur(list !== null, onShut);
  let isOpen = list !== null && !isGivenUp;
  let focusOnOpen = usePopupFieldFocus({
    isOpen,
    popup: popupRef,
    shut: onShut,
  });
  let initialFocus = React.useCallback(() => (isOnPhone() ? popupRef.current : focusOnOpen()), [focusOnOpen]);
  let popupElementRef = React.useCallback(
    (popup: HTMLElement | null) => {
      popupRef.current = popup;
      holdPopup(popup);
      onDrawn?.(popup);
    },
    [holdPopup, onDrawn],
  );
  let roomUnderKeyboard = useBottomInsetWhileOpen(list !== null, false);
  React.useLayoutEffect(() => {
    if (isOpen && popupRef.current !== null) onDrawn?.(popupRef.current);
  }, [isOpen, onDrawn]);
  return <Popover.Root open={isOpen} onOpenChange={(open, { event: openEvent, reason }) => {
      let isOnFilterOpener = openEvent.target instanceof Element && openEvent.target.closest(FILTER_OPENER_SELECTOR) !== null;
      if (!open && !(reason === 'outside-press' && isOnFilterOpener)) onShut();
    }} onOpenChangeComplete={(open) => {
      if (!open) onGone();
    }}><Popover.Popup ref={popupElementRef} anchor={anchor} side="bottom" align="start" padding="none" {...(onBack !== null && {
        className: 'flex flex-col',
      })} collisionPadding={popupCollisionPadding(Math.max(roomUnderKeyboard, clearAtFoot))} collisionAvoidance={FILTER_LIST_COLLISION_AVOIDANCE} aria-label={listShown === null || onBack !== null ? undefined : filterByColumnLabel(listShown.column)} initialFocus={initialFocus} sheetHeight="tall" finalFocus={whatHasCaretAfter} onFocus={noteFocus} onKeyDown={wrapTabFocusInBar} onPointerDownCapture={onActedWithin} onKeyDownCapture={onActedWithin}>{listShown !== null &&
          onBack !== null &&
          <Popover.Header showClose={false} onBack={goBack} backLabel={filterMessages.backToSortAndFilter()}>{ruleColumnName(listShown.column)}</Popover.Header>}{listShown !== null &&
          <OwnFilterListBody key={`${listShown.tableKey} ${listShown.c}`} list={listShown} isColumnNamedAbove={onBack !== null} onAct={onAct} onSort={onSort} />}</Popover.Popup></Popover.Root>;
}
export const useTouchBelowSmAtOpen = () => React.useState(useTouchBelowSm())[0];
export const filterValueLabel = ({ text, isChecked }: Pick<FilterValueDrawn, 'text' | 'isChecked'>) =>
  isChecked === null ? (text ?? filterMessages.blankAsAValue()) : filterChoiceLabel(isChecked ? 'isChecked' : 'isNotChecked', false);
export const COARSE_POINTER_TALL_CLASS = 'pointer-coarse:h-10';
export const UNDERLINED_FIELD_PROPS = {
  className:
    'rounded-none! border-b border-b-border bg-transparent! px-xs! shadow-none! focus-visible:border-b-current data-[invalid]:border-b-danger focus-visible:data-[invalid]:border-b-2 forced-colors:focus-visible:border-b-[Highlight]',
};
export const FOCUS_SHADOW_CLASS = 'focus-visible:shadow-focus';
export const isFocusStillNear = (element: Element, focusedBefore: Element | null): boolean => {
  let { activeElement } = element.ownerDocument;
  return element.ownerDocument.hasFocus() && (activeElement === focusedBefore || activeElement?.contains(element) === true);
};
export const isSameHeldCondition = (held: OwnFilterConditionHeld, other: OwnFilterConditionHeld | null): boolean =>
  held.choice === other?.choice && held.first === other.first && held.second === other.second;
export const listRowMarkSlot = (mark: React.ReactNode) =>
  <span data-size="xs" className="flex w-5 flex-none justify-start">{mark}</span>;
export const tabularCount = (count: string | number) =>
  <span className="tabular-nums">{count}</span>;
export const FILTER_LIST_SORT_DIRECTIONS: readonly SortDirection[] = ['ascending', 'descending'];
export const filterListFoundSaid = (firstFound: FoundRowSaid | null, note: string | null) =>
  askListFoundSaid(
    firstFound === null
      ? {
          rowOfEnter: null,
          count: null,
          note,
        }
      : {
          rowOfEnter: firstFound.words,
          count: firstFound.count ?? null,
          note: null,
        },
  );
export const FILTER_LIST_COLLISION_AVOIDANCE: PopoverPopupProps['collisionAvoidance'] = {
  side: 'none',
  align: 'shift',
  fallbackAxisSide: 'none',
};
export const MIN_CHARACTERS_TO_MATCH_SORTS = 3;
export const TYPED_WORDS_SETTLE_MS = 500;
export const FILTER_ANSWER_ROW_ID = 'answer';
export const SELECT_ALL_ROW_ID = 'all';
export const MORE_VALUES_ROW_ID = 'more';
export const withTwoLineDrawing = (row: { id: string; inFull: string }, words: React.ReactNode, atEnd: React.ReactNode) => ({
  ...row,
  laysItselfOut: true,
  drawn: <span className="flex min-w-0 flex-1 flex-col"><span className="line-clamp-2 min-w-0 wrap-anywhere">{words}</span>{atEnd}</span>,
});
export const FILTER_OPENER_SELECTOR =
  '.sheet-own-filter-button, .sheet-own-filter-bar :is([aria-haspopup="dialog"], .sheet-own-filter-line-remove)';
export const whatHasCaretAfterFilterList = (caretReturn: CaretAfterFilterList): CaretTarget => {
  if (caretReturn.isOtherCardOpen) return false;
  return caretReturn.opener !== null && !caretReturn.isLeftByPress ? caretReturn.opener : caretReturn.otherwise();
};
export const OwnFilterList = React.memo(function (props: OwnFilterListProps) {
  let listKey = props.list === null ? null : `${props.list.tableKey} ${props.list.c}`;
  let [shownKey, setShownKey] = React.useState(listKey);
  let [timesSwitched, setTimesSwitched] = React.useState(0);
  if (listKey !== shownKey) {
    setShownKey(listKey);
    if (listKey !== null && shownKey !== null) setTimesSwitched(timesSwitched + 1);
  }
  return <OwnFilterListPopover key={timesSwitched} {...props} />;
});
