/** The words of the page's chrome: toolbar, side panels, notices and the empty page. */

export const SOURCES_PANEL_NAME = 'Sources';
export const DESIGN_PANEL_NAME = 'Design';
export const HISTORY_PANEL_NAME = 'History';

export const SOURCES_TIP = 'Sources: see where numbers come from';
export const HIDE_SOURCES_TIP = 'Hide sources';
export const SOURCES_DISABLED_BY_COMMENTS = 'Turn off comments to see Sources';
export const DESIGN_DISABLED_BY_COMMENTS = 'Turn off comments to see Design';
export const DESIGN_DISABLED_BY_EDITING = 'Finish editing to see Design';
export const HISTORY_DISABLED_BY_COMMENTS = 'Turn off comments to see History';

export const SOURCES_OPEN_MESSAGE = 'Sources open. Click a number or a chart to see its source.';
export const SOURCES_CLOSED_MESSAGE = 'Sources closed.';
export const DESIGN_OPEN_MESSAGE = 'Design open.';
export const DESIGN_CLOSED_MESSAGE = 'Design closed.';
export const HISTORY_OPEN_MESSAGE = 'History open.';
export const HISTORY_CLOSED_MESSAGE = 'History closed.';
export const VERSION_SHOWN_MESSAGE = 'Showing an earlier version with today’s data.';
export const LATEST_SHOWN_MESSAGE = 'Back on the latest version.';
export const showingSourceMessage = (name: string): string => `Showing ${name} in Sources.`;
export const sourceStopDescription = (source: string): string => `${source}. Press Enter to see it in Sources.`;

export const REFRESH_LABEL = 'Refresh';
export const REFRESH_TIP = 'Run every live query again.';
export const REFRESHING_LABEL = 'Refreshing…';
export const LOADING_DATA_LABEL = 'Loading data…';
export const STALE_NUMBERS_TIP = 'Some saved numbers are stale.';

export const READ_ONLY_LABEL = 'Read-only';
export const SAVING_LABEL = 'Saving…';
export const UNSAVED_EDITS_LABEL = 'Unsaved edits';
export const SAVED_AUTOMATICALLY_LABEL = 'Saved automatically';
export const AUTO_SAVE_TIP = 'Every change saves automatically';
export const SYNCING_LABEL = 'Syncing…';
export const SYNC_FAILED_LABEL = 'Couldn’t sync — click to retry';
export const SYNCED_LABEL = 'All changes synced';
export const SAVE_FAILED_LABEL = 'Couldn’t save';
export const LOADING_LATEST_LABEL = 'Loading the latest content…';

export const DRAFT_SHOWN_TEXT = 'Draft. Only people who can edit can see it until you save.';
export const NEW_DRAFT_UNSTARTED_TEXT = 'Your new draft hasn’t started. Cancel to go back.';
export const DRAFT_UNSTARTED_TEXT = 'Your draft hasn’t started. Cancel to start over.';
export const SAVED_SHOWN_TEXT = 'Showing the saved artifact. Press Redo to see the draft again.';

export const EMPTY_DASHBOARD_TEXT = 'Nothing here yet';
export const CHOOSE_FORMAT_TEXT = 'Choose a format.';
export const IMPORT_FILE_LABEL = 'Import a file';
export const IMPORT_FILE_HINT = 'CSV, Excel, or JSON';
export const IMPORTING_FILE_LABEL = 'Importing…';
export const unreadableImportMessage = (names: readonly string[]): string =>
  `${names.join(', ')} ${names.length === 1 ? 'isn’t' : 'aren’t'} CSV, Excel, or JSON.`;
export const largeImportMessage = (name: string, limit: number): string => `${name} is larger than ${Math.floor(limit / (1024 * 1024))} MB.`;
export const importFailedMessage = (name: string): string => `Couldn’t import ${name}.`;
export const MAKING_PAGE_TEXT = 'Making your page…';
export const USUALLY_A_FEW_MINUTES_TEXT = 'Usually a few minutes';
export const TAKING_LONGER_TEXT = 'Taking longer than usual';
export const WORKING_TIPS = {
  select: 'Select any text to ask the agent about it.',
  sources: 'Open Sources to see where a number comes from.',
  change: 'Ask the agent to change anything on the page.',
} as const;

export const OPEN_FAILED_TITLE = 'This dashboard could not open';
export const OPENING_LABEL = 'Opening the dashboard';
export const CLOSE_PANEL_LABEL = 'Close';
export const RESIZE_PANEL_LABEL = 'Resize the panel';
export const COMMENTS_HINT = 'Turn on commenting and click the page.';

/** "one source needs attention" / "3 sources need attention". */
export function formatAttentionCount(n: number): string {
  return n === 1 ? 'one source needs attention' : `${n.toLocaleString()} sources need attention`;
}

/** "{tip} ({note})". */
export function withNote(tip: string, note: string | null): string {
  return note === null ? tip : `${tip} (${note})`;
}
