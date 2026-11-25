import { oneRangeActOfCommand } from '../../selection/several-ranges.ts';
import { oneRangeNeededText } from '../../i18n/notice-labels.ts';
import { toolSearchWords, toolLabelWithValue } from '../../tools/search-words.ts';
import { optionColorName, toolUnavailableText } from '../../i18n/chip-labels.ts';
import {
  cellColorName,
  numberFormatChoiceLabel,
  horizontalAlignmentLabel,
  verticalAlignmentLabel,
  borderEdgesLabel,
  borderMenuMessages,
} from '../../i18n/format-labels.ts';
import { colorsEqual, NO_COLOR, STANDARD_HUE_COLORS, GRAYSCALE_COLORS, LIGHT_GRAY_COLOR, WHITE_COLOR, BLACK_COLOR } from '../../model/colors.ts';
import { NUMBER_FORMAT_MENU_CHOICES } from '../../format/number-format-choices.ts';
import { sheetMessages, textStyleLabel } from '../../i18n/sheet-messages.ts';
import { numberFormatIconOf } from '../toolbar/number-format-menu.tsx';
import { customSortMessages, sortAndFilterMessages } from '../../tables/sort-filter-labels.ts';
import { SUM_BAR_AGGREGATES } from '../../state/transitions.ts';
import {
  figureNameLabel,
  insertColumnsLeftLabel,
  insertColumnsRightLabel,
  insertRowsAboveLabel,
  insertRowsBelowLabel,
  columnsLeftLabel,
  columnsRightLabel,
  rowsAboveLabel,
  rowsBelowLabel,
} from '../../i18n/grid-action-labels.ts';
import { commandSearchSynonyms } from '../../messages/command-search.ts';
import { FONT_MARKS } from '../../editor/text-looks.ts';
import { formatToggleShortcut, HORIZONTAL_ALIGN_ICONS, VERTICAL_ALIGN_ICONS, isWrapTextOn, wrapTextToggled } from '../toolbar/text-menus.tsx';
import { HORIZONTAL_ALIGNMENTS } from '../../format/toolbar-choices.ts';
import { VERTICAL_ALIGN_CHOICES, FONT_SIZE_CHOICES } from '../../format/toolbar-size-choices.ts';
import { BordersOfBlockIcon, borderChoiceIcon } from '../../format/borders-picker.tsx';
import { CONDITIONAL_FORMATTING_WORDS } from '../../messages/conditional-format.ts';
import { CHART_MESSAGES } from '../../charts/chart-words.ts';
import { localeMessages } from '../../messages/locale.ts';
import { timeZoneMessages } from '../locale-time-zone-pick.ts';
import { DECIMAL_PLACE_CHANGES } from '../../format/decimal-places.ts';
import { whyNoDecimalStep, DECIMAL_STEP_ICONS } from '../toolbar/decimal-places.tsx';
import { contextToolsThatFit } from '../toolbar/context-tools.ts';
import { ALL_FUNCTION_NAMES, functionNamesOffered, FUNCTION_NAMES_COMMON_FIRST } from '../../formulas/autocomplete.ts';
import { fillPaintStyle } from '../../grid/cell-drawing.tsx';
import { shownCellColor } from '../../format/cell-colors.ts';
import { BORDER_EDGE_CHOICES } from '../../format/borders.ts';
import type { ReactNode } from 'react';
import type { Color, Shade } from '@open-artifact/sheets-core';
import type { IconName } from '../../kit/icon.tsx';
import type { MenuCommand } from './matching.ts';
import type { FormatOfSelection } from '../../state/selection-seen.ts';
import type { CheckboxesToSet, FontMark } from '../../state/initial-state.ts';
import type { SortPaneAsked } from '../../state/event-reducer.ts';
import type { FiguresOfNumbers } from '../../state/figures-of-selection.ts';
import type { FormatCommand } from '../../format/format-commands.ts';
import type { BorderChoice, BorderLine } from '../../format/borders.ts';
import type { MergeAct } from '../../format/merge-cells.ts';
import type { InsertLinesCommand } from '../../edits/insert-lines.ts';
import type { CellControlInPlaceOfFormat, CellControlInsertChoice } from '../../format/number-format-search.tsx';
import type { ColorProperty } from '../../i18n/format-labels.ts';
import type { ContextTool, ContextToolsShape } from '../toolbar/context-tools.ts';
/** A picker of the toolbar that a command of the search menu opens. */
export type BarPicker = 'textColor' | 'fillColor' | 'borders' | 'conditionalFormatting' | 'chart' | 'sort';
/** What the toolbar shows, which the search menu offers as commands. */
export interface SearchMenuBarState {
  whyNoToolForCells: string | null;
  formatOfSelection: FormatOfSelection;
  sectionShows: ContextToolsShape;
  isSortAndFilterOnBar: boolean;
  arePeopleSelected: boolean;
  selectedRowCount: number;
  selectedColumnCount: number;
  canMergeSelection: boolean;
  canUnmergeSelection: boolean;
  areGridlinesHidden: boolean;
  borderPen: BorderLine;
  isOneRangeNeeded: boolean;
  whyNoChart: string | null;
  canWriteFigures: boolean;
  isPaneOfDropdownOpen: boolean;
  inserts: readonly CellControlInsertChoice[];
}
/** What the commands of the toolbar do when they are taken in the search menu. */
export interface SearchMenuBarActions {
  onFormatChosen: (format: FormatCommand) => void;
  onBordersChosen: (choice: BorderChoice) => void;
  onMergeChangeChosen: (act: MergeAct) => void;
  onCheckboxesSet: (isChecking: boolean) => void;
  onSheetChangeChosen: (change: InsertLinesCommand) => void;
  onFigureChosen: (figure: keyof FiguresOfNumbers) => void;
  onSortPaneAsked: (of: SortPaneAsked['of']) => void;
  onPaneOfDropdownAsked: () => void;
  onInsertChosen: (what: CellControlInPlaceOfFormat) => void;
  onBorderPenChanged: (change: Partial<BorderLine>) => void;
  onGridlinesToggled: () => void;
  onLocaleAsked: () => void;
  onTimeZoneAsked: () => void;
  onPickerAsked: (picker: BarPicker) => void;
}
/** A picker of the toolbar, as the command that opens it shows it. */
interface PickerToOpen {
  tool: BarPicker;
  label: string;
  icon: IconName | ReactNode;
}
/** Whether the functions can be put in the active cell now. */
export interface FunctionCommandsState {
  canEdit: boolean;
  isEntryOpen: boolean;
}
/** What a function command does when it is taken. */
export interface FunctionCommandsActions {
  onFunctionChosen: (name: string) => void;
}
/** A tool that sets every checkbox of the selection, or clears them. */
export interface CheckboxSettingTool {
  isChecking: boolean;
  icon: IconName;
  inWords: () => string;
  whyNot: (checkboxes: CheckboxesToSet) => string | null;
}
/** A row or column insert of the toolbar. */
export interface InsertLinesTool {
  change: InsertLinesCommand;
  icon: IconName;
  inWords: (count: number) => string;
  /** The words of the insert as a row of a list that already says what is inserted. */
  inListInWords: (count: number) => string;
}
/** The two inserts of rows, or of columns, the toolbar offers. */
export interface InsertRowsOrColumnsTools {
  of: 'columns' | 'rows';
  insert: 'insertColumns' | 'insertRows';
  first: InsertLinesTool;
  second: InsertLinesTool;
}
export function searchMenuBarCommands(barState: SearchMenuBarState, actions: SearchMenuBarActions): MenuCommand[] {
  let {
    whyNoToolForCells,
    formatOfSelection: {
      shared,
      togglesOn,
      numberFormat,
      decimalPlaces,
      formatsThatFit,
      bordersOfBlock,
      checkboxesToSet,
    },
  } = barState;
  let selectedCountOf = (of: InsertRowsOrColumnsTools['of']) =>
    of === 'columns' ? barState.selectedColumnCount : barState.selectedRowCount;
  let whyOneRangeNeeded = (change: InsertLinesCommand) => {
    let act = barState.isOneRangeNeeded ? oneRangeActOfCommand(change) : null;
    return act === null ? null : oneRangeNeededText(act);
  };
  let pickerCommand = ({ tool, label, icon }: PickerToOpen): MenuCommand => ({
    id: `bar.${tool}`,
    label,
    otherWords: [
      ...toolSearchWords(tool),
      ...(tool === 'borders' ? [...toolSearchWords('borderInTheSingular'), ...toolSearchWords('bordersPanel')] : []),
      ...(tool === 'textColor' ? toolSearchWords('textColorPicker') : []),
      ...(tool === 'fillColor' ? toolSearchWords('fillColorPicker') : []),
    ],
    icon,
    actsOn: 'opens',
    home: 'toolbar',
    whyNot: tool === 'conditionalFormatting' ? null : (whyNoToolForCells ?? (tool === 'chart' ? barState.whyNoChart : null)),
    run: () => actions.onPickerAsked(tool),
  });
  let colorCommands = (property: ColorProperty, toolName: string, colorOfCells: Color | null) =>
    colorCommandChoices(property).map(
      (color): MenuCommand => ({
        id: `bar.${property}.${colorCommandKey(color)}`,
        label: toolLabelWithValue(toolName, color.kind === 'standard' ? optionColorName(color) : cellColorName(property, color)),
        otherWords: toolSearchWords(property, color.kind === 'none' ? `${property}.none` : `color.${colorCommandKey(color)}`),
        icon: colorSwatchIcon(property, color),
        isTicked: colorOfCells !== null && colorsEqual(colorOfCells, color),
        actsOn: 'cells',
        whyNot: whyNoToolForCells,
        run: () =>
          actions.onFormatChosen(
            property === 'fillColor'
              ? {
                  fillColor: color,
                }
              : {
                  textColor: color,
                },
          ),
      }),
    );
  let numberFormatChoice = barState.arePeopleSelected ? 'person' : numberFormat.choice;
  let numberFormatCommands = (formatsThatFit.includes('general') ? NUMBER_FORMAT_MENU_CHOICES : []).map((choice): MenuCommand => {
    if (choice === 'customFormat')
      return {
        id: 'bar.numberFormat.customFormat',
        label: toolLabelWithValue(sheetMessages.cellType(), sheetMessages.customFormat()),
        formerLabel: toolLabelWithValue(sheetMessages.numberFormatFormerly(), sheetMessages.customFormat()),
        otherWords: toolSearchWords('numberFormat', 'customFormat'),
        icon: 'Sliders',
        actsOn: 'opens',
        whyNot: whyNoToolForCells,
        run: () =>
          actions.onFormatChosen({
            patternToType: true,
          }),
      };
    let command: MenuCommand = {
      id: `bar.numberFormat.${choice}`,
      label: toolLabelWithValue(sheetMessages.cellType(), numberFormatChoiceLabel(choice)),
      formerLabel: toolLabelWithValue(sheetMessages.numberFormatFormerly(), numberFormatChoiceLabel(choice)),
      otherWords: toolSearchWords('numberFormat', choice),
      icon: numberFormatIconOf(choice).icon,
      isTicked: numberFormatChoice === choice,
      actsOn: 'cells',
      whyNot: whyNoToolForCells,
      run: () =>
        actions.onFormatChosen({
          numberFormatChoice: choice,
        }),
    };
    if (shared.cellControl?.kind !== 'none') command.isWeighty = true;
    return command;
  });
  let insertCommands = barState.inserts.map(
    ({ what, icon, label, fits, whyNotNow }): MenuCommand => ({
      id: `bar.insert.${what}`,
      label: what === 'date' ? sheetMessages.pickADate() : toolLabelWithValue(sheetMessages.cellType(), label),
      formerLabel: toolLabelWithValue(sheetMessages.insert(), label),
      otherWords: toolSearchWords('insert', INSERT_TOOL_OF_CELL_CONTROL[what]),
      icon,
      isTicked: what !== 'date' && numberFormatChoice === what,
      actsOn: what === 'person' ? 'activeCell' : 'cells',
      whyNot: whyNoToolForCells ?? (fits ? (whyNotNow ?? null) : toolUnavailableText(label)),
      isWeighty: true,
      run: () => actions.onInsertChosen(what),
    }),
  );
  let whyNoMerge = barState.isOneRangeNeeded ? oneRangeNeededText('mergeCells') : sheetMessages.moreCellsNeededToMerge();
  let customSortCommands: MenuCommand[] = [
    {
      id: 'bar.customSort',
      label: customSortMessages.customSort(),
      otherWords: toolSearchWords('customSort'),
      icon: 'Sort',
      actsOn: 'opens',
      home: 'pane',
      whyNot: whyNoToolForCells,
      run: () => actions.onSortPaneAsked('sheet'),
    },
  ];
  let contextToolCommands = (tool: ContextTool): MenuCommand[] => {
    switch (tool) {
      case 'insertDropdown':
      case 'insertPerson':
      case 'insertDate':
      case 'insertCheckbox':
      case 'asDropdown':
      case 'asCheckbox':
      case 'fontSize':
      case 'wrapText':
      case 'currency':
      case 'percent':
      case 'fewerDecimalPlaces':
      case 'moreDecimalPlaces':
      case 'mergeCells':
      case 'unmergeCells':
        return [];
      case 'optionsOfDropdown':
        return [
          {
            id: 'bar.optionsOfDropdown',
            label: sheetMessages.optionsOfDropdownInFull(),
            otherWords: toolSearchWords('optionsOfDropdown'),
            icon: 'Dropdown',
            isTicked: barState.isPaneOfDropdownOpen,
            actsOn: 'opens',
            home: 'pane',
            whyNot: null,
            run: actions.onPaneOfDropdownAsked,
          },
        ];
      case 'checkAll':
      case 'uncheckAll': {
        let { isChecking, icon, inWords, whyNot } = CHECKBOX_SETTING_TOOLS[tool];
        return [
          {
            id: `bar.${tool}`,
            label: inWords(),
            otherWords: toolSearchWords(tool),
            icon,
            actsOn: 'cells',
            whyNot: whyNoToolForCells ?? whyNot(checkboxesToSet),
            isWeighty: true,
            run: () => actions.onCheckboxesSet(isChecking),
          },
        ];
      }
      case 'sum':
        return SUM_BAR_AGGREGATES.map(
          (figure) => ({
            id: `bar.sum.${figure}`,
            label: toolLabelWithValue(sheetMessages.calculations(), figureNameLabel(figure)),
            otherWords: toolSearchWords('calculations', figure),
            icon: 'Sigma',
            actsOn: 'cells',
            whyNot:
              whyNoToolForCells ??
              (barState.canWriteFigures
                ? null
                : barState.selectedColumnCount > 1
                  ? sheetMessages.oneColumnNeededForFigure()
                  : sheetMessages.noRoomForFigure()),
            isWeighty: true,
            run: () => actions.onFigureChosen(figure),
          }),
        );
      case 'insertColumns':
      case 'insertRows':
        return INSERT_ROW_COLUMN_TOOLS.filter(({ insert }) => insert === tool).flatMap(
          ({ of, first, second }) =>
            [first, second].map(
              ({ change, icon, inWords }) => ({
                id: `bar.${change}`,
                label: inWords(selectedCountOf(of)),
                otherWords: toolSearchWords(tool, change),
                icon,
                actsOn: 'cells',
                whyNot: whyNoToolForCells ?? whyOneRangeNeeded(change),
                isWeighty: true,
                run: () => actions.onSheetChangeChosen(change),
              }),
            ),
        );
      case 'sort':
        return [
          {
            id: 'bar.sortAndFilter',
            label: sortAndFilterMessages.sortAndFilter(),
            otherWords: commandSearchSynonyms('sortAndFilter'),
            icon: 'FilterLines',
            actsOn: 'opens',
            home: 'toolbar',
            whyNot: whyNoToolForCells,
            run: () => actions.onPickerAsked('sort'),
          },
          ...(barState.sectionShows === 'columns' ? customSortCommands : []),
        ];
    }
  };
  return [
    ...FONT_MARKS.map(
      (mark): MenuCommand => ({
        id: `bar.${mark}`,
        label: textStyleLabel(mark),
        otherWords: toolSearchWords(mark),
        icon: TEXT_TOGGLE_ICONS[mark].icon,
        keys: formatToggleShortcut(mark),
        isTicked: togglesOn[mark],
        actsOn: 'cells',
        whyNot: whyNoToolForCells,
        run: () =>
          actions.onFormatChosen({
            toggle: mark,
          }),
      }),
    ),
    ...HORIZONTAL_ALIGNMENTS.map(
      (alignment): MenuCommand => ({
        id: `bar.align.${alignment}`,
        label: toolLabelWithValue(sheetMessages.align(), horizontalAlignmentLabel(alignment)),
        otherWords: toolSearchWords('align', `align.${alignment}`),
        icon: HORIZONTAL_ALIGN_ICONS[alignment],
        isTicked: shared.alignment.horizontal === alignment,
        actsOn: 'cells',
        whyNot: whyNoToolForCells,
        run: () =>
          actions.onFormatChosen({
            horizontalAlignment: alignment,
          }),
      }),
    ),
    ...VERTICAL_ALIGN_CHOICES.map(
      (alignment): MenuCommand => ({
        id: `bar.alignVertically.${alignment}`,
        label: toolLabelWithValue(sheetMessages.alignVertically(), verticalAlignmentLabel(alignment)),
        otherWords: toolSearchWords('alignVertically', `alignVertically.${alignment}`),
        icon: VERTICAL_ALIGN_ICONS[alignment],
        isTicked: shared.alignment.vertical === alignment,
        actsOn: 'cells',
        whyNot: whyNoToolForCells,
        run: () =>
          actions.onFormatChosen({
            verticalAlignment: alignment,
          }),
      }),
    ),
    {
      id: 'bar.wrapText',
      label: sheetMessages.wrapText(),
      otherWords: toolSearchWords('wrapText'),
      icon: 'TextWrap',
      isTicked: isWrapTextOn(shared),
      actsOn: 'cells',
      whyNot: whyNoToolForCells,
      run: () => actions.onFormatChosen(wrapTextToggled(shared)),
    },
    ...FONT_SIZE_CHOICES.map((size) => fontSizeCommand(size, barState, actions)),
    pickerCommand({
      tool: 'textColor',
      label: sheetMessages.textColor(),
      icon: COLOR_TOOL_ICONS.textColor,
    }),
    ...colorCommands('textColor', sheetMessages.textColor(), shared.font.color),
    pickerCommand({
      tool: 'fillColor',
      label: sheetMessages.cellColor(),
      icon: COLOR_TOOL_ICONS.fillColor,
    }),
    ...colorCommands('fillColor', sheetMessages.cellColor(), shared.fillColor),
    pickerCommand({
      tool: 'borders',
      label: sheetMessages.borders(),
      icon: <BordersOfBlockIcon lines={bordersOfBlock} />,
    }),
    ...BORDER_CHOICES_WITH_CLEAR.map(
      (choice): MenuCommand => ({
        id: `bar.borders.${choice}`,
        label: borderEdgesLabel(choice),
        otherWords: toolSearchWords('borders', 'borderInTheSingular', `borders.${choice}`),
        icon: borderChoiceIcon(choice),
        actsOn: 'cells',
        whyNot: whyNoToolForCells,
        run: () => actions.onBordersChosen(choice),
      }),
    ),
    {
      id: 'bar.borders.color',
      label: borderMenuMessages.borderColor(),
      otherWords: [...toolSearchWords('borders'), ...toolSearchWords('borderColor')],
      icon: colorSwatchIcon('textColor', barState.borderPen.color),
      actsOn: 'opens',
      home: 'toolbar',
      whyNot: whyNoToolForCells,
      run: () => actions.onPickerAsked('borders'),
    },
    {
      id: 'bar.showGridlines',
      label: borderMenuMessages.showGridlines(),
      otherWords: toolSearchWords('showGridlines'),
      icon: null,
      isTicked: !barState.areGridlinesHidden,
      actsOn: 'sheet',
      whyNot: whyNoToolForCells,
      run: actions.onGridlinesToggled,
    },
    pickerCommand({
      tool: 'conditionalFormatting',
      label: CONDITIONAL_FORMATTING_WORDS.conditionalFormatting(),
      icon: 'ConditionalFormat',
    }),
    pickerCommand({
      tool: 'chart',
      label: CHART_MESSAGES.insertChart(),
      icon: 'Chart',
    }),
    ...insertCommands.filter(({ id }) => id !== INSERT_DATE_COMMAND_ID),
    ...numberFormatCommands,
    {
      id: 'bar.locale',
      label: localeMessages.locale(),
      otherWords: toolSearchWords('locale'),
      icon: 'Globe',
      actsOn: 'file',
      whyNot: null,
      isWeighty: true,
      run: actions.onLocaleAsked,
    },
    {
      id: 'bar.timeZone',
      label: timeZoneMessages.timeZone(),
      otherWords: toolSearchWords('timeZone'),
      icon: 'Clock',
      actsOn: 'file',
      whyNot: null,
      isWeighty: true,
      run: actions.onTimeZoneAsked,
    },
    ...DECIMAL_PLACE_CHANGES.flatMap((step): MenuCommand[] => {
      let whyNoStep = decimalPlaces[step] === null ? whyNoDecimalStep(step, decimalPlaces) : null;
      if (whyNoToolForCells === null && decimalPlaces[step] === null && whyNoStep === null) return [];
      return [
        {
          id: `bar.${step}DecimalPlaces`,
          label: step === 'more' ? sheetMessages.increaseDecimalPlaces() : sheetMessages.decreaseDecimalPlaces(),
          otherWords: toolSearchWords(`${step}DecimalPlaces`),
          icon: DECIMAL_STEP_ICONS[step],
          actsOn: 'cells',
          whyNot: whyNoToolForCells ?? whyNoStep,
          keepsOpen: true,
          run: () =>
            actions.onFormatChosen({
              stepOfDecimalPlaces: step,
            }),
        },
      ];
    }),
    ...contextToolsThatFit(barState.sectionShows, 'all', {
      hasSortAndFilter: barState.isSortAndFilterOnBar,
    }).flatMap(contextToolCommands),
    ...(barState.canMergeSelection || !barState.canUnmergeSelection
      ? [
          {
            id: 'bar.mergeCells',
            label: sheetMessages.mergeCells(),
            otherWords: toolSearchWords('mergeCells'),
            icon: MERGE_TOOL_ICONS.mergeCells,
            actsOn: 'cells',
            whyNot: whyNoToolForCells ?? (barState.canMergeSelection ? null : whyNoMerge),
            isWeighty: true,
            run: () => actions.onMergeChangeChosen('mergeCells'),
          },
        ] satisfies MenuCommand[]
      : []),
    ...(barState.canUnmergeSelection
      ? [
          {
            id: 'bar.unmergeCells',
            label: sheetMessages.unmergeCells(),
            otherWords: toolSearchWords('unmergeCells'),
            icon: MERGE_TOOL_ICONS.unmergeCells,
            actsOn: 'cells',
            whyNot: whyNoToolForCells,
            isWeighty: true,
            run: () => actions.onMergeChangeChosen('unmergeCells'),
          },
        ] satisfies MenuCommand[]
      : []),
    ...insertCommands.filter(({ id }) => id === INSERT_DATE_COMMAND_ID),
  ];
}
export function functionCommands(
  names: readonly string[],
  state: FunctionCommandsState,
  actions: FunctionCommandsActions,
): MenuCommand[] {
  if (!state.canEdit || state.isEntryOpen) return [];
  return names.map(
    (name) => ({
      id: `function.${name}`,
      label: name,
      icon: 'Function',
      actsOn: 'activeCell',
      whyNot: null,
      run: () => actions.onFunctionChosen(name),
    }),
  );
}
export function functionCommandsForFormula(
  query: string,
  limit: number,
  state: FunctionCommandsState,
  actions: FunctionCommandsActions,
) {
  let trimmed = query.trim();
  if (!trimmed.startsWith('=')) return [];
  let typedName = trimmed.slice(1).trimStart().toUpperCase();
  let names = typedName.endsWith('(')
    ? ALL_FUNCTION_NAMES.filter((name) => `${name}(` === typedName)
    : functionNamesOffered(typedName);
  return functionCommands(names.slice(0, limit), state, actions);
}
export function functionCommandsForPrefix(
  query: string,
  limit: number,
  state: FunctionCommandsState,
  actions: FunctionCommandsActions,
) {
  let prefix = query.trim().toUpperCase();
  if (prefix.length < FUNCTION_PREFIX_MIN_LENGTH) return [];
  return functionCommands(FUNCTION_NAMES_COMMON_FIRST.filter((name) => name.startsWith(prefix)).slice(0, limit), state, actions);
}
export const colorSwatchIcon = (tool: ColorProperty, color: Color) =>
  <span aria-hidden className="sheet-swatch" data-as-icon data-has-fill={color.kind === 'none' ? undefined : true} data-no-color={color.kind === 'none' ? true : undefined} style={fillPaintStyle(shownCellColor(tool, color))} />;
export const TEXT_TOGGLE_ICONS: Record<FontMark, { icon: IconName }> = {
  bold: {
    icon: 'TextBold',
  },
  italic: {
    icon: 'TextItalics',
  },
  underline: {
    icon: 'TextUnderline',
  },
  strikethrough: {
    icon: 'Strikethrough',
  },
};
export const COLOR_TOOL_ICONS: Record<ColorProperty, IconName> = {
  textColor: 'TextT',
  fillColor: 'PaintBucket',
};
export const MERGE_TOOL_ICONS: Record<MergeAct, IconName> = {
  mergeCells: 'TableCellsMerge',
  unmergeCells: 'TableCellSplit',
};
export const CHECKBOX_SETTING_TOOLS: Record<'checkAll' | 'uncheckAll', CheckboxSettingTool> = {
  checkAll: {
    isChecking: true,
    icon: 'Check',
    inWords: sheetMessages.checkAll,
    whyNot({ isAnyToCheck, isAnyUncheckedByFormula }) {
      if (isAnyToCheck) return null;
      return isAnyUncheckedByFormula ? sheetMessages.formulasSetWhatIsLeft() : sheetMessages.nothingToCheck();
    },
  },
  uncheckAll: {
    isChecking: false,
    icon: 'X',
    inWords: sheetMessages.uncheckAll,
    whyNot({ isAnyToUncheck, isAnyCheckedByFormula }) {
      if (isAnyToUncheck) return null;
      return isAnyCheckedByFormula ? sheetMessages.formulasSetWhatIsLeft() : sheetMessages.nothingToUncheck();
    },
  },
};
export const INSERT_ROW_COLUMN_TOOLS: InsertRowsOrColumnsTools[] = [
  {
    of: 'columns',
    insert: 'insertColumns',
    first: {
      change: 'insertColumnLeft',
      icon: 'TableColumnInsertLeft',
      inWords: insertColumnsLeftLabel,
      inListInWords: columnsLeftLabel,
    },
    second: {
      change: 'insertColumnRight',
      icon: 'TableColumnInsertRight',
      inWords: insertColumnsRightLabel,
      inListInWords: columnsRightLabel,
    },
  },
  {
    of: 'rows',
    insert: 'insertRows',
    first: {
      change: 'insertRowAbove',
      icon: 'TableRowInsertAbove',
      inWords: insertRowsAboveLabel,
      inListInWords: rowsAboveLabel,
    },
    second: {
      change: 'insertRowBelow',
      icon: 'TableRowInsertBelow',
      inWords: insertRowsBelowLabel,
      inListInWords: rowsBelowLabel,
    },
  },
];
export const BORDER_CHOICES_WITH_CLEAR: BorderChoice[] = [...BORDER_EDGE_CHOICES, 'clear'];
export const INSERT_DATE_COMMAND_ID = 'bar.insert.date';
export const INSERT_TOOL_OF_CELL_CONTROL: Record<CellControlInPlaceOfFormat, ContextTool> = {
  dropdown: 'insertDropdown',
  person: 'insertPerson',
  date: 'insertDate',
  checkbox: 'insertCheckbox',
};
export const COLOR_COMMAND_SHADES: Record<ColorProperty, Shade> = {
  fillColor: 100,
  textColor: 600,
};
export const fontSizeCommand = (
  size: number,
  barState: Pick<SearchMenuBarState, 'formatOfSelection' | 'whyNoToolForCells'>,
  actions: Pick<SearchMenuBarActions, 'onFormatChosen'>,
): MenuCommand => ({
  id: `bar.fontSize.${size}`,
  label: toolLabelWithValue(sheetMessages.fontSize(), String(size)),
  otherWords: toolSearchWords('fontSize', `fontSize.${size}`),
  icon: 'TextAa',
  isTicked: barState.formatOfSelection.shared.font.size === size,
  actsOn: 'cells',
  whyNot: barState.whyNoToolForCells,
  run: () =>
    actions.onFormatChosen({
      fontSizeInPoints: size,
    }),
});
export const colorCommandChoices = (tool: ColorProperty): Color[] => [
  NO_COLOR,
  ...[...STANDARD_HUE_COLORS, ...GRAYSCALE_COLORS].filter(
    (color) =>
      color.kind === 'standard' ? color.shade === COLOR_COMMAND_SHADES[tool] : tool === 'textColor' && !colorsEqual(color, LIGHT_GRAY_COLOR),
  ),
];
export const colorCommandKey = (color: Color) => {
  if (color.kind === 'standard') return color.hue;
  if (color.kind === 'none') return color.kind;
  if (colorsEqual(color, WHITE_COLOR)) return 'white';
  return colorsEqual(color, BLACK_COLOR) ? 'black' : color.hex;
};
export const FUNCTION_PREFIX_MIN_LENGTH = 2;
