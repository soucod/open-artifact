/**
 * The place of an artifact the host is told about and can send back: a
 * slide, a Docs tab or block, a sheet. Pure, so it runs under `node --test`.
 */

import { DOC_FRAGMENT, SLIDE_FRAGMENT, type ChromeCommand, type PageToShell, type ShellBoot } from '@open-artifact/protocol';
import { sheetPageFragment } from './model.ts';

/** The fragment a page message reports as its place, or null when it reports none. */
export function placeOf(type: ShellBoot['type'], message: PageToShell): string | null {
  switch (message.openArtifact) {
    case 'current_slide':
      return type === 'slides' && typeof message.hash === 'string' && SLIDE_FRAGMENT.test(message.hash) ? message.hash : null;
    case 'doc_place':
      return type === 'docs' && typeof message.hash === 'string' && DOC_FRAGMENT.test(message.hash) ? message.hash : null;
    case 'sheet_page':
      return type === 'sheets' && typeof message.page === 'string' && message.page ? '#' + new URLSearchParams({ page: message.page }).toString() : null;
    default:
      return null;
  }
}

/** What the page is told to show for a fragment the host sent, or null when the fragment is not a place of this type. */
export function gotoCommand(type: ShellBoot['type'], hash: unknown): ChromeCommand | null {
  if (typeof hash !== 'string' || hash.length > 1000) return null;
  if (type === 'slides') return SLIDE_FRAGMENT.test(hash) ? { cmd: 'goto_slide', hash } : null;
  if (type === 'docs') return DOC_FRAGMENT.test(hash) ? { cmd: 'goto_doc', hash } : null;
  if (type === 'sheets') {
    const page = new URLSearchParams(sheetPageFragment(hash).slice(1)).get('page');
    return page ? { cmd: 'goto_sheet', page } : null;
  }
  return null;
}
