/**
 * Fixtures of the runtime tests: runtime folders, tarballs written by hand (good and malicious), and a fake npm
 * registry on 127.0.0.1 (no test reaches the real network).
 */

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

/** Makes a runtime folder: package.json, the launcher and the vendored daemon. */
export function makeRuntime(dir: string, version: string, protocols: { min: number; max: number } = { min: 1, max: 1 }): string {
  mkdirSync(join(dir, 'scripts'), { recursive: true });
  mkdirSync(join(dir, 'vendor'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@open-artifact/cli', version, openArtifact: { protocols } }));
  writeFileSync(join(dir, 'scripts', 'open-artifact.mjs'), `#!/usr/bin/env node\nconsole.log('runtime ${version}');\n`);
  writeFileSync(join(dir, 'vendor', 'open-artifact.mjs'), `// daemon ${version}\n`);
  return dir;
}

/** One entry of a hand-written tarball. */
export interface FakeEntry {
  name: string;
  /** `0` file, `5` folder, `2` symlink, `1` hard link. */
  type?: '0' | '5' | '2' | '1';
  data?: string;
  link?: string;
  mode?: number;
}

function header(entry: FakeEntry, size: number): Buffer {
  const block = Buffer.alloc(512);
  const put = (text: string, at: number, length: number): void => void block.write(text.slice(0, length), at, length, 'utf8');
  const octal = (value: number, length: number): string => `${value.toString(8).padStart(length - 1, '0')}\0`;
  put(entry.name, 0, 100);
  put(octal(entry.mode ?? (entry.type === '5' ? 0o755 : 0o644), 8), 100, 8);
  put(octal(0, 8), 108, 8);
  put(octal(0, 8), 116, 8);
  put(octal(size, 12), 124, 12);
  put(octal(0, 12), 136, 12);
  block.write(entry.type ?? '0', 156, 1, 'latin1');
  if (entry.link) put(entry.link, 157, 100);
  put('ustar\0', 257, 6);
  put('00', 263, 2);
  block.fill(0x20, 148, 156);
  let sum = 0;
  for (const byte of block) sum += byte;
  put(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  return block;
}

/** A gzip of a ustar archive of `entries`. */
export function tarball(entries: FakeEntry[]): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    const data = Buffer.from(entry.type === '0' || !entry.type ? (entry.data ?? '') : '');
    parts.push(header(entry, data.length), data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}

/** The tarball npm would publish of a runtime version. */
export function runtimeTarball(version: string, extra: FakeEntry[] = []): Buffer {
  return tarball([
    { name: 'package/package.json', data: JSON.stringify({ name: '@open-artifact/cli', version, openArtifact: { protocols: { min: 1, max: 1 } } }) },
    { name: 'package/scripts/open-artifact.mjs', data: `console.log('runtime ${version}');\n`, mode: 0o755 },
    { name: 'package/vendor/open-artifact.mjs', data: `// daemon ${version}\n` },
    ...extra,
  ]);
}

export const sri = (data: Buffer): string => `sha512-${createHash('sha512').update(data).digest('base64')}`;

/** A version the fake registry lists. */
export interface RegistryVersion {
  version: string;
  tarball: Buffer;
  /** The integrity the metadata says (default the tarball's). */
  integrity?: string;
  deprecated?: string;
  protocols?: { min: number; max: number };
  attestations?: boolean;
  /** Cut the download off half way. */
  interrupt?: boolean;
}

/** A fake npm registry: `GET /@open-artifact%2fcli` and `GET /tarballs/<version>.tgz`; counts the requests. */
export interface FakeRegistry {
  url: string;
  versions: Map<string, RegistryVersion>;
  /** Requests by path, in order. */
  requests: Array<{ path: string; headers: Record<string, string | string[] | undefined> }>;
  close(): Promise<void>;
}

export async function startRegistry(versions: RegistryVersion[]): Promise<FakeRegistry> {
  const map = new Map(versions.map((v) => [v.version, v]));
  const requests: FakeRegistry['requests'] = [];
  let url = '';
  const server: Server = createServer((req, res) => {
    requests.push({ path: req.url ?? '', headers: req.headers });
    if (req.url === '/@open-artifact%2fcli') {
      const packument = {
        name: '@open-artifact/cli',
        'dist-tags': { latest: [...map.keys()].pop() },
        versions: Object.fromEntries(
          [...map.values()].map((v) => [
            v.version,
            {
              name: '@open-artifact/cli',
              version: v.version,
              ...(v.deprecated ? { deprecated: v.deprecated } : {}),
              engines: { node: '>=22.18' },
              openArtifact: { protocols: v.protocols ?? { min: 1, max: 1 } },
              dist: {
                tarball: `${url}/tarballs/${v.version}.tgz`,
                integrity: v.integrity ?? sri(v.tarball),
                ...(v.attestations ? { attestations: { url: `${url}/attestations/${v.version}`, provenance: { predicateType: 'https://slsa.dev/provenance/v1' } } } : {}),
              },
            },
          ]),
        ),
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(packument));
    }
    const match = /^\/tarballs\/(.+)\.tgz$/.exec(req.url ?? '');
    const version = match ? map.get(match[1]!) : undefined;
    if (!version) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(version.tarball.length) });
    if (version.interrupt) {
      res.write(version.tarball.subarray(0, Math.floor(version.tarball.length / 2)));
      setTimeout(() => res.destroy(), 20);
      return;
    }
    res.end(version.tarball);
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    versions: map,
    requests,
    close: () =>
      new Promise((done) => {
        server.closeAllConnections?.();
        server.close(() => done());
      }),
  };
}
