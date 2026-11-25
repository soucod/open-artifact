/**
 * Reads plain zip files (no Zip64), the shape `archive.ts` writes and Office files use: the reader lives in
 * `@open-artifact/server-sdk/zip` (shared with frame-host and the daemon) and is re-exported here.
 *
 * {@link zipEntries} lists the central directory as it is, without judging it; {@link readZip} gives each name a
 * lazy reader (the Word import's view); {@link entryBytes} and {@link unpackEntry} read one entry's data. Callers that
 * take a zip from someone they do not trust check the entries themselves (see `importArchive` in `archive.ts`).
 */

export { entryBytes, readZip, unpackEntry, unpackEntrySync, ZipError, zipEntries, type ZipDirectory, type ZipEntry } from '@open-artifact/server-sdk/zip';
