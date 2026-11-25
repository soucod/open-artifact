import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkDataProject, dataHistoryIgnores, DASH_META_PATH, scaffoldDataProject } from '../src/index.ts';
import type { CheckFinding, DataCheckContext } from '../src/index.ts';

const BLOB = '0123456789abcdef0123456789abcdef';
const json = (value: unknown): string => JSON.stringify(value);
const project = (documents: Record<string, unknown>): Map<string, string> =>
  new Map(Object.entries(documents).map(([path, value]) => [path, typeof value === 'string' ? value : json(value)]));
const errors = (findings: CheckFinding[]): [string, string][] =>
  findings.filter((finding) => finding.level === 'error').map((finding) => [finding.file, finding.message]);

const GOOD = {
  'dash/meta': { title: 'Sales' },
  'dash/params': { region: 'EU' },
  'datasets/sales': {
    title: 'Sales',
    source: { kind: 'call', connector: 'db', tool: 'run_sql', args: { sql: 'select {{region}}' }, rules: { region: { enum: ['EU', 'US'] } } },
  },
  'datasets/costs': {
    title: 'Costs',
    source: { kind: 'file', url: `/_blob/${BLOB}`, name: 'costs.csv' },
    updated: { at: '2026-01-01T00:00:00Z', by: 'agent' },
  },
  'dash/look': {
    light: { ground: '#f6f1e9', text: '#2b2620' },
    dark: { ground: '#1a1a1a' },
    tweaks: { palette: 'Clay', size: 'large', corners: null },
  },
  'files/index.html': { text: `<b data-source="sales" data-field="n"></b><div data-source="costs"></div><img src="/_blob/${BLOB}">` },
  'data/users/owner/check': { at: 1 },
};
const CONTEXT: DataCheckContext = {
  blobExists: (id) => id === BLOB,
  readBlob: (id) => (id === BLOB ? 'region,amount\nEU,1\n' : null),
  connectors: new Set(['db']),
};

describe('scaffold', () => {
  it('makes an empty dashboard whose check has no errors', () => {
    const files = scaffoldDataProject('Q3 sales');
    assert.deepEqual(Object.keys(files), [DASH_META_PATH]);
    assert.deepEqual(JSON.parse(files[DASH_META_PATH] as string), { title: 'Q3 sales' });
    const findings = checkDataProject(new Map(Object.entries(files)));
    assert.deepEqual(errors(findings), []);
    assert.deepEqual(findings.map((finding) => finding.level), ['info']);
  });
});

describe('history', () => {
  it('leaves out what the page saves under data/ and drafts', () => {
    assert.equal(dataHistoryIgnores('data/users/owner/check.json'), true);
    assert.equal(dataHistoryIgnores('drafts/abc/files/index.html.json'), true);
    assert.equal(dataHistoryIgnores('versions/1.json'), false);
    assert.equal(dataHistoryIgnores('datasets/sales.json'), false);
    assert.equal(dataHistoryIgnores('dash/meta.json'), false);
    assert.equal(dataHistoryIgnores('data/team/notes/n1.json'), true);
    assert.equal(dataHistoryIgnores('database/x.json'), false);
  });

  it('leaves out dash/settings but keeps the rest of dash/', () => {
    assert.equal(dataHistoryIgnores('dash/settings.json'), true);
    assert.equal(dataHistoryIgnores('/dash/settings'), true);
    assert.equal(dataHistoryIgnores('dash/settings/x.json'), false);
    assert.equal(dataHistoryIgnores('dash/look.json'), false);
  });
});

describe('check', () => {
  it('passes a sound dashboard', () => {
    const findings = checkDataProject(project(GOOD), CONTEXT);
    assert.deepEqual(errors(findings), []);
    assert.deepEqual(findings.filter((finding) => finding.level === 'warning'), []);
  });

  it('names documents that are not JSON objects', () => {
    const findings = checkDataProject(project({ ...GOOD, 'datasets/bad': '{nope', 'datasets/list': [] }));
    assert.deepEqual(errors(findings).map(([file]) => file), ['db/datasets/bad.json', 'db/datasets/list.json']);
    assert.match(errors(findings)[0]?.[1] ?? '', /^is not a JSON object/);
  });

  it('reports a missing marker and page', () => {
    const findings = checkDataProject(project({ 'datasets/costs': GOOD['datasets/costs'] }));
    assert.deepEqual(errors(findings).map(([file]) => file), ['db/dash/meta.json', 'db/files/index.html.json']);
  });

  it('reports sources the page would refuse', () => {
    const findings = checkDataProject(
      project({
        ...GOOD,
        'datasets/nosource': { title: 'x' },
        'datasets/rows': { title: 'x', source: { kind: 'rows', rows: [] } },
        'datasets/unruled': { title: 'x', source: { kind: 'call', connector: 'db', tool: 'run', args: { sql: 'select {{region}}' } } },
        'datasets/lookaround': {
          title: 'x',
          source: { kind: 'call', connector: 'db', tool: 'run', args: { sql: '{{region}}' }, rules: { region: { pattern: '(?=E)EU' } } },
        },
        'datasets/refused': { title: 'x', source: { kind: 'call', connector: 'db', tool: 'run', args: {}, rules: { region: { bogus: 1 } } } },
        'datasets/nofile': { title: 'x', source: { kind: 'file', url: 'https://example.com/a.csv', name: 'a.csv' } },
        'datasets/gone': { title: 'x', source: { kind: 'file', url: `/_blob/${'f'.repeat(32)}`, name: 'a.csv' } },
      }),
      CONTEXT,
    );
    const byFile = new Map<string, string[]>();
    for (const [file, message] of errors(findings)) byFile.set(file, [...(byFile.get(file) ?? []), message]);
    assert.deepEqual([...byFile.keys()].sort(), [
      'db/datasets/gone.json',
      'db/datasets/lookaround.json',
      'db/datasets/nofile.json',
      'db/datasets/nosource.json',
      'db/datasets/refused.json',
      'db/datasets/rows.json',
      'db/datasets/unruled.json',
    ]);
    assert.match(byFile.get('db/datasets/unruled.json')?.[0] ?? '', /\{\{region\}\} is written into the query’s text with no rule/);
    assert.match(byFile.get('db/datasets/lookaround.json')?.[0] ?? '', /lookaround/);
    assert.match(byFile.get('db/datasets/gone.json')?.[0] ?? '', /no such attached file/);
    assert.match(byFile.get('db/datasets/rows.json')?.[0] ?? '', /old rows dataset/);
  });

  it('reports filters, look and tweaks it would drop', () => {
    const findings = checkDataProject(
      project({
        ...GOOD,
        'dash/params': { region: 'EU', '9bad': 1, nested: { a: 1 } },
        'dash/look': { light: { ground: '#111111' }, tweaks: { palette: 'Neon', glow: true } },
      }),
    );
    const messages = findings.map((finding) => `${finding.level} ${finding.file} ${finding.message}`);
    assert.ok(messages.some((message) => message.startsWith('error db/dash/params.json "9bad" is not a parameter name')));
    assert.ok(messages.some((message) => message.startsWith('error db/dash/params.json nested: a default is')));
    assert.ok(messages.some((message) => message.startsWith('error db/dash/look.json has no set the dashboard can use')));
    assert.ok(messages.some((message) => message.startsWith('error db/dash/look.json light.ground #111111 is on the wrong side')));
    assert.ok(messages.some((message) => message.startsWith('warning db/dash/look.json tweaks.palette "Neon"')));
    assert.ok(messages.some((message) => message.startsWith('warning db/dash/look.json tweaks.glow isn’t read')));
  });

  it('warns about a page naming a file that is not stored', () => {
    const findings = checkDataProject(
      project({ ...GOOD, 'files/index.html': { text: `${GOOD['files/index.html'].text}<img src="/_blob/${'e'.repeat(32)}">` } }),
      CONTEXT,
    );
    assert.deepEqual(
      findings.filter((finding) => finding.level === 'warning').map((finding) => finding.file),
      ['db/files/index.html.json'],
    );
  });

  it('reports what the page leaves unused or unmarked, and connectors the owner lacks', () => {
    const findings = checkDataProject(
      project({
        ...GOOD,
        'datasets/extra': { title: 'Extra', source: { kind: 'call', connector: 'crm', tool: 'list' } },
        'files/index.html': { text: `${GOOD['files/index.html'].text}<script src="app.js"></script>` },
        'files/app.js': { text: 'const rows = dash.data("extra");' },
      }),
      CONTEXT,
    );
    const lines = findings.map((finding) => `${finding.level} ${finding.file} ${finding.message}`);
    assert.ok(lines.some((line) => line.startsWith('warning db/datasets/extra.json source.connector "crm" isn’t set up and turned on in connectors.json (db)')));
    assert.ok(lines.some((line) => line.startsWith('error db/datasets/extra.json files/app.js reads it, but no element is marked data-source="extra"')));
    const none = checkDataProject(project({ ...GOOD, 'datasets/extra': { title: 'Extra', source: { kind: 'call', connector: 'crm', tool: 'list' } } }), {
      ...CONTEXT,
      connectors: null,
    });
    const noneLines = none.map((finding) => `${finding.level} ${finding.file} ${finding.message}`);
    assert.ok(noneLines.some((line) => line.includes('there is no connectors.json')));
    assert.ok(noneLines.some((line) => line.startsWith('warning db/datasets/extra.json nothing on the page names it')));
  });

  it('reports file datasets the page would warn about', () => {
    const findings = checkDataProject(
      project({
        ...GOOD,
        'datasets/costs': { title: 'Costs', source: { kind: 'file', url: `/_blob/${BLOB}`, name: 'costs' }, edit: { by: 'x' } },
      }),
      CONTEXT,
    );
    const lines = findings.map((finding) => `${finding.level} ${finding.message}`);
    assert.ok(lines.some((line) => line.startsWith('error needs updated')));
    assert.ok(lines.some((line) => line.startsWith('warning source.format is left out and the file name doesn’t say')));
    assert.ok(lines.some((line) => line.startsWith('warning edit is the page’s {by, byAt}')));
  });

  it('accepts the page\'s own edit stamp and only notes one the agent wrote', () => {
    const stamped = (edit: unknown): string[] =>
      checkDataProject(project({ ...GOOD, 'datasets/costs': { ...GOOD['datasets/costs'], edit } }), CONTEXT)
        .filter((finding) => finding.file === 'db/datasets/costs.json')
        .map((finding) => `${finding.level} ${finding.message}`);
    assert.deepEqual(stamped({ by: 'owner', byAt: 5 }), []);
    const agent = stamped({ via: 'agent', at: '2026-01-01T00:00:00Z' });
    assert.equal(agent.length, 1);
    assert.match(agent[0] ?? '', /^warning edit holds \{via, at\}, which the page ignores; leave edit out/);
  });

  it('accepts a JSON file that is not rows and a text file without a loader', () => {
    const files = new Map([[BLOB, '{"total": 84, "parts": {"a": 1}}'], ['f'.repeat(32), 'free text']]);
    const context: DataCheckContext = { ...CONTEXT, blobExists: (id) => files.has(id), readBlob: (id) => files.get(id) ?? null };
    const findings = checkDataProject(
      project({
        ...GOOD,
        'datasets/costs': { ...GOOD['datasets/costs'], source: { kind: 'file', url: `/_blob/${BLOB}`, name: 'costs.json', format: 'json' } },
        'datasets/notes': {
          title: 'Notes',
          source: { kind: 'file', url: `/_blob/${'f'.repeat(32)}`, name: 'notes.txt', format: 'text' },
          updated: { at: '2026-01-01T00:00:00Z', by: 'agent' },
        },
        'files/index.html': { text: '<b data-source="sales" data-field="n"></b><div data-source="costs"></div><div data-source="notes"></div>' },
      }),
      context,
    );
    assert.deepEqual(errors(findings), []);
    files.set(BLOB, '{not json');
    const broken = errors(checkDataProject(project({ ...GOOD, 'datasets/costs': { ...GOOD['datasets/costs'], source: { kind: 'file', url: `/_blob/${BLOB}`, name: 'costs.json' } } }), context));
    assert.deepEqual(broken.map(([file]) => file), ['db/datasets/costs.json']);
    assert.match(broken[0]?.[1] ?? '', /^the file isn’t valid JSON/);
  });

  it('reads what the owner\'s open page reported, and says when it is older than the page', () => {
    const check = { v: 1, status: 'failed', at: 1, page: [{ kind: 'error', name: 'TypeError', message: 'x is undefined', count: 2 }] };
    const runs = { datasets: { sales: { status: 'error', message: 'connector down', at: 1 } } };
    const documents = project({ ...GOOD, 'data/users/owner/check': check, 'data/users/owner/runs': runs });
    const fresh = checkDataProject(documents, { ...CONTEXT, modifiedAt: () => 10 });
    const freshErrors = errors(fresh);
    assert.ok(freshErrors.some(([file, message]) => file === 'db/data/users/owner/runs.json' && message === 'the open page says sales error: connector down.'));
    assert.ok(freshErrors.some(([file, message]) => file === 'db/data/users/owner/check.json' && message.startsWith('the page\'s code threw: TypeError (2)')));
    const placed = { ...check, page: [{ kind: 'stopped', name: 'TypeError', file: 'app.js', where: 'dash.draw("trend")' }] };
    const where = errors(checkDataProject(project({ ...GOOD, 'data/users/owner/check': placed }), { ...CONTEXT, modifiedAt: () => 10 }));
    assert.ok(where.some(([, message]) => message.startsWith('the page\'s code stopped: TypeError in app.js, where dash.draw("trend");')));
    const stale = checkDataProject(documents, { ...CONTEXT, modifiedAt: (path) => (path.startsWith('files/') ? 20 : 10) });
    assert.deepEqual(errors(stale), []);
    assert.ok(stale.some((finding) => finding.level === 'warning' && finding.message.includes('a page file changed after the page wrote this')));
  });
});

describe('saved rows', () => {
  const withStore = (path: unknown): CheckFinding[] =>
    checkDataProject(
      project({
        ...GOOD,
        'datasets/notes': { title: 'Notes', source: { kind: 'store', path } },
        'files/index.html': { text: '<b data-source="sales" data-field="n"></b><div data-source="costs"></div><ul data-source="notes"></ul>' },
      }),
      CONTEXT,
    );
  const storeErrors = (path: unknown): string[] =>
    errors(withStore(path))
      .filter(([file]) => file === 'db/datasets/notes.json')
      .map(([, message]) => message);

  it('accepts a collection, a document and a viewer\'s own path, with no rows yet', () => {
    for (const path of ['data/team/notes', 'data/team/notes/today', 'data/users/me/notes', 'data/a.b~c:d@e+f/x_y-z'])
      assert.deepEqual(storeErrors(path), [], path);
    assert.deepEqual(withStore('data/team/notes').filter((finding) => finding.file === 'db/datasets/notes.json'), []);
  });

  it('refuses paths that cannot hold saved rows, each with its reason', () => {
    assert.match(storeErrors(undefined)[0] ?? '', /^source\.path is missing/);
    assert.match(storeErrors('datasets/sales')[0] ?? '', /isn’t under data\//);
    assert.match(storeErrors('data/te am')[0] ?? '', /each part is 1–200 of/);
    assert.match(storeErrors('data/../x')[0] ?? '', /each part is 1–200 of/);
    assert.match(storeErrors(`data/${Array.from({ length: 16 }, () => 'a').join('/')}`)[0] ?? '', /more than 16 parts/);
    for (const path of ['data/users/me', 'data/users/me/check', 'data/users/owner/runs', 'data/users/me/page', 'data/users/me/history-sales'])
      assert.match(storeErrors(path)[0] ?? '', /one of the page’s own reports/, path);
  });

  it('lists the store among the kinds a source can have', () => {
    const findings = checkDataProject(project({ ...GOOD, 'datasets/odd': { title: 'Odd', source: { kind: 'sheet' } } }), CONTEXT);
    assert.ok(errors(findings).some(([, message]) => message === 'source.kind "sheet" isn’t one the page loads; use "call", "file" or "store".'));
  });
});
