/**
 * The JSON export of the whole dashboard: a manifest of what the page shows (its title, when it was exported, the
 * filters its queries use with their values, and each source's provenance and as-of time) with the static HTML copy.
 */

import {
  getUnquotedQueryParameters,
  parseStoredQueryArgs,
  type Dataset,
  type DatasetRun,
  type ParameterValue,
  type Parameters,
  type QuerySource,
} from '@open-artifact/data-core';
import { collectCalculationInputs, humanizeIdentifier } from '../data/calculations.ts';
import { getDatasetUpdatedAt } from '../data/status.ts';

export type ExportProvenance =
  | { kind: 'query'; connector: string; tool: string; arguments: Record<string, unknown>; inputs: string[] }
  | { kind: 'file'; file: string }
  | { kind: 'store'; path: string }
  | { kind: 'calc' | 'unsupported' };

export type ExportManifestSource = ExportProvenance & {
  id: string;
  title: string;
  description: string;
  as_of: string | null;
};

export interface ExportManifestInput {
  name: string;
  label: string;
  value: ParameterValue | null;
}

export interface DashboardExportManifest {
  version: 1;
  title: string;
  exported_at: string;
  inputs: ExportManifestInput[];
  sources: ExportManifestSource[];
}

/** A file an export makes. */
export interface ExportFile {
  filename: string;
  data: Blob;
}

/** What the page's exports read of the dashboard. */
export interface DashboardExportContext {
  title: string;
  /** Every source, the page's calculations after them. */
  listed: readonly Dataset[];
  /** The sources the page uses. */
  used: readonly Dataset[];
  run(id: string): DatasetRun;
  params: Parameters;
}

const timestampToIso = (at: number | null): string | null => (at === null || !Number.isFinite(at) ? null : new Date(at).toISOString());

function queryProvenance(source: QuerySource): Extract<ExportProvenance, { kind: 'query' }> {
  return {
    kind: 'query',
    connector: source.connector,
    tool: source.tool,
    arguments: parseStoredQueryArgs({ args: source.template ?? source.args }),
    inputs: getUnquotedQueryParameters(source),
  };
}

/** Where a source's rows come from: a connector's tool and its arguments, a file, or neither. */
export function exportDatasetProvenance(dataset: Dataset): ExportProvenance {
  const source = dataset.source;
  if (source.kind === 'query') return queryProvenance(source);
  if (source.kind === 'file') return { kind: 'file', file: source.name };
  if (source.kind === 'store') return { kind: 'store', path: source.path };
  return { kind: source.kind };
}

/** The manifest of the sources given, each with the time its data is from, and the filters their queries use. */
export function buildDashboardExportManifest(
  title: string,
  at: number,
  sources: readonly (readonly [Dataset, number | null])[],
  params: Parameters,
): DashboardExportManifest {
  const listed: ExportManifestSource[] = sources.map(([dataset, updatedAt]) => ({
    id: dataset.id,
    title: dataset.title || dataset.id,
    description: dataset.description,
    ...exportDatasetProvenance(dataset),
    as_of: timestampToIso(updatedAt),
  }));
  const names = [...new Set(listed.flatMap((source) => (source.kind === 'query' ? source.inputs : [])))];
  return {
    version: 1,
    title,
    exported_at: new Date(at).toISOString(),
    inputs: names.map((name) => ({ name, label: humanizeIdentifier(name), value: Object.hasOwn(params, name) ? (params[name] ?? null) : null })),
    sources: listed,
  };
}

/** The marked sources with every source the marked calculations read. */
export function collectExportSourceDependencies(marked: Iterable<string>, listed: readonly Dataset[]): Set<string> {
  const byId = new Map(listed.map((dataset) => [dataset.id, dataset]));
  const ids = new Set(marked);
  for (const id of [...ids]) {
    const source = byId.get(id)?.source;
    if (source?.kind === 'calc') for (const input of collectCalculationInputs(source, (other) => byId.get(other))) ids.add(input);
  }
  return ids;
}

/** Unpaired UTF-16 surrogates as U+FFFD, so the text survives JSON and UTF-8. */
export function replaceLoneSurrogates(text: string): string {
  return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '�');
}

/** A `JSON.stringify` replacer that mends lone surrogates in strings and keys. */
export function exportJsonReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'string') return replaceLoneSurrogates(value);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [replaceLoneSurrogates(key), inner]));
}

const FILENAME_FORBIDDEN = /[\u0000-\u001f\u007f/\\:*?"<>|]+/g;
const MAX_FILENAME_STEM = 120;

/** `<title>.<extension>`, the title stripped of characters a file name can't hold. */
export function exportFilename(title: string, extension: string): string {
  const stem = replaceLoneSurrogates(title).replace(FILENAME_FORBIDDEN, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  const cut = [...stem].slice(0, MAX_FILENAME_STEM).join('').trim();
  return `${cut || 'Dashboard'}.${extension}`;
}

/** The JSON text of the export: the manifest of the sources the copy shows, with the copy. */
export function dashboardJsonText(context: DashboardExportContext, marked: Iterable<string>, html: string, at: number): string {
  const included = collectExportSourceDependencies(marked, context.listed);
  const sources = context.used
    .filter((dataset) => included.has(dataset.id))
    .map((dataset) => [dataset, getDatasetUpdatedAt(dataset, context.run(dataset.id))] as const);
  const manifest = buildDashboardExportManifest(context.title, at, sources, context.params);
  return JSON.stringify({ ...manifest, html }, exportJsonReplacer, 2);
}
