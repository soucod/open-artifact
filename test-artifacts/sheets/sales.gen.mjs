#!/usr/bin/env node
// Rebuilds the sales workbook for manual Sheets testing.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, '../../artifact-types/sheets/scripts/cli.mjs');
if (!existsSync(cli)) {
  console.error('No Sheets CLI yet: run npm run build first.');
  process.exit(1);
}

const root = path.join(here, 'sales');
const staged = mkdtempSync(path.join(here, '.sales-'));
const run = (command, ...args) => execFileSync(process.execPath, [cli, command, staged, ...args], { stdio: 'inherit' });
try {
  run('update', JSON.stringify({
    kind: 'applyEdits',
    base: 1,
    edits: [
      { kind: 'renameSheet', sheet: 'Sheet1', name: 'Sales' },
      { kind: 'writeCells', sheet: 'Sales', topLeft: 'A1', rows: [
        ['Item', 'Amount', 'Region'],
        ['Notebook', 120, 'North'],
        ['Pen', 45, 'South'],
        ['Folder', 75, 'North'],
        ['Total', '=SUM(B2:B4)', null],
      ] },
      { kind: 'setCellTable', sheet: 'Sales', cellTable: { columns: 'A:C', headerRows: '1', footerRows: '5' } },
      { kind: 'addSheet', name: 'Summary' },
      { kind: 'writeCells', sheet: 'Summary', topLeft: 'A1', rows: [['Sales total', '=Sales!B5']] },
    ],
  }));

  const metaFile = path.join(staged, 'sheet', 'sheet.json');
  const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
  meta.title = 'Sales workbook';
  writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`);
  run('check');

  mkdirSync(root, { recursive: true });
  const sheetDir = path.join(root, 'sheet');
  rmSync(sheetDir, { recursive: true, force: true });
  renameSync(path.join(staged, 'sheet'), sheetDir);
} finally {
  rmSync(staged, { recursive: true, force: true });
}
