/**
 * The cloud home page's own parts: Upload (a button and dropping a .zip on the page), where an upload stands, the
 * Trash tab (Restore, Delete forever) and its confirmation. Only drawn when a cloud host serves the page.
 */

import { RotateCcw, Trash2, TriangleAlert, Upload, X } from 'lucide-react';
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Button, Dialog, EmptyState, IconButton, Tabs } from '@open-artifact/ui';
import { ago } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { loadTrash, purgeTrashed, restoreTrashed, uploadFiles } from '../actions.ts';
import { homeBoot } from '../host.ts';
import { useHome, type CloudTab } from '../store.ts';
import { keepNote, offersPurge, trashRows, type TrashRow } from '../trash.ts';
import { dragHasFiles, uploadBusy, uploadPercent } from '../upload.ts';
import { ArtifactList, Chip } from './ArtifactList.tsx';

/** "Upload": picks a .zip and sends it. */
export function UploadButton() {
  const input = useRef<HTMLInputElement>(null);
  const busy = useHome((state) => uploadBusy(state.upload));
  return (
    <>
      <Button size="lg" icon={<Upload className="size-3.5" />} disabled={busy} title={t('uploadHint')} onClick={() => input.current?.click()}>
        {t('upload')}
      </Button>
      <input
        ref={input}
        type="file"
        accept=".zip,application/zip,application/x-zip-compressed"
        data-home-upload=""
        className="hidden"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          // The same file can be picked again after a failure.
          event.target.value = '';
          uploadFiles(files);
        }}
      />
    </>
  );
}

/** Where an upload stands: a bar while it goes, the plain-words reason when the site refused it. */
export function UploadStatus() {
  const upload = useHome((state) => state.upload);
  if (upload.kind === 'idle') return null;
  if (upload.kind === 'failed') {
    return (
      <div role="alert" data-home-upload-error="" className="mb-3 flex items-start gap-2 rounded-lg border border-line bg-surface p-3 text-[13px]">
        <TriangleAlert className="mt-px size-4 shrink-0 text-danger" />
        <span className="min-w-0 flex-1 break-words">{t(upload.said.key, upload.said.vars)}</span>
        <IconButton label={t('dismiss')} size="sm" noTooltip icon={<X className="size-3.5" />} onClick={() => useHome.getState().uploadEvent({ type: 'dismiss' })} />
      </div>
    );
  }
  const percent = uploadPercent(upload);
  const text =
    upload.kind === 'done'
      ? t('uploadOpening', { name: upload.name })
      : upload.kind === 'checking'
        ? t('uploadChecking', { name: upload.name })
        : percent === null
          ? t('uploadSendingSize', { name: upload.name })
          : t('uploadSending', { name: upload.name, percent });
  return (
    <div role="status" data-home-upload-state={upload.kind} className="mb-3 rounded-lg border border-line bg-surface p-3 text-[13px]">
      <div className="mb-2 truncate">{text}</div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-accent transition-[width] duration-150" style={{ width: `${percent ?? 5}%` }} />
      </div>
    </div>
  );
}

/** The artifact list as a drop target for a .zip: an outline and a word while a file is dragged over it. */
function DropZone({ children }: { children: ReactNode }) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const enabled = !!homeBoot.cloud?.user;
  const files = (event: DragEvent): boolean => enabled && dragHasFiles([...event.dataTransfer.types]);
  return (
    <div
      className="relative"
      data-home-drop={over ? 'over' : ''}
      onDragEnter={(event) => {
        if (!files(event)) return;
        event.preventDefault();
        depth.current++;
        setOver(true);
      }}
      onDragOver={(event) => {
        if (!files(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={(event) => {
        if (!files(event)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setOver(false);
      }}
      onDrop={(event) => {
        if (!files(event)) return;
        event.preventDefault();
        depth.current = 0;
        setOver(false);
        uploadFiles([...event.dataTransfer.files]);
      }}
    >
      {children}
      {over ? (
        <div className="pointer-events-none absolute inset-0 z-10 grid min-h-32 place-items-center rounded-xl border-2 border-dashed border-accent bg-surface/80 text-[13px] font-medium text-accent">
          <span className="flex items-center gap-2">
            <Upload className="size-4" />
            {t('uploadDrop')}
          </span>
        </div>
      ) : null}
    </div>
  );
}

/** One trashed artifact: its title, type, when it went to the trash, Restore and (its owner's) Delete forever. */
function TrashItem({ row }: { row: TrashRow }) {
  const unsupported = useHome((state) => state.purgeUnsupported);
  return (
    <div data-home-trashed={row.id} className="flex min-w-0 flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-3.5">
      <div className="min-w-0 flex-1">
        <div className="break-words font-semibold">{row.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-fg-muted">
          <Chip>{row.typeTitle}</Chip>
          <span>{row.when.kind === 'trashed' ? t('trashedWhen', { when: ago(row.when.at) }) : t('updated', { when: ago(row.when.at) })}</span>
        </div>
      </div>
      {row.mine ? (
        <div className="flex items-center gap-1.5">
          <Button size="sm" icon={<RotateCcw className="size-3" />} onClick={() => void restoreTrashed(row)}>
            {t('restore')}
          </Button>
          {offersPurge(row, unsupported) ? (
            <Button size="sm" variant="ghost" className="text-danger" icon={<Trash2 className="size-3" />} onClick={() => useHome.getState().setPurging({ id: row.id, title: row.title })}>
              {t('deleteForever')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The Trash tab: what is in it, and how long it stays when the host says. */
function TrashList() {
  const trash = useHome((state) => state.trash);
  useEffect(() => {
    void loadTrash();
  }, []);
  const note = keepNote(homeBoot.cloud?.trashDays);
  const header = (
    <p className="mb-3 mt-0 text-xs text-fg-muted">
      {t('trashNote')}
      {note ? ` ${t(note.key, note.vars)}` : ''}
    </p>
  );
  if (trash === null) return <p className="py-8 text-fg-muted">{t('loading')}</p>;
  const rows = trashRows(trash);
  return (
    <div data-home-trash="">
      {header}
      {rows.length ? (
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <TrashItem key={row.id} row={row} />
          ))}
        </div>
      ) : (
        <EmptyState title={t('trash')}>{t('trashEmpty')}</EmptyState>
      )}
    </div>
  );
}

/** "Delete forever?": says it cannot be undone and that the people it was shared with lose it. */
export function PurgeDialog() {
  const purging = useHome((state) => state.purging);
  const close = (): void => useHome.getState().setPurging(null);
  return (
    <Dialog
      open={!!purging}
      onOpenChange={(open) => !open && close()}
      title={purging ? t('purgeTitle', { title: purging.title }) : ''}
      description={t('purgeBody')}
      footer={
        <>
          <Button size="lg" onClick={close}>
            {t('cancel')}
          </Button>
          <Button
            size="lg"
            variant="danger"
            onClick={() => {
              if (purging) void purgeTrashed(purging);
              close();
            }}
          >
            {t('deleteForever')}
          </Button>
        </>
      }
    />
  );
}

/** The cloud home page's body: Artifacts (a drop target for a .zip) and Trash. */
export function CloudLibrary() {
  const tab = useHome((state) => state.cloudTab);
  return (
    <Tabs<CloudTab>
      value={tab}
      onChange={(next) => useHome.getState().setCloudTab(next)}
      // As the local tabs: mark the active tab by aria.
      className="[&>[role=tabpanel]]:overflow-visible [&>[role=tabpanel]]:pt-4 [&_[role=tab][aria-selected=true]]:bg-hover [&_[role=tab][aria-selected=true]]:text-fg"
      items={[
        {
          value: 'artifacts',
          label: t('artifacts'),
          content: (
            <DropZone>
              <UploadStatus />
              <ArtifactList />
            </DropZone>
          ),
        },
        { value: 'trash', label: t('trash'), content: <TrashList /> },
      ]}
    />
  );
}
