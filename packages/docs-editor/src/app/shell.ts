/** Page controls shared with the artifact frame. The standalone editor keeps its own controls. */
import { createShellBridge, openCount } from '@open-artifact/editor-kit';
import type { ChromeFormat } from '@open-artifact/protocol';
import type { DocExportFormat } from '@open-artifact/runtime/doc-api';
import { docComments } from '../comments/store.ts';
import { selectionCommentable } from '../comments/actions.ts';
import { useEditor } from '../editor/format.ts';
import { followDocLink } from '../selbar/navigate.ts';
import { exportDoc, mayExportDoc } from '../topbar/export.ts';
import { setTabsUi, getTabsUi } from '../tabs/state.ts';
import { getTopBar, setTopBar, useTopBar } from '../topbar/store.ts';
import { defaultPaper } from '../topbar/words.ts';
import { editorActions } from './actions.ts';
import { maybeSession } from './session.ts';
import { getDocs, setDocs, useDocs } from './store.ts';

const bridge = createShellBridge(() => maybeSession()?.shell);
export const useDocShell = bridge.useShellDraws;

const labels: Record<DocExportFormat, string> = {
  docx: 'Word (.docx)', pdf: 'PDF (.pdf)', markdown: 'Markdown (.md)', html: 'HTML (.html)',
};

function formats(): ChromeFormat[] {
  if (!maybeSession() || !mayExportDoc()) return [];
  const several = (getDocs().project?.files.length ?? 0) > 1;
  const scopes = [{ id: 'tab', label: 'This tab' }];
  if (several) scopes.push({ id: 'doc', label: 'Whole document' });
  const pdf = scopes.flatMap(scope => ['a4', 'letter'].map(paper => ({
    id: scope.id + '_' + paper,
    label: (several ? scope.label + ' · ' : '') + (paper === 'a4' ? 'A4' : 'US Letter'),
  })));
  return Object.entries(labels).map(([format, label]) => ({
    format, label, disabled: !!getTopBar().exporting,
    ...(format === 'pdf' ? { variants: pdf } : several ? { variants: scopes } : {}),
  }));
}

export function startDocShell(): void {
  const shell = maybeSession()?.shell;
  if (!shell) return;
  const report = () => {
    const { project, writable, comments, saving } = getDocs();
    const { available, threads } = docComments.store.getState();
    const states = Object.values(saving);
    const dirty = states.includes('unsaved') || states.includes('stopped');
    bridge.setShellReport({
      title: project?.name,
      comments: { available, on: comments !== 'hidden', open: comments === 'all', count: openCount(threads), pageButton: false },
      share: true, history: true, exports: !!maybeSession() && mayExportDoc(), formats: formats(), hasContent: !!project?.files.length,
      saved: dirty ? 'unsaved' : states.includes('reconnecting') ? 'reconnecting' : states.includes('saving') || states.includes('syncing') ? 'saving' : !writable ? 'readonly' : 'saved',
      leaveLosesWork: dirty || states.includes('saving'),
      actions: [{ id: 'open_find' }, { id: 'open_page_list' }, ...(writable ? [{ id: 'rename_doc', label: 'Rename' }] : []), ...(selectionCommentable(useEditor.getState().state) ? [{ id: 'comment_selection' }] : [])],
    });
  };
  bridge.onShellCommand(command => {
    switch (command.cmd) {
      case 'history': setDocs({ history: !getDocs().history }); break;
      case 'comments_mode': setDocs({ comments: command.on ? 'margin' : 'hidden' }); break;
      case 'comments_list': setDocs({ comments: command.open === false ? 'hidden' : 'all' }); break;
      case 'goto_doc': followDocLink(command.hash); break;
      case 'action':
        if (command.id === 'rename_doc' && getDocs().writable) setTopBar({ renaming: true });
        if (command.id === 'open_page_list') setTabsUi({ pickerOpen: !getTabsUi().pickerOpen });
        if (command.id === 'open_find') editorActions.find('find');
        if (command.id === 'comment_selection') editorActions.comment();
        break;
      case 'exports': return formats().map(f => ({ label: f.label! }));
      case 'export': {
        const format = formats().find(f => f.label === command.label)?.format as DocExportFormat | undefined;
        if (format) void exportDoc({ format, scope: 'tab', paper: defaultPaper() });
        break;
      }
      case 'export_format': {
        if (getTopBar().exporting) { shell.exportState(command.request, 'busy'); break; }
        if (!Object.hasOwn(labels, command.format) || (command.variant && !formats().find(f => f.format === command.format)?.variants?.some(v => v.id === command.variant))) {
          shell.exportState(command.request, 'unsupported');
          break;
        }
        shell.exportState(command.request, 'started');
        const [scope, paper] = (command.variant ?? 'tab').split('_');
        void exportDoc({ format: command.format as DocExportFormat, scope: scope === 'doc' ? 'doc' : 'tab', paper: paper === 'a4' || paper === 'letter' ? paper : defaultPaper() })
          .then(ok => shell.exportState(command.request, ok ? 'done' : 'failed'));
        break;
      }
    }
  });
  bridge.startShell();
  report();
  useDocs.subscribe(report);
  docComments.store.subscribe(report);
  useEditor.subscribe(report);
  useTopBar.subscribe(report);
}
