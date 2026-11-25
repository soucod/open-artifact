import { ChatComposer } from '../kit/chat-composer.tsx';
import { WorkingMark } from '../kit/agent-mark.tsx';
import { ShimmerText } from '../kit/shimmer-text.tsx';
import type { ChatComposerEditorHandle } from '../kit/chat-composer.tsx';
import * as React from 'react';
import type { ImportOfAFile, ImportPlan } from '../state/initial-state.ts';
import { isImportPlanComing } from './import-review.ts';
import { importReviewMessages, agentReasonWords } from './csv-file.tsx';
import { namesOfStoodSettings } from './settings-aside.tsx';
import { namesListedWithMore } from './destination.tsx';
/** What is typed in the box for a wish to the agent, and the plan it was typed for. */
export interface WishDraft {
  wish: string;
  ofPlan: ImportPlan;
  /** The wish put back into the box: '' once it is asked, the wish when it failed. */
  put: string | null;
}
/** Keeps the last draft typed, so that a box drawn again starts from it. */
export interface TypedKeeper {
  last(): WishDraft | null;
  keep(typed: WishDraft): void;
}
interface WishToAgentComposerProps {
  open: ImportOfAFile;
  isPlayed: boolean;
  typedKept: TypedKeeper;
  fieldRef: React.Ref<ChatComposerEditorHandle>;
  buttonsRef: React.Ref<HTMLDivElement>;
  onWished: (wish: string) => void;
  onAwaitedNoLonger: () => void;
}
interface AgentReadingMarkProps {
  children: React.ReactNode;
}
interface WishOutcomeLineProps {
  open: ImportOfAFile;
  leftUndoneRef: React.Ref<HTMLOutputElement>;
}
export function wishToPutBack({ agent }: Pick<ImportOfAFile, 'agent'>) {
  if (agent.kind === 'isAsked') return '';
  return agent.kind === 'hasFailed' ? agent.wish : null;
}
export function wishDraftFor(draft: WishDraft | null, open: ImportOfAFile): WishDraft {
  let putBack = wishToPutBack(open);
  if (draft !== null && draft.ofPlan === open.plan && draft.put === putBack) return draft;
  let keptWish = draft !== null && draft.ofPlan === open.plan ? draft.wish : '';
  return {
    wish: putBack ?? keptWish,
    ofPlan: open.plan,
    put: putBack,
  };
}
export function createTypedKeeper(): TypedKeeper {
  let lastTyped: WishDraft | null = null;
  return {
    last: () => lastTyped,
    keep: (typed) => void (lastTyped = typed),
  };
}
export function WishToAgentComposer({
  open,
  isPlayed,
  typedKept,
  fieldRef,
  buttonsRef,
  onWished,
  onAwaitedNoLonger,
}: WishToAgentComposerProps) {
  let [draft, setDraft] = React.useState(() => wishDraftFor(typedKept.last(), open));
  let draftNow = wishDraftFor(draft, open);
  if (draftNow !== draft) setDraft(draftNow);
  React.useEffect(() => typedKept.keep(draftNow));
  let { wish } = draftNow;
  let isOff = open.agent.kind === 'isAsked' || isImportPlanComing(open);
  let sendWish = () => {
    if (!isOff && !isPlayed && wish.trim() !== '') onWished(wish);
  };
  let onWishKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (!isOff && wish === '') return;
    event.stopPropagation();
    event.preventDefault();
    if (isOff) onAwaitedNoLonger();
    else
      setDraft({
        ...draftNow,
        wish: '',
      });
  };
  return <ChatComposer aria-label={importReviewMessages.wish()} busy={isOff} form="reply" cardClassName="[--cmp-font-size:var(--ui-font-size-body)]" editorRef={fieldRef} editor={{
      value: wish,
      onChange: (typedWish: string) =>
        setDraft({
          ...draftNow,
          wish: typedWish,
        }),
      placeholder: importReviewMessages.wish(),
      minLines: 1,
      maxHeight: '5.5rem',
      skipAutofocus: true,
      readOnly: isOff || isPlayed,
      onSubmit: sendWish,
      onKeyDownCapture: onWishKeyDown,
    }}><ChatComposer.Actions send={(isOff || wish.trim() !== '') &&
        (<ChatComposer.PrimaryAction ref={buttonsRef} onKeyDownCapture={onWishKeyDown} onClickCapture={(event) => {
            if (event.detail > 1) event.stopPropagation();
          }} state={isOff ? 'busy' : 'idle'} sendLabel={importReviewMessages.sendWish()} stopLabel={importReviewMessages.stop()} onSend={sendWish} onStop={onAwaitedNoLonger} />)} /></ChatComposer>;
}
export function AgentReadingMark({ children }: AgentReadingMarkProps) {
  return <span className="flex items-center gap-1.5"><span className="flex w-3 shrink-0 justify-center"><WorkingMark /></span><ShimmerText>{children}</ShimmerText></span>;
}
export function WishOutcomeLine({ open, leftUndoneRef }: WishOutcomeLineProps) {
  let { agent } = open;
  let hasWishInFlight = wishInFlight(open) !== null;
  let isLeftUndone = isWishLeftUndone(open);
  let stoodNames = 'stood' in agent ? namesOfStoodSettings(open, agent) : [];
  let isPlanStood = agent.kind === 'hasPlanned' && stoodNames.length > 0;
  let stoodList = namesListedWithMore(stoodNames);
  return <output className={hasWishInFlight || isLeftUndone || open.isAnAnswerInDoubt || isPlanStood
        ? '-mx-1 flex min-h-5 w-fit max-w-[calc(100%+0.5rem)] items-center rounded px-1 text-footnote [overflow-wrap:anywhere] leading-snug text-secondary focus-visible:shadow-focus focus-visible:outline-hidden'
        : 'sr-only'} {...(isLeftUndone && {
      ref: leftUndoneRef,
      tabIndex: -1,
    })}>{hasWishInFlight &&
        agent.kind === 'isAsked' &&
        <span className="ps-px"><AgentReadingMark>{importReviewMessages.agentChangesThePlan()}</AgentReadingMark></span>}{((hasWishInFlight && agent.kind === 'hasFailed') || isLeftUndone) && importReviewMessages.wishFailed()}{agent.kind === 'hasPlanned' && open.isAnAnswerInDoubt && importReviewMessages.answerStands()}{isPlanStood && importReviewMessages.theirSettingsWereKept(stoodList)}{agent.kind === 'hasChangedNothing' &&
        (agent.why !== null
          ? agentReasonWords(agent.why)
          : stoodNames.length > 0
            ? importReviewMessages.wishMetWhatTheySet(stoodList)
            : importReviewMessages.wishChangedNothing())}</output>;
}
export const IMPORT_FILE_NAME_MAX_CHARS = 100;
export const wishInFlight = ({ agent }: Pick<ImportOfAFile, 'agent'>) =>
  agent.kind === 'hasPlanned' || agent.kind === 'isNotToBeHad' || agent.kind === 'isToBeAsked' || agent.kind === 'wasStopped' ? null : agent.wish;
export const isWishLeftUndone = ({ agent }: Pick<ImportOfAFile, 'agent'>) => agent.kind === 'isNotToBeHad' && agent.leftUndone === 'wish';
export const hasFirstPlanFailed = ({ agent, isPlanByAgent }: Pick<ImportOfAFile, 'agent' | 'isPlanByAgent'>) =>
  !isPlanByAgent && (agent.kind === 'hasFailed' || agent.kind === 'wasStopped');
export const isFirstPlanLeftUndone = ({ agent }: Pick<ImportOfAFile, 'agent'>) =>
  agent.kind === 'isNotToBeHad' && agent.leftUndone === 'firstPlan';
