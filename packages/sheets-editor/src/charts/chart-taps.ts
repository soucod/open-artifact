import type { DrawnBox } from '../grid/view-boxes.ts';
import type { PointAt } from '../chart-frame/messages.ts';
import type { PlacedViewToDraw } from './placed-views.ts';
/** A press on a drawn chart: the placement it is on and where in it, in the chart's own pixels. */
export interface PressOnChart {
  placementId: string;
  at: PointAt;
}
interface ChartTapDown {
  pointerId: number;
  on: PressOnChart;
  stood: DrawnBox;
}
type ChartsDrawn = readonly Pick<PlacedViewToDraw, 'placementId' | 'box' | 'isSelected' | 'isHeld' | 'isHeldOnTheSpot'>[];
export function createChartTapTracker() {
  let tap: ChartTapDown | null = null;
  const listeners = new Map<string, (at: PointAt) => void>();
  return {
    cameDown({ pointerId, isTrusted }: Pick<PointerEvent, 'pointerId' | 'isTrusted'>, chartOn: PressOnChart | null, charts: ChartsDrawn) {
      const chart = charts.find(({ placementId }) => placementId === chartOn?.placementId);
      tap =
        isTrusted && chartOn !== null && chart !== undefined
          ? {
              pointerId,
              on: chartOn,
              stood: chart.box,
            }
          : null;
    },
    forget() {
      tap = null;
    },
    letGo(
      { pointerId, isTrusted, button }: Pick<PointerEvent, 'pointerId' | 'isTrusted' | 'button'>,
      { isTap, areEventsFinished, charts }: { isTap: boolean; areEventsFinished: boolean; charts: ChartsDrawn },
    ): PressOnChart | null {
      if (tap?.pointerId !== pointerId) return null;
      const { on: chartOn, stood: stoodAt } = tap;
      tap = null;
      const chart = charts.find(({ placementId }) => placementId === chartOn.placementId);
      const isChartSelected = chart?.isSelected === true && (!chart.isHeld || chart.isHeldOnTheSpot);
      const isChartUnmoved = chart?.box.left === stoodAt.left && chart.box.top === stoodAt.top;
      return isTrusted && button === 0 && isTap && areEventsFinished && isChartSelected && isChartUnmoved ? chartOn : null;
    },
    hear(placementId: string, listener: (at: PointAt) => void) {
      listeners.set(placementId, listener);
      return () => {
        if (listeners.get(placementId) === listener) listeners.delete(placementId);
      };
    },
    tell: (placementId: string, at: PointAt) => listeners.get(placementId)?.(at),
  };
}
