/**
 * Downloads and links: saves a file through the host's `downloads`
 * capability (the owner, on their computer; it says where it went), else
 * through the browser; copies URLs and paths.
 */

import { browserDownloadUrl, writeClipboardText } from '@open-artifact/editor-kit';
import { toast } from '@open-artifact/ui';
import { maybeSession, session } from './session.ts';

/** Downloads `url` as `name`. */
export async function downloadUrl(url: string, name: string): Promise<void> {
  const downloads = session().downloads;
  // The owner, or anyone on a host that saves in the browser (it decides whether a viewer may).
  if (downloads && (session().isOwner || downloads.browser === true)) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      const { savedTo } = await downloads.save({ name, data: await response.blob() });
      toast.add({ title: `Downloaded ${name}`, description: savedTo });
      return;
    } catch (error) {
      toast.add({ title: `Could not download ${name}`, description: error instanceof Error ? error.message : String(error) });
      return;
    }
  }
  browserDownloadUrl(url, name);
}

/** Copies text, with a toast. */
export async function copyText(text: string, what: string): Promise<void> {
  try {
    await writeClipboardText(text, maybeSession()?.shell);
    toast.add({ title: `Copied ${what}` });
  } catch {
    toast.add({ title: `Could not copy ${what}`, description: text });
  }
}
