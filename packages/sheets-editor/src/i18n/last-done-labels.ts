import type {
  LastDone,
  CellsSortedDone,
  DoneWithoutDetail,
  DropdownOptionMovedDone,
  DropdownOptionRemovedDone,
  DropdownOptionsAddedDone,
  FormattedDone,
  ListSetDone,
  NoDateEnteredDone,
  PeopleInCellDone,
  RulesDone,
  SheetShownForDone,
} from '../state/initial-state.ts';
import type { EntryCameToError } from '../state/reasons-for-errors.ts';
import type { ConditionalFormatDone } from '../messages/conditional-format.ts';
import type { ErrorExplanation } from '../messages/formula-errors.ts';
import type { CopiedCellsLetGo } from '../state/copied-cells.ts';
import type { CellFormatChoice } from './change-labels.ts';
import type { DropdownOptionsAdded } from './chip-labels.ts';
import type { ParagraphListKind } from '../messages/import.ts';
import {
  truncateGraphemes,
  PERSON_NAME_IN_NOTICE_MAX_CHARACTERS,
  HEADING_LABEL_MAX_CHARACTERS,
  PLACED_VIEW_NAME_IN_NOTICE_MAX_CHARACTERS,
} from './grid-action-labels.ts';
import { translateMessage } from './messages.ts';
import { conditionalFormatDoneWords } from '../messages/conditional-format.ts';
import {
  insertedRowsOrColumnsText,
  rowHeightSetText,
  columnWidthSetText,
  cellFormatChangeText,
  markInEntryText,
  markToTypeText,
  dropdownOptionDeletedOffer,
  describeUndoOffer,
} from './change-labels.ts';
import { undoableDoneText } from './notice-labels.ts';
import { lineGroupsDoneWords } from '../messages/line-groups.ts';
import { placedViewMovedWords, placedViewChangeUndoneWords } from '../messages/charts.ts';
import { frozeRowsText, frozeColumnsText } from './agent-turn-labels.ts';
import { listKindOnOffWords, checkedStateWords, interactiveDoneText } from '../messages/import.ts';
import { namedViewDoneLabel } from '../tables/named-view-messages.ts';
import { dropdownPresetChosenText, dropdownOptionRemovedText, dropdownOptionsAddedText } from './chip-labels.ts';
import { errorExplanationWords } from '../messages/formula-errors.ts';
import { agentFixLabel } from './formula-fix-labels.ts';
import { timeZoneSetText } from '../ui/locale-time-zone-pick.ts';
import { localeSetWords } from '../messages/locale.ts';
/** A column cells were sorted by after the first one, and which way. */
export type ThenSortedBy = Pick<CellsSortedDone, 'column' | 'direction'>;
/** What the page did last, with the fields some kinds carry that `LastDone` does not list yet. */
export type LastDoneTold =
  | Exclude<
      LastDone,
      | DropdownOptionMovedDone
      | DropdownOptionRemovedDone
      | DropdownOptionsAddedDone
      | CellsSortedDone
      | SheetShownForDone
      | NoDateEnteredDone
      | FormattedDone
      | ListSetDone
      | DoneWithoutDetail
      | RulesDone
      | EntryCameToError
    >
  | (DropdownOptionMovedDone & { onlyIn: string | null })
  | (CellsSortedDone & { thenBy?: ThenSortedBy[] })
  | (SheetShownForDone & { isFormulaOfAgentDiscarded?: undefined })
  | NoDateEnteredTold
  | (Omit<FormattedDone, 'format'> & { format: CellFormatChoice })
  | (Omit<ListSetDone, 'list'> & { list: ParagraphListKind })
  | (DropdownOptionRemovedDone & { onlyIn: string | null })
  | (Omit<DropdownOptionsAddedDone, 'onlyIn'> & DropdownOptionsAdded)
  | (Omit<DoneWithoutDetail, 'what'> & { what: Exclude<DoneWithoutDetail['what'], ConditionalFormatDone['what']> })
  | ConditionalFormatDone
  | (Omit<EntryCameToError, 'reason'> & { reason: ErrorExplanation });
/** No date entered in a cell, because the cell holds a dropdown or a checkbox. */
export type NoDateEnteredTold = NoDateEnteredDone & { cellHas: 'dropdown' | 'checkbox' };
/** The words of an undo offer: its title, and what more it says. */
interface UndoOfferWords {
  title: string;
  description?: string;
}
export function personChipChangeText(change: PeopleInCellDone): string {
  let { cell } = change;
  let name = truncateGraphemes(change.name, PERSON_NAME_IN_NOTICE_MAX_CHARACTERS);
  switch (change.what) {
    case 'personAdded':
      return translateMessage(
        {
          defaultMessage:
            '{count, plural, one {Added {name} to {cell}. # person in this cell.} other {Added {name} to {cell}. # people in this cell.}}',
          id: 'u82WAUR36Z',
        },
        {
          name,
          cell,
          count: change.heldNowCount,
        },
      );
    case 'personRemoved':
      if (!change.isSaved)
        return translateMessage(
          {
            defaultMessage: 'Removing {name} from {cell}…',
            id: 'X8MEq8JduN',
          },
          {
            name,
            cell,
          },
        );
      return translateMessage(
        {
          defaultMessage:
            '{count, plural, =0 {Removed {name} from {cell}. The cell is empty.} one {Removed {name} from {cell}. # person in this cell.} other {Removed {name} from {cell}. # people in this cell.}}',
          id: 'p7ET49QrOv',
        },
        {
          name,
          cell,
          count: change.heldNowCount,
        },
      );
    case 'peopleReplaced':
      if (!change.isSaved)
        return translateMessage(
          {
            defaultMessage: '{count, plural, one {Replacing # person in {cell} with {name}…} other {Replacing # people in {cell} with {name}…}}',
            id: '2SpmCVPYPb',
          },
          {
            name,
            cell,
            count: change.replacedCount,
          },
        );
      return translateMessage(
        {
          defaultMessage: '{count, plural, one {Replaced # person in {cell} with {name}.} other {Replaced # people in {cell} with {name}.}}',
          id: 'J42J6BKciU',
        },
        {
          name,
          cell,
          count: change.replacedCount,
        },
      );
    case 'contentsReplaced':
      if (!change.isSaved)
        return translateMessage(
          {
            defaultMessage: 'Replacing the contents of {cell} with {name}…',
            id: 'PcFiCTKwza',
          },
          {
            name,
            cell,
          },
        );
      return translateMessage(
        {
          defaultMessage: 'Replaced the contents of {cell} with {name}.',
          id: 'ElX8/uDthp',
        },
        {
          name,
          cell,
        },
      );
  }
}
export function noDateEnteredText({ cellHas, cell }: NoDateEnteredTold): string {
  switch (cellHas) {
    case 'dropdown':
      return translateMessage(
        {
          defaultMessage: 'No date entered. {cell} has a dropdown.',
          id: 'k00eIS5B7m',
        },
        {
          cell,
        },
      );
    case 'checkbox':
      return translateMessage(
        {
          defaultMessage: 'No date entered. {cell} is a checkbox.',
          id: 'SbKWWl8YKW',
        },
        {
          cell,
        },
      );
  }
}
export function copiedCellsLetGoText({ leaves, cells }: CopiedCellsLetGo): string {
  switch (leaves) {
    case 'stillCopied':
      return translateMessage(
        {
          defaultMessage: '{cells} still copied',
          id: 'Bo2KPL+Q78',
        },
        {
          cells,
        },
      );
    case 'cutCanceledAndPasteCopies':
      return translateMessage(
        {
          defaultMessage: 'Cut canceled. Pasting now copies {cells}.',
          id: 'SMH8q+Invh',
        },
        {
          cells,
        },
      );
    case 'cutCanceled':
      return translateMessage({
        defaultMessage: 'Cut canceled',
        id: 'JGaYTzl9xH',
      });
  }
}
export function describeLastDone(givenDone: LastDoneTold): string {
  let lastDone =
    'rangeCount' in givenDone
      ? {
          ...givenDone,
          cells: cellGroupCountText(givenDone.rangeCount!),
        }
      : givenDone;
  switch (lastDone.what) {
    case 'rulesAdded':
    case 'ruleChanged':
    case 'movedToNumbers':
    case 'scaleColorsNothing':
    case 'ruleRemoved':
    case 'ruleMoved':
    case 'offerDiscarded':
    case 'agentStopped':
      return conditionalFormatDoneWords(lastDone);
    case 'namedViewPicked':
    case 'namedViewSaved':
    case 'namedViewUpdated':
    case 'namedViewRenamed':
      return namedViewDoneLabel(lastDone);
    case 'moreOfCellShown':
      return translateMessage(
        {
          defaultMessage: 'Showing more of {cell}',
          id: 'QXgPfST37E',
        },
        {
          cell: lastDone.cell,
        },
      );
    case 'takenOutOfSelection':
      return translateMessage(
        {
          defaultMessage: '{cells} no longer selected',
          id: 'u3P+mXSYSQ',
        },
        {
          cells: lastDone.cells,
        },
      );
    case 'cut':
      return translateMessage(
        {
          defaultMessage: 'Cut {cells}. Paste to move it.',
          id: 'QhVJ03d3Bz',
        },
        {
          cells: lastDone.cells,
        },
      );
    case 'copied':
      return translateMessage(
        {
          defaultMessage: 'Copied {cells}',
          id: 'JWlFVxXp5s',
        },
        {
          cells: lastDone.cells,
        },
      );
    case 'copiedWithoutRowsOutOfView':
      return translateMessage(
        {
          defaultMessage: 'Copied {cells}, without the hidden rows',
          id: '0ZNxPoFARU',
        },
        {
          cells: lastDone.cells,
        },
      );
    case 'pasted':
      return translateMessage(
        {
          defaultMessage: 'Pasted into {cells}',
          id: 'N9xEhOIbxB',
        },
        {
          cells: lastDone.cells,
        },
      );
    case 'filled':
      return translateMessage(
        {
          defaultMessage: 'Filled {cells}',
          id: 'wIwQSyl1n3',
        },
        {
          cells: lastDone.cells,
        },
      );
    case 'cleared':
    case 'entryEmptiedCell':
      return translateMessage(
        {
          defaultMessage: 'Cleared {cells}',
          id: '3EeJo7NqXS',
        },
        {
          cells: lastDone.cells,
        },
      );
    case 'rowsInserted':
    case 'columnsInserted':
      return insertedRowsOrColumnsText(lastDone);
    case 'moved':
      return translateMessage(
        {
          defaultMessage: 'Moved to {cells}',
          id: 'xyKOIP5izN',
        },
        {
          cells: lastDone.cells,
        },
      );
    case 'columnsOfTableMoved':
      if (lastDone.count > 1)
        return translateMessage(
          {
            defaultMessage: 'Moved {count} columns to columns {first} to {last}',
            id: 'Rw0Zd5KlOV',
          },
          {
            count: lastDone.count,
            first: lastDone.first,
            last: lastDone.last,
          },
        );
      return lastDone.heading === null
        ? translateMessage(
            {
              defaultMessage: 'Moved to column {column}',
              id: '8CDgN2yTPk',
            },
            {
              column: lastDone.first,
            },
          )
        : translateMessage(
            {
              defaultMessage: 'Moved {heading} to column {column}',
              id: 'GrJgZaD+o1',
            },
            {
              heading: truncateGraphemes(lastDone.heading, HEADING_LABEL_MAX_CHARACTERS),
              column: lastDone.first,
            },
          );
    case 'movedOverCells':
      return undoableDoneText(
        translateMessage(
          {
            defaultMessage: '{count, plural, one {Moved to {cells}. # cell was replaced} other {Moved to {cells}. # cells were replaced}}',
            id: 'byB/v8qrLG',
          },
          {
            cells: lastDone.cells,
            count: lastDone.count,
          },
        ),
      );
    case 'merged':
      return translateMessage(
        {
          defaultMessage: 'Merged {cells}',
          id: 'VV+6CE94u0',
        },
        {
          cells: lastDone.cells,
        },
      );
    case 'grouped':
    case 'ungrouped':
    case 'collapsed':
    case 'expanded':
    case 'groupsCollapsed':
    case 'groupsExpanded':
    case 'shownToLevel':
      return lineGroupsDoneWords(lastDone);
    case 'placedViewMoved':
    case 'placedViewSized':
      return placedViewMovedWords({
        ...lastDone,
        name: truncateGraphemes(lastDone.name, PLACED_VIEW_NAME_IN_NOTICE_MAX_CHARACTERS),
      });
    case 'placedViewChangeUndone':
    case 'placedViewChangeRedone':
      return placedViewChangeUndoneWords({
        ...lastDone,
        name: truncateGraphemes(lastDone.name, PLACED_VIEW_NAME_IN_NOTICE_MAX_CHARACTERS),
      });
    case 'rowsFrozen':
      return frozeRowsText(lastDone.count);
    case 'columnsFrozen':
      return frozeColumnsText(lastDone.count);
    case 'gridlinesHidden':
      return translateMessage({
        defaultMessage: 'Gridlines hidden',
        id: 'SXoIKNCft9',
      });
    case 'gridlinesShown':
      return translateMessage({
        defaultMessage: 'Gridlines shown',
        id: 'UCIp2J/wf7',
      });
    case 'interactiveReset':
    case 'interactiveDefaultsSaved':
      return interactiveDoneText(lastDone);
    case 'pivotTableAdded':
      return translateMessage({
        defaultMessage: 'Pivot table added on a new sheet',
        id: 'baJVVjPb+v',
      });
    case 'pivotTableUpdated':
      return translateMessage({
        defaultMessage: 'Pivot table updated',
        id: 'yYrrCd8+Ok',
      });
    case 'rowsSized':
      return rowHeightSetText(lastDone);
    case 'columnsSized':
      return columnWidthSetText(lastDone);
    case 'formulaAdded':
      return translateMessage(
        {
          defaultMessage: 'Added a formula in {cells}',
          id: 'SsoGYumzSw',
        },
        {
          cells: lastDone.cells,
        },
      );
    case 'unmerged':
      return translateMessage(
        {
          defaultMessage: 'Unmerged {cells}',
          id: 'Nxd1ZaqREn',
        },
        {
          cells: lastDone.cells,
        },
      );
    case 'formatted':
      return cellFormatChangeText(lastDone.format, lastDone.cells);
    case 'markSetInEntry':
      return markInEntryText(lastDone.mark, lastDone.isOn);
    case 'markSetToTypeIn':
      return markToTypeText(lastDone.mark, lastDone.isOn);
    case 'listSetInEntry':
      return listKindOnOffWords(lastDone.list, lastDone.isOn);
    case 'boxOfLineSet':
      return checkedStateWords(lastDone.isChecked);
    case 'dropdownSet':
    case 'dropdownCellsSet':
      return translateMessage(
        {
          defaultMessage: 'Dropdown for {cells}',
          id: 'VMxZT5T9WG',
        },
        {
          cells: lastDone.cells,
        },
      );
    case 'checkboxesMade':
      return translateMessage(
        {
          defaultMessage: 'Checkbox for {cells}',
          id: 'IW4lXamcKX',
        },
        {
          cells: lastDone.cells,
        },
      );
    case 'checked':
      return translateMessage(
        {
          defaultMessage: 'Checked {cells}',
          id: 'zwbgWT7sjZ',
        },
        {
          cells: lastDone.cells,
        },
      );
    case 'unchecked':
      return translateMessage(
        {
          defaultMessage: 'Unchecked {cells}',
          id: 'x2SqpIXfGH',
        },
        {
          cells: lastDone.cells,
        },
      );
    case 'dropdownStartedFrom':
      return dropdownPresetChosenText(lastDone.set, lastDone.optionCount);
    case 'headerRowSet':
      return lastDone.isOn
        ? translateMessage(
            {
              defaultMessage: 'Header “{heading}” left out. Dropdown for {cells}.',
              id: 'iyEPvrW58j',
            },
            {
              heading: lastDone.heading,
              cells: lastDone.cells,
            },
          )
        : translateMessage(
            {
              defaultMessage: 'Header “{heading}” included. Dropdown for {cells}.',
              id: 'zeLA2KGsFp',
            },
            {
              heading: lastDone.heading,
              cells: lastDone.cells,
            },
          );
    case 'offeredWordsEntered':
      return translateMessage(
        {
          defaultMessage: 'Entered “{words}”',
          id: 'C2Aq2ppcC1',
        },
        {
          words: lastDone.words,
        },
      );
    case 'undoOfferMade': {
      let { title, description }: UndoOfferWords =
        lastDone.offer.kind === 'dropdownOptionDeleted' ? dropdownOptionDeletedOffer(lastDone.offer, 1 / 0) : describeUndoOffer(lastDone.offer);
      if (lastDone.offer.kind === 'sortChangedResults' && description !== undefined) return description;
      if (lastDone.headerRow !== undefined) {
        let headerRowText = describeLastDone(lastDone.headerRow);
        return description === undefined ? headerRowText : `${headerRowText} ${description}`;
      }
      let isTitleAlone =
        lastDone.offer.kind === 'dropdownOptionDeleted' ? lastDone.offer.isSaved : lastDone.offer.kind === 'sheetDeleted' && !lastDone.offer.isSaved;
      return description === undefined || isTitleAlone
        ? title
        : `${title}${title.endsWith('…') ? '' : '.'} ${description}`;
    }
    case 'dropdownOptionsSet':
      return translateMessage(
        {
          defaultMessage: 'Dropdown options changed for {cells}',
          id: 'xG0zpN5/5Y',
        },
        {
          cells: lastDone.cells,
        },
      );
    case 'dropdownOptionMoved':
      return lastDone.onlyIn === null
        ? translateMessage(
            {
              defaultMessage: '{label} moved to {place, number} of {optionCount, number}',
              id: 'vLv8yIm390',
            },
            {
              label: lastDone.label,
              place: lastDone.place,
              optionCount: lastDone.optionCount,
            },
          )
        : translateMessage(
            {
              defaultMessage: '{label} moved to {place, number} of {optionCount, number} for {cells}',
              id: 'SiBofhWk76',
            },
            {
              label: lastDone.label,
              place: lastDone.place,
              optionCount: lastDone.optionCount,
              cells: lastDone.onlyIn,
            },
          );
    case 'personAdded':
    case 'personRemoved':
    case 'peopleReplaced':
    case 'contentsReplaced':
      return personChipChangeText(lastDone);
    case 'dropdownOptionRemoved':
      return dropdownOptionRemovedText(lastDone);
    case 'dropdownOptionsAdded':
      return dropdownOptionsAddedText(lastDone);
    case 'bordersDrawn':
      return translateMessage(
        {
          defaultMessage:
            '{edges, select, all {All borders for {cells}} inner {Inner borders for {cells}} innerHorizontal {Inner horizontal borders for {cells}} innerVertical {Inner vertical borders for {cells}} outer {Outer borders for {cells}} left {Left border for {cells}} top {Top border for {cells}} right {Right border for {cells}} other {Bottom border for {cells}}}',
          id: 'FGcg9J0Y3T',
        },
        {
          edges: lastDone.edges,
          cells: lastDone.cells,
        },
      );
    case 'replaced':
      return translateMessage(
        {
          defaultMessage: 'Replaced in {cell}',
          id: 'zo/a+Ji3cG',
        },
        {
          cell: lastDone.cells,
        },
      );
    case 'bordersCleared':
      return translateMessage(
        {
          defaultMessage: 'No borders for {cells}',
          id: 'AB+hE78Yxv',
        },
        {
          cells: lastDone.cells,
        },
      );
    case 'dropdownRemoved':
      return translateMessage(
        {
          defaultMessage: 'No dropdown for {cells}',
          id: '/4yYtKnTxr',
        },
        {
          cells: lastDone.cells,
        },
      );
    case 'formattingCleared':
      return translateMessage(
        {
          defaultMessage: 'Default formatting for {cells}',
          id: '9gLj+JGsMQ',
        },
        {
          cells: lastDone.cells,
        },
      );
    case 'todayEntered':
      return translateMessage(
        {
          defaultMessage: 'Today’s date entered in {cell}',
          id: '3iJbhHO7QU',
        },
        {
          cell: lastDone.cells,
        },
      );
    case 'typedTextEntered':
      return translateMessage(
        {
          defaultMessage: 'Entered in {cell}',
          id: 'iBu8n3m/Nv',
        },
        {
          cell: lastDone.cells,
        },
      );
    case 'typedTextChangedNothing':
      return translateMessage(
        {
          defaultMessage: 'No change in {cell}',
          id: '+/i1UaVlwY',
        },
        {
          cell: lastDone.cells,
        },
      );
    case 'formulaOfAgentEntered':
      return translateMessage(
        {
          defaultMessage: 'Formula kept in {cell}',
          id: 'YKKgllKJ9F',
        },
        {
          cell: lastDone.cells,
        },
      );
    case 'entryCameToError':
      return translateMessage(
        {
          defaultMessage: 'Error in {cell}. {explanation}',
          id: 'PeYjKmN7qX',
        },
        {
          cell: lastDone.cell,
          explanation: errorExplanationWords(lastDone.reason, true),
        },
      );
    case 'undone':
      return lastDone.cells === null
        ? translateMessage({
            defaultMessage: 'Undone',
            id: 'jB6Tpq/Thh',
          })
        : translateMessage(
            {
              defaultMessage: 'Undone in {cells}',
              id: 'X6H2OQ+5Kz',
            },
            {
              cells: lastDone.cells,
            },
          );
    case 'redone':
      return lastDone.cells === null
        ? translateMessage({
            defaultMessage: 'Redone',
            id: 'rf+qBCxuhU',
          })
        : translateMessage(
            {
              defaultMessage: 'Redone in {cells}',
              id: 'DaTQzU1gwr',
            },
            {
              cells: lastDone.cells,
            },
          );
    case 'cellsSorted':
      if (lastDone.thenBy !== undefined) {
        let { thenBy, ...firstSort } = lastDone;
        return thenBy.reduce(appendThenSortedBy, describeLastDone(firstSort));
      }
      return lastDone.direction === 'ascending'
        ? translateMessage(
            {
              defaultMessage: 'Sorted {cells} by column {column}, ascending',
              id: 'Wd5U05u0k6',
            },
            {
              cells: lastDone.cells,
              column: lastDone.column,
            },
          )
        : translateMessage(
            {
              defaultMessage: 'Sorted {cells} by column {column}, descending',
              id: '2RMu8u1sX0',
            },
            {
              cells: lastDone.cells,
              column: lastDone.column,
            },
          );
    case 'rowsSorted':
      return lastDone.direction === 'ascending'
        ? translateMessage(
            {
              defaultMessage: 'Sorted by column {column}, ascending',
              id: 'ZBJKW6aJ2o',
            },
            {
              column: lastDone.column,
            },
          )
        : translateMessage(
            {
              defaultMessage: 'Sorted by column {column}, descending',
              id: 'KImAWppQOb',
            },
            {
              column: lastDone.column,
            },
          );
    case 'steppedOutOfCells':
      return translateMessage({
        defaultMessage: 'Press Tab to leave the cells, or Escape again to leave the Sheet',
        id: 'hR7SlFXOyz',
      });
    case 'copiedCellsLetGo':
      return copiedCellsLetGoText(lastDone);
    case 'nothingToUndo':
      return translateMessage({
        defaultMessage: 'Nothing to undo',
        id: 'PtawAkNXEl',
      });
    case 'nothingToRedo':
      return translateMessage({
        defaultMessage: 'Nothing to redo',
        id: '36RLYrPEf1',
      });
    case 'linkAddressShown':
      return lastDone.url;
    case 'linkSetInEntry':
      return translateMessage(
        {
          defaultMessage: '{link, select, added {Link added} changed {Link changed} other {Link removed}}',
          id: 'CJOv8LH2kK',
        },
        {
          link: lastDone.link,
        },
      );
    case 'entryExpanded':
      return translateMessage({
        defaultMessage: 'Cell expanded. Enter starts a new line.',
        id: 'L35nxmTjSf',
      });
    case 'entryCollapsed':
      return translateMessage({
        defaultMessage: 'Cell collapsed',
        id: '6fbavku8tT',
      });
    case 'linkCopied':
      return translateMessage({
        defaultMessage: 'Link copied',
        id: 'zZqS1594oz',
      });
    case 'chartCopied':
      return translateMessage({
        defaultMessage: 'Chart copied',
        id: 'BgonTEkIRF',
      });
    case 'chartPasted':
      return translateMessage({
        defaultMessage: 'Chart pasted',
        id: 'MenkhQRAK/',
      });
    case 'importDiscarded':
      return translateMessage({
        defaultMessage: 'Import discarded',
        id: 'WY/cBbMveY',
      });
    case 'fixKept':
      return translateMessage(
        {
          defaultMessage: 'Fix kept in {cell}',
          id: 'BuWcBDeLiX',
        },
        {
          cell: lastDone.cells,
        },
      );
    case 'fixesKept':
      return translateMessage(
        {
          defaultMessage: '{count, plural, one {Fix kept} other {# fixes kept}}',
          id: 'zSd+EUqJMj',
        },
        {
          count: lastDone.count,
        },
      );
    case 'fixOffered':
      return agentFixLabel(lastDone.formula, lastDone.shown, true);
    case 'fixDiscarded':
      return translateMessage({
        defaultMessage: 'Fix discarded',
        id: 'zxLs/PF657',
      });
    case 'fixesDiscarded':
      return translateMessage(
        {
          defaultMessage: '{count, plural, one {Fix discarded} other {# fixes discarded}}',
          id: '5luhLMJZio',
        },
        {
          count: lastDone.count,
        },
      );
    case 'formulaOfAgentDiscarded':
      return translateMessage({
        defaultMessage: 'Formula discarded',
        id: 'tTrkkX7dk7',
      });
    case 'formulasShown':
      return translateMessage({
        defaultMessage: 'Showing formulas',
        id: 'w2s1OXCX7o',
      });
    case 'resultsShown':
      return translateMessage({
        defaultMessage: 'Showing results',
        id: 'NQSj4hcTym',
      });
    case 'formattedAsTable':
      return translateMessage({
        defaultMessage: 'Formatted as a table',
        id: 'YS+i2iziny',
      });
    case 'notFormattedAsTable':
      return translateMessage({
        defaultMessage: 'No longer formatted as a table',
        id: 'Ed29YLEJnu',
      });
    case 'nothingToFill':
      return translateMessage({
        defaultMessage: 'Nothing to fill',
        id: 'MSSZloQAm2',
      });
    case 'timeZoneSet':
      return timeZoneSetText(lastDone.timeZone);
    case 'localeSet':
      return localeSetWords(lastDone.locale);
    case 'noDateEntered':
      return noDateEnteredText(lastDone);
    case 'sheetRenamed':
      return translateMessage(
        {
          defaultMessage: 'Renamed to “{name}”',
          id: '7pTvo6jl2H',
        },
        {
          name: lastDone.name,
        },
      );
    case 'sheetMoved':
      return translateMessage(
        {
          defaultMessage: '{name} moved to {place, number} of {sheetCount, number}',
          id: 'DbPKZIK8YJ',
        },
        {
          name: lastDone.name,
          place: lastDone.place,
          sheetCount: lastDone.sheetCount,
        },
      );
    case 'ownCellMoved':
      return translateMessage(
        {
          defaultMessage: 'This Sheet changed. You’re now on {cell}.',
          id: 'MTscHjNSPb',
        },
        {
          cell: lastDone.cell,
        },
      );
    case 'ownCellRemoved':
      return translateMessage(
        {
          defaultMessage: 'The cell you were on was removed. You’re now on {cell}.',
          id: 'MivcumEU3J',
        },
        {
          cell: lastDone.cell,
        },
      );
    case 'ownSheetRemoved':
      return translateMessage(
        {
          defaultMessage: 'The sheet you were on was deleted. Showing {name}.',
          id: '+S5RD7R6l6',
        },
        {
          name: lastDone.name,
        },
      );
    case 'sheetShown':
    case 'sheetShownToFollow':
      if (lastDone.isFormulaOfAgentDiscarded === true)
        return translateMessage(
          {
            defaultMessage: 'Formula discarded. Showing {name}',
            id: 'lyHLCmPE47',
          },
          {
            name: lastDone.name,
          },
        );
      return translateMessage(
        {
          defaultMessage: 'Showing {name}',
          id: 'syUc3rHO5I',
        },
        {
          name: lastDone.name,
        },
      );
    case 'sheetShownForFormula':
      return translateMessage(
        {
          defaultMessage: 'Showing {name}, still editing {cell} on {sheet}',
          id: '8uJwZU3p4h',
        },
        {
          name: lastDone.name,
          cell: lastDone.entryCell,
          sheet: lastDone.entrySheet,
        },
      );
    case 'arrowsGivenTo':
      if (lastDone.to === 'cellsElsewhere')
        return translateMessage({
          defaultMessage: 'Arrow keys pick cells after you type a sign like + or a comma',
          id: 'YBvlqLtyIh',
        });
      return lastDone.to === 'cells'
        ? translateMessage({
            defaultMessage: 'Arrow keys pick cells',
            id: 'Tcd78MB8DV',
          })
        : translateMessage({
            defaultMessage: 'Arrow keys move in the formula',
            id: '3ZBdADeCOL',
          });
  }
}
export const cellGroupCountText = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, one {# group of cells} other {# groups of cells}}',
      id: 'V5v/FLzo5Q',
    },
    {
      count,
    },
  );
export const appendThenSortedBy = (said: string, { column, direction }: ThenSortedBy): string =>
  direction === 'ascending'
    ? translateMessage(
        {
          defaultMessage: '{said}, then column {column}, ascending',
          id: 'RkFCj639US',
        },
        {
          said,
          column,
        },
      )
    : translateMessage(
        {
          defaultMessage: '{said}, then column {column}, descending',
          id: 'vbKXyS+rdU',
        },
        {
          said,
          column,
        },
      );
