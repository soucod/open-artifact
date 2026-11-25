import { Dialog } from '../kit/dialog.tsx';
import { Shortcut } from '../kit/shortcut.tsx';
import * as React from 'react';
import type { KeyWithModifiers } from '../keys/key-press.ts';
import type { KeyShortcutGroup, KeyShortcutRow } from '../keys/shortcut-list.ts';
import { NUMBER_FORMAT_SHORTCUTS } from '../keys/key-acts.ts';
import { shortcutActionLabel, shortcutListMessages, shortcutGroupLabel } from '../messages/shortcut-labels.ts';
import { IS_APPLE_PLATFORM } from './dom-events.ts';
import { KEYS_LISTED } from '../keys/shortcut-list.ts';
import { useCoarsePointerMedia } from '../app/media-queries.ts';
export interface ShortcutListRowProps {
  row: KeyShortcutRow;
}
export interface ShortcutListGroupProps extends KeyShortcutGroup {}
export interface KeyboardShortcutsDialogProps {
  isOpen: boolean;
  isViewOnly: boolean;
  hasComments: boolean;
  whatHasCaretAfter: () => HTMLElement | false;
  onShut: () => void;
}
export function isKeyboardShortcutsKey(
  { key, code, shiftKey, altKey, metaKey, ctrlKey }: KeyWithModifiers,
  isMac: boolean,
): boolean {
  if (key !== '/' || altKey || (isMac ? !metaKey || ctrlKey : !ctrlKey || metaKey)) return false;
  return !shiftKey || !ctrlKey || NUMBER_FORMAT_SHORTCUTS[code.replace(/^Digit/, '')] === undefined;
}
export function ShortcutListRow({ row }: ShortcutListRowProps) {
  return <li className="sheet-listed-key flex flex-wrap items-center justify-between gap-x-md gap-y-0 py-xs break-inside-avoid"><span className="text-body flex-1">{shortcutActionLabel(row.does)}</span><span className="ms-auto flex shrink-0 items-center gap-sm">{((IS_APPLE_PLATFORM ? row.keysOnAMac : undefined) ?? row.keys).map(
          (keys, keysIndex) =>
            (<React.Fragment key={keys}>{keysIndex > 0 &&
                    <span className="text-secondary text-caption">{shortcutListMessages.or()}</span>}<Shortcut keys={keys} /></React.Fragment>),
        )}</span></li>;
}
export function ShortcutListGroup({ group, rows }: ShortcutListGroupProps) {
  let headingId = React.useId();
  return <div className="mb-lg flex break-inside-avoid flex-col gap-sm"><h3 id={headingId} className="text-secondary text-caption">{shortcutGroupLabel(group)}</h3><ul aria-labelledby={headingId}>{rows.map(
          (row) =>
            <ShortcutListRow key={row.does} row={row} />,
        )}</ul></div>;
}
export const isElementLiveAndNotInert = (element: Element): boolean => element.isConnected && element.closest('[inert]') === null;
export const SHORTCUT_GROUPS_ALL = KEYS_LISTED;
export const SHORTCUT_GROUPS_FOR_VIEWERS = SHORTCUT_GROUPS_ALL.map(
  ({ group, rows }) => ({
    group,
    rows: rows.filter((row) => row.isForViewersToo === true),
  }),
).filter(({ rows }) => rows.length > 0);
export const KeyboardShortcutsDialog = React.memo(function ({
  isOpen,
  isViewOnly,
  hasComments,
  whatHasCaretAfter,
  onShut,
}: KeyboardShortcutsDialogProps) {
  let isPointerCoarse = useCoarsePointerMedia();
  let onOpenChange = React.useCallback(
    (willOpen: boolean) => {
      if (!willOpen) onShut();
    },
    [onShut],
  );
  return <Dialog.Root open={isOpen} onOpenChange={onOpenChange}><Dialog.Popup size="2xl" finalFocus={whatHasCaretAfter}><Dialog.Header>{shortcutListMessages.title()}</Dialog.Header><div className="gap-x-xl sm:columns-2">{(isViewOnly ? SHORTCUT_GROUPS_FOR_VIEWERS : SHORTCUT_GROUPS_ALL).map(
            ({ group, rows }) =>
              (<ShortcutListGroup key={group} group={group} rows={rows.filter(
                    (row) =>
                      (hasComments || row.isOnlyWithComments !== true) && (!isPointerCoarse || row.isNotForAFinger !== true),
                  )} />),
          )}</div></Dialog.Popup></Dialog.Root>;
});
