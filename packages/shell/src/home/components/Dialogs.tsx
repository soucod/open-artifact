/** The home page's dialogs (create, rename) and the undo bar after a delete. */

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Button, Dialog, TextInput } from '@open-artifact/ui';
import { t } from '../../lib/i18n.ts';
import { createArtifact, renameArtifact, undoDelete } from '../actions.ts';
import { useHome } from '../store.ts';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mt-3 block">
      <span className="mb-1 block text-xs text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

/** New artifact: a title and an optional folder, then `artifacts.create` and the new artifact's Shell. */
export function CreateDialog() {
  const type = useHome((state) => state.creating);
  const [title, setTitle] = useState('');
  const [folder, setFolder] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!type) return;
    setTitle('');
    setFolder('');
    setError('');
  }, [type]);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!type || busy) return;
    setBusy(true);
    const failure = await createArtifact(type, title, folder);
    setBusy(false);
    if (failure) setError(failure);
  };
  return (
    <Dialog
      open={!!type}
      onOpenChange={(open) => !open && useHome.getState().setCreating(null)}
      title={type ? t('newOf', { type: type.title }) : ''}
      description={type?.description ? type.description.slice(0, 160) : undefined}
    >
      <form onSubmit={(event) => void submit(event)}>
        <Field label={t('title')}>
          <TextInput autoFocus required value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} className="h-8" />
        </Field>
        <Field label={t('folderOptional')}>
          <TextInput value={folder} placeholder={t('folderHint')} onChange={(event) => setFolder(event.target.value)} className="h-8" />
        </Field>
        {error ? (
          <p role="alert" className="mb-0 mt-2 text-xs text-danger">
            {error}
          </p>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button size="lg" onClick={() => useHome.getState().setCreating(null)}>
            {t('cancel')}
          </Button>
          <Button size="lg" type="submit" variant="primary" disabled={busy || !title.trim()}>
            {t('create')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Rename an artifact. */
export function RenameDialog() {
  const artifact = useHome((state) => state.renaming);
  const [title, setTitle] = useState('');
  useEffect(() => setTitle(artifact?.title ?? ''), [artifact]);
  const close = (): void => useHome.getState().setRenaming(null);
  return (
    <Dialog open={!!artifact} onOpenChange={(open) => !open && close()} title={t('renameArtifact')}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (artifact) void renameArtifact(artifact, title);
          close();
        }}
      >
        <Field label={t('title')}>
          <TextInput autoFocus value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} className="h-8" />
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button size="lg" onClick={close}>
            {t('cancel')}
          </Button>
          <Button size="lg" type="submit" variant="primary" disabled={!title.trim()}>
            {t('save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** "Deleted … · Undo" for a few seconds after a delete. */
export function UndoBar() {
  const undo = useHome((state) => state.undo);
  if (!undo) return null;
  return (
    <div role="status" className="fixed bottom-5 left-1/2 z-[1100] flex max-w-[calc(100vw-32px)] -translate-x-1/2 items-center gap-3 rounded-lg bg-fg px-3.5 py-2 text-[13px] text-surface shadow-popup">
      <span className="min-w-0 truncate">{t(undo.trash ? 'movedToTrash' : 'deleted', { title: undo.title })}</span>
      <button type="button" className="shrink-0 font-semibold text-surface underline-offset-2 hover:underline" onClick={() => void undoDelete()}>
        {t('undo')}
      </button>
    </div>
  );
}
