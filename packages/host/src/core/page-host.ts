/**
 * Page hosts: the second host name a `page` artifact runs on.
 *
 * A page artifact is served by the frame core (server-sdk `frame/core.ts`) on two origins:
 *
 *     the inner shell + capability API   <idlabel>.<rest>/page/<page token>/     (the content origin, as built-in types)
 *     the page itself (read only)         <idlabel>--<opaque>.<rest>/_f/<ver>/…  (a page host: this file)
 *
 * The page's own addresses are root-relative (`/_runtime/…`, `/_blob/<id>`, the `/` redirect), so what places its
 * reader rides in the host name, never in the path, and never the viewer's page token: the page reads its files with
 * it and nothing else (the core refuses it on every route of the inner shell's origin).
 *
 * `<opaque>` is 24 base32 characters (a-z, 2-7: 120 bits) of an HMAC under the site's signing key over the artifact,
 * the principal (kind and id) and the site epoch ({@link pageHostOpaque}). It is
 * - one DNS label with the id label: `art-<25 chars>--<24 chars>` is 55 characters (at most 63; ids of up to 33
 *   characters after `art_` fit, both id makers write 25, {@link pageHostFits});
 * - unguessable and valid for this artifact only (the artifact id is in the HMAC, and the host is checked to name it);
 * - never a page token (a page token is `v1.<payload>.<mac>`, dots included, and is never read from a host name);
 * - stable while access lasts (no grants version, no time in it: the page keeps its origin, and its storage, across
 *   reloads, sharing changes and restarts), and revoked when the epoch moves (a new HMAC) or the principal loses
 *   access (the site checks the live role on every request, as it does for page tokens).
 *
 * Pure (Web Crypto only), so the Cloudflare host can use it as the Node host does.
 */

import { contentHostLabel } from '@open-artifact/protocol';
import { base64urlDecode, hmacSign } from './crypto.ts';
import type { HostConfig } from './types.ts';

/** The opaque part's length, characters of base32 (5 bits each): 120 bits. */
export const PAGE_HOST_OPAQUE_LENGTH = 24;
/** What separates the id label from the opaque part: no id label and no base32 text has two dashes in a row. */
export const PAGE_HOST_SEPARATOR = '--';
/** The longest DNS label. */
const MAX_LABEL = 63;
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
const OPAQUE = new RegExp(`^[a-z2-7]{${PAGE_HOST_OPAQUE_LENGTH}}$`);

/** Who a page host was made for: a principal's kind and id, as page tokens name them (`k`, `p`). */
export interface PageHostPrincipal {
  kind: string;
  id: string;
}

/** Whether an artifact id leaves room for a page host label (`art-` + id + `--` + 24 characters in 63). */
export function pageHostFits(artifactId: string): boolean {
  try {
    return contentHostLabel(artifactId).length + PAGE_HOST_SEPARATOR.length + PAGE_HOST_OPAQUE_LENGTH <= MAX_LABEL;
  } catch {
    return false;
  }
}

function base32(bytes: Uint8Array, length: number): string {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < length) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
    if (out.length >= length) break;
  }
  return out;
}

/** The HMAC input: a purpose tag, then fields that cannot hold a newline (ids, kinds and a number). */
function opaqueInput(artifactId: string, principal: PageHostPrincipal, epoch: number): string {
  return `open-artifact.page-host.v1\n${artifactId}\n${principal.kind}\n${principal.id}\n${epoch}`;
}

/**
 * The opaque part of a principal's page host for an artifact under the site epoch, with the first signing key (or
 * the one given: a lookup tries each key, so a rotation keeps working while the old key is listed).
 */
export async function pageHostOpaque(keys: readonly string[], artifactId: string, principal: PageHostPrincipal, epoch: number): Promise<string> {
  const mac = base64urlDecode(await hmacSign(opaqueInput(artifactId, principal, epoch), keys));
  if (!mac) throw new Error('HMAC failed');
  return base32(mac, PAGE_HOST_OPAQUE_LENGTH);
}

/** Whether `opaque` is the principal's for this artifact and epoch under any of the keys (constant time per key). */
export async function pageHostMatches(keys: readonly string[], opaque: string, artifactId: string, principal: PageHostPrincipal, epoch: number): Promise<boolean> {
  if (!OPAQUE.test(opaque)) return false;
  let ok = false;
  for (const key of keys) {
    const mine = await pageHostOpaque([key], artifactId, principal, epoch);
    let diff = 0;
    for (let i = 0; i < PAGE_HOST_OPAQUE_LENGTH; i++) diff |= mine.charCodeAt(i) ^ opaque.charCodeAt(i);
    ok = ok || diff === 0;
  }
  return ok;
}

/** A page host's DNS label. Throws when the id leaves no room ({@link pageHostFits}) or `opaque` is not one. */
export function pageHostLabel(artifactId: string, opaque: string): string {
  if (!OPAQUE.test(opaque)) throw new TypeError('Not a page host opaque part.');
  if (!pageHostFits(artifactId)) throw new TypeError(`The artifact id ${artifactId} is too long for a page host name.`);
  return `${contentHostLabel(artifactId)}${PAGE_HOST_SEPARATOR}${opaque}`;
}

/** A page host's origin: the content origin template with the page host label for `{id}`. */
export function pageOriginOf(config: Pick<HostConfig, 'contentOrigin'>, artifactId: string, opaque: string): string {
  return config.contentOrigin.replace('{id}', pageHostLabel(artifactId, opaque));
}

/**
 * The CSP source that covers every page host of this deployment (`https://*.content.example`): the inner shell's
 * `frame-src`. A host source cannot spell one artifact's hosts alone, and the inner shell is this site's own code.
 */
export function pageHostSource(config: Pick<HostConfig, 'contentOrigin'>): string {
  const template = new URL(config.contentOrigin.replace('{id}', 'oa-id-placeholder'));
  return `${template.protocol}//*${template.host.slice('oa-id-placeholder'.length)}`;
}

/**
 * The artifact and opaque part a page host names (`art-abc--<24>.content.example`, with or without the port), or
 * null when the host is not one of this deployment's page hosts. It never reads a content host (one dash-pair less)
 * or a page token.
 */
export function pageHostOf(config: Pick<HostConfig, 'contentOrigin'>, host: string | null | undefined): { id: string; opaque: string } | null {
  if (!host) return null;
  const template = new URL(config.contentOrigin.replace('{id}', 'oa-id-placeholder'));
  const defaultPort = template.protocol === 'https:' ? '443' : '80';
  const [prefix, suffix] = template.host.split('oa-id-placeholder') as [string, string];
  let given = host.trim().toLowerCase();
  if (!template.port && given.endsWith(`:${defaultPort}`)) given = given.slice(0, -defaultPort.length - 1);
  if (!given.startsWith(prefix) || !given.endsWith(suffix) || given.length <= prefix.length + suffix.length) return null;
  const label = given.slice(prefix.length, given.length - suffix.length);
  if (label.length > MAX_LABEL || label.includes('.') || label.includes(':')) return null;
  const at = label.indexOf(PAGE_HOST_SEPARATOR);
  if (at < 0) return null;
  const idLabel = label.slice(0, at);
  const opaque = label.slice(at + PAGE_HOST_SEPARATOR.length);
  if (!OPAQUE.test(opaque) || !/^art-[0-9a-z]{10,40}$/.test(idLabel)) return null;
  return { id: `art_${idLabel.slice(4)}`, opaque };
}
