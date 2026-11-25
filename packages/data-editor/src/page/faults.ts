import { MAX_ERROR_MESSAGE_CHARACTERS, sanitizeText } from '@open-artifact/data-core';

export type PageFaultKind = 'stopped' | 'error' | 'rejection';

/** One kind of failure in the page's own code, and how many times it happened. */
export interface PageFault {
  kind: PageFaultKind;
  name: string;
  message: string;
  file?: string;
  /** The part of the page it happened in: the name of the drawing that threw. */
  where?: string;
  count: number;
}

/** A repeat raises its entry's count; `list()` hands out a new snapshot only when a new kind of fault arrives. */
export interface PageFaultTracker {
  record(kind: PageFaultKind, error: unknown, file?: string, where?: string): boolean;
  list(): readonly PageFault[];
}

/** What a stop in a `dash.onData` callback is labelled with. */
export const ON_DATA_CALLBACK_NAME = 'a dash.onData callback';
export const REMOVED_HELPERS_MESSAGE =
  'dash.format, dash.scale, dash.ticks, dash.path and dash.svg were removed. This page needs rewriting with d3 and Intl.NumberFormat.';
export const DRAW_ARGUMENTS_MESSAGE = 'dash.draw takes a name and a function or {mount, update, unmount}.';
export const LOADER_ARGUMENTS_MESSAGE = 'dash.loader takes a dataset id and {description, fn}.';
export const PAGE_FAULT_OTHER_CLASS = 'Error (other class)';

const PAGE_CODE_ERROR_CLASSES: readonly ErrorConstructor[] = [
  TypeError,
  RangeError,
  ReferenceError,
  SyntaxError,
  URIError,
  EvalError,
];
const EMPTY_PAGE_FAULTS: readonly PageFault[] = [];

/** The class of a thrown value, as the run report names it: a built-in error class, `Error`, or `value`. */
export function getPageFaultName(error: unknown): string {
  if (!(error instanceof Error)) return 'value';
  const name = PAGE_CODE_ERROR_CLASSES.find((type) => error instanceof type)?.name;
  if (name !== undefined) return name;
  return Object.getPrototypeOf(error) === Error.prototype ? 'Error' : PAGE_FAULT_OTHER_CLASS;
}

export function getPageFaultMessage(error: unknown): string {
  try {
    return sanitizeText(error instanceof Error ? error.message : String(error), MAX_ERROR_MESSAGE_CHARACTERS);
  } catch {
    return '';
  }
}

export function createPageFaultTracker(): PageFaultTracker {
  const entries = new Map<string, PageFault>();
  let snapshot = EMPTY_PAGE_FAULTS;
  return {
    record(kind, error, file, where) {
      const name = getPageFaultName(error);
      const key = JSON.stringify([kind, name, file ?? null, where ?? null]);
      const entry = entries.get(key);
      if (entry !== undefined) {
        entry.count++;
        return false;
      }
      entries.set(key, {
        kind,
        name,
        message: getPageFaultMessage(error),
        ...(file === undefined ? {} : { file }),
        ...(where === undefined || where === '' ? {} : { where }),
        count: 1,
      });
      snapshot = [...entries.values()].map((fault) => ({ ...fault }));
      return true;
    },
    list: () => snapshot,
  };
}

export function describeErrorMessage(error: unknown): string {
  if (error instanceof Error) return String(error.message);
  try {
    return String(error);
  } catch {
    return '';
  }
}

/** What the notes say of a page file (or a `dash.onData` callback) whose code stopped. */
export function describePageStop(file: string, error: unknown): string {
  if (file === ON_DATA_CALLBACK_NAME)
    return `This page’s code stopped (a dash.onData callback): ${describeErrorMessage(error)}`;
  return `This page’s code stopped (${file}): ${describeErrorMessage(error)}`;
}

export function describeMountFailure(error: unknown): string {
  return `This page couldn’t be shown: ${describeErrorMessage(error)}`;
}

export const NO_ENTRY_FILE_MESSAGE = 'This page has no index.html yet.';

/** The name a page file's scripts run under, so errors thrown later can be traced back to it. */
export function getDashboardSourceUrl(file: string): string {
  return `dash-page/${file}`;
}
