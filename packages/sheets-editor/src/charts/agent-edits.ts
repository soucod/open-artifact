import type { CopiedWidgetNode } from '@open-artifact/sheets-core';
import type { ChartInputs } from '../chart-frame/messages.ts';
import type { ChartChangeOutcome } from '../messages/charts.ts';
import type { AgentAskedByPage, AgentThatMayBeAway } from '../state/controller.ts';
import type { ChartNodeCopies } from '../state/copy-paste.ts';
import { stockKindOfChartCode, type AskForEditOfChart, type ChartNodeSwap, type ChartWidgetNodes } from './widget-nodes.ts';
import { canSwapChartKind, readsRowsAlone } from './chart-kind-fit.ts';
export { canSwapChartKind, readsRowsAlone };
import { STOCK_CHART_PROGRAMS, type StockKind } from './stock-programs.ts';
import { chartEditRequest, isForChatAnswer, readChartCodeAnswer, type ChartCodeAsk } from './chart-code-ask.ts';
import { nodeIdOfRef, nodeRefOf } from './placed-views.ts';
/** How the agent's sampler answers an ask, as far as chart asks read it. */
export type AgentSampleReply = { kind: 'answered'; answer: unknown } | { kind: 'stopped' | 'notToBeHad' | 'failed' | 'isYetToBeAllowed' };
/** The agent asked to write a chart's code; what it writes on the way is not read. */
export type ChartCodeAgent = AgentThatMayBeAway<ChartCodeAsk, AgentSampleReply>;
/** Why the agent gave no code for a chart. */
export type WhyNoChartCodeFromAgent = 'tooLarge' | 'stopped' | 'noAgent' | 'forChat' | 'notChanged';
export interface NoChartCodeFromAgent {
  whyNone: WhyNoChartCodeFromAgent;
}
/** A chart to change: the node it shows and the rows of its inputs. */
export interface ChartToChange {
  nodeId: string;
  inputs: ChartInputs;
}
/** A changed chart made as a preview, and how many times the chart it changes had been published. */
export interface ChartPreviewMade {
  preview: string;
  pubOfFrom: number;
}
/** What came of asking for a change to a chart: a preview of it, or why there is none. */
export type ChartChangeByAgent = WhyNoChartCodeFromAgent | ChartPreviewMade;
/** Changes to charts, asked of the agent or made by the page (a swap of stock kinds). */
export interface ChartEditsByAgent {
  isToBeHad(): Promise<boolean>;
  canAskAgent(): Promise<boolean>;
  kindOf(nodeId: string): Promise<StockKind | null>;
  ask(chartToChange: ChartToChange, asked: string, mostUnits: number, wantedKind: StockKind | null): Promise<ChartChangeByAgent>;
  giveUp(): void;
  pointAt(viewId: string, swap: ChartNodeSwap, pointChart: AskForEditOfChart): Promise<ChartChangeOutcome>;
  discard(nodeId: string): void;
}
/** Copies of chart nodes, made when charts are pasted or their sheet duplicated. */
export interface ChartNodeCopier {
  copy(refs: readonly string[]): Promise<ChartNodeCopies>;
  discard(copies: readonly CopiedWidgetNode[]): void;
}
export async function editChartWithAgent(
  { charts, agent }: { charts: Pick<ChartWidgetNodes, 'sourceOf' | 'makePreview'>; agent: ChartCodeAgent },
  { nodeId, inputs }: ChartToChange,
  asked: string,
  mostUnits: number,
  wantedKind: StockKind | null = null,
  isStopped: () => boolean = () => false,
): Promise<ChartChangeByAgent> {
  const source = await charts.sourceOf(nodeId);
  if (isStopped()) return 'stopped';
  if (source === null) return 'notChanged';
  const stockKind = stockKindOfChartCode(source.code);
  if (wantedKind !== null && stockKind === wantedKind) return 'notChanged';
  const isKindSwap = wantedKind !== null && canSwapChartKind(inputs, wantedKind);
  if (isKindSwap) agent.stop();
  const newCode =
    (isKindSwap ? STOCK_CHART_PROGRAMS[wantedKind] : null) ??
    (await askAgentForChartCode(
      agent,
      chartEditRequest(
        {
          code: source.code,
          inputs,
        },
        asked,
        mostUnits,
      ),
    ));
  if (typeof newCode !== 'string') return newCode.whyNone;
  if (newCode.trim() === source.code.trim()) return 'notChanged';
  if (isStopped()) return 'stopped';
  const preview = await charts.makePreview(newCode);
  return typeof preview === 'string'
    ? 'notChanged'
    : {
        preview: preview.nodeId,
        pubOfFrom: source.pub,
      };
}
export async function askAgentForChartCode(
  agent: AgentAskedByPage<ChartCodeAsk, AgentSampleReply>,
  request: ChartCodeAsk | null,
): Promise<string | NoChartCodeFromAgent> {
  if (request === null)
    return {
      whyNone: 'tooLarge',
    };
  const reply = await agent.ask(request, () => {
    return;
  });
  if (reply.kind === 'stopped')
    return {
      whyNone: 'stopped',
    };
  if (reply.kind === 'notToBeHad')
    return {
      whyNone: 'noAgent',
    };
  if (reply.kind === 'answered' && isForChatAnswer(reply.answer))
    return {
      whyNone: 'forChat',
    };
  return (
    (reply.kind === 'answered' ? readChartCodeAnswer(reply.answer) : null) ?? {
      whyNone: 'notChanged',
    }
  );
}
export function createChartEditsByAgent(charts: ChartWidgetNodes, agent: ChartCodeAgent): ChartEditsByAgent {
  let askNumber = 0;
  return {
    /** Whether charts can be changed at all: a kind swap needs the page alone, any other change the agent too (canAskAgent). */
    isToBeHad: async () => charts.isToBeHad,
    canAskAgent: async () => charts.isToBeHad && (await agent.isAvailable()),
    /** The stock kind this chart's code is, or null: another chart's code, or one that could not be read. */
    async kindOf(nodeId) {
      const source = await charts.sourceOf(nodeId);
      return source === null ? null : stockKindOfChartCode(source.code);
    },
    async ask(chartToChange, asked, mostUnits, wantedKind) {
      askNumber += 1;
      const thisAsk = askNumber;
      const outcome = await editChartWithAgent(
        {
          charts,
          agent,
        },
        chartToChange,
        asked,
        mostUnits,
        wantedKind,
        () => thisAsk !== askNumber,
      );
      if (thisAsk === askNumber) return outcome;
      if (typeof outcome === 'object') charts.discard(outcome.preview);
      return 'stopped';
    },
    giveUp() {
      askNumber += 1;
      agent.stop();
    },
    pointAt: (...pointing: Parameters<ChartWidgetNodes['pointAt']>) => charts.pointAt(...pointing),
    discard: (nodeId) => charts.discard(nodeId),
  };
}
export function createChartNodeCopier(charts: Pick<ChartWidgetNodes, 'copyOf' | 'discard'>, reportFault: (fault: unknown) => void): ChartNodeCopier {
  const copyNode = async (nodeId: string): Promise<Awaited<ReturnType<ChartWidgetNodes['copyOf']>>> => {
    try {
      return await charts.copyOf(nodeId);
    } catch (fault) {
      reportFault(fault);
      return 'notNow';
    }
  };
  const discardCopies = (copies: readonly CopiedWidgetNode[]) => {
    for (const { copy: copyRef } of copies) {
      const nodeId = nodeIdOfRef(copyRef);
      if (nodeId !== null) charts.discard(nodeId);
    }
  };
  const copyAll = async ([sourceRef, ...otherRefs]: readonly string[], copies: readonly CopiedWidgetNode[]): Promise<ChartNodeCopies> => {
    if (sourceRef === undefined) return copies;
    const nodeId = nodeIdOfRef(sourceRef);
    const copied = nodeId === null ? 'never' : await copyNode(nodeId);
    if (typeof copied !== 'string')
      return copyAll(otherRefs, [
        ...copies,
        {
          source: sourceRef,
          copy: nodeRefOf(copied.nodeId),
        },
      ]);
    discardCopies(copies);
    return copied;
  };
  return {
    copy: (refs) => copyAll(refs, []),
    discard: discardCopies,
  };
}
