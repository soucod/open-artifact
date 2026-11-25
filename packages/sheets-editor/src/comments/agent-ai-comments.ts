import { isNonNullObject } from '../utils/objects.ts';
import type { CommentsTold } from '../state/event-reducer.ts';
import type { PageApi } from '../host/sheets-host.ts';
import type { CommentCardPlaces } from './card-places.ts';
import type {
  AgentReach,
  CardFocus,
  CommentsUiPatch,
  CommentsUiState,
  CommentUiPatch,
  ComposerUi,
  PageComments,
  PagePoint,
} from './page-comments.ts';
/** What the page hears of the host's comments: the list, the comments the mouse is on, and a comment picked. */
export interface HostCommentsListener {
  told(told: Omit<CommentsTold, 'kind'>): void;
  pointedAt(handles: string[]): void;
  picked(handle: string, pickedIn: 'preview' | 'list'): void;
}
/** The box of a new comment to open on the cells, and whether it goes to the agent. */
export interface CommentBoxToOpen {
  anchor: string;
  at: PagePoint;
  label: string;
  sheetNumber: number;
  isForAgent: boolean;
}
/** The card shown on its comment's point while the mouse rests there. */
export interface CardOnItsPoint {
  handle: string;
  isAtRest: boolean;
  isUnderMouse: boolean;
}
/** The comment cards the host draws over the page, as the sheet opens, places and shuts them. */
export interface HostComments {
  start(listener: HostCommentsListener): () => void;
  askWhetherAgentCanBeSent(): void;
  couldSendToAgentWhenLastAnswered(): boolean;
  openBox(box: CommentBoxToOpen): void;
  open(handle: string, at: PagePoint, how: CardFocus): void;
  cardAskedFor(): string | null;
  preview(handle: string, at: PagePoint): void;
  endPreview(): void;
  cardOnItsPoint(): CardOnItsPoint | null;
  heightOfCard(handle: string): number | null;
  heightOfPreview(handle: string): number | null;
  onPlacesWanted(listener: () => void): () => void;
  onMouseOnPreviewChanged(listener: (isOnPreview: boolean) => void): () => void;
  shut(): void;
  shutBox(): void;
  endMode(bumpsTurn: boolean): void;
  tellPlaces(places: CommentCardPlaces): void;
  canEndMode(): boolean;
}
/** The box sent to the agent, to find the comment it became once the host lists it. */
interface SentBox {
  anchor: string;
  listed: string[];
  turn: number;
  sinceMs: number;
}
/** A card opened from the page, in the turn it was opened in. */
interface OpenedFromPage {
  handle: string;
  turn: number;
}
/** The height the host told of the preview card. */
interface PreviewHeight {
  of: string;
  px: number;
}
/** A card being closed: settled when the host has closed it, or when the wait for it is over. */
type CardClosing = Promise<CommentsUiState | null | void>;
export function createHostComments(
  getAgent: () => PageApi,
  reportFault: (fault: unknown) => void,
  keepKeysOffCells: () => () => void = () => () => {},
): HostComments {
  let listener: HostCommentsListener = NO_COMMENTS_LISTENER;
  let hasStarted = false;
  let setUi: ((patch: CommentsUiPatch) => Promise<CommentsUiState | null>) | null = null;
  let uiState: CommentsUiState = {
    comments: {},
    composer: null,
  };
  let toldPlaces: CommentCardPlaces = {
    ofComments: {},
    ofBox: null,
  };
  let askedCard: string | null = null;
  let openedFromPage: OpenedFromPage | null = null;
  let boxAnchor: string | null = null;
  let sentBox: SentBox | null = null;
  let collapsedHandle: string | null = null;
  let commentsCapability: PageComments | null = null;
  let couldSendToAgent = false;
  let asksWhenReady = false;
  let canSendAskNumber = 0;
  let boxShutsPending = 0;
  // The settled promises are awaited only to know they have settled; what they hold is not read.
  let boxShutSettled: Promise<unknown> = Promise.resolve();
  let uiTurn = 0;
  let openTurn = 0;
  let exitMode: (() => Promise<boolean | void>) | null = null;
  let modeEndsPending = 0;
  let modeEndSettled: Promise<unknown> = Promise.resolve();
  let focusCard: ((handle: string, how: CardFocus) => void) | null = null;
  let previewHandle: string | null = null;
  let closingCards = new Map<string, CardClosing>();
  let cardHeights = new Map<string, number>();
  let previewHeight: PreviewHeight | null = null;
  let pickedCardHeight = 0;
  let placesWantedListeners = new Set<() => void>();
  let isAskingPlaces = false;
  let previewUnderMouse: string | null = null;
  let mouseOnPreviewListeners = new Set<(isOnPreview: boolean) => void>();
  let collapsedCards: string[] = [];
  let collapseCard = (handle: string): Record<string, CommentUiPatch> => (
    (collapsedHandle = handle),
    {
      [handle]: {
        display: null,
      },
    }
  );
  let hoveredHandlesOf = ({ comments }: CommentsUiState): string[] =>
    Object.keys(comments).filter((handle) => comments[handle]?.hovered === true);
  let toldStateOf = (state: CommentsUiState): Pick<CommentsTold, 'listed' | 'boxAnchor'> => ({
    listed: Object.entries(state.comments).map(
      ([handle, { anchor, resolved }]) => ({
        handle,
        anchor,
        isResolved: resolved,
        isOpen: handle === expandedCommentHandle(state),
      }),
    ),
    boxAnchor: state.composer?.anchor ?? null,
  });
  let sentToAgentHandle = (state: CommentsUiState): string | null => {
    let composer = uiState.composer;
    if (state.composer !== null) sentBox = null;
    else if (composer?.sendToAgent === true && composer.anchor === boxAnchor && boxShutsPending === 0)
      sentBox = {
        anchor: composer.anchor,
        listed: Object.keys(uiState.comments),
        turn: uiTurn,
        sinceMs: Date.now(),
      };
    if (sentBox === null) return null;
    let { anchor, listed, turn, sinceMs } = sentBox;
    let newHandle = Object.entries(state.comments).find(
      ([handle, comment]) => !listed.includes(handle) && comment.anchor === anchor && !comment.resolved,
    )?.[0];
    if (newHandle === undefined) return null;
    sentBox = null;
    let isRecent = Date.now() - sinceMs <= SENT_COMMENT_MATCH_MS;
    return turn === uiTurn && isRecent ? newHandle : null;
  };
  let repliedHandlesOf = ({ comments }: CommentsUiState): string[] =>
    Object.keys(comments).filter((handle) => {
      let [messageCount, messageCountBefore] = [comments[handle]?.messageCount, uiState.comments[handle]?.messageCount];
      return messageCount !== undefined && messageCountBefore !== undefined && messageCount > messageCountBefore;
    });
  let takeUiState = (state: CommentsUiState): CommentsUiState | null => {
    if (!isCommentsUiState(state)) return null;
    let [expanded, wasExpanded] = [expandedCommentHandle(state), expandedCommentHandle(uiState)];
    let previewWasCollapsed = collapsedCardHandles(uiState).includes(previewHandle ?? '');
    let repliedTo = repliedHandlesOf(state);
    let listChanged = repliedTo.length > 0 || JSON.stringify(toldStateOf(state)) !== JSON.stringify(toldStateOf(uiState));
    let [hovered, wasHovered] = [hoveredHandlesOf(state), hoveredHandlesOf(uiState)];
    let sentHandle = sentToAgentHandle(state);
    uiState = state;
    if (listChanged)
      listener.told({
        ...toldStateOf(state),
        ...(sentHandle !== null && {
          sentToAgent: sentHandle,
        }),
        ...(repliedTo.length > 0 && {
          repliedTo,
        }),
      });
    if (JSON.stringify(hovered) !== JSON.stringify(wasHovered)) listener.pointedAt(hovered);
    if (expanded !== null && expanded !== wasExpanded && expanded !== askedCard) {
      uiTurn += 1;
      listener.picked(expanded, expanded === previewHandle ? 'preview' : 'list');
    }
    if (wasExpanded === askedCard && expanded !== askedCard) askedCard = null;
    if (wasExpanded === previewHandle && expanded !== previewHandle) previewHandle = null;
    if (
      previewWasCollapsed &&
      previewHandle !== null &&
      !closingCards.has(previewHandle) &&
      (state.comments[previewHandle]?.display ?? null) === null
    ) {
      let handleToPlaceAgain = previewHandle;
      previewHandle = null;
      rePlaceCard(handleToPlaceAgain);
    }
    let collapsedNow = collapsedCardHandles(state).filter((handle) => handle !== previewHandle && handle !== askedCard);
    let newlyCollapsed = collapsedNow.filter((handle) => !collapsedCards.includes(handle));
    if (setUi !== null) collapsedCards = collapsedNow;
    if (newlyCollapsed.length > 0 && setUi !== null) {
      let closing = setUi({
        comments: Object.fromEntries(
          newlyCollapsed.map(
            (handle) => [
              handle,
              {
                display: null,
              },
            ],
          ),
        ),
      });
      for (let handle of newlyCollapsed) waitCardClose(handle, closing);
    }
    if (expanded !== wasExpanded) pickedCardHeight = 0;
    let cardHeight = state.comments[expanded ?? '']?.size?.height;
    if (expanded !== null && typeof cardHeight === 'number' && cardHeight > pickedCardHeight) {
      pickedCardHeight = cardHeight;
      cardHeights.set(expanded, cardHeight);
      askForPlaces();
    }
    let previewCardHeight = expanded === previewHandle ? undefined : state.comments[previewHandle ?? '']?.size?.height;
    let isNewPreviewHeight = previewHeight?.of !== previewHandle || previewHeight.px !== previewCardHeight;
    if (previewHandle !== null && typeof previewCardHeight === 'number' && isNewPreviewHeight) {
      previewHeight = {
        of: previewHandle,
        px: previewCardHeight,
      };
      askForPlaces();
    }
    let isPreviewHovered = expanded !== previewHandle && state.comments[previewHandle ?? '']?.hovered === true;
    let [lastMouseOnPreview, mouseOnPreview] = [previewUnderMouse, isPreviewHovered ? previewHandle : null];
    previewUnderMouse = mouseOnPreview;
    if (mouseOnPreview !== lastMouseOnPreview && (mouseOnPreview !== null || lastMouseOnPreview === previewHandle))
      for (let hear of mouseOnPreviewListeners) hear(mouseOnPreview !== null);
    return state;
  };
  let forgetPlace = (handle: string) => {
    let { [handle]: dropped, ...otherPlaces } = toldPlaces.ofComments;
    toldPlaces = {
      ...toldPlaces,
      ofComments: otherPlaces,
    };
  };
  let askForPlaces = () => {
    isAskingPlaces = true;
    try {
      for (let placesWanted of placesWantedListeners) placesWanted();
    } finally {
      isAskingPlaces = false;
    }
  };
  let rePlaceCard = (handle: string) => {
    forgetPlace(handle);
    askForPlaces();
  };
  let waitCardClose = (handle: string, closing: Promise<CommentsUiState | null>) => {
    let timeout = new Promise<void>((resolve) => void setTimeout(resolve, CARD_CLOSE_WAIT_MS));
    let closedOrTimedOut: CardClosing = Promise.race([closing, timeout]);
    closingCards.set(handle, closedOrTimedOut);
    closedOrTimedOut.finally(() => {
      if (closingCards.get(handle) !== closedOrTimedOut) return;
      closingCards.delete(handle);
      rePlaceCard(handle);
    });
  };
  let endCardPreview = () => {
    if (previewHandle === null || expandedCommentHandle(uiState) === previewHandle || askedCard === previewHandle) return;
    if (setUi === null) return;
    let handle = previewHandle;
    previewHandle = null;
    waitCardClose(
      handle,
      setUi({
        comments: {
          [handle]: {
            display: null,
          },
        },
      }),
    );
  };
  let closeCardNoLongerAsked = (handle: string) => {
    askedCard = null;
    if (setUi === null || handle === previewHandle || !collapsedCardHandles(uiState).includes(handle)) return;
    waitCardClose(
      handle,
      setUi({
        comments: {
          [handle]: {
            display: null,
          },
        },
      }),
    );
  };
  let askCanSendToAgent = () => {
    canSendAskNumber += 1;
    let thisAsk = canSendAskNumber;
    asksWhenReady = commentsCapability === null;
    if (!hasMethod(commentsCapability, 'canSendToAgent')) return;
    let takeAnswer = (answer: AgentReach | null) => {
      if (thisAsk === canSendAskNumber) couldSendToAgent = answer === 'available';
    };
    try {
      Promise.resolve(commentsCapability.canSendToAgent()).then(takeAnswer, () => takeAnswer(null));
    } catch {
      takeAnswer(null);
    }
  };
  let connectCommentsUi = async (): Promise<void> => {
    let agent = getAgent();
    let comments = hasMethod(agent, 'use') ? await agent.use('comments') : null;
    if (!hasMethod(comments, 'ui') || ('available' in comments && comments.available === false)) return;
    let ui = await comments.ui({
      change(state: CommentsUiState) {
        collapsedHandle = null;
        collapsedCards = [];
        takeUiState(state);
      },
    });
    if (!hasMethod(ui, 'set')) return;
    commentsCapability = comments;
    if (asksWhenReady) askCanSendToAgent();
    setUi = (patch) =>
      Promise.resolve(ui.set(patch))
        .then(takeUiState, () => null)
        .then((state) => {
          if (state === null || expandedCommentHandle(state) !== collapsedHandle) collapsedHandle = null;
          return state;
        });
    if (hasMethod(ui, 'exitMode'))
      exitMode = () =>
        Promise.race([
          new Promise<boolean>((resolve) => {
            resolve(ui.exitMode());
          }),
          new Promise<void>((resolve) => void setTimeout(resolve, EXIT_MODE_TIMEOUT_MS)),
        ]);
    if (hasMethod(ui, 'focus'))
      focusCard = (handle, how) =>
        void Promise.resolve(ui.focus(handle, how))
          .then((focused) => (focused === true || how === 'card' ? null : ui.focus(handle, 'card')))
          .catch(() => null);
    listener.told(toldStateOf(uiState));
  };
  return {
    start(newListener) {
      listener = newListener;
      if (setUi !== null) {
        newListener.told(toldStateOf(uiState));
        newListener.pointedAt(hoveredHandlesOf(uiState));
      }
      if (!hasStarted) connectCommentsUi().catch(() => reportFault(Error('agent.use fault: comments')));
      hasStarted = true;
      return () => {
        if (listener === newListener) listener = NO_COMMENTS_LISTENER;
      };
    },
    askWhetherAgentCanBeSent: askCanSendToAgent,
    couldSendToAgentWhenLastAnswered: () => couldSendToAgent,
    openBox({ isForAgent, sheetNumber, ...box }) {
      let composer = {
        ...box,
        ...(sheetNumber !== undefined && {
          detail: commentSheetNumberDetail(sheetNumber),
        }),
      };
      endCardPreview();
      uiTurn += 1;
      let thisTurn = uiTurn;
      let releaseKeys = setUi === null ? null : keepKeysOffCells();
      let tryOpen = () => {
        if (thisTurn !== uiTurn) {
          releaseKeys?.();
          return;
        }
        if (modeEndsPending > 0) return void modeEndSettled.then(tryOpen, tryOpen);
        let lastAnchor = boxAnchor;
        boxAnchor = composer.anchor;
        setUi?.({
          composer: {
            ...composer,
            sendToAgent: isForAgent,
          },
        }).then((state) => {
          if (state?.composer?.anchor === composer.anchor) return state;
          releaseKeys?.();
          if (boxAnchor === composer.anchor) boxAnchor = lastAnchor;
          return state;
        });
      };
      tryOpen();
    },
    open(handle, at, how) {
      if (setUi === null) return;
      let isTaken = (uiState.comments[handle]?.resolved ?? true) || uiState.composer !== null || expandedCommentHandle(uiState) !== null;
      if (how === 'page' && isTaken) return;
      askedCard = handle;
      if (previewHandle === handle && previewHeight?.of !== handle) previewHandle = null;
      collapsedHandle = null;
      uiTurn += 1;
      let thisTurn = uiTurn;
      openTurn = thisTurn;
      let releaseKeys = focusCard === null || how === 'page' ? null : keepKeysOffCells();
      let tryOpen = () => {
        if (thisTurn !== uiTurn) {
          releaseKeys?.();
          if (askedCard === handle && thisTurn === openTurn) closeCardNoLongerAsked(handle);
          return;
        }
        if (boxShutsPending > 0) return void boxShutSettled.then(tryOpen, tryOpen);
        if (modeEndsPending > 0) return void modeEndSettled.then(tryOpen, tryOpen);
        let previewToClose = previewHandle !== null && previewHandle !== handle ? previewHandle : null;
        if (previewToClose !== null) previewHandle = null;
        let setting = setUi?.({
          comments: {
            [handle]: {
              at,
              display: {
                type: 'card',
                expanded: true,
              },
            },
            ...(previewToClose !== null && {
              [previewToClose]: {
                display: null,
              },
            }),
          },
        });
        if (previewToClose !== null && setting !== undefined) waitCardClose(previewToClose, setting);
        if (how === 'page')
          openedFromPage = {
            handle,
            turn: thisTurn,
          };
        setting?.then((state) => {
          if (openedFromPage?.turn === thisTurn) openedFromPage = null;
          const isOpen = state !== null && expandedCommentHandle(state) === handle;
          if (!isOpen) releaseKeys?.();
          if (!isOpen && askedCard === handle && thisTurn === openTurn) closeCardNoLongerAsked(handle);
          if (!isOpen) rePlaceCard(handle);
          if (isOpen) listener.told(toldStateOf(state));
          return state;
        });
        if (how !== 'page') focusCard?.(handle, how);
      };
      tryOpen();
    },
    cardAskedFor: () => askedCard,
    preview(handle, at) {
      let isBusy = expandedCommentHandle(uiState) !== null || askedCard !== null || uiState.composer !== null;
      if (setUi === null || isBusy || previewHandle === handle) return;
      [previewHandle, previewHeight] = [handle, null];
      setUi({
        comments: {
          [handle]: {
            at,
            display: {
              type: 'card',
            },
          },
        },
      }).then((state) => {
        if ((state?.comments[handle]?.display ?? null) !== null) return state;
        if (previewHandle === handle) previewHandle = null;
        rePlaceCard(handle);
        return state;
      });
    },
    endPreview: endCardPreview,
    cardOnItsPoint() {
      if (previewHandle === null) return null;
      return {
        handle: previewHandle,
        isAtRest: expandedCommentHandle(uiState) !== previewHandle,
        isUnderMouse: uiState.comments[previewHandle]?.hovered === true,
      };
    },
    heightOfCard: (handle) => cardHeights.get(handle) ?? null,
    heightOfPreview: (handle) => (handle === previewHandle && previewHeight?.of === handle ? previewHeight.px : null),
    onPlacesWanted(placesWanted) {
      placesWantedListeners.add(placesWanted);
      return () => void placesWantedListeners.delete(placesWanted);
    },
    onMouseOnPreviewChanged(hear) {
      mouseOnPreviewListeners.add(hear);
      return () => void mouseOnPreviewListeners.delete(hear);
    },
    shut() {
      uiTurn += 1;
      let handle = expandedCommentHandle(uiState) ?? openedFromPage?.handle ?? null;
      if (handle !== null && handle !== collapsedHandle)
        setUi?.({
          comments: collapseCard(handle),
        });
    },
    shutBox() {
      if (setUi === null || uiState.composer === null) return;
      let setting = setUi({
        composer: null,
      });
      boxShutsPending += 1;
      let settled = setting.finally(() => {
        boxShutsPending -= 1;
      });
      boxShutSettled = Promise.allSettled([boxShutSettled, settled]);
    },
    canEndMode: () => exitMode !== null,
    endMode(bumpsTurn) {
      if (exitMode === null) return;
      let exiting = exitMode();
      let expectedTurn = bumpsTurn ? uiTurn + 1 : null;
      modeEndsPending += 1;
      let ended = exiting
        .then(
          (exited) => exited === true,
          () => false,
        )
        .then((exited) => {
          modeEndsPending -= 1;
          if (!exited && uiTurn === expectedTurn) uiTurn += 1;
          return exited;
        });
      modeEndSettled = Promise.allSettled([modeEndSettled, ended]);
    },
    tellPlaces(places) {
      if (setUi === null || JSON.stringify(places) === JSON.stringify(toldPlaces)) return;
      if (previewHandle !== null && !(previewHandle in places.ofComments)) endCardPreview();
      let moves: Record<string, CommentUiPatch> = {};
      for (let [handle, at] of Object.entries(places.ofComments))
        if (!closingCards.has(handle))
          moves[handle] = {
            at,
          };
      if (!isAskingPlaces) collapsedCards = [];
      const expanded = expandedCommentHandle(uiState);
      const collapsesExpanded =
        expanded !== null && expanded !== collapsedHandle && expanded in toldPlaces.ofComments && !(expanded in places.ofComments);
      let movesBox =
        boxShutsPending === 0 && uiState.composer?.anchor === boxAnchor && JSON.stringify(places.ofBox) !== JSON.stringify(toldPlaces.ofBox);
      let { anchor, label, detail, area, sendToAgent }: Partial<ComposerUi> = uiState.composer ?? {};
      toldPlaces =
        boxShutsPending === 0
          ? places
          : {
              ...places,
              ofBox: toldPlaces.ofBox,
            };
      setUi({
        comments: {
          ...moves,
          ...(collapsesExpanded && collapseCard(expanded)),
        },
        ...(movesBox && {
          composer: {
            // The box moves only while the composer is open, so it has an anchor.
            anchor: anchor!,
            label,
            detail,
            area,
            sendToAgent,
            at: places.ofBox ?? undefined,
          },
        }),
      }).then((state) => {
        if (state === null)
          toldPlaces = {
            ofComments: {},
            ofBox: null,
          };
        return state;
      });
    },
  };
}
export const expandedCommentHandle = ({ comments }: Pick<CommentsUiState, 'comments'>): string | null =>
  Object.keys(comments).find((handle) => comments[handle]?.display?.expanded === true) ?? null;
export const collapsedCardHandles = ({ comments }: Pick<CommentsUiState, 'comments'>): string[] =>
  Object.keys(comments).filter((handle) => {
    let display = comments[handle]?.display;
    return display?.type === 'card' && display.expanded !== true;
  });
export const isCommentsUiState = (state: unknown): state is CommentsUiState => isNonNullObject(state) && isNonNullObject(state.comments);
export const hasMethod = <T, K extends PropertyKey>(value: T, methodName: K): value is T & Record<K, (...args: never[]) => unknown> =>
  isNonNullObject(value) && typeof value[methodName] === 'function';
export const commentSheetNumberDetail = (sheetNumber: number): string =>
  `The cells are on sheetNumber ${sheetNumber}, where 1 is the first of the sheets that readSheets lists, as the sheets stood when the comment was begun. The numbers in the ids of the path are not positions.`;
export const NO_COMMENTS_LISTENER: HostCommentsListener = {
  told() {},
  picked() {},
  pointedAt() {},
};
export const EXIT_MODE_TIMEOUT_MS = 2000;
export const CARD_CLOSE_WAIT_MS = 1000;
export const SENT_COMMENT_MATCH_MS = 1e4;
export const NO_AGENT_AI_COMMENTS: HostComments = {
  start: () => () => {},
  askWhetherAgentCanBeSent() {},
  couldSendToAgentWhenLastAnswered: () => false,
  openBox() {},
  open() {},
  cardAskedFor: () => null,
  preview() {},
  endPreview() {},
  cardOnItsPoint: () => null,
  heightOfCard: () => null,
  heightOfPreview: () => null,
  onPlacesWanted: () => () => {},
  onMouseOnPreviewChanged: () => () => {},
  shut() {},
  shutBox() {},
  endMode() {},
  tellPlaces() {},
  canEndMode: () => false,
};
export const commentsForOtherSheet = (comments: HostComments): HostComments => ({
  ...NO_AGENT_AI_COMMENTS,
  start() {
    comments.tellPlaces({
      ofComments: {},
      ofBox: null,
    });
    return comments.start({
      told({ listed }) {
        if (listed.some(({ isOpen }) => isOpen)) comments.shut();
      },
      pointedAt() {},
      picked() {},
    });
  },
});
