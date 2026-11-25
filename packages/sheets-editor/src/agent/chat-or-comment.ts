import { isCoarsePointerNow } from '../app/media-queries.ts';
import { doesSelectionShowError } from './ask-agent-menu.tsx';
import type { ChatWithAgent } from './chat-with-agent.ts';
import type { PlaceOfKeyboard } from './added-to-message-notices.tsx';
import type { SheetController } from '../state/controller.ts';
import type { SelectionForAgent } from '../state/initial-state.ts';
import type { PageView } from '../view/page-view.ts';
/** What bears on whether the agent is asked in the chat or in a comment. */
export interface WhereToAskAgent {
  /** Whether the field to ask in sits on top of the cells. */
  isFieldOnTop: boolean;
  /** Whether the chat can be had; null while that is not known. */
  isChatToBeHad: boolean | null;
  isCommentOffered: boolean;
  doCellsShowError: boolean;
  couldCommentGoToAgent: boolean;
}
/** Where the agent is asked. */
export type WayToAskAgent = 'chat' | 'comment';
/** What the field to ask in does with the words typed in it. */
export type AskFieldDoes = 'tools' | 'agent' | 'nothing';
/** What decides what the field to ask in does. */
export interface AskFieldState {
  isPlaceToAsk: boolean;
  isAgentToBeHadForTools: boolean;
  canAskAgent: boolean;
}
/** The page as it is when the agent is asked about cells by a pause in the menu. */
export interface PageWhenAgentAsked {
  selected: SelectionForAgent | null;
  place: PlaceOfKeyboard;
  isInMenuThatPressShut: boolean;
  hasPauseHeld: boolean;
  isEventUnfinished: boolean;
  areCellsInView: boolean;
}
/** What of the host bears on where the agent is asked. */
export interface HostToAskAgent {
  isInStaffTrials: () => boolean;
  chatWithAgent: Pick<ChatWithAgent, 'isBesidePage' | 'isToBeHad' | 'isKeptFromLeaving'>;
  comments: { couldSendToAgentWhenLastAnswered(): boolean };
}
/** What of the view bears on where the agent is asked. */
type ViewToAskAgent = Pick<PageView, 'isCommentOffered' | 'errorOfActiveCell' | 'calculating'>;
export function isChatBesidePage(
  viewOf: () => ViewToAskAgent | null,
  host: HostToAskAgent,
  isPointerCoarse: boolean = isCoarsePointerNow(),
): boolean {
  if (host.chatWithAgent.isBesidePage()) return true;
  if (!host.isInStaffTrials() || isPointerCoarse) return false;
  let { isToBeHad: isChatToBeHad, isKeptFromLeaving: isChatKeptFromLeaving } = host.chatWithAgent;
  if (isChatToBeHad() === true && !isChatKeptFromLeaving()) return true;
  let view = viewOf();
  return view !== null && askAgentViaForView(view, host, isPointerCoarse) === 'comment';
}
export const isCommentToAgentOffered = (where: WhereToAskAgent): boolean =>
  where.isFieldOnTop && where.isChatToBeHad === false && where.isCommentOffered && !where.doCellsShowError && where.couldCommentGoToAgent;
export const canAskAgentHere = (where: WhereToAskAgent): boolean => where.isChatToBeHad !== false || isCommentToAgentOffered(where);
export const askAgentVia = (where: WhereToAskAgent, preferred: WayToAskAgent = 'chat'): WayToAskAgent =>
  isCommentToAgentOffered(where) ||
  (preferred === 'comment' && where.isFieldOnTop && where.isChatToBeHad === true && where.isCommentOffered && !where.doCellsShowError)
    ? 'comment'
    : 'chat';
export const shouldEnterCommentForAgent = (
  where: WhereToAskAgent,
  askedAbout: Pick<SelectionForAgent, 'sheetNumber' | 'range'>,
  page: PageWhenAgentAsked,
): boolean =>
  askAgentVia(where) === 'comment' &&
  page.selected?.sheetNumber === askedAbout.sheetNumber &&
  page.selected.range === askedAbout.range &&
  (page.place === 'inCells' || page.place === 'pausedAtCells' || (page.place === 'inMenu' && page.isInMenuThatPressShut)) &&
  page.hasPauseHeld &&
  !page.isEventUnfinished &&
  page.areCellsInView;
export const whatAskFieldDoes = (field: AskFieldState): AskFieldDoes => {
  if (field.isPlaceToAsk && field.isAgentToBeHadForTools) return 'tools';
  return field.canAskAgent ? 'agent' : 'nothing';
};
export const askAgentViaForView = (
  view: ViewToAskAgent,
  { isInStaffTrials, chatWithAgent, comments }: HostToAskAgent,
  isPointerCoarse: boolean = isCoarsePointerNow(),
): WayToAskAgent => {
  let isChatKeptFromLeaving = chatWithAgent.isKeptFromLeaving();
  let where: WhereToAskAgent = {
    isFieldOnTop: isInStaffTrials() && !isPointerCoarse,
    isChatToBeHad: chatWithAgent.isToBeHad() ?? (isChatKeptFromLeaving || null),
    isCommentOffered: view.isCommentOffered,
    doCellsShowError: doesSelectionShowError({
      ...view,
      selectedRange: null,
    }),
    couldCommentGoToAgent: comments.couldSendToAgentWhenLastAnswered(),
  };
  return askAgentVia(where, isChatKeptFromLeaving ? 'comment' : 'chat');
};
export const watchAgentAskedUnderAt = (
  controller: Pick<SheetController, 'onAgentAskedUnderAt' | 'getView' | 'dispatch'>,
  host: HostToAskAgent,
  askInChat: () => void,
  isPointerCoarse?: boolean,
): (() => void) =>
  controller.onAgentAskedUnderAt((isAlreadyAnswered) => {
    if (askAgentViaForView(controller.getView(), host, isPointerCoarse) !== 'comment') return askInChat();
    if (!isAlreadyAnswered)
      controller.dispatch({
        kind: 'commentChosen',
        isForAgent: true,
      });
    return;
  });
