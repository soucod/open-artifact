/**
 * Which users have a Link connected: a count of open `link.events` streams per user. A user with two computers
 * linked is online while either stream is open.
 */

import type { LinkPresenceRegistry } from './services.ts';

export class LinkPresenceCounter implements LinkPresenceRegistry {
  readonly #open = new Map<string, number>();
  readonly #onChange: ((userId: string, online: boolean) => void) | undefined;

  /** `onChange` hears a user go online (first stream) or offline (last stream closed). */
  constructor(options: { onChange?: (userId: string, online: boolean) => void } = {}) {
    this.#onChange = options.onChange;
  }

  connected(userId: string): void {
    const count = (this.#open.get(userId) ?? 0) + 1;
    this.#open.set(userId, count);
    if (count === 1) this.#onChange?.(userId, true);
  }

  disconnected(userId: string): void {
    const count = (this.#open.get(userId) ?? 0) - 1;
    if (count > 0) {
      this.#open.set(userId, count);
      return;
    }
    if (!this.#open.delete(userId)) return;
    this.#onChange?.(userId, false);
  }

  online(userId: string): boolean {
    return (this.#open.get(userId) ?? 0) > 0;
  }
}
