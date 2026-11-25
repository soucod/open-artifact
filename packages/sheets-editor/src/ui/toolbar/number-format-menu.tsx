import { Menu } from '../../kit/menu.tsx';
import * as React from 'react';
import { newDropdownFormatOpeningList, toolUnavailableText } from '../../i18n/chip-labels.ts';
import {
  dropdownPaneMessages,
  numberFormatChoiceLabel,
  numberFormatGroupLabel,
  numberFormatGroupHeardAs,
  chosenCellTypeHeardAs,
  cellTypeLabel,
} from '../../i18n/format-labels.ts';
import { oneRangeNeededText } from '../../i18n/notice-labels.ts';
import { sheetMessages } from '../../i18n/sheet-messages.ts';
import {
  NUMBER_FORMAT_MENU_SECTIONS,
  groupOfChoice,
  exampleOfChoice,
  NUMBER_FORMAT_GROUPS,
  isCurrencyCodeOffered,
  FIRST_CHOICE_OF_GROUP,
  choicesOfGroup,
} from '../../format/number-format-choices.ts';
import { focusCheckedItemRef } from '../menu-scroll.ts';
import { barSubmenu } from './text-menus.tsx';
import { MenuItemWithWhyOff } from '../menu-item-why-off.tsx';
import { DECIMAL_STEP_ICONS, whyNoDecimalStep } from './decimal-places.tsx';
import { CHECKBOX_SETTING_TOOLS } from '../search-menu/bar-commands.tsx';
import { languageNameOfLocale, localeMessages } from '../../messages/locale.ts';
import { shortTimeZoneLabel, timeZoneMessages } from '../locale-time-zone-pick.ts';
import type { IconName } from '../../kit/icon.tsx';
import type { CellFormatChoiceName, NumberFormatGroup } from '../../i18n/format-labels.ts';
import type { CellType, CurrencyCode, NumberFormatChoice, NumberFormatMenuEntry, NumberFormatOrControlChoice } from '../../format/number-format-choices.ts';
import type { FormatCommand } from '../../format/format-commands.ts';
import type { DecimalPlaceChange, DecimalPlaceChanges } from '../../format/decimal-places.ts';
import type { CheckboxesToSet, ExamplesOfNumberFormats } from '../../state/initial-state.ts';
import type {
  CellControlInPlaceOfFormat,
  CellControlInsertChoice,
  NumberFormatSearchProps,
  WorkbookInFormatMenu,
} from '../../format/number-format-search.tsx';
import type { ReactNode } from 'react';
import type { ContextTool } from './context-tools.ts';
/** The icon a format, a group of formats or a cell control shows in the menus. */
export interface IconOfChoice {
  icon: IconName;
}
/** A number format the menus name, `fraction` and `text` included. */
export type NumberFormatName = Exclude<CellFormatChoiceName, 'dropdown' | 'checkbox' | 'mixed' | CurrencyCode>;
/** What putting a cell control in the cells calls back. */
export interface CellControlInsertCalls {
  onToolUsed: () => void;
  onFormatChosen: (command: FormatCommand) => void;
  onPersonChosen: () => void;
}
/** Whether the selected cells take each cell control. */
export interface CellsTakingControls {
  formatsThatFit: NumberFormatOrControlChoice[];
  takesDropdown: boolean;
  isOneRangeNeeded: boolean;
  /** The selection is a dropdown already, which takes no person. */
  isDropdown?: boolean;
}
/** What the cell type tools of the menus read and call: decimal steps, setting checkboxes, and the dropdown's options. */
export interface CellTypeOptions {
  decimalPlaces: DecimalPlaceChanges;
  checkboxesToSet: CheckboxesToSet;
  areSeveralCheckboxes: boolean;
  isPaneOfDropdownOpen: boolean;
  canDropdownBeRemoved: boolean;
  onStepChosen: (step: DecimalPlaceChange) => void;
  onCheckboxesSet: (isChecking: boolean) => void;
  onPaneOfDropdownAsked: () => void;
}
export interface NumberFormatMenuItemsProps extends Pick<NumberFormatSearchProps, 'choiceOfSelection' | 'inPlaceOfFormat' | 'onInsertChosen' | 'onChosen'> {
  /** The cell type the selection holds, of which the menu ticks the row. */
  typeOfCells: CellType | null;
  inserts: CellControlInsertChoice[];
  formatsThatFit: NumberFormatOrControlChoice[];
  examples: ExamplesOfNumberFormats;
  options: CellTypeOptions;
  isPointerCoarse?: boolean;
}
export interface NumberFormatMenuItemsViewProps extends NumberFormatMenuItemsProps {
  /** Each row acts at once, with no submenu: the rows of a menu that is already a submenu. */
  isEachOnePress?: boolean;
  areCellsBlank?: boolean;
}
/** What a row of a number format reads of the menu. */
export type NumberFormatChoiceItemProps = Pick<NumberFormatMenuItemsProps, 'choiceOfSelection' | 'typeOfCells' | 'examples' | 'onChosen'>;
/** What the tools of a cell type read of the menu. */
export type CellTypeToolsProps = Pick<NumberFormatMenuItemsProps, 'inserts' | 'onInsertChosen' | 'onChosen' | 'options' | 'isPointerCoarse'>;
export interface SheetSettingsMenuItemsProps {
  workbookInFormatMenu: WorkbookInFormatMenu;
}
export function insertCellControl(
  what: CellControlInPlaceOfFormat,
  { onToolUsed, onFormatChosen, onPersonChosen }: CellControlInsertCalls,
): void {
  onToolUsed();
  if (what === 'dropdown') onFormatChosen(newDropdownFormatOpeningList());
  if (what === 'person') onPersonChosen();
  if (what === 'date')
    onFormatChosen({
      dateToPick: true,
    });
  if (what === 'checkbox')
    onFormatChosen({
      checkbox: true,
    });
}
export function numberFormatIconOf(choice: CellFormatChoiceName | 'person'): IconOfChoice {
  if (choice === 'dropdown' || choice === 'checkbox' || choice === 'person') return CELL_CONTROL_ICONS[choice];
  if (isCurrencyCodeOffered(choice)) return NUMBER_FORMAT_ICONS.currency;
  return NUMBER_FORMAT_ICONS[choice === 'mixed' ? 'general' : choice];
}
export function numberFormatChoiceItem(
  choice: NumberFormatChoice,
  { choiceOfSelection, typeOfCells, examples, onChosen }: NumberFormatChoiceItemProps = {} as NumberFormatChoiceItemProps,
  hasIcon: boolean,
) {
  return <Menu.Item key={choice} ref={choice === choiceOfSelection ? focusCheckedItemRef : undefined} {...(hasIcon && {
      icon: numberFormatIconOf(choice).icon,
    })} checkedRole="radio" checked={choiceOfSelection === choice || typeOfCells === choice} hint={exampleOfChoice(examples, choice)} onClick={() =>
        onChosen({
          numberFormatChoice: choice,
        })}>{numberFormatChoiceLabel(choice)}</Menu.Item>;
}
export function cellTypeTools(
  cellType: CellType,
  { inserts, onInsertChosen, onChosen, options, isPointerCoarse = false }: CellTypeToolsProps = {} as CellTypeToolsProps,
  hasIcons: boolean,
): ReactNode {
  let { decimalPlaces, checkboxesToSet, isPaneOfDropdownOpen } = options;
  let iconOf = (icon: IconName) =>
    hasIcons
      ? {
          icon,
        }
      : {};
  let decimalStep = (step: DecimalPlaceChange) =>
    <MenuItemWithWhyOff key={step} keepOpen {...iconOf(DECIMAL_STEP_ICONS[step])} disabled={decimalPlaces[step] === null} whyOff={whyNoDecimalStep(step, decimalPlaces)} isPointerCoarse={isPointerCoarse} onClick={() => options.onStepChosen(step)}>{step === 'more' ? sheetMessages.increaseDecimalPlaces() : sheetMessages.decreaseDecimalPlaces()}</MenuItemWithWhyOff>;
  switch (cellType) {
    case 'numbers':
    case 'percents':
    case 'currencies':
      return <>{decimalStep('more')}{decimalStep('fewer')}</>;
    case 'datesAndTimes': {
      let insert = inserts.find(({ what }) => what === 'date');
      return insert === undefined
        ? null
        : <MenuItemWithWhyOff {...iconOf(insert.icon)} disabled={!insert.fits} whyOff={insert.fits ? null : toolUnavailableText(insert.label)} isPointerCoarse={isPointerCoarse} onClick={() => onInsertChosen('date')}>{sheetMessages.pickADate()}</MenuItemWithWhyOff>;
    }
    case 'dropdown':
      return <><Menu.Item {...iconOf(EDIT_DROPDOWN_OPTIONS_ICON.icon)} checked={isPaneOfDropdownOpen} onClick={options.onPaneOfDropdownAsked}>{sheetMessages.editOptionsOfDropdown()}</Menu.Item>{options.canDropdownBeRemoved &&
            <Menu.Item {...iconOf(REMOVE_DROPDOWN_ICON.icon)} onClick={() =>
                onChosen({
                  removesDropdown: true,
                })}>{sheetMessages.removeDropdown()}</Menu.Item>}</>;
    case 'checkbox':
      return !options.areSeveralCheckboxes
        ? null
        : <>{(['checkAll', 'uncheckAll'] as const).map((tool) => {
              let { isChecking, icon, inWords, whyNot } = CHECKBOX_SETTING_TOOLS[tool];
              return <MenuItemWithWhyOff key={tool} {...iconOf(icon)} disabled={whyNot(checkboxesToSet) !== null} whyOff={whyNot(checkboxesToSet)} isPointerCoarse={isPointerCoarse} onClick={() => options.onCheckboxesSet(isChecking)}>{inWords()}</MenuItemWithWhyOff>;
            })}</>;
    case 'general':
    case 'text':
    case 'person':
      return null;
  }
}
export function NumberFormatMenuItemsView({ isEachOnePress = false, areCellsBlank = false, ...props }: NumberFormatMenuItemsViewProps) {
  let { choiceOfSelection, typeOfCells, inPlaceOfFormat, onInsertChosen, formatsThatFit, onChosen, examples } = props;
  let sections = formatsThatFit.includes('general') ? NUMBER_FORMAT_MENU_SECTIONS : [];
  let groupOfSelection = groupOfChoice(choiceOfSelection) ?? 'customFormat';
  let groupItem = (group: NumberFormatGroup) => {
    let chosen = NUMBER_FORMAT_GROUPS[group].find((choice) => choice === choiceOfSelection);
    return <Menu.Item key={group} ref={group === groupOfSelection ? focusCheckedItemRef : undefined} icon={NUMBER_FORMAT_GROUP_ICONS[group].icon} checkedRole="radio" checked={typeOfCells === group} hint={exampleOfChoice(examples, chosen ?? FIRST_CHOICE_OF_GROUP[group])} onClick={() => {
          let isFirstChosen = typeOfCells !== group || chosen === FIRST_CHOICE_OF_GROUP[group];
          if (group === 'datesAndTimes' && areCellsBlank && isFirstChosen) onInsertChosen('date');
          else if (typeOfCells !== group || chosen === undefined)
            onChosen({
              numberFormatChoice: FIRST_CHOICE_OF_GROUP[group],
            });
        }}>{numberFormatGroupLabel(group)}</Menu.Item>;
  };
  let groupSubmenu = (group: NumberFormatGroup) => {
    let choices = NUMBER_FORMAT_GROUPS[group].filter((choice) => formatsThatFit.includes(choice));
    let chosen = choices.find((choice) => choice === choiceOfSelection);
    let isTicked = typeOfCells === group;
    let tools = isTicked || group === 'datesAndTimes' || (group === 'numbers' && isGeneralWithDecimalSteps(props)) ? cellTypeTools(group, props, true) : null;
    return <React.Fragment key={group}>{barSubmenu(
          numberFormatGroupLabel(group),
          chosen === undefined ? null : exampleOfChoice(examples, chosen),
          <><Menu.Group aria-label={numberFormatGroupLabel(group)}>{choices
                .filter((choice) => !isCurrencyCodeOffered(choice))
                .map((choice) => numberFormatChoiceItem(choice, props, true))}</Menu.Group>{tools !== null && <Menu.Separator />}{tools}{choices.some(isCurrencyCodeOffered) &&
              <><Menu.Separator /><Menu.Group><Menu.GroupLabel>{sheetMessages.otherCurrencies()}</Menu.GroupLabel>{choices
                      .filter(isCurrencyCodeOffered)
                      .map((choice) => numberFormatChoiceItem(choice, props, true))}</Menu.Group></>}</>,
          {
            icon: NUMBER_FORMAT_GROUP_ICONS[group].icon,
            isTicked,
            listWidth: NUMBER_FORMAT_SUBMENU_WIDTH,
            ...(isTicked && {
              heardAs:
                chosen !== undefined && numberFormatChoiceLabel(chosen) !== numberFormatGroupLabel(group)
                  ? numberFormatGroupHeardAs(group, chosen)
                  : chosenCellTypeHeardAs(numberFormatGroupLabel(group)),
            }),
            ...(group === groupOfSelection && {
              rowRef: focusCheckedItemRef,
            }),
          },
        )}</React.Fragment>;
  };
  let sectionEntry = (entry: NumberFormatMenuEntry) => {
    if (entry === 'general' || entry === 'text')
      return numberFormatChoiceItem(entry, isEachOnePress && choiceOfSelection === entry ? withoutChoosing(props) : props, true);
    if (entry === 'customFormat')
      return <Menu.Item key={entry} ref={entry === groupOfSelection ? focusCheckedItemRef : undefined} icon="Sliders" onClick={() =>
            onChosen({
              patternToType: true,
            })}>{sheetMessages.customFormat()}</Menu.Item>;
    return isEachOnePress ? groupItem(entry) : groupSubmenu(entry);
  };
  let insertEntry = ({ what, icon, label, fits, whyNotNow }: CellControlInsertChoice) => {
    let tools = !isEachOnePress && what !== 'date' && what === choiceOfSelection ? cellTypeTools(what, props, true) : null;
    return tools !== null
      ? <React.Fragment key={what}>{barSubmenu(label, null, tools, {
            icon,
            isTicked: true,
            heardAs: chosenCellTypeHeardAs(label),
            ...(what === groupOfSelection && {
              rowRef: focusCheckedItemRef,
            }),
          })}</React.Fragment>
      : <MenuItemWithWhyOff key={what} ref={what === groupOfSelection ? focusCheckedItemRef : undefined} icon={icon} checkedRole="radio" checked={choiceOfSelection === what} disabled={!fits || whyNotNow !== undefined} whyOff={fits ? (whyNotNow ?? null) : toolUnavailableText(label)} isPointerCoarse={props.isPointerCoarse ?? false} onClick={() => {
            if (!(isEachOnePress && what === 'checkbox' && what === choiceOfSelection)) onInsertChosen(what);
          }}>{label}</MenuItemWithWhyOff>;
  };
  return <Menu.Group aria-label={sheetMessages.cellType()}>{inPlaceOfFormat.map(insertEntry)}{sections.map(
        (section, index) =>
          <React.Fragment key={section[0]}>{(index > 0 || inPlaceOfFormat.length > 0) && <Menu.Separator />}{section.map(sectionEntry)}</React.Fragment>,
      )}</Menu.Group>;
}
export function cellTypeMenuItems(props: NumberFormatMenuItemsProps) {
  let cellType = isGeneralWithDecimalSteps(props) ? 'numbers' : props.typeOfCells;
  let options = {
    ...props.options,
    canDropdownBeRemoved: false,
  };
  let tools =
    cellType === null
      ? null
      : cellTypeTools(
          cellType,
          {
            ...props,
            options,
          },
          false,
        );
  if (cellType === null || tools === null) return null;
  let choices = choicesOfGroup(cellType).filter(
    (choice) => props.formatsThatFit.includes(choice) && (!isCurrencyCodeOffered(choice) || choice === props.choiceOfSelection),
  );
  return <><Menu.Group><Menu.GroupLabel>{cellTypeLabel(cellType)}</Menu.GroupLabel>{choices.map((choice) => numberFormatChoiceItem(choice, props, false))}{choices.length === 0 && tools}</Menu.Group>{choices.length > 0 && <Menu.Separator />}{choices.length > 0 && tools}<Menu.Separator /></>;
}
export const CELL_CONTROL_ICONS: Record<CellControlInPlaceOfFormat, IconOfChoice> = {
  dropdown: {
    icon: 'Dropdown',
  },
  person: {
    icon: 'User',
  },
  date: {
    icon: 'Calendar',
  },
  checkbox: {
    icon: 'CheckSquare',
  },
};
export const CONTEXT_TOOL_OF_CELL_CONTROL: Partial<Record<CellControlInPlaceOfFormat, ContextTool>> = {
  dropdown: 'asDropdown',
  checkbox: 'asCheckbox',
};
export const cellControlInsertChoices = ({
  formatsThatFit,
  takesDropdown,
  isOneRangeNeeded,
  isDropdown = false,
}: CellsTakingControls): CellControlInsertChoice[] => [
  {
    what: 'dropdown',
    ...CELL_CONTROL_ICONS.dropdown,
    label: dropdownPaneMessages.dropdown(),
    fits: takesDropdown,
    ...(isOneRangeNeeded && {
      whyNotNow: oneRangeNeededText('dropdown'),
    }),
  },
  {
    what: 'person',
    ...CELL_CONTROL_ICONS.person,
    label: sheetMessages.personCells(),
    fits: true,
    ...(isDropdown && {
      whyNotNow: sheetMessages.noPersonInDropdown(),
    }),
  },
  {
    what: 'date',
    ...CELL_CONTROL_ICONS.date,
    label: sheetMessages.dateCells(),
    fits: formatsThatFit.includes('date'),
  },
  {
    what: 'checkbox',
    ...CELL_CONTROL_ICONS.checkbox,
    label: sheetMessages.checkboxCells(),
    fits: formatsThatFit.includes('checkbox'),
  },
];
export const CELL_CONTROLS_IN_MENU_ORDER: CellControlInPlaceOfFormat[] = ['checkbox', 'dropdown', 'person'];
export const cellControlsInMenuOrder = (choices: CellControlInsertChoice[]): CellControlInsertChoice[] =>
  CELL_CONTROLS_IN_MENU_ORDER.flatMap((control) => choices.filter((choice) => choice.what === control));
export const NUMBER_FORMAT_ICONS: Record<NumberFormatName, IconOfChoice> = {
  general: {
    icon: 'Numbers',
  },
  number: {
    icon: 'Numbers',
  },
  roundedNumber: {
    icon: 'Numbers',
  },
  numberInParentheses: {
    icon: 'Numbers',
  },
  currency: {
    icon: 'DollarSign',
  },
  roundedCurrency: {
    icon: 'DollarSign',
  },
  percent: {
    icon: 'PercentSign',
  },
  roundedPercent: {
    icon: 'PercentSign',
  },
  scientific: {
    icon: 'Exponent',
  },
  fraction: {
    icon: 'Divide',
  },
  date: {
    icon: 'Calendar',
  },
  mediumDate: {
    icon: 'Calendar',
  },
  longDate: {
    icon: 'Calendar',
  },
  monthAndDay: {
    icon: 'Calendar',
  },
  monthAndYear: {
    icon: 'Calendar',
  },
  time: {
    icon: 'Clock',
  },
  dateAndTime: {
    icon: 'CalendarClock',
  },
  duration: {
    icon: 'Timer',
  },
  text: {
    icon: 'PlainText',
  },
};
export const NUMBER_FORMAT_GROUP_ICONS: Record<NumberFormatGroup, IconOfChoice> = {
  numbers: {
    icon: 'Numbers',
  },
  percents: {
    icon: 'PercentSign',
  },
  currencies: {
    icon: 'DollarSign',
  },
  datesAndTimes: {
    icon: 'Calendar',
  },
};
export const NUMBER_FORMAT_SUBMENU_WIDTH = {
  className: 'max-w-[min(24rem,var(--available-width))]',
};
export const EDIT_DROPDOWN_OPTIONS_ICON: IconOfChoice = {
  icon: 'Edit',
};
export const REMOVE_DROPDOWN_ICON: IconOfChoice = {
  icon: 'Minus',
};
export const isGeneralWithDecimalSteps = ({
  typeOfCells,
  options: { decimalPlaces },
}: Pick<NumberFormatMenuItemsProps, 'typeOfCells' | 'options'>): boolean =>
  typeOfCells === 'general' && (decimalPlaces.more !== null || decimalPlaces.fewer !== null);
export const withoutChoosing = <Props extends Pick<NumberFormatMenuItemsProps, 'onChosen'>>(props: Props): Props => ({
  ...props,
  onChosen: () => {},
});
export const NumberFormatMenuItems = React.memo(NumberFormatMenuItemsView);
export const SheetSettingsMenuItems = ({ workbookInFormatMenu: { locale, onLocaleAsked, timeZone, onTimeZoneAsked } }: SheetSettingsMenuItemsProps) =>
  <Menu.Group><Menu.GroupLabel>{sheetMessages.sheetSettings()}</Menu.GroupLabel><Menu.Item icon="Globe" hint={languageNameOfLocale(locale)} onClick={onLocaleAsked}>{localeMessages.locale()}</Menu.Item><Menu.Item icon="Clock" hint={shortTimeZoneLabel(timeZone)} onClick={onTimeZoneAsked}>{timeZoneMessages.timeZone()}</Menu.Item></Menu.Group>;
