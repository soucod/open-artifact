import { useToasts, type ToastCloseInfo } from '../kit/toast.tsx';
import * as React from 'react';
import { undoableDoneText } from '../i18n/notice-labels.ts';
import { UncommentableToastText } from '../shell/ui-root.tsx';
import type { ChartAdded, ChartMaking, WhyChartNotAdded } from './chart-making.ts';
import { CHART_MESSAGES } from './chart-words.ts';
export function chartAddedAnnouncement(chartOutcome: ChartMaking | null, canAnnounce: boolean) {
  if (chartOutcome?.is === 'notAdded') return chartNotAddedWords(chartOutcome.why);
  if (chartOutcome?.is !== 'added' || !canAnnounce) return null;
  return undoableDoneText(chartAddedWords(chartOutcome.atPress.kind === 'byAgent', chartOutcome.valuesNotShown ?? 0));
}
interface ChartToastProps {
  title: React.ReactNode;
  /** Called when the toast goes by itself or is closed by the person, not when it is taken down with the component. */
  onGone: (byUser: boolean) => void;
}
export function ChartToast({ title, onGone }: ChartToastProps) {
  let toasts = useToasts();
  let isTakenDownRef = React.useRef(false);
  let putUpToast = React.useEffectEvent(
    () => (
      (isTakenDownRef.current = false),
      toasts.add({
        title: <UncommentableToastText>{title}</UncommentableToastText>,
        onClose: ({ byUser }: ToastCloseInfo) => {
          if (!isTakenDownRef.current) onGone(byUser);
        },
      })
    ),
  );
  let takeDownToast = React.useEffectEvent((toastId: string) => {
    isTakenDownRef.current = true;
    toasts.close(toastId);
  });
  React.useEffect(() => {
    let toastId = putUpToast();
    return () => takeDownToast(toastId);
  }, []);
  return null;
}
interface ChartNotAddedToastProps {
  why: WhyChartNotAdded;
  onGone: (byUser: boolean) => void;
}
export function ChartNotAddedToast({ why, onGone }: ChartNotAddedToastProps) {
  return <ChartToast title={chartNotAddedWords(why)} onGone={onGone} />;
}
export const chartAddedWords = (isByAgent: boolean, valuesNotShown: number) =>
  isByAgent
    ? CHART_MESSAGES.chartAddedByAgent()
    : valuesNotShown === 0
      ? CHART_MESSAGES.chartAdded()
      : CHART_MESSAGES.chartAddedWithValuesNotShown(valuesNotShown);
export const chartNotAddedWords = (why: WhyChartNotAdded) =>
  (
    ({
      notMade: CHART_MESSAGES.chartNotAdded,
      codeRefused: CHART_MESSAGES.chartNotAdded,
      full: CHART_MESSAGES.noRoomForChart,
      notForPage: CHART_MESSAGES.chartCannotBeAdded,
      leftSheet: CHART_MESSAGES.chartStopped,
    }) satisfies Record<WhyChartNotAdded, () => string>
  )[why]();
export const undoOfferOfChartAdded = ({ nth, atPress, valuesNotShown }: ChartAdded) => ({
  key: `chart ${nth}`,
  title: chartAddedWords(atPress.kind === 'byAgent', valuesNotShown ?? 0),
  undoLabel: CHART_MESSAGES.undoChartAdded(),
});
