import { ArtifactError, type SheetCapability } from '@open-artifact/runtime/capabilities';
import type { JsonObject, SheetFrame, SheetReadRequest, SheetSendRequest, SnapshotFrame, WidgetRequest } from '@open-artifact/runtime/sheet-api';

/** One call to the server's `sheet` routes. */
export type StoreCall =
  | { route: 'read'; request: SheetReadRequest }
  | { route: 'send'; request: SheetSendRequest }
  | { route: 'widget'; request: WidgetRequest };

/** What became of a call: the server's answer (a refusal among them), or why there is none. */
export type StoreOutcome = { kind: 'answered'; answer: JsonObject } | { kind: 'notSent' } | { kind: 'mayNotHaveArrived' };

export type StreamEndReason = { kind: 'notInsideHost' } | { kind: 'couldNotConnect' } | { kind: 'closedByPage' };

export type StreamEvent =
  | { kind: 'opened' }
  | { kind: 'frame'; frame: SheetFrame }
  | { kind: 'reconnecting' }
  | { kind: 'ended'; reason: StreamEndReason };

export interface SheetStream {
  /** Makes one call; a call made while another is unanswered, or before the stream opened, is not sent. */
  call(call: StoreCall): Promise<StoreOutcome>;
  /** Stops waiting for the call in flight: it settles as one that may not have arrived. */
  giveUpOnCallInFlight(): void;
  /** Asks again for a stream the server is not answering now. */
  retryNow(): void;
  close(): void;
}

export interface SheetStreamOptions {
  onEvent(event: StreamEvent): void;
}

/** The connection to the server's `sheet` capability, as the page's store sees it. */
export type SheetChannel = Pick<SheetCapability, 'read' | 'send' | 'widget' | 'onFrame'>;

const CONNECT_TIMEOUT_MS = 60_000;
const CALL_TIMEOUT_MS = 20_000;

function errorAnswer(error: unknown): StoreOutcome {
  if (!(error instanceof ArtifactError) || error.code === 'unavailable') return { kind: 'mayNotHaveArrived' };
  return { kind: 'answered', answer: { kind: 'refused', refusal: error.code === 'not_writer' ? 'notWriter' : error.code } };
}

/**
 * Opens the page's stream of a Sheet. A snapshot frame opens it (and opens it again after the connection came back);
 * while one of the page's own edits is unanswered, the frames that arrive are held and told after its answer, so the
 * page hears what became of its edit before the edits made after it.
 */
export function openSheetStream(channel: Promise<SheetChannel | null>, { onEvent }: SheetStreamOptions): SheetStream {
  let phase: 'connecting' | 'open' | 'reconnecting' | 'ended' = 'connecting';
  let sheet: SheetChannel | null = null;
  let stopHearing: (() => void) | null = null;
  let inFlight: { settle(outcome: StoreOutcome): void; timer: ReturnType<typeof setTimeout>; holdsFrames: boolean } | null = null;
  let held: SheetFrame[] = [];
  let lastTold: { workbookId: string; revision: number } | null = null;

  const end = (reason: StreamEndReason): void => {
    if (phase === 'ended') return;
    phase = 'ended';
    clearTimeout(connectTimer);
    stopHearing?.();
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('online', onOnline);
    settleInFlight({ kind: 'mayNotHaveArrived' });
    held = [];
    onEvent({ kind: 'ended', reason });
  };

  const isNothingNew = (snapshot: SnapshotFrame): boolean =>
    phase === 'open' && lastTold !== null && lastTold.workbookId === snapshot.workbookId && lastTold.revision === snapshot.revision;

  const tell = (frame: SheetFrame): void => {
    if (frame.phase === 'snapshot') {
      if (isNothingNew(frame)) return;
      clearTimeout(connectTimer);
      window.removeEventListener('online', onOnline);
      phase = 'open';
      lastTold = { workbookId: frame.workbookId, revision: frame.revision };
      onEvent({ kind: 'opened' });
    } else if (frame.phase === 'edit' && lastTold !== null) {
      lastTold = { ...lastTold, revision: Math.max(lastTold.revision, frame.revision) };
    }
    if (phase === 'open') onEvent({ kind: 'frame', frame });
  };

  const isHolding = (): boolean => inFlight?.holdsFrames === true || held.length > 0;

  const hear = (frame: SheetFrame): void => {
    if (phase === 'ended') return;
    if (isHolding()) held.push(frame);
    else tell(frame);
  };

  const tellHeld = (): void => {
    if (inFlight?.holdsFrames) return;
    const frames = held;
    held = [];
    for (const frame of frames) if (phase !== 'ended') tell(frame);
  };

  function settleInFlight(outcome: StoreOutcome): void {
    if (inFlight === null) return;
    const { settle, timer, holdsFrames } = inFlight;
    clearTimeout(timer);
    inFlight = null;
    settle(outcome);
    if (holdsFrames) setTimeout(tellHeld, 0);
  }

  const askSnapshot = (): void => {
    if (sheet === null || phase === 'ended') return;
    void sheet.read({ kind: 'snapshot' }).then(
      (snapshot) => {
        if ('phase' in snapshot) hear(snapshot);
      },
      () => undefined,
    );
  };

  // While the connection is down the page waits for a snapshot, even one at the revision it already has.
  const onOffline = (): void => {
    if (phase !== 'open') return;
    phase = 'reconnecting';
    window.addEventListener('online', onOnline);
    onEvent({ kind: 'reconnecting' });
  };

  const onOnline = (): void => askSnapshot();

  const connectTimer = setTimeout(() => end({ kind: 'couldNotConnect' }), CONNECT_TIMEOUT_MS);
  window.addEventListener('offline', onOffline);

  void channel.then(
    (found) => {
      if (phase === 'ended') return;
      if (found === null) return end({ kind: 'notInsideHost' });
      sheet = found;
      stopHearing = found.onFrame(hear);
      // The stream may have opened before we listened: ask for the snapshot ourselves.
      askSnapshot();
    },
    () => end({ kind: 'notInsideHost' }),
  );

  const send = (call: StoreCall, target: SheetChannel): Promise<JsonObject> => {
    switch (call.route) {
      case 'read':
        return target.read(call.request);
      case 'send':
        return target.send(call.request);
      case 'widget':
        return target.widget(call.request);
    }
  };

  return {
    call(call) {
      if (phase !== 'open' || sheet === null || inFlight !== null) return Promise.resolve({ kind: 'notSent' });
      const target = sheet;
      return new Promise<StoreOutcome>((settle) => {
        const timer = setTimeout(() => settleInFlight({ kind: 'mayNotHaveArrived' }), CALL_TIMEOUT_MS);
        const mine = { settle, timer, holdsFrames: call.route === 'send' };
        inFlight = mine;
        send(call, target).then(
          (answer) => {
            if (inFlight === mine) settleInFlight({ kind: 'answered', answer });
          },
          (error: unknown) => {
            if (inFlight === mine) settleInFlight(errorAnswer(error));
          },
        );
      });
    },
    giveUpOnCallInFlight: () => settleInFlight({ kind: 'mayNotHaveArrived' }),
    retryNow() {
      if (phase === 'open' || phase === 'reconnecting') askSnapshot();
    },
    close: () => end({ kind: 'closedByPage' }),
  };
}
