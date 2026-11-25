/**
 * The bar over the page: the title and save status (when no Shell draws
 * them), Refresh and the data's words, the edit / draft bars in the middle,
 * and the tool switch, Design, History, Sources and Comments at the end.
 * Panels are off while comments are on (each button says why).
 */

import { Database, History, LoaderCircle, Palette, RefreshCw } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import { DEFAULT_DASHBOARD_TITLE } from '@open-artifact/data-core';
import { CommentsButton, MOD, ToolButton } from '@open-artifact/editor-kit/react';
import { cn } from '@open-artifact/ui';
import { maybeDataEngine } from '../data/engine.ts';
import { askSnapshotRefresh, snapshotFailure, snapshotLine, snapshotWords, useLiveSnapshot } from '../data/live-snapshot.ts';
import { joinSentences } from '../data/util.ts';
import { AgentWorking, DraftBar, EditBar, EditStatus, PageEditBar } from '../drafts/EditBar.tsx';
import { STYLE_BAR_WORDS } from '../drafts/words.ts';
import { cancelStyle, saveStyle, useStyleEditor } from '../design/style.ts';
import { useDraftFlow } from '../drafts/flow.ts';
import { isDraftBarShown } from '../drafts/draft-state.ts';
import { useEditFlow } from '../drafts/edit-flow.ts';
import { useVersionHistory } from '../history/store.ts';
import { useAgentActivity } from '../platform/agent-activity.ts';
import { maybeSession } from '../services/session.ts';
import { useShellDraws } from '../services/shell.ts';
import { useDocument } from '../state/document.ts';
import { areDraftsFree, useShown } from '../state/shown.ts';
import { retrySync } from '../sync/index.ts';
import { pageComments } from './comments.ts';
import type { DashboardData } from './data-view.ts';
import { togglePanel, usePanel } from './panels.ts';
import { EditModeSlot } from './slots.tsx';
import {
  DESIGN_DISABLED_BY_COMMENTS,
  DESIGN_DISABLED_BY_EDITING,
  DESIGN_PANEL_NAME,
  DRAFT_SHOWN_TEXT,
  DRAFT_UNSTARTED_TEXT,
  formatAttentionCount,
  HIDE_SOURCES_TIP,
  HISTORY_DISABLED_BY_COMMENTS,
  HISTORY_PANEL_NAME,
  LOADING_DATA_LABEL,
  NEW_DRAFT_UNSTARTED_TEXT,
  READ_ONLY_LABEL,
  REFRESH_LABEL,
  REFRESH_TIP,
  REFRESHING_LABEL,
  SAVED_SHOWN_TEXT,
  SOURCES_DISABLED_BY_COMMENTS,
  SOURCES_PANEL_NAME,
  SOURCES_TIP,
  withNote,
} from './words.ts';

export const SOURCES_SHORTCUT = `${MOD}\\`;

function StatusText({ text, snapshot = false }: { text: string; snapshot?: boolean }): ReactElement {
  return (
    <span role="status" title={snapshot ? text : undefined} data-dash-snapshot={snapshot ? '' : undefined} className="dash-toolbar-text min-w-0 truncate text-[13px] text-chrome-muted">
      {text}
    </span>
  );
}

/** The save state, when the Shell does not draw it: read-only, or the sync's words (a retry when it failed). */
function SaveStatus(): ReactElement | null {
  const status = useDocument((state) => state.status);
  const canWrite = useDocument((state) => state.canWrite);
  const message = useDocument((state) => state.saveMessage);
  const hint = useDocument((state) => state.saveHint);
  const retryable = useDocument((state) => state.retryable);
  if (status === 'connecting') return null;
  if (!canWrite) return <span className="shrink-0 rounded-[6px] bg-chrome-hover px-1.5 py-0.5 text-[12px] text-chrome-muted">{READ_ONLY_LABEL}</span>;
  if (message === '') return null;
  if (retryable)
    return (
      <button type="button" className="min-w-0 truncate text-[13px] text-chrome-muted underline-offset-2 hover:underline" title={hint ?? undefined} onClick={retrySync}>
        {message}
      </button>
    );
  return (
    <span className="min-w-0 truncate text-[13px] text-chrome-muted" title={hint ?? undefined}>
      {message}
    </span>
  );
}

function RefreshButton({ data }: { data: DashboardData }): ReactElement {
  const busy = data.loadingVisible;
  const tip = [...data.tips, busy ? REFRESHING_LABEL : REFRESH_TIP].reduce(joinSentences);
  return (
    <ToolButton
      size="lg"
      tipSide="bottom"
      label={busy ? (data.firstLoadVisible ? LOADING_DATA_LABEL : REFRESHING_LABEL) : REFRESH_LABEL}
      tip={tip}
      aria-busy={busy || undefined}
      icon={busy ? <LoaderCircle className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
      onClick={() => {
        if (!busy) maybeDataEngine()?.refresh();
      }}
    />
  );
}

/**
 * A hosted page (no connectors) showing the answers the owner's computer took: "Data as of <time>, from <owner>'s
 * computer", and for the owner why the last refresh failed. `null` while the page has connectors or no snapshot.
 */
function useSnapshotText(): string | null {
  const status = useLiveSnapshot((state) => state.status);
  const ask = useLiveSnapshot((state) => state.ask);
  const current = maybeSession();
  if (status === null || current === null || current.mcp !== null) return null;
  const line = snapshotLine(status);
  if (line === null) return null;
  const words = snapshotWords(status.owner);
  const failure = current.viewer.role === 'owner' ? snapshotFailure(status) : null;
  const asked =
    ask.kind === 'sending' ? words.sending : ask.kind === 'waiting' ? (ask.online ? words.waiting : words.offline) : ask.kind === 'failed' ? ask.message : null;
  return [line, failure, asked].filter((part): part is string => part !== null).join(' · ');
}

/**
 * Whether this viewer may ask the owner's computer for a refresh: the owner, or an editor the owner lets ask the agent.
 * An editor's page has the agent capability either way; the type server reports the agent available to an editor only
 * while the owner lets editors ask (`editorsCanAskAgent`), so that is what tells them apart.
 */
function useMayAskSnapshot(): boolean {
  const status = useLiveSnapshot((state) => state.status);
  const agentHeard = useAgentActivity((state) => state.available);
  const current = maybeSession();
  if (status === null || current === null || current.mcp !== null) return false;
  return current.viewer.role === 'owner' || (current.viewer.role === 'editor' && current.agent !== null && agentHeard);
}

/** Refresh on a hosted page: asks the owner's computer to run the queries again (it never calls a connector here). */
function SnapshotRefreshButton(): ReactElement {
  const ask = useLiveSnapshot((state) => state.ask);
  const owner = useLiveSnapshot((state) => state.status?.owner ?? '');
  const words = snapshotWords(owner);
  const busy = ask.kind === 'sending' || (ask.kind === 'waiting' && ask.online);
  return (
    <span data-dash-snapshot-refresh="" className="inline-flex">
      <ToolButton
        size="lg"
        tipSide="bottom"
        label={words.label}
        tip={ask.kind === 'waiting' && !ask.online ? words.offline : words.tip}
        aria-busy={busy || undefined}
        icon={busy ? <LoaderCircle className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
        onClick={() => {
          if (ask.kind !== 'sending') void askSnapshotRefresh();
        }}
      />
    </span>
  );
}

/** The draft's words beside the draft bar, or the data's. */
function useLeadingText(toolbar: string | null): string | null {
  const view = useDraftFlow((state) => state.view);
  const free = useShown(areDraftsFree);
  const editing = useEditFlow((state) => state.phase !== 'off' || state.status !== null);
  if (!editing && isDraftBarShown(view, free))
    return view.showing ? DRAFT_SHOWN_TEXT : view.unstarted ? (view.older.length > 0 ? NEW_DRAFT_UNSTARTED_TEXT : DRAFT_UNSTARTED_TEXT) : SAVED_SHOWN_TEXT;
  return toolbar;
}

/** The Style section's Cancel / Save bar, or its "Saved", while no edit or draft bar takes the middle. */
function StyleBar(): ReactNode {
  const { pending, phase, status } = useStyleEditor();
  const view = useDraftFlow((state) => state.view);
  const free = useShown(areDraftsFree);
  const editing = useEditFlow((state) => state.phase !== 'off' || state.status !== null);
  if (editing || isDraftBarShown(view, free)) return null;
  if (pending !== null)
    return (
      <EditBar
        tipSide="bottom"
        words={STYLE_BAR_WORDS}
        edit={{ phase, count: 1, canUndo: false, canRedo: false, undo: () => undefined, redo: () => undefined, cancel: cancelStyle, save: saveStyle }}
      />
    );
  return status === null ? null : <EditStatus words={status} />;
}

export interface ToolbarProps {
  data: DashboardData;
  /** The data's words (loading, last updated). */
  text: string | null;
  /** No page and no sources: only History stays. */
  empty: boolean;
  /** The page check says the agent is working on the page. */
  checkWorking: boolean;
}

export function Toolbar({ data, text, empty, checkWorking }: ToolbarProps): ReactElement {
  const framed = useShellDraws((state) => state.framed);
  const drawsSaved = useShellDraws((state) => state.draws.has('saved'));
  const title = useDocument((state) => state.title);
  const panel = usePanel();
  const commenting = useShown((state) => state.commenting);
  const editing = useShown((state) => state.editing);
  const historyAvailable = useVersionHistory((state) => state.available);
  const snapshotText = useSnapshotText();
  const mayAskSnapshot = useMayAskSnapshot();
  const leading = useLeadingText(snapshotText ?? text);
  const designAvailable = maybeSession()?.canEdit ?? false;
  const attention = data.attention.length > 0 ? formatAttentionCount(data.attention.length) : null;
  const sourcesOpen = panel === 'sources';
  const bad = data.attention.some((dataset) => maybeDataEngine()?.status(dataset.id)?.tone === 'bad');
  const center: ReactNode = (
    <>
      <PageEditBar tipSide="bottom" />
      <DraftBar tipSide="bottom" />
      <StyleBar />
      {checkWorking ? <AgentWorking /> : null}
    </>
  );
  return (
    <header className="dash-toolbar" data-uncommentable="">
      <div className="dash-toolbar-start">
        {framed ? null : <h1 className="min-w-0 truncate text-[14px] font-semibold text-chrome-fg">{title || DEFAULT_DASHBOARD_TITLE}</h1>}
        {drawsSaved ? null : <SaveStatus />}
        {empty ? null : (
          <>
            {snapshotText !== null ? mayAskSnapshot ? <SnapshotRefreshButton /> : null : data.hasLiveQueries ? <RefreshButton data={data} /> : null}
            {leading === null ? null : <StatusText text={leading} snapshot={snapshotText !== null && leading === snapshotText} />}
          </>
        )}
      </div>
      {empty ? null : <div className="dash-toolbar-center">{center}</div>}
      <div className="dash-toolbar-end">
        {empty ? null : <EditModeSlot />}
        {empty || !designAvailable ? null : (
          <ToolButton
            size="lg"
            tipSide="bottom"
            label={DESIGN_PANEL_NAME}
            icon={<Palette aria-hidden />}
            pressed={panel === 'design'}
            disabled={commenting || editing}
            tip={editing ? DESIGN_DISABLED_BY_EDITING : commenting ? DESIGN_DISABLED_BY_COMMENTS : DESIGN_PANEL_NAME}
            onClick={() => togglePanel('design')}
          />
        )}
        {framed || !historyAvailable ? null : (
          <ToolButton
            size="lg"
            tipSide="bottom"
            label={HISTORY_PANEL_NAME}
            icon={<History aria-hidden />}
            pressed={panel === 'history'}
            disabled={commenting}
            tip={commenting ? HISTORY_DISABLED_BY_COMMENTS : HISTORY_PANEL_NAME}
            onClick={() => togglePanel('history')}
          />
        )}
        {empty ? null : (
          <span className="relative inline-flex" data-dash-sources="">
            <ToolButton
              size="lg"
              tipSide="bottom"
              label={SOURCES_PANEL_NAME}
              icon={<Database aria-hidden />}
              shortcut={SOURCES_SHORTCUT}
              pressed={sourcesOpen}
              disabled={commenting}
              tip={commenting ? SOURCES_DISABLED_BY_COMMENTS : withNote(sourcesOpen ? HIDE_SOURCES_TIP : SOURCES_TIP, attention)}
              onClick={() => togglePanel('sources')}
            />
            {attention === null ? null : <span aria-hidden className={cn('dash-attention', bad && 'dash-attention-bad')} />}
          </span>
        )}
        {framed ? null : <CommentsButton comments={pageComments} side="bottom" />}
      </div>
    </header>
  );
}
