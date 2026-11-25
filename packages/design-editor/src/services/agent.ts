/**
 * Working with the agent: the view context it receives with the viewer's
 * next message, "Send to agent" and "Ask agent to fix".
 *
 * Everything taken from the artifact (element text, labels, error messages)
 * was written by someone and is fenced as untrusted data before it is sent.
 * Only what the viewer typed goes in as their own words.
 */

import { buildViewContext, type DesignViewContext, type SelectedElement } from '@open-artifact/design-core';
import { elementKind, elementLabel, parseDcDocument, parseTemplate, resolveElement, type TemplateModel } from '@open-artifact/dc';
import { fenceUntrusted, type AgentSendResult, type AgentStatus } from '@open-artifact/runtime';
import { agentResultMessage, sendFailure, watchAgentStatus } from '@open-artifact/editor-kit';
import { toast } from '@open-artifact/ui';
import { create } from 'zustand';
import { isDirty, useDocument } from '../state/document.ts';
import { useView } from '../state/view.ts';
import { session } from './session.ts';
import { visibleBoards } from './viewport.ts';
import { errorsKey, fixRequest, type BoardProblem } from '../lib/board-errors.ts';

/** Live agent status. */
export const useAgent = create<{ status: AgentStatus }>()(() => ({
  status: { available: false, busy: false, name: 'Agent' },
}));

/** Template models by source, so labels do not re-parse on every change. */
const modelCache = new Map<string, TemplateModel>();

/** The parsed template of an artboard source. */
export function templateOf(source: string): TemplateModel {
  let model = modelCache.get(source);
  if (!model) {
    const doc = parseDcDocument(source);
    model = parseTemplate(doc.template?.text ?? '');
    if (modelCache.size > 64) modelCache.clear();
    modelCache.set(source, model);
  }
  return model;
}

/** The selected elements with their kinds and labels. */
export function selectedElements(): SelectedElement[] {
  const { selection } = useView.getState();
  if (selection.kind !== 'elements') return [];
  const source = useDocument.getState().boards[selection.board]?.source;
  if (!source) return [];
  const model = templateOf(source);
  const out: SelectedElement[] = [];
  for (const item of selection.items) {
    const element = resolveElement(model, item.tid, item.path);
    if (!element) continue;
    const label = elementLabel(element);
    out.push({ board: selection.board, tid: item.tid, path: item.path, kind: elementKind(element), ...(label ? { label } : {}) });
  }
  return out;
}

/** The view context of this viewer right now. */
export function currentViewContext(): DesignViewContext {
  const view = useView.getState();
  const doc = useDocument.getState();
  const page = doc.canvas.pages.find((p) => p.id === view.page) ?? doc.canvas.pages[0] ?? null;
  const errored = Object.entries(view.frames)
    .filter(([, frame]) => frame.errors.length > 0)
    .map(([board, frame]) => ({ board, message: frame.errors[0]!.message }));
  return buildViewContext({
    mode: view.mode,
    page: page ? { id: page.id, name: page.name } : null,
    visible: view.mode === 'focused' && view.focused ? [view.focused] : visibleBoards(),
    selectedBoards: view.selection.kind === 'objects' ? view.selection.boards : [],
    selectedElements: selectedElements(),
    errored,
    dirty: isDirty(doc),
    edits: doc.edits,
  });
}

/** Publishes the view context whenever what it describes changes. */
export function startPresence(): void {
  const { room, agent } = session();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = '';
  const publish = (): void => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      const context = currentViewContext();
      const text = JSON.stringify(context);
      if (text === last || !room) return;
      last = text;
      room.presence({ viewContext: context }).catch(() => undefined);
    }, 400);
  };
  useView.subscribe((state, previous) => {
    if (
      state.selection !== previous.selection ||
      state.page !== previous.page ||
      state.mode !== previous.mode ||
      state.focused !== previous.focused ||
      state.frames !== previous.frames ||
      state.camera !== previous.camera
    ) {
      publish();
    }
  });
  useDocument.subscribe((state, previous) => {
    if (state.edits !== previous.edits || state.save !== previous.save) publish();
  });
  publish();

  watchAgentStatus(agent, (status) => useAgent.setState({ status }));
}

/** Describes a send result to the viewer. */
function reportResult(result: AgentSendResult): void {
  toast.add(agentResultMessage(result, 'this design', useAgent.getState().status));
}

/** Sends the viewer's request about the current selection. */
export async function sendToAgent(message: string): Promise<AgentSendResult | null> {
  const { agent } = session();
  const text = message.trim();
  if (!agent || !text) return null;
  const context = currentViewContext();
  const parts = [text];
  const selection = context.selection ?? [];
  if (selection.length) {
    // Labels are artifact text: fenced, never instructions.
    const listed = selection.map((item) => `${item.id} (${item.kind})${item.label ? `: ${item.label}` : ''}`).join('\n');
    parts.push(fenceUntrusted(listed, { label: 'selected elements' }));
  } else if (context.selectedArtboards.length) {
    parts.push(`Selected artboards: ${context.selectedArtboards.join(', ')}`);
  }
  try {
    const result = await agent.send({ title: 'Send to agent', text: parts.join('\n\n'), context: { view: context } });
    reportResult(result);
    return result;
  } catch (error) {
    reportResult(sendFailure(error));
    return null;
  }
}

/**
 * Hands the errors of the given artboards to the agent. When it cannot be
 * reached, the request waits in the list of artboards with errors for the
 * viewer to copy, and the list opens on the canvas.
 */
export async function askAgentToFix(problems: readonly BoardProblem[]): Promise<AgentSendResult | null> {
  const { agent } = session();
  if (!agent || problems.length === 0) return null;
  const text = fixRequest(problems);
  let result: AgentSendResult;
  try {
    result = await agent.send({ title: 'Ask agent to fix', text, context: { boards: problems.map((problem) => problem.path) } });
  } catch (error) {
    result = sendFailure(error);
  }
  const view = useView.getState();
  if (result.status === 'failed') {
    view.setUnsentFix({ key: problemsKey(problems), text });
    if (view.mode === 'canvas') {
      view.setErrorsOpen(true);
      const message = agentResultMessage(result, 'this design', useAgent.getState().status);
      toast.add({ ...message, description: `${message.description ?? ''} The request is in the list of artboards with errors, to copy.`.trim() });
      return result;
    }
  } else if (view.unsentFix) {
    view.setUnsentFix(null);
  }
  reportResult(result);
  return result;
}

/** Changes whenever the artboards or their errors change. */
export function problemsKey(problems: readonly BoardProblem[]): string {
  return JSON.stringify(problems.map((problem) => [problem.path, errorsKey(problem.errors)]));
}

/** A broken index has no board selection to attach to a repair request. */
export async function askAgentToFixIndex(error: string): Promise<void> {
  const { agent } = session();
  if (!agent) return;
  const text = 'Fix project/canvas.json so that the design can open.\n\n' + fenceUntrusted(error.slice(0, 1800), { label: 'canvas.json parse error' });
  try {
    reportResult(await agent.send({ title: 'Ask agent to fix', text, context: { file: 'project/canvas.json' } }));
  } catch (error) {
    reportResult(sendFailure(error));
  }
}
