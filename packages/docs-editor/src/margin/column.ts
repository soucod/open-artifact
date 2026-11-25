/**
 * The margin beside the page, when one is drawn: the comments' column, which other features' cards join so all of them
 * stack together, or, where the page leaves no room for it, a gutter of markers that open one card at a time. A feature
 * feeds its cards while the margin is drawn and places them itself otherwise.
 */
import type { ReactNode } from 'react';
import { create } from 'zustand';

/** A card another feature puts in the column. */
export interface ColumnCard {
  /** Unique across every feature's cards. */
  id: string;
  /** The top of its words in the scrolling page's coordinates, or null while they are not drawn. */
  anchor(page: HTMLElement): number | null;
  render(open: boolean): ReactNode;
  /** Opens the card (`true`) or closes it, from a marker in the gutter. */
  select(open: boolean): void;
  /** How many suggestions it stands for, in its marker's count: 1 unless it gathers several. */
  count?: number;
}

export interface ColumnFeed {
  cards: readonly ColumnCard[];
  /** The card its feature wants level with its words. */
  focus: string | null;
  /** When `focus` last became a card, so the newest wish wins between features. */
  focusedAt: number;
}

/** `cards`: every card beside its words; `icons`: markers beside the lines, one card open at a time. */
export type ColumnMode = 'off' | 'cards' | 'icons';

interface MarginColumnState {
  mode: ColumnMode;
  feeds: Readonly<Record<string, ColumnFeed>>;
}

export const useMarginColumn = create<MarginColumnState>(() => ({ mode: 'off', feeds: {} }));

export function setColumnMode(mode: ColumnMode): void {
  if (useMarginColumn.getState().mode !== mode) useMarginColumn.setState({ mode });
}

/** Puts `key`'s cards in the column, in place of the ones it fed before. */
export function feedColumn(key: string, cards: readonly ColumnCard[], focus: string | null): void {
  useMarginColumn.setState(state => {
    const before = state.feeds[key];
    const focusedAt = focus && focus !== before?.focus ? Date.now() : (before?.focusedAt ?? 0);
    return { feeds: { ...state.feeds, [key]: { cards, focus, focusedAt } } };
  });
}

export function unfeedColumn(key: string): void {
  useMarginColumn.setState(state => {
    if (!(key in state.feeds)) return state;
    const { [key]: _gone, ...rest } = state.feeds;
    return { feeds: rest };
  });
}

/** Of the wishes `[id, since]`, the newest whose card is in the column. */
export function newestFocus(wishes: ReadonlyArray<readonly [string | null, number]>, present: (id: string) => boolean): string | null {
  let best: string | null = null;
  let at = -Infinity;
  for (const [id, since] of wishes) {
    if (id && present(id) && since > at) {
      best = id;
      at = since;
    }
  }
  return best;
}
