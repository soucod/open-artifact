import type { SheetsHost } from '../host/sheets-host.ts';
import type { ConnectionListeners, ConnectionPage } from '../store/sheet-connection.ts';
import type { PlaceholderNotice } from '../placeholder/sheet-placeholder.tsx';
import type { OpenedWorkbook } from '../engine/worker-workbook.ts';
import type { ChartsForXlsx } from '../export/xlsx-chart-descriptions.ts';
import { NO_FILES_FOR_AGENT, createFilesForAgent } from '../agent/files-for-agent.ts';
import { watchTabVisibility } from './tab-visibility.ts';
import {
  createKeysOffCellsGuard,
  setCellsTakeNoText,
  noteSomethingKeptOff,
  releaseOwedKeptOffNotice,
  keepSheetFieldTapsInside,
  makeKeepKeysOffCells,
} from './keys-off-cells.ts';
import { isGridOrGridPopupTrigger } from '../dom/grid-role.ts';
import { hasBottomSafeArea } from '../shell/bottom-insets.ts';
import { createPersonInputWatch } from './input-watch.ts';
import { stopReplayedKeydowns } from './replayed-keys.ts';
import { yieldF6ToToasts } from './f6-guard.ts';
import { hasInteractiveToast, setUpUiRootElement } from '../shell/ui-root.tsx';
import { restoreChosenTheme } from '../shell/root-theme.ts';
import { preloadMonoFont } from '../grid/cell-drawing.tsx';
import { forbidFramesInDocument, createChartFrameDocumentSource, INTERACTIVE_FRAME_FILE } from '../charts/frame-document.ts';
import { createWordsOfLoad } from '../shell/load-announcer.ts';
import { createSheetPlaceholder } from '../placeholder/sheet-placeholder.tsx';
import { reportErrorSoftly, loadSheetsEngineOnce, reportErrorsSoftlyAt } from '../engine/loader.ts';
import { readStoredZoom } from '../grid/zoom.ts';
import { installPageGuards, offerOverlayClosing } from './page-guards.ts';
import { throttleViewChanges } from '../shell/view-throttle.ts';
import { mountSheetStatusAnnouncer, sheetProblemSummary, sheetStatusOf } from '../shell/sheet-status.ts';
import { createConnectionNews, type ConnectionNews } from '../shell/connection-news.ts';
import { openSheetConnection } from '../store/sheet-connection.ts';
import { openSheetStream } from '../store/sheet-stream.ts';
import { browserTimeZone, browserLocales } from './browser-locale.ts';
import { isConnectionNewsCoveredBySaveCard } from '../ui/save-status.tsx';
import { createFrameChrome } from '../shell/frame-chrome.ts';
import { setTopLayerCloseOfferer } from '../shell/top-layer-close.ts';
import { drawWorkbook } from './draw-workbook.tsx';
import { createSheetAnchorLinks, createGuideFromStream } from '../shell/sheet-links.ts';
import { createCsvExport, type FileExportDeps } from '../export/file-export.ts';
import { createXlsxDownload } from '../export/xlsx-download.ts';
import { deflateRawCompressor } from '../export/zip.ts';
import { createAgentSampler, createCommandsSamplerWithoutAgent, askSamplingPermission } from '../agent/sampling.ts';
import { createChatWithAgent } from '../agent/chat-with-agent.ts';
import { createHostComments, commentsForOtherSheet } from '../comments/agent-ai-comments.ts';
import { createChangesByAgentTracker } from '../agent/changes-by-agent.ts';
import { createChartCodeStore, waitForChartCode } from '../charts/chart-code.ts';
import { createVersionHistoryReader } from '../history/history-reader.ts';
import { createEarlierVersionLooks, createChartSends } from '../history/earlier-version.ts';
import { createChartWidgetNodes } from '../charts/widget-nodes.ts';
import { chartKindName } from '../charts/chart-words.ts';
import { createChartEditsByAgent, createChartNodeCopier } from '../charts/agent-edits.ts';
import { createStockChartMaker, createChartWriterByAgent, NO_CHART_MAKER } from '../charts/new-charts.ts';
import { createTurnChangesTracker, withTurnTakeBackGuard } from '../agent/turn-changes.ts';
import { createWorkbookPainter } from './workbook-painter.ts';
import { interactiveBeingStarted } from './interactive-being-started.ts';
import { afterNextFrameOrTimeout } from '../utils/next-frame.ts';
import { inertRoomPresence } from '../presence/selections.ts';
import { createPeopleDirectory } from '../presence/people.ts';
import { createRoomPresence, watchPeersHere } from '../presence/room.ts';
import { createAgentActivityWatcher } from '../agent/activity.ts';
import { NO_VIEW_SHOWN_BY_AGENT } from '../agent/view-shown-feed.ts';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { SheetPeers } from '../shell/SheetPeers.tsx';
import { PageCommentsLayer } from '../comments/PageCommentsLayer.tsx';

export interface BootOptions {
  host: SheetsHost;
  app: HTMLElement;
}

export const EXPORT_LABELS = { csv: 'CSV', xlsx: 'Excel' } as const;

const wait = (ms: number): Promise<void> => new Promise((resolve) => void setTimeout(resolve, ms));

export async function bootSheetsPage({ host, app }: BootOptions): Promise<void> {
  const getPage = () => host.page;
  const people = createPeopleDirectory(host.page);
  const otherViewers = createRoomPresence(window, host.page, people);
  const agentActivity = createAgentActivityWatcher(host, window);
  let keepKeysOffCells = createKeysOffCellsGuard(window, {
    isField: (element) =>
      element instanceof HTMLElement && (element.isContentEditable || element.matches('input, textarea')) && !isGridOrGridPopupTrigger(element),
    isOfCells: (element) => element === document.body || (element instanceof Element && isGridOrGridPopupTrigger(element)),
    cellsTakeNoText: setCellsTakeNoText,
    somethingWasKeptOff: noteSomethingKeptOff,
    noticeNeedNotWait: releaseOwedKeptOffNotice,
    hasKeyboard: () => document.hasFocus(),
    isBoxInSight: () => hasBottomSafeArea() === true,
  });
  let actsHeard = createPersonInputWatch(window, () => performance.now());
  stopReplayedKeydowns(window, (target) => target instanceof Element && isGridOrGridPopupTrigger(target));
  yieldF6ToToasts(window, () => hasInteractiveToast(app.ownerDocument));
  let isIosInFrame = window.parent !== window && CSS.supports('-webkit-touch-callout', 'none');
  if (isIosInFrame) keepSheetFieldTapsInside(app.ownerDocument);
  restoreChosenTheme(app.ownerDocument.documentElement);
  setUpUiRootElement(app.ownerDocument.documentElement);
  preloadMonoFont(app.ownerDocument.documentElement);
  forbidFramesInDocument(app.ownerDocument);
  let makeDiv = (className: string) => Object.assign(app.ownerDocument.createElement('div'), { className });
  let cellsMount = makeDiv('');
  let placeholderMount = makeDiv('sheet-placeholder-mount');
  let stage = makeDiv('sheets-stage');
  stage.append(cellsMount, placeholderMount);
  app.after(stage);
  let statusRegion = makeDiv('is-only-said');
  statusRegion.setAttribute('role', 'status');
  stage.after(statusRegion);
  let wordsOfLoad = createWordsOfLoad(
    (words) => void (statusRegion.textContent = words),
    {
      doCellsHaveKeyboard: () => app.ownerDocument.hasFocus() && cellsMount.contains(app.ownerDocument.activeElement),
      isLoadUnseen: () => false,
    },
    window,
  );
  cellsMount.addEventListener('focusin', () => wordsOfLoad.cellsTakeKeyboard());
  let placeholder = createSheetPlaceholder(
    placeholderMount,
    (error) => {
      reportErrorSoftly(error, 'draw');
      refreshPage();
    },
    null,
    () => readStoredZoom(() => sessionStorage),
  );
  installPageGuards(window);
  let showSheetStatus = throttleViewChanges(mountSheetStatusAnnouncer(app), window);
  let page: ConnectionPage | null = null;
  let guideFromAgent = createGuideFromStream(() => sessionStorage);
  host.onWalkthrough((walkthrough) => guideFromAgent.heardOnStream({ phase: 'guide', guide: walkthrough }));
  let stopConnection: (() => void) | null = null;
  let connect = () => {
    stopConnection?.();
    stopConnection = openSheetConnection(
      (options) =>
        openSheetStream(Promise.resolve(host.caps.sheet), {
          ...options,
          onEvent(event) {
            if (event.kind === 'frame') guideFromAgent.heardOnStream(event.frame);
            options.onEvent(event);
          },
        }),
      loadSheetsEngineOnce,
      (nextPage) => {
        page = nextPage;
        let openWorkbook = nextPage.workbook.kind === 'open' ? nextPage.workbook.workbook : null;
        frameChrome.follow(openWorkbook);
        painter.ownIs(earlierVersionLooks.drawnInPlaceOf(openWorkbook));
        refreshPage();
      },
      watchTabVisibility,
      {
        streamChanged() {
          changesByAgent.streamChanged();
          turnChanges.streamChanged();
        },
        editByAgentStreamed(...args: Parameters<ConnectionListeners['editByAgentStreamed']>) {
          changesByAgent.editByAgentStreamed(...args);
          // The turn tracker takes the first two arguments only.
          (turnChanges.editByAgentStreamed as ConnectionListeners['editByAgentStreamed'])(...args);
        },
        editsOfOthersMade(...args: Parameters<ConnectionListeners['editsOfOthersMade']>) {
          changesByAgent.editsOfOthersMade(...args);
          turnChanges.editsOfOthersMade(...args);
        },
        revisionStated: turnChanges.revisionStated,
        changesMayBeMissed: turnChanges.changesMayBeMissed,
        caughtUpByLoad(load) {
          changesByAgent.caughtUpByLoad(load);
          turnChanges.caughtUpByLoad(load);
        },
      },
      browserTimeZone(),
      () => (agentActivity.hasShellAnswered() && !agentActivity.isWorking() ? browserLocales() : null),
      undefined,
      {
        ...chartCode,
        streamOpened(stream) {
          chartCode.streamOpened(stream);
          chartsRunOn.frameDocument.askAgainIfItDidNotCome();
          interactivesRunOn.frameDocument.askAgainIfItDidNotCome();
        },
      },
      {
        workbookOpened(node) {
          versionHistoryReader.workbookOpened(node);
          chartWidgetNodes.workbookOpened(node);
        },
        asItWas: (asked, answer) => versionHistoryReader.asItWas(asked, answer),
      },
      undefined,
      undefined,
      agentActivity.rest,
    );
  };
  let connectionNews: ConnectionNews = createConnectionNews();
  let refreshPage = () => {
    let isLiveAndDrawn = painter.state() === 'drawn' && page?.connection.kind === 'open';
    let pageState: ConnectionPage | null = page !== null && painter.state() === 'failed' ? { ...page, workbook: { kind: 'failed', mayPass: false } } : page;
    let placeholderProblem = problemToShow(pageState);
    let partLoaded = pageState?.workbook.kind === 'opening' ? pageState.workbook.partLoaded : null;
    let isPlaceholderShown = painter.state() !== 'drawn' && placeholder.show(placeholderProblem, partLoaded);
    let problemSummary = pageState === null ? null : sheetProblemSummary(pageState);
    let isStatusShownElsewhere =
      isPlaceholderShown ||
      (painter.state() === 'drawn' &&
        pageState?.workbook.kind === 'open' &&
        isConnectionNewsCoveredBySaveCard(pageState.workbook.workbook.saving(), problemSummary));
    app.classList.toggle('is-only-said', isLiveAndDrawn || isStatusShownElsewhere);
    let isStatusNotNeeded = isLiveAndDrawn || (painter.state() === 'drawn' && problemSummary?.mayPass === true);
    if (pageState !== null)
      showSheetStatus(isStatusNotNeeded ? null : pageState, isPlaceholderShown && placeholderProblem !== null && placeholderProblem.wayOut !== null);
    if (pageState !== null && painter.state() !== 'drawn') {
      let { kind: statusKind, inWords } = sheetStatusOf(pageState);
      if (statusKind === 'onItsWay') wordsOfLoad.loadIsOnItsWay(inWords);
      else if (pageState.workbook.kind !== 'open') wordsOfLoad.loadHasStopped();
    }
    connectionNews.tell(problemSummary);
  };
  let problemToShow = (pageState: ConnectionPage | null): PlaceholderNotice | null => {
    let sheetStatus = pageState === null ? null : sheetStatusOf(pageState);
    if (sheetStatus === null || sheetStatus.kind === 'onItsWay') return null;
    let { inWords, shownAs, kind } = sheetStatus;
    if (kind === 'mayPass') return { inWords, shownAs, wayOut: { kind: 'tryAgain', take: () => connect() } };
    return { inWords, shownAs, wayOut: null };
  };
  let frameChrome = createFrameChrome({ bridge: host.bridge, shell: () => host.shell, window, exportLabels: EXPORT_LABELS });
  const peersMount = app.ownerDocument.createElement('div');
  stage.before(peersMount);
  createRoot(peersMount).render(createElement(SheetPeers, { host, chrome: frameChrome }));
  host.bridge.startShell();
  if (host.shell) watchPeersHere(host.page, (peers) => frameChrome.peersHere(peers));
  offerOverlayClosing(stage, frameChrome);
  setTopLayerCloseOfferer((closeOffer) => frameChrome.offerCloseOfTopLayer('ofPage', closeOffer));
  let sheetLinks = createSheetAnchorLinks(window, () => sessionStorage, host.shell);
  let reportSoftly = reportErrorsSoftlyAt(null);
  let exportDeps: FileExportDeps = { shell: frameChrome, downloads: () => host.caps.downloads, report: reportErrorsSoftlyAt('exports') };
  let csvExport = createCsvExport(exportDeps);
  let xlsxDownload = createXlsxDownload(exportDeps, deflateRawCompressor());
  // "Import from Excel": an .xlsx file the person picks goes to the server, which keeps it in imports/ and asks the agent.
  let filesForAgent = createFilesForAgent({
    sheet: host.caps.sheet,
    canImport: host.abilities.canEdit && host.abilities.canAsk,
    agent: host.caps.agent === null ? null : host,
  });
  let agentForImport = createAgentSampler(getPage, reportSoftly);
  let agentForConditionalFormats = createAgentSampler(getPage, reportSoftly, { mendsReplies: true });
  let agentForRowsAskedFor = createAgentSampler(getPage, reportSoftly, { mendsReplies: true });
  let agentForFormulas = createAgentSampler(getPage, reportSoftly);
  let agentForFixes = createAgentSampler(getPage, reportSoftly);
  let agentForCommands = createCommandsSamplerWithoutAgent(reportSoftly);
  let chatWithAgent = createChatWithAgent(getPage, reportSoftly, () => frameChrome.saysLeaveLosesWork());
  let hostComments = createHostComments(getPage, reportSoftly, () => keepKeysOffCells(true));
  let changesByAgent = createChangesByAgentTracker(agentActivity);
  let chartCode = createChartCodeStore({ newOpId: () => crypto.randomUUID(), wait });
  let versionHistoryReader = createVersionHistoryReader({ newOpId: () => crypto.randomUUID(), wait });
  let ownWorkbook = () => (page?.workbook.kind === 'open' ? page.workbook.workbook : null);
  let earlierVersionLooks = createEarlierVersionLooks({
    history: versionHistoryReader,
    own: ownWorkbook,
    drawAgain() {
      painter.ownIs(earlierVersionLooks.drawnInPlaceOf(ownWorkbook()));
      refreshPage();
    },
    isChartBeingSent: () => chartSends.isSending(),
    timesChartsWereSent: () => chartSends.timesSent(),
    untilSaved: (workbook) =>
      new Promise<void>((resolve) => {
        if (!workbook.hasUnsavedEdits()) return resolve();
        let finish = () => {
          stopWatching();
          clearTimeout(timer);
          resolve();
        };
        let stopWatching = workbook.onSavingChanged(() => {
          if (!workbook.hasUnsavedEdits()) finish();
        });
        let timer = setTimeout(finish, UNTIL_SAVED_TIMEOUT_MS);
      }),
  });
  let chartsRunOn = { code: chartCode, frameDocument: createChartFrameDocumentSource() };
  let interactivesRunOn = {
    code: chartCode,
    frameDocument: createChartFrameDocumentSource(undefined, INTERACTIVE_FRAME_FILE),
    beingStarted: interactiveBeingStarted(() => sessionStorage),
  };
  let chartWidgetNodes = createChartWidgetNodes({ newOpId: () => crypto.randomUUID(), wait, nameOfKind: chartKindName });
  let chartSends = createChartSends(
    createChartEditsByAgent(chartWidgetNodes, createAgentSampler(getPage, reportSoftly, { mendsReplies: true, modelTier: 'default' })),
    createStockChartMaker(chartWidgetNodes),
    createChartWriterByAgent(chartWidgetNodes, createAgentSampler(getPage, reportSoftly, { mendsReplies: true, modelTier: 'default' })),
  );
  let turnChanges = createTurnChangesTracker(agentActivity);
  let lastCellsHoldSomething: boolean | null = null;
  let areCellsShown = false;
  let painter = createWorkbookPainter({
    draw: (workbook: OpenedWorkbook, onFailed) =>
      drawWorkbook(
        workbook,
        cellsMount,
        onFailed,
        {
          ...frameChrome,
          cellsAreMeasured(): void {
            placeholder.takeOffAfterNextPaint();
            if (!cellsMount.hasChildNodes()) return;
            afterNextFrameOrTimeout(window, () => {
              if (painter.state() !== 'drawn' || !cellsMount.hasChildNodes()) return;
              wordsOfLoad.cellsAreDrawn();
              areCellsShown = true;
              frameChrome.cellsHoldSomething(lastCellsHoldSomething);
            });
          },
          cellsHoldSomething(holdsSomething) {
            lastCellsHoldSomething = holdsSomething;
            if (holdsSomething === null) areCellsShown = false;
            if (holdsSomething === null || areCellsShown) frameChrome.cellsHoldSomething(holdsSomething);
          },
          entryIsOpen() {},
          csvFileCanBeWritten: csvExport.offer,
          xlsxFileCanBeWritten: xlsxDownload.offer,
          agentActivity,
          links: sheetLinks,
          changesByAgent: workbook === ownWorkbook() ? changesByAgent : { onChanged: () => () => {} },
          changedInTurnOfAgent: turnChanges.changedInTurn,
          isSheetJustMade: () => page?.isSheetJustMade() === true,
          viewer: () => page?.viewer ?? null,
          agentForImport,
          agentForConditionalFormats,
          agentForRowsAskedFor,
          agentForFormulas,
          agentForFixes,
          agentForCommands,
          chartsAreDescribedBy: {
            agent: createAgentSampler(getPage, reportSoftly),
            viewerAllowsAgent: askSamplingPermission(getPage),
            codeOfChart: (chart) =>
              waitForChartCode(chartCode, chart, (ms, callback) => void setTimeout(callback, ms)),
            // The server describes the charts its stock programs draw, as the Excel file's own charts.
            chartsForXlsx: async (viewIds: readonly string[]) => {
              const answer = await host.caps.sheet?.read({ kind: 'xlsxCharts', charts: viewIds.map((viewId) => ({ viewId })) });
              return answer !== undefined && answer.kind === 'xlsxCharts' ? answer.descriptions : [];
            },
          },
          versionHistory: withTurnTakeBackGuard(versionHistoryReader, turnChanges.changedInTurn),
          versionLooks: earlierVersionLooks,
          chatWithAgent,
          chartsMadeByPage: workbook !== ownWorkbook() ? NO_CHART_MAKER : chartSends.made,
          comments: workbook === ownWorkbook() ? hostComments : commentsForOtherSheet(hostComments),
          commentsLayer: workbook === ownWorkbook() ? createElement(PageCommentsLayer) : null,
          chartsRunOn,
          interactivesRunOn,
          ...(workbook === ownWorkbook() && { changesOfCharts: chartSends.changes, chartsWrittenByAgent: chartSends.written }),
          filesForAgent: workbook === ownWorkbook() ? filesForAgent : NO_FILES_FOR_AGENT,
          chartNodes: createChartNodeCopier(chartWidgetNodes, reportErrorsSoftlyAt('charts')),
          viewShownByAgent: NO_VIEW_SHOWN_BY_AGENT,
          guideFromAgent,
          keepKeysOffCells: makeKeepKeysOffCells(() => keepKeysOffCells(true, true)),
          connectionNews,
          wordsOfLoad,
          actsHeard,
          oncePlaceholderIsOff: (whenOff) => placeholder.onceOff(whenOff),
          keepPlaceholderOn: () => placeholder.keepOn(),
        },
        people,
        workbook === ownWorkbook() ? otherViewers : inertRoomPresence,
      ),
    report: reportErrorsSoftlyAt('draw'),
    onFailedLater: refreshPage,
  });
  refreshPage();
  connect();
}

export const UNTIL_SAVED_TIMEOUT_MS = 3000;
