import { Dialog, type DialogPopupProps } from '../kit/dialog.tsx';
import { Form } from '../kit/form.tsx';
import { RadioGroup } from '../kit/radio-group.tsx';
import { Button } from '../kit/button.tsx';
import * as React from 'react';
import { resizeRowsLabel } from '../i18n/grid-action-labels.ts';
import { sheetMessages } from '../i18n/sheet-messages.ts';
import { PixelsInput } from '../ui/pixels-input.tsx';
import { MIN_ROW_HEIGHT, MAX_ROW_HEIGHT } from '../model/line-sizes.ts';
import { DensityPicker } from '../ui/density-menu.tsx';
import type { CellDensity } from './cell-metrics-values.ts';
/** How the rows' height is picked in the dialog: as typed in pixels, or to fit their text. */
export type RowHeightGoesBy = 'height' | 'text';
/** What is picked in the row height dialog, and whether it is still as the dialog opened. */
export interface RowHeightPick {
  goesBy: RowHeightGoesBy;
  height: number | null;
  isAsOpened: boolean;
}
/** A row height chosen in the dialog: in pixels, or null to fit the text. */
export interface ChosenRowHeight {
  heightInPixels: number | null;
}
export interface RowHeightDialogProps {
  isOpen: boolean;
  rowCount: number;
  heightInPixels: number;
  isHeightGiven: boolean;
  density: CellDensity;
  onDensityChosen: (density: CellDensity) => void;
  whatHasCaretAfter: DialogPopupProps['finalFocus'];
  onHeightChosen: (chosen: ChosenRowHeight | null) => void;
}
export function chosenRowHeight({ goesBy, height, isAsOpened }: RowHeightPick, isHeightGiven: boolean): ChosenRowHeight | null | undefined {
  if (isAsOpened && !isHeightGiven) return null;
  if (goesBy === 'text')
    return {
      heightInPixels: null,
    };
  return height === null
    ? undefined
    : {
        heightInPixels: height,
      };
}
export const heightPickAsOpened = (height: number): RowHeightPick => ({
  goesBy: 'height',
  height,
  isAsOpened: true,
});
export const followGivenHeight = (heightPick: RowHeightPick, height: number): RowHeightPick =>
  heightPick.isAsOpened && heightPick.height !== height ? heightPickAsOpened(height) : heightPick;
export const changedHeightPick = (heightPick: RowHeightPick, change: Partial<Pick<RowHeightPick, 'goesBy' | 'height'>>): RowHeightPick => ({
  ...heightPick,
  ...change,
  isAsOpened: false,
});
export const RowHeightDialog = React.memo(function ({
  isOpen,
  rowCount,
  heightInPixels,
  isHeightGiven,
  density,
  onDensityChosen,
  whatHasCaretAfter,
  onHeightChosen,
}: RowHeightDialogProps) {
  let [heightPick, setHeightPick] = React.useState(heightPickAsOpened(heightInPixels));
  let [wasOpen, setWasOpen] = React.useState(false);
  if (isOpen !== wasOpen) {
    setWasOpen(isOpen);
    if (isOpen) setHeightPick(heightPickAsOpened(heightInPixels));
  } else if (isOpen && followGivenHeight(heightPick, heightInPixels) !== heightPick) setHeightPick(followGivenHeight(heightPick, heightInPixels));
  let heightInputRef = React.useRef<HTMLInputElement>(null);
  let goesByRef = React.useRef<HTMLDivElement>(null);
  let heightChosen = chosenRowHeight(heightPick, isHeightGiven);
  let chooseHeight = () => {
    if (heightChosen !== undefined) onHeightChosen(heightChosen);
  };
  return <Dialog.Root open={isOpen} onOpenChange={(open: boolean) => {
      if (!open) onHeightChosen(null);
    }}><Dialog.Popup size="sm" initialFocus={heightInputRef} finalFocus={whatHasCaretAfter}><Form className="contents" onSubmit={chooseHeight} onKeyDown={(keyEvent: React.KeyboardEvent<HTMLFormElement>) => {
          if (keyEvent.key !== 'Enter') return;
          if (keyEvent.repeat) keyEvent.preventDefault();
          else if (keyEvent.target instanceof Node && goesByRef.current?.contains(keyEvent.target) === true) chooseHeight();
        }}><Dialog.Header>{resizeRowsLabel(rowCount)}</Dialog.Header><div className="flex flex-col gap-md"><RadioGroup.Root ref={goesByRef} aria-label={sheetMessages.rowHeight()} value={heightPick.goesBy} onValueChange={(goesByPicked) =>
                  setHeightPick(
                    changedHeightPick(heightPick, {
                      goesBy: goesByPicked === 'text' ? 'text' : 'height',
                    }),
                  )}><RadioGroup.Item value="height" label={sheetMessages.setHeight()} /><RadioGroup.Item value="text" label={sheetMessages.fitToText()} /></RadioGroup.Root><PixelsInput ref={heightInputRef} label={sheetMessages.heightInPixels()} smallest={MIN_ROW_HEIGHT} largest={MAX_ROW_HEIGHT} disabled={heightPick.goesBy === 'text'} value={heightPick.height} onValueChange={(height: number | null) => {
                  if (height !== heightPick.height)
                    setHeightPick(
                      changedHeightPick(heightPick, {
                        height,
                      }),
                    );
                }} /><DensityPicker density={density} onDensityChosen={onDensityChosen} /></div><Dialog.Footer align="end"><Dialog.Close render={<Button variant="secondary">{sheetMessages.cancel()}</Button>} /><Button type="submit" variant="primary" disabled={heightChosen === undefined}>{resizeRowsLabel(rowCount)}</Button></Dialog.Footer></Form></Dialog.Popup></Dialog.Root>;
});
