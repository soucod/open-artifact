/** Asking the agent from the text: Ask Agent in the @ menu, and the box under an empty doc. */
import { fillSlot } from '../app/slots.ts';
import { useDocs } from '../app/store.ts';
import { useCommentUi } from '../comments/store.ts';
import { addEditorExtension } from '../editor/DocEditor.tsx';
import { useEditor } from '../editor/format.ts';
import { useSuggestMode } from '../suggest/mode.ts';
import { AskCard, EmptyDocAsk } from './AskCard.tsx';
import { canAskInText, closeAsk } from './actions.ts';
import { askSpotPlugin } from './spot.ts';
import { getAsk } from './store.ts';

addEditorExtension({ plugins: () => [askSpotPlugin()] });
fillSlot('layer', 'ask-card', AskCard);
fillSlot('float', 'ask-dock', EmptyDocAsk, 15);

const closeIfGone = () => {
  const { prompt, sending } = getAsk();
  if (!prompt || sending === 'caret') return;
  if (prompt.tab !== useEditor.getState().tab || !canAskInText()) closeAsk(false);
};
useEditor.subscribe((state, before) => {
  if (state.tab !== before.tab) closeIfGone();
});
useDocs.subscribe(closeIfGone);
useCommentUi.subscribe((state, before) => {
  if (state.agent !== before.agent) closeIfGone();
});
useSuggestMode.subscribe(closeIfGone);
