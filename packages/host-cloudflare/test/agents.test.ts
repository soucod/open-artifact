/**
 * The Worker's agent seams (`agents.ts`): the remote MCP's type list from the build's table is the Node host's
 * (`readMcpTypes` over `artifact-types/`), and a capped body is refused past its limit, declared or streamed.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readMcpTypes } from '@open-artifact/host/node';
import { TYPES, isTypeName } from '../../type-server/src/types.ts';
import { CLOUDFLARE_LINK_LIMITS, CLOUDFLARE_MCP_WAIT_CAP_MS, cappedRequest, mcpTypesOf } from '../src/agents.ts';
import type { TypeEntry } from '../src/site.ts';

const typesDir = fileURLToPath(new URL('../../../artifact-types', import.meta.url));

/** The table `deploy/cloudflare/build.mjs` writes: each type's id, title, manifest and skill body. */
function buildTable(): TypeEntry[] {
  const entries: TypeEntry[] = [];
  for (const folder of readdirSync(typesDir, { withFileTypes: true }).filter((d) => d.isDirectory())) {
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(readFileSync(join(typesDir, folder.name, 'artifact-type.json'), 'utf8')) as Record<string, unknown>;
    } catch {
      continue;
    }
    const id = typeof manifest.slug === 'string' ? manifest.slug : folder.name;
    if (!isTypeName(id)) continue;
    let skill: string | null = null;
    try {
      const text = readFileSync(join(typesDir, folder.name, typeof manifest.skill === 'string' ? manifest.skill : 'SKILL.md'), 'utf8');
      const front = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text);
      skill = (front ? text.slice(front[0].length) : text).trim();
    } catch {
      skill = null;
    }
    entries.push({ id, title: TYPES[id].title, manifest, skill });
  }
  return entries;
}

test('the MCP type list from the build table is what the Node host reads from artifact-types', { skip: existsSync(join(typesDir, 'design', 'artifact-type.json')) ? false : 'no built artifact-types' }, () => {
  const node = readMcpTypes(typesDir);
  const worker = mcpTypesOf(buildTable());
  assert.ok(node.list().length >= 5);
  assert.deepEqual(worker.list(), node.list());
  for (const info of node.list()) {
    assert.equal(worker.skill(info.id), node.skill(info.id), info.id);
    assert.deepEqual(worker.get(info.id), node.get(info.id), info.id);
  }
  assert.equal(worker.get('nope'), null);
});

test('a capped request: a declared length past the cap is refused at once, a streamed one when it passes it', async () => {
  const declared = new Request('http://x/', { method: 'POST', headers: { 'content-length': '11' }, body: 'hello world' });
  assert.throws(() => cappedRequest(declared, 10, 'The archive'), (error: { status?: number; message?: string }) => error.status === 413 && /The archive/.test(error.message ?? ''));

  const stream = (size: number): ReadableStream<Uint8Array> =>
    new ReadableStream({
      start(controller) {
        for (let at = 0; at < size; at += 4) controller.enqueue(new Uint8Array(Math.min(4, size - at)));
        controller.close();
      },
    });
  const fits = cappedRequest(new Request('http://x/', { method: 'POST', body: stream(10), duplex: 'half' } as RequestInit), 10);
  assert.equal((await fits.arrayBuffer()).byteLength, 10);
  const over = cappedRequest(new Request('http://x/', { method: 'POST', body: stream(11), duplex: 'half' } as RequestInit), 10);
  await assert.rejects(over.arrayBuffer());
  const empty = new Request('http://x/');
  assert.equal(cappedRequest(empty, 10), empty);
});

test('the limits a Link is told fit what a room takes, and the wait cap stays under common proxy timeouts', () => {
  assert.ok(CLOUDFLARE_LINK_LIMITS.maxFileBytes <= CLOUDFLARE_LINK_LIMITS.maxBodyBytes);
  assert.ok(CLOUDFLARE_LINK_LIMITS.maxBodyBytes <= 32 * 1024 * 1024);
  assert.ok(CLOUDFLARE_MCP_WAIT_CAP_MS > 0 && CLOUDFLARE_MCP_WAIT_CAP_MS < 30_000);
});
