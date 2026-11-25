/**
 * A hostile page against frame-host's API: every path a page can name (files to publish, db documents, assets, the
 * files it fetches) tried with what should never get out of the artifact folder: `..`, absolute paths, the host's own
 * files, the type's files, dot folders, case variants (macOS folders are case-insensitive), a link inside the artifact
 * folder (or the type folder) to a folder outside, very long names and NUL. Nothing outside the artifact folder is
 * read or written, and the type's files stay read-only.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { request, type IncomingHttpHeaders } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { staysInside } from '../src/frame/files.ts';
import { frameActions, mountFrameSite } from '../src/frame/index.ts';
import { TypeServer } from '../src/index.ts';

const SECRET = 'hostile-secret-0123456789';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a65f0000000049454e44ae426082', 'hex');
const SECRET_TEXT = 'outside-secret';

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
  json: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

function http(port: number, o: { method?: string; path: string; host?: string; headers?: Record<string, string | number>; body?: unknown; raw?: Buffer }): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const data = o.raw ?? (o.body === undefined ? undefined : Buffer.from(JSON.stringify(o.body)));
    const req = request(
      {
        host: '127.0.0.1',
        port,
        method: o.method ?? 'GET',
        path: o.path,
        headers: { Host: o.host ?? `127.0.0.1:${port}`, ...(data && !o.raw ? { 'Content-Type': 'application/json' } : {}), ...(data ? { 'Content-Length': data.length } : {}), ...o.headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: unknown;
          try {
            json = JSON.parse(text);
          } catch {
            json = undefined;
          }
          resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json });
        });
      },
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

/** Every file under `dir` (links not followed) with the sha256 of its bytes: what "unchanged" is checked against. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string, prefix: string): void => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(d, e.name), rel);
      else if (e.isFile()) out[rel] = createHash('sha256').update(readFileSync(join(d, e.name))).digest('hex');
      else out[rel] = 'link';
    }
  };
  walk(dir, '');
  return out;
}

describe('frame-host against a hostile page', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'open-artifact-frame-hostile-'));
  const typeDir = join(tmp, 'type');
  const outside = join(tmp, 'outside');
  const root = join(tmp, 'artifact');
  const root2 = join(tmp, 'artifact-linked');
  let server: TypeServer;
  let port: number;
  const pages: Record<string, string> = {};
  let outsideBefore: Record<string, string>;
  let typeBefore: Record<string, string>;
  /** What each probe got, by name: logged at the end, for the record. */
  const seen: Record<string, string> = {};

  before(async () => {
    mkdirSync(join(typeDir, 'artifact-type'), { recursive: true });
    writeFileSync(
      join(typeDir, 'index.html'),
      '<!doctype html><html><head><script>\n// artifact.json\nvar key = "hostile";\nvar capabilities = { artifact: {}, db: {}, assets: {}, comments: {} };\n\n// the page\n</script></head><body></body></html>\n',
    );
    writeFileSync(join(typeDir, 'artifact-type', 'app.js'), 'void 0;\n');
    writeFileSync(join(typeDir, 'SKILL.md'), '---\nname: hostile\ndescription: test\n---\n');
    writeFileSync(join(typeDir, 'artifact-type.json'), JSON.stringify({ slug: 'hostile', name: 'Hostile', version: '1.0.0', description: 'test' }));
    mkdirSync(join(outside, 'db', 'notes'), { recursive: true });
    mkdirSync(join(outside, 'blobs'), { recursive: true });
    writeFileSync(join(outside, 'secret.txt'), SECRET_TEXT);
    writeFileSync(join(outside, 'db', 'notes', 'a.json'), JSON.stringify({ secret: SECRET_TEXT }));
    // A link in the type folder's artifact-type/ to a file outside it.
    symlinkSync(join(outside, 'secret.txt'), join(typeDir, 'artifact-type', 'leak.txt'));

    // The artifact: a link to a folder outside, a link to a file outside, its own files.
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'content.json'), '{}');
    writeFileSync(join(root, '.artifact.json'), JSON.stringify({ type: 'hostile', id: 'art_hostile00001' }));
    symlinkSync(outside, join(root, 'link'));
    symlinkSync(join(outside, 'secret.txt'), join(root, 'file-link.txt'));
    // Another: its db/, _blobs/ and comments.json are links outside.
    mkdirSync(root2, { recursive: true });
    symlinkSync(join(outside, 'db'), join(root2, 'db'));
    symlinkSync(join(outside, 'blobs'), join(root2, '_blobs'));
    writeFileSync(join(outside, 'comments.json'), JSON.stringify({ version: 1, threads: [{ id: 'th_outside', anchor: {}, messages: [{ text: SECRET_TEXT }] }] }));
    symlinkSync(join(outside, 'comments.json'), join(root2, 'comments.json'));

    server = new TypeServer({
      mountSite: (r, ctx) => mountFrameSite(r, { ...ctx, typeDir }),
      actions: frameActions,
      type: 'hostile',
      port: 0,
      secret: SECRET,
      idleMs: 0,
      contentHosts: true,
      log: () => undefined,
    });
    await server.listen();
    port = server.port;
    for (const [id, dir] of [
      ['art_hostile00001', root],
      ['art_hostile00002', root2],
    ] as const) {
      const r = await http(port, { method: 'POST', path: '/__open-artifact/open', headers: { Authorization: `Bearer ${SECRET}` }, body: { id, root: dir, title: 'Hostile' } });
      assert.equal(r.status, 200, r.text);
      pages[id] = new URL(r.json.url).pathname;
    }
    outsideBefore = snapshot(outside);
    typeBefore = snapshot(typeDir);
  });

  after(() => {
    console.log(`# hostile probes: ${JSON.stringify(seen)}`);
    server.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  const cap = async (id: string, capName: string, method: string, arg: unknown): Promise<any> => {
    const r = await http(port, { method: 'POST', path: `${pages[id]}api/frame/cap`, headers: { Origin: `http://127.0.0.1:${port}` }, body: { cap: capName, method, args: [arg], client: 'hostileclient1' } });
    assert.equal(r.status, 200, r.text);
    return r.json;
  };
  const publish = (path: string, text = 'pwned', id = 'art_hostile00001') => cap(id, 'artifact', 'publish', { files: { [path]: { text } } });
  const fetchFile = (path: string, id = 'art_hostile00001') => http(port, { path: `/_f/v/${path}`, host: `${id}.frame.localhost:${port}` });
  const label = (r: any): string => (r.error ? `refused ${r.error.code}` : `written ${(r.result?.changed ?? []).map((c: { path: string }) => c.path).join(',') || '(nothing)'}`);

  it('publish: no path leaves the artifact folder or reaches the host’s or the type’s files', async () => {
    const LONG_SEGMENT = 'a'.repeat(300);
    const probes: Record<string, string> = {
      dotdot: '../x.txt',
      nestedDotdot: 'a/../../x.txt',
      absolute: `${outside}/abs.txt`,
      backslash: '..\\x.txt',
      marker: '.artifact.json',
      serverState: '.artifact-server.json',
      dotFolder: '.git/config',
      index: 'index.html',
      skill: 'SKILL.md',
      typeFolder: 'artifact-type/app.js',
      comments: 'comments.json',
      db: 'db/notes/x.json',
      blobs: '_blobs/x',
      indexUpper: 'INDEX.HTML',
      skillMixed: 'Skill.md',
      typeFolderMixed: 'Artifact-Type/app.js',
      commentsMixed: 'Comments.json',
      dbUpper: 'DB/notes/x.json',
      historyMixed: 'History/x',
      lockUpper: 'x.LOCK',
      linkedFolder: 'link/x.txt',
      linkedFolderSecret: 'link/secret.txt',
      linkedFile: 'file-link.txt',
      longSegment: `${LONG_SEGMENT}.txt`,
      longPath: Array.from({ length: 6 }, () => 'b'.repeat(200)).join('/'),
      nul: 'x\0.txt',
    };
    for (const [name, path] of Object.entries(probes)) seen[`publish ${name}`] = label(await publish(path));
    // Deletes through the same paths.
    for (const name of ['linkedFolderSecret', 'linkedFile', 'skill', 'typeFolder', 'marker']) {
      seen[`delete ${name}`] = label(await cap('art_hostile00001', 'artifact', 'publish', { files: { [probes[name]!]: { delete: true } } }));
    }
    assert.deepEqual(snapshot(outside), outsideBefore, 'nothing outside the artifact folder changed');
    assert.deepEqual(snapshot(typeDir), typeBefore, "the type's files are unchanged");
    assert.equal(readFileSync(join(outside, 'secret.txt'), 'utf8'), SECRET_TEXT);
    // The absolute path lands inside the artifact folder (the leading slash is dropped), never at that path.
    assert.equal(existsSync(join(outside, 'abs.txt')), false);
    for (const name of ['dotdot', 'nestedDotdot', 'backslash', 'marker', 'serverState', 'dotFolder', 'index', 'skill', 'typeFolder', 'comments', 'db', 'blobs', 'nul', 'linkedFolder', 'linkedFolderSecret']) {
      assert.match(seen[`publish ${name}`]!, /^refused/, `publish ${name}: ${seen[`publish ${name}`]}`);
    }
    // Case variants of the host's and the type's names are refused too (on a case-insensitive folder they are the same files).
    for (const name of ['indexUpper', 'skillMixed', 'typeFolderMixed', 'commentsMixed', 'dbUpper', 'historyMixed', 'lockUpper']) {
      assert.match(seen[`publish ${name}`]!, /^refused/, `publish ${name}: ${seen[`publish ${name}`]}`);
    }
    // A name the file system cannot hold is refused, not an error of the server.
    for (const name of ['longSegment', 'longPath']) assert.match(seen[`publish ${name}`]!, /^refused/, `publish ${name}: ${seen[`publish ${name}`]}`);
    // A link to a file outside, written over, is the artifact's own file afterwards: the link is replaced, its target untouched.
    assert.ok(statSync(join(root, '.artifact.json')).isFile());
  });

  it('the files a page fetches: none outside the artifact folder, and the type’s only under artifact-type/', async () => {
    const probes: Record<string, string> = {
      dotdot: '../outside/secret.txt',
      encodedDotdot: '%2e%2e/%2e%2e/outside/secret.txt',
      encodedSlash: '..%2f..%2foutside%2fsecret.txt',
      typeDotdot: 'artifact-type/../SKILL.md',
      typeEncoded: 'artifact-type/%2e%2e/SKILL.md',
      typeLink: 'artifact-type/leak.txt',
      marker: '.artifact.json',
      linkedFolder: 'link/secret.txt',
      linkedFile: 'file-link.txt',
      skill: 'SKILL.md',
      nul: 'x%00.txt',
    };
    for (const [name, path] of Object.entries(probes)) {
      const r = await fetchFile(path);
      seen[`fetch ${name}`] = `${r.status}${r.text.includes(SECRET_TEXT) ? ' LEAKED' : ''}`;
      assert.notEqual(r.status, 200, `fetch ${name}: ${r.status}`);
      assert.equal(r.text.includes(SECRET_TEXT), false, `fetch ${name} leaked`);
    }
    assert.equal((await fetchFile('artifact-type/app.js')).status, 200, "the type's own file is served");
    assert.equal((await fetchFile('content.json')).status, 200, "the artifact's own file is served");
  });

  it('db, assets and comments: a db/, _blobs/ or comments.json that is a link outside is neither read nor written', async () => {
    const id = 'art_hostile00002';
    const reads = await cap(id, 'db', 'get', { path: 'notes/a' });
    seen['db get through a linked db/'] = reads.error ? `refused ${reads.error.code}` : JSON.stringify(reads.result).includes(SECRET_TEXT) ? 'LEAKED' : 'nothing';
    assert.equal(JSON.stringify(reads).includes(SECRET_TEXT), false, 'db get leaked');
    const listed = await cap(id, 'db', 'query', { path: 'notes' });
    seen['db query through a linked db/'] = listed.error ? `refused ${listed.error.code}` : JSON.stringify(listed.result).includes(SECRET_TEXT) ? 'LEAKED' : 'nothing';
    assert.equal(JSON.stringify(listed).includes(SECRET_TEXT), false, 'db query leaked');
    const set = await cap(id, 'db', 'set', { path: 'notes/b', data: { n: 1 } });
    seen['db set through a linked db/'] = set.error ? `refused ${set.error.code}` : 'written';
    const del = await cap(id, 'db', 'delete', { path: 'notes/a' });
    seen['db delete through a linked db/'] = del.error ? `refused ${del.error.code}` : JSON.stringify(del.result);
    for (const path of ['../x', 'notes/..', 'notes/a/../../x', 'a\0/b']) {
      const r = await cap('art_hostile00001', 'db', 'set', { path, data: { n: 1 } });
      seen[`db set ${JSON.stringify(path)}`] = r.error ? `refused ${r.error.code}` : 'written';
      assert.ok(r.error, `db set ${path}`);
    }
    const up = await http(port, { method: 'POST', path: `${pages[id]}api/frame/upload?type=image/png&gen=1`, headers: { Origin: `http://127.0.0.1:${port}`, 'Content-Type': 'application/octet-stream' }, raw: PNG });
    seen['assets upload through a linked _blobs/'] = up.json?.error ? `refused ${up.json.error.code}` : up.json?.result ? 'written' : `${up.status}`;
    const comments = await cap(id, 'comments', 'list', {});
    seen['comments list through a linked comments.json'] = JSON.stringify(comments).includes(SECRET_TEXT) ? 'LEAKED' : comments.error ? `refused ${comments.error.code}` : 'nothing';
    assert.equal(JSON.stringify(comments).includes(SECRET_TEXT), false, 'comments leaked');
    assert.deepEqual(snapshot(outside), outsideBefore, 'nothing outside the artifact folder changed');
  });
});

describe('staysInside', () => {
  it('lets a first write make a folder that is not there yet, and refuses a dangling link in its place', () => {
    const base = mkdtempSync(join(tmpdir(), 'oa-stays-'));
    try {
      assert.equal(staysInside(join(base, 'new'), join(base, 'new', 'db', 'dash', 'meta.json')), true);
      assert.equal(staysInside(join(base, 'new'), join(base, 'other', 'x.json')), false);
      symlinkSync(join(base, 'nowhere'), join(base, 'dangling'));
      assert.equal(staysInside(join(base, 'dangling'), join(base, 'dangling', 'x.json')), false);
      mkdirSync(join(base, 'real'));
      symlinkSync(join(base, 'outside-dir'), join(base, 'real', 'db'));
      mkdirSync(join(base, 'outside-dir'));
      assert.equal(staysInside(join(base, 'real'), join(base, 'real', 'db', 'x.json')), false);
      assert.equal(staysInside(join(base, 'real'), join(base, 'real', 'notes', 'x.json')), true);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
