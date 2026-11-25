import type { JsonObject } from '@open-artifact/runtime/sheet-api';
import type { ColumnId, EngineRecordedEdit } from '@open-artifact/sheets-core';
import { isRecord, isUint32, asArrayOrEmpty } from '../store/json.ts';
import { answerOf, classifyStoreFailure, type StoreFailure } from '../store/requests.ts';
import type { StoreCall, StoreOutcome } from '../store/sheet-stream.ts';
import { booleanText } from '../model/cell-text.ts';
import type { CellId } from '../model/workbook.ts';
import type { HistoryWhy } from '../state/initial-state.ts';
import type { EditsToTakeBack } from '../state/transitions.ts';
import type {
  CellHistoryChange,
  CellHistoryOutcome,
  EditsThatTakeBackOutcome,
  HeldContent,
  VersionsReadOutcome,
} from '../state/event-reducer.ts';
export function versionsRequest(before: { firstRevision: number } | null, limit: number = VERSIONS_PAGE_SIZE): StoreCall {
  return { route: 'read', request: { kind: 'versions', limit, ...(before !== null && { before: before.firstRevision }) } };
}

/** The edits asked for to take back; the same as the effect's. */
export type TakeBack = EditsToTakeBack;

export function editsThatTakeBackRequest(takeBack: TakeBack): StoreCall {
  return takeBack.kind === 'allSince'
    ? { route: 'read', request: { kind: 'editsThatRestore', revision: takeBack.revision } }
    : { route: 'read', request: { kind: 'editsThatUndo', ranges: takeBack.ranges.map(({ first, last }) => ({ first, last })) } };
}

export function cellHistoryRequest({ sheetId, rowId, columnId }: CellId): StoreCall {
  return { route: 'read', request: { kind: 'cellHistory', sheetId, r: rowId, c: columnId } };
}

export function rowHistoryRequest({ sheetId, rowId }: Pick<CellId, 'sheetId' | 'rowId'>): StoreCall {
  return { route: 'read', request: { kind: 'rowHistory', sheetId, r: rowId } };
}

export function historyFailureWhy(failure: StoreFailure): HistoryWhy {
  let why = HISTORY_FAILURE_WHY.get(failure.word);
  if (why !== undefined) return why;
  if (failure.cause === 'noAnswer') return 'noAnswer';
  return failure.cause === 'storeFailed' && failure.saveOutcome !== 'refused' ? 'busy' : 'refused';
}
export type EditAuthor = { kind: 'agent' } | { kind: 'person'; userId: string };

export function parseEditAuthor(actor: unknown): EditAuthor | null {
  if (!isRecord(actor)) return null;
  if (actor.isAgent === true) return { kind: 'agent' };
  return typeof actor.personId === 'string' && actor.personId !== '' ? { kind: 'person', userId: actor.personId } : null;
}

/** A version of the workbook as the store lists it: the revisions it spans, when it was made, and by whom. */
export interface WorkbookVersion {
  revision: number;
  firstRevision: number;
  atMs: number;
  authors: EditAuthor[];
}

export function parseVersionRow(row: unknown): WorkbookVersion | null {
  if (!isRecord(row)) return null;
  let { revision, firstRevision, at: atStored, authors } = row;
  let atMs = typeof atStored === 'string' ? Date.parse(atStored) : Number.NaN;
  if (!isUint32(revision) || !isUint32(firstRevision)) return null;
  if (firstRevision < 1 || firstRevision > revision || Number.isNaN(atMs)) return null;
  return {
    revision,
    firstRevision,
    atMs,
    authors: dedupeAgentAuthors(
      asArrayOrEmpty(authors)
        .map(parseEditAuthor)
        .filter((author) => author !== null),
    ),
  };
}
export function readVersions(outcome: StoreOutcome): VersionsReadOutcome {
  let failure = classifyStoreFailure(outcome);
  if (failure !== null)
    return {
      kind: 'notRead',
      why: historyFailureWhy(failure),
    };
  let { rows }: JsonObject = answerOf(outcome) ?? {};
  let versions = asArrayOrEmpty(rows).map(parseVersionRow);
  let inOrder = versions.every(
    (version, index) => index === 0 || (version?.revision ?? 0) < (versions[index - 1]?.firstRevision ?? 0),
  );
  let parsed = versions.filter((version) => version !== null);
  if (!Array.isArray(rows) || parsed.length < versions.length || !inOrder)
    return {
      kind: 'notRead',
      why: 'refused',
    };
  return {
    kind: 'read',
    versions: parsed,
    hasOlder: (parsed.at(-1)?.firstRevision ?? 1) > 1,
  };
}
export function parseHeldContent(content: unknown): HeldContent | null {
  if (content === undefined)
    return {
      kind: 'nothing',
    };
  let input = isRecord(content) ? content.input : undefined;
  if (!isRecord(content) || !isRecord(input) || !isHeldContentKind(input.kind)) return null;
  return HELD_CONTENT_READERS[input.kind](input, content);
}
/** Reads the cells a change of the history touched from its row, or null when the row does not tell them. */
export type ReadCellsOfChange = (row: Record<string, unknown>) => CellHistoryChange['cells'] | null;

export function parseHistoryChange(row: unknown, readCells: ReadCellsOfChange): CellHistoryChange | null {
  if (!isRecord(row)) return null;
  let { revision, at } = row;
  let atMs = typeof at === 'string' ? Date.parse(at) : Number.NaN;
  let cells = readCells(row);
  if (!isUint32(revision) || revision < 1 || Number.isNaN(atMs) || cells === null) return null;
  return {
    revision,
    atMs,
    author: parseEditAuthor(row.actor),
    cells,
  };
}
export function readHistoryChanges(outcome: StoreOutcome, readCells: ReadCellsOfChange): CellHistoryOutcome {
  let failure = classifyStoreFailure(outcome);
  if (failure !== null)
    return {
      kind: 'notRead',
      why: CELL_HISTORY_FAILURE_WHY.get(failure.word) ?? historyFailureWhy(failure),
    };
  let { rows, truncated }: JsonObject = answerOf(outcome) ?? {};
  let parsed = asArrayOrEmpty(rows).map((row) => parseHistoryChange(row, readCells));
  let inOrder = parsed.every(
    (change, index) => index === 0 || (change?.revision ?? 0) < (parsed[index - 1]?.revision ?? 0),
  );
  let changes = parsed.filter((change) => change !== null);
  let allLeftOut = changes.length === 0 && truncated === true;
  if (!Array.isArray(rows) || changes.length < parsed.length || !inOrder || allLeftOut)
    return {
      kind: 'notRead',
      why: 'refused',
    };
  return {
    kind: 'read',
    changes,
    areEarlierLeftOut: truncated === true,
  };
}
export function readEditsThatTakeBack(outcome: StoreOutcome): EditsThatTakeBackOutcome {
  let failure = classifyStoreFailure(outcome);
  if (failure !== null)
    return {
      kind: 'notRead',
      why: TAKE_BACK_FAILURE_WHY.get(failure.word) ?? historyFailureWhy(failure),
    };
  let answer = answerOf(outcome);
  let { revision, edits }: JsonObject = answer?.kind === 'editsToTakeBack' ? answer : {};
  if (!isUint32(revision) || !Array.isArray(edits))
    return {
      kind: 'notRead',
      why: 'refused',
    };
  return {
    kind: 'read',
    builtOnRevision: revision,
    // The store answers with edits the engine recorded, in the engine's own form; JSON types cannot say so.
    edits: edits as unknown[] as EngineRecordedEdit[],
  };
}
/** Whether the workbook's history holds only the agent's edits, apart from the first revision. */
export function isWrittenByAgentAlone(outcome: StoreOutcome): boolean {
  let versions = readVersions(outcome);
  if (versions.kind !== 'read' || versions.hasOlder || versions.versions.length === 0) return false;
  let { rows }: JsonObject = answerOf(outcome) ?? {};
  return asArrayOrEmpty(rows).every((row) => {
    let { revision, authors }: Record<string, unknown> = isRecord(row) ? row : {};
    let authorsRead = asArrayOrEmpty(authors).map(parseEditAuthor);
    return revision === 1 || (authorsRead.length > 0 && authorsRead.every((author) => author?.kind === 'agent'));
  });
}
export function whyRevisionNotLoaded(outcome: StoreOutcome): 'unknownRevision' | HistoryWhy {
  let failure = classifyStoreFailure(outcome);
  if (failure === null) return 'refused';
  return failure.word === 'unknownRevision' ? failure.word : historyFailureWhy(failure);
}
export const VERSIONS_PAGE_SIZE = 50;
export const LATEST_VERSIONS_COUNT = 10;
export const latestVersionsRequest = (): StoreCall => versionsRequest(null, LATEST_VERSIONS_COUNT);
/** Why edits that take back could not be read, beyond why any read of the history fails. */
export type WhyNotTakenBack = Exclude<Extract<EditsThatTakeBackOutcome, { kind: 'notRead' }>['why'], HistoryWhy>;
/** Why the history of a cell or row could not be read, beyond why any read of the history fails. */
export type WhyCellHistoryNotRead = Exclude<Extract<CellHistoryOutcome, { kind: 'notRead' }>['why'], HistoryWhy>;
export const HISTORY_FAILURE_WHY = new Map<string, HistoryWhy>([
  ['unknownReadKind', 'storeDoesNotKnowHow'],
  ['switchedOff', 'storeDoesNotKnowHow'],
  ['historyDoesNotMatch', 'recordDoesNotMatch'],
  ['historyTookTooLong', 'tookTooLong'],
  ['historyBusy', 'busy'],
]);
export const TAKE_BACK_FAILURE_WHY = new Map<string, WhyNotTakenBack>([
  ['unknownRevision', 'unknownRevision'],
  ['changedSince', 'changedSince'],
  ['tooMuchToTakeBack', 'tooMuch'],
  ['reverseNotAccepted', 'notAccepted'],
]);
export const CELL_HISTORY_FAILURE_WHY = new Map<string, WhyCellHistoryNotRead>([
  ['unknownRow', 'cellIsGone'],
  ['unknownColumn', 'cellIsGone'],
  ['answerTooLarge', 'answerIsTooLarge'],
]);
export const dedupeAgentAuthors = (authors: EditAuthor[]): EditAuthor[] =>
  authors.filter(
    ({ kind }, index) =>
      kind !== 'agent' || authors.findIndex((other) => other.kind === kind) === index,
  );
export const writtenHeldContent = (text: unknown): HeldContent | null =>
  typeof text === 'string'
    ? {
        kind: 'written',
        text,
      }
    : null;
export const shownTextHeldContent = ({ value }: Record<string, unknown>): HeldContent | null =>
  isRecord(value) && value.kind === 'text' ? writtenHeldContent(value.value) : null;
/** Reads what a cell held from the input it was given and the content the store kept of it. */
type HeldContentReader = (input: Record<string, unknown>, content: Record<string, unknown>) => HeldContent | null;
export const HELD_CONTENT_READERS = {
  number({ value }, { numberIsEditedAs }) {
    if (numberIsEditedAs !== undefined) return writtenHeldContent(numberIsEditedAs);
    return typeof value === 'number'
      ? {
          kind: 'number',
          value,
        }
      : null;
  },
  text: ({ value }) => writtenHeldContent(value),
  boolean: ({ value }) => (typeof value === 'boolean' ? writtenHeldContent(booleanText(value)) : null),
  formula: (input, { formulaText }) => writtenHeldContent(formulaText),
  dropdownOption: (input, content) => shownTextHeldContent(content),
  user: (input, content) => shownTextHeldContent(content),
  users: (input, content) => shownTextHeldContent(content),
  richText: (input, content) => shownTextHeldContent(content),
} satisfies Record<string, HeldContentReader>;
export type HeldContentKind = keyof typeof HELD_CONTENT_READERS;
export const isHeldContentKind = (kind: unknown): kind is HeldContentKind =>
  typeof kind === 'string' && Object.hasOwn(HELD_CONTENT_READERS, kind);
export const readCellHistory = (outcome: StoreOutcome, columnId: ColumnId): CellHistoryOutcome =>
  readHistoryChanges(outcome, ({ content }) => {
    let held = parseHeldContent(content);
    return held === null
      ? null
      : [
          {
            columnId,
            held,
          },
        ];
  });
export const readRowHistory = (outcome: StoreOutcome): CellHistoryOutcome =>
  readHistoryChanges(outcome, ({ cells }) => {
    if (!Array.isArray(cells)) return null;
    let parsed = cells.map((cell) => {
      let held = isRecord(cell) ? parseHeldContent(cell.content) : null;
      let columnId = isRecord(cell) ? cell.c : null;
      return held === null || typeof columnId !== 'string'
        ? null
        : {
            columnId,
            held,
          };
    });
    let cellChanges = parsed.filter((cell) => cell !== null);
    return cellChanges.length === parsed.length && cellChanges.length > 0 ? cellChanges : null;
  });
