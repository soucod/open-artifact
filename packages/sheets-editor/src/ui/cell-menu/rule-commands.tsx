import type { RuleInIds } from '@open-artifact/sheets-core';
import type { MenuCommand, SearchableCommand } from '../search-menu/matching.ts';
import type { ShownSuggestion } from '../../format/conditional/pane-state.ts';
import { CONDITIONAL_FORMATTING_WORDS, wordsOfRuleEntry } from '../../messages/conditional-format.ts';
import { toolSearchWords } from '../../tools/search-words.ts';
import { commandSearchSynonyms } from '../../messages/command-search.ts';
import { joinMessageParts } from '../../i18n/messages.ts';
import { RuleSample } from '../../format/conditional/rule-samples.tsx';
/** A rule the menu suggests for the selected cells, offered as a command. */
export interface SuggestedRuleCommand extends MenuCommand {
  /** The suggested rules as JSON, to tell one suggestion from another. */
  gives: string;
  /** Which cells the rule is for, in words. */
  where: string;
  /** Shows the rule on the cells while the row is pointed at, or stops showing it. */
  tryOnCells(isOn: boolean): void;
}
/** What happens when a suggested rule is pointed at or taken. */
export interface SuggestedRuleActions {
  onPointedAt(rules: RuleInIds[] | null): void;
  onTaken(rules: RuleInIds[]): void;
}
/** How the rules are opened from the menu: to write a new one, or to list them in the pane. */
export type RulesAskedFor = 'newRule' | 'list';
export function isAboutConditionalFormatting(typed: string) {
  const ruleWords = ruleCommandOtherWords().flatMap(searchWordsOf);
  return searchWordsOf(typed).every((typedWord) => ruleWords.some((ruleWord) => ruleWord.startsWith(typedWord)));
}
export function suggestedRulesFirst<Command extends Pick<SearchableCommand, 'id'>>(commands: Command[], typed: string): Command[] {
  if (!isAboutConditionalFormatting(typed)) return commands;
  const ruleCommandsInOrder = [...commands.filter(isSuggestedRuleCommand), ...commands.filter(isRuleCommand)];
  let nextIndex = 0;
  return commands.map(
    (command) => (isSuggestedRuleCommand(command) || isRuleCommand(command) ? (ruleCommandsInOrder[nextIndex++] ?? command) : command),
  );
}
export const SUGGESTED_RULE_COMMAND_PREFIX = 'rules.suggested.';
export const RULE_COMMAND_IDS: ReadonlySet<string> = new Set(['rules.create', 'rules.show']);
export const isSuggestedRuleCommand = ({ id }: Pick<SearchableCommand, 'id'>) => id.startsWith(SUGGESTED_RULE_COMMAND_PREFIX);
export const isRuleCommand = ({ id }: Pick<SearchableCommand, 'id'>) => RULE_COMMAND_IDS.has(id);
export const ruleCommandOtherWords = () => [
  CONDITIONAL_FORMATTING_WORDS.conditionalFormatting(),
  ...toolSearchWords('conditionalFormatting'),
  ...commandSearchSynonyms('conditionalFormatting'),
];
export const suggestedRuleCommands = (suggestions: readonly ShownSuggestion[], { onPointedAt, onTaken }: SuggestedRuleActions) =>
  suggestions.map(({ rules, toSay }, index): SuggestedRuleCommand => {
    const { what, where } = wordsOfRuleEntry(toSay);
    return {
      id: `${SUGGESTED_RULE_COMMAND_PREFIX}${index}`,
      label: joinMessageParts(what),
      otherWords: ruleCommandOtherWords(),
      icon: <RuleSample rules={toSay} isSwatch />,
      actsOn: 'cells',
      whyNot: null,
      isWeighty: true,
      gives: JSON.stringify(rules),
      where,
      tryOnCells: (isOn: boolean) => onPointedAt(isOn ? rules : null),
      run: () => onTaken(rules),
    };
  });
export const ruleCommands = (onRulesAsked: (askedFor: RulesAskedFor) => void): MenuCommand[] => [
  {
    id: 'rules.create',
    label: CONDITIONAL_FORMATTING_WORDS.createRule(),
    otherWords: ruleCommandOtherWords(),
    icon: 'Add',
    actsOn: 'cells',
    whyNot: null,
    isWeighty: true,
    run: () => onRulesAsked('newRule'),
  },
  {
    id: 'rules.show',
    label: CONDITIONAL_FORMATTING_WORDS.showRules(),
    otherWords: ruleCommandOtherWords(),
    icon: 'ConditionalFormat',
    actsOn: 'opens',
    home: 'pane',
    whyNot: null,
    run: () => onRulesAsked('list'),
  },
];
export const searchWordsOf = (text: string) => text.trim().toLocaleLowerCase().split(/\s+/);
