import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Atom, ChipLookup, DocState, Inline } from '@open-artifact/docs-core';
import { chipCount, findCount } from '../src/docs/host.ts';

let next = 0;
const chars = (text: string): Inline[] => Array.from(text, ch => ({ id: `c${next++}`, ch }));
const atom = (kind: Atom['atom'], attrs: Record<string, unknown>): Atom => ({ id: `a${next++}`, atom: kind, attrs });
const tab = (...inline: Inline[][]): DocState => ({ rev: 1, blocks: inline.map((items, index) => ({ id: `b${index}`, type: 'paragraph', inline: items })) });

const lookup = (phase: string): ChipLookup => ({
  option: (list, index) => (list === 'e-phase' && index === 0 ? phase : null),
  tab: id => (id === '0a1b2c3d-4e5f' ? 'Field notes' : null),
  person: id => (id === 'u-1' ? 'Rosa' : null),
});

describe("counting a tab's matches for the find bar", () => {
  const doc = tab(
    [...chars('Harvest soon: '), atom('dropdown', { enum: 'e-phase', index: 0 }), ...chars(' and '), atom('dropdown', { enum: 'e-phase', index: null })],
    [atom('mention', { ref: 'file/0a1b2c3d-4e5f' }), ...chars(' · '), atom('mention', { ref: '0a1b2c3d-4e5f' }), ...chars(' · '), atom('mention', { principal: 'u-1' })],
    [atom('date', { ts: '2031-03-04' })],
  );

  it('counts the words in the text apart from the chips', () => {
    assert.equal(findCount(doc, 'harvest', false), 1);
    assert.equal(findCount(doc, 'field', false), 0);
  });

  it('counts each chip whose words hold the text once', () => {
    assert.equal(chipCount(doc, 'harvest', false, { lookup: lookup('Harvest harvest') }), 1);
    assert.equal(chipCount(doc, 'field', false, { lookup: lookup('Harvest') }), 2);
    assert.equal(chipCount(doc, '@rosa', false, { lookup: lookup('Harvest') }), 1);
    assert.equal(chipCount(doc, 'select', false, { lookup: lookup('Harvest') }), 0);
    assert.equal(chipCount(doc, '', false, { lookup: lookup('Harvest') }), 0);
  });

  it('reads an option as it is named now, and keeps to match case', () => {
    assert.equal(chipCount(doc, 'sowing', false, { lookup: lookup('Sowing') }), 1);
    assert.equal(chipCount(doc, 'sowing', true, { lookup: lookup('Sowing') }), 0);
    assert.equal(chipCount(doc, 'Sowing', true, { lookup: lookup('Sowing') }), 1);
  });

  it('reads a date chip the way the asking page writes dates', () => {
    assert.equal(chipCount(doc, 'mar', false, { lookup: lookup('Harvest'), dates: { locale: 'en-US', timeZone: 'UTC' } }), 1);
    assert.equal(chipCount(doc, 'märz', false, { lookup: lookup('Harvest'), dates: { locale: 'de-DE', timeZone: 'UTC' } }), 1);
  });
});
