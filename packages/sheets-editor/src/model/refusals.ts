/** Why every edit is refused for now, as the page tells it. */
export type EditRefusalReason = (typeof EDIT_REFUSAL_REASONS)[number];
/** The message the page shows for a refused edit. */
export type RefusalMessageKey = (typeof REFUSAL_MESSAGE_KEYS)[keyof typeof REFUSAL_MESSAGE_KEYS] | 'fault';
/** The limit of the workbook a refusal tells of. */
export type LimitRefusalKind =
  | 'tooManyFilledCells'
  | 'tooManyDistinctFormulas'
  | 'tooManyRows'
  | 'tooManyColumns'
  | 'tooManySheets'
  | 'tooManyMergedCells'
  | 'tooManyDropdowns'
  | 'tooManyGroups'
  | 'tooManyConditionalFormats'
  | 'noRoomInWorkbook'
  | 'tookTooLong'
  | 'editingPaused';
/** Why an undo or a redo is refused, as the page tells it. */
export type UndoRefusalKind = (typeof UNDO_REFUSAL_KINDS)[keyof typeof UNDO_REFUSAL_KINDS];
/** What kind of error was thrown, as the page counts it. */
export type ErrorKind = (typeof ERROR_KINDS)[number];
/** The shape of a file fetched as the engine's module. */
export type WasmFileShape = (typeof WASM_FILE_SHAPES)[number];
export function editRefusalReason(refusal: string): EditRefusalReason | 'fault' {
  let messageKey = refusalMessageKey(refusal);
  return isEditRefusalReason(messageKey) ? messageKey : 'fault';
}
export function readErrorKind(error: unknown): ErrorKind {
  if (!(error instanceof Error)) return 'notAnError';
  let { name, message } = error;
  switch (name) {
    case 'RuntimeError':
      return WASM_UNREACHABLE_MESSAGE.test(message) ? 'wasmUnreachable' : 'wasmOtherTrap';
    case 'CompileError':
      return 'wasmCompileError';
    case 'LinkError':
      return 'wasmLinkError';
    case 'ChunkLoadError':
      return 'fileNotFetched';
    case 'RangeError':
    case 'InternalError':
      if (STACK_OVERFLOW_MESSAGE.test(message)) return 'stackOverflow';
      if (OUT_OF_MEMORY_MESSAGE.test(message)) return 'outOfMemory';
      return name === 'RangeError' ? name : 'otherError';
    case 'TypeError':
    case 'Error':
      return name;
    default:
      return 'otherError';
  }
}
export function errorKindOf(error: unknown): ErrorKind {
  try {
    return readErrorKind(error);
  } catch {
    return 'otherError';
  }
}
export function fileNotFetchedWord(status: number | null, wasEarly: boolean): string {
  let statusClass = Math.floor((status ?? 0) / 100);
  return `fileNotFetched_${status === 404 ? '404' : statusClass === 4 ? '4xx' : statusClass === 5 ? '5xx' : 'other'}_${wasEarly ? 'early' : 'own'}`;
}
export function wasmFileShape(buffer: ArrayBuffer): WasmFileShape {
  let bytes = new Uint8Array(buffer);
  if (bytes.length === 0) return 'empty';
  if (WASM_MAGIC_BYTES.some((byte, index) => index < bytes.length && bytes[index] !== byte)) return 'notWasm';
  let offset = WASM_HEADER_SIZE;
  while (offset < bytes.length) {
    offset += 1;
    let sectionSize = 0;
    for (let scale = 1, isLastByte = false; !isLastByte; scale *= 128, offset += 1) {
      let byte = bytes[offset];
      if (byte === undefined) return 'short';
      sectionSize += (byte % 128) * scale;
      isLastByte = byte < 128;
    }
    offset += sectionSize;
  }
  return offset === bytes.length ? 'whole' : 'short';
}
export function errorWordOfModule(error: unknown, bytes: ArrayBuffer | null, wasEarly: boolean): string {
  let kind = errorKindOf(error);
  if (kind !== 'wasmCompileError' || bytes === null) return kind;
  try {
    return `${kind}_${wasmFileShape(bytes)}_${wasEarly ? 'early' : 'own'}`;
  } catch {
    return kind;
  }
}
export const EDIT_REFUSAL_REASONS = ['readOnly', 'savingStopped', 'pageOutOfDate', 'editingPaused', 'earlierVersionShown'] as const;
export const isEditRefusalReason = (key: string): key is EditRefusalReason => EDIT_REFUSAL_REASONS.some((reason) => reason === key);
export const getOwnEntry = <V>(table: Readonly<Record<string, V>>, key: string): V | undefined => (Object.hasOwn(table, key) ? table[key] : undefined);
export const REFUSAL_MESSAGE_KEYS = {
  readOnly: 'readOnly',
  savingStopped: 'savingStopped',
  pageOutOfDate: 'pageOutOfDate',
  editingPaused: 'editingPaused',
  earlierVersionShown: 'earlierVersionShown',
  numberNotFinite: 'numberTooLarge',
  textTooLong: 'textTooLong',
  richTextTooLarge: 'textTooLong',
  formulaTooLong: 'formulaTooLong',
  tooManyOperations: 'tooLargeForOneEdit',
  tooManyCellsToEnterIn: 'tooLargeForOneEdit',
  sheetNameNotAllowed: 'sheetNameNotAllowed',
  sheetNameTaken: 'sheetNameTaken',
  editTooLarge: 'tooLargeForOneEdit',
  repeatedPasteTooLarge: 'selectionTooLargeToPasteInto',
  fillTooLarge: 'tooLargeForOneEdit',
  cellFormatsTooScattered: 'formatsTooMixed',
  undoTooLarge: 'undoTooLarge',
  tooManyCells: 'noRoomInWorkbook',
  tooMuchContent: 'noRoomInWorkbook',
  tooMuchTextOfDistinctFormulas: 'noRoomInWorkbook',
  tooManyRows: 'noRoomInWorkbook',
  tooManyColumns: 'noRoomInWorkbook',
  tooManyRuns: 'noRoomInWorkbook',
  tooManyMergedRanges: 'noRoomInWorkbook',
  tooManyDropdowns: 'noRoomInWorkbook',
  tooManyViews: 'tooManyCharts',
  tooManyPlacements: 'tooManyCharts',
  tooManyGroups: 'tooManyGroups',
  tooManyConditionalFormats: 'tooManyConditionalFormats',
  nameOfNamedViewTaken: 'namedViewNameTaken',
  namedViewTooLarge: 'namedViewTooLarge',
  tooManyTestsInNamedView: 'namedViewTooLarge',
  tooManyKeysInNamedView: 'namedViewTooLarge',
  unknownNamedView: 'namedViewIsGone',
  unknownInteractive: 'interactiveCantWrite',
  cellIsNotTheInteractives: 'interactiveCantWrite',
  cellHoldsMoreThanAValue: 'interactiveCantWrite',
  valueDoesNotFitCell: 'interactiveCantWrite',
  interactiveSavesTooMuch: 'interactiveSavesTooMuch',
  tooManySheets: 'tooManySheets',
  tableTooLarge: 'tableTooLarge',
  stepTooLarge: 'tableTooLarge',
  pasteDoesNotFit: 'pasteDoesNotFit',
  pasteCutsMergedCells: 'pasteCutsMergedCells',
  cellCoveredByMergedRange: 'pasteCutsMergedCells',
  tooMuchThatNoCellShows: 'pasteHidesTooMuchText',
  cellOfDropdownHoldsNoOption: 'isNoOptionOfDropdown',
  tooManyFormulasReadMovedCells: 'tooManyFormulasReadMovedCells',
  formulasNotCalculated: 'formulasNotCalculated',
  pivotTableSourceHasNoHeader: 'pivotTableSourceHasNoHeader',
  pivotTableSourceHasNoRecords: 'pivotTableSourceHasNoRecords',
  pivotTableSourceRecordsNotClear: 'pivotTableSourceRecordsNotClear',
  pivotTableSourceHasSectionsOrSubtotals: 'pivotTableSourceHasSectionsOrSubtotals',
  pivotTableColumnNotOfSource: 'pivotTableColumnNotOfSource',
  pivotTableTotalNeedsNumbers: 'pivotTableTotalNeedsNumbers',
  pivotTablePeriodNeedsDates: 'pivotTablePeriodNeedsDates',
  pivotTableFilterValueCannotBeWritten: 'pivotTableFilterValueCannotBeWritten',
  pivotTableWouldReadItself: 'pivotTableWouldReadItself',
  pivotTableWouldTouchATable: 'pivotTableWouldTouchATable',
  pivotTableWouldBeReadByAnother: 'pivotTableWouldBeReadByAnother',
  pivotTableCellsInTheWay: 'pivotTableCellsInTheWay',
  pivotTableFormulaInTheWay: 'pivotTableFormulaInTheWay',
  pivotTableTooLarge: 'pivotTableTooLarge',
  mergedRangesOverlap: 'mergedCellsOverlap',
  patternEndsBeforeTheFill: 'patternEndsTooSoon',
  moveSplitsMergedRange: 'moveSplitsMergedCells',
  mergedRangeAmongSortedCells: 'moveSplitsMergedCells',
  mergedRangeAmongMovedColumnsOfCells: 'moveSplitsMergedCells',
  spilledValuesAmongMovedColumnsOfCells: 'moveCrossesSpilledCells',
  columnOutOfSightAmongMovedColumnsOfCells: 'moveCrossesHiddenColumn',
  sortKeysNotCalculated: 'sortKeysNotCalculated',
  sortColumnFilledDownByOneFormula: 'sortColumnFilledDownByOneFormula',
  sortColumnFilledFromOutsideTheCells: 'sortColumnFilledFromOutsideTheCells',
  groupsPartlyOverlap: 'groupsPartlyOverlap',
  nothingLeftInSight: 'nothingLeftInSight',
  widgetNodeNotCopied: 'chartsNotCopied',
} as const;
export const refusalMessageKey = (refusal: string): RefusalMessageKey => getOwnEntry(REFUSAL_MESSAGE_KEYS, refusal) ?? 'fault';
export const LIMIT_REFUSAL_KINDS = new Map<string, LimitRefusalKind>([
  ['tooManyCells', 'tooManyFilledCells'],
  ['tooMuchContent', 'tooManyFilledCells'],
  ['tooMuchTextOfDistinctFormulas', 'tooManyDistinctFormulas'],
  ['tooManyRows', 'tooManyRows'],
  ['tooManyColumns', 'tooManyColumns'],
  ['tooManySheets', 'tooManySheets'],
  ['tooManyMergedRanges', 'tooManyMergedCells'],
  ['tooManyDropdowns', 'tooManyDropdowns'],
  ['tooManyGroups', 'tooManyGroups'],
  ['tooManyConditionalFormats', 'tooManyConditionalFormats'],
  ['tooManyRuns', 'noRoomInWorkbook'],
  ['tooManyViews', 'noRoomInWorkbook'],
  ['tooManyPlacements', 'noRoomInWorkbook'],
  ['editTookTooLong', 'tookTooLong'],
  ['switchedOff', 'editingPaused'],
]);
export const limitRefusalKind = (refusal: string): LimitRefusalKind | null => LIMIT_REFUSAL_KINDS.get(refusal) ?? null;
export const UNDO_REFUSAL_KINDS = {
  changedSince: 'changedSince',
  moveSplitsMergedRange: 'changedSince',
  groupsPartlyOverlap: 'changedSince',
  groupsCoverTheSame: 'changedSince',
  groupsTooDeep: 'changedSince',
  moveTakesEndOfGroup: 'changedSince',
  deleteTakesEndOfGroup: 'changedSince',
  sheetNameTaken: 'changedSince',
  editTooLarge: 'formatsTooMixed',
  tooManyOperations: 'formatsTooMixed',
  cellFormatsTooScattered: 'formatsTooMixed',
  undoTooLarge: 'formatsTooMixed',
  noSheetLeft: 'noOtherSheetLeft',
  noRowLeft: 'noOtherRowLeft',
  noColumnLeft: 'noOtherColumnLeft',
} as const;
export const undoRefusalKind = (refusal: string): UndoRefusalKind | null => getOwnEntry(UNDO_REFUSAL_KINDS, refusal) ?? null;
export const ERROR_KINDS = [
  'wasmUnreachable',
  'wasmOtherTrap',
  'wasmCompileError',
  'wasmLinkError',
  'outOfMemory',
  'stackOverflow',
  'fileNotFetched',
  'TypeError',
  'RangeError',
  'Error',
  'notAnError',
  'otherError',
] as const;
export const WASM_UNREACHABLE_MESSAGE = /^(?:unreachable|unreachable executed|Unreachable code should not be executed\b.*)$/s;
export const STACK_OVERFLOW_MESSAGE = /^(?:Maximum call stack size exceeded\.?|too much recursion)$/;
export const OUT_OF_MEMORY_MESSAGE =
  /^(?:(?:WebAssembly\.[\w.]+\(\): )?(?:[Oo]ut of memory\b.*|could not allocate memory)|Array buffer allocation failed)$/s;
export const FETCH_STATUS_KINDS = ['404', '4xx', '5xx', 'other'];
export const WASM_FILE_SHAPES = ['empty', 'notWasm', 'short', 'whole'] as const;
export const FETCH_ORIGINS = ['early', 'own'];
export const WASM_MAGIC_BYTES = [0, 97, 115, 109];
export const WASM_HEADER_SIZE = 8;
export const FAULT_WORDS = [
  'unconfirmedEditNotReverted',
  'streamedEditUnreadable',
  'streamedEditRefused',
  'timeToldNotReadable',
  'saveAnswerNotUnderstood',
  'saveUnansweredManyTimes',
];
export const MENDED_MODULE_WORDS = Object.freeze(['module_mendedAfter_empty', 'module_mendedAfter_notWasm', 'module_mendedAfter_short']);
export const PAGE_FAILURE_WORDS = Object.freeze([
  ...ERROR_KINDS.flatMap((kind) => [`module_${kind}`, `opening_${kind}`]),
  ...FETCH_STATUS_KINDS.flatMap(
    (statusKind) => FETCH_ORIGINS.map((origin) => `module_fileNotFetched_${statusKind}_${origin}`),
  ),
  ...WASM_FILE_SHAPES.flatMap(
    (shape) => FETCH_ORIGINS.map((origin) => `module_wasmCompileError_${shape}_${origin}`),
  ),
  ...FAULT_WORDS.map((fault) => `fault_${fault}`),
  'fault_other',
  'module_noWebAssembly',
  'noCauseSeen',
]);
export const ERROR_PLACES = [
  'engine',
  'worker',
  'stream',
  'draw',
  'otherViewers',
  'ownColor',
  'versionHistory',
  'changesByAgent',
  'charts',
  'exports',
  'actsCounted',
  'uncaught',
  'unhandled',
];
export const THREW_WORDS = Object.freeze(
  ERROR_PLACES.flatMap((place) => ERROR_KINDS.map((kind) => `threw_${place}_${kind}`)),
);
export const faultWord = (fault: string): string => `fault_${FAULT_WORDS.find((word) => word === fault) ?? 'other'}`;
