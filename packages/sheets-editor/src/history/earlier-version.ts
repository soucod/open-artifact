import type { IdRun, Refused, SheetId } from '@open-artifact/sheets-core';
import type { ChartEditsByAgent } from '../charts/agent-edits.ts';
import type { ChartWriterByAgent, StockChartMaker } from '../charts/new-charts.ts';
import type { OpenedWorkbook } from '../engine/worker-workbook.ts';
import type { BrowserSide } from '../state/controller.ts';
import type { VersionHistoryCarriedOn } from '../state/event-reducer.ts';
import type { PageState } from '../state/initial-state.ts';
import type { ViewOnlyVersion } from '../store/sheet-connection.ts';
import type { VersionHistoryReader } from './history-reader.ts';

/** The workbook the page is drawn with while an earlier version is shown: it reads the version and refuses every edit. */
export interface EarlierVersionWorkbook {
  workbook: OpenedWorkbook;
  end(): void;
  /** Shows another version in place of the one shown, keeping what the page listens to and asked to be seen. */
  show(nextVersion: ViewOnlyVersion): void;
}
/** A listener on the version shown, heard again on each version shown after it. */
interface HearingOnVersion {
  stop: () => void;
  hear: () => void;
}
type WorkbookChangeListener = Parameters<OpenedWorkbook['onChanged']>[0];

export function createEarlierVersionWorkbook(firstVersion: ViewOnlyVersion): EarlierVersionWorkbook {
  let version = firstVersion;
  let ownRowOrdersSeen = new Map<SheetId, readonly IdRun[] | null>();
  let sheetFollowed: SheetId | null = null;
  let changeListeners = new Set<WorkbookChangeListener>();
  let hearings = new Set<HearingOnVersion>();
  let hearOnVersion =
    <Listener>(listen: (workbook: OpenedWorkbook, listener: Listener) => () => void) =>
    (listener: Listener) => {
      let hearing: HearingOnVersion = {
        stop: ignoreWorkbookCall,
        hear: () => void (hearing.stop = listen(version.workbook, listener)),
      };
      hearing.hear();
      hearings.add(hearing);
      return () => {
        hearing.stop();
        hearings.delete(hearing);
      };
    };
  let hearChanged = hearOnVersion<WorkbookChangeListener>((workbook, listener) => workbook.onChanged(listener));
  return {
    workbook: {
      reads: () => version.workbook.reads(),
      refusalOfEveryEdit: () => EARLIER_VERSION_REFUSAL.refusal,
      queueEdit: (_edit, answer) => answer(EARLIER_VERSION_REFUSAL),
      undoOrRedo: (_direction, answer) => answer(EARLIER_VERSION_REFUSAL),
      queueEditsThatTakeBack: (_builtOnRevision, _edits, answer) => answer(EARLIER_VERSION_REFUSAL),
      seeRowsInOwnOrder(sheetId, rows, onSeen) {
        ownRowOrdersSeen.set(sheetId, rows);
        version.workbook.seeRowsInOwnOrder(sheetId, rows, onSeen);
      },
      onChanged(listener) {
        changeListeners.add(listener);
        let stopHearing = hearChanged(listener);
        return () => {
          changeListeners.delete(listener);
          stopHearing();
        };
      },
      isOnAnotherThread: true,
      areFormulasLeft: () => version.workbook.areFormulasLeft(),
      onFormulasLeftChanged: hearOnVersion((workbook, listener) => workbook.onFormulasLeftChanged(listener)),
      workOutFormulasLeft: () => version.workbook.workOutFormulasLeft(),
      questionsMissedCount: () => version.workbook.questionsMissedCount(),
      isAnswerAwaited: () => version.workbook.isAnswerAwaited(),
      onAnswersCame: hearOnVersion((workbook, listener) => workbook.onAnswersCame(listener)),
      onCauseOfErrorCame: hearOnVersion((workbook, listener) => workbook.onCauseOfErrorCame(listener)),
      askForCopy: (...cellsToCopy) => version.workbook.askForCopy(...cellsToCopy),
      copyWritten: (...cellsToCopy) => version.workbook.copyWritten(...cellsToCopy),
      onCopyWritten: hearOnVersion((workbook, listener) => workbook.onCopyWritten(listener)),
      tableAt: (...tableAsked) => version.workbook.tableAt(...tableAsked),
      followTablesOf(sheetId) {
        sheetFollowed = sheetId;
        version.workbook.followTablesOf(sheetId);
      },
      tablesRead: () => version.workbook.tablesRead(),
      onTablesRead: hearOnVersion((workbook, listener) => workbook.onTablesRead(listener)),
      xlsxFile: (...fileAsked) => version.workbook.xlsxFile(...fileAsked),
      saving: () => 'allSaved',
      hasUnsavedEdits: () => false,
      unsavedEditCount: () => 0,
      onSavingChanged: noChangeListener,
      onEditsDropped: noChangeListener,
      revisionHeld: () => null,
      onEditsOfOthersMade: noChangeListener,
      onLoaded: noChangeListener,
      editStreamed: ignoreWorkbookCall,
      storeRevisionReported: ignoreWorkbookCall,
      timeTold: ignoreWorkbookCall,
      storeReconnected: ignoreWorkbookCall,
      storeClosed: ignoreWorkbookCall,
      availabilityStated: ignoreWorkbookCall,
      tabVisibilityChanged: ignoreWorkbookCall,
    },
    end: () => version.end(),
    show(nextVersion) {
      for (let { stop } of hearings) stop();
      version.end();
      version = nextVersion;
      for (let { hear } of hearings) hear();
      for (let [sheetId, rows] of ownRowOrdersSeen) nextVersion.workbook.seeRowsInOwnOrder(sheetId, rows, ignoreWorkbookCall);
      if (sheetFollowed !== null) nextVersion.workbook.followTablesOf(sheetFollowed);
      for (let listener of changeListeners) listener('unasked');
    },
  };
}
/** The charts' ways out of the page, counted, so a look at an earlier version waits for nothing being sent. */
export interface ChartSends {
  changes: ChartEditsByAgent;
  made: StockChartMaker;
  written: ChartWriterByAgent;
  isSending(): boolean;
  timesSent(): number;
}
export function createChartSends(changes: ChartEditsByAgent, made: StockChartMaker, written: ChartWriterByAgent): ChartSends {
  let sendingCount = 0;
  let sentCount = 0;
  let send = async <Outcome>(sendIt: () => Promise<Outcome>): Promise<Outcome> => {
    sendingCount += 1;
    sentCount += 1;
    try {
      return await sendIt();
    } finally {
      sendingCount -= 1;
    }
  };
  return {
    changes: {
      isToBeHad: () => changes.isToBeHad(),
      canAskAgent: () => changes.canAskAgent(),
      kindOf: (nodeId) => changes.kindOf(nodeId),
      ask: (...asked) => changes.ask(...asked),
      giveUp: () => changes.giveUp(),
      discard: (nodeId) => changes.discard(nodeId),
      pointAt: (...pointed) => send(() => changes.pointAt(...pointed)),
    },
    made: {
      get isToBeHad() {
        return made.isToBeHad;
      },
      make: (...asked) => send(() => made.make(...asked)),
    },
    written: {
      isToBeHad: () => written.isToBeHad(),
      write: (...asked) => send(() => written.write(...asked)),
      giveUp: () => written.giveUp(),
      discard: (nodeId) => written.discard(nodeId),
    },
    isSending: () => sendingCount > 0,
    timesSent: () => sentCount,
  };
}
/** What a look at an earlier version needs of the app. */
export interface AppOfEarlierVersionLooks {
  history: Pick<VersionHistoryReader, 'asItWas'>;
  /** The page's own workbook, when it is open. */
  own(): OpenedWorkbook | null;
  drawAgain(): void;
  isChartBeingSent(): boolean;
  timesChartsWereSent(): number;
  untilSaved(workbook: OpenedWorkbook): Promise<void>;
}
/** The steps of the open workbook, kept while an earlier version is drawn in its place. */
type StepsOfOpenWorkbook = Pick<PageState, 'notesOfSteps' | 'rowsAddedAfterEntries' | 'stepsToUndo' | 'stepsToRedo'>;
/** What the page drawn next starts with, once a look at an earlier version begins or ends. */
export interface PaneAtFirst {
  pane: VersionHistoryCarriedOn['pane'];
  kept: VersionHistoryCarriedOn['kept'];
  /** The revision to restore once the page is drawn. */
  thenRestore: number | null;
  doCellsTakeCaret: boolean;
}
/** The look at an earlier version under way. */
interface LookAtEarlierVersion {
  /** The page's own workbook the version is drawn in place of. */
  of: OpenedWorkbook;
  onShow: EarlierVersionWorkbook;
  shown: ViewOnlyVersion;
  stepsOfOpenWorkbook: StepsOfOpenWorkbook;
}
export type EarlierVersionLooks = BrowserSide['versionLooks'] & {
  takePaneAtFirst(): PaneAtFirst | null;
  /** The workbook to draw: the earlier version while one is looked at in place of the given workbook. */
  drawnInPlaceOf(workbook: OpenedWorkbook | null): OpenedWorkbook | null;
};
export function createEarlierVersionLooks(app: AppOfEarlierVersionLooks): EarlierVersionLooks {
  let looking: LookAtEarlierVersion | null = null;
  let paneAtFirst: PaneAtFirst | null = null;
  let generation = 0;
  let endLook = (
    pane: PaneAtFirst['pane'],
    { profilesById, newsOfLoss }: Pick<PageState, 'profilesById' | 'newsOfLoss'>,
    thenRestore: number | null,
    doCellsTakeCaret: boolean,
  ) => {
    generation += 1;
    if (looking === null) return;
    looking.onShow.end();
    paneAtFirst = {
      pane,
      kept: {
        ...looking.stepsOfOpenWorkbook,
        profilesById,
        newsOfLoss,
      },
      thenRestore,
      doCellsTakeCaret: pane === null ? doCellsTakeCaret : pane.isCaretForCells,
    };
    looking = null;
    queueMicrotask(app.drawAgain);
  };
  return {
    async lookAt(revision, pane, readKept) {
      generation += 1;
      let [generationAtStart, workbook, chartSendsAtStart] = [generation, app.own(), app.timesChartsWereSent()];
      let isStillAsked = () =>
        generationAtStart === generation && app.own() === workbook && app.timesChartsWereSent() === chartSendsAtStart;
      if (workbook === null) return 'noAnswer';
      if (app.isChartBeingSent()) return 'editsNotSaved';
      await app.untilSaved(workbook);
      if (!isStillAsked()) return 'calledOff';
      if (workbook.hasUnsavedEdits()) return 'editsNotSaved';
      let earlier = await app.history.asItWas(revision, isStillAsked);
      if (earlier.kind === 'notRead') return earlier.why;
      if (!isStillAsked() || workbook.hasUnsavedEdits()) earlier.version.end();
      if (!isStillAsked()) return 'calledOff';
      if (workbook.hasUnsavedEdits()) return 'editsNotSaved';
      let { profilesById, newsOfLoss, ...steps } = readKept();
      earlier.version.onFailed(() => {
        if (looking?.shown === earlier.version)
          endLook(
            null,
            {
              profilesById,
              newsOfLoss,
            },
            null,
            false,
          );
      });
      if (looking !== null) {
        looking.onShow.show(earlier.version);
        looking.shown = earlier.version;
        return null;
      }
      let shownBefore = pane.look?.awaited?.version ?? null;
      let stepsOfOpenWorkbook = {
        notesOfSteps: steps.notesOfSteps,
        rowsAddedAfterEntries: steps.rowsAddedAfterEntries,
        stepsToUndo: steps.stepsToUndo,
        stepsToRedo: steps.stepsToRedo,
      };
      looking = {
        of: workbook,
        onShow: createEarlierVersionWorkbook(earlier.version),
        shown: earlier.version,
        stepsOfOpenWorkbook,
      };
      paneAtFirst = {
        pane: {
          ...pane,
          look: {
            shown: shownBefore,
            awaited: null,
          },
        },
        kept: {
          ...stepsOfOpenWorkbook,
          profilesById,
          newsOfLoss,
        },
        thenRestore: null,
        doCellsTakeCaret: false,
      };
      app.drawAgain();
      return null;
    },
    end: endLook,
    takePaneAtFirst() {
      let pane = paneAtFirst;
      paneAtFirst = null;
      return pane;
    },
    drawnInPlaceOf(workbook) {
      if (looking !== null && looking.of !== workbook) {
        generation += 1;
        looking.onShow.end();
        looking = null;
        paneAtFirst = null;
      }
      return looking?.onShow.workbook ?? workbook;
    },
  };
}
export const EARLIER_VERSION_REFUSAL: Refused<'earlierVersionShown'> = {
  kind: 'refused',
  refusal: 'earlierVersionShown',
};
export const noChangeListener = () => () => {};
export const ignoreWorkbookCall = () => {};
