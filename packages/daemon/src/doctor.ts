/**
 * `open-artifact doctor [--harness <name>] [--session <id>] [--json]` (design 12): checks this computer's Open Artifact
 * setup and says, for each check, `ok`, `warn`, `fail` or `n/a` (the host did not declare that capability, or the step
 * needs a person or a real browser) with one line of what to do. Exits non-zero when any check fails. With
 * `--session`, the host's conformance steps run too (`doctor-conformance.ts`, which documents the `--json` shape).
 *
 * The runner knows nothing about what is checked: the checks are a list (`doctor-checks.ts`, `DOCTOR_CHECKS`). Another
 * stage adds its own by writing a module of {@link DoctorCheck}s and appending them there (one import, one spread),
 * or, at run time, by passing `checks` to {@link runDoctor}.
 */

import { readDaemon } from '@open-artifact/harness-kit';
import type { DaemonState } from '@open-artifact/protocol';
import { openArtifactHome } from './paths.ts';

export type DoctorStatus = 'ok' | 'warn' | 'fail' | 'n/a';

/** One finding. */
export interface DoctorFinding {
  /** The check's id (a check may report several findings under it). */
  id: string;
  status: DoctorStatus;
  /** What was found, one line. */
  message: string;
  /** What to do, one line (for `warn` and `fail`). */
  fix?: string;
}

/** What a check gets: the home, the harness asked about, and the daemon (read once, shared). */
export interface DoctorContext {
  home: string;
  /** `--harness`, when given. */
  harness: string | null;
  /** `--session`, when given: the host's session the conformance steps act as. */
  session: string | null;
  env: NodeJS.ProcessEnv;
  /** The running daemon, or `null` (read once). */
  daemon: () => Promise<DaemonState | null>;
}

/** One check: an id, a title, and what it found. `applies` false skips it (e.g. a harness check without `--harness`). */
export interface DoctorCheck {
  id: string;
  title: string;
  applies?: (context: DoctorContext) => boolean;
  run: (context: DoctorContext) => Promise<Omit<DoctorFinding, 'id'> | Array<Omit<DoctorFinding, 'id'>>> | Omit<DoctorFinding, 'id'> | Array<Omit<DoctorFinding, 'id'>>;
}

/** The report: every finding, and whether any failed. */
export interface DoctorReport {
  ok: boolean;
  home: string;
  harness: string | null;
  session: string | null;
  findings: DoctorFinding[];
  counts: Record<DoctorStatus, number>;
}

/** Runs `checks` in order; a check that throws is a `fail` of its own. */
export async function runDoctor(options: { checks: readonly DoctorCheck[]; harness?: string | null; session?: string | null; env?: NodeJS.ProcessEnv }): Promise<DoctorReport> {
  const env = options.env ?? process.env;
  let daemon: Promise<DaemonState | null> | null = null;
  const context: DoctorContext = {
    home: openArtifactHome(),
    harness: options.harness ?? null,
    session: options.session ?? null,
    env,
    daemon: () => (daemon ??= readDaemon().catch(() => null)),
  };
  const findings: DoctorFinding[] = [];
  for (const check of options.checks) {
    if (check.applies && !check.applies(context)) continue;
    try {
      const found = await check.run(context);
      for (const finding of Array.isArray(found) ? found : [found]) findings.push({ id: check.id, ...finding });
    } catch (error) {
      findings.push({ id: check.id, status: 'fail', message: `${check.title}: the check itself failed: ${(error as Error)?.message ?? error}`, fix: 'Report this with the output of open-artifact doctor --json.' });
    }
  }
  const counts: Record<DoctorStatus, number> = { ok: 0, warn: 0, fail: 0, 'n/a': 0 };
  for (const finding of findings) counts[finding.status] += 1;
  return { ok: counts.fail === 0, home: context.home, harness: context.harness, session: context.session, findings, counts };
}

/** The report for a person. */
export function doctorText(report: DoctorReport): string {
  const mark: Record<DoctorStatus, string> = { ok: 'ok  ', warn: 'warn', fail: 'FAIL', 'n/a': 'n/a ' };
  const lines = report.findings.map((f) => `${mark[f.status]}  ${f.message}${f.fix && f.status !== 'ok' ? `\n      → ${f.fix}` : ''}`);
  lines.push('', `${report.counts.ok} ok, ${report.counts.warn} warning${report.counts.warn === 1 ? '' : 's'}, ${report.counts.fail} failed${report.counts['n/a'] ? `, ${report.counts['n/a']} n/a` : ''} (home ${report.home})`);
  return lines.join('\n');
}
