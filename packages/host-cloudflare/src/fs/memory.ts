/**
 * A file tree in memory, for the paths no mount covers (`os.tmpdir()` scratch files of exports and imports). It is
 * shared by everything in the isolate and lost with it, so it is bounded: a write that would take it past `maxBytes`
 * fails with `ENOSPC`.
 */
import { type Backend, type DirEntry, type Inode, type Lookup, type StorageCounters, type Usage, copyBytes, emptyCounters } from './backend.ts';
import { fsError } from './errors.ts';

interface MemoryNode extends Inode {
  data: Uint8Array;
  children: Map<string, MemoryNode> | null;
}

let devices = 0x0b000000;

export class MemoryBackend implements Backend {
  readonly kind = 'memory';
  readonly dev = ++devices;
  readonly readOnly = false;
  private readonly root: MemoryNode;
  private nextIno = 2;
  private bytes = 0;

  readonly maxBytes: number;

  constructor(maxBytes: number) {
    this.maxBytes = maxBytes;
    this.root = { ino: 1, dir: true, size: 0, mtimeMs: Date.now(), mode: 0o777, data: new Uint8Array(0), children: new Map() };
  }

  /** Every change is checked before it is made (the byte bound included), so nothing can fail half-way. */
  transaction<T>(fn: () => T): T {
    return fn();
  }

  lookup(rel: string): Lookup {
    let node = this.root;
    if (rel === '') return node;
    const parts = rel.split('/');
    for (let i = 0; i < parts.length; i++) {
      if (!node.children) return 'notdir';
      const next = node.children.get(parts[i]!);
      if (!next) return null;
      node = next;
    }
    return node;
  }

  list(_rel: string, dir: Inode): DirEntry[] {
    const children = (dir as MemoryNode).children ?? new Map<string, MemoryNode>();
    return [...children.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([name, node]) => ({ name, node }));
  }

  isEmpty(_rel: string, dir: Inode): boolean {
    return ((dir as MemoryNode).children?.size ?? 0) === 0;
  }

  read(_rel: string, node: Inode, start: number, end: number): Uint8Array {
    return (node as MemoryNode).data.slice(start, Math.min(end, node.size));
  }

  put(rel: string, existing: Inode | null, bytes: Uint8Array, mode: number, mtimeMs: number): Inode {
    this.reserve(bytes.length - (existing?.size ?? 0), rel);
    const data = copyBytes(bytes);
    if (existing) {
      const node = existing as MemoryNode;
      Object.assign(node, { data, size: data.length, mtimeMs });
      return node;
    }
    const node: MemoryNode = { ino: this.nextIno++, dir: false, size: data.length, mtimeMs, mode, data, children: null };
    this.parentOf(rel).children!.set(baseName(rel), node);
    return node;
  }

  writeAt(rel: string, inode: Inode, offset: number, bytes: Uint8Array, mtimeMs: number): Inode {
    const node = inode as MemoryNode;
    const size = Math.max(node.size, offset + bytes.length);
    this.reserve(size - node.size, rel);
    let data = node.data;
    if (size > data.length) {
      data = new Uint8Array(size);
      data.set(node.data.subarray(0, node.size), 0);
    }
    data.set(bytes, offset);
    Object.assign(node, { data, size, mtimeMs });
    return node;
  }

  truncate(rel: string, inode: Inode, size: number, mtimeMs: number): Inode {
    const node = inode as MemoryNode;
    this.reserve(size - node.size, rel);
    const data = new Uint8Array(size);
    data.set(node.data.subarray(0, Math.min(size, node.size)), 0);
    Object.assign(node, { data, size, mtimeMs });
    return node;
  }

  mkdir(rel: string, mode: number, mtimeMs: number): Inode {
    const node: MemoryNode = { ino: this.nextIno++, dir: true, size: 0, mtimeMs, mode, data: new Uint8Array(0), children: new Map() };
    this.parentOf(rel).children!.set(baseName(rel), node);
    return node;
  }

  remove(rel: string, node: Inode): void {
    this.bytes -= sizeOf(node as MemoryNode);
    this.parentOf(rel).children!.delete(baseName(rel));
  }

  move(from: string, node: Inode, to: string, replaced: Inode | null): void {
    if (replaced) this.remove(to, replaced);
    this.parentOf(from).children!.delete(baseName(from));
    this.parentOf(to).children!.set(baseName(to), node as MemoryNode);
  }

  setMeta(_rel: string, node: Inode, meta: { mtimeMs?: number; mode?: number }): void {
    if (meta.mtimeMs !== undefined) node.mtimeMs = meta.mtimeMs;
    if (meta.mode !== undefined) node.mode = meta.mode;
  }

  usage(): Usage {
    const count = { files: 0, dirs: 0, bytes: 0 };
    const walk = (node: MemoryNode): void => {
      for (const child of node.children?.values() ?? []) {
        if (child.children) {
          count.dirs++;
          walk(child);
        } else {
          count.files++;
          count.bytes += child.size;
        }
      }
    };
    walk(this.root);
    return count;
  }

  counters(): StorageCounters {
    return emptyCounters();
  }

  private reserve(delta: number, rel: string): void {
    if (delta > 0 && this.bytes + delta > this.maxBytes) throw fsError('ENOSPC', 'write', rel, undefined, `scratch files are limited to ${this.maxBytes} bytes`);
    this.bytes += delta;
  }

  private parentOf(rel: string): MemoryNode {
    const slash = rel.lastIndexOf('/');
    const parent = slash < 0 ? this.root : this.lookup(rel.slice(0, slash));
    if (!parent || parent === 'notdir' || !(parent as MemoryNode).children) throw fsError('ENOENT', 'open', rel);
    return parent as MemoryNode;
  }
}

function baseName(rel: string): string {
  return rel.slice(rel.lastIndexOf('/') + 1);
}

function sizeOf(node: MemoryNode): number {
  if (!node.children) return node.size;
  let total = 0;
  for (const child of node.children.values()) total += sizeOf(child);
  return total;
}
