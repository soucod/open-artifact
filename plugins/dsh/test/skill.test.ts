/**
 * The `/open-artifact` skill provider (skill.ts) and the `host.open` requests between the server and browser halves
 * (host-open.ts).
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
// @ts-expect-error: the build script is plain JavaScript without types
import { writeSkill } from '../scripts/build.mjs';
import { HostOpens } from '../src/server/host-open.ts';
import { skillFile, skillProvider, SKILL_NAME } from '../src/server/skill.ts';
import type { HostOpenRequest } from '../src/shared/routes.ts';

describe('skillProvider', () => {
  it('is a user-invocable skill rendered on every load, listed with the last description it had', async () => {
    let n = 0;
    const provider = skillProvider({
      packageRoot: '/plugin',
      description: 'Kit words.',
      render: async () => ({ description: `Rendered ${++n}.`, body: `# Body ${n}\n\n` }),
    });
    const [candidate] = await provider.list();
    assert.equal(candidate!.name, SKILL_NAME);
    assert.equal(candidate!.description, 'Kit words.');
    assert.deepEqual(candidate!.invocation, { modelInvocable: false, userInvocable: true });
    assert.equal((await provider.get(candidate!)).content, '# Body 1\n');
    const again = await provider.get(candidate!);
    assert.ok(!('rank' in again));
    assert.equal(again.content, '# Body 2\n');
    assert.equal((await provider.list())[0]!.description, 'Rendered 2.');
  });

  it("names the SKILL.md the build writes, from the protocol's template", async () => {
    const root = mkdtempSync(join(tmpdir(), 'oa-dsh-skill-'));
    try {
      const provider = skillProvider({ packageRoot: root, description: 'Kit words.', render: async () => ({ description: 'd', body: 'b' }) });
      const [candidate] = await provider.list();
      assert.equal(candidate!.path, join(root, 'skills', SKILL_NAME, 'SKILL.md'));
      assert.equal(await writeSkill(root), skillFile(root));
      assert.ok(existsSync(candidate!.path));
      const text = readFileSync(candidate!.path, 'utf8');
      assert.match(text, /^---\n/);
      assert.match(text, /name: open-artifact/);
      assert.match(text, /\/open-artifact/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('passes a failed rendering on', async () => {
    const provider = skillProvider({
      packageRoot: '/plugin',
      description: 'Kit words.',
      render: async () => {
        throw new Error('down');
      },
    });
    const [candidate] = await provider.list();
    await assert.rejects(provider.get(candidate!), /down/);
  });
});

describe('HostOpens', () => {
  it('is false at once with nobody listening, or no session', async () => {
    const opens = new HostOpens(50);
    assert.equal(await opens.open('s1', 'http://x/'), false);
    opens.listen(() => {});
    assert.equal(await opens.open(null, 'http://x/'), false);
  });

  it('is true once one listener showed it, and carries the view ticket', async () => {
    const opens = new HostOpens(1_000);
    const seen: HostOpenRequest[] = [];
    opens.listen((request) => {
      seen.push(request);
      opens.answer(request.id, false);
    });
    opens.listen((request) => setTimeout(() => opens.answer(request.id, true), 5));
    assert.equal(await opens.open('s1', 'http://x/?oa_view=v1', 'Deck', { view: 'v1', agentName: 'DSH' }), true);
    assert.equal(seen[0]!.session, 's1');
    assert.equal(seen[0]!.title, 'Deck');
    assert.equal(seen[0]!.view, 'v1');
    assert.equal(seen[0]!.agentName, 'DSH');
  });

  it('is false when every listener said no, or none answered in time', async () => {
    const opens = new HostOpens(30);
    const stop = opens.listen((request) => opens.answer(request.id, false));
    assert.equal(await opens.open('s1', 'http://x/'), false);
    stop();
    opens.listen(() => {});
    const started = Date.now();
    assert.equal(await opens.open('s1', 'http://x/'), false);
    assert.ok(Date.now() - started >= 25);
  });

  it("passes a Shell's message to every browser half following them, and a broken one does not stop the rest", () => {
    const opens = new HostOpens();
    const got: unknown[] = [];
    opens.listenShell(() => {
      throw new Error('gone');
    });
    const stop = opens.listenShell((event) => got.push(event.view));
    opens.shell({ view: 'v1', session: 's1', event: { openArtifact: 'close' } as never });
    stop();
    opens.shell({ view: 'v2', session: 's1', event: { openArtifact: 'close' } as never });
    assert.deepEqual(got, ['v1']);
  });
});
