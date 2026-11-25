/**
 * The agent's edits: the edits of an `applyEdits`, each made into the engine's own edits (the ones the page queues when
 * a person types, formats or inserts), so the engine checks them as it checks the person's and records the same
 * operations. What no engine edit makes (bringing back a sheet, charts) is applied as operations.
 */

import { type Block, a1, CELL_ADDRESS, overlap, parseRange } from './addresses.ts';
import { richTextOfMarkdown } from './cells.ts';
import { type EngineMessage, isObject } from './engine.ts';
import { AgentError } from './errors.ts';
import { conditionalFormatsOf, patternsOf } from './reads.ts';
import { checkKeys, pickSheet, runsBetween, type SheetView, sheetsOf, type WorkbookContents } from './workbook.ts';

/** The most edits in one applyEdits. */
export const MAX_EDITS = 64;
const MAX_RANGES = 1000;
const MAX_RULES = 500;


/** What an applyEdits is made in: the workbook as the edits so far leave it, and the queue of engine edits. */
export interface EditContext {
  read(): WorkbookContents;
  /** Queues one engine edit; a refusal throws an AgentError. The engine's answer: editQueued or nothingToChange. */
  queue(edit: EngineMessage): EngineMessage;
  /**
   * Applies engine operations as they are (what no edit of the engine makes: bringing back a sheet, charts), logged
   * in format version `version` (the oldest the engine takes when left out).
   */
  apply(ops: EngineMessage[], version?: number): void;
  /** A read of the session the edits are made in (its rules in ids). */
  answer(request: EngineMessage): EngineMessage;
  utility(request: EngineMessage): EngineMessage;
  /** The sheets deleted so far, the latest first: their ids and the names they had. */
  deletedSheets(): { sheetId: string; name: string }[];
  /** Charts: their edits and reads (charts.ts); null where charts are not made here. */
  charts?: ChartEdits | null;
}

export interface ChartEdits {
  add(chart: unknown, sheets: SheetView[]): void;
  set(chartId: unknown, chart: unknown, sheets: SheetView[]): boolean;
  remove(chartId: unknown, sheets: SheetView[]): void;
  /** An interactive panel on a blank tab of its own (charts.ts). */
  addInteractive(panel: unknown, sheets: SheetView[]): void;
}

export const EDIT_KINDS = [
  'writeCells', 'addSheet', 'renameSheet', 'restoreSheet', 'moveSheets', 'formatCells', 'groupRows', 'groupColumns', 'ungroupRows', 'ungroupColumns',
  'mergeCells', 'unmergeCells', 'setBorders', 'setColumnWidths', 'fitColumns', 'setRowHeights', 'insertRows', 'insertColumns', 'moveRows', 'moveColumns',
  'sortRows', 'sortCells', 'deleteRows', 'deleteColumns', 'deleteSheet', 'setSheetSettings', 'makeDropdown', 'setDropdownOptions', 'setCellTable',
  'replaceConditionalFormats', 'addChart', 'setChart', 'deleteChart', 'addInteractive', 'setTimeZone', 'setLocale',
];

/**
 * The edits of an applyEdits, made in order in `context`. A refusal throws an AgentError whose `extra` has the edit's
 * `editIndex` (from 0). Returns the indexes of edits that changed nothing; when that is all of them, the refusal is
 * nothingToChange.
 */
export function applyEdits(edits: unknown, context: EditContext): { changedNothing: number[] } {
  if (!Array.isArray(edits) || edits.length === 0) throw new AgentError('unreadableEdit', 'edits is a list of edits: [{"kind": "writeCells", …}].');
  if (edits.length > MAX_EDITS) throw new AgentError('tooManyEdits', `An applyEdits takes at most ${MAX_EDITS} edits: send more in another, with the revision this one returns as its base.`);
  const changedNothing: number[] = [];
  edits.forEach((edit, i) => {
    try {
      if (isObject(edit) && edit.kind === 'setTimeZone' && edits.length > 1) throw new AgentError('timeZoneNotSetAlone', 'setTimeZone goes alone, in an applyEdits of its own.');
      if (!applyEdit(edit, context)) changedNothing.push(i);
    } catch (error) {
      if (error instanceof AgentError) throw new AgentError(error.code, error.message, { ...error.extra, editIndex: i }, error.hint);
      throw error;
    }
  });
  if (changedNothing.length === edits.length) throw new AgentError('nothingToChange', 'No edit would change anything: nothing was written. Go on with the same base.', { changedNothing });
  return { changedNothing };
}

/** Queues a engine edit; false when it changes nothing. */
function queued(context: EditContext, edit: EngineMessage): boolean {
  return context.queue(edit).kind !== 'nothingToChange';
}

/** One edit; false when it changed nothing. */
function applyEdit(edit: unknown, context: EditContext): boolean {
  if (!isObject(edit) || typeof edit.kind !== 'string') throw new AgentError('unreadableEdit', `Each edit is an object with a kind: ${EDIT_KINDS.join(', ')}.`);
  const sheets = sheetsOf(context.read());
  const sheet = () => pickSheet(sheets, edit.sheet);
  const kind = edit.kind;
  switch (kind) {
    case 'writeCells':
      checkKeys(edit, ['sheet', 'topLeft', 'rows']);
      return writeCells(sheet(), edit.topLeft, edit.rows, context);
    case 'addSheet': {
      checkKeys(edit, ['name']);
      const name = sheetName(edit.name);
      if (sheets.some((s) => s.name.toLowerCase() === name.toLowerCase())) throw new AgentError('sheetNameTaken', `A sheet is named "${name}" already.`);
      const answer = context.queue({ kind: 'addSheet', afterSheet: sheets.at(-1)?.sheetId ?? null, nameStem: name.replace(/\d+$/, '') || name });
      const made = isObject(answer.placeChanged) ? answer.placeChanged.sheetId : undefined;
      const view = sheetsOf(context.read()).find((s) => s.sheetId === made);
      if (!view) throw new AgentError('unreadableEdit', 'The new sheet is not in the workbook.');
      if (view.name !== name) context.queue({ kind: 'renameSheet', sheetId: view.sheetId, name });
      return true;
    }
    case 'renameSheet': {
      checkKeys(edit, ['sheet', 'name']);
      const view = sheet();
      const name = sheetName(edit.name);
      if (sheets.some((s) => s !== view && s.name.toLowerCase() === name.toLowerCase())) throw new AgentError('sheetNameTaken', `Another sheet is named "${name}".`);
      return queued(context, { kind: 'renameSheet', sheetId: view.sheetId, name });
    }
    case 'restoreSheet':
      checkKeys(edit, ['sheet'], ['name']);
      restoreSheet(edit, sheets, context);
      return true;
    case 'moveSheets': {
      checkKeys(edit, ['sheets', 'afterSheet']);
      if (!Array.isArray(edit.sheets) || edit.sheets.length === 0) throw new AgentError('unreadableEdit', 'sheets is a list of sheet names: ["Summary", "Q1"].');
      const moving = edit.sheets.map((n) => pickSheet(sheets, n, 'sheets'));
      if (new Set(moving).size !== moving.length) throw new AgentError('sheetMovedTwice', 'A sheet is named twice in sheets.');
      let after = edit.afterSheet === null ? null : pickSheet(sheets, edit.afterSheet, 'afterSheet');
      if (after && moving.includes(after)) throw new AgentError('movedAfterWhatIsMoved', 'afterSheet is one of the sheets that move.');
      let changed = false;
      for (const view of moving) {
        changed = queued(context, { kind: 'moveSheet', sheetId: view.sheetId, afterSheet: after?.sheetId ?? null }) || changed;
        after = view;
      }
      return changed;
    }
    case 'formatCells': {
      checkKeys(edit, ['sheet', 'ranges', 'format']);
      const view = sheet();
      const blocks = rangesOf(view, edit.ranges);
      if (!isObject(edit.format) || Object.keys(edit.format).length === 0) throw new AgentError('formatNotReadable', 'format is an object of numberFormat, alignment, fillColor, cellControl, border and font: send only what is to change.');
      checkFormat(edit.format);
      let changed = false;
      for (const b of blocks) changed = queued(context, { kind: 'formatCells', cells: view.engineBlock(b), format: edit.format }) || changed;
      return changed;
    }
    case 'groupRows':
    case 'groupColumns':
      checkKeys(edit, ['sheet', 'groups']);
      return group(sheet(), edit.groups, kind === 'groupRows' ? 'rows' : 'columns', context);
    case 'ungroupRows':
    case 'ungroupColumns': {
      checkKeys(edit, ['sheet', 'groups']);
      const view = sheet();
      const of = kind === 'ungroupRows' ? 'rows' : 'columns';
      if (!Array.isArray(edit.groups) || edit.groups.length === 0) throw new AgentError('unreadableEdit', `groups is a list of the groups' ${of}, such as ["2:3"].`);
      for (const given of edit.groups) {
        const [first, last] = of === 'rows' ? view.rows(given, 'groups') : view.columns(given, 'groups');
        const list = of === 'rows' ? view.contents.rowGroups : view.contents.columnGroups;
        const found = (list ?? []).some((g) => {
          const span = view.lineSpan(g.ends, of);
          return span && span[0] === first && span[1] === last;
        });
        if (!found) throw new AgentError('noSuchGroup', `No group covers just ${given}: readSheets lists the ${of === 'rows' ? 'rowGroups' : 'columnGroups'}.`, { group: given });
        context.queue(of === 'rows' ? { kind: 'ungroupRows', sheetId: view.sheetId, oneRow: view.rowIds[first], otherRow: view.rowIds[last] } : { kind: 'ungroupColumns', sheetId: view.sheetId, oneColumn: view.columnIds[first], otherColumn: view.columnIds[last] });
      }
      return true;
    }
    case 'mergeCells':
    case 'unmergeCells': {
      checkKeys(edit, ['sheet', 'ranges']);
      const view = sheet();
      let changed = false;
      for (const b of rangesOf(view, edit.ranges)) changed = queued(context, { kind: kind, cells: view.engineBlock(b) }) || changed;
      return changed;
    }
    case 'setBorders': {
      checkKeys(edit, ['sheet', 'range', 'edges', 'border']);
      const view = sheet();
      const edges = ['all', 'inner', 'innerHorizontal', 'innerVertical', 'outer', 'left', 'top', 'right', 'bottom'];
      if (!edges.includes(edit.edges as string)) throw new AgentError('borderNotReadable', `edges is one of ${edges.join(', ')}.`);
      if (!isObject(edit.border) || (edit.border.kind !== 'none' && edit.border.kind !== 'line')) throw new AgentError('borderNotReadable', 'border is {"kind": "line", "style": "thin", "color": {"kind": "none"}}, or {"kind": "none"} to clear.');
      return queued(context, { kind: 'setBorders', cells: view.engineBlock(view.range(edit.range)), edges: edit.edges, border: edit.border });
    }
    case 'setColumnWidths': {
      checkKeys(edit, ['sheet', 'columns', 'widthInPixels']);
      const view = sheet();
      const [l, r] = view.columns(edit.columns);
      const width = edit.widthInPixels;
      if (!Number.isInteger(width) || (width as number) < 8 || (width as number) > 2000) throw new AgentError('columnWidthNotAllowed', 'widthInPixels is a whole number from 8 to 2000.');
      return queued(context, { kind: 'setColumnWidths', sheetId: view.sheetId, oneColumn: view.columnIds[l], otherColumn: view.columnIds[r], widthInPixels: width });
    }
    case 'fitColumns': {
      checkKeys(edit, ['sheet', 'columns']);
      const view = sheet();
      const [l, r] = view.columns(edit.columns);
      return queued(context, { kind: 'fitColumns', sheetId: view.sheetId, oneColumn: view.columnIds[l], otherColumn: view.columnIds[r], noNarrowerThan: [] });
    }
    case 'setRowHeights': {
      checkKeys(edit, ['sheet', 'rows', 'heightInPixels']);
      const view = sheet();
      const [t, b] = view.rows(edit.rows);
      const height = edit.heightInPixels;
      if (height !== null && (!Number.isInteger(height) || (height as number) < 8 || (height as number) > 2000)) throw new AgentError('rowHeightNotAllowed', 'heightInPixels is a whole number from 8 to 2000, or null to take the height back.');
      return queued(context, { kind: 'setRowHeights', sheetId: view.sheetId, rows: runsBetween(view.contents.rows, t, b), heightInPixels: height });
    }
    case 'insertRows': {
      checkKeys(edit, ['sheet', 'besideRow', 'side', 'count']);
      const view = sheet();
      const beside = edit.besideRow;
      if (!Number.isInteger(beside) || (beside as number) < 1 || (beside as number) > view.rowIds.length) throw new AgentError('rowsNotReadable', `besideRow is a row number, from 1 to ${view.rowIds.length}.`);
      if (edit.side !== 'above' && edit.side !== 'below') throw new AgentError('unreadableEdit', 'side is above or below.');
      const at = (beside as number) - 1;
      const besideId = view.rowIds[at]!;
      const afterRow = edit.side === 'below' ? besideId : at > 0 ? view.rowIds[at - 1]! : null;
      return queued(context, { kind: 'insertRows', sheetId: view.sheetId, afterRow, count: countOf(edit.count), formatsFromRow: besideId, groupsFromRow: besideId });
    }
    case 'insertColumns': {
      checkKeys(edit, ['sheet', 'besideColumn', 'side', 'count']);
      const view = sheet();
      const [at] = view.columns(edit.besideColumn, 'besideColumn');
      if (edit.side !== 'left' && edit.side !== 'right') throw new AgentError('unreadableEdit', 'side is left or right.');
      const besideId = view.columnIds[at]!;
      const afterColumn = edit.side === 'right' ? besideId : at > 0 ? view.columnIds[at - 1]! : null;
      return queued(context, { kind: 'insertColumns', sheetId: view.sheetId, afterColumn, count: countOf(edit.count), formatsFromColumn: besideId, groupsFromColumn: besideId });
    }
    case 'moveRows': {
      checkKeys(edit, ['sheet', 'rows', 'afterRow']);
      const view = sheet();
      const [t, b] = view.rows(edit.rows);
      const after = edit.afterRow;
      if (after !== null && (!Number.isInteger(after) || (after as number) < 1 || (after as number) > view.rowIds.length)) throw new AgentError('rowsNotReadable', `afterRow is a row number from 1 to ${view.rowIds.length}, or null for the top.`);
      if (after !== null && (after as number) - 1 >= t && (after as number) - 1 <= b) throw new AgentError('movedAfterWhatIsMoved', 'afterRow is one of the rows that move.');
      return queued(context, { kind: 'moveRows', sheetId: view.sheetId, oneRow: view.rowIds[t], otherRow: view.rowIds[b], afterRow: after === null ? null : view.rowIds[(after as number) - 1] });
    }
    case 'moveColumns': {
      checkKeys(edit, ['sheet', 'columns', 'afterColumn']);
      const view = sheet();
      const [l, r] = view.columns(edit.columns);
      const after = edit.afterColumn === null ? null : view.columns(edit.afterColumn, 'afterColumn')[0];
      if (after !== null && after >= l && after <= r) throw new AgentError('movedAfterWhatIsMoved', 'afterColumn is one of the columns that move.');
      return queued(context, { kind: 'moveColumns', sheetId: view.sheetId, oneColumn: view.columnIds[l], otherColumn: view.columnIds[r], afterColumn: after === null ? null : view.columnIds[after] });
    }
    case 'sortRows': {
      checkKeys(edit, ['sheet', 'rows', 'byColumn', 'direction']);
      const view = sheet();
      const [t, b] = view.rows(edit.rows);
      const [by] = view.columns(edit.byColumn, 'byColumn');
      return queued(context, { kind: 'sortRows', sheetId: view.sheetId, oneRow: view.rowIds[t], otherRow: view.rowIds[b], byColumn: view.columnIds[by], direction: direction(edit.direction) });
    }
    case 'sortCells': {
      checkKeys(edit, ['sheet', 'range', 'byColumn', 'direction']);
      const view = sheet();
      const block = view.range(edit.range);
      const [by] = view.columns(edit.byColumn, 'byColumn');
      if (by < block.left || by > block.right) throw new AgentError('sortColumnOutsideTheCells', `byColumn ${String(edit.byColumn)} is not a column of ${String(edit.range)}.`);
      return queued(context, { kind: 'sortCells', cells: view.engineCorners(block), byColumn: view.columnIds[by], direction: direction(edit.direction) });
    }
    case 'deleteRows': {
      checkKeys(edit, ['sheet', 'rows']);
      const view = sheet();
      const [t, b] = view.rows(edit.rows);
      return queued(context, { kind: 'deleteRows', sheetId: view.sheetId, rows: runsBetween(view.contents.rows, t, b) });
    }
    case 'deleteColumns': {
      checkKeys(edit, ['sheet', 'columns']);
      const view = sheet();
      const [l, r] = view.columns(edit.columns);
      return queued(context, { kind: 'deleteColumns', sheetId: view.sheetId, oneColumn: view.columnIds[l], otherColumn: view.columnIds[r] });
    }
    case 'deleteSheet':
      checkKeys(edit, ['sheet']);
      if (sheets.length === 1) throw new AgentError('noSheetLeft', 'A workbook keeps one sheet: to replace the only one, addSheet first.');
      return queued(context, { kind: 'deleteSheet', sheetId: sheet().sheetId });
    case 'setSheetSettings': {
      checkKeys(edit, ['sheet', 'settings']);
      const view = sheet();
      if (!isObject(edit.settings)) throw new AgentError('unreadableEdit', 'settings is {"lastFrozenRow"?: number|null, "lastFrozenColumn"?: "A"|null, "areGridlinesHidden"?: true|false}.');
      const settings: EngineMessage = {};
      for (const [key, value] of Object.entries(edit.settings)) {
        if (key === 'lastFrozenRow') {
          if (value !== null && (!Number.isInteger(value) || (value as number) < 1 || (value as number) > view.rowIds.length)) throw new AgentError('unreadableEdit', 'lastFrozenRow is a row number, or null to unfreeze.');
          settings.lastFrozenRow = value === null ? null : view.rowIds[(value as number) - 1];
        } else if (key === 'lastFrozenColumn') {
          settings.lastFrozenColumn = value === null ? null : view.columnIds[view.columns(value, 'lastFrozenColumn')[0]];
        } else if (key === 'areGridlinesHidden') {
          if (typeof value !== 'boolean') throw new AgentError('unreadableEdit', 'areGridlinesHidden is true or false.');
          settings.areGridlinesHidden = value;
        } else throw new AgentError('unreadableEdit', `settings takes no "${key}": lastFrozenRow, lastFrozenColumn, areGridlinesHidden.`);
      }
      if (Object.keys(settings).length === 0) throw new AgentError('unreadableEdit', 'settings names at least one of lastFrozenRow, lastFrozenColumn, areGridlinesHidden.');
      return queued(context, { kind: 'setSheetSettings', sheetId: view.sheetId, settings });
    }
    case 'makeDropdown': {
      checkKeys(edit, ['sheet', 'range', 'options']);
      const view = sheet();
      return queued(context, { kind: 'makeDropdown', cells: view.engineBlock(view.range(edit.range)), options: dropdownOptions(edit.options, false) });
    }
    case 'setDropdownOptions': {
      checkKeys(edit, ['sheet', 'dropdownId', 'options']);
      const view = sheet();
      if (!(view.contents.dropdowns ?? []).some((d) => d.dropdownId === edit.dropdownId)) throw new AgentError('unknownDropdown', `Sheet "${view.name}" has no dropdown ${JSON.stringify(edit.dropdownId)}: a readCells of its cells gives the ids.`);
      return queued(context, { kind: 'setDropdownOptions', sheetId: view.sheetId, dropdownId: edit.dropdownId, options: dropdownOptions(edit.options, true), appliesTo: { kind: 'everyCell' } });
    }
    case 'setCellTable':
      checkKeys(edit, ['sheet', 'cellTable']);
      return setCellTable(sheet(), edit.cellTable, context);
    case 'replaceConditionalFormats':
      checkKeys(edit, ['sheet', 'inPlaceOf', 'rules']);
      return replaceConditionalFormats(sheet(), edit.inPlaceOf, edit.rules, context);
    case 'addChart':
    case 'setChart':
    case 'deleteChart': {
      if (!context.charts) throw new AgentError('chartNotReadable', 'Charts are not made here.');
      if (kind === 'addChart') {
        checkKeys(edit, ['chart']);
        context.charts.add(edit.chart, sheets);
        return true;
      }
      if (kind === 'setChart') {
        checkKeys(edit, ['chartId', 'chart']);
        return context.charts.set(edit.chartId, edit.chart, sheets);
      }
      checkKeys(edit, ['chartId']);
      context.charts.remove(edit.chartId, sheets);
      return true;
    }
    case 'addInteractive':
      checkKeys(edit, ['interactive']);
      if (!context.charts) throw new AgentError('interactiveNotAvailable', 'Interactive panels are made only by an update of the Sheet itself.');
      context.charts.addInteractive(edit.interactive, sheets);
      return true;
    case 'setTimeZone': {
      checkKeys(edit, ['timeZone']);
      const zone = edit.timeZone;
      if (zone !== null && (typeof zone !== 'string' || !Intl.supportedValuesOf('timeZone').includes(zone))) throw new AgentError('timeZoneNotToPickFrom', 'timeZone is an IANA time zone such as "Europe/Berlin", or null for none.');
      return queued(context, { kind: 'setTimeZone', timeZone: zone });
    }
    case 'setLocale': {
      checkKeys(edit, ['locale']);
      const answer = context.utility({ kind: 'readLocales' });
      const locales = Array.isArray(answer.locales) ? (answer.locales as unknown[]).map((l) => (isObject(l) ? l.locale : l)) : null;
      if (typeof edit.locale !== 'string' || (locales && !locales.includes(edit.locale))) throw new AgentError('localeNotToPickFrom', `locale is one the Sheet knows${locales ? `: ${locales.join(', ')}` : ', such as "en-US"'}.`);
      return queued(context, { kind: 'setLocale', locale: edit.locale });
    }
    default:
      throw new AgentError('unreadableEdit', `"${kind}" is not an edit: ${EDIT_KINDS.join(', ')}.`);
  }
}

function sheetName(name: unknown): string {
  if (typeof name !== 'string' || name.trim() === '' || name.length > 100 || /[\u0000-\u001f]/.test(name)) throw new AgentError('sheetNameNotAllowed', 'name is a sheet name of 1 to 100 characters, with no line breaks.');
  return name;
}

function countOf(given: unknown): number {
  if (!Number.isInteger(given) || (given as number) < 1 || (given as number) > 100_000) throw new AgentError('unreadableEdit', 'count is a whole number, 1 or more.');
  return given as number;
}

function direction(given: unknown): string {
  if (given !== 'ascending' && given !== 'descending') throw new AgentError('unreadableEdit', 'direction is ascending or descending.');
  return given;
}

/** `ranges` of an edit: 1 to 1,000, no two sharing a cell. */
function rangesOf(view: SheetView, given: unknown): Block[] {
  if (!Array.isArray(given) || given.length === 0) throw new AgentError('rangeNotReadable', 'ranges is a list of ranges: ["A1:B1", "A4:B4"].');
  if (given.length > MAX_RANGES) throw new AgentError('tooManyRangesInAnEdit', `ranges holds at most ${MAX_RANGES}.`);
  const blocks = given.map((r) => view.range(r, 'each of ranges'));
  for (let i = 0; i < blocks.length; i++) {
    for (let j = 0; j < i; j++) if (overlap(blocks[i]!, blocks[j]!)) throw new AgentError('rangesShareACell', `${String(given[j])} and ${String(given[i])} share a cell.`);
  }
  return blocks;
}

const FORMAT_KEYS: Record<string, string[] | null> = {
  numberFormat: ['pattern'],
  alignment: ['horizontal', 'vertical', 'wrap'],
  fillColor: null,
  cellControl: null,
  border: ['top', 'left', 'bottom', 'right'],
  font: ['bold', 'italic', 'underline', 'strikethrough', 'size', 'color'],
};

function checkFormat(format: EngineMessage): void {
  for (const [key, value] of Object.entries(format)) {
    if (!(key in FORMAT_KEYS)) throw new AgentError('formatNotReadable', `format takes no "${key}": ${Object.keys(FORMAT_KEYS).join(', ')}.`);
    if (value === null) throw new AgentError('formatNotReadable', `Nothing in a format is null: to take ${key} away, send what a cell starts with.`);
    const inner = FORMAT_KEYS[key];
    if (inner) {
      if (!isObject(value)) throw new AgentError('formatNotReadable', `${key} is an object of ${inner.join(', ')}.`);
      for (const [k, v] of Object.entries(value)) {
        if (!inner.includes(k)) throw new AgentError('formatNotReadable', `${key} takes no "${k}": ${inner.join(', ')}.`);
        if (v === null) throw new AgentError('formatNotReadable', `Nothing in a format is null: to take ${key}.${k} away, send what a cell starts with.`);
      }
    }
    if (key === 'font' && isObject(value) && 'size' in value && (!Number.isInteger(value.size) || (value.size as number) < 6 || (value.size as number) > 96)) throw new AgentError('fontSizeNotAllowed', 'size is whole points, 6 to 96.');
  }
}

function dropdownOptions(given: unknown, withIds: boolean): EngineMessage[] {
  if (!Array.isArray(given) || given.length === 0 || given.length > 100) throw new AgentError('dropdownOptionsNotReadable', 'options is a list of 1 to 100 options: [{"label": "Done", "color": {"kind": "standard", "hue": "green", "shade": 200}}].');
  return given.map((option) => {
    if (!isObject(option)) throw new AgentError('dropdownOptionsNotReadable', 'Each option is {"label", "color"}.');
    checkKeys({ ...option, kind: 'option' }, withIds ? ['optionId', 'label', 'color'] : ['label', 'color']);
    if (typeof option.label !== 'string' || option.label === '') throw new AgentError('dropdownOptionLabelEmpty', 'An option\'s label has 1 to 100 characters.');
    if (!isObject(option.color)) throw new AgentError('dropdownOptionsNotReadable', 'color is {"kind": "standard", "hue", "shade"}, {"kind": "rgb", "hex"} or {"kind": "none"}.');
    return withIds ? { optionId: option.optionId ?? null, label: option.label, color: option.color } : { label: option.label, color: option.color };
  });
}

/** writeCells: a rectangle from topLeft; the sheet grows to hold it. */
function writeCells(view0: SheetView, topLeft: unknown, rows: unknown, context: EditContext): boolean {
  if (typeof topLeft !== 'string' || !CELL_ADDRESS.exec(topLeft)) throw new AgentError('addressNotReadable', 'topLeft is one cell, such as "A1".');
  if (!Array.isArray(rows) || rows.length === 0 || !rows.every((r) => Array.isArray(r) && r.length > 0)) throw new AgentError('rowsNotARectangle', 'rows is a list of rows, each a list of cells: [["Item", "Cost"], ["Rent", 1200]].');
  const width = (rows[0] as unknown[]).length;
  if (!rows.every((r) => (r as unknown[]).length === width)) throw new AgentError('rowsNotARectangle', 'Every row of rows has as many cells as the first: use null for a blank cell.');
  const at = parseRange(topLeft, 'topLeft');
  const block = { top: at.top, left: at.left, bottom: at.top + rows.length - 1, right: at.left + width - 1 };
  // A paste records an edit even where the cells hold what it writes: what changed is told by the sheet before and after.
  const sheetNow = () => JSON.stringify(context.read().sheets.find((s) => s.sheetId === view0.sheetId));
  const before = sheetNow();
  // Past the sheet's last row or column, the sheet grows by plain rows and columns.
  let view = view0;
  const moreRows = block.bottom + 1 - view.rowIds.length;
  const moreColumns = block.right + 1 - view.columnIds.length;
  if (moreRows > 0) context.queue({ kind: 'insertRows', sheetId: view.sheetId, afterRow: view.rowIds.at(-1), count: moreRows, formatsFromRow: null, groupsFromRow: null });
  if (moreColumns > 0) context.queue({ kind: 'insertColumns', sheetId: view.sheetId, afterColumn: view.columnIds.at(-1), count: moreColumns, formatsFromColumn: null, groupsFromColumn: null });
  if (moreRows > 0 || moreColumns > 0) view = sheetsOf(context.read()).find((s) => s.sheetId === view0.sheetId)!;
  const patterns = patternsOf(view);
  const kindOf = (pattern: string) => {
    const answer = context.utility({ kind: 'readKindOfPattern', pattern });
    return typeof answer.numberFormatKind === 'string' ? answer.numberFormatKind : null;
  };
  const texts: EngineMessage[] = [];
  const rich: { row: number; column: number; text: ReturnType<typeof richTextOfMarkdown> }[] = [];
  const shownToCheck: { row: number; column: number; shown: string }[] = [];
  (rows as unknown[][]).forEach((line, i) =>
    line.forEach((value, j) => {
      const [row, column] = [block.top + i, block.left + j];
      const where = a1(row, column);
      const cell = { r: view.rowIds[row], c: view.columnIds[column] };
      if (isObject(value) && typeof value.markdown === 'string' && Object.keys(value).length === 1) {
        const text = richTextOfMarkdown(value.markdown);
        if (!text) throw new AgentError('unreadableEdit', `${where}: the markdown is not read: **bold**, *italic*, ~~struck~~, <u>underlined</u> and [words](https://…), each closed.`, { address: where });
        rich.push({ row, column, text });
        return;
      }
      if (isObject(value) && typeof value.number === 'number' && typeof value.shown === 'string' && Object.keys(value).length === 2) shownToCheck.push({ row, column, shown: value.shown });
      texts.push({ ...cell, text: typedText(value, where, patterns.get(`${row},${column}`), kindOf) });
    }),
  );
  let changed = false;
  if (texts.length) changed = queued(context, { kind: 'pasteTexts', sheetId: view.sheetId, cells: texts, pastedTextIs: 'asTyped', localeOfTexts: 'en-US' }) || changed;
  for (const { row, column, text } of rich) {
    const cell = { r: view.rowIds[row], c: view.columnIds[column] };
    changed = queued(context, { kind: 'enterTextWithLooksInCells', cells: view.engineBlock({ top: row, bottom: row, left: column, right: column }), typedIn: cell, textWithLooks: text }) || changed;
  }
  if (shownToCheck.length) {
    const after = sheetsOf(context.read()).find((s) => s.sheetId === view.sheetId)!;
    // A number with no format has no shown text: it shows as written.
    const shownOf = (cell: EngineMessage) => (isObject(cell.shown) ? cell.shown.text : isObject(cell.input) && cell.input.kind === 'number' ? String(cell.input.value) : undefined);
    const shownAt = new Map(after.filled().map(({ row, column, cell }) => [`${row},${column}`, shownOf(cell)]));
    for (const { row, column, shown } of shownToCheck) {
      const now = shownAt.get(`${row},${column}`);
      if (now !== shown) throw new AgentError('shownIsNotWhatTheCellShows', `${a1(row, column)} would show ${JSON.stringify(now ?? '')}, not ${JSON.stringify(shown)}: a shown sets no format. Send the bare number, or a string such as "$12.50" that sets the format too.`, { address: a1(row, column) });
    }
  }
  return changed && sheetNow() !== before;
}

/** A cell of writeCells as the text a person types, the US way. */
function typedText(value: unknown, where: string, pattern: string | undefined, kindOf: (pattern: string) => string | null): string {
  if (value === null) return '';
  if (typeof value === 'string') {
    if (value === '') throw new AgentError('emptyText', `${where}: "" is no value: null clears a cell.`, { address: where });
    return value;
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') return bareNumber(value, where, pattern, kindOf);
  if (isObject(value)) {
    const keys = Object.keys(value).sort().join();
    if (keys === 'number,shown' && typeof value.number === 'number') return bareNumber(value.number, where, pattern, kindOf);
    if (keys === 'date' && typeof value.date === 'string') return dateText(value.date, where, /^\d{4}-\d{2}-\d{2}$/);
    if (keys === 'time' && typeof value.time === 'string') return dateText(value.time, where, /^\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?$/);
    if (keys === 'dateTime' && typeof value.dateTime === 'string') return dateText(value.dateTime.replace(/(Z|[+-]\d{2}:?\d{2})$/, '').replace('T', ' '), where, /^\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}(:\d{2}(\.\d+)?)?$/);
    if ((keys === 'formula,value' || keys === 'formula' || keys === 'formula,spill,value') && typeof value.formula === 'string') return value.formula.startsWith('=') ? value.formula : `=${value.formula}`;
    if ((keys === 'spilledFrom,value' || keys === 'spilledFrom') && typeof value.spilledFrom === 'string') return '';
    if ('user' in value) throw new AgentError('unreadableEdit', `${where}: people are not put in cells here: write the name as text.`, { address: where });
  }
  throw new AgentError('unreadableEdit', `${where}: a cell is null, a number, true or false, a string, or {"number", "shown"}, {"date"}, {"time"}, {"dateTime"}, {"markdown"}, {"formula"} as a read gives it.`, { address: where });
}

function dateText(text: string, where: string, pattern: RegExp): string {
  if (!pattern.test(text)) throw new AgentError('noSuchDateOrTime', `${where}: ${JSON.stringify(text)} is no date or time as written: 2026-03-15, 14:30:00, 2026-03-15T14:30:00.`, { address: where });
  return text;
}

/** A bare number keeps the cell's format: in a cell that shows percents, 7 is 700%. */
function bareNumber(n: number, where: string, pattern: string | undefined, kindOf: (pattern: string) => string | null): string {
  if (!Number.isFinite(n)) throw new AgentError('numberNotFinite', `${where}: ${n} is no number a cell holds.`, { address: where });
  if (pattern !== undefined && kindOf(pattern) === 'percent') return `${Number((n * 100).toPrecision(15))}%`;
  return String(n);
}

function restoreSheet(edit: EngineMessage, sheets: SheetView[], context: EditContext): void {
  if (typeof edit.sheet !== 'string' || edit.sheet === '') throw new AgentError('unknownDeletedSheetName', 'sheet is the name the deleted sheet had.');
  const want = edit.sheet.toLowerCase();
  const found = context.deletedSheets().find((d) => d.name.toLowerCase() === want && !sheets.some((s) => s.sheetId === d.sheetId));
  if (!found) throw new AgentError('unknownDeletedSheetName', `No deleted sheet was named "${edit.sheet}".`);
  const name = edit.name === undefined ? found.name : sheetName(edit.name);
  if (sheets.some((s) => s.name.toLowerCase() === name.toLowerCase())) {
    throw new AgentError('sheetNameTaken', `A sheet is named "${name}" now: bring it back under another name, {"kind": "restoreSheet", "sheet": "${found.name}", "name": "${found.name} (old)"}.`);
  }
  context.apply([{ kind: 'undeleteSheet', sheetId: found.sheetId }]);
  const back = sheetsOf(context.read()).find((s) => s.sheetId === found.sheetId);
  if (back && back.name !== name) context.queue({ kind: 'renameSheet', sheetId: found.sheetId, name });
}

function group(view: SheetView, given: unknown, of: 'rows' | 'columns', context: EditContext): boolean {
  if (!Array.isArray(given) || given.length === 0) throw new AgentError('unreadableEdit', `groups is a list: [{"${of}": "${of === 'rows' ? '2:3' : 'C:D'}", "isCollapsed": false}].`);
  if (given.length > 100) throw new AgentError('tooManyGroupsInAnEdit', 'groups holds at most 100.');
  let changed = false;
  for (const entry of given) {
    if (!isObject(entry)) throw new AgentError('unreadableEdit', `Each group is {"${of}", "isCollapsed"}.`);
    checkKeys({ ...entry, kind: 'group' }, [of, 'isCollapsed']);
    if (typeof entry.isCollapsed !== 'boolean') throw new AgentError('unreadableEdit', 'isCollapsed is true or false.');
    const now = sheetsOf(context.read()).find((s) => s.sheetId === view.sheetId)!;
    const [first, last] = of === 'rows' ? now.rows(entry[of], of) : now.columns(entry[of], of);
    const list = () => (of === 'rows' ? sheetsOf(context.read()).find((s) => s.sheetId === view.sheetId)!.contents.rowGroups : sheetsOf(context.read()).find((s) => s.sheetId === view.sheetId)!.contents.columnGroups) ?? [];
    const exact = () =>
      list().find((g) => {
        const span = now.lineSpan(g.ends, of);
        return span && span[0] === first && span[1] === last;
      });
    let found = exact();
    if (!found) {
      context.queue(of === 'rows' ? { kind: 'groupRows', sheetId: now.sheetId, oneRow: now.rowIds[first], otherRow: now.rowIds[last] } : { kind: 'groupColumns', sheetId: now.sheetId, oneColumn: now.columnIds[first], otherColumn: now.columnIds[last] });
      changed = true;
      found = exact();
    }
    if (found && found.isCollapsed !== entry.isCollapsed) {
      changed = queued(context, { kind: of === 'rows' ? 'setRowGroupsCollapsed' : 'setColumnGroupsCollapsed', sheetId: now.sheetId, groupIds: [found.groupId], isCollapsed: entry.isCollapsed }) || changed;
    }
  }
  return changed;
}

function setCellTable(view: SheetView, given: unknown, context: EditContext): boolean {
  const existing = view.contents.cellTables?.[0];
  if (given === null) {
    if (!existing) return false;
    return queued(context, { kind: 'removeCellTable', sheetId: view.sheetId, cellTableId: existing.cellTableId });
  }
  if (!isObject(given)) throw new AgentError('unreadableEdit', 'cellTable is {"columns": "A:G", "headerRows": "1", "footerRows": null}, or null for none.');
  checkKeys({ ...given, kind: 'cellTable' }, ['columns', 'headerRows', 'footerRows']);
  const [l, r] = view.columns(given.columns);
  const [ht, hb] = view.rows(given.headerRows, 'headerRows');
  const footer = given.footerRows === null ? null : view.rows(given.footerRows, 'footerRows');
  const cellTable = {
    headerRows: { firstRow: view.rowIds[ht], lastRow: view.rowIds[hb] },
    firstColumn: view.columnIds[l],
    lastColumn: view.columnIds[r],
    footerRows: footer ? { firstRow: view.rowIds[footer[0]], lastRow: view.rowIds[footer[1]] } : null,
  };
  if (existing) return queued(context, { kind: 'changeCellTable', sheetId: view.sheetId, cellTableId: existing.cellTableId, cellTable });
  return queued(context, { kind: 'declareCellTable', sheetId: view.sheetId, cellTable });
}

function replaceConditionalFormats(view: SheetView, inPlaceOf: unknown, rules: unknown, context: EditContext): boolean {
  const now = conditionalFormatsOf(view, context.answer);
  if (inPlaceOf !== now.fingerprint) {
    throw new AgentError('conditionalFormatsNotAsRead', `The rules of "${view.name}" read otherwise now than the list whose fingerprint is ${JSON.stringify(inPlaceOf)}: read them again, and start from what that gives.`);
  }
  if (!Array.isArray(rules)) throw new AgentError('conditionalFormatsHaveProblems', 'rules is a list of rules, [] for none.', { read: { kind: 'notAList', refusal: 'conditionalFormatNotRead' } });
  const others = context.read().sheets.reduce((n, s) => n + (s.sheetId === view.sheetId ? 0 : (s.conditionalFormats?.length ?? 0)), 0);
  if (others + rules.length + now.rulesWithoutAnAddress > MAX_RULES) throw new AgentError('tooManyConditionalFormats', `A workbook holds ${MAX_RULES} rules in all its sheets together.`);
  if (JSON.stringify(rules) === JSON.stringify(now.rules)) return false;
  let ids: unknown[] = [];
  if (rules.length) {
    const answer = context.answer({ kind: 'readConditionalFormatsInIds', sheetId: view.sheetId, written: rules });
    const read = isObject(answer.read) ? answer.read : answer;
    if (read.kind !== 'rules' || !Array.isArray(read.rules)) {
      const refusal = read.kind === 'notAList' && typeof read.refusal === 'string' ? read.refusal : 'conditionalFormatsHaveProblems';
      throw new AgentError(refusal === 'tooManyConditionalFormats' ? refusal : 'conditionalFormatsHaveProblems', 'The list cannot be read as rules of the sheet: data.read says what is wrong with each part. Write the whole list again.', { read });
    }
    ids = read.rules;
  }
  // The rules that have an address go; those with none (all their cells deleted) stay as they are.
  const listed = [...(view.contents.conditionalFormats ?? [])].sort((x, y) => (x.priority ?? 0) - (y.priority ?? 0));
  const addressed = listed.filter((r) => Array.isArray(r.liveRanges) ? r.liveRanges.length > 0 : true);
  const kept = now.rulesWithoutAnAddress > 0 ? new Set(listed.filter((r) => !addressed.includes(r))) : new Set();
  for (const rule of listed) if (!kept.has(rule)) context.queue({ kind: 'removeConditionalFormat', sheetId: view.sheetId, conditionalFormatId: rule.conditionalFormatId });
  if (ids.length) context.queue({ kind: 'addConditionalFormats', sheetId: view.sheetId, rules: ids });
  return true;
}