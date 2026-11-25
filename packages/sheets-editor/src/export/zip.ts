import type { XlsxFileAnswer } from '@open-artifact/sheets-core';
/** A file to put in a zip archive: its path and its text. */
export interface ZipFileText {
  path: string;
  text: string;
}
/** A file as it is written into the archive: its path and data as bytes, how the data is packed, and its checksum. */
export interface ZipEntry {
  path: Uint8Array;
  data: Uint8Array;
  method: number;
  crc32: number;
  sizeUnpacked: number;
}
/** Packs bytes for a zip entry. */
export type ZipCompressor = (bytes: Uint8Array<ArrayBuffer>) => Promise<Uint8Array>;
export function crc32Of(bytes: Uint8Array): number {
  let crc = 4294967295;
  for (let index = 0; index < bytes.length; index += 1) crc = (CRC32_TABLE[(crc ^ (bytes[index] ?? 0)) & 255] ?? 0) ^ (crc >>> 8);
  return (crc ^ 4294967295) >>> 0;
}
export function writeZipEntryHeader(view: DataView, offset: number, entry: ZipEntry): void {
  view.setUint16(offset, ZIP_VERSION_NEEDED, true);
  view.setUint16(offset + 2, ZIP_UTF8_FLAG, true);
  view.setUint16(offset + 4, entry.method, true);
  view.setUint16(offset + 6, 0, true);
  view.setUint16(offset + 8, ZIP_DOS_DATE, true);
  view.setUint32(offset + 10, entry.crc32, true);
  view.setUint32(offset + 14, entry.data.length, true);
  view.setUint32(offset + 18, entry.sizeUnpacked, true);
  view.setUint16(offset + 22, entry.path.length, true);
  view.setUint16(offset + 24, 0, true);
}
export async function writeZipArchive(files: readonly ZipFileText[], compress: ZipCompressor | null): Promise<ArrayBuffer> {
  let encoder = new TextEncoder();
  let entries = await Promise.all(
    files.map(async ({ path, text }): Promise<ZipEntry> => {
      let unpacked = encoder.encode(text);
      let packed = compress === null ? null : await compress(unpacked);
      return {
        path: encoder.encode(path),
        data: packed ?? unpacked,
        method: packed === null ? ZIP_METHOD_STORED : ZIP_METHOD_DEFLATE,
        crc32: crc32Of(unpacked),
        sizeUnpacked: unpacked.length,
      };
    }),
  );
  let sumOfRecords = (headerSize: number, withData: boolean) =>
    entries.reduce(
      (total, { path, data }) => total + headerSize + path.length + (withData ? data.length : 0),
      0,
    );
  let localSectionSize = sumOfRecords(ZIP_LOCAL_HEADER_SIZE, true);
  let centralSectionSize = sumOfRecords(ZIP_CENTRAL_HEADER_SIZE, false);
  let endRecordOffset = localSectionSize + centralSectionSize;
  if (endRecordOffset + ZIP_END_RECORD_SIZE > ZIP32_MAX_SIZE || entries.some((entry) => entry.sizeUnpacked > ZIP32_MAX_SIZE))
    throw Error('the archive is too large for the records that are written');
  let bytes = new Uint8Array(endRecordOffset + ZIP_END_RECORD_SIZE);
  let view = new DataView(bytes.buffer);
  let localOffset = 0;
  let centralOffset = localSectionSize;
  for (let entry of entries) {
    view.setUint32(centralOffset, 33639248, true);
    view.setUint16(centralOffset + 4, ZIP_VERSION_NEEDED, true);
    writeZipEntryHeader(view, centralOffset + 6, entry);
    view.setUint32(centralOffset + 42, localOffset, true);
    bytes.set(entry.path, centralOffset + ZIP_CENTRAL_HEADER_SIZE);
    centralOffset += ZIP_CENTRAL_HEADER_SIZE + entry.path.length;
    view.setUint32(localOffset, 67324752, true);
    writeZipEntryHeader(view, localOffset + 4, entry);
    bytes.set(entry.path, localOffset + ZIP_LOCAL_HEADER_SIZE);
    bytes.set(entry.data, localOffset + ZIP_LOCAL_HEADER_SIZE + entry.path.length);
    localOffset += ZIP_LOCAL_HEADER_SIZE + entry.path.length + entry.data.length;
  }
  view.setUint32(endRecordOffset, 101010256, true);
  view.setUint16(endRecordOffset + 8, entries.length, true);
  view.setUint16(endRecordOffset + 10, entries.length, true);
  view.setUint32(endRecordOffset + 12, centralSectionSize, true);
  view.setUint32(endRecordOffset + 16, localSectionSize, true);
  return bytes.buffer;
}
export function deflateRawCompressor(): ZipCompressor | null {
  try {
    new CompressionStream('deflate-raw');
  } catch {
    return null;
  }
  return async (bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> => {
    let stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  };
}
export const CRC32_TABLE = Uint32Array.from(
  {
    length: 256,
  },
  (slot, index) => {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) === 1 ? 3988292384 ^ (crc >>> 1) : crc >>> 1;
    return crc;
  },
);
export const ZIP_METHOD_STORED = 0;
export const ZIP_METHOD_DEFLATE = 8;
export const ZIP_VERSION_NEEDED = 20;
export const ZIP_UTF8_FLAG = 2048;
export const ZIP_DOS_DATE = 33;
export const ZIP32_MAX_SIZE = 4294967295;
export const ZIP_LOCAL_HEADER_SIZE = 30;
export const ZIP_CENTRAL_HEADER_SIZE = 46;
export const ZIP_END_RECORD_SIZE = 22;
export const zipXlsxParts = ({ parts }: Pick<XlsxFileAnswer, 'parts'>, compress: ZipCompressor | null): Promise<ArrayBuffer> =>

  writeZipArchive(
    parts.map(
      ({ path, xml }) => ({
        path,
        text: xml,
      }),
    ),
    compress,
  );
