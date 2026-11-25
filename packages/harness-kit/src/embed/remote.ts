/**
 * Whether a host shows a page that comes from another computer: a remote type's page (`host.open`'s `remote`).
 *
 * The host picks a policy (`HarnessOptions.embed.remote`, said in `hello` as `caps.open.remote`):
 *
 * - `allow`: show it, as any other page.
 * - `ask` (the default): ask the person through the host's `allowRemote({ origin, type, title })`. A yes is kept per
 *   origin for the life of the process; a no (or a question that throws) is not, so the next open asks again. With no
 *   `allowRemote`, the answer is no.
 * - `deny`: never show it; the daemon is told the page was not opened.
 *
 * No Node imports: an app may also run this in its renderer.
 */

import type { RemotePagePolicy } from '@open-artifact/protocol';

export type { RemotePagePolicy };

/** What `allowRemote` is asked: may a page from `origin` (of type `type`) be shown? */
export interface RemotePageRequest {
  /** The other computer's origin, e.g. `https://types.example.com`. */
  origin: string;
  /** The type id. */
  type: string;
  /** The artifact's title, when the daemon said it. */
  title?: string;
}

/** The host's answer: `true` shows the page. */
export type AllowRemote = (request: RemotePageRequest) => boolean | Promise<boolean>;

/** The remote part of a `host.open`: the type and the origins its page comes from. */
export interface RemotePage {
  type: string;
  origins: string[];
}

/** The policy a host's option names, or the default (`ask`) for anything else. */
export function remotePolicyOf(value: unknown): RemotePagePolicy {
  return value === 'allow' || value === 'deny' || value === 'ask' ? value : 'ask';
}

/**
 * A gate for remote pages under one policy: `(remote, title) → shown?`. A page with no `remote` (a type on this
 * computer) always passes. Under `ask`, a yes is kept per origin for the gate's life; a no, or a question that
 * throws, is not kept: the person is asked again the next time.
 */
export function remoteGate(policy: RemotePagePolicy = 'ask', allowRemote?: AllowRemote): (remote: RemotePage | null | undefined, title?: string) => Promise<boolean> {
  const answers = new Map<string, Promise<boolean>>();
  const ask = (origin: string, type: string, title?: string): Promise<boolean> => {
    let answer = answers.get(origin);
    if (!answer) {
      answer = (async () => (await allowRemote!({ origin, type, ...(title !== undefined ? { title } : {}) })) === true)();
      // Shared while the question is open (two opens at once ask once); only a yes stays after it.
      answers.set(origin, answer);
      answer.then(
        (yes) => {
          if (!yes) answers.delete(origin);
        },
        () => answers.delete(origin),
      );
    }
    return answer.catch(() => false);
  };
  return async (remote, title) => {
    if (!remote || !Array.isArray(remote.origins) || !remote.origins.length) return true;
    if (policy === 'allow') return true;
    if (policy === 'deny' || !allowRemote) return false;
    for (const origin of remote.origins) {
      if (!(await ask(origin, remote.type, title))) return false;
    }
    return true;
  };
}
