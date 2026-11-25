/**
 * What a list of people or wakes costs: the share panel, MCP's `share` people and its wakes, and the Link's artifact
 * list each run a fixed number of catalog statements however many members (or wakes, or artifacts) there are, and the
 * Link's list reads no file manifests unless asked (`?files=1`).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LINK_API_PREFIX, type LinkArtifactsResult } from '@open-artifact/protocol';
import type { Catalog } from '../src/core/catalog/catalog.ts';
import type { UserRecord } from '../src/core/types.ts';
import { makeApp } from './app-fixture.ts';
import { makeLinkHost } from './link-fixture.ts';
import { makeMcpHost } from './mcp-fixture.ts';

/** Counts the catalog's statements (a batch counts once, as one D1 call). */
function countQueries(catalog: Catalog): () => number {
  const driver = catalog.driver as unknown as Record<'all' | 'get' | 'run' | 'batch', (...args: unknown[]) => Promise<unknown>>;
  let count = 0;
  for (const name of ['all', 'get', 'run', 'batch'] as const) {
    const original = driver[name].bind(driver);
    driver[name] = (...args: unknown[]) => {
      count++;
      return original(...args);
    };
  }
  return () => count;
}

async function cost(queries: () => number, run: () => Promise<void>): Promise<number> {
  const before = queries();
  await run();
  return queries() - before;
}

test('the share panel costs the same number of queries for 1 member and for 10', async () => {
  const app = await makeApp();
  try {
    const ada = await app.person('Ada');
    const people: UserRecord[] = [];
    for (let i = 0; i < 10; i++) people.push((await app.person(`Member${i}`)).user);
    const one = await app.artifact(ada.user, { title: 'One' });
    const ten = await app.artifact(ada.user, { title: 'Ten' });
    await app.catalog.upsertGrant({ artifactId: one.id, subjectKind: 'user', subject: people[0]!.id, role: 'viewer', createdBy: ada.user.id });
    for (const person of people) await app.catalog.upsertGrant({ artifactId: ten.id, subjectKind: 'user', subject: person.id, role: 'editor', createdBy: ada.user.id });
    const queries = countQueries(app.catalog);
    const panel = (id: string) => async () => {
      const response = await app.fetch(`/api/open-artifact.artifact.share?id=${id}`, { cookie: ada.cookie });
      assert.equal(response.status, 200, await response.clone().text());
      const body = JSON.stringify(await response.json());
      assert.ok(body.includes(people[0]!.name), 'the member is listed by name');
    };
    // Warm once (the access cache), then measure.
    await panel(one.id)();
    await panel(ten.id)();
    const costOne = await cost(queries, panel(one.id));
    const costTen = await cost(queries, panel(ten.id));
    assert.equal(costTen, costOne, `1 member: ${costOne} statements, 10 members: ${costTen}`);
  } finally {
    await app.close();
  }
});

test('MCP share people and wakes cost the same number of queries for 1 and for 10', async () => {
  const host = await makeMcpHost();
  try {
    const ada = await host.person('Ada');
    const token = (await host.connect(ada.cookie)).access_token;
    const people: UserRecord[] = [];
    for (let i = 0; i < 10; i++) people.push((await host.person(`Member${i}`)).user);
    const one = await host.artifact(ada.user, undefined, { title: 'One' });
    const ten = await host.artifact(ada.user, undefined, { title: 'Ten' });
    await host.catalog.upsertGrant({ artifactId: one.id, subjectKind: 'user', subject: people[0]!.id, role: 'viewer', createdBy: ada.user.id });
    for (const person of people) await host.catalog.upsertGrant({ artifactId: ten.id, subjectKind: 'user', subject: person.id, role: 'editor', createdBy: ada.user.id });
    const queries = countQueries(host.catalog);

    const share = (id: string, expected: number) => async () => {
      const result = await host.tool(token, 'Artifact', { action: 'share', url: `open-artifact://artifact/${id}` });
      assert.ok(!result.error, JSON.stringify(result));
      assert.equal((result.people as unknown[]).filter((p) => JSON.stringify(p).includes('Member')).length, expected);
    };
    await share(one.id, 1)();
    await share(ten.id, 10)();
    const shareOne = await cost(queries, share(one.id, 1));
    const shareTen = await cost(queries, share(ten.id, 10));
    assert.equal(shareTen, shareOne, `share: 1 member ${shareOne} statements, 10 members ${shareTen}`);

    const thread = { id: 'th1', status: 'open', messages: [{ from: 'Bo', text: 'Bigger title please', at: '2026-06-01T00:00:00.000Z' }] };
    const read = (id: string) => async () => {
      const result = await host.tool(token, 'Artifact', { action: 'read', url: `open-artifact://artifact/${id}` });
      assert.ok(Array.isArray(result.messages) && result.messages.length > 0, JSON.stringify(result));
    };
    await host.catalog.appendOutbox({ artifactId: one.id, toUser: ada.user.id, kind: 'wake', payload: { threads: [thread] } });
    const wakeOne = await cost(queries, read(one.id));
    for (let i = 0; i < 10; i++) await host.catalog.appendOutbox({ artifactId: ten.id, toUser: ada.user.id, kind: 'wake', payload: { threads: [{ ...thread, id: `th${i}` }] } });
    const wakeTen = await cost(queries, read(ten.id));
    assert.equal(wakeTen, wakeOne, `wakes: 1 wake ${wakeOne} statements, 10 wakes ${wakeTen}`);
    assert.equal((await host.catalog.listOutbox(ada.user.id)).length, 0, 'every wake was taken');
  } finally {
    await host.close();
  }
});

test('the Link artifact list reads no manifests unless asked, and costs the same queries for 1 artifact and for 10', async () => {
  const host = await makeLinkHost();
  try {
    const { user: ada } = await host.person('Ada');
    const token = await host.token(ada);
    let manifests = 0;
    const manifest = host.services.files.manifest.bind(host.services.files);
    host.services.files.manifest = (id) => {
      manifests++;
      return manifest(id);
    };
    const queries = countQueries(host.catalog);
    const list = (expected: number, files = false) => async () => {
      const response = await host.fetch(`${LINK_API_PREFIX}artifacts${files ? '?files=1' : ''}`, { token: token.access });
      assert.equal(response.status, 200);
      const { artifacts } = (await response.json()) as LinkArtifactsResult;
      assert.equal(artifacts.length, expected);
      for (const artifact of artifacts) assert.equal(artifact.files === undefined, !files);
    };
    await host.artifact(ada);
    await list(1)();
    const costOne = await cost(queries, list(1));
    for (let i = 1; i < 10; i++) await host.artifact(ada);
    const costTen = await cost(queries, list(10));
    assert.equal(costTen, costOne, `1 artifact: ${costOne} statements, 10 artifacts: ${costTen}`);
    assert.equal(manifests, 0, 'no manifest read without ?files=1');
    await list(10, true)();
    assert.equal(manifests, 10, 'one per artifact when asked');
  } finally {
    await host.close();
  }
});
