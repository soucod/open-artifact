/** The notes for comments the server refused: why, what to do, and Copy draft. They stay until closed. */
import { Button, IconButton } from '@open-artifact/ui';
import { CircleAlert, X } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import { type RefusedDraft, copyRefused, dismissRefused, useRefused } from './refused.ts';

function DraftNote({ draft }: { draft: RefusedDraft }): ReactNode {
  const manualRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (draft.copy !== 'manual') return;
    manualRef.current?.focus();
    manualRef.current?.select();
  }, [draft.copy]);

  return (
    <div
      role="alert"
      data-testid="refused-draft"
      data-copy={draft.copy}
      className="pointer-events-auto flex w-full max-w-[420px] items-start gap-2.5 rounded-lg border border-chrome-line bg-chrome px-3 py-2.5 text-[13px] text-chrome-fg shadow-sm"
    >
      <CircleAlert className="mt-0.5 size-4 flex-none text-danger" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-medium">{draft.title}</p>
        <p className="text-chrome-muted">{draft.detail}</p>
        <p>{draft.advice}</p>
        {draft.copy === 'manual' ? (
          <>
            <p className="text-chrome-muted">Copying isn’t available here. Select the text and copy it yourself:</p>
            <textarea
              ref={manualRef}
              readOnly
              aria-label="Your draft"
              value={draft.text}
              rows={Math.min(6, draft.text.split('\n').length + 1)}
              className="w-full resize-y rounded-control border border-chrome-line bg-surface px-2 py-1 text-[13px] text-fg"
            />
          </>
        ) : (
          <p className="line-clamp-2 text-chrome-muted">“{draft.text}”</p>
        )}
        <div className="mt-1 flex items-center gap-2">
          <Button size="sm" onClick={() => void copyRefused(draft.id)}>
            Copy draft
          </Button>
          {draft.copy === 'copied' ? (
            <span role="status" className="text-chrome-muted">
              Copied the whole draft
            </span>
          ) : null}
        </div>
      </div>
      <IconButton size="sm" label="Close" icon={<X className="size-3.5" />} onClick={() => dismissRefused(draft.id)} />
    </div>
  );
}

export function RefusedDrafts(): ReactNode {
  const drafts = useRefused(state => state.drafts);
  if (!drafts.length) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 z-40 flex flex-col items-center gap-2 px-4">
      {drafts.map(draft => (
        <DraftNote key={draft.id} draft={draft} />
      ))}
    </div>
  );
}
