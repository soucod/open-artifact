import * as React from 'react';
export interface FieldShortcutButtonProps {
  name: string;
  field: React.RefObject<HTMLElement | null>;
}
export function FieldShortcutButton({ name, field: fieldRef }: FieldShortcutButtonProps) {
  let buttonRef = React.useRef<HTMLButtonElement | null>(null);
  let [isGone, setIsGone] = React.useState(false);
  let focusField = () => fieldRef.current?.focus();
  React.useEffect(() => {
    let dialog = buttonRef.current?.closest<HTMLElement>('[role="dialog"]');
    let onFocusIn = ({ target }: FocusEvent) => {
      if (target !== buttonRef.current) setIsGone(true);
    };
    dialog?.addEventListener('focusin', onFocusIn);
    return () => dialog?.removeEventListener('focusin', onFocusIn);
  }, []);
  return isGone
    ? null
    : <button ref={buttonRef} type="button" className="sr-only" onClick={focusField} onKeyDown={({ key }) => {
          if (key.length === 1 && key !== ' ') focusField();
        }} onBlur={({ relatedTarget }) => {
          if (relatedTarget !== null) setIsGone(true);
        }}>{name}</button>;
}
