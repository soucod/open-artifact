import type { ShownByAgentAsk } from '../state/event-reducer.ts';

export interface ViewShownByAgentFeed {
  start(listener: (shown: ShownByAgentAsk | null) => void): () => void;
}

export const NO_VIEW_SHOWN_BY_AGENT: ViewShownByAgentFeed = {
  start: () => () => {},
};
