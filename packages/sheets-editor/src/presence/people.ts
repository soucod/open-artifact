import { isNonNullObject } from '../utils/objects.ts';
import type { PageApi, PageUser } from '../host/sheets-host.ts';
import type { ProfileOfPerson } from '../chips/people-list.ts';
/** The people the page can look up: the viewer, people found by a search, and people by their ids. */
export interface PeopleDirectory {
  viewer(): Promise<{ userId: string; name: string } | null>;
  search(query: string): Promise<ProfileOfPerson[]>;
  profiles(userIds: readonly string[]): Promise<ProfileOfPerson[]>;
}

export function readProfile(
profile: unknown): ProfileOfPerson | null {
  if (!isNonNullObject(profile)) return null;
  let { id: userId, name: profileName, avatarUrl, color, isMe, guest } = profile;
  if (typeof userId !== 'string' || typeof profileName !== 'string' || typeof avatarUrl !== 'string') return null;
  return {
    userId,
    name: profileName,
    avatarUrl,
    color: typeof color === 'string' ? color : null,
    isViewer: isMe === true,
    isGuest: guest === true,
  };
}
export function createPeopleDirectory(page: PageApi): PeopleDirectory {
  let userApi: Promise<PageUser | null> | null = null;
  let useUser = () => {
    userApi ??= page.use('user');
    return userApi;
  };
  let callUser = async (method: keyof PageUser, argument?: string | readonly string[]): Promise<unknown> => {
    try {
      // What the host gives is checked as it comes: it may say it is not available, or lack the method.
      let user: unknown = await useUser();
      let call = isNonNullObject(user) && user.available !== false ? user[method] : null;
      return typeof call === 'function' ? await call.call(user, argument) : null;
    } catch (error) {
      reportError(error);
      return null;
    }
  };
  return {
    async viewer() {
      let me = await callUser('me');
      if (!isNonNullObject(me)) return null;
      let { id: userId, name: displayName } = me;
      return typeof userId === 'string' && typeof displayName === 'string' && displayName !== ''
        ? {
            userId,
            name: displayName,
          }
        : null;
    },
    async search(query) {
      let found = await callUser('search', query);
      return Array.isArray(found) ? readProfiles(found) : [];
    },
    async profiles(userIds) {
      let found = await callUser('profiles', userIds);
      return isNonNullObject(found) ? readProfiles(Object.values(found)) : [];
    },
  };
}
export const readProfiles = (profiles: readonly unknown[]): ProfileOfPerson[] =>
  profiles.map(readProfile).filter((profile) => profile !== null);

