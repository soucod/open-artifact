/**
 * invite-email: e-mail people when an artifact is shared with them (the host sends no mail itself).
 *
 * It POSTs `{from, to, subject, text}` as JSON to a mail service's HTTP API (`apiUrl`), with `apiKey` in the
 * `authHeader` header (`Authorization: Bearer <key>` by default). Most services (Resend, Postmark, SendGrid through a
 * small relay, your own) take that shape or close to it. `subject` and `text` are templates: `{title}`, `{role}`,
 * `{url}`, `{inviter}`, `{name}`. Imports nothing.
 */
function fill(template, values) {
  return template.replace(/\{(\w+)\}/g, (whole, name) => (name in values ? String(values[name]) : whole));
}

export default {
  id: 'invite-email',
  apiVersion: 1,
  name: 'Invitation e-mail',
  version: '1.0.0',
  config: {
    apiUrl: { type: 'string', required: true, description: 'The mail service endpoint to POST to.' },
    apiKey: { type: 'secret', required: true, description: 'The mail service key.' },
    authHeader: { type: 'string', default: 'authorization', description: 'The header the key goes in.' },
    authScheme: { type: 'string', default: 'Bearer', description: 'Put before the key ("" for none).' },
    from: { type: 'string', required: true, description: 'The sender, e.g. "Artifacts <artifacts@example.com>".' },
    subject: { type: 'string', default: '{inviter} shared "{title}" with you' },
    text: { type: 'string', default: 'Hello {name},\n\n{inviter} gave you {role} access to "{title}".\n\nOpen it: {url}\n' },
  },
  on: {
    async 'share.invited'(e, ctx) {
      let to = e.invitee.email;
      let name = e.invitee.name;
      if (!to && e.invitee.userId) {
        const user = await ctx.host.users.get(e.invitee.userId);
        to = user?.email ?? undefined;
        name ??= user?.name;
      }
      if (!to) return;
      const values = { title: e.artifact.title, role: e.role, url: e.url, inviter: e.by.name ?? 'Someone', name: name ?? to };
      const c = ctx.config;
      const response = await ctx.fetch(c.apiUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [c.authHeader]: c.authScheme ? `${c.authScheme} ${c.apiKey}` : c.apiKey },
        body: JSON.stringify({ from: c.from, to, subject: fill(c.subject, values), text: fill(c.text, values) }),
      });
      if (!response.ok) throw new Error(`the mail service answered ${response.status} for ${e.artifact.id}`);
      await ctx.host.audit('invite.sent', { artifact: e.artifact.id, role: e.role });
    },
  },
};
