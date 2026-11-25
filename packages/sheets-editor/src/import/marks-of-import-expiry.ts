import * as React from 'react';
import { IMPORT_MARKS_SHOWN_MS } from './marks-of-import.ts';
import type { SheetController } from '../state/controller.ts';
import type { MarksOfImport } from '../state/initial-state.ts';
export function useMarksOfImportExpiry(store: Pick<SheetController, 'dispatch'>, marksOfImport: MarksOfImport | null) {
  React.useEffect(() => {
    if (marksOfImport === null) return;
    let timer = setTimeout(
      () =>
        store.dispatch({
          kind: 'marksOfImportOver',
        }),
      IMPORT_MARKS_SHOWN_MS,
    );
    return () => clearTimeout(timer);
  }, [store, marksOfImport]);
}
