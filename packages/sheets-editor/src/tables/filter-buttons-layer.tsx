import { Button } from '../kit/button.tsx';
import { Icon } from '../kit/icon.tsx';
import { TooltipGroup } from '../kit/tooltip.tsx';
import * as React from 'react';
import { filterButtonAtPoint } from './table-drawing.ts';
import { pointInZoomedElement } from '../grid/zoom.ts';
import { FILTER_BUTTON_SIZE } from './filter-buttons-place.ts';
import { Fragment } from 'react/jsx-runtime';
import { isElementFocused } from './own-filter-bar-view.tsx';
import { ContentsBox } from '../ui/contents-box.tsx';
import { preventMouseDownDefault } from '../ui/dom-events.ts';
import { FilterButtonGround } from '../grid/grid-drawing.tsx';
import { sortAndFilterMessages } from './sort-filter-labels.ts';
import { filterByColumnLabel } from './filter-messages.ts';
import { textPaintStyle, fillPaintStyle } from '../grid/cell-drawing.tsx';
import type { PaintPair, StyleWithVariables } from '../grid/cell-drawing.tsx';
import type { BodyOrigin } from '../grid/grid-drawing.tsx';
import type { ButtonProps } from '../kit/button.tsx';
import type { CustomIcon } from '../kit/icon.tsx';
import type { OwnFilter } from './own-filters.ts';
import type { ClearAroundButton, FilterButtonAt, FilterButtonInView, PlacedFilterButton } from './table-drawing.ts';
import type { FoundTableOutline, TableOutline } from './table-outlines.ts';
import type { OutlineHeldBack } from './tables-in-view.ts';
/** A table drawn, known by its key. */
export type TableDrawnWithKey = Pick<OwnFilter, 'key'>;
/** When the agent's change of a revision was first drawn. */
export interface RevisionTime {
  revision: number;
  atMs: number;
}
/** The grid as far as finding the filter button under a point goes: the cells' corner, and the buttons. */
export interface GridWithFilterButtons {
  body: BodyOrigin;
  filterButtons: readonly Pick<PlacedFilterButton, 'tableKey' | 'c' | 'cell'>[];
}
/** Where the pointer is in the window. */
export type PointerAt = Pick<MouseEvent, 'clientX' | 'clientY'>;
export interface FilterButtonPointedAtWatch {
  drawn: GridWithFilterButtons;
  gridRef: React.RefObject<Element | null>;
  zoom: number;
}
export interface FilterButtonPointedAt {
  pointedAt: FilterButtonAt | null;
  pointerMovedTo: (pointer: PointerAt | null) => void;
}
/** What an element that comes in place is given: the mark of its coming, and the end of it. */
export interface ComesInPlaceProps {
  'data-comes-in-place': true | undefined;
  onAnimationEnd: (animationEvent: React.AnimationEvent) => void;
}
export interface ButtonThatComesInPlaceProps extends ButtonProps {
  comesInPlace: boolean;
  ref?: React.Ref<HTMLElement>;
}
/** The clips of a table's outline: the rest of it, and the parts over frozen lines and over the headers. */
export interface OutlineClipPaths {
  rest: string;
  overFrozen: string | null;
  overHeaders: string | null;
}
/** A table's outline as drawn, with when it comes if it is a found table's. */
export type OutlineToDraw = TableOutline & Partial<Pick<FoundTableOutline, 'comesLater'>>;
export interface FilterTableOutlineProps {
  comesLater: OutlineHeldBack | null;
  revisionsDrawn: readonly RevisionTime[];
  isOfFoundTable: boolean | undefined;
  isOverFrozen?: boolean;
  isOverHeaders?: boolean;
  sidesCut: string | undefined;
  comesInPlace: boolean;
  style: React.CSSProperties;
}
/** A filter button pressed: its table, row and column, and whether its list is open. */
export type FilterButtonPressed = Pick<PlacedFilterButton, 'tableKey' | 'r' | 'c' | 'isOfFoundTable' | 'isListOpen'>;
export interface FilterButtonsLayerProps {
  buttons: readonly FilterButtonInView[];
  filteredTablesDrawn: readonly TableDrawnWithKey[];
  pointedAt: FilterButtonAt | null;
  body: BodyOrigin;
  onListAsked: (pressed: FilterButtonPressed) => void;
  onGoingWithCaret: () => void;
}
export interface FilterTableOutlinesProps {
  outlines: readonly OutlineToDraw[];
  body: BodyOrigin;
  areOfFoundTables?: boolean;
  latestRevisionByAgent?: number;
  filteredTablesDrawn?: readonly TableDrawnWithKey[];
}
export function noteKeysDrawn(seenKeys: string[], list: readonly TableDrawnWithKey[]): void {
  seenKeys.splice(0, seenKeys.length, ...keysOfList(list));
}
export function keysNewlyDrawn(seenKeys: readonly string[], list: readonly TableDrawnWithKey[]): readonly string[] {
  let newKeys = list.flatMap(({ key }) => (seenKeys.includes(key) ? [] : [key]));
  return newKeys.length === 0 ? NO_KEYS_NEWLY_DRAWN : newKeys;
}
export function noteRevisionTime(revisionTimes: RevisionTime[], revision: number, atMs: number): void {
  if (revision <= (revisionTimes.at(-1)?.revision ?? 0)) return;
  revisionTimes.push({
    revision,
    atMs,
  });
  if (revisionTimes.length > 50) revisionTimes.shift();
}
export function delayOfLaterOutline(
  revisionTimes: readonly RevisionTime[],
  { revisionOfMark, afterMs }: OutlineHeldBack,
  nowMs: number,
): number | null {
  let markedAtMs = revisionTimes.find(({ revision }) => revision >= revisionOfMark)?.atMs ?? nowMs;
  let delayMs = afterMs - (nowMs - markedAtMs);
  return delayMs > -200 ? delayMs : null;
}
export function useFilterButtonPointedAt({ drawn, gridRef, zoom }: FilterButtonPointedAtWatch): FilterButtonPointedAt {
  let pointerRef = React.useRef<PointerAt | null>(null);
  let [pointedAt, setPointedAt] = React.useState<FilterButtonAt | null>(null);
  let lookAtPointer = React.useCallback(() => {
    let [pointer, grid] = [pointerRef.current, gridRef.current];
    let buttonPointedAt =
      pointer === null || grid === null || drawn.filterButtons.length === 0
        ? null
        : filterButtonAtPoint(pointInZoomedElement(grid, zoom, pointer), drawn);
    setPointedAt(
      (previous) =>
        previous?.tableKey === buttonPointedAt?.tableKey && previous?.c === buttonPointedAt?.c ? previous : buttonPointedAt,
    );
  }, [drawn, gridRef, zoom]);
  React.useLayoutEffect(lookAtPointer, [lookAtPointer]);
  let pointerMovedTo = React.useCallback(
    (moveEvent: PointerAt | null) => {
      pointerRef.current =
        moveEvent === null
          ? null
          : {
              clientX: moveEvent.clientX,
              clientY: moveEvent.clientY,
            };
      lookAtPointer();
    },
    [lookAtPointer],
  );
  return {
    pointedAt,
    pointerMovedTo,
  };
}
export function filterButtonClearAtStyle({ top, right, bottom, left }: ClearAroundButton): StyleWithVariables {
  let halfButton = FILTER_BUTTON_SIZE / 2;
  return {
    '--sheet-shows-above-middle': `${top + halfButton}px`,
    '--sheet-shows-right-of-middle': `${right + halfButton}px`,
    '--sheet-shows-below-middle': `${bottom + halfButton}px`,
    '--sheet-shows-left-of-middle': `${left + halfButton}px`,
  };
}
export function useKeysNewlyDrawn(list: readonly TableDrawnWithKey[]): readonly string[] {
  let [seenKeys] = React.useState(() => keysOfList(list));
  React.useLayoutEffect(() => {
    noteKeysDrawn(seenKeys, list);
  }, [seenKeys, list]);
  return keysNewlyDrawn(seenKeys, list);
}
export function useComesInPlaceProps(comesInPlace: boolean): ComesInPlaceProps {
  let [isComingInPlace, setIsComingInPlace] = React.useState(comesInPlace);
  return {
    'data-comes-in-place': isComingInPlace || undefined,
    onAnimationEnd: ({ target, currentTarget }: React.AnimationEvent) => {
      if (target === currentTarget) setIsComingInPlace(false);
    },
  };
}
export function ButtonThatComesInPlace({ comesInPlace, ...buttonProps }: ButtonThatComesInPlaceProps) {
  return <Button {...buttonProps} {...useComesInPlaceProps(comesInPlace)} />;
}
export function outlineClipPolygon(left: number, top: number, innerLeft: number, innerTop: number): string | null {
  if (innerLeft === left && innerTop === top) return null;
  let farEdge = 'calc(100% + 100vmax)';
  return `polygon(${left}px ${top}px, ${farEdge} ${top}px, ${farEdge} ${innerTop}px, ${innerLeft}px ${innerTop}px, ${innerLeft}px ${farEdge}, ${left}px ${farEdge})`;
}
export function outlineClipPaths({
  cutAtLeft,
  cutAtTop,
  frozenAcross,
  frozenDown,
  isAtRowNumbers,
  isAtColumnLetters,
}: Pick<TableOutline, 'cutAtLeft' | 'cutAtTop' | 'frozenAcross' | 'frozenDown' | 'isAtRowNumbers' | 'isAtColumnLetters'>): OutlineClipPaths {
  let [headersLeft, headersTop] = [isAtRowNumbers ? 0 : cutAtLeft, isAtColumnLetters ? 0 : cutAtTop];
  let [clipLeft, clipTop] = [Math.max(frozenAcross, headersLeft), Math.max(frozenDown, headersTop)];
  return {
    rest: `inset(${clipTop}px -100vmax -100vmax ${clipLeft}px)`,
    overFrozen: outlineClipPolygon(headersLeft, headersTop, clipLeft, clipTop),
    overHeaders: outlineClipPolygon(cutAtLeft, cutAtTop, headersLeft, headersTop),
  };
}
export function FilterTableOutline({
  comesLater,
  revisionsDrawn,
  isOfFoundTable,
  isOverFrozen,
  isOverHeaders,
  sidesCut,
  comesInPlace,
  style,
}: FilterTableOutlineProps) {
  let [animationDelayMs] = React.useState(
    () => (comesLater === null ? null : delayOfLaterOutline(revisionsDrawn, comesLater, performance.now())),
  );
  let comesInPlaceProps = useComesInPlaceProps(comesInPlace);
  return <div aria-hidden className="sheet-own-filter-outline" data-is-of-found-table={isOfFoundTable} data-comes-later={animationDelayMs !== null || undefined} {...comesInPlaceProps} data-is-over-frozen={isOverFrozen} data-is-over-headers={isOverHeaders} data-sides-cut={sidesCut} style={animationDelayMs === null
        ? style
        : {
            ...style,
            animationDelay: `${animationDelayMs}ms`,
          }} />;
}
export const FILTER_ADD_ICON: CustomIcon & { name: string } = {
  name: 'FilterAdd',
  viewBox: 16,
  paths: [
    {
      d: 'M2.625 4.375L6.375 4.375M4.625 8.875L11.375 8.875M6.125 13.375L9.875 13.375',
      strokeWidth: 1,
    },
    {
      d: 'M11.625 2.625L11.625 6.125M9.875 4.375L13.375 4.375',
      strokeWidth: 1,
    },
  ],
};
export const filterAddIconElement = <Icon customIcon={FILTER_ADD_ICON} size="xs" />;
export const NO_KEYS_NEWLY_DRAWN: readonly string[] = [];
export const keysOfList = (list: readonly TableDrawnWithKey[]): string[] => list.map(({ key }) => key);
export const startRevisionTimes = (revision: number): RevisionTime[] => [
  {
    revision,
    atMs: -1 / 0,
  },
];
export const stopFilterButtonEvent = (buttonEvent: React.SyntheticEvent): void => buttonEvent.stopPropagation();
export const stopEnterOrSpacePropagation = (keyEvent: React.KeyboardEvent): void => {
  if (keyEvent.key === 'Enter' || keyEvent.key === ' ') keyEvent.stopPropagation();
};
export const atRestMarkStyle = (mark: PaintPair | null): StyleWithVariables =>
  mark === null
    ? {}
    : {
        '--sheet-mark-on-light': mark.onLight,
        '--sheet-mark-on-dark': mark.onDark,
      };
export const groundBesideButtonStyle = ({ left, cell }: Pick<PlacedFilterButton, 'left' | 'cell'>): StyleWithVariables => ({
  '--sheet-ground-past-button': `${Math.max(0, cell.left + cell.width - 1 - left - FILTER_BUTTON_SIZE)}px`,
  '--sheet-ground-before-button': `${Math.max(0, Math.min(8, left - cell.left))}px`,
});
export const NO_FILTERED_TABLES_DRAWN: readonly TableDrawnWithKey[] = [];
export const FilterButtonsLayer = React.memo(function ({
  buttons,
  filteredTablesDrawn,
  pointedAt,
  body,
  onListAsked,
  onGoingWithCaret,
}: FilterButtonsLayerProps) {
  let caretGoesOnRef = React.useCallback(
    (button: HTMLElement) =>
      () => {
        if (isElementFocused(button)) onGoingWithCaret();
      },
    [onGoingWithCaret],
  );
  let tablesNewlyDrawn = useKeysNewlyDrawn(filteredTablesDrawn);
  return <ContentsBox onPointerDown={stopFilterButtonEvent} onMouseDown={(mouseEvent: React.MouseEvent) => {
      stopFilterButtonEvent(mouseEvent);
      preventMouseDownDefault(mouseEvent);
    }} onPointerUp={stopFilterButtonEvent} onClick={stopFilterButtonEvent} onDoubleClick={stopFilterButtonEvent} onContextMenu={stopFilterButtonEvent} onKeyDown={stopEnterOrSpacePropagation} onKeyUp={stopEnterOrSpacePropagation}>{buttons.map(
        ({ r, c, heldInView, groundsWhereHeld, headerKept }) =>
          heldInView !== null &&
          headerKept === null &&
          <FilterButtonGround key={`${r} ${c}`} box={heldInView} grounds={groundsWhereHeld} body={body} />,
      )}<TooltipGroup>{buttons.map(
          ({
            tableKey,
            r,
            isOfFoundTable,
            c,
            column,
            left,
            top,
            clearAt,
            cell,
            isOn,
            isListOpen,
            ink,
            ground,
            givesWayToText,
            isInActiveCell,
            atRest,
            headerKept,
          }) =>
            (<ButtonThatComesInPlace key={`${r} ${c}`} ref={caretGoesOnRef} comesInPlace={tablesNewlyDrawn.includes(tableKey)} variant="ghost" size="xxs" iconOnly icon={isOfFoundTable
                  ? filterAddIconElement
                  : <Icon name="FilterLines" size="xs" />} tabIndex={-1} className="sheet-own-filter-button" aria-label={isOfFoundTable ? sortAndFilterMessages.sortAndFilter() : filterByColumnLabel(column, isOn)} aria-haspopup="dialog" aria-expanded={isListOpen} data-is-on={isOn || undefined} data-is-of-found-table={isOfFoundTable || undefined} data-gives-way-to-text={givesWayToText || undefined} data-is-called-for={isInActiveCell || (pointedAt?.tableKey === tableKey && pointedAt.c === c) || undefined} data-has-text-paint={ink !== null || undefined} data-is-over-header-kept={headerKept !== null || undefined} data-ground={ground === null ? undefined : typeof ground === 'string' ? ground : 'fill'} style={{
                  left: body.left + left + FILTER_BUTTON_SIZE / 2,
                  top: body.top + top + FILTER_BUTTON_SIZE / 2,
                  ...filterButtonClearAtStyle(clearAt),
                  ...(givesWayToText &&
                    groundBesideButtonStyle({
                      left,
                      cell,
                    })),
                  ...textPaintStyle(ink),
                  ...atRestMarkStyle(atRest),
                  ...fillPaintStyle(typeof ground === 'string' ? null : ground),
                }} onClick={() =>
                  onListAsked({
                    tableKey,
                    r,
                    c,
                    isOfFoundTable,
                    isListOpen,
                  })} />),
        )}</TooltipGroup></ContentsBox>;
});
export const FilterTableOutlines = React.memo(function ({
  outlines,
  body,
  areOfFoundTables,
  latestRevisionByAgent = 0,
  filteredTablesDrawn = NO_FILTERED_TABLES_DRAWN,
}: FilterTableOutlinesProps) {
  let [revisionTimes] = React.useState(() => startRevisionTimes(latestRevisionByAgent));
  React.useLayoutEffect(() => {
    noteRevisionTime(revisionTimes, latestRevisionByAgent, performance.now());
  }, [revisionTimes, latestRevisionByAgent]);
  let tablesNewlyDrawn = useKeysNewlyDrawn(filteredTablesDrawn);
  return <>{outlines.map((outline) => {
      let { tableKey, left, top, width, height } = outline;
      let { rest: restClip, overFrozen: overFrozenClip, overHeaders: overHeadersClip } = outlineClipPaths(outline);
      let outlineStyle = {
        left: body.left + left,
        top: body.top + top,
        width: width - 1,
        height: height - 1,
        clipPath: restClip,
      };
      let outlineProps = {
        comesLater: outline.comesLater ?? null,
        revisionsDrawn: revisionTimes,
        isOfFoundTable: areOfFoundTables,
        sidesCut: outline.sidesCut ?? undefined,
        comesInPlace: tablesNewlyDrawn.includes(tableKey),
      };
      return (<React.Fragment key={tableKey}><FilterTableOutline {...outlineProps} style={outlineStyle} />{overFrozenClip !== null &&
              (<FilterTableOutline {...outlineProps} isOverFrozen style={{
                  ...outlineStyle,
                  clipPath: overFrozenClip,
                }} />)}{overHeadersClip !== null &&
              (<FilterTableOutline {...outlineProps} isOverHeaders style={{
                  ...outlineStyle,
                  clipPath: overHeadersClip,
                }} />)}</React.Fragment>);
    })}</>;
});
