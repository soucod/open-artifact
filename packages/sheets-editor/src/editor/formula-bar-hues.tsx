import * as React from 'react';
import { referenceTintStyle } from '../grid/cell-drawing.tsx';
import type { PaneRect } from '../grid/geometry.ts';
import type { BracketPair } from '../state/initial-state.ts';
import type { CaretSpan } from '../keys/key-acts.ts';
/** A reference in the formula typed, with its hue and where it is written in the text. */
export interface HuedReference {
  hue: string;
  writtenAt?: CaretSpan;
}
/** A box drawn under or over a reference written in the formula bar, in its hue. */
export type ReferencePatch = PaneRect & Pick<HuedReference, 'hue'>;
export interface FormulaBarReferenceHuesProps {
  text: string;
  references: readonly HuedReference[];
  brackets: BracketPair | null;
  box: React.RefObject<HTMLElement | null>;
}
export let REFERENCE_PATCH_BLEED_PX: number;
export let REFERENCE_PATCH_GAP_PX: number;
export function widenReferencePatches<Patch extends PaneRect>(patches: readonly Patch[]): Patch[] {
  let bleedBetween = (patch: PaneRect | undefined, nextPatch: PaneRect | undefined): number =>
    patch === undefined || nextPatch === undefined || patch.top !== nextPatch.top
      ? REFERENCE_PATCH_BLEED_PX
      : Math.max(0, Math.min(REFERENCE_PATCH_BLEED_PX, (nextPatch.left - patch.left - patch.width - REFERENCE_PATCH_GAP_PX) / 2));
  return patches.map((patch, index) => {
    let [bleedBefore, bleedAfter] = [bleedBetween(patches[index - 1], patch), bleedBetween(patch, patches[index + 1])];
    return {
      ...patch,
      left: patch.left - bleedBefore,
      width: patch.width + bleedBefore + bleedAfter,
    };
  });
}
export function patchElementOfBox(box: PaneRect, ownerDocument: Document, className: string): HTMLDivElement {
  let patchElement = ownerDocument.createElement('div');
  patchElement.className = className;
  for (let property of ['left', 'top', 'width', 'height'] satisfies (keyof PaneRect)[]) patchElement.style.setProperty(property, `${box[property]}px`);
  return patchElement;
}
export function referencePatchesInText(
  textNode: Node,
  text: string,
  { start, end }: CaretSpan,
  origin: Pick<DOMRect, 'left' | 'top'>,
): PaneRect[] {
  let ownerDocument = textNode.ownerDocument;
  if (
    ownerDocument === null ||
    textNode.nodeValue !==
      `${text}
` ||
    end > text.length
  )
    return [];
  let range = ownerDocument.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, end);
  return [...range.getClientRects()]
    .filter((rect) => rect.width > 0)
    .map(
      (rect) => ({
        left: rect.left - origin.left,
        top: rect.top - origin.top,
        width: rect.width,
        height: rect.height,
      }),
    );
}
export function useFollowScrollOfBox(
  scrollerRef: React.RefObject<HTMLElement | null>,
  followerRefs: readonly React.RefObject<HTMLElement | null>[],
): void {
  React.useLayoutEffect(() => {
    let scroller = scrollerRef.current;
    if (scroller === null) return;
    let follow = () => {
      let translate = `${-scroller.scrollLeft}px ${-scroller.scrollTop}px`;
      for (let { current: follower } of followerRefs) follower?.style.setProperty('translate', translate);
    };
    follow();
    scroller.addEventListener('scroll', follow);
    return () => scroller.removeEventListener('scroll', follow);
  });
}
export function FormulaBarReferenceHues({ text, references, brackets, box }: FormulaBarReferenceHuesProps) {
  let mirroredText = `${text}
`;
  let fillLayerRef = React.useRef<HTMLDivElement>(null);
  let hueLayerRef = React.useRef<HTMLDivElement>(null);
  let mirrorRef = React.useRef<HTMLSpanElement>(null);
  React.useLayoutEffect(() => {
    let [field, textNode] = [box.current, mirrorRef.current?.firstChild ?? null];
    let [fillLayer, hueLayer] = [fillLayerRef.current, hueLayerRef.current];
    let view = field?.ownerDocument.defaultView ?? null;
    if (field === null || textNode === null || view === null) return;
    if (fillLayer === null || hueLayer === null) return;
    let placeLayers = () => {
      let style = view.getComputedStyle(field);
      for (let layer of [fillLayer.parentElement, hueLayer.parentElement]) {
        for (let property of MIRRORED_FIELD_STYLES) layer?.style.setProperty(property, style.getPropertyValue(property));
        let offsetParent = layer?.offsetParent;
        if (offsetParent === null || offsetParent === undefined) continue;
        let [fieldRect, parentRect] = [field.getBoundingClientRect(), offsetParent.getBoundingClientRect()];
        for (let [property, px] of [
          ['left', fieldRect.left - parentRect.left - offsetParent.clientLeft],
          ['top', fieldRect.top - parentRect.top - offsetParent.clientTop],
          ['width', fieldRect.width],
          ['height', fieldRect.height],
        ] satisfies [string, number][])
          layer?.style.setProperty(property, `${px}px`);
      }
      fillLayer.style.setProperty('translate', 'none');
      let origin = fillLayer.getBoundingClientRect();
      let patches = references.flatMap(
        ({ writtenAt, hue }) =>
          writtenAt === undefined
            ? []
            : referencePatchesInText(textNode, text, writtenAt, origin).map(
                (patch) =>
                  Object.assign(patch, {
                    hue,
                  }),
              ),
      );
      let bracketPatches = (brackets === null ? [] : [brackets.opensAt, brackets.closesAt]).flatMap(
        (at) =>
          referencePatchesInText(
            textNode,
            text,
            {
              start: at,
              end: at + 1,
            },
            origin,
          ),
      );
      let ownerDocument = field.ownerDocument;
      fillLayer.replaceChildren(
        ...referencePatchElements(widenReferencePatches(patches), ownerDocument, 'sheet-fill-under-reference'),
        ...bracketPatches.map((patch) => patchElementOfBox(patch, ownerDocument, 'sheet-fill-under-bracket')),
      );
      hueLayer.replaceChildren(...referencePatchElements(patches, ownerDocument, 'sheet-hue-over-reference'));
      let scrollTranslate = `${-field.scrollLeft}px ${-field.scrollTop}px`;
      for (let layer of [fillLayer, hueLayer]) layer.style.setProperty('translate', scrollTranslate);
    };
    placeLayers();
    let resizeObserver = new view.ResizeObserver(placeLayers);
    resizeObserver.observe(field);
    field.addEventListener('focus', placeLayers);
    field.addEventListener('blur', placeLayers);
    field.ownerDocument.fonts.addEventListener('loadingdone', placeLayers);
    return () => {
      resizeObserver.disconnect();
      field.removeEventListener('focus', placeLayers);
      field.removeEventListener('blur', placeLayers);
      field.ownerDocument.fonts.removeEventListener('loadingdone', placeLayers);
    };
  }, [box, text, references, brackets]);
  useFollowScrollOfBox(box, [fillLayerRef, hueLayerRef]);
  return <><div aria-hidden translate="no" className="sheet-entry-in-hues sheet-hues-in-formula-bar" data-draws="fills"><span ref={mirrorRef}>{mirroredText}</span><div ref={fillLayerRef} className="sheet-patches-on-entry" /></div><div aria-hidden translate="no" className="sheet-entry-in-hues sheet-hues-in-formula-bar" data-draws="hues"><div ref={hueLayerRef} className="sheet-patches-on-entry" /></div></>;
}
[REFERENCE_PATCH_BLEED_PX, REFERENCE_PATCH_GAP_PX] = [1, 1];
export const referencePatchElements = (patches: readonly ReferencePatch[], ownerDocument: Document, className: string): HTMLDivElement[] =>
  patches.map((patch) => {
    let patchElement = patchElementOfBox(patch, ownerDocument, className);
    for (let [property, propertyValue] of Object.entries(referenceTintStyle(patch.hue)))
      patchElement.style.setProperty(property, propertyValue);
    return patchElement;
  });
export const BOX_SIDES = ['top', 'right', 'bottom', 'left'];
export const MIRRORED_FIELD_STYLES = [
  'box-sizing',
  ...BOX_SIDES.map((side) => `padding-${side}`),
  ...BOX_SIDES.map((side) => `border-${side}-width`),
  'border-bottom-left-radius',
  'border-bottom-right-radius',
  'direction',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'font-stretch',
  'font-kerning',
  'font-optical-sizing',
  'font-feature-settings',
  'font-variation-settings',
  'font-variant-ligatures',
  'font-variant-numeric',
  'letter-spacing',
  'word-spacing',
  'line-height',
  'tab-size',
  'text-indent',
  'text-rendering',
  'text-transform',
  'mask-image',
  'mask-clip',
  'mask-composite',
  'mask-origin',
  'mask-position',
  'mask-repeat',
  'mask-size',
  'z-index',
];
