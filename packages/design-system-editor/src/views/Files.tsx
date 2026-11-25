/**
 * Files: every file of the project as a tree, with a text editor for the
 * files people write, a read-only view of the generated ones, image
 * previews, and the checks of the whole system.
 */

import { AlertCircle, AlertTriangle, ChevronRight, Copy, Download, FileIcon, FileText, Folder, Info, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState, type MouseEvent } from 'react';
import { checkDesignSystem, type SystemDiagnostic } from '@open-artifact/design-system-core';
import { Button, ConfirmDialog, IconButton, MenuItem, MenuSeparator, cn } from '@open-artifact/ui';
import { copyText, downloadUrl } from '../services/downloads.ts';
import { useFiles } from '../state/files.ts';
import { useModel } from '../state/model.ts';
import { useView } from '../state/view.ts';
import { projectUrl } from '../lib/color.ts';
import { editText } from '../services/edit.ts';
import { deleteFiles, ensureLoaded, isGenerated, isTextPath } from '../services/sync.ts';
import { ContextMenu, PageHeader } from './common.tsx';
import { titleWhenCut } from '../lib/cut-title.ts';

/** What the tree's rows do: select (with ⌘/Ctrl or Shift, several) and open a context menu. */
interface TreeActions {
  marked: ReadonlySet<string>;
  onClickFile(path: string, event: MouseEvent): void;
  onMenu(event: MouseEvent, target: { kind: 'file' | 'dir'; path: string }): void;
}

/** A folder of the tree. */
interface Dir {
  name: string;
  path: string;
  dirs: Dir[];
  files: string[];
}

/** Builds the tree from flat paths. */
function buildTree(paths: readonly string[]): Dir {
  const root: Dir = { name: '', path: '', dirs: [], files: [] };
  for (const path of [...paths].sort()) {
    const parts = path.split('/');
    let dir = root;
    for (const part of parts.slice(0, -1)) {
      const sub = `${dir.path}${part}/`;
      let next = dir.dirs.find((d) => d.path === sub);
      if (!next) {
        next = { name: part, path: sub, dirs: [], files: [] };
        dir.dirs.push(next);
      }
      dir = next;
    }
    dir.files.push(path);
  }
  return root;
}

function TreeDir({ dir, depth, selected, problems, actions }: { dir: Dir; depth: number; selected: string | null; problems: ReadonlyMap<string, SystemDiagnostic['level']>; actions: TreeActions }) {
  // Folders start open near the top, and around the selected file.
  const [open, setOpen] = useState(depth < 1 || (selected?.startsWith(dir.path) ?? false));
  useEffect(() => {
    if (selected?.startsWith(dir.path)) setOpen(true);
  }, [selected, dir.path]);
  return (
    <div>
      {dir.name ? (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          onContextMenu={(event) => actions.onMenu(event, { kind: 'dir', path: dir.path })}
          className="flex h-6 w-full items-center gap-1 rounded px-1 text-left text-[12px] text-fg-muted hover:bg-hover"
          style={{ paddingLeft: depth * 12 - 8 }}
        >
          <ChevronRight className={cn('size-3 shrink-0 transition-transform', open && 'rotate-90')} />
          <Folder className="size-3.5 shrink-0" />
          <span className="truncate">{dir.name}</span>
        </button>
      ) : null}
      {open || !dir.name ? (
        <>
          {dir.dirs.map((sub) => (
            <TreeDir key={sub.path} dir={sub} depth={depth + 1} selected={selected} problems={problems} actions={actions} />
          ))}
          {dir.files.map((path) => {
            const level = problems.get(path);
            return (
              <button
                key={path}
                type="button"
                onClick={(event) => actions.onClickFile(path, event)}
                onContextMenu={(event) => actions.onMenu(event, { kind: 'file', path })}
                aria-pressed={actions.marked.has(path) || undefined}
                className={cn(
                  'flex h-6 w-full items-center gap-1.5 rounded px-1 text-left text-[12px] hover:bg-hover',
                  actions.marked.has(path) ? 'bg-accent/15 text-fg ring-1 ring-inset ring-accent/40' : selected === path ? 'bg-accent-soft text-fg' : 'text-fg-muted',
                )}
                style={{ paddingLeft: depth * 12 + 6 }}
              >
                {isTextPath(path) ? <FileText className="size-3.5 shrink-0" /> : <FileIcon className="size-3.5 shrink-0" />}
                <span onPointerEnter={(event) => titleWhenCut(event.currentTarget)} className={cn('min-w-0 flex-1 truncate', isGenerated(path) && 'italic')}>{path.slice(dir.path.length)}</span>
                {level ? <span className={cn('size-1.5 shrink-0 rounded-full', level === 'error' ? 'bg-danger' : 'bg-warning')} /> : null}
              </button>
            );
          })}
        </>
      ) : null}
    </div>
  );
}

/** The editor of one text file. Commits on blur or ⌘S. */
function TextEditor({ path, text, readOnly }: { path: string; text: string; readOnly: boolean }) {
  const [draft, setDraft] = useState(text);
  useEffect(() => setDraft(text), [text]);
  const commit = (): void => {
    if (draft !== text) editText(path, draft);
  };
  return (
    <textarea
      value={draft}
      readOnly={readOnly}
      spellCheck={false}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 's') commit();
      }}
      aria-label={path}
      className="h-[calc(100vh-220px)] min-h-80 w-full resize-none rounded-lg border border-line bg-surface p-3 font-mono text-[12px] leading-5 text-fg outline-none focus:border-accent"
    />
  );
}

function FileView({ path }: { path: string }) {
  const text = useFiles((s) => s.texts[path]);
  const stored = useFiles((s) => s.listing[path]);
  const upload = useModel().uploads.get(path);
  const entry = stored ?? upload;
  const reading = useFiles((s) => s.reading[path] ?? false);
  const editable = !useFiles((s) => s.readOnly);
  const textual = !upload && isTextPath(path);
  useEffect(() => {
    if (textual && text === undefined) void ensureLoaded(path);
  }, [path, text, textual]);

  if (!entry && text === undefined) return <p className="text-[13px] text-fg-subtle">{path} no longer exists.</p>;
  const generated = isGenerated(path);
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate font-mono text-[13px] text-fg">{path}</h2>
        {entry ? <span className="text-[11px] text-fg-subtle">{entry.size.toLocaleString()} bytes</span> : <span className="text-[11px] text-warning">not saved yet</span>}
        <Button size="sm" variant="ghost" onClick={() => window.open(projectUrl(path), '_blank', 'noopener')}>
          Open raw
        </Button>
        {entry ? <IconButton size="sm" label="Download" icon={<Download className="size-3.5" />} onClick={() => void downloadUrl(projectUrl(path), path.split('/').pop()!)} /> : null}
        <IconButton size="sm" label="Copy path" icon={<Copy className="size-3.5" />} onClick={() => void copyText(path, 'the path')} />
      </div>
      {generated ? <p className="mb-2 text-[12px] text-fg-muted">Generated by this page on every save from tokens.json, the index and the components. Edit those instead.</p> : null}
      {path === 'README.md' ? <p className="mb-2 text-[12px] text-fg-muted">The usage block at the end is written by the page on save and is not shown here.</p> : null}
      {textual ? (
        typeof text === 'string' ? (
          <TextEditor path={path} text={text} readOnly={!editable || generated} />
        ) : (
          <p className="text-[13px] text-fg-subtle">{reading ? 'Reading…' : 'Not loaded.'}</p>
        )
      ) : /\.(mp4|webm|ogv|mov)$/i.test(path) ? (
        <video src={projectUrl(path)} controls preload="metadata" className="max-h-[60vh] max-w-full" />
      ) : /\.(png|jpe?g|gif|webp|avif|ico|bmp|svg)$/i.test(path) ? (
        <img src={projectUrl(path)} alt={path} className="max-h-[60vh] max-w-full rounded-lg border border-line" />
      ) : (
        <p className="text-[13px] text-fg-subtle">A binary file. Use Open raw to download it.</p>
      )}
    </div>
  );
}

function Diagnostics({ list }: { list: SystemDiagnostic[] }) {
  if (!list.length) return <p className="text-[12px] text-success">No problems found.</p>;
  return (
    <ul className="flex flex-col gap-1">
      {list.map((item, index) => (
        <li key={index} className="flex items-start gap-2 text-[12px]">
          {item.level === 'error' ? (
            <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-danger" />
          ) : item.level === 'warning' ? (
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
          ) : (
            <Info className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />
          )}
          <button type="button" className="shrink-0 font-mono text-fg hover:underline" onClick={() => useView.getState().openFile(item.file)}>
            {item.file}
          </button>
          <span className="text-fg-muted">{item.message}</span>
        </li>
      ))}
    </ul>
  );
}

export function Files() {
  const listing = useFiles((s) => s.listing);
  const texts = useFiles((s) => s.texts);
  const { files, uploads } = useModel();
  const selected = useView((s) => s.file);
  const paths = useMemo(() => {
    const all = new Set([...Object.keys(listing), ...uploads.keys()]);
    for (const [path, text] of Object.entries(texts)) {
      if (text === null) all.delete(path);
      else all.add(path);
    }
    return [...all];
  }, [listing, texts, uploads]);
  const tree = useMemo(() => buildTree(paths), [paths]);
  const sorted = useMemo(() => [...paths].sort(), [paths]);
  const editable = !useFiles((s) => s.readOnly);
  const [marked, setMarked] = useState<ReadonlySet<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; kind: 'file' | 'dir'; path: string } | null>(null);
  const [doomed, setDoomed] = useState<string[] | null>(null);
  // Marks of files that went away drop out.
  useEffect(() => {
    setMarked((current) => {
      const next = new Set([...current].filter((path) => paths.includes(path)));
      return next.size === current.size ? current : next;
    });
  }, [paths]);
  const deletable = (list: readonly string[]): string[] => list.filter((path) => path !== 'design-system.json' && !uploads.has(path) && !isGenerated(path));
  const actions: TreeActions = {
    marked,
    onClickFile(path, event) {
      if (event.metaKey || event.ctrlKey) {
        const next = new Set(marked);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        // The open file joins the selection on the first ⌘-click.
        if (!marked.size && selected && selected !== path) next.add(selected);
        setMarked(next);
        setAnchor(path);
        return;
      }
      if (event.shiftKey && (anchor ?? selected)) {
        const from = sorted.indexOf((anchor ?? selected)!);
        const to = sorted.indexOf(path);
        if (from !== -1 && to !== -1) {
          setMarked(new Set(sorted.slice(Math.min(from, to), Math.max(from, to) + 1)));
          return;
        }
      }
      setMarked(new Set());
      setAnchor(path);
      useView.getState().openFile(path);
    },
    onMenu(event, target) {
      event.preventDefault();
      setMenu({ at: { x: event.clientX, y: event.clientY }, ...target });
    },
  };
  /** The paths a menu acts on: the marked ones when the row is marked, else the row (a folder: everything in it). */
  const targetsOf = (target: { kind: 'file' | 'dir'; path: string }): string[] =>
    target.kind === 'dir' ? sorted.filter((path) => path.startsWith(target.path)) : marked.has(target.path) ? [...marked] : [target.path];
  const downloadAll = async (list: readonly string[]): Promise<void> => {
    for (const path of list) await downloadUrl(projectUrl(path), path.split('/').pop()!);
  };
  const diagnostics = useMemo(() => checkDesignSystem(files), [files]);
  const problems = useMemo(() => {
    const out = new Map<string, SystemDiagnostic['level']>();
    for (const item of diagnostics) if (item.level !== 'info' && out.get(item.file) !== 'error') out.set(item.file, item.level);
    return out;
  }, [diagnostics]);

  return (
    <div>
      <PageHeader
        title="Files"
        description={`${paths.length} files. Italic ones are generated by this page. ⌘-click or Shift-click to select several; right-click for more.`}
        actions={
          marked.size ? (
            <>
              <span className="text-[12px] text-fg-muted">{marked.size} selected</span>
              <Button size="sm" icon={<Download className="size-3.5" />} onClick={() => void downloadAll([...marked].filter((path) => path in listing || uploads.has(path)))}>
                Download
              </Button>
              {editable && deletable([...marked]).length ? (
                <Button size="sm" icon={<Trash2 className="size-3.5" />} onClick={() => setDoomed(deletable([...marked]))}>
                  Delete
                </Button>
              ) : null}
              <IconButton size="sm" label="Clear selection" icon={<X className="size-3.5" />} onClick={() => setMarked(new Set())} />
            </>
          ) : null
        }
      />
      <div className="grid grid-cols-[240px_minmax(0,1fr)] gap-6">
        <nav aria-label="Project files" className="max-h-[calc(100vh-200px)] overflow-y-auto rounded-lg border border-line p-1.5">
          <button
            type="button"
            onClick={() => useView.getState().openFile(null)}
            className={cn('mb-1 flex h-6 w-full items-center gap-1.5 rounded px-1.5 text-left text-[12px] hover:bg-hover', selected === null ? 'bg-accent-soft text-fg' : 'text-fg-muted')}
          >
            <AlertTriangle className="size-3.5 shrink-0" />
            <span className="flex-1">Checks</span>
            {problems.size ? <span className="text-[11px] text-fg-subtle">{problems.size}</span> : null}
          </button>
          <TreeDir dir={tree} depth={0} selected={selected} problems={problems} actions={actions} />
        </nav>
        <ContextMenu at={menu?.at ?? null} onClose={() => setMenu(null)}>
          {menu ? (
            <>
              {menu.kind === 'file' && !marked.has(menu.path) ? (
                <MenuItem icon={<FileText className="size-3.5" />} onSelect={() => useView.getState().openFile(menu.path)}>
                  Open
                </MenuItem>
              ) : null}
              <MenuItem icon={<Download className="size-3.5" />} onSelect={() => void downloadAll(targetsOf(menu).filter((path) => path in listing || uploads.has(path)))}>
                {menu.kind === 'dir' ? 'Download files in folder' : targetsOf(menu).length > 1 ? `Download ${targetsOf(menu).length} files` : 'Download'}
              </MenuItem>
              <MenuItem icon={<Copy className="size-3.5" />} onSelect={() => void copyText(menu.kind === 'dir' ? menu.path : targetsOf(menu).join('\n'), menu.kind === 'dir' ? 'the folder path' : 'the path')}>
                Copy path
              </MenuItem>
              {editable && deletable(targetsOf(menu)).length ? (
                <>
                  <MenuSeparator />
                  <MenuItem icon={<Trash2 className="size-3.5" />} danger onSelect={() => setDoomed(deletable(targetsOf(menu)))}>
                    {menu.kind === 'dir' ? 'Delete folder' : targetsOf(menu).length > 1 ? `Delete ${deletable(targetsOf(menu)).length} files` : 'Delete'}
                  </MenuItem>
                </>
              ) : null}
            </>
          ) : null}
        </ContextMenu>
        <ConfirmDialog
          open={doomed !== null}
          onOpenChange={(open) => !open && setDoomed(null)}
          title={doomed && doomed.length > 1 ? `Delete ${doomed.length} files?` : `Delete ${doomed?.[0] ?? ''}?`}
          description={`${doomed && doomed.length > 1 ? `${doomed.slice(0, 6).join(', ')}${doomed.length > 6 ? '…' : ''}. ` : ''}The version history keeps them: restore an earlier version to bring them back. Generated files and design-system.json are never deleted here.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            const list = doomed ?? [];
            setDoomed(null);
            void deleteFiles(list).then((gone) => {
              setMarked(new Set());
              if (selected && gone.includes(selected)) useView.getState().openFile(null);
            });
          }}
        />
        <div className="min-w-0">
          {selected ? (
            <FileView key={selected} path={selected} />
          ) : (
            <section>
              <h2 className="mb-2 text-[14px] font-semibold text-fg">Checks</h2>
              <Diagnostics list={diagnostics} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
