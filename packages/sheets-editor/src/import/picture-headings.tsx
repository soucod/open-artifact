import * as React from 'react';
import { useRenameField } from './destination.tsx';
import { ColumnKindMenu, IMPORT_LINE_NUMBER_SELECTOR, LineNumberMenu, readingLabelOfColumn } from './preview-table.tsx';
import { nameOfColumnLabel } from './csv-file.tsx';
import { importPlanSoFar, openImportQuestionIds, columnsQuestionDecides } from './import-review.ts';
import { dataLineNumbers } from './column-readings.ts';
import { fileLineOfRowNumber } from './picture-lines-and-focus.ts';
import { importColumnsLeftOut } from './bring-in.ts';
import { HEADING_FORMAT_ROOM_PX, measureHeadingTextWidth } from './review-in-dialog.tsx';
import type { ImportOfAFile, ImportPreviewColumn } from '../state/initial-state.ts';
import type { ImportChangeByHand } from '../state/event-reducer.ts';
import type { GridOfPage } from '../view/page-view.ts';
/** Where a column's format stands while the agent's plan comes in, column by column. */
export type FormatInThePlay = 'hasCome' | 'isNext' | 'isToCome';
/** The part of the drawn picture of the file that its headings and row numbers are laid over. */
export type PictureUnderHeadings = Pick<GridOfPage, 'rowsDrawn' | 'body' | 'columnHeaders'>;
/** Where the picture's top left corner is, in pixels of the box around it. */
export interface PlaceOfPicture {
  left: number;
  top: number;
}
interface ImportHeadingCellProps {
  column: ImportPreviewColumn;
  open: ImportOfAFile;
  isOnlyColumn: boolean;
  isUncertain: boolean;
  isNarrow: boolean;
  formatInThePlay: FormatInThePlay | null;
  isTabStop: boolean;
  onKindsWanted: (columnIndex: number) => void;
  onChangedByHand: ((change: ImportChangeByHand) => void) | null;
}
interface ImportRowNumbersProps {
  open: ImportOfAFile;
  picture: PictureUnderHeadings;
  lastRow: number;
  place: PlaceOfPicture;
  zoom: number;
  onChangedByHand: ((change: ImportChangeByHand) => void) | null;
}
interface ImportHeadingsRowProps {
  open: ImportOfAFile;
  picture: PictureUnderHeadings;
  place: PlaceOfPicture;
  zoom: number;
  /** How many columns the agent's plan has shown so far, or null when it is not coming in. */
  columnsRevealed: number | null;
  /** Columns left out that are shown all the same. */
  columnsUnfolded: number[];
  onKindsWanted: (columnIndex: number) => void;
  onChangedByHand: (change: ImportChangeByHand) => void;
  onColumnWanted: (columnNumber: number) => void;
}
export function ImportHeadingCell({
  column,
  open,
  isOnlyColumn,
  isUncertain,
  isNarrow,
  formatInThePlay,
  isTabStop,
  onKindsWanted,
  onChangedByHand,
}: ImportHeadingCellProps) {
  let { columnIndex, name: columnName } = column;
  let nameFieldRef = React.useRef<HTMLInputElement>(null);
  let nameField = useRenameField({
    name: columnName,
    onNamed: (name: string) =>
      onChangedByHand?.({
        kind: 'column',
        columnIndex,
        name,
      }),
    onDone: (field: HTMLInputElement) => field.parentElement?.querySelector('button')?.focus(),
  });
  return <><span className="sheet-import-heading-format" data-is-uncertain={isUncertain || undefined} data-in-the-play={formatInThePlay ?? undefined}><ColumnKindMenu column={column} kinds={open.kinds[columnIndex]} isLeftOut={false} mustComeIn={isOnlyColumn} isTabStop={isTabStop} onKindsWanted={onKindsWanted} onChanged={onChangedByHand} nameField={() => nameFieldRef.current ?? undefined} showsIconAlone={isNarrow} isLeftOpen={isUncertain} /></span><input ref={nameFieldRef} className="sheet-import-heading-name" tabIndex={-1} aria-label={nameOfColumnLabel(columnName)} title={columnName} autoComplete="off" autoCorrect="off" spellCheck={false} readOnly={onChangedByHand === null} {...nameField} /></>;
}
export function rovingHeadingTabStop(headingsRow: ParentNode, focusTarget: EventTarget | null) {
  let caps = [...headingsRow.querySelectorAll<HTMLElement>(HEADING_CAP_SELECTOR)];
  let tabStopCap =
    caps.find((cap) => cap === focusTarget) ?? caps.find((cap) => cap.tabIndex === 0) ?? caps[0];
  for (let cap of caps) cap.tabIndex = cap === tabStopCap ? 0 : -1;
}
export function headingIndexForKey({ key, target }: Pick<React.KeyboardEvent, 'key' | 'target'>, columnCount: number) {
  let cap = target instanceof Element && target.matches(HEADING_CAP_SELECTOR) ? target.closest(`[${COLUMN_DRAWN_ATTRIBUTE}]`) : null;
  let columnNumber = Number(cap?.getAttribute(COLUMN_DRAWN_ATTRIBUTE) ?? Number.NaN);
  if (Number.isNaN(columnNumber)) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return columnCount - 1;
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null;
  return Math.max(0, Math.min(columnCount - 1, columnNumber + (key === 'ArrowRight' ? 1 : -1)));
}
export function ImportRowNumbers(props: ImportRowNumbersProps) {
  let { open, picture, lastRow, place, zoom, onChangedByHand } = props;
  let { plan } = importPlanSoFar(open);
  let tableRows = React.useMemo(() => dataLineNumbers(open.table, plan), [open.table, plan]);
  let headingRowNumber = picture.rowsDrawn.find(
    ({ rowNumber }) => rowNumber <= lastRow && fileLineOfRowNumber(plan.headerLine, tableRows, rowNumber) !== null,
  )?.rowNumber;
  return <div role="presentation" className="sheet-import-numbers" onKeyDownCapture={(event) => {
      let step = (
        {
          ArrowUp: -1,
          ArrowDown: 1,
        } as Partial<Record<string, number>>
      )[event.key];
      if (step === undefined || !(event.target instanceof HTMLElement)) return;
      let rowButtons = [...event.currentTarget.querySelectorAll<HTMLElement>(IMPORT_LINE_NUMBER_SELECTOR)].toSorted(
        (left, right) => Number(left.dataset.line) - Number(right.dataset.line),
      );
      let nextRowButton = rowButtons[rowButtons.indexOf(event.target) + step];
      if (!event.target.matches(IMPORT_LINE_NUMBER_SELECTOR)) return;
      event.preventDefault();
      event.stopPropagation();
      nextRowButton?.focus({
        preventScroll: true,
      });
    }} style={{
      left: place.left,
      top: place.top + picture.body.top * zoom,
      width: picture.body.left * zoom,
      height: picture.body.height * zoom,
      ...importZoomStyle(zoom),
    }}>{picture.rowsDrawn.map(({ rowNumber, top, height }) => {
      let isFirstRow = rowNumber === 1;
      let headingLine = fileLineOfRowNumber(plan.headerLine, tableRows, rowNumber);
      return headingLine === null || rowNumber > lastRow
        ? null
        : (<div key={rowNumber} className="sheet-import-number" data-is-long={rowNumber >= 1000 || undefined} data-is-frozen={isFirstRow || undefined} style={{
                top: top * zoom,
                height: height * zoom,
                ...(isFirstRow && {
                  zIndex: 1,
                }),
              }}><LineNumberMenu rowNumber={rowNumber} line={headingLine} becomes={isFirstRow ? 'names' : 'row'} isLastRow={headingLine === tableRows.at(-1)} isOnlyRow={tableRows.length === 1} isTabStop={rowNumber === headingRowNumber} onChanged={onChangedByHand} /></div>);
    })}</div>;
}
export function formatsInThePlay(
  columnIndexes: number[],
  { revealed, read }: { revealed: number | null; read: number },
): (FormatInThePlay | null)[] {
  if (revealed === null) return columnIndexes.map(() => null);
  let firstUnread = columnIndexes.find((columnPosition) => columnPosition >= revealed);
  return columnIndexes.map((columnPosition) => {
    if (columnPosition < revealed) return 'hasCome';
    return columnPosition === firstUnread && columnPosition < read ? 'isNext' : 'isToCome';
  });
}
export function ImportHeadingsRow({
  open,
  picture,
  place,
  zoom,
  columnsRevealed,
  columnsUnfolded,
  onKindsWanted,
  onChangedByHand,
  onColumnWanted,
}: ImportHeadingsRowProps) {
  let planSoFar = importPlanSoFar(open);
  let columnsShown = React.useMemo(() => {
    let { plan, preview } = importPlanSoFar(open);
    let leftOutColumns = new Set<number>(importColumnsLeftOut(open, plan));
    return preview.columns.filter(
      ({ columnIndex }) => !leftOutColumns.has(columnIndex) || columnsUnfolded.includes(columnIndex),
    );
  }, [open, columnsUnfolded]);
  let headingsRowRef = React.useRef<HTMLDivElement>(null);
  /** A column to focus once its heading is drawn. */
  let focusAfterRef = React.useRef<number | null>(null);
  React.useLayoutEffect(() => {
    if (headingsRowRef.current !== null) rovingHeadingTabStop(headingsRowRef.current, null);
    if (focusAfterRef.current === null) return;
    let capToFocus = headingCapOfColumn(headingsRowRef.current, focusAfterRef.current);
    if (capToFocus === null) return;
    focusAfterRef.current = null;
    capToFocus.focus({
      preventScroll: true,
    });
  });
  let firstRow = picture.rowsDrawn.find(({ rowNumber }) => rowNumber === 1);
  if (firstRow === undefined) return null;
  let canChangeHeadings = !planSoFar.isAwaited && columnsRevealed === null && open.agent.kind !== 'isAsked';
  let formatOfColumn = formatsInThePlay(
    columnsShown.map(({ columnIndex }) => columnIndex),
    {
      revealed: columnsRevealed,
      read: planSoFar.isAwaited ? planSoFar.columnsReadCount : planSoFar.plan.columns.length,
    },
  );
  let openQuestionIds = new Set(openImportQuestionIds(open));
  let uncertainColumns = new Set(
    planSoFar.plan.questions
      .filter(({ id }) => openQuestionIds.has(id))
      .flatMap((question) => columnsQuestionDecides(question)),
  );
  return <div ref={headingsRowRef} role="presentation" className="sheet-import-headings" style={{
      left: place.left + picture.body.left * zoom,
      top: place.top,
      width: picture.body.width * zoom,
      height: (picture.body.top + firstRow.top + firstRow.height) * zoom,
      ...headingCapsHeightStyle(picture.body.top * zoom),
      ...importZoomStyle(zoom),
    }} onKeyDownCapture={(event) => {
      let columnNumber = headingIndexForKey(event, columnsShown.length);
      if (columnNumber === null) return;
      event.preventDefault();
      event.stopPropagation();
      let cap = headingCapOfColumn(event.currentTarget, columnNumber);
      focusAfterRef.current = cap === null ? columnNumber : null;
      setTimeout(() => void (focusAfterRef.current = null), 300);
      cap?.focus({
        preventScroll: true,
      });
      onColumnWanted(columnNumber);
    }} onFocusCapture={({ currentTarget, target }) => rovingHeadingTabStop(currentTarget, target)}>{picture.columnHeaders.map(({ columnNumber, left, width }) => {
      let column = columnsShown[columnNumber - 1];
      return column === undefined
        ? null
        : (<div key={column.columnIndex} className="sheet-import-heading" style={{
                left: left * zoom,
                width: width * zoom - 1,
              }} {...{
                [COLUMN_DRAWN_ATTRIBUTE]: columnNumber - 1,
              }}><ImportHeadingCell formatInThePlay={formatOfColumn[columnNumber - 1] ?? null} column={column} open={open} isOnlyColumn={columnsShown.length - columnsUnfolded.length === 1} isUncertain={uncertainColumns.has(column.columnIndex)} isNarrow={width < HEADING_FORMAT_ROOM_PX + measureHeadingTextWidth(readingLabelOfColumn(column))} isTabStop={column === columnsShown[0]} onKindsWanted={onKindsWanted} onChangedByHand={canChangeHeadings && !columnsUnfolded.includes(column.columnIndex) ? onChangedByHand : null} /></div>);
    })}</div>;
}
export const PICTURE_ORIGIN = {
  left: 0,
  top: 0,
};
export const HEADING_CAP_SELECTOR = '.sheet-import-cap';
export const headingCapsHeightStyle = (heightPx: number) => ({
  '--sheet-import-caps-height': `${heightPx}px`,
});
export const importZoomStyle = (zoom: number) => ({
  '--sheet-import-zoom': String(zoom),
});
export const COLUMN_DRAWN_ATTRIBUTE = 'data-column-drawn';
export const headingCapOfColumn = (headingsRow: ParentNode | null, columnDrawn: number) =>
  headingsRow?.querySelector<HTMLElement>(`[${COLUMN_DRAWN_ATTRIBUTE}="${columnDrawn}"] ${HEADING_CAP_SELECTOR}`) ?? null;
