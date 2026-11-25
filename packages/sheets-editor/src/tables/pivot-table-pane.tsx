import { Button } from '../kit/button.tsx';
import { Checkbox } from '../kit/checkbox.tsx';
import { FieldRoot } from '../kit/field.tsx';
import { TextInput } from '../kit/text-input.tsx';
import { useRovingToolbar } from '../kit/roving-toolbar.ts';
import * as React from 'react';
import {
  ELLIPSIS_INPUT_CLASSES,
  PANE_SELECT_HEIGHT_CLASSES,
  PANE_SELECT_TRIGGER_CLASSES,
  PaneEmptyState,
  PaneRow,
  PaneRowNote,
  PaneSection,
  PaneSelect,
  PaneSelectCaret,
  PaneTableButton,
  SidePane,
  focusPaneStart,
  revealInSidePane,
  useSidePaneCaret,
} from '../ui/side-pane/side-pane.tsx';
import { LiveAnnouncer } from '../ui/live-announcer.tsx';
import { whenBlurredToNothing } from '../grid/focus-left.ts';
import { isElementFocused } from './own-filter-bar-view.tsx';
import { columnLettersLabel } from './sort-filter-labels.ts';
import { filterMessages } from './filter-messages.ts';
import {
  pivotAddToSectionLabel,
  pivotChoiceLabel,
  pivotDataSourceLabel,
  pivotFieldLabel,
  pivotFilterKeepsLabel,
  pivotOrderByValueLabel,
  pivotOrderLabel,
  pivotPeriodLabel,
  pivotRemoveFieldLabel,
  pivotSectionLabel,
  pivotTableMessages,
  pivotTotalLabel,
} from './pivot-table-messages.tsx';
import type { ColumnId, PivotAxis, PivotOrder, PivotPeriod } from '@open-artifact/sheets-core';
import type { CaretTarget } from './own-filter-bar-view.tsx';
import type {
  DrawnPivotTablePane,
  PivotColumnOfTable,
  PivotFieldAt,
  PivotFilterAt,
  PivotFilterByKind,
  PivotFilterInPane,
  PivotGroupingAt,
  PivotListedValues,
  PivotSectionName,
  PivotTablePaneAct,
  PivotTablePaneFields,
  PivotTablePaneShown,
  PivotTyped,
} from './pivot-tables.ts';
/** Something done in the pivot table pane, told when it is done (`false` when nothing came of it). */
export type ActInPivotTablePane = (act: PivotTablePaneAct, onDone?: (isDone: boolean) => void) => void;
/** An item of a list with its place in the list. */
export interface PivotItemAtPlace<Item> {
  each: Item;
  at: number;
}
export interface PivotChoiceProps<Choice extends string | null> {
  label: string;
  column: string;
  value: Choice;
  among: readonly Choice[];
  inWords: (choice: Choice) => string;
  onChange: (choice: Choice) => void;
}
export interface PivotTypedFieldProps {
  pane: PivotTablePaneFields;
  field: PivotFieldAt;
  label: string;
  column: string;
  text: string;
  saidUnderBy?: string;
  slotEnd?: React.ReactNode;
  onAct: ActInPivotTablePane;
}
export interface PivotFieldProps {
  pane: PivotTablePaneFields;
  field: PivotFieldAt;
  column: ColumnId;
  /** The columns other fields of the section use, which this one cannot be set to. */
  taken: ColumnId[];
  /** `null` when the field cannot be removed. */
  onRemoved: ((field: PivotFieldAt) => void) | null;
  onAct: ActInPivotTablePane;
  children: React.ReactNode;
}
export interface PivotGroupingFieldProps {
  pane: PivotTablePaneFields;
  field: PivotGroupingAt;
  groupedBy: PivotAxis;
  onRemoved: PivotFieldProps['onRemoved'];
  onAct: ActInPivotTablePane;
}
export interface PivotFilterValueListProps {
  column: string;
  listed: PivotListedValues;
  onAct: ActInPivotTablePane;
}
export interface PivotFilterFieldProps {
  pane: PivotTablePaneFields;
  at: number;
  filter: PivotFilterInPane;
  onRemoved: PivotFieldProps['onRemoved'];
  onAct: ActInPivotTablePane;
}
export interface PivotSectionProps {
  pane: PivotTablePaneFields;
  among: PivotSectionName;
  onAdded: (field: PivotFieldAt) => void;
  onAct: ActInPivotTablePane;
  children: React.ReactNode;
}
export interface PivotTablePaneProps {
  pane: DrawnPivotTablePane | null;
  timesAsked: number;
  paneRef: React.RefObject<HTMLElement | null>;
  takesNoTyping: boolean;
  paneWidth: number;
  onPaneWidthChange: (width: number) => void;
  onKeyDownInPane: (event: React.KeyboardEvent) => void;
  whatHasCaretAfter: () => CaretTarget;
  wasPointerPressedLast: () => boolean;
  onAct: ActInPivotTablePane;
  onShut: () => void;
}
export function PivotChoice<Choice extends string | null>(props: PivotChoiceProps<Choice>) {
  let { label, column, value, among, inWords, onChange } = props;
  return (
    <div className="grid min-w-0 gap-0.5">
      <span className="text-footnote text-secondary select-none">{label}</span>
      <PaneSelect
        name={pivotChoiceLabel(label, column, inWords(value))}
        value={value ?? PIVOT_CHOICE_NONE}
        items={among.map((choice) => ({
          value: choice ?? PIVOT_CHOICE_NONE,
          label: inWords(choice),
        }))}
        onChange={(picked) => {
          let found = among.find((choice) => (choice ?? PIVOT_CHOICE_NONE) === picked);
          if (found !== undefined) onChange(found);
        }}
      />
    </div>
  );
}
export function PivotTypedField(props: PivotTypedFieldProps) {
  let { pane, field, label, column, text, saidUnderBy, slotEnd, onAct } = props,
    typing = pivotTypingOf(pane, field),
    enterTyping = () => {
      if (typing !== null && typing.isRefused !== true)
        onAct({
          kind: 'enterTyped',
          field,
          text: typing.text,
        });
    };
  return (
    <div className="grid min-w-0 gap-0.5">
      <span className="text-footnote text-secondary select-none">{label}</span>
      <FieldRoot invalid={typing?.isRefused === true} className="min-w-0">
        <TextInput
          fullWidth
          className={ELLIPSIS_INPUT_CLASSES}
          dir="auto"
          aria-label={pivotFieldLabel(label, column)}
          aria-describedby={saidUnderBy}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          value={typing?.text ?? text}
          {...(slotEnd !== undefined && {
            slotEnd,
          })}
          onChange={(event) =>
            onAct({
              kind: 'type',
              field,
              text: event.target.value,
            })
          }
          onBlur={({ relatedTarget, currentTarget }) => {
            if (relatedTarget !== null) enterTyping();
            else whenBlurredToNothing(currentTarget, enterTyping);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return event.stopPropagation();
            if (event.key === 'Enter') (event.preventDefault(), enterTyping());
            if (event.key === 'Escape' && typing !== null)
              (event.preventDefault(),
                event.stopPropagation(),
                onAct({
                  kind: 'dropTyped',
                }));
            return;
          }}
        />
      </FieldRoot>
    </div>
  );
}
export function PivotField(props: PivotFieldProps) {
  let { pane, field, column, taken, onRemoved, onAct, children } = props,
    [columnLabel, sectionLabel] = [pivotColumnLabelOf(pane, column), pivotSectionLabel(field.among)],
    columnsToPick = pane.columnsOfTable.filter(({ columnId }) => columnId === column || !taken.includes(columnId));
  return (
    <li className="flex flex-col gap-1 py-1.5 first:pt-0">
      <PaneRow
        trailing={
          onRemoved !== null && (
            <Button
              variant="ghost"
              iconOnly
              icon="Minus"
              aria-label={pivotRemoveFieldLabel(columnLabel, sectionLabel)}
              className="text-secondary"
              onClick={() =>
                onAct(
                  {
                    kind: 'remove',
                    field,
                  },
                  (isDone) => isDone && onRemoved(field),
                )
              }
            />
          )
        }
      >
        <div
          {...{
            [PIVOT_FIELD_COLUMN_ATTRIBUTE]: field.among,
          }}
          className="flex min-w-0 flex-1"
        >
          <PaneSelect
            name={pivotFieldLabel(sectionLabel, columnLabel)}
            value={column}
            items={columnsToPick.map((columnOfTable) =>
              columnOfTable.heading === ''
                ? {
                    value: columnOfTable.columnId,
                    label: pivotColumnLabel(columnOfTable),
                  }
                : {
                    value: columnOfTable.columnId,
                    label: pivotColumnLabel(columnOfTable),
                    hint: columnOfTable.letters,
                  },
            )}
            onChange={(columnId) =>
              onAct({
                kind: 'setColumn',
                field,
                column: columnId,
              })
            }
          />
        </div>
      </PaneRow>
      <PaneRow trailing={null}>
        <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-1.5">{children}</div>
      </PaneRow>
    </li>
  );
}
export function PivotGroupingField({ pane, field, groupedBy, onRemoved, onAct }: PivotGroupingFieldProps) {
  let { column, by, order, name } = groupedBy,
    columnLabel = pivotColumnLabelOf(pane, column),
    isDateColumn = pane.columnsOfTable.some(({ columnId, kind }) => columnId === column && kind === 'date');
  return (
    <PivotField
      pane={pane}
      field={field}
      column={column}
      taken={[...pane.rows, ...pane.columns].map((grouping) => grouping.column)}
      onRemoved={onRemoved}
      onAct={onAct}
    >
      {(isDateColumn || by !== null) && (
        <PivotChoice
          label={pivotTableMessages.groupDatesBy()}
          column={columnLabel}
          value={by}
          among={PIVOT_PERIODS}
          inWords={pivotPeriodLabel}
          onChange={(by) =>
            onAct({
              kind: 'setPeriod',
              field,
              by,
            })
          }
        />
      )}
      <PivotChoice
        label={pivotTableMessages.order()}
        column={columnLabel}
        value={order}
        among={PIVOT_ORDERS}
        inWords={pivotOrderLabel}
        onChange={(order) =>
          onAct({
            kind: 'setOrder',
            field,
            order,
          })
        }
      />
      {(field.among === 'rows' || pane.rows.length === 0) && (
        <PivotTypedField pane={pane} field={field} label={pivotTableMessages.heading()} column={columnLabel} text={name ?? ''} onAct={onAct} />
      )}
    </PivotField>
  );
}
export function moveAmongPivotValueBoxes(event: React.KeyboardEvent<HTMLElement>) {
  let step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
  if (step === 0 || event.altKey || event.ctrlKey || event.metaKey) return;
  let boxes = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="checkbox"]')],
    index = boxes.findIndex((box) => box === event.target);
  if (index < 0) return;
  event.preventDefault();
  let next = boxes.at((index + step) % boxes.length);
  if (
    (next?.focus({
      preventScroll: true,
      focusVisible: true,
    }),
    next !== undefined)
  )
    revealInSidePane(next.closest('aside'), next, true);
}
export function PivotFilterValueList({ column, listed, onAct }: PivotFilterValueListProps) {
  let rovingProps = useRovingToolbar();
  if (listed === 'notReadYet') return null;
  if (listed === 'notToBeListed') return <PaneRowNote isInRow>{filterMessages.valuesNotListed()}</PaneRowNote>;
  let tickedCount = listed.values.filter(({ isTicked }) => isTicked).length,
    isAllTicked = tickedCount === listed.values.length;
  return (
    <fieldset
      aria-label={pivotFieldLabel(pivotTableMessages.keepSelectedValues(), column)}
      className="flex min-w-0 flex-col gap-1.5 ps-md pt-1"
      {...rovingProps}
      onKeyDownCapture={moveAmongPivotValueBoxes}
    >
      <FieldRoot>
        <Checkbox
          label={filterMessages.selectAll()}
          checked={isAllTicked}
          indeterminate={tickedCount > 0 && !isAllTicked}
          onCheckedChange={() =>
            onAct({
              kind: 'tickAll',
              isTicked: !isAllTicked,
            })
          }
        />
      </FieldRoot>
      {listed.values.map(({ firstInRow, text, isTicked }, index) => (
        <FieldRoot key={firstInRow}>
          <Checkbox
            label={text ?? filterMessages.blankAsAValue()}
            checked={isTicked}
            onCheckedChange={(isTicked) =>
              onAct({
                kind: 'tick',
                index,
                isTicked,
              })
            }
          />
        </FieldRoot>
      ))}
      {listed.areMoreLeftOut && <span className="text-caption text-secondary">{filterMessages.moreValuesLeftOut()}</span>}
    </fieldset>
  );
}
export function PivotFilterField({ pane, at: index, filter, onRemoved, onAct }: PivotFilterFieldProps) {
  let noteId = React.useId(),
    { column, by } = filter,
    field: PivotFilterAt = {
      among: 'filters',
      at: index,
    },
    columnLabel = pivotColumnLabelOf(pane, column),
    isRefused = pivotTypingOf(pane, field)?.isRefused === true,
    listed = pane.listed?.at === index ? pane.listed.values : null;
  return (
    <PivotField pane={pane} field={field} column={column} taken={pane.filters.map((used) => used.column)} onRemoved={onRemoved} onAct={onAct}>
      <PaneSelect
        name={pivotChoiceLabel(pivotSectionLabel('filters'), columnLabel, pivotFilterByLabel(by.kind))}
        value={by.kind}
        items={PIVOT_FILTER_BYS.map((by) => ({
          value: by,
          label: pivotFilterByLabel(by),
        }))}
        onChange={(by) =>
          onAct({
            kind: 'filterBy',
            at: index,
            by,
          })
        }
      />
      {by.kind === 'cell' ? (
        <div>
          <PivotTypedField
            pane={pane}
            field={field}
            label={pivotTableMessages.cell()}
            column={columnLabel}
            text={by.address}
            saidUnderBy={noteId}
            slotEnd={
              <PaneTableButton
                name={pivotTableMessages.takeSelection()}
                onPressed={() =>
                  onAct({
                    kind: 'useSelection',
                    at: index,
                  })
                }
              />
            }
            onAct={onAct}
          />
          <PaneRowNote id={noteId} isRefusal={isRefused} isInRow>
            {isRefused ? pivotTableMessages.cellNotFound() : pivotTableMessages.blankCellKeepsAll()}
          </PaneRowNote>
          <LiveAnnouncer words={isRefused && pivotTableMessages.cellNotFound()} />
        </div>
      ) : (
        <>
          <button
            type="button"
            aria-label={pivotFieldLabel(pivotFilterKeepsLabel(by), columnLabel)}
            aria-expanded={listed !== null}
            className={`${PANE_SELECT_TRIGGER_CLASSES.className} ${PANE_SELECT_HEIGHT_CLASSES.className}`}
            onClick={() =>
              onAct({
                kind: 'toggleList',
                at: index,
              })
            }
          >
            <span className="min-w-0 flex-1 truncate">{pivotFilterKeepsLabel(by)}</span>
            <PaneSelectCaret />
          </button>
          {listed !== null && <PivotFilterValueList column={columnLabel} listed={listed} onAct={onAct} />}
        </>
      )}
    </PivotField>
  );
}
export function PivotSection({ pane, among, onAdded, onAct, children }: PivotSectionProps) {
  return (
    <PaneSection
      title={pivotSectionLabel(among)}
      actions={
        <Button
          variant="ghost"
          iconOnly
          icon="Add"
          aria-label={pivotAddToSectionLabel(among)}
          className="text-secondary"
          disabled={!pane.canAdd[among]}
          tooltip
          {...{
            [PIVOT_ADD_TO_SECTION_ATTRIBUTE]: among,
          }}
          onClick={() =>
            onAct(
              {
                kind: 'add',
                among,
              },
              (isDone) =>
                isDone &&
                onAdded({
                  among,
                  at: pane[among].length,
                }),
            )
          }
        />
      }
    >
      <ul className="flex flex-col">{children}</ul>
      {pane.isHeldToOneValue === among && (
        <PaneRow>
          <p className="text-caption leading-snug text-secondary">{pivotTableMessages.oneValueWithColumns()}</p>
        </PaneRow>
      )}
    </PaneSection>
  );
}
export function pivotPaneSays(pane: PivotTablePaneShown): string | null {
  switch (pane.shows) {
    case 'nothingYet':
      return null;
    case 'formulaItCannotShow':
      return pivotTableMessages.cannotEdit();
    case 'notRead':
      return pivotTableMessages.notRead();
    case 'tableNotClear':
      return pivotTableMessages.tableNotClear();
    case 'fields':
      return pane.isOutOfDate ? pivotTableMessages.outOfDate() : null;
  }
}
export const PIVOT_ORDERS: PivotOrder[] = ['ascending', 'descending'];
export const PIVOT_PERIODS: (PivotPeriod | null)[] = [null, 'day', 'month', 'quarter', 'year'];
export const PIVOT_ORDERS_BY_VALUE: (PivotOrder | null)[] = [null, 'descending', 'ascending'];
export const withPlaces = <Item,>(items: readonly Item[]): PivotItemAtPlace<Item>[] =>
  items.map((each, index) => ({
    each,
    at: index,
  }));
export const PIVOT_FILTER_BYS: PivotFilterByKind[] = ['values', 'cell'];
/** The value a choice of the pane takes in its select when it is `null`. */
export const PIVOT_CHOICE_NONE = 'none';
/** Marks the column select of each field with its section, to put the caret there. */
export const PIVOT_FIELD_COLUMN_ATTRIBUTE = 'data-column-of-field';
/** Marks the add button of each section with the section, to put the caret there. */
export const PIVOT_ADD_TO_SECTION_ATTRIBUTE = 'data-add-to-section';
export const pivotColumnLabel = ({ heading, letters }: Pick<PivotColumnOfTable, 'heading' | 'letters'>): string =>
  heading === '' ? columnLettersLabel(letters) : heading;
export const pivotColumnLabelOf = ({ columnsOfTable }: Pick<PivotTablePaneFields, 'columnsOfTable'>, columnId: ColumnId): string => {
  let column = columnsOfTable.find(({ columnId: candidateId }) => candidateId === columnId);
  return column === undefined ? '' : pivotColumnLabel(column);
};
export const pivotTypingOf = ({ typed }: Pick<PivotTablePaneFields, 'typed'>, { among, at: index }: PivotFieldAt): PivotTyped | null =>
  typed?.of.among === among && typed.of.at === index ? typed : null;
export const pivotFilterByLabel = (by: PivotFilterByKind): string =>
  by === 'values' ? pivotTableMessages.keepSelectedValues() : pivotTableMessages.matchACell();
export const PivotTablePane = React.memo(function ({
  pane,
  timesAsked,
  paneRef,
  takesNoTyping,
  paneWidth,
  onPaneWidthChange,
  onKeyDownInPane,
  whatHasCaretAfter,
  wasPointerPressedLast,
  onAct,
  onShut,
}: PivotTablePaneProps) {
  let fieldToFocusRef = React.useRef<PivotFieldAt | null>(null);
  React.useLayoutEffect(() => {
    let field = fieldToFocusRef.current;
    if (((fieldToFocusRef.current = null), field === null)) return;
    let buttons = paneRef.current?.querySelectorAll<HTMLElement>(`[${PIVOT_FIELD_COLUMN_ATTRIBUTE}="${field.among}"] button`),
      target =
        buttons?.[field.at] ??
        buttons?.[field.at - 1] ??
        paneRef.current?.querySelector<HTMLElement>(`[${PIVOT_ADD_TO_SECTION_ATTRIBUTE}="${field.among}"]`);
    if (
      (target?.focus({
        preventScroll: true,
        focusVisible: !wasPointerPressedLast(),
      }),
      target !== undefined && target !== null)
    )
      // TypeScript does not narrow through `&&` on the right of a comma.
      revealInSidePane(paneRef.current, target!, true);
  });
  let putCaretWhereToStart = React.useCallback(() => {
      let firstField = paneRef.current?.querySelector<HTMLElement>(`[${PIVOT_FIELD_COLUMN_ATTRIBUTE}] button`),
        isByPointer = wasPointerPressedLast();
      if (firstField === null || firstField === undefined)
        focusPaneStart(paneRef.current, 'start', {
          isByPointer,
        });
      else
        firstField.focus({
          preventScroll: true,
          focusVisible: !isByPointer,
        });
    }, [paneRef, wasPointerPressedLast]),
    caretBackAfterUpdate = React.useCallback(
      (element: HTMLElement) => () => {
        if (isElementFocused(element)) putCaretWhereToStart();
      },
      [putCaretWhereToStart],
    );
  useSidePaneCaret({
    isOpen: pane !== null,
    timesAsked,
    paneRef,
    putCaretWhereToStart,
    whatHasCaretAfter,
  });
  let says = pane === null ? null : pivotPaneSays(pane),
    announcer = <LiveAnnouncer words={says} timesSaid={timesAsked} />;
  if (pane === null) return <>{announcer}</>;
  let act: ActInPivotTablePane = (paneAct, onDone) => {
      let paneDocument = paneRef.current?.ownerDocument,
        focusedBefore = paneDocument?.activeElement;
      onAct(
        paneAct,
        onDone === undefined
          ? undefined
          : (isDone) => {
              let focused = paneDocument?.activeElement ?? null,
                hasCaretMovedAway =
                  focused !== null &&
                  focused !== focusedBefore &&
                  focused !== paneDocument?.body &&
                  (focused.matches('input') || paneRef.current?.contains(focused) === false);
              onDone(isDone && !hasCaretMovedAway);
            },
      );
    },
    focusFieldAfter = (field: PivotFieldAt) => void (fieldToFocusRef.current = field),
    groupingSection = (pane: PivotTablePaneFields, among: PivotGroupingAt['among']) => (
      <PivotSection pane={pane} among={among} onAdded={focusFieldAfter} onAct={act}>
        {withPlaces(pane[among]).map(({ each: grouping, at: index }) => (
          <PivotGroupingField
            key={index}
            pane={pane}
            field={{
              among,
              at: index,
            }}
            groupedBy={grouping}
            onRemoved={focusFieldAfter}
            onAct={act}
          />
        ))}
      </PivotSection>
    );
  return (
    <>
      {announcer}
      <SidePane
        ref={paneRef}
        title={pivotTableMessages.pivotTable()}
        takesNoTyping={takesNoTyping}
        width={paneWidth}
        onWidthChange={onPaneWidthChange}
        onClose={onShut}
        onKeyDown={onKeyDownInPane}
        wasPointerPressedLast={wasPointerPressedLast}
      >
        {pane.shows !== 'fields' && says !== null && <PaneEmptyState title="" hint={says} />}
        {pane.shows === 'fields' && (
          <>
            <div className="flex flex-col gap-1 pb-2">
              <PaneRow>
                <p dir="auto" className="min-w-0 text-footnote text-secondary">
                  {pivotDataSourceLabel(pane.sheetName, pane.cells)}
                </p>
              </PaneRow>
              {pane.isOutOfDate && (
                <PaneRow>
                  <p className="min-w-0 flex-1 text-footnote leading-snug text-primary">{pivotTableMessages.outOfDate()}</p>
                  <Button
                    variant="secondary"
                    ref={caretBackAfterUpdate}
                    onClick={() =>
                      act({
                        kind: 'update',
                      })
                    }
                  >
                    {pivotTableMessages.update()}
                  </Button>
                </PaneRow>
              )}
            </div>
            {groupingSection(pane, 'rows')}
            {groupingSection(pane, 'columns')}
            <PivotSection pane={pane} among="values" onAdded={focusFieldAfter} onAct={act}>
              {withPlaces(pane.values).map(({ each: { column, total, totals, order, name }, at: index }) => (
                <PivotField
                  key={index}
                  pane={pane}
                  field={{
                    among: 'values',
                    at: index,
                  }}
                  column={column}
                  taken={[]}
                  onRemoved={pane.values.length > 1 ? focusFieldAfter : null}
                  onAct={act}
                >
                  <PivotChoice
                    label={pivotTableMessages.summarizeBy()}
                    column={pivotColumnLabelOf(pane, column)}
                    value={total}
                    among={totals}
                    inWords={pivotTotalLabel}
                    onChange={(total) =>
                      act({
                        kind: 'setTotal',
                        at: index,
                        total,
                      })
                    }
                  />
                  {pane.rows.length > 0 && (
                    <PivotChoice
                      label={pivotTableMessages.sortRowsByThis()}
                      column={pivotColumnLabelOf(pane, column)}
                      value={order}
                      among={PIVOT_ORDERS_BY_VALUE}
                      inWords={pivotOrderByValueLabel}
                      onChange={(order) =>
                        act({
                          kind: 'setOrderByValue',
                          at: index,
                          order,
                        })
                      }
                    />
                  )}
                  <PivotTypedField
                    pane={pane}
                    field={{
                      among: 'values',
                      at: index,
                    }}
                    label={pivotTableMessages.heading()}
                    column={pivotColumnLabelOf(pane, column)}
                    text={name ?? ''}
                    onAct={act}
                  />
                </PivotField>
              ))}
            </PivotSection>
            <PivotSection pane={pane} among="filters" onAdded={focusFieldAfter} onAct={act}>
              {withPlaces(pane.filters).map(({ each: filter, at: index }) => (
                <PivotFilterField key={index} pane={pane} at={index} filter={filter} onRemoved={focusFieldAfter} onAct={act} />
              ))}
            </PivotSection>
          </>
        )}
      </SidePane>
    </>
  );
});
