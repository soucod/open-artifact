import { SegmentedControl, type Segment } from '../kit/segmented-control.tsx';
import { Popover, type PopoverPopupProps } from '../kit/popover.tsx';
import { Avatar } from '../kit/avatar.tsx';
import { PERSON_AVATAR_LOOK } from '../chips/person-avatar-look.ts';
import { Skeleton, SkeletonGroup } from '../kit/skeleton.tsx';
import { Button } from '../kit/button.tsx';
import { Icon } from '../kit/icon.tsx';
import { AGENT_NAME } from '../agent/agent-name.ts';
import * as React from 'react';
import type { DecimalSignName } from '@open-artifact/sheets-core';
import { formatTimeOfDay, dayOfVersion, formatShortDate, type HistoryFailureWords } from './version-text.ts';
import { translateMessage } from '../i18n/messages.ts';
import { DrawnAndSaid } from '../agent/agent-rows.tsx';
import { withDecimalSign } from '../format/number-signs.ts';
import { useBottomInsetWhileOpen, popupCollisionPadding } from '../shell/bottom-insets.ts';
import type { CellHistoryScope } from '../state/initial-state.ts';
import type { HeldContent } from '../state/event-reducer.ts';
import type { ShownAuthor } from './version-history.ts';
import type { ShownCellChange, ShownCellHistory, ShownChangedCell } from './cell-history.ts';

export function formatEditTime(atMs: number, nowMs: number): string {
  let time = formatTimeOfDay(atMs);
  switch (dayOfVersion(atMs, nowMs)) {
    case 'today':
      return translateMessage(
        {
          defaultMessage: 'Today, {time}',
          id: 'yJMGSYOCBa',
        },
        {
          time,
        },
      );
    case 'yesterday':
      return translateMessage(
        {
          defaultMessage: 'Yesterday, {time}',
          id: 'u2naB1N3Of',
        },
        {
          time,
        },
      );
    case null:
      return translateMessage(
        {
          defaultMessage: '{date}, {time}',
          id: 'mBGGMDtve+',
        },
        {
          date: formatShortDate(atMs, nowMs),
          time,
        },
      );
  }
}
export function editAuthorName(author: ShownAuthor | null): string {
  if (author?.kind === 'agent') return AGENT_NAME;
  if (author?.name === null) return '';
  if (author !== null && author.name !== '') return author.name;
  return translateMessage({
    defaultMessage: 'Someone',
    id: 'ky2lEuxNDL',
  });
}
export function historyFaultNotice(
  whyNotRead: NonNullable<ShownCellHistory['whyNotRead']>,
  scope: CellHistoryScope,
): HistoryFailureWords {
  let unavailableTitle = scope === 'row' ? rowHistoryUnavailableTitle : cellHistoryUnavailableTitle;
  switch (whyNotRead) {
    case 'storeDoesNotKnowHow':
      return {
        title: translateMessage({
          defaultMessage: 'Edit history isn’t available yet',
          id: 'lMaqxAXeiW',
        }),
        hint: translateMessage({
          defaultMessage: 'Try again later.',
          id: 'PmDaCUh6pt',
        }),
        canTryAgain: false,
      };
    case 'recordDoesNotMatch':
      return {
        title: unavailableTitle(),
        canTryAgain: false,
      };
    case 'cellIsGone':
      return {
        title:
          scope === 'row'
            ? translateMessage({
                defaultMessage: 'This row was deleted.',
                id: 'YEYsL7kemJ',
              })
            : translateMessage({
                defaultMessage: 'This cell’s row or column was deleted.',
                id: 'TQKGkZ0s/Y',
              }),
        canTryAgain: false,
      };
    case 'answerIsTooLarge':
      return {
        title: unavailableTitle(),
        hint:
          scope === 'row'
            ? translateMessage({
                defaultMessage: 'This row has too much text to show here.',
                id: 'DAlwDLx1KM',
              })
            : translateMessage({
                defaultMessage: 'This cell has too much text to show here.',
                id: 'Rsbz13kse+',
              }),
        canTryAgain: false,
      };
    case 'tookTooLong':
      return {
        title: unavailableTitle(),
        hint: translateMessage({
          defaultMessage: 'This Sheet has too many edits to search.',
          id: 'LfbriAs9It',
        }),
        canTryAgain: false,
      };
    case 'busy':
    case 'noAnswer':
    case 'refused':
      return {
        title: translateMessage({
          defaultMessage: 'Couldn’t load edit history',
          id: '2L6D89n1bd',
        }),
        ...(whyNotRead === 'noAnswer' && {
          hint: translateMessage({
            defaultMessage: 'Check your connection, then try again.',
            id: '2J1b9ATDii',
          }),
        }),
        canTryAgain: true,
      };
  }
}
interface CellHistoryCellLineProps {
  cell: ShownChangedCell;
  /** Whether the cells of the change are listed by name, as for a row. */
  isNamed: boolean;
  decimalSign: DecimalSignName;
}
export function CellHistoryCellLine({
  cell: { held, address, column },
  isNamed,
  decimalSign,
}: CellHistoryCellLineProps) {
  let columnName = column.kind === 'named' ? column.name : column.letters;
  let heldClassName = isNamed ? 'col-start-3' : 'col-span-2 col-start-2';
  return <>{isNamed &&
        <bdi aria-hidden={held.kind === 'nothing' ? true : undefined} title={columnName} className="col-start-2 line-clamp-3 text-footnote wrap-anywhere text-secondary">{columnName}</bdi>}{held.kind === 'nothing'
        ? <span className={`${heldClassName} text-body text-secondary`}><DrawnAndSaid drawn={cellHistoryMessages.cleared()} said={cellHistoryMessages.clearedSaid(isNamed && column.kind === 'named' ? column.name : address)} /></span>
        : <bdi className={`${heldClassName} min-w-0 text-body wrap-anywhere whitespace-pre-wrap text-primary`}>{textOfHeldValue(held, decimalSign)}</bdi>}</>;
}
interface CellHistoryChangeProps {
  change: ShownCellChange;
  areCellsNamed: boolean;
  nowMs: number;
  decimalSign: DecimalSignName;
}
export function CellHistoryChange({
  change: { author, atMs, cells },
  areCellsNamed,
  nowMs,
  decimalSign,
}: CellHistoryChangeProps) {
  let authorName = editAuthorName(author);
  return <li className="col-span-3 grid min-w-0 grid-cols-subgrid items-baseline"><span aria-hidden className="row-span-2 flex self-start pt-0.5">{author?.kind === 'agent'
            ? <Avatar size="xs" variant="agent" name={authorName} />
            : <Avatar {...PERSON_AVATAR_LOOK} size="xs" name={authorName} src={author?.avatarUrl ?? ''} />}</span><span className="col-span-2 flex min-h-[1lh] min-w-0 flex-wrap justify-between gap-x-sm text-footnote text-secondary"><span className="wrap-anywhere">{authorName}</span><span className="shrink-0 tabular-nums">{formatEditTime(atMs, nowMs)}</span></span>{cells.map(
        (cell) =>
          <CellHistoryCellLine key={cell.columnId} cell={cell} isNamed={areCellsNamed} decimalSign={decimalSign} />,
      )}</li>;
}
export function CellHistorySkeleton() {
  return <SkeletonGroup label={cellHistoryMessages.loading()} className="flex flex-col gap-md">{HISTORY_SKELETON_ROWS.map(
      (row) =>
        <div key={row} className="flex items-start gap-sm"><Skeleton className="size-5 shrink-0 rounded-full" /><div className="flex flex-1 flex-col gap-xs"><Skeleton width="70%" className="text-footnote" /><Skeleton width="40%" className="text-body" /></div></div>,
    )}</SkeletonGroup>;
}
interface CellHistoryScopeSwitchProps {
  history: Pick<ShownCellHistory, 'scope' | 'rowNumber' | 'address'>;
  onScopeChosen: (scope: CellHistoryScope) => void;
}
export function CellHistoryScopeSwitch({
  history: { scope, rowNumber, address },
  onScopeChosen,
}: CellHistoryScopeSwitchProps) {
  let segments = React.useMemo(
    (): Segment<CellHistoryScope>[] => [
      {
        value: 'row',
        label: cellHistoryMessages.row(rowNumber),
      },
      {
        value: 'cell',
        label: cellHistoryMessages.cell(address),
      },
    ],
    [rowNumber, address],
  );
  return <SegmentedControl value={scope} segments={segments} aria-label={cellHistoryMessages.scopeOfList()} onChange={onScopeChosen} />;
}
interface CellHistoryListProps {
  history: Pick<ShownCellHistory, 'scope' | 'changes' | 'whyNotRead' | 'isAwaited' | 'areEarlierLeftOut'>;
  decimalSign: DecimalSignName;
  onTryAgain: () => void;
}
export function CellHistoryList({
  history: { scope, changes, whyNotRead, isAwaited, areEarlierLeftOut },
  decimalSign,
  onTryAgain,
}: CellHistoryListProps) {
  let todayMs = useStartOfToday();
  let failureWords = whyNotRead === null ? null : historyFaultNotice(whyNotRead, scope);
  let isAskedAgain = isAwaited && failureWords !== null;
  let notice: Pick<HistoryFailureWords, 'title' | 'hint'> | null =
    failureWords ??
    (changes?.length === 0 && !areEarlierLeftOut
      ? {
          title: cellHistoryMessages.neverEdited(scope),
          hint: undefined,
        }
      : null);
  return <>{changes === null && failureWords === null && <CellHistorySkeleton />}<output className="flex flex-col gap-xs text-footnote text-secondary empty:-mt-[var(--ui-gap-md)]">{notice !== null &&
            <span className="text-body text-primary">{isAskedAgain ? blankWhileAwaited(notice.title) : notice.title}</span>}{notice?.hint !== undefined &&
            <span>{isAskedAgain ? blankWhileAwaited(notice.hint) : notice.hint}</span>}</output>{failureWords?.canTryAgain === true &&
        <Button variant="secondary" size="sm" className="self-start" busy={isAwaited} busyLabel={cellHistoryMessages.loading()} onClick={onTryAgain}>{cellHistoryMessages.tryAgain()}</Button>}{changes !== null &&
        changes.length > 0 &&
        (<ul className="grid min-w-0 grid-cols-[auto_fit-content(40%)_minmax(0,1fr)] gap-x-sm gap-y-md">{changes.map(
            (change) =>
              <CellHistoryChange key={change.revision} change={change} areCellsNamed={scope === 'row'} nowMs={todayMs} decimalSign={decimalSign} />,
          )}</ul>)}{areEarlierLeftOut &&
        <span className="text-footnote text-secondary">{cellHistoryMessages.olderNotShown()}</span>}</>;
}
export const cellHistoryMessages = {
  show: () =>
    translateMessage({
      defaultMessage: 'View history',
      id: '9MScxQ7nKk',
    }),
  title: () =>
    translateMessage({
      defaultMessage: 'Edit history',
      id: 'cc6TSri5h5',
    }),
  scopeOfList: () =>
    translateMessage({
      defaultMessage: 'Edits to show',
      id: 'Gyxfwc0xjE',
    }),
  row: (rowNumber: number) =>
    translateMessage(
      {
        defaultMessage: 'Row {rowNumber}',
        id: '9Dx7eVQxnV',
      },
      {
        rowNumber,
      },
    ),
  cell: (address: string) =>
    translateMessage(
      {
        defaultMessage: 'Cell {address}',
        id: 'cgQZorGEpY',
      },
      {
        address,
      },
    ),
  cleared: () =>
    translateMessage({
      defaultMessage: 'Cleared',
      id: 'FQjsp/Zu/b',
    }),
  clearedSaid: (cell: string) =>
    translateMessage(
      {
        defaultMessage: 'Cleared {cell}',
        id: 'TQjsd1H/DX',
      },
      {
        cell,
      },
    ),
  loading: () =>
    translateMessage({
      defaultMessage: 'Loading edit history…',
      id: 'i/na800t0t',
    }),
  neverEdited: (scope: CellHistoryScope) =>
    scope === 'row'
      ? translateMessage({
          defaultMessage: 'This row hasn’t been edited.',
          id: 'u3orwfuN0i',
        })
      : translateMessage({
          defaultMessage: 'This cell hasn’t been edited.',
          id: '/f2SP3+FfI',
        }),
  olderNotShown: () =>
    translateMessage({
      defaultMessage: 'Older edits aren’t shown.',
      id: 'dgtYhs9GGD',
    }),
  close: () =>
    translateMessage({
      defaultMessage: 'Close',
      id: '9m/DLH71Je',
    }),
  tryAgain: () =>
    translateMessage({
      defaultMessage: 'Try again',
      id: 'pEZeVF12w9',
    }),
};
export const cellHistoryUnavailableTitle = () =>
  translateMessage({
    defaultMessage: 'Edit history isn’t available for this cell',
    id: '4ZRTZgx+6O',
  });
export const rowHistoryUnavailableTitle = () =>
  translateMessage({
    defaultMessage: 'Edit history isn’t available for this row',
    id: '0qUDvqAri0',
  });
export const LOOK_AGAIN_MAX_DELAY_MS = 2000;
export const LOOK_AGAIN_WINDOW_MS = 1e4;
/** How long to wait before looking again, given how long ago the view fell behind. */
export const lookAgainDelay = (msSinceBehind: number): number =>
  Math.max(0, Math.min(LOOK_AGAIN_MAX_DELAY_MS, LOOK_AGAIN_WINDOW_MS - msSinceBehind));
/** A text kept blank, but still taking its line when there is one, while it is asked for again. */
export const blankWhileAwaited = (text: string | undefined): string => (text === undefined ? '' : ' ');
export const noTodaySubscribe = () => () => {};
export const startOfToday = (): number => new Date().setHours(0, 0, 0, 0);
export const useStartOfToday = () => React.useSyncExternalStore(noTodaySubscribe, startOfToday, startOfToday);
export const HISTORY_SKELETON_ROWS = [0, 1, 2];
export const CELL_HISTORY_CARD_ATTRIBUTE = 'data-cell-history-card';
export const textOfHeldValue = (held: Exclude<HeldContent, { kind: 'nothing' }>, decimalSign: DecimalSignName): string =>
  held.kind === 'written' ? held.text : withDecimalSign(String(held.value), decimalSign);
interface CellHistoryPopoverProps {
  history: ShownCellHistory | null;
  anchor: PopoverPopupProps['anchor'];
  decimalSign: DecimalSignName;
  whatHasCaretAfter: PopoverPopupProps['finalFocus'];
  onScopeChosen: (scope: CellHistoryScope) => void;
  onTryAgain: () => void;
  /** Asked when the history has been behind the sheet long enough to be read again. */
  onLookAgain: () => void;
  onShut: () => void;
}
export const CellHistoryPopover = React.memo(function ({
  history,
  anchor,
  decimalSign,
  whatHasCaretAfter,
  onScopeChosen,
  onTryAgain,
  onLookAgain,
  onShut,
}: CellHistoryPopoverProps) {
  let behindAtChangeCount = history?.behindAtChangeCount ?? null;
  let behindSinceRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (behindAtChangeCount === null) {
      behindSinceRef.current = null;
      return;
    }
    behindSinceRef.current ??= performance.now();
    let timer = setTimeout(onLookAgain, lookAgainDelay(performance.now() - behindSinceRef.current));
    return () => clearTimeout(timer);
  }, [behindAtChangeCount, onLookAgain]);
  let [shownHistory, setShownHistory] = React.useState(history);
  if (history !== null && history !== shownHistory) setShownHistory(history);
  let collisionPad = useBottomInsetWhileOpen(history !== null, false);
  return <Popover.Root modal open={history !== null} onOpenChange={(isOpen) => {
      if (!isOpen) onShut();
    }}><Popover.Popup {...{
        [CELL_HISTORY_CARD_ATTRIBUTE]: '',
      }} anchor={anchor} align="start" collisionPadding={popupCollisionPadding(collisionPad)} className="flex max-h-[min(360px,var(--available-height))] w-80 flex-col gap-md" finalFocus={whatHasCaretAfter} onKeyDown={(event) => {
        if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault();
      }}>{shownHistory !== null &&
        (<><div className="flex min-w-0 items-center justify-between gap-sm"><Popover.Title className="min-w-0 text-body-medium">{cellHistoryMessages.title()}</Popover.Title><Popover.Close render={<Button variant="ghost" size="sm" iconOnly icon={<Icon name="X" size="sm" />} aria-label={cellHistoryMessages.close()} tooltip={false} className="shrink-0 text-secondary" />} /></div>{shownHistory.canRowBeRead &&
              <CellHistoryScopeSwitch history={shownHistory} onScopeChosen={onScopeChosen} />}<CellHistoryList history={shownHistory} decimalSign={decimalSign} onTryAgain={onTryAgain} /></>)}</Popover.Popup></Popover.Root>;
});
