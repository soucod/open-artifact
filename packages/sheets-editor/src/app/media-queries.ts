import { subscribeSheetMedia, usesCoarsePointer } from '../kit/platform.ts';
import * as React from 'react';
export const matchesNothingOnServer = () => false;
export const useCoarsePointer = () => React.useSyncExternalStore(subscribeSheetMedia, usesCoarsePointer, matchesNothingOnServer);
export const COARSE_POINTER_MEDIA = '(pointer:coarse)';
export const subscribeToCoarsePointer = (onChange: () => void) => {
  let query = matchMedia(COARSE_POINTER_MEDIA);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
export const useCoarsePointerMedia = () =>
  React.useSyncExternalStore(subscribeToCoarsePointer, () => matchMedia(COARSE_POINTER_MEDIA).matches, matchesNothingOnServer);
export const isCoarsePointerNow = () => matchMedia(COARSE_POINTER_MEDIA).matches;
export const NARROW_TOUCH_QUERY = [COARSE_POINTER_MEDIA, '(width < 600px)'].join(' and ');
export const subscribeNarrowTouch = (onChange: () => void) => {
  let query = matchMedia(NARROW_TOUCH_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
export const isNarrowByTouch = () => matchMedia(NARROW_TOUCH_QUERY).matches;
export const useNarrowByTouch = () => React.useSyncExternalStore(subscribeNarrowTouch, isNarrowByTouch, matchesNothingOnServer);
export const TOUCH_BELOW_SM_QUERY = [COARSE_POINTER_MEDIA, '(max-width:639.98px)'].join(' and ');
export const subscribeTouchBelowSm = (onChange: () => void) => {
  let query = matchMedia(TOUCH_BELOW_SM_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
export const isTouchBelowSm = () => matchMedia(TOUCH_BELOW_SM_QUERY).matches;
export const useTouchBelowSm = () => React.useSyncExternalStore(subscribeTouchBelowSm, isTouchBelowSm, matchesNothingOnServer);
export const COMPACT_LAYOUT_QUERY = ['(max-width:767.98px)', `${COARSE_POINTER_MEDIA} and (max-width:1023.98px)`].join(',');
export const subscribeCompactLayout = (onChange: () => void) => {
  let query = matchMedia(COMPACT_LAYOUT_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
export const isCompactLayout = () => matchMedia(COMPACT_LAYOUT_QUERY).matches;
export const useCompactLayout = () => React.useSyncExternalStore(subscribeCompactLayout, isCompactLayout, matchesNothingOnServer);
export const hasAnyCoarsePointer = () => usesCoarsePointer() || matchMedia('(any-pointer:coarse)').matches;
export const useAnyCoarsePointer = () =>
  React.useSyncExternalStore(subscribeSheetMedia, hasAnyCoarsePointer, matchesNothingOnServer);
export const PHONE_DEVICE_QUERY = ['(max-device-width:599px)', '(max-device-height:599px)']
  .map((deviceQuery) => [COARSE_POINTER_MEDIA, deviceQuery].join(' and '))
  .join(',');
export const isOnPhone = () => matchMedia(PHONE_DEVICE_QUERY).matches;
export const useOnPhone = () => React.useSyncExternalStore(subscribeToCoarsePointer, isOnPhone, matchesNothingOnServer);
export const NARROW_PHONE_QUERY = PHONE_DEVICE_QUERY.split(',')
  .map((deviceQuery) => [deviceQuery, '(width < 600px)'].join(' and '))
  .join(',');
export const subscribeNarrowPhone = (onChange: () => void) => {
  let query = matchMedia(NARROW_PHONE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
export const useNarrowPhone = () =>
  React.useSyncExternalStore(subscribeNarrowPhone, () => matchMedia(NARROW_PHONE_QUERY).matches, matchesNothingOnServer);
