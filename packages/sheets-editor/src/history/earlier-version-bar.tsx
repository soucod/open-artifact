import { Toolbar } from '../kit/toolbar.tsx';
import { Button } from '../kit/button.tsx';
import * as React from 'react';
import { restoreOfVersion } from './version-history-pane.tsx';
import { versionHistoryMessages, versionTimeText } from './version-text.ts';
import { useStartOfToday } from './cell-history-popover.tsx';
import { LAST_DONE_SETTLE_MS } from '../ui/last-done-announcer.ts';
import { LiveAnnouncer } from '../ui/live-announcer.tsx';
import { swallowRestOfPress } from '../ui/press-swallow.ts';
import type { VersionHistoryAct } from '../state/event-reducer.ts';
import type { ShownVersionHistory, ShownVersionLook } from './version-history.ts';

export function earlierVersionBarActions({ history: versionHistory, look, onAct }: Pick<EarlierVersionBarProps, 'history' | 'look' | 'onAct'>) {
  const lookedVersion =
    versionHistory.versions?.find(({ firstRevision }) => firstRevision === look.firstRevision) ?? null;
  let restore =
    lookedVersion === null
      ? null
      : restoreOfVersion({
          version: lookedVersion,
          isTakingBack: versionHistory.isTakingBack,
          onAct,
        });
  return {
    restore:
      lookedVersion === null || restore === null
        ? null
        : {
            ...restore,
            go: () =>
              onAct({
                kind: 'restore',
                revision: lookedVersion.revision,
                isFromBar: true,
              }),
          },
    goBack: () =>
      onAct({
        kind: 'endLook',
        isFromBar: true,
      }),
  };
}
export function earlierVersionAnnouncement(look: ShownVersionLook | null, nowMs: number, isEarlierVersionLeft: boolean): string | null {
  if (look === null) return isEarlierVersionLeft ? versionHistoryMessages.currentVersionSaid() : null;
  return look.isOpening ? versionHistoryMessages.openingVersion() : versionHistoryMessages.earlierVersionSaid(versionTimeText(look.atMs, nowMs));
}
interface EarlierVersionAnnouncerProps {
  look: ShownVersionLook | null;
  /** Whether the page was just drawn again on leaving an earlier version. */
  isEarlierVersionLeft: boolean;
}
export function EarlierVersionAnnouncer({ look, isEarlierVersionLeft }: EarlierVersionAnnouncerProps) {
  let todayMs = useStartOfToday();
  let [isLeftStill, setIsLeftStill] = React.useState(isEarlierVersionLeft);
  if (look !== null && isLeftStill) setIsLeftStill(false);
  let announcement = earlierVersionAnnouncement(look, todayMs, isLeftStill);
  let [said, setSaid] = React.useState<string | null>(null);
  React.useEffect(() => {
    let timer = setTimeout(() => setSaid(announcement), LAST_DONE_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [announcement]);
  return <LiveAnnouncer words={said} />;
}
export const EARLIER_VERSION_BAR_RESTORE_WIDTH = 340;
export const pressAndFocus =
  (action: () => void) =>
  (event: React.MouseEvent<HTMLElement>) => {
    swallowRestOfPress(event);
    event.currentTarget.focus({
      preventScroll: true,
    });
    action();
  };
interface EarlierVersionBarProps {
  history: Pick<ShownVersionHistory, 'versions' | 'isTakingBack'>;
  look: ShownVersionLook;
  onAct: (act: VersionHistoryAct) => void;
  barRef: React.RefObject<HTMLDivElement | null>;
  /** Told whether the bar is wide enough to hold the restore button. */
  onRoomForRestore: (isRoom: boolean) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  /** Called when the bar goes away while it has the caret. */
  onGoneWithKeyboard: () => void;
}
export const EarlierVersionBar = React.memo(function (props: EarlierVersionBarProps) {
  let { look, barRef, onRoomForRestore } = props;
  let onGoneWithKeyboardEvent = React.useEffectEvent(props.onGoneWithKeyboard);
  let todayMs = useStartOfToday();
  let [barWidthRem, setBarWidthRem] = React.useState(1 / 0);
  React.useLayoutEffect(() => {
    let [bar, defaultView] = [barRef.current, barRef.current?.ownerDocument.defaultView];
    if (bar === null || defaultView === null || defaultView === undefined) return;
    let ownerDocument = bar.ownerDocument;
    let measure = () => {
      let rootFontSize = Number.parseFloat(defaultView.getComputedStyle(ownerDocument.documentElement).fontSize);
      let widthRem = (bar.getBoundingClientRect().width * 16) / rootFontSize;
      setBarWidthRem(widthRem);
      onRoomForRestore(widthRem >= EARLIER_VERSION_BAR_RESTORE_WIDTH);
    };
    measure();
    let resizeObserver = new defaultView.ResizeObserver(measure);
    resizeObserver.observe(bar);
    return () => {
      resizeObserver.disconnect();
      onRoomForRestore(false);
      if (bar.contains(ownerDocument.activeElement)) onGoneWithKeyboardEvent();
    };
  }, [barRef, onRoomForRestore]);
  let { restore, goBack } = earlierVersionBarActions(props);
  let isWide = barWidthRem >= 556;
  let isMedium = barWidthRem >= 464;
  let atText = look.isOpening ? null : versionTimeText(look.atMs, todayMs);
  let barTitle = look.isOpening ? versionHistoryMessages.openingVersion() : versionHistoryMessages.viewOnly();
  return <Toolbar ref={barRef} flush className="w-140 max-w-full py-0" label={versionHistoryMessages.title()} divider={false} onKeyDownCapture={(event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) goBack();
    }} onKeyDown={props.onKeyDown} actions={<>{isWide
          ? <Button variant="ghost" onClick={pressAndFocus(goBack)}>{versionHistoryMessages.backToEditing()}</Button>
          : <Button variant="ghost" iconOnly icon="X" aria-label={versionHistoryMessages.backToEditing()} onClick={pressAndFocus(goBack)} />}{restore !== null &&
          barWidthRem >= EARLIER_VERSION_BAR_RESTORE_WIDTH &&
          <Button variant="secondary" busy={restore.isBusy} disabled={restore.isOff} onClick={pressAndFocus(restore.go)}>{versionHistoryMessages.restore()}</Button>}</>}><div aria-hidden className="flex h-control min-w-0 flex-1 items-center gap-2 overflow-hidden ps-2 pe-1 whitespace-nowrap">{isMedium &&
          atText !== null &&
          <span className="text-body text-primary tabular-nums">{atText}</span>}<span className="text-caption text-secondary">{barTitle}</span></div></Toolbar>;
});
