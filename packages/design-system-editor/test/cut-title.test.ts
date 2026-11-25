import assert from 'node:assert/strict';
import { it } from 'node:test';
import { titleWhenCut, type CutTextElement } from '../src/lib/cut-title.ts';

it('a cut-off label shows its full text on hover, and a label that fits shows none', () => {
  const label: CutTextElement = { scrollWidth: 240, clientWidth: 120, textContent: '--color-surface-elevated-strong', title: '', removeAttribute(name) { if (name === 'title') this.title = ''; } };
  titleWhenCut(label);
  assert.equal(label.title, '--color-surface-elevated-strong');
  label.clientWidth = 300;
  titleWhenCut(label);
  assert.equal(label.title, '');
});
