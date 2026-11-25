/**
 * What remote MCP keeps in the catalog's database beyond the catalog's own methods (migration 6): how each OAuth
 * client came to be known, which agent tokens an OAuth grant made (and for which resource), what an MCP agent last
 * saw of an artifact's files, and the claiming of wakes from the outbox.
 *
 * Plain SQL over the catalog's {@link SqlDriver}, in the SQLite/Postgres common subset, like the catalog.
 */

import type { Catalog } from '../catalog/catalog.ts';
import { sha256Hex } from '../crypto.ts';
import type { OutboxRecord, SqlDriver } from '../types.ts';

/** How a client came to be known. */
export type OAuthClientKind = 'cimd' | 'dcr' | 'config';

/** An OAuth client as remote MCP knows it. */
export interface McpClientRecord {
  id: string;
  name: string;
  redirectUris: string[];
  kind: OAuthClientKind;
  /** The metadata document (`cimd`: the client id itself). */
  metadataUrl: string | null;
  /** The client's home page, when it named one. */
  clientUri: string | null;
  createdAt: string;
  /** When the metadata document was last fetched (`cimd`). */
  fetchedAt: string | null;
}

/** The OAuth grant behind an agent token. */
export interface McpGrantRecord {
  tokenId: string;
  clientId: string;
  userId: string;
  resource: string;
  createdAt: string;
}

/** One connected app as the account page lists it. */
export interface ConnectedAppRecord {
  tokenId: string;
  clientId: string;
  clientName: string;
  clientUri: string | null;
  scopes: string[];
  createdAt: string;
  usedAt: string | null;
}

interface ClientRow {
  id: string;
  metadata_url: string | null;
  name: string;
  redirect_uris: string;
  created_at: string;
  kind: string | null;
  client_uri: string | null;
  fetched_at: string | null;
}

const parseList = (text: string): string[] => {
  try {
    const value = JSON.parse(text) as unknown;
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
};

const toClient = (r: ClientRow): McpClientRecord => ({
  id: r.id,
  name: r.name,
  redirectUris: parseList(r.redirect_uris),
  kind: r.kind === 'cimd' || r.kind === 'config' ? r.kind : 'dcr',
  metadataUrl: r.metadata_url,
  clientUri: r.client_uri,
  createdAt: r.created_at,
  fetchedAt: r.fetched_at,
});

export class McpStore {
  readonly #driver: SqlDriver;
  readonly #catalog: Pick<Catalog, 'driver' | 'claimOutbox' | 'claimOutboxForMcp'>;
  readonly #now: () => Date;

  constructor(catalog: Pick<Catalog, 'driver' | 'claimOutbox' | 'claimOutboxForMcp'>, now: () => Date = () => new Date()) {
    this.#driver = catalog.driver;
    this.#catalog = catalog;
    this.#now = now;
  }

  #iso(offsetMs = 0): string {
    return new Date(this.#now().getTime() + offsetMs).toISOString();
  }

  // ---- Clients ------------------------------------------------------------------------------------------------------

  async getClient(id: string): Promise<McpClientRecord | undefined> {
    const row = await this.#driver.get<ClientRow>('SELECT * FROM oauth_clients WHERE id = ?', [id]);
    return row && toClient(row);
  }

  /** Adds a client, or replaces what is known of it (a metadata document fetched again, a config client changed). */
  async putClient(input: { id: string; name: string; redirectUris: readonly string[]; kind: OAuthClientKind; metadataUrl?: string | null; clientUri?: string | null; fetched?: boolean }): Promise<McpClientRecord> {
    const now = this.#iso();
    await this.#driver.run(
      `INSERT INTO oauth_clients (id, metadata_url, name, redirect_uris, created_at, kind, client_uri, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET metadata_url = excluded.metadata_url, name = excluded.name, redirect_uris = excluded.redirect_uris, kind = excluded.kind, client_uri = excluded.client_uri, fetched_at = excluded.fetched_at`,
      [input.id, input.metadataUrl ?? null, input.name, JSON.stringify(input.redirectUris), now, input.kind, input.clientUri ?? null, input.fetched ? now : null],
    );
    return (await this.getClient(input.id))!;
  }

  /** How many clients registered themselves since `sinceMs` ago (the registration rate limit, across instances). */
  async registrationsSince(sinceMs: number): Promise<number> {
    const row = await this.#driver.get<{ n: number }>("SELECT COUNT(*) AS n FROM oauth_clients WHERE kind = 'dcr' AND created_at > ?", [this.#iso(-sinceMs)]);
    return Number(row?.n ?? 0);
  }

  // ---- Grants -------------------------------------------------------------------------------------------------------

  /** Records which grant an agent token came from; `code` is the authorization code it was exchanged for. */
  async addGrant(input: { tokenId: string; clientId: string; userId: string; resource: string; code?: string }): Promise<void> {
    await this.#driver.run('INSERT INTO oauth_grants (token_id, client_id, user_id, resource, created_at, code_hash) VALUES (?, ?, ?, ?, ?, ?)', [
      input.tokenId,
      input.clientId,
      input.userId,
      input.resource,
      this.#iso(),
      input.code === undefined ? null : await sha256Hex(input.code),
    ]);
  }

  /**
   * Marks a used authorization code as presented again (the first time is kept). True when the code is one this host
   * issued and someone exchanged already: then it is a replay, and the tokens issued from it are to be revoked.
   */
  async markCodeReplayed(code: string): Promise<boolean> {
    const { changes } = await this.#driver.run('UPDATE oauth_codes SET replayed_at = COALESCE(replayed_at, ?) WHERE code_hash = ? AND used_at IS NOT NULL', [this.#iso(), await sha256Hex(code)]);
    return changes === 1;
  }

  /** Whether a code was presented again after its exchange (see {@link markCodeReplayed}). */
  async codeReplayed(code: string): Promise<boolean> {
    const row = await this.#driver.get<{ replayed_at: string | null }>('SELECT replayed_at FROM oauth_codes WHERE code_hash = ?', [await sha256Hex(code)]);
    return Boolean(row?.replayed_at);
  }

  /** The agent tokens issued from an authorization code (one, unless something went wrong). */
  async tokensOfCode(code: string): Promise<string[]> {
    const rows = await this.#driver.all<{ token_id: string }>('SELECT token_id FROM oauth_grants WHERE code_hash = ?', [await sha256Hex(code)]);
    return rows.map((row) => row.token_id);
  }

  /** The grant an agent token came from; undefined for tokens OAuth did not issue (a Link's). */
  async grantOf(tokenId: string): Promise<McpGrantRecord | undefined> {
    const row = await this.#driver.get<{ token_id: string; client_id: string; user_id: string; resource: string; created_at: string }>('SELECT * FROM oauth_grants WHERE token_id = ?', [tokenId]);
    return row && { tokenId: row.token_id, clientId: row.client_id, userId: row.user_id, resource: row.resource, createdAt: row.created_at };
  }

  /** A user's unrevoked OAuth grants with their clients, newest first. */
  async connectedApps(userId: string): Promise<ConnectedAppRecord[]> {
    const rows = await this.#driver.all<{ token_id: string; client_id: string; name: string | null; client_uri: string | null; scopes: string; created_at: string; used_at: string | null }>(
      `SELECT g.token_id, g.client_id, c.name, c.client_uri, t.scopes, t.created_at, t.used_at
         FROM oauth_grants g JOIN agent_tokens t ON t.id = g.token_id LEFT JOIN oauth_clients c ON c.id = g.client_id
        WHERE g.user_id = ? AND t.revoked_at IS NULL ORDER BY t.created_at DESC, g.token_id`,
      [userId],
    );
    return rows.map((r) => ({ tokenId: r.token_id, clientId: r.client_id, clientName: r.name ?? r.client_id, clientUri: r.client_uri, scopes: parseList(r.scopes), createdAt: r.created_at, usedAt: r.used_at }));
  }

  // ---- What an agent last saw ---------------------------------------------------------------------------------------

  async seen(tokenId: string, artifactId: string): Promise<Record<string, string> | null> {
    const row = await this.#driver.get<{ files_json: string }>('SELECT files_json FROM mcp_seen WHERE token_id = ? AND artifact_id = ?', [tokenId, artifactId]);
    if (!row) return null;
    try {
      const value = JSON.parse(row.files_json) as unknown;
      return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, string>) : null;
    } catch {
      return null;
    }
  }

  async saw(tokenId: string, artifactId: string, files: Record<string, string>): Promise<void> {
    await this.#driver.run(
      'INSERT INTO mcp_seen (token_id, artifact_id, files_json, seen_at) VALUES (?, ?, ?, ?) ON CONFLICT (token_id, artifact_id) DO UPDATE SET files_json = excluded.files_json, seen_at = excluded.seen_at',
      [tokenId, artifactId, JSON.stringify(files), this.#iso()],
    );
  }

  // ---- Wakes --------------------------------------------------------------------------------------------------------

  /** A user's wakes no one has taken yet (not sent to a Link, not taken by an MCP call), oldest first. */
  async openWakes(userId: string, artifactId?: string, limit = 20): Promise<OutboxRecord[]> {
    const rows = await this.#driver.all<{ id: number; artifact_id: string; to_user: string; kind: string; payload_json: string; created_at: string; delivered_at: string | null; acked_at: string | null }>(
      `SELECT * FROM outbox WHERE to_user = ? AND kind = 'wake' AND delivered_at IS NULL AND acked_at IS NULL${artifactId ? ' AND artifact_id = ?' : ''} ORDER BY id LIMIT ?`,
      artifactId ? [userId, artifactId, limit] : [userId, limit],
    );
    return rows.map((r) => {
      let payload: unknown = null;
      try {
        payload = JSON.parse(r.payload_json);
      } catch {
        payload = null;
      }
      return { id: Number(r.id), artifactId: r.artifact_id, toUser: r.to_user, kind: r.kind, payload, createdAt: r.created_at, deliveredAt: r.delivered_at, ackedAt: r.acked_at };
    });
  }

  /**
   * Takes one wake for an MCP caller ({@link Catalog.claimOutbox} with `mcp`, the same atomic claim a Link stream
   * makes before it sends a wake): false when a Link or another MCP call took it first.
   */
  claimWake(id: number, userId: string): Promise<boolean> {
    return this.#catalog.claimOutbox(id, userId, 'mcp');
  }

  /** {@link claimWake} for several wakes in one statement: the ids this caller took. */
  claimWakes(ids: readonly number[], userId: string): Promise<number[]> {
    return this.#catalog.claimOutboxForMcp(ids, userId);
  }
}
