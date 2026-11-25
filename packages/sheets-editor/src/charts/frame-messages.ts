import type { FrameToPage, PageToFrame, PointAt } from '../chart-frame/messages.ts';

export function parseChartFrameReply(data: unknown): FrameToPage | null {
  if (!isMessageObject(data)) return null;
  switch (data.kind) {
    case 'drawn':
      return {
        kind: 'drawn',
      };
    case 'failed':
      return isChartFrameFault(data.fault)
        ? {
            kind: 'failed',
            fault: data.fault,
          }
        : null;
    default:
      return null;
  }
}
export const pressedAtMessage = ({ x, y }: PointAt, { width, height }: { width: number; height: number }): PageToFrame | null =>
  x >= 0 && y >= 0 && x <= width && y <= height
    ? {
        kind: 'pressedAt',
        at: {
          x,
          y,
        },
      }
    : null;
const CHART_FRAME_FAULT_NAMES = {
  notAModule: true,
  threw: true,
  inputMissing: true,
  tooManyRows: true,
  notDrawnInSheets: true,
  tookTooLong: true,
  tookCaret: true,
} as const;
export type ChartFrameFault = keyof typeof CHART_FRAME_FAULT_NAMES;
export const CHART_FRAME_FAULTS: ReadonlySet<string> = new Set(Object.keys(CHART_FRAME_FAULT_NAMES));
export const isChartFrameFault = (fault: unknown): fault is ChartFrameFault => typeof fault === 'string' && CHART_FRAME_FAULTS.has(fault);
export const isMessageObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
export const CHART_FRAME_PORT_MESSAGE = 'sheets-chart:line-to-page';
