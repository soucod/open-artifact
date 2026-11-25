import type { NewsOfLoss, Notice, PageState } from './initial-state.ts';
export const dropdownEditorOfPane = ({ sidePane }: Pick<PageState, 'sidePane'>) => (sidePane?.kind === 'dropdown' ? sidePane.editor : null);
export const conditionalRulesOfPane = ({ sidePane }: Pick<PageState, 'sidePane'>) =>
  sidePane?.kind === 'conditionalFormats' ? sidePane.rules : null;
export const isSidePaneShownAsPane = (view: Pick<PageState, 'sidePane'>): boolean =>
  view.sidePane !== null && (conditionalRulesOfPane(view)?.drawnAs ?? 'pane') === 'pane';
export const canOfferAgentForRules = (view: Pick<PageState, 'sidePane' | 'isAgentForRulesNotToBeHad' | 'hasViewNoAgentForRules'>): boolean =>
  !view.isAgentForRulesNotToBeHad && !view.hasViewNoAgentForRules && !isSidePaneShownAsPane(view);
export const versionHistoryOfPane = ({ sidePane }: Pick<PageState, 'sidePane'>) =>
  sidePane?.kind === 'versionHistory' ? sidePane.history : null;
export const newsOfLossIfTypingLost = (
  { mode, newsOfLoss }: Pick<PageState, 'mode' | 'newsOfLoss'>,
  kind: NewsOfLoss['kind'],
): NewsOfLoss | null =>
  mode.kind === 'editing' && mode.text !== mode.textAtStart
    ? {
        kind,
      }
    : newsOfLoss;
export const NOTICE_GIVES_WAY = {
  oneRangeNeeded: true,
  linkHeldByCommentMode: true,
  rowsOutOfViewInTheWay: true,
  ownSortInTheWay: true,
  ownSortIsOver: false,
  editRefused: true,
  cellHoldsNoMorePeople: true,
  groupsTooDeep: true,
  tooManyNamedViews: true,
  sheetNameRefused: false,
  dropdownCellsRefused: false,
  mergeWouldClearCells: true,
  cellsNotCopied: true,
  chartNotCut: true,
  chartsBeingCopied: false,
  chartsLeftBehindByDuplicate: false,
  changedSinceEdit: false,
  formatsTooMixedSinceEdit: false,
  nothingElseLeftSinceEdit: false,
  sheetNameTakenSinceEdit: false,
  sheetNotBroughtBack: false,
  stepGivenUp: false,
  editsDropped: false,
  undoStepsLeftInEarlierPage: false,
  entryDroppedByMerge: false,
  entryDroppedByRemoval: false,
  entriesNotKept: false,
  entryNotForCheckbox: false,
  linkNotCopied: true,
  fileNotImported: true,
  noTableToFilter: true,
  filteredTableIsGone: false,
  ownFilterNotWorkedOut: true,
  alreadySorted: true,
  matchesNotReplaced: true,
  textsNotConverted: true,
  fixesCameToNothing: false,
  callsForFixesFailed: true,
  fixesGoneWithChange: false,
  versionNotTakenBack: true,
  turnOfAgentNotUndone: false,
  versionNotShown: true,
};
export const noticeGivesWay = (notice: Notice): boolean =>
  NOTICE_GIVES_WAY[notice.kind] && !(notice.kind === 'editRefused' && notice.isTypingLost);
export const isEditRefusedForSaving = (notice: Notice): boolean =>
  notice.kind === 'editRefused' && (notice.why === 'savingStopped' || notice.why === 'pageOutOfDate' || notice.why === 'editingPaused');
/** Every kind of notice the page tells, each keyed in NOTICE_GIVES_WAY. */
export type NoticeKind = keyof typeof NOTICE_GIVES_WAY;
