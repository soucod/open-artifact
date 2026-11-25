import * as React from 'react';
import { useIsTrueForVisibleMs, SAID_NOTICE_SHOWN_MS } from '../ui/save-status.tsx';
import { LiveAnnouncer } from '../ui/live-announcer.tsx';
/** What a chart says in place of itself, and the code it says it of, if any. */
export interface ChartNotice {
  words: string;
  ofCode: string | null;
}
/** The notices of every chart on the page, by placement, and the words last said aloud. */
export interface ChartNotices {
  ofEach: Map<string, ChartNotice>;
  said: string | null;
}
/** Tells the page what a chart says, or `null` once it says nothing. */
export type TellOfChartNotice = (notice: ChartNotice | null) => void;
export function withChartNotice(state: ChartNotices, id: string, notice: ChartNotice | null): ChartNotices {
  let previous = state.ofEach.get(id) ?? null;
  if (previous?.words === notice?.words && previous?.ofCode === notice?.ofCode) return state;
  let ofEach = new Map(state.ofEach);
  if (notice === null) ofEach.delete(id);
  else ofEach.set(id, notice);
  return {
    ofEach,
    said: notice?.words ?? state.said,
  };
}
interface CallWhenNoticeDueProps {
  onDue: () => void;
}
export function CallWhenNoticeDue({ onDue }: CallWhenNoticeDueProps) {
  let isDue = useIsTrueForVisibleMs(true, SAID_NOTICE_SHOWN_MS);
  React.useEffect(() => {
    if (isDue) onDue();
  }, [isDue, onDue]);
  return null;
}
interface ChartNoticesProviderProps {
  /** Called with the placement of each chart that tells of a notice. */
  onToldOf: (placementId: string) => void;
  children: React.ReactNode;
}
export function ChartNoticesProvider({ onToldOf, children }: ChartNoticesProviderProps) {
  let [notices, setNotices] = React.useState(NO_CHART_NOTICES);
  let tell = React.useCallback(
    (id: string, notice: ChartNotice | null) => {
      setNotices((state) => withChartNotice(state, id, notice));
      onToldOf(id);
    },
    [onToldOf],
  );
  let clearSaid = React.useCallback(
    () =>
      setNotices(
        (state) => ({
          ...state,
          said: null,
        }),
      ),
    [],
  );
  return <ChartNoticesContext value={tell}><LiveAnnouncer words={notices.said} />{notices.said !== null &&
        <CallWhenNoticeDue key={notices.said} onDue={clearSaid} />}{children}</ChartNoticesContext>;
}
interface ChartNoticeScopeProps {
  id: string;
  children: React.ReactNode;
}
export function ChartNoticeScope({ id, children }: ChartNoticeScopeProps) {
  let tell = React.useContext(ChartNoticesContext);
  let tellOfView = React.useCallback((notice: ChartNotice | null) => tell(id, notice), [tell, id]);
  React.useEffect(() => () => tellOfView(null), [tellOfView]);
  return <ChartNoticeOfViewContext value={tellOfView}>{children}</ChartNoticeOfViewContext>;
}
interface ChartNoticeGateProps {
  /** Whether the notices of what is inside reach the page. */
  isHeardOf: boolean;
  children: React.ReactNode;
}
export function ChartNoticeGate(props: ChartNoticeGateProps) {
  let tellOfView = React.useContext(ChartNoticeOfViewContext);
  return <ChartNoticeOfViewContext value={props.isHeardOf ? tellOfView : ignoreChartNotice}>{props.children}</ChartNoticeOfViewContext>;
}
export function useChartNotice(words: string | null, ofCode: string | null = null) {
  let tellOfView = React.useContext(ChartNoticeOfViewContext);
  React.useEffect(
    () =>
      tellOfView(
        words === null
          ? null
          : {
              words,
              ofCode,
            },
      ),
    [tellOfView, words, ofCode],
  );
}
export function NoChartNotice() {
  useChartNotice(null);
  return null;
}
export const NO_CHART_NOTICES: ChartNotices = {
  ofEach: new Map(),
  said: null,
};
export const ChartNoticesContext = React.createContext<(id: string, notice: ChartNotice | null) => void>(() => {
  return;
});
export const ChartNoticeOfViewContext = React.createContext<TellOfChartNotice>(() => {
  return;
});
export const ignoreChartNotice = () => {
  return;
};
