import { AlertDialog } from '../kit/dialog.tsx';
import { Button } from '../kit/button.tsx';
import * as React from 'react';
import { usePopupGivenUpOnBlur } from '../ui/popup-given-up-on-blur.ts';
import { dataNextToCellsWarning, sortCellsInsteadQuestion, sortCellsOnlyLabel, sortCellsLabel } from '../i18n/grid-action-labels.ts';
import { sheetMessages } from '../i18n/sheet-messages.ts';
import type { CellsToSortChosen } from '../state/event-reducer.ts';
import type { CellsToSortAsked } from './sort.ts';
interface SortScopeDialogProps {
  /** The question of which cells to sort, or `null` when none is asked. */
  asked: CellsToSortAsked | null;
  /** Where the caret goes once the dialog shuts; `isFromPane` says the sort was asked in the sort pane. */
  whatHasCaretAfter: (isFromPane: boolean) => HTMLElement | false;
  onChosen: (chosen: CellsToSortChosen['chosen']) => void;
}
export const SortScopeDialog = React.memo(function ({
  asked,
  whatHasCaretAfter,
  onChosen,
}: SortScopeDialogProps) {
  let [shownAsked, setShownAsked] = React.useState(asked);
  if (asked !== null && asked !== shownAsked) setShownAsked(asked);
  let primaryRef = React.useRef<HTMLButtonElement>(null);
  let {
    isGivenUp,
    holdPopup,
    noteFocus,
  } = usePopupGivenUpOnBlur(asked !== null, () => onChosen(null));
  return <AlertDialog.Root open={asked !== null && !isGivenUp} onOpenChange={(isOpen) => {
      if (!isOpen) onChosen(null);
    }}><AlertDialog.Popup size="sm" initialFocus={primaryRef} finalFocus={() => whatHasCaretAfter(shownAsked?.change === 'sortByKeysOfPane')} ref={holdPopup} onFocus={noteFocus} onKeyDown={(event) => {
        if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault();
      }}>{shownAsked !== null &&
        <><AlertDialog.Header description={dataNextToCellsWarning(shownAsked.selection)}>{sortCellsInsteadQuestion(shownAsked.table)}</AlertDialog.Header><AlertDialog.Footer align="end" className="flex-wrap"><AlertDialog.Close render={<Button variant="secondary">{sheetMessages.cancel()}</Button>} /><Button variant="secondary" onClick={() => onChosen('selection')}>{sortCellsOnlyLabel(shownAsked.selection)}</Button><Button ref={primaryRef} data-initial-focus variant="primary" onClick={() => onChosen('table')}>{sortCellsLabel(shownAsked.table)}</Button></AlertDialog.Footer></>}</AlertDialog.Popup></AlertDialog.Root>;
});
