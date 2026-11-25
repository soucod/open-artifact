import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ShellBoot } from '@open-artifact/protocol';
import { ApiError, answerOf, createLibraryApi, type FetchLike } from '../src/lib/api.ts';
import { BOOT_TIMEOUT_MS } from '../src/shell/preboot.ts';
import { afterFrameDenied, finishedBoot, frameDeniedReason, pendingBoot, problemBoot, readyOnLoad } from '../src/shell/model.ts';

const boot: ShellBoot = {
  id: 'art_1',
  url: 'open-artifact://artifact/art_1',
  title: 'Deck',
  type: 'slides',
  typeTitle: 'Slides',
  root: '/tmp/deck',
  page: 'http://127.0.0.1:4801/slides/t/',
  pageUrl: 'http://127.0.0.1:4801/slides/t/',
  pageKind: 'server',
  problem: null,
  empty: false,
  prompt: null,
  owner: null,
  agentName: 'Agent',
  userName: 'me',
  version: '1',
};

describe('the boot', () => {
  it('takes a finished boot only for the same artifact, never pending', () => {
    assert.deepEqual(finishedBoot({ ...boot, pending: true }, { id: 'art_1' }), boot);
    assert.throws(() => finishedBoot({ ...boot, id: 'art_2' }, { id: 'art_1' }), /No boot for art_1/);
    assert.throws(() => finishedBoot(null, { id: 'art_1' }));
    assert.throws(() => finishedBoot({ id: 'art_1' }, { id: 'art_1' }));
  });

  it('drops the page while it is opened again, and shows a problem instead of it', () => {
    const pending = pendingBoot(boot);
    assert.equal(pending.pending, true);
    assert.deepEqual([pending.page, pending.pageUrl, pending.pageKind, pending.problem], [null, null, null, null]);
    assert.equal(pending.title, 'Deck');
    const problem = problemBoot(pending, 'No way');
    assert.equal(problem.pending, undefined);
    assert.equal(problem.page, null);
    assert.equal(problem.problem, 'No way');
  });
});

describe('the frame', () => {
  it('reads frame_denied and its reason', () => {
    assert.equal(frameDeniedReason({ openArtifact: 'frame_denied', reason: 'not_granted' }), 'not_granted');
    assert.equal(frameDeniedReason({ openArtifact: 'frame_denied', reason: 'not_open' }), 'not_open');
    assert.equal(frameDeniedReason({ openArtifact: 'frame_denied', reason: 'weird' }), 'not_open');
    assert.equal(frameDeniedReason({ openArtifact: 'chrome_report' }), null);
    assert.equal(frameDeniedReason(null), null);
  });

  it('asks for the address again once, and never in a type server’s own Shell', () => {
    assert.equal(afterFrameDenied(boot, false), 'reopen');
    assert.equal(afterFrameDenied(boot, true), 'problem');
    assert.equal(afterFrameDenied({ typeServer: { role: 'viewer' } }, false), 'problem');
  });

  it("waits for a type server's page to report; other pages show on load", () => {
    assert.equal(readyOnLoad('server'), false);
    assert.equal(readyOnLoad('static'), true);
    assert.equal(readyOnLoad('url'), true);
    assert.equal(readyOnLoad(null), true);
  });
});

describe('artifacts.boot', () => {
  it('asks with GET, the id and fresh, and waits longer than other reads', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetch: FetchLike = async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(boot), { status: 200 });
    };
    const api = createLibraryApi({ fetch });
    assert.deepEqual(await api.boot('art_1'), boot);
    await api.boot('art_1', { fresh: true });
    assert.equal(calls[0]!.url, '/api/open-artifact.artifacts.boot?id=art_1');
    assert.equal(calls[1]!.url, '/api/open-artifact.artifacts.boot?id=art_1&fresh=1');
    assert.equal(calls[0]!.init?.method, undefined);
    assert.equal(calls[0]!.init?.cache, 'no-store');
    assert.ok(BOOT_TIMEOUT_MS > 25_000);
  });

  it('reads an answer the page fetched itself the same way', async () => {
    assert.deepEqual(await answerOf(new Response(JSON.stringify(boot), { status: 200 })), boot);
    await assert.rejects(answerOf(new Response(JSON.stringify({ code: 'not_found', message: 'No artifact.' }), { status: 404 })), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, 'not_found');
      assert.equal(error.status, 404);
      assert.equal(error.message, 'No artifact.');
      return true;
    });
  });
});
