import type { SheetId } from '@open-artifact/sheets-core';
import type { PageView } from '../view/page-view.ts';
import type { WhyNoChartCodeFromAgent } from './agent-edits.ts';
import type { ChartAddedOutcome } from './new-charts.ts';
import type { PlacedViewToDraw } from './placed-views.ts';
import { countCellsLeftOutOfChart, type StockKind } from './stock-programs.ts';
/** Why a chart asked for was not added. */
export type WhyChartNotAdded = 'notMade' | 'codeRefused' | 'full' | 'notForPage' | 'leftSheet';
/** What came of making a chart: the node added and the step that added it, or why none was. */
export type ChartMade = Extract<ChartAddedOutcome, object> | WhyChartNotAdded;
/** The press that asked for a chart: of a kind the page makes, or one the agent writes; and the page as it stood. */
export interface PressForChart {
  kind: StockKind | 'byAgent';
  sheetId: SheetId | null;
  allSelectedText: string;
  activeCellKey: string;
  changesAskedFor: PageView['grid']['changesAskedFor'];
}
export interface ChartMakingAwaited {
  nth: number;
  is: 'awaited';
  atPress: PressForChart;
}
export interface ChartNotAdded {
  nth: number;
  is: 'notAdded';
  why: WhyChartNotAdded;
}
export interface ChartAdded {
  nth: number;
  is: 'added';
  atPress: PressForChart;
  nodeId: string;
  step: string | null;
  /** How many of the cells charted are left out of it; null until it is drawn. */
  valuesNotShown: number | null;
  isCardLost: boolean;
}
/** A chart asked for from the menu, on its way, added or not. */
export type ChartMaking = ChartMakingAwaited | ChartNotAdded | ChartAdded;
/** How asking the agent for a chart settled: a chart made (or why not), or what to say in the card, if anything. */
export type ChartMakingSettled = { made: ChartMade } | { inCard: Exclude<WhyNoChartCodeFromAgent, 'stopped' | 'tooLarge'> | null };
export function settleChartMaking(making: ChartMaking | null, { nth, atPress }: ChartMakingAwaited, outcome: ChartMade): ChartMaking | null {
  if (typeof outcome === 'string')
    return {
      nth,
      is: 'notAdded',
      why: outcome,
    };
  return making?.nth === nth
    ? {
        nth,
        is: 'added',
        atPress,
        ...outcome,
        valuesNotShown: null,
        isCardLost: false,
      }
    : making;
}
export function chartMakingOutcome(
  outcome: WhyNoChartCodeFromAgent | ChartAddedOutcome | 'codeRefused',
  isForPage: boolean,
  hasLeftSheet = false,
): ChartMakingSettled {
  if (outcome === 'stopped')
    return hasLeftSheet
      ? {
          made: 'leftSheet',
        }
      : {
          inCard: null,
        };
  if (typeof outcome === 'object' || outcome === 'full' || outcome === 'notMade' || outcome === 'codeRefused')
    return {
      made: outcome,
    };
  if (!isForPage)
    return {
      made: outcome === 'notChanged' ? 'notMade' : 'notForPage',
    };
  return {
    inCard: outcome === 'tooLarge' ? 'forChat' : outcome,
  };
}
export function chartMakingForView(making: ChartMaking | null, view: PageView): ChartMaking | null {
  if (making === null || making.is === 'notAdded') return making;
  if (shownSheetIdOf(view) !== making.atPress.sheetId) return null;
  if (making.is === 'awaited') return making;
  if (view.latestStep !== making.step) return null;
  const { chart }: Partial<PlacedViewToDraw> = placedViewOfAddedChart(making, view) ?? {};
  if (chart?.kind !== 'code') return making.valuesNotShown === null ? making : null;
  if (view.undoOfTurnOffered !== null && !making.isCardLost)
    return {
      ...making,
      isCardLost: true,
    };
  if (making.valuesNotShown !== null) return making;
  const { kind: pressKind } = making.atPress;
  const valuesNotShown = pressKind === 'byAgent' ? 0 : countCellsLeftOutOfChart(chart.inputs, pressKind);
  return {
    ...making,
    valuesNotShown,
  };
}
export const shownSheetIdOf = ({ listedSheets }: Pick<PageView, 'listedSheets'>): SheetId | null =>
  listedSheets.find(({ isShown }) => isShown)?.sheetId ?? null;
export const awaitedChartMaking = (
  nth: number,
  pressKind: PressForChart['kind'],
  view: Pick<PageView, 'listedSheets' | 'allSelectedText' | 'activeCellKey' | 'grid'>,
): ChartMakingAwaited => ({
  nth,
  is: 'awaited',
  atPress: {
    kind: pressKind,
    sheetId: shownSheetIdOf(view),
    allSelectedText: view.allSelectedText,
    activeCellKey: view.activeCellKey,
    changesAskedFor: view.grid.changesAskedFor,
  },
});
export const dropAddedChartMaking = (making: ChartMaking | null) => (making?.is === 'added' ? null : making);
export const dropChartMakingOfNth = (making: ChartMaking | null, nth: number) => (making?.nth === nth ? null : making);
export const placedViewOfAddedChart = (making: ChartMaking | null, { grid }: Pick<PageView, 'grid'>): PlacedViewToDraw | undefined =>
  making?.is === 'added'
    ? grid.placedViews.find(({ chart }) => chart.kind === 'code' && chart.nodeId === making.nodeId)
    : undefined;
export const addedChartForCard = (
  making: ChartMaking | null,
  isShown: boolean,
  { contextBarMenu, viewOnlyBecause, undoOfTurnOffered, entryCellKey }: Pick<PageView, 'contextBarMenu' | 'viewOnlyBecause' | 'undoOfTurnOffered' | 'entryCellKey'>,
): ChartAdded | null =>
  making?.is === 'added' &&
  !making.isCardLost &&
  isShown &&
  contextBarMenu !== 'chart' &&
  viewOnlyBecause === null &&
  entryCellKey === null &&
  undoOfTurnOffered === null
    ? making
    : null;
export const isAddedChartStillAtPress = (
  making: ChartMaking | null,
  { mode, menu, contextBarMenu, allSelectedText, activeCellKey, grid }: Pick<PageView, 'mode' | 'menu' | 'contextBarMenu' | 'allSelectedText' | 'activeCellKey' | 'grid'>,
): boolean =>
  making?.is === 'added' &&
  grid.changesAskedFor === making.atPress.changesAskedFor + 1 &&
  mode.kind === 'navigating' &&
  menu === null &&
  contextBarMenu === null &&
  !grid.placedViews.some(({ isSelected }) => isSelected) &&
  allSelectedText === making.atPress.allSelectedText &&
  activeCellKey === making.atPress.activeCellKey;
