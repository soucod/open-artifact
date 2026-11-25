/**
 * The Data editor: the toolbar over the page, the notice above it (an
 * earlier version, the sources' problems, or the page check's), the page
 * itself with its edit, ask and source layers (or the empty page), the side
 * panel, the dialogs, the ask box and the comment layer.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { DEFAULT_DASHBOARD_TITLE } from '@open-artifact/data-core';
import { LoaderCircle } from 'lucide-react';
import { Announcer } from '@open-artifact/editor-kit/react';
import { EmptyState } from '@open-artifact/ui';
import { AskBox } from './ask/AskBox.tsx';
import { SourcesNotice } from './data/SourcesNotice.tsx';
import { maybeDataEngine } from './data/engine.ts';
import { DraftDialog, EditDialogs } from './drafts/EditDialogs.tsx';
import { useCanAskAgent } from './drafts/request.ts';
import { VersionBar } from './history/VersionBar.tsx';
import { useVersionHistory } from './history/store.ts';
import { followStoredLook, useStyleEditor } from './design/style.ts';
import { previewLook } from './page/look.ts';
import { DashboardPage } from './page/DashboardPage.tsx';
import { PRINT_NOTE_ATTRIBUTE, getPrintDataNote } from './export/print-note.ts';
import { getStoppedPageFiles } from './page/check.ts';
import { useToolbarAnnouncements } from './platform/announcements.ts';
import { isInlineView } from './platform/inline-view.ts';
import { useAgentActivity } from './platform/agent-activity.ts';
import { maybeSession } from './services/session.ts';
import { useDatasets } from './state/datasets.ts';
import { useDocument } from './state/document.ts';
import { useShown, useShownContent } from './state/shown.ts';
import { openSources, useSourcesUi } from './state/sources-ui.ts';
import { CommentLayer } from './app/CommentLayer.tsx';
import { EmptyDashboard } from './app/EmptyDashboard.tsx';
import { useEmptyPage } from './state/empty-page.ts';
import { PageFixingNotice, PageNeedsFixNotice } from './app/Notices.tsx';
import { PageTools } from './app/PageTools.tsx';
import { SidePanel } from './app/SidePanel.tsx';
import { Toolbar } from './app/Toolbar.tsx';
import { useDashboardData, usePageSnapshot, type DashboardData } from './app/data-view.ts';
import { askToFixPage, askWhySourcesFailed } from './app/requests.ts';
import { ReadAloudSlot } from './app/slots.tsx';
import { useAppPhase } from './app/start.ts';
import { useViewContext } from './app/view-context.ts';
import { OPEN_FAILED_TITLE, OPENING_LABEL } from './app/words.ts';

function useRootClass(name: string, on: boolean): void {
  useLayoutEffect(() => {
    document.documentElement.classList.toggle(name, on);
    return () => document.documentElement.classList.remove(name);
  }, [name, on]);
}

function useDocumentTitle(): void {
  const title = useDocument((state) => state.title);
  useEffect(() => {
    document.title = title || DEFAULT_DASHBOARD_TITLE;
  }, [title]);
}

function Dashboard(): ReactElement {
  useDocumentTitle();
  const inline = isInlineView();
  useRootClass('dash-inline-view', inline);
  const shown = useShownContent();
  const status = useDocument((state) => state.status);
  const save = useDocument((state) => state.save);
  const canWrite = useDocument((state) => state.canWrite);
  const editing = useShown((state) => state.editing);
  const notice = useDatasets((state) => state.notice);
  const toolbarText = useDatasets((state) => state.toolbar);
  const sourcesOpen = useSourcesUi((state) => state.open);
  const versionShown = useVersionHistory((state) => state.shown !== null);
  const working = useAgentActivity((state) => state.activity === 'working');
  const canAsk = useCanAskAgent();
  const data = useDashboardData();
  const snapshot = usePageSnapshot();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const announced = useRef<string | null>(null);

  const files = shown.content.files;
  const loading = status === 'connecting';
  const noPage = files.length === 0 && !loading && save !== 'failed';
  const empty = noPage && shown.content.datasets.length === 0;
  const visibleNotice = notice !== null && files.length > 0 && notice.text !== dismissed ? notice : null;
  const editable = canWrite && (maybeSession()?.canEdit ?? false);
  const offerForms = noPage && editable && canAsk && !inline;
  const pickedForm = useEmptyPage((state) => state.form);
  const view = useViewContext({ data, snapshot, noticeShown: visibleNotice !== null, form: offerForms ? pickedForm : null });
  useToolbarAnnouncements(notice?.text ?? null, data.loadingVisible, data.hasLiveQueries, announced);
  useRootClass('dash-no-page', noPage);

  const viewingOther = shown.mode !== 'live';
  const stylePending = useStyleEditor((state) => state.pending);
  const styleShown = useStyleEditor((state) => state.pending !== null || state.status !== null);
  const liveLook = viewingOther ? undefined : shown.content.look;
  useEffect(() => {
    if (!viewingOther) followStoredLook(liveLook);
  }, [viewingOther, liveLook]);
  const pageContent = useMemo(
    () => (viewingOther || stylePending === null ? shown.content : { ...shown.content, look: previewLook(shown.content.look, stylePending) }),
    [shown.content, viewingOther, stylePending],
  );
  const askWhy = canAsk ? askWhySourcesFailed : undefined;
  const above = editing ? null : versionShown ? (
    <VersionBar />
  ) : visibleNotice !== null ? (
    <SourcesNotice
      notice={visibleNotice}
      onSources={sourcesOpen ? undefined : () => openSources()}
      onAskWhy={askWhy}
      onRetry={() => {
        announced.current = null;
        maybeDataEngine()?.retryFailed();
      }}
      loading={data.loadingVisible}
      onFix={(connector, fix) => {
        announced.current = null;
        return maybeDataEngine()?.fixConnection(connector, fix);
      }}
      onDismiss={() => setDismissed(visibleNotice.text)}
      canAskAgent={canAsk}
    />
  ) : view.notice === 'fixing' ? (
    <PageFixingNotice />
  ) : view.notice === 'fix' ? (
    <PageNeedsFixNotice
      onAsk={canAsk && canWrite && shown.mode !== 'draft' ? () => askToFixPage(getStoppedPageFiles(snapshot?.faults ?? [])) : undefined}
      onDismiss={view.dismiss}
    />
  ) : null;
  const checkWorking = view.working && files.length > 0 && !editing && !viewingOther && view.notice !== 'fixing' && !styleShown;

  return (
    <div className="dash-app">
      {inline ? null : <Toolbar data={data} text={toolbarText} empty={empty} checkWorking={checkWorking} />}
      <div className="dash-body">
        <main className="dash-main" data-dash-content="">
          {above === null ? null : (
            <div className="dash-above" data-uncommentable="">
              {above}
            </div>
          )}
          <DashboardPage
            content={pageContent}
            editing={editing}
            notesOff={view.notice !== null}
            onLink={view.onLink}
            beforeRoot={<ReadAloudSlot />}
          />
          {files.length > 0 ? <PrintDataNote data={data} /> : null}
          <PageTools filters={view.filters} onPoint={view.onPoint} />
          {noPage ? <EmptyDashboard editable={editable} working={working} offer={offerForms} /> : null}
        </main>
        <SidePanel usage={snapshot?.usage ?? null} {...(askWhy === undefined ? {} : { onAskWhy: askWhy })} />
      </div>
      <EditDialogs />
      <DraftDialog />
      {inline ? null : (
        <>
          <CommentLayer />
          <AskBox />
        </>
      )}
    </div>
  );
}

/**
 * The data's date and whether any is missing, kept out of sight beside the page; only the print rules show it. It is
 * hidden by an inline style, not the `hidden` attribute, since the base styles hold `[hidden]` with a layered
 * `!important` that a print rule can't undo.
 */
function PrintDataNote({ data }: { data: DashboardData }): ReactElement {
  const note = useMemo(() => getPrintDataNote(data.used, data.runOf), [data.used, data.runOf]);
  return (
    <p style={{ display: 'none' }} className="dash-note" data-uncommentable="" {...{ [PRINT_NOTE_ATTRIBUTE]: '' }}>
      {note}
    </p>
  );
}

function Opening(): ReactElement {
  return (
    <div className="dash-opening" role="status" aria-label={OPENING_LABEL}>
      <LoaderCircle className="size-5 animate-spin text-fg-muted" aria-hidden />
    </div>
  );
}

export function App(): ReactElement {
  const phase = useAppPhase((state) => state.phase);
  const error = useAppPhase((state) => state.error);
  return (
    <>
      {phase === 'ready' ? <Dashboard /> : phase === 'failed' ? <EmptyState title={OPEN_FAILED_TITLE}>{error}</EmptyState> : <Opening />}
      <Announcer />
    </>
  );
}
