import type {
  DashboardContent,
  DashboardFile,
  DashboardUpdates,
  DashboardUpdateSetting,
  Dataset,
  DatasetSource,
  DataFileFormat,
  LimiterDefaults,
  ParameterScalar,
  ParameterValue,
  Parameters,
  QueryFailure,
  QueryFailureCode,
  QueryRule,
  QuerySource,
  UpdateStamp,
  ViewerIdentity,
} from './types.ts';
import {
  RESERVED_OBJECT_KEYS,
  asRecord,
  getOwnProperty,
  isPlainObject,
  isSafeCount,
  normalizeCodeLanguage,
  normalizeDescription,
  parseBoundedInteger,
  parseEnumValue,
  parseTimestamp,
  sanitizeSingleLine,
  sanitizeText,
} from './text.ts';
import { isValidDashboardFilename, isValidDatasetId } from './paths.ts';
import { isSavedRowsPath } from './saved-rows.ts';
import { DATA_FILE_FORMATS, inferDataFileFormatOrCsv } from './tables.ts';

export const MAX_ERROR_MESSAGE_CHARACTERS = 400;
/** The largest data file the file editor stores. */
export const MAX_DATA_BYTES = 8388608;
/** The most documents one collection (datasets, files) is read with. */
export const MAX_COLLECTION_DOCUMENTS = 1000;
export const PARAMETER_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
export const PARAMETER_CONTROL_CHARACTER_PATTERN = /[\x00-\x1f\x7f\u2028\u2029]/;
/** A stored file's url: `_blob/<32 hex>` (optionally with a leading `/`) or a `blob:` url. */
export const STORED_FILE_URL_PATTERN = /^(\/?_blob\/[0-9a-f]{32}|blob:[^\s"'<>]{1,200})$/;
export const STORED_BLOB_PATH_PATTERN = /^\/?_blob\/[0-9a-f]{32}$/;
export const QUERY_RULE_TYPES: readonly NonNullable<QueryRule['type']>[] = ['string', 'number', 'integer', 'boolean'];
export const PAGE_LANGUAGE_PATTERN = /^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8}){0,3}$/;
/** The language a page is read in unless `dash/meta.lang` names one. */
export const DASHBOARD_ROOT_LANGUAGE = 'en';
export const EMPTY_PARAMS: Parameters = Object.freeze(Object.create(null)) as Parameters;

export const QUERY_FAILURE_MESSAGES: Readonly<Record<QueryFailureCode, string>> = {
  tookTooLong: 'This query took too long to finish. Try again in a minute.',
  stillRunning: 'The query is still running. Try again in a minute.',
  noJob: 'The query is still running and gave no job to wait on.',
  noStatement: 'The query is still running and gave no statement to wait on.',
  queryFailed: 'The query failed.',
  queryCanceled: 'The query was canceled.',
  resultNotKept: 'The query’s result is no longer kept.',
  didntFinish: 'The query didn’t finish.',
  notRows: 'The query answered with something other than rows.',
};
/** How long a query (with its polling) may take in all. */
export const QUERY_TIME_BUDGET_MS = 900000;
export const LIMITER_DEFAULTS: Readonly<LimiterDefaults> = { start: 2, ceiling: 8 };
export const DASHBOARD_UPDATE_INTERVALS: readonly DashboardUpdates[] = ['viewed', '5min', 'hour', 'day', 'week'];
export const UPDATE_INTERVAL_MS: Readonly<Record<DashboardUpdates, number>> = {
  viewed: 0,
  '5min': 300000,
  hour: 3600000,
  day: 86400000,
  week: 604800000,
};

export function queryFailure(code: QueryFailureCode): QueryFailure {
  return { error: QUERY_FAILURE_MESSAGES[code], wording: { code } };
}

/** A failure that quotes the service's own words, or the worded one when it said nothing. */
export function quotedQueryFailure(
  text: string,
  code: QueryFailureCode = 'queryFailed',
): QueryFailure | { error: string; quoted: true } {
  return text.trim() === '' ? queryFailure(code) : { error: text, quoted: true };
}

/** `dash/meta.lang`, trimmed, when it is a plausible language tag; else `null`. */
export function parsePageLanguage(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : value;
  return typeof text === 'string' && PAGE_LANGUAGE_PATTERN.test(text) ? text : null;
}

export function areDashboardFilesEqual(files: readonly DashboardFile[], other: readonly DashboardFile[]): boolean {
  return (
    files === other ||
    (files.length === other.length &&
      files.every((file, index) => file.name === other[index]?.name && file.text === other[index]?.text))
  );
}

function readDashboardFileText(value: unknown): string {
  return sanitizeText(isPlainObject(value) && Object.hasOwn(value, 'text') ? value.text : '');
}

let cachedDashboardFiles: DashboardFile[] = [];

/** The page files of `files/*`, sorted by name; the same array comes back while nothing changed. */
export function parseDashboardFiles(value: unknown): DashboardFile[] {
  const record = asRecord(value);
  const files = Object.keys(record)
    .filter(isValidDashboardFilename)
    .sort()
    .map((name) => ({ name, text: readDashboardFileText(record[name]) }));
  if (areDashboardFilesEqual(files, cachedDashboardFiles)) return cachedDashboardFiles;
  cachedDashboardFiles = files;
  return files;
}

export function isValidParameterName(value: unknown): value is string {
  return typeof value === 'string' && PARAMETER_NAME_PATTERN.test(value) && !RESERVED_OBJECT_KEYS.has(value);
}

export function isParameterScalar(value: unknown): value is ParameterScalar {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return !PARAMETER_CONTROL_CHARACTER_PATTERN.test(value);
  return typeof value === 'boolean';
}

export function parseParameterValue(value: unknown): ParameterValue | undefined {
  if (value === null || isParameterScalar(value)) return value;
  return Array.isArray(value) && value.every(isParameterScalar) ? [...value] : undefined;
}

/** `dash/params`: each valid filter name with a scalar, a list of scalars or `null`. */
export function parseParameters(value: unknown): Parameters {
  const record = asRecord(value);
  const params: Parameters = Object.create(null);
  for (const name of Object.keys(record).filter(isValidParameterName)) {
    const parsed = parseParameterValue(record[name]);
    if (parsed !== undefined) params[name] = parsed;
  }
  return params;
}

/** The `kind` a live query is written with: "call", or the older "query". */
export function getQuerySourceKind(source: { call?: true }): 'call' | 'query' {
  return source.call ? 'call' : 'query';
}

/** A query's `args` as canonical JSON, strings sanitized. */
export function serializeQueryArguments(value: unknown): string {
  const entries = Object.entries(asRecord(value)).filter(([key]) => !RESERVED_OBJECT_KEYS.has(key));
  return JSON.stringify(
    Object.fromEntries(entries.map(([key, item]) => [key, typeof item === 'string' ? sanitizeText(item) : item])),
  );
}

export function parseUpdateStamp(value: unknown): UpdateStamp | null {
  const record = asRecord(value);
  const at = parseTimestamp(getOwnProperty(record, 'at'));
  return at === null ? null : { at, by: sanitizeSingleLine(getOwnProperty(record, 'by')) };
}

export function parseViewerIdentity(value: unknown): ViewerIdentity | null {
  const record = asRecord(value);
  const id = sanitizeSingleLine(getOwnProperty(record, 'id'));
  return id === '' ? null : { id, name: sanitizeSingleLine(getOwnProperty(record, 'name')) };
}

/**
 * One argument's `rules` entry, or `null` when any key or value is not allowed. A list argument is
 * `{type: "array", items: {…}, minItems?, maxItems?}`, its `items` one plain rule (lists don't nest).
 */
export function parseQueryRule(value: unknown, nested = false): QueryRule | null {
  if (!isPlainObject(value)) return null;
  const rule: QueryRule = {};
  if (Object.hasOwn(value, 'items')) {
    const items = nested ? null : parseQueryRule(value.items, true);
    if (items === null) return null;
    rule.items = items;
    for (const [key, item] of Object.entries(value))
      if ((key === 'minItems' || key === 'maxItems') && isSafeCount(item)) rule[key] = item;
      else if (key === 'type' && item === 'array') rule.type = item;
      else if (key !== 'items') return null;
    return rule;
  }
  for (const [key, item] of Object.entries(value))
    if (key === 'type' && typeof item === 'string' && QUERY_RULE_TYPES.includes(item as NonNullable<QueryRule['type']>))
      rule.type = item as NonNullable<QueryRule['type']>;
    else if (key === 'enum' && Array.isArray(item) && item.length > 0 && item.length <= 10000 && item.every(isParameterScalar))
      rule.enum = [...item];
    else if (
      key === 'pattern' &&
      typeof item === 'string' &&
      item.length <= 1000 &&
      !PARAMETER_CONTROL_CHARACTER_PATTERN.test(item)
    )
      rule.pattern = item;
    else if ((key === 'minLength' || key === 'maxLength') && isSafeCount(item)) rule[key] = item;
    else if ((key === 'minimum' || key === 'maximum') && typeof item === 'number' && Number.isFinite(item)) rule[key] = item;
    else return null;
  return rule;
}

/** A query source's `rules`: `undefined` when unset or empty, `null` when anything in it is not allowed. */
export function parseQueryRules(value: unknown): Record<string, QueryRule> | null | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isPlainObject(value)) return null;
  const rules: Record<string, QueryRule> = {};
  for (const [name, item] of Object.entries(value)) {
    const rule = isValidParameterName(name) ? parseQueryRule(item) : null;
    if (rule === null) return null;
    rules[name] = rule;
  }
  return Object.keys(rules).length === 0 ? undefined : rules;
}

/** A live query: `kind: "call"` (the filters-and-rules form, flagged `call`) or the older `kind: "query"`. */
export function parseQuerySource(record: Record<string, unknown>, call: boolean): QuerySource {
  const rules = parseQueryRules(getOwnProperty(record, 'rules'));
  return {
    kind: 'query',
    ...(call ? { call: true as const } : {}),
    connector: sanitizeSingleLine(getOwnProperty(record, 'connector')),
    tool: sanitizeSingleLine(getOwnProperty(record, 'tool')),
    args: serializeQueryArguments(getOwnProperty(record, 'args')),
    ...(rules === undefined
      ? {}
      : rules === null
        ? { rulesRefused: true as const, refusedRules: getOwnProperty(record, 'rules') }
        : { rules }),
  };
}

/** A dataset's `source`; its kind is inferred when unset (`tool` → query, `url` → file, `rows` → unsupported "rows"). */
export function parseDatasetSource(record: Record<string, unknown>): DatasetSource | null {
  const kind = getOwnProperty(record, 'kind');
  const name =
    typeof kind === 'string'
      ? kind
      : typeof getOwnProperty(record, 'tool') === 'string'
        ? 'query'
        : typeof getOwnProperty(record, 'url') === 'string'
          ? 'file'
          : Array.isArray(getOwnProperty(record, 'rows'))
            ? 'rows'
            : null;
  if (name === null) return null;
  if (name === 'call') return parseQuerySource(record, true);
  if (name === 'query') return parseQuerySource(record, false);
  if (name === 'file') {
    const url = getOwnProperty(record, 'url');
    const fileName = sanitizeSingleLine(getOwnProperty(record, 'name'));
    return {
      kind: 'file',
      url: typeof url === 'string' && STORED_FILE_URL_PATTERN.test(url) ? url : '',
      name: fileName,
      format: parseEnumValue<DataFileFormat>(
        getOwnProperty(record, 'format'),
        DATA_FILE_FORMATS,
        inferDataFileFormatOrCsv(fileName),
      ),
    };
  }
  if (name === 'store') {
    const path = getOwnProperty(record, 'path');
    return { kind: 'store', path: isSavedRowsPath(path) ? path : '' };
  }
  return { kind: 'unsupported', rawKind: sanitizeSingleLine(name) };
}

/** A query's `langs`: each argument name to its code language, lower-cased; `undefined` when none. */
export function parseDatasetLangs(value: unknown): Record<string, string> | undefined {
  const langs: Record<string, string> = Object.create(null);
  for (const [name, item] of Object.entries(asRecord(value))) {
    const lang = normalizeCodeLanguage(item);
    if (!RESERVED_OBJECT_KEYS.has(name) && lang !== undefined) langs[name] = lang;
  }
  return Object.keys(langs).length === 0 ? undefined : langs;
}

const parsedDatasets = new WeakMap<object, Dataset>();

/** A `datasets/<id>` document, or `null` when it has no readable source. */
export function parseDataset(id: string, value: unknown): Dataset | null {
  const cached = typeof value === 'object' && value !== null ? parsedDatasets.get(value) : undefined;
  if (cached !== undefined && cached.id === id) return cached;
  const record = asRecord(value);
  const source = parseDatasetSource(asRecord(getOwnProperty(record, 'source')));
  if (source === null) return null;
  const dataset: Dataset = {
    id,
    title: sanitizeSingleLine(getOwnProperty(record, 'title')),
    description: normalizeDescription(getOwnProperty(record, 'description')),
    source,
    updated: parseUpdateStamp(getOwnProperty(record, 'updated')),
    schedule: sanitizeSingleLine(getOwnProperty(record, 'schedule')),
    staleAfterHours: parseBoundedInteger(getOwnProperty(record, 'staleAfterHours'), 1, Infinity),
  };
  if (source.kind === 'file' && getOwnProperty(record, 'fixed') === true) dataset.fixed = true;
  const langs = source.kind === 'query' ? parseDatasetLangs(getOwnProperty(record, 'langs')) : undefined;
  if (langs !== undefined) dataset.langs = langs;
  if (typeof value === 'object' && value !== null) parsedDatasets.set(value, dataset);
  return dataset;
}

export function getValidDatasetEntries(value: unknown): [string, unknown][] {
  const record = asRecord(value);
  return Object.keys(record)
    .filter(isValidDatasetId)
    .map((id) => [id, record[id]]);
}

/** `dash/settings.updates`: a preset, or a number of minutes (one that equals a preset becomes it); else "viewed". */
export function parseDashboardUpdates(value: unknown): DashboardUpdateSetting {
  if (typeof value !== 'number') return parseEnumValue(value, DASHBOARD_UPDATE_INTERVALS, 'viewed');
  const ms = Math.round(value * 60000);
  if (!Number.isFinite(ms) || ms <= 0) return 'viewed';
  return DASHBOARD_UPDATE_INTERVALS.find((updates) => updates !== 'viewed' && UPDATE_INTERVAL_MS[updates] === ms) ?? value;
}

export function getUpdatesIntervalMs(updates: DashboardUpdateSetting): number {
  return typeof updates === 'number' ? Math.round(updates * 60000) : UPDATE_INTERVAL_MS[updates];
}

export const EMPTY_DASHBOARD_CONTENT: DashboardContent = {
  lang: null,
  params: EMPTY_PARAMS,
  datasets: [],
  files: [],
  updates: 'viewed',
  look: undefined,
};

const parsedContents = new WeakSet<object>();

/**
 * The dashboard read from its documents, `{meta, params, settings, look, datasets: {id: doc}, files: {name: doc}}`
 * (see `composeDashboardDocuments`). Content already parsed comes back as it is.
 */
export function parseDashboardContent(value: unknown): DashboardContent {
  if (typeof value === 'object' && value !== null && parsedContents.has(value)) return value as DashboardContent;
  const record = asRecord(value);
  const datasets: Dataset[] = [];
  for (const [id, raw] of getValidDatasetEntries(getOwnProperty(record, 'datasets'))) {
    const dataset = parseDataset(id, raw);
    if (dataset !== null) datasets.push(dataset);
  }
  const settings = asRecord(getOwnProperty(record, 'settings'));
  const content: DashboardContent = {
    lang: parsePageLanguage(getOwnProperty(asRecord(getOwnProperty(record, 'meta')), 'lang')),
    params: parseParameters(getOwnProperty(record, 'params')),
    datasets,
    files: parseDashboardFiles(getOwnProperty(record, 'files')),
    updates: parseDashboardUpdates(getOwnProperty(settings, 'updates')),
    look: getOwnProperty(record, 'look'),
  };
  parsedContents.add(content);
  return content;
}

export function getDatasetQuery(dataset: Dataset): QuerySource | undefined {
  return dataset.source.kind === 'query' ? dataset.source : undefined;
}

/**
 * The stored blob a file dataset leaves behind when it is removed or repointed, or `null` while something may
 * still use it: another file dataset's url, a page file's text, a dataset whose source can't be read
 * (unsupported, or a file not stored yet), or a dashboard too big to judge.
 */
export function getUnreferencedBlobId(content: DashboardContent, path: string, datasetId: string): string | null {
  const { datasets, files } = content;
  if (!STORED_BLOB_PATH_PATTERN.test(path) || Math.max(datasets.length, files.length) >= MAX_COLLECTION_DOCUMENTS)
    return null;
  const blob = path.slice(-32);
  const mayUse = ({ id, source }: Dataset): boolean =>
    source.kind === 'unsupported' ||
    (source.kind === 'file' && (source.url === '' || (id !== datasetId && source.url.endsWith(blob))));
  return datasets.some(mayUse) || files.some((file) => file.text.includes(blob)) ? null : blob;
}
