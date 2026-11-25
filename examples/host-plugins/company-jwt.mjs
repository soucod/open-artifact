/**
 * company-jwt: sign people in with the JWT cookie your company's own sign-in already sets on the parent domain, and
 * give each department its own role on every artifact. It also refuses public links and adds a "My department" link
 * to the account menu.
 *
 * The cookie must reach the site: the site lives under the same parent domain (artifacts.corp.example with a cookie
 * for .corp.example). The token's `department` claim picks the role; a department missing from `departments` may not
 * sign in at all.
 */
import { verifyJwt } from '@open-artifact/host-plugin';

const RANK = { viewer: 1, commenter: 2, editor: 3, owner: 4 };
const departmentOf = (principal) => {
  const person = principal.kind === 'agent' ? principal.user : principal; // an agent acts with its person's role
  const group = person.kind === 'user' && person.groups?.find((g) => g.startsWith('plugin:company-jwt:dept:'));
  return group ? group.slice('plugin:company-jwt:dept:'.length) : null;
};

export default {
  id: 'company-jwt',
  apiVersion: 1,
  name: 'Company sign-in',
  version: '1.0.0',
  config: {
    cookie: { type: 'string', default: 'corp_token', description: 'The cookie that holds the JWT.' },
    key: { type: 'secret', description: 'The HS256 key the tokens are signed with (or use jwksUrl).' },
    jwksUrl: { type: 'string', description: 'Where the signing keys are published (RS256, ES256).' },
    issuer: { type: 'string', required: true, description: 'The `iss` every token must carry.' },
    departments: { type: 'map', default: {}, description: 'Department -> viewer, commenter or editor on every artifact.' },
  },
  validate(c) {
    const wrong = Object.entries(c.departments).filter(([, role]) => !['viewer', 'commenter', 'editor'].includes(role));
    const problems = wrong.map(([dept, role]) => `departments.${dept} is "${role}": the role is viewer, commenter or editor.`);
    return !c.key === !c.jwksUrl ? ['set exactly one of "key" and "jwksUrl".', ...problems] : problems;
  },
  auth: {
    async authenticate({ request }, ctx) {
      const token = new RegExp(`(?:^|;\\s*)${ctx.config.cookie}=([^;]+)`).exec(request.headers.get('cookie') ?? '')?.[1];
      if (!token) return null;
      const { key, jwksUrl, issuer } = ctx.config;
      const result = await verifyJwt({ token, issuer, ...(key ? { key } : { jwksUrl }), now: ctx.now() }, ctx.fetch);
      // Keys that cannot be fetched say nothing about the person: throw, so the host keeps their session.
      if (!result.valid && result.unavailable) throw new Error(result.reason);
      if (!result.valid) ctx.log(`refused a token: ${result.reason}`);
      const { sub, email, name, department } = result.valid ? result.claims : {};
      if (typeof sub !== 'string') return null;
      return {
        subject: sub,
        ...(typeof email === 'string' ? { email, emailVerified: true } : {}),
        ...(typeof name === 'string' ? { name } : {}),
        groups: typeof department === 'string' ? [`dept:${department}`] : [],
      };
    },
    // Asked after every sign-in, by any method: refuse company people whose department is not on the list.
    identity({ identity, provider }, ctx) {
      if (provider !== 'plugin:company-jwt') return undefined;
      const dept = identity.groups?.find((g) => g.startsWith('dept:'))?.slice(5);
      if (!dept || !(dept in ctx.config.departments)) return { reject: 'Your department does not use this site yet.' };
      return undefined;
    },
  },
  authz: {
    cacheSeconds: 300,
    role({ principal, role }, ctx) {
      const given = ctx.config.departments[departmentOf(principal)];
      if (!given || (role && RANK[role] >= RANK[given])) return undefined; // never lowers what the site gave
      return given;
    },
  },
  guard({ action, detail }) {
    if (action === 'share.change' && detail.changes.access === 'public') return { deny: 'Public links are turned off here: share with people or departments instead.' };
    return undefined;
  },
  routes: [
    { method: 'GET', path: '/me', handler: ({ principal }) => Response.json({ department: departmentOf(principal) }) },
  ],
  ui: { links: [{ label: 'My department', href: '/plugins/company-jwt/me', where: 'account-menu' }] },
};
