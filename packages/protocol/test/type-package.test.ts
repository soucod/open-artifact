/**
 * `type-package.ts`: every rule a type to share is held to, as `types check --for-share`, `types pack` and
 * `types install` apply it: the paths, the entry kinds, names that collide by case or Unicode form, the limits, the
 * one top folder, the manifest (required fields, entry, network), and the policy of an installed type's page.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  installedTypeCsp,
  isHttpsOrigin,
  manifestPackageProblems,
  networkOrigins,
  networkProblems,
  packageEntryProblems,
  packageFileName,
  packagePathKey,
  packagePathProblem,
  packageTopFolder,
  TYPE_PACKAGE_LIMITS,
  type ArtifactTypeManifest,
  type PackageEntry,
} from '../src/index.ts';

const codes = (entries: PackageEntry[]): string[] => packageEntryProblems(entries).map((p) => p.code);
const file = (path: string, size = 1): PackageEntry => ({ path, kind: 'file', size });
const MANIFEST = { slug: 'kit', uid: '1b2c', name: 'Kit', version: '1.0.0', description: 'A kit.' };
const manifestCodes = (m: Record<string, unknown>, files?: string[]): string[] => manifestPackageProblems(m as ArtifactTypeManifest & Record<string, unknown>, files).map((p) => p.code);

test('packagePathProblem: relative paths inside the folder only', () => {
  assert.equal(packagePathProblem('index.html'), null);
  assert.equal(packagePathProblem('artifact-type/style.css'), null);
  assert.equal(packagePathProblem('dir/'), null, 'a folder entry');
  const cases: Array<[string, string]> = [
    ['', 'an empty path'],
    ['/etc/passwd', 'an absolute path'],
    ['C:/Windows', 'an absolute path'],
    ['c:x', 'an absolute path'],
    ['a\\b', 'a backslash'],
    ['a\0b', 'a control character'],
    ['a\nb', 'a control character'],
    ['a\u007fb', 'a control character'],
    ['../x', 'a ".." segment'],
    ['a/../../x', 'a ".." segment'],
    ['a//b', 'an empty segment'],
    ['./a', 'an empty segment'],
    ['.git/config', 'a dot file'],
    ['a/.env', 'a dot file'],
  ];
  for (const [path, why] of cases) assert.equal(packagePathProblem(path), why, JSON.stringify(path));
});

test('packagePathKey: case and Unicode form compare equal', () => {
  assert.equal(packagePathKey('README.md'), packagePathKey('readme.md'));
  assert.equal(packagePathKey('caf\u00e9'), packagePathKey('cafe\u0301'));
  assert.equal(packagePathKey('dir/'), packagePathKey('DIR'));
});

test('packageEntryProblems: each rejection', () => {
  assert.deepEqual(codes([file('index.html'), { path: 'dir/', kind: 'dir', size: 0 }, file('dir/a.txt')]), []);
  assert.deepEqual(codes([file('../evil')]), ['share_path']);
  assert.deepEqual(codes([file('/abs')]), ['share_path']);
  assert.deepEqual(codes([file('a\\b')]), ['share_path']);
  assert.deepEqual(codes([file('a\0b')]), ['share_path']);
  assert.deepEqual(codes([file('.hidden')]), ['share_dotfile']);
  assert.deepEqual(codes([file('Readme.md'), file('README.md')]), ['share_duplicate']);
  assert.deepEqual(codes([file('caf\u00e9.txt'), file('cafe\u0301.txt')]), ['share_duplicate']);
  assert.deepEqual(codes([{ path: 'link', kind: 'other', size: 0 }]), ['share_symlink']);
  assert.deepEqual(codes([file('big.bin', TYPE_PACKAGE_LIMITS.fileBytes + 1)]), ['share_file_too_large']);
  const many = Array.from({ length: TYPE_PACKAGE_LIMITS.files + 1 }, (_, i) => file(`f${i}`));
  assert.deepEqual(codes(many), ['share_too_many_files']);
  const heavy = Array.from({ length: 5 }, (_, i) => file(`h${i}`, TYPE_PACKAGE_LIMITS.fileBytes));
  assert.deepEqual(codes(heavy), ['share_too_large']);
});

test('packageTopFolder: one top folder, nothing beside it', () => {
  assert.deepEqual(packageTopFolder(['kit/', 'kit/a', 'kit/b/c']), { top: 'kit', paths: ['a', 'b/c'] });
  const problem = (names: string[]): string => {
    const got = packageTopFolder(names);
    assert.ok('problem' in got, names.join(','));
    return got.problem.message;
  };
  assert.match(problem(['a.txt']), /not inside the package's one top folder/);
  assert.match(problem(['kit/a', 'other/b']), /more than one top folder/);
  assert.match(problem(['/kit/a']), /not inside/);
  assert.match(problem([]), /empty/);
  assert.match(problem(['.kit/a']), /dot file/);
  assert.match(problem(['../a']), /".." segment/);
});

test('manifestPackageProblems: the required fields, the entry, the network', () => {
  assert.deepEqual(manifestCodes(MANIFEST), []);
  for (const field of ['slug', 'uid', 'name', 'version', 'description']) {
    const { [field]: _gone, ...rest } = MANIFEST as Record<string, unknown>;
    assert.deepEqual(manifestCodes(rest), ['share_field_missing'], field);
    assert.deepEqual(manifestCodes({ ...MANIFEST, [field]: '  ' }), ['share_field_missing'], `${field} blank`);
  }
  assert.deepEqual(manifestCodes({ ...MANIFEST, entry: 'index.html' }, ['index.html']), []);
  assert.deepEqual(manifestCodes({ ...MANIFEST, entry: 'page.html' }, ['index.html']), ['share_entry_missing']);
  assert.deepEqual(manifestCodes({ ...MANIFEST, entry: '../index.html' }), ['share_entry_outside']);
  assert.deepEqual(manifestCodes({ ...MANIFEST, entry: { start: { command: 'node', args: ['x.js'] }, open: true } }), ['share_entry_start']);
  assert.deepEqual(manifestCodes({ ...MANIFEST, entry: { url: 'http://127.0.0.1:1/' } }), ['share_entry_url']);
  assert.deepEqual(manifestCodes({ ...MANIFEST, entry: { open: true } }), ['share_entry_outside']);
  assert.deepEqual(manifestCodes({ ...MANIFEST, entry: 3 }), ['share_entry_outside']);
  assert.deepEqual(manifestCodes({ ...MANIFEST, openArtifact: { network: ['https://api.example.com'] } }), []);
  assert.deepEqual(manifestCodes({ ...MANIFEST, openArtifact: { network: ['http://api.example.com'] } }), ['share_network']);
});

test('networkProblems and isHttpsOrigin: https origins only, no wildcard, path or credentials', () => {
  assert.deepEqual(networkProblems([]), []);
  assert.deepEqual(networkProblems(['https://a.example.com', 'https://b.example.com:8443']), []);
  assert.equal(networkProblems('https://a.example.com').length, 1, 'not a list');
  for (const bad of ['http://a.example.com', 'https://*.example.com', 'https://a.example.com/', 'https://a.example.com/x', 'https://u:p@a.example.com', 'wss://a.example.com', '*', 'https://', 3]) {
    assert.equal(networkProblems([bad]).length, 1, String(bad));
  }
  assert.equal(isHttpsOrigin('https://A.example.com'), true, 'host names are case-blind (networkOrigins lowers them)');
  assert.equal(isHttpsOrigin('https://a.example.com:443'), false, 'the default port is not how a browser writes the origin');
});

test('networkOrigins: the valid ones, lower case, once', () => {
  assert.deepEqual(networkOrigins({ openArtifact: { network: ['https://a.example.com', 'https://a.example.com', 'http://b.example.com', 7] } } as unknown as ArtifactTypeManifest), ['https://a.example.com']);
  assert.deepEqual(networkOrigins({ openArtifact: { network: ['https://A.Example.com'] } } as unknown as ArtifactTypeManifest), ['https://a.example.com']);
  assert.deepEqual(networkOrigins({} as ArtifactTypeManifest), []);
  assert.deepEqual(networkOrigins(null), []);
});

test("installedTypeCsp: the page's own origin, data: and blob:, and the declared origins; nothing else", () => {
  const none = installedTypeCsp([]);
  assert.match(none, /^default-src 'self' data: blob:;/);
  assert.match(none, /connect-src 'self' data: blob:;/);
  assert.match(none, /form-action 'self'/);
  assert.match(none, /object-src 'none'/);
  assert.doesNotMatch(none, /https?:/);
  assert.doesNotMatch(none, /\*/);
  const some = installedTypeCsp(['https://api.example.com']);
  assert.match(some, /connect-src 'self' data: blob: https:\/\/api\.example\.com;/);
  assert.match(some, /script-src 'self' 'unsafe-inline' data: blob: https:\/\/api\.example\.com;/);
  assert.match(some, /worker-src 'self' data: blob:;/, 'workers stay on the page origin');
});

test('packageFileName: <id>-<version>.oatype, unusual version characters made _', () => {
  assert.equal(packageFileName('kit', '1.0.0'), 'kit-1.0.0.oatype');
  assert.equal(packageFileName('kit', '1.0.0-beta+2'), 'kit-1.0.0-beta+2.oatype');
  assert.equal(packageFileName('kit', '1/0 0'), 'kit-1_0_0.oatype');
});
