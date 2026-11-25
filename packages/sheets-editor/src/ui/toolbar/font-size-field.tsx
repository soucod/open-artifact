import * as React from 'react';
import { typeASizeLabel, FontSizeItems, fontSizeRangeMessage, type SharedFormatMenuProps } from './text-menus.tsx';
import type { MenuFieldEntered } from '../menu-with-field.tsx';
import { fontSizesMatchingTyped, SMALLEST_FONT_SIZE, LARGEST_FONT_SIZE } from '../../format/toolbar-size-choices.ts';
import { menuMatchCountChooseRowWords } from '../../messages/command-search.ts';
export function useFontSizeField(props: SharedFormatMenuProps) {
  let [typed, setTyped] = React.useState('');
  let [isEntered, setIsEntered] = React.useState(false);
  return {
    name: typeASizeLabel(),
    typed,
    onTyped(text: string) {
      setIsEntered(false);
      setTyped(text);
    },
    isOverNumbers: true,
    hasRowsAtRest: true,
    renderRowsFor: (text: string) =>
      text.trim() === ''
        ? null
        : <FontSizeItems {...props} typed={text} />,
    onEntered(text: string): MenuFieldEntered {
      let [size] = fontSizesMatchingTyped(text);
      if (size === undefined || isEntered) return 'stay';
      setIsEntered(true);
      props.onChosen({
        fontSizeInPoints: size,
      });
      return 'shut';
    },
    saidOf(text: string, isCounted: boolean = true) {
      if (text.trim() === '' || isEntered) return false;
      let sizes = fontSizesMatchingTyped(text);
      if (sizes.length === 0) return fontSizeRangeMessage(SMALLEST_FONT_SIZE, LARGEST_FONT_SIZE);
      return isCounted && menuMatchCountChooseRowWords(sizes.length, String(sizes[0]));
    },
  };
}
