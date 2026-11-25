/**
 * The Sheets workbook engine (`crates/open-artifact-sheets`). Everything
 * crosses as JSON text: a request goes in, its answer comes out. Instantiate
 * once with the module's bytes (or a compiled module), then make sessions.
 */

import * as glue from '../generated/open_artifact_sheets.js';

/**
 * One block of cells from a packed read: little-endian lists of numbers and the block's texts, which the lists
 * point into. An answer names its blocks by the order they came in, from 0.
 */
export interface PackedCellBlock {
  lists: Uint8Array;
  texts: string;
}

/** One workbook and every request about it. */
export interface EngineSession {
  /** A request about this workbook, as JSON text; its answer, as JSON text. */
  answerJson(request: string): string;
  /**
   * The same, for a request whose answer may carry cells in blocks (`readWorkbookWithCellsPacked`,
   * `readRowsWithCellsPacked`): each block goes to `take` before the answer comes back.
   */
  answerWithCells(request: string, take: (block: PackedCellBlock) => void): string;
  /** Frees the workbook; the session cannot be used afterwards. */
  free(): void;
}

/** The engine, instantiated. */
export interface SheetsEngine {
  /** A new, empty workbook session. */
  session(): EngineSession;
  /** A request that needs no workbook (locales, number formats, time zones…), as JSON text. */
  utilityJson(request: string): string;
  /** Every function a formula may call, as JSON text. */
  functionDescriptionsJson(): string;
}

let instantiated = false;

function engineOf(): SheetsEngine {
  return {
    session: () => {
      const session = new glue.WorkbookSession();
      return {
        answerJson: (request) => session.answerJson(request),
        // The lists arrive as a view of the module's memory, which the next call may move: keep a copy.
        answerWithCells: (request, take) =>
          session.answerWithCells(request, { take: (lists: Uint8Array, texts: string) => take({ lists: lists.slice(), texts }) }),
        free: () => session.free(),
      };
    },
    utilityJson: (request) => glue.answerUtilityRequestJson(request),
    functionDescriptionsJson: () => glue.functionDescriptionsJson(),
  };
}

/** Instantiates the engine from the module's bytes or a compiled module (once per realm). */
export function instantiateSheetsEngine(module: BufferSource | WebAssembly.Module): SheetsEngine {
  if (!instantiated) {
    glue.initSync({ module });
    instantiated = true;
  }
  return engineOf();
}

/** Fetches and instantiates the engine (a page's worker). */
export async function loadSheetsEngine(url: string | URL): Promise<SheetsEngine> {
  if (!instantiated) {
    await glue.default({ module_or_path: url });
    instantiated = true;
  }
  return engineOf();
}
