import {
  isValidDatasetId,
  sanitizeSingleLine,
  sanitizeText,
  type CalculationContext,
  type CalculationData,
  type CalculationDefinition,
  type CalculationEngine,
  type CalculationFunction,
  type CalculationResult,
  type LoadWording,
  type Parameters,
} from '@open-artifact/data-core';
import { cloneJsonData, errorToMessage, joinConjunction } from './util.ts';

export const CALC_SPEC_MESSAGE = 'dash.calc takes an id and {inputs, fn, description}, with one or more ids in inputs, each once.';

function calculationErrorResult(message: string): CalculationResult {
  return { data: { status: 'error', value: null, message } };
}

function invalidCalculationResult(message: string, wording: LoadWording): CalculationResult {
  return { ...calculationErrorResult(message), cantRun: wording };
}

function calculationCycleResult(ids: string[]): CalculationResult {
  return invalidCalculationResult(
    ids.length === 1 ? `${String(ids[0])} uses itself, so it can’t run.` : `${joinConjunction(ids)} use each other, so they can’t run.`,
    { code: 'calcLoop', ids },
  );
}

function tryCloneCalculationValue(value: unknown): { copy?: unknown } {
  try {
    return { copy: structuredClone(value) };
  } catch {
    return {};
  }
}

/** Every id reachable from `ids` through `next` (the ids themselves included). */
export function collectDependencies(
  ids: Iterable<string>,
  next: (id: string) => Iterable<string> | undefined,
  into: Set<string> = new Set(),
): Set<string> {
  for (const id of ids) {
    if (into.has(id)) continue;
    into.add(id);
    collectDependencies(next(id) ?? [], next, into);
  }
  return into;
}

/** A function's source text, or `""`. */
export function getFunctionCode(value: unknown): string {
  try {
    return typeof value === 'function' ? Function.prototype.toString.call(value) : '';
  } catch {
    return '';
  }
}

/**
 * The page's calculations (`dash.calc`): each runs on copies of its inputs (sources or other calculations) once they
 * loaded, is memoized on their state (and on the filters when it read them), refuses cycles, and reports each change.
 */
export function createCalculationEngine(context: CalculationContext): CalculationEngine {
  const now = context.now ?? Date.now;
  const definitions = new Map<string, CalculationDefinition>();
  const memoized = new Map<string, { keys: unknown[]; filters: string | null; out: CalculationResult }>();
  const reportedKeys = new Map<string, string>();
  let paramsReads = 0;

  const readParameters = (): Parameters => {
    paramsReads++;
    return { ...context.params() };
  };
  const getCalculationInputs = (id: string): string[] | undefined => (context.has(id) ? undefined : definitions.get(id)?.inputs);
  const getUnderlyingSources = (id: string): string[] | undefined => {
    const definition = definitions.get(id);
    return definition === undefined ? undefined : [...collectDependencies(definition.inputs, getCalculationInputs)];
  };
  const findDependencyCycle = (id: string, definition: CalculationDefinition): string[] => {
    const reachable = collectDependencies(definition.inputs, getCalculationInputs);
    if (getCalculationInputs(id) === undefined || !reachable.has(id)) return [];
    return [...reachable].filter((other) => collectDependencies(getCalculationInputs(other) ?? [], getCalculationInputs).has(id)).sort();
  };

  const define = (id: unknown, options: unknown): void => {
    if (!isValidDatasetId(id)) return;
    const spec = typeof options === 'object' && options !== null ? (options as Record<string, unknown>) : {};
    const inputs = spec.inputs;
    const fn = typeof spec.fn === 'function' ? (spec.fn as CalculationFunction) : null;
    const valid =
      fn !== null && Array.isArray(inputs) && inputs.length > 0 && inputs.every(isValidDatasetId) && new Set(inputs).size === inputs.length;
    definitions.set(id, {
      inputs: valid ? [...(inputs as string[])] : [],
      fn: valid ? fn : null,
      code: getFunctionCode(fn),
      title: sanitizeSingleLine(spec.title),
      description: typeof spec.description === 'string' ? sanitizeSingleLine(spec.description) : '',
    });
    memoized.delete(id);
  };

  const evaluate = (definition: CalculationDefinition, resolved: (CalculationResult | null)[]): CalculationResult => {
    const fn = definition.fn;
    if (fn === null) return invalidCalculationResult(CALC_SPEC_MESSAGE, { code: 'calcTakesSpec' });
    const notPlain = definition.inputs.filter((_, index) => {
      const result = resolved[index];
      return result != null && result.data.status === 'ok' && !Object.hasOwn(result, 'copy');
    });
    if (notPlain.length > 0)
      return invalidCalculationResult(`What ${joinConjunction(notPlain)} returned isn’t plain data, so this didn’t run.`, {
        code: 'calcInputNotPlain',
        ids: notPlain,
      });
    const inputs = definition.inputs.map((id, index) => {
      const result = resolved[index] ?? null;
      if (result !== null) return { status: result.data.status, stopped: `${id} didn’t run`, give: () => structuredClone(result.copy) };
      const input = context.input(id);
      return {
        status: input.status,
        stopped: `${id}${input.status === 'missing' ? ' isn’t in this dashboard' : ' didn’t load'}`,
        give: () => (input.value === undefined || typeof input.value === 'string' ? [...input.rows] : structuredClone(input.value)),
      };
    });
    const stopped = inputs.filter((input) => input.status !== 'ok' && input.status !== 'loading');
    if (stopped.length > 0) return calculationErrorResult(`${stopped.map((input) => input.stopped).join(', ')}.`);
    if (inputs.some((input) => input.status === 'loading')) return { data: { status: 'loading', value: null, message: '' } };
    let value: unknown;
    try {
      value = fn(...inputs.map((input) => input.give()));
    } catch (error) {
      const message = sanitizeText(errorToMessage(error));
      return calculationErrorResult(message.trim() === '' ? 'It threw an error with no message.' : message);
    }
    return { data: { status: 'ok', value, message: '' }, ...tryCloneCalculationValue(value) };
  };

  const postReport = (id: string, definition: CalculationDefinition, { data, cantRun }: CalculationResult): void => {
    const { fn: _fn, ...fields } = definition;
    const report = {
      id,
      ...fields,
      status: data.status,
      result: data.status === 'ok' ? cloneJsonData(data.value) : undefined,
      error: data.message,
      cantRun,
    };
    const key = JSON.stringify(report);
    if (reportedKeys.get(id) === key) return;
    reportedKeys.set(id, key);
    context.post({ ...report, at: now() });
  };

  const getMemoized = (id: string, keys: unknown[], compute: () => CalculationResult): CalculationResult => {
    const entry = memoized.get(id);
    const filters = JSON.stringify(context.params());
    if (
      entry !== undefined &&
      (entry.filters ?? filters) === filters &&
      entry.keys.length === keys.length &&
      entry.keys.every((key, index) => key === keys[index])
    )
      return entry.out;
    const readsBefore = paramsReads;
    const out = compute();
    memoized.set(id, { keys, filters: paramsReads > readsBefore ? filters : null, out });
    const definition = definitions.get(id);
    if (definition !== undefined) postReport(id, definition, out);
    return out;
  };

  const resolve = (id: string, definition: CalculationDefinition, seen: Map<string, CalculationResult>): CalculationResult => {
    const known = seen.get(id);
    if (known !== undefined) return known;
    const cycle = findDependencyCycle(id, definition);
    for (const member of cycle) seen.set(member, getMemoized(member, cycle, () => calculationCycleResult(cycle)));
    if (cycle.length > 0) return seen.get(id)!;
    const resolved = definition.inputs.map((input) =>
      getCalculationInputs(input) === undefined ? null : resolve(input, definitions.get(input)!, seen),
    );
    const out = getMemoized(
      id,
      definition.inputs.flatMap((input, index) => {
        const result = resolved[index];
        return result ? [result] : context.stateOf(input);
      }),
      () => evaluate(definition, resolved),
    );
    seen.set(id, out);
    return out;
  };

  const data = (id: string): CalculationData => {
    const definition = definitions.get(id);
    if (definition === undefined) return { status: 'error', value: null, message: `No calculation “${id}” on this page.` };
    return resolve(id, definition, new Map()).data;
  };

  return {
    define,
    data,
    params: readParameters,
    under: getUnderlyingSources,
    ids: () => definitions.keys(),
  };
}
