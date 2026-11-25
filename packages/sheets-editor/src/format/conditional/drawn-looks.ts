import { createGivenFormatsLookup } from '../../model/cell-format.ts';
import { areasOfRuleRanges } from './descriptions.ts';
import { isInSpan } from '../../grid/geometry.ts';
import { cellValueOf } from '../../model/cell-values.ts';
import { cellColorsOfFormat, colorScaleCellColors, colorScaleStepAt } from '../cell-colors.ts';
import type { SheetId } from '@open-artifact/sheets-core';
import type { GivenFormatsLookup, WholeCellFormat } from '../../model/cell-format.ts';
import type { CellId, FormatsGiven, WorkbookReads } from '../../model/workbook.ts';
import type { CellPosition } from '../../selection/model.ts';
import type { CellLook, CellLooks } from '../../grid/header-gray-fill.ts';
export function givenFormatsLookupOf(conditionalFormats: FormatsGiven): GivenFormatsLookup {
  let cached = givenFormatsLookupCache.get(conditionalFormats);
  if (cached !== undefined) return cached;
  let lookup = createGivenFormatsLookup(conditionalFormats.formats);
  givenFormatsLookupCache.set(conditionalFormats, lookup);
  return lookup;
}
export function drawnFormatsOf(reads: WorkbookReads, sheetId: SheetId, conditionalFormats: FormatsGiven): CellLooks {
  let givenFormats = givenFormatsLookupOf(conditionalFormats);
  let scales = conditionalFormats.colorScales.flatMap(
    ({ ranges, stops: [firstStop, ...otherStops] }) =>
      firstStop === undefined
        ? []
        : [
            {
              stops: [firstStop, ...otherStops],
              areas: areasOfRuleRanges(reads, sheetId, ranges),
            },
          ],
  );
  let formatOver = (format: WholeCellFormat, { rowId, columnId }: Pick<CellId, 'rowId' | 'columnId'>): WholeCellFormat =>
    givenFormats.formatDrawnOf(format, rowId, columnId);
  let formatOf = (cellId: CellId): WholeCellFormat => formatOver(reads.formatOf(cellId), cellId);
  return {
    formatOf,
    formatOver,
    lookOf(cellId: CellId, { rowIndex, columnIndex }: CellPosition): CellLook {
      let format = formatOf(cellId);
      let ruleLook = givenFormats.lookGivenTo(cellId.rowId, cellId.columnId);
      let scale =
        ruleLook?.fillColor !== undefined
          ? undefined
          : scales.find(
              ({ areas }) =>
                areas.some(
                  (area) =>
                    isInSpan(rowIndex, area.topRowIndex, area.rowCount) && isInSpan(columnIndex, area.leftColumnIndex, area.columnCount),
                ),
            );
      let value = scale === undefined ? null : cellValueOf(reads.cellOnShowIn(cellId));
      return {
        format,
        paints:
          scale === undefined || value?.kind !== 'number'
            ? cellColorsOfFormat(format)
            : colorScaleCellColors(colorScaleStepAt(scale.stops, value.value), format.font.color),
        isTextColorFromRule: ruleLook?.font?.color !== undefined,
        isFillFromRule: ruleLook?.fillColor !== undefined,
      };
    },
  };
}
export const givenFormatsLookupCache = new WeakMap<FormatsGiven, GivenFormatsLookup>();
