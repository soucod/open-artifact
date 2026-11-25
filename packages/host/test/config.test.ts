import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ConfigError, parseConfig } from '../src/core/config.ts';

const KEY = 'k'.repeat(32);

function fails(env: Record<string, string>, variable: string, pattern?: RegExp): void {
  assert.throws(
    () => parseConfig({ OA_SIGNING_KEYS: KEY, ...env }),
    (error: unknown) => error instanceof ConfigError && error.variable === variable && error.message.startsWith(`${variable}:`) && (!pattern || pattern.test(error.message)),
  );
}

test('defaults', () => {
  assert.deepEqual(parseConfig({ OA_SIGNING_KEYS: KEY }), {
    appOrigin: 'http://localhost:4900',
    contentOrigin: 'http://{id}.content.localhost:4900',
    signingKeys: [KEY],
    auth: [{ kind: 'owner-key' }],
    owners: [],
    signup: 'invite',
    linkMaxRole: 'editor',
    publicAccess: true,
    typesPublish: 'admins',
  });
});

test('every variable is read and normalised', () => {
  const config = parseConfig({
    OA_APP_ORIGIN: 'https://Artifacts.Example.com/',
    OA_CONTENT_ORIGIN: 'https://{id}.oa-content.example.net',
    OA_SIGNING_KEYS: ` ${KEY}, ${'b'.repeat(40)} `,
    OA_AUTH: JSON.stringify([{ kind: 'oidc', id: 'google', name: 'Google', issuer: 'https://accounts.google.com', clientId: 'c', scopes: ['openid'] }, { kind: 'github', clientId: 'g', clientSecret: 's' }]),
    OA_OWNERS: 'Ada@Example.com, bo@example.com',
    OA_SIGNUP: 'domain:Example.com',
    OA_LINK_MAX_ROLE: 'commenter',
    OA_PUBLIC_ACCESS: 'false',
  });
  assert.equal(config.appOrigin, 'https://artifacts.example.com');
  assert.equal(config.contentOrigin, 'https://{id}.oa-content.example.net');
  assert.deepEqual(config.signingKeys, [KEY, 'b'.repeat(40)]);
  assert.equal(config.auth.length, 2);
  assert.deepEqual(config.owners, ['ada@example.com', 'bo@example.com']);
  assert.equal(config.signup, 'domain:example.com');
  assert.equal(config.linkMaxRole, 'commenter');
  assert.equal(config.publicAccess, false);
});

test('signing keys are required and long enough', () => {
  assert.throws(() => parseConfig({}), (e: unknown) => e instanceof ConfigError && e.variable === 'OA_SIGNING_KEYS');
  fails({ OA_SIGNING_KEYS: ' , ' }, 'OA_SIGNING_KEYS');
  fails({ OA_SIGNING_KEYS: 'short' }, 'OA_SIGNING_KEYS', /32/);
});

test('origins: https unless local, origin only, a URL', () => {
  fails({ OA_APP_ORIGIN: 'http://artifacts.example.com' }, 'OA_APP_ORIGIN', /https/);
  fails({ OA_APP_ORIGIN: 'https://artifacts.example.com/app' }, 'OA_APP_ORIGIN', /origin only/);
  fails({ OA_APP_ORIGIN: 'not a url' }, 'OA_APP_ORIGIN');
  fails({ OA_APP_ORIGIN: 'ftp://example.com' }, 'OA_APP_ORIGIN');
  assert.equal(parseConfig({ OA_SIGNING_KEYS: KEY, OA_APP_ORIGIN: 'http://127.0.0.1:4900', OA_CONTENT_ORIGIN: 'http://{id}.content.localhost:4900' }).appOrigin, 'http://127.0.0.1:4900');
  fails({ OA_CONTENT_ORIGIN: 'http://{id}.content.example.net', OA_APP_ORIGIN: 'https://a.example.com' }, 'OA_CONTENT_ORIGIN', /https/);
});

test('the content origin needs {id} once, as the first label', () => {
  fails({ OA_CONTENT_ORIGIN: 'https://content.example.net' }, 'OA_CONTENT_ORIGIN', /\{id\}/);
  fails({ OA_CONTENT_ORIGIN: 'https://{id}.{id}.example.net' }, 'OA_CONTENT_ORIGIN', /once/);
  fails({ OA_CONTENT_ORIGIN: 'https://x-{id}.example.net' }, 'OA_CONTENT_ORIGIN', /first label/);
  fails({ OA_CONTENT_ORIGIN: 'https://{id}.example.net/path' }, 'OA_CONTENT_ORIGIN');
});

test('app and content origins must be different sites', () => {
  fails({ OA_APP_ORIGIN: 'https://artifacts.example.com', OA_CONTENT_ORIGIN: 'https://{id}.content.example.com' }, 'OA_CONTENT_ORIGIN', /different site/);
  fails({ OA_APP_ORIGIN: 'https://a.example.co.uk', OA_CONTENT_ORIGIN: 'https://{id}.b.example.co.uk' }, 'OA_CONTENT_ORIGIN', /different site/);
  assert.ok(parseConfig({ OA_SIGNING_KEYS: KEY, OA_APP_ORIGIN: 'https://a.example.co.uk', OA_CONTENT_ORIGIN: 'https://{id}.other.co.uk' }));
});

test('OA_AUTH, OA_OWNERS, OA_SIGNUP, OA_LINK_MAX_ROLE and OA_PUBLIC_ACCESS are validated', () => {
  fails({ OA_AUTH: 'nope' }, 'OA_AUTH', /JSON/);
  fails({ OA_AUTH: '[]' }, 'OA_AUTH');
  fails({ OA_AUTH: '[{"kind":"saml"}]' }, 'OA_AUTH', /unknown kind/);
  fails({ OA_AUTH: '[{"kind":"github","clientId":"x"}]' }, 'OA_AUTH', /clientSecret/);
  fails({ OA_AUTH: '[{"kind":"oidc","id":"g","name":"G","issuer":"http://idp.example.com","clientId":"c"}]' }, 'OA_AUTH', /issuer/);
  fails({ OA_AUTH: '[{"kind":"owner-key"},{"kind":"owner-key"}]' }, 'OA_AUTH', /repeats/);
  fails({ OA_OWNERS: 'not-an-email' }, 'OA_OWNERS');
  fails({ OA_SIGNUP: 'everyone' }, 'OA_SIGNUP');
  fails({ OA_SIGNUP: 'domain:' }, 'OA_SIGNUP');
  fails({ OA_LINK_MAX_ROLE: 'owner' }, 'OA_LINK_MAX_ROLE');
  fails({ OA_PUBLIC_ACCESS: 'maybe' }, 'OA_PUBLIC_ACCESS');
});
