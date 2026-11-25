import type {
  CellAt,
  CellBlock,
  CellControl,
  Color,
  ColumnId,
  DropdownContents,
  DropdownToPointAt,
  Edit,
  EditOf,
  OptionToMake,
  SharedCellFormat,
  SheetId,
  StretchOfADropdown,
} from '@open-artifact/sheets-core';
import { areaToA1AsStored } from '../formulas/from-words/where.ts';
import { ownRowOrderOfSheet } from '../model/line-ids.ts';
import {
  selectionKindOf,
  selectionOfArea,
  selectedArea,
  activeAnchorCell,
  selectionAtCell,
  moveActiveCellTo,
  mergedAreaOrCellOf,
  isAnchorOfActiveCell,
  isSameCell,
  anchorCellOf,
} from '../selection/model.ts';
import { layoutOfView } from '../grid/layout.ts';
import { sharedFormatOfSelection } from '../selection/keyboard.ts';
import { MAX_ROWS_UP_TO_HEADING } from '../format/conditional/descriptions.ts';
import { cellValueOf, cellPlainText } from '../model/cell-values.ts';
import { foldLabelCase, dropdownAtCell, isSameOptionLabel, MAX_DROPDOWN_OPTIONS, OPTION_LABEL_SHOWN_LENGTH } from './dropdown-options.ts';
import { withNoEffects } from '../state/transitions.ts';
import {
  openDropdownListOrEditor,
  openDropdownEditorAt,
  openDropdownEditor,
  withDropdownPane,
  dropdownAtActiveCell,
  closeDropdownList,
  chosenReadySetKey,
} from './dropdowns.ts';
import { cellBlockOfSelection, shownCellBlockOfCorners } from '../model/cell-blocks.ts';
import {
  isOptionSetSameAs,
  EMPTY_TYPED_OPTION,
  editorOptionsOf,
  cleanOptionLabel,
  optionsAfterTypedLabel,
  pasteOptionLabels,
  everyOptionColorOffer,
  changedCellsTyped,
  commitTypedOption,
  chosenOptionSetKey,
  optionsFromReadySet,
} from './dropdown-pane-edits.ts';
import { queueEdit, IF_QUEUED_DEFAULTS, queueEdits, withIfQueued } from '../model/edit-effects.ts';
import {
  colorOptionsAutomatically,
  colorForAddedOption,
  assignOptionColors,
  isDropdownDeliberatelyUncolored,
  withoutOptionColors,
} from './dropdown-colors.ts';
import { filteredRowRunsIn } from '../tables/filtered-rows.ts';
import { isInSpan } from '../grid/geometry.ts';
import { dropdownEditorOfPane } from '../state/queries.ts';
import { NO_COLOR, colorsEqual } from '../model/colors.ts';
import { parseA1AreasAsSeen } from '../model/a1-references.ts';
import type {
  DropdownCellsRefused,
  DropdownClearedCellsOffer,
  DropdownOptionDeletedOffer,
  DropdownOptionMovedDone,
  DropdownOptionRemovedDone,
  DropdownOptionsAddedDone,
  DropdownReach,
  HeaderRowSetDone,
  OptionOfDropdownInPane,
  PageState,
  UndoOfferMadeDone,
  WhyDropdownCellsRefused,
} from '../state/initial-state.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { CellArea, CellSelection } from '../selection/model.ts';
import type { DropdownPresetKey, LocalizedDropdownPreset, NamedDropdownPreset } from '../i18n/chip-labels.ts';
import type { DropdownEditTarget, DropdownEditor, EveryOptionColorOffer } from './dropdown-pane-edits.ts';
import type { IfQueued } from '../state/event-reducer.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { DropdownCommand } from '../format/format-commands.ts';
/** What to tell once a dropdown is given cells, and the offer to undo it when that cleared some of them. */
export interface DropdownClearingOffer {
  done: 'dropdownSet' | HeaderRowSetDone | UndoOfferMadeDone;
  undoOffer: DropdownClearedCellsOffer | null;
}
/** A heading above the cells of a column: its text, how many rows it takes, and the cells under it. */
export interface HeaderAboveDropdownCells {
  heading: string;
  top: number;
  under: CellArea;
  corners: CellSelection;
}
/** The cells a new dropdown goes to, the format they share, the cell to open, and the heading left out above them. */
export interface DropdownTarget {
  selected: CellArea;
  corners: CellSelection;
  shared: SharedCellFormat;
  entryCell: CellId;
  heading: string | null;
  thenSelected: CellSelection | null;
}
/** What the selected cells say, for a dropdown made of them: how often each label, and how many formulas and other values. */
export interface DropdownSelectionSummary {
  isTaken: boolean;
  formulaCount: number;
  /** How many cells say each label, by its folded case. */
  said: Map<string, number>;
  otherCount: number;
}
/** A dropdown just above some cells, and the cells to give it. */
export interface DropdownToJoin {
  dropdown: DropdownContents;
  joining: CellArea;
}
/** The heading in the first row of a column, and how many rows it takes. */
export interface HeadingInFirstRow {
  text: string;
  rowCount: number;
}
interface HeadingOfColumn extends HeadingInFirstRow {
  columnIndex: number;
  sought: string;
}
/** Whether the heading above a dropdown's cells is one of them (`'on'`) or left out of them (`'off'`). */
export type HeaderRowState = 'on' | 'off';
/** Edits to make before and after the cells are set, and the options the cells are checked against. */
export interface DropdownCellsSetWith {
  optionsFirst?: Edit[];
  optionsLast?: Edit[];
  optionsByThen?: OptionOfDropdownInPane[];
}
/** An act in the dropdown editor of the side pane. */
export type DropdownEditorAct =
  | { kind: 'startOption' }
  | { kind: 'type'; optionId: string | null; label: string }
  | { kind: 'dropTyped' }
  | { kind: 'pasteNames'; optionId: string | null; labels: string[] }
  | { kind: 'enter'; thenStartsOption: boolean; optionId?: string | null }
  | { kind: 'setColor'; optionId: string | null; color: Color }
  | { kind: 'setColorOfEveryOption'; to: EveryOptionColorOffer }
  | { kind: 'remove'; optionId: string | null }
  | { kind: 'move'; optionId: string | null; toIndex: number }
  | { kind: 'chooseReach'; reach: DropdownReach }
  | { kind: 'typeCells'; text: string }
  | { kind: 'dropTypedCells' }
  | { kind: 'useSelection' }
  | { kind: 'enterCells'; isBeforeOtherEvent?: boolean }
  | { kind: 'setHeaderRow'; isOn: boolean }
  | { kind: 'startFrom'; set: LocalizedDropdownPreset | 'custom' };
export function dropdownClearingOffer(
  reads: WorkbookReads,
  area: CellArea,
  { activeCell, selectionCorner }: Pick<CellSelection, 'activeCell' | 'selectionCorner'>,
  dropdownChoice: DropdownToPointAt,
  headerRow: HeaderRowSetDone | null,
): DropdownClearingOffer | null {
  let cellsCleared =
    reads.filledCellsIn(activeCell.sheetId, area).length === 0
      ? {
          formulas: 0,
          others: 0,
        }
      : reads.cellsThatADropdownWouldClear(activeCell, selectionCorner, dropdownChoice);
  if (cellsCleared === null) return null;
  if (cellsCleared.formulas + cellsCleared.others === 0)
    return {
      done: headerRow ?? 'dropdownSet',
      undoOffer: null,
    };
  let undoOffer: DropdownClearedCellsOffer = {
    kind: 'dropdownClearedCells',
    cells: areaToA1AsStored(area, ownRowOrderOfSheet(reads, activeCell.sheetId)),
    isOneCell: area.rowCount * area.columnCount === 1,
    formulaCount: cellsCleared.formulas,
    otherCount: cellsCleared.others,
    isSaved: false,
  };
  return {
    done: {
      what: 'undoOfferMade',
      offer: undoOffer,
      ...(headerRow !== null && {
        headerRow,
      }),
    },
    undoOffer,
  };
}
export function headerAboveDropdownCells(state: PageState, reads: ReadsWithTextMeasurer, area: CellArea): HeaderAboveDropdownCells | null {
  let heading =
    area.columnCount === 1 && selectionKindOf(area, layoutOfView(state, reads)) === 'columns'
      ? headingsInFirstRow(reads, state.sheetId, area).get(area.leftColumnIndex)
      : undefined;
  if (heading === undefined) return null;
  let { text: headingText, rowCount: headingRows } = heading;
  let areaUnder = {
    ...area,
    topRowIndex: headingRows,
    rowCount: area.rowCount - headingRows,
  };
  let cornersUnder = selectionOfArea(state, reads, areaUnder);
  return cornersUnder === null
    ? null
    : {
        heading: headingText,
        top: headingRows,
        under: areaUnder,
        corners: cornersUnder,
      };
}
export function dropdownTargetOfSelection(state: PageState, reads: ReadsWithTextMeasurer): DropdownTarget | null {
  let sharedFormat = sharedFormatOfSelection(state, reads);
  let selected = selectedArea(state, reads);
  let corners = selected === null ? null : selectionOfArea(state, reads, selected);
  if (sharedFormat === null || selected === null || corners === null) return null;
  let target: DropdownTarget = {
    selected,
    corners,
    shared: sharedFormat,
    entryCell: activeAnchorCell(state, reads),
    heading: null,
    thenSelected: null,
  };
  let headerAbove = headerAboveDropdownCells(state, reads, selected);
  if (headerAbove === null) return target;
  let { heading, top: headingRows, under: areaUnder, corners: cornersUnder } = headerAbove;
  let { activeCell: firstCellUnder, selectionCorner: lastCellUnder } = cornersUnder;
  let sharedUnder = reads.sharedFormatBetween(firstCellUnder, lastCellUnder);
  if (sharedUnder === null || isCellUnderMerge(reads, firstCellUnder)) return target;
  let targetUnder = {
    selected: areaUnder,
    corners: cornersUnder,
    shared: sharedUnder,
    heading,
  };
  if ((reads.positionOfCell(state.activeCell)?.rowIndex ?? 0) >= headingRows)
    return {
      ...targetUnder,
      entryCell: target.entryCell,
      thenSelected: null,
    };
  let rangeWalked = {
    from: corners.activeCell,
    to: corners.selectionCorner,
    at: firstCellUnder,
  };
  return {
    ...targetUnder,
    entryCell: firstCellUnder,
    thenSelected: {
      ...selectionAtCell(firstCellUnder),
      rangeWalked,
    },
  };
}
export function readySetNamed(readySets: readonly NamedDropdownPreset[], label: string): LocalizedDropdownPreset | null {
  let squashedLabel = squashSetLabel(label);
  return readySets.find(({ label: presetLabel }) => squashSetLabel(presetLabel) === squashedLabel)?.set ?? null;
}
export function readySetNamedAbove(
  reads: WorkbookReads,
  sheetId: SheetId,
  { topRowIndex, leftColumnIndex, columnCount }: CellArea,
  readySets: readonly NamedDropdownPreset[],
): LocalizedDropdownPreset | null {
  if (columnCount !== 1) return null;
  let topmostRowIndex = Math.max(topRowIndex - MAX_ROWS_UP_TO_HEADING, 0);
  for (let rowIndex = topRowIndex - 1; rowIndex >= topmostRowIndex; rowIndex -= 1) {
    let cellId = reads.cellIdAt(sheetId, rowIndex, leftColumnIndex);
    if (cellId === null) continue;
    let mergedArea = reads.mergedAreaAt(sheetId, {
      rowIndex,
      columnIndex: leftColumnIndex,
    });
    if (mergedArea !== null && mergedArea.leftColumnIndex !== leftColumnIndex) return null;
    let cellOnShow = reads.cellOnShowIn(cellId);
    if (cellOnShow === null) continue;
    let shownValue = cellValueOf(cellOnShow);
    if (shownValue === null) return null;
    let readySet = shownValue.kind === 'text' ? readySetNamed(readySets, shownValue.value) : null;
    if (readySet !== null) return readySet;
    if (!(shownValue.kind === 'text' && squashSetLabel(shownValue.value) === '') && reads.dropdownOf(cellId) === null) return null;
  }
  return null;
}
export function dropdownSelectionSummary(state: PageState, reads: ReadsWithTextMeasurer): DropdownSelectionSummary | null {
  let target = dropdownTargetOfSelection(state, reads);
  if (target === null) return null;
  let { selected, shared: sharedFormat, entryCell } = target;
  let cellsOfDropdown = sharedFormat.cellControl?.kind === 'dropdown' ? reads.cellsOfTheDropdownAt(entryCell) : null;
  let filledCells = (
    cellsOfDropdown?.stretches.flatMap((stretch) => stretchArea(state, reads, stretch) ?? []) ?? [selected]
  ).flatMap((area) => reads.filledCellsIn(state.sheetId, area));
  let labelCounts = new Map<string, number>();
  let [formulaCount, otherCount] = [0, 0];
  for (let cellId of filledCells) {
    let cell = reads.cellOf(cellId);
    let label = cellsOfDropdown === null ? cellLabelText(reads, cellId) : cell?.dropdownOption?.label;
    if (label !== null && label !== undefined) labelCounts.set(foldLabelCase(label), (labelCounts.get(foldLabelCase(label)) ?? 0) + 1);
    else if (cellsOfDropdown !== null) continue;
    else if (cell?.input.kind === 'formula') formulaCount += 1;
    else otherCount += 1;
  }
  return {
    isTaken: sharedFormat.cellControl?.kind !== 'dropdown' || dropdownAtCell(reads, entryCell) !== null,
    formulaCount,
    said: labelCounts,
    otherCount,
  };
}
export function makeDropdownFromSelection(state: PageState, reads: ReadsWithTextMeasurer, command: DropdownCommand): PageTransition {
  let firstSet = command.firstSet ?? null;
  let target = dropdownTargetOfSelection(state, reads);
  if (target === null) return withNoEffects(state);
  let {
    selected,
    corners,
    shared: sharedFormat,
    entryCell,
    heading,
    thenSelected,
  } = target;
  let stateSelected =
    thenSelected === null
      ? state
      : {
          ...state,
          ...thenSelected,
        };
  let headerRowDone: HeaderRowSetDone | null =
    heading === null
      ? null
      : {
          what: 'headerRowSet',
          isOn: true,
          heading: clipHeading(heading),
          cells: areaToA1AsStored(selected, ownRowOrderOfSheet(reads, state.sheetId)),
        };
  let opensList = command.thenOpens === 'list';
  let { thenGoesOnTo } = command;
  let clearingOfferFor = (dropdownChoice: DropdownToPointAt) =>
    dropdownClearingOffer(reads, selected, corners, dropdownChoice, headerRowDone);
  if (sharedFormat.cellControl?.kind === 'dropdown') {
    let setToStartFrom = command.isReadySetPicked === true && dropdownAtCell(reads, entryCell) !== null ? firstSet : null;
    if (thenGoesOnTo !== undefined)
      return setToStartFrom === null
        ? withNoEffects(moveActiveCellTo(state, reads, thenGoesOnTo))
        : startDropdownFromSet(stateSelected, reads, setToStartFrom, thenGoesOnTo);
    let stateOpened = opensList ? openDropdownListOrEditor(stateSelected, reads) : openDropdownEditorAt(stateSelected, reads, entryCell);
    return setToStartFrom === null ? withNoEffects(stateOpened) : startDropdownFromSet(stateOpened, reads, setToStartFrom, entryCell);
  }
  let editCells = cellBlockOfSelection(state, reads, corners);
  if (editCells === null) return withNoEffects(state);
  let thenWhat: Pick<IfQueued, 'thenGoesOnTo' | 'thenDropdownList'> =
    thenGoesOnTo !== undefined
      ? {
          thenGoesOnTo,
        }
      : opensList
        ? {
            thenDropdownList: 'opens',
          }
        : {};
  let pickedSet = command.isReadySetPicked === true ? firstSet : null;
  let heldDropdown = reads.dropdownOf(entryCell);
  if (heldDropdown !== null && (pickedSet === null || isOptionSetSameAs(heldDropdown.options, pickedSet))) {
    let clearingOffer = clearingOfferFor({
      kind: 'held',
      dropdownId: heldDropdown.dropdownId,
    });
    if (clearingOffer === null) return withNoEffects(state);
    return queueEdit(
      state,
      cellControlEdit(editCells, {
        kind: 'dropdown',
        dropdownId: heldDropdown.dropdownId,
      }),
      {
        ...IF_QUEUED_DEFAULTS,
        select: thenSelected,
        ...clearingOffer,
        ...thenWhat,
      },
    );
  }
  let offeredLabels = pickedSet === null ? reads.dropdownOptionsToOffer(corners.activeCell, corners.selectionCorner) : [];
  if (offeredLabels === null) return withNoEffects(state);
  let dropdownAbove =
    heldDropdown === null && pickedSet === null ? dropdownToJoinAbove(reads, state.sheetId, selected, sharedFormat.cellControl === null) : null;
  let [firstJoinedOption, ...otherJoinedOptions] =
    dropdownAbove === null ? [] : (mergeOfferedOptions(dropdownAbove.dropdown.options, offeredLabels) ?? []);
  if (dropdownAbove !== null && firstJoinedOption !== undefined) {
    let { dropdown: joinedDropdown, joining } = dropdownAbove;
    let cornersJoining = selectionOfArea(state, reads, joining);
    let cellsJoining = cornersJoining === null ? null : cellBlockOfSelection(state, reads, cornersJoining);
    let labels = [firstJoinedOption, ...otherJoinedOptions].map(({ label }) => label);
    let clearingOffer =
      cornersJoining === null
        ? null
        : dropdownClearingOffer(
            reads,
            joining,
            cornersJoining,
            {
              kind: 'new',
              labels,
            },
            headerRowDone,
          );
    if (cellsJoining === null || clearingOffer === null) return withNoEffects(state);
    let { dropdownId } = joinedDropdown;
    let ifQueued: IfQueued = {
      ...IF_QUEUED_DEFAULTS,
      select: thenSelected,
      ...clearingOffer,
      ...(opensList
        ? thenWhat
        : {
            thenInDropdownEditor: 'opens',
          }),
    };
    let cellControlSet = cellControlEdit(cellsJoining, {
      kind: 'dropdown',
      dropdownId,
    });
    if (labels.length === joinedDropdown.options.length) return queueEdit(state, cellControlSet, ifQueued);
    let optionsEdit: EditOf<'setDropdownOptions'> = {
      kind: 'setDropdownOptions',
      sheetId: state.sheetId,
      dropdownId,
      options: [firstJoinedOption, ...otherJoinedOptions],
      appliesTo: {
        kind: 'everyCell',
      },
    };
    return queueEdits(state, [optionsEdit, cellControlSet], ifQueued, {
      isEachPointedAt: true,
    });
  }
  let isFromFirstSet = offeredLabels.length === 0 && firstSet !== null;
  let [firstOption, ...otherOptions] =
    pickedSet !== null
      ? pickedSet.options
      : isFromFirstSet
        ? (readySetNamedAbove(reads, state.sheetId, selected, command.setsByName ?? []) ?? firstSet).options
        : colorOptionsAutomatically(offeredLabels).map(newDropdownOption);
  if (firstOption !== undefined) {
    let clearingOffer = clearingOfferFor({
      kind: 'new',
      labels: [firstOption, ...otherOptions].map(({ label }) => label),
    });
    if (clearingOffer === null) return withNoEffects(state);
    return queueEdit(
      state,
      {
        kind: 'makeDropdown',
        cells: editCells,
        options: [firstOption, ...otherOptions],
      },
      {
        ...IF_QUEUED_DEFAULTS,
        select: thenSelected,
        ...clearingOffer,
        ...(opensList
          ? thenWhat
          : {
              thenInDropdownEditor: 'opens',
            }),
      },
    );
  }
  return withNoEffects(
    openDropdownEditor(state, reads, {
      dropdownId: null,
      options: [],
      stretches: [],
      indexOfOwnStretch: 0,
      reach: 'everyCell',
      typed: EMPTY_TYPED_OPTION,
      isCustom: false,
    }),
  );
}
export function dropdownToJoinAbove(reads: WorkbookReads, sheetId: SheetId, area: CellArea, mayJoinRows: boolean): DropdownToJoin | null {
  let { topRowIndex, rowCount, leftColumnIndex, columnCount } = area;
  if (columnCount !== 1) return null;
  let dropdownAtRow = (rowIndex: number) => {
    let cellId = reads.cellIdAt(sheetId, rowIndex, leftColumnIndex);
    return cellId === null ? null : reads.dropdownOf(cellId);
  };
  let dropdownAbove = dropdownAtRow(topRowIndex - 1);
  if (!mayJoinRows)
    return dropdownAbove === null
      ? null
      : {
          dropdown: dropdownAbove,
          joining: area,
        };
  let rowsWithout: number[] = [];
  for (let rowIndex = topRowIndex; rowIndex < topRowIndex + rowCount; rowIndex += 1) {
    let dropdownAtThisRow = dropdownAtRow(rowIndex);
    if (dropdownAtThisRow === null) rowsWithout.push(rowIndex);
    else if (dropdownAbove !== null && dropdownAbove.dropdownId !== dropdownAtThisRow.dropdownId) return null;
    else dropdownAbove = dropdownAtThisRow;
  }
  let [firstRowWithout, lastRowWithout] = [rowsWithout[0], rowsWithout.at(-1)];
  if (dropdownAbove === null || firstRowWithout === undefined || lastRowWithout === undefined) return null;
  if (lastRowWithout - firstRowWithout + 1 !== rowsWithout.length) return null;
  return {
    dropdown: dropdownAbove,
    joining: {
      ...area,
      topRowIndex: firstRowWithout,
      rowCount: rowsWithout.length,
    },
  };
}
export function mergeOfferedOptions(options: readonly OptionOfDropdownInPane[], offered: readonly { label: string }[]): OptionOfDropdownInPane[] | null {
  let merged = [...options];
  for (let { label } of offered)
    if (merged.every((option) => !isSameOptionLabel(option.label, label)))
      merged.push({
        optionId: null,
        label,
        color: colorForAddedOption(label, merged),
      });
  return merged.length > MAX_DROPDOWN_OPTIONS ? null : merged;
}
export function countCellsLosingOptions(
  state: PageState,
  reads: WorkbookReads,
  stretches: readonly StretchOfADropdown[],
  newOptions: readonly Pick<OptionOfDropdownInPane, 'optionId'>[],
  oldOptions: readonly Pick<OptionOfDropdownInPane, 'optionId'>[],
  skipsHeaderRows: boolean,
): number {
  let newIds = new Set(newOptions.map(({ optionId }) => optionId));
  let droppedIds = new Set(
    oldOptions.flatMap(({ optionId }) => (optionId === null || newIds.has(optionId) ? [] : optionId)),
  );
  if (droppedIds.size === 0) return 0;
  return stretches
    .flatMap((stretch) => stretchArea(state, reads, stretch) ?? [])
    .flatMap((area) => {
      let hiddenRuns = skipsHeaderRows ? filteredRowRunsIn(state, reads, area) : [];
      return hiddenRuns.length === 0
        ? reads.filledCellsIn(state.sheetId, area)
        : reads.filledCellsIn(state.sheetId, area).filter((cellId) => {
            let rowIndex = reads.positionOfCell(cellId)?.rowIndex ?? -1;
            return !hiddenRuns.some((run) => isInSpan(rowIndex, run.firstIndex, run.count));
          });
    })
    .filter((cellId) => {
      let optionId = reads.cellOf(cellId)?.dropdownOption?.optionId;
      return optionId !== undefined && droppedIds.has(optionId);
    }).length;
}
export function commitDropdownOptions(
  state: PageState,
  reads: WorkbookReads,
  editor: DropdownEditTarget,
  options: readonly OptionOfDropdownInPane[],
  thenInEditor: NonNullable<IfQueued['thenInDropdownEditor']>,
  startedFromSet?: DropdownPresetKey,
  /** What was done, before the cells it was done in are known. */
  done?: Omit<DropdownOptionsAddedDone, 'onlyIn'> | Omit<DropdownOptionRemovedDone, 'onlyIn'> | Omit<DropdownOptionMovedDone, 'onlyIn'>,
): PageTransition {
  let [firstOption, ...otherOptions] = options;
  if (firstOption === undefined) return withNoEffects(state);
  let ifQueued: Omit<IfQueued, 'done'> = {
    ...IF_QUEUED_DEFAULTS,
    select: null,
    leavesEntryOpen: true,
    thenInDropdownEditor: thenInEditor,
  };
  if (editor.dropdownId === null) {
    let selected = selectedArea(state, reads);
    let corners = selected === null ? null : selectionOfArea(state, reads, selected);
    if (selected === null || corners === null) return withNoEffects(state);
    let cells = cellBlockOfSelection(state, reads, corners);
    if (cells === null) return withNoEffects(state);
    let labels = options.map(({ label }) => label);
    let clearingOffer = dropdownClearingOffer(
      reads,
      selected,
      corners,
      {
        kind: 'new',
        labels,
      },
      null,
    );
    if (clearingOffer === null) return withNoEffects(state);
    return queueEdit(
      state,
      {
        kind: 'makeDropdown',
        cells,
        options: [newDropdownOption(firstOption), ...otherOptions.map(newDropdownOption)],
      },
      {
        ...ifQueued,
        ...clearingOffer,
      },
    );
  }
  let ownStretch = editor.stretches[editor.indexOfOwnStretch];
  let isEveryStretch = editor.reach === 'everyCell' || ownStretch === undefined || editor.stretches.length === 1;
  let stretchesTouched = isEveryStretch ? editor.stretches : [ownStretch];
  let rowsOfOwnStretch = isEveryStretch
    ? null
    : (({ top, bottom }: StretchOfADropdown) =>
        shownCellBlockOfCorners(state, reads, {
          sheetId: state.sheetId,
          oneCorner: top,
          otherCorner: bottom,
        }))(ownStretch);
  if (!isEveryStretch && rowsOfOwnStretch === null) return withNoEffects(state);
  let setOptionsEdit: EditOf<'setDropdownOptions'> = {
    kind: 'setDropdownOptions',
    sheetId: state.sheetId,
    dropdownId: editor.dropdownId,
    options: [firstOption, ...otherOptions],
    appliesTo:
      rowsOfOwnStretch === null
        ? {
            kind: 'everyCell',
          }
        : {
            kind: 'cellsInRows',
            rows: rowsOfOwnStretch.rows,
            oneColumn: rowsOfOwnStretch.oneColumn,
            otherColumn: rowsOfOwnStretch.otherColumn,
          },
  };
  let rangesText = stretchesTouched.map(({ range }) => range).join(', ');
  let onlyIn = isEveryStretch ? null : rangesText;
  let [
    { top: firstTop } = {
      top: null,
    },
  ] = stretchesTouched;
  let firstDropdown =
    firstTop === null
      ? null
      : reads.dropdownOf({
          sheetId: state.sheetId,
          rowId: firstTop.r,
          columnId: firstTop.c,
        });
  let clearedCount = countCellsLosingOptions(
    state,
    reads,
    stretchesTouched,
    options,
    editor.optionsByThen ?? firstDropdown?.options ?? [],
    !isEveryStretch,
  );
  if (done?.what === 'dropdownOptionRemoved' && clearedCount > 0) {
    let { label, isSaved } = done;
    let deletedOffer: DropdownOptionDeletedOffer = {
      kind: 'dropdownOptionDeleted',
      label,
      cellCount: clearedCount,
      onlyIn,
      isSaved,
    };
    return queueEdit(state, setOptionsEdit, {
      ...ifQueued,
      done: {
        what: 'undoOfferMade',
        offer: deletedOffer,
      },
      undoOffer: deletedOffer,
    });
  }
  return queueEdit(state, setOptionsEdit, {
    ...ifQueued,
    done:
      startedFromSet !== undefined
        ? {
            what: 'dropdownStartedFrom',
            set: startedFromSet,
            optionCount: options.length,
          }
        : done === undefined
          ? {
              what: 'dropdownOptionsSet',
              cells: rangesText,
            }
          : {
              ...done,
              onlyIn,
            },
    undoOffer:
      clearedCount === 0
        ? null
        : {
            kind: 'optionsGoneClearedCells',
            count: clearedCount,
            isSaved: false,
          },
  });
}
export function ownStretchArea(
  state: PageState,
  reads: WorkbookReads,
  { stretches, indexOfOwnStretch }: Pick<DropdownEditTarget, 'stretches' | 'indexOfOwnStretch'>,
): CellArea | null {
  let ownStretch = stretches[indexOfOwnStretch];
  return ownStretch === undefined ? null : stretchArea(state, reads, ownStretch);
}
export function stretchArea(state: PageState, reads: WorkbookReads, stretch: Pick<StretchOfADropdown, 'top' | 'bottom'>): CellArea | null {
  let positionOf = ({ r: rowId, c: columnId }: CellAt) =>
    reads.positionOfCell({
      sheetId: state.sheetId,
      rowId,
      columnId,
    });
  let [topPosition, bottomPosition] = [positionOf(stretch.top), positionOf(stretch.bottom)];
  return topPosition === null || bottomPosition === null
    ? null
    : {
        topRowIndex: topPosition.rowIndex,
        leftColumnIndex: topPosition.columnIndex,
        rowCount: bottomPosition.rowIndex - topPosition.rowIndex + 1,
        columnCount: 1,
      };
}
export function clipHeading(heading: string): string {
  let chars = Array.from(heading);
  let isClipped = chars.length > OPTION_LABEL_SHOWN_LENGTH;
  return `${chars.slice(0, OPTION_LABEL_SHOWN_LENGTH).join('')}${isClipped ? '…' : ''}`;
}
export function cellLabelText(reads: WorkbookReads, cellId: CellId | null): string | null {
  let cell = cellId === null ? null : reads.cellOf(cellId);
  let shownText = cellPlainText(cell);
  if (shownText !== null) return shownText;
  return cell?.input.kind === 'dropdownOption' ? (cell.dropdownOption?.label ?? cell.input.label) : null;
}
export function areaHasLabel(reads: WorkbookReads, sheetId: SheetId, area: CellArea, label: string): boolean {
  return reads.filledCellsIn(sheetId, area).some((cellId) => isSameOptionLabel(cellLabelText(reads, cellId) ?? '', label));
}
export function headingsInFirstRow(reads: WorkbookReads, sheetId: SheetId, area: CellArea): Map<number, HeadingInFirstRow> {
  let headings = new Map<ColumnId, HeadingOfColumn>();
  for (let columnIndex of reads.columnIndexesOnShowIn(sheetId, 0)) {
    let cellId = reads.cellIdAt(sheetId, 0, columnIndex);
    let isInArea = columnIndex >= area.leftColumnIndex && columnIndex < area.leftColumnIndex + area.columnCount;
    if (cellId === null || !isInArea) continue;
    if (reads.dropdownOf(cellId) !== null || isCellUnderMerge(reads, cellId)) continue;
    let text = cellLabelText(reads, cellId) ?? '';
    let rowCount = mergedAreaOrCellOf(reads, cellId)?.rowCount ?? 1;
    if (text.trim() !== '')
      headings.set(cellId.columnId, {
        text,
        rowCount,
        columnIndex,
        sought: foldLabelCase(text),
      });
  }
  for (let filledCell of headings.size === 0 ? [] : reads.filledCellsIn(sheetId, area)) {
    let heading = headings.get(filledCell.columnId);
    let text = heading === undefined ? null : cellLabelText(reads, filledCell);
    if (heading === undefined || text === null || foldLabelCase(text) !== heading.sought) continue;
    if ((reads.rowIndexOf(sheetId, filledCell.rowId) ?? 0) >= heading.rowCount) headings.delete(filledCell.columnId);
  }
  return new Map(
    Array.from(
      headings.values(),
      ({ columnIndex, text, rowCount }): [number, HeadingInFirstRow] => [
        columnIndex,
        {
          text,
          rowCount,
        },
      ],
    ),
  );
}
export function dropdownHeaderRowState(
  state: PageState,
  reads: WorkbookReads,
  editor: Pick<DropdownEditTarget, 'stretches' | 'indexOfOwnStretch'>,
): HeaderRowState | null {
  let ownArea = editor.stretches.length === 1 ? ownStretchArea(state, reads, editor) : null;
  if (ownArea === null || ownArea.topRowIndex > 1 || ownArea.topRowIndex + ownArea.rowCount < 2) return null;
  if ((cellLabelTextAt(reads, state.sheetId, 0, ownArea.leftColumnIndex) ?? '').trim() === '') return null;
  if (ownArea.topRowIndex === 0) return 'off';
  return isAreaWithoutDropdown(state, reads, {
    ...ownArea,
    topRowIndex: 0,
    rowCount: 1,
  })
    ? 'on'
    : null;
}
export function isAreaWithoutDropdown(state: PageState, reads: WorkbookReads, area: CellArea): boolean {
  let corners = selectionOfArea(state, reads, area);
  if (corners === null) return false;
  let cellControl = reads.sharedFormatBetween(corners.activeCell, corners.selectionCorner)?.cellControl ?? null;
  return cellControl !== null && cellControl.kind !== 'dropdown';
}
export function subtractArea(area: CellArea, cut: CellArea): CellArea[] {
  let [areaBottom, areaRight] = [area.topRowIndex + area.rowCount, area.leftColumnIndex + area.columnCount];
  let cutTop = Math.min(Math.max(cut.topRowIndex, area.topRowIndex), areaBottom);
  let cutBottom = Math.max(Math.min(cut.topRowIndex + cut.rowCount, areaBottom), cutTop);
  let cutLeft = Math.min(Math.max(cut.leftColumnIndex, area.leftColumnIndex), areaRight);
  let cutRight = Math.max(Math.min(cut.leftColumnIndex + cut.columnCount, areaRight), cutLeft);
  if (cutBottom === cutTop || cutRight === cutLeft) return [area];
  let cutRows = {
    topRowIndex: cutTop,
    rowCount: cutBottom - cutTop,
  };
  return [
    {
      ...area,
      rowCount: cutTop - area.topRowIndex,
    },
    {
      ...area,
      topRowIndex: cutBottom,
      rowCount: areaBottom - cutBottom,
    },
    {
      ...area,
      ...cutRows,
      columnCount: cutLeft - area.leftColumnIndex,
    },
    {
      ...area,
      ...cutRows,
      leftColumnIndex: cutRight,
      columnCount: areaRight - cutRight,
    },
  ].filter(({ rowCount, columnCount }) => rowCount > 0 && columnCount > 0);
}
export function setDropdownCells(
  state: PageState,
  reads: WorkbookReads,
  area: CellArea,
  selectsArea: boolean,
  { optionsFirst = [], optionsLast = [], optionsByThen }: DropdownCellsSetWith = {},
): PageTransition {
  let editor = dropdownEditorOfPane(state);
  let ownArea = editor === null ? null : ownStretchArea(state, reads, editor);
  if (editor === null || ownArea === null || editor.dropdownId === null) return withNoEffects(state);
  let cornersOf = (cornersArea: CellArea) => selectionOfArea(state, reads, cornersArea);
  let refuse = (why: Exclude<WhyDropdownCellsRefused, 'headingIsNoOption' | 'notFound'>) =>
    withNoEffects(
      withDropdownPane(state, {
        ...editor,
        cellsRefused: {
          why,
        },
      }),
    );
  let addedAreas = subtractArea(area, ownArea);
  if (!addedAreas.every((addedArea) => isAreaWithoutDropdown(state, reads, addedArea))) return refuse('ofAnotherDropdown');
  let labels = (optionsByThen ?? editor.options).map(({ label }) => label);
  let cellsCleared = addedAreas
    .filter((addedArea) => reads.filledCellsIn(state.sheetId, addedArea).length > 0)
    .map((addedArea) => {
      let corners = cornersOf(addedArea);
      return corners === null
        ? null
        : reads.cellsThatADropdownWouldClear(corners.activeCell, corners.selectionCorner, {
            kind: 'new',
            labels,
          });
    });
  if (cellsCleared.includes(null)) return withNoEffects(state);
  if (cellsCleared.some((cleared) => (cleared?.formulas ?? 0) > 0)) return refuse('holdFormula');
  if (cellsCleared.some((cleared) => (cleared?.others ?? 0) > 0)) return refuse('holdNoOption');
  let controlEdits = (controlledArea: CellArea, cellControl: CellControl) => {
    let corners = cornersOf(controlledArea);
    let cells = corners === null ? null : cellBlockOfSelection(state, reads, corners);
    return cells === null ? [] : [cellControlEdit(cells, cellControl)];
  };
  let edits = [
    ...optionsFirst,
    ...controlEdits(area, {
      kind: 'dropdown',
      dropdownId: editor.dropdownId,
    }),
    ...subtractArea(ownArea, area).flatMap(
      (areaLeft) =>
        controlEdits(areaLeft, {
          kind: 'none',
        }),
    ),
    ...optionsLast,
  ];
  return queueEdits(
    state,
    edits,
    {
      ...IF_QUEUED_DEFAULTS,
      select: selectsArea ? area : null,
      done: {
        what: 'dropdownCellsSet',
        cells: areaToA1AsStored(area, ownRowOrderOfSheet(reads, state.sheetId)),
      },
      thenInDropdownEditor: 'goesOn',
    },
    {
      isEachPointedAt: true,
    },
  );
}
export function reduceDropdownEditor(state: PageState, reads: WorkbookReads, act: DropdownEditorAct): PageTransition {
  let editor: DropdownEditor | null = dropdownEditorOfPane(state);
  if (editor === null) return withNoEffects(state);
  let [options, { typed }] = [editorOptionsOf(editor), editor];
  let { cellsRefused, cellsTyped, ...editorRest } = editor;
  let withEditor = (changes: Partial<DropdownEditor>) =>
    withNoEffects(
      withDropdownPane(
        {
          ...state,
          notice: null,
        },
        {
          ...editorRest,
          ...changes,
        },
      ),
    );
  let hasRoomForOption = options.length < MAX_DROPDOWN_OPTIONS;
  let typedAfterEnter = (startsOption: boolean) => (startsOption || options.length === 0 ? EMPTY_TYPED_OPTION : null);
  switch (act.kind) {
    case 'startOption':
      return reduceDropdownEditor(state, reads, {
        kind: 'enter',
        thenStartsOption: true,
      });
    case 'type': {
      let pickedColor = typed?.optionId === act.optionId ? typed.pickedColor : null;
      let typedOption = {
        optionId: act.optionId,
        label: cleanOptionLabel(act.label),
        pickedColor,
      };
      let optionsCommitted = typed?.optionId === act.optionId ? null : optionsAfterTypedLabel(editor);
      return optionsCommitted === null
        ? withEditor({
            typed: typedOption,
          })
        : commitDropdownOptions(
            withEditor({
              typed: typedOption,
            }).state,
            reads,
            editor,
            optionsCommitted,
            'goesOn',
          );
    }
    case 'dropTyped':
      return typed === null
        ? withNoEffects(state)
        : withEditor({
            typed: typed.optionId === null ? EMPTY_TYPED_OPTION : null,
          });
    case 'pasteNames': {
      let optionsTyped = typed?.optionId === act.optionId ? null : optionsAfterTypedLabel(editor);
      let optionsNow = optionsTyped ?? options;
      let pasteIndex =
        act.optionId === null ? optionsNow.length : optionsNow.findIndex((option) => option.optionId === act.optionId);
      if (pasteIndex === -1) return withNoEffects(state);
      let pickedColor = typed?.optionId === act.optionId ? typed.pickedColor : null;
      let { pasted, ...added } = pasteOptionLabels(optionsNow, pasteIndex, act.labels, pickedColor);
      let addedDone: Omit<DropdownOptionsAddedDone, 'onlyIn'> = {
        what: 'dropdownOptionsAdded',
        ...added,
      };
      let firstLabel = cleanOptionLabel(act.labels[0] ?? '');
      let stateTyped = withEditor({
        typed: {
          optionId: act.optionId,
          label: firstLabel,
          pickedColor,
        },
      }).state;
      if (optionsTyped !== null || added.count > 0 || pasted[pasteIndex]?.label !== optionsNow[pasteIndex]?.label)
        return commitDropdownOptions(stateTyped, reads, editor, pasted, 'entered', undefined, addedDone);
      return withNoEffects({
        ...stateTyped,
        lastDone: {
          ...addedDone,
          onlyIn: null,
        },
      });
    }
    case 'enter': {
      if (typed === null)
        return act.thenStartsOption && hasRoomForOption
          ? withEditor({
              typed: EMPTY_TYPED_OPTION,
            })
          : withNoEffects(state);
      if (act.optionId !== undefined && act.optionId !== typed.optionId) return withNoEffects(state);
      let label = typed.label.trim();
      let startsOption = act.thenStartsOption && hasRoomForOption;
      let optionTyped = options.find((option) => option.optionId === typed.optionId);
      if (label === '' || label === optionTyped?.label)
        return withEditor({
          typed: typedAfterEnter(startsOption),
        });
      let optionsEntered = optionsAfterTypedLabel(editor);
      if (optionsEntered === null) return withNoEffects(state);
      return commitDropdownOptions(state, reads, editor, optionsEntered, startsOption ? 'startsOption' : 'entered');
    }
    case 'setColor': {
      if (act.optionId === null)
        return typed?.optionId === null
          ? withEditor({
              typed: {
                ...typed,
                pickedColor: act.color,
              },
            })
          : withNoEffects(state);
      let recolored = options.map(
        (option) =>
          option.optionId === act.optionId
            ? {
                ...option,
                color: act.color,
              }
            : option,
      );
      return commitDropdownOptions(state, reads, editor, recolored, 'goesOn');
    }
    case 'setColorOfEveryOption': {
      if (act.to !== everyOptionColorOffer(editor)) return withNoEffects(state);
      let pickedColor = act.to === 'none' ? NO_COLOR : null;
      let colorsAsLastIn = assignOptionColors(options, (option) => colorOfOptionIn(editor.lastInColor, option));
      let colorsRestored = isDropdownDeliberatelyUncolored(colorsAsLastIn) ? assignOptionColors(options) : colorsAsLastIn;
      let recolored = act.to === 'none' ? withoutOptionColors(options) : colorsRestored;
      let isUnchanged = recolored.every(({ color }, index) => {
        let option = options[index];
        return option !== undefined && colorsEqual(color, option.color);
      });
      let withPickedColor = withEditor({
        typed:
          typed === null
            ? null
            : {
                ...typed,
                pickedColor,
              },
        ...(!isUnchanged && {
          lastInColor: act.to === 'none' ? options : recolored,
        }),
      });
      return isUnchanged ? withPickedColor : commitDropdownOptions(withPickedColor.state, reads, editor, recolored, 'goesOn');
    }
    case 'remove': {
      if (act.optionId === null)
        return withEditor({
          typed: null,
        });
      let removed = options.find((option) => option.optionId === act.optionId);
      let others = options.filter((option) => option !== removed);
      let removedDone: Omit<DropdownOptionRemovedDone, 'onlyIn'> | undefined =
        removed === undefined
          ? undefined
          : {
              what: 'dropdownOptionRemoved',
              label: removed.label,
              isSaved: false,
            };
      return commitDropdownOptions(state, reads, editor, others, 'goesOn', undefined, removedDone);
    }
    case 'move': {
      let moved = options.find((option) => option.optionId === act.optionId);
      if (moved === undefined) return withNoEffects(state);
      let others = options.filter((option) => option !== moved);
      let index = Math.max(0, Math.min(act.toIndex, others.length));
      if (options[index] === moved) return withNoEffects(state);
      return commitDropdownOptions(state, reads, editor, [...others.slice(0, index), moved, ...others.slice(index)], 'goesOn', undefined, {
        what: 'dropdownOptionMoved',
        label: moved.label,
        place: index + 1,
        optionCount: options.length,
      });
    }
    case 'chooseReach':
      return withNoEffects(
        withDropdownPane(state, {
          ...editor,
          reach: act.reach,
        }),
      );
    case 'typeCells':
      return withEditor({
        cellsTyped: act.text,
      });
    case 'dropTypedCells':
      return withEditor({});
    case 'useSelection': {
      let selected = selectedArea(state, reads);
      return selected === null ? withEditor({}) : setDropdownCells(withEditor({}).state, reads, selected, true);
    }
    case 'enterCells': {
      if (editor.cellsTyped === undefined) return withNoEffects(state);
      let cellsText = changedCellsTyped(editor);
      if (cellsText === null) return withEditor({});
      let sheet = reads.listSheets().find(({ sheetId }) => sheetId === state.sheetId);
      let areas = sheet === undefined ? null : parseA1AreasAsSeen(cellsText, sheet);
      let [area = null, ...otherAreas] = areas ?? [];
      if (otherAreas.length > 0) {
        let { state: stateWithEditor } = withEditor({});
        return withNoEffects({
          ...stateWithEditor,
          lastDone: null,
          notice: {
            kind: 'ownSortInTheWay',
            act: 'dropdown',
          },
        });
      }
      if (area !== null) return setDropdownCells(withEditor({}).state, reads, area, act.isBeforeOtherEvent !== true);
      return withEditor({
        cellsRefused: {
          why: 'notFound',
          typed: clipHeading(cellsText),
        },
      });
    }
    case 'setHeaderRow': {
      let ownArea = ownStretchArea(state, reads, editor);
      if (ownArea === null || dropdownHeaderRowState(state, reads, editor) !== (act.isOn ? 'off' : 'on')) return withNoEffects(state);
      let typedCommitted = commitTypedOption(state, reads, editor);
      let namedOptions = typedCommitted?.named ?? editor.options;
      let headingCell = reads.cellIdAt(state.sheetId, 0, ownArea.leftColumnIndex);
      let headingOption = headingCell === null ? undefined : reads.cellOf(headingCell)?.dropdownOption;
      let headingLabel =
        namedOptions.find(({ optionId }) => optionId !== null && optionId === headingOption?.optionId)?.label ??
        cellLabelText(reads, headingCell) ??
        '';
      let setCellsWithHeading = (areaToSet: CellArea, optionsWith: DropdownCellsSetWith): PageTransition => {
        let cellsSet = setDropdownCells(withEditor({}).state, reads, areaToSet, true, optionsWith);
        let editorAfter = dropdownEditorOfPane(cellsSet.state);
        if (editorAfter?.cellsRefused?.why === 'holdNoOption') {
          let refusedBefore = editor.cellsRefused;
          let refusal: DropdownCellsRefused = {
            why: 'headingIsNoOption',
            timesBefore: refusedBefore?.why === 'headingIsNoOption' ? refusedBefore.timesBefore + 1 : 0,
          };
          return withNoEffects(
            withDropdownPane(cellsSet.state, {
              ...editorAfter,
              cellsRefused: refusal,
            }),
          );
        }
        let [firstEffect] = cellsSet.effects;
        let { isOn } = act;
        let [heading, cells] = [clipHeading(headingLabel), areaToA1AsStored(areaToSet, ownRowOrderOfSheet(reads, state.sheetId))];
        return firstEffect?.kind !== 'queueEdit'
          ? cellsSet
          : {
              state: cellsSet.state,
              effects: [
                withIfQueued(firstEffect, {
                  done: {
                    what: 'headerRowSet',
                    isOn,
                    heading,
                    cells,
                  },
                }),
              ],
            };
      };
      let withTypedEffects = (transition: PageTransition): PageTransition =>
        typedCommitted === null
          ? transition
          : {
              ...transition,
              effects: [...typedCommitted.effects, ...transition.effects],
            };
      if (!act.isOn) {
        let [offeredHeading] = headingCell === null ? [] : (reads.dropdownOptionsToOffer(headingCell, headingCell) ?? []);
        let addsHeadingAsOption =
          offeredHeading !== undefined &&
          namedOptions.length < MAX_DROPDOWN_OPTIONS &&
          namedOptions.every(({ label }) => !isSameOptionLabel(label, offeredHeading.label));
        let [firstOptionNow, ...otherOptionsNow] = addsHeadingAsOption
          ? [
              {
                optionId: null,
                label: offeredHeading.label,
                color: colorForAddedOption(offeredHeading.label, namedOptions),
              },
              ...namedOptions,
            ]
          : namedOptions;
        let optionsFirst: EditOf<'setDropdownOptions'>[] =
          editor.dropdownId === null || !addsHeadingAsOption || firstOptionNow === undefined
            ? []
            : [
                {
                  kind: 'setDropdownOptions',
                  sheetId: state.sheetId,
                  dropdownId: editor.dropdownId,
                  options: [firstOptionNow, ...otherOptionsNow],
                  appliesTo: {
                    kind: 'everyCell',
                  },
                },
              ];
        let areaWithHeading = {
          ...ownArea,
          topRowIndex: 0,
          rowCount: ownArea.rowCount + 1,
        };
        let optionsByThen = firstOptionNow === undefined ? [] : [firstOptionNow, ...otherOptionsNow];
        return withTypedEffects(
          setCellsWithHeading(areaWithHeading, {
            optionsFirst,
            optionsByThen,
          }),
        );
      }
      let areaUnderHeading = {
        ...ownArea,
        topRowIndex: 1,
        rowCount: ownArea.rowCount - 1,
      };
      let foldedHeading = headingLabel.toLowerCase();
      let optionsLeft = areaHasLabel(reads, state.sheetId, areaUnderHeading, headingLabel)
        ? namedOptions
        : namedOptions.filter(({ label }) => label.toLowerCase() !== foldedHeading);
      let readySets: readonly NamedDropdownPreset[] = state.readySets ?? [];
      let readySet = readySetNamed(readySets, headingLabel) ?? readySets[0]?.set;
      let optionsUnder =
        optionsLeft.length > 0
          ? optionsLeft
          : (readySet?.options ?? []).map(
              ({ label, color }) => ({
                optionId: null,
                label,
                color,
              }),
            );
      let [firstOptionLeft, ...otherOptionsLeft] = optionsUnder;
      let optionsLast: EditOf<'setDropdownOptions'>[] =
        editor.dropdownId === null || firstOptionLeft === undefined || optionsLeft.length === namedOptions.length
          ? []
          : [
              {
                kind: 'setDropdownOptions',
                sheetId: state.sheetId,
                dropdownId: editor.dropdownId,
                options: [firstOptionLeft, ...otherOptionsLeft],
                appliesTo: {
                  kind: 'everyCell',
                },
              },
            ];
      return withTypedEffects(
        setCellsWithHeading(areaUnderHeading, {
          optionsLast,
        }),
      );
    }
    case 'startFrom': {
      if ((act.set === 'custom' ? 'custom' : act.set.key) === chosenOptionSetKey(state, editor)) return withNoEffects(state);
      if (act.set !== 'custom') {
        let typedCommitted = commitTypedOption(state, reads, editor);
        let optionsOfSet = optionsFromReadySet(typedCommitted?.named ?? editor.options, act.set);
        let editorThen =
          typedCommitted === null
            ? editor
            : {
                ...editor,
                optionsByThen: typedCommitted.named,
              };
        let committed = commitDropdownOptions(state, reads, editorThen, optionsOfSet, 'entered', act.set.key);
        return typedCommitted === null
          ? committed
          : {
              ...committed,
              effects: [...typedCommitted.effects, ...committed.effects],
            };
      }
      let { state: stateCustom } = withEditor({
        typed: EMPTY_TYPED_OPTION,
        isCustom: true,
      });
      return withNoEffects({
        ...stateCustom,
        lastDone: {
          what: 'dropdownStartedFrom',
          set: 'custom',
          optionCount: 0,
        },
      });
    }
  }
}
export function startDropdownFromSet(state: PageState, reads: ReadsWithTextMeasurer, set: LocalizedDropdownPreset, cell: CellId): PageTransition {
  let dropdown = dropdownAtActiveCell(state, reads);
  let cellsOfDropdown = reads.cellsOfTheDropdownAt(activeAnchorCell(state, reads));
  if (dropdown === null || cellsOfDropdown === null) return withNoEffects(state);
  let stateAtCell = isAnchorOfActiveCell(state, reads, cell) ? state : moveActiveCellTo(closeDropdownList(state), reads, cell);
  if (chosenReadySetKey(state, dropdown.options) === set.key) return withNoEffects(stateAtCell);
  return commitDropdownOptions(
    stateAtCell,
    reads,
    {
      dropdownId: dropdown.dropdownId,
      stretches: cellsOfDropdown.stretches,
      indexOfOwnStretch: cellsOfDropdown.indexOfTheStretchWithTheCell,
      reach: 'everyCell',
    },
    optionsFromReadySet(dropdown.options, set),
    'entered',
    set.key,
  );
}
export const cellControlEdit = (cells: CellBlock, cellControl: CellControl): EditOf<'formatCells'> => ({
  kind: 'formatCells',
  cells,
  format: {
    cellControl,
  },
});
export const squashSetLabel = (label: string): string => foldLabelCase(label).replaceAll(/\s/gu, '');
export const newDropdownOption = ({ label, color }: OptionToMake): OptionToMake => ({
  label,
  color,
});
export const colorOfOptionIn = (
  lastInColor: readonly OptionOfDropdownInPane[] | undefined,
  { optionId }: Pick<OptionOfDropdownInPane, 'optionId'>,
): Color | undefined => lastInColor?.find((option) => option.optionId === optionId)?.color;
export const isCellUnderMerge = (reads: WorkbookReads, cellId: CellId): boolean => !isSameCell(anchorCellOf(reads, cellId), cellId);
export const cellLabelTextAt = (reads: WorkbookReads, sheetId: SheetId, rowIndex: number, columnIndex: number): string | null =>
  cellLabelText(reads, reads.cellIdAt(sheetId, rowIndex, columnIndex));
