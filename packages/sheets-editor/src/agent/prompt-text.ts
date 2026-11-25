import type { AgentPrompt } from '../format/conditional/agent-prompts.ts';
/** What kind of character came before, as far as it decides which joiners and selectors may follow. */
export type CharClassForJoiners = 'pictograph' | 'keycap' | 'han' | 'joining';
/** The character class before, or a pictograph that already took its presentation selector. */
export type CharClassBefore = CharClassForJoiners | 'pictographWithSelector';
export let ZERO_WIDTH_NON_JOINER: number;
export let ZERO_WIDTH_JOINER: number;
export let EMOJI_PRESENTATION_SELECTOR: number;
export function isOverByteLimit(text: string, maxBytes: number): boolean {
  if (text.length > maxBytes) return true;
  return text.length * 3 > maxBytes && new TextEncoder().encode(text).length > maxBytes;
}
export function joinerFitsAfter(charClassBefore: CharClassBefore | null, codePoint: number): boolean | null {
  if (codePoint === ZERO_WIDTH_JOINER)
    return charClassBefore === 'pictograph' || charClassBefore === 'pictographWithSelector' || charClassBefore === 'joining';
  if (codePoint === ZERO_WIDTH_NON_JOINER) return charClassBefore === 'joining';
  if (codePoint >= 65024 && codePoint <= 65039)
    return (
      charClassBefore === 'pictograph' || charClassBefore === 'han' || (charClassBefore === 'keycap' && codePoint === EMOJI_PRESENTATION_SELECTOR)
    );
  return codePoint >= 917760 && codePoint <= 917999 ? charClassBefore === 'han' : null;
}
export function cleanTextForAgent(text: string, maxLength: number = Number.POSITIVE_INFINITY): string {
  let cleaned = '';
  let charClassBefore: CharClassBefore | null = null;
  let joinersKept = 0;
  for (let char of text.slice(0, maxLength)) {
    let codePoint = char.codePointAt(0) ?? 0;
    let fitsAfter = joinerFitsAfter(charClassBefore, codePoint);
    if (fitsAfter === null && !INVISIBLE_CHAR_PATTERN.test(char)) {
      if (!ODD_SPACE_PATTERN.test(char)) cleaned += char;
      else if (!cleaned.endsWith(' ')) cleaned += ' ';
      charClassBefore = charClassForJoiners(char);
    } else if (fitsAfter === true && joinersKept < MAX_JOINERS_KEPT) {
      cleaned += char;
      joinersKept += 1;
      charClassBefore = charClassBefore === 'pictograph' && codePoint === EMOJI_PRESENTATION_SELECTOR ? 'pictographWithSelector' : null;
    }
  }
  return cleaned.trim();
}
export const INVISIBLE_CHAR_PATTERN =
  /(?![\t\n\r])[\p{Cc}\p{Cf}\p{Co}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}\p{Noncharacter_Code_Point}\u2800\u{16FE4}]/u;
export const ODD_SPACE_PATTERN = /[\u1680\u2000-\u200A\u205F]/u;
export const PICTOGRAPH_PATTERN = /[\p{Extended_Pictographic}\p{Emoji_Modifier}]/u;
export const HAN_PATTERN = /\p{Script=Han}/u;
export const JOINING_SCRIPT_PATTERN =
  /[\p{Script=Arabic}\p{Script=Syriac}\p{Script=Mongolian}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Gurmukhi}\p{Script=Gujarati}\p{Script=Oriya}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Myanmar}\p{Script=Tibetan}\p{Script=Khmer}]/u;
[ZERO_WIDTH_NON_JOINER, ZERO_WIDTH_JOINER, EMOJI_PRESENTATION_SELECTOR] = [8204, 8205, 65039];
export const MAX_JOINERS_KEPT = 8;
export const charClassForJoiners = (char: string): CharClassForJoiners | null => {
  if (PICTOGRAPH_PATTERN.test(char)) return 'pictograph';
  if (/[#*0-9]/.test(char)) return 'keycap';
  if (HAN_PATTERN.test(char)) return 'han';
  return JOINING_SCRIPT_PATTERN.test(char) ? 'joining' : null;
};
export const joinPrompts = (first: AgentPrompt, second: AgentPrompt): AgentPrompt => ({
  words: `${first.words}

${second.words}`,
  data: `${first.data}

${second.data}`,
});
export const MAX_PROMPT_DATA_BYTES = 32768;
export const isPromptDataTooLong = ({ data }: AgentPrompt, reservedBytes: number = 0): boolean =>
  isOverByteLimit(data, MAX_PROMPT_DATA_BYTES - reservedBytes);
