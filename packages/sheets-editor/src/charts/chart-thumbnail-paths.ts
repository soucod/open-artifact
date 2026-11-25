import type { StockKind } from './stock-programs.ts';
/** A small chart of a kind, drawn from a few made-up series to show what the kind looks like. */
export interface ChartSketch {
  kind: StockKind;
  series: readonly (readonly number[])[];
}
/** One path of a chart's thumbnail, in a 20 by 20 box. */
export interface ThumbnailPath {
  color: string;
  isLine: boolean;
  path: string;
  opacity?: number;
}
export function barThumbnailPaths(series: ChartSketch['series'], isStacked: boolean): ThumbnailPath[] {
  const columns = (series[0] ?? []).map(
    (_value, columnIndex) => series.map((values) => values[columnIndex] ?? 0),
  );
  const columnTotals = columns.map((column) => (isStacked ? sumNumbers(column) : Math.max(...column)));
  const yScale = thumbnailYScale(Math.min(0, ...columns.flat()), Math.max(0, ...columnTotals));
  const slotWidth = 17.5 / columns.length;
  const barWidth = (slotWidth - 1.5) / (isStacked ? 1 : series.length);
  return series.map(
    (_values, seriesIndex) => ({
      color: chartCategoricalColor(seriesIndex),
      isLine: false,
      path: columns
        .map((column, columnIndex) => {
          const base = isStacked ? sumNumbers(column.slice(0, seriesIndex)) : 0;
          const [fromY, toY] = [yScale(base), yScale(base + (column[seriesIndex] ?? 0))];
          const barHeight = Math.max(Math.abs(fromY - toY), 0.5);
          return `M${2 + columnIndex * slotWidth + (isStacked ? 0 : seriesIndex * barWidth)} ${Math.min(fromY, toY)}h${barWidth}v${barHeight}h${-barWidth}z`;
        })
        .join(''),
    }),
  );
}
export function lineThumbnailPaths(series: ChartSketch['series']): ThumbnailPath[] {
  const yScale = thumbnailYScale(Math.min(...series.flat()), Math.max(...series.flat()));
  return series.map(
    (points, seriesIndex) => ({
      color: chartCategoricalColor(seriesIndex),
      isLine: true,
      path: points
        .map(
          (point, pointIndex) =>
            `${pointIndex === 0 ? 'M' : 'L'}${2 + (16 * pointIndex) / Math.max(points.length - 1, 1)} ${yScale(point)}`,
        )
        .join(''),
    }),
  );
}
export function pieThumbnailPaths(slices: readonly number[]): ThumbnailPath[] {
  const total = Math.max(sumNumbers(slices), Number.MIN_VALUE);
  const [center, radius] = [10, 8];
  const innerRadius = 0.6 * radius;
  const pointOnCircle = (fraction: number, circleRadius: number) =>
    `${center + circleRadius * Math.sin(2 * Math.PI * fraction)} ${center - circleRadius * Math.cos(2 * Math.PI * fraction)}`;
  return slices.map((_slice, sliceIndex) => {
    const startFraction = sumNumbers(slices.slice(0, sliceIndex)) / total;
    const endFraction = sumNumbers(slices.slice(0, sliceIndex + 1)) / total;
    const largeArcFlag = endFraction - startFraction > 0.5 ? 1 : 0;
    return {
      color: chartCategoricalColor(sliceIndex),
      isLine: false,
      path: `M${pointOnCircle(startFraction, radius)}A${radius} ${radius} 0 ${largeArcFlag} 1 ${pointOnCircle(endFraction, radius)}L${pointOnCircle(endFraction, innerRadius)}A${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${pointOnCircle(startFraction, innerRadius)}z`,
    };
  });
}
/** Lines, each over a fill of the ground under it. */
export function areaThumbnailPaths(series: ChartSketch['series']): ThumbnailPath[] {
  const yScale = thumbnailYScale(Math.min(0, ...series.flat()), Math.max(...series.flat()));
  return series.flatMap((points, seriesIndex) => {
    const line = points
      .map(
        (point, pointIndex) =>
          `${pointIndex === 0 ? 'M' : 'L'}${2 + (16 * pointIndex) / Math.max(points.length - 1, 1)} ${yScale(point)}`,
      )
      .join('');
    const color = chartCategoricalColor(seriesIndex);
    return [
      { color, isLine: false, opacity: 0.3, path: `${line}L${points.length > 1 ? 18 : 2} ${yScale(0)}L2 ${yScale(0)}z` },
      { color, isLine: true, path: line },
    ];
  });
}
/** Bars laid from the left, a group of them for each row. */
export function horizontalBarThumbnailPaths(series: ChartSketch['series']): ThumbnailPath[] {
  const rows = (series[0] ?? []).map((_value, rowIndex) => series.map((values) => values[rowIndex] ?? 0));
  const most = Math.max(Number.MIN_VALUE, ...rows.flat());
  const slotHeight = 16 / Math.max(rows.length, 1);
  const barHeight = (slotHeight - 1.5) / Math.max(series.length, 1);
  return series.map((_values, seriesIndex) => ({
    color: chartCategoricalColor(seriesIndex),
    isLine: false,
    path: rows
      .map(
        (row, rowIndex) =>
          `M2 ${2 + rowIndex * slotHeight + seriesIndex * barHeight}h${Math.max((16 * Math.max(0, row[seriesIndex] ?? 0)) / most, 0.5)}v${barHeight}h${-Math.max((16 * Math.max(0, row[seriesIndex] ?? 0)) / most, 0.5)}z`,
      )
      .join(''),
  }));
}
/** Dots: the first series says how far along each lies, each other series how high. */
export function scatterThumbnailPaths(series: ChartSketch['series']): ThumbnailPath[] {
  const [across = [], ...others] = series;
  const xScale = (value: number) =>
    2 + (16 * (value - Math.min(...across))) / Math.max(Math.max(...across) - Math.min(...across), Number.MIN_VALUE);
  const yScale = thumbnailYScale(Math.min(...others.flat()), Math.max(...others.flat()));
  const dot = (x: number, y: number) => `M${x - 1.4} ${y}a1.4 1.4 0 1 0 2.8 0a1.4 1.4 0 1 0 -2.8 0`;
  return others.map((values, seriesIndex) => ({
    color: chartCategoricalColor(seriesIndex),
    isLine: false,
    path: values.map((value, index) => dot(xScale(across[index] ?? 0), yScale(value))).join(''),
  }));
}
export function chartThumbnailPaths({ kind, series }: ChartSketch): ThumbnailPath[] {
  if (kind === 'line') return lineThumbnailPaths(series);
  if (kind === 'area') return areaThumbnailPaths(series);
  if (kind === 'pie') return pieThumbnailPaths(series[0] ?? []);
  if (kind === 'horizontalBar') return horizontalBarThumbnailPaths(series);
  if (kind === 'scatter') return scatterThumbnailPaths(series);
  return barThumbnailPaths(series, kind === 'stackedBar');
}
export const chartCategoricalColor = (seriesIndex: number) => `var(--ui-chart-categorical-${seriesIndex + 1})`;
export const sumNumbers = (numbers: readonly number[]) => numbers.reduce((total, value) => total + value, 0);
export const thumbnailYScale =
  (min: number, max: number) =>
  (value: number) =>
    2 + 16 * (1 - (max === min ? 0 : (value - min) / (max - min)));
