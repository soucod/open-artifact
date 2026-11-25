import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SHORTCUT_GROUPS, keyLabel } from '../src/topbar/shortcuts.ts';
import { cleanDocName, defaultPaper, exportedTitle, exportFailure, notesText, otherNotes, printToPdfWords } from '../src/topbar/words.ts';

describe('key labels', () => {
  it('writes chords the platform’s way', () => {
    assert.equal(keyLabel('Mod-Alt-1', true), '⌘⌥1');
    assert.equal(keyLabel('Mod-Alt-1', false), 'Ctrl+Alt+1');
    assert.equal(keyLabel('Mod-Shift-z', true), '⌘⇧Z');
    assert.equal(keyLabel('Alt-Enter', false), 'Alt+Enter');
    assert.equal(keyLabel('Mod-]', false), 'Ctrl+]');
    assert.equal(keyLabel('?', true), '?');
  });

  it('lists each shortcut once per group, with keys', () => {
    for (const group of SHORTCUT_GROUPS) {
      assert.ok(group.rows.length > 0, group.title);
      const labels = group.rows.map(row => `${row.label}${row.where ?? ''}`);
      assert.equal(new Set(labels).size, labels.length, group.title);
      for (const row of group.rows) assert.ok(row.keys.length > 0, row.label);
    }
  });
});

describe('export', () => {
  it('picks Letter where it is the usual paper', () => {
    assert.equal(defaultPaper(['en-US']), 'letter');
    assert.equal(defaultPaper(['fr-CA', 'en']), 'letter');
    assert.equal(defaultPaper(['en-GB']), 'a4');
    assert.equal(defaultPaper(['zh-CN']), 'a4');
    assert.equal(defaultPaper([]), 'a4');
  });

  it('says what a file could not carry over, in either note shape', () => {
    assert.equal(notesText([]), undefined);
    assert.equal(notesText([{ code: 'kept_as_text', what: 'image (not available here)', count: 2 }]), 'In the file: 2 × image (not available here) kept as text.');
    assert.equal(notesText([{ code: 'other', message: 'Word comment, left out' }]), 'In the file: Word comment, left out.');
  });
});

describe('renaming', () => {
  it('saves one trimmed line', () => {
    assert.equal(cleanDocName('  Plan\nfor 2027 '), 'Plan for 2027');
    assert.equal(cleanDocName(' \n '), '');
  });
});

describe('export words', () => {
  it('tells the person to pick "Save as PDF" in the print dialog, in Chinese for a Chinese browser', () => {
    assert.match(printToPdfWords(['en-US']).description, /“Save as PDF”/);
    assert.match(printToPdfWords(['zh-CN', 'en']).description, /“另存为 PDF”/);
    assert.match(printToPdfWords([]).title, /Print to PDF/);
    assert.match(exportFailure('pdf', 'doc', 'no_print'), /print dialog/);
  });

  it('titles the file, naming the pictures it came without', () => {
    assert.equal(exportedTitle('pdf'), 'Exported as a PDF');
    assert.equal(exportedTitle('docx', [{ code: 'kept_as_text', what: 'image (not available here)', count: 2 }]), 'Exported as Word without 2 images');
    assert.equal(
      exportedTitle('pdf', [
        { code: 'kept_as_text', what: 'image (not available here)', count: 1 },
        { code: 'kept_as_text', what: 'embed snapshot (not drawn here)', count: 3 },
      ]),
      'Exported as a PDF without 1 image and 3 charts or diagrams',
    );
    assert.deepEqual(otherNotes([{ code: 'dropped', what: 'pending section', count: 1 }, { code: 'kept_as_text', what: 'image (x)', count: 1 }]), [{ code: 'dropped', what: 'pending section', count: 1 }]);
  });
  it('says why an export failed by its code', () => {
    assert.match(exportFailure('pdf', 'tab', 'no_chrome'), /Chrome/);
    assert.equal(exportFailure('docx', 'tab', 'no_node'), 'This tab can’t be exported.');
    assert.equal(exportFailure('markdown', 'doc', 'weird'), 'Couldn’t export this document as Markdown. Try again in a moment.');
    // A refusal says the host's own words, or a plain one without them.
    assert.equal(exportFailure('docx', 'doc', 'not_writer', 'The owner has not let viewers download or export this artifact.'), 'The owner has not let viewers download or export this artifact.');
    assert.equal(exportFailure('pdf', 'doc', 'not_granted'), 'You can’t export this document.');
  });
});
