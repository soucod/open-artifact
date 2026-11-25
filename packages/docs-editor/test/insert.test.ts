import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DocEnum, DocEnumOption, DocFile } from '@open-artifact/runtime/doc-api';
import type { Node as PMNode } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { schema } from '../src/editor/schema.ts';
import { addMonths, dateFromWords, isoDate, monthGrid, parseIsoDate } from '../src/insert/dates.ts';
import {
  type Draft,
  addDraftOption,
  colorOf,
  defaultColor,
  draftOf,
  finishDraft,
  moveDraftOption,
  pickableOptions,
  resolveTyped,
  shownOptions,
  unusedTemplates,
  withOption,
} from '../src/insert/dropdown-model.ts';
import { searchEmoji } from '../src/insert/emoji.ts';
import { languagesFor } from '../src/insert/languages.ts';
import { mentionOptions } from '../src/insert/mentions.ts';
import { activeTrigger, findTrigger, insertKey, insertMenusPlugin, insertState } from '../src/insert/plugin.ts';
import { FEATURED_COUNT, ORDERED_ITEMS, type SlashPlace, slashItems, slashPlace } from '../src/insert/slash-items.ts';

const { nodes, marks } = schema;
const para = (...content: (string | PMNode)[]) => nodes.paragraph!.create(null, content.map(part => (typeof part === 'string' ? schema.text(part) : part)));
const doc = (...blocks: PMNode[]) => nodes.doc!.create(null, blocks);

/** A state with the caret at the end of the first block's text. */
function caretAtEnd(block: PMNode): EditorState {
  const d = doc(block);
  return EditorState.create({ doc: d, selection: TextSelection.create(d, 1 + block.content.size) });
}

const trigger = (text: string) => findTrigger(caretAtEnd(para(text)));
const anywhere: SlashPlace = { inTable: false, inQuoteOrItem: false, canPickImage: true };
const labels = (list: readonly { label: string }[]) => list.map(item => item.label);
const option = (name: string, order: number, disabled = false, color?: string): DocEnumOption => ({ name, order, disabled, ...(color ? { color } : {}) });

describe('typeahead triggers', () => {
  it('opens the slash menu at a word start only', () => {
    assert.deepEqual(trigger('/'), { kind: 'slash', from: 1, to: 2, query: '' });
    assert.deepEqual(trigger('see /tab'), { kind: 'slash', from: 5, to: 9, query: 'tab' });
    assert.equal(trigger('and/or'), null);
    assert.equal(trigger('a / '), null);
  });

  it('takes a few spaced words, as in `/code py`', () => {
    assert.equal(trigger('/code py')?.query, 'code py');
    assert.equal(trigger('/a b c d e'), null);
  });

  it('opens mentions, but not inside an email address', () => {
    assert.deepEqual(trigger('hi @ma'), { kind: 'mention', from: 4, to: 7, query: 'ma' });
    assert.equal(trigger('mail me@ex')?.kind, undefined);
  });

  it('opens emoji after a colon and two letters', () => {
    assert.deepEqual(trigger('nice :sm'), { kind: 'emoji', from: 6, to: 9, query: 'sm' });
    assert.equal(trigger('nice :s'), null);
    assert.equal(trigger('10:30'), null);
  });

  it('is off in code', () => {
    const block = nodes.codeBlock!.create(null, schema.text('/'));
    assert.equal(findTrigger(caretAtEnd(block)), null);
    assert.equal(findTrigger(caretAtEnd(para(schema.text('a /', [marks.code!.create()])))), null);
  });

  it('takes the trigger typed last', () => {
    assert.equal(trigger('@ann /h')?.kind, 'slash');
    assert.equal(trigger('/x @an')?.kind, 'mention');
  });
});

describe('menu state', () => {
  const start = () => {
    const d = doc(para('a'));
    return EditorState.create({ doc: d, selection: TextSelection.create(d, 2), plugins: [insertMenusPlugin()] });
  };
  const type = (state: EditorState, text: string) => state.apply(state.tr.insertText(text));

  it('follows typing, resets the highlighted row as the query changes, and stays shut once dismissed', () => {
    let state = type(start(), ' /');
    assert.deepEqual(activeTrigger(state), { kind: 'slash', from: 3, to: 4, query: '' });
    state = state.apply(state.tr.setMeta(insertKey, { index: 2 }));
    assert.equal(insertState(state)?.index, 2);
    state = type(state, 'h');
    assert.equal(insertState(state)?.index, 0);
    state = state.apply(state.tr.setMeta(insertKey, { dismiss: true }));
    assert.equal(activeTrigger(state), null);
    state = type(state, 'e');
    assert.equal(activeTrigger(state), null);
    state = type(state, ' ');
    state = type(state, '/');
    assert.equal(activeTrigger(state)?.from, 7);
  });

  it('keeps an open picker on its chip as text moves it, and drops it with the chip', () => {
    let state = start();
    state = state.apply(state.tr.replaceSelectionWith(nodes.date!.create({ ts: '2026-11-18' })));
    state = state.apply(state.tr.setMeta(insertKey, { open: { kind: 'date', pos: 2 } }));
    state = state.apply(state.tr.insertText('xy', 1));
    assert.equal(insertState(state)?.picker?.pos, 4);
    state = state.apply(state.tr.delete(4, 5));
    assert.equal(insertState(state)?.picker, null);
  });
});

describe('slash items', () => {
  it('leads with headings, table and dropdown, then the rest A to Z', () => {
    assert.deepEqual(labels(ORDERED_ITEMS.slice(0, FEATURED_COUNT)), ['Heading 1', 'Heading 2', 'Heading 3', 'Table', 'Dropdown']);
    assert.deepEqual(labels(ORDERED_ITEMS.slice(FEATURED_COUNT)), ['Bulleted list', 'Checklist', 'Code block', 'Date', 'Divider', 'Image', 'Numbered list', 'Quote']);
  });

  it('lists everything for an empty query', () => {
    assert.deepEqual(labels(slashItems('', anywhere)), labels(ORDERED_ITEMS));
  });

  it('filters by label start and by keyword', () => {
    assert.deepEqual(labels(slashItems('he', anywhere)), ['Heading 1', 'Heading 2', 'Heading 3']);
    assert.deepEqual(labels(slashItems('todo', anywhere)), ['Checklist']);
    assert.deepEqual(labels(slashItems('hr', anywhere)), ['Divider']);
    assert.deepEqual(labels(slashItems('bullet list', anywhere)), ['Bulleted list']);
    assert.deepEqual(labels(slashItems('horizontal rule', anywhere)), ['Divider']);
    assert.deepEqual(slashItems('zzzz', anywhere), []);
  });

  it('offers the dropdown templates from three letters', () => {
    assert.deepEqual(labels(slashItems('st', anywhere)).includes('Dropdown · Status'), false);
    assert.deepEqual(labels(slashItems('sta', anywhere)), ['Dropdown · Status', 'Dropdown']);
    assert.deepEqual(labels(slashItems('prio', anywhere)), ['Dropdown · Priority']);
  });

  it('offers a code block in a named language', () => {
    assert.deepEqual(labels(slashItems('code py', anywhere)), ['Code block · Python']);
    assert.deepEqual(labels(slashItems('py', anywhere)), ['Code block · Python']);
    assert.ok(labels(slashItems('ts', anywhere)).includes('Code block · TypeScript'));
    assert.deepEqual(labels(slashItems('code', anywhere))[0], 'Code block');
  });

  it('leaves out what does not fit the place', () => {
    const inTable = labels(slashItems('', { ...anywhere, inTable: true }));
    for (const left of ['Heading 1', 'Table', 'Divider', 'Quote', 'Code block']) assert.ok(!inTable.includes(left), left);
    assert.ok(inTable.includes('Checklist'));
    assert.ok(!labels(slashItems('', { ...anywhere, canPickImage: false })).includes('Image'));
    assert.ok(!labels(slashItems('', { ...anywhere, inQuoteOrItem: true })).includes('Quote'));
  });

  it('reads the place from the caret', () => {
    const cell = nodes.cell!.createAndFill()!;
    const table = nodes.table!.create(null, [nodes.tableRow!.create(null, [cell])]);
    const d = doc(table);
    let paraPos = -1;
    d.descendants((node, pos) => {
      if (paraPos < 0 && node.type === nodes.paragraph) paraPos = pos;
    });
    const state = EditorState.create({ doc: d, selection: TextSelection.create(d, paraPos + 1) });
    assert.equal(slashPlace(state).inTable, true);
    const quote = doc(nodes.blockquote!.create(null, [para('x')]));
    assert.equal(slashPlace(EditorState.create({ doc: quote, selection: TextSelection.create(quote, 3) })).inQuoteOrItem, true);
  });
});

describe('code languages', () => {
  it('needs two letters and finds aliases and slash words', () => {
    assert.deepEqual(languagesFor('p'), []);
    assert.deepEqual(
      languagesFor('ya').map(language => language.key),
      ['yaml'],
    );
    assert.deepEqual(
      languagesFor('js').map(language => language.key),
      ['javascript', 'json'],
    );
    assert.deepEqual(
      languagesFor('diag').map(language => language.key),
      ['mermaid'],
    );
  });
});

describe('emoji', () => {
  it('puts the exact name first, then names starting with it', () => {
    const hits = searchEmoji('smile');
    assert.equal(hits[0]?.code, 'smile');
    assert.equal(hits[0]?.emoji, '😄');
    assert.ok(hits.every(hit => hit.code.startsWith('smile')));
    assert.ok(searchEmoji('s').length <= 8);
    assert.deepEqual(searchEmoji(''), []);
  });
});

describe('dates', () => {
  const wednesday = new Date(2026, 10, 18);

  it('keeps local days as YYYY-MM-DD', () => {
    assert.equal(isoDate(wednesday), '2026-11-18');
    assert.equal(isoDate(parseIsoDate('2026-02-01')!), '2026-02-01');
    assert.equal(parseIsoDate('2026-02-30'), null);
    assert.equal(parseIsoDate(null), null);
    assert.equal(isoDate(addMonths(new Date(2026, 0, 31), 1)), '2026-02-28');
  });

  it('lays out six weeks from the first day of the week', () => {
    const grid = monthGrid(2026, 10, 0, '2026-11-18');
    assert.equal(grid.length, 42);
    assert.equal(grid[0]!.iso, '2026-11-01');
    assert.equal(grid.filter(day => day.inMonth).length, 30);
    assert.deepEqual(
      grid.filter(day => day.isToday).map(day => day.iso),
      ['2026-11-18'],
    );
    const mondays = monthGrid(2026, 10, 1, '');
    assert.equal(mondays[0]!.iso, '2026-10-26');
  });

  it('reads the words people type', () => {
    assert.equal(dateFromWords('today', wednesday), '2026-11-18');
    assert.equal(dateFromWords('Tomorrow', wednesday), '2026-11-19');
    assert.equal(dateFromWords('yesterday', wednesday), '2026-11-17');
    assert.equal(dateFromWords('fri', wednesday), '2026-11-20');
    assert.equal(dateFromWords('wednesday', wednesday), '2026-11-25');
    assert.equal(dateFromWords('2027-01-05', wednesday), '2027-01-05');
    assert.equal(dateFromWords('fr', wednesday), null);
    assert.equal(dateFromWords('soon', wednesday), null);
  });
});

describe('dropdown lists', () => {
  const status: DocEnum = { id: 'e1', name: 'Status', options: [option('Todo', 1), option('Done', 2, false, 'olive'), option('Old', 0, true)] };

  it('shows options by order and keeps their positions', () => {
    assert.deepEqual(
      shownOptions(status.options).map(entry => entry.index),
      [2, 0, 1],
    );
    assert.deepEqual(
      pickableOptions(status.options, null, '').map(entry => entry.option.name),
      ['Todo', 'Done'],
    );
    assert.deepEqual(
      pickableOptions(status.options, 2, '').map(entry => entry.option.name),
      ['Old', 'Todo', 'Done'],
    );
    assert.deepEqual(
      pickableOptions(status.options, null, 'do').map(entry => entry.option.name),
      ['Todo', 'Done'],
    );
  });

  it('colours options by their own colour or by position', () => {
    assert.equal(colorOf(status.options[1], 1), 'olive');
    assert.equal(colorOf(status.options[0], 0), defaultColor(0));
    assert.notEqual(defaultColor(0), 'gray');
    assert.equal(defaultColor(7), defaultColor(0));
  });

  it('picks, adds, or refuses typed text', () => {
    assert.deepEqual(resolveTyped(status.options, ' done '), { kind: 'pick', index: 1 });
    assert.deepEqual(resolveTyped(status.options, 'Blocked'), { kind: 'add', name: 'Blocked' });
    assert.deepEqual(resolveTyped(status.options, 'old'), { kind: 'none' });
    assert.deepEqual(resolveTyped(status.options, '  '), { kind: 'none' });
  });

  it('adds an option at the end, last in order', () => {
    const next = withOption(status, 'Blocked');
    assert.equal(next.index, 3);
    assert.equal(next.options.length, 4);
    assert.deepEqual(next.options[3], { name: 'Blocked', order: 3, disabled: false, color: defaultColor(3) });
  });

  it('edits a draft without moving saved options', () => {
    let draft: Draft = draftOf(status);
    draft = addDraftOption(draft);
    draft.options[3]!.name = 'Blocked';
    draft = addDraftOption(draft);
    draft = moveDraftOption(draft, 3, 0);
    draft.options[0]!.name = '';
    const saved = finishDraft(draft, status);
    assert.deepEqual(
      saved.options.map(entry => entry.name),
      ['Todo', 'Done', 'Old', 'Blocked'],
    );
    assert.equal(saved.options[3]!.order, 0);
    assert.equal(saved.options[2]!.disabled, true);
    assert.equal(saved.name, 'Status');
  });

  it('offers the templates the doc has no list for', () => {
    assert.deepEqual(
      unusedTemplates([status]).map(template => template.name),
      ['Priority'],
    );
  });
});

describe('mentions', () => {
  const tab = (id: string, name: string, order: string): DocFile => ({ id, name, order, rev: 1, content: { kind: 'node', id: `n-${id}`, engine: 'prose' } });
  const world = {
    people: [
      { id: 'u1', name: 'Mara Quinn' },
      { id: 'u2', name: 'Dev Patel' },
    ],
    files: [tab('t2', 'Notes', 'b'), tab('t1', 'Plan', 'a')],
    enums: [{ id: 'e1', name: 'Priority', options: [] }],
    today: new Date(2026, 10, 18),
  };

  it('lists people, the agent, dates and tabs for an empty query', () => {
    const all = mentionOptions('', world);
    assert.deepEqual(labels(all), ['Mara Quinn', 'Dev Patel', 'Agent', 'Date', "Today's date", "Tomorrow's date", 'Plan', 'Notes']);
    assert.deepEqual([...new Set(all.map(entry => entry.section))], ['People', 'Agent', 'Dates', 'Tabs']);
  });

  it('puts Ask Agent first, in place of the plain Agent mention, when the agent can be asked', () => {
    const all = mentionOptions('', { ...world, askAgent: () => {} });
    assert.deepEqual(labels(all).slice(0, 3), ['Ask Agent', 'Mara Quinn', 'Dev Patel']);
    assert.equal(labels(all).filter(label => label === 'Agent').length, 0);
  });

  it('matches any word of a name', () => {
    assert.deepEqual(labels(mentionOptions('qu', world)), ['Mara Quinn']);
    assert.deepEqual(labels(mentionOptions('ag', world)), ['Agent']);
    assert.deepEqual(labels(mentionOptions('ag', { ...world, askAgent: () => {} })), ['Ask Agent']);
    assert.deepEqual(labels(mentionOptions('no', world)), ['Notes']);
  });

  it('finds dates and dropdowns by name', () => {
    assert.deepEqual(labels(mentionOptions('tom', world)), ["Tomorrow's date"]);
    assert.deepEqual(
      mentionOptions('fri', world).map(entry => entry.id),
      ['date-2026-11-20'],
    );
    assert.deepEqual(
      mentionOptions('pri', world).map(entry => entry.section),
      ['Dropdowns'],
    );
  });
});
