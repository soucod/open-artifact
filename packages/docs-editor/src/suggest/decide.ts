/**
 * Deciding suggestions: accept, reject or withdraw one or all of them, take the last decision back, and move between
 * them. A decision is the page's own write through the tab's sync, so the text shows it at once.
 */
import { announce } from '@open-artifact/editor-kit';
import { proposalIds, proposalParts, suggestionAsOf } from '@open-artifact/docs-core';
import { Selection } from 'prosemirror-state';
import { docClient } from '../app/doc-client.ts';
import { getDocs, setDocs } from '../app/store.ts';
import { currentView, useEditor } from '../editor/format.ts';
import { unfoldSuggestion } from './folded.ts';
import { refreshOpenSuggestions, useOpenSuggestions } from './model.ts';
import { firstPosOf } from './positions.ts';
import { editSerialOf } from './plugin.ts';
import { getSuggest, setSuggest, showNotice, type Verdict } from './store.ts';

type Json = Record<string, unknown>;

const PAST: Record<Verdict, string> = { accept: 'accepted', reject: 'rejected', withdraw: 'withdrawn' };
const RUNNING: Record<Verdict, string> = { accept: 'Accepting…', reject: 'Rejecting…', withdraw: 'Withdrawing…' };

const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

function decidedLine(verdict: Verdict, count: number): string {
  return count === 1 ? `Suggestion ${PAST[verdict]}` : `${count} suggestions ${PAST[verdict]}`;
}

/** The suggestion after `id` in the shown tab (or before it, when it is the last), once `id` is decided. */
function neighbourOf(ids: readonly string[]): string | null {
  const order = useOpenSuggestions.getState().cards.map(card => card.id);
  const gone = new Set(ids);
  const at = order.findIndex(id => gone.has(id));
  if (at < 0) return null;
  return order.slice(at).find(id => !gone.has(id)) ?? order.slice(0, at).reverse().find(id => !gone.has(id)) ?? null;
}

/** Accepts, rejects or withdraws suggestions of a tab; one write, so one Undo takes them all back. */
export async function decide(tab: string, ids: readonly string[], verdict: Verdict): Promise<void> {
  if (!getDocs().writable || getSuggest().busy || !ids.length) return;
  const many = ids.length > 1;
  if (many) {
    setSuggest({ busy: true });
    showNotice(RUNNING[verdict]);
  }
  try {
    const open = await docClient().tab(tab);
    const shadow = open.sync.shadow;
    const taken = ids.filter(id => proposalParts(shadow.blocks, id).length > 0);
    if (!taken.length) {
      showNotice(`Nothing to ${verdict}. ${ids.length === 1 ? 'This had' : 'These had'} already been decided.`);
      return;
    }
    const focused = getDocs().focusedSuggestion;
    const view = currentView();
    const editSerial = view && useEditor.getState().tab === tab ? editSerialOf(view.state) : -1;
    const next = focused && taken.includes(focused) ? neighbourOf(taken) : focused;
    open.sync.write(taken.map(id => ({ op: 'decide', suggestId: id, verdict, asOf: suggestionAsOf(shadow.blocks, id) })));
    setSuggest({ last: { tab, ids: taken, verdict, editSerial }, hoveredCard: null, hoveredText: null });
    setDocs({ focusedSuggestion: next });
    refreshOpenSuggestions();
    const line = decidedLine(verdict, taken.length);
    showNotice(line, true);
    announce(line);
    await open.sync.settled();
    // A suggestion that changed meanwhile is refused and stays open.
    const left = new Set(proposalIds(open.sync.shadow.blocks));
    const stillOpen = taken.filter(id => left.has(id)).length;
    if (!stillOpen) return;
    const done = taken.length - stillOpen;
    if (!done) {
      if (getSuggest().last?.ids === taken) setSuggest({ last: null });
      showNotice(stillOpen === 1 ? 'This suggestion changed. Have another look.' : `${stillOpen} need a look`);
    } else showNotice(`${decidedLine(verdict, done)}. ${stillOpen} need a look`, true);
  } catch (error) {
    showNotice(error instanceof Error ? `Couldn’t ${verdict}: ${error.message}` : `Couldn’t ${verdict}`);
  } finally {
    if (many) setSuggest({ busy: false });
  }
}

/** Every open suggestion of the shown tab. */
export function decideAll(verdict: Verdict): Promise<void> {
  const { tab, cards } = useOpenSuggestions.getState();
  if (!tab) return Promise.resolve();
  return decide(
    tab,
    cards.map(card => card.id),
    verdict,
  );
}

interface Undone {
  suggestId: string;
  outcome: string;
  why?: string;
}

function undoneIn(answer: Json, ids: ReadonlySet<string>): Undone[] {
  const found: Undone[] = [];
  const take = (value: unknown) => {
    if (!isRecord(value) || typeof value.suggestId !== 'string' || !ids.has(value.suggestId)) return;
    if (found.some(item => item.suggestId === value.suggestId)) return;
    found.push({ suggestId: value.suggestId, outcome: String(value.outcome ?? ''), ...(typeof value.why === 'string' ? { why: value.why } : {}) });
  };
  if (Array.isArray(answer.results)) for (const result of answer.results) if (isRecord(result)) take(result.undecided);
  take(answer.undecided);
  return found;
}

/** Takes the last decision back: its suggestions open again where nothing was written over them since. */
export async function undoLastDecision(): Promise<void> {
  const last = getSuggest().last;
  if (!last || getSuggest().busy || !getDocs().writable) return;
  setSuggest({ busy: true, last: null });
  showNotice('Undoing…');
  const ids = new Set(last.ids);
  const outcomes: Undone[] = [];
  const off = docClient().onAnswer((tab, answer) => {
    if (tab === last.tab) outcomes.push(...undoneIn(answer, ids).filter(item => !outcomes.some(seen => seen.suggestId === item.suggestId)));
  });
  try {
    const open = await docClient().tab(last.tab);
    // The decision has to be on the server (and in its record) before it can be taken back.
    await open.sync.settled();
    // Last decided first: each decision is taken back over the text as the later ones left it.
    open.sync.write([...last.ids].reverse().map(id => ({ op: 'undecide', suggestId: id })));
    await open.sync.settled();
    // The page keeps no record of its decisions: the server restores them, and the tab is read again to show it.
    open.sync.reconnected();
    await open.sync.settled();
    refreshOpenSuggestions();
    const reopened = proposalIds(open.sync.shadow.blocks).filter(id => ids.has(id));
    const count = last.ids.length;
    const past = PAST[last.verdict];
    let line: string;
    if (reopened.length === count) line = count === 1 ? 'Suggestion is back' : `${count} suggestions are back`;
    else if (reopened.length) line = `${reopened.length} suggestions are back. ${count - reopened.length} stay ${past}.`;
    else if (outcomes.some(item => item.why === 'all_written_since')) line = 'Undo stopped, to keep your other changes';
    else line = `Couldn’t undo. ${count === 1 ? 'It stays' : `${count} stay`} ${past}.`;
    showNotice(line);
    announce(line);
    if (reopened[0] && useEditor.getState().tab === last.tab) setDocs({ focusedSuggestion: reopened[0] });
  } catch (error) {
    showNotice(error instanceof Error ? `Couldn’t undo: ${error.message}` : 'Couldn’t undo');
  } finally {
    off();
    setSuggest({ busy: false });
  }
}

/** The undo keys: take back the decision made right before, while the person has not edited since. */
export function undoDecisionByKeys(state: Parameters<typeof editSerialOf>[0]): boolean {
  const { last, busy } = getSuggest();
  if (!last || busy || last.tab !== useEditor.getState().tab || last.editSerial !== editSerialOf(state)) return false;
  void undoLastDecision();
  return true;
}

// ---- moving between suggestions --------------------------------------------------------------------------------

/**
 * Looks at a suggestion: raises its card, unfolds the sections hiding it, scrolls its words into sight and puts the
 * caret at its start. `focusText` also gives the text the keyboard.
 */
export function revealSuggestion(id: string, focusText = false): void {
  setDocs({ focusedSuggestion: id });
  const view = currentView();
  if (!view) return;
  const pos = firstPosOf(view.state.doc, id);
  if (pos === null) return;
  unfoldSuggestion(view, id);
  const selection = Selection.near(view.state.doc.resolve(Math.min(pos, view.state.doc.content.size)), 1);
  view.dispatch(view.state.tr.setSelection(selection).scrollIntoView().setMeta('addToHistory', false));
  if (focusText) view.focus();
}

/** The suggestion `step` away from the looked-at one (wrapping round); the first one when none is looked at. */
export function stepSuggestion(step: 1 | -1, focusText = false): string | null {
  const order = useOpenSuggestions.getState().cards.map(card => card.id);
  if (!order.length) return null;
  const current = getDocs().focusedSuggestion;
  const at = current ? order.indexOf(current) : -1;
  const next = at < 0 ? order[step > 0 ? 0 : order.length - 1]! : order[(at + step + order.length) % order.length]!;
  revealSuggestion(next, focusText);
  return next;
}
