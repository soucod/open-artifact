/**
 * The archive of a remote type is capped (`remote-archive.ts`): the zip Link publishes, held in memory whole, at
 * `REMOTE_ARCHIVE_MAX`, and a refused answer's body at `REMOTE_ERROR_MAX`. Past either the daemon stops reading and
 * fails with `server_failed` naming the address. A type on this computer is not capped.
 *
 * As in `remote-types.test.ts`, the stub listens on 127.0.0.1 and the types reach it as `http://0.0.0.0:<port>`,
 * which is not a loopback name, so the daemon treats them as remote; the same stub reached as 127.0.0.1 is local.
 */

import { tempDir } from './helpers.ts';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { artifactIdOf, type ArtifactRecord, type DaemonState, type ToolCallResult } from '@open-artifact/protocol';
import { api, readDaemon } from '../src/client.ts';
import { startDaemon, type Daemon } from '../src/daemon.ts';
import { REMOTE_ARCHIVE_MAX, REMOTE_ERROR_MAX, readCapped } from '../src/remote-archive.ts';

let daemon: Daemon;
let state: DaemonState;
let stub: Server;
let port = 0;
/** Bytes the stub wrote for the streamed (undeclared) oversized zip before the daemon stopped reading. */
let streamed = 0;

function addType(id: string, url: string): void {
  const dir = join(process.env.OPEN_ARTIFACT_USER_TYPES!, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'artifact-type.json'), JSON.stringify({ name: id, description: `${id} for the archive cap.`, entry: { url, open: true } }));
}

before(async () => {
  stub = createServer((req, res) => {
    req.resume();
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    const [, kind, route] = path.split('/');
    if (route !== '__open-artifact') return void res.writeHead(404).end();
    const tail = path.split('/__open-artifact/')[1];
    if (tail === 'health') return void res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ openArtifact: 1, type: kind }));
    if (tail === 'open') return void res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ url: `http://0.0.0.0:${port}/${kind}/page` }));
    if (tail !== 'archive') return void res.writeHead(404, { 'Content-Type': 'application/json' }).end('{"code":"not_found","message":"no"}');
    // A small zip, as it should be.
    if (kind === 'ok' || kind === 'near') return void res.writeHead(200, { 'Content-Type': 'application/zip' }).end('PK');
    // Says it is larger than the cap: refused before a byte of it is read.
    if (kind === 'declared') {
      res.writeHead(200, { 'Content-Type': 'application/zip', 'Content-Length': String(REMOTE_ARCHIVE_MAX + 1) });
      res.write(Buffer.alloc(1024));
      return;
    }
    // Says nothing and streams on: refused once past the cap.
    if (kind === 'stream') {
      res.writeHead(200, { 'Content-Type': 'application/zip' });
      const chunk = Buffer.alloc(1024 * 1024);
      const more = (): void => {
        while (!res.destroyed && streamed <= REMOTE_ARCHIVE_MAX + 16 * chunk.length) {
          streamed += chunk.length;
          if (!res.write(chunk)) return void res.once('drain', more);
        }
        res.end();
      };
      res.on('close', () => undefined);
      return more();
    }
    // A refused answer with an unbounded body.
    if (kind === 'loud') return void res.writeHead(500, { 'Content-Type': 'application/json' }).end(`{"code":"x","message":"${'y'.repeat(REMOTE_ERROR_MAX * 4)}"}`);
    // A refused answer of a fair size keeps its code and message.
    if (kind === 'fair') return void res.writeHead(413, { 'Content-Type': 'application/json' }).end('{"code":"too_large","message":"fair: the folder is too large to zip."}');
    res.writeHead(404).end();
  });
  port = await new Promise<number>((done) => stub.listen(0, '127.0.0.1', () => done((stub.address() as { port: number }).port)));
  for (const kind of ['ok', 'declared', 'stream', 'loud', 'fair']) addType(`arc${kind}`, `http://0.0.0.0:${port}/${kind}/{id}`);
  addType('arcnear', `http://127.0.0.1:${port}/near/{id}`);
  const shellDir = tempDir('open-artifact-shell-');
  writeFileSync(join(shellDir, 'index.html'), '<!doctype html><title>shell</title>');
  daemon = await startDaemon({ port: 0, quiet: true, shellDir, homeDir: tempDir('open-artifact-no-home-') });
  state = (await readDaemon())!;
});

after(() => {
  daemon.close();
  stub.closeAllConnections();
  stub.close();
});

const who = { harness: 'archive-app', session: 'a1', workspace: tempDir('open-artifact-ws-') };

async function made(type: string): Promise<ArtifactRecord> {
  const result = await api<ToolCallResult>(state, 'tools.call', { name: 'Artifact', arguments: { action: 'publish', type_url: `open-artifact://type/${type}`, title: type }, caller: who });
  assert.equal(result.error, undefined, JSON.stringify(result.error));
  return daemon.store.get(artifactIdOf(String(result.url)))!;
}

/** The zip Link publishes (the daemon's own `archiveBytes`). */
const archiveBytes = (record: ArtifactRecord): Promise<Uint8Array> => (daemon as unknown as { archiveBytes(r: ArtifactRecord): Promise<Uint8Array> }).archiveBytes(record);

test('readCapped: the whole body under the cap; null past it, declared or streamed', async () => {
  assert.deepEqual(await readCapped(new Response('abc'), 3), new TextEncoder().encode('abc'));
  assert.equal(await readCapped(new Response('abcd'), 3), null);
  assert.equal(await readCapped(new Response('a', { headers: { 'content-length': '99' } }), 3), null);
});

test('a remote zip within the cap is read whole; a local type is not capped', async () => {
  assert.equal(new TextDecoder().decode(await archiveBytes(await made('arcok'))), 'PK');
  assert.equal(new TextDecoder().decode(await archiveBytes(await made('arcnear'))), 'PK');
});

test('a remote zip past the cap fails server_failed naming the address, declared or streamed', async () => {
  await assert.rejects(archiveBytes(await made('arcdeclared')), (error: { code?: string; message?: string }) => {
    assert.equal(error.code, 'server_failed');
    assert.ok(error.message?.includes(`http://0.0.0.0:${port}/declared/__open-artifact/archive answered a zip of more than 128 MiB`), error.message);
    return true;
  });
  await assert.rejects(archiveBytes(await made('arcstream')), (error: { code?: string; message?: string }) => {
    assert.equal(error.code, 'server_failed');
    assert.ok(error.message?.includes(`http://0.0.0.0:${port}/stream/__open-artifact/archive answered a zip of more than 128 MiB`), error.message);
    return true;
  });
  // It stopped reading: the stub did not get to write all it would have.
  assert.ok(streamed < REMOTE_ARCHIVE_MAX + 16 * 1024 * 1024, `${streamed}`);
});

test('a remote refused answer with an unbounded body fails server_failed; a fair one keeps its code', async () => {
  const loud = await made('arcloud');
  await assert.rejects(archiveBytes(loud), (error: { code?: string; message?: string }) => {
    assert.equal(error.code, 'server_failed');
    assert.ok(error.message?.includes(`http://0.0.0.0:${port}/loud/__open-artifact/archive answered an error (500) of more than 64 KiB`), error.message);
    return true;
  });
  // The same through the Library's archive route.
  const zip = await fetch(`${state.url}/api/open-artifact.artifact.archive?id=${loud.id}`, { headers: { origin: state.url } });
  const said = (await zip.json()) as { code?: string; message?: string };
  assert.equal(said.code, 'server_failed', JSON.stringify(said));
  await assert.rejects(archiveBytes(await made('arcfair')), (error: { code?: string; message?: string }) => error.code === 'too_large' && /fair: the folder/.test(error.message ?? ''));
});
