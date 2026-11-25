import type { NumberFormatOrControlChoice } from '../../format/number-format-choices.ts';
import type { SeenKindOfCells, SelectionSeen } from '../../state/selection-seen.ts';
import type { PageView } from '../../view/page-view.ts';
/** A tool of the part of the toolbar that changes with what is selected. */
export type ContextTool =
  | 'sort'
  | 'insertDropdown'
  | 'insertPerson'
  | 'insertDate'
  | 'insertCheckbox'
  | 'fontSize'
  | 'optionsOfDropdown'
  | 'checkAll'
  | 'uncheckAll'
  | 'fewerDecimalPlaces'
  | 'moreDecimalPlaces'
  | 'currency'
  | 'percent'
  | 'sum'
  | 'insertColumns'
  | 'insertRows'
  | 'wrapText'
  | 'asDropdown'
  | 'asCheckbox'
  | 'mergeCells'
  | 'unmergeCells';
/** What the selection is, as the context tools tell it apart: each has its own tools. */
export type ContextToolsShape =
  | 'empty'
  | 'text'
  | 'trueOrFalse'
  | 'neverWraps'
  | 'date'
  | 'number'
  | 'checkbox'
  | 'person'
  | 'dropdown'
  | 'numbers'
  | 'dates'
  | 'dropdowns'
  | 'checkboxes'
  | 'people'
  | 'severalTrueOrFalse'
  | 'emptyCells'
  | 'cells'
  | 'columns'
  | 'rows'
  | 'merged'
  | 'mergedOnly';
/** The shape the context tools show, and the selection they last followed. */
export interface ContextToolsState {
  shown: ContextToolsShape;
  hasSortAndFilter: boolean;
  /** The selection the person left, while the tools are held on it; `null` once they follow the selection again. */
  actSeen: SelectionSeen | null;
}
/** Whether the context tools stay as they are for now. */
export interface ContextToolsHold {
  isHeld: boolean;
  isRestedOn: boolean;
}
/** How many context tools the bar has room for, or all of them on a row that swipes. */
export type ContextToolSlots = number | 'all';
/** What else decides which context tools are shown. */
export interface ContextToolFitOptions {
  hasSortAndFilter?: boolean;
  formatsThatFit?: NumberFormatOrControlChoice[];
  isByFinger?: boolean;
}
export function contextToolsShapeOf({
  cellsAre,
  isSoOfEveryCell,
  areAllRead,
  shape,
}: SelectionSeen): ContextToolsShape {
  if (shape === 'cells') {
    let severalShape = SEVERAL_CELLS_SHAPE_OF_KIND[cellsAre];
    return severalShape !== undefined && (isSoOfEveryCell || severalShape === 'numbers' || (severalShape === 'checkboxes' && areAllRead))
      ? severalShape
      : 'cells';
  }
  if (shape !== 'cell') return shape;
  if (cellsAre === 'trueOrFalse' && !isSoOfEveryCell) return 'neverWraps';
  return cellsAre === 'mixed' ? 'text' : cellsAre;
}
export function nextContextToolsState(
  state: ContextToolsState,
  selection: Pick<PageView, 'selectionSeen' | 'selectionLeftByPerson' | 'isSortAndFilterOnBar'>,
  { isHeld, isRestedOn }: ContextToolsHold,
): ContextToolsState {
  let isFirstSeen = state.actSeen === null;
  if (isHeld && !isFirstSeen) return state;
  let actSeen = isHeld || isRestedOn ? selection.selectionLeftByPerson : null;
  if (actSeen === state.actSeen && !isFirstSeen) return state;
  let shown = contextToolsShapeOf(isFirstSeen || actSeen === null ? selection.selectionSeen : actSeen);
  let isSortAndFilterOnBar2 = selection.isSortAndFilterOnBar;
  return shown === state.shown && isSortAndFilterOnBar2 === state.hasSortAndFilter && actSeen === state.actSeen
    ? state
    : {
        shown,
        hasSortAndFilter: isSortAndFilterOnBar2,
        actSeen,
      };
}
export function contextToolSlotCount(toolsOffBar: string[], isSwipedRow: boolean): ContextToolSlots {
  if (isSwipedRow) return 'all';
  return toolsOffBar.includes('section') ? 0 : 4;
}
export function contextToolsOfShape(shape: ContextToolsShape, { hasSortAndFilter = false, formatsThatFit }: ContextToolFitOptions): ContextTool[] {
  let tools =
    (formatsThatFit?.includes('dropdown') ?? true)
      ? CONTEXT_TOOLS_OF_SHAPE[shape]
      : CONTEXT_TOOLS_OF_SHAPE[shape].filter((tool) => tool !== 'asDropdown');
  return hasSortAndFilter && !tools.includes('sort') ? ['sort', ...tools] : tools;
}
export function contextToolsThatFit(shape: ContextToolsShape, slots: ContextToolSlots, options: ContextToolFitOptions = {}): ContextTool[] {
  let roomLeft = slots === 'all' ? 1 / 0 : slots * (CONTEXT_TOOL_WIDTH + CONTEXT_TOOL_GAP);
  let toolsThatFit = new Set(
    contextToolsOfShape(shape, options).filter((tool) => {
      if (tool === 'mergeCells' && shape === 'dates' && options.hasSortAndFilter === true && slots !== 'all') return false;
      let widthWithGap =
        (tool === 'wrapText' && options.isByFinger === true ? CONTEXT_TOOL_WIDTH : (CONTEXT_TOOL_WIDTHS[tool] ?? CONTEXT_TOOL_WIDTH)) +
        CONTEXT_TOOL_GAP;
      if (widthWithGap > roomLeft) return false;
      roomLeft -= widthWithGap;
      return true;
    }),
  );
  return CONTEXT_TOOLS_IN_ORDER.filter((tool) => toolsThatFit.has(tool));
}
export function contextToolsLeftOver(shape: ContextToolsShape, slots: ContextToolSlots, options: ContextToolFitOptions = {}): ContextTool[] {
  let shownTools = contextToolsThatFit(shape, slots, options);
  let allTools = contextToolsOfShape(shape, options);
  return CONTEXT_TOOLS_IN_ORDER.filter((tool) => allTools.includes(tool) && !shownTools.includes(tool));
}
export const SEVERAL_CELLS_SHAPE_OF_KIND: Partial<Record<SeenKindOfCells, ContextToolsShape>> = {
  number: 'numbers',
  date: 'dates',
  dropdown: 'dropdowns',
  checkbox: 'checkboxes',
  person: 'people',
  trueOrFalse: 'severalTrueOrFalse',
  empty: 'emptyCells',
};
export const CONTEXT_TOOLS_IN_ORDER: ContextTool[] = [
  'sort',
  'insertDropdown',
  'insertPerson',
  'insertDate',
  'insertCheckbox',
  'fontSize',
  'optionsOfDropdown',
  'checkAll',
  'uncheckAll',
  'fewerDecimalPlaces',
  'moreDecimalPlaces',
  'currency',
  'percent',
  'sum',
  'insertColumns',
  'insertRows',
  'wrapText',
  'asDropdown',
  'asCheckbox',
  'mergeCells',
  'unmergeCells',
];
export const CONTEXT_TOOLS_OF_SHAPE: Record<ContextToolsShape, ContextTool[]> = {
  empty: ['insertDropdown', 'insertPerson', 'insertDate', 'insertCheckbox'],
  text: ['fontSize', 'wrapText', 'asDropdown'],
  trueOrFalse: ['fontSize', 'asCheckbox'],
  neverWraps: ['fontSize'],
  date: ['fontSize'],
  number: ['fewerDecimalPlaces', 'moreDecimalPlaces', 'currency', 'percent'],
  checkbox: [],
  person: ['wrapText'],
  dropdown: ['optionsOfDropdown'],
  numbers: ['fewerDecimalPlaces', 'moreDecimalPlaces', 'sum'],
  dates: ['fontSize', 'mergeCells'],
  dropdowns: ['optionsOfDropdown'],
  checkboxes: ['checkAll', 'uncheckAll'],
  people: ['wrapText'],
  severalTrueOrFalse: ['fontSize', 'asCheckbox', 'mergeCells'],
  emptyCells: ['insertDropdown', 'insertPerson', 'insertDate', 'insertCheckbox'],
  cells: ['fontSize', 'wrapText', 'mergeCells'],
  columns: ['sort', 'insertColumns', 'wrapText'],
  rows: ['insertRows', 'wrapText'],
  merged: ['unmergeCells', 'fontSize', 'wrapText'],
  mergedOnly: ['unmergeCells', 'fontSize', 'wrapText'],
};
export const CONTEXT_TOOL_WIDTHS: Partial<Record<ContextTool, number>> = {
  fontSize: 41,
  optionsOfDropdown: 92,
  sum: 44,
  insertColumns: 44,
  insertRows: 44,
  wrapText: 44,
};
export const CONTEXT_TOOL_WIDTH = 28;
export const CONTEXT_TOOL_GAP = 4;
