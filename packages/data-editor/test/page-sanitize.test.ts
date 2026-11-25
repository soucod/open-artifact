import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isAllowedPageScriptType,
  isInternalDashboardAttribute,
  isOneWriterAttr,
  isRemovedPageElement,
  isStrippedPageAttribute,
  lookupDashboardFile,
  pageFileName,
} from '../src/page/parse.ts';
import { getDashboardSourceUrl } from '../src/page/faults.ts';

describe('page sanitizing', () => {
  it('removes active and embedding elements, whatever their case', () => {
    for (const name of ['script', 'IFRAME', 'object', 'base', 'meta']) assert.equal(isRemovedPageElement(name), true, name);
    for (const name of ['div', 'svg', 'style', 'template']) assert.equal(isRemovedPageElement(name), false, name);
  });

  it('keeps forms: their submissions run the page’s listeners in place', () => {
    for (const name of ['form', 'FORM', 'input', 'button']) assert.equal(isRemovedPageElement(name), false, name);
  });

  it('strips event handlers and ping', () => {
    assert.equal(isStrippedPageAttribute('onclick'), true);
    assert.equal(isStrippedPageAttribute('ping'), true);
    assert.equal(isStrippedPageAttribute('data-source'), false);
  });

  it('runs only classic JavaScript scripts', () => {
    assert.equal(isAllowedPageScriptType(null), true);
    assert.equal(isAllowedPageScriptType(' Text/JavaScript '), true);
    assert.equal(isAllowedPageScriptType('module'), false);
    assert.equal(isAllowedPageScriptType('application/json'), false);
  });

  it('knows the attributes a one-writer page may write and the runtime own ones', () => {
    assert.equal(isOneWriterAttr('hidden'), true);
    assert.equal(isOneWriterAttr('aria-expanded'), true);
    assert.equal(isOneWriterAttr('data-source'), false);
    assert.equal(isInternalDashboardAttribute('data-dash-source-state'), true);
    assert.equal(isInternalDashboardAttribute('data-derived'), true);
    assert.equal(isInternalDashboardAttribute('data-source'), false);
  });

  it('finds page files by the name a src or href writes', () => {
    const files = new Map([['files/app.js', 'x']]);
    assert.equal(pageFileName(' ./files/app.js '), 'files/app.js');
    assert.equal(lookupDashboardFile(files, './files/app.js'), 'x');
    assert.equal(lookupDashboardFile(files, 'https://example.com/app.js'), undefined);
    assert.equal(getDashboardSourceUrl('files/app.js'), 'dash-page/files/app.js');
  });
});
