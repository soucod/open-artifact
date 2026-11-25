/**
 * Edits: what a person does to a workbook, as `queueEdit` takes it (`edit`).
 * The session works each one out into operations (`ops.ts`) on the workbook as
 * it is, so an edit names what it changes by id, as the person saw it.
 *
 * Edits are read strictly, as operations are: a field the engine does not know,
 * or one that does not read, makes the edit unreadable (`unreadableRequest`). A
 * field typed `T | null` must be written (as `null` where there is none); an
 * optional one may be left out. Runs of ids must not be empty, and each run's
 * `count` is at least 1.
 */

import type { CellAt, CellBlock, ColumnId, IdRun, RangeCorners, RowId, SheetId } from './ids.ts';
import type {
  Border,
  CellFormat,
  CellTable,
  Color,
  Effect,
  Embed,
  InputOfAWidget,
  InteractiveValue,
  ListLine,
  Mark,
  NamedView,
  OffsetOfAPlacement,
  SheetSettings,
} from './ops.ts';
import type { ColumnReading, ErrorValue } from './utility.ts';

// ---------------------------------------------------------------------------
// Shapes edits share
// ---------------------------------------------------------------------------

/** Cells between two corners of a sheet, the corners in any order. */
export interface CellsBetween {
  sheetId: SheetId;
  oneCorner: CellAt;
  otherCorner: CellAt;
}

/** A stretch of a sheet's columns, by the two at its ends (in either order). */
export interface ColumnsBetween {
  sheetId: SheetId;
  oneColumn: ColumnId;
  otherColumn: ColumnId;
}

/** A stretch of a sheet's rows, by the two at its ends (in either order). */
export interface RowsBetween {
  sheetId: SheetId;
  oneRow: RowId;
  otherRow: RowId;
}

/** A sheet's rows, as runs of ids: those in the sheet count, the others are passed over. */
export interface RowsOfASheet {
  sheetId: SheetId;
  rows: IdRun[];
}

/** Rows a paste or a move may land in when rows out of view are in its way. */
export type RowsToLandIn = IdRun[] | null;

/** A run of text that looks one way, as an edit gives it: its link may be left out. */
export interface RunTyped {
  /** Not empty, and without a line break. */
  text: string;
  marks: Mark[];
  link?: string | null;
}

/** A paragraph of text with looks, as an edit gives it. */
export interface ParagraphTyped {
  list: ListLine;
  runs: RunTyped[];
}

/** Text with looks, as typed into cells. */
export interface TextWithLooks {
  paragraphs: ParagraphTyped[];
}

/** A widget node of the page copied: both are `node/<id>`, each node copied once and each copy made once. */
export interface CopiedWidgetNode {
  source: string;
  copy: string;
}

/** A dropdown option to make: its label and its color. */
export interface OptionToMake {
  label: string;
  color: Color;
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

export type SheetEdit =
  /** A new sheet, named from the stem (`Sheet` gives `Sheet2` where `Sheet1` is taken); `null` puts it first. */
  | { kind: 'addSheet'; afterSheet?: SheetId | null; nameStem: string }
  | { kind: 'renameSheet'; sheetId: SheetId; name: string }
  /** `null` (or left out) moves it first. */
  | { kind: 'moveSheet'; sheetId: SheetId; afterSheet?: SheetId | null }
  | { kind: 'deleteSheet'; sheetId: SheetId }
  /** A locale the engine knows (`en-US`, `de-DE`, …). */
  | { kind: 'setLocale'; locale: string }
  /** A time zone the engine knows (`Europe/Berlin`, …). */
  | { kind: 'setTimeZone'; timeZone: string };

// ---------------------------------------------------------------------------
// Typing into cells
// ---------------------------------------------------------------------------

/** What one cell is given by `enter`. */
export type Entry =
  /** As typed: a number, a formula (`=…`), a date, a yes or no, or text. */
  | { kind: 'text'; text: string }
  /** A day, `YYYY-M-D` (a year of 4 digits, its month and day of 1 or 2). */
  | { kind: 'day'; day: string }
  /** An option of the cell's dropdown. */
  | { kind: 'dropdownOption'; optionId: string }
  /** A person, by their id (`u_` and 22 letters, digits or `_`) and name. */
  | { kind: 'user'; userId: string; name: string }
  | { kind: 'textWithLooks'; paragraphs: ParagraphTyped[] };

export type EntryKind = Entry['kind'];

/** A text pasted into one cell. */
export interface TextPasted {
  r: RowId;
  c: ColumnId;
  text: string;
}

/** How pasted texts read: as if typed, or as a cell writes what it holds (a formula's text, say). */
export type PastedTextIs = 'asTyped' | 'writtenFromACell';

/** A formula pasted with more than a few words of its own, which the person is shown before it is pasted: its cell, and its text as the workbook's locale writes it. */
export interface TextThatNoCellShows {
  r: RowId;
  c: ColumnId;
  written: string;
}

export type CellEdit =
  | { kind: 'enter'; sheetId: SheetId; cell: CellAt; entry: Entry }
  /** One text entered into a block of cells, typed in one of them. */
  | { kind: 'enterInCells'; cells: CellBlock; typedIn: CellAt; text: string }
  | { kind: 'enterTextWithLooksInCells'; cells: CellBlock; typedIn: CellAt; textWithLooks: TextWithLooks }
  /** Texts pasted into cells; `localeOfTexts` left out or `null` reads them in the workbook's locale. */
  | {
      kind: 'pasteTexts';
      sheetId: SheetId;
      cells: TextPasted[];
      pastedTextIs: PastedTextIs;
      localeOfTexts?: string | null;
    }
  /** Rows of texts pasted from the selection's first cell on. */
  | {
      kind: 'pasteRowsOfTexts';
      selected: CellBlock;
      rows: string[][];
      pastedTextIs: PastedTextIs;
      localeOfTexts?: string | null;
      mayLandIn?: RowsToLandIn;
    }
  | { kind: 'clearCells'; cells: CellBlock }
  | { kind: 'addUserToCell'; sheetId: SheetId; cell: CellAt; userId: string; name: string }
  | { kind: 'removeUserFromCell'; sheetId: SheetId; cell: CellAt; userId: string }
  /** A checkbox line of a cell's list (`paragraph`: its index among the cell's paragraphs) ticked or unticked. */
  | { kind: 'setListLineChecked'; sheetId: SheetId; cell: CellAt; paragraph: number; isChecked: boolean };

// ---------------------------------------------------------------------------
// Clipboard
// ---------------------------------------------------------------------------

/** Whether a copy's colors (of fills and fonts) are pasted, or are not yet. */
export type CopiedColors = 'arePasted' | 'areNotPastedYet';

/** The values a paste of values takes: none yet (formulas waited on), the copy's own, or those of a copy beside it. */
export type ValuesOfACopy =
  | { kind: 'notWritten' }
  | { kind: 'writtenAsTheCopiedCells' }
  /** A copy of the same cells, as `readCellsToCopy` answers it, holding the values of the formulas and options. */
  | { kind: 'writtenBesideTheCopiedCells'; asText: string };

/** What a cell of another program holds, besides what it shows. */
export type ValueOfAnotherProgram =
  | { kind: 'number'; value: number }
  | { kind: 'text'; value: string }
  | { kind: 'boolean'; value: boolean };

/** A cell another program put on the clipboard. */
export interface CellOfAnotherProgram {
  /** What it shows. */
  shown: string;
  /** What it shows with its looks: never written. */
  shownWithLooks: null;
  value: ValueOfAnotherProgram | null;
  /** Its formula, its references by offsets from its cell (`=R[-1]C+R1C1`). */
  formulaByOffsets: string | null;
  /** Its look, an index into `looks`. */
  look: number | null;
}

/** How cells of another program look: a format (setting something) and a number format's pattern. */
export interface LookOfAnotherProgram {
  format: CellFormat | null;
  numberFormatPattern: string | null;
}

/** Where a fill reaches: rows above or below the source (no gap between), or columns beside it as far as one. */
export type LinesToFill = { kind: 'rows'; rows: IdRun[] } | { kind: 'columnsAsFarAs'; column: ColumnId };

/** What filled cells hold: the source's patterns continued, or the source repeated. */
export type FilledCells = 'continuePatterns' | 'repeatSource';

export type ClipboardEdit =
  /** A copy (as `readCellsToCopy` answers it) pasted at the selection. */
  | {
      kind: 'pasteCopiedCells';
      selected: CellBlock;
      copiedCellsAsText: string;
      copiedColors: CopiedColors;
      mayLandIn?: RowsToLandIn;
    }
  /** A copy's values pasted at the selection; `copiedCellsAsText` is `null` where there is no copy. */
  | {
      kind: 'pasteValuesOfCopiedCells';
      selected: CellBlock;
      copiedCellsAsText: string | null;
      values: ValuesOfACopy;
      mayLandIn?: RowsToLandIn;
    }
  | {
      kind: 'pasteCellsOfAnotherProgram';
      selected: CellBlock;
      rows: CellOfAnotherProgram[][];
      looks: LookOfAnotherProgram[];
      mayLandIn?: RowsToLandIn;
    }
  /** The values of cells pasted with the top left at a cell, on the sheet or another. */
  | { kind: 'pasteValuesOfCells'; cells: CellsBetween; toSheetId: SheetId; toTopLeft: CellAt }
  /** Cells cut and pasted with the top left at a cell. */
  | { kind: 'moveCells'; cells: CellBlock; toSheetId: SheetId; toTopLeft: CellAt; mayLandIn?: RowsToLandIn }
  | { kind: 'fillCells'; source: CellBlock; linesToFill: LinesToFill; filledCells: FilledCells };

// ---------------------------------------------------------------------------
// Formats, borders and merges
// ---------------------------------------------------------------------------

/**
 * The edges a border is set on: every edge of every cell, those between the
 * cells (both ways, or one), those around them, or one side.
 */
export type Edges =
  | 'all'
  | 'inner'
  | 'innerHorizontal'
  | 'innerVertical'
  | 'outer'
  | 'left'
  | 'top'
  | 'right'
  | 'bottom';

export type FormatEdit =
  /**
   * Gives the cells what the format sets, leaving the rest of their formats as
   * they are. It must set something; a font's size is 6 to 96 points here.
   */
  | { kind: 'formatCells'; cells: CellBlock; format: CellFormat }
  | { kind: 'setBorders'; cells: CellBlock; edges: Edges; border: Border }
  | { kind: 'mergeCells'; cells: CellBlock }
  | { kind: 'unmergeCells'; cells: CellBlock };

// ---------------------------------------------------------------------------
// Rows, columns and a sheet's settings
// ---------------------------------------------------------------------------

/** A column fitted no narrower than a width. */
export interface NoNarrowerThan {
  column: ColumnId;
  widthInPixels: number;
}

export type LineEdit =
  /** 8 to 2000 pixels. */
  | ({ kind: 'setColumnWidths'; widthInPixels: number } & ColumnsBetween)
  /** 8 to 2000 pixels; `null` puts back the default. */
  | ({ kind: 'setRowHeights'; heightInPixels: number | null } & RowsOfASheet)
  /** Columns fitted to what they show. */
  | ({ kind: 'fitColumns'; noNarrowerThan: NoNarrowerThan[] } & ColumnsBetween)
  | { kind: 'setSheetSettings'; sheetId: SheetId; settings: SheetSettings }
  /**
   * `count` rows (at least 1) after a row (`null`: at the top), taking the
   * formats, the groups and the formulas of rows named.
   */
  | {
      kind: 'insertRows';
      sheetId: SheetId;
      afterRow: RowId | null;
      count: number;
      formatsFromRow?: RowId | null;
      groupsFromRow?: RowId | null;
      formulasFromRow?: RowId | null;
      /** Not taken: anything but `null` makes the edit unreadable. */
      valuesFromFilter?: null;
    }
  /** `count` columns (at least 1) after a column (`null`: at the left). */
  | {
      kind: 'insertColumns';
      sheetId: SheetId;
      afterColumn: ColumnId | null;
      count: number;
      formatsFromColumn?: ColumnId | null;
      groupsFromColumn?: ColumnId | null;
    }
  | ({ kind: 'deleteRows' } & RowsOfASheet)
  | ({ kind: 'deleteColumns' } & ColumnsBetween)
  /** `null` moves them to the top. */
  | ({ kind: 'moveRows'; afterRow: RowId | null } & RowsBetween)
  /** `null` moves them to the left. */
  | ({ kind: 'moveColumns'; afterColumn: ColumnId | null } & ColumnsBetween)
  | ({ kind: 'hideRows' } & RowsOfASheet)
  | ({ kind: 'hideColumns' } & ColumnsBetween)
  | ({ kind: 'groupRows' } & RowsBetween)
  | ({ kind: 'groupColumns' } & ColumnsBetween)
  | ({ kind: 'ungroupRows' } & RowsBetween)
  | ({ kind: 'ungroupColumns' } & ColumnsBetween)
  /** At least one group. */
  | { kind: 'setRowGroupsCollapsed'; sheetId: SheetId; groupIds: string[]; isCollapsed: boolean }
  | { kind: 'setColumnGroupsCollapsed'; sheetId: SheetId; groupIds: string[]; isCollapsed: boolean }
  | { kind: 'showRowGroupsToDepth'; sheetId: SheetId; depth: number }
  | { kind: 'showColumnGroupsToDepth'; sheetId: SheetId; depth: number };

// ---------------------------------------------------------------------------
// Sorts, cell tables, imported tables and duplicated sheets
// ---------------------------------------------------------------------------

export type SortDirection = 'ascending' | 'descending';

/** A further column sorted by, where the ones before tie. */
export interface FurtherKey {
  byColumn: ColumnId;
  direction: SortDirection;
}

/** How a column of a table imported as a new sheet goes in. */
export type ColumnToImport =
  /** As a paste as typed reads it, in the workbook's locale. */
  | { kind: 'asTyped' }
  | { kind: 'read'; reading: ColumnReading }
  /** A dropdown made for the column, with these options. */
  | { kind: 'dropdown'; options: OptionToMake[] };

/** How a table imported as a new sheet looks. */
export type LookOfAnImportedTable =
  | { kind: 'plain' }
  | { kind: 'headerFrozen' }
  | {
      kind: 'headerFrozenAndFilled';
      headerFill: Color;
      leastWidthsInPixels: number[];
      widestForATextInPixels: number;
    };

/** What a column's texts are, as a table goes into a sheet. */
export type TextsAre = { kind: 'trueOrFalse' } | { kind: 'read'; reading: ColumnReading };

/** A column of a table that goes into one of the sheet's columns. */
export interface ColumnInto {
  column: ColumnId;
  textsAre: TextsAre;
}

/** How a table goes into a sheet: its rows added, the sheet's rows replaced, or merged by a key column (an index of `columns`). */
export type HowIntoSheet = { kind: 'addRows' } | { kind: 'replaceRows' } | { kind: 'mergeByKey'; keyColumn: number };

/** A table (texts read from a file, row by row) put into a sheet below its header row. */
export interface TableIntoSheet {
  sheetId: SheetId;
  headerRow: RowId;
  rows: string[][];
  /** For each of the table's columns, the sheet's column it goes into (`null`: none). */
  columns: (ColumnInto | null)[];
  how: HowIntoSheet;
}

/** What becomes of a sheet's placed views when it is duplicated: left behind, or copied with their widget nodes. */
export type PlacedViewsOfADuplicate =
  | { kind: 'leftBehind' }
  | { kind: 'copied'; copiedWidgetNodes: CopiedWidgetNode[] };

export type TableEdit =
  /** The rows between two, sorted by a column (and further ones, where they tie). */
  | ({
      kind: 'sortRows';
      byColumn: ColumnId;
      direction: SortDirection;
      thenBy?: FurtherKey[];
    } & RowsBetween)
  | { kind: 'sortCells'; cells: CellsBetween; byColumn: ColumnId; direction: SortDirection; thenBy?: FurtherKey[] }
  /**
   * The columns from `oneColumn` to `otherColumn` of the cells between two
   * corners, moved after another column of those cells (`null`: first). The
   * cells' formats, conditional formats, views and named views go with them,
   * and their widths too where `widthsGoAlong`.
   */
  | {
      kind: 'moveColumnsOfCells';
      cells: CellsBetween;
      oneColumn: ColumnId;
      otherColumn: ColumnId;
      afterColumn: ColumnId | null;
      widthsGoAlong: boolean;
    }
  /** `isAskedFor`: whether the person asked for the table, not the page guessing it. */
  | { kind: 'declareCellTable'; sheetId: SheetId; cellTable: CellTable; isAskedFor?: boolean }
  | { kind: 'changeCellTable'; sheetId: SheetId; cellTableId: string; cellTable: CellTable }
  | { kind: 'removeCellTable'; sheetId: SheetId; cellTableId: string }
  /** A table read from a file, as a new sheet after one (`null`: first). */
  | {
      kind: 'importTableAsNewSheet';
      afterSheet: SheetId | null;
      name: string;
      rows: string[][];
      /** Left out, none. */
      headerRows?: number;
      /** Left out, every column as typed. */
      columns?: ColumnToImport[];
      /** Left out, plain. */
      look?: LookOfAnImportedTable;
    }
  | { kind: 'importTableIntoSheet'; table: TableIntoSheet }
  | { kind: 'duplicateSheet'; sheetId: SheetId; name: string; placedViews?: PlacedViewsOfADuplicate };

// ---------------------------------------------------------------------------
// Conditional formats, dropdowns and placed views
// ---------------------------------------------------------------------------

/** A conditional format to add: the ranges it applies to (at least one) and what it does. */
export interface ConditionalFormatRule {
  ranges: RangeCorners[];
  effect: Effect;
}

/** A dropdown option as the dropdown editor gives it: one the dropdown has (by its id), or a new one (`null`). */
export interface OptionInAnEditor {
  optionId: string | null;
  label: string;
  color: Color;
}

/** The cells a dropdown's options are for: every cell given it, or those in some rows (given a new dropdown). */
export type DropdownAppliesTo =
  | { kind: 'everyCell' }
  | { kind: 'cellsInRows'; rows: IdRun[]; oneColumn: ColumnId; otherColumn: ColumnId };

/** Where a placed view goes: anchored at a cell, perhaps offset from it. */
export interface PlaceOfAView {
  topLeft: CellAt;
  offsetFromAnchorCell?: OffsetOfAPlacement;
}

export type ObjectEdit =
  /** At least one rule. */
  | { kind: 'addConditionalFormats'; sheetId: SheetId; rules: ConditionalFormatRule[] }
  /** What is left out stays as it is. */
  | {
      kind: 'changeConditionalFormat';
      sheetId: SheetId;
      conditionalFormatId: string;
      ranges?: RangeCorners[];
      effect?: Effect;
    }
  /** Moved before another (`null`: last). */
  | { kind: 'moveConditionalFormat'; sheetId: SheetId; conditionalFormatId: string; before: string | null }
  | { kind: 'removeConditionalFormat'; sheetId: SheetId; conditionalFormatId: string }
  /** A new dropdown with these options (at least one), given the cells. */
  | { kind: 'makeDropdown'; cells: CellBlock; options: OptionToMake[] }
  /** An option added to the dropdown of a cell. */
  | { kind: 'addDropdownOption'; sheetId: SheetId; cell: CellAt; label: string; color: Color }
  /** A dropdown's options as the editor leaves them (at least one). */
  | {
      kind: 'setDropdownOptions';
      sheetId: SheetId;
      dropdownId: string;
      options: OptionInAnEditor[];
      appliesTo: DropdownAppliesTo;
    }
  | ({ kind: 'movePlacedView'; sheetId: SheetId; placementId: string } & PlaceOfAView)
  | ({
      kind: 'resizePlacedView';
      sheetId: SheetId;
      placementId: string;
      widthInPixels: number;
      heightInPixels: number;
    } & PlaceOfAView)
  | { kind: 'deletePlacedView'; sheetId: SheetId; placementId: string }
  | ({
      kind: 'copyPlacedView';
      sheetId: SheetId;
      placementId: string;
      toSheetId: SheetId;
      copiedWidgetNodes: CopiedWidgetNode[];
    } & PlaceOfAView)
  /** A new view of a widget (`embed.ref`: `node/<id>`), placed on a sheet. */
  | ({
      kind: 'addPlacedView';
      sheetId: SheetId;
      name: string;
      embed: Embed;
      inputs: InputOfAWidget[];
      widthInPixels: number;
      heightInPixels: number;
    } & PlaceOfAView)
  /** The widget node a placed view shows replaced (`node/<id>` both), perhaps renamed. */
  | {
      kind: 'replaceWidgetNodeOfPlacedView';
      sheetId: SheetId;
      placementId: string;
      oldNode: string;
      newNode: string;
      newName?: string | null;
    };

// ---------------------------------------------------------------------------
// Named views
// ---------------------------------------------------------------------------

export type NamedViewEdit =
  /** A named view saved over the one of an id, or as a new one (`null`). */
  | { kind: 'saveNamedView'; sheetId: SheetId; namedViewId: string | null; namedView: NamedView }
  | { kind: 'removeNamedView'; sheetId: SheetId; namedViewId: string };

// ---------------------------------------------------------------------------
// Pivot tables
// ---------------------------------------------------------------------------

/** The table a pivot table reads: the sheet and the row of its header. */
export interface PivotTableSource {
  sheetId: SheetId;
  headerRow: RowId;
}

/** A span of time dates are grouped by. */
export type PivotPeriod = 'day' | 'month' | 'quarter' | 'year';

export type PivotOrder = 'ascending' | 'descending';

/** How the values of a column are totalled. `shareOfTotal` sums them as a share of the whole. */
export type PivotTotal = 'sum' | 'count' | 'distinctCount' | 'average' | 'min' | 'max' | 'shareOfTotal';

/** Whether a filter keeps the records whose value is listed, or the others. */
export type PivotKeeps = 'oneOf' | 'noneOf';

/** A value a filter lists. */
export type PivotWrittenValue =
  | { kind: 'number'; value: number }
  | { kind: 'text'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'error'; value: ErrorValue };

/** A column of the source the rows (or columns) are grouped by, by date where `by` is a period. */
export interface PivotAxis {
  column: ColumnId;
  by: PivotPeriod | null;
  order: PivotOrder;
  /** `null`: the column's header. */
  name: string | null;
}

/** A column of the source totalled, and the order the groups take by its totals (`null`: by their axes alone). */
export interface PivotMeasure {
  column: ColumnId;
  total: PivotTotal;
  order: PivotOrder | null;
  name: string | null;
}

/**
 * The values a filter lists: written in the pivot table (`null`: blank), or
 * the ones a cell holds.
 */
export type PivotListed =
  | { kind: 'written'; values: (PivotWrittenValue | null)[] }
  | { kind: 'inACell'; sheetId: SheetId; cell: CellAt };

export interface PivotFilter {
  column: ColumnId;
  keeps: PivotKeeps;
  listed: PivotListed;
}

/**
 * What a pivot table shows. It takes at least one value; with `columns` it
 * takes just one. A written filter lists at least one value.
 */
export interface PivotTable {
  source: PivotTableSource;
  rows: PivotAxis[];
  columns: PivotAxis | null;
  values: PivotMeasure[];
  filters: PivotFilter[];
}

/** Where a new pivot table goes: a new sheet after one (`null` or left out: first), or a cell. */
export type PlaceOfAPivotTable =
  | { kind: 'newSheet'; afterSheet?: SheetId | null; name: string }
  | { kind: 'cell'; sheetId: SheetId; cell: CellAt };

export type PivotTableEdit =
  | { kind: 'insertPivotTable'; place: PlaceOfAPivotTable; pivotTable: PivotTable }
  /** The pivot table at a cell, changed to show something else. */
  | { kind: 'changePivotTable'; sheetId: SheetId; cell: CellAt; pivotTable: PivotTable };

// ---------------------------------------------------------------------------
// Interactive views
// ---------------------------------------------------------------------------

/**
 * A value an interactive view writes to a cell of one of its inputs, the cell
 * by its row and column within the input's range (from 0). `null` empties it.
 */
export interface CellWrittenFromAnInteractive {
  input: string;
  row: number;
  column: number;
  value: InteractiveValue | null;
}

export type InteractiveEdit =
  | { kind: 'writeFromInteractive'; viewId: string; cells: CellWrittenFromAnInteractive[] }
  /** The cells of the view's inputs, written back with the values it keeps. */
  | { kind: 'resetInteractive'; viewId: string }
  /** The values of the view's inputs, kept as the ones a reset writes back. */
  | { kind: 'saveDefaultsOfInteractive'; viewId: string };

// ---------------------------------------------------------------------------
// Every edit
// ---------------------------------------------------------------------------

/**
 * An edit `queueEdit` takes. The session also routes `adoptTimeZone`, but
 * never reads one: it adopts the browser's time zone itself
 * (`timeZoneOfTheBrowser`), so that kind is not an edit a page sends.
 */
export type Edit =
  | SheetEdit
  | CellEdit
  | ClipboardEdit
  | FormatEdit
  | LineEdit
  | TableEdit
  | ObjectEdit
  | NamedViewEdit
  | PivotTableEdit
  | InteractiveEdit;

export type EditKind = Edit['kind'];

export type EditOf<K extends EditKind> = Extract<Edit, { kind: K }>;

/**
 * What an edit answers that is neither queued nor refused: a paste whose
 * formulas no cell shows asks for them to be shown to the person first (and
 * `queueEdit` sent again with them as `shownToThePerson`).
 */
export type OtherAnswerToAnEdit = { kind: 'toBeShownFirst'; textThatNoCellShows: TextThatNoCellShows[] };
