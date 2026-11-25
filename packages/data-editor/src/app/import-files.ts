/**
 * Import a file on the empty page: the picked files are stored as uploads,
 * then the agent is asked to build the picked format from them.
 */

import {
  MAX_IMPORT_FILE_BYTES,
  importPrompt,
  importSelection,
  importedFileKind,
  type ImportedFile,
  type ImportedFileKind,
} from '@open-artifact/data-core';
import { toast } from '@open-artifact/ui';
import { sendPageRequest } from '../drafts/request.ts';
import { resolveStoredAssetUrl, uploadAsset } from '../platform/assets.ts';
import { useEmptyPage } from '../state/empty-page.ts';
import { importFailedMessage, largeImportMessage, unreadableImportMessage } from './words.ts';

interface PickedFile {
  file: File;
  kind: ImportedFileKind;
}

/** The files the import takes, or `null` after saying why it takes none of them. */
function checkPicked(files: readonly File[]): PickedFile[] | null {
  const picked: PickedFile[] = [];
  const unreadable: string[] = [];
  for (const file of files) {
    const kind = importedFileKind(file.name, file.type);
    if (kind === null) unreadable.push(file.name);
    else picked.push({ file, kind });
  }
  if (unreadable.length > 0) {
    toast.add({ title: unreadableImportMessage(unreadable), timeout: 8000 });
    return null;
  }
  const large = picked.find(({ file }) => file.size > MAX_IMPORT_FILE_BYTES);
  if (large !== undefined) {
    toast.add({ title: largeImportMessage(large.file.name, MAX_IMPORT_FILE_BYTES), timeout: 8000 });
    return null;
  }
  return picked;
}

async function store({ file, kind }: PickedFile): Promise<ImportedFile | null> {
  const stored = await uploadAsset(file, { name: file.name });
  const url = 'refused' in stored ? null : resolveStoredAssetUrl(stored);
  if (url === null) {
    toast.add({ title: importFailedMessage(file.name), timeout: 8000 });
    return null;
  }
  return { name: file.name, url, kind };
}

/** Uploads the files and hands them to the agent with the picked format; true when the request went out. */
export async function importFiles(files: readonly File[]): Promise<boolean> {
  if (files.length === 0 || useEmptyPage.getState().importing) return false;
  const picked = checkPicked(files);
  if (picked === null) return false;
  useEmptyPage.setState({ importing: true });
  try {
    const stored: ImportedFile[] = [];
    for (const item of picked) {
      const file = await store(item);
      if (file === null) return false;
      stored.push(file);
    }
    const { form } = useEmptyPage.getState();
    const selection = importSelection(form, stored);
    return await sendPageRequest({ title: selection.label, request: importPrompt(form, stored), selection });
  } finally {
    useEmptyPage.setState({ importing: false });
  }
}
