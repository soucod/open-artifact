import { selectionOfArea, selectedArea, mergedAreaOrCellOf } from '../selection/model.ts';
import { withNoEffects } from '../state/transitions.ts';
import { richTextMarksOfCell } from '../model/cell-values.ts';
import { cellBlockOfSelection } from '../model/cell-blocks.ts';
import { isRangeInSight } from '../grid/geometry.ts';
import { layoutOfView } from '../grid/layout.ts';
import { queueEdits, IF_QUEUED_DEFAULTS } from '../model/edit-effects.ts';
import { DEFAULT_CELL_FORMAT } from '../model/cell-format.ts';
import { colorsEqual } from '../model/colors.ts';
import { wrappingOfWrapText } from '../grid/text-overflow.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { PageState } from '../state/initial-state.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { BorderSide, WholeCellFormat } from '../model/cell-format.ts';
import type { CellArea } from '../selection/model.ts';
import type { CellFormat, Color, Edit, NumberFormatKind, SharedCellFormat } from '@open-artifact/sheets-core';
import type { PageTransition } from '../state/transitions.ts';
/** A value of one part of a format: a color, a flag, a size or a named choice. */
export type FormatPartValue = Color | string | number | boolean;
/** What clearing formats sets: the whole format, or its font or alignment. */
export type FormatPatch = CellFormat | NonNullable<CellFormat['font']> | NonNullable<CellFormat['alignment']>;
/** The parts of the default format besides its cell control, borders, number format, font and alignment. */
export type RestOfDefaultFormat = Omit<WholeCellFormat, 'cellControl' | 'border' | 'numberFormat' | 'font' | 'alignment'>;
export let DEFAULT_CELL_CONTROL: WholeCellFormat['cellControl'];
export let DEFAULT_BORDER: WholeCellFormat['border'];
export let DEFAULT_NUMBER_FORMAT: WholeCellFormat['numberFormat'];
export let DEFAULT_FONT: WholeCellFormat['font'];
export let DEFAULT_ALIGNMENT: WholeCellFormat['alignment'];
export let DEFAULT_FORMAT_REST: RestOfDefaultFormat;
/** The parts of `defaults` that `current` does not share, set back to their defaults. */
export function resetPatchOf<Part extends { [Key in keyof Part]: FormatPartValue }>(
  defaults: Part,
  current: NoInfer<{ [Key in keyof Part]: Part[Key] | null }>,
): Partial<Part> {
  let patch: Partial<Part> = {};
  for (let key in defaults) {
    let value = current[key];
    if (value === null || !isSameFormatPart(value, defaults[key])) patch[key] = defaults[key];
  }
  return patch;
}
export function touchesBorders(
  state: PageState,
  reads: WorkbookReads,
  { topRowIndex, leftColumnIndex, rowCount, columnCount }: CellArea,
  format: SharedCellFormat,
): boolean {
  if ((['top', 'right', 'bottom', 'left'] satisfies BorderSide[]).some((side) => hasBorderSide(format.border, side))) return true;
  let rowStrip = {
    leftColumnIndex,
    columnCount,
    rowCount: 1,
  };
  let columnStrip = {
    topRowIndex,
    rowCount,
    columnCount: 1,
  };
  return ([
    [
      'bottom',
      {
        ...rowStrip,
        topRowIndex: topRowIndex - 1,
      },
    ],
    [
      'top',
      {
        ...rowStrip,
        topRowIndex: topRowIndex + rowCount,
      },
    ],
    [
      'right',
      {
        ...columnStrip,
        leftColumnIndex: leftColumnIndex - 1,
      },
    ],
    [
      'left',
      {
        ...columnStrip,
        leftColumnIndex: leftColumnIndex + columnCount,
      },
    ],
  ] satisfies [BorderSide, CellArea][]).some(([side, area]) => {
    let selection = selectionOfArea(state, reads, area);
    let neighbourFormat = selection === null ? null : reads.sharedFormatBetween(selection.activeCell, selection.selectionCorner);
    return neighbourFormat !== null && hasBorderSide(neighbourFormat.border, side);
  });
}
export function clearFormattingOfSelection(state: PageState, reads: ReadsWithTextMeasurer): PageTransition {
  let area = selectedArea(state, reads);
  let selection = area === null ? null : selectionOfArea(state, reads, area);
  if (area === null || selection === null) return withNoEffects(state);
  let format = reads.sharedFormatBetween(selection.activeCell, selection.selectionCorner);
  if (format === null) return withNoEffects(state);
  let numberFormatKinds =
    format.numberFormat === null
      ? reads.cellsOnShowIn(state.sheetId, area).map((cellId) => reads.formatOf(cellId).numberFormat.kind)
      : [format.numberFormat.kind];
  let resetsNumberFormat =
    format.cellControl?.kind === 'none' && !numberFormatKinds.some((kind) => DATE_LIKE_FORMAT_KINDS.has(kind));
  let { pattern: generalPattern } = DEFAULT_NUMBER_FORMAT;
  let richTextMarks = new Set(
    reads.filledCellsIn(state.sheetId, area).flatMap((cellId) => richTextMarksOfCell(reads.cellOf(cellId))),
  );
  let fontPatch = {
    ...resetPatchOf(DEFAULT_FONT, format.font),
    ...(richTextMarks.has('bold') && {
      bold: DEFAULT_FONT.bold,
    }),
    ...(richTextMarks.has('italic') && {
      italic: DEFAULT_FONT.italic,
    }),
    ...(richTextMarks.has('underline') && {
      underline: DEFAULT_FONT.underline,
    }),
    ...(richTextMarks.has('strikethrough') && {
      strikethrough: DEFAULT_FONT.strikethrough,
    }),
  };
  let { wrap: wrapReset, ...otherAlignmentPatch } = resetPatchOf(DEFAULT_ALIGNMENT, format.alignment);
  let alignmentPatch = {
    ...otherAlignmentPatch,
    ...(wrapReset !== undefined && {
      wrap: wrappingOfWrapText(wrapReset),
    }),
  };
  let formatPatch: CellFormat = {
    ...resetPatchOf(DEFAULT_FORMAT_REST, format),
    ...(hasAnyKey(fontPatch) && {
      font: fontPatch,
    }),
    ...(hasAnyKey(alignmentPatch) && {
      alignment: alignmentPatch,
    }),
    ...(resetsNumberFormat &&
      format.numberFormat?.pattern !== generalPattern && {
        numberFormat: {
          pattern: generalPattern,
        },
      }),
  };
  let cells = cellBlockOfSelection(state, reads, selection);
  if (cells === null) return withNoEffects(state);
  let edits: Edit[] = [
    ...(reads.hasBorderLine(state.sheetId) && touchesBorders(state, reads, area, format)
      ? [
          {
            kind: 'setBorders',
            cells,
            edges: 'all',
            border: {
              kind: 'none',
            },
          },
        ] satisfies Edit[]
      : []),
    ...(hasAnyKey(formatPatch)
      ? [
          {
            kind: 'formatCells',
            cells,
            format: formatPatch,
          },
        ] satisfies Edit[]
      : []),
  ];
  let activeArea = mergedAreaOrCellOf(reads, state.activeCell);
  let isActiveInSight = activeArea !== null && isRangeInSight(activeArea, state, layoutOfView(state, reads), state);
  return queueEdits(
    state,
    edits,
    {
      ...IF_QUEUED_DEFAULTS,
      select: isActiveInSight ? state : null,
      done: 'formattingCleared',
      leavesEntryOpen: true,
    },
    {
      isEachPointedAt: false,
    },
  );
}
({
  cellControl: DEFAULT_CELL_CONTROL,
  border: DEFAULT_BORDER,
  numberFormat: DEFAULT_NUMBER_FORMAT,
  font: DEFAULT_FONT,
  alignment: DEFAULT_ALIGNMENT,
  ...DEFAULT_FORMAT_REST
} = DEFAULT_CELL_FORMAT);
export const isSameFormatPart = (value: FormatPartValue, other: FormatPartValue): boolean =>
  typeof value === 'object' && typeof other === 'object' ? colorsEqual(value, other) : value === other;
export const hasAnyKey = (record: FormatPatch): boolean => Object.keys(record).length > 0;
export const DATE_LIKE_FORMAT_KINDS: ReadonlySet<NumberFormatKind> = new Set<NumberFormatKind>(['date', 'time', 'dateAndTime', 'duration']);
export const hasBorderSide = (border: SharedCellFormat['border'], side: BorderSide): boolean => border[side]?.kind !== 'none';
