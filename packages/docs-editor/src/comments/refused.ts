/**
 * Comments the server turned down (not the connection: those wait in the outbox). The person is told why and what to
 * do, and gets the words back: Copy draft puts them on the clipboard, or shows them to select by hand.
 */
import { create } from 'zustand';

/** Why the server said no, as far as the person can act on it. */
export type RefusalReason =
  /** The thread a reply was for is gone. */
  | 'thread_gone'
  /** The viewer may no longer comment here. */
  | 'no_access'
  /** The server took the message as malformed (say, too many people named); its words say what. */
  | 'invalid'
  | 'other';

export type RefusedKind = 'comment' | 'reply';

export function refusalReason(error: unknown): RefusalReason {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  if (code === 'not_found') return 'thread_gone';
  if (code === 'not_writer' || code === 'not_granted') return 'no_access';
  if (code === 'invalid') return 'invalid';
  return 'other';
}

/** What to do about it, in a sentence. */
export function refusalAdvice(reason: RefusalReason, kind: RefusedKind): string {
  switch (reason) {
    case 'thread_gone':
      return 'The comment it answered was deleted. Copy your reply, then post it as a new comment.';
    case 'no_access':
      return `You can no longer comment on this doc. Copy your ${kind}, ask the owner for access, then send it again.`;
    case 'invalid':
      return `The server didn’t accept it as written. Copy your ${kind}, change what the message above points to (such as naming fewer people), then send it again.`;
    case 'other':
      return `Copy your ${kind} so it isn’t lost, then try sending it again.`;
  }
}

export interface RefusedDraft {
  id: number;
  title: string;
  /** The server's own words. */
  detail: string;
  advice: string;
  /** Everything the person wrote. */
  text: string;
  /** `manual`: the clipboard couldn't be used, so the text is shown to copy by hand. */
  copy: 'idle' | 'copied' | 'manual';
}

/** At most this many refusals are shown at once; an older one gives way. */
const SHOWN_MAX = 3;

export const useRefused = create<{ drafts: RefusedDraft[] }>(() => ({ drafts: [] }));

let serial = 0;

export function showRefused(title: string, text: string, kind: RefusedKind, error: unknown): RefusedDraft {
  const draft: RefusedDraft = {
    id: ++serial,
    title,
    detail: error instanceof Error ? error.message : String(error),
    advice: refusalAdvice(refusalReason(error), kind),
    text,
    copy: 'idle',
  };
  useRefused.setState(state => ({ drafts: [...state.drafts, draft].slice(-SHOWN_MAX) }));
  return draft;
}

export function dismissRefused(id: number): void {
  useRefused.setState(state => ({ drafts: state.drafts.filter(draft => draft.id !== id) }));
}

function setCopy(id: number, copy: RefusedDraft['copy']): void {
  useRefused.setState(state => ({ drafts: state.drafts.map(draft => (draft.id === id ? { ...draft, copy } : draft)) }));
}

export interface TextClipboard {
  writeText(text: string): Promise<void>;
}

const pageClipboard = (): TextClipboard | null => (typeof navigator !== 'undefined' && navigator.clipboard ? navigator.clipboard : null);

/** Copies a refused draft whole; when the clipboard can't be used, its text is shown to select. */
export async function copyRefused(id: number, clipboard: TextClipboard | null = pageClipboard()): Promise<void> {
  const draft = useRefused.getState().drafts.find(item => item.id === id);
  if (!draft) return;
  try {
    if (!clipboard) throw new Error('no clipboard');
    await clipboard.writeText(draft.text);
    setCopy(id, 'copied');
  } catch {
    setCopy(id, 'manual');
  }
}
