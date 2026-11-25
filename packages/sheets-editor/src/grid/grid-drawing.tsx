import { Checkbox } from '../kit/checkbox.tsx';
import { Surface } from '../kit/surface.tsx';
import { Tooltip, TooltipGroup } from '../kit/tooltip.tsx';
import * as React from 'react';
import type { ReactNode } from 'react';
import type { Mark } from '@open-artifact/sheets-core';
import type { WholeCellFormat } from '../model/cell-format.ts';
import type { LineOfAList } from '../model/cell-values.ts';
import type { CellPosition } from '../selection/model.ts';
import type { GridOfPage } from '../view/page-view.ts';
import type { FlagsHidden } from '../presence/flags-at-pointer.ts';
import type { PlacedFlag } from '../presence/flags.ts';
import type { ChipPerson, SelectionSummaryPlace } from './cards-place.ts';
import type { ChipPaints, PaintPair, StyleWithVariables, TextTintName } from './cell-drawing.tsx';
import type { CellDensity } from './cell-metrics-values.ts';
import type { TextAlignment, TextInsets } from './cell-metrics.ts';
import type { GridPoint, LinesAxisName, PaneRect } from './geometry.ts';
import type { LineKeys } from './line-keys.ts';
import type { BandOfSlide, LinesAsBefore as LinesDrawnBefore, LinesOnShow, SlideTold } from './lines-slide.ts';
import type { BorderLinesInBox } from './moved-columns.ts';
import type { LinkDrawnAs } from './text-overflow.ts';
import type { CheckboxMiddle, DrawnBox, StartAndSize } from './view-boxes.ts';
import {
  ariaIndex,
  ariaRowIndexText,
  ariaColIndexText,
  textPaintStyle,
  referenceTintStyle,
  AnnounceActiveCellContext,
  ACTIVE_CELL_ADDRESS_ID,
  SELECTION_SUMMARY_ID,
  BlankCellWordsContext,
  JUSTIFY_BY_ALIGNMENT,
  ALIGN_ITEMS_BY_VERTICAL,
  TEXT_TINT_COLORS,
  cellFontStyle,
  textMarksStyle,
  textFadeStyle,
  wrappedTextLineStyle,
  importMarkDelayStyle,
  textClearanceStyle,
  whiteOwedStyle,
  cutByViewStyle,
  fillPaintStyle,
  WordsForScreenReader,
  TextThatRunsOn,
  LinkAddressOrGithubChip,
  PeopleChips,
  CellChip,
  fadesFromRightButton,
  personChipLinesOfCell,
} from './cell-drawing.tsx';
import { jsx, Fragment } from 'react/jsx-runtime';
import { preventMouseDownDefault, IS_APPLE_PLATFORM } from '../ui/dom-events.ts';
import { sheetMessages } from '../i18n/sheet-messages.ts';
import { keyOfLine, NO_LINE_KEYS, LIST_KEY_SUFFIX } from './line-keys.ts';
import { clipBoxToShown } from './view-boxes.ts';
import {
  zoomedEditorOffset,
  zoomedEditorMargin,
  unzoomedEditorWidth,
  cellTextInsets,
  listIndentOfLevel,
  textOverflowAtSides,
} from './cell-metrics.ts';
import { rowHeightForLines, firstLineLeading, nextLineHeight } from './cell-metrics-values.ts';
import { bandClipPath, groupIndexAt, useLinesSlide, createSlideTold } from './lines-slide.ts';
import { useSheenDelayStyle, ChangeByAgentMark } from '../agent/changes-by-agent-marks.tsx';
import { NO_FLAGS_HIDDEN } from '../presence/flags-at-pointer.ts';
import { IS_IOS_BROWSER } from './cell-drawing-values.ts';
import { columnLetters } from '../model/a1-references.ts';
import { LINK_DESCRIPTION_ID, linksInTextDescriptionId, githubLinkFace, CellLinkSpan, LINK_ADDRESS_ID } from '../links/cell-links-view.tsx';
import { linkCountLabel, selectionSummaryText } from '../i18n/status-labels.ts';
import { FlagsAtRest } from '../presence/name-flags.tsx';
import { foldedFlagsCountText } from '../i18n/menu-labels.ts';
import { AgentAtWork } from '../agent/agent-at-work.tsx';
import { listAttributesOf } from '../ui/cell-list-attributes.ts';
import { checkedStateWords } from '../messages/import.ts';
import { MAX_LINKS_IN_TEXT, groupLinkParts } from '../links/text-links.ts';
import { agentFixLabel } from '../i18n/formula-fix-labels.ts';
import { checkboxCellLabel } from '../i18n/format-labels.ts';
import { flattenLineBreaks, flattenLineBreaksAcrossParts } from './text-overflow.ts';
import { levelInList } from '../model/cell-values.ts';
import { ERROR_DESCRIPTION_ID } from '../messages/formula-errors.ts';
import { turnsChipsWhite } from '../format/cell-colors.ts';
import { MENU_CARETS } from '../ui/menu-trigger.tsx';
import { flagTop } from '../presence/flags.ts';
/** Where the grid's body starts: right of the row numbers and under the column letters. */
export type BodyOrigin = Pick<PaneRect, 'left' | 'top'>;
/** A checkbox drawn in a cell: whether it is checked, where its middle is, and whether it can be changed. */
export interface CheckboxInCell extends CheckboxMiddle {
  isChecked: boolean;
  canBeChanged: boolean;
  isNamedReadOnly: boolean;
}
/** A run of a cell's text, with the link it is part of, if any, and its marks. */
export interface LinkPart {
  text: string;
  startsAt: number;
  url: string | null;
  isLinkOnWords: boolean;
  marks: readonly Mark[];
}
/** A run of a cell's text, with the text as it is drawn (line breaks flattened unless the text wraps). */
export interface PartDrawn extends LinkPart {
  drawn: string;
}
/** The runs of one line of a cell's text, and the line break run before it. */
export interface LineOfParts {
  breakBefore: PartDrawn | null;
  ofLine: PartDrawn[];
}
/** A cell as the grid draws it. */
export interface DrawnCell {
  key: string;
  rowNumber: number;
  rowNumberWritten: number;
  columnNumber: number;
  left: number;
  width: number;
  top: number;
  height: number;
  hiddenByBorderAtFoot: number;
  isBehindBars: boolean;
  mergedFromRowNumber: number | null;
  mergedRowCount: number | null;
  mergedColumnCount: number | null;
  hiddenAtLeft: number;
  hiddenAtTop: number;
  text: string;
  spokenText: string | null;
  textColor: TextTintName | null;
  opensCalendar: boolean;
  isCalendarOpen: boolean;
  pill: ChipPaints | null;
  opensDropdownList: boolean;
  isDropdownListOpen: boolean;
  comesAtKey?: true;
  opensPeopleList: boolean;
  isPeopleListOpen: boolean;
  textLeft: number;
  textWidth: number;
  isTextWrapped: boolean;
  areLinesCut: boolean;
  textLeftInWholeRow: number;
  wouldTextWrapIfToldTo: boolean;
  alignment: TextAlignment;
  isCutAtEndOnly: boolean;
  mayTextFade: boolean;
  textCutByViewAt: number | null;
  cutByViewAt: number | null;
  takenAtRight: number;
  hasTintOfFilterHeader: boolean;
  hasGroundOfFoundHeader: boolean;
  isInTable: boolean;
  isInHand: boolean;
  cornersOfTable: string | null;
  isHeadingOfTable: boolean;
  hasColorOfHeading: boolean;
  indentToCenter: number;
  linesInTextBox: readonly number[];
  hasLineAtRight: boolean;
  format: WholeCellFormat;
  isPerson: boolean;
  checkbox: CheckboxInCell | null;
  avatarUrl: string | null;
  otherPeople: readonly ChipPerson[];
  linkUrl: string | null;
  linkDrawnAs: LinkDrawnAs | null;
  linkCellKey: string | null;
  partsWithLinks: readonly LinkPart[];
  listLines: readonly LineOfAList[];
  paints: ChipPaints;
  frozenBy: 'both' | 'row' | 'column' | null;
  isActive: boolean;
  elementId: string | null;
  isSaidToHaveComment: boolean;
  isSelected: boolean;
  isError: boolean;
  looksLikeError: boolean;
  isErrorMuted: boolean;
  isFormulaOfFix: boolean;
  shownForFixThatWaits: string | null;
  areKeysForFix: boolean;
  markOfImport: 'added' | 'updated' | null;
  markOfImportDelayMs: number;
}
/** A row as the grid draws it, with its number in the margin and its cells. */
export interface DrawnRow {
  key: string;
  headerText: string;
  rowNumber: number;
  top: number;
  height: number;
  outOfViewAbove: number;
  outOfViewBelow: number;
  isActive: boolean;
  isFrozen: boolean;
  isNumberBehindBars: boolean;
  isBehindBars: boolean;
  cells: DrawnCell[];
}
/** A column letter as the grid draws it. */
export interface ColumnHeaderDrawn {
  key: string;
  text: string;
  columnNumber: number;
  left: number;
  width: number;
  isActive: boolean;
  isFrozen: boolean;
}
/** A cell drawn as it was before a change by the agent, kept over the cell until the change comes in. */
export interface CellAsBefore {
  keyOfMark: string;
  revision: number;
  rowKey: string;
  goesAfterMs: number;
  cell: DrawnCell;
}
/** The line at the end of the frozen rows or columns: where it is, how long it is, and whether cells scrolled under it. */
export interface EndOfFrozen {
  at: number;
  length: number;
  isOverCells: boolean;
}
/** How far a box is clipped in from each of its sides. */
export interface ClipInset {
  top: number;
  right: number;
  bottom: number;
  left: number;
}
/** What border lines are drawn with: the body they are placed in, and the lines in their boxes. */
export interface GridOfBorderLines {
  body: BodyOrigin;
  borderLines: readonly BorderLinesInBox[];
}
/** What of the drawn grid the lines drawn before a slide are drawn from. */
export interface DrawnGrid extends GridOfBorderLines {
  rows: readonly DrawnRow[];
  columnHeaders: readonly ColumnHeaderDrawn[];
  density: CellDensity;
}
/** A grid drawn plain, with no selection, marks or controls on it. */
export interface PlainGrid extends GridOfBorderLines {
  columnHeaders: readonly ColumnHeaderDrawn[];
  rowsDrawn: readonly DrawnRow[];
  density: CellDensity;
  endOfFrozenRows: EndOfFrozen | null;
  endOfFrozenColumns: EndOfFrozen | null;
}
/** A box outlined on the grid, by its key. */
export interface OutlinedBox {
  key: string;
  box: DrawnBox;
}
/** A box of cells a link to cells lights up, by its key. */
export interface BoxLitByLink {
  key: string;
  box: DrawnBox;
}
/** The outline of a table, and the header kept in sight it is drawn over, if any. */
export interface TableOutlineDrawn extends DrawnBox {
  overHeader: string | null;
  isOfFormula?: boolean;
}
/** A mark over cells a reference in the entry points at. */
export interface ReferenceMark {
  cells: string;
  box: DrawnBox;
  hue: string;
  leavesTextAsItIs: boolean;
  arrivesAtPart: number | null;
}
/** The wash over cells with a comment. */
export interface CommentMark extends DrawnBox {
  key: string;
  isOpen: boolean;
  isPointedAt: boolean;
  isWithAgent: boolean;
}
/** Where the entry stops filling its line and folds onto the next. */
export interface EntryFold {
  width: number;
  isLineFolded: boolean;
}
/** How many lines the entry takes, where it folds, and how far it is zoomed. */
export interface EntryLines {
  lineCount: number;
  foldsAt: EntryFold | null;
  scale?: number;
}
/** A box that fades out at its left edge. */
export interface FadingBox extends PaneRect {
  fade: number;
}
/** The ground under a filter button held over a column. */
export interface GroundUnderButton {
  left: number;
  width: number;
  ground: string | PaintPair | null;
}
/** Filter buttons held over the columns of a table, and the grounds of the columns under them. */
export interface ButtonGroundsHeld {
  box: FadingBox;
  grounds: readonly GroundUnderButton[];
}
/** A part of a header kept in sight, in one pane of columns, and whether it goes on past the pane. */
export interface KeptHeaderPart {
  startOfPane: number;
  left: number;
  width: number;
  goesOnAtLeft: boolean;
  goesOnAtRight: boolean;
}
/** What of a header kept in sight at the top of the grid is drawn. */
export interface KeptHeaderDrawn {
  key: string;
  top: number;
  height: number;
  leavesBy: number;
  parts: readonly KeptHeaderPart[];
  areRowNumbersItsOwn: boolean;
  isOfFoundTable: boolean;
  rows: readonly DrawnRow[];
  borderLines: readonly BorderLinesInBox[];
  selectionBoxes: readonly OutlinedBox[];
  marksOfReferences: readonly ReferenceMark[];
  groundsOfButtonsHeld: readonly ButtonGroundsHeld[];
}
export interface CellCheckboxProps {
  checkbox: CheckboxInCell;
}
export interface GridRowProps {
  row: DrawnRow;
  body: BodyOrigin;
  density: CellDensity;
  cellsAsBefore: readonly CellAsBefore[];
  isNumberUnderHandle?: boolean;
  arePlacesHeld?: boolean;
  isNamed?: boolean;
  keysOfColumns?: LineKeys;
}
export interface ColumnHeaderRowProps {
  columnHeaders: readonly ColumnHeaderDrawn[];
  body: BodyOrigin;
  keysOfColumns?: LineKeys;
}
export interface EndOfFrozenLinesProps {
  isOf: LinesAxisName;
  end: EndOfFrozen | null;
  crossedBy?: EndOfFrozen | null;
  isHeld: boolean;
  body: BodyOrigin;
}
export interface FreezeBarProps {
  isOf: LinesAxisName;
  bar: StartAndSize;
  isHeld: boolean;
  body: BodyOrigin;
}
export interface BorderLinesInBandsProps {
  grid: GridOfBorderLines;
  axis: LinesAxisName;
  bands: readonly BandOfSlide[];
  asBefore?: LinesDrawnBefore<DrawnGrid>;
}
export interface BorderLinesOfSlideProps {
  grid: GridOfBorderLines;
  slideTold: SlideTold;
}
export interface LinesAsBeforeProps {
  grid: DrawnGrid;
  linesOnShow: LinesOnShow | null;
  slideTold: SlideTold;
}
export interface BorderLinesProps {
  grid: GridOfBorderLines;
}
export interface CellsLitByLinkProps {
  boxes: readonly BoxLitByLink[];
  body: BodyOrigin;
}
export interface ReferenceMarksProps {
  marks: readonly ReferenceMark[];
  body: BodyOrigin;
}
export interface CommentWashProps {
  mark: CommentMark;
  body: BodyOrigin;
}
export interface HeaderKeptProps {
  kept: KeptHeaderDrawn;
  body: PaneRect;
  density: CellDensity;
  marks: readonly OutlinedBox[];
  tableOutline: TableOutlineDrawn | null;
  endOfFrozenColumns: EndOfFrozen | null;
  rowNumberUnderHandle: number | null;
}
export interface PlainGridDrawingProps {
  grid: PlainGrid;
}
export interface GridDrawingProps {
  grid: GridOfPage;
  cornerOnTop?: string | null;
  cornersCalledUp?: readonly string[];
  flagsHidden?: FlagsHidden;
  cellsAsBefore?: readonly CellAsBefore[];
  rowNumberUnderHandle?: number | null;
  areRowsNamed?: boolean;
  arePlacesHeld?: boolean;
  rows?: readonly DrawnRow[];
  keysOfColumns?: LineKeys;
  linesOnShow?: LinesOnShow | null;
}
export interface CheckboxOfLineProps {
  isChecked: boolean;
}
export interface LineInCellProps {
  line: number;
  drawnBefore?: LineOfAList;
  whereCut: StyleWithVariables | null;
  children: ReactNode;
}
export interface GridCellProps extends Omit<DrawnCell, 'key'> {
  bodyLeft: number;
  density: CellDensity;
}
export interface AriaPlaceKeeperProps {
  role: 'rowheader' | 'gridcell';
}
export interface FilterButtonGroundProps extends ButtonGroundsHeld {
  body: BodyOrigin;
}
export interface RowsDrawingProps {
  rows: readonly DrawnRow[];
  body: BodyOrigin;
  density: CellDensity;
}
export interface CopiedRowsDrawingProps extends RowsDrawingProps {
  borderLines: readonly BorderLinesInBox[] | null;
}
export interface RidingRowsDrawingProps extends RowsDrawingProps {
  borderLines: readonly BorderLinesInBox[];
}
export function cellPositionOfElement(element: Element): CellPosition | null {
  let cellElement = element.closest('[role="gridcell"]');
  let indexTexts = [
    cellElement?.getAttribute('aria-rowindex') ?? cellElement?.closest('[role="row"]')?.getAttribute('aria-rowindex'),
    cellElement?.getAttribute('aria-colindex'),
  ];
  let [rowIndex = Number.NaN, columnIndex = Number.NaN] = indexTexts.map(
    (indexText) => Number(indexText ?? undefined) - ariaIndex(1),
  );
  return Number.isNaN(rowIndex) || Number.isNaN(columnIndex)
    ? null
    : {
        rowIndex,
        columnIndex,
      };
}
export function CellCheckbox({ checkbox }: CellCheckboxProps) {
  let { isChecked, middleFromLeft, middleFromTop, canBeChanged } = checkbox;
  return <span role="presentation" aria-hidden className="sheet-checkbox" onMouseDown={preventMouseDownDefault} data-can-be-changed={canBeChanged || undefined} style={{
      left: middleFromLeft,
      top: middleFromTop,
    }}><Checkbox checked={isChecked} animated tabIndex={-1} aria-label={sheetMessages.checkboxCells()} /></span>;
}
export function areCellPropsEqual(before: GridCellProps, after: GridCellProps): boolean {
  return (
    before.partsWithLinks.length === after.partsWithLinks.length &&
    before.partsWithLinks.every((part, index) => isSameLinkPart(part, after.partsWithLinks[index])) &&
    before.linesInTextBox.length === after.linesInTextBox.length &&
    before.linesInTextBox.every((line, index) => line === after.linesInTextBox[index]) &&
    before.otherPeople.length === after.otherPeople.length &&
    before.otherPeople.every((person, index) => isSamePerson(person, after.otherPeople[index])) &&
    (before.checkbox === null || after.checkbox === null
      ? before.checkbox === after.checkbox
      : shallowEqualExcept(before.checkbox, after.checkbox)) &&
    shallowEqualExcept(before, after, ['linesInTextBox', 'otherPeople', 'checkbox', 'partsWithLinks'])
  );
}
export function partsByLine(parts: readonly PartDrawn[]): LineOfParts[] {
  let lines: LineOfParts[] = [
    {
      breakBefore: null,
      ofLine: [],
    },
  ];
  for (let part of parts)
    if (part.text === '\n')
      lines.push({
        breakBefore: part,
        ofLine: [],
      });
    else lines.at(-1)?.ofLine.push(part);
  return lines;
}
export function GridRow(props: GridRowProps) {
  let { row, body, density, cellsAsBefore, isNumberUnderHandle } = props;
  let arePlacesHeld = props.arePlacesHeld === true && !row.isBehindBars;
  return <div role="row" aria-hidden={row.isBehindBars || undefined} aria-rowindex={ariaIndex(row.rowNumber)} {...ariaRowIndexText(row.headerText)} aria-label={props.isNamed === true ? row.headerText : undefined} className="sheet-row" data-row={row.key} style={{
      top: body.top + row.top,
      height: row.height,
    }}>{arePlacesHeld &&
        row.isNumberBehindBars &&
        <AriaPlaceKeeper role="rowheader" />}<div role="rowheader" aria-hidden={row.isNumberBehindBars || undefined} aria-colindex={1} {...ariaRowIndexText(row.headerText)} className={row.isActive ? 'sheet-row-header is-active' : 'sheet-row-header'} data-is-frozen={row.isFrozen || undefined} data-is-under-handle={isNumberUnderHandle === true || undefined} style={{
          width: body.left,
          paddingTop: row.outOfViewAbove,
          paddingBottom: row.outOfViewBelow,
        }}>{row.headerText}</div>{row.cells
        .filter(({ cornersOfTable }) => cornersOfTable !== null)
        .map(
          ({
            key,
            left,
            width,
            top,
            height,
            frozenBy,
            hiddenAtLeft,
            hiddenAtTop,
          }) =>
            (<div key={`under ${key}`} aria-hidden className="sheet-under-corner-of-table" data-frozen-by={frozenBy ?? undefined} style={{
                  left: body.left + left,
                  width,
                  top,
                  height,
                  ...clipInsetStyle({
                    left: hiddenAtLeft,
                    top: hiddenAtTop,
                    right: 0,
                    bottom: 0,
                  }),
                }} />),
        )}{row.cells.flatMap(
        ({ key, ...cell }) => [
          arePlacesHeld &&
            cell.isBehindBars &&
            <AriaPlaceKeeper key={`${key}-held`} role="gridcell" />,
          (<GridCell key={keyOfLine(
              key,
              props.keysOfColumns ?? NO_LINE_KEYS,
              cell.opensDropdownList || cell.opensPeopleList || cell.opensCalendar ? LIST_KEY_SUFFIX : undefined,
            )} bodyLeft={body.left} density={density} {...cell} />),
        ],
      )}{cellsAsBefore.map(({ keyOfMark, goesAfterMs, cell: { key: cellKey, ...cellBefore } }) => {
        let cellNow = row.cells.find((cell) => cell.key === cellKey);
        return (
          cellNow !== undefined &&
          <div key={`${cellKey} ${keyOfMark}`} aria-hidden inert className="sheet-cell-as-before" data-mark={keyOfMark} data-goes-after-ms={goesAfterMs}><GridCell bodyLeft={body.left} density={density} {...cellBefore} elementId={null} isActive={cellNow.isActive} left={cellNow.left} width={cellNow.width} top={cellNow.top} height={cellNow.height} frozenBy={cellNow.frozenBy} textLeft={cellNow.left + (cellBefore.textLeft - cellBefore.left)} textWidth={cellNow.width + (cellBefore.textWidth - cellBefore.width)} /></div>
        );
      })}</div>;
}
export function ColumnHeaderRow(props: ColumnHeaderRowProps) {
  let { columnHeaders, body, keysOfColumns = NO_LINE_KEYS } = props;
  return <div role="row" aria-rowindex={1} className="sheet-header-row" style={{
      height: body.top,
    }}><div role="columnheader" aria-colindex={1} className="sheet-corner" style={{
          width: body.left,
        }}><span className="sr-only">{sheetMessages.rowNumbers()}</span></div>{columnHeaders.map(
        ({ key, text, columnNumber, left, width, isActive, isFrozen }) =>
          (<div key={keyOfLine(key, keysOfColumns)} role="columnheader" aria-colindex={ariaIndex(columnNumber)} {...ariaColIndexText(text)} className={isActive ? 'sheet-column-header is-active' : 'sheet-column-header'} data-is-frozen={isFrozen || undefined} style={{
                left: body.left + left,
                width,
              }}>{text}</div>),
      )}</div>;
}
export function EndOfFrozenLines(props: EndOfFrozenLinesProps) {
  let { isOf, end, crossedBy = null, isHeld, body } = props;
  if (end === null) return null;
  let gapStyle =
    crossedBy === null
      ? {}
      : {
          '--sheet-gap-in-line-at': `${crossedBy.at - 1}px`,
        };
  let [lineBox, shadowBox] =
    isOf === 'rows'
      ? [
          {
            top: body.top + end.at,
            left: body.left,
            width: end.length,
          },
          {
            top: body.top + end.at,
            left: 0,
            width: body.left,
          },
        ]
      : [
          {
            left: body.left + end.at,
            top: body.top,
            height: end.length,
          },
          {
            left: body.left + end.at,
            top: 0,
            height: body.top,
          },
        ];
  return <><div aria-hidden className="sheet-end-of-frozen" data-is-of={isOf} data-is-over-cells={end.isOverCells || undefined} data-is-held={isHeld || undefined} data-has-gap={crossedBy !== null || undefined} style={{
          ...lineBox,
          ...gapStyle,
        }} /><div aria-hidden className="sheet-end-of-frozen" data-is-of={isOf} data-is-on-headers data-is-over-cells={end.isOverCells || undefined} data-is-held={isHeld || undefined} style={shadowBox} /></>;
}
export function FreezeBar(props: FreezeBarProps) {
  let { isOf, bar, isHeld, body } = props;
  return <Tooltip content={isOf === 'rows' ? sheetMessages.dragToSetFrozenRows() : sheetMessages.dragToSetFrozenColumns()} side={isOf === 'rows' ? 'right' : 'bottom'} {...(isHeld
      ? {
          open: false,
        }
      : {})}><div aria-hidden className="sheet-freeze-bar" data-is-of={isOf} data-is-in-corner={bar.start < 0 || undefined} data-is-held={isHeld || undefined} style={isOf === 'rows'
          ? {
              top: body.top + bar.start,
              height: bar.size,
              width: body.left,
            }
          : {
              left: body.left + bar.start,
              width: bar.size,
              height: body.top,
            }} /></Tooltip>;
}
export function boxWithGridline(box: PaneRect): PaneRect {
  let overlap = gridlineOverlap(box);
  return {
    left: box.left - overlap.x,
    top: box.top - overlap.y,
    width: box.width + overlap.x,
    height: box.height + overlap.y,
  };
}
export function activeCellCutoutPath(activeCellBox: DrawnBox, body: BodyOrigin): string {
  let {
    left,
    top,
    width,
    height,
  } = boxInBody(
    clipBoxToShown({
      ...boxWithGridline(activeCellBox),
      showsIn: activeCellBox.showsIn,
    }),
    body,
  );
  let [leftPx, topPx] = [Math.floor(left), Math.floor(top)];
  let [rightPx, bottomPx] = [Math.ceil(left + width), Math.ceil(top + height)];
  return `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${`${leftPx}px ${topPx}px, ${rightPx}px ${topPx}px, ${rightPx}px ${bottomPx}px, ${leftPx}px ${bottomPx}px, ${leftPx}px ${topPx}px`})`;
}
export function hiddenInsetOfBox({ left, top, showsIn }: DrawnBox, overlap: GridPoint): Pick<ClipInset, 'left' | 'top'> {
  let [hiddenLeft, hiddenTop] = [showsIn.left - left, showsIn.top - top];
  return {
    left: hiddenLeft > 0 ? hiddenLeft + overlap.x : 0,
    top: hiddenTop > 0 ? hiddenTop + overlap.y : 0,
  };
}
export function entryShiftIntoView(box: DrawnBox, scale: number): GridPoint {
  return {
    x: Math.max(0, Math.min(zoomedEditorOffset(scale, 'along'), box.left - box.showsIn.left)),
    y: Math.max(0, Math.min(zoomedEditorOffset(scale, 'down'), box.top - box.showsIn.top)),
  };
}
export function entryGridlineOverlap(box: DrawnBox, scale: number): GridPoint {
  let { x: shiftX, y: shiftY } = entryShiftIntoView(box, scale);
  return gridlineOverlap({
    ...box,
    left: box.left - shiftX,
    top: box.top - shiftY,
  });
}
export function cellEntryBoxStyle(
  box: DrawnBox,
  body: PaneRect,
  { font, alignment }: Pick<WholeCellFormat, 'font' | 'alignment'>,
  keepsClear: TextInsets,
  { lineCount, foldsAt, scale = 1 }: EntryLines = {
    lineCount: 1,
    foldsAt: null,
  },
) {
  let marginAlong = zoomedEditorMargin(scale, 'along');
  let marginDown = zoomedEditorMargin(scale, 'down');
  let { x: shiftX, y: shiftY } = entryShiftIntoView(box, scale);
  let { width: outlineWidth, ...outlineBox } = outlineBoxInBody(
    {
      ...box,
      left: box.left - shiftX,
      top: box.top - shiftY,
    },
    body,
  );
  let lineOverlap = entryGridlineOverlap(box, scale);
  let widthToFill = Math.max(box.width, unzoomedEditorWidth(body.width - box.left + shiftX, scale, 'along'));
  let widestWidth = (foldsAt?.width ?? widthToFill) + lineOverlap.x;
  let { over: clearOver, under: clearUnder, left: clearLeft, right: clearRight } = keepsClear;
  let isOneLineRowZoomed = marginAlong > 0 && lineCount > 1 && box.height <= rowHeightForLines(1, font.size, keepsClear);
  let linesInRow = isOneLineRowZoomed ? 1 : lineCount;
  let spareHeight = box.height - rowHeightForLines(linesInRow, font.size, keepsClear);
  let roomToAlignIn = linesInRow > 1 ? Math.max(0, spareHeight) : spareHeight;
  let alignShift =
    (scale > 1 && roomToAlignIn < 0
      ? 0.5
      : {
          top: 0,
          center: 0.5,
          bottom: 1,
        }[alignment.vertical]) * roomToAlignIn;
  let lineLeading = marginDown + firstLineLeading(font.size);
  let zoomedLeading = isOneLineRowZoomed ? lineLeading : 0;
  let hiddenInset = hiddenInsetOfBox(box, lineOverlap);
  let [clipTop, clipLeft] = [hiddenInset.top, hiddenInset.left].map((hidden) => (hidden > 0 ? hidden / scale : -ENTRY_CLIP_OVERSHOOT));
  return {
    ...outlineBox,
    height: outlineBox.height + 2 * marginDown,
    minWidth: (foldsAt?.isLineFolded === true ? widestWidth : outlineWidth) + 2 * marginAlong,
    maxWidth: widestWidth + 2 * marginAlong,
    paddingTop: lineOverlap.y + (clearOver - ENTRY_TEXT_NUDGE) + alignShift + lineLeading - zoomedLeading + (marginAlong > 0 ? ENTRY_TEXT_NUDGE : 0),
    paddingBottom: clearUnder - ENTRY_TEXT_NUDGE + roomToAlignIn - alignShift + lineLeading - zoomedLeading,
    ...(zoomedLeading > 0 && {
      lineHeightInPixels: nextLineHeight(font.size) + 2 * zoomedLeading,
    }),
    ...(hiddenInset.top + hiddenInset.left > 0 && {
      clipPath: `inset(${clipTop}px ${-ENTRY_CLIP_OVERSHOOT}px ${-ENTRY_CLIP_OVERSHOOT}px ${clipLeft}px)`,
    }),
    '--sheet-clear-left-of-text': `${clearLeft}px`,
    '--sheet-clear-right-of-text': `${clearRight}px`,
    ...(scale > 1 && {
      '--sheet-entry-scale': String(scale),
    }),
  };
}
export function zoomedEntryBox(box: DrawnBox, body: BodyOrigin, scale: number): PaneRect {
  let { x: shiftX, y: shiftY } = entryShiftIntoView(box, scale);
  return {
    left: body.left + box.left - shiftX,
    top: body.top + box.top - shiftY,
    width: (box.width + 2 * zoomedEditorMargin(scale, 'along')) * scale,
    height: (box.height + 2 * zoomedEditorMargin(scale, 'down')) * scale,
  };
}
export function BorderLinesInBands(props: BorderLinesInBandsProps) {
  let { grid, axis, bands, asBefore } = props;
  if (grid.borderLines.every(({ lines }) => lines.length === 0)) return null;
  let bodyStart = axis === 'rows' ? grid.body.top : grid.body.left;
  return bands.map(
    (band) =>
      <div key={band.start} data-band className="sheet-band-of-border-lines" style={{
            clipPath: bandClipPath(axis, bodyStart, band),
            zIndex: asBefore === undefined ? undefined : 3 * groupIndexAt(asBefore, band.start) + 1,
          }}><BorderLines grid={grid} /></div>,
  );
}
export function BorderLinesOfSlide(props: BorderLinesOfSlideProps) {
  let { grid, slideTold } = props;
  let slide = React.useSyncExternalStore(slideTold.subscribe, slideTold.now, slideTold.now);
  if (slide === null)
    return <BorderLines grid={grid} />;
  return <BorderLinesInBands grid={grid} axis={slide.axis} bands={slide.bandsNow} />;
}
export function endOfLinesDrawn(grid: Pick<DrawnGrid, 'body' | 'rows' | 'columnHeaders'> | null, axis: LinesAxisName): number {
  if (grid === null) return 0;
  let [lastColumn, lastRow] = [grid.columnHeaders.at(-1), grid.rows.at(-1)];
  return axis === 'columns'
    ? grid.body.left + (lastColumn === undefined ? 0 : lastColumn.left + lastColumn.width)
    : grid.body.top + (lastRow === undefined ? 0 : lastRow.top + lastRow.height);
}
export function LinesAsBefore(props: LinesAsBeforeProps) {
  let { grid } = props;
  let [asBefore, ref] = useLinesSlide({
    grid,
    lines: props.linesOnShow,
    slideTold: props.slideTold,
  });
  return <div ref={ref} aria-hidden inert className="sheet-lines-as-before" data-is-of={asBefore.slide?.axis}>{asBefore.groups.map(
        ({ by, rows }, index) =>
          (<div key={rows[0]?.key} className="sheet-lines-that-go" data-goes-by={by} style={{
                zIndex: 3 * index,
              }}>{asBefore.columnHeaders.length > 0 &&
                  (<ColumnHeaderRow columnHeaders={asBefore.columnHeaders.map(
                      (header) => ({
                        ...header,
                        isActive: false,
                      }),
                    )} body={grid.body} />)}{rows.map(
                  (row) =>
                    (<GridRow key={row.key} row={{
                          ...row,
                          isActive: false,
                          cells: row.cells.map(
                            (cell) => ({
                              ...cell,
                              elementId: null,
                            }),
                          ),
                        }} body={grid.body} density={grid.density} cellsAsBefore={NO_CELLS_AS_BEFORE} />),
                )}</div>),
      )}{asBefore.slide !== null &&
        asBefore.grid !== null &&
        <BorderLinesInBands grid={asBefore.grid} axis={asBefore.slide.axis} bands={asBefore.slide.bandsAsBefore} asBefore={asBefore} />}{asBefore.veils.map(
        ({ start, size, by }) =>
          (<div key={start} className="sheet-veil-over-lines-that-go" data-goes-by={by} style={{
                zIndex: 3 * groupIndexAt(asBefore, start) + 2,
                ...(asBefore.slide?.axis === 'rows'
                  ? {
                      top: grid.body.top + start,
                      height: size,
                      left: 0,
                      width: endOfLinesDrawn(asBefore.grid, 'columns'),
                    }
                  : {
                      left: grid.body.left + start,
                      width: size,
                      top: 0,
                      height: endOfLinesDrawn(asBefore.grid, 'rows'),
                    }),
              }} />),
      )}</div>;
}
export function BorderLines({ grid }: BorderLinesProps) {
  let { body: bodyOrigin, borderLines: linesInBoxes } = grid;
  return linesInBoxes.map(
    ({ key, box, lines }) =>
      <svg key={key} aria-hidden className="sheet-border-lines" style={boxInBody(box, bodyOrigin)}>{lines.map(
            ({ key: lineKey, path, strokeWidth, dashes, paint }) =>
              <path key={lineKey} d={path} strokeWidth={strokeWidth} strokeDasharray={dashes ?? undefined} data-has-text-paint={paint !== null || undefined} style={textPaintStyle(paint)} />,
          )}</svg>,
  );
}
export function CellsLitByLink({ boxes, body }: CellsLitByLinkProps) {
  let maskId = React.useId();
  return <><svg aria-hidden className="sheet-veil-round-cells-lit" style={body}><mask id={maskId}><rect width="100%" height="100%" fill="white" />{boxes.map(({ key, box }) => {
            let { left, top, width, height } = clipBoxToShown(box);
            return <rect key={key} x={left} y={top} width={width} height={height} />;
          })}</mask><rect width="100%" height="100%" mask={`url(#${maskId})`} /></svg>{boxes.map(({ key, box }) =>
        <div key={key} aria-hidden className="sheet-cells-lit-by-link" style={clippedBoxStyle(box, body)} />,
    )}</>;
}
export function ReferenceMarks({ marks, body }: ReferenceMarksProps) {
  return marks.map(({ cells, box, hue, leavesTextAsItIs, arrivesAtPart }) => {
    let markStyle = {
      ...clippedBoxStyle(box, body),
      ...referenceTintStyle(hue),
      ...(arrivesAtPart !== null && {
        '--sheet-part-of-arrival': String(arrivesAtPart),
      }),
    };
    let arrives = arrivesAtPart !== null || undefined;
    return <React.Fragment key={cells}>{!leavesTextAsItIs &&
            <div aria-hidden className="sheet-text-under-mark-of-reference" data-arrives={arrives} style={markStyle} />}<div aria-hidden className="sheet-mark-of-reference" data-arrives={arrives} style={markStyle} /></React.Fragment>;
  });
}
export function CommentWash({
  mark: { key, isOpen, isPointedAt, isWithAgent, ...box },
  body,
}: CommentWashProps) {
  return <div aria-hidden className="sheet-comment-wash" data-is-open={isOpen} data-is-comment-pointed-at={isPointedAt || undefined} data-is-with-agent={isWithAgent || undefined} {...{
      [COMMENT_LAYER_ATTR]: key,
    }} style={{
      ...useSheenDelayStyle(isWithAgent),
      ...clippedBoxStyle(box, body),
    }} />;
}
export function HeaderKept({
  kept,
  body,
  density,
  marks,
  tableOutline,
  endOfFrozenColumns,
  rowNumberUnderHandle,
}: HeaderKeptProps) {
  let top = body.top + kept.top;
  let bottom = kept.top + kept.height;
  let [firstPart] = kept.parts;
  let isUnderFrozenColumns =
    endOfFrozenColumns !== null &&
    kept.parts.some(({ left, width }) => left < endOfFrozenColumns.at && left + width >= endOfFrozenColumns.at);
  let keptCellsDrawn = (shiftLeft: number, rows: readonly DrawnRow[], ring: ReactNode | null) =>
    <div className="sheet-header-kept-cells" inert style={{
        left: -shiftLeft,
        top: -top - kept.leavesBy,
        width: body.left + body.width,
      }}>{rows.map(
          (keptRow) =>
            <GridRow key={keptRow.key} row={keptRow} body={body} density={density} cellsAsBefore={NO_CELLS_AS_BEFORE} isNumberUnderHandle={keptRow.rowNumber === rowNumberUnderHandle} />,
        )}{ring !== null &&
          kept.groundsOfButtonsHeld.map(
            ({ box, grounds }) =>
              <FilterButtonGround key={box.left} box={box} grounds={grounds} body={body} />,
          )}{ring}<BorderLines grid={{
            body,
            borderLines: kept.borderLines,
          }} /><ReferenceMarks marks={kept.marksOfReferences} body={body} />{kept.selectionBoxes.map(
          ({ key, box }) =>
            <div key={key} className="sheet-selection" style={clippedBoxStyle(box, body)} />,
        )}</div>;
  return <div aria-hidden>{kept.parts.map((part, partIndex) => {
        let partLeft = body.left + part.left;
        let partBox = {
          left: partLeft,
          top,
          width: part.width,
          height: kept.height,
        };
        let hasEdgeAtLeft = !part.goesOnAtLeft && part.left !== endOfFrozenColumns?.at;
        let shadowReach =
          partIndex > 0 || endOfFrozenColumns === null || part.left < endOfFrozenColumns.at
            ? HEADER_KEPT_SHADOW
            : Math.min(HEADER_KEPT_SHADOW, part.left - endOfFrozenColumns.at);
        let ring = (<div className="sheet-ring-of-header-kept" data-is-of-found-table={kept.isOfFoundTable || undefined} style={{
            left: partLeft,
            top: top + kept.leavesBy,
            width: part.width - (part.goesOnAtRight ? 0 : 1),
            height: kept.height - 1,
            clipPath: `inset(0 ${part.goesOnAtRight ? 0 : -1}px -1px ${hasEdgeAtLeft ? -1 : 0}px)`,
          }} />);
        let edgeWidth = hasEdgeAtLeft ? 1 : 0;
        return (<React.Fragment key={part.startOfPane}><div className="sheet-shadow-of-header-kept" style={{
                  ...partBox,
                  clipPath: `inset(0 ${-HEADER_KEPT_SHADOW}px ${-HEADER_KEPT_SHADOW}px ${-shadowReach}px)`,
                }} /><div className="sheet-header-kept" style={{
                  ...partBox,
                  left: partLeft - edgeWidth,
                  width: part.width + edgeWidth,
                }}>{keptCellsDrawn(partLeft - edgeWidth, kept.rows, ring)}</div></React.Fragment>);
      })}{isUnderFrozenColumns &&
        (<div className="sheet-end-of-frozen" data-is-of="columns" data-is-over-header-kept data-is-over-cells={endOfFrozenColumns!.isOverCells || undefined} style={{
            left: body.left + endOfFrozenColumns!.at,
            top,
            height: kept.height,
          }} />)}{tableOutline?.overHeader === kept.key &&
        (<div className="sheet-table-outline" data-is-of-formula={tableOutline.isOfFormula} data-is-over-header-kept style={clippedBoxStyle(
            {
              ...tableOutline,
              showsIn: {
                ...tableOutline.showsIn,
                height: bottom - tableOutline.showsIn.top,
              },
            },
            body,
          )} />)}{marks
        .filter(({ box }) => box.top >= bottom && box.top < bottom + 1)
        .map(({ key, box }) => {
          let { left: outlineLeft, width: outlineWidth } = outlineBoxInBody(box, body);
          let markLeft = box.left < box.showsIn.left ? body.left + box.showsIn.left : outlineLeft;
          let markRight = Math.min(outlineLeft + outlineWidth, body.left + box.showsIn.left + box.showsIn.width);
          let markTop = box.top - 1;
          return (<div key={key} className="sheet-mark-over-header-kept" style={{
                left: markLeft,
                top: body.top + markTop,
                width: Math.max(0, markRight - markLeft),
                height: bottom - markTop,
              }} />);
        })}{kept.areRowNumbersItsOwn &&
        (<div className="sheet-header-kept" data-is-on-headers style={{
            left: 0,
            top,
            width: body.left,
            height: kept.height,
          }}>{keptCellsDrawn(
            0,
            kept.rows.map(
              (row) => ({
                ...row,
                cells: [],
              }),
            ),
            null,
          )}</div>)}{kept.areRowNumbersItsOwn &&
        firstPart?.left === 0 &&
        !firstPart.goesOnAtLeft &&
        (<><div className="sheet-shadow-of-header-kept" data-is-over-headers style={{
                left: body.left,
                top,
                width: firstPart.width,
                height: kept.height,
                clipPath: `inset(0 100% ${-HEADER_KEPT_SHADOW}px ${-HEADER_KEPT_SHADOW}px)`,
              }} /><div className="sheet-ring-of-header-kept" data-is-of-found-table={kept.isOfFoundTable || undefined} data-is-over-headers style={{
                left: body.left,
                top,
                width: firstPart.width,
                height: kept.height - 1,
                clipPath: 'inset(0 100% -1px -1px)',
              }} /></>)}</div>;
}
export function PlainGridDrawing({ grid }: PlainGridDrawingProps) {
  let { body } = grid;
  return <><ColumnHeaderRow columnHeaders={grid.columnHeaders.map(
          (header) => ({
            ...header,
            isActive: false,
          }),
        )} body={body} />{grid.rowsDrawn.map(
        (row) =>
          (<GridRow key={row.key} row={{
                ...row,
                isActive: false,
                cells: row.cells.map(
                  (cell) => ({
                    ...cell,
                    elementId: null,
                    isActive: false,
                  }),
                ),
              }} body={body} density={grid.density} cellsAsBefore={NO_CELLS_AS_BEFORE} />),
      )}<BorderLines grid={grid} /><EndOfFrozenLines isOf="rows" end={grid.endOfFrozenRows} isHeld={false} body={body} /><EndOfFrozenLines isOf="columns" end={grid.endOfFrozenColumns} crossedBy={grid.endOfFrozenRows} isHeld={false} body={body} /></>;
}
export function GridDrawing({
  grid,
  cornerOnTop = null,
  cornersCalledUp = NO_CORNERS_CALLED_UP,
  flagsHidden = NO_FLAGS_HIDDEN,
  cellsAsBefore = NO_CELLS_AS_BEFORE,
  rowNumberUnderHandle = null,
  areRowsNamed = false,
  arePlacesHeld = IS_IOS_BROWSER,
  rows = grid.rowsDrawn,
  keysOfColumns = NO_LINE_KEYS,
  linesOnShow = null,
}: GridDrawingProps) {
  let {
    body,
    columnHeaders,
    activeCellBox,
    selectionBox,
    selectionSummary,
    freezeBars,
  } = grid;
  let [slideTold] = React.useState(createSlideTold);
  let activeCellCutout = activeCellBox === null ? undefined : activeCellCutoutPath(activeCellBox, body);
  let outlinedBoxes =
    grid.copiedCellsBox === null && grid.editorBox === null
      ? [
          ...(activeCellBox === null
            ? []
            : [
                {
                  key: 'activeCell',
                  box: activeCellBox,
                },
              ]),
          ...(selectionBox === null
            ? []
            : [
                {
                  key: 'selection',
                  box: selectionBox,
                },
              ]),
          ...grid.otherRangeBoxes,
        ]
      : [];
  let activeDrawnCell = React.use(AnnounceActiveCellContext)
    ? grid.rowsDrawn.flatMap((row) => row.cells).find((cell) => cell.elementId !== null)
    : undefined;
  let activeCellAddress = activeDrawnCell === undefined ? null : `${columnLetters(activeDrawnCell.columnNumber - 1)}${activeDrawnCell.rowNumberWritten},`;
  return <>{activeCellAddress !== null &&
        <span id={ACTIVE_CELL_ADDRESS_ID} hidden>{activeCellAddress}</span>}<span id={LINK_DESCRIPTION_ID} hidden>{sheetMessages.link()}</span><span id={COMMENT_DESCRIPTION_ID} hidden>{sheetMessages.hasComment()}</span>{LINK_COUNTS_IN_TEXT.map(
        (linkCount) =>
          <span key={linkCount} id={linksInTextDescriptionId(linkCount)} hidden>{linkCountLabel(linkCount)}</span>,
      )}<ColumnHeaderRow columnHeaders={columnHeaders} body={body} keysOfColumns={keysOfColumns} />{grid.columnEdgeGrips.map(
        ({ key, isOfFrozen, left, width, edgeFromLeft }) =>
          (<div key={key} aria-hidden className="sheet-column-edge-grip" data-is-of-frozen={isOfFrozen || undefined} style={{
                left: body.left + left,
                width,
                height: body.top,
              }}><div className="sheet-held-edge" data-is-of="column" style={{
                  left: edgeFromLeft,
                }} /></div>),
      )}{grid.gripOfColumnsForFingerAt !== null &&
        (<div aria-hidden className="sheet-grip-of-columns" style={{
            left: body.left + grid.gripOfColumnsForFingerAt,
            height: body.top,
          }} />)}{grid.rowEdgeGrips.map(
        ({ key, isOfFrozen, top, height, edgeFromTop }) =>
          (<div key={key} aria-hidden className="sheet-row-edge-grip" data-is-of-frozen={isOfFrozen || undefined} style={{
                top: body.top + top,
                height,
                width: body.left,
              }}><div className="sheet-held-edge" data-is-of="row" style={{
                  top: edgeFromTop,
                }} /></div>),
      )}{grid.seams.rows.map(
        (seamTop) =>
          (<div key={seamTop} aria-hidden className="sheet-seam" data-of="rows" data-is-of-own-filter={grid.seamsOfOwnFilters.includes(seamTop) || undefined} style={{
                top: body.top + seamTop,
                width: body.left,
              }} />),
      )}{grid.seams.columns.map(
        (seamLeft) =>
          (<div key={seamLeft} aria-hidden className="sheet-seam" data-of="columns" style={{
                left: body.left + seamLeft,
                height: body.top,
              }} />),
      )}{grid.heldEdgeAt !== null &&
        (<div className="sheet-held-edge" data-is-of={grid.heldEdgeIsOf} style={grid.heldEdgeIsOf === 'row'
              ? {
                  top: body.top + grid.heldEdgeAt,
                }
              : {
                  left: body.left + grid.heldEdgeAt,
                }} />)}{grid.landingLine !== null &&
        (<div className="sheet-landing-line" data-between={grid.landingLine.between} style={grid.landingLine.between === 'rows'
              ? {
                  top: body.top + grid.landingLine.offset,
                }
              : {
                  left: body.left + grid.landingLine.offset,
                }} />)}<LinesAsBefore grid={grid} linesOnShow={linesOnShow} slideTold={slideTold} /><TooltipGroup>{rows.map(
          (bodyRow) =>
            (<GridRow key={bodyRow.key} keysOfColumns={keysOfColumns} row={bodyRow} body={body} density={grid.density} cellsAsBefore={cellsAsBefore.length === 0
                    ? NO_CELLS_AS_BEFORE
                    : cellsAsBefore.filter(({ rowKey }) => rowKey === bodyRow.key)} isNumberUnderHandle={bodyRow.rowNumber === rowNumberUnderHandle} arePlacesHeld={arePlacesHeld} isNamed={areRowsNamed} />),
        )}</TooltipGroup><BorderLinesOfSlide grid={grid} slideTold={slideTold} /><EndOfFrozenLines isOf="rows" end={grid.endOfFrozenRows} isHeld={grid.freezeBarHeld === 'rows'} body={body} /><EndOfFrozenLines isOf="columns" end={grid.endOfFrozenColumns} crossedBy={grid.endOfFrozenRows} isHeld={grid.freezeBarHeld === 'columns'} body={body} />{freezeBars !== null &&
        <TooltipGroup><FreezeBar isOf="columns" bar={freezeBars.columns} isHeld={grid.freezeBarHeld === 'columns'} body={body} /><FreezeBar isOf="rows" bar={freezeBars.rows} isHeld={grid.freezeBarHeld === 'rows'} body={body} /></TooltipGroup>}{grid.boxesReachedByEditor.map(
        (box) =>
          <div key={`${box.left} ${box.top}`} className="sheet-reach-of-editor" style={clippedBoxStyle(box, body)} />,
      )}{grid.marksOfFixes.map(
        ({ key, box, isAwaited }) =>
          <div key={key} aria-hidden className={isAwaited ? 'sheet-outline-of-other sheet-fix-awaited' : 'sheet-spill-outline'} data-is-if-kept={!isAwaited || undefined} style={clippedBoxStyle(box, body)} />,
      )}{grid.spillOutline !== null &&
        <div aria-hidden className="sheet-spill-outline" data-is-blocked={grid.spillOutline.isBlocked || undefined} data-is-if-kept={grid.spillOutline.isIfKept || undefined} style={clippedBoxStyle(grid.spillOutline.box, body)} />}{grid.tableOutline !== null &&
        <div aria-hidden className="sheet-table-outline" data-is-of-formula={grid.tableOutline.isOfFormula} style={clippedBoxStyle(grid.tableOutline, body)} />}{grid.boxesLitByLink.length > 0 &&
        <CellsLitByLink boxes={grid.boxesLitByLink} body={body} />}<ReferenceMarks marks={grid.marksOfReferences} body={body} />{grid.outlinesOfOthers.map(
        ({ key, box, color }) =>
          (<div key={key} aria-hidden className="sheet-outline-of-other" style={{
                ...clippedBoxStyle(box, body),
                color,
              }} />),
      )}{grid.marksOfComments.map(
        (mark) =>
          <CommentWash key={mark.key} mark={mark} body={body} />,
      )}{grid.markOfNewComment !== null &&
        <div aria-hidden className="sheet-comment-wash" data-is-open style={clippedBoxStyle(grid.markOfNewComment, body)} />}{grid.edgesToMoveCellsBy.map(
        (edge) =>
          <div key={`${edge.table?.key ?? ''} ${edge.side}`} aria-hidden className="sheet-edge-to-move-cells-by" style={boxInBody(edge, body)} />,
      )}{grid.marksOfComments.map(
        ({ key, isOpen, isPointedAt, endsWith, ...box }) =>
          (<div key={key} aria-hidden className="sheet-comment-mark" data-is-open={isOpen} data-is-comment-pointed-at={isPointedAt || undefined} {...{
                [COMMENT_LAYER_ATTR]: key,
              }} data-is-corner-under-outline={endsWith !== null} style={clippedBoxStyle(box, body)}>{jsx('div', {
                [COMMENT_CORNER_ATTR]: key,
              })}</div>),
      )}{grid.tintsOfFind.map(
        ({ key, isCellFound, ...box }) =>
          <div key={key} aria-hidden className="sheet-found" data-is-cell-found={isCellFound} style={clippedBoxStyle(box, body)} />,
      )}{grid.marksOnChangesByAgent.map(
        ({ key, fadeBeginsAtMs, box, ...mark }) =>
          <ChangeByAgentMark key={key} keyOfMark={key} fadeBeginsAtMs={fadeBeginsAtMs} isWithoutSheen={mark.isOfWholeLines || mark.isOfPlaceShown} place={clippedBoxStyle(box, body)} />,
      )}{selectionBox !== null &&
        <div className="sheet-selection" data-is-just-imported={grid.isSelectionJustImported || undefined} data-is-in-open-comment={grid.isSelectionInOpenComment || undefined} style={clippedBoxStyle(selectionBox, body)} />}{grid.otherRangeBoxes.map(
        ({ key, box }) =>
          <div key={key} className="sheet-selection" style={clippedBoxStyle(box, body)} />,
      )}{activeCellBox !== null &&
        <div className="sheet-active-cell-outline" style={clippedBoxStyle(activeCellBox, body)} />}{grid.copiedCellsBox !== null &&
        <div className="sheet-copied-cells" style={clippedBoxStyle(grid.copiedCellsBox, body)} />}{grid.fillPreviewBox !== null &&
        <div className="sheet-fill-preview" style={clippedBoxStyle(grid.fillPreviewBox, body)} />}{grid.landingOfCellsBox !== null &&
        grid.cellsHeld === null &&
        <div className="sheet-fill-preview" style={clippedBoxStyle(grid.landingOfCellsBox, body)} />}{grid.headersKept.map(
        (headerKept) =>
          <HeaderKept key={headerKept.key} kept={headerKept} body={body} density={grid.density} marks={outlinedBoxes} tableOutline={grid.tableOutline} endOfFrozenColumns={grid.endOfFrozenColumns} rowNumberUnderHandle={rowNumberUnderHandle} />,
      )}{grid.nameFlagsOfOthers.length > 0 &&
        (<div aria-hidden className="sheet-name-flags" style={{
            clipPath: activeCellCutout,
          }}>{grid.nameFlagsOfOthers.map(
            ({ key, box, stands, end, flags, countFolded, ...group }) =>
              (<div key={key} aria-hidden className="sheet-name-flags-of-others" data-stands={stands} data-end={end} data-is-on-top={key === cornerOnTop || undefined} data-is-hidden={flagsHidden.corners.includes(key) || undefined} style={nameFlagsStyle(
                    key,
                    {
                      stands,
                      box,
                    },
                    grid.outlinesOfOthers,
                    body,
                  )}><FlagsAtRest lastMoveAtMs={group.lastMoveAtMs} isKeptUp={group.isAllThatShows || cornersCalledUp.includes(key)}>{flags.map(
                      ({ key: flagKey, name, color, inkColor }, flagIndex) =>
                        (<span key={flagKey} style={{
                              background: color,
                              color: inkColor,
                            }}><bdi>{name}</bdi>{countFolded > 0 && flagIndex === flags.length - 1 && foldedFlagsCountText(countFolded)}</span>),
                    )}</FlagsAtRest></div>),
          )}</div>)}<div aria-hidden className="sheet-name-flags" style={{
          clipPath: activeCellCutout,
        }}>{grid.marksOnChangesByAgent.map(
          ({ key, fadeBeginsAtMs, name, box }) =>
            name !== null &&
            <ChangeByAgentMark key={key} keyOfMark={key} fadeBeginsAtMs={fadeBeginsAtMs} place={flagPlaceStyle(name, box, body)} nameStands={name.stands} isHidden={flagsHidden.isOfAgent} />,
        )}</div>{selectionSummary !== null &&
        <Surface aria-hidden id={SELECTION_SUMMARY_ID} elevation="popover" className="sheet-selection-summary" data-opens-menu={selectionSummary.opensMenu} style={selectionSummaryStyle(selectionSummary, body)}><span className="sheet-selection-summary-words">{selectionSummaryText(selectionSummary.summary)}</span></Surface>}{grid.fillHandleBox !== null &&
        (<div aria-hidden className="sheet-fill-handle" data-has-flag-beside={grid.isFlagInSquareOfFillHandle || undefined} style={{
            ...boxInBody(grid.fillHandleBox, body),
            ...clipInsetStyle({
              ...hiddenInsetOfBox(grid.fillHandleBox, NO_GRIDLINE_OVERLAP),
              right: 0,
              bottom: 0,
            }),
          }} />)}{grid.roomOfAgentAtWork !== null &&
        (<AgentAtWork style={boxInBody(
            {
              ...grid.roomOfAgentAtWork,
              left: 0,
              top: 0,
            },
            body,
          )} />)}</>;
}
export const isSamePerson = (person: ChipPerson, other: ChipPerson | undefined): boolean =>
  person.userId === other?.userId && person.name === other.name && person.avatarUrl === other.avatarUrl;
export const shallowEqualExcept = <Shape extends object>(before: Shape, after: Shape, keysToSkip: readonly (keyof Shape)[] = []): boolean =>
  (Object.keys(before) as (keyof Shape & string)[]).every((key) => keysToSkip.includes(key) || Object.is(before[key], after[key]));
export const isSameLinkPart = (part: LinkPart, other: LinkPart | undefined): boolean =>
  part.text === other?.text &&
  part.startsAt === other.startsAt &&
  part.url === other.url &&
  part.isLinkOnWords === other.isLinkOnWords &&
  part.marks.join() === other.marks.join();
export const CheckboxOfLine = ({ isChecked }: CheckboxOfLineProps) =>
  <span role="presentation" aria-hidden className="sheet-box-of-line" onMouseDown={preventMouseDownDefault}><Checkbox checked={isChecked} animated tabIndex={-1} aria-label={sheetMessages.checkboxCells()} /></span>;
export const LINE_WITHOUT_LIST: LineOfAList = {
  list: {
    kind: 'none',
  },
  number: null,
};
export const LineInCell = ({
  line,
  drawnBefore = LINE_WITHOUT_LIST,
  whereCut,
  children,
}: LineInCellProps) =>
  <span className="sheet-line-in-cell" data-line={line} {...listAttributesOf(drawnBefore)}>{drawnBefore.list.kind === 'checkbox' &&
        <><CheckboxOfLine isChecked={drawnBefore.list.isChecked} /><span className="sr-only">{checkedStateWords(drawnBefore.list.isChecked)}{' '}</span></>}{whereCut === null
        ? children
        : <span className="sheet-text-that-fades" style={whereCut}>{children}</span>}</span>;
export const LINK_COUNTS_IN_TEXT: readonly number[] = Array.from(
  {
    length: MAX_LINKS_IN_TEXT,
  },
  (_slot, index) => index + 1,
);
export const GridCell = React.memo(function (props: GridCellProps) {
  let { bodyLeft, density, columnNumber, left, width, top, height } = props;
  let { linkUrl, partsWithLinks, listLines } = props;
  let { mergedFromRowNumber, mergedRowCount, mergedColumnCount } = props;
  let { hiddenAtLeft, hiddenAtTop } = props;
  let {
    text,
    spokenText,
    textColor,
    alignment,
    isCutAtEndOnly,
    indentToCenter,
  } = props;
  let { format, paints } = props;
  let {
    textLeft,
    textWidth,
    isTextWrapped,
    hasLineAtRight,
    isSelected,
    elementId,
  } = props;
  let {
    pill,
    opensDropdownList,
    isDropdownListOpen,
    isPerson,
    avatarUrl,
    otherPeople,
  } = props;
  let {
    opensCalendar,
    isCalendarOpen,
    opensPeopleList,
    isPeopleListOpen,
    frozenBy,
  } = props;
  let { checkbox, isError, looksLikeError, isErrorMuted } = props;
  let announcesActiveCell = React.use(AnnounceActiveCellContext) && elementId !== null;
  let blankCellWords = React.use(BlankCellWordsContext);
  let hasWordsForReader =
    text.trim() === '' &&
    linkUrl === null &&
    !isPerson &&
    blankCellWords !== 'none' &&
    (blankCellWords === 'all' || checkbox !== null || opensDropdownList || props.isActive);
  let areWordsInsteadOfLabel = hasWordsForReader && blankCellWords !== 'all';
  let cellLabel =
    props.shownForFixThatWaits !== null
      ? agentFixLabel(text, props.shownForFixThatWaits, props.areKeysForFix)
      : checkbox === null
        ? (spokenText ?? undefined)
        : checkboxCellLabel(checkbox);
  let isStruckWithDoubleUnderline = format.font.strikethrough && format.font.underline === 'double';
  let font = isStruckWithDoubleUnderline
    ? {
        ...format.font,
        strikethrough: false,
      }
    : format.font;
  let isTextBoxOffCell = textLeft !== left || textWidth !== width;
  let isPillFillingCell = checkbox === null && !isTextBoxOffCell && linkUrl === null && !isPerson && (pill !== null || opensDropdownList);
  let hasChip =
    isPerson || (isPillFillingCell && pill !== null) || (linkUrl !== null && props.linkDrawnAs !== 'words' && githubLinkFace(linkUrl) !== null);
  let textClearance = cellTextInsets(
    height,
    format.font.size,
    density,
    isPillFillingCell ? 'left' : alignment,
    props.hiddenByBorderAtFoot,
    hasChip,
  );
  let chipLineCount = otherPeople.length > 0 ? personChipLinesOfCell(props, textClearance) : 1;
  let showsAsError = looksLikeError && paints.fill === null;
  let usesTextPaint = !showsAsError && textColor === null && paints.text !== null;
  let cellStyle = {
    justifyContent: `${isCutAtEndOnly ? 'safe ' : ''}${JUSTIFY_BY_ALIGNMENT[alignment]}`,
    alignItems: ALIGN_ITEMS_BY_VERTICAL[format.alignment.vertical],
    alignContent: chipLineCount > 1 ? ALIGN_ITEMS_BY_VERTICAL[format.alignment.vertical] : undefined,
    color: showsAsError ? 'var(--sheet-color-of-error)' : textColor === null ? undefined : TEXT_TINT_COLORS[textColor],
    ...(usesTextPaint ? textPaintStyle(paints.text) : undefined),
    ...cellFontStyle(font),
  };
  let textDecorationLine = isStruckWithDoubleUnderline ? 'line-through' : undefined;
  let linkParts = partsWithLinks.map((part) => part.text).join('') === text ? partsWithLinks : [];
  let linkCount = new Set(linkParts.flatMap(({ url }) => url ?? [])).size;
  let textAsDrawn = (textOfCell: string) => (isTextWrapped ? textOfCell : flattenLineBreaks(textOfCell));
  let partTexts = linkParts.map((part) => part.text);
  let partTextsDrawn = isTextWrapped ? partTexts : flattenLineBreaksAcrossParts(partTexts);
  let partsDrawn = linkParts.map(
    (part, index): PartDrawn => ({
      ...part,
      drawn: partTextsDrawn[index],
    }),
  );
  let drawParts = (parts: readonly PartDrawn[]) =>
    groupLinkParts(parts).map((group: PartDrawn[]) => {
      let partSpans = group.map(
        ({ startsAt, marks, drawn }) =>
          marks.length === 0
            ? drawn
            : <span key={startsAt} style={textMarksStyle(marks)}>{drawn}</span>,
      );
      let [{ startsAt: groupStartsAt, url: groupUrl, isLinkOnWords: isGroupLinkOnWords }] = group;
      return groupUrl === null
        ? partSpans
        : <CellLinkSpan key={groupStartsAt} url={groupUrl} cellKeyOfWords={props.linkCellKey} isAmongText isOnWords={isGroupLinkOnWords}>{partSpans}</CellLinkSpan>;
    });
  let fadesCutLines = props.areLinesCut && props.isInTable;
  let lineFadeStyle = ({ list }: LineOfAList = LINE_WITHOUT_LIST) =>
    fadesCutLines && (list.kind !== 'none' || alignment === 'left')
      ? textFadeStyle(
          {
            ...props,
            alignment: 'left',
          },
          {
            ...textClearance,
            left: textClearance.left + listIndentOfLevel(levelInList(list), format.font.size),
          },
        )
      : null;
  let textDrawn =
    linkParts.length === 0
      ? textAsDrawn(text)
      : listLines.length === 0
        ? drawParts(partsDrawn)
        : partsByLine(partsDrawn).map(
            ({ breakBefore, ofLine }, line) =>
              <React.Fragment key={ofLine[0]?.startsAt ?? `empty ${line}`}>{!isTextWrapped && breakBefore?.drawn}<LineInCell line={line} drawnBefore={listLines[line]} whereCut={lineFadeStyle(listLines[line])}>{drawParts(ofLine)}</LineInCell></React.Fragment>,
          );
  let needsOwnSpan = isStruckWithDoubleUnderline || indentToCenter !== 0 || linkParts.length > 0;
  let textInBox = isTextWrapped
    ? <span className="sheet-wrapped-text" data-cuts-lines={props.areLinesCut || undefined} style={{
          textDecorationLine,
          textAlign: alignment,
          ...wrappedTextLineStyle(format.font.size),
          ...(props.takenAtRight > 0 && {
            overflow: 'clip',
          }),
        }}>{textDrawn}</span>
    : needsOwnSpan
      ? <span style={{
            textDecorationLine,
            marginLeft: indentToCenter === 0 ? undefined : indentToCenter,
          }}>{textDrawn}</span>
      : textDrawn;
  let textFade = props.mayTextFade ? textFadeStyle(props, textClearance) : null;
  let withFade = (content: ReactNode) =>
    textFade === null
      ? content
      : <span className="sheet-text-that-fades" style={textFade}>{content}</span>;
  let linkOnWords = (wordsUrl: string) =>
    <CellLinkSpan url={wordsUrl} cellKeyOfWords={props.linkCellKey ?? ''}><span className="sheet-link-words" style={{
          color: textColor === null ? undefined : 'inherit',
          marginLeft: indentToCenter === 0 ? undefined : indentToCenter,
        }}>{withFade(
          isStruckWithDoubleUnderline
            ? (<span style={{
                  textDecorationLine,
                }}>{textAsDrawn(text)}</span>)
            : textAsDrawn(text),
        )}</span></CellLinkSpan>;
  let describedById =
    linkUrl !== null
      ? props.linkDrawnAs === 'words' && elementId !== null
        ? `${LINK_DESCRIPTION_ID} ${LINK_ADDRESS_ID}`
        : LINK_DESCRIPTION_ID
      : linkCount > 0
        ? linksInTextDescriptionId(linkCount)
        : isError && elementId !== null
          ? ERROR_DESCRIPTION_ID
          : undefined;
  let keyShortcuts = [
    linkUrl === null && linkCount === 0 ? null : 'Alt+Enter',
    props.isSaidToHaveComment && elementId !== null ? COMMENT_SHORTCUT : null,
  ].filter(Boolean);
  let describedByIds = [
    announcesActiveCell ? ACTIVE_CELL_ADDRESS_ID : null,
    describedById,
    props.isSaidToHaveComment ? COMMENT_DESCRIPTION_ID : null,
  ].filter(Boolean);
  return <div role="gridcell" aria-hidden={props.isBehindBars || undefined} id={elementId ?? undefined} aria-rowindex={mergedFromRowNumber === null ? undefined : ariaIndex(mergedFromRowNumber)} aria-colindex={ariaIndex(columnNumber)} aria-rowspan={mergedRowCount ?? undefined} aria-colspan={mergedColumnCount ?? undefined} aria-describedby={describedByIds.length === 0 ? undefined : describedByIds.join(' ')} data-is-error={isError || undefined} data-looks-like-error={looksLikeError || undefined} data-is-error-muted={isErrorMuted || undefined} data-fix-waits={props.shownForFixThatWaits !== null || undefined} aria-keyshortcuts={keyShortcuts.length === 0 ? undefined : keyShortcuts.join(' ')} aria-selected={isSelected} aria-label={areWordsInsteadOfLabel ? undefined : cellLabel} aria-haspopup={opensDropdownList || opensPeopleList ? 'listbox' : opensCalendar ? 'dialog' : undefined} aria-expanded={opensDropdownList ? isDropdownListOpen : opensPeopleList ? isPeopleListOpen : opensCalendar ? isCalendarOpen : undefined} {...ariaRowIndexText(props.rowNumberWritten)} {...ariaColIndexText(columnLetters(columnNumber - 1))} className="sheet-cell" data-is-active={props.isActive || undefined} data-comes-at-key={props.comesAtKey} data-frozen-by={frozenBy ?? undefined} data-has-no-line-at-right={!hasLineAtRight || undefined} data-text-runs-on={isTextBoxOffCell || undefined} data-is-cut-at-end-only={isCutAtEndOnly || undefined} data-chips-wrap={chipLineCount > 1 || undefined} data-may-text-fade={props.mayTextFade || fadesCutLines || undefined} data-is-cut-by-view={props.cutByViewAt !== null || undefined} data-has-fill={paints.fill !== null || undefined} data-turns-chips-white={(usesTextPaint && turnsChipsWhite(paints)) || undefined} data-has-text-paint={(!isTextBoxOffCell && usesTextPaint) || undefined} data-has-tint-of-filter-header={props.hasTintOfFilterHeader || undefined} data-has-ground-of-found-header={props.hasGroundOfFoundHeader || undefined} data-is-in-table={props.isInTable || undefined} data-is-in-hand={props.isInHand || undefined} data-corners-of-table={props.cornersOfTable ?? undefined} data-has-color-of-heading={props.hasColorOfHeading || undefined} data-has-weight-of-heading={(props.isHeadingOfTable && !format.font.bold && !isTextWrapped) || undefined} data-mark-of-import={props.markOfImport ?? undefined} data-words-for-voiceover={hasWordsForReader && blankCellWords === 'whereAPressActsByCss' ? (cellLabel ?? sheetMessages.blankCell()) : undefined} style={{
      ...(props.markOfImport !== null && importMarkDelayStyle(props.markOfImportDelayMs)),
      left: bodyLeft + left,
      width,
      top,
      height,
      ...textClearanceStyle(textClearance, hasChip ? density : null),
      ...(isPerson || linkUrl !== null ? whiteOwedStyle(textOverflowAtSides(textClearance, alignment)) : undefined),
      ...(props.takenAtRight > 0
        ? {
            paddingRight: props.takenAtRight + (hasLineAtRight ? 0 : 1),
          }
        : undefined),
      ...clipInsetStyle({
        left: hiddenAtLeft,
        top: hiddenAtTop,
        right: 0,
        bottom: 0,
      }),
      ...(props.cutByViewAt !== null && cutByViewStyle(props.cutByViewAt)),
      ...fillPaintStyle(paints.fill),
      ...(isTextBoxOffCell ? undefined : cellStyle),
    }}>{hasWordsForReader &&
        blankCellWords !== 'whereAPressActsByCss' &&
        <WordsForScreenReader words={cellLabel ?? sheetMessages.blankCell()} />}{checkbox !== null
        ? <CellCheckbox checkbox={checkbox} />
        : isTextBoxOffCell
          ? (<TextThatRunsOn left={textLeft - left} cell={props} style={cellStyle} hasTextPaint={usesTextPaint}><span style={{
                  textDecorationLine,
                }}>{withFade(textDrawn)}</span></TextThatRunsOn>)
          : linkUrl !== null && props.linkDrawnAs === 'words'
            ? isTextWrapped
              ? (<span className="sheet-wrapped-text" style={{
                    textAlign: alignment,
                    ...wrappedTextLineStyle(format.font.size),
                  }}>{linkOnWords(linkUrl)}</span>)
              : linkOnWords(linkUrl)
            : linkUrl !== null
              ? <CellLinkSpan url={linkUrl} cellKeyOfWords={null} holdsChip={githubLinkFace(linkUrl) !== null}><LinkAddressOrGithubChip url={linkUrl} isTypedWithWww={props.linkDrawnAs === 'addressWithoutScheme'} /></CellLinkSpan>
              : isPerson
                ? (<PeopleChips first={{
                      name: text,
                      avatarUrl,
                    }} firstName={textInBox} textDecorationLine={textDecorationLine} others={otherPeople} cellWidth={width} lineCount={chipLineCount} font={format.font} opensList={opensPeopleList} />)
                : isPillFillingCell
                  ? (<CellChip optionPaints={pill} hasBox={pill !== null} fillsCell isBlank={pill !== null && text === ''} isBold={format.font.bold} textProps={{
                        style: {
                          textAlign: alignment,
                        },
                      }} after={opensDropdownList && MENU_CARETS.chipInCell}>{textInBox}</CellChip>)
                  : props.takenAtRight > 0 && !isTextWrapped
                    ? <span className="sheet-text-short-of-button" data-ends-at-button={(textFade !== null && fadesFromRightButton(props)) || undefined}>{withFade(textInBox)}</span>
                    : withFade(textInBox)}</div>;
}, areCellPropsEqual);
export const AriaPlaceKeeper = ({ role }: AriaPlaceKeeperProps) =>
  <div role={role} style={{
      position: 'absolute',
      width: 0,
      height: 0,
    }} />;
export const ARE_ROWS_NAMED_HERE =
  IS_APPLE_PLATFORM && !IS_IOS_BROWSER && typeof CSS < 'u' && !CSS.supports('-moz-appearance', 'none') && !CSS.supports('font', '-apple-system-body');
export const COMMENT_DESCRIPTION_ID = 'comment-description';
export const COMMENT_SHORTCUT = IS_APPLE_PLATFORM ? 'Meta+Alt+M' : 'Control+Alt+M';
export const COMMENT_CORNER_ATTR = 'data-comment-corner';
export const COMMENT_LAYER_ATTR = 'data-comment-layer';
export const boxInBody = (box: PaneRect, body: BodyOrigin): PaneRect => ({
  left: body.left + box.left,
  top: body.top + box.top,
  width: box.width,
  height: box.height,
});
export const gridlineOverlap = (box: Pick<PaneRect, 'left' | 'top'>): GridPoint => ({
  x: box.left >= 1 ? 1 : 0,
  y: box.top >= 1 ? 1 : 0,
});
export const outlineBoxInBody = (box: PaneRect, body: BodyOrigin): PaneRect => boxInBody(boxWithGridline(box), body);
export const nameFlagsStyle = (key: string, flag: PlacedFlag, outlinesOfOthers: readonly OutlinedBox[], body: BodyOrigin) => {
  let flagOutline = outlineBoxInBody(flag.box, body);
  let firstOutlineBox = outlinesOfOthers.find((outline) => outline.key === key)?.box;
  let firstOutline = outlineBoxInBody(firstOutlineBox ?? flag.box, body);
  return {
    ...flagPlaceStyle(flag, firstOutlineBox, body),
    '--sheet-width-of-first-outline': `${firstOutline.left + firstOutline.width - flagOutline.left}px`,
  };
};
export const FAR_CLIP_INSET = -9999;
export const flagPlaceStyle = (flag: PlacedFlag, outlineBox: Pick<PaneRect, 'left'> | undefined, body: BodyOrigin) => {
  let { showsIn: shownBox } = flag.box;
  let flagOutline = outlineBoxInBody(flag.box, body);
  let startsLeftOfShown = outlineBox !== undefined && outlineBox.left < shownBox.left;
  let hiddenAtLeft = body.left + shownBox.left - flagOutline.left;
  let clipLeft = startsLeftOfShown && hiddenAtLeft > 0 ? hiddenAtLeft : FAR_CLIP_INSET;
  let clipTop = flagTop(flag) < shownBox.top ? body.top + shownBox.top - flagOutline.top : FAR_CLIP_INSET;
  return clipLeft === FAR_CLIP_INSET && clipTop === FAR_CLIP_INSET
    ? flagOutline
    : {
        ...flagOutline,
        clipPath: `inset(${clipTop}px ${FAR_CLIP_INSET}px ${FAR_CLIP_INSET}px ${clipLeft}px)`,
      };
};
export const clipInsetStyle = ({ top, right, bottom, left }: ClipInset) =>
  top + right + bottom + left === 0
    ? {}
    : {
        clipPath: `inset(${top}px ${right}px ${bottom}px ${left}px)`,
      };
export const NO_GRIDLINE_OVERLAP: GridPoint = {
  x: 0,
  y: 0,
};
export const clippedBoxStyle = (box: DrawnBox, body: BodyOrigin) => ({
  ...outlineBoxInBody(box, body),
  ...clipInsetStyle({
    ...hiddenInsetOfBox(box, gridlineOverlap(box)),
    right: Math.max(0, box.left + box.width - (box.showsIn.left + box.showsIn.width)),
    bottom: Math.max(0, box.top + box.height - (box.showsIn.top + box.showsIn.height)),
  }),
});
export const ENTRY_CLIP_OVERSHOOT = 12;
export const ENTRY_TEXT_NUDGE = 2;
export const SUMMARY_EDGE_GAP = 1;
export const selectionSummaryStyle = ({ center, top, height }: SelectionSummaryPlace, body: Pick<PaneRect, 'left' | 'top' | 'width'>) => ({
  left: body.left + center,
  top: body.top + top,
  height,
  maxWidth: body.width - 2 * SUMMARY_EDGE_GAP,
  translate: `clamp(${SUMMARY_EDGE_GAP - center}px, -50%, calc(${body.width - SUMMARY_EDGE_GAP - center}px - 100%))`,
});
export const NO_CELLS_AS_BEFORE: readonly CellAsBefore[] = [];
export const gridlinesDataAttribute = ({ areGridlinesHidden }: { areGridlinesHidden: boolean }) => ({
  'data-hides-gridlines': areGridlinesHidden || undefined,
});
export const FilterButtonGround = React.memo(function ({
  box: { left: boxLeft, top: boxTop, width: boxWidth, height: boxHeight, fade: fadeWidth },
  grounds,
  body,
}: FilterButtonGroundProps) {
  let groundBox = {
    left: body.left + boxLeft,
    top: body.top + boxTop,
    width: boxWidth,
    height: boxHeight,
    '--sheet-fade-of-ground': `${fadeWidth}px`,
  };
  return <div aria-hidden className="sheet-ground-of-filter-button-held" style={groundBox}>{grounds.map(
      ({ left, width, ground }) =>
        (<div key={left} data-ground={typeof ground === 'string' ? ground : 'fill'} style={{
              left: left - boxLeft,
              width,
              ...fillPaintStyle(typeof ground === 'string' ? null : ground),
            }} />),
    )}</div>;
});
export const HEADER_KEPT_SHADOW = 32;
export const CopiedRowsDrawing = React.memo(function ({
  rows,
  borderLines,
  body,
  density,
}: CopiedRowsDrawingProps) {
  return <>{rows.map(
        (row) =>
          <GridRow key={row.key} row={row} body={body} density={density} cellsAsBefore={NO_CELLS_AS_BEFORE} />,
      )}{borderLines !== null &&
        (<BorderLines grid={{
            body,
            borderLines,
          }} />)}</>;
});
export const RidingRowsDrawing = React.memo(function ({
  rows,
  borderLines,
  body,
  density,
}: RidingRowsDrawingProps) {
  return <>{rows.map(
        (row) =>
          <GridRow key={row.key} row={row} body={body} density={density} cellsAsBefore={NO_CELLS_AS_BEFORE} />,
      )}<BorderLines grid={{
          body,
          borderLines,
        }} /></>;
});
export const NO_CORNERS_CALLED_UP: readonly string[] = [];
