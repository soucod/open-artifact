# Designing a page

Read this before you write a page or restyle one. It covers what the person did not specify. Their own words come
first, then a design system or existing styles in their project (a tokens or theme file, a component library, notes
for agents), then what is below.

A page here is a whole document you write, so nothing sets a look for you: no kit, no template, no default theme.
Whatever you leave undecided shows as a browser default.

## Decide how much design the request wants

Every page gets real type, spacing and colour. What changes is how loud it is.

- **A thing people use** (a checklist, a poll, a calculator, a tracker, a sign-up sheet): quiet and clear. The
  controls and their results lead. No hero, no decoration that is not doing a job.
- **A thing people read** (an explainer, a plan, a comparison): a reading column, clear headings, figures where they
  explain something.
- **A thing with a point of view** (a game, an invitation, a small landing page, something made to be shared): one
  bold idea carried through type, colour and layout, and everything around it kept quiet.

When you cannot tell, make it plain and well composed. A calm page is never wrong; an over-designed one sometimes is.

## Start from the subject

Before any CSS, settle one subject, who opens the page, and the one job it does for them. The choices that make a
page look made for its subject come from that subject's own world: its materials, its documents, its units and
terms. A page for a climbing gym and one for a tax deadline should not share a palette and a typeface.

- Use the real content: the person's own names, numbers, dates and wording. Never lorem ipsum, never "Item 1".
- Where you must invent examples so the page has something to show, say on the page that they are examples.
- Put in at least one detail only this subject has (its real scale, its real categories, its own way of writing a
  date or a score). It costs nothing and it is what makes a plain page feel specific.
- Do not pad. A section with nothing to say is removed, not filled.

## Write the tokens first

Put the design at the top of the page's `<style>`, as custom properties on `:root`, and build every rule from them:
four to six colours with names that say their role, the type roles, one spacing step. A one-line comment above them
says the layout idea. Then nothing further down uses a colour or a font that is not a token.

```css
/* One reading column; the tally sits in a sticky strip above the list. */
:root {
  --ground: #f7f6f2;  --surface: #ffffff;  --ink: #1d1c1a;  --ink-quiet: #66635c;
  --line: #dedbd2;    --accent: #1f6f5c;
  --font-text: system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  --font-display: ui-serif, Georgia, "Songti SC", serif;
  --step: 8px;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --ground: #171715;  --surface: #20201d;  --ink: #ecebe6;  --ink-quiet: #a3a097;
    --line: #34332f;    --accent: #6fc3ac;
    color-scheme: dark;
  }
}
body { margin: 0; background: var(--ground); color: var(--ink); font: 16px/1.55 var(--font-text); }
```

The values above show the shape only: choose your own for the subject.

- **Both themes.** A page follows the reader's system setting through `prefers-color-scheme`, and nothing else tells
  it light from dark. Define every token in the plain `:root` block, redefine only tokens in the dark block, and set
  `color-scheme` in both so form controls and scrollbars follow. Give `body` an explicit background. A page that
  commits to one look on purpose (an arcade screen, a paper invitation) may skip the dark block, but still sets every
  colour itself.
- **Design the second theme, do not invert the first.** Dark grounds are dark grey, not black; the accent usually
  needs to be lighter and less saturated to read on them.
- **Neutrals with a lean.** A grey tipped slightly toward the accent's hue looks chosen; a flat mid-grey looks
  inherited.
- **Contrast.** Body text 4.5:1 against its ground, large text and the edges of controls 3:1. Check the quiet text
  colour too, in both themes: it is the one that fails.
- **Meaning is not the accent.** Good, warning and bad get their own colours, used only for state, and never alone:
  add a word or an icon.

## Type

Fonts from another site may not load: a page runs on its own origin, a site that hosts it allows only that origin
unless its operator opens the network, and the person may be offline. So choose between two things that always work:

- **System stacks.** `system-ui` for interfaces; `ui-serif, Georgia, serif` or `ui-rounded` for a display voice;
  `ui-monospace, "SF Mono", Menlo, Consolas, monospace` for code and figures. Add the reader's script to the stack
  when the content is not Latin (`"PingFang SC", "Microsoft YaHei"` for Chinese, `"Hiragino Sans", "Yu Gothic"` for
  Japanese).
- **A font file beside the page** (`fonts/name.woff2`, loaded with `@font-face` and a relative URL), when the design
  needs a particular face and its licence lets you ship it. Always with a fallback stack.

Then:

- A scale of four or five sizes, and keep to it. Two weights are usually enough.
- Running text 45 to 75 characters a line (25 to 40 for Chinese or Japanese), line height about 1.5; headings tighter,
  with `text-wrap: balance`.
- `font-variant-numeric: tabular-nums` wherever digits sit in a column or change in place.
- One family can do everything. If you use two, make them clearly different, one for display and one for text.

## Layout

- Lay siblings out with flex or grid and `gap`. Margins on each element collapse and double without telling you.
- One outer gutter of at least 16px, set once on the outer wrapper. The page opens in wide windows, in a narrow pane
  beside a conversation, and on phones: it must work from about 360px wide, and its body must never scroll sideways.
- Rows wrap or stack to one column when narrow. A flex or grid child that holds text, code or a table gets
  `min-width: 0`. Images and fixed-ratio boxes get `max-width: 100%`. Only a wide table, a code block or a diagram
  may be wider than the screen, each in its own `overflow-x: auto` box.
- A page that is one screen (a game, a tool) sizes itself to the window (`height: 100%` on `html` and `body`, or
  `100dvh`), and still works when the window is short.
- **Borders, fills, corners and shadows say "this is a separate thing".** Use them where that is true. The same
  rounded, shadowed card around every block flattens the page: nothing stands out when everything does.
- **Repeated things match.** Cards in a row, rows in a list, label and value pairs: same padding, same baselines, the
  same thing in the same place. Let content set the height, and pick a column count the items fill.
- **Structure says something true.** Number the steps only when the order matters. A label above a heading, a
  divider, a badge: each one is there because it tells the reader something, or it is not there.

## The first thing they see

- **Complete at rest.** Everything meant to be read is visible when the page has loaded, without scrolling to trigger
  it. Nothing waits at `opacity: 0` for an observer. A reader who never moves the mouse still gets the page.
- **Size an opener to its content**, not to the window, so the page below it is in view too.
- **A tool opens ready to work.** Show what it does with the person's own data when you have it, otherwise with a
  few rows clearly marked as examples. An empty box and a button show nothing.
- **With `db`, design three states.** The first frame draws before the store answers, so there is a loading state
  that does not jump when data arrives (reserve the height). There is an empty state that says what will appear and
  how to add the first one. And `use('db')` can give `null`: the page then says plainly that it cannot save here, and
  still shows what it can. Put the starting records in the store with `ArtifactData`, not in the page source. In a
  store other people will fill, seed only what the person gave you: never invented people or entries.

## A page people operate

- Summary first, detail after. What needs attention is visible at a glance, in form as well as colour (a pill, a
  stripe, a position), not only as a number.
- Controls look like controls, and say what they do: "Add vote", not "Submit". The name stays the same through the
  flow: the button says "Save", the confirmation says "Saved".
- Every action answers: the row appears, the count moves, a line says what happened. A write to `db` can fail
  (`conflict`, `not_granted`, offline): say what went wrong and what to do, in the page's voice, without apology.
- Targets at least 40px tall on touch screens. Every input has a visible label and a stable `id`. Keyboard works:
  real `<button>`, `<a>` and form elements, a visible `:focus-visible` state, Enter submits a form.
- Ask before destroying something, in the page itself or with one `confirm()`. Offer undo where you can instead.

## Motion

Motion that answers an action (opening, adding, confirming) helps, because it shows what changed. Motion that plays
by itself is a decision: one arranged moment when the page opens can be right for a page with a point of view; a
fade-and-rise on every section is noise. Wrap all of it in `@media (prefers-reduced-motion: no-preference)`.

## Words

Words on the page are part of the design. Write them from the reader's side: name things as they would, in plain
verbs and sentence case, and say the specific thing instead of the clever one. Each label, hint and message does one
job. The `<title>` is the page's name in the library and the top bar: a short, specific noun phrase ("Team lunch
poll"), not a category ("Poll") and not a sentence explaining it.

## What a generated page looks like

Left to defaults, pages converge on a few looks, whatever the subject. If the person asks for one of these, do it.
Otherwise treat each as a sign that a choice was skipped:

- a gradient wash behind a centred headline, with three identical cards under it;
- a cream ground with a serif headline and a clay-orange accent, or a near-black ground with one neon accent;
- the same radius and the same soft shadow on every block, and a coloured bar down the left edge of cards;
- emoji as icons or section markers;
- a small tracked-out capital label above every heading, or one word of the headline in another colour;
- everything centred;
- numbers on things that are not a sequence, and big statistic tiles that nobody asked about;
- every section fading up as it scrolls into view.

## Build it cleanly

- A whole, valid document: `<!doctype html>`, `<html lang="…">` in the content's language, a charset, a viewport
  meta (`width=device-width, initial-scale=1`), a `<title>`, one `<h1>`.
- Headings in order, lists as lists, tables as tables with `<th>`. Images have `alt`; a drawn figure has a label
  (see `diagrams.md`).
- Keep selectors flat and few. Two rules that both set the padding between sections will fight; decide in one
  place which element owns the space.
- A library goes beside the page as a file and loads by relative URL; most pages need none. See `charts.md` before
  reaching for a charting library.
- No errors in the console. Wrap what can fail (`use()`, storage, parsing what a person typed) so one failure does
  not leave a blank page.
- Decorative or generative graphics: canvas, or a few simple SVG shapes. Long hand-written path data is a sign the
  picture wants another tool.

## Changing a page that exists

Asked for a small change (a label, a colour, one more field), change only that, in the page's own vocabulary: its
tokens, its spacing, its wording. Do not restyle what you were not asked about; suggest it instead. A redesign is a
different request: then start again from the subject.
