import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { parseCellLink, type Json, type JsonObject, type SheetWalkthrough } from '@open-artifact/sheets-core';
import { runSheetCall, type SheetCallHost } from '../src/sheets/cli.ts';
import { SheetStore } from '../src/sheets/store.ts';

const folders: string[] = [];
const stores: SheetStore[] = [];
after(() => {
  for (const store of stores) store.close();
  for (const folder of folders) fs.rmSync(folder, { recursive: true, force: true });
});

function newStore(): SheetStore {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sheets-interactives-'));
  folders.push(root);
  const store = new SheetStore({ root, log: () => {} });
  stores.push(store);
  return store;
}

const CODE = "export default () => <sheet.Visualize data-component='panel' sources={{rows: {kind: 'ref', ref: 'input/rows', adapter: {kind: 'cells'}}}}>{({rows}) => <svg width='480' height='280' role='img' aria-label='Plan'>{rows.slice(1).map((row, j) => <rect key={j} x={16 + j * 40} y={40} width={20} height={20} />)}</svg>}</sheet.Visualize>;\n";

/** A Sheet with a data tab (Data: a header, two rates and a formula) and a blank tab for a panel (Panel). */
function planned(): SheetStore {
  const store = newStore();
  const rows = [['Rate', 'Years'], [0.05, 10], [true, 'note'], ['=A2*2', null]];
  assert.deepEqual(store.agentUpdate({ kind: 'applyEdits', base: 0, edits: [
    { kind: 'renameSheet', sheet: 'Sheet1', name: 'Data' },
    { kind: 'writeCells', sheet: 'Data', topLeft: 'A1', rows },
    { kind: 'addSheet', name: 'Panel' },
  ] }), { revision: 2 });
  return store;
}

const panel = (widget: string, more: JsonObject = {}): JsonObject => ({
  sheet: 'Panel',
  name: 'Plan',
  caption: 'Try other rates.',
  widget,
  inputs: [
    { name: 'rows', cells: { sheet: 'Data', range: 'A1:B3' } },
    { name: 'rate', cells: { sheet: 'Data', range: 'A2' } },
  ],
  writable: ['rate'],
  ...more,
});

/** Makes a widget and the panel that draws with it in one batch; answers the widget's id. */
function addPanel(store: SheetStore, base: number, more: JsonObject = {}): string {
  const answer = store.agentBatch([
    { $lid: 'w', verb: 'create', payload: { code: CODE } },
    { verb: 'update', payload: { kind: 'applyEdits', base, edits: [{ kind: 'addInteractive', interactive: panel('$lid:w', more) }] } },
  ]);
  return (answer.lids as Record<string, string>).w!;
}

const refusalOf = (call: () => unknown): string | undefined => {
  try {
    call();
  } catch (error) {
    return (error as { body?: { data?: { refusal?: string } } }).body?.data?.refusal;
  }
  return undefined;
};

const update = (store: SheetStore, base: number, edits: Json[]) => () => store.agentUpdate({ kind: 'applyEdits', base, edits });
const widgetOf = (store: SheetStore): string => {
  const made = store.agentWidget({ action: 'create', code: CODE });
  assert.equal(typeof made.minted, 'string', JSON.stringify(made));
  return made.minted as string;
};

describe('interactive panels', () => {
  it('makes a panel on a blank tab, and reads it back with readInteractive and readSheets', () => {
    const store = planned();
    const widget = addPanel(store, 2);
    const read = store.agentRead({ kind: 'readInteractive', sheet: 'Panel' });
    const interactive = read.interactive as JsonObject;
    assert.equal(read.sheet, 'Panel');
    assert.match(String(interactive.interactiveId), /^viw_.+\.0$/);
    assert.deepEqual({ ...interactive, interactiveId: null }, {
      interactiveId: null,
      name: 'Plan',
      caption: 'Try other rates.',
      widget,
      inputs: [
        { name: 'rows', cells: { sheet: 'Data', range: 'A1:B3' } },
        { name: 'rate', cells: { sheet: 'Data', range: 'A2' } },
      ],
      writable: ['rate'],
    });
    assert.equal(store.agentRead({ kind: 'readInteractive', sheet: 'Data' }).interactive, null);

    const sheets = store.agentRead({ kind: 'readSheets' }).sheets as JsonObject[];
    const [data, tab] = sheets;
    assert.match(String(data!.linkFragment), /^sheet-[A-Za-z0-9._-]+$/);
    assert.equal(data!.interactiveId, undefined);
    assert.equal(tab!.interactiveId, interactive.interactiveId);
    // A panel is no chart: readCharts leaves it out, and the chart edits refuse it.
    assert.deepEqual(store.agentRead({ kind: 'readCharts', sheet: 'Panel' }).charts, []);
    const revision = store.agentRead({ kind: 'readSheets' }).revision as number;
    assert.equal(refusalOf(update(store, revision, [{ kind: 'deleteChart', chartId: interactive.interactiveId as string }])), 'unknownChart');
  });

  it('refuses a panel on a tab that is not blank, or one given wrong', () => {
    const store = planned();
    const w = widgetOf(store);
    // Widgets live beside the log: making one leaves the revision as it is.
    const base = store.agentRead({ kind: 'readSheets' }).revision as number;
    const at = (interactive: JsonObject) => update(store, base, [{ kind: 'addInteractive', interactive }]);
    assert.equal(refusalOf(at(panel(w, { sheet: 'Data' }))), 'sheetNotBlank');
    assert.equal(refusalOf(at({ ...panel(w), extra: 1 })), 'unreadableEdit');
    assert.equal(refusalOf(at(panel(w, { writable: ['rate', 'rate'] }))), 'unreadableEdit');
    assert.equal(refusalOf(at(panel(w, { writable: ['nowhere'] }))), 'unknownInput');
    assert.equal(refusalOf(at(panel(w, { inputs: [{ name: 'interactive', cells: { sheet: 'Data', range: 'A1' } }], writable: [] }))), 'inputNameNotAllowed');
    assert.equal(refusalOf(at(panel(w, { inputs: [{ name: 'here', cells: { sheet: 'Panel', range: 'A1' } }], writable: [] }))), 'sheetIsAnInteractive');
    // A writable cell holds a plain value or nothing: A4 holds a formula.
    assert.equal(refusalOf(at(panel(w, { inputs: [{ name: 'f', cells: { sheet: 'Data', range: 'A4' } }], writable: ['f'] }))), 'cannotWriteInteractiveCell');
    assert.equal(refusalOf(at(panel(w, { inputs: [{ name: 'many', cells: { sheet: 'Data', range: 'A1:Z100' } }], writable: ['many'] }))), 'tooManyCells');
    assert.equal(refusalOf(at(panel('w_none'))), 'unknownWidget');
    // Blank, booleans and text are writable too.
    assert.doesNotThrow(at(panel(w, { inputs: [{ name: 'mixed', cells: { sheet: 'Data', range: 'A3:C3' } }], writable: ['mixed'] })));
    // The tab now shows a panel: a second one is refused.
    const w2 = widgetOf(store);
    assert.equal(refusalOf(update(store, base + 1, [{ kind: 'addInteractive', interactive: panel(w2) }])), 'sheetNotBlank');
  });
});

describe('cell links and walkthroughs', () => {
  it('reads a cell link', () => {
    assert.deepEqual(parseCellLink('#sheet-sht_ab.0~a2-d2~B1'), { sheetId: 'sht_ab.0', ranges: ['A2:D2', 'B1'] });
    assert.deepEqual(parseCellLink('sheet-sht_ab.0'), { sheetId: 'sht_ab.0', ranges: [] });
    assert.equal(parseCellLink('#sheet-sht_ab.0~A0'), null);
    assert.equal(parseCellLink('#tab-sht_ab.0~A1'), null);
    assert.equal(parseCellLink(`#sheet-${'x'.repeat(130)}~A1`), null);
  });

  it('shows a walkthrough on the host, checks its stops, and gives reads the page address', () => {
    const store = planned();
    const fragment = (store.agentRead({ kind: 'readSheets' }).sheets as JsonObject[])[0]!.linkFragment as string;
    const shown: SheetWalkthrough[] = [];
    const host: SheetCallHost = { artifactUrl: 'http://127.0.0.1:1/sheets/t/', showWalkthrough: (w) => (shown.push(w), true) };
    const guide = (stops: Json, on: SheetCallHost = host) => runSheetCall(store, { name: 'read', args: { payload: { kind: 'showGuide', guide: { stops } } } }, on);
    const stop = { at: `#${fragment}~A2-B2~B1`, say: 'The rate and the years.' };

    assert.deepEqual(guide([stop]), { shown: true });
    assert.deepEqual(shown, [{ stops: [stop] }]);
    assert.deepEqual(guide([stop], {}), { shown: false });

    const refused = (stops: Json) => refusalOf(() => guide(stops));
    assert.equal(refused([]), 'unreadableRead');
    assert.equal(refused(Array.from({ length: 31 }, () => stop)), 'unreadableRead');
    assert.equal(refused([{ ...stop, say: 'x'.repeat(601) }]), 'unreadableRead');
    assert.equal(refused([{ ...stop, say: '  ' }]), 'unreadableRead');
    assert.equal(refused([{ ...stop, at: `#${fragment}` }]), 'unreadableRead');
    assert.equal(refused([{ ...stop, at: '#sheet-sht_none.0~A1' }]), 'unknownSheetName');
    assert.equal(refused([{ ...stop, at: `#${fragment}~ZZZ9999999` }]), 'outsideTheSheet');
    assert.equal(refusalOf(() => runSheetCall(store, { name: 'read', args: { payload: { kind: 'showGuide' } } }, host)), 'unreadableRead');
    assert.equal(shown.length, 1);

    const read = runSheetCall(store, { name: 'read', args: {} }, host) as JsonObject;
    assert.deepEqual(read.frame, { artifactUrl: 'http://127.0.0.1:1/sheets/t/' });
    assert.equal((runSheetCall(store, { name: 'read', args: {} }) as JsonObject).frame, undefined);
    const cells = runSheetCall(store, { name: 'read', args: { payload: { kind: 'readCells', sheet: 'Data', range: 'A1' } } }, host) as JsonObject;
    assert.equal(cells.frame, undefined);
  });
});

describe('walkthroughs on a running server', () => {
  it("gives a walkthrough to the owner's open page, and a read the page's address", async () => {
    const { createTypeServer } = await import('../src/index.ts');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sheets-walkthrough-server-'));
    folders.push(dir);
    const assets = path.join(dir, 'assets');
    fs.mkdirSync(path.join(assets, 'editors', 'sheets'), { recursive: true });
    fs.writeFileSync(path.join(assets, 'editors', 'sheets', 'index.html'), '<!doctype html><title>Sheets</title>');
    const root = path.join(dir, 'Plan');
    const secret = 'walkthrough-secret';
    const server = createTypeServer({ assetsDir: assets, secret, idleMs: 0, types: ['sheets'], log: () => undefined });
    await server.listen();
    const abort = new AbortController();
    try {
      const opened = await server.open({ root, type: 'sheets', title: 'Plan' });
      const page = new URL(opened.url);
      const action = async (name: string, args: unknown): Promise<JsonObject> => {
        const response = await fetch(new URL(`/__open-artifact/actions/${name}`, page), {
          method: 'POST',
          headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
          body: JSON.stringify({ id: opened.id, root, args }),
        });
        return (await response.json()) as JsonObject;
      };
      const read = await action('read', {});
      assert.deepEqual(read.frame, { artifactUrl: opened.url });
      const fragment = (read.sheets as JsonObject[])[0]!.linkFragment as string;
      const guide = { stops: [{ at: `#${fragment}~A1`, say: 'Start here.' }] };
      assert.deepEqual(await action('read', { payload: { kind: 'showGuide', guide } }), { shown: false });

      // An open page's event stream hears it under its own event name.
      const response = await fetch(new URL('_api/events?client=w1', page), { signal: abort.signal });
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let text = '';
      const heard = (async () => {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) return null;
          text += decoder.decode(chunk.value, { stream: true });
          const found = /event: sheetWalkthrough\ndata: (.*)\n/.exec(text);
          if (found) return JSON.parse(found[1]!) as JsonObject;
        }
      })();
      // The stream is attached once its first frames arrive.
      for (let i = 0; i < 50 && !text.includes('event: sheet\n'); i++) await new Promise((done) => setTimeout(done, 20));
      assert.deepEqual(await action('read', { payload: { kind: 'showGuide', guide } }), { shown: true });
      assert.deepEqual(await heard, guide);
    } finally {
      abort.abort();
      await server.stop();
    }
  });
});
