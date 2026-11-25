export let MAX_FILE_NAME_CHARACTERS: number;
export let MAX_FILE_NAME_BYTES: number;
export function truncatedFileNameStem(title: string | null, suffix: string, extension: string): string | null {
  let stem = '';
  for (let grapheme of graphemesOf(cleanFileNamePart(title ?? ''))) {
    let candidate = stem + grapheme + suffix;
    if (Array.from(candidate).length > MAX_FILE_NAME_CHARACTERS) break;
    if (utf8ByteLength(candidate + extension) > MAX_FILE_NAME_BYTES) break;
    stem += grapheme;
  }
  let trimmed = stem.replace(EDGE_SPACES_AND_DOTS_PATTERN, '');
  return trimmed === '' ? null : trimmed;
}
export function fileNameOfSheet(sheetName: string): string {
  let cleaned = cleanFileNamePart(sheetName);
  return cleaned === '' ? 'Sheet' : cleaned;
}
export function csvFileName(workbookTitle: string | null, sheetName: string): string {
  let sheetFileName = fileNameOfSheet(sheetName);
  let sheetSuffix = cleanFileNamePart(workbookTitle ?? '').toLowerCase() === sheetFileName.toLowerCase() ? '' : ` - ${sheetFileName}`;
  let stem = truncatedFileNameStem(workbookTitle, sheetSuffix, '.csv');
  return stem === null ? `${sheetFileName}.csv` : `${stem}${sheetSuffix}.csv`;
}
[MAX_FILE_NAME_CHARACTERS, MAX_FILE_NAME_BYTES] = [120, 240];
export const utf8ByteLength = (text: string): number => new TextEncoder().encode(text).length;
export const graphemesOf = (text: string): string[] =>
  'Segmenter' in Intl
    ? Array.from(new Intl.Segmenter().segment(text), ({ segment }) => segment)
    : Array.from(text);
export const EDGE_SPACES_AND_DOTS_PATTERN = /^[\s.]+|[\s.]+$/gu;
export const INVISIBLE_CHARACTERS_PATTERN = /[\u00AD\u061C\u200B\u200E\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/gu;
export const UNSAFE_FILE_NAME_CHARACTERS_PATTERN =
  /[\s\p{Cc}\u2800\uFFFC\u{1D159}\u{13441}\u{13442}\u{16910}\u115F\u1160\u3164\uFFA0\\/:*?"<>|%]+/gu;
export const cleanFileNamePart = (text: string): string =>
  text.replace(INVISIBLE_CHARACTERS_PATTERN, '').replace(UNSAFE_FILE_NAME_CHARACTERS_PATTERN, ' ').replace(EDGE_SPACES_AND_DOTS_PATTERN, '');
export const xlsxFileName = (workbookTitle: string | null, sheetName: string): string =>

  `${truncatedFileNameStem(workbookTitle, '', '.xlsx') ?? fileNameOfSheet(sheetName)}.xlsx`;
