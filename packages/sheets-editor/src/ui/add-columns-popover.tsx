import { Combobox } from '../kit/combobox.tsx';
import { Popover } from '../kit/popover.tsx';
import * as React from 'react';
import { roomForMoreLines, parseLineCount } from '../grid/lines-at-end.ts';
import { MESSAGE_LOCALE } from '../i18n/messages.ts';
import { sheetMessages } from '../i18n/sheet-messages.ts';
import { enterNumberUpToHint, upToAtATimeHint, addColumnsLabel } from '../i18n/grid-action-labels.ts';
import { LiveAnnouncer } from './live-announcer.tsx';
import { isTrustedEscapeClose } from '../app/page-guards.ts';
import { popupPropsUnderHeader } from '../shell/bottom-insets.ts';
import { wrapTabFocusInBar } from './dom-events.ts';
export interface AddColumnsListProps {
  columnCount: number;
  onCountChosen: (count: number) => void;
}
export function AddColumnsList({ columnCount, onCountChosen }: AddColumnsListProps) {
  let [typed, setTyped] = React.useState('');
  let maxColumns = roomForMoreLines('columns', columnCount);
  let typedCount = parseLineCount(typed);
  let isTypedInvalid = typed.trim() !== '' && typedCount === null;
  let captionId = React.useId();
  let [isPresetHighlighted, setIsPresetHighlighted] = React.useState(false);
  let presets = COLUMN_COUNT_PRESETS.filter((preset) => preset <= maxColumns);
  let counts =
    typedCount === null
      ? presets
      : [typedCount, ...presets.filter((preset) => preset !== typedCount)].slice(0, Math.max(1, presets.length));
  let shownCounts = isPresetHighlighted ? [] : counts;
  return <div className={'flex w-[232px] flex-col p-[var(--ui-menu-gutter,0.25rem)] [[data-presentation=sheet]_&]:w-full'}><Combobox.Root<number> inline open filter={null} items={shownCounts} autoHighlight={typedCount !== null} inputValue={typed} onInputValueChange={(text) => {
          setTyped((parseLineCount(text) ?? 0) > maxColumns ? maxColumns.toLocaleString(MESSAGE_LOCALE) : text);
        }} onItemHighlighted={(count, { reason }) =>
          setIsPresetHighlighted(count !== undefined && typedCount === null && reason === 'none')} onValueChange={(count, details) => {
          details.cancel();
          if (count !== null) onCountChosen(count);
        }}><Combobox.PopupSearch placeholder={sheetMessages.columnsToAdd()} aria-label={sheetMessages.columnsToAdd()} inputMode="numeric" aria-describedby={captionId} aria-invalid={isTypedInvalid} /><Combobox.List aria-label={sheetMessages.addMoreColumns()}><Combobox.Group><Combobox.GroupLabel id={captionId}>{isTypedInvalid ? enterNumberUpToHint(maxColumns) : upToAtATimeHint(maxColumns)}</Combobox.GroupLabel>{shownCounts.map(
                  (count) =>
                    <Combobox.Item key={count} value={count}>{addColumnsLabel(count)}</Combobox.Item>,
                )}</Combobox.Group></Combobox.List></Combobox.Root><LiveAnnouncer words={isTypedInvalid && enterNumberUpToHint(maxColumns)} /></div>;
}
export interface AddColumnsPopoverProps {
  isOpen: boolean;
  /** The button that opened the card, if it is still on the page. */
  opener: () => HTMLElement | null;
  onShut: () => void;
  onKeyPressed: (key: string) => void;
  onCountChosen: (count: number) => void;
  whatHasCaretAfter: () => HTMLElement | false;
  columnCount: number;
}
export function AddColumnsPopover({
  isOpen,
  opener,
  onShut,
  onKeyPressed,
  onCountChosen,
  whatHasCaretAfter,
  columnCount,
}: AddColumnsPopoverProps) {
  let wasShutByPointerRef = React.useRef(false);
  return <Popover.Root open={isOpen} onOpenChange={(open, { reason, event }) => {
      wasShutByPointerRef.current = isTrustedEscapeClose(reason, event);
      if (!open) onShut();
    }}><Popover.Popup {...popupPropsUnderHeader()} anchor={() => anchorInsideGrid(opener)} side="bottom" align="start" padding="none" collisionAvoidance={{
        fallbackAxisSide: 'none',
      }} aria-label={sheetMessages.addMoreColumns()} finalFocus={() => (wasShutByPointerRef.current ? opener() : whatHasCaretAfter())} onKeyDownCapture={(event) => onKeyPressed(event.key)} onKeyDown={(event) => {
        wrapTabFocusInBar(event);
        if (event.key === 'F6' && !event.altKey) event.preventDefault();
      }}><AddColumnsList columnCount={columnCount} onCountChosen={(count) => {
          wasShutByPointerRef.current = false;
          onShut();
          onCountChosen(count);
        }} /></Popover.Popup></Popover.Root>;
}
export const COLUMN_COUNT_PRESETS: readonly number[] = [5, 10, 50];
/** An anchor at the opener, kept inside the grid's right edge; it stays where it was once the opener is gone. */
export interface AnchorInsideGrid {
  contextElement: Element | undefined;
  getBoundingClientRect(): DOMRect;
}
export const anchorInsideGrid = (getOpener: () => Element | null): AnchorInsideGrid => {
  let lastRect = new DOMRect();
  return {
    contextElement: getOpener() ?? undefined,
    getBoundingClientRect() {
      let opener = getOpener();
      if (opener === null) return lastRect;
      let { x, y, width, height } = opener.getBoundingClientRect();
      let gridRight = opener.closest('.sheet-grid')?.getBoundingClientRect().right ?? 1 / 0;
      lastRect = new DOMRect(Math.min(x, gridRight - width), y, width, height);
      return lastRect;
    },
  };
};
