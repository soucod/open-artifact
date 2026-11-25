import type { TableNotFormatted } from '../state/initial-state.ts';
/** Where the tables kept unformatted are stored. */
export type StorageOfTablesNotFormatted = () => Pick<Storage, 'getItem' | 'setItem'>;
export function readTablesNotFormatted(storage: StorageOfTablesNotFormatted = tablesNotFormattedStorage): TableNotFormatted[] | null {
  try {
    let stored: unknown = JSON.parse(storage().getItem('sheets-tables-not-formatted') ?? '[]');
    return Array.isArray(stored) ? stored.filter(isStoredTableCell).slice(-200) : null;
  } catch {
    return null;
  }
}
export function writeTablesNotFormatted(tables: readonly TableNotFormatted[], storage: StorageOfTablesNotFormatted = tablesNotFormattedStorage): boolean {
  try {
    storage().setItem('sheets-tables-not-formatted', JSON.stringify(tables.slice(-200)));
    return true;
  } catch {
    return false;
  }
}
export const tablesNotFormattedStorage = (): Storage => localStorage;
export const isStoredTableCell = (stored: unknown): stored is TableNotFormatted =>
  typeof stored === 'object' &&
  stored !== null &&
  'sheetId' in stored &&
  'rowId' in stored &&
  'columnId' in stored &&
  [stored.sheetId, stored.rowId, stored.columnId].every((part) => typeof part === 'string');
