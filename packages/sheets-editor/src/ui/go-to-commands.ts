import type { SheetSizeAndOrder } from '../model/a1-references.ts';
import type { ColumnToGoTo } from '../formulas/column-offers.ts';
import type { SheetController } from '../state/controller.ts';
import type { PageEvent } from '../state/event-reducer.ts';
import type { ListedSheet } from '../view/page-view.ts';
import type { MenuCommand } from './search-menu/matching.ts';
import { parseA1AreaAsSeen, columnLabelEnds } from '../model/a1-references.ts';
import { areaToA1AsStored } from '../formulas/from-words/where.ts';
import { translateMessage } from '../i18n/messages.ts';
import { truncateGraphemes } from '../i18n/grid-action-labels.ts';
import { toolLabelWithValue } from '../tools/search-words.ts';
/** The places a typed name can go to: the sheet shown, the other sheets, and the columns of tables in sight. */
export interface PlacesToGoTo {
  sheet: SheetSizeAndOrder;
  listedSheets: readonly Pick<ListedSheet, 'sheetId' | 'name' | 'isShown'>[];
  columnsToGoTo: readonly ColumnToGoTo[];
}
export type GoToActions = Pick<SheetController, 'dispatch'>;
export function goToCellsCommands(typed: string, { sheet }: Pick<PlacesToGoTo, 'sheet'>, actions: GoToActions): MenuCommand[] {
  let area = parseA1AreaAsSeen(typed, sheet);
  if (area === null) return [];
  let { first: firstColumn, last: lastColumn } = columnLabelEnds(area);
  let cellsLabel = area.rowCount === sheet.rowCount ? `${firstColumn}:${lastColumn}` : areaToA1AsStored(area, sheet.ownRowOrder);
  let isOneCell = area.rowCount === 1 && area.columnCount === 1;
  return [
    goToCommandMaker(actions)('goTo.cells', cellsToGoToLabel(cellsLabel, isOneCell), {
      kind: 'cellsGoneTo',
      area,
    }),
  ];
}
export function goToSheetAndColumnCommands(typed: string, most: number, places: PlacesToGoTo, actions: GoToActions): MenuCommand[] {
  let typedWords = wordsOfLabel(typed);
  if (!typedWords.some((word) => word.length >= MIN_GO_TO_WORD_LENGTH)) return [];
  let headingCounts = new Map<string, number>();
  for (let { heading } of places.columnsToGoTo)
    headingCounts.set(isolatedShortName(heading), (headingCounts.get(isolatedShortName(heading)) ?? 0) + 1);
  return [
    ...places.listedSheets
      .filter(({ isShown }) => !isShown)
      .map(
        ({ sheetId, name: sheetName }) =>
          goToCommandMaker(actions)(`goTo.sheet.${sheetId.replaceAll('.', '%2E')}`, sheetToGoToLabel(isolatedShortName(sheetName)), {
            kind: 'sheetChosen',
            sheetId,
            canPoint: false,
          }),
      ),
    ...places.columnsToGoTo.map(
      ({ heading, cells }) =>
        goToCommandMaker(actions)(
          `goTo.column.${areaToA1AsStored(cells, null)}`,
          (headingCounts.get(isolatedShortName(heading)) ?? 0) > 1
            ? columnWithCellsToGoToLabel(isolatedShortName(heading), areaToA1AsStored(cells, places.sheet.ownRowOrder))
            : columnToGoToLabel(isolatedShortName(heading)),
          {
            kind: 'cellsGoneTo',
            area: cells,
          },
        ),
    ),
  ]
    .filter(({ label }) => {
      let labelWords = wordsOfLabel(label);
      return typedWords.every((typedWord) => labelWords.some((labelWord) => labelWord.startsWith(typedWord)));
    })
    .slice(0, most);
}
export const goToLabel = (): string =>
  translateMessage({
    defaultMessage: 'Go to',
    id: 'sEkOesbgxD',
  });
export const cellsToGoToLabel = (cells: string, isOneCell: boolean): string =>
  isOneCell
    ? translateMessage(
        {
          defaultMessage: 'Cell {cells}',
          id: '60XybrQKzd',
        },
        {
          cells,
        },
      )
    : translateMessage(
        {
          defaultMessage: 'Cells {cells}',
          id: '8ekhz6lHQ3',
        },
        {
          cells,
        },
      );
export const sheetToGoToLabel = (sheetName: string): string =>
  translateMessage(
    {
      defaultMessage: 'Sheet “{name}”',
      id: '/ZLkuH42A+',
    },
    {
      name: sheetName,
    },
  );
export const columnToGoToLabel = (heading: string): string =>
  translateMessage(
    {
      defaultMessage: 'Column “{heading}”',
      id: 'ERUM3VYbgm',
    },
    {
      heading,
    },
  );
export const columnWithCellsToGoToLabel = (heading: string, cells: string): string =>
  translateMessage(
    {
      defaultMessage: 'Column “{heading}” ({cells})',
      id: 'JT8oHmj63k',
    },
    {
      heading,
      cells,
    },
  );
export const wordsOfLabel = (label: string): string[] =>
  label
    .normalize('NFD')
    .replaceAll(/\p{M}/gu, '')
    .toLowerCase()
    .replaceAll('’', "'")
    .split(/[^\p{L}\p{N}']+/u)
    .filter((word) => word !== '');
export const MIN_GO_TO_WORD_LENGTH = 2;
export const MAX_GO_TO_NAME_LENGTH = 60;
export const isolatedShortName = (label: string): string => `⁨${truncateGraphemes(label, MAX_GO_TO_NAME_LENGTH)}⁩`;
export const goToCommandMaker =
  ({ dispatch }: GoToActions) =>
  (id: string, label: string, action: PageEvent): MenuCommand => ({
    id,
    label: toolLabelWithValue(goToLabel(), label),
    icon: null,
    actsOn: 'goesTo',
    whyNot: null,
    run: () => dispatch(action),
  });
