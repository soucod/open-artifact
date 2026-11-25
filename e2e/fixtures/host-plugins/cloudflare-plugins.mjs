// The plugins e2e/cloudflare-plugins.test.mjs bundles into the Worker (OA_PLUGINS_MODULE=<this file> npm run build):
// the five examples, and a guard that refuses archive exports.
import headerAuth from '../../../examples/host-plugins/header-auth.mjs';
import httpAuthz from '../../../examples/host-plugins/http-authz.mjs';
import inviteEmail from '../../../examples/host-plugins/invite-email.mjs';
import staticGroups from '../../../examples/host-plugins/static-groups.mjs';
import webhookEvents from '../../../examples/host-plugins/webhook-events.mjs';
import noExport from './no-export.mjs';

export default {
  'header-auth': headerAuth,
  'http-authz': httpAuthz,
  'invite-email': inviteEmail,
  'static-groups': staticGroups,
  'webhook-events': webhookEvents,
  'no-export': noExport,
};
