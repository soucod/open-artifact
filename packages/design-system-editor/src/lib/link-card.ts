/**
 * The address rules of the link card in rich Markdown editing: what a typed
 * address becomes in the Markdown source, and which addresses leave the project.
 */

/** Longest address the card writes into a link. */
export const MAX_LINK_LENGTH = 2048;

/** Extensions that make `name.ext` a project file rather than a domain. */
const FILE_EXTENSIONS = new Set(['md', 'markdown', 'html', 'htm', 'css', 'js', 'mjs', 'json', 'txt', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'pdf', 'woff', 'woff2', 'ttf', 'otf', 'mp4', 'webm']);

/** Characters that would end or open a Markdown link target early. */
function escapeTarget(target: string): string {
  return target.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\[/g, '%5B').replace(/\]/g, '%5D').replace(/</g, '%3C').replace(/>/g, '%3E');
}

/** Whether a path without a scheme starts with a host name (`example.com/x`). */
function looksLikeHost(text: string): boolean {
  const host = text.split(/[/?#]/, 1)[0]!.split(':', 1)[0]!;
  if (host === 'localhost') return true;
  const labels = host.split('.');
  if (labels.length < 2 || labels.some((label) => !/^[a-z0-9-]+$/i.test(label))) return false;
  const last = labels[labels.length - 1]!.toLowerCase();
  return /^[a-z]{2,24}$/.test(last) && !FILE_EXTENSIONS.has(last);
}

/**
 * The link target written for a typed address, or null when it cannot be one.
 * Web addresses get `https://` when they have no scheme and a lower-case
 * scheme; project paths stay relative with spaces encoded.
 */
export function normalizeTypedLink(raw: string): string | null {
  const typed = raw.trim();
  if (!typed) return null;
  const scheme = /^[a-z0-9.-]+:\d+(?:[/?#]|$)/i.test(typed) ? null : /^([a-z][a-z0-9+.-]*):/i.exec(typed);
  let target: string;
  if (scheme) {
    const name = scheme[1]!.toLowerCase();
    if (name !== 'http' && name !== 'https' && name !== 'mailto') return null;
    const rest = typed.slice(scheme[0].length);
    if (/\s/.test(rest) || (name !== 'mailto' && !/^\/\/[^/\s]+/.test(rest))) return null;
    target = name + ':' + rest;
  } else if (typed.startsWith('//')) {
    if (/\s/.test(typed)) return null;
    target = 'https:' + typed;
  } else if (looksLikeHost(typed)) {
    if (/\s/.test(typed)) return null;
    target = 'https://' + typed;
  } else {
    target = typed.replace(/\s/g, '%20');
  }
  const escaped = escapeTarget(target);
  return escaped.length > MAX_LINK_LENGTH ? null : escaped;
}

/** Whether an address leaves the project (a web page or mail). */
export function isWebLink(target: string): boolean {
  return /^(?:https?:|mailto:)/i.test(target);
}
