import type { FunctionFamily } from '@open-artifact/sheets-core';
import { translateMessage } from '../i18n/messages.ts';
import { describeFunction } from '../formulas/function-help.ts';

/** A column offered by formula autocomplete: its heading and its cells as an address. */
export interface AutocompleteColumn {
  heading: string;
  cells: string;
}

/** A row of the formula autocomplete list: a function name or a column. */
export type AutocompleteRow = string | AutocompleteColumn;

/** The argument the caret is in, to be read out. */
export interface ArgumentToAnnounce {
  /** `null` when the function name is not to be read out. */
  functionName: string | null;
  number: number;
  /** `null` when the function takes any number of arguments. */
  count: number | null;
  argument: string;
  isOptional: boolean;
}

export function functionCategoryLabel(category: FunctionFamily): string {
  switch (category) {
    case 'math':
      return translateMessage({
        defaultMessage: 'Math',
        id: 'WseqOTZ0HH',
      });
    case 'statistical':
      return translateMessage({
        defaultMessage: 'Statistical',
        id: 'nL+3oFpsuw',
      });
    case 'logical':
      return translateMessage({
        defaultMessage: 'Logical',
        id: 'uhsYJxUDbl',
      });
    case 'lookup':
      return translateMessage({
        defaultMessage: 'Lookup',
        id: 'BIWEXblwqa',
      });
    case 'text':
      return translateMessage({
        defaultMessage: 'Text',
        id: 'Npii+gy9xJ',
      });
    case 'dateAndTime':
      return translateMessage({
        defaultMessage: 'Date and time',
        id: '7MtbhY0W+U',
      });
    case 'financial':
      return translateMessage({
        defaultMessage: 'Financial',
        id: 'v/G0OSXVuH',
      });
  }
}
export function functionNameWithDescription(functionName: string): string {
  let description = describeFunction(functionName)?.description;
  if (description === undefined) return functionName;
  return translateMessage(
    {
      defaultMessage: '{name}. {description}',
      id: 'fRgWZsoPVR',
    },
    {
      name: functionName,
      description,
    },
  );
}
export function functionArgumentWords({
  functionName,
  number,
  count,
  argument,
  isOptional,
}: ArgumentToAnnounce): string {
  let canBe = isOptional ? 'leftOut' : 'other';
  if (functionName !== null && count !== null)
    return translateMessage(
      {
        defaultMessage:
          '{canBe, select, leftOut {{functionName}, argument {number} of {count}: {argument}, optional} other {{functionName}, argument {number} of {count}: {argument}}}',
        id: 'lULrFCuZh2',
      },
      {
        canBe,
        functionName,
        number,
        count,
        argument,
      },
    );
  if (functionName !== null)
    return translateMessage(
      {
        defaultMessage:
          '{canBe, select, leftOut {{functionName}, argument {number}: {argument}, optional} other {{functionName}, argument {number}: {argument}}}',
        id: 'MCQzYaxyV9',
      },
      {
        canBe,
        functionName,
        number,
        argument,
      },
    );
  if (count !== null)
    return translateMessage(
      {
        defaultMessage:
          '{canBe, select, leftOut {Argument {number} of {count}: {argument}, optional} other {Argument {number} of {count}: {argument}}}',
        id: 'FcHVknxLGP',
      },
      {
        canBe,
        number,
        count,
        argument,
      },
    );
  return translateMessage(
    {
      defaultMessage: '{canBe, select, leftOut {Argument {number}: {argument}, optional} other {Argument {number}: {argument}}}',
      id: '/zepenytWd',
    },
    {
      canBe,
      number,
      argument,
    },
  );
}
export const formulaAutocompleteLabel = (hasColumns: boolean): string =>
  hasColumns
    ? translateMessage({
        defaultMessage: 'Columns and functions',
        id: 'sOksXd7bOt',
      })
    : translateMessage({
        defaultMessage: 'Functions',
        id: 'yxQoYaGQHk',
      });
export const functionListLabel = () =>
  translateMessage({
    defaultMessage: 'Functions',
    id: 'IHwpZjJEln',
  });
export const autocompleteColumnsHeading = () =>
  translateMessage({
    defaultMessage: 'Columns',
    id: 'QYjcmFEMdM',
  });
export const autocompleteFunctionsHeading = () =>
  translateMessage({
    defaultMessage: 'Functions',
    id: '4Tle03spNC',
  });
export const autocompleteColumnWords = (row: AutocompleteRow): string =>
  typeof row === 'string'
    ? functionNameWithDescription(row)
    : translateMessage(
        {
          defaultMessage: '{heading}, {cells}',
          id: 'GN0BiFfCCi',
        },
        {
          heading: row.heading,
          cells: row.cells,
        },
      );
export const autocompleteRowWords = (heading: string, row: AutocompleteRow): string =>
  translateMessage(
    {
      defaultMessage: '{heading}: {row}',
      id: 'r+Q8k9rQbO',
    },
    {
      heading,
      row: autocompleteColumnWords(row),
    },
  );
export const functionWithoutArgumentsWords = (functionName: string): string =>
  translateMessage(
    {
      defaultMessage: '{functionName}, no arguments',
      id: 'IhIu6eAA4b',
    },
    {
      functionName,
    },
  );
