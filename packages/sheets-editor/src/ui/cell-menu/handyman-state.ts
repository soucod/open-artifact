import { groupCommandsByHeading } from '../search-menu/command-groups.ts';
import { commandToRunForQuery } from '../search-menu/matching.ts';
import type { CommandsUnderHeading } from '../search-menu/command-groups.ts';
import type { MenuCommand } from '../search-menu/matching.ts';
/** The rule the agent writes from the words typed, when the words ask for one. */
export type HandymanRule = { is: 'awaited' } | { is: 'notWritten' } | { is: 'written'; landedAtMs: number };
/** The agent's answer to the words typed in the menu: the commands it named, and those the words find. */
export interface HandymanAnswered {
  is: 'answered';
  words: string;
  commands: MenuCommand[];
  makesRule: boolean;
  foundByWords: MenuCommand[];
  landedAtMs: number;
  /** Whether the pointer may take rows yet; not until it moves, when the answer lands under it. */
  heedsPointer: boolean;
  /** Ids of the commands taken from the answer. */
  taken: Set<string>;
  rule: HandymanRule;
}
/** Where the agent stands on finding the tools for the words typed in the menu. */
export type HandymanState =
  | { is: 'resting' }
  | { is: 'asking'; words: string; ask: number }
  | HandymanAnswered
  | { is: 'failed'; words: string };
export type HandymanAction =
  | { kind: 'asked'; words: string; ask: number }
  | { kind: 'answered'; ask: number; atMs: number; isUnderMouse: boolean; commands: MenuCommand[]; makesRule: boolean; foundByWords: MenuCommand[] }
  | { kind: 'gaveNoAnswer'; ask: number }
  | { kind: 'stopped' }
  | { kind: 'typed'; typed: string }
  | { kind: 'pointerMoved' }
  | { kind: 'ruleStands'; as: HandymanRule }
  | { kind: 'ruleLetGo' }
  | { kind: 'rowTaken'; id: string };
/** What Enter does among the agent's answer. */
export type HandymanEnterAction = { does: 'askAgain' | 'nothing' | 'keepRule' | 'finish' } | { does: 'take'; command: MenuCommand };
/** A command entered from what was typed, to tell whether Enter is pressed on it again. */
export interface EnteredCommand {
  commandId: string;
  label: string;
  words: string;
  isWeighty: boolean;
  isItsLabelAlone: boolean;
}
export type CommandAskedAgain = Pick<EnteredCommand, 'commandId' | 'label' | 'words'>;
/** What Enter means for the words typed: a command, an ask, or nothing. */
export type EnterMeaningKind = 'none' | 'command' | 'ask';
/** What Enter means now, since when, and what it meant before. */
export interface EnterMeaning {
  kind: EnterMeaningKind;
  sinceMs: number;
  inPlaceOf: EnterMeaningKind;
}
export function withCommandsOfNow(handyman: HandymanState, commands: readonly MenuCommand[], whyNotOf: (label: string) => string | null): HandymanState {
  if (handyman.is !== 'answered') return handyman;
  const commandById = new Map(commands.map((command) => [command.id, command]));
  const withCurrent = (answered: readonly MenuCommand[]) =>
    answered.map(
      (command): MenuCommand =>
        commandById.get(command.id) ?? {
          ...command,
          whyNot: whyNotOf(command.label),
          ...(command.isTicked !== undefined && {
            isTicked: false,
          }),
        },
    );
  return {
    ...handyman,
    commands: withCurrent(handyman.commands),
    foundByWords: withCurrent(handyman.foundByWords),
  };
}
export function handymanReducer(state: HandymanState, action: HandymanAction): HandymanState {
  switch (action.kind) {
    case 'asked':
      return {
        is: 'asking',
        words: action.words.trim(),
        ask: action.ask,
      };
    case 'answered': {
      if (state.is !== 'asking' || state.ask !== action.ask) return state;
      const { commands, makesRule, foundByWords, atMs, isUnderMouse } = action;
      return {
        is: 'answered',
        words: state.words,
        commands,
        makesRule,
        foundByWords,
        landedAtMs: atMs,
        heedsPointer: !isUnderMouse,
        taken: new Set<string>(),
        rule: {
          is: 'awaited',
        },
      };
    }
    case 'gaveNoAnswer':
      return state.is === 'asking' && state.ask === action.ask
        ? {
            is: 'failed',
            words: state.words,
          }
        : state;
    case 'stopped':
      return HANDYMAN_AT_REST;
    case 'typed':
      return state.is === 'resting' || state.words === action.typed.trim() ? state : HANDYMAN_AT_REST;
    case 'pointerMoved':
      return state.is === 'answered' && !state.heedsPointer
        ? {
            ...state,
            heedsPointer: true,
          }
        : state;
    case 'ruleStands':
      return state.is === 'answered' && state.makesRule
        ? {
            ...state,
            rule: action.as,
          }
        : state;
    case 'ruleLetGo':
      if (state.is !== 'answered' || !state.makesRule) return state;
      return state.commands.length === 0
        ? HANDYMAN_AT_REST
        : {
            ...state,
            makesRule: false,
            rule: {
              is: 'awaited',
            },
          };
    case 'rowTaken': {
      if (state.is !== 'answered') return state;
      const takenOfOtherFamilies = [...state.taken].filter((id) => commandFamilyId(id) !== commandFamilyId(action.id));
      return {
        ...state,
        taken: new Set([...takenOfOtherFamilies, action.id]),
      };
    }
  }
}
export function handymanSections(handyman: HandymanState, onRowTaken: (id: string) => void): CommandsUnderHeading<MenuCommand>[] {
  const sections = handymanCommandGroups(handyman, onRowTaken);
  const enterAction = handymanEnterAction(handyman, sections, Number.POSITIVE_INFINITY);
  if (enterAction.does !== 'take') return sections;
  return sections.map(
    ({ heading, commands }) => ({
      heading,
      commands: commands.map(
        (command) =>
          command === enterAction.command
            ? Object.assign({}, command, {
                isUnderEnter: true,
              })
            : command,
      ),
    }),
  );
}
export function handymanCommandGroups(handyman: HandymanState, onRowTaken: (id: string) => void): CommandsUnderHeading<MenuCommand>[] {
  if (handyman.is !== 'answered') return [];
  if (isHandymanEmptyHanded(handyman)) return groupCommandsByHeading(handyman.foundByWords);
  if (!doesHandymanAnswerSeveral(handyman)) return groupCommandsByHeading(handyman.commands);
  return groupCommandsByHeading(
    handyman.commands.map(
      (command) =>
        KEEPS_MENU_OPEN_COMMAND_PATTERNS.some((pattern) => pattern.test(command.id))
          ? Object.assign({}, command, {
              keepsOpen: true,
              ...(!DECIMAL_PLACES_COMMAND_PATTERN.test(command.id) && {
                isTicked: isHandymanCommandTicked(handyman, command),
              }),
              run() {
                if (isHandymanCommandTicked(handyman, command)) return;
                onRowTaken(command.id);
                command.run();
              },
            })
          : command,
    ),
  );
}
export function handymanEnterAction(
  handyman: HandymanState,
  sections: readonly CommandsUnderHeading<MenuCommand>[],
  nowMs: number,
): HandymanEnterAction {
  if (handyman.is === 'failed')
    return {
      does: 'askAgain',
    };
  if (handyman.is !== 'answered' || !hasAnswerSettled(handyman, nowMs))
    return {
      does: 'nothing',
    };
  if (isHandymanEmptyHanded(handyman))
    return {
      does: 'nothing',
    };
  const commands = sections.flatMap(({ commands: commandsOfSection }) => commandsOfSection);
  const takenFamilies = new Set([...handyman.taken].map(commandFamilyId));
  const isOfSeveral = doesHandymanAnswerSeveral(handyman);
  const takeable = commands.filter(
    ({ id, isTicked, whyNot }) =>
      whyNot === null && !takenFamilies.has(commandFamilyId(id)) && !(isOfSeveral && isTicked === true),
  );
  if (takeable.length === 0 && shouldAskHandymanAgain(handyman))
    return {
      does: 'askAgain',
    };
  if (takeable.length === 0 && handyman.makesRule)
    return {
      does: hasRuleSettled(handyman, nowMs) ? 'keepRule' : 'nothing',
    };
  if (takeable.length === 0 && commands.length > 0)
    return {
      does: handyman.taken.size > 0 ? 'finish' : 'nothing',
    };
  const command = commandToRunForQuery(takeable, null);
  return command === null
    ? {
        does: 'nothing',
      }
    : {
        does: 'take',
        command,
      };
}
export const ANSWER_SETTLE_MS = 540;
export const ENTER_MEANING_GRACE_MS = 300;
export const HANDYMAN_AT_REST: HandymanState = {
  is: 'resting',
};
export const commandFamilyId = (id: string) => {
  const parts = id.split('.');
  return parts.length > 2 ? parts.slice(0, -1).join('.') : id;
};
export const KEEPS_MENU_OPEN_COMMAND_PATTERNS = [
  /^(menu|bar)\.(bold|italic|underline|strikethrough)$/,
  /^bar\.(wrapText|showGridlines|moreDecimalPlaces|fewerDecimalPlaces)$/,
  /^bar\.(align|alignVertically|fontSize|textColor|fillColor|borders)\./,
  /^bar\.numberFormat\.(?!customFormat$)/,
];
export const DECIMAL_PLACES_COMMAND_PATTERN = /^bar\.(more|fewer)DecimalPlaces$/;
export const isHandymanCommandTicked = (handyman: Pick<HandymanAnswered, 'taken'>, { id, isTicked }: Pick<MenuCommand, 'id' | 'isTicked'>) =>
  !DECIMAL_PLACES_COMMAND_PATTERN.test(id) && (isTicked === true || handyman.taken.has(id));
export const isHandymanEmptyHanded = (handyman: HandymanState) =>
  handyman.is === 'failed' || (handyman.is === 'answered' && handyman.commands.length === 0 && !handyman.makesRule);
export const doesHandymanAnswerSeveral = (handyman: HandymanState) =>
  handyman.is === 'answered' &&
  new Set(handyman.commands.map(({ id }) => commandFamilyId(id))).size + (handyman.makesRule ? 1 : 0) > 1;
export const hasAnswerSettled = (handyman: HandymanState, nowMs: number) =>
  handyman.is !== 'answered' || nowMs - handyman.landedAtMs >= ANSWER_SETTLE_MS;
export const hasRuleSettled = (handyman: HandymanState, nowMs: number) =>
  handyman.is === 'answered' && handyman.rule.is === 'written' && nowMs - handyman.rule.landedAtMs >= ANSWER_SETTLE_MS;
export const shouldAskHandymanAgain = (handyman: HandymanState) =>
  handyman.is === 'failed' || (handyman.is === 'answered' && handyman.makesRule && handyman.rule.is === 'notWritten');
export const isCommandAskedAgain = (asked: CommandAskedAgain | null, { commandId, label, words }: CommandAskedAgain) =>
  asked?.commandId === commandId && asked.label === label && asked.words === words;
export const enterOnTypedCommand = (asked: CommandAskedAgain | null, entered: EnteredCommand, isMeaningSettled: boolean) => {
  if (entered.isWeighty && !entered.isItsLabelAlone && !isCommandAskedAgain(asked, entered)) return 'asks';
  return isMeaningSettled ? 'takes' : 'drops';
};
export const doesKeyDropAskedAgain = (key: string, isRepeat: boolean) =>
  key !== 'Enter' && !isRepeat && !/^(Shift|Control|Alt|Meta)$/.test(key);
export const NO_ENTER_MEANING: EnterMeaning = {
  kind: 'none',
  sinceMs: Number.NEGATIVE_INFINITY,
  inPlaceOf: 'none',
};
export const nextEnterMeaning = (meaning: EnterMeaning, kind: EnterMeaningKind, nowMs: number): EnterMeaning => {
  if (meaning.kind === kind) return meaning;
  const followsAsk = meaning.kind === 'none' && meaning.inPlaceOf === 'ask' && nowMs - meaning.sinceMs < ENTER_MEANING_GRACE_MS;
  return {
    kind,
    sinceMs: nowMs,
    inPlaceOf: followsAsk ? 'ask' : meaning.kind,
  };
};
export const isEnterMeaningSettled = ({ kind, sinceMs, inPlaceOf }: EnterMeaning, nowMs: number) =>
  kind !== 'command' || inPlaceOf !== 'ask' || nowMs - sinceMs >= ENTER_MEANING_GRACE_MS;
