/** The last key pressed, and whether it may be the one that pastes. */
interface KeyThatMayPaste {
  wentDownAt: number;
  isWithoutFormatting: boolean;
  mayPaste: boolean;
  isHeldDown: boolean;
}

/** Tells whether a paste that comes now was asked for by a key, held down, or without formatting. */
export interface PasteKeyTracker {
  isWithoutFormatting: () => boolean;
  isHeldDown: () => boolean;
  isByKey: () => boolean;
  stop(): void;
}

export function createPasteKeyTracker(target: Window, now: () => number = () => performance.now()): PasteKeyTracker {
  let lastKey: KeyThatMayPaste | null = null;
  let onKeyDown = ({ key, shiftKey, ctrlKey, metaKey, repeat }: KeyboardEvent) => {
    let isModifiedCharacter = key.length === String.fromCodePoint(key.codePointAt(0) ?? 0).length && (ctrlKey || metaKey);
    let mayPaste = isModifiedCharacter || key === 'Insert' || key === 'Paste';
    lastKey = {
      wentDownAt: now(),
      isWithoutFormatting: isModifiedCharacter && shiftKey,
      mayPaste,
      isHeldDown: repeat && mayPaste,
    };
  };
  let forgetKey = () => {
    lastKey = null;
  };
  let recentKey = () => (lastKey !== null && now() - lastKey.wentDownAt < 1000 ? lastKey : null);
  target.addEventListener('keydown', onKeyDown, true);
  target.addEventListener('pointerdown', forgetKey, true);
  target.addEventListener('blur', forgetKey);
  return {
    isWithoutFormatting: () => recentKey()?.isWithoutFormatting === true,
    isHeldDown: () => recentKey()?.isHeldDown === true,
    isByKey: () => recentKey()?.mayPaste === true,
    stop() {
      target.removeEventListener('keydown', onKeyDown, true);
      target.removeEventListener('pointerdown', forgetKey, true);
      target.removeEventListener('blur', forgetKey);
    },
  };
}
