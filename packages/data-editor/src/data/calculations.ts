import {
  normalizeTable,
  type CalculationInput,
  type CalculationReport,
  type CalculationResolution,
  type CalculationSource,
  type CalculationWait,
  type Dataset,
  type DatasetRun,
  type FailedRun,
  type GetDataset,
  type GetRun,
  type LoadWording,
  type Table,
} from '@open-artifact/data-core';
import { collectDependencies } from './calc-engine.ts';
import { getLastSuccessfulRun, isDatasetStale, isFailedDatasetRun, isRetryableDatasetFailure } from './query-store.ts';
import { joinAlternatives } from './util.ts';

/** "salesByRegion" → "Sales by region". */
export function humanizeIdentifier(id: string): string {
  const words = id
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words === '' ? id : words.charAt(0).toUpperCase() + words.slice(1);
}

const calculationDatasets = new WeakMap<CalculationReport, Dataset>();

/** A calculation's report as a source of the dashboard (`kind: "calc"`). */
export function calculationReportToDataset(report: CalculationReport): Dataset {
  const cached = calculationDatasets.get(report);
  if (cached !== undefined) return cached;
  const { id, title, ...fields } = report;
  const dataset: Dataset = {
    id,
    title: title || humanizeIdentifier(id),
    description: report.description,
    source: { kind: 'calc', ...fields },
    updated: null,
    schedule: '',
    staleAfterHours: null,
  };
  calculationDatasets.set(report, dataset);
  return dataset;
}

/** The datasets with the page's calculations after them (one with a dataset's id is left out). */
export function appendCalculationDatasets(datasets: Dataset[], reports: ReadonlyMap<string, CalculationReport>): Dataset[] {
  if (reports.size === 0) return datasets;
  const ids = new Set(datasets.map((dataset) => dataset.id));
  return [...datasets, ...[...reports.values()].filter((report) => !ids.has(report.id)).map(calculationReportToDataset)];
}

/** A plain value as text: a string as it is, JSON pretty-printed for lists and objects. */
export function formatPlainValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value === null || typeof value !== 'object') return String(value);
  return JSON.stringify(value, null, 2);
}

const countLeadingWhitespace = (line: string): number => line.length - line.trimStart().length;

/** A function's source with the indentation its later lines share removed. */
export function dedentFunctionCode(code: string): string {
  const [first = '', ...rest] = code.split('\n');
  const filled = rest.filter((line) => line.trim() !== '');
  const indent = filled.length === 0 ? 0 : Math.min(...filled.map(countLeadingWhitespace));
  return [first, ...rest.map((line) => line.slice(Math.min(indent, countLeadingWhitespace(line))))].join('\n');
}

const calculationTables = new WeakMap<object, Table | null>();

/** A calculation's result as a table when it is a non-empty list of records. */
export function getCalculationTable(result: unknown): Table | null {
  if (!Array.isArray(result) || result.length === 0) return null;
  const cached = calculationTables.get(result);
  if (cached !== undefined) return cached;
  const table = result.every((item) => typeof item === 'object' && item !== null && !Array.isArray(item)) ? normalizeTable(result) : null;
  calculationTables.set(result, table);
  return table;
}

function getInputUpdatedAt(dataset: Dataset, run: DatasetRun): number | null {
  if (dataset.source.kind === 'file') return dataset.updated?.at ?? getLastSuccessfulRun(run)?.at ?? null;
  return getLastSuccessfulRun(run)?.at ?? null;
}

/** Every source a calculation reads, through the calculations it reads. */
export function collectCalculationInputs(source: CalculationSource, getDataset: GetDataset): Set<string> {
  return collectDependencies(source.inputs, (id) => {
    const inner = getDataset(id)?.source;
    return inner?.kind === 'calc' ? inner.inputs : undefined;
  });
}

function getBlockedCalculationInput({ id, ds, run, waits }: CalculationInput): CalculationWait[] {
  if (ds?.source.kind === 'unsupported') return [{ id, failed: true }];
  if (ds?.source.kind === 'calc')
    return isFailedDatasetRun(run) || waits.length > 0 ? [{ id, failed: isFailedDatasetRun(run) || waits.some((wait) => wait.failed) }] : [];
  return isFailedDatasetRun(run) && getLastSuccessfulRun(run) === null ? [{ id, failed: isRetryableDatasetFailure(run) }] : [];
}

function earliestInputTime(inputs: readonly CalculationInput[], now: number): number | null {
  const hasLiveQuery = inputs.some((input) => input.ds?.source.kind === 'query');
  const relevant = hasLiveQuery
    ? inputs.filter((input) => input.ds !== undefined && (input.ds.source.kind === 'query' || isDatasetStale(input.ds, now)))
    : inputs;
  const pickOldest = (list: readonly CalculationInput[]): number | null => {
    let oldest: number | null = null;
    for (const input of list) {
      const at = input.ds === undefined ? null : getInputUpdatedAt(input.ds, input.run);
      if (at !== null && (oldest === null || at < oldest)) oldest = at;
    }
    return oldest;
  };
  return pickOldest(relevant) ?? (hasLiveQuery ? pickOldest(inputs) : null);
}

function resolveCalculationRun(source: CalculationSource, inputs: CalculationInput[]): CalculationResolution {
  const failure = (message: string, wording?: LoadWording): FailedRun => ({
    status: 'failed',
    message,
    ...(wording === undefined ? {} : { wording }),
    at: source.at,
  });
  if (source.cantRun !== undefined) return { run: failure(source.error, source.cantRun), waits: [] };
  const gone = inputs.filter((input) => input.ds === undefined).map((input) => input.id);
  if (gone.length > 0)
    return {
      run: failure(`Nothing in this dashboard is called ${joinAlternatives(gone)}, so this didn’t run.`, { code: 'calcGone', ids: gone }),
      waits: [],
    };
  const waits = inputs.flatMap(getBlockedCalculationInput);
  if (waits.length > 0) return { run: { status: 'idle' }, waits };
  if (source.status === 'loading' || inputs.some((input) => getLastSuccessfulRun(input.run) === null))
    return { run: { status: 'running', startedAt: source.at, prev: null }, waits };
  if (source.status === 'error') return { run: { ...failure(source.error), quoted: true }, waits };
  const oldest = earliestInputTime(inputs, Date.now());
  return {
    run: { status: 'ok', table: getCalculationTable(source.result) ?? { columns: [], rows: [] }, at: oldest ?? source.at, ms: 0 },
    waits,
  };
}

const PENDING_CALCULATION_RUN: CalculationResolution = { run: { status: 'running', startedAt: 0, prev: null }, waits: [] };

export function resolveCalculationInputs(
  source: CalculationSource,
  getDataset: GetDataset,
  getRun: GetRun,
  seen: Map<CalculationSource, CalculationResolution> = new Map(),
): CalculationResolution {
  const known = seen.get(source);
  if (known !== undefined) return known;
  seen.set(source, PENDING_CALCULATION_RUN);
  const inputs: CalculationInput[] = source.inputs.map((id) => {
    const ds = getDataset(id);
    return {
      id,
      ds,
      ...(ds?.source.kind === 'calc' ? resolveCalculationInputs(ds.source, getDataset, getRun, seen) : { run: getRun(id), waits: [] }),
    };
  });
  const resolution = resolveCalculationRun(source, inputs);
  seen.set(source, resolution);
  return resolution;
}

/** The inputs a calculation waits on (and whether they failed). */
export function getCalculationWaits(source: CalculationSource, getDataset: GetDataset, getRun: GetRun): CalculationWait[] {
  return resolveCalculationInputs(source, getDataset, getRun).waits;
}

/** A calculation's run, from its report and its inputs' runs. */
export function getCalculationRun(source: CalculationSource, getDataset: GetDataset, getRun: GetRun): DatasetRun {
  return resolveCalculationInputs(source, getDataset, getRun).run;
}
