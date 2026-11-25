import { Dialog, type DialogPopupProps } from '../kit/dialog.tsx';
import { Form } from '../kit/form.tsx';
import { RadioGroup } from '../kit/radio-group.tsx';
import { Button } from '../kit/button.tsx';
import * as React from 'react';
import { resizeColumnsLabel } from '../i18n/grid-action-labels.ts';
import { sheetMessages } from '../i18n/sheet-messages.ts';
import { PixelsInput } from '../ui/pixels-input.tsx';
import { MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH } from '../model/line-sizes.ts';
import type { ColumnWidthChosen } from '../state/event-reducer.ts';
/** How the columns' width is picked in the dialog: as typed in pixels, or to fit their text. */
export type ColumnWidthGoesBy = 'width' | 'text';
export interface ColumnWidthDialogProps {
  isOpen: boolean;
  columnCount: number;
  widthInPixels: number;
  whatHasCaretAfter: DialogPopupProps['finalFocus'];
  /** Gets the width chosen, in pixels or to fit the text, or null when the dialog is shut without one. */
  onWidthChosen: (chosen: ColumnWidthChosen['widthInPixels']) => void;
}
export const ColumnWidthDialog = React.memo(function ({
  isOpen,
  columnCount,
  widthInPixels,
  whatHasCaretAfter,
  onWidthChosen,
}: ColumnWidthDialogProps) {
  let [width, setWidth] = React.useState<number | null>(widthInPixels);
  let [goesBy, setGoesBy] = React.useState<ColumnWidthGoesBy>('width');
  let [wasOpen, setWasOpen] = React.useState(false);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setWidth(widthInPixels);
      setGoesBy('width');
    }
  }
  let widthInputRef = React.useRef<HTMLInputElement>(null);
  let isFitToText = goesBy === 'text';
  let widthChosen: ColumnWidthChosen['widthInPixels'] = isFitToText ? 'fitToText' : width;
  let chooseWidth = () => {
    if (widthChosen !== null) onWidthChosen(widthChosen);
  };
  return <Dialog.Root open={isOpen} onOpenChange={(open: boolean) => {
      if (!open) onWidthChosen(null);
    }}><Dialog.Popup size="sm" initialFocus={widthInputRef} finalFocus={whatHasCaretAfter}><Form className="contents" onSubmit={chooseWidth} onKeyDown={(keyEvent: React.KeyboardEvent<HTMLFormElement>) => {
          if (keyEvent.key !== 'Enter') return;
          if (keyEvent.repeat) keyEvent.preventDefault();
          else if (keyEvent.target instanceof Element && keyEvent.target.role === 'radio') chooseWidth();
        }}><Dialog.Header>{resizeColumnsLabel(columnCount)}</Dialog.Header><div className="flex flex-col gap-md"><RadioGroup.Root aria-label={sheetMessages.columnWidth()} value={goesBy} onValueChange={(goesByPicked) => setGoesBy(goesByPicked === 'text' ? 'text' : 'width')}><RadioGroup.Item value="width" label={sheetMessages.setWidth()} /><RadioGroup.Item value="text" label={sheetMessages.fitColumnToText()} /></RadioGroup.Root><PixelsInput ref={widthInputRef} label={sheetMessages.widthInPixels()} smallest={MIN_COLUMN_WIDTH} largest={MAX_COLUMN_WIDTH} disabled={isFitToText} value={width} onValueChange={setWidth} /></div><Dialog.Footer align="end"><Dialog.Close render={<Button variant="secondary">{sheetMessages.cancel()}</Button>} /><Button type="submit" variant="primary" disabled={widthChosen === null}>{resizeColumnsLabel(columnCount)}</Button></Dialog.Footer></Form></Dialog.Popup></Dialog.Root>;
});
