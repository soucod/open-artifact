/**
 * A doc's files in and out: markdown, Word, the print page and PDF out; markdown, Word and PDF back in as new tabs,
 * with their pictures among the artifact's uploads.
 */

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { after, before, describe, it } from 'node:test';
import type { DocFrame } from '@open-artifact/runtime/doc-api';
import { birth, type DocPerson } from '../src/docs/calls.ts';
import { readDocBlob } from '../src/docs/blobs.ts';
import { findChrome } from '../src/docs/chrome.ts';
import { DocHost } from '../src/docs/host.ts';
import { DocStore, docDirOf } from '../src/docs/store.ts';
import { DocTransferError, exportDocFile, formatOfFile, importDocFile, importIntoFolder } from '../src/docs/transfer.ts';

const person: DocPerson = { id: 'owner', name: 'Owner' };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const MARKDOWN = `# Field notes

Some **bold** words and a [link](https://example.com/a).

## Risks

- first
- second

| Name | Count |
| --- | --- |
| apples | 3 |
`;

/** The entries of a zip, by name: enough of a reader to look inside an export. */
function unzip(bytes: Buffer): Map<string, Buffer> {
  const entries = new Map<string, Buffer>();
  let end = bytes.length - 22;
  while (end >= 0 && bytes.readUInt32LE(end) !== 0x06054b50) end--;
  assert.ok(end >= 0, 'a zip ends with its directory');
  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);
  for (let index = 0; index < count; index++) {
    assert.equal(bytes.readUInt32LE(at), 0x02014b50);
    const method = bytes.readUInt16LE(at + 10);
    const packed = bytes.readUInt32LE(at + 20);
    const nameLength = bytes.readUInt16LE(at + 28);
    const local = bytes.readUInt32LE(at + 42);
    const name = bytes.toString('utf8', at + 46, at + 46 + nameLength);
    at += 46 + nameLength + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
    const start = local + 30 + bytes.readUInt16LE(local + 26) + bytes.readUInt16LE(local + 28);
    const data = bytes.subarray(start, start + packed);
    entries.set(name, method === 0 ? Buffer.from(data) : inflateRawSync(data));
  }
  return entries;
}

function makeDoc(markdown: string): { root: string; store: DocStore } {
  const root = mkdtempSync(join(tmpdir(), 'open-artifact-docs-transfer-'));
  const made = birth(docDirOf(root), { name: 'Field notes', doc: { markdown } }, person);
  assert.equal(made.status, 200, JSON.stringify(made.body));
  return { root, store: DocStore.open(docDirOf(root)) };
}

function hostOf(root: string, frames: DocFrame[]): DocHost {
  return new DocHost({ root, owner: person, emit: (frame) => frames.push(frame), log: () => {} });
}

describe('doc export', () => {
  let root: string;
  let store: DocStore;
  before(() => ({ root, store } = makeDoc(MARKDOWN)));
  after(() => rmSync(root, { recursive: true, force: true }));

  it('writes markdown that reads back the same', async () => {
    const file = await exportDocFile(store, person, new URLSearchParams());
    assert.equal(file.name, 'Field notes.md');
    assert.match(file.mime, /^text\/markdown/);
    const text = file.bytes.toString('utf8');
    for (const part of ['# Field notes', '**bold**', '[link](https://example.com/a)', '## Risks', '- first', '| apples | 3 |']) assert.ok(text.includes(part), part);
    const again = makeDoc(text);
    try {
      const second = await exportDocFile(again.store, person, { format: 'markdown' });
      assert.equal(second.bytes.toString('utf8'), text);
    } finally {
      rmSync(again.root, { recursive: true, force: true });
    }
  });

  it('writes a Word file: a zip with its document part', async () => {
    const file = await exportDocFile(store, person, new URLSearchParams({ format: 'docx', paper: 'a4' }));
    assert.equal(file.name, 'Field notes.docx');
    assert.equal(file.mime, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert.equal(file.bytes.subarray(0, 4).toString('latin1'), 'PK\x03\x04');
    const zip = unzip(file.bytes);
    for (const part of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/numbering.xml']) assert.ok(zip.has(part), part);
    const document = zip.get('word/document.xml')!.toString('utf8');
    assert.match(document, /<w:pStyle w:val="Heading1"\/>/);
    assert.ok(document.includes('Field notes'));
    assert.ok(document.includes('<w:pgSz w:w="11906" w:h="16838"/>'), 'A4');
    assert.ok(zip.get('docProps/app.xml')!.toString('utf8').includes('<Application>Open Artifact Docs</Application>'));
  });

  it('writes the print page', async () => {
    const file = await exportDocFile(store, person, new URLSearchParams({ format: 'html' }));
    assert.equal(file.name, 'Field notes.html');
    const html = file.bytes.toString('utf8');
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /<h1[^>]*>Field notes<\/h1>/);
    assert.ok(html.includes('<a href="https://example.com/a">link</a>'));
    assert.ok(html.includes("default-src 'none'"));
  });

  it('refuses a format, a paper or a tab it does not have', async () => {
    await assert.rejects(exportDocFile(store, person, new URLSearchParams({ format: 'rtf' })), (error: unknown) => error instanceof DocTransferError && error.status === 400 && error.code === 'bad_format');
    await assert.rejects(exportDocFile(store, person, new URLSearchParams({ paper: 'a3' })), (error: unknown) => error instanceof DocTransferError && error.code === 'bad_paper');
    await assert.rejects(exportDocFile(store, person, new URLSearchParams({ tab: 'nope' })), (error: unknown) => error instanceof DocTransferError && error.status === 404 && error.code === 'no_node');
    assert.equal(formatOfFile('x.markdown'), 'markdown');
    assert.equal(formatOfFile('x.pdf'), 'pdf');
  });
});

describe('doc import', () => {
  let root: string;
  let host: DocHost;
  const frames: DocFrame[] = [];
  before(() => {
    root = makeDoc(MARKDOWN).root;
    host = hostOf(root, frames);
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  it('adds a markdown file as a tab, announced to the pages', async () => {
    frames.length = 0;
    const bytes = Buffer.from(`# Plan\n\nA paragraph.\n\n![dot](data:image/png;base64,${PNG.toString('base64')})\n`);
    const answer = await importDocFile(host, new URLSearchParams({ name: 'plan.md' }), bytes);
    assert.equal(answer.ok, true);
    assert.equal(answer.format, 'markdown');
    assert.deepEqual(answer.tabs.map((tab) => tab.name), ['plan']);
    assert.equal(answer.images, 1);
    assert.equal(host.store.tabIds().length, 2);
    assert.ok(frames.some((frame) => frame.kind === 'tab' && frame.tab === answer.tabs[0]!.id && frame.by === 'person'));
    assert.ok(frames.some((frame) => frame.kind === 'project'));
    // The picture is one of the artifact's uploads, named by its type.
    const blobs = readdirSync(join(root, '_blobs'));
    assert.equal(blobs.length, 1);
    assert.match(blobs[0]!, /^[0-9a-f]{32}\.png$/);
    const ref = `blob/${blobs[0]!.slice(0, 32)}`;
    assert.deepEqual(readDocBlob(root, ref), PNG);
    // And the Word export carries it.
    const docx = await exportDocFile(host.store, person, { format: 'docx', tab: answer.tabs[0]!.id });
    assert.equal(docx.name, 'Field notes - plan.docx');
    assert.ok(unzip(docx.bytes).has('word/media/image1.png'));
  });

  it('reads back a Word file it wrote', async () => {
    const docx = await exportDocFile(DocStore.open(docDirOf(root)), person, { format: 'docx', tab: host.store.tabIds()[0]! });
    const answer = await importDocFile(host, new URLSearchParams({ name: 'notes.docx', tabName: 'From Word' }), docx.bytes);
    assert.equal(answer.format, 'docx');
    assert.deepEqual(answer.tabs.map((tab) => tab.name), ['From Word']);
    const markdown = (await exportDocFile(host.store, person, { format: 'markdown', tab: answer.tabs[0]!.id })).bytes.toString('utf8');
    for (const part of ['# Field notes', '**bold**', '[link](https://example.com/a)', '## Risks', '- first', 'apples']) assert.ok(markdown.includes(part), `${part} in ${markdown}`);
  });

  it('refuses what it cannot read', async () => {
    const refused = (code: string, status: number) => (error: unknown) => error instanceof DocTransferError && error.code === code && error.status === status;
    await assert.rejects(importDocFile(host, new URLSearchParams({ name: 'a.md' }), Buffer.alloc(0)), refused('empty', 400));
    await assert.rejects(importDocFile(host, new URLSearchParams({ name: 'a.png' }), PNG), refused('bad_format', 415));
    await assert.rejects(importDocFile(host, new URLSearchParams(), Buffer.from('# x')), refused('bad_request', 400));
    await assert.rejects(importDocFile(host, new URLSearchParams({ name: 'a.docx' }), Buffer.from('PK\x03\x04 not a zip at all', 'latin1')), refused('not_docx', 422));
  });

  it('starts a doc from a file when the folder holds none, or adds a tab when it does', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'open-artifact-docs-folder-'));
    try {
      const file = join(folder, 'brief.txt');
      const first = await importIntoFolder({ root: folder, owner: person }, { file, bytes: Buffer.from('# Brief\n\nPlain text.\n') });
      assert.equal(first.format, 'markdown');
      assert.equal(first.created?.root, folder);
      assert.equal(first.created?.name, 'Brief');
      assert.ok(existsSync(join(docDirOf(folder), 'doc.json')));
      const second = await importIntoFolder({ root: folder, owner: person }, { file: join(folder, 'more.md'), bytes: Buffer.from('More.\n'), name: 'More' });
      assert.equal(second.created, undefined);
      assert.deepEqual(second.tabs.map((tab) => tab.name), ['More']);
      assert.equal(DocStore.open(docDirOf(folder)).tabIds().length, 2);
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it('prints a PDF and reads it back', { skip: findChrome() ? false : 'no Chrome here (set OPEN_ARTIFACT_CHROME)', timeout: 120_000 }, async () => {
    const pdf = await exportDocFile(host.store, person, { format: 'pdf', tab: host.store.tabIds()[0]!, paper: 'letter' });
    assert.equal(pdf.mime, 'application/pdf');
    assert.equal(pdf.bytes.subarray(0, 5).toString('latin1'), '%PDF-');
    assert.ok((pdf.pages ?? 0) >= 1);
    const answer = await importDocFile(host, new URLSearchParams({ name: 'printed.pdf' }), pdf.bytes);
    assert.equal(answer.format, 'pdf');
    const markdown = (await exportDocFile(host.store, person, { format: 'markdown', tab: answer.tabs[0]!.id })).bytes.toString('utf8');
    for (const part of ['Field notes', 'bold', 'Risks', 'first', 'apples']) assert.ok(markdown.includes(part), `${part} in ${markdown}`);
  });
});

describe('a long web link in every export', () => {
  const href = `https://atlas.example.org/trip?legs=${'n12e7-'.repeat(900)}#day-four`;
  let root: string;
  let store: DocStore;
  before(() => ({ root, store } = makeDoc(`# Route\n\nThe [whole route](${href}) in one link.\n`)));
  after(() => rmSync(root, { recursive: true, force: true }));

  it('is over 5,000 bytes to begin with', () => {
    assert.ok(Buffer.byteLength(href) > 5000);
  });

  it('keeps the full address in markdown, the print page and Word', async () => {
    const markdown = (await exportDocFile(store, person, { format: 'markdown' })).bytes.toString('utf8');
    assert.ok(markdown.includes(`[whole route](${href})`), 'markdown');
    const html = (await exportDocFile(store, person, { format: 'html' })).bytes.toString('utf8');
    assert.ok(html.includes(`<a href="${href}">whole route</a>`), 'print page');
    const zip = unzip((await exportDocFile(store, person, { format: 'docx' })).bytes);
    const rels = zip.get('word/_rels/document.xml.rels')!.toString('utf8');
    assert.ok(rels.includes(`Target="${href}"`), 'Word');
  });

  it('keeps the full address in a PDF', { skip: findChrome() ? false : 'no Chrome here (set OPEN_ARTIFACT_CHROME)', timeout: 120_000 }, async () => {
    const pdf = (await exportDocFile(store, person, { format: 'pdf' })).bytes.toString('latin1');
    assert.ok(pdf.includes(href), 'the link annotation holds the whole address');
  });
});
