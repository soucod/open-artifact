/**
 * Spacing, radius, shadow and the extra token families: one row per token
 * with a visual of its value, the value and usage editable in place.
 */

import { clearThemeOverride, familyEntries, setFamilyNote, setThemedValue, updateEntry, type PlainToken } from '@open-artifact/design-system-core';
import { CommitInput, Popover, ShadowEditor, type ColorSwatch } from '@open-artifact/ui';
import { useMemo, type ReactNode } from 'react';
import { useModel } from '../state/model.ts';
import { CommentBadge } from '../components/Comments.tsx';
import { anchorId } from '../state/view.ts';
import { editTokens } from '../services/edit.ts';
import { AddTokenButton, InlineText, PageHeader, TokenMenu, TokenNotes, useEditable, useFocusProps } from './common.tsx';
import { titleWhenCut } from '../lib/cut-title.ts';

/** How a family's values are pictured. */
type Visual = 'spacing' | 'radius' | 'shadow' | 'plain';

function Picture({ visual, value }: { visual: Visual; value: string }): ReactNode {
  switch (visual) {
    case 'spacing':
      return (
        <div className="flex h-8 items-center">
          <div className="h-4 max-w-full rounded-sm bg-accent/70" style={{ width: value }} />
        </div>
      );
    case 'radius':
      return <div className="size-12 border-2 border-accent/70 bg-accent-soft" style={{ borderRadius: value }} />;
    case 'shadow':
      return <div className="size-14 rounded-lg bg-white" style={{ boxShadow: value }} />;
    case 'plain':
      return null;
  }
}

/** The system's colors (first theme), offered by the shadow editor's color pickers. */
function useColorSwatches(): ColorSwatch[] {
  const { tokens } = useModel();
  const first = tokens.themes[0]?.id ?? '';
  return useMemo(() => tokens.colors.filter((color) => color.resolved[first]).map((color) => ({ name: color.name, value: color.resolved[first]! })), [tokens.colors, first]);
}

/** A shadow's picture that opens the structured editor. */
function ShadowPicture({ name, value, theme }: { name: string; value: string; theme: string }): ReactNode {
  const swatches = useColorSwatches();
  const write = (css: string): void => {
    if (css.trim()) editTokens((raw) => setThemedValue(raw, 'shadow', name, css.trim(), theme), `shadow:${name}:${theme}`);
  };
  return (
    <Popover
      side="right"
      align="start"
      className="w-80"
      trigger={
        <button type="button" aria-label={`Edit ${name}`} className="rounded-lg p-1 hover:ring-2 hover:ring-accent/40">
          <Picture visual="shadow" value={value} />
        </button>
      }
    >
      <ShadowEditor aria-label={`Layers of ${name}`} value={value} swatches={swatches} onChange={write} onCommit={write} />
    </Popover>
  );
}

interface Row extends PlainToken {
  /** Theme values of a shadow (shown when they differ). */
  themed?: Record<string, string>;
}

function TokenRow({ family, visual, token, editable }: { family: string; visual: Visual; token: Row; editable: boolean }) {
  const focus = useFocusProps({ kind: 'token', family, name: token.name });
  const themes = useModel().tokens.themes;
  const commitValue = (value: string): void => {
    const trimmed = value.trim();
    if (!trimmed) return;
    editTokens((raw) => updateEntry(raw, family, token.name, { value: /^-?\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : trimmed }));
  };
  return (
    <div
      id={anchorId('token', token.name)}
      {...focus}
      className="group grid items-center gap-4 rounded-lg px-2 py-2.5 hover:bg-hover/50 data-[focused]:bg-accent-soft"
      style={{ gridTemplateColumns: visual === 'plain' || visual === 'shadow' ? 'minmax(160px,1fr) 200px minmax(0,1.5fr) 28px' : '96px minmax(160px,1fr) 200px minmax(0,1.5fr) 28px' }}
    >
      {visual === 'plain' || visual === 'shadow' ? null : (
        <div className="flex items-center justify-center" onClick={(event) => event.stopPropagation()}>
          <Picture visual={visual} value={token.value} />
        </div>
      )}
      <div className="flex min-w-0 items-center gap-1">
        <span onPointerEnter={(event) => titleWhenCut(event.currentTarget)} className="truncate font-mono text-[13px] text-fg">--{token.name}</span>
        <CommentBadge focus={{ kind: 'token', family, name: token.name }} />
      </div>
      {visual === 'shadow' ? (
        <div className="grid gap-2">
          {themes.map(({ id, name }) => {
            const value = token.themed?.[id] ?? token.value;
            return <div key={id} className="flex items-center gap-2">
              {editable ? <ShadowPicture name={token.name} value={value} theme={id} /> : <Picture visual="shadow" value={value} />}
              <label className="min-w-0 flex-1 text-xs">{name}
                {editable ? <CommitInput value={value} aria-label={`${token.name} value in ${id}`}
                  onCommit={(css) => editTokens((raw) => css.trim() ? setThemedValue(raw, 'shadow', token.name, css.trim(), id) : clearThemeOverride(raw, 'shadow', token.name, id))} /> : <span>{value}</span>}
              </label>
            </div>;
          })}
        </div>
      ) : editable ? (
        <CommitInput value={token.value} aria-label={`${token.name} value`} onCommit={commitValue} className="font-mono text-[12px]" />
      ) : (
        <span className="truncate font-mono text-[12px] text-fg-muted">{token.value}</span>
      )}
      <InlineText
        value={token.usage ?? ''}
        placeholder="Add usage…"
        readOnly={!editable}
        onCommit={(usage) => editTokens((raw) => updateEntry(raw, family, token.name, { usage: usage || undefined }))}
      />
      <TokenMenu family={family} name={token.name} />
    </div>
  );
}

/** One token family's section. */
export function Scale({ family }: { family: string }) {
  const model = useModel();
  const editable = useEditable();
  const { tokens, raw } = model;
  const first = tokens.themes[0]?.id ?? '';
  let title: string;
  let visual: Visual;
  let rows: Row[];
  let stem: string;
  let sample: string;
  if (family === 'spacing' || family === 'radius') {
    title = family === 'spacing' ? 'Spacing' : 'Corner radius';
    visual = family;
    rows = family === 'spacing' ? tokens.spacing : tokens.radius;
    stem = family === 'spacing' ? 'space' : 'radius';
    sample = family === 'spacing' ? '8px' : '6px';
  } else if (family === 'shadow') {
    title = 'Shadows';
    visual = 'shadow';
    rows = tokens.shadows.map((shadow) => ({ name: shadow.name, value: shadow.declared[first] ?? '', ...(shadow.usage ? { usage: shadow.usage } : {}), themed: shadow.declared }));
    stem = 'shadow';
    sample = '0 1px 3px rgba(0, 0, 0, 0.12)';
  } else {
    const extra = tokens.extras.find((candidate) => candidate.key === family);
    title = extra?.title ?? family;
    visual = 'plain';
    rows = extra?.tokens ?? [];
    stem = family;
    sample = '1';
  }
  const rawNode = raw[family] as { note?: unknown } | undefined;
  const note = typeof rawNode?.note === 'string' ? rawNode.note : undefined;
  const count = familyEntries(raw, family).length;

  return (
    <div>
      <PageHeader
        title={title}
        description={`${rows.length} tokens${count > rows.length ? ` (${count - rows.length} not shown: see the notes)` : ''}.`}
        actions={<AddTokenButton family={family} stem={stem} entry={{ value: sample }} />}
      />
      <div className="mb-4 max-w-2xl">
        <InlineText value={note ?? ''} placeholder="Add a note about this family…" readOnly={!editable} multiline onCommit={(text) => editTokens((r) => setFamilyNote(r, family, text))} className="text-[13px]" />
      </div>
      <TokenNotes filter={(message) => message.toLowerCase().includes(family.toLowerCase())} />
      {rows.length ? (
        <div className="flex flex-col">
          {rows.map((token) => (
            <TokenRow key={token.name} family={family} visual={visual} token={token} editable={editable} />
          ))}
        </div>
      ) : (
        <p className="text-[13px] text-fg-subtle">No {title.toLowerCase()} tokens yet.</p>
      )}
    </div>
  );
}
