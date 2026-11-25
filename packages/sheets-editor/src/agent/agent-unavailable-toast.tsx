import * as React from 'react';
import { pressedCellsOf } from './chat-with-agent.ts';
import type { ChatPayloadHeard, ChatWithAgent } from './chat-with-agent.ts';
import { whenKeyboardPlaceSettles, whenUnfocusedFor } from './added-to-message-notices.tsx';
import type { PlaceOfKeyboard } from './added-to-message-notices.tsx';
import type { SheetController } from '../state/controller.ts';
import type { SelectionForAgent } from '../state/initial-state.ts';
import { getKeptOffCount } from '../app/keys-off-cells.ts';
import { LiveAnnouncer } from '../ui/live-announcer.tsx';
import { sheetMessages } from '../i18n/sheet-messages.ts';
import { MountedToast } from '../ui/mounted-toast.tsx';
interface AgentUnavailableToastProps {
  store: Pick<SheetController, 'subscribe' | 'getView'>;
  chat: Pick<ChatWithAgent, 'onPressRefused'>;
  placeOfKeyboard: () => PlaceOfKeyboard;
  hasWindowFocus: () => boolean;
  /** Whether the refusal of this payload is told elsewhere, so the toast need not tell it. */
  isSaidElsewhere: (payload: ChatPayloadHeard) => boolean;
  /** Offers another way to ask about the cells pressed; says whether it did. */
  standInFor: (cells: Pick<SelectionForAgent, 'sheetNumber' | 'range'>, wereKeysKeptOff: boolean) => boolean;
  onToastUp: () => void;
  onGone: () => void;
}
export function AgentUnavailableToast({
  store,
  chat,
  placeOfKeyboard,
  hasWindowFocus,
  isSaidElsewhere,
  standInFor,
  onToastUp,
  onGone,
}: AgentUnavailableToastProps) {
  let [timesRefused, setTimesRefused] = React.useState(0);
  let [timesReady, setTimesReady] = React.useState(0);
  let [timesDismissed, setTimesDismissed] = React.useState(0);
  let isSaidElsewhereNow = React.useEffectEvent(isSaidElsewhere);
  let standInForNow = React.useEffectEvent(standInFor);
  let placeOfKeyboardNow = React.useEffectEvent(placeOfKeyboard);
  React.useEffect(
    () =>
      chat.onPressRefused((refusedPress, wereKeysKeptOff) => {
        if (isSaidElsewhereNow(refusedPress)) return;
        let standIn = pressedCellsOf(refusedPress);
        if (standIn === null || !standInForNow(standIn, wereKeysKeptOff)) setTimesRefused((times) => times + 1);
      }),
    [chat],
  );
  React.useEffect(
    () =>
      timesRefused === 0
        ? undefined
        : whenKeyboardPlaceSettles(
            store,
            () => placeOfKeyboardNow(),
            getKeptOffCount,
            () => setTimesReady(timesRefused),
          ),
    [store, timesRefused],
  );
  let isToastUp = timesRefused !== 0 && timesRefused === timesReady && timesRefused !== timesDismissed;
  let hasWindowFocusNow = React.useEffectEvent(hasWindowFocus);
  React.useEffect(
    () =>
      isToastUp
        ? whenUnfocusedFor(
            () => hasWindowFocusNow(),
            () => setTimesDismissed(timesRefused),
          )
        : undefined,
    [isToastUp, timesRefused],
  );
  let onToastUpNow = React.useEffectEvent(onToastUp);
  React.useEffect(() => {
    if (isToastUp) onToastUpNow();
  }, [isToastUp]);
  return <><LiveAnnouncer words={isToastUp && sheetMessages.agentNotToBeHad()} timesSaid={timesRefused} />{isToastUp &&
        (<MountedToast key={timesRefused} words={sheetMessages.agentNotToBeHad()} staysUntilClosed={false} onOver={() => {
              setTimesDismissed(timesRefused);
              onGone();
            }} onTakenDown={onGone} />)}</>;
}
