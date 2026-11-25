/**
 * Component previews run their own scripts. Until someone presses a pointer
 * or a key inside a preview, it may not take focus away from the page: a
 * preview that focuses an input on load, or opens a modal dialog, would
 * otherwise pull the caret out of the field being edited.
 */

/** The parts of a preview frame's window the hold touches. */
export interface PreviewWindow {
  document: { hasFocus(): boolean };
  addEventListener(type: 'pointerdown' | 'keydown', listener: (event: { isTrusted: boolean }) => void, capture: boolean): void;
  HTMLElement: { prototype: { focus(options?: FocusOptions): void } };
  HTMLDialogElement?: { prototype: { showModal(): void; setAttribute(name: string, value: string): void } };
}

/**
 * Runs inside the preview frame, so it must not use anything outside its own
 * body: it is injected as `(${holdFocusUntilUsed})(window)`.
 */
export function holdFocusUntilUsed(frame: PreviewWindow): void {
  let used = false;
  const noteUse = (event: { isTrusted: boolean }): void => {
    if (event.isTrusted) used = true;
  };
  frame.addEventListener('pointerdown', noteUse, true);
  frame.addEventListener('keydown', noteUse, true);
  const mayTakeFocus = (): boolean => used || frame.document.hasFocus();

  const elements = frame.HTMLElement.prototype;
  const focusElement = elements.focus;
  elements.focus = function (this: object, options?: FocusOptions): void {
    if (mayTakeFocus()) focusElement.call(this, options);
  };

  const dialogs = frame.HTMLDialogElement?.prototype;
  if (!dialogs) return;
  const openModal = dialogs.showModal;
  dialogs.showModal = function (this: { setAttribute(name: string, value: string): void }): void {
    // Shown, but not modal: a modal dialog takes focus as it opens.
    if (mayTakeFocus()) openModal.call(this);
    else this.setAttribute('open', '');
  };
}

/** The `<script>` every preview gets before its own markup. */
export const PREVIEW_FOCUS_HOLD = `<script>(${holdFocusUntilUsed.toString()})(window)</script>`;
