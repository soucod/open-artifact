/**
 * The agent's commands on a Sheet. Each is a call (`sheetCallOf`) that runs on a store (`runSheetCall`): the open
 * Sheet's, through the `call` action of a running server, or one made on the folder when none holds it:
 *
 * ```
 * read <dir> [payload] [--at <revision>]   one of the reads (readSheets when none is given), or a showGuide
 * update <dir> <payload>                   {"kind": "applyEdits", "base": n, "edits": [...]} ("kind" may be left out)
 * batch <dir> <calls>                      widget creates and one applyEdits, last; a create may give "codeFile"
 * widget <dir> create <code>               a chart's widget (code: a file, or - for stdin)
 * widget <dir> read <id>
 * widget <dir> draft <id> <basePub> <code>
 * widget <dir> list
 * export <dir> [file|folder] [--csv] [--sheet <name>]
 * info <dir>
 * ```
 *
 * A payload is JSON inline (starting with { or [), a file of it, or - for stdin. Each command answers a JSON value; a
 * refusal of the Sheet throws SheetRefusalError (its `body` is {detail, data: {refusal, …}, hint?}), a mistake in the
 * command itself SheetsCommandError.
 */

import fs from 'node:fs';
import path from 'node:path';
import { AgentError, GUIDE_KIND, isObject, type Json, type JsonObject, SheetRefusalError, type SheetWalkthrough } from '@open-artifact/sheets-core';
import { readMeta, SHEET_DIR, SheetStore } from './store.ts';

export const SHEETS_COMMANDS = ['read', 'update', 'batch', 'widget', 'export', 'info'] as const;
export type SheetsCommand = (typeof SHEETS_COMMANDS)[number];

/** The calls as the `call` action lists them for a Sheet. */
export const SHEET_ACTIONS = [
  {
    name: 'read',
    title: 'A read of the workbook: readSheets (the default), readCells, readCellFormats, readConditionalFormats, readCharts, readInteractive; or showGuide, a walkthrough for the owner\'s open page',
    effect: 'read',
    schema: { type: 'object', properties: { payload: { type: 'object' }, at: { type: 'integer', description: 'A revision to read at.' } } },
  },
  {
    name: 'update',
    title: 'Edits saved as one revision: {kind: "applyEdits", base, edits}',
    effect: 'write',
    schema: { type: 'object', properties: { payload: { type: 'object' } }, required: ['payload'] },
  },
  {
    name: 'batch',
    title: "Widget creates and one applyEdits, last (a new chart's widget and its addChart)",
    effect: 'write',
    schema: { type: 'object', properties: { calls: { type: 'array' } }, required: ['calls'] },
  },
  {
    name: 'widget',
    title: "A chart's code: verb create, read, draft or list",
    effect: 'write',
    schema: {
      type: 'object',
      properties: {
        verb: { type: 'string', enum: ['create', 'read', 'draft', 'list'] },
        id: { type: 'string' },
        basePub: { type: 'integer' },
        code: { type: 'string' },
        codeFile: { type: 'string', description: 'Absolute path of a file of chart code.' },
      },
      required: ['verb'],
    },
  },
  {
    name: 'info',
    title: "The Sheet's id, title and revision",
    effect: 'read',
    schema: { type: 'object', properties: {} },
  },
  {
    name: 'export',
    title: 'The Sheet as an Excel (or CSV) file, into <root>/exports/ unless a file or folder is given',
    effect: 'write',
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', description: 'Absolute path of the .xlsx or .csv file, or a folder.' },
        csv: { type: 'boolean' },
        sheet: { type: 'string', description: 'The sheet a CSV file holds.' },
      },
    },
  },
] as const;

/** A command given wrong: what to give instead. */
export class SheetsCommandError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'SheetsCommandError';
    this.code = code;
  }
}

export function isSheetsCommand(command: string): command is SheetsCommand {
  return (SHEETS_COMMANDS as readonly string[]).includes(command);
}

const usage = (...words: string[]): string => `open-artifact ${words.join(' ')}`;

/** Splits `--name value` flags (and bare `--name` switches) from the words. */
function splitFlags(args: readonly string[], valued: readonly string[]): { words: string[]; flags: Map<string, string | true> } {
  const words: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith('--')) {
      words.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (valued.includes(name)) {
      const value = args[++i];
      if (value === undefined) throw new SheetsCommandError('MISSING_VALUE', `--${name} takes a value.`);
      flags.set(name, value);
    } else flags.set(name, true);
  }
  return { words, flags };
}

function readStdin(): string {
  return fs.readFileSync(0, 'utf8');
}

/** A payload given on the command line: JSON inline (starts with { or [), a file, or - for stdin. */
function payloadOf(given: string, what: string): unknown {
  let text: string;
  if (/^\s*[[{]/.test(given)) text = given;
  else if (given === '-') text = readStdin();
  else {
    try {
      text = fs.readFileSync(path.resolve(given), 'utf8');
    } catch {
      throw new SheetsCommandError('NOT_FOUND', `${given} is not a file of ${what} (give the JSON itself, a file, or - for stdin).`);
    }
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new SheetsCommandError('NOT_JSON', `The ${what} is not JSON: ${(error as Error).message}`);
  }
}

/** The code of a widget, from a file or - (stdin): plain text as the agent wrote it, not JSON. */
function codeOf(given: string | undefined, how: string): string {
  if (given === undefined) throw new SheetsCommandError('MISSING_CODE', `Give the chart's code: ${how} (a file, or - for stdin).`);
  let text: string;
  if (given === '-') text = readStdin();
  else {
    try {
      text = fs.readFileSync(path.resolve(given), 'utf8');
    } catch {
      throw new SheetsCommandError('NOT_FOUND', `${given} is not a file of chart code (give a file, or - for stdin).`);
    }
  }
  if (!text.trim()) throw new SheetsCommandError('EMPTY_CODE', 'The code is empty.');
  return text;
}

/** Fails a command that only reads when the folder holds no Sheet yet. */
function needSheet(root: string): void {
  if (!readMeta(path.join(root, SHEET_DIR))) {
    throw new SheetsCommandError('NOT_A_SHEET', `${root} has no ${SHEET_DIR}/sheet.json: start it with an update (a new Sheet has one blank sheet, Sheet1).`);
  }
}

/** A batch's creates with "codeFile" (resolved against the batch file's folder) read into "code". */
function withCode(calls: unknown, from: string): unknown {
  if (!Array.isArray(calls)) return calls;
  return calls.map((call: unknown) => {
    if (!isObject(call) || !isObject(call.payload) || !('codeFile' in call.payload)) return call;
    const { codeFile, ...rest } = call.payload;
    if (typeof codeFile !== 'string') throw new SheetsCommandError('NOT_FOUND', 'codeFile is the path of a file of chart code.');
    const file = path.resolve(from, codeFile);
    let code: string;
    try {
      code = fs.readFileSync(file, 'utf8');
    } catch {
      throw new SheetsCommandError('NOT_FOUND', `${file} (codeFile) is not a file of chart code.`);
    }
    return { ...call, payload: { ...rest, code } };
  });
}

/** One of the agent's calls on a Sheet, with its arguments as the `call` action takes them. */
export interface SheetCall {
  name: SheetsCommand;
  args: JsonObject;
}

/** The calls that only read, and need a Sheet already; the others start one. */
function needsSheet(call: SheetCall): boolean {
  if (call.name === 'read' || call.name === 'export' || call.name === 'info') return true;
  return call.name === 'widget' && call.args.verb !== 'create';
}

/** Reads `codeFile` (a path, resolved against `from`) into `code`. */
function withCodeFile(args: JsonObject, from: string): JsonObject {
  if (!('codeFile' in args)) return args;
  const { codeFile, ...rest } = args;
  if (typeof codeFile !== 'string') throw new SheetsCommandError('NOT_FOUND', 'codeFile is the path of a file of chart code.');
  const file = path.resolve(from, codeFile);
  let code: string;
  try {
    code = fs.readFileSync(file, 'utf8');
  } catch {
    throw new SheetsCommandError('NOT_FOUND', `${file} (codeFile) is not a file of chart code.`);
  }
  return { ...rest, code };
}

/** The call a command line asks for: its payload, code and files read here, so the call can run anywhere. */
export function sheetCallOf(root: string, command: string, args: readonly string[] = []): SheetCall {
  if (!isSheetsCommand(command)) throw new SheetsCommandError('UNKNOWN_COMMAND', `A Sheet takes ${SHEETS_COMMANDS.join(', ')}; not "${command}".`);
  const folder = path.resolve(root);
  switch (command) {
    case 'info':
      return { name: command, args: {} };
    case 'read': {
      const { words, flags } = splitFlags(args, ['at']);
      const payload = (words[0] === undefined ? { kind: 'readSheets' } : payloadOf(words[0], 'read')) as Json;
      const given = flags.get('at');
      if (given === undefined) return { name: command, args: { payload } };
      const at = Number(given);
      if (!Number.isInteger(at) || at < 0) throw new SheetsCommandError('NOT_A_REVISION', '--at takes a revision: 0, 1, 2, …');
      return { name: command, args: { payload, at } };
    }
    case 'update': {
      const given = args[0];
      if (given === undefined) {
        throw new SheetsCommandError('MISSING_PAYLOAD', `Give the update: ${usage('update', folder, '\'{"kind": "applyEdits", "base": 1, "edits": [{"kind": "writeCells", "sheet": "Sheet1", "topLeft": "A1", "rows": [["Item", "Cost"]]}]}\'')} (or a file, or - for stdin).`);
      }
      return { name: command, args: { payload: payloadOf(given, 'update') as Json } };
    }
    case 'batch': {
      const given = args[0];
      if (given === undefined) {
        throw new SheetsCommandError('MISSING_PAYLOAD', `Give the batch: ${usage('batch', folder, 'chart.json')} (or - for stdin), [{"$lid": "w", "verb": "create", "payload": {"codeFile": "chart.jsx"}}, {"verb": "update", "payload": {"kind": "applyEdits", "base": <revision>, "edits": [{"kind": "addChart", "chart": {…, "widget": "$lid:w"}}]}}].`);
      }
      const from = given === '-' || /^\s*[[{]/.test(given) ? process.cwd() : path.dirname(path.resolve(given));
      return { name: command, args: { calls: withCode(payloadOf(given, 'batch'), from) as Json } };
    }
    case 'widget':
      return { name: command, args: widgetArgs(folder, args) };
    case 'export': {
      const { words, flags } = splitFlags(args, ['sheet']);
      const sheet = flags.get('sheet');
      return {
        name: command,
        args: {
          ...(words[0] !== undefined ? { file: path.resolve(words[0]) } : {}),
          ...(flags.has('csv') ? { csv: true } : {}),
          ...(typeof sheet === 'string' ? { sheet } : {}),
        },
      };
    }
  }
}

/** The arguments of a widget command: {verb, id?, basePub?, code?}. */
function widgetArgs(root: string, words: readonly string[]): JsonObject {
  const [verb, ...rest] = words;
  switch (verb) {
    case 'create':
      return { verb, code: codeOf(rest[0], usage('widget', root, 'create', 'chart.jsx')) };
    case 'read':
      if (!rest[0]) throw new SheetsCommandError('MISSING_ID', `Give the widget's id: ${usage('widget', root, 'read', '<id>')} (list gives them).`);
      return { verb, id: rest[0] };
    case 'draft': {
      const how = usage('widget', root, 'draft', '<id>', '<basePub>', 'chart.jsx');
      if (!rest[0]) throw new SheetsCommandError('MISSING_ID', `Give the widget's id: ${how}.`);
      const basePub = Number(rest[1]);
      if (!Number.isInteger(basePub) || basePub < 0) throw new SheetsCommandError('MISSING_PUB', `Give the pub a read of the widget gives: ${how}.`);
      return { verb, id: rest[0], basePub, code: codeOf(rest[2], how) };
    }
    case 'list':
      return { verb };
    default:
      throw new SheetsCommandError('UNKNOWN_ACTION', `widget takes create, read, draft or list: ${usage('widget', root, 'list')}.`);
  }
}

/** A widget call's arguments in the store's words: {action, widget?, basePub?, code?}. */
function widgetPayload(args: JsonObject): JsonObject {
  const { verb, id, ...rest } = withCodeFile(args, process.cwd());
  return { action: verb ?? null, ...(id !== undefined ? { widget: id } : {}), ...rest };
}

/** Writes an export where it was asked (a file, or a folder), `<root>/exports/` by default. */
function exportTo(store: SheetStore, root: string, args: JsonObject): Json {
  const given = typeof args.file === 'string' ? path.resolve(args.file) : undefined;
  const isFolder = given !== undefined && fs.existsSync(given) && fs.statSync(given).isDirectory();
  const csv = args.csv === true || (given !== undefined && /\.csv$/i.test(given));
  if (given !== undefined && !isFolder && !/\.(xlsx|csv)$/i.test(given)) {
    throw new SheetsCommandError('NOT_XLSX', 'export writes an .xlsx or .csv file: give a path ending in one, or a folder to put it in.');
  }
  if (csv && given !== undefined && /\.xlsx$/i.test(given)) throw new SheetsCommandError('NOT_CSV', '--csv writes a .csv file, not an .xlsx one.');
  const made = store.exportFile(csv ? 'csv' : 'xlsx', typeof args.sheet === 'string' ? { sheet: args.sheet } : {});
  const into = given === undefined ? path.join(root, 'exports') : isFolder ? given : null;
  const file = into === null ? given! : path.join(into, made.filename);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, made.bytes);
  return { file, bytes: made.bytes.length, ...(made.notCarriedOver.length > 0 ? { notCarriedOver: made.notCarriedOver } : {}) };
}

/**
 * What the place a call runs in gives it beyond the store. A running server knows the Sheet's page and who has it open;
 * a store made on the folder knows neither, so its reads carry no `frame` and a walkthrough is not shown.
 */
export interface SheetCallHost {
  /** The address of the Sheet's page: a read that lists the sheets gives it as `frame.artifactUrl`. */
  artifactUrl?: string;
  /** Shows a walkthrough on a page the owner has open; false when they have none open. */
  showWalkthrough?(walkthrough: SheetWalkthrough): boolean;
}

/** showGuide: the walkthrough checked against the workbook, then given to the owner's open page. Answers {shown}. */
function showGuide(store: SheetStore, payload: JsonObject, host: SheetCallHost): Json {
  const extra = Object.keys(payload).find((key) => key !== 'kind' && key !== 'guide');
  if (extra !== undefined || !('guide' in payload)) {
    const message = extra !== undefined ? `showGuide takes no "${extra}": its one key is guide.` : 'showGuide takes guide: {"stops": [{"at", "say"}]}.';
    throw SheetRefusalError.of(new AgentError('unreadableRead', message, extra !== undefined ? { key: extra } : {}));
  }
  const walkthrough = store.checkWalkthrough(payload.guide);
  return { shown: host.showWalkthrough?.(walkthrough) ?? false };
}

/**
 * Runs a call on a Sheet's store and answers its JSON. Throws SheetRefusalError when the Sheet refuses it,
 * SheetsCommandError when it is given wrong.
 */
export function runSheetCall(store: SheetStore, call: SheetCall, host: SheetCallHost = {}): unknown {
  const { args } = call;
  switch (call.name) {
    case 'info':
      return store.info();
    case 'read': {
      if (args.at !== undefined && (typeof args.at !== 'number' || !Number.isInteger(args.at) || args.at < 0)) {
        throw new SheetsCommandError('NOT_A_REVISION', 'at is a revision: 0, 1, 2, …');
      }
      const payload = args.payload ?? { kind: 'readSheets' };
      if (isObject(payload) && payload.kind === GUIDE_KIND) return showGuide(store, payload, host);
      const answer = store.agentRead(payload, args.at as number | undefined);
      return host.artifactUrl !== undefined && Array.isArray(answer.sheets) ? { ...answer, frame: { artifactUrl: host.artifactUrl } } : answer;
    }
    case 'update': {
      let { payload } = args;
      // {"base", "edits"} without its kind is an applyEdits all the same.
      if (isObject(payload) && !('kind' in payload) && 'edits' in payload) payload = { kind: 'applyEdits', ...payload };
      return store.agentUpdate(payload);
    }
    case 'batch':
      return store.agentBatch(withCode(args.calls, process.cwd()));
    case 'widget':
      return store.agentWidget(widgetPayload(args));
    case 'export':
      return exportTo(store, store.root, args);
  }
}

/** Fails a call that needs a Sheet when the folder holds none yet. */
export function assertSheetFor(root: string, call: SheetCall): void {
  if (needsSheet(call)) needSheet(root);
}

/**
 * Runs one of the agent's commands on the Sheet in `root` (the artifact's folder), on the folder directly, and
 * answers its JSON.
 */
export async function runSheetsCommand(root: string, command: string, args: readonly string[] = []): Promise<unknown> {
  const folder = path.resolve(root);
  const call = sheetCallOf(folder, command, args);
  assertSheetFor(folder, call);
  const store = new SheetStore({ root: folder });
  try {
    return runSheetCall(store, call);
  } finally {
    store.close();
  }
}
