import type { ChartInputs } from '../chart-frame/messages.ts';
import type { ChartCellsProblem } from '../messages/charts.ts';
import { canSwapChartKind, readsRowsAlone } from './chart-kind-fit.ts';
import type { ChartSketch } from './chart-thumbnail-paths.ts';
import type { ChartOfView } from './placed-views.ts';
import { STOCK_KINDS, type StockKind } from './stock-programs.ts';

// What "Change chart type" offers for a chart. It lives apart from the layer that draws the menu, so that it can be
// tested without the layer's components.

/** A kind offered under "Change chart type", and whether the page swaps to it alone (or the agent writes it). */
export type ChartChangeOffer = ChartSketch & { isSwap: boolean };

/** Why the cells a chart reads cannot be drawn: none holds a number, or some hold errors. Null when they can be. */
export function chartCellsProblem(inputs: ChartInputs): ChartCellsProblem | null {
  const areas = Object.values(inputs);
  if (areas.length === 0) return null;
  let hasErrorCells = false;
  for (const area of areas) {
    const hasManyColumns = area.some((row) => row.length > 1);
    for (const [rowIndex, row] of area.entries())
      for (const [columnIndex, { value, text }] of row.entries()) {
        const isLabelCell = (rowIndex === 0 && area.length > 1) || (columnIndex === 0 && hasManyColumns);
        if (typeof value === 'number' || (value !== null && !isLabelCell)) return null;
        hasErrorCells ||= value === null && text !== '';
      }
  }
  return hasErrorCells ? 'cellsHaveErrors' : 'cellsHaveNoNumbers';
}
/**
 * Whether this chart can be changed here: by a kind swap the page makes alone, or by the agent. Of the changes to
 * charts only whether there are any is read.
 */
export const canAskChartChange = (changes: object | null, chart: ChartOfView, canAgentWrite = false): boolean =>
  changes !== null &&
  chart.kind !== 'none' &&
  chartCellsProblem(chart.inputs) === null &&
  (canAgentWrite || STOCK_KINDS.some((kind) => canSwapChartKind(chart.inputs, kind)));
/**
 * The kinds offered under "Change chart type": each kind the page can swap this chart to by itself, leaving out the
 * kind it is now. A chart the page cannot swap (one that reads inputs other than `rows`) is offered the first four
 * kinds, for the agent to write, and none when no agent can.
 */
export function chartChangeOffers(chart: ChartOfView, kindNow: StockKind | null, canAgentWrite: boolean): ChartChangeOffer[] {
  if (chart.kind === 'none') return [];
  const offerOf = (kind: StockKind, isSwap: boolean): ChartChangeOffer => ({
    // Every kind offered is one of CHART_CHANGE_OFFERS.
    ...CHART_CHANGE_OFFERS.find((offer) => offer.kind === kind)!,
    isSwap,
  });
  if (!readsRowsAlone(chart.inputs)) return canAgentWrite ? AGENT_CHANGE_KINDS.map((kind) => offerOf(kind, false)) : [];
  return CHART_CHANGE_OFFERS.filter(({ kind }) => kind !== kindNow && canSwapChartKind(chart.inputs, kind)).map(
    ({ kind }) => offerOf(kind, true),
  );
}
export const AGENT_CHANGE_KINDS: readonly StockKind[] = ['bar', 'stackedBar', 'line', 'pie'];
export const CHART_CHANGE_OFFERS: readonly ChartSketch[] = [
  {
    kind: 'bar',
    series: [
      [3, 5, 4, 7],
      [2, 3, 5, 4],
    ],
  },
  {
    kind: 'horizontalBar',
    series: [
      [7, 5, 4],
      [4, 6, 2],
    ],
  },
  {
    kind: 'stackedBar',
    series: [
      [3, 4, 3, 5, 4],
      [2, 2, 3, 2, 4],
      [1, 2, 1, 2, 2],
    ],
  },
  {
    kind: 'line',
    series: [
      [2, 4, 3, 6, 5, 8],
      [1, 2, 4, 3, 5, 4],
    ],
  },
  {
    kind: 'area',
    series: [
      [2, 4, 3, 6, 5, 8],
      [1, 2, 3, 2, 4, 3],
    ],
  },
  {
    kind: 'pie',
    series: [[5, 3, 2, 1]],
  },
  {
    kind: 'scatter',
    series: [
      [1, 2, 3, 4, 5, 6, 7],
      [2, 5, 3, 6, 4, 8, 7],
    ],
  },
];
