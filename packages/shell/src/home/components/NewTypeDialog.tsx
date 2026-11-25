/** "New type": an id, a name, a template and where it goes; then its folder and a prompt to give an agent. */

import type { AuthoringScope, TypesNewResponse, TypeTemplate } from '@open-artifact/protocol';
import { Copy } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Button, Dialog, Segmented, TextInput, toast } from '@open-artifact/ui';
import { copyText } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { makeType } from '../actions.ts';
import { useHome } from '../store.ts';

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="mt-3">
      <span className="mb-1 block text-xs text-fg-muted">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-fg-subtle">{hint}</span> : null}
    </div>
  );
}

/** A block of text to copy: the new type's folder, the prompt. */
function CopyBlock({ text, testId }: { text: string; testId: string }) {
  return (
    <div className="mt-1 flex items-start gap-2 rounded-lg bg-surface-2 p-2">
      <pre data-testid={testId} className="m-0 min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-xs">
        {text}
      </pre>
      <Button
        size="sm"
        icon={<Copy className="size-3" />}
        aria-label={t('copy')}
        onClick={() => {
          void copyText(text).then(() => toast.add({ title: t('copied') }));
        }}
      />
    </div>
  );
}

function Made({ made, onDone }: { made: TypesNewResponse; onDone: () => void }) {
  const warnings = made.check.warnings.length;
  return (
    <div data-testid="type-made">
      <p className="mb-0 mt-0 text-sm font-semibold">{t('typeMade', { id: made.id })}</p>
      <p className="mb-0 mt-3 text-xs text-fg-muted">{t('typeMadeAt')}</p>
      <CopyBlock text={made.dir} testId="type-made-dir" />
      <p className="mb-0 mt-3 text-xs text-fg-muted">{t('typeMadePrompt')}</p>
      <CopyBlock text={made.prompt} testId="type-made-prompt" />
      {warnings ? <p className="mb-0 mt-2 text-xs text-warning">{t('typeCheckWarnings', { count: warnings })}</p> : null}
      <div className="mt-4 flex justify-end">
        <Button size="lg" variant="primary" data-testid="type-made-done" onClick={onDone}>
          {t('done')}
        </Button>
      </div>
    </div>
  );
}

/** The "New type" dialog of the Types tab. */
export function NewTypeDialog() {
  const open = useHome((state) => state.makingType);
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [template, setTemplate] = useState<TypeTemplate>('page');
  const [scope, setScope] = useState<AuthoringScope>('user');
  const [project, setProject] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<TypesNewResponse | null>(null);
  useEffect(() => {
    if (!open) return;
    setId('');
    setName('');
    setTemplate('page');
    setScope('user');
    setProject('');
    setError('');
    setMade(null);
  }, [open]);
  const close = (): void => useHome.getState().setMakingType(false);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    const folder = project.trim();
    if (scope === 'project' && !folder.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(folder)) {
      setError(t('needProjectFolder'));
      return;
    }
    setBusy(true);
    const answer = await makeType({
      id,
      template,
      scope,
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(scope === 'project' ? { project: folder } : {}),
    });
    setBusy(false);
    if ('error' in answer) setError(answer.error);
    else setMade(answer.made);
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()} title={t('newType')} description={made ? undefined : t('newTypeDescription')}>
      {made ? (
        <Made made={made} onDone={close} />
      ) : (
        <form onSubmit={(event) => void submit(event)} data-testid="new-type-form">
          <Row label={t('typeId')} hint={t('typeIdHint')}>
            <TextInput
              autoFocus
              required
              name="id"
              value={id}
              maxLength={64}
              spellCheck={false}
              aria-label={t('typeId')}
              onChange={(event) => setId(event.target.value.toLowerCase())}
              className="h-8"
            />
          </Row>
          <Row label={t('typeName')}>
            <TextInput name="name" value={name} maxLength={80} aria-label={t('typeName')} onChange={(event) => setName(event.target.value)} className="h-8" />
          </Row>
          <Row label={t('typeTemplate')} hint={t(template === 'page' ? 'templatePageHint' : 'templateDataHint')}>
            <Segmented<TypeTemplate>
              aria-label={t('typeTemplate')}
              value={template}
              onChange={setTemplate}
              options={[
                { value: 'page', label: t('templatePage') },
                { value: 'data', label: t('templateData') },
              ]}
            />
          </Row>
          <Row label={t('typeScope')} hint={t(scope === 'user' ? 'scopeUserHint' : 'scopeProjectHint')}>
            <Segmented<AuthoringScope>
              aria-label={t('typeScope')}
              value={scope}
              onChange={setScope}
              options={[
                { value: 'user', label: t('scopeUser') },
                { value: 'project', label: t('scopeProject') },
              ]}
            />
          </Row>
          {scope === 'project' ? (
            <Row label={t('projectFolder')}>
              <TextInput
                name="project"
                value={project}
                placeholder={t('projectFolderHint')}
                aria-label={t('projectFolder')}
                onChange={(event) => setProject(event.target.value)}
                className="h-8"
              />
            </Row>
          ) : null}
          {error ? (
            <p role="alert" className="mb-0 mt-2 text-xs text-danger">
              {error}
            </p>
          ) : null}
          <div className="mt-4 flex justify-end gap-2">
            <Button size="lg" onClick={close}>
              {t('cancel')}
            </Button>
            <Button size="lg" type="submit" variant="primary" disabled={busy || !id.trim()}>
              {t('create')}
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
