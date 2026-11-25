export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type UnknownRecord = Record<string, unknown>;

export type Cell = JsonPrimitive;
export type Row = Record<string, Cell>;
export type ParameterScalar = Exclude<JsonPrimitive, null>;
export type ParameterValue = JsonPrimitive | ParameterScalar[];
export type Parameters = Record<string, ParameterValue>;

export interface ResultMetadata {
  label: string;
  value: string;
  type?: 'text' | 'code';
  lang?: string;
}

export interface Table {
  columns: string[];
  rows: Row[];
  cut?: 'rows';
  meta?: ResultMetadata[];
}

/** One argument's constraints in a query source's `rules`; a list argument has `type: "array"` and `items`. */
export interface QueryRule {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'array';
  items?: QueryRule;
  minItems?: number;
  maxItems?: number;
  enum?: ParameterScalar[];
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
}

export type UnfilledCode =
  | 'quotedFilter'
  | 'unreadableRules'
  | 'ruledOut'
  | 'ruledOutUnset'
  | 'noneChosen'
  | 'notPlain'
  | 'hiddenChar'
  | 'oneValue';

/** Why a `{{filter}}` could not be filled in; `valued` marks one that depends on the viewer's value. */
export interface UnfilledAs {
  code: UnfilledCode;
  filter: string;
  char?: string;
  valued?: true;
}

export interface QuerySource {
  kind: 'query';
  /** Written `kind: "call"` (filters with rules); absent for the older `kind: "query"`. */
  call?: true;
  connector: string;
  tool: string;
  /** Canonical JSON of the arguments. */
  args: string;
  template?: string;
  problem?: string;
  rules?: Record<string, QueryRule>;
  rulesRefused?: true;
  refusedRules?: unknown;
  values?: Record<string, unknown>;
  unfilledAs?: UnfilledAs;
  unfilled?: string;
}

export type DataFileFormat = 'csv' | 'tsv' | 'json' | 'text';

export interface FileSource {
  kind: 'file';
  url: string;
  name: string;
  /** "text" hands a loader the file's text as it is (no rows without one). */
  format: DataFileFormat;
}

export interface CalculationSource {
  kind: 'calc';
  inputs: string[];
  code?: string;
  description: string;
  status: 'ok' | 'error' | 'loading';
  result: unknown;
  error: string;
  at: number;
  cut?: boolean;
  cantRun?: LoadWording;
  withheld?: string;
}

/** Saved rows: a collection or a document under `data/` that the page writes (see `saved-rows.ts`). */
export interface StoreSource {
  kind: 'store';
  /** As written; `data/users/me/…` is read as the viewer's own. Empty when the path can't hold saved rows. */
  path: string;
}

export interface UnsupportedSource {
  kind: 'unsupported';
  rawKind: string;
}

export type DatasetSource = QuerySource | FileSource | StoreSource | CalculationSource | UnsupportedSource;

export interface ViewerIdentity {
  id: string;
  name: string;
}

export interface UpdateStamp {
  at: number;
  by: string;
}

export interface DatasetLoaderDefinition {
  description: string;
  fn: (...args: unknown[]) => unknown;
  code?: string;
}

export interface Dataset {
  id: string;
  title: string;
  description: string;
  source: DatasetSource;
  updated: UpdateStamp | null;
  schedule: string;
  staleAfterHours: number | null;
  request?: QuerySource;
  loader?: DatasetLoaderDefinition;
  /** A stored file the agent set by hand (`"fixed": true`). */
  fixed?: true;
  /** A query's `langs`: the code language of each argument that is code, lower-cased. */
  langs?: Record<string, string>;
}

export interface DashboardFile {
  name: string;
  text: string;
}

/** How often viewers get fresh data: on each view, or at most every 5 min / hour / day / week. */
export type DashboardUpdates = 'viewed' | '5min' | 'hour' | 'day' | 'week';
/** `dash/settings.updates` as stored: a preset, or a whole number of minutes that matches none. */
export type DashboardUpdateSetting = DashboardUpdates | number;

export interface DashboardContent {
  /** `dash/meta.lang`, or `null` when unset or not a language tag. */
  lang: string | null;
  params: Parameters;
  datasets: Dataset[];
  files: DashboardFile[];
  updates: DashboardUpdateSetting;
  /** `dash/look` as stored; read by `parseDashboardLook`. */
  look?: unknown;
}

export interface IdleRun {
  status: 'idle';
}

export interface OkRun {
  status: 'ok';
  at: number;
  ms?: number;
  table: Table | null;
  bytes?: number;
  value?: JsonValue;
  meta?: ResultMetadata[];
  calls?: unknown[];
  partial?: boolean;
  /** Read back from a cached tool result rather than run now. */
  reused?: true;
  /** How many text items the answer had, when it had several and a bare payload. */
  items?: number;
}

export interface RunningRun {
  status: 'running';
  startedAt: number;
  prev: DatasetRun | null;
  cached?: OkRun;
}

export type FailureStatus = 'connect' | 'declined' | 'reauth' | 'absent' | 'failed' | 'refused' | 'unchosen';

/** What a load failure's message says, so a page can word it in the viewer's language. */
export type LoadWording =
  | {
      code:
        | 'unasked'
        | 'heldBack'
        | 'couldnt'
        | 'unchosen'
        | 'stillUnchosen'
        | 'toolUnavailable'
        | 'turnedOff'
        | 'notData';
      connector: string;
    }
  | {
      code:
        | 'noLiveData'
        | 'orgApproval'
        | 'fileNotStored'
        | 'fileFailed'
        | 'fileNoRows'
        | 'savedRowsUnavailable'
        | 'savedRowsSilent'
        | 'savedRowsFailed'
        | 'noConnector'
        | 'noTool'
        | 'noQuery'
        | 'resultTooBig'
        | 'tookTooLong'
        | 'loadThrew'
        | 'stillRunning'
        | 'queryFailed'
        | 'queryCanceled'
        | 'resultNotKept'
        | 'didntFinish'
        | 'notRows'
        | 'noJob'
        | 'noStatement'
        | 'sqlOpenQuote'
        | 'calcTakesSpec';
    }
  | { code: 'fileStatus'; status: string }
  | {
      code: 'quotedFilter' | 'unreadableRules' | 'ruledOut' | 'ruledOutUnset' | 'noneChosen' | 'hiddenChar' | 'oneValue';
      filter: string;
    }
  | { code: 'notPlain'; filter: string; char?: string }
  | { code: 'wrongTool'; connector: string; tools: string[]; tool: string }
  | { code: 'calcGone' | 'calcLoop' | 'calcInputNotPlain'; ids: string[] };

export interface WordedMessage {
  message: string;
  wording?: LoadWording;
}

export interface FailedRun {
  status: FailureStatus;
  at: number;
  message: string;
  wording?: LoadWording;
  kept?: OkRun;
  quoted?: boolean;
  still?: boolean;
  off?: boolean;
  pageCode?: boolean;
  calls?: unknown[];
  answer?: unknown;
  meta?: ResultMetadata[];
  timedOut?: boolean;
  /** The connector's server didn't answer. */
  unanswered?: boolean;
}

export type DatasetRun = IdleRun | OkRun | RunningRun | FailedRun;

/** Where a marked element's value comes from: a source, and optionally a column and rows. */
export interface SourceAddress {
  source: string;
  field?: string;
  where?: { column: string; value: string }[];
  row?: number;
}

export interface SourceResolution {
  status: 'pending' | 'unresolved' | 'ok';
  kind: 'cells' | 'calc';
  rowIndexes: number[];
  reason?: string;
  table?: Table;
  field?: string;
  cell?: Cell;
}

export type ReaderResult =
  | { table: Table }
  | { value: JsonValue; meta?: ResultMetadata[] }
  | { error: string; meta?: ResultMetadata[]; quoted?: boolean };

export type SqlQuoteMode = 'backslash' | 'doubled' | 'spark';

export interface SqlToken {
  kind: 'word' | 'number' | 'string' | 'name' | 'comment' | 'space' | 'punct' | 'placeholder';
  text: string;
  open?: boolean;
}

/** The per-connector adaptive query limiter: how many queries it starts with and the most it grows to. */
export interface LimiterDefaults {
  start: number;
  ceiling: number;
}

/** The worded ways a query run can fail without a message of its own. */
export type QueryFailureCode =
  | 'tookTooLong'
  | 'stillRunning'
  | 'noJob'
  | 'noStatement'
  | 'queryFailed'
  | 'queryCanceled'
  | 'resultNotKept'
  | 'didntFinish'
  | 'notRows';

export interface QueryFailure {
  error: string;
  wording: { code: QueryFailureCode };
}
