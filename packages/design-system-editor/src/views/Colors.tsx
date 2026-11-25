/**
 * Colors: every color token as a swatch per theme, grouped by name stem,
 * with aliases labelled, values and usage editable in place, and the
 * contrast of text/background pairs checked in every theme.
 */

import { AlertTriangle, Bot, Check, FolderPlus, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  CONTRAST,
  clearThemeOverride,
  addEntry,
  aliasTarget,
  familyEntries,
  freeTokenName,
  moveEntry,
  colorStem,
  colorGroups,
  cleanName,
  removeEntry,
  renameEntry,
  contrastGrade,
  contrastPairs,
  contrastRatio,
  setThemedValue,
  updateEntry,
  type RawTokens,
  type ThemedToken,
} from '@open-artifact/design-system-core';
import { Button, ColorPicker, CommitInput, ConfirmDialog, Dialog, TextInput, cn, toast, type ColorSwatch } from '@open-artifact/ui';
import { useModel } from '../state/model.ts';
import { anchorId, useView } from '../state/view.ts';
import { parseCssColor } from '../lib/color.ts';
import { CommentBadge } from '../components/Comments.tsx';
import { askToFixContrast, type ContrastIssue } from '../services/agent.ts';
import { editTokens } from '../services/edit.ts';
import { AddTokenButton, InlineText, PageHeader, TokenMenu, TokenNotes, useEditable, useFocusProps } from './common.tsx';
import { titleWhenCut } from '../lib/cut-title.ts';

/** A checkerboard behind swatches, so translucent colors read as such. */
const CHECKER = 'repeating-conic-gradient(#d9d9d9 0% 25%, #ffffff 0% 50%) 50% / 10px 10px';

/** For each foreground token, the background it is paired with (read from names). */
function usePairs(): Map<string, { background: string; large: boolean }> {
  const { tokens } = useModel();
  return useMemo(() => {
    const out = new Map<string, { background: string; large: boolean }>();
    for (const pair of contrastPairs(tokens.colors.map((color) => color.name))) if (!out.has(pair.foreground)) out.set(pair.foreground, { background: pair.background, large: pair.large });
    return out;
  }, [tokens.colors]);
}

/** Every color as a swatch of the picker; picking one writes an alias (`{name}`). */
function useSwatches(theme: string): ColorSwatch[] {
  const { tokens } = useModel();
  return useMemo(
    () => tokens.colors.filter((color) => color.resolved[theme]).map((color) => ({ name: color.name, value: color.resolved[theme]!, css: `{${color.name}}`, group: colorStem(color.name) })),
    [tokens.colors, theme],
  );
}

interface SwatchProps {
  token: ThemedToken;
  theme: string;
  first: string;
  editable: boolean;
  /** The resolved background this color is read against, when it is a foreground. */
  against: { color: string; name: string; large: boolean } | null;
}

function Swatch({ token, theme, first, editable, against }: SwatchProps) {
  const resolved = token.resolved[theme] ?? '';
  // A theme without its own value uses the first theme's.
  const own = token.declared[theme];
  const declared = own ?? token.declared[first] ?? '';
  const alias = aliasTarget(declared);
  const swatches = useSwatches(theme);
  const fg = parseCssColor(resolved);
  const bg = against ? parseCssColor(against.color) : null;
  const ratio = fg && bg ? contrastRatio(fg, bg) : null;
  const required = against?.large ? CONTRAST.large : CONTRAST.text;
  const box = (
    <button
      type="button"
      aria-label={`${token.name} in ${theme}: ${declared}`}
      title={resolved}
      disabled={!editable}
      className={cn('relative block h-10 w-full overflow-hidden rounded-md border border-line disabled:cursor-default', editable && 'cursor-pointer hover:ring-2 hover:ring-accent/40')}
      style={{ background: CHECKER }}
    >
      <span className="absolute inset-0" style={{ background: resolved }} />
    </button>
  );
  const write = (value: string, key?: string): void => {
    const text = value.trim();
    if (!text && theme !== first) editTokens((raw) => clearThemeOverride(raw, 'color', token.name, theme));
    if (text) editTokens((raw) => setThemedValue(raw, 'color', token.name, text, theme), key);
  };
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {editable ? (
        <ColorPicker
          aria-label={`${token.name} in ${theme}`}
          value={alias ? null : declared || null}
          fallback={resolved || null}
          trigger={box}
          swatches={swatches.filter((swatch) => swatch.name !== token.name)}
          contrastAgainst={against?.color ?? null}
          largeText={against?.large ?? false}
          onChange={(value) => write(value, `color:${token.name}:${theme}`)}
          onCommit={(value) => write(value, `color:${token.name}:${theme}`)}
        />
      ) : (
        box
      )}
      {editable ? (
        <CommitInput
          value={own ?? ''}
          placeholder={own === undefined ? declared : undefined}
          title={own === undefined ? `Same as ${first}` : undefined}
          aria-label={`${token.name} value in ${theme}`}
          onCommit={(value) => write(value)}
          className="h-6 font-mono text-[11px]"
        />
      ) : (
        <span className={cn('truncate font-mono text-[11px]', own === undefined ? 'text-fg-subtle' : 'text-fg-muted')}>{declared}</span>
      )}
      {alias ? <span className="truncate text-[11px] text-fg-subtle">alias of {`{${alias}}`}</span> : null}
      {against && ratio !== null ? (
        <span
          className={cn('flex items-center gap-1 truncate text-[11px] tabular-nums', ratio >= required ? 'text-fg-subtle' : 'text-danger')}
          title={`On ${against.name}: needs ${required}:1`}
        >
          {ratio >= required ? <Check className="size-3 shrink-0" /> : <AlertTriangle className="size-3 shrink-0" />}
          {ratio.toFixed(2)}:1 on {against.name}
        </span>
      ) : null}
    </div>
  );
}

function ColorRow({ token, themes, editable }: { token: ThemedToken; themes: { id: string; name: string }[]; editable: boolean }) {
  const focus = useFocusProps({ kind: 'token', family: 'color', name: token.name });
  const pairs = usePairs();
  const { tokens } = useModel();
  const pair = pairs.get(token.name);
  const background = pair ? tokens.colors.find((color) => color.name === pair.background) : undefined;
  return (
    <div
      id={anchorId('token', token.name)}
      {...focus}
      className="group grid items-start gap-3 rounded-lg px-2 py-2 hover:bg-hover/50 data-[focused]:bg-accent-soft"
      style={{ gridTemplateColumns: `minmax(160px, 1.2fr) repeat(${themes.length}, minmax(96px, 1fr)) 28px` }}
    >
      <div className="min-w-0 pt-0.5">
        <div className="flex items-center gap-1">
          <span onPointerEnter={(event) => titleWhenCut(event.currentTarget)} className="truncate font-mono text-[13px] text-fg">--{token.name}</span>
          <CommentBadge focus={{ kind: 'token', family: 'color', name: token.name }} />
        </div>
        <InlineText
          value={token.usage ?? ''}
          placeholder="Add usage…"
          readOnly={!editable}
          onCommit={(usage) => editTokens((raw) => updateEntry(raw, 'color', token.name, { usage: usage || undefined }))}
        />
      </div>
      {themes.map((theme) => {
        const bg = background?.resolved[theme.id];
        return (
          <Swatch
            key={theme.id}
            token={token}
            theme={theme.id}
            first={themes[0]!.id}
            editable={editable}
            against={pair && bg ? { color: bg, name: pair.background, large: pair.large } : null}
          />
        );
      })}
      <TokenMenu family="color" name={token.name} />
    </div>
  );
}

/** A clean color group stem from what the viewer typed. */
export function groupStem(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '-')
    .replace(/^[^a-z0-9]+|-+$/g, '')
    .slice(0, 48);
}

/** "Add color group": a new stem with its first color. */
function AddColorGroup() {
  const editable = useEditable();
  const { raw } = useModel();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  if (!editable) return null;
  const create = (): void => {
    const stem = groupStem(name);
    if (!stem) return;
    const first = freeTokenName(raw, 'color', `${stem}-base`);
    editTokens((current) => addEntry(current, 'color', { name: first, value: '#888888' }));
    useView.getState().setFocus({ kind: 'token', family: 'color', name: first });
    useView.getState().go('colors', anchorId('token', first));
    setOpen(false);
    setName('');
  };
  return (
    <>
      <Button icon={<FolderPlus className="size-3.5" />} onClick={() => setOpen(true)}>
        Add color group
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Add a color group"
        description="Colors are grouped by the first part of their name (brand-500, brand-600 are the brand group). The group starts with one color."
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={create} disabled={!groupStem(name)}>
              Add
            </Button>
          </>
        }
      >
        <TextInput autoFocus placeholder="Name, e.g. brand" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && create()} />
      </Dialog>
    </>
  );
}

/** "Add color" within a group: the next name of the stem, placed after the group's last color. */
function addToGroup(prefix: string, stem: string, list: readonly ThemedToken[], raw: RawTokens): void {
  const last = list[list.length - 1];
  let name: string;
  if (stem) {
    name = freeTokenName(raw, 'color', `${prefix}${stem}-${list.length + 1}`);
  } else {
    let n = 1;
    do {
      name = prefix + 'color' + (n === 1 ? '' : n);
      n++;
    } while (freeTokenName(raw, 'color', name) !== name);
  }
  const value = last ? (last.declared[Object.keys(last.declared)[0]!] ?? '#888888') : '#888888';
  editTokens((current) => {
    const next = addEntry(current, 'color', { name, value: aliasTarget(value) ? '#888888' : value });
    const entries = familyEntries(next, 'color');
    const index = last ? entries.findIndex((entry) => entry.name === last.name) + 1 : entries.length;
    return moveEntry(next, 'color', name, index);
  });
  useView.getState().setFocus({ kind: 'token', family: 'color', name });
  useView.getState().go('colors', anchorId('token', name));
}

/** Contrast pairs per theme. */
function useContrast(): { theme: { id: string; name: string }; rows: (ContrastIssue & { large: boolean; fg: string; bg: string })[] }[] {
  const { tokens } = useModel();
  return useMemo(() => {
    const pairs = contrastPairs(tokens.colors.map((color) => color.name));
    const byName = new Map(tokens.colors.map((color) => [color.name, color]));
    return tokens.themes.map((theme) => ({
      theme,
      rows: pairs.flatMap((pair) => {
        const fg = byName.get(pair.foreground)?.resolved[theme.id];
        const bg = byName.get(pair.background)?.resolved[theme.id];
        const a = fg ? parseCssColor(fg) : null;
        const b = bg ? parseCssColor(bg) : null;
        if (!a || !b || !fg || !bg) return [];
        const required = pair.large ? CONTRAST.large : CONTRAST.text;
        return [{ theme: theme.id, foreground: pair.foreground, background: pair.background, ratio: contrastRatio(a, b), required, large: pair.large, fg, bg }];
      }),
    }));
  }, [tokens]);
}

function ContrastTable() {
  const groups = useContrast();
  const failing = groups.flatMap((group) => group.rows.filter((row) => row.ratio < row.required));
  if (!groups.some((group) => group.rows.length)) return null;
  return (
    <section className="mt-10">
      <div className="mb-3 flex items-end gap-3">
        <div className="flex-1">
          <h2 className="text-[16px] font-semibold text-fg">Contrast</h2>
          <p className="text-[12px] text-fg-muted">
            Text pairs need {CONTRAST.text}:1; large text, icons and borders {CONTRAST.large}:1. Pairs are read from token names.
          </p>
        </div>
        {failing.length ? (
          <Button icon={<Bot className="size-3.5" />} onClick={() => void askToFixContrast(failing)}>
            Ask agent to fix {failing.length}
          </Button>
        ) : null}
      </div>
      <div className="flex flex-col gap-6">
        {groups.map(({ theme, rows }) =>
          rows.length ? (
            <div key={theme.id}>
              {groups.length > 1 ? <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-fg-subtle">{theme.name}</h3> : null}
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2">
                {rows.map((row) => {
                  const pass = row.ratio >= row.required;
                  return (
                    <div key={`${row.foreground}/${row.background}`} className={cn('flex items-center gap-3 rounded-lg border p-2', pass ? 'border-line' : 'border-danger/50 bg-danger/5')}>
                      <div className="flex size-11 shrink-0 items-center justify-center rounded-md border border-line text-[17px] font-semibold" style={{ background: row.bg, color: row.fg }}>
                        Aa
                      </div>
                      <div className="min-w-0 flex-1 text-[12px]">
                        <div className="truncate font-mono text-fg">{row.foreground}</div>
                        <div className="truncate font-mono text-fg-subtle">on {row.background}</div>
                      </div>
                      <div className="text-right text-[12px]">
                        <div className="font-semibold tabular-nums text-fg">{row.ratio.toFixed(2)}</div>
                        <div className={cn('flex items-center justify-end gap-0.5', pass ? 'text-success' : 'text-danger')}>
                          {pass ? <Check className="size-3" /> : <AlertTriangle className="size-3" />}
                          {row.large && pass ? 'large' : contrastGrade(row.ratio)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null,
        )}
      </div>
    </section>
  );
}

export function Colors() {
  const { tokens, raw } = useModel();
  const editable = useEditable();
  const { prefix, groups } = useMemo(() => colorGroups(tokens.colors), [tokens.colors]);
  const [removing, setRemoving] = useState<string | null>(null);
  const renameGroup = (stem: string, list: ThemedToken[], label: string) => {
    const next = groupStem(label);
    if (!next || next === stem || (!stem && label === 'Palette')) return;
    const changes = list.map(({ name }) => {
      const suffix = name.slice(prefix.length + stem.length);
      return [name, prefix + next + (stem ? '' : '-') + suffix] as const;
    });
    if (changes.some(([, name]) => !cleanName(name) || Object.keys(raw).some((key) => familyEntries(raw, key).some((entry) => cleanName(entry.name) === name)))) {
      toast.add({ title: 'Choose a group name that leaves each token name unique and valid.' });
      return;
    }
    editTokens((current) => changes.reduce((doc, [from, to]) => renameEntry(doc, 'color', from, to), current));
  };

  return (
    <div>
      <PageHeader
        title="Colors"
        description={tokens.colorNote ?? `${tokens.colors.length} tokens${tokens.themes.length > 1 ? ` in ${tokens.themes.length} themes` : ''}. Each is a CSS variable: var(--name).`}
        actions={
          <>
            <AddColorGroup />
            <AddTokenButton family="color" stem="color" entry={{ value: '#888888' }} />
          </>
        }
      />
      <TokenNotes filter={(message) => /colou?r|theme|alias/i.test(message)} />
      {tokens.colors.length ? (
        <>
          <div
            className="sticky top-0 z-10 grid gap-3 border-b border-line bg-canvas px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-fg-subtle"
            style={{ gridTemplateColumns: `minmax(160px, 1.2fr) repeat(${tokens.themes.length}, minmax(96px, 1fr)) 28px` }}
          >
            <span>Token</span>
            {tokens.themes.map((theme) => (
              <span key={theme.id}>{theme.name}</span>
            ))}
            <span />
          </div>
          {[...groups].map(([stem, list]) => (
            <section key={stem} className="group/stem mt-3">
              {groups.size > 1 || editable ? (
                <h2 className="flex items-center gap-2 px-2 pb-1 text-[12px] font-semibold text-fg-muted">
                  <span className="flex-1">{editable ? <CommitInput aria-label={`Rename ${stem || 'Palette'} group`} value={stem || 'Palette'}
                    onCommit={(label) => renameGroup(stem, list, label)} /> : stem || 'Palette'}</span>
                  {editable ? <button className="text-xs font-normal text-fg-muted" onClick={() => setRemoving(stem)}>Delete group</button> : null}
                  {editable ? (
                    <button
                      type="button"
                      className="flex items-center gap-1 rounded px-1 font-normal text-fg-subtle opacity-0 hover:bg-hover hover:text-fg focus-visible:opacity-100 group-hover/stem:opacity-100"
                      onClick={() => addToGroup(prefix, stem, list, raw)}
                    >
                      <Plus className="size-3" /> Add color
                    </button>
                  ) : null}
                </h2>
              ) : null}
              {list.map((token) => (
                <ColorRow key={token.name} token={token} themes={tokens.themes} editable={editable} />
              ))}
            </section>
          ))}
          <ConfirmDialog open={removing !== null} onOpenChange={(open) => { if (!open) setRemoving(null); }}
            title={`Delete ${removing || 'Palette'}?`} description="Remove this group’s color tokens from the system." confirmLabel="Delete" danger
            onConfirm={() => {
              const list = groups.get(removing ?? '') ?? [];
              editTokens((current) => list.reduce((doc, color) => removeEntry(doc, 'color', color.name), current));
              setRemoving(null);
            }} />
          <ContrastTable />
        </>
      ) : (
        <p className="text-[13px] text-fg-subtle">No colors yet.</p>
      )}
    </div>
  );
}
