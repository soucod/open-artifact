/** What `@` finds: people, the agent, dates, the doc's tabs and its dropdowns. */
import type { DocEnum, DocFile } from '@open-artifact/runtime/doc-api';
import type { EditorView } from 'prosemirror-view';
import { orderedTabs } from '../app/store.ts';
import { insertDate, insertDropdownChip, insertMention } from './chips.ts';
import { addDays, dateFromWords, isoDate, parseIsoDate, today } from './dates.ts';
import type { MenuOption } from './plugin.ts';

export interface Person {
  id: string;
  name: string;
}

export interface MentionWorld {
  people: readonly Person[];
  files: readonly DocFile[];
  enums: readonly DocEnum[];
  /** The day "today" is. */
  today?: Date;
  /** Opens the ask prompt where the @ was typed; offered first, in place of the plain Agent mention. */
  askAgent?: (view: EditorView, at: number) => void;
}

const DATE_WORDS = 'date calendar due day when pick specific today tomorrow';

const wordsStart = (text: string, query: string) =>
  text
    .toLowerCase()
    .split(/[\s'’]+/)
    .some(word => word.startsWith(query));

const MAX_PEOPLE = 6;
const MAX_TABS = 5;

export function mentionOptions(rawQuery: string, world: MentionWorld): MenuOption[] {
  const query = rawQuery.trim().toLowerCase();
  const day = world.today ?? today();
  const found = (name: string) => !query || name.toLowerCase().startsWith(query) || wordsStart(name, query);
  const out: MenuOption[] = [];
  const agentFound = !query || 'agent'.startsWith(query) || wordsStart('ask agent', query);
  const askAgent = world.askAgent;

  if (agentFound && askAgent)
    out.push({
      id: 'ask-agent',
      label: 'Ask Agent',
      detail: 'Write or edit here',
      section: 'Agent',
      icon: 'agent',
      run: (view, range) => {
        view.dispatch(view.state.tr.delete(range.from, range.to));
        askAgent(view, range.from);
      },
    });

  for (const person of world.people.filter(person => found(person.name)).slice(0, MAX_PEOPLE))
    out.push({
      id: `person-${person.id}`,
      label: person.name,
      section: 'People',
      icon: 'person',
      run: (view, range) => insertMention(view, { principal: person.id, name: person.name }, range),
    });

  if (agentFound && !askAgent)
    out.push({
      id: 'agent',
      label: 'Agent',
      section: 'Agent',
      icon: 'agent',
      run: (view, range) => insertMention(view, { principal: 'agent', name: 'Agent' }, range),
    });

  const named = dateFromWords(query, day);
  const dates: MenuOption[] = [
    { id: 'date', label: 'Date', section: 'Dates', icon: 'date', run: (view, range) => insertDate(view, isoDate(day), { range, open: true }) },
    { id: 'date-today', label: "Today's date", section: 'Dates', icon: 'date', run: (view, range) => insertDate(view, isoDate(day), { range }) },
    { id: 'date-tomorrow', label: "Tomorrow's date", section: 'Dates', icon: 'date', run: (view, range) => insertDate(view, isoDate(addDays(day, 1)), { range }) },
  ];
  if (named && query !== 'today' && query !== 'tomorrow') {
    const date = parseIsoDate(named)!;
    out.push({
      id: `date-${named}`,
      label: date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }),
      section: 'Dates',
      icon: 'date',
      run: (view, range) => insertDate(view, named, { range }),
    });
  } else if (!query || wordsStart(DATE_WORDS, query) || 'date'.startsWith(query)) {
    const matching = dates.filter(option => query !== '' && wordsStart(option.label, query));
    out.push(...(matching.length ? matching : dates));
  }

  for (const file of orderedTabs(world.files).filter(file => found(file.name)).slice(0, MAX_TABS))
    out.push({
      id: `tab-${file.id}`,
      label: file.name,
      section: 'Tabs',
      icon: 'tab',
      run: (view, range) => insertMention(view, { principal: null, ref: file.id, label: null }, range),
    });

  if (query)
    for (const list of world.enums.filter(list => list.name && wordsStart(list.name, query)))
      out.push({
        id: `dropdown-${list.id}`,
        label: list.name,
        section: 'Dropdowns',
        icon: 'dropdown',
        run: (view, range) => {
          view.focus();
          insertDropdownChip(view, list.id, { range, open: true });
        },
      });

  return out;
}
