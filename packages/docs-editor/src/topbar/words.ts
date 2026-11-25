/** The top bar's words that need no page: the doc's name as typed, the default paper, and an export's notes. Pure. */
import type { DocExportFormat, DocPaper } from '@open-artifact/runtime/doc-api';

/** The name as typed, ready to save: trimmed, one line. Empty when there is nothing to save. */
export function cleanDocName(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').trim();
}

export const FORMAT_NAMES: Record<DocExportFormat, string> = { docx: 'Word', pdf: 'PDF', markdown: 'Markdown', html: 'HTML' };

/** Letter where it is the usual paper (the US, Canada and a few others), else A4. */
export function defaultPaper(languages: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language]): DocPaper {
  const region = languages[0]?.split(/[-_]/)[1]?.toUpperCase();
  return region && ['US', 'CA', 'MX', 'PH', 'CL', 'CO', 'VE', 'GT', 'PR'].includes(region) ? 'letter' : 'a4';
}

/** A note the file came with, in either of the shapes a host may send. */
export interface ExportNoteLike {
  code: string;
  message?: string;
  what?: string;
  count?: number;
}

/** What the file could not carry over, in a sentence: "In the file: 2 × image (not available here) kept as text." */
export function notesText(notes: readonly ExportNoteLike[]): string | undefined {
  const words = notes
    .map(note => {
      const what = note.message ?? note.what;
      if (!what) return null;
      const count = note.count && note.count > 1 ? `${note.count} × ` : '';
      const fate = note.code === 'kept_as_text' ? ' kept as text' : note.code === 'dropped' ? ' left out' : '';
      return `${count}${what}${note.message ? '' : fate}`;
    })
    .filter((line): line is string => !!line);
  return words.length ? `In the file: ${words.join('; ')}.` : undefined;
}

/** How a title names the file: "a PDF", "Word". */
const TITLE_NAMES: Record<DocExportFormat, string> = { docx: 'Word', pdf: 'a PDF', markdown: 'Markdown', html: 'HTML' };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The pictures and charts a file came without, read from its notes. */
function without(notes: readonly ExportNoteLike[]): { images: number; charts: number } {
  let images = 0;
  let charts = 0;
  for (const note of notes) {
    const what = note.what ?? note.message ?? '';
    const count = note.count ?? 1;
    if (/^image\b/.test(what)) images += count;
    else if (/^embed\b/.test(what)) charts += count;
  }
  return { images, charts };
}

/** The toast's title once the file is made: "Exported as a PDF", "Exported as Word without 2 images". */
export function exportedTitle(format: DocExportFormat, notes: readonly ExportNoteLike[] = []): string {
  const { images, charts } = without(notes);
  const parts = [images ? plural(images, 'image', 'images') : '', charts ? plural(charts, 'chart or diagram', 'charts or diagrams') : ''].filter(Boolean);
  return `Exported as ${TITLE_NAMES[format]}${parts.length ? ` without ${parts.join(' and ')}` : ''}`;
}

/** The notes the title doesn't already say. */
export function otherNotes(notes: readonly ExportNoteLike[] = []): ExportNoteLike[] {
  return notes.filter(note => !/^(image|embed)\b/.test(note.what ?? note.message ?? ''));
}

export const couldntTitle = (format: DocExportFormat) => `Couldn’t export as ${TITLE_NAMES[format]}`;

/**
 * The toast while the browser's print dialog makes the PDF (no Chrome on this computer, or a cloud host, which never
 * prints on its side): which destination to pick. In Chinese for a Chinese browser, as Chrome names it there.
 */
export function printToPdfWords(languages: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language]): { title: string; description: string } {
  if (/^zh\b/i.test(languages[0] ?? '')) return { title: '用浏览器打印成 PDF', description: '在打印对话框里，把“目标打印机”选为“另存为 PDF”，再点“保存”。' };
  return { title: 'Print to PDF in your browser', description: 'In the print dialog, choose “Save as PDF” as the destination, then Save.' };
}

/** Why an export failed, in a sentence, from the server's code (and, for a refusal, the host's own words). */
export function exportFailure(format: DocExportFormat, scope: 'tab' | 'doc', code: string | undefined, message?: string): string {
  const what = scope === 'tab' ? 'this tab' : 'this document';
  const name = TITLE_NAMES[format];
  switch (code) {
    case 'no_chrome':
      return 'A PDF is printed by Chrome, and there is none on this computer. Export as HTML and print it from your browser.';
    case 'no_print':
      return 'Your browser couldn’t open its print dialog. Export as HTML, open the file and print it from your browser.';
    case 'renderer_unavailable':
      return 'PDF export is busy. Try again in a moment.';
    case 'no_node':
    case 'no_tab':
    case 'not_found':
      return scope === 'tab' ? 'This tab can’t be exported.' : 'This document can’t be exported.';
    case 'not_a_doc':
      return 'This document can’t be exported.';
    case 'unavailable':
      return `Couldn’t reach the server to export ${what}. Check it’s running, then try again.`;
    case 'not_writer':
    case 'not_granted':
      // The host's refusal says why (a viewer, while the owner does not let viewers export).
      return message || 'You can’t export this document.';
    default:
      return `Couldn’t export ${what} as ${name}. Try again in a moment.`;
  }
}
