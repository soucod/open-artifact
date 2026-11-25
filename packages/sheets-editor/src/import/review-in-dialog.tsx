import { Tabs } from '../kit/tabs.tsx';
import { Dialog } from '../kit/dialog.tsx';
import { SegmentedControl } from '../kit/segmented-control.tsx';
import { Button } from '../kit/button.tsx';
import { TooltipGroup } from '../kit/tooltip.tsx';
import * as React from 'react';
import {
  importPlanSoFar,
  columnsQuestionDecides,
  importQuestionExamples,
  isImportPlanComing,
  openImportQuestionIds,
  importNotesToShow,
  importLinesLeftOut,
} from './import-review.ts';
import {
  readingsThatDiffer,
  withoutYear,
  columnsNamedWords,
  columnsAskedAgainAfterChange,
  askedAgainColumns,
  AgentsReadSection,
  AgentsReadFailed,
  HeadingsLineSelect,
} from './settings-pane.tsx';
import {
  importQuestionHeading,
  rowsAndColumnsLabel,
  columnsToCheckLabel,
  columnNthLabel,
  PICTURE_BOX_CLASS,
  importDialogLabels,
  addBackColumnLabel,
  notInSheetLabel,
  addBackLineLabel,
} from './import-picture.tsx';
import { PaneRow, SidePane, SIDE_PANE_DEFAULT_WIDTH, PaneSection } from '../ui/side-pane/side-pane.tsx';
import { LAST_DONE_SETTLE_MS } from '../ui/last-done-announcer.ts';
import { subscribeToFocusIn } from '../ui/settled-announcers.tsx';
import { LiveAnnouncer } from '../ui/live-announcer.tsx';
import {
  importSettingsToCheck,
  questionsNotAboutColumns,
  importColumnsComingInCount,
  importDestinationSort,
  columnsLeftOutOfSheetChanges,
  betterReadingForTextColumn,
} from './settings-to-check.ts';
import { importColumnsLeftOut, NOTHING_DRAWN_ANYWAY, importRecordCount, importMergeKeyColumn } from './bring-in.ts';
import { joinImportWordsWithMiddleDots, importReviewMessages, cellsFitFormatWords, columnReadingKindLabel } from './csv-file.tsx';
import { importPlacesLeft } from './import-flow.ts';
import { ImportHeadingsRow, PICTURE_ORIGIN, ImportRowNumbers } from './picture-headings.tsx';
import {
  importSettingsLabels,
  NewSheetNameField,
  ImportDestinationRows,
  sheetToImportInto,
  importLineLabel,
  summaryByAgentLabel,
} from './destination.tsx';
import { LeftOutLinesMenu, ImportQuestionRow } from './settings-aside.tsx';
import { ColumnKindMenu } from './preview-table.tsx';
import { columnsNotImportedWords } from '../messages/import.ts';
import type { ImportOfAFile, ImportPlan, PageState } from '../state/initial-state.ts';
import type { ImportChangeByHand, ImportDestinationPick, ImportReading } from '../state/event-reducer.ts';
import type { GridOfPage } from '../view/page-view.ts';
import type { ImportTextOnRow } from './csv-file.tsx';
import type { ColumnsAskedAgain } from './settings-pane.tsx';
import type { ImportColumnQuestion, ImportSettingsToCheck } from './settings-to-check.ts';
import type { LinesAndColumnsUnfolded } from './import-picture.tsx';
/** A tab of the review when it is shown in tabs. */
export type ImportReviewTab = 'settings' | 'preview';
/** How a row of the settings came to be pointed at. */
export type HowRowIsPointedAt = 'pointer' | 'caret' | 'atOnce';
/** What the review says of the outcome of the import: at its foot, and to a screen reader. */
export interface ImportOutcomeWords {
  atTheFoot: string;
  heard: string;
}
/** An option of a question about the order of dates or the decimal sign, by the example it reads. */
export interface OptionOfDateOrder {
  optionIndex: number;
  label: string;
}
/** Words to say once the focus has settled, and how many times they were said, so that saying them again is heard. */
export interface SettledAnnouncement {
  words: string | false | null;
  timesSaid: number;
}
export interface SettledAnnouncerProps extends SettledAnnouncement {
  /** Something in the page whose focus moves are waited out. */
  inPageOf: React.RefObject<HTMLElement | null>;
  isFocusYetToMove?: boolean;
}
/** What a row of the settings shows in the picture while it is pointed at. */
interface PointableRow {
  columns: number[];
  unfolded: LinesAndColumnsUnfolded;
}
interface DateOrderSegmentedRowProps {
  asked: ImportColumnQuestion;
  readings: OptionOfDateOrder[];
  /** The option in force. */
  inForce: number;
  isOff: boolean;
  onAnswered: (questionId: string, optionIndex: number) => void;
}
interface ColumnSheetLacksRowProps {
  where: string;
  what: string;
  whyInShort: string;
  why: string;
}
interface LeftOutAddBackRowProps {
  where: string;
  what: string;
  addBack: string;
  isOff: boolean;
  onAddedBack: () => void;
}
interface ImportReviewInDialogProps {
  open: ImportOfAFile;
  isInTabs: boolean;
  picture: GridOfPage | null;
  zoom: number;
  proposal: React.ReactNode;
  errorForPicture: string | null;
  shimmer: React.ReactNode;
  columnsRevealed: number | null;
  lastRow: number;
  isPlanDrawn: boolean;
  hasPictureLinesUnfolded: boolean;
  onRoomMeasured: (room: Pick<PageState, 'gridWidth' | 'gridHeight'>) => void;
  keepButton: React.ReactNode;
  outcome: ImportOutcomeWords | null;
  agentAtWork: React.ReactNode;
  agentAtWorkInWords: string;
  wishToAgent: React.ReactNode | null;
  underBothTabs: React.ReactNode | null;
  onDiscarded: () => void;
  wordOfAgent: string | null;
  onAskedAgain: (() => void) | null;
  onAnswered: (questionId: string, optionIndex: number) => void;
  onChangedByHand: (change: ImportChangeByHand) => void;
  onKindsWanted: (columnIndex: number) => void;
  onDestinationPicked: (picked: ImportDestinationPick) => void;
  onColumnsPointedAt: (columns: number[]) => void;
  onNoRowPointedAt: () => void;
  onColumnWanted: (columnNumber: number) => void;
  /** The first cells of each column that would stay text, by column. */
  firstTextCells: ReadonlyMap<number, ImportTextOnRow[]>;
  columnsUnfolded: number[];
  onLeftOutShown: (unfolded: LinesAndColumnsUnfolded) => void;
}
interface PointableImportRowProps {
  id: string;
  onPointedAt: (rowId: string | null, how: HowRowIsPointedAt) => void;
  children: React.ReactNode;
}
interface ImportFooterSentenceProps {
  sentence: string;
  isHeldBack: boolean;
}
export function importSectionTurnClasses(section: { points: boolean; columnsToCheck: boolean }) {
  let pointsDelay = section.points ? 1 : 0;
  return {
    sheet: importTurnClass(pointsDelay),
    columnsToCheck: importTurnClass(pointsDelay + 1),
    leftOut: importTurnClass(pointsDelay + (section.columnsToCheck ? 2 : 1)),
  };
}
export function measureHeadingTextWidth(text: string) {
  let cachedWidth = headingTextWidthCache.get(text);
  if (cachedWidth !== undefined) return cachedWidth;
  let canvasContext = document.createElement('canvas').getContext('2d');
  if (canvasContext !== null) canvasContext.font = `12px ${getComputedStyle(document.body).fontFamily}`;
  let width = canvasContext?.measureText(text).width ?? text.length * 7;
  headingTextWidthCache.set(text, width);
  return width;
}
export function dateOrderReadingsOfAsk(ask: ImportColumnQuestion, open: ImportOfAFile): OptionOfDateOrder[] | null {
  let question = importPlanSoFar(open).plan.questions.find(({ id }) => id === ask.questionId);
  if (question === undefined || ask.about === 'other' || ask.example === null) return null;
  let [firstColumn] = columnsQuestionDecides(question);
  if (firstColumn === undefined || !ask.columns.includes(firstColumn)) return null;
  let differingReadings = readingsThatDiffer(question);
  let readingsOfExamples = importQuestionExamples(open, ask.questionId).flatMap(
    (examplesOfOption, optionIndex): OptionOfDateOrder[] => {
      let firstBecomes = examplesOfOption[0]?.becomes ?? null;
      return firstBecomes === null || differingReadings[optionIndex]?.kind === 'text'
        ? []
        : [
            {
              optionIndex,
              label: withoutYear(firstBecomes, differingReadings[optionIndex]),
            },
          ];
    },
  );
  let [firstReading, secondReading, ...otherReadings] = readingsOfExamples.toSorted(
    (left, right) =>
      dateOrDecimalOrderRank(differingReadings[left.optionIndex]) - dateOrDecimalOrderRank(differingReadings[right.optionIndex]),
  );
  return firstReading !== undefined && secondReading !== undefined && otherReadings.length === 0 && firstReading.label !== secondReading.label
    ? [firstReading, secondReading]
    : null;
}
export function DateOrderSegmentedRow(props: DateOrderSegmentedRowProps) {
  let { asked, readings, inForce, isOff, onAnswered } = props;
  let heading = importQuestionHeading(asked.about, asked.example, asked.names);
  return <><PaneRow><span aria-hidden dir="auto" className="min-w-0 text-footnote leading-snug [overflow-wrap:anywhere] text-secondary select-none">{heading}</span></PaneRow><PaneRow><div role="presentation" className="flex min-w-0 flex-1" onClick={({ target }) => {
            if (isOff) return;
            if ((target instanceof Element ? target.closest('[role=radio]') : null)?.getAttribute('aria-checked') === 'true')
              onAnswered(asked.questionId, inForce);
          }}><SegmentedControl aria-label={heading} disabled={isOff} fullWidth value={readings.some(({ optionIndex }) => optionIndex === inForce) ? String(inForce) : ''} segments={readings.map(
              ({ optionIndex, label }) => ({
                value: String(optionIndex),
                label,
              }),
            )} onChange={(value) => {
              if (value !== '') onAnswered(asked.questionId, Number(value));
            }} /></div></PaneRow></>;
}
export function ColumnSheetLacksRow(props: ColumnSheetLacksRowProps) {
  let { where, what, whyInShort, why } = props;
  return <PaneRow label={where}><span dir="auto" title={why} className="min-w-[40%] flex-1 truncate ps-md text-body text-secondary">{what}</span><span dir="auto" title={why} className="min-w-0 truncate text-footnote text-secondary">{whyInShort}</span></PaneRow>;
}
export function LeftOutAddBackRow({ where, what, addBack, isOff, onAddedBack }: LeftOutAddBackRowProps) {
  return <PaneRow label={where} trailing={<span className="flex translate-x-[7px]"><Button variant="ghost" iconOnly icon="Add" aria-label={addBack} title={addBack} className="text-secondary" disabled={isOff} {...{
          [ADDS_BACK_ATTRIBUTE]: where,
        }} onClick={({ currentTarget }) => {
          let ancestor = currentTarget.closest('[role=dialog]');
          let addBackButtons = [...(ancestor?.querySelectorAll<HTMLElement>(`[${ADDS_BACK_ATTRIBUTE}]`) ?? [])];
          let buttonIndex = addBackButtons.indexOf(currentTarget);
          let pictureBoxButton = ancestor?.querySelector<HTMLElement>(PICTURE_BOX_ENABLED_BUTTONS_SELECTOR);
          (addBackButtons[buttonIndex + 1] ?? addBackButtons[buttonIndex - 1] ?? pictureBoxButton)?.focus();
          onAddedBack();
        }} /></span>}><span dir="auto" className="min-w-0 flex-1 truncate ps-md text-body text-secondary">{what}</span></PaneRow>;
}
export function useMinHeightSince(heardCount: number | null) {
  let childRef = React.useRef<HTMLDivElement>(null);
  let [minHeight, setMinHeight] = React.useState({
    since: heardCount,
    height: 0,
  });
  if (minHeight.since !== heardCount)
    setMinHeight({
      since: heardCount,
      height: 0,
    });
  React.useLayoutEffect(() => {
    let [child, ownerWindow] = [childRef.current, childRef.current?.ownerDocument.defaultView];
    if (child === null || ownerWindow === null || ownerWindow === undefined || heardCount === null) return;
    let measure = () => {
      let { height: childHeight } = child.getBoundingClientRect();
      setMinHeight(
        (minHeightNow) =>
          childHeight > minHeightNow.height
            ? {
                since: heardCount,
                height: childHeight,
              }
            : minHeightNow,
      );
    };
    measure();
    let resizeObserver = new ownerWindow.ResizeObserver(measure);
    resizeObserver.observe(child);
    return () => resizeObserver.disconnect();
  }, [heardCount]);
  return {
    child: childRef,
    box: {
      minHeight: minHeight.since === heardCount ? minHeight.height : 0,
    },
  };
}
export function useSettledAnnouncement({ words, timesSaid, inPageOf, isFocusYetToMove = false }: SettledAnnouncerProps): SettledAnnouncement {
  let [announcement, setAnnouncement] = React.useState(NOTHING_TO_ANNOUNCE);
  let hasWords = typeof words === 'string' && words !== '';
  if (!hasWords && announcement !== NOTHING_TO_ANNOUNCE) setAnnouncement(NOTHING_TO_ANNOUNCE);
  React.useEffect(() => {
    if (!hasWords || isFocusYetToMove) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let announce = () => {
      clearTimeout(timer);
      timer = setTimeout(
        () =>
          setAnnouncement({
            words,
            timesSaid,
          }),
        LAST_DONE_SETTLE_MS,
      );
    };
    let stopWaiting = subscribeToFocusIn(inPageOf)(announce);
    announce();
    return () => {
      stopWaiting();
      clearTimeout(timer);
    };
  }, [hasWords, words, timesSaid, inPageOf, isFocusYetToMove]);
  return hasWords ? announcement : NOTHING_TO_ANNOUNCE;
}
export function SettledAnnouncer(props: SettledAnnouncerProps) {
  return <LiveAnnouncer {...useSettledAnnouncement(props)} />;
}
export function useTrueAfterDelay(isOn: boolean, delayMs: number) {
  let [isTrue, setTrue] = React.useState(false);
  React.useEffect(() => {
    if (!isOn) return;
    let timer = setTimeout(() => setTrue(true), delayMs);
    return () => {
      clearTimeout(timer);
      setTrue(false);
    };
  }, [isOn, delayMs]);
  return isTrue;
}
export function ImportReviewInDialog({
  open,
  isInTabs,
  picture,
  zoom,
  proposal,
  errorForPicture,
  shimmer,
  columnsRevealed,
  lastRow,
  isPlanDrawn,
  hasPictureLinesUnfolded,
  onRoomMeasured,
  keepButton,
  outcome,
  agentAtWork,
  agentAtWorkInWords,
  wishToAgent,
  underBothTabs,
  onDiscarded,
  wordOfAgent,
  onAskedAgain,
  onAnswered,
  onChangedByHand,
  onKindsWanted,
  onDestinationPicked,
  onColumnsPointedAt,
  onNoRowPointedAt,
  onColumnWanted,
  firstTextCells,
  columnsUnfolded,
  onLeftOutShown,
}: ImportReviewInDialogProps) {
  let isRead = isImportPlanComing(open) || columnsRevealed !== null;
  let reviewRows = React.useMemo(() => (isRead ? NO_IMPORT_REVIEW_ROWS : importSettingsToCheck(open)), [open, isRead]);
  let { questions, columnsLeftOut, linesLeftOut } = reviewRows;
  let { plan, preview } = importPlanSoFar(open);
  let columnsLeftOutOfImport = importColumnsLeftOut(open, plan);
  let openQuestionIds = openImportQuestionIds(open);
  let questionOfColumn = (columnIndex: number) =>
    questions.find(({ columns }) => columns.includes(columnIndex));
  let isColumnQuestionOpen = (columnIndex: number) => questionOfColumn(columnIndex)?.isOpen === true;
  let [keptColumns, setKeptColumns] = React.useState({
    of: open.plan,
    columns: reviewRows.columns,
  });
  let columnsKept = keptColumns.of === open.plan ? keptColumns.columns : [];
  /** The plan whose text columns have all been looked into. */
  let [planLookedInto, setPlanLookedInto] = React.useState<ImportPlan | null>(null);
  let textColumnsToLookInto = (
    planLookedInto === open.plan
      ? reviewRows.textColumnsYetToLookInto.filter((columnIndex) => columnsKept.includes(columnIndex))
      : reviewRows.textColumnsYetToLookInto
  ).join();
  if (!isRead && planLookedInto !== open.plan && textColumnsToLookInto === '') setPlanLookedInto(open.plan);
  let askKindsWanted = React.useEffectEvent(onKindsWanted);
  let { kinds } = open;
  React.useEffect(() => {
    for (let columnIndex of textColumnsToLookInto === '' ? [] : textColumnsToLookInto.split(','))
      if (kinds[Number(columnIndex)] === undefined) askKindsWanted(Number(columnIndex));
  }, [textColumnsToLookInto, kinds]);
  let columnsShown = [...new Set([...columnsKept, ...reviewRows.columns])].toSorted(
    (left, right) => left - right,
  );
  if (keptColumns.of !== open.plan || columnsShown.length !== keptColumns.columns.length)
    setKeptColumns({
      of: open.plan,
      columns: columnsShown,
    });
  let columnsToCheck = columnsShown
    .filter((columnIndex) => !columnsLeftOutOfImport.includes(columnIndex))
    .flatMap((columnIndex) => preview.columns.find((previewColumn) => previewColumn.columnIndex === columnIndex) ?? []);
  let questionsWithoutColumn = questionsNotAboutColumns(
    questions,
    columnsToCheck.map(({ columnIndex }) => columnIndex),
  );
  let hasColumnsToCheck = columnsToCheck.length + questionsWithoutColumn.length > 0;
  let isAgentAtWorkSaid = useTrueAfterDelay(isRead, AGENT_AT_WORK_ANNOUNCE_DELAY_MS);
  let [hasBeenRead, setHasBeenRead] = React.useState(isRead);
  if (isRead && !hasBeenRead) setHasBeenRead(true);
  let isTurnSettled = useTrueAfterDelay(!isRead, SETTINGS_TURN_DELAY_MS);
  let [tabChosen, setTabChosen] = React.useState<ImportReviewTab | null>(null);
  let tab = tabChosen ?? 'settings';
  let [shownWordOfAgent, setShownWordOfAgent] = React.useState(wordOfAgent);
  if (shownWordOfAgent !== wordOfAgent) {
    setShownWordOfAgent(wordOfAgent);
    if (wordOfAgent !== null) setTabChosen('settings');
  }
  let tabsId = React.useId();
  let focusPropsOfTab = (focusTab: ImportReviewTab) => ({
    onFocus: () => setTabChosen(focusTab),
  });
  let tabPanelPropsOf = (panelTab: ImportReviewTab) =>
    isInTabs
      ? {
          ...focusPropsOfTab(panelTab),
          role: 'tabpanel',
          id: `${tabsId}-panel-${panelTab}`,
          'aria-labelledby': `${tabsId}-${panelTab}`,
          inert: tab !== panelTab,
          [BEHIND_OTHER_TAB_ATTRIBUTE]: tab !== panelTab || undefined,
        }
      : {
          role: 'presentation',
          ...focusPropsOfTab(panelTab),
        };
  let countDigits = String(
    Math.max(0, ...columnsToCheck.map(({ keptAsTextCount }) => keptAsTextCount)),
  ).length;
  let [rowPointedAt, setRowPointedAt] = React.useState<string | null>(null);
  let pointTimerRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  let lastPointedIdRef = React.useRef<string | null>(null);
  let pointAtRow = React.useCallback(
    (rowId: string | null, how: HowRowIsPointedAt) => {
      if (how === 'pointer' && rowId === lastPointedIdRef.current) return;
      clearTimeout(pointTimerRef.current);
      lastPointedIdRef.current = rowId;
      let point = () => {
        setRowPointedAt(rowId);
        if (rowId === null) onNoRowPointedAt();
      };
      if (how === 'atOnce' || (how === 'caret' && rowId !== null)) point();
      else pointTimerRef.current = setTimeout(point, ROW_POINTING_DELAY_MS);
    },
    [onNoRowPointedAt],
  );
  React.useEffect(() => () => clearTimeout(pointTimerRef.current), []);
  let pointableRows = new Map([
    ...columnsToCheck.map(
      ({ columnIndex }): [string, PointableRow] => [
        `column ${columnIndex}`,
        {
          columns: [columnIndex],
          unfolded: NOTHING_DRAWN_ANYWAY,
        },
      ],
    ),
    ...columnsLeftOut.map(
      (columnIndex): [string, PointableRow] => [
        `out ${columnIndex}`,
        {
          columns: [columnIndex],
          unfolded: columnsLeftOutOfImport.includes(columnIndex)
            ? {
                lines: [],
                columns: [columnIndex],
              }
            : NOTHING_DRAWN_ANYWAY,
        },
      ],
    ),
    ...linesLeftOut.map(
      (lineNumber): [string, PointableRow] => [
        `line ${lineNumber}`,
        {
          columns: NO_COLUMNS_POINTED_AT,
          unfolded: plan.linesLeftOut.includes(lineNumber)
            ? {
                lines: [lineNumber],
                columns: [],
              }
            : NOTHING_DRAWN_ANYWAY,
        },
      ],
    ),
  ]);
  let pointedRow = rowPointedAt === null ? undefined : pointableRows.get(rowPointedAt);
  let hasLinesUnfolded = (pointedRow?.unfolded.lines.length ?? 0) > 0 || hasPictureLinesUnfolded;
  let tellRowPointed = React.useEffectEvent((pointedRowKey: string | null) => {
    onColumnsPointedAt(pointedRowKey === null ? NO_COLUMNS_POINTED_AT : (pointedRow?.columns ?? NO_COLUMNS_POINTED_AT));
    onLeftOutShown(pointedRow?.unfolded ?? NOTHING_DRAWN_ANYWAY);
  });
  let pointedKey = rowPointedAt === null ? null : `${rowPointedAt} ${pointedRow?.unfolded === NOTHING_DRAWN_ANYWAY}`;
  React.useEffect(() => tellRowPointed(pointedKey), [pointedKey]);
  let isOff = isRead || open.agent.kind === 'isAsked';
  let paneRef = React.useRef<HTMLDivElement>(null);
  let previewRef = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    let previewElement = previewRef.current;
    if (previewElement === null) return;
    let measure = () =>
      onRoomMeasured({
        gridWidth: previewElement.clientWidth,
        gridHeight: previewElement.clientHeight,
      });
    measure();
    let observer = new ResizeObserver(measure);
    observer.observe(previewElement);
    return () => observer.disconnect();
  }, [onRoomMeasured]);
  let notes = importNotesToShow(open);
  let { summary, isSummaryWhole } = importPlanSoFar(open);
  let hasSummary = (isRead || summary !== null || notes.length > 0) && wordOfAgent === null;
  let turnClasses = importSectionTurnClasses({
    points: hasSummary && notes.length > 0,
    columnsToCheck: hasColumnsToCheck,
  });
  let { child: summaryRef, box: summaryBox } = useMinHeightSince(isRead || !hasSummary ? null : open.plansHeardCount);
  let sheetNoteWords = rowsAndColumnsLabel(importRecordCount(open), importColumnsComingInCount(open));
  let openCount =
    columnsToCheck.filter(({ columnIndex }) => isColumnQuestionOpen(columnIndex)).length +
    questionsWithoutColumn.filter(({ isOpen }) => isOpen).length;
  let outcomeHeard = outcome?.heard ?? sheetNoteWords;
  let heardNow = openCount === 0 ? outcomeHeard : joinImportWordsWithMiddleDots([outcomeHeard, columnsToCheckLabel(openCount)]);
  /** What was heard when the agent's plan was last read in, to tell when it changes. */
  let [heardAtReading, setHeardAtReading] = React.useState<string | null>(null);
  if (isRead !== (heardAtReading === null)) setHeardAtReading(isRead ? null : heardNow);
  let [isHeardSaid, setHeardSaid] = React.useState(false);
  let hasHeardChanged = heardAtReading !== null && heardNow !== heardAtReading;
  if (isHeardSaid ? isRead : hasHeardChanged) setHeardSaid(!isHeardSaid);
  let { destinationChosen } = open;
  let [destinationPicks, setDestinationPicks] = React.useState({
    destinationChosen,
    timesPicked: 0,
  });
  if (destinationPicks.destinationChosen !== destinationChosen) {
    setDestinationPicks({
      destinationChosen,
      timesPicked: destinationPicks.timesPicked + (destinationChosen === null ? 0 : 1),
    });
    if (destinationChosen !== null && !isRead) setHeardSaid(true);
  }
  let { timesPicked } = destinationPicks;
  let [lastChange, setLastChange] = React.useState<ColumnsAskedAgain | null>(null);
  if (isOff && lastChange !== null) setLastChange(null);
  let outcomeAnnouncement = useSettledAnnouncement({
    words: (isHeardSaid || hasHeardChanged) && heardNow,
    timesSaid: timesPicked,
    inPageOf: paneRef,
  });
  let changeAnnouncement = useSettledAnnouncement({
    words: columnsNamedWords(lastChange, preview.columns),
    timesSaid: lastChange?.times ?? 0,
    inPageOf: paneRef,
  });
  let changeByHand = (change: ImportChangeByHand) => {
    setLastChange((askedAgain) => columnsAskedAgainAfterChange(askedAgain, change));
    onChangedByHand(change);
  };
  let answerQuestion = (questionId: string, answer: number) => {
    let columnsOfQuestion = questions.find((question) => question.questionId === questionId)?.columns ?? [];
    setLastChange((askedAgain) => askedAgainColumns(askedAgain, columnsOfQuestion));
    onAnswered(questionId, answer);
  };
  /** The place of the add back button to focus once it is drawn. */
  let focusAfterAddBackRef = React.useRef<string | null>(null);
  let changeColumn = (change: ImportChangeByHand) => {
    if (change.kind === 'column' && change.isLeftOut === true) focusAfterAddBackRef.current = columnNthLabel(change.columnIndex + 1);
    changeByHand(change);
  };
  React.useEffect(() => {
    if (focusAfterAddBackRef.current === null) return;
    let addBackButton = paneRef.current?.querySelector<HTMLElement>(`[${ADDS_BACK_ATTRIBUTE}="${CSS.escape(focusAfterAddBackRef.current)}"]`);
    if (addBackButton === null || addBackButton === undefined) return;
    focusAfterAddBackRef.current = null;
    addBackButton.focus();
  });
  let hasPlacesLeft = importPlacesLeft(open).length > 0;
  let isChangesToASheet = importDestinationSort(open) === 'changesToASheet';
  let linesLeftOutShown = isChangesToASheet ? [] : linesLeftOut;
  let columnsLeftOutShown = [
    ...columnsLeftOut.map(
      (columnIndex) => ({
        columnIndex,
        nameTheSheetLacks: null,
      }),
    ),
    ...(isRead ? [] : columnsLeftOutOfSheetChanges(open))
      .filter(({ columnIndexInTheFile }) => !columnsLeftOut.includes(columnIndexInTheFile))
      .map(
        ({ columnIndexInTheFile, name }) => ({
          columnIndex: columnIndexInTheFile,
          nameTheSheetLacks: name,
        }),
      ),
  ].toSorted((left, right) => left.columnIndex - right.columnIndex);
  let nameSheet = (sheetName: string) =>
    changeByHand({
      kind: 'sheetName',
      name: sheetName,
    });
  let lineTextOf = (lineNumber: number) =>
    (open.table.lines[lineNumber - 1] ?? []).filter((field) => field.trim() !== '').join(', ');
  let wishArea =
    wishToAgent !== null &&
    (<>{isRead &&
          <div className="flex min-h-6 items-center ps-px text-footnote">{agentAtWork}</div>}<div className="flex flex-col gap-sm">{wishToAgent}</div></>);
  return <TooltipGroup>{isInTabs &&
        <Tabs.Root value={tab} onValueChange={(chosen: ImportReviewTab) => setTabChosen(chosen)} onFocus={() => setTabChosen((chosen) => chosen ?? tab)} className="shrink-0 pb-md"><Tabs.List flush aria-label={importReviewMessages.settingsOrPreview()}><Tabs.Tab value="settings" id={`${tabsId}-settings`} aria-controls={`${tabsId}-panel-settings`}>{importReviewMessages.settingsTab()}</Tabs.Tab><Tabs.Tab value="preview" id={`${tabsId}-preview`} aria-controls={`${tabsId}-panel-preview`}>{importReviewMessages.previewTab()}</Tabs.Tab></Tabs.List></Tabs.Root>}<div role="presentation" className="sheet-import-in-dialog -mx-[var(--ui-pad-xl)]" data-is-in-tabs={isInTabs || undefined}><div ref={previewRef} {...tabPanelPropsOf('preview')} className={PICTURE_BOX_CLASS}>{proposal}{picture !== null &&
                <ImportHeadingsRow open={open} picture={picture} place={PICTURE_ORIGIN} zoom={zoom} columnsRevealed={columnsRevealed} columnsUnfolded={columnsUnfolded} onKindsWanted={onKindsWanted} onChangedByHand={changeByHand} onColumnWanted={onColumnWanted} />}{picture !== null &&
                !hasLinesUnfolded &&
                <ImportRowNumbers open={open} picture={picture} lastRow={lastRow} place={PICTURE_ORIGIN} zoom={zoom} onChangedByHand={isOff ? null : (change: ImportChangeByHand) => (isPlanDrawn ? changeByHand(change) : undefined)} />}{shimmer}</div><div {...tabPanelPropsOf('settings')} className={IMPORT_PANE_CLASS} data-is-read={isRead || undefined} data-comes-in-turn={(hasBeenRead && !isRead && !isTurnSettled) || undefined}><SidePane ref={paneRef} title={importDialogLabels.importTitle()} takesNoTyping={false} width={SIDE_PANE_DEFAULT_WIDTH} onWidthChange={() => {
                return;
              }} onClose={() => {
                return;
              }} onKeyDown={() => {
                return;
              }} wasPointerPressedLast={() => false} {...(wishArea !== false &&
                !isInTabs && {
                  foot: wishArea,
                })}><div role="presentation" className="shrink-0" style={summaryBox}><div ref={summaryRef} role="presentation" className="flex flex-col">{hasSummary &&
                        <AgentsReadSection summary={summary} isSummaryWhole={isSummaryWhole} isPlanIn={!isRead} notes={notes} agentAtWorkInWords={agentAtWorkInWords} />}{wordOfAgent !== null &&
                        <AgentsReadFailed why={wordOfAgent} onAskedAgain={onAskedAgain} />}</div></div><PaneSection title={importDialogLabels.sheet()} className={`sheet-import-is-there-from-the-start sheet-import-waits-for-agent border-t-0! ${turnClasses.sheet}`} {...(!isRead && paneSectionNoteActions(sheetNoteWords))}>{!hasPlacesLeft &&
                      <PaneRow label={importSettingsLabels.name()}><NewSheetNameField name={open.newSheet?.name ?? ''} isOff={isOff} onNamed={nameSheet} /></PaneRow>}<PaneRow label={importSettingsLabels.headings()}><HeadingsLineSelect table={open.table} headerLine={plan.headerLine} linesLeftOut={plan.linesLeftOut} isOff={isOff} onPicked={(headerLine) =>
                          changeByHand({
                            kind: 'headings',
                            line: headerLine,
                          })} /></PaneRow>{hasPlacesLeft &&
                      <ImportDestinationRows open={open} isRead={isRead} onPicked={onDestinationPicked} onSheetNamed={nameSheet} />}{isChangesToASheet &&
                      importLinesLeftOut(open).lines.length > 0 &&
                      (<LeftOutLinesMenu open={open} isOff={isOff} onSet={(line, isLeftOut) =>
                          changeByHand({
                            kind: 'line',
                            line,
                            isLeftOut,
                          })} />)}</PaneSection>{!isRead &&
                  hasColumnsToCheck &&
                  (<PaneSection title={importDialogLabels.columnsToCheck()} className={turnClasses.columnsToCheck}>{columnsToCheck.map((column) => {
                        let { columnIndex, name: columnName } = column;
                        let questionOfThisColumn = questionOfColumn(columnIndex);
                        let questionFirstHere =
                          reviewRows.columns.find(
                            (questionColumn) => questionOfThisColumn?.columns.includes(questionColumn) === true,
                          ) === columnIndex
                            ? questionOfThisColumn
                            : undefined;
                        let question =
                          questionFirstHere === undefined
                            ? undefined
                            : plan.questions.find(({ id }) => id === questionFirstHere.questionId);
                        let dateOrderReadings = questionFirstHere === undefined ? null : dateOrderReadingsOfAsk(questionFirstHere, open);
                        let textCellsNote = column.reading.kind === 'text' ? betterReadingForTextColumn(open.kinds[columnIndex]) : null;
                        return (<PointableImportRow key={columnIndex} id={`column ${columnIndex}`} onPointedAt={pointAtRow}>{question !== undefined && dateOrderReadings === null
                                ? (<ImportQuestionRow open={open} plan={plan} question={question} examples={importQuestionExamples(open, question.id)} isOpen={openQuestionIds.includes(question.id)} isOff={isOff} isShortInBox cellsThatStayText={{
                                      columnIndex,
                                      count: column.keptAsTextCount,
                                      first: firstTextCells.get(columnIndex) ?? NO_FIRST_TEXT_CELLS_IN_REVIEW,
                                      digits: countDigits,
                                    }} onAnswered={(answer) => answerQuestion(question.id, answer)} />)
                                : (<><PaneRow label={columnName} labelInFull={columnName} hasDot={isColumnQuestionOpen(columnIndex)}><ColumnKindMenu column={column} kinds={open.kinds[columnIndex]} isLeftOut={columnsLeftOutOfImport.includes(columnIndex)} mustComeIn={columnIndex === importMergeKeyColumn(open) ||
                                            columnsLeftOutOfImport.length === open.table.columnCount - 1} isTabStop={null} isLeftOpen={isColumnQuestionOpen(columnIndex)} onKindsWanted={onKindsWanted} onChanged={isOff ? null : changeColumn} nameField={null} noteUnderText={textCellsNote === null
                                              ? null
                                              : cellsFitFormatWords(
                                                  textCellsNote.fitting,
                                                  textCellsNote.fitting + textCellsNote.notFitting,
                                                  columnReadingKindLabel(textCellsNote.reading.kind),
                                                )} digitsOfCountInBox={countDigits} firstTextCells={firstTextCells.get(columnIndex) ?? NO_FIRST_TEXT_CELLS_IN_REVIEW} /></PaneRow>{questionFirstHere !== undefined &&
                                        question !== undefined &&
                                        dateOrderReadings !== null &&
                                        <DateOrderSegmentedRow asked={questionFirstHere} readings={dateOrderReadings} inForce={open.answers[question.id] ?? question.recommendedIndex} isOff={isOff} onAnswered={answerQuestion} />}</>)}</PointableImportRow>);
                      })}{questionsWithoutColumn.map(({ questionId }) => {
                        let question = plan.questions.find(({ id }) => id === questionId);
                        return question === undefined
                          ? null
                          : <ImportQuestionRow key={questionId} open={open} plan={plan} question={question} examples={importQuestionExamples(open, questionId)} isOpen={openQuestionIds.includes(questionId)} isOff={isOff} isShortInBox onAnswered={(answer) => answerQuestion(questionId, answer)} />;
                      })}</PaneSection>)}{columnsLeftOutShown.length + linesLeftOutShown.length > 0 &&
                  (<PaneSection title={importSettingsLabels.leftOut()} className={turnClasses.leftOut}>{columnsLeftOutShown.map(
                        ({ columnIndex, nameTheSheetLacks }) =>
                          nameTheSheetLacks === null
                            ? (<PointableImportRow key={columnIndex} id={`out ${columnIndex}`} onPointedAt={pointAtRow}><LeftOutAddBackRow where={columnNthLabel(columnIndex + 1)} what={reviewRows.columnsThatAreEmpty.includes(columnIndex)
                                      ? importDialogLabels.empty()
                                      : (plan.columns[columnIndex]?.name ?? '')} addBack={addBackColumnLabel(columnIndex + 1)} isOff={isOff} onAddedBack={() =>
                                      changeByHand({
                                        kind: 'column',
                                        columnIndex,
                                        isLeftOut: false,
                                      })} /></PointableImportRow>)
                            : <ColumnSheetLacksRow key={columnIndex} where={columnNthLabel(columnIndex + 1)} what={nameTheSheetLacks} whyInShort={notInSheetLabel(sheetToImportInto(open)?.table.name ?? '')} why={columnsNotImportedWords([nameTheSheetLacks], sheetToImportInto(open)?.table.name ?? '')} />,
                      )}{linesLeftOutShown.map(
                        (lineNumber) =>
                          (<PointableImportRow key={lineNumber} id={`line ${lineNumber}`} onPointedAt={pointAtRow}><LeftOutAddBackRow where={importLineLabel(lineNumber)} what={lineTextOf(lineNumber)} addBack={addBackLineLabel(lineNumber)} isOff={isOff} onAddedBack={() =>
                                  changeByHand({
                                    kind: 'line',
                                    line: lineNumber,
                                    isLeftOut: false,
                                  })} /></PointableImportRow>),
                      )}</PaneSection>)}</SidePane></div></div><LiveAnnouncer words={isAgentAtWorkSaid && agentAtWorkInWords} /><LiveAnnouncer words={isRead && isSummaryWhole && summary !== null && summaryByAgentLabel(summary)} /><LiveAnnouncer {...outcomeAnnouncement} /><LiveAnnouncer {...changeAnnouncement} />{isInTabs &&
        underBothTabs !== null &&
        <div className="-mx-[var(--ui-pad-xl)] shrink-0 border-t border-alpha-2 px-xl py-md">{underBothTabs}</div>}{isInTabs &&
        wishArea !== false &&
        <div className="-mx-[var(--ui-pad-xl)] flex shrink-0 flex-col gap-sm border-t border-alpha-2 bg-surface-panel px-xl py-md">{wishArea}</div>}<div className="-mx-[var(--ui-pad-xl)] -mb-[var(--ui-pad-xl)] shrink-0 border-t border-alpha-2 px-xl py-md"><Dialog.Footer align="end" className="mt-0"><div role="presentation" className="flex flex-1 items-center justify-between gap-lg max-sm:flex-col max-sm:items-stretch max-sm:gap-sm" onPointerEnter={() => pointAtRow(null, 'atOnce')} onFocus={() => pointAtRow(null, 'atOnce')}><Dialog.Description className="mt-0 min-w-0 text-balance"><ImportFooterSentence sentence={importFooterSentence(isInTabs ? tab : null, errorForPicture, outcome)} isHeldBack={isImportFooterSentenceHeldBack(isInTabs ? tab : null, errorForPicture, isRead)} /></Dialog.Description><div className="flex shrink-0 items-center justify-end gap-sm"><Button variant="secondary" onClick={onDiscarded}>{importDialogLabels.discard()}</Button>{keepButton}</div></div></Dialog.Footer></div></TooltipGroup>;
}
export const NO_COLUMNS_POINTED_AT: number[] = [];
export const ROW_POINTING_DELAY_MS = 200;
export const SETTINGS_TURN_DELAY_MS = 1200;
export const importTurnClass = (turn: number) => (turn === 0 ? '' : `sheet-import-turn-${turn}`);
export const HEADING_FORMAT_ROOM_PX = 48;
export const headingTextWidthCache = new Map<string, number>();
export const NO_IMPORT_REVIEW_ROWS: ImportSettingsToCheck = {
  questions: [],
  columns: [],
  textColumnsYetToLookInto: [],
  columnsLeftOut: [],
  columnsThatAreEmpty: [],
  linesLeftOut: [],
};
export const NO_FIRST_TEXT_CELLS_IN_REVIEW: ImportTextOnRow[] = [];
export const paneSectionNoteActions = (note: string) => ({
  actions: <span className="text-footnote text-secondary">{note}</span>,
});
export const PointableImportRow = ({ id, onPointedAt, children }: PointableImportRowProps) =>
  <div role="presentation" onPointerMove={() => onPointedAt(id, 'pointer')} onPointerLeave={() => onPointedAt(null, 'pointer')} onFocus={() => onPointedAt(id, 'caret')} onBlur={() => onPointedAt(null, 'caret')}>{children}</div>;
export const DATE_AND_DECIMAL_ORDERS = ['yearMonthDay', 'monthDayYear', 'dayMonthYear', 'comma', 'point'];
export const dateOrDecimalOrderRank = (reading: ImportReading | undefined) =>
  reading === undefined
    ? -1
    : DATE_AND_DECIMAL_ORDERS.indexOf('order' in reading ? reading.order : 'decimalSign' in reading ? reading.decimalSign : '');
export const ADDS_BACK_ATTRIBUTE = 'data-adds-back';
export const IMPORT_PANE_CLASS = 'sheet-import-pane';
export const BEHIND_OTHER_TAB_ATTRIBUTE = 'data-is-behind-the-other-tab';
export const PICTURE_BOX_ENABLED_BUTTONS_SELECTOR = `.${PICTURE_BOX_CLASS}:not([${BEHIND_OTHER_TAB_ATTRIBUTE}]) button:enabled`;
export const IMPORT_PANE_ENABLED_BUTTONS_SELECTOR = `.${IMPORT_PANE_CLASS}:not([${BEHIND_OTHER_TAB_ATTRIBUTE}]) button:enabled`;
export const importFooterSentence = (tab: ImportReviewTab | null, errorForPicture: string | null, outcome: ImportOutcomeWords | null) =>
  tab !== null && errorForPicture !== null
    ? errorForPicture
    : (outcome?.atTheFoot ?? (errorForPicture !== null ? '' : importDialogLabels.whatToDo()));
export const isImportFooterSentenceHeldBack = (tab: ImportReviewTab | null, errorForPicture: string | null, isRead: boolean) =>
  tab !== null && errorForPicture !== null ? tab === 'preview' : isRead;
export const ImportFooterSentence = ({ sentence, isHeldBack }: ImportFooterSentenceProps) =>
  isHeldBack
    ? <span aria-hidden className="invisible">{sentence}</span>
    : <span className="sheet-import-comes block">{sentence}</span>;
export const AGENT_AT_WORK_ANNOUNCE_DELAY_MS = 1500;
export const NOTHING_TO_ANNOUNCE: SettledAnnouncement = {
  words: false,
  timesSaid: 0,
};
