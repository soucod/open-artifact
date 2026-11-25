/**
 * Printing the dashboard (and saving it as a PDF from the print dialog): only `#dash-root` is printed, in the light
 * look. The page's tokens and `dash/look` are already light in print; this hides everything around the page and
 * lets the boxes that hold it grow to its full length, both for the browser's own Print command and for
 * {@link printDashboard}.
 */

import { DASHBOARD_ROOT_ID } from '../page/runtime.ts';
import { PRINT_NOTE_ATTRIBUTE } from './print-note.ts';

/** Set, while printing, on `#dash-root` and every element that holds it. */
export const PRINT_PATH_ATTRIBUTE = 'data-dash-print-path';
const PRINT_STYLE_ID = 'dash-print-style';

/** The data note beside the page is hidden on screen (by its inline style) and printed under it once it says something. */
const PRINT_NOTE_CSS = `[${PRINT_PATH_ATTRIBUTE}]>[${PRINT_NOTE_ATTRIBUTE}]:not(:empty){display:block!important;margin:0!important;padding:0 16px 12px!important;text-align:center}`;

export const PRINT_CSS =
  '@media print{' +
  'html,body{background:#fff!important;color-scheme:light!important}' +
  `[${PRINT_PATH_ATTRIBUTE}]{overflow:visible!important;block-size:auto!important;max-block-size:none!important;min-block-size:0!important;position:static!important;display:block!important;transform:none!important;margin:0!important;border:0!important;box-shadow:none!important}` +
  // What sits beside the path is hidden, but not the page inside `#dash-root` (which carries the mark itself): hiding
  // its children printed a blank sheet (issue #24). `:where` keeps the rule as weak as before, so the note still shows.
  `[${PRINT_PATH_ATTRIBUTE}]:not(:where(#${DASHBOARD_ROOT_ID}))>:not([${PRINT_PATH_ATTRIBUTE}]){display:none!important}` +
  `#${DASHBOARD_ROOT_ID}{print-color-adjust:exact;-webkit-print-color-adjust:exact}` +
  PRINT_NOTE_CSS +
  '}';

const PRINT_MEDIA_PATTERN = /@media\b[^{}]*\bprint\b/i;
const BEFORE_PRINT_PATTERN = /\bbeforeprint\b/;

/** Whether the dashboard's own files include `@media print` rules or a `beforeprint` hook. */
export function hasPagePrintLayout(files: ReadonlyArray<{ text: string }>): boolean {
  return files.some((file) => PRINT_MEDIA_PATTERN.test(file.text) || BEFORE_PRINT_PATTERN.test(file.text));
}

function markPrintPath(): void {
  for (let element = document.getElementById(DASHBOARD_ROOT_ID); element !== null; element = element.parentElement)
    element.setAttribute(PRINT_PATH_ATTRIBUTE, '');
}

function clearPrintPath(): void {
  for (const element of document.querySelectorAll(`[${PRINT_PATH_ATTRIBUTE}]`)) element.removeAttribute(PRINT_PATH_ATTRIBUTE);
}

let installs = 0;

/** Prints only the dashboard whenever the page is printed. Returns a function that undoes it. */
export function installDashboardPrint(): () => void {
  if (typeof document === 'undefined') return () => undefined;
  installs += 1;
  if (installs === 1) {
    const style = document.createElement('style');
    style.id = PRINT_STYLE_ID;
    style.textContent = PRINT_CSS;
    document.head.append(style);
    window.addEventListener('beforeprint', markPrintPath);
    window.addEventListener('afterprint', clearPrintPath);
  }
  let live = true;
  return () => {
    if (!live) return;
    live = false;
    installs -= 1;
    if (installs > 0) return;
    document.getElementById(PRINT_STYLE_ID)?.remove();
    window.removeEventListener('beforeprint', markPrintPath);
    window.removeEventListener('afterprint', clearPrintPath);
    clearPrintPath();
  };
}

/** How long after `print()` returns the dialog counts as closed when the browser sends no `afterprint`. */
const PRINT_SETTLE_MS = 1000;

/** Opens the print dialog for the dashboard alone; resolves once it closes. */
export function printDashboard(): Promise<void> {
  const uninstall = installDashboardPrint();
  return new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      window.removeEventListener('afterprint', finish);
      uninstall();
      resolve();
    };
    window.addEventListener('afterprint', finish);
    markPrintPath();
    try {
      window.print();
    } finally {
      if (!done) timer = setTimeout(finish, PRINT_SETTLE_MS);
    }
  });
}
