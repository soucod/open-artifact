/**
 * webhook-events: post chosen events to a URL, as a Slack message (`format: "slack"`, for an incoming webhook) or as
 * the event's JSON (`format: "json"`). With `signingSecret`, each post carries `x-oa-signature: sha256=<hex HMAC of
 * the body>`. A post that fails is kept (in the plugin's store, for a day) and tried again with the next event, at
 * most 5 times. Imports nothing.
 */
const EVENTS = [
  'user.created', 'user.signed_in', 'artifact.created', 'artifact.changed', 'artifact.trashed', 'artifact.restored',
  'artifact.deleted', 'share.changed', 'share.invited', 'agent.requested',
];
const MAX_TRIES = 5;

function slackText(e) {
  const who = e.by?.name ?? e.user?.name ?? 'Someone';
  const what = e.artifact ? `"${e.artifact.title}"` : '';
  switch (e.event) {
    case 'user.created': return `${e.user.name} joined.`;
    case 'user.signed_in': return `${e.user.name} signed in.`;
    case 'artifact.created': return `${who} created ${what}.`;
    case 'artifact.changed': return `${who} changed ${what}.`;
    case 'artifact.trashed': return `${who} moved ${what} to the trash.`;
    case 'artifact.restored': return `${who} restored ${what}.`;
    case 'artifact.deleted': return `${what} was deleted.`;
    case 'share.changed': return `${who} changed who can open ${what}.`;
    case 'share.invited': return `${who} invited ${e.invitee.email ?? e.invitee.name ?? 'someone'} to ${what} as ${e.role}.`;
    case 'agent.requested': return `${who} asked the agent on ${what}: ${e.text}`;
    default: return `${e.event}`;
  }
}

async function sign(secret, body) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(body)));
  return Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function post(body, ctx) {
  const headers = { 'content-type': 'application/json' };
  if (ctx.config.signingSecret) headers['x-oa-signature'] = `sha256=${await sign(ctx.config.signingSecret, body)}`;
  const response = await ctx.fetch(ctx.config.url, { method: 'POST', headers, body });
  if (!response.ok) throw new Error(`the webhook answered ${response.status}`);
}

async function send(e, ctx) {
  if (!ctx.config.events.includes(e.event)) return;
  if (ctx.config.format !== 'json' && ctx.config.format !== 'slack') throw new Error(`format is "json" or "slack", not "${ctx.config.format}"`);
  const body = JSON.stringify(ctx.config.format === 'slack' ? { text: slackText(e) } : e);

  // Earlier posts that failed go first.
  for (const { key, value } of await ctx.kv.list({ prefix: 'retry:', limit: 20 })) {
    try {
      await post(value.body, ctx);
      await ctx.kv.delete(key);
    } catch {
      if (value.tries + 1 >= MAX_TRIES) await ctx.kv.delete(key);
      else await ctx.kv.set(key, { ...value, tries: value.tries + 1 }, { ttlSeconds: 86_400 });
    }
  }
  try {
    await post(body, ctx);
  } catch (error) {
    await ctx.kv.set(`retry:${ctx.now().toISOString()}:${crypto.randomUUID()}`, { body, tries: 1 }, { ttlSeconds: 86_400 });
    throw error;
  }
}

export default {
  id: 'webhook-events',
  apiVersion: 1,
  name: 'Webhook events',
  version: '1.0.0',
  config: {
    url: { type: 'secret', required: true, description: 'Where to post (a Slack incoming webhook URL is a secret).' },
    events: { type: 'string[]', default: ['artifact.created', 'share.changed'], description: 'Which events to post.' },
    format: { type: 'string', default: 'json', description: '"json" (the event) or "slack" ({text}).' },
    signingSecret: { type: 'secret', description: 'Signs each post (x-oa-signature).' },
  },
  on: Object.fromEntries(EVENTS.map((name) => [name, send])),
};
