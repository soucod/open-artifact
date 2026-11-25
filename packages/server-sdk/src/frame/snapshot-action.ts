/**
 * frame-host's `snapshot` action: a PNG of the page as headless Chrome draws it, for the agent to look at its own
 * work. The same contract as the built-in types' action (`@open-artifact/type-server`), plus `scheme`.
 *
 * Local only: frame-host passes {@link localFrameActions}; `frameActions` (core.ts, which a hosted site serves) has no
 * `snapshot`, and nothing here is imported by the core. The camera loads the inner shell under a one-time credential
 * (`FrameSite.beginSnapshot`), a read-only viewer nobody else sees, and waits for the shell to say what it shows is
 * final (`data-open-artifact-shell`: the page revealed, or the problem card).
 */

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ServerAction } from '../serve.ts';
import { findChrome, snapshotPage } from '../snapshot.ts';
import { frameActions } from './core.ts';
import { FrameError, staysInside } from './files.ts';
import { FrameSite } from './local.ts';

/** Snapshots kept per artifact under `_agent/snapshots/`; older ones are removed (as the type server keeps). */
export const SNAPSHOTS_KEPT = 20;

const SNAPSHOT_NOTE = 'image is a PNG of the page as headless Chrome draws it now. Look at it with your own image or file tools.';

/** What the camera waits for on the inner shell: the page revealed after its load, or the problem card. */
export const SHELL_READY = "['revealed', 'problem'].includes(document.documentElement.dataset.openArtifactShell || '')";

/** frame-host's `snapshot`. */
export const snapshotAction: ServerAction = {
  title: 'A PNG of the page as it draws now, to look at your own work; returns its path as image',
  effect: 'read',
  schema: {
    type: 'object',
    properties: {
      width: { type: 'integer', description: 'Viewport width in pixels, 320 to 3840 (default 1440).' },
      height: { type: 'integer', description: 'Viewport height in pixels, 240 to 2160 (default 900).' },
      scheme: { type: 'string', enum: ['light', 'dark'], description: 'The colour scheme the page is drawn in (prefers-color-scheme), light (default) or dark.' },
    },
  },
  run: async (artifact, args) => {
    const size = (value: unknown, min: number, max: number, fallback: number): number => {
      if (value === undefined) return fallback;
      if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
        throw new FrameError('invalid_argument', 'snapshot: width is 320 to 3840 pixels, height 240 to 2160.');
      }
      return value;
    };
    const width = size(args.width, 320, 3840, 1440);
    const height = size(args.height, 240, 2160, 900);
    const scheme = args.scheme ?? 'light';
    if (scheme !== 'light' && scheme !== 'dark') throw new FrameError('invalid_argument', 'snapshot: scheme is "light" or "dark".');
    const chrome = findChrome();
    if (!chrome) {
      throw new FrameError('unsupported', 'snapshot needs Chrome, Chromium or Edge on this computer, and none was found.', 400, {
        fix: "Install Google Chrome, or set OPEN_ARTIFACT_CHROME to a Chromium-based browser's path. Until then, ask the person to look at the page.",
      });
    }
    const site = artifact.site;
    if (!(site instanceof FrameSite)) throw new FrameError('not_found', `${artifact.id} is not open here.`, 404);
    const visit = site.beginSnapshot();
    let png: Buffer;
    try {
      png = await snapshotPage(chrome, { url: visit.url, width, height, scheme, ready: SHELL_READY });
    } catch (error) {
      throw new FrameError('failed', `snapshot: ${error instanceof Error ? error.message : String(error)}`, 500);
    } finally {
      visit.end();
    }
    // `_agent/` is this computer's agent channel: never served, archived, synced or listed (see test/frame-snapshot).
    const dir = join(artifact.root, '_agent', 'snapshots');
    // A link at `_agent` or `_agent/snapshots` to a place outside the artifact's folder: the picture is not written there.
    if (!staysInside(artifact.root, join(dir, 'snapshot.png'))) throw new FrameError('failed', 'snapshot: _agent/snapshots leaves the artifact folder (a link): remove it and try again.', 500);
    mkdirSync(dir, { recursive: true });
    const image = join(dir, `snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
    writeFileSync(image, png);
    const old = readdirSync(dir).filter((name) => /^snapshot-.*\.png$/.test(name)).sort();
    for (const name of old.slice(0, Math.max(0, old.length - SNAPSHOTS_KEPT))) rmSync(join(dir, name), { force: true });
    return { image, width, height, scheme, bytes: png.length, note: SNAPSHOT_NOTE };
  },
};

/** frame-host's actions: the core's ({@link frameActions}), and `snapshot`, which needs this computer's Chrome. */
export const localFrameActions: Record<string, ServerAction> = { ...frameActions, snapshot: snapshotAction };
