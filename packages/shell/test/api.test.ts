import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ApiError, createLibraryApi, parseLibraryEvent, subscribeLibraryEvents, type FetchLike } from '../src/lib/api.ts';

/** A fake fetch that records requests and answers from a table. */
function fakeFetch(answers: Record<string, { status?: number; body: unknown }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const path = url.split('?')[0]!;
    const answer = answers[path] ?? { status: 404, body: { code: 'not_found', message: 'none' } };
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  };
  return { fetch, calls };
}

describe('createLibraryApi', () => {
  it('reads with GET and no-store, and unwraps the artifact list', async () => {
    const { fetch, calls } = fakeFetch({ '/api/open-artifact.artifacts': { body: { artifacts: [{ id: 'art_1' }] } } });
    const api = createLibraryApi({ fetch });
    const list = await api.artifacts();
    assert.deepEqual(list, [{ id: 'art_1' }]);
    assert.equal(calls[0]!.init?.method, undefined);
    assert.equal(calls[0]!.init?.cache, 'no-store');
  });

  it('puts the id in the query of one-artifact reads', async () => {
    const { fetch, calls } = fakeFetch({ '/api/open-artifact.artifact': { body: { id: 'art_1', bytes: 10 } } });
    await createLibraryApi({ fetch }).artifact('art_1');
    assert.equal(calls[0]!.url, '/api/open-artifact.artifact?id=art_1');
  });

  it('writes with POST and a JSON body', async () => {
    const { fetch, calls } = fakeFetch({ 'http://127.0.0.1:4800/api/open-artifact.artifacts.update': { body: { id: 'art_1', title: 'New' } } });
    const out = await createLibraryApi({ fetch, base: 'http://127.0.0.1:4800/' }).update({ id: 'art_1', title: 'New' });
    assert.equal(out.title, 'New');
    assert.equal(calls[0]!.url, 'http://127.0.0.1:4800/api/open-artifact.artifacts.update');
    assert.equal(calls[0]!.init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(calls[0]!.init?.body)), { id: 'art_1', title: 'New' });
  });

  it('routes share reads and writes to artifact.share', async () => {
    const view = { lan: false, links: { viewer: { on: true, url: 'http://x/v' } } };
    const { fetch, calls } = fakeFetch({ '/api/open-artifact.artifact.share': { body: view } });
    const api = createLibraryApi({ fetch });
    assert.deepEqual(await api.share('art_1'), view);
    await api.setShare({ id: 'art_1', lan: true });
    assert.equal(calls[0]!.url, '/api/open-artifact.artifact.share?id=art_1');
    assert.equal(calls[1]!.init?.method, 'POST');
  });

  it('builds the folder zip address on artifact.archive', () => {
    assert.equal(createLibraryApi({ fetch: fakeFetch({}).fetch }).archiveUrl('art_1'), '/api/open-artifact.artifact.archive?id=art_1');
    assert.equal(createLibraryApi({ fetch: fakeFetch({}).fetch, base: 'http://127.0.0.1:4800/' }).archiveUrl('a b'), 'http://127.0.0.1:4800/api/open-artifact.artifact.archive?id=a+b');
  });

  it('throws ApiError with the daemon code, message and fix', async () => {
    const { fetch } = fakeFetch({ '/api/open-artifact.artifact.share': { status: 409, body: { code: 'unsupported', message: 'No sharing.', fix: 'Use a server.' } } });
    await assert.rejects(createLibraryApi({ fetch }).share('art_1'), (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, 'unsupported');
      assert.equal(error.status, 409);
      assert.equal(error.message, 'No sharing.');
      assert.equal(error.fix, 'Use a server.');
      return true;
    });
  });

  it('reports a body that is not JSON by its status', async () => {
    const fetch: FetchLike = async () => new Response('oops', { status: 500 });
    await assert.rejects(createLibraryApi({ fetch }).types(), { code: 'error', message: 'HTTP 500' });
  });

  it('turns a failed request into connect_failed', async () => {
    const fetch: FetchLike = async () => {
      throw new TypeError('Failed to fetch');
    };
    await assert.rejects(createLibraryApi({ fetch }).artifacts(), { code: 'connect_failed', status: 0 });
  });

  it('defaults missing lists in types()', async () => {
    const { fetch } = fakeFetch({ '/api/open-artifact.types': { body: {} } });
    assert.deepEqual(await createLibraryApi({ fetch }).types(), { roots: [], types: [] });
  });

  it('passes the projects of types() through, and posts the types.* routes', async () => {
    const project = { dir: '/p', root: '/p/.agents/artifact-types', trusted: false, types: [] };
    const { fetch, calls } = fakeFetch({
      '/api/open-artifact.types': { body: { roots: [], types: [], projects: [project] } },
      '/api/open-artifact.types.disable': { body: { ok: true, disabledTypes: ['x'], trustedProjects: [] } },
      '/api/open-artifact.types.trust': { body: { ok: true, disabledTypes: [], trustedProjects: ['/p'] } },
    });
    const api = createLibraryApi({ fetch });
    assert.deepEqual((await api.types()).projects, [project]);
    assert.deepEqual((await api.typesEnable('x', false)).disabledTypes, ['x']);
    assert.deepEqual((await api.typesTrust('/p', true)).trustedProjects, ['/p']);
    assert.ok(calls.some((c) => c.url.endsWith('/api/open-artifact.types.trust') && JSON.parse(String(c.init?.body)).dir === '/p'));
  });
});

describe('library events', () => {
  it('parses known events and drops the rest', () => {
    assert.deepEqual(parseLibraryEvent('{"type":"artifacts/changed","id":"art_1"}'), { type: 'artifacts/changed', id: 'art_1' });
    assert.equal(parseLibraryEvent('{"type":"presence"}'), null);
    assert.equal(parseLibraryEvent('not json'), null);
    assert.equal(parseLibraryEvent('null'), null);
  });

  it('subscribes through the given EventSource and closes it', () => {
    let instance: { url: string; onmessage: ((event: MessageEvent<string>) => void) | null; closed: boolean } | null = null;
    class FakeSource {
      url: string;
      onmessage: ((event: MessageEvent<string>) => void) | null = null;
      closed = false;
      constructor(url: string) {
        this.url = url;
        instance = this;
      }
      close() {
        this.closed = true;
      }
    }
    const seen: unknown[] = [];
    const stop = subscribeLibraryEvents((event) => seen.push(event), { url: '/api/open-artifact.events', EventSource: FakeSource });
    instance!.onmessage!({ data: '{"type":"types/changed"}' } as MessageEvent<string>);
    instance!.onmessage!({ data: 'garbage' } as MessageEvent<string>);
    stop();
    assert.deepEqual(seen, [{ type: 'types/changed' }]);
    assert.equal(instance!.url, '/api/open-artifact.events');
    assert.equal(instance!.closed, true);
  });
});
