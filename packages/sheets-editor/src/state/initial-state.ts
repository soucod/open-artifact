import type {
  Asked,
  BorderStyle,
  CellAt,
  CellCondition,
  CellContents,
  CellTable,
  Color,
  ColumnId,
  ColumnOfATable,
  Edit,
  IdRun,
  ListLine,
  NotCarriedOver,
  OffsetOfAPlacement,
  FunctionFamily,
  Refused,
  RowId,
  SheetId,
  SortDirection,
  StretchOfADropdown,
  TableOfASheet,
  TextThatNoCellShows,
  ValueContents,
  ValueOfAFilteredColumn,
} from '@open-artifact/sheets-core';
import type { StockKind } from '@open-artifact/sheets-core/stock-charts';
import type { PeopleListOpen, ProfileOfPerson } from '../chips/people-list.ts';
import type { CalendarTime } from '../chips/calendar.ts';
import type { TimeListFocus } from '../editor/time-list.ts';
import type { HeardSelection } from '../presence/room.ts';
import type { SelectionCorners } from '../presence/selections.ts';
import type { FormatToCome } from './formats-to-come.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { CellArea, CellSelection } from '../selection/model.ts';
import type { CaretSpan } from '../keys/key-acts.ts';
import type { CellDensity } from '../grid/cell-metrics-values.ts';
import type { GridPoint, GridScroll, LinesAxisName } from '../grid/geometry.ts';
import type { SelectionHandle } from '../kit/selection-frame.tsx';
import type { FillingDrag } from '../selection/fill-handle.ts';
import type { MovingCellsDrag } from '../selection/move-cells.ts';
import type { MovingLinesDrag } from '../selection/move-lines.ts';
import type { MovingColumnsOfTableDrag } from '../selection/move-table-columns.ts';
import type { ResizingDrag, SelectingDrag, TappingDrag } from '../selection/pointer.ts';
import type { CellsReplaced } from '../selection/move-cells.ts';
import type { ColumnsOfTableMoving } from '../selection/move-table-columns.ts';
import type { RowsAndColumnsOfTableToSort } from '../selection/table-select.ts';
import type { LabelEnds } from '../model/a1-references.ts';
import type { RefusalMessageKey } from '../model/refusals.ts';
import type { WorkbookVersion } from '../history/requests.ts';
import type { TakingBackAsked } from '../history/version-history.ts';
import type {
  AskedKindOfEdit,
  CellHoldsNoMorePeopleNotice,
  EditAnswerRefusedNotice,
  GroupsTooDeepNotice,
  TooManyNamedViewsNotice,
  LinesInTheWayNotice,
  SheetNameRefusal,
  SheetNameRefusedNotice,
  StepNotTakenNotice,
  StepShown,
} from './edit-answers.ts';
import type { EditRefusedNotice } from './edit-refusals.ts';
import type { ChartPastedDone, CopiedOrCutDone, PasteRefusedNotice } from './copy-paste.ts';
import type { DuplicateRefusedNotice, SheetDeletedUndoOffer, SheetShownDone } from './sheet-tabs.ts';
import type { SheetMoved } from './sheet-move.ts';
import type { OwnCellLost } from './own-cell-lost.ts';
import type { InteractiveDone } from './places.ts';
import type { OwnSortChoice } from '../tables/own-filters.ts';
import type { PivotTableDone, PivotTableOfPane } from '../tables/pivot-tables.ts';
import type { NamedViewDeletedOffer, NamedViewDone } from '../tables/named-view-actions.ts';
import type { OwnViewShownAsApplied } from '../tables/filter-messages.ts';
import type { PlaceOfLink } from '../shell/sheet-links.ts';
import type { EntryCameToError } from './reasons-for-errors.ts';
import type { CopiedCellsLetGo } from './copied-cells.ts';
import type { WhatCaretLeft } from './focus-return.ts';
import type {
  CellHistoryOutcome,
  ChartNodesCopiedFor,
  CopyRefused,
  EditsDropped,
  FileToImportNotRead,
  ImportDestinationPick,
  ImportReading,
  PasteChosen,
  RowsAsked,
  WhyVersionNotShown,
} from './event-reducer.ts';
import type { Place } from './places.ts';
import type { PageMode } from './transitions.ts';
import type { FiguresOfSelection } from './figures-of-selection.ts';
import type { FormatOfSelection, SelectionSeen } from './selection-seen.ts';
import type { ExplainedUnderCell, LinkAddressShown } from './explained-under-cell.ts';
import type { WaysIn } from './ways-in.ts';
import type { AnswerAwaited, NotesOfSteps } from './notes-of-steps.ts';
import type { CalculatingShown, Wait } from './calculating-shown.ts';
import type { LongCalculationTold } from './long-calculation.ts';
import type { OffersAtSelection } from './offers-at-selection.ts';
import type { ErrorExplanation } from '../messages/formula-errors.ts';
import type { ConditionChoice, ConditionalFormatDone } from '../messages/conditional-format.ts';
import type { ParagraphListKind } from '../messages/import.ts';
import type { ImportDelimiter } from '../import/csv-file.tsx';
import type { PagePoint } from '../comments/page-comments.ts';
import type { DropdownSelectionSummary } from '../chips/dropdown-editor.ts';
import type {
  ConditionalFormatsDrawnAs,
  ConditionalFormatsPane as RulesPaneOpen,
  KeptRulesOfAgent,
  LineRuns,
} from '../format/conditional/pane-state.ts';
import type { AgentPrompt } from '../format/conditional/agent-prompts.ts';
import type {
  CustomFormatAgent,
  CustomPatternReading,
  CustomPatternTypedIn,
  HowPatternIsTyped,
  NumberFormatReply,
} from '../format/custom-number-format.ts';
import type { ShownUnderPattern } from '../format/number-format-choices.ts';
import type { AutocompleteColumn } from '../messages/formula-autocomplete.ts';
import type { AgentUndoRefusalWhy, CellsChangedByAgent, ChangesByAgent } from '../i18n/agent-turn-labels.ts';
import type { DropdownPresetKey, NamedDropdownPreset } from '../i18n/chip-labels.ts';
import type { ChipPaints } from '../grid/cell-drawing.tsx';
import type { CellFormatChoice } from '../i18n/change-labels.ts';
import { DEFAULT_CELL_DENSITY } from '../grid/cell-metrics-values.ts';
import { restoredPlace } from './places.ts';
import { NO_BOXES_AT_FOOT } from '../grid/geometry.ts';
import { NO_OWN_COLLAPSING, NO_ROWS_OUT_OF_VIEW_BY_FILTERS } from '../grid/line-runs.ts';
import { NO_OWN_ROW_ORDERS, NO_OWN_FILTERS } from '../tables/own-filters.ts';
import type { HeldOwnFilterSnapshot as HeldOwnFilterSnapshotOfTable, OwnFilter as OwnFilterOfTable, WhyRowsNotNow } from '../tables/own-filters.ts';
import { numberFormatExamples, CELL_FORMAT_CHOICES } from '../format/number-format-choices.ts';
import { NO_FIGURES_OF_SELECTION, updateFiguresOfSelection } from './figures-of-selection.ts';
import { makeFormatOfSelection, settleSelectionSeen } from './selection-seen.ts';
import { DEFAULT_CELL_FORMAT } from '../model/cell-format.ts';
import { NO_AREA_BORDERS } from '../grid/borders.ts';
import { DEFAULT_BORDER_PEN } from '../format/borders.ts';
import type { BorderLine } from '../format/borders.ts';
import { NOTHING_EXPLAINED_UNDER_CELL } from './explained-under-cell.ts';
import { waysInAtOpening } from './ways-in.ts';
import { NO_NOTES_OF_STEPS } from './notes-of-steps.ts';
import type { FunctionGuideAtCall } from '../formulas/autocomplete.ts';
import { EMPTY_FORMULA_HELP } from '../formulas/autocomplete.ts';
import { FORMULA_FROM_WORDS_START } from '../formulas/from-words/offer.ts';
import type { FixableError } from '../formulas/fix/ask.ts';
import type { CellsToSortAsked } from '../tables/sort.ts';
import type { SortOfPane, SortsFor } from '../tables/sort-pane.ts';
import type { SortOrMoveToLookBackOn } from '../tables/sort-changed-results.ts';
import type { ChartOfferOfCells } from '../charts/chart-offers.ts';
import type { CopyLinkOutcome } from '../shell/sheet-links.ts';
import type { DropdownEditor } from '../chips/dropdown-pane-edits.ts';
import type { EntryUnansweredWithList } from '../editor/unanswered-entries.ts';
import type { FormulaNotWrittenWhy } from '../messages/formula-writing.ts';
import { NO_FIXES_ON_CELLS } from '../formulas/fix/cells-to-fix.ts';
import { NO_TABLES_READ } from '../engine/worker-workbook.ts';
import { NAVIGATING_MODE } from './transitions.ts';
import type { CellsPointedAt, PointedReferenceWritten } from '../formulas/reference-pointing.ts';
import type { ViewShownByAgent } from '../agent/shown-by-agent.ts';
import { NO_REFERENCES } from '../formulas/reference-pointing.ts';
import { CALCULATING_NOT_SHOWN } from './calculating-shown.ts';
import { NO_LONG_CALCULATION } from './long-calculation.ts';
import { NO_OFFERS_AT_SELECTION } from './offers-at-selection.ts';
import { keepScrollAnchoredAcrossChange } from '../grid/layout.ts';
import { followEntryCellText } from '../editor/start-entry.ts';
import type { ReadsWithTextMeasurer } from './controller.ts';
import type { undoOfTurnOf, WrittenOfTurn } from '../agent/turn-of-agent.ts';
export interface ScrollForLessRoom {
  from: number;
  end: number;
  at: number;
}
export interface ScrollsForLessRoom {
  sheetId: SheetId;
  across: ScrollForLessRoom | null;
  down: ScrollForLessRoom | null;
}
export interface SavedPlace extends Place {
  lines: string | null;
  density: CellDensity;
  scrolledForLessRoom?: ScrollsForLessRoom | null;
}
export interface Press {
  cellId: CellId;
  x: number;
  y: number;
  viewThen: GridScroll;
  viewAfter: GridScroll;
}
export interface TabRun {
  from: CellId;
  at: CellId;
}
export interface ScrolledForEntry {
  /** The cell scrolled to; the scroll is given back only while it stays selected. */
  cell: CellId;
  from: GridScroll;
  to: GridScroll;
}
export interface ScrolledForNewChart extends ScrolledForEntry {
  placementId: string;
}
export interface NoticesAtFoot {
  left: number;
  heightUnderTheRest: number;
}
export interface BoxAtFoot {
  left: number;
  right: number;
  heightUnder: number;
}
export interface OwnSortKey {
  byColumn: ColumnId;
  direction: SortDirection;
}
export interface OwnSort {
  by: OwnSortKey[];
  rows: IdRun[] | null;
}
export type OwnFilter = OwnFilterOfTable;
/** A value of the own filter list as it is drawn. */
export interface FilterValueDrawn {
  index: number;
  text: string | null;
  isChecked: boolean | null;
  optionPaints: ChipPaints | null;
  records: number;
  isTicked: boolean;
}
export interface OwnFilterValues {
  listed: ValueOfAFilteredColumn[];
  areMoreLeftOut: boolean;
  texts: (string | null)[];
  ticks: boolean[];
  found: number[];
  drawn: FilterValueDrawn[];
}
export interface OwnFilterConditionHeld {
  choice: ConditionChoice;
  first: string;
  second: string;
}
export interface OwnFilterCondition {
  key: number;
  held: OwnFilterConditionHeld;
  /** The condition read from what is held: none while its fields are not filled or mistyped. */
  asks: CellCondition | null;
  isMistyped: boolean[];
}
/** What a column holds, for sorting it. */
export type SortHoldsOfColumn = 'numbers' | 'dates' | 'times' | 'text' | 'options';
export interface OwnFilterListSort {
  keys: SortHoldsOfColumn | null;
  inForce: SortDirection | null;
  isForOneself: boolean;
}
/** A value a column holds, with how many records hold it and who they are of. */
export interface ColumnValueHeld {
  value: ValueContents | null;
  records: number;
  userIds: string[];
}
/** A column of a table, with the values it holds, as the agent is told of it. */
export interface ColumnHolds extends ColumnOfATable {
  values: ColumnValueHeld[];
  areMoreValuesLeftOut: boolean;
  optionsOfDropdown: string[] | null;
}
/** What a table holds, as the agent is told of it. */
export interface TableHolds {
  records: number;
  columns: ColumnHolds[];
}
export type ReadyFilterWhat = 'mine' | 'allBut' | 'largest' | 'smallest' | 'duplicates' | 'thisWeek' | 'nextWeek' | 'thisMonth' | 'overdue';
/** A filter offered ready-made in the own filter list. */
export interface ReadyFilter {
  what: ReadyFilterWhat;
  asked: Asked;
  label: string | null;
  records: number;
}
export interface OwnFilterList {
  tableKey: string;
  isFilterNotDrawnYet: boolean;
  isTableGuessed: boolean;
  c: ColumnId;
  values: OwnFilterValues | null;
  startsFromNone: boolean;
  conditions: OwnFilterCondition[];
  join: 'and' | 'or';
  choices: ConditionChoice[];
  sort: OwnFilterListSort | null;
  words: string;
  isAnswerRead: boolean;
  areWordsOnTheirWay: boolean;
  today: string | null;
  holds: TableHolds;
  ready: ReadyFilter[];
  answer: Asked | null;
}
/** Where the selection stood, to go back to. */
export type SelectionPlace = Pick<PageState, 'sheetId' | 'activeCell' | 'selectionCorner' | 'otherRanges' | 'rangeWalked' | 'scrollTop'>;
/** An own filter as it stood before a try, with the other filters of its sheet and the rows they hid. */
export type HeldOwnFilterSnapshot = HeldOwnFilterSnapshotOfTable;
export type SuggestedAskWhat =
  | { kind: 'mineSorted'; column: string }
  | { kind: 'mine' }
  | { kind: 'allBut'; label: string }
  | { kind: 'only'; label: string }
  | { kind: 'sorted'; column: string };
/** Rows offered to be asked for, and how many records they come to. */
export interface SuggestedAsk {
  what: SuggestedAskWhat;
  asked: RowsAsked;
  records: number | null;
}
/** The words asked with, read as a filter, or what of them could not be read. */
export type WordsReadAsFilter =
  | { kind: 'read'; asked: RowsAsked }
  | { kind: 'notRead'; wordsNotPlaced: string[]; wordsNotKnown: string[]; isOnItsWay: boolean };
/** A table to sort, and whether a sort moves its whole rows or only its cells. */
export type TableToSort = RowsAndColumnsOfTableToSort & { moves: 'rows' | 'cells' };
/** A column the agent is told of when asked which rows. */
export interface RowsAskColumnTold {
  letters: string;
  holds: ColumnHolds;
}
export type AgentForRowsAsk =
  | { kind: 'isAsked'; askId: number; columns: RowsAskColumnTold[] }
  | { kind: 'hasRead'; askId: number }
  | { kind: 'hasFailed'; askId: number; isRateLimited: boolean }
  | { kind: 'hasNotRead' };
/** The ask of the agent made ahead of the person's words: its id, held back, or failed. */
export type RowsAskAheadStands = number | 'isHeldBack' | 'hasFailed';
/** The table the rows are asked of. */
export interface RowsAskTable {
  key: string;
  holds: TableHolds;
  suggested: SuggestedAsk[];
  columnAtCell: ColumnId | null;
  sorts: 'forOneself' | 'forEveryone' | null;
  /** Rows inside the table that hold no record (blank rows, spacers), which keep it from being sorted. */
  rowsThatAreNoRecords: number;
  isRead: boolean;
}
/** The table of the selected columns, when the rows are asked of it. */
export interface TableUnderLetters {
  table: TableToSort;
  columnId: ColumnId;
}
export interface RowsAskedFor {
  isOfFilterBar: boolean;
  hasTurnedFilterOn: boolean;
  isFilterNotDrawnYet: boolean;
  isTableGuessed: boolean;
  hasStopped: boolean;
  table: RowsAskTable | null;
  tableUnderLetters: TableUnderLetters | null;
  placeBefore: SelectionPlace;
  placeBeforeAsOf: number;
  beforeTry: HeldOwnFilterSnapshot | null;
  placeAfterTry: SelectionPlace | null;
  isToolOnBar: boolean;
  cameBackFrom: ColumnId | null;
  words: string;
  read: WordsReadAsFilter | null;
  today: string | null;
  agent: AgentForRowsAsk | null;
  askAhead: RowsAskAheadStands | null;
}
/** A drag of the grip that sets how many rows or columns are frozen. Made by grid/freeze.ts. */
export interface FreezingDrag {
  kind: 'freezing';
  sheetId: SheetId;
  what: LinesAxisName;
  pressedAt: GridPoint;
  countAtPress: number;
  count: number | null;
}
/** Where a placed view would land: its top left cell and how far into it. */
export interface PlacedViewLanding {
  topLeft: CellId;
  offsetFromAnchorCell: OffsetOfAPlacement;
}
/** Where a placed view would land and the size it would take. */
export interface PlacedViewSized extends PlacedViewLanding {
  widthInPixels: number;
  heightInPixels: number;
}
/** What every drag of a placed view holds. Made by charts/placed-views.ts. */
export interface PlacedViewHold {
  placementId: string;
  pressedAt: GridPoint;
  leastDrag: number;
  isCornerUnderFrozenLines: { columns: boolean; rows: boolean };
}
/** A drag that changes the size of a placed view by a side or a corner. */
export interface SizingPlacedViewDrag extends PlacedViewHold {
  kind: 'sizingPlacedView';
  sides: SelectionHandle;
  sized: PlacedViewSized | null;
}
/** A drag that moves a placed view over the cells. */
export interface MovingPlacedViewDrag extends PlacedViewHold {
  kind: 'movingPlacedView';
  grip: GridPoint;
  landing: PlacedViewLanding | null;
}
/** A drag that points at cells to refer to in the entry. Made by formulas/reference-pointing.ts. */
export interface PointingDrag {
  kind: 'pointing';
}
/** What a pointer held down on the grid is doing. */
export type Dragging =
  | FreezingDrag
  | SizingPlacedViewDrag
  | MovingPlacedViewDrag
  | PointingDrag
  | FillingDrag
  | MovingCellsDrag
  | MovingLinesDrag
  | MovingColumnsOfTableDrag
  | SelectingDrag
  | TappingDrag
  | ResizingDrag;
export type DraggingKind = Dragging['kind'];
/** A drag held still until the workbook answers the edit it ended with. */
export interface HeldUntilAnswered {
  held: Dragging;
  edit: Edit;
}
export type MenuHolds = 'all' | 'cellsToSort' | 'chart' | 'columnWidthField' | 'figures' | 'noEdits' | 'rowHeightField';
export interface SortColumnsPointedAt {
  range: ColumnId | null;
  sheet: ColumnId | null;
}
/** The question of which cells to sort, as the menu holds it. */
export type CellsToSort = CellsToSortAsked;
export interface Menu {
  holds: MenuHolds;
  /** The point the menu opens at, in the page. */
  at: PagePoint;
  /** The side of `at` the menu opens toward, or `null` to let it choose. */
  side: 'top' | 'bottom' | null;
  isAskedByKey: boolean;
  isToSearch?: true;
  /** What the cells selected hold of the dropdown sets, once read (ui/menu.ts). */
  setMeets?: DropdownSelectionSummary | null;
  /** The chart whose menu this is (charts/placed-views.ts). */
  ofChart?: { placementId: string; canAgentChangeIt: boolean };
  sortColumnPicked?: ColumnId;
  sortColumnsPointedAt?: SortColumnsPointedAt;
  cellsToSort?: CellsToSort;
  /** The table the menu's sort acts on, when it opened on one cell (tables/table-to-sort.ts). */
  tableToSort?: TableToSort | null;
  /** The key of the table whose handle opened the menu (tables/table-handle-menu.ts). */
  ofHandleOfTable?: string;
  /** Set when the menu opened from the context bar (ui/menu.ts). */
  isOfContextBar?: true;
  /** Whom the menu's sorts of the sheet and of the range are for, once worked out (`null`: they sort nothing). */
  sortsFor?: { sheet: SortsFor | null; range: SortsFor | null };
}
export interface CustomNumberFormat extends HowPatternIsTyped {
  pattern: string;
  reading: CustomPatternReading;
  isRefusalTold: boolean;
  agent: CustomFormatAgent | null;
  hold: AnswerHold | null;
  typedIn: CustomPatternTypedIn;
  shownUnderPattern: ShownUnderPattern;
}
export interface PasteThatWaits {
  nth: number;
  chosen: PasteChosen;
  sheetId: SheetId;
  /** Texts no cell shows, to be shown to the person before the paste goes ahead. */
  toBeShown: TextThatNoCellShows[];
}
/** The locale or the time zone being picked for the workbook. */
export type PickForWorkbook =
  | { of: 'locale'; picked: string | null; ofWorkbook: string; all: string[] }
  | { of: 'timeZone'; picked: string | null; ofWorkbook: string | null; ofBrowser: string | null; all: string[] };
export interface ExamplesOfNumberFormats {
  locale: string;
  byChoice: Map<string, string>;
}
/** A text file read for import, split into lines of fields. */
export interface ImportFile {
  fileName: string;
  delimiter: ImportDelimiter;
  lines: string[][];
  columnCount: number;
}
/** The words an import is read with, in the person's language. */
export interface ImportReadingWords {
  stemOfNewSheetNames: string;
  names: { sheet: string; columns: string[] };
  dateOrder: { ask: string; monthFirst: string; dayFirst: string };
  decimalSign: { ask: string; comma: string; point: string };
}
export type ImportHow = Extract<ImportDestinationPick, { kind: 'sheet' }>['how'];
/** Where an import goes: a new sheet, or a table of a sheet. */
export type ImportDestination =
  | { kind: 'newSheet' }
  | { kind: 'sheet'; sheetId: SheetId; headerRowId: RowId; intoColumns: (ColumnId | null)[]; how: ImportHow };
export interface ImportColumnPlan {
  name: string;
  reading: ImportReading;
}
export interface ImportQuestionOption {
  label: string;
  readings: { columnIndex: number; reading: ImportReading }[];
}
export interface ImportQuestion {
  id: string;
  ask: string;
  options: ImportQuestionOption[];
  recommendedIndex: number;
  recommendedByAgentIndex?: number;
}
export interface ImportDestinationQuestion {
  ask: string;
  options: { label: string; destination: ImportDestination }[];
  recommendedIndex: number;
}
/** How a file is to be imported. */
export interface ImportPlan {
  sheetName: string;
  headerLine: number | null;
  linesLeftOut: number[];
  columns: ImportColumnPlan[];
  questions: ImportQuestion[];
  notes: string[];
  /** Absent from a plan made without the agent. */
  summary?: string | null;
  destination: ImportDestination;
  whyThere: string | null;
  destinationQuestion: ImportDestinationQuestion | null;
}
export interface ImportColumnByHand {
  name?: string;
  reading?: ImportReading;
  isLeftOut?: boolean;
}
/** What the person changed of the plan by hand. */
export interface ImportByHand {
  sheetName: string | null;
  headings: { line: number | null } | null;
  lines: Record<number, boolean>;
  columns: Record<number, ImportColumnByHand>;
}
/** A table of a sheet the file could go into. */
export interface ImportPlace {
  table: {
    sheetId: SheetId;
    name: string;
    headerRowId: RowId;
    columns: { columnId: ColumnId; name: string }[];
    recordCount: number;
    firstRecords: string[][];
  };
  intoColumns: (ColumnId | null)[];
  matchedCount: number;
  likeliestKeyColumnIndex: number | null;
  keys: { keyColumnIndex: number; changing: number; same: number; added: number; notInTheFile: number }[];
}
/** A cell of an import preview. */
export type ImportPreviewCell =
  | { kind: 'blank' }
  | { kind: 'number' | 'text' | 'keptAsText' | 'trueOrFalse'; shown: string }
  | { kind: 'option'; shown: string; color: Color };
export interface ImportPreviewColumn {
  columnIndex: number;
  name: string;
  reading: ImportReading;
  cells: ImportPreviewCell[];
  keptAsTextCount: number;
  optionCount: number | null;
}
export interface ImportPreview {
  columns: ImportPreviewColumn[];
  columnCount: number;
  linesOfFirstRows: number[];
  rowCount: number;
  lineLeftOutCount: number;
  linesLeftOut: number[];
}
/** A column of a sheet, as an import names it. */
export interface ImportSheetColumnLabel {
  letters: string;
  name: string | null;
}
export interface ImportIntoSheetRow {
  id: string;
  kind: 'added' | 'changed' | 'gone';
  cells: { cell: ImportPreviewCell; before: string | null }[];
}
/** What an import into a table of a sheet would change. */
export interface ImportIntoSheetChanges {
  kind: 'changes';
  columns: { columnIndexInTheFile: number; name: string; reading: ImportReading }[];
  isReplaced: boolean;
  columnsLeftOut: { columnIndexInTheFile: number; name: string }[];
  optionsAdded: { column: ImportSheetColumnLabel; labels: string[] }[];
  columnsCleared: ImportSheetColumnLabel[];
  formulasWrittenOver: { count: number; columns: ImportSheetColumnLabel[] };
  rows: ImportIntoSheetRow[];
  addedCount: number;
  changedCount: number;
  sameCount: number;
  goneCount: number;
  untouchedCount: number;
}
export type ImportIntoSheet = ImportIntoSheetChanges | Refused;
export interface ImportNewSheet {
  name: string;
  comesFirst: boolean;
  filledCellCount: number;
  hasRoom: boolean;
}
export interface ImportQuestionExample {
  text: string;
  becomes: string | null;
}
/** Digits a reading of a column would lose. */
export type ImportDigitsLost =
  | { digits: 'leadingZeros' | 'lastDigits'; isKept: boolean; count: number; filled: number }
  | { digits: 'decimalPlaces'; shown: number; count: number; filled: number };
/** A way to read a column, and how many of its fields it fits. */
export interface ImportReadingKind {
  reading: ImportReading;
  fitting: number;
  notFitting: number;
  isAgentsPick: boolean;
  digits: ImportDigitsLost[];
  example: string | null;
}
/** The plan as far as the agent has written it. */
export interface ImportPlanSoFar {
  plan: ImportPlan;
  preview: ImportPreview;
  isTableFound: boolean;
  columnsReadCount: number;
  summary: string | null;
  isSummaryWhole: boolean;
}
/** A change by hand that the agent's new plan let stand. */
export type ImportChangeStood =
  | { kind: 'headings' }
  | { kind: 'sheetName' }
  | { kind: 'destination' }
  | { kind: 'line'; line: number }
  | { kind: 'column'; columnIndex: number };
export interface ImportStood {
  stood: ImportChangeStood[];
  namesOfStood: Record<number, string>;
  isStoodPointedAt: boolean;
}
/** Where the import stands with the agent. */
export type AgentOfImport =
  | { kind: 'isToBeAsked' }
  | {
      kind: 'isAsked';
      askId: number;
      replyUnread: Extract<NumberFormatReply, { kind: 'answered' }> | null;
      asked: AgentPrompt;
      attempt: number;
      wish: string | null;
      isAskedAgain: boolean;
    }
  | { kind: 'hasFailed'; wish: string | null }
  | { kind: 'wasStopped' }
  | { kind: 'isNotToBeHad'; leftUndone: 'firstPlan' | 'wish' | null; why: 'tooMuchToTell' | 'noAgent' }
  | ({ kind: 'hasChangedNothing'; wish: string; why: string | null } & ImportStood)
  | ({ kind: 'hasPlanned' } & ImportStood);
export interface ImportOfAFile {
  table: ImportFile;
  words: ImportReadingWords;
  dataForAgent: string;
  dataForAgentWithCountsAlone: string;
  plan: ImportPlan;
  isPlanByAgent: boolean;
  plansOfAgent: ImportPlan[];
  readingsOfAgent: ImportReading[];
  plansHeardCount: number;
  /** The option chosen for each question, by question id. */
  answers: Record<string, number>;
  byHand: ImportByHand;
  columnsAnswered: number[];
  columnsAskedFor: number[];
  places: ImportPlace[] | null;
  placesGone: SheetId[];
  destinationChosen: ImportDestination | null;
  isAnAnswerInDoubt: boolean;
  isDiscardAsked: boolean;
  agent: AgentOfImport;
  soFar: ImportPlanSoFar | null;
  asTheSheetHolds: Record<number, ImportReading>;
  preview: ImportPreview;
  intoSheet: ImportIntoSheet | null;
  newSheet: ImportNewSheet | null;
  /** By question, then by option. */
  examples: ImportQuestionExample[][][];
  kinds: Record<number, ImportReadingKind[]>;
}
export interface FileAwaited {
  isAskedByKey: boolean;
  /** Why the file chosen last could not be imported: none until one is refused. */
  whyNot: Notice | null;
  refusedCount: number;
}
/** The name typed for a sheet being renamed that the workbook refused, and why. */
export type NameRefused = SheetNameRefusal;
export interface SheetBeingRenamed {
  sheetId: SheetId;
  nameWhenOpened: string;
  typed: string;
  refused: NameRefused | null;
}
export interface CheckboxesToSet {
  isAnyToCheck: boolean;
  isAnyToUncheck: boolean;
  isAnyUncheckedByFormula: boolean;
  isAnyCheckedByFormula: boolean;
}
export type BorderLineStyle = BorderStyle;
/** The line the border pen draws: its style and color. */
export type BorderPen = BorderLine;
export interface WordsOffered {
  cellId: CellId;
  typed: string;
  offered: string;
  isShown: boolean;
  isKeyDrawn: boolean;
  isGone: boolean;
}
export interface CalendarOpen {
  day: string | null;
  /** The cell's time, for a cell with a date and a time. */
  time: CalendarTime | null;
}
export interface LinkForm {
  cellId: CellId;
  /** The cell's text as it would be edited, or the entry's text for a form in an entry. */
  entry: string;
  text: string;
  /** Empty when there is no link. */
  address: string;
  hasLink: boolean;
  /** A number or true/false the cell holds, kept as it is while the text is unchanged. */
  valueKept: string | null;
  /** Set when the form was opened from a cell's entry, which it leaves as it shuts (links/links-in-entry.ts). */
  opensEntry?: true;
  /** Set for a form over part of the text of an entry being typed: where that part starts and ends. */
  inEntry?: { start: number; end: number };
}
/** A cell's error and why it shows; the reason is still being asked for while `isTellOnItsWay` is set. */
export interface ErrorExplained extends ErrorExplanation {
  isTellOnItsWay?: true;
}
export interface ReasonsForErrors {
  ofEntryCell: ErrorExplained | null;
  ofCellExplained: ErrorExplained | null;
  cellToFixInPlace: string | null;
  isFixInPlaceYetToBeKnown: boolean;
  isEntryCellToFixInPlace: boolean;
  isFixAtEntryCellYetToBeKnown: boolean;
  doCausesWaitForCalculation: boolean;
}
export interface ErrorsReadAsOf {
  sheetId: SheetId;
  workbookChangeCount: number;
  formulasWorkedOutCount: number;
}
/** Why the cells typed for a dropdown were refused. */
export type WhyDropdownCellsRefused = 'ofAnotherDropdown' | 'holdFormula' | 'holdNoOption' | 'headingIsNoOption' | 'notFound';
/** The cells typed for a dropdown that were refused, and why: a refused heading counts the times it was refused before, and cells not found keep what was typed. */
export type DropdownCellsRefused =
  | { why: Exclude<WhyDropdownCellsRefused, 'headingIsNoOption' | 'notFound'> }
  | { why: 'headingIsNoOption'; timesBefore: number }
  | { why: 'notFound'; typed: string };
/** An option of the dropdown being edited. */
export interface OptionOfDropdownInPane {
  optionId: string | null;
  label: string;
  color: Color;
}
/** The label being typed for an option of the dropdown, and the color picked for it. */
export interface TypedOptionInPane {
  /** `null` for an option not added yet. */
  optionId: string | null;
  label: string;
  pickedColor: Color | null;
}
/** Which cells a change of the dropdown goes to: every cell of it, or only the stretch with the cell. */
export type DropdownReach = 'everyCell' | 'ownStretch';
/** The dropdown being edited in the side pane. */
export interface DropdownEditorInPane {
  /** `null` while the dropdown is not made yet. */
  dropdownId: string | null;
  options: OptionOfDropdownInPane[];
  stretches: StretchOfADropdown[];
  indexOfOwnStretch: number | null;
  reach: DropdownReach;
  typed: TypedOptionInPane | null;
  cellsTyped?: string;
  cellsRefused?: DropdownCellsRefused;
  /** Set when the options are not those of a ready-made set, even where they match one. */
  isCustom?: boolean;
  /** The options as they were when their colors were last set all at once. */
  lastInColor?: OptionOfDropdownInPane[];
}
/** How the conditional formats are drawn: in the side pane, on a card by the cells, or in the menu. */
export type RulesDrawnAs = ConditionalFormatsDrawnAs;
/** The conditional formats open in the side pane, on a card or in the menu. */
export type RulesInPane = RulesPaneOpen;
/** A version of the workbook, as the store lists it. */
export type VersionOfWorkbook = WorkbookVersion;
/** Why the store could not answer a read of the history. */
export type HistoryWhy = 'storeDoesNotKnowHow' | 'recordDoesNotMatch' | 'tookTooLong' | 'busy' | 'noAnswer' | 'refused';
/** The versions asked of the store and not yet read: the newest ones, or older ones than those listed. */
export interface VersionsAwaited {
  askId: number;
  of: 'newest' | 'older';
  atChangeCount: number | null;
}
/** The version being looked at, and the one asked for to be looked at next. */
export interface LookAtVersion {
  shown: VersionOfWorkbook | null;
  awaited: { askId: number; version: VersionOfWorkbook } | null;
}
/** The version history open in the side pane. */
export interface VersionHistoryInPane {
  versions: VersionOfWorkbook[] | null;
  hasOlder: boolean;
  whyNotRead: HistoryWhy | null;
  awaited: VersionsAwaited | null;
  readAtChangeCount: number | null;
  authorsLookedUp: Set<string>;
  authorsAwaited: Set<string>;
  looksInVainInARow: number;
  look: LookAtVersion | null;
  /** The first revision of the version picked in the list. */
  picked: number | null;
  isCaretForCells: boolean;
  /** The version picked before the look at it ended, to put the caret back on. */
  pickedLast: number | null;
}
/** The sort open in the side pane. */
export type SortInPane = SortOfPane;
export interface DropdownPane {
  kind: 'dropdown';
  /** `null` from the moment the pane opens until the dropdown of the cell is read into it. */
  editor: DropdownEditor | null;
}
export interface ConditionalFormatsPane {
  kind: 'conditionalFormats';
  rules: RulesInPane;
}
export interface VersionHistoryPane {
  kind: 'versionHistory';
  history: VersionHistoryInPane;
}
export interface SortPane {
  kind: 'sort';
  sort: SortInPane;
}
export interface PivotTableSidePane {
  kind: 'pivotTable';
  pivotTable: PivotTableOfPane;
}
export type SidePane = DropdownPane | ConditionalFormatsPane | VersionHistoryPane | SortPane | PivotTableSidePane;
export type SidePaneKind = SidePane['kind'];
/** Whose history is shown: the whole row of the cell, or the cell alone. */
export type CellHistoryScope = 'row' | 'cell';
/** The cell history's read of the store: still to be asked for, asked for under this id, or none. */
export type CellHistoryAwaited = number | 'toBePut' | null;
export interface CellHistory {
  cell: CellId;
  scope: CellHistoryScope;
  /** The cell's address in A1 notation, as stored. */
  address: string;
  rowNumber: number;
  canRowBeRead: boolean;
  /** What the row or the cell holds now, to tell when it changes. */
  heldNow: string;
  heldAtChangeCount: number;
  awaited: CellHistoryAwaited;
  read: CellHistoryOutcome | null;
  hasChangedSinceAsked: boolean;
  looksInVainInARow: number;
  authorsLookedUp: Set<string>;
  authorsAwaited: Set<string>;
}
export type WhyAgentIsNotAskedWhichRows = 'notToBeHad' | 'rateLimited';
export interface TimeOfDay {
  hour: number;
  minute: number;
  second: number;
}
export interface TimeRow {
  time: TimeOfDay;
  shown: string | null;
}
export interface TimeList extends TimeListFocus {
  cellId: CellId;
  rows: TimeRow[];
  isChosen: boolean;
}
export interface CaretInText {
  text: string;
  start: number;
  end: number;
}
/** A headed column offered in the function list. */
export interface FunctionListColumn extends AutocompleteColumn {
  columnId: ColumnId;
}
/** Where a family of functions starts in the names of the list. */
export interface FunctionFamilyInList {
  family: FunctionFamily;
  from: number;
}
/** A row of the function list: a function's name, or a column. */
export type FunctionListRow = string | FunctionListColumn;
export interface FunctionList {
  typedFrom: number;
  typedTo: number;
  columns: FunctionListColumn[];
  names: string[];
  families: FunctionFamilyInList[];
  highlighted: FunctionListRow;
  isHighlightedByKey: boolean;
}
export type GuideSaid = 'never' | 'atOnce' | 'afterRest';
export interface FunctionGuide {
  argumentCount: number | null;
  said: GuideSaid;
}
export interface BracketPair {
  opensAt: number;
  closesAt: number;
}
export interface FormulaHelp {
  caret: CaretInText | null;
  caretAfterPick: CaretInText | null;
  /** The row picked from the function list last, to be read out whole. */
  writtenWhole: FunctionListRow | null;
  listShutAt: string | null;
  allAskedForAt: string | null;
  list: FunctionList | null;
  guide: FunctionGuideAtCall | null;
  brackets: BracketPair | null;
}
export type WhyFixCameToNothing = 'noFormula' | 'rateLimited' | 'callFailed' | 'other' | 'tooLarge';
export interface FixThatCameToNothing {
  cellId: CellId;
  atChangeCount: number;
  isNoticeUp: boolean;
  mayGoBetterAgain: boolean;
  why: WhyFixCameToNothing;
}
export type AgentOfFormulaFromWords = 'unchecked' | 'checking' | 'available' | 'unavailable' | 'notToBeHad';
/** A row of the formula offer: a formula read from the words, the other reading, asking the agent, or typing on. */
export type FormulaOfferRow = 'read' | 'readOtherwise' | 'write' | 'keepTyping';
/** A formula read from the words, still being worked out before it is offered. */
export interface FormulaToWorkOut {
  formula: string;
  leavesLitRow: boolean;
  isKeptOutOfRow: boolean;
  litIfItGoes: Exclude<FormulaOfferRow, 'read' | 'readOtherwise'>;
  other: string | null;
  mustOtherStandToo: boolean;
  isRowHeldForOther: boolean;
  isLitIfAlone: boolean;
  isOtherTheirs: boolean;
}
export interface FormulaOffered {
  kind: 'offered';
  highlighted: FormulaOfferRow;
  read: FormulaWithResult | null;
  readOtherwise?: FormulaWithResult;
  toWorkOut?: FormulaToWorkOut;
  formulaNotOffered?: string;
  otherNotOffered?: string;
  isAgentLeftOut?: true;
  isLightMovedByPerson?: true;
  hasRested?: true;
  hasCallFailed: boolean;
  isDrawn: boolean;
}
/** Why other fixes may fit too: a name the agent does not know, or cells that were deleted. */
export type OthersMayFitBecause = 'nameNotKnown' | 'cellsDeleted';
export interface FormulaAsked {
  kind: 'asked';
  askId: number;
  words: string;
  /** The sheet's runs of lines when asked, so an answer for a sheet changed since is not taken. */
  linesAsTold: LineRuns;
  isFix?: true;
  fewestCellsToRead?: number;
  formulaBeforeASortOrMove?: string;
  cameToBeforeASort?: ValueContents;
  callsForNoNewCell?: true;
  isLabelOrHeadingTold?: true;
  areOwnWords?: true;
  othersMayFit?: OthersMayFitBecause;
}
/** What a proposed formula comes to, as its cell would show it. */
export interface ProposedFormulaResult {
  shown: string;
  text: string | null;
  result?: ValueContents;
  isTrueOrFalse?: true;
  fillsOtherCells?: true;
  /** The last cell the formula's array fills. */
  fillsTo?: CellAt;
}
/** A formula the agent proposed, and what it comes to. */
export interface FormulaWithResult {
  formula: string;
  value: ProposedFormulaResult;
  /** The one function only this formula calls, when that is what sets it apart from the others. */
  setApartBy?: string;
}
export interface FormulaProposed extends FormulaWithResult {
  kind: 'proposed';
  words: string;
  isArriving: boolean;
  isDiscardHighlighted: boolean;
  /** For each area the formula reads that the person did not type, how far into the formula it is named (0 to 1). */
  lightsAtPart: Record<string, number>;
  /** The formulas to choose between, when the agent gave more than one. */
  fixes?: FormulaWithResult[];
  isFix?: true;
  areOwnWords?: true;
}
export interface FormulaCameToNothing {
  kind: 'cameToNothing';
  words: string;
  why: FormulaNotWrittenWhy;
}
export type FormulaFromWordsStage = FormulaOffered | FormulaAsked | FormulaProposed | FormulaCameToNothing;
export interface FormulaFromWords {
  agent: AgentOfFormulaFromWords;
  hasAgentBeenMissed: boolean;
  askCount: number;
  isWavedOff: boolean;
  actsHeld: number;
  stage: FormulaFromWordsStage | null;
  fixThatCameToNothing: FixThatCameToNothing | null;
  /** The formula that was not offered while the offer was shut. */
  notOfferedWhileShut: string | null;
  /** The person's own words for a formula, by cell key. */
  ownWords: Map<string, string>;
}
/** A fix to offer, at the cell whose error it fixes, with the copies of that cell's formula. */
/** An error to offer a fix for, with the copies of its formula that the fix goes to as well. */
export interface FixToOffer extends FixableError {
  copies: CellId[];
}
/** The fixes to offer: none, those found, or not yet known while errors are worked out. */
export type FixesToOffer = FixToOffer[] | 'yetToBeKnown' | null;
/** A copy of a broken formula, to be fixed the way its first is. */
export interface FixOfCopyAwaited {
  cellId: CellId;
  broken: string;
  fewestCellsToRead: number;
  formulaBeforeASortOrMove: string | null;
  cameToBeforeASort: ValueContents | null;
  callsForNoNewCell: boolean;
  isLabelOrHeadingTold: boolean;
}
/** A fix the agent is asked for and has not answered yet. */
export interface FixAwaited extends FixOfCopyAwaited {
  linesAsTold: LineRuns;
  copies: FixOfCopyAwaited[];
  movesWithItsRow: boolean;
}
/** A fix the agent answered, for a cell. */
export interface FixFound {
  cellId: CellId;
  formula: string;
  shown: string;
  askId: number;
  isKept?: true;
}
/** The fixes being asked of the agent and shown. */
export interface FixesBeingMade {
  sheetId: SheetId;
  /** The cells whose formulas the agent is asked to fix. */
  asked: CellId[];
  atChangeCount: number;
  /** A table being declared over the cells, while it is. */
  tableBeingDeclared: CellTable | null;
  /** The fixes still awaited, by ask id. */
  awaited: Map<number, FixAwaited>;
  fixes: FixFound[];
  whyACallFailed: Extract<WhyFixCameToNothing, 'rateLimited' | 'callFailed'> | null;
  isOfSelection: boolean;
  isKept: boolean;
  pointedAt: CellId | null;
  hasPersonLeft: boolean;
  /** The cell the selection stood at when the fixes were asked for, until it moves. */
  stoodAt: CellId | null;
  hold: AnswerHold;
}
export interface FixesOnCells {
  toOffer: FixesToOffer;
  toOfferInSelection: FixesToOffer;
  stage: FixesBeingMade | null;
  cameToNothingAt: number | null;
  askCount: number;
  isEndToldDuringAct: boolean;
  offerDueBackOn: SheetId[];
}
/** A formula an act broke, as it was before the act. */
export interface LostFormula {
  text: string;
  input: CellContents['input'];
  /** The cell's address before the act, in A1 notation. */
  cell: string;
  cameTo: ValueContents | null;
}
/** The kind of act that lost formulas, in a word. */
export type ActThatLosesFormulas = 'delete' | 'move' | 'sort';
export interface FormulasLostToLastAct {
  act: ActThatLosesFormulas;
  cells: string | null;
  areColumnsDeleted?: true;
  /** By cell key. */
  byCell: Map<string, LostFormula>;
  atChangeCount: number;
}
export interface MoveOfColumnsUnanswered {
  moved: Omit<ColumnsOfTableMoving, 'landsAt' | 'count' | 'isToMove'>;
  before: WorkbookReads;
}
export interface ErrorsAtOpening {
  count: number;
  first: CellId;
  last: CellId;
}
export interface ErrorsFound {
  sheetId: SheetId;
  count: number;
}
export type ErrorsFoundAtOpening = 'toBeRead' | ErrorsFound | null;
/** A selection heard from another viewer, and when it last moved. */
export interface SelectionOfOther extends HeardSelection {
  movedAtMs: number;
}
export interface SelectionForAgent {
  sheetNumber: number;
  range: string;
  activeCell: string;
  revision: number;
}
export interface SelectedToldToAgent {
  byAddress: SelectionForAgent | null;
  chartId: string | null;
  ownSort: OwnSortToldToAgent | null;
}
/** The person's own sort of the sheet in view, as the agent is told it: the sheet's number and its sort keys. */
export interface OwnSortToldToAgent {
  sheetNumber: number;
  by: string;
}
/** The tables read of a sheet, and whether they are of the sheet as it stands. */
export interface TableRead {
  tables: TableOfASheet[];
  isLatest: boolean;
}
export type TableNotFormatted = CellId;
export interface CopiedCells extends CellSelection {
  cutToken: string | null;
}
/** The notice that an edit was refused, as every act that refuses one tells it: edit-answers' notice, with the reasons the other acts give. */
export interface EditRefusedOnPage {
  kind: 'editRefused';
  why:
    | RefusalMessageKey
    | EditRefusedNotice['why']
    | PasteRefusedNotice['why']
    | DuplicateRefusedNotice['why']
    | 'nothingLeftInSight'
    | 'noTableForPivotTable';
  asked: AskedKindOfEdit;
  mergedCells?: EditAnswerRefusedNotice['mergedCells'];
  isTypingLost?: boolean;
}
/** The sort asked for left the rows as they were; the column is its letters. */
export interface AlreadySortedNotice {
  kind: 'alreadySorted';
  column: string;
}
/** Calls to the agent for fixes failed. */
export interface CallsForFixesFailedNotice {
  kind: 'callsForFixesFailed';
  why: WhyFixCameToNothing;
}
/** The copy asked for was refused, as the event told it. */
export interface CellsNotCopiedNotice extends Omit<CopyRefused, 'kind'> {
  kind: 'cellsNotCopied';
}
/** Charts are still being copied, for a paste or a sheet's duplicate. */
export interface ChartsBeingCopiedNotice {
  kind: 'chartsBeingCopied';
  copiedFor: ChartNodesCopiedFor['kind'];
}
/** The cells typed for a dropdown were refused once the entry left them. */
export interface DropdownCellsRefusedNotice {
  kind: 'dropdownCellsRefused';
  refused: DropdownCellsRefused;
}
/** Entries answered late were not kept, at these cells. */
export interface EntriesNotKeptNotice {
  kind: 'entriesNotKept';
  cells: string[];
}
/** A file was not imported, and why. */
export interface FileNotImportedNotice {
  kind: 'fileNotImported';
  why: FileToImportNotRead['why'] | 'empty';
}
/** A link to the sheet was not copied, and why. */
export interface LinkNotCopiedNotice {
  kind: 'linkNotCopied';
  why: NonNullable<CopyLinkOutcome>;
}
/** Matches that were not replaced, and how many. */
export interface MatchesNotReplacedNotice {
  kind: 'matchesNotReplaced';
  count: number;
}
/** An act that takes one range of cells. */
export type OneRangeAct =
  | 'cut'
  | 'fill'
  | 'mergeCells'
  | 'unmergeCells'
  | 'insertRows'
  | 'insertColumns'
  | 'moveRows'
  | 'moveColumns'
  | 'deleteRows'
  | 'deleteColumns'
  | 'sortCells'
  | 'dropdown'
  | 'askAgent';
/** An act takes one range, and several are selected. */
export interface OneRangeNeededNotice {
  kind: 'oneRangeNeeded';
  act: OneRangeAct;
}
/** The page's own filter could not be worked out, and why. */
export interface OwnFilterNotWorkedOutNotice {
  kind: 'ownFilterNotWorkedOut';
  why: WhyRowsNotNow;
}
/** The page's own sort is over, and why. */
export interface OwnSortIsOverNotice {
  kind: 'ownSortIsOver';
  why: 'tableIsGone' | 'tableChanged' | 'columnIsGone' | 'leftOutOfNamedView' | 'leftOutOfNamedViewWithFilter';
}
/** Texts pasted were not converted to numbers, and how many. */
export interface TextsNotConvertedNotice {
  kind: 'textsNotConverted';
  count: number;
}
/** An earlier version was not put back, or the agent's turn not undone, and why. */
export interface EditsNotTakenBackNotice {
  kind: 'versionNotTakenBack' | 'turnOfAgentNotUndone';
  why: AgentUndoRefusalWhy;
}
/** An earlier version was not shown, and why. */
export interface VersionNotShownNotice {
  kind: 'versionNotShown';
  why: Exclude<WhyVersionNotShown, 'calledOff'>;
}
/** An earlier version was not put back or shown, or the agent's turn not undone, and why. */
export type VersionNotTakenNotice = EditsNotTakenBackNotice | VersionNotShownNotice;
/** Notices that tell nothing more than their kind. */
export interface NoticeWithoutDetail {
  kind:
    | 'chartNotCut'
    | 'chartsLeftBehindByDuplicate'
    | 'entryDroppedByRemoval'
    | 'entryNotForCheckbox'
    | 'filteredTableIsGone'
    | 'fixesCameToNothing'
    | 'fixesGoneWithChange'
    | 'linkHeldByCommentMode'
    | 'mergeWouldClearCells'
    | 'noTableToFilter'
    | 'undoStepsLeftInEarlierPage';
}
/** A notice the page tells at the foot of the grid. */
export type Notice =
  | EditRefusedOnPage
  | CellHoldsNoMorePeopleNotice
  | GroupsTooDeepNotice
  | TooManyNamedViewsNotice
  | LinesInTheWayNotice
  | SheetNameRefusedNotice
  | StepNotTakenNotice
  | AlreadySortedNotice
  | CallsForFixesFailedNotice
  | CellsNotCopiedNotice
  | ChartsBeingCopiedNotice
  | DropdownCellsRefusedNotice
  | EntriesNotKeptNotice
  | FileNotImportedNotice
  | LinkNotCopiedNotice
  | MatchesNotReplacedNotice
  | OneRangeNeededNotice
  | OwnFilterNotWorkedOutNotice
  | OwnSortIsOverNotice
  | TextsNotConvertedNotice
  | VersionNotTakenNotice
  | NoticeWithoutDetail;
/** The news that an entry being typed was dropped, by a merge or by the removal of its cell. */
export interface EntryDropped {
  kind: 'entryDroppedByMerge' | 'entryDroppedByRemoval';
}
/** News that something typed or edited was lost. */
export type NewsOfLoss = EditsDropped | EntryDropped;
/** The results that changed under a sort or a move of columns. */
export interface ResultsChanged {
  firstCell: string;
  count: number;
  errorCount: number;
}
/** The offer to undo a sort made with no keyboard. */
export interface SortedWithNoKeyboardOffer {
  kind: 'sortedWithNoKeyboard';
  column: string;
  direction: SortDirection;
  isSaved: boolean;
}
/** The offer to undo a sort that changed results. */
export interface SortChangedResultsOffer {
  kind: 'sortChangedResults';
  column: string;
  direction: SortDirection;
  results: ResultsChanged;
  isSaved: boolean;
}
/** The offer to undo a move of columns that changed results. */
export interface MoveOfColumnsChangedResultsOffer {
  kind: 'moveOfColumnsChangedResults';
  count: number;
  results: ResultsChanged;
  isSaved: boolean;
}
/** The offer to undo a deletion of rows or columns, between their labels. */
export interface LinesDeletedOffer extends LabelEnds {
  kind: 'rowsDeleted' | 'columnsDeleted';
  /** How many of the deleted rows were in view, when the labels cannot say it. */
  countInView?: number;
  isSaved: boolean;
}
/** The offer to undo a move that replaced cells (selection/move-cells.ts). */
export interface MoveReplacedCellsOffer extends CellsReplaced {
  kind: 'moveReplacedCells';
}
/** The offer to undo a fill made by finger, at the cells filled. */
export interface FilledByFingerOffer {
  kind: 'filledByFinger';
  cells: string;
}
/** The offer to undo cells cleared with no keyboard. */
export interface ClearedWithNoKeyboardOffer {
  kind: 'clearedWithNoKeyboard';
  cells: string;
  isSaved: boolean;
}
/** The offer to undo a merge that cleared cells, and the cell it kept. */
export interface MergeClearedCellsOffer {
  kind: 'mergeClearedCells';
  cells: string;
  keptCell: string;
}
/** The offer to undo a dropdown that cleared cells. */
export interface DropdownClearedCellsOffer {
  kind: 'dropdownClearedCells';
  cells: string;
  isOneCell: boolean;
  formulaCount: number;
  otherCount: number;
  isSaved: boolean;
}
/** The offer to undo options gone, which cleared cells. */
export interface OptionsGoneClearedCellsOffer {
  kind: 'optionsGoneClearedCells';
  count: number;
  isSaved: boolean;
}
/** The offer to undo the deletion of an option. */
export interface DropdownOptionDeletedOffer {
  kind: 'dropdownOptionDeleted';
  label: string;
  cellCount: number;
  onlyIn: string | null;
  isSaved: boolean;
}
/** The offer to undo the deletion of a placed view. */
export interface PlacedViewDeletedOffer {
  kind: 'placedViewDeleted';
  name: string;
  isSaved: boolean;
}
/** The offer to undo a replace or a conversion, and the cells left out. */
export interface CellsCountedOffer {
  kind: 'replacedInCells' | 'textsConverted';
  count: number;
  leftCount: number;
}
/** The offer to undo an import as a new sheet. */
export interface TableImportedAsNewSheetOffer {
  kind: 'tableImportedAsNewSheet';
  sheetName: string;
  rowCount: number;
  isSaved: boolean;
}
/** The offer to undo an import into a sheet. */
export interface TableImportedIntoSheetOffer {
  kind: 'tableImportedIntoSheet';
  sheetName: string;
  isReplaced: boolean;
  addedCount: number;
  changedCount: number;
  isSaved: boolean;
}
/** The offer to undo the restore of a version. */
export interface VersionRestoredOffer {
  kind: 'versionRestored';
  atMs: number;
  isSaved: boolean;
}
/** An offer to undo what was just done. */
export type UndoOffer =
  | SheetDeletedUndoOffer
  | SortedWithNoKeyboardOffer
  | SortChangedResultsOffer
  | MoveOfColumnsChangedResultsOffer
  | LinesDeletedOffer
  | MoveReplacedCellsOffer
  | FilledByFingerOffer
  | ClearedWithNoKeyboardOffer
  | MergeClearedCellsOffer
  | DropdownClearedCellsOffer
  | OptionsGoneClearedCellsOffer
  | DropdownOptionDeletedOffer
  | PlacedViewDeletedOffer
  | CellsCountedOffer
  | TableImportedAsNewSheetOffer
  | TableImportedIntoSheetOffer
  | VersionRestoredOffer
  | NamedViewDeletedOffer;
/** What the page stood at when the marks of an import were set. */
export type StateWhenImportMarked = Pick<
  PageState,
  'changesAskedFor' | 'sheetId' | 'scrollTop' | 'scrollLeft' | 'gridWidth' | 'gridHeight' | 'zoom'
>;
export interface MarksOfImport {
  sheetId: SheetId;
  /** `${RowId} ${ColumnId}` for each cell the import changed. */
  updated: Set<string>;
  columns: Set<ColumnId>;
  addedRows: Set<RowId>;
  rowNumbersWritten: { first: number; last: number };
  stateWhenSet: StateWhenImportMarked;
}
export interface FormatAsTableChosenLast {
  isOn: boolean;
  before: TableNotFormatted[];
}
export interface ChartBeingMade {
  nth: number;
  topLeft: CellId;
  kind: StockKind | 'any';
  nodeSent: string | null;
  nodeAdded: string | null;
}
export type SavingState = 'allSaved' | 'saving' | 'retrying' | 'stopped' | 'stoppedOutOfDate' | 'stoppedOutOfDateWithUnsavedEdits';
export interface SavingProgress {
  unsavedEditCount: number;
  mostUnsavedEditCount: number;
  wait: Wait | null;
  isBarUp: boolean;
}
export type CaretAtEnd = 'rows' | 'columns';
export interface CommentsWithAgent {
  handles: string[];
  wait: Wait;
}
export type CellsOfComment = Pick<CellSelection, 'activeCell' | 'selectionCorner'>;
export interface GoneTo {
  cells: CellsChanged;
  chart: string | null;
}
export type FollowsOnOneSheet = 'no' | 'yetToMove' | 'hasMoved';
export type TurnOfAgent = 'nothingSaid' | 'saidToBeWorking' | 'saidAndHasEdited';
/** What the page says of the agent: that it is working, or that it made changes (with what it did, once a turn ends). */
export type SaidOfAgent =
  | { what: 'isWorking'; staysWhileCursorShows: boolean }
  | { what: 'madeChanges'; done?: DoneByAgent; written?: WrittenOfTurn; isUndoOffered?: true };
/** The part of a sheet a find looks in: its rows and columns, and the area they came from (ui/find.ts). */
export interface FindWithin {
  rows: IdRun[];
  columns: IdRun[];
  at: CellArea;
}
export interface FindOptions {
  matchesCase: boolean;
  isWholeCell: boolean;
  isInFormulas: boolean;
  within: FindWithin | 'allSheets' | null;
}
/** A cell a find matched, and where it is (ui/find.ts). */
export interface FindHit {
  cellId: CellId;
  sheetIndex: number;
  rowIndex: number;
  columnIndex: number;
}
/** The first and last cells a capped find matched. */
export interface EndsOfFindHits {
  first: FindHit;
  last: FindHit;
}
export interface Find {
  text: string;
  options: FindOptions;
  selectedAtFirst: FindWithin | null;
  hits: FindHit[];
  ends: EndsOfFindHits | null;
  roomAboveGrid: number;
  isReplaceShown: boolean;
  isCapped: boolean;
  editsSinceLooked: number;
}
export type FontMark = 'bold' | 'italic' | 'underline' | 'strikethrough';
export interface StretchOfLooks {
  length: number;
  marks: FontMark[];
  link: string | null;
}
export interface EntryLooks {
  stretches: StretchOfLooks[];
  lists: ListLine[];
}
export interface EntryLooksKept {
  text: string;
  looks: EntryLooks;
}
export interface EntryLooksInHistory {
  toUndo: EntryLooksKept[];
  toRedo: EntryLooksKept[];
}
/** An own filter being tried out, the filter held before the try, and where the selection stood. */
export interface OwnFilterTried {
  before: HeldOwnFilterSnapshot;
  placeBefore: SelectionPlace;
  placeAfterTry: SelectionPlace | null;
}
export interface XlsxFileSaved {
  /** Downloaded, or sent on to be opened in another program. */
  went: 'downloaded' | 'sentToGoogleSheets';
  filename: string;
  url: string | null;
  notCarriedOver: NotCarriedOver[];
}
/** A kind of chart the page offers for the selected cells: one of the stock charts. */
export type ChartKindOffered = StockKind;
export interface ChartOnOffer {
  kind: ChartKindOffered;
  isForPage: boolean;
  isBestLeftToAgent: boolean;
}
export interface ErrorsOffer {
  first: CellId;
  last: CellId;
  firstWithAnError: CellId;
  endOfTable: CellId | null;
}
export interface ErrorsOffered {
  sheetId: SheetId;
  count: number;
  /** The count of errors when values were last worked out in time: kept while a calculation takes too long. */
  countWithValues: number;
  baseline: number;
  /** The sheets the offer was put away on. */
  sentAwayOn: SheetId[];
  offer: ErrorsOffer | null;
  /** Whether the offer waits for rows to be inserted. */
  isInsertOfRowsAwaited: boolean;
}
export type CueForCards = 'toCome' | 'given' | 'now';
/** The card open on a row of a list: the row it is of, the row of the card gone to, and whether it is still as opened. */
export interface CardOfList {
  ofRow: string;
  wentTo: string | null;
  isAsOpened?: true;
}
export interface DropdownOpen {
  /** The key of the row highlighted in the list (chips/dropdown-options.ts). */
  highlighted: string | null;
  card: CardOfList | null;
  scrollAsItOpened: GridScroll;
  isCardOfPointerAlone: boolean;
  isWalkedByKeys: boolean;
  cueForCards: CueForCards;
  isNewOptionBeingNamed: boolean;
  timesNewOptionAsked: number;
}
/** Every edit since a version, taken back to restore that version. */
export interface TakingBackAllSinceVersion {
  kind: 'allSinceVersion';
  version: VersionOfWorkbook;
}
/** The edits of the agent's last turn, taken back. */
export interface TakingBackTurnOfAgent {
  kind: 'turnOfAgent';
  edits: UndoOfTurnOffered['edits'];
}
/** What is being taken back. */
export type WhatIsTakenBack = TakingBackAllSinceVersion | TakingBackTurnOfAgent;
/** Edits being taken back, under the ask that reads the edits that take them back. */
export interface TakingBack extends TakingBackAsked {
  askId: number;
}
export type AnswerHoldStands = 'awaited' | 'landed' | 'seen';
export interface AnswerHold {
  answerId: number;
  stands: AnswerHoldStands;
  actsHeld: number;
  seenSinceMs: number | null;
}
export type RulesOfAgentKept = KeptRulesOfAgent;
/** A ready-made set of dropdown options. */
export type ReadySet = NamedDropdownPreset;
export interface RowAddedAfterEntries {
  sheetId: SheetId;
  rowId: RowId;
}
/** The list of people open under a cell. */
export type PeopleList = PeopleListOpen;
/** A sort or a move of columns whose changed results are still to be looked at. */
export type SortToLookBackOn = SortOrMoveToLookBackOn;
export interface EntryUnanswered {
  cellId: CellId;
  text: string;
  formatsToCome?: FormatToCome[];
}
/** What was done last, when it was stepping out of the cells. */
export interface SteppedOutOfCells {
  what: 'steppedOutOfCells';
}
/** What was done last, told by its name alone. */
export interface DoneWithoutDetail {
  what:
    | 'agentStopped'
    | 'chartCopied'
    | 'entryCollapsed'
    | 'entryExpanded'
    | 'fixDiscarded'
    | 'formattedAsTable'
    | 'notFormattedAsTable'
    | 'formulaOfAgentDiscarded'
    | 'formulasShown'
    | 'resultsShown'
    | 'gridlinesHidden'
    | 'gridlinesShown'
    | 'importDiscarded'
    | 'linkCopied'
    | 'nothingToFill'
    | 'offerDiscarded'
    | 'ruleChanged'
    | 'scaleColorsNothing'
    | 'nothingToUndo'
    | 'nothingToRedo';
}
/** What was done last when an undo or a redo changed a place: its cells, the sheet shown, and how many ranges (state/edit-answers.ts). */
export interface StepShownDone {
  what: StepShown;
  cells: string | null;
  sheetShown?: string;
  rangeCount?: number;
}
/** What was done last to cells, at their address as stored; how many ranges when it was done to several. */
export interface DoneToCells {
  what:
    | 'pasted'
    | 'filled'
    | 'cleared'
    | 'moved'
    | 'merged'
    | 'unmerged'
    | 'replaced'
    | 'bordersCleared'
    | 'dropdownRemoved'
    | 'formattingCleared'
    | 'formulaAdded'
    | 'todayEntered'
    | 'dropdownSet'
    | 'checked'
    | 'unchecked'
    | 'checkboxesMade'
    | 'typedTextEntered'
    | 'typedTextChangedNothing'
    | 'formulaOfAgentEntered'
    | 'fixKept'
    | 'dropdownCellsSet'
    | 'dropdownOptionsSet'
    | 'takenOutOfSelection';
  cells: string;
  rangeCount?: number;
}
/** An entry emptied its cell. */
export interface EntryEmptiedCell {
  what: 'entryEmptiedCell';
  cells: string;
  isSaved: boolean;
}
/** Cells were formatted; the cell entered in, when it was an entry. */
export interface FormattedDone {
  what: 'formatted';
  format: CellFormatChoice;
  cellEnteredIn?: string;
  cells: string;
  rangeCount?: number;
}
/** Borders were drawn on cells. */
export interface BordersDrawnDone {
  what: 'bordersDrawn';
  edges: string;
  cells: string;
  rangeCount?: number;
}
/** Lines inserted or sized, between their labels; how many when several ranges hold them. */
export interface LinesDone extends LabelEnds {
  what: 'rowsInserted' | 'columnsInserted' | 'rowsSized' | 'columnsSized';
  /** The size set, or null when the lines went back to fitting their text. */
  heightInPixels?: number | null;
  widthInPixels?: number | null;
  lineCount?: number;
}
/** Lines frozen, and how many. */
export interface LinesFrozenDone {
  what: 'rowsFrozen' | 'columnsFrozen';
  count: number;
}
/** Lines grouped, ungrouped, collapsed or expanded, between their labels. */
export interface GroupDone extends LabelEnds {
  what: 'grouped' | 'ungrouped' | 'collapsed' | 'expanded';
  of: 'rows' | 'columns';
}
/** Several groups collapsed or expanded. */
export interface GroupsDone {
  what: 'groupsCollapsed' | 'groupsExpanded';
  of: 'rows' | 'columns';
  groupCount: number;
}
/** Groups shown to a level. */
export interface ShownToLevelDone {
  what: 'shownToLevel';
  of: 'rows' | 'columns';
  level: number;
}
/** A placed view moved, sized, or its change undone or redone. */
export interface PlacedViewDone {
  what: 'placedViewMoved' | 'placedViewSized' | 'placedViewChangeUndone' | 'placedViewChangeRedone';
  name: string;
  cell?: string;
  widthInPixels?: number;
  heightInPixels?: number;
}
/** A mark set in an entry, or to type in. */
export interface MarkSetDone {
  what: 'markSetInEntry' | 'markSetToTypeIn';
  mark: FontMark;
  isOn: boolean;
}
/** A list set in an entry. */
export interface ListSetDone {
  what: 'listSetInEntry';
  list: ParagraphListKind;
  isOn: boolean;
}
/** The box of a line of a checklist set. */
export interface BoxOfLineSetDone {
  what: 'boxOfLineSet';
  isChecked: boolean;
}
/** A link set in an entry. */
export interface LinkSetDone {
  what: 'linkSetInEntry';
  link: 'removed' | 'changed' | 'added';
}
/** What the arrow keys were given to. */
export interface ArrowsGivenToDone {
  what: 'arrowsGivenTo';
  to: 'text' | 'cells' | 'cellsElsewhere';
}
/** No date entered, for the cell holds a control. */
export interface NoDateEnteredDone {
  what: 'noDateEntered';
  cellHas: 'checkbox' | 'dropdown';
  cell: string;
}
/** A fix offered. */
export interface FixOfferedDone {
  what: 'fixOffered';
  formula: string;
  shown: string;
}
/** Fixes kept or discarded, and how many. */
export interface FixesCountedDone {
  what: 'fixesKept' | 'fixesDiscarded';
  count: number;
}
/** A dropdown started from a set of options. */
export interface DropdownStartedFromDone {
  what: 'dropdownStartedFrom';
  /** The key of the preset set, or `'custom'` for options of one's own. */
  set: DropdownPresetKey | 'custom';
  optionCount: number;
}
/** The header row of a dropdown set. */
export interface HeaderRowSetDone {
  what: 'headerRowSet';
  isOn: boolean;
  heading: string;
  cells: string;
}
/** An option of a dropdown moved. */
export interface DropdownOptionMovedDone {
  what: 'dropdownOptionMoved';
  label: string;
  place: number;
  optionCount: number;
  /** The cells, when not all of the dropdown's cells. */
  onlyIn: string | null;
}
/** An option of a dropdown removed. */
export interface DropdownOptionRemovedDone {
  what: 'dropdownOptionRemoved';
  label: string;
  isSaved: boolean;
  /** The cells, when not all of the dropdown's cells. */
  onlyIn: string | null;
}
/** Options added to a dropdown: how many, how many skipped, and whether the dropdown is now full. */
export interface DropdownOptionsAddedDone {
  what: 'dropdownOptionsAdded';
  count: number;
  skipped: number;
  isFull: boolean;
  /** The cells, when not all of the dropdown's cells. */
  onlyIn: string | null;
}
/** An offer to undo made, with the header row set by it. */
export interface UndoOfferMadeDone {
  what: 'undoOfferMade';
  offer: UndoOffer;
  headerRow?: HeaderRowSetDone;
}
/** A person added to a cell, removed, replaced, or the cell's contents replaced. */
export interface PeopleInCellDone {
  what: 'personAdded' | 'personRemoved' | 'peopleReplaced' | 'contentsReplaced';
  name: string;
  cell: string;
  heldNowCount?: number;
  replacedCount?: number;
  isSaved?: boolean;
}
/** Conditional formats added, moved, removed, or a column moved to numbers. */
export type RulesDone = Extract<ConditionalFormatDone, { what: 'rulesAdded' | 'ruleMoved' | 'ruleRemoved' | 'movedToNumbers' }>;
/** Rows sorted by a column. */
export interface RowsSortedDone {
  what: 'rowsSorted';
  column: string;
  direction: SortDirection;
}
/** Cells sorted by a column. */
export interface CellsSortedDone {
  what: 'cellsSorted';
  column: string;
  direction: SortDirection;
  cells: string;
  rangeCount?: number;
}
/** Columns of a table moved, between their letters. */
export interface ColumnsOfTableMovedDone {
  what: 'columnsOfTableMoved';
  heading: string | null;
  count: number;
  first: string;
  last: string;
}
/** A move over cells that replaced them. */
export interface MovedOverCellsDone extends CellsReplaced {
  what: 'movedOverCells';
}
/** A sheet renamed, to its new name. */
export interface SheetRenamedDone {
  what: 'sheetRenamed';
  name: string;
}
/** A sheet shown to follow the agent, or for a formula's reference. */
export interface SheetShownForDone {
  what: 'sheetShownToFollow' | 'sheetShownForFormula';
  name: string;
  entryCell?: string;
  entrySheet?: string;
}
/** The time zone set. */
export interface TimeZoneSetDone {
  what: 'timeZoneSet';
  timeZone: string;
}
/** The locale set. */
export interface LocaleSetDone {
  what: 'localeSet';
  locale: string;
}
/** More of a tall cell shown. */
export interface MoreOfCellShownDone {
  what: 'moreOfCellShown';
  cell: string;
}
/** Words offered entered. */
export interface OfferedWordsEnteredDone {
  what: 'offeredWordsEntered';
  words: string;
}
/** What the page did last, told to screen readers. */
export type LastDone =
  | SheetMoved
  | OwnCellLost
  | EntryCameToError
  | CopiedCellsLetGo
  | CopiedOrCutDone
  | ChartPastedDone
  | (SheetShownDone & { isFormulaOfAgentDiscarded?: true })
  | LinkAddressShown
  | SteppedOutOfCells
  | DoneWithoutDetail
  | StepShownDone
  | DoneToCells
  | EntryEmptiedCell
  | FormattedDone
  | BordersDrawnDone
  | LinesDone
  | LinesFrozenDone
  | GroupDone
  | GroupsDone
  | ShownToLevelDone
  | PlacedViewDone
  | MarkSetDone
  | ListSetDone
  | BoxOfLineSetDone
  | LinkSetDone
  | ArrowsGivenToDone
  | NoDateEnteredDone
  | FixOfferedDone
  | FixesCountedDone
  | DropdownStartedFromDone
  | HeaderRowSetDone
  | DropdownOptionMovedDone
  | DropdownOptionRemovedDone
  | DropdownOptionsAddedDone
  | UndoOfferMadeDone
  | PeopleInCellDone
  | RulesDone
  | RowsSortedDone
  | CellsSortedDone
  | ColumnsOfTableMovedDone
  | MovedOverCellsDone
  | SheetRenamedDone
  | SheetShownForDone
  | TimeZoneSetDone
  | LocaleSetDone
  | MoreOfCellShownDone
  | OfferedWordsEnteredDone
  | NamedViewDone
  | InteractiveDone
  | PivotTableDone;
/** The cells a link to the workbook points at: asked for until the grid can show them, then lit. */
export type CellsLinkedTo = { kind: 'asked'; place: PlaceOfLink } | { kind: 'lit'; place: PlaceOfLink; cells: CellsChanged[] };
export interface CutJustMoved {
  token: string;
  toTopLeft: CellId;
}
/** A reference in the entry written by pointing at cells: where it is in the text, and the cells it points at. */
export interface PointedReference extends CellsPointedAt {
  start: number;
  end: number;
  text: string;
}
/** A reference in the formula being entered, as it is marked on the grid. */
export interface ReferenceInEntry {
  sheetId: SheetId;
  /** The area the reference covers, or the smallest area covering its pieces. */
  area: CellArea;
  /** The areas of a reference made of more than one. */
  pieces?: CellArea[];
  hue: string;
  /** Where the reference is written in the entry; absent for one the agent named in words. */
  writtenAt?: CaretSpan;
  isNamedInWords?: true;
}
export interface MarksOfImportToCome {
  sheetId: SheetId;
  /** `${RowId} ${ColumnId}` for each cell the import changes; empty when it replaces the rows. */
  updated: Set<string>;
  columns: Set<ColumnId>;
  rowsBefore: Set<RowId>;
}
export interface CommentOnPage {
  handle: string;
  isResolved: boolean;
  isOpen: boolean;
  cells: CellsOfComment;
}
export type CellsChanged = Pick<CellSelection, 'activeCell' | 'selectionCorner'>;
/** Cells written while the agent works; a guess is a block near the agent's edits, not one it is known to have written. */
export interface CellsWrittenInTurn extends CellsChanged {
  isGuess?: true;
}
/** The cells a change touched in one sheet, and the groups that lie apart within them. */
export interface CellsChangedInSheet {
  cells: CellsChanged;
  groupsApart?: CellsChanged[];
}
/** An earlier change of the agent that a mark took in because it lay close by. */
export interface ChangeJoinedInMark {
  revision: number;
  cells: CellsChanged;
}
/** A mark on the cells the agent changed; nearby changes join into one mark. */
export interface ChangeByAgent {
  revision: number;
  cells: CellsChanged;
  /** Which of the change's groups of cells this mark stands for. */
  group: number;
  fadeBeginsAtMs: number | null;
  joinedWith: ChangeJoinedInMark[];
  /** Whether exactly one earlier mark was joined into this one. */
  stoodAsOneMark: boolean;
  isOfWholeLines: boolean;
  isOfViewer?: true;
  isOfLayoutAlone?: true;
}
/** The cells gone to over a run of the agent's changes, and the revision the run began at. */
export interface RunOfAgentGoneTo {
  since: number;
  cells: CellsChanged;
}
/** The viewer whose view this page follows, and the cells they have selected. */
export interface Followed {
  userId: string;
  tabKey: string;
  cells: SelectionCorners;
}
/** Where the agent shows the viewer: cells of a sheet, or a chart (agent/shown-by-agent.ts). */
export type PlaceShownByAgent =
  | { kind: 'cells'; sheetId: SheetId; cells: Pick<CellSelection, 'activeCell' | 'selectionCorner'> | null }
  | { kind: 'chart'; sheetId: SheetId; viewId: string };
/** What the agent shows the viewer. */
export type ShownByAgent = ViewShownByAgent;
/** The cells the agent changed in a turn, with the areas changed in each sheet. */
export interface CellsDoneByAgent extends CellsChangedByAgent {
  /** Filled only for a held revision of few enough cells. */
  placesBySheet: Map<SheetId, CellArea[]>;
}
export interface DoneByAgent extends ChangesByAgent {
  cells: CellsDoneByAgent | null;
  isCardUp: boolean;
  wait: Wait;
}
/** The offer to take back the agent's last turn. */
export type UndoOfTurnOffered = NonNullable<ReturnType<typeof undoOfTurnOf>>;
export interface PageState extends CellSelection {
  sheetId: SheetId;
  scrollLeft: number;
  scrollTop: number;
  otherRanges: CellSelection[];
  cameToMergedCellsAt: CellId | null;
  leftByKeyAt: GridScroll | null;
  lastPresses: [Press | null, Press | null];
  movedClearOfColumnsTo: CellId | null;
  tabRun: TabRun | null;
  pagesTurnedForReader: number;
  scrolledForEntry: ScrolledForEntry | null;
  scrolledForNewChart: ScrolledForNewChart | null;
  gridWidth: number;
  gridHeight: number;
  pageWidth: number;
  scrolledForLessRoom: ScrollsForLessRoom | null;
  heightUnderWhatFloats: number;
  heightUnderCardAtFoot: number;
  noticesAtFoot: NoticesAtFoot | null;
  zoom: number;
  isOnPhone: boolean;
  isNarrowByTouch: boolean;
  boxesAtFootByTouch: BoxAtFoot[];
  sheetPointedIn: SheetId | null;
  placesLeft: Place[];
  ownCollapsing: Map<string, boolean>;
  rowsOutOfViewByOwnFilters: Map<SheetId, Set<RowId>>;
  ownRowOrders: Map<SheetId, IdRun[]>;
  isOwnRowOrderAwaited: boolean;
  ownFilters: Map<SheetId, OwnFilter[]>;
  ownFilterList: OwnFilterList | null;
  ownFilterTried: OwnFilterTried | null;
  rowsAskedFor: RowsAskedFor | null;
  filterKeptOnForColumnsCard: string | null;
  viewerId: string | null;
  dragging: Dragging | null;
  placementSelected: string | null;
  heldUntilAnswered: HeldUntilAnswered | null;
  pressesOnFillHandle: number;
  menu: Menu | null;
  customNumberFormat: CustomNumberFormat | null;
  pasteThatWaits: PasteThatWaits | null;
  pickForWorkbook: PickForWorkbook | null;
  examplesOfNumberFormats: ExamplesOfNumberFormats;
  isListOfKeysOpen: boolean;
  importOfAFile: ImportOfAFile | null;
  fileAwaited: FileAwaited | null;
  xlsxFileReady: XlsxFileSaved | null;
  xlsxFileYetToBeToldOf: XlsxFileSaved | null;
  importAskCount: number;
  sheetBeingRenamed: SheetBeingRenamed | null;
  leftByCaret: WhatCaretLeft | null;
  figuresOfSelection: FiguresOfSelection;
  selectionSeen: SelectionSeen;
  selectionLeftByPerson: SelectionSeen;
  chartsOnOffer: ChartOfferOfCells[];
  formatOfSelection: FormatOfSelection;
  borderPen: BorderPen;
  wordsOffered: WordsOffered | null;
  calendar: CalendarOpen | null;
  linkForm: LinkForm | null;
  explainedUnderCell: ExplainedUnderCell;
  reasonsForErrors: ReasonsForErrors;
  errorsOffered: ErrorsOffered | null;
  errorsReadAsOf: ErrorsReadAsOf | null;
  dropdown: DropdownOpen | null;
  sidePane: SidePane | null;
  versionHistoryAskCount: number;
  takingBack: TakingBack | null;
  cellHistory: CellHistory | null;
  conditionalFormatsAskCount: number;
  rowsAskedForAskCount: number;
  holdOnRowsFilteredByAgent: AnswerHold | null;
  whyAgentIsAskedWhichRowsOnlyAtEnter: WhyAgentIsNotAskedWhichRows | null;
  rulesOfAgentKept: RulesOfAgentKept | null;
  isAgentForRulesNotToBeHad: boolean;
  hasViewNoAgentForRules: boolean;
  readySets: ReadySet[] | null;
  timesSidePaneAsked: number;
  /** The pivot tables of the sheet in view whose source changed since they were last worked out. */
  pivotTablesOutOfDateAt: CellId[];
  timesCalendarAsked: number;
  waysIn: WaysIn;
  areWaysInOutOfSight: boolean;
  isWindowLeft: boolean;
  notesOfSteps: NotesOfSteps;
  answerAwaited: AnswerAwaited;
  rowsAddedAfterEntries: RowAddedAfterEntries[];
  peopleList: PeopleList | null;
  timeList: TimeList | null;
  formulaHelp: FormulaHelp;
  formulaFromWords: FormulaFromWords;
  fixesOnCells: FixesOnCells;
  formulasLostToLastAct: FormulasLostToLastAct | null;
  sortToLookBackOn: SortToLookBackOn | null;
  moveOfColumnsUnanswered: MoveOfColumnsUnanswered | null;
  errorsAtOpening: ErrorsAtOpening | null;
  errorsFoundAtOpening: ErrorsFoundAtOpening;
  sheetsWhoseToastIsSpent: SheetId[];
  profilesById: Map<string, ProfileOfPerson>;
  peopleLookedUpAtChangeCount: number | null;
  selectionsOfOthers: SelectionOfOther[];
  selectionToldToOthers: SelectionCorners | null;
  selectedToldToAgent: SelectedToldToAgent | null;
  askOwedToAgent: CellSelection | null;
  textToEditOfEntryCell: string;
  entriesUnanswered: EntryUnansweredWithList[];
  areFormulasShown: boolean;
  tablesRead: Map<SheetId, TableRead>;
  tablesNotFormatted: TableNotFormatted[];
  density: CellDensity;
  lastDone: LastDone | null;
  hasLastHeldEdgeMoved: boolean;
  copiedCells: CopiedCells | null;
  cutJustMoved: CutJustMoved | null;
  mode: PageMode;
  pointedReference: PointedReferenceWritten | null;
  referencesInEntry: ReferenceInEntry[];
  notice: Notice | null;
  newsOfLoss: NewsOfLoss | null;
  isEntryEndedUnasked: boolean;
  undoOffer: UndoOffer | null;
  isSelectionJustImported: boolean;
  marksOfImport: MarksOfImport | null;
  marksOfImportToCome: MarksOfImportToCome | null;
  stepsToUndo: number;
  stepsToRedo: number;
  formatAsTableChosenLast: FormatAsTableChosenLast | null;
  /** The own sort of a table chosen last, to undo it while the sheet stays in view. */
  ownSortChosenLast: OwnSortChoice | null;
  chartBeingMade: ChartBeingMade | null;
  areStepsToUndoLost: boolean;
  saving: SavingState;
  hasUnsavedEdits: boolean;
  isLargeEditUnsaved: boolean;
  savingProgress: SavingProgress | null;
  calculatingShown: CalculatingShown;
  longCalculationTold: LongCalculationTold;
  isActShownAsCalculated: boolean;
  /** The page's own view of a table being applied while the calculation is shown. */
  ownViewShownAsApplied: OwnViewShownAsApplied | null;
  areFormulasShownAsLeft: boolean;
  isAgentWorking: boolean;
  isSteppedOutOfCells: boolean;
  caretAtEnd: CaretAtEnd | null;
  isCommentModeOn: boolean;
  isCommentModeForACard: boolean | null;
  isCommentModeLeftByPress: boolean;
  hasCommentModeRefused: boolean;
  doesCommentModePickCells: boolean;
  isPressToComment: boolean;
  comments: CommentOnPage[] | null;
  commentsPointedAt: string[];
  commentsWithAgent: CommentsWithAgent | null;
  newCommentOn: CellsOfComment | null;
  isChatBehindButton: boolean;
  isChatBeside: boolean | null;
  isComposerOpen: boolean;
  changesByAgent: ChangeByAgent[];
  isFollowingAgent: boolean;
  followsOnOneSheet: FollowsOnOneSheet;
  movesOfViewByItself: number;
  hasPersonTakenViewBack: boolean;
  writtenInTurnOfAgent: CellsWrittenInTurn[];
  waitForNextEditOfAgent: Wait | null;
  changedSinceRest: CellsChanged[];
  heldAsSheetOpened: CellsChanged[];
  changedOffShowSinceRest: CellsChanged[] | null;
  chartGoneToSinceRest: string | null;
  runOfAgentGoneTo: RunOfAgentGoneTo | null;
  lastGoneTo: GoneTo | null;
  isFirstBuild: boolean;
  followed: Followed | null;
  shownByAgent: ShownByAgent | null;
  cellsLinkedTo: CellsLinkedTo | null;
  changesAskedFor: number;
  turnOfAgent: TurnOfAgent;
  doneByAgent: DoneByAgent | null;
  undoOfTurnOffered: UndoOfTurnOffered | null;
  isUndoOfTurnNotToBeHad: boolean;
  saidOfAgent: SaidOfAgent | null;
  find: Find | null;
  contextBarMenu: string | null;
  offersAtSelection: OffersAtSelection;
  workbookChangeCount: number;
  formulasWorkedOutCount: number;
}
export function createInitialPageState(
  reads: ReadsWithTextMeasurer,
  savedPlace: SavedPlace | null,
  areStepsToUndoLost: boolean = false,
  density: CellDensity = DEFAULT_CELL_DENSITY,
  tablesNotFormatted: TableNotFormatted[] = [],
  canImportFiles: boolean = true,
): PageState | null {
  let place = restoredPlace(reads, savedPlace);
  if (place === null) return null;
  let state: PageState = {
    ...place,
    otherRanges: [],
    cameToMergedCellsAt: null,
    leftByKeyAt: null,
    lastPresses: [null, null],
    movedClearOfColumnsTo: null,
    tabRun: null,
    rangeWalked: null,
    pagesTurnedForReader: 0,
    scrolledForEntry: null,
    scrolledForNewChart: null,
    gridWidth: 0,
    gridHeight: 0,
    pageWidth: 0,
    scrolledForLessRoom: savedPlace?.scrolledForLessRoom ?? null,
    heightUnderWhatFloats: 0,
    heightUnderCardAtFoot: 0,
    noticesAtFoot: null,
    zoom: 1,
    isOnPhone: false,
    isNarrowByTouch: false,
    boxesAtFootByTouch: NO_BOXES_AT_FOOT,
    sheetPointedIn: null,
    placesLeft: [],
    ownCollapsing: NO_OWN_COLLAPSING,
    rowsOutOfViewByOwnFilters: NO_ROWS_OUT_OF_VIEW_BY_FILTERS,
    ownRowOrders: NO_OWN_ROW_ORDERS,
    isOwnRowOrderAwaited: false,
    ownFilters: NO_OWN_FILTERS,
    ownFilterList: null,
    ownFilterTried: null,
    rowsAskedFor: null,
    filterKeptOnForColumnsCard: null,
    viewerId: null,
    dragging: null,
    placementSelected: null,
    heldUntilAnswered: null,
    pressesOnFillHandle: 0,
    menu: null,
    customNumberFormat: null,
    pasteThatWaits: null,
    pickForWorkbook: null,
    examplesOfNumberFormats: numberFormatExamples(reads),
    isListOfKeysOpen: false,
    importOfAFile: null,
    fileAwaited: null,
    xlsxFileReady: null,
    xlsxFileYetToBeToldOf: null,
    importAskCount: 0,
    sheetBeingRenamed: null,
    leftByCaret: null,
    figuresOfSelection: NO_FIGURES_OF_SELECTION,
    selectionSeen: {
      cellsAre: 'empty',
      isSoOfEveryCell: true,
      areAllRead: true,
      shape: 'cell',
    },
    selectionLeftByPerson: {
      cellsAre: 'empty',
      isSoOfEveryCell: true,
      areAllRead: true,
      shape: 'cell',
    },
    chartsOnOffer: [],
    formatOfSelection: makeFormatOfSelection(DEFAULT_CELL_FORMAT, reads, CELL_FORMAT_CHOICES, true, 'left', {
      lines: NO_AREA_BORDERS,
      isFromSample: false,
    }),
    borderPen: DEFAULT_BORDER_PEN,
    wordsOffered: null,
    calendar: null,
    linkForm: null,
    explainedUnderCell: NOTHING_EXPLAINED_UNDER_CELL,
    reasonsForErrors: {
      ofEntryCell: null,
      ofCellExplained: null,
      cellToFixInPlace: null,
      isFixInPlaceYetToBeKnown: false,
      isEntryCellToFixInPlace: false,
      isFixAtEntryCellYetToBeKnown: false,
      doCausesWaitForCalculation: false,
    },
    errorsOffered: null,
    errorsReadAsOf: null,
    dropdown: null,
    sidePane: null,
    versionHistoryAskCount: 0,
    takingBack: null,
    cellHistory: null,
    conditionalFormatsAskCount: 0,
    rowsAskedForAskCount: 0,
    holdOnRowsFilteredByAgent: null,
    whyAgentIsAskedWhichRowsOnlyAtEnter: null,
    rulesOfAgentKept: null,
    isAgentForRulesNotToBeHad: false,
    hasViewNoAgentForRules: false,
    readySets: null,
    timesSidePaneAsked: 0,
    pivotTablesOutOfDateAt: [],
    timesCalendarAsked: 0,
    waysIn: waysInAtOpening(reads, canImportFiles),
    areWaysInOutOfSight: false,
    isWindowLeft: false,
    notesOfSteps: NO_NOTES_OF_STEPS,
    answerAwaited: null,
    rowsAddedAfterEntries: [],
    peopleList: null,
    timeList: null,
    formulaHelp: EMPTY_FORMULA_HELP,
    formulaFromWords: FORMULA_FROM_WORDS_START,
    fixesOnCells: NO_FIXES_ON_CELLS,
    formulasLostToLastAct: null,
    sortToLookBackOn: null,
    moveOfColumnsUnanswered: null,
    errorsAtOpening: null,
    errorsFoundAtOpening: 'toBeRead',
    sheetsWhoseToastIsSpent: [],
    profilesById: new (Map as MapConstructor)<string, ProfileOfPerson>(),
    peopleLookedUpAtChangeCount: null,
    selectionsOfOthers: [],
    selectionToldToOthers: null,
    selectedToldToAgent: null,
    askOwedToAgent: null,
    textToEditOfEntryCell: '',
    entriesUnanswered: [],
    areFormulasShown: false,
    tablesRead: NO_TABLES_READ,
    tablesNotFormatted,
    density: savedPlace?.density ?? density,
    lastDone: null,
    hasLastHeldEdgeMoved: false,
    copiedCells: null,
    cutJustMoved: null,
    mode: NAVIGATING_MODE,
    pointedReference: null,
    referencesInEntry: NO_REFERENCES,
    notice: null,
    newsOfLoss: null,
    isEntryEndedUnasked: false,
    undoOffer: null,
    isSelectionJustImported: false,
    marksOfImport: null,
    marksOfImportToCome: null,
    stepsToUndo: 0,
    stepsToRedo: 0,
    formatAsTableChosenLast: null,
    ownSortChosenLast: null,
    chartBeingMade: null,
    areStepsToUndoLost,
    saving: 'allSaved',
    hasUnsavedEdits: false,
    isLargeEditUnsaved: false,
    savingProgress: null,
    calculatingShown: CALCULATING_NOT_SHOWN as CalculatingShown,
    longCalculationTold: NO_LONG_CALCULATION as LongCalculationTold,
    isActShownAsCalculated: false,
    ownViewShownAsApplied: null,
    areFormulasShownAsLeft: false,
    isAgentWorking: false,
    isSteppedOutOfCells: false,
    caretAtEnd: null,
    isCommentModeOn: false,
    isCommentModeForACard: false,
    isCommentModeLeftByPress: false,
    hasCommentModeRefused: false,
    doesCommentModePickCells: false,
    isPressToComment: false,
    comments: null,
    commentsPointedAt: [],
    commentsWithAgent: null,
    newCommentOn: null,
    isChatBehindButton: true,
    isChatBeside: false,
    isComposerOpen: false,
    changesByAgent: [],
    isFollowingAgent: false,
    followsOnOneSheet: 'no',
    movesOfViewByItself: 0,
    hasPersonTakenViewBack: false,
    writtenInTurnOfAgent: [],
    waitForNextEditOfAgent: null,
    changedSinceRest: [],
    heldAsSheetOpened: [],
    changedOffShowSinceRest: [],
    chartGoneToSinceRest: null,
    runOfAgentGoneTo: null,
    lastGoneTo: null,
    isFirstBuild: false,
    followed: null,
    shownByAgent: null,
    cellsLinkedTo: null,
    changesAskedFor: 0,
    turnOfAgent: 'nothingSaid',
    doneByAgent: null,
    undoOfTurnOffered: null,
    isUndoOfTurnNotToBeHad: false,
    saidOfAgent: null,
    find: null,
    contextBarMenu: null,
    offersAtSelection: NO_OFFERS_AT_SELECTION,
    workbookChangeCount: 0,
    formulasWorkedOutCount: 0,
  };
  let { scrollTop, scrollLeft } = keepScrollAnchoredAcrossChange(
    {
      ...state,
      density,
      gridWidth: 1440,
      gridHeight: 800,
    },
    reads,
    reads,
    state,
  );
  let scrolledState: PageState = {
    ...state,
    density,
    scrollTop,
    scrollLeft,
  };
  return updateFiguresOfSelection(null, followEntryCellText(null, settleSelectionSeen(null, scrolledState, reads), reads), reads, false);
}
