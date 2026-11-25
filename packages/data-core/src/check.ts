import type { DataFileFormat, Table, UnknownRecord } from './types.ts';
import { isPlainObject } from './text.ts';
import {
  DASHBOARD_ENTRY_PATH,
  DASH_LOOK_PATH,
  DASH_META_PATH,
  DASH_PARAMS_PATH,
  DASH_SETTINGS_PATH,
  DRAFTS_COLLECTION,
  isValidDashboardFilename,
  isValidDatasetId,
  parseDataPath,
  userCheckPath,
  userRunsPath,
} from './paths.ts';
import {
  MAX_DATA_BYTES,
  PAGE_LANGUAGE_PATTERN,
  STORED_BLOB_PATH_PATTERN,
  isValidParameterName,
  parseDashboardUpdates,
  parseDataset,
  parseParameterValue,
} from './model.ts';
import { DATA_FILE_FORMATS, inferDataFileFormat, parseDataFileTable, parseFileJson } from './tables.ts';
import { MAX_SAVED_ROWS_PATH_SEGMENTS, SAVED_ROWS_ROOT, savedRowsPathProblem, type SavedRowsPathProblem } from './saved-rows.ts';
import { getDatasetParameterNames, getSourceRuleProblems } from './fill.ts';
import {
  CARD_LUMINANCE,
  CHART_CONTRAST,
  DEFAULT_LOOK_TEXT,
  GROUND_LUMINANCE,
  LOOK_SIZE_RANGES,
  LOOK_STATUSES,
  MAX_LOOK_CHARTS,
  MAX_LOOK_CORNERS,
  MIN_BORDER_DISTANCE,
  MIN_CHART_DISTANCE,
  TEXT_CONTRAST,
  UI_CONTRAST,
  colorDistance,
  contrastRatio,
  isDarkColor,
  mixHex,
  parseFontStack,
  parseLookColor,
  relativeLuminance,
  type LookTheme,
} from './look.ts';
import { parseDraftHead } from './drafts.ts';
import { checkDashboardPage, getDeclaredLoaders, type PageDatasetInfo } from './check-page.ts';

/** One thing the check found in a document. */
export interface CheckFinding {
  /** The document's file, `db/<path>.json`. */
  file: string;
  level: 'error' | 'warning' | 'info';
  message: string;
  line?: number;
}

/** What the check may know of the dashboard's folder beyond its documents (each field is optional). */
export interface DataCheckContext {
  /** Whether an upload exists (`/_blob/<id>`). */
  blobExists?: (id: string) => boolean;
  /** An upload's text, or `null` when it is missing: a file dataset's rows are read from it. */
  readBlob?: (id: string) => string | null;
  /** An upload's size in bytes, or `undefined` when it is missing. */
  blobSize?: (id: string) => number | undefined;
  /** When a document was last written, epoch ms: tells a page report older than the page from a current one. */
  modifiedAt?: (path: string) => number | undefined;
  /** The connectors the owner set up (server names); `null` when they have none. Left out: not checked. */
  connectors?: ReadonlySet<string> | null;
  /** The owner's uid, whose `data/users/<uid>/{check,runs}` the open page writes. Default `owner`. */
  ownerId?: string;
  /** Now, epoch ms. */
  now?: number;
}

/** The keys `dash/look` reads. */
export const LOOK_KEYS: readonly string[] = ['system', 'light', 'dark', 'corners', 'sizes', 'fonts', 'tweaks'];
/** The keys a theme of `dash/look` reads. */
export const LOOK_TONE_KEYS: readonly string[] = ['ground', 'card', 'text', 'muted', 'border', 'good', 'warning', 'bad', 'charts'];
/** The palettes a `tweaks.palette` may name. */
export const LOOK_TWEAK_PALETTES: readonly string[] = ['Clay', 'Ocean', 'Meadow', 'own'];
export const LOOK_TWEAK_FONTS: readonly string[] = ['Serif', 'Monospace'];
export const LOOK_TWEAK_SIZES: readonly string[] = ['small', 'large'];

/** The owner's uid in a local dashboard's `data/users/<uid>`. */
export const LOCAL_OWNER_ID = 'owner';
/** The largest document the store keeps, bytes. */
const MAX_DOCUMENT_BYTES = 256 * 1024;
/** A "checking" check document older than this was left by a page closed mid-check. */
const CHECK_ABANDONED_MS = 30_000;
const READ_COLLECTIONS: ReadonlySet<string> = new Set(['dash', 'datasets', 'files', 'data', DRAFTS_COLLECTION]);
const BLOB_REFERENCE_PATTERN = /\/_blob\/([0-9a-f]{32})/g;
const LOOK_LENGTH_PATTERN = /^(\d{1,4}(?:\.\d{1,4})?)(px|rem)$/i;
const COLOR_FORM = 'a hex, or rgb(), hsl(), oklch(), oklab(), lab() or lch(): no name, var() or gradient';
const LOOK_TWEAKS: Readonly<Record<string, (value: unknown) => boolean>> = {
  palette: (value) => typeof value === 'string' && LOOK_TWEAK_PALETTES.includes(value),
  page: (value) => value === 'white',
  corners: (value) => typeof value === 'number' && Number.isFinite(value),
  font: (value) => typeof value === 'string' && LOOK_TWEAK_FONTS.includes(value),
  size: (value) => typeof value === 'string' && LOOK_TWEAK_SIZES.includes(value),
};
const CHECK_OUTPUT_WORDS: Readonly<Record<string, string>> = {
  not_a_number: 'NaN',
  empty_chart: 'a blank chart',
  labels_overlap: 'labels over each other',
  labels_cut: 'labels cut off',
};
const CHECK_DRAWING_WORDS: Readonly<Record<string, string>> = {
  not_empty: 'a drawing stored holding more than a —',
  nested: 'a drawing inside another',
  no_function: 'a data-draw with no dash.draw function',
  stray_write: 'a script writing outside a drawing (there it sets only class, style, hidden, disabled, checked, value or aria-*)',
};

/** The file a finding names for a store path. */
export function dataDocumentFile(path: string): string {
  return `db/${path}.json`;
}

/**
 * Store paths the history leaves out: what the page saves under `data/` (each person's own documents too), drafts,
 * and `dash/settings` (how often the sources update).
 */
export function dataHistoryIgnores(path: string): boolean {
  const clean = path.replace(/^\/+/, '').replace(/\.json$/, '');
  if (clean === DASH_SETTINGS_PATH) return true;
  return [SAVED_ROWS_ROOT, DRAFTS_COLLECTION].some((collection) => clean === collection || clean.startsWith(`${collection}/`));
}

/** A new, empty dashboard's documents by store path (without `.json`), as JSON text. */
export function scaffoldDataProject(title: string): Record<string, string> {
  return { [DASH_META_PATH]: `${JSON.stringify({ title }, null, 2)}\n` };
}

type Level = CheckFinding['level'];
type Report = (doc: string, level: Level, message: string, line?: number) => void;

const kb = (bytes: number): string => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`);
const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

/**
 * The `edit` stamp is the page's own: `{by, byAt}`, the person who last changed the document on the page. History
 * names the agent by itself, so a stamp the agent wrote (`{via, at}`) is only noted.
 */
function editStampProblem(edit: unknown): string | null {
  const leaveOut = 'leave edit out of what you write: the page stamps the person who changes it there, and History names you by itself.';
  if (!isPlainObject(edit)) return `edit is the page’s {by, byAt}; ${leaveOut}`;
  const time = (value: unknown): boolean =>
    typeof value === 'number' ? Number.isFinite(value) : typeof value === 'string' && !Number.isNaN(Date.parse(value));
  if (typeof edit.by === 'string' && time(edit.byAt)) return null;
  return edit.via !== undefined ? `edit holds {via, at}, which the page ignores; ${leaveOut}` : `edit is the page’s {by, byAt}; ${leaveOut}`;
}

const SAVED_ROWS_PATH_HINT = 'a collection such as data/team/notes, or one document such as data/team/notes/today';

function savedRowsPathMessage(problem: SavedRowsPathProblem, path: unknown): string {
  const shown = JSON.stringify(path);
  switch (problem) {
    case 'not_text':
      return `source.path is missing: where the page saves the rows, ${SAVED_ROWS_PATH_HINT} (data/users/me/… for each reader’s own).`;
    case 'outside_data':
      return `source.path ${shown} isn’t under data/: saved rows are kept in ${SAVED_ROWS_PATH_HINT}.`;
    case 'too_deep':
      return `source.path ${shown} has more than ${MAX_SAVED_ROWS_PATH_SEGMENTS} parts.`;
    case 'bad_segment':
      return `source.path ${shown}: each part is 1–200 of A–Z a–z 0–9 _ - . ~ : @ + (and not . or ..).`;
    case 'own_report':
      return `source.path ${shown} is one of the page’s own reports (a person’s folder, check, runs, page, history-…), not saved rows.`;
  }
}

function checkMeta(meta: UnknownRecord | undefined, report: Report): void {
  const doc = DASH_META_PATH;
  if (meta === undefined) {
    report(doc, 'error', 'is missing: write {title} first, what the person calls it.');
    return;
  }
  if (typeof meta.title !== 'string' || meta.title.trim() === '') report(doc, 'error', 'needs a title (what the person calls it).');
  else if (/^dashboard$/i.test(meta.title.trim())) report(doc, 'warning', 'title is "Dashboard"; use what the person calls it.');
  if (meta.lang !== undefined && !(typeof meta.lang === 'string' && PAGE_LANGUAGE_PATTERN.test(meta.lang.trim())))
    report(doc, 'warning', `lang ${JSON.stringify(meta.lang)} isn’t a language tag the page reads (as "en", "zh-CN" or "pt-BR"); the page is marked as English.`);
}

function checkParams(params: UnknownRecord, report: Report): void {
  for (const [name, value] of Object.entries(params)) {
    if (!isValidParameterName(name))
      report(DASH_PARAMS_PATH, 'error', `${JSON.stringify(name)} is not a parameter name (letters, digits, _; not starting with a digit).`);
    else if (parseParameterValue(value) === undefined)
      report(DASH_PARAMS_PATH, 'error', `${name}: a default is text on one line, a number, a boolean, null, or a list of them.`);
  }
}

function checkSettings(settings: UnknownRecord, report: Report): void {
  if (settings.updates === undefined || settings.updates === 'viewed' || parseDashboardUpdates(settings.updates) !== 'viewed') return;
  report(
    DASH_SETTINGS_PATH,
    'warning',
    `updates ${JSON.stringify(settings.updates)} isn’t one of "viewed", "5min", "hour", "day", "week" or a number of minutes, so the data updates when viewed.`,
  );
}

/** A length in px or rem as px, held within bounds; `undefined` when it isn't one. */
function readLookLength(value: unknown, min: number, max: number): { px: number; held: boolean } | undefined {
  const match = typeof value === 'string' ? LOOK_LENGTH_PATTERN.exec(value.trim()) : null;
  const px = typeof value === 'number' ? value : match ? Number(match[1]) * ((match[2] ?? '').toLowerCase() === 'rem' ? 16 : 1) : Number.NaN;
  if (!Number.isFinite(px)) return undefined;
  const kept = Math.round(Math.min(max, Math.max(min, px)) * 100) / 100;
  return { px: kept, held: kept !== Math.round(px * 100) / 100 };
}

const inLuminanceBand = (color: string, theme: LookTheme, band: Readonly<Record<LookTheme, number>>): boolean =>
  theme === 'light' ? relativeLuminance(color) >= band.light : relativeLuminance(color) <= band.dark;

/** One theme's set: whether the dashboard keeps it, and each value it drops or replaces. */
function checkLookSet(value: unknown, theme: LookTheme, issue: (message: string) => void, warn: (message: string) => void): boolean {
  if (value === undefined) return false;
  if (!isPlainObject(value)) {
    issue(`${theme} is an object of colors ({ground, card, text, …}); the ${theme} set is dropped.`);
    return false;
  }
  for (const key of Object.keys(value))
    if (!LOOK_TONE_KEYS.includes(key)) warn(`${theme}.${key} isn’t read (a set has ${LOOK_TONE_KEYS.join(', ')}).`);
  const givenGround = parseLookColor(value.ground);
  if (givenGround === undefined) {
    issue(
      value.ground === undefined
        ? `${theme}.ground is missing: a set needs its ground, so the ${theme} set is dropped.`
        : `${theme}.ground ${JSON.stringify(value.ground)} isn’t a color the dashboard reads (${COLOR_FORM}; no alpha on a ground): the ${theme} set is dropped.`,
    );
    return false;
  }
  if (isDarkColor(givenGround) !== (theme === 'dark')) {
    issue(
      `${theme}.ground ${String(value.ground)} is on the wrong side for a ${theme} set (${theme === 'light' ? '#767676 or lighter' : '#757575 or darker'}): the whole ${theme} set is dropped and its readers see the dashboard’s own colors.`,
    );
    return false;
  }
  const pole = theme === 'light' ? '#ffffff' : '#000000';
  const ground =
    [0, 0.2, 0.4, 0.6, 0.8].map((amount) => mixHex(givenGround, pole, amount)).find((color) => inLuminanceBand(color, theme, GROUND_LUMINANCE)) ??
    pole;
  if (ground !== givenGround)
    warn(
      `${theme}.ground ${String(value.ground)} is too ${theme === 'light' ? 'dark' : 'light'} for the dashboard’s toolbar (a ${theme} ground is as ${theme} as ${theme === 'light' ? '#eaeaea or lighter' : '#383838 or darker'}, as that gray): it is taken toward ${theme === 'light' ? 'white' : 'black'} (${ground}) and the other colors are checked against that. Give one of the system’s neutrals that fits.`,
    );
  for (const key of ['card', 'text', 'muted', 'border', ...LOOK_STATUSES])
    if (value[key] !== undefined && parseLookColor(value[key], ground) === undefined)
      issue(`${theme}.${key} ${JSON.stringify(value[key])} isn’t a color the dashboard reads (${COLOR_FORM}); it is dropped.`);
  const cardColor = parseLookColor(value.card, ground);
  const card = cardColor !== undefined && inLuminanceBand(cardColor, theme, CARD_LUMINANCE) ? cardColor : ground;
  if (cardColor !== undefined && card !== cardColor)
    warn(`${theme}.card ${String(value.card)} is ${theme === 'light' ? 'darker than #cccccc' : 'lighter than #4f4f4f'}; the ground stands in.`);
  const reads = (color: string | undefined, ratio: number): boolean =>
    color !== undefined && contrastRatio(color, ground) >= ratio && contrastRatio(color, card) >= ratio;
  const color = (key: string): string | undefined => parseLookColor(value[key], card);
  const givenText = color('text');
  const text = [givenText, DEFAULT_LOOK_TEXT[theme]].find((candidate) => reads(candidate, TEXT_CONTRAST)) ?? DEFAULT_LOOK_TEXT[theme];
  if (givenText !== undefined && givenText !== text)
    warn(`${theme}.text ${String(value.text)} is under 4.5:1 on the ground or the card; ${theme === 'light' ? 'black' : 'white'} stands in.`);
  const border = color('border');
  if (border !== undefined && ground !== givenGround && Math.min(colorDistance(border, ground), colorDistance(border, card)) < MIN_BORDER_DISTANCE)
    warn(`${theme}.border ${String(value.border)} is too close to the adjusted ground or the card; one is mixed from text and ground instead.`);
  const muted = color('muted');
  if (muted !== undefined && !reads(muted, UI_CONTRAST))
    warn(`${theme}.muted ${String(value.muted)} is under 3:1 on the ground or the card; one is mixed from text and ground instead.`);
  for (const key of LOOK_STATUSES) {
    const status = color(key);
    if (status !== undefined && !reads(status, UI_CONTRAST))
      warn(`${theme}.${key} ${String(value[key])} is under 3:1 on the ground or the card; the dashboard’s own shows.`);
  }
  if (value.charts !== undefined) {
    if (!Array.isArray(value.charts)) issue(`${theme}.charts is a list of colors, the brand color first; it is dropped.`);
    else {
      if (value.charts.length > MAX_LOOK_CHARTS) warn(`${theme}.charts has ${value.charts.length} colors; only the first ${MAX_LOOK_CHARTS} are read.`);
      const kept: (string | undefined)[] = [];
      (value.charts as unknown[]).slice(0, MAX_LOOK_CHARTS).forEach((entry, index) => {
        const chart = parseLookColor(entry, card);
        const near = chart === undefined ? -1 : kept.findIndex((earlier) => earlier !== undefined && colorDistance(earlier, chart) < MIN_CHART_DISTANCE);
        const ok = reads(chart, CHART_CONTRAST) && near === -1;
        kept.push(ok ? chart : undefined);
        if (chart === undefined)
          issue(`${theme}.charts[${index}] ${JSON.stringify(entry)} isn’t a color the dashboard reads (${COLOR_FORM}); that slot keeps the dashboard’s color.`);
        else if (!reads(chart, CHART_CONTRAST))
          warn(`${theme}.charts[${index}] ${String(entry)} is under 1.5:1 on the ground or the card; that slot keeps the dashboard’s color.`);
        else if (near !== -1) warn(`${theme}.charts[${index}] ${String(entry)} is too close to charts[${near}]; that slot keeps the dashboard’s color.`);
      });
    }
  }
  return true;
}

/** `dash/look` as the dashboard reads it: errors for what it drops, warnings for what it replaces. */
function checkLook(look: UnknownRecord, report: Report): void {
  const issue = (message: string): void => report(DASH_LOOK_PATH, 'error', message);
  const warn = (message: string): void => report(DASH_LOOK_PATH, 'warning', message);
  for (const key of Object.keys(look)) if (!LOOK_KEYS.includes(key)) warn(`${key} isn’t read (dash/look has ${LOOK_KEYS.join(', ')}).`);
  let tweaks = 0;
  if (look.tweaks !== undefined && look.tweaks !== null) {
    if (!isPlainObject(look.tweaks)) warn('tweaks is the Style panel’s {palette, page, corners, font, size}; it is ignored.');
    else
      for (const [key, value] of Object.entries(look.tweaks)) {
        const valid = LOOK_TWEAKS[key];
        if (valid === undefined) warn(`tweaks.${key} isn’t read (tweaks are ${Object.keys(LOOK_TWEAKS).join(', ')}).`);
        else if (value === null) continue;
        else if (!valid(value)) warn(`tweaks.${key} ${JSON.stringify(value)} isn’t one the Style panel offers; it is ignored.`);
        else tweaks++;
      }
  }
  const light = checkLookSet(look.light, 'light', issue, warn);
  const dark = checkLookSet(look.dark, 'dark', issue, warn);
  // A look of the Style panel's tweaks alone (none left after "Reset all" too) is the person's, over the dashboard's own colors.
  const onlyTweaks = 'tweaks' in look && Object.keys(look).length === 1;
  if (!light && !dark) {
    if (!tweaks && !onlyTweaks) issue('has no set the dashboard can use (light or dark, each with its ground), so nothing of the look applies.');
  } else if (!light || !dark)
    warn(
      `only the ${light ? 'light' : 'dark'} set is used: readers in the other theme${light ? '' : ', and print,'} see the dashboard’s own colors. Fill both sets.`,
    );
  const length = (where: string, value: unknown, min: number, max: number): void => {
    if (value === undefined) return;
    const read = readLookLength(value, min, max);
    if (read === undefined) issue(`${where} ${JSON.stringify(value)} isn’t a length the dashboard reads (px or rem, as "12px" or "0.75rem"); it is dropped.`);
    else if (read.held) warn(`${where} ${String(value)} is held to ${read.px}px (${min} to ${max}px).`);
  };
  length('corners', look.corners, 0, MAX_LOOK_CORNERS);
  if (look.sizes !== undefined) {
    if (!isPlainObject(look.sizes)) issue('sizes is an object: {caption, body, heading, title}.');
    else {
      const sizes = look.sizes;
      for (const key of Object.keys(sizes))
        if (!Object.hasOwn(LOOK_SIZE_RANGES, key)) warn(`sizes.${key} isn’t read (sizes are ${Object.keys(LOOK_SIZE_RANGES).join(', ')}).`);
      for (const [key, [min, max]] of Object.entries(LOOK_SIZE_RANGES)) length(`sizes.${key}`, sizes[key], min, max);
    }
  }
  if (look.fonts !== undefined) {
    if (!isPlainObject(look.fonts)) issue('fonts is an object: {text, display}.');
    else {
      const fonts = look.fonts;
      for (const key of Object.keys(fonts)) if (key !== 'text' && key !== 'display') warn(`fonts.${key} isn’t read (fonts are text and display).`);
      for (const key of ['text', 'display']) {
        const stack = fonts[key];
        if (stack !== undefined && parseFontStack(stack) === undefined)
          issue(
            `fonts.${key} ${JSON.stringify(stack)} is dropped: up to 12 names, 200 characters in all, each a generic or up to 60 letters, digits, spaces, _ . -.`,
          );
      }
    }
  }
}

interface DatasetCheck extends PageDatasetInfo {
  id: string;
}

function checkDataset(
  id: string,
  data: UnknownRecord,
  params: UnknownRecord | undefined,
  loaders: ReadonlySet<string>,
  context: DataCheckContext,
  report: Report,
): DatasetCheck {
  const doc = `datasets/${id}`;
  const issue = (message: string): void => report(doc, 'error', message);
  const warn = (message: string): void => report(doc, 'warning', message);
  const info: DatasetCheck = { id, table: null };
  if (typeof data.title !== 'string' || !data.title.trim()) issue('needs a title: a short name that stands alone in a list of sources.');
  else if (data.title.length > 40) warn(`title is ${data.title.length} characters; about 30 reads best in Sources (the detail goes in description).`);
  if (data.description !== undefined && typeof data.description !== 'string') issue('description must be text.');
  if (data.edit !== undefined) {
    const problem = editStampProblem(data.edit);
    if (problem) warn(problem);
  }
  const rawSource = isPlainObject(data.source) ? data.source : null;
  if (rawSource === null) {
    issue(
      'needs source: {kind: "call", connector, tool, args} (a live query), {kind: "file", url, name, format} (an upload) or {kind: "store", path} (rows saved from the page).',
    );
    return info;
  }
  const dataset = parseDataset(id, data);
  if (dataset === null) {
    issue('source has no kind the page reads: give it a "kind" of "call" (a live query), "file" (an upload) or "store" (saved rows).');
    return info;
  }
  const { source } = dataset;
  if (source.kind === 'unsupported') {
    if (source.rawKind === 'rows')
      issue('is an old rows dataset (it shows "Didn’t load"): make its rows a JSON file, upload it, then set the document with a file source and updated.');
    else issue(`source.kind ${JSON.stringify(source.rawKind)} isn’t one the page loads; use "call", "file" or "store".`);
    return info;
  }
  if (source.kind === 'store') {
    const problem = savedRowsPathProblem(rawSource.path);
    if (problem !== null) issue(savedRowsPathMessage(problem, rawSource.path));
    return info;
  }
  if (source.kind === 'query') {
    if (source.connector === '') issue('source.connector is missing: the connector’s name in connectors.json.');
    else if (context.connectors === null)
      warn(`source.connector "${source.connector}" isn’t set up: there is no connectors.json, so the query doesn’t run (runs says absent) until the person adds that server.`);
    else if (context.connectors !== undefined && !context.connectors.has(source.connector))
      warn(
        `source.connector "${source.connector}" isn’t set up and turned on in connectors.json (${[...context.connectors].join(', ') || 'none is'}), so the query doesn’t run (runs says absent) until the person adds that server or you name one of theirs.`,
      );
    if (source.tool === '') issue('source.tool is missing: the tool the query calls.');
    if (data.snapshot !== undefined && data.snapshot !== false)
      issue(`snapshot is false or left out (false keeps this query's rows off a published dashboard's snapshot); the page ignores ${JSON.stringify(data.snapshot)}.`);
    if (!source.call) report(doc, 'info', 'is written with the older kind "query"; "call" takes filters with rules.');
    if (source.rulesRefused)
      issue('source.rules are refused: each names a filter and holds only type, enum, pattern, minLength, maxLength, minimum, maximum, or items with minItems and maxItems.');
    for (const problem of getSourceRuleProblems(source).filter((problem) => problem.filter !== '*'))
      issue(
        problem.what === 'filter_without_rule'
          ? `{{${problem.filter}}} is written into the query’s text with no rule that pins its values (an enum, a pattern, a number type or bounds), so it can’t be filled.`
          : `the rule of {{${problem.filter}}} can’t be used: ${problem.problem ?? 'its pattern is not readable'}.`,
      );
    for (const name of getDatasetParameterNames(dataset))
      if (params === undefined || !Object.hasOwn(params, name)) warn(`{{${name}}} has no default in dash/params, so it starts unset.`);
    return info;
  }
  if (source.kind !== 'file') return info;
  if (data.fixed !== undefined && data.fixed !== true) issue(`fixed is true or left out; the page ignores ${JSON.stringify(data.fixed)}.`);
  const leftovers = ['lastAttempt', 'pausedBy'].filter((key) => data[key] !== undefined);
  if (leftovers.length)
    warn(`${leftovers.join(' and ')} ${leftovers.length > 1 ? 'are' : 'is'} left from a paused query, which the page no longer has; remove ${leftovers.length > 1 ? 'them' : 'it'}.`);
  const url = rawSource.url;
  if (typeof url !== 'string' || !STORED_BLOB_PATH_PATTERN.test(url)) {
    issue(`source.url ${JSON.stringify(url)} isn’t an attached file: give the url upload printed (/_blob/<id>), as it came.`);
    return info;
  }
  const blob = url.slice(-32);
  const exists = context.blobExists?.(blob) ?? (context.readBlob ? context.readBlob(blob) !== null : undefined);
  if (exists === false) {
    issue(`source.url ${url}: no such attached file in _blobs/. Upload the file again and use the url it prints.`);
    return info;
  }
  const size = context.blobSize?.(blob);
  if (size !== undefined && size > MAX_DATA_BYTES) {
    issue(`its file is ${kb(size)}; a file over ${kb(MAX_DATA_BYTES)} is refused.`);
    return info;
  }
  const name = typeof rawSource.name === 'string' ? rawSource.name : '';
  if (!name.trim()) issue('source.name: the file’s own name.');
  const givenFormat = rawSource.format;
  if (givenFormat !== undefined && !(typeof givenFormat === 'string' && (DATA_FILE_FORMATS as readonly string[]).includes(givenFormat)))
    issue('source.format is "csv", "tsv", "json" or "text".');
  else if (givenFormat === undefined && inferDataFileFormat(name) === null)
    warn('source.format is left out and the file name doesn’t say: write it ("csv", "tsv", "json" or "text"); until then the page reads the file as csv.');
  const format: DataFileFormat = source.format;
  if (loaders.has(id)) {
    // Its loader makes the rows when the page runs; runs says what it gave.
  } else if (format !== 'text') {
    // A "text" file is its text: a calc that takes it gets [], dash.data gives the text as its data.
    const text = context.readBlob?.(blob);
    if (text !== undefined && text !== null) {
      const table: Table | null = parseDataFileTable(text, format);
      if (table !== null) info.table = table;
      else if (format === 'json') {
        // Other valid JSON is the source's value, for a calc or the page's own code.
        if (parseFileJson(text) === undefined) {
          issue(`the file isn’t valid JSON; upload it again as JSON, or as "text" with dash.loader("${id}", …) to read it.`);
          return info;
        }
      } else {
        issue(`the file has no rows the page can read as ${format}; or add dash.loader("${id}", …) that makes rows of its text.`);
        return info;
      }
    }
  }
  const updated = isPlainObject(data.updated) ? data.updated : null;
  if (updated === null || typeof updated.at !== 'string' || Number.isNaN(Date.parse(updated.at)))
    issue('needs updated: {at: <ISO time>, by: <who>} on every file write; without it the file shows a warning.');
  else if (typeof updated.by !== 'string' || !updated.by.trim()) warn('updated.by is empty: say who wrote it.');
  if (data.staleAfterHours !== undefined && !(Number.isInteger(data.staleAfterHours) && (data.staleAfterHours as number) >= 1))
    issue('staleAfterHours is a whole number of hours, 1 or more.');
  if (data.schedule !== undefined && data.staleAfterHours === undefined) warn('has a schedule but no staleAfterHours (about twice the cadence).');
  return info;
}

/** What the owner's open page reported in `data/users/<uid>/runs` and `…/check`, as findings. */
function checkPageReports(docs: ReadonlyMap<string, UnknownRecord>, context: DataCheckContext, report: Report): void {
  const owner = context.ownerId ?? LOCAL_OWNER_ID;
  const modified = (path: string): number | undefined => context.modifiedAt?.(path);
  const changedSince = (since: number | undefined, pattern: RegExp): boolean =>
    since !== undefined && [...docs.keys()].some((path) => pattern.test(path) && (modified(path) ?? 0) > since);
  const runsPath = userRunsPath(owner);
  const runs = docs.get(runsPath);
  if (runs !== undefined) {
    const stale = changedSince(modified(runsPath), /^(files|datasets)\//);
    const level: Level = stale ? 'warning' : 'error';
    const note = stale ? ' (from before the latest change to the page or its datasets; the page writes it again when it next runs them)' : '';
    for (const [id, run] of Object.entries(isPlainObject(runs.datasets) ? runs.datasets : {})) {
      if (!isPlainObject(run) || run.status === 'ok' || run.status === 'running') continue;
      report(runsPath, level, `the open page says ${id} ${String(run.status)}${typeof run.message === 'string' && run.message ? `: ${run.message.slice(0, 160)}` : ''}${note}.`);
    }
    for (const mark of Array.isArray(runs.marks) ? runs.marks.filter(isPlainObject) : []) {
      const address = [mark.source, mark.field, mark.where ?? (mark.row !== undefined ? `row ${String(mark.row)}` : undefined)].filter(Boolean).join(' · ');
      const at = `${String(mark.mark)} (${address})`;
      report(
        runsPath,
        level,
        typeof mark.reason === 'string'
          ? `the open page flagged ${at}: ${mark.reason.slice(0, 120)}${note}.`
          : `the open page flagged ${at}: it shows ${JSON.stringify(mark.shown)}, the data holds ${String(mark.inData)}${note}.`,
      );
    }
    for (const error of Array.isArray(runs.errors) ? runs.errors.filter(isPlainObject) : []) {
      const times = typeof error.count === 'number' && error.count > 1 ? ` (${error.count} times)` : '';
      report(
        runsPath,
        level,
        `the page's code threw (${String(error.kind)}) ${String(error.name)}: ${String(error.message ?? '').slice(0, 160)}${typeof error.file === 'string' ? ` in ${error.file}` : ''}${times}${note}.`,
      );
    }
  }
  const checkPath = userCheckPath(owner);
  const check = docs.get(checkPath);
  if (check === undefined || check.status !== 'failed') {
    const writtenAt = modified(checkPath);
    if (
      check !== undefined &&
      (check.status === 'checking' || check.status === 'still_loading') &&
      writtenAt !== undefined &&
      (context.now ?? Date.now()) - writtenAt > CHECK_ABANDONED_MS &&
      !changedSince(writtenAt, /^(files|datasets|dash)\//)
    )
      report(
        checkPath,
        'info',
        `has said ${String(check.status)} for over 30 seconds: the page was closed while it checked, or a source is slow to load; it checks again when it is opened.`,
      );
    return;
  }
  const writtenAt = modified(checkPath);
  const stale = changedSince(writtenAt, /^files\//)
    ? 'a page file changed after the page wrote this; the open page checks again when it picks the change up'
    : changedSince(writtenAt, /^(datasets|dash)\//)
      ? 'a dataset or dash document changed after the page wrote this; only a page-file write (or opening the page again) checks again'
      : undefined;
  const level: Level = stale ? 'warning' : 'error';
  const note = stale ? ` (${stale})` : '';
  for (const entry of Array.isArray(check.page) ? check.page.filter(isPlainObject) : []) {
    const times = typeof entry.count === 'number' && entry.count > 1 ? ` (${entry.count})` : '';
    if (entry.kind === 'output')
      report(checkPath, 'warning', `the open page shows ${CHECK_OUTPUT_WORDS[String(entry.what)] ?? String(entry.what)}${times}: fix it unless a filter or the data explains it.`);
    else if (entry.kind === 'drawing')
      report(checkPath, level, `the open page found ${CHECK_DRAWING_WORDS[String(entry.what)] ?? String(entry.what)}${times}${note}.`);
    else {
      const did = entry.kind === 'stopped' ? 'stopped' : entry.kind === 'rejection' ? 'left a promise rejected' : 'threw';
      report(
        checkPath,
        level,
        `the page's code ${did}: ${String(entry.name)}${typeof entry.file === 'string' ? ` in ${entry.file}` : ''}${typeof entry.where === 'string' && entry.where !== '' ? `, where ${entry.where.slice(0, 80)}` : ''}${times}; errors in ${runsPath} hold its words${note}.`,
      );
    }
  }
  for (const entry of Array.isArray(check.sources) ? check.sources.filter(isPlainObject) : []) {
    const dataset = String(entry.dataset);
    report(
      checkPath,
      level,
      entry.what === 'items_unread'
        ? `the open page read only part of ${dataset}’s answer (items_unread): a dash.loader that reads items clears it${note}.`
        : `the open page says {{${String(entry.filter)}}} of ${dataset} ${entry.what === 'filter_without_rule' ? 'has no rule that pins its values' : 'has a rule it can’t use'}${note}.`,
    );
  }
}

/**
 * Checks a data dashboard's documents: `documents` maps store paths (`datasets/sales`, `dash/meta`) to their JSON
 * text. Errors are what the page would drop or refuse, or what the owner's open page reported failing; warnings are
 * worth a look and don't block.
 */
export function checkDataProject(documents: ReadonlyMap<string, string>, context: DataCheckContext = {}): CheckFinding[] {
  const findings: CheckFinding[] = [];
  const report: Report = (doc, level, message, line) =>
    findings.push({ file: dataDocumentFile(doc), level, message, ...(line !== undefined ? { line } : {}) });
  const docs = new Map<string, UnknownRecord>();
  for (const [path, text] of documents) {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      value = undefined;
    }
    if (!isPlainObject(value)) {
      report(path, 'error', 'is not a JSON object; the page can’t read it. Rewrite it with set.');
      continue;
    }
    const bytes = utf8Bytes(JSON.stringify(value));
    if (bytes > MAX_DOCUMENT_BYTES) report(path, 'error', `is ${kb(bytes)}; the store refuses any document over 256 KB.`);
    docs.set(path, value);
    const top = path.split('/')[0] ?? '';
    if (!READ_COLLECTIONS.has(top)) report(path, 'warning', 'is in a collection the dashboard doesn’t read.');
    else if (top === DRAFTS_COLLECTION) {
      const kind = parseDataPath(path);
      if (kind?.kind === 'draft' && parseDraftHead(kind.draftId, value) === null)
        report(path, 'warning', 'is a draft record the page can’t read, so the draft is not shown.');
    }
  }

  checkMeta(docs.get(DASH_META_PATH), report);
  const params = docs.get(DASH_PARAMS_PATH);
  if (params) checkParams(params, report);
  const settings = docs.get(DASH_SETTINGS_PATH);
  if (settings) checkSettings(settings, report);
  const look = docs.get(DASH_LOOK_PATH);
  if (look) checkLook(look, report);

  const pageFiles = new Map<string, string>();
  const fileTexts = new Map<string, string>();
  for (const [path, data] of docs) {
    const match = /^files\/([^/]+)$/.exec(path);
    if (!match) continue;
    const name = match[1] ?? '';
    if (!isValidDashboardFilename(name)) report(path, 'error', 'has a name the page ignores: letters, digits, _ - . (up to 64, no folders).');
    else if (typeof data.text !== 'string') report(path, 'error', 'needs {text}: the whole file.');
    else {
      pageFiles.set(name, data.text);
      fileTexts.set(path, data.text);
    }
    if (data.edit !== undefined) {
      const problem = editStampProblem(data.edit);
      if (problem) report(path, 'warning', problem);
    }
  }
  const loaders = getDeclaredLoaders(pageFiles);

  const datasets = new Map<string, DatasetCheck>();
  for (const [path, data] of docs) {
    const match = /^datasets\/([^/]+)$/.exec(path);
    if (!match) continue;
    const id = match[1] ?? '';
    if (!isValidDatasetId(id)) {
      report(path, 'error', 'has an id the page ignores: 1–64 of A–Z a–z 0–9 _ -.');
      continue;
    }
    datasets.set(id, checkDataset(id, data, params, loaders, context, report));
  }

  if (!pageFiles.has('index.html') && !docs.has(DASHBOARD_ENTRY_PATH)) {
    const started = [...docs.keys()].some((path) => /^(datasets|files)\//.test(path) || path === DASH_PARAMS_PATH || path === DASH_LOOK_PATH);
    if (started) report(DASHBOARD_ENTRY_PATH, 'error', 'is missing: the page is files/index.html {text}.');
    else report(DASHBOARD_ENTRY_PATH, 'info', 'is not written yet: write the datasets, then files/index.html last.');
  } else if (pageFiles.get('index.html')?.trim() === '') report(DASHBOARD_ENTRY_PATH, 'error', 'is empty: the dashboard has no page.');

  if (context.blobExists)
    for (const [path, text] of fileTexts)
      for (const blob of new Set([...text.matchAll(BLOB_REFERENCE_PATTERN)].map((match) => match[1] ?? '')))
        if (!context.blobExists(blob)) report(path, 'warning', `names /_blob/${blob}, which isn’t stored.`);

  const page = checkDashboardPage(pageFiles, datasets, (doc, level, message, line) => report(doc, level, message, line));
  for (const id of datasets.keys()) {
    const read = page.reads.get(id);
    if (!page.marked.has(id) && read === undefined) report(`datasets/${id}`, 'warning', 'nothing on the page names it; Sources labels it "Unused".');
    else if (!page.marked.has(id) && read !== undefined)
      report(`datasets/${id}`, 'error', `${read} reads it, but no element is marked data-source="${id}". Mark every dataset your scripts read.`);
  }
  for (const [id, doc] of page.reads)
    if (!datasets.has(id) && !page.calcs.has(id)) report(doc, 'error', `dash.data("${id}") reads no dataset or calc.`);

  checkPageReports(docs, context, report);
  return findings;
}
