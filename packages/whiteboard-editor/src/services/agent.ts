/**
 * The agent that owns the board: whether it can be reached and is working,
 * and sending it requests. Every on-board "Ask" entry ends here; the agent
 * answers by writing to the board's store, never through this page.
 */

import { create } from 'zustand';
import { watchAgentStatus } from '@open-artifact/editor-kit';
import type { AgentRequest, AgentSendResult } from '@open-artifact/runtime';
import { maybeSession } from './session.ts';
import { boardScope } from './storage-scope.ts';

export interface AgentState {
  /** An agent can receive requests. */
  available: boolean;
  /** The agent is changing this artifact right now. */
  busy: boolean;
  /** Display name, e.g. `Agent`. */
  name: string;
  /** false: an idle agent is not woken; what is sent waits until the person next talks to it. */
  wakesIdle?: boolean;
}

export const useAgent = create<AgentState>()(() => ({ available: false, busy: false, name: 'Agent' }));

const agentKey = () => `wb-agent:${boardScope()}`;
let settled = false;
const waiters = new Set<() => void>();

/**
 * Shows the agent as this tab last saw it on this board (kept in session storage), so on a reload the toolbar opens
 * with its agent buttons in place instead of adding them once the host answers.
 */
export function primeAgentState(): void {
  try {
    const saved = JSON.parse(sessionStorage.getItem(agentKey()) ?? 'null') as Partial<AgentState> | null;
    if (typeof saved?.available === 'boolean' && typeof saved.name === 'string') {
      useAgent.setState({ available: saved.available, name: saved.name, busy: false,
        wakesIdle: typeof saved.wakesIdle === 'boolean' ? saved.wakesIdle : undefined });
    }
  } catch { /* Storage is optional in embedded boards. */ }
}

function settleAgent(): void {
  settled = true;
  for (const finish of waiters) finish();
}

/** Waits briefly (at most `timeoutMs`) for the agent's status, so the toolbar opens with its agent slot settled. */
export function whenAgentSettled(timeoutMs = 100): Promise<void> {
  if (settled) return Promise.resolve();
  return new Promise(resolve => {
    const finish = (): void => {
      clearTimeout(timer);
      waiters.delete(finish);
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    waiters.add(finish);
  });
}

/** Follows the agent's status; returns a function that stops. */
export function watchAgent(): () => void {
  settled = false;
  const agent = maybeSession()?.agent;
  const publish = (state: AgentState): void => {
    useAgent.setState(state);
    const { available, name, wakesIdle } = state;
    try {
      sessionStorage.setItem(agentKey(), JSON.stringify({ available, name, wakesIdle }));
    } catch { /* Storage is optional in embedded boards. */ }
    settleAgent();
  };
  const unavailable = () => publish({ available: false, busy: false, name: 'Agent', wakesIdle: undefined });
  if (!agent) unavailable();
  const off = watchAgentStatus(agent, status => publish({
    available: status.available, busy: status.busy, name: status.name || 'Agent', wakesIdle: status.wakesIdle,
  }), unavailable);
  return () => {
    off();
    settleAgent();
  };
}

/** When this page last sent the agent a request (epoch ms; 0 before the first). */
let lastAskAt = 0;

/** This page sent the agent a request within the last `withinMs` milliseconds. */
export function askedRecently(withinMs: number): boolean {
  return lastAskAt > 0 && Date.now() - lastAskAt <= withinMs;
}

/** Sends a request to the agent (a turn now, or queued while it is away). */
export async function sendToAgent(request: AgentRequest): Promise<AgentSendResult> {
  const agent = maybeSession()?.agent;
  if (!agent) return { status: 'failed', reason: 'No agent is connected to this board.' };
  try {
    lastAskAt = Date.now();
    return await agent.send(request, { deliver: 'send' });
  } catch (error) {
    return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
  }
}
