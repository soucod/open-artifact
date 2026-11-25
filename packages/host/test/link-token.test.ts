/**
 * `open-artifact-host link-token`: mints a Link refresh token for a person (printed once, audited without the token),
 * which refreshes like a device sign-in's (rotating on use), and `--revoke <id>` revokes it.
 */

import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ConfigError, parseConfig } from '../src/core/config.ts';
import { LINK_ACCESS_TTL_MS, LINK_SCOPE } from '../src/core/link/services.ts';
import { openCatalog } from '../src/node/host.ts';
import { main } from '../src/node/main.ts';

const KEY = 'k'.repeat(40);

/** Runs the command line, returning what it printed. */
async function run(argv: string[], env: Record<string, string>): Promise<string> {
  const lines: string[] = [];
  const log = console.log;
  console.log = (...args: unknown[]) => void lines.push(args.join(' '));
  try {
    await main(argv, env);
  } finally {
    console.log = log;
  }
  return lines.join('\n');
}

test('link-token mints a refresh token, prints it once, audits it; it refreshes, and --revoke ends it', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'open-artifact-host-link-token-'));
  const env = { OA_DATA_DIR: dataDir, OA_SIGNING_KEYS: KEY, OA_APP_ORIGIN: 'http://oa.lan:4900', OA_CONTENT_ORIGIN: 'http://{id}.oa-content.lan:4900' };

  const printed = await run(['link-token', '--user', 'Ada@Example.com', '--label', 'Ada laptop'], env);
  const token = /OPEN_ARTIFACT_REMOTE_TOKEN=(\S+)/.exec(printed)?.[1];
  const id = /--revoke (\S+)/.exec(printed)?.[1];
  assert.ok(token?.startsWith('oa_rt_'), printed);
  assert.ok(id, printed);
  assert.match(printed, /OPEN_ARTIFACT_REMOTE=http:\/\/oa\.lan:4900/);
  assert.doesNotMatch(printed, /only the default address/, 'OA_APP_ORIGIN is set: no warning');

  const config = parseConfig(env);
  let opened = await openCatalog(dataDir, config);
  try {
    const user = await opened.catalog.findUserByEmail('ada@example.com');
    assert.ok(user, 'the person is made when missing');
    const record = await opened.catalog.getAgentToken(id!);
    assert.equal(record?.userId, user!.id);
    assert.equal(record?.label, 'Ada laptop');
    assert.deepEqual(record?.scopes, [LINK_SCOPE]);
    // The audit says who and which token, never the token.
    const audit = await opened.catalog.listAudit();
    const issued = audit.find((a) => a.action === 'link.token_issued');
    assert.ok(issued);
    assert.ok(!JSON.stringify(audit).includes(token!));
    // It refreshes, as a device sign-in's does (and rotates).
    const rotated = await opened.catalog.rotateAgentToken(token!, LINK_ACCESS_TTL_MS);
    assert.ok(rotated);
    assert.notEqual(rotated!.refreshToken, token);
  } finally {
    opened.driver.close();
  }

  assert.match(await run(['link-token', '--revoke', id!], env), /Revoked/);
  assert.match(await run(['link-token', '--revoke', id!], env), /already revoked/);
  opened = await openCatalog(dataDir, config);
  try {
    assert.ok((await opened.catalog.getAgentToken(id!))?.revokedAt);
    assert.ok((await opened.catalog.listAudit()).some((a) => a.action === 'link.token_revoked'));
  } finally {
    opened.driver.close();
  }
});

test('link-token without OA_APP_ORIGIN says the address it prints is only the default', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'open-artifact-host-link-token-'));
  const printed = await run(['link-token', '--user', 'bo@example.com'], { OA_DATA_DIR: dataDir, OA_SIGNING_KEYS: KEY });
  assert.match(printed, /OPEN_ARTIFACT_REMOTE=http:\/\/localhost:4900/);
  assert.match(printed, /OA_APP_ORIGIN is not set here, so http:\/\/localhost:4900 is only the default address/);
  assert.match(printed, /same environment as the server \(with Docker: `docker compose exec host/);
});

test('link-token refuses missing or mixed arguments and an unknown token', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'open-artifact-host-link-token-'));
  const env = { OA_DATA_DIR: dataDir, OA_SIGNING_KEYS: KEY };
  for (const argv of [['link-token'], ['link-token', '--user'], ['link-token', '--user', 'a@b.c', '--revoke', 'x'], ['link-token', '--bogus', '1'], ['link-token', '--user', 'not-an-email']]) {
    await assert.rejects(main(argv, env), ConfigError, argv.join(' '));
  }
  await assert.rejects(main(['link-token', '--revoke', 'agt_missing'], env), /no Link token/);
});
