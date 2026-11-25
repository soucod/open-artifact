# Diagrams in a page

Read this before you draw a flow, an architecture, a sequence, a comparison or a timeline inside a page.

This is for a figure the reader looks at. A diagram the person will rearrange box by box belongs to another type:
a whiteboard, or a design canvas.

## Whether to draw one

A diagram is worth its space when it shows something the reader would otherwise have to assemble from sentences:
which way data moves, which parts talk to which, what a request passes through, what one option adds that the other
does not. If one sentence says it as well, write the sentence.

## What to draw

- **The mechanism, not the vocabulary.** A box named "queue" says nothing by being there. The writer that fills it,
  the reader that drains it and the arrow that shows which waits for which do. Draw the parts the point depends on,
  and leave the rest of the system out.
- **For a choice, draw the difference.** Put the two arrangements side by side on the same skeleton, so the reader
  can point at the one hop, store or step that differs. One box per option, joined to nothing, is the option list
  again with borders.
- **As much as the question needs.** A one-step question is three boxes. A change that reroutes writes needs the
  old path, the new one and the order they happen in. Neither a token sketch nor an inventory of everything.
- **Say what each arrow means.** An arrow with no label means "related somehow". `reads`, `retries after 30 s`,
  `only on publish` is information. Use a legend only when one encoding (dashed, a colour, a double line) repeats
  across the figure; otherwise write the meaning beside the mark.
- **One figure, one point.** Two points are two figures.

## How to draw it

Write the figure by hand as inline `<svg>`: `rect`, `circle`, `line`, `polyline`, `path` and `text`. No library, no
image file, nothing fetched. A diagramming library from another site may not load here (see `design.md`, "Type").

```html
<figure>
  <svg viewBox="0 0 520 120" role="img" aria-label="A vote goes from the form to the store, and the store updates every open view.">
    <defs>
      <marker id="tip" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0 0 L8 4 L0 8 Z" fill="currentColor"/>
      </marker>
    </defs>
    <g fill="none" stroke="currentColor" stroke-width="1.5">
      <rect x="10" y="40" width="130" height="44" rx="6"/>
      <rect x="195" y="40" width="130" height="44" rx="6"/>
      <rect x="380" y="40" width="130" height="44" rx="6"/>
      <line x1="140" y1="62" x2="193" y2="62" marker-end="url(#tip)"/>
      <line x1="325" y1="62" x2="378" y2="62" marker-end="url(#tip)"/>
    </g>
    <g fill="currentColor" font-size="13" text-anchor="middle">
      <text x="75" y="67">Form</text><text x="260" y="67">Store</text><text x="445" y="67">Open views</text>
      <text x="167" y="54" font-size="11">adds</text><text x="352" y="54" font-size="11">updates</text>
    </g>
  </svg>
  <figcaption>Nobody reloads: the store tells each open view when a vote arrives.</figcaption>
</figure>
```

- **Size with `viewBox`.** Choose its width and height for the content, and let CSS scale it
  (`svg { max-width: 100%; height: auto }`). A flow reads left to right, a stack of layers top to bottom. A figure
  that would be unreadable at phone width goes in its own `overflow-x: auto` box instead of shrinking.
- **Colour from the page.** Draw lines, arrowheads and text in `currentColor`, so the figure follows the page's
  text colour in both themes. Fills come from the page's tokens (`fill="var(--surface)"`). Keep a real hue for the
  one thing the figure is about, and check it against both grounds.
- **Give every shape a fill**, even `none`. A shape with no `fill` is painted black.
- **Arrowheads** are a `<marker>` in the figure's own `<defs>`, or a small triangle at the line's end. Give the
  marker an id no other figure on the page uses.
- **Text is short.** A word or three per label, 11 to 13 units at the drawn scale, aligned with `text-anchor`.
  Sentences go in the caption.
- **Snap to a grid.** Boxes in a row share a centre line; gaps are equal; sizes repeat. That regularity is most of
  what makes a hand-drawn figure look deliberate.
- **Leave room.** Keep the outermost labels and strokes inside the `viewBox`, and labels clear of lines and of each
  other.
- **Caption and label.** Wrap the figure in `<figure>` with a `<figcaption>` that states the point, and give the
  `<svg>` `role="img"` and an `aria-label` that says the same thing for someone who cannot see it.
