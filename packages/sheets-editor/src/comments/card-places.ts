import { likelyHasKeyboard } from '../kit/platform.ts';
import type { GridView } from '../grid/grid-view.ts';
import type { DrawnBox } from '../grid/view-boxes.ts';
import type { PointBox } from '../grid/zoom.ts';
import type { BrowserSide } from '../state/controller.ts';
import type { PagePoint } from './page-comments.ts';
import type { HostComments } from './agent-ai-comments.ts';
import { commentMarksAtPoint, clipBoxToShown } from '../grid/view-boxes.ts';
import { pointInZoomedElement, boxOnScreen } from '../grid/zoom.ts';
import { COMMENT_LAYER_ATTR, boxInBody, COMMENT_CORNER_ATTR } from '../grid/grid-drawing.tsx';
import { isNarrowByTouch } from '../app/media-queries.ts';
import { COMMENT_CARD_ROOM_AT_FOOT } from '../grid/cards-place.ts';
import { popupTopNearRow, boundsAboveKeyboard } from '../ui/popup-room.ts';
import { getKeyboardInset } from '../shell/bottom-insets.ts';
/** What placing comment cards needs: the grid as drawn, the element it is drawn in, and the zoom. */
export interface CommentCardPlaceContext {
  grid: Pick<GridView, 'body' | 'marksOfComments' | 'markOfNewComment' | 'lowestFootWithRoomForCommentCard' | 'selectionBox' | 'activeCellBox'>;
  gridElement: Element;
  zoom: number;
}
/** The x on the page past which a card is out of the cells' body or of the frame, and where the body begins. */
export interface CommentCardEdges {
  bodyLeft: number;
  body: number;
  frame: number;
}
/** How a card is opened: as the box for a new comment, as a card asked for or not, or as a preview on its point. */
export type CommentCardOpenMode = 'box' | 'card' | 'cardUnasked' | 'cardOnItsPoint';
/** The room a preview has: its height when known, the lowest foot it may reach, and the top just under the frame. */
interface PreviewRoom {
  heightOfPreview: number | null;
  lowestFoot: number;
  underFrame: number;
}
/** The room under the cells a preview may take, in grid pixels, and the zoom. */
interface RoomUnderMark {
  lowestFootWithRoom: number;
  zoom: number;
}
/** The cards to place: the one asked for, the one on its point, and the heights the host told of them. */
export interface CommentCardsToPlace {
  asked: string | null;
  onItsPoint: string | null;
  heightOfCard: (handle: string) => number | null;
  heightOfPreview: (handle: string) => number | null;
}
/** Where the page wants each comment card, and the box of a new comment, in page pixels. */
export interface CommentCardPlaces {
  ofComments: Record<string, PagePoint>;
  ofBox: PagePoint | null;
}
/** What tells whether the device is a phone or tablet worked by touch. */
type DeviceNavigator = Pick<Navigator, 'userAgent' | 'maxTouchPoints'>;
export function markCommentLayersUnderMouse(
  { grid, gridElement, zoom }: CommentCardPlaceContext,
  mousePoint: Pick<MouseEvent, 'clientX' | 'clientY'> | null,
): string | null {
  let layerKeysUnderMouse = mousePoint === null ? [] : commentMarksAtPoint(grid, pointInZoomedElement(gridElement, zoom, mousePoint));
  for (let layerElement of gridElement.querySelectorAll(`[${COMMENT_LAYER_ATTR}]`))
    layerElement.toggleAttribute('data-is-under-mouse', layerKeysUnderMouse.includes(layerElement.getAttribute(COMMENT_LAYER_ATTR) ?? ''));
  return layerKeysUnderMouse.at(-1) ?? null;
}
export function commentCardPointOnItsPoint(cellsRect: PointBox, edges: CommentCardEdges): number | null {
  let rightX = cellsRect.x + cellsRect.width + COMMENT_CARD_GAP;
  if (rightX + COMMENT_CARD_WIDTH <= Math.min(edges.body, edges.frame - COMMENT_CARD_FRAME_MARGIN)) return rightX;
  let leftX = cellsRect.x - COMMENT_CARD_GAP - COMMENT_CARD_WIDTH;
  return leftX >= Math.max(edges.bodyLeft, COMMENT_CARD_FRAME_MARGIN) ? leftX : null;
}
export function commentCardPointBesideCells(
  cellsRect: PointBox,
  dropsBelowCells: boolean,
  lift: number,
  edges: CommentCardEdges,
  mayGoBeside: boolean = true,
): PagePoint {
  let [rightEdge, bottomEdge] = [cellsRect.x + cellsRect.width, cellsRect.y + cellsRect.height];
  let besideX = commentCardPointOnItsPoint(cellsRect, edges);
  if (mayGoBeside && besideX !== null)
    return {
      x: besideX - COMMENT_CARD_GAP,
      y: cellsRect.y - lift,
    };
  if (!dropsBelowCells)
    return {
      x: besideX === null ? rightEdge : besideX - COMMENT_CARD_GAP,
      y: bottomEdge,
    };
  let frameEdgeLimit = edges.frame - COMMENT_CARD_ROOM_AT_FRAME_EDGE;
  let fitsFromCellsLeft = cellsRect.x + COMMENT_CARD_WIDTH <= Math.min(edges.body, frameEdgeLimit);
  let leftOfRightEdge =
    rightEdge <= frameEdgeLimit
      ? Math.max(0, rightEdge - COMMENT_CARD_WIDTH - COMMENT_CARD_GAP)
      : Math.min(rightEdge + COMMENT_CARD_GAP, edges.frame - 1);
  return {
    x: fitsFromCellsLeft ? cellsRect.x - COMMENT_CARD_GAP : leftOfRightEdge,
    y: bottomEdge + COMMENT_CARD_DROP - lift,
  };
}
export function commentPreviewPointOnItsPoint(cellsRect: PointBox, edges: CommentCardEdges, room: PreviewRoom): PagePoint {
  let besideX = commentCardPointOnItsPoint(cellsRect, edges);
  if (besideX !== null) {
    let highestTop = room.lowestFoot - (room.heightOfPreview ?? DEFAULT_COMMENT_PREVIEW_HEIGHT);
    let top = cellsRect.y <= highestTop ? cellsRect.y : room.heightOfPreview === null ? room.underFrame : Math.max(0, highestTop);
    return {
      x: besideX,
      y: top,
    };
  }
  return {
    x:
      cellsRect.x + COMMENT_CARD_WIDTH <= Math.min(edges.body, edges.frame - COMMENT_CARD_ROOM_AT_FRAME_EDGE)
        ? cellsRect.x
        : Math.max(0, cellsRect.x + cellsRect.width - COMMENT_CARD_WIDTH),
    y: cellsRect.y + cellsRect.height + COMMENT_CARD_DROP,
  };
}
export function commentMarkRectOnPage(
  mark: DrawnBox,
  { grid, gridElement, zoom }: CommentCardPlaceContext,
): { cells: PointBox; edges: CommentCardEdges } {
  let { left, top, width, height } = boxInBody(clipBoxToShown(mark), grid.body);
  return {
    cells: boxOnScreen(gridElement, zoom, {
      x: left,
      y: top,
      width,
      height,
    }),
    edges: {
      bodyLeft: isNarrowByTouch()
        ? 1 / 0
        : boxOnScreen(gridElement, zoom, {
            x: grid.body.left,
            y: 0,
            width: 0,
            height: 0,
          }).x,
      body: boxOnScreen(gridElement, zoom, {
        x: grid.body.left + grid.body.width,
        y: 0,
        width: 0,
        height: 0,
      }).x,
      frame: gridElement.ownerDocument.defaultView?.innerWidth ?? 1 / 0,
    },
  };
}
export function placeCommentCard(
  openMode: CommentCardOpenMode,
  mark: DrawnBox,
  { grid, gridElement, zoom }: CommentCardPlaceContext,
  cardHeight: number | null = null,
): PagePoint {
  let { cells: cellsRect, edges } = commentMarkRectOnPage(mark, {
    grid,
    gridElement,
    zoom,
  });
  let ownerDocument = gridElement.ownerDocument;
  let rootFontSize = () => {
    let fontSize = Number.parseFloat(ownerDocument.defaultView?.getComputedStyle(ownerDocument.documentElement).fontSize ?? '');
    return Number.isNaN(fontSize) ? 16 : fontSize;
  };
  let lift = openMode === 'box' ? -(2.25 * rootFontSize() + COMMENT_CARD_GAP) : COMMENT_CARD_GAP;
  let topOfBarAtFoot =
    boxOnScreen(gridElement, zoom, {
      x: 0,
      y: grid.body.top + grid.lowestFootWithRoomForCommentCard,
      width: 0,
      height: 0,
    }).y + COMMENT_CARD_ROOM_AT_FOOT;
  let placedTop: number | null =
    openMode !== 'cardOnItsPoint' && isNarrowByTouch() && commentCardPointOnItsPoint(cellsRect, edges) === null
      ? popupTopNearRow(
          {
            top: cellsRect.y,
            foot: cellsRect.y + cellsRect.height,
          },
          boundsAboveKeyboard({
            height: ownerDocument.defaultView?.innerHeight ?? 0,
            topOfPage: ownerDocument.body.getBoundingClientRect().top,
            heightUnderKeyboard: getKeyboardInset(),
            topOfBarAtFoot,
            rem: rootFontSize(),
          }),
          lift,
          openMode === 'box' ? null : (cardHeight ?? DEFAULT_COMMENT_CARD_HEIGHT),
        )
      : null;
  let { x: pointX, y: pointY } =
    openMode === 'cardOnItsPoint'
      ? commentPreviewPointOnItsPoint(cellsRect, edges, {
          heightOfPreview: cardHeight,
          lowestFoot: topOfBarAtFoot - COMMENT_PREVIEW_FOOT_GAP,
          underFrame: (ownerDocument.defaultView?.innerHeight ?? 0) + COMMENT_PREVIEW_UNDER_FRAME,
        })
      : commentCardPointBesideCells(
          cellsRect,
          placedTop !== null ||
            isCommentMarkAboveCardFoot(mark, {
              grid,
            }),
          lift,
          edges,
          mayCommentCardGoBeside(openMode, clipBoxToShown(mark).top, grid.lowestFootWithRoomForCommentCard),
        );
  let { scrollX = 0, scrollY = 0 }: Partial<Pick<Window, 'scrollX' | 'scrollY'>> = ownerDocument.defaultView ?? {};
  return {
    x: Math.round(pointX + scrollX),
    y: Math.round((placedTop ?? pointY) + scrollY),
  };
}
export function shutCommentBoxNowAndOnFocus(ownerDocument: Document, shutCommentBox: () => void): () => void {
  shutCommentBox();
  if (ownerDocument.hasFocus()) return stopWaitingForNothing;
  let abortController = new AbortController();
  setTimeout(() => abortController.abort(), 1000);
  ownerDocument.defaultView?.addEventListener('focus', shutCommentBox, {
    once: true,
    signal: abortController.signal,
  });
  return () => abortController.abort();
}
export function previewCommentCardOnItsPoint(
  commentCards: Pick<HostComments, 'preview' | 'heightOfPreview'>,
  commentKey: string,
  placeContext: CommentCardPlaceContext,
): void {
  let mark = placeContext.grid.marksOfComments.find(({ key: markKey }) => markKey === commentKey);
  if (mark === undefined) return;
  let [markRect, { cells: cellsRect, edges }] = [clipBoxToShown(mark), commentMarkRectOnPage(mark, placeContext)];
  let room: RoomUnderMark = {
    lowestFootWithRoom: placeContext.grid.lowestFootWithRoomForCommentCard,
    zoom: placeContext.zoom,
  };
  if (doesCommentCardFitRightOf(commentCardPointOnItsPoint(cellsRect, edges) !== null, markRect.top + markRect.height, room))
    commentCards.preview(commentKey, placeCommentCard('cardOnItsPoint', mark, placeContext, commentCards.heightOfPreview(commentKey)));
}
export const isMobileTouchDevice = ({ userAgent, maxTouchPoints }: DeviceNavigator): boolean =>
  !userAgent.includes(' Electron/') && (/Android|iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1));
export const commentCornerKeyOf = (node: EventTarget | null): string | null => (node instanceof Element ? node.getAttribute(COMMENT_CORNER_ATTR) : null);
export const COMMENT_CARD_GAP = 4;
export const COMMENT_CARD_WIDTH = 300;
export const COMMENT_CARD_FRAME_MARGIN = 8;
export const COMMENT_PREVIEW_FOOT_GAP = 8;
export const COMMENT_CARD_DROP = 2;
export const COMMENT_CARD_ROOM_AT_FRAME_EDGE = 320;
export const DEFAULT_COMMENT_PREVIEW_HEIGHT = 480;
export const COMMENT_PREVIEW_UNDER_FRAME = 32;
export const isCommentMarkAboveCardFoot = (mark: DrawnBox, { grid }: Pick<CommentCardPlaceContext, 'grid'>): boolean => {
  let markRect = clipBoxToShown(mark);
  return markRect.top + markRect.height <= grid.lowestFootWithRoomForCommentCard;
};
export const mayCommentCardGoBeside = (openMode: CommentCardOpenMode, markTop: number, lowestFoot: number): boolean =>
  openMode === 'box' || (openMode === 'card' && markTop <= lowestFoot);
export const DEFAULT_COMMENT_CARD_HEIGHT = 176;
export const commentCardPlaces = (
  placeContext: CommentCardPlaceContext,
  { asked, onItsPoint, heightOfCard, heightOfPreview }: CommentCardsToPlace,
): CommentCardPlaces => ({
  ofComments: Object.fromEntries(
    placeContext.grid.marksOfComments.map(
      (mark) => [
        mark.key,
        placeCommentCard(
          mark.key === onItsPoint ? 'cardOnItsPoint' : mark.key === asked ? 'card' : 'cardUnasked',
          mark,
          placeContext,
          (mark.key === onItsPoint ? heightOfPreview : heightOfCard)(mark.key),
        ),
      ],
    ),
  ),
  ofBox: placeContext.grid.markOfNewComment === null ? null : placeCommentCard('box', placeContext.grid.markOfNewComment, placeContext),
});
export const commentOpenModeFor = (device: { hasKeyboard: boolean } & DeviceNavigator): 'reply' | 'card' => (device.hasKeyboard && !isMobileTouchDevice(device) ? 'reply' : 'card');
export const stopWaitingForNothing = () => {};
export const didMouseLeaveIntoOverlay = (event: { nativeEvent: MouseEvent }, overlayRect: DOMRectReadOnly): boolean => {
  let { relatedTarget, clientX, clientY } = event.nativeEvent;
  let isInsideOverlay =
    clientX > overlayRect.left + 2 && clientX < overlayRect.right - 2 && clientY > overlayRect.top + 2 && clientY < overlayRect.bottom - 2;
  let isOntoOverlay =
    relatedTarget === null || (relatedTarget instanceof Element && relatedTarget.closest('[data-comments-layer]') !== null);
  return isOntoOverlay && isInsideOverlay;
};
export const COMMENT_PREVIEW_ROOM_BELOW = 80;
export const doesCommentCardFitRightOf = (
  fitsBeside: boolean,
  markFoot: number,
  { lowestFootWithRoom, zoom }: RoomUnderMark = {} as RoomUnderMark,
): boolean => fitsBeside || markFoot <= lowestFootWithRoom + COMMENT_PREVIEW_ROOM_BELOW / zoom;
export const createSheetCommentActions = (
  commentCards: Pick<HostComments, 'openBox' | 'open' | 'heightOfCard' | 'heightOfPreview' | 'shut' | 'endMode' | 'shutBox'>,
  placeContextNow: () => CommentCardPlaceContext | null,
): BrowserSide['comments'] => {
  let stopWaitingForFocus = stopWaitingForNothing;
  return {
    openBox({ anchor, cells, sheetNumber, isForAgent }) {
      let placeContext = placeContextNow();
      let box = placeContext?.grid.selectionBox ?? placeContext?.grid.activeCellBox ?? null;
      if (placeContext === null || box === null) return;
      stopWaitingForFocus();
      let boxPoint = placeCommentCard('box', box, placeContext);
      let boxToOpen = {
        anchor,
        at: boxPoint,
        label: cells,
        sheetNumber,
        isForAgent,
      };
      commentCards.openBox(boxToOpen);
    },
    open(commentKey, isFromPage) {
      let placeContext = placeContextNow();
      let mark = placeContext?.grid.marksOfComments.find(({ key: markKey }) => markKey === commentKey);
      if (placeContext === null || mark === undefined) return;
      stopWaitingForFocus();
      commentCards.open(
        commentKey,
        commentCards.heightOfPreview(commentKey) === null
          ? placeCommentCard('card', mark, placeContext, commentCards.heightOfCard(commentKey))
          : placeCommentCard('cardOnItsPoint', mark, placeContext, commentCards.heightOfPreview(commentKey)),
        isFromPage
          ? 'page'
          : commentOpenModeFor({
              hasKeyboard: likelyHasKeyboard(),
              userAgent: navigator.userAgent,
              maxTouchPoints: navigator.maxTouchPoints,
            }),
      );
    },
    shut: () => commentCards.shut(),
    endMode: (isAskNext) => commentCards.endMode(isAskNext),
    shutBox() {
      let ownerDocument = placeContextNow()?.gridElement.ownerDocument;
      if (ownerDocument === undefined) commentCards.shutBox();
      else stopWaitingForFocus = shutCommentBoxNowAndOnFocus(ownerDocument, () => commentCards.shutBox());
    },
  };
};
