export type UiLabelValues = Readonly<Record<string, string | number>>;
import { translateMessage } from './messages.ts';
export const calendarLabel = (): string =>
  translateMessage({
    defaultMessage: 'Calendar',
    id: 'Coy6SHGifn',
  });
export const chooseFileLabel = (): string =>
  translateMessage({
    defaultMessage: 'Choose a file',
    id: 'h/ftND9XMI',
  });
export const UI_LABEL_MESSAGES: ReadonlyMap<string, (values: UiLabelValues) => string> = new Map<string, (values: UiLabelValues) => string>([
  [
    'addProperty',
    (): string =>
      translateMessage({
        defaultMessage: 'Add',
        id: '2/2yg+qAwp',
      }),
  ],
  [
    'addToSection',
    ({ name = '' }: UiLabelValues): string =>
      translateMessage(
        {
          defaultMessage: 'Add to {name}',
          id: 'JA2tuLTTqb',
        },
        {
          name,
        },
      ),
  ],
  [
    'avatarGroup',
    ({ count = '', noun = '' }: UiLabelValues): string =>
      translateMessage(
        {
          defaultMessage: '{count} {noun}',
          id: '+okyOR6KuS',
        },
        {
          count,
          noun,
        },
      ),
  ],
  [
    'back',
    (): string =>
      translateMessage({
        defaultMessage: 'Back',
        id: 'cyR7KhiuaU',
      }),
  ],
  ['calendar', calendarLabel],
  [
    'cancel',
    (): string =>
      translateMessage({
        defaultMessage: 'Cancel',
        id: '47FYwba+bI',
      }),
  ],
  [
    'clear',
    (): string =>
      translateMessage({
        defaultMessage: 'Clear',
        id: '/GCoTAAjMN',
      }),
  ],
  [
    'clearSelection',
    (): string =>
      translateMessage({
        defaultMessage: 'Clear selection',
        id: 'EYIw2MRv0g',
      }),
  ],
  [
    'close',
    (): string =>
      translateMessage({
        defaultMessage: 'Close',
        id: 'rbrahOGMC3',
      }),
  ],
  [
    'confirm',
    (): string =>
      translateMessage({
        defaultMessage: 'Confirm',
        id: 'N2IrpMDHDB',
      }),
  ],
  [
    'decreaseNamedValue',
    ({ name = '' }: UiLabelValues): string =>
      translateMessage(
        {
          defaultMessage: 'Decrease {name}',
          id: 'I/MEhBaO2m',
        },
        {
          name,
        },
      ),
  ],
  [
    'decreaseValue',
    (): string =>
      translateMessage({
        defaultMessage: 'Decrease',
        id: 'jLs6b9otPB',
      }),
  ],
  [
    'dismiss',
    (): string =>
      translateMessage({
        defaultMessage: 'Dismiss',
        id: 'TDaF6JVgG6',
      }),
  ],
  [
    'dropFilesHere',
    (): string =>
      translateMessage({
        defaultMessage: 'Drop files here',
        id: '8QkUkTTC9V',
      }),
  ],
  [
    'fileCheckFailed',
    ({ name = '' }: UiLabelValues): string =>
      translateMessage(
        {
          defaultMessage: '“{name}” couldn’t be checked.',
          id: 'HLZSnftI+8',
        },
        {
          name,
        },
      ),
  ],
  [
    'fileInvalidType',
    ({ name = '' }: UiLabelValues): string =>
      translateMessage(
        {
          defaultMessage: '“{name}” isn’t an accepted file type.',
          id: 'w/ykghRGKH',
        },
        {
          name,
        },
      ),
  ],
  [
    'fileTooLarge',
    ({ name = '' }: UiLabelValues): string =>
      translateMessage(
        {
          defaultMessage: '“{name}” is too large.',
          id: '7hMrFu4Dzs',
        },
        {
          name,
        },
      ),
  ],
  [
    'folderEmpty',
    ({ name = '' }: UiLabelValues): string =>
      translateMessage(
        {
          defaultMessage: 'The folder “{name}” is empty.',
          id: '4zZul+szRM',
        },
        {
          name,
        },
      ),
  ],
  [
    'folderReadError',
    ({ name = '' }: UiLabelValues): string =>
      translateMessage(
        {
          defaultMessage: 'There was a problem reading the folder “{name}”.',
          id: 'DC8U3V1Qj9',
        },
        {
          name,
        },
      ),
  ],
  [
    'foldersNotSupported',
    (): string =>
      translateMessage({
        defaultMessage: 'Folders aren’t supported here.',
        id: 'ncX9PX4SOq',
      }),
  ],
  [
    'folderTooLarge',
    ({ name = '' }: UiLabelValues): string =>
      translateMessage(
        {
          defaultMessage: 'The folder “{name}” has too many items.',
          id: 'y0pCoTFiKU',
        },
        {
          name,
        },
      ),
  ],
  [
    'increaseNamedValue',
    ({ name = '' }: UiLabelValues): string =>
      translateMessage(
        {
          defaultMessage: 'Increase {name}',
          id: 'UQHVfk/X7+',
        },
        {
          name,
        },
      ),
  ],
  [
    'increaseValue',
    (): string =>
      translateMessage({
        defaultMessage: 'Increase',
        id: 'H/XqXJZoja',
      }),
  ],
  [
    'interactiveCardDefaultHint',
    (): string =>
      translateMessage({
        defaultMessage: 'A preview card is available',
        id: 'qnwBcfXbFQ',
      }),
  ],
  [
    'interactiveCardHint',
    ({ hint = '' }: UiLabelValues): string =>
      translateMessage(
        {
          defaultMessage: '{hint} — press Tab until focus enters the card, Escape to return.',
          id: 'nsgFXgN/hX',
        },
        {
          hint,
        },
      ),
  ],
  [
    'itemsUnreadable',
    ({ count = '' }: UiLabelValues): string =>
      translateMessage(
        {
          defaultMessage: '{count} items couldn’t be read.',
          id: 'm9BLFj56N5',
        },
        {
          count,
        },
      ),
  ],
  [
    'itemUnreadable',
    (): string =>
      translateMessage({
        defaultMessage: 'This item couldn’t be read.',
        id: 'TKHyD1SJvE',
      }),
  ],
  [
    'loading',
    (): string =>
      translateMessage({
        defaultMessage: 'Loading',
        id: 'iFsDVRnIHW',
      }),
  ],
  [
    'loadingMoreOptions',
    (): string =>
      translateMessage({
        defaultMessage: 'Loading more options',
        id: 'rnxsKb3U1A',
      }),
  ],
  [
    'loadingOptions',
    (): string =>
      translateMessage({
        defaultMessage: 'Loading options',
        id: 'Eh7N3W1mbN',
      }),
  ],
  [
    'moreActions',
    (): string =>
      translateMessage({
        defaultMessage: 'More actions',
        id: 'S8/4ZI1Fhf',
      }),
  ],
  [
    'nextMonth',
    (): string =>
      translateMessage({
        defaultMessage: 'Next month',
        id: 'PqmLVnSl7X',
      }),
  ],
  [
    'noMoreFiles',
    (): string =>
      translateMessage({
        defaultMessage: 'No more files can be added here.',
        id: 'io45NF3oSk',
      }),
  ],
  [
    'noResults',
    (): string =>
      translateMessage({
        defaultMessage: 'No results',
        id: 'jHJmjfxD4s',
      }),
  ],
  [
    'nSelected',
    ({ count = '' }: UiLabelValues): string =>
      translateMessage(
        {
          defaultMessage: '{count} selected',
          id: 'NKPfmmHQdx',
        },
        {
          count,
        },
      ),
  ],
  [
    'onlyNFiles',
    ({ count = '' }: UiLabelValues): string =>
      translateMessage(
        {
          defaultMessage: 'Only {count} files can be added here.',
          id: 'Ff1QOLaeZb',
        },
        {
          count,
        },
      ),
  ],
  [
    'onlyOneFile',
    (): string =>
      translateMessage({
        defaultMessage: 'Only one file can be added here.',
        id: 'ML95q1fw4j',
      }),
  ],
  [
    'opensInNewTab',
    (): string =>
      translateMessage({
        defaultMessage: '(opens in new tab)',
        id: 'yZs9WUVaoC',
      }),
  ],
  [
    'overflowCount',
    ({ count = '' }: UiLabelValues): string =>
      translateMessage(
        {
          defaultMessage: 'and {count} more',
          id: 'oDI/Rp4thV',
        },
        {
          count,
        },
      ),
  ],
  [
    'playVideo',
    ({ item = '' }: UiLabelValues): string =>
      translateMessage(
        {
          defaultMessage: 'Play video: {item}',
          id: 'k5iu07zSUr',
        },
        {
          item,
        },
      ),
  ],
  [
    'previousMonth',
    (): string =>
      translateMessage({
        defaultMessage: 'Previous month',
        id: '8mRNBDIXEf',
      }),
  ],
  [
    'removeItem',
    ({ item = '' }: UiLabelValues): string =>
      translateMessage(
        {
          defaultMessage: 'Remove {item}',
          id: 'GHRzoS0vqm',
        },
        {
          item,
        },
      ),
  ],
  [
    'replyPlaceholder',
    (): string =>
      translateMessage({
        defaultMessage: 'Reply',
        id: '9HU8vwHwVV',
      }),
  ],
  [
    'resetProperty',
    ({ name = '' }: UiLabelValues): string =>
      translateMessage(
        {
          defaultMessage: 'Reset {name}',
          id: 'VhNYDGOeBE',
        },
        {
          name,
        },
      ),
  ],
  [
    'resetUnnamedProperty',
    (): string =>
      translateMessage({
        defaultMessage: 'Reset',
        id: 'jm/spnRSn+',
      }),
  ],
  [
    'retry',
    (): string =>
      translateMessage({
        defaultMessage: 'Retry',
        id: '62nsdyMyIO',
      }),
  ],
  [
    'scrollBack',
    (): string =>
      translateMessage({
        defaultMessage: 'Scroll back',
        id: 'btr1sFjdxa',
      }),
  ],
  [
    'scrollForward',
    (): string =>
      translateMessage({
        defaultMessage: 'Scroll forward',
        id: 'T9coFzJOau',
      }),
  ],
  [
    'selectAll',
    (): string =>
      translateMessage({
        defaultMessage: 'Select all',
        id: '94Fg25VD0N',
      }),
  ],
  [
    'sequenceThen',
    (): string =>
      translateMessage({
        defaultMessage: 'then',
        id: 'E9kbIZCBAM',
      }),
  ],
  [
    'unnamedPanelContent',
    (): string =>
      translateMessage({
        defaultMessage: 'Panel content',
        id: 'zNmqxlYJxm',
      }),
  ],
  [
    'uploadFailed',
    (): string =>
      translateMessage({
        defaultMessage: 'Upload failed',
        id: 'f00p/7iV78',
      }),
  ],
]);
export function uiLabel(key: string, values: UiLabelValues = {}): string | undefined {
  return UI_LABEL_MESSAGES.get(key)?.(values);
}
