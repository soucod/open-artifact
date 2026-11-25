import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { IMPORT_FILE_ACCEPT, importPrompt, importSelection, importedFileKind, type ImportedFile } from '../src/imports.ts';

describe('imported files', () => {
  it('tells a file’s kind by its name first, then by its media type', () => {
    assert.equal(importedFileKind('Sales.XLSX'), 'workbook');
    assert.equal(importedFileKind('old.xls'), 'workbook');
    assert.equal(importedFileKind('users.csv', 'application/vnd.ms-excel'), 'csv');
    assert.equal(importedFileKind('rows.tab'), 'tsv');
    assert.equal(importedFileKind('shapes.geojson'), 'json');
    assert.equal(importedFileKind('export', 'text/csv; charset=utf-8'), 'csv');
    assert.equal(importedFileKind('book', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), 'workbook');
    assert.equal(importedFileKind('notes.txt', 'text/plain'), null);
    assert.equal(importedFileKind('photo.png', 'image/png'), null);
  });

  it('offers CSV, Excel and JSON in the picker', () => {
    for (const ext of ['.csv', '.tsv', '.json', '.xlsx', '.xls']) assert.ok(IMPORT_FILE_ACCEPT.split(',').includes(ext), ext);
  });

  const files: ImportedFile[] = [
    { name: 'Q3 sales.xlsx', url: '/_blob/' + 'a'.repeat(32), kind: 'workbook' },
    { name: 'users.csv', url: '/_blob/' + 'b'.repeat(32), kind: 'csv' },
  ];

  it('asks for the picked format, naming each upload and how a workbook comes in', () => {
    const prompt = importPrompt('scroll-story', files);
    assert.match(prompt, /^Build this dashboard as a Scrollyteller from the files I imported: /);
    assert.ok(prompt.includes(`"Q3 sales.xlsx" at /_blob/${'a'.repeat(32)} (Excel workbook)`));
    assert.ok(prompt.includes(`"users.csv" at /_blob/${'b'.repeat(32)} (CSV)`));
    assert.match(prompt, /each sheet you use from a workbook uploaded as its own CSV/);
    assert.doesNotMatch(importPrompt('dashboard', [files[1]!]), /workbook/);
  });

  it('falls back to the default format for an unknown one', () => {
    assert.match(importPrompt('poster', [files[1]!]), /as a Dashboard from the file I imported/);
    const selection = importSelection('poster', [files[1]!]);
    assert.equal(selection.chip.form, 'dashboard');
    assert.equal(selection.label, 'Import users.csv');
  });

  it('carries the format and the uploads as data', () => {
    const selection = importSelection('visual-short', files);
    assert.equal(selection.label, 'Import 2 files');
    assert.deepEqual(selection.chip, { about: 'import', form: 'visual-short', files });
    assert.match(selection.text, /Visual short \(visual-short\)/);
  });
});
