/**
 * LAN sharing of the type server's artifacts, with roles.
 *
 * There are no accounts on a local network, so each role has a link
 * instead: `/s/<token>`. Whoever opens one types a name, gets a cookie that
 * names them for this artifact, and is a guest in that role from then on:
 *
 *   - owner: every request over loopback (the person at this computer, the
 *     CLI, the daemon). A guest cookie there counts for nothing, so trying a
 *     link on this computer never locks the owner out; the same link at a
 *     network address shows what that role sees.
 *   - editor: changes the artifact and comments. commenter: comments only.
 *     viewer: looks. Only the owner sends to the agent, saves downloads on
 *     this computer, uses its connectors (`mcp`) and changes the sharing.
 *
 * The page learns who it is from `_api/session` (`viewer`, the `user`
 * capability) and goes read-only by itself; the server refuses what a role
 * may not do anyway ({@link assertRoleMay}).
 *
 * `<root>/.sharing.json` keeps whether the artifact is open to the network,
 * the port the links were given out with, a link (token, on/off) per role,
 * and the guests who joined. Turning a link off holds everyone who came by
 * it until it is on again; resetting it (a new token) drops them.
 *
 * The listeners themselves are server-sdk's {@link LanNetwork}: one set, on
 * the server's port, for every artifact this server shares.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';
import type { ShareRequest, ShareRole, ShareView } from '@open-artifact/protocol';
import type { Role, Viewer } from '@open-artifact/runtime/capabilities';
import { ASK_AGENT_ROUTES, isOwnerOnlyRoute, roleMay, type RoleOptions } from '@open-artifact/runtime/roles';
import { LanNetwork, SHARING_FILE, isTailnet, lanAddresses } from '@open-artifact/server-sdk/lan';
import { HttpError, isFramedNavigation, readBody, send, sendFrameDenied } from './http.ts';

export { SHARING_FILE };

/** The roles a link grants, most rights first. */
export const GUEST_ROLES = ['editor', 'commenter', 'viewer'] as const satisfies readonly ShareRole[];

export const isGuestRole = (value: unknown): value is ShareRole => typeof value === 'string' && (GUEST_ROLES as readonly string[]).includes(value);

/** Longest guest name. */
export const MAX_NAME = 40;

/** Guests kept per artifact; the oldest go first. */
const MAX_GUESTS = 200;

/** One role's link. */
export interface ShareLink {
  token: string;
  on: boolean;
}

/** Someone who joined through a link. */
export interface Guest {
  id: string;
  /** What the guest's cookie holds. */
  secret: string;
  name: string;
  role: ShareRole;
  /** The token of the link they joined with (or were moved to): resetting it drops them. */
  link: string;
  joined: string;
  seen?: string;
}

/** `.sharing.json`. */
export interface SharingState {
  lan: boolean;
  /** The port the links were given out with; a server started for them tries it first. */
  port?: number;
  links: Record<ShareRole, ShareLink>;
  guests: Guest[];
}

/** {@link ShareView} with what the CLI and a richer panel show besides. */
export interface ShareViewFull extends ShareView {
  port: number;
  /** The people who joined, and whether they have a page open now. */
  guests: Array<{ id: string; name: string; role: ShareRole; joined: string; seen?: string; online: boolean; active: boolean }>;
  /** The same links at this computer's Tailscale address, for people on the tailnet. */
  tailnet?: { address: string; links: Partial<Record<ShareRole, string>> };
}

/** A change to sharing: the protocol's, plus link resets and guests' roles (the CLI's). */
export interface ShareChange extends Omit<ShareRequest, 'id'> {
  /** Roles whose link gets a new token (the old one stops working, its guests are out). */
  reset?: ShareRole[];
  /** Guest id → a new role, or `null` to remove them. */
  guests?: Record<string, ShareRole | null>;
}

const token = (bytes = 18): string => randomBytes(bytes).toString('base64url');
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const sameToken = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

function fresh(): SharingState {
  return { lan: false, links: { editor: { token: token(), on: true }, commenter: { token: token(), on: true }, viewer: { token: token(), on: true } }, guests: [] };
}

/** A name a guest typed: one line, no markup characters. */
export function cleanName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f<>"'`]/g, '').replace(/\s+/g, ' ').trim() : '';
  return [...name].slice(0, MAX_NAME).join('');
}

/** True for a loopback peer address. */
export function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  const a = address.startsWith('::ffff:') ? address.slice(7) : address;
  return a === '::1' || a.startsWith('127.');
}

/** The guest cookie of the artifact in `root`: one per artifact, as a browser keeps cookies by host, not port. */
export const guestCookieName = (root: string): string => `oa_guest_${createHash('sha256').update(resolve(root)).digest('hex').slice(0, 12)}`;

/** The page's viewer for a guest. */
export const guestViewer = (guest: Guest): Viewer => ({ id: `guest-${guest.id}`, name: guest.name, role: guest.role });

/** The sharing state of one artifact folder (`.sharing.json`). */
export class SharingFile {
  readonly file: string;
  state: SharingState;

  constructor(root: string) {
    this.file = join(root, SHARING_FILE);
    this.state = SharingFile.read(this.file);
  }

  static read(file: string): SharingState {
    const state = fresh();
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      return state;
    }
    if (!isRecord(raw)) return state;
    state.lan = raw.lan === true;
    if (typeof raw.port === 'number' && Number.isInteger(raw.port) && raw.port > 0 && raw.port < 65536) state.port = raw.port;
    if (isRecord(raw.links)) {
      for (const role of GUEST_ROLES) {
        const link = raw.links[role];
        if (isRecord(link) && typeof link.token === 'string' && link.token.length >= 16) state.links[role] = { token: link.token, on: link.on !== false };
      }
    }
    if (Array.isArray(raw.guests)) {
      for (const g of raw.guests) {
        if (!isRecord(g) || typeof g.id !== 'string' || typeof g.secret !== 'string' || g.secret.length < 16 || !isGuestRole(g.role) || typeof g.link !== 'string') continue;
        state.guests.push({
          id: g.id,
          secret: g.secret,
          name: cleanName(g.name) || 'Guest',
          role: g.role,
          link: g.link,
          joined: typeof g.joined === 'string' ? g.joined : new Date(0).toISOString(),
          ...(typeof g.seen === 'string' ? { seen: g.seen } : {}),
        });
      }
    }
    return state;
  }

  save(): void {
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  /** The role whose link has this token, while that link is on. */
  linkRole(given: string): ShareRole | null {
    for (const role of GUEST_ROLES) {
      const link = this.state.links[role];
      if (link.on && sameToken(given, link.token)) return role;
    }
    return null;
  }

  /** The guest a cookie names, while they still have access. */
  guest(secret: string | undefined): Guest | null {
    if (!secret) return null;
    const guest = this.state.guests.find((g) => sameToken(g.secret, secret));
    return guest && this.valid(guest) ? guest : null;
  }

  /** Their link is on and was not reset, and they were not removed. */
  valid(guest: Guest): boolean {
    const link = this.state.links[guest.role];
    return link.on && link.token === guest.link && this.state.guests.includes(guest);
  }

  join(role: ShareRole, name: string): Guest {
    const guest: Guest = { id: token(4), secret: token(24), name: cleanName(name) || 'Guest', role, link: this.state.links[role].token, joined: new Date().toISOString() };
    this.state.guests.push(guest);
    if (this.state.guests.length > MAX_GUESTS) this.state.guests.splice(0, this.state.guests.length - MAX_GUESTS);
    this.save();
    return guest;
  }

  /** Marks a guest seen now (saved at most once a minute per guest). */
  seen(guest: Guest): void {
    const now = new Date();
    if (guest.seen && now.getTime() - Date.parse(guest.seen) < 60_000) return;
    guest.seen = now.toISOString();
    this.save();
  }

  setLan(on: boolean, port?: number): void {
    this.state.lan = on;
    if (on && port) this.state.port = port;
    this.save();
  }

  setLink(role: ShareRole, on: boolean): void {
    this.state.links[role].on = on;
    this.save();
  }

  /** A new token for the link: the old link stops working and its guests are out. */
  resetLink(role: ShareRole): void {
    const old = this.state.links[role].token;
    this.state.links[role] = { token: token(), on: this.state.links[role].on };
    this.state.guests = this.state.guests.filter((g) => g.link !== old);
    this.save();
  }

  /** Gives a guest another role: they now hang on that role's link, so it must be on. */
  setRole(id: string, role: ShareRole): boolean {
    const guest = this.state.guests.find((g) => g.id === id);
    if (!guest || !this.state.links[role].on) return false;
    guest.role = role;
    guest.link = this.state.links[role].token;
    this.save();
    return true;
  }

  removeGuest(id: string): boolean {
    const before = this.state.guests.length;
    this.state.guests = this.state.guests.filter((g) => g.id !== id);
    if (this.state.guests.length === before) return false;
    this.save();
    return true;
  }
}

/* -------------------------------------------------------------------------- */
/* What a role may do                                                         */
/* -------------------------------------------------------------------------- */

/** The role table lives in `@open-artifact/runtime/roles` (a cloud host decides with it too); re-exported here. */
export { roleMay, type RoleOptions };

/** Throws `not_writer` (403) when the role may not make this call. */
export function assertRoleMay(viewer: Viewer, route: string, method: string, options: RoleOptions = {}): void {
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
  if (roleMay(viewer.role, route, options)) return;
  const what =
    viewer.role === 'editor' && ASK_AGENT_ROUTES.has(route)
      ? 'The owner does not let editors ask their agent.'
      : isOwnerOnlyRoute(route)
        ? 'Only the owner, on the computer that shares it, can do this.'
        : `A ${viewer.role} cannot do this.`;
  throw new HttpError(403, 'not_writer', what);
}

/* -------------------------------------------------------------------------- */
/* The server side                                                            */
/* -------------------------------------------------------------------------- */

/** What sharing needs of an open artifact (the server's `OpenArtifact`). */
export interface ShareTarget {
  readonly id: string;
  readonly root: string;
  readonly type: string;
  readonly token: string;
  readonly title: string;
}

/** A page connection, as sharing sees it. */
export interface ShareClient {
  readonly viewer: Viewer;
  end(): void;
}

/** Options of {@link LanSharing}. */
export interface LanSharingOptions {
  /** The server's port; the LAN listeners use the same one. */
  port(): number;
  /** A new HTTP server with the loopback server's handlers. */
  createServer(): Server;
  /** The page connections of an artifact (to show who is online and cut off who lost access). */
  clients(id: string): Iterable<ShareClient>;
  log(line: string): void;
  /** The addresses to listen on (default: this computer's LAN addresses). */
  addresses?(): string[];
  /** Whether a request comes from this computer's owner (default: a loopback peer). */
  isLocal?(req: IncomingMessage): boolean;
}

interface Entry {
  target: ShareTarget;
  file: SharingFile;
  /** Open to the network now. */
  on: boolean;
}

const page = (target: ShareTarget): string => `/${target.type}/${target.token}/`;
const hostOf = (address: string): string => (address.includes(':') ? `[${address}]` : address);

/** Sharing for one type server: the LAN listeners, each open artifact's links and guests, and the join pages. */
export class LanSharing {
  readonly lan: LanNetwork;
  private readonly options: LanSharingOptions;
  private readonly entries = new Map<string, Entry>();

  constructor(options: LanSharingOptions) {
    this.options = options;
    this.lan = new LanNetwork({
      port: options.port,
      createServer: options.createServer,
      stillShared: () => [...this.entries.values()].some((e) => e.on),
      log: options.log,
      ...(options.addresses ? { addresses: options.addresses } : {}),
    });
  }

  /** True while any artifact is open to the network (the server should not idle out). */
  get listening(): boolean {
    return [...this.entries.values()].some((e) => e.on);
  }

  /** The artifact opened: open it to the network again when `.sharing.json` says so. */
  async attach(target: ShareTarget): Promise<void> {
    const existing = this.entries.get(target.id);
    if (existing && existing.target === target) return;
    const entry: Entry = { target, file: new SharingFile(target.root), on: false };
    this.entries.set(target.id, entry);
    if (entry.file.state.lan) await this.setLan(entry, true);
  }

  /** The artifact closed: it stays shared in `.sharing.json`, for the next open. */
  detach(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    if (entry.on) this.lan.release();
  }

  /** Closes every listener (the server stops). */
  close(): void {
    for (const entry of this.entries.values()) entry.on = false;
    this.lan.close();
  }

  isLocal(req: IncomingMessage): boolean {
    return this.options.isLocal ? this.options.isLocal(req) : isLoopback(req.socket.remoteAddress);
  }

  /** Whether a Host header names a LAN listener (the DNS-rebinding guard's other half). */
  hostAllowed(host: string | undefined): boolean {
    return !!host && this.lan.hostAllowed(host);
  }

  private cookie(req: IncomingMessage, name: string): string | undefined {
    for (const part of String(req.headers.cookie ?? '').split(';')) {
      const eq = part.indexOf('=');
      if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
    }
    return undefined;
  }

  /**
   * Who a request to this artifact is: `owner` over loopback, a guest by the
   * artifact's cookie while it is shared and their link holds, else `null`.
   */
  viewerOf(target: ShareTarget, req: IncomingMessage, owner: Viewer): Viewer | null {
    if (this.isLocal(req)) return owner;
    const entry = this.entries.get(target.id);
    if (!entry?.on || entry.target !== target) return null;
    const guest = entry.file.guest(this.cookie(req, guestCookieName(target.root)));
    if (!guest) return null;
    entry.file.seen(guest);
    return guestViewer(guest);
  }

  /** Whether a viewer let in earlier still has access (owners always do). */
  stillIn(id: string, viewer: Viewer): boolean {
    if (viewer.role === 'owner') return true;
    const entry = this.entries.get(id);
    if (!entry?.on) return false;
    const guest = entry.file.state.guests.find((g) => `guest-${g.id}` === viewer.id);
    return !!guest && entry.file.valid(guest) && guest.role === viewer.role;
  }

  /** Ends the page connections of guests who lost access. */
  private dropRevoked(entry: Entry): void {
    for (const client of [...this.options.clients(entry.target.id)]) if (!this.stillIn(entry.target.id, client.viewer)) client.end();
  }

  private async setLan(entry: Entry, on: boolean): Promise<void> {
    if (!on) {
      const was = entry.on;
      entry.on = false;
      if (entry.file.state.lan) entry.file.setLan(false);
      if (was) this.lan.release();
      this.dropRevoked(entry);
      return;
    }
    const port = this.options.port();
    const remembered = entry.file.state.port;
    if (remembered && remembered !== port) this.options.log(`sharing: the links of ${entry.target.id} were given out on port ${remembered}; this server is on ${port}: give the new links out again`);
    const addresses = await this.lan.open();
    entry.on = true;
    if (!entry.file.state.lan || entry.file.state.port !== port) entry.file.setLan(true, port);
    this.options.log(`sharing ${entry.target.id} on the network: ${addresses.map((a) => `http://${hostOf(a)}:${port}${page(entry.target)}`).join(', ') || '(no network address)'}`);
  }

  private entry(id: string): Entry {
    const entry = this.entries.get(id);
    if (!entry) throw new HttpError(404, 'not_found', 'This artifact is not open here: open it first.');
    return entry;
  }

  /** The sharing state, for the Shell's Share panel, the daemon and the CLI. */
  view(id: string): ShareViewFull {
    const entry = this.entry(id);
    const port = this.options.port();
    const listened = entry.on ? [...this.lan.network.addresses()].sort((a, b) => Number(isTailnet(a)) - Number(isTailnet(b))) : [];
    // Copy link before sharing gives the network address too (no one else opens 127.0.0.1).
    const candidates = listened.length ? listened : [...(this.options.addresses ?? lanAddresses)()].sort((a, b) => Number(isTailnet(a)) - Number(isTailnet(b)));
    const base = candidates.find((a) => !isTailnet(a)) ?? candidates[0] ?? '127.0.0.1';
    const { links, guests } = entry.file.state;
    const online = new Set<string>();
    for (const client of this.options.clients(id)) if (client.viewer.role !== 'owner') online.add(client.viewer.id);
    const tailnet = listened.find(isTailnet);
    return {
      lan: entry.on,
      addresses: listened,
      port,
      links: Object.fromEntries(GUEST_ROLES.map((role) => [role, { on: links[role].on, url: `http://${hostOf(base)}:${port}/s/${links[role].token}` }])),
      ...(tailnet ? { tailnet: { address: tailnet, links: Object.fromEntries(GUEST_ROLES.filter((r) => links[r].on).map((r) => [r, `http://${tailnet}:${port}/s/${links[r].token}`])) } } : {}),
      guests: guests
        .filter((g) => entry.file.valid(g) || links[g.role].token === g.link)
        .map((g) => ({ id: g.id, name: g.name, role: g.role, joined: g.joined, ...(g.seen ? { seen: g.seen } : {}), online: online.has(`guest-${g.id}`), active: entry.file.valid(g) })),
    };
  }

  /** Changes sharing (the owner's call): links, resets, guests, then on or off the network. Answers the view after. */
  async change(id: string, change: ShareChange): Promise<ShareViewFull> {
    const entry = this.entry(id);
    const { file } = entry;
    if (change.links !== undefined) {
      if (!isRecord(change.links)) throw new HttpError(400, 'invalid_argument', 'links is {editor|commenter|viewer: boolean}.');
      for (const [role, on] of Object.entries(change.links)) {
        if (!isGuestRole(role) || typeof on !== 'boolean') throw new HttpError(400, 'invalid_argument', 'links is {editor|commenter|viewer: boolean}.');
        file.setLink(role, on);
      }
    }
    if (change.reset !== undefined) {
      const roles = Array.isArray(change.reset) ? change.reset : [change.reset];
      for (const role of roles) {
        if (!isGuestRole(role)) throw new HttpError(400, 'invalid_argument', 'reset lists editor, commenter or viewer.');
        file.resetLink(role);
      }
    }
    if (change.guests !== undefined) {
      if (!isRecord(change.guests)) throw new HttpError(400, 'invalid_argument', 'guests is {<guest id>: role or null}.');
      for (const [guest, role] of Object.entries(change.guests)) {
        if (role === null) {
          if (!file.removeGuest(guest)) throw new HttpError(404, 'not_found', `No guest ${guest}.`);
        } else if (!isGuestRole(role)) {
          throw new HttpError(400, 'invalid_argument', 'A guest role is editor, commenter or viewer (null removes them).');
        } else if (!file.setRole(guest, role)) {
          throw new HttpError(409, 'conflict', `No guest ${guest}, or the ${role} link is off.`);
        }
      }
    }
    if (change.lan !== undefined) {
      if (typeof change.lan !== 'boolean') throw new HttpError(400, 'invalid_argument', 'lan is true or false.');
      if (change.lan !== entry.on) await this.setLan(entry, change.lan);
    }
    this.options.log(`sharing ${id}: ${JSON.stringify({ ...change })}`);
    // Guests whose link went off or was reset, who were removed or moved, reconnect under their new standing.
    for (const client of [...this.options.clients(id)]) {
      if (client.viewer.role !== 'owner' && (!this.stillIn(id, client.viewer) || change.guests?.[client.viewer.id.slice('guest-'.length)] !== undefined)) client.end();
    }
    return this.view(id);
  }

  /** The open artifact a share link belongs to, by its token (whether or not the link is on). */
  private byLink(given: string): { entry: Entry; role: ShareRole | null } | null {
    for (const entry of this.entries.values()) {
      if (GUEST_ROLES.some((role) => sameToken(given, entry.file.state.links[role].token))) return { entry, role: entry.file.linkRole(given) };
    }
    return null;
  }

  /**
   * `/s/<token>`: GET shows the name form (straight in for a guest already
   * in through this link), POST joins and sets the guest's cookie. On this
   * computer it says the owner is the owner here.
   */
  async handleLink(req: IncomingMessage, res: ServerResponse, given: string): Promise<void> {
    const method = req.method ?? 'GET';
    const w = words(req);
    if (method !== 'GET' && method !== 'HEAD' && method !== 'POST') {
      req.resume();
      res.writeHead(405, { allow: 'GET, POST' }).end();
      return;
    }
    const found = /^[A-Za-z0-9_-]{16,64}$/.test(given) ? this.byLink(given) : null;
    const local = this.isLocal(req);
    if (!found || !found.role || (!local && !found.entry.on)) {
      req.resume();
      return sendPage(res, 404, w.goneTitle, `<h1>${esc(w.goneTitle)}</h1><p>${esc(w.gone)}</p>`);
    }
    const { entry, role } = found;
    const title = entry.target.title;
    const destination = new URL(page(entry.target), 'http://localhost');
    if (entry.target.type === 'docs') {
      const query = new URL(req.url ?? '/', destination).searchParams;
      for (const key of ['tab', 'comment']) {
        const value = query.get(key);
        if (value && /^[a-zA-Z0-9_-]{1,128}$/.test(value)) destination.searchParams.set(key, value);
      }
    }
    const to = destination.pathname + destination.search;
    if (local) {
      req.resume();
      const lan = entry.on ? this.lan.network.addresses().find((a) => !isTailnet(a)) : undefined;
      const there = lan ? `http://${hostOf(lan)}:${this.options.port()}/s/${given}` : '';
      const tryIt = there ? `<p>${esc(w.tryRole(w.roles[role]))} <a href="${esc(there)}">${esc(there)}</a></p>` : '';
      return sendPage(res, 200, title, `<h1>${esc(title)}</h1><p>${esc(w.youOwn)} <a href="${esc(to)}">${esc(w.openIt)}</a></p>${tryIt}`);
    }
    const cookieName = guestCookieName(entry.target.root);
    const current = entry.file.guest(this.cookie(req, cookieName));
    if (method !== 'POST') {
      if (current && current.link === entry.file.state.links[role].token) {
        res.writeHead(303, { location: to, 'cache-control': 'no-store' }).end();
        return;
      }
      return sendPage(
        res,
        200,
        title,
        `<h1>${esc(title)}</h1><p>${esc(w.invited(w.roles[role]))}</p>` +
          `<form method="post"><label for="n">${esc(w.yourName)}</label><input id="n" name="name" maxlength="${MAX_NAME}" value="${esc(current?.name ?? '')}" required autofocus autocomplete="name">` +
          `<button type="submit">${esc(w.open)}</button></form><p class="note">${esc(w.note)}</p>`,
      );
    }
    // A form post from another site cannot make someone join.
    const origin = req.headers.origin;
    if (origin && origin !== 'null') {
      let same = false;
      try {
        same = new URL(origin).host === req.headers.host;
      } catch {
        same = false;
      }
      if (!same) {
        req.resume();
        throw new HttpError(403, 'not_granted', 'Cross-origin join refused.');
      }
    }
    const form = (await readBody(req, 8 * 1024)).toString('utf8');
    const name = new URLSearchParams(form).get('name') ?? '';
    const guest = entry.file.join(role, name);
    this.options.log(`sharing ${entry.target.id}: ${guest.name} joined as ${role} (${req.socket.remoteAddress ?? '?'})`);
    res
      .writeHead(303, {
        location: to,
        'set-cookie': `${cookieName}=${guest.secret}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`,
        'cache-control': 'no-store',
      })
      .end();
  }

  /**
   * A request nobody may make: a page for a browser's navigation, JSON for anything else. An artifact's page
   * (`page`) loading in a frame tells the Shell framing it instead (`frame_denied`), which a static page cannot;
   * `ancestors` is who may frame that answer (none: anyone).
   */
  denied(req: IncomingMessage, res: ServerResponse, page = false, ancestors?: string): void {
    req.resume();
    const w = words(req);
    if (page && isFramedNavigation(req)) return sendFrameDenied(res, 403, 'not_granted', w.noAccessTitle, w.noAccess, ancestors);
    const navigation = (req.method === 'GET' || req.method === 'HEAD') && /\btext\/html\b/.test(String(req.headers.accept ?? ''));
    if (!navigation) throw new HttpError(403, 'not_granted', 'This artifact is not shared with you.');
    sendPage(res, 403, w.noAccessTitle, `<h1>${esc(w.noAccessTitle)}</h1><p>${esc(w.noAccess)}</p>`);
  }
}

/**
 * A page served over plain http at a LAN address is not a secure context, so
 * the browser leaves out `crypto.randomUUID`; the editors mint ids with it.
 * Put first in a guest's page.
 */
export const SECURE_CONTEXT_SHIM =
  "<script>if(window.crypto&&!crypto.randomUUID)crypto.randomUUID=function(){var b=crypto.getRandomValues(new Uint8Array(16)),h='',i;" +
  "b[6]=b[6]&15|64;b[8]=b[8]&63|128;for(i=0;i<16;i++){h+=(b[i]+256).toString(16).slice(1);if(i==3||i==5||i==7||i==9)h+='-'}return h};</script>";

/** `html` with {@link SECURE_CONTEXT_SHIM} first in its `<head>` (unchanged when it has none). */
export function withShim(html: string): string {
  const at = html.search(/<head(\s[^>]*)?>/i);
  if (at < 0) return html;
  const end = html.indexOf('>', at) + 1;
  return html.slice(0, end) + SECURE_CONTEXT_SHIM + html.slice(end);
}

/* -------------------------------------------------------------------------- */
/* The join and refusal pages                                                 */
/* -------------------------------------------------------------------------- */

const esc = (text: string): string => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const PAGE_CSS = `
:root { color-scheme: light dark; --bg: #f7f6f3; --card: #fff; --fg: #1f1e1d; --muted: #6b6a66; --line: #e3e1dc; --accent: #c96442; }
@media (prefers-color-scheme: dark) { :root { --bg: #1f1e1d; --card: #2a2927; --fg: #f2f1ee; --muted: #a8a6a0; --line: #3a3936; } }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; padding: 16px; }
main { width: min(420px, 100%); background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 28px; }
h1 { font-size: 20px; margin: 0 0 8px; word-break: break-word; }
p { margin: 0 0 16px; color: var(--muted); }
label { display: block; font-size: 13px; margin: 0 0 6px; color: var(--muted); }
input { width: 100%; font: inherit; padding: 9px 11px; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: inherit; margin: 0 0 14px; }
button { width: 100%; font: inherit; font-weight: 600; padding: 10px; border: 0; border-radius: 8px; background: var(--accent); color: #fff; cursor: pointer; }
.note { font-size: 12px; margin: 14px 0 0; }
a { color: var(--accent); overflow-wrap: anywhere; }
`;

function sendPage(res: ServerResponse, status: number, title: string, body: string): void {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${PAGE_CSS}</style></head><body><main>${body}</main></body></html>`;
  send(res, status, html, 'text/html; charset=utf-8', { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'" });
}

interface Words {
  noAccessTitle: string;
  noAccess: string;
  goneTitle: string;
  gone: string;
  invited(what: string): string;
  yourName: string;
  open: string;
  note: string;
  roles: Record<ShareRole, string>;
  youOwn: string;
  openIt: string;
  tryRole(what: string): string;
}

const EN: Words = {
  noAccessTitle: 'No access',
  noAccess: 'This artifact is not shared with you. Ask its owner for a link.',
  goneTitle: 'This link does not work',
  gone: 'The link was turned off or replaced, or the artifact is no longer shared. Ask its owner for a new one.',
  invited: (what) => `You were invited to ${what} this artifact.`,
  yourName: 'Your name (others see it on your comments and edits)',
  open: 'Open it',
  note: 'This browser keeps your place; the owner can remove it at any time.',
  roles: { editor: 'edit', commenter: 'comment on', viewer: 'view' },
  youOwn: 'This is yours: on this computer you are its owner.',
  openIt: 'Open it',
  tryRole: (what) => `To see what someone invited to ${what} it sees, open the link at the network address:`,
};

const ZH: Words = {
  noAccessTitle: '无权访问',
  noAccess: '这个 artifact 没有分享给你。请向所有者要一个链接。',
  goneTitle: '链接已失效',
  gone: '这个链接已被关闭或重置，或者已停止分享。请向所有者要一个新链接。',
  invited: (what) => `你被邀请${what}这个 artifact。`,
  yourName: '你的名字（别人会在你的评论和编辑上看到它）',
  open: '打开',
  note: '这个浏览器会记住你的身份；所有者可以随时移除。',
  roles: { editor: '编辑', commenter: '评论', viewer: '查看' },
  youOwn: '这是你的：在这台电脑上你是所有者。',
  openIt: '打开',
  tryRole: (what) => `想看看受邀${what}的人看到什么，用局域网地址打开这个链接：`,
};

const words = (req: IncomingMessage): Words => (/^zh\b/i.test(String(req.headers['accept-language'] ?? '')) ? ZH : EN);
