import type { LimitRefusalKind } from '../model/refusals.ts';
import type {
  EditRefusedOnPage,
  FileNotImportedNotice,
  NewsOfLoss,
  Notice,
  OneRangeAct,
  SavingState,
  VersionNotTakenNotice,
} from '../state/initial-state.ts';
import type { AskedKindOfEdit, SheetNameRefusal } from '../state/edit-answers.ts';
import type { CopyRefused, EditsDropped } from '../state/event-reducer.ts';
import type { AgentUndoRefusalWhy } from './agent-turn-labels.ts';
import { translateMessage, MESSAGE_LOCALE } from './messages.ts';
import { savingStoppedText, readOnlyText, commentModeHint } from './status-labels.ts';
import { fixFailureText } from './formula-fix-labels.ts';
import { filterNoticeText, ownSortNoticeText } from '../tables/filter-messages.ts';
import { versionNotRestoredText, versionNotShownText } from '../history/version-text.ts';
import { agentUndoRefusalText } from './agent-turn-labels.ts';
import { filterHidesRowsRefusal } from '../messages/filter-refusals.ts';
import { dropdownCellsRefusalText } from './chip-labels.ts';
import { truncateGraphemes, SHEET_NAME_IN_NOTICE_MAX_CHARACTERS } from './grid-action-labels.ts';
import { namedViewRefusalLabel, namedViewLimitRefusalLabel } from '../tables/named-view-messages.ts';
import { interactiveNotWritableText, interactiveWritesTooLargeText, interactiveNotDuplicatedText } from '../messages/import.ts';
/** The modifier key to press instead of a menu command, or null when there is no keyboard. */
export type KeyInstead = Exclude<CopyRefused['keyInstead'], 'sameInAMoment'>;
/** Why edits already made were dropped by the workbook, when it said. */
export type WhyEditsDropped =
  | LimitRefusalKind
  | 'noMoreEditsTaken'
  | 'readOnly'
  | 'tooLargeForOneEdit'
  | 'tookTooLong'
  | 'editingPaused'
  | 'notTakenForNow'
  | undefined;
/** Why a file was not imported. */
export type WhyFileNotImported = FileNotImportedNotice['why'] | 'folder';
/** A notice or news of loss, with the reasons some kinds carry that `Notice` and `NewsOfLoss` do not list yet. */
export type NoticeTold =
  | Exclude<Notice | NewsOfLoss, VersionNotTakenNotice | FileNotImportedNotice | EditsDropped>
  | (VersionNotTakenNotice & { kind: 'versionNotTakenBack' | 'versionNotShown' })
  | { kind: 'turnOfAgentNotUndone'; why: AgentUndoRefusalWhy }
  | (Omit<FileNotImportedNotice, 'why'> & { why: WhyFileNotImported })
  | (Omit<EditsDropped, 'why'> & { why?: WhyEditsDropped });
export function saveStatusText(
  saveStatus: SavingState,
  hasUnsavedEdits: boolean,
  isRetryingLong: boolean = false,
  isEditingPaused: boolean = false,
): string | null {
  switch (saveStatus) {
    case 'allSaved':
    case 'saving':
      return isEditingPaused
        ? translateMessage({
            defaultMessage: 'Editing is paused for this Sheet and will turn back on by itself. You can still view, copy, filter, and download it.',
            id: 'PfojhF/QXN',
          })
        : null;
    case 'retrying':
      return isRetryingLong
        ? translateMessage({
            defaultMessage: 'Your latest changes still aren’t saved. They’re only on this page, so keep it open.',
            id: 'QJYjYOmtFu',
          })
        : translateMessage({
            defaultMessage: 'Your latest changes aren’t saved yet. Keep this page open while it tries again.',
            id: 'ViYbsNoIFd',
          });
    case 'stopped':
      return hasUnsavedEdits
        ? translateMessage({
            defaultMessage:
              'Your latest changes may not have been saved, and this page can’t save any more. Copy what you need, then reload the page.',
            id: 'lA2hb+PXcu',
          })
        : savingStoppedText();
    case 'stoppedOutOfDate':
      return translateMessage({
        defaultMessage: 'This page is out of date, so it no longer shows or saves changes. Reload it to keep working.',
        id: 'SrrKpNzOMl',
      });
    case 'stoppedOutOfDateWithUnsavedEdits':
      return translateMessage({
        defaultMessage:
          'This page is out of date, so it no longer shows or saves changes. Your latest changes may not be saved. Copy what you need, then reload the page.',
        id: 'QKA7FpgqEo',
      });
  }
}
export function sheetNameRefusedText({ name: sheetName, why }: SheetNameRefusal): string {
  if (why === 'sheetNameTaken')
    return translateMessage({
      defaultMessage: 'Another sheet already has this name.',
      id: 'wlakd2oWyf',
    });
  if (why !== 'sheetNameNotAllowed') return editRefusedText(why, 'otherEdit');
  return sheetName === ''
    ? translateMessage({
        defaultMessage: 'Enter a name.',
        id: 'BA7Znh1zpE',
      })
    : translateMessage({
        defaultMessage: 'A sheet name can have up to 100 characters.',
        id: 'RGe9E3wHQY',
      });
}
export function tooLargeTextForAct(act: AskedKindOfEdit): string {
  if (act === 'paste') return pasteTooLargeText();
  if (act === 'pasteOfCut') return moveTooLargeText();
  if (act === 'import') return importFileTooLargeText();
  if (act === 'duplicateOfSheet') return duplicateTooLargeText();
  if (act === 'move') return moveChangesTooManyFormulasText();
  if (act === 'moveOfColumnsOfTablePastOne')
    return translateMessage({
      defaultMessage: 'Nothing was moved, because too many cells would change places.',
      id: 'PlNMTbBBUv',
    });
  if (act === 'moveOfColumnsOfTable')
    return translateMessage({
      defaultMessage: 'Nothing was moved, because too many cells would change places. Moving past fewer columns may work.',
      id: 'JYErnzPK1Z',
    });
  if (act === 'sort') return sortTooLargeText();
  if (act === 'sortOfRange') return sortRangeTooLargeText();
  return act === 'removalOfOneOption' ? optionRemovalTooLargeText() : changeTooLargeText();
}
export function editRefusedText(refusal: EditRefusedOnPage['why'], act: AskedKindOfEdit, mergedCells?: string): string {
  switch (refusal) {
    case 'readOnly':
      return readOnlyText();
    case 'commentModeIsOn':
      return commentModeHint();
    case 'savingStopped':
      return savingStoppedText();
    case 'earlierVersionShown':
      return translateMessage({
        defaultMessage: 'That change wasn’t made, because this is an earlier version. Go back to the current version to edit.',
        id: 'TZxY+WXfaa',
      });
    case 'pageOutOfDate':
      return translateMessage({
        defaultMessage: 'That change wasn’t made, because this page is out of date.',
        id: 'q6jHf7MF4y',
      });
    case 'editingPaused':
      return translateMessage({
        defaultMessage: 'Editing is paused for this Sheet.',
        id: 'mhgYgrzL68',
      });
    case 'numberTooLarge':
      return translateMessage({
        defaultMessage: 'That number is too large to keep. Enter a smaller one.',
        id: '+k/CjHiSJW',
      });
    case 'textTooLong':
      if (act === 'fill')
        return translateMessage({
          defaultMessage: 'Nothing was filled, because one of those texts would be too long for a cell. Fill fewer cells.',
          id: '/etfFEXUzR',
        });
      if (act === 'import')
        return translateMessage({
          defaultMessage:
            'Nothing was imported, because one of the cells in that file has too much text. Shorten that text, then import the file again.',
          id: 'jBFD8L9Fdv',
        });
      return act === 'paste'
        ? translateMessage({
            defaultMessage: 'Nothing was pasted, because one of those cells has too much text. Shorten that text, then copy and paste again.',
            id: 'CAPfpKMS9R',
          })
        : translateMessage({
            defaultMessage: 'That text is too long for one cell. Shorten it, or split it across cells.',
            id: 'vgpW11zfUI',
          });
    case 'formulaTooLong':
      if (act === 'fill')
        return translateMessage({
          defaultMessage: 'Nothing was filled, because one of those formulas would be too long. Fill fewer cells.',
          id: 'if9Ix1qhp8',
        });
      if (act === 'sortOfRange')
        return translateMessage({
          defaultMessage: 'Nothing was sorted, because one of those formulas would be too long. Select fewer cells.',
          id: 'B7tPT0rM8U',
        });
      if (act === 'sort')
        return translateMessage({
          defaultMessage: 'Nothing was sorted, because one of the formulas would be too long.',
          id: '6pPmg+i8b5',
        });
      if (act === 'import')
        return translateMessage({
          defaultMessage:
            'Nothing was imported, because one of the formulas in that file is too long. Shorten that formula, then import the file again.',
          id: '1qdb+k4rzC',
        });
      if (act === 'pasteOfCut' || isMoveOfColumnsOfTable(act))
        return translateMessage({
          defaultMessage:
            'Nothing was moved, because one of the formulas would become too long. Break it into smaller formulas, then move the cells again.',
          id: 'glkyCobLbO',
        });
      return act === 'paste'
        ? translateMessage({
            defaultMessage:
              'Nothing was pasted, because one of those formulas is too long. Break it into smaller formulas, then copy and paste again.',
            id: 'ilh1svJ5Rp',
          })
        : translateMessage({
            defaultMessage: 'That formula is too long to keep. Break it into smaller formulas in other cells.',
            id: '1ByCHz38b6',
          });
    case 'formatsTooMixed':
      if (act === 'format') return formatTooMixedText();
      if (act === 'import') return importFileTooLargeText();
      if (act === 'duplicateOfSheet') return duplicateTooLargeText();
      if (act === 'sortOfRange') return sortRangeTooLargeText();
      if (isMoveOfColumnsOfTable(act)) return tooLargeTextForAct(act);
      if (act === 'pasteOfCut')
        return translateMessage({
          defaultMessage: 'Nothing was moved, because those cells have too much mixed formatting to move at once. Move fewer cells at a time.',
          id: 'jm9eWXZ2Wa',
        });
      return act === 'paste'
        ? translateMessage({
            defaultMessage:
              'Nothing was pasted, because those cells have too much mixed formatting to paste at once. Copy and paste fewer cells at a time.',
            id: 'hvkjn4R471',
          })
        : changeTooLargeText();
    case 'undoTooLarge':
      return act === 'format' ? formatTooMixedText() : tooLargeTextForAct(act);
    case 'tooLargeForOneEdit':
      return tooLargeTextForAct(act);
    case 'selectionTooLargeToPasteInto':
      return translateMessage({
        defaultMessage: 'Nothing was pasted, because the selection is too large to paste into at once. Select fewer cells and paste again.',
        id: 'xP2HfjpFbf',
      });
    case 'noRoomInWorkbook':
      return act === 'import' ? importNoRoomText() : noRoomInWorkbookText();
    case 'tooManySheets':
      if (act === 'duplicateOfSheet') return duplicateTooManySheetsText();
      return act === 'import' ? importTooManySheetsText() : noRoomInWorkbookText();
    case 'tooManyCharts':
      if (act === 'paste')
        return translateMessage({
          defaultMessage: 'Nothing was pasted, because this Sheet can’t hold any more charts. To make room, delete charts you don’t need.',
          id: '/HpweB2K9Z',
        });
      return act === 'duplicateOfSheet'
        ? translateMessage({
            defaultMessage:
              'Nothing was duplicated, because this Sheet can’t hold any more charts. Charts on deleted sheets still count, so continue in a new Sheet.',
            id: '/ABFBApKOO',
          })
        : noRoomInWorkbookText();
    case 'chartsNotCopied':
      if (act === 'paste')
        return translateMessage({
          defaultMessage: 'Nothing was pasted, because the chart couldn’t be copied. Try again.',
          id: 'k2r7WNXQnl',
        });
      return translateMessage({
        defaultMessage: 'Nothing was duplicated, because that sheet’s charts couldn’t be copied. Try again.',
        id: 'ldylYam2sm',
      });
    case 'chartNeverCopied':
      return translateMessage({
        defaultMessage: 'Nothing was pasted, because that chart can’t be copied. You can ask Agent to make a new one.',
        id: '+ayoysN7ET',
      });
    case 'chartNotInWorkbook':
      return translateMessage({
        defaultMessage: 'Nothing was pasted, because charts can only be pasted in the Sheet they were copied from, while they’re still there.',
        id: 'm26tadBTzU',
      });
    case 'tooManyConditionalFormats':
      return translateMessage({
        defaultMessage:
          'That change wasn’t made, because this Sheet can’t hold any more conditional formatting rules. To make room, remove rules you don’t need.',
        id: 'LwHDk5S7Gy',
      });
    case 'namedViewNameTaken':
    case 'namedViewTooLarge':
    case 'namedViewIsGone':
      return namedViewRefusalLabel(refusal, act);
    case 'interactiveCantWrite':
      return interactiveNotWritableText();
    case 'interactiveSavesTooMuch':
      return interactiveWritesTooLargeText();
    case 'interactiveNotCopied':
    case 'interactiveNeverCopied':
      return interactiveNotDuplicatedText(refusal);
    case 'tableTooLarge':
      return tooLargeTextForAct(act);
    case 'pasteDoesNotFit':
      return translateMessage({
        defaultMessage: 'There isn’t room to paste that here. Insert more rows or columns, or paste nearer the top left.',
        id: 'FsUAiJUkq6',
      });
    case 'isNoOptionOfDropdown':
      return act === 'otherEdit'
        ? translateMessage({
            defaultMessage: 'Dropdown cells can only have one of their options, so they didn’t change. Pick one of the options instead.',
            id: 'a/rdZ33zbN',
          })
        : translateMessage({
            defaultMessage: 'Dropdown cells can only have one of their options, so nothing changed. Add the new values to the options first.',
            id: 'IJhMJDpq40',
          });
    case 'mergedCellsOverlap':
    case 'pasteCutsMergedCells':
      if (act === 'duplicateOfSheet') return duplicateMergedCellsText();
      if (act === 'import')
        return translateMessage({
          defaultMessage: 'Nothing was imported, because some merged cells are in the way. Unmerge them first, or import to a new sheet.',
          id: 'Gb+iI+KKwL',
        });
      if (act === 'pasteOfCut')
        return translateMessage({
          defaultMessage:
            'Nothing was moved, because some of the cells would land under a merged cell. Unmerge it first, or move them somewhere else.',
          id: '6Guc+qop76',
        });
      return act === 'fill'
        ? translateMessage({
            defaultMessage: 'That would fill part of a merged cell. Unmerge the cells first, or fill somewhere else.',
            id: 'He6OQYi1Lv',
          })
        : translateMessage({
            defaultMessage: 'That would paste over part of a merged cell. Unmerge the cells first, or paste somewhere else.',
            id: 'cwkdLLJWS1',
          });
    case 'pasteHidesTooMuchText':
      if (act === 'pasteOfCut') return moveTooLargeText();
      return translateMessage({
        defaultMessage: 'Nothing was pasted, because too many of those cells contain text they don’t show. Copy and paste fewer cells at a time.',
        id: 'XSP1wbdQmM',
      });
    case 'patternEndsTooSoon':
      return translateMessage({
        defaultMessage: 'Nothing was filled, because a pattern in those cells can’t go on that far. Fill fewer cells.',
        id: 'DJhw/VrQNT',
      });
    case 'sortKeysNotCalculated':
      return translateMessage({
        defaultMessage: 'Nothing was sorted, because the formulas in that column are taking too long to calculate. Sort by another column.',
        id: 'FRBiXEy0de',
      });
    case 'sortColumnFilledDownByOneFormula':
      return translateMessage({
        defaultMessage: 'Nothing was sorted, because one formula fills several rows of that column. Sort by another column, or leave those rows out.',
        id: 'XW56mV1tFe',
      });
    case 'sortColumnFilledFromOutsideTheCells':
      return translateMessage({
        defaultMessage: 'Nothing was sorted, because formulas outside the selected cells fill that column. Sort the whole table instead.',
        id: 'TYBcc5fRnu',
      });
    case 'tooManyGroups':
      if (act !== 'sort' && act !== 'sortOfRange') return noRoomInWorkbookText();
      return translateMessage({
        defaultMessage: 'Nothing was sorted, because this Sheet has too many hidden or grouped rows to sort. Use Ungroup rows on some of them first.',
        id: 'NnaGGdNsuF',
      });
    case 'tooManyFormulasReadMovedCells':
      if (act === 'moveOfColumnsOfTablePastOne')
        return translateMessage({
          defaultMessage: 'Nothing was moved, because too many formulas use this table’s cells.',
          id: 'CyGkEoPcWQ',
        });
      if (act === 'moveOfColumnsOfTable')
        return translateMessage({
          defaultMessage: 'Nothing was moved, because too many formulas use this table’s cells. Moving past fewer columns may work.',
          id: 'O3rbxMvKDh',
        });
      return translateMessage({
        defaultMessage: 'Nothing was moved, because too many formulas use those cells. Moving fewer cells may help.',
        id: 'Io2klzSkWn',
      });
    case 'formulasNotCalculated':
      if (act === 'newPivotTable')
        return translateMessage({
          defaultMessage: 'No pivot table was made, because some formulas are taking too long to calculate.',
          id: 'MEqLafyy0Z',
        });
      if (act === 'changeOfPivotTable')
        return translateMessage({
          defaultMessage: 'This pivot table wasn’t updated, because some formulas are taking too long to calculate.',
          id: 'nrBxWQGMiH',
        });
      if (act === 'fitOfColumns')
        return translateMessage({
          defaultMessage: 'Nothing was resized, because some formulas are taking too long to calculate. Drag a column’s edge to set its width.',
          id: 'bWEFV2QT0h',
        });
      return translateMessage({
        defaultMessage: 'Nothing was moved, because some formulas are taking too long to calculate.',
        id: 'e4PFa7Z8oh',
      });
    case 'noTableForPivotTable':
      return translateMessage({
        defaultMessage: 'Select a cell in a table to make a pivot table.',
        id: 'b9NUhxT6Hu',
      });
    case 'pivotTableSourceHasNoHeader':
      return translateMessage({
        defaultMessage: 'These cells need a header row to make a pivot table.',
        id: '9XIvnNuEim',
      });
    case 'pivotTableSourceHasNoRecords':
      return translateMessage({
        defaultMessage: 'This table has no rows to summarize.',
        id: 'oYczPij74P',
      });
    case 'pivotTableSourceRecordsNotClear':
      return translateMessage({
        defaultMessage: 'It isn’t clear which rows belong to this table. Unmerge cells and remove repeated headings, then try again.',
        id: 'MWbybwsHru',
      });
    case 'pivotTableSourceHasSectionsOrSubtotals':
      return translateMessage({
        defaultMessage: 'This table has sections or subtotals that would be counted twice. Remove them or copy the rows to a new sheet.',
        id: 'o5nVRBVjJR',
      });
    case 'pivotTableColumnNotOfSource':
      return translateMessage({
        defaultMessage: 'That column isn’t part of the table anymore.',
        id: 'qEdh4Viz3f',
      });
    case 'pivotTableTotalNeedsNumbers':
      return translateMessage({
        defaultMessage: 'This total needs a column of numbers.',
        id: 'mql3BGJcSF',
      });
    case 'pivotTablePeriodNeedsDates':
      return translateMessage({
        defaultMessage: 'Grouping by day, month, quarter, or year needs a column of dates.',
        id: 'uaUg0J4b17',
      });
    case 'pivotTableFilterValueCannotBeWritten':
      return translateMessage({
        defaultMessage: 'The filter can’t use that error value.',
        id: 'qs8g9fF63n',
      });
    case 'pivotTableWouldReadItself':
      return translateMessage({
        defaultMessage: 'The pivot table could grow over that cell. Pick a cell above or to the left of the pivot table, or on another sheet.',
        id: 'xA4IvOBkWB',
      });
    case 'pivotTableWouldTouchATable':
      return translateMessage({
        defaultMessage: 'Leave a blank row or column between the pivot table and its data.',
        id: 'Ac0pGcc02+',
      });
    case 'pivotTableWouldBeReadByAnother':
      return translateMessage({
        defaultMessage: 'Another pivot table would count these cells as its data. Move this pivot table to its own sheet.',
        id: 'MkEcbFj9BH',
      });
    case 'pivotTableCellsInTheWay':
      return translateMessage({
        defaultMessage: 'Some cells the pivot table would fill aren’t empty. Clear them or move the pivot table.',
        id: 'xDHzCK238+',
      });
    case 'pivotTableFormulaInTheWay':
      return translateMessage({
        defaultMessage: 'Another formula could fill the same cells. Move the pivot table to its own sheet.',
        id: 'stofufC2Kl',
      });
    case 'pivotTableTooLarge':
      return translateMessage({
        defaultMessage: 'This pivot table is too large. Remove a field or add a filter.',
        id: 'TckOILZu8N',
      });
    case 'moveSplitsMergedCells':
      if (act === 'sort' || act === 'sortOfRange')
        return translateMessage({
          defaultMessage: 'Nothing was sorted, because that would split a merged cell. Unmerge the cells first.',
          id: 'jNYRpP0stj',
        });
      if (mergedCells !== undefined)
        return translateMessage(
          {
            defaultMessage: 'Nothing was moved, because that would split the merged cell {cells}. Unmerge the cells first.',
            id: 'CenH8wn76/',
          },
          {
            cells: mergedCells,
          },
        );
      return translateMessage({
        defaultMessage: 'Nothing was moved, because that would split a merged cell. Unmerge the cells first.',
        id: 'aJUnfH1o1b',
      });
    case 'moveCrossesSpilledCells':
      return translateMessage({
        defaultMessage: 'Nothing was moved, because a formula’s results would be split up. Move or clear that formula first.',
        id: 'VmW72o2pnN',
      });
    case 'moveCrossesHiddenColumn':
      return translateMessage({
        defaultMessage: 'Nothing was moved, because a hidden or collapsed column is in the way. Show it first.',
        id: 'DKQt3RBad5',
      });
    case 'groupsPartlyOverlap':
      return act === 'groupOfColumns'
        ? translateMessage({
            defaultMessage: 'Nothing was grouped, because the selection overlaps part of a group. Select the whole group, or only columns inside it.',
            id: '6H+hKtE0yb',
          })
        : translateMessage({
            defaultMessage: 'Nothing was grouped, because the selection overlaps part of a group. Select the whole group, or only rows inside it.',
            id: '3LMsdvAX3v',
          });
    case 'nothingLeftInSight':
      return translateMessage({
        defaultMessage: 'Nothing was changed, because a sheet needs at least one visible row and column.',
        id: '8BsnYZH/Qn',
      });
    case 'sheetNameTaken':
    case 'sheetNameNotAllowed':
    case 'fault':
      return translateMessage({
        defaultMessage: 'That change couldn’t be made. Try again, and if it keeps happening reload the page.',
        id: 'T0ltcvGcrI',
      });
  }
}
export function editsDroppedText(why: WhyEditsDropped): string {
  switch (why) {
    case 'tooManyFilledCells':
      return translateMessage({
        defaultMessage:
          'This Sheet is full, so some of your changes were undone. To make room, clear cells you don’t need. Deleting rows, columns, or sheets doesn’t make room.',
        id: 'mDoPpUWWND',
      });
    case 'tooManyDistinctFormulas':
      return translateMessage({
        defaultMessage:
          'This Sheet has too many different formulas, so some of your changes were undone. To make room, clear formulas you don’t need.',
        id: 'OfBSLHesG+',
      });
    case 'tooManyRows':
      return translateMessage({
        defaultMessage:
          'One of the sheets here can’t hold any more rows, so some of your changes were undone. Deleted rows still count, so continue in a new sheet.',
        id: 'Ty5WFE6f4b',
      });
    case 'tooManyColumns':
      return translateMessage({
        defaultMessage:
          'One of the sheets here can’t hold any more columns, so some of your changes were undone. Deleted columns still count, so continue in a new sheet.',
        id: 'ii+kG/W+an',
      });
    case 'tooManySheets':
      return translateMessage({
        defaultMessage:
          'This Sheet can’t hold any more sheets, so some of your changes were undone. Deleted sheets still count, so continue in a new Sheet.',
        id: 'TfqIvYfNFv',
      });
    case 'tooManyMergedCells':
      return translateMessage({
        defaultMessage:
          'This Sheet can’t hold any more merged cells, so some of your changes were undone. To make room, unmerge cells that don’t need to be merged.',
        id: '4YJn5OJ3bx',
      });
    case 'tooManyGroups':
      return translateMessage({
        defaultMessage:
          'This Sheet can’t hold any more groups, so some of your changes were undone. To make room, ungroup rows or columns that don’t need to be grouped.',
        id: 'WeqNC9lPW6',
      });
    case 'tooManyDropdowns':
      return translateMessage({
        defaultMessage:
          'This Sheet can’t hold any more dropdowns, so some of your changes were undone. To make room, remove dropdowns you don’t need.',
        id: 'inwYOE5WWO',
      });
    case 'tooManyConditionalFormats':
      return translateMessage({
        defaultMessage:
          'This Sheet can’t hold any more conditional formatting rules, so some of your changes were undone. To make room, remove rules you don’t need.',
        id: 'ojTuMUMFue',
      });
    case 'noRoomInWorkbook':
      return translateMessage({
        defaultMessage: 'This Sheet doesn’t have room for some of your changes, so they were undone. To keep working, continue in a new Sheet.',
        id: 'MBmckzX2tx',
      });
    case 'noMoreEditsTaken':
      return translateMessage({
        defaultMessage: 'This Sheet can’t take any more changes, so some of yours were undone. To keep working, copy your data into a new Sheet.',
        id: '/MHVMUia+A',
      });
    case 'readOnly':
      return translateMessage({
        defaultMessage: 'You can no longer edit this Sheet, so some of your changes were undone. Ask an owner for edit access.',
        id: 'AcuydwD8Vm',
      });
    case 'tooLargeForOneEdit':
      return translateMessage({
        defaultMessage:
          'One of your changes was too large to save at once, so it was undone. Check the Sheet for what’s missing, then make that change in smaller parts.',
        id: 'mPy/5QGBKo',
      });
    case 'tookTooLong':
      return translateMessage({
        defaultMessage:
          'One of your changes took too long to save, so it was undone. Check the Sheet for what’s missing, then try again, or make that change in smaller parts.',
        id: '+gHC6Bv3tJ',
      });
    case 'editingPaused':
      return translateMessage({
        defaultMessage: 'Editing was paused for this Sheet, so your unsaved changes were undone.',
        id: 'Xqq8Hk0XSM',
      });
    case 'notTakenForNow':
      return translateMessage({
        defaultMessage: 'Some of your changes can’t be saved right now, so they were undone. Try again later.',
        id: '98mqV04mK0',
      });
    case undefined:
      return translateMessage({
        defaultMessage: 'Some of your changes couldn’t be saved, so they were undone. Check the Sheet for what’s missing.',
        id: 'z7wmhbiZdJ',
      });
  }
}
export function copyFailedText(keyKind: KeyInstead): string {
  switch (keyKind) {
    case 'command':
      return translateMessage({
        defaultMessage: 'That couldn’t be copied. Press ⌘C instead.',
        id: '70Ds4kyFud',
      });
    case 'control':
      return translateMessage({
        defaultMessage: 'That couldn’t be copied. Press Ctrl+C instead.',
        id: 'NlQUiyszKX',
      });
    case null:
      return translateMessage({
        defaultMessage: 'That couldn’t be copied. Try again.',
        id: 'S7gUa1t4eT',
      });
  }
}
export function cutFailedText(keyKind: KeyInstead): string {
  switch (keyKind) {
    case 'command':
      return translateMessage({
        defaultMessage: 'That couldn’t be cut. Press ⌘X instead.',
        id: 'EXjuC6xbOR',
      });
    case 'control':
      return translateMessage({
        defaultMessage: 'That couldn’t be cut. Press Ctrl+X instead.',
        id: 'p6lvzkD3dn',
      });
    case null:
      return translateMessage({
        defaultMessage: 'That couldn’t be cut. Try again.',
        id: 'P/xZ08ESyR',
      });
  }
}
export function pasteFromMenuHint(keyKind: KeyInstead): string {
  switch (keyKind) {
    case 'command':
      return translateMessage({
        defaultMessage: 'Press ⌘V to paste. This menu can only paste right after you copy or cut here.',
        id: 'qRcNY2OsYn',
      });
    case 'control':
      return translateMessage({
        defaultMessage: 'Press Ctrl+V to paste. This menu can only paste right after you copy or cut here.',
        id: 'T3Wc21SJZw',
      });
    case null:
      return translateMessage({
        defaultMessage: 'This menu can only paste right after you copy or cut here.',
        id: '7IkJjJnPAf',
      });
  }
}
export function pasteValuesFromMenuHint(copied: string | null, keyKind: KeyInstead): string {
  if (copied === 'copiedCells')
    return translateMessage({
      defaultMessage: 'The copied cells’ values can’t be pasted on their own. Use Paste instead.',
      id: 'Iag9Gjf18r',
    });
  if (copied === 'cutCells')
    return translateMessage({
      defaultMessage: 'To paste values only, copy the cells instead of cutting them.',
      id: 'VJbZ15fDVz',
    });
  switch (keyKind) {
    case 'command':
      return translateMessage({
        defaultMessage: 'Press ⇧⌘V or ⌥⇧⌘V to paste values only. This menu can only paste values right after you copy here.',
        id: 'z9hcelJZYz',
      });
    case 'control':
      return translateMessage({
        defaultMessage: 'Press Ctrl+Shift+V to paste values only. This menu can only paste values right after you copy here.',
        id: 'pHKHW9a+/+',
      });
    case null:
      return translateMessage({
        defaultMessage: 'This menu can only paste values right after you copy here.',
        id: 'voS3Nsnutn',
      });
  }
}
export function importRefusedText(why: WhyFileNotImported): string {
  switch (why) {
    case 'tooLarge':
      return importFileTooLargeText();
    case 'notRead':
      return translateMessage({
        defaultMessage: 'That file couldn’t be read. Try importing it again.',
        id: 'WlyXIfnAp9',
      });
    case 'folder':
      return translateMessage({
        defaultMessage: 'Nothing was imported, because that’s a folder. Choose a .csv or .tsv file.',
        id: 'TbDZuIPZ1s',
      });
    case 'notText':
      return translateMessage({
        defaultMessage: 'Nothing was imported, because that file isn’t a CSV file. Save it as a CSV file, then import it.',
        id: 'dzaUnlkG4b',
      });
    case 'excelFileDropped':
      return translateMessage({
        defaultMessage: 'Excel files can’t be dropped here. Choose the file instead.',
        id: 'raEm81yLRM',
      });
    case 'empty':
      return translateMessage({
        defaultMessage: 'Nothing was imported, because that file is empty.',
        id: 'nmNpUV/PFu',
      });
  }
}
export function oneRangeNeededText(act: OneRangeAct): string {
  switch (act) {
    case 'cut':
      return translateMessage({
        defaultMessage: 'Select just one group of cells to cut.',
        id: 'oGCvi1s5qU',
      });
    case 'fill':
      return translateMessage({
        defaultMessage: 'Couldn’t fill. Select just one group of cells, then try again.',
        id: 'eaGfQdxILe',
      });
    case 'mergeCells':
      return translateMessage({
        defaultMessage: 'Select just one group to merge.',
        id: 'vWotAUi07W',
      });
    case 'unmergeCells':
      return translateMessage({
        defaultMessage: 'Select just one group of cells to unmerge.',
        id: '1X4u0H2fgQ',
      });
    case 'insertRows':
      return translateMessage({
        defaultMessage: 'Select just one group of cells to insert rows.',
        id: '1tkG2aoiqS',
      });
    case 'insertColumns':
      return translateMessage({
        defaultMessage: 'Select just one group of cells to insert columns.',
        id: 'nH1gC3ohfN',
      });
    case 'moveRows':
      return translateMessage({
        defaultMessage: 'Select just one group of cells to move rows.',
        id: 'E3MOR6y/0Y',
      });
    case 'moveColumns':
      return translateMessage({
        defaultMessage: 'Select just one group of cells to move columns.',
        id: 'k9xw8LFVJe',
      });
    case 'deleteRows':
      return translateMessage({
        defaultMessage: 'Select just one group of cells to delete rows.',
        id: 'U/b0JIobKR',
      });
    case 'deleteColumns':
      return translateMessage({
        defaultMessage: 'Select just one group of cells to delete columns.',
        id: 'mWVqdv9Es8',
      });
    case 'sortCells':
      return translateMessage({
        defaultMessage: 'Select just one group of cells to sort.',
        id: 'n876ezcv15',
      });
    case 'dropdown':
      return translateMessage({
        defaultMessage: 'Select just one group of cells to add a dropdown.',
        id: 'lQbbVE7v8g',
      });
    case 'askAgent':
      return translateMessage({
        defaultMessage: 'Select just one group of cells to ask Agent about them.',
        id: 'xaBhQUXRcg',
      });
  }
}
export function noticeText(notice: NoticeTold): string | undefined {
  switch (notice.kind) {
    case 'alreadySorted':
      return translateMessage(
        {
          defaultMessage: 'Already sorted by column {column}.',
          id: 'ykVGOB+Kdc',
        },
        {
          column: notice.column,
        },
      );
    case 'matchesNotReplaced':
      return matchesNotReplacedText(notice.count);
    case 'fixesCameToNothing':
      return translateMessage({
        defaultMessage: 'Agent couldn’t fix the formulas with errors',
        id: 'fbxqqCP1m4',
      });
    case 'callsForFixesFailed':
      return fixFailureText(notice.why);
    case 'fixesGoneWithChange':
      return translateMessage({
        defaultMessage: 'Agent’s fixes were removed because the Sheet changed',
        id: 'rnUYmIEB44',
      });
    case 'textsNotConverted':
      return translateMessage(
        {
          defaultMessage:
            '{count, plural, one {Couldn’t convert that cell, so it’s still text.} other {Couldn’t convert those cells, so they’re still text.}}',
          id: 'QLdjpjF1nO',
        },
        {
          count: notice.count,
        },
      );
    case 'noTableToFilter':
    case 'filteredTableIsGone':
    case 'ownFilterNotWorkedOut':
      return filterNoticeText(notice);
    case 'ownSortIsOver':
    case 'ownSortInTheWay':
      return ownSortNoticeText(notice);
    case 'versionNotTakenBack':
      return versionNotRestoredText(notice);
    case 'turnOfAgentNotUndone':
      return agentUndoRefusalText(notice);
    case 'versionNotShown':
      return versionNotShownText(notice);
    case 'oneRangeNeeded':
      return oneRangeNeededText(notice.act);
    case 'rowsOutOfViewInTheWay':
      return filterHidesRowsRefusal(notice.act);
    case 'linkHeldByCommentMode':
      return translateMessage({
        defaultMessage: 'Links don’t open while commenting is on. Turn commenting off, then try again.',
        id: 'SfKM/14KGG',
      });
    case 'editRefused':
      return editRefusedText(notice.why, notice.asked, notice.mergedCells);
    case 'cellHoldsNoMorePeople':
      return translateMessage(
        {
          defaultMessage:
            '{count, plural, one {Nobody was added, because a cell can hold up to # person. Remove someone first.} other {Nobody was added, because a cell can hold up to # people. Remove someone first.}}',
          id: 'tI2ngpp1AV',
        },
        {
          count: notice.most,
        },
      );
    case 'tooManyNamedViews':
      return namedViewLimitRefusalLabel(notice.most);
    case 'groupsTooDeep':
      return translateMessage(
        {
          defaultMessage:
            '{most, plural, one {Nothing was changed, because that would put more than # group inside each other. Ungroup some first.} other {Nothing was changed, because that would put more than # groups inside each other. Ungroup some first.}}',
          id: 'erBXBEXGVI',
        },
        {
          most: notice.most,
        },
      );
    case 'sheetNameRefused':
      return sheetNameRefusedText(notice.refused);
    case 'dropdownCellsRefused':
      return dropdownCellsRefusalText(notice.refused);
    case 'changedSinceEdit':
      return notice.direction === 'undo'
        ? translateMessage({
            defaultMessage:
              'That change can’t be undone anymore, because the same cells have changed since. The next undo goes to the change before it.',
            id: 'A1u//FnH2N',
          })
        : translateMessage({
            defaultMessage:
              'That change can’t be redone anymore, because the same cells have changed since. The next redo goes to the change after it.',
            id: 'xxYjGh3Puc',
          });
    case 'formatsTooMixedSinceEdit':
      return notice.direction === 'undo'
        ? translateMessage({
            defaultMessage:
              'That change can’t be undone anymore, because those cells now have too much mixed formatting to undo at once. The next undo goes to the change before it.',
            id: 'pemNDgboMM',
          })
        : translateMessage({
            defaultMessage:
              'That change can’t be redone anymore, because those cells now have too much mixed formatting to redo at once. The next redo goes to the change after it.',
            id: '7EdoCMHeP+',
          });
    case 'nothingElseLeftSinceEdit':
      return notice.direction === 'undo'
        ? translateMessage(
            {
              defaultMessage:
                '{lastOf, select, sheet {That change can’t be undone anymore, because every other sheet has been deleted since. The next undo goes to the change before it.} row {That change can’t be undone anymore, because every other row has been deleted since. The next undo goes to the change before it.} other {That change can’t be undone anymore, because every other column has been deleted since. The next undo goes to the change before it.}}',
              id: '/vhC2L9HPA',
            },
            {
              lastOf: notice.lastOf,
            },
          )
        : translateMessage(
            {
              defaultMessage:
                '{lastOf, select, sheet {That change can’t be redone anymore, because every other sheet has been deleted since. The next redo goes to the change after it.} row {That change can’t be redone anymore, because every other row has been deleted since. The next redo goes to the change after it.} other {That change can’t be redone anymore, because every other column has been deleted since. The next redo goes to the change after it.}}',
              id: 'LayfH8QALi',
            },
            {
              lastOf: notice.lastOf,
            },
          );
    case 'sheetNameTakenSinceEdit': {
      let sheetName = truncateGraphemes(notice.name, SHEET_NAME_IN_NOTICE_MAX_CHARACTERS);
      return notice.direction === 'undo'
        ? translateMessage(
            {
              defaultMessage:
                'That change can’t be undone anymore, because another sheet has been named “{name}” since. The next undo goes to the change before it.',
              id: 'AFMeJMEQLF',
            },
            {
              name: sheetName,
            },
          )
        : translateMessage(
            {
              defaultMessage:
                'That change can’t be redone anymore, because another sheet has been named “{name}” since. The next redo goes to the change after it.',
              id: '5FVJqQLG56',
            },
            {
              name: sheetName,
            },
          );
    }
    case 'sheetNotBroughtBack':
      return notice.direction === 'undo'
        ? translateMessage({
            defaultMessage:
              'The sheet you deleted can’t be brought back anymore, because its name has been given to another sheet since. The next undo goes to the change before it.',
            id: '8rRd+/3/xv',
          })
        : translateMessage({
            defaultMessage:
              'The sheet you added can’t be brought back anymore, because its name has been given to another sheet since. The next redo goes to the change after it.',
            id: 'q1Pllk5mUF',
          });
    case 'stepGivenUp':
      return notice.direction === 'undo'
        ? translateMessage({
            defaultMessage: 'That change can’t be undone anymore. The next undo goes to the change before it.',
            id: 'owaFooy/1r',
          })
        : translateMessage({
            defaultMessage: 'That change can’t be redone anymore. The next redo goes to the change after it.',
            id: 'CnMhlUCqBr',
          });
    case 'linkNotCopied':
      return notice.why === 'noAnswer'
        ? translateMessage({
            defaultMessage: 'Couldn’t copy the link. Refresh the page, then try again.',
            id: 'S9D5RiubvX',
          })
        : translateMessage({
            defaultMessage: 'Couldn’t copy the link. Try again in a moment.',
            id: 'RSI46n6twV',
          });
    case 'fileNotImported':
      return importRefusedText(notice.why);
    case 'editsDropped':
      if (notice.isPartKept)
        return translateMessage({
          defaultMessage:
            'One of your changes was only partly saved, and the rest of it was undone. Check what was kept, then delete anything you don’t want.',
          id: 'IE8dPufiCj',
        });
      return editsDroppedText(notice.why);
    case 'undoStepsLeftInEarlierPage':
      return translateMessage({
        defaultMessage: 'Changes made before this page last loaded can’t be undone.',
        id: '0dlIaVkUB6',
      });
    case 'mergeWouldClearCells':
      return translateMessage({
        defaultMessage:
          'These cells weren’t merged, because merging would clear more content than an undo could bring back. Merge fewer cells, or clear or move some content first.',
        id: 'gReOl+QeoS',
      });
    case 'cellsNotCopied':
      if (notice.keyInstead === 'sameInAMoment')
        return translateMessage({
          defaultMessage: 'Formulas are still calculating. Try again in a moment.',
          id: 'lgs2kcrdmk',
        });
      return notice.asked === 'cut' ? cutFailedText(notice.keyInstead) : copyFailedText(notice.keyInstead);
    case 'chartNotCut':
      return translateMessage({
        defaultMessage: 'Charts can’t be cut yet. You can copy a chart and delete the original.',
        id: 'F8MPM8U4pO',
      });
    case 'chartsBeingCopied':
      return notice.copiedFor === 'pasteOfChart'
        ? translateMessage({
            defaultMessage: 'Pasting chart…',
            id: 'NyCfvcIj5k',
          })
        : translateMessage({
            defaultMessage: 'Copying charts…',
            id: 'IkQmlVIDOy',
          });
    case 'chartsLeftBehindByDuplicate':
      return translateMessage({
        defaultMessage: 'The sheet was duplicated without its charts, because one of them can’t be copied.',
        id: 'jdd/cP4HHd',
      });
    case 'entryDroppedByMerge':
      return translateMessage({
        defaultMessage: 'Someone merged the cell you were typing in with other cells, so what you typed wasn’t kept.',
        id: 'mZqujJLpu6',
      });
    case 'entryDroppedByRemoval':
      return translateMessage({
        defaultMessage: 'The cell you were typing in was removed, so what you typed wasn’t kept.',
        id: '6eItABXwSX',
      });
    case 'entriesNotKept':
      return translateMessage(
        {
          defaultMessage: 'What you typed in {cells} wasn’t kept.',
          id: '8B2IBDIG4b',
        },
        {
          cells: new Intl.ListFormat(MESSAGE_LOCALE, {
            type: 'unit',
          }).format(notice.cells),
        },
      );
    case 'entryNotForCheckbox':
      return translateMessage({
        defaultMessage: 'A checkbox can only be TRUE or FALSE, so what you typed wasn’t kept. To type something else, clear the cell first.',
        id: '8df6C++ZP0',
      });
  }
}
export function cellsInSightText([firstRow, lastRow]: readonly [string, string], [firstColumn, lastColumn]: readonly [string, string]): string {
  if (firstRow === lastRow && firstColumn === lastColumn)
    return translateMessage(
      {
        defaultMessage: 'Row {firstRow}, column {firstColumn}',
        id: 'Sc1kqnNpcY',
      },
      {
        firstRow,
        firstColumn,
      },
    );
  if (firstRow === lastRow)
    return translateMessage(
      {
        defaultMessage: 'Row {firstRow}, columns {firstColumn} to {lastColumn}',
        id: '/r7tXixVPX',
      },
      {
        firstRow,
        firstColumn,
        lastColumn,
      },
    );
  if (firstColumn === lastColumn)
    return translateMessage(
      {
        defaultMessage: 'Rows {firstRow} to {lastRow}, column {firstColumn}',
        id: 'jDaYKhmDJC',
      },
      {
        firstRow,
        lastRow,
        firstColumn,
      },
    );
  return translateMessage(
    {
      defaultMessage: 'Rows {firstRow} to {lastRow}, columns {firstColumn} to {lastColumn}',
      id: 'WHDsQWT4PB',
    },
    {
      firstRow,
      lastRow,
      firstColumn,
      lastColumn,
    },
  );
}
export const editingBackOnText = (): string =>
  translateMessage({
    defaultMessage: 'Editing is back on.',
    id: 'HHN9l7liBu',
  });
export const reconnectedText = (): string =>
  translateMessage({
    defaultMessage: 'Reconnected.',
    id: 'e0hKkfEt7e',
  });
export const allChangesSavedText = (): string =>
  translateMessage({
    defaultMessage: 'All changes saved',
    id: 'LTJBQYLROX',
  });
export const agentMissedMessageText = (): string =>
  translateMessage({
    defaultMessage:
      'Agent didn’t get that because the message box wasn’t selected. Click the message box and try again, or press Esc to go back to the cells.',
    id: 'Dl+OZNW/Px',
  });
export const savingChangesText = (): string =>
  translateMessage({
    defaultMessage: 'Saving changes…',
    id: 'rvYL1YoBbZ',
  });
export const calculatingFormulasText = (): string =>
  translateMessage({
    defaultMessage: 'Calculating formulas…',
    id: 'amyQnprk3p',
  });
export const formulasCalculatedText = (): string =>
  translateMessage({
    defaultMessage: 'All formulas calculated',
    id: '3OXrYjq0cQ',
  });
export const pasteTooLargeText = (): string =>
  translateMessage({
    defaultMessage: 'Nothing was pasted, because that’s too much to paste at once. Copy and paste fewer cells at a time.',
    id: 'vRXfEGiNFK',
  });
export const moveTooLargeText = (): string =>
  translateMessage({
    defaultMessage: 'Nothing was moved, because that’s too much to move at once. Move fewer cells at a time.',
    id: 'cG0q48J9XT',
  });
export const changeTooLargeText = (): string =>
  translateMessage({
    defaultMessage: 'That change is too large to make at once. Make it in smaller parts.',
    id: 'Qk1dg5o4JH',
  });
export const optionRemovalTooLargeText = (): string =>
  translateMessage({
    defaultMessage:
      'That change wasn’t made, because an option you removed is in too many cells to remove at once. Clear or change some of those cells first.',
    id: 'zTDVklsi6e',
  });
export const moveChangesTooManyFormulasText = (): string =>
  translateMessage({
    defaultMessage: 'Nothing was moved, because that would change too many formulas at once.',
    id: 'z713Ojmi5U',
  });
export const sortTooLargeText = (): string =>
  translateMessage({
    defaultMessage: 'Nothing was sorted, because this sheet has too many rows or formulas to sort at once.',
    id: 'crzzRwb588',
  });
export const sortRangeTooLargeText = (): string =>
  translateMessage({
    defaultMessage: 'Nothing was sorted, because that would move too many cells at once. Select fewer cells, or sort the whole sheet.',
    id: 'yL/JIdwYdd',
  });
export const importFileTooLargeText = (): string =>
  translateMessage({
    defaultMessage: 'Nothing was imported, because that file is too large. Import a smaller file.',
    id: 'Xp8HIRoBLK',
  });
export const importNoRoomText = (): string =>
  translateMessage({
    defaultMessage: 'Nothing was imported, because this Sheet doesn’t have room for that much data. Import a smaller file.',
    id: 'qryIljCQxH',
  });
export const importTooManySheetsText = (): string =>
  translateMessage({
    defaultMessage:
      'Nothing was imported, because this Sheet can’t hold any more sheets. Deleted sheets still count, so import the file into a new Sheet.',
    id: '/YUE+TSsh0',
  });
export const noRoomInWorkbookText = (): string =>
  translateMessage({
    defaultMessage: 'That change wasn’t made, because this Sheet doesn’t have room for that much data.',
    id: 'mXRTmLRGqS',
  });
export const duplicateTooLargeText = (): string =>
  translateMessage({
    defaultMessage: 'Nothing was duplicated, because that sheet is too large.',
    id: 'i2voKQxUR6',
  });
export const duplicateTooManySheetsText = (): string =>
  translateMessage({
    defaultMessage: 'Nothing was duplicated, because this Sheet can’t hold any more sheets. Deleted sheets still count, so continue in a new Sheet.',
    id: 'Ti8oLizamk',
  });
export const duplicateMergedCellsText = (): string =>
  translateMessage({
    defaultMessage: 'Nothing was duplicated, because some merged cells in that sheet overlap or cover other data. Unmerge those cells first.',
    id: 'zOf/w/vtXi',
  });
export const isMoveOfColumnsOfTable = (act: AskedKindOfEdit): boolean =>
  act === 'moveOfColumnsOfTable' || act === 'moveOfColumnsOfTablePastOne';
export const formatTooMixedText = (): string =>
  translateMessage({
    defaultMessage:
      'That change wasn’t made, because the selected cells have too much mixed formatting to update at once. Select fewer cells, then format the rest.',
    id: '1oJkmXRCQn',
  });
export const undoableDoneText = (done: string): string =>
  translateMessage(
    {
      defaultMessage: '{done}. You can undo this.',
      id: 'g+64YWsVKT',
    },
    {
      done: done.replace(/\.$/, ''),
    },
  );
export const matchesNotReplacedText = (count: number): string =>
  translateMessage(
    {
      defaultMessage:
        '{count, plural, one {# match wasn’t replaced. Some cells, like formula results, dropdowns, or checkboxes, can’t be changed this way.} other {# matches weren’t replaced. Some cells, like formula results, dropdowns, or checkboxes, can’t be changed this way.}}',
      id: '2gWUhe9NsA',
    },
    {
      count,
    },
  );
