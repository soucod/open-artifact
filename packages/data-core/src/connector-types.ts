import type {
  Dataset,
  DatasetRun,
  FailedRun,
  JsonValue,
  LoadWording,
  Parameters,
  QueryRule,
  QuerySource,
  ResultMetadata,
  Row,
  SqlQuoteMode,
  Table,
  UnfilledAs,
  UnknownRecord,
  WordedMessage,
} from './types.ts';

export interface SqlToolSpec {
  sqlArg: string;
  quotes?: SqlQuoteMode;
}

/** A connector whose query tools are known: which argument holds SQL, and how its answers are read. */
export interface QueryConnector {
  query: Record<string, Partial<SqlToolSpec>>;
  reads?: 'governed' | 'bigquery';
}

export interface FilledArguments {
  args: string;
  unfilled?: string;
  unfilledAs?: UnfilledAs;
}

/** What is wrong with a `kind: "call"` source's filters. */
export interface RuleProblem {
  filter: string;
  what: 'filter_without_rule' | 'rule_unreadable';
  /** Why the rule's pattern can't be used. */
  problem?: string;
}

/** A filter's rule as the `kind: "call"` engine reads it. */
export type ArgumentRule = QueryRule;

/** What a call got back. */
export type ToolCallGot =
  | { kind: 'rows'; n: number }
  | { kind: 'text' }
  | { kind: 'nothing' }
  | { kind: 'plain'; type: string }
  | { kind: 'keys'; keys: string[] }
  | { kind: 'failed' };

export interface ToolCall {
  tool: string;
  n: number;
  ms: number;
  ok: boolean;
  got: ToolCallGot;
  /** A call that only waited on a running query. */
  poll?: true;
}

export interface ToolContent {
  type?: string;
  text?: unknown;
}

export interface McpToolResult {
  isError?: boolean;
  payload?: unknown;
  structuredContent?: unknown;
  content?: ToolContent[];
  cache?: { storedAt?: unknown };
  [field: string]: unknown;
}

export interface CachedToolResult {
  result: McpToolResult;
  at: number;
}

export interface CachePolicy {
  gcTime: number;
  /** Within this age a cached answer is used as is. */
  staleTime?: number;
  /** Ask the host for a fresh answer even when one is cached. */
  refresh?: true;
}

export interface ToolCallOptions {
  cache: CachePolicy;
}

export interface McpError {
  code: string;
  message: string;
}

export interface ReaderError {
  error: string;
  wording?: LoadWording;
  meta?: ResultMetadata[];
  quoted?: boolean;
  pageCode?: boolean;
  /** The query outlived its wait. */
  timedOut?: boolean;
  /** The service said to try again. */
  busy?: boolean;
  answer?: unknown;
}

export type ConnectorAnswer = { table: Table } | { value: JsonValue; meta?: unknown } | ReaderError;
export type PollAnswer = { value: unknown } | ReaderError;

export interface ReaderContext {
  args: UnknownRecord;
  call(tool: string, args: UnknownRecord): Promise<PollAnswer>;
  stale(): boolean;
  unwrapped?: boolean;
  /** The clock a reader's polling waits on; the real one when left out. */
  clock?: PollClock;
}

export type ResultReader = (
  input: unknown,
  context: ReaderContext,
) => ConnectorAnswer | null | Promise<ConnectorAnswer | null>;

export type ReaderKind = 'bigquery' | 'governed' | 'snowflake' | 'databricks';

export interface BigQueryJob {
  jobId: string;
  location: string;
}

export type BigQueryAnswer = ConnectorAnswer | { pending: BigQueryJob };

export interface SchemaField {
  name: string;
  type: string;
}

export type SchemaRow = unknown[] | UnknownRecord;
export type SchemaRowReader = (input: unknown) => SchemaRow | null;

export interface LoaderRows {
  data: Row[];
  columns: string[];
  /** The service sent only part of the rows. */
  truncated: boolean;
  /** The older name of `truncated` (an accessor over it). */
  cut: boolean;
  meta: ResultMetadata[];
}

export type LoaderResultReaders = Readonly<Record<ReaderKind, (input: unknown) => Promise<LoaderRows>>>;

export type LoaderToolCaller = (tool: string, args?: unknown, options?: unknown) => Promise<unknown>;

export interface LoaderContext {
  answer: unknown;
  /** Each text item of the answer, parsed. */
  readonly items: unknown[];
  call: LoaderToolCaller;
  args: UnknownRecord;
  read: LoaderResultReaders;
}

export interface DatasetLoader {
  fn(context: LoaderContext): unknown | Promise<unknown>;
  description?: string;
  code?: string;
}

export interface ToolCaller {
  call(tool: string, args: UnknownRecord, options?: ToolCallOptions, poll?: boolean): Promise<McpToolResult>;
}

export interface LoadSuccess {
  ok: true;
  table: Table;
  value?: JsonValue;
  ms: number;
  bytes?: number;
  calls?: ToolCall[];
  /** When a cached answer was stored. */
  at?: number;
  /** A cached answer whose loader still made a live call. */
  fetched?: true;
  items?: number;
}

export interface LoadFailure {
  ok: false;
  kind: FailedRun['status'];
  message: string;
  wording?: LoadWording;
  /** The message shown when the failure repeats. */
  again?: WordedMessage;
  off?: boolean;
  quoted?: boolean;
  pageCode?: boolean;
  timedOut?: boolean;
  busy?: boolean;
  unanswered?: boolean;
  /** The connector is crowded: the store waits longer before trying again. */
  crowded?: true;
  answer?: JsonValue;
  meta?: ResultMetadata[];
  calls?: ToolCall[];
}

export type LoadResult = LoadSuccess | LoadFailure;

export interface ExecuteQueryOptions {
  onCached?(result: LoadSuccess, at: number): void;
  reuse?: { ms: number; refresh: boolean };
}

/** A stored data file's text, before it is parsed. */
export interface FetchedDataFile {
  text: string;
  bytes: number;
}

/** How a limited run ended: "busy" backs the limiter off, "ok" grows it. */
export type LimiterOutcome = 'ok' | 'busy' | 'other';

export interface AdaptiveLimiter {
  readonly idle: boolean;
  /** The first call to a tool goes in at once, past the queue. */
  enter(): Promise<void>;
  /** Waits for a slot; `front` queues first. */
  acquire(front?: boolean): Promise<void>;
  release(outcome: LimiterOutcome): void;
}

export interface BusyRetryResult<T> {
  result: T;
  outcome: 'busy' | 'other';
}

/** Time for the limiter and the poll gate: injectable so tests need no real waiting. */
export interface PollClock {
  now(): number;
  sleep(ms: number): Promise<void>;
  random(): number;
}

export type ConnectionFix = 'allow' | 'reconnect' | 'add' | 'choose' | 'turnOn';

export interface CalculationReport {
  id: string;
  inputs: string[];
  code: string;
  title: string;
  description: string;
  status: 'ok' | 'error' | 'loading';
  result: JsonValue | undefined;
  error: string;
  cantRun?: LoadWording;
  at: number;
}

export type GetRun = (id: string) => DatasetRun;
export type GetDataset = (id: string) => Dataset | undefined;

export interface DatasetLoadContext {
  onCached?: (result: LoadResult, at: number) => void;
  reuse?: { ms: number; refresh: boolean };
}

export type LoadLimit = (load: () => Promise<LoadResult>) => Promise<LoadResult>;

export type LoadDataset = (
  dataset: Dataset,
  isStale: () => boolean,
  context: DatasetLoadContext,
  limit: LoadLimit,
) => Promise<LoadResult>;

export interface DatasetStatus {
  tone: 'ok' | 'bad' | 'busy' | 'warn';
  status: string;
  /** The same status worded for a screen reader. */
  heard: string;
}

export interface AttributedError {
  by: string;
  said: string;
}

export interface DatasetNotice {
  text: string;
  why?: AttributedError;
  said?: string;
  fix?: { connector: string; fix: ConnectionFix };
  tool?: string;
  ask?: true;
  retry?: 'refresh';
}

export interface FailedDataset {
  ds: Dataset;
  run: FailedRun;
}

export interface CalculationWait {
  id: string;
  failed: boolean;
}

export interface CalculationResolution {
  run: DatasetRun;
  waits: CalculationWait[];
}

export interface CalculationInput extends CalculationResolution {
  id: string;
  ds: Dataset | undefined;
}

export type CalculationData =
  | { status: 'ok'; value: unknown; message: '' }
  | { status: 'error'; value: null; message: string }
  | { status: 'loading'; value: null; message: '' };

export type CalculationFunction = (...inputs: unknown[]) => unknown;

export interface CalculationResult {
  data: CalculationData;
  cantRun?: LoadWording;
  copy?: unknown;
}

export interface CalculationDefinition {
  inputs: string[];
  fn: CalculationFunction | null;
  code: string;
  title: string;
  description: string;
}

export interface CalculationContext {
  now?: () => number;
  has(id: string): boolean;
  input(id: string): {
    status: 'ok' | 'loading' | 'missing' | 'error' | 'connect' | 'declined';
    rows: unknown[];
    /** What a source holds when it isn't rows. */
    value?: unknown;
  };
  stateOf(id: string): unknown[];
  post(report: CalculationReport): void;
  params(): Parameters;
}

export interface CalculationEngine {
  define(id: unknown, options: unknown): void;
  data(id: string): CalculationData;
  params(): Parameters;
  under(id: string): string[] | undefined;
  ids(): Iterable<string>;
}

export interface DashboardNotice {
  text: string;
  away?: boolean;
  quiet?: boolean;
  ask?: Dataset[];
  fix?: { connector: string; fix: ConnectionFix };
}

export interface ToolbarTextContext {
  loading: 'again' | 'first' | null;
  loadingNow: number;
  updatedAt: number | null;
  now: number;
}

export interface ExecutableQuery extends QuerySource {
  unfilled?: string;
}

export interface LoaderOutputEnvelope extends UnknownRecord {
  data: unknown;
  columns?: unknown;
  truncated?: unknown;
  cut?: unknown;
  meta?: unknown;
}

export interface UnwrappedLoaderOutput {
  result: unknown;
  meta?: unknown;
}

