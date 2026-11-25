import type { SheetId } from '@open-artifact/sheets-core';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { PageContext } from '../state/event-reducer.ts';
import type { PageState } from '../state/initial-state.ts';
import type { SeenKindOfCells, SelectionSeen } from '../state/selection-seen.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { CellArea } from './model.ts';
import { nonEmptyValueOfCell, DATE_TIME_FORMAT_KINDS } from './figures.ts';
import { numberFormatOfCell } from '../model/workbook.ts';
import { cellTextLayout } from '../grid/text-overflow.ts';
import { readCellLink } from '../links/cell-links.ts';
import { withNoEffects } from '../state/transitions.ts';
import { actOnEveryRange, areasOfAllRanges } from './several-ranges.ts';
import { selectedArea, selectionOfArea } from './model.ts';
import { cellBlockOfSelection } from '../model/cell-blocks.ts';
import { queueEdit, IF_QUEUED_DEFAULTS } from '../model/edit-effects.ts';
import { isEntryWorkPending } from '../editor/unanswered-entries.ts';
import { clearSelectedCells } from '../editor/start-entry.ts';
/** What a cell is seen as: its control, a person, a date, a number, text, a true or false, or a value that never wraps. */
export type SeenKindOfCell = Exclude<SeenKindOfCells, 'empty' | 'mixed'>;
/** What the cells of a selection are seen as, and whether every cell was read. */
export type CellsSeen = Pick<SelectionSeen, 'cellsAre' | 'isSoOfEveryCell' | 'areAllRead'>;
/** How cells are cleared: by a key, or from a menu with or without the keyboard. */
export type ClearHow = 'key' | 'menu' | 'menuWithNoKeyboard';
export function seenKindOfCell(reads: WorkbookReads, cellId: CellId): SeenKindOfCell | null {
  let format = reads.formatOf(cellId);
  let controlKind = format.cellControl.kind;
  if (controlKind !== 'none') return controlKind;
  let cell = reads.cellOf(cellId);
  let inputKind = cell?.input.kind;
  if (inputKind === 'user' || inputKind === 'users') return 'person';
  let shownValue = nonEmptyValueOfCell(reads, cellId);
  if (shownValue === null) return null;
  if (shownValue.kind === 'number') return DATE_TIME_FORMAT_KINDS.has(numberFormatOfCell(reads, cellId).kind) ? 'date' : 'number';
  if (
    cellTextLayout(shownValue, {
      isMerged: false,
      isTypedIn: false,
      isOfDropdown: false,
      hasFilterButton: false,
      isPerson: false,
      linkDrawnAs: readCellLink(cell, format)?.drawnAs ?? null,
      isFormulaShown: false,
      wrappingByFormat: 'wrap',
      holdsList: false,
      hasRoomToWrap: true,
    }) === 'wrap'
  )
    return 'text';
  return shownValue.kind === 'boolean' ? 'trueOrFalse' : 'neverWraps';
}
export function cellsSeenIn(reads: WorkbookReads, sheetId: SheetId, areas: readonly CellArea[]): CellsSeen {
  let kind: SeenKindOfCells = 'empty';
  let hasHeadingText = false;
  let [isCut, hasUnseenKind, hasSpillOrUnshownCell]: [boolean, boolean, boolean] = [false, false, false];
  let dropdownIds = new Set<string | undefined>();
  let cellsLeft = MAX_CELLS_SEEN;
  for (let { topRowIndex, leftColumnIndex, rowCount, columnCount } of areas) {
    let rowsSeen = Math.min(rowCount, Math.max(topRowIndex === 0 ? 2 : 1, Math.floor(cellsLeft / columnCount)));
    cellsLeft -= rowsSeen * columnCount;
    isCut ||= rowsSeen < rowCount;
    for (let rowOffset = 0; rowOffset < rowsSeen; rowOffset += 1)
      for (let columnOffset = 0; columnOffset < columnCount; columnOffset += 1) {
        let cellId = reads.cellIdAt(sheetId, topRowIndex + rowOffset, leftColumnIndex + columnOffset);
        let cellKind = cellId === null ? null : seenKindOfCell(reads, cellId);
        let isHeading =
          cellKind !== null && (cellKind === 'text' || NON_WRAPPING_SEEN_KINDS.has(cellKind)) && topRowIndex + rowOffset === 0 && rowCount > 1;
        hasHeadingText ||= isHeading;
        hasUnseenKind ||= cellKind === null;
        if (cellId === null) continue;
        hasSpillOrUnshownCell ||= reads.spilledCellOf(cellId) !== null || (cellKind === null && reads.cellOf(cellId) !== null);
        if (cellKind === null || isHeading) continue;
        if (cellKind === 'dropdown') dropdownIds.add(reads.dropdownOf(cellId)?.dropdownId);
        if (kind === 'empty' || kind === cellKind) kind = cellKind;
        else if (NON_WRAPPING_SEEN_KINDS.has(kind) && NON_WRAPPING_SEEN_KINDS.has(cellKind)) kind = 'neverWraps';
        else
          return {
            cellsAre: 'mixed',
            isSoOfEveryCell: false,
            areAllRead: false,
          };
      }
  }
  return {
    cellsAre: kind === 'empty' && hasHeadingText ? 'text' : kind,
    isSoOfEveryCell: !isCut && !hasHeadingText && !hasSpillOrUnshownCell && (kind === 'empty' || !hasUnseenKind) && dropdownIds.size <= 1,
    areAllRead: !isCut,
  };
}
export function removeDropdownOfSelection(state: PageState, reads: WorkbookReads, how: ClearHow | null = null): PageTransition {
  if (!canRemoveDropdown(state, reads)) return withNoEffects(state);
  return actOnEveryRange(state, (stateOfRange: PageState) => {
    let area = selectedArea(stateOfRange, reads);
    let selection = area === null ? null : selectionOfArea(stateOfRange, reads, area);
    let cells = selection === null ? null : cellBlockOfSelection(stateOfRange, reads, selection);
    if (cells === null) return withNoEffects(stateOfRange);
    return queueEdit(
      stateOfRange,
      {
        kind: 'formatCells',
        cells,
        format: {
          cellControl: {
            kind: 'none',
          },
        },
      },
      {
        ...IF_QUEUED_DEFAULTS,
        select: how === 'key' ? stateOfRange : null,
        done: 'dropdownRemoved',
        ...(how !== null && {
          leavesLineRoundCopy: true,
        }),
      },
    );
  });
}
export function clearCellsOrDropdown(state: PageState, env: PageContext, how: ClearHow): PageTransition {
  let { reads } = env;
  return how !== 'menuWithNoKeyboard' &&
    canRemoveDropdown(state, reads) &&
    !isEntryWorkPending(state, env) &&
    areasOfAllRanges(state, reads).every((area: CellArea) => reads.cellsOnShowIn(state.sheetId, area).length === 0)
    ? removeDropdownOfSelection(state, reads, how)
    : actOnEveryRange(state, (stateOfRange: PageState) => clearSelectedCells(stateOfRange, reads, how));
}
export const NON_WRAPPING_SEEN_KINDS = new Set<SeenKindOfCells>(['trueOrFalse', 'neverWraps']);
export const MAX_CELLS_SEEN = 2000;
export const canRemoveDropdown = (state: PageState, reads: WorkbookReads): boolean =>
  state.selectionSeen.cellsAre === 'dropdown' &&
  areasOfAllRanges(state, reads).reduce(
    (total: number, { rowCount, columnCount }: CellArea) => total + rowCount * columnCount,
    0,
  ) <= MAX_CELLS_SEEN;
