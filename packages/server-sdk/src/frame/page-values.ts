/** Data shared by page capabilities and the frame host. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type JsonObject = { [key: string]: Json };

/**
 * A viewer's level, lowest first: `view` reads, `interact` writes what a page's rules let it, `admin` edits the
 * artifact, `owner` owns it. The core checks every call against it (access.ts holds the rules).
 */
export type FrameLevel = 'view' | 'interact' | 'admin' | 'owner';

export interface FileEntry {
  sha256: string;
  size: number;
  contentType: string;
}

export interface PublishResult {
  version: string;
  changed: { path: string; sha256: string | null }[];
  shas: Record<string, string>;
  unchanged?: true;
}

export interface BlobInfo {
  id: string;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
  url: string;
}

export interface BlobList {
  assets: BlobInfo[];
  usage: { files: number; bytes: number; maxFiles: number; maxBytes: number };
}

export interface Author {
  kind: 'user' | 'agent';
  name: string;
}

/** One person's emoji on a message. */
export interface MessageReaction {
  emoji: string;
  author: Author;
  at: string;
}

export interface CommentMessage {
  id: string;
  author: Author;
  text: string;
  at: string;
  editedAt?: string;
  /** Who the message asks, as the page named them (`agent` asks the agent). */
  to?: string[];
  reactions?: MessageReaction[];
  /** The agent's reply to a message that was sent to it without asking it (no `@agent`): it joined without being asked. */
  joined?: boolean;
}

export interface ThreadAgentState {
  status: 'pending' | 'delivered' | 'replied';
  sentAt?: string;
  deliveredAt?: string;
  repliedAt?: string;
  via?: string;
  /** When a reply that did not ask the agent was sent to it after it had answered; its next reply has `joined`. */
  unaskedAt?: string;
}

export interface Thread {
  id: string;
  anchor: string;
  label: string;
  detail?: string;
  location: Record<string, unknown>;
  status: 'open' | 'resolved';
  agent?: ThreadAgentState;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  /** Who resolved it, while it is resolved. */
  resolvedBy?: Author;
  messages: CommentMessage[];
}
