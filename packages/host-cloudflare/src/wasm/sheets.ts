/**
 * The Sheets engine on Workers: what `@open-artifact/wasm-sheets/node` is in Node, for the bundle (`deploy/cloudflare`
 * aliases that specifier here).
 *
 * Node reads the module's bytes from disk and compiles them; workerd refuses to compile WebAssembly from bytes at run
 * time ("Wasm code generation disallowed by embedder"), so the module is imported instead: the bundler leaves the
 * `.wasm` import to workerd, which compiles it when the Worker is uploaded and hands over a `WebAssembly.Module`.
 */
import { instantiateSheetsEngine, type SheetsEngine } from '../../../wasm-sheets/src/index.ts';
import compiled from '../../../wasm-sheets/generated/open_artifact_sheets_bg.wasm';

export type { EngineSession, PackedCellBlock, SheetsEngine } from '../../../wasm-sheets/src/index.ts';

let engine: SheetsEngine | null = null;

/** The engine, instantiated on first use. */
export function sheetsEngine(): SheetsEngine {
  engine ??= instantiateSheetsEngine(compiled);
  return engine;
}
