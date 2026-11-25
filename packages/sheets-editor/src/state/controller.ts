import { createStore, type StoreApi } from 'zustand/vanilla';
import type { CellsToCopyAnswer, CopiedValues, IdRun, ReadXlsxFileRequest, SheetId, TextToPaste, XlsxFileAnswer } from '@open-artifact/sheets-core';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { WholeCellFormat } from '../model/cell-format.ts';
import type { CellArea, CellPosition } from '../selection/model.ts';
import type { LineSpan } from '../model/line-ids.ts';
import type { PageState, ScrollsForLessRoom } from './initial-state.ts';
import type { ChartCardOpening, WhyNothingToChart } from '../selection/table-select.ts';
import type { EditsDropped } from '../store/workbook-sync.ts';
import type { ChartNodesCopiedFor, OwnFiltersBroughtBack, PageEvent } from './event-reducer.ts';
import type { OwnViewShownAsApplied } from '../tables/filter-messages.ts';
import type { PageEffect, PageTransition } from './transitions.ts';
import type { CauseOfWorkbookChange, OpenedWorkbook } from '../engine/worker-workbook.ts';
import type { askToDescribeChartsForXlsx, ChartsForXlsx } from '../export/xlsx-chart-descriptions.ts';
import type { AgentSampler, createAgentSampler } from '../agent/sampling.ts';
import type { ColorPickerChoices, PageView, ViewOnlyBecause } from '../view/page-view.ts';
import { findSheetById, layoutOfView } from '../grid/layout.ts';
import { fullShownTextOfCell, numberFormatOfCell, readsAsStored } from '../model/workbook.ts';
import { fullDateBehindMonthDayTime, cellTextToCopy, copiedDateMissesDay } from '../clipboard/text-escaping.ts';
import { HTML_BORDERED_STYLE_ATTRIBUTE, htmlCellAttributesOf } from '../clipboard/html-writing.ts';
import { clipboardContentOf, EMPTY_CLIPBOARD_CONTENT } from '../clipboard/formats.ts';
import { formulaResultAsTypedText, cellTextAsTyped, cellValueOf } from '../model/cell-values.ts';
import { cellTextLinks } from '../links/text-links.ts';
import { drawnFormatsOf } from '../format/conditional/drawn-looks.ts';
import { shownHorizontalAlignment } from '../format/toolbar-choices.ts';
import { textColorNameOf } from '../grid/view-boxes.ts';
import { lowerBoundIndex, ownRowOrderOfSheet } from '../model/line-ids.ts';
import { createViewGlide } from '../grid/view-glide.ts';
import { chartEditOutcome } from '../charts/chart-edits.ts';
import { hideWordsOffered } from '../editor/words-offered.ts';
import { selectionToQueue, isSelectionLostByAnswer } from './edit-answers.ts';
import { actThatMayLoseFormulas } from '../formulas/lost-formulas.ts';
import { isCellHistoryAwaiting } from '../history/cell-history.ts';
import { isEffectAnEdit } from './edit-refusals.ts';
import { isEntryUnchanged } from '../editor/commit-entry.ts';
import { peopleListOffersAgent, selectionForAskingAgent } from '../chips/people-list.ts';
import { hasUnsavedDropdownEdits } from '../chips/dropdown-pane-edits.ts';
import { hasRulesPaneWorkInProgress, hasRulesPaneRefusedRules } from '../format/conditional/pane-reducer.ts';
import { isWorkbookSettingChanged } from '../ui/locale-time-zone-pick.ts';
import { maxScrollWithFloats, clampBetween, cellsAreaWidth, cellsAreaHeight } from '../grid/geometry.ts';
import { isViewFreeToFollow } from '../agent/follow-agent.ts';
import { viewForLateMessage, stampWhatPointerWasOver } from '../selection/pointer.ts';
import { reduceSheetsPage } from './page-reducer.ts';
import { doesEntryEndAtOnce } from '../editor/entries-answered-later.ts';
import { hasRowsAskEndedWhereBegun, ownFiltersBeforeRowsTry } from '../tables/rows-asked-for.ts';
import { wasOwnFilterTryUndone, ownFiltersBeforeTry } from '../tables/own-filter-tries.ts';
import { explainErrorCellsAhead, errorsToTellOfSelection } from '../formulas/errors-to-tell.ts';
import { isSameCell, selectedArea } from '../selection/model.ts';
import { pageViewOf, colorPickerChoicesOf } from '../view/page-view.ts';
import { listPaletteSwatches } from '../format/cell-colors.ts';
import { xlsxFileName } from '../export/file-names.ts';
import { makeAskForCommands } from '../ui/ask-for-commands.ts';
import { areasOfAllRanges } from '../selection/several-ranges.ts';
import { exampleOfChoice } from '../format/number-format-choices.ts';
import { presenceFlagsAtPointer } from '../presence/flags-at-pointer.ts';
import type { RoomPresence } from '../presence/room.ts';
import type { WrappedTextPart } from '../grid/wrapped-rows.ts';
import { errorCountInArea } from '../formulas/fix/errors-offer.ts';
import { areaToChart, whyNothingToChart, areTablesForChartPending, whatChartCardOpensOn } from '../selection/table-select.ts';
import { placeChartForArea } from '../charts/placement.ts';
import { heldAreaOf, sampleOfAreaForChart, areaOfHeld } from '../charts/cells-held.ts';
import { CHART_ASK_FIRST_ROWS, CHART_ASK_MAX_COLUMNS } from '../charts/chart-code-ask.ts';
import { goBackToWords } from '../formulas/from-words/actions.ts';
import { csvFileOfSheet } from '../export/csv.ts';
import { chartsOfWorkbookForXlsx, describeChartsForXlsx } from '../export/xlsx-chart-descriptions.ts';
import { selectionLinesFingerprint } from './places.ts';
import { scrolledForLessRoomToKeep } from '../selection/keep-in-view.ts';
import { ownFiltersWithoutKey, ownFilterKeyNotDrawnYet } from '../tables/own-filters.ts';
import { linesOnShowOf } from '../grid/cards-place.ts';
import { showSheetPointedIn } from '../formulas/sheet-pointed-in.ts';
import { isKeyWritingInEntry } from '../keys/key-acts.ts';
import { pivotTypingToEnter } from '../tables/pivot-tables.ts';
import { withPivotTablesOutOfDate } from './pivot-tables-out-of-date.ts';
export function throwCollectedErrors(errors: readonly unknown[]): void {
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw AggregateError(errors, 'more than one error in one dispatch');
}
export function valuesOfCopiedCellsAnswer({ values, copiedCellsAsText }: CellsToCopyAnswer): ValuesOfCopiedCells | null {
  if (values.kind === 'notWritten') return null;
  if ((values.kind as string) !== 'written' && copiedCellsAsText === null) return null;
  return {
    copiedCellsAsAnswered: copiedCellsAsText,
    values,
  };
}
export function trimAreaToUsedCells(reads: WorkbookReads, sheetId: SheetId, area: CellArea): CellArea {
  let sheet = findSheetById(reads, sheetId);
  let reachesLastRow = area.topRowIndex + area.rowCount === sheet?.rowCount;
  let reachesLastColumn = area.leftColumnIndex + area.columnCount === sheet?.columnCount;
  if (!reachesLastRow && !reachesLastColumn) return area;
  let shownArea = reads.areaOnShowIn(sheetId, area);
  let rowCount = shownArea === null ? 1 : shownArea.topRowIndex + shownArea.rowCount - area.topRowIndex;
  let columnCount = shownArea === null ? 1 : shownArea.leftColumnIndex + shownArea.columnCount - area.leftColumnIndex;
  return {
    ...area,
    rowCount: reachesLastRow ? rowCount : area.rowCount,
    columnCount: reachesLastColumn ? columnCount : area.columnCount,
  };
}
export function copyCornersForEffect(reads: WorkbookReads, { sheetId, area, rowsLeftOut }: AreaToCopy): CopyCorners | null {
  let [topLeft, bottomRight] = cornerCellsOfArea(reads, {
    sheetId,
    area,
  });
  let rowLines = reads.linesOf(sheetId)?.rows;
  if (topLeft === null || bottomRight === null || rowLines === undefined) return null;
  return [topLeft, bottomRight, rowsLeftOut.flatMap((run) => rowLines.runsIn(run))];
}
export function buildClipboardContentForCopy(
  reads: WorkbookReads,
  { sheetId, area, rowsLeftOut }: AreaToCopy,
  corners: CopyCorners | null,
  trimToContent: boolean,
): ClipboardContent {
  let cellsToCopy = corners === null ? null : reads.cellsToCopy(...corners);
  let { rowCount, columnCount } = cellsToCopy ?? trimAreaToUsedCells(reads, sheetId, area);
  let rowIndexesLeftOut = indexesOfRuns(rowsLeftOut);
  let rowIndexes: number[] = [];
  let isRowInCopy = (rowIndex: number) =>
    cellsToCopy === null ? rowIndex < area.topRowIndex + rowCount : rowIndexes.length < rowCount && rowIndex < area.topRowIndex + area.rowCount;
  for (let topRowIndex = area.topRowIndex; isRowInCopy(topRowIndex); topRowIndex += 1)
    if (!rowIndexesLeftOut.has(topRowIndex)) rowIndexes.push(topRowIndex);
  let rowsRanOut = cellsToCopy === null && rowIndexes.length < rowCount;
  let cellIdForCopy = (rowIndex: number, columnIndex: number) => {
    let mergedArea =
      rowIndexesLeftOut.size === 0
        ? null
        : reads.mergedAreaAt(sheetId, {
            rowIndex,
            columnIndex,
          });
    if (mergedArea === null || mergedArea.leftColumnIndex !== columnIndex) return reads.cellIdAt(sheetId, rowIndex, columnIndex);
    for (let aboveRowIndex = mergedArea.topRowIndex; aboveRowIndex < rowIndex; aboveRowIndex += 1)
      if (!rowIndexesLeftOut.has(aboveRowIndex)) return reads.cellIdAt(sheetId, rowIndex, columnIndex);
    return reads.cellIdAt(sheetId, mergedArea.topRowIndex, columnIndex);
  };
  let cellIdRows = rowIndexes.map(
    (rowIndex) =>
      Array.from<unknown, CellId | null>(
        {
          length: columnCount,
        },
        (unused, columnOffset) => cellIdForCopy(rowIndex, area.leftColumnIndex + columnOffset),
      ),
  );
  let answeredCells: TextToPaste[] = [];
  for (let answeredCell of cellsToCopy?.cells ?? []) answeredCells[answeredCell.row * columnCount + answeredCell.column] = answeredCell;
  let mapCells = <Text,>(textOf: (cellId: CellId, answeredCell: TextToPaste | null) => Text) =>
    cellIdRows.map(
      (cellIds, rowOffset) =>
        cellIds.map((cellId, columnOffset) => {
          if (cellId === null) return '';
          if (cellsToCopy === null) return textOf(cellId, null);
          let answeredCell = answeredCells[rowOffset * columnCount + columnOffset];
          return answeredCell === undefined ? '' : textOf(cellId, answeredCell);
        }),
    );
  let shownTextOfCell = (cellId: CellId, answeredCell: TextToPaste | null) =>
    answeredCell === null ? fullShownTextOfCell(reads, cellId) : (answeredCell.textShown ?? null);
  let patternCache = new Map<CellId, string>();
  let patternOf = (cellId: CellId) =>
    fullDateBehindMonthDayTime(reads.cellOnShowIn(cellId), () => {
      let pattern = patternCache.get(cellId) ?? numberFormatOfCell(reads, cellId).pattern;
      patternCache.set(cellId, pattern);
      return pattern;
    });
  let shownTexts: string[][] = mapCells(
    (cellId, answeredCell) =>
      cellTextToCopy(reads.cellOnShowIn(cellId), patternOf(cellId) ?? shownTextOfCell(cellId, answeredCell), reads.decimalSign),
  );
  let hasNumbersNotShownWhole =
    cellsToCopy?.cells.some(({ isNumberShownWhole }) => isNumberShownWhole === false) === true;
  let cellsTakenAsDates: CellPosition[] = [];
  let exactTexts = !hasNumbersNotShownWhole
    ? shownTexts
    : cellIdRows.map(
        (cellIds, rowOffset) =>
          cellIds.map((cellId, columnOffset) => {
            let shownText = shownTexts[rowOffset]?.[columnOffset] ?? '';
            if (
              !(cellId !== null && answeredCells[rowOffset * columnCount + columnOffset]?.isNumberShownWhole === false && patternOf(cellId) === null)
            )
              return shownText;
            let cell = reads.cellOnShowIn(cellId);
            if (copiedDateMissesDay(cell, shownText, reads.dayTypedAs))
              cellsTakenAsDates.push({
                rowIndex: rowOffset,
                columnIndex: columnOffset,
              });
            return cellTextToCopy(cell, null, reads.decimalSign);
          }),
      );
  let trimmedSize = trimToContent ? trimmedCopySize(reads, sheetId, area, shownTexts) : null;
  let trimmedTexts = shownTexts.slice(0, trimmedSize?.rowCount).map((texts) => texts.slice(0, trimmedSize?.columnCount));
  let cellLooks = () => {
    if (trimmedSize === null || (trimmedTexts.length === 1 && trimmedTexts[0]?.length === 1)) return null;
    let areGridlinesHidden = findSheetById(reads, sheetId)?.areGridlinesHidden === true;
    let trimmedColumnCount = trimmedTexts[0]?.length ?? 0;
    if (trimmedTexts.length * trimmedColumnCount > MAX_COPY_HTML_LOOK_CELLS)
      return trimmedTexts.map((texts) => texts.map(() => (areGridlinesHidden ? '' : HTML_BORDERED_STYLE_ATTRIBUTE)));
    return copiedCellLooksTable(reads, sheetId, rowIndexes.slice(0, trimmedTexts.length), area.leftColumnIndex, trimmedColumnCount, areGridlinesHidden);
  };
  let areFormulasLeftOut =
    cellsToCopy?.cells.some(({ row, column, textToPaste }) => {
      let cellId = cellIdRows[row]?.[column] ?? null;
      return cellId !== null && reads.cellOf(cellId)?.input.kind === 'formula' && !textToPaste.startsWith('=');
    }) === true;
  let content = clipboardContentOf(
    cellsToCopy?.copiedCellsAsText ?? null,
    cellsToCopy === null ? null : valuesOfCopiedCellsAnswer(cellsToCopy),
    cellsToCopy?.localeOfTexts ?? reads.locale,
    mapCells((cellId, answeredCell) => {
      if (answeredCell !== null) return answeredCell.textToPaste;
      let cell = reads.cellOnShowIn(cellId);
      return (rowsRanOut ? formulaResultAsTypedText(cell, reads.decimalSign) : null) ?? cellTextAsTyped(cell, reads.decimalSign);
    }),
    shownTexts,
    trimmedTexts,
    cellLooks(),
    exactTexts,
    cellsTakenAsDates,
    cellIdRows.flatMap(
      (cellIds, rowOffset) =>
        cellIds.flatMap((cellId, columnOffset) => {
          let cell = cellId === null ? null : reads.cellOf(cellId);
          if (cellId === null || cell?.input.kind !== 'richText') return [];
          let shownText = trimmedTexts[rowOffset]?.[columnOffset] ?? '';
          let { parts } = cellTextLinks(cell, reads.formatOf(cellId), shownText, null);
          return [
            {
              rowIndex: rowOffset,
              columnIndex: columnOffset,
              parts,
            },
          ];
        }),
    ),
  );
  return areFormulasLeftOut
    ? {
        ...content,
        areFormulasLeftOut,
      }
    : content;
}
export function trimmedCopySize(reads: WorkbookReads, sheetId: SheetId, area: CellArea, texts: readonly (readonly string[])[]): TrimmedCopySize {
  let sheet = findSheetById(reads, sheetId);
  let lastFilledColumns = texts.map((rowTexts) => rowTexts.findLastIndex((text) => text !== ''));
  return {
    rowCount:
      area.topRowIndex + area.rowCount === sheet?.rowCount
        ? Math.max(
            0,
            lastFilledColumns.findLastIndex((lastFilledColumn) => lastFilledColumn !== -1),
          ) + 1
        : undefined,
    columnCount:
      area.leftColumnIndex + area.columnCount === sheet?.columnCount
        ? lastFilledColumns.reduce((most, lastFilledColumn) => Math.max(most, lastFilledColumn), 0) + 1
        : undefined,
  };
}
export function copiedCellLooksTable(
  reads: WorkbookReads,
  sheetId: SheetId,
  rowIndexes: readonly number[],
  leftColumnIndex: number,
  columnCount: number,
  areGridlinesHidden: boolean,
) {
  let drawnFormats = drawnFormatsOf(reads, sheetId, reads.formatsGivenIn(sheetId));
  let lookOf = (rowIndex: number, columnIndex: number) => {
    let cellId = reads.cellIdAt(sheetId, rowIndex, columnIndex);
    if (cellId === null) return null;
    let look = drawnFormats.lookOf(cellId, {
      rowIndex,
      columnIndex,
    });
    let cellShown = reads.cellOnShowIn(cellId);
    let { textColor = null } = cellShown?.shown?.kind === 'text' ? cellShown.shown : {};
    return {
      look,
      alignment: shownHorizontalAlignment(look.format, cellValueOf(cellShown)),
      tint: textColor === null ? null : textColorNameOf(textColor),
    };
  };
  let [firstRowIndex = 0] = rowIndexes;
  let lastRowIndex = rowIndexes.at(-1) ?? firstRowIndex;
  let area = {
    topRowIndex: firstRowIndex,
    leftColumnIndex,
    rowCount: lastRowIndex - firstRowIndex + 1,
    columnCount,
  };
  let positionInRows = (rowIndex: number) => lowerBoundIndex(rowIndexes, rowIndex);
  return htmlCellAttributesOf(
    rowIndexes.map(
      (rowIndex) =>
        Array.from<unknown, ReturnType<typeof lookOf>>(
          {
            length: columnCount,
          },
          (unused, columnOffset) => lookOf(rowIndex, leftColumnIndex + columnOffset),
        ),
    ),
    reads.mergedAreasIn(sheetId, area).flatMap((mergedArea) => {
      let topRow = mergedArea.topRowIndex < firstRowIndex ? -1 : positionInRows(mergedArea.topRowIndex);
      let endRowIndex = mergedArea.topRowIndex + mergedArea.rowCount;
      let endRow = endRowIndex - 1 > lastRowIndex ? rowIndexes.length + 1 : positionInRows(endRowIndex);
      if (endRow === topRow) return [];
      return {
        topRowIndex: topRow,
        leftColumnIndex: mergedArea.leftColumnIndex - leftColumnIndex,
        rowCount: endRow - topRow,
        columnCount: mergedArea.columnCount,
        first: lookOf(mergedArea.topRowIndex, mergedArea.leftColumnIndex),
      };
    }),
    areGridlinesHidden,
  );
}
export function createSheetController(workbook: OpenedWorkbook, browser: BrowserSide, initialState: PageState): SheetController {
  let state: PageState = initialState;
  let measurerOf = (): TextMeasurer => ({
    lineCountsOfWrappedTexts: (texts) => browser.lineCountsOfWrappedTexts(texts),
    widthOfCharacters: (text, font) => browser.widthOfCharacters(text, font),
  });
  let measurer: TextMeasurer = measurerOf();
  let readsWithBrowserCache: { ofSession: WorkbookReads; withBrowser: ReadsWithTextMeasurer } | null = null;
  let latestReads = (): ReadsWithTextMeasurer => {
    let sessionReads: WorkbookReads = workbook.reads();
    if (readsWithBrowserCache?.ofSession !== sessionReads)
      readsWithBrowserCache = {
        ofSession: sessionReads,
        withBrowser: readsWithTextMeasurer(sessionReads, measurer),
      };
    return readsWithBrowserCache.withBrowser;
  };
  let reads: ReadsWithTextMeasurer = latestReads();
  let viewCache: ViewCache | null = null;
  let ownListeners = new Set<() => void>();
  let viewStore: StoreApi<SheetPublication> = createStore<SheetPublication>()(() => ({ published: 0 }));
  let errorsOfPublishing: unknown[] | null = null;
  let viewGlide = createViewGlide(
    () => (isStopped ? null : browser.framesToGlideOn()),
    () => {
      if (isWaitingForAnswer()) return;
      let errors: unknown[] = [];
      notifyListeners(errors);
      throwCollectedErrors(errors);
    },
  );
  let eventsWaiting: QueuedEvent[] = [];
  let effectsWaiting: PageEffect[] = [];
  let agentAskedUnderAtListeners = new Set<AgentAskedUnderAtListener>();
  let askOwedToAgent: AskOwedToAgent | null = null;
  let rowsAskAhead: RowsAskAhead | null = null;
  let heldEvents: HeldItem[] = [];
  let heldInsertAt: number | null = null;
  let answersAwaitedCount = 0;
  let calculationShownCount = 0;
  let copyStartTimes: number[] = [];
  let afterFormulasWorkedOut: (() => void)[] = [];
  let filesAfterFormulas: FileAfterFormulas[] = [];
  let isEventInFlight = false;
  let eventBeingDispatched: PageEvent | null = null;
  let mayEntryOpenOrEnd = false;
  let unaskedChangeCount = 0;
  let unaskedChangesSeen = 0;
  let wheelTurns = 0;
  let chartEditAnswers = new Map<number, (outcome: ChartEditOutcome) => void>();
  let chartEditAskCount = 0;
  let answerChartEditAsk = (event: QueuedEvent, effects: readonly PageEffect[]) => {
    let isNotMade =
      event.kind === 'editOfChartAsked' &&
      !effects.some((effect) => effect.kind === 'queueEdit' && effect.ifQueued.askOfChart === event.askId);
    let [askId, outcome]: [number, ChartEditOutcome] | [] = isNotMade
      ? [(event as EventOf<'editOfChartAsked'>).askId, 'notMade']
      : event.kind === 'editAnswered' && event.ifQueued.askOfChart !== undefined
        ? [event.ifQueued.askOfChart, chartEditOutcome(event.outcome)]
        : [];
    if (askId === undefined || outcome === undefined) return;
    chartEditAnswers.get(askId)?.(outcome);
    chartEditAnswers.delete(askId);
  };
  let isDispatching = false;
  let isStopped = false;
  let fileCancellers = new Set<() => void>();
  let chartDescriptions: Promise<ChartOfXlsxFile[]> | null = null;
  let placeCache: PlaceCache | null = null;
  let isAnswerAwaitedOk = true;
  let wasEventHeldBack = false;
  let wasAnswerMissed = false;
  let peopleWait: PeopleWait | null = null;
  let hasWaitedForPeople = false;
  let hasKeyEndedEntry = false;
  let isInputMethodInUse = false;
  let keyEndingEntry: PageEvent | null = null;
  let isKeyAwaitingEndOfEntry = () =>
    hasKeyEndedEntry || (keyEndingEntry !== null && (heldEvents.includes(keyEndingEntry) || eventBeingDispatched === keyEndingEntry));
  let lastPeopleWaitEndMs = Number.NEGATIVE_INFINITY;
  let afterDispatchTask: (() => void) | null = null;
  let clipboardWrite: { isAnswered: boolean } | null = null;
  let putOnClipboard = (content: ClipboardContent) => {
    if (clipboardWrite !== null) clipboardWrite.isAnswered = true;
    browser.putOnClipboard(content);
  };
  let isWaitingForAnswer = () => isAnswerAwaitedOk && wasEventHeldBack && workbook.isAnswerAwaited();
  let areAnswersAwaited = () => answersAwaitedCount > 0 || peopleWait !== null || isWaitingForAnswer();
  let isCopyBeingMade = () => copyStartTimes.length > 0;
  let isSelectionShownKnown = () => !isCopyBeingMade() && !wasAnswerMissed;
  let isWorkQueued = () => areAnswersAwaited() || eventsWaiting.length > 0 || effectsWaiting.length > 0;
  let dispatchWhenSettled = async <Answer,>(answer: Promise<Answer>, toEvent: (answered: Answer) => PageEvent): Promise<void> => {
    let answered = await answer;
    if (!isStopped) dispatch(toEvent(answered));
  };
  let showCalculationAfterDelay = (ofOwnView: OwnViewShownAsApplied | null = null) => {
    let timing = {
      isOver: false,
      isShown: false,
    };
    browser.afterMs(WORK_SHOWN_AFTER_MS, () => {
      if (timing.isOver || isStopped) return;
      timing.isShown = true;
      calculationShownCount += 1;
      if (calculationShownCount === 1)
        applyNow({
          kind: 'calculationBegan',
          ...(ofOwnView !== null && {
            ofOwnView,
          }),
        });
    });
    return () => {
      timing.isOver = true;
      if (timing.isShown) calculationShownCount -= 1;
      if (timing.isShown && calculationShownCount === 0)
        eventsWaiting.push({
          kind: 'calculationEnded',
        });
    };
  };
  let noteSlowChartCopy =
    (copiedFor: ChartNodesCopiedFor['kind']) =>
    () => {
      let isOver = false;
      browser.afterMs(CHART_COPY_SLOW_MS, () => {
        if (!isOver && !isStopped)
          applyNow({
            kind: 'chartNodesLongInBeingCopied',
            copiedFor,
          });
      });
      return () => void (isOver = true);
    };
  let runAsyncEffect = <Answer,>(
    start: (answer: (answered: Answer) => void) => unknown,
    toEvent: (answered: Answer, isChangedUnasked: boolean) => QueuedEvent,
    countsAsAnswerAwaited: boolean = true,
    showWork: () => () => void = showCalculationAfterDelay,
  ) => {
    let work = {
      isAnswered: false,
      workIsOver: () => {},
    };
    let changesSeenAtStart = unaskedChangesSeen;
    if (countsAsAnswerAwaited) answersAwaitedCount += 1;
    else copyStartTimes.push(browser.nowMs());
    start((answer) => {
      work.isAnswered = true;
      if (countsAsAnswerAwaited) answersAwaitedCount -= 1;
      else copyStartTimes.shift();
      if (isStopped) return;
      eventsWaiting.push(toEvent(answer, unaskedChangeCount !== changesSeenAtStart));
      work.workIsOver();
      drainQueues();
    });
    if (work.isAnswered) return;
    state = hideWordsOffered(state);
    work.workIsOver = showWork();
  };
  let refuseCopy = (chosen: CopyOrCutChosen['kind']) => {
    putOnClipboard(EMPTY_CLIPBOARD_CONTENT);
    let asked: EventOf<'copyRefused'>['asked'] = chosen === 'cutChosen' ? 'cut' : 'copy';
    heldEvents.push({
      kind: 'copyRefused',
      asked,
      keyInstead: 'sameInAMoment',
    });
  };
  let holdCopyOrCut = (chosen: CopyOrCutChosen['kind']) => {
    if (clipboardWrite !== null) return refuseCopy(chosen);
    putOnClipboard(EMPTY_CLIPBOARD_CONTENT);
    let lastHeld = heldEvents.at(-1);
    if (lastHeld !== undefined && isRunEvent(lastHeld) && lastHeld.ofCopy !== undefined) {
      heldEvents.pop();
      lastHeld.ofCopy.calledOff();
    }
    let endCalculationShown = showCalculationAfterDelay();
    let callOff = () =>
      browser.afterMs(0, () => {
        endCalculationShown();
        drainUnlessStopped();
      });
    let mayStillWait = true;
    holdBack({
      ofCopy: {
        mustStillWait: () => mayStillWait && wouldCopyWaitForCells(),
        calledOff: callOff,
      },
      run() {
        let write = {
          isAnswered: false,
        };
        clipboardWrite = write;
        try {
          if (mayStillWait) browser.askBrowserToCopyOrCutCells(chosen === 'cutChosen' ? 'cut' : 'copy');
        } finally {
          clipboardWrite = null;
          if (!write.isAnswered) refuseCopy(chosen);
          endCalculationShown();
          drainQueues();
        }
      },
      ifDropped() {
        refuseCopy(chosen);
        callOff();
      },
    });
    return browser.afterMs(COPY_ASK_WAIT_MS, () => {
      mayStillWait = false;
      drainUnlessStopped();
    });
  };
  let runEffect = (effect: PageEffect) => {
    switch (effect.kind) {
      case 'queueEdit': {
        let { kind, edit, ifQueued, ...restOfAct } = effect;
        let ifQueuedAfterChanges = selectionToQueue(ifQueued, edit, state, reads);
        let wheelTurnsAtQueue = wheelTurns;
        let lossOfFormulas = actThatMayLoseFormulas(edit, reads);
        let lossToTell =
          lossOfFormulas === null
            ? null
            : {
                ...lossOfFormulas,
                reads,
              };
        return runAsyncEffect(
          (answer) => workbook.queueEdit(edit, answer, restOfAct),
          (outcome: EventOf<'editAnswered'>['outcome'], isChangedUnasked: boolean) => ({
            kind: 'editAnswered',
            edit,
            ...restOfAct,
            outcome,
            ...(lossToTell !== null &&
              !isChangedUnasked && {
                before: lossToTell,
              }),
            ifQueued: {
              ...(isChangedUnasked ? ifQueuedAfterChanges : ifQueued),
              ...(wheelTurns !== wheelTurnsAtQueue && {
                isViewLeftAsItIs: true,
              }),
            },
          }),
          ifQueued.endsEntryAtOnce !== true,
        );
      }
      case 'declareCellTable':
        return workbook.queueEdit(effect, () => {});
      case 'undoOrRedo': {
        let { kind, ...value } = effect;
        return runAsyncEffect(
          (answer) => workbook.undoOrRedo(effect.direction, answer),
          (outcome: EventOf<'undoOrRedoAnswered'>['outcome']) => ({
            kind: 'undoOrRedoAnswered',
            ...value,
            outcome,
          }),
        );
      }
      case 'putOnClipboard': {
        let { cutToken } = effect;
        let corners = copyCornersForEffect(reads, effect);
        if (corners !== null && workbook.askForCopy(...corners)) return refuseCopy(cutToken === null ? 'copyChosen' : 'cutChosen');
        takeHeld((held) => !isRunEvent(held) && held.kind === 'copyRefused');
        let putCopy = (content: ClipboardContent) =>
          putOnClipboard({
            ...content,
            cutToken,
            ...(cutToken !== null && {
              valuesOfCopiedCells: null,
            }),
          });
        let written = corners === null ? null : workbook.copyWritten(...corners);
        if (written !== null) {
          if ((putCopy(written.contents), written.whatTheLookThrew === null)) return;
          throw Error(`in the look of a copy: ${written.whatTheLookThrew}`);
        }
        let content: ClipboardContent;
        try {
          content = buildClipboardContentForCopy(reads, effect, corners, true);
        } catch (error: unknown) {
          throw (putCopy(buildClipboardContentForCopy(reads, effect, corners, false)), error);
        }
        return putCopy(content);
      }
      case 'putNothingOnClipboard':
        return putOnClipboard(EMPTY_CLIPBOARD_CONTENT);
      case 'workOutFormulasLeft': {
        let { thenEvent } = effect;
        try {
          workbook.workOutFormulasLeft();
        } finally {
          if (!workbook.areFormulasLeft()) queueEvent(thenEvent);
          else if (isCopyOrCutChosen(thenEvent)) refuseCopy(thenEvent.kind);
          else
            runAsyncEffect(
              (answer) => void afterFormulasWorkedOut.push(() => answer(null)),
              () => {
                if (!isAnswerToEditOrUndo(thenEvent)) eventBeingDispatched = thenEvent;
                return thenEvent;
              },
            );
        }
        return;
      }
      case 'readOffersUnderAt':
        return queueEvent({
          kind: 'offersUnderAtRead',
          offers: browser.offersUnderAt(),
        });
      case 'askAgentAboutSelection': {
        let askOwed = askOwedToAgent;
        askOwedToAgent = null;
        askOwed?.letKeysBack();
        let isAskedWithPersonAway = askOwed !== null && askOwed.timesLeft !== browser.keyboard.timesLeft() && !browser.keyboard.isHere();
        for (let listener of agentAskedUnderAtListeners) listener(isAskedWithPersonAway);
        return;
      }
      case 'oweAgentAnAsk': {
        let giveUpAsk = (by: EventOf<'askOwedToAgentGivenUp'>['by']) => {
          if (askOwedToAgent === askOwed && !isStopped)
            dispatch({
              kind: 'askOwedToAgentGivenUp',
              by,
            });
        };
        let askOwed: AskOwedToAgent = {
          letKeysBack: () => {},
          timesLeft: browser.keyboard.timesLeft(),
        };
        askOwedToAgent = askOwed;
        askOwed.letKeysBack = browser.keepKeysOffCells(() => giveUpAsk('person'));
        return browser.afterMs(OWED_ASK_WAIT_MS, () => giveUpAsk('time'));
      }
      case 'giveUpAskOwedToAgent':
        askOwedToAgent?.letKeysBack();
        askOwedToAgent = null;
        return;
      case 'findPeople': {
        let { searchedFor } = effect;
        return void dispatchWhenSettled(
          browser.people.search(searchedFor),
          (people) => ({
            kind: 'peopleFound',
            searchedFor,
            people,
          }),
        );
      }
      case 'copyChartNodes': {
        if (isStopped) return;
        let { sources, copiedFor } = effect;
        return runAsyncEffect(
          (answer) =>
            void browser.chartNodes.copy(sources).then((copies) => {
              if (isStopped && typeof copies !== 'string') browser.chartNodes.discard(copies);
              return answer(copies);
            }),
          (copies: EventOf<'chartNodesCopied'>['copies']) => ({
            kind: 'chartNodesCopied',
            copies,
            copiedFor,
          }),
          true,
          noteSlowChartCopy(copiedFor.kind),
        );
      }
      case 'discardChartNodes':
        return browser.chartNodes.discard(effect.copies);
      case 'waitForPeople': {
        let { searchedFor, key } = effect;
        let goOnWithKey = (heldMeanwhile: HeldItem[] = []) => {
          if (peopleWait?.goOnWithKey !== goOnWithKey) return;
          peopleWait = null;
          eventBeingDispatched = {
            ...key,
            hasWaitedForPeople: true,
          };
          eventsWaiting.push(
            ...heldMeanwhile.flatMap((held) => (isRunEvent(held) ? [] : [held])),
            eventBeingDispatched,
          );
          drainQueues();
        };
        peopleWait = {
          searchedFor,
          goOnWithKey,
        };
        hasWaitedForPeople = true;
        let foundIndex = heldEvents.findIndex(
          (held) => !isRunEvent(held) && held.kind === 'peopleFound' && held.searchedFor === searchedFor,
        );
        if (foundIndex !== -1) return goOnWithKey(heldEvents.splice(foundIndex, 1));
        if (browser.nowMs() - lastPeopleWaitEndMs < PEOPLE_LOOKUP_FRESH_MS) return goOnWithKey();
        return browser.afterMs(PEOPLE_LOOKUP_WAIT_MS, () => {
          if (peopleWait?.goOnWithKey !== goOnWithKey || isStopped) return;
          lastPeopleWaitEndMs = browser.nowMs();
          goOnWithKey();
        });
      }
      case 'dropWhatIsHeld':
        return dropHeld();
      case 'lookUpPeople':
        return void dispatchWhenSettled(
          browser.people.profiles(effect.userIds),
          (profiles) => ({
            kind: 'peopleLookedUp',
            askedAbout: effect.userIds,
            profiles,
          }),
        );
      case 'tellOthersOwnSelection':
        return browser.otherViewers.tellOwnSelection(effect.selection);
      case 'tellOthersWhomViewFollows':
        return browser.otherViewers.tellWhomViewFollows(effect.tabKey);
      case 'copyLinkToSheet':
        return void dispatchWhenSettled(
          browser.copyLinkToSheet(effect.sheetId),
          (whyNot) => ({
            kind: 'sheetLinkCopyAnswered',
            whyNot,
          }),
        );
      case 'openCommentBox':
        return browser.comments.openBox(effect);
      case 'openComment':
        return browser.comments.open(effect.handle, effect.isKeyboardLeft === true);
      case 'shutComment':
        return browser.comments.shut();
      case 'shutCommentBox':
        return browser.comments.shutBox();
      case 'endCommentMode':
        return browser.comments.endMode(effect.isAskNext);
      case 'tellAgentWhatIsSelected':
        return browser.otherViewers.tellAgentWhatIsSelected(effect.selected);
      case 'askAgentAboutImport': {
        let { askId, asked } = effect;
        let tellWritten = (written: EventOf<'agentWroteOnAboutImport'>['written']) => {
          if (!isStopped)
            dispatch({
              kind: 'agentWroteOnAboutImport',
              askId,
              written,
            });
        };
        return void dispatchWhenSettled(
          browser.agentForImport.ask(asked, tellWritten),
          (reply) => ({
            kind: 'agentRepliedAboutImport',
            askId,
            reply,
          }),
        );
      }
      case 'stopAskingAgentAboutImport':
        return browser.agentForImport.stop();
      case 'askAgentAboutConditionalFormats': {
        let { askId, asked } = effect;
        let replied = browser.agentForConditionalFormats.ask(asked, () => {});
        return void dispatchWhenSettled(
          replied,
          (reply) => ({
            kind: 'agentRepliedAboutConditionalFormats',
            askId,
            reply,
          }),
        );
      }
      case 'stopAskingAgentAboutConditionalFormats':
        return browser.agentForConditionalFormats.stop();
      case 'askAgentWhichRowsAreAskedFor': {
        let { askId, asked, isAtEnter } = effect;
        let agent = browser.agentForRowsAskedFor;
        rowsAskAhead = null;
        let replied = isAtEnter ? agent.ask(asked, () => {}) : agent.askIfAllowed(asked);
        return void dispatchWhenSettled(
          replied,
          (reply) => ({
            kind: 'agentRepliedWhichRowsAreAskedFor',
            askId,
            reply,
          }),
        );
      }
      case 'askAgentAheadWhichRowsAreAskedFor': {
        let { askId, words } = effect;
        let rest = new Promise<RestOfRowsAsk>((tell) => {
          rowsAskAhead = {
            askId,
            tell,
          };
        });
        return void dispatchWhenSettled(
          browser.agentForRowsAskedFor.askAheadIfAllowed(words, rest),
          (reply) => ({
            kind: 'agentRepliedWhichRowsAreAskedFor',
            askId,
            reply,
          }),
        );
      }
      case 'tellAgentWhichRowsAreAskedFor':
        if (rowsAskAhead?.askId === effect.askId) rowsAskAhead.tell(effect.rest);
        rowsAskAhead = null;
        return;
      case 'stopAskingAgentWhichRowsAreAskedFor':
        rowsAskAhead = null;
        return browser.agentForRowsAskedFor.stop();
      case 'checkAgentForConditionalFormats':
        return void dispatchWhenSettled(
          browser.agentForConditionalFormats.isAvailable(),
          (isAvailable) => ({
            kind: 'agentForConditionalFormatsChecked',
            isAvailable,
          }),
        );
      case 'workOutFormulaRead': {
        let formulaRead: EventOf<'formulaReadToBeWorkedOut'> = {
          kind: 'formulaReadToBeWorkedOut',
          formula: effect.formula,
        };
        return workbook.isOnAnotherThread ? dispatchOffThread(formulaRead) : queueEvent(formulaRead);
      }
      case 'checkAgentForFormulas':
        return void dispatchWhenSettled(
          browser.agentForFormulas.isAvailable(),
          (isAvailable) => ({
            kind: 'agentForFormulasChecked',
            isAvailable,
          }),
        );
      case 'askAgentForAFormula': {
        let { askId, asked } = effect;
        let replied = browser.agentForFormulas.ask(asked, () => {});
        return void dispatchWhenSettled(
          replied,
          (reply) => ({
            kind: 'agentRepliedWithAFormula',
            askId,
            reply,
          }),
        );
      }
      case 'askAgentForANumberFormat': {
        let { askId, asked } = effect;
        let replied = browser.agentForFormulas.ask(asked, () => {});
        return void dispatchWhenSettled(
          replied,
          (reply) => ({
            kind: 'agentRepliedWithANumberFormat',
            askId,
            reply,
          }),
        );
      }
      case 'stopAskingAgentForAFormula':
        return browser.agentForFormulas.stop();
      case 'askAgentForAFix': {
        let { askId, asked } = effect;
        let replied = browser.agentForFixes.ask(asked, () => {}, true);
        return void dispatchWhenSettled(
          replied,
          (reply) => ({
            kind: 'agentRepliedWithAFix',
            askId,
            reply,
          }),
        );
      }
      case 'stopAskingAgentForFixes':
        return browser.agentForFixes.stop();
      case 'readVersions': {
        let { askId, before } = effect;
        return void dispatchWhenSettled(
          browser.versionHistory.versions(before),
          (read) => ({
            kind: 'versionsRead',
            askId,
            read,
          }),
        );
      }
      case 'lookAtVersion': {
        let { askId, revision, pane } = effect;
        return void dispatchWhenSettled(
          browser.versionLooks.lookAt(revision, pane, () => state),
          (whyNot) => ({
            kind: 'versionLookedAt',
            askId,
            whyNot,
          }),
        );
      }
      case 'endLookAtVersion':
        return browser.versionLooks.end(effect.pane, state, effect.thenRestore, effect.isByPerson === true);
      case 'readCellHistory': {
        let { askId, cell, scope } = effect;
        let isStillAwaited = () => isCellHistoryAwaiting(state, askId);
        return void dispatchWhenSettled(
          scope === 'row' ? browser.versionHistory.changesOfRow(cell, isStillAwaited) : browser.versionHistory.changesOfCell(cell, isStillAwaited),
          (read) => ({
            kind: 'cellHistoryRead',
            askId,
            read,
          }),
        );
      }
      case 'readEditsThatTakeBack': {
        let { askId, asked, afterMs } = effect;
        let readEdits = () => {
          if (isStopped || state.takingBack?.askId !== askId) return;
          dispatchWhenSettled(
            browser.versionHistory.editsThatTakeBack(asked),
            (read) => ({
              kind: 'editsThatTakeBackRead',
              askId,
              read,
            }),
          );
        };
        return afterMs === 0 ? readEdits() : browser.afterMs(afterMs, readEdits);
      }
      case 'seeRowsInOwnOrder': {
        let { sheetId, rows, staysAt } = effect;
        return runAsyncEffect<void>(
          (answer) => workbook.seeRowsInOwnOrder(sheetId, rows, answer),
          () => ({
            kind: 'ownRowOrderSeen',
            sheetId,
            staysAt,
          }),
          true,
          () => showCalculationAfterDelay(rows === null ? null : 'sort'),
        );
      }
      case 'queueEditsThatTakeBack': {
        let { askId, builtOnRevision, edits, offerIfMade } = effect;
        return runAsyncEffect(
          (answer) => workbook.queueEditsThatTakeBack(builtOnRevision, edits, answer),
          (outcome: EventOf<'takeBackAnswered'>['outcome']) => ({
            kind: 'takeBackAnswered',
            askId,
            outcome,
            offerIfMade,
          }),
        );
      }
    }
  };
  let isWorkOnItsWayToWorkbook = (): boolean =>
    answersAwaitedCount > 0 ||
    isCopyBeingMade() ||
    effectsWaiting.some(isEffectAnEdit) ||
    heldEvents.some((held) => !isRunEvent(held)) ||
    state.takingBack !== null;
  let isWorkYetToReachWorkbook = (): boolean =>
    isWorkOnItsWayToWorkbook() ||
    (state.mode.kind === 'editing' && !isEntryUnchanged(state, reads) && !peopleListOffersAgent(state, reads)) ||
    hasUnsavedDropdownEdits(state) ||
    hasRulesPaneWorkInProgress(state) ||
    pivotTypingToEnter(state) !== null ||
    state.customNumberFormat?.typedIn === 'dialog' ||
    state.pasteThatWaits !== null ||
    (state.pickForWorkbook !== null && isWorkbookSettingChanged(state.pickForWorkbook)) ||
    state.importOfAFile !== null ||
    (state.sheetBeingRenamed !== null && state.sheetBeingRenamed.typed !== state.sheetBeingRenamed.nameWhenOpened);
  let doesLeaveLoseWork = (): boolean => isWorkYetToReachWorkbook() || hasRulesPaneRefusedRules(state);
  let notifiedState: PageState = state;
  let notifiedWorkPending: boolean = isWorkYetToReachWorkbook();
  let notifiedWaitedForPeople = false;
  let notifiedKeyAwaiting = false;
  let notifiedRefusal: ViewOnlyBecause | null = workbook.refusalOfEveryEdit();
  let notifiedYetToGlide: ShiftOfView | null = viewGlide.yetToGo();
  let notifyListeners = (errors: unknown[]) => {
    let isWorkPending = isWorkYetToReachWorkbook();
    let refusal: ViewOnlyBecause | null = workbook.refusalOfEveryEdit();
    let isKeyAwaiting = isKeyAwaitingEndOfEntry();
    if (
      state === notifiedState &&
      viewGlide.yetToGo() === notifiedYetToGlide &&
      isWorkPending === notifiedWorkPending &&
      hasWaitedForPeople === notifiedWaitedForPeople &&
      isKeyAwaiting === notifiedKeyAwaiting &&
      refusal === notifiedRefusal
    )
      return;
    notifiedState = state;
    notifiedYetToGlide = viewGlide.yetToGo();
    notifiedWorkPending = isWorkPending;
    notifiedWaitedForPeople = hasWaitedForPeople;
    notifiedKeyAwaiting = isKeyAwaiting;
    notifiedRefusal = refusal;
    for (let listener of ownListeners)
      try {
        listener();
      } catch (error: unknown) {
        errors.push(error);
      }
    errorsOfPublishing = errors;
    try {
      viewStore.setState(({ published }) => ({ published: published + 1 }));
    } catch (error: unknown) {
      errors.push(error);
    } finally {
      errorsOfPublishing = null;
    }
  };
  let readContext = (readsUsed: ReadsWithTextMeasurer) => ({
    reads: readsUsed,
    revisionHeld: readsUsed === latestReads() ? workbook.revisionHeld() : null,
    refusalOfEveryEdit: workbook.refusalOfEveryEdit(),
    areFormulasLeft: workbook.areFormulasLeft(),
    areReadsTheLatest: readsUsed === latestReads(),
    areEditsAnsweredLater: workbook.isOnAnotherThread,
    wasEventHeld: heldInsertAt !== null || wasEventHeldBack,
  });
  let shiftYetToGlide = (): ShiftOfView | null => {
    let yetToGo: ShiftOfView | null = viewGlide.yetToGo();
    if (yetToGo === null) return null;
    let maxScroll = maxScrollWithFloats(layoutOfView(state, reads), state);
    return {
      x: clampBetween(yetToGo.x, Math.min(0, state.scrollLeft - maxScroll.scrollLeft), state.scrollLeft),
      y: clampBetween(yetToGo.y, Math.min(0, state.scrollTop - maxScroll.scrollTop), state.scrollTop),
    };
  };
  let withGlideLeftOut = (event: PageEvent): PageEvent => {
    let shift = shiftYetToGlide();
    if (shift === null || (event.kind !== 'wheelTurned' && event.kind !== 'viewTakenBack')) return event;
    let wheelEvent: EventOf<'wheelTurned'> =
      event.kind === 'wheelTurned'
        ? event
        : {
            kind: 'wheelTurned',
            deltaX: 0,
            deltaY: 0,
          };
    return {
      ...wheelEvent,
      deltaX: wheelEvent.deltaX - shift.x,
      deltaY: wheelEvent.deltaY - shift.y,
    };
  };
  function glideViewAfterEvent(stateBefore: PageState, { kind }: PageEvent) {
    let moveOfView = {
      x: state.scrollLeft - stateBefore.scrollLeft,
      y: state.scrollTop - stateBefore.scrollTop,
    };
    let hasViewMoved = state.sheetId !== stateBefore.sheetId || moveOfView.x !== 0 || moveOfView.y !== 0;
    if (!hasViewMoved && isViewFreeToFollow(state) && kind !== 'wheelTurned') return;
    if (
      !(
        hasViewMoved &&
        kind !== 'gridResized' &&
        state.movesOfViewByItself > stateBefore.movesOfViewByItself &&
        state.sheetId === stateBefore.sheetId
      )
    )
      return viewGlide.stop();
    let middleOfCells = {
      x: cellsAreaWidth(state) / 2,
      y: cellsAreaHeight(state) / 2,
    };
    return viewGlide.viewMovedBy(moveOfView, middleOfCells, state.zoom);
  }
  let markPivotTablesOutOfDate = () => {
    if (workbook.areFormulasLeft() || workbook.isAnswerAwaited()) return;
    state = withPivotTablesOutOfDate(state, reads);
  };
  let applyEvent = (queued: QueuedEvent, how: HowEventApplies): boolean => {
    let missedBefore = workbook.questionsMissedCount();
    let isWordOfChange = queued.kind === 'wordOfChange';
    let stateToReduce = isWordOfChange ? state : viewForLateMessage(queued, state, reads);
    if (stateToReduce === 'ofOpenEntry') {
      if (queued === eventBeingDispatched) eventBeingDispatched = null;
      return true;
    }
    let readsUsed: ReadsWithTextMeasurer = (isWordOfChange ? (queued as WordOfChange).readsAfter : null) ?? reads;
    let stateBefore = state;
    let eventApplied: PageEvent = isWordOfChange ? wordOfChangeWithReads(queued as WordOfChange, reads) : withGlideLeftOut(queued as PageEvent);
    let reduced: PageTransition;
    try {
      reduced = reduceSheetsPage(stateToReduce, eventApplied, readContext(readsUsed));
    } catch (error: unknown) {
      reads = readsUsed;
      if (isWordOfChange && (queued as WordOfChange).isUnasked) unaskedChangesSeen += 1;
      if (queued === eventBeingDispatched) eventBeingDispatched = null;
      if (!isWordOfChange && isAnswerThatEndsEntryAtOnce(queued))
        state = {
          ...state,
          entriesUnanswered: state.entriesUnanswered.slice(1),
        };
      if (queued.kind === 'editAnswered' && queued.edit === state.heldUntilAnswered?.edit)
        state = {
          ...state,
          heldUntilAnswered: null,
        };
      if (state.sortToLookBackOn !== null)
        state = {
          ...state,
          sortToLookBackOn: null,
        };
      if (queued.kind === 'editAnswered' || queued.kind === 'undoOrRedoAnswered')
        state = {
          ...state,
          answerAwaited: null,
        };
      answerChartEditAsk(queued, []);
      throw error;
    }
    let isAnswerMissed = workbook.questionsMissedCount() !== missedBefore;
    if (how === 'onlyIfItStandsWhateverIsUnanswered' && (isAnswerMissed || isWordOfChange || !doesEntryEndAtOnce(queued, stateBefore, reduced, readsUsed))) return false;
    if (isAnswerMissed && how === 'unlessAnAnswerIsMissed' && isAnswerAwaitedOk) return false;
    reads = readsUsed;
    if (isWordOfChange && (queued as WordOfChange).isUnasked) unaskedChangesSeen += 1;
    state = reduced.state;
    effectsWaiting.push(...reduced.effects);
    answerChartEditAsk(queued, reduced.effects);
    browser.rulesTook?.(isWordOfChange ? null : (queued as PageEvent), stateBefore, reduced, readsUsed);
    if (eventApplied.kind === 'wheelTurned') wheelTurns += 1;
    if (queued === eventBeingDispatched) eventBeingDispatched = null;
    if (
      ((isWordOfChange ? (queued as WordOfChange).isUnasked : UNASKED_EVENT_KINDS.has(queued.kind)) &&
        !isSamePlaceOfSelection(stateBefore, state) &&
        !hasRowsAskEndedWhereBegun(stateBefore, state) &&
        !wasOwnFilterTryUndone(stateBefore, state)) ||
      (!isWordOfChange && !isAnswerThatEndsEntryAtOnce(queued) && isSelectionLostByAnswer(queued as PageEvent, reads))
    )
      dropHeld();
    mayEntryOpenOrEnd ||= reduced.effects.some(
      (effect) =>
        effect.kind === 'undoOrRedo' ||
        effect.kind === 'queueEditsThatTakeBack' ||
        effect.kind === 'workOutFormulasLeft' ||
        effect.kind === 'waitForPeople' ||
        effect.kind === 'copyChartNodes' ||
        (effect.kind === 'queueEdit' && !effect.ifQueued.leavesEntryOpen && effect.ifQueued.endsEntryAtOnce !== true),
    );
    hasKeyEndedEntry ||=
      isInputMethodInUse &&
      queued.kind === 'keyPressed' &&
      state.mode.kind === 'editing' &&
      reduced.effects.some(
        (effect) => effect.kind === 'queueEdit' && !effect.ifQueued.leavesEntryOpen && effect.ifQueued.endsEntryAtOnce !== true,
      );
    wasAnswerMissed ||= isAnswerMissed;
    glideViewAfterEvent(stateBefore, eventApplied);
    explainErrorCellsAhead(state, reads);
    markPivotTablesOutOfDate();
    return true;
  };
  function drainQueues() {
    if (isDispatching) return;
    isDispatching = true;
    let errors: unknown[] = [];
    while (!areAnswersAwaited()) {
      let effect = effectsWaiting.shift();
      let [event] = eventsWaiting;
      if (effect === undefined && event === undefined) break;
      let isApplied = true;
      try {
        if (effect !== undefined) runEffect(effect);
        else if (event !== undefined)
          isApplied = applyEvent(event, event.kind === 'wordOfChange' || !isTypingEvent(event, state) ? 'unlessAnAnswerIsMissed' : 'always');
      } catch (error: unknown) {
        errors.push(error);
      }
      wasEventHeldBack = !isApplied;
      if (effect === undefined && isApplied) eventsWaiting.shift();
    }
    isDispatching = false;
    if (!isWorkQueued()) {
      isEventInFlight = false;
      mayEntryOpenOrEnd = false;
      hasWaitedForPeople = false;
      hasKeyEndedEntry = false;
    }
    if (!isWaitingForAnswer()) notifyListeners(errors);
    try {
      releaseHeld();
    } catch (error: unknown) {
      errors.push(error);
    }
    if (!isWaitingForAnswer()) notifyListeners(errors);
    let task = afterDispatchTask;
    afterDispatchTask = null;
    try {
      task?.();
    } catch (error: unknown) {
      errors.push(error);
    }
    try {
      for (let event of eventsAwaitingAnswers) if (eventsAwaitingAnswers.includes(event) && isIdle()) dispatchOffThread(event);
    } catch (error: unknown) {
      errors.push(error);
    }
    throwCollectedErrors(errors);
  }
  let drainUnlessStopped = () => void (isStopped || drainQueues());
  function queueEvent(event: QueuedEvent) {
    eventsWaiting.push(event);
    drainQueues();
  }
  function applyNow(event: PageEvent, how: HowEventApplies = 'always'): boolean {
    let errors: unknown[] = [];
    let effectsBefore = effectsWaiting.splice(0);
    let isApplied = true;
    try {
      isApplied = applyEvent(event, how);
      for (let effect of effectsWaiting.splice(0)) runEffect(effect);
    } catch (error: unknown) {
      errors.push(error);
    }
    effectsWaiting.unshift(...effectsBefore);
    let wait = peopleWait;
    let isWaitOver =
      wait !== null &&
      ((event.kind === 'peopleFound' && event.searchedFor === wait.searchedFor) || state.peopleList?.searchedFor !== wait.searchedFor);
    try {
      if (isWaitOver) wait!.goOnWithKey();
    } catch (error: unknown) {
      errors.push(error);
    }
    notifyListeners(errors);
    throwCollectedErrors(errors);
    return isApplied;
  }
  let keyboardStampOf = new WeakMap<HeldItem, KeyboardStamp>();
  let markMenuForNobody = (event: PageEvent): PageEvent => {
    if (!((keyboardStampOf.get(event)?.timesLeft ?? browser.keyboard.timesLeft()) !== browser.keyboard.timesLeft() && !browser.keyboard.isHere()))
      return event;
    if (event.kind === 'menuAsked')
      return {
        ...event,
        isForNobody: true,
      };
    return event.kind === 'placedViewActedOn' && event.act.kind === 'askForMenu'
      ? {
          ...event,
          act: {
            ...event.act,
            isForNobody: true,
          },
        }
      : event;
  };
  function dropTypedAhead(event: PageEvent) {
    let stamp = keyboardStampOf.get(event);
    let isSameTypedAhead = (held: HeldItem): held is HeldRun =>
      isTypedAheadRun(held) &&
      keyboardStampOf.get(held)?.timesPressed === stamp?.timesPressed &&
      keyboardStampOf.get(held)?.timesLeft === stamp?.timesLeft;
    let matches = heldEvents.filter(isSameTypedAhead);
    heldEvents.splice(0, heldEvents.length, ...heldEvents.filter((held) => !isSameTypedAhead(held)));
    for (let run of matches) run.ifDropped();
  }
  function holdBack(item: HeldItem) {
    if (isTypedAheadRun(item) || (!isRunEvent(item) && asksForMenu(item))) {
      let [timesLeft, timesPressed] = [browser.keyboard.timesLeft(), browser.keyboard.timesPressed()];
      keyboardStampOf.set(item, {
        timesLeft,
        timesPressed,
      });
    }
    if (heldInsertAt === null) heldEvents.push(item);
    else {
      heldEvents.splice(heldInsertAt, 0, item);
      heldInsertAt += 1;
    }
  }
  function takeHeld(isTaken: (held: HeldItem) => boolean): HeldItem[] {
    let matches = heldEvents.filter(isTaken);
    heldEvents.splice(0, heldEvents.length, ...heldEvents.filter((held) => !isTaken(held)));
    return matches;
  }
  function dropHeld() {
    let dropped = takeHeld((held) => !dispatchesNothing(held));
    let beingDispatched = eventBeingDispatched;
    let waitingIndex = beingDispatched === null ? -1 : eventsWaiting.indexOf(beingDispatched);
    if (beingDispatched !== null && waitingIndex !== -1 && !dispatchesNothing(beingDispatched)) {
      eventsWaiting.splice(waitingIndex, 1);
      eventBeingDispatched = null;
    }
    for (let held of dropped) if (isRunEvent(held)) held.ifDropped();
  }
  let canReleaseHeld = () =>
    !isWorkQueued() &&
    !isCopyBeingMade() &&
    (!wasAnswerMissed || !isAnswerAwaitedOk) &&
    !isStopped &&
    !(heldEvents[0] !== undefined && isRunEvent(heldEvents[0]) && heldEvents[0].ofCopy?.mustStillWait() === true);
  function releaseHeld() {
    if (heldInsertAt !== null) return;
    let errors: unknown[] = [];
    while (canReleaseHeld()) {
      let held = heldEvents.shift();
      if (held === undefined) break;
      heldInsertAt = 0;
      try {
        let released = isRunEvent(held) ? held : markMenuForNobody(held);
        if (released !== held && !isRunEvent(held) && state.mode.kind !== 'editing') dropTypedAhead(held);
        if (isRunEvent(released)) released.run();
        else dispatchHeld(released);
      } catch (error: unknown) {
        errors.push(error);
      }
      heldInsertAt = null;
    }
    throwCollectedErrors(errors);
  }
  let isHeldWaiting = () => heldEvents.length > 0 && heldInsertAt === null;
  let isEventUnfinished = () => (isEventInFlight && isWorkQueued()) || isHeldWaiting();
  function runOrHold(isHeld: boolean, run: () => void) {
    if (isHeld)
      holdBack({
        run,
        ifDropped: () => {},
        dispatchesNothing: true,
      });
    else run();
  }
  let lookOnceEventsAreFinished = (look: () => void) => runOrHold(isEventUnfinished(), look);
  let runWhenIdle = (run: () => void) => runOrHold(isWorkQueued() || isHeldWaiting() || isCopyBeingMade(), run);
  function runFilesAfterFormulas() {
    if (workbook.areFormulasLeft()) return;
    for (let { run } of filesAfterFormulas.splice(0)) run();
  }
  let mayAnEntryOpenOrEnd = () => isHeldWaiting() || eventBeingDispatched !== null || mayEntryOpenOrEnd;
  let isAnyHeldDispatching = () =>
    heldEvents.some((held) => !isRunEvent(held) || (held.dispatchesNothing !== true && !isCopyRun(held)));
  let mayWhatACopyHoldsChange = () => isAnyHeldDispatching() || eventBeingDispatched !== null || mayEntryOpenOrEnd;
  let areReadsStale = () => reads !== latestReads();
  function bringBackOwnFilters(event: OwnFiltersBroughtBack) {
    let isSortKept = event.kept.some(({ sortBy }) => sortBy !== null);
    let isFilterKept = event.kept.some(({ filter }) => filter !== null);
    if (!workbook.isOnAnotherThread || !(isSortKept || isFilterKept)) return queueEvent(event);
    let workIsOver = showCalculationAfterDelay(!isFilterKept ? 'sort' : isSortKept ? 'sortAndFilter' : 'filter');
    try {
      queueEvent(event);
    } finally {
      runWhenIdle(() =>
        browser.afterMs(0, () => {
          workIsOver();
          drainUnlessStopped();
        }),
      );
    }
  }
  function dispatchHeld(event: PageEvent) {
    isEventInFlight = true;
    eventBeingDispatched = event;
    queueEvent(event);
  }
  function dispatchCopyNow(event: CopyOrCutChosen) {
    let errors: unknown[] = [];
    isAnswerAwaitedOk = false;
    for (let step of [drainQueues, () => receiveEvent(event)])
      try {
        step();
      } catch (error: unknown) {
        errors.push(error);
      }
    isAnswerAwaitedOk = true;
    throwCollectedErrors(errors);
  }
  let eventsAwaitingAnswers: PageEvent[] = [];
  let isIdle = () => !isWorkQueued() && !isHeldWaiting();
  function dispatchOffThread(event: PageEvent) {
    eventsAwaitingAnswers = eventsAwaitingAnswers.filter(({ kind }) => kind !== event.kind);
    let missedBefore = workbook.questionsMissedCount();
    try {
      reduceSheetsPage(state, event, readContext(reads));
    } catch {}
    if (workbook.questionsMissedCount() === missedBefore && isIdle()) queueEvent(event);
    else eventsAwaitingAnswers = [...eventsAwaitingAnswers, event];
  }
  function doesKeyEndEntry(event: PageEvent): boolean {
    if (event.kind !== 'keyPressed' || state.mode.kind !== 'editing') return false;
    try {
      let transition: PageTransition = reduceSheetsPage(state, event, {
        ...readContext(reads),
        wasEventHeld: true,
      });
      return (
        transition.state.mode.kind !== 'editing' ||
        transition.effects.some((effect) => effect.kind === 'queueEdit' && !effect.ifQueued.leavesEntryOpen)
      );
    } catch {
      return false;
    }
  }
  let isNextEventHandledAtOnce = () => !isWorkQueued() && !isHeldWaiting() && isSelectionShownKnown();
  function receiveEvent(event: PageEvent) {
    if (isDispatching) return void eventsWaiting.push(event);
    if (event.kind === 'otherThanCellsCopied' || event.kind === 'linkAddressCopied') {
      for (let held of takeHeld(isCopyRun)) if (isRunEvent(held)) held.ofCopy?.calledOff();
    }
    if (isMenuAskEvent(event)) return dispatchOffThread(event);
    if (event.kind === 'ownFiltersBroughtBack') return bringBackOwnFilters(event);
    if (isAgentReplyEvent(event) || isEditsThatTakeBackRead(event)) return queueEvent(event);
    if (isNextEventHandledAtOnce()) return isCopyOrCutChosen(event) && wouldCopyWaitForCells() ? holdCopyOrCut(event.kind) : dispatchHeld(event);
    if (isCopyOrCutChosen(event) && heldEvents.some(isCopyRun)) return holdCopyOrCut(event.kind);
    if (isCopyOrCutChosen(event) && isAnswerAwaitedOk) return dispatchCopyNow(event);
    let mayCopyComeOut = () => mayWhatACopyHoldsChange() || isCopyBeingMade() || areReadsStale() || wouldCopyWaitForCells();
    if (isCopyOrCutChosen(event) && mayCopyComeOut()) return holdCopyOrCut(event.kind);
    if (isTypingEvent(event, state)) return void applyNow(event);
    if (event.kind === 'workShownLongEnough') return void applyNow(event);
    if (event.kind === 'peopleFound' && event.searchedFor === peopleWait?.searchedFor) return void applyNow(event);
    let isNothingDispatching = !isAnyHeldDispatching() && eventBeingDispatched === null;
    let isUnaskedThatCounts = UNASKED_EVENT_KINDS.has(event.kind) && !isMenuChangeThatCounts(event, state.rowsAskedFor !== null);
    if (isNothingDispatching && isUnaskedThatCounts)
      return void applyNow(
        WORD_OFFER_EVENT_KINDS.has(event.kind)
          ? {
              kind: 'wordsOfferedWithdrawn',
            }
          : event,
      );
    let [firstCopyStartMs = Number.POSITIVE_INFINITY] = copyStartTimes;
    if (!isWorkQueued() && !isHeldWaiting() && browser.nowMs() - firstCopyStartMs < RECENT_ACT_MS && applyNow(event, 'onlyIfItStandsWhateverIsUnanswered'))
      return;
    if (event.kind === 'figuresOfSelectionDue') return;
    if (isInputMethodInUse && doesKeyEndEntry(event)) keyEndingEntry = event;
    holdBack(event);
    let errors: unknown[] = [];
    notifyListeners(errors);
    return throwCollectedErrors(errors);
  }
  function dispatch(event: PageEvent) {
    receiveEvent(stampWhatPointerWasOver(event, state, reads));
  }
  function wouldCopyWaitForCells(): boolean {
    let { effects }: PageTransition = reduceSheetsPage(
      state,
      {
        kind: 'copyChosen',
      },
      readContext(reads),
    );
    return effects.some((effect) => {
      if (effect.kind !== 'putOnClipboard') return false;
      let corners = copyCornersForEffect(reads, effect);
      return corners !== null && workbook.askForCopy(...corners);
    });
  }
  let prefetchedCopy: CopyPrefetch | null = null;
  let lastCopyPrefetchMs = Number.NEGATIVE_INFINITY;
  let prefetchCopy = () => {
    if (
      prefetchedCopy !== null &&
      reads === prefetchedCopy.reads &&
      state.sheetId === prefetchedCopy.state.sheetId &&
      state.rowsOutOfViewByOwnFilters === prefetchedCopy.state.rowsOutOfViewByOwnFilters &&
      state.ownCollapsing === prefetchedCopy.state.ownCollapsing &&
      state.mode.kind === prefetchedCopy.state.mode.kind &&
      isSameCell(state.activeCell, prefetchedCopy.state.activeCell) &&
      isSameCell(state.selectionCorner, prefetchedCopy.state.selectionCorner)
    )
      return;
    let prefetch: CopyPrefetch = {
      reads,
      state,
    };
    prefetchedCopy = prefetch;
    let hasSettled = browser.nowMs() - lastCopyPrefetchMs >= FIGURES_SETTLE_MS;
    lastCopyPrefetchMs = browser.nowMs();
    let area = selectedArea(state, reads);
    let isQuickArea = area !== null && area.rowCount * area.columnCount <= MAX_CELLS_FOR_QUICK_FIGURES;
    let readAhead = (): void => {
      if (isStopped || prefetchedCopy !== prefetch) return;
      let isBusy = isWorkQueued() || heldEvents.length > 0;
      if (isBusy && isQuickArea) afterDispatchTask = readAhead;
      else if (isBusy || workbook.areFormulasLeft()) browser.afterMs(FIGURES_SETTLE_MS, readAhead);
      else wouldCopyWaitForCells();
    };
    if (isQuickArea || hasSettled) readAhead();
    else browser.afterMs(FIGURES_SETTLE_MS, readAhead);
  };
  let reportSaving = () =>
    queueEvent({
      kind: 'savingChanged',
      saving: workbook.saving(),
      hasUnsavedEdits: workbook.hasUnsavedEdits(),
      unsavedEditCount: workbook.unsavedEditCount(),
    });
  let formulasLeftNotice: { isShown: boolean } | null = null;
  function updateFormulasLeft() {
    let notice = workbook.areFormulasLeft()
      ? {
          isShown: false,
        }
      : null;
    let wasShown = formulasLeftNotice?.isShown === true;
    formulasLeftNotice = notice;
    if (notice === null) {
      try {
        for (let run of afterFormulasWorkedOut.splice(0)) run();
      } finally {
        try {
          queueEvent({
            kind: 'formulasLeftChanged',
            areLeft: false,
          });
        } finally {
          if (filesAfterFormulas.length > 0) runWhenIdle(runFilesAfterFormulas);
        }
      }
      return;
    }
    if (wasShown)
      queueEvent({
        kind: 'formulasLeftChanged',
        areLeft: false,
      });
    let showNotice = () => {
      if (isStopped || formulasLeftNotice !== notice) return;
      notice.isShown = true;
      queueEvent({
        kind: 'formulasLeftChanged',
        areLeft: true,
      });
    };
    if (state.isActShownAsCalculated) showNotice();
    else browser.afterMs(WORK_SHOWN_AFTER_MS, showNotice);
  }
  let queueWordOfChange = (changeOf: WordOfChange['of'], isUnasked: boolean) => {
    let dispatchedIndex = eventBeingDispatched === null ? -1 : eventsWaiting.indexOf(eventBeingDispatched);
    let isTablesRead = changeOf === 'tablesRead';
    if (dispatchedIndex === 0 && wasEventHeldBack && !isTablesRead) wasAnswerMissed = true;
    eventsWaiting.splice(dispatchedIndex === -1 ? eventsWaiting.length : dispatchedIndex, 0, {
      kind: 'wordOfChange',
      of: changeOf,
      readsAfter: isTablesRead ? null : latestReads(),
      tablesRead: workbook.tablesRead(),
      isUnasked,
    });
    drainQueues();
  };
  let unsubscribers: (() => void)[] = [
    workbook.onChanged((cause: CauseOfWorkbookChange) => {
      if (cause === 'unasked') unaskedChangeCount += 1;
      queueWordOfChange(cause === 'formulasAlone' ? 'formulasWorkedOut' : 'workbookChanged', cause === 'unasked');
    }),
    browser.onTextMeasuredAnew(() => {
      measurer = measurerOf();
      readsWithBrowserCache = null;
      queueWordOfChange('textMeasuredAnew', false);
    }),
    workbook.onEditsDropped(
      ({ isPartKept, why }: EditsDropped) =>
        queueEvent({
          kind: 'editsDropped',
          ...(isPartKept && {
            isPartKept,
          }),
          ...(why !== null && {
            why,
          }),
        }),
    ),
    workbook.onSavingChanged(reportSaving),
    workbook.onFormulasLeftChanged(updateFormulasLeft),
    workbook.onTablesRead(() => queueWordOfChange('tablesRead', false)),
    workbook.onCopyWritten(() => void (heldEvents.some(isCopyRun) && drainQueues())),
    workbook.onAnswersCame(() => {
      if (wasAnswerMissed) eventsWaiting.push(WORKBOOK_CHANGED_WORD);
      wasAnswerMissed = false;
      drainQueues();
      markPivotTablesOutOfDate();
      drainQueues();
    }),
    workbook.onCauseOfErrorCame(
      (cellId: EventOf<'causeOfErrorRead'>['of']) =>
        queueEvent({
          kind: 'causeOfErrorRead',
          of: cellId,
        }),
    ),
    browser.otherViewers.onSelectionsChanged(
      (selections) =>
        dispatch({
          kind: 'selectionsOfOthersChanged',
          selections,
          atMs: browser.nowMs(),
        }),
    ),
  ];
  if (workbook.isOnAnotherThread) ownListeners.add(prefetchCopy);
  ownListeners.add(() => workbook.followTablesOf(state.sheetId));
  workbook.followTablesOf(state.sheetId);
  reportSaving();
  updateFormulasLeft();
  runEffect({
    kind: 'checkAgentForConditionalFormats',
  });
  (async (): Promise<void> => {
    let viewer = await browser.people.viewer();
    if (viewer === null || isStopped) return;
    runEffect({
      kind: 'lookUpPeople',
      userIds: [viewer.userId],
    });
    dispatch({
      kind: 'viewerFound',
      userId: viewer.userId,
    });
  })();
  function getView(): PageView {
    let yetToGlide: ShiftOfView | null = viewGlide.yetToGo();
    let refusal: ViewOnlyBecause | null = workbook.refusalOfEveryEdit();
    let doesKeyAwaitEndOfEntry = isKeyAwaitingEndOfEntry();
    if (
      viewCache?.state !== state ||
      viewCache.yetToGlide !== yetToGlide ||
      viewCache.reads !== reads ||
      viewCache.hasKeyInHandWaitedForPeople !== hasWaitedForPeople ||
      viewCache.doesKeyAwaitEndOfEntry !== doesKeyAwaitEndOfEntry ||
      viewCache.view.viewOnlyBecause !== refusal
    ) {
      let { x, y } = shiftYetToGlide() ?? {
        x: 0,
        y: 0,
      };
      let drawn: PageState =
        yetToGlide === null
          ? state
          : {
              ...state,
              scrollLeft: state.scrollLeft - x,
              scrollTop: state.scrollTop - y,
            };
      let view = pageViewOf(
        drawn,
        reads,
        refusal,
        hasWaitedForPeople,
        yetToGlide === null
          ? null
          : {
              x,
              y,
            },
        doesKeyAwaitEndOfEntry,
      );
      viewCache = {
        state,
        yetToGlide,
        drawn,
        reads,
        hasKeyInHandWaitedForPeople: hasWaitedForPeople,
        doesKeyAwaitEndOfEntry,
        view,
      };
    }
    return viewCache.view;
  }
  function writeXlsxWithCharts(optionsSheetName: string, charts: readonly ChartOfXlsxFile[], fileTitle: string | null): Promise<XlsxFileOutcome> {
    let [firstSheet] = reads.listSheets();
    let standardColors = listPaletteSwatches();
    let asked = {
      nameOfTheSheetOfOptions: optionsSheetName,
      rgbOfStandardColors: standardColors,
      charts: [...charts],
    };
    let settle: (outcome: XlsxFileOutcome) => void = (outcome) => {};
    let promise = new Promise<XlsxFileOutcome>((resolve) => void (settle = resolve));
    let cancel = () => settle(null);
    fileCancellers.add(cancel);
    workbook.xlsxFile(asked, (made: XlsxFileMade) => {
      fileCancellers.delete(cancel);
      if (made === 'threw') return settle(made);
      if (made === null || firstSheet === undefined) return settle(null);
      let { parts, notCarriedOver } = made;
      let filename = xlsxFileName(fileTitle, firstSheet.name);
      return settle({
        filename,
        parts,
        onSaved(went, url) {
          if (isStopped) return;
          dispatch({
            kind: 'xlsxFileSaved',
            went,
            filename,
            url,
            notCarriedOver,
          });
        },
      });
    });
    return promise;
  }
  return {
    dispatch,
    isEventUnfinished,
    isNextEventHandledAtOnce,
    mayAnEntryOpenOrEnd,
    mayWhatACopyHoldsChange,
    isCopyOrCutYetToBeMade: () => heldEvents.some(isCopyRun),
    isCopyOrCutAskedAgain: () => clipboardWrite !== null,
    onceEventsAreFinished(run, ifDropped = () => {}, howHeld) {
      if (isEventUnfinished())
        holdBack({
          run,
          ifDropped,
          ...(howHeld === 'asTypedAhead' && {
            isTypedAhead: true,
          }),
        });
      else run();
    },
    isMoreHeldBehind(run) {
      let runIndex = heldEvents.findIndex((held) => isRunEvent(held) && held.run === run);
      return heldEvents.slice(runIndex + 1).some((held) => !dispatchesNothing(held));
    },
    onceWhatIsShownOfSelectionIsKnown(run) {
      if (isEventUnfinished() || !isSelectionShownKnown())
        holdBack({
          run,
          ifDropped: () => {},
        });
      else run();
    },
    lookOnceEventsAreFinished,
    lookOnceAllIsTaken: runWhenIdle,
    dropWhatIsHeld: dropHeld,
    endWaitForPeople(how) {
      if (how === 'goOn' || peopleWait === null) return peopleWait?.goOnWithKey();
      if (heldEvents.some((held) => !dispatchesNothing(held))) return;
      peopleWait = null;
      return drainQueues();
    },
    noteInputMethodInUse: () => void (isInputMethodInUse = true),
    onAgentAskedUnderAt(listener) {
      agentAskedUnderAtListeners.add(listener);
      return () => void agentAskedUnderAtListeners.delete(listener);
    },
    viewOnceEntryUnderAtIsDropped() {
      let { peopleList } = state;
      if (peopleList === null || peopleList.isOfPeopleAlone) return null;
      let stateWithoutList: PageState = {
        ...state,
        peopleList: null,
      };
      let stateAskingAgent: PageState = selectionForAskingAgent(stateWithoutList, reads, peopleList.cellId);
      return pageViewOf(stateAskingAgent, reads, workbook.refusalOfEveryEdit(), false);
    },
    getView,
    whatColorPickerShows: () => colorPickerChoicesOf(state, reads),
    canAskForCommands: () => browser.agentForCommands.isAvailable(),
    askForCommands: makeAskForCommands(
      browser.agentForCommands,
      () => ({
        areas: areasOfAllRanges(state, reads),
        ownRowOrder: ownRowOrderOfSheet(reads, state.sheetId),
        ...state.selectionSeen,
        currencyShows: exampleOfChoice(state.examplesOfNumberFormats, 'currency'),
      }),
    ),
    nameFlagsByPointer(pointer) {
      let { grid } = getView();
      return presenceFlagsAtPointer(pointer, viewCache?.drawn ?? state, reads, grid);
    },
    errorCountInSelection() {
      let area = workbook.areFormulasLeft() || state.areFormulasShownAsLeft ? null : selectedArea(state, reads);
      let count: number | null = area === null ? null : errorCountInArea(reads, state.sheetId, area);
      return count === 0 ? null : count;
    },
    errorsToTellOfSelection() {
      let area = workbook.areFormulasLeft() || state.areFormulasShownAsLeft ? null : selectedArea(state, reads);
      return area === null ? null : errorsToTellOfSelection(reads, state.sheetId, area, state.activeCell);
    },
    cellsForChartByPage() {
      let area = state.chartsOnOffer[0]?.isForPage === true ? areaToChart(state, reads) : null;
      if (area === null || placeChartForArea(reads, state.sheetId, area) === null) return null;
      return heldAreaOf(reads, state.sheetId, area);
    },
    whyNothingToChart: () => whyNothingToChart(state, reads),
    areTablesAwaitedForChart: () => areTablesForChartPending(state, reads),
    whatChartCardOpensOn: () => whatChartCardOpensOn(state, reads),
    startOfAreaToChart() {
      let area = areaToChart(state, reads);
      return area === null ? null : `${area.topRowIndex},${area.leftColumnIndex}`;
    },
    cellsForChartByAgent() {
      let area = areaToChart(state, reads);
      if (area === null || placeChartForArea(reads, state.sheetId, area) === null) return null;
      let held = heldAreaOf(reads, state.sheetId, area);
      const sampleSize: readonly [number, number] = [CHART_ASK_FIRST_ROWS, CHART_ASK_MAX_COLUMNS];
      let sample = sampleOfAreaForChart(reads, state.sheetId, area, sampleSize);
      return held === null || sample === null
        ? null
        : {
            held,
            ...sample,
          };
    },
    newChartOfCellsHeld(held) {
      let area = areaOfHeld(reads, held);
      return area === null ? null : placeChartForArea(reads, held.sheetId, area);
    },
    async askForEditOfChart(asked): Promise<ChartEditOutcome> {
      if (isStopped) return 'notMade';
      chartEditAskCount += 1;
      let askId = chartEditAskCount;
      let answer = new Promise<ChartEditOutcome>((resolve) => void chartEditAnswers.set(askId, resolve));
      dispatch({
        kind: 'editOfChartAsked',
        asked,
        askId,
      });
      return answer;
    },
    isWorkYetToReachWorkbook,
    isWorkOnItsWayToWorkbook,
    doesLeaveLoseWork,
    areFormulasLeft: () => workbook.areFormulasLeft(),
    isEntryOpen: () => state.mode.kind === 'editing',
    entryToKeep() {
      let { mode, activeCell, peopleList }: PageState = goBackToWords(state, reads);
      if (mode.kind !== 'editing' || peopleList !== null) return null;
      let { looksInHistory, ...modeToKeep } = mode;
      return {
        cellId: activeCell,
        mode: modeToKeep,
      };
    },
    writeCsvFile(workbookTitle) {
      workbook.workOutFormulasLeft();
      if (isStopped) return Promise.resolve(null);
      let sheetId = state.sheetPointedIn ?? state.sheetId;
      return new Promise<CsvFileOfSheet | null>((resolve, reject) => {
        filesAfterFormulas.push({
          run() {
            try {
              let isSheetThere = reads.listSheets().some((sheet) => sheet.sheetId === sheetId);
              resolve(isSheetThere ? csvFileOfSheet(readsAsStored(reads), sheetId, workbookTitle) : null);
            } catch (error: unknown) {
              reject(error);
            }
          },
          ifStoppedFirst: () => resolve(null),
        });
        if (!workbook.areFormulasLeft()) runWhenIdle(runFilesAfterFormulas);
      });
    },
    writeXlsxFile(optionsSheetName, withCharts, fileTitle) {
      let charts = withCharts ? chartsOfWorkbookForXlsx(reads) : [];
      if (charts.length === 0) return writeXlsxWithCharts(optionsSheetName, [], fileTitle);
      chartDescriptions ??= describeChartsForXlsx(charts, {
        ...browser.chartsAreDescribedBy,
        afterMs: (ms: number, then: () => void) => browser.afterMs(ms, then),
        isFileStillWanted: () => !isStopped,
      }).finally(() => void (chartDescriptions = null));
      let descriptions: Promise<ChartOfXlsxFile[]> = chartDescriptions!;
      let cancelled = new Promise<null>((resolve) => {
        let cancel = () => resolve(null);
        let forgetCancel = () => void fileCancellers.delete(cancel);
        fileCancellers.add(cancel);
        descriptions.then(forgetCancel, forgetCancel);
      });
      let written = descriptions.then((described) => {
        if (isStopped) return null;
        return writeXlsxWithCharts(optionsSheetName, described, fileTitle);
      });
      return Promise.race([written, cancelled]);
    },
    place() {
      if (state.gridWidth === 0 || state.gridHeight === 0) return null;
      let { sheetId, activeCell, selectionCorner, scrollLeft, scrollTop, density } = state;
      if (placeCache?.reads !== reads || !isSameCell(placeCache.activeCell, activeCell) || !isSameCell(placeCache.selectionCorner, selectionCorner))
        placeCache = {
          reads,
          activeCell,
          selectionCorner,
          lines: selectionLinesFingerprint(state, reads),
        };
      let { lines } = placeCache;
      return {
        sheetId,
        activeCell,
        selectionCorner,
        scrollLeft,
        scrollTop,
        lines,
        density,
        scrolledForLessRoom: scrolledForLessRoomToKeep(state),
      };
    },
    ownFilters: () =>
      ownFiltersWithoutKey(
        ownFiltersBeforeTry(ownFiltersBeforeRowsTry(state), state.ownFilterTried),
        ownFilterKeyNotDrawnYet(state) ?? state.filterKeptOnForColumnsCard,
        ownFilterKeyNotDrawnYet(state) !== null,
      ),
    linesOnShow: () => linesOnShowOf(state, reads),
    scrollOnShow() {
      if (state.gridWidth === 0 || state.gridHeight === 0) return null;
      let { sheetId, scrollLeft, scrollTop } = showSheetPointedIn(state, reads);
      return {
        sheetId,
        scrollLeft,
        scrollTop,
      };
    },
    viewStore,
    subscribe(listener: () => void): () => void {
      return viewStore.subscribe(() => {
        try {
          listener();
        } catch (error: unknown) {
          if (errorsOfPublishing === null) throw error;
          errorsOfPublishing.push(error);
        }
      });
    },
    isStopped: () => isStopped,
    stop() {
      try {
        if (peopleWait !== null) heldEvents.length = 0;
        peopleWait?.goOnWithKey();
      } finally {
        isStopped = true;
        viewGlide.stop();
        for (let unsubscribe of unsubscribers) unsubscribe();
        for (let cancel of fileCancellers) cancel();
        for (let answer of chartEditAnswers.values()) answer('unsure');
        for (let effect of effectsWaiting.splice(0)) if (isEffectAnEdit(effect)) runEffect(effect);
        for (let sheetId of state.ownRowOrders.keys()) workbook.seeRowsInOwnOrder(sheetId, null, () => {});
        for (let { ifStoppedFirst } of filesAfterFormulas.splice(0)) ifStoppedFirst();
        browser.agentForImport.stop();
        browser.agentForConditionalFormats.stop();
        browser.agentForFormulas.stop();
        browser.agentForRowsAskedFor.stop();
        browser.agentForFixes.stop();
        browser.agentForCommands.stop();
        browser.chartsAreDescribedBy.agent.stop();
        browser.otherViewers.tellOwnSelection(null);
        browser.otherViewers.tellAgentWhatIsSelected({
          byAddress: null,
          chartId: null,
          ownSort: null,
        });
        browser.otherViewers.tellWhomViewFollows(null);
      }
    },
  };
}
/** What the controller publishes to its subscribers: a count that moves on whenever the page's view may have changed. */
export interface SheetPublication {
  published: number;
}
export const WORK_SHOWN_AFTER_MS = 150;
export const CHART_COPY_SLOW_MS = 1000;
export const PEOPLE_LOOKUP_WAIT_MS = 1500;
export const OWED_ASK_WAIT_MS = 2400;
export const PEOPLE_LOOKUP_FRESH_MS = 30000;
export const FIGURES_SETTLE_MS = 100;
export const MAX_CELLS_FOR_QUICK_FIGURES = 100;
export const COPY_ASK_WAIT_MS = 4000;
export const RECENT_ACT_MS = 2000;
export const UNASKED_EVENT_KINDS: ReadonlySet<string> = new Set<string>([
  'workShownLongEnough',
  'contextBarMenuChanged',
  'fillKeyPressedOutsideCells',
  'steppedBackIntoCells',
  'tabGoesOnFromCells',
  'caretAtEndChanged',
  'windowCaretChanged',
  'waysInOutOfSightChanged',
  'marksOfImportOver',
  'commentModeChanged',
  'commentsTold',
  'commentsPointedAt',
  'gridResized',
  'wheelTurned',
  'peopleFound',
  'peopleLookedUp',
  'askOwedToAgentGivenUp',
  'viewerFound',
  'versionsRead',
  'versionLookedAt',
  'cellHistoryRead',
  'selectionsOfOthersChanged',
  'agentActivityChanged',
  'sheetLinkCopyAnswered',
  'xlsxFileSaved',
  'changesByAgentChanged',
  'viewTakenBack',
  'entryCaretMoved',
  'entryLooksChanged',
  'figuresOfSelectionDue',
  'formulaOfferDrawn',
  'formulaOfAgentArrived',
  'pressInListOfFormulaHeld',
  'agentsAnswerSeen',
  'actHeldAtAgentsAnswer',
  'agentForFormulasChecked',
  'agentForConditionalFormatsChecked',
  'followAsked',
  'viewShownByAgentChanged',
  'pointerRested',
  'linkCardLeftByPointer',
  'errorCardPutAway',
  'timeListRowPointedAt',
  'fixPointedAt',
  'cardAskedByRestingPointer',
  'cardOfOptionAsked',
  'cardShut',
  'agentRepliedAboutImport',
  'agentWroteOnAboutImport',
  'findOpened',
  'findClosed',
  'findLookedAgain',
  'versionsLookedAtAgain',
  'listOfKeysAsked',
  'listOfKeysShut',
  'cellHistoryScopeChosen',
  'cellHistoryAskedAgain',
  'cellHistoryLookedAtAgain',
  'cellHistoryShut',
  'ownFilterListShut',
  'xlsxFileDialogShut',
  'caretPlacedInEntry',
  'entryGivenBoxOfItsOwn',
  'cellEntryTyped',
  'wordsOfferedShown',
  'wordsOfferedWithdrawn',
]);
export const WORD_OFFER_EVENT_KINDS: ReadonlySet<string> = new Set<string>(['cellEntryTyped', 'wordsOfferedShown']);
export const isAnswerThatEndsEntryAtOnce = (event: QueuedEvent): boolean =>
  event.kind === 'editAnswered' && event.ifQueued.endsEntryAtOnce === true;
export const isAnswerToEditOrUndo = ({ kind }: QueuedEvent): boolean =>
  kind === 'editAnswered' || kind === 'undoOrRedoAnswered' || kind === 'takeBackAnswered';
export const isCopyOrCutChosen = (event: QueuedEvent): event is CopyOrCutChosen => event.kind === 'copyChosen' || event.kind === 'cutChosen';
export const isTypingEvent = (event: PageEvent, { mode }: PageState): boolean =>
  (event.kind === 'editTextChanged' && mode.kind === 'editing') ||
  (event.kind === 'keyPressed' && isKeyWritingInEntry(mode, event)) ||
  event.kind === 'sheetNameTyped' ||
  event.kind === 'customNumberFormatTyped' ||
  event.kind === 'typedInListOfNumberFormats' ||
  isCopyOrCutChosen(event) ||
  (event.kind === 'dropdownEditorActedIn' && (event.act.kind === 'type' || event.act.kind === 'typeCells')) ||
  (event.kind === 'conditionalFormatsActedIn' && event.act.kind === 'type') ||
  (event.kind === 'sortPaneActedIn' && event.act.kind === 'typeCells') ||
  (event.kind === 'pivotTablePaneActedIn' && (event.act.kind === 'type' || event.act.kind === 'dropTyped')) ||
  (event.kind === 'sidePaneShut' && event.isGivenUp === true);
export const isAgentReplyEvent = (event: PageEvent): boolean =>
  event.kind === 'agentRepliedAboutConditionalFormats' ||
  event.kind === 'agentRepliedWithAFormula' ||
  event.kind === 'agentRepliedWithAFix' ||
  event.kind === 'agentRepliedWhichRowsAreAskedFor' ||
  event.kind === 'ownFiltersLookedAtAgain' ||
  (event.kind === 'conditionalFormatsActedIn' && event.act.kind === 'previewRested');
export const isMenuAskEvent = (event: PageEvent): boolean =>
  event.kind === 'rulesSuggestedInMenu' || event.kind === 'tableToSortAsked' || event.kind === 'whomSortsAreForAsked';
export const isEditsThatTakeBackRead = (event: PageEvent): boolean => event.kind === 'editsThatTakeBackRead';
export const WORKBOOK_CHANGED_WORD: WordOfChange = {
  kind: 'wordOfChange',
  of: 'workbookChanged',
  readsAfter: null,
  tablesRead: null,
  isUnasked: false,
};
export const wordOfChangeWithReads = (
  { of, isUnasked, tablesRead }: WordOfChange,
  readsBefore: ReadsWithTextMeasurer,
): PageEvent => {
  let withTablesRead = tablesRead !== null && {
    tablesRead,
  };
  if (of === 'tablesRead')
    return {
      kind: of,
      ...withTablesRead,
    };
  if (of === 'textMeasuredAnew')
    return {
      kind: of,
      readsBefore,
    };
  return of === 'workbookChanged'
    ? {
        kind: of,
        readsBefore,
        isUnasked,
        ...withTablesRead,
      }
    : {
        kind: of,
        readsBefore,
        ...withTablesRead,
      };
};
export const isRunEvent = (event: HeldItem): event is HeldRun => 'run' in event;
export const isTypedAheadRun = (event: HeldItem): boolean => isRunEvent(event) && event.isTypedAhead === true;
export const isCopyRun = (event: HeldItem): boolean => isRunEvent(event) && event.ofCopy !== undefined;
export const isSamePlaceOfSelection = (before: PageState, after: PageState): boolean =>
  after.mode.kind === before.mode.kind &&
  isSameCell(after.activeCell, before.activeCell) &&
  (after.mode.kind === 'editing' || isSameCell(after.selectionCorner, before.selectionCorner));
export const POINTER_END_EVENT_KINDS: ReadonlySet<string> = new Set<string>(['pointerReleased', 'pointerCanceled']);
export const isMenuChangeThatCounts = (event: PageEvent, areRowsAskedFor: boolean): boolean =>
  event.kind === 'contextBarMenuChanged' && (areRowsAskedFor || event.menu === 'sort' || (event.menu === 'conditionalFormatting' && event.isOpen));
export const dispatchesNothing = (event: HeldItem): boolean =>
  isRunEvent(event)
    ? event.dispatchesNothing === true
    : POINTER_END_EVENT_KINDS.has(event.kind) ||
      UNASKED_EVENT_KINDS.has(event.kind) ||
      event.kind === 'copyRefused' ||
      event.kind === 'editOfChartAsked' ||
      event.kind === 'chartBeingMadeTold' ||
      (event.kind === 'placedViewActedOn' && (event.act.kind === 'leave' || event.act.kind === 'select'));
export const cornerCellsOfArea = (reads: WorkbookReads, { sheetId, area }: Pick<AreaToCopy, 'sheetId' | 'area'>): [CellId | null, CellId | null] => [
  reads.cellIdAt(sheetId, area.topRowIndex, area.leftColumnIndex),
  reads.cellIdAt(sheetId, area.topRowIndex + area.rowCount - 1, area.leftColumnIndex + area.columnCount - 1),
];
export const MAX_COPY_HTML_LOOK_CELLS = 2000;
export const readsWithTextMeasurer = (
  reads: WorkbookReads,
  { lineCountsOfWrappedTexts, widthOfCharacters }: TextMeasurer,
): ReadsWithTextMeasurer => ({
  ...reads,
  lineCountsOfWrappedTexts,
  widthOfCharacters,
});
export const asksForMenu = (event: PageEvent): boolean =>
  event.kind === 'menuAsked' || (event.kind === 'placedViewActedOn' && event.act.kind === 'askForMenu');
export const indexesOfRuns = (runs: readonly LineSpan[]): Set<number> =>
  new Set<number>(
    runs.flatMap(({ firstIndex, count }) =>
      Array.from<unknown, number>(
        {
          length: count,
        },
        (unused, offset) => firstIndex + offset,
      ),
    ),
  );
/** The event of a kind, picked out of every event the page hears. */
type EventOf<Kind extends PageEvent['kind']> = Extract<PageEvent, { kind: Kind }>;
/** The effect of a kind, picked out of every effect the page asks for. */
type EffectOf<Kind extends PageEffect['kind']> = Extract<PageEffect, { kind: Kind }>;
/** The font a text is measured in. */
export type FontToMeasure = Pick<WholeCellFormat['font'], 'size' | 'bold' | 'italic'>;
/** A text whose wrapped lines the browser counts. */
export interface TextToMeasure {
  text: string;
  font: FontToMeasure;
  widthInPixels: number;
  isFormulaTyped?: boolean;
  parts?: readonly WrappedTextPart[];
  /** The level of each line's list, `null` for a line in none. */
  levelsInLists?: readonly (number | null)[];
  isStillTyped?: boolean;
}
/** How the browser measures texts as it draws them. */
export interface TextMeasurer {
  lineCountsOfWrappedTexts(texts: readonly TextToMeasure[]): number[];
  widthOfCharacters(characters: string, font: FontToMeasure): number;
}
/** What the workbook holds, with the browser's measures of text beside it. */
export interface ReadsWithTextMeasurer extends WorkbookReads, TextMeasurer {}
/** How far the view is yet to glide, in pixels. */
export interface ShiftOfView {
  x: number;
  y: number;
}
/** The cells a copy takes: the sheet, the area and the rows left out of it. */
export interface AreaToCopy {
  sheetId: SheetId;
  area: CellArea;
  rowsLeftOut: readonly LineSpan[];
}
/** The two corner cells of a copy, and the runs of rows left out of it. */
export type CopyCorners = [CellId, CellId, IdRun[]];
/** The values of copied cells as the workbook wrote them. */
export interface ValuesOfCopiedCells {
  copiedCellsAsAnswered: string | null;
  values: CopiedValues;
}
/** Everything a copy puts on the clipboard, in each of its forms. */
export interface ClipboardContent {
  cutToken: EffectOf<'putOnClipboard'>['cutToken'];
  copiedCellsAsText: string | null;
  valuesOfCopiedCells: ValuesOfCopiedCells | null;
  textWithNumbersWhole: string;
  localeOfTexts: string | null;
  typed: string;
  text: string;
  html: string;
  areFormulasLeftOut?: true;
}
/** How many rows and columns are left of a copy once it is trimmed to its used cells. */
export interface TrimmedCopySize {
  rowCount: number | undefined;
  columnCount: number | undefined;
}
/** Word that the workbook or the measures of text changed, queued among the events. */
export interface WordOfChange {
  kind: 'wordOfChange';
  of: 'workbookChanged' | 'formulasWorkedOut' | 'textMeasuredAnew' | 'tablesRead';
  readsAfter: ReadsWithTextMeasurer | null;
  tablesRead: ReturnType<OpenedWorkbook['tablesRead']> | null;
  isUnasked: boolean;
}
/** An event the page hears, or word of a change, waiting in the queue. */
export type QueuedEvent = PageEvent | WordOfChange;
/** A copy held back until its cells are read. */
export interface CopyHeld {
  mustStillWait(): boolean;
  calledOff(): void;
}
/** Work held back until the events before it are finished. */
export interface HeldRun {
  run(): void;
  ifDropped(): void;
  ofCopy?: CopyHeld;
  isTypedAhead?: boolean;
  dispatchesNothing?: boolean;
}
/** What is held back: an event, or work to run. */
export type HeldItem = PageEvent | HeldRun;
/** A choice of copy or cut. */
export type CopyOrCutChosen = EventOf<'copyChosen'> | EventOf<'cutChosen'>;
/** When an event is let through: always, unless an answer is missed, or only if it stands whatever is unanswered. */
export type HowEventApplies = 'always' | 'unlessAnAnswerIsMissed' | 'onlyIfItStandsWhateverIsUnanswered';
/** The page after an event, and the effects it asks for. */
/** Hears that the agent was asked about the selection, and whether the person was away. */
export type AgentAskedUnderAtListener = (isAskedWithPersonAway: boolean) => void;
/** An ask owed to the agent while keys are kept off the cells. */
export interface AskOwedToAgent {
  letKeysBack(): void;
  timesLeft: number;
}
/** The rest of an ask ahead of which rows are asked for. */
export type RestOfRowsAsk = EffectOf<'tellAgentWhichRowsAreAskedFor'>['rest'];
/** An ask ahead of which rows are asked for, waiting for the rest of what was typed. */
export interface RowsAskAhead {
  askId: number;
  tell(rest: RestOfRowsAsk): void;
}
/** A key held while people are looked for. */
export interface PeopleWait {
  searchedFor: EffectOf<'waitForPeople'>['searchedFor'];
  goOnWithKey(heldMeanwhile?: HeldItem[]): void;
}
/** A file to write once every formula is worked out. */
export interface FileAfterFormulas {
  run(): void;
  ifStoppedFirst(): void;
}
/** How often the keyboard had left and been pressed when an item was held. */
export interface KeyboardStamp {
  timesLeft: number;
  timesPressed: number;
}
/** The last view drawn, and what it was drawn from. */
export interface ViewCache {
  state: PageState;
  yetToGlide: ShiftOfView | null;
  drawn: PageState;
  reads: ReadsWithTextMeasurer;
  hasKeyInHandWaitedForPeople: boolean;
  doesKeyAwaitEndOfEntry: boolean;
  view: PageView;
}
/** The reads and page a copy was last read ahead for. */
export interface CopyPrefetch {
  reads: ReadsWithTextMeasurer;
  state: PageState;
}
/** The lines of the selection, kept while the selection and the reads stay. */
export interface PlaceCache {
  reads: ReadsWithTextMeasurer;
  activeCell: PageState['activeCell'];
  selectionCorner: PageState['selectionCorner'];
  lines: string | null;
}
/** Where the page is: the sheet, the selection, the scroll and the density. */
export interface PlaceOfView {
  sheetId: SheetId;
  activeCell: PageState['activeCell'];
  selectionCorner: PageState['selectionCorner'];
  scrollLeft: number;
  scrollTop: number;
  lines: string | null;
  density: PageState['density'];
  scrolledForLessRoom: ScrollsForLessRoom | null;
}
/** The sheet on show and how far it is scrolled. */
export interface ScrollOnShow {
  sheetId: SheetId;
  scrollLeft: number;
  scrollTop: number;
}
/** An open entry, kept so it can be brought back. */
export interface EntryToKeep {
  cellId: PageState['activeCell'];
  mode: Omit<Extract<PageState['mode'], { kind: 'editing' }>, 'looksInHistory'>;
}
/** The cells a chart is drawn from, held by the ids of their lines. */
export type CellsHeldForChart = NonNullable<ReturnType<typeof heldAreaOf>>;
/** The cells the agent is asked to chart: those held, and a sample of what they show. */
export type CellsForChartByAgent = { held: CellsHeldForChart } & NonNullable<ReturnType<typeof sampleOfAreaForChart>>;
/** How an ask to edit a chart came out. */
export type ChartEditOutcome = { step: string | null } | 'notMade' | 'full' | 'showsAnother' | 'unsure';
/** What the workbook answers when asked for an xlsx file. */
export type XlsxFileMade = Pick<XlsxFileAnswer, 'parts' | 'notCarriedOver'> | 'threw' | null;
/** A chart as an xlsx file is asked to carry it: the view it is placed by, and how the file's own kind of chart shows it. */
export type ChartOfXlsxFile = NonNullable<ReadXlsxFileRequest['charts']>[number];
/** An xlsx file ready to be saved. */
export interface XlsxFileToSave {
  filename: string;
  parts: XlsxFileAnswer['parts'];
  onSaved(went: EventOf<'xlsxFileSaved'>['went'], url: EventOf<'xlsxFileSaved'>['url']): void;
}
/** How a write of an xlsx file came out. */
export type XlsxFileOutcome = XlsxFileToSave | 'threw' | null;
/** A csv file of a sheet. */
export type CsvFileOfSheet = ReturnType<typeof csvFileOfSheet>;
/** An agent the page asks, and can stop. What it writes before it replies reaches `onWritten`, as `Written` when the page reads it. */
export interface AgentAskedByPage<Asked, Reply, Written = unknown> {
  ask(asked: Asked, onWritten: (written: Written) => void, keepsOtherAsks?: boolean): Promise<Reply>;
  stop(): void;
}
/** An agent the page asks, which may not be there. */
export interface AgentThatMayBeAway<Asked, Reply, Written = unknown> extends AgentAskedByPage<Asked, Reply, Written> {
  isAvailable(): Promise<boolean>;
}
/** The agent asked which rows are asked for, which can be asked ahead. */
export interface AgentForRowsAskedFor
  extends AgentAskedByPage<EffectOf<'askAgentWhichRowsAreAskedFor'>['asked'], EventOf<'agentRepliedWhichRowsAreAskedFor'>['reply']> {
  askIfAllowed(asked: EffectOf<'askAgentWhichRowsAreAskedFor'>['asked']): Promise<EventOf<'agentRepliedWhichRowsAreAskedFor'>['reply']>;
  askAheadIfAllowed(
    words: EffectOf<'askAgentAheadWhichRowsAreAskedFor'>['words'],
    rest: Promise<RestOfRowsAsk>,
  ): Promise<EventOf<'agentRepliedWhichRowsAreAskedFor'>['reply']>;
}
/** The agent that describes charts for an xlsx file, and how it reads the charts. */
export interface ChartDescribers {
  agent: AgentThatMayBeAway<ReturnType<typeof askToDescribeChartsForXlsx>['asked'], Awaited<ReturnType<ReturnType<typeof createAgentSampler>['ask']>>>;
  viewerAllowsAgent(): Promise<boolean>;
  codeOfChart(nodeId: string): Promise<string | null>;
  /** The charts the server can describe for an Excel file itself, by view id. */
  chartsForXlsx?: ChartsForXlsx;
}
/** What the controller needs of the browser and of the page around the sheet. */
export interface BrowserSide extends TextMeasurer {
  onTextMeasuredAnew(onMeasured: () => void): () => void;
  putOnClipboard(content: ClipboardContent): void;
  askBrowserToCopyOrCutCells(asked: 'copy' | 'cut'): void;
  afterMs(ms: number, then: () => void): void;
  nowMs(): number;
  framesToGlideOn(): Window | null;
  keyboard: {
    timesLeft(): number;
    timesPressed(): number;
    isHere(): boolean;
  };
  keepKeysOffCells(onKeyPressed: () => void): () => void;
  people: {
    search(searchedFor: EffectOf<'findPeople'>['searchedFor']): Promise<EventOf<'peopleFound'>['people']>;
    profiles(userIds: EffectOf<'lookUpPeople'>['userIds']): Promise<EventOf<'peopleLookedUp'>['profiles']>;
    viewer(): Promise<{ userId: EventOf<'viewerFound'>['userId'] } | null>;
  };
  offersUnderAt(): EventOf<'offersUnderAtRead'>['offers'];
  otherViewers: RoomPresence;
  agentForImport: AgentAskedByPage<
    EffectOf<'askAgentAboutImport'>['asked'],
    EventOf<'agentRepliedAboutImport'>['reply'],
    EventOf<'agentWroteOnAboutImport'>['written']
  >;
  agentForConditionalFormats: AgentThatMayBeAway<
    EffectOf<'askAgentAboutConditionalFormats'>['asked'],
    EventOf<'agentRepliedAboutConditionalFormats'>['reply']
  >;
  agentForRowsAskedFor: AgentForRowsAskedFor;
  agentForFormulas: AgentThatMayBeAway<
    EffectOf<'askAgentForAFormula'>['asked'] | EffectOf<'askAgentForANumberFormat'>['asked'],
    EventOf<'agentRepliedWithAFormula'>['reply']
  >;
  agentForFixes: AgentAskedByPage<EffectOf<'askAgentForAFix'>['asked'], EventOf<'agentRepliedWithAFix'>['reply']>;
  agentForCommands: Pick<AgentSampler, 'ask' | 'stop' | 'isAvailable'>;
  chartsAreDescribedBy: ChartDescribers;
  versionHistory: {
    versions(before: EffectOf<'readVersions'>['before']): Promise<EventOf<'versionsRead'>['read']>;
    changesOfRow(cell: EffectOf<'readCellHistory'>['cell'], isStillAwaited: () => boolean): Promise<EventOf<'cellHistoryRead'>['read']>;
    changesOfCell(cell: EffectOf<'readCellHistory'>['cell'], isStillAwaited: () => boolean): Promise<EventOf<'cellHistoryRead'>['read']>;
    editsThatTakeBack(asked: EffectOf<'readEditsThatTakeBack'>['asked']): Promise<EventOf<'editsThatTakeBackRead'>['read']>;
  };
  versionLooks: {
    lookAt(
      revision: EffectOf<'lookAtVersion'>['revision'],
      pane: EffectOf<'lookAtVersion'>['pane'],
      stateNow: () => PageState,
    ): Promise<EventOf<'versionLookedAt'>['whyNot']>;
    end(pane: EffectOf<'endLookAtVersion'>['pane'], state: PageState, thenRestore: EffectOf<'endLookAtVersion'>['thenRestore'], isByPerson: boolean): void;
  };
  chartNodes: {
    copy(sources: EffectOf<'copyChartNodes'>['sources']): Promise<EventOf<'chartNodesCopied'>['copies']>;
    discard(copies: EffectOf<'discardChartNodes'>['copies']): void;
  };
  copyLinkToSheet(sheetId: EffectOf<'copyLinkToSheet'>['sheetId']): Promise<EventOf<'sheetLinkCopyAnswered'>['whyNot']>;
  comments: {
    openBox(asked: EffectOf<'openCommentBox'>): void;
    open(handle: EffectOf<'openComment'>['handle'], isKeyboardLeft: boolean): void;
    shut(): void;
    shutBox(): void;
    endMode(isAskNext: EffectOf<'endCommentMode'>['isAskNext']): void;
  };
  rulesTook?(event: PageEvent | null, stateBefore: PageState, reduced: PageTransition, readsUsed: ReadsWithTextMeasurer): void;
}
/** The controller of one sheet page: it hears events, runs their effects and publishes the view. */
export interface SheetController {
  dispatch(event: PageEvent): void;
  isEventUnfinished(): boolean;
  isNextEventHandledAtOnce(): boolean;
  mayAnEntryOpenOrEnd(): boolean;
  mayWhatACopyHoldsChange(): boolean;
  isCopyOrCutYetToBeMade(): boolean;
  isCopyOrCutAskedAgain(): boolean;
  onceEventsAreFinished(run: () => void, ifDropped?: () => void, howHeld?: 'asTypedAhead'): void;
  isMoreHeldBehind(run: () => void): boolean;
  onceWhatIsShownOfSelectionIsKnown(run: () => void): void;
  lookOnceEventsAreFinished(look: () => void): void;
  lookOnceAllIsTaken(look: () => void): void;
  dropWhatIsHeld(): void;
  endWaitForPeople(how: 'goOn' | 'callOff'): void;
  noteInputMethodInUse(): void;
  onAgentAskedUnderAt(listener: AgentAskedUnderAtListener): () => void;
  viewOnceEntryUnderAtIsDropped(): PageView | null;
  getView(): PageView;
  whatColorPickerShows(): ColorPickerChoices;
  canAskForCommands(): Promise<boolean>;
  askForCommands: ReturnType<typeof makeAskForCommands>;
  nameFlagsByPointer(pointer: Parameters<typeof presenceFlagsAtPointer>[0]): ReturnType<typeof presenceFlagsAtPointer>;
  errorCountInSelection(): number | null;
  errorsToTellOfSelection(): ReturnType<typeof errorsToTellOfSelection> | null;
  cellsForChartByPage(): CellsHeldForChart | null;
  whyNothingToChart(): WhyNothingToChart | null;
  areTablesAwaitedForChart(): boolean;
  whatChartCardOpensOn(): ChartCardOpening;
  startOfAreaToChart(): string | null;
  cellsForChartByAgent(): CellsForChartByAgent | null;
  newChartOfCellsHeld(held: CellsHeldForChart): ReturnType<typeof placeChartForArea>;
  askForEditOfChart(asked: EventOf<'editOfChartAsked'>['asked']): Promise<ChartEditOutcome>;
  isWorkYetToReachWorkbook(): boolean;
  isWorkOnItsWayToWorkbook(): boolean;
  doesLeaveLoseWork(): boolean;
  areFormulasLeft(): boolean;
  isEntryOpen(): boolean;
  entryToKeep(): EntryToKeep | null;
  writeCsvFile(workbookTitle: string | null): Promise<CsvFileOfSheet | null>;
  writeXlsxFile(optionsSheetName: string, withCharts: boolean, fileTitle: string | null): Promise<XlsxFileOutcome>;
  place(): PlaceOfView | null;
  ownFilters(): PageState['ownFilters'];
  linesOnShow(): ReturnType<typeof linesOnShowOf>;
  scrollOnShow(): ScrollOnShow | null;
  viewStore: StoreApi<SheetPublication>;
  subscribe(listener: () => void): () => void;
  isStopped(): boolean;
  stop(): void;
}
