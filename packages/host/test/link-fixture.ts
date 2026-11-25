/**
 * A host for the Link tests: a fresh catalog (node:sqlite in a temp folder) on a movable clock, the Link routes on a
 * router, real artifact files over a temp data folder, a fake import (bytes are JSON `{type, title, files?}`) and a
 * fake action runner, and helpers for people, sessions, tokens and event streams.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { LINK_API_PREFIX, OpenArtifactError, type LinkEvent } from '@open-artifact/protocol';
import { isTypeName, readArtifactTitle } from '@open-artifact/type-server';
import { Catalog } from '../src/core/catalog/catalog.ts';
import { parseConfig } from '../src/core/config.ts';
import { HostEvents, type HostEventMap } from '../src/core/events.ts';
import { Router, sessionCookie, type BaseCtx } from '../src/core/http.ts';
import { LinkPresenceCounter } from '../src/core/link/presence.ts';
import { linkApiRoutes } from '../src/core/link/routes.ts';
import { startLinkFeed } from '../src/core/link/outbox.ts';
import type { LinkServices } from '../src/core/link/services.ts';
import type { ArtifactRow, HostConfig, UserRecord } from '../src/core/types.ts';
import { createArtifactFiles } from '../src/node/files.ts';
import { openSqlite } from '../src/node/sqlite.ts';

export const SIGNING_KEY = 's'.repeat(40);

export interface LinkHost {
  config: HostConfig;
  catalog: Catalog;
  events: HostEvents;
  ctx: BaseCtx;
  services: LinkServices;
  presence: LinkPresenceCounter;
  dataDir: string;
  /** Actions the fake runner was asked for. */
  actions: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  refreshed: string[];
  /** Artifacts whose folder `removeArtifact` removed. */
  removed: string[];
  heard: { [N in keyof HostEventMap]: HostEventMap[N][] };
  logs: string[];
  advance(ms: number): void;
  /** A request to the Link routes; `token` sends `Authorization: Bearer`. */
  fetch(path: string, init?: { method?: string; token?: string; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal; cookie?: string; origin?: string | null }): Promise<Response>;
  /** `POST /api/open-artifact.link.<name>` with a JSON body. */
  call(name: string, token: string, body?: unknown): Promise<Response>;
  person(name: string): Promise<{ user: UserRecord; cookie: string }>;
  /** A Link token for a user, issued directly. */
  token(user: UserRecord, scopes?: string[]): Promise<{ id: string; access: string; refresh: string }>;
  /** An artifact owned by `owner` with files on disk. */
  artifact(owner: UserRecord, files?: Record<string, string>, patch?: { type?: string; title?: string }): Promise<ArtifactRow>;
  close(): Promise<void>;
}

export async function makeLinkHost(options: { action?: LinkServices['action']; deviceRate?: { limit: number; windowMs: number }; pages?: LinkServices['pages'] } = {}): Promise<LinkHost> {
  const dir = await mkdtemp(join(tmpdir(), 'open-artifact-host-link-'));
  const dataDir = join(dir, 'data');
  await mkdir(join(dataDir, 'artifacts'), { recursive: true });
  const driver = openSqlite(join(dir, 'catalog.db'));
  const config = parseConfig({ OA_SIGNING_KEYS: SIGNING_KEY });
  let clock = new Date('2026-06-01T00:00:00.000Z');
  const now = (): Date => clock;
  const catalog = await Catalog.open(driver, { signingKeys: config.signingKeys, now });
  const events = new HostEvents();
  const heard = { 'artifact-touched': [], 'artifact-changed': [], 'access-changed': [], outbox: [] } as unknown as LinkHost['heard'];
  const record = <N extends keyof HostEventMap>(name: N): void => {
    events.on(name, (payload) => {
      heard[name].push(payload);
    });
  };
  for (const name of Object.keys(heard) as (keyof HostEventMap)[]) record(name);
  const logs: string[] = [];
  const actions: LinkHost['actions'] = [];
  const refreshed: string[] = [];
  const removed: string[] = [];
  const rootOf = (id: string): string => join(dataDir, 'artifacts', id);
  const presence = new LinkPresenceCounter();
  const services: LinkServices = {
    files: createArtifactFiles(rootOf),
    async importArchive(id, bytes) {
      let parsed: { type?: string; title?: string; files?: Record<string, string>; bad?: boolean };
      try {
        parsed = JSON.parse(new TextDecoder().decode(bytes)) as typeof parsed;
      } catch {
        throw new OpenArtifactError('invalid_archive', 'Not a zip.', { status: 400 });
      }
      if (parsed.bad) throw new OpenArtifactError('not_artifact', 'Not an artifact archive.', { status: 400 });
      for (const [path, text] of Object.entries(parsed.files ?? { 'index.html': '<h1>hi</h1>' })) {
        await mkdir(dirname(join(rootOf(id), path)), { recursive: true });
        await writeFile(join(rootOf(id), path), text);
      }
      return { type: parsed.type ?? 'whiteboard', title: parsed.title ?? 'Imported' };
    },
    async removeArtifact(id) {
      removed.push(id);
      await rm(rootOf(id), { recursive: true, force: true });
    },
    async archive(id, method) {
      return new Response(method === 'HEAD' ? null : `PK-${id}`, { headers: { 'content-type': 'application/zip' } });
    },
    action:
      options.action ??
      (async (id, name, args) => {
        actions.push({ id, name, args });
        if (name === 'nope') throw new OpenArtifactError('method_not_found', `No action ${name}.`, { status: 404 });
        return { ok: true, name };
      }),
    contentTitle: async (id, type) => (isTypeName(type) ? (await readArtifactTitle(rootOf(id), type)) || undefined : undefined),
    async refreshAccess(id) {
      refreshed.push(id);
    },
    presence,
    events,
    version: '0.0.0-test',
    ...(options.pages ? { pages: options.pages } : {}),
  };
  const stopFeed = startLinkFeed({ catalog, events, log: (line) => logs.push(line) });
  const ctx: BaseCtx = { config, catalog, now, log: (line) => logs.push(line) };
  const router = linkApiRoutes(new Router(), services, options.deviceRate ? { deviceRate: options.deviceRate } : {});
  const session = sessionCookie(config).name;

  const host: LinkHost = {
    config,
    catalog,
    events,
    ctx,
    services,
    presence,
    dataDir,
    actions,
    refreshed,
    removed,
    heard,
    logs,
    advance(ms) {
      clock = new Date(clock.getTime() + ms);
    },
    async fetch(path, init = {}) {
      const method = init.method ?? (init.body === undefined ? 'GET' : 'POST');
      const headers = new Headers(init.headers);
      if (init.token) headers.set('authorization', `Bearer ${init.token}`);
      if (init.cookie) headers.set('cookie', init.cookie);
      if (init.origin) headers.set('origin', init.origin);
      let body: BodyInit | undefined;
      if (init.body instanceof Uint8Array || typeof init.body === 'string') body = init.body as BodyInit;
      else if (init.body !== undefined) {
        body = JSON.stringify(init.body);
        if (!headers.has('content-type')) headers.set('content-type', 'application/json');
      }
      const url = path.startsWith('http') ? path : `${config.appOrigin}${path}`;
      return router.handle(new Request(url, { method, headers, ...(body === undefined ? {} : { body }), ...(init.signal ? { signal: init.signal } : {}) }), ctx);
    },
    call(name, token, body = {}) {
      return host.fetch(`${LINK_API_PREFIX}${name}`, { method: 'POST', token, body });
    },
    async person(name) {
      const user = await catalog.createUser({ name, email: `${name.toLowerCase()}@example.com`, emailVerified: true });
      const { token } = await catalog.createSession({ userId: user.id, ttlMs: 30 * 24 * 3600_000 });
      return { user, cookie: `${session}=${token}` };
    },
    async token(user, scopes = ['link']) {
      const issued = await catalog.issueAgentToken({ userId: user.id, label: 'test', scopes, accessTtlMs: 3600_000, refreshTtlMs: 90 * 24 * 3600_000 });
      return { id: issued.token.id, access: issued.accessToken, refresh: issued.refreshToken };
    },
    async artifact(owner, files = { 'index.html': '<h1>Board</h1>' }, patch = {}) {
      const row = await catalog.createArtifact({ type: patch.type ?? 'whiteboard', title: patch.title ?? 'Board', ownerUser: owner.id });
      for (const [path, text] of Object.entries(files)) {
        await mkdir(dirname(join(rootOf(row.id), path)), { recursive: true });
        await writeFile(join(rootOf(row.id), path), text);
      }
      await mkdir(rootOf(row.id), { recursive: true });
      return row;
    },
    async close() {
      stopFeed();
      driver.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
  return host;
}

/** Base64 of UTF-8 text. */
export const b64 = (text: string): string => Buffer.from(text, 'utf8').toString('base64');

/** Reads server-sent events from a response body, one parsed `data:` at a time. */
export class EventReader {
  readonly #reader: ReadableStreamDefaultReader<Uint8Array>;
  readonly #decoder = new TextDecoder();
  #buffer = '';
  #pending: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;
  readonly comments: string[] = [];

  constructor(response: Response) {
    if (!response.body) throw new Error('no body');
    this.#reader = response.body.getReader();
  }

  /** The next event, or throws after `timeoutMs`. */
  async next(timeoutMs = 2000): Promise<LinkEvent> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const end = this.#buffer.indexOf('\n\n');
      if (end !== -1) {
        const frame = this.#buffer.slice(0, end);
        this.#buffer = this.#buffer.slice(end + 2);
        const data = frame.split('\n').filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).join('\n');
        if (!data) {
          this.comments.push(frame);
          continue;
        }
        return JSON.parse(data) as LinkEvent;
      }
      const left = deadline - Date.now();
      if (left <= 0) throw new Error('no event in time');
      let timer: ReturnType<typeof setTimeout> | undefined;
      const chunk = await Promise.race([
        (this.#pending ??= this.#reader.read()),
        new Promise<'timeout'>((resolve) => {
          timer = setTimeout(() => resolve('timeout'), left);
        }),
      ]);
      clearTimeout(timer);
      if (chunk === 'timeout') throw new Error('no event in time');
      this.#pending = null;
      if (chunk.done) throw new Error('the stream ended');
      this.#buffer += this.#decoder.decode(chunk.value, { stream: true });
    }
  }

  /** Resolves when no event arrives for `ms`; throws if one does. */
  async none(ms = 150): Promise<void> {
    let event: LinkEvent | null = null;
    try {
      event = await this.next(ms);
    } catch {
      return;
    }
    throw new Error(`unexpected event ${JSON.stringify(event)}`);
  }

  async cancel(): Promise<void> {
    await this.#reader.cancel().catch(() => undefined);
  }
}

/** Waits until `check` passes. */
export async function until(check: () => boolean | Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
