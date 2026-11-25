/**
 * A fake cloud host for the daemon's Link tests: the Link API (`/api/open-artifact.link.*`) over `node:http`, kept in
 * memory. It does what the contract in the protocol's `link.ts` says and lets a test steer it: approve or refuse a
 * device sign-in, answer `slow_down`, let access tokens run out, revoke refresh tokens, edit files as a person, send
 * events, drop the event stream, refuse acknowledgements and go offline.
 *
 * It answers as the real host does where the daemon can tell (checked against `packages/host` by
 * `remote-host.test.ts`, which runs the real one): `import` answers 201; a `files` push is checked as a whole, so one
 * refused path (`doc/`, `sheet/`, `.artifact.json`, `history/`, `_agent/`) fails it with nothing written; a push that
 * changes the file the type reads its title from answers the new `title`; and an action run with `call` sends no
 * `files` event (the host does not echo the Link's own changes). What it leaves out: event ids are `ev_…` rather than
 * the real host's numbers (both are opaque to the daemon), and it keeps no version history.
 */

import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import type { LinkArtifact, LinkEvent, LinkFile, LinkWrite, LinkWriteResult } from '@open-artifact/protocol';
import { parseTitleFrom, TITLE_FROM, valueAtPointer } from '../../type-server/src/title.ts';
import { readZip } from '../../type-server/src/unzip.ts';
import type { TypeName } from '../../type-server/src/types.ts';

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** Paths a `files` push may not write (as `linkWriteRefusal` on the real host). */
const REFUSED = /^(doc|sheet|history|_agent)(\/|$)|^\.artifact\.json$/;

/** The title an artifact's files hold (the file its type's `titleFrom` names), when the type has one. */
function titleOf(artifact: FakeArtifact): string | undefined {
  const spec = (TITLE_FROM as Record<string, string | undefined>)[artifact.type as TypeName];
  const from = spec ? parseTitleFrom(spec) : null;
  const bytes = from ? artifact.files.get(from.file) : undefined;
  if (!from || !bytes) return undefined;
  try {
    const value = valueAtPointer(JSON.parse(bytes.toString('utf8')), from.pointer);
    return typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : undefined;
  } catch {
    return undefined;
  }
}

/** A device sign-in on the fake host. */
export interface FakeDevice {
  deviceCode: string;
  userCode: string;
  state: 'pending' | 'approved' | 'denied';
  /** How many more polls are answered `slow_down`. */
  slowDowns: number;
  /** When each poll came (ms since the epoch). */
  polls: number[];
}

/** An artifact on the fake host. */
export interface FakeArtifact {
  id: string;
  type: string;
  title: string;
  files: Map<string, Buffer>;
}

/** What a `link.call` handler gets; what it returns is the answer, what it throws becomes `{code, message}`. */
export type CallHandler = (id: string, action: string, args: Record<string, unknown>) => unknown;

/** An event to send, its id given by the host when left out. */
export type NewLinkEvent = LinkEvent extends infer E ? (E extends LinkEvent ? Omit<E, 'id'> & { id?: string } : never) : never;

/** A failure a call handler throws, answered with its status. */
export class HostFailure extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** The fake host. Start it with {@link FakeHost.start}. */
export class FakeHost {
  url = '';
  private server: Server | null = null;
  private readonly sockets = new Set<Socket>();
  private readonly streams = new Set<ServerResponse>();
  readonly user = { id: 'u_kim', name: 'Kim' };
  readonly devices = new Map<string, FakeDevice>();
  /** Access token -> when it runs out (ms). */
  readonly accessTokens = new Map<string, number>();
  readonly refreshTokens = new Set<string>();
  readonly artifacts = new Map<string, FakeArtifact>();
  readonly events: LinkEvent[] = [];
  readonly acked = new Set<string>();
  /** Every `link.ack` body's ids, in order. */
  readonly ackLog: string[][] = [];
  /** The `after` of every `link.events` connection (`null`: none given). */
  readonly connects: Array<string | null> = [];
  /** Every write a `link.files` POST was sent. */
  readonly writes: LinkWrite[] = [];
  /** Every `link.call`. */
  readonly calls: Array<{ id: string; action: string; args: Record<string, unknown> }> = [];
  /** Refresh-token trades. */
  refreshes = 0;
  /** Seconds an access token lasts. */
  accessTtl = 3600;
  /** How long a refresh-token trade takes, ms (so concurrent callers overlap). */
  refreshDelayMs = 0;
  /** Seconds between device polls, as the host asks. */
  interval = 0.05;
  /** Unreachable: every connection is dropped at once. */
  offline = false;
  /** `link.ack` answers 500. */
  failAck = false;
  /** Acknowledgements refused while {@link failAck} was set. */
  failedAcks = 0;
  onCall: CallHandler = (_id, action) => ({ ok: true, action });
  /** Runs page artifacts: `hello` says `features.pages`, and `link.capabilities` answers. */
  pages = false;
  /** Every `link.capabilities` body, in order. */
  readonly capabilityLog: Array<{ id: string; capabilities: Record<string, unknown> }> = [];
  private serial = 0;

  /** Listens on a free port of 127.0.0.1. */
  async start(): Promise<this> {
    this.server = createServer((req, res) => void this.handle(req, res));
    this.server.on('connection', (socket: Socket) => {
      if (this.offline) {
        socket.destroy();
        return;
      }
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });
    await new Promise<void>((done) => this.server!.listen(0, '127.0.0.1', done));
    this.url = `http://127.0.0.1:${(this.server!.address() as { port: number }).port}`;
    return this;
  }

  close(): void {
    for (const socket of this.sockets) socket.destroy();
    this.server?.close();
  }

  /** Goes offline (dropping every connection, the event streams too) or comes back. */
  setOffline(offline: boolean): void {
    this.offline = offline;
    if (offline) {
      for (const socket of this.sockets) socket.destroy();
      this.streams.clear();
    }
  }

  /** Closes the open event streams (the daemon should connect again). */
  dropStreams(): void {
    for (const res of this.streams) res.destroy();
    this.streams.clear();
  }

  /** Open event streams. */
  get streamCount(): number {
    return this.streams.size;
  }

  /** The newest device sign-in. */
  lastDevice(): FakeDevice | undefined {
    return [...this.devices.values()].at(-1);
  }

  /** Makes every access token run out now. */
  expireAccessTokens(): void {
    for (const token of this.accessTokens.keys()) this.accessTokens.set(token, 0);
  }

  /** Makes every refresh token worthless (the person signed this computer out). */
  revokeRefreshTokens(): void {
    this.refreshTokens.clear();
    this.accessTokens.clear();
  }

  /** Sends an event (now on the open streams, and to the next connections until acknowledged). */
  emit(event: NewLinkEvent): LinkEvent {
    const full = { ...event, id: event.id ?? `ev_${String(++this.serial).padStart(4, '0')}` } as LinkEvent;
    this.events.push(full);
    for (const res of this.streams) this.send(res, full);
    return full;
  }

  /** A person changes (or, with `null`, deletes) a file on the host; a `files` event says so. */
  edit(id: string, path: string, content: string | null, author = 'user:u_kim'): LinkEvent {
    const artifact = this.artifacts.get(id);
    if (!artifact) throw new Error(`no artifact ${id}`);
    if (content === null) artifact.files.delete(path);
    else artifact.files.set(path, Buffer.from(content));
    return this.emit({ type: 'files', artifact: id, author, paths: [path] });
  }

  /** A file's text on the host, `null` when there is none. */
  text(id: string, path: string): string | null {
    return this.artifacts.get(id)?.files.get(path)?.toString('utf8') ?? null;
  }

  private manifestFiles(artifact: FakeArtifact): Record<string, LinkFile> {
    const out: Record<string, LinkFile> = {};
    for (const [path, bytes] of artifact.files) out[path] = { etag: sha256(bytes), size: bytes.length };
    return out;
  }

  private issue(): { access_token: string; refresh_token: string; expires_in: number; user: { id: string; name: string } } {
    const access = `at_${randomBytes(8).toString('hex')}`;
    const refresh = `rt_${randomBytes(8).toString('hex')}`;
    this.accessTokens.set(access, Date.now() + this.accessTtl * 1000);
    this.refreshTokens.add(refresh);
    return { access_token: access, refresh_token: refresh, expires_in: this.accessTtl, user: this.user };
  }

  private send(res: ServerResponse, event: LinkEvent): void {
    res.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const raw = Buffer.concat(chunks);
    const url = new URL(req.url ?? '/', this.url);
    const json = (status: number, body: unknown): void => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const fail = (status: number, code: string, message: string): void => json(status, { code, message });
    const body = (): Record<string, unknown> => (raw.length ? (JSON.parse(raw.toString('utf8')) as Record<string, unknown>) : {});
    const prefix = '/api/open-artifact.link.';
    if (!url.pathname.startsWith(prefix)) return fail(404, 'not_found', 'no such route');
    const route = url.pathname.slice(prefix.length);

    if (route === 'device') {
      const device: FakeDevice = { deviceCode: `dc_${randomBytes(6).toString('hex')}`, userCode: `ABCD-${String(this.devices.size + 1).padStart(4, '0')}`, state: 'pending', slowDowns: 0, polls: [] };
      this.devices.set(device.deviceCode, device);
      return json(200, {
        device_code: device.deviceCode,
        user_code: device.userCode,
        verification_uri: `${this.url}/link`,
        verification_uri_complete: `${this.url}/link?code=${device.userCode}`,
        expires_in: 600,
        interval: this.interval,
      });
    }
    if (route === 'token') {
      const ask = body();
      if (ask.grant_type === 'device_code') {
        const device = this.devices.get(String(ask.device_code));
        if (!device) return json(400, { error: 'expired_token' });
        device.polls.push(Date.now());
        if (device.slowDowns > 0) {
          device.slowDowns--;
          return json(400, { error: 'slow_down' });
        }
        if (device.state === 'denied') return json(400, { error: 'access_denied', error_description: 'The person refused.' });
        if (device.state === 'pending') return json(400, { error: 'authorization_pending' });
        this.devices.delete(device.deviceCode);
        return json(200, this.issue());
      }
      if (ask.grant_type === 'refresh_token') {
        const token = String(ask.refresh_token);
        if (!this.refreshTokens.has(token)) return json(400, { error: 'expired_token', error_description: 'Sign in again.' });
        this.refreshTokens.delete(token);
        this.refreshes++;
        if (this.refreshDelayMs) await new Promise((done) => setTimeout(done, this.refreshDelayMs));
        return json(200, this.issue());
      }
      return json(400, { error: 'access_denied' });
    }

    const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
    const until = this.accessTokens.get(bearer);
    if (!until || until <= Date.now()) return fail(401, 'unauthorized', 'Sign in.');

    switch (route) {
      case 'hello':
        return json(200, { openArtifact: 1, version: '0.12.3', user: this.user, limits: { maxBodyBytes: 50 << 20, maxFileBytes: 20 << 20 }, ...(this.pages ? { features: { pages: 1 } } : {}) });
      case 'capabilities': {
        if (!this.pages) return fail(404, 'not_found', `${route}: no such route`);
        const ask = body() as { id: string; capabilities: Record<string, unknown> };
        if (!this.artifacts.has(ask.id)) return fail(404, 'not_found', 'No such artifact.');
        this.capabilityLog.push(ask);
        return json(200, {});
      }
      case 'import': {
        const id = url.searchParams.get('id') ?? '';
        if (this.artifacts.has(id)) return fail(409, 'conflict', `${id} is here already.`);
        const files = new Map<string, Buffer>();
        for (const [name, read] of readZip(raw, 100 << 20)) {
          const path = name.split('/').slice(1).join('/');
          if (path && !path.endsWith('/')) files.set(path, read());
        }
        const artifact: FakeArtifact = { id, type: url.searchParams.get('type') ?? '', title: url.searchParams.get('title') ?? '', files };
        // As the real host: the title the content declares wins over the one in the query.
        artifact.title = titleOf(artifact) ?? artifact.title;
        this.artifacts.set(id, artifact);
        return json(201, { id, url: `${this.url}/a/${id}`, type: artifact.type, title: artifact.title, files: this.manifestFiles(artifact) } satisfies LinkArtifact);
      }
      case 'manifest': {
        const artifact = this.artifacts.get(url.searchParams.get('id') ?? '');
        if (!artifact) return fail(404, 'not_found', 'No such artifact.');
        return json(200, { id: artifact.id, title: artifact.title, files: this.manifestFiles(artifact) });
      }
      case 'files': {
        if (req.method === 'GET') {
          const bytes = this.artifacts.get(url.searchParams.get('id') ?? '')?.files.get(url.searchParams.get('path') ?? '');
          if (!bytes) return fail(404, 'not_found', 'No such file.');
          res.writeHead(200, { 'Content-Type': 'application/octet-stream', ETag: `"${sha256(bytes)}"` });
          res.end(bytes);
          return;
        }
        const ask = body() as { id?: string; writes?: LinkWrite[] };
        const artifact = this.artifacts.get(String(ask.id));
        if (!artifact) return fail(404, 'not_found', 'No such artifact.');
        const results: LinkWriteResult[] = [];
        // Checked as a whole first: one refused path fails the push, and nothing is written.
        const refused = (ask.writes ?? []).find((write) => REFUSED.test(write.path));
        if (refused) {
          this.writes.push(...(ask.writes ?? []));
          return fail(400, 'invalid_argument', `${refused.path}: a sync never writes it.`);
        }
        for (const write of ask.writes ?? []) {
          this.writes.push(write);
          const have = artifact.files.get(write.path);
          const etag = have ? sha256(have) : null;
          if (write.if_match !== undefined && write.if_match !== etag) {
            results.push({ path: write.path, conflict: true, etag });
            continue;
          }
          if (write.content === null) {
            artifact.files.delete(write.path);
            results.push({ path: write.path, etag: null });
          } else {
            const bytes = Buffer.from(write.content, 'base64');
            artifact.files.set(write.path, bytes);
            results.push({ path: write.path, etag: sha256(bytes) });
          }
        }
        const title = titleOf(artifact);
        if (title && title !== artifact.title && results.some((result) => !('conflict' in result))) {
          artifact.title = title;
          return json(200, { results, title });
        }
        return json(200, { results });
      }
      case 'events': {
        const after = url.searchParams.get('after');
        this.connects.push(after);
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
        res.write(': hello\n\n');
        const from = after ? this.events.findIndex((e) => e.id === after) + 1 : 0;
        for (const event of this.events.slice(from)) if (!this.acked.has(event.id)) this.send(res, event);
        this.streams.add(res);
        res.on('close', () => this.streams.delete(res));
        return;
      }
      case 'ack': {
        if (this.failAck) {
          this.failedAcks++;
          return fail(500, 'server_failed', 'The ack failed.');
        }
        const ids = (body().ids as string[]) ?? [];
        this.ackLog.push(ids);
        for (const id of ids) this.acked.add(id);
        return json(200, {});
      }
      case 'call': {
        const ask = body() as { id: string; action: string; args: Record<string, unknown> };
        this.calls.push(ask);
        if (!this.artifacts.has(ask.id)) return fail(404, 'not_found', 'No such artifact.');
        try {
          return json(200, await this.onCall(ask.id, ask.action, ask.args ?? {}));
        } catch (error) {
          const failure = error instanceof HostFailure ? error : new HostFailure(500, 'server_failed', String((error as Error)?.message ?? error));
          return fail(failure.status, failure.code, failure.message);
        }
      }
      case 'unpublish': {
        const id = String(body().id);
        if (!this.artifacts.delete(id)) return fail(404, 'not_found', 'No such artifact.');
        return json(200, {});
      }
      default:
        return fail(404, 'not_found', `${route}: no such route`);
    }
  }
}
