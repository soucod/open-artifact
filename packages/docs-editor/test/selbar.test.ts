import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { schema } from '../src/editor/schema.ts';
import { formatChord } from '../src/selbar/chords.ts';
import { docHeadings, findPlace, headingHref, matchTargets, parseDocHref, tabHref } from '../src/selbar/fragments.ts';
import { checkHref, hrefProblem, normalizeHref, shortLink, webLinkParts } from '../src/selbar/link-url.ts';
import { placeBeside } from '../src/selbar/placement.ts';

const { nodes } = schema;
const heading = (level: number, text: string, bid: string) => nodes.paragraph!.create({ heading: level, bid }, text ? schema.text(text) : null);
const para = (text: string, bid: string) => nodes.paragraph!.create({ bid }, schema.text(text));

describe('chords', () => {
  it('shows chords for the platform', () => {
    assert.equal(formatChord('Mod-Alt-m', true), '⌘⌥M');
    assert.equal(formatChord('Mod-Alt-m', false), 'Ctrl+Alt+M');
    assert.equal(formatChord('Mod-Shift-8', false), 'Ctrl+Shift+8');
    assert.equal(formatChord('Mod-]', true), '⌘]');
    assert.equal(formatChord('Mod-Alt-Enter', true), '⌘⌥↵');
  });
});

describe('placement', () => {
  const bounds = { left: 0, top: 0, right: 1000, bottom: 800 };
  const size = { width: 200, height: 40 };
  it('goes above the range, centred', () => {
    assert.deepEqual(placeBeside({ left: 400, right: 600, top: 300, bottom: 320 }, size, bounds), { left: 400, top: 252, below: false });
  });
  it('flips below when there is no room above', () => {
    assert.deepEqual(placeBeside({ left: 400, right: 600, top: 20, bottom: 40 }, size, bounds), { left: 400, top: 48, below: true });
  });
  it('stays inside the bounds sideways', () => {
    assert.equal(placeBeside({ left: 0, right: 20, top: 300, bottom: 320 }, size, bounds)?.left, 0);
    assert.equal(placeBeside({ left: 980, right: 1000, top: 300, bottom: 320 }, size, bounds)?.left, 800);
  });
  it('is gone while the range is out of sight', () => {
    assert.equal(placeBeside({ left: 0, right: 20, top: 900, bottom: 920 }, size, bounds), null);
  });
  it('stays at the top when the range fills the view', () => {
    assert.deepEqual(placeBeside({ left: 0, right: 1000, top: -100, bottom: 900 }, size, bounds), { left: 400, top: 0, below: false });
  });
});

describe('typed links', () => {
  it('takes addresses as they are', () => {
    assert.equal(normalizeHref('https://example.com/a?b=1'), 'https://example.com/a?b=1');
    assert.equal(normalizeHref('  http://example.com  '), 'http://example.com');
    assert.equal(normalizeHref('mailto:a@b.co'), 'mailto:a@b.co');
  });
  it('completes bare domains and emails', () => {
    assert.equal(normalizeHref('example.com/path'), 'https://example.com/path');
    assert.equal(normalizeHref('someone@example.com'), 'mailto:someone@example.com');
    assert.equal(normalizeHref('tel: +1 555 0100'), 'tel:+15550100');
  });
  it('keeps places in the doc and paths', () => {
    assert.equal(normalizeHref('#ab12.3~intro'), '#ab12.3~intro');
    assert.equal(normalizeHref('/docs/a b'), '/docs/a%20b');
  });
  it('finds the one address in a pasted sentence', () => {
    assert.equal(normalizeHref('see https://example.com/x.'), 'https://example.com/x');
    assert.equal(normalizeHref('https://a.com and https://b.com'), null);
  });
  it('refuses what is not a link', () => {
    for (const bad of ['', 'hello', 'hello world', 'javascript:alert(1)', '//evil.com', 'https://user:pw@example.com', '# a', 'localhost']) assert.equal(normalizeHref(bad), null, bad);
  });
  it('shortens web links for the card', () => {
    assert.equal(webLinkParts('ftp://x.com'), null);
    assert.equal(shortLink('https://example.com/'), 'example.com');
    assert.equal(shortLink('https://example.com/a/very/long/path/that/goes/on/and/on'), 'example.com/a/very/long/pat…n/and/on');
  });
});

describe('how long a link may be', () => {
  const web = (bytes: number) => {
    const head = 'https://maps.example.org/route?stops=';
    return head + 'x'.repeat(bytes - head.length);
  };
  it('takes web addresses up to 8,192 bytes and keeps them whole', () => {
    const long = `${web(6000)}#leg-3`;
    assert.equal(normalizeHref(long), long);
    assert.equal(webLinkParts(long)?.open, long);
    assert.deepEqual(checkHref(web(8192)), { href: web(8192) });
    assert.deepEqual(checkHref(web(8193)), { problem: 'too_long', limit: 8192 });
  });
  it('counts the bytes of the address as stored, after percent-encoding', () => {
    const head = 'https://shop.example.net/?q=';
    const stored = normalizeHref(head + 'é'.repeat(1300));
    assert.ok(stored === head + '%C3%A9'.repeat(1300), 'stored percent-encoded');
    assert.equal(normalizeHref(head + 'é'.repeat(1400)), null, '1,400 é take 8,428 bytes once encoded');
    assert.equal(webLinkParts(head + 'é'.repeat(1400)), null, 'webLinkParts enforces the 8,192-byte limit after encoding');
    assert.deepEqual(checkHref(head + 'é'.repeat(1300), true), { problem: 'too_long', limit: 2048 });
  });
  it('keeps every other link to 2,048 bytes, counting its own characters', () => {
    assert.deepEqual(checkHref(`/notes/${'ü'.repeat(1000)}`), { href: `/notes/${'ü'.repeat(1000)}` });
    assert.deepEqual(checkHref(`/notes/${'ü'.repeat(1021)}`), { problem: 'too_long', limit: 2048 });
    assert.deepEqual(checkHref(`mailto:team@example.com?subject=${'a'.repeat(2048)}`), { problem: 'too_long', limit: 2048 });
    assert.deepEqual(checkHref(`#${'b'.repeat(2048)}`), { problem: 'too_long', limit: 2048 });
    assert.deepEqual(checkHref(`tel:+1${'5'.repeat(2048)}`), { problem: 'too_long', limit: 2048 });
  });
  it('keeps web links in suggestions to 2,048 bytes', () => {
    assert.deepEqual(checkHref(web(2048), true), { href: web(2048) });
    assert.deepEqual(checkHref(web(3000), true), { problem: 'too_long', limit: 2048 });
    assert.equal(normalizeHref(web(3000)), web(3000), 'outside suggestions it is a link');
  });
  it('tells a long text from one that is not a link', () => {
    assert.deepEqual(checkHref('just words'), { problem: 'not_link' });
    assert.deepEqual(checkHref(`  ${web(40000)}`), { problem: 'too_long', limit: 8192 });
    assert.deepEqual(checkHref(`/${'c'.repeat(40000)}`), { problem: 'too_long', limit: 2048 });
  });
  it('says which limit a long link went over', () => {
    const say = (input: string, suggesting = false) => {
      const checked = checkHref(input, suggesting);
      return 'href' in checked ? null : hrefProblem(checked, suggesting);
    };
    assert.equal(say(web(9000)), 'Web addresses can be at most 8,192 bytes long');
    assert.equal(say(`/files/${'d'.repeat(2100)}`), 'Links other than web addresses can be at most 2,048 bytes long');
    assert.equal(say(web(3000), true), 'Links in a suggestion can be at most 2,048 bytes long');
    assert.equal(say('not a link at all'), "That doesn't look like a link");
    assert.equal(say(web(3000)), null);
  });
});

describe('places in the doc', () => {
  const doc = nodes.doc!.create(null, [heading(1, 'Getting Started!', 'aa.1'), para('words', 'aa.2'), heading(2, 'Café menu', 'aa.3'), heading(2, '', 'aa.4')]);
  it('lists the headings with their slugs', () => {
    const headings = docHeadings(doc);
    assert.deepEqual(
      headings.map(item => [item.bid, item.level, item.text, item.slug]),
      [
        ['aa.1', 1, 'Getting Started!', 'getting-started'],
        ['aa.3', 2, 'Café menu', 'café-menu'],
      ],
    );
  });
  it('links a heading by id and slug, or by id when the slug is not plain', () => {
    assert.equal(headingHref('aa.1', 'Getting Started!'), '#aa.1~getting-started');
    assert.equal(headingHref('aa.3', 'Café menu'), '#aa.3');
    assert.equal(tabHref('0123abcd-4567'), '#0123abcd-4567');
  });
  it('reads in-doc links', () => {
    assert.deepEqual(parseDocHref('#aa.1~getting-started'), { block: 'aa.1', slug: 'getting-started' });
    assert.deepEqual(parseDocHref('#aa.1'), { block: 'aa.1' });
    assert.deepEqual(parseDocHref('#0123abcd-4567'), { tab: '0123abcd-4567' });
    assert.deepEqual(parseDocHref('#0123abcd-4567.aa.1~x'), { tab: '0123abcd-4567', block: 'aa.1', slug: 'x' });
    assert.deepEqual(parseDocHref('#Getting-Started'), { slug: 'getting-started' });
    assert.equal(parseDocHref('https://example.com'), null);
  });
  it('finds a block by id, else a heading by its slug', () => {
    assert.equal(findPlace(doc, { block: 'aa.2' }), doc.child(0).nodeSize);
    assert.equal(findPlace(doc, { block: 'gone.9', slug: 'getting-started' }), 0);
    assert.equal(findPlace(doc, { slug: 'nothing' }), null);
  });
  it('matches what is typed after # or /', () => {
    const headings = docHeadings(doc);
    const tabs = [{ id: '0123abcd-4567', name: 'Menu ideas' }];
    assert.equal(matchTargets('#', headings, tabs).headings.length, 2);
    assert.deepEqual(matchTargets('/get', headings, tabs).headings.map(item => item.bid), ['aa.1']);
    assert.deepEqual(matchTargets('#menu', headings, tabs), { headings: [headings[1]], tabs });
  });
});
