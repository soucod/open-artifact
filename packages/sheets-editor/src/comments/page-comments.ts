import { createComments, openMessageCount, type RoleAbilities, type ShellBridge } from '@open-artifact/editor-kit';
import type { AgentBadge } from '@open-artifact/editor-kit/react';
import type { AgentStatus, CommentsCapability, CommentThread } from '@open-artifact/runtime';
import { create } from 'zustand';
import { isNonNullObject } from '../utils/objects.ts';
import { COMMENT_MODE_ATTRIBUTE } from './comment-mode.ts';
import { AWAITS_KEYBOARD_ATTRIBUTE } from '../ui/keyboard-handoff.ts';

export const COMMENTS_LAYER_MARK = 'data-comments-layer';
export const COMMENT_CARD_SELECTOR = '[data-comment-card]';
const REPLY_FIELD_SELECTOR = `${COMMENT_CARD_SELECTOR} [data-cds-part=reply-field] textarea`;
const REPLY_FOCUS_TRIES = 30;
const REPLY_FOCUS_WAIT_MS = 16;
const ESCAPE_AFTER_COMPOSITION_MS = 500;
const NOT_TYPED_INPUTS = /^(checkbox|radio|range|button|submit|reset|image)$/i;

export interface PagePoint {
  x: number;
  y: number;
}

export interface CardDisplay {
  type: 'card';
  expanded?: boolean;
}

export interface CommentUiEntry {
  anchor: string;
  resolved: boolean;
  display: CardDisplay | null;
  at?: PagePoint;
  hovered: boolean;
  messageCount: number;
  size?: { height: number };
}

export interface ComposerUi {
  anchor: string;
  at?: PagePoint;
  label?: string;
  detail?: string;
  area?: boolean;
  sendToAgent: boolean;
}

export interface CommentsUiState {
  comments: Record<string, CommentUiEntry>;
  composer: ComposerUi | null;
}

/** A type alias rather than an interface, so that the object check in applyPatch keeps its fields. */
export type CommentUiPatch = {
  at?: PagePoint | null;
  display?: CardDisplay | null;
};

export interface ComposerPatch {
  anchor: string;
  at?: PagePoint;
  label?: string;
  detail?: string;
  area?: boolean;
  sendToAgent?: boolean;
}

export interface CommentsUiPatch {
  comments?: Record<string, CommentUiPatch>;
  composer?: ComposerPatch | null;
}

export type CardFocus = 'reply' | 'card' | 'page';

export interface CommentsUiListener {
  change(state: CommentsUiState): void;
}

export interface CommentsUi {
  set(patch: CommentsUiPatch): Promise<CommentsUiState>;
  focus(handle: string, how: CardFocus): Promise<boolean>;
  exitMode(): Promise<boolean>;
  release(): void;
}

export type AgentReach = 'available' | 'unavailable';

/** The page's comments: threads drawn by the host over the cells the page marks. */
export interface PageComments {
  available: boolean;
  ui(listener: CommentsUiListener): Promise<CommentsUi>;
  canSendToAgent(): Promise<AgentReach>;
}

/** What a thread is on: the page's anchor, with what the page said of it when the comment was begun. */
export interface CommentAnchor {
  anchor: string;
  label: string;
  detail?: string;
  area?: boolean;
}

export interface CommentNotice {
  title: string;
  description?: string;
}

interface CommentCardsState {
  /** The open card is a preview (it opened under the mouse and has not been pressed). */
  preview: string | null;
  /** Where the page wants each card, in page pixels. */
  places: Record<string, PagePoint>;
  /** Where the page wants the composer. */
  composerAt: PagePoint | null;
  /** Where the composer is drawn: the page's place, or where it opened. */
  composerShownAt: PagePoint | null;
  /** Where an open card with no place of its own is drawn. */
  cardShownAt: PagePoint | null;
  hovered: boolean;
  height: number | null;
  agent: AgentBadge;
}

let abilities: RoleAbilities | null = null;
let notifier: ((notice: CommentNotice) => void) | null = null;

/** Shows the comments' notices (a toast); returns a function that stops. */
export function setCommentNotifier(show: (notice: CommentNotice) => void): () => void {
  notifier = show;
  return () => {
    if (notifier === show) notifier = null;
  };
}

const notify = (notice: CommentNotice): void => notifier?.(notice);

export const useCommentCards = create<CommentCardsState>()(() => ({
  preview: null,
  places: {},
  composerAt: null,
  composerShownAt: null,
  cardShownAt: null,
  hovered: false,
  height: null,
  agent: { available: false, name: 'Agent' },
}));

export const pageComments = createComments<CommentAnchor>({
  notify,
  parse: (text) => ({ anchor: text, label: '' }),
  serialize: (anchor) => anchor.anchor,
  label: (anchor) => anchor.label || 'Comment',
  detail: (anchor) => anchor.detail,
  location: (anchor): Record<string, boolean> => (anchor.area ? { area: true } : {}),
  canComment: () => abilities?.canComment ?? false,
  canSendToAgent: () => (abilities?.canAsk ?? false) && useCommentCards.getState().agent.available,
  canRemove: () => abilities?.canRemoveComments ?? false,
  agentName: () => useCommentCards.getState().agent.name,
  agentWakesIdle: () => useCommentCards.getState().agent.wakesIdle,
  noun: 'sheet',
  opensCreated: (sent) => sent,
});

export const useComments = pageComments.store;

const pointOf = (value: unknown): PagePoint | null =>
  isNonNullObject(value) && Number.isFinite(value.x) && Number.isFinite(value.y) ? { x: Number(value.x), y: Number(value.y) } : null;

const viewCentre = (win: Window): PagePoint => ({ x: win.scrollX + win.innerWidth / 2, y: win.scrollY + win.innerHeight / 2 });

const listedThreads = (threads: readonly CommentThread[], active: string | null): CommentThread[] => {
  const open = threads.filter((thread) => thread.status === 'open');
  const shownResolved = threads.find((thread) => thread.id === active && thread.status === 'resolved');
  return shownResolved === undefined ? open : [...open, shownResolved];
};

export function commentsUiState(): CommentsUiState {
  const { threads, active, draft, sendNew } = useComments.getState();
  const { preview, places, composerAt, hovered, height } = useCommentCards.getState();
  const comments: Record<string, CommentUiEntry> = {};
  for (const thread of listedThreads(threads, active)) {
    const isOpen = thread.id === active;
    const at = places[thread.id];
    comments[thread.id] = {
      anchor: thread.anchor,
      resolved: thread.status === 'resolved',
      display: isOpen ? { type: 'card', expanded: thread.id !== preview } : null,
      ...(at === undefined ? {} : { at: { ...at } }),
      hovered: isOpen && hovered,
      messageCount: thread.messages.length,
      ...(isOpen && height !== null ? { size: { height } } : {}),
    };
  }
  return {
    comments,
    composer:
      draft === null
        ? null
        : {
            anchor: draft.anchor,
            ...(composerAt === null ? {} : { at: { ...composerAt } }),
            ...(draft.label ? { label: draft.label } : {}),
            ...(draft.detail ? { detail: draft.detail } : {}),
            ...(draft.area ? { area: true } : {}),
            sendToAgent: sendNew,
          },
  };
}

export function closeCommentCard(): void {
  useCommentCards.setState({ preview: null, cardShownAt: null, hovered: false, height: null });
  if (useComments.getState().active !== null) useComments.getState().setActive(null);
}

export function closeCommentComposer(): void {
  useCommentCards.setState({ composerAt: null, composerShownAt: null });
  if (useComments.getState().draft !== null) useComments.getState().setDraft(null);
}

/** Turns comment mode on or off (on only for someone who may comment). */
export function setCommentMode(on: boolean): void {
  if (on && !pageComments.canComment()) return;
  if (useComments.getState().on !== on) useComments.getState().setOn(on);
}

/** The pressed preview stays open as a card. */
export function keepPreviewOpen(): void {
  const { preview } = useCommentCards.getState();
  if (preview !== null && preview === useComments.getState().active) useCommentCards.setState({ preview: null });
}

function openCard(handle: string, win: Window): void {
  if (!useComments.getState().threads.some((thread) => thread.id === handle)) return;
  if (useComments.getState().active !== handle) {
    useComments.getState().setActive(handle);
    useCommentCards.setState({ hovered: false, height: null });
  }
  if (useCommentCards.getState().places[handle] === undefined) useCommentCards.setState({ cardShownAt: viewCentre(win) });
}

function openComposer(patch: ComposerPatch, at: PagePoint | null, win: Window): void {
  if (!pageComments.canComment()) {
    notify({ title: 'You can read the comments here', description: 'Adding comments needs a commenter or editor link from the owner.' });
    return;
  }
  const state = useComments.getState();
  state.setDraft({
    anchor: patch.anchor,
    label: typeof patch.label === 'string' && patch.label ? patch.label : 'Comment',
    ...(typeof patch.detail === 'string' && patch.detail ? { detail: patch.detail } : {}),
    ...(patch.area === true ? { area: true } : {}),
  });
  state.setSendNew(patch.sendToAgent === true && pageComments.canSendToAgent());
  useCommentCards.setState({ preview: null, composerAt: at, composerShownAt: at ?? viewCentre(win) });
}

function applyPatch(patch: CommentsUiPatch, win: Window): void {
  for (const [handle, change] of Object.entries(patch.comments ?? {})) {
    if (!isNonNullObject(change)) continue;
    const at = pointOf(change.at);
    if (at !== null) useCommentCards.setState((cards) => ({ places: { ...cards.places, [handle]: at } }));
    else if (change.at === null)
      useCommentCards.setState((cards) => {
        const { [handle]: _, ...places } = cards.places;
        return { places };
      });
    const { active, draft } = useComments.getState();
    if (change.display === undefined) continue;
    const display = change.display;
    const { preview, places } = useCommentCards.getState();
    if (display !== null && display.type === 'card') {
      const where = at ?? places[handle] ?? null;
      if (display.expanded === true) {
        if (preview === handle) useCommentCards.setState({ preview: null });
        if (where !== null) openCard(handle, win);
      } else if (where !== null && (active === null || active === handle) && draft === null) {
        if (active !== handle) useCommentCards.setState({ preview: handle });
        openCard(handle, win);
      }
    } else {
      if (preview === handle) useCommentCards.setState({ preview: null });
      if (active === handle) closeCommentCard();
    }
  }
  const composer = patch.composer;
  if (composer === null) closeCommentComposer();
  else if (isNonNullObject(composer) && typeof composer.anchor === 'string') {
    const at = pointOf(composer.at);
    const draft = useComments.getState().draft;
    if (draft !== null && draft.anchor === composer.anchor) {
      if (at !== null) useCommentCards.setState({ composerAt: at, composerShownAt: at });
    } else openComposer(composer, at, win);
  }
}

const isInLayer = (target: EventTarget | null): boolean => target instanceof Element && target.hasAttribute(COMMENTS_LAYER_MARK);

function layerRoot(doc: Document): ShadowRoot | null {
  return doc.querySelector(`[${COMMENTS_LAYER_MARK}]`)?.shadowRoot ?? null;
}

function focusReply(doc: Document): boolean {
  const field = layerRoot(doc)?.querySelector<HTMLTextAreaElement>(REPLY_FIELD_SELECTOR) ?? null;
  if (field === null) return false;
  field.focus({ preventScroll: true });
  return true;
}

function typesText(event: KeyboardEvent, win: Window): boolean {
  if (win.document.designMode === 'on') return true;
  const target = event.composedPath()[0] ?? event.target;
  if (!(target instanceof Element)) return false;
  const field = target.closest('input,textarea,select');
  if (field !== null) return !(field.tagName === 'INPUT' && NOT_TYPED_INPUTS.test(field.getAttribute('type') ?? ''));
  return target instanceof HTMLElement && target.isContentEditable;
}

/** Keys and focus around the cards: Escape closes the top one, focus inside them leaves the cells. */
function watchKeysAndFocus(win: Window): () => void {
  const doc = win.document;
  let focusedBefore: Element | null = null;
  let holdsKeyboard = false;
  let compositionEnded = -Infinity;
  const hold = (holds: boolean): void => {
    if (holds === holdsKeyboard) return;
    holdsKeyboard = holds;
    doc.querySelector(`[${COMMENTS_LAYER_MARK}]`)?.toggleAttribute(AWAITS_KEYBOARD_ATTRIBUTE, holds);
    win.dispatchEvent(new FocusEvent(holds ? 'blur' : 'focus'));
  };
  const holdIfFocused = (): void => hold(doc.activeElement !== null && isInLayer(doc.activeElement));
  const onFocusIn = (event: FocusEvent): void => {
    const inLayer = event.composedPath().some(isInLayer);
    if (!inLayer && event.target instanceof Element) focusedBefore = event.target;
    hold(inLayer);
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (!event.composedPath().some(isInLayer)) hold(false);
  };
  const onCompositionEnd = (event: CompositionEvent): void => {
    compositionEnded = event.timeStamp;
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.repeat || event.isComposing) return;
    if (event.keyCode === 229 || event.timeStamp - compositionEnded < ESCAPE_AFTER_COMPOSITION_MS) return;
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || typesText(event, win)) return;
    win.setTimeout(() => {
      if (event.defaultPrevented) return;
      const { active, draft, on } = useComments.getState();
      if (active !== null) closeCommentCard();
      else if (draft !== null) closeCommentComposer();
      else if (on) setCommentMode(false);
    }, 0);
  };
  let wasShowing = false;
  const stopWatching = useComments.subscribe(({ active, draft }) => {
    const showing = active !== null || draft !== null;
    if (wasShowing && !showing)
      win.setTimeout(() => {
        const now = doc.activeElement;
        if ((now === null || now === doc.body) && focusedBefore?.isConnected) (focusedBefore as HTMLElement).focus?.({ preventScroll: true });
        holdIfFocused();
      }, 0);
    wasShowing = showing;
  });
  win.addEventListener('focusin', onFocusIn, true);
  win.addEventListener('pointerdown', onPointerDown, true);
  win.addEventListener('compositionend', onCompositionEnd, true);
  win.addEventListener('keydown', onKeyDown);
  return () => {
    stopWatching();
    win.removeEventListener('focusin', onFocusIn, true);
    win.removeEventListener('pointerdown', onPointerDown, true);
    win.removeEventListener('compositionend', onCompositionEnd, true);
    win.removeEventListener('keydown', onKeyDown);
  };
}

function createPageCommentsApi(win: Window): PageComments {
  let change: ((state: CommentsUiState) => void) | null = null;
  let told = '';
  let applying = false;
  const tell = (): void => {
    const listener = change;
    if (listener === null || applying) return;
    const state = commentsUiState();
    const json = JSON.stringify(state);
    if (json === told) return;
    told = json;
    try {
      listener(state);
    } catch (error) {
      console.error('comments: the page threw', error);
    }
  };
  useComments.subscribe(({ active }) => {
    const { preview } = useCommentCards.getState();
    if (preview !== null && preview !== active) useCommentCards.setState({ preview: null });
    if (active === null && useCommentCards.getState().cardShownAt !== null) useCommentCards.setState({ cardShownAt: null });
    tell();
  });
  useCommentCards.subscribe(tell);
  return {
    available: true,
    async ui(listener) {
      if (!isNonNullObject(listener) || typeof listener.change !== 'function') throw Object.assign(new Error('ui takes a change callback'), { code: 'invalid' });
      const own = listener.change.bind(listener);
      change = own;
      told = '';
      win.setTimeout(tell, 0);
      return {
        async set(patch) {
          if (!isNonNullObject(patch)) throw Object.assign(new Error('set takes a patch: {comments?, composer?}'), { code: 'invalid' });
          applying = true;
          try {
            applyPatch(patch, win);
          } finally {
            applying = false;
          }
          const state = commentsUiState();
          told = JSON.stringify(state);
          return state;
        },
        async focus(handle, how) {
          if (useComments.getState().active !== handle) return false;
          if (how !== 'reply') return true;
          for (let tries = 0; tries < REPLY_FOCUS_TRIES; tries += 1) {
            if (useComments.getState().active !== handle) return false;
            if (focusReply(win.document)) return true;
            await new Promise((resolve) => win.setTimeout(resolve, REPLY_FOCUS_WAIT_MS));
          }
          return false;
        },
        async exitMode() {
          setCommentMode(false);
          return true;
        },
        release() {
          if (change === own) change = null;
        },
      };
    },
    canSendToAgent: async () => (pageComments.canSendToAgent() ? 'available' : 'unavailable'),
  };
}

export interface PageCommentsOptions {
  capability: CommentsCapability;
  abilities: RoleAbilities;
  bridge: ShellBridge;
  agentStatus: AgentStatus | null;
  onAgentStatus(listener: (status: AgentStatus) => void): () => void;
  window: Window;
}

const badgeOf = (status: AgentStatus | null): AgentBadge => ({
  available: status?.available ?? false,
  name: status?.name || 'Agent',
  ...(status?.wakesIdle === undefined ? {} : { wakesIdle: status.wakesIdle }),
});

/** Starts the page's comments: threads, cards, comment mode and the Shell's Comments button. */
export function startPageComments({ capability, abilities: given, bridge, agentStatus, onAgentStatus, window: win }: PageCommentsOptions): PageComments {
  abilities = given;
  useCommentCards.setState({ agent: badgeOf(agentStatus) });
  onAgentStatus((status) => useCommentCards.setState({ agent: badgeOf(status) }));
  const api = createPageCommentsApi(win);
  const reportToShell = (): void => {
    const { available, on, listOpen, threads } = useComments.getState();
    bridge.setShellReport({ comments: { available, on, open: listOpen, count: openMessageCount(threads), pageButton: false } });
  };
  useComments.subscribe((state, previous) => {
    if (state.on !== previous.on) win.document.documentElement.toggleAttribute(COMMENT_MODE_ATTRIBUTE, state.on);
    if (state.on !== previous.on || state.threads !== previous.threads || state.listOpen !== previous.listOpen || state.available !== previous.available)
      reportToShell();
  });
  bridge.onShellCommand((command) => {
    if (command.cmd === 'comments_mode') setCommentMode(command.on ?? !useComments.getState().on);
    else if (command.cmd === 'comments_list') useComments.getState().setListOpen(command.open ?? !useComments.getState().listOpen);
  });
  watchKeysAndFocus(win);
  const open = new URLSearchParams(win.location.search).get('comment');
  void pageComments.start(capability, open);
  reportToShell();
  return api;
}
