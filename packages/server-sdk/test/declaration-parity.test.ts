/**
 * Frame-host and `types check` both read a type's `// artifact.json` block as literal data (frame-host's
 * `parseDeclaration`, the protocol's `readStaticDeclaration`); nothing is run. The values below are what the block
 * gives when a browser runs it (they were checked against a V8 context when frame-host still evaluated the block), so
 * reading it statically changed nothing a type declares.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readStaticDeclaration } from '@open-artifact/protocol';
import { parseDeclaration } from '../src/frame/declaration.ts';

const page = (block: string): string => `<!doctype html>\n<script>\n// artifact.json\n${block}\n// the page follows\nboot();\n</script>`;

const agree: [string, { key: string | null; capabilities: Record<string, unknown>; monitoring: Record<string, unknown> }][] = [
  ['var key = "notes"; var capabilities = { db: {}, downloads: true }; var monitoring = { readyTimeoutS: 30 };', { key: 'notes', capabilities: { db: {}, downloads: true }, monitoring: { readyTimeoutS: 30 } }],
  ['var key = \'k\'\nvar capabilities = {\n  "assets": { maxBytes: 1_024, },\n  room: {},\n}\nvar monitoring = {}', { key: 'k', capabilities: { assets: { maxBytes: 1024 }, room: {} }, monitoring: {} }],
  ['var key = `plain`, capabilities = { db: {} /* the store */ }, monitoring = { list: [1, -2.5, 0x10, 017, NaN, Infinity] }', { key: 'plain', capabilities: { db: {} }, monitoring: { list: [1, -2.5, 16, 15, null, null] } }],
  ['var key = "a\\u0041\\x41\\101\\n"; var capabilities = { __proto__: { db: {} }, artifact: {} };', { key: 'aAAA\n', capabilities: { artifact: {} }, monitoring: {} }],
  ['var key = "a"; var key = "b"; var key; var extra = { nested: [[]] };', { key: 'b', capabilities: {}, monitoring: {} }],
  ['var capabilities = { db: { undefinedOption: undefined } }', { key: null, capabilities: { db: {} }, monitoring: {} }],
  [';;var key = null', { key: null, capabilities: {}, monitoring: {} }],
];

for (const [i, [block, expected]] of agree.entries()) {
  test(`declaration parity ${i + 1}: frame-host and the static reader give what the page declares`, () => {
    const html = page(block);
    const frame = parseDeclaration(html)!;
    const stat = readStaticDeclaration(html)!;
    assert.deepEqual(JSON.parse(JSON.stringify(frame)), expected);
    assert.deepEqual(JSON.parse(JSON.stringify({ key: stat.key, capabilities: stat.capabilities, monitoring: stat.monitoring })), expected);
  });
}

test('declaration parity: what the static reader refuses is not literal data', () => {
  for (const block of ['var key = "k".repeat(2)', 'var capabilities = { db: x }', 'var key = `${1}`', 'var capabilities = { ["db"]: {} }']) {
    const html = page(block);
    assert.throws(() => readStaticDeclaration(html), block);
    assert.throws(() => parseDeclaration(html), block);
  }
});

test('declaration parity: frame-host reads only var (let and const are not globals of the page)', () => {
  // The one place they differ: `types check` reads let and const so it can flag them.
  const html = page('let key = "k"; const capabilities = { db: {} }; var monitoring = { a: 1 };');
  assert.deepEqual(parseDeclaration(html), { key: null, capabilities: {}, monitoring: { a: 1 } });
  const stat = readStaticDeclaration(html)!;
  assert.equal(stat.key, 'k');
  assert.deepEqual(stat.capabilities, { db: {} });
});

test('declaration parity: both read the same block', () => {
  assert.equal(parseDeclaration('<p>none</p>'), null);
  assert.equal(readStaticDeclaration('<p>none</p>'), null);
  const html = page('var key = "k";\n// ends here\nvar capabilities = { db: {} };');
  assert.deepEqual(parseDeclaration(html)!.capabilities, {});
  assert.deepEqual(readStaticDeclaration(html)!.capabilities, {});
});
