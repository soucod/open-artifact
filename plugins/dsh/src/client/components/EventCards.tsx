import { type CSSProperties, useState } from 'react';
import { isShellMessage, type CardData, type CardRequest, type CardThread } from '../cards.ts';
import type { Translate } from '../i18n.ts';

/** Opens the artifact's Shell at a comment. */
export type OpenThread = (data: CardData, threadId: string) => void;

const iconStyle: CSSProperties = { display: 'block' };
const TITLE_MARK = '\u0001';

function CommentIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={iconStyle}>
      <path
        d="M3 3.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H8.2L5.4 13.8a.3.3 0 0 1-.5-.23V11.5H3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RequestIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={iconStyle}>
      <rect x="2" y="4" width="12" height="7" rx="2" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8.5 8.5 11 14l.9-2.1L14 11l-5.5-2.5Z" fill="currentColor" stroke="var(--dsw-alias-markdown-code-block, #fff)" strokeWidth="0.8" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" style={iconStyle}>
      <path d="M3 4.5 6 7.5l3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" style={iconStyle}>
      <path d="M4.5 3 7.5 6l-3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The header text with the title as its own span: the title is what gets cut short, so "sent to agent" stays readable. */
function Heading({ text, title, parts }: { text: string; title: string; parts: string[] }) {
  return (
    <span className="oac-head-text" title={text}>
      {parts.length === 2 ? (
        <>
          <span>{parts[0]}</span>
          <span className="oac-head-title">{title}</span>
          <span>{parts[1]}</span>
        </>
      ) : (
        <span className="oac-head-title">{text}</span>
      )}
    </span>
  );
}

function ThreadCard({ data, thread, t, openThread }: { data: CardData; thread: CardThread; t: Translate; openThread: OpenThread }) {
  const [open, setOpen] = useState(true);
  const { title } = data;
  const canView = data.viewUrl !== '' || data.artifactId !== '';
  const meta = thread.where !== '' || canView;
  return (
    <div className="oac-card" data-comment-id={thread.id}>
      <div className="oac-head">
        <CommentIcon />
        <Heading text={t('card.comment', { title })} title={title} parts={t('card.comment', { title: TITLE_MARK }).split(TITLE_MARK)} />
        {meta && (
          <button type="button" className="oac-toggle" aria-expanded={open} aria-label={t(open ? 'card.less' : 'card.more')} onClick={() => setOpen(!open)}>
            <ChevronDown />
          </button>
        )}
      </div>
      <div className="oac-body">{thread.text}</div>
      <From data={data} t={t} />
      {meta && open && (
        <div className="oac-meta">
          {thread.where && <div className="oac-where">{thread.where}</div>}
          {canView && (
            <button type="button" className="oac-view" onClick={() => openThread(data, thread.id)}>
              {t('card.view')}
              <ChevronRight />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Who sent it, when it is not the owner. */
function From({ data, t }: { data: CardData; t: Translate }) {
  return data.from ? <div className="oac-where oac-from">{t('card.from', { name: data.from.name, role: data.from.role })}</div> : null;
}

/** A task's result. */
function TaskCard({ data, t }: { data: CardData; t: Translate }) {
  const { title, task } = data;
  const key = task!.ok ? 'card.task' : 'card.taskFailed';
  const action = task!.action || t('card.requestLabel');
  return (
    <div className="oac-card" data-task={task!.action}>
      <div className="oac-head">
        <RequestIcon />
        <Heading text={t(key, { title, action })} title={title} parts={t(key, { title: TITLE_MARK, action }).split(TITLE_MARK)} />
      </div>
    </div>
  );
}

function RequestCard({ data, request, t }: { data: CardData; request: CardRequest; t: Translate }) {
  const { title } = data;
  const message = isShellMessage(request);
  const label = request.label || t('card.requestLabel');
  const key = message ? 'card.message' : 'card.request';
  return (
    <div className="oac-card" data-request-id={request.id}>
      <div className="oac-head">
        {message ? <CommentIcon /> : <RequestIcon />}
        <Heading text={t(key, { title, label })} title={title} parts={t(key, { title: TITLE_MARK, label }).split(TITLE_MARK)} />
      </div>
      <div className="oac-body">{request.text}</div>
      <From data={data} t={t} />
    </div>
  );
}

/** Props of {@link EventCards}. */
export interface EventCardsProps {
  node: { data: CardData };
  t: Translate;
  openThread: OpenThread;
}

/** The cards of one wake message. */
export function EventCards({ node, t, openThread }: EventCardsProps) {
  const data = node.data;
  return (
    <div className="oac-row">
      {data.threads.map((thread) => (
        <ThreadCard key={thread.id} data={data} thread={thread} t={t} openThread={openThread} />
      ))}
      {data.requests.map((request) => (
        <RequestCard key={request.id} data={data} request={request} t={t} />
      ))}
      {data.task && data.threads.length === 0 && data.requests.length === 0 && <TaskCard data={data} t={t} />}
    </div>
  );
}
