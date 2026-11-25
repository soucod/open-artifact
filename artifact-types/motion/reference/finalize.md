# Making the film

This page takes a film from its list of scenes to the end, straight after the first batch. Any later turn goes by later.md.

The order of work is the world, then the scenes, then the score. A scene thought up on its own comes out thin, one shape and a line of type, and a film of those looks like a slide deck. When the world is settled first and its things are drawn once, with care, every scene starts from something drawn and the film looks as if one hand made it. The bar is a film someone would stop scrolling for, as rich as the ask wants and no richer (motion.md).

## How to work

**Think briefly and write.** Someone is watching the film arrive. Settle the world in a few lines of thought, and each scene in a few more. Never draft code in your thinking: the tool call is the draft, and anything you write twice doubles the wait. One reply can hold only so much, and a reply spent on thinking ends with no film at all, the worst outcome there is. Hold to this even if they ask for your best or tell you to take your time: care goes into what you draw, not into a longer plan.

**Every document is written whole, once, in its own write**: `base.css`, `shared.js`, every scene, the score. Under a host that is an ArtifactData call with the text inline; standalone, `open-artifact write-db`, where a scratch file passed as `{"$file": "<path>"}` saves the JSON escaping. Generate nothing with a script. If a document feels too long to write in one go, draw less of it.

**Budget.** On a rich film the drawings on `W` run 3,000 to 6,000 characters and a scene's own code 2,500 to 5,000; a plain one takes less. Take what the picture needs, and stop. Their product's UI, or a scene over 8 s, takes more.

**Look as you go.** After each scene, or two short ones, draw two or three stills of it (its first moment, its busiest moment, its last second) and look at every one. A still takes about a second and shows what reading code can't: a line that wraps, boxes that overlap, a wash lying over the picture, a scene that doesn't open as the last one closed, words crossed by a drawing, a first second with nothing in it. Mend what you see with a write of that scene before you go on to the next, and look again at the moment you mended. Frame 0 gets a look as soon as the first scene is in: it is the thumbnail. A still shows where things are, never how they move: judge speed and rhythm from the seconds in `render`, and never say you watched it play. Keep to stills: make no video or audio file, and never hold the film back for a full pass at the end, because someone is watching it arrive. If stills can't be drawn where you run (no Chrome or Chromium, no `snapshot`), go on without them and read each scene as a storyboard instead.

Ask no questions while you make the film, whatever motion.md or recreate-ui.md says of asking, apart from one that decides a refusal: ask it and end the turn, and take the film up by later.md's "Cut short".

**Drawing a still.** Under a host, `Artifact {action: "call", url, name: "snapshot"}`. Standalone, `open-artifact stills <root> --at 1.5,4,9.2` (played seconds; `--scale 0.5` for half size, `--rough` to draw rough scenes as sketches, `--out <dir>`, else a new temporary folder). It loads the film from `<root>/db` and `<root>/_blobs` into a page that shows nothing and draws each time as Export does, then prints each PNG's path, the score's counts (an `unknown` patch plays silent) and the film's own warnings and errors. It needs Node 22 or later and a Chrome or Chromium (`CHROME_PATH`, else Playwright's browser cache or the system's), and installs nothing. Look at every PNG before you say anything about it. Fonts chosen on the page or fetched from Google are not applied there, so say so with any still of a film that has them (later.md's "What to say about fonts", F).

## 1. Have motion.md and film-api.md

If this conversation lacks their text, whole, read them in one message, before any world or scene: the rules of a film's look are there. Add recreate-ui.md if the film shows their product, design-systems.md if a system is in play, and explainer.md if the film explains something (history.md with it for history or a real person's story).

## 2. Settle the world

Answer these for this film, from the look, the palette and the scene list, in a few lines of thought:

- **Where are we?** A real place, with a time of day and weather. For an explainer or a report, a drawn system: a cross-section, a map, a workbench, a model railway, a cutaway machine. "A blank slide" isn't a place.
- **What is it made of, and where's the light?** The material and the hand (gouache, tin toys, blueprint ink, stitched felt, chalk) decide the edges, the texture and how things move. One light source decides what's lit and what's in shadow. Before you write the look line, hold it against motion.md's never-draw list: no red rising sun with rays; no spread eagle or heroic figure against a red or pale disc, rays or a field of red. A sunset, a moon or a sunrise that the person asks for stays.
- **Who and what recurs?** Three to six things the viewer will remember: a character, a vehicle, a building, a tool, a chart.
- **What small things are true only here?** A few invented specifics: the cat asleep on the vending machine, a cobweb on the trophy. They make a film feel made for someone.
- **What's the idea?** Where the brief has room for one, the unexpected way of telling it that someone would describe to a friend.
- **What is already decided?** With a system in play, its colors, type, logo and icons are settled, so your invention goes into everything else. Think how their real things live in this world: the logo on the side of the truck, an icon as a street sign.

Then hold it to the brief. Everything they asked you to show or say, except what you refused, appears on screen in their words and figures. The look they asked for is the look, within what motion.md's Looks allow. The world serves the brief and never replaces it.

When the brief is plain work (a product promo, an explainer, a results update, a board paper), the words, numbers and product are the subject and the world stays quiet. Pick a visual system that suits the subject and draw its parts well: a chart can be a drawn object with depth, and a process can be a machine. Keep every number theirs or clearly made up. If the film shows their product, screenshots or logo, the world frames them and never restyles them (recreate-ui.md). An explainer's world is its subject and where it stands: one familiar thing that works the way the idea does, with its facts in `W.facts` and every amount drawn from them (explainer.md).

## 3. Draw the backdrop, in one batch

Your first write here is one `batch` holding `modules/base.css` and `modules/shared.js` (uploads alone go ahead of it; each font and image gets its `assets` document). Send it before you think about any one scene. In test films the thinking before this write goes the same way: the world is settled, the functions for `shared.js` are named, and then, at "let me write shared.js now", the file is typed out in thought, coordinates and all, and again in the call. So the moment you know what those functions are called and roughly how big each thing is, the cast's too, begin the batch. The numbers inside a drawing come as you draw it.

**`base.css`** (`if_match`: the sha256 the first batch's reply gave; none shown: `get` it) goes whole: the four color variables and the type stacks as they are, then type sizes and weights as classes. Mix tones from the four with `color-mix`, and name them for what they paint: they follow when a person changes the palette on the page. With no system, every color in the film's code is one of the four or a mix of them, skin and leaves too (evolution gag figures aside): any other takes the page's dark-to-light palettes away. When one of the four is red beside a near-black and a white or cream, the big areas (sky, land, water) mix the pale and the dark, and red stays small. See-through is `color-mix(in srgb, var(--second) 20%, transparent)`, never the color again as `rgba()`; a shadow may be `rgba(0,0,0,.25)`. Their product's lifted CSS keeps its own colors.

**`shared.js`** (`kind` js) runs once, before any scene. It starts one object, `window.W`, with a function for each layer of the backdrop: whatever stands behind most scenes. Even with no backdrop it starts `window.W`: the scenes add to it. The cast, the things that recur from step 2, isn't drawn yet: each is added to `W` by the scene that first shows it, so that each is drawn with its moment in view. Pass each helper the scene's `kit`. Keep its code plain, because a mistake here leaves every scene a name card.

These hold for every drawing on `W`:

- **Build from many shapes.** A thing has a lit side and a shadow side, an edge, and the small parts that make it this thing, not a generic one: rivets, stitches, window frames.
- **Write drawing functions with parameters,** such as `house(x, y, lit)`, and call them in loops. A seeded loop (`kit.rng`, never `Math.random`) turns five lines into a forest, a flock or a skyline.
- **Make one world, not a new one per scene.** Scenes are views of the same place, which can change across the film while staying itself.
- **Give things joints.** Put each moving part in its own `<g>` with its pivot at (0,0), so that a scene turns it by rotating one group. An animal the ask wants is a loose hand-drawn outline over a wash, a few big poses in three-quarter or side view, never joined geometric shapes. People go by motion.md.
- **Draw things whole.** Simple means few details, not few parts. Nothing floats that should be attached. A figure seen in part runs off the frame's edge; it never loses its middle, and legs never stand alone mid-frame.
- **Keep things alive.** A function for smoke, rain or leaves places each one from its own seed and `t` alone, never from the frame before.

**Draw in SVG, with a `<g>` for each thing whose class starts with the scene's id (`ring-bell`).** The page's Layers list reads those, so a person can pick out the bell or the ringer and change it. Give a gradient stop its color in `style`. No words in SVG or on a canvas (a logo's own aside).

**Keep the picture light,** because Export snapshots the whole scene for every frame, and a person's laptop draws it as they watch. Aim for 300 elements in a scene at most. Repeat things with a `<pattern>`, not hundreds of shapes. Leave no `<canvas>` on the stage: texture painted once goes on a small tile used as a CSS background. Keep filters and blurs off anything large.

A foundry's whole `base.css` and `shared.js` are at the end of film-api.md, with the head of its scene `ring`; the rest is below.

## 4. Write the scenes

In film order: one `set` per scene, a new document (`modules/scene-<id>.js`, no `if_match`), one call a message, finished the first time. The user watches each one arrive, and calls sent together arrive together. The list is the plan, so don't lay out the scenes ahead.

**A scene brings its cast.** At its head, under `const { … } = kit;`, a scene's file adds to `W` each thing of the cast that it's the first to show: `Object.assign(W, { bell(cls) {…}, ringer(cls, x, y) {…} })`. The files run in film order, so later scenes call those drawings. Keep a head's code simple, however rich its drawing. What no other scene shows is drawn inside its scene, just as richly.

A scene is a staged picture. It calls on the world, adds what's particular to this moment, and moves:

- **Stage in depth.** Far, middle and near layers, each its own element, with one camera move that carries them different distances.
- **On a rich film, fill the frame.** Something goes on behind the subject, and something sits close to the lens. On a plain film, calm space is right.
- **Move everything a little and one thing a lot.** One clear action carries the story; quiet life runs through the rest.
- **Light the moment.** Light does more than another object would: a pool on a wall, a lamp, a falling shadow, a darkened edge. It needn't be warm or low. Noon, fog, neon and flat paper light are as good as dusk. Films made here drift toward dusk unless you choose otherwise.
- **Give words a calm place.** Many shots need no words. Where a scene has them, put them on clear ground, on a soft scrim like `.calm` if need be, with nothing crossing them at any moment, and never across a character, an object or other words. Vary the place from scene to scene. On a really busy picture, put them on a solid overlay along the bottom, the same each time.
- **Let layout breathe.** Words wrap differently in another face or at 1080 wide. Anchor a `.words` group by one edge and let it grow, as below, with nothing at a fixed spot under text that can wrap. In a film that isn't 1920×1080, work from `kit.W` and `kit.H`, written out in full, since a `W` taken from kit hides the film's drawings, and recompose: in a tall film, stack what sat side by side.

A scene that throws shows only its name card, and nobody tells you. So give each name one meaning, hold elements rather than their `.style`, and loop in `render` over the list `init` made. Nothing flashes or cuts more than three times a second, and no scene is under a second.

```js
const { seg, eo, eio, lerp, TextFx } = kit;
kit.scene('ring', {
  init(kit) {
    this.birds = W.birds(kit, 14, 330, 470);
    this.smoke = W.smoke(kit, 14, 1640, 400);
    kit.stage.append(kit.h('<div class="ground"><div class="air"></div>' +
            '<svg class="art ring-far" viewBox="0 0 1920 1080">' + W.town(kit, 7) + this.smoke.markup + this.birds.markup + '</svg>' +
      '<svg class="art ring-mid" viewBox="0 0 1920 1080">' + W.wall('ring-bricks') +
        '<path class="ring-yard" d="M0 900 Q620 860 1080 900 T1920 880 V1080 H0 Z" style="fill:color-mix(in srgb, var(--mortar) 70%, var(--main))"/>' +
        '<path class="ring-fall" d="M640 922 L1180 1010 H1460 L1290 922 Z" style="fill:var(--shade)"/>' +
        '<g class="ring-frame"><path d="M610 920 L700 130 H760 L700 920 Z M1310 920 L1220 130 H1160 L1220 920 Z" style="fill:var(--timber)"/><rect x="660" y="96" width="600" height="62" rx="8" style="fill:var(--timber)"/></g>' +
        '<g class="ring-hang" transform="translate(960 150)">' + W.bell('ring-bell') + '</g>' +
        '<path class="ring-rope" style="fill:none;stroke:var(--main);stroke-width:8"/>' + W.ringer('ring-man', 1420, 916) + '</svg>' +
      '<svg class="art ring-near" viewBox="0 0 1920 1080"><g class="ring-branch"><path d="M-40 120 Q260 90 470 150" style="fill:none;stroke:var(--timber);stroke-width:16"/>' +
        [60, 130, 210, 290, 370, 440].map((x, i) => '<path d="M' + x + ' ' + (112 + i * 3) + ' q34 ' + (i % 2 ? 74 : -66) + ' 84 ' + (i % 2 ? 20 : -10) + ' q-50 -6 -84 ' + (i % 2 ? -20 : 10) + ' Z" style="fill:color-mix(in srgb, var(--main) ' + (60 + i * 6) + '%, var(--second))"/>').join('') + '</g></svg>' +
      '<div class="pool ring-pool" style="left:420px;top:120px;width:1080px;height:760px"></div><div class="edge"></div><div class="calm"></div><div class="words" style="left:110px;bottom:80px;width:900px"><h2 class="line">One stroke, heard across the valley</h2><p class="sub ring-sub">Cast here since 1871</p></div></div>'));
    const q = (s) => kit.stage.querySelector(s);
    this.birds.bind(q('.birds'));
    this.smoke.bind(q('.smoke'));
    Object.assign(this, { line: q('.line'), sub: q('.ring-sub'), hang: q('.ring-hang'), rope: q('.ring-rope'), man: q('.ring-man'), 
      far: q('.ring-far'), mid: q('.ring-mid'), near: q('.ring-near'), pool: q('.ring-pool'), fall: q('.ring-fall') });
  },
  render(t) {
    const push = eio(seg(t, 0, 4));   // one slow move; each layer travels its own distance, and that is the depth
    this.far.style.transform = 'scale(' + lerp(1.01, 1.03, push) + ')';
    this.mid.style.transform = 'scale(' + lerp(1.02, 1.07, push) + ')';
    this.near.style.transform = 'translateX(' + lerp(0, 60, push) + 'px) scale(' + lerp(1.04, 1.14, push) + ')';
    const swing = 15 * Math.sin(t * 2.6) * Math.exp(-t * 0.3), pull = Math.sin(t * 2.6 + 0.4);
    this.hang.setAttribute('transform', 'translate(960 150) rotate(' + swing.toFixed(2) + ')');
    const turn = lerp(-3, 5, (pull + 1) / 2), th = turn * Math.PI / 180, a = swing * Math.PI / 180;
    this.man.setAttribute('transform', 'translate(1420 916) rotate(' + turn.toFixed(2) + ')');
    const hx = 1420 - 78 * Math.cos(th) + 190 * Math.sin(th), hy = 916 - 78 * Math.sin(th) - 190 * Math.cos(th);   // the hand, so that the rope meets it
    this.rope.setAttribute('d', 'M' + (960 + 120 * Math.cos(a)) + ' ' + (240 + 120 * Math.sin(a)) + ' Q1200 ' + (440 + 20 * pull) + ' ' + hx.toFixed(1) + ' ' + hy.toFixed(1));
    this.fall.style.transform = 'skewX(' + (-swing * 0.5).toFixed(2) + 'deg)';
    this.birds.render(t - 0.4);
    this.smoke.render(t);
    this.pool.style.opacity = 0.8 + 0.12 * Math.sin(t * 0.9);
    TextFx.fadeFromRight(this.line, t, 0.3);
    this.sub.style.opacity = eo(seg(t, 1.3, 1.8));
  },
});
```

Copy how it's built, never its scenes, words, colors, shapes or times, nor how its line comes in: motion.md has other ways. Choose the hour, the light and the palette anew for your own. Two things in it catch people out. Its `.pool` lies over the art, as light: over a thing that must stay crisp, put the pool beneath it or keep it faint. And the stage sets no `box-sizing`, so a box's `width` leaves its padding out: a row of cards needs width plus both paddings inside its step, or `box-sizing:border-box` on the card.

## 5. The score and the stage

Last, ONE `batch`, so that the film loads once. If they asked for silence: no score, and no read of sound.md. The same if the film will play silent (a loop, a GIF, a booth or lobby screen), unless they asked for music, other sound or a voice, made here or theirs. Every other film has a score: read sound.md first. `modules/score.js` (new, `kind` js) is `kit.score(function (S, T) { … })`: `S` as in sound.md, `T` holds each scene's start in seconds by id, and `T.END` the film's length: `S.fx('pop', T.ring + 1)`. Then `modules/scenes.json` (`if_match`: the sha256 of your last read or write of it), whole, with `"stage":"final"` and nothing else changed.

## 6. Stop

Then run `open-artifact check <root>` (under a host, `Artifact {action: "call", url, name: "check"}`) and fix each error it names. `check` reads the documents, not the picture, so take one last look at stills of frame 0, of each scene's first second and of the film's last second. That ends the work. Close as SKILL.md says, always including the film's url and its one sentence more if there is one, and end the turn. Say nothing of artifact types or how it was made, and don't name the music.
