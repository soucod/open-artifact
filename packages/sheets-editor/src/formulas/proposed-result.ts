import { cellValueOf } from '../model/cell-values.ts';
import { cellShownText } from '../clipboard/text-escaping.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { ProposedFormulaResult } from '../state/initial-state.ts';
/** The same as `ProposedFormulaResult`, which now has `fillsTo`; kept for the modules that import it by this name. */
export type ProposedFormulaResultRead = ProposedFormulaResult;
/** What a formula would come to in a cell, `'error'`, `'ranOutOfTime'`, or `null` where that cannot be read now. */
export function proposedFormulaResult(
  reads: WorkbookReads,
  cellId: CellId,
  formula: string,
): ProposedFormulaResult | 'ranOutOfTime' | 'error' | null {
  if (reads.calculationTookTooLong) return 'ranOutOfTime';
  let proposed = reads.proposedFormulaValue(cellId, formula);
  if (proposed === null) return null;
  let value = cellValueOf(proposed.cell);
  if (value?.kind === 'error') return value.value === '#TIMEOUT!' ? 'ranOutOfTime' : 'error';
  return {
    shown: cellShownText(proposed.cell, reads.decimalSign),
    text: value?.kind === 'text' ? value.value : null,
    ...(value !== null && {
      result: value,
    }),
    ...(value?.kind === 'boolean' && {
      isTrueOrFalse: true,
    }),
    ...(proposed.cell?.spill !== undefined && {
      fillsOtherCells: true,
    }),
    ...(proposed.cell?.spill?.kind === 'fills' && {
      fillsTo: proposed.cell.spill.to,
    }),
  };
}
