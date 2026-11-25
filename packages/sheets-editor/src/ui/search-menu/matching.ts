import { columnLetters } from '../../model/a1-references.ts';
import type { ReactNode } from 'react';
import type { IconName } from '../../kit/icon.tsx';
import type { ToolCost } from '../../tools/insert-tools.ts';
/** What a command acts on, which decides how the search menu ranks and groups it. */
export type CommandActsOn = 'cells' | 'activeCell' | 'sheet' | 'file' | 'view' | 'opens' | 'goesTo' | 'handsOver';
/** Where a command that opens something can also be found. */
export type CommandHome = 'toolbar' | 'topBar' | 'sheetTab' | 'pane';
/** What the search of commands reads of a command. */
export interface SearchableCommand {
  id: string;
  label: string;
  /** The label the command had under the tool's former name, shown when that name is searched for. */
  formerLabel?: string;
  otherWords?: readonly string[];
  actsOn: CommandActsOn;
  home?: CommandHome;
  whyNot: string | null;
  isTicked?: boolean;
  isWeighty?: boolean;
}
/** A command the menus and the search field list as a row, and run when it is taken. */
export interface MenuCommand extends SearchableCommand {
  icon: IconName | ReactNode;
  keys?: string;
  keepsOpen?: boolean;
  cost?: CommandCost;
  /** The row Enter would take. */
  isUnderEnter?: boolean;
  run(): void;
}
/** What taking a command costs, shown as its hint. */
export type CommandCost = ToolCost | { kind: 'becomesText' };
/** The words a command is found by: its label and its other words. */
export type CommandWords = Pick<SearchableCommand, 'label' | 'otherWords'>;
/** A text as the search compares it, and its words. */
export interface SearchForm {
  compared: string;
  words: string[];
}
/** A command found, with the place it ranks at (lower comes first). */
export interface RankedCommand<Command> {
  command: Command;
  place: number;
}
/** A command taken by Enter, and the words that were typed then. */
export interface RememberedCommand {
  id: string;
  words: string;
}
/** Whether a typed word matches a word of a command. */
export type WordMatcher = (word: string, otherWord: string) => boolean;
export function trimWordQuotes(word: string) {
  let [start, end] = [0, word.length];
  while (word[start] === "'") start += 1;
  while (end > start && word[end - 1] === "'") end -= 1;
  return word.slice(start, end);
}
export function dropStrayApostrophes(text: string) {
  let [kept, index] = ['', 0];
  while (index < text.length) {
    let next = index;
    while (text[next] === "'") next += 1;
    if (next === index) next += 1;
    else if (!isSearchWordChar(text[index - 1]) || !isSearchWordChar(text[next])) index = next;
    kept += text.slice(index, next);
    index = next;
  }
  return kept.trim();
}
export function searchFormOf(label: string): SearchForm {
  let cached = SEARCH_FORM_CACHE.get(label);
  if (cached !== undefined) return cached;
  if (SEARCH_FORM_CACHE.size >= SEARCH_FORM_CACHE_LIMIT) SEARCH_FORM_CACHE.clear();
  let compared = normalizeSearchText(label);
  let entry = {
    compared,
    words: splitSearchWords(compared),
  };
  SEARCH_FORM_CACHE.set(label, entry);
  return entry;
}
export function queryWordsBeyondIgnored(query: string, ignoredWords: ReadonlySet<string>) {
  let words = splitSearchWords(query);
  return hasQueryWordsBeyondIgnored(query, ignoredWords) ? words.filter((word) => !ignoredWords.has(word)) : words;
}
export function rankCommandMatch({ label, otherWords = [] }: CommandWords, query: string, ignoredWords: ReadonlySet<string>) {
  let [{ compared, words: labelWords }, queryWords] = [searchFormOf(label), queryWordsBeyondIgnored(query, ignoredWords)];
  if (queryWords.length === 0) return null;
  if (compared === query) return MATCH_RANK_EXACT;
  let isOtherWordWhole =
    splitSearchWords(query).length > 1 && otherWords.some((otherWord) => searchFormOf(otherWord).compared === query);
  if (compared.startsWith(query) || isOtherWordWhole) return MATCH_RANK_PREFIX;
  let allQueryWordsIn = (wordsToSearch: readonly string[]) =>
    queryWords.every((queryWord) => wordsToSearch.some((word) => searchWordMatches(queryWord, word)));
  if (allQueryWordsIn(labelWords)) return 2;
  let otherWordsToTry =
    queryWords.length === 1 && queryWords.join('').length <= 2 && splitSearchWords(query).length > 1
      ? otherWords.filter((otherWord) => searchFormOf(otherWord).words.length === 1)
      : otherWords;
  if (allQueryWordsIn([label, ...otherWordsToTry].flatMap((text) => searchFormOf(text).words))) return 3;
  return compared.includes(query) ? MATCH_RANK_SUBSTRING : null;
}
export function wordsWithout(words: readonly string[], removed: readonly string[]) {
  let remaining = [...words];
  for (let word of removed) {
    let index = remaining.indexOf(word);
    if (index !== -1) remaining.splice(index, 1);
  }
  return remaining;
}
export function distinctiveWordsOfCommands(commands: readonly (CommandWords & Pick<SearchableCommand, 'id'>)[]) {
  let wordsByStem = new Map<string, { words: string[]; count: number }>();
  for (let command of commands) {
    let [stem, words] = [commandIdStem(command.id), commandWordsOf(command)];
    let known = wordsByStem.get(stem);
    wordsByStem.set(stem, {
      words: known === undefined ? words : sharedWords(words, known.words),
      count: (known?.count ?? 0) + 1,
    });
  }
  return (command: CommandWords & Pick<SearchableCommand, 'id'>) => {
    let known = wordsByStem.get(commandIdStem(command.id));
    return command.id !== commandIdStem(command.id) && (known?.count ?? 0) > 1
      ? wordsWithout(commandWordsOf(command), known?.words ?? [])
      : commandWordsOf(command);
  };
}
export function commandPlaceRank(command: SearchableCommand, distance: number, queryWords: readonly string[], query: string) {
  let { label } = command;
  let adjustedDistance =
    commandActsOnCells(command) &&
    command.isWeighty !== true &&
    !isTickedVariant(command) &&
    label.includes(':') &&
    normalizeSearchText(label.slice(label.indexOf(':') + 1)) === query
      ? Math.min(distance, MATCH_RANK_PREFIX)
      : distance;
  let tier =
    adjustedDistance <= MATCH_RANK_PREFIX || everyWordInCommand(command, queryWords)
      ? 0
      : commandActsOnCells(command) || command.home === 'toolbar'
        ? 1
        : 2;
  let hasAllWords = queryWords.every((word) => commandWordsOf(command).includes(word));
  return (command.whyNot === null ? 0 : 1000) + tier * 100 + adjustedDistance * 10 + (hasAllWords ? 0 : 1);
}
export function keepVariantsTogether<Command extends SearchableCommand>(ranked: RankedCommand<Command>[]) {
  let samePlace = ranked.filter(({ place }) => place === ranked[0]?.place);
  const firstPlain = samePlace.find(({ command }) => !isTickedVariant(command));
  if (firstPlain === undefined) return ranked;
  let tickedBefore = samePlace.slice(0, samePlace.indexOf(firstPlain));
  let isSameStemVariant = ({ command: { id: otherId, label: otherLabel } }: RankedCommand<Command>) =>
    commandIdStem(otherId) === commandIdStem(firstPlain.command.id) &&
    wordsWithout(searchFormOf(otherLabel).words, searchFormOf(firstPlain.command.label).words).length === 0;
  let kept = [...tickedBefore.filter(isSameStemVariant), ...samePlace.slice(tickedBefore.length)];
  for (let moved of tickedBefore.filter((ticked) => !isSameStemVariant(ticked))) {
    let insertAt = kept
      .map(({ command }) => commandIdStem(command.id))
      .lastIndexOf(commandIdStem(moved.command.id));
    kept.splice(insertAt === -1 ? kept.length : insertAt + 1, 0, moved);
  }
  return [...kept, ...ranked.slice(samePlace.length)];
}
export function commandsForQueryPrefix<Command extends Pick<SearchableCommand, 'id'>>(
  commands: readonly Command[],
  query: string,
): readonly Command[] {
  if (query.startsWith('=')) return [];
  return query.startsWith('#') ? commands.filter(({ id }) => id.includes('#')) : commands;
}
export function commandsWithFormerLabels<Command extends Pick<SearchableCommand, 'label' | 'formerLabel'>>(
  commands: readonly Command[],
  query: string,
  vocabulary: ReadonlySet<string>,
): Command[] {
  let queryWords = queryWordsBeyondIgnored(dropStrayApostrophes(normalizeSearchText(query)), vocabulary);
  return commands.map((command) => {
    let { formerLabel } = command;
    let formerToolWords = searchFormOf(formerLabel?.slice(0, Math.max(formerLabel.indexOf(':'), 0)) ?? '').words;
    let isFormerToolAsked = queryWords.some((word) => formerToolWords.some((formerWord) => searchWordMatches(word, formerWord)));
    return formerLabel !== undefined && isFormerToolAsked
      ? {
          ...command,
          label: formerLabel,
        }
      : command;
  });
}
export function commandsById<Command extends Pick<SearchableCommand, 'id'>>(commands: readonly Command[]): Map<string, Command> {
  let byId = new Map<string, Command>();
  for (let command of commands) if (!byId.has(command.id)) byId.set(command.id, command);
  return byId;
}
export function searchCommands<Command extends SearchableCommand>(
  commands: readonly Command[],
  query: string,
  limit: number,
  vocabulary: ReadonlySet<string> = NO_IGNORED_SEARCH_WORDS,
) {
  let normalized = dropStrayApostrophes(normalizeSearchText(query));
  let queryWords = queryWordsBeyondIgnored(normalized, vocabulary);
  let seen = new Set<string>();
  let asked = commandsWithFormerLabels(commands, query, vocabulary);
  let found = commandsForQueryPrefix(asked, normalized).flatMap((command): RankedCommand<Command>[] => {
    let distance = seen.has(command.id) || seen.has(command.label) ? null : rankCommandMatch(command, normalized, vocabulary);
    seen.add(command.id).add(command.label);
    return distance === null
      ? []
      : [
          {
            command,
            place: commandPlaceRank(command, distance, queryWords, normalized),
          },
        ];
  });
  let stems = new Set(asked.map(({ id }) => commandIdStem(id)));
  let stemsFound = new Set(
    found.flatMap(({ command: { id, whyNot } }) => (stems.has(id) && whyNot === null ? [id] : [])),
  );
  let distinctiveWordsOf = distinctiveWordsOfCommands(asked);
  let matches = found.filter(
    ({ command }) =>
      command.id === commandIdStem(command.id) ||
      !stemsFound.has(commandIdStem(command.id)) ||
      anyWordMatches(queryWords, distinctiveWordsOf(command)),
  );
  matches.sort((first, second) => first.place - second.place);
  let ordered = keepVariantsTogether(matches);
  let topStem = ordered[0] === undefined ? null : commandIdStem(ordered[0].command.id);
  let byId = commandsById(commands);
  return ordered
    .filter(({ command: { id } }, index) => index < limit || commandIdStem(id) === topStem)
    .map(({ command }) => byId.get(command.id) ?? command);
}
export function wordEditDistance(first: string, second: string) {
  let [rowBeforeLast, lastRow]: [number[], number[]] = [
    [],
    Array.from(
      {
        length: second.length + 1,
      },
      (_, index) => index,
    ),
  ];
  for (let i = 1; i <= first.length; i += 1) {
    let row = [i];
    for (let j = 1; j <= second.length; j += 1) {
      let isSwap = first[i - 1] === second[j - 2] && first[i - 2] === second[j - 1];
      row.push(
        Math.min(
          (lastRow[j] ?? 0) + 1,
          (row[j - 1] ?? 0) + 1,
          (lastRow[j - 1] ?? 0) + (first[i - 1] === second[j - 1] ? 0 : 2),
          isSwap ? (rowBeforeLast[j - 2] ?? 0) + 1 : Number.POSITIVE_INFINITY,
        ),
      );
    }
    [rowBeforeLast, lastRow] = [lastRow, row];
  }
  return lastRow[second.length] ?? 0;
}
export function correctedCommandQuery(
  commands: readonly CommandWords[],
  query: string,
  vocabulary: ReadonlySet<string> = NO_IGNORED_SEARCH_WORDS,
) {
  let queryWords = splitSearchWords(dropStrayApostrophes(normalizeSearchText(query)));
  if (queryWords.length > MAX_WORDS_TO_CORRECT || /^[#=]/.test(query.trim())) return null;
  let labelWords = new Set(commands.flatMap(({ label }) => searchFormOf(label).words));
  let knownWords = [...new Set([...labelWords, ...commands.flatMap(commandWordsOf)])].filter(
    (word) => !vocabulary.has(word),
  );
  let corrected = queryWords.map((word) => {
    if (word.length < MIN_WORD_LENGTH_TO_CORRECT || vocabulary.has(word)) return word;
    if (knownWords.some((knownWord) => searchWordMatchesStrictly(word, knownWord))) return word;
    let maxSlips = word.length >= LONG_WORD_LENGTH ? 2 : 1;
    let nearWords = knownWords
      .filter((knownWord) => knownWord[0] === word[0] && Math.abs(knownWord.length - word.length) <= maxSlips)
      .map(
        (knownWord) => ({
          each: knownWord,
          slips: wordEditDistance(word, knownWord),
        }),
      )
      .filter(({ slips }) => slips <= maxSlips);
    nearWords.sort((first, second) => first.slips - second.slips);
    return nearWords[0]?.each ?? word;
  });
  return corrected.join(' ') === queryWords.join(' ') ? null : corrected.join(' ');
}
export function commandsSharingWords<Command extends SearchableCommand>(
  commands: readonly Command[],
  query: string,
  vocabulary: ReadonlySet<string>,
) {
  let normalized = dropStrayApostrophes(normalizeSearchText(query));
  let queryWords = meaningfulQueryWords(normalized, vocabulary);
  if (splitSearchWords(normalized).length < 2) return [];
  let seenLabels = new Set<string>();
  let scored = commandsForQueryPrefix(commandsWithFormerLabels(commands, query, vocabulary), normalized)
    .filter(({ label }) => !seenLabels.has(label) && seenLabels.add(label).size > 0)
    .map(
      (command) => ({
        command,
        inLabel: queryWords.filter((word) => wordsHaveForm(searchFormOf(command.label).words, word)),
        anywhere: queryWords.filter((word) => wordsHaveForm(commandWordsOf(command), word)),
      }),
    );
  let isDistinctive = (word: string) =>
    !isNumberWord(word) && scored.filter(({ inLabel }) => inLabel.includes(word)).length <= MAX_LABELS_PER_DISTINCT_WORD;
  let distinctiveWords = new Set(queryWords.filter(isDistinctive));
  let matches = scored.filter(
    ({ inLabel, anywhere }) =>
      inLabel.some((word) => distinctiveWords.has(word)) || (anywhere.length >= 2 && anywhere.length * 2 >= queryWords.length),
  );
  matches.sort(
    (first, second) =>
      second.anywhere.length === first.anywhere.length
        ? second.inLabel.length - first.inLabel.length
        : second.anywhere.length - first.anywhere.length,
  );
  let byId = commandsById(commands);
  return matches.map(({ command }) => byId.get(command.id) ?? command);
}
export function commandMatchesDistinctWord(
  commands: readonly (CommandWords & Pick<SearchableCommand, 'id'>)[],
  query: string,
  vocabulary: ReadonlySet<string>,
) {
  let queryWords = meaningfulQueryWords(dropStrayApostrophes(normalizeSearchText(query)), vocabulary);
  let sharedWordsByStem = new Map<string, Set<string>>();
  let sharedWordsOfStem = (stem: string) => {
    let known = sharedWordsByStem.get(stem);
    if (known !== undefined) return known;
    let variants = commands.filter(({ id }) => id !== stem && commandIdStem(id) === stem);
    let shared = new Set<string>(
      variants.length < 2
        ? []
        : queryWords.filter((queryWord) => variants.every((variant) => commandHasWord(queryWord, variant))),
    );
    sharedWordsByStem.set(stem, shared);
    return shared;
  };
  return (command: CommandWords & Pick<SearchableCommand, 'id'>) =>
    queryWords.some((word) => !sharedWordsOfStem(commandIdStem(command.id)).has(word) && commandHasWord(word, command));
}
export function commandsFoundByWords<Command extends SearchableCommand>(
  commands: readonly Command[],
  query: string,
  vocabulary: ReadonlySet<string>,
  limit: number,
) {
  let queryWords = splitSearchWords(normalizeSearchText(query)).filter((word) => !vocabulary.has(word));
  let found = commands.flatMap((command) => {
    let commandWords = [command.label, ...(command.otherWords ?? [])].flatMap((text) => searchFormOf(text).words);
    let count = queryWords.filter(
      (queryWord) => commandWords.some((commandWord) => wordsOverlap(commandWord, queryWord)),
    ).length;
    return count === 0 || command.whyNot !== null
      ? []
      : [
          {
            command,
            count,
          },
        ];
  });
  found.sort((first, second) => second.count - first.count);
  return found.slice(0, limit).map(({ command }) => command);
}
export function everyWordInCommand(
  { label, otherWords = [] }: CommandWords,
  words: readonly string[],
  labelWordMatches: WordMatcher = isSameWordStem,
  otherWordMatches: WordMatcher = isSameWordStem,
) {
  let isInOtherWords = (word: string) =>
    otherWords.some((otherWord) => {
      let [onlyWord, ...moreWords] = searchFormOf(otherWord).words;
      return moreWords.length === 0 && onlyWord !== undefined && otherWordMatches(word, onlyWord);
    });
  return words.every(
    (word) =>
      searchFormOf(label).words.some((labelWord) => labelWordMatches(word, labelWord)) || isInOtherWords(word),
  );
}
export function hasOtherNumberWord(id: string, words: readonly string[]) {
  let [kind = '', index = ''] = id.split('.').slice(2);
  let ownNumbers = new Set([index, ...(kind === 'columns' ? [columnLetters(Number(index) - 1).toLowerCase()] : [])]);
  return words.some((word) => (/^\p{N}+$/u.test(word) || (kind === 'columns' && /^[a-z]$/.test(word))) && !ownNumbers.has(word));
}
export function isCommandNamedFully(command: SearchableCommand, query: string, queryWords: readonly string[]) {
  let { id, label, otherWords = [], actsOn, isTicked } = command;
  let labelAfterColon = splitSearchWords(normalizeSearchText(label.slice(label.indexOf(':') + 1))).join(' ');
  if (queryWords.every((word) => /^\p{N}+$/u.test(word)))
    return id !== commandIdStem(id) && label.includes(':') && labelAfterColon === queryWords.join(' ');
  let [firstWord = '', ...restWords] = searchFormOf(label).words;
  let isLabelWord = (word: string) =>
    [firstWord, ...restWords].some((labelWord) => searchWordMatchesStrictly(word, labelWord));
  if (
    splitSearchWords(query)
      .filter((word) => queryWords.includes(word) || isLabelWord(word))
      .join('').length < MATCH_RANK_OTHER_WORDS
  )
    return false;
  let labelStartsWithQuery = [firstWord, ...restWords].join(' ').startsWith(splitSearchWords(query).join(' '));
  let actsOnSheetOrFile = actsOn === 'sheet' || actsOn === 'file';
  let isNamed = actsOnSheetOrFile
    ? labelStartsWithQuery ||
      (queryWords.some((word) => searchWordMatchesStrictly(word, firstWord)) &&
        queryWords.every(
          (word) =>
            searchWordMatchesStrictly(word, firstWord) || restWords.some((restWord) => isInflectionOf(word, restWord)),
        ))
    : queryWords.every(isLabelWord);
  if (isTicked !== undefined && id === commandIdStem(id)) return isNamed;
  let isFreezeCount = id.startsWith('menu.freeze.') && !id.endsWith('.0');
  if (id.startsWith('menu.freeze.') && !isFreezeCount && everyWordInCommand(command, queryWords, searchWordMatchesStrictly, isInflectionOf))
    return true;
  if (!isFreezeCount && otherWords.some((otherWord) => searchFormOf(otherWord).compared === query)) return true;
  let labelIsQuery = [firstWord, ...restWords].join(' ') === splitSearchWords(query).join(' ');
  if (isFreezeCount && !labelIsQuery && hasOtherNumberWord(id, splitSearchWords(query))) return false;
  if (actsOnSheetOrFile) return isNamed;
  if (labelStartsWithQuery) return true;
  return everyWordInCommand(command, queryWords, commandActsOnCells(command) ? searchWordMatchesStrictly : isInflectionOf, isInflectionOf);
}
export function isClearTopCommand(
  found: readonly SearchableCommand[],
  query: string,
  commands: readonly SearchableCommand[],
  vocabulary: ReadonlySet<string>,
) {
  let [top, ...rest] = found;
  let normalized = dropStrayApostrophes(normalizeSearchText(query));
  let topDistance = top === undefined ? null : rankCommandMatch(top, normalized, vocabulary);
  if (top === undefined || topDistance === null || topDistance === MATCH_RANK_SUBSTRING) return false;
  if (topDistance === MATCH_RANK_EXACT) return true;
  if (!hasQueryWordsBeyondIgnored(normalized, vocabulary)) return false;
  if (!isCommandNamedFully(top, normalized, queryWordsBeyondIgnored(normalized, vocabulary))) return false;
  let [queryWords, distinctiveWordsOf] = [queryWordsBeyondIgnored(normalized, vocabulary), distinctiveWordsOfCommands(commands)];
  let topWords = distinctiveWordsOf(top);
  let lastWordInLabel = searchFormOf(top.label).words.includes(splitSearchWords(normalized).at(-1) ?? '');
  let isOtherOpenCandidate = (command: SearchableCommand) =>
    command.whyNot === null && !isOpeningCommand(command) && normalizeSearchText(command.label).startsWith(normalized);
  let isTopUnrivalled = lastWordInLabel || !rest.some(isOtherOpenCandidate);
  if (isOpeningCommand(top) && !top.label.includes(':') && isTopUnrivalled) return true;
  let rivalsTop = (other: SearchableCommand) => {
    let distance = other.whyNot === null ? rankCommandMatch(other, normalized, vocabulary) : null;
    if (distance === null) return false;
    if (commandIdStem(other.id) !== commandIdStem(top.id)) {
      let otherLabelWords = searchFormOf(other.label).words;
      let isSameValueKind =
        commandActsOnCells(top) &&
        commandActsOnCells(other) &&
        other.label.includes(':') &&
        normalizeSearchText(other.label.slice(other.label.indexOf(':') + 1)).startsWith(normalized);
      return distance <= topDistance || isSameValueKind || queryWords.every((word) => otherLabelWords.includes(word));
    }
    if (distance !== topDistance) return false;
    let [otherWords, topWordsOfOther] = [searchFormOf(other.label).words, searchFormOf(top.label).words];
    let coversTop = wordsWithout(topWordsOfOther, otherWords).length === 0;
    return (isTickedVariant(other) || anyWordMatches(queryWords, distinctiveWordsOf(other))) && !coversTop;
  };
  return anyWordMatches(queryWords, topWords) && !rest.some(rivalsTop);
}
export function labelMatchesWordsExactly({ label }: Pick<SearchableCommand, 'label'>, query: string, vocabulary: ReadonlySet<string>) {
  let queryWords = queryWordsBeyondIgnored(dropStrayApostrophes(normalizeSearchText(query)), vocabulary);
  let meaningfulWordsOf = (text: string) =>
    searchFormOf(text).words.filter((word) => !vocabulary.has(word));
  let isSameWords = (words: readonly string[]) =>
    words.length === queryWords.length &&
    words.every((word, index) => isSameWordOrPlural(queryWords[index] ?? '', word));
  let colonAt = label.indexOf(':');
  let [beforeColon, afterColon] = [meaningfulWordsOf(label.slice(0, Math.max(colonAt, 0))), meaningfulWordsOf(label.slice(colonAt + 1))];
  return isSameWords([...beforeColon, ...afterColon]) || (beforeColon.length > 0 && isSameWords([...afterColon, ...beforeColon]));
}
export function labelMatchesWordsInOrder(command: Pick<SearchableCommand, 'label' | 'formerLabel'>, query: string, vocabulary: ReadonlySet<string>) {
  let { label } = commandsWithFormerLabels([command], query, vocabulary)[0] ?? command;
  if (QUESTION_MARKS.test(query) && !QUESTION_MARKS.test(label)) return false;
  let queryWords = splitSearchWords(dropStrayApostrophes(normalizeSearchText(query)));
  if (queryWords.every((word) => vocabulary.has(word))) return false;
  let isQueryWord = (word: string, queryWord: string = '') =>
    queryWord === word || (isSameWordOrPlural(queryWord, word) && (!vocabulary.has(word) || vocabulary.has(queryWord)));
  let hasQueryWordsInOrder = (words: readonly string[]) => {
    let matched = 0;
    for (let word of words)
      if (isQueryWord(word, queryWords[matched])) matched += 1;
      else if (!vocabulary.has(word)) return false;
    return matched === queryWords.length;
  };
  let colonAt = label.indexOf(':');
  let [beforeColon, afterColon] = [searchFormOf(label.slice(0, Math.max(colonAt, 0))).words, searchFormOf(label.slice(colonAt + 1)).words];
  return hasQueryWordsInOrder([...beforeColon, ...afterColon]) || (beforeColon.length > 0 && hasQueryWordsInOrder([...afterColon, ...beforeColon]));
}
export const COMMANDS_TO_CONFIRM = new Set([
  'menu.deleteRows',
  'menu.deleteColumns',
  'sheet.tab.delete',
  'menu.clearContents',
  'menu.clearFormatting',
  'menu.mergeCells',
  'bar.mergeCells',
  'menu.paste',
  'menu.pasteValuesOnly',
]);
export const isCommandToConfirm = ({ id }: Pick<SearchableCommand, 'id'>) => COMMANDS_TO_CONFIRM.has(id);
export const commandActsOnCells = ({ actsOn }: Pick<SearchableCommand, 'actsOn'>) => actsOn === 'cells' || actsOn === 'activeCell';
export const normalizeSearchText = (text: string) =>
  text.normalize('NFD').replaceAll(/\p{M}/gu, '').toLowerCase().replaceAll('’', "'").trim();
export const isSearchWordChar = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}]/u.test(char);
export const splitSearchWords = (text: string) =>
  text
    .split(/[^\p{L}\p{N}']+/u)
    .map(trimWordQuotes)
    .filter((word) => word !== '');
export const SEARCH_FORM_CACHE = new Map<string, SearchForm>();
export const SEARCH_FORM_CACHE_LIMIT = 8000;
export const hasSearchWords = (query: string) => splitSearchWords(normalizeSearchText(query)).length > 0;
export const MATCH_RANK_EXACT = 0;
export const MATCH_RANK_PREFIX = 1;
export const MATCH_RANK_SUBSTRING = 4;
export const MATCH_RANK_OTHER_WORDS = 3;
export const searchWordMatches = (queryWord: string, labelWord: string) =>
  labelWord.startsWith(queryWord) || isSameWordStem(queryWord, labelWord);
export const isSameWordStem = (word: string, stem: string) =>
  word === stem || (stem.length > 3 && word.startsWith(stem) && word.length - stem.length <= 3) || (stem.length === 3 && word === `${stem}s`);
export const INFLECTION_ENDINGS = new Set(['s', 'es', "'s", 'd', 'ed', 'ing']);
export const isInflectionOf = (word: string, stem: string) =>
  isSameWordStem(word, stem) && (word === stem || INFLECTION_ENDINGS.has(word.slice(stem.length)));
export const searchWordMatchesStrictly = (queryWord: string, labelWord: string) =>
  labelWord.startsWith(queryWord) || isInflectionOf(queryWord, labelWord);
export const NO_IGNORED_SEARCH_WORDS: ReadonlySet<string> = new Set<string>();
export const hasQueryWordsBeyondIgnored = (query: string, ignoredWords: ReadonlySet<string>) =>
  splitSearchWords(query).some((word) => word.length > 1 && !ignoredWords.has(word));
export const commandIdStem = (id: string) => {
  let parts = id.split('.');
  return parts.length > 2 ? parts.slice(0, -1).join('.') : id;
};
export const sharedWords = (words: readonly string[], otherWords: readonly string[]) => wordsWithout(words, wordsWithout(words, otherWords));
export const commandWordsOf = ({ label, otherWords = [] }: CommandWords) =>
  [label, ...otherWords].flatMap((text) => searchFormOf(text).words);
export const anyWordMatches = (queryWords: readonly string[], commandWords: readonly string[]) =>
  queryWords.some((queryWord) => commandWords.some((commandWord) => searchWordMatches(queryWord, commandWord)));
export const queryMatchesOtherWords = ({ otherWords = [] }: Pick<SearchableCommand, 'otherWords'>, query: string) =>
  anyWordMatches(
    splitSearchWords(normalizeSearchText(query)),
    otherWords.flatMap((text) => searchFormOf(text).words),
  );
export const isTickedVariant = ({ id, isTicked }: Pick<SearchableCommand, 'id' | 'isTicked'>) => isTicked === true && id !== commandIdStem(id);
export const MIN_WORD_LENGTH_TO_CORRECT = 5;
export const LONG_WORD_LENGTH = 9;
export const MAX_WORDS_TO_CORRECT = 5;
export const oneCommandPerStem = <Command extends Pick<SearchableCommand, 'id'>>(commands: readonly Command[]) =>
  commands.filter(
    ({ id }, index) =>
      commands.findIndex((other) => commandIdStem(other.id) === commandIdStem(id)) === index,
  );
export const MAX_LABELS_PER_DISTINCT_WORD = 3;
export const isNumberWord = (word: string) => /^\p{N}+$/u.test(word);
export const wordsHaveForm = (words: readonly string[], word: string) =>
  words.some((otherWord) => isInflectionOf(word, otherWord));
export const MAX_QUERY_WORDS = 12;
export const meaningfulQueryWords = (query: string, vocabulary: ReadonlySet<string>) =>
  [...new Set(queryWordsBeyondIgnored(query, vocabulary))]
    .filter((word) => word.length > 2 || isNumberWord(word))
    .slice(0, MAX_QUERY_WORDS);
export const commandHasWord = (word: string, command: CommandWords) =>
  commandWordsOf(command).some((commandWord) => (isNumberWord(word) ? commandWord === word : searchWordMatches(word, commandWord)));
export const wordsOverlap = (word: string, otherWord: string) =>
  word === otherWord || (Math.min(word.length, otherWord.length) > 3 && (word.startsWith(otherWord) || otherWord.startsWith(word)));
export const isOpeningCommand = ({ actsOn, id, isWeighty }: Pick<SearchableCommand, 'actsOn' | 'id' | 'isWeighty'>) =>
  isWeighty !== true && (actsOn === 'opens' || actsOn === 'goesTo' || (actsOn === 'view' && !id.startsWith('menu.')));
export const isSameWordOrPlural = (word: string, otherWord: string) =>
  word === otherWord || word === `${otherWord}s` || `${word}s` === otherWord;
export const QUESTION_MARKS = /[?;\u00bf\u037e\u055e\u061f\u203d\u2047-\u2049\u2753\u2754\u2e2e\ufe56\uff1f]/u;
export const commandToRunForQuery = <Command extends SearchableCommand>(
  found: readonly Command[],
  query: string | null,
  commands: readonly SearchableCommand[] = found,
  vocabulary: ReadonlySet<string> = NO_IGNORED_SEARCH_WORDS,
) => {
  let [top] = found;
  if (top === undefined || top.whyNot !== null) return null;
  if (query === null) return top.isWeighty === true ? null : top;
  let foundAsked = commandsWithFormerLabels(found, query, vocabulary);
  let commandsAsked = commandsWithFormerLabels(commands, query, vocabulary);
  return (top.isWeighty === true && !labelMatchesWordsExactly(foundAsked[0] ?? top, query, vocabulary)) ||
    !isClearTopCommand(foundAsked, query, commandsAsked, vocabulary)
    ? null
    : top;
};
export const isRememberedCommandOutOfUse = (
  remembered: RememberedCommand | null,
  words: string,
  commands: readonly Pick<SearchableCommand, 'id' | 'whyNot'>[],
) => remembered?.words === words && commands.some(({ id, whyNot }) => id === remembered.id && whyNot !== null);
