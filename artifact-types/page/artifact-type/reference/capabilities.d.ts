/**
 * The runtime a page artifact finds as `window.openArtifact` (and `window.claude`, the same object), as frame-host serves it on this
 * computer. See capabilities.md for what each call does here.
 */

/** A rejected call: `code` says why, `message` is for people. */
export interface CapabilityError extends Error {
  code: string;
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Unsubscribe = () => void;

// ---- db -----------------------------------------------------------------------------------------------------------

export interface DocSnapshot {
  id: string;
  ref: DocRef;
  exists: boolean;
  data(): Record<string, Json> | undefined;
  get(field: string): Json | undefined;
}

export interface DocChange {
  type: 'added' | 'modified' | 'removed';
  doc: DocSnapshot;
  oldIndex: number;
  newIndex: number;
}

export interface QuerySnapshot {
  docs: DocSnapshot[];
  size: number;
  empty: boolean;
  forEach(fn: (doc: DocSnapshot) => void): void;
  docChanges(): DocChange[];
}

export type WhereOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'not-in' | 'array-contains';

export interface Query {
  where(field: string, op: WhereOp, value: Json): Query;
  orderBy(field: string, dir?: 'asc' | 'desc'): Query;
  limit(n: number): Query;
  get(): Promise<QuerySnapshot>;
  onSnapshot(next: (snap: QuerySnapshot) => void, error?: (err: CapabilityError) => void): Unsubscribe;
}

export interface CollectionRef extends Query {
  id: string;
  path: string;
  parent: DocRef | null;
  doc(id?: string): DocRef;
  add(data: Record<string, Json>): Promise<DocRef>;
}

export interface DocRef {
  id: string;
  path: string;
  parent: CollectionRef;
  collection(name: string): CollectionRef;
  get(): Promise<DocSnapshot>;
  set(data: Record<string, Json>): Promise<void>;
  update(patch: Record<string, Json>): Promise<void>;
  delete(): Promise<void>;
  acquire(options?: { holder?: string; ttlMs?: number; data?: Json }): Promise<unknown>;
  release(holder?: string): Promise<unknown>;
  onSnapshot(next: (snap: DocSnapshot) => void, error?: (err: CapabilityError) => void): Unsubscribe;
}

export interface Db {
  collection(path: string): CollectionRef;
  doc(path: string): DocRef;
}

// ---- artifact -----------------------------------------------------------------------------------------------------

export type FileContent = string | Blob | ArrayBuffer | ArrayBufferView;

export interface PublishResult {
  version: string;
  changed: { path: string; sha256: string | null }[];
  shas: Record<string, string>;
  unchanged?: true;
}

export interface ArtifactSelf {
  readonly id: string;
  /** A whole new index.html; every open view reloads. */
  publish(html: string): Promise<PublishResult>;
  /** Files beside the page; `null` deletes one. */
  publish(
    files: Record<string, FileContent | null | { content: FileContent; contentType?: string; ifMatch?: string | null } | { delete: true; ifMatch?: string | null }>,
    options?: { ifMatch?: Record<string, string | null> },
  ): Promise<PublishResult>;
  sync(): Promise<{ version: string; files: Record<string, { sha256: string; size: number; contentType: string }> }>;
  metadata(refs: string | string[]): Promise<Record<string, { id: string; title: string; type: string | null }>>;
}

// ---- assets, downloads, permissions -------------------------------------------------------------------------------

export interface Asset {
  id: string;
  url: string;
  sizeBytes: number;
  contentType: string;
  createdAt: string;
}

export interface Assets {
  upload(blob: Blob, options?: { type?: string }): Promise<Asset>;
  list(): Promise<unknown>;
  delete(idOrUrl: string | { id?: string; url?: string }): Promise<{ deleted: boolean }>;
}

export interface Downloads {
  save(options: { filename?: string; data: FileContent | Json }): Promise<{ status: 'saved' }>;
}

export interface Permissions {
  state(name?: string): Promise<string | Record<string, string>>;
  request(names?: string | string[]): Promise<Record<string, string>>;
}

// ---- user ---------------------------------------------------------------------------------------------------------

export interface Me {
  id: string | null;
  name: string;
  avatarUrl: string | null;
  color: string;
  email: string | null;
  isOwner: boolean;
  canEdit: boolean;
}

export interface User {
  me(): Promise<Me>;
  id(): Promise<string | null>;
  name(): Promise<string>;
  avatarUrl(): Promise<string | null>;
  email(): Promise<string | null>;
  isOwner(): Promise<boolean>;
  canEdit(): Promise<boolean>;
  can(permission: string): Promise<boolean | null>;
  profiles(ids: string | string[]): Promise<Record<string, unknown>>;
  access(ids: string | string[]): Promise<Record<string, string | null>>;
  search(q: string): Promise<unknown[]>;
}

// ---- room ---------------------------------------------------------------------------------------------------------

export interface Peer {
  peer: string;
  by: string;
  name: string;
  presence: Record<string, Json>;
  isMe: boolean;
}

export interface Room {
  emit(topic: string, data: Json): Promise<unknown>;
  on(topic: string, handler: (data: Json, from: { peer: string; by: string; isMe: boolean }) => void): Unsubscribe;
  presence(patch: Record<string, Json>): Promise<unknown>;
  peers(): Peer[];
  onPeers(fn: (peers: Peer[]) => void): Unsubscribe;
  connected(): boolean;
  onConnection(fn: (connected: boolean) => void): Unsubscribe;
  join(name: string): Room;
  sendToAgentSession(data: Json, options?: { onStatus?: (status: 'sending' | 'sent' | 'failed') => void }): Promise<{ to: string }>;
  canSendToAgentSession(): Promise<boolean>;
}

// ---- comments -----------------------------------------------------------------------------------------------------

export interface CommentSendDecision {
  handled?: boolean;
  reply?: string;
  handoffNote?: string;
}

export interface Comments {
  list(): Promise<unknown[]>;
  create(options: { anchor?: Json; label?: string; text: string }): Promise<{ threadId: string; commentId: string }>;
  reply(threadId: string, text: string): Promise<{ threadId: string; commentId: string }>;
  resolve(threadId: string, resolved?: boolean): Promise<void>;
  delete(threadId: string, commentId?: string): Promise<void>;
  openComposer(options?: { element?: Element }): Promise<unknown>;
  anchorFor(element: Element): { path: string; x: number; y: number };
  /** Unsubscribe with the returned function. A handled send ends on the page. */
  onSendToAgent(listener: (payload: { threadId?: string; text?: string; anchor?: Json; label?: string; detail?: string }) => void | CommentSendDecision | Promise<void | CommentSendDecision>): () => void;
  sendToAgent(options: Record<string, Json>): Promise<unknown>;
  canSendToAgent(): Promise<'available' | 'no_session' | 'off'>;
}

// ---- the object -----------------------------------------------------------------------------------------------------

export interface Network {
  /** External origins the host grants this type. */
  origins(): Promise<string[]>;
}

export interface Capabilities {
  network: Network;
  db: Db;
  artifact: ArtifactSelf;
  self: ArtifactSelf;
  assets: Assets;
  downloads: Downloads;
  user: User;
  room: Room;
  comments: Comments;
  permissions: Permissions;
}

export interface PageRuntime {
  /** The runtime contract this computer serves. */
  readonly contract: string;
  /** A capability's namespace, or null (not declared, or not available here). */
  use<K extends keyof Capabilities>(name: K): Promise<Capabilities[K] | null>;
  use(name: string): Promise<unknown | null>;
}

declare global {
  interface Window {
    readonly openArtifact: PageRuntime;
    /** The same object, for a page written for claude.ai. */
    readonly claude: PageRuntime;
  }
}
