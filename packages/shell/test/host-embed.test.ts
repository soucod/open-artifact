/**
 * The Shell's side of embedding: which `host_hello` is taken (declared origin, another one, none declared), what an
 * undeclared host is sent, destinations capped, the accent's variables, and the home page's host and library filter.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_HOST_DESTINATIONS, MAX_HOST_TEXT, type ArtifactView } from '@open-artifact/protocol';
import { accentVars, destinationRequest, hostOf, hostVerdict, toHostMessage } from '../src/shell/model.ts';
import { forHost, homeHostOf } from '../src/home/model.ts';

const hello = (extra: Record<string, unknown> = {}) => ({ openArtifact: 'host_hello', caps: { sessions: true, toolbar: true }, agentName: 'Helper', ...extra });

describe('host handshake', () => {
  it('takes a declared origin, refuses another while any is declared, and takes any parent while none is', () => {
    assert.equal(hostVerdict('app://host', ['app://host', 'https://app.example.com']), 'declared');
    assert.equal(hostVerdict('https://evil.example', ['app://host']), 'refused');
    assert.equal(hostVerdict('null', ['app://host']), 'refused');
    assert.equal(hostVerdict('https://evil.example', []), 'undeclared');
    assert.equal(hostVerdict('https://evil.example', null), 'undeclared', 'a list that could not be read declares nothing');
  });

  it('reduces host_hello to its fields; destinations only for a declared host, at most MAX_HOST_DESTINATIONS', () => {
    const destinations = Array.from({ length: MAX_HOST_DESTINATIONS + 3 }, (_, i) => ({ id: `d${i}`, label: `Place ${i}`, run: 'x' }));
    const declared = hostOf(hello({ destinations, theme: { scheme: 'dark', accent: '#ff8800' }, extra: 'dropped' }), 'app://host', true)!;
    assert.equal(declared.declared, true);
    assert.equal(declared.via, 'frame');
    assert.equal(declared.destinations.length, MAX_HOST_DESTINATIONS);
    assert.deepEqual(declared.destinations[0], { id: 'd0', label: 'Place 0' });
    assert.deepEqual(declared.theme, { scheme: 'dark', accent: '#ff8800' });
    assert.deepEqual(declared.caps, { sessions: true, toolbar: true });
    const undeclared = hostOf(hello({ destinations }), 'https://evil.example', false)!;
    assert.deepEqual(undeclared.destinations, [], 'an undeclared host offers no destinations');
    assert.equal(hostOf({ openArtifact: 'goto', hash: '#x' }, 'app://host', true), null);
    assert.equal(hostOf('host_hello', 'app://host', true), null);
  });

  it('sends an undeclared host no prompt or comment text, links or saved files', () => {
    const undeclared = hostOf(hello(), 'https://evil.example', false)!;
    const declared = hostOf(hello(), 'app://host', true)!;
    const prompt = { openArtifact: 'new_session' as const, prompt: 'Fix slide 3', artifact: 'open-artifact://artifact/a' };
    assert.deepEqual(toHostMessage(undeclared, prompt), { ...prompt, prompt: '' });
    assert.deepEqual(toHostMessage(declared, prompt), prompt);
    assert.deepEqual(toHostMessage(undeclared, { openArtifact: 'comment_summon', text: 'secret' }), { openArtifact: 'comment_summon', text: '' });
    assert.equal(toHostMessage(undeclared, { openArtifact: 'open_external', url: 'https://example.com' }), null);
    assert.equal(toHostMessage(undeclared, { openArtifact: 'saved_file', path: '/Users/me/Downloads/a.pdf' }), null);
    assert.deepEqual(toHostMessage(declared, { openArtifact: 'saved_file', path: '/Users/me/Downloads/a.pdf' }), { openArtifact: 'saved_file', path: '/Users/me/Downloads/a.pdf' });
    assert.deepEqual(toHostMessage(undeclared, { openArtifact: 'place', artifact: 'x', hash: '#2' }), { openArtifact: 'place', artifact: 'x', hash: '#2' });
  });

  it('a top-level view host is the adapter itself: declared', () => {
    const view = hostOf(hello({ destinations: [{ id: 'drive', label: 'Drive' }] }), 'view', true, 'view')!;
    assert.equal(view.via, 'view');
    assert.equal(view.destinations.length, 1);
  });

  it('names the destination in the page request as quoted data', () => {
    const text = destinationRequest({ id: 'drive', label: 'Google Drive' }, 'Q3 deck');
    assert.match(text, /"Google Drive" \(destination id: drive\)/);
    assert.match(text, /"Q3 deck"/);
  });

  it("sets the accent's variables for #rrggbb only", () => {
    assert.deepEqual(accentVars(null), {});
    assert.deepEqual(accentVars('red'), {});
    assert.deepEqual(accentVars('#FFEE00'), { '--open-artifact-accent': '#ffee00', '--open-artifact-accent-fg': '#0b1220', '--open-artifact-accent-soft': '#ffee001f' });
    assert.equal(accentVars('#1d4ed8')['--open-artifact-accent-fg'], '#ffffff');
  });

  it('cuts long texts in messages it reads', () => {
    const host = hostOf(hello({ agentName: 'x'.repeat(MAX_HOST_TEXT) }), 'app://host', true)!;
    assert.ok(host.agentName!.length <= 80);
  });
});

describe('home page host', () => {
  const art = (id: string, harness: string | null, workspace: string | null, root = `/tmp/${id}`): ArtifactView =>
    ({ id, url: `open-artifact://artifact/${id}`, title: id, type: 'slides', root, owner: harness ? { harness, session: 's', workspace, live: true, status: 'idle' } : null }) as unknown as ArtifactView;

  it('reads host_hello with its library filter and artifacts cap', () => {
    const host = homeHostOf({ openArtifact: 'host_hello', caps: { artifacts: true, sessions: true }, harness: 'myagent', library: { harness: 'myagent', workspace: '/w/proj', bad: 1 } }, 'app://host', true)!;
    assert.deepEqual(host, { origin: 'app://host', caps: { sessions: true, artifacts: true }, harness: 'myagent', agentName: null, declared: true, library: { harness: 'myagent', workspace: '/w/proj' } });
  });

  it('lists only the harness and workspace the host asked for', () => {
    const list = [art('a', 'myagent', '/w/proj'), art('b', 'myagent', '/w/other'), art('c', 'codex', '/w/proj'), art('d', 'myagent', null, '/w/proj/deck'), art('e', null, null)];
    assert.deepEqual(forHost(list, null).map((a) => a.id), ['a', 'b', 'c', 'd', 'e']);
    assert.deepEqual(forHost(list, { harness: 'myagent' }).map((a) => a.id), ['a', 'b', 'd']);
    assert.deepEqual(forHost(list, { workspace: '/w/proj/' }).map((a) => a.id), ['a', 'c', 'd']);
    assert.deepEqual(forHost(list, { harness: 'myagent', workspace: '/w/proj' }).map((a) => a.id), ['a', 'd']);
    assert.deepEqual(forHost([art('f', 'myagent', '/w/project')], { workspace: '/w/proj' }), [], 'a sibling folder with the same prefix is not under it');
  });
});
