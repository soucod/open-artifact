import { Skeleton } from '../kit/skeleton.tsx';
import { chartCellsProblem } from './change-offers.ts';
export { chartCellsProblem };
import * as React from 'react';
import { useChartNotice } from './chart-notices.tsx';
import { chartCellsProblemWords, type ChartCellsProblem } from '../messages/charts.ts';
import { DangerWarningIcon } from '../ui/warning-icon.tsx';
/** A style that also sets CSS custom properties. */
export type StyleWithCustomProperties = React.CSSProperties & Record<`--${string}`, string>;
interface ChartCellsProblemNoticeProps {
  why: ChartCellsProblem;
  name: string;
}
export function ChartCellsProblemNotice({ why, name }: ChartCellsProblemNoticeProps) {
  let isError = why === 'cellsHaveErrors';
  useChartNotice(chartCellsProblemWords(why));
  return <div className="flex size-full flex-col gap-md p-lg"><div className="flex min-h-0 flex-col gap-xs overflow-hidden"><p aria-hidden title={name} className="flex-none truncate text-heading font-medium text-primary">{name}</p><p className={`flex flex-none items-start gap-xs text-body text-pretty ${isError ? 'text-danger' : 'text-secondary'}`}>{isError &&
                <span className="flex h-[1lh] flex-none items-center"><DangerWarningIcon /></span>}{chartCellsProblemWords(why)}</p></div><ChartSkeleton /></div>;
}
interface ChartOnItsWayProps {
  /** Shows at once rather than fading in; read only when it is first drawn. */
  comesAtOnce: boolean;
}
export function ChartOnItsWay(props: ChartOnItsWayProps) {
  let [comesAtOnce] = React.useState(props.comesAtOnce);
  return <div aria-hidden className="sheet-chart-on-its-way" data-comes-at-once={comesAtOnce}><Skeleton decorative width="45%" className="flex-none text-heading" /><div className="sheet-plot-of-chart-on-its-way">{CHART_ON_ITS_WAY_LINES.map(
          (line) =>
            <div key={line} style={styleOfChartLineOnItsWay(line)} />,
        )}</div></div>;
}
export const CHART_SKELETON_BAR_HEIGHTS = [38, 52, 44, 66, 58, 80, 72, 92];
export const ChartSkeleton = () =>
  <div aria-hidden className="sheet-room-of-chart-skeleton"><div className="sheet-chart-skeleton">{CHART_SKELETON_BAR_HEIGHTS.map(
        (height) =>
          (<div key={height} style={{
                height: `${height}%`,
              }} />),
      )}</div></div>;
export const CHART_ON_ITS_WAY_LINES = [4, 28, 52, 76, 100];
export const styleOfChartLineOnItsWay = (line: number): StyleWithCustomProperties => ({
  '--sheet-line-from-top': `${String(line)}%`,
});
