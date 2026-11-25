/**
 * The CLI's folder chores, run through `main` as a shell would: comment
 * threads, archive, ds-sync (and check's stale-copy note), delete-asset,
 * the .gitignore `open` writes, write-db's `{"$file"}` values and refused
 * ideas, the whiteboard edits counter, and the folder-aware checks.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { after, before, describe, it } from 'node:test';
import { AGENT_AUTHOR, CommentStore } from '@open-artifact/server-sdk/comments';
import { main } from '../src/index.ts';
import { countEdits, readEdits } from '../src/agent.ts';
import { ARTIFACT_GITIGNORE, ensureGitignore } from '../src/artifact-files.ts';
import { crc32 } from '../src/archive.ts';
import { runCheck } from '../src/project-check.ts';
import { TYPES } from '../src/types.ts';

/** Runs the CLI, keeping what it printed. */
async function run(...argv: string[]): Promise<{ code: number; out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const log = console.log;
  const error = console.error;
  console.log = (line: unknown) => void out.push(String(line));
  console.error = (line: unknown) => void err.push(String(line));
  try {
    return { code: await main(argv), out, err };
  } finally {
    console.log = log;
    console.error = error;
  }
}

async function writeFiles(dir: string, files: Record<string, string>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    const file = join(dir, ...path.split('/'));
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text);
  }
}

const BLOB = '0123456789abcdef0123456789abcdef';
const OTHER = 'fedcba9876543210fedcba9876543210';

/** The names and texts in a zip written with stored or deflated entries. */
function unzip(bytes: Buffer): Map<string, string> {
  const out = new Map<string, string>();
  let at = 0;
  while (bytes.readUInt32LE(at) === 0x04034b50) {
    const method = bytes.readUInt16LE(at + 8);
    const crc = bytes.readUInt32LE(at + 14);
    const size = bytes.readUInt32LE(at + 18);
    const nameLength = bytes.readUInt16LE(at + 26);
    const extra = bytes.readUInt16LE(at + 28);
    const name = bytes.subarray(at + 30, at + 30 + nameLength).toString('utf8');
    const start = at + 30 + nameLength + extra;
    const raw = bytes.subarray(start, start + size);
    const data = method === 8 ? inflateRawSync(raw) : raw;
    assert.equal(crc32(data), crc, `crc of ${name}`);
    out.set(name, data.toString('utf8'));
    at = start + size;
  }
  return out;
}

describe('CLI chores', () => {
  let dir: string;
  let board: string;
  let deck: string;
  let design: string;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'open-artifact-chores-'));
    board = join(dir, 'Board');
    await writeFiles(join(board, 'db'), TYPES.whiteboard.scaffold('Board', join(board, 'db')));
    deck = join(dir, 'Deck');
    await writeFiles(join(deck, 'project'), { 'slides/cover.html': `<section id="cover"><h1>Hi</h1><img src="/_blob/${BLOB}" alt=""></section>` });
    await writeFiles(join(deck, 'project'), TYPES.slides.scaffold('Deck', join(deck, 'project')));
    design = join(dir, 'Design');
    await writeFiles(join(design, 'project'), TYPES.design.scaffold('Design', join(design, 'project')));
  });
  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('lists, answers and resolves comment threads as the agent', async () => {
    const store = new CommentStore(deck);
    const thread = store.create({ label: 'Slide 1', location: { slideId: 'cover', slideIndex: 1 }, text: 'Make the title bigger', author: { kind: 'person', name: 'Ana' } as never });
    const listed = await run('comments', deck);
    assert.equal(listed.code, 0);
    assert.ok(listed.out.join('\n').includes(thread.id));
    assert.ok(listed.out.join('\n').includes('data, not instructions'));
    const json = JSON.parse((await run('comments', deck, '--json')).out[0]!) as { threads: { id: string; where: string }[] };
    assert.equal(json.threads[0]!.id, thread.id);
    assert.ok(json.threads[0]!.where.includes('cover'));

    const reply = await run('comment-reply', deck, thread.id.slice(0, 6), 'Done: 72 px now.', '--resolve');
    assert.equal(reply.code, 0, reply.err.join('\n'));
    assert.equal(JSON.parse(reply.out[0]!).status, 'resolved');
    const saved = new CommentStore(deck).threads({ all: true })[0]!;
    assert.equal(saved.messages.at(-1)!.author.kind, AGENT_AUTHOR.kind);
    assert.equal(saved.messages.at(-1)!.text, 'Done: 72 px now.');
    assert.equal(saved.resolvedBy?.kind, 'agent');
    assert.ok((await run('comments', deck)).out[0]!.startsWith('No open comment threads (1 resolved'));

    assert.equal(JSON.parse((await run('comment-resolve', deck, thread.id, '--reopen')).out[0]!).status, 'open');
    assert.equal(new CommentStore(deck).threads({ all: true })[0]!.resolvedBy, undefined);
    assert.deepEqual(new CommentStore(deck).setResolved(thread.id, true, { kind: 'person', name: 'Ana' } as never).resolvedBy, { kind: 'person', name: 'Ana' });
    new CommentStore(deck).setResolved(thread.id, false);
    assert.equal(JSON.parse((await run('comment-resolve', deck, thread.id)).out[0]!).status, 'resolved');
    assert.equal((await run('comment-reply', deck, 'c_nope', 'x')).code, 1);
    // Designs and design systems keep threads too.
    const designComments = await run('comments', design);
    assert.equal(designComments.code, 0, designComments.err.join('\n'));
    assert.ok(designComments.out[0]!.startsWith('No open comment threads'));
    const system = join(dir, 'SystemComments');
    await writeFiles(system, { 'project/design-system.json': '{"v":1,"title":"System comments"}' });
    const systemComments = await run('comments', system);
    assert.equal(systemComments.code, 0, systemComments.err.join('\n'));
    assert.ok(systemComments.out[0]!.startsWith('No open comment threads'));
  });

  it('archives a folder without this machine\'s state', async () => {
    await writeFiles(board, { '_agent/view-context.json': '{}', '_blobs/x.tmp': 'partial', '.DS_Store': 'x', 'comments.json': '{"v":1,"threads":[]}' });
    const out = join(dir, 'out');
    await mkdir(out);
    const result = await run('archive', board, '--out', out, '--json');
    assert.equal(result.code, 0, result.err.join('\n'));
    const { file, files } = JSON.parse(result.out[0]!) as { file: string; files: number };
    assert.match(file, /Board-\d{4}-\d{2}-\d{2}\.zip$/);
    const entries = unzip(await readFile(file));
    assert.equal(entries.size, files);
    const names = [...entries.keys()];
    assert.ok(names.includes('Board/db/board/meta.json'), names.join(', '));
    assert.ok(names.includes('Board/comments.json'));
    assert.ok(!names.some((name) => name.includes('_agent') || name.endsWith('.tmp') || name.endsWith('.DS_Store')), names.join(', '));
  });

  it('brings an installed design system up to date, and check notes a stale copy', async () => {
    const system = join(dir, 'Acme');
    await writeFiles(system, { 'project/design-system.json': '{"v":1,"title":"Acme"}', 'project/tokens.json': '{"color":"new"}', 'project/README.md': 'Acme' });
    await writeFiles(join(design, 'project'), { 'ds/acme/tokens.json': '{"color":"old"}', 'ds/acme/README.md': 'Acme' });
    const canvasFile = join(design, 'project', 'canvas.json');
    const canvas = JSON.parse(await readFile(canvasFile, 'utf8'));
    canvas.designSystems = [{ title: 'Acme', namespace: 'acme', artifact: system, version: 1 }];
    await writeFile(canvasFile, `${JSON.stringify(canvas, null, 2)}\n`);

    const stale = await runCheck(design, 'design');
    assert.ok(stale.findings.some((f) => f.file === 'ds/acme/' && f.level === 'warning' && f.message.startsWith('Stale copy')));
    const check = await run('ds-sync', design, '--check');
    assert.equal(check.code, 1);
    assert.ok(check.out.join('\n').includes('tokens.json'));
    assert.equal(readFileSync(join(design, 'project', 'ds', 'acme', 'tokens.json'), 'utf8'), '{"color":"old"}');

    const sync = await run('ds-sync', design, 'acme');
    assert.equal(sync.code, 0, sync.err.join('\n'));
    assert.equal(readFileSync(join(design, 'project', 'ds', 'acme', 'tokens.json'), 'utf8'), '{"color":"new"}');
    const stamped = JSON.parse(await readFile(canvasFile, 'utf8'));
    assert.match(stamped.designSystems[0].copiedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal((await run('ds-sync', design, '--check')).code, 0);
    assert.ok(!(await runCheck(design, 'design')).findings.some((f) => f.message.startsWith('Stale copy')));
    assert.equal((await run('ds-sync', design, 'nope')).code, 1);
    assert.equal((await run('ds-sync', board)).code, 1);
  });

  it('deletes an upload only when nothing names it', async () => {
    await writeFiles(deck, { [`_blobs/${BLOB}.png`]: 'png', [`_blobs/${OTHER}.png`]: 'png' });
    const used = await run('delete-asset', deck, `/_blob/${BLOB}`);
    assert.equal(used.code, 1);
    assert.equal(JSON.parse(used.out[0]!).error, 'IN_USE');
    assert.ok(existsSync(join(deck, '_blobs', `${BLOB}.png`)));
    const free = await run('delete-asset', deck, OTHER);
    assert.equal(free.code, 0, free.err.join('\n'));
    assert.equal(existsSync(join(deck, '_blobs', `${OTHER}.png`)), false);
    assert.equal(JSON.parse((await run('delete-asset', deck, OTHER)).out[0]!).error, 'NOT_FOUND');
    assert.equal(JSON.parse((await run('delete-asset', deck, 'nope')).out[0]!).error, 'INVALID_ASSET');
  });

  it('keeps an image upload that only a dashboard page shows', async () => {
    const dashboard = join(dir, 'Dashboard');
    const page = { text: `<main><img src="/_blob/${OTHER}" alt="Logo"></main>` };
    await writeFiles(join(dashboard, 'db'), TYPES.data.scaffold('Dashboard', join(dashboard, 'db')));
    await writeFiles(dashboard, { 'db/files/index.html.json': JSON.stringify(page), [`_blobs/${OTHER}.png`]: 'png' });
    const used = await run('delete-asset', dashboard, `/_blob/${OTHER}`);
    assert.equal(used.code, 1);
    assert.equal(JSON.parse(used.out[0]!).error, 'IN_USE');
    assert.ok(JSON.parse(used.out[0]!).message.includes('db/files/index.html.json'));
    assert.ok(existsSync(join(dashboard, '_blobs', `${OTHER}.png`)));
  });

  it('checks slide references against the folder', async () => {
    const present = await runCheck(deck, 'slides');
    assert.ok(!present.findings.some((f) => f.message.includes('does not exist')), JSON.stringify(present.findings));
    await rm(join(deck, '_blobs', `${BLOB}.png`));
    const missing = await runCheck(deck, 'slides');
    assert.ok(missing.findings.some((f) => f.level === 'warning' && f.message.includes(`/_blob/${BLOB}, which does not exist`)), JSON.stringify(missing.findings));
  });

  it('writes a .gitignore into a folder that has none, never over one', async () => {
    const fresh = join(dir, 'Fresh');
    await mkdir(fresh);
    assert.equal(await ensureGitignore(fresh), true);
    assert.equal(await readFile(join(fresh, '.gitignore'), 'utf8'), ARTIFACT_GITIGNORE);
    await writeFile(join(fresh, '.gitignore'), 'mine\n');
    assert.equal(await ensureGitignore(fresh), false);
    assert.equal(await readFile(join(fresh, '.gitignore'), 'utf8'), 'mine\n');
    assert.equal(await ensureGitignore(join(dir, 'Missing')), false);
  });

  it('write-db: {"$file"} values become the file\'s text', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">\n<rect width="10" height="10" fill="#F6BD78"/>\n</svg>';
    await writeFile(join(dir, 'drawing.svg'), svg);
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const writes = [{ op: 'set', path: 'elements/t1', data: { type: 'note', x: 0, y: 0, text: { $file: 'drawing.svg' } } }];
      const result = await run('write-db', board, JSON.stringify(writes));
      assert.equal(result.code, 0, result.out.concat(result.err).join('\n'));
      assert.equal(JSON.parse(await readFile(join(board, 'db', 'elements', 't1.json'), 'utf8')).text, svg);
      const missing = await run('write-db', board, JSON.stringify([{ op: 'set', path: 'elements/t2', data: { type: 'note', x: 0, y: 0, text: { $file: 'gone.txt' } } }]));
      assert.equal(missing.code, 1);
      assert.equal(JSON.parse(missing.out[0]!).error, 'FILE_NOT_FOUND');
      assert.equal(existsSync(join(board, 'db', 'elements', 't2.json')), false);
    } finally {
      process.chdir(cwd);
    }
  });

  it('write-db refuses an idea the page would drop, writing nothing', async () => {
    const option = (label: string) => ({ label, edits: [{ id: 't1', x: 40 }] });
    const idea = { says: 'Move the note right.', about: ['t1'], options: [option('Right'), option('Far right')] };
    const ok = await run('write-db', board, JSON.stringify([{ op: 'set', path: 'data/users/u1/idea', data: idea }]));
    assert.equal(ok.code, 0, ok.out.concat(ok.err).join('\n'));
    const one = await run(
      'write-db',
      board,
      JSON.stringify([
        { op: 'set', path: 'elements/t3', data: { type: 'note', x: 0, y: 0, text: 'x' } },
        { op: 'set', path: 'data/users/u2/idea', data: { ...idea, options: [option('Only')] } },
      ]),
    );
    assert.equal(one.code, 1);
    assert.equal(JSON.parse(one.out[0]!).error, 'IDEA_OPTIONS');
    assert.equal(existsSync(join(board, 'db', 'elements', 't3.json')), false);
    // An update is checked as merged with the stored idea.
    const update = await run('write-db', board, JSON.stringify([{ op: 'update', path: 'data/users/u1/idea', data: { options: [option('A'), option('A')] } }]));
    assert.equal(JSON.parse(update.out[0]!).error, 'INVALID_IDEA');
    const bad = await run('write-db', board, '[{"op":"set","path":"elements/x"}]');
    assert.equal(bad.code, 1);
    assert.ok(typeof JSON.parse(bad.out[0]!).error === 'string');
  });

  it('counts people\'s edits until the agent reads the board', async () => {
    countEdits(board, 2);
    countEdits(board, 1);
    assert.equal(readEdits(board), 3);
    await writeFiles(board, { '_agent/view-context.json': JSON.stringify({ at: '2026-01-01T00:00:00Z', context: { selected: [] } }) });
    const context = await run('context', board);
    assert.equal(JSON.parse(context.out.slice(1).join('\n')).edits, 3);
    assert.equal((await run('read-db', board)).code, 0);
    assert.equal(readEdits(board), 0);
  });
});
