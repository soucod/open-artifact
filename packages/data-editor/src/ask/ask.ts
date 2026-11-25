/**
 * "Ask the agent" on a selection. With an agent listening, a box opens for
 * the person's request, and Send hands it to the agent with the selection as
 * data. With none listening, the prompt is copied (to paste into a
 * conversation with the agent) and the page says so.
 */

import { create } from 'zustand';
import { agentResultMessage, sendFailure } from '@open-artifact/editor-kit';
import type { AgentSendResult } from '@open-artifact/runtime';
import { toast } from '@open-artifact/ui';
import type { RequestSelection } from '../drafts/request.ts';
import type { ElementSelection } from '../page/selection.ts';
import { useAgentActivity } from '../platform/agent-activity.ts';
import { maybeSession } from '../services/session.ts';
import { ASK_SENT, NOT_LISTENING, buildAskRequest, buildCopiedPrompt, buildSelectionPrompt, toRequestSelection, type SelectionContext } from './prompt.ts';

export interface AskBoxRequest {
  /** A new box each time one opens (a box already open gives way to it). */
  key: number;
  selection: RequestSelection;
}

export interface AskState {
  box: AskBoxRequest | null;
}

export const useAsk = create<AskState>()(() => ({ box: null }));

let opened = 0;

export function openAskBox(selection: RequestSelection): void {
  opened += 1;
  useAsk.setState({ box: { key: opened, selection } });
}

export function closeAskBox(): void {
  useAsk.setState({ box: null });
}

/** The page can hand requests to an agent at all (one may not be listening right now). */
export function canReachAgent(): boolean {
  const current = maybeSession();
  return current !== null && current.canAsk && current.agent !== null;
}

/** A React hook form of {@link canReachAgent}; follows the agent's status. */
export function useCanReachAgent(): boolean {
  useAgentActivity((state) => state.available);
  return canReachAgent();
}

const isListening = (): boolean => canReachAgent() && useAgentActivity.getState().available;

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** With no agent listening: copy the prompt and say so. */
function sayNotListening(selection: RequestSelection, words = ''): void {
  void copyText(buildCopiedPrompt(selection, words));
  toast.add({ title: NOT_LISTENING });
}

/** Asks about a selection: opens the box, or (with no agent listening) copies the prompt. */
export function askAboutSelection(selection: RequestSelection): void {
  if (isListening()) openAskBox(selection);
  else sayNotListening(selection);
}

/** Asks about a picked piece or a text selection on the page. */
export function askAboutElement(selection: ElementSelection, context: SelectionContext): void {
  askAboutSelection(toRequestSelection(buildSelectionPrompt(selection, context)));
}

export type AskSendOutcome = { sent: true } | { sent: false; error: string };

/** Sends the box's request. Delivered: the box closes and the page says so; failed: the box stays with the error. */
export async function sendAsk(words: string, selection: RequestSelection): Promise<AskSendOutcome> {
  const agent = maybeSession()?.agent ?? null;
  if (agent === null || !isListening()) return { sent: false, error: NOT_LISTENING };
  let result: AgentSendResult;
  try {
    result = await agent.send(buildAskRequest(words, selection), { deliver: 'send' });
  } catch (error) {
    result = sendFailure(error);
  }
  if (result.status === 'failed') return { sent: false, error: NOT_LISTENING };
  closeAskBox();
  if (result.status === 'delivered' && !result.drafted) toast.add({ title: ASK_SENT });
  else {
    const { name, wakesIdle } = useAgentActivity.getState();
    toast.add(agentResultMessage(result, 'this dashboard', { name, wakesIdle }));
  }
  return { sent: true };
}
