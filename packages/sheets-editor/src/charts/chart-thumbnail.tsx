import type { ReactNode } from 'react';
import { chartThumbnailPaths, type ChartSketch } from './chart-thumbnail-paths.ts';
interface ChartThumbnailProps {
  chart: ChartSketch;
  size: number;
  isOutOfUse: boolean;
}
export function ChartThumbnail({ chart, size, isOutOfUse }: ChartThumbnailProps) {
  return <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden className={isOutOfUse ? 'flex-none grayscale' : 'flex-none'}>{chartThumbnailPaths(chart).map(
      ({ color, path, isLine, opacity }, index) =>
        isLine
          ? <path key={`${color}-${String(index)}`} d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
          : (<path key={`${color}-${String(index)}`} d={path} fill={color} {...(opacity !== undefined && {
                  fillOpacity: opacity,
                })} />),
    )}</svg>;
}
export const chartThumbnailIcon = (chart: ChartSketch, isOutOfUse: boolean) =>
  function (size: number): ReactNode {
    return <ChartThumbnail chart={chart} size={size} isOutOfUse={isOutOfUse} />;
  };
