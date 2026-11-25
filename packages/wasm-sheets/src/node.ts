/**
 * The engine in Node: the module read from disk. A bundled CLI sets
 * `OPEN_ARTIFACT_SHEETS_WASM` (or ships the file as `sheets.wasm` beside
 * itself); unbundled, it is read from `generated/`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { instantiateSheetsEngine, type SheetsEngine } from './index.ts';

export type { EngineSession, PackedCellBlock, SheetsEngine } from './index.ts';

const FILE = 'open_artifact_sheets_bg.wasm';

function modulePath(): string {
  const named = process.env.OPEN_ARTIFACT_SHEETS_WASM;
  if (named) return named;
  const beside = fileURLToPath(new URL('./sheets.wasm', import.meta.url));
  if (existsSync(beside)) return beside;
  return fileURLToPath(new URL(`../generated/${FILE}`, import.meta.url));
}

let engine: SheetsEngine | null = null;

/** The engine, instantiated on first use. */
export function sheetsEngine(): SheetsEngine {
  engine ??= instantiateSheetsEngine(new WebAssembly.Module(readFileSync(modulePath())));
  return engine;
}
