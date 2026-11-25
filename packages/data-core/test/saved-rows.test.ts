import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_SAVED_ROWS,
  getSavedRowsShape,
  isInViewerFolder,
  isSavedRowsPath,
  parseDatasetSource,
  resolveSavedRowsPath,
  savedRowsPathProblem,
  savedRowsTable,
} from '../src/index.ts';

describe('saved rows paths', () => {
  it('finds a path inside the viewer’s own folder, and nowhere else', () => {
    assert.equal(isInViewerFolder('data/users/guest-ab/notes', 'guest-ab'), true);
    assert.equal(isInViewerFolder('data/users/guest-ab/notes/items/1', 'guest-ab'), true);
    assert.equal(isInViewerFolder('data/users/guest-ab', 'guest-ab'), false);
    assert.equal(isInViewerFolder('data/users/guest-cd/notes', 'guest-ab'), false);
    assert.equal(isInViewerFolder('data/team/notes/1', 'guest-ab'), false);
    assert.equal(isInViewerFolder('datasets/x', 'guest-ab'), false);
    assert.equal(isInViewerFolder('data/users/me/notes', 'me'), false);
    assert.equal(isInViewerFolder('data/users//notes', ''), false);
    assert.equal(isInViewerFolder('data/users/guest-ab/../guest-cd/notes', 'guest-ab'), false);
  });

  it('tells a collection from one document by the number of parts', () => {
    assert.equal(getSavedRowsShape('data/team/notes'), 'collection');
    assert.equal(getSavedRowsShape('data/team/notes/today'), 'document');
    assert.equal(getSavedRowsShape('data/users/me/notes'), 'document');
    assert.equal(getSavedRowsShape('data/users/me/notes/items'), 'collection');
  });

  it('reads data/users/me as the viewer, and nothing else', () => {
    assert.equal(resolveSavedRowsPath('data/users/me/notes', 'guest-7'), 'data/users/guest-7/notes');
    assert.equal(resolveSavedRowsPath('data/users/me', 'owner'), 'data/users/owner');
    assert.equal(resolveSavedRowsPath('data/users/meow/notes', 'owner'), 'data/users/meow/notes');
    assert.equal(resolveSavedRowsPath('data/team/me', 'owner'), 'data/team/me');
  });

  it('keeps the page\'s own reports and anything outside data/ out', () => {
    assert.equal(isSavedRowsPath('data/team/notes'), true);
    assert.equal(savedRowsPathProblem('files/index.html'), 'outside_data');
    assert.equal(savedRowsPathProblem('data'), 'outside_data');
    assert.equal(savedRowsPathProblem('data/users/x'), 'own_report');
    assert.equal(savedRowsPathProblem('data/users/x/history-'), 'own_report');
    assert.equal(savedRowsPathProblem('data/users/x/notes'), null);
    assert.equal(savedRowsPathProblem('data/./x'), 'bad_segment');
    assert.equal(savedRowsPathProblem(`data/${'a'.repeat(201)}`), 'bad_segment');
    assert.equal(savedRowsPathProblem(3), 'not_text');
  });

  it('parses a store source, emptying a path it cannot read', () => {
    assert.deepEqual(parseDatasetSource({ kind: 'store', path: 'data/team/notes' }), { kind: 'store', path: 'data/team/notes' });
    assert.deepEqual(parseDatasetSource({ kind: 'store', path: 'datasets/x' }), { kind: 'store', path: '' });
  });
});

describe('saved rows table', () => {
  it('gives one row per document by ID, each with its id', () => {
    const table = savedRowsTable([
      { id: 'b', data: { text: 'second', done: true } },
      { id: 'a', data: { text: 'first', id: 'ignored' } },
    ]);
    assert.deepEqual(table.columns, ['id', 'text', 'done']);
    assert.deepEqual(
      table.rows.map((row) => ({ ...row })),
      [
        { id: 'a', text: 'first', done: null },
        { id: 'b', text: 'second', done: true },
      ],
    );
    assert.equal(table.cut, undefined);
  });

  it('starts empty with only the id column', () => {
    assert.deepEqual(savedRowsTable([]), { columns: ['id'], rows: [] });
  });

  it('keeps the first rows by ID and says the rest were cut', () => {
    const documents = Array.from({ length: MAX_SAVED_ROWS + 5 }, (_, index) => ({ id: `n${String(index).padStart(5, '0')}`, data: { index } }));
    const table = savedRowsTable(documents.reverse());
    assert.equal(table.rows.length, MAX_SAVED_ROWS);
    assert.equal(table.rows[0]?.id, 'n00000');
    assert.equal(table.cut, 'rows');
  });
});
