/** The parts of a key press {@link endsMode} reads. */
export interface ModeKey {
  key: string;
  isComposing?: boolean;
  keyCode?: number;
}

/**
 * Whether a key press ends cropping or path drawing: Enter or Escape,
 * except when typed in a text field (the panel's own fields take them) or
 * while an input method is composing.
 */
export function endsMode(event: ModeKey, inTextField: boolean): boolean {
  if (event.key !== 'Enter' && event.key !== 'Escape') return false;
  if (event.isComposing || event.keyCode === 229) return false;
  return !inTextField;
}
