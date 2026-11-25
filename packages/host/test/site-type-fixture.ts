/** A synthetic page-kind type package for the site's tests (nothing here comes from a real type). */

import { rawZip, type RawEntry } from '../../server-sdk/test/zip-builder.ts';

export const UID = '7b0c3f5e-2f4d-4c55-9a51-5f1e0d6a1b01';

/** A page-kind type package (synthetic): an `index.html` declaring db and comments, a CSS file, a SKILL.md. */
export function packageOf(o: { id?: string; uid?: string; version?: string; network?: string[]; extra?: RawEntry[]; manifest?: Record<string, unknown>; html?: string | null } = {}): Uint8Array {
  const id = o.id ?? 'poll-kit';
  const version = o.version ?? '1.0.0';
  const manifest = {
    slug: id,
    uid: o.uid ?? UID,
    name: 'Poll kit',
    version,
    description: 'Polls people answer on a page.',
    titleFrom: 'poll.json#/title',
    ...(o.network ? { openArtifact: { network: o.network } } : {}),
    ...o.manifest,
  };
  const html =
    o.html === undefined
      ? `<!doctype html><title>Poll ${version}</title><script>\n// artifact.json\nvar key = "poll";\nvar capabilities = { db: {}, comments: {} };\nvar monitoring = {};\n// end of artifact.json\n</script><link rel="stylesheet" href="artifact-type/poll.css"><p>v${version}</p>`
      : o.html;
  const top = `${id}-${version}`;
  return new Uint8Array(
    rawZip([
      { name: `${top}/artifact-type.json`, data: JSON.stringify(manifest) },
      ...(html === null ? [] : [{ name: `${top}/index.html`, data: html }]),
      { name: `${top}/artifact-type/poll.css`, data: `/* ${version} */` },
      { name: `${top}/SKILL.md`, data: '# Poll kit\nWrite poll.json.' },
      ...(o.extra ?? []),
    ]),
  );
}

