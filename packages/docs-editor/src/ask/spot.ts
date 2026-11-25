/** Where the @ menu's Ask Agent was picked, followed through edits while its prompt is open. */
import { type EditorState, Plugin, PluginKey } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';

const spotKey = new PluginKey<number | null>('docAskSpot');

export function askSpotPlugin(): Plugin<number | null> {
  return new Plugin<number | null>({
    key: spotKey,
    state: {
      init: () => null,
      apply(tr, spot) {
        const meta = tr.getMeta(spotKey) as { pos: number | null } | undefined;
        if (meta) return meta.pos;
        return spot === null || !tr.docChanged ? spot : tr.mapping.map(spot);
      },
    },
  });
}

export const askSpotOf = (state: EditorState): number | null => spotKey.getState(state) ?? null;

export function setAskSpot(view: EditorView, pos: number | null): void {
  if (askSpotOf(view.state) === pos) return;
  view.dispatch(view.state.tr.setMeta(spotKey, { pos }).setMeta('addToHistory', false));
}
