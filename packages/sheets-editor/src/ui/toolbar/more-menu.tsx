import { Menu } from '../../kit/menu.tsx';
import type { ReactNode } from 'react';
import type { FontMark } from '../../state/initial-state.ts';
import type { FormatOfSelection } from '../../state/selection-seen.ts';
import type { FormatCommand } from '../../format/format-commands.ts';
import type { DecimalPlaceChange, DecimalPlaceChanges } from '../../format/decimal-places.ts';
import type { MergeAct } from '../../format/merge-cells.ts';
import type { ContextTool } from './context-tools.ts';
import type { ToolInBar } from './fold.tsx';
import * as React from 'react';
import { Fragment } from 'react/jsx-runtime';
import { formatToggleShortcut, FontSizeSubmenu, barSubmenu, AlignMenuItems, TextWrappingSubmenu } from './text-menus.tsx';
import { textStyleLabel, sheetMessages } from '../../i18n/sheet-messages.ts';
import { MenuItemWithWhyOff } from '../menu-item-why-off.tsx';
import { whyNoDecimalStep } from './decimal-places.tsx';
import { swallowRestOfPress } from '../press-swallow.ts';
import { CONDITIONAL_FORMATTING_WORDS } from '../../messages/conditional-format.ts';
import { CHART_MESSAGES } from '../../charts/chart-words.ts';
/** A tool that, left off the bar, gets a row of its own in the more menu. */
export type FoldableTool =
  | 'fontSize'
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strikethrough'
  | 'align'
  | 'textColor'
  | 'fillColor'
  | 'borders'
  | 'conditionalFormatting'
  | 'chart'
  | 'fewerDecimalPlaces'
  | 'moreDecimalPlaces'
  | 'mergeCells'
  | 'unmergeCells';
/** A tool whose row in the more menu opens its picker. */
export type ToolWithPicker = 'textColor' | 'fillColor' | 'borders' | 'conditionalFormatting' | 'chart';
/** A tool the more menu can show: a context tool left off the bar, or a foldable tool. */
export type MoreMenuTool = ContextTool | FoldableTool;
/** The tools of the more menu: those of the selection first, then the others. */
export interface MoreMenuTools {
  ofSelection: MoreMenuTool[];
  others: MoreMenuTool[];
}
/** What the more menu is worked out from. */
export interface MoreMenuState {
  folded: ContextTool[];
  withButton: ToolInBar[];
  isFontSizeUnderAlign: boolean;
  format: Pick<FormatOfSelection, 'shared' | 'togglesOn' | 'decimalPlaces'>;
  canUnmergeSelection: boolean;
  whyNoMerge: string | null;
}
export interface MoreToolsMenuProps extends MoreMenuState {
  rowWhileFolded: (tool: ContextTool) => ReactNode;
  onFormatChosen: (command: FormatCommand) => void;
  onMergeChangeChosen: (change: MergeAct) => void;
  onPickerAsked: (tool: ToolWithPicker, isByKey: boolean) => void;
  /** The rows that insert rows or columns, put first; `null` when the bar has them. */
  rowsThatInsertLines: ReactNode;
  whyNoChart: string | null;
  onSheetMenuAsked: (isByKey: boolean) => void;
}
export function splitMoreMenuTools(
  folded: readonly ContextTool[],
  menuTools: readonly MoreMenuTool[],
  isFontSizeUnderAlign: boolean,
  leftOut: readonly MoreMenuTool[] = [],
): MoreMenuTools {
  return {
    ofSelection: folded.flatMap((tool) => {
      if (isInsertOrChipTool(tool)) return [];
      return !isFoldableTool(tool) || menuTools.includes(tool) ? [tool] : [];
    }),
    others: menuTools.filter(
      (tool) =>
        !folded.some((foldedTool) => foldedTool === tool) &&
        !(tool === 'fontSize' && isFontSizeUnderAlign) &&
        !leftOut.includes(tool),
    ),
  };
}
export function renderMoreMenu(
  {
    folded,
    rowWhileFolded,
    withButton,
    isFontSizeUnderAlign,
    format: { shared, togglesOn, decimalPlaces },
    canUnmergeSelection,
    whyNoMerge,
    onFormatChosen,
    onMergeChangeChosen,
    onPickerAsked,
    rowsThatInsertLines,
    whyNoChart,
    onSheetMenuAsked,
  }: MoreToolsMenuProps,
  leftOut: readonly MoreMenuTool[],
) {
  let toggleItem = (toggle: FontMark) =>
    <Menu.Item checked={togglesOn[toggle]} shortcut={formatToggleShortcut(toggle)} onClick={() =>
        onFormatChosen({
          toggle,
        })}>{textStyleLabel(toggle)}</Menu.Item>;
  let mergeItem = (change: MergeAct, whyOff: string | null) =>
    <MenuItemWithWhyOff disabled={whyOff !== null} whyOff={whyOff} onClick={() => onMergeChangeChosen(change)}>{sheetMessages[change]()}</MenuItemWithWhyOff>;
  let decimalPlacesItem = (step: DecimalPlaceChange) =>
    <MenuItemWithWhyOff keepOpen disabled={decimalPlaces[step] === null} whyOff={whyNoDecimalStep(step, decimalPlaces)} onClick={() =>
        onFormatChosen({
          stepOfDecimalPlaces: step,
        })}>{step === 'more' ? sheetMessages.increaseDecimalPlaces() : sheetMessages.decreaseDecimalPlaces()}</MenuItemWithWhyOff>;
  let pickerItem = (tool: ToolWithPicker, label: string, whyOff: string | null = null) =>
    <MenuItemWithWhyOff disabled={whyOff !== null} whyOff={whyOff} onClick={(event) => {
        swallowRestOfPress(event);
        onPickerAsked(tool, event.detail === 0);
      }}>{label}</MenuItemWithWhyOff>;
  let itemOfTool = (tool: FoldableTool) => {
    switch (tool) {
      case 'fontSize':
        return <FontSizeSubmenu shared={shared} onChosen={onFormatChosen} hasIcon={false} />;
      case 'bold':
      case 'italic':
      case 'underline':
      case 'strikethrough':
        return toggleItem(tool);
      case 'align':
        return <>{barSubmenu(
              sheetMessages.align(),
              null,
              <AlignMenuItems shared={shared} onChosen={onFormatChosen} hasRowsWithLists={false} />,
            )}{isWrapTextNowhere(folded, withButton) &&
              <TextWrappingSubmenu shared={shared} onChosen={onFormatChosen} hasIcon={false} />}</>;
      case 'textColor':
        return pickerItem(tool, sheetMessages.textColor());
      case 'fillColor':
        return pickerItem(tool, sheetMessages.cellColor());
      case 'borders':
        return pickerItem(tool, sheetMessages.borders());
      case 'mergeCells':
        return mergeItem(tool, whyNoMerge);
      case 'unmergeCells':
        return mergeItem(tool, null);
      case 'conditionalFormatting':
        return pickerItem(tool, CONDITIONAL_FORMATTING_WORDS.conditionalFormatting());
      case 'chart':
        return pickerItem(tool, CHART_MESSAGES.insertChart(), whyNoChart);
      case 'fewerDecimalPlaces':
        return decimalPlacesItem('fewer');
      case 'moreDecimalPlaces':
        return decimalPlacesItem('more');
    }
  };
  let { ofSelection, others } = splitMoreMenuTools(
    folded,
    foldedToolsOf(withButton, {
      canMerge: whyNoMerge === null,
      canUnmerge: canUnmergeSelection,
    }),
    isFontSizeUnderAlign,
    leftOut,
  );
  return <>{rowsThatInsertLines}{rowsThatInsertLines !== null && <Menu.Separator />}{[ofSelection, others].map(
        (tools, index) =>
          tools.length > 0 &&
          (<React.Fragment key={index === 0 ? 'ofSelection' : 'others'}>{tools.map(
                  (tool) =>
                    (<React.Fragment key={tool}>{isFoldableTool(tool)
                          ? itemOfTool(tool)
                          : tool === 'wrapText'
                            ? <TextWrappingSubmenu shared={shared} onChosen={onFormatChosen} hasIcon={false} />
                            : rowWhileFolded(tool)}</React.Fragment>),
                )}<Menu.Separator /></React.Fragment>),
      )}<Menu.Item onClick={(event) => {
          swallowRestOfPress(event);
          onSheetMenuAsked(event.detail === 0);
        }}>{sheetMessages.moreActions()}</Menu.Item></>;
}
export function MoreToolsMenu(props: MoreToolsMenuProps) {
  let [leftOut] = React.useState(() => toolsLeftOutOfMoreMenu(props.format.decimalPlaces, props.whyNoMerge));
  return renderMoreMenu(props, leftOut);
}
export const TOOLS_WITH_PICKERS: ToolWithPicker[] = ['textColor', 'fillColor', 'borders', 'conditionalFormatting', 'chart'];
export const submenuOrWhyOff = (label: string, whyOff: string | null, content: ReactNode) =>
  whyOff === null
    ? barSubmenu(label, null, content)
    : <MenuItemWithWhyOff disabled whyOff={whyOff}>{label}</MenuItemWithWhyOff>;
export const INSERT_OR_CHIP_TOOLS = {
  insertDropdown: true,
  insertPerson: true,
  insertDate: true,
  insertCheckbox: true,
  asDropdown: true,
  asCheckbox: true,
  insertRows: true,
  insertColumns: true,
};
export const FOLDABLE_TOOLS: FoldableTool[] = [
  'fontSize',
  'bold',
  'italic',
  'underline',
  'strikethrough',
  'align',
  'textColor',
  'fillColor',
  'borders',
  'conditionalFormatting',
  'chart',
  'fewerDecimalPlaces',
  'moreDecimalPlaces',
  'mergeCells',
  'unmergeCells',
];
export const foldedToolsOf = (withButton: readonly ToolInBar[], { canMerge, canUnmerge }: { canMerge: boolean; canUnmerge: boolean }) =>
  FOLDABLE_TOOLS.filter((tool) => {
    if (tool === 'mergeCells' && canUnmerge) return canMerge;
    if (tool === 'unmergeCells' && !canUnmerge) return false;
    return !withButton.includes(tool === 'strikethrough' ? 'underline' : tool);
  });
export const isFoldableTool = (tool: MoreMenuTool): tool is FoldableTool => FOLDABLE_TOOLS.some((foldable) => foldable === tool);
export const isInsertOrChipTool = (tool: MoreMenuTool) => tool in INSERT_OR_CHIP_TOOLS;
export const toolsLeftOutOfMoreMenu = ({ whyNeither }: DecimalPlaceChanges, whyNoMerge: string | null): FoldableTool[] => [
  ...(whyNeither === 'noNumbers' || whyNeither === 'dropdownOrCheckbox' ? (['fewerDecimalPlaces', 'moreDecimalPlaces'] as const) : []),
  ...(whyNoMerge === null ? [] : (['mergeCells'] as const)),
];
export const isWrapTextNowhere = (folded: readonly ContextTool[], withButton: readonly ToolInBar[]) =>
  !folded.includes('wrapText') && !withButton.includes('wrapText');
