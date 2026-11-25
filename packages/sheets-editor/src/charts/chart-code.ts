import { widgetProjectionRequest, readCompiledWidget } from '../store/requests.ts';
import type { StreamListener } from '../store/sheet-connection.ts';
import { failureOf } from '../store/workbook-node.ts';
import { syncRetryDelayMs } from '../store/workbook-sync.ts';
/** Why a chart has no code to draw with. */
export type WhyNoChartCode = 'notPublished' | 'notCompiled' | 'notFetched' | 'tookCaret' | 'anotherTookCaret' | 'tookTooLong';
/** The code a chart draws with, as far as the page knows it. */
export type ChartCode = { kind: 'compiled'; artifact: string } | { kind: 'awaited' } | { kind: 'none'; why: WhyNoChartCode };
/** What a drawn chart reads its code from and tells about it. */
export interface ChartCodeSource {
  of(chartId: string): ChartCode;
  follow(chartId: string, listener: () => void): () => void;
  tookCaret(chartId: string): void;
  tookTooLong(chartId: string): void;
}
export interface ChartCodeStore extends ChartCodeSource, Required<StreamListener> {
  isAsked(chartId: string): boolean;
}
export interface ChartCodeHost {
  newOpId: () => string;
  wait(ms: number): Promise<void>;
}
type OpenedStream = Parameters<Required<StreamListener>['streamOpened']>[0];
interface ChartCodeEntry {
  code: ChartCode;
  listeners: Set<() => void>;
  timesPublished: number | null;
  answeredAt: 'never' | number | null;
  isAsked: boolean;
}
export function createChartCodeStore(host: ChartCodeHost): ChartCodeStore {
  const chartsById = new Map<string, ChartCodeEntry>();
  let stream: OpenedStream | null = null;
  let streamCount = 0;
  let noAnswerCount = 0;
  let caretChartId: string | null = null;
  const codeTimedOut = new Map<string, string>();
  const entryOf = (chartId: string): ChartCodeEntry => {
    const existing = chartsById.get(chartId);
    if (existing !== undefined) return existing;
    const entry: ChartCodeEntry = {
      code: CHART_CODE_AWAITED,
      listeners: new Set(),
      timesPublished: null,
      answeredAt: 'never',
      isAsked: false,
    };
    chartsById.set(chartId, entry);
    return entry;
  };
  const setCode = (chartId: string, entry: ChartCodeEntry, code: ChartCode) => {
    const offCode = chartId === caretChartId ? CHART_CODE_OFF_TOOK_CARET : CHART_CODE_OFF_ANOTHER_TOOK_CARET;
    entry.code = code.kind === 'compiled' && caretChartId !== null ? offCode : code;
    for (const listener of entry.listeners) listener();
  };
  const askForCode = async (chartId: string, tryIndex = 0): Promise<ChartCode | 'notSent' | null> => {
    const isGivingUp = tryIndex >= MAX_CHART_CODE_TRIES || noAnswerCount >= MAX_CHART_CODE_NO_ANSWERS;
    if (stream === null) return 'notSent';
    if (isGivingUp) return null;
    const { call, noteFailure } = stream;
    const sent = await call(widgetProjectionRequest(chartId));
    const answer = readCompiledWidget(sent);
    const failure = failureOf(sent, answer.kind !== 'refused');
    if (failure !== null)
      noteFailure({
        ...failure,
        action: 'loadChart',
      });
    if (answer.kind === 'noAnswer') noAnswerCount += 1;
    else if (sent.kind === 'answered') noAnswerCount = 0;
    if (answer.kind === 'compiled') return answer;
    if (answer.kind === 'notPublished' || answer.kind === 'notCompiled')
      return {
        kind: 'none',
        why: answer.kind,
      };
    if (answer.kind === 'notSent') return 'notSent';
    if (answer.kind === 'refused') return null;
    await host.wait(syncRetryDelayMs(tryIndex));
    return askForCode(chartId, tryIndex + 1);
  };
  const askIfStale = async (chartId: string, entry: ChartCodeEntry): Promise<void> => {
    const isStale = entry.answeredAt === 'never' || entry.answeredAt !== entry.timesPublished;
    if (entry.isAsked || entry.listeners.size === 0 || !isStale) return;
    entry.isAsked = true;
    const [timesPublished, streamCountBefore] = [entry.timesPublished, streamCount];
    const code = await askForCode(chartId);
    entry.isAsked = false;
    if (code === 'notSent' || code === null) {
      const isOff = [CHART_CODE_OFF_TOOK_CARET, CHART_CODE_OFF_ANOTHER_TOOK_CARET, CHART_CODE_OFF_TOOK_TOO_LONG].includes(entry.code);
      if (code === null && entry.code.kind !== 'compiled' && !isOff)
        setCode(chartId, entry, {
          kind: 'none',
          why: 'notFetched',
        });
      if (streamCount !== streamCountBefore) askIfStale(chartId, entry);
      return;
    }
    entry.answeredAt = timesPublished;
    setCode(chartId, entry, code);
    askIfStale(chartId, entry);
  };
  const forgiveNoAnswers = () => {
    noAnswerCount = Math.min(noAnswerCount, MAX_CHART_CODE_NO_ANSWERS - 1);
  };
  return {
    of: (chartId) => chartsById.get(chartId)?.code ?? CHART_CODE_AWAITED,
    isAsked: (chartId) => chartsById.get(chartId)?.isAsked ?? false,
    follow(chartId, listener) {
      const entry = entryOf(chartId);
      entry.listeners.add(listener);
      forgiveNoAnswers();
      askIfStale(chartId, entry);
      return () => void entry.listeners.delete(listener);
    },
    tookCaret(chartId) {
      caretChartId ??= chartId;
      for (const [otherChartId, entry] of chartsById) if (entry.code.kind === 'compiled') setCode(otherChartId, entry, entry.code);
    },
    tookTooLong(chartId) {
      const entry = chartsById.get(chartId);
      if (entry?.code.kind !== 'compiled') return;
      const { artifact: code } = entry.code;
      if (codeTimedOut.get(chartId) === code) setCode(chartId, entry, CHART_CODE_OFF_TOOK_TOO_LONG);
      codeTimedOut.set(chartId, code);
    },
    streamOpened(openedStream) {
      stream = openedStream;
      streamCount += 1;
      for (const [chartId, entry] of chartsById) askIfStale(chartId, entry);
    },
    publishedTimes(chartId, timesPublished) {
      const entry = entryOf(chartId);
      if (entry.timesPublished !== timesPublished) forgiveNoAnswers();
      entry.timesPublished = timesPublished;
      askIfStale(chartId, entry);
    },
  };
}
export function waitForChartCode(
  chartCode: Pick<ChartCodeStore, 'of' | 'isAsked' | 'follow'>,
  chartId: string,
  setTimer: (ms: number, onTime: () => void) => void,
): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    let stopFollowing: (() => void) | null = null;
    const settle = (isTimedOut = false) => {
      const code = chartCode.of(chartId);
      if ((code.kind === 'awaited' || chartCode.isAsked(chartId)) && !isTimedOut) return;
      stopFollowing?.();
      resolve(code.kind === 'compiled' ? code.artifact : null);
    };
    stopFollowing = chartCode.follow(chartId, settle);
    setTimer(CHART_CODE_WAIT_MS, () => settle(true));
    settle();
  });
}
export const CHART_CODE_AWAITED: ChartCode = {
  kind: 'awaited',
};
export const CHART_CODE_OFF_TOOK_CARET: ChartCode = {
  kind: 'none',
  why: 'tookCaret',
};
export const CHART_CODE_OFF_ANOTHER_TOOK_CARET: ChartCode = {
  kind: 'none',
  why: 'anotherTookCaret',
};
export const CHART_CODE_OFF_TOOK_TOO_LONG: ChartCode = {
  kind: 'none',
  why: 'tookTooLong',
};
export const MAX_CHART_CODE_NO_ANSWERS = 3;
export const MAX_CHART_CODE_TRIES = 5;
export const CHART_CODE_WAIT_MS = 1e4;
