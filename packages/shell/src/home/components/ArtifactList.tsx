/** The artifact library: a card per artifact, opening its Shell. */

import type { ArtifactView } from '@open-artifact/protocol';
import { Cloud, Copy, Ellipsis, ExternalLink, Link, MessageSquare, Pencil, Pin, PinOff, Trash2, TriangleAlert } from 'lucide-react';
import type { MouseEvent, ReactNode } from 'react';
import { Button, EmptyState, IconButton, Menu, MenuItem, MenuSeparator } from '@open-artifact/ui';
import { OwnerBadge } from '../../components/OwnerBadge.tsx';
import { ago } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { backToSession, copyWebLink, deleteArtifact, duplicateArtifact, openArtifact, openOnWeb, shellHref, togglePin } from '../actions.ts';
import { homeBoot } from '../host.ts';
import { forHost, ownerBadge, sortArtifacts } from '../model.ts';
import { useHome } from '../store.ts';

/** A small rounded label. */
export function Chip({ children }: { children: ReactNode }) {
  return <span className="inline-flex max-w-full items-center gap-1 truncate rounded-full bg-surface-2 px-2 py-px text-xs text-fg-muted">{children}</span>;
}

/** One artifact's card. */
function ArtifactCard({ artifact }: { artifact: ArtifactView }) {
  const host = useHome((state) => state.host);
  // Published to the web from this computer: its web address (local only; the daemon's list says where).
  const web = homeBoot.cloud ? undefined : artifact.remote?.url;
  const href = shellHref(artifact.id);
  // A cloud host: no folder, no owner session, no duplicate; its owner moves it to the trash (Restore is in Trash).
  const local = !homeBoot.cloud;
  const canTrash = !local && artifact.role === 'owner';
  // A host lists artifacts shared with the person too: renaming needs an editor; pins are the person's own.
  const canRename = local || artifact.role === undefined || artifact.role === 'owner' || artifact.role === 'editor';
  const canGoBack = local && !!(host?.caps.sessions && artifact.owner?.session && (!host.harness || artifact.owner.harness === host.harness));
  // Anywhere on the card opens it; the title stays a real link for the keyboard and new tabs.
  const onClick = (event: MouseEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement;
    if (target.closest('a, button, [role="menu"]') || getSelection()?.toString()) return;
    openArtifact(artifact);
  };
  return (
    <div
      onClick={onClick}
      className="group flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-xl border border-line bg-surface transition-[border-color,box-shadow] hover:border-line-strong hover:shadow-popup"
    >
      {artifact.thumbnail ? (
        <img src={artifact.thumbnail} alt="" loading="lazy" className="aspect-[16/9] w-full border-b border-line bg-surface-2 object-cover object-top" />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3.5">
        <a
          href={href}
          className="flex min-w-0 items-center gap-1.5 break-words font-semibold text-fg no-underline hover:text-accent"
          onClick={(event) => {
            // A host that shows artifacts itself gets them; a modified click still opens a new tab.
            if (!host?.caps.artifacts || event.metaKey || event.ctrlKey || event.shiftKey) return;
            event.preventDefault();
            openArtifact(artifact);
          }}
        >
          {artifact.pinned ? <Pin className="size-3.5 shrink-0 text-fg-muted" aria-label={t('pinned')} /> : null}
          <span className="min-w-0">{artifact.title}</span>
          {web ? (
            <span title={t('pubCloudAt', { url: web })} data-home-published="" className="inline-flex shrink-0 text-accent">
              <Cloud className="size-3.5" aria-label={t('pubCloudMark')} />
            </span>
          ) : null}
        </a>
        <div className="flex flex-wrap items-center gap-1.5">
          <Chip>{artifact.typeTitle}</Chip>
          {local ? (
            <Chip>
              <OwnerBadge state={ownerBadge(artifact.owner)} prefix={artifact.owner ? (artifact.owner.harnessTitle ?? artifact.owner.harness) : undefined} />
            </Chip>
          ) : null}
          {local && artifact.open ? <Chip>{t('pageOpen')}</Chip> : null}
        </div>
        {artifact.typeMissing ? (
          <div className="flex items-center gap-1 text-xs text-warning">
            <TriangleAlert className="size-3.5" />
            {t('typeMissing')}
          </div>
        ) : null}
        {local ? (
          <div className="break-all text-xs text-fg-muted" title={artifact.root}>
            {artifact.root}
          </div>
        ) : null}
        <div className="text-xs text-fg-muted">{t('updated', { when: ago(artifact.contentAt || artifact.updatedAt) })}</div>
        <div className="mt-auto flex items-center gap-1.5 pt-1">
          <Button size="sm" variant="primary" onClick={() => openArtifact(artifact)}>
            {t('open')}
          </Button>
          {canGoBack ? (
            <Button size="sm" icon={<MessageSquare className="size-3" />} onClick={() => backToSession(artifact)}>
              {t('backToSession')}
            </Button>
          ) : null}
          <span className="flex-1" />
          <Menu align="end" trigger={<IconButton label={t('moreActions')} icon={<Ellipsis className="size-4" />} size="sm" noTooltip />}>
            <MenuItem icon={artifact.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />} onSelect={() => void togglePin(artifact)}>
              {artifact.pinned ? t('unpin') : t('pin')}
            </MenuItem>
            {web ? (
              <>
                <MenuItem icon={<ExternalLink className="size-3.5" />} onSelect={() => openOnWeb(web)}>
                  {t('openOnWeb')}
                </MenuItem>
                <MenuItem icon={<Link className="size-3.5" />} onSelect={() => void copyWebLink(web)}>
                  {t('copyWebLink')}
                </MenuItem>
              </>
            ) : null}
            {canRename ? (
              <MenuItem icon={<Pencil className="size-3.5" />} onSelect={() => useHome.getState().setRenaming(artifact)}>
                {t('rename')}
              </MenuItem>
            ) : null}
            {local ? (
              <>
                <MenuItem icon={<Copy className="size-3.5" />} onSelect={() => void duplicateArtifact(artifact)}>
                  {t('duplicate')}
                </MenuItem>
                <MenuSeparator />
                <MenuItem icon={<Trash2 className="size-3.5" />} danger onSelect={() => void deleteArtifact(artifact)}>
                  {t('delete')}
                </MenuItem>
              </>
            ) : null}
            {canTrash ? (
              <>
                <MenuSeparator />
                <MenuItem icon={<Trash2 className="size-3.5" />} danger onSelect={() => void deleteArtifact(artifact)}>
                  {t('moveToTrash')}
                </MenuItem>
              </>
            ) : null}
          </Menu>
        </div>
      </div>
    </div>
  );
}

/** The artifact grid, pinned first. */
export function ArtifactList() {
  const all = useHome((state) => state.artifacts);
  const library = useHome((state) => state.host?.library ?? null);
  const artifacts = all && library ? forHost(all, library) : all;
  if (artifacts === null) return <p className="py-8 text-fg-muted">{t('loading')}</p>;
  if (!artifacts.length) return <EmptyState title={t('artifacts')}>{t(homeBoot.cloud ? 'noArtifactsCloud' : 'noArtifacts')}</EmptyState>;
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
      {sortArtifacts(artifacts).map((artifact) => (
        <ArtifactCard key={artifact.id} artifact={artifact} />
      ))}
    </div>
  );
}
