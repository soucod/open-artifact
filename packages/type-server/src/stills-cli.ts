/**
 * `stills <dir> --at <t1,t2,…> [--scale n] [--out dir] [--rough]`: PNG stills of a motion artifact, drawn as its export
 * draws them, by a headless Chrome or Chromium (`@open-artifact/motion-stage/stills`). The tools page it drives is
 * built beside this command (`motion-tools.html`); run from source, it is built on the spot.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STILLS_TOOLS_PAGE, StillsError, drawStills, parseStillScale, parseStillTimes, type StillsRequest } from '@open-artifact/motion-stage/stills';

export const STILLS_USAGE = 'stills <dir> --at <t1,t2,…> [--scale n] [--out dir] [--rough]';

/** What `stills` was asked for: the folder, then the times by `--at` (or as a second argument). */
export function stillsRequest(positional: readonly string[], flags: ReadonlyMap<string, string | true>): StillsRequest {
  const [root, given, extra] = positional;
  if (root === undefined) throw new StillsError(`Pass the artifact folder: ${STILLS_USAGE}`);
  const at = flags.get('at');
  if (at === true) throw new StillsError('--at takes the played seconds, comma-separated: --at 0.8,2.4,5');
  if (at !== undefined && given !== undefined) throw new StillsError(`Unexpected argument: ${given}`);
  if (extra !== undefined) throw new StillsError(`Unexpected argument: ${extra}`);
  const listed = at ?? given;
  if (listed === undefined) throw new StillsError(`Pass the times to draw: ${STILLS_USAGE}`);
  const times = parseStillTimes(listed);
  if (times === null) throw new StillsError('Times are played seconds, comma-separated: --at 0.8,2.4,5');
  const scaleFlag = flags.get('scale');
  const scale = parseStillScale(scaleFlag === true ? '' : scaleFlag);
  if (scale === null) throw new StillsError('--scale is above 0 and at most 4');
  const out = flags.get('out');
  if (out === true) throw new StillsError('--out takes a folder.');
  return { root: resolve(root), times, scale, mode: flags.has('rough') ? 'rough' : 'final', out: out === undefined ? null : resolve(out) };
}

/** The tools page: the copy built beside this command, else built from the checkout's source. */
async function toolsPage(): Promise<string> {
  const beside = join(dirname(fileURLToPath(import.meta.url)), STILLS_TOOLS_PAGE);
  if (existsSync(beside)) return readFile(beside, 'utf8');
  // A specifier the bundler leaves alone: the build (and esbuild with it) exists only in a checkout.
  const build = '@open-artifact/motion-stage/build';
  try {
    const { buildToolsPage } = (await import(build)) as { buildToolsPage(): Promise<string> };
    return await buildToolsPage();
  } catch {
    throw new StillsError(`${beside} is missing: build it with node scripts/build.mjs.`);
  }
}

export async function cmdStills(positional: readonly string[], flags: ReadonlyMap<string, string | true>): Promise<number> {
  try {
    const request = stillsRequest(positional, flags);
    return await drawStills(request, await toolsPage());
  } catch (error) {
    if (!(error instanceof StillsError)) throw error;
    console.error(error.message);
    return 1;
  }
}
