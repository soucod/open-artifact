import { prefersReducedMotion } from '../kit/platform.ts';
import * as React from 'react';
import { getKeyboardInset, subscribeBottomInsets } from './bottom-insets.ts';
export interface WindowSize {
  width: number;
  height: number;
}
/** Whether the sheet tabs have gone from the foot of the page, as they do on a phone while typing. */
export interface TabsAway {
  areTabsAway: boolean;
  isFrameShortened: boolean;
}
/** A slide of an element up or down, from one offset to another, in pixels. */
export interface Slide {
  from: number;
  to: number;
  isKeyboardComing: boolean;
}
/** Where an element is, leaving out the offset of a slide under way. */
export interface PlaceWithoutSlide {
  top: number;
  height: number;
  /** How far the slide has moved the element down. */
  under: number;
}
export let phoneTouchMedia: MediaQueryList | undefined;
export let cachedWindowSize: WindowSize | null;
export function useTabsAway(isAskedAway: boolean): TabsAway {
  let isPhoneTouch = usePhoneTouch();
  let isKeyboardUp = useIsKeyboardUp();
  let windowSize = useWindowSize();
  let [areTabsAway, setTabsAway] = React.useState(false);
  let [fullWindowSize, setFullWindowSize] = React.useState(windowSize);
  let keptFullSize = keptFullWindowSize(fullWindowSize, windowSize, isAskedAway || areTabsAway);
  if (keptFullSize !== fullWindowSize) setFullWindowSize(keptFullSize);
  let isShortened = isFrameShortenedBy(keptFullSize, windowSize);
  let shouldTabsGo = isPhoneTouch && (isKeyboardUp || isShortened) && (isAskedAway || areTabsAway);
  if (shouldTabsGo !== areTabsAway) setTabsAway(shouldTabsGo);
  return {
    areTabsAway: shouldTabsGo,
    isFrameShortened: shouldTabsGo && isShortened,
  };
}
export function slideFromTo(
  element: Element,
  { from, to, isKeyboardComing }: Slide,
  keyframeStyle: Keyframe = {},
): void {
  slideAnimations.get(element)?.cancel();
  if (from === to || prefersReducedMotion()) return;
  let style = getComputedStyle(element);
  let cssValue = (property: string, fallback: string): string => {
    let propertyValue = style.getPropertyValue(property).trim();
    return propertyValue === '' ? fallback : propertyValue;
  };
  let duration = cssValue('--ui-dur-sheet', '300ms');
  let animation = element.animate(
    [
      {
        ...keyframeStyle,
        transform: `translateY(${from}px)`,
      },
      {
        ...keyframeStyle,
        transform: `translateY(${to}px)`,
      },
    ],
    {
      duration: Number.parseFloat(duration) * (duration.endsWith('ms') ? 1 : 1000),
      easing: isKeyboardComing ? cssValue('--ui-ease-out', 'ease-out') : SLIDE_EASING,
    },
  );
  slideAnimations.set(element, animation);
}
export function placeWithoutSlide(element: Element): PlaceWithoutSlide {
  let [{ top, height }, slideOffset] = [element.getBoundingClientRect(), slideOffsetNow(element)];
  return {
    top: top - slideOffset,
    height,
    under: slideOffset,
  };
}
export function watchKeyboardSlides(frame: HTMLElement | null): (() => void) | undefined {
  let overGrid = frame?.querySelector('.sheet-over-grid') ?? null;
  let tabs = frame?.querySelector('.sheet-bar') ?? null;
  if (frame === null || overGrid === null || tabs === null) return;
  let measure = () => {
    if (tabs.getClientRects().length === 0) return null;
    let card = frame.querySelector('.sheet-foot');
    return {
      roomUnderLayout: getKeyboardInset(),
      heightOfFrame: frame.ownerDocument.documentElement.clientHeight,
      areTabsAway: frame.hasAttribute('data-are-tabs-away'),
      card: card === null ? null : placeWithoutSlide(card),
      tabs: placeWithoutSlide(tabs),
    };
  };
  let last = measure();
  let observer = new ResizeObserver(() => {
    let [before, after] = [last, measure()];
    last = after;
    if (before === null || after === null || !getPhoneTouchMedia().matches) return;
    if (before.roomUnderLayout === after.roomUnderLayout && before.areTabsAway === after.areTabsAway) return;
    let isKeyboardComing = after.roomUnderLayout > before.roomUnderLayout || after.heightOfFrame < before.heightOfFrame;
    let card = frame.querySelector('.sheet-foot');
    if (card !== null && before.card !== null && after.card !== null) {
      let cardFrom = bottomOfPlace(before.card) - bottomOfPlace(after.card) + after.card.under;
      slideFromTo(card, {
        from: cardFrom,
        to: 0,
        isKeyboardComing,
      });
    }
    let tabsFrom = before.tabs.top - after.tabs.top + after.tabs.under;
    if (after.areTabsAway && !before.areTabsAway && Math.abs(tabsFrom) > 0.5)
      slideFromTo(
        tabs,
        {
          from: tabsFrom,
          to: tabsFrom + before.tabs.height,
          isKeyboardComing,
        },
        {
          visibility: 'visible',
        },
      );
    else if (!after.areTabsAway && !before.areTabsAway)
      slideFromTo(tabs, {
        from: tabsFrom,
        to: 0,
        isKeyboardComing,
      });
    else slideAnimations.get(tabs)?.cancel();
  });
  observer.observe(frame.ownerDocument.body);
  observer.observe(overGrid);
  return () => observer.disconnect();
}
export const SMALL_DEVICE_QUERY = ['(max-device-width:599px)', '(max-device-height:599px)'].join(' or ');
export const PHONE_TOUCH_QUERY = ['(pointer:coarse)', `(${SMALL_DEVICE_QUERY})`].join(' and ');
export const getPhoneTouchMedia = (): MediaQueryList => (phoneTouchMedia ??= matchMedia(PHONE_TOUCH_QUERY));
export const subscribePhoneTouch = (onChange: () => void): (() => void) => (
  getPhoneTouchMedia().addEventListener('change', onChange),
  () => getPhoneTouchMedia().removeEventListener('change', onChange)
);
export const falseOnServer = (): boolean => false;
export const usePhoneTouch = (): boolean =>
  React.useSyncExternalStore(subscribePhoneTouch, () => getPhoneTouchMedia().matches, falseOnServer);
export const useIsKeyboardUp = (): boolean =>
  React.useSyncExternalStore(subscribeBottomInsets, () => getKeyboardInset() > 0, falseOnServer);
export const ZERO_WINDOW_SIZE: WindowSize = {
  width: 0,
  height: 0,
};
cachedWindowSize = null;
export const readWindowSize = (): WindowSize =>
  (cachedWindowSize = {
    width: innerWidth,
    height: innerHeight,
  });
export const subscribeWindowResize = (onResize: () => void): (() => void) => {
  let onWindowResize = () => {
    readWindowSize();
    if (getPhoneTouchMedia().matches) onResize();
  };
  addEventListener('resize', onWindowResize);
  return () => removeEventListener('resize', onWindowResize);
};
export const useWindowSize = (): WindowSize =>
  React.useSyncExternalStore(
    subscribeWindowResize,
    () => cachedWindowSize ?? readWindowSize(),
    () => ZERO_WINDOW_SIZE,
  );
export const KEYBOARD_HEIGHT_MIN = 150;
export const isFrameShortenedBy = (fullSize: WindowSize, size: WindowSize): boolean => fullSize.height - size.height >= KEYBOARD_HEIGHT_MIN;
export const keptFullWindowSize = (kept: WindowSize, size: WindowSize, mayKeep: boolean): WindowSize =>
  mayKeep && size.width === kept.width && size.height < kept.height ? kept : size;
export const slideAnimations = new WeakMap<Element, Animation>();
export const slideOffsetNow = (element: Element): number =>
  slideAnimations.get(element)?.playState === 'running' ? new DOMMatrixReadOnly(getComputedStyle(element).transform).m42 : 0;
export const SLIDE_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';
export const bottomOfPlace = ({ top, height }: PlaceWithoutSlide): number => top + height;
