# An explainer with amounts: one model drives the picture

Read this with explainer.md when the explanation turns on amounts, a rate or a state that changes: how many, how
fast, when it trips, what is left. A film whose subject is a flow with nothing to compute (a product's loop, a route)
doesn't need it. The sample subject and numbers are another film's: copy how it's built, never its things.

## The picture

A scene's picture is already a pure function of `t`. Make the mechanism one too, and draw everything from it:

- **The facts go in `W.facts`, once,** in `shared.js`, each with where it came from in a comment. Beside them, the
  mechanism as a small pure function: in, the model's own clock and its settings; out, the state (how many in the
  tray, how long the queue, how hot).
- **Every amount on screen is read from it:** how many are drawn, how fast they fall, the length of an arrow, the
  figure on a read-out, whether the gate is shut. Nothing is animated apart "to look about right". Say 20, draw 20;
  five a second fall five a second.
- **Direction, facing, order and relative size are computed from the facts too,** never placed by hand for each
  state: where the light comes from, which way the force pushes.
- **A paused frame is then true by itself:** at "empty" the read-out says 0 and the gate is shut. A read-out shows the
  model's value, so motion.md's rule about starting a counter half-way is not for it.
- **Ease the camera and the entrances, never the quantity:** a rate is a fact, so the model's clock runs straight
  through its seconds.
- **The next scene opens on the state this one ended in:** it calls the same function with the same numbers, and
  never types the number in again.
- **A line that states a number is still one whole string literal** (rough-cut.md), so it can't be built from `W`:
  hold each such line against the facts as you write its scene. A read-out that changes is an element of its own, set
  by `render`.
- A large amount is a bar, a pattern or a level, not ten thousand shapes (finalize.md, "Keep the picture light").

In `modules/shared.js`:

```js
window.W = {
  facts: { cap: 20, refill: 5 },   // their docs: the tray holds 20, and 5 come back each second
  // Coins in the tray after s seconds of `rate` visitors a second, starting from `from`.
  tray(s, rate, from) { const f = W.facts; return Math.max(0, Math.min(f.cap, from + (f.refill - rate) * s)); },
};
```

`modules/scene-drain.js`, the first scene to show the tray (`.art`, `.num` and `--coin` are that film's own, from its
`base.css`):

```js
const { seg, lerp, eio, clamp01 } = kit;
Object.assign(W, {
  // One coin drawn for each coin the facts name: change the fact, and the drawing follows.
  coins(cls) {
    let s = '<g class="' + cls + '">';
    for (let i = 0; i < W.facts.cap; i++) s += '<circle cx="' + (-270 + (i % 10) * 60) + '" cy="' + (i < 10 ? 0 : 120) + '" r="24" style="fill:var(--coin)"/>';
    return s + '</g>';
  },
});
kit.scene('drain', {
  init(kit) {
    kit.stage.append(kit.h('<div class="ground"><svg class="art" viewBox="0 0 1920 1080">' +
      '<g transform="translate(1260 430)">' + W.coins('drain-tray') + '</g>' +
      '<path class="drain-gate" d="M930 720 H1590" style="fill:none;stroke:var(--second);stroke-width:28;stroke-linecap:round"/></svg>' +
      '<div class="words" style="left:120px;top:140px;width:640px"><h2 class="line">Ten visitors a second</h2><p class="sub">Coins in the tray</p><p class="num drain-n"></p></div></div>'));
    this.coins = [...kit.stage.querySelectorAll('.drain-tray circle')];
    this.n = kit.stage.querySelector('.drain-n');
    this.gate = kit.stage.querySelector('.drain-gate');
  },
  render(t) {
    const s = lerp(0, 4, seg(t, 1, 5));              // the model's clock, unhurried and uneased: four seconds, shown in four
    const n = W.tray(s, 10, W.facts.cap);            // 20 down to 0: everything below reads this one number
    this.coins.forEach((c, i) => { c.style.opacity = lerp(0.14, 1, clamp01(n - i)); });
    this.n.textContent = Math.round(n);
    this.gate.style.opacity = lerp(0.2, 1, eio(1 - clamp01(n)));   // the gate shuts as the last coin goes
  },
});
```

The scene after it opens from `W.tray(4, 10, W.facts.cap)`, which is 0, and runs `W.tray(s, 0, 0)` as the visitors
stop.

## The sound

- **Effects are timed by the model, not by ear.** `score.js` runs after `shared.js` and the scenes, so it can read
  `W.facts` and the model there, and work out when each thing happens with the same numbers that draw it. Use only
  what `shared.js` defines, never a drawing a scene adds to `W`: a score that throws is a silent film.
- **One sound means one event** for the whole film: the coin's tick is the coin's tick in every scene. The answer
  gets the one bright sound (`ding`, `chime`), and the film's one conclusion the one heavy one.

```js
kit.score(function (S, T) {
  const f = W.facts, each = 1 / (10 - f.refill);                       // ten in, five back: a coin leaves every fifth of a second
  const leave = Array.from({ length: f.cap }, (_, i) => T.drain + 1 + (i + 1) * each);
  S.ticks(leave, { vel: 40 });                                         // one tick a coin, on the frame it dims
  S.fx('thud', leave[leave.length - 1]);                               // the gate shuts with the last one
});
```
