import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { breakMargin, flowPages, flowPaper, keepTogetherSpans, MAX_FLOW_PAGES, paginate, pageSlices, PAPER, type Interval, type KeepBlock } from '../src/lib/pagination.ts';
import { groupLines, type Word } from '@open-artifact/export-kit';
import { pageBookmark, pageLinks, pageRuns } from '../src/lib/pdf-text.ts';
import { assetName, blobRefs, canvasIndexHtml, exportReadme, relativePath, rewriteRefs, standaloneBootstrap, standaloneDocument } from '../src/lib/export-html.ts';

const PAGE = PAPER.letter.height;
const MARGIN = breakMargin(PAGE);

/** Text lines `height` tall every `step` px from `from` to `to`. */
const lines = (from: number, to: number, step = 24, height = 20): Interval[] => {
  const out: Interval[] = [];
  for (let y = from; y + height <= to; y += step) out.push([y, y + height]);
  return out;
};
const inside = (cut: number, bands: readonly Interval[]) => bands.some(([a, b]) => a < cut && cut < b);

describe('Flow pagination', () => {
  it('reads the paper from the artboard entry', () => {
    assert.deepEqual(flowPaper({ print: 'flow', paper: 'a4' }), { paper: 'a4', width: 794, height: 1123 });
    assert.deepEqual(flowPaper({ print: 'flow' }), { paper: 'letter', width: 816, height: 1056 });
    assert.equal(flowPaper({ print: 'fixed', paper: 'a4' }), null);
    assert.equal(flowPaper({}), null);
    assert.equal(MARGIN, 53);
  });

  it('keeps a short document on one page', () => {
    assert.deepEqual(flowPages({ contentHeight: 900, bands: lines(72, 880), blocks: [] }, PAGE), [{ top: 0, bottom: 900, offset: 0 }]);
  });

  it('cuts between lines, leaving a break margin on each later page', () => {
    const bands = lines(0, 4000);
    const slices = flowPages({ contentHeight: 4000, bands, blocks: [] }, PAGE);
    assert.ok(slices.length >= 4);
    for (const [index, slice] of slices.entries()) {
      assert.ok(!inside(slice.top, bands), `page ${index} starts inside a line`);
      assert.equal(slice.offset, index === 0 ? 0 : MARGIN);
      // Content fits the page with the break margin below it (except on the last page).
      const room = PAGE - slice.offset - (index < slices.length - 1 ? MARGIN : 0);
      assert.ok(slice.bottom - slice.top <= room, `page ${index} overflows`);
      if (index > 0) assert.equal(slice.top, slices[index - 1]!.bottom);
    }
    assert.equal(slices.at(-1)!.bottom, 4000);
    // The first cut lands on the last line start above the page's room.
    assert.equal(slices[1]!.top, 984);
  });

  it('never cuts through a picture, but cuts one taller than a page where the page ends', () => {
    const picture: Interval = [900, 1200];
    const cut = paginate([...lines(0, 880), picture], 2000, PAGE, { overlap: MARGIN })[1]!;
    assert.equal(cut, 900);
    const tall: Interval = [100, 2100];
    assert.equal(paginate([tall], 2200, PAGE, { overlap: MARGIN })[1], PAGE - MARGIN);
  });

  it('keeps a heading with the line after it', () => {
    const before = lines(0, 950);
    const heading: Interval = [960, 990];
    const after = lines(996, 3000);
    const bands = [...before, heading, ...after];
    const blocks: KeepBlock[] = [{ top: 960, bottom: 990, from: 960, next: true, prev: false }];
    const plain = paginate(bands, 3000, PAGE, { overlap: MARGIN });
    assert.equal(plain[1], 996, 'without keeping, the heading would end the page');
    const keep = keepTogetherSpans(blocks, bands, PAGE);
    assert.deepEqual(keep, [[960, 990], [960, 1016]]);
    assert.equal(paginate(bands, 3000, PAGE, { overlap: MARGIN, keep })[1], 960);
  });

  it('drops a keep that would leave more than a quarter page empty', () => {
    const blocks: KeepBlock[] = [{ top: 960, bottom: 990, from: 960, next: true, prev: false }];
    // The next line is far below: keeping them together costs too much.
    assert.deepEqual(keepTogetherSpans(blocks, [[960, 990], [1300, 1320]], PAGE), [[960, 990]]);
    // A keep span starting far above the natural cut is ignored by the planner.
    const bands = lines(0, 3000);
    const far: Interval[] = [[500, 1010]];
    assert.equal(paginate(bands, 3000, PAGE, { overlap: MARGIN, keep: far })[1], paginate(bands, 3000, PAGE, { overlap: MARGIN })[1]);
  });

  it('keeps a caption below a picture with it', () => {
    const blocks: KeepBlock[] = [{ top: 1000, bottom: 1016, from: 800, next: false, prev: true }];
    assert.deepEqual(keepTogetherSpans(blocks, [[800, 990], [1000, 1016]], PAGE), [[1000, 1016], [800, 1016]]);
  });

  it('stops at the page limit', () => {
    const slices = flowPages({ contentHeight: 500_000, bands: [], blocks: [] }, PAGE);
    assert.equal(slices.length, MAX_FLOW_PAGES);
    assert.equal(pageSlices([0], 500, PAGE, MARGIN).length, 1);
  });
});

describe('the PDF text layer', () => {
  const word = (text: string, left: number, top: number, space = true): Word => ({ text, left, right: left + text.length * 8, top, bottom: top + 20, size: 16, space });

  it('joins words into lines and places them on their page in points', () => {
    const grouped = groupLines([word('Hello', 10, 100), word('world', 60, 100, false), word('Next', 10, 1200)]);
    assert.deepEqual(grouped.map((l) => l.text), ['Hello world', 'Next']);
    const first = pageRuns(grouped, { top: 0, bottom: 1003, offset: 0 }, 816, 0.75);
    assert.deepEqual(first.map((r) => r.text), ['Hello world']);
    assert.equal(first[0]!.x, 7.5);
    const second = pageRuns(grouped, { top: 984, bottom: 1934, offset: 53 }, 816, 0.75);
    assert.deepEqual(second.map((r) => r.text), ['Next']);
    assert.equal(second[0]!.baseline, (1216 - 984 + 53) * 0.75);
  });

  it('keeps web links only, clipped to the page', () => {
    const links = pageLinks(
      [
        { href: 'https://example.com', x: 10, y: 990, w: 100, h: 30 },
        { href: 'javascript:alert(1)', x: 10, y: 100, w: 100, h: 30 },
        { href: 'mailto:a@b.c', x: 10, y: 5000, w: 100, h: 30 },
      ],
      { top: 0, bottom: 1003, offset: 0 },
      816,
      1,
    );
    assert.deepEqual(links, [{ uri: 'https://example.com', x: 10, y: 990, width: 100, height: 13 }]);
    assert.equal(pageBookmark('Report', 0), 'Report');
    assert.equal(pageBookmark('Report', 1), undefined);
  });
});

describe('the HTML exports', () => {
  it('works out relative paths and upload names', () => {
    assert.equal(relativePath('', 'img/a.png'), 'img/a.png');
    assert.equal(relativePath('sub/', 'img/a.png'), '../img/a.png');
    assert.equal(relativePath('sub/', 'sub/a.png'), 'a.png');
    assert.equal(relativePath('a/b/', 'a/c/d.css'), '../c/d.css');
    assert.deepEqual(blobRefs('<img src="/_blob/abc"> url(/_blob/abc) "/_blob/x.png"'), ['/_blob/abc', '/_blob/x.png']);
    assert.equal(assetName('/_blob/abc', 'image/png'), 'assets/abc.png');
    assert.equal(assetName('/_blob/x.woff2', null), 'assets/x.woff2');
  });

  it('rewrites references in attributes and url(), not in prose', () => {
    const text = '<img src="./img/a.png"> <p>img/a.png</p> <div style="background: url(img/a.png)">';
    assert.equal(rewriteRefs(text, new Map([['img/a.png', 'data:x']])), '<img src="data:x"> <p>img/a.png</p> <div style="background: url(data:x)">');
  });

  it('builds one file that inlines the runtime, styles and images', () => {
    const source = `<!doctype html><html><head><title>A</title>\n<script src="./support.js"></script>\n<link rel="stylesheet" href="ds/x/tokens.css"></head><body><x-dc><img src="img/a.png"><dc-import name="Card"></dc-import></x-dc><script type="text/x-dc" data-dc-script>class Component extends DCLogic {}</script></body></html>`;
    const html = standaloneDocument({
      path: 'Main.dc.html',
      source,
      files: new Map<string, Uint8Array | string>([
        ['ds/x/tokens.css', ':root { --a: 1px; } .bg { background: url(../../img/a.png) }'],
        ['img/a.png', new Uint8Array([1, 2, 3])],
        ['Card.dc.html', '<x-dc><b>card</b></x-dc>'],
      ]),
      uploads: new Map(),
      runtime: 'var s = "</script>"; window.RUNTIME = 1;',
    });
    assert.ok(!html.includes('<script src="./support.js">'), 'the runtime tag is inlined');
    assert.ok(!html.includes('href="ds/x/tokens.css"'));
    assert.ok(html.includes('<style>\n:root { --a: 1px; } .bg { background: url(data:image/png;base64,AQID) }'));
    assert.ok(html.includes('<img src="data:image/png;base64,AQID">'));
    assert.ok(html.includes('<\\/script>'));
    assert.ok(html.includes('window.RUNTIME = 1'));
    assert.ok(html.includes('Card.dc.html'));
  });

  it('serves the embedded copies to the runtime’s fetch', async () => {
    const g = globalThis as unknown as { location?: unknown; window?: unknown; fetch: typeof fetch };
    const saved = { location: g.location, window: g.window, fetch: g.fetch };
    try {
      g.location = { href: 'file:///tmp/Main.html' };
      g.window = globalThis;
      g.fetch = async () => new Response('network');
      new Function(standaloneBootstrap('SELF', { 'Card.dc.html': 'CARD' }))();
      assert.equal(await (await fetch('file:///tmp/Main.html')).text(), 'SELF');
      assert.equal(await (await fetch(new URL('Card.dc.html', 'file:///tmp/').href)).text(), 'CARD');
      assert.equal(await (await fetch('https://example.com/x')).text(), 'network');
    } finally {
      g.location = saved.location;
      g.window = saved.window;
      g.fetch = saved.fetch;
    }
  });

  it('writes an index and a README for the canvas', () => {
    const boards = [
      { path: 'Home.dc.html', title: 'Home', width: 1280, height: 800, page: 'Web' },
      { path: 'sub/Report.dc.html', title: 'Report <1>', width: 816, height: 3000, page: 'Print' },
    ];
    const index = canvasIndexHtml('My design', boards);
    assert.ok(index.includes('<a href="Home.dc.html">Home</a>'));
    assert.ok(index.includes('Report &lt;1&gt;'));
    assert.ok(index.includes('<h2>Print</h2>'));
    const readme = exportReadme({ title: 'My design', boards, resources: ['ds/x/tokens.css'], assets: 2, missing: [{ ref: '/_blob/gone', usedIn: ['Home.dc.html'] }], runtimes: ['', 'sub/'] });
    assert.match(readme, /^# My design — design reference/);
    assert.ok(readme.includes('`index.html`'));
    assert.ok(readme.includes('`sub/support.js`'));
    assert.ok(readme.includes('2 uploaded files'));
    assert.ok(readme.includes('`/_blob/gone` (used in `Home.dc.html`)'));
    const stalled = exportReadme({ title: 'T', boards, resources: [], assets: 0, missing: [{ ref: '/_blob/slow', usedIn: ['Home.dc.html'], why: 'the download stopped responding' }], runtimes: [''] });
    assert.ok(stalled.includes('`/_blob/slow` (used in `Home.dc.html`): the download stopped responding'));
  });
});
