import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CalculationContext, CalculationReport, Parameters } from '@open-artifact/data-core';
import { CALC_SPEC_MESSAGE, collectDependencies, createCalculationEngine, getFunctionCode } from '../src/data/calc-engine.ts';
import { calculationReportToDataset, dedentFunctionCode, getCalculationRun, humanizeIdentifier } from '../src/data/calculations.ts';

type InputStatus = ReturnType<CalculationContext['input']>['status'];

function harness(sources: Record<string, { status: InputStatus; rows: unknown[] }>) {
  const reports: CalculationReport[] = [];
  let params: Parameters = { region: 'North' };
  const stateVersions = new Map<string, number>();
  const context: CalculationContext = {
    now: () => 42,
    has: (id) => Object.hasOwn(sources, id),
    input: (id) => sources[id] ?? { status: 'missing', rows: [] },
    stateOf: (id) => [sources[id], stateVersions.get(id) ?? 0],
    post: (report) => void reports.push(report),
    params: () => params,
  };
  const engine = createCalculationEngine(context);
  return {
    engine,
    reports,
    sources,
    touch(id: string) {
      stateVersions.set(id, (stateVersions.get(id) ?? 0) + 1);
    },
    setParams(next: Parameters) {
      params = next;
    },
  };
}

describe('calculation engine', () => {
  it('runs over its inputs and reports once per change', () => {
    const { engine, reports } = harness({ orders: { status: 'ok', rows: [{ n: 1 }, { n: 4 }] } });
    engine.define('total', { inputs: ['orders'], fn: (rows: { n: number }[]) => rows.reduce((sum, row) => sum + row.n, 0), description: 'Sum' });
    assert.deepEqual(engine.data('total'), { status: 'ok', value: 5, message: '' });
    engine.data('total');
    assert.equal(reports.length, 1);
    assert.equal(reports[0].id, 'total');
    assert.equal(reports[0].result, 5);
    assert.equal(reports[0].description, 'Sum');
    assert.equal(reports[0].at, 42);
    assert.deepEqual(engine.under('total'), ['orders']);
  });

  it('memoizes on its inputs’ state', () => {
    let runs = 0;
    const { engine, touch, sources } = harness({ orders: { status: 'ok', rows: [{ n: 1 }] } });
    engine.define('count', { inputs: ['orders'], fn: (rows: unknown[]) => (runs++, rows.length) });
    engine.data('count');
    engine.data('count');
    assert.equal(runs, 1);
    sources.orders = { status: 'ok', rows: [{ n: 1 }, { n: 2 }] };
    touch('orders');
    assert.equal(engine.data('count').value, 2);
    assert.equal(runs, 2);
  });

  it('waits on loading inputs and says which failed', () => {
    const { engine } = harness({ a: { status: 'loading', rows: [] }, b: { status: 'error', rows: [] } });
    engine.define('wait', { inputs: ['a'], fn: () => 1 });
    engine.define('fail', { inputs: ['b', 'gone'], fn: () => 1 });
    assert.equal(engine.data('wait').status, 'loading');
    const failed = engine.data('fail');
    assert.equal(failed.status, 'error');
    assert.equal(failed.message, 'b didn’t load, gone isn’t in this dashboard.');
  });

  it('chains calculations and lists the sources under them', () => {
    const { engine } = harness({ orders: { status: 'ok', rows: [{ n: 2 }] } });
    engine.define('doubled', { inputs: ['orders'], fn: (rows: { n: number }[]) => rows.map((row) => ({ n: row.n * 2 })) });
    engine.define('sum', { inputs: ['doubled'], fn: (rows: { n: number }[]) => rows.reduce((total, row) => total + row.n, 0) });
    assert.equal(engine.data('sum').value, 4);
    assert.deepEqual(engine.under('sum'), ['doubled', 'orders']);
  });

  it('refuses cycles', () => {
    const { engine, reports } = harness({});
    engine.define('a', { inputs: ['b'], fn: () => 1 });
    engine.define('b', { inputs: ['a'], fn: () => 1 });
    engine.define('self', { inputs: ['self'], fn: () => 1 });
    const a = engine.data('a');
    assert.equal(a.status, 'error');
    assert.equal(a.message, 'a and b use each other, so they can’t run.');
    assert.equal(engine.data('b').message, a.message);
    assert.equal(engine.data('self').message, 'self uses itself, so it can’t run.');
    assert.deepEqual(reports.find((report) => report.id === 'a')?.cantRun, { code: 'calcLoop', ids: ['a', 'b'] });
  });

  it('turns a throw into an error and a bad spec into the spec message', () => {
    const { engine } = harness({ orders: { status: 'ok', rows: [] } });
    engine.define('boom', {
      inputs: ['orders'],
      fn: () => {
        throw new Error('Kaboom');
      },
    });
    engine.define('bad', { inputs: [], fn: () => 1 });
    assert.deepEqual(engine.data('boom'), { status: 'error', value: null, message: 'Kaboom' });
    assert.equal(engine.data('bad').message, CALC_SPEC_MESSAGE);
    assert.equal(engine.data('nothing').message, 'No calculation “nothing” on this page.');
  });

  it('refuses a calculation input that isn’t plain data', () => {
    const { engine } = harness({ orders: { status: 'ok', rows: [] } });
    engine.define('fn', { inputs: ['orders'], fn: () => () => 1 });
    engine.define('uses', { inputs: ['fn'], fn: (value: unknown) => value });
    assert.equal(engine.data('uses').message, 'What fn returned isn’t plain data, so this didn’t run.');
  });

  it('runs again when a filter it read changes', () => {
    let runs = 0;
    const { engine, setParams } = harness({ orders: { status: 'ok', rows: [] } });
    engine.define('region', {
      inputs: ['orders'],
      fn: () => {
        runs++;
        return engine.params().region;
      },
    });
    engine.define('plain', { inputs: ['orders'], fn: () => (runs++, 0) });
    assert.equal(engine.data('region').value, 'North');
    engine.data('plain');
    assert.equal(runs, 2);
    setParams({ region: 'South' });
    assert.equal(engine.data('region').value, 'South');
    engine.data('plain');
    assert.equal(runs, 3);
  });
});

describe('calculations as sources', () => {
  it('collects dependencies through calculations', () => {
    const graph: Record<string, string[]> = { c: ['b', 'x'], b: ['a'] };
    assert.deepEqual([...collectDependencies(['c'], (id) => graph[id])].sort(), ['a', 'b', 'c', 'x']);
  });

  it('lists a report as a calc dataset and resolves its run', () => {
    const report: CalculationReport = {
      id: 'salesByRegion',
      inputs: ['orders'],
      code: '',
      title: '',
      description: '',
      status: 'ok',
      result: [{ region: 'North', n: 1 }],
      error: '',
      at: 5,
    };
    const dataset = calculationReportToDataset(report);
    assert.equal(dataset.title, 'Sales by region');
    assert.equal(calculationReportToDataset(report), dataset);
    assert.equal(dataset.source.kind, 'calc');
    if (dataset.source.kind !== 'calc') return;
    const orders = { id: 'orders', title: 'Orders', description: '', source: { kind: 'file', url: 'x', name: 'x', format: 'csv' }, updated: null, schedule: '', staleAfterHours: null } as const;
    const okRun = getCalculationRun(dataset.source, (id) => (id === 'orders' ? orders : undefined), () => ({ status: 'ok', at: 9, table: { columns: [], rows: [] } }));
    assert.equal(okRun.status, 'ok');
    assert.equal(okRun.status === 'ok' && okRun.at, 9);
    const gone = getCalculationRun(dataset.source, () => undefined, () => ({ status: 'idle' }));
    assert.equal(gone.status, 'failed');
    assert.equal('message' in gone && gone.message, 'Nothing in this dashboard is called orders, so this didn’t run.');
  });

  it('uses the earliest input time, weighing live queries and stale files ahead of fresh files', () => {
    const baseReport: CalculationReport = {
      id: 'combined',
      inputs: ['a', 'b'],
      code: '',
      title: '',
      description: '',
      status: 'ok',
      result: [{ total: 1 }],
      error: '',
      at: 999,
    };
    const calc = calculationReportToDataset(baseReport);
    assert.equal(calc.source.kind, 'calc');
    if (calc.source.kind !== 'calc') return;

    const fileA = { id: 'a', title: 'A', description: '', source: { kind: 'file', url: 'a', name: 'a.csv', format: 'csv' }, updated: { at: 100, by: 'owner' }, schedule: '', staleAfterHours: null } as const;
    const fileB = { id: 'b', title: 'B', description: '', source: { kind: 'file', url: 'b', name: 'b.csv', format: 'csv' }, updated: { at: 500, by: 'owner' }, schedule: '', staleAfterHours: null } as const;
    const twoFiles = getCalculationRun(
      calc.source,
      (id) => (id === 'a' ? fileA : id === 'b' ? fileB : undefined),
      (id) => ({ status: 'ok', at: id === 'a' ? 100 : 500, table: { columns: [], rows: [] } }),
    );
    assert.equal(twoFiles.status === 'ok' && twoFiles.at, 100);

    const liveB = { id: 'b', title: 'B', description: '', source: { kind: 'query', connector: 'crm', tool: 'q', args: '{}' }, updated: null, schedule: '', staleAfterHours: null } as const;
    const liveAndFreshFile = getCalculationRun(
      calc.source,
      (id) => (id === 'a' ? fileA : id === 'b' ? liveB : undefined),
      (id) => ({ status: 'ok', at: id === 'a' ? 100 : 500, table: { columns: [], rows: [] } }),
    );
    assert.equal(liveAndFreshFile.status === 'ok' && liveAndFreshFile.at, 500);

    const staleFileA = { ...fileA, staleAfterHours: 1 };
    const liveAndStaleFile = getCalculationRun(
      calc.source,
      (id) => (id === 'a' ? staleFileA : id === 'b' ? liveB : undefined),
      (id) => ({ status: 'ok', at: id === 'a' ? 100 : 500, table: { columns: [], rows: [] } }),
    );
    assert.equal(liveAndStaleFile.status === 'ok' && liveAndStaleFile.at, 100);
  });

  it('formats names and code', () => {
    assert.equal(humanizeIdentifier('monthly_signups'), 'Monthly signups');
    assert.equal(dedentFunctionCode('(x) => {\n    return x;\n  }'), '(x) => {\n  return x;\n}');
    assert.match(getFunctionCode((x: number) => x + 1), /x \+ 1/);
  });
});
