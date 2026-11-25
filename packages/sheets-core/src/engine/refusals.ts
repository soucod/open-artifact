/**
 * Why the engine refuses, and why a synced session stops or faults. Every
 * refusal is answered `{"kind": "refused", "refusal": …}`.
 */

/** Why operations are refused (`load`, `apply`, and edits once worked out into operations). */
export type OpRefusal =
  | 'unreadableRequest'
  | 'unknownSheet'
  | 'unknownRow'
  | 'unknownColumn'
  | 'columnNamedTwice'
  | 'rowNamedTwice'
  | 'cellNamedTwice'
  | 'rowMovedTwice'
  | 'columnMovedTwice'
  | 'sheetMovedTwice'
  | 'movedAfterWhatIsMoved'
  | 'twoMovesToOnePlace'
  | 'idAlreadyHeld'
  /** Undeleting what a load deleted: the load did not keep it. */
  | 'deletedCellsNotLoaded'
  | 'numberNotFinite'
  /** `load`, `apply`, `undo` or `replay` on a session that syncs. */
  | 'syncInUse'
  | 'cellFormatSetTwice'
  | 'sheetSettingsSetTwice'
  | 'unknownDropdown'
  | 'dropdownSetTwice'
  | 'dropdownOptionIdInTwoDropdowns'
  | 'dropdownIdTaken'
  | 'dropdownOptionIdTaken'
  | 'dropdownInUse'
  | 'unknownGroup'
  | 'groupNamedTwice'
  | 'unknownConditionalFormat'
  | 'conditionalFormatNamedTwice'
  | 'viewNamedTwice'
  | 'viewInUse'
  | 'unknownView'
  | 'namedViewNamedTwice'
  | 'placementNamedTwice'
  | 'cellTableNamedTwice'
  | 'rangeAlreadyMerged'
  | 'rangeNotMerged'
  | 'unknownDropdownOption'
  | 'cellOfDropdownHoldsNoOption'
  | 'cellCoveredByMergedRange'
  | 'textTooLong'
  | 'formulaTooLong'
  | 'tooMuchThatNoCellShows'
  | 'idNotWellFormed'
  | 'editTooLarge'
  | 'tooManyCellsToEnterIn'
  | 'userIdNotWellFormed'
  | 'tooManyUsersInCell'
  | 'userLabelNotAllowed'
  | 'addressLinkedToTooLong'
  | 'addressLinkedToNotOfTheWeb'
  | 'richTextTooLarge'
  | 'rowNotNamedInTheWay';

/** Why a reverse (`undo`) or a step taken back is refused. */
export type TakeBackRefusal =
  /** The reverse does not apply to the workbook: it is not one. */
  | 'notAReverse'
  /** What the step did is no longer so. */
  | 'changedSince'
  /** Taking it back would give a sheet a name another sheet has. */
  | 'sheetNameTaken'
  | 'reverseNotAccepted'
  | 'tooMuchToTakeBack'
  | 'builtOnAnotherRevision'
  | 'stepToReverseNotMadeHere'
  | 'reverseOfStepNeverKnown'
  | 'noSheetLeft'
  | 'historyDoesNotMatch';

/** Why a request of syncing about an edit is refused, besides the operations' own refusals. */
export type QueueRefusal =
  /** The session has stopped (`nextStep.kind === 'stop'`). */
  | 'syncStopped'
  /** An edit queued or confirmed already has the op id. */
  | 'opIdInUse'
  /** Rows, columns or sheets moved (by a move or a sort) among other edits of one request. */
  | 'moveAmongSeveralEdits'
  /** The edit would leave the workbook holding more cells than it may (500 000). */
  | 'tooManyCells';

/**
 * Why a pivot table edit (`insertPivotTable`, `changePivotTable`) is refused,
 * besides an unknown sheet, row or column. `readValuesToFilterPivotTableBy`
 * refuses with `pivotTableSourceHasNoHeader` and `pivotTableSourceHasNoRecords`.
 */
export type PivotTableRefusal =
  /** The new sheet's name cannot be a sheet's. */
  | 'sheetNameNotAllowed'
  | 'noPivotTableAtTheCell'
  /** No table of the source sheet has its header on the source's header row. */
  | 'pivotTableSourceHasNoHeader'
  | 'pivotTableColumnNotOfSource'
  | 'pivotTableWouldReadItself'
  | 'pivotTableWouldTouchATable'
  /** A cell where the pivot table would go is not empty. */
  | 'pivotTableCellsInTheWay'
  /** It would spill past the sheet's last row or column. */
  | 'tooManyRows'
  | 'tooManyColumns'
  | 'pivotTableFormulaInTheWay'
  | 'pivotTableWouldBeReadByAnother'
  | 'pivotTableTooLarge'
  | 'pivotTableWithColumnsTakesOneValue'
  | 'pivotTableSourceHasNoRecords'
  | 'pivotTableSourceHasSectionsOrSubtotals'
  /** The source's records cannot be told apart (merged cells among them, or the header again). */
  | 'pivotTableSourceRecordsNotClear'
  | 'pivotTableTotalNeedsNumbers'
  | 'pivotTablePeriodNeedsDates'
  | 'pivotTableFilterValueCannotBeWritten';

/** Why an edit is refused for an interactive view, or for a sheet that shows one. */
export type InteractiveRefusal =
  /** No sheet shows the view as an interactive one. */
  | 'unknownInteractive'
  /** A cell written is not one the view keeps a value for. */
  | 'cellIsNotTheInteractives'
  /** A cell written holds more than a plain value. */
  | 'cellHoldsMoreThanAValue'
  | 'valueDoesNotFitCell'
  | 'textTooLong'
  /** Saving the inputs' values would make the view too large. */
  | 'interactiveSavesTooMuch'
  /** An edit would change the grid of a sheet that shows an interactive view. */
  | 'sheetIsAnInteractive'
  /** A placement would show an interactive view: a sheet shows one in place of its grid instead. */
  | 'viewIsAnInteractive'
  /** The sheet setting `interactive` names a view with no interactive element. */
  | 'viewIsNoInteractive'
  /** The sheet setting `interactive` set on a sheet that holds cells. */
  | 'sheetForInteractiveIsNotEmpty';

/** Why `moveColumnsOfCells` is refused, besides an unknown sheet, row or column. */
export type MoveColumnsOfCellsRefusal =
  /** A column moved, or the one to move after, is not among the cells. */
  | 'movedColumnOutsideTheCells'
  | 'mergedRangeAmongMovedColumnsOfCells'
  | 'columnOutOfSightAmongMovedColumnsOfCells'
  | 'spilledValuesAmongMovedColumnsOfCells';

/** Why `saveNamedView` or `removeNamedView` is refused, besides an unknown sheet or column. */
export type NamedViewRefusal =
  | 'nameOfNamedViewNotAllowed'
  | 'nameOfNamedViewTaken'
  | 'tooManyNamedViews'
  | 'unknownNamedView'
  | 'tooManyTestsInNamedView'
  | 'tooManyKeysInNamedView'
  | 'namedViewTooLarge'
  | 'valueInNamedViewNotAllowed';

/**
 * Every refusal the engine is known to answer with. Edits and reads add
 * refusals of their own (`unknownSheet`, `sheetNameTaken`, `noCellsToSort`, …);
 * those are told as plain strings where their kinds are not listed here.
 */
export type Refusal =
  | OpRefusal
  | TakeBackRefusal
  | QueueRefusal
  | PivotTableRefusal
  | InteractiveRefusal
  | MoveColumnsOfCellsRefusal
  | NamedViewRefusal;

/** A refused request. */
export interface Refused<R extends string = string> {
  kind: 'refused';
  refusal: R;
}

/** Why a synced session stops: it takes no more edits, and its next step stays `stop`. */
export type StopReason =
  /** An edit or load page written in a format version the engine does not know (a newer one). */
  | 'unknownFormatVersion'
  /** A load page written in a format version the engine no longer reads. */
  | 'formatVersionNoLongerTaken'
  /** A load page whose operations cannot be read or applied. */
  | 'unreadableLoad';

/** What went wrong with another's edit: the workbook is loaded again (`fetchLoadPage`). */
export type Fault = 'streamedEditRefused' | 'streamedEditUnreadable';
