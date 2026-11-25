/**
 * The Node host deletes artifacts for good: the owner's "delete from the trash" (`artifacts.purge`) and the upkeep's
 * purge of what has been in the trash longer than `OA_TRASH_DAYS`. Both remove `<dataDir>/artifacts/<id>` (and only
 * that: a folder swapped for a symbolic link loses only the link) and the catalog rows; an artifact open in the type
 * server is closed first.
 */

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { request, type IncomingHttpHeaders } from 'node:http';
import { createServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { HomeBoot } from '@open-artifact/protocol';
import { parseConfig } from '../src/core/config.ts';
import { parseNodeEnv } from '../src/node/env.ts';
import { startHost, type RunningHost } from '../src/node/host.ts';
import { bootOf, HOME_HTML } from './app-fixture.ts';

interface Answer {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

function call(port: number, method: string, url: string, headers: Record<string, string> = {}, body?: string): Promise<Answer> {
  const target = new URL(url);
  return new Promise((resolvePromise, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path: target.pathname + target.search, headers: { host: target.host, ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolvePromise({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((done) => probe.listen(0, '127.0.0.1', done));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((done) => probe.close(() => done()));
  return port;
}

const until = async (check: () => boolean | Promise<boolean>, ms = 5000): Promise<boolean> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return true;
    await new Promise((done) => setTimeout(done, 25));
  }
  return check();
};

describe('the Node host deletes artifacts for good', () => {
  let dir: string;
  let host: RunningHost;
  let port: number;
  let app: string;
  let cookie: string;
  let userId: string;
  const lines: string[] = [];

  /** A whiteboard artifact of the user, with its folder. */
  const make = async (title: string): Promise<{ id: string; root: string }> => {
    const row = await host.catalog.createArtifact({ type: 'whiteboard', title, ownerUser: userId });
    const root = join(dir, 'data', 'artifacts', row.id);
    await mkdir(join(root, 'db', 'elements'), { recursive: true });
    await writeFile(join(root, '.artifact.json'), JSON.stringify({ type: 'whiteboard', id: row.id, title }));
    await writeFile(join(root, 'db', 'elements', 'n1.json'), JSON.stringify({ type: 'note', x: 0, y: 0, text: 'hi' }));
    return { id: row.id, root };
  };
  const post = (path: string, body: unknown): Promise<Answer> => call(port, 'POST', app + path, { cookie, origin: app, 'content-type': 'application/json' }, JSON.stringify(body));

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'open-artifact-host-purge-'));
    const assets = join(dir, 'assets');
    await mkdir(join(assets, 'editors', 'whiteboard'), { recursive: true });
    await writeFile(join(assets, 'editors', 'whiteboard', 'index.html'), '<!doctype html><html><head></head><body></body></html>');
    await writeFile(join(assets, 'support.js'), '/* runtime */');
    const ui = join(dir, 'ui');
    for (const page of ['shell', 'home']) {
      await mkdir(join(ui, page), { recursive: true });
      await writeFile(join(ui, page, 'index.html'), page === 'home' ? HOME_HTML : '<!doctype html>');
    }
    port = await freePort();
    app = `http://localhost:${port}`;
    const config = parseConfig({ OA_APP_ORIGIN: app, OA_CONTENT_ORIGIN: `http://{id}.content.localhost:${port}`, OA_SIGNING_KEYS: 'p'.repeat(40), OA_OWNER_KEY: 'owner-key-for-the-purge-test-0123456789' });
    const env = parseNodeEnv({ OA_DATA_DIR: join(dir, 'data'), OA_PORT: String(port), OA_BIND: '127.0.0.1', OA_ASSETS_DIR: assets });
    host = await startHost({ config, env, uiDir: ui, trashDays: 1, upkeepMs: 200, log: (line) => lines.push(line) });
    const user = await host.catalog.createUser({ name: 'Pat', email: 'pat@example.com', emailVerified: true });
    userId = user.id;
    cookie = `oa_session=${(await host.catalog.createSession({ userId, ttlMs: 3600_000 })).token}`;
  });

  after(async () => {
    await host?.stop();
    await rm(dir, { recursive: true, force: true });
  });

  it('the home page says how long the trash keeps artifacts and how large an upload may be', async () => {
    const home = await call(port, 'GET', `${app}/`, { cookie });
    assert.equal(home.status, 200, home.body);
    const boot = bootOf(home.body, '__OPEN_ARTIFACT_HOME__') as HomeBoot;
    assert.equal(boot.cloud?.trashDays, 1);
    assert.deepEqual(boot.cloud?.limits, { importBytes: 100 * 1024 * 1024 });
  });

  it('purges from the trash on the owner\'s word, closing the open artifact first', async () => {
    const { id, root } = await make('To purge');
    // Open in the type server (as a page or the Link would have it).
    const opened = await host.rooms.internal('open', { method: 'POST', body: { id, root, type: 'whiteboard', title: 'To purge' } });
    assert.equal(opened.status, 200, await opened.text());
    // Not from outside the trash.
    assert.equal((await post('/api/open-artifact.artifacts.purge', { id })).status, 409);
    assert.equal((await post('/api/open-artifact.artifacts.delete', { id })).status, 200);
    assert.ok(existsSync(root), 'the trash keeps the folder');
    const purged = await post('/api/open-artifact.artifacts.purge', { id });
    assert.equal(purged.status, 200, purged.body);
    assert.deepEqual(JSON.parse(purged.body), { purged: id });
    assert.ok(!existsSync(root), 'the folder is gone');
    assert.equal(await host.catalog.getArtifact(id), undefined);
    const health = (await (await host.rooms.internal('health')).json()) as { open: number };
    assert.equal(health.open, 0, 'the type server closed it');
  });

  it('the upkeep purges what has been in the trash longer than OA_TRASH_DAYS, and nothing else', async () => {
    const old = await make('Old');
    const recent = await make('Recent');
    const kept = await make('Kept');
    await host.catalog.trashArtifact(old.id);
    await host.catalog.trashArtifact(recent.id);
    await host.catalog.driver.run('UPDATE artifacts SET trashed_at = ? WHERE id = ?', [new Date(Date.now() - 2 * 86400_000).toISOString(), old.id]);
    assert.ok(await until(() => !existsSync(old.root), 5000), 'the old trash was not purged');
    assert.ok(await until(async () => (await host.catalog.getArtifact(old.id)) === undefined));
    assert.ok(existsSync(recent.root) && (await host.catalog.getArtifact(recent.id)) !== undefined, 'a day not passed: kept');
    assert.ok(existsSync(kept.root) && (await host.catalog.getArtifact(kept.id)) !== undefined, 'not in the trash: kept');
    assert.ok(await until(() => lines.some((line) => /1 artifact\(s\) from the trash/.test(line))), lines.join('\n'));
  });

  it('removes only the artifact folder: a symbolic link in its place goes, its target stays', async () => {
    const outside = join(dir, 'outside');
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, 'precious.txt'), 'keep me');
    const { id, root } = await make('Linked');
    await rm(root, { recursive: true });
    await symlink(outside, root);
    await host.catalog.trashArtifact(id);
    assert.equal((await post('/api/open-artifact.artifacts.purge', { id })).status, 200);
    assert.ok(!existsSync(root));
    assert.equal(await readFile(join(outside, 'precious.txt'), 'utf8'), 'keep me');
  });
});
