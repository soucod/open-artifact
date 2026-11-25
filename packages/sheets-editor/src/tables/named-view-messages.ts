import { translateMessage } from '../i18n/messages.ts';
import type { NamedViewDeletedOffer, NamedViewDone } from './named-view-actions.ts';
import type { AskedKindOfEdit } from '../state/edit-answers.ts';
/** Why an edit of a named view was refused, as the page tells it. */
export type NamedViewRefusalWhy = 'namedViewNameTaken' | 'namedViewTooLarge' | 'namedViewIsGone';
/** The words of the toast that offers to undo the delete of a named view. */
export interface NamedViewDeletedLabels {
  title: string;
  undoLabel: string;
}
export function namedViewDoneLabel({ what, name }: NamedViewDone): string {
  switch (what) {
    case 'namedViewPicked':
      return translateMessage(
        {
          defaultMessage: 'Showing {name}',
          id: 'OdGIetrzy8',
        },
        {
          name,
        },
      );
    case 'namedViewSaved':
      return translateMessage(
        {
          defaultMessage: 'Saved “{name}”',
          id: 'H8KafFH0I0',
        },
        {
          name,
        },
      );
    case 'namedViewUpdated':
      return translateMessage(
        {
          defaultMessage: 'Updated “{name}”',
          id: 'OXGvENhE+r',
        },
        {
          name,
        },
      );
    case 'namedViewRenamed':
      return translateMessage(
        {
          defaultMessage: 'Renamed to “{name}”',
          id: 'kTAlIV3QD2',
        },
        {
          name,
        },
      );
  }
}
export function namedViewDeletedLabels({ name, isSaved }: Pick<NamedViewDeletedOffer, 'name' | 'isSaved'>): NamedViewDeletedLabels {
  return {
    title: isSaved
      ? translateMessage(
          {
            defaultMessage: 'Deleted “{name}”',
            id: 'WMZtfEUk9C',
          },
          {
            name,
          },
        )
      : translateMessage(
          {
            defaultMessage: 'Deleting “{name}”…',
            id: 'EjaLSkTgdW',
          },
          {
            name,
          },
        ),
    undoLabel: translateMessage({
      defaultMessage: 'Undo delete',
      id: 'cxzOwFyflc',
    }),
  };
}
export function namedViewRefusalLabel(why: NamedViewRefusalWhy, asked: AskedKindOfEdit): string {
  if (why === 'namedViewNameTaken') return namedViewMessages.nameTaken();
  if (why === 'namedViewTooLarge')
    return asked === 'updateOfNamedView'
      ? translateMessage({
          defaultMessage:
            'That view wasn’t updated, because its filter has too many conditions or values. Remove some, then try again.',
          id: 'iBFWqpQdbp',
        })
      : translateMessage({
          defaultMessage:
            'That view wasn’t saved, because its filter has too many conditions or values. Remove some, then try again.',
          id: 'XdKi5+/vhI',
        });
  return asked === 'renameOfNamedView'
    ? translateMessage({
        defaultMessage: 'That view wasn’t renamed, because it was deleted.',
        id: 'OGpzqKbyFd',
      })
    : translateMessage({
        defaultMessage:
          'That view wasn’t updated, because it was deleted. You can save your sort and filter as a new view.',
        id: 'kRbn3tH34M',
      });
}
export const namedViewMessages = {
  views: () =>
    translateMessage({
      defaultMessage: 'Views',
      id: 'mA3peD5hwj',
    }),
  editedAfterName: () =>
    translateMessage({
      defaultMessage: '(edited)',
      id: '4B01nrOw4p',
    }),
  edited: (name: string) =>
    translateMessage(
      {
        defaultMessage: '{name} (edited)',
        id: 'HwlMb9Kxlm',
      },
      {
        name,
      },
    ),
  button: (name: string) =>
    translateMessage(
      {
        defaultMessage: 'Views: {name}',
        id: 'XZ53GV6zGI',
      },
      {
        name,
      },
    ),
  savedViews: () =>
    translateMessage({
      defaultMessage: 'Saved views',
      id: 'sjdNiFleK7',
    }),
  saveAsNew: () =>
    translateMessage({
      defaultMessage: 'Save as new view',
      id: 'MYYEH2r3AC',
    }),
  update: (name: string) =>
    translateMessage(
      {
        defaultMessage: 'Update “{name}”',
        id: 'C0Fsq88sFr',
      },
      {
        name,
      },
    ),
  rename: () =>
    translateMessage({
      defaultMessage: 'Rename view',
      id: 'uw+ljeC4Zj',
    }),
  delete: () =>
    translateMessage({
      defaultMessage: 'Delete view',
      id: '1ec6My+6wj',
    }),
  name: () =>
    translateMessage({
      defaultMessage: 'View name',
      id: 'ngcBXnp99E',
    }),
  forEveryone: () =>
    translateMessage({
      defaultMessage:
        'Everyone with this Sheet can pick it. Picking it changes only what they see.',
      id: 'c3rZBJIa36',
    }),
  nameTaken: () =>
    translateMessage({
      defaultMessage:
        'Another view already has this name. Enter a different name.',
      id: 'LAV1sxcFwK',
    }),
};
export const namedViewLimitRefusalLabel = (most: number): string =>
  translateMessage(
    {
      defaultMessage:
        '{most, plural, one {That view wasn’t saved, because this table already has # view. Delete it, then try again.} other {That view wasn’t saved, because this table already has # views. Delete one, then try again.}}',
      id: 'HxLA1OQCOa',
    },
    {
      most,
    },
  );
export const namedViewLimitWhyOff = (most: number): string =>
  translateMessage(
    {
      defaultMessage:
        '{most, plural, one {This table already has # view. Delete it to save a new one.} other {This table already has # views. Delete one to save a new one.}}',
      id: '2eNW07a7dY',
    },
    {
      most,
    },
  );
export const namedViewSortLeftOutLabel = (isFilterOn: boolean): string =>
  isFilterOn
    ? translateMessage({
        defaultMessage:
          'This view’s filter is on, but not its sort, because some of this table’s rows are blank, frozen, grouped, or filled by one formula, or have merged cells.',
        id: 'u+GMid7Xc+',
      })
    : translateMessage({
        defaultMessage:
          'This view’s sort isn’t on, because some of this table’s rows are blank, frozen, grouped, or filled by one formula, or have merged cells.',
        id: 'dMbcU3vqk3',
      });
