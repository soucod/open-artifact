import { ContextMenu } from '../../kit/context-menu.tsx';
import { translateMessage } from '../../i18n/messages.ts';
import { truncateGraphemes } from '../../i18n/grid-action-labels.ts';
export function wordsToFind(typed: string) {
  const words = typed.trim();
  if (findLeadWords().includes(words.toLowerCase())) return null;
  const leadWords = findLeadWords()
    .filter((leadWord) => words.toLowerCase().startsWith(`${leadWord} `))
    .reduce((longest, leadWord) => (leadWord.length > longest.length ? leadWord : longest), '');
  return leadWords === '' ? null : words.slice(leadWords.length).trim();
}
interface FindInSheetItemProps {
  words: string;
  isUnderEnter: boolean;
  hint: string;
  onAsked(): void;
}
export function FindInSheetItem({ words, isUnderEnter = false, hint, onAsked }: FindInSheetItemProps) {
  return <ContextMenu.Item icon="Search" {...(hint !== undefined && {
      hint,
    })} {...(isUnderEnter && {
      className: 'sheet-row-under-enter',
    })} onClick={onAsked}>{findInSheetLabel(words)}</ContextMenu.Item>;
}
export const FIND_WORDS_SHOWN_LENGTH = 16;
export const findInSheetLabel = (words: string) =>
  translateMessage(
    {
      defaultMessage: 'Find “{words}” in this sheet',
      id: 'j5pshFJ6HW',
    },
    {
      words: `⁨${truncateGraphemes(words, FIND_WORDS_SHOWN_LENGTH)}⁩`,
    },
  );
export const findLeadWords = () =>
  translateMessage({
    defaultMessage: 'find, search for, search, look for',
    id: 'jJJnRLlSuy',
  })
    .split(/[,،、，]/)
    .map((leadWord) => leadWord.trim().toLowerCase())
    .filter((leadWord) => leadWord !== '');
