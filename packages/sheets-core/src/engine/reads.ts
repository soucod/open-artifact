/**
 * The reads: requests that read the workbook shown and change nothing. Each
 * is answered with its own `kind`, or `{"kind": "refused", "refusal": …}`; a
 * request that cannot be read is refused as `unreadableRequest`.
 *
 * Formulas waiting to be worked out are read as they last came to, except by
 * `readXlsxFile` and `readProposedFormulaValue`, which work them out first.
 * `readFormatsGiven`, `readConditionalFormatSuggestions` and
 * `readConditionalFormatsAsAgentIsTold` count days from the session's clock.
 */

import type { CellAt, ColumnId, IdRun, RangeCorners, RowId, SheetId } from './ids.ts';
import type {
  Border,
  CellCondition,
  CellControl,
  CellFormat,
  CellTable,
  Color,
  ConditionalFormat,
  DropdownOption,
  Effect,
  EndsOfGroup,
  HorizontalAlignment,
  Input,
  NamedView,
  Placement,
  StoredFormula,
  Underline,
  VerticalAlignment,
  View,
  Wrap,
} from './ops.ts';
import type {
  CellsBetween,
  FurtherKey,
  PivotKeeps,
  PivotTable,
  PivotTableSource,
  PivotWrittenValue,
  SortDirection,
  TableIntoSheet,
} from './edits.ts';
import type { ErrorValue } from './utility.ts';

// ---------------------------------------------------------------------------
// Values and how cells show them
// ---------------------------------------------------------------------------

/** An error as a cell holds it, by its text. */
export type CellErrorText = ErrorValue;

/** A value a cell comes to. */
export type ValueContents =
  | { kind: 'number'; value: number }
  | { kind: 'text'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'error'; value: CellErrorText };

/** A color a number format's section names (`[Red]`), in lowercase. */
export type NamedFormatColor = 'black' | 'blue' | 'cyan' | 'green' | 'magenta' | 'red' | 'white' | 'yellow';

/** The color a number format's section gives the text it shows: named, or by its number (`[Color12]`, 1 to 56). */
export type ShownColor = { kind: 'named'; name: NamedFormatColor } | { kind: 'indexed'; index: number };

/** Why a value cannot be shown with its number format. */
export type CannotBeShownReason = 'noSectionApplies' | 'outsideTheCalendar' | 'notPrintedYet' | 'tooLong';

/** A value as its cell shows it, or why it cannot be. */
export type ShownValue =
  | { kind: 'text'; text: string; textColor: ShownColor | null }
  | { kind: 'cannotBeShown'; reason: CannotBeShownReason };

/** What a number format shows. */
export type NumberFormatKind =
  | 'general'
  | 'number'
  | 'percent'
  | 'currency'
  | 'scientific'
  | 'fraction'
  | 'date'
  | 'time'
  | 'dateAndTime'
  | 'duration'
  | 'text';

/** The number format a formula's number brings to a cell with none of its own. */
export interface BroughtNumberFormat {
  kind: NumberFormatKind;
  pattern: string;
}

/** What keeps an array from spilling. */
export type BlockedBy =
  | { kind: 'filledCell'; cell: CellAt }
  | { kind: 'earlierFormula'; cell: CellAt }
  | { kind: 'endOfSheet' };

/** Where a formula's array spills: as far as `to`, or blocked short of `wouldFillTo`. */
export type SpillContents =
  | { kind: 'fills'; to: CellAt }
  | { kind: 'blocked'; by: BlockedBy; wouldFillTo: CellAt };

/** A cell's contents as the workbook tells them. */
export interface CellContents {
  r: RowId;
  c: ColumnId;
  input: Input;
  /** A formula's text as it reads now. */
  formulaText?: string;
  /** A number as one edits it, when that is not how it is shown. */
  numberIsEditedAs?: string;
  /** A text is edited after the `'` that keeps it a text. */
  textIsEditedAfterTheMark?: true;
  /** What a formula comes to. */
  value?: ValueContents;
  /** The number each line of a rich text's lists shows (`null`: a line that shows none). */
  numbersOfListLines?: (number | null)[];
  /** The option a dropdown's cell holds. */
  dropdownOption?: DropdownOption;
  shown?: ShownValue;
  numberFormatBrought?: BroughtNumberFormat;
  /** The address the cell links to. */
  linksTo?: string;
  spill?: SpillContents;
  /** The formula draws random numbers. */
  drawsRandomNumbers?: true;
}

/** A cell an array spills into: the formula's cell, and the value there. */
export interface SpilledCell {
  r: RowId;
  c: ColumnId;
  from: CellAt;
  value: ValueContents;
  shown?: ShownValue;
  numberFormatBrought?: BroughtNumberFormat;
}

// ---------------------------------------------------------------------------
// The workbook and its sheets as told
// ---------------------------------------------------------------------------

/** A merged range as written, and where its corners are now. */
export interface MergedRangeContents {
  range: RangeCorners;
  liveTopLeft: CellAt;
  liveBottomRight: CellAt;
}

export interface ColumnWidthContents {
  columns: IdRun;
  widthInPixels: number;
}

export interface RowHeightContents {
  rows: IdRun;
  heightInPixels: number;
}

/** Cells given one format: every row by every column. */
export interface CellFormatContents {
  rows: IdRun[];
  columns: IdRun[];
  format: CellFormat;
}

export interface DropdownContents {
  dropdownId: string;
  options: DropdownOption[];
}

/** A group of rows or columns: its ends now, and how deep it is among the groups (from 1). */
export interface GroupContents {
  groupId: string;
  ends: EndsOfGroup;
  isCollapsed: boolean;
  depth: number;
}

/** A conditional format, with its ranges where they are now. */
export interface ConditionalFormatContents extends ConditionalFormat {
  conditionalFormatId: string;
  liveRanges: RangeCorners[];
}

/** A placement, with its top left cell where it is now. */
export interface PlacementContents {
  placementId: string;
  placement: Placement;
  liveTopLeft: CellAt;
}

/** A cell table as declared, and where it is now. */
export interface CellTableContents {
  cellTableId: string;
  cellTable: CellTable;
  liveCellTable: CellTable;
}

/** A named view a sheet keeps, by its id (`nvw_…`). */
export interface NamedViewContents {
  namedViewId: string;
  namedView: NamedView;
}

/** What a sheet holds besides its cells; each list is left out when empty. */
export interface SheetLayoutContents {
  sheetId: SheetId;
  name: string;
  rows: IdRun[];
  columns: IdRun[];
  /** The interactive view (a view id) the sheet shows in place of its grid. */
  interactive?: string;
  mergedRanges?: MergedRangeContents[];
  columnWidths?: ColumnWidthContents[];
  rowHeights?: RowHeightContents[];
  cellFormats?: CellFormatContents[];
  dropdowns?: DropdownContents[];
  lastFrozenRow?: RowId;
  lastFrozenColumn?: ColumnId;
  areGridlinesHidden?: true;
  rowGroups?: GroupContents[];
  columnGroups?: GroupContents[];
  conditionalFormats?: ConditionalFormatContents[];
  placements?: PlacementContents[];
  cellTables?: CellTableContents[];
  namedViews?: NamedViewContents[];
  spilledCells?: SpilledCell[];
}

/** A sheet as the workbook tells it: its cells in order, row by row. */
export interface SheetContents extends SheetLayoutContents {
  cells: CellContents[];
}

export type DecimalSignName = 'point' | 'comma';
export type GroupSignName = 'point' | 'comma' | 'noBreakSpace' | 'narrowNoBreakSpace' | 'apostrophe';
export type SizesOfGroupsName = 'threes' | 'threeAndThenTwos';

export interface ViewContents {
  viewId: string;
  view: View;
}

/**
 * The workbook as `readWorkbook` tells it. The locale's facts are told only
 * where they are not en-US's; views placed only on deleted sheets are left out.
 */
export interface WorkbookContents {
  kind: 'workbookContents';
  revision: number;
  sheets: SheetContents[];
  timeZone?: string;
  locale?: string;
  decimalSign?: DecimalSignName;
  groupSign?: GroupSignName;
  sizesOfGroups?: SizesOfGroupsName;
  /** The pattern a time of day is shown with. */
  patternOfATimeOfDay?: string;
  views?: ViewContents[];
}

export interface ReadWorkbookRequest {
  kind: 'readWorkbook';
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

export interface ReadCellsRequest {
  kind: 'readCells';
  sheetId: SheetId;
  cells: CellAt[];
}

/** The cells asked for that hold something, and what spills into them. */
export interface CellsContentsAnswer {
  kind: 'cellsContents';
  cells: CellContents[];
  spilledCells?: SpilledCell[];
}

/** A cell named by its sheet. */
export interface CauseCell {
  sheetId: SheetId;
  cell: CellAt;
}

/** Why a formula comes to its error. */
export type CauseOfError =
  | { kind: 'comesToSeveralCellsThatDoNotSpill' }
  | { kind: 'refersToItself' }
  | { kind: 'leadsBackToTheFormula'; cell: CauseCell }
  | { kind: 'errorIsWritten' }
  | { kind: 'cellsAreGone' }
  | { kind: 'showsTheSameError'; cell: CauseCell }
  | { kind: 'functionWithoutParentheses'; function: string }
  | { kind: 'unknownName'; name: string }
  | { kind: 'noSuchFunction'; name: string }
  | { kind: 'holdsTextWhereANumberIsNeeded'; cell: CauseCell }
  | { kind: 'dividesByAWrittenZero' }
  | { kind: 'isBlankAndDividedBy'; cell: CauseCell }
  | { kind: 'isZeroAndDividedBy'; cell: CauseCell }
  | { kind: 'rangesOfDifferentSizes'; function: string }
  | { kind: 'lookupFindsNothing'; function: string }
  | {
      kind: 'conditionsDoNotFitTheRange';
      function: string;
      /** The names of the arguments. */
      range: string;
      condition: string;
      hasSeveralConditions: boolean;
      canBeARow: boolean;
    }
  | { kind: 'filterKeepsNothing'; function: string; argumentToAdd: string; hasSeveralConditions: boolean }
  | { kind: 'argumentIsMissing'; function: string; argument: string }
  | { kind: 'tooManyArguments'; function: string; most: number; given: number; takesNoFewer: boolean }
  | { kind: 'pairIsIncomplete'; function: string; first: string; second: string };

export interface ReadCauseOfErrorRequest {
  kind: 'readCauseOfError';
  sheetId: SheetId;
  cell: CellAt;
}

/** `null` when no cause is found. */
export interface CauseOfErrorAnswer {
  kind: 'causeOfError';
  cause: CauseOfError | null;
}

/** A formula's text read as it would be stored in a cell of the sheet. */
export interface ReadTypedFormulaRequest {
  kind: 'readTypedFormula';
  sheetId: SheetId;
  text: string;
}

export interface TypedFormulaAnswer {
  kind: 'typedFormula';
  formula: StoredFormula;
}

/** What a cell would come to were this text entered in it. */
export interface ReadProposedFormulaValueRequest {
  kind: 'readProposedFormulaValue';
  sheetId: SheetId;
  cell: CellAt;
  text: string;
}

/** `null` when the cell would hold nothing. */
export interface ProposedFormulaValueAnswer {
  kind: 'proposedFormulaValue';
  cell: CellContents | null;
}

export interface ReadTextToEditRequest {
  kind: 'readTextToEdit';
  sheetId: SheetId;
  cell: CellAt;
}

export interface TextToEditAnswer {
  kind: 'textToEdit';
  text: string;
}

// ---------------------------------------------------------------------------
// Copying
// ---------------------------------------------------------------------------

export interface ReadCellsToCopyRequest {
  kind: 'readCellsToCopy';
  cells: CellsBetween;
  /** Rows the page has out of view (hidden or filtered away); each run at least one. */
  rowsOutOfView?: IdRun[];
}

/** Rows in the order given, between two columns, copied as they come. */
export interface ReadCellsToCopyInTheOrderOfTheirRowsRequest {
  kind: 'readCellsToCopyInTheOrderOfTheirRows';
  cells: {
    sheetId: SheetId;
    rows: IdRun[];
    oneColumn: ColumnId;
    otherColumn: ColumnId;
  };
}

/** What pasting only the values pastes. */
export type CopiedValues =
  | { kind: 'notWritten' }
  | { kind: 'writtenAsTheCopiedCells' }
  | { kind: 'writtenBesideTheCopiedCells'; asText: string };

/** A cell's text for other programs, by its place in the copy. */
export interface TextToPaste {
  row: number;
  column: number;
  textToPaste: string;
  /** The text a number with a number format shows. */
  textShown?: string;
  isNumberShownWhole?: boolean;
}

export interface CellsToCopyAnswer {
  kind: 'cellsToCopy';
  /** The copy for this workbook's own pastes; `null` when nothing is copied. */
  copiedCellsAsText: string | null;
  values: CopiedValues;
  rowCount: number;
  columnCount: number;
  cells: TextToPaste[];
  /** The locale the texts are written in. */
  localeOfTexts: string;
}

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------

/** A rule as if added before the sheet's, or in place of one of them. */
export interface ConditionalFormatAsIf {
  ranges: RangeCorners[];
  effect: Effect;
  inPlaceOf: string | null;
}

export interface ReadFormatsGivenRequest {
  kind: 'readFormatsGiven';
  sheetId: SheetId;
  asIf?: ConditionalFormatAsIf[];
}

/** A color scale's ranges where they are now, and the numbers its stops come to. */
export interface GivenColorScale {
  ranges: RangeCorners[];
  stops: { at: number; color: Color }[];
}

/** How many cells and rows a `formatWhere` matches. */
export interface Matches {
  cells: number;
  rows: number;
}

export interface FormatsGivenAnswer {
  kind: 'formatsGiven';
  notWorkedOut: null;
  /** Cells and the parts of a format conditional formats give them. */
  formats: CellFormatContents[];
  colorScales: GivenColorScale[];
  /** By rule, in the order they apply; `null` for a color scale. */
  matches: (Matches | null)[];
}

export interface ReadSharedCellFormatRequest {
  kind: 'readSharedCellFormat';
  sheetId: SheetId;
  oneCorner: CellAt;
  otherCorner: CellAt;
}

/** Each property the cells all have; `null` where they differ. */
export interface SharedCellFormat {
  numberFormat: { kind: NumberFormatKind; pattern: string } | null;
  alignment: { horizontal: HorizontalAlignment | null; vertical: VerticalAlignment | null; wrap: Wrap | null };
  fillColor: Color | null;
  cellControl: CellControl | null;
  border: { top: Border | null; bottom: Border | null; left: Border | null; right: Border | null };
  font: {
    bold: boolean | null;
    italic: boolean | null;
    underline: Underline | null;
    strikethrough: boolean | null;
    color: Color | null;
    size: number | null;
  };
}

export interface SharedCellFormatAnswer {
  kind: 'sharedCellFormat';
  format: SharedCellFormat;
}

// ---------------------------------------------------------------------------
// Sheet layout and time zone
// ---------------------------------------------------------------------------

export interface ReadSheetLayoutRequest {
  kind: 'readSheetLayout';
  sheetId: SheetId;
}

/** A sheet as `readWorkbook` tells it, without its cells. */
export interface SheetLayoutAnswer extends SheetLayoutContents {
  kind: 'sheetLayout';
}

export interface ReadTimeZoneRequest {
  kind: 'readTimeZone';
}

export interface TimeZoneAnswer {
  kind: 'timeZone';
  /** `null`: the workbook has none set. */
  timeZone: string | null;
}

// ---------------------------------------------------------------------------
// Conditional formats, dropdowns and views
// ---------------------------------------------------------------------------

/** What a column of records holds. */
export type KindOfAColumn = 'number' | 'currency' | 'percent' | 'date' | 'fewWords' | 'checkbox' | 'text';

/** A column of the records around some cells, counted. */
export interface ColumnOfRecords {
  /** The column's id (letters, as the agent is told). Every column of the records lies in the sheet, so it has one. */
  c: string;
  name: string | null;
  kind: KindOfAColumn;
  filled: number;
  numbers: number;
  blank: number;
  commonest: string[];
  smallest: number | null;
  middle: number | null;
  largest: number | null;
}

/** A conditional format's rule by ids. */
export interface RuleInIds {
  ranges: RangeCorners[];
  effect: Effect;
}

/** A rule by address: ranges such as `B2:B15`, the columns its tests name by their letters. */
export interface RuleByAddress {
  cells: string[];
  effect: Effect;
}

export interface ReadConditionalFormatSuggestionsRequest {
  kind: 'readConditionalFormatSuggestions';
  cells: CellsBetween;
}

/** Rules offered together, and what they match (`null` for a color scale). */
export interface ConditionalFormatSuggestion {
  rules: RuleInIds[];
  matches: Matches | null;
}

export interface ConditionalFormatSuggestionsAnswer {
  kind: 'conditionalFormatSuggestions';
  /** The cells the suggestions are about. */
  about: RangeCorners;
  isWidenedToColumn: boolean;
  suggestions: ConditionalFormatSuggestion[];
  ruleToStartFrom: RuleInIds;
  /** The table around the cells: all of it, its records, and their columns. */
  table: { cells: RangeCorners; records: RangeCorners; columns: ColumnOfRecords[] };
}

/** Rules written by address to read into ids; anything else is told as a problem. */
export interface ReadConditionalFormatsInIdsRequest {
  kind: 'readConditionalFormatsInIds';
  sheetId: SheetId;
  written: unknown;
}

/** The part of a rule a problem is in. */
export type PartOfARule =
  | { kind: 'whole' }
  | { kind: 'cells' }
  | { kind: 'range'; index: number }
  | { kind: 'effect' }
  | { kind: 'test'; index: number }
  | { kind: 'format' };

export interface ProblemOfARule {
  /** The rule's place in the list. */
  index: number;
  part: PartOfARule;
  refusal: string;
}

/** Rules read into ids, or what is wrong with them (the first so many). */
export type RulesRead =
  | { kind: 'notAList'; refusal: string }
  /** Every rule read: a list with a rule that cannot be read is told as `notRules`. */
  | { kind: 'rules'; rules: RuleInIds[] }
  | { kind: 'notRules'; problems: ProblemOfARule[]; rowCount: number; columnCount: number };

export interface ConditionalFormatsInIdsAnswer {
  kind: 'conditionalFormatsInIds';
  read: RulesRead;
}

export interface ReadConditionalFormatsByAddressRequest {
  kind: 'readConditionalFormatsByAddress';
  sheetId: SheetId;
  rules: RuleInIds[];
}

/** By rule; `null` for one with no range left or naming a column not there. */
export interface ConditionalFormatsByAddressAnswer {
  kind: 'conditionalFormatsByAddress';
  rules: (RuleByAddress | null)[];
}

export interface ReadConditionalFormatsAsAgentIsToldRequest {
  kind: 'readConditionalFormatsAsAgentIsTold';
  cells: CellsBetween;
}

/** How rules are written, then the sheet as JSON between `<sheet>` and `</sheet>`. */
export interface ConditionalFormatsAsAgentIsToldAnswer {
  kind: 'conditionalFormatsAsAgentIsTold';
  told: string;
}

export interface ReadDropdownOptionsToOfferRequest {
  kind: 'readDropdownOptionsToOffer';
  sheetId: SheetId;
  oneCorner: CellAt;
  otherCorner: CellAt;
}

export interface DropdownOptionsToOfferAnswer {
  kind: 'dropdownOptionsToOffer';
  options: { label: string }[];
}

/** A dropdown cells would be given: a new one with these labels, or one the sheet holds. */
export type DropdownToPointAt = { kind: 'new'; labels: string[] } | { kind: 'held'; dropdownId: string };

export interface ReadCellsThatADropdownWouldClearRequest {
  kind: 'readCellsThatADropdownWouldClear';
  cells: CellsBetween;
  dropdown: DropdownToPointAt;
}

/** How many formulas, and how many other values no label matches, giving the dropdown would clear. */
export interface CellsThatADropdownWouldClearAnswer {
  kind: 'cellsThatADropdownWouldClear';
  formulas: number;
  others: number;
}

export interface ReadCellsOfTheDropdownAtRequest {
  kind: 'readCellsOfTheDropdownAt';
  sheetId: SheetId;
  cell: CellAt;
}

/** Cells down a column given one dropdown. */
export interface StretchOfADropdown {
  /** `C3:C9`, or `C3` for one cell. */
  range: string;
  top: CellAt;
  bottom: CellAt;
}

export interface CellsOfDropdownAnswer {
  kind: 'cellsOfDropdown';
  dropdownId: string;
  /** Column by column, from the top. */
  stretches: StretchOfADropdown[];
  indexOfTheStretchWithTheCell: number | null;
}

export interface ReadViewsRequest {
  kind: 'readViews';
}

export interface ViewsAnswer {
  kind: 'views';
  views: ViewContents[];
}

export interface ReadInputsOfViewRequest {
  kind: 'readInputsOfView';
  viewId: string;
}

/** A cell as an input reads it: a date or a time as ISO text, an error or nothing as `null`. */
export interface CellReadByAnInput {
  value: number | string | boolean | null;
  text: string;
}

export interface InputRead {
  name: string;
  rows: CellReadByAnInput[][];
}

export interface InputsOfViewAnswer {
  kind: 'inputsOfView';
  viewId: string;
  elements: { elementId: string; inputs: InputRead[] }[];
  /** An interactive view only: a reset would change some cell of its inputs. */
  canBeReset?: true;
  /** An interactive view only: its inputs hold values other than the ones it keeps. */
  hasDefaultsToSave?: true;
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/** The part rows of a table's body play. */
export type RoleOfRows = 'record' | 'spacer' | 'section' | 'subtotal' | 'headerAgain';

/** A table as the page names it by ids. */
export interface TableInIds {
  sheetId: SheetId;
  header: { firstRow: RowId; lastRow: RowId; isSure: boolean } | null;
  firstColumn: ColumnId;
  lastColumn: ColumnId;
  firstRowOfBody: RowId;
  lastRowOfBody: RowId;
  rowUnderTheBody: RowId | null;
  runs: { firstRow: RowId; lastRow: RowId; role: RoleOfRows }[];
}

/** A column of a table: its name and the kind of what it holds. */
export interface ColumnOfATable {
  /** Every column of a table lies in the sheet, so it has an id. */
  c: ColumnId;
  name: string | null;
  kind: KindOfAColumn;
}

/** A table guessed, with its columns. */
export interface TableWithColumns {
  basis: BasisOfATable;
  table: TableInIds;
  columns: ColumnOfATable[];
}

export interface ReadTableAtCellRequest {
  kind: 'readTableAtCell';
  sheetId: SheetId;
  cell: CellAt;
}

/** `null` when no table is around the cell. */
export interface TableAnswer {
  kind: 'table';
  read: TableWithColumns | null;
}

/** A cell table as the page reads it: its id (`null` for one guessed), as declared, where it is now, its table. */
export interface CellTableRead {
  cellTableId: string | null;
  cellTable: CellTable;
  liveCellTable: CellTable | null;
  /** `null` without a body. */
  table: TableWithColumns | null;
}

export interface ReadCellTablesRequest {
  kind: 'readCellTables';
  sheetId: SheetId;
}

export interface CellTablesAnswer {
  kind: 'cellTables';
  cellTables: CellTableRead[];
}

export interface ReadCellTableAtRequest {
  kind: 'readCellTableAt';
  sheetId: SheetId;
  cell: CellAt;
}

/** `null` when no cell table holds the cell. */
export interface CellTableAtAnswer {
  kind: 'cellTableAt';
  cellTable: CellTableRead | null;
}

/** The cell table a sheet would declare; answered as `cellTableAt`. */
export interface ReadCellTableDeclaredAsRequest {
  kind: 'readCellTableDeclaredAs';
  sheetId: SheetId;
  cellTable: CellTable;
}

/** Why a table is assumed rather than recognized. */
export type WhyNotRecognized =
  | 'oneColumn'
  | 'noHeadings'
  | 'columnWithoutAHeading'
  | 'twoColumnsOfOneName'
  | 'mergedCellsAmongRecords'
  | 'rowUnderTheTotal'
  | 'sumOfSomeRecords'
  | 'sumRunsOverHeadings'
  | 'fewerThanTwoRecords'
  | 'labelsPastABlankColumn'
  | 'headingComesAgain'
  | 'mayBeLabelsAndValues'
  | 'nothingProvesTheHeader';

export type BasisOfATable =
  | { kind: 'recognized' }
  | { kind: 'assumed'; whyNotRecognized: WhyNotRecognized }
  | { kind: 'declared'; cellTableId: string };

/** The part rows of a table found in a sheet play. */
export type RoleOfRowsFound = 'record' | 'sectionLabel' | 'subtotal' | 'blank';

export interface TableOfASheet {
  basis: BasisOfATable;
  headerRows: { firstRow: RowId; lastRow: RowId };
  firstColumn: ColumnId;
  lastColumn: ColumnId;
  columns: { c: ColumnId; name: string | null; kind: KindOfAColumn }[];
  body: { firstRow: RowId; lastRow: RowId; role: RoleOfRowsFound }[];
  footerRows: { firstRow: RowId; lastRow: RowId } | null;
}

export interface ReadTablesOfSheetRequest {
  kind: 'readTablesOfSheet';
  sheetId: SheetId;
}

export interface TablesOfSheetAnswer {
  kind: 'tablesOfSheet';
  tables: TableOfASheet[];
}

/** Answered as `unreadableRequest`. */
export interface ReadTableWithinRequest {
  kind: 'readTableWithin';
}

export interface ReadWhatATableChangesRequest {
  kind: 'readWhatATableChanges';
  table: TableIntoSheet;
  /** 8 to 16 small letters and digits. */
  newIdCode: string;
}

/** What becomes of a row of the file; `columns` are the file's columns that change the row. */
export type WhatBecomesOfARow =
  | { kind: 'leftOut' }
  | { kind: 'added' }
  | { kind: 'changes'; row: RowId; columns: number[] }
  | { kind: 'same'; row: RowId };

export interface WhatATableChangesAnswer {
  kind: 'whatATableChanges';
  rows: WhatBecomesOfARow[];
  rowsThatGo: RowId[];
  rowsNotInTheTable: RowId[];
  /** New options by dropdown; `column` is the file's. */
  optionsAdded: { dropdownId: string; column: number; labels: string[] }[];
}

/** A value a filter asks for (`null` in a list: blank). */
export type ValueAskedFor =
  | { kind: 'number'; value: number }
  | { kind: 'text'; value: string }
  | { kind: 'boolean'; value: boolean }
  | { kind: 'error'; value: CellErrorText };

export type Asked =
  | { kind: 'meets'; condition: CellCondition }
  | { kind: 'isOneOf'; values: (ValueAskedFor | null)[] }
  | { kind: 'isNoneOf'; values: (ValueAskedFor | null)[] };

/** Lines that must all hold, each of tests one of which must. */
export interface Filter {
  allOf: { anyOf: { c: ColumnId; asked: Asked }[] }[];
}

export interface ReadFilteredRowsRequest {
  kind: 'readFilteredRows';
  table: TableInIds;
  filter: Filter;
}

export interface FilteredRowsAnswer {
  kind: 'filteredRows';
  firstRowOfBody: RowId;
  lastRowOfBody: RowId;
  rowsOutOfView: IdRun[];
  records: number;
  recordsInView: number;
  /** Boxes around the cells left and right of the table in rows out of view. */
  cellsBesideTheTableOutOfView: RangeCorners[];
}

export interface ReadValuesOfFilteredColumnRequest {
  kind: 'readValuesOfFilteredColumn';
  table: TableInIds;
  /** `null`: no filter. */
  filter: Filter | null;
  c: ColumnId;
}

/** A value a column holds, the first record that holds it, and how many the other lines leave in view. */
export interface ValueOfAFilteredColumn {
  /** `null`: blank. */
  value: ValueContents | null;
  firstInRow: RowId;
  records: number;
  meetsTheLinesOfItsColumn: boolean;
}

export interface ValuesOfFilteredColumnAnswer {
  kind: 'valuesOfFilteredColumn';
  values: ValueOfAFilteredColumn[];
  areMoreLeftOut: boolean;
}

// ---------------------------------------------------------------------------
// Pivot tables
// ---------------------------------------------------------------------------

/** The pivot table at a cell: the one whose formula is in the cell, or whose values spill over it. */
export interface ReadPivotTableAtRequest {
  kind: 'readPivotTableAt';
  sheetId: SheetId;
  cell: CellAt;
}

/** A pivot table found at a cell. */
export interface PivotTableRead {
  /** The cell that holds its formula. */
  cell: CellAt;
  /** `null`: the formula does not read as a pivot table. */
  pivotTable: PivotTable | null;
  /** The table of the sheet it reads (`null`: none is found under its header row). */
  table: TableOfASheet | null;
  /** Whether each source column it reads ends at the table's last record, or runs on with no end. */
  readsJustTheRecords: boolean;
}

export interface PivotTableAtAnswer {
  kind: 'pivotTableAt';
  /** `null`: no pivot table at the cell. */
  read: PivotTableRead | null;
}

/**
 * The values a column of a pivot table's source holds, in order, each with
 * whether a filter that keeps (or leaves out) the listed ones keeps it. With
 * nothing listed, every value is kept.
 */
export interface ReadValuesToFilterPivotTableByRequest {
  kind: 'readValuesToFilterPivotTableBy';
  source: PivotTableSource;
  c: ColumnId;
  keeps: PivotKeeps;
  /** `null`: blank. */
  listed: (PivotWrittenValue | null)[];
}

/** The rows a `sortRows` of the same fields would order, in its order. */
export interface ReadRowsInSortedOrderRequest {
  kind: 'readRowsInSortedOrder';
  sheetId: SheetId;
  oneRow: RowId;
  otherRow: RowId;
  byColumn: ColumnId;
  direction: SortDirection;
  thenBy?: FurtherKey[];
}

export interface RowsInSortedOrderAnswer {
  kind: 'rowsInSortedOrder';
  rows: IdRun[];
}

// ---------------------------------------------------------------------------
// The .xlsx file
// ---------------------------------------------------------------------------

export type ChartStacking = 'none' | 'stacked' | 'stackedToTheWhole';

/** Where a chart's numbers come from: one input as a table, or an input for each list. */
export type ChartData =
  | { from: 'table'; input: string; seriesAre: 'columns' | 'rows'; labelsLeftOut: string[] }
  | { from: 'lists'; categories: string; series: string[]; firstCellIsAHeading: boolean };

/** A chart as the page describes it, or `none` with why. */
export type ChartDescription =
  | { kind: 'bar'; direction: 'vertical' | 'horizontal'; stacking: ChartStacking; data: ChartData }
  | { kind: 'line'; stacking: ChartStacking; data: ChartData }
  | { kind: 'area'; stacking: ChartStacking; data: ChartData }
  | { kind: 'pie'; data: ChartData }
  | { kind: 'doughnut'; data: ChartData }
  | { kind: 'scatter'; data: ChartData }
  | { kind: 'none'; why: 'worksOutItsNumbersInCode' | 'noSuchKind' };

export interface ReadXlsxFileRequest {
  kind: 'readXlsxFile';
  /** The hidden sheet the dropdowns' options go in. */
  nameOfTheSheetOfOptions: string;
  /** By hue, then shade: `#` and six lower-case hex digits, every hue with every shade. */
  rgbOfStandardColors: Record<string, Record<string, string>>;
  /**
   * The charts by their views, each with a description as the agent or the server gave it, unchecked. The engine reads
   * it strictly: one that is not a `ChartDescription` leaves its chart out, as `descriptionNotReadable`.
   */
  charts?: { viewId: string; description: unknown }[];
}

/** What the file does not carry over. */
export type NotCarriedOver =
  | 'formulasWrittenAsValues'
  | 'randomNumbersThatStay'
  | 'users'
  | 'linksOfPartsOfTexts'
  | 'linksOfSomeCells'
  | 'listsInTexts'
  | 'checkboxes'
  | 'colorsOfDropdownOptions'
  | 'sheetNames'
  | 'looksOfSomeBlankCells'
  | 'sizesOfTheLargestRowsAndColumns'
  | 'conditionalFormats'
  | 'placedViews'
  | 'looksOfCharts'
  /** A sheet that shows an interactive view is written as its cells. */
  | 'interactives'
  /** Saved views; the engine does not report them yet. */
  | 'namedViews';

/** Why a placed view is not a chart in the file. */
export type WhyAChartIsLeftOut =
  | 'notAChart'
  | 'notDescribed'
  | 'descriptionNotReadable'
  | 'worksOutItsNumbersInCode'
  | 'noSuchKind'
  | 'inputTooLarge'
  | 'unknownInput'
  | 'inputHoldsNothing'
  | 'tableHoldsNoCategoryOrNoSeries'
  | 'categoriesLieApart'
  | 'listIsNotOneRowOrColumn'
  | 'noSeriesHoldsANumber'
  | 'severalSeriesInAPie'
  | 'categoriesOfAScatterHoldNoNumber'
  | 'tooManySeries'
  | 'tooManyPoints'
  | 'tooManyPointsInAllCharts';

/** The file's parts, each its path in the zip and its XML. */
export interface XlsxFileAnswer {
  kind: 'xlsxFile';
  parts: { path: string; xml: string }[];
  notCarriedOver: NotCarriedOver[];
  chartsLeftOut: { viewId: string; why: WhyAChartIsLeftOut }[];
}

// ---------------------------------------------------------------------------
// Every read
// ---------------------------------------------------------------------------

/** Each read's request and the answer it gets when it is not refused. */
export interface ReadKinds {
  readWorkbook: { request: ReadWorkbookRequest; answer: WorkbookContents };
  readCells: { request: ReadCellsRequest; answer: CellsContentsAnswer };
  readCauseOfError: { request: ReadCauseOfErrorRequest; answer: CauseOfErrorAnswer };
  readTypedFormula: { request: ReadTypedFormulaRequest; answer: TypedFormulaAnswer };
  readProposedFormulaValue: { request: ReadProposedFormulaValueRequest; answer: ProposedFormulaValueAnswer };
  readTextToEdit: { request: ReadTextToEditRequest; answer: TextToEditAnswer };
  readCellsToCopy: { request: ReadCellsToCopyRequest; answer: CellsToCopyAnswer };
  readCellsToCopyInTheOrderOfTheirRows: {
    request: ReadCellsToCopyInTheOrderOfTheirRowsRequest;
    answer: CellsToCopyAnswer;
  };
  readFormatsGiven: { request: ReadFormatsGivenRequest; answer: FormatsGivenAnswer };
  readSharedCellFormat: { request: ReadSharedCellFormatRequest; answer: SharedCellFormatAnswer };
  readSheetLayout: { request: ReadSheetLayoutRequest; answer: SheetLayoutAnswer };
  readTimeZone: { request: ReadTimeZoneRequest; answer: TimeZoneAnswer };
  readConditionalFormatSuggestions: {
    request: ReadConditionalFormatSuggestionsRequest;
    answer: ConditionalFormatSuggestionsAnswer;
  };
  readConditionalFormatsInIds: { request: ReadConditionalFormatsInIdsRequest; answer: ConditionalFormatsInIdsAnswer };
  readConditionalFormatsByAddress: {
    request: ReadConditionalFormatsByAddressRequest;
    answer: ConditionalFormatsByAddressAnswer;
  };
  readConditionalFormatsAsAgentIsTold: {
    request: ReadConditionalFormatsAsAgentIsToldRequest;
    answer: ConditionalFormatsAsAgentIsToldAnswer;
  };
  readDropdownOptionsToOffer: { request: ReadDropdownOptionsToOfferRequest; answer: DropdownOptionsToOfferAnswer };
  readCellsThatADropdownWouldClear: {
    request: ReadCellsThatADropdownWouldClearRequest;
    answer: CellsThatADropdownWouldClearAnswer;
  };
  readCellsOfTheDropdownAt: { request: ReadCellsOfTheDropdownAtRequest; answer: CellsOfDropdownAnswer };
  readViews: { request: ReadViewsRequest; answer: ViewsAnswer };
  readInputsOfView: { request: ReadInputsOfViewRequest; answer: InputsOfViewAnswer };
  readTableAtCell: { request: ReadTableAtCellRequest; answer: TableAnswer };
  readTableWithin: { request: ReadTableWithinRequest; answer: never };
  readCellTables: { request: ReadCellTablesRequest; answer: CellTablesAnswer };
  readCellTableAt: { request: ReadCellTableAtRequest; answer: CellTableAtAnswer };
  readCellTableDeclaredAs: { request: ReadCellTableDeclaredAsRequest; answer: CellTableAtAnswer };
  readWhatATableChanges: { request: ReadWhatATableChangesRequest; answer: WhatATableChangesAnswer };
  readFilteredRows: { request: ReadFilteredRowsRequest; answer: FilteredRowsAnswer };
  readValuesOfFilteredColumn: { request: ReadValuesOfFilteredColumnRequest; answer: ValuesOfFilteredColumnAnswer };
  readRowsInSortedOrder: { request: ReadRowsInSortedOrderRequest; answer: RowsInSortedOrderAnswer };
  readTablesOfSheet: { request: ReadTablesOfSheetRequest; answer: TablesOfSheetAnswer };
  readPivotTableAt: { request: ReadPivotTableAtRequest; answer: PivotTableAtAnswer };
  readValuesToFilterPivotTableBy: {
    request: ReadValuesToFilterPivotTableByRequest;
    answer: ValuesOfFilteredColumnAnswer;
  };
  readXlsxFile: { request: ReadXlsxFileRequest; answer: XlsxFileAnswer };
}

export type ReadKind = keyof ReadKinds;

export type ReadRequest = { [K in ReadKind]: ReadKinds[K]['request'] }[ReadKind];

/** The answer a read of this kind gets when it is not refused. */
export type ReadAnswer<K extends ReadKind = ReadKind> = ReadKinds[K]['answer'];
