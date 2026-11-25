import type { ConnectionProblem } from './connection-news.ts';
import type { Connection, ConnectionPage } from '../store/sheet-connection.ts';
import type { StreamEndReason } from '../store/sheet-stream.ts';
import type { SheetContent } from '../store/sheet-state.ts';
import { translateMessage } from '../i18n/messages.ts';

/** Why the connection ended, including the host closing it for a reason of its own. */
export type ConnectionEndOfStatus = StreamEndReason | { kind: 'closedByShell'; shellReason: string };
/** The connection, where a reconnecting one may say the viewer is kept out. */
export type ConnectionOfStatus =
  | Exclude<Connection, { kind: 'reconnecting' } | { kind: 'ended' }>
  | { kind: 'reconnecting'; isKeptOut?: boolean }
  | { kind: 'ended'; reason: ConnectionEndOfStatus };
/** Where restoring a sheet that is no longer there stands. */
export type SheetRestore = 'notOffered' | 'offered' | 'underWay' | 'failed' | 'refused';
/** What the sheet holds, including content the page cannot open. */
export type ContentOfStatus =
  | SheetContent
  | { kind: 'noContainer'; restore: SheetRestore }
  | { kind: 'notAWorkbook' }
  | { kind: 'notUnderstood' };
/** The parts of the page's connection that the status is told from. */
export interface SheetStatusSource extends Pick<ConnectionPage, 'sharedCode' | 'workbook'> {
  connection: ConnectionOfStatus;
  content: ContentOfStatus;
}
/** How the sheet's status stands: on its way, may pass, may be restored, or stands until something is done. */
export type SheetStatusKind = 'onItsWay' | 'mayPass' | 'mayBeRestored' | 'stands';
/** A status shown with a heading of its own above its words. */
export interface SheetStatusShownAs {
  heading: string;
  text: string;
}
export interface SheetStatus {
  inWords: string;
  shownAs: SheetStatusShownAs | null;
  kind: SheetStatusKind;
}
export function connectionEndText(reason: ConnectionEndOfStatus): string {
  switch (reason.kind) {
    case 'notInsideHost':
      return translateMessage({
        defaultMessage: 'Open this Sheet in the host.',
        id: 'n3KQNIsAs3',
      });
    case 'couldNotConnect':
      return translateMessage({
        defaultMessage: 'Couldn’t connect. Reload the page to try again.',
        id: 'VJLEbtJowZ',
      });
    case 'closedByShell':
      if (reason.shellReason.toLowerCase() === 'revoked')
        return translateMessage({
          defaultMessage: 'You no longer have access to this Sheet.',
          id: 'bygWrKntDk',
        });
      if (reason.shellReason.toLowerCase() === 'not_enabled')
        return translateMessage({
          defaultMessage: 'Sheet storage isn’t turned on for you yet. If you think it is, reload the page.',
          id: 'WKgGAadJH1',
        });
      return translateMessage(
        {
          defaultMessage: 'The connection was closed ({reason}). Reload the page to try again.',
          id: 'mA4Y/NaSoZ',
        },
        {
          reason: reason.shellReason,
        },
      );
    case 'closedByPage':
      return translateMessage({
        defaultMessage: 'Closed.',
        id: 'bx/r7vzAJ1',
      });
  }
}
export function connectionStateText(connection: ConnectionOfStatus): string {
  switch (connection.kind) {
    case 'connecting':
      return translateMessage({
        defaultMessage: 'Connecting…',
        id: '/7ryJwLz1K',
      });
    case 'open':
      return translateMessage({
        defaultMessage: 'Connected.',
        id: '8lpg9pfpLy',
      });
    case 'reconnecting':
      return translateMessage({
        defaultMessage: 'Reconnecting…',
        id: '6cGmck2ETW',
      });
    case 'ended':
      return connectionEndText(connection.reason);
  }
}
export function contentProblemText(content: ContentOfStatus): string | null {
  switch (content.kind) {
    case 'loading':
    case 'workbook':
      return null;
    case 'noContainer':
      return restoreStatusOf(content.restore).inWords;
    case 'notAWorkbook':
      return translateMessage({
        defaultMessage:
          'This Sheet holds another kind of content, such as a Doc’s text, instead of a workbook, so this page can’t open it. Delete it and make a new one.',
        id: 'CSSPOkT9vb',
      });
    case 'notUnderstood':
      return translateMessage({
        defaultMessage: 'This page can’t read this Sheet’s storage: it isn’t laid out as a new Sheet’s is. Reload the page to try again.',
        id: 'Ab+RRMvP//',
      });
  }
}
export function workbookStateText(workbook: ConnectionPage['workbook']): string | null {
  switch (workbook.kind) {
    case 'notOpened':
    case 'opening':
      return loadingStatusText();
    case 'open':
      return null;
    case 'empty':
      return translateMessage({
        defaultMessage: 'There’s nothing in this Sheet yet, and you can’t change it. Ask someone who can edit it to add to it.',
        id: 'NgP6QwtrVR',
      });
    case 'closed':
      return translateMessage({
        defaultMessage: 'This Sheet is unavailable right now. Try again later.',
        id: '/cj4f52tq7',
      });
    case 'failed':
      return translateMessage({
        defaultMessage: 'Couldn’t open this Sheet. Reload the page to try again.',
        id: 'yGVghZwsZG',
      });
  }
}
export function sharedCodeProblemStatus(sharedCode: ConnectionPage['sharedCode']): SheetStatus | null {
  switch (sharedCode.kind) {
    case 'loading':
    case 'answered':
    case 'notFetched':
      return null;
    case 'noWebAssembly':
      return headedStatus(
        translateMessage({
          defaultMessage: 'This Sheet can’t open here',
          id: 'xeIpogQ7Kn',
        }),
        translateMessage({
          defaultMessage:
            'WebAssembly isn’t available. This can happen when Lockdown Mode is on or a browser policy turns it off. Try opening the Sheet on another device.',
          id: 'WNXSz9mfqL',
        }),
      );
    case 'failed':
      return standingStatus(
        translateMessage({
          defaultMessage: 'The editor didn’t load. Reload the page to try again.',
          id: 'fcWg3QduMo',
        }),
      );
  }
}
export function restoreStatusOf(restore: SheetRestore): SheetStatus {
  switch (restore) {
    case 'notOffered':
      return standingStatus(
        translateMessage({
          defaultMessage: 'This Sheet is no longer available.',
          id: 'oYes97jJc0',
        }),
      );
    case 'offered':
      return mayBeRestoredStatus(
        translateMessage({
          defaultMessage: 'This Sheet is no longer available. If it was deleted, you can restore it.',
          id: 'y/pD8/eUYp',
        }),
      );
    case 'underWay':
      return onItsWayStatus(
        translateMessage({
          defaultMessage: 'Restoring Sheet…',
          id: 'Wk0kB6llr5',
        }),
      );
    case 'failed':
      return mayBeRestoredStatus(
        translateMessage({
          defaultMessage: 'Couldn’t restore the Sheet. Try again in a moment.',
          id: 'oAAtCqAIrp',
        }),
      );
    case 'refused':
      return standingStatus(
        translateMessage({
          defaultMessage: 'You can no longer restore this Sheet.',
          id: 'aJm/wJWS++',
        }),
      );
  }
}
export function sheetStatusOf({ connection, content, sharedCode, workbook }: SheetStatusSource): SheetStatus {
  let isOpening = workbook.kind === 'notOpened' || workbook.kind === 'opening';
  let mayPass = isOpening || (workbook.kind === 'failed' && workbook.mayPass);
  let problemText = contentProblemText(content);
  let problemStatus = problemText === null ? sharedCodeProblemStatus(sharedCode) : standingStatus(problemText);
  if (connection.kind === 'ended' && connection.reason.kind !== 'closedByPage') {
    let mayPassOnEnd = mayPass || workbook.kind === 'closed';
    if (connection.reason.kind === 'couldNotConnect' && mayPassOnEnd && problemStatus === null) return mayPassStatus();
    return standingStatus(connectionStateText(connection));
  }
  if (content.kind === 'noContainer') return restoreStatusOf(content.restore);
  if (problemStatus !== null) return problemStatus;
  if (sharedCode.kind === 'notFetched') return mayPassStatus();
  if (connection.kind === 'ended') return standingStatus(connectionStateText(connection));
  if (connection.kind === 'reconnecting' && connection.isKeptOut === true && workbook.kind !== 'open')
    return mayPass ? mayPassStatus() : standingStatus(workbookStateText(workbook) ?? connectionStateText(connection));
  if (connection.kind !== 'open') return onItsWayStatus(connectionStateText(connection));
  if (content.kind === 'loading' || isOpening) return onItsWayStatus(loadingStatusText());
  if (mayPass) return mayPassStatus();
  return standingStatus(workbookStateText(workbook) ?? connectionStateText(connection));
}
export function sheetProblemSummary(state: SheetStatusSource): ConnectionProblem | null {
  let { connection, workbook } = state;
  if (connection.kind === 'open') return null;
  let { inWords, kind } = sheetStatusOf(state);
  let closedByPage = connection.kind === 'ended' && connection.reason.kind === 'closedByPage';
  return {
    inWords,
    mayPass: kind === 'onItsWay',
    asksForReload: kind === 'stands' && !closedByPage,
    areEditsUnsaved: workbook.kind === 'open' && workbook.workbook.hasUnsavedEdits(),
  };
}
export function mountSheetStatusAnnouncer(container: Element): (state: SheetStatusSource | null) => void {
  let statusElement = document.createElement('p');
  statusElement.setAttribute('role', 'status');
  container.replaceChildren(statusElement);
  return (state) => {
    let text = state === null ? '' : sheetStatusOf(state).inWords;
    if (statusElement.textContent !== text) statusElement.textContent = text;
  };
}
export const loadingStatusText = (): string =>
  translateMessage({
    defaultMessage: 'Loading…',
    id: 'woaALHtoAw',
  });
export const sheetLoadedText = (): string =>
  translateMessage({
    defaultMessage: 'Sheet loaded',
    id: 'EV45YxQ50D',
  });
export const latestContentFailedText = (): string =>
  translateMessage({
    defaultMessage: 'The latest content failed to load',
    id: 'eSLxF7tiiQ',
  });
export const onItsWayStatus = (inWords: string): SheetStatus => ({
  inWords,
  shownAs: null,
  kind: 'onItsWay',
});
export const mayPassStatus = (): SheetStatus => ({
  inWords: latestContentFailedText(),
  shownAs: null,
  kind: 'mayPass',
});
export const mayBeRestoredStatus = (inWords: string): SheetStatus => ({
  inWords,
  shownAs: null,
  kind: 'mayBeRestored',
});
export const standingStatus = (inWords: string): SheetStatus => ({
  inWords,
  shownAs: null,
  kind: 'stands',
});
export const headedStatus = (heading: string, text: string): SheetStatus => ({
  inWords: translateMessage(
    {
      defaultMessage: '{heading}. {text}',
      id: 'X4+aLGOPfo',
    },
    {
      heading,
      text,
    },
  ),
  shownAs: {
    heading,
    text,
  },
  kind: 'stands',
});
