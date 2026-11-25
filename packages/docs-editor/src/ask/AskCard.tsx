/** The ask prompts: one under the line where Ask Agent was picked from the @ menu, one docked under an empty doc. */
import { ChromeButton } from '@open-artifact/editor-kit/react';
import { isComposingKey } from '@open-artifact/ui';
import { ArrowUp, LoaderCircle, Sparkles, X } from 'lucide-react';
import { type ReactNode, type RefObject, useEffect, useRef } from 'react';
import { useDocs } from '../app/store.ts';
import { useRefused } from '../comments/refused.ts';
import { useCommentUi } from '../comments/store.ts';
import { useEditor } from '../editor/format.ts';
import { bodyIsEmpty } from '../layouts/layouts.ts';
import { useSuggestMode } from '../suggest/mode.ts';
import { ASK_PLACEHOLDER, ASK_STARTERS, type AskEntry } from './ask.ts';
import { canAskInText, closeAsk, sendAsk } from './actions.ts';
import { askSpotOf } from './spot.ts';
import { setDraft, useAsk } from './store.ts';

function useAskOffered(): boolean {
  useCommentUi(state => state.agent);
  useDocs(state => state.writable);
  useSuggestMode(state => state.suggesting);
  return canAskInText();
}

function AskField({ entry, field, onEscape }: { entry: AskEntry; field: RefObject<HTMLInputElement | null>; onEscape?: () => void }): ReactNode {
  const text = useAsk(state => state.drafts[entry]);
  const sending = useAsk(state => state.sending === entry);
  return (
    <>
      <Sparkles className="size-4 flex-none text-chrome-accent" aria-hidden />
      <input
        ref={field}
        value={text}
        readOnly={sending}
        onChange={event => setDraft(entry, event.target.value)}
        onKeyDown={event => {
          if (isComposingKey(event.nativeEvent)) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            void sendAsk(entry);
          } else if (event.key === 'Escape' && onEscape && !sending) {
            event.preventDefault();
            onEscape();
          }
        }}
        placeholder={ASK_PLACEHOLDER}
        aria-label={ASK_PLACEHOLDER}
        className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-chrome-muted"
      />
      {onEscape ? (
        <ChromeButton square aria-label="Close" disabled={sending} className="h-6 w-6 text-chrome-muted" onClick={onEscape}>
          <X className="size-3.5" />
        </ChromeButton>
      ) : null}
      <ChromeButton
        square
        aria-label="Send to Agent"
        disabled={!text.trim() || sending}
        onMouseDown={event => event.preventDefault()}
        onClick={() => void sendAsk(entry)}
        className="h-6 w-6 rounded-full bg-chrome-accent text-white hover:bg-chrome-accent hover:brightness-110"
      >
        {sending ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> : <ArrowUp className="size-3.5" strokeWidth={2.25} />}
      </ChromeButton>
    </>
  );
}

const CARD = 'flex items-center gap-2 rounded-[10px] border border-chrome-line bg-chrome px-2.5 py-1.5 text-chrome-fg shadow-chrome-popup';
const WIDTH = 480;

/** Under the spot's line, against `.doc-page`, kept inside the text's width. */
function seatOf(): { left: number; top: number; width: number } | null {
  const view = useEditor.getState().view;
  const spot = view ? askSpotOf(view.state) : null;
  const page = view?.dom.closest('.doc-page');
  if (!view || spot === null || !page) return null;
  const pageBox = page.getBoundingClientRect();
  const text = view.dom.getBoundingClientRect();
  const at = view.coordsAtPos(spot);
  const width = Math.min(text.width, WIDTH);
  const left = Math.min(Math.max(at.left - 12, text.left), text.right - width);
  return { left: left - pageBox.left, top: at.bottom - pageBox.top + 6, width };
}

export function AskCard(): ReactNode {
  const prompt = useAsk(state => state.prompt);
  const tab = useEditor(state => state.tab);
  useEditor(state => state.state);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (prompt) requestAnimationFrame(() => field.current?.focus());
  }, [prompt]);
  if (!prompt || prompt.tab !== tab) return null;
  const seat = seatOf();
  if (!seat) return null;
  return (
    <div className={`absolute z-20 ${CARD}`} style={seat} data-testid="ask-prompt">
      <AskField entry="caret" field={field} onEscape={() => closeAsk()} />
    </div>
  );
}

export function EmptyDocAsk(): ReactNode {
  const doc = useEditor(state => state.state?.doc);
  const tab = useEditor(state => state.tab);
  const refused = useRefused(state => state.drafts.length > 0);
  const offered = useAskOffered();
  const field = useRef<HTMLInputElement>(null);
  // The refused-comment notes take the same place at the bottom.
  if (!doc || !tab || !offered || refused || !bodyIsEmpty(doc)) return null;
  const start = (text: string) => {
    setDraft('empty', text);
    requestAnimationFrame(() => {
      const input = field.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(text.length, text.length);
    });
  };
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 z-30 flex justify-center px-4" data-testid="ask-dock">
      <div className="pointer-events-auto flex w-full max-w-[560px] flex-col gap-2">
        <div className={CARD}>
          <AskField entry="empty" field={field} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {ASK_STARTERS.map(starter => (
            <ChromeButton key={starter.label} className="h-7 rounded-full border border-chrome-line bg-chrome px-3 text-[12px] text-chrome-muted" onClick={() => start(starter.text)}>
              {starter.label}
            </ChromeButton>
          ))}
        </div>
      </div>
    </div>
  );
}
