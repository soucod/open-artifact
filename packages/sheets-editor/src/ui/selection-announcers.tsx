import type { PointedCellsTip } from '../formulas/reference-pointing.ts';
import type { SelectedRangeView } from '../view/page-view.ts';
import * as React from 'react';
import { cellsSelectedText, severalRangesSelectedText, pointedCellText } from '../i18n/status-labels.ts';
import { LiveAnnouncer } from './live-announcer.tsx';
/** Words for the cells, said once they have stayed the same for a moment. */
export function useDelayedAnnouncement(cells: string | null, wordsOf: (cells: string) => string) {
  const [words, setWords] = React.useState<string | null>(null);
  const wordsOfEvent = React.useEffectEvent(wordsOf);
  React.useEffect(() => {
    const timer = setTimeout(() => setWords(cells === null ? null : wordsOfEvent(cells)), SELECTION_ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [cells]);
  return words;
}
export interface SelectedRangeAnnouncerProps {
  selectedRange: SelectedRangeView | null;
}
export function SelectedRangeAnnouncer({ selectedRange }: SelectedRangeAnnouncerProps) {
  const summaryOf = () => selectedRange?.summary ?? null;
  const words = useDelayedAnnouncement(selectedRange?.cells ?? null, (cells) => {
    const several = selectedRange?.ofSeveral;
    return several === undefined ? cellsSelectedText(cells, summaryOf(), selectedRange?.outOfSight) : severalRangesSelectedText(several, summaryOf());
  });
  return <LiveAnnouncer words={words} />;
}
export interface PointedCellsAnnouncerProps {
  pointedCells: PointedCellsTip | null;
  isEntryOpen: boolean;
}
export function PointedCellsAnnouncer({ pointedCells, isEntryOpen }: PointedCellsAnnouncerProps) {
  const wasArrowHintSaidRef = React.useRef(false);
  React.useEffect(() => {
    if (!isEntryOpen) wasArrowHintSaidRef.current = false;
  }, [isEntryOpen]);
  const words = useDelayedAnnouncement(pointedCells?.cells ?? null, () => {
    if (pointedCells === null) return '';
    const saysArrowHint = pointedCells.doArrowsMoveIt && !wasArrowHintSaidRef.current;
    if (saysArrowHint) wasArrowHintSaidRef.current = true;
    return pointedCellText(pointedCells, saysArrowHint);
  });
  return <LiveAnnouncer words={words} />;
}
export const SELECTION_ANNOUNCE_DELAY_MS = 500;
