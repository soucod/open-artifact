import { AGENT_NAME, DEFAULT_AGENT_NAME } from '../agent/agent-name.ts';
import * as IntlMessageformat from 'intl-messageformat';

/** An English message in ICU syntax, with its id when it has one. */
export interface MessageDescriptor {
  defaultMessage: string;
  id?: string;
}

/** Words inside a message that are shown apart from the words around them, such as a name the user gave. */
export interface WordSetApart {
  setApart: string;
  /** The words are the name of a column. */
  namesColumn?: boolean;
}

/** A piece of a message: plain text, or words set apart. */
export type MessagePart = string | WordSetApart;

/** A value that formats into plain text. */
export type PlainMessageValue = string | number | boolean | undefined;

/** A value that stays a separate part of the formatted message. */
export type MessageObjectValue = WordSetApart | readonly MessagePart[];

/** Any value a message can take. `null` formats as nothing but, being an object, makes the message come back in parts. */
export type MessageValue = PlainMessageValue | null | MessageObjectValue;

const localWordsOf = (name: string): Record<string, string> => ({
  'Agent isn’t available in this Sheet.': `${name} isn’t listening to this Sheet. Ask it to wait for requests here, then try again.`,
  '{cells} added to your message to Agent.': `{cells} sent to ${name}.`,
  '{cells} added to your message to Agent. Typing in the Sheet is paused. The message box is outside the Sheet. Press Escape to go back to the cells.': `{cells} sent to ${name}.`,
  'Added to your message to Agent. Send it when you’re ready.': `Sent to ${name}.`,
  'Rule added to your message to Agent. Describe the change you want in the message box.': `Rule sent to ${name}. Tell ${name} the change you want.`,
});
const AGENT_IN_WORDS = /\bAgent\b(?! Sheets?\b| Docs?\b)/g;
const agentWordsCache = new Map<string, string>();
let agentWordsName = '';
let localWords: Record<string, string> = {};
function agentWordsOf(message: string): string {
  if (typeof message !== 'string') return message;
  if (agentWordsName !== AGENT_NAME) {
    agentWordsName = AGENT_NAME;
    localWords = localWordsOf(AGENT_NAME);
    agentWordsCache.clear();
  }
  let words = agentWordsCache.get(message);
  if (words === undefined) {
    words = localWords[message] ?? (AGENT_NAME === DEFAULT_AGENT_NAME ? message : message.replace(AGENT_IN_WORDS, () => AGENT_NAME));
    agentWordsCache.set(message, words);
  }
  return words;
}
export function compileMessage(message: string): IntlMessageformat.IntlMessageFormat {
  let cached = compiledMessages.get(message);
  if (cached !== undefined) return cached;
  let compiled = new IntlMessageformat.default(message, MESSAGE_LOCALE, undefined, {
    ignoreTag: true,
  });
  compiledMessages.set(message, compiled);
  return compiled;
}
export function formatMessageText(
  message: string,
  values?: Record<string, MessageValue>,
): string | MessageObjectValue | (string | MessageObjectValue)[] {
  if (brokenMessages.has(message)) return message;
  try {
    return compileMessage(message).format<MessageObjectValue>(values);
  } catch (error) {
    brokenMessages.add(message);
    reportError(error);
    return message;
  }
}
/** Formats a message. With only plain values it comes back as text; with any object value, as its parts. */
export function translateMessage(descriptor: MessageDescriptor, values?: Record<string, PlainMessageValue>): string;
export function translateMessage(descriptor: MessageDescriptor, values: Record<string, MessageValue>): MessagePart[];
export function translateMessage({ defaultMessage }: MessageDescriptor, values: Record<string, MessageValue> = {}): string | MessagePart[] {
  let formatted = formatMessageText(agentWordsOf(defaultMessage), values);
  let asParts = (): MessagePart[] => [formatted].flat(2);
  if (Object.values(values).some((value) => typeof value === 'object')) return asParts();
  return typeof formatted === 'string' ? formatted : joinMessageParts(asParts());
}
export const joinMessageParts = (parts: readonly MessagePart[]): string =>
  parts.map((part) => (typeof part === 'string' ? part : part.setApart)).join('');
export const MESSAGE_LOCALE = 'en-US';
export const compiledMessages = new Map<string, IntlMessageformat.IntlMessageFormat>();
export const brokenMessages = new Set<string>();
