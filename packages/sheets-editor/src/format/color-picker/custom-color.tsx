import { TextInput } from '../../kit/text-input.tsx';
import { Tooltip } from '../../kit/tooltip.tsx';
import type { Color } from '@open-artifact/sheets-core';
import * as React from 'react';
import { PAGE_BACKGROUND_COLORS, PAGE_TEXT_COLORS } from '../cell-colors.ts';
import { DEFAULT_CELL_FONT_STYLE } from '../../grid/cell-drawing.tsx';
import type { ChipPaints, PaintPair, StyleWithVariables } from '../../grid/cell-drawing.tsx';
import { sheetMessages } from '../../i18n/sheet-messages.ts';
import { hexToHsb, hsbToHex, normalizeHexColor } from '../hsb-colors.ts';
import type { Hsb } from '../hsb-colors.ts';
/** What a color is tried on in the picker: a cell or a dropdown option's pill, its text, and the colors it takes on with a color. */
export interface ColorSample {
  shape: 'cell' | 'pill';
  text: string;
  paintsWith: (color: Color) => ChipPaints;
}
export interface ColorSamplePreviewProps {
  sample: ColorSample;
  color: Color;
}
export interface CustomColorPickerProps {
  /** The color, `#rrggbb`, the picker starts at. */
  startsAt: string;
  sample: ColorSample;
  onChosen: (color: Color) => void;
}
export function stopKeyUnlessTabOrEscape(event: React.KeyboardEvent) {
  if (event.key !== 'Tab' && event.key !== 'Escape') event.stopPropagation();
}
export function ColorSamplePreview({ sample, color }: ColorSamplePreviewProps) {
  let paints = sample.paintsWith(color);
  let [fill, text] = [paints.fill ?? PAGE_BACKGROUND_COLORS, paints.text ?? PAGE_TEXT_COLORS];
  let sampleSpan = (page: keyof PaintPair, label: string) =>
    <span className="sheet-color-sample" data-on={page} style={{
        backgroundColor: PAGE_BACKGROUND_COLORS[page],
      }}><span className="sheet-color-sample-label">{label}</span><span className={sample.shape === 'pill' ? 'sheet-color-sample-cell font-medium' : 'sheet-color-sample-cell'} data-shape={sample.shape} style={{
            ...DEFAULT_CELL_FONT_STYLE,
            backgroundColor: fill[page],
            color: text[page],
          }}>{sample.text}</span></span>;
  return <div aria-hidden className="sheet-color-samples">{sampleSpan('onLight', sheetMessages.onLightSheet())}{sampleSpan('onDark', sheetMessages.onDarkSheet())}</div>;
}
export function CustomColorPicker(props: CustomColorPickerProps) {
  let { startsAt, sample, onChosen } = props;
  let [hsb, setHsb] = React.useState(() => hexToHsb(startsAt, 0));
  let hsbRef = React.useRef(hsb);
  let [hexTyped, setHexTyped] = React.useState<string | null>(null);
  let isChangeUnsent = React.useRef(false);
  let [pointersDown, setPointersDown] = React.useState<number[]>([]);
  let isPointerDown = pointersDown.length > 0;
  let [isSampleShown, setSampleShown] = React.useState(false);
  let rootRef = React.useRef<HTMLDivElement>(null);
  let hex = hsbToHex(hsb);
  let color: Color = {
    kind: 'rgb',
    hex,
  };
  let changeHsb = (changed: Hsb) => {
    hsbRef.current = changed;
    isChangeUnsent.current = true;
    setHsb(changed);
    setHexTyped(null);
  };
  let sendChange = () => {
    if (!isChangeUnsent.current) return;
    isChangeUnsent.current = false;
    onChosen({
      kind: 'rgb',
      hex: hsbToHex(hsbRef.current),
    });
  };
  let moveOnSquare = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    let bounds = event.currentTarget.getBoundingClientRect();
    changeHsb({
      hue: hsbRef.current.hue,
      saturation: clampToRange(0, (event.clientX - bounds.left) / bounds.width, 1),
      brightness: clampToRange(0, 1 - (event.clientY - bounds.top) / bounds.height, 1),
    });
  };
  let commitHexTyped = () => {
    let typedHex = hexTyped === null ? null : normalizeHexColor(hexTyped);
    if (typedHex === null) return;
    changeHsb(hexToHsb(typedHex, hsbRef.current.hue));
    isChangeUnsent.current = false;
    onChosen({
      kind: 'rgb',
      hex: typedHex,
    });
  };
  let notePointerDown = (event: React.PointerEvent) => {
    if (event.button === 0) setPointersDown((pointerIds) => [...pointerIds, event.pointerId]);
  };
  React.useEffect(() => {
    let win = rootRef.current?.ownerDocument.defaultView ?? null;
    if (!isPointerDown || win === null) return;
    let notePointerUp = (event: PointerEvent) => {
      if (event.type === 'pointermove' && event.buttons !== 0) return;
      let { pointerId } = event;
      setPointersDown(
        (pointerIds) => (pointerIds.includes(pointerId) ? pointerIds.filter((id) => id !== pointerId) : pointerIds),
      );
    };
    let eventTypes = ['pointerup', 'pointercancel', 'pointermove'] satisfies (keyof WindowEventMap)[];
    for (let eventType of eventTypes) win.addEventListener(eventType, notePointerUp);
    return () => {
      for (let eventType of eventTypes) win.removeEventListener(eventType, notePointerUp);
    };
  }, [isPointerDown]);
  let onRangeKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    stopKeyUnlessTabOrEscape(event);
    if (/^(Arrow|Page|Home|End)/.test(event.key)) setSampleShown(true);
    if (event.key !== 'Escape' || !isSampleShown || isPointerDown || isChangeUnsent.current) return;
    event.preventDefault();
    event.stopPropagation();
    setSampleShown(false);
  };
  let squareStyle: StyleWithVariables = {
    '--sheet-hue-of-square': `hsl(${String(hsb.hue)} 100% 50%)`,
  };
  return <div ref={rootRef} className="sheet-custom-color" onFocus={({ target }) => setSampleShown(target.matches('input[type=range]:focus-visible'))} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setSampleShown(false);
    }}><div className="sheet-color-square" style={squareStyle} onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          notePointerDown(event);
          moveOnSquare(event);
        }} onPointerMove={moveOnSquare} onPointerUp={(event) => {
          moveOnSquare(event);
          sendChange();
        }} onPointerCancel={sendChange}><span aria-hidden className="sheet-color-handle" style={{
              left: `${String(hsb.saturation * 100)}%`,
              top: `${String((1 - hsb.brightness) * 100)}%`,
              backgroundColor: hex,
            }} />{(['saturation', 'brightness'] satisfies (keyof Hsb)[]).map(
            (axis) =>
              (<input key={axis} type="range" className="sr-only" aria-label={sheetMessages[axis]()} min={0} max={100} value={Math.round(hsb[axis] * 100)} onChange={(event) =>
                    changeHsb({
                      ...hsbRef.current,
                      [axis]: Number(event.target.value) / 100,
                    })} onKeyDown={onRangeKeyDown} onKeyUp={sendChange} />),
          )}</div><input type="range" className="sheet-hue-slider" aria-label={sheetMessages.hue()} min={0} max={359} value={Math.round(hsb.hue)} onChange={(event) =>
          changeHsb({
            ...hsbRef.current,
            hue: Number(event.target.value),
          })} onKeyDown={onRangeKeyDown} onKeyUp={sendChange} onPointerDown={notePointerDown} onPointerUp={sendChange} /><TextInput size="sm" aria-label={sheetMessages.hex()} aria-invalid={hexTyped !== null && normalizeHexColor(hexTyped) === null} spellCheck={false} autoComplete="off" autoCapitalize="off" autoCorrect="off" value={hexTyped ?? hex.toUpperCase()} onChange={(event) => setHexTyped(event.target.value)} onBlur={() => setHexTyped(null)} onKeyDown={(event) => {
          stopKeyUnlessTabOrEscape(event);
          if (event.key === 'Enter') commitHexTyped();
        }} /><Tooltip anchor={() => rootRef.current?.closest('[role=dialog]') ?? rootRef.current} open={isPointerDown || isSampleShown} side="right" align="start" sideOffset={8} className="p-xs" content={<ColorSamplePreview sample={sample} color={color} />} /></div>;
}
export const clampToRange = (min: number, value: number, max: number): number => Math.min(max, Math.max(min, value));
