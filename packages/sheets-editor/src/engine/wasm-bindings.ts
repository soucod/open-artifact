import { instantiateSheetsEngine, type PackedCellBlock, type SheetsEngine } from '@open-artifact/wasm-sheets';
import type {
  AnswerOf,
  CellBlockIndex,
  PackedReadKind,
  PackedReadRequest,
  Refused,
  RowsWithCellsPackedAnswer,
  SessionRequest,
  SheetContentsWithCellsPacked,
  UtilityAnswerOf,
  UtilityRequest,
  WorkbookContentsWithCellsPacked,
} from '@open-artifact/sheets-core';
import type { CellsPacked } from './packed-cells.ts';

/** A sheet of a packed read, its blocks of cells in place of their indexes. */
export interface SheetContentsWithBlocks extends Omit<SheetContentsWithCellsPacked, 'cells'> {
  cells: CellsPacked[];
}
/** The workbook as a packed read gives it, each sheet's blocks of cells in place of their indexes. */
export interface WorkbookContentsWithBlocks extends Omit<WorkbookContentsWithCellsPacked, 'sheets'> {
  sheets: SheetContentsWithBlocks[];
}
/** Rows as a packed read gives them, the blocks of cells in place of their indexes. */
export interface RowsWithBlocksAnswer extends Omit<RowsWithCellsPackedAnswer, 'cells'> {
  cells: CellsPacked[];
}
/** Each packed read's answer once its blocks are put in place. */
export interface AnswersWithBlocks {
  readWorkbookWithCellsPacked: WorkbookContentsWithBlocks;
  readRowsWithCellsPacked: RowsWithBlocksAnswer;
}
/** The answer a session request gets: as the engine writes it, with a packed read's blocks of cells in place. */
export type SessionAnswerOf<R extends SessionRequest> = R extends PackedReadRequest
  ? R['kind'] extends PackedReadKind
    ? AnswersWithBlocks[R['kind']] | Refused
    : never
  : AnswerOf<R>;

/** Anything that answers the requests of a workbook's session, typed by the request's kind. */
export interface SessionAnswers {
  answer<R extends SessionRequest>(request: R): SessionAnswerOf<R>;
}

/** One workbook in the engine: a request in, its answer out. */
export interface WorkbookCore extends SessionAnswers {
  answerJson(requestJson: string): string;
}

/** The engine's requests that need no workbook. */
export interface SheetsUtilities {
  answer<R extends UtilityRequest>(request: R): UtilityAnswerOf<R>;
}

/** Where an answer names blocks of cells: in each of its sheets, or in itself. */
interface CellsOfAnAnswer {
  sheets?: { cells: (CellBlockIndex | CellsPacked)[] }[];
  cells: (CellBlockIndex | CellsPacked)[];
}

const engineOf = (module: WebAssembly.Module | BufferSource): SheetsEngine => instantiateSheetsEngine(module);

export async function createWorkbookSessionCore(module: WebAssembly.Module | BufferSource): Promise<WorkbookCore> {
  const session = engineOf(module).session();
  return {
    answer(request) {
      let blocks: CellsPacked[] = [];
      let take = ({ lists, texts }: PackedCellBlock) =>
        blocks.push({
          lists: lists.slice().buffer,
          texts,
        });
      let answer: CellsOfAnAnswer = JSON.parse(session.answerWithCells(JSON.stringify(request), take));
      // Until they are put in place, the cells of an answer are the indexes of its blocks.
      if (blocks.length > 0) for (let sheet of answer.sheets ?? [answer]) sheet.cells = sheet.cells.map((index) => blocks[index as CellBlockIndex]);
      // A packed read's answer now holds its blocks where it named them; every other answer is as written.
      return answer as SessionAnswerOf<typeof request>;
    },
    answerJson: (requestJson) => session.answerJson(requestJson),
  };
}

export async function createSheetsUtilities(module: WebAssembly.Module | BufferSource): Promise<SheetsUtilities> {
  const engine = engineOf(module);
  return {
    answer: (request) => JSON.parse(engine.utilityJson(JSON.stringify(request))),
  };
}
