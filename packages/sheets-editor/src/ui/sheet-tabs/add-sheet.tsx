import { Menu } from '../../kit/menu.tsx';
import { Button } from '../../kit/button.tsx';
import type { ComponentProps, RefObject } from 'react';
import type { CaretTarget } from '../../tables/own-filter-bar-view.tsx';
import { FILE_UPLOAD_ICON, IMPORT_FILE_SOURCES, type ImportFileSource } from '../../import/file-sources.tsx';
import { importFileChoices, type ImportFileChoice } from '../../import/csv-file.tsx';
import { shortcutFor } from '../../keys/key-press.ts';
import { sheetMessages } from '../../i18n/sheet-messages.ts';
import { ToolbarTooltip } from '../toolbar-tooltip.tsx';
import { swallowRestOfPress } from '../press-swallow.ts';
import { blockRepeatedEnterOrSpace } from '../repeated-key-guards.ts';
import { ToolbarMenu } from '../format-toolbar.tsx';
/** Tells that a menu opened or shut, with the event that did it. */
export type MenuOpenChange = (isOpen: boolean, event: Event | null) => void;
export interface AddSheetMenuItemsProps {
  onBlankChosen: () => void;
  onImportChosen: (choices: ImportFileChoice[]) => void;
  filesForAgent: readonly ImportFileSource[];
  onFileForAgentChosen: (source: ImportFileSource) => void;
}
export function AddSheetMenuItems({
  onBlankChosen,
  onImportChosen,
  filesForAgent = NO_FILES_FOR_AGENT,
  onFileForAgentChosen,
}: AddSheetMenuItemsProps) {
  return <>{filesForAgent.map((source) =>
        <Menu.Item key={source} icon={IMPORT_FILE_SOURCES[source].mark} onClick={() => onFileForAgentChosen(source)}>{IMPORT_FILE_SOURCES[source].name()}</Menu.Item>,
      )}{importFileChoices.map(
        (choice) =>
          <Menu.Item key={choice.accept} icon={FILE_UPLOAD_ICON} onClick={() => onImportChosen([choice])}>{choice.inMenu()}</Menu.Item>,
      )}<Menu.Item icon="File" shortcut={shortcutFor('addSheet')} onClick={onBlankChosen}>{sheetMessages.blankSheet()}</Menu.Item></>;
}
export interface AddSheetButtonProps extends AddSheetMenuItemsProps {
  button: RefObject<HTMLElement | null>;
  isOpen: boolean;
  onOpenChange: MenuOpenChange;
  whatHasCaretAfter: () => CaretTarget;
}
export function AddSheetButton({
  button,
  isOpen,
  onOpenChange,
  whatHasCaretAfter,
  ...menuProps
}: AddSheetButtonProps) {
  let buttonProps: ComponentProps<typeof Button> = {
    ref: button,
    variant: 'ghost',
    iconOnly: true,
    icon: 'Add',
    className: 'sheet-add-sheet',
    'aria-label': sheetMessages.addSheet(),
    tooltip: false,
  };
  if (isAddSheetBlankOnly(menuProps.filesForAgent))
    return <ToolbarTooltip name={sheetMessages.addSheet()} shortcut={shortcutFor('addSheet')} side="top"><Button {...buttonProps} onClick={(event) => {
          let currentTarget = event.currentTarget;
          swallowRestOfPress(event, (target) => !(target instanceof Node && currentTarget.contains(target)));
          menuProps.onBlankChosen();
        }} onKeyDownCapture={blockRepeatedEnterOrSpace} /></ToolbarTooltip>;
  return <ToolbarMenu isOpen={isOpen} button={<Menu.Trigger render={<Button {...buttonProps} />} />} tooltip={sheetMessages.addSheet()} onOpenChange={onOpenChange} whatHasCaretAfter={whatHasCaretAfter} toolbar={button} side="top" placedBy={{
      align: 'start',
    }}><AddSheetMenuItems {...menuProps} /></ToolbarMenu>;
}
const NO_FILES_FOR_AGENT: readonly ImportFileSource[] = [];
export const isAddSheetBlankOnly = (
  filesForAgent: readonly ImportFileSource[] = NO_FILES_FOR_AGENT,
  imports: readonly ImportFileChoice[] = importFileChoices,
): boolean => filesForAgent.length + imports.length === 0;
