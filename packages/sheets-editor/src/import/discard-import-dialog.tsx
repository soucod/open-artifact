import { AlertDialog } from '../kit/dialog.tsx';
import { Button } from '../kit/button.tsx';
import type { DialogPopupProps } from '../kit/dialog.tsx';
import * as React from 'react';
import { importReviewMessages } from './csv-file.tsx';
export interface DiscardImportDialogProps {
  isAsked: boolean;
  whatHasCaretAfter: DialogPopupProps['finalFocus'];
  onKept: () => void;
  onDropped: () => void;
}
export function DiscardImportDialog({
  isAsked,
  whatHasCaretAfter,
  onKept,
  onDropped,
}: DiscardImportDialogProps) {
  let keepButtonRef = React.useRef<HTMLButtonElement>(null);
  return <AlertDialog.Root open={isAsked} onOpenChange={(isOpen) => {
      if (!isOpen) onKept();
    }}><AlertDialog.Popup size="sm" className="text-balance" {...{
        [INITIAL_FOCUS_IS_SAFE_ATTRIBUTE]: '',
      }} initialFocus={keepButtonRef} finalFocus={whatHasCaretAfter} onKeyDown={(event) => {
        if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault();
      }}><AlertDialog.Header showClose={false} className="mb-1">{importReviewMessages.discardAsked()}</AlertDialog.Header><AlertDialog.Description>{importReviewMessages.whatDiscardCosts()}</AlertDialog.Description><AlertDialog.Footer align="end"><AlertDialog.Close render={<Button ref={keepButtonRef} data-initial-focus variant="secondary">{importReviewMessages.keepEditing()}</Button>} /><Button variant="danger" onClick={onDropped}>{importReviewMessages.discard()}</Button></AlertDialog.Footer></AlertDialog.Popup></AlertDialog.Root>;
}
export const INITIAL_FOCUS_IS_SAFE_ATTRIBUTE = 'data-initial-focus-is-safe';
