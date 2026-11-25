/**
 * The Shell's bar: the title menu, the working indicator and the page's save
 * state on the left; who else is here, History, Share, comments, Ask agent
 * and Close on the right.
 */

import { PanelLeft, CloudAlert, History, LoaderCircle, Lock, MessageSquare, RotateCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, IconButton, cn } from '@open-artifact/ui';
import { StatusDot } from '../../components/OwnerBadge.tsx';
import { t } from '../../lib/i18n.ts';
import { command, runAction } from '../bridge.ts';
import { closeShell, openSession } from '../actions.ts';
import { Account } from '../../components/Account.tsx';
import { SiteBrand } from '../../components/SiteBrand.tsx';
import { mayComment } from '../../lib/cloud.ts';
import { useAgentName, useCanOpenSession, useCloud, useMayAsk, useOwner, useOwnerState, useRole, useWorking } from '../hooks.ts';
import { SAVING_SHOWN_AFTER_MS, saveIndicator } from '../model.ts';
import { useShell } from '../store.ts';
import { Peers } from './Peers.tsx';
import { SharePanel } from './SharePanel.tsx';
import { CommentsButton } from './CommentsButton.tsx';
import { TitleMenu } from './TitleMenu.tsx';

/** "<Agent> is working…" while the owner session runs. */
function Working() {
  const agent = useAgentName();
  if (!useWorking()) return null;
  return (
    <span role="status" className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap text-xs text-fg-muted">
      <LoaderCircle className="size-3.5 shrink-0 animate-spin text-accent motion-reduce:animate-none" />
      <span className="truncate max-sm:hidden">{t('working', { agent })}</span>
    </span>
  );
}

/** `active` has held for `ms` (false again as soon as it stops). */
function useLasting(active: boolean, ms: number): boolean {
  const [lasting, setLasting] = useState(false);
  useEffect(() => {
    if (!active) {
      setLasting(false);
      return;
    }
    const timer = setTimeout(() => setLasting(true), ms);
    return () => clearTimeout(timer);
  }, [active, ms]);
  return active && lasting;
}

/** The page's save state (the header indicator): Saving…, a retry after a failed save, Read-only. */
function SaveState() {
  const indicated = useShell(s => s.boot?.type === 'docs' && s.report.saved === 'reconnecting' ? 'reconnecting' : saveIndicator(s.report));
  // Saving… only once a save lasts, so the bar does not flicker on every edit.
  const lasting = useLasting(indicated === 'saving', SAVING_SHOWN_AFTER_MS);
  const state = indicated === 'saving' && !lasting ? 'none' : indicated;
  const quiet = 'inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap text-xs text-fg-muted';
  switch (state) {
    case 'saving':
    case 'reconnecting':
      return (
        <span role="status" data-shell-save-state={state} className={quiet}>
          <LoaderCircle className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
          <span className="max-sm:hidden">{t(state)}</span>
        </span>
      );
    case 'unsaved':
      return (
        <span role="status" data-shell-save-state="unsaved" title={t('notSavedTitle')} className={cn(quiet, 'text-danger')}>
          <CloudAlert className="size-3.5 shrink-0" />
          <span className="max-sm:hidden">{t('notSaved')}</span>
        </span>
      );
    case 'retry':
      return (
        <Button data-shell-save-state="unsaved" size="sm" variant="ghost" className="text-danger" title={t('notSavedTitle')} icon={<RotateCw className="size-3.5" />} onClick={() => runAction('save_now')}>
          <span className="max-sm:hidden">{t('saveRetry')}</span>
        </Button>
      );
    case 'readonly':
      return (
        <span title={t('readOnlyTitle')} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-fg-muted">
          <Lock className="size-3" />
          {t('readOnly')}
        </span>
      );
    default:
      return null;
  }
}

/** Version history (`report.history`): the page opens its own panel. */
function HistoryButton() {
  const history = useShell(s => s.report.history ?? (!s.pageReady && s.rememberedChrome.history));
  const enabled = useShell(s => s.pageReady && !!s.report.history);
  if (!history) return null;
  return <IconButton label={t('versionHistory')} icon={<History className="size-4" />} size="lg" disabled={!enabled} onClick={() => command({ cmd: 'history' })} />;
}


/** Ask agent: shows the owner session in the host when it can, else toggles the ask pane. */
function AskButton() {
  const agent = useAgentName();
  const open = useShell((state) => state.askOpen);
  const canOpen = useCanOpenSession();
  const owner = useOwner();
  const status = useOwnerState();
  const title = canOpen && owner ? t('openHarnessSession', { harness: owner.harnessTitle ?? owner.harness }) : open ? t('hideAsk') : t('messageAgent', { agent });
  return (
    <Button
      size="lg"
      variant="ghost"
      title={title}
      aria-expanded={open}
      className={cn(open && 'bg-hover')}
      icon={
        <span className="relative">
          <MessageSquare className="size-4" />
          <StatusDot state={status} className="absolute -right-0.5 -top-0.5 size-1.5" />
        </span>
      }
      onClick={() => (canOpen && !open ? openSession() : useShell.getState().setAskOpen(!open))}
    >
      <span className="max-sm:hidden">{t('ask', { agent })}</span>
    </Button>
  );
}

/** The bar. */
export function TopBar() {
  const comments = useShell(s => s.report.comments ?? (s.pageReady ? undefined : s.rememberedChrome.comments));
  const commentsReady = useShell(s => s.pageReady && !!s.report.comments);
  const standalone = useShell(state => state.boot?.typeServer);
  const docs = useShell(state => state.boot?.type === 'docs');
  const title = useShell(state => state.boot?.type === 'docs' ? state.report.title || state.boot.title : state.boot?.title);
  const hostToolbar = useShell((state) => !!state.host?.caps.toolbar);
  const role = useRole();
  const askable = useMayAsk();
  const cloud = useCloud();
  return (
    <header aria-label={t('artifactOptions')} className={cn("flex shrink-0 items-center gap-2 border-b border-line bg-surface pl-2.5 pr-2 max-sm:gap-1 max-sm:px-1.5", docs ? 'h-10' : 'h-12')}>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {cloud?.site?.brand ? (
          <a href={`${cloud.appOrigin}/`} className="flex min-w-0 max-w-40 shrink-0 items-center rounded px-1 hover:bg-hover">
            <SiteBrand site={cloud.site} compact />
          </a>
        ) : null}
        {docs && <button aria-label={t('documentTabs')} className="hidden size-7 shrink-0 items-center justify-center [@media(max-width:480px)_and_(pointer:coarse)]:inline-flex"
          onClick={() => runAction('open_page_list')}><PanelLeft className="size-4" /></button>}
        {standalone && !docs ? <span className="truncate font-medium">{title}</span> : <TitleMenu />}
        <Working />
        <SaveState />
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Peers />
        {!docs && <HistoryButton />}
        <SharePanel />
        {docs && <HistoryButton />}
        <CommentsButton comments={comments} command={command} disabled={!commentsReady} readOnly={!mayComment(role)} />
        {askable ? <AskButton /> : null}
        {cloud ? <Account cloud={cloud} /> : null}
        {hostToolbar || standalone ? null : <IconButton label={t('close')} icon={<X className="size-4" />} size="lg" onClick={closeShell} />}
      </div>
    </header>
  );
}
