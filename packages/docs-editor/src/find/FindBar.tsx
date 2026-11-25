/**
 * The find bar: words to find, "n of m", previous / next, match case, the other tabs that have matches, and for someone
 * who may edit, a replacement with Replace and Replace all. ⌘F puts the keyboard in the find field, ⇧⌘H in the
 * replacement; Escape closes and lands on the match shown.
 */
import { Card, ChromeDivider, Tip, TipButton, TipGroup } from '@open-artifact/editor-kit/react';
import { Button, SwitchInput } from '@open-artifact/ui';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { type FocusEvent, type KeyboardEvent, type MouseEvent, type ReactElement, type ReactNode, useLayoutEffect, useRef } from 'react';
import { useDocs } from '../app/store.ts';
import { useEditor } from '../editor/format.ts';
import { closeFind, openFind, replace, setCaseSensitive, setQuery, setReplacement, step, undoFromBar } from './controller.ts';
import { findChord, undoChord } from './keys.ts';
import { OtherTabsRow, useOtherTabs } from './OtherTabs.tsx';
import { findState } from './plugin.ts';
import { CHIP_MATCH_WORDS, MAX_QUERY, ONLY_CHIPS_WORDS, isFrozen, outcomeWords } from './search.ts';
import { getFindBar, setFindBar, useFindBar } from './store.ts';

const FIELD =
  'h-7 w-full min-w-0 rounded-[8px] bg-chrome-field px-2 text-[13px] text-chrome-fg outline-none ring-1 ring-chrome-line placeholder:text-chrome-muted focus:ring-2 focus:ring-chrome-ring';

function Row({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex min-h-7 items-center gap-2">
      <label htmlFor={htmlFor} className="w-20 shrink-0 text-[12px] text-chrome-muted">
        {label}
      </label>
      <div className="flex min-w-0 flex-1 items-center gap-1">{children}</div>
    </div>
  );
}

/** A button whose tooltip says why it is off. */
function Why({ why, children }: { why: string | null; children: ReactElement<Record<string, unknown>> }): ReactNode {
  if (!why) return children;
  return (
    <Tip label={why}>
      <span className="inline-flex">{children}</span>
    </Tip>
  );
}

function Steps({ count }: { count: number }): ReactNode {
  return (
    <>
      <TipButton square tip="Previous match" shortcut="⇧↵" aria-label="Previous match" disabled={count === 0} onClick={() => step(-1)}>
        <ChevronUp className="size-4" strokeWidth={1.5} />
      </TipButton>
      <TipButton square tip="Next match" shortcut="↵" aria-label="Next match" disabled={count === 0} onClick={() => step(1)}>
        <ChevronDown className="size-4" strokeWidth={1.5} />
      </TipButton>
    </>
  );
}

/** Replaces from the bar, counting what ⌘Z there may undo. */
function replaceFromBar(all: boolean): void {
  if (replace(all)) setFindBar(state => ({ undoable: state.undoable + 1, redoable: 0 }));
}

function FindCard(): ReactNode {
  const writable = useDocs(state => state.writable);
  const { query, replacement, caseSensitive, summons, summoned, outcome } = useFindBar();
  const editorState = useEditor(state => state.state);
  const findField = useRef<HTMLInputElement>(null);
  const replaceField = useRef<HTMLInputElement>(null);
  const card = useRef<HTMLDivElement>(null);

  const found = findState(editorState);
  const inStep = found.query === query && found.caseSensitive === caseSensitive;
  const count = inStep ? found.matches.length : 0;
  const shown = inStep && count > 0 ? found.matches[found.current] : undefined;
  const frozen = !!(editorState && shown && !shown.chip && isFrozen(editorState.doc, shown));
  const onlyChips = inStep && count > 0 && found.matches.every(match => match.chip);
  const others = useOtherTabs(true, query, caseSensitive);

  useLayoutEffect(() => {
    const field = summoned === 'replace' && writable && getFindBar().query ? replaceField.current : findField.current;
    field?.focus();
    field?.select();
  }, [summons, summoned, writable]);

  const status = !query ? '' : count === 0 ? 'No matches' : `${found.current + 1} of ${count}`;
  const offAll = !query ? 'Type to search' : count === 0 ? 'No matches' : onlyChips ? ONLY_CHIPS_WORDS : null;
  const offOne = offAll ?? (shown?.chip ? CHIP_MATCH_WORDS : frozen ? 'This match can’t be replaced yet' : null);
  const words = outcomeWords(outcome) ?? (writable && onlyChips ? ONLY_CHIPS_WORDS : null);

  // Keys and clicks in the bar itself: a portaled menu's events also pass through here, and keep their own meaning.
  const inCard = (target: EventTarget) => target instanceof Node && !!card.current?.contains(target);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!inCard(event.target)) return;
    const chord = findChord(event);
    if (chord) {
      event.preventDefault();
      event.stopPropagation();
      openFind(chord);
      return;
    }
    const undoing = undoChord(event);
    if (undoing) {
      const bar = getFindBar();
      const left = undoing === 'undo' ? bar.undoable : bar.redoable;
      // Only replacements made here; otherwise the field undoes its own typing.
      if (left > 0) {
        event.preventDefault();
        if (undoFromBar(undoing === 'redo')) {
          setFindBar(undoing === 'undo' ? { undoable: bar.undoable - 1, redoable: bar.redoable + 1 } : { undoable: bar.undoable + 1, redoable: bar.redoable - 1 });
        }
      }
      return;
    }
    if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.stopPropagation();
      closeFind(true);
    }
  };

  const onMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    // A click on the bar's buttons keeps the keyboard in its field; menus and fields take their own clicks.
    const target = event.target;
    if (inCard(target) && target instanceof Element && !target.closest('input,textarea,[aria-haspopup],[role="switch"]')) event.preventDefault();
  };

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.relatedTarget instanceof Node && card.current?.contains(event.relatedTarget)) return;
    setFindBar({ undoable: 0, redoable: 0 });
  };

  return (
    <TipGroup>
      <Card
        ref={card}
        role="search"
        aria-label={writable ? 'Find and replace' : 'Find'}
        className="absolute right-4 top-3 z-30 flex max-h-[calc(100%-1.5rem)] w-80 flex-col items-stretch gap-2 overflow-y-auto p-3"
        onKeyDown={onKeyDown}
        onMouseDown={onMouseDown}
        onBlur={onBlur}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[13px] font-medium">{writable ? 'Find and replace' : 'Find'}</h2>
          <TipButton square tip="Close" shortcut="Esc" aria-label="Close" onClick={() => closeFind(true)}>
            <X className="size-4" strokeWidth={1.5} />
          </TipButton>
        </div>

        <Row label="Find" htmlFor="doc-find-query">
          <div className="relative min-w-0 flex-1">
            <input
              ref={findField}
              id="doc-find-query"
              type="text"
              spellCheck={false}
              autoComplete="off"
              maxLength={MAX_QUERY}
              value={query}
              className={`${FIELD} ${status ? 'pr-16' : ''}`}
              onChange={event => setQuery(event.target.value)}
              onKeyDown={event => {
                if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
                event.preventDefault();
                step(event.shiftKey ? -1 : 1);
              }}
            />
            {status ? (
              <span aria-live="polite" className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-[12px] tabular-nums text-chrome-muted">
                {status}
              </span>
            ) : null}
          </div>
          {writable ? null : <Steps count={count} />}
        </Row>

        {writable ? (
          <Row label="Replace with" htmlFor="doc-find-replacement">
            <input
              ref={replaceField}
              id="doc-find-replacement"
              type="text"
              spellCheck={false}
              autoComplete="off"
              value={replacement}
              className={FIELD}
              onChange={event => setReplacement(event.target.value)}
              onKeyDown={event => {
                if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.repeat || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
                event.preventDefault();
                if (!offOne) replaceFromBar(false);
              }}
            />
          </Row>
        ) : null}

        <Row label="Match case">
          <SwitchInput aria-label="Match case" checked={caseSensitive} onChange={setCaseSensitive} />
        </Row>

        {others.shown ? (
          <Row label="Other tabs">
            <OtherTabsRow view={others} findField={findField} />
          </Row>
        ) : null}

        {writable ? (
          <>
            <ChromeDivider vertical={false} />
            <div className="flex items-center gap-1">
              <Steps count={count} />
              <div className="ml-auto flex items-center gap-2">
                <Why why={offAll}>
                  <Button size="sm" variant="secondary" disabled={!!offAll} onClick={() => replaceFromBar(true)}>
                    Replace all
                  </Button>
                </Why>
                <Why why={offOne}>
                  <Button size="sm" variant="primary" disabled={!!offOne} onClick={() => replaceFromBar(false)}>
                    Replace
                  </Button>
                </Why>
              </div>
            </div>
          </>
        ) : null}

        <p aria-live="polite" className={words ? 'text-[12px] leading-4 text-chrome-muted' : 'sr-only'}>
          {words ?? ''}
        </p>
        <p aria-live="polite" className="sr-only">
          {others.rows.length ? `Found in ${others.rows.length} other ${others.rows.length === 1 ? 'tab' : 'tabs'}` : ''}
        </p>
      </Card>
    </TipGroup>
  );
}

/** The `float` slot's find bar, drawn while find is open. */
export function FindBar(): ReactNode {
  const open = useDocs(state => state.find !== 'closed');
  return open ? <FindCard /> : null;
}
