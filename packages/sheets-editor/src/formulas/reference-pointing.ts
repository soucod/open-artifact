import type { DecimalSignName, SheetId } from '@open-artifact/sheets-core';
import type { CaretInEntryPlaced } from '../editor/entry-boxes.ts';
import type { GridHit } from '../grid/geometry.ts';
import type { CaretSpan, FormulaKeyAct } from '../keys/key-acts.ts';
import type { OwnRowOrder } from '../model/line-ids.ts';
import type { CellArea } from '../selection/model.ts';
import type { PointerDragged, PointerPressed } from '../state/event-reducer.ts';
import type { EditingMode, PageMode } from '../state/transitions.ts';
import type { FormulaReferencesFound, WrittenReference } from './references.ts';
import { findFormulaReferences, resolveFormulaReference, sheetPrefixForFormula, isWholeLineReference } from './references.ts';
import { hasSpaceBetweenOperands } from './word-tokens.ts';
import { areasToA1AsStored } from './from-words/where.ts';
import { isFormulaText } from '../chips/dropdown-pane-edits.ts';
import { isInsideArrayLiteral } from './function-help.ts';
import {
  selectionAreaAndKind,
  mergedAreaOrCellOf,
  areaGrownOverMerges,
  isSameArea,
  isSameCell,
  anchorCellOf,
  scrollToShowPosition,
  selectionAtCell,
  moveActiveCellTo,
  selectionOfArea,
  BOTH_AXES,
} from '../selection/model.ts';
import { wholeAreaToA1AsStored, rowLabelEnds, columnLabelEnds } from '../model/a1-references.ts';
import { findSheetById, layoutOfView } from '../grid/layout.ts';
import { ownRowOrderOfSheet } from '../model/line-ids.ts';
import { withEntryText } from '../editor/text-looks.ts';
import { hitTestGrid, scrollPositionInLines } from '../grid/geometry.ts';
import { formulaArgumentSeparator } from '../format/number-signs.ts';
import { dragPositionClearOfStuckHeaders, columnSpanAt } from '../grid/sticky-headers.ts';
import { jumpOrExtendSelection } from '../selection/jumps.ts';
import { extendSelectionByKey, cellAfterKeyMove } from '../selection/keyboard.ts';
import { cellShownText } from '../clipboard/text-escaping.ts';
import type { PageState, PointedReference, ReferenceInEntry } from '../state/initial-state.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
/** Whole rows or whole columns, pointed at by their header. */
export type PointedWhole = 'rows' | 'columns';
/** The cells pointed at for a reference: from `anchor` to `at`, or the whole rows or columns they lie in. */
export interface CellsPointedAt {
  anchor: CellId;
  at: CellId;
  whole: PointedWhole | null;
  cameToMergedCellsAt?: CellId | null;
}
/** A reference written into the entry by pointing at cells, with the text it took the place of. */
export interface PointedReferenceWritten extends PointedReference, CellsPointedAt {
  tookPlaceOf?: string;
}
/** A caret in an entry's text, and whether the person put it there rather than the page. */
export interface EntryCaret extends CaretSpan {
  isPlacedByHand?: true;
}
/** An entry caret, with the text it was in. */
export interface EntryCaretInText extends EntryCaret {
  text: string;
}
/** Where a reference may be written in a formula: over one written there, or in a gap that takes one. */
export interface ReferenceSlot extends CaretSpan {
  written: WrittenReference | null;
}
/** The tip shown of the cells a pointed reference covers. */
export interface PointedCellsTip {
  cells: string;
  /** What the cell shows, for a reference to one cell. */
  text: string | null;
  doArrowsMoveIt: boolean;
}
export type PointAtCellsAct = Extract<FormulaKeyAct, { kind: 'pointAtCells' }>;
export function referencesInFormula(formula: string, decimalSign: DecimalSignName): FormulaReferencesFound {
  let parsed = findFormulaReferences(formula, decimalSign);
  return hasSpaceBetweenOperands(formula)
    ? {
        ...parsed,
        references: parsed.references.filter(hasLetteredEnd),
      }
    : parsed;
}
export function highlightedReferences(formula: string, sheetId: SheetId, reads: WorkbookReads): ReferenceInEntry[] {
  let sheets = reads.listSheets();
  let huesByArea = new Map<string, string>();
  let { references } = referencesInFormula(formula, reads.decimalSign);
  return references.flatMap((reference): ReferenceInEntry[] => {
    let found = resolveFormulaReference(reference, sheetId, sheets);
    if (found === null) return [];
    let { sheet, area, pieces } = found;
    let { sheetId: refSheetId } = sheet;
    let areaKey = `${refSheetId} ${areasToA1AsStored(pieces, sheet.ownRowOrder)}`;
    let hue = huesByArea.get(areaKey) ?? referenceHue(huesByArea.size);
    huesByArea.set(areaKey, hue);
    let writtenAt = {
      start: reference.start,
      end: reference.end,
    };
    return [
      {
        sheetId: refSheetId,
        area,
        ...(pieces.length > 1 && {
          pieces,
        }),
        hue,
        writtenAt,
      },
    ];
  });
}
export function syncReferencesInEntry(previousState: PageState, state: PageState, reads: WorkbookReads): PageState {
  let { mode, activeCell, workbookChangeCount } = state;
  if (mode === previousState.mode && workbookChangeCount === previousState.workbookChangeCount) return state;
  let references =
    mode.kind === 'editing' && isFormulaText(mode.text) ? highlightedReferences(mode.text, activeCell.sheetId, reads) : NO_REFERENCES;
  return references.length === 0 && state.referencesInEntry.length === 0
    ? state
    : {
        ...state,
        referencesInEntry: references,
      };
}
export function referenceSlotAt(text: string, caret: EntryCaret): ReferenceSlot | null {
  if (!isFormulaText(text) || isInsideArrayLiteral(text.slice(0, caret.start))) return null;
  let { references, quoted } = referencesInFormula(text, 'point');
  let enclosing = references.find(({ start, end }) => start <= caret.start && caret.end <= end);
  if (enclosing !== undefined)
    return {
      start: enclosing.start,
      end: enclosing.end,
      written: enclosing,
    };
  return !quoted.some(
    ({ start, end, isClosed }) => start < caret.start && (caret.start < end || !isClosed),
  ) &&
    REFERENCE_MAY_FOLLOW_PATTERN.test(text.slice(0, caret.start)) &&
    REFERENCE_MAY_PRECEDE_PATTERN.test(text.slice(caret.end))
    ? {
        ...caret,
        written: null,
      }
    : null;
}
export function isPointingPossible(mode: PageMode, caretInEntry: CaretInEntryPlaced | undefined): boolean {
  if (mode.kind !== 'editing' || caretInEntry?.isComposing === true) return false;
  if (mode.isBegunToListFunctions === true) return false;
  let caret = caretOrEnd(mode.text, caretInEntry);
  return !isEntryUntouchedAt(mode, caret) && referenceSlotAt(mode.text, caret) !== null;
}
export function pointedArea(reads: WorkbookReads, { anchor, at, whole }: CellsPointedAt): CellArea | null {
  let pointed = selectionAreaAndKind(
    {
      activeCell: anchor,
      selectionCorner: at,
    },
    reads,
  );
  if (pointed === null || whole !== null) return pointed?.area ?? null;
  let merge = mergedAreaOrCellOf(reads, anchor);
  if (merge === null) return null;
  let grown = areaGrownOverMerges(reads, anchor.sheetId, pointed.area);
  return isSameArea(grown, merge)
    ? {
        ...grown,
        rowCount: 1,
        columnCount: 1,
      }
    : grown;
}
export function writtenAddress(area: CellArea, whole: PointedWhole | null, ownRowOrder: OwnRowOrder | null): string | null {
  let address = wholeAreaToA1AsStored(area, ownRowOrder);
  if (whole === null || address === null) return address;
  let { first, last } = whole === 'rows' ? rowLabelEnds(area, ownRowOrder) : columnLabelEnds(area);
  return `${first}:${last}`;
}
/** Writes the cells pointed at over the slot, after `lead` (a separator, when the reference is added after another). */
export function writeReferenceIntoEntry(
  state: PageState,
  reads: WorkbookReads,
  slot: CaretSpan,
  lead: string,
  pointing: CellsPointedAt,
): PageState {
  let { anchor, whole } = pointing;
  let area = pointedArea(reads, pointing);
  let sheetName = findSheetById(reads, anchor.sheetId)?.name;
  if (state.mode.kind !== 'editing' || area === null || sheetName === undefined) return state;
  let isSameSheet = anchor.sheetId === state.activeCell.sheetId;
  let ownRowOrder = ownRowOrderOfSheet(reads, anchor.sheetId);
  let written = writtenAddress(area, whole, ownRowOrder);
  let live = lead === '' ? livePointedReference(state) : null;
  let tookPlaceOf =
    (live?.start === slot.start && live.end === slot.end ? live.tookPlaceOf : null) ?? state.mode.text.slice(slot.start, slot.end);
  let address = written === null ? tookPlaceOf : `${isSameSheet ? '' : sheetPrefixForFormula(sheetName)}${written}`;
  let otherNotice = state.notice?.kind === 'ownSortInTheWay' ? null : state.notice;
  let writtenStart = slot.start + lead.length;
  let text = `${state.mode.text.slice(0, slot.start)}${lead}${address}${state.mode.text.slice(slot.end)}`;
  return {
    ...state,
    mode: {
      ...withEntryText(state.mode, text),
      ...(!isSameSheet && {
        mayHoldTextOfOthers: true,
      }),
    },
    notice:
      written === null
        ? {
            kind: 'ownSortInTheWay',
            act: 'referTo',
          }
        : otherNotice,
    pointedReference: {
      start: writtenStart,
      end: writtenStart + address.length,
      text,
      tookPlaceOf,
      ...pointing,
    },
  };
}
export function areaOfWrittenReference(
  reference: WrittenReference | null,
  { sheetId, activeCell }: Pick<PageState, 'sheetId' | 'activeCell'>,
  reads: WorkbookReads,
): CellArea | null {
  let found = reference === null ? null : resolveFormulaReference(reference, activeCell.sheetId, reads.listSheets());
  return found?.sheet.sheetId === sheetId && found.pieces.length === 1 ? found.area : null;
}
export function cellOfWrittenReference(reference: WrittenReference | null, state: PageState, reads: WorkbookReads): CellId | null {
  let area = areaOfWrittenReference(reference, state, reads);
  return area === null ? null : reads.cellIdAt(state.sheetId, area.topRowIndex, area.leftColumnIndex);
}
export function wholeOfReference(reference: WrittenReference | null): PointedWhole | null {
  if (reference === null) return null;
  return reference.rows.count === null ? 'columns' : reference.columns.count === null ? 'rows' : null;
}
export function pointAtCell(state: PageState, pointer: PointerPressed, reads: ReadsWithTextMeasurer): PageState | null {
  let { mode, sheetId, activeCell } = state;
  if (mode.kind !== 'editing' || pointer.isByFinger) return null;
  if (pointer.caretInEntry?.isComposing === true) return null;
  let hit = hitTestGrid(pointer, state, layoutOfView(state, reads));
  if (hit === null || hit.kind === 'corner') return null;
  let whole = WHOLE_OF_HEADER_KIND[hit.kind];
  let { rowIndex, columnIndex } = {
    rowIndex: 0,
    columnIndex: 0,
    ...hit,
  };
  let cellId = reads.cellIdAt(sheetId, rowIndex, columnIndex);
  if (cellId === null) return null;
  if (whole === null && isSameCell(anchorCellOf(reads, cellId), activeCell)) return null;
  let caret = caretOrEnd(mode.text, pointer.caretInEntry);
  const live = livePointedReference(state);
  if (live === null && isEntryUntouchedAt(mode, caret)) return null;
  const isInLive = live !== null && !isPointedReferenceEmpty(live) && live.start <= caret.start && caret.end <= live.end;
  let slot: ReferenceSlot | null = isInLive
    ? {
        ...live,
        written: null,
      }
    : referenceSlotAt(mode.text, caret);
  if (slot === null) return null;
  let draggingState: PageState = {
    ...state,
    dragging: {
      kind: 'pointing',
    },
  };
  let addsReference =
    pointer.isModifierHeld === true && !pointer.isShiftHeld && slot.start < slot.end && (isInLive || slot.written !== null);
  let isRangeEnd = (!addsReference && /:\s*$/.test(mode.text.slice(0, slot.start))) || /^\s*:/.test(mode.text.slice(slot.end));
  if (whole !== null && isRangeEnd) return null;
  if (addsReference)
    return writeReferenceIntoEntry(
      draggingState,
      reads,
      {
        start: slot.end,
        end: slot.end,
      },
      formulaArgumentSeparator(reads.decimalSign),
      {
        anchor: cellId,
        at: cellId,
        whole,
      },
    );
  const liveAnchor = isInLive ? live.anchor : cellOfWrittenReference(slot.written, state, reads);
  let liveWhole = isInLive ? live.whole : wholeOfReference(slot.written);
  const extendsFromAnchor =
    pointer.isShiftHeld &&
    (whole === null || liveWhole === null || whole === liveWhole) &&
    liveAnchor?.sheetId === sheetId &&
    reads.positionOfCell(liveAnchor) !== null;
  return writeReferenceIntoEntry(draggingState, reads, slot, '', {
    anchor: extendsFromAnchor ? liveAnchor : cellId,
    at: cellId,
    whole,
  });
}
export function dragPointedReference(state: PageState, pointer: PointerDragged, reads: ReadsWithTextMeasurer): PageState {
  let live = livePointedReference(state);
  if (live === null) return state;
  let layout = layoutOfView(state, reads);
  let { rows: rowsFrozen, columns: columnsFrozen } = scrollPositionInLines(state, layout);
  let grownSoFar = rowsFrozen.under + columnsFrozen.under > 0 ? pointedArea(reads, live) : null;
  let { anchor, whole } = live;
  let hit = dragPositionClearOfStuckHeaders(pointer, state, reads, layout, {
    of: whole ?? columnSpanAt,
    fromRow: reads.positionOfCell(anchor)?.rowIndex ?? 0,
    grownSoFar,
  });
  let growsAlong = {
    rows: whole !== 'columns',
    columns: whole !== 'rows',
  };
  let cellId = reads.cellIdAt(state.sheetId, growsAlong.rows ? hit.rowIndex : 0, growsAlong.columns ? hit.columnIndex : 0);
  if (cellId === null) return state;
  if (isSameCell(cellId, live.at)) {
    if (hit.isToComeClearOf === undefined) return state;
    let scrolled = scrollToShowPosition(state, reads, hit, growsAlong, 'pointer');
    return scrolled.scrollTop !== state.scrollTop || scrolled.scrollLeft !== state.scrollLeft ? scrolled : state;
  }
  let pointedState = writeReferenceIntoEntry(state, reads, live, '', {
    anchor,
    at: cellId,
    whole,
  });
  return scrollToShowPosition(pointedState, reads, hit, growsAlong, 'pointer');
}
export function shouldArrowsMoveText(mode: EditingMode, caret: EntryCaret, pointedReference: PointedReferenceWritten | null): boolean {
  let { text, arrowsActOn } = mode;
  if (arrowsActOn === 'text' || caret.isPlacedByHand === true || caret.start !== caret.end) return false;
  let atCaret = pointedReferenceAtCaret(pointedReference, text, caret);
  if (atCaret !== null && atCaret.whole === null) return true;
  return !isEntryUntouchedAt(mode, caret) && referenceSlotAt(text, caret)?.written === null;
}
export function movePointedReference(
  state: PageState,
  reads: ReadsWithTextMeasurer,
  caret: EntryCaret,
  { rowDelta, columnDelta, isToEdgeOfData, isStretching }: PointAtCellsAct,
): PageState {
  let delta = {
    rowDelta,
    columnDelta,
  };
  if (state.mode.kind !== 'editing') return state;
  let atCaret = pointedReferenceAtCaret(state.pointedReference, state.mode.text, caret);
  let slot = atCaret ?? referenceSlotAt(state.mode.text, caret);
  let homeCell =
    state.sheetId === state.activeCell.sheetId
      ? state.activeCell
      : state.placesLeft.find(({ sheetId: placeLeft }) => placeLeft === state.sheetId)?.activeCell;
  if (slot === null || homeCell === undefined) return state;
  const livePointed = [atCaret?.anchor, atCaret?.at].some(
    (cell) => cell?.sheetId !== state.sheetId || reads.positionOfCell(cell) === null,
  )
    ? null
    : atCaret;
  const stretchesIt = livePointed !== null && !isPointedReferenceEmpty(livePointed) && isStretching;
  let startSelection = stretchesIt
    ? {
        activeCell: livePointed.anchor,
        selectionCorner: livePointed.at,
      }
    : selectionAtCell(livePointed?.at ?? homeCell);
  let mergeCameTo = (livePointed === null && homeCell === state.activeCell ? state : livePointed)?.cameToMergedCellsAt ?? null;
  let isStillInMerge = mergeCameTo !== null && isSameCell(anchorCellOf(reads, mergeCameTo), startSelection.activeCell);
  let stateAtStart: PageState = {
    ...state,
    ...startSelection,
    cameToMergedCellsAt: isStillInMerge && !stretchesIt ? mergeCameTo : null,
  };
  let moved = isToEdgeOfData
    ? jumpOrExtendSelection(
        stateAtStart,
        reads,
        {
          kind: 'edgeOfData',
          ...delta,
        },
        stretchesIt,
      )
    : stretchesIt
      ? extendSelectionByKey(stateAtStart, reads, delta)
      : moveActiveCellTo(stateAtStart, reads, cellAfterKeyMove(stateAtStart, reads, delta));
  let { activeCell: anchor, selectionCorner: at, scrollLeft, scrollTop } = moved;
  let isAnchorSame = livePointed === null || isSameCell(anchor, livePointed.anchor);
  if (isSameCell(at, startSelection.selectionCorner) && isAnchorSame) return state;
  let { cameToMergedCellsAt } = moved;
  let pointing: CellsPointedAt = {
    anchor,
    at,
    whole: null,
    cameToMergedCellsAt,
  };
  return writeReferenceIntoEntry(
    {
      ...state,
      scrollLeft,
      scrollTop,
    },
    reads,
    slot,
    '',
    pointing,
  );
}
export function pickUpReferenceAtCaret(state: PageState, reads: ReadsWithTextMeasurer, caret: EntryCaret): PageState | null {
  if (state.mode.kind !== 'editing') return null;
  let { text } = state.mode;
  let slot = referenceSlotAt(text, caret);
  if (slot === null) return null;
  let { written } = slot;
  if (written === null) {
    let { start, end } = caret;
    let { activeCell: anchor, activeCell: at, cameToMergedCellsAt } = state;
    return start === end
      ? {
          ...state,
          pointedReference: {
            start,
            end,
            text,
            anchor,
            at,
            whole: null,
            cameToMergedCellsAt,
          },
        }
      : null;
  }
  let area = isWholeLineReference(written) ? null : areaOfWrittenReference(written, state, reads);
  if (area === null) return null;
  let corners = selectionOfArea(state, reads, area);
  let cornerPosition = corners === null ? null : reads.positionOfCell(corners.selectionCorner);
  if (corners === null || cornerPosition === null) return null;
  let { activeCell, selectionCorner } = corners;
  let { start: writtenStart, end: writtenEnd } = written;
  return scrollToShowPosition(
    {
      ...state,
      pointedReference: {
        start: writtenStart,
        end: writtenEnd,
        text,
        anchor: activeCell,
        at: selectionCorner,
        whole: null,
      },
    },
    reads,
    cornerPosition,
    BOTH_AXES,
    'key',
  );
}
export function toggleArrowsTarget(state: PageState, reads: ReadsWithTextMeasurer, caret: EntryCaret): PageState {
  let { mode, pointedReference } = state;
  if (mode.kind !== 'editing') return state;
  if (shouldArrowsMoveText(mode, caret, pointedReference))
    return {
      ...state,
      mode: {
        ...mode,
        arrowsActOn: 'text',
      },
      lastDone: {
        what: 'arrowsGivenTo',
        to: 'text',
      },
    };
  let stateWithCells: PageState & { mode: EditingMode } = {
    ...state,
    mode: {
      ...mode,
      arrowsActOn: 'cells',
    },
  };
  if (shouldArrowsMoveText(stateWithCells.mode, caret, pointedReference))
    return {
      ...stateWithCells,
      lastDone: {
        what: 'arrowsGivenTo',
        to: 'cells',
      },
    };
  let pickedUp = pickUpReferenceAtCaret(stateWithCells, reads, caret);
  if (pickedUp !== null)
    return {
      ...pickedUp,
      lastDone: {
        what: 'arrowsGivenTo',
        to: 'cells',
      },
    };
  return {
    ...stateWithCells,
    lastDone: {
      what: 'arrowsGivenTo',
      to: 'cellsElsewhere',
    },
  };
}
/** The text with the `$` signs of the reference at the caret cycled, and the caret after it; `null` where no reference is there. */
export function cycleReferenceDollars(text: string, caret: EntryCaret): { text: string; caretAt: number } | null {
  let written = referenceSlotAt(text, caret)?.written ?? null;
  if (written === null) return null;
  let { dollarOfColumn, dollarOfRow } =
    written.ends.find(({ letters, digits }) => letters !== '' && digits !== '') ?? written.ends[0];
  let columnDollar = dollarOfColumn === '$' ? '' : '$';
  let rowDollar = dollarOfColumn === dollarOfRow ? '$' : '';
  let rewritten = '';
  let copiedTo = written.start;
  for (let { start: endStart, end: endEnd, letters, digits } of written.ends) {
    let columnPart = letters === '' ? '' : `${columnDollar}${letters}`;
    let rowPart = digits === '' ? '' : `${rowDollar}${digits}`;
    rewritten += `${text.slice(copiedTo, endStart)}${columnPart}${rowPart}`;
    copiedTo = endEnd;
  }
  return {
    text: `${text.slice(0, written.start)}${rewritten}${text.slice(written.end)}`,
    caretAt: written.start + rewritten.length,
  };
}
export function pointedCellsTip(
  { pointedReference, dragging, formulaHelp, mode }: Pick<PageState, 'pointedReference' | 'dragging' | 'formulaHelp' | 'mode'>,
  reads: WorkbookReads,
): PointedCellsTip | null {
  if (pointedReference === null || pointedReference.start === pointedReference.end || dragging?.kind === 'pointing') return null;
  if (pointedReferenceAtCaret(pointedReference, pointedReference.text, caretOrEnd(pointedReference.text, formulaHelp.caret ?? undefined)) === null)
    return null;
  let anchorCell = anchorCellOf(reads, pointedReference.anchor);
  let isOneCell = pointedReference.whole === null && isSameCell(anchorCell, anchorCellOf(reads, pointedReference.at));
  return {
    cells: pointedReference.text.slice(pointedReference.start, pointedReference.end),
    text: isOneCell ? cellShownText(reads.cellOnShowIn(anchorCell), reads.decimalSign) : null,
    doArrowsMoveIt: mode.kind === 'editing' && mode.arrowsActOn !== 'text' && pointedReference.whole === null,
  };
}
export function dropPointedReference(state: PageState): PageState {
  let { pointedReference, dragging } = state;
  if (pointedReference === null && dragging?.kind !== 'pointing') return state;
  if (livePointedReference(state) !== null) return state;
  return {
    ...state,
    pointedReference: null,
    dragging: dragging?.kind === 'pointing' ? null : dragging,
  };
}
export const REFERENCE_HUES: readonly string[] = ['violet', 'green', 'magenta', 'aqua', 'orange'];
export const referenceHue = (index: number): string => REFERENCE_HUES[index % REFERENCE_HUES.length] ?? REFERENCE_HUES[0];
export const NO_REFERENCES: ReferenceInEntry[] = [];
export const hasLetteredEnd = ({ ends }: WrittenReference): boolean => ends.some(({ letters }) => letters !== '');
export const REFERENCE_MAY_FOLLOW_PATTERN = /[=+\-*/(,;:^<>&]\s*$/;
export const REFERENCE_MAY_PRECEDE_PATTERN = /^\s*(?:$|[=+\-*/),;:^<>&%])/;
export const caretOrEnd = (text: string, caret: EntryCaretInText | undefined): EntryCaret =>
  caret?.text === text
    ? caret
    : {
        start: text.length,
        end: text.length,
      };
/** Whether the entry holds the text it opened with, not typed over: the caret then is where the page put it. */
export const isEntryUntouched = (mode: PageMode): boolean =>
  mode.kind === 'editing' && mode.isTypedOverCell !== true && mode.text === mode.textAtStart;
export const isEntryUntouchedAt = (mode: PageMode, caret: EntryCaret): boolean => isEntryUntouched(mode) && caret.isPlacedByHand !== true;
export const isPointedReferenceEmpty = ({ start, end, anchor, at }: PointedReferenceWritten): boolean =>
  start === end && isSameCell(anchor, at);
/** The pointed reference, while the entry still holds the text it was written into. */
export const livePointedReference = ({ mode, pointedReference }: Pick<PageState, 'mode' | 'pointedReference'>): PointedReferenceWritten | null =>
  mode.kind === 'editing' && mode.text === pointedReference?.text ? pointedReference : null;
export const WHOLE_OF_HEADER_KIND: Record<Exclude<GridHit['kind'], 'corner'>, PointedWhole | null> = {
  cell: null,
  rowHeader: 'rows',
  columnHeader: 'columns',
};
export const pointedReferenceAtCaret = (
  pointedReference: PointedReferenceWritten | null,
  text: string,
  caret: CaretSpan,
): PointedReferenceWritten | null =>
  pointedReference?.text === text && caret.start === pointedReference.end && caret.end === pointedReference.end ? pointedReference : null;
export const isEditingSameText = ({ mode }: Pick<PageState, 'mode'>, { text, typingIn }: Pick<EditingMode, 'text' | 'typingIn'>): boolean =>
  mode.kind === 'editing' && mode.typingIn === typingIn && mode.text === text;
