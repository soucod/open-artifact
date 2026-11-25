import type { CellReadByAnInput } from '@open-artifact/sheets-core';
import { isPromptDataTooLong } from '../agent/prompt-text.ts';
import { chartOfView } from '../charts/placed-views.ts';
import type { InputRow, WorkbookReads } from '../model/workbook.ts';
import type { AgentThatMayBeAway, ChartDescribers } from '../state/controller.ts';
declare global {
  /** Read when no `chartsForXlsx` is given: describes charts for an xlsx file without the agent. */
  var
 __agentSheetsLocal: { chartsForXlsx?: ChartsForXlsx } | undefined;
}
/** A chart of the workbook to describe for an xlsx file: its view, its name, the node of its code, and its inputs as read. */
export interface ChartForXlsx {
  viewId: string;
  name: string;
  nodeId: string;
  inputs: Record<string, InputRow[]>;
}
/** A chart for an xlsx file with the code that draws it, as it is told to the agent. */
export interface ChartWithCode extends Omit<ChartForXlsx, 'nodeId'> {
  code: string;
}
/** How many cells of a row or column of an input there are, and the texts of the ones told. */
export interface CellsToldOfInput {
  count: number;
  texts: (string | null)[];
}
/** An ask of the agent to describe charts, and the view of each chart by the short name it is told by. */
export interface AskToDescribeCharts {
  asked: { words: string; data: string };
  viewIdByShortName: Map<string, string>;
}
/** A chart's description for an xlsx file as the agent or the server gave it, unchecked; null when it is not one. */
export interface ChartDescribedForXlsx {
  viewId: string;
  description: unknown;
}
type ChartAgentReply = Awaited<ReturnType<ChartDescribers['agent']['ask']>>;
/** What describing the charts needs: the agent and its permission, the charts' code, and a clock. */
export interface ChartDescribingDeps extends Omit<ChartDescribers, 'agent'> {
  agent: AgentThatMayBeAway<AskToDescribeCharts['asked'], ChartAgentReply>;
  afterMs(ms: number, then: () => void): void;
  isFileStillWanted(): boolean;
}
export function toldCellsOfChartInput(cells: readonly CellReadByAnInput[]): CellsToldOfInput {
  let [firstCount, lastCount] = [CHART_INPUT_FIRST_TEXTS, CHART_INPUT_LAST_TEXTS];
  let toldCells = cells.length <= firstCount + lastCount ? cells : [...cells.slice(0, firstCount), ...cells.slice(-lastCount)];
  return {
    count: cells.length,
    texts: toldCells.map(({ text }) => (text.length <= MAX_CHART_INPUT_TEXT_LENGTH ? text : null)),
  };
}
export function xlsxChartAsksInBatches(charts: readonly ChartWithCode[]): AskToDescribeCharts[] {
  let fitsInOneAsk = (batch: readonly ChartWithCode[]) => !isPromptDataTooLong(askToDescribeChartsForXlsx(batch).asked);
  let batches: ChartWithCode[][] = [];
  for (let chart of charts) {
    if (!fitsInOneAsk([chart])) continue;
    let lastBatch = batches.at(-1);
    if (lastBatch !== undefined && fitsInOneAsk([...lastBatch, chart])) lastBatch.push(chart);
    else batches.push([chart]);
  }
  return batches.map(askToDescribeChartsForXlsx);
}
export function readXlsxChartDescriptions(
  answer: unknown,
  { viewIdByShortName }: Pick<AskToDescribeCharts, 'viewIdByShortName'>,
): ChartDescribedForXlsx[] {
  let charts = isChartAnswerObject(answer) ? answer.charts : null;
  let chartList: unknown[] = Array.isArray(charts) ? charts : [];
  let descriptionsByViewId = new Map<string, ChartDescribedForXlsx>();
  for (let chart of chartList) {
    let shortName = isChartAnswerObject(chart) ? chart.id : null;
    let viewId = typeof shortName === 'string' ? viewIdByShortName.get(shortName) : undefined;
    if (!isChartAnswerObject(chart) || viewId === undefined || descriptionsByViewId.has(viewId)) continue;
    let description = chart.description;
    let isDescriptionValid = description !== undefined && isNestedNoDeeperThan(MAX_CHART_DESCRIPTION_DEPTH, description);
    descriptionsByViewId.set(viewId, {
      viewId,
      description: isDescriptionValid ? description : null,
    });
  }
  return [...descriptionsByViewId.values()];
}
export function chartsOfWorkbookForXlsx(reads: WorkbookReads): ChartForXlsx[] {
  return [
    ...new Set(
      reads
        .listSheets()
        .flatMap(({ sheetId }) => reads.placementsIn(sheetId).map(({ viewId }) => viewId)),
    ),
  ].flatMap((viewId) => {
    let view = reads.viewAsItStands(viewId);
    let chartSource = chartOfView(view);
    if (view === null || chartSource.kind === 'none') return [];
    return [
      {
        viewId,
        name: view.view.name,
        nodeId: chartSource.nodeId,
        inputs: chartSource.inputs,
      },
    ];
  });
}
/** Asks the server to describe the charts, by view id, as the file's own kind of chart; a chart it cannot describe is left out. */
export type ChartsForXlsx = (viewIds: readonly string[]) => Promise<readonly { viewId: string; description?: unknown }[]>;
export function describeChartsForXlsx(
  charts: readonly ChartForXlsx[],
  {
    agent,
    viewerAllowsAgent,
    codeOfChart,
    chartsForXlsx,
    afterMs,
    isFileStillWanted,
  }: ChartDescribingDeps,
): Promise<ChartDescribedForXlsx[]> {
  let descriptions: ChartDescribedForXlsx[] = [];
  let isDone = false;
  let isOver = () => isDone;
  let isStillWanted = () => !isOver() && isFileStillWanted();
  let askInTurn = async ([ask, ...restOfAsks]: readonly AskToDescribeCharts[]): Promise<void> => {
    if (ask === undefined || !isStillWanted()) return;
    let reply = await agent.ask(ask.asked, () => {});
    if (isOver() || reply.kind === 'stopped' || reply.kind === 'notToBeHad') return;
    if (reply.kind === 'answered') descriptions.push(...readXlsxChartDescriptions(reply.answer, ask));
    await askInTurn(restOfAsks);
  };
  let askAll = async (): Promise<void> => {
    let chartsWithCode = await Promise.all(
      charts.map(async ({ nodeId, ...chart }): Promise<ChartWithCode[]> => {
        let code = await codeOfChart(nodeId);
        return code === null
          ? []
          : [
              {
                ...chart,
                code,
              },
            ];
      }),
    );
    await askInTurn(xlsxChartAsksInBatches(chartsWithCode.flat()).slice(0, MAX_XLSX_CHART_ASKS));
  };
  return new Promise<ChartDescribedForXlsx[]>((resolve, reject) => {
    let finish = () => {
      isDone = true;
      resolve([...descriptions]);
    };
    let finishAfterMs = (ms: number) =>
      afterMs(ms, () => {
        if (!isOver()) agent.stop();
        finish();
      });
    let start = async (): Promise<void> => {
      // The server describes the charts that its stock programs draw (sheets-core's xlsxChartsOf); the page has no
      // model of its own to ask, so a chart of any other code is left out of the file, as `notCarriedOver` says.
      let describedLocally: ChartsForXlsx | undefined =
        typeof chartsForXlsx === 'function' ? chartsForXlsx : globalThis.__agentSheetsLocal?.chartsForXlsx;
      if (typeof describedLocally === 'function') {
        let told = await describedLocally(charts.map(({ viewId }) => viewId)).catch(() => []);
        if (!isStillWanted()) return;
        let asked = new Set(charts.map(({ viewId }) => viewId));
        for (let chart of told)
          if (asked.has(chart?.viewId))
            descriptions.push({
              viewId: chart.viewId,
              description: chart.description ?? null,
            });
        return;
      }
      if (!(await agent.isAvailable()) || !isStillWanted()) return;
      if (!(await viewerAllowsAgent()) || !isStillWanted()) return;
      finishAfterMs(XLSX_CHART_DESCRIBING_MS);
      await askAll();
    };
    finishAfterMs(XLSX_CHART_PERMISSION_WAIT_MS);
    start().then(finish, reject);
  });
}
export const XLSX_CHART_DESCRIPTION_PROMPT = `The data is a JSON list of charts from a spreadsheet. Each has an "id", a "name", its "code" and its "inputs". The code is a JavaScript module that draws an SVG picture from the inputs. Each input is a grid of cells, {value, text} each, bound to a range of the spreadsheet: the rows from the top, each a list of cells from the left. Of each input you are told its first row and its first column as they are now: how many cells it has ("count") and their "texts". Of more than 40 cells you are told the first 30 and the last 10. A null stands for a text that is too long to tell.

The spreadsheet is being saved as an .xlsx file. For each chart, describe the file's own kind of chart that shows the same thing, in the closed grammar below. A description names inputs, never cells and never numbers. A program checks it against the cells and writes the file's chart from it.

Description =
    {"kind":"bar", "direction":"vertical"|"horizontal", "stacking":Stacking, "data":Data}
  | {"kind":"line", "stacking":Stacking, "data":Data}
  | {"kind":"area", "stacking":Stacking, "data":Data}
  | {"kind":"pie", "data":Data}        slices that meet in the middle, exactly one series
  | {"kind":"doughnut", "data":Data}   slices of a ring, each drawn between an inner and an outer radius, exactly one series
  | {"kind":"scatter", "data":Data}    the categories are the numbers that say how far along each point lies
  | {"kind":"none", "why":"worksOutItsNumbersInCode"|"noSuchKind"}
Stacking = "none" | "stacked" | "stackedToTheWhole"
Data =
    {"from":"table", "input":NAME, "seriesAre":"columns"|"rows", "labelsLeftOut":[TEXT, ...]}
      One input holds everything. Its first row holds headings and its first column holds labels.
  | {"from":"lists", "categories":NAME, "series":[NAME, ...], "firstCellIsAHeading":true|false}
      Each input is one column or one row of cells.

Rules:
- "seriesAre" says what one color, one line or one pie stands for: a column of the table, named by its heading, or a row of it, named by its label.
- "labelsLeftOut" lists the exact texts of every heading and every label whose column or row the chart does not draw, such as "Total". If the code picks out one column by its heading, list all the other headings. Rows with a blank label, and columns or rows with no number in them, are left out anyway: do not list those. If the chart does not draw a column or row whose heading or label you are not told, answer {"kind":"none","why":"noSuchKind"}.
- "firstCellIsAHeading" is true if the code skips the first cell of each list, or uses it as a name.
- Points that lie along dates or times are "line", whether or not a line joins them, and even if the code places them by how far apart the dates are. A cell that shows a date or a time holds no number, which "scatter" needs.
- "stackedToTheWhole" is for stacks that are all as long, where each part is its share of the whole.
- If the main marks (the bars, lines, areas, slices or points) show numbers that the code works out and that no cell holds, such as counts, sums, averages or bins, answer {"kind":"none","why":"worksOutItsNumbersInCode"}. Scaling a cell's number to fit the picture is not working out a number. Nor is a share that "stackedToTheWhole" or a pie shows by itself.
- If the main marks show the cells' own numbers and something beside them is worked out, such as a line at the average or a printed total, describe the main marks and leave the rest out.
- If no kind above shows the same thing, such as one big number, a heat map, a gauge or a timeline, answer {"kind":"none","why":"noSuchKind"}.
- Leave out whatever else the grammar has no word for, such as a target line or a caption, and describe the rest.

Answer with only this JSON, with one item for each chart, in the order given: {"charts":[{"id":ID,"description":Description}, ...]}`;
export const CHART_INPUT_FIRST_TEXTS = 30;
export const CHART_INPUT_LAST_TEXTS = 10;
export const MAX_CHART_INPUT_TEXT_LENGTH = 60;
export const chartToldForXlsx = ({ name, code, inputs }: ChartWithCode, id: string) => ({
  id,
  name,
  inputs: Object.fromEntries(
    Object.entries(inputs).map(
      ([inputName, cells]) => [
        inputName,
        {
          firstRow: toldCellsOfChartInput(cells[0] ?? []),
          firstColumn: toldCellsOfChartInput(cells.flatMap((row) => row.slice(0, 1))),
        },
      ],
    ),
  ),
  code,
});
export const askToDescribeChartsForXlsx = (charts: readonly ChartWithCode[]): AskToDescribeCharts => {
  let named = charts.map(
    (chart, index) => ({
      chart,
      shortName: `c${index + 1}`,
    }),
  );
  return {
    asked: {
      words: XLSX_CHART_DESCRIPTION_PROMPT,
      data: JSON.stringify(named.map(({ chart, shortName }) => chartToldForXlsx(chart, shortName))),
    },
    viewIdByShortName: new Map(named.map(({ chart, shortName }) => [shortName, chart.viewId])),
  };
};
export const isChartAnswerObject = (value: unknown): value is Record<PropertyKey, unknown> => typeof value === 'object' && value !== null;
export const MAX_CHART_DESCRIPTION_DEPTH = 3;
export const isNestedNoDeeperThan = (depth: number, value: unknown): boolean =>

  !isChartAnswerObject(value) || (depth > 0 && Object.values(value).every((child) => isNestedNoDeeperThan(depth - 1, child)));
export const XLSX_CHART_DESCRIBING_MS = 45000;
export const XLSX_CHART_PERMISSION_WAIT_MS = 900000;
export const MAX_XLSX_CHART_ASKS = 4;
