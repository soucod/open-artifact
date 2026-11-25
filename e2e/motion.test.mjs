// End-to-end tests of the installed Motion type: CLI validation and write rules, live playback in Chrome,
// compact Properties / Theme inspector, panel toggle announcements, layer retouching and SVG group hide parts,
// standalone HTML export after an editor rebuild, the reload ask when a rebuild took away a part not loaded yet,
// Export dialog Escape, stray file-drop guard, and read-only inline iframe (#view-inline).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { pathToFileURL } from 'node:url';
import { findChrome, launch } from './lib/browser.mjs';
import { cli } from './lib/cli.mjs';
import { until } from './lib/http.mjs';
import { browserOff, install, removeTmp, tmpDir, typePath } from './lib/target.mjs';

const TYPE = 'motion';
const T = { timeout: 90_000 };
const browserSkip = browserOff || !findChrome();

function skip() {
  const dir = typePath(TYPE);
  if (!fs.existsSync(path.join(dir, 'SKILL.md'))) return `${TYPE} is not in ${dir}`;
  const missing = ['scripts/cli.mjs', 'scripts/editors/motion/index.html'].filter((f) => !fs.existsSync(path.join(dir, f)));
  return missing.length ? `${TYPE} is not built (npm run build): no ${missing.join(', ')}` : false;
}

const docPath = (root, doc) => path.join(root, 'db', `${doc}.json`);
const readDoc = (root, doc) => JSON.parse(fs.readFileSync(docPath(root, doc), 'utf8'));

function introSceneCode(extraShape = '') {
  return `kit.scene('intro', {
  init(kit) {
    const wrap = kit.h(
      '<div class="wrap">' +
      '<h1 class="headline">Hello motion</h1>' +
      '<svg class="art" viewBox="0 0 240 160" width="240" height="160">' +
      '<rect x="0" y="0" width="240" height="160" fill="none" stroke="#6b7280" stroke-width="2"/>' +
      '<g class="badge">' +
      '<rect x="10" y="10" width="100" height="60" rx="8" fill="#d98a3d"/>' +
      '<circle cx="160" cy="40" r="24" fill="#2b5f8c"/>' +
      '<polygon points="40,100 90,100 65,145" fill="#4f8a5b"/>' +
      '<line x1="120" y1="110" x2="220" y2="110" stroke="#1c2430" stroke-width="6"/>' +
      ${JSON.stringify(extraShape)} +
      '</g></svg></div>'
    );
    kit.stage.append(wrap);
  },
  render() {},
});`;
}

const OUTRO_SCENE = `kit.scene('outro', {
  init(kit) {
    kit.stage.append(kit.h('<div class="wrap"><h1 class="headline">See you soon</h1></div>'));
  },
  render() {},
});`;

const SCENES_JSON = {
  v: 1,
  stage: 'final',
  width: 1280,
  height: 720,
  fps: 30,
  background: '#f5efe6',
  fonts: { display: 'space-grotesk', sans: 'manrope' },
  palettes: [
    { name: 'Warm', colors: { bg: '#f5efe6', ink: '#1c2430', accent: '#d98a3d', muted: '#6b7280' } },
    { name: 'Cool', colors: { bg: '#eef3f8', ink: '#102033', accent: '#2b5f8c', muted: '#5a6b7c' } },
  ],
  scenes: [
    { id: 'intro', name: 'Intro', dur: 3, desc: 'Opening card with headline and badge.' },
    { id: 'outro', name: 'Outro', dur: 2, desc: 'Closing headline.' },
  ],
};

const BASE_CSS = `:root { --bg: #f5efe6; --ink: #1c2430; --accent: #d98a3d; --muted: #6b7280; }
.wrap { width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 28px; background: var(--bg); }
.headline { font-family: var(--font-display, sans-serif); font-size: 72px; color: var(--ink); margin: 0; }`;

describe(TYPE, { skip: skip() }, () => {
  let run, root, url, publicUrl, browser, page, editorAssets, downloads;

  before(async () => {
    const { dir } = install(typePath(TYPE), TYPE);
    const home = tmpDir('motion-home');
    editorAssets = path.join(dir, 'scripts', 'editors', TYPE, 'assets');
    downloads = path.join(home, 'Downloads');
    run = cli(dir, { HOME: home, OPEN_ARTIFACT_TYPE_SERVER_HOME: tmpDir('motion-state'), OPEN_ARTIFACT_USER: 'E2E' });
    root = path.join(tmpDir('motion-film'), 'film');
    ({ url: publicUrl } = await run.json(['open', root, '--type', TYPE, '--title', 'Smoke film', '--json']));
    const writes = [
      { op: 'set', path: 'film/meta', data: { v: 1, title: 'Smoke film', updatedAt: Date.now() } },
      { op: 'set', path: 'modules/scenes.json', data: { kind: 'json', text: JSON.stringify(SCENES_JSON) } },
      { op: 'set', path: 'modules/base.css', data: { kind: 'css', text: BASE_CSS } },
      { op: 'set', path: 'modules/scene-intro.js', data: { kind: 'js', text: introSceneCode() } },
      { op: 'set', path: 'modules/scene-outro.js', data: { kind: 'js', text: OUTRO_SCENE } },
      { op: 'set', path: 'modules/score.js', data: { kind: 'js', text: `kit.score((S) => {
        S.program('keys', 'marimba');
        S.note('keys', 'C5', { t: 0, dur: 0.5, vel: 65 });
      });` } },
      { op: 'set', path: 'film/script', data: { code: 'window.CUT = kit.scenes();' } },
    ];
    const wrote = await run.run(['write-db', root, JSON.stringify(writes)]);
    assert.equal(wrote.code, 0, wrote.stdout + wrote.stderr);
    url = new URL('index.html', publicUrl).href;
    if (!browserSkip) {
      browser = await launch();
      page = await browser.load(url, { ready: `document.querySelector('[data-video-transport] button[aria-label="Play"], [data-video-transport] button[aria-label="Pause"]')` });
    }
  });

  after(async () => {
    await browser?.close();
    await run?.run(['stop']).catch(() => {});
    removeTmp();
  });

  it('checks a valid film and refuses writing page-owned edit records', T, async () => {
    const checked = await run.run(['check', root, '--json']);
    assert.equal(checked.code, 0, checked.stdout + checked.stderr);
    assert.equal(checked.json.findings.filter((f) => f.level === 'error').length, 0);

    const refused = await run.run([
      'write-db',
      root,
      JSON.stringify([{ op: 'set', path: 'modules/retouched.json', data: { kind: 'json', text: '{"v":1,"layers":[]}' } }]),
    ]);
    assert.equal(refused.code, 1, refused.stdout);
    assert.ok(!fs.existsSync(docPath(root, 'modules/retouched.json')));
  });

  it('opens in compact inspector mode, announces Properties toggle, and switches palette under Theme', { ...T, skip: browserSkip }, async () => {
    assert.equal(await page.evaluate(`document.documentElement.hasAttribute('data-inspector-v1')`), true);

    await page.evaluate(`document.querySelector('button[aria-label="Properties"]').click()`);
    assert.ok(await page.waitFor(`document.querySelector('[data-video-panel]')`, 10_000));
    assert.ok(
      await page.waitFor(
        `[...document.querySelectorAll('[role="status"][aria-live]')].some((el) => /Properties(?: and Theme)? opened/.test(el.textContent || ''))`,
        10_000,
      ),
    );

    // Wait for Theme tab to appear once palettes are probed, then pick an alternate palette radio.
    assert.ok(await page.waitFor(`[...document.querySelectorAll('[data-video-panel] [role="tab"]')].some((t) => t.textContent?.trim() === 'Theme')`, 20_000));
    await page.evaluate(`[...document.querySelectorAll('[data-video-panel] [role="tab"]')].find((t) => t.textContent?.trim() === 'Theme').click()`);
    assert.ok(await page.waitFor(`document.querySelector('[data-video-panel] [role="radiogroup"] button[role="radio"][aria-checked="false"]')`, 20_000));
    await page.evaluate(`document.querySelector('[data-video-panel] [role="radiogroup"] button[role="radio"][aria-checked="false"]').click()`);

    assert.ok(await until(() => fs.existsSync(docPath(root, 'modules/recolored.json')), 15_000), 'recolored.json should be written');
    const recolored = JSON.parse(readDoc(root, 'modules/recolored.json').text);
    assert.ok(Array.isArray(recolored.colors) && recolored.colors.length >= 2, JSON.stringify(recolored));

    await page.evaluate(`document.querySelector('button[aria-label="Close panel"]').click()`);
    assert.ok(await page.waitFor(`!document.querySelector('[data-video-panel]')`, 10_000));
    assert.ok(
      await page.waitFor(
        `[...document.querySelectorAll('[role="status"][aria-live]')].some((el) => /Properties(?: and Theme)? closed/.test(el.textContent || ''))`,
        10_000,
      ),
    );
  });

  it('edits a text layer color and keeps a hidden SVG group hidden via parts across an in-place edit', { ...T, skip: browserSkip }, async () => {
    // Pause at scene 1 and open Properties.
    await page.evaluate(`(() => {
      const pause = document.querySelector('[data-video-transport] button[aria-label="Pause"]');
      if (pause) pause.click();
      const home = document.querySelector('[data-video-transport] button[aria-label="Back to start"]');
      if (home) home.click();
      if (!document.querySelector('[data-video-panel]')) document.querySelector('button[aria-label="Properties"]').click();
      const propsTab = [...document.querySelectorAll('[data-video-panel] [role="tab"]')].find((t) => t.textContent?.trim() === 'Properties');
      if (propsTab) propsTab.click();
    })()`);
    assert.ok(await page.waitFor(`document.querySelector('[data-layers-tree] [role="treeitem"]')`, 20_000));

    // Pick the Text layer and verify Text styles, Appearance and Animate sections appear.
    await page.evaluate(`[...document.querySelectorAll('[data-layers-tree] [role="treeitem"]')].find((r) => (r.getAttribute('aria-label') || '').includes('Hello motion')).click()`);
    assert.ok(await page.waitFor(`document.querySelector('[data-video-panel] button[aria-label^="Text color:"]')`, 15_000));
    const headings = await page.evaluate(`[...document.querySelectorAll('[data-video-panel] [data-ui-section-head] button')].map((b) => b.textContent?.trim())`);
    assert.ok(headings.includes('Text styles'), JSON.stringify(headings));
    assert.ok(headings.includes('Animate'), JSON.stringify(headings));

    // Change Text color via the ColorPicker hex field.
    await page.evaluate(`document.querySelector('[data-video-panel] button[aria-label^="Text color:"]').click()`);
    assert.ok(await page.waitFor(`document.querySelector('[role="dialog"] input[aria-label="Color value"]')`, 10_000));
    await page.evaluate(`(() => {
      const input = document.querySelector('[role="dialog"] input[aria-label="Color value"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, '#2244aa');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })()`);
    await page.press('Escape');

    assert.ok(
      await until(() => {
        if (!fs.existsSync(docPath(root, 'modules/retouched.json'))) return false;
        const rec = JSON.parse(readDoc(root, 'modules/retouched.json').text);
        return rec.layers.some((layer) => layer.ink?.v === '#2244aa');
      }, 15_000),
      'retouched.json should store ink #2244aa',
    );

    // Hide the SVG group (.badge) and confirm `parts` is saved.
    const hideSelector = `[data-layers-tree] [data-layer$="/g"] button[aria-label^="Hide "]`;
    assert.ok(
      await page.waitFor(`(() => {
        if (document.querySelector(${JSON.stringify(hideSelector)})) return true;
        for (const btn of document.querySelectorAll('[data-layers-tree] button[aria-label^="Expand "]')) btn.click();
        return Boolean(document.querySelector(${JSON.stringify(hideSelector)}));
      })()`, 10_000),
      'should find Hide button on SVG <g> layer',
    );
    await page.evaluate(`document.querySelector(${JSON.stringify(hideSelector)}).click()`);

    assert.ok(
      await until(() => {
        if (!fs.existsSync(docPath(root, 'modules/retouched.json'))) return false;
        const rec = JSON.parse(readDoc(root, 'modules/retouched.json').text);
        return rec.layers.some((layer) => layer.id.endsWith('/g') && layer.hidden?.v === 1 && typeof layer.parts === 'string');
      }, 15_000),
      'retouched.json should store hidden SVG group with parts',
    );

    // Edit the hidden <g> in place by adding a small shape: it must stay hidden via `parts`.
    const updated = await run.run([
      'write-db',
      root,
      JSON.stringify([{ op: 'set', path: 'modules/scene-intro.js', data: { kind: 'js', text: introSceneCode('<circle cx="200" cy="135" r="8" fill="#d98a3d"/>') } }]),
    ]);
    assert.equal(updated.code, 0, updated.stdout + updated.stderr);
    assert.ok(
      await page.waitFor(`(() => {
        for (const btn of document.querySelectorAll('[data-layers-tree] button[aria-label^="Expand "]')) btn.click();
        return document.querySelectorAll('[data-layers-tree] [data-layer$="/g"] button[aria-label^="Show "]').length > 0;
      })()`, 20_000),
    );
  });

  it('closes Export with Escape and blocks stray external file drops', { ...T, skip: browserSkip }, async () => {
    await page.evaluate(`document.querySelector('button[aria-label="Export"]').click()`);
    assert.ok(await page.waitFor(`document.querySelector('[role="dialog"]')`, 10_000));
    await page.press('Escape');
    assert.ok(await page.waitFor(`!document.querySelector('[role="dialog"]')`, 10_000));

    const dropResult = await page.evaluate(`(() => {
      const dt = { types: ['Files'], dropEffect: 'copy' };
      const event = new Event('dragover', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: dt });
      window.dispatchEvent(event);
      return { prevented: event.defaultPrevented, effect: dt.dropEffect };
    })()`);
    assert.deepEqual(dropResult, { prevented: true, effect: 'none' });
  });

  it('runs a framed #view-inline page as live and read-only while the top-level page stays editable', { ...T, skip: browserSkip }, async () => {
    assert.equal(await page.evaluate(`document.documentElement.hasAttribute('data-display-inline')`), false);
    const inlineResult = await page.evaluate(`(async () => {
      const frame = document.createElement('iframe');
      frame.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:400px;z-index:9999';
      frame.src = ${JSON.stringify(url + '#view-inline')};
      document.body.appendChild(frame);
      try {
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          const doc = frame.contentDocument;
          if (doc && doc.querySelector('[data-video-transport]')) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        const win = frame.contentWindow;
        const doc = frame.contentDocument;
        const user = await (await win.openartifact.use('user')).me();
        const db = await win.openartifact.use('db');
        let writeError = null;
        try {
          await db.write([{ op: 'update', path: 'film/meta', patch: { title: 'Blocked' } }]);
        } catch (err) {
          writeError = err?.code || String(err);
        }
        return {
          hasAttr: doc.documentElement.hasAttribute('data-display-inline'),
          role: user.role,
          writeError,
          commentsCap: await win.openartifact.use('comments'),
          agentCap: await win.openartifact.use('agent'),
          downloadsCap: await win.openartifact.use('downloads'),
          hasCommentsButton: !!doc.querySelector('button[aria-label="Comments"]'),
        };
      } finally {
        frame.remove();
      }
    })()`);
    assert.deepEqual(inlineResult, {
      hasAttr: true,
      role: 'viewer',
      writeError: 'not_granted',
      commentsCap: null,
      agentCap: null,
      downloadsCap: null,
      hasCommentsButton: false,
    });
    assert.equal(readDoc(root, 'film/meta').title, 'Smoke film');
    assert.deepEqual(page.problems.filter((p) => !p.includes('/favicon.ico')), []);
  });

  it('exports a playable HTML file with sound after the open editor loses its JavaScript files', { ...T, skip: browserSkip }, async () => {
    await page.evaluate(`document.querySelector('button[aria-label="Export"]').click()`);
    // Let the dialog finish its MP4 capability check, which uses a separate renderer.
    assert.ok(await page.waitFor(`(() => {
      const dialog = document.querySelector('[role="dialog"]');
      return dialog && !dialog.textContent.includes('Checking this browser');
    })()`, 10_000));
    await page.evaluate(`document.querySelector('[role="dialog"] button[aria-label="One HTML file that plays the animation offline"]').click()`);
    assert.ok(await page.waitFor(`document.querySelector('[role="dialog"] button[aria-label="One HTML file that plays the animation offline"][aria-pressed="true"]')`, 10_000));

    // A rebuild can replace the JavaScript files while this tab is still running the old editor.
    const scripts = fs.readdirSync(editorAssets).filter((name) => name.endsWith('.js'));
    const held = tmpDir('motion-editor-scripts');
    const moved = [];
    // Built files are kept for good: without this the browser could answer for the files a rebuild took away.
    await page.cdp('Network.setCacheDisabled', { cacheDisabled: true });
    try {
      for (const name of scripts) {
        fs.renameSync(path.join(editorAssets, name), path.join(held, name));
        moved.push(name);
      }
      await page.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find((button) => button.textContent.trim() === 'Export').click()`);
      assert.ok(await page.waitFor(`(() => {
        const dialog = document.querySelector('[role="dialog"]');
        return dialog?.textContent.includes('Exported Smoke film.html') || dialog?.textContent.includes('Try again');
      })()`, 10_000), 'the export dialog did not report a result');
      const status = await page.evaluate(`document.querySelector('[role="dialog"]').innerText`);
      assert.match(status, /Exported Smoke film\.html/, status);

      const file = path.join(downloads, 'Smoke film.html');
      const player = await browser.load(pathToFileURL(file).href, {
        ready: `typeof window.filmAudio === 'function' && !!document.querySelector('iframe')`,
      });
      try {
        assert.ok(await player.waitFor(`document.querySelector('.headline')?.textContent === 'Hello motion'`, 10_000));
        assert.deepEqual(player.problems, []);
      } finally {
        await player.close();
      }
    } finally {
      for (const name of moved) fs.renameSync(path.join(held, name), path.join(editorAssets, name));
      await page.cdp('Network.setCacheDisabled', { cacheDisabled: false });
    }
  });

  it('asks for a reload when a rebuild took away a part the open editor had not loaded yet', { ...T, skip: browserSkip }, async () => {
    // The GIF and video exports load the frame painter on demand; a rebuild that ran first has deleted it.
    const painters = fs.readdirSync(editorAssets).filter((name) => /^_virtual_motion-raster-frame-.*\.js$/.test(name));
    assert.ok(painters.length > 0, 'the build has no frame painter chunk');
    const held = tmpDir('motion-editor-painter');
    const moved = [];
    let fresh = null;
    try {
      for (const name of painters) {
        fs.renameSync(path.join(editorAssets, name), path.join(held, name));
        moved.push(name);
      }
      // A page that never loaded the painter: not one whose browser holds it from an earlier tab (built files are kept for good).
      fresh = await browser.load(url, {
        cache: false,
        ready: `document.querySelector('[data-video-transport] button[aria-label="Play"], [data-video-transport] button[aria-label="Pause"]')`,
        ignore: [/raster-frame/, /dynamically imported module/i],
      });
      await fresh.evaluate(`document.querySelector('button[aria-label="Export"]').click()`);
      assert.ok(await fresh.waitFor(`document.querySelector('[role="dialog"]')`, 10_000));
      await fresh.evaluate(`document.querySelector('[role="dialog"] button[aria-label="A GIF: no sound, plays in a loop"]').click()`);
      assert.ok(await fresh.waitFor(`document.querySelector('[role="dialog"] button[aria-label="A GIF: no sound, plays in a loop"][aria-pressed="true"]')`, 10_000));
      await fresh.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find((button) => button.textContent.trim() === 'Export').click()`);

      assert.ok(
        await fresh.waitFor(`document.querySelector('[role="dialog"]')?.textContent.includes('Reload the page, then export again')`, 10_000),
        await fresh.evaluate(`document.querySelector('[role="dialog"]')?.innerText ?? 'no dialog'`),
      );
      const buttons = await fresh.evaluate(`[...document.querySelectorAll('[role="dialog"] button')].map((button) => button.textContent.trim())`);
      assert.ok(buttons.includes('Reload'), JSON.stringify(buttons));
      assert.ok(!buttons.includes('Try again'), JSON.stringify(buttons));
      assert.equal(
        await fresh.evaluate(`[...document.querySelectorAll('[data-tone="warning"]')].some((notice) => notice.textContent.includes('The editor was updated') && [...notice.querySelectorAll('button')].some((button) => button.textContent.trim() === 'Reload'))`),
        true,
      );
    } finally {
      await fresh?.close();
      for (const name of moved) fs.renameSync(path.join(held, name), path.join(editorAssets, name));
    }
  });
});
