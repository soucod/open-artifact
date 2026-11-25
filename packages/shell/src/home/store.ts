/** The home page's store: the library, the types, the host and the open dialogs. */

import { create } from 'zustand';
import type { ArtifactView, TypeView, TypesResponse } from '@open-artifact/protocol';
import type { HomeHost } from './host.ts';
import type { TrashedView } from './trash.ts';
import type { UploadEvent, UploadState } from './upload.ts';
import { uploadStep } from './upload.ts';

/** The home page's tabs. */
export type HomeTab = 'artifacts' | 'types';

/** The cloud home page's tabs. */
export type CloudTab = 'artifacts' | 'trash';

/** The tab the cloud home page opens on: the Trash for `/#trash` (where a trashed artifact's address sends its owner). */
export function initialCloudTab(hash: string = typeof location === 'undefined' ? '' : location.hash): CloudTab {
  return hash === '#trash' ? 'trash' : 'artifacts';
}

/** State of the home page. */
export interface HomeState {
  tab: HomeTab;
  /** Every artifact; `null` until loaded. */
  artifacts: ArtifactView[] | null;
  /** The types and their roots; `null` until loaded. */
  types: TypesResponse | null;
  /** The last load failure. */
  error: string | null;
  /** The embedding host, once it said hello. */
  host: HomeHost | null;
  /** The type the create dialog makes, while it is open. */
  creating: TypeView | null;
  /** The "New type" dialog is open. */
  makingType: boolean;
  /** The "Install type" dialog, while it is open: `update` names the installed type it updates. */
  installing: { update?: string } | null;
  /** The artifact the rename dialog renames, while it is open. */
  renaming: ArtifactView | null;
  /** The artifact just deleted, while its undo shows (`trash`: on a cloud host, moved to the trash). */
  undo: { id: string; title: string; trash?: boolean } | null;
  /** The cloud home page's tab. */
  cloudTab: CloudTab;
  /** The cloud home page's trash; `null` until loaded. */
  trash: TrashedView[] | null;
  /** The host said it cannot delete for good (501): "Delete forever" is not offered any more. */
  purgeUnsupported: boolean;
  /** The trashed artifact the "Delete forever" confirmation is about, while it is open. */
  purging: { id: string; title: string } | null;
  /** The upload of a zip (cloud home page). */
  upload: UploadState;
}

/** Changes to the home page's state. */
export interface HomeActions {
  setTab(tab: HomeTab): void;
  setArtifacts(artifacts: ArtifactView[]): void;
  setTypes(types: TypesResponse): void;
  setError(error: string | null): void;
  setHost(host: HomeHost): void;
  setCreating(type: TypeView | null): void;
  setMakingType(open: boolean): void;
  setInstalling(installing: HomeState['installing']): void;
  setRenaming(artifact: ArtifactView | null): void;
  setUndo(undo: HomeState['undo']): void;
  setCloudTab(tab: CloudTab): void;
  setTrash(trash: TrashedView[] | null): void;
  setPurgeUnsupported(): void;
  setPurging(purging: HomeState['purging']): void;
  uploadEvent(event: UploadEvent): void;
}

const TAB_KEY = 'open-artifact.tab';

function savedTab(): HomeTab {
  try {
    return localStorage.getItem(TAB_KEY) === 'types' ? 'types' : 'artifacts';
  } catch {
    return 'artifacts';
  }
}

/** The home page's store. */
export const useHome = create<HomeState & HomeActions>()((set) => ({
  tab: savedTab(),
  artifacts: null,
  types: null,
  error: null,
  host: null,
  creating: null,
  makingType: false,
  installing: null,
  renaming: null,
  undo: null,
  cloudTab: initialCloudTab(),
  trash: null,
  purgeUnsupported: false,
  purging: null,
  upload: { kind: 'idle' },

  setTab: (tab) => {
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      // Not remembered; fine.
    }
    set({ tab });
  },
  setArtifacts: (artifacts) => set({ artifacts }),
  setTypes: (types) => set({ types }),
  setError: (error) => set({ error }),
  setHost: (host) => set({ host }),
  setCreating: (creating) => set({ creating }),
  setMakingType: (makingType) => set({ makingType }),
  setInstalling: (installing) => set({ installing }),
  setRenaming: (renaming) => set({ renaming }),
  setUndo: (undo) => set({ undo }),
  setCloudTab: (cloudTab) => set({ cloudTab }),
  setTrash: (trash) => set({ trash }),
  setPurgeUnsupported: () => set({ purgeUnsupported: true }),
  setPurging: (purging) => set({ purging }),
  uploadEvent: (event) => set((state) => ({ upload: uploadStep(state.upload, event) })),
}));
