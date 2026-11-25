/**
 * Where the text leaves no room for the cards and no margin is drawn: the looked-at suggestion's card floats at the foot of the page, and
 * with none looked at, a button that counts the open suggestions and goes to the first.
 */
import { ChromeButton } from '@open-artifact/editor-kit/react';
import { ListChecks } from 'lucide-react';
import type { ReactNode } from 'react';
import { setDocs, useDocs } from '../app/store.ts';
import { useMarginColumn } from '../margin/column.ts';
import { stepSuggestion } from './decide.ts';
import { useOpenSuggestions } from './model.ts';
import { useSuggest } from './store.ts';
import { focusCard, SuggestionCardView } from './SuggestionCard.tsx';

export function SuggestionFloat(): ReactNode {
  const tab = useOpenSuggestions(state => state.tab);
  const cards = useOpenSuggestions(state => state.cards);
  const focused = useDocs(state => state.focusedSuggestion);
  const hoveredText = useSuggest(state => state.hoveredText);
  const margin = useSuggest(state => state.margin);
  const column = useMarginColumn(state => state.mode !== 'off');
  if (margin || column || !tab || !cards.length) return null;
  const active = hoveredText ?? focused;
  const index = active ? cards.findIndex(card => card.id === active) : -1;
  const card = index >= 0 ? cards[index]! : null;
  return (
    <div className="pointer-events-none absolute bottom-4 right-4 z-30 flex w-[min(320px,calc(100%-2rem))] justify-end" data-suggest-float="">
      {card ? (
        <SuggestionCardView card={card} tab={tab} index={index} total={cards.length} selected floating className="w-full" onClose={() => setDocs({ focusedSuggestion: null })} />
      ) : (
        <ChromeButton
          aria-label={`Suggestions: ${cards.length} open`}
          className="pointer-events-auto bg-chrome shadow-chrome"
          size="lg"
          onClick={() => {
            const first = stepSuggestion(1);
            if (first) focusCard(first);
          }}
        >
          <ListChecks className="size-4" strokeWidth={1.75} />
          {cards.length === 1 ? '1 suggestion' : `${cards.length} suggestions`}
        </ChromeButton>
      )}
    </div>
  );
}
