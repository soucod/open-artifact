import * as React from 'react';
/** The React key each line of the grid is drawn under, by the line's own key. */
export type LineKeys = ReadonlyMap<string, string>;
/** The lines last drawn, the page turn they were drawn at, and the React key of each. */
export interface LineKeysState {
  lines: readonly string[];
  pagesTurned: number;
  keys: LineKeys;
}
export function lineKeysAfter(keysBefore: LineKeys, lines: readonly string[], isNewPage: boolean): Map<string, string> {
  let keysInOrder = [...keysBefore.values()];
  let kept = lines.map((line: string, index: number) => (isNewPage ? keysInOrder[index] : keysBefore.get(line)));
  let taken = new Set(kept);
  return new Map(
    lines.map((line: string, index: number): [string, string] => {
      let key = kept[index] ?? line;
      if (kept[index] === undefined) while (taken.has(key)) key += ' again';
      return (taken.add(key), [line, key]);
    }),
  );
}
export function nextLineKeys(state: LineKeysState, lines: readonly string[], pagesTurned: number): LineKeysState {
  let isNewPage = pagesTurned !== state.pagesTurned;
  if (lines.length === state.lines.length && lines.every((line: string, index: number) => line === state.lines[index]) && !isNewPage)
    return state;
  return {
    lines,
    pagesTurned,
    keys: lineKeysAfter(state.keys, lines, isNewPage),
  };
}
export function useLineKeys(lines: readonly string[], pagesTurned: number, isOn: boolean): LineKeys {
  let [state, setState] = React.useState<LineKeysState>({
    lines: [],
    pagesTurned,
    keys: NO_LINE_KEYS,
  });
  if (!isOn) return NO_LINE_KEYS;
  let next = nextLineKeys(state, lines, pagesTurned);
  if (next !== state) setState(next);
  return next.keys;
}
export const NO_LINE_KEYS: LineKeys = new Map<string, string>();
export const keyOfLine = (key: string, keys: LineKeys, suffix: string = ''): string =>
  keys.size === 0 ? key : `${keys.get(key) ?? `${key} apart`}${suffix}`;
export const LIST_KEY_SUFFIX = '+list';
