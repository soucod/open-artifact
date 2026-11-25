import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_LINK_LENGTH, isWebLink, normalizeTypedLink } from '../src/lib/link-card.ts';

describe('link card addresses', () => {
  it('adds https to a typed host and lowers the scheme', () => {
    assert.equal(normalizeTypedLink('  example.com/docs '), 'https://example.com/docs');
    assert.equal(normalizeTypedLink('HTTPS://Example.com/A'), 'https://Example.com/A');
    assert.equal(normalizeTypedLink('//cdn.example.com/x'), 'https://cdn.example.com/x');
    assert.equal(normalizeTypedLink('localhost:5173/page'), 'https://localhost:5173/page');
    assert.equal(normalizeTypedLink('MAILTO:team@example.com'), 'mailto:team@example.com');
  });

  it('keeps project paths relative and encodes what would break the Markdown', () => {
    assert.equal(normalizeTypedLink('components/Button/README.md'), 'components/Button/README.md');
    assert.equal(normalizeTypedLink('README.md'), 'README.md');
    assert.equal(normalizeTypedLink('guides/Brand voice.md'), 'guides/Brand%20voice.md');
    assert.equal(normalizeTypedLink('https://example.com/a_(b)'), 'https://example.com/a_%28b%29');
    assert.equal(normalizeTypedLink('https://example.com/[x]'), 'https://example.com/%5Bx%5D');
  });

  it('refuses empty, unsafe, spaced or overlong web addresses', () => {
    assert.equal(normalizeTypedLink('   '), null);
    assert.equal(normalizeTypedLink('javascript:alert(1)'), null);
    assert.equal(normalizeTypedLink('data:text/html,hi'), null);
    assert.equal(normalizeTypedLink('https://exa mple.com'), null);
    assert.equal(normalizeTypedLink('https:nohost'), null);
    assert.equal(normalizeTypedLink('https://example.com/' + 'a'.repeat(MAX_LINK_LENGTH)), null);
  });

  it('tells web and mail addresses from project paths', () => {
    assert.ok(isWebLink('HTTPS://x.y') && !isWebLink('README.md'));
    assert.ok(isWebLink('mailto:a@example.com'));
  });
});
