/**
 * Exports of the whole dashboard, offered to the Shell once the page has settled: a PDF (printed, in the light
 * look), a static HTML copy, and the JSON manifest of the sources with that copy. Files are saved through the host's
 * `downloads` capability when it has one, else as a browser download. Outside a Shell the same exports run from the
 * page's own controls through {@link downloadDashboardExport}.
 */

import { DEFAULT_DASHBOARD_TITLE, type Dataset } from '@open-artifact/data-core';
import { assertMayExport, saveFile, type SavedFile } from '@open-artifact/editor-kit';
import { toast } from '@open-artifact/ui';
import { maybeDataEngine, type DataEngine } from '../data/engine.ts';
import { partitionUsedDatasets } from '../data/status.ts';
import { pageExportSnapshot, usePageRuntime, type PageHandle } from '../page/runtime.ts';
import { maybeSession } from '../services/session.ts';
import { onShellCommand, setShellReport } from '../services/shell.ts';
import { useDocument } from '../state/document.ts';
import { getShownContent, useShown } from '../state/shown.ts';
import { dashboardJsonText, exportFilename, type DashboardExportContext, type ExportFile } from './manifest.ts';
import {
  DASHBOARD_EXPORT_FORMATS,
  dashboardChromeFormats,
  isDashboardExportFormat,
  type DashboardExportAvailability,
  type DashboardExportFormat,
} from './formats.ts';
import { canAskAgent, sendPageRequest } from '../drafts/request.ts';
import { installDashboardPrint, hasPagePrintLayout, printDashboard } from './print.ts';
import { buildStaticHtmlCopy, canCopyStaticPage } from './static-html.ts';

const NOT_SETTLED_REASON = 'Available once the page has finished loading.';
const NO_PAGE_REASON = 'The dashboard has no page yet.';
/** How long an export waits for a pending redraw before copying the page as it is. */
const REDRAW_WAIT_MS = 1000;

/** The page has finished loading: mounted with files, its reads known and none of its sources loading. */
function isPageSettled(engine: DataEngine | null): boolean {
  const page = pageExportSnapshot();
  if (page === null || engine === null) return false;
  const { files, usage } = page.snapshot;
  return files !== null && files.length > 0 && usage !== null && engine.store.getState().loading.length === 0;
}

/** Whether the shown page can be exported now: settled, and the stored dashboard rather than a version or draft. */
export function getDashboardExportAvailability(): DashboardExportAvailability {
  const mode = getShownContent().mode;
  if (mode === 'version') return { ready: false, why: 'older_version' };
  if (mode === 'draft') return { ready: false, why: 'draft_open' };
  const page = pageExportSnapshot();
  if (page !== null && (page.snapshot.files?.length ?? 0) === 0) return { ready: false, why: 'other', reason: NO_PAGE_REASON };
  return isPageSettled(maybeDataEngine()) ? { ready: true } : { ready: false, why: 'other', reason: NOT_SETTLED_REASON };
}

/** The formats this page offers here (the copies need `checkVisibility`). */
export function offeredDashboardExportFormats(): DashboardExportFormat[] {
  return canCopyStaticPage() ? [...DASHBOARD_EXPORT_FORMATS] : ['pdf'];
}

function exportContext(engine: DataEngine): DashboardExportContext {
  const state = engine.store.getState();
  const listed = engine.datasets();
  const stored: Dataset[] = listed.filter((dataset) => !state.reports.has(dataset.id));
  const usage = pageExportSnapshot()?.snapshot.usage?.datasets ?? state.requested;
  return {
    title: useDocument.getState().title || DEFAULT_DASHBOARD_TITLE,
    listed,
    used: partitionUsedDatasets(stored, usage).used,
    run: (id) => engine.getRun(id),
    params: engine.params(),
  };
}

function waitForRedraw(page: PageHandle | null): Promise<void> {
  if (page === null || !page.redrawPending()) return Promise.resolve();
  const started = Date.now();
  return new Promise((resolve) => {
    const check = (): void => {
      if (!page.redrawPending() || Date.now() - started > REDRAW_WAIT_MS) resolve();
      else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
}

/** Makes a copy format's file from the page as it shows now. */
export async function produceDashboardFile(format: 'html' | 'json'): Promise<ExportFile> {
  const engine = maybeDataEngine();
  await waitForRedraw(usePageRuntime.getState().page);
  const page = pageExportSnapshot();
  if (engine === null || page === null) throw new Error('The dashboard isn’t showing yet.');
  const context = exportContext(engine);
  const at = Date.now();
  const copy = buildStaticHtmlCopy({ root: page.root, title: context.title, at });
  if (format === 'html')
    return { filename: exportFilename(context.title, 'html'), data: new Blob([copy.html], { type: 'text/html;charset=utf-8' }) };
  return {
    filename: exportFilename(context.title, 'json'),
    data: new Blob([dashboardJsonText(context, copy.marked, copy.html, at)], { type: 'application/json' }),
  };
}

/** What an export did: printed, or saved a file (through the host or as a browser download). */
export type DashboardExportOutcome = { format: 'pdf'; printed: true } | { format: 'html' | 'json'; filename: string; saved: SavedFile };

let busy = false;

/** Runs an export: opens the print dialog for `pdf`, else makes the file and saves it. */
export async function exportDashboard(format: DashboardExportFormat): Promise<DashboardExportOutcome> {
  if (format === 'pdf') {
    // A print is no download, but the PDF button follows the owner's export switch like the others (a viewer refused
    // on a host). Only the product's own button: the browser's print and a screenshot stay open to anyone who sees it.
    await assertMayExport(maybeSession()?.downloads);
    await printDashboard();
    return { format, printed: true };
  }
  const file = await produceDashboardFile(format);
  const saved = await saveFile(maybeSession()?.downloads, file.filename, file.data);
  return { format, filename: file.filename, saved };
}

const isDeclined = (error: unknown): boolean =>
  (error instanceof DOMException && error.name === 'AbortError') ||
  (typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'declined');

/** The host said no (a viewer, while the owner does not let viewers export): its words are the whole message. */
const isRefused = (error: unknown): boolean => typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'not_writer';

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Runs an export from the page's own controls, saying how it went in a toast. */
export async function downloadDashboardExport(format: DashboardExportFormat): Promise<void> {
  const availability = getDashboardExportAvailability();
  if (!availability.ready) {
    toast.add({ title: availability.reason ?? NOT_SETTLED_REASON });
    return;
  }
  if (busy) return;
  busy = true;
  try {
    const outcome = await exportDashboard(format);
    if (outcome.format !== 'pdf')
      toast.add({ title: outcome.saved.to === 'host' ? `Saved ${outcome.filename}` : `Downloaded ${outcome.filename}` });
  } catch (error) {
    if (isRefused(error)) toast.add({ title: errorText(error), type: 'error' });
    else if (!isDeclined(error)) toast.add({ title: 'Export failed. Try again.', description: errorText(error), type: 'error' });
  } finally {
    busy = false;
  }
}

async function runShellExport(request: string, format: string, variant: string | undefined): Promise<void> {
  const shell = maybeSession()?.shell;
  if (!shell) return;
  if (!isDashboardExportFormat(format) || !offeredDashboardExportFormats().includes(format) || variant !== undefined || !getDashboardExportAvailability().ready) {
    shell.exportState(request, 'unsupported');
    return;
  }
  if (busy) {
    shell.exportState(request, 'busy');
    return;
  }
  busy = true;
  shell.exportState(request, 'started');
  try {
    await exportDashboard(format);
    shell.exportState(request, 'done');
  } catch (error) {
    if (isDeclined(error)) shell.exportState(request, 'declined');
    else shell.exportState(request, 'failed', errorText(error));
  } finally {
    busy = false;
  }
}

/**
 * Offers the dashboard's exports to the Shell: reports the formats (disabled until the page has settled, and while
 * a version or draft shows), answers `export_format` requests, and prints only the dashboard. Returns a stop function.
 */
export function startDashboardExports(): () => void {
  const report = (): void =>
    setShellReport({ formats: dashboardChromeFormats(getDashboardExportAvailability(), offeredDashboardExportFormats()), exports: false });
  let scheduled = false;
  const schedule = (): void => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      report();
    });
  };
  let stopPage: () => void = () => undefined;
  let stopEngine: () => void = () => undefined;
  let watchedEngine: DataEngine | null = null;
  const watch = (): void => {
    stopPage();
    stopPage = usePageRuntime.getState().page?.subscribe(schedule) ?? (() => undefined);
    const engine = maybeDataEngine();
    if (engine !== watchedEngine) {
      stopEngine();
      watchedEngine = engine;
      stopEngine = engine?.store.subscribe(schedule) ?? (() => undefined);
    }
    schedule();
  };
  watch();
  let hintedPrintLayout = false;
  const onAfterPrint = (): void => {
    if (hintedPrintLayout || !canAskAgent()) return;
    const files = pageExportSnapshot()?.snapshot.files;
    if (!files || files.length === 0 || hasPagePrintLayout(files)) return;
    hintedPrintLayout = true;
    toast.add({
      title: 'Some parts might not print.',
      actionProps: {
        children: 'Add a print layout',
        onClick: () => {
          void sendPageRequest({
            title: 'Add a print layout',
            request: 'Add a print layout to this dashboard so every tab, chapter and scrolled section prints cleanly (see "Printing" in reference/design-defaults.md).',
            selection: { label: 'Print layout', chip: { kind: 'print-layout' }, text: '' },
          });
        },
      },
    });
  };
  if (typeof window !== 'undefined') window.addEventListener('afterprint', onAfterPrint);

  const stops = [
    usePageRuntime.subscribe((state, previous) => {
      if (state.page !== previous.page) {
        hintedPrintLayout = false;
        watch();
      } else schedule();
    }),
    useShown.subscribe(schedule),
    onShellCommand((command) => {
      if (command.cmd === 'export_format') void runShellExport(command.request, command.format, command.variant);
    }),
    installDashboardPrint(),
    () => {
      if (typeof window !== 'undefined') window.removeEventListener('afterprint', onAfterPrint);
    },
  ];
  return () => {
    stopPage();
    stopEngine();
    for (const stop of stops) stop();
    setShellReport({ formats: undefined, exports: undefined });
  };
}
