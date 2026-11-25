import type { CopiedWidgetNode, Edit } from '@open-artifact/sheets-core';
import type { PageEffect } from '../state/transitions.ts';
export function copiedChartNodesOfEdit(edit: Edit): readonly CopiedWidgetNode[] {
  if (edit.kind === 'copyPlacedView') return edit.copiedWidgetNodes;
  return edit.kind === 'duplicateSheet' && edit.placedViews?.kind === 'copied' ? edit.placedViews.copiedWidgetNodes : [];
}
export const discardCopiedChartNodes = (edit: Edit): PageEffect[] => {
  const copies = copiedChartNodesOfEdit(edit);
  return copies.length === 0
    ? []
    : [
        {
          kind: 'discardChartNodes',
          copies,
        },
      ];
};
