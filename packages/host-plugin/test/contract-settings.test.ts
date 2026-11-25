/**
 * The contract's settings additions: the `map` and `json` setting types (written in the configuration or read from an
 * environment variable as JSON), `validate(config)` (synchronous, a sentence or a list), and `authz.cacheSeconds`.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkPlugin, runValidate, validateConfig } from '../src/contract.ts';

const SCHEMA = {
  groups: { type: 'map', default: {} },
  rules: { type: 'json' },
} as const;

test('map: an object of strings, from the configuration or as JSON from the environment; anything else is named', () => {
  const ok = validateConfig('p', SCHEMA, { groups: { design: 'a@x.com, b@x.com' }, rules: { any: [1, { deep: true }] } });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.config.groups, { design: 'a@x.com, b@x.com' });
  assert.deepEqual(ok.config.rules, { any: [1, { deep: true }] });
  const fromEnv = validateConfig('p', SCHEMA, { groups: { env: 'G' }, rules: { env: 'R' } }, { G: '{"staff":"@x.com"}', R: '[1,2]' });
  assert.deepEqual(fromEnv.errors, []);
  assert.deepEqual([fromEnv.config.groups, fromEnv.config.rules], [{ staff: '@x.com' }, [1, 2]]);
  assert.deepEqual(validateConfig('p', SCHEMA, {}).config.groups, {});
  const bad = validateConfig('p', SCHEMA, { groups: { design: 3 } });
  assert.equal(bad.errors.length, 1);
  assert.match(bad.errors[0]!, /an object of strings \(\{"name": "value"\}\)/);
  assert.equal(validateConfig('p', SCHEMA, { groups: { env: 'G' } }, { G: 'not json' }).errors.length, 1);
});

test('validate: nothing, a sentence or a list, each named by the plugin; a promise or a throw is a problem', () => {
  const make = (validate: (config: Record<string, unknown>) => unknown) => checkPlugin({ id: 'v', apiVersion: 1, validate }, 'v').plugin!;
  assert.deepEqual(runValidate(make(() => undefined), {}), []);
  assert.deepEqual(runValidate(make(() => 'set "url".'), {}), ['Plugin "v": set "url".']);
  assert.deepEqual(runValidate(make(() => ['one.', '', 'two.']), {}), ['Plugin "v": one.', 'Plugin "v": two.']);
  assert.deepEqual(runValidate(make(() => { throw new Error('bad'); }), {}), ['Plugin "v": bad']);
  assert.match(runValidate(make(async () => undefined), {})[0]!, /validate must answer at once/);
  assert.match(runValidate(make(() => 42), {})[0]!, /validate answered/);
  // It sees the checked settings, defaults filled in.
  const seen: unknown[] = [];
  runValidate(make((config) => void seen.push(config)), { a: 1 });
  assert.deepEqual(seen, [{ a: 1 }]);
});

test('authz.cacheSeconds: a number of seconds, 0 or more (capped); anything else is refused', () => {
  const good = checkPlugin({ id: 'c', apiVersion: 1, authz: { cacheSeconds: 12, role: () => undefined } }, 'c');
  assert.deepEqual(good.errors, []);
  assert.equal(good.plugin!.cacheSeconds, 12);
  const bad = checkPlugin({ id: 'c', apiVersion: 1, authz: { cacheSeconds: -1, role: () => undefined } }, 'c');
  assert.match(bad.errors.join('\n'), /authz\.cacheSeconds must be a number of seconds, 0 or more/);
});
