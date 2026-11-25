import { translateMessage } from '../i18n/messages.ts';

/** The kind of edit that rows hidden by a filter stopped. */
export type ActStoppedByHiddenRows = 'mergeCells' | 'cut' | 'fill' | 'dropdown' | 'moveCells' | 'moveRows' | 'paste' | 'otherEdit';

export function filterHidesRowsRefusal(askedEdit: ActStoppedByHiddenRows): string {
  switch (askedEdit) {
    case 'mergeCells':
      return translateMessage({
        defaultMessage: 'These cells weren’t merged, because your filter hides rows between them. Clear the filter first.',
        id: '9hAc0NfFVh',
      });
    case 'cut':
      return translateMessage({
        defaultMessage: 'Nothing was cut, because your filter hides rows between these cells. You can copy them, or clear the filter first.',
        id: 'IRF3oNg0rW',
      });
    case 'fill':
      return translateMessage({
        defaultMessage: 'Nothing was filled, because your filter hides rows between these cells. Clear the filter first.',
        id: 'IWwp4JPO33',
      });
    case 'dropdown':
      return translateMessage({
        defaultMessage: 'No dropdown was added, because your filter hides rows between these cells. Clear the filter first.',
        id: 'hn906H4T4k',
      });
    case 'moveCells':
      return translateMessage({
        defaultMessage: 'Nothing was moved, because your filter hides rows in the way. Clear the filter first.',
        id: 'OtxkvyzpTu',
      });
    case 'moveRows':
      return translateMessage({
        defaultMessage: 'Nothing was moved, because rows can’t be moved while your filter hides some. Clear the filter first.',
        id: 'nb56kfxqmZ',
      });
    case 'paste':
      return translateMessage({
        defaultMessage: 'Nothing was pasted, because your filter hides rows where this would land. Clear the filter first.',
        id: 'qbr/PYgRvc',
      });
    case 'otherEdit':
      return translateMessage({
        defaultMessage: 'Nothing was changed, because that would also change rows that your filter hides. Clear the filter first.',
        id: '2AizA+N0cQ',
      });
  }
}
