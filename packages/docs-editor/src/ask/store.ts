/** The ask prompts: the one opened from the @ menu, what each box holds, and which one is sending. */
import { create } from 'zustand';
import type { AskEntry } from './ask.ts';

export interface AskState {
  prompt: { tab: string } | null;
  drafts: Record<AskEntry, string>;
  sending: AskEntry | null;
}

export const useAsk = create<AskState>(() => ({ prompt: null, drafts: { caret: '', empty: '' }, sending: null }));
export const getAsk = useAsk.getState;
export const setAsk = useAsk.setState;

export const setDraft = (entry: AskEntry, text: string): void => setAsk(state => ({ drafts: { ...state.drafts, [entry]: text } }));
