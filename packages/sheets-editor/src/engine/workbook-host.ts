import type { EditOfAnother, SheetId, TableOfASheet, TableWithColumns, XlsxFileAnswer } from '@open-artifact/sheets-core';
import {
  openSyncedWorkbook,
  type EditOutcome,
  type EditsDropped,
  type EditToSave,
  type SyncedWorkbook,
  type SyncFault,
  type TakeBackOutcome,
  type UndoOrRedoOutcome,
} from '../store/workbook-sync.ts';
import { runEditOrRefuse, type WorkerLine } from './worker-line.ts';
import type { SheetsUtilities, WorkbookCore } from './wasm-bindings.ts';
import type { CoreRead } from './core-reads.ts';
import type { CopyWritten, WriteCopy } from './written-copy.ts';
import type { ClipboardContent } from '../state/controller.ts';
import type { CopiedValues } from '@open-artifact/sheets-core';
import type { ErrorKind } from '../model/refusals.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { ClockReading } from '../store/frames.ts';
import type { SaveOutcome, LoadOutcome } from '../store/requests.ts';
import type {
  AnswerOfQuestion,
  CauseOfWorkbookChange,
  MessageToHost,
  OpenMessage,
  QuestionKind,
  QuestionOf,
  RowsOfATable,
  StoreAnswer,
  WorkbookQuestion,
  WorkbookSavingState,
} from './worker-workbook.ts';

/** What the worker's workbook host is given by the thread it runs on. */
export interface WorkbookHostOptions {
  line: WorkerLine<MessageToPage, MessageToHost>;
  newCore(): Promise<WorkbookCore>;
  loadUtilities(): Promise<SheetsUtilities>;
  newEditId(): string;
  newIdCode(): string;
  wait(ms: number): Promise<void>;
  nowMs(): number;
  calculateLater(calculate: () => void): void;
  /** Writes a copy the page asks for; the page's own code, given here so the host does not load it. */
  writeCopy: WriteCopy;
}

export type StoreQuestion = { kind: 'save'; edit: EditToSave } | { kind: 'loadOps' } | { kind: 'askRevision' };

/**
 * A copy written on the worker as it is sent to the page: its values beside its contents, and the text with numbers
 * whole only where it differs from the text.
 */
export interface CopyAnswered {
  contents: Omit<ClipboardContent, 'valuesOfCopiedCells' | 'textWithNumbersWhole'>;
  values: CopiedValues | null;
  textWithNumbersWhole: string | null;
  whatTheLookThrew: string | null;
}

/** A question of the page answered on the worker, with the question it answers. */
export type QuestionAnswered<K extends QuestionKind = QuestionKind> = {
  [P in K]: { about: P; question: QuestionOf<P>; answer: AnswerOfQuestion<P> };
}[K];

/** What the host tells the page happened, a batch at a time. */
export type Happening =
  | { kind: 'storeAsked'; questionNumber: number; question: StoreQuestion }
  | ({ kind: 'opened'; isOpen: boolean } & WorkbookSavingState)
  | { kind: 'threw'; inWords: string }
  | ({ kind: 'answered' } & QuestionAnswered)
  | { kind: 'tablesOfSheetRead'; sheetId: SheetId; tables: TableOfASheet[] }
  | { kind: 'faultReported'; fault: SyncFault }
  | { kind: 'coreThrew'; what: ErrorKind }
  | { kind: 'calculationTookTooLong' }
  | { kind: 'revisionHeldChanged'; revision: number | null }
  | { kind: 'read'; reading: CoreRead }
  | { kind: 'changed'; cause: CauseOfWorkbookChange }
  | { kind: 'formulasLeftChanged'; areLeft: boolean }
  | ({ kind: 'savingChanged' } & WorkbookSavingState)
  | { kind: 'editsDropped'; dropped: EditsDropped }
  | { kind: 'editsOfOthersMade'; edits: EditOfAnother[]; before: 'asAfter' | 'beforeLastReading' | null }
  | { kind: 'loaded'; caughtUp: { revisionBefore: number; revision: number; before: 'asAfter' | 'beforeLastReading' } | null }
  | { kind: 'editAnswered'; outcome: EditOutcome }
  | { kind: 'undoOrRedoAnswered'; outcome: UndoOrRedoOutcome }
  | { kind: 'takeBackAnswered'; outcome: TakeBackOutcome }
  | { kind: 'ownRowOrderSeen' }
  | { kind: 'xlsxFileWritten'; file: XlsxFileAnswer | 'threw' | null }
  | { kind: 'tableRead'; table: TableWithColumns | null }
  | { kind: 'coreAnswered' };

/** What the host posts to the page. */
export interface MessageToPage {
  happened: Happening[];
}

const TABLES_ASSUMED_KEPT = 1000;
const TABLES_OTHERS_KEPT = 1000;
const TABLES_READ_SLOWDOWN_FREE_MS = 16;
const TABLES_READ_MAX_KEEP_UP_MS = 5000;
const TABLES_READ_SLOW_MS = 100;

const keepUpDelayMs = (tookMs: number): number => Math.min(20 * Math.max(0, tookMs - TABLES_READ_SLOWDOWN_FREE_MS), 1000);
const restDelayMs = (tookMs: number): number => (tookMs < TABLES_READ_SLOW_MS ? 0 : Math.min(20 * tookMs, 60000));

/** The tables of a sheet, at most so many found by assumption and so many otherwise. */
export function limitTablesTold<T extends { basis: { kind: string } }>(tables: readonly T[]): T[] {
  const left = { assumed: TABLES_ASSUMED_KEPT, others: TABLES_OTHERS_KEPT };
  return tables.filter(({ basis }) => (left[basis.kind === 'assumed' ? 'assumed' : 'others'] -= 1) >= 0);
}

interface TablesFollowerOptions {
  sheetAsItStands(sheetId: string): object | null;
  areFormulasLeft(): boolean;
  read(sheetId: string): TableOfASheet[] | null;
  tell(sheetId: string, tables: TableOfASheet[]): void;
  nowMs(): number;
  afterMs(ms: number, then: () => void): void;
}

/** Reads the tables of the sheet in view again as it changes, more slowly when a read takes long. */
export function createTablesFollower(options: TablesFollowerOptions): { follow(sheetId: string): void; keepUp(): void } {
  let followed: string | null = null;
  const reads = new Map<string, { sheet: WeakRef<object>; tookMs: number; endedAtMs: number; isToBeTriedAgain: boolean }>();
  let changedAt: { sheet: object; atMs: number } | null = null;
  let firstAskedAtMs: number | null = null;
  let dueAtMs: number | null = null;
  function keepUp(): void {
    const sheet = followed === null ? null : options.sheetAsItStands(followed);
    if (followed === null || sheet === null || options.areFormulasLeft()) return;
    const last = reads.get(followed);
    if (last?.sheet.deref() === sheet && !last.isToBeTriedAgain) return;
    const nowMs = options.nowMs();
    if (changedAt?.sheet !== sheet) changedAt = { sheet, atMs: nowMs };
    firstAskedAtMs ??= nowMs;
    const readAtMs =
      last === undefined
        ? nowMs
        : Math.max(Math.min(changedAt.atMs + keepUpDelayMs(last.tookMs), firstAskedAtMs + TABLES_READ_MAX_KEEP_UP_MS), last.endedAtMs + restDelayMs(last.tookMs));
    if (readAtMs <= nowMs) {
      const tables = options.read(followed);
      const endedAtMs = options.nowMs();
      const isToBeTriedAgain = tables === null && last?.isToBeTriedAgain !== true;
      reads.set(followed, { sheet: new WeakRef(sheet), tookMs: endedAtMs - nowMs, endedAtMs, isToBeTriedAgain });
      firstAskedAtMs = null;
      if (isToBeTriedAgain) return keepUp();
      return options.tell(followed, limitTablesTold(tables ?? []));
    }
    if (readAtMs >= (dueAtMs ?? Infinity)) return;
    dueAtMs = readAtMs;
    options.afterMs(readAtMs - nowMs, () => {
      if (dueAtMs !== readAtMs) return;
      dueAtMs = null;
      keepUp();
    });
  }
  return {
    follow(sheetId) {
      followed = sheetId;
      keepUp();
    },
    keepUp,
  };
}

export const CLOSED_WORKBOOK_STATE = {
  saving: 'stopped',
  hasUnsavedEdits: false,
  unsavedEditCount: 0,
  refusalOfEveryEdit: 'savingStopped',
} as const;

/** The time a clock frame told, in the workbook's own time zone when it goes by another. */
export function timeInWorkbookZone(reads: WorkbookReads, timeTold: ClockReading): ClockReading {
  return timeTold.timeZone !== null && reads.timeZoneNamed(timeTold.timeZone) === reads.timeZone ? timeTold : { ...timeTold, timeZone: reads.timeZone };
}

export function copyAnswered({ contents: { valuesOfCopiedCells, textWithNumbersWhole, ...contents }, whatTheLookThrew }: CopyWritten): CopyAnswered {
  return {
    contents,
    values: valuesOfCopiedCells?.values ?? null,
    textWithNumbersWhole: textWithNumbersWhole === contents.text ? null : textWithNumbersWhole,
    whatTheLookThrew,
  };
}

/** For each kind of question, how the workbook's reads answer it (a copy is written with rows read anew). */
type QuestionAnswerers = {
  [K in QuestionKind]: (
    reads: WorkbookReads,
    question: QuestionOf<K>,
    rowsOfATable: RowsOfATable | null,
    opened: SyncedWorkbook,
    writeCopy: WriteCopy,
  ) => AnswerOfQuestion<K>;
};

const QUESTION_ANSWERERS: QuestionAnswerers = {
  writtenCopy(reads, { oneCorner, otherCorner, rowsOutOfView }, rows, opened, writeCopy) {
    let written = writeCopy(reads, opened.readsWithCellsIn, [oneCorner, otherCorner, rowsOutOfView]);
    return written === null ? null : copyAnswered(written);
  },
  dropdownOptionsToOffer: (reads, q) => reads.dropdownOptionsToOffer(q.oneCorner, q.otherCorner),
  cellsThatADropdownWouldClear: (reads, q) => reads.cellsThatADropdownWouldClear(q.oneCorner, q.otherCorner, q.dropdown),
  cellsOfTheDropdownAt: (reads, q) => reads.cellsOfTheDropdownAt(q.cellId),
  whatATableChanges: (reads, q, rows) => (rows?.rowsId === q.rowsId ? reads.whatATableChanges({ ...q.table, rows: rows.rows }) : null),
  formatsGivenAsIf: (reads, q) => reads.formatsGivenAsIf(q.sheetId, q.asIf),
  conditionalFormatSuggestions: (reads, q) => reads.conditionalFormatSuggestions(q.oneCorner, q.otherCorner),
  tableAtCell: (reads, q) => reads.tableAtCell(q.cellId),
  cellTableAt: (reads, q) => reads.cellTableAt(q.cellId),
  cellTables: (reads, q) => reads.cellTables(q.sheetId),
  cellTableDeclaredAs: (reads, q) => reads.cellTableDeclaredAs(q.sheetId, q.cellTable),
  conditionalFormatsAsAgentIsTold: (reads, q) => reads.conditionalFormatsAsAgentIsTold(q.oneCorner, q.otherCorner),
  conditionalFormatsInIds: (reads, q) => reads.conditionalFormatsInIds(q.sheetId, q.written),
  conditionalFormatsByAddress: (reads, q) => reads.conditionalFormatsByAddress(q.sheetId, q.rules),
  proposedFormulaValue: (reads, q) => reads.proposedFormulaValue(q.cellId, q.text),
  filteredRows: (reads, q) => reads.filteredRows(q.table, q.filter),
  rowsInSortedOrder: (reads, q) => reads.rowsInSortedOrder(q.toSort),
  valuesOfFilteredColumn: (reads, q) => reads.valuesOfFilteredColumn(q.table, q.filter, q.c),
  tablesOfSheet: (reads, q) => reads.tablesOfSheet(q.sheetId),
  pivotTableAt: (reads, q) => reads.pivotTableAt(q.cellId),
  valuesToFilterPivotTableBy: (reads, { source, c, keeps, listed }) => reads.valuesToFilterPivotTableBy(source, c, keeps, listed),
  causeOfError: (reads, q) => reads.causeOfError(q.cellId, q.cellNow),
};

export function answerQuestion<K extends QuestionKind>(
  question: QuestionOf<K>,
  opened: SyncedWorkbook,
  rowsOfATable: RowsOfATable | null,
  writeCopy: WriteCopy,
): QuestionAnswered<K> | undefined {
  const answerer = QUESTION_ANSWERERS[question.kind];
  return answerer === undefined
    ? undefined
    : { about: question.kind, question, answer: answerer(opened.reads(), question, rowsOfATable, opened, writeCopy) };
}

const savingStateOf = (workbook: SyncedWorkbook): WorkbookSavingState => ({
  saving: workbook.saving(),
  hasUnsavedEdits: workbook.hasUnsavedEdits(),
  unsavedEditCount: workbook.unsavedEditCount(),
  refusalOfEveryEdit: workbook.refusalOfEveryEdit(),
});

const wrongAnswerKind = ({ kind }: { kind: string }): Error => Error(`the store’s answer is to another kind of question: ${kind}`);

export const inWords = (error: unknown): string => (error instanceof Error ? `${error.name}: ${error.message}` : 'something that is no Error');

/**
 * Hosts the workbook on the worker: opens it when the page asks, runs the page's edits and questions on it, and tells
 * the page what happened, a batch at a time. The store is the page's: the host asks it over the line.
 */
export function hostWorkbook(options: WorkbookHostOptions): void {
  const { line } = options;
  let workbook: SyncedWorkbook | null = null;
  let isOwnEditRunning = false;
  let happenings: Happening[] = [];
  let isTellingSoon = false;
  const tellNow = (): void => {
    isTellingSoon = false;
    if (happenings.length === 0) return;
    const told = happenings;
    happenings = [];
    line.send({ happened: told });
  };
  const tell = (happening: Happening): void => {
    happenings.push(happening);
    if (isTellingSoon) return;
    isTellingSoon = true;
    queueMicrotask(tellNow);
  };
  const storeAnswers = new Map<number, (answer: StoreAnswer) => void>();
  let questionCount = 0;
  const askStore = (question: StoreQuestion): Promise<StoreAnswer> =>
    new Promise((resolve) => {
      questionCount += 1;
      storeAnswers.set(questionCount, resolve);
      tell({ kind: 'storeAsked', questionNumber: questionCount, question });
    });
  const store = {
    async save(edit: EditToSave): Promise<SaveOutcome> {
      const answer = await askStore({ kind: 'save', edit });
      if (answer.kind !== 'save') throw wrongAnswerKind(answer);
      return answer.outcome;
    },
    async loadOps(): Promise<LoadOutcome> {
      const answer = await askStore({ kind: 'loadOps' });
      if (answer.kind !== 'loadOps') throw wrongAnswerKind(answer);
      return answer.loaded;
    },
    async askRevision(): Promise<number | 'notSent' | null> {
      const answer = await askStore({ kind: 'askRevision' });
      if (answer.kind !== 'askRevision') throw wrongAnswerKind(answer);
      return answer.revision;
    },
  };
  const tellNotOpened = (): void => tell({ kind: 'opened', isOpen: false, ...CLOSED_WORKBOOK_STATE });
  const tellThrown = (error: unknown): void => tell({ kind: 'threw', inWords: inWords(error) });
  let dropdownAsked: WorkbookQuestion | null = null;
  let hasReadSinceAsked = false;
  let rowsOfATable: RowsOfATable | null = null;
  const answer = (question: WorkbookQuestion, opened: SyncedWorkbook): void => {
    try {
      tell({ kind: 'answered', ...answerQuestion(question, opened, rowsOfATable, options.writeCopy)! });
    } catch (error) {
      tellThrown(error);
      tell({ kind: 'answered', ...answerQuestion(question, opened, rowsOfATable, options.writeCopy)! });
    }
  };
  const tablesFollower = createTablesFollower({
    sheetAsItStands: (sheetId) => workbook?.reads().sheetAsItStands(sheetId) ?? null,
    areFormulasLeft: () => workbook?.areFormulasLeft() === true,
    read(sheetId) {
      try {
        return workbook?.tablesOf(sheetId) ?? null;
      } catch (error) {
        tellThrown(error);
        return null;
      }
    },
    tell: (sheetId, tables) => tell({ kind: 'tablesOfSheetRead', sheetId, tables }),
    nowMs: options.nowMs,
    afterMs: (ms, then) => void options.wait(ms).then(then),
  });
  async function open({ revision, canWrite, timeZoneOfTheBrowser, timeTold, goesByTimeToldInAnyTimeZone }: OpenMessage): Promise<void> {
    const opened = await openSyncedWorkbook({
      store,
      newCore: options.newCore,
      utilities: await options.loadUtilities(),
      revision,
      canWrite,
      newEditId: options.newEditId,
      newIdCode: options.newIdCode,
      timeZoneOfTheBrowser,
      wait: options.wait,
      nowMs: options.nowMs,
      calculateLater: (calculate: () => void) =>
        options.calculateLater(() => {
          try {
            calculate();
          } catch (error) {
            tellThrown(error);
          }
        }),
      reportFault: (fault: SyncFault) => tell({ kind: 'faultReported', fault }),
      noteCoreThrew: (what: ErrorKind) => tell({ kind: 'coreThrew', what }),
      noteCalculationTookTooLong: () => tell({ kind: 'calculationTookTooLong' }),
      noteRevisionHeld: (revisionHeld: number | null) => tell({ kind: 'revisionHeldChanged', revision: revisionHeld }),
      noteReading(reading: CoreRead) {
        tell({ kind: 'read', reading });
        hasReadSinceAsked = true;
      },
    });
    if (opened === null) return tellNotOpened();
    workbook = opened;
    if (timeTold !== null) opened.timeTold(goesByTimeToldInAnyTimeZone ? timeInWorkbookZone(opened.reads(), timeTold) : timeTold);
    const tellAfterReading = (happening: Happening): void => {
      if (hasReadSinceAsked && dropdownAsked !== null) answer(dropdownAsked, opened);
      hasReadSinceAsked = false;
      tell(happening);
    };
    opened.onChanged((isFormulasAlone: boolean) => {
      tablesFollower.keepUp();
      tellAfterReading({ kind: 'changed', cause: isFormulasAlone ? 'formulasAlone' : isOwnEditRunning ? 'ownEdit' : 'unasked' });
    });
    opened.onFormulasLeftChanged(() => {
      tablesFollower.keepUp();
      tellAfterReading({ kind: 'formulasLeftChanged', areLeft: opened.areFormulasLeft() });
    });
    opened.onSavingChanged(() => tellAfterReading({ kind: 'savingChanged', ...savingStateOf(opened) }));
    opened.onEditsDropped((dropped: EditsDropped) => tellAfterReading({ kind: 'editsDropped', dropped }));
    opened.onEditsOfOthersMade((edits: EditOfAnother[], before: WorkbookReads | null, after: WorkbookReads) =>
      tellAfterReading({ kind: 'editsOfOthersMade', edits, before: before === null ? null : before === after ? 'asAfter' : 'beforeLastReading' }),
    );
    opened.onLoaded((caughtUp) =>
      tellAfterReading({
        kind: 'loaded',
        caughtUp:
          caughtUp === null
            ? null
            : {
                revisionBefore: caughtUp.revisionBefore,
                revision: caughtUp.revision,
                before: caughtUp.before === caughtUp.after ? 'asAfter' : 'beforeLastReading',
              },
      }),
    );
    tell({ kind: 'opened', isOpen: true, ...savingStateOf(opened) });
  }
  const runOwnEdit = <Outcome>(opened: SyncedWorkbook, edit: () => Outcome) => {
    isOwnEditRunning = true;
    const outcome = runEditOrRefuse(opened, edit, tellThrown);
    isOwnEditRunning = false;
    return outcome;
  };
  function take(message: MessageToHost, opened: SyncedWorkbook): void {
    switch (message.kind) {
      case 'open':
        throw Error('a workbook host was told to open a second workbook');
      case 'queueEdit':
        return tell({ kind: 'editAnswered', outcome: runOwnEdit(opened, () => opened.queueEdit(message.edit, message.restOfAct)) });
      case 'undoOrRedo':
        return tell({ kind: 'undoOrRedoAnswered', outcome: runOwnEdit(opened, () => opened.undoOrRedo(message.direction)) });
      case 'queueEditsThatTakeBack':
        return tell({
          kind: 'takeBackAnswered',
          outcome: runOwnEdit(opened, () => opened.queueEditsThatTakeBack(message.builtOnRevision, message.edits)),
        });
      case 'seeRowsInOwnOrder':
        runOwnEdit(opened, () => opened.seeRowsInOwnOrder(message.sheetId, message.rows));
        return tell({ kind: 'ownRowOrderSeen' });
      case 'writeXlsxFile': {
        let file: XlsxFileAnswer | 'threw' | null = 'threw';
        try {
          file = opened.xlsxFile(message.asked);
        } catch (error) {
          tellThrown(error);
        }
        return tell({ kind: 'xlsxFileWritten', file });
      }
      case 'readTableAt': {
        let table: TableWithColumns | null = null;
        try {
          table = opened.tableAt(message.cellId);
        } catch (error) {
          tellThrown(error);
        }
        return tell({ kind: 'tableRead', table });
      }
      case 'followTablesOf':
        return tablesFollower.follow(message.sheetId);
      case 'rowsOfATable':
        rowsOfATable = message;
        return;
      case 'ask':
        if (message.question.kind === 'cellsOfTheDropdownAt') dropdownAsked = message.question;
        return answer(message.question, opened);
      case 'storeAnswered':
        throw Error('an answer of the store is taken before this');
      case 'editStreamed':
        return opened.editStreamed(message.revision, message.applied);
      case 'storeRevisionReported':
        return opened.storeRevisionReported(message.revision);
      case 'timeTold':
        return opened.timeTold(message.time);
      case 'availabilityStated':
        return opened.availabilityStated(message.availability);
      case 'workOutFormulasLeft':
        return opened.workOutFormulasLeft();
      case 'storeReconnected':
        return opened.storeReconnected();
      case 'storeClosed':
        return opened.storeClosed();
      case 'tabVisibilityChanged':
        return opened.tabVisibilityChanged(message.isHidden);
    }
  }
  line.onMessage((message) => {
    try {
      if (message.kind === 'storeAnswered') {
        const resolve = storeAnswers.get(message.questionNumber);
        storeAnswers.delete(message.questionNumber);
        resolve?.(message.answer);
      } else if (message.kind === 'open' && workbook === null)
        open(message).catch((error) => {
          tellThrown(error);
          tellNotOpened();
        });
      else if (workbook !== null) take(message, workbook);
    } catch (error) {
      tellThrown(error);
    }
  });
}
