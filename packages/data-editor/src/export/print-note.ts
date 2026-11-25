/**
 * The line printed under the dashboard: how old its data is, and whether any of it is missing. A printed page can't
 * show the Sources panel or the toolbar's freshness, so this says it on paper.
 */

import type { Dataset, DatasetRun } from '@open-artifact/data-core';
import { getDatasetUpdatedAt } from '../data/status.ts';
import { getLastSuccessfulRun, getRunTable } from '../data/query-store.ts';

/** Marks the note's element, which the print rules show while everything else around the page is hidden. */
export const PRINT_NOTE_ATTRIBUTE = 'data-dash-print-note';

const printedDate = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export const dataAsOfSentence = (at: number): string => `Data as of ${printedDate.format(new Date(at))}.`;
export const MISSING_DATA_SENTENCE = 'Some data didn’t load.';

/**
 * The note for the sources the page uses. The date is the oldest of their loads, and only when every source that
 * loaded can say when; a source that hasn't loaded, failed, or was cut short adds the missing-data sentence. Empty
 * when there is nothing to say.
 */
export function getPrintDataNote(used: readonly Dataset[], runOf: (id: string) => DatasetRun): string {
  const loaded = used.filter((dataset) => getLastSuccessfulRun(runOf(dataset.id)) !== null);
  const times = loaded.map((dataset) => getDatasetUpdatedAt(dataset, runOf(dataset.id)));
  const dated = times.length > 0 && times.every((at): at is number => at !== null);
  const missing = used.some((dataset) => {
    const run = runOf(dataset.id);
    return run.status !== 'ok' || getRunTable(run)?.cut !== undefined;
  });
  const sentences = [dated ? dataAsOfSentence(Math.min(...(times as number[]))) : '', missing ? MISSING_DATA_SENTENCE : ''];
  return sentences.filter((sentence) => sentence !== '').join(' ');
}
