// Small HTTP helpers for the local type server.
//
import { createHash } from 'node:crypto';
import http from 'node:http';
import { deflateSync } from 'node:zlib';

/** The files a page names in its <script src> and <link href> (stylesheets, preloads, icons), as absolute URLs. */
export function assetsOf(html, base) {
  const urls = new Set();
  for (const m of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) urls.add(m[1]);
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = /\brel=["']([^"']+)["']/i.exec(m[0])?.[1] ?? '';
    const href = /\bhref=["']([^"']+)["']/i.exec(m[0])?.[1];
    if (href && /stylesheet|preload|modulepreload|icon/i.test(rel)) urls.add(href);
  }
  return [...urls].filter(u => !u.startsWith('data:')).map(u => new URL(u, base).href);
}

/** POST JSON with the page's own Origin (the server refuses writes from other origins). */
export function postJson(url, body, { origin = new URL(url).origin, headers = {} } = {}) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, ...headers },
    body: JSON.stringify(body),
  });
}

/** `res`'s JSON body once its status is `status` (else fails, with the body). */
export async function expectStatus(res, status) {
  const text = await res.text();
  if (res.status !== status) throw new Error(`${res.url}: HTTP ${res.status}, expected ${status}: ${text.slice(0, 500)}`);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** A GET with a Host header of our choosing (fetch will not send one): resolves {status, body, headers}. */
export function getWithHost(url, host) {
  return requestWithHost(url, host);
}

/** A request with a Host header of our choosing: resolves {status, body, headers}. */
export function requestWithHost(url, host, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers: { ...headers, host } }, res => {
      let text = '';
      res.on('data', d => (text += d));
      res.on('end', () => resolve({ status: res.statusCode, body: text, headers: res.headers }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

export async function until(fn, ms = 5000, step = 100) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise(r => setTimeout(r, step));
  }
  return Boolean(await fn());
}

/**
 * A 2×2 PNG, made here so the fixtures hold no binary files. `rgb` colours its first pixel: uploads are stored by their
 * bytes, so a case that needs an upload of its own gives a colour of its own.
 */
export function png(rgb = [194, 86, 43]) {
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  const crc = buf => {
    let c = 0xffffffff;
    for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0);
  ihdr.writeUInt32BE(2, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const rows = Buffer.from([0, ...rgb, 251, 247, 241, 0, 251, 247, 241, 194, 86, 43]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
