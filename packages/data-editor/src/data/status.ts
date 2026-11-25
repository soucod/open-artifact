import {
  getKnownConnector,
  sanitizeSingleLine,
  type AttributedError,
  type CalculationSource,
  type DashboardNotice,
  type Dataset,
  type DatasetNotice,
  type DatasetRun,
  type DatasetStatus,
  type FailedDataset,
  type GetRun,
  type LoadWording,
  type QuerySource,
  type Table,
  type ToolbarTextContext,
} from '@open-artifact/data-core';
import {
  getConnectionFix,
  getLastSuccessfulRun,
  getLiveDatasetConnector,
  getRunTable,
  getTurnedOffConnector,
  isDatasetStale,
  isFailedDatasetRun,
  isPageCodeFailure,
  isRetryableDatasetFailure,
  isTimedOutFailure,
  isUnansweredFailure,
} from './query-store.ts';
import { formatConjunctionList, formatDisjunctionList, joinSentences, truncateSingleLine } from './util.ts';

export const SOURCE_FAILED_MESSAGE = 'This source failed to load.';
export const SINGLE_SOURCE_FAILED_MESSAGE = 'A source failed to load.';
export const SOURCES_FAILED_MESSAGE = 'Sources failed to load.';
export const SOME_SOURCES_FAILED_MESSAGE = 'Some sources failed to load.';
export const QUERY_SLOW_MESSAGE = 'The query is taking longer than usual, so this data didn’t load. Try again in a minute.';
export const DATA_LOAD_FAILED_MESSAGE = 'Failed to load data.';
export const CALCULATION_FAILED_MESSAGE = 'Couldn’t run.';
export const TURN_ON_TO_LOAD_MESSAGE = 'Turn it on to load results.';
export const WITHHELD_RESULT_MESSAGE =
  'Its result isn’t plain data (numbers, text, true or false, null, lists and objects), so it isn’t shown here.';
export const MAX_ERROR_SUMMARY_CHARACTERS = 140;
/** Who said a calculation's error: its own code. */
export const CODE_SOURCE_LABEL = 'Its code';

const decimal = new Intl.NumberFormat('en-US');

function describeConnectorLoadFailure(connectors: string): string {
  return `Couldn’t load from ${connectors}.`;
}

/** A load failure in words: the wording's message, or the message itself when it quotes the service or has no wording. */
export function describeLoadFailure(failure: { message: string; wording?: LoadWording; quoted?: boolean }): string {
  const wording = failure.wording;
  if (wording === undefined || failure.quoted === true) return failure.message;
  switch (wording.code) {
    case 'unasked':
      return `This dashboard needs your permission to use ${wording.connector}.`;
    case 'heldBack':
      return `${wording.connector} still needs your permission. If no dialog opened, reload the whole page to be asked again.`;
    case 'couldnt':
      return describeConnectorLoadFailure(wording.connector);
    case 'turnedOff':
      return `${wording.connector} is turned off for this dashboard.`;
    case 'unchosen':
      return `${wording.connector} is no longer available. Please choose a new connector.`;
    case 'stillUnchosen':
      return `${wording.connector} is no longer available. If no dialog opened, reload the whole page.`;
    case 'noLiveData':
      return 'Live data isn’t available in this view.';
    case 'orgApproval':
      return 'Your organization requires approval for this tool, and this dashboard can’t ask for it yet.';
    case 'toolUnavailable':
      return `This tool isn’t available on ${wording.connector}.`;
    case 'fileNotStored':
      return 'This file isn’t stored in the dashboard, so it can’t be read.';
    case 'fileStatus':
      return `Couldn’t load the file (${wording.status}).`;
    case 'fileFailed':
      return 'Couldn’t load the file.';
    case 'fileNoRows':
      return 'The file has no rows this dashboard can read.';
    case 'savedRowsUnavailable':
      return 'This view has no store, so saved rows can’t be read here.';
    case 'savedRowsSilent':
      return 'The store didn’t answer in time.';
    case 'savedRowsFailed':
      return 'Couldn’t read the saved rows.';
    case 'noConnector':
      return 'This dataset names no connector.';
    case 'notData':
      return `${wording.connector} can’t be queried here. Try another connector.`;
    case 'noTool':
      return 'This dataset names no tool to call.';
    case 'quotedFilter':
      return `This query has {{${wording.filter}}} inside quotes, where it isn’t filled in. Write it outside them: a text value brings its own quotes.`;
    case 'unreadableRules':
      return `The ${wording.filter} filter can’t be used until an editor fixes this query.`;
    case 'ruledOut':
      return `That value doesn’t work for ${wording.filter} here. Try another.`;
    case 'ruledOutUnset':
      return `Pick a value for ${wording.filter}.`;
    case 'noneChosen':
      return `Pick at least one value for ${wording.filter}.`;
    case 'notPlain':
      return `A value for ${wording.filter} can’t contain “${wording.char ?? ''}” here. Try another.`;
    case 'hiddenChar':
      return `A value for ${wording.filter} has a hidden character. Retype it and try again.`;
    case 'oneValue':
      return `Pick just one value for ${wording.filter} here.`;
    case 'wrongTool':
      return `On ${wording.connector} this dashboard can call ${formatDisjunctionList(wording.tools)}, not “${wording.tool}”.`;
    case 'noQuery':
      return 'This dataset has no query yet.';
    case 'resultTooBig':
      return 'This query’s result is too large to load. Ask for less in the query.';
    case 'tookTooLong':
      return 'This query took too long to finish. Try again in a minute.';
    case 'loadThrew':
      return 'Couldn’t load this data.';
    case 'stillRunning':
      return 'The query is still running. Try again in a minute.';
    case 'queryFailed':
      return 'The query failed.';
    case 'queryCanceled':
      return 'The query was canceled.';
    case 'resultNotKept':
      return 'The query’s result is no longer kept.';
    case 'didntFinish':
      return 'The query didn’t finish.';
    case 'notRows':
      return 'The query answered with something other than rows.';
    case 'noJob':
      return 'The query is still running and gave no job to wait on.';
    case 'noStatement':
      return 'The query is still running and gave no statement to wait on.';
    case 'sqlOpenQuote':
      return 'This query can’t run here: it has a quote that never closes.';
    case 'calcGone':
      return `Nothing in this dashboard is called ${formatDisjunctionList(wording.ids)}, so this didn’t run.`;
    case 'calcLoop':
      return wording.ids.length === 1
        ? `${String(wording.ids[0])} uses itself, so it can’t run.`
        : `${formatConjunctionList(wording.ids)} use each other, so they can’t run.`;
    case 'calcInputNotPlain':
      return `What ${formatConjunctionList(wording.ids)} returned isn’t plain data, so this didn’t run.`;
    case 'calcTakesSpec':
      return 'dash.calc takes an id and {inputs, fn, description}.';
  }
}

function describeConnectorUnresponsive(connector: string): string {
  return `${connector} didn’t respond. Try again in a minute.`;
}

/** A quoted error's first sentence on one line, at most 140 characters. */
export function summarizeQuotedError(text: string): string {
  const line = sanitizeSingleLine(text.trim().split('\n', 1)[0]).replace(/[“”]/g, '"');
  const end = /^[{[]/.test(line) ? -1 : line.indexOf('. ');
  return truncateSingleLine(end === -1 ? line : line.slice(0, end + 1), MAX_ERROR_SUMMARY_CHARACTERS);
}

export function formatAttributedError(error: AttributedError): string {
  const quoted = `“${error.said}”`;
  return error.by === CODE_SOURCE_LABEL ? `Its code said: ${quoted}` : `${error.by} said: ${quoted}`;
}

/** A notice's text with what its source said, the quote cut to fit `max` characters. */
export function fitDatasetNotice(notice: DatasetNotice, max: number): string {
  const { text, why } = notice;
  if (why === undefined) return text;
  const withQuote = (said: string): string => joinSentences(text, formatAttributedError({ by: why.by, said }));
  return withQuote(truncateSingleLine(why.said, max - withQuote('').length));
}

function isLiveQueryFailure(dataset: Dataset, run: DatasetRun): boolean {
  return run.status === 'failed' && (dataset.source.kind === 'query' || dataset.source.kind === 'store' || (dataset.source.kind === 'file' && isPageCodeFailure(run)));
}

function getMissingToolHint(source: QuerySource, run: DatasetRun): { tool?: string } {
  return run.status === 'absent' && getKnownConnector(source.connector) === null ? { tool: source.tool } : {};
}

/** What a source's notice says about its run, with the one fix that helps; `null` when nothing is wrong. */
export function getDatasetNotice(dataset: Dataset, run: DatasetRun): DatasetNotice | null {
  const source = dataset.source;
  if (source.kind === 'unsupported') return { text: `This dashboard can’t read “${source.rawKind}” sources.` };
  if (source.kind === 'calc' && source.result === undefined && run.status === 'ok')
    return { text: joinSentences('It ran.', WITHHELD_RESULT_MESSAGE) };
  if (!isFailedDatasetRun(run)) return null;
  const fix = source.kind === 'query' ? getConnectionFix(run) : null;
  if (source.kind === 'query' && fix !== null)
    return { text: describeLoadFailure(run), fix: { connector: source.connector, fix }, ...getMissingToolHint(source, run) };
  const turnedOff = getTurnedOffConnector(run);
  if (turnedOff !== null) return { text: describeLoadFailure(run), fix: { connector: turnedOff, fix: 'turnOn' } };
  if (run.status === 'declined') return { text: describeLoadFailure(run) };
  if (source.kind === 'file' && isPageCodeFailure(run)) return { text: SOURCE_FAILED_MESSAGE, said: describeLoadFailure(run), retry: 'refresh' };
  if (run.status !== 'failed' || source.kind === 'file') return { text: describeLoadFailure(run) };
  if (source.kind === 'store') return { text: describeLoadFailure(run), retry: 'refresh' };
  if (source.kind === 'calc' && run.quoted !== true) return { text: describeLoadFailure(run), ask: true };
  const retry: Pick<DatasetNotice, 'retry'> = isLiveQueryFailure(dataset, run) ? { retry: 'refresh' } : {};
  const ask: Pick<DatasetNotice, 'ask'> = source.kind === 'calc' ? { ask: true } : {};
  const summary = run.quoted === true ? summarizeQuotedError(run.message) : '';
  const message = run.message.trim();
  const said: Pick<DatasetNotice, 'said'> = message === '' || summary === message ? {} : { said: describeLoadFailure(run) };
  const lead = source.kind === 'query' ? DATA_LOAD_FAILED_MESSAGE : CALCULATION_FAILED_MESSAGE;
  if (summary !== '')
    return { text: lead, why: { by: source.kind === 'query' ? source.connector : CODE_SOURCE_LABEL, said: summary }, ...said, ...retry, ...ask };
  if (source.kind !== 'query') return { text: lead, ...said, ...retry, ...ask };
  if (isTimedOutFailure(run)) return { text: QUERY_SLOW_MESSAGE, ...said, ...retry };
  if (isUnansweredFailure(run)) return { text: joinSentences(lead, describeConnectorUnresponsive(source.connector)), ...said, ...retry };
  if (run.wording?.code === 'toolUnavailable') return { text: describeLoadFailure(run), ...retry };
  return { text: SOURCE_FAILED_MESSAGE, ...said, ...retry };
}

function describeConnectionFailures(failed: FailedDataset[]): string {
  const connectors = [...new Set(failed.map((item) => getLiveDatasetConnector(item.ds)))];
  const first = failed[0];
  if (connectors.length < 2 && first !== undefined) return describeLoadFailure(first.run);
  return describeConnectorLoadFailure(formatConjunctionList(connectors));
}

/** Nothing loaded: every source is a calculation or failed without a past result. */
export function hasNothingLoaded(datasets: Dataset[], getRun: GetRun): boolean {
  return datasets.every(
    (dataset) => dataset.source.kind === 'calc' || (isFailedDatasetRun(getRun(dataset.id)) && getLastSuccessfulRun(getRun(dataset.id)) === null),
  );
}

export function getFailedLiveQueries(datasets: Dataset[], getRun: GetRun): Dataset[] {
  return datasets.filter((dataset) => isLiveQueryFailure(dataset, getRun(dataset.id)));
}

/**
 * The dashboard's notice about its sources: a connection to fix (with the fix when every failed query uses one
 * connector), failed sources to retry or ask about, else a quiet note for a declined one.
 */
export function getDashboardNotice(datasets: Dataset[], getRun: GetRun): DashboardNotice | null {
  const failed: FailedDataset[] = datasets.flatMap((dataset) => {
    const run = getRun(dataset.id);
    return dataset.source.kind !== 'calc' && isFailedDatasetRun(run) ? [{ ds: dataset, run }] : [];
  });
  const nothingLoaded = hasNothingLoaded(datasets, getRun);
  const unconnected = failed.filter((item) => item.ds.source.kind === 'query' && getConnectionFix(item.run) !== null);
  const first = unconnected[0];
  if (first !== undefined) {
    const connector = getLiveDatasetConnector(first.ds);
    const fix = getConnectionFix(first.run);
    return {
      text: describeConnectionFailures(unconnected),
      ...(fix !== null && unconnected.every((item) => getLiveDatasetConnector(item.ds) === connector) ? { fix: { connector, fix } } : {}),
    };
  }
  const retryable = failed.filter((item) => isRetryableDatasetFailure(item.run)).length;
  const queries = getFailedLiveQueries(datasets, getRun);
  if (retryable > 0)
    return {
      text: retryable === 1 ? SINGLE_SOURCE_FAILED_MESSAGE : nothingLoaded ? SOURCES_FAILED_MESSAGE : SOME_SOURCES_FAILED_MESSAGE,
      ...(queries.length > 0 ? { ask: queries } : {}),
    };
  const declined = failed.find((item) => getTurnedOffConnector(item.run) !== null) ?? failed[0];
  if (declined === undefined) return null;
  const turnedOff = getTurnedOffConnector(declined.run);
  return turnedOff === null
    ? { text: describeLoadFailure(declined.run), quiet: true }
    : { text: joinSentences(describeLoadFailure(declined.run), TURN_ON_TO_LOAD_MESSAGE), quiet: true, fix: { connector: turnedOff, fix: 'turnOn' } };
}

export function makeDatasetStatus(tone: DatasetStatus['tone'], status: string): DatasetStatus {
  return { tone, status, heard: status };
}

const OK_DATASET_STATUS = makeDatasetStatus('ok', '');
const BUSY_DATASET_STATUS = makeDatasetStatus('busy', '');

function getCalculationStatus(source: CalculationSource): DatasetStatus {
  return source.result === undefined ? makeDatasetStatus('warn', 'Result not shown') : OK_DATASET_STATUS;
}

/** When a source's data is from: a query's or calculation's last successful run, else when it was added. */
export function getDatasetUpdatedAt(dataset: Dataset, run: DatasetRun): number | null {
  if (dataset.source.kind !== 'query' && dataset.source.kind !== 'calc') return dataset.updated?.at ?? null;
  return getLastSuccessfulRun(run)?.at ?? null;
}

/** "first 12 rows only" for a cut table; empty when it isn't cut. */
export function describeTruncatedTable(table: Table | null, capitalized = false): string {
  if (table === null || table.cut === undefined) return '';
  const rows = table.rows.length;
  if (rows === 0) return capitalized ? 'Rows missing' : 'rows missing';
  const text = rows === 1 ? 'first 1 row only' : `first ${decimal.format(rows)} rows only`;
  return capitalized ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function getFailureTone(run: DatasetRun): DatasetStatus['tone'] {
  if (getConnectionFix(run) !== null) return 'warn';
  return run.status === 'declined' ? 'ok' : 'bad';
}

/** "now" is under a minute (59.5 s). */
export function isJustNow(from: number, now: number): boolean {
  return now - from <= 59_500;
}

const RELATIVE_TIME_UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];
const narrowRelative = new Intl.RelativeTimeFormat('en', { numeric: 'always', style: 'narrow' });
const longRelative = new Intl.RelativeTimeFormat('en', { numeric: 'always', style: 'long' });

/** How long ago `from` was: "5m ago", or long: "5 minutes ago". */
export function formatTimeAgo(from: number, now: number, long = false): string {
  const seconds = Math.round((Math.min(from, now) - now) / 1000);
  const distance = Math.abs(seconds);
  if (distance < 60) return long ? 'just now' : narrowRelative.format(0, 'second');
  let unit: Intl.RelativeTimeFormatUnit = 'minute';
  let unitSeconds = 60;
  for (const [stepUnit, stepSeconds] of RELATIVE_TIME_UNITS)
    if (distance >= stepSeconds) {
      unit = stepUnit;
      unitSeconds = stepSeconds;
      break;
    }
  return (long ? longRelative : narrowRelative).format(Math.round(seconds / unitSeconds), unit);
}

export function getFileDatasetStatus(dataset: Dataset, now: number): DatasetStatus {
  const updated = dataset.updated;
  if (updated === null) return makeDatasetStatus('warn', 'Update time not recorded');
  if (!isDatasetStale(dataset, now)) return OK_DATASET_STATUS;
  const by = updated.by !== '' ? updated.by : 'someone';
  if (isJustNow(updated.at, now)) return makeDatasetStatus('warn', `Added now by ${by}, stale`);
  return {
    tone: 'warn',
    status: `Added ${formatTimeAgo(updated.at, now)} by ${by}, stale`,
    heard: `Added ${formatTimeAgo(updated.at, now, true)} by ${by}, stale`,
  };
}

export function getBaseDatasetStatus(dataset: Dataset, run: DatasetRun, now: number): DatasetStatus {
  const source = dataset.source;
  if (source.kind === 'unsupported') return makeDatasetStatus('bad', `This dashboard can’t read “${source.rawKind}” sources`);
  if (run.status === 'running') return BUSY_DATASET_STATUS;
  if (run.status === 'idle' && source.kind !== 'calc') return BUSY_DATASET_STATUS;
  if (run.status !== 'ok' && run.status !== 'idle') return makeDatasetStatus(getFailureTone(run), '');
  if (source.kind === 'calc') return run.status === 'ok' ? getCalculationStatus(source) : OK_DATASET_STATUS;
  return source.kind === 'file' ? getFileDatasetStatus(dataset, now) : OK_DATASET_STATUS;
}

/** A source's status line and tone: busy while it loads, the failure's tone, stale files, cut tables. */
export function getDatasetStatus(dataset: Dataset, run: DatasetRun, now: number): DatasetStatus {
  const base = getBaseDatasetStatus(dataset, run, now);
  const table = getRunTable(run);
  const cut = describeTruncatedTable(table);
  if (cut === '' || base.tone === 'bad' || base.tone === 'busy') return base;
  if (base.status === '') return makeDatasetStatus('warn', describeTruncatedTable(table, true));
  return { tone: 'warn', status: `${base.status}, ${cut}`, heard: `${base.heard}, ${cut}` };
}

/** A source to fix: a connection, a connector turned off, or a bad status. */
export function needsDatasetAttention(dataset: Dataset, run: DatasetRun, now: number): boolean {
  return (
    getConnectionFix(run) !== null || (run.status === 'declined' && run.off === true) || getDatasetStatus(dataset, run, now).tone === 'bad'
  );
}

/** The datasets the page uses (in the order it asked for them), and the rest. */
export function partitionUsedDatasets(datasets: Dataset[], used: Iterable<string>): { used: Dataset[]; unused: Dataset[] } {
  const byId = new Map(datasets.map((dataset) => [dataset.id, dataset]));
  const found: Dataset[] = [];
  for (const id of used) {
    const dataset = byId.get(id);
    if (dataset !== undefined && !found.includes(dataset)) found.push(dataset);
  }
  return { used: found, unused: datasets.filter((dataset) => !found.includes(dataset)) };
}

/** When the oldest of these sources' data is from, and whether any attached file is stale. */
export function getOldestDatasetUpdate(datasets: Dataset[], getRun: GetRun, now: number): { at: number | null; stale: boolean } {
  let oldest: number | null = null;
  let stale = false;
  for (const dataset of datasets) {
    const at = dataset.source.kind !== 'query' ? (dataset.updated?.at ?? null) : (getLastSuccessfulRun(getRun(dataset.id))?.at ?? null);
    if (at !== null && (oldest === null || at < oldest)) oldest = at;
    if (isDatasetStale(dataset, now)) stale = true;
  }
  return { at: oldest, stale };
}

export function getLoadingLabel(context: ToolbarTextContext): string | null {
  if (context.loading === 'again') return 'Refreshing…';
  if (context.loading !== 'first' || context.loadingNow <= 0) return null;
  return context.loadingNow === 1 ? 'Loading 1 source' : `Loading ${decimal.format(context.loadingNow)} sources`;
}

/** "Updated now", "Updated 5 mins ago" under an hour, else "Updated 3 hours ago". */
export function formatUpdatedAgo(at: number, now: number): string {
  if (isJustNow(at, now)) return 'Updated now';
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 60) return minutes === 1 ? 'Updated 1 min ago' : `Updated ${decimal.format(minutes)} mins ago`;
  return `Updated ${formatTimeAgo(at, now, true)}`;
}

/** The toolbar's own words: loading, or when the data was last updated. */
export function getToolbarText(context: ToolbarTextContext): string | null {
  return getLoadingLabel(context) ?? (context.updatedAt !== null ? formatUpdatedAgo(context.updatedAt, context.now) : null);
}
