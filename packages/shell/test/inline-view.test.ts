import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { inlineView, pageAddress } from '../src/shell/model.ts';

describe('inline view', () => {
  const boot = { id: 'deck', page: 'http://localhost:8000/', type: 'slides' };
  const address = 'http://localhost:8100/a/deck';

  const dashboard = { id: 'sales', page: 'http://localhost:8001/', type: 'data' };
  const dashboardAddress = 'http://localhost:8100/a/sales';

  it('is the inline view only for a deck or a dashboard framed by another page', () => {
    assert.equal(inlineView(boot, address + '#view-inline', true), true);
    assert.equal(inlineView(dashboard, dashboardAddress + '#view-inline', true), true);
    assert.equal(inlineView(dashboard, dashboardAddress + '#view-inline', false), false);
    assert.equal(inlineView(dashboard, dashboardAddress, true), false);
    assert.equal(inlineView({ type: 'whiteboard' }, address + '#view-inline', true), false);
    assert.equal(inlineView(boot, address + '#view-inline', false), false);
    assert.equal(inlineView({ type: 'design' }, address + '#view-inline', true), false);
    assert.equal(inlineView(boot, address + '#slide-~7', true), false);
  });

  it('hands the inline fragment to the page only when the Shell is framed', () => {
    assert.equal(new URL(pageAddress(boot, address + '#view-inline', true)!).hash, '#view-inline');
    assert.equal(new URL(pageAddress(boot, address + '#view-inline')!).hash, '');
    assert.equal(new URL(pageAddress({ ...boot, type: 'design' }, address + '#view-inline', true)!).hash, '');
    assert.equal(new URL(pageAddress(boot, address + '#slide-~7', true)!).hash, '#slide-~7');
    assert.equal(new URL(pageAddress(dashboard, dashboardAddress + '#view-inline', true)!).hash, '#view-inline');
    assert.equal(new URL(pageAddress(dashboard, dashboardAddress + '#view-inline')!).hash, '');
    // A dashboard takes no other fragment from the Shell.
    assert.equal(new URL(pageAddress(dashboard, dashboardAddress + '#slide-~7', true)!).hash, '');
  });
});
