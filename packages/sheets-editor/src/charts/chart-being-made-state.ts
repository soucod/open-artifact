import { parseA1AreaAsSeen } from '../model/a1-references.ts';
import { placedViewBox, nodeIdOfRef, isBoxInView, type PlacedViewToDraw } from './placed-views.ts';
import { DEFAULT_CHART_SIZE } from './placement.ts';
import type { DrawnBox } from '../grid/view-boxes.ts';
import type { ChartBeingMade, PageState } from '../state/initial-state.ts';
import type { ChartBeingMadeTold } from '../state/event-reducer.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
/** A chart being made, as drawn: where it will stand, and whether it has been added and stands elsewhere already. */
export interface ChartBeingMadeShown {
  nth: number;
  box: DrawnBox;
  isInView: boolean;
  kind: ChartBeingMade['kind'];
  isAdded: boolean;
  placementId: string | null;
  hasLandedElsewhere: boolean;
}
export function chartBeingMadeTold(
  { sheetId, chartBeingMade }: Pick<PageState, 'sheetId' | 'chartBeingMade'>,
  workbook: WorkbookReads,
  { nth, chart }: Pick<ChartBeingMadeTold, 'nth' | 'chart'>,
): ChartBeingMade | null {
  if (chart === null || !('topLeft' in chart))
    return chartBeingMade?.nth !== nth
      ? chartBeingMade
      : chart === null
        ? null
        : {
            ...chartBeingMade,
            ...chart,
          };
  if (chart.sheetId !== sheetId) return null;
  const sheet = workbook.listSheets().find((candidate) => candidate.sheetId === sheetId);
  const area =
    sheet === undefined
      ? null
      : parseA1AreaAsSeen(chart.topLeft, {
          ...sheet,
          ownRowOrder: null,
        });
  const topLeft = area === null ? null : workbook.cellIdAt(sheetId, area.topRowIndex, area.leftColumnIndex);
  return topLeft === null
    ? null
    : {
        nth,
        topLeft,
        kind: chart.kind,
        nodeSent: null,
        nodeAdded: null,
      };
}
export function shownChartBeingMade(
  state: PageState,
  workbook: ReadsWithTextMeasurer,
  placedViews: readonly PlacedViewToDraw[],
): ChartBeingMadeShown | null {
  const { chartBeingMade } = state;
  if (chartBeingMade === null || chartBeingMade.topLeft.sheetId !== state.sheetId) return null;
  const position = workbook.positionOfCell(chartBeingMade.topLeft);
  if (position === null) return null;
  const { nth, kind, nodeSent, nodeAdded } = chartBeingMade;
  const box = placedViewBox(state, workbook, {
    ...position,
    offsetFromAnchorCell: {
      xInPixels: 0,
      yInPixels: 0,
    },
    ...DEFAULT_CHART_SIZE,
  });
  const nodeIdOfPlaced = ({ viewId }: Pick<PlacedViewToDraw, 'viewId'>) =>
    nodeIdOfRef(workbook.viewAsItStands(viewId)?.view.elements[0]?.embed.ref ?? '');
  const nodeId = nodeAdded ?? nodeSent;
  const placed = nodeId === null ? undefined : placedViews.find((placedView) => nodeIdOfPlaced(placedView) === nodeId);
  return {
    nth,
    box,
    isInView: isBoxInView(box),
    kind,
    isAdded: nodeAdded !== null || placed !== undefined,
    placementId: placed?.placementId ?? null,
    hasLandedElsewhere: placed !== undefined && (placed.box.left !== box.left || placed.box.top !== box.top),
  };
}
