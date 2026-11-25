/**
 * Requests the page sends the agent (Remix, make the page editable, change
 * the design system). The agent acts only on the message's `request`; the
 * `selection` tells it where the person was, as data.
 */

import { agentResultMessage, sendFailure } from '@open-artifact/editor-kit';
import type { AgentSendResult } from '@open-artifact/runtime';
import { toast } from '@open-artifact/ui';
import { useAgentActivity } from '../platform/agent-activity.ts';
import { maybeSession } from '../services/session.ts';

/** Where the request came from, for the agent to read as data. */
export interface RequestSelection {
  label: string;
  chip: Record<string, unknown>;
  text: string;
}

export interface PageRequest {
  /** Short label for cards and logs. */
  title: string;
  /** The request itself. */
  request: string;
  selection: RequestSelection;
}

/** An agent can be asked from this page. */
export function canAskAgent(): boolean {
  const current = maybeSession();
  return current !== null && current.canAsk && current.agent !== null && useAgentActivity.getState().available;
}

/** A React hook form of {@link canAskAgent}. */
export function useCanAskAgent(): boolean {
  const available = useAgentActivity((state) => state.available);
  const current = maybeSession();
  return available && current !== null && current.canAsk && current.agent !== null;
}

/** Sends a request; says how the host took it unless it reached the agent. True when it was handed off. */
export async function sendPageRequest({ title, request, selection }: PageRequest): Promise<boolean> {
  const agent = maybeSession()?.agent ?? null;
  let result: AgentSendResult;
  if (agent === null) result = { status: 'failed', reason: 'No agent is connected to this dashboard.' };
  else {
    try {
      result = await agent.send({ title, text: request, context: { request, selection: { ...selection } } }, { deliver: 'send' });
    } catch (error) {
      result = sendFailure(error);
    }
  }
  // A plain delivery shows itself on the page; one put in the conversation for the person to send is said.
  if (result.status !== 'delivered' || result.drafted) {
    const { name, wakesIdle } = useAgentActivity.getState();
    toast.add(agentResultMessage(result, 'this dashboard', { name, wakesIdle }));
  }
  return result.status !== 'failed';
}
