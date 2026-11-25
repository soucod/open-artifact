import type {
  CellAt,
  CellBlock,
  CellTable,
  CellTableRead,
  CellsBetween,
  ConditionalFormatContents,
  Edit,
  EditQueuedAnswer,
  GroupContents,
  IdRun,
  PlaceChanged,
  PlacementContents,
  RangeCorners,
  ReadCellsToCopyInTheOrderOfTheirRowsRequest,
  ReadCellsToCopyRequest,
  RowId,
  RowsToLandIn,
  SessionRequest,
  SheetId,
  SheetLayoutAnswer,
  SheetLayoutContents,
  StepReversedAnswer,
  StretchOfADropdown,
  SyncState,
  TableInIds,
  TableWithColumns,
  WentAlong,
  EngineWorkbookContents,
} from '@open-artifact/sheets-core';
import type { SessionAnswerOf, SessionAnswers, WorkbookContentsWithBlocks } from '../engine/wasm-bindings.ts';
import type { LineIndex, LineSpan, OwnRowOrder, RowOrderSide } from '../model/line-ids.ts';
import type { SheetLayoutToRead } from '../model/workbook.ts';
import { spanOfIndexes } from '../model/a1-references.ts';
import {
  rowSpansIn,
  mergedSpans,
  wholeRowSpanIn,
  coveringRowSpanIn,
  rowStretchesIn,
  spanCutsOwnRowOrder,
  ownRowOrderFrom,
  createLineIndex,
} from '../model/line-ids.ts';
/** The first and last row of a run of rows, by id (either may be the upper one). */
export type RowEnds = readonly [RowId, RowId];
/** The own row order of a sheet, or `null` where its rows are seen as they are stored. */
export type OwnRowOrderLookup = (sheetId: SheetId) => OwnRowOrder | null;
/** Rows by their positions on the other side of an own row order, worked out from those on one side; `null`: none that will do. */
export type RowSpanIn = (side: RowOrderSide, order: OwnRowOrder, span: LineSpan) => LineSpan | null;
/** The rows a sheet was asked to be seen in, and its rows as they were stored when it was asked. */
interface RowOrderAsked {
  rows: readonly IdRun[];
  storedThen: LineIndex;
}
/** An answer of the session as it is turned to the order rows are seen in: a step taken back is read like an edit queued. */
type SessionAnswerToSee =
  | Exclude<SessionAnswerOf<SessionRequest>, StepReversedAnswer>
  | (StepReversedAnswer & Pick<EditQueuedAnswer, 'editsThatWentAlong'>);
/** The session with the rows of sheets seen in an order of their own. */
export interface OwnRowOrderSession extends SessionAnswers {
  seeRowsInOwnOrder(sheetId: SheetId, rows: readonly IdRun[] | null): void;
}
export function spanOfRowEnds(lineIndex: LineIndex, [oneRow, otherRow]: RowEnds): LineSpan | null {
  let [oneIndex, otherIndex] = [lineIndex.indexOf(oneRow), lineIndex.indexOf(otherRow)];
  return oneIndex === null || otherIndex === null ? null : spanOfIndexes([oneIndex, otherIndex]);
}
export function rowEndsIn(side: RowOrderSide, order: OwnRowOrder, ends: RowEnds, mapSpan: RowSpanIn): RowEnds {
  let span = spanOfRowEnds(order[otherRowOrderSide(side)], ends);
  return span === null ? ends : endRowsOfSpan(order[side], namedOrRefuse(mapSpan(side, order, span)));
}
export function rangesIn(side: RowOrderSide, order: OwnRowOrder, ranges: readonly RangeCorners[]): RangeCorners[] {
  let byColumns = new Map<string, { like: RangeCorners; rows: LineSpan[] }>();
  let untouched: RangeCorners[] = [];
  for (let range of ranges) {
    let span = spanOfRowEnds(order[otherRowOrderSide(side)], [range.topLeft.r, range.bottomRight.r]);
    if (span === null) {
      untouched.push(range);
      continue;
    }
    let columnsKey = `${range.topLeft.c} ${range.bottomRight.c}`;
    let group = byColumns.get(columnsKey) ?? {
      like: range,
      rows: [],
    };
    byColumns.set(columnsKey, {
      ...group,
      rows: group.rows.concat(rowSpansIn(side, order, span)),
    });
  }
  return [...byColumns.values()]
    .flatMap(
      ({ like, rows }) =>
        mergedSpans(rows).map((rowSpan) => withRowEnds(like, endRowsOfSpan(order[side], rowSpan))),
    )
    .concat(untouched);
}
export function rangesAsStoredOrRefuse(order: OwnRowOrder, ranges: readonly RangeCorners[]): RangeCorners[] {
  let stored = rangesIn('stored', order, ranges);
  return (refuseIf(stored.length > ranges.length), firstNamedOrRefuse(stored));
}
export function cornersAsStored(
  order: OwnRowOrder,
  { sheetId, oneCorner, otherCorner }: CellsBetween,
  mapSpan: RowSpanIn = wholeRowSpanIn,
): CellsBetween {
  let [oneRow, otherRow] = rowEndsIn('stored', order, [oneCorner.r, otherCorner.r], mapSpan);
  return {
    sheetId,
    oneCorner: { ...oneCorner, r: oneRow },
    otherCorner: { ...otherCorner, r: otherRow },
  };
}
export function tableBodyIn(side: RowOrderSide, order: OwnRowOrder, table: TableInIds): TableInIds {
  let bodyEnds: RowEnds = [table.firstRowOfBody, table.lastRowOfBody];
  let [firstRowOfBody, lastRowOfBody] = rowEndsIn(side, order, bodyEnds, coveringRowSpanIn);
  let runs = table.runs.flatMap((run) => {
    let span = spanOfRowEnds(order[otherRowOrderSide(side)], [run.firstRow, run.lastRow]);
    if (span === null) return [run];
    return rowSpansIn(side, order, span).map((rowSpan) => {
      let [firstRow, lastRow] = endRowsOfSpan(order[side], rowSpan);
      return { role: run.role, firstRow, lastRow };
    });
  });
  return {
    ...table,
    firstRowOfBody,
    lastRowOfBody,
    runs,
  };
}
export function refuseHeaderOrFooterInOwnOrder(order: OwnRowOrder, { headerRows, footerRows }: Pick<CellTable, 'headerRows' | 'footerRows'>): void {
  for (let rows of [headerRows, footerRows]) {
    let span = rows === null ? null : spanOfRowEnds(order.seen, [rows.firstRow, rows.lastRow]);
    refuseIf(span !== null && indexSpansOverlap(order, span));
  }
}
export function refuseRowsSplitWhenStored(order: OwnRowOrder, rows: readonly IdRun[]): void {
  let span = seenSpanOfRows(order, rows);
  refuseIf(span !== null && indexSpansOverlap(order, span) && rowStretchesIn('stored', order, span).length > 1);
}
export function mayLandInAsStored(order: OwnRowOrder, toRowId: RowId, mayLandIn: RowsToLandIn | undefined): IdRun[] {
  let firstIndex = namedOrRefuse(order.seen.indexOf(toRowId));
  let [firstStretch] = rowStretchesIn('stored', order, { firstIndex, count: order.seen.count - firstIndex });
  let landing = namedOrRefuse(firstStretch);
  let stretches = mayLandIn?.flatMap((rows) => order.stored.stretchesOf(rows)) ?? [landing];
  return firstNamedOrRefuse(
    stretches.flatMap((stretchOfRows) => {
      let first = Math.max(stretchOfRows.firstIndex, landing.firstIndex);
      let end = Math.min(stretchOfRows.firstIndex + stretchOfRows.count, landing.firstIndex + landing.count);
      return order.stored.runsIn({
        firstIndex: first,
        count: Math.max(0, end - first),
      });
    }),
  );
}
export function sheetOfFormatEdit(edit: Edit): SheetId | null {
  if (edit.kind === 'setBorders') return edit.cells.sheetId;
  if (edit.kind === 'fillCells') return edit.linesToFill.kind === 'rows' ? edit.source.sheetId : null;
  return 'selected' in edit ? edit.selected.sheetId : null;
}
export function editAsStored(edit: Edit, ownRowOrderOf: OwnRowOrderLookup): Edit {
  let inOrder = ifFoundElse(ownRowOrderOf);
  let checkedIn = (sheetId: SheetId, check: (order: OwnRowOrder) => void) =>
    inOrder(sheetId, edit, (order) => (check(order), edit));
  switch (edit.kind) {
    case 'moveCells':
      return (
        checkedIn(edit.cells.sheetId, (order) => refuseRowsSplitWhenStored(order, edit.cells.rows)),
        inOrder(
          edit.toSheetId,
          edit,
          (order) => ({
            ...edit,
            mayLandIn: mayLandInAsStored(order, edit.toTopLeft.r, edit.mayLandIn),
          }),
        )
      );
    case 'pasteValuesOfCells':
      return (refuseIf(ownRowOrderOf(edit.cells.sheetId) !== null || ownRowOrderOf(edit.toSheetId) !== null), edit);
    case 'importTableIntoSheet':
      return checkedIn(edit.table.sheetId, () => refuseIf(edit.table.how.kind !== 'addRows'));
    case 'mergeCells':
      return checkedIn(edit.cells.sheetId, (order) => {
        let span = seenSpanOfRows(order, edit.cells.rows);
        refuseIf(span !== null && span.count > 1 && indexSpansOverlap(order, span));
      });
    case 'hideRows':
      return checkedIn(edit.sheetId, (order) => {
        let span = seenSpanOfRows(order, edit.rows);
        refuseIf(span !== null && indexSpansOverlap(order, span));
      });
    case 'insertRows':
      return inOrder(edit.sheetId, edit, (order) => {
        let insertAt = edit.afterRow === null ? 0 : (order.seen.indexOf(edit.afterRow) ?? 0) + 1;
        if (insertAt > order.firstIndex && insertAt < order.firstIndex + order.count) return edit;
        let storedRowOf = (rowId: RowId | null | undefined) => (rowId === void 0 || rowId === null ? null : rowIdIn('stored', order, rowId));
        return {
          ...edit,
          afterRow: afterRowAsStored(order, edit.afterRow),
          formatsFromRow: storedRowOf(edit.formatsFromRow),
          groupsFromRow: storedRowOf(edit.groupsFromRow),
          formulasFromRow: storedRowOf(edit.formulasFromRow),
        };
      });
    case 'moveRows':
      return inOrder(edit.sheetId, edit, (order) => {
        let [oneRow, otherRow] = rowEndsIn('stored', order, [edit.oneRow, edit.otherRow], spanUnlessItCutsTheOrder);
        let moveTo = edit.afterRow === null ? 0 : (order.seen.indexOf(edit.afterRow) ?? 0) + 1;
        return (
          refuseIf(moveTo > order.firstIndex && moveTo < order.firstIndex + order.count),
          {
            ...edit,
            oneRow,
            otherRow,
            afterRow: afterRowAsStored(order, edit.afterRow),
          }
        );
      });
    case 'sortRows':
    case 'groupRows':
    case 'ungroupRows':
      return inOrder(edit.sheetId, edit, (order) => {
        let [oneRow, otherRow] = rowEndsIn('stored', order, [edit.oneRow, edit.otherRow], spanUnlessItCutsTheOrder);
        return { ...edit, oneRow, otherRow };
      });
    case 'sortCells':
    case 'moveColumnsOfCells':
      return inOrder(
        edit.cells.sheetId,
        edit,
        (order) => ({
          ...edit,
          cells: cornersAsStored(order, edit.cells, spanUnlessItCutsTheOrder),
        }),
      );
    case 'addConditionalFormats':
      return inOrder(
        edit.sheetId,
        edit,
        (order) => ({
          ...edit,
          rules: firstNamedOrRefuse(
            edit.rules.map(
              (rule) => ({
                ...rule,
                ranges: rangesAsStoredOrRefuse(order, rule.ranges),
              }),
            ),
          ),
        }),
      );
    case 'changeConditionalFormat': {
      let { ranges } = edit;
      return ranges === void 0
        ? edit
        : inOrder(
            edit.sheetId,
            edit,
            (order) => ({
              ...edit,
              ranges: rangesAsStoredOrRefuse(order, ranges),
            }),
          );
    }
    case 'addPlacedView': {
      let inputs = edit.inputs.map(
        (viewInput) =>
          inOrder(viewInput.range.sheetId, viewInput, (order) => {
            let { topLeft, bottomRight } = viewInput.range;
            let rowEnds = rowEndsIn('stored', order, [topLeft.r, bottomRight.r], wholeRowSpanIn);
            return {
              name: viewInput.name,
              range: { ...viewInput.range, ...withRowEnds(viewInput.range, rowEnds) },
            };
          }),
      );
      return inOrder(
        edit.sheetId,
        { ...edit, inputs },
        (order) => ({
          ...edit,
          inputs,
          topLeft: cellIn('stored', order, edit.topLeft),
        }),
      );
    }
    case 'movePlacedView':
    case 'resizePlacedView':
    case 'copyPlacedView':
      return inOrder(
        'toSheetId' in edit ? edit.toSheetId : edit.sheetId,
        edit,
        (order) => ({
          ...edit,
          topLeft: cellIn('stored', order, edit.topLeft),
        }),
      );
    case 'declareCellTable':
    case 'changeCellTable':
      return checkedIn(edit.sheetId, (order) => refuseHeaderOrFooterInOwnOrder(order, edit.cellTable));
    case 'setSheetSettings': {
      let { lastFrozenRow } = edit.settings;
      return lastFrozenRow === void 0 || lastFrozenRow === null
        ? edit
        : checkedIn(edit.sheetId, (order) => {
            let index = order.seen.indexOf(lastFrozenRow) ?? -1;
            refuseIf(indexSpansOverlap(order, { firstIndex: index, count: 1 }));
          });
    }
    case 'pasteRowsOfTexts':
    case 'pasteCopiedCells':
    case 'pasteValuesOfCopiedCells':
    case 'pasteCellsOfAnotherProgram':
    case 'fillCells':
    case 'setBorders':
    case 'enter':
    case 'addUserToCell':
    case 'removeUserFromCell':
    case 'setListLineChecked':
    case 'enterInCells':
    case 'enterTextWithLooksInCells':
    case 'pasteTexts':
    case 'clearCells':
    case 'unmergeCells':
    case 'formatCells':
    case 'setColumnWidths':
    case 'fitColumns':
    case 'setRowHeights':
    case 'insertColumns':
    case 'moveColumns':
    case 'deleteRows':
    case 'deleteColumns':
    case 'groupColumns':
    case 'ungroupColumns':
    case 'setRowGroupsCollapsed':
    case 'setColumnGroupsCollapsed':
    case 'showRowGroupsToDepth':
    case 'showColumnGroupsToDepth':
    case 'hideColumns':
    case 'moveConditionalFormat':
    case 'removeConditionalFormat':
    case 'deletePlacedView':
    case 'replaceWidgetNodeOfPlacedView':
    case 'removeCellTable':
    case 'insertPivotTable':
    case 'changePivotTable':
    case 'saveNamedView':
    case 'removeNamedView':
    case 'addSheet':
    case 'importTableAsNewSheet':
    case 'duplicateSheet':
    case 'deleteSheet':
    case 'moveSheet':
    case 'renameSheet':
    case 'reseed':
    case 'writeFromInteractive':
    case 'resetInteractive':
    case 'saveDefaultsOfInteractive':
    case 'setTimeZone':
    case 'setLocale':
    case 'makeDropdown':
    case 'addDropdownOption':
    case 'setDropdownOptions':
      return edit;
    default:
      throw new RowNotNamedInTheWayError();
  }
}
export function cellsToCopyInSeenOrder(
  order: OwnRowOrder,
  request: ReadCellsToCopyRequest,
): ReadCellsToCopyRequest | ReadCellsToCopyInTheOrderOfTheirRowsRequest {
  let { sheetId, oneCorner, otherCorner } = request.cells;
  let span = spanOfRowEnds(order.seen, [oneCorner.r, otherCorner.r]);
  if (span === null || rowStretchesIn('stored', order, span).length === 1) return request;
  let outOfView = (request.rowsOutOfView ?? []).flatMap((rows) => order.seen.stretchesOf(rows));
  let end = span.firstIndex + span.count;
  let rows: IdRun[] = [];
  let at = span.firstIndex;
  for (let { firstIndex, count } of [...mergedSpans(outOfView), { firstIndex: end, count: 0 }]) {
    let stop = Math.min(firstIndex, end);
    if (stop > at) for (let run of order.seen.runsIn({ firstIndex: at, count: stop - at })) rows.push(run);
    at = Math.max(at, firstIndex + count);
  }
  return {
    kind: 'readCellsToCopyInTheOrderOfTheirRows',
    cells: {
      sheetId,
      rows: firstNamedOrRefuse(rows),
      oneColumn: oneCorner.c,
      otherColumn: otherCorner.c,
    },
  };
}
export function requestAsStored(request: SessionRequest, ownRowOrderOf: OwnRowOrderLookup): SessionRequest {
  let inOrder = ifFoundElse(ownRowOrderOf);
  switch (request.kind) {
    case 'queueEdit': {
      let withEditAsStored = <Queued extends { edit: Edit }>(queued: Queued): Queued => ({
        ...queued,
        edit: editAsStored(queued.edit, ownRowOrderOf),
      });
      let { editsBefore, editsThatGoAlong } = request;
      let formatOrders = [...(editsBefore ?? []), request, ...(editsThatGoAlong ?? [])].flatMap(({ edit: queuedEdit }) => {
        let sheetId = sheetOfFormatEdit(queuedEdit);
        let order = sheetId === null ? null : ownRowOrderOf(sheetId);
        return sheetId === null || order === null ? [] : [{ sheetId, order }];
      });
      let [formatOrder] = formatOrders;
      return (
        refuseIf(formatOrders.some(({ sheetId }) => sheetId !== formatOrder?.sheetId)),
        {
          ...withEditAsStored(request),
          ...(formatOrder !== undefined && {
            ownRowOrder: {
              sheetId: formatOrder.sheetId,
              rows: firstNamedOrRefuse(formatOrder.order.seen.runsIn(formatOrder.order)),
            },
          }),
          ...(editsBefore !== undefined && {
            editsBefore: editsBefore.map(withEditAsStored),
          }),
          ...(editsThatGoAlong !== undefined && {
            editsThatGoAlong: editsThatGoAlong.map(withEditAsStored),
          }),
        }
      );
    }
    case 'readCellsToCopy':
      return inOrder(request.cells.sheetId, request, (order) => cellsToCopyInSeenOrder(order, request));
    case 'readConditionalFormatSuggestions':
    case 'readCellsThatADropdownWouldClear':
      return inOrder(
        request.cells.sheetId,
        request,
        (order) => ({
          ...request,
          cells: cornersAsStored(order, request.cells),
        }),
      );
    case 'readConditionalFormatsAsAgentIsTold':
      return inOrder(
        request.cells.sheetId,
        request,
        (order) => ({
          ...request,
          cells: cornersAsStored(order, request.cells, coveringRowSpanIn),
        }),
      );
    case 'readDropdownOptionsToOffer':
      return inOrder(
        request.sheetId,
        request,
        (order) => ({
          ...request,
          ...cornersAsStored(order, request, coveringRowSpanIn),
        }),
      );
    case 'readRowsInSortedOrder':
      return inOrder(request.sheetId, request, (order) => {
        let [oneRow, otherRow] = rowEndsIn('stored', order, [request.oneRow, request.otherRow], coveringRowSpanIn);
        return { ...request, oneRow, otherRow };
      });
    case 'readFilteredRows':
    case 'readValuesOfFilteredColumn':
      return inOrder(
        request.table.sheetId,
        request,
        (order) => ({
          ...request,
          table: tableBodyIn('stored', order, request.table),
        }),
      );
    case 'readCellTableDeclaredAs':
      return inOrder(request.sheetId, request, (order) => (refuseHeaderOrFooterInOwnOrder(order, request.cellTable), request));
    case 'readFormatsGiven': {
      let { asIf } = request;
      return asIf === void 0
        ? request
        : inOrder(
            request.sheetId,
            request,
            (order) => ({
              ...request,
              asIf: asIf.map((rule) => ruleWithRangesIn('stored', order, rule)),
            }),
          );
    }
    case 'readConditionalFormatsByAddress':
      return inOrder(
        request.sheetId,
        request,
        (order) => ({
          ...request,
          rules: request.rules.map((rule) => ruleWithRangesIn('stored', order, rule)),
        }),
      );
    case 'readTablesOfSheet':
      return request;
    case 'queueNextUndo':
    case 'queueNextRedo':
    case 'queueEditsThatTakeBack':
    case 'receiveStreamedEdit':
    case 'receiveSendOutcome':
    case 'receiveServerRevision':
    case 'receiveLoadPage':
    case 'receiveLinesOfLoad':
    case 'answerBeforeCalculating':
    case 'calculate':
    case 'receiveClockReading':
    case 'readWorkbook':
    case 'readCells':
    case 'readWorkbookWithCellsPacked':
    case 'readRowsWithCellsPacked':
    case 'readCauseOfError':
    case 'readSheetLayout':
    case 'readXlsxFile':
    case 'readTimeZone':
    case 'readViews':
    case 'readInputsOfView':
    case 'readTableAtCell':
    case 'readCellTables':
    case 'readCellTableAt':
    case 'readPivotTableAt':
    case 'readValuesToFilterPivotTableBy':
    case 'readConditionalFormatsInIds':
    case 'readProposedFormulaValue':
    case 'readWhatATableChanges':
    case 'readCellsOfTheDropdownAt':
    case 'readTypedFormula':
    case 'readTextToEdit':
    case 'readCellsToCopyInTheOrderOfTheirRows':
      return request;
    case 'readSharedCellFormat':
    default:
      throw new RowNotNamedInTheWayError();
  }
}
export function rowGroupAsSeen(order: OwnRowOrder, rowGroup: GroupContents): GroupContents {
  let [first, last] = rowEndsIn('seen', order, [rowGroup.ends.first, rowGroup.ends.last], coveringRowSpanIn);
  return { ...rowGroup, ends: { first, last } };
}
export function layoutInOwnRowOrder<Layout extends SheetLayoutToRead>(layout: Layout, order: OwnRowOrder | 'givenUp' | null): Layout {
  if (order === null) return layout;
  if (order === 'givenUp') return { ...layout, ownRowOrder: order };
  let { seen, firstIndex, count } = order;
  let { rowHeights, conditionalFormats, placements, rowGroups } = layout;
  return {
    ...layout,
    rows: [...seen.runsIn({ firstIndex: 0, count: seen.count })],
    ownRowOrder: {
      firstIndex,
      count,
      asStored: {
        rows: layout.rows,
        ...(rowHeights !== void 0 && { rowHeights }),
        ...(conditionalFormats !== void 0 && {
          conditionalFormats,
        }),
        ...(placements !== void 0 && { placements }),
        ...(rowGroups !== void 0 && { rowGroups }),
      },
    },
    ...(rowHeights !== void 0 && {
      rowHeights: rowHeights.flatMap(
        ({ rows, heightInPixels }) =>
          seen
            .stretchesOf(rows)
            .flatMap((stretch) => seen.runsIn(stretch))
            .map(
              (run) => ({
                rows: run,
                heightInPixels,
              }),
            ),
      ),
    }),
    ...(conditionalFormats !== void 0 && {
      conditionalFormats: conditionalFormats.map((conditionalFormat) => conditionalFormatAsSeen(order, conditionalFormat)),
    }),
    ...(placements !== void 0 && {
      placements: placements.map((placement) => placementAsSeen(order, placement)),
    }),
    ...(rowGroups !== void 0 && {
      rowGroups: rowGroups.map((rowGroup) => rowGroupAsSeen(order, rowGroup)),
    }),
  };
}
export function canKeepOwnRowOrder(order: OwnRowOrder, layout: SheetLayoutContents): boolean {
  let { mergedRanges = [], rowGroups = [], lastFrozenRow } = layout;
  let frozenIndex = lastFrozenRow === void 0 ? null : order.stored.indexOf(lastFrozenRow);
  return (
    (frozenIndex === null || !indexSpansOverlap(order, { firstIndex: frozenIndex, count: 1 })) &&
    mergedRanges.every(({ liveTopLeft, liveBottomRight }) => {
      let span = spanOfRowEnds(order.stored, [liveTopLeft.r, liveBottomRight.r]);
      return span === null || span.count === 1 || !indexSpansOverlap(order, span);
    }) &&
    rowGroups.every(({ ends }) => {
      let span = spanOfRowEnds(order.stored, [ends.first, ends.last]);
      return span === null || span.count === 1 || !spanCutsOwnRowOrder(order, span);
    })
  );
}
export function dropdownStretchAsSeen(order: OwnRowOrder, stretch: StretchOfADropdown): StretchOfADropdown[] {
  let span = spanOfRowEnds(order.stored, [stretch.top.r, stretch.bottom.r]);
  if (span === null) return [stretch];
  let seenStretches = spanCutsOwnRowOrder(order, span) ? rowStretchesIn('seen', order, span) : null;
  let columnLetters = /^[A-Z]+/.exec(stretch.range)?.[0] ?? '';
  return (seenStretches ?? [span]).map((seenSpan) => {
    let [topRow, bottomRow] = endRowsOfSpan(order.seen, seenSpan);
    let rowNumber = (order.stored.indexOf(topRow) ?? 0) + 1;
    let toEnd = seenSpan.count === 1 ? '' : `:${columnLetters}${rowNumber + seenSpan.count - 1}`;
    return {
      range: seenStretches === null ? stretch.range : `${columnLetters}${rowNumber}${toEnd}`,
      top: { ...stretch.top, r: topRow },
      bottom: { ...stretch.bottom, r: bottomRow },
    };
  });
}
export function answerAsSeen(
  request: SessionRequest,
  answer: SessionAnswerToSee,
  ownRowOrderOf: OwnRowOrderLookup,
): SessionAnswerOf<SessionRequest> | undefined {
  let inOrder = ifFoundElse(ownRowOrderOf);
  let placeAsSeen = (place: PlaceChanged | null, edit?: Edit): PlaceChanged | null => {
    let cells = place?.cells ?? null;
    if (place === null || cells === null) return place;
    return inOrder(place.sheetId, place, (order) => {
      if (edit !== undefined && sheetOfFormatEdit(edit) !== null)
        return (order.seen.indexOf(cells.topLeft.r) ?? 0) > (order.seen.indexOf(cells.bottomRight.r) ?? 1 / 0)
          ? {
              ...place,
              cells: withRowEnds(cells, [cells.bottomRight.r, cells.topLeft.r]),
            }
          : place;
      let picked = edit === undefined ? null : rowsOfEditCells(edit);
      let stretches = mergedSpans(picked?.rows.flatMap((rows) => order.stored.stretchesOf(rows)) ?? []);
      let [firstStretch, lastStretch] = [stretches[0], stretches.at(-1)];
      let pickedSpan =
        firstStretch !== undefined &&
        lastStretch !== undefined &&
        endRowsOfSpan(order.stored, firstStretch)[0] === cells.topLeft.r &&
        endRowsOfSpan(order.stored, lastStretch)[1] === cells.bottomRight.r
          ? seenSpanOfRows(order, picked?.rows ?? [])
          : null;
      return {
        ...place,
        cells: pickedSpan === null ? rangeAsSeen(order, cells) : withRowEnds(cells, endRowsOfSpan(order.seen, pickedSpan)),
      };
    });
  };
  let syncStateAsSeen = <State extends SyncState>(syncState: State): State => ({
    ...syncState,
    ...(syncState.editsOfOthers !== void 0 && {
      editsOfOthers: syncState.editsOfOthers.map(
        (editOfOther) => ({
          ...editOfOther,
          placeChanged: placeAsSeen(editOfOther.placeChanged),
        }),
      ),
    }),
  });
  if (answer.kind === 'syncState') return syncStateAsSeen(answer);
  if (answer.kind === 'editQueued') {
    let queued = request.kind === 'queueEdit' ? request : null;
    let placeChanged = placeAsSeen(answer.placeChanged, queued?.edit);
    let { placesChangedBefore, editsThatWentAlong } = answer;
    let pointedEditsBefore = queued?.editsBefore?.filter(({ isPointedAt }) => isPointedAt) ?? [];
    let editsBeforeOfPlaces = pointedEditsBefore.length === placesChangedBefore?.length ? pointedEditsBefore : [];
    return {
      ...answer,
      placeChanged,
      ...(placesChangedBefore !== undefined && {
        placesChangedBefore: placesChangedBefore.map((place, index) => placeAsSeen(place, editsBeforeOfPlaces[index]?.edit) ?? place),
      }),
      ...(editsThatWentAlong !== undefined && {
        editsThatWentAlong: editsThatWentAlong.map(
          (wentAlong, index): WentAlong =>
            wentAlong.kind === 'made'
              ? {
                  kind: 'made',
                  placeChanged: placeAsSeen(wentAlong.placeChanged, queued?.editsThatGoAlong?.[index]?.edit),
                }
              : wentAlong,
        ),
      }),
      syncState: syncStateAsSeen(answer.syncState),
    };
  }
  let asked = 'cells' in request && 'sheetId' in request.cells ? request.cells : 'table' in request ? request.table : request;
  let order = 'sheetId' in asked ? ownRowOrderOf(asked.sheetId) : null;
  if (order === null) return answer;
  switch (answer.kind) {
    case 'formatsGiven':
      return {
        ...answer,
        colorScales: answer.colorScales.map(
          ({ ranges, stops }) => ({
            ranges: rangesIn('seen', order, ranges),
            stops,
          }),
        ),
      };
    case 'table':
      return { ...answer, read: tableReadIn('seen', order, answer.read) };
    case 'cellTableAt':
      return {
        ...answer,
        cellTable: answer.cellTable === null ? null : cellTableIn('seen', order, answer.cellTable),
      };
    case 'cellTables':
      return {
        ...answer,
        cellTables: answer.cellTables.map((cellTable) => cellTableIn('seen', order, cellTable)),
      };
    case 'filteredRows': {
      let bodyEnds: RowEnds = [answer.firstRowOfBody, answer.lastRowOfBody];
      let [firstRowOfBody, lastRowOfBody] = rowEndsIn('seen', order, bodyEnds, coveringRowSpanIn);
      let cellsBesideTheTableOutOfView = answer.cellsBesideTheTableOutOfView.map((range) => rangeAsSeen(order, range));
      return {
        ...answer,
        firstRowOfBody,
        lastRowOfBody,
        cellsBesideTheTableOutOfView,
      };
    }
    case 'conditionalFormatSuggestions':
      return {
        ...answer,
        about: rangeAsSeen(order, answer.about),
        ruleToStartFrom: ruleWithRangesIn('seen', order, answer.ruleToStartFrom),
        suggestions: answer.suggestions.map(
          ({ rules, matches }) => ({
            rules: firstNamedOrRefuse(rules.map((rule) => ruleWithRangesIn('seen', order, rule))),
            matches,
          }),
        ),
        table: {
          ...answer.table,
          cells: rangeAsSeen(order, answer.table.cells),
          records: rangeAsSeen(order, answer.table.records),
        },
      };
    case 'conditionalFormatsInIds': {
      let { read } = answer;
      return read.kind !== 'rules'
        ? answer
        : {
            ...answer,
            read: {
              ...read,
              rules: read.rules.map((rule) => ruleWithRangesIn('seen', order, rule)),
            },
          };
    }
    case 'cellsOfDropdown': {
      let stretchesBySource = answer.stretches.map((stretch) => dropdownStretchAsSeen(order, stretch));
      let stretches = stretchesBySource.flat();
      let cellIndex = 'cell' in request ? order.seen.indexOf(request.cell.r) : null;
      let stretchWithTheCell = stretchesBySource[answer.indexOfTheStretchWithTheCell]?.find(
        ({ top, bottom }: StretchOfADropdown) => {
          let span = spanOfRowEnds(order.seen, [top.r, bottom.r]);
          return span !== null && cellIndex !== null && indexSpansOverlap(span, { firstIndex: cellIndex, count: 1 });
        },
      );
      let indexOfTheStretchWithTheCell = Math.max(0, stretchWithTheCell === void 0 ? 0 : stretches.indexOf(stretchWithTheCell));
      return {
        ...answer,
        stretches,
        indexOfTheStretchWithTheCell,
      };
    }
    case 'nothingToChange':
    case 'toBeShownFirst':
    case 'editBeforeRefused':
    case 'nothingToReverse':
    case 'stepGivenUp':
    case 'workbookContents':
    case 'cellsContents':
    case 'workbookContentsWithCellsPacked':
    case 'rowsWithCellsPacked':
    case 'sheetLayout':
    case 'xlsxFile':
    case 'views':
    case 'inputsOfView':
    case 'tablesOfSheet':
    case 'pivotTableAt':
    case 'conditionalFormatsByAddress':
    case 'conditionalFormatsAsAgentIsTold':
    case 'valuesOfFilteredColumn':
    case 'rowsInSortedOrder':
    case 'typedFormula':
    case 'causeOfError':
    case 'proposedFormulaValue':
    case 'textToEdit':
    case 'cellsToCopy':
    case 'dropdownOptionsToOffer':
    case 'cellsThatADropdownWouldClear':
    case 'sharedCellFormat':
    case 'whatATableChanges':
    case 'timeZone':
    case 'refused':
      return answer;
  }
}
export function createOwnRowOrderSession(session: SessionAnswers): OwnRowOrderSession {
  let askedOrders = new Map<SheetId, RowOrderAsked>();
  let ordersBySheet = new Map<SheetId, OwnRowOrder | 'givenUp' | null>();
  let orderOfLayout = (layout: SheetLayoutContents): OwnRowOrder | 'givenUp' | null => {
    let asked = askedOrders.get(layout.sheetId);
    if (asked === void 0) return null;
    let known = ordersBySheet.get(layout.sheetId);
    if (known !== void 0) return known;
    let order = ownRowOrderFrom(createLineIndex(layout.rows), asked.rows, asked.storedThen);
    let isKept = order === null || order === 'givenUp' || canKeepOwnRowOrder(order, layout);
    return (ordersBySheet.set(layout.sheetId, isKept ? order : 'givenUp'), isKept ? order : 'givenUp');
  };
  let readLayout = (sheetId: SheetId): SheetLayoutAnswer | null => {
    let answer = session.answer({
      kind: 'readSheetLayout',
      sheetId,
    });
    return answer.kind === 'sheetLayout' ? answer : null;
  };
  let ownRowOrderOf = (sheetId: SheetId): OwnRowOrder | null => {
    if (!askedOrders.has(sheetId)) return null;
    let layout = ordersBySheet.has(sheetId) ? null : readLayout(sheetId);
    let order = layout === null ? ordersBySheet.get(sheetId) : orderOfLayout(layout);
    return order === void 0 || order === 'givenUp' ? null : order;
  };
  let syncStateNotingLayouts = <State extends SyncState>(syncState: State): State => {
    let { changes }: SyncState = syncState;
    if (changes.kind === 'nothing') return syncState;
    if (changes.kind !== 'inSheets') return (ordersBySheet.clear(), syncState);
    let sheets = changes.sheets.map((sheet) => {
      if (!sheet.isLayoutChanged || !askedOrders.has(sheet.sheetId)) return sheet;
      return (ordersBySheet.delete(sheet.sheetId), Object.assign({}, sheet, { areFormatsGivenChanged: true }));
    });
    return { ...syncState, changes: { ...changes, sheets } };
  };
  let keepInsertedRowsInOrder = (edit: Edit, order: OwnRowOrder | null): void => {
    if (edit.kind !== 'insertRows' || edit.afterRow === null || order === null) return;
    let layout = readLayout(edit.sheetId);
    let end = order.firstIndex + order.count;
    let insertAt = (order.seen.indexOf(edit.afterRow) ?? end) + 1;
    if (layout === null || insertAt >= end) return;
    if (order.stored.indexOf(edit.afterRow) !== end - 1) return;
    let rows = [
      ...order.seen.runsIn({
        firstIndex: order.firstIndex,
        count: insertAt - order.firstIndex,
      }),
      ...createLineIndex(layout.rows).runsIn({
        firstIndex: end,
        count: edit.count,
      }),
      ...order.seen.runsIn({ firstIndex: insertAt, count: end - insertAt }),
    ];
    askedOrders.set(edit.sheetId, { rows, storedThen: order.stored });
  };
  let workbookInOwnRowOrder = <Contents extends EngineWorkbookContents | WorkbookContentsWithBlocks>(contents: Contents) => (
    ordersBySheet.clear(),
    {
      ...contents,
      sheets: contents.sheets.map((layout: SheetLayoutContents) => layoutInOwnRowOrder(layout, orderOfLayout(layout))),
    }
  );
  return {
    seeRowsInOwnOrder(sheetId: SheetId, rows: readonly IdRun[] | null) {
      ordersBySheet.delete(sheetId);
      let layout = rows === null ? null : readLayout(sheetId);
      if (rows === null || layout === null) askedOrders.delete(sheetId);
      else
        askedOrders.set(sheetId, {
          rows,
          storedThen: createLineIndex(layout.rows),
        });
    },
    answer<R extends SessionRequest>(request: R): SessionAnswerOf<R> {
      if (askedOrders.size === 0) return session.answer(request);
      let storedRequest: SessionRequest;
      try {
        storedRequest = requestAsStored(request, ownRowOrderOf);
      } catch (error) {
        if (!(error instanceof RowNotNamedInTheWayError)) throw error;
        return { kind: 'refused', refusal: 'rowNotNamedInTheWay' } as SessionAnswerOf<R>;
      }
      let edit = request.kind === 'queueEdit' ? request.edit : null;
      let orderBeforeInsert = edit?.kind === 'insertRows' ? ownRowOrderOf(edit.sheetId) : null;
      let answer = session.answer(storedRequest);
      if (answer.kind === 'workbookContents') return workbookInOwnRowOrder(answer) as SessionAnswerOf<R>;
      if (answer.kind === 'workbookContentsWithCellsPacked') return workbookInOwnRowOrder(answer) as SessionAnswerOf<R>;
      if (answer.kind === 'sheetLayout') return layoutInOwnRowOrder(answer, orderOfLayout(answer)) as SessionAnswerOf<R>;
      if (answer.kind === 'syncState') return answerAsSeen(request, syncStateNotingLayouts(answer), ownRowOrderOf) as SessionAnswerOf<R>;
      if (answer.kind === 'editQueued') {
        if (edit !== null) keepInsertedRowsInOrder(edit, orderBeforeInsert);
        let syncState = syncStateNotingLayouts(answer.syncState);
        return answerAsSeen(request, { ...answer, syncState }, ownRowOrderOf) as SessionAnswerOf<R>;
      }
      return answerAsSeen(request, answer, ownRowOrderOf) as SessionAnswerOf<R>;
    },
  };
}
export const RowNotNamedInTheWayError = class extends Error {};
export const namedOrRefuse = <T>(value: T | null | undefined): T => {
  if (value === null || value === void 0) throw new RowNotNamedInTheWayError();
  return value;
};
export const refuseIf = (isRefused: boolean): void => {
  if (isRefused) throw new RowNotNamedInTheWayError();
};
export const firstNamedOrRefuse = <T>([first, ...rest]: readonly T[]): T[] => [namedOrRefuse(first), ...rest];
export const otherRowOrderSide = (side: RowOrderSide): RowOrderSide => (side === 'seen' ? 'stored' : 'seen');
export const endRowsOfSpan = (lineIndex: LineIndex, { firstIndex, count }: LineSpan): [RowId, RowId] => [
  namedOrRefuse(lineIndex.idAt(firstIndex)),
  namedOrRefuse(lineIndex.idAt(firstIndex + count - 1)),
];
export const spanUnlessItCutsTheOrder = (side: RowOrderSide, order: OwnRowOrder, span: LineSpan): LineSpan | null =>
  spanCutsOwnRowOrder(order, span) ? null : span;
export const withRowEnds = ({ topLeft, bottomRight }: RangeCorners, [topRow, bottomRow]: RowEnds): RangeCorners => ({
  topLeft: { ...topLeft, r: topRow },
  bottomRight: { ...bottomRight, r: bottomRow },
});
export const rangeAsSeen = (order: OwnRowOrder, range: RangeCorners): RangeCorners =>
  withRowEnds(range, rowEndsIn('seen', order, [range.topLeft.r, range.bottomRight.r], coveringRowSpanIn));
export const ruleWithRangesIn = <Rule extends { ranges: RangeCorners[] }>(side: RowOrderSide, order: OwnRowOrder, rule: Rule): Rule => ({
  ...rule,
  ranges: firstNamedOrRefuse(rangesIn(side, order, rule.ranges)),
});
export const tableReadIn = (side: RowOrderSide, order: OwnRowOrder, read: TableWithColumns | null): TableWithColumns | null =>
  read === null ? null : { ...read, table: tableBodyIn(side, order, read.table) };
export const cellTableIn = (side: RowOrderSide, order: OwnRowOrder, cellTable: CellTableRead): CellTableRead => ({
  ...cellTable,
  table: tableReadIn(side, order, cellTable.table),
});
export const indexSpansOverlap = (oneSpan: LineSpan, otherSpan: LineSpan): boolean =>
  oneSpan.firstIndex < otherSpan.firstIndex + otherSpan.count && otherSpan.firstIndex < oneSpan.firstIndex + oneSpan.count;
export const rowIdIn = (side: RowOrderSide, order: OwnRowOrder, rowId: RowId): RowId =>
  order[side].idAt(order[otherRowOrderSide(side)].indexOf(rowId) ?? -1) ?? rowId;
export const cellIn = (side: RowOrderSide, order: OwnRowOrder, cell: CellAt): CellAt => ({
  ...cell,
  r: rowIdIn(side, order, cell.r),
});
export const afterRowAsStored = (order: OwnRowOrder, afterRow: RowId | null): RowId | null =>
  afterRow !== null && order.seen.indexOf(afterRow) === order.firstIndex + order.count - 1 ? rowIdIn('stored', order, afterRow) : afterRow;
export const seenSpanOfRows = (order: OwnRowOrder, rows: readonly IdRun[]): LineSpan | null => {
  let stretches = mergedSpans(rows.flatMap((run) => order.seen.stretchesOf(run)));
  let [first, last] = [stretches[0], stretches.at(-1)];
  return first === void 0 || last === void 0 ? null : spanOfIndexes([first.firstIndex, last.firstIndex + last.count - 1]);
};
export const ifFoundElse =
  <Key, Found>(find: (key: Key) => Found | null) =>
  <T>(key: Key, fallback: T, withFound: (found: Found) => T): T => {
    let found = find(key);
    return found === null ? fallback : withFound(found);
  };
export const conditionalFormatAsSeen = (order: OwnRowOrder, conditionalFormat: ConditionalFormatContents): ConditionalFormatContents => ({
  ...ruleWithRangesIn('seen', order, conditionalFormat),
  liveRanges: rangesIn('seen', order, conditionalFormat.liveRanges),
});
export const placementAsSeen = (order: OwnRowOrder, placement: PlacementContents): PlacementContents => ({
  ...placement,
  liveTopLeft: cellIn('seen', order, placement.liveTopLeft),
});
export const rowsOfEditCells = (edit: Edit): CellBlock | null => {
  let cells = 'cells' in edit ? edit.cells : null;
  return cells !== null && 'rows' in cells ? cells : null;
};
export const rowEndsAsSeen = (order: OwnRowOrder, ends: RowEnds): RowEnds => rowEndsIn('seen', order, ends, coveringRowSpanIn);
