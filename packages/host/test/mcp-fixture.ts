/**
 * A host for the remote MCP tests: a fresh catalog (node:sqlite in a temp folder) on a movable clock, the MCP handler
 * (`/mcp`, discovery, `/oauth/*`) with real artifact files over a temp data folder, fake types and a fake action
 * runner that keeps comment threads and db documents, a stub client-metadata fetcher, and helpers for people,
 * the whole OAuth code flow and JSON-RPC calls.
 */

import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { OpenArtifactError } from '@open-artifact/protocol';
import { AccessCache } from '../src/core/authz/access.ts';
import { Catalog } from '../src/core/catalog/catalog.ts';
import { parseConfig } from '../src/core/config.ts';
import { HostEvents } from '../src/core/events.ts';
import { Router, sessionCookie, type BaseCtx } from '../src/core/http.ts';
import { parseMcpConfig, type McpConfig } from '../src/core/mcp/config.ts';
import { connectedAppRoutes } from '../src/core/mcp/oauth.ts';
import { mcpHandler } from '../src/core/mcp/routes.ts';
import type { McpServices, McpTypeInfo } from '../src/core/mcp/services.ts';
import type { ArtifactRow, HostConfig, UserRecord } from '../src/core/types.ts';
import { createArtifactFiles } from '../src/node/files.ts';
import { openSqlite } from '../src/node/sqlite.ts';

export const APP = 'https://app.example';
export const CIMD_ID = 'https://client.example/oauth/client.json';
export const CIMD_REDIRECT = 'https://client.example/callback';
export const CONFIG_CLIENT = 'desk-app';
export const CONFIG_REDIRECT = 'http://127.0.0.1:7777/callback';

/** A PKCE verifier and its S256 challenge. */
export function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

const TYPES: McpTypeInfo[] = [
  {
    id: 'whiteboard',
    title: 'Whiteboard',
    description: 'A board of sticky notes and shapes.',
    intents: ['whiteboard', 'board', 'brainstorm'],
    exports: ['png'],
    uses: [],
    store: null,
    comments: true,
    artifactTitle: 'Untitled board',
    openEarly: false,
    actions: [
      { name: 'check', title: 'Check the files', effect: 'read', schema: { type: 'object', properties: {} } },
      { name: 'tidy', title: 'Tidy the board', effect: 'write', schema: { type: 'object', properties: { gap: { type: 'integer' } }, additionalProperties: false } },
    ],
  },
  {
    id: 'docs',
    title: 'Docs',
    description: 'A document of tabs.',
    intents: ['doc', 'document', 'report'],
    exports: ['docx'],
    uses: [],
    store: 'doc',
    comments: true,
    openEarly: false,
    actions: [{ name: 'read', title: 'Read the doc', effect: 'read' }],
  },
  {
    id: 'data',
    title: 'Data',
    description: 'Dashboards kept as JSON documents.',
    intents: ['dashboard', 'data'],
    exports: [],
    uses: ['whiteboard'],
    store: 'db',
    comments: true,
    openEarly: true,
    actions: [{ name: 'check', title: 'Check the files', effect: 'read' }],
  },
];

interface FakeThread {
  id: string;
  agent?: boolean;
  status: 'open' | 'resolved';
  messages: Array<{ from: string; text: string; at: string }>;
}

export interface McpHost {
  config: HostConfig;
  mcp: McpConfig;
  catalog: Catalog;
  events: HostEvents;
  ctx: BaseCtx;
  services: McpServices;
  dataDir: string;
  /** Actions the fake runner was asked for. */
  actions: Array<{ id: string; name: string; args: Record<string, unknown> }>;
  /** Comment threads per artifact (the fake type server's). */
  threads: Map<string, FakeThread[]>;
  /** Client metadata documents the stub fetcher serves, by URL. */
  documents: Map<string, { status?: number; body: string; headers?: Record<string, string> }>;
  fetched: string[];
  advance(ms: number): void;
  /** A request to the MCP handler (or, for `/api/`, the connected-apps routes). */
  fetch(path: string, init?: { method?: string; token?: string; body?: unknown; form?: Record<string, string>; headers?: Record<string, string>; cookie?: string; origin?: string | null }): Promise<Response>;
  person(name: string): Promise<{ user: UserRecord; cookie: string }>;
  /** Runs the whole code flow for a person and returns the token answer. */
  connect(cookie: string, options?: { clientId?: string; redirectUri?: string; scope?: string }): Promise<{ access_token: string; refresh_token: string; scope: string; expires_in: number }>;
  /** One JSON-RPC request to `/mcp`; the parsed answer. */
  rpc(token: string, method: string, params?: unknown, headers?: Record<string, string>): Promise<{ status: number; body: Record<string, unknown> }>;
  /** A `tools/call`; the tool's result (the JSON of its first text content). */
  tool(token: string, name: string, args: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** An artifact owned by `owner` with files on disk. */
  artifact(owner: UserRecord, files?: Record<string, string>, patch?: { type?: string; title?: string }): Promise<ArtifactRow>;
  close(): Promise<void>;
}

export async function makeMcpHost(options: { env?: Record<string, string>; waitCapMs?: number; registrationRate?: { limit: number; windowMs: number } } = {}): Promise<McpHost> {
  const dir = await mkdtemp(join(tmpdir(), 'open-artifact-host-mcp-'));
  const dataDir = join(dir, 'data');
  await mkdir(join(dataDir, 'artifacts'), { recursive: true });
  const driver = openSqlite(join(dir, 'catalog.db'));
  const config = parseConfig({ OA_APP_ORIGIN: APP, OA_SIGNING_KEYS: 's'.repeat(40) });
  const mcp = parseMcpConfig(
    {
      OA_OAUTH_CLIENTS: JSON.stringify([{ client_id: CONFIG_CLIENT, client_name: 'Desk App', redirect_uris: [CONFIG_REDIRECT] }]),
      ...options.env,
    },
    config,
  );
  let clock = new Date('2026-06-01T00:00:00.000Z');
  const now = (): Date => clock;
  const catalog = await Catalog.open(driver, { signingKeys: config.signingKeys, now });
  const events = new HostEvents();
  const rootOf = (id: string): string => join(dataDir, 'artifacts', id);
  const actions: McpHost['actions'] = [];
  const threads = new Map<string, FakeThread[]>();
  const docs = new Map<string, Map<string, unknown>>();
  const documents: McpHost['documents'] = new Map([
    [
      CIMD_ID,
      {
        body: JSON.stringify({ client_id: CIMD_ID, client_name: 'Client <b>Example</b>', redirect_uris: [CIMD_REDIRECT], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'] }),
      },
    ],
  ]);
  const fetched: string[] = [];
  const services: McpServices = {
    types: {
      list: () => TYPES,
      get: (id) => TYPES.find((t) => t.id === id) ?? null,
      skill: (id) => `# ${id}\nWrite index.html.`,
    },
    async create({ id, type, title }) {
      await mkdir(rootOf(id), { recursive: true });
      await writeFile(join(rootOf(id), '.artifact.json'), JSON.stringify({ type, id, title, release: null }));
      if (type === 'whiteboard') {
        await mkdir(join(rootOf(id), 'project'), { recursive: true });
        await writeFile(join(rootOf(id), 'project', 'board.json'), JSON.stringify({ title }));
      }
    },
    files: createArtifactFiles(rootOf),
    async action(id, name, args) {
      actions.push({ id, name, args });
      const list = threads.get(id) ?? [];
      switch (name) {
        case 'check':
          return { problems: 0 };
        case 'tidy':
          return { tidied: true };
        case 'open-artifact.comments.read':
          return { threads: args.all ? list : list.filter((t) => t.status !== 'resolved'), sent_tracked: true };
        case 'open-artifact.comments.reply': {
          const thread = list.find((t) => t.id === args.thread_id);
          if (!thread) throw new OpenArtifactError('not_found', 'No thread.', { status: 404 });
          thread.messages.push({ from: 'agent', text: String(args.text), at: clock.toISOString() });
          if (args.resolve) thread.status = 'resolved';
          return { thread_id: thread.id };
        }
        case 'open-artifact.comments.resolve': {
          const thread = list.find((t) => t.id === args.thread_id);
          if (!thread) throw new OpenArtifactError('not_found', 'No thread.', { status: 404 });
          thread.status = args.reopen ? 'open' : 'resolved';
          return { thread_id: thread.id, status: thread.status };
        }
        case 'open-artifact.db.read': {
          const store = docs.get(id) ?? new Map();
          const path = String(args.path ?? '');
          if (store.has(path)) return { path, exists: true, data: store.get(path), sha256: 'a'.repeat(64) };
          return { docs: [...store].filter(([p]) => p.startsWith(path)).map(([p, data]) => ({ path: p, data, sha256: 'a'.repeat(64) })), query: true };
        }
        case 'open-artifact.db.write': {
          const store = docs.get(id) ?? new Map();
          docs.set(id, store);
          const writes = (args.writes as Array<Record<string, unknown>>).map((w) => {
            if (w.op === 'delete') store.delete(String(w.path));
            else store.set(String(w.path), w.data);
            return { op: w.op, path: w.path, ...(w.op === 'delete' ? {} : { sha256: 'b'.repeat(64) }) };
          });
          return { writes };
        }
        default:
          throw new OpenArtifactError('unknown_action', `No action ${name}.`, { status: 404 });
      }
    },
    contentTitle: async () => undefined,
    async refreshAccess() {},
    events,
    access: new AccessCache(catalog, config, { now, groupsOf: (id) => catalog.userGroups(id) }),
    cimd: {
      async fetch(url) {
        fetched.push(url);
        const doc = documents.get(url);
        if (!doc) return new Response('missing', { status: 404 });
        return new Response(doc.body, { status: doc.status ?? 200, headers: { 'content-type': 'application/json', ...doc.headers } });
      },
      async lookup(hostname) {
        return hostname === 'internal.example' ? ['10.0.0.7'] : ['93.184.216.34'];
      },
    },
    version: '0.0.0-test',
  };
  const ctx: BaseCtx = { config, catalog, now, log: () => undefined };
  const handler = mcpHandler({ config: mcp, services, ...(options.waitCapMs ? { waitCapMs: options.waitCapMs } : {}), ...(options.registrationRate ? { registrationRate: options.registrationRate } : {}) });
  const apps = connectedAppRoutes(new Router());
  const session = sessionCookie(config).name;

  const host: McpHost = {
    config,
    mcp,
    catalog,
    events,
    ctx,
    services,
    dataDir,
    actions,
    threads,
    documents,
    fetched,
    advance(ms) {
      clock = new Date(clock.getTime() + ms);
    },
    async fetch(path, init = {}) {
      const headers = new Headers(init.headers);
      if (init.token) headers.set('authorization', `Bearer ${init.token}`);
      if (init.cookie) headers.set('cookie', init.cookie);
      if (init.origin) headers.set('origin', init.origin);
      let body: string | undefined;
      if (init.form) {
        body = new URLSearchParams(init.form).toString();
        headers.set('content-type', 'application/x-www-form-urlencoded');
      } else if (typeof init.body === 'string') body = init.body;
      else if (init.body !== undefined) {
        body = JSON.stringify(init.body);
        if (!headers.has('content-type')) headers.set('content-type', 'application/json');
      }
      const method = init.method ?? (body === undefined ? 'GET' : 'POST');
      const request = new Request(path.startsWith('http') ? path : `${APP}${path}`, { method, headers, ...(body === undefined ? {} : { body }) });
      return path.startsWith('/api/') ? apps.handle(request, ctx) : handler(request, ctx);
    },
    async person(name) {
      const user = await catalog.createUser({ name, email: `${name.toLowerCase()}@example.com`, emailVerified: true });
      const { token } = await catalog.createSession({ userId: user.id, ttlMs: 30 * 24 * 3600_000 });
      return { user, cookie: `${session}=${token}` };
    },
    async connect(cookie, flow = {}) {
      const clientId = flow.clientId ?? CIMD_ID;
      const redirectUri = flow.redirectUri ?? CIMD_REDIRECT;
      const { verifier, challenge } = pkce();
      const params: Record<string, string> = {
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state: 'st-1',
        resource: mcp.resource,
        ...(flow.scope ? { scope: flow.scope } : {}),
      };
      const page = await host.fetch(`/oauth/authorize?${new URLSearchParams(params)}`, { cookie });
      if (page.status !== 200) throw new Error(`consent page: ${page.status} ${await page.text()}`);
      const approved = await host.fetch('/oauth/authorize', { cookie, origin: APP, form: { ...params, decision: 'approve' } });
      const location = new URL(approved.headers.get('location') ?? '');
      const code = location.searchParams.get('code');
      if (!code) throw new Error(`no code: ${location.href}`);
      const token = await host.fetch('/oauth/token', { form: { grant_type: 'authorization_code', code, client_id: clientId, redirect_uri: redirectUri, code_verifier: verifier, resource: mcp.resource } });
      if (token.status !== 200) throw new Error(`token: ${token.status} ${await token.text()}`);
      return (await token.json()) as Awaited<ReturnType<McpHost['connect']>>;
    },
    async rpc(token, method, params, headers = {}) {
      const response = await host.fetch('/mcp', { token, headers, body: { jsonrpc: '2.0', id: 1, method, ...(params === undefined ? {} : { params }) } });
      const text = await response.text();
      return { status: response.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
    },
    async tool(token, name, args) {
      const { status, body } = await host.rpc(token, 'tools/call', { name, arguments: args });
      if (status !== 200) throw new Error(`tools/call ${name}: HTTP ${status} ${JSON.stringify(body)}`);
      const result = body.result as { content: Array<{ type: string; text: string }>; isError?: boolean };
      const parsed = JSON.parse(result.content[0]!.text) as Record<string, unknown>;
      const rest = result.content.slice(1).map((c) => c.text);
      return rest.length && !parsed.messages ? { ...parsed, messages: rest } : parsed;
    },
    async artifact(owner, files = { 'project/board.json': '{"title":"Board"}' }, patch = {}) {
      const row = await catalog.createArtifact({ type: patch.type ?? 'whiteboard', title: patch.title ?? 'Board', ownerUser: owner.id });
      await mkdir(rootOf(row.id), { recursive: true });
      for (const [path, text] of Object.entries(files)) {
        await mkdir(dirname(join(rootOf(row.id), path)), { recursive: true });
        await writeFile(join(rootOf(row.id), path), text);
      }
      return row;
    },
    async close() {
      driver.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
  return host;
}
