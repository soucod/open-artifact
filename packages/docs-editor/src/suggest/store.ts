/** The suggestions feature's own state: what the pointer is over, the last decision (for undo), the notice. */
import { create } from 'zustand';

export type Verdict = 'accept' | 'reject' | 'withdraw';

/** A decision the page made, kept so Undo (or the undo keys right after it) can take it back. */
export interface LastDecision {
  tab: string;
  ids: string[];
  verdict: Verdict;
  /** The editor's count of the person's own edits when it was made: the undo keys take it back while that holds. */
  editSerial: number;
}

/** A short line over the page after a decision, with Undo while it can be taken back. */
export interface DecisionNotice {
  text: string;
  undo: boolean;
  /** Bumped per notice, so the same words show (and time out) again. */
  serial: number;
}

export interface SuggestState {
  /** The suggestion whose words the pointer is over. */
  hoveredText: string | null;
  /** The suggestion whose card the pointer is over. */
  hoveredCard: string | null;
  last: LastDecision | null;
  /** A decision or undo is on its way. */
  busy: boolean;
  notice: DecisionNotice | null;
  /** The cards fit beside the text; otherwise the looked-at one floats over the page. */
  margin: boolean;
}

export const useSuggest = create<SuggestState>(() => ({
  hoveredText: null,
  hoveredCard: null,
  last: null,
  busy: false,
  notice: null,
  margin: true,
}));

export const setSuggest = useSuggest.setState;
export const getSuggest = useSuggest.getState;

export function showNotice(text: string, undo = false): void {
  setSuggest(state => ({ notice: { text, undo, serial: (state.notice?.serial ?? 0) + 1 } }));
}
