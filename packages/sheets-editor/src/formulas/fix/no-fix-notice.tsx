import * as React from 'react';
import { askAgentToFixSelection } from '../../agent/ask-agent-menu.tsx';
import { useFollowedValueOf } from '../../state/followed-values.ts';
import { agentFixStateOf, AskAgentToFixButton } from '../../ui/ask-agent-to-fix-button.tsx';
import { MountedToast } from '../../ui/mounted-toast.tsx';
import { fixFailureText, fixFailureWithButtonText } from '../../i18n/formula-fix-labels.ts';
import { DangerWarningIcon } from '../../ui/warning-icon.tsx';
import { LiveAnnouncer } from '../../ui/live-announcer.tsx';
import type { ChatWithAgent } from '../../agent/chat-with-agent.ts';
import type { StoreToAskFixes } from './errors-notice.tsx';
import type { WhyFixCameToNothing } from '../../state/initial-state.ts';
import type { ToastCloseInfo } from '../../kit/toast.tsx';
export async function askChatAfterNoFix(
  store: StoreToAskFixes,
  chat: Pick<ChatWithAgent, 'openWithWhatWasPressed'>,
): Promise<boolean> {
  let noticeOfNoFix = store.getView().noticeOfNoFix;
  if (noticeOfNoFix === null || store.isEventUnfinished()) return false;
  store.dispatch({
    kind: 'chatAskedAfterNoFix',
  });
  if (store.getView().selectionByAddress?.range !== noticeOfNoFix.cells) return false;
  let isAsked = await askAgentToFixSelection(chat, store);
  if (isAsked)
    store.dispatch({
      kind: 'noticeOfNoFixPutAway',
    });
  return isAsked;
}
interface NoFixToastProps {
  why: WhyFixCameToNothing;
  isChatOffered: boolean;
  canAttach: boolean;
  onAgentAsked: () => void;
  onOver: (closed: ToastCloseInfo) => void;
  onTakenDown: () => void;
}
export function NoFixToast({
  why,
  isChatOffered,
  canAttach,
  onAgentAsked,
  onOver,
  onTakenDown,
}: NoFixToastProps) {
  let agentOffer = useFollowedValueOf(agentFixStateOf(isChatOffered ? '' : null, canAttach));
  let askButton = <AskAgentToFixButton agent={agentOffer} onPress={() => onAgentAsked()} />;
  return <MountedToast words={fixFailureText(why)} icon={<DangerWarningIcon size="md" />} action={why === 'rateLimited' ? undefined : askButton} staysUntilClosed={why !== 'rateLimited'} onOver={onOver} onTakenDown={onTakenDown} />;
}
interface NoFixAnnouncerProps {
  why: WhyFixCameToNothing | null;
  isChatOffered: boolean;
}
export const NoFixAnnouncer = React.memo(function ({ why, isChatOffered }: NoFixAnnouncerProps) {
  if (why === null)
    return <LiveAnnouncer words={false} />;
  let words = isChatOffered && why !== 'rateLimited' ? fixFailureWithButtonText(why) : fixFailureText(why);
  return <LiveAnnouncer words={words} />;
});
