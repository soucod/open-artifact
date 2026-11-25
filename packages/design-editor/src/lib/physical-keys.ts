/**
 * Shortcuts read from the physical key, so they work on any keyboard layout
 * (Shift+1 types `!` on a US layout, `+` on a Swiss one, and a Russian
 * layout puts `с` where C is).
 */

/** What a key press asks of the view, by position on the keyboard. */
export type ZoomKey = 'fit' | 'actual' | 'selection';

interface Press {
  key: string;
  code?: string;
  meta: boolean;
  shift: boolean;
  alt: boolean;
}

/** Shift+1 fits the page, Shift+0 is 100%, Shift+2 fits the selection. */
export function zoomKeyOf({ key, code, meta, shift, alt }: Press): ZoomKey | null {
  if (meta || alt) return null;
  if (code?.startsWith('Digit')) {
    if (!shift) return null;
    return code === 'Digit1' ? 'fit' : code === 'Digit0' ? 'actual' : code === 'Digit2' ? 'selection' : null;
  }
  return key === '!' ? 'fit' : key === ')' ? 'actual' : key === '@' ? 'selection' : null;
}

/** Shift+Cmd+C (Shift+Ctrl+C): copy the selection as a PNG image. */
export function isCopyPngKey({ key, code, meta, shift, alt }: Press): boolean {
  if (!meta || !shift || alt) return false;
  return code ? code === 'KeyC' : key.toLowerCase() === 'c';
}
