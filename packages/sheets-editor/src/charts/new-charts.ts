import type { ChartEditOutcome } from '../state/controller.ts';
import { askAgentForChartCode, type ChartCodeAgent, type WhyNoChartCodeFromAgent } from './agent-edits.ts';
import { newChartRequest, type CellsForNewChart } from './chart-code-ask.ts';
import { STOCK_CHART_PROGRAMS, type StockKind } from './stock-programs.ts';
import type { ChartWidgetNodes } from './widget-nodes.ts';
/** Asks the page to place a chart that shows this node. */
export type AddChartNode = (nodeId: string) => Promise<ChartEditOutcome>;
/** What came of adding a chart: the node it shows and the step that placed it, or why it was not placed. */
export type ChartAddedOutcome = ({ nodeId: string } & Extract<ChartEditOutcome, object>) | 'full' | 'notMade';
/** New charts whose code the agent writes. */
export interface ChartWriterByAgent {
  isToBeHad(): Promise<boolean>;
  write(inputs: CellsForNewChart, asked: string | null, mostUnits: number): Promise<WhyNoChartCodeFromAgent | { nodeId: string }>;
  giveUp(): void;
  discard(nodeId: string): void;
}
/** New charts the page makes itself, from the stock programs. */
export interface StockChartMaker {
  readonly isToBeHad: boolean;
  make(kind: StockKind, add: AddChartNode): Promise<ChartAddedOutcome | 'codeRefused'>;
}
export async function addChartOfNode(nodeId: string, add: AddChartNode, discard: (nodeId: string) => void): Promise<ChartAddedOutcome> {
  const added = await add(nodeId);
  if (typeof added === 'object')
    return {
      nodeId,
      ...added,
    };
  if (added !== 'unsure') discard(nodeId);
  return added === 'full' ? 'full' : 'notMade';
}
export function createChartWriterByAgent(charts: ChartWidgetNodes, agent: ChartCodeAgent): ChartWriterByAgent {
  let writeNumber = 0;
  return {
    isToBeHad: async () => charts.isToBeHad && (await agent.isAvailable()),
    async write(inputs, asked, mostUnits) {
      writeNumber += 1;
      const thisWrite = writeNumber;
      const code = await askAgentForChartCode(agent, newChartRequest(inputs, asked, mostUnits));
      if (thisWrite !== writeNumber) return 'stopped';
      if (typeof code !== 'string') return code.whyNone;
      const preview = await charts.makePreview(code);
      if (thisWrite === writeNumber) return typeof preview === 'string' ? 'notChanged' : preview;
      if (typeof preview !== 'string') charts.discard(preview.nodeId);
      return 'stopped';
    },
    giveUp() {
      writeNumber += 1;
      agent.stop();
    },
    discard: (nodeId) => charts.discard(nodeId),
  };
}
export async function insertChartWrittenByAgent(
  deps: { agent: Pick<ChartWriterByAgent, 'write' | 'discard'>; add: AddChartNode },
  inputs: CellsForNewChart,
  { asked, mostUnitsOfAsked }: { asked: string | null; mostUnitsOfAsked: number },
): Promise<WhyNoChartCodeFromAgent | ChartAddedOutcome> {
  const preview = await deps.agent.write(inputs, asked, mostUnitsOfAsked);
  if (typeof preview === 'string') return preview;
  return addChartOfNode(preview.nodeId, deps.add, (nodeId) => deps.agent.discard(nodeId));
}
export const NO_CHART_MAKER: StockChartMaker = {
  isToBeHad: false,
  make: () => Promise.resolve('notMade'),
};
export const createStockChartMaker = (charts: ChartWidgetNodes): StockChartMaker => ({
  get isToBeHad() {
    return charts.isToBeHad;
  },
  async make(kind, add) {
    const preview = await charts.makePreview(STOCK_CHART_PROGRAMS[kind]);
    if (typeof preview === 'string') return preview === 'refused' ? 'codeRefused' : 'notMade';
    return addChartOfNode(preview.nodeId, add, (nodeId) => charts.discard(nodeId));
  },
});
