/**
 * The local Share tab's layout: a published artifact leads with its web page and keeps this network's sharing under
 * a closed disclosure; one that is not published keeps the panel as it was. And the default site with two sites.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { defaultSite, offersDefaultPicker, publishedOf, type RemoteArtifact, type RemoteInfo } from '../src/lib/publish.ts';
import { networkStatus, shareLayout } from '../src/lib/share-layout.ts';

const published = (id: string): RemoteArtifact => ({
  id,
  url: `https://oa.example/a/${id}`,
  title: 'Board',
  view_url: `https://oa.example/a/${id}`,
  syncedAt: null,
  lastSyncAt: null,
  pending: [],
  lastError: null,
  code: null,
});

function remote(patch: Partial<RemoteInfo> = {}): RemoteInfo {
  return { name: 'work', host: 'https://oa.example', user: { id: 'u1', name: 'Ada' }, signedIn: true, connected: true, reachable: true, lastEventId: null, lastError: null, code: null, artifacts: [], ...patch };
}

describe('the Share tab layout', () => {
  it('leads with the web page once GET remotes lists the artifact under a site', () => {
    assert.equal(shareLayout({ id: 'art_1', remotes: [remote({ artifacts: [published('art_1')] })], publishedUrl: null }), 'published');
    assert.equal(shareLayout({ id: 'art_1', remotes: [remote({ artifacts: [published('art_2')] })], publishedUrl: null }), 'lan');
    assert.equal(shareLayout({ id: 'art_1', remotes: [], publishedUrl: null }), 'lan');
  });

  it("uses the artifact's own web address until GET remotes answers, and the answer after that", () => {
    assert.equal(shareLayout({ id: 'art_1', remotes: null, publishedUrl: 'https://oa.example/a/art_1' }), 'published');
    assert.equal(shareLayout({ id: 'art_1', remotes: null, publishedUrl: null }), 'lan');
    // Unpublished since: the answer wins over a stale address.
    assert.equal(shareLayout({ id: 'art_1', remotes: [remote()], publishedUrl: 'https://oa.example/a/art_1' }), 'lan');
  });

  it('says beside the closed disclosure that network sharing is on, only while it is', () => {
    assert.equal(networkStatus({ lan: true }), 'sharedOnNetwork');
    assert.equal(networkStatus({ lan: false }), null);
    assert.equal(networkStatus(null), null);
  });
});

describe('the default site with two sites', () => {
  const work = remote({ name: 'work', host: 'https://oa.example' });
  const home = remote({ name: 'home', host: 'http://nas.lan:4900', artifacts: [published('art_1')] });

  it('offers the picker, names the daemon\'s default, and follows a change', () => {
    assert.equal(offersDefaultPicker([work, home]), true);
    assert.equal(defaultSite([work, home], { default: 'work', publish: 'manual', pending: [] }), 'work');
    assert.equal(defaultSite([work, home], { default: 'home', publish: 'manual', pending: [] }), 'home');
    // No default named and two sites: none (the auto-publish switch waits for one).
    assert.equal(defaultSite([work, home], { default: null, publish: 'manual', pending: [] }), null);
    // An older daemon marks it on the site.
    assert.equal(defaultSite([work, { ...home, default: true }], null), 'home');
  });

  it('finds the published artifact under the site that has it, whichever is the default', () => {
    assert.equal(publishedOf([work, home], 'art_1')?.remote.name, 'home');
    assert.equal(shareLayout({ id: 'art_1', remotes: [work, home], publishedUrl: null }), 'published');
  });
});
