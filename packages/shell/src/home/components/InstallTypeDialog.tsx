/**
 * "Install type": a package (a `.oatype` file, or its https address) read and checked by the daemon first, then
 * everything the person decides on (name, version, source, what the page may use, which hosts it may reach, and
 * its SKILL.md in full: what agents will be told), and only then Install. Also "Update" of an installed type, which
 * reads its recorded source again and shows the same.
 */

import type { TypePackagePreview } from '@open-artifact/protocol';
import { FileUp } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button, Dialog, TextInput } from '@open-artifact/ui';
import { t } from '../../lib/i18n.ts';
import { installPackage, previewPackage } from '../actions.ts';
import { useHome } from '../store.ts';

function Fact({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="grid grid-cols-[7rem_1fr] gap-2 text-xs">
      <span className="text-fg-muted">{label}</span>
      <span data-testid={testId} className="min-w-0 break-all">
        {children}
      </span>
    </div>
  );
}

/** What the package is, and its SKILL.md in full. */
function Preview({ preview }: { preview: TypePackagePreview }) {
  return (
    <div data-testid="type-preview" className="flex flex-col gap-1.5">
      <p className="m-0 text-sm font-semibold">
        {preview.name} {preview.version}
      </p>
      {preview.description ? <p className="m-0 text-xs text-fg-muted">{preview.description}</p> : null}
      <Fact label={t('packageId')}>{preview.id}</Fact>
      <Fact label={t('packageSource')} testId="type-preview-source">
        {preview.source}
      </Fact>
      <Fact label="sha256">
        <span className="font-mono">{preview.sha256}</span>
      </Fact>
      <Fact label={t('packageCapabilities')} testId="type-preview-capabilities">
        {preview.capabilities.length ? preview.capabilities.join(', ') : t('noCapabilities')}
      </Fact>
      <Fact label={t('packageNetwork')} testId="type-preview-network">
        {preview.network.length ? preview.network.join(', ') : t('noNetwork')}
      </Fact>
      {preview.replaces ? <Fact label={t('packageReplaces')}>{t('packageReplacesText', { version: preview.replaces.version, source: preview.replaces.source })}</Fact> : null}
      {preview.warnings.map((warning) => (
        <p key={warning} className="m-0 text-xs text-warning">
          {warning}
        </p>
      ))}
      <p className="mb-0 mt-2 text-xs text-fg-muted">
        {preview.skill ? t('packageSkill', { path: preview.skill.path, chars: preview.skill.chars, lines: preview.skill.lines }) : t('packageNoSkill')}
      </p>
      {preview.skill ? (
        <pre data-testid="type-preview-skill" className="m-0 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-2 p-2 font-mono text-xs">
          {preview.skill.text}
        </pre>
      ) : null}
      <p className="mb-0 mt-2 text-xs text-fg-subtle">{t('packageThirdParty')}</p>
    </div>
  );
}

/** The "Install type" dialog of the Types tab (and "Update" of an installed type). */
export function InstallTypeDialog() {
  const installing = useHome((state) => state.installing);
  const open = installing !== null;
  const update = installing?.update;
  const [url, setUrl] = useState('');
  const [as, setAs] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<TypePackagePreview | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    setUrl('');
    setAs('');
    setError('');
    setPreview(null);
    setBusy(false);
    if (update) {
      setBusy(true);
      void previewPackage({ update }).then((answer) => {
        setBusy(false);
        if ('error' in answer) setError(answer.error);
        else setPreview(answer.preview);
      });
    }
  }, [open, update]);
  const close = (): void => useHome.getState().setInstalling(null);
  const read = async (from: { file: File } | { url: string }): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError('');
    const answer = await previewPackage(from, as);
    setBusy(false);
    if ('error' in answer) setError(answer.error);
    else setPreview(answer.preview);
  };
  const submitUrl = (event: FormEvent): void => {
    event.preventDefault();
    void read({ url });
  };
  const install = async (): Promise<void> => {
    if (!preview || busy) return;
    setBusy(true);
    const answer = await installPackage(preview, update ? { update } : { as });
    setBusy(false);
    if ('error' in answer) setError(answer.error);
    else close();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => !next && close()}
      title={update ? t('updateTypeTitle', { id: update }) : t('installType')}
      description={preview ? t('installTypeCheck') : update ? undefined : t('installTypeDescription')}
      className="w-[min(40rem,calc(100vw-2rem))]"
    >
      {preview ? (
        <>
          <Preview preview={preview} />
          {error ? (
            <p role="alert" className="mb-0 mt-2 text-xs text-danger">
              {error}
            </p>
          ) : null}
          <div className="mt-4 flex justify-end gap-2">
            <Button size="lg" onClick={close}>
              {t('cancel')}
            </Button>
            <Button size="lg" variant="primary" data-testid="type-install-confirm" disabled={busy} onClick={() => void install()}>
              {update ? t('updateType') : t('installTypeAs', { id: preview.id })}
            </Button>
          </div>
        </>
      ) : update ? (
        <>
          <p className="m-0 text-xs text-fg-muted">{busy ? t('loading') : null}</p>
          {error ? (
            <p role="alert" className="mb-0 mt-2 text-xs text-danger">
              {error}
            </p>
          ) : null}
        </>
      ) : (
        <form onSubmit={submitUrl} data-testid="install-type-form">
          <div className="flex flex-col gap-3">
            <div>
              <Button size="md" icon={<FileUp className="size-3" />} disabled={busy} data-testid="install-type-file" onClick={() => input.current?.click()}>
                {t('chooseTypePackage')}
              </Button>
              <input
                ref={input}
                type="file"
                accept=".oatype,application/zip"
                hidden
                data-testid="install-type-file-input"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void read({ file });
                }}
              />
            </div>
            <div>
              <span className="mb-1 block text-xs text-fg-muted">{t('typePackageUrl')}</span>
              <div className="flex gap-2">
                <TextInput name="url" value={url} placeholder="https://…/my-type-1.0.0.oatype" spellCheck={false} aria-label={t('typePackageUrl')} onChange={(event) => setUrl(event.target.value)} className="h-8 flex-1" />
                <Button size="md" type="submit" disabled={busy || !url.trim()}>
                  {t('readPackage')}
                </Button>
              </div>
            </div>
            <div>
              <span className="mb-1 block text-xs text-fg-muted">{t('installAs')}</span>
              <TextInput name="as" value={as} maxLength={64} spellCheck={false} aria-label={t('installAs')} onChange={(event) => setAs(event.target.value.toLowerCase())} className="h-8" />
              <span className="mt-1 block text-xs text-fg-subtle">{t('installAsHint')}</span>
            </div>
          </div>
          {busy ? <p className="mb-0 mt-2 text-xs text-fg-muted">{t('loading')}</p> : null}
          {error ? (
            <p role="alert" className="mb-0 mt-2 text-xs text-danger">
              {error}
            </p>
          ) : null}
        </form>
      )}
    </Dialog>
  );
}
