/** Opening and closing the ask prompts, and sending an ask: the agent chip in the text, the `@agent` comment on it. */
import { toast } from '@open-artifact/ui';
import { TextSelection } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { docClient } from '../app/doc-client.ts';
import { getDocs, setDocs } from '../app/store.ts';
import { blockIdAt, idsOfRange } from '../comments/anchor-map.ts';
import { createThread } from '../comments/actions.ts';
import { type Composer, agentName, canAskAgent, canComment } from '../comments/store.ts';
import { currentView, useEditor } from '../editor/format.ts';
import { suggestingNow } from '../suggest/mode.ts';
import { type AskEntry, agentChip, askOnChip, chipInsertion, chipThread, emptyDocSpot, lineWords, offersAsk } from './ask.ts';
import { askSpotOf, setAskSpot } from './spot.ts';
import { getAsk, setAsk, setDraft } from './store.ts';

/** How long a send waits for the chip to reach the server before posting the comment anyway. */
const SETTLE_MS = 3_000;

export const canAskInText = (): boolean =>
  offersAsk({ agentListening: canAskAgent(), mayComment: canComment(), writable: getDocs().writable, suggesting: suggestingNow() });

/** Opens the prompt at `pos`, where the @ was typed. */
export function openAsk(view: EditorView, pos: number): void {
  const tab = useEditor.getState().tab;
  if (!tab || !canAskInText() || getAsk().sending) return;
  setAskSpot(view, pos);
  setDraft('caret', '');
  setAsk({ prompt: { tab } });
}

/** Closes the @ menu's prompt; no chip has gone in yet, so nothing is left in the text. */
export function closeAsk(refocus = true): void {
  if (!getAsk().prompt) return;
  const view = currentView();
  const spot = view ? askSpotOf(view.state) : null;
  setAsk({ prompt: null });
  setDraft('caret', '');
  if (!view) return;
  setAskSpot(view, null);
  if (!refocus) return;
  if (spot !== null) view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(spot))));
  view.focus();
}

interface Placed {
  tab: string;
  chip: string;
  composer: Composer;
}

/** Puts the agent chip in for `entry` and names the comment's anchor; null where it can't go. */
function putChip(view: EditorView, tab: string, entry: AskEntry): Placed | null {
  const open = docClient().openTabOf(tab);
  if (!open) return null;
  const name = agentName();
  const spot = entry === 'caret' ? askSpotOf(view.state) : emptyDocSpot(view.state.doc);
  if (spot === null) return null;
  const { pos, newLine } = typeof spot === 'number' ? { pos: spot, newLine: false } : spot;
  const inserted = chipInsertion(view.state, agentChip(name), pos, newLine);
  if (!inserted) return null;
  view.dispatch(inserted.tr.scrollIntoView());
  const ids = idsOfRange(view.state.doc, open.binding.shadow, inserted.at, inserted.at + 1);
  if (!ids) {
    view.dispatch(view.state.tr.delete(inserted.at, inserted.at + 1).setMeta('addToHistory', false));
    return null;
  }
  const block = view.state.doc.resolve(inserted.at).parent;
  const thread = chipThread({ tab, chip: ids[0], block: blockIdAt(view.state.doc, inserted.at), name, line: lineWords(block) });
  return { tab, chip: ids[0], composer: { ...thread, text: '' } };
}

/** Takes the chip out again, wherever it is now. */
function takeChip({ tab, chip }: Placed): void {
  try {
    docClient()
      .openTabOf(tab)
      ?.sync.write([{ op: 'delete', target: { kind: 'chars', range: [chip, chip] } }]);
  } catch {
    // Already gone.
  }
}

async function postOn(placed: Placed, text: string): Promise<boolean> {
  await Promise.race([docClient().settled(), new Promise(done => setTimeout(done, SETTLE_MS))]);
  return createThread(text, placed.composer, true);
}

export async function sendAsk(entry: AskEntry): Promise<void> {
  const text = getAsk().drafts[entry].trim();
  const view = currentView();
  const tab = useEditor.getState().tab;
  if (!text || !view || !tab || getAsk().sending || !canAskInText()) return;
  setAsk({ sending: entry });
  const outcome = await askOnChip<Placed>({ put: () => putChip(view, tab, entry), post: placed => postOn(placed, text), take: takeChip }).finally(() =>
    setAsk({ sending: null }),
  );
  if (outcome === 'no_place') {
    toast.add({ title: 'The agent can’t be asked from here', description: 'Put the caret in a paragraph, heading or list item.' });
    return;
  }
  if (outcome === 'refused') return;
  if (getDocs().comments === 'hidden') setDocs({ comments: 'margin' });
  setDraft(entry, '');
  if (entry === 'caret') {
    setAsk({ prompt: null });
    setAskSpot(view, null);
  }
  view.focus();
}
