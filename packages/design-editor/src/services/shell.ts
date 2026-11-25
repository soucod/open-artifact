/**
 * The bridge to an Open Artifact Shell framing this page: the editor
 * reports its agent status and export formats, runs the exports the Shell's
 * Export tab asks for, and tells the Shell it applies file changes itself
 * (so the Shell never reloads the frame under the viewer).
 */

import type { ChromeReport, ShellConnection } from '@open-artifact/runtime';
import { agentChrome, chromeReporter, mayExportHere } from '@open-artifact/editor-kit';
import { exportFormats, exportJob, selectedArtboard, type ExportScene } from '../lib/export-formats.ts';
import { useDocument, type SaveState } from '../state/document.ts';
import { useView } from '../state/view.ts';
import { useAgent } from './agent.ts';
import { exportBusy, pageArtboards, pageOfBoard, pngOptions, runJob } from './export.ts';
import { useComments, canComment } from './comments.ts';
import { session } from './session.ts';
import { collabChromeReport, handleCollabCommand, subscribeCollab } from './collab.ts';

/** What the Export tab (or, without a Shell, the focused view's Export menu) depends on now. */
export function exportScene(): ExportScene {
  const view = useView.getState();
  const { boards } = useDocument.getState().canvas;
  const path = selectedArtboard(view, boards);
  const entry = path ? boards[path] : undefined;
  const page = path ? pageOfBoard(path) : view.page;
  const sizes = entry ? pngOptions(entry.w, entry.h) : null;
  const width = view.mode === 'focused' ? view.focusedExportWidth : null;
  const preview = entry && width ? pngOptions(width, entry.h) : null;
  return {
    artboard: path && sizes ? { path, png: [sizes[0]!.fits, sizes[1]!.fits],
      ...(preview && width ? { preview: { width, fits: [preview[0]!.fits, preview[1]!.fits] } } : {}),
    } : null,
    page,
    pageArtboards: pageArtboards(page).length,
    canvasArtboards: Object.keys(boards).length,
  };
}

/** The Shell's save state of ours. */
function savedOf(save: SaveState): NonNullable<ChromeReport['saved']> {
  switch (save) {
    case 'saved':
      return 'saved';
    case 'saving':
      return 'saving';
    // Edits waiting out the save debounce: on their way, not failed (a failed save is `offline` or `error`).
    case 'dirty':
      return 'saving';
    case 'error':
      return 'unsaved';
    case 'offline':
      return 'reconnecting';
    case 'readonly':
      return 'readonly';
  }
}

/** Runs one `export_format` from the Shell and tells it what became of it. */
async function runFormat(shell: ShellConnection, request: string, format: string, variant: string | undefined): Promise<void> {
  if (!mayExportHere(session().viewer.role, session().downloads)) return shell.exportState(request, 'unsupported');
  if (exportBusy()) return shell.exportState(request, 'busy');
  const job = exportJob(exportScene(), format, variant);
  if (!job) return shell.exportState(request, 'unsupported');
  shell.exportState(request, 'started');
  const outcome = await runJob(job);
  if (outcome.state === 'failed') shell.exportState(request, 'failed', outcome.reason);
  else shell.exportState(request, outcome.state);
}

/** Starts reporting to the Shell, if there is one. */
export function startShellBridge(): void {
  const shell = session().shell;
  if (!shell) return;
  const report = chromeReporter(shell, () => {
    const doc = useDocument.getState();
    const { mode, selection } = useView.getState();
    const hasSelection = selection.kind === 'elements' || (selection.kind === 'objects' && (selection.notes.length || selection.boards.length));
    return {
      actions: mode === 'canvas' && hasSelection && useComments.getState().available && canComment() ? [{ id: 'comment_selection' }] : [],
      agent: agentChrome(useAgent.getState().status),
      exports: false,
      formats: mayExportHere(session().viewer.role, session().downloads) ? exportFormats(exportScene()) : [],
      hasContent: doc.status === 'ready' && Object.keys(doc.canvas.boards).length > 0,
      ...(doc.status === 'ready' ? { saved: savedOf(doc.save) } : {}),
      ...collabChromeReport(),
    };
  });
  report();
  shell.currentDesignPage(useView.getState().page);
  useAgent.subscribe(report);
  useDocument.subscribe(report);
  subscribeCollab(report);
  // Not on every camera move: only what changes which artboards the tab exports.
  useView.subscribe((state, previous) => {
    if (state.page !== previous.page) shell.currentDesignPage(state.page);
    if (state.selection !== previous.selection || state.page !== previous.page || state.mode !== previous.mode || state.focused !== previous.focused || state.focusedExportWidth !== previous.focusedExportWidth) report();
  });
  // The sync service merges remote changes live.
  shell.onFilesChanged(() => true);
  shell.onCommand((command) => {
    if (handleCollabCommand(command)) return;
    if (command.cmd === 'exports') return [];
    if (command.cmd === 'export_format') void runFormat(shell, command.request, command.format, command.variant);
  });
}
