import { useToasts } from '../kit/toast.tsx';
import { Progress } from '../kit/progress.tsx';
import { useUiWindow } from '../kit/theme.tsx';
import type { KeyAct } from '../keys/key-acts.ts';
import type { ConnectionProblem } from '../shell/connection-news.ts';
import type { FollowedValue } from '../state/followed-values.ts';
import type { Notice, SavingState } from '../state/initial-state.ts';
import type { PageView } from '../view/page-view.ts';
import * as React from 'react';
import { saveStatusText, savingChangesText, calculatingFormulasText, allChangesSavedText } from '../i18n/notice-labels.ts';
import { useFollowed, useFollowedValueOf } from '../state/followed-values.ts';
import { UncommentableToastText } from '../shell/ui-root.tsx';
import { isEditRefusedForSaving } from '../state/queries.ts';
import { applyingOwnFilterLabel } from '../tables/filter-messages.ts';
import type { OwnViewShownAsApplied } from '../tables/filter-messages.ts';
/** The card that tells how saving goes, or what is wrong with the connection. */
export interface SaveStatusCard {
  words: string;
  isAboutConnection: boolean;
  isAboutPause: boolean;
  isWarning: boolean;
  asksForReload: boolean;
  offersReload: boolean;
  /** How long to wait before the words are shown. */
  waitMs: number;
}
/** Where the page stands in saying that all changes are saved: owed (in the status line, or on the card), said, or not at all. */
export type AllSavedSay = 'none' | 'owedInLine' | 'owed' | 'said' | 'saidInLine';
export interface AllSavedSituation {
  saving: SavingState;
  isCardDue: boolean;
  wereEditsDropped: boolean;
}
/** Where the page stands in telling of a long calculation: told, its end said, or neither. */
export type LongCalculationSay = 'none' | 'told' | 'endSaid';
/** Where the page stands in telling that the connection is back. */
export type ConnectionBackSay = 'none' | 'told' | 'backSaid';
export interface ConnectionBackSituation {
  isReconnectingSaid: boolean;
  isOpen: boolean;
  /** The status line already says something else. */
  isLineTaken: boolean;
}
/** What the save toast shows under its words. */
export type SaveToastUnder = 'action' | 'bar' | 'barOfUnknownLength' | 'nothing';
export interface SaveToastContent {
  words: string;
  isWarning: boolean;
  under: SaveToastUnder;
}
export interface SaveToastSituation {
  words: string | null;
  isWarning: boolean;
  areWordsDue: boolean;
  under: SaveToastUnder;
  isLongSaveTold: boolean;
  isLongCalculationTold: boolean;
  /** The own sort or filter being applied while the calculation is told, if any. */
  ownViewShownAsApplied?: OwnViewShownAsApplied | null;
  isAllSavedSaid: boolean;
}
export function saveStatusCard(
  saving: SavingState,
  hasUnsavedEdits: boolean,
  connectionNews: ConnectionProblem | null,
  isRetryLong: boolean = false,
  isEditingPaused: boolean = false,
): SaveStatusCard | null {
  const connectionCard =
    connectionNews === null
      ? null
      : {
          words: connectionNews.inWords,
          isAboutConnection: true,
          isAboutPause: false,
          isWarning: false,
          asksForReload: connectionNews.asksForReload,
          offersReload: connectionNews.asksForReload && !hasUnsavedEdits,
          waitMs: connectionNews.mayPass ? PASSING_CONNECTION_NOTICE_DELAY_MS : 0,
        };
  const words = saveStatusText(saving, hasUnsavedEdits, isRetryLong, isEditingPaused);
  if (words === null) return connectionCard;
  if (connectionNews !== null && !connectionNews.mayPass && !hasUnsavedEdits && saving === 'stopped') return connectionCard;
  const isAboutPause = saving === 'allSaved' || saving === 'saving';
  if (isAboutPause && connectionNews !== null && !connectionNews.mayPass) return connectionCard;
  const asksForReload = saving !== 'retrying' && !isAboutPause;
  return {
    words,
    isAboutConnection: false,
    isAboutPause,
    isWarning: saving === 'retrying' && isRetryLong,
    asksForReload,
    offersReload: asksForReload && !hasUnsavedEdits,
    waitMs: saving === 'retrying' ? RETRYING_NOTICE_DELAY_MS : 0,
  };
}
export function isConnectionNewsCoveredBySaveCard(saving: SavingState, connectionNews: ConnectionProblem | null) {
  if (connectionNews === null || connectionNews.mayPass) return true;
  const card = saveStatusCard(saving, connectionNews.areEditsUnsaved, connectionNews);
  return card !== null && (card.isAboutConnection || (connectionNews.asksForReload && card.asksForReload));
}
export function nextAllSavedSay(allSavedSay: AllSavedSay, situation: AllSavedSituation): AllSavedSay {
  const isOwed = allSavedSay === 'owedInLine' || allSavedSay === 'owed';
  if (situation.saving === 'retrying') return isOwed ? allSavedSay : 'owedInLine';
  if (!isOwed) return situation.isCardDue || situation.saving !== 'allSaved' ? 'none' : allSavedSay;
  if (situation.wereEditsDropped) return 'none';
  if (situation.saving === 'saving') return allSavedSay;
  if (situation.saving !== 'allSaved') return 'none';
  return allSavedSay === 'owed' ? 'said' : 'saidInLine';
}
/** Whether `isTrue` has held for `delayMs` while the page was visible. */
export function useIsTrueForVisibleMs(isTrue: boolean, delayMs: number) {
  const [isDue, setIsDue] = React.useState(false);
  const pageWindow = useUiWindow();
  React.useEffect(() => {
    if (!isTrue || pageWindow === undefined) return;
    const doc = pageWindow.document;
    let remainingMs = delayMs;
    let startedAt = 0;
    let timer: number | null = null;
    const restartTimer = () => {
      if (timer !== null) {
        pageWindow.clearTimeout(timer);
        timer = null;
        remainingMs -= pageWindow.performance.now() - startedAt;
      }
      if (doc.hidden) return;
      startedAt = pageWindow.performance.now();
      timer = pageWindow.setTimeout(() => setIsDue(true), remainingMs);
    };
    restartTimer();
    doc.addEventListener('visibilitychange', restartTimer);
    return () => {
      doc.removeEventListener('visibilitychange', restartTimer);
      if (timer !== null) pageWindow.clearTimeout(timer);
      setIsDue(false);
    };
  }, [isTrue, delayMs, pageWindow]);
  return isTrue && isDue;
}
export interface SaveProgressBarProps {
  fractionSaved: FollowedValue<number>;
}
export function SaveProgressBar({ fractionSaved }: SaveProgressBarProps) {
  return <Progress.Root value={useFollowed(fractionSaved)} size="sm" aria-label={savingChangesText()} className="flex items-center gap-md"><Progress.Track><Progress.Indicator /></Progress.Track><Progress.Value /></Progress.Root>;
}
export function saveToastContent({
  words,
  isWarning,
  areWordsDue,
  under,
  isLongSaveTold,
  isLongCalculationTold,
  ownViewShownAsApplied = null,
  isAllSavedSaid,
}: SaveToastSituation): SaveToastContent | null {
  if (words !== null && areWordsDue)
    return {
      words,
      isWarning,
      under,
    };
  if (under === 'bar')
    return {
      words: savingChangesText(),
      isWarning: false,
      under,
    };
  if (isLongCalculationTold)
    return {
      words: calculatingWords(ownViewShownAsApplied),
      isWarning: false,
      under: 'barOfUnknownLength',
    };
  if (isLongSaveTold)
    return {
      words: savingChangesText(),
      isWarning: false,
      under,
    };
  return isAllSavedSaid
    ? {
        words: allChangesSavedText(),
        isWarning: false,
        under: 'nothing',
      }
    : null;
}
export interface SaveStatusToastProps {
  card: SaveStatusCard | null;
  fractionSaved: number | null;
  isLongSaveTold: boolean;
  isLongCalculationTold: boolean;
  ownViewShownAsApplied: OwnViewShownAsApplied | null;
  isAllSavedSaid: boolean;
  /** A button to show under the words, such as one to reload the page. */
  action: React.ReactElement | undefined;
  /** Called when the card's words come up. */
  onUp: () => void;
  onBarUp: () => void;
}
export function SaveStatusToast({
  card,
  fractionSaved,
  isLongSaveTold,
  isLongCalculationTold,
  ownViewShownAsApplied,
  isAllSavedSaid,
  action,
  onUp,
  onBarUp,
}: SaveStatusToastProps) {
  const toast = useToasts();
  const shownFraction = useFollowedValueOf(fractionSaved ?? 0);
  const pinToast = React.useEffectEvent((words: string, isWarning: boolean, shownUnder: SaveToastUnder) => {
    toast.setPinned({
      title: <UncommentableToastText>{words}</UncommentableToastText>,
      variant: isWarning ? 'warning' : 'neutral',
      action:
        shownUnder === 'action'
          ? action
          : shownUnder === 'bar'
            ? <SaveProgressBar fractionSaved={shownFraction} />
            : shownUnder === 'barOfUnknownLength'
              ? <CalculatingProgressBar words={words} />
              : undefined,
    });
  });
  const callOnUp = React.useEffectEvent(() => onUp());
  const callOnBarUp = React.useEffectEvent(() => onBarUp());
  const unpinToast = React.useEffectEvent(() => toast.setPinned(null));
  const wordsDueAtRef = React.useRef(Number.POSITIVE_INFINITY);
  const pageWindow = useUiWindow();
  const under: SaveToastUnder = action !== undefined ? 'action' : fractionSaved !== null ? 'bar' : 'nothing';
  const waitMs = isLongSaveTold && under !== 'bar' && card !== null ? 0 : card?.waitMs;
  const [cardWords, isCardWarning] = [card?.words ?? null, card?.isWarning ?? false];
  React.useEffect(() => {
    if (pageWindow === undefined) return;
    const now = pageWindow.performance.now();
    wordsDueAtRef.current = waitMs === undefined ? Number.POSITIVE_INFINITY : Math.min(wordsDueAtRef.current, now + waitMs);
    const showToast = (isDueNow: boolean) => {
      const content = saveToastContent({
        words: cardWords,
        isWarning: isCardWarning,
        areWordsDue: isDueNow,
        under,
        isLongSaveTold,
        isLongCalculationTold,
        ownViewShownAsApplied,
        isAllSavedSaid,
      });
      if (content === null) unpinToast();
      else pinToast(content.words, content.isWarning, content.under);
      if (isDueNow) callOnUp();
    };
    const areWordsDue = cardWords !== null && wordsDueAtRef.current <= now;
    showToast(areWordsDue);
    if (cardWords === null || areWordsDue) return;
    const timer = pageWindow.setTimeout(() => showToast(true), wordsDueAtRef.current - now);
    return () => pageWindow.clearTimeout(timer);
  }, [pageWindow, cardWords, waitMs, under, isCardWarning, isLongSaveTold, isLongCalculationTold, ownViewShownAsApplied, isAllSavedSaid]);
  const isBarShown = under === 'bar';
  React.useEffect(() => {
    if (isBarShown) callOnBarUp();
  }, [isBarShown]);
  React.useEffect(() => {
    if (isLongSaveTold) callOnBarUp();
  }, [isLongSaveTold]);
  React.useEffect(() => () => unpinToast(), []);
  return null;
}
export const RETRYING_NOTICE_DELAY_MS = 5000;
export const PASSING_CONNECTION_NOTICE_DELAY_MS = 7000;
export const LONG_SAVE_NOTICE_DELAY_MS = 2000;
export const LONG_RETRY_WARNING_MS = 90000;
export const SAID_NOTICE_SHOWN_MS = 6000;
export const isSavingStoppedRefusal = (notice: Notice) => notice.kind === 'editRefused' && notice.why === 'savingStopped';
export const isNoticeApartFromSaveCard = (notice: Notice, card: SaveStatusCard | null) =>
  !isEditRefusedForSaving(notice) ||
  card?.isAboutConnection === true ||
  (notice.kind === 'editRefused' && notice.why === 'editingPaused' && card?.isAboutPause !== true);
export const doesStepOutLeaveNotice = (action: Pick<KeyAct, 'kind'>, notice: PageView['notice'], card: SaveStatusCard | null) =>
  action.kind === 'stepOutOfCells' && notice !== null && isNoticeApartFromSaveCard(notice, card);
export const areEditsNewlyDropped = ({ newsOfLoss }: Pick<PageView, 'newsOfLoss'>, keptNews: PageView['newsOfLoss']) =>
  newsOfLoss?.kind === 'editsDropped' && newsOfLoss !== keptNews;
export const lossNewsAtAllSaved = (
  kept: PageView['newsOfLoss'],
  allSavedSay: AllSavedSay,
  { saving, newsOfLoss }: Pick<PageView, 'saving' | 'newsOfLoss'>,
) =>
  saving === 'allSaved' && allSavedSay !== 'owedInLine' && allSavedSay !== 'owed' ? newsOfLoss : kept;
export const nextLongCalculationSay = (
  calculationSay: LongCalculationSay,
  view: Pick<PageView, 'isLongCalculationTold' | 'calculating' | 'viewOnlyBecause'>,
  isWorkLeft: boolean,
): LongCalculationSay => {
  if (view.isLongCalculationTold) return 'told';
  if (view.calculating !== 'done' || view.viewOnlyBecause !== null || isWorkLeft) return 'none';
  return calculationSay === 'told' ? 'endSaid' : calculationSay;
};
export const nextConnectionBackSay = (backSay: ConnectionBackSay, connection: ConnectionBackSituation): ConnectionBackSay => {
  if (connection.isReconnectingSaid) return 'told';
  if (!connection.isOpen || connection.isLineTaken) return 'none';
  return backSay === 'told' ? 'backSaid' : backSay;
};
export const nextIsLongSaveTold = (wasTold: boolean, isSavingLong: boolean, saving: SavingState) =>
  isSavingLong || (wasTold && (saving === 'saving' || saving === 'retrying'));
export const CalculatingProgressBar = ({ words }: { words: string }) =>
  <Progress.Root value={null} size="sm" aria-label={words} />;
export const calculatingWords = (ownView: OwnViewShownAsApplied | null): string =>
  ownView === null ? calculatingFormulasText() : applyingOwnFilterLabel(ownView);
