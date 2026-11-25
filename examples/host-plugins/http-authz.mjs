/**
 * http-authz: ask your permission service who may open an artifact.
 *
 * For each signed-in person (and each agent, as the person it acts for) the plugin POSTs
 * `{user: {id, email, groups}, artifact: {id, type, title, owner}, role}` to `url`, signed with `secret`
 * (`x-oa-signature: sha256=<hex HMAC of the body>`). The service answers `{"role": "editor"}` (or `owner`, `commenter`,
 * `viewer`), `{"role": null}` for no access, or `{}` to leave the host's own answer. The host reuses an answer for 60
 * seconds. When the service cannot be reached the person gets no access (fail closed).
 *
 * When permissions change, the service calls `POST /plugins/http-authz/invalidate` with `{"artifactId": "…"}` (or
 * `{}` for all), signed the same way, and the next request asks again.
 */
import { HttpError, json, readText, signHmacSha256, verifyHmacSha256 } from '@open-artifact/host-plugin';

export default {
  id: 'http-authz',
  apiVersion: 1,
  name: 'Permission service',
  version: '1.0.0',
  config: {
    url: { type: 'string', required: true, description: 'Where to POST permission questions.' },
    secret: { type: 'secret', required: true, description: 'Signs questions and checks invalidation calls.' },
  },
  authz: {
    cacheSeconds: 60,
    async role({ principal, artifact, role }, ctx) {
      const user = principal.kind === 'user' ? principal : principal.kind === 'agent' ? principal.user : null;
      if (!user) return undefined;
      const body = JSON.stringify({
        user: { id: user.id, email: user.emailVerified ? user.email ?? null : null, groups: user.groups ?? [] },
        artifact: { id: artifact.id, type: artifact.type, title: artifact.title, owner: artifact.owner },
        role,
      });
      const signature = await signHmacSha256({ secret: ctx.config.secret, body });
      const response = await ctx.fetch(ctx.config.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-oa-signature': `sha256=${signature}` },
        body,
      });
      if (!response.ok) throw new Error(`the permission service answered ${response.status}`);
      const answer = await response.json();
      if (!answer || typeof answer !== 'object' || !('role' in answer)) return undefined;
      return answer.role;
    },
  },
  routes: [
    {
      method: 'POST',
      path: '/invalidate',
      public: true,
      async handler({ request }, ctx) {
        const body = await readText(request, 16 * 1024);
        const ok = await verifyHmacSha256({ secret: ctx.config.secret, body, signature: request.headers.get('x-oa-signature'), prefix: 'sha256=' });
        if (!ok) throw new HttpError(401, 'Bad signature.');
        let artifactId;
        try {
          artifactId = body.trim() === '' ? undefined : JSON.parse(body).artifactId;
        } catch {
          throw new HttpError(400, 'The body is not JSON.');
        }
        if (artifactId !== undefined && typeof artifactId !== 'string') throw new HttpError(400, 'artifactId is a string.');
        await ctx.host.access.invalidate(artifactId);
        return json({ ok: true });
      },
    },
  ],
};
