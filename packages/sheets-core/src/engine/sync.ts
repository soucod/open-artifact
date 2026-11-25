/**
 * A session's own requests: operations applied directly, and the syncing of a
 * workbook with the server (edits queued, sent and confirmed, others' edits
 * streamed in, the workbook loaded page by page), with the history reads the
 * server makes. Reads (`reads.ts`) are taken by every session.
 *
 * A session is direct until its first request of syncing (any but `load`,
 * `apply`, `undo`, `replay`, the reads and the history reads); from then on it
 * syncs, and those four are refused (`syncInUse`).
 */

import type { CellAt, ColumnId, IdRun, PlaceChanged, RowId, SheetId } from './ids.ts';
import type { Op, RecordedEdit } from './ops.ts';
import type { Edit, OtherAnswerToAnEdit, TextThatNoCellShows } from './edits.ts';
import type { PackedReadKinds } from './packed.ts';
import type { CellContents, ReadKinds } from './reads.ts';
import type { Fault, Refused, StopReason } from './refusals.ts';

// ---------------------------------------------------------------------------
// A direct session
// ---------------------------------------------------------------------------

/** Operations loaded as the workbook's start: nothing they delete is kept to undelete. */
export interface LoadRequest {
  kind: 'load';
  ops: Op[];
}

export interface LoadedAnswer {
  kind: 'loaded';
}

/** Operations applied to the workbook. */
export interface ApplyRequest {
  kind: 'apply';
  ops: Op[];
}

/** Operations taken back by their reverse, refused where what they did is no longer so (`changedSince`). */
export interface UndoRequest {
  kind: 'undo';
  ops: Op[];
  reverse: Op[];
}

/** A recorded edit applied again, its format version read first. */
export interface ReplayRequest {
  kind: 'replay';
  edit: RecordedEdit;
}

/** Operations applied, and the operations that take them back. */
export interface AppliedAnswer {
  kind: 'applied';
  reverse: Op[];
}

// ---------------------------------------------------------------------------
// What a synced session tells
// ---------------------------------------------------------------------------

/** The cells, layouts and views a page shows again. */
export type Changes =
  | { kind: 'everything' }
  | { kind: 'nothing' }
  | {
      kind: 'inSheets';
      sheets: SheetChanges[];
      /**
       * Views whose inputs read cells changed, or have a sheet whose lines changed; and interactive
       * views whose inputs have a sheet whose formats or widths changed.
       */
      views?: string[];
      isTimeZoneChanged?: true;
    };

/** What changed on one sheet. */
export interface SheetChanges {
  sheetId: SheetId;
  /** Cells whose contents or values changed: those of deleted rows and columns last. */
  cells: CellAt[];
  /** Rows or columns inserted, deleted, moved, sized, hidden, grouped, frozen, merged… */
  isLayoutChanged: boolean;
  /** What the conditional formats give may have changed. */
  areFormatsGivenChanged?: true;
}

/** An edit as it is sent to the server. */
export interface SendEditStep {
  kind: 'sendEdit';
  opId: string;
  /** The op id of the request the edit is part of, when it made several edits. */
  actionId?: string;
  recordedEdit: RecordedEdit;
}

/** What the page does next. `null`: nothing until something is received or queued. */
export type NextStep =
  | null
  | { kind: 'stop'; reason: StopReason }
  /** Fetch the page of edits starting at a revision, and give it with `receiveLoadPage` (or `receiveLinesOfLoad`). */
  | { kind: 'fetchLoadPage'; from: number; isRepeat: boolean }
  | SendEditStep;

/** An edit of another streamed in, and the place it changed on a sheet shown. */
export interface EditOfAnother {
  revision: number;
  placeChanged: PlaceChanged | null;
}

/** Where syncing stands, after the request answered. */
export interface SyncState {
  /** The newest revision the workbook has with every edit of it confirmed. */
  confirmedRevision: number;
  /** Whether the workbook has been loaded up to the server's revision once. */
  isLoaded: boolean;
  changes: Changes;
  /** Formulas wait to be worked out with `calculate` (after `answerBeforeCalculating`). */
  calculation?: 'unfinished';
  nextStep: NextStep;
  /** Edits of the page's own dropped: refused by the server, or no longer applying. */
  droppedOpIds: string[];
  /** Edits of the page's own the server saved. */
  confirmedOpIds: string[];
  /** Edits queued and not yet confirmed. */
  unconfirmedCount: number;
  /** Edits queued the server has not answered about. */
  unacknowledgedCount: number;
  fault?: Fault;
  editsOfOthers?: EditOfAnother[];
}

/** The answer to a request of syncing that queues nothing. */
export interface SyncStateAnswer extends SyncState {
  kind: 'syncState';
}

// ---------------------------------------------------------------------------
// Syncing: what the page hears
// ---------------------------------------------------------------------------

/** Tells formulas are to be worked out only with `calculate`: answers come before them. */
export interface AnswerBeforeCalculatingRequest {
  kind: 'answerBeforeCalculating';
}

/** Works out the formulas waiting. */
export interface CalculateRequest {
  kind: 'calculate';
}

/** The newest revision the server has: ahead of the confirmed one, the workbook is loaded afresh. */
export interface ReceiveServerRevisionRequest {
  kind: 'receiveServerRevision';
  revision: number;
}

/** What the clock reads, for NOW, TODAY and days counted from today. */
export interface ReceiveClockReadingRequest {
  kind: 'receiveClockReading';
  unixMilliseconds: number;
  /** -1080 to 1080. */
  utcOffsetInMinutes: number;
  /** The browser's time zone, by its name. */
  timeZone?: string | null;
}

/** A page of the server's edits, as `fetchLoadPage` asked. */
export interface ReceiveLoadPageRequest {
  kind: 'receiveLoadPage';
  from: number;
  /** The revision the page brings the workbook to. */
  revision: number;
  /** The format version the operations are written in. */
  v: number;
  /** Operations as written in that version. */
  ops: unknown[];
  /** Where the next page starts; `null`: this is the last. */
  next: number | null;
}

/**
 * A page of the load written as lines of a snapshot (one JSON piece to a line)
 * rather than as operations. The first page starts with the workbook's piece
 * and the last ends with the end piece; a load is read one way or the other
 * throughout, and a page that does not read stops the session (`unreadableLoad`).
 */
export interface ReceiveLinesOfLoadRequest {
  kind: 'receiveLinesOfLoad';
  from: number;
  revision: number;
  /** The format version of the load; the lines carry their own, so it is not read. */
  v: number;
  lines: string;
  next: number | null;
}

/** An edit as the server streams it. */
export interface StreamedEdit {
  /** Who made it, as the server tells. */
  node: unknown;
  v: number;
  base: number;
  /** Operations as written in version `v`. */
  ops: unknown[];
}

/** An edit another made, streamed in at a revision. */
export interface ReceiveStreamedEditRequest {
  kind: 'receiveStreamedEdit';
  revision: number;
  applied: StreamedEdit;
}

/** What the server did with an edit sent. */
export type SendOutcome = { kind: 'saved'; revision: number } | { kind: 'refused' };

export interface ReceiveSendOutcomeRequest {
  kind: 'receiveSendOutcome';
  opId: string;
  outcome: SendOutcome;
}

// ---------------------------------------------------------------------------
// Syncing: edits queued
// ---------------------------------------------------------------------------

/** An edit made first, as part of the one queued. */
export interface EditBefore {
  edit: Edit;
  /** Whether the place it changes is told (`placesChangedBefore`). */
  isPointedAt: boolean;
  /** 8 to 16 small letters and digits. */
  newIdCode: string;
}

/** An edit made after the one queued, when it can be. */
export interface EditAlong {
  edit: Edit;
  /** 8 to 16 small letters and digits. */
  newIdCode: string;
}

/** A person's edit, worked out into operations on the workbook shown and queued to be sent. */
export interface QueueEditRequest {
  kind: 'queueEdit';
  /** Unique among the edits queued and confirmed. */
  opId: string;
  /** 8 to 16 small letters and digits, from which the ids of rows, columns and sheets made are drawn. */
  newIdCode: string;
  edit: Edit;
  /** Texts no cell shows that the person has been shown (`toBeShownFirst`). */
  shownToThePerson?: TextThatNoCellShows[] | null;
  /** Adopted as the workbook's time zone by an edit that needs one, when it has none. */
  timeZoneOfTheBrowser?: string | null;
  editsBefore?: EditBefore[];
  editsThatGoAlong?: EditAlong[];
  /**
   * The sheet whose columns the edit widens where they are too narrow for the
   * numbers it gives a pattern (`formatCells` with a number format), as a part
   * of the same edit. Undo and redo tell the cells formatted, not the widths.
   */
  makesRoomForNumbersIn?: SheetId | null;
  /**
   * The order the person sees the sheet's rows in, when they have sorted them
   * for themselves: fills, pastes and borders on that sheet are made in it.
   * A row named twice is refused (`rowNamedTwice`), and so is a fill or paste
   * that would move a formula reading another row by a relative row across the
   * places the order changes (`formulaReadsAnotherRow`).
   */
  ownRowOrder?: { sheetId: SheetId; rows: IdRun[] } | null;
}

/** What became of an edit that goes along. */
export type WentAlong =
  | { kind: 'made'; placeChanged: PlaceChanged | null }
  | { kind: 'nothingToChange' }
  /** `refusal`: `null` when the edit was answered otherwise than refused (`toBeShownFirst`). */
  | { kind: 'leftOut'; refusal: string | null };

/** An edit queued: the place it changed, and where syncing stands. */
export interface EditQueuedAnswer {
  kind: 'editQueued';
  placeChanged: PlaceChanged | null;
  /** The places the edits before it pointed at changed. */
  placesChangedBefore?: PlaceChanged[];
  editsThatWentAlong?: WentAlong[];
  syncState: SyncState;
}

/** The edit changes nothing: nothing is queued. */
export interface NothingToChangeAnswer {
  kind: 'nothingToChange';
}

/** An edit before the one queued is refused (by its index): nothing is queued. */
export interface EditBeforeRefusedAnswer {
  kind: 'editBeforeRefused';
  index: number;
  refusal: string;
}

export type QueueEditAnswer =
  | EditQueuedAnswer
  | NothingToChangeAnswer
  | EditBeforeRefusedAnswer
  | OtherAnswerToAnEdit
  | Refused;

/** The page's own last step taken back. */
export interface QueueNextUndoRequest {
  kind: 'queueNextUndo';
  opId: string;
}

/** The page's own last step taken back made again. */
export interface QueueNextRedoRequest {
  kind: 'queueNextRedo';
  opId: string;
}

/** A step taken back or made again, queued. */
export interface StepReversedAnswer {
  kind: 'editQueued';
  placeChanged: PlaceChanged | null;
  placesChangedBefore?: PlaceChanged[];
  /** The step's name. */
  stepReversed: string;
  syncState: SyncState;
}

export interface NothingToReverseAnswer {
  kind: 'nothingToReverse';
}

/** The sheet whose name is in the way of a step taken back. */
export type SheetNameInTheWay =
  /** Of a sheet the step names: the sheet's name that takes it. */
  | { kind: 'ofSheetToName'; takenBy: string }
  /** Of a sheet the step brings back. */
  | { kind: 'ofSheetToBringBack' };

/** The step can never be taken back: it is left out of the history. */
export interface StepGivenUpAnswer {
  kind: 'stepGivenUp';
  refusal: string;
  sheetNameInTheWay: SheetNameInTheWay | null;
}

export type QueueReverseAnswer = StepReversedAnswer | NothingToReverseAnswer | StepGivenUpAnswer | Refused;

/** The edits `editsThatTakeBackAllSince` or `editsThatUndo` answered, queued as one step. */
export interface QueueEditsThatTakeBackRequest {
  kind: 'queueEditsThatTakeBack';
  opId: string;
  /** The confirmed revision they were built on: refused (`builtOnAnotherRevision`) if it is not, or edits are queued. */
  builtOnRevision: number;
  edits: RecordedEdit[];
}

export type QueueEditsThatTakeBackAnswer = EditQueuedAnswer | NothingToChangeAnswer | Refused;

// ---------------------------------------------------------------------------
// History reads (a direct session at the newest revision)
// ---------------------------------------------------------------------------

/** An edit as the server keeps it: its operations, and the reverse applying them answered. */
export interface KeptEdit {
  ops: Op[];
  reverse: Op[];
}

/** The edits that take back every edit since a revision (given in order). */
export interface EditsThatTakeBackAllSinceRequest {
  kind: 'editsThatTakeBackAllSince';
  edits: KeptEdit[];
}

/** The edits that take back the edits picked (given in revision order). */
export interface EditsThatUndoRequest {
  kind: 'editsThatUndo';
  edits: KeptEdit[];
}

/** The edits to queue (`queueEditsThatTakeBack`), built on the revision now. */
export interface EditsThatTakeBackAnswer {
  kind: 'editsThatTakeBack';
  edits: RecordedEdit[];
}

/** The changes to a cell, from the edits given (one for each revision, oldest first). */
export interface HistoryOfACellRequest {
  kind: 'historyOfACell';
  sheetId: SheetId;
  cell: CellAt;
  edits: RecordedEdit[];
}

/** The changes to the cells of a row, from the edits given. */
export interface HistoryOfARowRequest {
  kind: 'historyOfARow';
  sheetId: SheetId;
  r: RowId;
  edits: RecordedEdit[];
}

/** What a cell held after an edit; no `content`: emptied. */
export interface ChangeToACell {
  revision: number;
  content?: CellContents;
}

/** What a row's cells held after an edit. */
export interface ChangeToARow {
  revision: number;
  cells: { c: ColumnId; content?: CellContents }[];
}

/** Newest first, at most 50. */
export interface HistoryOfACellAnswer {
  kind: 'historyOfACell';
  changes: ChangeToACell[];
  areEarlierLeftOut: boolean;
}

export interface HistoryOfARowAnswer {
  kind: 'historyOfARow';
  changes: ChangeToARow[];
  areEarlierLeftOut: boolean;
}

// ---------------------------------------------------------------------------
// Every request of a session
// ---------------------------------------------------------------------------

/** Each kind of session request, with what it takes and the answer it gets (refusals aside, where not listed). */
export interface SessionKinds extends ReadKinds, PackedReadKinds {
  load: { request: LoadRequest; answer: LoadedAnswer };
  apply: { request: ApplyRequest; answer: AppliedAnswer };
  undo: { request: UndoRequest; answer: AppliedAnswer };
  replay: { request: ReplayRequest; answer: AppliedAnswer };
  answerBeforeCalculating: { request: AnswerBeforeCalculatingRequest; answer: SyncStateAnswer };
  calculate: { request: CalculateRequest; answer: SyncStateAnswer };
  receiveServerRevision: { request: ReceiveServerRevisionRequest; answer: SyncStateAnswer };
  receiveClockReading: { request: ReceiveClockReadingRequest; answer: SyncStateAnswer };
  receiveLoadPage: { request: ReceiveLoadPageRequest; answer: SyncStateAnswer };
  receiveLinesOfLoad: { request: ReceiveLinesOfLoadRequest; answer: SyncStateAnswer };
  receiveStreamedEdit: { request: ReceiveStreamedEditRequest; answer: SyncStateAnswer };
  receiveSendOutcome: { request: ReceiveSendOutcomeRequest; answer: SyncStateAnswer };
  queueEdit: { request: QueueEditRequest; answer: QueueEditAnswer };
  queueNextUndo: { request: QueueNextUndoRequest; answer: QueueReverseAnswer };
  queueNextRedo: { request: QueueNextRedoRequest; answer: QueueReverseAnswer };
  queueEditsThatTakeBack: { request: QueueEditsThatTakeBackRequest; answer: QueueEditsThatTakeBackAnswer };
  editsThatTakeBackAllSince: { request: EditsThatTakeBackAllSinceRequest; answer: EditsThatTakeBackAnswer };
  editsThatUndo: { request: EditsThatUndoRequest; answer: EditsThatTakeBackAnswer };
  historyOfACell: { request: HistoryOfACellRequest; answer: HistoryOfACellAnswer };
  historyOfARow: { request: HistoryOfARowRequest; answer: HistoryOfARowAnswer };
}

export type SessionKind = keyof SessionKinds;

/** Any request a session takes. */
export type SessionRequest = { [K in SessionKind]: SessionKinds[K]['request'] }[SessionKind];

/** The answer a request of this kind gets. Any request may be refused (`unreadableRequest` at least). */
export type SessionAnswer<K extends SessionKind = SessionKind> = SessionKinds[K]['answer'] | Refused;
