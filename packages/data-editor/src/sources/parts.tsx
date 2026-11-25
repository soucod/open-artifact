import { useEffect, useId, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { ChevronRight, MessageSquare, RotateCw, TriangleAlert } from 'lucide-react';
import { announce } from '@open-artifact/editor-kit';
import { Button, IconButton, Tooltip, cn } from '@open-artifact/ui';
import {
  describeToolCallGot,
  type CalculationSource,
  type CalculationWait,
  type Dataset,
  type DatasetLoaderDefinition,
  type DatasetNotice,
  type DatasetRun,
  type GetRun,
  type Parameters,
  type QuerySource,
  type ToolCall,
} from '@open-artifact/data-core';
import { dedentFunctionCode } from '../data/calculations.ts';
import { connectionFixAriaLabel, connectionFixLabel } from '../data/fixes.ts';
import { ASK_AGENT_LABEL } from '../data/SourcesNotice.tsx';
import { fitDatasetNotice, formatAttributedError } from '../data/status.ts';
import { describeCalculationArguments, splitCalculationCodeArguments } from './calc-args.ts';
import { CODE_BOX_CLASS, CollapsibleCodeBlock, CopyButton, HighlightedCode, HighlightedCodePieces, LabeledField, type PlaceRenderer } from './code.tsx';
import { getQueryArgumentViews, type QueryArgumentView } from './args.ts';
import { useFocusHandoff } from './focus.ts';
import { hasRefreshAction, isDatasetLoading, type ConnectionStates, type SourceRowStatus } from './grouping.ts';
import { parseDisplayedNumbers } from '../page/numbers.ts';
import { getResultFreshness, type FocusedNumber } from './result.ts';
import { SourceRow, useBusyTracker, type ConnectSource } from './SourceRow.tsx';
import { getPlacedParameterNames, splitCodePiecesByLengths, tokenizeHighlightedCode, type CodeReading } from './sql.ts';
import {
  CALLS_LABEL,
  COPY_FORMULA_LABEL,
  COPY_LOADER_LABEL,
  COPY_THE_ERROR_LABEL,
  DETAILS_LABEL,
  DIDNT_LOAD_WORDS,
  DIDNT_RUN_WORDS,
  FORMULA_CODE_LABEL,
  INPUTS_LABEL,
  LOADER_CODE_LABEL,
  LOADING_LABEL,
  NOTHING_LINKS_HERE_MESSAGE,
  NOT_READ_BY_PAGE_MESSAGE,
  REFRESHING_LABEL,
  REFRESH_LABEL,
  SET_BY_THE_PAGE_LABEL,
  WAITING_ON_WORDS,
  WHAT_THE_ERROR_SAID_LABEL,
  calculationArgumentUsageLabel,
  copyNamedLabel,
  describeToolCallLine,
  formatParameterValue,
  noToolNamedMessage,
  notInArtifactMessage,
  refreshSourceLabel,
} from './words.ts';

const MAX_ANNOUNCEMENT_LENGTH = 300;

export const QUERY_ARGUMENT_WELL_CLASS = cn(CODE_BOX_CLASS, 'min-h-7 whitespace-pre-wrap [overflow-wrap:anywhere]');

/** A filter's name in an argument; its tooltip says the value the page set. */
export function ParameterTooltip({ name, params }: { name: string; params: Parameters }): ReactElement {
  return (
    <Tooltip
      label={
        <span className="flex flex-col">
          <span className="font-mono">{formatParameterValue(params[name])}</span>
          <span className="opacity-70">{SET_BY_THE_PAGE_LABEL}</span>
        </span>
      }
    >
      <span tabIndex={0} className="rounded bg-accent/15 px-0.5 text-accent underline decoration-dotted underline-offset-2 outline-none focus-visible:outline-2 focus-visible:outline-accent">
        {name}
      </span>
    </Tooltip>
  );
}

function usePlaceRenderer(params: Parameters): PlaceRenderer {
  return useMemo(() => (name: string, index: number) => <ParameterTooltip key={index} name={name} params={params} />, [params]);
}

export function QueryArgumentValue({ arg, params }: { arg: QueryArgumentView; params: Parameters }): ReactElement {
  const place = usePlaceRenderer(params);
  if (!arg.long) return <div className={QUERY_ARGUMENT_WELL_CLASS}>{arg.text === '' ? ' ' : <HighlightedCode code={arg.text} lang={null} place={place} />}</div>;
  return (
    <CollapsibleCodeBlock label={arg.name}>
      <HighlightedCode code={arg.text} lang={arg.lang} {...(arg.quotes === undefined ? {} : { quotes: arg.quotes })} laidOut place={place} />
    </CollapsibleCodeBlock>
  );
}

/** The filters an argument's typed text places, each with its tooltip (nothing when it places none). */
export function ParameterPlaceholderList({ text, reading, params }: { text: string; reading: CodeReading; params: Parameters }): ReactElement | null {
  const names = getPlacedParameterNames(text, reading);
  if (names.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 font-mono text-xs">
      {names.map((name) => (
        <ParameterTooltip key={name} name={name} params={params} />
      ))}
    </div>
  );
}

export interface QueryArgumentFieldsProps {
  call: QuerySource;
  langs?: Record<string, string>;
  params: Parameters;
  /** A note under an argument (how a saved version differs from the query now). */
  noteOf?: (arg: QueryArgumentView) => string;
}

export function QueryArgumentFields({ call, langs, params, noteOf }: QueryArgumentFieldsProps): ReactElement {
  const views = getQueryArgumentViews(call, langs);
  return (
    <>
      {views.map((arg) => (
        <LabeledField key={arg.name} label={arg.name} note={noteOf?.(arg)} end={arg.long ? <CopyButton text={arg.text} label={copyNamedLabel(arg.name)} /> : undefined}>
          <QueryArgumentValue arg={arg} params={params} />
        </LabeledField>
      ))}
    </>
  );
}

export function LoaderDetails({ loader }: { loader: DatasetLoaderDefinition }): ReactElement {
  const code = dedentFunctionCode(loader.code ?? String(loader.fn));
  return (
    <>
      {loader.description === '' ? null : <p className="text-[13px] text-fg-muted">{loader.description}</p>}
      <CollapsibleCodeBlock label={LOADER_CODE_LABEL} unwrapped corner={<CopyButton text={code} label={COPY_LOADER_LABEL} />}>
        <HighlightedCode code={code} lang="javascript" laidOut />
      </CollapsibleCodeBlock>
    </>
  );
}

function isToolCall(value: unknown): value is ToolCall {
  if (typeof value !== 'object' || value === null) return false;
  const call = value as Partial<ToolCall>;
  return typeof call.tool === 'string' && typeof call.n === 'number' && typeof call.ms === 'number' && typeof call.ok === 'boolean' && typeof call.got === 'object';
}

export function ToolCallsDetails({ calls }: { calls: readonly unknown[] }): ReactElement | null {
  const shown = calls.filter(isToolCall);
  if (shown.length === 0) return null;
  return (
    <LabeledField label={CALLS_LABEL}>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[13px] text-fg-muted">
        {shown.map((call, index) => (
          <li key={index} title={describeToolCallGot(call.got)}>
            {describeToolCallLine(call)}
          </li>
        ))}
      </ul>
    </LabeledField>
  );
}

export interface CalculationFormulaProps {
  src: CalculationSource;
  now: number;
  lookup: (id: string) => Dataset | undefined;
  runOf: GetRun;
  down: ConnectionStates;
  canAskAgent: boolean;
  onSelect: (id: string) => void;
  onConnect: ConnectSource;
  onRefresh: (dataset: Dataset) => void;
}

/** A calculation's inputs (each a source row) and its formula, the inputs' names marked in the code. */
export function CalculationFormula({ src, now, lookup, runOf, down, canAskAgent, onSelect, onConnect, onRefresh }: CalculationFormulaProps): ReactElement {
  const [hot, setHot] = useState<number | null>(null);
  const code = dedentFunctionCode(src.code ?? '');
  const args = useMemo(() => describeCalculationArguments(code, src.inputs), [code, src.inputs]);
  const pieces = useMemo(() => splitCalculationCodeArguments(code, args), [code, args]);
  const coloured = useMemo(
    () =>
      splitCodePiecesByLengths(
        tokenizeHighlightedCode(code, 'javascript'),
        pieces.map((piece) => piece.text.length),
      ),
    [code, pieces],
  );
  const light = (index: number): 'lit' | 'dim' | undefined => (hot === null ? undefined : hot === index ? 'lit' : 'dim');
  return (
    <>
      {args.length === 0 ? null : (
        <ul role="list" aria-label={INPUTS_LABEL} className="m-0 flex list-none flex-col gap-0.5 p-0">
          {args.map((arg, index) => {
            const dataset = lookup(arg.input);
            if (dataset === undefined)
              return (
                <li key={arg.input + String(index)} title={notInArtifactMessage(arg.input)} className="px-2 py-1 text-[13px] text-fg-subtle">
                  {arg.input}
                </li>
              );
            return (
              <SourceRow
                key={arg.input + String(index)}
                ds={dataset}
                run={runOf(dataset.id)}
                now={now}
                unasked={false}
                down={down}
                canAskAgent={canAskAgent}
                onOpen={onSelect}
                onConnect={(connector, fix) => {
                  setHot(null);
                  return onConnect(connector, fix);
                }}
                onRefresh={(input) => {
                  setHot(null);
                  onRefresh(input);
                }}
                usedAs={calculationArgumentUsageLabel(arg.name, index)}
                {...(light(index) === undefined ? {} : { light: light(index) })}
                {...(arg.tinted ? { onPoint: (on: boolean) => setHot(on ? index : null) } : {})}
              />
            );
          })}
        </ul>
      )}
      <CollapsibleCodeBlock label={FORMULA_CODE_LABEL} unwrapped corner={<CopyButton text={code} label={COPY_FORMULA_LABEL} />}>
        {pieces.map((piece, index) =>
          piece.arg === undefined ? (
            <HighlightedCodePieces key={index} pieces={coloured[index] ?? []} />
          ) : (
            <span
              key={index}
              data-arg={piece.arg}
              data-hot={hot === piece.arg ? '' : undefined}
              className={cn('rounded underline decoration-accent/50 underline-offset-2', hot === piece.arg && 'bg-accent/15 text-accent')}
              onMouseOver={() => setHot(piece.arg ?? null)}
              onMouseOut={() => setHot(null)}
            >
              {piece.text}
            </span>
          ),
        )}
      </CollapsibleCodeBlock>
    </>
  );
}

export function SourceUsageCaption({ unmarked, unread }: { unmarked: boolean; unread: boolean }): ReactElement {
  return (
    <>
      {unmarked ? <p className="text-xs text-fg-muted">{NOTHING_LINKS_HERE_MESSAGE}</p> : null}
      {unread ? <p className="text-xs text-fg-muted">{NOT_READ_BY_PAGE_MESSAGE}</p> : null}
    </>
  );
}

/** What an error said, behind Details, with Copy. */
export function ErrorDetails({ said }: { said: string }): ReactElement {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-h-7 items-center justify-between">
        <button type="button" aria-expanded={open} aria-controls={id} className="flex items-center gap-1 text-[13px] text-fg" onClick={() => setOpen(!open)}>
          {DETAILS_LABEL}
          <ChevronRight className={cn('size-3.5 text-fg-subtle transition-transform', open && 'rotate-90')} aria-hidden />
        </button>
        {open ? <CopyButton text={said} label={COPY_THE_ERROR_LABEL} /> : null}
      </div>
      {open ? (
        <div id={id} tabIndex={0} role="region" aria-label={WHAT_THE_ERROR_SAID_LABEL} className={cn(CODE_BOX_CLASS, 'max-h-60 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere]')}>
          {said}
        </div>
      ) : null}
    </div>
  );
}

export interface SourceFailureNoticeProps {
  ds: Dataset;
  notice: DatasetNotice;
  status: SourceRowStatus | null;
  /** When the run failed (announced once per failure). */
  failedAt: number | null;
  editor: boolean;
  canAskAgent: boolean;
  onConnect: ConnectSource;
  onAskWhy?: (datasets: Dataset[]) => void;
  /** The notice went away with focus inside it (its fix worked, the source loaded): put focus somewhere. */
  onGone?: () => void;
}

/** Why a source failed, with the fix it needs (or Ask your agent), and what the error said. */
export function SourceFailureNotice({ ds, notice, status, failedAt, editor, canAskAgent, onConnect, onAskWhy, onGone }: SourceFailureNoticeProps): ReactElement {
  const handoff = useFocusHandoff<HTMLDivElement>(() => onGone?.());
  const { text, why, said, fix, retry, tool } = notice;
  const [busy, track] = useBusyTracker();
  const ask = (retry !== undefined || notice.ask === true) && onAskWhy !== undefined ? onAskWhy : undefined;
  const heard = fitDatasetNotice(notice, MAX_ANNOUNCEMENT_LENGTH);
  useEffect(() => {
    if (failedAt !== null) announce(heard);
  }, [failedAt, heard]);
  const tone = status?.kind === 'problem' ? 'border-danger/40 bg-danger/10' : status?.kind === 'warn' ? 'border-warning/40 bg-warning/10' : 'border-line bg-surface-2';
  return (
    <div ref={handoff} className="flex flex-col gap-1.5">
      <div role="none" className={cn('flex items-start gap-2 rounded-control border px-3 py-2 text-[13px] text-fg', tone)}>
        {status?.kind === 'problem' || status?.kind === 'warn' ? (
          <TriangleAlert className={cn('mt-0.5 size-4 shrink-0', status.kind === 'problem' ? 'text-danger' : 'text-warning')} aria-hidden />
        ) : null}
        <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
          {text}
          {why === undefined ? null : <div className="mt-1 text-fg-muted">{formatAttributedError(why)}</div>}
        </div>
        {fix === undefined && ask === undefined ? null : (
          <span className={cn('flex shrink-0 items-center gap-1', fix !== undefined && 'self-center')}>
            {fix === undefined ? null : (
              <Button
                size="sm"
                disabled={busy}
                aria-label={connectionFixAriaLabel(fix.fix, fix.connector, canAskAgent)}
                onClick={(event) => {
                  event.currentTarget.focus();
                  track(onConnect(fix.connector, fix.fix));
                }}
              >
                {connectionFixLabel(fix.fix, canAskAgent)}
              </Button>
            )}
            {ask === undefined ? null : (
              <Button size="sm" icon={<MessageSquare className="size-3.5" aria-hidden />} onClick={() => ask([ds])}>
                {ASK_AGENT_LABEL}
              </Button>
            )}
          </span>
        )}
      </div>
      {editor && tool !== undefined ? (
        <p className="text-xs text-fg-muted">
          {noToolNamedMessage} <code className="font-mono">{tool}</code>.
        </p>
      ) : null}
      {said === undefined ? null : <ErrorDetails said={said} />}
    </div>
  );
}

/** A picked number, large, with what it is. */
export function FocusedSourceNumber({ number }: { number: FocusedNumber }): ReactElement {
  return (
    <div className="flex flex-col-reverse">
      <span className="text-[13px] text-fg-muted [overflow-wrap:anywhere]">{number.name}</span>
      <span className="flex min-h-7 flex-wrap items-baseline justify-between gap-x-3">
        <span className={cn('tabular-nums text-fg [overflow-wrap:anywhere]', parseDisplayedNumbers(number.value).length > 0 ? 'text-[22px] font-bold' : 'text-[15px] font-semibold')}>
          {number.value}
        </span>
        {number.exact === null ? null : <span className="text-[13px] tabular-nums text-fg-muted [overflow-wrap:anywhere]">{number.exact}</span>}
      </span>
    </div>
  );
}

/** The inputs a calculation waits on (or that failed), each a link to it. */
export function CalculationWaits({ inputs, lookup, onSelect }: { inputs: readonly CalculationWait[]; lookup: (id: string) => Dataset | undefined; onSelect: (id: string) => void }): ReactElement {
  return (
    <div className="flex flex-col gap-1">
      {inputs.map(({ id, failed }) => {
        const dataset = lookup(id);
        const link = (
          <button type="button" className="text-fg underline underline-offset-2 hover:text-accent" onClick={() => onSelect(id)}>
            {dataset?.title || id}
          </button>
        );
        return (
          <p key={id} className="text-[13px]">
            {failed ? (
              <>
                {link} <span className="text-fg-muted">{dataset?.source.kind === 'calc' ? DIDNT_RUN_WORDS : DIDNT_LOAD_WORDS}</span>
              </>
            ) : (
              <>
                <span className="text-fg-muted">{WAITING_ON_WORDS}</span> {link}
              </>
            )}
          </p>
        );
      })}
    </div>
  );
}

export interface SourceHeaderActionsProps {
  ds: Dataset;
  run: DatasetRun;
  now: number;
  /** Nothing else on the page refreshes this source. */
  alone?: boolean;
  onRefresh: (dataset: Dataset) => void;
}

/** How fresh a source is, and its Refresh button. */
export function SourceHeaderActions({ ds, run, now, alone = false, onRefresh }: SourceHeaderActionsProps): ReactElement {
  const freshness = isDatasetLoading(ds, run) && run.status !== 'running' ? { text: LOADING_LABEL, heard: LOADING_LABEL } : getResultFreshness(ds, run, now);
  const running = run.status === 'running';
  return (
    <>
      {freshness.text === '' ? null : (
        <span className="truncate text-xs text-fg-muted" title={'title' in freshness ? freshness.title : undefined}>
          <span aria-hidden>{freshness.text}</span>
          <span className="sr-only">{freshness.heard}</span>
        </span>
      )}
      {hasRefreshAction(ds, run, alone) ? (
        <IconButton
          size="sm"
          label={running ? REFRESHING_LABEL : REFRESH_LABEL}
          aria-label={refreshSourceLabel(ds.title || ds.id)}
          aria-busy={running || undefined}
          disabled={running}
          icon={<RotateCw className={cn('size-3.5', running && 'animate-spin')} />}
          onClick={() => onRefresh(ds)}
        />
      ) : null}
    </>
  );
}

export interface DetailSection {
  id: string;
  title: string;
  body: ReactNode;
}

function Disclosure({ section, open, onOpen }: { section: DetailSection; open: boolean; onOpen: (open: boolean) => void }): ReactElement {
  const id = useId();
  return (
    <div className="border-b border-line last:border-b-0">
      <h3 className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          className="flex min-h-8 w-full items-center justify-between gap-2 py-1 text-left text-[13px] font-medium text-fg"
          onClick={() => onOpen(!open)}
        >
          {section.title}
          <ChevronRight className={cn('size-3.5 text-fg-subtle transition-transform', open && 'rotate-90')} aria-hidden />
        </button>
      </h3>
      {open ? (
        <div id={id} className="flex min-w-0 flex-col gap-3 pb-3">
          {section.body}
        </div>
      ) : null}
    </div>
  );
}

/** A source's sections (Query, Code, Transform, Formula, Result), one open at a time. */
export function SourceDetailSections({ parts, open, onOpen }: { parts: readonly DetailSection[]; open: string | null; onOpen: (id: string | null) => void }): ReactElement | null {
  if (parts.length === 0) return null;
  return (
    <div className="flex flex-col">
      {parts.map((section) => (
        <Disclosure key={section.id} section={section} open={open === section.id} onOpen={(next) => onOpen(next ? section.id : null)} />
      ))}
    </div>
  );
}
