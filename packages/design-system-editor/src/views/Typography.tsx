/**
 * Typography: each text style rendered with its own font, size and
 * spacing, with its values, sample and usage editable in place; then the
 * font families and font files. Type sets and styles can be added, fonts
 * picked (the system's own, installed, or Google Fonts) and font files
 * uploaded to `fonts/`.
 */

import { FolderPlus, Plus, Trash2, Upload } from 'lucide-react';
import { useMemo, useRef, useState, type CSSProperties } from 'react';
import { compileTokensCss, updateStyle, type NormalizedStyle, type NormalizedTokens, type RawTokens } from '@open-artifact/design-system-core';
import { Button, CommitInput, Dialog, FontPicker, IconButton, TextInput, type DesignSystemFont, type FontPick } from '@open-artifact/ui';
import { useModel } from '../state/model.ts';
import { anchorId, useView } from '../state/view.ts';
import { projectUrl } from '../lib/color.ts';
import { addTypeGroup, addTypeStyle, addFontFiles, ensureFamily, guessFontFace, firstFamily, removeFontFile, removeTypeGroup, removeTypeStyle, setFamilyStack, updateTypeGroup } from '../lib/type-edit.ts';
import { editTokens, uploadFonts } from '../services/edit.ts';
import { linkStylesheet } from '../services/fonts.ts';
import { CommentBadge } from '../components/Comments.tsx';
import { InlineText, PageHeader, TokenNotes, useEditable, useFocusProps } from './common.tsx';

/** The `@font-face` rules of the system, with URLs into the project, for this page's samples. */
function FontFaces({ tokens }: { tokens: NormalizedTokens }) {
  const css = useMemo(
    () =>
      compileTokensCss(tokens, { fontUrl: (file) => projectUrl(file) })
        .split('\n')
        .filter((line) => line.startsWith('@font-face'))
        .join('\n'),
    [tokens],
  );
  return css ? <style>{css}</style> : null;
}

/** Inline style of a sample (variables resolved: this page does not load the system's variables). */
function sampleStyle(style: NormalizedStyle, families: Record<string, string>): CSSProperties {
  const family = style.familyKey ? families[style.familyKey] : style.family;
  return {
    fontFamily: family ?? undefined,
    fontSize: style.fontSize,
    lineHeight: style.lineHeight ?? '1.4',
    fontWeight: (style.fontWeight ?? '400') as CSSProperties['fontWeight'],
    letterSpacing: style.letterSpacing ?? '0',
    fontStyle: style.fontStyle,
    textTransform: style.textTransform as CSSProperties['textTransform'],
    fontVariationSettings: style.opticalSize !== undefined ? `'opsz' ${style.opticalSize}` : undefined,
  };
}

/** The system's families for the font picker: its stacks and its font files. */
function useSystemFonts(): DesignSystemFont[] {
  const { tokens } = useModel();
  return useMemo(() => {
    const out = new Map<string, DesignSystemFont>();
    for (const [key, stack] of Object.entries(tokens.families)) {
      const family = firstFamily(stack);
      if (family && !out.has(family.toLowerCase())) out.set(family.toLowerCase(), { family, label: `--font-${key}` });
    }
    for (const font of tokens.fonts) if (!out.has(font.family.toLowerCase())) out.set(font.family.toLowerCase(), { family: font.family, label: 'uploaded' });
    return [...out.values()];
  }, [tokens.families, tokens.fonts]);
}

/** Applies a pick: its stylesheet loads here, its family gets a `families` key, and `apply` sets that key. */
function pickFamily(pick: FontPick, apply: (raw: RawTokens, key: string) => RawTokens): void {
  if (pick.stylesheet && pick.source === 'google') linkStylesheet(pick.stylesheet);
  editTokens((raw) => {
    const { raw: next, key } = ensureFamily(raw, pick.family, pick.css);
    return apply(next, key);
  });
}

/** A field of a style. */
function StyleField({ label, value, editable, onCommit }: { label: string; value: string; editable: boolean; onCommit(value: string): void }) {
  return (
    <label className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-fg-subtle">{label}</span>
      {editable ? <CommitInput value={value} onCommit={onCommit} className="h-6 font-mono text-[11px]" /> : <span className="h-6 truncate font-mono text-[11px] leading-6 text-fg-muted">{value || '—'}</span>}
    </label>
  );
}

function StyleRow({ style, families, editable }: { style: NormalizedStyle; families: Record<string, string>; editable: boolean }) {
  const focus = useFocusProps({ kind: 'style', name: style.name });
  const systemFonts = useSystemFonts();
  const set = (field: string) => (value: string) => {
    const trimmed = value.trim();
    // Numbers stay numbers (`16`, `1.4`, `600`), as agents write them.
    const parsed = /^-?\d+(\.\d+)?$/.test(trimmed) ? Number(trimmed) : trimmed;
    editTokens((raw) => updateStyle(raw, style.name, { [field]: trimmed ? parsed : undefined }));
  };
  const stack = style.familyKey ? families[style.familyKey] : style.family;
  return (
    <div id={anchorId('style', style.name)} {...focus} className="group grid grid-cols-[minmax(0,1fr)_260px] gap-6 rounded-lg px-2 py-4 hover:bg-hover/50 data-[focused]:bg-accent-soft">
      <div className="min-w-0">
        <div className="mb-1 flex items-baseline gap-2">
          <span className="font-mono text-[12px] text-fg">.{style.name}</span>
          <span className="text-[11px] text-fg-subtle">
            {style.fontSize}
            {style.lineHeight ? ` / ${style.lineHeight}` : ''}
            {style.fontWeight ? ` · ${style.fontWeight}` : ''}
          </span>
          <CommentBadge focus={{ kind: 'style', name: style.name }} className="self-center" />
          {editable ? (
            <IconButton
              size="sm"
              label={`Remove ${style.name}`}
              icon={<Trash2 className="size-3.5" />}
              className="ml-auto self-center opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
              onClick={(event) => {
                event.stopPropagation();
                editTokens((raw) => removeTypeStyle(raw, style.name));
              }}
            />
          ) : null}
        </div>
        <div className="overflow-hidden text-ellipsis break-words text-fg" style={sampleStyle(style, families)}>
          {editable ? (
            <InlineText
              value={style.sample ?? ''}
              placeholder="The quick brown fox jumps over the lazy dog"
              readOnly={false}
              onCommit={(sample) => editTokens((raw) => updateStyle(raw, style.name, { sample: sample || undefined }))}
              className="!text-[length:inherit] !leading-[inherit] !not-italic !text-fg"
            />
          ) : (
            style.sample || 'The quick brown fox jumps over the lazy dog'
          )}
        </div>
        <div className="mt-2 max-w-xl">
          <InlineText
            value={style.usage ?? ''}
            placeholder="Add usage…"
            readOnly={!editable}
            onCommit={(usage) => editTokens((raw) => updateStyle(raw, style.name, { usage: usage || undefined }))}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 self-start">
        <div className="col-span-2 flex min-w-0 flex-col gap-0.5">
          <span className="text-[10px] uppercase tracking-wide text-fg-subtle">Font</span>
          {editable ? (
            <FontPicker
              aria-label={`Font of ${style.name}`}
              value={stack ? firstFamily(stack) : null}
              placeholder="Set's font"
              designSystemFonts={systemFonts}
              onChange={(pick) => pickFamily(pick, (raw, key) => updateStyle(raw, style.name, { family: key }))}
            />
          ) : (
            <span className="h-6 truncate font-mono text-[11px] leading-6 text-fg-muted">{stack ?? '—'}</span>
          )}
        </div>
        <StyleField label="Size" value={style.fontSize} editable={editable} onCommit={set('fontSize')} />
        <StyleField label="Line height" value={style.lineHeight ?? ''} editable={editable} onCommit={set('lineHeight')} />
        <StyleField label="Weight" value={style.fontWeight ?? ''} editable={editable} onCommit={set('fontWeight')} />
        <StyleField label="Tracking" value={style.letterSpacing ?? ''} editable={editable} onCommit={set('letterSpacing')} />
      </div>
    </div>
  );
}

/** Focuses and scrolls to a style just made. */
function reveal(name: string): void {
  const view = useView.getState();
  view.setFocus({ kind: 'style', name });
  view.go('typography', anchorId('style', name));
}

/** "Add type set": a named group with its font, starting with one style. */
function AddTypeSet() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [font, setFont] = useState<FontPick | null>(null);
  const systemFonts = useSystemFonts();
  const create = (): void => {
    if (!name.trim()) return;
    if (font?.stylesheet && font.source === 'google') linkStylesheet(font.stylesheet);
    let made = '';
    editTokens((raw) => {
      let next = raw;
      let key: string | undefined;
      if (font) ({ raw: next, key } = ensureFamily(next, font.family, font.css));
      const group = addTypeGroup(next, name, key);
      const style = addTypeStyle(group.raw, group.name, name);
      made = style.name;
      return style.raw;
    });
    setOpen(false);
    setName('');
    setFont(null);
    if (made) reveal(made);
  };
  return (
    <>
      <Button icon={<FolderPlus className="size-3.5" />} onClick={() => setOpen(true)}>
        Add type set
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Add a type set"
        description="A set groups text styles that share a font, like Display, Body or Code."
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={create} disabled={!name.trim()}>
              Add
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <TextInput autoFocus placeholder="Name, e.g. Display" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && create()} />
          <FontPicker aria-label="Font of the set" value={font?.family ?? null} placeholder="Font (optional)" designSystemFonts={systemFonts} onChange={setFont} />
        </div>
      </Dialog>
    </>
  );
}

/** "Upload font": font files into `fonts/`, listed in the tokens. */
function UploadFont() {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button icon={<Upload className="size-3.5" />} onClick={() => input.current?.click()}>
        Upload font
      </Button>
      <input
        ref={input}
        type="file"
        multiple
        accept=".woff2,.woff,.ttf,.otf,.ttc,font/woff2,font/woff,font/ttf,font/otf"
        className="hidden"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = '';
          if (files.length) void uploadFonts(files);
        }}
      />
    </>
  );
}

function GroupHeader({ group, editable }: { group: NormalizedTokens['groups'][number]; editable: boolean }) {
  const { tokens } = useModel();
  const systemFonts = useSystemFonts();
  const stack = group.family ? (tokens.families[group.family.toLowerCase()] ?? group.family) : null;
  return (
    <h2 className="group/set mb-1 flex items-center gap-2 border-b border-line px-2 pb-2 text-[13px] font-semibold text-fg-muted">
      {editable ? (
        <InlineText value={group.name} placeholder="Set name" readOnly={false} onCommit={(name) => name.trim() && editTokens((raw) => updateTypeGroup(raw, group.name, { name }))} className="!font-semibold !not-italic !text-fg-muted" />
      ) : (
        <span>{group.name}</span>
      )}
      {editable ? (
        <div className="w-48 font-normal">
          <FontPicker
            aria-label={`Font of ${group.name}`}
            value={stack ? firstFamily(stack) : null}
            placeholder="No font"
            designSystemFonts={systemFonts}
            onChange={(pick) => pickFamily(pick, (raw, key) => updateTypeGroup(raw, group.name, { family: key }))}
          />
        </div>
      ) : group.family ? (
        <span className="font-normal text-fg-subtle">{group.family}</span>
      ) : null}
      <span className="flex-1" />
      {editable ? (
        <>
          <Button
            size="sm"
            variant="ghost"
            icon={<Plus className="size-3.5" />}
            onClick={() => {
              let made = '';
              editTokens((raw) => {
                const result = addTypeStyle(raw, group.name, group.styles[group.styles.length - 1]?.name.replace(/-\d+$/, '') ?? 'text');
                made = result.name;
                return result.raw;
              });
              if (made) reveal(made);
            }}
          >
            Add style
          </Button>
          {!group.styles.length ? <IconButton size="sm" label={`Remove ${group.name}`} icon={<Trash2 className="size-3.5" />} onClick={() => editTokens((raw) => removeTypeGroup(raw, group.name))} /> : null}
        </>
      ) : null}
    </h2>
  );
}

export function Typography() {
  const { tokens, files, index } = useModel();
  const paths = new Set([...files.keys(), ...Object.values(index.blobs).flatMap((record) =>
    typeof (record as { name?: unknown } | null)?.name === 'string' ? [(record as { name: string }).name] : [])]);
  const stray = [...paths].filter((path) => /^fonts\/.+\.(?:woff2?|otf|ttf|ttc)$/i.test(path) && !tokens.fonts.some((font) => font.file === path));
  const editable = useEditable();
  const systemFonts = useSystemFonts();
  const count = tokens.groups.reduce((n, group) => n + group.styles.length, 0);
  return (
    <div>
      <FontFaces tokens={tokens} />
      <PageHeader
        title="Typography"
        description={`${count} text styles. Each is a class: class="name".`}
        actions={
          editable ? (
            <>
              <UploadFont />
              <AddTypeSet />
            </>
          ) : null
        }
      />
      <TokenNotes filter={(message) => /type|font|style|famil/i.test(message)} />
      {tokens.groups.map((group) => (
        <section key={group.name} className="mb-8">
          <GroupHeader group={group} editable={editable} />
          <div className="divide-y divide-line">
            {group.styles.map((style) => (
              <StyleRow key={style.name} style={style} families={tokens.families} editable={editable} />
            ))}
          </div>
        </section>
      ))}
      {!tokens.groups.length ? <p className="text-[13px] text-fg-subtle">No text styles yet.</p> : null}

      {Object.keys(tokens.families).length ? (
        <section className="mt-10">
          <h2 className="mb-3 text-[16px] font-semibold text-fg">Font families</h2>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
            {Object.entries(tokens.families).map(([key, stack]) => (
              <div key={key} className="group rounded-lg border border-line p-3">
                <div className="truncate text-[28px] text-fg" style={{ fontFamily: stack }}>
                  Aa Bb Cc 123
                </div>
                <div className="mt-2 flex items-center gap-1">
                  <span className="flex-1 font-mono text-[12px] text-fg">--font-{key}</span>
                  <CommentBadge focus={{ kind: 'token', family: 'type', name: key }} />
                </div>
                {editable ? (
                  <div className="mt-1 flex flex-col gap-1">
                    <FontPicker
                      aria-label={`Font of --font-${key}`}
                      value={firstFamily(stack)}
                      designSystemFonts={systemFonts}
                      onChange={(pick) => {
                        if (pick.stylesheet && pick.source === 'google') linkStylesheet(pick.stylesheet);
                        editTokens((raw) => setFamilyStack(raw, key, pick.css));
                      }}
                    />
                    <CommitInput value={stack} aria-label={`Stack of --font-${key}`} onCommit={(value) => {
                      if (value.trim()) editTokens((raw) => setFamilyStack(raw, key, value.trim()));
                    }} className="h-6 font-mono text-[11px]" />
                  </div>
                ) : (
                  <div className="truncate font-mono text-[11px] text-fg-subtle" title={stack}>
                    {stack}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {tokens.fonts.length || stray.length ? (
        <section className="mt-10">
          <h2 className="mb-3 text-[16px] font-semibold text-fg">Font files</h2>
          <table className="w-full text-[12px]">
            <thead className="text-left text-fg-subtle">
              <tr>
                <th className="py-1 font-medium">Family</th>
                <th className="py-1 font-medium">Weight</th>
                <th className="py-1 font-medium">Style</th>
                <th className="py-1 font-medium">File</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {tokens.fonts.map((font) => (
                <tr key={`${font.file}:${font.weight}:${font.style}`} className="group border-t border-line">
                  <td className="py-1.5 text-fg" style={{ fontFamily: `"${font.family}"`, fontWeight: font.weight.split(' ')[0] as CSSProperties['fontWeight'], fontStyle: font.style }}>
                    {font.family}
                  </td>
                  <td className="py-1.5 font-mono text-fg-muted">{font.weight}</td>
                  <td className="py-1.5 text-fg-muted">{font.style}</td>
                  <td className="py-1.5 font-mono text-fg-muted">{font.file}{paths.has(font.file) ? '' : ' · Missing'}</td>
                  <td>
                    {editable ? (
                      <IconButton
                        size="sm"
                        label={`Stop using ${font.file}`}
                        icon={<Trash2 className="size-3.5" />}
                        className="opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                        onClick={() => editTokens((raw) => removeFontFile(raw, font.file))}
                      />
                    ) : null}
                  </td>
                </tr>
              ))}
              {stray.map((path) => (
                <tr key={path} className="border-t border-line">
                  <td colSpan={3}>Unlisted font</td><td className="font-mono">{path}</td><td>
                    {editable ? <Button size="sm" onClick={() => editTokens((raw) => addFontFiles(raw, [{ ...guessFontFace(path.split('/').pop()!), file: path }]))}>Use font</Button> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}
