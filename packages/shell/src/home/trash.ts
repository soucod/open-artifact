/**
 * The cloud home page's Trash: what it lists and what each row offers. Pure: no DOM, no store.
 *
 * The host lists trashed artifacts with `GET artifacts?trashed=1` (the person's own: a trashed artifact is gone for
 * everyone it was shared with; only its owner brings it back or deletes it for good). `artifacts.restore` takes one out
 * of the trash; `artifacts.purge` deletes it for good, or answers 501 on a host that cannot (the page then stops
 * offering it).
 *
 * Two things the host says (an older one may not) and the page uses when it does: `trashedAt` on a trashed artifact's
 * view (else the row says when it last changed, which is not the same), and how many days the trash keeps things
 * (`trashDays` in the home boot: 0 keeps them until their owner deletes them).
 */

import type { ArtifactView } from '@open-artifact/protocol';
import type { Said } from './upload.ts';

/** An artifact as the trash list shows it, with the trash time when the host gives one (`ArtifactView.trashedAt`). */
export type TrashedView = ArtifactView;

/** One row of the Trash view. */
export interface TrashRow {
  id: string;
  title: string;
  typeTitle: string;
  /** When it went to the trash (`trashed`), or, when the host does not say, when it last changed (`changed`). */
  when: { kind: 'trashed' | 'changed'; at: string };
  /** The person may bring it back and delete it for good: it is theirs. */
  mine: boolean;
}

/** The rows of the Trash view, most recently trashed (or changed) first. */
export function trashRows(list: readonly TrashedView[]): TrashRow[] {
  return list
    .map((a): TrashRow => ({
      id: a.id,
      title: a.title,
      typeTitle: a.typeTitle,
      when: typeof a.trashedAt === 'string' && a.trashedAt ? { kind: 'trashed', at: a.trashedAt } : { kind: 'changed', at: a.updatedAt },
      mine: a.role === undefined || a.role === 'owner',
    }))
    .sort((x, y) => (Date.parse(y.when.at) || 0) - (Date.parse(x.when.at) || 0));
}

/** How long the trash keeps things, in words, or `null` when the host does not say. */
export function keepNote(days: number | undefined): Said | null {
  if (days === undefined || !Number.isInteger(days) || days < 0) return null;
  if (days === 0) return { key: 'trashKeptForever' };
  return days === 1 ? { key: 'trashKeptOneDay' } : { key: 'trashKeptDays', vars: { days } };
}

/** Whether "Delete forever" is still offered: not after the host said it cannot (501), and only for one's own. */
export function offersPurge(row: Pick<TrashRow, 'mine'>, purgeUnsupported: boolean): boolean {
  return row.mine && !purgeUnsupported;
}

/** What a failed purge means: the host cannot (stop offering it, say nothing more), or a failure to show. */
export function purgeOutcome(status: number, message: string): { unsupported: true } | { unsupported: false; said: Said } {
  if (status === 501) return { unsupported: true };
  if (status === 409) return { unsupported: false, said: { key: 'purgeNotTrashed' } };
  if (status === 404) return { unsupported: false, said: { key: 'purgeGone' } };
  return { unsupported: false, said: { key: 'couldNotPurge', vars: { error: message || `HTTP ${status}` } } };
}
