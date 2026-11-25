/// <reference lib="webworker" />
import { hostWorkbook, inWords, type MessageToPage } from './engine/workbook-host.ts';
import { WORKER_STARTED_MESSAGE, NO_TRANSFER, hostLine, type WorkerLine } from './engine/worker-line.ts';
import { writeCopy } from './engine/written-copy.ts';
import type { MessageToHost } from './engine/worker-workbook.ts';
import { createSheetsUtilities, createWorkbookSessionCore } from './engine/wasm-bindings.ts';
import { newIdCode } from './engine/core-reads.ts';

interface WorkerStart {
  module: WebAssembly.Module;
  timeOriginMs: number;
}

// This file runs as a dedicated worker, though the page's types see `self` as a window.
const scope = self as typeof self & DedicatedWorkerGlobalScope;

// LAN guests load workers over HTTP. getRandomValues is available there in both Window and Worker.
function newEditId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 15) | 64;
  bytes[8] = (bytes[8]! & 63) | 128;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

function start({ data }: MessageEvent<WorkerStart>): void {
  const line: WorkerLine<MessageToPage, MessageToHost> = hostLine(scope);
  scope.addEventListener('unhandledrejection', ({ reason }) => line.send({ happened: [{ kind: 'threw', inWords: inWords(reason) }] }));
  hostWorkbook({
    line,
    newCore: () => createWorkbookSessionCore(data.module),
    loadUtilities: () => createSheetsUtilities(data.module),
    newEditId,
    newIdCode,
    wait: (ms) => new Promise((resolve) => void setTimeout(resolve, ms)),
    nowMs: () => performance.timeOrigin + performance.now() - data.timeOriginMs,
    calculateLater: (calculate) => void setTimeout(calculate),
    writeCopy,
  });
  scope.postMessage(WORKER_STARTED_MESSAGE, NO_TRANSFER);
}

scope.addEventListener('message', start, { once: true });
