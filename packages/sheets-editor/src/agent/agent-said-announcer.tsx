import * as React from 'react';
import { LiveAnnouncer } from '../ui/live-announcer.tsx';
import { isMadeChangesWaitingFor } from './turn-of-agent.ts';
import { agentTurnSaidText } from '../i18n/agent-turn-labels.ts';
import type { SaidOfAgent } from '../state/initial-state.ts';
import type { DoneByAgent } from '../state/initial-state.ts';
interface AgentSaidAnnouncerProps {
  said: SaidOfAgent | null;
  doneByAgent: DoneByAgent | null;
}
export const ANNOUNCEMENT_HOLD_MS = 5000;
export const AgentSaidAnnouncer = React.memo(function ({ said, doneByAgent }: AgentSaidAnnouncerProps) {
  let [staleSaid, setStaleSaid] = React.useState<SaidOfAgent | null>(null);
  React.useEffect(() => {
    if (said === null || (said.what === 'isWorking' && said.staysWhileCursorShows)) return;
    let staleTimer = setTimeout(() => setStaleSaid(said), ANNOUNCEMENT_HOLD_MS);
    return () => clearTimeout(staleTimer);
  }, [said]);
  return <LiveAnnouncer words={said !== null && (said !== staleSaid || isMadeChangesWaitingFor(said, doneByAgent)) && agentTurnSaidText(said)} />;
});
