import { plainLooks, FONT_MARKS, fontMarksWhere, doLooksFitText } from './text-looks.ts';
import { listFromValue } from '../ui/cell-list-attributes.ts';
import type { EntryLooks } from '../state/initial-state.ts';
import type { EntryOfPageBeforeFound } from '../state/event-reducer.ts';
import type { SheetController } from '../state/controller.ts';
import type { StorageOf, StoredCaretPlace } from '../state/caret-memory.ts';
/** An entry kept in the tab's storage while the page was left, to open again once it is back. */
export type KeptEntry = EntryOfPageBeforeFound['entry'];
/** A kept entry as taken back, marked when it was kept while its edits were not yet saved. */
export type TakenKeptEntry = KeptEntry & { isUnsaved?: true };
/** What the page tells of the caret leaving it and coming back, and of its edits being saved. */
export interface PageOfKeptEntry {
  hasCaret(): boolean;
  onLeftPage(listener: () => void): () => void;
  onCameBackToPage(listener: () => void): () => void;
  wallNowMs(): number;
  hasUnsavedEdits(): boolean;
  onSavingChanged(listener: () => void): () => void;
}
export function parseKeptEntryLooks(savedLooks: unknown, text: string): EntryLooks | undefined {
  if (!isEntryRecord(savedLooks)) return;
  let { stretches: savedStretches, lists: savedLists } = Array.isArray(savedLooks)
    ? {
        stretches: savedLooks,
        lists: plainLooks(text, []).lists,
      }
    : savedLooks;
  if (!Array.isArray(savedStretches) || !Array.isArray(savedLists)) return;
  let stretches = savedStretches.flatMap((look: unknown) => {
    if (!isEntryRecord(look)) return [];
    let { length, marks, link } = look;
    if (typeof length !== 'number' || !Number.isInteger(length) || length < 1) return [];
    if (!Array.isArray(marks) || (link !== null && typeof link !== 'string')) return [];
    if (marks.some((mark: unknown) => !FONT_MARKS.some((knownMark) => knownMark === mark))) return [];
    return [
      {
        length,
        marks: fontMarksWhere((mark) => marks.includes(mark)),
        link,
      },
    ];
  });
  let lists = savedLists.flatMap((list: unknown) => listFromValue(list) ?? []);
  let looks: EntryLooks = {
    stretches,
    lists,
  };
  return stretches.length === savedStretches.length && doLooksFitText(looks, text) ? looks : undefined;
}
export function parseKeptEntry(saved: unknown): KeptEntry | null {
  if (!isEntryRecord(saved) || !isEntryRecord(saved.cellId) || !isEntryRecord(saved.mode)) return null;
  let { sheetId, rowId, columnId } = saved.cellId;
  let { text, textAtStart, typingIn, arrowsActOn, looks, ...restOfMode } = saved.mode;
  let {
    kind,
    isTypedOverCell,
    mayHoldTextOfOthers,
    isBegunToListFunctions,
    holdsOneLine,
    areSignsLeftAsTyped,
  } = restOfMode;
  let { isExpanded } = restOfMode;
  if (typeof sheetId !== 'string' || typeof rowId !== 'string' || typeof columnId !== 'string') return null;
  if (kind !== 'editing' || typeof text !== 'string' || typeof textAtStart !== 'string') return null;
  if (typingIn !== 'cell' && typingIn !== 'formulaBar') return null;
  if (arrowsActOn !== undefined && arrowsActOn !== 'cells' && arrowsActOn !== 'text') return null;
  if (
    !isTrueOrMissing(isTypedOverCell) ||
    !isTrueOrMissing(mayHoldTextOfOthers) ||
    !isTrueOrMissing(isBegunToListFunctions) ||
    !isTrueOrMissing(holdsOneLine) ||
    !isTrueOrMissing(isExpanded) ||
    !isTrueOrMissing(areSignsLeftAsTyped)
  )
    return null;
  let parsedLooks = parseKeptEntryLooks(looks, text);
  return {
    cellId: {
      sheetId,
      rowId,
      columnId,
    },
    mode: {
      kind,
      text,
      textAtStart,
      typingIn,
      ...(parsedLooks !== undefined && {
        looks: parsedLooks,
      }),
      ...(arrowsActOn !== undefined && {
        arrowsActOn,
      }),
      ...(isTypedOverCell && {
        isTypedOverCell,
      }),
      ...(mayHoldTextOfOthers && {
        mayHoldTextOfOthers,
      }),
      ...(isBegunToListFunctions && {
        isBegunToListFunctions,
      }),
      ...(holdsOneLine && {
        holdsOneLine,
      }),
      ...(isExpanded && {
        isExpanded,
      }),
      ...(areSignsLeftAsTyped && {
        areSignsLeftAsTyped,
      }),
    },
  };
}
export function takeKeptEntry(getStorage: StorageOf, wallNowMs: number, keepWhenUndated: boolean): TakenKeptEntry | null {
  try {
    let storage = getStorage();
    let savedText = storage.getItem(KEPT_ENTRY_STORAGE_KEY);
    storage.removeItem(KEPT_ENTRY_STORAGE_KEY);
    if (savedText === null) return null;
    let saved: unknown = JSON.parse(savedText);
    let leftAtWallMs = isEntryRecord(saved) ? saved.leftAtWallMs : undefined;
    let isUnsaved = isEntryRecord(saved) && saved.isUnsaved === true;
    let entry = (
      typeof leftAtWallMs === 'number'
        ? leftAtWallMs + (isUnsaved ? KEPT_UNSAVED_ENTRY_MAX_AGE_MS : KEPT_ENTRY_MAX_AGE_MS) >= wallNowMs
        : keepWhenUndated
    )
      ? parseKeptEntry(saved)
      : null;
    return entry !== null && isUnsaved
      ? {
          ...entry,
          isUnsaved,
        }
      : entry;
  } catch {
    return null;
  }
}
export function bringBackKeptEntry(
  store: Pick<SheetController, 'dispatch'>,
  wayIn: StoredCaretPlace | null,
  keptEntry: KeptEntry | null,
): void {
  if (wayIn === 'inEntry' && keptEntry !== null)
    store.dispatch({
      kind: 'entryOfPageBeforeFound',
      entry: keptEntry,
    });
}
export function forgetKeptEntry(getStorage: StorageOf): void {
  try {
    getStorage().removeItem(KEPT_ENTRY_STORAGE_KEY);
  } catch {}
}
export function keepEntryWhilePageIsLeft(
  getStorage: StorageOf,
  store: Pick<SheetController, 'entryToKeep' | 'subscribe'>,
  after: (run: () => void) => void,
  page: PageOfKeptEntry,
): () => void {
  let lastWritten: string | null | undefined;
  let hasLeftPage = false;
  let leftAtWallMs = 0;
  let saving: 'notSeen' | 'unsaved' | 'saved' = 'notSeen';
  let hasLeftAtMs = false;
  let isForgetPending = false;
  let isStopped = false;
  let forget = () => forgetKeptEntry(getStorage);
  let writeEntry = (entryJson: string, leftAtWallMs?: number, isUnsaved: boolean = false) => {
    hasLeftAtMs = leftAtWallMs !== undefined;
    try {
      let leftAtPart = leftAtWallMs === undefined ? '' : `,"leftAtWallMs":${leftAtWallMs},"isUnsaved":${isUnsaved}`;
      getStorage().setItem(KEPT_ENTRY_STORAGE_KEY, `${entryJson.slice(0, -1)}${leftAtPart}}`);
    } catch {
      forget();
    }
  };
  let writeLeftEntry = () => {
    if (typeof lastWritten !== 'string') return;
    let isUnsavedNow = store.entryToKeep() === null && page.hasUnsavedEdits();
    if (saving === 'notSeen' && isUnsavedNow) saving = 'unsaved';
    if (saving === 'unsaved' && !isUnsavedNow) saving = 'saved';
    writeEntry(lastWritten, leftAtWallMs, saving === 'unsaved');
  };
  let keepEntryNow = (mustWrite: boolean = false) => {
    if (hasLeftPage && !page.hasCaret()) return writeLeftEntry();
    hasLeftPage = false;
    let entry = store.entryToKeep();
    if (entry !== null) {
      let entryJson = JSON.stringify(entry);
      if (mustWrite || hasLeftAtMs || entryJson !== lastWritten) writeEntry(entryJson);
      lastWritten = entryJson;
      return;
    }
    if (lastWritten === null || isForgetPending) return;
    isForgetPending = true;
    after(() => {
      isForgetPending = false;
      if (isStopped || store.entryToKeep() !== null || !page.hasCaret()) return;
      lastWritten = null;
      forget();
    });
  };
  let unsubscribers = [
    store.subscribe(() => keepEntryNow()),
    page.onLeftPage(() => {
      hasLeftPage = true;
      leftAtWallMs = page.wallNowMs();
      saving = 'notSeen';
      writeLeftEntry();
    }),
    page.onSavingChanged(() => keepEntryNow()),
    page.onCameBackToPage(() => keepEntryNow(true)),
  ];
  keepEntryNow();
  return () => {
    isStopped = true;
    for (let unsubscribe of unsubscribers) unsubscribe();
  };
}
export const KEPT_ENTRY_STORAGE_KEY = 'sheets-entry';
export const isEntryRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;
export const isTrueOrMissing = (value: unknown): value is true | undefined => value === true || value === undefined;
export const KEPT_ENTRY_MAX_AGE_MS = 1000;
export const KEPT_UNSAVED_ENTRY_MAX_AGE_MS = 15000;
