import type { Json, JsonObject } from '@open-artifact/runtime/sheet-api';
import type { EngineRecordedEdit } from '@open-artifact/sheets-core';
import { isRecord, isUint32 } from './json.ts';
import { limitRefusalKind, type LimitRefusalKind } from '../model/refusals.ts';
import type { StoreCall, StoreOutcome } from './sheet-stream.ts';

export type FailureCause = 'storeBehind' | 'pageBehind' | 'requestUnreadable' | 'refused' | 'storeFailed' | 'noAnswer' | 'tookTooLong' | 'pageFailed';

/** Why the server refused an edit, in the page's words. */
export type WhyRefused = 'notTakenForNow' | 'readOnly' | 'tooLargeForOneEdit' | LimitRefusalKind | null;

export type SaveOutcomeKind = 'refused' | 'refusedForNow' | 'pageOutOfDate' | 'mayNotHaveArrived' | 'notSent';

/** Why a call came to nothing: its cause, what a save makes of it, and the word the server gave. */
export interface StoreFailure {
  cause: FailureCause;
  saveOutcome: SaveOutcomeKind;
  whyRefused?: WhyRefused;
  busyForMs?: number;
  word: string;
}

export type SaveOutcome =
  | { kind: 'saved'; revision: number }
  | { kind: 'refused'; why: WhyRefused }
  | { kind: 'refusedForNow'; why: WhyRefused; busyForMs: number }
  | { kind: 'mayNotHaveArrived'; wasAnswered: boolean }
  | { kind: 'pageOutOfDate' }
  | { kind: 'notSent' }
  | { kind: 'answerNotUnderstood' };

/** The workbook's operations up to a revision, as one load. */
export interface LoadedOps {
  revision: number;
  v: number;
  ops: Json[];
}

export type LoadOutcome = LoadedOps | 'pageOutOfDate' | { busyForMs: number } | null;

export type CompiledWidget =
  | { kind: 'compiled'; artifact: string }
  | { kind: 'notPublished' }
  | { kind: 'notCompiled' }
  | { kind: 'busy' }
  | { kind: 'refused' }
  | { kind: 'noAnswer' }
  | { kind: 'notSent' };

/** The server's answer, when there is one. */
export const answerOf = (outcome: StoreOutcome): JsonObject | null => (outcome.kind === 'answered' ? outcome.answer : null);

/** The refusal word of an answer that is a refusal. */
export function refusalOf(outcome: StoreOutcome): string | null {
  const answer = answerOf(outcome);
  if (answer === null || answer.kind !== 'refused') return null;
  return typeof answer.refusal === 'string' ? answer.refusal : 'refusalWithNoWord';
}

export function saveEditRequest({ editId, recordedEdit }: { editId: string; recordedEdit: EngineRecordedEdit }): StoreCall {
  return { route: 'send', request: { opId: editId, v: recordedEdit.v, base: recordedEdit.base, ops: recordedEdit.ops as Json[] } };
}

export function classifyRefusal(refusal: string, answer: JsonObject): StoreFailure {
  const failure = PAGE_OUT_OF_DATE_FAILURES.get(refusal) ?? ENGINE_REFUSAL_FAILURES.get(refusal) ?? STORE_REFUSAL_FAILURES.get(refusal) ?? storeFailure('refused', limitRefusalKind(refusal));
  const { retryAfterMs } = answer;
  return {
    ...(failure.saveOutcome === 'refused' && isUint32(retryAfterMs)
      ? { cause: 'storeFailed', saveOutcome: 'refusedForNow', whyRefused: failure.whyRefused, busyForMs: retryAfterMs }
      : failure),
    word: refusal,
  };
}

export function classifyStoreFailure(outcome: StoreOutcome): StoreFailure | null {
  if (outcome.kind === 'notSent') return { cause: 'noAnswer', saveOutcome: 'notSent', word: 'streamNotOpen' };
  if (outcome.kind === 'mayNotHaveArrived') return { cause: 'noAnswer', saveOutcome: 'mayNotHaveArrived', word: 'answerNeverCame' };
  const refusal = refusalOf(outcome);
  return refusal === null ? null : classifyRefusal(refusal, outcome.answer);
}

export function readSaveOutcome(outcome: StoreOutcome): SaveOutcome {
  const failure = classifyStoreFailure(outcome);
  if (failure?.saveOutcome === 'mayNotHaveArrived') return { kind: 'mayNotHaveArrived', wasAnswered: outcome.kind === 'answered' };
  if (failure?.saveOutcome === 'refused') return { kind: 'refused', why: failure.whyRefused ?? null };
  if (failure?.saveOutcome === 'refusedForNow') return { kind: 'refusedForNow', why: failure.whyRefused ?? null, busyForMs: failure.busyForMs ?? 0 };
  if (failure !== null) return { kind: failure.saveOutcome };
  const answer = answerOf(outcome);
  return answer?.kind === 'saved' && isUint32(answer.revision) ? { kind: 'saved', revision: answer.revision } : { kind: 'answerNotUnderstood' };
}

export function applyEditRequest(base: number, edit: JsonObject, opId: string): StoreCall {
  return { route: 'send', request: { opId, base, edits: [edit] } };
}

export const addSheetRequest = (sheetName: string, opId: string): StoreCall => applyEditRequest(0, { kind: 'addSheet', name: sheetName }, opId);

export const setLocaleRequest = (base: number, locale: string, opId: string): StoreCall => applyEditRequest(base, { kind: 'setLocale', locale }, opId);

export const readSheetsRequest = (): StoreCall => ({ route: 'read', request: { kind: 'sheets' } });

export function readRetryAfterMs(outcome: StoreOutcome): number {
  const retryAfterMs = answerOf(outcome)?.retryAfterMs;
  return isUint32(retryAfterMs) ? retryAfterMs : 0;
}

export function isRetryableFailure(outcome: StoreOutcome): boolean {
  const { kind } = readSaveOutcome(outcome);
  return kind === 'notSent' || kind === 'mayNotHaveArrived' || kind === 'refusedForNow';
}

/** The revision an edits request left the log at (saved, or where the log stands when refused); null to try again. */
export function readUpdatedRevision(outcome: StoreOutcome): number | null {
  if (isRetryableFailure(outcome)) return null;
  const revision = answerOf(outcome)?.revision;
  return isUint32(revision) ? revision : 0;
}

/** The revision an answer says the log stands at, or 0 when it says none. */
export function revisionOfAnswer(outcome: StoreOutcome): number {
  const revision = answerOf(outcome)?.revision;
  return isUint32(revision) ? revision : 0;
}

/** The revision of a workbook whose sheets are all blank in `locale`, or null. */
export function blankWorkbookRevision(locale: string, outcome: StoreOutcome): number | null {
  const answer = answerOf(outcome);
  if (answer?.kind !== 'sheets' || answer.locale !== locale || !Array.isArray(answer.sheets)) return null;
  return answer.sheets.every((sheet) => isRecord(sheet) && !('filledRange' in sheet)) && isUint32(answer.revision) ? answer.revision : null;
}

export const loadRequest = (): StoreCall => ({ route: 'read', request: { kind: 'load' } });

export const loadAtRevisionRequest = (revision: number): StoreCall => ({ route: 'read', request: { kind: 'loadAtRevision', revision } });

export function readBusyFor(outcome: StoreOutcome): { busyForMs: number } | null {
  const failure = classifyStoreFailure(outcome);
  return failure?.saveOutcome === 'refusedForNow' ? { busyForMs: failure.busyForMs ?? 0 } : null;
}

export function readLoadedOps(outcome: StoreOutcome): LoadOutcome {
  if (classifyStoreFailure(outcome)?.saveOutcome === 'pageOutOfDate') return 'pageOutOfDate';
  const busy = readBusyFor(outcome);
  if (busy !== null) return busy;
  const answer = answerOf(outcome);
  if (answer?.kind !== 'loadPage') return null;
  const { revision, v, ops } = answer;
  return isUint32(revision) && isUint32(v) && Array.isArray(ops) ? { revision, v, ops } : null;
}

export const askRevisionRequest = (): StoreCall => ({ route: 'read', request: { kind: 'snapshot' } });

export function readAskedRevision(outcome: StoreOutcome): number | 'notSent' | null {
  if (outcome.kind === 'notSent') return 'notSent';
  const answer = answerOf(outcome);
  return answer?.phase === 'snapshot' && isUint32(answer.revision) ? answer.revision : null;
}

export const widgetProjectionRequest = (id: string): StoreCall => ({ route: 'widget', request: { verb: 'projection', id } });

export function readCompiledWidget(outcome: StoreOutcome): CompiledWidget {
  if (outcome.kind === 'mayNotHaveArrived') return { kind: 'noAnswer' };
  if (outcome.kind === 'notSent') return { kind: 'notSent' };
  const answer = outcome.answer;
  if (answer.kind === 'projection' && typeof answer.module === 'string') return { kind: 'compiled', artifact: answer.module };
  const refusal = refusalOf(outcome);
  if (refusal === 'unpublished' || refusal === 'notAWidget' || refusal === 'unknownWidget') return { kind: 'notPublished' };
  if (refusal === 'compileFailed') return { kind: 'notCompiled' };
  return { kind: refusal === 'compileBusy' ? 'busy' : 'refused' };
}

export const storeFailure = (cause: FailureCause, whyRefused: WhyRefused = null): Omit<StoreFailure, 'word'> => ({ cause, saveOutcome: 'refused', whyRefused });

export const PAGE_OUT_OF_DATE_FAILURES: ReadonlyMap<string, Omit<StoreFailure, 'word'>> = new Map([
  ['formatVersionNoLongerTaken', { cause: 'pageBehind', saveOutcome: 'pageOutOfDate' }],
  ['pageIsBehind', { cause: 'pageBehind', saveOutcome: 'pageOutOfDate' }],
]);

export const ENGINE_REFUSAL_FAILURES: ReadonlyMap<string, Omit<StoreFailure, 'word'>> = new Map([
  ['unknownFormatVersion', storeFailure('storeBehind', 'notTakenForNow')],
  ['unknownReadKind', storeFailure('storeBehind')],
  ['unknownLoadForm', storeFailure('storeBehind')],
  ['unreadableEdit', storeFailure('requestUnreadable')],
  ['formatVersionDoesNotFitOperations', storeFailure('requestUnreadable')],
  ['unreadableRead', storeFailure('requestUnreadable')],
  ['unreadableRequest', storeFailure('requestUnreadable')],
]);

export const STORE_REFUSAL_FAILURES: ReadonlyMap<string, Omit<StoreFailure, 'word'>> = new Map([
  ['notWriter', storeFailure('refused', 'readOnly')],
  ['tooLarge', storeFailure('refused', 'tooLargeForOneEdit')],
  ['internal', storeFailure('storeFailed')],
  ['unavailable', { cause: 'storeFailed', saveOutcome: 'mayNotHaveArrived' }],
]);

export const FAILURE_CAUSE_WORDS: Record<FailureCause, string> = {
  storeBehind: 'store_behind',
  pageBehind: 'page_behind',
  requestUnreadable: 'request_unreadable',
  refused: 'refused',
  storeFailed: 'store_failed',
  noAnswer: 'no_answer',
  tookTooLong: 'took_too_long',
  pageFailed: 'page_failed',
};
