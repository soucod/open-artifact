/** JSON stored in page documents. Snapshots also freeze nested arrays and objects. */
export type FrameDbValue = null | string | number | boolean | readonly FrameDbValue[] | FrameDocument;
export interface FrameDocument { readonly [field: string]: FrameDbValue }

export type FrameWhereOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'not-in' | 'array-contains';
export type FrameDbError = Error & { code: string };
export type FrameSnapshotListener<T> =
  | ((snapshot: T) => void)
  | { next(snapshot: T): void; error?(reason: FrameDbError): void };

export interface FrameSnapshotMetadata {
  readonly fromCache: boolean;
  readonly hasPendingWrites: boolean;
}

export interface FrameDocSnapshot {
  readonly id: string;
  readonly ref: FrameDocRef;
  readonly exists: boolean;
  readonly metadata: FrameSnapshotMetadata;
  data(): FrameDocument | undefined;
  get(field: string): FrameDbValue | undefined;
}

export interface FrameDocumentChange {
  readonly type: 'added' | 'modified' | 'removed';
  readonly doc: FrameDocSnapshot;
  readonly oldIndex: number;
  readonly newIndex: number;
}

export interface FrameQuerySnapshot {
  readonly docs: readonly FrameDocSnapshot[];
  readonly size: number;
  readonly empty: boolean;
  readonly metadata: FrameSnapshotMetadata;
  forEach(fn: (doc: FrameDocSnapshot, index: number, docs: readonly FrameDocSnapshot[]) => void, thisArg?: unknown): void;
  docChanges(): readonly FrameDocumentChange[];
}

export interface FrameQuery {
  where(field: string, op: FrameWhereOp, value: FrameDbValue): FrameQuery;
  orderBy(field: string, dir?: 'asc' | 'desc'): FrameQuery;
  limit(count: number): FrameQuery;
  get(): Promise<FrameQuerySnapshot>;
  onSnapshot(listener: FrameSnapshotListener<FrameQuerySnapshot>, error?: (reason: FrameDbError) => void): () => void;
}

export interface FrameCollectionRef extends FrameQuery {
  readonly id: string;
  readonly path: string;
  readonly parent: FrameDocRef | null;
  doc(id?: string): FrameDocRef;
  add(data: FrameDocument): Promise<FrameDocRef>;
}

/** Times are Unix milliseconds; a busy lease only names its holder when the viewer owns it. */
export type FrameLease =
  | { acquired: true; version: number; expiresAt: number; holder: string }
  | { acquired: false; expiresAt?: number; holder?: string };
export interface FrameLeaseOptions { holder?: string; ttlMs?: number; data?: FrameDocument }

export interface FrameDocRef {
  readonly id: string;
  readonly path: string;
  readonly parent: FrameCollectionRef;
  collection(name: string): FrameCollectionRef;
  get(): Promise<FrameDocSnapshot>;
  set(data: FrameDocument): Promise<void>;
  update(data: FrameDocument): Promise<void>;
  delete(): Promise<void>;
  acquire(options?: FrameLeaseOptions): Promise<FrameLease>;
  release(holder?: string): Promise<{ released: boolean }>;
  onSnapshot(listener: FrameSnapshotListener<FrameDocSnapshot>, error?: (reason: FrameDbError) => void): () => void;
}

export interface FrameDatabase {
  collection(path: string): FrameCollectionRef;
  doc(path: string): FrameDocRef;
}
