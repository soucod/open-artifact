import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dropLegacyKeys, isLegacyKey, storageScope } from '../src/services/storage-scope.ts';

const TOKEN = 'v1.eyJhIjoiYXJ0X3gifQ.c2ln';

/** A Storage in memory. */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  };
}

describe('board storage scope', () => {
  it('files by the Shell’s artifact id when it gives one', () => {
    assert.equal(storageScope('art_x', `/whiteboard/${TOKEN}/`), 'artifact:art_x');
    assert.equal(storageScope('a/b', '/'), 'artifact:a%2Fb');
  });

  it('takes the page token out of a cloud path, so reloads share a scope', () => {
    assert.equal(storageScope(null, `/whiteboard/${TOKEN}/`), '/whiteboard/');
    assert.equal(storageScope(null, '/whiteboard/v1.other.mac/'), '/whiteboard/');
    assert.equal(storageScope(null, `/whiteboard/${TOKEN}`), '/whiteboard');
  });

  it('keeps a local path as it is', () => {
    assert.equal(storageScope(undefined, '/a/board/'), '/a/board/');
    assert.equal(storageScope(null, '/'), '/');
  });

  it('finds the keys earlier pages left: path saved copies, and markers under a token', () => {
    assert.equal(isLegacyKey(`wb-saved-copy:/whiteboard/${TOKEN}/`), true);
    assert.equal(isLegacyKey('wb-saved-copy:/a/board/'), true);
    assert.equal(isLegacyKey(`wb-camera:/whiteboard/${TOKEN}/`), true);
    assert.equal(isLegacyKey(`wb-load:/whiteboard/${TOKEN}/:paused`), true);
    assert.equal(isLegacyKey(`wb-agent:/whiteboard/${TOKEN}/`), true);
    assert.equal(isLegacyKey('wb-camera:artifact:art_x'), false);
    assert.equal(isLegacyKey('wb-camera:/a/board/'), false);
    assert.equal(isLegacyKey('wb-copy:artifact:art_x:u1:owner'), false);
    assert.equal(isLegacyKey('other:/whiteboard/v1.x/'), false);
  });

  it('drops them from both storages and leaves the rest', () => {
    const local = memoryStorage();
    const session = memoryStorage();
    const saved = { localStorage: globalThis.localStorage, sessionStorage: globalThis.sessionStorage };
    Object.defineProperty(globalThis, 'localStorage', { value: local, configurable: true });
    Object.defineProperty(globalThis, 'sessionStorage', { value: session, configurable: true });
    try {
      local.setItem(`wb-saved-copy:/whiteboard/${TOKEN}/`, '[]');
      local.setItem('wb-copy:artifact:art_x:u1:owner', '[]');
      local.setItem('unrelated', '1');
      session.setItem(`wb-camera:/whiteboard/${TOKEN}/`, '{}');
      session.setItem('wb-camera:artifact:art_x', '{}');
      dropLegacyKeys();
      assert.deepEqual([local.length, local.key(0), local.key(1)], [2, 'wb-copy:artifact:art_x:u1:owner', 'unrelated']);
      assert.deepEqual([session.length, session.key(0)], [1, 'wb-camera:artifact:art_x']);
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: saved.localStorage, configurable: true });
      Object.defineProperty(globalThis, 'sessionStorage', { value: saved.sessionStorage, configurable: true });
    }
  });
});
