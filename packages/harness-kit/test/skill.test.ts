import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { renderSkill, skillFileKey, type SkillResult } from '@open-artifact/protocol';
import { createHarness, installSkill, localSkill, type Harness } from '../src/index.ts';
import { startFakeDaemon, type FakeDaemon } from '../src/testing.ts';

const open: Array<{ close(): unknown }> = [];
after(async () => {
  for (const item of open.reverse()) await item.close();
});

const skillsDir = (): string => mkdtempSync(join(tmpdir(), 'oa-kit-skills-'));

/** A `skill.get` answer from a runtime of `version` whose text says `body`. */
const answer = (version: string, body: string): SkillResult => ({ name: 'artifact', description: 'Make one.', argumentHint: '<type> <what to make>', body, version, etag: `etag-${body.length}` });

async function until<T>(check: () => T, timeoutMs = 3000): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = check();
    if (value) return value as NonNullable<T>;
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((done) => setTimeout(done, 20));
  }
}

async function fake(version: string, body: string, home?: string): Promise<FakeDaemon> {
  const daemon = await startFakeDaemon({
    ...(home ? { home } : {}),
    version,
    features: ['skill.get', 'commands.list'],
    handle: (method, params) => {
      if (method === 'skill.get') return answer(version, body);
      if (method === 'commands.list') return { commands: [{ text: `/${(params as { command?: string }).command ?? 'artifact'} slides `, type: 'slides', title: 'Slides', description: 'Decks.' }] };
      return undefined;
    },
  });
  open.push(daemon);
  return daemon;
}

test('installSkill: writes the daemon’s rendering once, with generated-by and etag', async () => {
  const daemon = await fake('1.0.0', '# One\n');
  const h: Harness = await createHarness({ harness: 'kit-app', home: daemon.home, autoStart: false, reconnect: { minMs: 20, maxMs: 40 } });
  open.unshift(h);
  const dir = skillsDir();
  const first = await h.installSkill({ dir, command: 'artifact', form: 'entry' });
  assert.equal(first.written, true);
  assert.equal(first.source, 'daemon');
  const text = readFileSync(join(dir, 'artifact', 'SKILL.md'), 'utf8');
  assert.equal(skillFileKey(text, 'generated-by'), 'open-artifact 1.0.0');
  assert.equal(skillFileKey(text, 'etag'), 'etag-6');
  assert.ok(text.endsWith('# One\n'));
  const asked = daemon.calls.find((c) => c.method === 'skill.get')!.params as { form?: string; command?: string };
  assert.equal(asked.form, 'entry');
  assert.equal(asked.command, 'artifact');

  const again = await installSkill(h.client, { dir, command: 'artifact', form: 'entry' });
  assert.equal(again.written, false, 'the same etag is not written again');

  assert.deepEqual(await h.commands({ command: 'artifact' }), [{ text: '/artifact slides ', type: 'slides', title: 'Slides', description: 'Decks.' }]);
});

test('installSkill: a reconnect to a newer runtime writes it again', async () => {
  const first = await fake('1.0.0', '# Old\n');
  const h: Harness = await createHarness({ harness: 'kit-app', home: first.home, autoStart: false, reconnect: { minMs: 20, maxMs: 40 } });
  open.unshift(h);
  const dir = skillsDir();
  await h.installSkill({ dir, command: 'artifact' });
  const file = join(dir, 'artifact', 'SKILL.md');
  assert.ok(readFileSync(file, 'utf8').includes('# Old'));
  // The old runtime goes; a newer one starts in the same home.
  first.drop();
  await first.close();
  const second = await fake('2.0.0', '# Newer text\n', first.home);
  await until(() => second.connected);
  await until(() => readFileSync(file, 'utf8').includes('# Newer text'));
  assert.equal(skillFileKey(readFileSync(file, 'utf8'), 'generated-by'), 'open-artifact 2.0.0');
});

test('installSkill: without skill.get the kit renders the template; a file it did not write stays', async () => {
  const dir = skillsDir();
  const local = await installSkill(null, { dir, command: 'oa', tools: 'native' });
  assert.equal(local.source, 'kit');
  const text = readFileSync(join(dir, 'oa', 'SKILL.md'), 'utf8');
  assert.ok(text.includes('# Make an artifact: `/oa <type> <what to make>`'));
  assert.ok(text.includes('## Installed types'));
  assert.equal(localSkill({ command: 'oa', tools: 'native' }).etag, local.etag);
  // Not a kit file of the default, but the same template.
  assert.ok(renderSkill().includes('## Where the output goes'));

  const own = join(dir, 'mine');
  mkdirSync(own, { recursive: true });
  writeFileSync(join(own, 'SKILL.md'), '---\nname: mine\n---\n\nMy own.\n');
  await assert.rejects(installSkill(null, { dir, command: 'mine' }), /not written by Open Artifact/);
  const forced = await installSkill(null, { dir, command: 'mine', force: true });
  assert.equal(forced.written, true);
  await assert.rejects(installSkill(null, { dir, command: '/Bad' }), /command/);
});

test('Harness.installSkill: an open handler makes the kit’s own rendering say the app shows pages; opens given wins', async () => {
  // A daemon without skill.get: the kit renders the skill itself.
  const daemon = await startFakeDaemon({ features: [] });
  const made: Harness[] = [];
  try {
    const harnessOf = async (open: boolean): Promise<Harness> => {
      const h = await createHarness({ harness: 'opens-app', home: daemon.home, autoStart: false, reconnect: { minMs: 20, maxMs: 100 }, ...(open ? { open: () => true } : {}) });
      made.push(h);
      await h.ready();
      return h;
    };
    const host = /Your app shows the page by itself/;
    const link = /Your app cannot show pages, and nothing opens by itself/;
    const withOpen = await harnessOf(true);
    const defaulted = await withOpen.installSkill({ dir: skillsDir(), command: 'oa' });
    assert.equal(defaulted.source, 'kit');
    assert.match(readFileSync(defaulted.file, 'utf8'), host);
    const explicit = await withOpen.installSkill({ dir: skillsDir(), command: 'oa', opens: 'link' });
    assert.match(readFileSync(explicit.file, 'utf8'), link);
    assert.doesNotMatch(readFileSync(explicit.file, 'utf8'), host);
    const withoutOpen = await harnessOf(false);
    const plain = await withoutOpen.installSkill({ dir: skillsDir(), command: 'oa' });
    assert.equal(readFileSync(plain.file, 'utf8'), readFileSync((await installSkill(null, { dir: skillsDir(), command: 'oa' })).file, 'utf8'));
    assert.doesNotMatch(readFileSync(plain.file, 'utf8'), host);
  } finally {
    for (const h of made) h.close();
    await daemon.close();
  }
});
