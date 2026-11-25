export const isMentionText = (text: string): boolean => text.startsWith('@');
export const mentionQueryOf = (text: string): string => text.slice(1).trim();
