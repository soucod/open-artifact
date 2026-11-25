/**
 * The suggestion cards right of the text, each level with its words and pushed down so none overlap; the looked-at
 * one (caret, pointer or card) sits level with its words; those a folded heading hides are one card at that heading.
 * With a margin column drawn, the cards join it instead (SuggestionColumnFeed); where there is neither, the looked-at
 * card floats over the page (SuggestionFloat).
 */
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useDocs } from '../app/store.ts';
import { headingPos } from '../editor/fold.ts';
import { useEditor } from '../editor/format.ts';
import { useMarginColumn } from '../margin/column.ts';
import { stackCards } from '../margin/stack.ts';
import { type FoldedGroup, foldedGroupId, shownWords } from './folded.ts';
import { FoldedSuggestionsCard } from './FoldedSuggestionsCard.tsx';
import { CARD_OFFSET, CARD_WIDTH, marginFits } from './layout.ts';
import { useOpenSuggestions } from './model.ts';
import { setSuggest, useSuggest } from './store.ts';
import { SuggestionCardView } from './SuggestionCard.tsx';
import { useFoldedSuggestions } from './use-folded.ts';

interface Measured {
  left: number;
  anchors: Map<string, number>;
}

const sameAnchors = (a: Map<string, number>, b: Map<string, number>) => a.size === b.size && [...a].every(([id, top]) => Math.round(b.get(id) ?? NaN) === Math.round(top));

/** The tallest a card is taken to be before it has been measured. */
const GUESS_HEIGHT = 84;

/**
 * The suggestion the stack is laid out around: the words under the pointer, else the looked-at one. While the pointer
 * is on a card it holds still, so the card stays under the pointer.
 */
export function useStackFocus(): string | null {
  const focused = useDocs(state => state.focusedSuggestion);
  const hoveredText = useSuggest(state => state.hoveredText);
  const hoveredCard = useSuggest(state => state.hoveredCard);
  const held = useRef<{ active: string | null; focused: string | null }>({ active: null, focused: null });
  if (!hoveredCard || focused !== held.current.focused) held.current = { active: hoveredCard ? focused : (hoveredText ?? focused), focused };
  return held.current.active;
}

export function SuggestionMargin(): ReactNode {
  const column = useMarginColumn(state => state.mode !== 'off');
  return column ? null : <BesideText />;
}

function BesideText(): ReactNode {
  const view = useEditor(state => state.view);
  const doc = useEditor(state => state.state?.doc);
  const tab = useOpenSuggestions(state => state.tab);
  const cards = useOpenSuggestions(state => state.cards);
  const fits = useSuggest(state => state.margin);
  const [measured, setMeasured] = useState<Measured | null>(null);
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(new Map());
  const observed = useRef(new Map<string, HTMLElement>());
  const folded = useFoldedSuggestions(cards);
  const foldedNow = useRef(folded);
  foldedNow.current = folded;

  const measure = useCallback(() => {
    const page = view?.dom.closest('.doc-page');
    const scroller = view?.dom.closest('[data-doc-scroll]');
    if (!view || !page || !scroller) return;
    const pageBox = page.getBoundingClientRect();
    const textBox = view.dom.getBoundingClientRect();
    const room = marginFits(textBox.right, scroller.getBoundingClientRect().right);
    if (room !== useSuggest.getState().margin) setSuggest({ margin: room });
    const anchors = new Map<string, number>();
    const hidden = new Set(foldedNow.current.flatMap(group => group.ids));
    for (const card of useOpenSuggestions.getState().cards) {
      if (hidden.has(card.id)) continue;
      const element = shownWords(view.dom, card.id);
      if (element) anchors.set(card.id, element.getBoundingClientRect().top - pageBox.top);
    }
    for (const group of foldedNow.current) {
      const at = headingPos(view.state.doc, group.heading);
      const heading = at === null ? null : view.nodeDOM(at);
      if (heading instanceof HTMLElement) anchors.set(foldedGroupId(group.heading), heading.getBoundingClientRect().top - pageBox.top);
    }
    const left = textBox.right - pageBox.left + CARD_OFFSET;
    setMeasured(before => (before && Math.round(before.left) === Math.round(left) && sameAnchors(before.anchors, anchors) ? before : { left, anchors }));
  }, [view]);

  useLayoutEffect(measure, [measure, doc, cards, folded]);

  useEffect(() => {
    if (!view) return undefined;
    let frame = 0;
    const later = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          measure();
        });
    };
    window.addEventListener('resize', later);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(later);
    observer?.observe(view.dom);
    const scroller = view.dom.closest('[data-doc-scroll]');
    if (scroller) observer?.observe(scroller);
    // Pictures and fonts load late and move the words.
    const loaded = (event: Event) => {
      if (event.target instanceof HTMLImageElement) later();
    };
    view.dom.addEventListener('load', loaded, true);
    void document.fonts?.ready.then(later);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', later);
      view.dom.removeEventListener('load', loaded, true);
      observer?.disconnect();
    };
  }, [view, measure]);

  // Each card's height, for the stacking.
  const sizes = useMemo(
    () =>
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(entries => {
            setHeights(before => {
              let next: Map<string, number> | null = null;
              for (const entry of entries) {
                const id = [...observed.current].find(([, element]) => element === entry.target)?.[0];
                const height = (entry.target as HTMLElement).offsetHeight;
                if (!id || before.get(id) === height) continue;
                next ??= new Map(before);
                next.set(id, height);
              }
              return next ?? before;
            });
          }),
    [],
  );
  useEffect(() => () => sizes?.disconnect(), [sizes]);
  const refs = useRef(new Map<string, (element: HTMLElement | null) => void>());
  const track = (id: string) => {
    let ref = refs.current.get(id);
    if (!ref) {
      ref = (element: HTMLElement | null) => {
        const before = observed.current.get(id);
        if (before === element) return;
        if (before) sizes?.unobserve(before);
        if (element) {
          observed.current.set(id, element);
          sizes?.observe(element);
        } else {
          observed.current.delete(id);
          refs.current.delete(id);
        }
      };
      refs.current.set(id, ref);
    }
    return ref;
  };

  const active = useStackFocus();
  const placed = useMemo(() => {
    if (!measured) return { cards: [], groups: [] };
    const sized = (id: string) => {
      const top = measured.anchors.get(id);
      return top === undefined ? [] : [{ id, top, height: heights.get(id) ?? GUESS_HEIGHT }];
    };
    const items = [...cards.flatMap(card => sized(card.id)), ...folded.flatMap(group => sized(foldedGroupId(group.heading)))];
    const tops = stackCards(items, active && measured.anchors.has(active) ? active : null);
    return {
      cards: cards.flatMap((card, index) => {
        const top = tops.get(card.id);
        return top === undefined ? [] : [{ card, index, top }];
      }),
      groups: folded.flatMap((group): Array<{ group: FoldedGroup; id: string; top: number }> => {
        const id = foldedGroupId(group.heading);
        const top = tops.get(id);
        return top === undefined ? [] : [{ group, id, top }];
      }),
    };
  }, [cards, folded, measured, heights, active]);

  if (!tab || !fits || !measured || !(placed.cards.length || placed.groups.length)) return null;
  const at = (top: number) => ({ left: measured.left, top, width: CARD_WIDTH, transition: 'top 150ms ease-out' });
  return (
    <div className="pointer-events-none absolute inset-0 z-20" data-suggest-margin="">
      {placed.cards.map(({ card, index, top }) => (
        <SuggestionCardView
          key={card.id}
          ref={track(card.id)}
          card={card}
          tab={tab}
          index={index}
          total={cards.length}
          selected={card.id === active}
          className="absolute"
          style={at(top)}
        />
      ))}
      {placed.groups.map(({ group, id, top }) => (
        <FoldedSuggestionsCard key={id} ref={track(id)} group={group} className="absolute" style={at(top)} />
      ))}
    </div>
  );
}
