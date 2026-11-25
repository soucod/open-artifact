import { Menu, menuItemVariants, type MenuPopupProps } from '../../kit/menu.tsx';
import { Icon } from '../../kit/icon.tsx';
import { Tooltip, TooltipGroup } from '../../kit/tooltip.tsx';
import { Button } from '../../kit/button.tsx';
import * as React from 'react';
import type { SheetId } from '@open-artifact/sheets-core';
import type { ListedSheet, ViewOnlyBecause } from '../../view/page-view.ts';
import type { SheetController } from '../../state/controller.ts';
import type { PageEvent } from '../../state/event-reducer.ts';
import type { CaretTarget } from '../../tables/own-filter-bar-view.tsx';
import { moreOptionsForSheetLabel, sheetMessages } from '../../i18n/sheet-messages.ts';
import { SheetTabMenuItems, SheetNameField } from './tab-menu.tsx';
import { sheetNameRefusedText } from '../../i18n/notice-labels.ts';
import { defaultSheetName } from '../../i18n/sheet-names.ts';
import { swallowRestOfPress, swallowPressAfterItemPress } from '../press-swallow.ts';
import { createPressTracker } from '../../app/press-tracker.ts';
import { isSheetNameLeftForWindow, othersOnSheetDescription, TabCommentCount, TabFaces, OthersOnSheetText, sheetTabLabel, BetaBadge } from './tab-badges.tsx';
import { centerCheckedItemRef, MENU_MAX_VISIBLE_ITEMS } from '../menu-scroll.ts';
import { ListRowTooltip } from '../list-under-cell.tsx';
import { usePopupRoomAtFoot } from '../../shell/bottom-insets.ts';
import { whenWindowBlurred } from '../../grid/focus-left.ts';
import { preventMouseDownDefault } from '../dom-events.ts';
import { AddSheetButton, isAddSheetBlankOnly, AddSheetMenuItems, type AddSheetMenuItemsProps, type MenuOpenChange } from './add-sheet.tsx';
import { isTrustedEscapeClose } from '../../app/page-guards.ts';
import { MenuTriggerButton } from '../menu-trigger.tsx';
import { menuTakesCaretOnSmallTouch } from '../menu-initial-focus.ts';
import { SheetTabStrip } from './tab-strip.tsx';
/** Where a row stands in the list of sheets, as assistive tech is told it. */
export interface SheetListPosition {
  'aria-posinset': number;
  'aria-setsize': number;
}
/** What the list of sheets is drawn from. */
export interface SheetListProps {
  listedSheets: ListedSheet[];
  viewOnlyBecause: ViewOnlyBecause | null;
  whatHasCaretAfterList: () => CaretTarget;
  dispatch: SheetController['dispatch'];
}
export interface SheetListMenuProps extends SheetListProps {
  tabListRef: React.RefObject<HTMLDivElement | null>;
  onRenameChosen: (sheetId: SheetId) => void;
}
export interface SheetPickerProps extends SheetListProps, Pick<AddSheetMenuItemsProps, 'onImportChosen' | 'filesForAgent' | 'onFileForAgentChosen'> {
  ref: React.Ref<HTMLDivElement>;
  addSheetButton: React.RefObject<HTMLElement | null>;
  isUnfinishedFormulaOpen: boolean;
  timesRenameBegunElsewhere: number;
  onListOpenChange: MenuOpenChange;
  onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  isChosenForFormula: (sheetId: SheetId) => boolean;
  lookOnceEventsAreFinished: SheetController['lookOnceEventsAreFinished'];
}
export interface SheetRowMenuProps {
  sheet: ListedSheet;
  placeAmongSheets: SheetListPosition;
  isOnlySheet: boolean;
  viewOnlyBecause: ViewOnlyBecause | null;
  onRenameChosen: (sheetId: SheetId) => void;
  dispatch: SheetController['dispatch'];
}
export function SheetRowMenu({
  sheet,
  placeAmongSheets,
  isOnlySheet,
  viewOnlyBecause,
  onRenameChosen,
  dispatch,
}: SheetRowMenuProps) {
  let { name: sheetName, renaming } = sheet;
  let [isSubmenuOpen, setSubmenuOpen] = React.useState(false);
  let triggerRef = React.useRef<HTMLElement | null>(null);
  return <Menu.Submenu open={isSubmenuOpen} onOpenChange={setSubmenuOpen}><Menu.SubmenuTrigger ref={triggerRef} {...placeAmongSheets} aria-label={moreOptionsForSheetLabel(sheetName)} label="" openOnHover={false} onClick={swallowPressInSheetPresentation} disabled={renaming !== null} className={`w-auto flex-none self-stretch ${renaming === null ? '' : 'invisible'}`} render={(triggerProps) =>
          <div {...triggerProps}><Icon name="DotsHorizontal" size="sm" /></div>}>{sheetName}</Menu.SubmenuTrigger><Menu.Popup align="end" collisionAvoidance={SHEET_MENU_COLLISION_AVOIDANCE} finalFocus={() => findSheetRowNameField(triggerRef.current) ?? true}><SheetTabMenuItems sheet={sheet} isOnlySheet={isOnlySheet} viewOnlyBecause={viewOnlyBecause} onRenameChosenInList={() => {
            setSubmenuOpen(false);
            onRenameChosen(sheet.sheetId);
          }} dispatch={dispatch} /></Menu.Popup></Menu.Submenu>;
}
export interface SheetRowRenameFieldProps {
  renaming: NonNullable<ListedSheet['renaming']>;
  dispatch: SheetController['dispatch'];
}
export function SheetRowRenameField({ renaming, dispatch }: SheetRowRenameFieldProps) {
  let whyNotId = React.useId();
  let { refused } = renaming;
  return <div role="presentation" className={menuItemVariants({
      className: 'col-start-1 row-start-1 min-w-0',
    })}><div role="presentation" className="flex min-w-0 flex-1 flex-col"><SheetNameField renaming={renaming} whyNotId={whyNotId} dispatch={dispatch} />{refused !== null &&
          <p id={whyNotId} role="alert" className="text-footnote text-danger">{sheetNameRefusedText(refused)}</p>}</div></div>;
}
export const blankSheetChooser =
  (dispatch: SheetController['dispatch']) =>
  () =>
    dispatch({
      kind: 'sheetAddChosen',
      nameStem: defaultSheetName(),
    });
export const dispatchFromSheetList =
  (listedSheets: readonly ListedSheet[], dispatch: SheetController['dispatch']) =>
  (event: PageEvent) => {
    if (listedSheets.some(({ renaming }) => renaming !== null))
      dispatch({
        kind: 'sheetNameLeft',
      });
    dispatch({
      kind: 'sheetListOpened',
    });
    dispatch(event);
  };
export const isSameListedSheet = (sheet: ListedSheet, other: ListedSheet | undefined) =>
  sheet.sheetId === other?.sheetId &&
  sheet.name === other.name &&
  sheet.isShown === other.isShown &&
  sheet.isInteractive === other.isInteractive &&
  sheet.holdsOpenEntry === other.holdsOpenEntry &&
  sheet.canBeDeleted === other.canBeDeleted &&
  sheet.isWhereAgentWorks === other.isWhereAgentWorks &&
  sheet.openCommentCount === other.openCommentCount &&
  sheet.renaming?.typed === other.renaming?.typed &&
  sheet.renaming?.refused === other.renaming?.refused &&
  sheet.facesOfOthers === other.facesOfOthers;
export const areSheetListPropsSame = (before: SheetListProps, after: SheetListProps) =>
  after.listedSheets.length === before.listedSheets.length &&
  after.listedSheets.every((sheet, index) => isSameListedSheet(sheet, before.listedSheets[index])) &&
  after.viewOnlyBecause === before.viewOnlyBecause &&
  after.whatHasCaretAfterList === before.whatHasCaretAfterList &&
  after.dispatch === before.dispatch;
export const areSheetListMenuPropsSame = (before: SheetListMenuProps, after: SheetListMenuProps) =>
  areSheetListPropsSame(before, after) && after.onRenameChosen === before.onRenameChosen;
export const areSheetPickerPropsSame = (before: SheetPickerProps, after: SheetPickerProps) =>
  areSheetListPropsSame(before, after) &&
  after.ref === before.ref &&
  after.isUnfinishedFormulaOpen === before.isUnfinishedFormulaOpen &&
  after.timesRenameBegunElsewhere === before.timesRenameBegunElsewhere &&
  after.onListOpenChange === before.onListOpenChange &&
  after.onKeyDown === before.onKeyDown &&
  after.isChosenForFormula === before.isChosenForFormula &&
  after.onImportChosen === before.onImportChosen &&
  after.filesForAgent === before.filesForAgent &&
  after.onFileForAgentChosen === before.onFileForAgentChosen &&
  after.lookOnceEventsAreFinished === before.lookOnceEventsAreFinished;
export const sheetListPositionProps = (listedSheets: readonly ListedSheet[], index: number): SheetListPosition => ({
  'aria-posinset': index + 1,
  'aria-setsize': listedSheets.length,
});
export const SHEET_MENU_COLLISION_AVOIDANCE: MenuPopupProps['collisionAvoidance'] = {
  fallbackAxisSide: 'start',
};
export const findSheetPickerNameField = (trigger: Element | null) =>
  trigger?.closest('.sheet-picker')?.querySelector<HTMLElement>('.sheet-name-field') ?? null;
export const withoutSheetRenaming = (listedSheets: ListedSheet[]): ListedSheet[] =>
  listedSheets.map(
    (sheet) =>
      sheet.renaming === null
        ? sheet
        : {
            ...sheet,
            renaming: null,
          },
  );
export const swallowPressInSheetPresentation = (event: React.MouseEvent<HTMLElement>) => {
  if (event.currentTarget.closest('[data-presentation="sheet"]') !== null) swallowRestOfPress(event);
};
export const findSheetRowNameField = (trigger: Element | null) =>
  trigger?.closest('[data-sheet-row]')?.querySelector<HTMLElement>('.sheet-name-field') ?? null;
export const SheetListMenu = React.memo(function ({
  tabListRef,
  listedSheets,
  viewOnlyBecause,
  whatHasCaretAfterList,
  onRenameChosen,
  dispatch,
}: SheetListMenuProps) {
  let groupRef = React.useRef<HTMLDivElement | null>(null);
  let renamingSheetId = listedSheets.find(({ renaming }) => renaming !== null)?.sheetId;
  let lastRenamingSheetIdRef = React.useRef(renamingSheetId);
  let isBlurringByPressRef = React.useRef(false);
  let pressTrackerRef = React.useRef<ReturnType<typeof createPressTracker> | null>(null);
  React.useEffect(() => {
    let defaultView = groupRef.current?.ownerDocument.defaultView ?? null;
    if (defaultView === null) return;
    let pressTracker = createPressTracker(defaultView);
    pressTrackerRef.current = pressTracker;
    return () => pressTracker.stop();
  }, []);
  React.useLayoutEffect(() => {
    let lastRenamingSheetId = lastRenamingSheetIdRef.current;
    lastRenamingSheetIdRef.current = renamingSheetId;
    let ownerDocument = groupRef.current?.ownerDocument;
    if (lastRenamingSheetId === undefined || renamingSheetId !== undefined) return;
    let wasBlurByPress = isBlurringByPressRef.current;
    isBlurringByPressRef.current = false;
    if (wasBlurByPress) return;
    if (ownerDocument === undefined || ownerDocument.activeElement !== ownerDocument.body || !ownerDocument.hasFocus()) return;
    (
      [...(groupRef.current?.querySelectorAll('[data-sheet-row]') ?? [])]
        .find((row) => row.getAttribute('data-sheet-row') === lastRenamingSheetId)
        ?.querySelector<HTMLElement>('[role="menuitemradio"]') ?? tabListRef.current
    )?.focus({
      preventScroll: true,
    });
    if (ownerDocument.activeElement !== ownerDocument.body) return;
    let caretTarget = whatHasCaretAfterList();
    if (caretTarget !== false)
      caretTarget.focus({
        preventScroll: true,
      });
  });
  return <Menu.Group ref={groupRef} aria-label={sheetMessages.sheets()} onFocusCapture={() => {
      isBlurringByPressRef.current = false;
    }} onBlurCapture={(event) => {
      isBlurringByPressRef.current = isSheetNameLeftForWindow(event, pressTrackerRef.current?.isUnderWay() === true);
    }}>{listedSheets.map(
      (sheet, index) =>
        (<div key={sheet.sheetId} role="presentation" data-sheet-row={sheet.sheetId} className="flex items-center gap-xs"><div role="presentation" className="grid min-w-0 flex-1"><Menu.Item {...sheetListPositionProps(listedSheets, index)} {...othersOnSheetDescription(sheet.sheetId, sheet.facesOfOthers)} aria-label={sheetTabLabel(sheet)} ref={sheet.isShown ? centerCheckedItemRef : undefined} className={`col-start-1 row-start-1 min-w-0 self-start ${sheet.renaming === null ? '' : 'invisible'}`} checked={sheet.isShown} checkedRole="radio" checkPosition="trailing" label={sheet.name} onClick={() =>
                      dispatch({
                        kind: 'sheetChosen',
                        sheetId: sheet.sheetId,
                        isPickedInList: true,
                      })}><span className="flex items-center gap-sm"><ListRowTooltip className="block max-w-64">{sheet.name}</ListRowTooltip>{sheet.isInteractive && <BetaBadge />}<TabCommentCount count={sheet.openCommentCount} />{sheet.facesOfOthers.length > 0 &&
                          <TabFaces faces={sheet.facesOfOthers} />}</span></Menu.Item>{sheet.renaming !== null &&
                    <SheetRowRenameField renaming={sheet.renaming} dispatch={dispatch} />}</div><SheetRowMenu sheet={sheet} placeAmongSheets={sheetListPositionProps(listedSheets, index)} isOnlySheet={listedSheets.length === 1} viewOnlyBecause={viewOnlyBecause} onRenameChosen={onRenameChosen} dispatch={dispatch} /></div>),
    )}</Menu.Group>;
}, areSheetListMenuPropsSame);
export const SheetPicker = React.memo(function ({
  ref,
  addSheetButton,
  isUnfinishedFormulaOpen,
  timesRenameBegunElsewhere,
  onListOpenChange,
  onKeyDown,
  isChosenForFormula,
  onImportChosen,
  filesForAgent,
  onFileForAgentChosen,
  lookOnceEventsAreFinished,
  ...listProps
}: SheetPickerProps) {
  let {
    listedSheets,
    viewOnlyBecause,
    whatHasCaretAfterList,
    dispatch,
  } = listProps;
  let leaveSheetRenaming = () => {
    if (listedSheets.some(({ renaming }) => renaming !== null))
      dispatch({
        kind: 'sheetNameLeft',
      });
  };
  let dispatchFromAddMenu = (event: PageEvent) => {
    leaveSheetRenaming();
    if (event.kind !== 'sheetChosen' || !isChosenForFormula(event.sheetId))
      dispatch({
        kind: 'sheetListOpened',
      });
    dispatch(event);
  };
  let addChoices = {
    onBlankChosen: blankSheetChooser(dispatchFromAddMenu),
    onImportChosen,
    filesForAgent,
    onFileForAgentChosen,
  };
  let isAddingOff = isUnfinishedFormulaOpen || listedSheets.some(({ renaming }) => renaming !== null);
  let [isAddMenuOpen, setAddMenuOpen] = React.useState(false);
  let [isListOpen, setListOpen] = React.useState(false);
  let listButtonRef = React.useRef<HTMLElement | null>(null);
  let tabListRef = React.useRef<HTMLDivElement | null>(null);
  let [hasListTakenCaret, setListTakenCaret] = React.useState(false);
  let listClosedByKeyboardRef = React.useRef(false);
  let renameOnPickRef = React.useRef(false);
  let renamingSheetId = isListOpen ? listedSheets.find(({ renaming }) => renaming !== null)?.sheetId : undefined;
  let [lastRenamingSheetId, setLastRenamingSheetId] = React.useState(renamingSheetId);
  let [isRenamedSheetGone, setRenamedSheetGone] = React.useState(false);
  let setListOpenAndTell = (isOpen: boolean, event: Event | null, byKeyboard: boolean) => {
    listClosedByKeyboardRef.current = byKeyboard;
    setListOpen(isOpen);
    if (isOpen) setAddMenuOpen(false);
    setRenamedSheetGone(false);
    onListOpenChange(isOpen, event);
    if (isOpen) leaveSheetRenaming();
    dispatch({
      kind: isOpen ? 'sheetListOpened' : 'sheetListShut',
    });
  };
  let setAddMenuOpenAndTell: MenuOpenChange = (isOpen, event) => {
    if (isOpen && isUnfinishedFormulaOpen) return;
    if (isOpen && isListOpen) setListOpenAndTell(false, event, false);
    setAddMenuOpen(isOpen);
    onListOpenChange(isOpen, event);
    if (!isOpen) return;
    leaveSheetRenaming();
    dispatch({
      kind: 'sheetListOpened',
    });
  };
  let chooseSheetAfterRename = React.useCallback(
    (sheetId: SheetId) => {
      if (!renameOnPickRef.current) return;
      listClosedByKeyboardRef.current = false;
      setListOpen(false);
      onListOpenChange(false, new Event('renamechosen'));
      dispatch({
        kind: 'sheetListShut',
      });
      dispatch({
        kind: 'sheetChosen',
        sheetId,
        isPickedInList: true,
      });
    },
    [onListOpenChange, dispatch],
  );
  let popupRoom = usePopupRoomAtFoot(isListOpen, () => listButtonRef.current);
  if (renamingSheetId !== lastRenamingSheetId) {
    setLastRenamingSheetId(renamingSheetId);
    if (lastRenamingSheetId !== undefined && !listedSheets.some(({ sheetId }) => sheetId === lastRenamingSheetId)) {
      setListOpen(false);
      setRenamedSheetGone(true);
    }
  }
  React.useLayoutEffect(() => {
    if (!isRenamedSheetGone) return;
    onListOpenChange(false, new Event('sheetgone'));
    dispatch({
      kind: 'sheetListShut',
    });
  }, [isRenamedSheetGone, onListOpenChange, dispatch]);
  let isRenaming = renamingSheetId !== undefined;
  React.useEffect(() => {
    let defaultView = listButtonRef.current?.ownerDocument.defaultView ?? null;
    if (!isListOpen || defaultView === null) return;
    let closeList = (event: FocusEvent) => {
      setListOpen(false);
      onListOpenChange(false, event);
      dispatch({
        kind: 'sheetListShut',
      });
    };
    let onWindowBlur = (event: FocusEvent) =>
      isRenaming ? whenWindowBlurred(defaultView.document, () => closeList(event)) : closeList(event);
    defaultView.addEventListener('blur', onWindowBlur);
    return () => defaultView.removeEventListener('blur', onWindowBlur);
  }, [isListOpen, isRenaming, onListOpenChange, dispatch]);
  return <div ref={ref} role="presentation" className="sheet-picker flex min-w-0 flex-1 items-center gap-md" onMouseDown={preventMouseDownDefault} onKeyDown={onKeyDown}><TooltipGroup>{viewOnlyBecause === 'earlierVersionShown' &&
            <Button variant="ghost" iconOnly icon="Add" aria-label={sheetMessages.addSheet()} disabled />}{viewOnlyBecause === null &&
            <AddSheetButton button={addSheetButton} isOpen={isAddMenuOpen} onOpenChange={setAddMenuOpenAndTell} whatHasCaretAfter={whatHasCaretAfterList} {...addChoices} />}<Menu.Root modal={false} open={isListOpen} highlightItemOnHover={listedSheets.every(({ renaming }) => renaming === null)} onOpenChange={(isOpen, { reason, event }) => {
              swallowPressAfterItemPress(reason, event);
              setListOpenAndTell(isOpen, event, isTrustedEscapeClose(reason, event));
            }}><Tooltip content={sheetMessages.allSheets()} side="top" {...(isListOpen || isAddMenuOpen
                  ? {
                      open: false,
                    }
                  : {})}><MenuTriggerButton ref={listButtonRef} className="sheet-list-trigger" variant="ghost" icon="ListBullet" aria-label={sheetMessages.allSheets()} chevron="toolbar">{null}</MenuTriggerButton></Tooltip><Menu.Popup side="top" align="start" {...popupRoom} maxVisibleItems={MENU_MAX_VISIBLE_ITEMS} header={<>{viewOnlyBecause === null &&
                    (isAddSheetBlankOnly(filesForAgent)
                      ? <Menu.Item icon="Add" disabled={isAddingOff} onClick={addChoices.onBlankChosen}>{sheetMessages.addSheet()}</Menu.Item>
                      : <Menu.Submenu><Menu.SubmenuTrigger icon="Add" onClick={swallowPressInSheetPresentation} disabled={isAddingOff}>{sheetMessages.addSheet()}</Menu.SubmenuTrigger><Menu.Popup onMouseDown={preventMouseDownDefault}><AddSheetMenuItems {...addChoices} /></Menu.Popup></Menu.Submenu>)}</>} initialFocus={(openedBy) => {
                  renameOnPickRef.current = openedBy !== 'keyboard' && menuTakesCaretOnSmallTouch(listButtonRef.current);
                  let takesCaret = openedBy === 'keyboard' || renameOnPickRef.current;
                  setListTakenCaret(takesCaret);
                  return takesCaret;
                }} finalFocus={hasListTakenCaret &&
                  !isRenamedSheetGone &&
                  (() => findSheetPickerNameField(listButtonRef.current) ?? (listClosedByKeyboardRef.current || whatHasCaretAfterList()))} onMouseDown={preventMouseDownDefault} onKeyDownCapture={(event) => {
                  if (event.target instanceof HTMLInputElement && event.key !== 'Tab') return;
                  let isRepeatedPress = (event.key === 'Enter' || event.key === ' ') && event.repeat;
                  if (event.key !== 'Tab' && !isRepeatedPress) return;
                  event.preventDefault();
                  event.stopPropagation();
                  if (event.key === 'Tab') setListOpenAndTell(false, event.nativeEvent, true);
                }}><SheetListMenu {...listProps} listedSheets={isListOpen ? listedSheets : withoutSheetRenaming(listedSheets)} tabListRef={tabListRef} onRenameChosen={chooseSheetAfterRename} /></Menu.Popup></Menu.Root><SheetTabStrip listedSheets={listedSheets} viewOnlyBecause={viewOnlyBecause} tabListRef={tabListRef} isListOpen={isListOpen} isAddMenuOpen={isAddMenuOpen} isUnfinishedFormulaOpen={isUnfinishedFormulaOpen} whatHasCaretAfterMenu={whatHasCaretAfterList} timesRenameBegunElsewhere={timesRenameBegunElsewhere} onMenuOpenChange={(isOpen, event) => {
              if (isOpen) setAddMenuOpen(false);
              onListOpenChange(isOpen, event);
            }} dispatchAfterEntry={dispatchFromAddMenu} lookOnceEventsAreFinished={lookOnceEventsAreFinished} isChosenForFormula={isChosenForFormula} dispatch={dispatch} /></TooltipGroup>{listedSheets.map(
        ({ sheetId, facesOfOthers }) =>
          facesOfOthers.length > 0 &&
          <OthersOnSheetText key={sheetId} sheetId={sheetId} faces={facesOfOthers} />,
      )}</div>;
}, areSheetPickerPropsSame);
