// Page-side types for services supplied by frame-host. Values involving the viewer
// reflect the scopes of this artifact's declaration and the viewer's level.
import type { BlobInfo, BlobList, FileEntry, FrameLevel, Json, JsonObject, PublishResult } from './page-values.ts';
import type { LocalUser, Peer } from './wire.ts';

export type PageFileContent = string | Blob | ArrayBuffer | ArrayBufferView;
export type PageFileWrite = PageFileContent | null
  | { content: PageFileContent; contentType?: string; ifMatch?: string | null }
  | { delete: true; ifMatch?: string | null };
export interface PageArtifactInfo { id: string; title: string; type: string | null }

export interface PageArtifact {
  readonly id: string;
  publish(html: string): Promise<PublishResult>;
  publish(files: Record<string, PageFileWrite>, options?: { ifMatch?: Record<string, string | null> }): Promise<PublishResult>;
  sync(): Promise<{ version: string; files: Record<string, FileEntry> }>;
  metadata(refs: string | string[]): Promise<Record<string, PageArtifactInfo>>;
  search(query: string, options?: Record<string, unknown>): Promise<{ results: PageArtifactInfo[] }>;
  edit(): Promise<never>;
}

export interface PageAssets {
  upload(blob: Blob, options?: { type?: string }): Promise<BlobInfo>;
  list(): Promise<BlobList>;
  delete(ref: string | { id?: string; url?: string }): Promise<{ deleted: boolean }>;
}

export interface PageDownloads {
  save(options: { filename?: string; data: PageFileContent | Json; request?: string }): Promise<{ status: 'saved' }>;
}

export type PagePermissionState = PermissionState | 'unavailable';
export interface PagePermissions {
  state(): Promise<Record<string, PagePermissionState>>;
  state(name: string): Promise<PagePermissionState>;
  state(name?: string): Promise<PagePermissionState | Record<string, PagePermissionState>>;
  request(names?: string | string[]): Promise<Record<string, PagePermissionState>>;
  manage(): Promise<void>;
}

export type PageMe = Omit<LocalUser, 'id'> & { id: string | null };
export interface PagePerson extends Pick<LocalUser, 'id' | 'name' | 'avatarUrl' | 'color' | 'email'> {
  isMe: boolean;
  guest: boolean;
  roles: null;
}
export interface PageUser {
  me(): Promise<PageMe>;
  id(): Promise<string | null>;
  name(): Promise<string>;
  avatarUrl(): Promise<string | null>;
  email(): Promise<string | null>;
  isOwner(): Promise<boolean>;
  canEdit(): Promise<boolean>;
  can(permission: string): Promise<boolean | null>;
  profiles(ids: string | string[]): Promise<Record<string, PagePerson> | null>;
  access(ids: string | string[]): Promise<Record<string, FrameLevel | null> | null>;
  search(query: string): Promise<PagePerson[] | null>;
}

export interface PageRoomPeer extends Peer { isMe: boolean }
export interface PageRoomSender {
  peer: string;
  by: string | null;
  isMe: boolean;
  sameTab: boolean;
  kind: 'user';
  guest: false;
}
export type PageRoomMessageListener = (data: Json, sender: PageRoomSender) => void;
export type PageSendStatus = 'sending' | 'sent' | 'failed';
export interface PageRoom {
  emit(topic: string, data: Json): Promise<Record<string, never>>;
  on(topic: string, listener: PageRoomMessageListener): () => void;
  presence(patch: JsonObject): Promise<Record<string, never>>;
  peers(): PageRoomPeer[];
  onPeers(listener: (peers: PageRoomPeer[]) => void): () => void;
  connected(): boolean;
  onConnection(listener: (connected: boolean) => void): () => void;
  sendToAgentSession(data: Json, options?: { deliver?: 'send' | 'stage'; onStatus?: (status: PageSendStatus) => void }): Promise<{ to: string }>;
  canSendToAgentSession(): Promise<boolean>;
  join(name: string): PageRoom;
}

export interface FrameServices {
  artifact: PageArtifact;
  self: PageArtifact;
  assets: PageAssets;
  downloads: PageDownloads;
  permissions: PagePermissions;
  user: PageUser;
  room: PageRoom;
  network: { origins(): Promise<string[]> };
}
