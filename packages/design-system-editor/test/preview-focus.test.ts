import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PREVIEW_FOCUS_HOLD, holdFocusUntilUsed, type PreviewWindow } from '../src/lib/preview-focus.ts';

/** A preview frame with a log of what really happened. */
function preview(frameHasFocus = false) {
  const log: string[] = [];
  const listeners: { type: string; listener: (event: { isTrusted: boolean }) => void }[] = [];
  class Element {
    focus(): void {
      log.push('focused');
    }
  }
  class Dialog extends Element {
    open = false;
    showModal(): void {
      log.push('modal');
    }
    setAttribute(name: string): void {
      if (name === 'open') this.open = true;
    }
  }
  const frame: PreviewWindow = {
    document: { hasFocus: () => frameHasFocus },
    addEventListener: (type, listener) => listeners.push({ type, listener }),
    HTMLElement: Element,
    HTMLDialogElement: Dialog,
  };
  const press = (type: string, isTrusted = true) => listeners.filter((l) => l.type === type).forEach((l) => l.listener({ isTrusted }));
  return { log, frame, press, element: new Element(), dialog: new Dialog() };
}

describe('preview focus hold', () => {
  it('a preview cannot focus an element before anyone used it', () => {
    const { log, frame, element } = preview();
    holdFocusUntilUsed(frame);
    element.focus();
    assert.deepEqual(log, []);
  });

  it('a modal dialog opened before any use shows without taking focus', () => {
    const { log, frame, dialog } = preview();
    holdFocusUntilUsed(frame);
    dialog.showModal();
    assert.deepEqual(log, []);
    assert.equal(dialog.open, true);
  });

  for (const type of ['pointerdown', 'keydown']) {
    it(`a real ${type} in the preview lets it move focus and open modals`, () => {
      const { log, frame, press, element, dialog } = preview();
      holdFocusUntilUsed(frame);
      press(type, false);
      element.focus();
      press(type);
      element.focus();
      dialog.showModal();
      assert.deepEqual(log, ['focused', 'modal']);
    });
  }

  it('a preview that already has focus moves it freely', () => {
    const { log, frame, element } = preview(true);
    holdFocusUntilUsed(frame);
    element.focus();
    assert.deepEqual(log, ['focused']);
  });

  it('the injected script stands on its own', () => {
    const body = /^<script>\((.*)\)\(window\)<\/script>$/s.exec(PREVIEW_FOCUS_HOLD)?.[1];
    assert.ok(body);
    const { log, frame, element, press } = preview();
    new Function('window', `(${body})(window)`)(frame);
    element.focus();
    press('pointerdown');
    element.focus();
    assert.deepEqual(log, ['focused']);
  });
});
