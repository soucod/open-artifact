/**
 * Uploading an artifact's zip to a cloud host from its home page: the other half of the local Shell's Export tab
 * "Whole folder (.zip)". Pure: no DOM, no store, so it runs under `node --test`.
 *
 * The page sends the file as it is to `POST /api/open-artifact.artifacts.import` (`application/zip`, same-origin) and
 * opens the artifact the host answers with (201, an `ArtifactView`). The host's refusals are said in plain words: 401
 * signed out, 413 too large (with the host's own limit when its message names one: the page never assumes a number),
 * 415 not a zip, 400 not an artifact or a type the site does not have, 409 a clash. A zip larger than the limit the
 * host put in the home page's boot (`cloud.limits.importBytes`) is refused before any byte is sent
 * ({@link tooLargeToSend}).
 */

import type { MessageKey } from '../lib/i18n.ts';

/** A message key and what fills it. */
export interface Said {
  key: MessageKey;
  vars?: Record<string, string | number>;
}

/** Where an upload stands. */
export type UploadState =
  | { kind: 'idle' }
  /** The bytes are on their way: `loaded` of `total` (total 0 when the browser does not know yet). */
  | { kind: 'sending'; name: string; loaded: number; total: number }
  /** All sent: the site unpacks and checks it. */
  | { kind: 'checking'; name: string }
  /** The site took it: the page opens the artifact. */
  | { kind: 'done'; name: string; id: string }
  | { kind: 'failed'; name: string; said: Said };

/** What happens to an upload. */
export type UploadEvent =
  | { type: 'start'; name: string; size: number }
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'sent' }
  | { type: 'done'; id: string }
  | { type: 'failed'; said: Said }
  | { type: 'dismiss' };

/** The next state of an upload. Events that do not fit the current state (a late progress event) change nothing. */
export function uploadStep(state: UploadState, event: UploadEvent): UploadState {
  switch (event.type) {
    case 'start':
      // One upload at a time.
      if (state.kind === 'sending' || state.kind === 'checking') return state;
      return { kind: 'sending', name: event.name, loaded: 0, total: event.size };
    case 'progress':
      if (state.kind !== 'sending') return state;
      return { ...state, loaded: Math.max(state.loaded, event.loaded), total: event.total || state.total };
    case 'sent':
      return state.kind === 'sending' ? { kind: 'checking', name: state.name } : state;
    case 'done':
      return state.kind === 'sending' || state.kind === 'checking' ? { kind: 'done', name: state.name, id: event.id } : state;
    case 'failed':
      return state.kind === 'idle' || state.kind === 'done' ? state : { kind: 'failed', name: state.name, said: event.said };
    case 'dismiss':
      return state.kind === 'failed' ? { kind: 'idle' } : state;
  }
}

/** Whether an upload is under way (the Upload button waits). */
export function uploadBusy(state: UploadState): boolean {
  return state.kind === 'sending' || state.kind === 'checking' || state.kind === 'done';
}

/** How far the bytes are, 0-100 (whole numbers), or `null` when the size is unknown. */
export function uploadPercent(state: UploadState): number | null {
  if (state.kind === 'checking' || state.kind === 'done') return 100;
  if (state.kind !== 'sending' || state.total <= 0) return null;
  return Math.min(100, Math.floor((state.loaded / state.total) * 100));
}

/** A file the person picked or dropped looks like a zip (by its name or its type); anything else is refused here. */
export function isZipFile(file: { name: string; type: string }): boolean {
  const type = file.type.toLowerCase();
  return /\.zip$/i.test(file.name) || type === 'application/zip' || type === 'application/x-zip-compressed';
}

/** The first zip among dropped or picked files, or why there is none. */
export function pickZip<F extends { name: string; type: string }>(files: readonly F[]): { file: F } | { said: Said } | null {
  if (!files.length) return null;
  const zip = files.find(isZipFile);
  return zip ? { file: zip } : { said: { key: 'uploadNotZip' } };
}

/**
 * Why a zip of `size` bytes is not sent at all: larger than the host's limit (`importBytes`, from the home boot). `null`
 * when it may go, or when the host named no limit (it still refuses with 413, said by {@link uploadFailure}).
 */
export function tooLargeToSend(size: number, importBytes: number | undefined): Said | null {
  if (importBytes === undefined || !(importBytes > 0) || size <= importBytes) return null;
  return { key: 'uploadTooLargeLimit', vars: { limit: sizeText(importBytes) } };
}

/** A drag carries files (a drag of text or a link from the page does not). */
export function dragHasFiles(types: readonly string[] | null | undefined): boolean {
  return !!types && types.includes('Files');
}

/** A size in words: `12 KB`, `3.4 MB`, `1.2 GB`. */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value >= 10 || Number.isInteger(value) ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** The limit a host's "too large" message names (`… larger than 104857600 bytes.`), in words; `null` when it names none. */
export function limitOf(message: string): string | null {
  const match = /(\d{4,})\s*bytes/i.exec(message);
  if (!match) return null;
  const bytes = Number(match[1]);
  return Number.isFinite(bytes) && bytes > 0 ? sizeText(bytes) : null;
}

/** A failed import as the host answered it: the HTTP status (0: no answer) and its `{code, message}`. */
export interface UploadFailure {
  status: number;
  code: string;
  message: string;
}

/** Why the site refused the zip, in plain words with what to do. */
export function uploadFailure(failure: UploadFailure): Said {
  const { status, code, message } = failure;
  if (status === 0) return { key: 'uploadNoAnswer' };
  if (status === 401) return { key: 'uploadSignedOut' };
  if (status === 403) return { key: 'uploadNotAllowed' };
  if (status === 413 || code === 'too_large') {
    const limit = limitOf(message);
    if (limit) return { key: 'uploadTooLargeLimit', vars: { limit } };
    // Another limit (files in the zip, one file's size): the host's own words say which.
    return message ? { key: 'uploadTooLargeSaid', vars: { error: message } } : { key: 'uploadTooLarge' };
  }
  if (status === 415) return { key: 'uploadNotZip' };
  if (status === 409) return { key: 'uploadConflict' };
  if (status === 400) {
    // The site does not have the artifact's type (the host says "The <type> type is not installed on this host.").
    const type = /The (\S+) type is not installed/.exec(message)?.[1];
    if (code === 'unsupported' || type) return type ? { key: 'uploadTypeMissing', vars: { type } } : { key: 'uploadFailed', vars: { error: message } };
    return { key: 'uploadNotArtifact' };
  }
  if (status === 429) return { key: 'uploadBusy' };
  return { key: 'uploadFailed', vars: { error: message || `HTTP ${status}` } };
}

/** An import's answer body (JSON or not) as an {@link UploadFailure}. */
export function failureOfAnswer(status: number, body: string): UploadFailure {
  let code = 'error';
  let message = '';
  try {
    const value: unknown = JSON.parse(body);
    if (value && typeof value === 'object') {
      const out = value as { code?: unknown; message?: unknown };
      if (typeof out.code === 'string') code = out.code;
      if (typeof out.message === 'string') message = out.message;
    }
  } catch {
    // A proxy's page, not the host's JSON: the status says it.
  }
  return { status, code, message };
}

/** The new artifact's id from an import's 201 answer, or `null` when the answer is not one. */
export function importedId(body: string): string | null {
  try {
    const value: unknown = JSON.parse(body);
    const id = value && typeof value === 'object' ? (value as { id?: unknown }).id : undefined;
    return typeof id === 'string' && id ? id : null;
  } catch {
    return null;
  }
}
