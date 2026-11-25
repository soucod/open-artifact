/** The link box's fields: the text, and the address, where `#` or `/` lists the open tab's headings and the doc's tabs. */
import { Button, TextInput } from '@open-artifact/ui';
import { cn } from '@open-artifact/ui';
import type { EditorView } from 'prosemirror-view';
import { type ClipboardEvent, type KeyboardEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { orderedTabs, useDocs } from '../app/store.ts';
import { useEditor } from '../editor/format.ts';
import { type DocHeading, type DocTab, docHeadings, headingHref, matchTargets, tabHref } from './fragments.ts';
import { closeLink, commitLink, type LinkPop, unlink } from './links.ts';
import { suggestingNow } from '../suggest/mode.ts';
import { checkHref, hrefProblem, normalizeHref, stripInvisible } from './link-url.ts';
import { placeExists } from './navigate.ts';

type Target = { kind: 'heading'; heading: DocHeading } | { kind: 'tab'; tab: DocTab };

const LISTING = /^[/#]/;

/** The address in a paste: an `<a href>` of pasted HTML first, else the plain text. */
function pastedHref(data: DataTransfer): string | null {
  const html = data.getData('text/html');
  if (html && html.length <= 1_000_000 && typeof DOMParser !== 'undefined') {
    const anchor = new DOMParser().parseFromString(html, 'text/html').querySelector('a[href]');
    const href = anchor ? normalizeHref(anchor.getAttribute('href') ?? '') : null;
    if (href) return href;
  }
  const text = data.getData('text/plain');
  return text ? normalizeHref(text) : null;
}

function useTargets(view: EditorView): { headings: DocHeading[]; tabs: DocTab[] } {
  const files = useDocs(state => state.project?.files);
  const tab = useEditor(state => state.tab);
  const doc = useEditor(state => state.state?.doc ?? view.state.doc);
  return useMemo(
    () => ({
      headings: docHeadings(doc),
      tabs: orderedTabs(files ?? [])
        .filter(file => file.id !== tab)
        .map(file => ({ id: file.id, name: file.name || 'Untitled tab' })),
    }),
    [doc, files, tab],
  );
}

export function LinkForm({ view, pop }: { view: EditorView; pop: LinkPop }): ReactNode {
  const listId = useId();
  const textRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(pop.text);
  const [url, setUrl] = useState(stripInvisible(pop.href));
  const [invalid, setInvalid] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [keyed, setKeyed] = useState(-1);
  const [hovered, setHovered] = useState(-1);
  const all = useTargets(view);

  useEffect(() => {
    const field = pop.text || pop.textFixed ? urlRef.current : textRef.current;
    field?.focus();
    if (field === urlRef.current) urlRef.current?.select();
  }, [pop.text, pop.textFixed]);

  useEffect(() => {
    if (!pop.changed) return;
    setText(pop.text);
    if (pop.textFixed) return;
    textRef.current?.focus();
    textRef.current?.select();
  }, [pop.changed]);

  const typed = url.trim();
  const offersTargets = all.headings.length + all.tabs.length > 0;
  const listing = offersTargets && !dismissed && LISTING.test(typed) && typed !== stripInvisible(pop.href).trim();
  const matches = useMemo(() => (listing ? matchTargets(typed, all.headings, all.tabs) : { headings: [], tabs: [] }), [listing, typed, all]);
  const targets: Target[] = useMemo(
    () => [...matches.headings.map(heading => ({ kind: 'heading' as const, heading })), ...matches.tabs.map(tab => ({ kind: 'tab' as const, tab }))],
    [matches],
  );
  const exact = matches.headings.findIndex(heading => heading.slug === typed.slice(1).toLowerCase());
  const highlighted = hovered >= 0 && hovered < targets.length ? hovered : keyed >= 0 && keyed < targets.length ? keyed : exact >= 0 ? exact : targets.length ? 0 : -1;

  useEffect(() => {
    if (highlighted >= 0) document.getElementById(`${listId}-${highlighted}`)?.scrollIntoView({ block: 'nearest' });
  }, [highlighted, listId]);

  const pick = (target: Target) => {
    const href = target.kind === 'heading' ? headingHref(target.heading.bid, target.heading.text) : tabHref(target.tab.id);
    const name = target.kind === 'heading' ? target.heading.text : target.tab.name;
    commitLink(href, text.trim() ? text : name);
  };

  const save = () => {
    if (listing && highlighted >= 0) {
      pick(targets[highlighted]!);
      return;
    }
    if (!typed) {
      if (pop.href) unlink();
      else urlRef.current?.focus();
      return;
    }
    const suggesting = suggestingNow();
    const checked = checkHref(typed, suggesting);
    if (!('href' in checked) || (checked.href.startsWith('#') && !placeExists(checked.href, view))) {
      setInvalid('href' in checked ? hrefProblem({ problem: 'not_link' }, suggesting) : hrefProblem(checked, suggesting));
      urlRef.current?.focus();
      return;
    }
    commitLink(checked.href, text);
  };

  const onUrl = (next: string) => {
    setUrl(next);
    setInvalid(null);
    setDismissed(false);
    setKeyed(-1);
    setHovered(-1);
  };

  const onEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    save();
  };

  const onUrlKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (listing && targets.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      const at = highlighted;
      setKeyed(event.key === 'ArrowDown' ? (at + 1) % targets.length : at <= 0 ? targets.length - 1 : at - 1);
      setHovered(-1);
      return;
    }
    if (event.key === 'Escape' && listing) {
      event.preventDefault();
      setDismissed(true);
      return;
    }
    onEnter(event);
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const href = pastedHref(event.clipboardData);
    if (!href) return;
    event.preventDefault();
    onUrl(href);
    setDismissed(true);
  };

  const placeholder = offersTargets ? (all.tabs.length ? 'Paste a link, or type / for a heading or tab' : 'Paste a link, or type / for a heading') : 'Paste a link';
  const headingsLabel = all.tabs.length ? 'Headings in this tab' : 'Headings';
  const canSave = typed !== '' || pop.href !== '';

  return (
    <div className="flex flex-col gap-3 text-[13px]">
      <label className="flex flex-col gap-1">
        <span className="font-medium text-chrome-muted">Text</span>
        <TextInput
          ref={textRef}
          aria-label="Link text"
          value={pop.textFixed ? pop.text : text}
          readOnly={pop.textFixed}
          maxLength={400}
          autoComplete="off"
          onChange={event => setText(event.target.value)}
          onKeyDown={onEnter}
        />
        {pop.textFixed ? <span className="text-[12px] text-chrome-muted">Text that spans several paragraphs or holds chips can't be edited here.</span> : null}
        {pop.changed ? (
          <span role="alert" className="text-[12px] text-danger" data-testid="link-text-changed">
            {pop.text || pop.textFixed
              ? 'Someone else changed this text while you were editing. It now shows what the doc says: make your change again, then save.'
              : 'The linked text was removed while you were editing. Type the text again, then save.'}
          </span>
        ) : null}
      </label>
      <div className="relative flex flex-col gap-1">
        <label htmlFor={`${listId}-url`} className="font-medium text-chrome-muted">
          Link
        </label>
        <TextInput
          ref={urlRef}
          id={`${listId}-url`}
          aria-label="Link URL"
          value={url}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          role={offersTargets ? 'combobox' : undefined}
          aria-autocomplete={offersTargets ? 'list' : undefined}
          aria-expanded={offersTargets ? listing : undefined}
          aria-controls={listing ? `${listId}-list` : undefined}
          aria-activedescendant={listing && highlighted >= 0 ? `${listId}-${highlighted}` : undefined}
          aria-invalid={invalid ? true : undefined}
          className="placeholder-shown:text-ellipsis"
          onChange={event => onUrl(event.target.value)}
          onKeyDown={onUrlKey}
          onPaste={onPaste}
        />
        {invalid ? (
          <span role="alert" className="text-[12px] text-danger" data-testid="link-url-problem">
            {invalid}
          </span>
        ) : null}
        {listing && targets.length === 0 ? (
          <span role="status" className="text-[12px] text-chrome-muted">
            {all.tabs.length ? 'No heading or tab matches' : 'No heading matches'}
          </span>
        ) : null}
        {listing && targets.length > 0 ? (
          <div className="absolute inset-x-0 top-full z-10 mt-1 rounded-[12px] bg-chrome p-1 shadow-chrome-popup">
            <div id={`${listId}-list`} role="listbox" aria-label={all.tabs.length ? 'Headings and tabs' : 'Headings'} className="max-h-44 overflow-y-auto" onMouseLeave={() => setHovered(-1)}>
              {matches.headings.length ? (
                <TargetGroup label={headingsLabel}>
                  {matches.headings.map((heading, index) => (
                    <TargetRow key={`${heading.bid}`} id={`${listId}-${index}`} on={index === highlighted} onHover={() => setHovered(index)} onPick={() => pick({ kind: 'heading', heading })}>
                      <span className="truncate" style={{ marginLeft: (heading.level - 1) * 12 }}>
                        {heading.text}
                      </span>
                    </TargetRow>
                  ))}
                </TargetGroup>
              ) : null}
              {matches.tabs.length ? (
                <TargetGroup label="Tabs">
                  {matches.tabs.map((tab, offset) => {
                    const index = matches.headings.length + offset;
                    return (
                      <TargetRow key={tab.id} id={`${listId}-${index}`} on={index === highlighted} onHover={() => setHovered(index)} onPick={() => pick({ kind: 'tab', tab })}>
                        <span className="truncate">{tab.name}</span>
                      </TargetRow>
                    );
                  })}
                </TargetGroup>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
      <div className="flex justify-end gap-2">
        <Button onClick={() => closeLink({ refocus: true })}>Cancel</Button>
        <Button variant="primary" disabled={!canSave} onClick={save}>
          Save
        </Button>
      </div>
    </div>
  );
}

function TargetGroup({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div role="group" aria-label={label}>
      <div aria-hidden="true" className="px-2.5 py-1 text-[12px] font-medium text-chrome-muted">
        {label}
      </div>
      {children}
    </div>
  );
}

function TargetRow({ id, on, onHover, onPick, children }: { id: string; on: boolean; onHover(): void; onPick(): void; children: ReactNode }): ReactNode {
  return (
    <button
      type="button"
      id={id}
      tabIndex={-1}
      role="option"
      aria-selected={on}
      onMouseEnter={onHover}
      onMouseDown={event => event.preventDefault()}
      onClick={onPick}
      className={cn('flex h-7 w-full cursor-pointer items-center rounded-[8px] px-2.5 text-left text-[13px] text-chrome-fg outline-none', on && 'bg-chrome-hover')}
    >
      {children}
    </button>
  );
}
