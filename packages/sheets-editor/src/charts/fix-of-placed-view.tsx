import { AgentMark } from '../kit/agent-mark.tsx';
import { Button } from '../kit/button.tsx';
import * as React from 'react';
import type { PaneRect } from '../grid/geometry.ts';
import { usePressGuard } from '../ui/ask-agent-to-fix-button.tsx';
import { askSentToChatWords, chartMessages, type AskSentToChat } from '../messages/charts.ts';
import { LiveAnnouncer } from '../ui/live-announcer.tsx';
/** Asks the agent in the chat to fix a chart, in the words given. */
export type AskAgentToFixChart = (words: string) => Promise<AskSentToChat>;
/** What a placed view gives the notices inside it that may offer a fix. */
export interface PlacedViewFix {
  /** Told when a notice comes, and whether it offers to ask the agent for a fix. */
  noticeCame: (hasFixButton: boolean) => void;
  ask: AskAgentToFixChart | null;
  giveChartCaret: () => void;
}
export function PlacedViewFixOffer(words: string | null) {
  let { noticeCame, ask, giveChartCaret } = React.use(PlacedViewFixContext);
  let hasWords = words !== null;
  let canAsk = hasWords && ask !== null;
  React.useEffect(() => {
    if (hasWords) noticeCame(canAsk);
  }, [hasWords, canAsk, noticeCame]);
  if (words === null || ask === null) return null;
  return <AskAgentToFixView key={words} words={words} ask={ask} giveChartCaret={giveChartCaret} />;
}
interface AskAgentToFixViewProps {
  words: string;
  ask: AskAgentToFixChart;
  giveChartCaret: () => void;
}
/** What came of the last ask, and how many asks there have been. */
interface AnswerOfFixAsk {
  became: AskSentToChat | null;
  nth: number;
}
export function AskAgentToFixView({ words, ask, giveChartCaret }: AskAgentToFixViewProps) {
  let [answer, setAnswer] = React.useState<AnswerOfFixAsk>({
    became: null,
    nth: 0,
  });
  let pressGate = usePressGuard();
  let buttonRef = React.useRef<HTMLElement>(null);
  React.useLayoutEffect(() => {
    let button = buttonRef.current;
    let ownerDocument = button?.ownerDocument;
    return () => {
      if (ownerDocument !== undefined && ownerDocument.activeElement === button && ownerDocument.hasFocus()) giveChartCaret();
    };
  }, [giveChartCaret]);
  let answerWords = answer.became === null ? null : askSentToChatWords(answer.became);
  return <div className="flex flex-col items-center gap-xs pt-xs"><span className={`${FIX_OF_PLACED_VIEW_CLASS} inline-flex`}><Button ref={buttonRef} variant="secondary" size="sm" icon={<AgentMark size={14} />} tabIndex={0} onPointerDown={pressGate.noteDown} onClick={() => {
            if (!pressGate.isTaken()) return;
            setAnswer(
              ({ nth }) => ({
                became: null,
                nth: nth + 1,
              }),
            );
            ask(words).then(
              (became) =>
                setAnswer(
                  ({ nth }) => ({
                    became,
                    nth,
                  }),
                ),
            );
          }}>{chartMessages.askAgentToFix()}</Button></span><p aria-hidden className="min-h-[1lh] text-footnote text-secondary">{answerWords}</p><LiveAnnouncer words={answerWords} timesSaid={answer.nth} /></div>;
}
export const FIX_OF_PLACED_VIEW_CLASS = 'sheet-fix-of-placed-view';
export const LEAST_VIEW_SIZE_FOR_FIX = {
  width: 240,
  height: 128,
};
export const isViewBigEnoughForFix = (size: Pick<PaneRect, 'width' | 'height'>) =>
  size.width >= LEAST_VIEW_SIZE_FOR_FIX.width && size.height >= LEAST_VIEW_SIZE_FOR_FIX.height;
export const PlacedViewFixContext = React.createContext<PlacedViewFix>({
  noticeCame: () => {},
  ask: null,
  giveChartCaret: () => {},
});
