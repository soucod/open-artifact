# Drawing

How to draw a picture for a board, and what each `style` asks of it. How a drawing is stored, sized and placed on the
board is in SKILL.md, under Drawing.

Draw as an illustrator who knows the subject would: true proportions, and the details someone who works with the thing
would recognise. Make it striking and alive, caught in the middle of being used. Never draw people or any part of one
(a figure, a face, a hand, a silhouette, a stick figure), even when asked: a drawn person looks wrong on a board and
pulls the eye away from what the picture is for. Draw what they would hold, use or work on instead.

A picture is one of three things: a single object with what it is used with; one place, full of what belongs there; or a
story told in a few large moments, each a single clear change from the one before. Aim for about 5,000 characters of
simple shapes (about 2,000 for `draft`), written back to front. Leave the board around it empty: no frame, and no ground
or sky running out to the edges.

## How to draw

- The `<svg>` tag has `xmlns`, a `viewBox` starting at 0 0, and the ink for everything inside it, set once:
  `stroke='currentColor' fill='none' stroke-width='2.5' stroke-linejoin='round' stroke-linecap='round'`. The page
  paints `currentColor` in the style's own ink, dark on a light board and light on a dark one.
- Its first child is a `<desc>` of plain text: the viewpoint, then a list of at least twenty actual parts and props
  you are going to draw. Writing it first settles what the picture holds. The whole SVG is one line.
- Each part is a single closed shape that carries its fill and its edge together. Nearer parts come later in the SVG,
  so they cover the ones behind.
- Solid things are turned so a corner faces us, with three tones of one colour for the front, the side and the top,
  horizontal edges receding at an angle, and circles foreshortened into ellipses. A creature is a few big masses that
  overlap.
- Whatever lies on a part follows its form: shading in a deeper tone, highlights in a paler one, markings, all with
  `stroke='none'`; then at least as many fine lines again (`stroke-width='1.2'`): seams, screws, vents, cables, folds.
- Colours are `%23rrggbb`, `none` or `currentColor`. The board may be light or dark, so paint no background.

## What the page accepts

The page draws `g`, `path`, `rect`, `circle`, `ellipse`, `line`, `polyline` and `polygon`, plus a `<desc>` or
`<title>` holding plain text. Give each attribute once, and keep to geometry, `fill`, `stroke`, `stroke-width`,
`fill-opacity`, `stroke-linecap`, `stroke-linejoin` and `stroke-dasharray`. Any of these keeps the whole picture from
showing: the page puts a grey box or an empty frame in its place without saying why, and `open-artifact check` names
the problem.

- a `<text>` with words in it (names belong in `text` elements beside the picture), or an `<image>`, `<use>`,
  `<style>`, `<script>`, `<foreignObject>` or `<filter>`;
- a `style` attribute, or a `filter`, `mask` or `clip-path` other than `none`;
- a shape inside five nested `<g>`s, or a 65th `opacity` attribute (use `fill-opacity` instead);
- more than 36,000 characters of SVG, or a `src` longer than 49,152 characters in all (characters that aren't plain
  ASCII are escaped, so fewer of them fit);
- a slip in how the SVG is written into its `src` (SKILL.md, Drawing): a `#` anywhere, a `%` not written `%25`, a tag
  left open, a bare `&`, or anything before `<svg` or after `</svg>`.

## Style

Every drawing of yours carries a `style`, and the page paints the SVG in it. Any subject can be drawn in any style. Use
the one the person names, or the closest to what they describe; otherwise choose as an illustrator would, the one that
does most for this particular drawing, and don't fall back on one out of habit. A board mostly keeps to one style. Each
style asks for something different in the SVG, so a new style means a new drawing.

- `watercolor`: a few loose, wet washes around the subject, set apart from each other, each a different size, none of
  them a ring around it, breaking off into drips and stray spots. Put `stroke='none'` on the `<svg>`: everything is
  fill, at `fill-opacity='.7'` or lighter, and an edge is a darker wash, not a line. Keep the colours close, the light
  from one side and distant things paler, with one clear subject that holds the detail and one real dark.
- `comic`: a single moment seen from low down, from above or up close. The subject is big and bursts out of a cut-out
  panel of flat, strong colour (`stroke='none'`), jagged for a loud moment, smooth or tilted for a quiet one; any
  further moment gets a panel of its own. Colours are bold and flat, the side in shadow is `%23111111`, and the
  `currentColor` lines are 4 wide for what is near and 2 wide for what is far, with speed lines and impact marks.
- `draft`: a designer thinking on paper with a pen. First, at the very back, a couple of faint guide lines; over them,
  big loose forms left almost all white, their edges overshooting the corners; then two or three bold colours in broad
  patches, laid on a little off the lines, only where it matters.
- `paper`: a collage of cut paper. Put `stroke='none'` on the `<svg>`; every part is a flat, saturated fill. Each
  thing is a few bold sheets of its own, with folds in two tones. Land or water takes six sheets or more, none
  following the edge of the next: each swells and dips in its own way, crowded on one side and spread out on the
  other, the lowest the loosest. Going up the stack, the colours shift across the hues the subject really has, ending
  well away from where they began. A place on it is marked by a little icon inside a badge with a white border; a
  route is a white dashed line.
- `blueprint`: a technical drawing: a big main view, either square to us or isometric, plus a smaller view beside it.
  Shapes are left white and told by their lines: 4 wide around the whole, 2 for the parts, 1 for all the detail that
  makes it real, dimension lines with ticks, straight centre lines dashed as `stroke-dasharray='18 4 3 4'`, and edges
  out of sight dashed as `'8 5'`. Walls are solid dark; mark what the drawing cuts through with `class='cut'` (on the
  shape or on a `<g>` around the shapes) and the page fills it mid grey. Colour
  goes only on what moves or flows, with filled arrowheads. The page lays the blue sheet and its grid behind it.
- `marker`: drawn with a pen and coloured with markers, bold and definite. Each part is fully coloured, the strongest
  colour going to what matters most; any ground or floor is a patch with a ragged edge, not a band across the picture.
- `plain`: flat, clean and exact, seen straight on: a diagram or a mark, with only its own few parts.
