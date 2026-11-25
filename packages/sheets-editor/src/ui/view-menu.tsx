import { SegmentedControl } from '../kit/segmented-control.tsx';
import { Menu, menuItemVariants } from '../kit/menu.tsx';
import { cn } from '../kit/cn.ts';
import { Tooltip } from '../kit/tooltip.tsx';
import type { IconName } from '../kit/icon.tsx';
import type { ThemeMode } from '../kit/theme.tsx';
import type { CellDensity } from '../grid/cell-metrics-values.ts';
import type { ZoomStore } from '../grid/zoom.ts';
import type { UndoAndRedoAvailability, WhyStepUnavailable } from '../history/steps-together.ts';
import type { UndoOrRedoChosen } from '../state/event-reducer.ts';
import type { CaretTarget } from '../tables/own-filter-bar-view.tsx';
import type { MenuCommand } from './search-menu/matching.ts';
import type { MenuOpenChange } from './sheet-tabs/add-sheet.tsx';
import type { PressToSwallow } from './press-swallow.ts';
import * as React from 'react';
import { sheetMessages } from '../i18n/sheet-messages.ts';
import { asThemeMode, THEME_CHOSEN_ATTRIBUTE, chooseSheetsTheme } from '../shell/root-theme.ts';
import { useDocumentElementAttribute } from '../dom/use-document-element-attribute.ts';
import { zoomPercent, ZOOM_STEPS, MAX_ZOOM, nextZoomStep, MIN_ZOOM, useZoom } from '../grid/zoom.ts';
import { useCoarsePointerMedia } from '../app/media-queries.ts';
import { ToolbarMenu } from './format-toolbar.tsx';
import { MenuTriggerButton, ZoomPercent } from './menu-trigger.tsx';
import { DensitySubmenu } from './density-menu.tsx';
import { MenuItemWithWhyOff } from './menu-item-why-off.tsx';
import { findBarMessages } from '../i18n/find-labels.ts';
import { REPLACE_SHORTCUT } from './find-bar.tsx';
import { shortcutListMessages } from '../messages/shortcut-labels.ts';
import { LiveAnnouncer } from './live-announcer.tsx';
import { toolSearchWords, toolLabelWithValue } from '../tools/search-words.ts';
import { swallowRestOfPress } from './press-swallow.ts';
export type UndoOrRedoDirection = UndoOrRedoChosen['direction'];
/** A choice in a segmented row of a menu: an icon with its name in a tooltip, or its name alone. */
export interface MenuRowSegment<Value extends string> {
  value: Value;
  icon?: IconName;
  name: string;
}
export interface SegmentedMenuRowProps<Value extends string> {
  label: string;
  segments: MenuRowSegment<Value>[];
  value: Value;
  onChange: (value: Value) => void;
  wasPointerPressedLast: () => boolean;
}
export interface ThemeMenuRowProps {
  wasPointerPressedLast: () => boolean;
}
export interface ViewMenuProps {
  gridZoom: ZoomStore;
  side: 'top' | 'bottom';
  onOpenChange: MenuOpenChange;
  whatHasCaretAfter: () => CaretTarget;
  wasPointerPressedLast: () => boolean;
  onFitChartAsked: (() => void) | null;
  areFormulasShown: boolean;
  isEntryOpen: boolean;
  onFormulasShownToggled: () => void;
  density: CellDensity;
  onDensityChosen: (density: CellDensity) => void;
  undoAndRedo: UndoAndRedoAvailability;
  onUndoOrRedoChosen: (direction: UndoOrRedoDirection) => void;
  onFindAsked: () => void;
  onFindAndReplaceAsked: (() => void) | null;
  onListOfKeysAsked: () => void;
}
/** What the view commands of the search menu read of the page. */
export interface ViewOfCommands {
  areFormulasShown: boolean;
  isEntryOpen: boolean;
  density: CellDensity;
  undoAndRedo: UndoAndRedoAvailability;
  /** The theme chosen, or `null` when the sheet follows the system. */
  theme: ThemeMode | null;
}
export interface ViewCommandActions
  extends Pick<
    ViewMenuProps,
    | 'gridZoom'
    | 'onFitChartAsked'
    | 'onFormulasShownToggled'
    | 'onDensityChosen'
    | 'onUndoOrRedoChosen'
    | 'onFindAsked'
    | 'onFindAndReplaceAsked'
    | 'onListOfKeysAsked'
  > {
  onThemeChosen(theme: ThemeMode | null): void;
}
export interface ThemeChoice {
  theme: ThemeMode | null;
  inId: string;
  icon: IconName;
  inWords: () => string;
  /** The key of the words the choice is found by. */
  foundBy: string;
}
export interface DensityChoice {
  density: CellDensity;
  inWords: () => string;
}
export interface UndoRedoChoice {
  direction: UndoOrRedoDirection;
  icon: IconName;
  inWords: () => string;
  keys: string;
}
export function moveFocusAcrossSegments(event: React.KeyboardEvent<HTMLElement>) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  const { previousElementSibling: previousSegment, nextElementSibling: nextSegment } = event.currentTarget;
  const isLeftToRight = getComputedStyle(event.currentTarget).direction === 'ltr';
  const segmentToFocus = (event.key === 'ArrowRight') === isLeftToRight ? nextSegment : previousSegment;
  if (segmentToFocus instanceof HTMLElement) segmentToFocus.focus();
  event.preventDefault();
}
export function SegmentedMenuRow<Value extends string>({
  label,
  segments,
  value,
  onChange,
  wasPointerPressedLast,
}: SegmentedMenuRowProps<Value>) {
  const labelId = React.useId();
  const rowRef = React.useRef<HTMLDivElement>(null);
  const [isFocusShown, setFocusShown] = React.useState(false);
  return <div ref={rowRef} className={cn(menuItemVariants(), 'justify-between')}><span id={labelId}>{label}</span><Menu.Group aria-labelledby={labelId} className="relative"><div inert><SegmentedControl className="grid auto-cols-fr grid-flow-col" aria-label={label} segments={segments.map(
                (segment) =>
                  segment.icon === undefined
                    ? {
                        value: segment.value,
                        label: segment.name,
                      }
                    : {
                        value: segment.value,
                        icon: segment.icon,
                      },
              )} value={value} onChange={onChange} /></div><div className="absolute inset-px grid auto-cols-fr grid-flow-col">{segments.map(
              (segment) =>
                (<Tooltip key={segment.value} content={segment.icon === undefined ? undefined : segment.name} anchor={rowRef} side="left"><Menu.Item keepOpen role="menuitemradio" aria-checked={segment.value === value} aria-label={segment.name} label={segment.name} className={cn(
                        'min-w-0 not-aria-checked:hover:bg-fill-ghost-hover data-[highlighted]:bg-transparent active:bg-transparent active:bg-none',
                        isFocusShown && 'focus:shadow-focus',
                      )} onClick={() => onChange(segment.value)} onFocus={() => setFocusShown(!wasPointerPressedLast())} onPointerDown={() => setFocusShown(false)} onPointerUp={({ pointerType, currentTarget }) => {
                        if (pointerType !== 'mouse')
                          currentTarget.focus({
                            preventScroll: true,
                            focusVisible: false,
                          });
                      }} onKeyDown={moveFocusAcrossSegments} /></Tooltip>),
            )}</div></Menu.Group></div>;
}
export function ThemeMenuRow({ wasPointerPressedLast }: ThemeMenuRowProps) {
  return <SegmentedMenuRow label={sheetMessages.sheetTheme()} segments={[
      {
        value: 'automatic',
        icon: 'Computer',
        name: sheetMessages.themeAutomatic(),
      },
      {
        value: 'light',
        icon: 'Sun',
        name: sheetMessages.themeLight(),
      },
      {
        value: 'dark',
        icon: 'Moon',
        name: sheetMessages.themeDark(),
      },
    ]} value={asThemeMode(useDocumentElementAttribute(THEME_CHOSEN_ATTRIBUTE)) ?? 'automatic'} onChange={(theme) => chooseSheetsTheme(document.documentElement, theme === 'automatic' ? null : theme)} wasPointerPressedLast={wasPointerPressedLast} />;
}
/** The zoom to say once it has stopped changing, until it has been shown for a while. */
export function useZoomSaid(gridZoom: ZoomStore) {
  const [zoomSaid, setZoomSaid] = React.useState<number | null>(null);
  React.useEffect(() => {
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = gridZoom.subscribe(() => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => setZoomSaid(zoomPercent(gridZoom.now())), ZOOM_SAID_SETTLE_MS);
    });
    return () => {
      unsubscribe();
      clearTimeout(settleTimer);
    };
  }, [gridZoom]);
  React.useEffect(() => {
    if (zoomSaid === null) return;
    const hideTimer = setTimeout(() => setZoomSaid(null), ZOOM_SAID_SHOWN_MS);
    return () => clearTimeout(hideTimer);
  }, [zoomSaid]);
  return zoomSaid;
}
export function ViewMenu({
  gridZoom,
  side,
  onOpenChange,
  whatHasCaretAfter,
  wasPointerPressedLast,
  onFitChartAsked,
  areFormulasShown,
  isEntryOpen,
  onFormulasShownToggled,
  density,
  onDensityChosen,
  undoAndRedo,
  onUndoOrRedoChosen,
  onFindAsked,
  onFindAndReplaceAsked,
  onListOfKeysAsked,
}: ViewMenuProps) {
  const zoom = useZoom(gridZoom);
  const [isOpen, setIsOpen] = React.useState(false);
  const buttonRef = React.useRef<HTMLElement>(null);
  const findKind = findItemKind(useCoarsePointerMedia(), onFindAndReplaceAsked !== null);
  const zoomSaid = useZoomSaid(gridZoom);
  const isStepZoom = ZOOM_STEPS.some((step) => zoomPercent(step) === zoomPercent(zoom));
  const setOpen = (isNowOpen: boolean, event: Event | null) => {
    setIsOpen(isNowOpen);
    onOpenChange(isNowOpen, event);
  };
  return <><ToolbarMenu isOpen={isOpen} button={<MenuTriggerButton ref={buttonRef} variant="ghost" aria-label={sheetMessages.zoomButton(zoomPercent(zoom))} chevron="toolbar" onDoubleClick={({ nativeEvent }) => {
            gridZoom.set(1);
            setOpen(false, nativeEvent);
          }}><ZoomPercent zoom={zoom} /></MenuTriggerButton>} tooltip={sheetMessages.zoom()} onOpenChange={(isNowOpen: boolean, event: Event | null) => {
          if (isNowOpen && event instanceof UIEvent && event.detail === 2) return;
          setOpen(isNowOpen, event);
        }} whatHasCaretAfter={whatHasCaretAfter} toolbar={buttonRef} side={side}><Menu.Item keepOpen disabled={zoom >= MAX_ZOOM} onClick={() => gridZoom.set(nextZoomStep(zoom, 1))}>{sheetMessages.zoomIn()}</Menu.Item><Menu.Item keepOpen disabled={zoom <= MIN_ZOOM} onClick={() => gridZoom.set(nextZoomStep(zoom, -1))}>{sheetMessages.zoomOut()}</Menu.Item><Menu.Item onClick={menuItemPicked(() => gridZoom.set(1))}>{sheetMessages.zoomReset()}</Menu.Item>{onFitChartAsked !== null &&
            <Menu.Item onClick={menuItemPicked(onFitChartAsked)}>{sheetMessages.zoomToChart()}</Menu.Item>}<Menu.Separator /><Menu.Group aria-label={sheetMessages.zoom()}>{!isStepZoom &&
                <Menu.GroupLabel><span className="tabular-nums">{sheetMessages.zoomNow(zoomPercent(zoom))}</span></Menu.GroupLabel>}{ZOOM_STEPS.map(
                (step) =>
                  <Menu.Item key={step} checkedRole="radio" checked={zoomPercent(step) === zoomPercent(zoom)} onClick={menuItemPicked(() => gridZoom.set(step))}>{sheetMessages.zoomPercent(zoomPercent(step))}</Menu.Item>,
              )}</Menu.Group><Menu.Separator /><Menu.Item checkedRole="checkbox" checked={areFormulasShown} {...(!isEntryOpen && {
              shortcut: 'ctrl+`',
            })} onClick={menuItemPicked(onFormulasShownToggled)}>{sheetMessages.showFormulas()}</Menu.Item><ThemeMenuRow wasPointerPressedLast={wasPointerPressedLast} /><DensitySubmenu density={density} onDensityChosen={onDensityChosen} picked={menuItemPicked} /><Menu.Separator />{undoAndRedo !== null &&
            <><MenuItemWithWhyOff disabled={undoAndRedo.undo !== null} whyOff={undoAndRedo.undo === null ? null : WHY_NO_UNDO_OR_REDO.undo[undoAndRedo.undo]()} shortcut="cmd+z" onClick={menuItemPicked(() => onUndoOrRedoChosen('undo'))}>{sheetMessages.undoInZoomMenu()}</MenuItemWithWhyOff><MenuItemWithWhyOff disabled={undoAndRedo.redo !== null} whyOff={undoAndRedo.redo === null ? null : WHY_NO_UNDO_OR_REDO.redo[undoAndRedo.redo]()} shortcut="shift+cmd+z" onClick={menuItemPicked(() => onUndoOrRedoChosen('redo'))}>{sheetMessages.redoInZoomMenu()}</MenuItemWithWhyOff><Menu.Separator /></>}{findKind === 'find' &&
            <Menu.Item onClick={menuItemPicked(onFindAsked)}>{findBarMessages.find()}</Menu.Item>}{findKind === 'findAndReplace' &&
            onFindAndReplaceAsked !== null &&
            <Menu.Item shortcut={REPLACE_SHORTCUT} onClick={menuItemPicked(onFindAndReplaceAsked)}>{findBarMessages.findAndReplace()}</Menu.Item>}<Menu.Item shortcut="cmd+/" onClick={menuItemPicked(onListOfKeysAsked)}>{shortcutListMessages.title()}</Menu.Item></ToolbarMenu><LiveAnnouncer words={zoomSaid !== null && sheetMessages.zoomSaid(zoomSaid)} /></>;
}
export function viewCommands(view: ViewOfCommands, actions: ViewCommandActions): MenuCommand[] {
  const zoom = actions.gridZoom.now();
  const { onFitChartAsked, onFindAndReplaceAsked } = actions;
  const zoomCommand = (direction: 'zoomIn' | 'zoomOut', label: string, zoomTo: number): MenuCommand => ({
    id: `view.${direction}`,
    label,
    otherWords: toolSearchWords(direction),
    icon: direction === 'zoomIn' ? 'ZoomIn' : 'ZoomOut',
    actsOn: 'view',
    whyNot: null,
    run: () => actions.gridZoom.set(zoomTo),
  });
  return [
    ...(zoom < MAX_ZOOM ? [zoomCommand('zoomIn', sheetMessages.zoomIn(), nextZoomStep(zoom, 1))] : []),
    ...(zoom > MIN_ZOOM ? [zoomCommand('zoomOut', sheetMessages.zoomOut(), nextZoomStep(zoom, -1))] : []),
    ...(onFitChartAsked === null
      ? []
      : [
          {
            id: 'view.zoomToChart',
            label: sheetMessages.zoomToChart(),
            otherWords: toolSearchWords('zoomToChart'),
            icon: 'ZoomFit',
            actsOn: 'view',
            whyNot: null,
            run: onFitChartAsked,
          } satisfies MenuCommand,
        ]),
    ...ZOOM_STEPS.map(
      (step): MenuCommand => ({
        id: `view.zoom.${zoomPercent(step)}`,
        label: toolLabelWithValue(sheetMessages.zoom(), sheetMessages.zoomPercent(zoomPercent(step))),
        otherWords: step === 1 ? [...toolSearchWords('zoomToFullSize'), sheetMessages.zoomReset()] : toolSearchWords('zoom'),
        icon: null,
        isTicked: zoomPercent(step) === zoomPercent(zoom),
        actsOn: 'view',
        whyNot: null,
        run: () => actions.gridZoom.set(step),
      }),
    ),
    {
      id: 'view.showFormulas',
      label: sheetMessages.showFormulas(),
      otherWords: toolSearchWords('showFormulas'),
      icon: null,
      ...(!view.isEntryOpen && {
        keys: 'ctrl+`',
      }),
      isTicked: view.areFormulasShown,
      actsOn: 'view',
      whyNot: null,
      run: actions.onFormulasShownToggled,
    } satisfies MenuCommand,
    ...THEME_CHOICES.map(
      ({ theme, inId, icon, inWords, foundBy }): MenuCommand => ({
        id: `view.theme.${inId}`,
        label: toolLabelWithValue(sheetMessages.sheetTheme(), inWords()),
        otherWords: toolSearchWords(foundBy),
        icon,
        isTicked: view.theme === theme,
        actsOn: 'view',
        whyNot: null,
        run: () => actions.onThemeChosen(theme),
      }),
    ),
    ...DENSITY_CHOICES.map(
      ({ density, inWords }): MenuCommand => ({
        id: `view.layout.${density}`,
        label: toolLabelWithValue(sheetMessages.layout(), inWords()),
        otherWords: toolSearchWords('layout', `layout.${density}`),
        icon: 'Layout',
        isTicked: view.density === density,
        actsOn: 'view',
        whyNot: null,
        run: () => actions.onDensityChosen(density),
      }),
    ),
    ...(view.undoAndRedo === null ? [] : UNDO_REDO_CHOICES).map(
      ({ direction, icon, inWords, keys }): MenuCommand => {
        const whyNotKey = view.undoAndRedo?.[direction] ?? null;
        return {
          id: `view.${direction}`,
          label: inWords(),
          otherWords: toolSearchWords(direction),
          icon,
          keys,
          actsOn: 'file',
          whyNot: whyNotKey === null ? null : WHY_NO_UNDO_OR_REDO[direction][whyNotKey](),
          isWeighty: true,
          run: () => actions.onUndoOrRedoChosen(direction),
        };
      },
    ),
    {
      id: 'view.find',
      label: findBarMessages.find(),
      otherWords: toolSearchWords('find'),
      icon: 'Search',
      keys: 'cmd+f',
      actsOn: 'opens',
      home: 'topBar',
      whyNot: null,
      run: actions.onFindAsked,
    } satisfies MenuCommand,
    ...(onFindAndReplaceAsked === null
      ? []
      : [
          {
            id: 'view.findAndReplace',
            label: findBarMessages.findAndReplace(),
            otherWords: toolSearchWords('findAndReplace'),
            icon: 'Search',
            keys: REPLACE_SHORTCUT,
            actsOn: 'opens',
            home: 'pane',
            whyNot: null,
            run: onFindAndReplaceAsked,
          } satisfies MenuCommand,
        ]),
    {
      id: 'view.keyboardShortcuts',
      label: shortcutListMessages.title(),
      otherWords: toolSearchWords('keyboardShortcuts'),
      icon: 'Keyboard',
      keys: 'cmd+/',
      actsOn: 'opens',
      whyNot: null,
      run: actions.onListOfKeysAsked,
    } satisfies MenuCommand,
  ];
}
export const ZOOM_SAID_SHOWN_MS = 5000;
export const ZOOM_SAID_SETTLE_MS = 250;
/** Wraps what a menu row does into its click handler, which also swallows the rest of the press. */
export const menuItemPicked =
  (act: () => void) =>
  (event: PressToSwallow) => {
    swallowRestOfPress(event);
    act();
  };
export const WHY_NO_UNDO_OR_REDO: Record<UndoOrRedoDirection, Record<WhyStepUnavailable, () => string>> = {
  undo: {
    nothingLeft: sheetMessages.nothingToUndoYet,
    somethingUnderWay: sheetMessages.finishTypingFirst,
  },
  redo: {
    nothingLeft: sheetMessages.nothingToRedo,
    somethingUnderWay: sheetMessages.cancelTypingFirst,
  },
};
export const findItemKind = (isPointerCoarse: boolean, canReplace: boolean) =>
  isPointerCoarse ? 'find' : canReplace ? 'findAndReplace' : null;
export const THEME_CHOICES: ThemeChoice[] = [
  {
    theme: null,
    inId: 'automatic',
    icon: 'Computer',
    inWords: sheetMessages.themeAutomatic,
    foundBy: 'themeAutomatic',
  },
  {
    theme: 'light',
    inId: 'light',
    icon: 'Sun',
    inWords: sheetMessages.themeLight,
    foundBy: 'themeLight',
  },
  {
    theme: 'dark',
    inId: 'dark',
    icon: 'Moon',
    inWords: sheetMessages.themeDark,
    foundBy: 'themeDark',
  },
];
export const DENSITY_CHOICES: DensityChoice[] = [
  {
    density: 'comfortable',
    inWords: sheetMessages.comfortable,
  },
  {
    density: 'compact',
    inWords: sheetMessages.compact,
  },
];
export const UNDO_REDO_CHOICES: UndoRedoChoice[] = [
  {
    direction: 'undo',
    icon: 'ArrowCounterClockwise',
    inWords: sheetMessages.undoInZoomMenu,
    keys: 'cmd+z',
  },
  {
    direction: 'redo',
    icon: 'ArrowClockwise',
    inWords: sheetMessages.redoInZoomMenu,
    keys: 'shift+cmd+z',
  },
];
