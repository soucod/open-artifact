/**
 * Doctor's checks of remote types (design 18.2): types whose page lives on another computer (a URL entry off
 * loopback, `entryLocation`). For each one that is turned on:
 *  - its address answers (any HTTP status will do; redirects are not followed): `/__open-artifact/health` when it
 *    declares open, actions or share, else the entry's base, as the daemon's own reach check does;
 *  - its `GET /__open-artifact/actions` answers JSON with an `actions` list, when it declares actions;
 *  - with `--harness`, whether that host's `embed.remote` would show its page: `deny` is a warning naming where the
 *    page goes instead (the browser, when the profile says `open: "browser"`, else the link).
 *
 * Nothing about an artifact is sent: the requests carry no body, no token, no type secret and no path of this
 * computer (finding ids `remote-types`).
 */

import { api } from '@open-artifact/harness-kit';
import { TYPE_SERVER_ROUTES, entryLocation, type AdapterOpenCaps, type HarnessesResponse, type RemotePagePolicy, type ResolvedEntry } from '@open-artifact/protocol';
import type { DoctorCheck, DoctorContext, DoctorFinding } from './doctor.ts';
import { harnessProfile } from './harness-profiles.ts';
import { templateBase } from './servers.ts';
import { loadSettings } from './settings.ts';
import { TypeRegistry } from './types.ts';

type Found = Omit<DoctorFinding, 'id'>;

/** How long one probe may take, ms. */
const PROBE_MS = 5_000;

/** One GET with no credentials, no body, no redirect followed. */
async function probe(url: URL): Promise<{ status: number; json: unknown } | { error: string }> {
  try {
    const response = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(PROBE_MS), headers: { Accept: 'application/json' } });
    const text = await response.text().catch(() => '');
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text.slice(0, 1 << 20)) : null;
    } catch {
      /* not JSON */
    }
    return { status: response.status, json };
  } catch (error) {
    const cause = (error as { cause?: { code?: string } })?.cause?.code;
    return { error: (error as Error)?.name === 'TimeoutError' ? `no answer in ${PROBE_MS / 1000} s` : (cause ?? (error as Error)?.message ?? String(error)) };
  }
}

/** What the host asked about does with remote pages, and where a refused one goes. */
async function hostPolicy(context: DoctorContext): Promise<{ policy: RemotePagePolicy | null; fallback: string; from: string } | null> {
  if (!context.harness) return null;
  const profile = harnessProfile(context.harness);
  const fallback = profile.open === 'browser' ? 'this computer\'s browser' : 'the link, which the agent gives the person';
  const state = await context.daemon();
  let open: AdapterOpenCaps | boolean | undefined;
  let from = 'its profile';
  if (state) {
    const answer = await api<HarnessesResponse>(state, 'harnesses').catch(() => null);
    const adapter = (answer?.adapters ?? []).find((a) => a.harness === context.harness && a.caps?.open);
    if (adapter) {
      open = adapter.caps.open;
      from = `adapter ${adapter.id}`;
    }
  }
  open ??= profile.caps?.open;
  if (!open) return { policy: null, fallback, from };
  // A host that embeds but said nothing about remote pages gets the kit's default, ask.
  return { policy: typeof open === 'object' ? (open.remote ?? 'ask') : 'ask', fallback, from };
}

const remoteTypes: DoctorCheck = {
  id: 'remote-types',
  title: 'Remote types',
  run: async (context) => {
    const registry = new TypeRegistry(loadSettings);
    let remote: Array<{ id: string; title: string; entry: Extract<ResolvedEntry, { kind: 'url' }>; origin: string }>;
    try {
      remote = registry
        .list(process.cwd())
        .filter((t) => t.enabled)
        .flatMap((t) => {
          const location = entryLocation(t.entry);
          return location.remote && t.entry?.kind === 'url' ? [{ id: t.id, title: t.title || t.id, entry: t.entry, origin: location.origin! }] : [];
        });
    } finally {
      registry.close();
    }
    if (!remote.length) return { status: 'ok', message: 'Remote types: none turned on' };
    const host = await hostPolicy(context);
    const found: Found[] = [];
    for (const type of remote) {
      const base = templateBase(type.entry.url);
      const reach = type.entry.open || type.entry.actions || type.entry.share ? new URL(TYPE_SERVER_ROUTES.health.replace(/^\//, ''), base) : new URL(base);
      const answered = await probe(reach);
      if ('error' in answered) {
        found.push({ status: 'fail', message: `Remote type ${type.id} (${type.origin}): ${reach.href} could not be reached (${answered.error})`, fix: 'Check the network and the type\'s address (open-artifact types), or turn the type off.' });
        continue;
      }
      found.push({ status: 'ok', message: `Remote type ${type.id} (${type.origin}) answers (${reach.pathname} ${answered.status})` });
      if (type.entry.actions) {
        const actionsUrl = new URL(TYPE_SERVER_ROUTES.actions.slice(1, -1), base);
        const listed = await probe(actionsUrl);
        const actions = 'json' in listed ? (listed.json as { actions?: unknown } | null)?.actions : undefined;
        if ('error' in listed) found.push({ status: 'fail', message: `Remote type ${type.id}: ${actionsUrl.pathname} could not be reached (${listed.error})`, fix: 'The type declares actions: its server must answer GET /__open-artifact/actions.' });
        else if (listed.status !== 200 || !Array.isArray(actions)) found.push({ status: 'fail', message: `Remote type ${type.id}: ${actionsUrl.pathname} answered ${listed.status}${Array.isArray(actions) ? '' : ' without an actions list'}`, fix: 'Answer GET /__open-artifact/actions with {"actions": [...]} (or drop actions from the entry).' });
        else found.push({ status: 'ok', message: `Remote type ${type.id}: ${actionsUrl.pathname} lists ${actions.length} action${actions.length === 1 ? '' : 's'}` });
      }
      if (host) {
        if (!host.policy) found.push({ status: 'n/a', message: `Remote type ${type.id}: ${context.harness} does not show pages itself (no caps.open)`, fix: `Its pages open in ${host.fallback}.` });
        else if (host.policy === 'deny') found.push({ status: 'warn', message: `Remote type ${type.id}: ${context.harness} does not show remote pages (embed.remote deny, ${host.from}); they open in ${host.fallback}`, fix: `To show them in the app, set embed.remote to ask in ${context.harness} (the person agrees once per origin); allow is only for an app whose pane is already a general browser. Or keep deny on purpose.` });
        else found.push({ status: 'ok', message: `Remote type ${type.id}: ${context.harness} shows it (embed.remote ${host.policy}${host.policy === 'ask' ? ', after the person says yes for its origin' : ''})` });
      }
    }
    return found;
  },
};

/** The remote-type checks (appended to `DOCTOR_CHECKS`). */
export const REMOTE_CHECKS: readonly DoctorCheck[] = [remoteTypes];
