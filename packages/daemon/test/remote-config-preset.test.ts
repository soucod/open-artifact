/**
 * Install-time presets without a host: what `readPreset` takes from the environment and `preset.json`, and the
 * precedence over them of what a person saved (`settings.json` > environment > `preset.json` > defaults).
 */

import { TEST_HOME } from './helpers.ts';
import assert from 'node:assert/strict';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { readPreset, tokenHash } from '../src/preset.ts';
import { remoteNameFor } from '../src/remote.ts';
import { loadSettings, saveCloudSettings } from '../src/settings.ts';

const presetFile = join(TEST_HOME, 'preset.json');
const settingsFile = join(TEST_HOME, 'settings.json');

afterEach(() => {
  rmSync(presetFile, { force: true });
  rmSync(settingsFile, { force: true });
});

test('the environment gives the preset; empty values count as unset', () => {
  assert.deepEqual(readPreset({}), {});
  assert.deepEqual(
    readPreset({ OPEN_ARTIFACT_REMOTE: 'https://oa.example.com', OPEN_ARTIFACT_REMOTE_NAME: 'work', OPEN_ARTIFACT_REMOTE_TOKEN: 'oa_rt_x', OPEN_ARTIFACT_PUBLISH: 'AUTO', OPEN_ARTIFACT_REMOTE_INSECURE_HTTP: '1' }),
    { remote: 'https://oa.example.com', name: 'work', token: 'oa_rt_x', publish: 'auto', insecureHttp: true },
  );
  assert.deepEqual(readPreset({ OPEN_ARTIFACT_REMOTE: '  ', OPEN_ARTIFACT_PUBLISH: 'sometimes' }), {});
  // A plugin's setting (OPEN_ARTIFACT_PLUGIN_REMOTE) counts only when the shell sets no OPEN_ARTIFACT_REMOTE.
  assert.deepEqual(readPreset({ OPEN_ARTIFACT_PLUGIN_REMOTE: 'http://oa.lan:4900' }), { remote: 'http://oa.lan:4900' });
  assert.deepEqual(readPreset({ OPEN_ARTIFACT_PLUGIN_REMOTE: 'http://oa.lan:4900', OPEN_ARTIFACT_REMOTE: 'https://oa.example.com' }), { remote: 'https://oa.example.com' });
  assert.deepEqual(readPreset({ OPEN_ARTIFACT_PLUGIN_REMOTE: '' }), {});
});

test('preset.json takes the same keys; the environment wins per key, and a token stays with its address', () => {
  writeFileSync(presetFile, JSON.stringify({ OPEN_ARTIFACT_REMOTE: 'http://oa.lan:4900', OPEN_ARTIFACT_REMOTE_TOKEN: 'file-token', OPEN_ARTIFACT_PUBLISH: 'auto' }), { mode: 0o600 });
  assert.deepEqual(readPreset({}), { remote: 'http://oa.lan:4900', token: 'file-token', publish: 'auto' });
  // The environment's address comes without the file's token.
  assert.deepEqual(readPreset({ OPEN_ARTIFACT_REMOTE: 'https://oa.example.com', OPEN_ARTIFACT_PUBLISH: 'manual' }), { remote: 'https://oa.example.com', publish: 'manual' });
  writeFileSync(presetFile, '{broken');
  assert.deepEqual(readPreset({}), {});
});

test('settings.json over the environment over the defaults', () => {
  assert.equal(loadSettings().cloud?.publish, undefined);
  assert.equal(loadSettings({ publish: 'auto' }).cloud?.publish, 'auto');
  saveCloudSettings({ publish: 'manual', default: 'work' });
  assert.equal(loadSettings({ publish: 'auto' }).cloud?.publish, 'manual');
  assert.equal(loadSettings({ publish: 'auto' }).cloud?.default, 'work');
  // null takes a key out, and an empty cloud goes away.
  saveCloudSettings({ publish: null, default: null });
  assert.equal(loadSettings({ publish: 'auto' }).cloud?.publish, 'auto');
  assert.equal(loadSettings().cloud, undefined);
});

test('a preset remote is named after its host; the token is kept only as a hash', () => {
  assert.equal(remoteNameFor('https://oa.example.com', []), 'oa');
  assert.equal(remoteNameFor('https://oa.example.com', ['oa', 'oa-2']), 'oa-3');
  assert.equal(remoteNameFor('http://192.168.1.20:4900', []), '192-168-1-20');
  assert.equal(tokenHash('secret').length, 64);
  assert.notEqual(tokenHash('secret'), 'secret');
});
