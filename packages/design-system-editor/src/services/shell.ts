/**
 * The bridge to an Open Artifact Shell framing this page: the editor
 * reports its agent status, save state, comments and history (the Shell
 * draws them) and tells the Shell it applies file changes itself (so the
 * Shell never reloads the frame under the viewer).
 */

import { agentChrome, chromeReporter } from '@open-artifact/editor-kit';
import type { ChromeReport } from '@open-artifact/runtime';
import { useFiles, type SaveState } from '../state/files.ts';
import { session } from './session.ts';
import { useAgent } from './agent.ts';
import { collabChromeReport, handleCollabCommand, subscribeCollab } from './collab.ts';

/**
 * The Shell's save state of ours. Edits waiting for their save are `saving`; edits held back by a conflict could not
 * be saved (`unsaved`).
 */
function savedOf(save: SaveState, conflicted = false): NonNullable<ChromeReport['saved']> {
  switch (save) {
    case 'saved':
      return 'saved';
    case 'saving':
      return 'saving';
    case 'dirty':
      return conflicted ? 'unsaved' : 'saving';
    case 'offline':
      return 'reconnecting';
    case 'readonly':
      return 'readonly';
  }
}

/** Starts reporting to the Shell, if there is one. */
export function startShellBridge(): void {
  const shell = session().shell;
  if (!shell) return;
  // Sent only when it changed.
  const report = chromeReporter(shell, () => {
    const files = useFiles.getState();
    return {
      agent: agentChrome(useAgent.getState().status),
      exports: false,
      ...(files.status === 'ready' ? { saved: savedOf(files.save, files.conflicts.length > 0) } : {}),
      ...collabChromeReport(),
    };
  });
  report();
  useAgent.subscribe(report);
  useFiles.subscribe(report);
  subscribeCollab(report);
  // The sync service merges remote changes live.
  shell.onFilesChanged(() => true);
  shell.onCommand((command) => {
    if (command.cmd === 'exports') return [];
    if (command.cmd === 'export_format') return shell.exportState(command.request, 'unsupported');
    handleCollabCommand(command);
    return undefined;
  });
}
