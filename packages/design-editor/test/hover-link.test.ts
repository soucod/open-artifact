import assert from 'node:assert/strict';
import { it } from 'node:test';
import { parseTemplate } from '@open-artifact/dc';
import { linkAround, openableLink, shownLink } from '../src/lib/hover-link.ts';

const model = parseTemplate(
  '<div><a href=" https://example.com/docs?ref=1 "><img src="a.png"></a><a href=""><span>x</span></a><img src="b.png"><a href="Other.dc.html"><b>go</b></a></div>',
);
const tidOf = (match: (tag: string, src: string | undefined) => boolean) =>
  model.elements.findIndex((element) => match(element.tag, element.attrs.find((attr) => attr.name === 'src')?.value ?? undefined));

it('finds the link an element sits in, or none', () => {
  assert.equal(linkAround(model, tidOf((tag, src) => tag === 'img' && src === 'a.png')), 'https://example.com/docs?ref=1');
  assert.equal(linkAround(model, tidOf((tag, src) => tag === 'img' && src === 'b.png')), null);
  assert.equal(linkAround(model, tidOf((tag) => tag === 'span')), null, 'an empty href is no link');
  assert.equal(linkAround(model, tidOf((tag) => tag === 'b')), 'Other.dc.html');
  assert.equal(linkAround(model, 0), null);
  assert.equal(linkAround(model, 999), null);
});

it('opens web and mail links only, and shows them short', () => {
  assert.equal(openableLink('https://example.com'), 'https://example.com');
  assert.equal(openableLink('mailto:a@b.c'), 'mailto:a@b.c');
  assert.equal(openableLink('Other.dc.html'), null);
  assert.equal(openableLink('javascript:alert(1)'), null);
  assert.equal(shownLink('https://example.com/docs/?ref=1'), 'example.com/docs');
  assert.equal(shownLink('Other.dc.html'), 'Other.dc.html');
});
