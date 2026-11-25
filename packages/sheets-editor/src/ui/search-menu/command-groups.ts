import { commandsNameableFromWords, MAX_COMMANDS_NAMED } from '../commands-from-words.ts';
import { toolLabelWithValue } from '../../tools/search-words.ts';
import { sortMenuLabel, sortRangeLabel, sortSheetLabel } from '../../i18n/grid-action-labels.ts';
import { commandActsOnCells } from './matching.ts';
import type { CommandCost, CommandHome, MenuCommand, SearchableCommand } from './matching.ts';
import { translateMessage } from '../../i18n/messages.ts';
import { sheetMessages } from '../../i18n/sheet-messages.ts';
import { CONDITIONAL_FORMATTING_WORDS } from '../../messages/conditional-format.ts';
import { autocompleteFunctionsHeading } from '../../messages/formula-autocomplete.ts';
import { sheetWord } from '../../messages/sheet-command-words.ts';
import { goToLabel } from '../go-to-commands.ts';
import { customSortMessages } from '../../tables/sort-filter-labels.ts';
/** Commands listed under one heading of the search menu (no heading when it is `null`). */
export interface CommandsUnderHeading<Command> {
  heading: string | null;
  commands: Command[];
}
/** A group of found commands, as the search menu lists it. */
export interface CommandGroup extends CommandsUnderHeading<MenuCommand> {
  isOfWhatOpens: boolean;
}
/** Which commands a group of the search menu holds, and how it names them. */
export interface CommandGroupRule {
  heading: () => string;
  holds: (command: SearchableCommand) => boolean;
  /** The name of the tool, taken off the labels of the commands in the group. */
  toolInNames?: () => string;
  isOfWhatOpens?: boolean;
}
/** Where the hint of a command shows: the active cell's address, and how many cells are selected. */
export interface CommandHintPlace {
  activeCell: string | null;
  cellCount: number;
}
export function commandHint(
  { actsOn, home, cost }: Pick<MenuCommand, 'actsOn' | 'home' | 'cost'>,
  { activeCell, cellCount }: CommandHintPlace,
) {
  let costHint = cost === undefined ? null : commandCostHint(cost);
  if (costHint !== null) return costHint;
  if (actsOn === 'activeCell') return activeCell !== null && cellCount > 1 ? inCellHint(activeCell) : null;
  return actsOn === 'opens' && home !== undefined ? (COMMAND_HOME_HINTS[home]?.() ?? null) : null;
}
export function commandsNamedByAgent<Command extends SearchableCommand>(
  commands: readonly Command[],
  namedIds: readonly string[],
) {
  let offeredIds = new Set<string>(
    commandsNameableFromWords(commandsOfferedToAgent(commands), 'all').map(({ id }: Pick<SearchableCommand, 'id'>) => id),
  );
  let commandById = new Map<string, Command>(commands.map((command) => [command.id, command]));
  return [...new Set(namedIds.filter((id) => typeof id === 'string' && offeredIds.has(id)))]
    .flatMap((id) => commandById.get(String(id)) ?? [])
    .slice(0, MAX_COMMANDS_NAMED);
}
export function labelWithoutHeading(heading: string, label: string) {
  let [before = '', after = ''] = toolLabelWithValue(heading, '\x00').split('\x00');
  return label.length > before.length + after.length && label.startsWith(before) && label.endsWith(after)
    ? label.slice(before.length, label.length - after.length)
    : label;
}
export function headingOfCommand(command: Pick<SearchableCommand, 'id' | 'label'>) {
  if (command.id === SORT_AND_FILTER_COMMAND_ID) return null;
  if (isSortCommandUnderHeading(command)) return sortMenuLabel();
  return HEADINGS_BY_COMMAND_PREFIX.find(([prefix]) => command.id.startsWith(prefix))?.[1]() ?? null;
}
export function groupFoundCommands(commands: readonly MenuCommand[]): CommandGroup[] {
  let headingsOfCellCommands = new Set(commands.filter(commandActsOnCells).map(headingOfCommand));
  let isOpenerUnderHeading = (command: MenuCommand) =>
    isToolOpenerCommand(command) && headingsOfCellCommands.has(headingOfCommand(command));
  let isGroupedByHeading = (command: MenuCommand) =>
    commandActsOnCells(command) || UNDO_REDO_COMMAND_IDS.has(command.id) || isOpenerUnderHeading(command);
  let headedCommands = commands
    .filter(isGroupedByHeading)
    .map((command): MenuCommand => (isOpenerUnderHeading(command) ? withoutHome(command) : command));
  let otherCommands = commands.filter((command) => !isGroupedByHeading(command));
  let groupIndexOf = (command: MenuCommand) => COMMAND_GROUPS.findIndex(({ holds }) => holds(command));
  let loneHeadingIds = new Set(
    groupByHeading(new Map<string | null, MenuCommand[]>(), headedCommands).flatMap(
      ({ heading, commands: [first, ...rest] }) =>
        first !== undefined && rest.length === 0 && first.label === heading ? [first.id] : [],
    ),
  );
  let groups = [
    ...groupByHeading(new Map<string | null, MenuCommand[]>(), headedCommands, ({ id }) => loneHeadingIds.has(id)).map(
      ({ heading, commands: commandsOfHeading }) => ({
        heading,
        commands: commandsOfHeading,
        isOfWhatOpens: false,
      }),
    ),
    ...COMMAND_GROUPS.map(
      ({ heading, toolInNames, isOfWhatOpens = false }, groupIndex) => ({
        heading: heading(),
        commands: otherCommands
          .filter((command) => groupIndexOf(command) === groupIndex)
          .map((command) => (toolInNames === undefined ? command : commandUnderHeading(toolInNames(), command))),
        isOfWhatOpens,
      }),
    ).filter(({ commands: commandsOfGroup }) => commandsOfGroup.length > 0),
  ];
  let firstEnabledId = commands.find(({ whyNot }) => whyNot === null)?.id;
  let holdsFirstEnabled = ({ commands: commandsOfGroup }: CommandGroup) =>
    commandsOfGroup.some(({ id }) => id === firstEnabledId);
  return [...groups.filter(holdsFirstEnabled), ...groups.filter((group) => !holdsFirstEnabled(group))];
}
export function groupByHeading<Command extends Pick<SearchableCommand, 'id' | 'label'>>(
  groups: Map<string | null, Command[]>,
  commands: readonly Command[],
  keepsOwnLabel: (command: Command) => boolean = () => false,
): CommandsUnderHeading<Command>[] {
  for (let command of commands) {
    let heading = keepsOwnLabel(command) ? null : headingOfCommand(command);
    let headed = heading === null ? command : commandUnderHeading(heading, command);
    groups.set(heading, [...(groups.get(heading) ?? []), headed]);
  }
  return [...groups]
    .filter(([, items]) => items.length > 0)
    .map(
      ([heading, commandsOfHeading]) => ({
        heading,
        commands: commandsOfHeading,
      }),
    );
}
export const commandGroupMessages = {
  thisSheet: () =>
    translateMessage({
      defaultMessage: 'This sheet',
      id: 'Esonrjqh1K',
    }),
  sheets: () =>
    translateMessage({
      defaultMessage: 'Sheets',
      id: 'qHbcJVDB59',
    }),
  view: () =>
    translateMessage({
      defaultMessage: 'View',
      id: '0WRgxnjr2b',
    }),
  wholeFile: () =>
    translateMessage({
      defaultMessage: 'Whole file',
      id: 'NaYA7Xpb3p',
    }),
  open: () =>
    translateMessage({
      defaultMessage: 'Open',
      id: 'Wpz0k1hhsP',
    }),
  toolbar: () =>
    translateMessage({
      defaultMessage: 'Toolbar',
      id: '/4MG3sCGjO',
    }),
  topBar: () =>
    translateMessage({
      defaultMessage: 'Top bar',
      id: 'ceQFUv3E7s',
    }),
  sheetTab: () =>
    translateMessage({
      defaultMessage: 'Sheet tab',
      id: '7O+NbnXoVR',
    }),
  enterAgainToConfirm: () =>
    translateMessage({
      defaultMessage: 'Enter again to confirm',
      id: '5ecYuw0syO',
    }),
};
export const inCellHint = (cell: string) =>
  translateMessage(
    {
      defaultMessage: 'In {cell}',
      id: 'qMHePZOkA+',
    },
    {
      cell,
    },
  );
export const commandCostHint = (cost: CommandCost) => {
  switch (cost.kind) {
    case 'replaces':
      return translateMessage(
        {
          defaultMessage: '{count, plural, one {Replaces # formula} other {Replaces # formulas}}',
          id: 'RVaZdrVNey',
        },
        {
          count: cost.count,
        },
      );
    case 'clears':
      return translateMessage(
        {
          defaultMessage: '{count, plural, one {Clears # cell} other {Clears # cells}}',
          id: '8MFmFXRzo1',
        },
        {
          count: cost.count,
        },
      );
    case 'becomesText':
      return null;
  }
};
export const COMMAND_HOME_HINTS: Record<CommandHome, (() => string) | null> = {
  toolbar: commandGroupMessages.toolbar,
  topBar: commandGroupMessages.topBar,
  sheetTab: commandGroupMessages.sheetTab,
  pane: null,
};
export const commandsOfferedToAgent = (commands: readonly SearchableCommand[]) =>
  commands
    .filter(({ whyNot, isWeighty }) => whyNot === null && isWeighty !== true)
    .map(
      ({ id, label }) => ({
        id,
        label,
      }),
    );
export const HEADINGS_BY_COMMAND_PREFIX: [prefix: string, heading: () => string][] = [
  ['bar.borders', sheetMessages.borders],
  ['bar.fillColor', sheetMessages.cellColor],
  ['bar.textColor', sheetMessages.textColor],
  ['bar.numberFormat', sheetMessages.cellType],
  ['bar.fewerDecimalPlaces', sheetMessages.cellType],
  ['bar.moreDecimalPlaces', sheetMessages.cellType],
  ['bar.alignVertically', sheetMessages.alignVertically],
  ['bar.align', sheetMessages.align],
  ['bar.fontSize', sheetMessages.fontSize],
  ['bar.insert.', sheetMessages.cellType],
  ['bar.sum.', sheetMessages.calculations],
  ['menu.freeze.', sheetMessages.freeze],
  ['menu.sortRange', sortRangeLabel],
  ['menu.customSort.range', sortRangeLabel],
  ['menu.sort', sortSheetLabel],
  ['menu.customSort.sheet', sortSheetLabel],
  ['menu.conditionalFormatting', CONDITIONAL_FORMATTING_WORDS.conditionalFormatting],
  ['bar.conditionalFormatting', CONDITIONAL_FORMATTING_WORDS.conditionalFormatting],
  ['rules.suggested.', CONDITIONAL_FORMATTING_WORDS.conditionalFormatting],
  ['rules.create', CONDITIONAL_FORMATTING_WORDS.conditionalFormatting],
  ['rules.show', CONDITIONAL_FORMATTING_WORDS.conditionalFormatting],
  ['menu.bold', sheetMessages.formatting],
  ['menu.italic', sheetMessages.formatting],
  ['menu.underline', sheetMessages.formatting],
  ['menu.strikethrough', sheetMessages.formatting],
  ['bar.bold', sheetMessages.formatting],
  ['bar.italic', sheetMessages.formatting],
  ['bar.underline', sheetMessages.formatting],
  ['bar.strikethrough', sheetMessages.formatting],
  ['bar.wrapText', sheetMessages.formatting],
  ['function.', autocompleteFunctionsHeading],
];
export const commandUnderHeading = <Command extends Pick<SearchableCommand, 'label'>>(heading: string, command: Command) => ({
  ...command,
  label: labelWithoutHeading(heading, command.label),
});
export const UNDO_REDO_COMMAND_IDS = new Set(['view.undo', 'view.redo']);
export const SHEETS_COMMAND_PREFIXES = ['sheet.add.', 'sheet.tab.', 'sheet.allSheets'];
export const isSheetsCommand = ({ id }: Pick<SearchableCommand, 'id'>) =>
  SHEETS_COMMAND_PREFIXES.some((prefix) => id.startsWith(prefix));
export const COMMAND_GROUPS: CommandGroupRule[] = [
  {
    heading: commandGroupMessages.thisSheet,
    holds: (command) => command.actsOn === 'sheet' && !isSheetsCommand(command),
  },
  {
    heading: commandGroupMessages.sheets,
    holds: isSheetsCommand,
    toolInNames: sheetWord,
  },
  {
    heading: goToLabel,
    holds: ({ actsOn }) => actsOn === 'goesTo',
    toolInNames: goToLabel,
  },
  {
    heading: commandGroupMessages.view,
    holds: ({ actsOn }) => actsOn === 'view',
  },
  {
    heading: commandGroupMessages.wholeFile,
    holds: ({ actsOn }) => actsOn === 'file',
  },
  {
    heading: commandGroupMessages.open,
    holds: ({ actsOn }) => actsOn === 'opens' || actsOn === 'handsOver',
    isOfWhatOpens: true,
  },
];
export const isSortCommandUnderHeading = ({ id, label }: Pick<SearchableCommand, 'id' | 'label'>) =>
  (id.startsWith('menu.sort') && labelWithoutHeading(sortMenuLabel(), label) !== label) ||
  (id === 'menu.customSort.range' && label === customSortMessages.customSort());
export const SORT_AND_FILTER_COMMAND_ID = 'menu.sortAndFilter';
export const isToolOpenerCommand = ({ actsOn, id }: Pick<SearchableCommand, 'actsOn' | 'id'>) =>
  actsOn === 'opens' && HEADINGS_BY_COMMAND_PREFIX.some(([prefix]) => prefix === id);
export const withoutHome = <Command extends SearchableCommand>({ home, ...command }: Command) => command;
export const commandsUnderHeading = <Command extends Pick<SearchableCommand, 'label'>>(
  heading: string,
  commands: readonly Command[],
) =>
  commands.length === 0
    ? []
    : [
        {
          heading,
          commands: commands.map((command) => commandUnderHeading(heading, command)),
        },
      ];
export const groupCommandsByHeading = <Command extends Pick<SearchableCommand, 'id' | 'label'>>(commands: readonly Command[]) =>
  groupByHeading(new Map<string | null, Command[]>([[null, []]]), commands);
