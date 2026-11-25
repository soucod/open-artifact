import type { WakeStatus } from '@open-artifact/protocol';
import type { Author, CommentMessage, Thread, ThreadAgentState } from './page-values.ts';

/** A pin's position relative to an element, produced by anchorFor and domAnchor. */
export interface PageElementAnchor {
  path: string;
  x: number;
  y: number;
}

export interface PagePoint {
  x: number;
  y: number;
}
type PinPosition = PagePoint | Element | null;
type Opened = { opened: boolean };
type MessageId = { threadId: string; commentId: string };

export interface PageThreadPin {
  id: string;
  anchor: unknown;
  resolved: boolean;
  active: boolean;
}

/** What comments.list() exposes to this viewer. Author identity depends on the viewer's grants. */
export interface PageCommentThread extends Pick<Thread, 'id' | 'label' | 'createdAt' | 'updatedAt' | 'status'> {
  anchor: unknown;
  resolved: boolean;
  agent: ThreadAgentState | null;
  messages: (Pick<CommentMessage, 'id' | 'text' | 'at'> & { author: Author & { principal?: string; mine?: true } })[];
}

export interface PageCommentSend {
  threadId?: string;
  anchor?: unknown;
  text?: string;
  label?: string;
  detail?: string;
}

export interface PageCommentDecision {
  handled?: boolean;
  reply?: string;
  handoffNote?: string;
}
export type PageCommentListener = (payload: PageCommentSend) => void | PageCommentDecision | Promise<void | PageCommentDecision>;

export interface FrameAnchorCallbacks {
  pinsOutsideMode?: boolean;
  mode?(on: boolean): void;
  threads?(pins: PageThreadPin[]): void;
  reveal?(threadId: string): void;
  composing?(open: boolean | null): void;
  move?(threadId: string, documentPoint: PagePoint): PageAnchorMove | null | void | Promise<PageAnchorMove | null | void>;
}
export interface PageAnchorMove {
  anchor: string;
  label?: string;
  detail?: string;
}

export interface PageAnchorController {
  compose(anchor: unknown, at?: PinPosition, options?: { label?: string; detail?: string; area?: boolean }): Promise<Opened>;
  open(threadId: string, at?: PinPosition): Promise<Opened>;
  placed(positions: Readonly<Record<string, PinPosition>>): void;
  domAnchor(element: Element, event?: MouseEvent): PageElementAnchor;
  exitMode(): void;
  release(): void;
  readonly areas: undefined;
}

export interface FrameComments {
  openComposer(options?: { element?: Element }): Promise<Opened>;
  anchorFor(element: Element): PageElementAnchor;
  create(options: { anchor?: unknown; text: string; label?: string }): Promise<MessageId>;
  reply(threadId: string, text: string): Promise<MessageId>;
  reply(comment: { threadId: string; text: string }): Promise<MessageId>;
  resolve(threadId: string, resolved?: boolean): Promise<void>;
  delete(threadId: string, commentId?: string): Promise<void>;
  list(): Promise<PageCommentThread[]>;
  sendToAgent(options: PageCommentSend): Promise<{ status: 'handled'; reply?: string } | { status: WakeStatus; threadId: string; thread: PageCommentThread; reply?: string }>;
  canSendToAgent(): Promise<'available' | 'no_session' | 'off' | 'writers_only'>;
  onSendToAgent(listener: PageCommentListener): () => void;
  customAnchors(callbacks?: FrameAnchorCallbacks): Promise<PageAnchorController>;
}
