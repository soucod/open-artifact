/** The Sources panel's words. */

const decimal = new Intl.NumberFormat('en-US');

/** "1 row", "12 rows". */
export function plural(count: number, one: string, other: string): string {
  return `${decimal.format(count)} ${count === 1 ? one : other}`;
}

export const SOURCES_LABEL = 'Sources';
export const NO_SOURCES_MESSAGE = 'No sources yet.';
export const EDIT_LABEL = 'Edit';
export const TEST_LABEL = 'Test';
export const TEST_WITHOUT_SAVING_LABEL = 'Test without saving';
export const SAVE_ANYWAY_LABEL = 'Save anyway';
export const CLOSE_LABEL = 'Close';
export const COPIED_LABEL = 'Copied';
export const COPY_LABEL = 'Copy';
export const DOWNLOAD_LABEL = 'Download';
export const EXPAND_LABEL = 'Expand';
export const REFRESH_LABEL = 'Refresh';
export const RETRY_LABEL = 'Retry';
export const SHOW_MORE_LABEL = 'Show more';
export const SHOW_LESS_LABEL = 'Show less';
export const HISTORY_LABEL = 'History';
export const RESTORE_LABEL = 'Restore';
export const BACK_LABEL = 'Back';
export const DETAILS_LABEL = 'Details';
export const UNSET_LABEL = 'Unset';
export const ANSWER_LABEL = 'Answer';
export const RESULT_LABEL = 'Result';
export const FILE_LABEL = 'File';
export const QUERY_LABEL = 'Query';
export const CODE_LABEL = 'Code';
export const TRANSFORM_LABEL = 'Transform';
export const FORMULA_LABEL = 'Formula';
export const INPUTS_LABEL = 'Inputs';
export const NAME_LABEL = 'Name';
export const DESCRIPTION_LABEL = 'Description';
export const SET_BY_THE_PAGE_LABEL = 'Set by the page';
export const RESULT_ROWS_LABEL = 'Result rows';
export const BACK_TO_SOURCES_LABEL = 'Back to Sources';
export const FILES_GROUP_NAME = 'Files';
export const STORAGE_GROUP_NAME = 'Artifact storage';
export const TRANSFORMS_GROUP_NAME = 'Transforms';
export const UNUSED_SOURCE_LABEL = 'Unused';
export const UNUSED_SOURCE_DESCRIPTION = 'Nothing in this artifact uses this source.';
export const NOTHING_LINKS_HERE_MESSAGE = 'Nothing on the page links here.';
export const NOT_READ_BY_PAGE_MESSAGE = 'Not read by the page.';
export const CONNECTOR_SAID_LABEL = 'The connector said';
export const WHAT_THE_ERROR_SAID_LABEL = 'What the error said';
export const COPY_THE_ERROR_LABEL = 'Copy the error';
export const LOADER_CODE_LABEL = 'The loader’s code';
export const COPY_LOADER_LABEL = 'Copy the loader';
export const FORMULA_CODE_LABEL = 'The calculation’s formula';
export const COPY_FORMULA_LABEL = 'Copy formula';
export const CALLS_LABEL = 'calls';
export const DIDNT_RUN_LABEL = 'Didn’t run';
export const DIDNT_LOAD_LABEL = 'Didn’t load';
export const LOADING_LABEL = 'Loading…';
export const REFRESHING_LABEL = 'Refreshing…';
export const JUST_NOW_LABEL = 'Just now';
export const DOWNLOADED_MESSAGE = 'Downloaded.';
export const DOWNLOAD_FAILED_MESSAGE = 'Couldn’t download.';
export const COPY_FAILED_MESSAGE = 'Couldn’t copy.';
export const EDIT_FILE_TITLE = 'Edit file';
export const REPLACE_WITH_FILE_LABEL = 'Replace with a file…';
export const NOT_SAVED_LABEL = 'not saved';
export const SAVE_RETRY_MESSAGE = 'Couldn’t save. Try again in a moment.';
export const UNSAVED_WORDS = 'What you changed hasn’t been saved.';
export const UNSAVED_TYPED_WORDS = 'What you typed hasn’t been saved.';
export const A_CONNECTOR_LABEL = 'a connector';
export const NOT_IN_QUERY_NOW_NOTE = 'Not in the query now';
export const NOW_TYPED_NOTE = 'Now typed in the query';
export const nowSetByPageNote = (name: string): string => `Now set by the page: ${name}`;
export const nowValueNote = (value: string): string => `Now ${value}`;
export const ORIGINAL_QUERY_TITLE = 'Original query';
export const EDITED_QUERY_TITLE = 'You edited the query';
export const THIS_IS_THE_QUERY_NOW = 'This is the query now';
export const RESTORE_NOTE = 'Restore puts it in the fields. Nothing changes until you save.';
export const DIFFERENT_FORMAT_MESSAGE =
  'This version was saved in a different format, so it can’t be restored here. Ask your agent to bring it back.';
export const REFRESH_DATA_LABEL = 'Refresh data';
export const WHEN_SOMEONE_OPENS_IT_LABEL = 'When someone opens it';
export const ABOUT_SOURCES_TITLE = 'About sources';
export const SAVED_DATA_LABEL = 'Saved data';
export const SOURCES_LOAD_FROM_MESSAGE = 'Each source loads from a connector, a file, or artifact storage.';
export const SAVED_FILES_MESSAGE = 'Files are stored in this artifact and deleted with it.';
export const RESULTS_REUSED_MESSAGE = 'Results are reused for as long as Refresh data is set, then load again.';
export const REFRESH_LOADS_NOW_MESSAGE = 'The refresh button loads new results now.';
export const ONLY_QUERY_ARGS_MESSAGE = 'Only a query’s arguments can be edited.';
export const QUERY_CONCURRENT_EDIT_MESSAGE = 'Someone may have changed this source; Cancel to reload.';
export const QUERY_SAVE_FAILED_MESSAGE = 'Couldn’t save. Someone may have changed this source; Cancel to reload.';
export const TEST_DIDNT_RUN_MESSAGE = 'The test didn’t run. Try again.';
export const TESTING_LABEL = 'Testing…';
export const TEST_RESULT_LABEL = 'Test result';
export const SOURCE_CHANGED_MESSAGE = 'The source changed meanwhile. Try again.';
export const FILE_REPLACED_MESSAGE = 'Someone replaced this file meanwhile; Cancel loads theirs.';
export const FILE_UPLOAD_FAILED_MESSAGE = 'The file didn’t upload. Try again.';
export const FILE_TOO_LARGE_MESSAGE = 'The file is too large to attach. Choose a smaller one.';
export const FILE_UNREAD_MESSAGE = 'Couldn’t read that file. Choose it again, or a smaller one.';
export const FILE_NOT_UTF8_MESSAGE =
  'That file isn’t UTF-8 text, the one encoding the page reads. Save it as UTF-8 (in Excel, CSV UTF-8) and choose it again.';
export const CHOOSE_DATA_FILE_MESSAGE = 'Choose a .csv, .tsv or .json file.';
export const TOO_LARGE_REPLACED_NOTE = 'Too large to edit as text here; Save attaches it as it is.';
export const TOO_LARGE_STORED_NOTE = 'Too large to edit as text here; Replace with a file… puts another in its place.';

export const editFileOfLabel = (name: string): string => `Edit the file of ${name}`;
export const editSourceLabel = (name: string): string => `Edit ${name}`;
export const couldNotSaveMessage = (reason: string): string => `Couldn’t save: ${reason}`;
export const couldNotSaveSourceMessage = (name: string): string => `Couldn’t save ${name}.`;
export const testResultNotSavedMessage = (rows: string): string => `Test result: ${rows}, not saved.`;
export const discardChangesQuestion = (name: string): string => `Discard your changes to ${name}?`;
export const savedRowsMessage = (rows: string): string => `Saved · ${rows}`;
export const backToSourceLabel = (name: string): string => `Back to ${name}`;
export const refreshSourceLabel = (name: string): string => `Refresh ${name}`;
export const retrySourceLabel = (name: string): string => `Retry ${name}`;
export const expandResultLabel = (name: string): string => `Expand the result of ${name}`;
export const copyResultLabel = (name: string): string => `Copy the result of ${name}`;
export const downloadSourceLabel = (name: string): string => `Download ${name}`;
export const resultOfLabel = (name: string): string => `Result of ${name}`;
export const copyNamedLabel = (name: string): string => `Copy ${name}`;
export const expandNamedLabel = (name: string): string => `Expand ${name}`;
export const setByThePageNote = (name: string): string => `Set by the page: ${name}`;
export const connectorSaidLabel = (connector: string): string => (connector === '' ? CONNECTOR_SAID_LABEL : `${connector} said`);
export const notInArtifactMessage = (name: string): string => `${name} is not in this artifact`;
export const waitingOnLabel = (name: string): string => `Waiting on ${name}`;
export const didntRunLabel = (name: string): string => `${name} didn’t run`;
export const didntLoadLabel = (name: string): string => `${name} didn’t load`;
export const noToolNamedMessage = 'Or it has no tool named';
export const nothingSetsMessage = (name: string): string => `Nothing in this artifact sets {{${name}}}.`;
export const notValidJsonMessage = (reason: string): string => `Not valid JSON: ${reason}`;
export const editedNote = (when: string, by: string | null): string => (by === null || by === '' ? `Edited ${when}` : `Edited ${when} by ${by}`);
export const refreshDataChoiceLabel = (choice: string): string => `Refresh data: ${choice}`;
export const pickedFileNotSavedMessage = (name: string, size: string): string => `${name} · ${size}, not saved.`;
export const storedFileProblemNote = (problem: string): string => `${problem} Replace it with a file.`;

export function describeConnectorGroupLabel(connector: string, count: number): string {
  return `${connector}, ${plural(count, 'query', 'queries')}`;
}

export function describeFilesGroupLabel(count: number): string {
  return plural(count, 'file', 'files');
}

export function describeStorageGroupLabel(count: number): string {
  return plural(count, 'saved source', 'saved sources');
}

export function describeTransformsGroupLabel(count: number): string {
  return plural(count, 'transform', 'transforms');
}

export function formatResultRowCount(count: number): string {
  return plural(count, 'row', 'rows');
}

export function lostColumnsMessage(columns: readonly string[]): string {
  return `The stored file had ${columns.join(', ')}, which this one doesn’t.`;
}

export function calculationArgumentUsageLabel(name: string | null, index: number): string {
  if (name !== null) return `used as ${name} in the formula`;
  const place = index + 1;
  const suffix = place === 1 ? 'st' : place === 2 ? 'nd' : place === 3 ? 'rd' : 'th';
  return `${decimal.format(place)}${suffix} argument of the formula`;
}

export function historyDifferenceLabel(count: number): string {
  return count === 1 ? `${decimal.format(count)} line differs from the query now` : `${decimal.format(count)} lines differ from the query now`;
}

/** "12 rows · not saved", and "· out of date" once the fields changed. */
export function testResultNoteLabel(rows: string, stale: boolean): string {
  return stale ? `${rows} · not saved · out of date` : `${rows} · not saved`;
}

export const WAITING_ON_WORDS = 'Waiting on';
export const DIDNT_RUN_WORDS = 'didn’t run';
export const DIDNT_LOAD_WORDS = 'didn’t load';

const oneDecimalSeconds = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false });

/** One line of a query's calls: "{tool} ×{n} · {time}", plus "· failed". */
export function describeToolCallLine(call: { tool: string; n: number; ms: number; ok: boolean }): string {
  const name = call.n > 1 ? `${call.tool} ×${call.n}` : call.tool;
  const time = call.ms < 1000 ? `${call.ms} ms` : `${oneDecimalSeconds.format(call.ms / 1000)} s`;
  return call.ok ? `${name} · ${time}` : `${name} · ${time} · failed`;
}

/** A filter's value as the tooltip shows it: lists joined, nothing as "Unset". */
export function formatParameterValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return UNSET_LABEL;
  if (Array.isArray(value)) return value.length === 0 ? UNSET_LABEL : value.map(String).join(', ');
  return String(value);
}
