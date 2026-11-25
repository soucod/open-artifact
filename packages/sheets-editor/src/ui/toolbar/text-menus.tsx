import { Menu } from '../../kit/menu.tsx';
import { FONT_MARK_SHORTCUTS } from '../../editor/text-looks.ts';
import {
  fontSizesMatchingTyped,
  FONT_SIZE_CHOICES,
  SMALLEST_FONT_SIZE,
  LARGEST_FONT_SIZE,
  VERTICAL_ALIGN_CHOICES,
} from '../../format/toolbar-size-choices.ts';
import { sheetMessages } from '../../i18n/sheet-messages.ts';
import { textWrappingLabel, textWrappingButtonLabel, horizontalAlignmentLabel, verticalAlignmentLabel } from '../../i18n/format-labels.ts';
import { HORIZONTAL_ALIGNMENTS } from '../../format/toolbar-choices.ts';
import { translateMessage } from '../../i18n/messages.ts';
import { preventMouseDownDefault } from '../dom-events.ts';
import { blockRepeatedEnterOrSpace } from '../repeated-key-guards.ts';
import { CONTEXT_BAR_PART_ATTRIBUTE } from '../toolbar-tooltip.tsx';
import { MENU_MAX_VISIBLE_ITEMS } from '../menu-scroll.ts';
import { TEXT_WRAPPING_CHOICES, textWrappingOf, textWrappingChange } from '../../grid/text-overflow.ts';
import { Icon } from '../../kit/icon.tsx';
import { fontSizeText, fontSizeButtonLabel } from '../../i18n/menu-labels.ts';
import type { ReactNode, Ref } from 'react';
import type { HorizontalAlignment, SharedCellFormat, VerticalAlignment } from '@open-artifact/sheets-core';
import type { IconName } from '../../kit/icon.tsx';
import type { FontMark } from '../../state/initial-state.ts';
import type { FormatCommand } from '../../format/format-commands.ts';
/** The format the selected cells share, and where a format chosen from a menu goes. */
export interface SharedFormatMenuProps {
  shared: SharedCellFormat;
  onChosen: (command: FormatCommand) => void;
}
export interface FontSizeItemsProps extends SharedFormatMenuProps {
  /** A size typed in the font size field, which narrows the sizes offered. */
  typed?: string;
}
export interface TextWrappingItemsProps extends SharedFormatMenuProps {
  hasHeading: boolean;
}
export interface FormatSubmenuProps extends SharedFormatMenuProps {
  hasIcon: boolean;
}
export interface AlignMenuItemsProps extends SharedFormatMenuProps {
  /** Whether the menu also offers the font size and text wrapping, which have no row of their own. */
  hasRowsWithLists: boolean;
}
/** How a submenu of a bar menu shows its row and its list. */
export interface BarSubmenuOptions {
  heardAs?: string;
  icon?: IconName;
  isTicked?: boolean;
  mostRowsInView?: number;
  rowRef?: Ref<HTMLElement>;
  listWidth?: { className: string };
}
export function formatToggleShortcut(toggle: FontMark): string {
  let { letter, isWithShift } = FONT_MARK_SHORTCUTS[toggle];
  return isWithShift ? `cmd+shift+${letter}` : `cmd+${letter}`;
}
export function FontSizeItems({ shared, onChosen, typed = '' }: FontSizeItemsProps) {
  let isTyped = typed.trim() !== '';
  let sizes = isTyped ? fontSizesMatchingTyped(typed) : FONT_SIZE_CHOICES;
  if (sizes.length === 0)
    return <p className="py-sm text-footnote text-muted px-2.5">{fontSizeRangeMessage(SMALLEST_FONT_SIZE, LARGEST_FONT_SIZE)}</p>;
  return <Menu.Group aria-label={sheetMessages.fontSize()}>{sizes.map(
      (size, index) =>
        (<Menu.Item key={size} checkedRole="radio" checked={shared.font.size === size} {...(isTyped &&
              index === 0 && {
                className: 'sheet-row-under-enter',
              })} onClick={() =>
              onChosen({
                fontSizeInPoints: size,
              })}>{size}</Menu.Item>),
    )}</Menu.Group>;
}
export function TextWrappingItems({ shared, onChosen, hasHeading }: TextWrappingItemsProps) {
  let wrapping = textWrappingOf(shared);
  return <Menu.Group {...(!hasHeading && {
      'aria-label': sheetMessages.textWrapping(),
    })}>{hasHeading &&
        <Menu.GroupLabel>{sheetMessages.textWrapping()}</Menu.GroupLabel>}{TEXT_WRAPPING_CHOICES.map(
        (choice) =>
          <Menu.Item key={choice} checkedRole="radio" checked={wrapping === choice} onClick={() => onChosen(textWrappingChange(choice))}>{textWrappingLabel(choice)}</Menu.Item>,
      )}</Menu.Group>;
}
export function TextWrappingSubmenu({ shared, onChosen, hasIcon }: FormatSubmenuProps) {
  let wrapping = textWrappingOf(shared);
  return barSubmenu(
    sheetMessages.textWrapping(),
    wrapping === null ? sheetMessages.signOfMixedTextWrappings() : textWrappingLabel(wrapping),
    <TextWrappingItems shared={shared} onChosen={onChosen} hasHeading={false} />,
    {
      heardAs: textWrappingButtonLabel(wrapping),
      ...(hasIcon && {
        icon: 'TextWrap',
      }),
    },
  );
}
export function AlignMenuItems({ shared, onChosen, hasRowsWithLists }: AlignMenuItemsProps) {
  return <><Menu.Group aria-label={sheetMessages.align()}>{HORIZONTAL_ALIGNMENTS.map(
          (alignment) =>
            (<Menu.Item key={alignment} icon={HORIZONTAL_ALIGN_ICONS[alignment]} description={alignment === 'general' ? sheetMessages.alignedByWhatCellHolds() : null} checkedRole="radio" checked={shared.alignment.horizontal === alignment} onClick={() =>
                  onChosen({
                    horizontalAlignment: alignment,
                  })}>{horizontalAlignmentLabel(alignment)}</Menu.Item>),
        )}</Menu.Group><Menu.Separator /><Menu.Group aria-label={sheetMessages.alignVertically()}>{VERTICAL_ALIGN_CHOICES.map(
          (alignment) =>
            (<Menu.Item key={alignment} icon={VERTICAL_ALIGN_ICONS[alignment]} checkedRole="radio" checked={shared.alignment.vertical === alignment} onClick={() =>
                  onChosen({
                    verticalAlignment: alignment,
                  })}>{verticalAlignmentLabel(alignment)}</Menu.Item>),
        )}</Menu.Group>{hasRowsWithLists &&
        <><Menu.Separator /><FontSizeSubmenu shared={shared} onChosen={onChosen} hasIcon /><TextWrappingSubmenu shared={shared} onChosen={onChosen} hasIcon /></>}</>;
}
export const typeASizeLabel = (): string =>
  translateMessage({
    defaultMessage: 'Type a size',
    id: 'LzGipBZBU9',
  });
export const fontSizeRangeMessage = (smallest: number, largest: number): string =>
  translateMessage(
    {
      defaultMessage: 'Enter a whole number from {smallest} to {largest}.',
      id: '+QvZFPuqQu',
    },
    {
      smallest,
      largest,
    },
  );
export const TEXT_ALIGN_ICONS: Record<Exclude<HorizontalAlignment, 'general'>, IconName> = {
  left: 'TextAlignLeft',
  center: 'TextAlignCenter',
  right: 'TextAlignRight',
};
export const GENERAL_ALIGN_ICON: { icon: IconName } = {
  icon: 'Automatic',
};
export const HORIZONTAL_ALIGN_ICONS: Record<HorizontalAlignment, IconName> = {
  ...TEXT_ALIGN_ICONS,
  general: GENERAL_ALIGN_ICON.icon,
};
export const VERTICAL_ALIGN_ICONS: Record<VerticalAlignment, IconName> = {
  top: 'AlignStart',
  center: 'AlignCenter',
  bottom: 'AlignEnd',
};
export const BAR_SUBMENU_POPUP_PROPS = {
  onMouseDown: preventMouseDownDefault,
  onKeyDownCapture: blockRepeatedEnterOrSpace,
  [CONTEXT_BAR_PART_ATTRIBUTE]: true,
};
export const BAR_SUBMENU_LIST_WIDTH = {
  className: 'data-[side=bottom]:min-w-[var(--anchor-width)] data-[side=top]:min-w-[var(--anchor-width)]',
};
export const SUBMENU_TICK = <span className="flex size-icon shrink-0 items-center justify-center" style={{
    color: 'var(--ui-fill-accent)',
  }}><Icon name="Check" size="auto" bold /></span>;
export const barSubmenu = (
  label: string,
  hint: string | null,
  items: ReactNode,
  { heardAs, icon, isTicked = false, mostRowsInView = MENU_MAX_VISIBLE_ITEMS, rowRef, listWidth }: BarSubmenuOptions = {},
) =>
  <Menu.Submenu><Menu.SubmenuTrigger {...(rowRef !== undefined && {
          ref: rowRef,
        })} {...(icon !== undefined && {
          icon,
        })} {...(isTicked && {
          trailing: SUBMENU_TICK,
        })} {...(hint !== null && {
          hint,
        })} {...(heardAs !== undefined && {
          'aria-label': heardAs,
        })}>{label}</Menu.SubmenuTrigger><Menu.Popup {...BAR_SUBMENU_POPUP_PROPS} className={`${BAR_SUBMENU_LIST_WIDTH.className} ${listWidth?.className ?? ''}`} maxVisibleItems={mostRowsInView}>{items}</Menu.Popup></Menu.Submenu>;
export const FontSizeSubmenu = ({ shared, onChosen, hasIcon }: FormatSubmenuProps) =>
  barSubmenu(
    sheetMessages.fontSize(),
    fontSizeText(shared.font.size),
    <FontSizeItems shared={shared} onChosen={onChosen} />,
    {
      heardAs: fontSizeButtonLabel(shared.font.size),
      ...(hasIcon && {
        icon: 'TextAa',
      }),
      mostRowsInView: FONT_SIZE_CHOICES.length,
    },
  );
export const isWrapTextOn = (format: Pick<SharedCellFormat, 'alignment'>): boolean => format.alignment.wrap === true;
export const wrapTextToggled = (format: Pick<SharedCellFormat, 'alignment'>): { wrapText: boolean } => ({
  wrapText: !isWrapTextOn(format),
});
