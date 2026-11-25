/**
 * While a margin is drawn, the suggestion cards are in it, stacked with the others there or behind its markers; those a
 * folded heading hides are one card at that heading.
 */
import { type ReactNode, useEffect, useMemo } from 'react';
import { setDocs, useDocs } from '../app/store.ts';
import { headingPos } from '../editor/fold.ts';
import { currentView } from '../editor/format.ts';
import { type ColumnCard, feedColumn, unfeedColumn, useMarginColumn } from '../margin/column.ts';
import { type FoldedGroup, foldedGroupId, shownWords } from './folded.ts';
import { FoldedSuggestionsCard, revealFolded } from './FoldedSuggestionsCard.tsx';
import { useOpenSuggestions } from './model.ts';
import { SuggestionCardView } from './SuggestionCard.tsx';
import { useStackFocus } from './SuggestionMargin.tsx';
import { useFoldedSuggestions } from './use-folded.ts';

const FEED = 'suggestions';

export function SuggestionColumnFeed(): ReactNode {
  const drawn = useMarginColumn(state => state.mode !== 'off');
  return drawn ? <Feed /> : null;
}

function Feed(): null {
  const tab = useOpenSuggestions(state => state.tab);
  const cards = useOpenSuggestions(state => state.cards);
  const icons = useMarginColumn(state => state.mode === 'icons');
  const stacked = useStackFocus();
  const focused = useDocs(state => state.focusedSuggestion);
  // Behind markers a card opens when it is chosen, not while its words are under the pointer.
  const focus = icons ? focused : stacked;

  const folded = useFoldedSuggestions(cards);

  const fed = useMemo<ColumnCard[]>(() => {
    if (!tab) return [];
    const hidden = new Set(folded.flatMap(group => group.ids));
    const shown = cards.flatMap((card, index): ColumnCard[] =>
      hidden.has(card.id)
        ? []
        : [
            {
              id: card.id,
              anchor(page) {
                const text = page.querySelector('.ProseMirror');
                const words = text && shownWords(text, card.id);
                return words ? words.getBoundingClientRect().top - page.getBoundingClientRect().top + page.scrollTop : null;
              },
              render: open => <SuggestionCardView card={card} tab={tab} index={index} total={cards.length} selected={open} />,
              select: open => setDocs({ focusedSuggestion: open ? card.id : null }),
            },
          ],
    );
    return [...shown, ...folded.map(foldedCard)];
  }, [tab, cards, folded]);

  useEffect(() => feedColumn(FEED, fed, focus && fed.some(card => card.id === focus) ? focus : null), [fed, focus]);
  useEffect(() => () => unfeedColumn(FEED), []);
  return null;
}

/** A folded section's suggestions, as one card level with its heading. */
function foldedCard(group: FoldedGroup): ColumnCard {
  return {
    id: foldedGroupId(group.heading),
    count: group.ids.length,
    anchor(page) {
      const view = currentView();
      const at = view ? headingPos(view.state.doc, group.heading) : null;
      const heading = view && at !== null ? view.nodeDOM(at) : null;
      return heading instanceof HTMLElement ? heading.getBoundingClientRect().top - page.getBoundingClientRect().top + page.scrollTop : null;
    },
    render: () => <FoldedSuggestionsCard group={group} />,
    select: open => {
      if (open) revealFolded(group);
    },
  };
}
