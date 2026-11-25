import type { PageMode } from '../state/transitions.ts';
import type { KeyPress } from '../state/event-reducer.ts';
import { shortenUrlMiddle, MAX_SHOWN_LINK_LENGTH } from './cell-links.ts';
/** How much of an address a card shows: the site, and the rest shortened in the middle when it is long. */
export interface UrlSplitForDisplay {
  origin: string;
  rest: string;
  /** How much of the rest the shortening leaves out. */
  leftOut: 'nothing' | 'some' | 'much';
  isSiteLong: boolean;
}
/** A pull request or an issue an address points to. */
export interface GithubReference {
  kind: 'pullRequest' | 'issue';
  owner: string;
  repository: string;
  number: string;
}
export function splitUrlForDisplay(url: string): UrlSplitForDisplay {
  let { origin, host } = new URL(url);
  let rest = url.slice(origin.length);
  let isRestLong = rest.length > URL_REST_SHOWN_LENGTH;
  const restLeftOut = isRestLong ? 'some' : 'nothing';
  return {
    origin,
    rest: isRestLong ? `${rest.slice(0, 16)}…${rest.slice(-8)}` : rest,
    leftOut: rest.length > URL_REST_LONG_LENGTH ? 'much' : restLeftOut,
    isSiteLong: host.length > LONG_SITE_LENGTH,
  };
}
export function shortenedUrlRest(url: string): string {
  let { origin } = new URL(url);
  let restLength = Math.max(URL_REST_SHOWN_LENGTH, URL_TWO_LINE_LENGTH - origin.length);
  return shortenUrlMiddle(restLength, url).slice(origin.length);
}
export function urlsShownAlike(urls: string[]): string[] {
  let shownUrls = urls.map((url) => {
    let { origin, rest } = splitUrlForDisplay(url);
    return `${origin}${rest}`;
  });
  return urls.filter(
    (url, index) => shownUrls.filter((shownUrl) => shownUrl === shownUrls[index]).length > 1,
  );
}
export function urlForDisplay(url: string, dropScheme: boolean): string {
  let shortened = shortenUrlMiddle(MAX_SHOWN_LINK_LENGTH, url);
  return dropScheme ? withoutHttpsScheme(shortened) : shortened;
}
export function githubReferenceOf(url: string): GithubReference | null {
  let { host, pathname } = new URL(url);
  for (let face of GITHUB_LINK_FACES) {
    let match = face.host.test(host) ? face.path.exec(pathname) : null;
    if (match !== null) return face.face(match);
  }
  return null;
}
export const LONG_SITE_LENGTH = 30;
export const URL_REST_SHOWN_LENGTH = 28;
export const URL_REST_LONG_LENGTH = 60;
export const URL_TWO_LINE_LENGTH = 72;
export const withoutHttpsScheme = (url: string): string => url.replace(/^https:\/\//, '').replace(/^([^/]+)\/$/, '$1');
export const githubReferenceFace =
  (kind: GithubReference['kind']) =>
  ([, owner = '', repository = '', number = '']: RegExpExecArray): GithubReference => ({
    kind,
    owner,
    repository,
    number,
  });
export const GITHUB_HOST_PATTERN = /^github\.com$/;
export const GITHUB_LINK_FACES = [
  {
    host: GITHUB_HOST_PATTERN,
    path: /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/,
    face: githubReferenceFace('pullRequest'),
  },
  {
    host: GITHUB_HOST_PATTERN,
    path: /^\/([^/]+)\/([^/]+)\/issues\/(\d+)(?:\/|$)/,
    face: githubReferenceFace('issue'),
  },
];
export const isOpenLinkShortcut = (mode: PageMode, keyPress: KeyPress): boolean =>
  mode.kind === 'navigating' && keyPress.key === 'Enter' && keyPress.isAltHeld && !keyPress.isShiftHeld && !keyPress.isModifierHeld;
