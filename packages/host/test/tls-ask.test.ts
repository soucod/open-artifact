/**
 * The on-demand TLS ask endpoint: which names a proxy may get a certificate for (the app host, live artifacts'
 * content hosts), the brief cache, and the listener's answers over HTTP.
 */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { contentHostLabel } from '@open-artifact/protocol';
import type { Catalog } from '../src/core/catalog/catalog.ts';
import { parseConfig } from '../src/core/config.ts';
import { openCatalog } from '../src/node/host.ts';
import type { SqliteDriver } from '../src/node/sqlite.ts';
import { pageHostLabel } from '../src/core/page-host.ts';
import { parseInternalEnv, parsePageHostOnDemand, startTlsAsk, tlsAllowed, type InternalListener } from '../src/node/tls-ask.ts';

const config = parseConfig({
  OA_APP_ORIGIN: 'https://artifacts.example.com',
  OA_CONTENT_ORIGIN: 'https://{id}.oa-content.example.net',
  OA_SIGNING_KEYS: 'k'.repeat(40),
});

function get(port: number, path: string, method = 'GET'): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('tls-ask', () => {
  let dir: string;
  let catalog: Catalog;
  let driver: SqliteDriver;
  let live: string;
  let trashed: string;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'open-artifact-tls-ask-'));
    ({ catalog, driver } = await openCatalog(join(dir, 'data'), config));
    const owner = await catalog.createUser({ name: 'Owner', email: 'owner@example.com', emailVerified: true });
    live = (await catalog.createArtifact({ type: 'whiteboard', title: 'Live', ownerUser: owner.id })).id;
    trashed = (await catalog.createArtifact({ type: 'whiteboard', title: 'Gone', ownerUser: owner.id })).id;
    await catalog.trashArtifact(trashed);
  });

  after(async () => {
    driver.close();
    await rm(dir, { recursive: true, force: true });
  });

  const host = (id: string): string => `${contentHostLabel(id)}.oa-content.example.net`;

  it('allows the app host and live artifacts, nothing else', async () => {
    const allowed = tlsAllowed({ config, catalog });
    assert.equal(await allowed('artifacts.example.com'), true);
    assert.equal(await allowed('ARTIFACTS.example.com.'), true, 'case and a trailing dot do not matter');
    assert.equal(await allowed(host(live)), true);
    assert.equal(await allowed(host(trashed)), false, 'a trashed artifact gets no new certificate');
    assert.equal(await allowed(host('art_0000000000000000000000000')), false, 'an id nobody made');
    assert.equal(await allowed('art-nothing.oa-content.example.net'), false);
    assert.equal(await allowed('oa-content.example.net'), false, 'the bare content domain');
    assert.equal(await allowed(`x.${host(live)}`), false, 'a name below a content host');
    assert.equal(await allowed('example.com'), false);
    assert.equal(await allowed('evil.example.org'), false);
    assert.equal(await allowed(''), false);
    assert.equal(await allowed('artifacts.example.com:443'), false, 'a proxy asks for a name, not a host:port');
    assert.equal(await allowed('a b'), false);
  });

  it('keeps answers briefly', async () => {
    let clock = 1_000;
    let reads = 0;
    const counting: Pick<Catalog, 'getArtifact'> = {
      getArtifact: async (id) => {
        reads++;
        return catalog.getArtifact(id);
      },
    };
    const allowed = tlsAllowed({ config, catalog: counting, cacheMs: 1_000, now: () => clock });
    for (let i = 0; i < 5; i++) assert.equal(await allowed(host(live)), true);
    assert.equal(reads, 1, 'one catalog read for a burst');
    await allowed('artifacts.example.com');
    assert.equal(reads, 1, 'the app host needs no read');
    clock += 1_001;
    assert.equal(await allowed(host(live)), true);
    assert.equal(reads, 2, 'read again once the answer is stale');
  });

  it('handles a content origin with a port (development)', async () => {
    const dev = parseConfig({ OA_SIGNING_KEYS: 'k'.repeat(40) });
    const allowed = tlsAllowed({ config: dev, catalog });
    assert.equal(await allowed(`${contentHostLabel(live)}.content.localhost`), true);
    assert.equal(await allowed('localhost'), true);
  });

  it('reads OA_INTERNAL_PORT and OA_INTERNAL_BIND', () => {
    assert.equal(parseInternalEnv({}), null);
    assert.deepEqual(parseInternalEnv({ OA_INTERNAL_PORT: '4901' }), { port: 4901, bind: '127.0.0.1' });
    assert.deepEqual(parseInternalEnv({ OA_INTERNAL_PORT: '4901', OA_INTERNAL_BIND: '0.0.0.0' }), { port: 4901, bind: '0.0.0.0' });
    assert.throws(() => parseInternalEnv({ OA_INTERNAL_PORT: 'many' }), /OA_INTERNAL_PORT/);
  });

  it('refuses page hosts unless OA_PAGE_HOST_ON_DEMAND_TLS allows them', async () => {
    const page = `${pageHostLabel(live, 'a'.repeat(24))}.oa-content.example.net`;
    const asked: string[] = [];
    const pageHost = async (name: string): Promise<boolean> => {
      asked.push(name);
      return true;
    };
    const refusing = tlsAllowed({ config, catalog, pageHost });
    assert.equal(await refusing(page), false, 'by default: a page host name would reach the public CT logs');
    assert.deepEqual(asked, [], 'the engine is not even asked');
    assert.equal(await refusing(host(live)), true, 'content hosts still get theirs');
    const allowing = tlsAllowed({ config, catalog, pageHost, pageHostsOnDemand: true });
    assert.equal(await allowing(page), true);
    assert.deepEqual(asked, [page]);
    const placing = tlsAllowed({ config, catalog, pageHost: async () => false, pageHostsOnDemand: true });
    assert.equal(await placing(page), false, 'allowed, but only for a name the engine can place');
  });

  it('reads OA_PAGE_HOST_ON_DEMAND_TLS', () => {
    assert.equal(parsePageHostOnDemand({}), false);
    assert.equal(parsePageHostOnDemand({ OA_PAGE_HOST_ON_DEMAND_TLS: 'false' }), false);
    assert.equal(parsePageHostOnDemand({ OA_PAGE_HOST_ON_DEMAND_TLS: 'true' }), true);
    assert.equal(parsePageHostOnDemand({ OA_PAGE_HOST_ON_DEMAND_TLS: 'TRUE' }), true);
    assert.throws(() => parsePageHostOnDemand({ OA_PAGE_HOST_ON_DEMAND_TLS: 'sometimes' }), /OA_PAGE_HOST_ON_DEMAND_TLS/);
  });

  describe('over HTTP', () => {
    let listener: InternalListener;
    before(async () => {
      listener = await startTlsAsk({ config, catalog, port: 0, bind: '127.0.0.1' });
    });
    after(() => listener.stop());

    it('answers 200 or 404 on /tls-ask only', async () => {
      assert.equal((await get(listener.port, `/tls-ask?domain=${host(live)}`)).status, 200);
      assert.equal((await get(listener.port, '/tls-ask?domain=artifacts.example.com')).status, 200);
      assert.equal((await get(listener.port, '/tls-ask?domain=artifacts.example.com', 'HEAD')).status, 200);
      assert.equal((await get(listener.port, `/tls-ask?domain=${host(trashed)}`)).status, 404);
      assert.equal((await get(listener.port, '/tls-ask?domain=evil.example.org')).status, 404);
      assert.equal((await get(listener.port, '/tls-ask')).status, 404);
      assert.equal((await get(listener.port, '/tls-ask?domain=artifacts.example.com', 'POST')).status, 404);
      assert.equal((await get(listener.port, '/')).status, 404);
      assert.equal((await get(listener.port, '/__open-artifact/health')).status, 404, 'nothing of the app here');
    });
  });
});
