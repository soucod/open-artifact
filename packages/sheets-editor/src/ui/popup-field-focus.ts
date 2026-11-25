import * as React from 'react';
import { offerKeyboardToField } from './keyboard-handoff.ts';
export interface PopupFieldFocusOptions {
  isOpen: boolean;
  popup: React.RefObject<HTMLElement | null>;
  shut: () => void;
}
/** The field the popup focuses when it opens, or `false` when the field takes the keyboard later. */
export type PopupFieldToFocus = HTMLInputElement | false | null;
export function usePopupFieldFocus({ isOpen, popup, shut }: PopupFieldFocusOptions) {
  const callOffRef = React.useRef(() => {
    return;
  });
  const shutRef = React.useRef(shut);
  React.useLayoutEffect(() => {
    shutRef.current = shut;
  });
  React.useLayoutEffect(() => {
    if (!isOpen) callOffRef.current();
  }, [isOpen]);
  React.useEffect(() => () => callOffRef.current(), []);
  const [focusField] = React.useState(
    () => (): PopupFieldToFocus => {
      const field = popup.current?.querySelector('input') ?? null;
      if (popup.current === null || field === null) return null;
      callOffRef.current();
      const focusTrap = offerKeyboardToField(popup.current, field, () => shutRef.current());
      callOffRef.current = focusTrap.callOff;
      return focusTrap.answer;
    },
  );
  return focusField;
}
