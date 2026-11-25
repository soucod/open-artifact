/**
 * The host channel of a Shell opened as a top-level view (`host.open`'s `embed_url`: the Shell's address with
 * `?oa_view=<ticket>`, no parent frame). The Shell claims the one-time ticket over `GET /api/open-artifact.view` (an
 * event stream whose first event, `view`, carries a key only this Shell knows), then sends what it would have posted
 * to a parent frame with `POST /api/open-artifact.view` and that key; the adapter's commands come down the stream.
 * The ticket leaves the address once claimed; the key stays in this tab's session storage, so a reload comes back to
 * the same view (within the daemon's grace).
 */

import { LIBRARY_ROUTES, VIEW_TICKET_PARAM, type ShellToHost } from '@open-artifact/protocol';

const ROUTE = `/api/open-artifact.${LIBRARY_ROUTES.view}`;
/** Reconnects after a dropped stream, at most. */
const MAX_RETRIES = 5;

interface Claimed {
  view: string;
  key: string;
}

let current: Claimed | null = null;

const storageKey = (id: string): string => `open-artifact.view.${id}`;

function stored(id: string): Claimed | null {
  try {
    const raw = JSON.parse(sessionStorage.getItem(storageKey(id)) ?? 'null') as Partial<Claimed> | null;
    return raw && typeof raw.view === 'string' && typeof raw.key === 'string' ? { view: raw.view, key: raw.key } : null;
  } catch {
    return null;
  }
}

function store(id: string, claimed: Claimed | null): void {
  try {
    if (claimed) sessionStorage.setItem(storageKey(id), JSON.stringify(claimed));
    else sessionStorage.removeItem(storageKey(id));
  } catch {
    // No session storage: a reload starts without the view.
  }
}

/** The ticket on this address, removed from it (it is used once; a reload uses the key). */
export function takeTicket(): string | null {
  const url = new URL(location.href);
  const ticket = url.searchParams.get(VIEW_TICKET_PARAM);
  if (ticket === null) return null;
  url.searchParams.delete(VIEW_TICKET_PARAM);
  history.replaceState(history.state, '', url);
  return ticket || null;
}

/**
 * Starts the view channel of artifact `id` when this Shell was opened as a top-level view; `null` when it was not.
 * `onOpen` runs once the view is claimed (the Shell says `shell_hello`), `onCommand` for each host message.
 */
export function startViewChannel(id: string, handlers: { onCommand: (message: unknown) => void; onOpen: () => void }): (() => void) | null {
  const ticket = takeTicket();
  const kept = ticket ? null : stored(id);
  if (!ticket && !kept) return null;
  let stopped = false;
  let source: EventSource | null = null;
  let retries = 0;
  const open = (view: string, key: string | null): void => {
    const query = new URLSearchParams({ view, id, ...(key ? { key } : {}) });
    source = new EventSource(`${ROUTE}?${query}`);
    source.addEventListener('view', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent<string>).data) as { view?: unknown; key?: unknown };
        if (typeof data.view !== 'string' || typeof data.key !== 'string') return;
        current = { view: data.view, key: data.key };
        store(id, current);
        retries = 0;
        handlers.onOpen();
      } catch {
        // Not a view event.
      }
    });
    source.addEventListener('command', (event) => {
      try {
        handlers.onCommand(JSON.parse((event as MessageEvent<string>).data));
      } catch {
        // Not JSON: dropped.
      }
    });
    source.addEventListener('error', () => {
      // A refused claim or a dropped stream: try again with the key, a few times.
      source?.close();
      source = null;
      if (stopped) return;
      if (!current || retries >= MAX_RETRIES) {
        store(id, null);
        current = null;
        return;
      }
      retries += 1;
      const again = current;
      setTimeout(() => !stopped && open(again.view, again.key), 1000 * retries);
    });
  };
  if (ticket) open(ticket, null);
  else if (kept) {
    current = kept;
    open(kept.view, kept.key);
  }
  return () => {
    stopped = true;
    source?.close();
    current = null;
  };
}

/** Sends a host message through the view channel; nothing before the view is claimed. */
export function viewSend(message: ShellToHost | (ShellToHost & { artifact: string })): void {
  const claimed = current;
  if (!claimed) return;
  void fetch(ROUTE, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ view: claimed.view, key: claimed.key, event: message }),
  }).catch(() => undefined);
}
