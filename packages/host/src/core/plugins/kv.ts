/**
 * The plugins' key-value store over the catalog's `plugin_kv` table (`plugin_id`, `key`, `value`, `expires_at`):
 * each plugin sees only its own keys. Values are JSON text; an expired entry reads as absent and is deleted when met
 * (and by {@link purgeExpiredPluginKv} in the host's upkeep).
 *
 * Limits (`KV_LIMITS` in the plugin contract, the same in the test kit): keys up to 512 bytes, values up to 64 KiB of
 * JSON, 10,000 live keys per plugin, listings of at most 1000 entries. Breaking one throws a `TypeError` or
 * `RangeError` into the plugin's hook.
 *
 * Platform neutral: SQL in the SQLite/Postgres common subset over a {@link SqlDriver}.
 */

import type { PluginKv } from '@open-artifact/host-plugin';
import { checkKvKey, encodeKvValue, KV_LIMITS, kvExpiry, kvFull, kvListLimit } from '@open-artifact/host-plugin/contract';
import type { SqlDriver } from '../types.ts';

interface KvRow {
  key: string;
  value: string;
  expires_at: string | null;
}

/** The key-value store of one plugin. `now` is the host's clock. */
export function createPluginKv(driver: SqlDriver, pluginId: string, options: { now?: () => Date } = {}): PluginKv {
  const now = options.now ?? (() => new Date());
  const live = '(expires_at IS NULL OR expires_at > ?)';

  return {
    async get<T = unknown>(key: string): Promise<T | null> {
      checkKvKey(key);
      const row = await driver.get<KvRow>('SELECT key, value, expires_at FROM plugin_kv WHERE plugin_id = ? AND key = ?', [pluginId, key]);
      if (!row) return null;
      if (row.expires_at !== null && row.expires_at <= now().toISOString()) {
        await driver.run('DELETE FROM plugin_kv WHERE plugin_id = ? AND key = ? AND expires_at = ?', [pluginId, key, row.expires_at]);
        return null;
      }
      return JSON.parse(row.value) as T;
    },

    async set(key, value, setOptions = {}) {
      checkKvKey(key);
      const text = encodeKvValue(value);
      const at = now();
      const expiresAt = kvExpiry(at, setOptions.ttlSeconds);
      const updated = await driver.run('UPDATE plugin_kv SET value = ?, expires_at = ? WHERE plugin_id = ? AND key = ?', [text, expiresAt, pluginId, key]);
      if (updated.changes > 0) return;
      const iso = at.toISOString();
      const count = async (): Promise<number> =>
        Number((await driver.get<{ n: number }>(`SELECT COUNT(*) AS n FROM plugin_kv WHERE plugin_id = ? AND ${live}`, [pluginId, iso]))?.n ?? 0);
      if ((await count()) >= KV_LIMITS.maxKeys) throw kvFull();
      // Expired keys do not count against the limit; clear them so the table does not grow past it either.
      await driver.run('DELETE FROM plugin_kv WHERE plugin_id = ? AND expires_at IS NOT NULL AND expires_at <= ?', [pluginId, iso]);
      await driver.run(
        'INSERT INTO plugin_kv (plugin_id, key, value, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT (plugin_id, key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at',
        [pluginId, key, text, expiresAt],
      );
    },

    async delete(key) {
      checkKvKey(key);
      await driver.run('DELETE FROM plugin_kv WHERE plugin_id = ? AND key = ?', [pluginId, key]);
    },

    async list<T = unknown>(listOptions: { prefix?: string; after?: string; limit?: number } = {}): Promise<Array<{ key: string; value: T; expiresAt: string | null }>> {
      const limit = kvListLimit(listOptions.limit);
      const where = ['plugin_id = ?', live];
      const params: Array<string | number> = [pluginId, now().toISOString()];
      if (listOptions.prefix !== undefined) {
        if (typeof listOptions.prefix !== 'string') throw new TypeError('kv: prefix is a string.');
        if (listOptions.prefix !== '') {
          // substr/length count characters in SQLite and Postgres alike; so does [...prefix].
          where.push('substr(key, 1, ?) = ?');
          params.push([...listOptions.prefix].length, listOptions.prefix);
        }
      }
      if (listOptions.after !== undefined) {
        if (typeof listOptions.after !== 'string') throw new TypeError('kv: after is a key.');
        where.push('key > ?');
        params.push(listOptions.after);
      }
      const rows = await driver.all<KvRow>(`SELECT key, value, expires_at FROM plugin_kv WHERE ${where.join(' AND ')} ORDER BY key LIMIT ?`, [...params, limit]);
      return rows.map((row) => ({ key: row.key, value: JSON.parse(row.value) as T, expiresAt: row.expires_at }));
    },
  };
}

/** Deletes every expired entry of every plugin; returns how many. For the host's upkeep. */
export async function purgeExpiredPluginKv(driver: SqlDriver, now: Date = new Date()): Promise<number> {
  return (await driver.run('DELETE FROM plugin_kv WHERE expires_at IS NOT NULL AND expires_at <= ?', [now.toISOString()])).changes;
}

/** Deletes everything a plugin stored (`plugin remove --forget`); returns how many entries. */
export async function deletePluginKv(driver: SqlDriver, pluginId: string): Promise<number> {
  return (await driver.run('DELETE FROM plugin_kv WHERE plugin_id = ?', [pluginId])).changes;
}
