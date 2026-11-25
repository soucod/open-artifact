#!/usr/bin/env node
/**
 * Helps write CHANGELOG.md from the commit history, and reads a release's notes back out of it.
 *
 *   node scripts/changelog.mjs [<from>] [<to>]
 *                         print the commits in <from>..<to> (default: the latest v* tag before <to>, and HEAD) as
 *                         Markdown, subject and body, without merges or Co-Authored-By lines: the raw material for the
 *                         next CHANGELOG.md entry
 *   node scripts/changelog.mjs --check <version>
 *                         exit 1 unless CHANGELOG.md has a "## [<version>]" section with something in it, and, when
 *                         the release changes what an integrator sees (INTEGRATOR_PATHS below), an "### Integrators"
 *                         section with something in it
 *   node scripts/changelog.mjs --notes <version>
 *                         print that section's body (the GitHub release notes)
 *
 * <version> may be given with or without the leading v (v0.9.0 or 0.9.0).
 *
 * The Integrators rule. A release changes what an integrator (a host built on the Harness API or the kit) sees when
 * a file under INTEGRATOR_PATHS changed between the previous v* tag and the release: the tag v<version> when it
 * exists, else HEAD. The entry then needs "### Integrators" saying what changed for them (or that nothing they use
 * did). It holds from INTEGRATORS_SINCE on. When the history is not there to tell (a shallow clone), the rule is skipped with a warning on stderr.
 * OPEN_ARTIFACT_CHANGELOG_ROOT points the script at another repository (its tests).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * What an integrator sees: the Harness API and the messages around it (`protocol`'s harness, wake and Shell
 * messages), the kit, the shipped harness profiles, and the stdio bridge's framing. A path ending in / is a folder.
 */
export const INTEGRATOR_PATHS = [
  'packages/protocol/src/harness.ts',
  'packages/protocol/src/wake.ts',
  'packages/protocol/src/shell.ts',
  'packages/harness-kit/src/',
  'packages/daemon/harnesses/',
  'packages/daemon/src/stdio-bridge.ts',
];

/** The first release the Integrators rule holds for (the releases before it were written without it). */
export const INTEGRATORS_SINCE = '0.14.0';

/** Whether `version` is `since` or later (x.y.z, a pre-release counts as its x.y.z). */
export function atLeast(version, since = INTEGRATORS_SINCE) {
  const parts = (v) => v.replace(/^v/, '').split(/[-+]/)[0].split('.').map((n) => Number(n) || 0);
  const [a, b] = [parts(version), parts(since)];
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return true;
}

/** The files among `files` that change what an integrator sees. */
export function integratorChanges(files) {
  return files.filter((file) => INTEGRATOR_PATHS.some((path) => (path.endsWith('/') ? file.startsWith(path) : file === path)));
}

/** The body of a "## [version]" section of `text`, or null when it has none. */
export function sectionOf(text, version) {
  const v = version.replace(/^v/, '');
  const lines = text.split('\n');
  const start = lines.findIndex((line) => line.startsWith(`## [${v}]`));
  if (start < 0) return null;
  let end = lines.findIndex((line, i) => i > start && (line.startsWith('## ') || /^\[[^\]]+\]: /.test(line)));
  if (end < 0) end = lines.length;
  return lines.slice(start + 1, end).join('\n').trim();
}

/** Whether a section body has an "### Integrators" subsection with something in it. */
export function hasIntegrators(body) {
  const lines = body.split('\n');
  const start = lines.findIndex((line) => /^###\s+Integrators\s*$/.test(line));
  if (start < 0) return false;
  let end = lines.findIndex((line, i) => i > start && /^#{2,3}\s/.test(line));
  if (end < 0) end = lines.length;
  return lines.slice(start + 1, end).some((line) => line.trim());
}

function main() {
  const ROOT = process.env.OPEN_ARTIFACT_CHANGELOG_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const args = process.argv.slice(2);

  const section = (version) => sectionOf(readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8'), version);

  /** The files the release changed since the previous tag, or null when the history cannot tell. */
  const releaseFiles = (version) => {
    const tag = `v${version.replace(/^v/, '')}`;
    let to = 'HEAD';
    try {
      git('rev-parse', '--verify', '--quiet', `refs/tags/${tag}`);
      to = tag;
    } catch {
      // not tagged yet: the release is what HEAD has
    }
    let from;
    try {
      from = git('describe', '--tags', '--abbrev=0', '--match', 'v*', `${to}^`);
    } catch {
      if (git('rev-parse', '--is-shallow-repository') === 'true') return null;
      // No earlier tag: every file is new.
      return git('ls-tree', '-r', '--name-only', to).split('\n').filter(Boolean);
    }
    return git('diff', '--name-only', from, to).split('\n').filter(Boolean);
  };

  for (const flag of ['--check', '--notes']) {
    const at = args.indexOf(flag);
    if (at < 0) continue;
    const version = args[at + 1];
    if (!version) {
      console.error(`changelog: ${flag} needs a version`);
      process.exit(2);
    }
    const body = section(version);
    if (!body) {
      console.error(`changelog: CHANGELOG.md has no entry for ${version}; write one from \`node scripts/changelog.mjs\``);
      process.exit(1);
    }
    if (flag === '--check' && atLeast(version)) {
      const files = releaseFiles(version);
      if (!files) {
        console.error('changelog: warning: the history since the previous tag is not here (a shallow clone), so the Integrators rule was not checked; fetch it (actions/checkout fetch-depth: 0)');
      } else {
        const changed = integratorChanges(files);
        if (changed.length && !hasIntegrators(body)) {
          const shown = changed.slice(0, 8).join(', ') + (changed.length > 8 ? `, and ${changed.length - 8} more` : '');
          console.error(`changelog: ${version} changes what integrators see (${shown}); add an "### Integrators" section to its entry saying what changed for them`);
          process.exit(1);
        }
      }
    }
    if (flag === '--notes') console.log(body);
    process.exit(0);
  }

  const to = args[1] ?? 'HEAD';
  let from = args[0];
  if (!from) {
    try {
      from = git('describe', '--tags', '--abbrev=0', '--match', 'v*', `${to}^`);
    } catch {
      from = null; // no earlier tag: the whole history
    }
  }
  const range = from ? `${from}..${to}` : to;
  const SEP = '\u001e';
  const log = git('log', '--no-merges', '--reverse', `--format=%h%x1f%ad%x1f%s%x1f%b${SEP}`, '--date=short', range);

  console.log(`# Commits ${from ? `since ${from}` : 'from the start'} (${range})\n`);
  for (const entry of log.split(SEP)) {
    if (!entry.trim()) continue;
    const [hash, date, subject, body = ''] = entry.trim().split('\u001f');
    const text = body
      .split('\n')
      .filter((line) => !/^co-authored-by:/i.test(line.trim()))
      .join('\n')
      .trim();
    console.log(`## ${subject} (${hash}, ${date})\n`);
    if (text) console.log(`${text}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
