/** Find and replace: ⌘F / ⇧⌘H from anywhere on the page, the bar in the `float` slot, highlights in the text. */
import { provideAction } from '../app/actions.ts';
import { fillSlot } from '../app/slots.ts';
import { addEditorExtension } from '../editor/DocEditor.tsx';
import { chipWordsOnPage, openFind, watchFind } from './controller.ts';
import { FindBar } from './FindBar.tsx';
import { findChord, inPopup } from './keys.ts';
import { findPlugin } from './plugin.ts';

addEditorExtension({ plugins: () => [findPlugin(chipWordsOnPage)] });
provideAction('find', mode => openFind(mode));
fillSlot('float', 'find', FindBar);
watchFind();

// The editor's own keys answer while the text has the keyboard; this covers the rest of the page.
window.addEventListener('keydown', event => {
  if (event.defaultPrevented || inPopup(event.target)) return;
  const chord = findChord(event);
  if (!chord) return;
  event.preventDefault();
  openFind(chord);
});
