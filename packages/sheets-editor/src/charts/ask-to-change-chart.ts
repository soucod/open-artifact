import type { AskSentToChat, ChartChangeOutcome } from '../messages/charts.ts';
import type { ChartChangeByAgent, ChartPreviewMade, WhyNoChartCodeFromAgent } from './agent-edits.ts';
import type { WhyNoChart } from './chart-words.ts';
/** A change of a chart that has a preview: the node it changes, and the node that shows the change. */
interface PreviewedChange extends ChartPreviewMade {
  from: string;
}
/** A change of a chart asked of the agent (or made by a swap of kinds), from asked to kept. */
export type ChartChange =
  | { stands: 'asked'; from: string }
  | { stands: 'givenUp' }
  | (PreviewedChange & { stands: 'made' })
  | (PreviewedChange & { stands: 'waits' })
  | (PreviewedChange & { stands: 'kept'; isAnswered: boolean });
export type AskedChartChange = Extract<ChartChange, { stands: 'asked' }>;
export type KeptChartChange = Extract<ChartChange, { stands: 'kept' }>;
/** Why the agent did not change a chart. */
export type WhyChartNotChanged = Exclude<WhyNoChartCodeFromAgent, 'stopped'>;
/** How drawing a chart came out. */
export type ChartCameOut = 'drawn' | 'failed';
/** Where a change of a chart stands, as the menu shows it. */
export type ChartChangeStage = 'waits' | 'agentWrites';
/** What was typed into a chart's ask box, and what came of asking. */
export interface ChartAsk {
  words: string;
  isOnItsWay: boolean;
  became: AskSentToChat | null;
  change?: ChartChange | null;
  /** Previews no longer wanted, to be discarded. */
  toDiscard?: string[];
  whyNotChanged?: WhyChartNotChanged | null;
  asked?: string;
  wasAskedByRow?: boolean;
  previewsLetGo?: number;
}
/** A key pressed in a chart's ask box: when, and whether Enter was held back. */
export interface KeyInAskBox {
  atMs: number;
  wasHeld: boolean;
}
/** Where a fault of a chart ask is shown: whether a chat with the agent can be had, and whether a menu row asked. */
export interface ChartAskFaultPlace {
  isChatToBeHad: boolean;
  wasByRow: boolean;
}
export function chartAskFaultShown<Why extends WhyNoChart>(why: Why, place: ChartAskFaultPlace): Why | 'notHere' | 'forChat' {
  if (why !== 'forChat' && why !== 'noAgent') return why;
  if (!place.isChatToBeHad) return why === 'forChat' ? 'notHere' : why;
  return place.wasByRow ? 'notHere' : 'forChat';
}
export function dropChartChange(ask: ChartAsk): Partial<ChartAsk> {
  const { change = null } = ask;
  if (change?.stands === 'asked')
    return {
      change: {
        stands: 'givenUp',
      },
    };
  if (change?.stands !== 'made' && change?.stands !== 'waits') return {};
  return {
    change: null,
    ...withPreviewToDiscard(ask, change.preview),
  };
}
export function chartChangeAnswered(ask: ChartAsk, asked: AskedChartChange, outcome: ChartChangeByAgent): Partial<ChartAsk> {
  if (ask.change !== asked) return typeof outcome === 'object' ? withPreviewToDiscard(ask, outcome.preview) : {};
  if (typeof outcome === 'object')
    return {
      change: {
        stands: 'made',
        from: asked.from,
        ...outcome,
      },
    };
  return {
    change: null,
    whyNotChanged: outcome === 'stopped' ? null : outcome,
  };
}
export function chartChangeDrawn(ask: ChartAsk, cameOut: ChartCameOut): Partial<ChartAsk> {
  const { change = null } = ask;
  if (change?.stands !== 'made' && change?.stands !== 'waits') return {};
  if (cameOut === 'drawn')
    return change.stands === 'waits'
      ? {}
      : {
          change: {
            ...change,
            stands: 'waits',
          },
        };
  return {
    change: null,
    whyNotChanged: 'notChanged',
    ...withPreviewToDiscard(ask, change.preview),
  };
}
export function chartChangeKeptChecked(ask: ChartAsk, kept: KeptChartChange, pointed: ChartChangeOutcome): Partial<ChartAsk> {
  const discarded = pointed === 'notPointed' || pointed === 'showsAnother' ? withPreviewToDiscard(ask, kept.preview) : {};
  if (ask.change !== kept) return discarded;
  return typeof pointed === 'object'
    ? {
        change: {
          ...kept,
          isAnswered: true,
        },
      }
    : {
        change: null,
        ...discarded,
      };
}
export function chartChangeStage(change: ChartChange | null): ChartChangeStage | null {
  if (change?.stands === 'waits') return 'waits';
  return change?.stands === 'asked' || change?.stands === 'made' ? 'agentWrites' : null;
}
export const shouldAskInChatInstead = (why: WhyNoChart | null, isChatToBeHad: boolean): boolean =>
  isChatToBeHad && why !== null && why !== 'notChanged' && why !== 'noCells' && why !== 'filterCutsTable';
export const withPreviewToDiscard = ({ toDiscard = [] }: Pick<ChartAsk, 'toDiscard'>, preview: string) => ({
  toDiscard: [...toDiscard, preview],
});
export const letGoOfChartChange = (ask: ChartAsk): Partial<ChartAsk> => ({
  ...dropChartChange(ask),
  ...(ask.change?.stands === 'waits' && {
    words: '',
    previewsLetGo: (ask.previewsLetGo ?? 0) + 1,
  }),
});
export const chartChangeAsked = (ask: ChartAsk, asked: AskedChartChange, askWords: string): Partial<ChartAsk> => ({
  ...dropChartChange(ask),
  change: asked,
  whyNotChanged: null,
  asked: askWords,
});
export const chartChangeKept = (ask: ChartAsk, change: ChartChange | null): Partial<ChartAsk> =>
  change?.stands === 'waits' && ask.change === change
    ? {
        change: {
          ...change,
          stands: 'kept',
          isAnswered: false,
        },
      }
    : {};
export const isKeptChartChangeOutdated = (change: ChartChange | null, nodeIdNow: string): boolean =>
  change?.stands === 'kept' && change.isAnswered && nodeIdNow !== change.from;
export const ENTER_HELD_AFTER_ACT_MS = 300;
/** An Enter pressed in a chart's ask box, and what came just before it. */
export interface EnterInAskBox {
  isChartInView: boolean;
  pressedAtMs: number;
  lastBlurOfWindowAtMs: number;
  lastAct: KeyInAskBox;
}
export const shouldHoldEnterOnChange = (enter: EnterInAskBox): boolean =>
  !enter.isChartInView ||
  enter.lastBlurOfWindowAtMs > enter.lastAct.atMs ||
  (enter.lastAct.wasHeld && enter.pressedAtMs - enter.lastAct.atMs < ENTER_HELD_AFTER_ACT_MS);
export const isShownChartNodeSettled = (nodeId: string, chartNodeId: string, change: ChartChange | null): boolean =>
  nodeId === shownChartNode(chartNodeId, change) && (nodeId === chartNodeId || change?.stands === 'kept');
export const shownChartNode = (chartNodeId: string, change: ChartChange | null): string =>
  change?.stands === 'waits' || change?.stands === 'kept' ? change.preview : chartNodeId;
export const chartNodesToDraw = (chartNodeId: string, change: ChartChange | null): string[] =>
  change !== null && 'preview' in change && change.preview !== chartNodeId ? [chartNodeId, change.preview] : [chartNodeId];
