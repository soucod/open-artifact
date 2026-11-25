# Recreating the user's UI — lift it, don't redraw it

When the film shows the user's product, the stills must pass for
screenshots. That only happens when the UI in the film IS their UI: its
element tree, its compiled CSS, its tokens, its icons, its copy — pruned
to what the camera sees. You are far better at recreating an interface
from code than from memory or a screenshot, so when the source is
reachable (their repo, a pasted component, a design file, a running
build), read it and build from it; screenshots are for checking, not for
measuring. It has to be THEIR product or an original design.

## 1. Find the real thing

- Ask where it lives: a repo path, a dev server or deployed URL you can
  reach, a Storybook, a design file or exported HTML, screenshots as a
  last resort. Start from what is visible: grep the code for the exact
  strings on screen (placeholder text, menu labels, button titles), walk
  up to the component that renders them and down through everything it
  composes. Note the page/route component too — it sets widths, gutters
  and the split between panes.
- Collect, with file:line so you can re-check: the component tree for
  each surface; the design tokens actually referenced (CSS custom
  properties → hex, including alpha greys for hairlines and hover
  washes); font stacks and the type scale (and get the font FILES — they
  become assets); the icon set and the icon names used; radii, paddings,
  gaps, shadows, border colors; the real copy (i18n files included);
  state variants (hover, selected, loading, streaming, disabled) and
  what toggles them.
- Prefer the variant real users see today (feature flags default off
  unless the brief is about the flagged thing). If two shells exist,
  ask which in the intake message.
- **Keep notes of your sources** in a scratch file outside the film's
  folder, never in its store: per surface, the component files
  (file:line), the token file, the icon names, the copy source, and
  every value you could NOT lift (marked "approx", with what you did
  instead). The hand-off caveats read from it.

## 2. Lift it — two routes

**A. A rendered copy is reachable** (a dev server, Storybook, a deployed
page, an exported design artboard, an HTML mock): drive it headless into
the state you need (stub the flag or the response that unlocks it), then
lift markup, CSS and numbers in one go. Keep class names verbatim.
Highest fidelity, cheapest:

```js
// with a headless browser you already have (Playwright, for one): point it at the page and the subtree you need
await page.coverage?.startCSSCoverage?.();                    // Chromium: which rules actually apply
await page.goto(url); await page.waitForSelector(sel);
const html = await page.$eval(sel, (n) => n.outerHTML);
const css = await page.evaluate(() => [...document.styleSheets].flatMap((s) => { try { return [...s.cssRules].map((r) => r.cssText); } catch { return []; } }).join('\n'));
const used = await page.coverage?.stopCSSCoverage?.();         // ranges → keep only used rules when pruning
const probe = await page.$eval(sel + ' [data-testid], ' + sel + ' button', (ns) => ns.slice(0, 12).map((n) => { const c = getComputedStyle(n), r = n.getBoundingClientRect(); return [n.className, r.width, r.height, c.fontSize, c.fontWeight, c.borderRadius, c.padding, c.color, c.backgroundColor]; }));
```

Write `probe` into your notes: those are the numbers you check your
close-ups against later.

**B. Source only**: rebuild the markup by hand FROM the JSX/templates —
the same element nesting, the same class strings, the same inline
styles — and GENERATE its CSS rather than remembering it: for
utility-class repos run the project's own CSS build over your lifted
markup (e.g. its Tailwind config with `content` pointed at your module
files) and keep the output; for CSS modules / vanilla-extract / plain
stylesheets copy the compiled rules from the package's build output or
source; read custom properties from the token files and define them
verbatim at the top of your module. Copy exact numbers; never round to
a 4/8 px grid or substitute a framework default. Where the source
computes a size (a column clamp, a `calc()`), keep the formula.

Either way the product keeps its identity: its accent color, its
neutral buttons, its own spacing. The film's display type, accent and
lively motion belong to the cards and shapes around it, not inside
product chrome.

## 3. Make it film-ready

- **Strip behavior**: no `<script>`, handlers, iframes, external
  `src`/`href`/`url()`; a product video becomes a clip asset. Product imagery becomes film assets
  (`assets/…`, referenced through `kit.assets.url(name)`) or inline SVG.
- **Fonts**: ship the product's faces as font assets (a Google family, in a film of scenes: a slot of `fonts`, rough-cut.md's `fonts`) and map its
  families onto them with a few override rules at the end of your module
  (`--font-ui: "BrandSans-500"`); a look-alike face is the first thing
  that reads "mock". **Icons**: product chrome is half icons, and a wrong
  stroke weight is the second; inline the real SVG paths (or the icon
  font as an asset) — never emoji or a look-alike.
- **Prune** the CSS to rules that match something on screen (a coverage
  pass in a headless page, or by hand from the class list) — a lifted
  app stylesheet is 400 KB+, a pruned scene is 30–150 KB. Keep
  `@font-face` out (assets register themselves); keep keyframes out
  (they won't run). Split what remains into modules per surface.
- **Namespace each plate** (prefix or wrapper class) — two lifted
  surfaces will share a class name (`.session`, `.composer`) and one
  silently restyles the other.
- **States are attributes you toggle from t** (`data-hover`,
  `data-sel`, `data-on` + rules for them) — `:hover` and friends never
  fire in a film: menu open, row hover tint, selected ring, button
  pressed, "Saving…", toast shown. Menus, popovers, toasts and "after"
  states live in the same markup, positioned where they open; a change
  big enough to reflow the page is a second fragment you cross-fade to,
  or a transform/clip you animate (`translateY` for scroll, `clip-path`
  for a panel growing).
- **Product micro-animations** (a spinner, a progress shimmer, a
  thinking mark) come from the product's own sprite or keyframe data,
  stepped from t (`frame = floor(t*30) % n`) — never a look-alike. Large
  sprite JSON shrinks 30–45 % by rounding path coordinates to integers;
  keep it in a `.json` module.
- **Dynamic text is spans**: a typed field is a text node you set to the
  typist's prefix plus a caret element; streamed prose is one
  `<span class="w">` per word revealed by count; status rows are list
  items revealed by index with the product's own shimmer class while
  "running" (drive the shimmer's phase from t).
- **Hooks**: put `data-v="send"`-style attributes on everything the
  cursor clicks, the camera frames or a mark annotates, so your cut can
  find them (`kit.srect`/`kit.center`/`kit.camrect`) by a stable selector.
- **Size**: build the window at real CSS pixels (a ≈1440×900 laptop
  window on a 1920-wide stage, or a 390-wide phone) on a plain desk; the
  camera does the zooming, never font-size.

## 4. Check fidelity before anyone sees it

Hold your markup and numbers against the source and your `probe`
before the scene goes in, and look for the tells reviewers catch:
squashed controls (a 28 px button drawn 24), wrong font weight or
tracking, greys that are flat instead of the product's alpha-on-ink,
missing hairlines, radii off by 2 px, icon size and stroke, truncation
and ellipsis behavior, scrollbars that should not be there, a selection
ring hugging the row instead of the text, a drag ghost under instead of
over. At a 2× camera a 1 px error is 2 px. Fix these as content bugs.
Where you have a real screenshot, hold a still of the scene beside it
(finalize.md, "Look as you go").

## 5. When the input is a design, not shipped code

A design file's exported HTML, an HTML prototype or a Figma export is
lifted the same way (route A on its HTML; its token sheet for values).
Say in the hand-off which parts are design rather than product, and put
"Concept mock · Month YYYY" small and grey on the closing card. Never
invent product features to fill a beat; film what exists or what the
design shows.

## When the film shows a product being used

- **Decide what the film proves, and show only that.** One real task from
  the ask to the result; many different results in a row; the same task
  the old way and then the new; or a reveal held back to the end. Two or
  three steps that carry the product's worth beat a tour of every menu.
- **Keep the trigger and the result, shorten the wait.** The click or
  the typed ask is seen, the loading is cut to a beat, and the result is
  held longest: it is what the viewer came for. A result never shows
  before the action that causes it, in the background either.
- **The person touches the real thing, not its caption** — retype the
  placeholder inline, scrub the number field, recolor through the real
  popover; never edit a heading that merely labels the design. Best
  single beat in the walkthroughs: the cursor drifting down a menu with
  the row tint following before it settles — a person deciding.
- **Fidelity is the whole trick.** Called out as
  blockers: a 28 px toolbar button drawn 24, a selection ring spanning the
  row instead of hugging the text, a drag ghost painting under artboards,
  text snapping under a slow zoom. Names and data are fictional ("Acme");
  anything speculative gets a tiny grey "Concept mock · Month YYYY" on the
  closing card.

## Small things that are easy to get wrong

- Cursor: about 30 px on screen at any zoom (counter-scale by 1/z), a click ring and press dip, a 5–8% hover tint on targets.
- Marks that annotate UI ride with the camera; 8–10 px at 1080p, drawn on over 0.3–0.45 s, held 0.8 s or more.
- Zoom: body UI text is about 26 px on screen or more, so 14 px UI text wants 1.9× or more. Build a mock window smaller and denser (about 1440×900 on a 1920-wide stage) so that a 2–3× camera has somewhere to go, and never sit on a whole window longer than about 1.2 s.
- Causality: the field is clicked, text types with visible keystrokes (20–26 characters a second, with jitter), the button lights, the result builds.

## The kit for product films

**Marks** draw themselves on, as if by hand: `const marks = new kit.Marks(kit.svgLayer()); marks.add({id, kind, t0, dur, out,
color, width, …geometry}); marks.render(t)`. Set `color` from the film's palette: a mark with none draws red. Kinds and geometry: `circle {x,y,w,h}`, `underline {x,y,w}`, `arrow {from:[x,y], to:[x,y]}`,
`bracket {x,y,h,side}`, `scribble {x,y,w,h}`, `burst {x,y,r}`, `check {x,y,size}`, `cross`, `path {d:[[x,y],…]}`.

**Geometry** for camera keys and cursor targets (stage px; measure in
`init` after building, or per frame for moving things): `kit.srect(node)` → `{x,y,w,h}` as seen on the
stage (camera included); `kit.camrect(node, cam)` → the same in the
camera's un-zoomed scene space (author camera keys, marks and cursor
targets in this space); `kit.center(node, dx, dy)` → a `() => [x,y]`
for cursor keys; `kit.phraseRect(el, 'phrase')` /
`kit.phraseCamRect(el, phrase, cam)` → the box of a sub-string (null
until it has streamed in) for underlines and circles.

**Cursor** — `const cur = kit.cursor()` mounts the arrow at stage level
and returns it; move `cur.el` into your camera layer to author in scene
coordinates (it then scales with the zoom; counter-scale by 1/z if you
want it a constant ~30 px). `cur.keys = [{t, at: [x,y] | () => [x,y],
bow?: 0.12, lin?}]` (eased, arced travel between keys), `cur.clicks =
[t…]` (ring + press dip), `cur.holds = [[a,b]…]`, `cur.ewSpans`,
`cur.shapes = [{spans: [[a,b]], gfx: kit.cursors.text}]`,
`cur.visible = t => opacity`; `cur.render(t)`.

**Walkthrough devices** — `kit.chip(text, {x, y, anchor: [ax, ay]})`
→ a caption chip (white pill, 26 px system sans unless `style:
'font-family:…'` names a font asset; leader + dot to the anchor);
`kit.show(node, t, tIn, tOut?)` fades/raises it from t;
`kit.spotlight(rect, amount 0..1, {pad = 24, radius = 18})` dims
`kit.fx` outside the rect (call inside `render`, after your own fx
drawing).

**Plates (HTML sprites)** — `await kit.raster(htmlOrNode, {css, width,
height, scale = 1})` in `init` → a canvas of that fragment rendered with
the stage fonts by the export's own DOM rasterizer; `drawImage` it per
frame for heavy static screens you only pan or zoom. Whatever `init`
makes or decodes (plates, `kit.assets.image()`, measured rects) lives
for the whole film; frames never reload assets. `kit.plateStats()`.

## Content and design rules

In a film, motion.md and finalize.md decide how much to draw and when to ask.

- **Do not add filler content.** Never pad a film with placeholder text,
  dummy sections or informational material just to fill space. Every
  element should earn its place. Avoid "data slop": unnecessary numbers,
  icons or stats. Less is more.
- **Targeted changes stay targeted.** When the person asks for a small
  change (some text, a color, one element), change ONLY that, and leave
  all other layout, spacing, fonts, sizes, positions, colors and content
  as they are. A redesign or a new direction is different. If a broader
  change would help, finish what they asked and SUGGEST the rest.
- **Follow an existing design's visual vocabulary.** When adding to an
  existing UI, match its copywriting, palette, tone, states, animation,
  shadows, cards, layout patterns and density.
- **Avoid AI slop tropes:** gradient backgrounds everywhere, emoji
  (unless the brand uses them), and containers with rounded corners and
  a left-border accent color.
- **Recreate from source, not from memory or screenshots.** When the
  source is reachable (a repo, a pasted file, a design system), read it
  and build from it: copy the assets the design uses and exact numeric
  values (paddings, radii, font sizes, line-heights), never rounded to a
  4/8 px grid or a framework default. Screenshots are high-level
  guidance only.
- **Do not recreate copyrighted designs.** Asked to recreate a company's
  distinctive UI patterns, proprietary command structures or branded
  visual elements, refuse unless the person works at that company, and
  help them make an original design instead. Nothing tells you where
  they work but what they say, so ask when it's unclear (questions.md).
