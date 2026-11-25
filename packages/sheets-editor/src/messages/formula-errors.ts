import type { ErrorValue } from '@open-artifact/sheets-core';
import { translateMessage, MESSAGE_LOCALE } from '../i18n/messages.ts';

/** Why a cell shows its error, in terms short enough to tell in a sentence. */
export type ErrorTell =
  | {
      cause:
        | 'holdsTheError'
        | 'dividesByAWrittenZero'
        | 'refersToItself'
        | 'cellsAreGone'
        | 'wrongKindOrSize'
        | 'quotationMarkNotClosed'
        | 'parenthesisNotClosed'
        | 'tooManyClosingParentheses'
        | 'curlyBracketNotClosed'
        | 'notOnlyValuesInCurlyBrackets'
        | 'rowsOfDifferentLengthsInCurlyBrackets'
        | 'somethingMissingAtTheEnd'
        | 'readIfEnteredAgain'
        | 'sheetEndsTooSoon'
        | 'pivotTotalsNothing'
        | 'pivotWithColumnsTotalsSeveral';
    }
  | {
      cause:
        | 'comesFromACellFurtherBack'
        | 'usesACellWithTheSameError'
        | 'dividesByAnEmptyCell'
        | 'dividesByAZeroCell'
        | 'refersBackToItself'
        | 'textInArithmetic'
        | 'holdsANestedSubtotal'
        | 'filledCellInTheWay'
        | 'earlierFormulaKeepsTheCells';
      /** The cell's address. */
      cell: string;
    }
  | { cause: 'spilledTextInArithmetic'; cell: string; from: string }
  | { cause: 'filledByANestedSubtotal'; cells: string }
  | { cause: 'filledCellsInTheWay'; count: number; cells: string }
  | { cause: 'fewFilledCellsOnTwoSidesInTheWay'; cells: string[] }
  | { cause: 'manyFilledCellsOnTwoSidesInTheWay'; count: number }
  | { cause: 'noSuchCell' | 'noSuchCellInARange'; address: string }
  | {
      cause: 'lookupFoundNothing' | 'noSuchFunction' | 'functionWithoutParentheses' | 'unknownName' | 'rangesOfDifferentSizes' | 'noSuchSheet';
      name: string;
    }
  | { cause: 'missingArgument' | 'severalCellsForOneValue' | 'argumentIsNoReference'; name: string; argument: string }
  | { cause: 'incompletePair'; name: string; first: string; second: string }
  | { cause: 'filterKeepsNothing'; name: string; argument: string; hasSeveralConditions: boolean }
  | { cause: 'includeOfAnotherSize'; name: string; include: string; range: string; canBeARow: boolean }
  | { cause: 'conditionsOfAnotherSize'; name: string; range: string; canBeARow: boolean }
  | { cause: 'noSuchColumnToSortBy'; name: string; range: string; columns: number; column: number }
  | { cause: 'orderNotRead'; name: string; order: string }
  | { cause: 'wordIsNotRead'; name: string; word: string }
  | { cause: 'functionCodeSkipsHiddenRows'; name: string; functionCode: number; codeThatCountsHiddenRows: number }
  | { cause: 'wrongSignBetweenArguments'; rightSign: string }
  | { cause: 'tooManyArguments'; name: string; most: number; given: number; isOnlyCount: boolean };

/** A cell's error and, when one is known, why it shows. */
export interface ErrorExplanation {
  code: ErrorValue;
  tell: ErrorTell | null;
}

export function errorCodeExplanation(code: ErrorValue, canEdit: boolean): string {
  switch (code) {
    case '#TIMEOUT!':
      return canEdit
        ? formulasTookTooLongWords()
        : translateMessage({
            defaultMessage: 'Formulas took too long. Ask someone who can edit this Sheet to remove or simplify some.',
            id: 'L1IpremG5D',
          });
    case '#DIV/0!':
      return translateMessage({
        defaultMessage: 'Something divides by 0 or by an empty cell, or has too few numbers to work with.',
        id: 'osG8gWVPPZ',
      });
    case '#N/A':
      return translateMessage({
        defaultMessage: 'A value isn’t available, or a function has the wrong number of arguments.',
        id: '18C1gAGMBR',
      });
    case '#NAME?':
      return translateMessage({
        defaultMessage: 'Sheets doesn’t know a name in this formula or in a cell it uses.',
        id: 'WGuoePpSau',
      });
    case '#REF!':
      return translateMessage({
        defaultMessage: 'Something refers back to itself, to deleted cells, or to cells past the end of a range.',
        id: '+vzM5jaejQ',
      });
    case '#VALUE!':
      return translateMessage({
        defaultMessage: 'Most often, there’s text where a number should be.',
        id: 'FmRdOzjHPL',
      });
    case '#NUM!':
      return translateMessage({
        defaultMessage: 'Most often, a number is too large or outside what a function accepts.',
        id: 'bpjURmnWib',
      });
    case '#ERROR!':
      return translateMessage({
        defaultMessage: 'Sheets can’t read this formula. Check it for a typo.',
        id: 'b8T34RTmMI',
      });
    case '#NULL!':
      return translateMessage({
        defaultMessage: '#NULL! is written into this formula or into a cell it uses.',
        id: 'rB8jbogk/h',
      });
    case '#SPILL!':
      return translateMessage({
        defaultMessage: 'There isn’t room to show all of a formula’s results.',
        id: 'Xmy5NAspiB',
      });
  }
}
export function errorTellExplanation(tell: ErrorTell, code: ErrorValue): string {
  switch (tell.cause) {
    case 'comesFromACellFurtherBack':
      return translateMessage(
        {
          defaultMessage: 'This error comes from {cell}.',
          id: 'q+0St8bxgA',
        },
        {
          cell: tell.cell,
        },
      );
    case 'usesACellWithTheSameError':
      return translateMessage(
        {
          defaultMessage: 'This formula uses {cell}, which shows the same error.',
          id: 'rd4Z1G90p4',
        },
        {
          cell: tell.cell,
        },
      );
    case 'holdsTheError':
      return translateMessage(
        {
          defaultMessage: '{code} is written into the formula, so the cell shows it.',
          id: '1Jjtkzqz4b',
        },
        {
          code,
        },
      );
    case 'dividesByAWrittenZero':
      return translateMessage({
        defaultMessage: 'The formula divides by 0.',
        id: 'Zb8zP8Zbtu',
      });
    case 'dividesByAnEmptyCell':
      return translateMessage(
        {
          defaultMessage: 'The formula divides by {cell}, which is empty.',
          id: '+UneOQ03nT',
        },
        {
          cell: tell.cell,
        },
      );
    case 'dividesByAZeroCell':
      return translateMessage(
        {
          defaultMessage: 'The formula divides by {cell}, which is 0.',
          id: 'QbcOdaNLtr',
        },
        {
          cell: tell.cell,
        },
      );
    case 'missingArgument':
      return translateMessage(
        {
          defaultMessage: '{name} is missing its “{argument}” argument.',
          id: 'LKJRLwf9kj',
        },
        {
          name: tell.name,
          argument: tell.argument,
        },
      );
    case 'incompletePair':
      return translateMessage(
        {
          defaultMessage: '{name} takes “{first}” and “{second}” in pairs, and one pair is incomplete.',
          id: 'hWbTh6Mzyt',
        },
        {
          name: tell.name,
          first: tell.first,
          second: tell.second,
        },
      );
    case 'lookupFoundNothing':
      return translateMessage(
        {
          defaultMessage: '{name} didn’t find what it looked for.',
          id: '/pJfP5O0IR',
        },
        {
          name: tell.name,
        },
      );
    case 'noSuchFunction':
      return translateMessage(
        {
          defaultMessage: 'Sheets doesn’t have a function called “{name}”.',
          id: 'WnGnhldg+n',
        },
        {
          name: tell.name,
        },
      );
    case 'functionWithoutParentheses':
      return translateMessage(
        {
          defaultMessage: '{name} is a function, so it needs parentheses after it. To use it as text, put quotation marks around it in your formula.',
          id: 'tL3QbMyQRI',
        },
        {
          name: tell.name,
        },
      );
    case 'noSuchCell':
      return translateMessage(
        {
          defaultMessage: 'This sheet has no cell {address}. To use it as text, put quotation marks around it in your formula.',
          id: 'uBXpmXTI0F',
        },
        {
          address: tell.address,
        },
      );
    case 'unknownName':
      return translateMessage(
        {
          defaultMessage: 'Sheets doesn’t know the name “{name}”. To use it as text, put quotation marks around it in your formula.',
          id: 'Vo/ImMDuP5',
        },
        {
          name: tell.name,
        },
      );
    case 'refersToItself':
      return translateMessage({
        defaultMessage: 'The formula refers to its own cell.',
        id: 'QHghXWMwGd',
      });
    case 'refersBackToItself':
      return translateMessage(
        {
          defaultMessage: 'The formula refers back to its own cell through {cell}.',
          id: 'z7EVQVevwM',
        },
        {
          cell: tell.cell,
        },
      );
    case 'cellsAreGone':
      return translateMessage({
        defaultMessage: 'The #REF! in the formula stands for cells that were deleted or are off the sheet.',
        id: 'g7FeFFFPzk',
      });
    case 'textInArithmetic':
      return translateMessage(
        {
          defaultMessage: '{cell} holds text, and the formula needs a number there.',
          id: 'qjmPmWQMI/',
        },
        {
          cell: tell.cell,
        },
      );
    case 'spilledTextInArithmetic':
      return translateMessage(
        {
          defaultMessage: '{cell} shows text from the formula in {from}, and this formula needs a number there.',
          id: 'rD01bm9p5C',
        },
        {
          cell: tell.cell,
          from: tell.from,
        },
      );
    case 'filterKeepsNothing':
      if (tell.hasSeveralConditions)
        return translateMessage(
          {
            defaultMessage: 'Nothing meets all of {name}’s conditions. To show something instead, add its “{argument}” argument.',
            id: '+7vP0zN0Vh',
          },
          {
            name: tell.name,
            argument: tell.argument,
          },
        );
      return translateMessage(
        {
          defaultMessage: 'Nothing meets {name}’s condition. To show something instead, add its “{argument}” argument.',
          id: 'fy6tkIJ4Hd',
        },
        {
          name: tell.name,
          argument: tell.argument,
        },
      );
    case 'includeOfAnotherSize':
      if (!tell.canBeARow)
        return translateMessage(
          {
            defaultMessage: 'Make {name}’s “{include}” one column as tall as its “{range}”.',
            id: '+1fBeELO+L',
          },
          {
            name: tell.name,
            include: tell.include,
            range: tell.range,
          },
        );
      return translateMessage(
        {
          defaultMessage: 'Make {name}’s “{include}” one column as tall as its “{range}”, or one row as wide.',
          id: 'ot4xS/05N+',
        },
        {
          name: tell.name,
          include: tell.include,
          range: tell.range,
        },
      );
    case 'conditionsOfAnotherSize':
      if (!tell.canBeARow)
        return translateMessage(
          {
            defaultMessage: 'Make all of {name}’s conditions columns as tall as its “{range}”.',
            id: '/SpLJ3i74/',
          },
          {
            name: tell.name,
            range: tell.range,
          },
        );
      return translateMessage(
        {
          defaultMessage: 'Make all of {name}’s conditions columns as tall as its “{range}”, or all rows as wide.',
          id: 'SzHtJO5zcz',
        },
        {
          name: tell.name,
          range: tell.range,
        },
      );
    case 'severalCellsForOneValue':
      return translateMessage(
        {
          defaultMessage: '{name}’s “{argument}” takes one value, not a range.',
          id: '0f5uWtzDmv',
        },
        {
          name: tell.name,
          argument: tell.argument,
        },
      );
    case 'rangesOfDifferentSizes':
      return translateMessage(
        {
          defaultMessage: 'All the ranges in {name} need the same number of rows and columns.',
          id: 'dYyMZnXdkJ',
        },
        {
          name: tell.name,
        },
      );
    case 'wordIsNotRead':
      return translateMessage(
        {
          defaultMessage: '{name} can’t use “{word}” here.',
          id: '/fr4INTkaM',
        },
        {
          name: tell.name,
          word: tell.word,
        },
      );
    case 'pivotTotalsNothing':
      return translateMessage({
        defaultMessage: 'PIVOT needs a way to total, such as “sum”, and a column.',
        id: 'NMJLuEatF2',
      });
    case 'pivotWithColumnsTotalsSeveral':
      return translateMessage({
        defaultMessage: 'With a “columns field”, PIVOT totals only one field.',
        id: '1FvqZTH8+B',
      });
    case 'noSuchColumnToSortBy':
      return translateMessage(
        {
          defaultMessage:
            '{columns, plural, one {{name}’s “{range}” has # column, so there’s no column {column, number} to sort by.} other {{name}’s “{range}” has # columns, so there’s no column {column, number} to sort by.}}',
          id: 'oeD5VSD6gP',
        },
        {
          name: tell.name,
          range: tell.range,
          columns: tell.columns,
          column: tell.column,
        },
      );
    case 'orderNotRead':
      return translateMessage(
        {
          defaultMessage: 'Set {name}’s “{order}” to 1 for ascending or -1 for descending.',
          id: 'Y5h0d9X/tY',
        },
        {
          name: tell.name,
          order: tell.order,
        },
      );
    case 'functionCodeSkipsHiddenRows':
      return translateMessage(
        {
          defaultMessage: '{name} can’t skip hidden rows. Use {codeToUse} instead of {functionCode} to include every row.',
          id: 'W5X1FUt+GZ',
        },
        {
          name: tell.name,
          functionCode: tell.functionCode,
          codeToUse: tell.codeThatCountsHiddenRows,
        },
      );
    case 'holdsANestedSubtotal':
      return translateMessage(
        {
          defaultMessage: 'This formula can’t include {cell}, which has its own SUBTOTAL or AGGREGATE. Leave it out of the range.',
          id: 'd6ArJZ41uF',
        },
        {
          cell: tell.cell,
        },
      );
    case 'filledByANestedSubtotal':
      return translateMessage(
        {
          defaultMessage:
            'This formula can’t include {cells}, which are filled by another formula with its own SUBTOTAL or AGGREGATE. Leave them out of the range.',
          id: '0WDKoJPuOP',
        },
        {
          cells: tell.cells,
        },
      );
    case 'argumentIsNoReference':
      return translateMessage(
        {
          defaultMessage: '{name}’s “{argument}” needs to be cells on a sheet, such as A1:A9.',
          id: 'FgTOXyDgrl',
        },
        {
          name: tell.name,
          argument: tell.argument,
        },
      );
    case 'wrongKindOrSize':
      return translateMessage({
        defaultMessage: 'Something gets a value of the wrong kind or size.',
        id: 'QEZpsGPTFm',
      });
    case 'quotationMarkNotClosed':
      return translateMessage({
        defaultMessage: 'A quotation mark isn’t closed.',
        id: 'nUgBovGqPL',
      });
    case 'parenthesisNotClosed':
      return translateMessage({
        defaultMessage: 'A parenthesis isn’t closed.',
        id: '1l/rFKppQZ',
      });
    case 'tooManyClosingParentheses':
      return translateMessage({
        defaultMessage: 'There are more closing parentheses than opening ones.',
        id: 'uytdineqB2',
      });
    case 'noSuchSheet':
      return translateMessage(
        {
          defaultMessage: 'There’s no sheet called “{name}”.',
          id: 'XG0E1IBjy/',
        },
        {
          name: tell.name,
        },
      );
    case 'noSuchCellInARange':
      return translateMessage(
        {
          defaultMessage: 'This sheet has no cell {address}.',
          id: 'DwXj9SJxOZ',
        },
        {
          address: tell.address,
        },
      );
    case 'curlyBracketNotClosed':
      return translateMessage({
        defaultMessage: 'A curly bracket isn’t closed.',
        id: 'QJp1r1dB0v',
      });
    case 'notOnlyValuesInCurlyBrackets':
      return translateMessage({
        defaultMessage: 'Curly brackets can hold only typed values, not cells or calculations.',
        id: 'WSCoCCdnil',
      });
    case 'rowsOfDifferentLengthsInCurlyBrackets':
      return translateMessage({
        defaultMessage: 'Each row in curly brackets needs the same number of values.',
        id: 'XcmQGFOxW1',
      });
    case 'wrongSignBetweenArguments':
      return tell.rightSign === ','
        ? translateMessage({
            defaultMessage: 'Separate arguments with commas, not semicolons.',
            id: '5Pq65XgVw/',
          })
        : translateMessage({
            defaultMessage: 'Separate arguments with semicolons, not commas.',
            id: 'uSWlRfp/2b',
          });
    case 'somethingMissingAtTheEnd':
      return translateMessage({
        defaultMessage: 'Something is missing at the end of the formula.',
        id: 'OWzDVEUz1G',
      });
    case 'readIfEnteredAgain':
      return translateMessage({
        defaultMessage: 'Sheets can read this formula now. Open the cell and press Enter to update it.',
        id: 'Wymb0fXZvK',
      });
    case 'filledCellInTheWay':
      return translateMessage(
        {
          defaultMessage: 'Clear {cell} to show all results.',
          id: 'T6w1DD/PIZ',
        },
        {
          cell: tell.cell,
        },
      );
    case 'filledCellsInTheWay':
      return translateMessage(
        {
          defaultMessage:
            '{count, plural, one {Clear the # filled cell in {cells} to show all results.} other {Clear the # filled cells in {cells} to show all results.}}',
          id: 'TmRczWtTCo',
        },
        {
          count: tell.count,
          cells: tell.cells,
        },
      );
    case 'fewFilledCellsOnTwoSidesInTheWay':
      return translateMessage(
        {
          defaultMessage: 'Clear {cells} to show all results.',
          id: '8fRbXzRp/h',
        },
        {
          cells: new Intl.ListFormat(MESSAGE_LOCALE).format(tell.cells),
        },
      );
    case 'manyFilledCellsOnTwoSidesInTheWay':
      return translateMessage(
        {
          defaultMessage:
            '{count, plural, one {Clear the # filled cell in the way to show all results.} other {Clear the # filled cells in the way to show all results.}}',
          id: 'ORzz5JDqFK',
        },
        {
          count: tell.count,
        },
      );
    case 'earlierFormulaKeepsTheCells':
      return translateMessage(
        {
          defaultMessage: '{cell} may need this space for its results.',
          id: 'ppm3MhkUXQ',
        },
        {
          cell: tell.cell,
        },
      );
    case 'sheetEndsTooSoon':
      return translateMessage({
        defaultMessage: 'Add rows or columns to show all results.',
        id: 'MiDw5l+7uI',
      });
    case 'tooManyArguments':
      return tell.isOnlyCount
        ? translateMessage(
            {
              defaultMessage:
                '{count, plural, =0 {{name} takes no arguments, but the formula gives it {given}.} one {{name} takes # argument, but the formula gives it {given}.} other {{name} takes # arguments, but the formula gives it {given}.}}',
              id: 'ehvsZhUrfx',
            },
            {
              name: tell.name,
              count: tell.most,
              given: tell.given,
            },
          )
        : translateMessage(
            {
              defaultMessage:
                '{most, plural, one {{name} takes at most # argument, but the formula gives it {given}.} other {{name} takes at most # arguments, but the formula gives it {given}.}}',
              id: 'hehkaL4gzn',
            },
            {
              name: tell.name,
              most: tell.most,
              given: tell.given,
            },
          );
  }
}
export const ERROR_DESCRIPTION_ID = 'error-description';
export const formulasTookTooLongWords = () =>
  translateMessage({
    defaultMessage: 'Formulas took too long. You can remove or simplify some to see results.',
    id: 'vz1MlW5UWL',
  });
export const errorExplanationWords = ({ code, tell }: ErrorExplanation, canEdit: boolean): string =>
  tell === null || (tell.cause === 'readIfEnteredAgain' && !canEdit) ? errorCodeExplanation(code, canEdit) : errorTellExplanation(tell, code);
