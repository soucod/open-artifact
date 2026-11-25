import { Menu } from '../kit/menu.tsx';
import { Skeleton } from '../kit/skeleton.tsx';
import { Surface } from '../kit/surface.tsx';
import { TextLink } from '../kit/text-link.tsx';
import { Button } from '../kit/button.tsx';
import { Spinner } from '../kit/spinner.tsx';
import type { CSSProperties, ReactNode } from 'react';
import * as ReactDOMClient from 'react-dom/client';
import * as ReactDOM from 'react-dom';
import { gridHeaderRoomStyle } from '../grid/group-margin.tsx';
import { MenuTriggerButton, ZoomPercent } from '../ui/menu-trigger.tsx';
import { sheetMessages } from '../i18n/sheet-messages.ts';
import { zoomPercent } from '../grid/zoom.ts';
import { versionHistoryMessages } from '../history/version-text.ts';
import { PlaceholderPattern } from './pattern.tsx';
import { preventMouseDownDefault } from '../ui/dom-events.ts';
import { renderInPlaceholderRoot } from '../shell/ui-root.tsx';
import { readStoredDensity } from '../app/density-preference.ts';
import { afterNextFrameOrTimeout } from '../utils/next-frame.ts';
import { COLUMN_HEADER_HEIGHT } from '../grid/cell-metrics.ts';
import { ROW_HEADER_WIDTH, defaultRowHeightAtDensity } from '../grid/cell-metrics-values.ts';
import { translateMessage } from '../i18n/messages.ts';
import type { CellDensity } from '../grid/cell-metrics-values.ts';
import type { SheetStatus } from '../shell/sheet-status.ts';
/** A way out of a problem the placeholder tells of: its kind, and what taking it does. */
export interface PlaceholderWayOut {
  kind: 'tryAgain' | 'restoreSheet';
  take: () => void;
}
/** A problem the placeholder tells of, in words, with a way out of it when there is one. */
export interface PlaceholderNotice {
  inWords: SheetStatus['inWords'];
  shownAs: SheetStatus['shownAs'];
  wayOut: PlaceholderWayOut | null;
}
export interface SheetPlaceholderProps {
  density: CellDensity;
  zoom: number;
  notice: PlaceholderNotice | null;
  partLoaded?: number | null;
  doesButtonTakeFocus?: boolean;
  atEndOfSheetBar: ReactNode;
}
/** The placeholder shown in place of the sheet until it is drawn. */
export interface SheetPlaceholderHandle {
  show(notice: PlaceholderNotice | null, partLoaded?: number | null): boolean;
  takeOffAfterNextPaint(): void;
  /** Runs `whenOff` once the placeholder is taken off, or now if it is off or going off; returns how to cancel that. */
  onceOff(whenOff: () => void): () => void;
  /** Keeps the placeholder on until the returned call lets it go, or a while has passed; the call answers whether it still held it. */
  keepOn(): () => boolean;
}
/** The sizes the placeholder's pattern is drawn by, as custom properties of its style. */
export type PlaceholderSizeStyle = CSSProperties & {
  '--sheet-placeholder-headers-height': string;
  '--sheet-placeholder-headers-width': string;
  '--sheet-placeholder-row-height': string;
  '--sheet-placeholder-column-width': string;
};
/** Stands for one take-off of the placeholder, known only by its identity. */
type TakeOffToken = object;
/** A hold that keeps the placeholder on, and whether a take-off came while it held. */
interface KeptOn {
  isDue: boolean;
}
export function SheetPlaceholder({
  density,
  zoom,
  notice,
  partLoaded = null,
  doesButtonTakeFocus = false,
  atEndOfSheetBar,
}: SheetPlaceholderProps) {
  let isWaiting = notice === null;
  return <div className="relative flex h-full flex-col" style={{
      ...placeholderSizeStyle(density, zoom),
      ...gridHeaderRoomStyle(0, zoom, density),
    }}><div className="sheet-formula-row justify-end" aria-hidden inert>{isWaiting &&
          <div className="sheet-view-tools"><Menu.Root><MenuTriggerButton variant="ghost" aria-label={sheetMessages.zoomButton(zoomPercent(zoom))} chevron="toolbar" disabled><ZoomPercent zoom={zoom} /></MenuTriggerButton></Menu.Root><Button variant="ghost" iconOnly icon="History" aria-label={versionHistoryMessages.title()} disabled /></div>}</div><div className={`min-h-0 flex-1 ${isWaiting ? 'sheet-grid sheet-placeholder-grid' : 'sheet-placeholder-blank relative mt-px'}`}>{isWaiting &&
            (<div className="sheet-placeholder-cells"><Skeleton decorative className="size-full rounded-none" /><div className="sheet-placeholder-part" style={{
                    transform: `scaleX(${partLoaded ?? 0})`,
                  }} aria-hidden /><PlaceholderPattern /></div>)}{notice !== null &&
            (<div className="absolute inset-x-0 z-1 flex h-0 justify-center items-start" style={placeholderNoticeStyle(density)}><Surface elevation="popover" className="sheet-placeholder-notice">{notice.shownAs === null ? <span aria-hidden>{notice.inWords}</span> : <span aria-hidden className="flex flex-col gap-xs"><span className="text-body font-medium text-primary">{notice.shownAs.heading}</span><span>{notice.shownAs.text}</span></span>}{notice.wayOut !== null &&
                    <TextLink key={notice.wayOut.kind} data-way-out={notice.wayOut.kind} ref={doesButtonTakeFocus ? focusWayOutRef : undefined} onClick={notice.wayOut.take} aria-label={notice.wayOut.kind === 'restoreSheet' ? restoreSheetLabel() : undefined}>{notice.wayOut.kind === 'restoreSheet' ? restoreLabel() : retryLabel()}</TextLink>}</Surface></div>)}</div>{isWaiting &&
        <div className="sheet-placeholder-marks absolute inset-x-0 top-1/2 z-1 flex h-0 items-center justify-center" aria-hidden><span className="sheet-placeholder-ring"><Spinner size="lg" /></span></div>}<div className={`sheet-bar ${isWaiting ? '' : 'sheet-bar-under-notice'}`}>{isWaiting &&
            <div className="contents" aria-hidden inert><Button variant="ghost" iconOnly icon="Add" className="sheet-add-sheet" aria-label={sheetMessages.addSheet()} disabled /><Menu.Root><MenuTriggerButton variant="ghost" icon="ListBullet" aria-label={sheetMessages.allSheets()} chevron="toolbar" disabled>{null}</MenuTriggerButton></Menu.Root><div className="sheet-scroller -mx-1"><Skeleton decorative width="4.5rem" className="h-control" /></div></div>}<div role="presentation" className="ms-auto flex flex-none" onMouseDown={preventMouseDownDefault}>{atEndOfSheetBar}</div></div></div>;
}
export function createSheetPlaceholder(
  mount: HTMLElement,
  onError: (error: unknown) => void,
  atEndOfSheetBar: ReactNode,
  getZoom: () => number,
): SheetPlaceholderHandle {
  let ownerDocument = mount.ownerDocument;
  let root: ReactDOMClient.Root | null = null;
  let isFirstShow = true;
  let hasFailed = false;
  let pendingTakeOff: TakeOffToken | null = null;
  let wayOutFocused: string | null = null;
  let runsWhenOff = new Set<() => void>();
  let pendingUnmount: TakeOffToken | null = null;
  let keptOn: KeptOn | null = null;
  let setLeaving = (isLeaving: boolean) => {
    mount.inert = isLeaving;
    mount.toggleAttribute('data-is-leaving', isLeaving);
  };
  let setOverCells = (isOver: boolean) => void mount.toggleAttribute('data-is-over-cells', isOver);
  let placeholder: SheetPlaceholderHandle = {
    show(notice, partLoaded = null) {
      pendingTakeOff = null;
      if (keptOn !== null) keptOn.isDue = false;
      pendingUnmount = null;
      setLeaving(false);
      setOverCells(false);
      if (hasFailed) return false;
      wayOutFocused = ownerDocument.activeElement?.getAttribute('data-way-out') ?? wayOutFocused;
      let takesFocus =
        notice !== null &&
        notice.wayOut !== null &&
        notice.wayOut.kind === wayOutFocused &&
        ownerDocument.hasFocus() &&
        ownerDocument.activeElement === ownerDocument.body;
      if (notice !== null) wayOutFocused = null;
      root ??= ReactDOMClient.createRoot(mount, {
        onUncaughtError(error) {
          hasFailed = true;
          onError(error);
        },
      });
      let shownRoot = root;
      let render = () =>
        shownRoot.render(
          renderInPlaceholderRoot(
            <SheetPlaceholder density={readStoredDensity()} zoom={getZoom()} notice={notice} partLoaded={partLoaded} doesButtonTakeFocus={takesFocus} atEndOfSheetBar={atEndOfSheetBar} />,
          ),
        );
      if (isFirstShow || takesFocus) ReactDOM.flushSync(render);
      else render();
      isFirstShow = false;
      return !hasFailed;
    },
    takeOffAfterNextPaint() {
      if (root === null || pendingTakeOff !== null || pendingUnmount !== null || ownerDocument.defaultView === null) return;
      let takeOffToken = {};
      pendingTakeOff = takeOffToken;
      setOverCells(true);
      afterNextFrameOrTimeout(ownerDocument.defaultView, () => {
        if (pendingTakeOff !== takeOffToken) return;

        pendingTakeOff = null;
        if (keptOn !== null) return void (keptOn.isDue = true);
        wayOutFocused = null;
        let unmountToken = {};
        pendingUnmount = unmountToken;
        setLeaving(true);
        let toRunNow = [...runsWhenOff];
        runsWhenOff.clear();
        for (let whenOff of toRunNow) whenOff();
        let unmount = () => {
          if (pendingUnmount !== unmountToken) return;
          pendingUnmount = null;
          root?.unmount();
          root = null;
          setLeaving(false);
          setOverCells(false);
        };
        let animationsFinished = ownerDocument.hidden
          ? []
          : mount.getAnimations().map(({ finished }) => finished);
        Promise.allSettled(animationsFinished).then(unmount);
      });
    },
    onceOff(whenOff) {
      if (root === null || pendingUnmount !== null) whenOff();
      else runsWhenOff.add(whenOff);
      return () => void runsWhenOff.delete(whenOff);

    },
    keepOn() {
      if (root === null || pendingUnmount !== null || hasFailed) return () => false;
      let keep: KeptOn = {
        isDue: false,
      };
      keptOn = keep;
      let letGo = () => {
        if (keptOn !== keep) return false;
        clearTimeout(timer);
        keptOn = null;
        if (keep.isDue) placeholder.takeOffAfterNextPaint();
        return true;
      };
      let timer = setTimeout(letGo, MS_TO_KEEP_ON);
      return letGo;
    },
  };
  return placeholder;
}
export const PLACEHOLDER_COLUMN_WIDTH = 104;
export const placeholderSizeStyle = (density: CellDensity, zoom: number): PlaceholderSizeStyle => ({
  '--sheet-placeholder-headers-height': `${COLUMN_HEADER_HEIGHT * zoom}px`,
  '--sheet-placeholder-headers-width': `${ROW_HEADER_WIDTH * zoom}px`,
  '--sheet-placeholder-row-height': `${defaultRowHeightAtDensity(density) * zoom}px`,
  '--sheet-placeholder-column-width': `${PLACEHOLDER_COLUMN_WIDTH * zoom}px`,
});
export const placeholderNoticeStyle = (density: CellDensity) => ({
  top: COLUMN_HEADER_HEIGHT + Math.floor(1.5 * defaultRowHeightAtDensity(density)),
});
export const retryLabel = () =>
  translateMessage({
    defaultMessage: 'Retry',
    id: 'yJNyDdQ5L1',
  });
export const restoreLabel = () =>
  translateMessage({
    defaultMessage: 'Restore',
    id: '1Up89JNrlW',
  });
export const restoreSheetLabel = () =>
  translateMessage({
    defaultMessage: 'Restore Sheet',
    id: 'zo8CbDva1h',
  });
export const focusWayOutRef = (element: HTMLButtonElement | null) =>

  element?.focus({
    preventScroll: true,
  });
export const MS_TO_KEEP_ON = 5000;
