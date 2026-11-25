/**
 * What a cloud host's plugins add to the pages (`cloud.site`) as the Shell and home page read it: plain labels and
 * safe addresses only, by place, and carried by the home page's boot.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { homeBootOf, leavesSite, siteLinks, siteUiOf } from '../src/lib/cloud.ts';

test('siteUiOf keeps labelled links to a path here or an http(s) address, and the brand; drops the rest', () => {
  assert.equal(siteUiOf(undefined), undefined);
  assert.equal(siteUiOf({ links: [] }), undefined);
  const site = siteUiOf({
    links: [
      { label: 'Help', href: 'https://help.example.com/', where: 'account-menu' },
      { label: 'Policy', href: '/plugins/p/policy', where: 'home' },
      { label: 'Script', href: 'javascript:alert(1)', where: 'home' },
      { label: 'Other host', href: '//evil.example/', where: 'home' },
      { label: 'Nowhere', href: '/x', where: 'footer' },
      { label: '', href: '/x', where: 'home' },
      { label: 'Line\nbreak', href: '/x\n', where: 'home' },
    ],
    brand: { name: '  Acme  ', logoUrl: 'data:image/png;base64,AAAA' },
  });
  assert.deepEqual(site, {
    links: [
      { label: 'Help', href: 'https://help.example.com/', where: 'account-menu' },
      { label: 'Policy', href: '/plugins/p/policy', where: 'home' },
    ],
    brand: { name: 'Acme' },
  });
  assert.deepEqual(siteLinks(site, 'home'), [{ label: 'Policy', href: '/plugins/p/policy' }]);
  assert.deepEqual(siteLinks(site, 'account-menu'), [{ label: 'Help', href: 'https://help.example.com/' }]);
  assert.deepEqual(siteLinks(undefined, 'home'), []);
});

test('leavesSite: a path stays; another origin leaves', () => {
  assert.equal(leavesSite('/plugins/x', 'https://a.example'), false);
  assert.equal(leavesSite('https://a.example/x', 'https://a.example'), false);
  assert.equal(leavesSite('https://b.example/x', 'https://a.example'), true);
});

test("the home page's boot carries the site's additions, checked", () => {
  const boot = homeBootOf({ cloud: { user: null, appOrigin: 'https://a.example', signInUrl: '/in', signOutUrl: '/out', site: { brand: { name: 'Acme' }, links: [{ label: 'x', href: 'javascript:1', where: 'home' }] } } });
  assert.deepEqual(boot.cloud?.site, { brand: { name: 'Acme' } });
  assert.equal(homeBootOf({ cloud: { user: null, appOrigin: 'https://a.example', signInUrl: '/in', signOutUrl: '/out' } }).cloud?.site, undefined);
});
