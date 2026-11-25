import type { ListLine } from '@open-artifact/sheets-core';
import type { FontToMeasure, TextToMeasure } from '../state/controller.ts';
import type { WrappedTextPart } from './wrapped-rows.ts';
import { cellFontStyle, MONO_FONT_FAMILY } from './cell-drawing.tsx';
import { nextLineHeight } from './cell-metrics-values.ts';
import { NO_LIST } from '../editor/text-looks.ts';
import { listAttributesOf } from '../ui/cell-list-attributes.ts';
import { listLineGaps } from './cell-metrics.ts';
/** A text whose wrapped lines are counted in the page, with its bold or italic parts and the levels of its list lines. */
export interface TextToMeasureInPage extends Omit<TextToMeasure, 'parts' | 'levelsInLists'> {
  parts?: readonly WrappedTextPart[];
  levelsInLists?: readonly (number | null)[];
}
export function createDomTextMeasurer(counterElement: HTMLElement, maxCachedLineCounts: number = MAX_CACHED_LINE_COUNTS) {
  let ownerDocument = counterElement.ownerDocument;
  let lineCounts = new Map<string, number>();
  let typedTextKey: string | undefined;
  let characterWidthsByFont = new Map<string, Map<string, number>>();
  let sampleElement = ownerDocument.createElement('span');
  sampleElement.className = 'sheet-wrapped-text-sample';
  sampleElement.textContent = 'abcdefghijklmnopqrstuvwxyz 0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let measuringBox = ownerDocument.createElement('div');
  counterElement.replaceChildren(sampleElement, measuringBox);
  let isShown = () => counterElement.getClientRects().length > 0;
  let sampleWidth = () => sampleElement.getBoundingClientRect().width;
  let lastSampleWidth: number | null = null;
  let wasMeasureSkipped = false;
  function createMeasuredElement(className: string, text: string, font: FontToMeasure) {
    let element = ownerDocument.createElement('div');
    element.className = className;
    let {
      fontFamily,
      fontSize,
      fontWeight,
      fontStyle,
    } = cellFontStyle({
      ...font,
      underline: 'none',
      strikethrough: false,
      color: {
        kind: 'none',
      },
    });
    Object.assign(element.style, {
      fontFamily: fontFamily ?? '',
      fontSize: `${fontSize}px`,
      lineHeight: `${nextLineHeight(font.size)}px`,
      fontWeight: fontWeight ?? '',
      fontStyle: fontStyle ?? '',
    });
    element.textContent = text;
    return element;
  }
  function partsFragment(parts: readonly WrappedTextPart[]) {
    let fragment = ownerDocument.createDocumentFragment();
    for (let { text, bold, italic } of parts) {
      let span = ownerDocument.createElement('span');
      span.textContent = text;
      if (bold) span.style.fontWeight = '700';
      if (italic) span.style.fontStyle = 'italic';
      fragment.append(span);
    }
    return fragment;
  }
  function listLinesFragment(parts: readonly WrappedTextPart[], levelsInLists: readonly (number | null)[]) {
    let fragment = ownerDocument.createDocumentFragment();
    let lines: WrappedTextPart[][] = [[]];
    for (let part of parts)
      part.text
        .split(
          `
`,
        )
        .forEach((text, index) => {
          if (index > 0) lines.push([]);
          lines.at(-1)?.push({
            ...part,
            text,
          });
        });
    lines.forEach((lineParts, lineIndex) => {
      let line = ownerDocument.createElement('div');
      line.className = 'sheet-line-in-cell';
      let level = levelsInLists[lineIndex] ?? null;
      let list: ListLine =
        level === null
          ? NO_LIST
          : {
              kind: 'bullet',
              level,
            };
      for (let [name, value] of Object.entries<string>(
        listAttributesOf({
          list,
          number: null,
        }),
      ))
        line.setAttribute(name, value);
      line.replaceChildren(partsFragment(lineParts));
      fragment.append(line);
    });
    return fragment;
  }
  function measureInBox(elements: readonly HTMLElement[], readSizes: () => void) {
    if (!isShown()) {
      wasMeasureSkipped = true;
      return;
    }
    let fragment = ownerDocument.createDocumentFragment();
    for (let element of elements) fragment.append(element);
    measuringBox.replaceChildren(fragment);
    lastSampleWidth ??= sampleWidth();
    readSizes();
    measuringBox.replaceChildren();
  }
  function measureLineCounts(texts: readonly TextToMeasureInPage[]) {
    let elements = texts.map((wrappedText) => {
      let element = createMeasuredElement('sheet-wrapped-text', wrappedText.text, wrappedText.font);
      let parts = wrappedText.parts ?? [
        {
          text: wrappedText.text,
          bold: false,
          italic: false,
        },
      ];
      if (wrappedText.levelsInLists !== undefined) element.replaceChildren(listLinesFragment(parts, wrappedText.levelsInLists));
      else if (wrappedText.parts !== undefined) element.replaceChildren(partsFragment(parts));
      if (wrappedText.isFormulaTyped === true) element.style.fontFamily = MONO_FONT_FAMILY;
      element.style.width = `${wrappedText.widthInPixels}px`;
      return element;
    });
    measureInBox(
      elements,
      () =>
        texts.forEach((wrappedText, index) => {
          let height = (elements[index]?.getBoundingClientRect().height ?? 0) - listLineGaps(wrappedText.levelsInLists?.length ?? 1);
          let lineCount = Math.round(height / nextLineHeight(wrappedText.font.size));
          lineCounts.set(wrappedTextMeasureKey(wrappedText), Math.max(1, lineCount));
        }),
    );
  }
  return {
    lineCountsOfWrappedTexts(texts: readonly TextToMeasureInPage[]) {
      let keys = texts.map(wrappedTextMeasureKey);
      let unmeasured = new Map<string, TextToMeasureInPage>();
      texts.forEach((wrappedText, index) => {
        let key = keys[index];
        if (key !== undefined && !lineCounts.has(key)) unmeasured.set(key, wrappedText);
      });
      let excess = lineCounts.size + unmeasured.size - maxCachedLineCounts;
      if (unmeasured.size > 0 && excess > 0) {
        let keysInUse = new Set(keys);
        for (let cachedKey of lineCounts.keys()) {
          if (excess === 0) break;
          if (keysInUse.has(cachedKey)) continue;
          lineCounts.delete(cachedKey);
          excess -= 1;
        }
      }
      if (unmeasured.size > 0) measureLineCounts([...unmeasured.values()]);
      let lineCountsOut = keys.map((key) => lineCounts.get(key) ?? 1);
      let typedKey = keys[texts.findIndex(({ isStillTyped }) => isStillTyped === true)];
      if (typedKey !== undefined && typedKey !== typedTextKey) {
        if (typedTextKey !== undefined) lineCounts.delete(typedTextKey);
        typedTextKey = typedKey;
      }
      return lineCountsOut;
    },
    widthOfCharacters(characters: string, font: FontToMeasure) {
      let fontKey = wrappedTextMeasureKey({
        text: '',
        font,
        widthInPixels: 0,
      });
      let widths = characterWidthsByFont.get(fontKey) ?? new Map<string, number>();
      let sumKnownWidths = () => {
        let total = 0;
        for (let character of characters) {
          let width = widths.get(character);
          if (width === undefined) return null;
          total += width;
        }
        return total;
      };
      let knownWidth = sumKnownWidths();
      if (knownWidth !== null) return knownWidth;
      if (!isShown()) {
        wasMeasureSkipped = true;
        return 0;
      }
      characterWidthsByFont.set(fontKey, widths);
      let unmeasured = [...new Set(characters)].filter((character) => !widths.has(character));
      let elements = unmeasured.map((character) => createMeasuredElement('sheet-character-measured', character, font));
      measureInBox(
        elements,
        () =>
          unmeasured.forEach(
            (character, index) => widths.set(character, elements[index]?.getBoundingClientRect().width ?? 0),
          ),
      );
      return sumKnownWidths() ?? 0;
    },
    onTextMeasuredAnew(onMeasuredAnew: () => void) {
      let measureAnew = () => {
        if (lineCounts.size + characterWidthsByFont.size === 0 && !wasMeasureSkipped) return;
        lineCounts.clear();
        characterWidthsByFont.clear();
        lastSampleWidth = null;
        wasMeasureSkipped = false;
        onMeasuredAnew();
      };
      ownerDocument.fonts.addEventListener('loadingdone', measureAnew);
      let resizeObserver =
        ownerDocument.defaultView === null
          ? null
          : new ownerDocument.defaultView.ResizeObserver(() => {
              if (!isShown()) return;
              if (wasMeasureSkipped || sampleWidth() !== lastSampleWidth) measureAnew();
            });
      resizeObserver?.observe(sampleElement);
      return () => {
        ownerDocument.fonts.removeEventListener('loadingdone', measureAnew);
        resizeObserver?.disconnect();
      };
    },
  };
}
export const MAX_CACHED_LINE_COUNTS = 1e5;
export const wrappedTextMeasureKey = ({
  text,
  font: { size, bold, italic },
  widthInPixels,
  isFormulaTyped,
  parts = [],
  levelsInLists = [],
}: TextToMeasureInPage): string => {
  let partKeys = parts.map((part) => `${part.text.length}${part.bold ? 'b' : ''}${part.italic ? 'i' : ''}`);
  return `${size} ${bold} ${italic} ${isFormulaTyped === true} ${widthInPixels} ${partKeys.join()} ${levelsInLists.join()} ${text}`;
};
