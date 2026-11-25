import type { ClockFrame, EditFrame, Json } from '@open-artifact/runtime/sheet-api';
import { isRecord, isUint32 } from './json.ts';
import { madeAtUnixSeconds, type SheetState } from './sheet-state.ts';

export interface ClockReading {
  unixMilliseconds: number;
  utcOffsetInMinutes: number;
  timeZone: string | null;
}

/** An edit as the engine hears it streamed (`receiveStreamedEdit`), and what the page shows of who made it. */
export interface StreamedEdit {
  revision: number;
  applied: { node: string; v: number; base: number; ops: Json[] };
  isOfLayoutAlone: boolean;
  isByAgent: boolean;
  madeUnder: string | null;
}

/** A workbook made in the last three minutes (its first sheet is shown as the agent's work as it opens). */
export function isSheetJustMade(state: SheetState, clock: ClockReading | null, elapsedMs: number, nowUnixMilliseconds: number): boolean {
  const madeAt = madeAtUnixSeconds(state);
  if (madeAt === null) return false;
  const ageSeconds = (clock === null ? nowUnixMilliseconds : clock.unixMilliseconds + Math.max(0, elapsedMs)) / 1000 - madeAt;
  const earliestAge = clock === null ? -JUST_MADE_WINDOW_SECONDS : 0;
  return ageSeconds >= earliestAge && ageSeconds < JUST_MADE_WINDOW_SECONDS;
}

export function readClockFrame({ unixMilliseconds, utcOffsetInMinutes, timeZone }: ClockFrame): ClockReading | null {
  if (!(Number.isSafeInteger(unixMilliseconds) && Number.isSafeInteger(utcOffsetInMinutes) && (timeZone === null || typeof timeZone === 'string')))
    return null;
  return { unixMilliseconds, utcOffsetInMinutes, timeZone };
}

export function readStreamedEdit(frame: EditFrame, nodeId: string): StreamedEdit | null {
  if (!isUint32(frame.revision) || !isUint32(frame.v) || !Array.isArray(frame.ops)) return null;
  const { ops, actor } = frame;
  return {
    revision: frame.revision,
    applied: { node: nodeId, v: frame.v, base: frame.base, ops },
    isOfLayoutAlone: ops.length > 0 && ops.every((op) => isRecord(op) && LAYOUT_OP_KINDS.has(op.kind)),
    isByAgent: actor?.isAgent === true,
    madeUnder: typeof actor?.personId === 'string' ? actor.personId : null,
  };
}

export const JUST_MADE_WINDOW_SECONDS = 180;

export const LAYOUT_OP_KINDS: ReadonlySet<unknown> = new Set(['setColumnWidths', 'setRowHeights', 'setSheetSettings']);
