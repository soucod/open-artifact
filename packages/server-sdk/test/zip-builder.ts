/**
 * Writes zips byte by byte for tests, including the ones no honest zip tool makes: a name with `..` or a backslash,
 * a symbolic link or device by its Unix mode, sizes that lie, an encrypted flag. Nothing here is a fixture file: every
 * hostile zip is built by the test that refuses it.
 */

import { deflateRawSync } from 'node:zlib';
import { crc32 } from '../src/zip.ts';

/** One entry of a hand-made zip. */
export interface RawEntry {
  name: string;
  data?: Buffer | string;
  /** 0 stored, 8 deflated (default 8 for a file with data, 0 otherwise). */
  method?: number;
  /** The unpacked size the directory claims (default: the real one). */
  declaredSize?: number;
  /** The CRC the directory claims (default: the real one). */
  crc?: number;
  /** The Unix `st_mode` (default a plain file, 0o100644). */
  mode?: number;
  /** "Version made by" (default Unix, 0x031e). */
  madeBy?: number;
  /** General purpose flags (default 0x0800, UTF-8 names). */
  flags?: number;
}

/** A zip of `entries`, in order. */
export function rawZip(entries: RawEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data ?? '');
    const method = e.method ?? (data.length ? 8 : 0);
    const packed = method === 8 ? deflateRawSync(data) : data;
    const crc = e.crc ?? crc32(data);
    const size = e.declaredSize ?? data.length;
    const name = Buffer.from(e.name, 'utf8');
    const flags = e.flags ?? 0x0800;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc >>> 0, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, packed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(e.madeBy ?? 0x031e, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc >>> 0, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((e.mode ?? (e.name.endsWith('/') ? 0o040755 : 0o100644)) << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
