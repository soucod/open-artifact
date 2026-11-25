# Charts in a page

Read this before you draw a chart, a number tile or a small set of figures inside a page.

This is for a chart or two that support a page. A page that is mostly charts over the person's data, with sources
that refresh, is a dashboard: that is the `data` type, not a page.

Work in this order. Colour comes last; most bad charts chose their colours first.

## 1. Is it a chart at all?

- One number that matters: write it large, with what it is compared to and over which period ("412 sign-ups, 38
  more than last week"). A number alone is not information.
- Three or four values: a sentence or a small table reads faster than a plot.
- Many exact values someone will look up: a table, sorted, with digits aligned.
- A shape, a trend, a comparison across many values: now it is a chart.

## 2. Pick the form from the job

| The reader needs to see | Draw |
| --- | --- |
| Change over time | A line (a few series), or bars when the periods are few and separate |
| Which category is larger | Horizontal bars, sorted by value, labels at the left |
| Parts of one whole | One stacked bar, or bars side by side; a pie only for two or three slices |
| How values are spread | A histogram or a strip of dots |
| Whether two measures move together | A scatter of dots |
| One value against a target | A bar with a marked line, or the number and its target in words |

- One scale per chart. Two measures with different units get two charts on a shared time axis, never one chart with
  two vertical scales.
- Bars start at zero. A line may start elsewhere when the change is the point; say so on the axis.
- Time runs left to right, at its true spacing: a missing month is a gap, not a neighbour.
- No 3D, no shadows on marks, no decorative gradients in them.
- More than about six series in one plot is unreadable. Keep the few that matter and fold the rest into "Other", or
  draw small charts side by side on the same scale.

## 3. Draw to one scale

Compute one scale from the data and place every mark, tick and label with it. Every tick label names a value the
chart really reaches; round numbers, a handful of them. Measure the room the widest label needs before you fix the
margins, and keep everything inside the drawing's bounds. Draw a line from point to point: a smoothed curve shows
values that were never measured.

Format what you print: thousands separators, a sensible number of decimals, units, dates the reader's way. Use
`tabular-nums` so digits line up.

## 4. Marks

- Lines about 2px; points at least 8px across where they are shown at all. Bars with a small gap between them, and
  a gap in the page's ground colour between stacked segments.
- Grid lines and axes stay quiet: a few thin lines in the page's line colour, behind the marks. The data is the
  darkest thing in the chart.
- Text in the chart (ticks, labels, legend, values) takes the page's text colours, never a series colour. The mark
  beside it carries the identity.
- Label directly where you can: the series name at the end of its line, the value at the end of its bar. Label the
  points that matter (the last, the highest, the one the text talks about), not every point.
- With two or more series, show a legend as well; with one, the title names it.

## 5. Colour, by the job it does

| Job | Rule |
| --- | --- |
| Telling series apart | Different hues of similar weight, in a fixed order. A series keeps its colour when a filter removes its neighbours. |
| Showing more or less | One hue, light to dark. |
| Above or below a midpoint | Two hues with a neutral grey at the middle. |
| State | The page's good, warning and bad colours, kept for state alone and always with a word or an icon. |

- Never a rainbow for amounts, and never a seventh generated hue for a seventh series (see the end of step 2).
- Colour is never the only signal. About one reader in twelve cannot tell some hue pairs apart, and a screenshot may
  be printed in grey: direct labels, a different dash or point shape, and order all carry identity too.
- Neighbouring series must differ in lightness as well as hue. Look at the chart in greyscale: if two series merge,
  change one.
- Marks need 3:1 contrast against the chart's ground. Define the series colours as tokens with their own values in
  the dark block: colours chosen for a white ground are too dark or too loud on a dark one.

## 6. Hover, touch and readers who cannot see it

- A chart in a page is interactive by default: a tooltip for the nearest point on a line, for the bar or dot under
  the pointer elsewhere. Make the target bigger than the mark (the whole column, not the 2px line), and make it work
  on touch and with the keyboard where the marks can take focus.
- Not the `title` attribute: it is slow and does nothing on touch. Position your own small box inside a
  `position: relative` wrapper.
- The numbers that matter are printed on the chart or beside it, so a phone and a screenshot still show them.
- Give the `<svg>` `role="img"` and an `aria-label` that says what the chart shows, finding included. Offer the
  values as a table too, in a closed `<details>` under the chart when the page has room.
- Filters and ranges sit in one row above the charts they change, and say what is selected.

## 7. Title, caption, then look at it

The title says what the chart shows, ideally the finding ("Sign-ups doubled after the March launch"), and a caption
says where the numbers come from and the period they cover. Then look at the drawn chart, at phone width and in both
themes, for labels that collide, marks that leave the frame and colours that vanish. Nothing above replaces that.

## Drawing it

Inline `<svg>`, drawn by a small script from the data, is enough for most charts here; canvas when there are
thousands of marks. Draw at the box's real width: read the container's `clientWidth`, use it as the `viewBox` width,
and redraw when the box resizes (`ResizeObserver`) and when the data changes. A chart drawn 600 wide and scaled down
to a phone shrinks its 13px labels to 8px; drawn at the real width, the text keeps its size and the plot gives up the
room instead (fewer ticks, shorter bars, labels above the bars instead of beside them). A charting library from
another site may not load (see `design.md`, "Type"); if the page truly needs one, save its file beside the page and
load it by relative URL.

With `db`, draw from the snapshot and redraw on each one. Before the first snapshot the chart's box holds its height;
with no rows it says what will appear and how to add the first entry.
