import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkPlugin, validateConfig } from '@open-artifact/host-plugin/contract';
import { checkEntry, parsePluginList, PluginConfigError, preparePlugin } from '../src/core/plugins/config.ts';

const SCHEMA = {
  url: { type: 'string', required: true, description: 'Where to ask' },
  secret: { type: 'secret', required: true },
  retries: { type: 'number', default: 3 },
  verbose: { type: 'boolean', default: false },
  groups: { type: 'string[]', default: [] },
  note: { type: 'string' },
} as const;

test('the plugin list: JSON, {plugins: [...]}, bare strings, every problem at once', () => {
  assert.deepEqual(parsePluginList(undefined), []);
  assert.deepEqual(parsePluginList('  '), []);
  assert.deepEqual(parsePluginList('["./a.mjs", {"use": "@acme/b", "config": {"x": 1}, "timeoutMs": 2000}]'), [
    { use: './a.mjs' },
    { use: '@acme/b', config: { x: 1 }, timeoutMs: 2000 },
  ]);
  assert.deepEqual(parsePluginList('{"plugins": [{"use": "x", "enabled": false}]}'), [{ use: 'x', enabled: false }]);

  assert.throws(() => parsePluginList('[{'), (e: unknown) => e instanceof PluginConfigError && /^OA_PLUGINS is not JSON \(.+\)\. It is a list/.test(e.message));
  assert.throws(() => parsePluginList('{"use": "x"}', 'plugins.json'), { message: 'plugins.json must be a list of plugins ([{"use": "<package or path>", "config": {…}}]), not an object.' });
  try {
    parsePluginList('[{"use": "a", "confg": {}}, {"use": ""}, {"use": "c", "timeoutMs": 0, "optional": "yes"}, 7]');
    assert.fail('should throw');
  } catch (error) {
    assert.ok(error instanceof PluginConfigError);
    assert.deepEqual(error.problems, [
      'OA_PLUGINS[0]: unknown key "confg". Did you mean "config"? An entry has use, config, enabled, optional, timeoutMs, cacheSeconds.',
      'OA_PLUGINS[1]: "use" must name the plugin\'s package or path.',
      'OA_PLUGINS[2] (c): "optional" must be true or false.',
      'OA_PLUGINS[2] (c): "timeoutMs" must be a whole number of milliseconds from 1 to 60000.',
      'OA_PLUGINS[3] must be {"use": "<package or path>", "config": {…}}, not a number.',
    ]);
    assert.match(error.message, /^The plugin configuration has 5 problems:\n- /);
  }
  assert.equal(checkEntry({ use: 'x', config: [] }, 'E').errors[0], 'E (x): "config" must be an object of settings.');
  assert.equal(checkEntry({ use: 'x', enabled: 1 }, 'E').errors[0], 'E (x): "enabled" must be true or false.');
});

test('settings: types, defaults, {env} references, parsed values', () => {
  const env = { URL: 'https://perms.example.com', SECRET: 's3cret-value', N: ' 7 ', ON: 'yes', LIST: 'a, b,,c', JLIST: '["x","y"]' };
  const ok = validateConfig('p', SCHEMA, { url: { env: 'URL' }, secret: { env: 'SECRET' }, retries: { env: 'N' }, verbose: { env: 'ON' }, groups: { env: 'LIST' } }, env);
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.warnings, []);
  assert.deepEqual({ ...ok.config }, { url: 'https://perms.example.com', secret: 's3cret-value', retries: 7, verbose: true, groups: ['a', 'b', 'c'] });
  assert.deepEqual(ok.secrets, ['s3cret-value']);
  assert.ok(Object.isFrozen(ok.config));
  assert.deepEqual(validateConfig('p', SCHEMA, { url: 'u', secret: { env: 'SECRET' }, groups: { env: 'JLIST' } }, env).config.groups, ['x', 'y']);
  for (const [text, value] of [['true', true], ['1', true], ['on', true], ['false', false], ['0', false], ['no', false], ['off', false]] as const) {
    assert.equal(validateConfig('p', SCHEMA, { url: 'u', secret: 'x', verbose: { env: 'B' } }, { B: text }).config.verbose, value);
  }
});

test('settings: every message names the plugin and the setting, and never shows a secret', () => {
  const secret = 'hunter2-very-secret';
  const messages = (values: unknown, env: Record<string, string> = {}): string[] => validateConfig('perms', SCHEMA, values, env).errors;

  assert.deepEqual(messages({}), [
    'Plugin "perms", setting "url" is required (Where to ask).',
    'Plugin "perms", setting "secret" is required.',
  ]);
  assert.deepEqual(messages({ url: '', secret: { env: 'S' } }, { S: secret }), ['Plugin "perms", setting "url" is required (Where to ask), and it is empty.']);
  assert.deepEqual(messages({ url: 'u', secret: { env: 'MISSING' } }), ['Plugin "perms", setting "secret": the environment variable MISSING is not set.']);
  assert.deepEqual(messages({ url: 'u', secret: { env: 'S' } }, { S: '' }), ['Plugin "perms", setting "secret": the environment variable S is not set.']);
  assert.deepEqual(messages({ url: 'u', secret: { env: 'bad name' } }), ['Plugin "perms", setting "secret": an environment reference is {"env": "NAME"}, with NAME letters, digits and _.']);
  assert.deepEqual(messages({ url: 'u', secret: { env: 'S', extra: 1 } }), ['Plugin "perms", setting "secret": an environment reference is {"env": "NAME"}, with NAME letters, digits and _.']);
  assert.deepEqual(messages({ url: 'u', secret: 'x', retries: 'abc' }), ['Plugin "perms", setting "retries": expected a number, got a string "abc".']);
  assert.deepEqual(messages({ url: 'u', secret: 'x', retries: { env: 'N' } }, { N: 'many' }), ['Plugin "perms", setting "retries": expected a number, the environment variable N holds something else.']);
  assert.deepEqual(messages({ url: 'u', secret: 'x', verbose: 'yes' }), ['Plugin "perms", setting "verbose": expected true or false, got a string "yes".']);
  assert.deepEqual(messages({ url: 'u', secret: 'x', groups: [1] }), ['Plugin "perms", setting "groups": expected a list of strings, got a list [1].']);
  assert.deepEqual(messages({ url: 'u', secret: 42 }), ['Plugin "perms", setting "secret": expected a string, got a number.']);
  assert.deepEqual(messages({ url: 'u', secret: 'x', urll: secret }), ['Plugin "perms": unknown setting "urll". Did you mean "url"? Its settings are: url, secret, retries, verbose, groups, note.']);
  assert.deepEqual(messages([]), ['Plugin "perms": config must be an object of settings, not a list.']);
  assert.deepEqual(validateConfig('bare', {}, { x: secret }).errors, ['Plugin "bare" takes no settings, but the configuration sets "x".']);

  const inline = validateConfig('perms', SCHEMA, { url: 'u', secret });
  assert.deepEqual(inline.warnings, ['Plugin "perms", setting "secret": the secret is written into the configuration; give it as {"env": "NAME"} to keep it out of the file.']);

  // No message, error or warning, shows the secret (also when the secret was put under a wrong name).
  const all = [
    ...messages({ url: 'u', secret: { env: 'S' }, retries: { env: 'S' } }, { S: secret }),
    ...messages({ url: 'u', sceret: secret }),
    ...inline.warnings,
  ];
  assert.ok(all.length >= 3);
  for (const message of all) assert.ok(!message.includes(secret), message);
});

test('the plugin object: API version, function exports, unknown keys and events', () => {
  const v = (apiVersion: unknown): string[] => checkPlugin({ id: 'x', apiVersion }, 'The plugin "./x.mjs"', { hostVersion: '0.12.3' }).errors;
  assert.deepEqual(v(1), []);
  assert.deepEqual(v(undefined), ['Plugin "x" does not say which plugin API it was written for: add apiVersion: 1 to the plugin object.']);
  assert.deepEqual(v('1'), ['Plugin "x" has apiVersion "1", which is not a plugin API version: it should be 1.']);
  assert.deepEqual(v(2), [
    'Plugin "x" needs plugin API version 2, but this host (Open Artifact 0.12.3) runs version 1. Update Open Artifact to a release that runs plugin API 2, or use a release of the plugin written for API 1.',
  ]);
  assert.deepEqual(v(0), ['Plugin "x" has apiVersion 0, which is not a plugin API version: it should be 1.']);

  assert.deepEqual(checkPlugin(() => ({}), 'The plugin "f"').errors, ['The plugin "f" exports a function: export the plugin object itself (export default {id, apiVersion, …}).']);
  assert.deepEqual(checkPlugin(undefined, 'The plugin "u"').errors, ['The plugin "u" does not export a plugin: its default export is undefined, not an object.']);
  assert.match(checkPlugin({ id: 'Bad_Id', apiVersion: 1 }, 'L').errors[0]!, /^L: the plugin's id must be lower-case letters, digits and - .*not "Bad_Id"\.$/);

  const checked = checkPlugin(
    {
      id: 'x',
      apiVersion: 1,
      auth: { authenticat: () => null, identity: () => undefined },
      futureHook: {},
      on: { 'share.invite': () => undefined, 'share.invited': () => undefined },
      authz: { role: 'editor' },
    },
    'L',
  );
  assert.deepEqual(checked.errors, ['Plugin "x": authz.role must be a function, not a string.']);
  assert.deepEqual(checked.warnings, [
    'Plugin "x": unknown "futureHook" ignored (this host does not know it).',
    'Plugin "x", auth: unknown "authenticat" ignored (this host does not know it). Did you mean "authenticate"?',
    'Plugin "x": unknown event "share.invite" ignored (this host does not send it). Did you mean "share.invited"?',
  ]);
});

test('preparePlugin: load errors, object errors, settings errors, timeouts', () => {
  const plugin = { id: 'p', apiVersion: 1, config: { token: { type: 'secret', required: true } }, guard: () => undefined };
  assert.deepEqual(preparePlugin({ entry: { use: './gone.mjs' }, loadError: 'Cannot find module' }, {}).errors, ['The plugin "./gone.mjs" could not be loaded: Cannot find module']);
  assert.deepEqual(preparePlugin({ entry: { use: './p.mjs' }, plugin }, {}).errors, ['Plugin "p", setting "token" is required.']);
  const ready = preparePlugin({ entry: { use: './p.mjs', config: { token: { env: 'T' } }, timeoutMs: 250 }, plugin }, { T: 'abcd1234' });
  assert.equal(ready.prepared?.timeoutMs, 250);
  assert.deepEqual(ready.prepared?.secrets, ['abcd1234']);
  assert.equal(preparePlugin({ entry: { use: './p.mjs', config: { token: 'abcd1234' } }, plugin }, {}).prepared?.timeoutMs, 5000);
});
