import { useToasts } from '../kit/toast.tsx';
import { Button } from '../kit/button.tsx';
import type { ToastCloseInfo } from '../kit/toast.tsx';
import * as React from 'react';
import { useFollowed, useFollowedValueOf } from '../state/followed-values.ts';
import type { FollowedValue } from '../state/followed-values.ts';
import type { MoveReplacedCellsOffer, UndoOffer } from '../state/initial-state.ts';
import { sheetMessages } from '../i18n/sheet-messages.ts';
import { UncommentableToastText } from '../shell/ui-root.tsx';
import { describeUndoOffer } from '../i18n/change-labels.ts';
import type { UndoOfferWords } from '../i18n/change-labels.ts';
/** An undo offer shown as a toast; a move that replaced cells is offered elsewhere. */
export type UndoOfferInToast = Exclude<UndoOffer, MoveReplacedCellsOffer>;
export interface ToastTitleTextProps {
  text: FollowedValue<string>;
}
export function ToastTitleText({ text }: ToastTitleTextProps) {
  return useFollowed(text);
}
export interface UndoToastButtonProps {
  label: string;
  isBusy: FollowedValue<boolean>;
  onPressed: () => void;
}
export function UndoToastButton({ label, isBusy, onPressed }: UndoToastButtonProps) {
  return <Button variant="secondary" size="sm" aria-label={label} busy={useFollowed(isBusy)} onClick={onPressed}>{sheetMessages.undo()}</Button>;
}
export interface UndoToastProps {
  words: UndoOfferWords;
  isBeingTaken: boolean;
  onTaken: () => void;
  onDismissed: () => void;
  onTakenDown?: () => void;
}
export function UndoToast({
  words: { title, undoLabel, ...toastWords },
  isBeingTaken,
  onTaken,
  onDismissed,
  onTakenDown,
}: UndoToastProps) {
  const toasts = useToasts();
  const keptTitle = useFollowedValueOf(title);
  const keptIsBeingTaken = useFollowedValueOf(isBeingTaken);
  const addToast = React.useEffectEvent(
    () =>
      toasts.add({
        ...toastWords,
        title: <UncommentableToastText><ToastTitleText text={keptTitle} /></UncommentableToastText>,
        action: <UndoToastButton label={undoLabel} isBusy={keptIsBeingTaken} onPressed={() => onTaken()} />,
        onClose: ({ byUser }: ToastCloseInfo) => {
          if (byUser) onDismissed();
        },
      }),
  );
  const closeToast = React.useEffectEvent((toastId: string) => {
    toasts.close(toastId);
    onTakenDown?.();
  });
  React.useEffect(() => {
    const toastId = addToast();
    return () => closeToast(toastId);
  }, []);
  return null;
}
/** A key that changes when the offer is a new one, so its toast is put up again. */
export function undoOfferKey(offer: UndoOfferInToast): string {
  switch (offer.kind) {
    case 'sheetDeleted':
    case 'placedViewDeleted':
    case 'namedViewDeleted':
      return offer.name;
    case 'tableImportedIntoSheet':
      return `${offer.sheetName} ${offer.addedCount} ${offer.changedCount}`;
    case 'tableImportedAsNewSheet':
      return `${offer.sheetName} ${offer.rowCount}`;
    case 'mergeClearedCells':
    case 'filledByFinger':
    case 'clearedWithNoKeyboard':
      return offer.cells;
    case 'dropdownClearedCells':
      return `${offer.cells} ${offer.formulaCount} ${offer.otherCount}`;
    case 'optionsGoneClearedCells':
      return String(offer.count);
    case 'dropdownOptionDeleted':
      return `${offer.label} ${offer.cellCount} ${offer.onlyIn}`;
    case 'rowsDeleted':
    case 'columnsDeleted':
      return `${offer.first}:${offer.last}`;
    case 'sortedWithNoKeyboard':
      return `${offer.column} ${offer.direction}`;
    case 'sortChangedResults':
      return `${offer.column} ${offer.direction} ${offer.results.firstCell} ${offer.results.count} ${offer.results.errorCount}`;
    case 'moveOfColumnsChangedResults':
      return `${offer.count} ${offer.results.firstCell} ${offer.results.count} ${offer.results.errorCount}`;
    case 'replacedInCells':
      return `${offer.count} ${offer.leftCount}`;
    case 'textsConverted':
      return `${offer.count} ${offer.leftCount}`;
    case 'versionRestored':
      return String(offer.atMs);
  }
}
export interface UndoOfferToastProps extends Pick<UndoToastProps, 'onTaken' | 'onDismissed' | 'onTakenDown'> {
  offer: UndoOfferInToast;
}
export function UndoOfferToast({ offer, ...toastProps }: UndoOfferToastProps) {
  return <UndoToast key={`${offer.kind} ${undoOfferKey(offer)}`} words={describeUndoOffer(offer)} isBeingTaken={false} {...toastProps} />;
}
