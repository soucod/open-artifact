import { Popover } from '../kit/popover.tsx';
import { MENU_ITEM_FORCED_COLORS_HIGHLIGHT_CLASSES } from '../kit/menu.tsx';
import { Tooltip, TooltipGroup } from '../kit/tooltip.tsx';
import { Button } from '../kit/button.tsx';
import * as React from 'react';
import * as ReactDOM from 'react-dom';
import { isWithinPressGuard, useLastNonNull, isWithinClickAfterUp } from '../ui/list-under-cell.tsx';
import { MOUSE_STILL_SLOP } from '../comments/mouse-around.ts';
import { DRAG_START_DISTANCE } from '../grid/geometry.ts';
import { sheetMessages } from '../i18n/sheet-messages.ts';
import { splitUrlForDisplay, shortenedUrlRest, urlsShownAlike } from './url-display.ts';
import { breakableUrl, LinkUrlText, LINK_AMONG_TEXT_ATTR, LINK_ELEMENT_SELECTOR, breakableUrlText } from './cell-links-view.tsx';
import { translateMessage } from '../i18n/messages.ts';
import { describeWhyNot } from '../ui/why-not.tsx';
import { useCardShownAfterDelay } from '../formulas/error-card.tsx';
import { useCoarsePointer } from '../app/media-queries.ts';
import { useBottomInset, popupCollisionPadding } from '../shell/bottom-insets.ts';
import { preventMouseDownDefault, IS_APPLE_PLATFORM } from '../ui/dom-events.ts';
import { BarSeparator } from '../ui/bar-buttons.tsx';
import { openLinkHint } from '../i18n/status-labels.ts';
import type { TooltipSide } from '../kit/tooltip.tsx';
import type { PopoverPopupProps } from '../kit/popover.tsx';
import type { IconName } from '../kit/icon.tsx';
import type { PagePoint } from '../comments/page-comments.ts';
import type { CancelableTimer, RunAfter } from '../format/border-pen-hover.ts';
import type { PointerRested, LinkCardLeftByPointer } from '../state/event-reducer.ts';
import type { SheetController } from '../state/controller.ts';
import type { LinkExplainedView } from '../view/page-view.ts';
import type { UrlSplitForDisplay } from './url-display.ts';
import type { PlacedLink } from './cell-links-view.tsx';
/** The links a card shows: the cell they are in, which one is marked, and which are wholly in sight. */
export interface LinksOnCard {
  cellKey: string;
  urls: string[];
  marked: LinkExplainedView['marked'];
  whole: string[];
}
interface LinksShownOnCard extends LinksOnCard {
  sinceMs: number;
  cameAtMs: number;
}
/** What the link card has shown, to tell whether a link was in sight long enough to be opened from it. */
export interface LinkCardSeen {
  shows(links: LinksOnCard | null): boolean;
  startsOver(): void;
  hasShown: (link: PlacedLink) => boolean;
  isNew: () => boolean;
  hasJustCome: () => boolean;
}
/** The mouse over a link in the cells: the element of the link, the point in the page, and the link under it in the text. */
export interface PointerOverLink {
  cell: Element;
  at: PagePoint;
  link?: PointerRested['link'];
}
/** What the mouse watch of the link card sends its events with, and how it waits. */
export interface LinkCardHoverDeps {
  dispatch: (event: PointerRested | LinkCardLeftByPointer) => void;
  after: RunAfter;
}
/** Brings the link card when the mouse rests on a link, and takes it away when the mouse leaves. */
export interface LinkCardHover {
  isOver(pointer: PointerOverLink | null): void;
  isPressed(): void;
  isOnCard(): void;
  isOffCard: () => void;
  cardIsOf(cardOf: string | null): void;
  cardIsInSight(isInSight: boolean): void;
  stop(): void;
}
export function useLinkCardSeen(rootRef: React.RefObject<Element | null>): LinkCardSeen {
  let seen = React.useMemo(() => createLinkCardSeen(), []);
  React.useEffect(() => {
    let ownerDocument = rootRef.current?.ownerDocument;
    let startOver = () => seen.startsOver();
    ownerDocument?.addEventListener('visibilitychange', startOver);
    return () => ownerDocument?.removeEventListener('visibilitychange', startOver);
  }, [seen, rootRef]);
  return seen;
}
export function createLinkCardSeen(now: () => number = () => performance.now()): LinkCardSeen {
  let current: LinksShownOnCard | null = null;
  let isNew = () => current === null || isWithinPressGuard(current.sinceMs, now());
  return {
    shows(links) {
      let [shownBefore, nowMs] = [current, now()];
      if (links === null) current = null;
      else if (shownBefore === null || links.cellKey !== shownBefore.cellKey || !sameItemsInOrder(links.urls, shownBefore.urls))
        current = {
          ...links,
          sinceMs: nowMs,
          cameAtMs: nowMs,
        };
      else if (links.marked !== shownBefore.marked || !sameItemsInOrder(links.whole, shownBefore.whole))
        current = {
          ...shownBefore,
          ...links,
          sinceMs: nowMs,
        };
      return current !== shownBefore;
    },
    startsOver() {
      if (current !== null)
        current = {
          ...current,
          sinceMs: now(),
        };
    },
    hasShown: ({ cellKey, url, isForWords }) =>
      current !== null &&
      current.cellKey === cellKey &&
      current.urls.includes(url) &&
      current.whole.includes(url) &&
      (isForWords !== true || current.urls.length === 1 || current.urls[current.marked ?? -1] === url) &&
      !isNew(),
    isNew,
    hasJustCome: () => current !== null && isWithinPressGuard(current.cameAtMs, now()),
  };
}
export function useLinksWhollyInSight(): [React.RefCallback<HTMLElement>, Map<string, boolean>] {
  let [whollyInSight, setWhollyInSight] = React.useState(new Map<string, boolean>());
  let observerRef = React.useRef<IntersectionObserver | null>(null);
  return [
    React.useCallback((element: HTMLElement | null) => {
      let defaultView = element?.ownerDocument.defaultView ?? null;
      if (element === null || defaultView === null) return;
      observerRef.current ??= new defaultView.IntersectionObserver(
        (observed) =>
          setWhollyInSight((before) => {
            let entries = new Map(before);
            for (let { target, boundingClientRect, intersectionRect } of observed)
              if (target.isConnected) entries.set(addressOfRow(target) ?? '', isWholeLinkInSight(boundingClientRect, intersectionRect));
            return [...entries].every(([address, isWhole]) => before.get(address) === isWhole) ? before : entries;
          }),
        {
          threshold: LINK_VISIBILITY_THRESHOLDS,
        },
      );
      let address = addressOfRow(element) ?? '';
      let forgetRow = () =>
        setWhollyInSight(
          (before) =>
            before.has(address) ? new Map([...before].filter(([addressOfEntry]) => addressOfEntry !== address)) : before,
        );
      forgetRow();
      observerRef.current.observe(element);
      return () => {
        observerRef.current?.unobserve(element);
        forgetRow();
      };
    }, []),
    whollyInSight,
  ];
}
export function scrollableAddressList(cardElement: Element): HTMLElement | null {
  let list = cardElement.querySelector(`[${ROW_OF_ADDRESS_ATTRIBUTE}]`)?.parentElement ?? null;
  return list !== null && list.scrollHeight > list.clientHeight + 1 ? list : null;
}
export function createLinkCardHover(deps: LinkCardHoverDeps): LinkCardHover {
  let { dispatch, after } = deps;
  let cardOf: string | null = null;
  let isCardInSight = false;
  let cardOfMouse: string | null = null;
  let restTimer: { timer: CancelableTimer; cell: Element; from: PagePoint } | null = null;
  let leaveTimer: CancelableTimer | null = null;
  let cellRestedOn: Element | null = null;
  let wasPressed = false;
  let cancelRest = () => {
    restTimer?.timer.cancel();
    restTimer = null;
  };
  let cancelLeave = () => {
    leaveTimer?.cancel();
    leaveTimer = null;
  };
  let leaveCard = (cardLeft: string | null) => {
    if (leaveTimer !== null || (cellRestedOn === null && cardLeft === null)) return;
    let tellLeft = () => {
      leaveTimer = null;
      cellRestedOn = null;
      dispatch({
        kind: 'linkCardLeftByPointer',
        cardOf: cardLeft,
      });
    };
    if (isCardInSight) leaveTimer = after(LINK_CARD_LEAVE_MS, tellLeft);
    else tellLeft();
  };
  return {
    isOver(pointer) {
      if (pointer === null) {
        cancelRest();
        leaveCard(cardOf);
        return;
      }
      cancelLeave();
      let { cell, at, link } = pointer;
      if (restTimer?.cell === cell && Math.hypot(at.x - restTimer.from.x, at.y - restTimer.from.y) <= MOUSE_STILL_SLOP) return;
      cancelRest();
      if (cell === cellRestedOn && !wasPressed) return;
      restTimer = {
        timer: after(LINK_CARD_REST_MS, () => {
          restTimer = null;
          cellRestedOn = cell;
          wasPressed = false;
          dispatch({
            kind: 'pointerRested',
            at,
            ...(link !== undefined && {
              link,
            }),
          });
        }),
        cell,
        from: at,
      };
    },
    isPressed() {
      cancelRest();
      wasPressed = true;
    },
    isOnCard() {
      cancelLeave();
      cardOfMouse = cardOf;
    },
    isOffCard: () => leaveCard(cardOfMouse),
    cardIsOf(cardOfNow) {
      cardOf = cardOfNow;
    },
    cardIsInSight(isInSight) {
      isCardInSight = isInSight;
    },
    stop() {
      cancelRest();
      cancelLeave();
    },
  };
}
export function useLinkCardHover(store: Pick<SheetController, 'dispatch'>, cardOf: string | null): LinkCardHover {
  let hover = React.useMemo(
    () =>
      createLinkCardHover({
        dispatch: (event) => store.dispatch(event),
        after(ms, then) {
          let timeoutId = setTimeout(then, ms);
          return {
            cancel: () => clearTimeout(timeoutId),
          };
        },
      }),
    [store],
  );
  React.useEffect(() => hover.cardIsOf(cardOf), [hover, cardOf]);
  React.useEffect(() => () => hover.stop(), [hover]);
  return hover;
}
export function copyTextWithExecCommand(doc: Document, text: string): boolean {
  let wasCopied = false;
  let onCopy = (event: ClipboardEvent) => {
    event.clipboardData?.setData('text/plain', text);
    wasCopied = event.clipboardData !== null;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  doc.addEventListener('beforecopy', preventDefaultEvent, true);
  doc.addEventListener('copy', onCopy, true);
  try {
    doc.execCommand('copy');
    return wasCopied;
  } finally {
    doc.removeEventListener('beforecopy', preventDefaultEvent, true);
    doc.removeEventListener('copy', onCopy, true);
  }
}
export function createTouchSwipeWatch() {
  let touchDown: { pointerId: number; at: PagePoint } | null = null;
  let wasSwipe = false;
  return {
    cameDown({ pointerType, pointerId, clientX, clientY }: Pick<PointerEvent, 'pointerType' | 'pointerId' | 'clientX' | 'clientY'>): void {
      touchDown =
        pointerType === 'touch'
          ? {
              pointerId,
              at: {
                x: clientX,
                y: clientY,
              },
            }
          : null;
      wasSwipe = false;
    },
    hasBegunToSwipe({ pointerId, clientX, clientY }: Pick<PointerEvent, 'pointerId' | 'clientX' | 'clientY'>): boolean {
      if (touchDown?.pointerId !== pointerId) return false;
      if (Math.hypot(clientX - touchDown.at.x, clientY - touchDown.at.y) < DRAG_START_DISTANCE) return false;
      touchDown = null;
      wasSwipe = true;
      return true;
    },
    wasSwipe: () => wasSwipe,
  };
}
interface BuiltLinkAddressInfoProps {
  isOnTouch: boolean;
}
export function BuiltLinkAddressInfo({ isOnTouch }: BuiltLinkAddressInfoProps) {
  let [isOpen, setOpen] = React.useState(false);
  let tooltipId = React.useId();
  let rootRef = React.useRef<HTMLSpanElement>(null);
  React.useEffect(() => {
    const ownerDocument = rootRef.current?.ownerDocument;
    if (!isOnTouch || !isOpen || ownerDocument === undefined) return;
    let closeOnClickElsewhere = (event: MouseEvent) => {
      if (rootRef.current === null || !event.composedPath().includes(rootRef.current)) setOpen(false);
    };
    ownerDocument.addEventListener('click', closeOnClickElsewhere, true);
    return () => ownerDocument.removeEventListener('click', closeOnClickElsewhere, true);
  }, [isOnTouch, isOpen]);
  return <span ref={rootRef} className={`flex ${isOnTouch ? '-my-1' : '-my-0.5'}`}><Tooltip content={sheetMessages.whyBuiltLinkAddressIsMarked()} side="bottom" sideOffset={({ side }: { side: TooltipSide }) => {
          let infoBox = rootRef.current?.getBoundingClientRect();
          let cardBox = rootRef.current?.closest(`[${LINK_CARD_ATTRIBUTE}]`)?.getBoundingClientRect();
          if (infoBox === undefined || cardBox === undefined) return BUILT_LINK_INFO_OFFSET;
          return BUILT_LINK_INFO_OFFSET + (side === 'top' ? infoBox.top - cardBox.top : cardBox.bottom - infoBox.bottom);
        }} hoverable closeOnClick={false} open={isOpen} onOpenChange={setOpen}><Button variant="ghost" size={isOnTouch ? 'xs' : 'xxs'} iconOnly icon="Info" tooltip={false} tabIndex={-1} aria-label={sheetMessages.aboutBuiltLinkAddress()} aria-describedby={tooltipId} className="text-muted" {...(isOnTouch && {
            'aria-expanded': isOpen,
            onClick: () => setOpen((wasOpen) => !wasOpen),
          })} /></Tooltip><span id={tooltipId} hidden>{sheetMessages.whyBuiltLinkAddressIsMarked()}</span></span>;
}
interface LinkAddressButtonProps {
  url: string;
  isOnTouch: boolean;
  isWrapped: boolean;
  isGivenTwoLines: boolean;
  isBuilt: boolean;
  onOpened: () => void;
  className: string;
  ref: React.Ref<HTMLSpanElement>;
}
export function LinkAddressButton({
  url,
  isOnTouch,
  isWrapped,
  isGivenTwoLines,
  isBuilt,
  onOpened,
  className,
  ref,
}: LinkAddressButtonProps) {
  let { origin, rest, isSiteLong } = splitUrlForDisplay(url);
  let restShown = isGivenTwoLines ? breakableUrl(shortenedUrlRest(url)) : rest;
  let addressText =
    isWrapped || isGivenTwoLines || isOnTouch || isSiteLong
      ? <span className="block wrap-anywhere"><span className="text-primary">{origin.replaceAll('.', '.​')}</span><span className="text-secondary">{restShown}</span></span>
      : <span className="flex min-w-0"><span className="max-w-full flex-none wrap-anywhere text-primary">{origin}</span><span className="truncate text-secondary">{restShown}</span></span>;
  let addressButton = <button type="button" tabIndex={-1} className="block min-w-0 cursor-pointer rounded px-xs py-1 text-start text-footnote leading-5 select-none hover:bg-fill-ghost-hover hover:underline" onClick={onOpened}>{addressText}</button>;
  return <span ref={ref} className={`flex min-w-0 flex-col ${className}`}>{isOnTouch
        ? addressButton
        : <Tooltip content={<LinkUrlText url={url} />} side="top" hoverable={false}>{addressButton}</Tooltip>}{isBuilt &&
        <span className="flex items-center gap-1 px-xs pb-1 text-caption text-muted">{sheetMessages.linkAddressIsBuilt()}<BuiltLinkAddressInfo isOnTouch={isOnTouch} /></span>}</span>;
}
export const linkEditMessages = {
  insertLink: () =>
    translateMessage({
      defaultMessage: 'Add link',
      id: 'cKtNXtBXwr',
    }),
  removeLink: () =>
    translateMessage({
      defaultMessage: 'Remove link',
      id: 'RtcoEMjdsC',
    }),
  whyNoLinkByHand: () =>
    translateMessage({
      defaultMessage: 'This cell holds a formula. To add or change a link, edit the formula.',
      id: 'gijycVhqlA',
    }),
  text: () =>
    translateMessage({
      defaultMessage: 'Text',
      id: 'H1M/OeDin2',
    }),
  link: () =>
    translateMessage({
      defaultMessage: 'Link',
      id: 'kkQos7Tefy',
    }),
  pasteALink: () =>
    translateMessage({
      defaultMessage: 'Paste a link',
      id: 'bvvaAZCFt7',
    }),
  notALink: () =>
    translateMessage({
      defaultMessage: 'That doesn’t look like a link',
      id: '7z29Y4QE1K',
    }),
  linkTooLong: () =>
    translateMessage({
      defaultMessage: 'Link too long',
      id: 'hvWZ9hAVxb',
    }),
  cancel: () =>
    translateMessage({
      defaultMessage: 'Cancel',
      id: 'tWatDbQ50x',
    }),
  save: () =>
    translateMessage({
      defaultMessage: 'Save',
      id: '4OyfNAHVdw',
    }),
};
export const sameItemsInOrder = <Item,>(items: readonly Item[], others: readonly Item[]): boolean =>
  items.length === others.length && items.every((item, index) => item === others[index]);
export const LINK_VISIBILITY_STEPS = 1000;
export const LINK_VISIBILITY_THRESHOLDS = Array.from(
  {
    length: LINK_VISIBILITY_STEPS / 10 + 1,
  },
  (_, step) => (LINK_VISIBILITY_STEPS * 0.9 + step) / LINK_VISIBILITY_STEPS,
);
export const isWholeLinkInSight = (
  bounds: Pick<DOMRectReadOnly, 'width' | 'height'>,
  inSight: Pick<DOMRectReadOnly, 'width' | 'height'>,
): boolean =>
  Math.min(bounds.width, bounds.height) > 0 &&
  Math.max(bounds.width, bounds.height) <= LINK_VISIBILITY_STEPS &&
  bounds.width - inSight.width < 1 &&
  bounds.height - inSight.height < 1;
export const NO_TOUCH_ACTION_CLASSES = 'touch-none [&_*]:touch-none';
export const LINK_CARD_SIDE_OFFSET = 2;
export const LINK_CARD_REST_PADDING = 20;
export const linkCardSide = (roomAbove: number, needed: number): 'top' | 'bottom' =>
  roomAbove >= needed + LINK_CARD_SIDE_OFFSET ? 'top' : 'bottom';
export const LINK_CARD_REST_MS = 300;
export const LINK_CARD_LEAVE_MS = 300;
export const linkElementOf = (target: EventTarget | null): Element | null =>
  target instanceof Element
    ? (target.closest(`[${LINK_AMONG_TEXT_ATTR}]`) ??
      target.closest(`[role=gridcell]:has(:is(${LINK_ELEMENT_SELECTOR}):not([${LINK_AMONG_TEXT_ATTR}]))`))
    : null;
export const linkUnderMouse = ({ pointerType, buttons, target }: Pick<PointerEvent, 'pointerType' | 'buttons' | 'target'>): Element | null =>
  pointerType === 'mouse' && buttons === 0 ? linkElementOf(target) : null;
export const linkAtPointerPoint = ({
  pointerType,
  buttons,
  clientX,
  clientY,
  currentTarget,
}: Pick<React.PointerEvent<Element>, 'pointerType' | 'buttons' | 'clientX' | 'clientY' | 'currentTarget'>): Element | null =>
  pointerType === 'mouse' && buttons === 0 ? linkElementOf(currentTarget.ownerDocument.elementFromPoint(clientX, clientY)) : null;
export const LINK_CARD_ATTRIBUTE = 'data-link-card';
export const ROW_OF_ADDRESS_ATTRIBUTE = 'data-row-of-address';
export const addressOfRow = (element: Element): string | null =>
  element.closest(`[${ROW_OF_ADDRESS_ATTRIBUTE}]`)?.getAttribute(ROW_OF_ADDRESS_ATTRIBUTE) ?? null;
export const scrollDeltaToReveal = (
  bounds: Pick<DOMRectReadOnly, 'top' | 'bottom'>,
  wanted: Pick<DOMRectReadOnly, 'top' | 'bottom'>,
): number =>
  Math.max(Math.min(wanted.bottom - bounds.bottom, wanted.top - bounds.top), 0) -
  Math.max(Math.min(bounds.top - wanted.top, bounds.bottom - wanted.bottom), 0);
export const preventDefaultEvent = (event: Event): void => event.preventDefault();
export const onlyForMouse =
  (action: () => void) =>
  ({ pointerType }: Pick<PointerEvent, 'pointerType'>): void => {
    if (pointerType === 'mouse') action();
  };
interface LinkCardButtonProps {
  icon: IconName;
  label: string;
  detail?: React.ReactNode;
  /** The id of the hidden address the button is about, when the card has several. */
  idOfAddress?: string;
  /** Why the button cannot be used, or null when it can. */
  whyNot?: string | null;
  tooltipSide: TooltipSide;
  onClick: () => void;
}
export const LinkCardButton = ({
  icon,
  label,
  detail,
  idOfAddress,
  whyNot,
  tooltipSide,
  onClick,
}: LinkCardButtonProps) =>
  <Tooltip content={label} detail={detail} side={tooltipSide} hoverable={false}><Button variant="ghost" size="sm" iconOnly icon={icon} tooltip={false} tabIndex={-1} aria-label={label} aria-describedby={idOfAddress} disabled={typeof whyNot === 'string'} disabledReason={whyNot === undefined ? undefined : describeWhyNot(label, whyNot)} disabledReasonSide={tooltipSide} onClick={onClick} /></Tooltip>;
export const BUILT_LINK_INFO_OFFSET = 4;
export const isWholeAddressOffered = (
  cutAmount: UrlSplitForDisplay['leftOut'],
  { isOnTouch, isBuilt }: { isOnTouch: boolean; isBuilt: boolean },
): boolean =>
  cutAmount === 'much' || (cutAmount === 'some' && (isOnTouch || isBuilt));
interface LinkCardProps {
  /** The links of the explained cell, or null when there is no card. */
  urls: LinkExplainedView['urls'] | null;
  urlsOnWords: LinkExplainedView['urlsOnWords'];
  isInWords: boolean | null;
  isBuilt: boolean | null;
  by: LinkExplainedView['by'] | null;
  cellKey: string | null;
  marked: LinkExplainedView['marked'];
  isHeldBack: boolean;
  isBroughtByFingerOrPen: boolean;
  anchor: PopoverPopupProps['anchor'];
  roomAbove: number;
  seen: LinkCardSeen;
  mouse: Pick<LinkCardHover, 'cardIsInSight' | 'isOnCard' | 'isOffCard'>;
  onLinkOpened: (url: string) => void;
  onLinkCopied: (url: string) => void;
  onEditChosen: ((url: string) => void) | null;
  onRemoveChosen: ((url: string) => void) | null;
  onPressedTooSoon: () => void;
  /** Takes a turn of the wheel the card does not scroll; answers whether it was used. */
  onWheelTurned: (event: WheelEvent) => boolean;
  /** Answers whether the cells take the finger that came down on the card. */
  onFingerCameDown: () => boolean;
  onSwipedByFinger: (pointerId: number) => void;
}
export const LinkCard = React.memo(function ({
  urls,
  urlsOnWords,
  isInWords,
  isBuilt,
  by,
  cellKey,
  marked,
  isHeldBack,
  isBroughtByFingerOrPen,
  anchor,
  roomAbove,
  seen,
  mouse,
  onLinkOpened,
  onLinkCopied,
  onEditChosen,
  onRemoveChosen,
  onPressedTooSoon,
  onWheelTurned,
  onFingerCameDown,
  onSwipedByFinger,
}: LinkCardProps) {
  let isShownNow = useCardShownAfterDelay(cellKey, by) || marked !== null;
  const isOpen = urls !== null && isShownNow && !isHeldBack;
  React.useEffect(() => mouse.cardIsInSight(isOpen), [mouse, isOpen]);
  const shownUrls: LinkCardProps['urls'] = useLastNonNull(urls);
  let shownCellKey: string | null = useLastNonNull(cellKey);
  let shownIsInWords: boolean | null = useLastNonNull(isInWords);
  let shownIsBuilt = useLastNonNull(isBuilt) === true;
  let shownUrlsOnWords: LinkCardProps['urlsOnWords'] = useLastNonNull(urls === null ? null : urlsOnWords) ?? [];
  let isOnTouch = useCoarsePointer() || isBroughtByFingerOrPen;
  let cardKey = `${shownCellKey} ${shownUrls?.join(' ')}`;
  const [onlyUrl = null] = shownUrls?.length === 1 ? shownUrls : [];
  const leftOut = onlyUrl === null ? 'nothing' : splitUrlForDisplay(onlyUrl).leftOut;
  let isWholeOffered = isWholeAddressOffered(leftOut, {
    isOnTouch,
    isBuilt: shownIsBuilt,
  });
  let urlsGivenTwoLines = urlsShownAlike(shownUrls ?? []);
  let [wholeShownAt, setWholeShownAt] = React.useState<number | null>(null);
  let openKey = isOpen ? cardKey : null;
  let [lastOpenKey, setLastOpenKey] = React.useState(openKey);
  if (lastOpenKey !== openKey) {
    setLastOpenKey(openKey);
    if (openKey !== null) setWholeShownAt(null);
  }
  let isWholeShown = isWholeOffered && wholeShownAt !== null;
  let [cardHeight, setCardHeight] = React.useState(0);
  const side: ReturnType<typeof linkCardSide> =
    useLastNonNull(urls === null || (isWholeShown && wholeShownAt === roomAbove) ? null : linkCardSide(roomAbove, cardHeight)) ?? 'top';
  let idBase = React.useId();
  let addressId = (index: number) => `${idBase}-address-${index}`;
  let bottomInset = useBottomInset();
  let pressRef = React.useRef<{ atMs: number; hadCardJustCome: boolean } | null>(null);
  let [swipeWatch] = React.useState(createTouchSwipeWatch);
  let isFingerDownTaken = React.useRef(false);
  let [rowRef, wholeInSight] = useLinksWhollyInSight();
  let urlsWhollySeen = React.useMemo(
    () => (urls ?? []).filter((url) => wholeInSight.get(url) === true),
    [urls, wholeInSight],
  );
  React.useLayoutEffect(() => {
    if (
      seen.shows(
        isOpen && cellKey !== null
          ? {
              cellKey,
              urls,
              marked,
              whole: urlsWhollySeen,
            }
          : null,
      )
    )
      pressRef.current = null;
  }, [isOpen, cellKey, urls, marked, urlsWhollySeen, seen]);
  let whyKeptBack = (url: string) =>
    isInWords === true && wholeInSight.get(url) === false ? sheetMessages.whyLinkIsKeptBack() : null;
  let cardRef = React.useRef<HTMLDivElement | null>(null);
  let shownMarked: number | null = useLastNonNull(urls === null ? null : (marked ?? -1));
  React.useLayoutEffect(() => {
    if (!isOpen || cardHeight === 0) return;
    let markedRow = marked === null ? null : cardRef.current?.querySelector(`[${ROW_OF_ADDRESS_ATTRIBUTE}][data-is-marked]`);
    let addressList = markedRow?.parentElement ?? null;
    if (markedRow !== null && markedRow !== undefined && addressList !== null)
      addressList.scrollTop += scrollDeltaToReveal(addressList.getBoundingClientRect(), markedRow.getBoundingClientRect());
  }, [marked, isOpen, cardHeight]);
  let wholeRef = React.useRef<HTMLDivElement>(null);
  let rowElementRef = React.useRef<HTMLDivElement>(null);
  let [rowHeight, setRowHeight] = React.useState(0);
  let wholeStyle: React.CSSProperties & Record<'--sheet-rest-of-link-card', string> = {
    '--sheet-rest-of-link-card': `${rowHeight + LINK_CARD_REST_PADDING}px`,
  };
  let cardRefCallback = React.useCallback(
    (element: HTMLDivElement | null) => {
      cardRef.current = element;
      let defaultView = element?.ownerDocument.defaultView ?? null;
      if (element === null || defaultView === null) return;
      let measure = () => {
        setCardHeight(element.offsetHeight);
        setRowHeight(rowElementRef.current?.offsetHeight ?? 0);
      };
      measure();
      let resizeObserver = new defaultView.ResizeObserver(() => ReactDOM.flushSync(measure));
      resizeObserver.observe(element);
      let onWheel = (event: WheelEvent) => {
        let current = wholeRef.current;
        if (
          current !== null &&
          current.scrollHeight > current.clientHeight &&
          event.composedPath().includes(current) &&
          Math.abs(event.deltaY) >= Math.abs(event.deltaX) &&
          !(event.ctrlKey || event.altKey || event.shiftKey || event.metaKey)
        )
          return;
        let addressList = scrollableAddressList(element);
        if (addressList !== null && event.deltaY !== 0) {
          let { scrollTop, clientHeight, scrollHeight } = addressList;
          if (event.deltaY < 0 ? scrollTop <= 0 : scrollTop + clientHeight >= scrollHeight - 1) event.preventDefault();
          return;
        }
        if (onWheelTurned(event)) event.preventDefault();
      };
      element.addEventListener('wheel', onWheel, {
        passive: false,
      });
      return () => {
        resizeObserver.disconnect();
        element.removeEventListener('wheel', onWheel);
      };
    },
    [onWheelTurned],
  );
  return <Popover.Root open={isOpen}><Popover.Popup ref={cardRefCallback} anchor={anchor} side={side} align="start" sideOffset={LINK_CARD_SIDE_OFFSET} collisionPadding={popupCollisionPadding(bottomInset)} padding="xs" scrollFade={false} initialFocus={false} finalFocus={false} keepFocus aria-label={sheetMessages.link()} className={`flex max-w-[min(420px,calc(100vw-16px))] ${isWholeShown && side === 'top' ? 'flex-col-reverse' : 'flex-col'} ${onlyUrl === null ? 'gap-1' : NO_TOUCH_ACTION_CLASSES}`} {...{
        [LINK_CARD_ATTRIBUTE]: true,
      }} onMouseDown={preventMouseDownDefault} onPointerEnter={onlyForMouse(mouse.isOnCard)} onPointerLeave={onlyForMouse(mouse.isOffCard)} onScrollCapture={(event) => {
        if (event.target !== wholeRef.current) seen.startsOver();
      }} onPointerDownCapture={(event) => {
        pressRef.current = seen.isNew()
          ? {
              atMs: performance.now(),
              hadCardJustCome: seen.hasJustCome(),
            }
          : null;
        swipeWatch.cameDown(event);
        isFingerDownTaken.current = event.pointerType === 'touch' && event.isPrimary && onFingerCameDown();
      }} onPointerMove={(event) => {
        if (!swipeWatch.hasBegunToSwipe(event)) return;
        let isInWhole = event.target instanceof Node && wholeRef.current?.contains(event.target) === true;
        if (onlyUrl !== null && !isInWhole) onSwipedByFinger(event.pointerId);
      }} onClickCapture={(event) => {
        let press = pressRef.current;
        pressRef.current = null;
        if (event.detail > 0 && (swipeWatch.wasSwipe() || isFingerDownTaken.current)) return event.stopPropagation();
        if (press === null || !isWithinClickAfterUp(press.atMs, performance.now())) return;
        event.stopPropagation();
        if (press.hadCardJustCome) onPressedTooSoon();
      }}>{shownUrls?.map((url, index) => {
          let isRowWrapped = isWholeOffered || splitUrlForDisplay(url).isSiteLong;
          let tooltipSide: TooltipSide = isRowWrapped ? 'bottom' : 'top';
          return (<div key={`${shownCellKey} ${shownIsBuilt} ${url}`} ref={onlyUrl === null ? null : rowElementRef} className={`flex items-start gap-1 rounded-lg ${isRowWrapped ? 'flex-wrap' : ''} data-[highlighted]:bg-fill-ghost-selected ${MENU_ITEM_FORCED_COLORS_HIGHLIGHT_CLASSES}`} data-highlighted={index === shownMarked || undefined} data-is-marked={index === shownMarked || undefined} {...{
                [ROW_OF_ADDRESS_ATTRIBUTE]: url,
              }}><LinkAddressButton ref={rowRef} className={isRowWrapped ? 'basis-full' : 'flex-1'} url={url} isOnTouch={isOnTouch} isWrapped={shownIsInWords === true} isGivenTwoLines={urlsGivenTwoLines.includes(url)} isBuilt={shownIsBuilt} onOpened={() => onLinkOpened(url)} /><div className="flex flex-none items-center gap-1">{isWholeOffered &&
                      <Button variant="ghost" size="sm" tabIndex={-1} icon={isWholeShown === (side === 'top') ? 'CaretDown' : 'CaretUp'} aria-expanded={isWholeShown} onClick={() => setWholeShownAt(isWholeShown ? null : roomAbove)}>{sheetMessages.wholeLinkAddress()}</Button>}{(isWholeOffered || !isRowWrapped) && <BarSeparator />}{shownUrls.length > 1 &&
                      <span id={addressId(index)} hidden>{url}</span>}<TooltipGroup><LinkCardButton icon="ArrowOutSquare" label={sheetMessages.openLink()} detail={openLinkHint(IS_APPLE_PLATFORM)} {...(shownUrls.length > 1 && {
                            idOfAddress: addressId(index),
                          })} whyNot={whyKeptBack(url)} tooltipSide={tooltipSide} onClick={() => onLinkOpened(url)} /><LinkCardButton icon="Copy" label={sheetMessages.copyLinkAddress()} {...(shownUrls.length > 1 && {
                            idOfAddress: addressId(index),
                          })} whyNot={whyKeptBack(url)} tooltipSide={tooltipSide} onClick={() => onLinkCopied(url)} />{onEditChosen !== null &&
                          (shownUrlsOnWords.includes(url) ||
                          index === shownUrls.findIndex((urlOfRow) => !shownUrlsOnWords.includes(urlOfRow))
                            ? (<LinkCardButton icon="Edit" label={sheetMessages.editLink()} {...(shownUrls.length > 1 &&
                                  shownUrlsOnWords.includes(url) && {
                                    idOfAddress: addressId(index),
                                  })} tooltipSide={tooltipSide} onClick={() => onEditChosen(url)} />)
                            : <span className="size-7 flex-none" />)}{onRemoveChosen !== null &&
                          (shownUrlsOnWords.includes(url) || shownUrlsOnWords.length === 0
                            ? (<LinkCardButton icon="Disconnect" label={linkEditMessages.removeLink()} {...(shownUrls.length > 1 && {
                                  idOfAddress: addressId(index),
                                })} tooltipSide={tooltipSide} onClick={() => onRemoveChosen(url)} />)
                            : <span className="size-7 flex-none" />)}</TooltipGroup></div></div>);
        })}{isWholeShown &&
          onlyUrl !== null &&
          <div ref={wholeRef} style={wholeStyle} className={`touch-pan-y! max-h-[max(48px,min(160px,calc(var(--available-height)-var(--sheet-rest-of-link-card))))] overflow-y-auto overscroll-contain border-alpha-2 px-xs py-1.5 text-footnote wrap-anywhere text-secondary ${side === 'top' ? 'mb-1.5 border-b' : 'mt-1.5 border-t'}`}>{breakableUrlText(onlyUrl)}</div>}</Popover.Popup></Popover.Root>;
});
