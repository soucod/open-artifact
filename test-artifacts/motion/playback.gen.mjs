#!/usr/bin/env node
// Rebuilds the two-scene Motion fixture used for playback, editing and export checks.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, 'playback');
const cli = join(here, '..', '..', 'artifact-types', 'motion', 'scripts', 'cli.mjs');
if (!existsSync(cli)) {
  console.error('No Motion CLI yet: run npm run build first.');
  process.exit(1);
}

const narrationId = 'e3a9502b94fe4c9bd4a3d2e07f83ead2';
const scenes = {
  v: 1,
  stage: 'final',
  width: 640,
  height: 360,
  fps: 24,
  background: '#f5efe6',
  palettes: [['#eef3f8', '#102033', '#51748c', '#2b5f8c']],
  scenes: [
    { id: 'intro', name: 'Intro', dur: 3, desc: 'Opening title and moving SVG shapes.' },
    { id: 'outro', name: 'Outro', dur: 2, desc: 'Closing title.' },
  ],
};

const css = `:root {
  --ground: #f5efe6;
  --main: #1c2430;
  --second: #4f8a5b;
  --accent: #d98a3d;
}
.wrap {
  width: 100%;
  height: 100%;
  display: grid;
  place-content: center;
  justify-items: center;
  background: var(--ground);
  color: var(--main);
  font: 600 28px system-ui;
}
.headline { margin: 12px; }`;

const intro = `let badge;
kit.scene('intro', {
  init(kit) {
    const wrap = kit.h(
      '<div class="wrap"><h1 class="headline">Hello motion</h1>' +
      '<svg aria-label="Moving shapes" viewBox="0 0 180 100" width="180" height="100">' +
      '<g class="badge"><rect x="10" y="20" width="64" height="50" rx="8" fill="var(--accent)"/>' +
      '<circle cx="110" cy="54" r="22" fill="var(--second)"/></g></svg></div>'
    );
    kit.stage.append(wrap);
    badge = wrap.querySelector('.badge');
  },
  render(t) {
    badge.setAttribute('transform', 'translate(' + (t * 12).toFixed(2) + ' 0)');
  },
});`;

const outro = `kit.scene('outro', {
  init(kit) {
    kit.stage.append(kit.h('<div class="wrap"><h1 class="headline">See you soon</h1></div>'));
  },
  render() {},
});`;

const score = `kit.score((S, T) => {
  S.program('test', 'marimba');
  S.note('test', 'C5', { t: 0, dur: 0.5, vel: 65 });
  S.note('test', 'E5', { t: T.outro, dur: 0.5, vel: 60 });
});`;

const narration = `kit.narration((T) => ({ lines: [
  { at: T.intro + 0.3, text: 'Motion playback test.', audio: 'narration', dur: 1.7 },
] }));`;

const docs = {
  'film/meta': { v: 1, title: 'Motion playback test' },
  'film/script': { code: 'window.CUT = kit.scenes();' },
  'modules/scenes.json': { kind: 'json', text: JSON.stringify(scenes) },
  'modules/base.css': { kind: 'css', text: css },
  'modules/scene-intro.js': { kind: 'js', text: intro },
  'modules/scene-outro.js': { kind: 'js', text: outro },
  'modules/score.js': { kind: 'js', text: score },
  'modules/narration.js': { kind: 'js', text: narration },
  'assets/narration': { ref: '/_blob/' + narrationId, mime: 'audio/mpeg' },
};

const db = join(root, 'db');
rmSync(db, { recursive: true, force: true });
for (const [doc, data] of Object.entries(docs)) {
  const file = join(db, doc + '.json');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data) + '\n');
}

process.exitCode = spawnSync(process.execPath, [cli, 'check', root], { stdio: 'inherit' }).status ?? 1;
