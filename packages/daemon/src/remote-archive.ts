/**
 * Size caps on what a remote type (one on another computer, `typeLocation(type).remote`) answers to
 * `/__open-artifact/archive`, for the daemon's `archiveAnswer` / `archiveBytes`. A type on this computer is not capped.
 *
 * - The zip Link publishes is held in memory whole: {@link REMOTE_ARCHIVE_MAX}, 128 MiB. A cloud host takes an import
 *   body of at most 100 MiB (`LINK_MAX_BODY_BYTES` in `@open-artifact/host`), so any zip the host would take fits, and a
 *   zip between the two still reaches the host, which answers its own `too_large`; past 128 MiB the other computer is
 *   only filling this one's memory.
 * - A refused answer's body is parsed for `{ code, message }`: {@link REMOTE_ERROR_MAX}, 64 KiB, far more than any
 *   error object needs.
 *
 * Past a cap the read stops (the rest is never downloaded) and `server_failed` names the address that answered.
 */

import { OpenArtifactError } from '@open-artifact/protocol';
import type { TypeInfo } from './types.ts';

/** The most of a remote type's zip the daemon holds in memory: 128 MiB. */
export const REMOTE_ARCHIVE_MAX = 128 * 1024 * 1024;

/** The most of a remote type's refused answer the daemon reads to find its `{ code, message }`: 64 KiB. */
export const REMOTE_ERROR_MAX = 64 * 1024;

/** Where an answer came from, as an error names it: origin and path, never the query. */
export function answerAddress(type: Pick<TypeInfo, 'id' | 'entry'>, answer: Response): string {
  try {
    const url = new URL(answer.url);
    return `${url.origin}${url.pathname}`;
  } catch {
    const entry = type.entry as { url?: string } | null | undefined;
    return entry?.url ? new URL(entry.url.replace(/\{[a-z]+\}.*$/, '')).origin : type.id;
  }
}

const size = (max: number): string => (max >= 1024 * 1024 ? `${Math.round(max / (1024 * 1024))} MiB` : `${Math.round(max / 1024)} KiB`);

/** The body, or `null` once it is past `max` (the rest is cancelled, never read). */
export async function readCapped(answer: Response, max: number): Promise<Uint8Array | null> {
  const declared = Number(answer.headers.get('content-length'));
  if (answer.headers.has('content-length') && Number.isFinite(declared) && declared > max) {
    void answer.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!answer.body) return new Uint8Array(0);
  const reader = answer.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      void reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

const tooLarge = (type: Pick<TypeInfo, 'id' | 'entry'>, answer: Response, max: number, what: string): OpenArtifactError =>
  new OpenArtifactError('server_failed', `${type.id}: ${answerAddress(type, answer)} answered ${what} of more than ${size(max)}; answers from a type on another computer are capped there.`);

/** A remote type's zip, refused past `max`. */
export async function remoteArchiveBytes(type: Pick<TypeInfo, 'id' | 'entry'>, answer: Response, max = REMOTE_ARCHIVE_MAX): Promise<Uint8Array> {
  const bytes = await readCapped(answer, max);
  if (!bytes) throw tooLarge(type, answer, max, 'a zip');
  return bytes;
}

/** A remote type's refused answer as `{ code, message }` (or `null` when it is not JSON), refused past `max`. */
export async function remoteErrorBody(type: Pick<TypeInfo, 'id' | 'entry'>, answer: Response, max = REMOTE_ERROR_MAX): Promise<{ code?: unknown; message?: unknown } | null> {
  const bytes = await readCapped(answer, max);
  if (!bytes) throw tooLarge(type, answer, max, `an error (${answer.status})`);
  try {
    const body = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return body && typeof body === 'object' ? (body as { code?: unknown; message?: unknown }) : null;
  } catch {
    return null;
  }
}
