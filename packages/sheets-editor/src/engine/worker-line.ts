import type { Refused } from '@open-artifact/sheets-core';
import { withCellsTaken, type CoreRead } from './core-reads.ts';
import type { CellsPacked } from './packed-cells.ts';
import type { MessageToPage } from './workbook-host.ts';
import type { MessageToHost } from './worker-workbook.ts';

/** What a workbook's worker posts once it can take messages. */
export const WORKER_STARTED_MESSAGE = 'started';

export const NO_TRANSFER: StructuredSerializeOptions = { transfer: [] };

/** A line between two threads: messages one way (`Sent`) and the other (`Heard`). */
export interface WorkerLine<Sent, Heard> {
  send(message: Sent): void;
  onMessage(listener: (message: Heard) => void): void;
}

/**
 * A message of the worker with the cells of its readings beside it: the message as JSON, each reading's cells left
 * empty, and the cells of each sheet read, in the order of the readings and of their sheets.
 */
export interface MessageWithCells {
  text: string;
  blocks: CellsPacked[][];
}

/** What the page hears from a workbook's worker: a message with cells beside it, or a message as it is. */
export type PostedToPage = MessageWithCells | MessageToPage;

interface MessagePort {
  postMessage(message: unknown, options?: StructuredSerializeOptions): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

/** The cells of each sheet a reading has, in its order. */
export const cellsOfReading = (read: CoreRead): CellsPacked[][] =>
  read.kind === 'everything' ? read.contents.sheets.map(({ cells }) => cells) : read.sheets.map(({ cellsNow }) => cellsNow);

/** The message with the cells of each sheet its readings have taken in turn. */
export const withCellsOfReadings = ({ happened }: MessageToPage, takeCells: () => CellsPacked[]): MessageToPage => ({
  happened: happened.map((happening) =>
    happening.kind === 'read'
      ? {
          ...happening,
          reading: withCellsTaken(happening.reading, takeCells),
        }
      : happening,
  ),
});

/** A copy written and nothing read: the message goes as it is, without being written out as JSON. */
const isOnlyACopyWritten = ({ happened }: MessageToPage): boolean =>
  happened.some((happening) => happening.kind === 'answered' && happening.about === 'writtenCopy') &&
  happened.every(({ kind }) => kind !== 'read');

/**
 * The line of a workbook's worker to the page. The cells its readings have go beside the message, their buffers moved
 * to the page rather than copied; what the page sends is JSON.
 */
export const hostLine = (target: MessagePort): WorkerLine<MessageToPage, MessageToHost> => ({
  send(message) {
    if (isOnlyACopyWritten(message)) return target.postMessage(message, NO_TRANSFER);
    let blocks = message.happened.flatMap((happening) => (happening.kind === 'read' ? cellsOfReading(happening.reading) : []));
    let text = JSON.stringify(withCellsOfReadings(message, () => []));
    let posted: MessageWithCells = {
      text,
      blocks,
    };
    return target.postMessage(posted, {
      transfer: blocks.flat().map(({ lists }) => lists),
    });
  },
  onMessage: (listener) => target.addEventListener('message', ({ data }) => listener(JSON.parse(data))),
});

/** Runs one of the page's edits; an edit that throws is refused as every edit is now. */
export function runEditOrRefuse<Outcome, Refusal extends string>(
  workbook: { refusalOfEveryEdit(): Refusal | null },
  edit: () => Outcome,
  onThrown: (error: unknown) => void,
): Outcome | Refused<Refusal | 'savingStopped'> {
  try {
    return edit();
  } catch (error) {
    onThrown(error);
    return { kind: 'refused', refusal: workbook.refusalOfEveryEdit() ?? 'savingStopped' };
  }
}
