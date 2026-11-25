import { doesChartKindSuitRows, isNumberValuedCell, isYearValuedCell } from './chart-kind-fit.ts';
export { doesChartKindSuitRows, isNumberValuedCell, isYearValuedCell };
import type { WidgetRequest } from '@open-artifact/runtime/sheet-api';
import { answerOf, isRetryableFailure, refusalOf } from '../store/requests.ts';
import { isRecord } from '../store/json.ts';
import type { StoreCall, StoreOutcome } from '../store/sheet-stream.ts';
import { STOCK_CHART_PROGRAMS, STOCK_KINDS, type StockKind } from './stock-programs.ts';
import type { ChartEditAsked } from '../state/event-reducer.ts';
import type { ChartEditOutcome } from '../state/controller.ts';
import type { ChartChangeOutcome } from '../messages/charts.ts';
/** A widget's code and how many times it was published, from a read of it. */
export function readWidgetSource(outcome: StoreOutcome): { code: string; pub: number } | null {
  const widget = answerOf(outcome)?.widget;
  return isRecord(widget) && typeof widget.code === 'string' && typeof widget.pub === 'number' ? { code: widget.code, pub: widget.pub } : null;
}

/** The widget a create made: published, left behind unpublished (its code was refused), or not made at all. */
export function readMadeWidget(outcome: StoreOutcome): { nodeId: string } | { leftBehind: string } | 'notMade' {
  const widget = answerOf(outcome)?.widget;
  if (!isRecord(widget) || typeof widget.id !== 'string') return 'notMade';
  return Array.isArray(widget.errors) && widget.errors.length === 0 ? { nodeId: widget.id } : { leftBehind: widget.id };
}

export interface ChartWidgetNodesDeps {
  newOpId(): string;
  wait(ms: number): Promise<void>;
  nameOfKind(kind: string): string;
}

/** A kept change to a chart: the node its view shows now, the node to show instead, and how many times the first had been published when the change was asked. */
export interface ChartNodeSwap {
  from: string;
  to: string;
  pubOfFrom: number;
}

/** Asks the page to edit the workbook for a chart. */
export type AskForEditOfChart = (asked: ChartEditAsked) => Promise<ChartEditOutcome>;

export type ChartWidgetNodes = ReturnType<typeof createChartWidgetNodes>;

export function createChartWidgetNodes(deps: ChartWidgetNodesDeps) {
  let workbook: { call(call: StoreCall): Promise<StoreOutcome> } | null = null;
  const send = (request: WidgetRequest): Promise<StoreOutcome> =>
    workbook === null ? Promise.resolve({ kind: 'notSent' }) : workbook.call({ route: 'widget', request });
  const read = async (id: string, isWorthRetrying = isWidgetReadWorthRetrying, roundsLeft = WIDGET_READ_ROUNDS): Promise<StoreOutcome> => {
    const outcome = await send({ verb: 'read', id });
    if (!isWorthRetrying(outcome) || roundsLeft === 1) return outcome;
    await deps.wait(WIDGET_READ_RETRY_MS);
    return read(id, isWorthRetrying, roundsLeft - 1);
  };
  const sourceOf = async (nodeId: string) => readWidgetSource(await read(nodeId));
  const deleteNode = async (nodeId: string, roundsLeft = WIDGET_DELETE_ROUNDS): Promise<void> => {
    if (isWidgetDeleteSettled(await send({ verb: 'delete', id: nodeId })) || roundsLeft === 1) return;
    await deps.wait(WIDGET_DELETE_RETRY_MS);
    await deleteNode(nodeId, roundsLeft - 1);
  };
  const createNode = (code: string): Promise<StoreOutcome> => {
    const request: WidgetRequest = { verb: 'create', opId: deps.newOpId(), code };
    const tryCreate = async (roundsLeft = WIDGET_CREATE_ROUNDS): Promise<StoreOutcome> => {
      const outcome = await send(request);
      if (!isWidgetCreateWorthRetrying(outcome) || roundsLeft === 1) return outcome;
      await deps.wait(WIDGET_CREATE_RETRY_MS);
      return tryCreate(roundsLeft - 1);
    };
    return tryCreate();
  };
  const readMade = (outcome: StoreOutcome): { nodeId: string } | 'notMade' | 'refused' => {
    const made = readMadeWidget(outcome);
    if (typeof made === 'string' || 'nodeId' in made) return made;
    void deleteNode(made.leftBehind);
    return 'refused';
  };
  return {
    get isToBeHad(): boolean {
      return workbook !== null;
    },
    workbookOpened(opened: { call(call: StoreCall): Promise<StoreOutcome> }): void {
      workbook = opened;
    },
    sourceOf,
    makePreview: async (code: string) => readMade(await createNode(code)),
    async copyOf(nodeId: string) {
      const outcome = await read(nodeId, (answer) => answer.kind !== 'mayNotHaveArrived' && isWidgetReadWorthRetrying(answer));
      const source = readWidgetSource(outcome);
      if (source === null) return whyNoWidgetCopy(outcome);
      const created = await createNode(source.code);
      const made = readMade(created);
      return typeof made === 'string' ? whyNoWidgetCopy(created) : made;
    },
    pointAt: async (viewId: string, swap: ChartNodeSwap, pointChart: AskForEditOfChart): Promise<ChartChangeOutcome> => {
      const { from, to, pubOfFrom } = swap;
      const fromSource = await sourceOf(from);
      if (fromSource === null) return 'notPointed';
      if (fromSource.pub !== pubOfFrom) return 'showsAnother';
      const fromKind = stockKindOfChartCode(fromSource.code);
      const toSource = fromKind === null ? null : await sourceOf(to);
      if (fromKind !== null && toSource === null) return 'notPointed';
      const toKind = toSource === null ? null : stockKindOfChartCode(toSource.code);
      const renaming = fromKind === null || toKind === null ? null : { from: deps.nameOfKind(fromKind), to: deps.nameOfKind(toKind) };
      const pointed = await pointChart({ kind: 'pointAtOtherNode', viewId, from, to, renaming });
      return pointed === 'full' || pointed === 'notMade' ? 'notPointed' : pointed;
    },
    discard: (nodeId: string): void => void deleteNode(nodeId),
  };
}

/** Refusals that stay whatever the page does. */
export const TURNED_AWAY_REFUSALS: ReadonlySet<string> = new Set(['notWriter', 'unreadableRequest', 'unknownVerb', 'tooLarge']);

const isTurnedAway = (outcome: StoreOutcome): boolean => {
  const refusal = refusalOf(outcome);
  return refusal !== null && TURNED_AWAY_REFUSALS.has(refusal);
};

/** A delete that need not be sent again: done, or refused for a reason that stays. */
export const isWidgetDeleteSettled = (outcome: StoreOutcome): boolean => outcome.kind === 'answered' && refusalOf(outcome) !== 'unavailable';

export const isWidgetReadWorthRetrying = (outcome: StoreOutcome): boolean =>
  outcome.kind !== 'answered' || refusalOf(outcome) === 'unavailable' || refusalOf(outcome) === 'internal';

export const isWidgetCreateWorthRetrying = (outcome: StoreOutcome): boolean => outcome.kind === 'notSent' || (refusalOf(outcome) === 'unavailable' && !isTurnedAway(outcome));

export const whyNoWidgetCopy = (outcome: StoreOutcome): 'notNow' | 'never' => (isRetryableFailure(outcome) ? 'notNow' : 'never');

export const WIDGET_DELETE_ROUNDS = 3;
export const WIDGET_DELETE_RETRY_MS = 2000;
export const WIDGET_CREATE_ROUNDS = 3;
export const WIDGET_CREATE_RETRY_MS = 1000;
export const WIDGET_READ_ROUNDS = 3;
export const WIDGET_READ_RETRY_MS = 1000;
export const stockKindOfChartCode = (code: string): StockKind | null =>
  STOCK_KINDS.find((kind) => STOCK_CHART_PROGRAMS[kind].trim() === code.trim()) ?? null;
export const STOCK_CHART_KINDS: readonly StockKind[] = STOCK_KINDS;
