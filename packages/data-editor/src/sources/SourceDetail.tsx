import { useMemo, useState, type ReactElement } from 'react';
import { Pencil } from 'lucide-react';
import { IconButton } from '@open-artifact/ui';
import { getDatasetQuery, type Dataset, type DatasetRun, type GetRun, type Parameters } from '@open-artifact/data-core';
import { getCalculationWaits } from '../data/calculations.ts';
import { getLastSuccessfulRun, isFailedDatasetRun } from '../data/query-store.ts';
import { getDatasetNotice } from '../data/status.ts';
import type { SourcePick } from '../state/sources-ui.ts';
import { ExpandableDescription } from './code.tsx';
import { getShownCalls, getSourceRowStatus, type ConnectionStates } from './grouping.ts';
import {
  CalculationFormula,
  CalculationWaits,
  FocusedSourceNumber,
  LoaderDetails,
  QueryArgumentFields,
  SourceDetailSections,
  SourceFailureNotice,
  SourceUsageCaption,
  ToolCallsDetails,
  type DetailSection,
} from './parts.tsx';
import { describeDatasetResult, getFocusedNumber, getResultHighlightTarget, getShownDatasetResult } from './result.ts';
import { DatasetResult, RecordView, ResultMetadata } from './ResultView.tsx';
import { SourceStatusReason, type ConnectSource } from './SourceRow.tsx';
import {
  ANSWER_LABEL,
  CODE_LABEL,
  EDIT_LABEL,
  FILE_LABEL,
  FORMULA_LABEL,
  QUERY_LABEL,
  RESULT_LABEL,
  TRANSFORM_LABEL,
  UNUSED_SOURCE_DESCRIPTION,
  UNUSED_SOURCE_LABEL,
  connectorSaidLabel,
  editFileOfLabel,
  editSourceLabel,
} from './words.ts';

export interface SourceDetailProps {
  ds: Dataset;
  run: DatasetRun;
  now: number;
  params: Parameters;
  /** Nothing on the page links to it. */
  unmarked: boolean;
  /** The page doesn't read it. */
  unread: boolean;
  /** Nothing in the artifact uses it. */
  unused?: boolean;
  /** The mark picked on the page, when it names this source. */
  pick: SourcePick | null;
  lookup: (id: string) => Dataset | undefined;
  runOf: GetRun;
  down: ConnectionStates;
  canAskAgent: boolean;
  /** The viewer may edit sources. */
  canEdit: boolean;
  onEdit: () => void;
  onSelect: (id: string) => void;
  onRefresh: (dataset: Dataset) => void;
  onConnect: ConnectSource;
  onAskWhy?: (datasets: Dataset[]) => void;
  /** Where focus goes when the failure notice clears while it holds focus. */
  onNoticeGone?: () => void;
}

/** One source: its name and description, why it failed, its query, transform or formula, and its result. */
export function SourceDetail({
  ds,
  run,
  now,
  params,
  unmarked,
  unread,
  unused = false,
  pick,
  lookup,
  runOf,
  down,
  canAskAgent,
  canEdit,
  onEdit,
  onSelect,
  onRefresh,
  onConnect,
  onAskWhy,
  onNoticeGone,
}: SourceDetailProps): ReactElement {
  const { source } = ds;
  const title = ds.title || ds.id;
  const query = getDatasetQuery(ds);
  const editable = query !== undefined && canEdit;
  const shown = useMemo(() => getShownDatasetResult(ds, run), [ds, run]);
  const notice = getDatasetNotice(ds, run);
  const status = getSourceRowStatus(ds, run, now, false);
  const failed = isFailedDatasetRun(run);
  const calls = getShownCalls(run);
  const waits = source.kind === 'calc' ? getCalculationWaits(source, lookup, runOf) : [];
  const cell = pick !== null && pick.id === ds.id && (pick.row !== undefined || pick.field !== undefined) ? pick : null;
  const target = useMemo(() => (shown === null || cell === null ? null : getResultHighlightTarget(shown, cell)), [shown, cell]);
  const focusedNumber = useMemo(() => (cell === null ? null : getFocusedNumber(shown, cell)), [shown, cell]);
  const isFile = source.kind === 'file';
  const resultId = isFile ? 'File' : 'Result';
  const [open, setOpen] = useState<string | null>(cell !== null && focusedNumber === null && shown !== null ? resultId : null);
  const [seenPick, setSeenPick] = useState(cell);
  if (seenPick !== cell) {
    setSeenPick(cell);
    if (cell !== null && focusedNumber === null && shown !== null) setOpen(resultId);
  }
  const fileEdit =
    isFile && canEdit ? (
      <IconButton size="sm" label={EDIT_LABEL} aria-label={editFileOfLabel(title)} data-edit-file={ds.id} icon={<Pencil className="size-3.5" />} onClick={onEdit} />
    ) : undefined;

  const sections: DetailSection[] = [];
  if (query !== undefined)
    sections.push({
      id: 'Query',
      title: QUERY_LABEL,
      body: (
        <>
          <QueryArgumentFields call={query} {...(ds.langs === undefined ? {} : { langs: ds.langs })} params={params} />
          {calls !== undefined && calls.length > 0 ? <ToolCallsDetails calls={calls} /> : null}
          <p className="text-xs text-fg-muted [overflow-wrap:anywhere]">{[query.connector, query.tool].filter((part) => part !== '').join(' · ')}</p>
          {failed && run.meta !== undefined && run.meta.length > 0 ? (
            <div className="flex flex-col gap-1">
              <p className="text-[13px] font-medium text-fg">{connectorSaidLabel(query.connector)}</p>
              <ResultMetadata meta={run.meta} />
            </div>
          ) : null}
        </>
      ),
    });
  const lastMeta = getLastSuccessfulRun(run)?.table?.meta ?? [];
  const showsCode = isFile && lastMeta.some((entry) => entry.type === 'code');
  if (showsCode) sections.push({ id: 'Code', title: CODE_LABEL, body: <ResultMetadata meta={lastMeta} /> });
  if (ds.loader !== undefined) sections.push({ id: 'Transform', title: TRANSFORM_LABEL, body: <LoaderDetails loader={ds.loader} /> });
  if (source.kind === 'calc' && source.code !== undefined && source.code !== '')
    sections.push({
      id: 'Formula',
      title: FORMULA_LABEL,
      body: (
        <CalculationFormula
          src={source}
          now={now}
          lookup={lookup}
          runOf={runOf}
          down={down}
          canAskAgent={canAskAgent}
          onSelect={onSelect}
          onConnect={onConnect}
          onRefresh={onRefresh}
        />
      ),
    });
  if (shown !== null)
    sections.push({
      id: resultId,
      title: isFile ? FILE_LABEL : RESULT_LABEL,
      body: (
        <>
          <DatasetResult ds={ds} run={run} shown={shown} caption={describeDatasetResult(ds, run, shown)} target={target} {...(fileEdit === undefined ? {} : { edit: fileEdit })} />
          {showsCode ? null : <ResultMetadata meta={lastMeta} />}
        </>
      ),
    });
  else if (fileEdit !== undefined && source.kind === 'file')
    sections.push({
      id: resultId,
      title: FILE_LABEL,
      body: (
        <div className="flex min-h-7 items-center gap-1">
          <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">{source.name}</span>
          {fileEdit}
        </div>
      ),
    });

  return (
    <div className="flex min-w-0 flex-col gap-3" aria-label={title}>
      <div className="flex flex-col gap-1">
        <div className="flex items-start gap-1">
          <h2 className="m-0 flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-[15px] font-semibold text-fg [overflow-wrap:anywhere]">
            {title}
            {unused ? <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-fg-muted">{UNUSED_SOURCE_LABEL}</span> : null}
            {failed ? null : <SourceStatusReason status={status} />}
          </h2>
          {editable ? <IconButton size="sm" label={EDIT_LABEL} aria-label={editSourceLabel(title)} icon={<Pencil className="size-3.5" />} onClick={onEdit} /> : null}
        </div>
        {ds.description === '' ? null : <ExpandableDescription text={ds.description} />}
        {unused ? <p className="text-[13px] text-fg-muted">{UNUSED_SOURCE_DESCRIPTION}</p> : null}
      </div>
      {focusedNumber === null ? null : <FocusedSourceNumber number={focusedNumber} />}
      {notice === null ? null : (
        <SourceFailureNotice
          ds={ds}
          notice={notice}
          status={status}
          failedAt={failed ? run.at : null}
          editor={canEdit}
          canAskAgent={canAskAgent}
          onConnect={onConnect}
          {...(onAskWhy === undefined ? {} : { onAskWhy })}
          {...(onNoticeGone === undefined ? {} : { onGone: onNoticeGone })}
        />
      )}
      {waits.length > 0 ? <CalculationWaits inputs={waits} lookup={lookup} onSelect={onSelect} /> : null}
      {failed && run.answer !== undefined ? <RecordView value={{ [ANSWER_LABEL]: run.answer }} /> : null}
      <SourceDetailSections parts={sections} open={sections.find((section) => section.id === open)?.id ?? null} onOpen={setOpen} />
      <SourceUsageCaption unmarked={unmarked && shown !== null} unread={unread} />
    </div>
  );
}
