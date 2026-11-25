import { isCellEntryBlank } from '../grid/entry-hints.ts';
import { cellEditorHint, cellEditorShortHint } from '../i18n/grid-action-labels.ts';
import { entryFontStyle } from '../grid/cell-drawing.tsx';
import { entryGridlineOverlap, cellEntryBoxStyle } from '../grid/grid-drawing.tsx';
import { zoomedEditorMargin } from '../grid/cell-metrics.ts';
import type { GridOfPage, PageView } from '../view/page-view.ts';
export interface CellEntryHintProps {
  grid: GridOfPage;
}
export function formulaBarPlaceholder({
  formulaBarText,
  mode,
  openUnderCell,
  calendar,
  viewOnlyBecause,
}: Pick<PageView, 'formulaBarText' | 'mode' | 'openUnderCell' | 'calendar' | 'viewOnlyBecause'>): string | undefined {
  return formulaBarText === '' && !isCellEntryBlank(mode) && openUnderCell === null && calendar === null && viewOnlyBecause === null
    ? cellEditorHint()
    : undefined;
}
export function CellEntryHint({
  grid: {
    body,
    editorKeepsClear,
    editorBox,
    editorScale,
    editorFormat,
    entryHintRoom,
  },
}: CellEntryHintProps) {
  if (editorBox === null || entryHintRoom === null) return null;
  let { fontFamily, fontSize, lineHeight } = entryFontStyle(editorFormat.font, false);
  let editorOrigin = entryGridlineOverlap(editorBox, editorScale);
  return <span aria-hidden className="sheet-entry-hint" data-starts-on-line-at-left={editorOrigin.x > 0 || undefined} style={{
      ...cellEntryBoxStyle(editorBox, body, editorFormat, editorKeepsClear, {
        lineCount: 1,
        foldsAt: null,
        scale: editorScale,
      }),
      maxWidth: entryHintRoom + editorOrigin.x + 2 * zoomedEditorMargin(editorScale, 'along'),
      fontFamily,
      fontSize,
      lineHeight,
    }}>{cellEditorShortHint()}</span>;
}
