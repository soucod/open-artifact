/**
 * What the agent learns of this viewer's page: the view context in presence
 * (what is shown, the filters, the open source), the run report
 * (`data/users/<me>/runs`), the page check after the agent writes
 * (`.../check`) and, during its turn, the page as shown (`.../page`).
 * Also which check notice shows above the page.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WORKING_GRACE_MS } from '../platform/agent-activity.ts';
import { useDashboardPresence } from '../platform/presence.ts';
import {
  createRunReporter,
  getPageCheckNotice,
  mergeCheckOutput,
  usePageCheck,
  useShownPageReport,
  type PageCheckNotice,
} from '../page/check.ts';
import { buildDashboardRunReport, getChangedFilterNames } from '../page/runs.ts';
import { currentPage, readShownPage, type PageSnapshot } from '../page/runtime.ts';
import type { SelectionPoint } from '../page/selection.ts';
import { useEditFlow } from '../drafts/edit-flow.ts';
import { useDatasets } from '../state/datasets.ts';
import { useDocument } from '../state/document.ts';
import { useShown, useShownContent } from '../state/shown.ts';
import { useSourcesUi } from '../state/sources-ui.ts';
import { unruledFilters, type DashboardData } from './data-view.ts';

export interface ViewContextInput {
  data: DashboardData;
  snapshot: PageSnapshot | null;
  /** The data's notice shows above the page (the check notice waits). */
  noticeShown: boolean;
  /** The format picked on the empty page, told to the agent while the picker shows (`null`: not told). */
  form: string | null;
}

export interface ViewContext {
  onLink: (fragment: string) => void;
  /** Where the viewer's selection is, for presence (left out without a room). */
  onPoint: ((point: SelectionPoint | null) => void) | undefined;
  /** The filters changed from the page's defaults. */
  filters: string[];
  notice: PageCheckNotice;
  /** The agent is working on the page since the check began. */
  working: boolean;
  /** Puts the "stopped working" notice away until the page breaks anew. */
  dismiss: () => void;
}

export function useViewContext({ data, snapshot, noticeShown, form }: ViewContextInput): ViewContext {
  const shown = useShownContent();
  const storedFiles = useDocument((state) => state.content.files);
  const status = useDocument((state) => state.status);
  const canWrite = useDocument((state) => state.canWrite);
  const datasets = useDatasets((state) => state.datasets);
  const loading = useDatasets((state) => state.loading);
  const params = useDatasets((state) => state.params);
  const sourcesOpen = useSourcesUi((state) => state.open);
  const selected = useSourcesUi((state) => state.selected);
  const dirty = useEditFlow((state) => state.count > 0);
  const loaded = status === 'ready' || status === 'offline';
  const live = shown.mode === 'live';
  const files = shown.content.files;
  const settled = files.length > 0 && loading.length === 0 && snapshot?.usage != null;
  const sources = useMemo(() => new Map(datasets.map((dataset) => [dataset.id, dataset])), [datasets]);
  const filters = useMemo(() => getChangedFilterNames(shown.content, params), [shown.content, params]);

  const reportRef = useRef<ReturnType<typeof buildDashboardRunReport>>(null);
  reportRef.current =
    snapshot === null ? null : buildDashboardRunReport(data.used, filters, data.runOf, snapshot.marks, snapshot.flagged, snapshot.faults, snapshot.drawingFaults);
  const report = useCallback(() => reportRef.current, []);

  const { onLink, onPoint } = useDashboardPresence({
    loading: !loaded,
    report,
    files,
    sources,
    data: sourcesOpen,
    dirty,
    shown: sourcesOpen ? selected : null,
    filters,
    form,
    draft: shown.mode === 'draft' ? (shown.draftId ?? null) : null,
  });

  const [reporter] = useState(() => createRunReporter());
  useEffect(() => () => reporter.dispose(), [reporter]);
  useEffect(() => {
    if (!loaded || !live || reportRef.current === null) return;
    reporter.report(reportRef.current);
  });

  const unruled = useMemo(() => unruledFilters(data.used), [data.used]);
  const check = usePageCheck(
    {
      files,
      stored: storedFiles,
      faults: snapshot?.faults ?? [],
      on: loaded && canWrite && live,
      settled,
      output: () => {
        const page = currentPage();
        return page === null ? null : mergeCheckOutput(page.snapshot().drawingFaults, page.checkOutput());
      },
      flips: shown.mode === 'draft' ? shown.draftId : null,
      unruled,
      unread: snapshot?.usage?.unread ?? [],
    },
    WORKING_GRACE_MS,
  );

  useShownPageReport({ loaded, on: live, settled, files, filters: params, shown: readShownPage }, { graceMs: WORKING_GRACE_MS });

  const broke = useMemo(() => (snapshot?.broke === true ? JSON.stringify(snapshot.faults) : null), [snapshot?.broke, snapshot?.faults]);
  const [closed, setClosed] = useState<string | null>(null);
  const free = !noticeShown && !(data.loadingVisible && data.firstLoadVisible);
  const notice = live || shown.mode === 'draft' ? getPageCheckNotice({ broke, fixing: check.fixing, closed, free }) : null;
  const dismiss = useCallback(() => setClosed(broke), [broke]);
  const editing = useShown((state) => state.editing);
  return { onLink, onPoint, filters, notice: editing ? null : notice, working: check.working, dismiss };
}
