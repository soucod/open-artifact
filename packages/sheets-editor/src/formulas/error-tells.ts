import type { CauseCell, CauseOfError, CellAt, ErrorValue, SpillContents } from '@open-artifact/sheets-core';
import type { ErrorTell } from '../messages/formula-errors.ts';
import type { CauseOfErrorSaid, CellId } from '../model/workbook.ts';
import type { CellPosition } from '../selection/model.ts';
import type { ErrorExplained } from '../state/initial-state.ts';
import { cellValueOf } from '../model/cell-values.ts';
import { resolvePlaceArea } from '../agent/changes-by-agent.ts';
import { spanOfIndexes } from '../model/a1-references.ts';
import { areaToA1AsStored } from './from-words/where.ts';
import { sheetPrefixForFormula } from './references.ts';
import { readsAsStored } from '../model/workbook.ts';
import { findFormulaFault } from './typed-faults.ts';
import type { WorkbookReads } from '../model/workbook.ts';
/** A cell to read the error of, as `cellValueOf` reads it. */
export type CellWithErrorToRead = Parameters<typeof cellValueOf>[0];
/**
 * A cause of a formula's error to explain: one the engine tells, or one of the kinds it may yet tell, which are
 * explained when they come.
 */
export type CauseOfErrorToExplain =
  | CauseOfError
  | { kind: 'holdsANestedSubtotal'; cell: CauseCell }
  | { kind: 'noSuchCell'; address: string }
  | { kind: 'severalCellsForOneValue'; function: string; argument: string | null }
  | { kind: 'operandsOfDifferentSizes' }
  | { kind: 'noSuchColumnToSortBy'; function: string; range: string; columns: number; column: number }
  | { kind: 'sortOrderIsNotRead'; function: string; order: string }
  | { kind: 'functionCodeSkipsHiddenRows'; function: string; functionCode: number; codeThatCountsHiddenRows: number }
  | { kind: 'argumentIsNoReference'; function: string; argument: string }
  | { kind: 'wordIsNotRead'; function: string; word: string }
  | { kind: 'pivotTotalsNothing' | 'pivotWithColumnsTotalsSeveral' };
/** A cause that lies in another cell. */
export type CauseAtCell = Extract<CauseOfErrorToExplain, { cell: CauseCell }>;
/** A cell a formula's error comes from, where it is, and how the formula's sheet writes it. */
export interface CellWrittenFor {
  cellId: CellId;
  at: CellPosition;
  written: string;
}
export function errorCodeOfCell(cell: CellWithErrorToRead): ErrorValue | null {
  let value = cellValueOf(cell);
  return value?.kind === 'error' ? value.value : null;
}
export function showsRealError(cell: CellWithErrorToRead): boolean {
  let errorCode = errorCodeOfCell(cell);
  return errorCode !== null && errorCode !== '#TIMEOUT!';
}
/** Why an array cannot spill when two filled cells or more are in its way, or `null` when only one is. */
export function explainFilledCellsInTheWay(reads: WorkbookReads, formulaCell: CellId, bottomRight: CellAt): ErrorTell | null {
  let { sheetId } = formulaCell;
  let cells = {
    topLeft: {
      r: formulaCell.rowId,
      c: formulaCell.columnId,
    },
    bottomRight,
  };
  let spillArea =
    resolvePlaceArea(
      {
        sheetId,
        cells,
      },
      reads,
    )?.area ?? null;
  let inTheWay = (spillArea === null ? [] : reads.filledCellsIn(sheetId, spillArea))
    .filter(({ rowId, columnId }) => rowId !== formulaCell.rowId || columnId !== formulaCell.columnId)
    .flatMap((cellId) => reads.positionOfCell(cellId) ?? []);
  if (inTheWay.length < 2) return null;
  let rowSpan = spanOfIndexes(inTheWay.map(({ rowIndex }) => rowIndex));
  let columnSpan = spanOfIndexes(inTheWay.map(({ columnIndex }) => columnIndex));
  let [topRow, leftColumn] = [rowSpan.firstIndex, columnSpan.firstIndex];
  if (topRow === spillArea?.topRowIndex && leftColumn === spillArea.leftColumnIndex) {
    if (inTheWay.length > MAX_FEW_CELLS_IN_THE_WAY)
      return {
        cause: 'manyFilledCellsOnTwoSidesInTheWay',
        count: inTheWay.length,
      };
    inTheWay.sort(
      (one, other) => (one.rowIndex === other.rowIndex ? one.columnIndex - other.columnIndex : one.rowIndex - other.rowIndex),
    );
    return {
      cause: 'fewFilledCellsOnTwoSidesInTheWay',
      cells: inTheWay.map(addressOfPosition),
    };
  }
  return {
    cause: 'filledCellsInTheWay',
    count: inTheWay.length,
    cells: areaToA1AsStored(
      {
        topRowIndex: topRow,
        leftColumnIndex: leftColumn,
        rowCount: rowSpan.count,
        columnCount: columnSpan.count,
      },
      null,
    ),
  };
}
export function explainBlockedSpill(
  reads: WorkbookReads,
  formulaCell: CellId,
  { by, wouldFillTo }: Extract<SpillContents, { kind: 'blocked' }>,
): ErrorTell | null {
  let { sheetId } = formulaCell;
  if (by.kind === 'endOfSheet')
    return {
      cause: 'sheetEndsTooSoon',
    };
  let position = reads.positionOfCell({
    sheetId,
    rowId: by.cell.r,
    columnId: by.cell.c,
  });
  if (position === null) return null;
  let address = addressOfPosition(position);
  switch (by.kind) {
    case 'filledCell':
      return (
        explainFilledCellsInTheWay(reads, formulaCell, wouldFillTo) ?? {
          cause: 'filledCellInTheWay',
          cell: address,
        }
      );
    case 'earlierFormula':
      return {
        cause: 'earlierFormulaKeepsTheCells',
        cell: address,
      };
  }
}
export function cellWrittenFor(
  reads: WorkbookReads,
  formulaCell: CellId,
  { sheetId, cell: { r: rowId, c: columnId } }: CauseCell,
): CellWrittenFor | null {
  let cellId: CellId = {
    sheetId,
    rowId,
    columnId,
  };
  let position = reads.positionOfCell(cellId);
  if (position === null) return null;
  let address = addressOfPosition(position);
  if (sheetId === formulaCell.sheetId)
    return {
      cellId,
      at: position,
      written: address,
    };
  let sheetName = reads.listSheets().find((summary) => summary.sheetId === sheetId)?.name;
  if (sheetName === undefined) return null;
  return {
    cellId,
    at: position,
    written: `${sheetPrefixForFormula(sheetName)}${address}`,
  };
}
export function explainCauseAtCell(reads: WorkbookReads, formulaCell: CellId, { kind, cell }: CauseAtCell): ErrorTell | null {
  let written = cellWrittenFor(reads, formulaCell, cell);
  if (written === null) return null;
  let { cellId, at: position, written: address } = written;
  switch (kind) {
    case 'showsTheSameError':
      return {
        cause: 'usesACellWithTheSameError',
        cell: address,
      };
    case 'isBlankAndDividedBy':
      return reads.mergedAreaAt(cellId.sheetId, position) === null
        ? {
            cause: 'dividesByAnEmptyCell',
            cell: address,
          }
        : null;
    case 'isZeroAndDividedBy':
      return {
        cause: 'dividesByAZeroCell',
        cell: address,
      };
    case 'leadsBackToTheFormula':
      return {
        cause: 'refersBackToItself',
        cell: address,
      };
    case 'holdsANestedSubtotal': {
      let shown = reads.cellOnShowIn(cellId);
      if (shown === null || !('input' in shown) || shown.spill?.kind !== 'fills')
        return {
          cause: kind,
          cell: address,
        };
      let { r: toRow, c: toColumn } = shown.spill.to;
      let toPosition = reads.positionOfCell({
        sheetId: cellId.sheetId,
        rowId: toRow,
        columnId: toColumn,
      });
      return toPosition === null
        ? null
        : {
            cause: 'filledByANestedSubtotal',
            cells: `${address}:${addressOfPosition(toPosition)}`,
          };
    }
    case 'holdsTextWhereANumberIsNeeded': {
      let shown = reads.cellOnShowIn(cellId);
      if (shown === null || !('from' in shown))
        return {
          cause: 'textInArithmetic',
          cell: address,
        };
      let spilledFrom = cellWrittenFor(reads, formulaCell, {
        sheetId: cellId.sheetId,
        cell: shown.from,
      });
      return spilledFrom === null
        ? null
        : {
            cause: 'spilledTextInArithmetic',
            cell: address,
            from: spilledFrom.written,
          };
    }
  }
}
export function explainCauseOfError(
  reads: WorkbookReads,
  formulaCell: CellId,
  errorCode: ErrorValue,
  cause: CauseOfErrorToExplain,
): ErrorTell | null {
  switch (cause.kind) {
    case 'showsTheSameError':
    case 'isBlankAndDividedBy':
    case 'isZeroAndDividedBy':
    case 'leadsBackToTheFormula':
    case 'holdsTextWhereANumberIsNeeded':
      return explainCauseAtCell(reads, formulaCell, cause);
    case 'holdsANestedSubtotal': {
      let tell = explainCauseAtCell(reads, formulaCell, cause);
      return tell !== null && isTellShortEnough(tell)
        ? tell
        : {
            cause: 'wrongKindOrSize',
          };
    }
    case 'errorIsWritten':
      return errorCode === '#REF!'
        ? {
            cause: 'cellsAreGone',
          }
        : {
            cause: 'holdsTheError',
          };
    case 'cellsAreGone':
    case 'refersToItself':
    case 'dividesByAWrittenZero':
      return {
        cause: cause.kind,
      };
    case 'noSuchFunction':
    case 'unknownName':
      return {
        cause: cause.kind,
        name: cause.name,
      };
    case 'functionWithoutParentheses':
      return {
        cause: cause.kind,
        name: cause.function,
      };
    case 'noSuchCell':
      return {
        cause: cause.kind,
        address: cause.address,
      };
    case 'argumentIsMissing':
      return {
        cause: 'missingArgument',
        name: cause.function,
        argument: cause.argument,
      };
    case 'pairIsIncomplete':
      return {
        cause: 'incompletePair',
        name: cause.function,
        first: cause.first,
        second: cause.second,
      };
    case 'tooManyArguments':
      return {
        cause: cause.kind,
        name: cause.function,
        most: cause.most,
        given: cause.given,
        isOnlyCount: cause.takesNoFewer,
      };
    case 'severalCellsForOneValue':
      return cause.argument === null
        ? {
            cause: 'wrongKindOrSize',
          }
        : {
            cause: cause.kind,
            name: cause.function,
            argument: cause.argument,
          };
    case 'comesToSeveralCellsThatDoNotSpill':
    case 'operandsOfDifferentSizes':
      return {
        cause: 'wrongKindOrSize',
      };
    case 'lookupFindsNothing':
      return {
        cause: 'lookupFoundNothing',
        name: cause.function,
      };
    case 'filterKeepsNothing':
      return {
        cause: cause.kind,
        name: cause.function,
        argument: cause.argumentToAdd,
        hasSeveralConditions: cause.hasSeveralConditions,
      };
    case 'conditionsDoNotFitTheRange': {
      let { function: functionName, range, condition, canBeARow } = cause;
      return cause.hasSeveralConditions
        ? {
            cause: 'conditionsOfAnotherSize',
            name: functionName,
            range,
            canBeARow,
          }
        : {
            cause: 'includeOfAnotherSize',
            name: functionName,
            include: condition,
            range,
            canBeARow,
          };
    }
    case 'rangesOfDifferentSizes':
      return {
        cause: cause.kind,
        name: cause.function,
      };
    case 'wordIsNotRead':
      return { cause: cause.kind, name: cause.function, word: cause.word };
    case 'pivotTotalsNothing':
    case 'pivotWithColumnsTotalsSeveral':
      return { cause: cause.kind };
    case 'noSuchColumnToSortBy':
      return {
        cause: cause.kind,
        name: cause.function,
        range: cause.range,
        columns: cause.columns,
        column: cause.column,
      };
    case 'sortOrderIsNotRead':
      return {
        cause: 'orderNotRead',
        name: cause.function,
        order: cause.order,
      };
    case 'functionCodeSkipsHiddenRows':
      return {
        cause: cause.kind,
        name: cause.function,
        functionCode: cause.functionCode,
        codeThatCountsHiddenRows: cause.codeThatCountsHiddenRows,
      };
    case 'argumentIsNoReference':
      return {
        cause: cause.kind,
        name: cause.function,
        argument: cause.argument,
      };
  }
}
/** Why a formula shows the error of a cell it uses, when that cell has it from one further back. */
export function explainErrorPassedOn(reads: WorkbookReads, formulaCell: CellId, { cause, passedOnFrom }: CauseOfErrorSaid): ErrorTell | null {
  if (cause?.kind !== 'showsTheSameError' || passedOnFrom === null) return null;
  let [causeCell, fromCell] = [cellWrittenFor(reads, formulaCell, cause.cell), cellWrittenFor(reads, formulaCell, passedOnFrom)];
  if (fromCell === null || fromCell.written === causeCell?.written) return null;
  let tell: ErrorTell = {
    cause: 'comesFromACellFurtherBack',
    cell: fromCell.written,
  };
  return isTellShortEnough(tell) ? tell : null;
}
export function explainCellError(readsSeen: WorkbookReads, cell: CellId): ErrorExplained | null {
  let reads = readsAsStored(readsSeen);
  let shown = reads.cellOnShowIn(cell);
  let errorCode = errorCodeOfCell(shown);
  if (shown === null || errorCode === null) return null;
  if (errorCode === '#TIMEOUT!') return TIMEOUT_ERROR_TELL;
  let cacheOfReads = ERROR_TELL_CACHE.get(reads) ?? new Map<string, ErrorExplained>();
  ERROR_TELL_CACHE.set(reads, cacheOfReads);
  let cached = cacheOfReads.get(cellKeyOf(cell));
  if (cached !== undefined) return cached;
  let tell: ErrorTell | null = null;
  let isTellStale = false;
  if ('input' in shown && shown.input.kind === 'formula' && shown.formulaText !== undefined) {
    if (shown.spill?.kind === 'blocked') tell = explainBlockedSpill(reads, cell, shown.spill);
    else if (errorCode === '#ERROR!')
      tell = findFormulaFault(shown.formulaText, reads.listSheets(), cell.sheetId, reads.decimalSign, shown.input.formula.references);
    if (tell === null && shown.spill?.kind !== 'blocked') {
      let causeSaid = reads.causeOfError(cell, `${errorCode} ${shown.formulaText}`);
      if (causeSaid === null)
        return {
          code: errorCode,
          tell: null,
          isTellOnItsWay: true,
        };
      isTellStale = !causeSaid.isLatest;
      if (causeSaid.said.cause !== null)
        tell = explainErrorPassedOn(reads, cell, causeSaid.said) ?? explainCauseOfError(reads, cell, errorCode, causeSaid.said.cause);
    }
  }
  let explained = {
    code: errorCode,
    tell: tell !== null && isTellShortEnough(tell) ? tell : null,
  };
  if (!isTellStale) cacheOfReads.set(cellKeyOf(cell), explained);
  return explained;
}
export const MAX_TELL_TEXT_LENGTH = 32;
export const UNTELLABLE_CHAR_PATTERN = /["“”„‟«»＂″‶〝〞〟\p{C}\p{Zl}\p{Zp}]/u;
export const isTellShortEnough = (tell: ErrorTell): boolean =>
  Object.entries(tell).every(
    ([key, value]: [string, unknown]) =>
      key === 'cause' || typeof value !== 'string' || (value.length <= MAX_TELL_TEXT_LENGTH && !UNTELLABLE_CHAR_PATTERN.test(value)),
  );
export const addressOfPosition = ({ rowIndex, columnIndex }: CellPosition): string =>
  areaToA1AsStored(
    {
      topRowIndex: rowIndex,
      leftColumnIndex: columnIndex,
      rowCount: 1,
      columnCount: 1,
    },
    null,
  );
export const MAX_FEW_CELLS_IN_THE_WAY = 3;
export const cellKeyOf = ({ sheetId, rowId, columnId }: CellId): string => `${sheetId}/${rowId}/${columnId}`;
export const ERROR_TELL_CACHE = new WeakMap<WorkbookReads, Map<string, ErrorExplained>>();
export const TIMEOUT_ERROR_TELL: ErrorExplained = {
  code: '#TIMEOUT!',
  tell: null,
};
