/** Keys of the properties panel's text fields. */

/** The parts of a key press {@link historyKeyOf} reads. */
export interface HistoryKey {
  key: string;
  /** Physical key, so non-Latin layouts work too. */
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** ⌘Z / Ctrl+Z undo; ⇧⌘Z and ⌘Y redo; anything else `null`. */
export function historyKeyOf(event: HistoryKey): 'undo' | 'redo' | null {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return null;
  const letter = event.code?.startsWith('Key') ? event.code.slice(3).toLowerCase() : event.key.toLowerCase();
  if (letter === 'z') return event.shiftKey ? 'redo' : 'undo';
  if (letter === 'y' && !event.shiftKey) return 'redo';
  return null;
}

/**
 * The number in a CSS length stepped by `delta`, keeping its unit. An empty
 * field steps from what it shows in grey (`placeholder`); a number field
 * (`numeric`, one with a unit) whose placeholder is no number steps from 0.
 * `null` when there is nothing to step.
 */
export function stepLength(text: string, placeholder: string, delta: number, numeric = false): string | null {
  const step = (from: string) => {
    const match = /^(-?\d*\.?\d+)([a-z%]*)$/i.exec(from.trim());
    return match ? `${Math.round((Number(match[1]) + delta) * 100) / 100}${match[2]}` : null;
  };
  if (text.trim()) return step(text);
  return step(placeholder) ?? (numeric ? step('0') : null);
}
