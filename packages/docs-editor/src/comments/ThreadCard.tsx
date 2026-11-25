/** A thread's card: the words it is on, its messages, the agent's progress and the reply box; a reaction shows as a chip. */
import type { CommentThread } from '@open-artifact/runtime';
import { draftedText, queuedNote } from '@open-artifact/editor-kit';
import { Tip } from '@open-artifact/editor-kit/react';
import { ConfirmDialog, cn } from '@open-artifact/ui';
import { CircleCheck } from 'lucide-react';
import { type ReactNode, type Ref, useState } from 'react';
import { mentionsAgent, pressReactionThread, reply, replyGoesToAgent } from './actions.ts';
import { Composer, Initial, type SendBoxSpec } from './Composer.tsx';
import { Message } from './Message.tsx';
import { type Hold, agentName, canAskAgent, canComment, canRemoveAny, docComments, myName, setActive, useCommentUi } from './store.ts';
import { canDeleteThread, isOwn, reactionCount, resolvedWords } from './threads.ts';

export interface ThreadCardProps {
  thread: CommentThread;
  hold: Hold | undefined;
  open: boolean;
  /** In the list of every thread: the quoted words show, and the tab's name when it is another tab's. */
  inList?: boolean;
  tabName?: string | null;
  /** Clicked words of the thread with more than one live range: that place can be taken off. */
  removablePlace?: string | null;
  cardRef?: Ref<HTMLDivElement>;
  onOpen(): void;
}

/** Whether a thread hangs on table cells rather than words. */
const onCells = (thread: CommentThread): boolean => {
  const kind = docComments.anchorOf(thread).kind;
  return kind === 'cell' || kind === 'cells';
};

function Quote({ thread, hold }: { thread: CommentThread; hold: Hold | undefined }): ReactNode {
  if (!thread.label) return null;
  if (hold === 'detached')
    return (
      <div className="mb-2 truncate text-[12px] text-chrome-muted" title={onCells(thread) ? 'The cells this was on were deleted' : 'The words this was on were deleted'}>
        <span className="font-medium">was on:</span> <span className="line-through">{thread.label}</span>
      </div>
    );
  return <div className="mb-2 truncate border-l-2 border-[rgb(255_196_0/0.8)] pl-2 text-[12px] text-chrome-muted">{thread.label}</div>;
}

/** Where the agent is with the thread, under its messages. */
function AgentProgress({ thread }: { thread: CommentThread }): ReactNode {
  const agent = useCommentUi(state => state.agent);
  const status = thread.status === 'open' ? thread.agent?.status : undefined;
  if (status !== 'pending' && status !== 'delivered') return null;
  const name = agentName();
  return (
    <div className="flex items-center gap-1.5 text-[12px] text-chrome-muted" role="status">
      <Initial name={name} agent size="md" />
      <span className="truncate">{status === 'pending' ? queuedNote({ name, ...(agent?.wakesIdle !== undefined ? { wakesIdle: agent.wakesIdle } : {}) }) : thread.agent?.drafted ? draftedText(name).label : 'Working…'}</span>
    </div>
  );
}

function ReplyBox({ thread }: { thread: CommentThread }): ReactNode {
  const draft = docComments.store(state => state.replies[thread.id]?.text ?? '');
  const [busy, setBusy] = useState(false);
  const [discard, setDiscard] = useState(false);
  // The person's own "Send to agent" for this reply; until they set it, the box says where the reply would go.
  const [choice, setChoice] = useState<boolean | null>(null);
  useCommentUi(state => state.agent);
  const setDraft = (text: string) => docComments.store.getState().setReply(thread.id, { text, send: false });
  const locked = mentionsAgent(draft);
  const sendBox: SendBoxSpec | undefined = canAskAgent()
    ? { checked: locked || (choice ?? replyGoesToAgent(thread, draft)), locked, onChange: setChoice }
    : undefined;
  return (
    <div className="mt-3" onClick={event => event.stopPropagation()}>
      <Composer
        compact
        label="Reply"
        placeholder={thread.status === 'resolved' ? 'Reply to reopen…' : 'Reply'}
        submitLabel="Reply"
        value={draft}
        onChange={setDraft}
        busy={busy}
        sendBox={sendBox}
        onSubmit={text => {
          setBusy(true);
          void reply(thread.id, text, sendBox?.checked)
            .then(sent => sent && setChoice(null))
            .finally(() => setBusy(false));
        }}
        onCancel={() => (draft.trim() ? setDiscard(true) : setActive(null))}
      />
      <ConfirmDialog
        open={discard}
        onOpenChange={setDiscard}
        title="Discard reply?"
        description="Your unsent reply will be lost."
        confirmLabel="Discard"
        danger
        onConfirm={() => {
          setDraft('');
          setActive(null);
        }}
      />
    </div>
  );
}

/** A reaction made on words: its emoji and how many reacted; a press joins in, or takes the viewer's own back. */
export function ReactionChip({ thread, open, cardRef, onOpen }: Pick<ThreadCardProps, 'thread' | 'open' | 'cardRef' | 'onOpen'>): ReactNode {
  const root = thread.messages[0]!;
  const me = myName();
  const emoji = root.text.trim();
  const joined = root.reactions?.find(reaction => reaction.emoji === emoji)?.authors ?? [];
  const names = [root.author, ...joined.filter(author => author.name !== root.author.name || author.kind !== root.author.kind)].map(author => (isOwn(author, me) ? 'You' : author.name));
  const mine = isOwn(root.author, me) || joined.some(author => isOwn(author, me));
  return (
    <div ref={cardRef} className="flex" data-comment-card={thread.id}>
      <Tip label={`${names.join(', ')} reacted`} side="left">
        <button
          type="button"
          aria-pressed={mine}
          aria-label={`${emoji} ${reactionCount(thread)}: ${names.join(', ')}`}
          disabled={!canComment()}
          onFocus={onOpen}
          onClick={() => {
            onOpen();
            void pressReactionThread(thread, canDeleteThread(thread, me, canComment(), canRemoveAny()));
          }}
          className={cn(
            'flex h-6 items-center gap-1 rounded-full border px-2 leading-none transition-colors disabled:opacity-100',
            mine ? 'border-chrome-accent/35 bg-chrome-accent/10 text-chrome-accent hover:bg-chrome-accent/15' : 'border-chrome-line bg-chrome text-chrome-muted hover:bg-chrome-hover',
            open && 'ring-1 ring-chrome-accent/60',
          )}
        >
          <span className="text-[15px] leading-none">{emoji}</span>
          <span className="text-[12px] tabular-nums">{reactionCount(thread)}</span>
        </button>
      </Tip>
    </div>
  );
}

/** Focuses the card drawn after (`1`) or before (`-1`) `card` on the page. */
function focusNextCard(card: HTMLElement, step: 1 | -1): void {
  const cards = [...card.ownerDocument.querySelectorAll<HTMLElement>('[data-comment-card]')].sort(
    (a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top,
  );
  cards[cards.indexOf(card) + step]?.focus();
}

export function ThreadCard({ thread, hold, open, inList = false, tabName, removablePlace, cardRef, onOpen }: ThreadCardProps): ReactNode {
  const [root, ...replies] = thread.messages;
  if (!root) return null;
  const resolved = thread.status === 'resolved';
  const shown = open ? replies : [];
  return (
    <div
      ref={cardRef}
      role="article"
      aria-label={`Comment by ${root.author.name}${thread.label ? ` on “${thread.label}”` : ''}${resolved ? '. Resolved.' : ''}`}
      data-comment-card={thread.id}
      data-open={open ? '' : undefined}
      tabIndex={open ? -1 : 0}
      onClick={() => !open && onOpen()}
      onKeyDown={event => {
        if (event.target !== event.currentTarget) return;
        if ((event.key === 'Enter' || event.key === ' ') && !open) {
          event.preventDefault();
          onOpen();
        } else if (event.key === 'Enter' && open) {
          const reply = event.currentTarget.querySelector<HTMLTextAreaElement>('[data-comment-composer] textarea');
          if (!reply) return;
          event.preventDefault();
          reply.focus();
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          focusNextCard(event.currentTarget, event.key === 'ArrowDown' ? 1 : -1);
        } else if (event.key === 'Escape' && open) {
          event.preventDefault();
          setActive(null);
        }
      }}
      className={cn(
        'pointer-events-auto rounded-[12px] bg-chrome p-3 text-chrome-fg shadow-chrome outline-none transition-[transform,box-shadow] duration-150',
        open ? 'ring-1 ring-chrome-accent/50 shadow-chrome-popup' : 'cursor-pointer hover:shadow-chrome-popup',
        resolved && !open && 'opacity-70',
      )}
    >
      {inList && tabName ? <div className="mb-1 truncate text-[11px] font-medium uppercase tracking-wide text-chrome-muted">{tabName}</div> : null}
      {inList || hold === 'detached' ? <Quote thread={thread} hold={hold} /> : null}
      {resolved ? (
        <div className="mb-2 flex items-center gap-1 text-[12px] text-chrome-muted">
          <CircleCheck className="size-3.5 text-chrome-accent" />
          {resolvedWords(thread, myName(), agentName())}
        </div>
      ) : null}
      <Message thread={thread} message={root} root open={open} removablePlace={removablePlace} />
      {shown.length ? (
        <div className="mt-3 flex flex-col gap-3">
          {shown.map(message => (
            <Message key={message.id} thread={thread} message={message} root={false} open={open} removablePlace={undefined} />
          ))}
        </div>
      ) : null}
      {!open && replies.length ? (
        <div className="mt-2 pl-[30px] text-[12px] font-medium text-chrome-muted">
          {replies.length === 1 ? '1 reply' : `${replies.length} replies`}
        </div>
      ) : null}
      {open ? (
        <div className="mt-3 empty:hidden">
          <AgentProgress thread={thread} />
        </div>
      ) : null}
      {open && canComment() ? <ReplyBox thread={thread} /> : null}
    </div>
  );
}
