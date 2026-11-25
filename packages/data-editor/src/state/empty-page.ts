import { create } from 'zustand';
import { DEFAULT_DASHBOARD_FORM } from '@open-artifact/data-core';

/** The empty page's choices: the format picked for the first build, and files on their way to the agent. */
export interface EmptyPageState {
  form: string;
  importing: boolean;
}

export const useEmptyPage = create<EmptyPageState>(() => ({ form: DEFAULT_DASHBOARD_FORM, importing: false }));

export function pickForm(form: string): void {
  useEmptyPage.setState({ form });
}
