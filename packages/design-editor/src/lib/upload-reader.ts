/** An upload as read for an export. */
export interface ReadUpload {
  data: Uint8Array;
  type: string | null;
}

/** Why an upload is not in the export. */
export type SkipReason = 'unreadable' | 'stalled' | 'after-stall';

export interface UploadReadOptions {
  request?: typeof fetch;
  /** Downloads in flight at once. */
  concurrency?: number;
  /** Longest wait for the response or between two parts of its body. */
  idleMs?: number;
  /** Longest a single download may take in all. */
  totalMs?: number;
}

/** README wording for each reason. */
export const SKIP_REASONS: Record<SkipReason, string> = {
  unreadable: 'the file could not be read',
  stalled: 'the download stopped responding',
  'after-stall': 'skipped, since an earlier download stopped responding',
};

class Stalled extends Error {}

/**
 * Reads uploads for an export a few at a time. A download that stops
 * responding is cut off, and once one has, the ones not yet started are
 * skipped rather than each waiting out the same timeout.
 */
export async function readUploadFiles(
  urls: readonly string[],
  { request = fetch, concurrency = 4, idleMs = 20_000, totalMs = 120_000 }: UploadReadOptions = {},
): Promise<{ found: Map<string, ReadUpload>; skipped: Map<string, SkipReason> }> {
  const found = new Map<string, ReadUpload>();
  const skipped = new Map<string, SkipReason>();
  let stalled = false;
  let next = 0;

  const readOne = async (url: string): Promise<ReadUpload> => {
    const controller = new AbortController();
    let idle: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    const cut = () => {
      timedOut = true;
      controller.abort();
    };
    const touch = () => {
      clearTimeout(idle);
      idle = setTimeout(cut, idleMs);
    };
    const total = setTimeout(cut, totalMs);
    touch();
    try {
      const response = await request(url, { signal: controller.signal });
      if (!response.ok) throw new Error(String(response.status));
      const parts: Uint8Array[] = [];
      const reader = response.body?.getReader();
      if (reader) {
        for (;;) {
          touch();
          const { done, value } = await reader.read();
          if (done) break;
          parts.push(value);
        }
      } else parts.push(new Uint8Array(await response.arrayBuffer()));
      const data = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0));
      let at = 0;
      for (const part of parts) {
        data.set(part, at);
        at += part.byteLength;
      }
      return { data, type: response.headers.get('content-type') };
    } catch (error) {
      throw timedOut ? new Stalled() : error;
    } finally {
      clearTimeout(idle);
      clearTimeout(total);
    }
  };

  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next++]!;
      if (stalled) {
        skipped.set(url, 'after-stall');
        continue;
      }
      try {
        found.set(url, await readOne(url));
      } catch (error) {
        if (error instanceof Stalled) stalled = true;
        skipped.set(url, error instanceof Stalled ? 'stalled' : 'unreadable');
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, urls.length)) }, worker));
  return { found, skipped };
}
