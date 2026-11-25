import type { Edit, QueueEditAnswer } from '@open-artifact/sheets-core';
import type { CauseOfErrorRead, CauseOfErrorSaid, CellId } from '../model/workbook.ts';

/** What a reading of why a cell shows its error gives: what was said, or that it is still to come or never will. */
export type CauseOfErrorToRead = CauseOfErrorSaid | 'yetToCome' | 'neverToCome';

/** An edit as it is queued: the edit itself, the edits made before it and those that go along with it. */
export interface EditsQueued {
  edit: Edit;
  editsBefore?: readonly { edit: Edit }[];
  editsThatGoAlong?: readonly Edit[];
}

export function rememberLatestCausesOfError(readCause: (cell: CellId, cellNow: string) => CauseOfErrorToRead) {
  let latestByCell = new Map<string, { cellNow: string; said: CauseOfErrorSaid }>();
  return (cell: CellId, cellNow: string): CauseOfErrorRead | null => {
    let cellKey = `${cell.sheetId}/${cell.rowId}/${cell.columnId}`;
    let said = readCause(cell, cellNow);
    if (said !== 'yetToCome' && said !== 'neverToCome') {
      latestByCell.delete(cellKey);
      latestByCell.set(cellKey, {
        cellNow,
        said,
      });
      for (let oldKey of [...latestByCell.keys()].slice(0, -29)) latestByCell.delete(oldKey);
      return {
        said,
        isLatest: true,
      };
    }
    let remembered = latestByCell.get(cellKey);
    let saidBefore = remembered?.cellNow === cellNow ? remembered.said : null;
    if (said === 'neverToCome')
      return {
        said: saidBefore ?? NO_CAUSE_OF_ERROR,
        isLatest: true,
      };
    return saidBefore === null
      ? null
      : {
          said: saidBefore,
          isLatest: false,
        };
  };
}
export function editsMadeOfQueued(queued: EditsQueued, answer: QueueEditAnswer): Edit[] {
  if (answer.kind !== 'editQueued') return [];
  let { editsThatGoAlong = [] } = queued;
  let editsMadeAlong = editsThatGoAlong.filter(
    (_edit, index) => answer.editsThatWentAlong?.[index]?.kind === 'made',
  );
  return editsOfQueued({
    ...queued,
    editsThatGoAlong: editsMadeAlong,
  });
}
export const NO_CAUSE_OF_ERROR: CauseOfErrorSaid = {
  cause: null,
  passedOnFrom: null,
};
export const editsOfQueued = ({ editsBefore = [], edit, editsThatGoAlong = [] }: EditsQueued): Edit[] => [
  ...editsBefore.map((before) => before.edit),
  edit,
  ...editsThatGoAlong,
];
export const editAnsweredFor = (
  { edit, editsBefore = [] }: EditsQueued,
  { indexOfEditBefore }: { indexOfEditBefore?: number },
): Edit => (indexOfEditBefore === undefined ? undefined : editsBefore[indexOfEditBefore]?.edit) ?? edit;
