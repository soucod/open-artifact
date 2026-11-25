/**
 * The page's capabilities when a cloud host serves the Shell: the page's own provider, with what only a computer of
 * one's own can do swapped out.
 *
 * - `downloads.save` becomes a browser download (a Blob behind an `<a download>`): the host has no Downloads folder
 *   to write into. A viewer may save only when the owner lets viewers export; otherwise the call is refused with
 *   `not_writer`, the same error a type server answers. The capability says `browser: true` (the grant carries it to
 *   the page), so an editor sends every role's files here instead of starting a download of its own. The file comes
 *   across the frame boundary as the page's own Blob (structured clone shares its bytes), so a large video is not
 *   copied on the way. `downloads.check` asks the same rule without a file, for an export that is a print.
 * - `mcp` (the owner's connectors) is never offered: they live on the owner's computer.
 *
 * Everything else passes through to the page's type server as it is.
 */

import { ArtifactError, type CapabilityMap, type CapabilityName, type CapabilityProvider, type DownloadsCapability } from '@open-artifact/runtime';

/** What the browser download needs; tests pass fakes. */
export interface DownloadEnv {
  document: Pick<Document, 'createElement' | 'body'>;
  URL: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
  setTimeout: (run: () => void, ms: number) => unknown;
}

/** How long the object URL lives after the click (the browser has taken the file by then). */
export const REVOKE_AFTER_MS = 60_000;

/** A file name the browser can save: the last path segment, no control characters, never empty. */
export function downloadName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const base = String(name).split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f]+/g, '').trim();
  return base && base !== '.' && base !== '..' ? base.slice(0, 200) : 'download';
}

/**
 * This window's download tools. `setTimeout` is wrapped: called as a method of another object it throws "Illegal
 * invocation", after the download had already started, and the page then said the export failed.
 */
function browserEnv(): DownloadEnv {
  return { document, URL, setTimeout: (run, ms) => setTimeout(run, ms) };
}

/** Saves `data` as `name` through the browser's own download. */
export function saveInBrowser(file: { name: string; data: Blob }, env: DownloadEnv = browserEnv()): { savedTo?: string } {
  const href = env.URL.createObjectURL(file.data);
  const link = env.document.createElement('a');
  link.href = href;
  link.download = downloadName(file.name);
  link.rel = 'noopener';
  link.style.display = 'none';
  env.document.body.append(link);
  link.click();
  link.remove();
  env.setTimeout(() => env.URL.revokeObjectURL(href), REVOKE_AFTER_MS);
  // The browser decides where it goes: there is no path to report.
  return {};
}

/** What {@link cloudProvider} asks of the Shell. */
export interface CloudPolicy {
  /** Whether the person may download or export now (their role, and for a viewer the owner's setting). */
  mayExport(): boolean | Promise<boolean>;
  /** Saves a file in the browser; default {@link saveInBrowser}. */
  save?: (file: { name: string; data: Blob }) => { savedTo?: string };
}

/** The message of a refused save, in the type server's words. */
export const EXPORT_REFUSED = 'The owner has not let viewers download or export this artifact.';

/** `inner` with `downloads` saved in the browser and no `mcp`. */
export function cloudProvider(inner: CapabilityProvider, policy: CloudPolicy): CapabilityProvider {
  const save = policy.save ?? ((file) => saveInBrowser(file));
  const downloads: DownloadsCapability = {
    save: async (file) => {
      if (!(await policy.mayExport())) throw new ArtifactError('not_writer', EXPORT_REFUSED);
      return save(file);
    },
    // The page reads it from the grant: every role then saves through here, so the export rule above is the only one.
    browser: true,
    // A print is no download: the page asks first, so its own button follows the same switch.
    check: async () => {
      if (!(await policy.mayExport())) throw new ArtifactError('not_writer', EXPORT_REFUSED);
    },
  };
  return {
    get<K extends CapabilityName>(name: K): Promise<CapabilityMap[K] | null> | CapabilityMap[K] | null {
      if (name === 'mcp') return null;
      if (name === 'downloads') return downloads as CapabilityMap[K];
      return inner.get(name);
    },
  };
}
