import * as React from 'react';
import * as ReactDOMClient from 'react-dom/client';
import * as ReactDOM from 'react-dom';
import { createZoomStore } from '../grid/zoom.ts';
import { forgetKeptPlace, takePlaceToOpenOn, keepPlaceAcrossReloads } from '../store/kept-place.ts';
import { clearKeptOwnFilters, keepOwnFiltersAcrossReloads } from '../tables/kept-own-filters.ts';
import {
  forgetStoredCaretPlace,
  takeStoredCaretPlace,
  doCellsTakeCaretAtStart,
  isKeyboardHandedOverAtStart,
  shouldFocusEntryAtStart,
  isKeyForCellsAtStart,
  keepCaretPlaceStored,
} from '../state/caret-memory.ts';
import { forgetKeptEntry, takeKeptEntry, bringBackKeptEntry, keepEntryWhilePageIsLeft } from '../editor/kept-entry.ts';
import { renderInSheetsRoot } from '../shell/ui-root.tsx';
import { createDomTextMeasurer } from '../grid/dom-text-measurer.ts';
import { readsWithTextMeasurer, createSheetController } from '../state/controller.ts';
import { createInitialPageState } from '../state/initial-state.ts';
import { hasStoredStepsToUndo, keepStepsToUndoFlag } from '../history/kept-steps-to-undo.ts';
import { readStoredDensity } from './density-preference.ts';
import { readTablesNotFormatted } from '../tables/tables-not-formatted.ts';
import { importFileChoices } from '../import/csv-file.tsx';
import { createSheetClipboard } from '../clipboard/page-clipboard.ts';
import { sha256Hex } from '../utils/sha256.ts';
import { afterNextFrameOrTimeout } from '../utils/next-frame.ts';
import { createPressTracker } from './press-tracker.ts';
import { createSheetCommentActions, previewCommentCardOnItsPoint, commentCardPlaces } from '../comments/card-places.ts';
import { createCommentCardOnTap, createMouseAroundComments } from '../comments/mouse-around.ts';
import { atMenuOffers } from '../i18n/menu-labels.ts';
import { isChatBesidePage } from '../agent/chat-or-comment.ts';
import { agentActivityChangedEvent } from '../agent/turn-of-agent.ts';
import { AnnounceActiveCellContext } from '../grid/cell-drawing.tsx';
import { IS_APPLE_PLATFORM } from '../ui/dom-events.ts';
import { SheetsPage } from './sheet-page.tsx';
import { dropdownOptionsLabel } from '../export/export-ready-dialog.tsx';
import { syncShownSheetWithLinks, listenForCopySheetLinkShortcut, goToPlace } from '../links/sheet-link-sync.ts';
import { isGridOrGridPopupTrigger } from '../dom/grid-role.ts';
import { watchAgentActivity } from '../agent/activity.ts';
import type { AgentActivity } from '../agent/activity.ts';
import type { OpenedWorkbook } from '../engine/worker-workbook.ts';
import type { BrowserSide } from '../state/controller.ts';
import type { ChangedInTurnOfAgent } from '../state/event-reducer.ts';
import type { CaretAtStart } from '../state/caret-memory.ts';
import type { KeptOwnFiltersStorages } from '../tables/kept-own-filters.ts';
import type { ZoomStore } from '../grid/zoom.ts';
import type { FrameChrome } from '../shell/frame-chrome.ts';
import type { SheetLinks, GuideFromStream } from '../shell/sheet-links.ts';
import type { ConnectionNews } from '../shell/connection-news.ts';
import type { WordsOfLoad } from '../shell/load-announcer.ts';
import type { CsvExport } from '../export/file-export.ts';
import type { XlsxDownload } from '../export/xlsx-download.ts';
import type { EarlierVersionLooks } from '../history/earlier-version.ts';
import type { HostComments } from '../comments/agent-ai-comments.ts';
import type { ChatWithAgent } from '../agent/chat-with-agent.ts';
import type { ChangesByAgentTracker } from '../agent/changes-by-agent.ts';
import type { ViewShownByAgentFeed } from '../agent/view-shown-feed.ts';
import type { ChartsRunOn } from '../charts/placed-views-layer.tsx';
import type { PersonInputWatch } from './input-watch.ts';
import type { SheetsPageProps, SheetsPageShell } from './sheet-page.tsx';
/** What the frame around the page gives a drawn workbook, and hears from it. */
export interface WorkbookShell
  extends SheetsPageShell,
    Pick<FrameChrome, 'entryIsChanged' | 'offerFollow' | 'followsTab' | 'cellsHoldSomething'>,
    Pick<
      BrowserSide,
      | 'keepKeysOffCells'
      | 'agentForImport'
      | 'agentForConditionalFormats'
      | 'agentForRowsAskedFor'
      | 'agentForFormulas'
      | 'agentForFixes'
      | 'agentForCommands'
      | 'chartsAreDescribedBy'
      | 'versionHistory'
      | 'chartNodes'
    >,
    Pick<SheetsPageProps, 'chartsMadeByPage' | 'interactivesRunOn' | 'changesOfCharts' | 'chartsWrittenByAgent' | 'filesForAgent' | 'commentsLayer'> {
  /** The person viewing, once known. */
  viewer(): string | null;
  links: SheetLinks;
  versionLooks: EarlierVersionLooks;
  comments: HostComments;
  chatWithAgent: ChatWithAgent;
  chartsRunOn: ChartsRunOn;
  agentActivity: AgentActivity;
  actsHeard: PersonInputWatch;
  connectionNews: ConnectionNews;
  wordsOfLoad: WordsOfLoad;
  oncePlaceholderIsOff(run: () => void): () => void;
  keepPlaceholderOn(): () => boolean;
  guideFromAgent: GuideFromStream;
  isSheetJustMade(): boolean;
  changedInTurnOfAgent(): ChangedInTurnOfAgent | null;
  changesByAgent: Pick<ChangesByAgentTracker, 'onChanged'>;
  entryIsOpen(isOpen: boolean): void;
  csvFileCanBeWritten: CsvExport['offer'];
  xlsxFileCanBeWritten: XlsxDownload['offer'];
  viewShownByAgent: ViewShownByAgentFeed;
}
export function drawWorkbook(
  workbook: OpenedWorkbook,
  mountElement: HTMLElement,
  onFailed: (error: unknown) => void,
  shell: WorkbookShell,
  people: BrowserSide['people'],
  otherViewers: BrowserSide['otherViewers'],
): () => void {
  let zoom = createZoomStore(findTabStorage);
  let forgetKeptState = () => {
    forgetKeptPlace(storagesForViewer(shell.viewer));
    clearKeptOwnFilters(storagesForViewer(shell.viewer));
    forgetStoredCaretPlace(findTabStorage);
    forgetKeptEntry(findTabStorage);
    zoom.set(1);
  };
  let failAndForget = (error: unknown) => {
    forgetKeptState();
    onFailed(error);
  };
  let hasDrawn = false;
  let errorWhileDrawing: unknown;
  let reactRoot = ReactDOMClient.createRoot(mountElement, {
    onUncaughtError(error) {
      if (hasDrawn) failAndForget(error);
      else errorWhileDrawing = error;
    },
  });
  try {
    let stopOrError = mountSheetsApp(reactRoot, zoom, workbook, mountElement, shell, people, otherViewers);
    hasDrawn = true;
    return stopOrError;
  } catch (stopOrError) {
    reactRoot.unmount();
    mountElement.classList.remove('sheets-root');
    if (errorWhileDrawing !== undefined) forgetKeptState();
    throw errorWhileDrawing ?? stopOrError;
  }
}
export function mountSheetsApp(
  reactRoot: ReactDOMClient.Root,
  zoom: ZoomStore,
  workbook: OpenedWorkbook,
  mountElement: HTMLElement,
  shell: WorkbookShell,
  people: BrowserSide['people'],
  otherViewers: BrowserSide['otherViewers'],
): () => void {
  let counterRef = React.createRef<HTMLDivElement>();
  let renderPage = (content: React.ReactNode) =>
    reactRoot.render(
      renderInSheetsRoot(
        <><div ref={counterRef} className="sheet-wrapped-text-counter" aria-hidden="true" />{content}</>,
      ),
    );
  ReactDOM.flushSync(() => renderPage(null));
  if (counterRef.current === null) throw Error('nothing can be drawn');
  let textMeasurer = createDomTextMeasurer(counterRef.current);
  let reads = readsWithTextMeasurer(workbook.reads(), textMeasurer);
  let storedCaretPlace = takeStoredCaretPlace(findTabStorage, performance.timeOrigin, wallClockAtTimeOrigin);
  let isEarlierVersionShown = workbook.refusalOfEveryEdit() === 'earlierVersionShown';
  let placeOfNewLink = shell.links.takePlaceOfNewLink();
  let pageWindow = mountElement.ownerDocument.defaultView;
  let keptEntry = takeKeptEntry(findTabStorage, wallClockAtTimeOrigin, false);
  let isUnsavedEntryKept = keptEntry?.isUnsaved === true && (placeOfNewLink !== null || storedCaretPlace === null);
  let placeToOpenOn = takePlaceToOpenOn(
    storagesForViewer(shell.viewer),
    reads,
    isUnsavedEntryKept ? null : (placeOfNewLink?.sheetId ?? null),
    isEarlierVersionShown,
  );
  let initialState = createInitialPageState(
    reads,
    placeToOpenOn.toOpenOn,
    hasStoredStepsToUndo(findTabStorage),
    readStoredDensity(),
    readTablesNotFormatted() ?? [],
    importFileChoices.length > 0,
  );
  if (initialState === null) throw Error('the workbook has no cell to start on');
  let paneAtFirst = shell.versionLooks.takePaneAtFirst();
  let caretAtFirst: CaretAtStart | null = paneAtFirst?.doCellsTakeCaret === true ? 'inSpreadsheetTakenOff' : storedCaretPlace;
  mountElement.classList.add('sheets-root');
  let clipboard = createSheetClipboard(mountElement.ownerDocument, sha256Hex(mountElement.ownerDocument.location.host));
  let afterNextPaint = (callback: () => void) =>
    pageWindow === null ? void setTimeout(callback) : afterNextFrameOrTimeout(pageWindow, callback);
  let pressTracker = pageWindow === null ? null : createPressTracker(pageWindow);
  let reducedMotion = pageWindow?.matchMedia('(prefers-reduced-motion:reduce)');
  let commentActions = createSheetCommentActions(shell.comments, () => readGridPlace());
  let commentCardOnTap = createCommentCardOnTap({
    cardAskedFor: () => shell.comments.cardAskedFor(),
    mayCome: () => controller.getView().grid.mayCommentBePreviewed,
    hasPageKeyboard: () => mountElement.ownerDocument.hasFocus(),
    open: (handle) => commentActions.open(handle, true),
    shut: () => shell.comments.shut(),
  });
  let browser: BrowserSide = {
    ...clipboard,
    ...textMeasurer,
    afterMs: (ms, callback) => void setTimeout(callback, ms),
    nowMs: () => performance.now(),
    framesToGlideOn: () => (mountElement.ownerDocument.hidden || reducedMotion?.matches !== false ? null : pageWindow),
    keyboard: {
      timesLeft: () => pressTracker?.timesFocusLeft() ?? 0,
      timesPressed: () => pressTracker?.timesBegun() ?? 0,
      isHere: () => mountElement.ownerDocument.hasFocus() || pressTracker?.hasPersonActedSinceFocusLeft('pressesOnly') === true,
    },
    keepKeysOffCells: shell.keepKeysOffCells,
    people,
    offersUnderAt: () =>
      atMenuOffers(
        new Date(),
        isChatBesidePage(() => controller.viewOnceEntryUnderAtIsDropped(), shell),
      ),
    otherViewers: {
      ...otherViewers,
      // The Shell's list of who is here shows whom this view follows (its Stop).
      tellWhomViewFollows(tabKey: string | null) {
        otherViewers.tellWhomViewFollows(tabKey);
        shell.followsTab?.(typeof tabKey === 'string' ? tabKey : null);
      },
    },
    agentForImport: shell.agentForImport,
    agentForConditionalFormats: shell.agentForConditionalFormats,
    agentForRowsAskedFor: shell.agentForRowsAskedFor,
    agentForFormulas: shell.agentForFormulas,
    agentForFixes: shell.agentForFixes,
    agentForCommands: shell.agentForCommands,
    chartsAreDescribedBy: shell.chartsAreDescribedBy,
    versionHistory: shell.versionHistory,
    versionLooks: shell.versionLooks,
    chartNodes: shell.chartNodes,
    copyLinkToSheet(sheetId) {
      if (!mountElement.ownerDocument.hasFocus()) pageWindow?.focus();
      clipboard.forgetLastPutHere();
      return shell.links.copyLinkTo(sheetId);
    },
    comments: {
      ...commentActions,
      open(handle, isKeyboardLeft) {
        commentCardOnTap.forget();
        commentActions.open(handle, isKeyboardLeft);
      },
    },
  };
  let controller = createSheetController(workbook, browser, initialState);
  let readGridPlace = () => {
    let gridElement = mountElement.querySelector('.sheet-grid');
    return gridElement === null
      ? null
      : {
          grid: controller.getView().grid,
          gridElement,
          zoom: zoom.now(),
        };
  };
  let mouseAroundComments = createMouseAroundComments({
    shown() {
      let cardOnItsPoint = shell.comments.cardOnItsPoint();
      return cardOnItsPoint?.isAtRest === true ? cardOnItsPoint.handle : commentCardOnTap.of();
    },
    isCardShown: () => commentCardOnTap.of() !== null,
    isMouseOnShown: () => shell.comments.cardOnItsPoint()?.isUnderMouse === true,
    show(handle) {
      let gridPlace = readGridPlace();
      if (gridPlace !== null && controller.getView().grid.mayCommentBePreviewed) previewCommentCardOnItsPoint(shell.comments, handle, gridPlace);
    },
    showCard: (handle) => commentCardOnTap.show(handle),
    hide() {
      if (!commentCardOnTap.hide()) shell.comments.endPreview();
    },
    after(ms, then) {
      let timer = setTimeout(then, ms);
      return {
        cancel: () => clearTimeout(timer),
      };
    },
  });
  let stopHearingPreviewMouse = shell.comments.onMouseOnPreviewChanged(
    (isOnPreview) => mouseAroundComments.hostSaysItIsOnPreview(isOnPreview),
  );
  let stopTellingPlaces = shell.comments.onPlacesWanted(() => {
    let gridPlace = readGridPlace();
    if (gridPlace !== null)
      shell.comments.tellPlaces(
        commentCardPlaces(gridPlace, {
          asked: shell.comments.cardAskedFor(),
          onItsPoint: shell.comments.cardOnItsPoint()?.handle ?? null,
          heightOfCard: (handle) => shell.comments.heightOfCard(handle),
          heightOfPreview: (handle) => shell.comments.heightOfPreview(handle),
        }),
      );
  });
  if (isUnsavedEntryKept || placeOfNewLink === null)
    bringBackKeptEntry(controller, isUnsavedEntryKept ? 'inEntry' : storedCaretPlace, keptEntry);
  if (paneAtFirst !== null)
    controller.dispatch({
      kind: 'versionHistoryCarriedOn',
      pane: paneAtFirst.pane,
      kept: paneAtFirst.kept,
    });
  if (paneAtFirst !== null && paneAtFirst.thenRestore !== null)
    controller.dispatch({
      kind: 'versionHistoryActedIn',
      act: {
        kind: 'restore',
        revision: paneAtFirst.thenRestore,
      },
    });
  let wasEntryOpenAtFirst = controller.isEntryOpen();
  let isFirstEntryStillOpen = () => wasEntryOpenAtFirst && controller.isEntryOpen();
  let hasPersonActed = () => shell.actsHeard.hasAnyCome() || storedCaretPlace === 'inCells' || storedCaretPlace === 'inEntry';
  let isPersonAtWorkInPage = () => mountElement.ownerDocument.hasFocus() && hasPersonActed();
  let personAtWorkInPage = (): { isPersonAtWorkInPage: true } | undefined =>
    isPersonAtWorkInPage()
      ? {
          isPersonAtWorkInPage: true,
        }
      : undefined;
  let hearAgentActivity = (isWorking: boolean, isFirstWord: boolean, hasShellAnswered: boolean) => {
    controller.dispatch({
      ...agentActivityChangedEvent({
        isWorking,
        isFirstWord,
        hasShellAnswered,
        isSheetJustMade: shell.isSheetJustMade(),
        hasPersonActedInSheet: hasPersonActed(),
        changedInTurn: isWorking ? null : shell.changedInTurnOfAgent(),
      }),
      ...personAtWorkInPage(),
    });
  };
  let pageTree: React.ReactNode;
  try {
    pageTree = (<><AnnounceActiveCellContext value={IS_APPLE_PLATFORM}><SheetsPage store={controller} clipboard={clipboard} reloadPage={null} shell={shell} oncePlaceholderIsOff={shell.oncePlaceholderIsOff} connectionNews={shell.connectionNews} wordsOfLoad={shell.wordsOfLoad} caretAtFirst={{
              mayCellsTake: () => pageWindow !== null && doCellsTakeCaretAtStart(caretAtFirst, false),
              isKeyboardHandedOver: (pressesHeard) =>
                paneAtFirst === null &&
                isKeyboardHandedOverAtStart(storedCaretPlace, false, performance.now() - pageScriptStartedAt, pressesHeard),
              mustCellsWait: () => shouldFocusEntryAtStart(caretAtFirst, shell.actsHeard.hasAnyCome(), isFirstEntryStillOpen()),
              doCellsTakeOncePainted: () => caretAtFirst === 'inSpreadsheetTakenOff',
              wasPointerPressedLast: paneAtFirst !== null && shell.actsHeard.wasPointerPressedLast(),
              mayKeyEndWait: (key) => isKeyForCellsAtStart(caretAtFirst, key, isFirstEntryStillOpen()),
              actsHeard: shell.actsHeard,
            }} isEarlierVersionLeft={paneAtFirst !== null && (paneAtFirst.pane?.look ?? null) === null && paneAtFirst.thenRestore === null} chatWithAgent={shell.chatWithAgent} {...(!isEarlierVersionShown && {
              guide: {
                from: shell.guideFromAgent,
                isPersonAtWorkInPage,
              },
            })} {...(shell.chartsMadeByPage !== undefined && {
              chartsMadeByPage: shell.chartsMadeByPage,
            })} commentsOfHost={shell.comments} commentsLayer={shell.commentsLayer ?? null} mouseAroundComments={mouseAroundComments} chartsRunOn={shell.chartsRunOn} {...(shell.interactivesRunOn !== undefined && {
              interactivesRunOn: shell.interactivesRunOn,
            })} {...(shell.changesOfCharts !== undefined && {
              changesOfCharts: shell.changesOfCharts,
            })} {...(shell.chartsWrittenByAgent !== undefined && {
              chartsWrittenByAgent: shell.chartsWrittenByAgent,
            })} {...(shell.filesForAgent !== undefined && {
              filesForAgent: shell.filesForAgent,
            })} gridZoom={zoom} isAgentWorkingNow={() => shell.agentActivity.isWorking()} /></AnnounceActiveCellContext><AgentActivityListener activity={shell.agentActivity} afterNextPaint={afterNextPaint} hear={hearAgentActivity} /></>);
    if (paneAtFirst === null) renderPage(pageTree);
  } catch (reloadOrError) {
    throw (controller.stop(), pressTracker?.stop(), reloadOrError);
  }
  let tellShellOfEntry = () => {
    shell.entryIsChanged(controller.doesLeaveLoseWork());
    shell.entryIsOpen(controller.isEntryOpen());
  };
  let stopTellingShellOfEntry = controller.subscribe(tellShellOfEntry);
  tellShellOfEntry();
  let stopFollowingChangesByAgent = shell.changesByAgent.onChanged(
    (changes) =>
      controller.dispatch({
        kind: 'changesByAgentChanged',
        changes,
        ...personAtWorkInPage(),
      }),
  );
  shell.xlsxFileCanBeWritten(
    (withCharts, fileTitle) => controller.writeXlsxFile(dropdownOptionsLabel(), withCharts, fileTitle),
  );
  shell.csvFileCanBeWritten(controller.writeCsvFile);
  shell.offerFollow((tabKey) => {
    let userId = tabKey === null ? null : otherViewers.personWithTab(tabKey);
    controller.dispatch({
      kind: 'followAsked',
      tabKey,
      userId,
    });
  });
  let stopViewShownByAgent = shell.viewShownByAgent.start(
    (shown) =>
      controller.dispatch({
        kind: 'viewShownByAgentChanged',
        shown,
        ...personAtWorkInPage(),
      }),
  );
  let stopComments = shell.comments.start({
    told: (told) =>
      controller.dispatch({
        kind: 'commentsTold',
        ...told,
      }),
    pointedAt: (handles) =>
      controller.dispatch({
        kind: 'commentsPointedAt',
        handles,
      }),
    picked: (handle, how) =>
      controller.dispatch({
        kind: 'commentPicked',
        handle,
        ...(how === 'preview' && {
          isByPreview: true,
        }),
      }),
  });
  let stopKeepingPlace = keepPlaceAcrossReloads(
    storagesForViewer(shell.viewer),
    controller,
    afterNextPaint,
    placeToOpenOn.isTabsOwn,
    isEarlierVersionShown
      ? {
          cellOpenedFor: placeToOpenOn.toOpenOn?.activeCell ?? null,
          has: (cell) => workbook.reads().positionOfCell(cell) !== null,
        }
      : null,
  );
  let stopKeepingOwnFilters = isEarlierVersionShown
    ? null
    : keepOwnFiltersAcrossReloads(storagesForViewer(shell.viewer), controller, afterNextPaint, shell.keepPlaceholderOn);
  if (isUnsavedEntryKept || (placeOfNewLink?.ranges.length ?? 0) > 0)
    controller.lookOnceAllIsTaken(() =>
      browser.afterMs(0, () =>
        placeOfNewLink === null
          ? controller.dispatch({
              kind: 'entryLeft',
            })
          : goToPlace(controller, placeOfNewLink),
      ),
    );
  let stopKeepingEntry = keepEntryWhilePageIsLeft(findTabStorage, controller, afterNextPaint, {
    hasCaret: () => mountElement.ownerDocument.hasFocus(),
    onLeftPage(listener) {
      pageWindow?.addEventListener('blur', listener);
      return () => pageWindow?.removeEventListener('blur', listener);
    },
    onCameBackToPage(listener) {
      pageWindow?.addEventListener('focus', listener);
      return () => pageWindow?.removeEventListener('focus', listener);
    },
    wallNowMs: () => Date.now(),
    hasUnsavedEdits: () => workbook.hasUnsavedEdits(),
    onSavingChanged: (listener) => workbook.onSavingChanged(listener),
  });
  let stopSyncingSheetLinks = syncShownSheetWithLinks(shell.links, controller, isEarlierVersionShown);
  let stopKeepingStepsToUndo = isEarlierVersionShown ? null : keepStepsToUndoFlag(findTabStorage, controller);
  let stopCopyLinkShortcut =
    pageWindow === null
      ? null
      : listenForCopySheetLinkShortcut(
          pageWindow,
          () =>
            controller.dispatch({
              kind: 'sheetLinkCopyChosen',
              sheetId: null,
            }),
        );
  let { ownerDocument } = mountElement;
  let stopKeepingCaretPlace = keepCaretPlaceStored(
    findTabStorage,
    (callback) => (pageWindow === null ? void setTimeout(callback) : afterNextFrameOrTimeout(pageWindow, callback)),
    {
      isInCells: () =>
        ownerDocument.hasFocus() ? ownerDocument.activeElement !== null && isGridOrGridPopupTrigger(ownerDocument.activeElement) : null,
      isInEntry: () =>
        controller.getView().mode.kind === 'editing' && ownerDocument.activeElement?.matches('.sheet-cell-editor, .sheet-formula-field') === true,
      onMoved(listener) {
        let onFocusIn = () => listener(true);
        let onFocusOut = () => listener(false);
        ownerDocument.addEventListener('focusin', onFocusIn);
        ownerDocument.addEventListener('focusout', onFocusOut);
        return () => {
          ownerDocument.removeEventListener('focusin', onFocusIn);
          ownerDocument.removeEventListener('focusout', onFocusOut);
        };
      },
      onCameBackToPage(listener) {
        pageWindow?.addEventListener('focus', listener, true);
        pageWindow?.addEventListener('pageshow', listener);
        return () => {
          pageWindow?.removeEventListener('focus', listener, true);
          pageWindow?.removeEventListener('pageshow', listener);
        };
      },
      onPageEnds(listener) {
        pageWindow?.addEventListener('pagehide', listener);
        return () => pageWindow?.removeEventListener('pagehide', listener);
      },
      onEntryOpenedOrEnded(listener) {
        let wasEditing: boolean | null = null;
        return controller.subscribe(() => {
          let isEditing = controller.getView().mode.kind === 'editing';
          if (isEditing !== wasEditing) listener();
          wasEditing = isEditing;
        });
      },
      onLeftPage(listener) {
        pageWindow?.addEventListener('blur', listener);
        return () => pageWindow?.removeEventListener('blur', listener);
      },
      nowMs: () => performance.timeOrigin + performance.now(),
      wallNowMs: () => Date.now(),
    },
  );
  let tellWhetherCellsHoldSomething = () => shell.cellsHoldSomething(!workbook.reads().isEveryCellBlank);
  tellWhetherCellsHoldSomething();
  let stopWatchingWorkbook = workbook.onChanged(tellWhetherCellsHoldSomething);
  let stopApp = () => {
    stopKeepingCaretPlace();
    stopKeepingEntry();
    stopCopyLinkShortcut?.();
    stopSyncingSheetLinks();
    stopKeepingPlace();
    stopKeepingOwnFilters?.();
    stopViewShownByAgent();
    stopComments();
    stopHearingPreviewMouse();
    stopTellingPlaces();
    mouseAroundComments.stop();
    stopTellingShellOfEntry();
    stopFollowingChangesByAgent();
    shell.entryIsOpen(false);
    stopWatchingWorkbook();
    pressTracker?.stop();
    shell.cellsHoldSomething(null);
    shell.csvFileCanBeWritten(null);
    shell.xlsxFileCanBeWritten(null);
    shell.offerFollow(null);
    shell.followsTab?.(null);
    reactRoot.unmount();
    mountElement.classList.remove('sheets-root');
    try {
      controller.stop();
    } finally {
      shell.entryIsChanged(false);
    }
    stopKeepingStepsToUndo?.();
  };
  if (paneAtFirst === null) return stopApp;
  ReactDOM.flushSync(() => renderPage(pageTree));
  if (mountElement.hasChildNodes()) return stopApp;
  throw (stopApp(), Error('nothing can be drawn'));
}
export interface AgentActivityListenerProps {
  activity: AgentActivity;
  afterNextPaint: (callback: () => void) => void;
  hear: (isWorking: boolean, isFirstWord: boolean, hasShellAnswered: boolean) => void;
}
export function AgentActivityListener({ activity, afterNextPaint, hear }: AgentActivityListenerProps) {
  React.useEffect(() => watchAgentActivity(activity, afterNextPaint, hear), [activity, afterNextPaint, hear]);
  return null;
}
export const wallClockAtTimeOrigin = Date.now() - performance.now();
export const pageScriptStartedAt = performance.now();
export const findTabStorage = () => sessionStorage;
export const storagesForViewer = (viewer: () => string | null): KeptOwnFiltersStorages => ({
  findTabs: findTabStorage,
  findBrowsers: () => localStorage,
  viewer,
  wallNowMs: () => Date.now(),
});
