import * as React from 'react';
import { FieldRoot, FieldLabel, FieldError, FieldDescription } from '../kit/field.tsx';
import { TextInput } from '../kit/text-input.tsx';
import { Button } from '../kit/button.tsx';
import { Menu } from '../kit/menu.tsx';
import { Popover } from '../kit/popover.tsx';
import { ToolbarMenu } from '../ui/format-toolbar.tsx';
import { MenuTriggerButton } from '../ui/menu-trigger.tsx';
import { MenuItemWithWhyOff } from '../ui/menu-item-why-off.tsx';
import { wrapTabFocusInBar } from '../ui/dom-events.ts';
import { isComposingKeyEvent } from '../links/link-edit-popup.tsx';
import { linkEditMessages } from '../links/link-hover-card.tsx';
import { cleanNamedViewName } from './named-view-actions.ts';
import { namedViewMessages, namedViewLimitWhyOff } from './named-view-messages.ts';
import type { NamedViewChange } from './named-view-actions.ts';
import type { NamedViewName, NamedViewsOfTable } from './named-view-model.ts';
import type { MenuOpenChange } from '../ui/sheet-tabs/add-sheet.tsx';
import type { CaretTarget } from './own-filter-bar-view.tsx';
export interface NamedViewNameFormProps {
  views: NamedViewsOfTable;
  /** The view being renamed, or `null` when a new one is being named. */
  renamed: NamedViewName | null;
  field: React.RefObject<HTMLInputElement | null>;
  onNamed: (name: string) => void;
  onShut: () => void;
}
export interface NamedViewsMenuProps {
  views: NamedViewsOfTable;
  onPicked: (tableKey: string, namedViewId: string) => void;
  /** `null` when the views can only be picked, not saved or changed. */
  onChanged: ((tableKey: string, change: NamedViewChange) => void) | null;
  onOpenChange: MenuOpenChange;
  whatHasCaretAfter: () => CaretTarget;
}
/** Whether the popover that names a view is open, the view it renames, and how many times it was opened. */
interface NamingOfView {
  isOpen: boolean;
  renamed: NamedViewName | null;
  timesOpened: number;
}
export function NamedViewNameForm({
  views,
  renamed,
  field,
  onNamed,
  onShut,
}: NamedViewNameFormProps) {
  let [name, setName] = React.useState(
      renamed?.name ?? '',
    ),
    [isNameTaken, setIsNameTaken] = React.useState(false),
    cleanName = cleanNamedViewName(name),
    saveName = () => {
      if (cleanName === '') return;
      if (
        views.allInSheet
          .filter(
            (view) => view.namedViewId !== renamed?.namedViewId,
          )
          .some(
            (view) =>
              view.name.toLowerCase() === cleanName.toLowerCase(),
          )
      )
        setIsNameTaken(true);
      else onNamed(cleanName);
    };
  return (
    <div className="flex flex-col gap-md">
      <FieldRoot invalid={isNameTaken}>
        <FieldLabel>{namedViewMessages.name()}</FieldLabel>
        <TextInput
          ref={field}
          value={name}
          maxLength={views.limits.longestNameOfANamedViewInCharacters}
          onChange={(event) => {
            (setName(event.target.value), setIsNameTaken(false));
          }}
          onKeyDown={(event) => {
            if (
              event.key !== 'Enter' ||
              isComposingKeyEvent(event)
            )
              return;
            if ((event.preventDefault(), !event.repeat)) saveName();
          }}
          autoComplete="off"
        />
        {isNameTaken
          ? (
            <FieldError match>
              <span role="alert">{namedViewMessages.nameTaken()}</span>
            </FieldError>
          )
          : <FieldDescription>{namedViewMessages.forEveryone()}</FieldDescription>}
      </FieldRoot>
      <div className="flex justify-end gap-sm">
        <Button onClick={onShut}>{linkEditMessages.cancel()}</Button>
        <Button variant="primary" disabled={cleanName === ''} onClick={saveName}>{linkEditMessages.save()}</Button>
      </div>
    </div>
  );
}
export function NamedViewsMenu({
  views,
  onPicked,
  onChanged,
  onOpenChange,
  whatHasCaretAfter,
}: NamedViewsMenuProps) {
  let buttonRef = React.useRef<HTMLElement>(null),
    fieldRef = React.useRef<HTMLInputElement>(null),
    [isMenuOpen, setIsMenuOpen] = React.useState(false),
    [naming, setNaming] = React.useState<NamingOfView>({
      isOpen: false,
      renamed: null,
      timesOpened: 0,
    }),
    isNamingOpen = naming.isOpen && onChanged !== null;
  if (naming.isOpen && !isNamingOpen)
    setNaming({
      ...naming,
      isOpen: false,
    });
  let shutBy = React.useRef<Event | null>(null),
    isOpen = isMenuOpen || isNamingOpen;
  React.useEffect(() => {
    if (!isOpen) return;
    return (
      (shutBy.current = null),
      onOpenChange(true, null),
      () => onOpenChange(false, shutBy.current)
    );
  }, [isOpen, onOpenChange]);
  let {
      tableKey,
      all,
      inHand,
      isAnythingAsked,
    } = views,
    mostViews = views.limits.mostNamedViewsInASheet,
    isEdited = inHand?.isEdited === true,
    canSaveNew =
      onChanged !== null && isAnythingAsked && (inHand === null || isEdited);
  if (all.length === 0 && !canSaveNew && !naming.isOpen) return null;
  let openNaming = (renamedView: NamedViewName | null) =>
      setNaming({
        isOpen: true,
        renamed: renamedView,
        timesOpened: naming.timesOpened + 1,
      }),
    shutNaming = (event: Event | null) => {
      ((shutBy.current = event),
        setNaming({
          ...naming,
          isOpen: false,
        }));
    },
    inHandName =
      inHand === null
        ? null
        : isEdited
          ? namedViewMessages.edited(inHand.name)
          : inHand.name;
  return (
    <>
      <ToolbarMenu
        isOpen={isMenuOpen}
        button={
          <MenuTriggerButton
            ref={buttonRef}
            variant="ghost"
            size="xs"
            chevron="toolbar"
            className="max-w-48 shrink-0 text-accent"
            {...(inHandName !== null && {
              'aria-label': namedViewMessages.button(inHandName),
            })}
          >
            <span className="min-w-0 truncate">{inHand?.name ?? namedViewMessages.views()}</span>
            {isEdited &&
              <span className="shrink-0">{namedViewMessages.editedAfterName()}</span>}
          </MenuTriggerButton>
        }
        tooltip={null}
        onOpenChange={(isOpen, event) => {
          ((shutBy.current = event), setIsMenuOpen(isOpen));
        }}
        whatHasCaretAfter={whatHasCaretAfter}
        isPickerInItsPlace={naming.isOpen}
        toolbar={buttonRef}
        side="bottom"
        placedBy={{
          align: 'start',
        }}
      >
        {all.length > 0 &&
          <Menu.Group>
            <Menu.GroupLabel>{namedViewMessages.savedViews()}</Menu.GroupLabel>
            {all.map(({ namedViewId, name }) =>
              <Menu.Item
                key={namedViewId}
                checkedRole="radio"
                checked={namedViewId === inHand?.namedViewId && !isEdited}
                onClick={() => onPicked(tableKey, namedViewId)}
              >
                {name}
              </Menu.Item>,
            )}
          </Menu.Group>}
        {onChanged !== null &&
          all.length > 0 &&
          (canSaveNew || inHand !== null) &&
          <Menu.Separator />}
        {onChanged !== null &&
          inHand !== null &&
          isEdited &&
          isAnythingAsked &&
          <Menu.Item
            onClick={() =>
              onChanged(tableKey, {
                kind: 'update',
                namedViewId: inHand.namedViewId,
              })}
          >
            {namedViewMessages.update(inHand.name)}
          </Menu.Item>}
        {canSaveNew &&
          <MenuItemWithWhyOff
            disabled={views.allInSheet.length >= mostViews}
            whyOff={namedViewLimitWhyOff(mostViews)}
            onClick={() => openNaming(null)}
          >
            {namedViewMessages.saveAsNew()}
          </MenuItemWithWhyOff>}
        {onChanged !== null &&
          inHand !== null &&
          <>
            <Menu.Item onClick={() => openNaming(inHand)}>{namedViewMessages.rename()}</Menu.Item>
            <Menu.Item
              onClick={() =>
                onChanged(tableKey, {
                  kind: 'delete',
                  namedViewId: inHand.namedViewId,
                })}
            >
              {namedViewMessages.delete()}
            </Menu.Item>
          </>}
      </ToolbarMenu>
      <Popover.Root
        open={isNamingOpen}
        onOpenChange={(isOpen, { event }) => {
          if (!isOpen) shutNaming(event);
        }}
      >
        <Popover.Popup
          anchor={buttonRef}
          side="bottom"
          align="start"
          className="w-72"
          aria-label={
            naming.renamed === null
              ? namedViewMessages.saveAsNew()
              : namedViewMessages.rename()
          }
          initialFocus={fieldRef}
          finalFocus={whatHasCaretAfter}
          onKeyDown={wrapTabFocusInBar}
        >
          <NamedViewNameForm
            key={naming.timesOpened}
            views={views}
            renamed={naming.renamed}
            field={fieldRef}
            onNamed={(name) => {
              if (!naming.isOpen) return;
              let namedViewId = naming.renamed?.namedViewId;
              (onChanged?.(
                tableKey,
                namedViewId === undefined
                  ? {
                      kind: 'save',
                      name,
                    }
                  : {
                      kind: 'rename',
                      namedViewId,
                      name,
                    },
              ),
                shutNaming(null));
            }}
            onShut={() => shutNaming(null)}
          />
        </Popover.Popup>
      </Popover.Root>
    </>
  );
}
