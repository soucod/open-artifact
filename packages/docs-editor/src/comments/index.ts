/**
 * Comments on the doc: threads on words, cells and paragraphs, drawn beside the text or listed all together; replies,
 * reactions, @mentions (the agent's takes the thread to it), links to a thread, and their keys and toolbar buttons.
 */
import { watchAgentStatus } from '@open-artifact/editor-kit';
import type { Peer } from '@open-artifact/runtime';
import { MessageSquarePlus, SmilePlus } from 'lucide-react';
import { provideAction } from '../app/actions.ts';
import { provideSelectionAction } from '../app/selection-actions.ts';
import { maybeSession } from '../app/session.ts';
import { fillSlot } from '../app/slots.ts';
import { getDocs, setDocs, useDocs } from '../app/store.ts';
import { addEditorExtension } from '../editor/DocEditor.tsx';
import { useEditor } from '../editor/format.ts';
import { provideSuggestionReply } from '../suggest/reply.ts';
import { commentOnSelection, commentOnSuggestion, revealThread, selectionCommentable } from './actions.ts';
import { CommentsButton } from './CommentsButton.tsx';
import { commentsPlugin, rangeAt } from './plugin.ts';
import { CommentsRail } from './Rail.tsx';
import { SelectionReactionPicker } from './Reactions.tsx';
import { RefusedDrafts } from './RefusedDrafts.tsx';
import { canComment, docComments, setActive, setCommentUi, threadById } from './store.ts';
import { commentInLink, withoutComment } from './threads.ts';
import './comments.css';

addEditorExtension({ plugins: () => [commentsPlugin()] });

fillSlot('topBar', 'comments', CommentsButton, 30);
fillSlot('rail', 'comments', CommentsRail, 10);
fillSlot('overlay', 'comment-reaction-picker', SelectionReactionPicker);
fillSlot('float', 'refused-comments', RefusedDrafts, 40);

provideSuggestionReply(target => void commentOnSuggestion(target));

/** With the caret in commented words (and nothing selected), their thread opens instead of a new one. */
function openCommentAtCaret(): boolean {
  const state = useEditor.getState().state;
  if (!state || !state.selection.empty) return false;
  const range = rangeAt(state, state.selection.from);
  if (!range || !threadById(range.id)) return false;
  if (getDocs().comments === 'hidden') setDocs({ comments: 'margin' });
  setActive(range.id, range.place);
  return true;
}

provideAction('comment', () => {
  if (openCommentAtCaret()) return true;
  if (!canComment() || !useEditor.getState().view) return false;
  void commentOnSelection();
  return true;
});

provideAction('toggleComments', () => {
  if (!docComments.store.getState().available) return false;
  setDocs({ comments: getDocs().comments === 'hidden' ? 'margin' : 'hidden' });
  return true;
});

provideSelectionAction('comment', {
  label: 'Comment',
  shortcut: 'Mod-Alt-m',
  icon: MessageSquarePlus,
  available: () => selectionCommentable(useEditor.getState().state),
  run: () => void (openCommentAtCaret() || commentOnSelection()),
});

provideSelectionAction('react', {
  label: 'Add a reaction',
  icon: SmilePlus,
  available: () => selectionCommentable(useEditor.getState().state),
  run: anchor => {
    const { top, left, width, height } = anchor.getBoundingClientRect();
    setCommentUi({ picker: { top, left, width, height } });
  },
});

/** The others in the room, by name, for @mentions. */
function peerNames(peers: readonly Peer[], self: string | null): string[] {
  const names = new Set<string>();
  for (const peer of peers) if (peer.kind === 'person' && peer.name && peer.name !== self) names.add(peer.name);
  return [...names];
}

/** A `?comment=` link opens its thread, once the threads are in; the parameter then leaves the address. */
function openLinkedThread(): void {
  const id = commentInLink(window.location.href);
  if (!id) return;
  const thread = threadById(id);
  if (thread) void revealThread(thread);
  try {
    window.history.replaceState(window.history.state, '', withoutComment(window.location.href));
  } catch {
    // The address stays as it is.
  }
}

let started = false;

async function startComments(): Promise<void> {
  const current = maybeSession();
  if (!current || started) return;
  started = true;
  watchAgentStatus(current.agent, agent => setCommentUi({ agent }));
  const room = current.room;
  if (room) {
    const self = current.viewer.name;
    room.peers().then(
      peers => setCommentUi({ peers: peerNames(peers, self) }),
      () => {},
    );
    room.onPeers(peers => setCommentUi({ peers: peerNames(peers, self) }));
  }
  await docComments.start(current.comments);
  openLinkedThread();
}

useDocs.subscribe(state => {
  if (state.phase.kind === 'ready') void startComments();
});
