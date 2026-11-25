import { Menu } from '../kit/menu.tsx';
import { Avatar } from '../kit/avatar.tsx';
import { PERSON_AVATAR_LOOK } from '../chips/person-avatar-look.ts';
import { Skeleton, SkeletonGroup } from '../kit/skeleton.tsx';
import { likelyHasKeyboard } from '../kit/platform.ts';
import { Button } from '../kit/button.tsx';
import { Icon } from '../kit/icon.tsx';
import * as React from 'react';
import { versionAuthorName, versionTimeText, versionHistoryMessages, versionAuthorsText, versionHistoryFailureText } from './version-text.ts';
import { showTitleIfTextOverflows } from '../ui/card-rows.tsx';
import { blockRepeatedEnterOrSpace } from '../ui/repeated-key-guards.ts';
import { swallowRestOfPress } from '../ui/press-swallow.ts';
import { wasFocusDroppedWith } from '../ui/focus-rescue.ts';
import { revealInSidePane, useSidePaneCaret, focusPaneStart, useKeepCaretInView, SidePane, PaneEmptyState } from '../ui/side-pane/side-pane.tsx';
import { LOOK_AGAIN_MAX_DELAY_MS, useStartOfToday, blankWhileAwaited } from './cell-history-popover.tsx';
import type { VersionHistoryAct } from '../state/event-reducer.ts';
import type { ShownAuthor, ShownVersion, ShownVersionHistory } from './version-history.ts';

type ActInVersionHistory = (act: VersionHistoryAct) => void;
/** The restore offered for a version: whether it is under way, whether it is off for now, and how to start it. */
export interface VersionRestore {
  isBusy: boolean;
  isOff: boolean;
  go: () => void;
}
/** What it takes to offer the restore of a version. */
interface RestoreOfVersionAsked {
  version: Pick<ShownVersion, 'revision' | 'isCurrent' | 'isBeingRestored'>;
  isTakingBack: boolean;
  wasPointerPressedLast?: () => boolean;
  onAct: ActInVersionHistory;
}
interface VersionAuthorAvatarsProps {
  authors: ShownAuthor[];
}
export function VersionAuthorAvatars({ authors }: VersionAuthorAvatarsProps) {
  let agentAuthors = authors.filter(({ kind }) => kind === 'agent');
  let otherAuthors = authors.filter(({ kind }) => kind !== 'agent');
  return <span aria-hidden className="flex shrink-0 items-center gap-0.5 [--ui-avatar-xs:1rem]">{[...otherAuthors.slice(0, VERSION_AUTHOR_AVATAR_LIMIT - agentAuthors.length), ...agentAuthors].map(
      (author) =>
        author.kind === 'agent'
          ? <Avatar key="agent" size="xs" variant="agent" name={versionAuthorName(author)} />
          : <Avatar key={author.userId} {...PERSON_AVATAR_LOOK} size="xs" name={versionAuthorName(author)} src={author.avatarUrl} />,
    )}</span>;
}
export function restoreOfVersion({
  version: { revision, isCurrent, isBeingRestored },
  isTakingBack,
  wasPointerPressedLast,
  onAct,
}: RestoreOfVersionAsked): VersionRestore | null {
  if (isCurrent) return null;
  return {
    isBusy: isBeingRestored,
    isOff: isTakingBack && !isBeingRestored,
    go: () =>
      onAct({
        kind: 'restore',
        revision,
        ...(wasPointerUsedWithKeyboard(wasPointerPressedLast) && {
          isByPointer: true,
        }),
      }),
  };
}
interface VersionRowProps {
  version: ShownVersion;
  nowMs: number;
  isFirst: boolean;
  isPicked: boolean;
  isAnotherPicked: boolean;
  isRestoreInBar: boolean;
  isTakingBack: boolean;
  onPicked: (isPicked: boolean) => void;
  onMenuOpenChange: (firstRevision: number, isOpen: boolean) => void;
  whatHasCaretAfter: () => HTMLElement | false;
  wasPointerPressedLast: () => boolean;
  onAct: ActInVersionHistory;
}
export function VersionRow(props: VersionRowProps) {
  let { version, nowMs, isFirst, onPicked, onMenuOpenChange } = props;
  let { atMs, authors, firstRevision, isCurrent } = version;
  const restore = restoreOfVersion(props);
  const isExpanded = props.isPicked && restore !== null;
  let menuTriggerId = React.useId();
  const isRestoreInRow = isExpanded && !props.isRestoreInBar;
  let [isMenuOpen, setMenuOpen] = React.useState(false);
  let changeMenuOpen = (isOpen: boolean) => {
    setMenuOpen(isOpen);
    onMenuOpenChange(firstRevision, isOpen);
  };
  let unpickIfCurrent = React.useEffectEvent(() => {
    if (props.isPicked)
      props.onAct({
        kind: 'endLook',
      });
  });
  React.useEffect(() => {
    if (isCurrent) unpickIfCurrent();
  }, [isCurrent]);
  let rowContents = <><span className="relative block text-body text-primary tabular-nums">{versionTimeText(atMs, nowMs)}{isCurrent && ' '}{isCurrent &&
            <span className="ms-xs text-caption text-secondary">{versionHistoryMessages.currentVersion()}</span>}</span><span className="relative mt-1 flex min-h-4 min-w-0 items-start gap-1.5 text-caption leading-4 text-secondary"><VersionAuthorAvatars authors={authors} /><span className={isExpanded || isCurrent ? 'min-w-0 wrap-anywhere' : 'truncate'} onPointerEnter={showTitleIfTextOverflows}>{versionAuthorsText(authors)}</span></span></>;
  return <li {...{
      [VERSION_ROW_ATTRIBUTE]: firstRevision,
    }} className={`group/version relative px-sm py-0.5 focus-visible:outline-hidden ${isFirst || isExpanded ? '' : 'before:absolute before:inset-x-4 before:top-0 before:h-px before:bg-alpha-1 hover:before:hidden has-focus-visible:before:hidden'}`}><div className={isExpanded ? 'rounded-lg bg-fill-ghost-hover outline-1 -outline-offset-1 outline-transparent' : undefined}><div className={`relative flex rounded-lg py-2.5 ps-sm pe-sm -outline-offset-2 outline-transparent group-focus-visible/version:shadow-focus group-focus-visible/version:outline-2 has-[>[data-picks-version]:focus-visible]:shadow-focus has-[>[data-picks-version]:focus-visible]:outline-2 ${isExpanded || isCurrent ? '' : 'group-hover/version:bg-fill-ghost-hover'}`}>{restore === null && props.isAnotherPicked
              ? (<button type="button" {...{
                    [PICKS_VERSION_ATTRIBUTE]: true,
                  }} className="min-w-0 flex-1 cursor-(--ui-cursor-interactive) text-start outline-none before:absolute before:inset-0" onKeyDown={blockRepeatedEnterOrSpace} onClick={() => onPicked(false)}>{rowContents}</button>)
              : restore === null
                ? <div className="min-w-0 flex-1">{rowContents}</div>
                : (<button type="button" {...{
                      [PICKS_VERSION_ATTRIBUTE]: true,
                    }} aria-expanded={isExpanded} aria-controls={isExpanded ? menuTriggerId : undefined} className="min-w-0 flex-1 cursor-(--ui-cursor-interactive) text-start outline-none before:absolute before:inset-0" onContextMenu={(event) => {
                      if (isRestoreInRow) return;
                      event.preventDefault();
                      changeMenuOpen(true);
                    }} onKeyDown={blockRepeatedEnterOrSpace} onClick={(event) => {
                      swallowRestOfPress(event);
                      onPicked(!isExpanded);
                    }}>{rowContents}</button>)}{restore !== null &&
              !isRestoreInRow &&
              <VersionRowMenu id={menuTriggerId} restore={restore} isRowPicked={isExpanded} isOpen={isMenuOpen} onOpenChange={changeMenuOpen} whatHasCaretAfter={props.whatHasCaretAfter} wasPointerPressedLast={props.wasPointerPressedLast} />}</div>{isRestoreInRow &&
          <div id={menuTriggerId} className="flex px-sm pb-2"><Button variant="secondary" size="xs" busy={restore.isBusy} disabled={restore.isOff} onClick={restore.go}>{versionHistoryMessages.restore()}</Button></div>}</div></li>;
}
interface VersionRowMenuProps {
  id: string;
  restore: VersionRestore;
  isRowPicked: boolean;
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  whatHasCaretAfter: () => HTMLElement | false;
  wasPointerPressedLast: () => boolean;
}
export function VersionRowMenu({
  id,
  restore,
  isRowPicked,
  isOpen,
  onOpenChange,
  whatHasCaretAfter,
  wasPointerPressedLast,
}: VersionRowMenuProps) {
  let triggerRef = React.useRef<HTMLElement | null>(null);
  let isOpenRef = React.useRef(isOpen);
  let [isTriggerShown, setTriggerShown] = React.useState(false);
  if (isOpen && !isTriggerShown) setTriggerShown(true);
  let closeOnUnmount = React.useEffectEvent(() => onOpenChange(false));
  React.useEffect(() => () => closeOnUnmount(), []);
  return <Menu.Root modal={false} open={isOpen} onOpenChange={(nextOpen) => {
      isOpenRef.current = nextOpen;
      onOpenChange(nextOpen);
    }} onOpenChangeComplete={(nextOpen) => {
      if (nextOpen) return;
      setTimeout(() => {
        if (triggerRef.current?.ownerDocument.activeElement !== triggerRef.current) setTriggerShown(false);
      });
    }}><Menu.Trigger render={<Button ref={triggerRef} id={id} variant="ghost" size="xs" iconOnly icon={<Icon name="DotsHorizontal" size="sm" />} aria-label={versionHistoryMessages.moreActions()} busy={restore.isBusy} className={`absolute end-2 top-2 text-secondary ${isTriggerShown || isRowPicked || restore.isBusy ? '' : 'invisible group-hover/version:visible'}`} onFocus={() => setTriggerShown(true)} onBlur={() => {
            if (!isOpenRef.current) setTriggerShown(false);
          }} />} /><Menu.Popup align="end" finalFocus={() => (wasPointerPressedLast() ? whatHasCaretAfter() : true)} onKeyDownCapture={blockRepeatedEnterOrSpace}><Menu.Item disabled={restore.isOff || restore.isBusy} onClick={(event) => {
            swallowRestOfPress(event);
            restore.go();
          }}>{versionHistoryMessages.restore()}</Menu.Item></Menu.Popup></Menu.Root>;
}
export function VersionListSkeleton() {
  return <SkeletonGroup label={versionHistoryMessages.loading()} className="flex flex-col gap-5 py-5 ps-lg pe-md">{VERSION_SKELETON_ROWS.map(
      (rowIndex) =>
        <div key={rowIndex} className="flex flex-col gap-1"><Skeleton width="45%" className="text-body" /><div className="flex items-center gap-1.5"><Skeleton className="size-4 shrink-0 rounded-full" /><Skeleton width="40%" className="text-caption" /></div></div>,
    )}</SkeletonGroup>;
}
/** Keeps the caret on the version list as versions come in, and returns the props that note which row has it. */
export function useVersionListFocusKeeping({
  history: versionHistory,
  paneRef,
  wasPointerPressedLast,
}: Pick<VersionHistoryPaneProps, 'history' | 'paneRef' | 'wasPointerPressedLast'>) {
  let focusedRowRef = React.useRef<HTMLElement | null>(null);
  let awaited = versionHistory?.awaited ?? null;
  let lastAwaitedRef = React.useRef(awaited);
  let lastRevisionBeforeOlderRef = React.useRef<number | undefined>(undefined);
  React.useLayoutEffect(() => {
    let lastAwaited = lastAwaitedRef.current;
    if (lastAwaited === awaited) return;
    lastAwaitedRef.current = awaited;
    let versions = versionHistory?.versions ?? [];
    if (awaited !== null) {
      lastRevisionBeforeOlderRef.current = versions.at(-1)?.firstRevision;
      return;
    }
    let focusedRow = focusedRowRef.current;
    if (focusedRow === null) return;
    if (!focusedRow.isConnected) focusedRowRef.current = null;
    let ownerDocument = focusedRow.ownerDocument;
    let lastRowIndex = versions.findIndex((version) => version.firstRevision === lastRevisionBeforeOlderRef.current);
    let movesToNextRow =
      lastAwaited === 'older' &&
      !wasPointerPressedLast() &&
      ownerDocument.activeElement === focusedRow &&
      lastRowIndex !== -1 &&
      versions[lastRowIndex + 1] !== undefined;
    if ((!wasFocusDroppedWith(focusedRow, ownerDocument) && !movesToNextRow) || !ownerDocument.hasFocus()) return;
    const rowToFocus =
      paneRef.current?.querySelector<HTMLElement>(`[${VERSION_ROW_ATTRIBUTE}="${(versions[lastRowIndex + 1] ?? versions[lastRowIndex])?.firstRevision}"]`) ?? null;
    if (rowToFocus === null) return;
    rowToFocus.tabIndex = -1;
    rowToFocus.addEventListener('blur', function dropTabIndex() {
      if (rowToFocus.ownerDocument.activeElement === rowToFocus) return;
      rowToFocus.removeAttribute('tabindex');
      rowToFocus.removeEventListener('blur', dropTabIndex);
    });
    rowToFocus.focus({
      preventScroll: true,
      focusVisible: !wasPointerPressedLast(),
    });
    revealInSidePane(paneRef.current, rowToFocus);
  });
  return React.useMemo(
    () => ({
      onFocus: ({ currentTarget }: React.FocusEvent<HTMLElement>) => void (focusedRowRef.current = currentTarget),
      onBlur: () => void (focusedRowRef.current = null),
    }),
    [],
  );
}
export const VERSION_AUTHOR_AVATAR_LIMIT = 3;
export const VERSION_SKELETON_ROWS = [0, 1, 2, 3];
export const VERSION_ROW_ATTRIBUTE = 'data-row-of-version';
export const PICKS_VERSION_ATTRIBUTE = 'data-picks-version';
export const wasPointerUsedWithKeyboard = (wasPointerPressedLast?: () => boolean): boolean =>
  wasPointerPressedLast?.() === true && likelyHasKeyboard();
export const isHoveredByMouse = (element: Element | null): boolean =>
  element?.matches(':hover') === true && element.ownerDocument.defaultView?.matchMedia('(hover:hover)').matches === true;
interface VersionHistoryPaneProps {
  history: ShownVersionHistory | null;
  timesAsked: number;
  paneRef: React.RefObject<HTMLElement | null>;
  takesNoTyping: boolean;
  paneWidth: number;
  onPaneWidthChange: (width: number) => void;
  onKeyDownInPane: (event: React.KeyboardEvent) => void;
  whatHasCaretAfter: () => HTMLElement | false;
  wasPointerPressedLast: () => boolean;
  onAct: ActInVersionHistory;
  /** Whether the restore of the version looked at is in the bar over the cells, and so not in its row. */
  isRestoreInBar: boolean;
  onPressed: () => void;
  /** Asked when the history has been behind the sheet long enough to be read again. */
  onLookAgain: () => void;
  onShut: () => void;
}
export const VersionHistoryPane = React.memo(function (props: VersionHistoryPaneProps) {
  let {
    history: versionHistory,
    timesAsked,
    paneRef,
    whatHasCaretAfter,
    wasPointerPressedLast,
  } = props;
  let { onAct, onLookAgain } = props;
  useSidePaneCaret({
    isOpen: versionHistory !== null,
    isCaretLeftAsItOpens: versionHistory?.isCaretForCells === true,
    timesAsked,
    paneRef,
    putCaretWhereToStart() {
      let pickedButton = paneRef.current?.querySelector<HTMLElement>(
        `[${VERSION_ROW_ATTRIBUTE}="${versionHistory?.picked ?? versionHistory?.pickedLast}"] button`,
      );
      if (pickedButton !== null && pickedButton !== undefined)
        return (
          pickedButton.focus({
            preventScroll: true,
            focusVisible: !wasPointerPressedLast(),
          }),
          revealInSidePane(paneRef.current, pickedButton)
        );
      return void focusPaneStart(paneRef.current, 'start', {
        isByPointer: wasPointerPressedLast(),
      });
    },
    whatHasCaretAfter,
  });
  let openMenuRowRef = React.useRef<number | null>(null);
  let onRowMenuOpenChange = React.useCallback((revision: number, isOpen: boolean) => {
    if (isOpen) openMenuRowRef.current = revision;
    else if (openMenuRowRef.current === revision) openMenuRowRef.current = null;
  }, []);
  let behindAtChangeCount = versionHistory?.behindAtChangeCount ?? null;
  React.useEffect(() => {
    if (behindAtChangeCount === null) return;
    let timer = setTimeout(function checkAgain() {
      if (!isHoveredByMouse(paneRef.current) && openMenuRowRef.current === null) return onLookAgain();
      timer = setTimeout(checkAgain, LOOK_AGAIN_MAX_DELAY_MS);
      return;
    }, LOOK_AGAIN_MAX_DELAY_MS);
    return () => clearTimeout(timer);
  }, [behindAtChangeCount, onLookAgain, paneRef]);
  let focusKeepingProps = useVersionListFocusKeeping({
    history: versionHistory,
    paneRef,
    wasPointerPressedLast,
  });
  useKeepCaretInView(paneRef, versionHistory !== null, wasPointerPressedLast);
  let isAwaitingOlder = versionHistory?.awaited === 'older';
  let todayMs = useStartOfToday();
  let pickedRevision = versionHistory?.picked ?? null;
  React.useLayoutEffect(() => {
    let pickedRow = paneRef.current?.querySelector(`[${VERSION_ROW_ATTRIBUTE}="${pickedRevision}"]`);
    if (pickedRow !== null && pickedRow !== undefined) revealInSidePane(paneRef.current, pickedRow);
  }, [pickedRevision, paneRef]);
  if (versionHistory === null) return null;
  let { versions, whyNotRead, isTakingBack } = versionHistory;
  let whyNotWords = whyNotRead === null ? null : versionHistoryFailureText(whyNotRead);
  return <SidePane ref={paneRef} title={versionHistoryMessages.title()} takesNoTyping={props.takesNoTyping} width={props.paneWidth} onWidthChange={props.onPaneWidthChange} onClose={props.onShut} onKeyDown={(event: React.KeyboardEvent) => {
      if (event.key === 'Escape' && pickedRevision !== null) {
        event.preventDefault();
        return onAct({
          kind: 'endLook',
        });
      }
      return props.onKeyDownInPane(event);
    }} onPressed={() => {
      if (openMenuRowRef.current === null) props.onPressed();
    }} wasPointerPressedLast={wasPointerPressedLast}>{versions === null && whyNotWords === null && <VersionListSkeleton />}{versions === null &&
        (<PaneEmptyState isSaid title={versionHistory.awaited === null ? (whyNotWords?.title ?? '') : blankWhileAwaited(whyNotWords?.title)} hint={versionHistory.awaited === null ? (whyNotWords?.hint ?? '') : blankWhileAwaited(whyNotWords?.hint)} action={whyNotWords?.canTryAgain === true &&
            (<Button {...focusKeepingProps} variant="secondary" size="sm" busy={versionHistory.awaited !== null} busyLabel={versionHistoryMessages.loading()} onClick={() =>
                onAct({
                  kind: 'tryAgain',
                })}>{versionHistoryMessages.tryAgain()}</Button>)} />)}{versions !== null &&
        (<ul className="flex min-w-0 shrink-0 flex-col py-3">{versions.map(
            (version, index) =>
              (<VersionRow key={version.firstRevision} version={version} nowMs={todayMs} isFirst={index === 0} isPicked={pickedRevision === version.firstRevision} isAnotherPicked={pickedRevision !== null && pickedRevision !== version.firstRevision} isRestoreInBar={props.isRestoreInBar} isTakingBack={isTakingBack} onPicked={(isPicked) =>
                    onAct(
                      isPicked
                        ? {
                            kind: 'look',
                            revision: version.revision,
                          }
                        : {
                            kind: 'endLook',
                            ...(wasPointerUsedWithKeyboard(wasPointerPressedLast) && {
                              isByPointer: true,
                            }),
                          },
                    )} onMenuOpenChange={onRowMenuOpenChange} whatHasCaretAfter={whatHasCaretAfter} wasPointerPressedLast={wasPointerPressedLast} onAct={onAct} />),
          )}</ul>)}{versions !== null &&
        (whyNotWords !== null || versionHistory.hasOlder) &&
        (<div className={`flex shrink-0 flex-col items-start border-t border-alpha-2 py-md ps-lg pe-md ${whyNotWords?.canTryAgain === true ? 'gap-sm' : ''}`}><output className={`text-footnote text-secondary ${whyNotWords?.canTryAgain === true ? 'min-h-[1lh]' : ''}`}>{whyNotWords !== null && !isAwaitingOlder && versionHistoryMessages.olderVersionsNotLoaded()}</output>{whyNotWords?.canTryAgain !== false &&
              (<Button {...focusKeepingProps} variant={whyNotWords === null ? 'ghost' : 'secondary'} size="sm" flush={whyNotWords === null} busy={isAwaitingOlder} onClick={() =>
                  onAct({
                    kind: whyNotWords === null ? 'showOlder' : 'tryAgain',
                  })}>{whyNotWords === null ? versionHistoryMessages.showOlderVersions() : versionHistoryMessages.tryAgain()}</Button>)}</div>)}</SidePane>;
});
