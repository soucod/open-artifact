/**
 * header-auth: sign people in from a header that a proxy in front of Open Artifact sets (oauth2-proxy, an ingress
 * with SSO, a corporate gateway).
 *
 * A header is only proof when nobody but the proxy can send it, so the plugin also wants one of:
 * - a shared secret the proxy adds in another header (`secretHeader`, `secret`), or
 * - a JWT the proxy adds (`jwtHeader`), checked against the proxy's published keys (`jwksUrl`, `issuer`, `audience`).
 * With neither set, `validate` refuses the settings, so the host does not start with a header anyone could send.
 */
import { timingSafeEqual, verifyJwt } from '@open-artifact/host-plugin';

export default {
  id: 'header-auth',
  apiVersion: 1,
  name: 'Header sign-in',
  version: '1.0.0',
  description: 'Signs people in from headers an authenticating proxy sets.',
  config: {
    emailHeader: { type: 'string', default: 'x-forwarded-email', description: 'The header with the e-mail address.' },
    nameHeader: { type: 'string', default: 'x-forwarded-user', description: 'The header with the display name.' },
    groupsHeader: { type: 'string', description: 'A header with comma-separated groups (optional).' },
    secretHeader: { type: 'string', default: 'x-proxy-secret', description: 'The header the proxy puts the shared secret in.' },
    secret: { type: 'secret', description: 'The shared secret the proxy sends (or use a JWT instead).' },
    jwtHeader: { type: 'string', description: 'A header with a JWT the proxy signs (e.g. cf-access-jwt-assertion).' },
    jwksUrl: { type: 'string', description: 'Where the proxy publishes its JWT signing keys.' },
    issuer: { type: 'string', description: 'The JWT issuer to require.' },
    audience: { type: 'string', description: 'The JWT audience to require.' },
  },
  validate(c) {
    if (c.secret) return undefined;
    if (c.jwtHeader && c.jwksUrl) return undefined;
    if (c.jwtHeader || c.jwksUrl) return 'a JWT needs both "jwtHeader" and "jwksUrl".';
    return 'set "secret" (with "secretHeader") or "jwtHeader" and "jwksUrl": without one, anyone could send the header.';
  },
  auth: {
    async authenticate({ request }, ctx) {
      const c = ctx.config;
      const header = (name) => (name ? request.headers.get(name)?.trim() || null : null);
      let email = header(c.emailHeader);
      let subject = email?.toLowerCase() ?? null;

      if (c.secret) {
        const given = header(c.secretHeader);
        if (!given || !timingSafeEqual(given, c.secret)) return null;
      } else {
        const token = header(c.jwtHeader);
        if (!token) return null;
        const result = await verifyJwt(
          { token, jwksUrl: c.jwksUrl, ...(c.issuer ? { issuer: c.issuer } : {}), ...(c.audience ? { audience: c.audience } : {}), now: ctx.now() },
          ctx.fetch,
        );
        // Keys that cannot be fetched say nothing about the person: throw, so the host keeps their session for the
        // next request rather than signing them out.
        if (!result.valid && result.unavailable) throw new Error(result.reason);
        if (!result.valid) {
          ctx.log(`refused a JWT: ${result.reason}`);
          return null;
        }
        // The token is what the proxy vouches for; a plain header beside it is not.
        email = typeof result.claims.email === 'string' ? result.claims.email : null;
        subject = typeof result.claims.sub === 'string' ? result.claims.sub : email?.toLowerCase() ?? null;
      }

      if (!subject) return null;
      const groups = header(c.groupsHeader)?.split(',').map((g) => g.trim()).filter(Boolean);
      return {
        subject,
        ...(email ? { email: email.toLowerCase(), emailVerified: true } : {}),
        ...(header(c.nameHeader) ? { name: header(c.nameHeader) } : {}),
        ...(groups?.length ? { groups } : {}),
      };
    },
  },
};
