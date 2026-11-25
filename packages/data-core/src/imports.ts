/** Files a person imports on an empty dashboard, and the request that hands them to the agent. */

import { DEFAULT_DASHBOARD_FORM, findDashboardFormKey } from './forms.ts';
import { remixFormName } from './drafts.ts';
import { inferDataFileFormat } from './tables.ts';
import type { DataFileFormat } from './types.ts';

/** What an imported file holds: a data file a source reads as it is, or a workbook the agent turns into CSV. */
export type ImportedFileKind = DataFileFormat | 'workbook';

/** An imported file once stored. */
export interface ImportedFile {
  name: string;
  /** Its stored url (`/_blob/<id>`). */
  url: string;
  kind: ImportedFileKind;
}

const WORKBOOK_TYPES: readonly string[] = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];

/** What the import button's file picker offers. */
export const IMPORT_FILE_ACCEPT = [
  '.csv',
  '.tsv',
  '.tab',
  '.json',
  '.geojson',
  '.xlsx',
  '.xls',
  'text/csv',
  'text/tab-separated-values',
  'application/json',
  'application/geo+json',
  ...WORKBOOK_TYPES,
].join(',');

/** Largest file the import takes, in bytes. */
export const MAX_IMPORT_FILE_BYTES = 25 * 1024 * 1024;

/** The kind of a picked file from its name, then its media type; `null` when it is none the import takes. */
export function importedFileKind(name: string, type = ''): ImportedFileKind | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'workbook';
  const byName = inferDataFileFormat(name);
  if (byName !== null) return byName;
  const media = type.split(';')[0]?.trim().toLowerCase() ?? '';
  if (WORKBOOK_TYPES.includes(media)) return 'workbook';
  if (media === 'text/csv') return 'csv';
  if (media === 'text/tab-separated-values') return 'tsv';
  if (media === 'application/json' || media === 'application/geo+json') return 'json';
  return null;
}

const KIND_NAMES: Readonly<Record<ImportedFileKind, string>> = {
  csv: 'CSV',
  tsv: 'TSV',
  json: 'JSON',
  text: 'text',
  workbook: 'Excel workbook',
};

/** The format the request names: a known one, else the default. */
function knownForm(form: string): string {
  return findDashboardFormKey(form) ?? DEFAULT_DASHBOARD_FORM;
}

function fileLine({ name, url, kind }: ImportedFile): string {
  return `${JSON.stringify(name)} at ${url} (${KIND_NAMES[kind]})`;
}

/** The request sent to the agent: build the empty dashboard in the picked format from the imported files. */
export function importPrompt(form: string, files: readonly ImportedFile[]): string {
  const workbook = files.some((file) => file.kind === 'workbook');
  return (
    `Build this dashboard as a ${remixFormName(knownForm(form))} from the ${files.length === 1 ? 'file' : 'files'} I imported: ` +
    files.map(fileLine).join('; ') +
    '. Attach each as a file source' +
    (workbook ? ', with each sheet you use from a workbook uploaded as its own CSV' : '') +
    '. See "Imported files" in SKILL.md.'
  );
}

/** Where an import request came from, for the agent to read as data. */
export interface ImportSelection {
  label: string;
  chip: { about: 'import'; form: string; files: { name: string; url: string; kind: ImportedFileKind }[] };
  text: string;
}

export function importSelection(form: string, files: readonly ImportedFile[]): ImportSelection {
  const known = knownForm(form);
  const name = remixFormName(known);
  return {
    label: `Import ${files.length === 1 ? (files[0]?.name ?? 'a file') : `${files.length} files`}`,
    chip: { about: 'import', form: known, files: files.map(({ name: file, url, kind }) => ({ name: file, url, kind })) },
    text: `From the empty dashboard's Import a file button, with ${name} (${known}) picked as the format.`,
  };
}
