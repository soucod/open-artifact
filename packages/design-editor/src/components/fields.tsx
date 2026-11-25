/**
 * Properties-panel parts in the Design look: sections with a 40px
 * header, rows with a 76px label column, 24px fields on a soft inset ring,
 * selects that open chrome menus, and a 16px color well.
 */

import { Combobox as BaseCombobox } from '@base-ui/react/combobox';
import { Select as BaseSelect } from '@base-ui/react/select';
import { Check, ChevronDown, Palette } from 'lucide-react';
import { forwardRef, useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { cn, isComposingKey } from '@open-artifact/ui';
import { historyKeyOf, stepLength } from '../lib/field-keys.ts';
import { redo, undo } from '../services/commands.ts';
import { ChromeMenu, ChromeMenuItem, ChromeMenuLabel, Tip } from '@open-artifact/editor-kit/react';

/** A design-system color a color field offers (see services/design-systems.ts `useSystemSwatches`). */
export interface PSwatch {
  label: string;
  group: string;
  /** What picking it writes. */
  value: string;
  /** The color drawn on the swatch. */
  color: string;
}

/* --------------------------------- layout --------------------------------- */

/** A titled group of rows; groups after the first get a hairline on top. */
export function PSection({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('border-t border-chrome-sep pb-2 first:border-t-0', !title && 'pt-2', className)}>
      {title ? (
        <header className="flex min-h-10 items-center gap-1 py-2 pl-3 pr-2">
          <h3 className="min-w-0 flex-1 truncate text-[13px] font-[520] text-chrome-fg">{title}</h3>
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/** One labelled row: 76px label, then the controls. */
export function PRow({ label, children, className, title }: { label?: ReactNode; children: ReactNode; className?: string; title?: string }) {
  return (
    <div className={cn('grid min-h-8 grid-cols-[76px_minmax(0,1fr)] items-center gap-x-2 py-px pl-3 pr-2', className)}>
      <span className="truncate text-[12px] text-chrome-muted" title={title}>
        {label}
      </span>
      <div className="flex min-w-0 items-center gap-1.5">{children}</div>
    </div>
  );
}

/** A small muted note inside the panel. */
export function PNote({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('px-3 py-2 text-[12px] leading-[1.45] text-chrome-muted', className)}>{children}</div>;
}

/* --------------------------------- fields --------------------------------- */

const FIELD =
  'h-6 min-w-0 rounded-[6px] bg-chrome-field text-[13px] text-chrome-fg outline-none shadow-[inset_0_0_0_1px_var(--dc-field-ring)] transition-shadow hover:shadow-[inset_0_0_0_1px_var(--dc-field-ring-strong)] focus-within:shadow-[inset_0_0_0_1px_#257de0] has-[:disabled]:opacity-50';

/** Fields fill their row unless given a width. */
const fill = (className?: string) => (className?.includes('w-[') ? null : 'w-full flex-1');

/** Props of {@link PInput}. */
export interface PInputProps {
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  /** A unit shown at the end ("px"). Bare numbers are committed with it. */
  unit?: string;
  /** A letter or icon at the start (X, W…). */
  prefix?: ReactNode;
  disabled?: boolean;
  className?: string;
  mono?: boolean;
  'aria-label'?: string;
}

/**
 * A text field that keeps a draft and commits on Enter or blur; Escape
 * reverts. Enter keeps the focus, with the text selected, so the next value
 * can be typed at once. Arrow keys step numbers (Shift: by 10); an empty
 * field steps from its placeholder. Undo and redo with nothing typed undo
 * the design, not the field's text.
 */
export function PInput({ value, onCommit, placeholder, unit, prefix, disabled, className, mono, ...aria }: PInputProps) {
  const [draft, setDraft] = useState(value);
  const cancelled = useRef(false);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setDraft(value);
    // After an Enter the new value is selected again once it shows.
    const input = field.current;
    if (input && input.ownerDocument.activeElement === input) requestAnimationFrame(() => input.ownerDocument.activeElement === input && input.select());
  }, [value]);
  const commit = (text = draft) => {
    const trimmed = text.trim();
    const next = unit && /^-?\d*\.?\d+$/.test(trimmed) ? `${trimmed}${unit}` : trimmed;
    if (next !== value && trimmed !== value) onCommit(next);
  };
  return (
    <label className={cn(FIELD, fill(className), 'flex items-center gap-1 px-2', className)}>
      {prefix ? <span className="shrink-0 text-[11px] text-chrome-muted">{prefix}</span> : null}
      <input
        ref={field}
        aria-label={aria['aria-label']}
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (!cancelled.current) commit();
          cancelled.current = false;
        }}
        onKeyDown={(event) => {
          if (isComposingKey(event.nativeEvent)) return;
          const history = historyKeyOf(event);
          if (history && draft === value) {
            event.preventDefault();
            if (history === 'undo') undo();
            else redo();
          } else if (event.key === 'Enter') {
            commit();
            event.currentTarget.select();
          } else if (event.key === 'Escape') {
            cancelled.current = true;
            setDraft(value);
            event.currentTarget.blur();
          } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            const stepped = stepLength(draft, placeholder ?? '', (event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 10 : 1), unit !== undefined);
            if (stepped === null) return;
            event.preventDefault();
            const shown = unit && stepped.endsWith(unit) ? stepped.slice(0, -unit.length) : stepped;
            setDraft(shown);
            commit(shown);
          }
        }}
        className={cn('h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-chrome-muted', mono && 'font-mono text-[12px]')}
      />
      {unit && (!draft.trim() || /^-?\d*\.?\d+$/.test(draft.trim())) ? <span className="shrink-0 text-[11px] text-chrome-muted">{unit}</span> : null}
    </label>
  );
}

/** Strips a unit for display in a {@link PInput} that shows it separately. */
export function withoutUnit(value: string | undefined, unit = 'px'): string {
  if (!value) return '';
  return value.endsWith(unit) && /^-?\d*\.?\d+$/.test(value.slice(0, -unit.length)) ? value.slice(0, -unit.length) : value;
}

/** Rounds a computed length ("39.5px") for a placeholder ("40"). */
export function roundPx(value: string | undefined): string {
  if (!value) return '';
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && /px$/.test(value) ? String(Math.round(n * 10) / 10) : value;
}

/* --------------------------------- select --------------------------------- */

/** One option of {@link PSelect}. */
export interface POption {
  value: string;
  label: ReactNode;
  /** Group heading shown above the first option of a group. */
  group?: string;
  /** Rendered as a sample (font names in their own face). */
  style?: CSSProperties;
}

/** A select whose menu looks like the chrome menus. */
export function PSelect({
  value,
  options,
  onChange,
  placeholder = '—',
  disabled,
  className,
  ...aria
}: {
  value: string | null;
  options: POption[];
  onChange: (value: string) => void;
  placeholder?: ReactNode;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}) {
  const current = options.find((option) => option.value === value);
  let lastGroup: string | undefined;
  return (
    <BaseSelect.Root value={value} onValueChange={(next) => next !== null && onChange(next as string)} disabled={disabled}>
      <BaseSelect.Trigger
        aria-label={aria['aria-label']}
        className={cn(FIELD, fill(className), 'flex cursor-default items-center gap-1 pl-2 pr-[6px] text-left data-[disabled]:opacity-50', className)}
      >
        <span className={cn('min-w-0 flex-1 truncate', !current && 'text-chrome-muted')}>{current?.label ?? (value || placeholder)}</span>
        <ChevronDown className="size-4 shrink-0 text-chrome-muted" strokeWidth={1.5} />
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={4} alignItemWithTrigger={false} className="z-[1000]">
          <BaseSelect.Popup className="max-h-[min(420px,var(--available-height))] min-w-[var(--anchor-width)] overflow-auto rounded-[14px] bg-chrome p-1.5 text-[13px] text-chrome-fg shadow-chrome-popup outline-none">
            <BaseSelect.List>
              {options.map((option) => {
                const heading = option.group && option.group !== lastGroup ? option.group : null;
                lastGroup = option.group;
                return (
                  <div key={`${option.group ?? ''}:${option.value}`}>
                    {heading ? <div className="px-2.5 pb-1 pt-2 text-[12px] font-medium text-chrome-muted first:pt-1">{heading}</div> : null}
                    <BaseSelect.Item
                      value={option.value}
                      className="flex h-7 cursor-default select-none items-center gap-2 rounded-[8px] pl-2 pr-2.5 outline-none data-[highlighted]:bg-chrome-hover"
                    >
                      <span className="flex size-4 shrink-0 items-center justify-center">
                        <BaseSelect.ItemIndicator>
                          <Check className="size-4 text-chrome-accent" strokeWidth={2.25} />
                        </BaseSelect.ItemIndicator>
                      </span>
                      <BaseSelect.ItemText className="truncate" style={option.style}>
                        {option.label}
                      </BaseSelect.ItemText>
                    </BaseSelect.Item>
                  </div>
                );
              })}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}

/**
 * A {@link PSelect} with a search field over its list: typing narrows the
 * options by name, arrow keys move and Enter picks.
 */
export function PSearchSelect({
  value,
  options,
  onChange,
  placeholder = '—',
  searchLabel = 'Search',
  disabled,
  className,
  ...aria
}: {
  value: string | null;
  options: POption[];
  onChange: (value: string) => void;
  placeholder?: ReactNode;
  /** Name and placeholder of the search field. */
  searchLabel?: string;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}) {
  const byValue = new Map(options.map((option) => [option.value, option]));
  const current = value === null ? undefined : byValue.get(value);
  const nameOf = (item: string) => {
    const label = byValue.get(item)?.label;
    return typeof label === 'string' ? label : item;
  };
  return (
    <BaseCombobox.Root
      items={options.map((option) => option.value)}
      value={current ? value : null}
      onValueChange={(next: string | null) => next !== null && onChange(next)}
      itemToStringLabel={nameOf}
      autoHighlight
      disabled={disabled}
    >
      <BaseCombobox.Trigger
        aria-label={aria['aria-label']}
        className={cn(FIELD, fill(className), 'flex cursor-default items-center gap-1 pl-2 pr-[6px] text-left data-[disabled]:opacity-50', className)}
      >
        <span className={cn('min-w-0 flex-1 truncate', !current && 'text-chrome-muted')}>{current?.label ?? (value || placeholder)}</span>
        <ChevronDown className="size-4 shrink-0 text-chrome-muted" strokeWidth={1.5} />
      </BaseCombobox.Trigger>
      <BaseCombobox.Portal>
        <BaseCombobox.Positioner sideOffset={4} className="z-[1000]">
          <BaseCombobox.Popup className="flex max-h-[min(420px,var(--available-height))] min-w-[var(--anchor-width)] flex-col rounded-[14px] bg-chrome p-1.5 text-[13px] text-chrome-fg shadow-chrome-popup outline-none">
            <BaseCombobox.Input
              aria-label={searchLabel}
              placeholder={searchLabel}
              autoComplete="off"
              spellCheck={false}
              className="mb-1 h-7 shrink-0 rounded-[8px] bg-chrome-field px-2 text-chrome-fg outline-none shadow-[inset_0_0_0_1px_var(--dc-field-ring)] placeholder:text-chrome-muted focus:shadow-[inset_0_0_0_1px_#257de0]"
            />
            <BaseCombobox.Empty className="px-2.5 py-1.5 text-chrome-muted empty:hidden">No matches</BaseCombobox.Empty>
            <BaseCombobox.List className="min-h-0 flex-1 overflow-y-auto">
              {(item: string) => (
                <BaseCombobox.Item
                  key={item}
                  value={item}
                  className="flex h-7 cursor-default select-none items-center gap-2 rounded-[8px] pl-2 pr-2.5 outline-none data-[highlighted]:bg-chrome-hover"
                >
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    <BaseCombobox.ItemIndicator>
                      <Check className="size-4 text-chrome-accent" strokeWidth={2.25} />
                    </BaseCombobox.ItemIndicator>
                  </span>
                  <span className="truncate" style={byValue.get(item)?.style}>
                    {byValue.get(item)?.label ?? item}
                  </span>
                </BaseCombobox.Item>
              )}
            </BaseCombobox.List>
          </BaseCombobox.Popup>
        </BaseCombobox.Positioner>
      </BaseCombobox.Portal>
    </BaseCombobox.Root>
  );
}

/* --------------------------------- color ---------------------------------- */

/** Converts any CSS color the browser understands to #rrggbb, or null. */
export function toHex(color: string | undefined): string | null {
  if (!color) return null;
  if (/^#[0-9a-f]{6}$/i.test(color)) return color.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(color)) return `#${[...color.slice(1)].map((c) => c + c).join('')}`.toLowerCase();
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(color);
  if (!rgb) return null;
  if (rgb[4] !== undefined && Number.parseFloat(rgb[4]) === 0) return null;
  return `#${[rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
}

/** True when a computed color is fully transparent. */
export function isTransparent(color: string | undefined): boolean {
  return !color || color === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(color) || /\/\s*0\)$/.test(color);
}

/** A 16px color well (opens the system picker) and the value as text. */
export function PColor({
  value,
  placeholder,
  onCommit,
  disabled,
  swatches,
  ...aria
}: {
  /** The value as written, or empty when not set. */
  value: string;
  /** The rendered color, shown when nothing is written. */
  placeholder?: string;
  onCommit: (value: string) => void;
  disabled?: boolean;
  /** Design-system colors offered from a menu next to the field. */
  swatches?: readonly PSwatch[];
  'aria-label'?: string;
}) {
  const shown = value || placeholder || '';
  const token = swatches?.find((swatch) => swatch.value === value);
  const literal = token?.color ?? /^\s*var\([^,]+,\s*([^)]+)\)\s*$/.exec(value)?.[1];
  const hex = toHex(literal ?? value) ?? toHex(placeholder) ?? '#000000';
  const field = (
    <PInput
      value={value}
      placeholder={placeholder ? (toHex(placeholder) ?? placeholder) : 'None'}
      onCommit={onCommit}
      disabled={disabled}
      aria-label={aria['aria-label']}
      prefix={
        <span
          className="relative -ml-0.5 mr-0.5 block size-4 overflow-hidden rounded-[4px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.1)]"
          style={{
            background: shown && !isTransparent(shown) ? shown : 'repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 0 0 / 8px 8px',
          }}
        >
          <input
            type="color"
            value={hex}
            disabled={disabled}
            aria-label={aria['aria-label'] ? `${aria['aria-label']} picker` : 'Color picker'}
            onChange={(event) => onCommit(event.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
          />
        </span>
      }
    />
  );
  if (!swatches?.length) return field;
  const groups = [...new Set(swatches.map((swatch) => swatch.group))];
  return (
    <span className="flex min-w-0 flex-1 items-center gap-1">
      <span className="min-w-0 flex-1">{field}</span>
      <ChromeMenu
        align="end"
        className="max-h-[360px] w-[240px] overflow-y-auto"
        tip={{ label: token ? `Token: ${token.label}` : 'Design system colors' }}
        trigger={
          <PIconButton label={`${aria['aria-label'] ?? 'Color'}: design system colors`} pressed={Boolean(token)} disabled={disabled}>
            <Palette className="size-3.5" />
          </PIconButton>
        }
      >
        {groups.map((group) => (
          <div key={group}>
            {groups.length > 1 ? <ChromeMenuLabel>{group}</ChromeMenuLabel> : null}
            {swatches
              .filter((swatch) => swatch.group === group)
              .map((swatch) => (
                <ChromeMenuItem
                  key={`${group}:${swatch.label}`}
                  checked={swatch.value === value}
                  icon={<span className="block size-3.5 rounded-[4px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)]" style={{ background: swatch.color }} />}
                  onSelect={() => onCommit(swatch.value)}
                >
                  {swatch.label}
                </ChromeMenuItem>
              ))}
          </div>
        ))}
      </ChromeMenu>
    </span>
  );
}

/* --------------------------------- buttons -------------------------------- */

/** A 24px icon button for panel rows; `pressed` fills it. */
export const PIconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { pressed?: boolean; label: string }>(function PIconButton(
  { pressed, label, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-[6px] text-chrome-secondary outline-none transition-colors hover:bg-chrome-hover hover:text-chrome-fg focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-chrome-accent disabled:pointer-events-none disabled:opacity-35',
        pressed && 'bg-chrome-selected text-chrome-fg hover:bg-chrome-selected',
        className,
      )}
      {...rest}
    />
  );
});

/** {@link PIconButton} with a tooltip that also shows when it is disabled. */
export function PTipButton({ tip, disabled, ...props }: Parameters<typeof PIconButton>[0] & { tip: ReactNode }) {
  // A disabled button gets no pointer events, so the tooltip hangs on a wrapper.
  return (
    <Tip label={tip} side="top">
      <span className="inline-flex">
        <PIconButton {...props} disabled={disabled} />
      </span>
    </Tip>
  );
}

/** A row of icon segments (one pressed). */
export function PSegments<T extends string>({
  value,
  options,
  onChange,
  disabled,
  className,
}: {
  value: T | null;
  options: { value: T; label: string; icon: ReactNode }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div role="radiogroup" className={cn('flex h-6 items-center gap-0.5 rounded-[6px] bg-chrome-field p-px shadow-[inset_0_0_0_1px_var(--dc-field-ring)]', disabled && 'opacity-50', className)}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          aria-label={option.label}
          title={option.label}
          disabled={disabled}
          onClick={() => onChange(option.value)}
          className={cn(
            'flex h-[22px] flex-1 items-center justify-center rounded-[5px] text-chrome-muted outline-none hover:text-chrome-fg',
            value === option.value && 'bg-chrome text-chrome-fg shadow-[0_0_0_1px_var(--dc-field-ring),0_1px_2px_rgb(0_0_0/0.06)]',
          )}
        >
          {option.icon}
        </button>
      ))}
    </div>
  );
}

/** A panel text button (Reset, Save as defaults…). */
export function PButton({ primary, className, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean }) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-[8px] px-2.5 text-[13px] font-control outline-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-chrome-accent disabled:opacity-40',
        primary ? 'bg-chrome-fg text-chrome hover:opacity-90' : 'text-chrome-fg shadow-[inset_0_0_0_1px_var(--dc-field-ring-strong)] hover:bg-chrome-hover',
        className,
      )}
      {...rest}
    />
  );
}

/** Tracks a drag on a resize handle; reports the pointer delta from the start. */
export function useDragResize(onMove: (delta: { dx: number; dy: number }) => void, onEnd?: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown(event: ReactPointerEvent<HTMLElement>) {
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      start.current = { x: event.clientX, y: event.clientY };
    },
    onPointerMove(event: ReactPointerEvent<HTMLElement>) {
      if (!start.current) return;
      onMove({ dx: event.clientX - start.current.x, dy: event.clientY - start.current.y });
    },
    onPointerUp(event: ReactPointerEvent<HTMLElement>) {
      if (!start.current) return;
      start.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
      onEnd?.();
    },
  };
}
