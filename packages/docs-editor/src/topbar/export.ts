/**
 * Making a file of the doc or of its open tab, and saving it where the host keeps downloads (else the browser). A PDF
 * is printed by Chrome on the host's computer, or, where there is none (or on a cloud host), by this browser's print
 * dialog on the same print page.
 */
import { assertMayExport, mayExportHere, saveFile } from '@open-artifact/editor-kit';
import type { DocExportFormat, DocPaper } from '@open-artifact/runtime/doc-api';
import { toast } from '@open-artifact/ui';
import { docClient } from '../app/doc-client.ts';
import { session } from '../app/session.ts';
import { getDocs, useDocs } from '../app/store.ts';
import { getTopBar, setTopBar } from './store.ts';
import { couldntTitle, type ExportNoteLike, exportedTitle, exportFailure, notesText, otherNotes, printToPdfWords } from './words.ts';

export interface ExportChoice {
  format: DocExportFormat;
  /** The open tab only, or every tab. */
  scope: 'tab' | 'doc';
  paper?: DocPaper;
}

export const exportKey = (choice: ExportChoice) => `${choice.scope}:${choice.format}:${choice.paper ?? ''}`;

const codeOf = (error: unknown): string | undefined =>
  error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined;

const messageOf = (error: unknown): string | undefined => (error instanceof Error && error.message ? error.message : undefined);

/**
 * A host whose downloads save in the browser (a cloud host) never prints a PDF on its side: the browser's print dialog
 * makes it from the print page, which the host does hand over (`html`).
 */
const printsInBrowser = (): boolean => session().downloads?.browser === true;

/** A frame's turn to draw, so the toast shows before the print dialog takes the page. */
const nextFrame = () => new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));

/**
 * No Chrome for a PDF (none on this computer, or a cloud host, which runs no browser): this browser prints the same
 * page instead, and its print dialog can save a PDF; a toast says to choose "Save as PDF". False where there is no
 * such dialog (an Electron host) or the page would not load.
 */
async function printInBrowser(choice: ExportChoice, tab: string | undefined): Promise<boolean> {
  if (/\bElectron\/\d/.test(navigator.userAgent)) return false;
  const { doc } = session();
  const file = await doc.exportFile({ format: 'html', ...(tab ? { tab } : {}), ...(choice.paper ? { paper: choice.paper } : {}) });
  const url = URL.createObjectURL(new Blob([new Uint8Array(file.bytes)], { type: 'text/html' }));
  const frame = document.createElement('iframe');
  // Off screen, not display:none: some browsers print nothing from a frame that isn't laid out.
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:800px;height:600px;border:0';
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  const done = () => {
    frame.remove();
    URL.revokeObjectURL(url);
  };
  try {
    await new Promise<void>((resolve, reject) => {
      frame.onload = () => resolve();
      frame.onerror = () => reject(new Error('the print page did not load'));
      frame.src = url;
      document.body.appendChild(frame);
    });
    const printing = frame.contentWindow;
    if (!printing) throw new Error('no print window');
    printing.addEventListener('afterprint', done, { once: true });
    toast.add(printToPdfWords());
    await nextFrame();
    printing.focus();
    printing.print();
    return true;
  } catch {
    done();
    return false;
  }
}

/** Give an in-flight edit time to land. A disconnected or stopped tab cannot be exported faithfully. */
function readyToExport(tab: string | undefined): Promise<boolean> {
  const client = docClient();
  const check = () => {
    const { saving, project } = getDocs();
    const pending = project?.files.filter(f => (!tab || f.id === tab) && client.openTabOf(f.id)?.sync.hasLocalChanges) ?? [];
    if (!pending.length) return true;
    if (pending.some(f => ['stopped', 'unsaved', 'reconnecting'].includes(saving[f.id] ?? ''))) return false;
    return null;
  };
  const now = check();
  if (now !== null) return Promise.resolve(now);
  return new Promise(resolve => {
    const finish = (ok: boolean) => { clearTimeout(timer); stop(); resolve(ok); };
    const timer = setTimeout(() => finish(false), 10000);
    const stop = useDocs.subscribe(() => {
      const ready = check();
      if (ready !== null) finish(ready);
    });
  });
}

/** Whether the person may start an export here: the owner, or anyone on a host that decides (`mayExportHere`). */
export const mayExportDoc = (): boolean => mayExportHere(session().viewer.role, session().downloads);

export async function exportDoc(choice: ExportChoice): Promise<boolean> {
  if (getTopBar().exporting || !mayExportDoc()) return false;
  const { activeTab } = getDocs();
  if (choice.scope === 'tab' && !activeTab) return false;
  const tab = choice.scope === 'tab' && activeTab ? activeTab : undefined;
  setTopBar({ exporting: exportKey(choice) });
  try {
    const { doc, downloads } = session();
    if (!await readyToExport(tab)) {
      toast.add({ title: couldntTitle(choice.format), description: 'Save your pending changes before exporting.' });
      return false;
    }
    if (choice.format === 'pdf' && printsInBrowser()) {
      // A print is no download, but the PDF button follows the owner's export switch like the others. Only the
      // product's own button: the browser's print and a screenshot stay open to anyone who sees the doc.
      await assertMayExport(downloads);
      if (await printInBrowser(choice, tab).catch(() => false)) return true;
      toast.add({ title: couldntTitle(choice.format), description: exportFailure(choice.format, choice.scope, 'no_print') });
      return false;
    }
    const file = await doc.exportFile({ format: choice.format, ...(tab ? { tab } : {}), ...(choice.paper ? { paper: choice.paper } : {}) });
    const bytes = new Uint8Array(file.bytes);
    const saved = await saveFile(downloads, file.name, new Blob([bytes], { type: file.mime }));
    const where = saved.to === 'host' && saved.savedTo ? `Saved to ${saved.savedTo}.` : undefined;
    const notes = file.notes as readonly ExportNoteLike[];
    toast.add({ title: exportedTitle(choice.format, notes), description: [notesText(otherNotes(notes)), where].filter(Boolean).join(' ') || undefined });
    return true;
  } catch (error) {
    const code = codeOf(error);
    // `unsupported`: a host that prints no PDF on its side (a cloud host whose Shell is older than this page).
    if ((code === 'no_chrome' || code === 'unsupported') && choice.format === 'pdf' && (await printInBrowser(choice, tab).catch(() => false))) return true;
    toast.add({ title: couldntTitle(choice.format), description: exportFailure(choice.format, choice.scope, code, messageOf(error)) });
    return false;
  } finally {
    setTopBar({ exporting: null });
  }
}
