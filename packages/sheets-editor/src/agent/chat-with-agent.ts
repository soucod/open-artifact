import { isNonNullObject } from '../utils/objects.ts';
import { isViewId } from './view-context.ts';
import { isAskTaken, type AskSentToChat } from '../messages/charts.ts';
import type { ChartKindOrAny } from '../charts/chart-words.ts';
import type { RuleNumber } from '../format/conditional/ask-agent-about-rule.tsx';
import type { SelectionForAgent } from '../state/initial-state.ts';
import type { ErrorsToldToAgent } from './ask-agent-menu.tsx';
/** The room the agent's session is reached through, as the agent gives it. */
type RoomOfAgent = Record<PropertyKey, unknown>;
/** A blank sheet put in the chat. */
interface AboutBlankSheet {
  label: string;
  isSheetBlank: true;
  sheetNumber: number;
}
/** A chart put in the chat. */
export interface AboutChart {
  label: string;
  chartId: string;
  sheetNumber: number;
}
/** A chart sent to the agent with words about it. */
export interface AskAboutChart extends AboutChart {
  request: string;
}
/** A conditional format rule put in the chat. */
export interface AboutRule extends RuleNumber {
  label: string;
  sheetNumber: number;
}
/** Cells put in the chat, labelled by their range. */
export type AboutCells = SelectionForAgent & { label: string };
/** What goes with a press that takes cells to the chat: the person's words, the chart asked for, the errors to fix. */
export interface AskBesidePress extends ErrorsToldToAgent {
  request?: string;
  chartKind?: ChartKindOrAny;
}
/** Cells put in the chat by a press, with what the press was. */
export type WithWhatWasPressed = AskBesidePress & AboutCells & { pressed: string };
/** What the page puts in the chat with the agent. */
export type ChatPayload = AboutBlankSheet | AboutChart | AskAboutChart | AboutRule | AboutCells | WithWhatWasPressed;
/** How a payload goes to the session: sent, or left for the person to send; and whether the page's presence goes with it. */
interface SendOptions {
  deliver?: 'send' | 'stage';
  attachPresence?: false;
}
/** A payload as one who hears of it reads it: any of the fields a payload may have, each of which may be missing. */
export type ChatPayloadHeard = Partial<AboutBlankSheet & AskAboutChart & AboutRule & WithWhatWasPressed>;
/** What of a payload tells which cells a press took to the chat. */
type PressedCellsHeard = Pick<ChatPayloadHeard, 'sheetNumber' | 'range' | 'pressed'>;
/** Hears a press the agent refused: what was sent, and whether keys were kept off the cells meanwhile. */
export type PressRefusedListener = (payload: ChatPayloadHeard, wereKeysKeptOff: boolean) => void;
/** Keeps keys off the cells while the chat takes them; the release says whether keys were kept off. */
export type KeepKeysOffCells = () => (isDone?: boolean) => boolean;
/** Why the chat looks again whether the agent can be reached. */
type LookKind = 'first' | 'later' | 'forWork';
/** A look planned for later; a newer plan takes its place. */
interface ScheduledLook {
  is: LookKind;
}
/** A hold on summoning the agent, known only by its identity. */
type SummonHold = Record<never, never>;
/** The words of a send about a chart: its label, the chart, its sheet and the person's words. */
export type ChartSendArgs = [label: string, chartId: string, sheetNumber: number, askWords: string];
/** A send about a chart still on its way, and what came of it. */
interface ChartSendInFlight {
  chartId: string;
  became: Promise<AskSentToChat>;
}
/** The chat with the agent beside the page, as the page takes things to it. */
export interface ChatWithAgent {
  /** Whether the agent can be reached in the chat; null while that is not known. */
  isToBeHad(): boolean | null;
  isBesidePage(): boolean;
  isKeptFromLeaving(): boolean;
  subscribe(listener: () => void): () => void;
  look(): Promise<void>;
  openAboutBlankSheet(label: string, sheetNumber: number): Promise<boolean>;
  openAboutChart(label: string, chartId: string, sheetNumber: number): Promise<boolean>;
  openAboutRule(label: string, rule: RuleNumber & { sheetNumber: number }): Promise<boolean>;
  openAboutCells(cells: SelectionForAgent): Promise<boolean>;
  openWithWhatWasPressed(label: string, cells: SelectionForAgent, pressed: string, ask: AskBesidePress): Promise<boolean>;
  onPressRefused(listener: PressRefusedListener): () => void;
  takesWordsAtOnce(): boolean;
  sendAboutChart(...send: ChartSendArgs): Promise<AskSentToChat>;
  sendPressAboutChart(...send: ChartSendArgs): Promise<AskSentToChat>;
}
export async function askCanSendToAgentSession(room: RoomOfAgent | null): Promise<unknown> {
  let canSend = room?.canSendToAgentSession;
  if (typeof canSend !== 'function') return null;
  try {
    return await canSend.call(room);
  } catch (fault) {
    let code = isNonNullObject(fault) ? fault.code : null;
    return code === 'capability_removed' || code === 'invalid_argument' ? null : 'rejected';
  }
}
export function createChatWithAgent(
  getAgent: () => unknown,
  reportFault: (fault: unknown) => void,
  leavingLosesWork: () => boolean,
  sleep: (ms: number) => Promise<void> = (ms: number) => new Promise<void>((resolve) => void setTimeout(resolve, ms)),
  keepKeysOffCells: KeepKeysOffCells = () => () => false,
  hasUserActivation: boolean = 'userActivation' in MessageEvent.prototype,
): ChatWithAgent {
  let room: RoomOfAgent | null = null;
  let toBeHad: boolean | null = null;
  let isNotBeside = false;
  let availableIfSummoned = false;
  let summonHold: SummonHold | null = null;
  let lookNumber = 0;
  let lookApplied = 0;
  let changeCount = 0;
  let scheduledLook: ScheduledLook | null = null;
  let lookAgainIndex = 0;
  let subscribers = new Set<() => void>();
  let pressRefusedListeners = new Set<PressRefusedListener>();
  let notifyPressRefused = (payload: ChatPayload, wereKeysKeptOff: boolean) => {
    for (let listener of pressRefusedListeners)
      try {
        listener(payload, wereKeysKeptOff);
      } catch {
        reportFault(Error('onPressRefused fault'));
      }
  };
  let takesWords = false;
  let setToBeHad = (isToBeHad: boolean | null) => {
    if (isToBeHad === true) {
      if (scheduledLook?.is !== 'forWork') scheduledLook = null;
      lookAgainIndex = 0;
    }
    let takesWordsNow = isToBeHad === true && !isNotBeside && hasUserActivation;
    if (isToBeHad === toBeHad && takesWordsNow === takesWords) return;
    if (isToBeHad !== null && isToBeHad !== toBeHad) changeCount += 1;
    toBeHad = isToBeHad;
    takesWords = takesWordsNow;
    for (let subscriber of subscribers) subscriber();
  };
  let dropAfterSilence = async (): Promise<void> => {
    let changeAtStart = changeCount;
    await sleep(CHAT_SEND_TIMEOUT_MS);
    if (changeAtStart !== changeCount) return;
    setToBeHad(false);
    planNextLook(false);
  };
  let openRoom = async (agent: unknown): Promise<RoomOfAgent | null> => {
    try {
      let use = isNonNullObject(agent) ? agent.use : null;
      let roomCapability: unknown = typeof use === 'function' ? await use.call(agent, 'room') : null;
      return isNonNullObject(roomCapability) && roomCapability.available !== false ? roomCapability : null;
    } catch {
      reportFault(Error('agent.use fault: room'));
      return null;
    }
  };
  let look = async (dropsWhenUnavailable: boolean, isForWork: boolean = false): Promise<void> => {
    lookNumber += 1;
    let thisLook = lookNumber;
    let openedRoom = await openRoom(getAgent());
    if (thisLook === lookNumber) room = openedRoom;
    let sendState = await askCanSendToAgentSession(openedRoom);
    if (thisLook < lookApplied) return;
    lookApplied = thisLook;
    isNotBeside = sendState !== 'available';
    if (sendState !== 'rejected') availableIfSummoned = sendState === 'available_if_summoned';
    let planAgain = !dropsWhenUnavailable && !isForWork;
    if (sendState === 'available' || sendState === null) return setToBeHad(sendState !== null);
    if (leavingLosesWork()) {
      if (toBeHad === true) {
        setToBeHad(null);
        dropAfterSilence();
      }
      return void planNextLook(planAgain);
    }
    if (sendState === 'available_if_opened' || (sendState === 'available_if_summoned' && summonHold === null)) return setToBeHad(true);
    if (dropsWhenUnavailable) setToBeHad(false);
    return void planNextLook(planAgain);
  };
  let onceLeavingIsSafe = () =>
    new Promise<void>((resolve) => {
      let check = () => {
        if (leavingLosesWork()) sleep(LEAVE_CHECK_INTERVAL_MS).then(check);
        else resolve();
      };
      check();
    });
  let scheduleLook = async (lookKind: LookKind, waitFor: Promise<void>): Promise<void> => {
    let scheduled: ScheduledLook = {
      is: lookKind,
    };
    scheduledLook = scheduled;
    await waitFor;
    if (scheduledLook !== scheduled) return;
    scheduledLook = null;
    await look(lookKind !== 'forWork', lookKind === 'forWork');
  };
  let planNextLook = async (isFresh: boolean): Promise<void> => {
    if (isFresh && scheduledLook?.is !== 'first') {
      if (scheduledLook?.is === 'later') scheduledLook = null;
      lookAgainIndex = 0;
    }
    if (scheduledLook !== null) return;
    if (leavingLosesWork()) {
      await scheduleLook('forWork', onceLeavingIsSafe());
      return;
    }
    let delayMs = LOOK_AGAIN_DELAYS_MS[lookAgainIndex];
    lookAgainIndex += 1;
    if (delayMs !== undefined) await scheduleLook(lookAgainIndex === 1 ? 'first' : 'later', sleep(delayMs));
  };
  let sendToSession = async (
    payload: ChatPayload,
    sendOptions?: SendOptions,
    skipsKeyGuard: boolean = false,
    whenNotListening: (() => void) | null = null,
  ): Promise<boolean> => {
    let sendToAgentSession = room?.sendToAgentSession;
    let maySummon = availableIfSummoned && !leavingLosesWork();
    let isQuietWhenUnavailable = isNotBeside && leavingLosesWork();
    let releaseKeys: ReturnType<KeepKeysOffCells> | null = null;
    try {
      if (typeof sendToAgentSession !== 'function') return false;
      releaseKeys = skipsKeyGuard ? null : keepKeysOffCells();
      await (sendOptions === undefined ? sendToAgentSession.call(room, payload) : sendToAgentSession.call(room, payload, sendOptions));
      return true;
    } catch (fault) {
      let code = isNonNullObject(fault) ? fault.code : null;
      let keysWereHeld = (code === 'agent_unavailable' || code === 'invalid_argument') && (releaseKeys?.() ?? false);
      if (code === 'agent_unavailable' && maySummon) {
        let hold: SummonHold = {};
        summonHold = hold;
        sleep(SUMMON_UNAVAILABLE_HOLD_MS).then(() => {
          if (summonHold === hold) summonHold = null;
          return;
        });
        setToBeHad(false);
      }
      if (code === 'agent_unavailable' && !isQuietWhenUnavailable) notifyPressRefused(payload, keysWereHeld);
      if (code === 'agent_unavailable') whenNotListening?.();
      if (code !== 'invalid_argument') return look(false).then(() => false);
      let isOfWords = 'request' in payload && !skipsKeyGuard;
      reportFault(Error(`sendToAgentSession fault: invalid_argument${isOfWords ? ' of words' : ''}`));
      if (!isOfWords) setToBeHad(false);
      return false;
    }
  };
  let withAnswerTimeout = (sending: Promise<boolean>) => Promise.race([sending, sleep(CHAT_SEND_TIMEOUT_MS).then(() => false)]);
  let deliverToSession = async (
    payload: AskAboutChart,
    deliver: NonNullable<SendOptions['deliver']>,
    withPresence: boolean,
  ): Promise<AskSentToChat> => {
    let sendToAgentSession = room?.sendToAgentSession;
    if (typeof sendToAgentSession !== 'function') return 'failed';
    try {
      let sendOptions = withPresence
        ? {
            deliver,
          }
        : {
            deliver,
            attachPresence: false,
          };
      let sent: unknown = sendToAgentSession.call(room, payload, sendOptions);
      let drafted = false;
      let taken = await withAnswerTimeout(
        Promise.resolve(sent).then((answer) => {
          drafted = isNonNullObject(answer) && answer.drafted === true;
          return true;
        }),
      );
      return taken ? (drafted ? 'drafted' : 'taken') : 'failed';
    } catch (fault) {
      let code = isNonNullObject(fault) ? fault.code : null;
      if (code === 'rate_limited') return 'tooSoon';
      if (code === 'agent_unavailable') return look(false).then((): AskSentToChat => 'notListening');
      if (code !== 'invalid_argument') look(false);
      else if (withPresence) reportFault(Error('sendToAgentSession fault: invalid_argument of words'));
      else {
        reportFault(Error('sendToAgentSession fault: invalid_argument'));
        setToBeHad(false);
      }
      return 'failed';
    }
  };
  let sendAboutChartTo = (
    sendsNow: boolean,
    label: string,
    chartId: string,
    sheetNumber: number,
    askWords: string,
  ): Promise<AskSentToChat> => {
    let request = cleanAskWords(askWords);
    let payload: AskAboutChart = {
      label,
      chartId,
      sheetNumber,
      request,
    };
    if (!isViewId(chartId) || request === '') reportFault(Error('sendAboutChart fault: no id or no words'));
    else if (takesWords && !isNotBeside) return deliverToSession(payload, 'send', sendsNow);
    else if (toBeHad === true && !(isNotBeside && leavingLosesWork())) {
      // An agent that can be reached but is not waiting for requests refuses: say so, not just that it failed.
      let isNotListening = false;
      return sendsNow
        ? deliverToSession(payload, 'stage', true)
        : withAnswerTimeout(
            sendToSession(
              payload,
              {
                attachPresence: false,
              },
              true,
              () => (isNotListening = true),
            ),
          ).then((sent): AskSentToChat => (sent ? 'taken' : isNotListening ? 'notListening' : 'failed'));
    }
    return Promise.resolve('failed');
  };
  let chartSendInFlight: ChartSendInFlight | null = null;
  let startChartSend = (...send: ChartSendArgs) => {
    let became = sendAboutChartTo(false, ...send).catch((): AskSentToChat => 'failed');
    let inFlight: ChartSendInFlight = {
      chartId: send[1],
      became,
    };
    chartSendInFlight = inFlight;
    became
      .then((outcome) => (isAskTaken(outcome) ? sleep(CHART_SEND_SETTLE_MS) : undefined))
      .then(() => {
        if (chartSendInFlight === inFlight) chartSendInFlight = null;
        return;
      });
    return became;
  };
  return {
    isToBeHad: () => toBeHad,
    isBesidePage: () => toBeHad === true && !isNotBeside,
    isKeptFromLeaving: () => isNotBeside && leavingLosesWork(),
    subscribe(listener: () => void) {
      subscribers.add(listener);
      return () => void subscribers.delete(listener);
    },
    look() {
      if (toBeHad === null) dropAfterSilence();
      return look(false);
    },
    openAboutBlankSheet: (label: string, sheetNumber: number) =>
      sendToSession({
        label,
        isSheetBlank: true,
        sheetNumber,
      }),
    openAboutChart(label: string, chartId: string, sheetNumber: number) {
      if (isViewId(chartId))
        return sendToSession({
          label,
          chartId,
          sheetNumber,
        });
      reportFault(Error('openAboutChart fault: not in the form of an id'));
      return Promise.resolve(false);
    },
    openAboutRule: (label: string, { ruleNumber, ruleCount, sheetNumber }: RuleNumber & { sheetNumber: number }) =>
      sendToSession(
        {
          label,
          ruleNumber,
          ruleCount,
          sheetNumber,
        },
        {
          attachPresence: false,
        },
      ),
    openAboutCells: (cells: SelectionForAgent) =>
      isNotBeside && leavingLosesWork()
        ? Promise.resolve(false)
        : sendToSession(
            {
              label: cells.range,
              ...cells,
            },
            {
              attachPresence: false,
            },
          ),
    openWithWhatWasPressed: (label: string, cells: SelectionForAgent, pressed: string, ask: AskBesidePress) =>
      isNotBeside && leavingLosesWork()
        ? Promise.resolve(false)
        : sendToSession(
            {
              ...ask,
              label,
              ...cells,
              pressed,
            },
            {
              attachPresence: false,
            },
          ),
    onPressRefused(listener: PressRefusedListener) {
      pressRefusedListeners.add(listener);
      return () => void pressRefusedListeners.delete(listener);
    },
    takesWordsAtOnce: () => takesWords,
    sendAboutChart: (...send: ChartSendArgs) => sendAboutChartTo(true, ...send),
    async sendPressAboutChart(...send: ChartSendArgs): Promise<AskSentToChat> {
      let releaseKeys = keepKeysOffCells();
      let outcome = await ((chartSendInFlight?.chartId === send[1] ? chartSendInFlight.became : null) ??
        startChartSend(...send));
      if (outcome !== 'taken') releaseKeys(true);
      return outcome;
    },
  };
}
export const MAX_ASK_WORDS_LENGTH = 1000;
export const UNSHOWN_CHARACTERS_PATTERN =
  /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\p{Noncharacter_Code_Point}\u2800\uFFFD\u{16FE4}]/gu;
export const collapseWhitespace = (text: string): string => text.replaceAll(/\s+/gu, ' ').trim();
export const hasUnshownCharacters = (text: string): boolean => text.replaceAll(UNSHOWN_CHARACTERS_PATTERN, '') !== text;
export const cleanAskWords = (text: string): string =>
  collapseWhitespace(collapseWhitespace(text).slice(0, MAX_ASK_WORDS_LENGTH).replaceAll(UNSHOWN_CHARACTERS_PATTERN, ''));
export const pressedCellsOf = ({ sheetNumber, range, pressed }: PressedCellsHeard): Pick<SelectionForAgent, 'sheetNumber' | 'range'> | null =>
  typeof sheetNumber === 'number' && typeof range === 'string' && pressed === undefined
    ? {
        sheetNumber,
        range,
      }
    : null;
export const NO_CHAT_WITH_AGENT: ChatWithAgent = {
  isToBeHad: () => false,
  isBesidePage: () => false,
  isKeptFromLeaving: () => false,
  subscribe: () => () => {},
  look: () => Promise.resolve(),
  openAboutBlankSheet: () => Promise.resolve(false),
  openAboutChart: () => Promise.resolve(false),
  openAboutRule: () => Promise.resolve(false),
  openAboutCells: () => Promise.resolve(false),
  openWithWhatWasPressed: () => Promise.resolve(false),
  onPressRefused: () => () => {},
  takesWordsAtOnce: () => false,
  sendAboutChart: () => Promise.resolve('failed'),
  sendPressAboutChart: () => Promise.resolve('failed'),
};
export const CHAT_SEND_TIMEOUT_MS = 4000;
export const LOOK_AGAIN_DELAYS_MS = [2500, 5000, 1e4, 20000];
export const LEAVE_CHECK_INTERVAL_MS = 250;
export const SUMMON_UNAVAILABLE_HOLD_MS = 60000;
export const CHART_SEND_SETTLE_MS = 1000;
