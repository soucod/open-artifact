import { TextInput } from '../kit/text-input.tsx';
import { FieldRoot } from '../kit/field.tsx';
import { Switch } from '../kit/switch.tsx';
import { Menu } from '../kit/menu.tsx';
import { Popover } from '../kit/popover.tsx';
import { Tooltip, TooltipGroup } from '../kit/tooltip.tsx';
import { Button } from '../kit/button.tsx';
import { Icon } from '../kit/icon.tsx';
import * as React from 'react';
import {
  ELLIPSIS_INPUT_CLASSES,
  PaneTableButton,
  PaneRow,
  focusPaneStart,
  revealInSidePane,
  useSidePaneCaret,
  SidePane,
  PaneEmptyState,
  PaneSection,
  PaneButton,
  PANE_START_ATTRIBUTE,
  PaneSelect,
} from '../ui/side-pane/side-pane.tsx';
import { dropdownPaneMessages } from '../i18n/format-labels.ts';
import { whenBlurredToNothing } from '../grid/focus-left.ts';
import { MenuTriggerButton } from '../ui/menu-trigger.tsx';
import {
  dropdownPresetButtonLabel,
  dropdownPresetName,
  localizeDropdownPreset,
  reorderOptionLabel,
  removeOptionLabel,
  optionNumberLabel,
  optionColorButtonHeardAs,
  optionColorButtonLabel,
  optionColorName,
  optionAlreadyExistsText,
  dropdownCellsRefusalText,
  dropdownCellsButtonLabel,
  onlyCellsLabel,
} from '../i18n/chip-labels.ts';
import { DROPDOWN_OPTION_SETS } from './dropdown-presets.ts';
import { fillPaintStyle, textPaintStyle } from '../grid/cell-drawing.tsx';
import { setSwatchColors, cachedOptionChipColors } from '../format/cell-colors.ts';
import { REORDER_LIFT_PROPS, useReorderRows } from '../ui/reorder-rows.ts';
import { labelsOfPastedText } from './dropdown-pane-edits.ts';
import { isCopiedFromSheets } from '../clipboard/formats.ts';
import { DROPDOWN_COLOR_CHOICES } from './dropdown-colors.ts';
import { colorsEqual, colorKey } from '../model/colors.ts';
import { popupPropsUnderHeader } from '../shell/bottom-insets.ts';
import { COLOR_POPUP_PADDING, SheetColorPicker } from '../format/color-picker.tsx';
import { useCoarsePointer } from '../app/media-queries.ts';
import { preventMouseDownDefault } from '../ui/dom-events.ts';
import { describeWhyNot } from '../ui/why-not.tsx';
import { ContentsBox } from '../ui/contents-box.tsx';
import { LiveAnnouncer } from '../ui/live-announcer.tsx';
import { noticeText } from '../i18n/notice-labels.ts';
import type { DropdownEditorAct } from './dropdown-editor.ts';
import type { DropdownPresetKey } from '../i18n/chip-labels.ts';
import type { DropdownReach, OptionOfDropdownInPane } from '../state/initial-state.ts';
import type { ColorPickerChoices, DropdownEditorView } from '../view/page-view.ts';
/** Hands an act to the dropdown editor, and tells `onDone` whether it changed anything. */
export type ActInDropdownPane = (act: DropdownEditorAct, onDone?: (isDone: boolean) => void) => void;
/** The name field to put the caret in: the last one, the one of the option to come, or the first of the options new since. */
export type OptionFieldToFocus = 'lastField' | 'optionToCome' | { lastOptionNotAmong: ReadonlySet<string> };
/** Where the caret goes in the pane once it is drawn again. */
export type CaretTargetInPane = OptionFieldToFocus | 'cellsField' | { handleOf: string } | { colorButtonAt: number };
/** Where the caret went when it left a row of an option, and what was pressed. */
export interface OptionRowBlur {
  isToCome: boolean;
  isNamed: boolean;
  wasInNameField: boolean;
  goesTo: 'nothing' | 'ownRow' | 'elsewhere';
  isButtonPressed: boolean;
  isColorPickerOpen: boolean;
}
export interface DropdownCellsFieldProps {
  ownRange: string;
  cellsTyped: string | null;
  whyNotSaidBy: string | null;
  fieldRef: React.RefObject<HTMLInputElement | null>;
  onAct: ActInDropdownPane;
  onEntered: () => void;
}
export interface DropdownPresetMenuProps {
  /** The key of the preset the options started from, or `'custom'`. */
  chosen: DropdownPresetKey | 'custom';
  blankField: () => HTMLInputElement | null;
  onAct: ActInDropdownPane;
}
export interface OptionColorButtonProps {
  option: OptionOfDropdownInPane;
  number: number;
  isPickerOpen: boolean;
  isOnTouch: boolean;
  whatColorPickerShows: () => ColorPickerChoices;
  onAct: ActInDropdownPane;
  onOpenPickerChange: (rowKey: string | null) => void;
}
export interface DropdownOptionRowProps extends Omit<OptionColorButtonProps, 'number'> {
  index: number;
  whyNameIsRefused: string | null;
  isBeingTyped: boolean;
  isAlone: boolean;
  isLast: boolean;
  pressedLast: React.RefObject<EventTarget | null>;
  reorder: ReturnType<typeof useReorderRows>;
  keysThatMoveSaidBy: string;
  onRemoved: (index: number) => void;
  onNamesPasted: (labels: string[]) => void;
  onArrowed: (index: number, step: -1 | 1) => boolean;
  onEntered: (index: number) => void;
}
export interface DropdownPaneProps {
  isOpen: boolean;
  editor: DropdownEditorView | null;
  timesAsked: number;
  paneRef: React.RefObject<HTMLElement | null>;
  takesNoTyping: boolean;
  paneWidth: number;
  onPaneWidthChange: (width: number) => void;
  onKeyDownInPane: (event: React.KeyboardEvent) => void;
  whatHasCaretAfter: () => HTMLElement | false;
  wasPointerPressedLast: () => boolean;
  whatColorPickerShows: () => ColorPickerChoices;
  onAct: ActInDropdownPane;
  onShut: () => void;
}
export function optionFieldIndexToFocus(fieldToFocus: OptionFieldToFocus, options: readonly OptionOfDropdownInPane[]): number {
  if (fieldToFocus === 'lastField') return options.length - 1;
  if (fieldToFocus === 'optionToCome') return options.at(-1)?.optionId === null ? options.length - 1 : -1;
  return options.findLastIndex(({ optionId }) => optionId !== null && !fieldToFocus.lastOptionNotAmong.has(optionId));
}
export function optionFieldArrowMove({
  key,
  isWithAnotherKey,
}: {
  key: string;
  isWithAnotherKey: boolean;
}): 'goesToNameAbove' | 'goesToNameBelow' | null {
  if (isWithAnotherKey) return null;
  if (key === 'ArrowUp') return 'goesToNameAbove';
  if (key === 'ArrowDown') return 'goesToNameBelow';
  return null;
}
export function doesOptionRowBlurEnter({
  isToCome,
  isNamed,
  wasInNameField,
  goesTo,
  isButtonPressed,
  isColorPickerOpen,
}: OptionRowBlur): boolean {
  if (!isToCome) return wasInNameField;
  if (isColorPickerOpen || goesTo === 'ownRow') return false;
  return goesTo === 'elsewhere' || (isNamed && !isButtonPressed);
}
export function DropdownCellsField({
  ownRange,
  cellsTyped,
  whyNotSaidBy,
  fieldRef,
  onAct,
  onEntered,
}: DropdownCellsFieldProps) {
  return <TextInput ref={fieldRef} fullWidth className={ELLIPSIS_INPUT_CLASSES} aria-label={dropdownPaneMessages.cells()} aria-describedby={whyNotSaidBy ?? undefined} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} value={cellsTyped ?? ownRange} slotEnd={<PaneTableButton name={dropdownPaneMessages.useSelection()} onPressed={() =>
        onAct({
          kind: 'useSelection',
        })} />} onChange={(event) =>
      onAct({
        kind: 'typeCells',
        text: event.target.value,
      })} onBlur={({ relatedTarget, currentTarget }) => {
      if (relatedTarget !== null)
        onAct({
          kind: 'enterCells',
        });
      else
        whenBlurredToNothing(
          currentTarget,
          () =>
            onAct({
              kind: 'enterCells',
            }),
        );
    }} onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        onAct(
          {
            kind: 'enterCells',
          },
          (isEntered) => {
            if (isEntered) onEntered();
          },
        );
      }
      if (event.key === 'Escape' && cellsTyped !== null) {
        event.preventDefault();
        event.stopPropagation();
        onAct({
          kind: 'dropTypedCells',
        });
      }
    }} />;
}
export function DropdownPresetMenu({ chosen, blankField, onAct }: DropdownPresetMenuProps) {
  return <Menu.Root><MenuTriggerButton variant="ghost" size="xs" aria-label={dropdownPresetButtonLabel(chosen)} className="text-secondary" chevron="toolbar">{chosen === 'custom' ? dropdownPaneMessages.customOptions() : dropdownPresetName(chosen)}</MenuTriggerButton><Menu.Popup align="end" finalFocus={() => blankField() ?? true} onKeyDownCapture={(event) => {
          if (!event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
          event.preventDefault();
          event.stopPropagation();
        }}><Menu.Group aria-label={dropdownPaneMessages.startFrom()}>{DROPDOWN_OPTION_SETS.map(
              (presetSet) =>
                (<Menu.Item key={presetSet.key} checked={chosen === presetSet.key} checkedRole="radio" checkPosition="trailing" onClick={() =>
                      onAct({
                        kind: 'startFrom',
                        set: localizeDropdownPreset(presetSet),
                      })}><span className="flex min-w-32 items-center justify-between gap-4">{dropdownPresetName(presetSet.key)}<span aria-hidden className="flex gap-[3px]">{presetSet.options.map(
                            ({ key, color }) =>
                              <span key={key} className="sheet-swatch sheet-swatch-of-set" data-has-fill style={fillPaintStyle(setSwatchColors(color))} />,
                          )}</span></span></Menu.Item>),
            )}<Menu.Separator /><Menu.Item checked={chosen === 'custom'} checkedRole="radio" checkPosition="trailing" onClick={() =>
                onAct({
                  kind: 'startFrom',
                  set: 'custom',
                })}>{dropdownPaneMessages.customOptions()}</Menu.Item></Menu.Group></Menu.Popup></Menu.Root>;
}
export function swallowHeldEnterAfterRemove(view: Window | null) {
  let keyEventTypes: ('keydown' | 'keypress' | 'keyup')[] = ['keydown', 'keypress', 'keyup'];
  let swallowHeldEnter = (event: KeyboardEvent) => {
    if (event.type !== 'keypress' && !event.repeat)
      for (let eventType of keyEventTypes) view?.removeEventListener(eventType, swallowHeldEnter, true);
    else if (event.key === 'Enter') event.preventDefault();
  };
  for (let eventType of keyEventTypes) view?.addEventListener(eventType, swallowHeldEnter, true);
}
export function DropdownOptionRow({
  option,
  index,
  whyNameIsRefused,
  isBeingTyped,
  isAlone,
  isLast,
  pressedLast,
  isPickerOpen,
  isOnTouch,
  whatColorPickerShows,
  onAct,
  onOpenPickerChange,
  reorder,
  keysThatMoveSaidBy,
  onRemoved,
  onNamesPasted,
  onArrowed,
  onEntered,
}: DropdownOptionRowProps) {
  const { optionId } = option;
  let optionNumber = index + 1;
  let { className, ...rowProps } = reorder.ofRow(optionId, index);
  let nameRefusalId = React.useId();
  const isMovable = !isAlone && optionId !== null;
  let handleLabel = reorderOptionLabel(optionNumber, option.label);
  let reorderHandle = <span key={isMovable ? 'handle' : 'standIn'} className={isMovable ? 'flex' : 'invisible flex'}><Tooltip content={handleLabel} {...(reorder.areTooltipsOfHandlesShut
          ? {
              open: false,
            }
          : {})}><Button variant="ghost" {...(!isOnTouch && {
            size: 'xs',
          })} iconOnly icon={<Icon name="Reorder" size="xs" className="text-muted group-hover/option:text-primary group-has-focus-visible/option:text-primary group-data-reorder/option:text-primary touch:text-primary" />} aria-label={handleLabel} aria-describedby={keysThatMoveSaidBy} tooltip={false} {...(isMovable && {
            'data-handle-of': optionId,
            ...reorder.ofHandle(optionId, index),
          })} /></Tooltip></span>;
  return <li {...rowProps} data-size={isOnTouch ? 'lg' : undefined} className={`group/option ${className} ${optionId === null ? 'starting:opacity-0' : ''}`}>{optionId !== null &&
        <span {...REORDER_LIFT_PROPS} />}<div role="presentation" onBlur={(event) => {
          let row = event.currentTarget;
          if (!row.contains(event.target)) return;
          let [nextFocus, pressedLastElement] = [event.relatedTarget, pressedLast.current];
          if (
            !doesOptionRowBlurEnter({
              isToCome: optionId === null,
              isNamed: option.label.trim() !== '',
              wasInNameField: event.target instanceof HTMLInputElement,
              goesTo: nextFocus === null ? 'nothing' : row.contains(nextFocus) ? 'ownRow' : 'elsewhere',
              isButtonPressed: pressedLastElement instanceof Element && pressedLastElement.closest('button') !== null,
              isColorPickerOpen: isPickerOpen,
            })
          )
            return;
          let enterOption = () =>
            onAct({
              kind: 'enter',
              optionId,
              thenStartsOption: false,
            });
          if (event.relatedTarget !== null) enterOption();
          else whenBlurredToNothing(event.target, enterOption);
        }}><TooltipGroup closeDelay={0}><PaneRow trailing={<TooltipGroup closeDelay={0}><Button variant="ghost" iconOnly icon="Minus" aria-label={removeOptionLabel(optionNumber, option.label)} className="text-secondary" disabled={isAlone} onClick={() =>
                    reorder.gliding(
                      (onDone: (isDone: boolean) => void) =>
                        onAct(
                          {
                            kind: 'remove',
                            optionId,
                          },
                          onDone,
                        ),
                      (isRemoved: boolean) => {
                        if (isRemoved) onRemoved(index);
                      },
                    )} /></TooltipGroup>}><span className="flex shrink-0 items-center gap-0.5">{reorderHandle}<OptionColorButton option={option} number={optionNumber} isPickerOpen={isPickerOpen} isOnTouch={isOnTouch} whatColorPickerShows={whatColorPickerShows} onAct={onAct} onOpenPickerChange={onOpenPickerChange} /></span><FieldRoot invalid={whyNameIsRefused !== null} className="min-w-0 flex-1"><TextInput fullWidth aria-label={optionNumberLabel(optionNumber)} aria-describedby={whyNameIsRefused === null ? undefined : nameRefusalId} placeholder={dropdownPaneMessages.option()} autoComplete="off" autoCorrect="off" spellCheck={false} value={option.label} onChange={(event) =>
                      onAct({
                        kind: 'type',
                        optionId,
                        label: event.target.value,
                      })} onPaste={(event) => {
                      let [firstName, ...otherNames] = labelsOfPastedText(
                        event.clipboardData.getData('text'),
                        isCopiedFromSheets(event.clipboardData.getData('text/html')),
                      );
                      if (firstName === undefined || otherNames.length === 0) return;
                      event.preventDefault();
                      let { value: fieldText, selectionStart, selectionEnd } = event.currentTarget;
                      let pastedName =
                        fieldText.slice(0, selectionStart ?? fieldText.length) + firstName + fieldText.slice(selectionEnd ?? fieldText.length);
                      onNamesPasted([pastedName, ...otherNames]);
                    }} onKeyDown={(event) => {
                      if (event.nativeEvent.isComposing || event.keyCode === 229) {
                        event.stopPropagation();
                        return;
                      }
                      if (event.key === 'Escape' && isBeingTyped) {
                        event.preventDefault();
                        event.stopPropagation();
                        onAct({
                          kind: 'dropTyped',
                        });
                        return;
                      }
                      let arrowMove = optionFieldArrowMove({
                        key: event.key,
                        isWithAnotherKey: event.altKey || event.ctrlKey || event.metaKey || event.shiftKey,
                      });
                      if (arrowMove !== null) {
                        if (onArrowed(index, arrowMove === 'goesToNameAbove' ? -1 : 1)) event.preventDefault();
                        return;
                      }
                      if (!(event.key === 'Enter' && !event.metaKey && !event.ctrlKey)) return;
                      event.preventDefault();
                      if (event.repeat || option.label.trim() === '') return;
                      if (!isLast) return onEntered(index);
                      reorder.gliding(
                        (onDone: (isDone: boolean) => void) =>
                          onAct(
                            {
                              kind: 'enter',
                              optionId,
                              thenStartsOption: true,
                            },
                            onDone,
                          ),
                        (isEntered: boolean) => {
                          if (isEntered) onEntered(index);
                        },
                      );
                    }} /></FieldRoot></PaneRow></TooltipGroup>{whyNameIsRefused !== null &&
            <p id={nameRefusalId} className="ps-lg pe-md pb-1 text-footnote text-danger">{whyNameIsRefused}</p>}</div></li>;
}
export const optionRowKey = ({ optionId }: Pick<OptionOfDropdownInPane, 'optionId'>): string => optionId ?? 'toCome';
export const OptionColorButton = React.memo(function ({
  option,
  number,
  isPickerOpen,
  isOnTouch,
  whatColorPickerShows,
  onAct,
  onOpenPickerChange,
}: OptionColorButtonProps) {
  let { optionId, label, color } = option;
  let swatchPaints = cachedOptionChipColors(color);
  let triggerRef = React.useRef<HTMLButtonElement>(null);
  let [isCustomColorOpen, setIsCustomColorOpen] = React.useState(false);
  if (!isPickerOpen && isCustomColorOpen) setIsCustomColorOpen(false);
  let isOpenChangeSwallowedRef = React.useRef(false);
  return <><Menu.Root open={isPickerOpen && !isCustomColorOpen} onOpenChange={(isOpen) => {
          let isSwallowed = isOpenChangeSwallowedRef.current;
          isOpenChangeSwallowedRef.current = false;
          if (!isSwallowed) onOpenPickerChange(isOpen ? optionRowKey(option) : null);
        }}><Menu.Trigger render={<Button ref={triggerRef} variant="ghost" {...(!isOnTouch && {
                size: 'sm',
              })} iconOnly aria-label={optionColorButtonHeardAs(number, color)} data-colors-option tooltip={optionColorButtonLabel(number)} icon={<span className="sheet-swatch sheet-swatch-of-option" data-has-fill={color.kind !== 'none' || undefined} style={{
                  ...fillPaintStyle(swatchPaints.fill),
                  ...textPaintStyle(swatchPaints.text),
                }} />} />} /><Menu.Popup align="start" onKeyDownCapture={(event) => {
              if (!event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
              event.preventDefault();
              event.stopPropagation();
            }}><Menu.Group aria-label={optionColorButtonLabel(number)}>{DROPDOWN_COLOR_CHOICES.map((colorChoice) => {
                  let choicePaints = cachedOptionChipColors(colorChoice);
                  let colorName = optionColorName(colorChoice);
                  return (<Menu.Item key={colorKey(colorChoice)} label={colorName} checked={colorsEqual(color, colorChoice)} checkedRole="radio" checkPosition="trailing" onClick={() =>
                        onAct({
                          kind: 'setColor',
                          optionId,
                          color: colorChoice,
                        })}><span className="flex min-w-32 items-center gap-2"><span aria-hidden className="sheet-swatch sheet-swatch-of-option flex-none" data-has-fill={colorChoice.kind !== 'none' || undefined} style={{
                              ...fillPaintStyle(choicePaints.fill),
                              ...textPaintStyle(choicePaints.text),
                            }} />{colorName}</span></Menu.Item>);
                })}</Menu.Group><Menu.Separator /><Menu.Item onClick={() => {
                  isOpenChangeSwallowedRef.current = true;
                  setIsCustomColorOpen(true);
                }}><span className="flex items-center gap-2"><span className="grid w-4 place-items-center"><Icon name="Palette" size="sm" /></span>{dropdownPaneMessages.moreColors()}</span></Menu.Item></Menu.Popup></Menu.Root><Popover.Root open={isPickerOpen && isCustomColorOpen} onOpenChange={(isOpen) => {
          if (!isOpen) onOpenPickerChange(null);
        }}><Popover.Popup {...popupPropsUnderHeader()} anchor={triggerRef} side="bottom" align="start" padding={COLOR_POPUP_PADDING} aria-label={optionColorButtonLabel(number)} finalFocus={() => triggerRef.current ?? true}><SheetColorPicker property="fillColor" color={color} whatIsColored={{
              kind: 'option',
              label: label.trim() === '' ? dropdownPaneMessages.option() : label,
            }} whatItShows={whatColorPickerShows} onChosen={(chosenColor) =>
              onAct({
                kind: 'setColor',
                optionId,
                color: chosenColor,
              })} onDone={() => onOpenPickerChange(null)} /></Popover.Popup></Popover.Root></>;
});
export const DropdownPane = React.memo(function ({
  isOpen,
  editor,
  timesAsked,
  paneRef,
  takesNoTyping,
  paneWidth,
  onPaneWidthChange,
  onKeyDownInPane,
  whatHasCaretAfter,
  wasPointerPressedLast,
  whatColorPickerShows,
  onAct,
  onShut,
}: DropdownPaneProps) {
  let [openPickerOf, setOpenPickerOf] = React.useState<string | null>(null);
  let isOnTouch = useCoarsePointer();
  if (editor === null && openPickerOf !== null) setOpenPickerOf(null);
  let optionsListRef = React.useRef<HTMLUListElement>(null);
  let addButtonRef = React.useRef<HTMLButtonElement>(null);
  let caretTargetRef = React.useRef<CaretTargetInPane | null>(null);
  let cellsFieldRef = React.useRef<HTMLInputElement>(null);
  let pressCountRef = React.useRef(0);
  let pressedLastRef = React.useRef<EventTarget | null>(null);
  React.useEffect(() => {
    if (!isOpen) return;
    let paneDocument = paneRef.current?.ownerDocument;
    let notePress = ({ target }: Event) => {
      pressCountRef.current += 1;
      pressedLastRef.current = target;
    };
    paneDocument?.addEventListener('pointerdown', notePress, true);
    paneDocument?.addEventListener('click', notePress, true);
    return () => {
      paneDocument?.removeEventListener('pointerdown', notePress, true);
      paneDocument?.removeEventListener('click', notePress, true);
    };
  }, [isOpen, paneRef]);
  let actAndKeepCaret = React.useCallback(
    (act: DropdownEditorAct, onDone?: (isDone: boolean) => void) => {
      if (onDone === undefined) return onAct(act);
      let paneDocument = paneRef.current?.ownerDocument;
      let [pressCountBefore, focusedBefore] = [pressCountRef.current, paneDocument?.activeElement];
      return onAct(act, (isDone) => {
        onDone(isDone);
        if (pressCountRef.current !== pressCountBefore && paneDocument?.activeElement !== focusedBefore) caretTargetRef.current = null;
      });
    },
    [onAct, paneRef],
  );
  let putCaretAtStart = () => {
    let blankField = [...(optionsListRef.current?.getElementsByTagName('input') ?? [])].find(
      (nameField) => nameField.value === '',
    );
    if (blankField !== undefined)
      blankField.focus({
        preventScroll: true,
      });
    else
      focusPaneStart(paneRef.current, 'start', {
        isByPointer: wasPointerPressedLast(),
      });
  };
  React.useLayoutEffect(() => {
    let [caretTarget, optionsList] = [caretTargetRef.current, optionsListRef.current];
    caretTargetRef.current = null;
    if (caretTarget === null || optionsList === null) return;
    if (caretTarget === 'cellsField')
      return cellsFieldRef.current?.focus({
        preventScroll: true,
      });
    if (typeof caretTarget === 'object' && 'handleOf' in caretTarget) {
      let match = [...optionsList.querySelectorAll<HTMLElement>('[data-handle-of]')].find(
        (handle) => handle.dataset.handleOf === caretTarget.handleOf,
      );
      match?.focus({
        preventScroll: true,
      });
      if (match !== undefined) revealInSidePane(paneRef.current, match);
      return;
    }
    let nameFields = optionsList.getElementsByTagName('input');
    if (typeof caretTarget === 'object' && 'colorButtonAt' in caretTarget) {
      let colorButtons = optionsList.querySelectorAll<HTMLElement>('[data-colors-option]');
      let colorButtonNear = colorButtons[caretTarget.colorButtonAt] ?? colorButtons[caretTarget.colorButtonAt - 1];
      let onlyNameField = nameFields.length === 1 && !isOnTouch ? nameFields[0] : undefined;
      let focusTarget = onlyNameField ?? colorButtonNear ?? addButtonRef.current;
      focusTarget?.focus({
        preventScroll: true,
        focusVisible: !wasPointerPressedLast(),
      });
      if (onlyNameField !== undefined && onlyNameField === onlyNameField.ownerDocument.activeElement)
        onlyNameField.setSelectionRange(onlyNameField.value.length, onlyNameField.value.length);
      if (focusTarget !== null) revealInSidePane(paneRef.current, focusTarget, true);
      return;
    }
    let fieldIndex = optionFieldIndexToFocus(caretTarget, editor?.options ?? []);
    if (caretTarget === 'optionToCome' && fieldIndex === -1) return;
    if (caretTarget !== 'lastField' && fieldIndex === -1) {
      let { nameTypedFor: typedFor = null, nameTaken: takenName = null, refused: refusedNotice = null }: Partial<DropdownEditorView> = editor ?? {};
      if (typedFor !== null && takenName === null && refusedNotice === null) caretTargetRef.current = optionsList.ownerDocument.hasFocus() ? caretTarget : null;
      return;
    }
    let fieldAt = nameFields[fieldIndex];
    let fieldTarget = fieldAt ?? addButtonRef.current;
    fieldTarget?.focus({
      preventScroll: true,
    });
    if (fieldAt !== undefined && fieldAt === fieldAt.ownerDocument.activeElement)
      fieldAt.setSelectionRange(fieldAt.value.length, fieldAt.value.length);
    if (fieldTarget !== null) revealInSidePane(paneRef.current, fieldTarget);
  });
  let optionCount = editor?.options.length ?? 0;
  let lastOptionCountRef = React.useRef(optionCount);
  React.useLayoutEffect(() => {
    if (lastOptionCountRef.current === optionCount) return;
    let isShrunk = optionCount < lastOptionCountRef.current;
    lastOptionCountRef.current = optionCount;
    let activeElement = optionsListRef.current?.ownerDocument.activeElement ?? null;
    if (activeElement !== null && optionsListRef.current?.contains(activeElement) === true)
      revealInSidePane(paneRef.current, activeElement, isShrunk);
  });
  let options = editor?.options ?? [];
  let optionIds = options.flatMap(({ optionId }) => (optionId === null ? [] : [optionId]));
  let reorder = useReorderRows({
    listRef: optionsListRef,
    keys: optionIds,
    onMoved: (optionId: string, toIndex: number, onDone: (isMoved: boolean) => void) =>
      actAndKeepCaret(
        {
          kind: 'move',
          optionId,
          toIndex,
        },
        (isMoved: boolean) => {
          if (isMoved)
            caretTargetRef.current = {
              handleOf: optionId,
            };
          onDone(isMoved);
        },
      ),
  });
  let keysHintId = React.useId();
  let optionColorsLabelId = React.useId();
  let cellsRefusalId = React.useId();
  useSidePaneCaret({
    isOpen,
    timesAsked,
    paneRef,
    putCaretWhereToStart: putCaretAtStart,
    whatHasCaretAfter,
  });
  if (!isOpen) return null;
  let paneFrameProps = {
    ref: paneRef,
    title: dropdownPaneMessages.paneTitle(),
    takesNoTyping,
    width: paneWidth,
    onWidthChange: onPaneWidthChange,
    onClose: onShut,
    onKeyDown: onKeyDownInPane,
    wasPointerPressedLast,
  };
  if (editor === null)
    return <SidePane {...paneFrameProps}><PaneEmptyState title={dropdownPaneMessages.selectCellWithDropdown()} hint={dropdownPaneMessages.optionsWillAppearHere()} /></SidePane>;
  let {
    nameTypedFor,
    nameTaken,
    canAddOption,
    colorOfferedForEveryOption,
    ownRange,
    cellsRefused,
    cellsTyped,
    isMade,
    headerRow,
    otherRanges,
    reach,
    startedFrom,
    refused,
  } = editor;
  let isHeadingRefused = cellsRefused?.why === 'headingIsNoOption';
  let rangesText = [ownRange, ...otherRanges].join(', ');
  let keepCaretInBlankOption = (event: React.MouseEvent) => {
    let lastOption = options.at(-1);
    if (optionIds.length === 0 || lastOption?.optionId !== null || lastOption.label.trim() !== '') return;
    let activeElement = event.currentTarget.ownerDocument.activeElement;
    if (optionsListRef.current?.lastElementChild?.contains(activeElement) === true) preventMouseDownDefault(event);
  };
  return <SidePane {...paneFrameProps}><PaneSection title={dropdownPaneMessages.options()} actions={<><DropdownPresetMenu chosen={startedFrom} blankField={() =>
                [...(optionsListRef.current?.getElementsByTagName('input') ?? [])].find((nameField) => nameField.value === '') ?? null} onAct={actAndKeepCaret} /><PaneButton ref={addButtonRef} variant="ghost" iconOnly icon="Add" aria-label={dropdownPaneMessages.addOption()} className="text-secondary" {...(startedFrom === 'custom' && {
                [PANE_START_ATTRIBUTE]: true,
              })} disabled={!canAddOption} disabledReason={describeWhyNot(dropdownPaneMessages.addOption(), canAddOption ? null : dropdownPaneMessages.mostOptionsReached())} onClick={() =>
                actAndKeepCaret(
                  {
                    kind: 'startOption',
                  },
                  (isStarted: boolean) => {
                    if (isStarted) caretTargetRef.current = 'optionToCome';
                  },
                )} /></>}><ul ref={optionsListRef} className="flex flex-col">{options.map(
              (option, index) =>
                (<DropdownOptionRow key={optionRowKey(option)} option={option} index={index} whyNameIsRefused={nameTaken !== null && nameTaken.ofOptionId === option.optionId ? optionAlreadyExistsText(nameTaken.label) : null} isBeingTyped={nameTypedFor !== null && nameTypedFor.optionId === option.optionId} isAlone={optionIds.length <= 1} isLast={index === options.length - 1} pressedLast={pressedLastRef} isPickerOpen={openPickerOf === optionRowKey(option)} isOnTouch={isOnTouch} whatColorPickerShows={whatColorPickerShows} onAct={actAndKeepCaret} onOpenPickerChange={setOpenPickerOf} reorder={reorder} keysThatMoveSaidBy={keysHintId} onRemoved={(removedAt) => {
                      caretTargetRef.current = {
                        colorButtonAt: removedAt,
                      };
                      swallowHeldEnterAfterRemove(optionsListRef.current?.ownerDocument.defaultView ?? null);
                    }} onNamesPasted={(labels) => {
                      let optionIdsBefore = new Set(optionIds);
                      actAndKeepCaret(
                        {
                          kind: 'pasteNames',
                          optionId: option.optionId,
                          labels,
                        },
                        (isPasted: boolean) => {
                          if (isPasted)
                            caretTargetRef.current = {
                              lastOptionNotAmong: optionIdsBefore,
                            };
                        },
                      );
                    }} onArrowed={(fromIndex, step) => {
                      let nextField = optionsListRef.current?.getElementsByTagName('input').item(fromIndex + step);
                      if (nextField === null || nextField === undefined) return false;
                      nextField.focus({
                        preventScroll: true,
                      });
                      nextField.setSelectionRange(nextField.value.length, nextField.value.length);
                      revealInSidePane(paneRef.current, nextField);
                      return true;
                    }} onEntered={(enteredAt) => {
                      let nameFields = optionsListRef.current?.getElementsByTagName('input');
                      let enteredField = nameFields?.item(enteredAt) ?? null;
                      if (enteredField === null || enteredField !== enteredField.ownerDocument.activeElement) return;
                      let nextField = nameFields?.item(enteredAt + 1);
                      if (nextField === null || nextField === undefined) caretTargetRef.current = 'lastField';
                      else nextField.focus();
                    }} />),
            )}</ul><ContentsBox onMouseDown={keepCaretInBlankOption}><PaneRow label={dropdownPaneMessages.colors()}><Switch aria-labelledby={optionColorsLabelId} size="sm" checked={colorOfferedForEveryOption !== 'automatic'} disabled={colorOfferedForEveryOption === null} onCheckedChange={(isOn) =>
                  actAndKeepCaret({
                    kind: 'setColorOfEveryOption',
                    to: isOn ? 'automatic' : 'none',
                  })} /></PaneRow></ContentsBox><span id={optionColorsLabelId} hidden>{dropdownPaneMessages.optionColors()}</span><span id={keysHintId} hidden>{dropdownPaneMessages.keysThatMoveOption()}</span><LiveAnnouncer words={nameTaken !== null && optionAlreadyExistsText(nameTaken.label)} /><LiveAnnouncer words={refused !== null && noticeText(refused)} /><LiveAnnouncer words={cellsRefused !== null && dropdownCellsRefusalText(cellsRefused)} timesSaid={cellsRefused?.why === 'headingIsNoOption' ? cellsRefused.timesBefore : 0} />{refused !== null &&
            <PaneRow><p aria-hidden className="text-footnote text-danger">{noticeText(refused)}</p></PaneRow>}</PaneSection><PaneSection title={dropdownPaneMessages.appliesTo()}><PaneRow label={dropdownPaneMessages.cells()}>{otherRanges.length > 0
                ? (<PaneSelect name={dropdownCellsButtonLabel(reach === 'everyCell' ? dropdownPaneMessages.everywhere() : onlyCellsLabel(ownRange))} value={reach} items={[
                      {
                        value: 'everyCell',
                        label: dropdownPaneMessages.everywhere(),
                        hint: rangesText,
                      },
                      {
                        value: 'ownStretch',
                        label: onlyCellsLabel(ownRange),
                      },
                    ]} onChange={(reachChosen: DropdownReach) =>
                      actAndKeepCaret({
                        kind: 'chooseReach',
                        reach: reachChosen,
                      })} />)
                : !isMade
                  ? <span className="truncate text-body text-primary">{ownRange}</span>
                  : <DropdownCellsField ownRange={ownRange} cellsTyped={cellsTyped} whyNotSaidBy={cellsRefused === null || isHeadingRefused ? null : cellsRefusalId} fieldRef={cellsFieldRef} onAct={actAndKeepCaret} onEntered={() => void (caretTargetRef.current = 'cellsField')} />}</PaneRow>{headerRow !== null &&
            (<ContentsBox onMouseDown={keepCaretInBlankOption}><PaneRow label={dropdownPaneMessages.headerRow()}><Switch size="sm" checked={headerRow === 'on'} aria-describedby={isHeadingRefused ? cellsRefusalId : undefined} onCheckedChange={(isOn) =>
                    actAndKeepCaret({
                      kind: 'setHeaderRow',
                      isOn,
                    })} /></PaneRow></ContentsBox>)}{cellsRefused !== null &&
            <PaneRow label=""><p id={cellsRefusalId} className="text-footnote text-danger">{dropdownCellsRefusalText(cellsRefused)}</p></PaneRow>}</PaneSection></SidePane>;
});
