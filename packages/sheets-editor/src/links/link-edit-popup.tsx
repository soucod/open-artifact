import { FieldError, FieldLabel, FieldRoot } from '../kit/field.tsx';
import { TextInput } from '../kit/text-input.tsx';
import { Popover } from '../kit/popover.tsx';
import type { PopoverPopupProps } from '../kit/popover.tsx';
import { Button } from '../kit/button.tsx';
import * as React from 'react';
import { flattenEnteredText } from '../format/shown-text.ts';
import { canRemoveLink, linkAddressProblem } from './link-form.ts';
import type { LinkAddressProblem } from './link-form.ts';
import type { LinkForm } from '../state/initial-state.ts';
import { linkEditMessages } from './link-hover-card.tsx';
import { sheetMessages } from '../i18n/sheet-messages.ts';
import { useBottomInsetWhileOpen, popupCollisionPadding } from '../shell/bottom-insets.ts';
import { PRESS_TOO_SOON_MS } from '../ui/list-under-cell.tsx';
import { usePopupGivenUpOnBlur } from '../ui/popup-given-up-on-blur.ts';
import { IS_APPLE_PLATFORM } from '../ui/dom-events.ts';
import { isCommandHeld, latinKeyOf } from '../keys/key-press.ts';
interface LinkEditFormProps {
  form: LinkForm;
  addressField: React.RefObject<HTMLInputElement | null>;
  onSaved: (text: string, address: string) => void;
  onShut: () => void;
}
interface LinkEditPopupProps extends Pick<LinkEditFormProps, 'onSaved' | 'onShut'> {
  form: LinkForm | null;
  anchor: PopoverPopupProps['anchor'];
  whatHasCaretAfter: PopoverPopupProps['finalFocus'];
}
export function LinkEditForm({ form, addressField, onSaved, onShut }: LinkEditFormProps) {
  let shownText = flattenEnteredText(form.text);
  let [typedText, setTypedText] = React.useState(shownText);
  let text = typedText === shownText ? form.text : typedText;
  let [address, setAddress] = React.useState(form.address);
  let [addressError, setAddressError] = React.useState<LinkAddressProblem | null>(null);
  let canSave = address.trim() !== '' || canRemoveLink(form, text);
  let save = () => {
    if (!canSave) return;
    let error = linkAddressProblem(address, form.inEntry !== undefined);
    setAddressError(error);
    if (error === null) onSaved(text, address);
  };
  let onFieldKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation();
    if (event.key !== 'Enter' || isComposingKeyEvent(event)) return;
    event.preventDefault();
    save();
  };
  return <div className="flex flex-col gap-md"><FieldRoot><FieldLabel>{linkEditMessages.text()}</FieldLabel><TextInput value={typedText} onChange={(event) => setTypedText(event.target.value)} onKeyDown={onFieldKeyDown} autoComplete="off" /></FieldRoot><FieldRoot invalid={addressError !== null}><FieldLabel>{linkEditMessages.link()}</FieldLabel><TextInput ref={addressField} value={address} onChange={(event) => {
              setAddress(event.target.value);
              setAddressError(null);
            }} onKeyDown={onFieldKeyDown} placeholder={linkEditMessages.pasteALink()} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} />{addressError !== null &&
            <FieldError match><span role="alert">{addressError === 'tooLong' ? linkEditMessages.linkTooLong() : linkEditMessages.notALink()}</span></FieldError>}</FieldRoot><div className="flex justify-end gap-sm"><Button onClick={onShut}>{linkEditMessages.cancel()}</Button><Button variant="primary" disabled={!canSave} onClick={save}>{linkEditMessages.save()}</Button></div></div>;
}
export const editLinkLabel = sheetMessages.editLink;
export const LINK_FORM_ATTR = 'data-is-link-form';
export const LINK_POPUP_TAB_STOPS_SELECTOR = 'input,button:not(:disabled)';
export const isComposingKeyEvent = (event: React.KeyboardEvent): boolean => event.nativeEvent.isComposing || event.keyCode === 229;
export const LinkEditPopup = React.memo(function ({
  form,
  anchor,
  whatHasCaretAfter,
  onSaved,
  onShut,
}: LinkEditPopupProps) {
  let isOpen = form !== null;
  let [lastForm, setLastForm] = React.useState(form);
  if (form !== null && form !== lastForm) setLastForm(form);
  let bottomInset = useBottomInsetWhileOpen(isOpen, false);
  let [wasOpen, setWasOpen] = React.useState(false);
  let [isJustOpened, setJustOpened] = React.useState(false);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    setJustOpened(isOpen);
  }
  React.useEffect(() => {
    if (!isJustOpened) return;
    let timer = setTimeout(() => setJustOpened(false), PRESS_TOO_SOON_MS);
    return () => clearTimeout(timer);
  }, [isJustOpened]);
  let addressFieldRef = React.useRef<HTMLInputElement | null>(null);
  let hasFieldBeenFocusedRef = React.useRef(false);
  let initialFocus = React.useCallback(() => ((hasFieldBeenFocusedRef.current = false), addressFieldRef.current), []);
  let { isGivenUp, holdPopup, noteFocus } = usePopupGivenUpOnBlur(isOpen, onShut);
  let onFieldFocus = ({ target }: React.FocusEvent<HTMLDivElement>) => {
    noteFocus();
    if (!hasFieldBeenFocusedRef.current && target === addressFieldRef.current) addressFieldRef.current.select();
    hasFieldBeenFocusedRef.current = true;
  };
  let onPopupKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (isComposingKeyEvent(event)) return;
    let isEnterTooSoon = event.key === 'Enter' && (event.repeat || isJustOpened);
    if (event.key === 'Escape' || isEnterTooSoon) {
      event.preventDefault();
      event.stopPropagation();
      return isEnterTooSoon ? undefined : onShut();
    }
    if (
      (IS_APPLE_PLATFORM ? event.metaKey : isCommandHeld(event)) &&
      !event.shiftKey &&
      !event.altKey &&
      latinKeyOf(event, true).toLowerCase() === 'k'
    )
      event.preventDefault();
    if (event.key !== 'Tab' || event.ctrlKey || event.metaKey) return;
    let tabStops = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(LINK_POPUP_TAB_STOPS_SELECTOR));
    let focusedIndex = tabStops.findIndex((element) => element === element.ownerDocument.activeElement);
    let nextIndex = event.shiftKey ? Math.max(focusedIndex, 0) - 1 : focusedIndex + 1;
    event.preventDefault();
    event.stopPropagation();
    tabStops[(nextIndex + tabStops.length) % tabStops.length]?.focus();
  };
  return <Popover.Root open={isOpen && !isGivenUp} onOpenChange={(willOpen) => {
      if (!willOpen && !isJustOpened) onShut();
    }}>{isOpen &&
        isJustOpened &&
        <div role="presentation" className="fixed inset-0" onMouseDown={(event) => event.preventDefault()} onPointerDown={(event) => event.stopPropagation()} />}<Popover.Popup ref={holdPopup} {...{
          [LINK_FORM_ATTR]: true,
        }} anchor={anchor} side="top" align="start" sideOffset={8} collisionPadding={popupCollisionPadding(bottomInset)} aria-label={lastForm?.hasLink === true ? editLinkLabel() : linkEditMessages.insertLink()} initialFocus={initialFocus} finalFocus={whatHasCaretAfter} onFocus={onFieldFocus} onKeyDownCapture={onPopupKeyDown} onBlur={({ currentTarget, relatedTarget }) => {
          if (!isJustOpened && relatedTarget !== null && !currentTarget.contains(relatedTarget)) onShut();
        }} onMouseDownCapture={(event) => {
          if (isJustOpened) event.preventDefault();
        }} onClickCapture={(event) => {
          if (!isJustOpened) return;
          event.preventDefault();
          event.stopPropagation();
        }} className="w-90 max-w-[var(--available-width)]">{lastForm !== null &&
          <LinkEditForm key={`${lastForm.cellId.sheetId} ${lastForm.cellId.rowId} ${lastForm.cellId.columnId} ${lastForm.inEntry?.start} ${lastForm.inEntry?.end}`} form={lastForm} addressField={addressFieldRef} onSaved={onSaved} onShut={onShut} />}</Popover.Popup></Popover.Root>;
});
