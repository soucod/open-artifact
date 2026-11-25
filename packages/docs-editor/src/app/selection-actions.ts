/** What the selection toolbar offers beyond formatting, filled by the features that answer them. */
import type { ComponentType } from 'react';
import { create } from 'zustand';

export type SelectionActionKey = 'comment' | 'react';

/** One extra button of the selection toolbar. */
export interface SelectionAction {
  label: string;
  /** Shown in the tooltip, e.g. `Mod-Alt-m`. */
  shortcut?: string;
  icon: ComponentType<{ className?: string }>;
  /** False hides the button for the current selection and viewer. */
  available(): boolean;
  /** Runs with the toolbar's own element, for anchoring a popover. */
  run(anchor: HTMLElement): void;
}

interface SelectionActionsState {
  actions: Partial<Record<SelectionActionKey, SelectionAction>>;
}

export const useSelectionActions = create<SelectionActionsState>(() => ({ actions: {} }));

/** Offers `action` on the selection toolbar until the returned function is called. */
export function provideSelectionAction(key: SelectionActionKey, action: SelectionAction): () => void {
  useSelectionActions.setState(state => ({ actions: { ...state.actions, [key]: action } }));
  return () => {
    useSelectionActions.setState(state => {
      if (state.actions[key] !== action) return state;
      const { [key]: _removed, ...rest } = state.actions;
      return { actions: rest };
    });
  };
}
