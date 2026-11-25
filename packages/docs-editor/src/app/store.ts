/** What the page shows around the text: the doc, the open tab, who may do what, and which panels are open. */
import type { DocEnum, DocFile, DocProject, DocSuggestion } from '@open-artifact/runtime/doc-api';
import { useMemo } from 'react';
import { create } from 'zustand';
import type { SyncStatus } from '../sync/tab-sync.ts';

export type AppPhase = { kind: 'opening' } | { kind: 'ready' } | { kind: 'failed'; message: string };

/** Where comments are shown: beside the text, hidden, or every thread in one list. */
export type CommentsView = 'margin' | 'hidden' | 'all';

export type FindMode = 'closed' | 'find' | 'replace';

/** How the page shows the doc, kept in the project's display record. */
export interface DocDisplay {
  headingFont: 'serif' | 'sans';
  textFont: 'serif' | 'sans';
  pageWidth: 'default' | 'wide';
  tabsLocation: 'menu' | 'left';
}

export const DEFAULT_DISPLAY: DocDisplay = { headingFont: 'serif', textFont: 'sans', pageWidth: 'default', tabsLocation: 'menu' };

export interface Me {
  id: string;
  name: string;
}

export interface DocsState {
  phase: AppPhase;
  project: DocProject | null;
  me: Me | null;
  writable: boolean;
  commentable: boolean;
  activeTab: string | null;
  /** Each open tab's save state. */
  saving: Record<string, SyncStatus>;
  /** Each open tab's open suggestions. */
  suggestions: Record<string, DocSuggestion[]>;
  comments: CommentsView;
  history: boolean;
  find: FindMode;
  shortcuts: boolean;
  /** The suggestion the person is looking at (its card is raised). */
  focusedSuggestion: string | null;
}

export const useDocs = create<DocsState>(() => ({
  phase: { kind: 'opening' },
  project: null,
  me: null,
  writable: false,
  commentable: false,
  activeTab: null,
  saving: {},
  suggestions: {},
  comments: 'margin',
  history: false,
  find: 'closed',
  shortcuts: false,
  focusedSuggestion: null,
}));

export const setDocs = useDocs.setState;
export const getDocs = useDocs.getState;

/** The tabs in the order the doc lists them, each followed by its subtabs. */
export function orderedTabs(files: readonly DocFile[]): Array<DocFile & { depth: number }> {
  const byOrder = (a: DocFile, b: DocFile) => (a.order < b.order ? -1 : a.order > b.order ? 1 : a.id < b.id ? -1 : 1);
  const ids = new Set(files.map(file => file.id));
  const children = new Map<string | undefined, DocFile[]>();
  for (const file of files) {
    const parent = file.subtabOf && ids.has(file.subtabOf) && file.subtabOf !== file.id ? file.subtabOf : undefined;
    const list = children.get(parent) ?? [];
    list.push(file);
    children.set(parent, list);
  }
  const out: Array<DocFile & { depth: number }> = [];
  const seen = new Set<string>();
  const visit = (parent: string | undefined, depth: number) => {
    for (const file of (children.get(parent) ?? []).sort(byOrder)) {
      if (seen.has(file.id)) continue;
      seen.add(file.id);
      out.push({ ...file, depth });
      visit(file.id, depth + 1);
    }
  };
  visit(undefined, 0);
  for (const file of files) if (!seen.has(file.id)) out.push({ ...file, depth: 0 });
  return out;
}

export function displayOf(record: DocProject['display']): DocDisplay {
  const raw = record ?? {};
  const pick = <K extends keyof DocDisplay>(key: K, allowed: readonly DocDisplay[K][]): DocDisplay[K] =>
    allowed.includes(raw[key] as DocDisplay[K]) ? (raw[key] as DocDisplay[K]) : DEFAULT_DISPLAY[key];
  return {
    headingFont: pick('headingFont', ['serif', 'sans']),
    textFont: pick('textFont', ['serif', 'sans']),
    pageWidth: pick('pageWidth', ['default', 'wide']),
    tabsLocation: pick('tabsLocation', ['menu', 'left']),
  };
}

export function useDisplay(): DocDisplay {
  const record = useDocs(state => state.project?.display);
  return useMemo(() => displayOf(record), [record]);
}

export const enumById = (enums: readonly DocEnum[] | undefined, id: string) => enums?.find(item => item.id === id) ?? null;
