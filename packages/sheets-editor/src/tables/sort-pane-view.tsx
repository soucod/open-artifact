import { FieldRoot } from '../kit/field.tsx';
import { TextInput } from '../kit/text-input.tsx';
import { Switch } from '../kit/switch.tsx';
import { Tooltip, TooltipGroup } from '../kit/tooltip.tsx';
import { Button } from '../kit/button.tsx';
import { Icon } from '../kit/icon.tsx';
import type { ColumnId, SortDirection } from '@open-artifact/sheets-core';
import * as React from 'react';
import { useCoarsePointer } from '../app/media-queries.ts';
import {
  customSortMessages,
  removeSortColumnLabel,
  reorderSortColumnLabel,
  labeledSortColumnWords,
  sortOrderOfColumnLabel,
  sortDirectionWords,
  columnLettersLabel,
} from './sort-filter-labels.ts';
import { REORDER_LIFT_PROPS, useReorderRows } from '../ui/reorder-rows.ts';
import {
  PaneRow,
  PaneSelect,
  PaneTableButton,
  revealInSidePane,
  useSidePaneCaret,
  focusPaneStart,
  SidePane,
  PaneSection,
  PaneRowNote,
} from '../ui/side-pane/side-pane.tsx';
import { whenBlurredToNothing } from '../grid/focus-left.ts';
import { LiveAnnouncer } from '../ui/live-announcer.tsx';
import { savingChangesText } from '../i18n/notice-labels.ts';
import { filterForWhomLabel } from './filter-messages.ts';
import type { DrawnSortPane, SortKeyInPane, SortPaneAct, SortPaneColumn } from './sort-pane.ts';
export type ActInSortPane = (act: SortPaneAct, onDone?: (isDone: boolean) => void) => void;
/** Where the caret goes once the keys of the sort change: the column of the key at an index, the column of a key added, or the handle of a key. */
type CaretAfterKeysChange = number | { added: number } | { handleOf: number };
export interface SortKeyRowProps {
  sortKey: SortKeyInPane;
  index: number;
  columns: SortPaneColumn[];
  isAlone: boolean;
  reorder: ReturnType<typeof useReorderRows>;
  keysThatMoveSaidBy: string;
  onAct: ActInSortPane;
  onRemoved: (index: number) => void;
}
export interface SortCellsFieldProps {
  cells: string;
  cellsTyped: string | null;
  whyNotSaidBy: string | null;
  onAct: ActInSortPane;
}
export interface CustomSortPaneProps {
  pane: DrawnSortPane | null;
  timesAsked: number;
  paneRef: React.RefObject<HTMLElement | null>;
  takesNoTyping: boolean;
  paneWidth: number;
  onPaneWidthChange: (width: number) => void;
  onKeyDownInPane: (event: React.KeyboardEvent) => void;
  whatHasCaretAfter: () => HTMLElement | false;
  wasPointerPressedLast: () => boolean;
  onAct: ActInSortPane;
  onShut: () => void;
}
export function SortKeyRow(props: SortKeyRowProps) {
  let {
    sortKey,
    index,
    columns,
    isAlone,
    reorder,
    keysThatMoveSaidBy,
    onAct,
    onRemoved,
  } = props;
  let { keyId, columnId, direction, holds } = sortKey;
  let isPointerCoarse = useCoarsePointer();
  let column = columns.find((candidateColumn) => candidateColumn.columnId === columnId);
  let columnLabel = column === undefined ? '' : sortColumnLabel(column);
  let sortByWords = index === 0 ? customSortMessages.sortBy() : customSortMessages.thenBy();
  let { className: rowClassName, ...rowProps } = reorder.ofRow(keyId, index);
  let { className: handleClassName, ...handleProps } = reorder.ofHandle(keyId, index);
  return <li {...rowProps} className={`group/key py-1.5 first:pt-0 ${rowClassName}`}><span {...REORDER_LIFT_PROPS} className={`${REORDER_LIFT_PROPS.className} ${index > 0 ? 'top-[22px]' : ''}`} />{index > 0 &&
        <p className={`${isPointerCoarse ? 'ps-[calc(var(--ui-pad-lg)+40px)]' : 'ps-[calc(var(--ui-pad-lg)+32px)]'} pb-1 text-footnote text-secondary select-none ${reorder.isRowHeld ? 'invisible' : ''}`}>{sortByWords}</p>}<TooltipGroup closeDelay={0}><PaneRow {...(!isAlone && {
            trailing: (<TooltipGroup closeDelay={0}><Button variant="ghost" iconOnly icon="Minus" aria-label={removeSortColumnLabel(columnLabel)} className="text-secondary" onClick={() =>
                  reorder.gliding(
                    (onGlided: (isDone: boolean) => void) =>
                      onAct(
                        {
                          kind: 'removeKey',
                          keyId,
                        },
                        onGlided,
                      ),
                    (isGlided: boolean) => isGlided && onRemoved(index),
                  )} /></TooltipGroup>),
          })}>{!isAlone &&
              (<Tooltip content={reorderSortColumnLabel(columnLabel)} {...(reorder.areTooltipsOfHandlesShut
                  ? {
                      open: false,
                    }
                  : {})}><Button variant="ghost" {...(!isPointerCoarse && {
                    size: 'xs',
                  })} iconOnly icon={<Icon name="Reorder" size="xs" className="text-muted group-hover/key:text-primary group-has-focus-visible/key:text-primary group-data-reorder/key:text-primary touch:text-primary" />} aria-label={reorderSortColumnLabel(columnLabel)} aria-describedby={keysThatMoveSaidBy} tooltip={false} {...handleProps} {...{
                    [KEY_HANDLE_ATTRIBUTE]: keyId,
                  }} className={handleClassName} /></Tooltip>)}<div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] gap-1"><div {...{
                    [KEY_COLUMN_ATTRIBUTE]: true,
                  }} className="flex min-w-0"><PaneSelect name={labeledSortColumnWords(sortByWords, columnLabel)} value={columnId} items={columns.map(sortColumnItem)} onChange={(pickedColumnId: ColumnId) =>
                      onAct({
                        kind: 'setColumn',
                        keyId,
                        columnId: pickedColumnId,
                      })} /></div><PaneSelect name={sortOrderOfColumnLabel(columnLabel, sortDirectionWords(holds, direction))} value={direction} items={SORT_PANE_DIRECTIONS.map(
                    (directionOption) => ({
                      value: directionOption,
                      label: sortDirectionWords(holds, directionOption),
                    }),
                  )} onChange={(pickedDirection: SortDirection) =>
                    onAct({
                      kind: 'setDirection',
                      keyId,
                      direction: pickedDirection,
                    })} /></div></PaneRow></TooltipGroup></li>;
}
export function SortCellsField({ cells, cellsTyped, whyNotSaidBy, onAct }: SortCellsFieldProps) {
  return <FieldRoot invalid={whyNotSaidBy !== null} className="min-w-0 flex-1"><TextInput fullWidth className={'[&_input]:text-ellipsis'} dir="auto" aria-label={customSortMessages.cells()} aria-describedby={whyNotSaidBy ?? undefined} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={cellsTyped ?? cells} slotEnd={<PaneTableButton name={customSortMessages.useSelection()} onPressed={() =>
          onAct({
            kind: 'useSelection',
          })} />} onChange={(event) =>
        onAct({
          kind: 'typeCells',
          text: event.target.value,
        })} onBlur={({ relatedTarget, currentTarget }) => {
        if (relatedTarget !== null)
          onAct({
            kind: 'enterCells',
          });
        else
          whenBlurredToNothing(
            currentTarget,
            () =>
              onAct({
                kind: 'enterCells',
              }),
          );
      }} onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return event.stopPropagation();
        if (event.key === 'Enter') {
          event.preventDefault();
          onAct({
            kind: 'enterCells',
          });
        }
        if (event.key === 'Escape' && cellsTyped !== null) {
          event.preventDefault();
          event.stopPropagation();
          onAct({
            kind: 'dropTypedCells',
          });
        }
        return;
      }} /></FieldRoot>;
}
export const SORT_PANE_DIRECTIONS: SortDirection[] = ['ascending', 'descending'];
export const SORT_BUTTON_ATTRIBUTE = 'data-sort-button';
export const KEY_COLUMN_ATTRIBUTE = 'data-column-of-key';
export const KEY_HANDLE_ATTRIBUTE = 'data-handle-of-key';
export const sortColumnLabel = ({ heading, letters }: Pick<SortPaneColumn, 'heading' | 'letters'>): string =>
  heading === '' ? columnLettersLabel(letters) : heading;
export const sortColumnItem = (column: SortPaneColumn) =>
  column.heading === ''
    ? {
        value: column.columnId,
        label: sortColumnLabel(column),
      }
    : {
        value: column.columnId,
        label: column.heading,
        hint: column.letters,
      };
export const CustomSortPane = React.memo(function ({
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
}: CustomSortPaneProps) {
  let keyListRef = React.useRef<HTMLUListElement>(null);
  let keysThatMoveId = React.useId();
  let cellsWhyNotId = React.useId();
  let sortKeys = pane?.keys ?? [];
  let focusAfterChangeRef = React.useRef<CaretAfterKeysChange | null>(null);
  React.useLayoutEffect(() => {
    let focusAfterChange = focusAfterChangeRef.current;
    focusAfterChangeRef.current = null;
    if (focusAfterChange === null) return;
    let columnButtons = keyListRef.current?.querySelectorAll<HTMLElement>(`[${KEY_COLUMN_ATTRIBUTE}] button`);
    let focusTarget =
      typeof focusAfterChange === 'number'
        ? (columnButtons?.[focusAfterChange] ?? columnButtons?.[focusAfterChange - 1])
        : 'added' in focusAfterChange
          ? columnButtons?.[focusAfterChange.added]
          : (keyListRef.current?.querySelector<HTMLElement>(`[${KEY_HANDLE_ATTRIBUTE}="${focusAfterChange.handleOf}"]`) ?? undefined);
    focusTarget?.focus({
      preventScroll: true,
      focusVisible: !wasPointerPressedLast(),
    });
    if (focusTarget !== undefined) revealInSidePane(paneRef.current, focusTarget, true);
  });
  let reorder = useReorderRows({
    listRef: keyListRef,
    keys: sortKeys.map(({ keyId }) => keyId),
    onMoved: (keyId: number, toIndex: number, onDone: (isDone: boolean) => void) =>
      onAct(
        {
          kind: 'moveKey',
          keyId,
          toIndex,
        },
        (isDone) => {
          if (isDone)
            focusAfterChangeRef.current = {
              handleOf: keyId,
            };
          onDone(isDone);
        },
      ),
  });
  useSidePaneCaret({
    isOpen: pane !== null,
    timesAsked,
    paneRef,
    putCaretWhereToStart: () => {
      let firstColumnButton = keyListRef.current?.querySelector<HTMLElement>(`[${KEY_COLUMN_ATTRIBUTE}] button`) ?? null;
      let isByPointer = wasPointerPressedLast();
      if (firstColumnButton === null)
        focusPaneStart(paneRef.current, 'start', {
          isByPointer,
        });
      else
        firstColumnButton.focus({
          preventScroll: true,
          focusVisible: !isByPointer,
        });
    },
    whatHasCaretAfter,
  });
  if (pane === null) return null;
  let {
    cells,
    cellsTyped,
    areCellsTypedRefused,
    hasHeaderRow,
    columns,
  } = pane;
  let keyColumnIds = new Set(sortKeys.map(({ columnId }) => columnId));
  return <SidePane ref={paneRef} title={customSortMessages.customSort()} takesNoTyping={takesNoTyping} width={paneWidth} onWidthChange={onPaneWidthChange} onClose={onShut} onKeyDown={onKeyDownInPane} wasPointerPressedLast={wasPointerPressedLast}><PaneSection title={customSortMessages.appliesTo()}><PaneRow label={customSortMessages.cells()}><SortCellsField cells={cells} cellsTyped={cellsTyped} whyNotSaidBy={areCellsTypedRefused ? cellsWhyNotId : null} onAct={onAct} /></PaneRow>{areCellsTypedRefused &&
            <PaneRowNote id={cellsWhyNotId} isRefusal>{customSortMessages.cellsNotFound()}</PaneRowNote>}<LiveAnnouncer words={areCellsTypedRefused && customSortMessages.cellsNotFound()} /><PaneRow label={customSortMessages.headerRow()}><Switch size="sm" checked={hasHeaderRow} onCheckedChange={(checked) =>
                onAct({
                  kind: 'setHeaderRow',
                  isOn: checked,
                })} /></PaneRow></PaneSection><PaneSection title={customSortMessages.sortBy()} actions={<Button variant="ghost" iconOnly icon="Add" aria-label={customSortMessages.addColumn()} className="text-secondary" disabled={!pane.canAddKey} tooltip onClick={() =>
            onAct(
              {
                kind: 'addKey',
              },
              (isDone) => {
                if (isDone)
                  focusAfterChangeRef.current = {
                    added: sortKeys.length,
                  };
              },
            )} />}><ul ref={keyListRef} className="flex flex-col">{sortKeys.map(
              (sortKey, index) =>
                (<SortKeyRow key={sortKey.keyId} sortKey={sortKey} index={index} columns={columns.filter(
                      ({ columnId }) => columnId === sortKey.columnId || !keyColumnIds.has(columnId),
                    )} isAlone={sortKeys.length === 1} reorder={reorder} keysThatMoveSaidBy={keysThatMoveId} onAct={onAct} onRemoved={(removedIndex) => void (focusAfterChangeRef.current = removedIndex)} />),
            )}</ul><span id={keysThatMoveId} hidden>{customSortMessages.keysThatMove()}</span><div className="pt-1"><PaneRow><Button variant="secondary" className="w-full" disabled={!pane.canSort && !pane.isLargeEditBeingSaved} busy={pane.isLargeEditBeingSaved} busyLabel={savingChangesText()} {...{
                  [SORT_BUTTON_ATTRIBUTE]: true,
                }} onClick={() =>
                  onAct({
                    kind: 'sort',
                  })}>{customSortMessages.sortCells()}</Button></PaneRow><p className="min-h-[1lh] text-center text-footnote text-muted">{filterForWhomLabel(pane.sortsFor)}</p></div></PaneSection></SidePane>;
});
