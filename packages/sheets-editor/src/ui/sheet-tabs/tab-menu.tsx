import { Menu } from '../../kit/menu.tsx';
import type { ListedSheet, ViewOnlyBecause } from '../../view/page-view.ts';
import type { SheetController } from '../../state/controller.ts';
import * as React from 'react';
import { disabledByViewOnly } from '../why-not.tsx';
import { sheetMessages } from '../../i18n/sheet-messages.ts';
import { swallowRestOfPress } from '../press-swallow.ts';
import { copiedSheetNameAffixes } from '../../i18n/sheet-names.ts';
import { MenuItemWithWhyOff } from '../menu-item-why-off.tsx';
import { offerKeyboardWhenReady } from '../keyboard-handoff.ts';
import { whenBlurredToNothing } from '../../grid/focus-left.ts';
/** Where a tab stands among the tabs. */
export interface PlaceAmongTabs {
  index: number;
  count: number;
}
export interface SheetTabMenuItemsProps {
  sheet: ListedSheet;
  isOnlySheet: boolean;
  placeAmongTabs?: PlaceAmongTabs;
  viewOnlyBecause: ViewOnlyBecause | null;
  onRenameChosenInList?: () => void;
  dispatch: SheetController['dispatch'];
}
export function SheetTabMenuItems({
  sheet: { sheetId, canBeDeleted, isShown },
  isOnlySheet,
  placeAmongTabs,
  viewOnlyBecause,
  onRenameChosenInList,
  dispatch,
}: SheetTabMenuItemsProps) {
  let editAction = disabledByViewOnly(viewOnlyBecause);
  let deleteAction =
    editAction.disabled || canBeDeleted
      ? editAction
      : {
          disabled: true,
          disabledReason: isOnlySheet ? sheetMessages.onlySheet() : null,
        };
  let canEdit = viewOnlyBecause !== 'readOnly';
  return <>{canEdit &&
        (<Menu.Item icon="Edit" {...editAction} keepOpen={onRenameChosenInList !== undefined} onClick={(event) => {
            if (onRenameChosenInList !== undefined) swallowRestOfPress(event);
            onRenameChosenInList?.();
            dispatch({
              kind: 'sheetRenameChosen',
              sheetId,
            });
          }}>{sheetMessages.renameSheet()}</Menu.Item>)}{canEdit &&
        (<Menu.Item icon="Copy" {...editAction} onClick={() =>
            dispatch({
              kind: 'sheetDuplicateChosen',
              sheetId,
              wordsAroundName: copiedSheetNameAffixes(),
            })}>{sheetMessages.duplicateSheet()}</Menu.Item>)}<Menu.Item icon="Link" {...(isShown
          ? {
              shortcut: 'alt+cmd+l',
            }
          : {})} onClick={() =>
          dispatch({
            kind: 'sheetLinkCopyChosen',
            sheetId,
          })}>{sheetMessages.copyLinkToSheet()}</Menu.Item>{canEdit &&
        placeAmongTabs !== undefined &&
        (<><Menu.Item icon="ArrowLeft" {...(placeAmongTabs.index === 0 ? DISABLED_WITHOUT_REASON : editAction)} onClick={() =>
                dispatch({
                  kind: 'sheetMoveChosen',
                  sheetId,
                  toIndex: placeAmongTabs.index - 1,
                })}>{sheetMessages.moveSheetLeft()}</Menu.Item><Menu.Item icon="ArrowRight" {...(placeAmongTabs.index === placeAmongTabs.count - 1 ? DISABLED_WITHOUT_REASON : editAction)} onClick={() =>
                dispatch({
                  kind: 'sheetMoveChosen',
                  sheetId,
                  toIndex: placeAmongTabs.index + 1,
                })}>{sheetMessages.moveSheetRight()}</Menu.Item></>)}{canEdit &&
        (<MenuItemWithWhyOff variant="danger" icon="Trash" disabled={deleteAction.disabled} whyOff={deleteAction.disabledReason} onClick={() =>
            dispatch({
              kind: 'sheetDeleteChosen',
              sheetId,
            })}>{sheetMessages.deleteSheet()}</MenuItemWithWhyOff>)}</>;
}
export interface SheetNameFieldProps {
  renaming: NonNullable<ListedSheet['renaming']>;
  whyNotId: string;
  dispatch: SheetController['dispatch'];
}
export function SheetNameField({ renaming: { typed, refused }, whyNotId, dispatch }: SheetNameFieldProps) {
  let fieldRef = React.useRef<HTMLInputElement | null>(null);
  let focusField = React.useEffectEvent(() => {
    let field = fieldRef.current;
    if (field === null) return;
    let dropRename = () =>
      dispatch({
        kind: 'sheetRenameDropped',
      });
    return offerKeyboardWhenReady(
      field,
      () => {
        field.focus({
          preventScroll: true,
        });
        if (field.ownerDocument.activeElement !== field) dropRename();
      },
      {
        keys: {
          onShut: dropRename,
        },
        onGivenUp: dropRename,
      },
    );
  });
  let isComposingRef = React.useRef(false);
  React.useEffect(() => focusField(), []);
  return <input ref={fieldRef} className="sheet-name-field" aria-label={sheetMessages.sheetName()} aria-invalid={refused !== null} aria-describedby={refused === null ? undefined : whyNotId} spellCheck={false} autoComplete="off" autoCorrect="off" value={typed} onChange={({ target }) =>
      dispatch({
        kind: 'sheetNameTyped',
        text: target.value,
      })} onFocus={({ currentTarget }) => {
      if (!isComposingRef.current) currentTarget.select();
      isComposingRef.current = true;
    }} onBlur={({ relatedTarget, currentTarget }) => {
      if (relatedTarget !== null)
        dispatch({
          kind: 'sheetNameLeft',
          mayComeBack: false,
        });
      else
        whenBlurredToNothing(
          currentTarget,
          () =>
            dispatch({
              kind: 'sheetNameLeft',
              mayComeBack: true,
            }),
        );
    }} onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => {
      event.stopPropagation();
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.repeat || (event.key !== 'Enter' && event.key !== 'Escape')) return;
      event.preventDefault();
      dispatch({
        kind: event.key === 'Enter' ? 'sheetNameEntered' : 'sheetRenameDropped',
      });
    }} />;
}
export const DISABLED_WITHOUT_REASON = {
  disabled: true,
  disabledReason: null,
};
