import { wasmFileShape, errorWordOfModule, fileNotFetchedWord, type WasmFileShape } from '../model/refusals.ts';
import { SHEETS_MODULE_URL } from '@open-artifact/wasm-sheets/module-url';
import { createSheetsUtilities, createWorkbookSessionCore, type SheetsUtilities, type WorkbookCore } from './wasm-bindings.ts';
import type { PostedToPage, WorkerLine } from './worker-line.ts';
import type { MessageToPage } from './workbook-host.ts';
import type { MessageToHost } from './worker-workbook.ts';

/** A message heard from the workbook's worker, with the cells of its readings put back in place. */
export function readWorkerMessage(data: PostedToPage): MessageToPage {
  if (!('text' in data)) return data;
  return withCellsOfReadings(parseWorkerJson(data.text), () => data.blocks.shift() ?? []);
}
/** What fetches the page's files, and waits between tries. */
export interface AssetFetcher {
  fetch(path: URL, options: RequestInit): Promise<Response>;
  wait(ms: number): Promise<void>;
}

/** A file's bytes, the status it was refused with, or `null` when no answer came. */
export type FetchAnswer = ArrayBuffer | number | null;

/** A workbook's worker once it has started: the line to it, and its end. */
export interface StartedWorker {
  line: WorkerLine<MessageToHost, MessageToPage>;
  onEnded(callback: () => void): void;
  end(): void;
}

/** The engine as loaded: its utilities, and how to make a workbook's core here or on a worker. */
export interface LoadedSheetsEngine {
  kind: 'loaded';
  utilities: SheetsUtilities;
  newCore: () => Promise<WorkbookCore>;
  startWorkbookWorker(): Promise<StartedWorker | null>;
  takeMendedAfter(): string | null;
}

/** What came of loading the engine. */
export type SheetsEngineLoad =
  | { kind: 'noWebAssembly' }
  | LoadedSheetsEngine
  | { kind: 'notFetched'; badBytes: string | null }
  | { kind: 'failed'; what: string };

export type WorkerStarter = (modulePromise: Promise<WebAssembly.Module>) => Promise<StartedWorker | null>;

export async function fetchWithTimeout(path: string | URL, fetcher: AssetFetcher, skipsCache: boolean): Promise<FetchAnswer> {
  let controller = new AbortController();
  let timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    let options: RequestInit = {
      signal: controller.signal,
      ...(skipsCache && {
        cache: 'reload',
      }),
    };
    let response = await fetcher.fetch(path instanceof URL ? path : new URL(path, import.meta.url), options);
    return response.ok ? await response.arrayBuffer() : response.status;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
export function fetchAssetWithRetry(
  path: string | URL,
  fetcher: AssetFetcher = defaultAssetFetcher,
  earlyAnswer?: FetchAnswer,
  checkBytes: (bytes: ArrayBuffer) => string | null = () => null,
): Promise<ArrayBuffer> {
  let fetchAttempt = async (attempt: number, firstBadBytes: string | null): Promise<ArrayBuffer> => {
    let isEarly = attempt === 0 && earlyAnswer !== undefined;
    let answer = isEarly ? (earlyAnswer as FetchAnswer) : await fetchWithTimeout(path, fetcher, firstBadBytes !== null);
    let badBytes = answer instanceof ArrayBuffer ? checkBytes(answer) : null;
    if (answer instanceof ArrayBuffer && badBytes === null) {
      if (isEarly) buffersFetchedEarly.add(answer);
      if (firstBadBytes !== null) badBytesBeforeMending.set(answer, firstBadBytes);
      return answer;
    }
    let status = answer instanceof ArrayBuffer ? null : answer;
    let isRetryable = status === null || RETRYABLE_STATUSES.has(status);
    let delay = isRetryable ? FETCH_RETRY_DELAYS[attempt] : undefined;
    if (delay === undefined) throw new ChunkFetchError(path, status, isRetryable, isEarly, badBytes);
    await fetcher.wait(delay);
    return fetchAttempt(attempt + 1, firstBadBytes ?? badBytes);
  };
  return fetchAttempt(0, null);
}
export function wasmBytesProblem(bytes: ArrayBuffer): Exclude<WasmFileShape, 'whole'> | null {
  try {
    let shape = wasmFileShape(bytes);
    return shape === 'whole' ? null : shape;
  } catch {
    return null;
  }
}
export function fetchSheetsCoreWasm(fetcher?: AssetFetcher): Promise<ArrayBuffer> {
  return fetchAssetWithRetry(SHEETS_MODULE_URL, fetcher, undefined, wasmBytesProblem);
}
/** Reports an error the page goes on after, without stopping what it was doing. */
export function reportErrorSoftly(error: unknown, _place: string | null): void {
  if (typeof reportError === 'function') reportError(error);
  else void Promise.reject(error);
}
const newWorkbookWorker = (): Worker => new Worker(new URL('../workbook-worker.ts', import.meta.url), { type: 'module' });
export function startWorkbookWorker(modulePromise: Promise<WebAssembly.Module>, newWorker: () => Worker = newWorkbookWorker): Promise<StartedWorker | null> {
  if (typeof Worker === 'undefined') return Promise.resolve(null);
  let worker: Worker;
  try {
    worker = newWorker();
  } catch (error: unknown) {
    reportErrorSoftly(error, 'worker');
    return Promise.resolve(null);
  }
  let hasModule: boolean = false;
  let hasStarted: boolean = false;
  let isEnded: boolean = false;
  let hasFailed: boolean = false;
  let whenEnded: (() => void) | null = null;
  let endWorker = () => {
    isEnded = true;
    worker.terminate();
  };
  return new Promise<StartedWorker | null>((resolve) => {
    let startTimer: ReturnType<typeof setTimeout> | undefined;
    worker.addEventListener('error', (errorEvent: ErrorEvent) => {
      if (isEnded) return;
      if (!hasModule) {
        endWorker();
        return resolve(
          modulePromise.then(
            () => startWorkbookWorker(modulePromise, newWorker),
            () => null,
          ),
        );
      }
      let error = Error(`the workbook’s worker failed: ${errorEvent.message}`);
      if (!hasStarted) error.name = CHUNK_LOAD_ERROR_NAME;
      reportErrorSoftly(error, 'worker');
      hasFailed = true;
      endWorker();
      whenEnded?.();
      resolve(null);
    });
    worker.addEventListener(
      'message',
      ({ data }: MessageEvent) => {
        clearTimeout(startTimer);
        if (data !== WORKER_STARTED_MESSAGE) {
          endWorker();
          return resolve(null);
        }
        hasStarted = true;
        return resolve({
          line: workerLine(worker),
          onEnded(callback) {
            whenEnded = callback;
            if (hasFailed) callback();
          },
          end: endWorker,
        });
      },
      {
        once: true,
      },
    );
    let giveUp = () => {
      endWorker();
      resolve(null);
    };
    (async (): Promise<void> => {
      let compiledWasm: WebAssembly.Module;
      try {
        compiledWasm = await modulePromise;
      } catch {
        return giveUp();
      }
      hasModule = true;
      if (isEnded) return;
      let startMessage = {
        module: compiledWasm,
        timeOriginMs: performance.timeOrigin,
      };
      try {
        worker.postMessage(startMessage, NO_TRANSFER);
      } catch (error: unknown) {
        reportErrorSoftly(error, 'worker');
        return giveUp();
      }
      startTimer = setTimeout(giveUp, WORKER_START_TIMEOUT_MS);
    })();
  });
}
export async function loadSheetsEngine(
  fetchWasm: () => Promise<ArrayBuffer>,
  startWorker: WorkerStarter,
  createUtilities: (wasmModule: WebAssembly.Module) => Promise<SheetsUtilities>,
): Promise<SheetsEngineLoad> {
  if (typeof WebAssembly === 'undefined')
    return {
      kind: 'noWebAssembly',
    };
  let workerStart: Promise<StartedWorker | null> | null = null;
  let fetchedBytes: ArrayBuffer | null = null;
  try {
    let bytesFetched = fetchWasm();
    let moduleCompiled = bytesFetched.then((bytes) => WebAssembly.compile(bytes));
    moduleCompiled.catch(() => {});
    workerStart = startWorker(moduleCompiled);
    let bytes = await bytesFetched;
    fetchedBytes = bytes;
    let wasmModule = await moduleCompiled;
    return {
      kind: 'loaded',
      utilities: await createUtilities(wasmModule),
      newCore: newCoreFrom(wasmModule),
      startWorkbookWorker() {
        let worker = workerStart ?? startWorker(moduleCompiled);
        workerStart = null;
        return worker;
      },
      takeMendedAfter() {
        let badBytes = badBytesBeforeMending.get(bytes) ?? null;
        badBytesBeforeMending.delete(bytes);
        return badBytes;
      },
    };
  } catch (error: unknown) {
    reportErrorSoftly(error, 'engine');
    workerStart?.then((startedWorker) => startedWorker?.end());
    if (error instanceof ChunkFetchError)
      return error.mayPass
        ? {
            kind: 'notFetched',
            badBytes: error.badBytes,
          }
        : {
            kind: 'failed',
            what: error.what,
          };
    let wasFetchedEarly = fetchedBytes !== null && buffersFetchedEarly.has(fetchedBytes);
    return {
      kind: 'failed',
      what: errorWordOfModule(error, fetchedBytes, wasFetchedEarly),
    };
  }
}
export function memoizeEngineLoad(
  fetchWasm: () => Promise<ArrayBuffer>,
  startWorker: WorkerStarter = () => Promise.resolve(null),
  createUtilities: (wasmModule: WebAssembly.Module) => Promise<SheetsUtilities> = createSheetsUtilities,
): () => Promise<SheetsEngineLoad> {
  let loading: Promise<SheetsEngineLoad> | null = null;
  return () =>
    (loading ??= loadSheetsEngine(fetchWasm, startWorker, createUtilities).then((loaded) => {
      if (loaded.kind === 'notFetched') loading = null;
      return loaded;
    }));
}
export { WORKER_STARTED_MESSAGE, NO_TRANSFER, withCellsOfReadings } from './worker-line.ts';
import { WORKER_STARTED_MESSAGE, NO_TRANSFER, withCellsOfReadings } from './worker-line.ts';
export const parseWorkerJson: (text: string) => MessageToPage = JSON.parse;
/** The page's line to the workbook's worker: what it sends is JSON; what it hears may have cells beside it. */
export const workerLine = (worker: Worker): WorkerLine<MessageToHost, MessageToPage> => ({
  send: (message) => worker.postMessage(JSON.stringify(message), NO_TRANSFER),
  onMessage: (listener) => worker.addEventListener('message', ({ data }: MessageEvent<PostedToPage>) => listener(readWorkerMessage(data))),
});
export const RETRYABLE_STATUSES = new Set<number>([401, 403, 408, 429, 502, 503, 504]);
export const FETCH_RETRY_DELAYS = [1500, 6000];
export const FETCH_TIMEOUT_MS = 30000;
export const defaultAssetFetcher: AssetFetcher = {
  fetch: (path, options) => fetch(path, options),
  wait: (ms) => new Promise<void>((resolve) => void setTimeout(resolve, ms)),
};
export const CHUNK_LOAD_ERROR_NAME = 'ChunkLoadError';
export const ChunkFetchError = class ChunkFetchError extends Error {
  override name: string = CHUNK_LOAD_ERROR_NAME;
  mayPass: boolean;
  what: string;
  badBytes: string | null;
  constructor(path: string | URL, fetchStatus: number | null, mayPass: boolean, wasEarly: boolean, badBytes: string | null) {
    super(`${path} was not fetched (${badBytes === null ? String(fetchStatus) : `body: ${badBytes}`})`);
    this.mayPass = mayPass;
    this.what = fileNotFetchedWord(fetchStatus, wasEarly);
    this.badBytes = badBytes;
  }
};
export const buffersFetchedEarly = new WeakSet<ArrayBuffer>();
export const badBytesBeforeMending = new WeakMap<ArrayBuffer, string>();
export const reportErrorsSoftlyAt =
  (place: string | null) =>
  (error: unknown): void =>
    reportErrorSoftly(error, place);
export const newCoreFrom =
  (wasm: WebAssembly.Module) =>
  (): Promise<WorkbookCore> =>
    createWorkbookSessionCore(wasm);
export const WORKER_START_TIMEOUT_MS = 5000;
export const loadSheetsEngineOnce = memoizeEngineLoad(fetchSheetsCoreWasm, startWorkbookWorker);
