import * as React from 'react';
import { CopiedRowsDrawing, clippedBoxStyle } from '../grid/grid-drawing.tsx';
import { FilterButtonsLayer } from './filter-buttons-layer.tsx';
import type { TableDrawnWithKey } from './filter-buttons-layer.tsx';
import { useLingeringValue } from '../agent/done-by-agent.tsx';
import type { BodyOrigin } from '../grid/grid-drawing.tsx';
import type { StyleWithVariables } from '../grid/cell-drawing.tsx';
import type { PaneRect } from '../grid/geometry.ts';
import type { CellDensity } from '../grid/cell-metrics-values.ts';
import type { CopyOfHeldCells } from '../grid/moved-cells-copy.ts';
import type { movedCellsView } from '../grid/grid-view.ts';
/** Cells being moved, as they are drawn under the pointer. */
export type CellsHeldShown = NonNullable<ReturnType<typeof movedCellsView>>;
/** Where a copy of held cells is placed, from the corner of the cells' box. */
export type PlaceOfCopy = Pick<PaneRect, 'left' | 'top'>;
export interface CellsOfCopyProps {
  part: CopyOfHeldCells;
  className?: string;
  body: BodyOrigin;
  density: CellDensity;
}
export interface CellsHeldProps {
  held: CellsHeldShown | null;
  body: PaneRect;
  density: CellDensity;
}
export function useHasScrolledWhileHeld(scroll: string | null, place: string | null): boolean {
  let [seen, setSeen] = React.useState({
    scroll,
    place,
    hasScrolled: false,
  });
  if (scroll === seen.scroll && place === seen.place) return seen.hasScrolled;
  let hasScrolled = seen.scroll !== null && scroll !== seen.scroll;
  setSeen({
    scroll,
    place,
    hasScrolled,
  });
  return hasScrolled;
}
export function CellsOfCopy({ part, className, body, density }: CellsOfCopyProps) {
  return <div className="sheet-cells-of-copy"><div className={className} style={{
        position: 'absolute',
        left: -body.left,
        top: -body.top,
        width: body.left + part.width,
      }}><CopiedRowsDrawing rows={part.rows} borderLines={part.borderLines} body={body} density={density} /><FilterButtonsLayer buttons={part.filterButtons} filteredTablesDrawn={NO_TABLES_DRAWN_ON_COPY} pointedAt={null} body={body} onListAsked={doNothingOnCopy} onGoingWithCaret={doNothingOnCopy} /></div></div>;
}
export function CellsHeld({ held, body, density }: CellsHeldProps) {
  let bodyBox = React.useMemo(
    () => ({
      left: body.left,
      top: body.top,
      width: body.width,
      height: body.height,
    }),
    [body.left, body.top, body.width, body.height],
  );
  let lingering = useLingeringValue(held);
  let [firstPane] = lingering?.shown.panes ?? [];
  let hasScrolled = useHasScrolledWhileHeld(
    lingering?.shown.scroll ?? null,
    firstPane === undefined ? null : `${firstPane.at.left} ${firstPane.at.top}`,
  );
  let [heldAtStart, setHeldAtStart] = React.useState(held);
  if ((held === null) !== (heldAtStart === null)) setHeldAtStart(held);
  if (lingering === null) return null;
  let { shown, isLeaving } = lingering;
  let { homeAt, home, handle } = shown;
  let bodyCorner = {
    left: bodyBox.left,
    top: bodyBox.top,
  };
  let comesFrom = (at: PlaceOfCopy, landingAt: PlaceOfCopy): PlaceOfCopy =>
    shown === heldAtStart
      ? {
          left: at.left - landingAt.left + homeAt.left,
          top: at.top - landingAt.top + homeAt.top,
        }
      : at;
  return <div aria-hidden inert className="sheet-cells-held" data-is-leaving={isLeaving || undefined} data-has-scrolled={hasScrolled || undefined}>{home !== null &&
        !isLeaving &&
        <div className="sheet-home-of-cells-held" style={clippedBoxStyle(home, bodyBox)} />}{shown.panes.map(
        ({ key, showsIn, landingAt, at, part, headerKept }) =>
          (<div key={key} className="sheet-pane-of-copy" style={{
                clipPath: `inset(${bodyBox.top + showsIn.top}px ${bodyBox.width - showsIn.left - showsIn.width}px ${bodyBox.height - showsIn.top - showsIn.height}px ${bodyBox.left + showsIn.left}px)`,
              }}><div className="sheet-copy-of-held-cells" data-is-table={shown.isTable || undefined} style={{
                    ...bodyCorner,
                    width: part.width,
                    height: part.height,
                    ...copyPlaceStyle(at, comesFrom(at, landingAt)),
                  }}><CellsOfCopy part={part} body={bodyBox} density={density} /></div>{headerKept !== null &&
                  (<div className="sheet-header-kept-of-copy" style={{
                      ...bodyCorner,
                      width: headerKept.part.width,
                      height: headerKept.part.height,
                      ...copyPlaceStyle({
                        left: at.left,
                        top: headerKept.top,
                      }),
                    }}><CellsOfCopy className="sheet-header-kept-cells" part={headerKept.part} body={bodyBox} density={density} /></div>)}</div>),
      )}{handle !== null &&
        firstPane !== undefined &&
        (<div className="sheet-handle-of-table" data-is-on-copy data-is-over-row-number={handle.isAtRowNumbers ? 'plain' : undefined} style={{
            ...bodyCorner,
            width: handle.width,
            height: handle.height,
            ...copyPlaceStyle(handle, comesFrom(handle, firstPane.landingAt)),
          }} />)}</div>;
}
export const NO_TABLES_DRAWN_ON_COPY: readonly TableDrawnWithKey[] = [];
export const doNothingOnCopy = (): void => {};
export const copyPlaceStyle = (at: PlaceOfCopy, comesFrom: PlaceOfCopy = at): StyleWithVariables => ({
  '--sheet-place-of-copy': `${at.left}px ${at.top}px`,
  '--sheet-copy-comes-from': `${comesFrom.left}px ${comesFrom.top}px`,
});
