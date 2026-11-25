/**
 * The app origin's rules: its headers and page CSPs, the isolation headers only where a browser takes them (https or
 * localhost, not a plain-http LAN name), cross-site writes, `return_to` that tries to leave, the built
 * Shell's files, uploading an archive (decision 21), and the event stream's visibility.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { after, before, describe, it, test } from 'node:test';
import type { ArtifactView } from '@open-artifact/protocol';
import { APP_OPENER_POLICY, PLAIN_CSP, inlineScripts, isPotentiallyTrustworthyOrigin, scriptJson } from '../src/core/app/security.ts';
import { guestCookie } from '../src/core/auth/session.ts';
import type { ArtifactRow, UserRecord } from '../src/core/types.ts';
import { makeApp, type TestApp } from './app-fixture.ts';

type Person = { user: UserRecord; cookie: string };

describe('app origin rules', () => {
  let app: TestApp;
  let ada: Person, eve: Person, sam: Person;
  let board: ArtifactRow;

  before(async () => {
    app = await makeApp();
    ada = await app.person('Ada');
    eve = await app.person('Eve');
    sam = await app.person('Sam');
    board = await app.artifact(ada.user, { title: 'Retro' });
    await app.catalog.upsertGrant({ artifactId: board.id, subjectKind: 'user', subject: eve.user.id, role: 'editor', createdBy: ada.user.id });
  });
  after(() => app.close());

  const assertAppHeaders = (response: Response): void => {
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
    assert.ok(response.headers.get('referrer-policy'));
    assert.match(response.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  };

  it('every answer has the app headers; JSON, redirects and errors load nothing', async () => {
    for (const [path, cookie] of [
      [`/api/open-artifact.artifact?id=${board.id}`, ada.cookie],
      [`/api/open-artifact.artifact?id=${board.id}`, sam.cookie],
      ['/api/open-artifact.nothing', ada.cookie],
      ['/', undefined],
      ['/_open-artifact/shell/missing.js', undefined],
    ] as const) {
      const response = await app.fetch(path, cookie ? { cookie } : {});
      assertAppHeaders(response);
      assert.equal(response.headers.get('content-security-policy'), PLAIN_CSP, path);
      assert.equal(response.headers.get('referrer-policy'), 'same-origin');
    }
    // The sign-in page keeps its own CSP; its form posts, so `same-origin` (`no-referrer` makes Chromium send `Origin: null`).
    const signIn = await app.fetch('/auth/sign-in');
    assertAppHeaders(signIn);
    assert.equal(signIn.headers.get('referrer-policy'), 'same-origin');
    assert.ok((await signIn.text()).includes('<meta name="referrer" content="same-origin">'));
  });

  it('a failed navigation on a page path is a page in the reader\'s language; API calls and fetches keep JSON', async () => {
    const navigate = { 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'cross-site', accept: 'text/html' };
    for (const [lang, words] of [['en', 'Not allowed'], ['zh-CN,zh;q=0.9', '不允许这样做']] as const) {
      const refused = await app.fetch('/auth/owner-key', { body: 'key=x', origin: 'https://evil.example', headers: { ...navigate, 'content-type': 'application/x-www-form-urlencoded', 'accept-language': lang } });
      assert.equal(refused.status, 403);
      assert.match(refused.headers.get('content-type') ?? '', /^text\/html/);
      assertAppHeaders(refused);
      const html = await refused.text();
      assert.ok(html.includes(words), html);
      assert.ok(html.includes('Cross-site requests may not change anything here.'));
    }
    // A page path that does not exist, opened in the address bar (old browsers: Accept alone).
    const missing = await app.fetch('/a/nope/extra', { headers: { accept: 'text/html' } });
    assert.equal(missing.status, 404);
    assert.match(missing.headers.get('content-type') ?? '', /^text\/html/);
    // The same refusal by fetch, or on an API route, is JSON.
    const fetched = await app.fetch('/auth/owner-key', { body: 'key=x', origin: 'https://evil.example', headers: { 'sec-fetch-mode': 'cors', 'sec-fetch-site': 'cross-site', 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(fetched.status, 403);
    assert.equal(((await fetched.json()) as { code: string }).code, 'not_granted');
    const api = await app.fetch('/api/open-artifact.artifacts.update', { cookie: ada.cookie, body: { id: board.id, title: 'x' }, origin: 'https://evil.example', headers: navigate });
    assert.equal(api.status, 403);
    assert.match(api.headers.get('content-type') ?? '', /json/);
  });

  it("the Shell's CSP: its inline boot script by hash, the artifact's content origin framed and reached, nothing else", async () => {
    const response = await app.fetch(`/a/${board.id}`, { cookie: ada.cookie });
    assertAppHeaders(response);
    const html = await response.text();
    const csp = response.headers.get('content-security-policy') ?? '';
    const scripts = inlineScripts(html);
    assert.equal(scripts.length, 1);
    const hash = `'sha256-${createHash('sha256').update(scripts[0]!).digest('base64')}'`;
    assert.ok(csp.includes(`script-src 'self' ${hash}`), csp);
    assert.ok(!csp.includes('unsafe-eval'));
    assert.ok(!/script-src[^;]*unsafe-inline/.test(csp));
    const content = `http://${board.id.replace('_', '-')}.content.localhost:4900`;
    assert.ok(csp.includes(`frame-src ${content};`), csp);
    assert.ok(csp.includes(`connect-src 'self' ${content} ws://${board.id.replace('_', '-')}.content.localhost:4900;`), csp);
    assert.ok(csp.includes("base-uri 'none'"));
    assert.ok(csp.includes("object-src 'none'"));
    // The home page frames nothing.
    const home = await app.fetch('/', { cookie: ada.cookie });
    assert.match(home.headers.get('content-security-policy') ?? '', /frame-src 'none'/);
    assert.equal(home.headers.get('cache-control'), 'no-store');
  });

  it('a boot value cannot end its script', () => {
    assert.equal(scriptJson({ t: '</script><script>alert(1)</script>\u2028' }), '{"t":"\\u003c/script>\\u003cscript>alert(1)\\u003c/script>\\u2028"}');
  });

  it('a title with markup stays data in the Shell page', async () => {
    const odd = await app.artifact(ada.user, { title: '</script><script>alert(1)</script>' });
    const html = await (await app.fetch(`/a/${odd.id}`, { cookie: ada.cookie })).text();
    assert.equal(inlineScripts(html).length, 1);
    assert.ok(!html.includes('<script>alert(1)'));
  });

  it('cross-site writes are refused before they reach a route', async () => {
    const rename = (headers: Record<string, string>, origin?: string | null): Promise<Response> =>
      app.fetch('/api/open-artifact.artifacts.update', { cookie: ada.cookie, body: { id: board.id, title: 'Pwned' }, headers, ...(origin === undefined ? {} : { origin }) });
    const evil = await rename({}, 'https://evil.example');
    assert.equal(evil.status, 403);
    assertAppHeaders(evil);
    assert.equal((await rename({ 'sec-fetch-site': 'cross-site' }, null)).status, 403);
    // A content origin is another site too.
    assert.equal((await rename({}, `http://${board.id.replace('_', '-')}.content.localhost:4900`)).status, 403);
    assert.equal((await app.fetch('/api/open-artifact.artifacts.import', { cookie: ada.cookie, body: '{}', headers: { 'content-type': 'application/zip' }, origin: 'https://evil.example' })).status, 403);
    assert.equal((await app.fetch('/auth/sign-out', { cookie: ada.cookie, body: '', origin: 'https://evil.example' })).status, 403);
    assert.equal((await app.catalog.getArtifact(board.id))?.title, 'Retro');
    // Reads from anywhere are fine; a same-origin write is fine.
    assert.equal((await rename({}, app.config.appOrigin)).status, 200);
    await app.catalog.touchArtifact(board.id, { title: 'Retro' });
  });

  it('return_to never leaves the app origin', async () => {
    for (const target of ['https://evil.example/', '//evil.example/x', '/\\evil.example', 'javascript:alert(1)', '/%0d%0aSet-Cookie:x=1']) {
      const out = await app.fetch('/auth/sign-out', { body: new URLSearchParams({ return_to: target }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
      assert.equal(out.status, 303, target);
      const location = out.headers.get('location') ?? '';
      assert.ok(location.startsWith('/') && !location.startsWith('//') && !location.includes('\\'), `${target} → ${location}`);
      assert.ok(!location.includes('evil.example'), `${target} → ${location}`);
    }
    const page = await (await app.fetch(`/auth/sign-in?return_to=${encodeURIComponent('//evil.example/')}`)).text();
    assert.ok(!page.includes('evil.example'));
    // The pages' own sign-in links come back to the artifact.
    const anon = await app.fetch(`/a/${board.id}`);
    assert.equal(anon.headers.get('location'), `/auth/sign-in?return_to=%2Fa%2F${board.id}`);
  });

  it("tells only the owner that a trashed artifact's address is in their trash, and offers the Trash", async () => {
    const owner = await app.person('Tess');
    const other = await app.person('Otto');
    const gone = await app.artifact(owner.user, { title: 'Unpublished board', generalAccess: 'link' });
    await app.catalog.trashArtifact(gone.id);
    const mine = await app.fetch(`/a/${gone.id}`, { cookie: owner.cookie });
    assert.equal(mine.status, 404);
    const text = await mine.text();
    assert.match(text, /In your trash/);
    assert.match(text, /Unpublished board/);
    assert.match(text, /href="\/#trash"/);
    // Anyone else: the page that reveals nothing, with no title.
    const theirs = await (await app.fetch(`/a/${gone.id}`, { cookie: other.cookie })).text();
    assert.match(theirs, /not shared with you, or it is not here any more/);
    assert.doesNotMatch(theirs, /Unpublished board|trash/i);
  });

  it("serves the built Shell's files under /_open-artifact/, and 404s anything else", async () => {
    const file = await app.fetch('/_open-artifact/shell/assets/index-Ab12.js');
    assert.equal(file.status, 200);
    assert.equal(file.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assertAppHeaders(file);
    assert.equal((await app.fetch('/_open-artifact/shell/index.html')).status, 404);
    assert.equal((await app.fetch('/nope')).status, 404);
  });

  describe('import', () => {
    const upload = (cookie: string | undefined, body: string | Uint8Array, type = 'application/zip'): Promise<Response> =>
      app.fetch('/api/open-artifact.artifacts.import', { ...(cookie ? { cookie } : {}), body, headers: { 'content-type': type } });

    it('makes the uploader the owner of a new artifact', async () => {
      const response = await upload(sam.cookie, JSON.stringify({ type: 'design', title: '  Poster  ' }));
      assert.equal(response.status, 201);
      const view = (await response.json()) as ArtifactView;
      assert.equal(view.role, 'owner');
      assert.equal(view.title, 'Poster');
      assert.equal(view.type, 'design');
      assert.equal((await app.catalog.getArtifact(view.id))?.ownerUser, sam.user.id);
      assert.ok(app.heard['artifact-changed'].some((e) => e.id === view.id));
      assert.ok((await app.catalog.listAudit({ artifactId: view.id })).some((a) => a.action === 'artifact.import'));
      assert.equal((await upload(sam.cookie, JSON.stringify({ type: 'design' }), 'application/x-zip-compressed')).status, 201);
    });

    it('refuses: no person, the wrong type, nothing, not an artifact, a type this host lacks, too big', async () => {
      const guestOnly = `${guestCookie(app.config, board.id).name}=whatever`;
      const before = (await app.catalog.listArtifactsFor({ id: sam.user.id, email: null, emailVerified: false })).length;
      assert.equal((await upload(undefined, '{}')).status, 401);
      assert.equal((await upload(guestOnly, '{}')).status, 401);
      assert.equal((await upload(sam.cookie, '{}', 'application/json')).status, 415);
      assert.equal((await upload(sam.cookie, '{}', 'multipart/form-data; boundary=x')).status, 415);
      assert.equal((await upload(sam.cookie, '')).status, 400);
      assert.equal((await upload(sam.cookie, 'PK not really')).status, 400);
      assert.equal((await upload(sam.cookie, JSON.stringify({ bad: true }))).status, 400);
      const missing = await upload(sam.cookie, JSON.stringify({ type: 'spreadsheet' }));
      assert.equal(missing.status, 400);
      assert.match(((await missing.json()) as { message: string }).message, /spreadsheet type is not installed/);
      const big = await app.fetch('/api/open-artifact.artifacts.import', { cookie: sam.cookie, body: 'x', headers: { 'content-type': 'application/zip', 'content-length': String(101 * 1024 * 1024) } });
      assert.equal(big.status, 413);
      assert.equal((await app.catalog.listArtifactsFor({ id: sam.user.id, email: null, emailVerified: false })).length, before);
    });
  });

  describe('event stream', () => {
    /** Opens the stream; `next` waits for text containing `needle`, `quiet` checks nothing more arrives. */
    const open = async (cookie?: string): Promise<{ next(needle: string): Promise<string>; quiet(ms?: number): Promise<string>; close(): void; response: Response }> => {
      const abort = new AbortController();
      const response = await app.fetch('/api/open-artifact.events', { ...(cookie ? { cookie } : {}), signal: abort.signal });
      assert.equal(response.status, 200);
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let pending: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;
      const pull = async (ms: number): Promise<boolean> => {
        pending ??= reader.read();
        const step = await Promise.race([pending, new Promise<null>((done) => setTimeout(() => done(null), ms))]);
        if (!step) return false;
        pending = null;
        if (step.done) return false;
        buffer += decoder.decode(step.value, { stream: true });
        return true;
      };
      return {
        response,
        async next(needle) {
          const end = Date.now() + 2000;
          while (!buffer.includes(needle)) {
            if (Date.now() > end) throw new Error(`no ${needle} in ${JSON.stringify(buffer)}`);
            await pull(100);
          }
          const at = buffer.indexOf(needle) + needle.length;
          const seen = buffer.slice(0, at);
          buffer = buffer.slice(at);
          return seen;
        },
        async quiet(ms = 150) {
          while (await pull(ms)) {
            /* drain */
          }
          const seen = buffer;
          buffer = '';
          return seen;
        },
        close() {
          abort.abort();
          void reader.cancel().catch(() => undefined);
        },
      };
    };

    it('sends only what the listener may see, and `removed` when they lose it', async (t) => {
      const shut = await app.artifact(ada.user, { title: 'Ada only' });
      const stream = await open(eve.cookie);
      t.after(() => stream.close());
      assert.equal(stream.response.headers.get('content-type'), 'text/event-stream; charset=utf-8');
      await stream.next(': hello');
      app.events.emit('artifact-touched', { id: shut.id, author: 'owner', paths: ['a'] });
      app.events.emit('artifact-touched', { id: board.id, author: 'owner', paths: ['elements/x'] });
      const seen = await stream.next('elements/x');
      assert.ok(!seen.includes(shut.id), 'nothing about an artifact Eve cannot open');
      assert.ok(seen.includes('"paths":["elements/x') && seen.includes(board.id));
      await app.catalog.removeGrant(board.id, 'user', eve.user.id);
      await app.catalog.bumpGrantsVersion(board.id);
      app.events.emit('access-changed', { id: board.id });
      assert.ok((await stream.next('"removed":true}\n\n')).includes(board.id));
      app.events.emit('artifact-changed', { id: board.id });
      assert.equal(await stream.quiet(), '', 'nothing more once it is gone');
      stream.close();
      await app.catalog.upsertGrant({ artifactId: board.id, subjectKind: 'user', subject: eve.user.id, role: 'editor', createdBy: ada.user.id });
    });

    it("the owner's computer coming or going changes their artifacts, said only to those who may see them", async (t) => {
      const eveOwn = await app.artifact(eve.user, { title: 'Eve own' });
      const stream = await open(eve.cookie);
      t.after(() => stream.close());
      await stream.next(': hello');
      app.setLinkOnline(ada.user.id, true);
      const seen = await stream.next(`"id":"${board.id}"}\n\n`);
      assert.ok(seen.includes('"type":"artifacts/changed"'));
      assert.ok(!seen.includes(eveOwn.id), "Eve's own artifact is not Ada's");
      app.setLinkOnline(ada.user.id, false);
      await stream.next(`"id":"${board.id}"}\n\n`);
      // A stranger's computer: nothing the stream knows is theirs.
      const stranger = await app.person('Stranger');
      app.setLinkOnline(stranger.user.id, true);
      app.setLinkOnline(stranger.user.id, false);
      assert.equal(await stream.quiet(), '');
      stream.close();
    });

    it('a link guest hears their artifact; anonymous hears public artifacts only', async (t) => {
      const linked = await app.artifact(ada.user, { generalAccess: 'link' });
      const pub = await app.artifact(ada.user, { generalAccess: 'public' });
      const { link } = await app.catalog.createLink(linked.id, 'viewer');
      const { secret } = await app.catalog.joinGuest(link.id, 'Gus');
      const guest = await open(`${guestCookie(app.config, linked.id).name}=${secret}`);
      const anon = await open();
      t.after(() => {
        guest.close();
        anon.close();
      });
      await guest.next(': hello');
      await anon.next(': hello');
      app.events.emit('artifact-changed', { id: board.id });
      app.events.emit('artifact-changed', { id: linked.id });
      app.events.emit('artifact-changed', { id: pub.id });
      const heardByGuest = await guest.next(pub.id);
      assert.ok(heardByGuest.includes(linked.id));
      assert.ok(!heardByGuest.includes(board.id));
      const heardByAnon = await anon.next(pub.id);
      assert.ok(!heardByAnon.includes(linked.id));
      assert.ok(!heardByAnon.includes(board.id));
      guest.close();
      anon.close();
    });

    it('a bad Bearer is a 401, not an anonymous stream', async () => {
      const response = await app.fetch('/api/open-artifact.events', { headers: { authorization: 'Bearer nope' } });
      assert.equal(response.status, 401);
    });
  });
});

test('isPotentiallyTrustworthyOrigin: https, or http on localhost, *.localhost, 127.0.0.0/8 or [::1]', () => {
  for (const origin of [
    'https://app.example.com',
    'https://nas.lan',
    'https://{id}.content.example.net',
    'http://localhost:4900',
    'http://LOCALHOST',
    'http://app.oa.localhost:4900',
    'http://{id}.content.localhost:4900',
    'http://127.0.0.1:4900',
    'http://127.8.9.10',
    'http://[::1]:4900',
    'wss://app.example.com',
  ]) {
    assert.equal(isPotentiallyTrustworthyOrigin(origin), true, origin);
  }
  for (const origin of [
    'http://nas.lan:4900',
    'http://{id}.oa-content.lan:4900',
    'http://{id}.192-168-1-20.nip.io:4900',
    'http://192.168.1.20:4900',
    'http://10.0.0.1',
    'http://[fe80::1]',
    'http://localhost.example.com',
    'http://127.0.0.1.nip.io',
    'http://box',
    'ftp://localhost',
    'not a url',
  ]) {
    assert.equal(isPotentiallyTrustworthyOrigin(origin), false, origin);
  }
});

/** App answers under `env`: an API answer, a missing path, the Shell page (signed in). */
async function appAnswers(env: Record<string, string>): Promise<Record<'api' | 'missing' | 'shell', Response>> {
  const app = await makeApp({ env });
  try {
    const ada = await app.person('Ada');
    const board = await app.artifact(ada.user);
    const api = await app.fetch(`/api/open-artifact.artifact?id=${board.id}`, { cookie: ada.cookie });
    const missing = await app.fetch('/nothing-here');
    const shell = await app.fetch(`/a/${board.id}`, { cookie: ada.cookie });
    assert.equal(shell.status, 200, `${env.OA_APP_ORIGIN}: the Shell page`);
    for (const response of [api, missing, shell]) await response.body?.cancel();
    return { api, missing, shell };
  } finally {
    await app.close();
  }
}

test('on an https app origin and a localhost http one, answers carry Origin-Agent-Cluster and the Shell COOP', async () => {
  for (const env of [
    { OA_APP_ORIGIN: 'https://app.example.com', OA_CONTENT_ORIGIN: 'https://{id}.content.example.net' },
    { OA_APP_ORIGIN: 'http://localhost:4900', OA_CONTENT_ORIGIN: 'http://{id}.content.localhost:4900' },
  ]) {
    const { api, missing, shell } = await appAnswers(env);
    for (const response of [api, missing, shell]) {
      assert.equal(response.headers.get('origin-agent-cluster'), '?1', env.OA_APP_ORIGIN);
      assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin', env.OA_APP_ORIGIN);
    }
    assert.equal(shell.headers.get('cross-origin-opener-policy'), APP_OPENER_POLICY, env.OA_APP_ORIGIN);
    assert.equal(api.headers.get('cross-origin-opener-policy'), null, env.OA_APP_ORIGIN);
  }
});

// Not run against the Worker: it takes no plain-http origin but localhost (`config.test.ts` in host-cloudflare).
test('on a plain-http LAN app origin, no COOP and no Origin-Agent-Cluster (a browser ignores both there); CORP stays', async () => {
  const env = { OA_APP_ORIGIN: 'http://nas.lan:4900', OA_CONTENT_ORIGIN: 'http://{id}.oa-content.lan:4900' };
  const { api, missing, shell } = await appAnswers(env);
  for (const response of [api, missing, shell]) {
    assert.equal(response.headers.get('origin-agent-cluster'), null);
    assert.equal(response.headers.get('cross-origin-opener-policy'), null);
    assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');
  }
  assert.match(shell.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
});
