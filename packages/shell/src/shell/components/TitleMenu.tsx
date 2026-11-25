/**
 * The title button and the artifact's menu under it (Switch artifact,
 * Share, Export, the page's own actions, Pin, Rename, Duplicate, Version
 * history, Storage, Delete…), or the rename field in its place.
 */

import {
  Check,
  ChevronDown,
  Clock,
  Code,
  Copy,
  Database,
  Download,
  ExternalLink,
  Folder,
  History,
  LayoutGrid,
  Link,
  List,
  MessageCircle,
  MessageSquare,
  Pencil,
  Pin,
  PinOff,
  Redo2,
  RefreshCw,
  Save,
  Search,
  Share,
  Trash2,
  Undo2,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ConfirmDialog, Menu, MenuItem, MenuLabel, MenuSeparator, MenuSubmenu, TextInput, cn } from '@open-artifact/ui';
import { ago, bytesText } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { command, openExternal, reloadPage, runAction } from '../bridge.ts';
import {
  copyGivenLink,
  copyPath,
  deleteArtifact,
  duplicate,
  loadGivenLink,
  loadLibrary,
  openSession,
  refreshArtifact,
  rename,
  togglePin,
} from '../actions.ts';
import { mayEdit } from '../../lib/cloud.ts';
import { useAgentName, useCanOpenSession, useCloud, useOwner, useRole, useTitle } from '../hooks.ts';
import { actionLabel, whyText } from '../labels.ts';
import { actionOf, hasExportTab, menuActions, switchPool } from '../model.ts';
import { useBoot, useShell } from '../store.ts';

import { DocCopyDialog } from './DocCopyDialog.tsx';

/** Icons of the built-in page actions. */
const ACTION_ICON: Record<string, ReactNode> = {
  save_now: <Save className="size-3.5" />,
  open_find: <Search className="size-3.5" />,
  undo: <Undo2 className="size-3.5" />,
  redo: <Redo2 className="size-3.5" />,
  edit_page: <Pencil className="size-3.5" />,
  use_page: <Copy className="size-3.5" />,
  comment_selection: <MessageCircle className="size-3.5" />,
  open_page_list: <List className="size-3.5" />,
  hand_off_code: <Code className="size-3.5" />,
};

/** The title in place, as a field: Enter or leaving it saves, Escape cancels. */
function RenameField() {
  const title = useTitle();
  const [draft, setDraft] = useState(title);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const mountedAt = useRef(0);
  useEffect(() => {
    mountedAt.current = performance.now();
    ref.current?.focus();
    ref.current?.select();
  }, []);
  // The menu that started the rename hands focus back as it closes: take it again rather than end the rename.
  const onBlur = (): void => {
    if (performance.now() - mountedAt.current < 400) {
      requestAnimationFrame(() => {
        ref.current?.focus();
        ref.current?.select();
      });
      return;
    }
    finish(true);
  };
  const finish = (save: boolean): void => {
    if (done.current) return;
    done.current = true;
    useShell.getState().setRenaming(false);
    if (save) void rename(draft);
  };
  return (
    <TextInput
      ref={ref}
      value={draft}
      maxLength={200}
      aria-label={t('artifactName')}
      className="h-8 w-[min(360px,50vw)] text-sm font-medium"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={onBlur}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          event.preventDefault();
          finish(true);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish(false);
        }
      }}
    />
  );
}

/** Switch artifact's submenu: the owner session's artifacts, or the most recent. */
function SwitchItems() {
  const boot = useBoot();
  const library = useShell((state) => state.library);
  const owner = useOwner();
  const { inSession, list } = switchPool(library ?? [], owner);
  return (
    <>
      <MenuLabel>{inSession ? t('inThisSession') : t('recent')}</MenuLabel>
      {library === null ? <MenuLabel>{t('loading')}</MenuLabel> : null}
      {list.slice(0, 12).map((a) => (
        <MenuItem
          key={a.id}
          icon={a.id === boot.id ? <Check className="size-3.5 text-accent" /> : null}
          shortcut={ago(a.contentAt || a.updatedAt)}
          onSelect={() => {
            if (a.id !== boot.id) location.href = `/a/${encodeURIComponent(a.id)}${location.search}`;
          }}
        >
          <span className={cn('block max-w-56 truncate', a.id === boot.id && 'font-semibold')} title={`${a.title} · ${a.typeTitle}`}>
            {a.title || a.id}
          </span>
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem icon={<LayoutGrid className="size-3.5" />} shortcut={library ? String(library.length) : undefined} onSelect={() => (location.href = '/')}>
        {t('allArtifacts')}
      </MenuItem>
    </>
  );
}

/** The title button with the artifact's menu. */
export function TitleMenu() {
  const boot = useBoot();
  const title = useTitle();
  const open = useShell((state) => state.menuOpen);
  const renaming = useShell((state) => state.renaming);
  const [copying, setCopying] = useState(false);
  const confirming = useShell((state) => state.confirmingDelete);
  const artifact = useShell((state) => state.artifact);
  const report = useShell((state) => state.report);
  const library = useShell((state) => state.library);
  const owner = useOwner();
  const canOpen = useCanOpenSession();
  const agent = useAgentName();
  // On a cloud host: no folder, and no duplicate or delete (not offered there yet); renaming by role, and pinning for
  // anyone signed in (the host keeps pins per person; a link guest has nowhere to keep one).
  const cloudInfo = useCloud();
  const cloud = !!cloudInfo;
  const role = useRole();
  const local = !cloud;
  const canRename = mayEdit(role);
  const canPin = local || !!cloudInfo?.user;
  const pageActions = menuActions(report).filter(action => boot.type !== 'docs' || (action.id !== 'rename_doc' && action.id !== 'open_page_list'));
  const hasPage = !!boot.page && !boot.empty && !boot.problem;
  const store = useShell.getState();

  useEffect(() => {
    document.title = title;
  }, [title]);

  const onOpenChange = (next: boolean): void => {
    store.setMenuOpen(next);
    if (next) {
      // Open at once on what is known; refresh behind it.
      if (useShell.getState().library === null) void loadLibrary();
      void refreshArtifact();
      void loadGivenLink();
    }
  };

  const confirm = (
    <ConfirmDialog
      open={confirming}
      onOpenChange={(next) => store.setConfirmingDelete(next)}
      title={t('deleteTitle', { title })}
      description={t('deleteBody', { root: boot.root })}
      confirmLabel={t('delete')}
      danger
      onConfirm={() => void deleteArtifact()}
    />
  );

  if (boot.typeServer && boot.type === 'docs') return <>
    <Menu trigger={<button type="button" aria-label={t('artifactOptions')} className="flex min-w-0 items-center gap-1 px-2">
      <span className="truncate">{title}</span><ChevronDown className="size-3.5" />
    </button>}>
      {report.actions?.some(action => action.id === 'rename_doc') &&
        <MenuItem onSelect={() => runAction('rename_doc')}>{t('rename')}</MenuItem>}
      {boot.typeServer.role === 'owner' &&
        <MenuItem disabled={report.leaveLosesWork} onSelect={() => setCopying(true)}>{t('duplicate')}</MenuItem>}
      <MenuItem onSelect={() => store.openShare('share')}>{t('share')}</MenuItem>
      {boot.typeServer.role === 'owner' && <MenuItem onSelect={() => store.openShare('export')}>{t('export')}</MenuItem>}
      <MenuItem onSelect={() => command({ cmd: 'history' })}>{t('versionHistory')}</MenuItem>
    </Menu>
    {copying && <DocCopyDialog title={title} close={() => setCopying(false)} />}
  </>;

  if (renaming) return (
    <>
      <RenameField />
      {confirm}
    </>
  );

  const updatedAt = artifact ? artifact.contentAt || artifact.updatedAt || artifact.createdAt : null;
  const switchCount = switchPool(library ?? [], owner).list.length;

  return (
    <>
      <Menu
        open={open}
        onOpenChange={onOpenChange}
        align="start"
        trigger={
          <button
            type="button"
            title={`${title} · ${boot.typeTitle}`}
            aria-label={t('artifactOptions')}
            className="inline-flex h-8 min-w-0 max-w-full items-center gap-1 rounded-control px-2.5 text-sm font-medium text-fg outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-accent data-[popup-open]:bg-hover"
          >
            <span className="truncate">{title}</span>
            <ChevronDown className="size-3.5 shrink-0 text-fg-muted" />
          </button>
        }
      >
        <MenuSubmenu
          icon={<LayoutGrid className="size-3.5" />}
          label={
            <span className="flex items-center justify-between gap-4">
              {t('switchArtifact')}
              {library ? <span className="text-xs text-fg-subtle">{switchCount}</span> : null}
            </span>
          }
        >
          <SwitchItems />
        </MenuSubmenu>
        <MenuLabel>
          <span className="flex items-center gap-2">
            <Clock className="size-3.5" />
            {t('updated', { when: ago(updatedAt) || t('never') })}
          </span>
        </MenuLabel>
        <MenuSeparator />
        <MenuItem icon={<Share className="size-3.5" />} onSelect={() => store.openShare('share')}>
          {t('share')}
        </MenuItem>
        <MenuItem icon={<Download className="size-3.5" />} disabled={!hasExportTab(report)} onSelect={() => store.openShare('export')}>
          {t('export')}
        </MenuItem>
        {canOpen && owner ? (
          <MenuItem icon={<MessageSquare className="size-3.5" />} shortcut={owner.live ? (owner.harnessTitle ?? owner.harness) : `${owner.harnessTitle ?? owner.harness} · ${t('offline')}`} onSelect={openSession}>
            {t('openSession')}
          </MenuItem>
        ) : null}
        {pageActions.length ? <MenuSeparator /> : null}
        {pageActions.map((action) => (
          <MenuItem key={action.id} icon={ACTION_ICON[action.id]} disabled={action.disabled} onSelect={() => runAction(action.id)}>
            <span title={action.disabled ? whyText(action.why, agent) : undefined}>{actionLabel(action)}</span>
          </MenuItem>
        ))}
        {canPin || canRename || local || report.history ? <MenuSeparator /> : null}
        {canPin ? (
          <MenuItem icon={artifact?.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />} onSelect={() => void togglePin()}>
            {artifact?.pinned ? t('unpin') : t('pin')}
          </MenuItem>
        ) : null}
        {canRename ? (
          <MenuItem icon={<Pencil className="size-3.5" />} disabled={boot.type === 'docs' && !actionOf(report, 'rename_doc')} onSelect={() => boot.type === 'docs' ? runAction('rename_doc') : store.setRenaming(true)}>
            {t('rename')}
          </MenuItem>
        ) : null}
        {local ? (
          <MenuItem icon={<Copy className="size-3.5" />} disabled={boot.type === 'docs' && report.leaveLosesWork} onSelect={() => boot.type === 'docs' ? setCopying(true) : void duplicate()}>
            {t('duplicate')}
          </MenuItem>
        ) : null}
        {report.history ? (
          <MenuItem icon={<History className="size-3.5" />} onSelect={() => command({ cmd: 'history' })}>
            {t('versionHistory')}
          </MenuItem>
        ) : null}
        <MenuSeparator />
        {hasPage ? (
          <MenuItem
            icon={<ExternalLink className="size-3.5" />}
            onSelect={() => openExternal(boot.pageUrl || new URL(boot.page!, location.href).href)}
          >
            {t('openInNewTab')}
          </MenuItem>
        ) : null}
        <MenuItem icon={<Link className="size-3.5" />} onSelect={() => void copyGivenLink()}>
          {t('copyLink')}
        </MenuItem>
        {hasPage ? (
          <MenuItem icon={<RefreshCw className="size-3.5" />} onSelect={reloadPage}>
            {t('refresh')}
          </MenuItem>
        ) : null}
        {local ? (
          <>
            <MenuSubmenu
              icon={<Database className="size-3.5" />}
              label={
                <span className="flex items-center justify-between gap-4">
                  {t('storage')}
                  <span className="text-xs text-fg-subtle">{bytesText(artifact?.bytes)}</span>
                </span>
              }
            >
              <MenuLabel>
                <span className="flex max-w-72 items-start gap-2 break-all" title={boot.root}>
                  <Folder className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    {boot.root}
                    {artifact ? <span className="block text-fg-subtle">{t('inThisFolder', { size: bytesText(artifact.bytes) })}</span> : null}
                  </span>
                </span>
              </MenuLabel>
              <MenuSeparator />
              <MenuItem icon={<Copy className="size-3.5" />} onSelect={() => void copyPath()}>
                {t('copyPath')}
              </MenuItem>
            </MenuSubmenu>
            <MenuSeparator />
            <MenuItem icon={<Trash2 className="size-3.5" />} danger onSelect={() => store.setConfirmingDelete(true)}>
              {t('delete')}
            </MenuItem>
          </>
        ) : null}
      </Menu>
      {copying && <DocCopyDialog title={title} close={() => setCopying(false)} />}
      {confirm}
    </>
  );
}
