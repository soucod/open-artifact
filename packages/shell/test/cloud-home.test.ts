/**
 * The cloud home page's pure parts: an upload's states and the host's refusals in plain words, the Trash view's rows
 * and "Delete forever" after a host that cannot (501), the trash's keep time, sign-out behind Cloudflare Access, and
 * the extra home boot field.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ArtifactView } from '@open-artifact/protocol';
import { createLibraryApi } from '../src/lib/api.ts';
import { accessLogoutOf, homeBootOf, signOutTarget, signsInThroughAccess } from '../src/lib/cloud.ts';
import { translate, type MessageKey } from '../src/lib/i18n.ts';
import { keepNote, offersPurge, purgeOutcome, trashRows, type TrashedView } from '../src/home/trash.ts';
import {
  dragHasFiles,
  failureOfAnswer,
  importedId,
  isZipFile,
  limitOf,
  pickZip,
  sizeText,
  tooLargeToSend,
  uploadBusy,
  uploadFailure,
  uploadPercent,
  uploadStep,
  type UploadState,
} from '../src/home/upload.ts';

describe('an upload', () => {
  it('goes sending → checking → done, with its progress', () => {
    let state: UploadState = { kind: 'idle' };
    state = uploadStep(state, { type: 'start', name: 'board.zip', size: 2000 });
    assert.deepEqual(state, { kind: 'sending', name: 'board.zip', loaded: 0, total: 2000 });
    assert.equal(uploadBusy(state), true);
    state = uploadStep(state, { type: 'progress', loaded: 500, total: 2000 });
    assert.equal(uploadPercent(state), 25);
    // A late, smaller progress event does not move it back.
    state = uploadStep(state, { type: 'progress', loaded: 100, total: 2000 });
    assert.equal(uploadPercent(state), 25);
    state = uploadStep(state, { type: 'sent' });
    assert.deepEqual(state, { kind: 'checking', name: 'board.zip' });
    assert.equal(uploadPercent(state), 100);
    state = uploadStep(state, { type: 'done', id: 'art_1' });
    assert.deepEqual(state, { kind: 'done', name: 'board.zip', id: 'art_1' });
    assert.equal(uploadBusy(state), true);
  });

  it('runs one at a time; a failure is shown until dismissed, then another may start', () => {
    let state = uploadStep({ kind: 'idle' }, { type: 'start', name: 'a.zip', size: 10 });
    assert.equal(uploadStep(state, { type: 'start', name: 'b.zip', size: 10 }), state);
    state = uploadStep(state, { type: 'failed', said: { key: 'uploadNotArtifact' } });
    assert.deepEqual(state, { kind: 'failed', name: 'a.zip', said: { key: 'uploadNotArtifact' } });
    assert.equal(uploadBusy(state), false);
    assert.equal(uploadStep(state, { type: 'progress', loaded: 5, total: 10 }), state);
    assert.deepEqual(uploadStep(state, { type: 'dismiss' }), { kind: 'idle' });
    assert.equal(uploadStep(state, { type: 'start', name: 'b.zip', size: 3 }).kind, 'sending');
  });

  it('has no percentage while the size is unknown', () => {
    const state = uploadStep({ kind: 'idle' }, { type: 'start', name: 'a.zip', size: 0 });
    assert.equal(uploadPercent(state), null);
    assert.equal(uploadPercent(uploadStep(state, { type: 'progress', loaded: 5, total: 10 })), 50);
  });

  it('takes a .zip by its name or type, and says so when none of the files is one', () => {
    assert.equal(isZipFile({ name: 'Board.ZIP', type: '' }), true);
    assert.equal(isZipFile({ name: 'board', type: 'application/x-zip-compressed' }), true);
    assert.equal(isZipFile({ name: 'board.png', type: 'image/png' }), false);
    const png = { name: 'a.png', type: 'image/png' };
    const zip = { name: 'b.zip', type: 'application/zip' };
    assert.deepEqual(pickZip([png, zip]), { file: zip });
    assert.deepEqual(pickZip([png]), { said: { key: 'uploadNotZip' } });
    assert.equal(pickZip([]), null);
    assert.equal(dragHasFiles(['Files']), true);
    assert.equal(dragHasFiles(['text/plain', 'text/uri-list']), false);
    assert.equal(dragHasFiles(null), false);
  });

  it("says each of the host's refusals in plain words", () => {
    assert.deepEqual(uploadFailure({ status: 0, code: 'connect_failed', message: '' }), { key: 'uploadNoAnswer' });
    assert.deepEqual(uploadFailure({ status: 401, code: 'unauthorized', message: 'Sign in.' }), { key: 'uploadSignedOut' });
    assert.deepEqual(uploadFailure({ status: 403, code: 'not_granted', message: 'No.' }), { key: 'uploadNotAllowed' });
    // The host's own limit, from its message: the page never assumes one.
    assert.deepEqual(uploadFailure({ status: 413, code: 'too_large', message: 'The request body is larger than 104857600 bytes.' }), {
      key: 'uploadTooLargeLimit',
      vars: { limit: '100 MB' },
    });
    assert.deepEqual(uploadFailure({ status: 413, code: 'error', message: '' }), { key: 'uploadTooLarge' });
    assert.deepEqual(uploadFailure({ status: 413, code: 'too_large', message: 'The archive holds 20000 files, more than 10000.' }), {
      key: 'uploadTooLargeSaid',
      vars: { error: 'The archive holds 20000 files, more than 10000.' },
    });
    assert.deepEqual(uploadFailure({ status: 415, code: 'invalid_argument', message: 'Send it as application/zip.' }), { key: 'uploadNotZip' });
    assert.deepEqual(uploadFailure({ status: 400, code: 'not_artifact', message: "The archive is not an artifact: it holds no known type's marker file." }), { key: 'uploadNotArtifact' });
    assert.deepEqual(uploadFailure({ status: 400, code: 'invalid_archive', message: 'This file is not a zip.' }), { key: 'uploadNotArtifact' });
    assert.deepEqual(uploadFailure({ status: 400, code: 'unsupported', message: 'The motion type is not installed on this host.' }), { key: 'uploadTypeMissing', vars: { type: 'motion' } });
    assert.deepEqual(uploadFailure({ status: 409, code: 'exists', message: 'x exists already.' }), { key: 'uploadConflict' });
    assert.deepEqual(uploadFailure({ status: 500, code: 'error', message: 'Boom.' }), { key: 'uploadFailed', vars: { error: 'Boom.' } });
    assert.deepEqual(uploadFailure({ status: 502, code: 'error', message: '' }), { key: 'uploadFailed', vars: { error: 'HTTP 502' } });
  });

  it("reads the host's answer: the new id, or its {code, message} (a proxy's page counts as no message)", () => {
    assert.equal(importedId('{"id":"art_abc","title":"Board"}'), 'art_abc');
    assert.equal(importedId('<html>'), null);
    assert.equal(importedId('{"id":""}'), null);
    assert.deepEqual(failureOfAnswer(400, '{"code":"not_artifact","message":"Not one."}'), { status: 400, code: 'not_artifact', message: 'Not one.' });
    assert.deepEqual(failureOfAnswer(413, '<html>Too big</html>'), { status: 413, code: 'error', message: '' });
  });

  it('writes sizes for people', () => {
    assert.equal(sizeText(900), '900 B');
    assert.equal(sizeText(1536), '1.5 KB');
    assert.equal(sizeText(32 * 1024 * 1024), '32 MB');
    assert.equal(sizeText(3.25 * 1024 ** 3), '3.3 GB');
    assert.equal(limitOf('larger than 33554432 bytes'), '32 MB');
    assert.equal(limitOf('Too large.'), null);
  });

  it("refuses a zip over the site's limit before sending it, saying the limit", () => {
    const limit = 32 * 1024 * 1024;
    assert.deepEqual(tooLargeToSend(limit + 1, limit), { key: 'uploadTooLargeLimit', vars: { limit: '32 MB' } });
    assert.equal(translate('en', 'uploadTooLargeLimit', { limit: '32 MB' }).includes('up to 32 MB'), true);
    assert.equal(tooLargeToSend(limit, limit), null);
    // No limit in the boot (an older host): sent, and the host's 413 says it.
    assert.equal(tooLargeToSend(limit * 10, undefined), null);
  });

  it('reads the upload limit from the home boot', () => {
    const home = { user: null, appOrigin: 'https://oa.example', signInUrl: '/in', signOutUrl: '/out' };
    assert.deepEqual(homeBootOf({ cloud: { ...home, limits: { importBytes: 33554432 } } }), { cloud: { ...home, limits: { importBytes: 33554432 } } });
    assert.deepEqual(homeBootOf({ cloud: { ...home, limits: { importBytes: 'big' } } }), { cloud: home });
    assert.deepEqual(homeBootOf({ cloud: { ...home, limits: { importBytes: 0 } } }), { cloud: home });
    assert.deepEqual(homeBootOf({ cloud: { ...home, limits: null } }), { cloud: home });
  });
});

const view = (patch: Partial<TrashedView>): TrashedView =>
  ({
    id: 'art_1',
    url: '',
    title: 'Board',
    type: 'whiteboard',
    typeTitle: 'Whiteboard',
    typeMissing: false,
    root: '',
    view_url: '',
    page_url: '',
    owner: null,
    pinned: false,
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
    openedAt: null,
    contentAt: '2026-11-02T00:00:00.000Z',
    thumbnail: null,
    shared: false,
    open: false,
    role: 'owner',
    ...patch,
  }) as ArtifactView;

describe('the Trash view', () => {
  it('lists the most recently trashed first, with when it was trashed when the host says, else when it last changed', () => {
    const rows = trashRows([
      view({ id: 'art_a', title: 'Old', updatedAt: '2026-11-01T00:00:00.000Z' }),
      view({ id: 'art_b', title: 'New', trashedAt: '2026-11-20T00:00:00.000Z' }),
      view({ id: 'art_c', title: 'Theirs', role: 'editor', updatedAt: '2026-11-05T00:00:00.000Z' }),
    ]);
    assert.deepEqual(
      rows.map((r) => [r.id, r.when.kind, r.mine]),
      [
        ['art_b', 'trashed', true],
        ['art_c', 'changed', false],
        ['art_a', 'changed', true],
      ],
    );
    assert.equal(rows[0]!.typeTitle, 'Whiteboard');
  });

  it('offers Delete forever to the owner only, and not after the host said it cannot', () => {
    assert.equal(offersPurge({ mine: true }, false), true);
    assert.equal(offersPurge({ mine: false }, false), false);
    assert.equal(offersPurge({ mine: true }, true), false);
    assert.deepEqual(purgeOutcome(501, 'This host cannot delete artifacts for good.'), { unsupported: true });
    assert.deepEqual(purgeOutcome(409, 'Move it to the trash first.'), { unsupported: false, said: { key: 'purgeNotTrashed' } });
    assert.deepEqual(purgeOutcome(404, 'No such artifact.'), { unsupported: false, said: { key: 'purgeGone' } });
    assert.deepEqual(purgeOutcome(500, 'Boom.'), { unsupported: false, said: { key: 'couldNotPurge', vars: { error: 'Boom.' } } });
  });

  it('says how long the trash keeps things only when the host says', () => {
    assert.equal(keepNote(undefined), null);
    assert.equal(keepNote(-1), null);
    assert.deepEqual(keepNote(0), { key: 'trashKeptForever' });
    assert.deepEqual(keepNote(1), { key: 'trashKeptOneDay' });
    assert.deepEqual(keepNote(30), { key: 'trashKeptDays', vars: { days: 30 } });
    assert.equal(translate('en', 'trashKeptDays', { days: 30 }), 'Deleted for good after 30 days in the trash.');
  });

  it('reads `trashDays` from the home boot when the host sends it, and nothing else extra', () => {
    const home = { user: null, appOrigin: 'https://oa.example', signInUrl: '/in', signOutUrl: '/out' };
    assert.deepEqual(homeBootOf({ cloud: { ...home, trashDays: 30 } }), { cloud: { ...home, trashDays: 30 } });
    assert.deepEqual(homeBootOf({ cloud: { ...home, trashDays: 'soon' } }), { cloud: home });
    assert.deepEqual(homeBootOf({ cloud: { ...home, trashDays: 2.5 } }), { cloud: home });
  });

  it('lists with ?trashed=1 and purges through artifacts.purge', async () => {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    const api = createLibraryApi({
      fetch: async (url, init) => {
        calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : null });
        if (url.includes('purge')) return new Response(JSON.stringify({ code: 'unsupported', message: 'This host cannot delete artifacts for good.' }), { status: 501 });
        return Response.json({ artifacts: [view({})] });
      },
    });
    assert.equal((await api.trashed()).length, 1);
    await assert.rejects(api.purge('art_1'), (error: { status?: number; code?: string }) => error.status === 501 && error.code === 'unsupported');
    assert.deepEqual(calls, [
      { url: '/api/open-artifact.artifacts?trashed=1', method: 'GET', body: null },
      { url: '/api/open-artifact.artifacts.purge', method: 'POST', body: { id: 'art_1' } },
    ]);
  });
});

describe('signing out behind Cloudflare Access', () => {
  it("goes to Access's logout address when the host's answer names one, else reloads", () => {
    assert.equal(signOutTarget({ signedOut: true, accessLogoutUrl: 'https://team.cloudflareaccess.com/cdn-cgi/access/logout' }), 'https://team.cloudflareaccess.com/cdn-cgi/access/logout');
    assert.equal(signOutTarget({ signedOut: true }), null);
    assert.equal(signOutTarget(null), null);
    assert.equal(signOutTarget({ accessLogoutUrl: 'javascript:alert(1)' }), null);
    assert.equal(signOutTarget({ accessLogoutUrl: 'not a url' }), null);
  });

  it('knows the site signs in through Access from auth.me', () => {
    assert.equal(signsInThroughAccess({ providers: [{ id: 'cloudflare-access', name: 'Cloudflare Access', url: '' }] }), true);
    assert.equal(signsInThroughAccess({ providers: [{ id: 'owner-key' }, { id: 'github' }] }), false);
    assert.equal(signsInThroughAccess({}), false);
    assert.equal(signsInThroughAccess(null), false);
  });

  it("takes Access's logout address from auth.me, for a sign-out whose answer names none", () => {
    const me = { principal: { kind: 'anonymous' }, providers: [], signInUrl: '/in', signOutUrl: '/out', accessLogoutUrl: 'https://team.cloudflareaccess.com/cdn-cgi/access/logout' };
    assert.equal(accessLogoutOf(me), 'https://team.cloudflareaccess.com/cdn-cgi/access/logout');
    assert.equal(signsInThroughAccess(me), true);
    assert.equal(accessLogoutOf({ providers: [] }), null);
    assert.equal(accessLogoutOf({ accessLogoutUrl: 'javascript:alert(1)' }), null);
  });
});

describe('the words', () => {
  it('every new message has English and Chinese', () => {
    const keys: MessageKey[] = [
      'signOutAccess', 'upload', 'uploadHint', 'uploadDrop', 'uploadSending', 'uploadSendingSize', 'uploadChecking', 'uploadOpening', 'uploadNotZip',
      'uploadNotArtifact', 'uploadTooLargeLimit', 'uploadTooLarge', 'uploadTooLargeSaid', 'uploadSignedOut', 'uploadNotAllowed', 'uploadConflict', 'uploadTypeMissing',
      'uploadBusy', 'uploadNoAnswer', 'uploadFailed', 'dismiss', 'trash', 'trashEmpty', 'trashNote', 'trashedWhen', 'trashKeptDays', 'trashKeptOneDay',
      'trashKeptForever', 'restore', 'restoredTitle', 'deleteForever', 'purgeTitle', 'purgeBody', 'purged', 'purgeNotTrashed', 'purgeGone', 'couldNotPurge',
      'moveToTrash', 'movedToTrash', 'shareOnNetwork', 'shareOnNetworkSub',
    ];
    for (const key of keys) assert.notEqual(translate('zh-CN', key), translate('en', key), key);
  });

  it("says the not-an-artifact refusal the way the Export tab names the zip", () => {
    assert.equal(translate('en', 'uploadNotArtifact'), 'That zip is not an Open Artifact folder. Use “Whole folder (.zip)” from an artifact’s Export tab.');
    assert.ok(translate('en', 'uploadNotArtifact').includes(translate('en', 'archiveLabel')));
    assert.ok(translate('zh-CN', 'uploadNotArtifact').includes(translate('zh-CN', 'archiveLabel')));
  });
});

describe('the cloud home page opens on the Trash for /#trash', () => {
  it('reads the fragment', async () => {
    const { initialCloudTab } = await import('../src/home/store.ts');
    assert.equal(initialCloudTab('#trash'), 'trash');
    assert.equal(initialCloudTab(''), 'artifacts');
    assert.equal(initialCloudTab('#other'), 'artifacts');
  });
});
