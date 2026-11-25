/**
 * The "Ask agent" pane beside the page: the owner session's state, what was
 * sent from here, and a box whose messages go to that session
 * (`artifacts.ask`).
 *
 * On a cloud host no session owns the artifact: the pane says what the host says of the owner's agent (a linked
 * computer connected or away, an MCP client used lately, or none), and, once sent, whether it has the request now.
 */

import { Send, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, IconButton } from '@open-artifact/ui';
import { OwnerBadge } from '../../components/OwnerBadge.tsx';
import { ago } from '../../lib/format.ts';
import { cloudAskLine } from '../../lib/cloud.ts';
import { t, type MessageKey } from '../../lib/i18n.ts';
import { ask } from '../actions.ts';
import { useAgentName, useCloudAgent, useOwner, useOwnerState, useRole } from '../hooks.ts';
import type { Delivery } from '../model.ts';
import { useShell } from '../store.ts';

const DELIVERY: Record<Delivery, MessageKey> = { delivered: 'viaDelivered', drafted: 'viaDrafted', inbox: 'viaInbox', failed: 'viaFailed' };

/** The pane's heading lines for the owner's state. */
function useStateLines(agent: string): { state: string; note: string } {
  const owner = useOwner();
  const status = useOwnerState();
  const cloudAgent = useCloudAgent();
  const role = useRole();
  if (cloudAgent && status !== 'working') {
    const said = cloudAskLine(cloudAgent, role === 'owner');
    return { state: t(said.key, said.vars), note: '' };
  }
  if (cloudAgent) return { state: t('working', { agent: cloudAgent.name }), note: '' };
  if (!owner) return { state: t('noOwner'), note: t('noOwnerNote') };
  // The harness's display name when its profile gives one, else its id as it is.
  const harness = owner.harnessTitle ?? owner.harness;
  if (status === 'working') return { state: t('working', { agent }), note: t('ownerNote', { harness }) };
  if (owner.live) return { state: t('agentIdle', { agent }), note: t('ownerNote', { harness }) };
  return { state: t('sessionOffline'), note: t('offlineNote', { agent, harness }) };
}

/** The ask pane. */
export function AskPane() {
  const agent = useAgentName();
  const sent = useShell((state) => state.sent);
  const status = useShell((state) => state.askStatus);
  const ownerStatus = useOwnerState();
  const cloudAgent = useCloudAgent();
  const owner = useOwner();
  const { state, note } = useStateLines(agent);
  // A cloud host's agent: its own words for the dot, and "waiting for the agent" (there is no session to wait for).
  const badgeLabel = cloudAgent && ownerStatus !== 'working' ? t(cloudAgent.state === 'online' ? 'statusConnected' : cloudAgent.state === 'none' ? 'statusNoAgent' : 'statusOffline') : undefined;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const log = useRef<HTMLOListElement>(null);

  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    log.current?.lastElementChild?.scrollIntoView({ block: 'end' });
  }, [sent.length]);

  const submit = async (): Promise<void> => {
    if (busy || !text.trim()) return;
    setBusy(true);
    if (await ask(text, agent)) setText('');
    setBusy(false);
  };

  return (
    <aside
      aria-label={t('ask', { agent })}
      className="flex w-[360px] max-w-full shrink-0 flex-col border-l border-line bg-surface max-md:absolute max-md:inset-y-0 max-md:right-0 max-md:z-10 max-md:shadow-popup"
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line pl-3.5 pr-1.5">
        <span className="min-w-0 flex-1 truncate font-medium">{agent}</span>
        <OwnerBadge state={ownerStatus} {...(badgeLabel ? { label: badgeLabel } : {})} />
        <IconButton label={t('hideAsk')} icon={<X className="size-4" />} size="lg" onClick={() => useShell.getState().setAskOpen(false)} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3.5">
        <p className="mb-1 mt-0 font-medium">{state}</p>
        {note ? <p className="mb-3.5 mt-0 text-xs text-fg-muted">{note}</p> : <div className="mb-3.5" />}
        <ol ref={log} className="m-0 flex list-none flex-col gap-2.5 p-0">
          {sent.map((message, index) => (
            <li key={`${message.at}-${index}`} className="max-w-[92%] self-end whitespace-pre-wrap break-words rounded-2xl bg-surface-2 px-3 py-2">
              {message.text}
              <span className="mt-0.5 block text-[11px] text-fg-muted">
                {ago(message.at)} · {t(cloudAgent && message.delivery === 'inbox' ? 'viaWaitingAgent' : DELIVERY[message.delivery])}
              </span>
            </li>
          ))}
        </ol>
      </div>
      <form
        className="p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <textarea
          ref={input}
          rows={3}
          value={text}
          placeholder={t('askPlaceholder')}
          aria-label={t('askPlaceholder')}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
          className="block max-h-[40vh] min-h-[72px] w-full resize-y rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-[13px] text-fg outline-none placeholder:text-fg-subtle focus:border-accent"
        />
        <div className="mt-2 flex items-center gap-2">
          <span role="status" className="min-w-0 flex-1 text-xs text-fg-muted">
            {status}
          </span>
          <Button type="submit" size="lg" variant="primary" disabled={busy || !text.trim()} icon={<Send className="size-3.5" />}>
            {t(owner?.wakeMode === 'draft' ? 'sendToConversation' : 'sendToAgent', { agent })}
          </Button>
        </div>
      </form>
    </aside>
  );
}
