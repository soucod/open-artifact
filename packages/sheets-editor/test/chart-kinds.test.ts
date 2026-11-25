import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { STOCK_CHART_PROGRAMS, STOCK_KINDS } from '@open-artifact/sheets-core/stock-charts';
import type { StockKind } from '@open-artifact/sheets-core/stock-charts';
import { canSwapChartKind, doesChartKindSuitRows } from '../src/charts/chart-kind-fit.ts';
import { canAskChartChange, chartChangeOffers } from '../src/charts/change-offers.ts';
import { chartThumbnailPaths } from '../src/charts/chart-thumbnail-paths.ts';
import type { ChartCell } from '../src/chart-frame/messages.ts';
import type { ChartOfView } from '../src/charts/placed-views.ts';

const cell = (value: unknown): ChartCell => ({ value: typeof value === 'number' ? value : undefined, text: String(value) });
const table = (...rows: unknown[][]) => rows.map((row) => row.map(cell));

/** Months of two positive series: the shape of the chart in the screenshot this change came from. */
const MONTHS = table(['Month', 'Online', 'Stores'], ['Jan', 120, 80], ['Feb', 150, 95], ['Mar', 170, 90]);
const POINTS = table(['Price', 'Sold'], [10, 300], [12, 260], [15, 210]);

// The page swaps a chart's kind with no agent (agent-edits.ts). Those modules load the page's components, which the
// tests cannot, so what is tested here is the choosing of kinds; the swap itself is checked in the page.
describe('changing a chart’s kind', () => {
  it('offers the kinds the rows suit, leaving out the kind it is now', () => {
    const chart: ChartOfView = { kind: 'code', nodeId: 'n1', inputs: { rows: MONTHS } };
    const kinds = (kindNow: StockKind | null, canAgentWrite: boolean) => chartChangeOffers(chart, kindNow, canAgentWrite).map((offer: { kind: string }) => offer.kind);
    assert.deepEqual(kinds('stackedBar', false), ['bar', 'horizontalBar', 'line', 'area']);
    assert.deepEqual(kinds(null, true), ['bar', 'horizontalBar', 'stackedBar', 'line', 'area']);
    assert.ok(chartChangeOffers(chart, null, false).every((offer: { isSwap: boolean }) => offer.isSwap));
    assert.equal(canAskChartChange({}, chart, false), true);
    // A chart that reads other inputs is the agent's to change, and is offered nothing without it.
    const other: ChartOfView = { kind: 'code', nodeId: 'n1', inputs: { costs: MONTHS } };
    assert.deepEqual(chartChangeOffers(other, null, false), []);
    assert.equal(canAskChartChange({}, other, false), false);
    assert.deepEqual(
      chartChangeOffers(other, null, true).map((offer: { kind: string; isSwap: boolean }) => [offer.kind, offer.isSwap]),
      [['bar', false], ['stackedBar', false], ['line', false], ['pie', false]],
    );
  });

  it('suits a scatter only to rows that each hold a number first', () => {
    assert.equal(doesChartKindSuitRows('scatter', MONTHS), false);
    assert.equal(doesChartKindSuitRows('scatter', POINTS), true);
    assert.equal(canSwapChartKind({ rows: POINTS }, 'scatter'), true);
    assert.equal(canSwapChartKind({ rows: POINTS, more: POINTS }, 'scatter'), false);
  });

  it('does not stack the numbers a scatter lies along', () => {
    assert.equal(doesChartKindSuitRows('stackedBar', POINTS), false);
    assert.equal(doesChartKindSuitRows('bar', POINTS), true);
    assert.equal(doesChartKindSuitRows('stackedBar', MONTHS), true);
    // Years down the first column are labels, not points along a line: their columns still stack.
    const YEARS = table(['Year', 'Online', 'Stores'], [2023, 120, 80], [2024, 150, 95], [2025, 170, 90]);
    assert.equal(doesChartKindSuitRows('stackedBar', YEARS), true);
  });

  it('draws a thumbnail of every kind', () => {
    for (const kind of STOCK_KINDS) {
      const paths = chartThumbnailPaths({ kind, series: [[1, 3, 2, 4], [2, 1, 3, 2]] });
      assert.ok(paths.length > 0, kind);
      for (const { path } of paths) assert.doesNotMatch(path, /NaN|Infinity/, kind);
    }
  });
});
