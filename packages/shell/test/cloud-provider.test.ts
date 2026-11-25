/** A cloud host's capabilities: downloads in the browser (refused for a viewer unless allowed), no `mcp`. */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { CAP_PROTOCOL, type CapToPage } from '@open-artifact/protocol';
import { isArtifactError, type CapabilityProvider } from '@open-artifact/runtime';
import { call, resetBroker, setCloudPolicy, want } from '../src/shell/broker.ts';
import { EXPORT_REFUSED, REVOKE_AFTER_MS, cloudProvider, downloadName, saveInBrowser, type DownloadEnv } from '../src/shell/cloud-provider.ts';

const PAGE = 'https://art-x.content.example';
const BASE = `${PAGE}/design/v1.tok.sig/`;

/** A backend that offers everything, recording what reached it. */
function backend(reached: string[]): CapabilityProvider {
  return {
    get(name) {
      reached.push(name);
      if (name === 'mcp') return { callTool: async () => ({}), listTools: async () => ({}) } as never;
      if (name === 'downloads') return { save: async () => ({ savedTo: '/Users/x/Downloads/a.png' }) } as never;
      if (name === 'artifact') return { id: 'art_x' } as never;
      return null;
    },
  };
}

describe('saveInBrowser', () => {
  it('clicks a hidden download link and revokes the object URL later', () => {
    const events: string[] = [];
    const timers: Array<[() => void, number]> = [];
    const link = {
      href: '',
      download: '',
      rel: '',
      style: { display: '' },
      click: () => events.push(`click ${link.href} ${link.download}`),
      remove: () => events.push('remove'),
    };
    const env: DownloadEnv = {
      document: { createElement: () => link as never, body: { append: () => events.push('append') } as never },
      URL: { createObjectURL: () => 'blob:1', revokeObjectURL: (url: string) => events.push(`revoke ${url}`) },
      setTimeout: (run, ms) => timers.push([run, ms]),
    };
    assert.deepEqual(saveInBrowser({ name: 'dir/Slide 1.png', data: new Blob(['x']) }, env), {});
    assert.deepEqual(events, ['append', 'click blob:1 Slide 1.png', 'remove']);
    assert.equal(link.style.display, 'none');
    assert.equal(timers[0]![1], REVOKE_AFTER_MS);
    timers[0]![0]();
    assert.equal(events.at(-1), 'revoke blob:1');
  });

  it('names the file safely', () => {
    assert.equal(downloadName('a/b\\c.pdf'), 'c.pdf');
    assert.equal(downloadName('..'), 'download');
    assert.equal(downloadName('  '), 'download');
    assert.equal(downloadName('a\u0000b.txt'), 'ab.txt');
  });
});

describe('cloudProvider', () => {
  it('offers no mcp, its own downloads, and passes the rest through', async () => {
    const reached: string[] = [];
    const saved: string[] = [];
    const provider = cloudProvider(backend(reached), { mayExport: () => true, save: (file) => (saved.push(file.name), {}) });
    assert.equal(await provider.get('mcp'), null);
    const downloads = await provider.get('downloads');
    assert.deepEqual(await downloads!.save({ name: 'a.png', data: new Blob(['x']) }), {});
    assert.deepEqual(saved, ['a.png']);
    assert.equal(downloads!.browser, true);
    assert.deepEqual(await provider.get('artifact'), { id: 'art_x' });
    assert.deepEqual(reached, ['artifact'], 'mcp and downloads never reach the backend');
  });

  it('refuses a save the person may not make, as the type server would', async () => {
    let allowed = false;
    const saved: string[] = [];
    const provider = cloudProvider(backend([]), { mayExport: async () => allowed, save: (file) => (saved.push(file.name), {}) });
    const downloads = await provider.get('downloads');
    await assert.rejects(downloads!.save({ name: 'a.png', data: new Blob(['x']) }), (error: unknown) => isArtifactError(error, 'not_writer') && (error as Error).message === EXPORT_REFUSED);
    allowed = true;
    await downloads!.save({ name: 'b.png', data: new Blob(['x']) });
    assert.deepEqual(saved, ['b.png']);
  });

  it('answers check (a print) by the same rule, saving nothing', async () => {
    let allowed = false;
    const saved: string[] = [];
    const provider = cloudProvider(backend([]), { mayExport: () => allowed, save: (file) => (saved.push(file.name), {}) });
    const downloads = await provider.get('downloads');
    await assert.rejects(downloads!.check!(), (error: unknown) => isArtifactError(error, 'not_writer') && (error as Error).message === EXPORT_REFUSED);
    allowed = true;
    await downloads!.check!();
    assert.deepEqual(saved, []);
  });
});

describe('the broker in cloud mode', () => {
  let posted: CapToPage[] = [];
  const post = (message: CapToPage): void => {
    posted.push(message);
  };
  beforeEach(() => {
    posted = [];
  });
  afterEach(() => resetBroker());

  it('does not grant mcp, and answers a refused download with not_writer', async () => {
    resetBroker(() => backend([]));
    setCloudPolicy({ mayExport: () => false, save: () => ({}) });
    await want({ openArtifact: 'cap_want', cap: 'mcp', protocol: CAP_PROTOCOL, base: BASE } as never, PAGE, post);
    assert.deepEqual(posted.pop(), { openArtifact: 'cap_grant', cap: 'mcp', ok: false, gen: 0 });
    await want({ openArtifact: 'cap_want', cap: 'downloads', protocol: CAP_PROTOCOL, base: BASE } as never, PAGE, post);
    // The grant tells the page its files are saved in the browser, so every role sends them here.
    assert.deepEqual(posted.pop(), { openArtifact: 'cap_grant', cap: 'downloads', ok: true, gen: 0, config: { browser: true } });
    await call({ openArtifact: 'cap', id: 'c1', cap: 'downloads', method: 'save', args: [{ name: 'a.png', data: new Blob(['x']) }], gen: 0 } as never, null, post);
    assert.deepEqual(posted.pop(), { openArtifact: 'cap_r', id: 'c1', error: { code: 'not_writer', message: EXPORT_REFUSED } });
  });

  it('is off without a policy: the backend serves both', async () => {
    resetBroker(() => backend([]));
    await want({ openArtifact: 'cap_want', cap: 'mcp', protocol: CAP_PROTOCOL, base: BASE } as never, PAGE, post);
    assert.equal((posted.pop() as { ok?: boolean }).ok, true);
    await want({ openArtifact: 'cap_want', cap: 'downloads', protocol: CAP_PROTOCOL, base: BASE } as never, PAGE, post);
    assert.deepEqual(posted.pop(), { openArtifact: 'cap_grant', cap: 'downloads', ok: true, gen: 0, config: {} });
    await call({ openArtifact: 'cap', id: 'c2', cap: 'downloads', method: 'save', args: [{ name: 'a.png', data: new Blob(['x']) }], gen: 0 } as never, null, post);
    assert.deepEqual(posted.pop(), { openArtifact: 'cap_r', id: 'c2', result: { savedTo: '/Users/x/Downloads/a.png' } });
  });
});
