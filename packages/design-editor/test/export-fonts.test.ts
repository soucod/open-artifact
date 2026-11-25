import assert from 'node:assert/strict';
import { it } from 'node:test';
import { ExportFonts } from '../src/lib/export-fonts.ts';

it('embeds offline fonts for the text used, caches downloads and writes license notices', async () => {
  const calls: string[] = [];
  const fonts = new ExportFonts(async input => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith('https://fonts.googleapis.com')) return new Response("@font-face{font-family:'Source Serif 4';src:url(https://fonts.gstatic.com/a.woff2);unicode-range:U+0020-007F}@font-face{src:url(https://fonts.gstatic.com/unused.woff2);unicode-range:U+3040-309F}");
    return new Response(Uint8Array.of(1, 2));
  });
  const link = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Serif+4">';
  const points = new Set([65]);
  assert.match(await fonts.inline(link, points), /data:font\/woff2;base64,AQI=/);
  await fonts.inline(link, points);
  assert.equal(calls.length, 2);
  assert.match(await fonts.notice(), /Source Serif 4[\s\S]*Copyright[\s\S]*OPEN FONT LICENSE/i);
});

const points = new Set([65]);
const sheetLink = (family: string) => `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=${family}">`;
const never = (signal: AbortSignal | null | undefined) => new Promise<never>((_, reject) => {
  signal?.addEventListener('abort', () => reject(signal.reason));
});
const stalledBody = (signal: AbortSignal | null | undefined) => new ReadableStream<Uint8Array>({
  start(controller) { signal?.addEventListener('abort', () => controller.error(signal.reason)); },
});

it('stops waiting on a font host that never answered', async () => {
  const calls: string[] = [];
  const fonts = new ExportFonts(async (input, init) => {
    calls.push(String(input));
    return never(init?.signal);
  }, 30);
  assert.equal(await fonts.inline(sheetLink('A'), points), sheetLink('A'));
  const started = Date.now();
  assert.equal(await fonts.inline(sheetLink('B'), points), sheetLink('B'));
  assert.ok(Date.now() - started < 25);
  assert.equal(calls.length, 1);
  assert.deepEqual([...fonts.missing], ['A', 'B']);
});

it('keeps asking a host that answered but sent a font too slowly', async () => {
  const fontCalls: string[] = [];
  const fonts = new ExportFonts(async (input, init) => {
    const url = new URL(String(input));
    if (url.host === 'fonts.googleapis.com') {
      return new Response(`@font-face{src:url(https://fonts.gstatic.com/${url.searchParams.get('family')}.woff2);unicode-range:U+0020-007F}`);
    }
    fontCalls.push(url.pathname);
    return new Response(stalledBody(init?.signal));
  }, 30);
  assert.equal(await fonts.inline(sheetLink('A'), points), sheetLink('A'));
  assert.equal(await fonts.inline(sheetLink('B'), points), sheetLink('B'));
  assert.deepEqual(fontCalls, ['/A.woff2', '/B.woff2']);
});
