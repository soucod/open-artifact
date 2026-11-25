/**
 * `GET /api/open-artifact.events`: the Library's event stream (`LibraryEvent`s as server-sent events) for the
 * artifacts this request's principals may see, fed by `HostEvents`.
 *
 * The principals are the signed-in person (or agent), plus each link guest whose cookie the request carries (the
 * Shell of a guest listens too), plus anonymous (public artifacts). An event about an artifact goes out when one of
 * them may open it now; an artifact the stream knew that nobody of them may open any more goes out as `removed`.
 */

import { artifactIdOfLabel, type LibraryEvent } from '@open-artifact/protocol';
import { principalRef, type PrincipalRef } from '../authz/access.ts';
import { authenticate } from '../auth/session.ts';
import { httpError, parseCookies, type Ctx, type Router } from '../http.ts';
import type { UserPrincipal } from '../types.ts';
import type { AppServices } from './services.ts';
import { personOf } from './views.ts';

/** How often a comment keeps the connection open through proxies, ms. */
export const HEARTBEAT_MS = 25_000;

const GUEST_COOKIE = /^(?:__Host-)?oa_guest_(art-[a-z0-9-]+)$/i;

/**
 * What the event stream needs of its context: the events and the access cache besides the base. Narrower than
 * `AppCtx`, so a platform can serve the stream where the rest of the app services are not (Cloudflare: its site hub).
 */
export type EventStreamCtx = Ctx<Pick<AppServices, 'events' | 'access'>>;

/** The principals of a request (see the module comment), and the person among them. */
async function principalsOf(request: Request, ctx: EventStreamCtx): Promise<{ refs: PrincipalRef[]; person: UserPrincipal | null }> {
  const auth = await authenticate(request, ctx);
  if (auth.invalid.includes('bearer')) throw httpError('unauthorized', 'The access token is expired, revoked or unknown.', { status: 401 });
  const refs: PrincipalRef[] = [principalRef(auth.principal)];
  if (auth.principal.kind === 'anonymous' || auth.principal.kind === 'user') {
    for (const name of Object.keys(parseCookies(request.headers.get('cookie')))) {
      const label = GUEST_COOKIE.exec(name)?.[1];
      const id = label ? artifactIdOfLabel(label) : null;
      if (!id) continue;
      const guest = await authenticate(request, ctx, { artifactId: id });
      if (guest.principal.kind === 'guest') refs.push(principalRef(guest.principal));
    }
  }
  if (!refs.some((r) => r.kind === 'anonymous')) refs.push({ kind: 'anonymous', id: 'anonymous' });
  return { refs, person: personOf(auth.principal) };
}

/** Registers `GET /api/open-artifact.events`. */
export function eventRoutes<C extends EventStreamCtx>(router: Router<C>): void {
  router.get('/api/open-artifact.events', async (request, ctx) => {
    const { refs, person } = await principalsOf(request, ctx);
    // What the stream starts out knowing: the person's library, and the guests' artifacts.
    const known = new Set<string>();
    if (person) {
      const query = { id: person.id, email: person.email ?? null, emailVerified: person.emailVerified === true, ...(person.groups ? { groups: person.groups } : {}) };
      for (const row of await ctx.catalog.listArtifactsFor(query)) known.add(row.id);
    }
    for (const ref of refs) {
      if (ref.kind !== 'guest') continue;
      const guest = await ctx.catalog.getGuest(ref.id);
      if (guest) known.add(guest.artifactId);
    }

    const encoder = new TextEncoder();
    const unsubscribe: Array<() => void> = [];
    let timer: ReturnType<typeof setInterval> | null = null;
    let closed = false;
    let queue = Promise.resolve();

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const close = (): void => {
          if (closed) return;
          closed = true;
          for (const off of unsubscribe) off();
          if (timer) clearInterval(timer);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        };
        const send = (text: string): void => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            close();
          }
        };
        /** Sends the event when one of the principals may see the artifact; `removed` when the stream loses it. */
        const offer = (id: string, event: LibraryEvent): void => {
          queue = queue
            .then(async () => {
              if (closed) return;
              let visible = false;
              for (const ref of refs) {
                const access = await ctx.access.role(id, ref);
                if (access && access.artifact.trashedAt === null) {
                  visible = true;
                  break;
                }
              }
              if (visible) {
                known.add(id);
                send(`data: ${JSON.stringify(event)}\n\n`);
              } else if (known.delete(id)) {
                send(`data: ${JSON.stringify({ type: 'artifacts/changed', id, removed: true } satisfies LibraryEvent)}\n\n`);
              }
            })
            .catch((error: unknown) => ctx.log(`events: ${error instanceof Error ? error.message : String(error)}`));
        };
        unsubscribe.push(
          ctx.events.on('artifact-touched', ({ id, author, paths }) => offer(id, { type: 'artifacts/changed', id, author, paths })),
          ctx.events.on('artifact-changed', ({ id }) => offer(id, { type: 'artifacts/changed', id })),
          ctx.events.on('access-changed', ({ id }) => offer(id, { type: 'artifacts/changed', id })),
          // The owner's computer came or went: their artifacts this stream knows change (their `agent`, the Ask pane's
          // words). Said only of artifacts the stream may see, so nobody else learns when someone is online.
          ctx.events.on('agent-changed', ({ userId }) => {
            if (!known.size) return;
            ctx.catalog
              .getArtifacts([...known])
              .then((rows) => {
                for (const [id, row] of rows) if (row.ownerUser === userId) offer(id, { type: 'artifacts/changed', id });
              })
              .catch((error: unknown) => ctx.log(`events: ${error instanceof Error ? error.message : String(error)}`));
          }),
        );
        timer = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS);
        request.signal.addEventListener('abort', close, { once: true });
        if (request.signal.aborted) close();
        send(': hello\n\n');
      },
      cancel() {
        closed = true;
        for (const off of unsubscribe) off();
        if (timer) clearInterval(timer);
      },
    });
    return new Response(stream, {
      headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' },
    });
  });
}
