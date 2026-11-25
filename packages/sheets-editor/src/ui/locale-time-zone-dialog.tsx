import { Dialog } from '../kit/dialog.tsx';
import { Form } from '../kit/form.tsx';
import { Combobox } from '../kit/combobox.tsx';
import { Button } from '../kit/button.tsx';
import type { DialogPopupProps } from '../kit/dialog.tsx';
import type { PickForWorkbook } from '../state/initial-state.ts';
import * as React from 'react';
import { translateMessage } from '../i18n/messages.ts';
import { localeMessages, localeChoices, labelMatchesSearch } from '../messages/locale.ts';
import { timeZoneMessages, timeZoneOptions, pickedOrWorkbookSetting } from './locale-time-zone-pick.ts';
import { popupPropsUnderHeader } from '../shell/bottom-insets.ts';
import { sheetMessages } from '../i18n/sheet-messages.ts';
/** The pick being made, or the last one while the dialog closes. */
export function useLastPick(pick: PickForWorkbook | null) {
  const [lastPick, setLastPick] = React.useState<PickForWorkbook | null>(null);
  if (pick !== null && pick !== lastPick) setLastPick(pick);
  return pick ?? lastPick;
}
export function preventRepeatedEnter(keyEvent: React.KeyboardEvent) {
  if (keyEvent.key === 'Enter' && keyEvent.repeat) keyEvent.preventDefault();
}
export const localeTimeZoneDialogMessages = {
  search: () =>
    translateMessage({
      defaultMessage: 'Search',
      id: 'WtbUItQA+Q',
    }),
  noMatches: () =>
    translateMessage({
      defaultMessage: 'No matches',
      id: '8/k7bhQvXz',
    }),
  apply: () =>
    translateMessage({
      defaultMessage: 'Apply',
      id: 'X+HoQGASXX',
    }),
};
export const PICK_DIALOG_TEXTS = {
  locale: {
    title: localeMessages.locale,
    description: localeMessages.whatGoesByIt,
  },
  timeZone: {
    title: timeZoneMessages.timeZone,
    description: timeZoneMessages.whatGoesByIt,
  },
};
export interface LocaleTimeZoneDialogProps {
  pick: PickForWorkbook | null;
  whatHasCaretAfter: DialogPopupProps['finalFocus'];
  onPicked: (of: PickForWorkbook['of'], value: string) => void;
  onEntered: () => void;
  onDropped: () => void;
}
export const LocaleTimeZoneDialog = React.memo(function ({
  pick,
  whatHasCaretAfter,
  onPicked,
  onEntered,
  onDropped,
}: LocaleTimeZoneDialogProps) {
  const pickShown = useLastPick(pick);
  const { of: pickOf, all, ofWorkbook }: Partial<PickForWorkbook> = pickShown ?? {};
  const ofBrowser = pickShown?.of === 'timeZone' ? pickShown.ofBrowser : null;
  const pickItems = React.useMemo(
    () => (all === undefined ? [] : pickOf === 'locale' ? localeChoices(all) : timeZoneOptions(all, ofBrowser, ofWorkbook ?? null)),
    [pickOf, all, ofBrowser, ofWorkbook],
  );
  const comboboxBoxRef = React.useRef<HTMLDivElement>(null);
  const initialFocus = React.useCallback(() => comboboxBoxRef.current?.querySelector<HTMLElement>('[role="combobox"]'), []);
  const onOpenChange = React.useCallback(
    (open: boolean) => {
      if (!open) onDropped();
    },
    [onDropped],
  );
  const onChosen = React.useCallback(
    (chosen: string | null) => {
      if (chosen !== null && pickOf !== undefined) onPicked(pickOf, chosen);
    },
    [onPicked, pickOf],
  );
  if (pickShown === null) return null;
  const title = PICK_DIALOG_TEXTS[pickShown.of].title();
  return <Dialog.Root open={pick !== null} onOpenChange={onOpenChange}><Dialog.Popup size="sm" initialFocus={initialFocus} finalFocus={whatHasCaretAfter}><Form className="contents" onSubmit={onEntered} onKeyDown={preventRepeatedEnter}><Dialog.Header description={PICK_DIALOG_TEXTS[pickShown.of].description()}>{title}</Dialog.Header><div ref={comboboxBoxRef} data-initial-focus><Combobox {...popupPropsUnderHeader()} aria-label={title} searchable items={pickItems} filter={labelMatchesSearch} autoHighlight value={pickedOrWorkbookSetting(pickShown)} onChange={onChosen} searchPlaceholder={localeTimeZoneDialogMessages.search()} emptyMessage={localeTimeZoneDialogMessages.noMatches()} /></div><Dialog.Footer align="end"><Dialog.Close render={<Button variant="secondary">{sheetMessages.cancel()}</Button>} /><Button type="submit" variant="primary">{localeTimeZoneDialogMessages.apply()}</Button></Dialog.Footer></Form></Dialog.Popup></Dialog.Root>;
});
