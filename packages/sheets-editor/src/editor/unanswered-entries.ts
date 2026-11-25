import type { CellContents, Edit, Entry, Paragraph } from '@open-artifact/sheets-core';
import { TEXT_PREFIX_QUOTE } from '../model/cell-text.ts';
import { isSameCell } from '../selection/model.ts';
import type { CellId, WorkbookReads } from '../model/workbook.ts';
import type { EnterEdit } from '../model/edit-effects.ts';
import type { EntryUnanswered, PageState } from '../state/initial-state.ts';
import type { PageContext } from '../state/event-reducer.ts';
/** An entry not yet answered, with the cell it makes when it starts a list after the `'` that keeps it a text. */
export interface EntryUnansweredWithList extends EntryUnanswered {
  cellWithList?: CellContents;
}
export function markEditByPage<E extends Edit>(edit: E): E {
  return (EDITS_BY_PAGE.add(edit), edit);
}
export function plainTextOfEntry(entry: Entry): string {
  if (entry.kind === 'text') return entry.text;
  if (entry.kind !== 'textWithLooks') return '';
  return entry.paragraphs.map(({ runs }) => runs.map(({ text }) => text).join('')).join(`
`);
}
export function cellWithListOfEntry({ cell, entry }: EnterEdit, reads: WorkbookReads): CellContents | null {
  if (entry.kind !== 'textWithLooks') return null;
  let lists = entry.paragraphs.map(({ list }) => list);
  let text = plainTextOfEntry(entry);
  if (!text.startsWith(TEXT_PREFIX_QUOTE) || lists.every(({ kind }) => kind === 'none')) return null;
  let isAtStart = true;
  // The page writes the link of every run it enters (editor/text-looks.ts, richTextFromLooks).
  let paragraphs = entry.paragraphs.map(
    ({ list, runs }) => ({
      list,
      runs: runs.flatMap((run) => {
        let runText = isAtStart && run.text !== '' ? run.text.slice(TEXT_PREFIX_QUOTE.length) : run.text;
        return (
          (isAtStart &&= run.text === ''),
          runText === ''
            ? []
            : {
                ...run,
                text: runText,
              }
        );
      }),
    }),
  ) as Paragraph[];
  return {
    ...cell,
    input: {
      kind: 'richText',
      paragraphs,
    },
    value: {
      kind: 'text',
      value: text.slice(TEXT_PREFIX_QUOTE.length),
    },
    numbersOfListLines: (reads.listLinesAsKept(lists) ?? []).map(({ number }) => number),
  };
}
export function readsWithUnansweredEntries<Reads extends WorkbookReads>(
  reads: Reads,
  { entriesUnanswered }: { entriesUnanswered: readonly EntryUnansweredWithList[] },
): Reads {
  if (entriesUnanswered.length === 0) return reads;
  let cellOf = (cell: CellId): CellContents | null => {
    let unanswered = entriesUnanswered.findLast((entry) => isSameCell(entry.cellId, cell));
    if (unanswered === undefined) return reads.cellOf(cell);
    let { text: unansweredText, cellWithList } = unanswered;
    let { rowId, columnId } = cell;
    return (
      cellWithList ??
      (unansweredText === ''
        ? null
        : {
            r: rowId,
            c: columnId,
            input: {
              kind: 'text',
              value: unansweredText,
            },
          })
    );
  };
  return {
    ...reads,
    cellOf,
    cellOnShowIn: (cell) => cellOf(cell) ?? reads.spilledCellOf(cell),
    columnIndexesOnShowIn(sheetId, rowIndex) {
      let unansweredColumnIndexes = entriesUnanswered.flatMap(({ cellId }) => {
        let position = cellId.sheetId === sheetId ? reads.positionOfCell(cellId) : null;
        return position?.rowIndex === rowIndex ? [position.columnIndex] : [];
      });
      let columnIndexes = reads.columnIndexesOnShowIn(sheetId, rowIndex);
      if (unansweredColumnIndexes.length === 0) return columnIndexes;
      let allColumnIndexes = [...new Set([...columnIndexes, ...unansweredColumnIndexes])];
      allColumnIndexes.sort((index, otherIndex) => index - otherIndex);
      return allColumnIndexes;
    },
  };
}
export const EDITS_BY_PAGE = new WeakSet<Edit>();
export const isEditByPage = (edit: Edit): boolean =>
  (edit.kind === 'declareCellTable' && edit.isAskedFor !== true) || EDITS_BY_PAGE.has(edit);
export const unansweredEntryOf = (entering: EnterEdit): EntryUnanswered => ({
  cellId: {
    sheetId: entering.sheetId,
    rowId: entering.cell.r,
    columnId: entering.cell.c,
  },
  text: plainTextOfEntry(entering.entry),
});
export const textOfUnansweredEntryAt = ({ entriesUnanswered }: Pick<PageState, 'entriesUnanswered'>, cell: CellId): string | null =>
  entriesUnanswered.findLast((unanswered) => isSameCell(unanswered.cellId, cell))?.text ?? null;
export const isEntryWorkPending = (
  { entriesUnanswered }: Pick<PageState, 'entriesUnanswered'>,
  { areFormulasLeft }: Pick<PageContext, 'areFormulasLeft'>,
): boolean => areFormulasLeft || entriesUnanswered.length > 0;
