import type { LayerCloser } from './frame-chrome.ts';
/** Tells the frame how to close the topmost layer of the page, or that there is none to close. */
export type TopLayerCloseOfferer = (close: LayerCloser | null) => void;
export let offerTopLayerClose: TopLayerCloseOfferer;
export function pushTopLayerClose(offerClose: LayerCloser): () => void {
  topLayerClosers.push(offerClose);
  offerCloseOfTopmostLayer();
  return () => {
    let index = topLayerClosers.indexOf(offerClose);
    if (index >= 0) topLayerClosers.splice(index, 1);
    offerCloseOfTopmostLayer();
  };
}
export function setTopLayerCloseOfferer(offerer: TopLayerCloseOfferer): void {
  offerTopLayerClose = offerer;
  offerCloseOfTopmostLayer();
}
export const topLayerClosers: LayerCloser[] = [];
offerTopLayerClose = () => {};
export const offerCloseOfTopmostLayer = (): void => offerTopLayerClose(topLayerClosers.at(-1) ?? null);
