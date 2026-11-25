// Driving a cloud host's pages in Chrome the way a person does (the real mouse and keyboard), and looking inside the
// framed artifact page on its own content origin. The same moves as `e2e/host.test.mjs`, for the hosts' other tests.
import assert from 'node:assert/strict';

/** The middle of the element `selector` (an expression) finds, scrolled into view; null when there is none. */
export const centerOf = selector =>
  `(() => { const e = ${selector}; if (!e) return null; e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`;

/** Click the element `selector` finds with the real mouse, once it is there. */
export async function clickOn(page, selector, what = selector) {
  assert.ok(await page.waitFor(selector, 15000), `nothing to click: ${what}`);
  const at = await page.evaluate(centerOf(selector));
  assert.ok(at, `nothing to click: ${what}`);
  await page.click(...at);
}

/** A button (or menu item, or link) by the start of its text, the last one shown. */
export const byText = (text, scope = 'document') =>
  `[...${scope}.querySelectorAll('button,[role=menuitem],[role=menuitemradio],a')].reverse().find(e => e.textContent.trim().startsWith(${JSON.stringify(text)}) && e.getClientRects().length)`;

/** Whether a frame is the artifact's page on its content origin (`<type>/<token>/`). */
export const FRAMED_PAGE = "location.hostname.endsWith('.content.localhost') && /\\/[a-z-]+\\/v1\\.[^/]+\\/$/.test(location.pathname)";

/**
 * Run `body` (an async function's source taking the page's own base URL) in the framed page: its value, or undefined
 * when no frame is the artifact's page. A framed page that went away while `body` ran (the page reloaded or navigated)
 * is looked for once more; if it goes away again, the error says so, as it does when a frame's renderer crashed.
 */
export async function inFrame(page, body) {
  const expression = `${FRAMED_PAGE} ? (${body})(location.origin + location.pathname) : undefined`;
  for (let attempt = 1; ; attempt++) {
    const { values, detached } = await page.evaluateFrames(expression);
    const value = values.find(v => v !== undefined);
    if (value === undefined && page.crashedFrames?.length) throw new Error(`no framed page to ask: ${page.crashedFrames.join('; ')}`);
    if (value !== undefined || detached.length === 0) return value;
    if (attempt === 2) throw new Error(detached[0]);
  }
}

/** What the framed page may do now: its session's role (or the status), whether a comment and an edit are taken. */
export const abilities = page =>
  inFrame(
    page,
    `async (base) => {
      const session = await fetch(base + '_api/session');
      const role = session.ok ? (await session.json()).viewer.role : 'refused ' + session.status;
      const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.status);
      const comment = await post('_api/comments/create', { input: { anchor: '{"element":"e1"}', label: 'Note', text: 'From the e2e' } });
      const edit = await post('_api/db/write', { client: 'e2e', writes: [{ op: 'set', path: 'elements/e2e-' + Date.now(), data: { type: 'note', x: 0, y: 0, text: 'Hi', color: 'yellow' } }] });
      return { role, comment, edit };
    }`,
  );

/** Writes a sticky note `id` with `text` from the framed page (its own token): the status. */
export const writeNote = (page, id, text, at = [60, 60]) =>
  inFrame(
    page,
    `async (base) => (await fetch(base + '_api/db/write', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client: 'e2e-${id}', writes: [{ op: 'set', path: 'elements/${id}', data: { type: 'note', x: ${at[0]}, y: ${at[1]}, w: 220, h: 120, text: ${JSON.stringify(text)}, color: 'yellow' } }] }) })).status`,
  );

/** The framed page's comments layer (its shadow root), where the board draws its comment composer. */
export const LAYER = "document.querySelector('[data-comment-layer]')?.shadowRoot";
/** The composer's text box has the focus. */
export const COMPOSER_TEXTAREA = `${LAYER}?.activeElement?.matches('textarea[aria-label=Comment]')`;
/** The composer's "Send to <agent>" box (`layer`: the comments layer). */
export const SEND_BOX = "[...layer.querySelectorAll('[data-comment-card] [role=checkbox]')].find(e => /^Send to /.test(e.textContent.trim()))";

/** `expression` (which may use `layer`) evaluated in the framed page that has a comments layer. */
export const inFrameLayer = (page, expression) =>
  page.evaluateAll(`(() => { const layer = ${LAYER}; return layer ? (${expression}) : undefined; })()`).then(values => values.find(v => v !== undefined));

/** Clicks, with the real mouse, the element `selector` (using `layer`) finds in the framed page's comments layer. */
export async function clickInFrame(page, selector, what) {
  const inner = await inFrameLayer(page, `(() => { const e = ${selector}; if (!e) return null; const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  assert.ok(inner, `nothing to click: ${what}`);
  const frame = await page.evaluate("(() => { const r = document.querySelector('iframe').getBoundingClientRect(); return [r.left, r.top]; })()");
  await page.click(frame[0] + inner[0], frame[1] + inner[1]);
}

/** The value of a cookie the browser holds for `url` (the page's DevTools session). */
export async function cookieOf(page, url, name) {
  const { cookies } = await page.cdp('Network.getCookies', { urls: [url] });
  return cookies.find(c => c.name === name)?.value ?? null;
}
