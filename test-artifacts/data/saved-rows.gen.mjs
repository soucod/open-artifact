#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(here, '../../artifact-types/data/scripts/cli.mjs');
const root = path.join(here, 'saved-rows');

if (!existsSync(cli)) {
  console.error('No data CLI yet: run npm run build first.');
  process.exit(1);
}

const html = `<main style="max-width: 42rem; margin: 2rem auto; padding: 0 1rem">
  <h1>Saved rows</h1>
  <p>Dashboard editors can add team notes. Everyone who can open this dashboard can read them.</p>
  <form id="note-form">
    <label>Team note <input name="note" required></label>
    <button type="submit">Add note</button>
  </form>
  <p role="status" id="save-status"></p>
  <h2>Team notes</h2>
  <ul id="notes" data-source="notes" data-draw="notes"></ul>
</main>
<script src="app.js"></script>
`;
const script = `document.getElementById('note-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.getElementById('save-status');
  try {
    const db = await openartifact.use('db');
    await db.add('data/team/notes', { note: form.elements.note.value });
    form.reset();
    status.textContent = 'Note saved';
  } catch (error) {
    status.textContent = 'Save failed: ' + error.message;
  }
});

dash.draw('notes', (list) => {
  const data = dash.data('notes');
  const rows = data.status === 'ok' ? data.data : [];
  list.replaceChildren(...rows.map((row) => {
    const item = document.createElement('li');
    item.textContent = row.note;
    return item;
  }));
});
`;
const docs = {
  'dash/meta': { title: 'Saved rows' },
  'datasets/notes': { title: 'Team notes', source: { kind: 'store', path: 'data/team/notes' } },
  'files/index.html': { text: html },
  'files/app.js': { text: script },
};
const writes = Object.entries(docs).map(([path, data]) => ({ op: 'set', path, data }));

rmSync(path.join(root, 'db'), { recursive: true, force: true });
execFileSync(process.execPath, [cli, 'write-db', root, '-'], { input: JSON.stringify(writes) });
execFileSync(process.execPath, [cli, 'check', root], { stdio: 'inherit' });
