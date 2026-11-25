/** The open suggestions a fold hides, gathered by heading, as the editor shown now has them. */
import { useMemo, useRef } from 'react';
import { foldKey } from '../editor/fold.ts';
import { useEditor } from '../editor/format.ts';
import { type FoldedGroup, foldedSuggestions, sameGroups } from './folded.ts';
import type { SuggestionCard } from './model.ts';

const NONE: readonly FoldedGroup[] = [];

/** The groups stay the same array while they gather the same suggestions, so what is laid out from them holds still. */
export function useFoldedSuggestions(cards: readonly SuggestionCard[]): readonly FoldedGroup[] {
  const doc = useEditor(hold => hold.state?.doc);
  const folds = useEditor(hold => (hold.state ? (foldKey.getState(hold.state) ?? null) : null));
  const groups = useMemo(() => {
    const state = useEditor.getState().state;
    return state && folds?.size ? foldedSuggestions(state, cards.map(card => card.id)) : NONE;
  }, [doc, folds, cards]);
  const kept = useRef(groups);
  if (!sameGroups(kept.current, groups)) kept.current = groups;
  return kept.current;
}
