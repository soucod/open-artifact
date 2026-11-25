import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import { IconButton } from '@open-artifact/ui';
import type { ConnectionFix, Dataset, DatasetRun, FileSource } from '@open-artifact/data-core';
import { maybeDataEngine } from '../data/engine.ts';
import { IDLE_DATASET_RUN } from '../data/query-store.ts';
import { partitionUsedDatasets } from '../data/status.ts';
import { maybeSession } from '../services/session.ts';
import { useDatasets } from '../state/datasets.ts';
import { useDocument } from '../state/document.ts';
import { useSourcesUi } from '../state/sources-ui.ts';
import { FileEditorDialog } from './FileEditorDialog.tsx';
import {
  getSourceBackLabel,
  getTrailSource,
  getUnavailableConnectors,
  groupSourcesByConnector,
  popSourceTrail,
  pushSourceTrail,
  type ConnectionStates,
} from './grouping.ts';
import { SourceHeaderActions } from './parts.tsx';
import { QueryEditorDialog } from './QueryEditorDialog.tsx';
import { RefreshDataRow } from './RefreshDataMenu.tsx';
import { SourceDetail } from './SourceDetail.tsx';
import { useSourceStepFocus } from './focus.ts';
import { SourceRow } from './SourceRow.tsx';
import {
  CLOSE_LABEL,
  FILES_GROUP_NAME,
  STORAGE_GROUP_NAME,
  NO_SOURCES_MESSAGE,
  SOURCES_LABEL,
  describeConnectorGroupLabel,
  describeFilesGroupLabel,
  describeStorageGroupLabel,
  describeTransformsGroupLabel,
  TRANSFORMS_GROUP_NAME,
} from './words.ts';

/** How the page uses each source; the shell fills it from the page's marks and reads. */
export interface SourcesUsage {
  /** The sources the page reads or marks, in the order it uses them. */
  read?: readonly string[];
  /** Sources nothing on the page links to. */
  unmarked?: ReadonlySet<string>;
  /** Sources the page doesn't read. */
  unread?: ReadonlySet<string>;
  /** Sources nothing in the artifact uses. */
  unused?: ReadonlySet<string>;
}

export interface SourcesPanelProps {
  /** Asks the agent why these sources failed; without it the panel offers no such button. */
  onAskWhy?: (datasets: Dataset[]) => void;
  usage?: SourcesUsage;
  /** Shows a Close button in the header. */
  onClose?: () => void;
}

interface SourceGroupView {
  key: string;
  name: string;
  label: string;
  rows: Dataset[];
}

function listGroups(datasets: readonly Dataset[]): SourceGroupView[] {
  const { connectors, files, stores, rest, calcs } = groupSourcesByConnector(datasets);
  if (connectors.length === 0 && stores.length === 0) return [{ key: 'all', name: '', label: '', rows: [...datasets] }];
  const groups: SourceGroupView[] = connectors.map((group) => ({
    key: `connector:${group.connector}`,
    name: group.connector,
    label: describeConnectorGroupLabel(group.connector, group.rows.length),
    rows: group.rows,
  }));
  if (files.length > 0) groups.push({ key: 'files', name: FILES_GROUP_NAME, label: describeFilesGroupLabel(files.length), rows: files });
  if (stores.length > 0)
    groups.push({ key: 'storage', name: STORAGE_GROUP_NAME, label: describeStorageGroupLabel(stores.length), rows: stores });
  if (rest.length > 0) groups.push({ key: 'rest', name: '', label: '', rows: rest });
  if (calcs.length > 0) groups.push({ key: 'calcs', name: TRANSFORMS_GROUP_NAME, label: describeTransformsGroupLabel(calcs.length), rows: calcs });
  return groups;
}

function isFileDataset(dataset: Dataset): dataset is Dataset & { source: FileSource } {
  return dataset.source.kind === 'file';
}

/** The trail of sources opened from one another, kept in step with the selected source. */
function useSourceTrail(): { trail: readonly string[]; open: (id: string) => void; back: () => void; list: () => void } {
  const selected = useSourcesUi((state) => state.selected);
  const [trail, setTrail] = useState<readonly string[]>(selected === null ? [] : [selected]);
  if (getTrailSource(trail) !== selected) setTrail(selected === null ? [] : [selected]);
  const go = useCallback((next: readonly string[]): void => {
    setTrail(next);
    useSourcesUi.setState({ selected: getTrailSource(next), pick: null });
  }, []);
  return {
    trail,
    open: (id) => go(pushSourceTrail(trail, id)),
    back: () => go(popSourceTrail(trail)),
    list: () => go([]),
  };
}

/** The Sources panel: every source the artifact loads, grouped by where it loads from, and one source in detail. */
export function SourcesPanel({ onAskWhy, usage, onClose }: SourcesPanelProps): ReactElement {
  const datasets = useDatasets((state) => state.datasets);
  const runs = useDatasets((state) => state.runs);
  const requested = useDatasets((state) => state.requested);
  const params = useDatasets((state) => state.params);
  const now = useDatasets((state) => state.now);
  const canWrite = useDocument((state) => state.canWrite);
  const pick = useSourcesUi((state) => state.pick);
  const { trail, open, back } = useSourceTrail();
  const [editing, setEditing] = useState<string | null>(null);
  const engine = maybeDataEngine();
  const canEdit = canWrite && maybeSession()?.canEdit === true;
  const canAskAgent = engine?.canAskAgent() ?? false;

  const runOf = useCallback((id: string): DatasetRun => runs.get(id) ?? IDLE_DATASET_RUN, [runs]);
  const lookup = useCallback((id: string): Dataset | undefined => datasets.find((dataset) => dataset.id === id), [datasets]);
  const down: ConnectionStates = useMemo(() => getUnavailableConnectors(datasets, runOf), [datasets, runOf]);
  const groups = useMemo(() => {
    const { used, unused } = partitionUsedDatasets([...datasets], usage?.read ?? requested);
    return listGroups([...used, ...unused]);
  }, [datasets, usage?.read, requested]);
  const selectedId = getTrailSource(trail);
  const selected = selectedId === null ? undefined : lookup(selectedId);
  const edited = editing === null ? undefined : lookup(editing);
  const steps = useSourceStepFocus(selected?.id ?? null, selected === undefined ? null : selected.title || selected.id);

  useEffect(() => {
    engine?.select(selected?.id ?? null);
  }, [engine, selected?.id]);

  const refresh = useCallback((dataset: Dataset): void => engine?.refresh(dataset.id), [engine]);
  const connect = useCallback(
    (connector: string, fix: ConnectionFix): Promise<unknown> => engine?.fixConnection(connector, fix) ?? Promise.resolve(),
    [engine],
  );
  const nameOf = (id: string): string => {
    const dataset = lookup(id);
    return dataset === undefined ? id : dataset.title || dataset.id;
  };
  const closeEditor = useCallback(() => setEditing(null), []);

  const header =
    selected === undefined ? (
      <h2 className="m-0 flex-1 text-[13px] font-semibold text-fg">{SOURCES_LABEL}</h2>
    ) : (
      <>
        <IconButton ref={steps.back} size="sm" label={getSourceBackLabel(trail, nameOf)} icon={<ArrowLeft className="size-4" />} onClick={back} />
        <span className="flex min-w-0 flex-1 items-center justify-end gap-1">
          <SourceHeaderActions ds={selected} run={runOf(selected.id)} now={now} onRefresh={refresh} />
        </span>
      </>
    );

  return (
    <section aria-label={SOURCES_LABEL} className="flex h-full min-h-0 flex-col bg-surface text-fg">
      <header className="flex min-h-10 flex-none items-center gap-1 border-b border-line px-3">
        {header}
        {onClose === undefined ? null : <IconButton size="sm" label={CLOSE_LABEL} icon={<X className="size-4" />} onClick={onClose} />}
      </header>
      <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
        {selected !== undefined ? (
          <div className="px-1">
            <SourceDetail
              key={selected.id}
              ds={selected}
              run={runOf(selected.id)}
              now={now}
              params={params}
              unmarked={usage?.unmarked?.has(selected.id) ?? false}
              unread={usage?.unread?.has(selected.id) ?? false}
              unused={usage?.unused?.has(selected.id) ?? false}
              pick={pick}
              lookup={lookup}
              runOf={runOf}
              down={down}
              canAskAgent={canAskAgent}
              canEdit={canEdit}
              onEdit={() => setEditing(selected.id)}
              onSelect={open}
              onRefresh={refresh}
              onConnect={connect}
              {...(onAskWhy === undefined ? {} : { onAskWhy })}
              onNoticeGone={steps.focusBack}
            />
          </div>
        ) : datasets.length === 0 ? (
          <p className="px-2 py-6 text-center text-[13px] text-fg-muted">{NO_SOURCES_MESSAGE}</p>
        ) : (
          <ul aria-label={SOURCES_LABEL} className="m-0 flex list-none flex-col gap-0.5 p-0">
            {groups.map((group) => {
              const rows = group.rows.map((dataset) => (
                <SourceRow
                  key={dataset.id}
                  ds={dataset}
                  run={runOf(dataset.id)}
                  now={now}
                  unasked={!requested.includes(dataset.id)}
                  down={down}
                  canAskAgent={canAskAgent}
                  rowRef={steps.row(dataset.id)}
                  onOpen={open}
                  onConnect={connect}
                  onRefresh={refresh}
                />
              ));
              if (group.name === '') return rows;
              return (
                <li key={group.key} data-source-group="" className="relative flex flex-col">
                  <div className="flex min-h-7 items-center gap-2 pr-1 pl-2 whitespace-nowrap">
                    <span className="min-w-0 truncate py-1 text-xs font-semibold text-fg" title={group.name}>
                      {group.name}
                    </span>
                  </div>
                  <ul aria-label={group.label} className="m-0 mt-0.5 flex list-none flex-col gap-0.5 p-0">
                    {rows}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {selected === undefined && datasets.length > 0 ? <RefreshDataRow canChange={canEdit} /> : null}
      {edited === undefined ? null : isFileDataset(edited) ? (
        <FileEditorDialog key={edited.id} ds={edited} onClose={closeEditor} />
      ) : edited.source.kind === 'query' ? (
        <QueryEditorDialog key={edited.id} ds={edited} now={now} params={params} onClose={closeEditor} />
      ) : null}
    </section>
  );
}
