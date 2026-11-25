import { isCheckboxFormat, booleanOfValue } from '../chips/checkboxes.ts';
import { cellValueOf, formulaTextOf } from '../model/cell-values.ts';
import type { PageState } from '../state/initial-state.ts';
import type { CellContents } from '@open-artifact/sheets-core';
import type { CellId, CellOnShow, WorkbookReads } from '../model/workbook.ts';
import type { WholeCellFormat } from '../model/cell-format.ts';
/** A formula's cell as it is shown while formulas are: its formula's text, typed in. */
export interface FormulaShownAsText {
  input: { kind: 'text'; value: string };
  /** It has no value or shown text of its own. */
  value?: undefined;
  shown?: undefined;
}
/** A cell as the page shows it: one on show, or a formula's cell shown as its text. */
export type ShownCell = CellOnShow | FormulaShownAsText;
export function shownCellOf(
  { areFormulasShown }: Pick<PageState, 'areFormulasShown'>,
  reads: WorkbookReads,
  cellId: CellId,
): ShownCell | null {
  let cell = areFormulasShown ? reads.cellOf(cellId) : null;
  return cell?.input.kind === 'formula' ? cellWithFormulaShown(cell, reads.formatOf(cellId)) : reads.cellOnShowIn(cellId);
}
export const cellWithFormulaShown = <Cell extends CellContents | null>(
  cell: Cell,
  format: Pick<WholeCellFormat, 'cellControl'>,
): Cell | FormulaShownAsText =>
  cell?.input.kind === 'formula' && !(isCheckboxFormat(format) && booleanOfValue(cellValueOf(cell)) !== null)
    ? {
        input: {
          kind: 'text',
          value: formulaTextOf(cell),
        },
      }
    : cell;
export const toggleFormulasShown = (state: PageState): PageState => ({
  ...state,
  areFormulasShown: !state.areFormulasShown,
  lastDone: {
    what: state.areFormulasShown ? 'resultsShown' : 'formulasShown',
  },
});
