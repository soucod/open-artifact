/**
 * Making the agent's edits into one logged edit. The workbook is opened in a sync session, as the page opens it
 * (answerBeforeCalculating, the server's revision, one load page); the agent's edits are queued there as the engine's
 * own edits, and each recorded edit the session would send is taken as saved at once. What they recorded, together,
 * is one edit of the log: its operations and the format version they were written in.
 */

import { type ChartHost, chartEdits, type WidgetLookup } from './charts.ts';
import type { EditContext } from './edits.ts';
import { type Engine, type EngineMessage, type EngineSession, isCount, isObject } from './engine.ts';
import { AgentError } from './errors.ts';
import type { WorkbookContents } from './workbook.ts';

/** A save over this many bytes of JSON is refused (a page splits big pastes itself). */
export const MAX_EDIT_BYTES = 8 * 1024 * 1024;

/** Ten letters for the ids an edit makes (sheets, rows, columns): the page's own newIdCode is ten of a–z. */
export function newIdCode(): string {
  let code = '';
  for (const byte of crypto.getRandomValues(new Uint8Array(10))) code += String.fromCharCode(97 + (byte % 26));
  return code;
}

/** The engine's newest format version, and the locale it gives a new workbook. */
export function describeEngine(engine: Engine): { newest: number; localeOfANewWorkbook: string } {
  const described = engine.utility({ kind: 'describeSharedCode' });
  const locales = engine.utility({ kind: 'readLocales' });
  return {
    newest: isCount(described.newestFormatVersion) ? described.newestFormatVersion : 0,
    localeOfANewWorkbook: typeof locales.localeOfANewWorkbook === 'string' ? locales.localeOfANewWorkbook : 'en-US',
  };
}

const oldestVersions = new WeakMap<Engine, number>();

/**
 * The oldest format version the engine takes: a load page in each version, the oldest up, until one is turned away
 * for something other than its version. The engine writes its own edits in it when they fit it, so operations no edit
 * of the engine makes are logged in it too (an edit logged in another version is one the history reads cannot match).
 */
export function oldestFormatVersion(engine: Engine, newest: number): number {
  const known = oldestVersions.get(engine);
  if (known !== undefined) return known;
  let oldest = newest;
  for (let v = 0; v < newest; v++) {
    const session = engine.session();
    try {
      session.answer({ kind: 'answerBeforeCalculating' });
      session.answer({ kind: 'receiveServerRevision', revision: 1 });
      const answer = session.answer({ kind: 'receiveLoadPage', from: 0, revision: 1, v, ops: [], next: null });
      const step = isObject(answer.nextStep) ? answer.nextStep : null;
      const reason = step?.kind === 'stop' ? step.reason : null;
      if (reason !== 'formatVersionNoLongerTaken' && reason !== 'unknownFormatVersion') {
        oldest = v;
        break;
      }
    } finally {
      session.free();
    }
  }
  oldestVersions.set(engine, oldest);
  return oldest;
}

/** A sync-mode session of the workbook after `ops`, told it is at `revision`: the page's own start. */
export function syncSession(engine: Engine, ops: unknown[], revision: number, newest: number): EngineSession {
  const session = engine.session();
  session.answer({ kind: 'answerBeforeCalculating' });
  session.answer({ kind: 'receiveServerRevision', revision });
  if (revision > 0) session.answer({ kind: 'receiveLoadPage', from: 0, revision, v: newest, ops, next: null });
  return session;
}

/** The engine's readWorkbook answer as WorkbookContents, or null when it is not one. */
export function workbookOf(answer: EngineMessage): WorkbookContents | null {
  return answer.kind === 'workbookContents' && Array.isArray(answer.sheets) ? (answer as unknown as WorkbookContents) : null;
}

/**
 * The workbook after `ops`, in a session that applied them (a load leaves deleted rows' and columns' cells out, so
 * they could not be brought back): what a chart read needs where an input's corner was deleted. null when they do not
 * apply.
 */
export function undeleted(engine: Engine, ops: unknown[]): WorkbookContents | null {
  const session = engine.session();
  try {
    if (session.answer({ kind: 'apply', ops }).kind !== 'applied') return null;
    return workbookOf(session.answer({ kind: 'readWorkbook' }));
  } finally {
    session.free();
  }
}

/**
 * The sheets deleted in a log (each edit's operations, in order), the latest first, by the names they had when they
 * were deleted: the workbook is built again edit by edit, and read before each edit that deletes a sheet.
 */
export function deletedSheets(engine: Engine, steps: readonly unknown[][]): { sheetId: string; name: string }[] {
  const deletes = (ops: unknown[]): { sheetId: string }[] =>
    ops.flatMap((op) => (isObject(op) && op.kind === 'deleteSheet' && typeof op.sheetId === 'string' ? [{ sheetId: op.sheetId }] : []));
  if (!steps.some((ops) => deletes(ops).length > 0)) return [];
  const session = engine.session();
  const out: { sheetId: string; name: string }[] = [];
  try {
    for (const ops of steps) {
      const gone = deletes(ops);
      if (gone.length > 0) {
        const sheets = workbookOf(session.answer({ kind: 'readWorkbook' }))?.sheets ?? [];
        for (const op of gone) {
          const sheet = sheets.find((s) => s.sheetId === op.sheetId);
          if (sheet) out.unshift({ sheetId: op.sheetId, name: sheet.name });
        }
      }
      if (ops.length > 0 && session.answer({ kind: 'apply', ops }).kind !== 'applied') break;
    }
  } finally {
    session.free();
  }
  return out;
}

/** What the agent's edits are recorded on: the engine, and the log as it stands. */
export interface RecordingLog {
  engine: Engine;
  /** Each logged edit's operations, in order. */
  steps: readonly unknown[][];
  /** The newest format version the engine takes, and the oldest (what operations of no engine edit are logged in). */
  newest: number;
  oldest: number;
  localeOfANewWorkbook: string;
  widgets: WidgetLookup;
}

/** One edit for the log: its operations and their format version. */
export interface RecordedEdit {
  v: number;
  ops: unknown[];
}

/**
 * Makes edits in a session of the workbook as it stands (`make` queues the engine's own edits, as the page's editor
 * does) and gives the operations they recorded as one edit. A refusal throws an AgentError. Edits that change nothing
 * give null.
 */
export function recordEdits(log: RecordingLog, make: (context: EditContext) => void): RecordedEdit | null {
  const { engine } = log;
  const revision = log.steps.length;
  const before = log.steps.flat();
  let session = syncSession(engine, before, revision, log.newest);
  try {
    const ops: unknown[] = [];
    let version = 0;
    // The revisions the session has seen saved past the log's, and the edits queued.
    let saved = 0;
    let queuedEdits = 0;
    const context: EditContext = {
      read: () => {
        const workbook = workbookOf(session.answer({ kind: 'readWorkbook' }));
        if (!workbook) throw new AgentError('unreadableEdit', 'The engine did not read the workbook back.');
        return { locale: log.localeOfANewWorkbook, ...workbook, revision };
      },
      queue: (edit) => {
        const opId = `edit-${++queuedEdits}`;
        // No shownToThePerson: that is the page's, for a paste it shows the person first (toBeShownFirst). The agent's
        // writes show nothing first, so a formula's own words, in any script and however many, are not asked about.
        const queued = session.answer({ kind: 'queueEdit', opId, newIdCode: newIdCode(), edit });
        if (queued.kind === 'nothingToChange') return queued;
        let step = isObject(queued.syncState) ? queued.syncState.nextStep : null;
        if (queued.kind !== 'editQueued' || !isObject(step) || step.kind !== 'sendEdit' || !isObject(step.recordedEdit)) {
          const code = typeof queued.refusal === 'string' ? queued.refusal : queued.kind === 'toBeShownFirst' ? 'toBeShownFirst' : 'unreadableEdit';
          throw new AgentError(code, `The Sheet refused it: ${code}.`, isObject(queued.data) ? queued.data : {});
        }
        // An edit too large to send whole comes in parts (<opId>.0, <opId>.1, …), each sent once the one before is
        // saved: all of them make the edit.
        while (isObject(step) && step.kind === 'sendEdit' && isObject(step.recordedEdit)) {
          const recorded = step.recordedEdit;
          if (Array.isArray(recorded.ops)) ops.push(...recorded.ops);
          if (isCount(recorded.v)) version = Math.max(version, recorded.v);
          const answer = session.answer({ kind: 'receiveSendOutcome', opId: step.opId, outcome: { kind: 'saved', revision: revision + ++saved } });
          const state = isObject(answer.syncState) ? answer.syncState : answer;
          step = isObject(state.nextStep) ? state.nextStep : null;
        }
        return queued;
      },
      // Operations no edit of the engine makes: checked by a load of everything with them (a load, not an apply: an
      // apply after a load cannot bring a deleted sheet back), then a new sync session that holds them.
      apply: (raw, v = log.oldest) => {
        const check = engine.session();
        try {
          const loaded = check.answer({ kind: 'load', ops: [...before, ...ops, ...raw] });
          if (loaded.kind !== 'loaded') throw new AgentError(String(loaded.refusal ?? 'unreadableEdit'), `The Sheet refused it: ${String(loaded.refusal ?? loaded.kind)}.`);
        } finally {
          check.free();
        }
        ops.push(...raw);
        version = Math.max(version, v);
        saved++;
        session.free();
        session = syncSession(engine, [...before, ...ops], revision + saved, log.newest);
      },
      answer: (request) => session.answer(request),
      utility: (request) => engine.utility(request),
      deletedSheets: () => deletedSheets(engine, [...log.steps, ops]),
    };
    const host: ChartHost = {
      context,
      apply: (raw, v) => context.apply(raw, v),
      widgets: log.widgets,
      undeleted: (more) => undeleted(engine, [...before, ...ops, ...more]),
      newIdCode,
    };
    context.charts = chartEdits(host);
    make(context);
    if (ops.length === 0) return null;
    if (JSON.stringify(ops).length > MAX_EDIT_BYTES) throw new AgentError('editTooLarge', `The edits come to over ${MAX_EDIT_BYTES / 1024 / 1024} MB: send them in parts.`);
    return { v: version, ops };
  } finally {
    session.free();
  }
}

/** A clock reading for the engine (TODAY() and NOW()), in the workbook's time zone. */
export interface ClockReading {
  unixMilliseconds: number;
  utcOffsetInMinutes: number;
  timeZone: string | null;
}

/**
 * Now, in the workbook's time zone: the engine works out TODAY() and NOW() only from a reading that names the
 * workbook's own zone (null for a workbook with none, the offset then being this computer's); a reading in another zone
 * leaves them #N/A.
 */
export function clockReading(timeZone: string | null, now = new Date()): ClockReading {
  let offset = -now.getTimezoneOffset();
  if (timeZone !== null) {
    try {
      // "GMT-06:00", "GMT+05:45", or "GMT" for UTC.
      const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(now).find((p) => p.type === 'timeZoneName')?.value ?? '';
      const m = /^GMT(?:([+-])(\d{1,2}):?(\d{2})?)?$/.exec(name);
      if (m) offset = m[1] ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0)) : 0;
    } catch {
      // An unknown zone keeps this computer's offset.
    }
  }
  return { unixMilliseconds: now.getTime(), utcOffsetInMinutes: offset, timeZone };
}
