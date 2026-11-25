import type { SheetId } from '@open-artifact/sheets-core';
import { parseA1AreaAsSeen, areaAsSeen, areasAsSeen } from '../model/a1-references.ts';
import type { SheetSizeAndOrder } from '../model/a1-references.ts';
import { unionOfAreas, selectionOfArea } from '../selection/model.ts';
import type { CellArea, CellSelection } from '../selection/model.ts';
import { showSheet } from '../state/sheet-tabs.ts';
import { showChangeByAgent, isViewFreeToFollow, doesPersonTakeViewBack } from './follow-agent.ts';
import { goToCells } from '../selection/go-to-cells.ts';
import { cachedSelectedArea } from '../presence/selections.ts';
import { isSidePaneShownAsPane } from '../state/queries.ts';
import { scrollToPlacedView } from '../charts/placed-views.ts';
import type { CellsChanged, PageState, PlaceShownByAgent, SheetShownForDone } from '../state/initial-state.ts';
import type { SheetSummary, WorkbookReads } from '../model/workbook.ts';
import type { ReadsWithTextMeasurer } from '../state/controller.ts';
import type { PageContext, PageEvent, ShownByAgentAsk } from '../state/event-reducer.ts';
import type { PageTransition } from '../state/transitions.ts';
import type { PlaceOfLink } from '../shell/sheet-links.ts';
/** What the agent asked to show the viewer, as it reads in the agent's words. */
export interface ShownByAgentWords {
  at?: unknown;
  in?: unknown;
}
/** What the agent shows the viewer: what it asked for, the place found for it, and how the view keeps it. */
export interface ViewShownByAgent {
  asked: ShownByAgentAsk;
  place: PlaceShownByAgent | null;
  /** Whether the place is shown only while it is on the sheet in view. */
  staysOnSheet: boolean;
  /** Whether the view goes on to follow the agent's edits once the place is gone. */
  goesWithEdits: boolean;
}
/** A reference split into the sheet it names, if any, and the range on that sheet. */
export interface SheetAndRange {
  sheet: string | null;
  range: string;
}
export function readShownByAgentAsk(asked: ShownByAgentWords): ShownByAgentAsk {
  return {
    at: (Array.isArray(asked.at) ? asked.at : [asked.at])
      .slice(0, MAX_SHOWN_REFERENCES)
      .flatMap((reference: unknown) => shownReferenceText(reference) ?? []),
    inSheet: shownReferenceText(asked.in),
  };
}
export function parseShownArea(text: string, sheet: SheetSizeAndOrder): CellArea | null {
  let match = /^\$?(\d{1,7}):\$?(\d{1,7})$/.exec(text.trim());
  if (match === null)
    return parseA1AreaAsSeen(text, {
      ...sheet,
      ownRowOrder: null,
    });
  let [firstRow, lastRow] = [Number(match[1]), Number(match[2])];
  let [topRow, bottomRow] = [Math.min(firstRow, lastRow), Math.max(firstRow, lastRow)];
  if (topRow < 1 || bottomRow > sheet.rowCount) return null;
  return {
    topRowIndex: topRow - 1,
    leftColumnIndex: 0,
    rowCount: bottomRow - topRow + 1,
    columnCount: sheet.columnCount,
  };
}
export function areaShownAsSeen(text: string, sheet: SheetSizeAndOrder): CellArea | null {
  let area = parseShownArea(text, sheet);
  return area === null ? null : areaAsSeen(area, sheet.ownRowOrder);
}
export function splitSheetOfReference(reference: string): SheetAndRange {
  let bangAt = reference.lastIndexOf('!');
  if (bangAt < 0)
    return {
      sheet: null,
      range: reference,
    };
  let sheetPart = reference.slice(0, bangAt);
  return {
    sheet: sheetPart.length > 1 && sheetPart.startsWith("'") && sheetPart.endsWith("'") ? sheetPart.slice(1, -1).replaceAll("''", "'") : sheetPart,
    range: reference.slice(bangAt + 1),
  };
}
export function chartPlaceOfViewId(workbook: WorkbookReads, viewId: string): PlaceShownByAgent | null {
  for (let { sheetId } of workbook.listSheets()) {
    let placement = workbook.placementsIn(sheetId).find(({ viewId: placedViewId }) => placedViewId === viewId);
    if (placement !== undefined)
      return {
        kind: 'chart',
        sheetId,
        viewId: placement.viewId,
      };
  }
  return null;
}
export function placeShownByAgent(asked: ShownByAgentAsk, currentSheetId: SheetId, workbook: WorkbookReads): PlaceShownByAgent | null {
  for (let viewId of asked.at) {
    let chartPlace = chartPlaceOfViewId(workbook, viewId);
    if (chartPlace !== null) return chartPlace;
  }
  let references = asked.at.map(splitSheetOfReference);
  let sheetName = asked.inSheet ?? references.find(({ sheet: sheetNamed }) => sheetNamed !== null)?.sheet ?? null;
  const sheet =
    sheetName === null
      ? workbook.listSheets().find(({ sheetId: listedSheetId }) => listedSheetId === currentSheetId)
      : findSheetByIdNameOrNumber(workbook, sheetName);
  if (sheet === undefined) return null;
  let { sheetId } = sheet;
  if (references.length === 0)
    return {
      kind: 'cells',
      sheetId,
      cells: null,
    };
  let areas = references.flatMap(
    ({ sheet: sheetNamed, range }) =>
      sheetNamed === null || findSheetByIdNameOrNumber(workbook, sheetNamed)?.sheetId === sheetId ? (areaShownAsSeen(range, sheet) ?? []) : [],
  );
  let [firstArea, ...otherAreas] = areas;
  if (firstArea === undefined) return null;
  let area = otherAreas.reduce(unionOfAreas, firstArea);
  let activeCell = workbook.cellIdAt(sheetId, area.topRowIndex, area.leftColumnIndex);
  let selectionCorner = workbook.cellIdAt(sheetId, area.topRowIndex + area.rowCount - 1, area.leftColumnIndex + area.columnCount - 1);
  if (activeCell === null || selectionCorner === null) return null;
  return {
    kind: 'cells',
    sheetId,
    cells: {
      activeCell,
      selectionCorner,
    },
  };
}
export function showSheetToFollow(state: PageState, workbook: ReadsWithTextMeasurer, sheetId: SheetId): PageState {
  let sheetName = workbook.listSheets().find((sheet) => sheet.sheetId === sheetId)?.name;
  let shownState = sheetId === state.sheetId ? state : showSheet(state, workbook, sheetId);
  if (shownState === state || sheetName === undefined) return state;
  let lastDone: SheetShownForDone = {
    what: 'sheetShownToFollow',
    name: sheetName,
  };
  return {
    ...shownState,
    notice: state.notice,
    lastDone,
  };
}
export function goToShownPlace(state: PageState, workbook: ReadsWithTextMeasurer, place: PlaceShownByAgent): PageState {
  if (place.kind === 'cells')
    return place.cells === null
      ? showSheetToFollow(state, workbook, place.sheetId)
      : showChangeByAgent(state, workbook, {
          cells: place.cells,
        });
  let onSheet = showSheetToFollow(state, workbook, place.sheetId);
  let placement = workbook.placementsIn(place.sheetId).find(({ viewId }) => viewId === place.viewId);
  return placement === undefined ? onSheet : scrollToPlacedView(onSheet, workbook, placement);
}
export function applyShownByAgent(state: PageState, workbook: ReadsWithTextMeasurer, shown: ViewShownByAgent): PageState {
  let place = state.gridHeight === 0 ? null : (shown.place ?? placeShownByAgent(shown.asked, state.sheetId, workbook));
  if (place === null)
    return {
      ...state,
      shownByAgent: shown,
      isFollowingAgent: keepsFollowingAgent(state, shown),
    };
  if (shown.staysOnSheet && place.sheetId !== state.sheetId)
    return {
      ...state,
      shownByAgent: null,
    };
  let shownState: PageState = {
    ...state,
    shownByAgent: {
      ...shown,
      place,
    },
    isFollowingAgent: false,
    followed: null,
    changedOffShowSinceRest: null,
  };
  return goToShownPlace(shownState, workbook, place);
}
export function stepShownByAgent(
  before: PageState,
  step: PageTransition,
  event: PageEvent,
  { reads }: Pick<PageContext, 'reads'>,
): PageState {
  const { state } = step;
  if (event.kind === 'viewShownByAgentChanged') {
    let { shown } = event;
    if (shown === null)
      return state.shownByAgent === null
        ? state
        : {
            ...state,
            shownByAgent: null,
            isFollowingAgent: keepsFollowingAgent(state, state.shownByAgent),
          };
    if (!isViewFreeToFollow(state))
      return {
        ...state,
        shownByAgent: null,
      };
    return applyShownByAgent(state, reads, {
      asked: shown,
      place: null,
      staysOnSheet: event.isPersonAtWorkInPage === true,
      goesWithEdits: state.shownByAgent?.goesWithEdits ?? (state.isFollowingAgent || !state.isAgentWorking),
    });
  }
  if (state.shownByAgent === null) return state;
  if ((event.kind === 'followAsked' && event.tabKey !== null) || event.kind === 'keyPressed' || doesPersonTakeViewBack(before, step, event))
    return {
      ...state,
      shownByAgent: null,
    };
  let isGridHidden = event.kind === 'gridResized' && before.gridHeight === 0;
  if (event.kind !== 'workbookChanged' && !isGridHidden) return state;
  let { place } = state.shownByAgent;
  if (place?.kind === 'cells' && place.cells === null) return state;
  return applyShownByAgent(state, reads, state.shownByAgent);
}
export function linkedAreasOfPlace({ sheetId, ranges }: PlaceOfLink, reads: WorkbookReads): CellArea[] {
  let sheet = reads.listSheets().find((one) => one.sheetId === sheetId);
  if (sheet === undefined) return [];
  return ranges.flatMap((range) => {
    let area = parseShownArea(range, sheet);
    if (area === null) return [];
    let areasSeen = areasAsSeen(area, sheet.ownRowOrder);
    return areasSeen.length > MAX_LINKED_AREAS_AS_SEEN ? areaAsSeen(area, sheet.ownRowOrder) : areasSeen;
  });
}
export function showCellsLinkedTo(state: PageState, place: PlaceOfLink, reads: ReadsWithTextMeasurer): PageState {
  let unlit: PageState = {
    ...state,
    cellsLinkedTo: null,
  };
  if (!isViewFreeToFollow(stateWithoutPanesAndCalculation(unlit))) return unlit;
  let shown = showSheet(unlit, reads, place.sheetId);
  if (place.sheetId !== shown.sheetId) return shown;
  let areas = linkedAreasOfPlace(place, reads);
  let cells = selectionsOfLinkedAreas(areas, shown, reads);
  let [firstArea, firstCells] = [areas[0], cells[0]];
  if (firstArea === undefined || firstCells === undefined) return shown;
  let gone = goToCells(shown, reads, {
    ...firstArea,
    rowCount: 1,
    columnCount: 1,
  });
  return {
    ...showChangeByAgent(gone, reads, {
      cells: firstCells,
    }),
    cellsLinkedTo: {
      kind: 'lit',
      place,
      cells,
    },
    isFollowingAgent: false,
    followsOnOneSheet: 'no',
    hasPersonTakenViewBack: true,
    followed: null,
    shownByAgent: null,
    placementSelected: null,
  };
}
export function stepCellsLinkedTo(before: PageState, step: PageTransition, event: PageEvent, reads: ReadsWithTextMeasurer): PageState {
  let { state } = step;
  let { cellsLinkedTo: linked } = state;
  if (linked === null) return state;
  if (linked.kind === 'asked') return state.gridHeight === 0 ? state : showCellsLinkedTo(state, linked.place, reads);
  let isViewMovedByPerson = event.kind === 'wheelTurned' || event.kind === 'viewTakenBack';
  if (event.kind === 'agentActivityChanged' && event.isAsSpreadsheetOpens === true)
    return {
      ...state,
      isFollowingAgent: false,
      followsOnOneSheet: 'no',
    };
  if (
    (state.isAgentWorking && !before.isAgentWorking) ||
    (event.kind === 'keyPressed' && event.key !== 'F6') ||
    (!isViewMovedByPerson &&
      doesPersonTakeViewBack(
        before,
        {
          ...step,
          state: stateWithoutPanesAndCalculation(state),
        },
        event,
      )) ||
    state.sheetId !== before.sheetId ||
    linked.cells.every((cells) => cachedSelectedArea(cells, reads) === null) ||
    (event.kind !== 'gridResized' && state.movesOfViewByItself !== before.movesOfViewByItself)
  )
    return {
      ...state,
      cellsLinkedTo: null,
    };
  if (event.kind !== 'ownRowOrderSeen') return state;
  let cells = selectionsOfLinkedAreas(linkedAreasOfPlace(linked.place, reads), state, reads);
  return {
    ...state,
    cellsLinkedTo: {
      ...linked,
      cells,
    },
  };
}
export const MAX_SHOWN_REFERENCES = 64;
export const MAX_SHOWN_REFERENCE_LENGTH = 256;
export const shownReferenceText = (reference: unknown): string | null => {
  let text = typeof reference === 'number' ? `${reference}` : reference;
  return typeof text === 'string' && text !== '' && text.length <= MAX_SHOWN_REFERENCE_LENGTH ? text : null;
};
export const cellsShownByAgent = ({ shownByAgent }: Pick<PageState, 'shownByAgent'>): CellsChanged | null =>
  shownByAgent?.place?.kind === 'cells' ? shownByAgent.place.cells : null;
export const findSheetByIdNameOrNumber = (workbook: WorkbookReads, sheetKey: string): SheetSummary | undefined => {
  let sheets = workbook.listSheets();
  let lowerKey = sheetKey.toLowerCase();
  return (
    sheets.find(({ sheetId }) => sheetId === sheetKey) ??
    sheets.find(({ name }) => name.toLowerCase() === lowerKey) ??
    (/^\d+$/.test(sheetKey) ? sheets[Number(sheetKey) - 1] : undefined)
  );
};
export const keepsFollowingAgent = (state: PageState, shown: Pick<ViewShownByAgent, 'goesWithEdits'>): boolean =>
  state.isFollowingAgent || (shown.goesWithEdits && state.isAgentWorking && state.followed === null && isViewFreeToFollow(state));
export const MAX_LINKED_AREAS_AS_SEEN = 200;
export const stateWithoutPanesAndCalculation = (state: PageState): PageState => ({
  ...state,
  sidePane: isSidePaneShownAsPane(state) ? null : state.sidePane,
  isActShownAsCalculated: false,
});
export const selectionsOfLinkedAreas = (areas: CellArea[], state: Pick<PageState, 'sheetId'>, reads: WorkbookReads): CellSelection[] =>
  areas.flatMap((area) => selectionOfArea(state, reads, area) ?? []);
