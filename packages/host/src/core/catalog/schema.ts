/**
 * The catalog's schema as numbered migrations.
 *
 * `migrate(driver)` applies, in order, every migration not yet recorded in
 * `schema_migrations`, each in one transaction with its record; running it
 * again does nothing. Never edit a released migration: add the next number.
 *
 * Column types are the SQLite/Postgres common subset: `TEXT` (ids, ISO-8601
 * times, JSON) and `INTEGER` (counters, booleans as 0/1). Secrets are stored
 * as SHA-256 hex only (`*_hash`); a link's token is also kept encrypted
 * (`token_enc`) so the Share panel can show it again.
 */

import type { SqlDriver } from './driver.ts';

export interface Migration {
  version: number;
  name: string;
  statements: string[];
}

export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'catalog',
    statements: [
      `CREATE TABLE users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE,
        email_verified INTEGER NOT NULL DEFAULT 0,
        avatar TEXT,
        site_role TEXT NOT NULL DEFAULT 'member',
        created_at TEXT NOT NULL,
        disabled_at TEXT
      )`,
      `CREATE TABLE identities (
        provider TEXT NOT NULL,
        subject TEXT NOT NULL,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (provider, subject)
      )`,
      `CREATE INDEX identities_user ON identities (user_id)`,
      `CREATE TABLE sessions (
        id_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        seen_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        user_agent TEXT
      )`,
      `CREATE INDEX sessions_user ON sessions (user_id)`,
      `CREATE TABLE artifacts (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        type_release TEXT,
        title TEXT NOT NULL,
        owner_user TEXT NOT NULL,
        workspace_id TEXT,
        general_access TEXT NOT NULL DEFAULT 'restricted',
        settings_json TEXT NOT NULL DEFAULT '{}',
        grants_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        trashed_at TEXT
      )`,
      `CREATE INDEX artifacts_owner ON artifacts (owner_user)`,
      `CREATE TABLE grants (
        artifact_id TEXT NOT NULL,
        subject_kind TEXT NOT NULL,
        subject TEXT NOT NULL,
        role TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT,
        PRIMARY KEY (artifact_id, subject_kind, subject)
      )`,
      `CREATE INDEX grants_subject ON grants (subject_kind, subject)`,
      `CREATE TABLE links (
        id TEXT PRIMARY KEY,
        artifact_id TEXT NOT NULL,
        role TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        token_enc TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        UNIQUE (artifact_id, role)
      )`,
      `CREATE TABLE guests (
        id TEXT PRIMARY KEY,
        link_id TEXT NOT NULL,
        artifact_id TEXT NOT NULL,
        name TEXT NOT NULL,
        secret_hash TEXT NOT NULL UNIQUE,
        joined_at TEXT NOT NULL,
        seen_at TEXT
      )`,
      `CREATE INDEX guests_link ON guests (link_id)`,
      `CREATE INDEX guests_artifact ON guests (artifact_id)`,
      `CREATE TABLE agent_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        label TEXT NOT NULL,
        harness TEXT,
        scopes TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        refresh_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        access_expires_at TEXT NOT NULL,
        used_at TEXT,
        revoked_at TEXT
      )`,
      `CREATE INDEX agent_tokens_user ON agent_tokens (user_id)`,
      `CREATE TABLE device_codes (
        device_code_hash TEXT PRIMARY KEY,
        user_code TEXT NOT NULL UNIQUE,
        client_json TEXT NOT NULL,
        status TEXT NOT NULL,
        user_id TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        poll_interval INTEGER NOT NULL,
        last_polled_at TEXT
      )`,
      `CREATE TABLE oauth_clients (
        id TEXT PRIMARY KEY,
        metadata_url TEXT,
        name TEXT NOT NULL,
        redirect_uris TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE TABLE oauth_codes (
        code_hash TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        code_challenge TEXT NOT NULL,
        scopes TEXT NOT NULL,
        resource TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT
      )`,
      `CREATE TABLE outbox (
        id INTEGER PRIMARY KEY,
        artifact_id TEXT NOT NULL,
        to_user TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        delivered_at TEXT,
        acked_at TEXT
      )`,
      `CREATE INDEX outbox_user ON outbox (to_user, id)`,
      `CREATE TABLE audit (
        id TEXT PRIMARY KEY,
        at TEXT NOT NULL,
        actor_kind TEXT NOT NULL,
        actor_id TEXT,
        artifact_id TEXT,
        action TEXT NOT NULL,
        detail_json TEXT,
        ip TEXT
      )`,
      `CREATE INDEX audit_at ON audit (at)`,
      `CREATE INDEX audit_artifact ON audit (artifact_id, at)`,
      `CREATE TABLE site (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`,
    ],
  },
  {
    version: 2,
    name: 'user-groups',
    // Identity-provider groups of a user (`<provider>:<group>` each, JSON), refreshed at each sign-in.
    statements: ['ALTER TABLE users ADD COLUMN groups_json TEXT'],
  },
  {
    version: 3,
    name: 'link-members-and-pins',
    // Decision 20: a signed-in user who opens a share link gets a guest row with their user id (and no cookie); the
    // link's role counts for them while the link works. Pins are kept per person.
    statements: [
      'ALTER TABLE guests ADD COLUMN user_id TEXT',
      'CREATE INDEX guests_user ON guests (user_id, artifact_id)',
      `CREATE TABLE pins (
        user_id TEXT NOT NULL,
        artifact_id TEXT NOT NULL,
        pinned_at TEXT NOT NULL,
        PRIMARY KEY (user_id, artifact_id)
      )`,
      'CREATE INDEX pins_artifact ON pins (artifact_id)',
    ],
  },
  {
    version: 5,
    name: 'link-refresh-tokens',
    // Link (decision 24: v5): a refresh token runs out (90 days, rolling), and the one it replaced is remembered so a
    // reused old refresh token can revoke the whole agent token.
    statements: [
      'ALTER TABLE agent_tokens ADD COLUMN refresh_expires_at TEXT',
      'ALTER TABLE agent_tokens ADD COLUMN prev_refresh_hash TEXT',
      'CREATE INDEX agent_tokens_prev_refresh ON agent_tokens (prev_refresh_hash)',
    ],
  },
  {
    version: 6,
    name: 'mcp-oauth',
    // Remote MCP (M1): how a client came to be known (a metadata document fetched and cached, registered by itself,
    // or listed in the config), and which agent tokens an OAuth grant made, for whom and for which resource (the
    // audience: only such tokens work on `/mcp`, and only for that resource).
    statements: [
      'ALTER TABLE oauth_clients ADD COLUMN kind TEXT',
      'ALTER TABLE oauth_clients ADD COLUMN client_uri TEXT',
      'ALTER TABLE oauth_clients ADD COLUMN fetched_at TEXT',
      `CREATE TABLE oauth_grants (
        token_id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        resource TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      'CREATE INDEX oauth_grants_user ON oauth_grants (user_id)',
      // What an MCP agent last saw of an artifact's files (path → etag), to tell it which files changed since.
      `CREATE TABLE mcp_seen (
        token_id TEXT NOT NULL,
        artifact_id TEXT NOT NULL,
        files_json TEXT NOT NULL,
        seen_at TEXT NOT NULL,
        PRIMARY KEY (token_id, artifact_id)
      )`,
    ],
  },
  {
    version: 7,
    name: 'oauth-code-grants',
    // Remote MCP: which authorization code a grant came from, and when a used code was presented again, so a reused
    // code revokes the tokens issued from it (OAuth 2.1, section 4.1.3), even ones issued after the reuse was seen.
    statements: [
      'ALTER TABLE oauth_grants ADD COLUMN code_hash TEXT',
      'CREATE INDEX oauth_grants_code ON oauth_grants (code_hash)',
      'ALTER TABLE oauth_codes ADD COLUMN replayed_at TEXT',
    ],
  },
  {
    version: 8,
    name: 'plugin-kv',
    // Host plugins (decision 50): each plugin's private key-value store (`core/plugins/kv.ts`). `value` is JSON text;
    // `expires_at` an ISO-8601 time or null.
    statements: [
      `CREATE TABLE plugin_kv (
        plugin_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        expires_at TEXT,
        PRIMARY KEY (plugin_id, key)
      )`,
      'CREATE INDEX plugin_kv_expires ON plugin_kv (expires_at)',
    ],
  },
  {
    version: 9,
    name: 'session-provider',
    // A session records the provider (and subject) that signed it in; `per_request` is 1 for one a plugin's
    // `auth.authenticate` made from the request itself, which is asked again on each request (`auth/session.ts`).
    // Sessions of plugin-made accounts from before this cannot say which identity made them, so they end: the plugin
    // signs the person in again on their next request.
    statements: [
      'ALTER TABLE sessions ADD COLUMN provider TEXT',
      'ALTER TABLE sessions ADD COLUMN subject TEXT',
      'ALTER TABLE sessions ADD COLUMN per_request INTEGER NOT NULL DEFAULT 0',
      "DELETE FROM sessions WHERE user_id IN (SELECT user_id FROM identities WHERE provider LIKE 'plugin:%')",
    ],
  },
  {
    version: 10,
    name: 'site-types',
    // Artifact types published to the site (`site-types.ts`). `uid` is the package's own uid and stays with the type
    // across versions; `id` is what artifacts name in their `type`, one per site. `visibility` is `private`, `site` or
    // `link` (who may list and download it; anyone who can open an artifact of it runs it). `unpublished` 1 is a
    // delisted type whose artifacts still run. `capabilities` and `network` are JSON arrays read from the package.
    statements: [
      `CREATE TABLE types (
        uid TEXT PRIMARY KEY,
        id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        description TEXT NOT NULL,
        publisher_user TEXT NOT NULL,
        visibility TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        capabilities TEXT NOT NULL,
        network TEXT NOT NULL,
        unpublished INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      'CREATE INDEX types_publisher ON types (publisher_user)',
    ],
  },
];

/** Applies the migrations not yet applied; returns the versions it applied. */
export async function migrate(driver: SqlDriver, migrations: readonly Migration[] = MIGRATIONS): Promise<number[]> {
  await driver.run('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  const rows = await driver.all<{ version: number }>('SELECT version FROM schema_migrations');
  const applied = new Set(rows.map((row) => Number(row.version)));
  const done: number[] = [];
  for (const migration of [...migrations].sort((a, b) => a.version - b.version)) {
    if (applied.has(migration.version)) continue;
    await driver.batch([
      ...migration.statements.map((sql) => ({ sql })),
      { sql: 'INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', params: [migration.version, migration.name, new Date().toISOString()] },
    ]);
    done.push(migration.version);
  }
  return done;
}
