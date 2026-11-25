import * as React from 'react';
import { safeLinkUrl, shortenUrlMiddle, MAX_SHOWN_LINK_LENGTH } from './cell-links.ts';
import { isOpenLinkShortcut, githubReferenceOf } from './url-display.ts';
import { IS_APPLE_PLATFORM } from '../ui/dom-events.ts';
import { DRAG_START_DISTANCE } from '../grid/geometry.ts';
import { githubLinkKindLabel, githubLinkTitle } from '../i18n/status-labels.ts';
import type { GithubReference } from './url-display.ts';
import type { IconName } from '../kit/icon.tsx';
import type { KeyPress } from '../state/event-reducer.ts';
import type { PageView } from '../view/page-view.ts';
import type { SheetController } from '../state/controller.ts';
import type { PagePoint } from '../comments/page-comments.ts';
import type { LinkCardSeen } from './link-hover-card.tsx';
/** A link in the words or text of a cell, told by the key of the cell. */
export interface LinkCellPlace {
  cellKey: string;
  /** Set when the link is on words, so a card of several links must have it marked. */
  isForWords?: boolean;
}
/** Where a link was opened from: typed as the cell's whole address, or within the words or text of a cell. */
export type LinkPlace = 'typed' | LinkCellPlace;
/** A link at its place in a cell, as asked of the link card. */
export interface PlacedLink extends LinkCellPlace {
  url: string;
}
/** Opens a link from where it is; answers whether it was opened. */
export type LinkOpenedAt = (url: string, place: LinkPlace) => boolean;
/** What a key that opens links needs from the page. */
export interface LinkOpener {
  open: LinkOpenedAt;
  askForCard: () => void;
  isCardHeldBack: boolean;
}
/** Asks the link card for the link among text under the pointer. */
export type LinkCardAskedAtPointer = (linkElement: Element, pointer: Pick<MouseEvent, 'clientX' | 'clientY'>) => void;
/** The keys held with a click or a key press. */
export type HeldModifierKeys = Pick<MouseEvent, 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>;
/** What a press on a link in the cells came to. */
export type LinkPressOutcome = 'showsCardFirst' | 'isForCells' | 'opensLink';
interface LinkPress {
  url: string;
  pointerId: number;
  isOnlyToShowCard: boolean;
  at: PagePoint;
}
export let lastOpenedLink: { url: string; atMs: number };
export function openLinkInNewTab(url: string): void {
  let safeUrl = safeLinkUrl(url);
  if (safeUrl === null) return;
  let nowMs = performance.now();
  if (safeUrl === lastOpenedLink.url && nowMs - lastOpenedLink.atMs < REPEAT_LINK_OPEN_MS) return;
  lastOpenedLink = {
    url: safeUrl,
    atMs: nowMs,
  };
  let anchor = document.createElement('a');
  anchor.href = safeUrl;
  anchor.target = '_blank';
  anchor.relList.add('noopener', 'noreferrer');
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
export function openLinkFromKey(
  event: Pick<KeyboardEvent, 'preventDefault' | 'repeat'>,
  key: KeyPress,
  {
    mode,
    linkOfActiveCell,
    linkInWordsOfActiveCell,
    linksAmongTextOfActiveCell,
    linkExplained,
  }: Pick<PageView, 'mode' | 'linkOfActiveCell' | 'linkInWordsOfActiveCell' | 'linksAmongTextOfActiveCell' | 'linkExplained'>,
  { open, askForCard, isCardHeldBack }: LinkOpener,
  mayEnterOpen: boolean = true,
): boolean {
  let isShortcut = isOpenLinkShortcut(mode, key);
  let isPlainEnter = mayEnterOpen && key.key === 'Enter' && !key.isShiftHeld && !key.isModifierHeld && !key.isAltHeld;
  let markedUrl = isCardHeldBack ? undefined : linkExplained?.urls[linkExplained.marked ?? -1];
  if (linkExplained !== null && markedUrl !== undefined && (isShortcut || isPlainEnter)) {
    event.preventDefault();
    if (!event.repeat) open(markedUrl, linkExplained);
    return true;
  }
  let linkInWords = isCardHeldBack ? null : linkInWordsOfActiveCell;
  let linksAmongText = isCardHeldBack ? null : linksAmongTextOfActiveCell;
  if ((linkOfActiveCell ?? linkInWords ?? linksAmongText) === null || !isShortcut) return false;
  event.preventDefault();
  if (event.repeat) return true;
  let [firstUrl, ...otherUrls] = linksAmongText?.urls ?? [];
  if (linkOfActiveCell !== null) open(linkOfActiveCell, 'typed');
  else if (linkInWords !== null && !open(linkInWords.url, linkInWords)) askForCard();
  else if (linksAmongText !== null && firstUrl !== undefined) {
    if (otherUrls.length > 0 || !open(firstUrl, linksAmongText)) askForCard();
  }
  return true;
}
export function shouldShowLinkCardFirst(element: Element, hasShown: LinkCardSeen['hasShown']): boolean {
  let urlInWords = element.getAttribute(LINK_URL_ATTR) === null ? element.getAttribute(LINK_IN_WORDS_ATTR) : null;
  return (
    urlInWords !== null &&
    !hasShown({
      ...linkCellKeyOf(element),
      url: urlInWords,
    })
  );
}
export function createLinkPressHandler(
  openLink: LinkOpenedAt,
  { hasShown }: Pick<LinkCardSeen, 'hasShown'>,
  showCard: LinkCardAskedAtPointer,
) {
  let press: LinkPress | null = null;
  return {
    pressed(event: React.PointerEvent<Element>, isTakenElsewhere: boolean): LinkPressOutcome {
      let linkElement = event.button === 0 && !isTakenElsewhere ? closestLinkElement(event.target) : null;
      let url = linkElement?.getAttribute(LINK_URL_ATTR) ?? linkElement?.getAttribute(LINK_IN_WORDS_ATTR) ?? null;
      let isOpenClick = isOpenLinkClick(event, IS_APPLE_PLATFORM);
      let isAmongText = linkElement?.hasAttribute(LINK_AMONG_TEXT_ATTR) === true;
      let pressedUrl = isOpenClick || isAmongText ? url : null;
      let showsCardFirst = isOpenClick && linkElement !== null && shouldShowLinkCardFirst(linkElement, hasShown);
      press =
        pressedUrl === null || showsCardFirst
          ? null
          : {
              url: pressedUrl,
              pointerId: event.pointerId,
              isOnlyToShowCard: !isOpenClick,
              at: {
                x: event.clientX,
                y: event.clientY,
              },
            };
      if (press === null) return showsCardFirst ? 'showsCardFirst' : 'isForCells';
      let defaultView = event.currentTarget.ownerDocument.defaultView;
      let controller = new AbortController();
      let forgetPress = () => {
        press = null;
        controller.abort();
      };
      for (let eventType of ['pointerup', 'pointercancel', 'blur'] as const)
        defaultView?.addEventListener(eventType, forgetPress, {
          signal: controller.signal,
        });
      defaultView?.addEventListener('pointerdown', forgetPress, {
        signal: controller.signal,
        capture: true,
      });
      return isOpenClick ? 'opensLink' : 'isForCells';
    },
    letGo(event: React.PointerEvent<Element>, isTakenElsewhere: boolean): void {
      if (press?.pointerId !== event.pointerId || isTakenElsewhere || event.button !== 0) return;
      let { clientX, clientY, currentTarget } = event;
      let linkElement = closestLinkElement(currentTarget.ownerDocument.elementFromPoint(clientX, clientY));
      let isSameUrlInWords = linkElement?.getAttribute(LINK_IN_WORDS_ATTR) === press.url;
      if (press.isOnlyToShowCard) {
        if (
          Math.hypot(clientX - press.at.x, clientY - press.at.y) < DRAG_START_DISTANCE &&
          linkElement !== null &&
          isSameUrlInWords &&
          linkElement.hasAttribute(LINK_AMONG_TEXT_ATTR)
        )
          showCard(linkElement, {
            clientX,
            clientY,
          });
      } else if (linkElement?.getAttribute(LINK_URL_ATTR) === press.url) openLink(press.url, 'typed');
      else if (isSameUrlInWords) openLink(press.url, linkCellKeyOf(linkElement));
    },
  };
}
export function watchLinkPressCursor(
  gridElement: HTMLElement,
  { hasShown }: Pick<LinkCardSeen, 'hasShown'>,
  opensNone: () => boolean,
  isApplePlatform: boolean = IS_APPLE_PLATFORM,
): () => void {
  let controller = new AbortController();
  let { signal } = controller;
  let pointerAt: PagePoint | null = null;
  let markedElement: Element | null = null;
  let markLinkUnder = (event: KeyboardEvent | PointerEvent | null, findLinkElement: () => Element | null) => {
    let linkElement =
      event !== null && hasModifierKeys(event) && isOpenLinkClick(event, isApplePlatform) && !opensNone() ? findLinkElement() : null;
    let elementToMark = linkElement !== null && !shouldShowLinkCardFirst(linkElement, hasShown) ? linkElement : null;
    if (elementToMark === markedElement) return;
    markedElement?.removeAttribute(PRESS_OPENS_LINK_ATTR);
    elementToMark?.setAttribute(PRESS_OPENS_LINK_ATTR, '');
    markedElement = elementToMark;
  };
  let linkUnderPointer = () =>
    pointerAt === null ? null : closestLinkElement(gridElement.ownerDocument.elementFromPoint(pointerAt.x, pointerAt.y));
  let onPointer = (event: PointerEvent) => {
    pointerAt =
      hasPointerPosition(event) && event.buttons === 0
        ? {
            x: event.clientX,
            y: event.clientY,
          }
        : null;
    if (pointerAt === null) markLinkUnder(event, () => markedElement);
    else markLinkUnder(event, event.type === 'pointerenter' ? linkUnderPointer : () => closestLinkElement(event.target));
  };
  let clearMark = () => markLinkUnder(null, () => null);
  let defaultView = gridElement.ownerDocument.defaultView;
  for (let eventType of ['keydown', 'keyup'] as const)
    defaultView?.addEventListener(
      eventType,
      (event) => markLinkUnder(event, pointerAt === null ? () => markedElement : linkUnderPointer),
      {
        signal,
        capture: true,
      },
    );
  defaultView?.addEventListener('blur', clearMark, {
    signal,
  });
  for (let eventType of ['pointermove', 'pointerenter'] as const)
    gridElement.addEventListener(eventType, onPointer, {
      signal,
    });
  gridElement.addEventListener(
    'pointerleave',
    () => {
      pointerAt = null;
      clearMark();
    },
    {
      signal,
    },
  );
  gridElement.addEventListener('wheel', clearMark, {
    signal,
    passive: true,
  });
  return () => {
    controller.abort();
    clearMark();
  };
}
/** How a link to a pull request or an issue is drawn: as a chip with an icon and a title. */
export interface GithubLinkFace {
  icon: IconName;
  iconInWords: string;
  words: string;
}
export function githubLinkFace(url: string): GithubLinkFace | null {
  let githubReference = githubReferenceOf(url);
  return githubReference === null
    ? null
    : {
        icon: GITHUB_LINK_ICONS[githubReference.kind].icon,
        iconInWords: githubLinkKindLabel(githubReference.kind),
        words: githubLinkTitle(githubReference),
      };
}
export const LINK_URL_ATTR = 'data-link-url';
export const LINK_IN_WORDS_ATTR = 'data-link-in-words';
export const LINK_CELL_ATTR = 'data-link-cell';
export const LINK_AMONG_TEXT_ATTR = 'data-is-among-text';
export const LINK_ELEMENT_SELECTOR = `[${LINK_URL_ATTR}], [${LINK_IN_WORDS_ATTR}]`;
export const closestLinkElement = (target: EventTarget | null): Element | null => (target instanceof Element ? target.closest(LINK_ELEMENT_SELECTOR) : null);
export const isOpenLinkClick = (
  { metaKey, ctrlKey, shiftKey, altKey }: HeldModifierKeys,
  isApplePlatform: boolean,
): boolean => (metaKey || (ctrlKey && !isApplePlatform)) && !shiftKey && !altKey;
export const REPEAT_LINK_OPEN_MS = 500;
lastOpenedLink = {
  url: '',
  atMs: Number.NEGATIVE_INFINITY,
};
export const linkPlaceOfUrl = (linkExplained: PageView['linkExplained'], url: string): LinkPlace | null => {
  if (linkExplained?.urls.includes(url) !== true) return null;
  return linkExplained.isInWords
    ? {
        cellKey: linkExplained.cellKey,
      }
    : 'typed';
};
export const openLinkUnlessCommentMode =
  (controller: Pick<SheetController, 'getView' | 'dispatch'>, openLink: (url: string) => void = openLinkInNewTab) =>
  (url: string): void => {
    if (controller.getView().isCommentModeOn)
      controller.dispatch({
        kind: 'linkHeldByCommentMode',
      });
    else openLink(url);
  };
export const openLinkIfShown =
  ({ hasShown }: Pick<LinkCardSeen, 'hasShown'>, openLink: (url: string) => void = openLinkInNewTab): LinkOpenedAt =>
  (url, place) => {
    if (
      place !== 'typed' &&
      !hasShown({
        ...place,
        url,
      })
    )
      return false;
    openLink(url);
    return true;
  };
export const linkCellKeyOf = (element: Element | null): LinkCellPlace => ({
  cellKey: element?.getAttribute(LINK_CELL_ATTR) ?? '',
  isForWords: true,
});
export const PRESS_OPENS_LINK_ATTR = 'data-press-opens-link';
export const hasModifierKeys = (event: Event): boolean =>
  'metaKey' in event && 'ctrlKey' in event && 'shiftKey' in event && 'altKey' in event;
export const hasPointerPosition = (event: Event): boolean => 'clientX' in event && 'clientY' in event && 'buttons' in event;
/** What the cursor over links in the cells watches: the cells, what the link card has shown, and whether a press opens no link now. */
export interface LinkPressCursorWatched {
  gridRef: React.RefObject<HTMLElement | null>;
  card: Pick<LinkCardSeen, 'hasShown'>;
  opensNone: () => boolean;
}
export const useLinkPressCursor = ({ gridRef, card, opensNone }: LinkPressCursorWatched): void =>
  React.useEffect(() => {
    let gridElement = gridRef.current;
    return gridElement === null ? undefined : watchLinkPressCursor(gridElement, card, opensNone);
  }, [gridRef, card, opensNone]);
export const useLinkPressHandler = (
  openLink: LinkOpenedAt,
  card: Pick<LinkCardSeen, 'hasShown'>,
  showCard: LinkCardAskedAtPointer,
) =>
  React.useMemo(() => createLinkPressHandler(openLink, card, showCard), [openLink, card, showCard]);
export const GITHUB_LINK_ICONS: Record<GithubReference['kind'], { icon: IconName }> = {
  pullRequest: {
    icon: 'GitPullRequest',
  },
  issue: {
    icon: 'Ticket',
  },
};
export const OPEN_LINK_SHORTCUT = 'alt+enter';
export const LINK_DESCRIPTION_ID = 'link-description';
export const LINK_ADDRESS_ID = 'link-address';
export const linksInTextDescriptionId = (count: number): string => `links-in-text-description-${count}`;
export const breakableUrl = (url: string): string => url.replaceAll(/[/?&#=](?!\/)/g, '$&​');
export const shortBreakableUrl = (url: string): string => breakableUrl(shortenUrlMiddle(90, url));
export const breakableUrlText = (url: string): string => breakableUrl(url);
interface LinkUrlTextProps {
  url: string;
}
export const LinkUrlText = ({ url }: LinkUrlTextProps) =>
  <span className="wrap-anywhere">{breakableUrl(shortenUrlMiddle(MAX_SHOWN_LINK_LENGTH, url))}</span>;
interface CellLinkSpanProps {
  url: string;
  /** The key of the cell for a link on its words, or null for a link that is the cell's typed address. */
  cellKeyOfWords: string | null;
  isAmongText?: boolean;
  isOnWords?: boolean;
  holdsChip?: boolean;
  children: React.ReactNode;
}
export const CellLinkSpan = ({
  url,
  cellKeyOfWords,
  isAmongText = false,
  isOnWords = false,
  holdsChip = false,
  children,
}: CellLinkSpanProps) =>
  <span className={isAmongText ? 'sheet-link-among-text' : 'sheet-link'} {...(cellKeyOfWords === null && !isAmongText
      ? {
          [LINK_URL_ATTR]: url,
        }
      : {
          [LINK_IN_WORDS_ATTR]: url,
          [LINK_CELL_ATTR]: cellKeyOfWords ?? '',
        })} {...{
      [LINK_AMONG_TEXT_ATTR]: isAmongText || undefined,
    }} data-is-on-words={isOnWords || undefined} data-holds-chip={holdsChip || undefined}>{children}</span>;
