/**
 * What to do with a message from a page (`wake.deliver`).
 *
 * `source.from.kind` decides it: only the owner's own words may become the person's message and start a turn. A
 * collaborator's comment on a shared artifact, or a background task that finished, is an outside event — show it as
 * a notice the agent reads, never as something the person said.
 */

/** `turn` (the owner: a user message that starts a turn) or `notice` (anyone or anything else). */
export function routeOf(params) {
  return params.source?.from?.kind === 'owner' ? 'turn' : 'notice';
}

/** One line for a notification or a log: who, why and about what. */
export function describeWake(params) {
  const source = params.source ?? {};
  const from = source.from ?? { kind: 'owner' };
  const who = from.kind === 'collaborator' ? `${from.name} (${from.role})` : from.kind;
  return `${source.reason ?? 'comment'} from ${who} on "${source.title ?? params.artifactId}": ${source.summary ?? ''}`.trim();
}

/**
 * The `wake` callback for a set of sessions (`sessions` maps a session id to its agent). The text is put in the
 * transcript as it came — the daemon wrote it for the agent — and the answer tells the daemon it arrived; `failed`
 * makes the daemon keep it in the session's inbox for the next attach.
 */
export function wakeHandler(sessions, { onWake = () => undefined } = {}) {
  return (params) => {
    const agent = params.session ? sessions.get(params.session) : null;
    if (!agent) return 'failed';
    const route = routeOf(params);
    agent.add(route === 'turn' ? 'user' : 'notice', params.text);
    onWake(params, route, agent);
    return 'delivered';
  };
}
