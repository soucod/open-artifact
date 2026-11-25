/**
 * The empty page: "Nothing here yet", or, while the agent builds the first
 * page for someone who can edit, its working line cycling through how long
 * it takes and what the page will offer. With an agent to ask, an editor
 * picks the format the first page takes and can import files to build it from.
 */

import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react';
import { FileUp, LoaderCircle } from 'lucide-react';
import { DASHBOARD_FORMS, IMPORT_FILE_ACCEPT } from '@open-artifact/data-core';
import { cn } from '@open-artifact/ui';
import { FormPicture } from '../drafts/FormPictures.tsx';
import { AGENT_WORKING_TEXT } from '../page/check.ts';
import { pickForm, useEmptyPage } from '../state/empty-page.ts';
import { importFiles } from './import-files.ts';
import { CHOOSE_FORMAT_TEXT, EMPTY_DASHBOARD_TEXT, IMPORTING_FILE_LABEL, IMPORT_FILE_HINT, IMPORT_FILE_LABEL } from './words.ts';
import { workingLineAt } from './working-line.ts';

function useCoarsePointer(): boolean {
  return useMemo(() => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches, []);
}

function WorkingLine(): ReactElement {
  const coarse = useCoarsePointer();
  const [start] = useState(() => Date.now());
  const [line, setLine] = useState(() => workingLineAt(0, coarse));
  useEffect(() => {
    const timer = setTimeout(() => setLine(workingLineAt(Date.now() - start, coarse)), line.forMs);
    return () => clearTimeout(timer);
  }, [line, start, coarse]);
  return (
    <p role="status" aria-live="polite" className="dash-working-line flex items-center gap-2 text-[14px] text-chrome-muted">
      <LoaderCircle className="size-4 animate-spin" aria-hidden />
      <span key={line.text ?? ''} className="dash-working-text">
        {line.text ?? AGENT_WORKING_TEXT}
      </span>
    </p>
  );
}

function FormChoice(): ReactElement {
  const form = useEmptyPage((state) => state.form);
  const name = useId();
  return (
    <fieldset className="flex w-full flex-col items-center gap-4">
      <legend className="mb-4 w-full text-center text-[14px] text-chrome-muted">{CHOOSE_FORMAT_TEXT}</legend>
      <div className="dash-forms grid w-full grid-cols-2 gap-3 sm:grid-cols-4">
        {DASHBOARD_FORMS.map(({ key, name: label }) => {
          const checked = key === form;
          return (
            <label key={key} className="group flex cursor-pointer flex-col items-center gap-2 text-[13px]" data-form={key}>
              <input type="radio" className="peer sr-only" name={name} value={key} checked={checked} onChange={() => pickForm(key)} />
              <span
                className={cn(
                  'w-full overflow-hidden rounded-xl border border-chrome-line bg-chrome-hover transition-colors',
                  'group-hover:border-chrome-accent/60 peer-focus-visible:ring-2 peer-focus-visible:ring-chrome-focus',
                  checked && 'border-chrome-accent ring-2 ring-chrome-accent/40',
                )}
              >
                <FormPicture form={key} className="aspect-[212/146] w-full" />
              </span>
              <span className={checked ? 'font-medium text-chrome-fg' : 'text-chrome-muted'}>{label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

function ImportButton(): ReactElement {
  const importing = useEmptyPage((state) => state.importing);
  const picker = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        disabled={importing}
        aria-busy={importing || undefined}
        onClick={() => picker.current?.click()}
        className={cn(
          'flex w-full max-w-sm items-center gap-3 rounded-xl border border-chrome-line bg-chrome px-4 py-3 text-left outline-none transition-colors',
          'hover:border-chrome-accent/60 focus-visible:ring-2 focus-visible:ring-chrome-focus disabled:opacity-60',
        )}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-chrome-hover text-chrome-muted" aria-hidden="true">
          {importing ? <LoaderCircle className="size-4 animate-spin" /> : <FileUp className="size-4" />}
        </span>
        <span className="flex flex-col">
          <span className="text-[14px] text-chrome-fg">{importing ? IMPORTING_FILE_LABEL : IMPORT_FILE_LABEL}</span>
          <span className="text-[13px] text-chrome-muted">{IMPORT_FILE_HINT}</span>
        </span>
      </button>
      <input
        ref={picker}
        type="file"
        hidden
        multiple
        accept={IMPORT_FILE_ACCEPT}
        onChange={(event) => {
          const files = [...(event.currentTarget.files ?? [])];
          event.currentTarget.value = '';
          void importFiles(files);
        }}
      />
    </>
  );
}

/**
 * The page with no files: the agent's working line while it builds one for an editor; with `offer`, the format
 * picker and the import; else "Nothing here yet".
 */
export function EmptyDashboard({ editable, working, offer }: { editable: boolean; working: boolean; offer: boolean }): ReactElement {
  const busy = editable && working;
  return (
    <div className="dash-empty" data-waits={editable ? '' : undefined} data-forms={offer && !busy ? '' : undefined} data-uncommentable="">
      {busy ? (
        <WorkingLine />
      ) : offer ? (
        <div className="flex w-full max-w-3xl flex-col items-center gap-8 px-4 py-8">
          <h2 className="text-[16px] font-semibold text-chrome-fg">{EMPTY_DASHBOARD_TEXT}</h2>
          <FormChoice />
          <ImportButton />
        </div>
      ) : (
        <p className="max-w-sm px-4 text-center text-[14px] text-chrome-muted">{EMPTY_DASHBOARD_TEXT}</p>
      )}
    </div>
  );
}
