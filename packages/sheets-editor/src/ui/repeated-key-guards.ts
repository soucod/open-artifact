import type * as React from 'react';
/** The parts of a key press that tell whether it is a held key repeating. */
export type RepeatableKeyPress = Pick<KeyboardEvent, 'key' | 'repeat'>;
export function blockRepeatedEnterOrSpace(event: React.KeyboardEvent) {
  if (!isRepeatedEnterOrSpace(event)) return;
  event.preventDefault();
  event.stopPropagation();
}
export function blockRepeatedTyping(event: React.KeyboardEvent) {
  if (!event.repeat || event.key.length > 1) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  event.preventDefault();
  event.stopPropagation();
}
export const isRepeatedEnterOrSpace = ({ key, repeat }: RepeatableKeyPress) => repeat && (key === 'Enter' || key === ' ');
