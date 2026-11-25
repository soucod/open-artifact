import * as React from 'react';
export function giveUpPopupAround(element: unknown) {
  for (let node = isElementLike(element) ? element : null; node !== null; node = node.parentElement) {
    let giveUp = popupGiveUpHandlers.get(node);
    if (giveUp !== undefined) return giveUp();
  }
}
export function usePopupGivenUpOnBlur(isOpen: boolean, giveUp: () => void) {
  let [isGivenUp, setIsGivenUp] = React.useState(false);
  if (!isOpen && isGivenUp) setIsGivenUp(false);
  let wasFocusedRef = React.useRef(false);
  let latestRef = React.useRef({
    isOpen,
    giveUp,
  });
  React.useLayoutEffect(() => {
    latestRef.current = {
      isOpen,
      giveUp,
    };
  });
  React.useLayoutEffect(() => {
    if (!isOpen) return;
    wasFocusedRef.current = false;
    let takeBack = () => setIsGivenUp(false);
    window.addEventListener('focus', takeBack);
    return () => window.removeEventListener('focus', takeBack);
  }, [isOpen]);
  let [handlers] = React.useState(
    () => ({
      holdPopup: (popup: HTMLElement | null) => {
        if (popup === null) return;
        registerPopupGiveUp(popup, () => {
          if (!latestRef.current.isOpen || wasFocusedRef.current) return;
          setIsGivenUp(true);
          latestRef.current.giveUp();
        });
      },
      noteFocus: () => {
        wasFocusedRef.current = true;
      },
    }),
  );
  return {
    isGivenUp,
    ...handlers,
  };
}
export function useShutOnWindowBlur(isOpen: boolean, shut: () => void) {
  let [isShut, setIsShut] = React.useState(false);
  if (!isOpen && isShut) setIsShut(false);
  let wasFocusedRef = React.useRef(false);
  let shutUnlessFocused = React.useEffectEvent(() => {
    if (wasFocusedRef.current || document.activeElement instanceof HTMLIFrameElement) return;
    setIsShut(true);
    shut();
  });
  React.useLayoutEffect(() => {
    if (!isOpen) return;
    wasFocusedRef.current = false;
    let onBlur = () => shutUnlessFocused();
    let onFocus = () => setIsShut(false);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, [isOpen]);
  let [noteFocus] = React.useState(
    () => () => {
      wasFocusedRef.current = true;
    },
  );
  return {
    isShut,
    noteFocus,
  };
}
export const CanTakeFocusContext = React.createContext<() => boolean>(() => false);
/** Whether a value has a parent element to walk up from (the `this` of a call to `focus` may be the window). */
export const isElementLike = (input: unknown): input is Node => typeof input === 'object' && input !== null && 'parentElement' in input;
export const popupGiveUpHandlers = new WeakMap<Node, () => void>();
export const registerPopupGiveUp = (popup: Node, giveUp: () => void) => void popupGiveUpHandlers.set(popup, giveUp);
