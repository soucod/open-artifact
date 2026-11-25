import { PIE_MAX_SLICES, BAR_CHART_MAX_POINTS } from './chart-kind-fit.ts';
export { PIE_MAX_SLICES, BAR_CHART_MAX_POINTS };
import type { SheetId } from '@open-artifact/sheets-core';
import { nonEmptyValueOfCell, DATE_TIME_FORMAT_KINDS, isYearCell } from '../selection/figures.ts';
import { numberFormatOfCell } from '../model/workbook.ts';
import { MAX_CHART_SOURCE_ROWS } from './placement.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { CellArea } from '../selection/model.ts';
import type { ChartOnOffer } from '../state/initial-state.ts';
import type { ChartSketch } from './chart-thumbnail-paths.ts';
import type { ChartKindOrAny } from './chart-words.ts';
import type { StockKind } from './stock-programs.ts';
/** What a cell is to a chart offered for it: a label, or a number that is a time, a year or an amount. */
export type ChartCellRole = { is: 'text'; value: string } | { is: 'time'; value: number } | { is: 'year'; value: number } | { is: 'amount'; value: number };
/** A cell whose number a chart can draw. */
export type ChartNumberCell = Extract<ChartCellRole, { is: 'year' | 'amount' }>;
/** A kind of chart offered for the cells selected, with the series its thumbnail draws. */
export type ChartOfferOfCells = ChartOnOffer & ChartSketch;
export let CHART_OFFER_MAX_ROWS: number;
export let CHART_OFFER_MAX_COLUMNS: number;
export function chartCellKind(reads: WorkbookReads, sheetId: SheetId, rowIndex: number, columnIndex: number): ChartCellRole | null {
  const cellId = reads.cellIdAt(sheetId, rowIndex, columnIndex);
  const value = nonEmptyValueOfCell(reads, cellId);
  if (cellId === null || value === null) return null;
  if (value.kind !== 'number')
    return {
      is: 'text',
      value: String(value.value).trim().toLowerCase(),
    };
  if (DATE_TIME_FORMAT_KINDS.has(numberFormatOfCell(reads, cellId).kind))
    return {
      is: 'time',
      value: value.value,
    };
  return {
    is: isYearCell(reads, sheetId, {
      rowIndex,
      columnIndex,
    })
      ? 'year'
      : 'amount',
    value: value.value,
  };
}
export function hasRepeatedLabels(cells: readonly (ChartCellRole | null)[]): boolean {
  const labels = cells.flatMap((cell) => (cell === null || cell.value === '' ? [] : [cell.value]));
  return new Set(labels).size < labels.length;
}
export function isRepeatingCycle(labels: readonly (string | number | undefined)[]): boolean {
  const cycleLength = labels.indexOf(labels[0], 1);
  return (
    cycleLength > 1 &&
    new Set(labels.slice(0, cycleLength)).size === cycleLength &&
    labels.every((label, index) => label === labels[index % cycleLength])
  );
}
export function looksLikeAxisLabels(cells: readonly (ChartCellRole | null)[]): boolean {
  const numbers = cells.filter(isChartNumber).map(({ value }) => value);
  const steps = numbers.slice(1).map((number, index) => number - (numbers[index] ?? 0));
  const isMonotonic =
    steps.some((step) => step !== 0) &&
    (steps.every((step) => step >= 0) || steps.every((step) => step <= 0));
  return !cells.some(isChartAmount) && cells.some((cell) => cell !== null) && (numbers.length < 2 || isMonotonic);
}
export function sampleChartPointsEvenly<Point>(points: readonly Point[], count: number): readonly Point[] {
  if (points.length <= count) return points;
  const keptIndexes = new Set(
    Array.from(
      {
        length: count,
      },
      (_slot, index) => Math.round((index * (points.length - 1)) / (count - 1)),
    ),
  );
  return points.filter((_point, index) => keptIndexes.has(index));
}
export function chartKindsOfferedForCells(reads: WorkbookReads, sheetId: SheetId, area: CellArea): ChartOfferOfCells[] {
  const { topRowIndex, leftColumnIndex, rowCount, columnCount } = area;
  const grid = Array.from(
    {
      length: Math.min(rowCount, CHART_OFFER_MAX_ROWS),
    },
    (_row, rowOffset) =>
      Array.from(
        {
          length: Math.min(columnCount, CHART_OFFER_MAX_COLUMNS),
        },
        (_cell, columnOffset) => chartCellKind(reads, sheetId, topRowIndex + rowOffset, leftColumnIndex + columnOffset),
      ),
  );
  const filledRows = grid.filter((row) => row.some((cell) => cell !== null));
  const isLabelRow = (row: (ChartCellRole | null)[], rowIndex: number) =>
    rowIndex < filledRows.length - 1 &&
    looksLikeAxisLabels(row) &&
    !row.some(
      (cell, columnIndex) => isChartNumber(cell) && isChartTimeOrYear(filledRows[rowIndex + 1]?.[columnIndex] ?? null),
    );
  const rows = filledRows.slice(
    Math.max(
      0,
      filledRows.findIndex((row, rowIndex) => !isLabelRow(row, rowIndex)),
    ),
  );
  const firstColumn = rows.map((row) => row[0] ?? null);
  const hasLabelColumn = (rows[0]?.length ?? 0) > 1 && looksLikeAxisLabels(firstColumn);
  const columns = (rows[0] ?? [])
    .map((_cell, columnIndex) => rows.map((row) => row[columnIndex] ?? null))
    .slice(hasLabelColumn ? 1 : 0);
  const series = rows.length === 1 ? [columns.flat()] : columns;
  const hasAmounts = series.some((cells) => cells.some(isChartAmount));
  const numberSeries = series
    .filter((cells) => cells.filter(isChartNumber).length >= 2 && !(hasAmounts && looksLikeAxisLabels(cells)))
    .map((cells) => cells.map((cell) => (isChartNumber(cell) ? cell.value : 0)));
  const skippedRows = filledRows.length - rows.length;
  const isYear = (cell: ChartCellRole | null) => isChartNumber(cell) && Number.isInteger(cell.value) && cell.value > 1800 && cell.value < 2200;
  const isTableShaped =
    columnCount <= CHART_OFFER_MAX_COLUMNS &&
    rows.length > 1 &&
    skippedRows <= 1 &&
    (filledRows[0] ?? []).some(isChartNumber) === (skippedRows === 0) &&
    hasLabelColumn === ((rows[0]?.length ?? 0) > 1 && (!firstColumn.some(isChartNumber) || firstColumn.every(isYear))) &&
    !(hasLabelColumn && firstColumn.includes(null)) &&
    series.filter((cells) => cells.some(isChartNumber)).length === numberSeries.length;
  const pointCount = numberSeries[0]?.length ?? 0;
  const allNumbers = numberSeries.flat();
  if (pointCount === 0 || !Number.isFinite(sumOfNumbers(allNumbers.map(Math.abs)))) return [];
  const positives = allNumbers.filter((number) => number > 0);
  const isAllPositive = allNumbers.every((number) => number >= 0) && positives.length > 0;
  const isOverTime = hasLabelColumn && firstColumn.some(isChartTimeOrYear);
  const prefersLine = isOverTime || pointCount > LINE_CHART_MIN_POINTS;
  const sourceArea = {
    ...area,
    rowCount: Math.min(rowCount, MAX_CHART_SOURCE_ROWS + 1),
  };
  const shownArea = rowCount > grid.length ? reads.areaOnShowIn(sheetId, sourceArea) : null;
  const rowsBeyond = shownArea === null ? 0 : Math.max(0, shownArea.topRowIndex + shownArea.rowCount - topRowIndex - grid.length);
  const isBarOffered = pointCount + rowsBeyond <= BAR_CHART_MAX_POINTS;
  const isForPage = isTableShaped && grid.length + rowsBeyond <= MAX_CHART_SOURCE_ROWS;
  const isCycle = isRepeatingCycle(firstColumn.map((cell) => cell?.value)) && series.length === numberSeries.length;
  const isLabelsRepeated = hasLabelColumn && hasRepeatedLabels(firstColumn) && !isCycle;
  const isTooBigForPage =
    !isOverTime &&
    (hasLabelColumn ? 1 : 0) +
      series.filter((cells) => cells.some((cell) => cell !== null && cell.value !== '')).length >
      1 &&
    pointCount + rowsBeyond > LEFT_TO_AGENT_MIN_POINTS;
  const isBestLeftToAgent = isLabelsRepeated || isTooBigForPage;
  // Numbers in the first column that are amounts, not labels, with more numbers beside them: points of a scatter.
  const isScatterShaped =
    !hasLabelColumn && rows.length > 2 && firstColumn.every(isChartAmount) && numberSeries.length > 1 && series[0] !== undefined;
  // Labels too long to sit under bars read better down the side of a horizontal bar chart.
  const hasLongLabels =
    hasLabelColumn && firstColumn.some((cell) => cell?.is === 'text' && String(cell.value).length > LONG_LABEL_LENGTH);
  return (
    [
      isScatterShaped && 'scatter',
      prefersLine && 'line',
      isBarOffered && hasLongLabels && 'horizontalBar',
      isBarOffered && 'bar',
      !prefersLine && 'line',
      // A stack adds up its series; with numbers down the first column, that column would be stacked as one of them.
      isBarOffered && !isScatterShaped && numberSeries.length > 1 && isAllPositive && 'stackedBar',
      numberSeries.length === 1 && isAllPositive && pointCount <= PIE_MAX_SLICES && positives.length > 1 && 'pie',
      isOverTime && isAllPositive && 'area',
      isBarOffered && !hasLongLabels && 'horizontalBar',
    ] satisfies (StockKind | false)[]
  )
    .flatMap((kind) => (kind === false ? [] : [kind]))
    .slice(0, MAX_CHART_OFFERS)
    .map(
      (kind) => ({
        kind,
        isForPage,
        isBestLeftToAgent,
        series: numberSeries
          .slice(0, CHART_PREVIEW_SAMPLE_SIZES[kind].series)
          .map((points) => sampleChartPointsEvenly(points, CHART_PREVIEW_SAMPLE_SIZES[kind].points)),
      }),
    );
}
export const INSERT_CHART_LABEL = 'Insert chart';
export const chartAskPayload = (chartKind: ChartKindOrAny, request: string) => ({
  chartKind,
  ...(request !== '' && {
    request,
  }),
});
export const IS_CHART_OFFER_AT_SELECTION_ON = false;
[CHART_OFFER_MAX_ROWS, CHART_OFFER_MAX_COLUMNS] = [100, 8];
export const MAX_CHART_OFFERS = 4;
export const LONG_LABEL_LENGTH = 12;
export const CHART_PREVIEW_SAMPLE_SIZES: Readonly<Record<StockKind, { series: number; points: number }>> = {
  bar: {
    series: 2,
    points: 4,
  },
  stackedBar: {
    series: 3,
    points: 5,
  },
  line: {
    series: 3,
    points: 12,
  },
  pie: {
    series: 1,
    points: 6,
  },
  area: {
    series: 2,
    points: 12,
  },
  horizontalBar: {
    series: 2,
    points: 4,
  },
  scatter: {
    series: 3,
    points: 12,
  },
};
export const LINE_CHART_MIN_POINTS = 8;
export const LEFT_TO_AGENT_MIN_POINTS = 24;
export const isChartNumber = (role: ChartCellRole | null): role is ChartNumberCell => role?.is === 'amount' || role?.is === 'year';
export const isChartAmount = (role: ChartCellRole | null): boolean => role?.is === 'amount';
export const isChartTimeOrYear = (role: ChartCellRole | null): boolean => role?.is === 'time' || role?.is === 'year';
export const sumOfNumbers = (numbers: readonly number[]) =>
  numbers.reduce((total, number) => total + number, 0);
export const isChartMadeByPage = (offer: ChartOnOffer | undefined, canLeaveToAgent: boolean): boolean =>
  offer?.isForPage === true && !(offer.isBestLeftToAgent && canLeaveToAgent);
export const NO_CHART_OFFERS: readonly never[] = [];
export const chartOffersForPage = <Offer extends ChartOnOffer>(offers: readonly Offer[], canLeaveToAgent: boolean): readonly Offer[] =>
  isChartMadeByPage(offers[0], canLeaveToAgent) ? offers : NO_CHART_OFFERS;
export const chartOfferAtSelection = <Offer extends ChartOnOffer>(offers: readonly Offer[], isOn: boolean = IS_CHART_OFFER_AT_SELECTION_ON): Offer | undefined =>
  isOn ? offers[0] : undefined;
