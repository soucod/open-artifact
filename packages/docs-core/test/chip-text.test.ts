import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type ChipLookup, chipText, shownDate, tabOfRef } from '../src/chip-text.ts';

const lookup: ChipLookup = {
  option: (list, index) => (list === 'e-colour' ? (['Teal', 'Amber'][index] ?? null) : null),
  tab: id => (id === '0a1b2c3d-4e5f' ? 'Budget' : null),
  person: id => (id === 'u-1' ? 'Rosa' : null),
};
const en = { locale: 'en-US', timeZone: 'UTC' };
const june = new Date('2031-06-01T12:00:00Z');

describe('the words a chip shows', () => {
  it('writes a date as month and day, with the year only when it is not this year', () => {
    assert.equal(shownDate('2031-03-04', en, june), 'Mar 4');
    assert.equal(shownDate('2029-03-04', en, june), 'Mar 4, 2029');
    assert.equal(shownDate('2031-03-04', { locale: 'de-DE', timeZone: 'UTC' }, june), '4. März');
  });

  it('keeps a bare day the same day in every time zone, and a moment in the viewer’s zone', () => {
    assert.equal(shownDate('2031-03-04', { locale: 'en-US', timeZone: 'Pacific/Honolulu' }, june), 'Mar 4');
    assert.equal(shownDate('2031-03-04T02:00:00Z', { locale: 'en-US', timeZone: 'America/New_York' }, june), 'Mar 3');
  });

  it('drops a locale or time zone Intl does not know rather than failing', () => {
    assert.equal(shownDate('2031-03-04', { locale: 'en-US', timeZone: 'Nowhere/Else' }, june), 'Mar 4');
    assert.match(shownDate('2031-03-04', { locale: '!!', timeZone: 'UTC' }, june), /4/);
  });

  it('reads a dropdown option by list and index, and nothing when none is picked', () => {
    assert.equal(chipText('dropdown', { enum: 'e-colour', index: 1 }, lookup), 'Amber');
    assert.equal(chipText('dropdown', { enum: 'e-colour', index: null }, lookup), null);
    assert.equal(chipText('dropdown', { enum: 'e-gone', index: 0 }, lookup), null);
  });

  it('reads a tab link as the tab’s name now, whichever way its ref is written', () => {
    assert.equal(tabOfRef('file/0a1b2c3d-4e5f'), '0a1b2c3d-4e5f');
    assert.equal(tabOfRef('0a1b2c3d-4e5f'), '0a1b2c3d-4e5f');
    assert.equal(tabOfRef('somewhere'), null);
    assert.equal(chipText('mention', { ref: 'file/0a1b2c3d-4e5f', label: 'Old name' }, lookup), 'Budget');
    assert.equal(chipText('mention', { ref: '0a1b2c3d-4e5f' }, lookup), 'Budget');
    assert.equal(chipText('mention', { ref: 'file/99999999-0000', label: 'Removed' }, lookup), 'Removed');
  });

  it('reads a person as @ and their name, and nothing for nobody', () => {
    assert.equal(chipText('mention', { principal: 'u-2', name: 'Ines' }, lookup), '@Ines');
    assert.equal(chipText('mention', { principal: 'u-1' }, lookup), '@Rosa');
    assert.equal(chipText('mention', { principal: 'agent', name: 'Agent' }, lookup), '@Agent');
    assert.equal(chipText('mention', { principal: 'u-9' }, lookup), null);
    assert.equal(chipText('mention', { ref: 'team/ops' }, lookup), '@team/ops');
    assert.equal(chipText('date', {}, lookup), null);
  });
});
