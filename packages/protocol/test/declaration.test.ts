import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DeclarationError,
  capabilityStatus,
  declarationSource,
  isInsidePath,
  manifestShareProblems,
  parseLiteralDeclarations,
  readStaticDeclaration,
  renderDeclaration,
} from '../src/index.ts';

const page = (block: string, after = '// the page follows\nboot();'): string => `<!doctype html>\n<script>\n// artifact.json\n${block}\n${after}\n</script>`;
const values = (src: string): Record<string, unknown> => Object.fromEntries(parseLiteralDeclarations(src).map((b) => [b.name, b.value]));
const refused = (src: string, pattern: RegExp): void => {
  assert.throws(() => parseLiteralDeclarations(src), (e: unknown) => e instanceof DeclarationError && pattern.test(e.message), src);
};

test('declaration: var, let and const of literal data', () => {
  assert.deepEqual(values('var key = "notes"; let capabilities = { db: {} }\nconst monitoring = {}'), { key: 'notes', capabilities: { db: {} }, monitoring: {} });
  assert.deepEqual(values('var a = 1, b = "two", c;'), { a: 1, b: 'two', c: undefined });
  assert.deepEqual(values(';;\nvar a = 1;;'), { a: 1 });
});

test('declaration: strings and their escapes', () => {
  assert.equal(values(String.raw`var s = "a\nb\tc\\d\"e\'f"`).s, 'a\nb\tc\\d"e\'f');
  assert.equal(values(String.raw`var s = 'it\'s'`).s, "it's");
  assert.equal(values(String.raw`var s = "\x41B\u{1F600}\0"`).s, 'AB\u{1F600}\0');
  assert.equal(values(String.raw`var s = "\101\7\08"`).s, 'A\x07\x008');
  assert.equal(values(String.raw`var s = "\b\f\v\q"`).s, '\b\f\vq');
  assert.equal(values('var s = "one \\\ntwo"').s, 'one two');
  assert.equal(values('var s = "</script>"').s, '</script>');
  assert.equal(values('var s = `plain ${"$"} no`'.replace('${"$"}', '$')).s, 'plain $ no');
  assert.equal(values('var s = `two\nlines \\u0041`').s, 'two\nlines A');
});

test('declaration: numbers', () => {
  assert.deepEqual(values('var a = [0, -1, +2.5, .5, 5., 1e3, 1E-2, 0x1F, 0o17, 0b101, 1_000, 017, 08, -Infinity, NaN]').a, [
    0, -1, 2.5, 0.5, 5, 1000, 0.01, 31, 15, 5, 1000, 15, 8, null, null,
  ]);
  refused('var a = 1n', /BigInt/);
  refused('var a = 1__0', /malformed/);
  refused('var a = 1abc', /malformed/);
});

test('declaration: objects, arrays, comments and trailing commas', () => {
  const src = `
    var capabilities = {
      db: {},                 // trailing comment on the same line
      /* a block comment */ "assets": { maxBytes: 1024, },
      'downloads': true,
      1: "one", 2.5: 'x',
      default: null, if: false,
      list: [1, [2, { three: 3 }], ],
    };`;
  assert.deepEqual(values(src).capabilities, {
    db: {},
    assets: { maxBytes: 1024 },
    downloads: true,
    1: 'one',
    '2.5': 'x',
    default: null,
    if: false,
    list: [1, [2, { three: 3 }]],
  });
  assert.deepEqual(values('var m = { undefinedValue: undefined, nested: { deeper: { deepest: [] } } }').m, { nested: { deeper: { deepest: [] } } });
});

test('declaration: __proto__ is dropped, never set', () => {
  const v = values('var o = { __proto__: { polluted: true }, "__proto__": 1, ok: 1 }').o as Record<string, unknown>;
  assert.deepEqual(v, { ok: 1 });
  assert.equal(Object.getPrototypeOf(v), Object.prototype);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('declaration: anything but literal data is refused', () => {
  refused('var key = fetch("/x")', /reference to something else/);
  refused('var key = "a".toUpperCase()', /Member access/);
  refused('var key = "a"("b")', /call/);
  refused('var key = other', /reference/);
  refused('var c = { db: other }', /reference/);
  refused('var c = { other }', /refers to another name/);
  refused('var c = `x ${y}`', /\$\{/);
  refused('var c = { ...x }', /spread/);
  refused('var c = [...x]', /spread/);
  refused('var c = { [k]: 1 }', /computed key/);
  refused('var c = { f() {} }', /method/);
  refused('var c = { get x() { return 1 } }', /getter, setter or method/);
  refused('var c = function () {}', /reference/);
  refused('var c = () => 1', /Parentheses/);
  refused('var c = /re/', /regular expression/);
  refused('var c = 1 + 2', /expression/);
  refused('var c = "a" + "b"', /expression/);
  refused('var c = [1,,2]', /holes/);
  refused('var c = new Date()', /reference/);
  refused('key = "x"', /Only var, let and const/);
  refused('window.key = "x"', /Only var, let and const/);
  refused('var c = tag`x`', /reference/);
  refused('var c = "open', /not closed/);
  refused('var c = {', /not closed/);
  refused('var c = /* open', /not closed/);
  refused('var c = 1 2', /not literal data/);
  refused('var c = {a: 1} var d = 2', /not literal data/);
  refused('const c', /needs a value/);
  refused('let a = 1; let a = 2', /declared twice/);
  refused('var if = 1', /A name to declare/);
  refused('var c = "x"\n("y")', /call/);
});

test('declaration: a refusal names its line and column in the page', () => {
  const html = page('var key = "k";\nvar capabilities = { db: thing };');
  assert.throws(
    () => readStaticDeclaration(html),
    (e: unknown) => e instanceof DeclarationError && e.line === 5 && e.column === 26 && /line 5, column 26/.test(e.message),
  );
});

test('declaration: var again keeps the last value, a bare var keeps the earlier one', () => {
  const d = readStaticDeclaration(page('var key = "a"; var key = "b"; var key;'))!;
  assert.equal(d.key, 'b');
});

test('declaration: the block ends at the next full-line // comment', () => {
  const html = page('var key = "k";\nvar capabilities = {\n  db: {},\n  // a comment like this ends the block\n  assets: {},\n};');
  const found = declarationSource(html)!;
  assert.ok(found.terminated);
  assert.ok(!found.source.includes('assets'));
  assert.throws(() => readStaticDeclaration(html), /not closed/);
});

test('declaration: an unterminated block says so', () => {
  const html = '<script>\n// artifact.json\nvar key = "k";\nboot();\n</script>';
  assert.equal(declarationSource(html)!.terminated, false);
  assert.throws(() => readStaticDeclaration(html), /has no end/);
});

test('declaration: names other than key, capabilities and monitoring are listed, not read', () => {
  const d = readStaticDeclaration(page('var key = "k"; var extra = 1; var capabilities = "not an object";'))!;
  assert.deepEqual(d.names, ['key', 'extra', 'capabilities']);
  assert.deepEqual(d.capabilities, {});
  assert.deepEqual(d.monitoring, {});
  assert.equal(readStaticDeclaration('<p>no marker</p>'), null);
});

test('declaration: renderDeclaration round-trips and stays inside a script', () => {
  const decl = { key: 'notes', capabilities: { db: {}, downloads: { name: '</script><b>' } }, monitoring: { readyTimeoutS: 30 } };
  const text = renderDeclaration(decl, '    ');
  assert.ok(!text.includes('</script>'));
  const html = `<script>\n${text}\n    boot();\n</script>`;
  const d = readStaticDeclaration(html)!;
  assert.ok(d.terminated);
  assert.equal(d.key, 'notes');
  assert.deepEqual(d.capabilities, decl.capabilities);
  assert.deepEqual(d.monitoring, decl.monitoring);
});

test('capabilityStatus: backed, stubbed, config and unknown names', () => {
  assert.equal(capabilityStatus('db'), 'backed');
  assert.equal(capabilityStatus('self'), 'backed');
  assert.equal(capabilityStatus('tts'), 'stubbed');
  assert.equal(capabilityStatus('flags'), 'config');
  assert.equal(capabilityStatus('files'), 'unknown');
  assert.equal(capabilityStatus('toString'), 'unknown');
});

test('manifestShareProblems: required fields and a relative entry', () => {
  assert.deepEqual(manifestShareProblems({ slug: 'a', uid: 'u', name: 'A', version: '1', description: 'd' }), []);
  const codes = (m: Record<string, unknown>): string[] => manifestShareProblems(m).map((p) => p.code);
  assert.deepEqual(codes({ slug: 'a' }), ['share_field_missing', 'share_field_missing', 'share_field_missing', 'share_field_missing']);
  const base = { slug: 'a', uid: 'u', name: 'A', version: '1', description: 'd' };
  assert.deepEqual(codes({ ...base, entry: 'index.html' }), []);
  assert.deepEqual(codes({ ...base, entry: '../x.html' }), ['share_entry_outside']);
  assert.deepEqual(codes({ ...base, entry: '/abs.html' }), ['share_entry_outside']);
  assert.deepEqual(codes({ ...base, entry: { start: { command: 'node' } } }), ['share_entry_start']);
  assert.deepEqual(codes({ ...base, entry: { url: 'https://example.com' } }), ['share_entry_url']);
  assert.equal(isInsidePath('a/b.html'), true);
  assert.equal(isInsidePath('a\\b'), false);
});
