import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isArtifactError, type DbCapability, type DbWrite, type JsonRecord, type Viewer } from '@open-artifact/runtime';
import { roleAbilities } from '@open-artifact/editor-kit';
import { createPageCapabilities, embeddedPageCapabilities, type PageDb } from '../src/page/capabilities.ts';
import { INLINE_READ_ONLY_MESSAGE, inlineAbilities, isInlineViewLink, readInlineView, readOnlyDb } from '../src/platform/inline-view.ts';

function store(docs: Record<string, JsonRecord>): DbCapability & { writes: DbWrite[][] } {
  const writes: DbWrite[][] = [];
  return {
    writes,
    get: async (path) => docs[path] ?? null,
    list: async (collection) =>
      Object.entries(docs)
        .filter(([path]) => path.startsWith(`${collection}/`))
        .map(([path, data]) => ({ path, data, sha256: 'x' })),
    write: async (batch) => {
      writes.push(batch);
    },
    onChange: () => () => undefined,
  };
}

describe('the embedded view', () => {
  it('is on only inside a frame opened at #view-inline', () => {
    const top = { location: { hash: '#view-inline' } } as { parent?: unknown; location: { hash: string } };
    top.parent = top;
    assert.equal(readInlineView(top as never), false);
    assert.equal(readInlineView({ parent: {}, location: { hash: '#view-inline' } }), true);
    assert.equal(readInlineView({ parent: {}, location: { hash: '#usage' } }), false);
  });

  it('keeps only the ability to load data', () => {
    const owner = inlineAbilities(roleAbilities('owner'));
    assert.deepEqual(owner, { ...roleAbilities('viewer'), canUseConnectors: true, canComment: false });
    assert.equal(inlineAbilities(roleAbilities('editor')).canUseConnectors, roleAbilities('editor').canUseConnectors);
  });

  it('reads the store and refuses every write', async () => {
    const inner = store({ 'dash/meta': { title: 'Sales' } });
    const db = readOnlyDb(inner);
    assert.deepEqual(await db.get('dash/meta'), { title: 'Sales' });
    await assert.rejects(db.write([{ op: 'set', path: 'dash/meta', data: {}, ifMatch: null }]), (error) => isArtifactError(error, 'not_writer'));
    assert.deepEqual(inner.writes, []);
  });

  it('ignores a page link of #view-inline', () => {
    assert.equal(isInlineViewLink('view-inline'), true);
    assert.equal(isInlineViewLink('usage'), false);
  });

  it('gives a page script only db and user, and db only to read', async () => {
    const viewer: Viewer = { id: 'u1', name: 'Ada', role: 'owner' };
    const inner = store({ 'data/team/notes/a': { text: 'one' } });
    const full = createPageCapabilities({
      db: () => inner,
      viewer: () => viewer,
      canEdit: () => true,
      downloads: () => null,
      assets: () => ({ upload: async () => ({ url: '/_blob/0', name: 'x', type: 'text/plain', size: 0 }) }) as never,
      wrote: () => undefined,
    });
    const embedded = embeddedPageCapabilities(full);
    assert.equal(await embedded.use('downloads'), null);
    assert.equal(await embedded.use('assets'), null);
    assert.notEqual(await full.use('assets'), null);
    const user = (await embedded.use('user')) as { me(): Promise<Viewer> };
    assert.deepEqual(await user.me(), viewer);
    const db = (await embedded.use('db')) as PageDb;
    assert.equal((await db.list('data/team/notes')).length, 1);
    await assert.rejects(db.add('data/team/notes', { text: 'two' }), { message: INLINE_READ_ONLY_MESSAGE });
    await assert.rejects(db.write([{ op: 'delete', path: 'data/team/notes/a' }]), { message: INLINE_READ_ONLY_MESSAGE });
    assert.deepEqual(inner.writes, []);
  });
});
