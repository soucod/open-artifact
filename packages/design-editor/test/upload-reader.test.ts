import assert from 'node:assert/strict';
import { it } from 'node:test';
import { readUploadFiles } from '../src/lib/upload-reader.ts';

/** A response that never sends its body, until the request is aborted. */
function hanging(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new Error('aborted'))));
}

it('reads uploads a few at a time and keeps their bytes and types', async () => {
  let inFlight = 0;
  let most = 0;
  const urls = Array.from({ length: 7 }, (_, i) => `http://host/_blob/${i}`);
  const { found, skipped } = await readUploadFiles(urls, {
    concurrency: 3,
    request: async (input) => {
      inFlight++;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return new Response(Uint8Array.of(String(input).length), { headers: { 'content-type': 'image/png' } });
    },
  });
  assert.equal(most, 3);
  assert.equal(found.size, 7);
  assert.equal(skipped.size, 0);
  assert.equal(found.get(urls[0]!)?.type, 'image/png');
  assert.deepEqual([...found.get(urls[0]!)!.data], [urls[0]!.length]);
});

it('cuts off a download that stops responding and skips the ones not yet started', async () => {
  const started: string[] = [];
  const { found, skipped } = await readUploadFiles(['a', 'b', 'c', 'd'], {
    concurrency: 1,
    idleMs: 20,
    request: async (input, init) => {
      started.push(String(input));
      return String(input) === 'b' ? hanging(init?.signal) : new Response('ok');
    },
  });
  assert.deepEqual(started, ['a', 'b']);
  assert.deepEqual([...found.keys()], ['a']);
  assert.deepEqual(Object.fromEntries(skipped), { b: 'stalled', c: 'after-stall', d: 'after-stall' });
});

it('cuts off a body that stops between parts, and lists a failed request as unreadable', async () => {
  const { found, skipped } = await readUploadFiles(['slow', 'gone'], {
    concurrency: 2,
    idleMs: 20,
    request: async (input, init) => {
      if (String(input) === 'gone') return new Response('', { status: 404 });
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Uint8Array.of(1));
          init?.signal?.addEventListener('abort', () => controller.error(new Error('aborted')));
        },
      });
      return new Response(body);
    },
  });
  assert.equal(found.size, 0);
  assert.equal(skipped.get('slow'), 'stalled');
  assert.equal(skipped.get('gone'), 'unreadable');
});

it('gives up on a download that runs past the total limit even while bytes keep coming', async () => {
  const { skipped } = await readUploadFiles(['trickle'], {
    idleMs: 50,
    totalMs: 30,
    request: async (_input, init) => {
      let timer: ReturnType<typeof setInterval> | undefined;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          timer = setInterval(() => controller.enqueue(Uint8Array.of(0)), 5);
          init?.signal?.addEventListener('abort', () => {
            clearInterval(timer);
            controller.error(new Error('aborted'));
          });
        },
      });
      return new Response(body);
    },
  });
  assert.equal(skipped.get('trickle'), 'stalled');
});
