import { useEffect, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode, type Ref } from 'react';
import { Braces, CircleHelp, Database, FileText, Loader2, NotebookPen } from 'lucide-react';
import { Button, Tooltip, cn } from '@open-artifact/ui';
import type { ConnectionFix, Dataset, DatasetRun, DatasetSource } from '@open-artifact/data-core';
import { connectionFixAriaLabel, connectionFixLabel } from '../data/fixes.ts';
import { isRetryableDatasetFailure } from '../data/query-store.ts';
import {
  getRowStatusHeard,
  getRowStatusReason,
  getSourceConnectionAction,
  getSourceFailureLabel,
  getSourceRowAccessibleLabel,
  getSourceRowCaption,
  getSourceRowStatus,
  isDatasetLoading,
  isLiveQueryFailure,
  isSourceWaitingForConnection,
  type ConnectionStates,
  type SourceRowStatus,
} from './grouping.ts';
import { useFocusHandoff } from './focus.ts';
import { RETRY_LABEL, retrySourceLabel } from './words.ts';

/** Fixes a connection (asks the agent, or tries again). */
export type ConnectSource = (connector: string, fix: ConnectionFix) => Promise<unknown>;

const KIND_ICONS: Readonly<Record<DatasetSource['kind'], typeof Database>> = {
  query: Database,
  file: FileText,
  store: NotebookPen,
  calc: Braces,
  unsupported: CircleHelp,
};

const DOT_CLASSES = { problem: 'bg-danger', warn: 'bg-warning' } as const;

/** Keeps a flag on for at least `ms` once it turned on, so a quick load doesn't flash. */
export function useMinimumOnFlag(on: boolean, ms: number): boolean {
  const [held, setHeld] = useState(on);
  const since = useRef(on ? Date.now() : 0);
  useEffect(() => {
    if (on) {
      since.current = Date.now();
      setHeld(true);
      return;
    }
    const left = ms - (Date.now() - since.current);
    if (left <= 0) {
      setHeld(false);
      return;
    }
    const timer = setTimeout(() => setHeld(false), left);
    return () => clearTimeout(timer);
  }, [on, ms]);
  return on || held;
}

/** Tracks a promise's run: busy until it settles. */
export function useBusyTracker(): [boolean, (work: unknown) => void] {
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const track = (work: unknown): void => {
    setBusy(true);
    void Promise.resolve(work)
      .catch(() => undefined)
      .finally(() => {
        if (mounted.current) setBusy(false);
      });
  };
  return [busy, track];
}

export function StatusDot({ kind }: { kind: 'problem' | 'warn' }): ReactElement {
  return <span className={cn('size-1.5 shrink-0 rounded-full', DOT_CLASSES[kind])} />;
}

/** A status dot that says its reason in a tooltip (and on click). */
export function StatusReasonButton({ kind, reason, heard }: { kind: 'problem' | 'warn'; reason: string; heard: string }): ReactElement {
  return (
    <Tooltip label={reason}>
      <button type="button" aria-label={heard} className="inline-flex size-5 items-center justify-center rounded hover:bg-hover">
        <StatusDot kind={kind} />
      </button>
    </Tooltip>
  );
}

export function SourceStatusReason({ status }: { status: SourceRowStatus | null }): ReactElement | null {
  if (status === null || status.kind === 'loading') return null;
  return <StatusReasonButton kind={status.kind} reason={status.reason} heard={status.heard} />;
}

function RowStatus({ status }: { status: SourceRowStatus | null }): ReactElement {
  return (
    <span className="flex size-4 items-center justify-center">
      {status?.kind === 'loading' ? <Loader2 className="size-3.5 animate-spin text-fg-muted" aria-hidden /> : null}
      {status?.kind === 'problem' || status?.kind === 'warn' ? <StatusDot kind={status.kind} /> : null}
    </span>
  );
}

function RowWords({ children }: { children: ReactNode }): ReactElement {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const check = (): void => setCut(element.scrollWidth > element.clientWidth + 1);
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(check);
    observer.observe(element);
    return () => observer.disconnect();
  }, [children]);
  return (
    <span ref={ref} data-cut={cut ? '' : undefined} className="min-w-0 truncate" title={cut && typeof children === 'string' ? children : undefined}>
      {children}
    </span>
  );
}

export interface SourceRowProps {
  ds: Dataset;
  run: DatasetRun;
  now: number;
  /** Nothing asked for it yet (it doesn't count as loading). */
  unasked: boolean;
  down: ConnectionStates;
  canAskAgent: boolean;
  rowRef?: Ref<HTMLButtonElement>;
  onOpen: (id: string) => void;
  onConnect: ConnectSource;
  onRefresh: (dataset: Dataset) => void;
  /** How a calculation uses it ("used as orders in the formula"). */
  usedAs?: string;
  /** Lit or dimmed while a formula's argument is pointed at. */
  light?: 'lit' | 'dim';
  onPoint?: (on: boolean) => void;
}

/** One source in the list: its name, connector and age, status, and the fix or Retry it needs. */
export function SourceRow({ ds, run, now, unasked, down, canAskAgent, rowRef, onOpen, onConnect, onRefresh, usedAs, light, onPoint }: SourceRowProps): ReactElement {
  const loading = useMinimumOnFlag(isDatasetLoading(ds, run, unasked), 1000);
  const [busy, track] = useBusyTracker();
  const status = getSourceRowStatus(ds, run, now, loading);
  const retryable = !loading && isRetryableDatasetFailure(run);
  const reason = retryable ? undefined : getRowStatusReason(status);
  const facts = [usedAs, retryable ? getSourceFailureLabel(ds) : getRowStatusHeard(status)].filter((fact): fact is string => fact !== undefined);
  const description = facts.join(', ');
  const action = loading ? null : getSourceConnectionAction(ds, run, down);
  const retry = !loading && isLiveQueryFailure(ds, run);
  const fixes = action !== null || retry;
  const title = ds.title || ds.id;
  const button = useRef<HTMLButtonElement | null>(null);
  const setButton = (node: HTMLButtonElement | null): void => {
    button.current = node;
    if (typeof rowRef === 'function') rowRef(node);
    else if (rowRef) rowRef.current = node;
  };
  const Icon = KIND_ICONS[ds.source.kind];
  const caption = fixes ? '' : getSourceRowCaption(ds, run, now);
  const main = (
    <button
      ref={setButton}
      type="button"
      data-source-row=""
      aria-label={getSourceRowAccessibleLabel(title, ds, run, now)}
      aria-description={description === '' ? undefined : description}
      className="flex h-8 w-full min-w-0 items-center gap-1 rounded-[6px] py-1.5 pr-2 pl-2 text-left text-[13px] text-fg focus-visible:outline-2 focus-visible:outline-accent"
      onClick={() => onOpen(ds.id)}
    >
      <span className="flex min-w-0 flex-1 items-center gap-1">
        <RowWords>{title}</RowWords>
      </span>
      {caption === '' ? null : (
        <span data-source-meta="" className="max-w-[60%] shrink truncate pr-0.5 text-xs text-fg-muted">
          {caption}
        </span>
      )}
      <span data-source-end="" className="flex shrink-0 items-center text-fg-subtle">
        <RowStatus status={status} />
        <span className="flex size-5 items-center justify-center">
          <Icon className="size-4" aria-hidden />
        </span>
      </span>
    </button>
  );
  return (
    <li
      data-waiting={isSourceWaitingForConnection(ds, run, down) ? '' : undefined}
      data-fix={fixes ? '' : undefined}
      data-source-item=""
      data-light={light}
      className={cn('relative min-w-0 rounded-[6px] hover:bg-hover has-[:focus-visible]:bg-hover', light === 'dim' && 'opacity-55', light === 'lit' && 'bg-hover')}
      onMouseEnter={onPoint && (() => onPoint(true))}
      onMouseLeave={onPoint && (() => onPoint(false))}
      onFocus={onPoint && (() => onPoint(true))}
      onBlur={onPoint && (() => onPoint(false))}
    >
      {reason === undefined ? (
        main
      ) : (
        <Tooltip label={reason} side="left">
          {main}
        </Tooltip>
      )}
      {action !== null ? (
        <RowFixButton
          fix={action.fix}
          connector={action.connector}
          busy={busy}
          canAskAgent={canAskAgent}
          onFix={() => track(onConnect(action.connector, action.fix))}
          onGone={() => button.current?.focus()}
        />
      ) : null}
      {retry ? (
        <Button
          size="sm"
          data-source-fix=""
          className="absolute top-1 right-2"
          aria-label={retrySourceLabel(title)}
          onClick={() => {
            button.current?.focus();
            onRefresh(ds);
          }}
        >
          {RETRY_LABEL}
        </Button>
      ) : null}
    </li>
  );
}

interface RowFixButtonProps {
  fix: ConnectionFix;
  connector: string;
  busy: boolean;
  canAskAgent: boolean;
  onFix: () => void;
  /** The button went away with focus on it (the fix worked): focus goes back to the row. */
  onGone: () => void;
}

/** A row's connection fix. A click focuses it first, since some browsers don't, so that focus can follow it away. */
function RowFixButton({ fix, connector, busy, canAskAgent, onFix, onGone }: RowFixButtonProps): ReactElement {
  const handoff = useFocusHandoff<HTMLButtonElement>(onGone);
  return (
    <Button
      ref={handoff}
      size="sm"
      data-source-fix=""
      className="absolute top-1 right-2"
      disabled={busy}
      aria-label={connectionFixAriaLabel(fix, connector, canAskAgent)}
      onClick={(event) => {
        event.currentTarget.focus();
        onFix();
      }}
    >
      {connectionFixLabel(fix, canAskAgent)}
    </Button>
  );
}
