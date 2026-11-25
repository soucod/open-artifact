/**
 * Rendering Markdown files, and editing them in place: the rendered text
 * saves as you type and can also be edited as source. Links open project files or web pages.
 */

import { Bold, Check, Code, Heading1, Heading2, Heading3, Italic, Link, List, ListChecks, ListOrdered, Pencil, Quote, Strikethrough } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FocusEvent, type ReactNode } from 'react';
import { Button, IconButton, cn } from '@open-artifact/ui';
import { markdownOf } from '../lib/markdown-dom.ts';
import { parseMarkdown, type Block, type Inline } from '../lib/markdown.ts';
import { resolveProjectLink } from '../lib/color.ts';
import { MOD, isApplePlatform } from '@open-artifact/editor-kit';
import { FORMAT_KEYS, applyBlock, applyInline, continueOnEnter, indentList, type BlockFormat, type InlineFormat, type TextEdit } from '../lib/markdown-edit.ts';
import { isWebLink } from '../lib/link-card.ts';
import { useComments } from '../services/comments.ts';
import { LinkCard, linkTarget } from './LinkCard.tsx';

const TOOLS: ({ kind: 'inline'; format: InlineFormat; label: string; icon: ReactNode; key?: string } | { kind: 'block'; format: BlockFormat; label: string; icon: ReactNode } | { kind: 'gap' })[] = [
  { kind: 'inline', format: 'bold', label: 'Bold', icon: <Bold className="size-3.5" />, key: 'B' },
  { kind: 'inline', format: 'italic', label: 'Italic', icon: <Italic className="size-3.5" />, key: 'I' },
  { kind: 'inline', format: 'strike', label: 'Strikethrough', icon: <Strikethrough className="size-3.5" /> },
  { kind: 'inline', format: 'code', label: 'Code', icon: <Code className="size-3.5" />, key: 'E' },
  { kind: 'inline', format: 'link', label: 'Link', icon: <Link className="size-3.5" />, key: 'K' },
  { kind: 'gap' },
  { kind: 'block', format: 'h1', label: 'Heading 1', icon: <Heading1 className="size-3.5" /> },
  { kind: 'block', format: 'h2', label: 'Heading 2', icon: <Heading2 className="size-3.5" /> },
  { kind: 'block', format: 'h3', label: 'Heading 3', icon: <Heading3 className="size-3.5" /> },
  { kind: 'gap' },
  { kind: 'block', format: 'bullet', label: 'Bulleted list', icon: <List className="size-3.5" /> },
  { kind: 'block', format: 'number', label: 'Numbered list', icon: <ListOrdered className="size-3.5" /> },
  { kind: 'block', format: 'task', label: 'Checklist', icon: <ListChecks className="size-3.5" /> },
  { kind: 'block', format: 'quote', label: 'Quote', icon: <Quote className="size-3.5" /> },
];

function InlineView({ runs, from }: { runs: readonly Inline[]; from: string }): ReactNode {
  return runs.map((run, index) => {
    switch (run.kind) {
      case 'text':
        return run.text;
      case 'strong':
        return (
          <strong key={index} className="font-semibold text-fg">
            <InlineView runs={run.children} from={from} />
          </strong>
        );
      case 'strike':
        return <del key={index}><InlineView runs={run.children} from={from} /></del>;
      case 'em':
        return (
          <em key={index}>
            <InlineView runs={run.children} from={from} />
          </em>
        );
      case 'code':
        return (
          <code key={index} className="rounded bg-surface-2 px-1 py-px font-mono text-[0.88em] text-fg">
            {run.text}
          </code>
        );
      case 'link': {
        const href = /^https?:\/\//i.test(run.href) ? run.href : resolveProjectLink(run.href, from);
        const label = <InlineView runs={run.children} from={from} />;
        return href ? <a key={index} data-target={run.href} href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline">{label}</a> : <span key={index}>{label}</span>;
      }
      case 'image': {
        const src = /^data:image\/(?:png|jpeg|gif|webp|avif);base64,/i.test(run.src) ? run.src : resolveProjectLink(run.src, from);
        return src ? (
          <img key={index} data-target={run.src} src={src} alt={run.alt} className="my-2 inline-block max-h-64 max-w-full rounded" />
        ) : (
          <span key={index} title={run.src} className="rounded border border-dashed border-line px-1 text-fg-subtle">
            {run.alt || 'image'}
          </span>
        );
      }
    }
  });
}

const HEADING = ['text-[26px] font-semibold tracking-tight', 'text-[20px] font-semibold', 'text-[16px] font-semibold', 'text-[14px] font-semibold', 'text-[13px] font-semibold', 'text-[12px] font-semibold uppercase tracking-wide'];

function BlockView({ block, from }: { block: Block; from: string }): ReactNode {
  switch (block.kind) {
    case 'heading': {
      const Tag = `h${Math.min(block.level + 1, 6)}` as 'h2';
      return (
        <Tag data-level={block.level} className={cn('mt-6 mb-2 text-fg first:mt-0', HEADING[block.level - 1])}>
          <InlineView runs={block.children} from={from} />
        </Tag>
      );
    }
    case 'paragraph':
      return (
        <p className="my-2 leading-relaxed">
          <InlineView runs={block.children} from={from} />
        </p>
      );
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag className={cn('my-2 flex flex-col gap-1 pl-5', block.ordered ? 'list-decimal' : 'list-disc')}>
          {block.items.map((item, index) => (
            <li key={index} className={cn("leading-relaxed", item.checked !== undefined && "list-none")}>
              {item.checked !== undefined && <input type="checkbox" checked={item.checked} disabled className="mr-1.5" />}
              <InlineView runs={item.children} from={from} />
              {item.sub ? <BlockView block={item.sub} from={from} /> : null}
            </li>
          ))}
        </Tag>
      );
    }
    case 'quote':
      return (
        <blockquote className="my-3 border-l-2 border-line-strong pl-3 text-fg-muted">
          {block.blocks.map((inner, index) => (
            <BlockView key={index} block={inner} from={from} />
          ))}
        </blockquote>
      );
    case 'code':
      return <pre data-lang={block.lang} className="my-3 overflow-x-auto rounded-lg bg-surface-2 p-3 font-mono text-[12px] leading-relaxed text-fg">{block.text}</pre>;
    case 'table':
      return (
        <div className="my-3 overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                {block.head.map((cell, index) => (
                  <th key={index} className="border-b border-line-strong px-2 py-1.5 text-left font-semibold text-fg" style={{ textAlign: block.align[index] ?? undefined }}>
                    <InlineView runs={cell} from={from} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, index) => (
                    <td key={index} className="border-b border-line px-2 py-1.5 align-top" style={{ textAlign: block.align[index] ?? undefined }}>
                      <InlineView runs={cell} from={from} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'rule':
      return <hr className="my-6 border-line" />;
  }
}

/** Renders Markdown read from the file at `from` (relative images resolve from there). */
export function MarkdownView({ source, from, className }: { source: string; from: string; className?: string }) {
  return (
    <div className={cn('text-[14px] text-fg-muted', className)}>
      {parseMarkdown(source).map((block, index) => (
        <BlockView key={index} block={block} from={from} />
      ))}
    </div>
  );
}

export interface EditableMarkdownProps {
  source: string;
  from: string;
  readOnly: boolean;
  onCommit(text: string): void;
  /** Shown when the source is empty. */
  placeholder?: string;
  className?: string;
}

/** Keep untouched blocks byte-for-byte when editing the rendered text. */
/**
 * A link change the card made, as the change that undoes it: put an address
 * back, put a removed link back around its text, or take a put-back link out.
 */
type LinkEdit =
  | { kind: 'address'; anchor: HTMLAnchorElement; target: string | null; href: string | null }
  | { kind: 'removed'; anchor: HTMLAnchorElement; contents: Node[] }
  | { kind: 'restored'; anchor: HTMLAnchorElement };

function RichMarkdown({ source, from, onCommit, placeholder }: EditableMarkdownProps) {
  const wrapper = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const [link, setLink] = useState<HTMLAnchorElement | null>(null);
  const commenting = useComments((s) => s.on);
  const [revision, setRevision] = useState(0);
  const base = useRef(source);
  const original = useRef(new Map<Node, { html: string; source: string }>());
  const leading = useRef('');
  const shown = focused ? base.current : source;
  const { content, starts } = useMemo(() => {
    const starts: number[] = [];
    const blocks = parseMarkdown(shown, starts);
    return { starts, content: blocks.map((block, i) => <div key={i}><BlockView block={block} from={from} /></div>) };
  }, [from, shown]);
  const save = () => {
    if (!box.current) return;
    const parts = Array.from(box.current.childNodes, (node) => {
      const before = original.current.get(node);
      if (node instanceof HTMLElement && before?.html === node.innerHTML) return before.source;
      const suffix = before?.source.match(/\s*$/)?.[0] ?? '\n\n';
      return markdownOf(node).trimEnd() + suffix;
    });
    onCommit(leading.current + parts.join(''));
  };

  // The link card follows the caret while the text is being edited.
  useEffect(() => {
    if (!focused) {
      setLink(null);
      return;
    }
    const follow = () => {
      if (wrapper.current?.querySelector('[data-link-card]')?.contains(document.activeElement)) return;
      const node = document.getSelection()?.anchorNode ?? null;
      const element = node instanceof Element ? node : node?.parentElement;
      const anchor = element?.closest('a');
      setLink(anchor && box.current?.contains(anchor) ? anchor : null);
    };
    follow();
    document.addEventListener('selectionchange', follow);
    return () => document.removeEventListener('selectionchange', follow);
  }, [focused]);

  /** Selects a whole link, or what it says, for an editing command. */
  const selectLink = (anchor: HTMLAnchorElement, contents: boolean): void => {
    box.current?.focus();
    const range = document.createRange();
    if (contents) range.selectNodeContents(anchor);
    else range.selectNode(anchor);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };
  const returnToLink = (anchor: HTMLAnchorElement): void => {
    if (!anchor.isConnected) return box.current?.focus();
    selectLink(anchor, true);
    document.getSelection()?.collapseToEnd();
  };
  /**
   * The last link change in the card, which ⌘Z / Ctrl+Z puts back, and the
   * change ⌘Z put back, which ⇧⌘Z / Ctrl+Shift+Z (Ctrl+Y) makes again; both
   * until the text is edited again. Each is the change that undoes the other.
   */
  const lastLinkEdit = useRef<LinkEdit | null>(null);
  const undoneLinkEdit = useRef<LinkEdit | null>(null);
  const [, setLinkRevision] = useState(0);
  const setAddress = (anchor: HTMLAnchorElement, target: string | null, href: string | null): void => {
    if (target === null) delete anchor.dataset.target;
    else anchor.dataset.target = target;
    if (href === null) anchor.removeAttribute('href');
    else anchor.setAttribute('href', href);
    setLinkRevision((current) => current + 1);
    save();
  };
  const addressOf = (anchor: HTMLAnchorElement): LinkEdit => ({ kind: 'address', anchor, target: anchor.dataset.target ?? null, href: anchor.getAttribute('href') });
  /** Takes the link out, keeping its text; returns the change that puts it back. */
  const dropLink = (anchor: HTMLAnchorElement): LinkEdit => {
    const contents = [...anchor.childNodes];
    anchor.replaceWith(...contents);
    const last = contents.at(-1);
    box.current?.focus();
    if (last) document.getSelection()?.setPosition(last, last.nodeType === Node.TEXT_NODE ? (last.textContent ?? '').length : last.childNodes.length);
    setLink(null);
    save();
    return { kind: 'removed', anchor, contents };
  };
  /** Makes a recorded change; returns the change that undoes it, or `null` when the text moved on and it no longer fits. */
  const applyLinkEdit = (edit: LinkEdit | null): LinkEdit | null => {
    if (edit?.kind === 'address') {
      if (!edit.anchor.isConnected) return null;
      const back = addressOf(edit.anchor);
      setAddress(edit.anchor, edit.target, edit.href);
      return back;
    }
    if (edit?.kind === 'restored') return edit.anchor.isConnected ? dropLink(edit.anchor) : null;
    const [first] = edit?.kind === 'removed' ? edit.contents : [];
    const parent = first?.parentNode;
    if (edit?.kind !== 'removed' || !first?.isConnected || !parent || edit.contents.some((node) => node.parentNode !== parent)) return null;
    parent.insertBefore(edit.anchor, first);
    edit.anchor.append(...edit.contents);
    save();
    returnToLink(edit.anchor);
    return { kind: 'restored', anchor: edit.anchor };
  };
  const recordLinkEdit = (back: LinkEdit): void => {
    lastLinkEdit.current = back;
    undoneLinkEdit.current = null;
  };
  const editLink = (anchor: HTMLAnchorElement, target: string): boolean => {
    const resolved = isWebLink(target) ? target : resolveProjectLink(target, from);
    if (!resolved) return false;
    // The address field's typing sits on the browser's undo stack after the text's own edits,
    // so the change is undone here rather than by the browser.
    recordLinkEdit(addressOf(anchor));
    setAddress(anchor, target, resolved);
    returnToLink(anchor);
    return true;
  };
  const undoLinkEdit = (): boolean => {
    if (!lastLinkEdit.current) return false;
    const back = applyLinkEdit(lastLinkEdit.current);
    lastLinkEdit.current = null;
    undoneLinkEdit.current = back;
    return back !== null;
  };
  const redoLinkEdit = (): boolean => {
    if (!undoneLinkEdit.current) return false;
    const back = applyLinkEdit(undoneLinkEdit.current);
    undoneLinkEdit.current = null;
    lastLinkEdit.current = back;
    return back !== null;
  };
  const removeLink = (anchor: HTMLAnchorElement): void => recordLinkEdit(dropLink(anchor));
  const endEditing = (event: FocusEvent<HTMLDivElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    if (!focused) return;
    setFocused(false);
    setRevision((current) => current + 1);
  };

  return <div ref={wrapper} onBlur={endEditing}>
    {focused && <div role="toolbar" aria-label="Format selection" className="mb-1 flex flex-wrap gap-1">
      {([['Bold', 'bold', Bold], ['Italic', 'italic', Italic], ['Strikethrough', 'strikeThrough', Strikethrough],
        ['Bulleted list', 'insertUnorderedList', List], ['Numbered list', 'insertOrderedList', ListOrdered]] as const).map(([label, command, Icon]) =>
        <IconButton size="sm" key={command} label={label} icon={<Icon className="size-3.5" />}
          onMouseDown={(event) => event.preventDefault()} onClick={() => document.execCommand(command)} />)}
    </div>}
    <div key={revision} ref={box} role="textbox" aria-label={from} aria-multiline contentEditable suppressContentEditableWarning
      data-placeholder={placeholder} className="min-h-6 text-[14px] text-fg-muted outline-none empty:before:text-fg-subtle empty:before:content-[attr(data-placeholder)]"
      onFocus={() => {
        if (focused || !box.current) return;
        base.current = source;
        const lines = source.split(/\r?\n/);
        const newline = source.includes('\r\n') ? '\r\n' : '\n';
        const slice = (start: number, end: number) => lines.slice(start, end).join(newline) + (end < lines.length ? newline : '');
        leading.current = slice(0, starts[0] ?? lines.length);
        original.current.clear();
        Array.from(box.current.children).forEach((node, i) => {
          original.current.set(node, { html: node.innerHTML, source: slice(starts[i]!, starts[i + 1] ?? lines.length) });
        });
        setFocused(true);
      }}
      onInput={() => {
        lastLinkEdit.current = null;
        undoneLinkEdit.current = null;
        save();
      }}
      onPaste={(event) => { event.preventDefault(); document.execCommand('insertText', false, event.clipboardData.getData('text/plain')); }}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') event.currentTarget.blur();
        const command = isApplePlatform() ? event.metaKey : event.ctrlKey;
        if (command && event.code === 'KeyZ' && !event.shiftKey && undoLinkEdit()) event.preventDefault();
        else if (command && ((event.code === 'KeyZ' && event.shiftKey) || (!isApplePlatform() && event.code === 'KeyY')) && redoLinkEdit()) event.preventDefault();
        if (event.key === 'Tab' && !event.shiftKey && link && !commenting) {
          const first = wrapper.current?.querySelector<HTMLElement>('[data-link-card] button');
          if (first) {
            event.preventDefault();
            first.focus();
          }
        }
      }}
      onClick={(event) => {
        if (!(event.metaKey || event.ctrlKey)) return;
        const anchor = event.target instanceof Element ? event.target.closest('a') : null;
        if (!anchor?.href) return;
        event.preventDefault();
        window.open(anchor.href, '_blank', 'noopener,noreferrer');
      }}>
      {content}
    </div>
    {link && focused && !commenting ? <LinkCard key={linkTarget(link) + link.getAttribute('href')} link={link} onEdit={(target) => editLink(link, target)} onRemove={() => removeLink(link)} onReturn={() => returnToLink(link)} /> : null}
  </div>;
}

/** A Markdown file that turns into its source for editing. */
export function EditableMarkdown({ source, from, readOnly, onCommit, placeholder = 'Nothing written yet.', className }: EditableMarkdownProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(source);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setDraft(source);
  }, [source, editing]);

  useEffect(() => {
    const element = area.current;
    if (!editing || !element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight + 2}px`;
  }, [draft, editing]);

  const start = (): void => {
    if (readOnly) return;
    setDraft(source);
    setEditing(true);
    requestAnimationFrame(() => area.current?.focus());
  };
  const commit = (): void => {
    setEditing(false);
    if (draft !== source) onCommit(draft);
  };
  /** Applies an edit to the textarea: new text, then the selection once React rendered it. */
  const apply = (edit: TextEdit | null): boolean => {
    const element = area.current;
    if (!edit || !element) return false;
    setDraft(edit.text);
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(edit.start, edit.end);
    });
    return true;
  };
  const selection = (): TextEdit => {
    const element = area.current!;
    return { text: element.value, start: element.selectionStart, end: element.selectionEnd };
  };

  if (editing) {
    return (
      <div className={cn('flex flex-col gap-2', className)}>
        <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5">
          {TOOLS.map((tool, index) =>
            tool.kind === 'gap' ? (
              <span key={index} className="mx-1 h-4 w-px bg-line" />
            ) : (
              <IconButton
                key={tool.format}
                size="sm"
                label={tool.label}
                shortcut={tool.kind === 'inline' && tool.key ? `${MOD}${tool.key}` : undefined}
                icon={tool.icon}
                // Keep the textarea focused (and its selection) while clicking.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => apply(tool.kind === 'inline' ? applyInline(selection(), tool.format) : applyBlock(selection(), tool.format))}
              />
            ),
          )}
        </div>
        <textarea
          ref={area}
          value={draft}
          spellCheck
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setDraft(source);
              setEditing(false);
            } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              commit();
            } else if ((event.metaKey || event.ctrlKey) && !event.altKey && FORMAT_KEYS[event.key.toLowerCase()]) {
              event.preventDefault();
              apply(applyInline(selection(), FORMAT_KEYS[event.key.toLowerCase()]!));
            } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              if (apply(continueOnEnter(selection()))) event.preventDefault();
            } else if (event.key === 'Tab') {
              if (apply(indentList(selection(), event.shiftKey))) event.preventDefault();
            }
          }}
          className="min-h-32 w-full resize-none rounded-lg border border-accent bg-surface p-3 font-mono text-[13px] leading-relaxed text-fg outline-none"
        />
        <div className="flex items-center justify-end gap-2 text-[11px] text-fg-subtle">
          <span>Markdown · {MOD}Enter to finish · Esc to cancel</span>
          <Button size="sm" variant="primary" icon={<Check className="size-3.5" />} onMouseDown={(event) => event.preventDefault()} onClick={commit}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('group relative', className)}>
      {!readOnly ? <RichMarkdown source={source} from={from} readOnly={false} onCommit={onCommit} placeholder={placeholder} /> : source.trim() ? <MarkdownView source={source} from={from} /> : <p className="text-[14px] italic text-fg-subtle">{placeholder}</p>}
      {readOnly ? null : (
        <div className="absolute -top-1 right-0 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <IconButton size="sm" label="Edit Markdown source" icon={<Pencil className="size-3.5" />} onClick={start} />
        </div>
      )}
    </div>
  );
}
