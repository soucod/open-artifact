// Files a browser downloaded into a folder (launch().downloadsTo), waited for and recognised by their first bytes.
import fs from 'node:fs';
import path from 'node:path';

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** When a file was last written: Chrome replaces a file of the same name in place, so a name alone is not a new download. */
const stampOf = file => {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
};

/** The finished files in `dir` now (no `.crdownload` partials), each with when it was last written: a Map name → stamp. */
export const filesIn = dir => new Map(fs.readdirSync(dir).filter(f => !f.endsWith('.crdownload') && !f.startsWith('.')).map(f => [f, stampOf(path.join(dir, f))]));

/** A file's size and when it was written, as one comparable string; null once it is gone. */
const stateOf = file => {
  try {
    const { size, mtimeMs } = fs.statSync(file);
    return `${size}:${mtimeMs}`;
  } catch {
    return null;
  }
};

/** How long a new file must stay as it is before it counts as finished (Chrome passes a download through names). */
const STILL_MS = 1200;
/** How long a `.crdownload` partial may hold up a still file before it counts as one the browser dropped. */
const PARTIAL_MS = 5000;

/**
 * The next file that lands in `dir`, not one of `seen` (from filesIn) or one written again since, once it has stayed as
 * it is for a moment and no download is still under way: `{name, path, bytes}`. null after `ms`. Records the file in
 * `seen`. Chrome may show a download under a passing name first (`downloads.html`): a file that goes away is not one.
 */
export async function nextDownload(dir, seen, ms = 60000) {
  const until = Date.now() + ms;
  let watched = null;
  while (Date.now() < until) {
    const fresh = [...filesIn(dir)].filter(([f, stamp]) => seen.get(f) !== stamp).map(([f]) => f);
    if (!fresh.length) watched = null;
    else {
      const name = watched && fresh.includes(watched.name) ? watched.name : fresh[0];
      const file = path.join(dir, name);
      const state = stateOf(file);
      if (!watched || watched.name !== name || watched.state !== state) watched = { name, state, since: Date.now() };
      else {
        const still = Date.now() - watched.since;
        const partial = fs.readdirSync(dir).some(f => f.endsWith('.crdownload'));
        if (state !== null && still >= STILL_MS && (!partial || still >= PARTIAL_MS)) {
          const bytes = fs.readFileSync(file);
          seen.set(name, stampOf(file));
          return { name, path: file, bytes };
        }
      }
    }
    await sleep(200);
  }
  return null;
}

/** No new file lands in `dir` for `ms`: true, or the name of the one that did. */
export async function noDownload(dir, seen, ms = 4000) {
  const got = await nextDownload(dir, seen, ms);
  return got === null ? true : got.name;
}

/** What kind of file the bytes are, by their signature (and, for text, their start). */
export function kindOf(bytes) {
  const head = bytes.subarray(0, 16);
  const ascii = head.toString('latin1');
  if (ascii.startsWith('%PDF-')) return 'pdf';
  if (head[0] === 0x89 && ascii.slice(1, 4) === 'PNG') return 'png';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  if (ascii.startsWith('GIF8')) return 'gif';
  if (ascii.startsWith('PK\x03\x04')) return 'zip';
  if (ascii.slice(4, 8) === 'ftyp') return 'mp4';
  const text = bytes.subarray(0, 2048).toString('utf8').replace(/^﻿/, '').trimStart();
  if (/^<!doctype html|^<html/i.test(text)) return 'html';
  if (/^[[{]/.test(text)) {
    try {
      JSON.parse(bytes.toString('utf8'));
      return 'json';
    } catch {}
  }
  return 'text';
}

/** The names of the entries of a zip (its central directory), enough to tell a .pptx from a .docx from a .xlsx. */
export function zipNames(bytes) {
  const names = [];
  // End of central directory: signature PK\x05\x06, then the directory's size and offset.
  const end = bytes.lastIndexOf(Buffer.from('PK\x05\x06', 'latin1'));
  if (end < 0) return names;
  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);
  for (let i = 0; i < count && bytes.readUInt32LE(at) === 0x02014b50; i++) {
    const nameLength = bytes.readUInt16LE(at + 28);
    const extra = bytes.readUInt16LE(at + 30);
    const comment = bytes.readUInt16LE(at + 32);
    names.push(bytes.subarray(at + 46, at + 46 + nameLength).toString('utf8'));
    at += 46 + nameLength + extra + comment;
  }
  return names;
}
