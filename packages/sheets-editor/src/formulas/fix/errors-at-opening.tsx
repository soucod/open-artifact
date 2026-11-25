import { useToasts } from '../../kit/toast.tsx';
import type { SayWords } from '../../ui/settled-announcers.tsx';
import type { ToastCloseInfo } from '../../kit/toast.tsx';
import * as React from 'react';
import { subscribeToFocusIn, announceWhenSettled } from '../../ui/settled-announcers.tsx';
import { LiveAnnouncer } from '../../ui/live-announcer.tsx';
import { useFollowedValueOf, useFollowed } from '../../state/followed-values.ts';
import type { FollowedValue } from '../../state/followed-values.ts';
import { agentFixStateOf, AskAgentToFixButton } from '../../ui/ask-agent-to-fix-button.tsx';
import { DangerWarningIcon } from '../../ui/warning-icon.tsx';
import { UncommentableToastText } from '../../shell/ui-root.tsx';
import { errorCountLabel } from '../../i18n/grid-action-labels.ts';
import { errorsWithFixButtonText } from '../../i18n/formula-fix-labels.ts';
import type { PageView } from '../../view/page-view.ts';
import type { SheetController } from '../../state/controller.ts';
import type { WordsOfLoad } from '../../shell/load-announcer.ts';
/** Whether the page fixes the errors itself: now, not yet, or not at all. */
export type FixedHere = 'no' | 'notNow' | 'now';
/** What of the store tells of the errors found when the sheet opened. */
type StoreOfErrorsAtOpening = Pick<SheetController, 'subscribe' | 'getView'>;
type WordsOfLoadHeard = Pick<WordsOfLoad, 'onChanged' | 'areWordsToCome'>;
export function areFixesOnOffer(fixes: PageView['fixesOnCells']): boolean {
  let stage = fixes?.stage;
  return stage === 'offered' || stage === 'undecided';
}
interface ErrorsAtOpeningAnnouncerProps {
  store: StoreOfErrorsAtOpening;
  wordsOfLoad: WordsOfLoadHeard;
  inPageOf: React.RefObject<HTMLElement | null>;
  isToastUp: boolean;
}
export function ErrorsAtOpeningAnnouncer({ store, wordsOfLoad, inPageOf, isToastUp }: ErrorsAtOpeningAnnouncerProps) {
  let [errorsWords, setErrorsWords] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!isToastUp) return;
    let stopAnnouncing = announceErrorsAtOpening(store, wordsOfLoad, setErrorsWords, subscribeToFocusIn(inPageOf));
    return () => {
      stopAnnouncing();
      setErrorsWords(null);
    };
  }, [store, wordsOfLoad, inPageOf, isToastUp]);
  return <LiveAnnouncer words={errorsWords} />;
}
interface ErrorsAtOpeningToastProps {
  count: number;
  onAgentAsked: (isInPlace: boolean) => void;
  onDismissed: () => void;
  onTakenDown: () => void;
  cells: string | null;
  canAttach: boolean;
  fixedHere: FixedHere;
}
export function ErrorsAtOpeningToast({
  count,
  onAgentAsked,
  onDismissed,
  onTakenDown,
  cells,
  canAttach,
  fixedHere,
}: ErrorsAtOpeningToastProps) {
  let toaster = useToasts();
  let agentForCells = useFollowedValueOf(agentFixStateOf(cells, canAttach, fixedHere));
  let shownCount = useFollowedValueOf(count);
  let showToast = React.useEffectEvent(
    () =>
      toaster.add({
        title: <ErrorCountToastTitle count={shownCount} />,
        icon: <DangerWarningIcon size="md" />,
        action: <AskAgentToFixButton agent={agentForCells} onPress={(isInPlace: boolean) => onAgentAsked(isInPlace)} />,
        onClose: ({ byUser }: ToastCloseInfo) => {
          if (byUser) onDismissed();
        },
      }),
  );
  let closeToast = React.useEffectEvent((toastId: string) => {
    toaster.close(toastId);
    onTakenDown();
  });
  React.useEffect(() => {
    let toastId = showToast();
    return () => closeToast(toastId);
  }, []);
  return null;
}
interface ErrorCountToastTitleProps {
  count: FollowedValue<number>;
}
export const ErrorCountToastTitle = ({ count }: ErrorCountToastTitleProps) =>
  <UncommentableToastText>{errorCountLabel(useFollowed(count))}</UncommentableToastText>;
export const errorsAtOpeningWords = (
  { count, cells }: Pick<NonNullable<PageView['errorsAtOpening']>, 'count' | 'cells'>,
  isFixErrorsButton: boolean,
): string => (cells === null && !isFixErrorsButton ? errorCountLabel(count) : errorsWithFixButtonText(count, isFixErrorsButton));
export const announceErrorsAtOpening = (
  store: StoreOfErrorsAtOpening,
  wordsOfLoad: WordsOfLoadHeard,
  say: SayWords,
  subscribeToFocus: ReturnType<typeof subscribeToFocusIn>,
) =>
  announceWhenSettled(
    (onChange: () => void) => {
      let unsubscribes = [store.subscribe(onChange), wordsOfLoad.onChanged(onChange)];
      return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
    },
    () => {
      let { errorsAtOpening, fixesOnCells, nameBoxText, mode } = store.getView();
      return {
        words:
          errorsAtOpening !== null && !wordsOfLoad.areWordsToCome() ? errorsAtOpeningWords(errorsAtOpening, areFixesOnOffer(fixesOnCells)) : null,
        about: errorsAtOpening?.sheetId ?? null,
        nameBoxText,
        mode,
      };
    },
    say,
    subscribeToFocus,
  );
