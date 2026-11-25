/**
 * The Design editor: canvas or focused view, floating bars, the composer
 * and the properties panel.
 */

import { Loader2, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useBoardPaste, finishBoardPaste } from './services/clipboard.ts';
import { Button, Dialog, EmptyState } from '@open-artifact/ui';
import { useDocument } from './state/document.ts';
import { useView } from './state/view.ts';
import { session, startSession } from './services/session.ts';
import { loadProject } from './services/sync.ts';
import { askAgentToFixIndex, startPresence } from './services/agent.ts';
import { startFollow } from './services/follow.ts';
import { startShellBridge } from './services/shell.ts';
import { installKeyboard } from './keyboard.ts';
import { placeImages } from './services/images.ts';
import { Canvas } from './components/Canvas.tsx';
import { FocusedView } from './components/FocusedView.tsx';
import { EndCard, FootToolbar, StartCard } from './components/Toolbar.tsx';
import { TipGroup } from '@open-artifact/editor-kit/react';
import { Composer } from './components/Composer.tsx';
import { PropertiesPanel } from './components/PropertiesPanel.tsx';
import { CrashBoundary } from './components/CrashBoundary.tsx';
import { FollowChip } from './components/FollowChip.tsx';
import { CollabAside, CollabCard, useCollabAside } from './components/Collab.tsx';
import { CommentList } from './components/comments/CommentList.tsx';
import { HistoryPreview } from './components/HistoryPreview.tsx';
import { startCollab } from './services/collab.ts';
import { viewportCenter } from './services/commands.ts';
import { installClipboard } from './services/clipboard.ts';
import { startDesignSystems } from './services/design-systems.ts';
import { startAnnouncer } from './services/announce.ts';
import { openPlaceInAddress, pageInAddress, startPageHistory } from './services/page-link.ts';
import { startRecovery } from './services/recovery.ts';
import { guardFileDrops } from '@open-artifact/editor-kit';
import { Announcer } from '@open-artifact/editor-kit/react';
import { FindBar } from './components/FindBar.tsx';
import { RecoveryBanner } from './components/RecoveryBanner.tsx';

/** Connects, loads and applies the launch view. Runs once. */
async function boot(): Promise<void> {
  try {
    await startSession();
  } catch (error) {
    useDocument.getState().fail(error instanceof Error ? error.message : String(error));
    return;
  }
  await loadProject();
  if (useDocument.getState().status !== 'ready') return;
  const { canvas } = useDocument.getState();
  const view = useView.getState();
  const launch = canvas.launch;
  const firstPage = canvas.pages[0]?.id ?? null;
  // A link to a place (`#artboard-<name>`, `#page-<id>`) or a page (`#page=<id>`) wins over the launch view.
  const linked = pageInAddress();
  if (!openPlaceInAddress()) {
    view.setPage(linked ?? (launch?.view === 'canvas' && launch.page && canvas.pages.some((p) => p.id === launch.page) ? launch.page : firstPage));
    if (!linked && launch?.view === 'focused' && canvas.boards[launch.file]) view.focus(launch.file);
  }
  startPageHistory();
  startDesignSystems();
  startAnnouncer();
  startRecovery();
  startPresence();
  startFollow();
  startCollab();
  startShellBridge();
  document.title = useDocument.getState().title || 'Design';
}

let booted = false;

/** A load still running after this long says so (screen readers hear it too). */
const SLOW_LOAD_MS = 20_000;

function Loading() {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_LOAD_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 bg-canvas">
      <Loader2 className="size-5 animate-spin text-fg-subtle" aria-label="Loading" />
      <div role="status" className="text-[13px] text-fg-muted">
        {slow ? 'Still loading this design…' : ''}
      </div>
    </div>
  );
}

export function App() {
  const status = useDocument((s) => s.status);
  const error = useDocument((s) => s.error);
  const readOnly = useDocument(s => s.readOnly);
  const pendingPaste = useBoardPaste(s => s.pending);
  const canvasError = useDocument((s) => s.canvasError);
  const title = useDocument((s) => s.title);
  const mode = useView((s) => s.mode);
  const focused = useView((s) => s.focused);
  const panelOpen = useView((s) => s.panelOpen);
  const toolbarTop = useView((s) => s.toolbarTop);
  const aside = useCollabAside();

  useEffect(() => {
    if (!booted) {
      booted = true;
      void boot();
    }
    const offKeys = installKeyboard();
    const offDrops = guardFileDrops(window);
    return () => {
      offKeys();
      offDrops();
    };
  }, []);

  useEffect(() => {
    if (title) document.title = title;
  }, [title]);

  // Copy, cut and paste; pasted images become image notes at the viewport center.
  useEffect(() => installClipboard((files) => void placeImages(files, viewportCenter())), []);

  if (status === 'loading') return <Loading />;
  if (status === 'error') {
    return (
      <div className="h-full bg-canvas">
        <EmptyState icon={<TriangleAlert className="size-6" />} title="This design could not be opened">
          {error}
        </EmptyState>
      </div>
    );
  }

  // A render error shows a reload card instead of a blank page.
  return (
    <CrashBoundary>
      <div className="flex h-full bg-canvas text-fg">
        <main className="relative min-w-0 flex-1">
          {mode === 'focused' && focused ? <FocusedView path={focused} /> : <Canvas />}
          {mode === 'canvas' ? (
            <TipGroup>
              <div className="pointer-events-none absolute left-3 top-3 flex max-w-[calc(100%-24px)] gap-2">
                <StartCard compact={toolbarTop} />
              </div>
              <div className="pointer-events-none absolute right-3 top-3 flex gap-2">
                <CollabCard />
                <EndCard />
              </div>
              {/* Below the corner cards: the toolbar when it sits at the top, find, the restore offer. */}
              <div className="pointer-events-none absolute inset-x-0 top-[56px] flex flex-col items-center gap-2 px-2">
                <FindBar />
                <RecoveryBanner />
              </div>
              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 px-2 pb-3">
                <FollowChip />
                <Composer />
                {toolbarTop ? null : <FootToolbar />}
              </div>
            </TipGroup>
          ) : (
            <>
              <div className="pointer-events-none absolute inset-x-0 top-[56px] flex flex-col items-center gap-2 px-2">
                <RecoveryBanner />
              </div>
              <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
                <Composer />
              </div>
            </>
          )}
          {canvasError ? (
            <div className="absolute inset-x-0 top-16 mx-auto w-fit max-w-[90%] rounded-lg bg-danger px-3 py-2 text-[12px] text-white shadow">
              canvas.json could not be read ({canvasError}). The editor will not change it until it is fixed.
              {!readOnly && session().agent && session().viewer.role === 'owner' ? <button className="ml-2 underline" onClick={() => void askAgentToFixIndex(canvasError)}>Ask agent to fix</button> : null}
            </div>
          ) : null}
          {pendingPaste ? <Dialog open title="Paste artboards from another canvas?" description="Their component code will run in the pasted artboards." onOpenChange={open => { if (!open) finishBoardPaste(false); }}
            footer={<><Button onClick={() => finishBoardPaste(false)}>Cancel</Button><Button onClick={() => finishBoardPaste(true)}>Paste with code</Button></>}>
            {pendingPaste.boards.map(board => board.entry.title).join(', ')}
          </Dialog> : null}
          <HistoryPreview />
          <CommentList />
          <Announcer />
        </main>
        {aside ? <CollabAside /> : panelOpen && mode === 'canvas' ? <PropertiesPanel /> : null}
      </div>
    </CrashBoundary>
  );
}
