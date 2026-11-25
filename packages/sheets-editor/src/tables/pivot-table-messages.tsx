import { Button } from '../kit/button.tsx';
import { Icon } from '../kit/icon.tsx';
import { ContentsBox } from '../ui/contents-box.tsx';
import { preventMouseDownDefault } from '../ui/dom-events.ts';
import { translateMessage } from '../i18n/messages.ts';
import * as React from 'react';
import type { PivotOrder, PivotPeriod, PivotTotal } from '@open-artifact/sheets-core';
import type { StyleWithVariables } from '../grid/cell-drawing.tsx';
import type { PivotFilterBy, PivotSectionName } from './pivot-tables.ts';
export interface PivotTableOutOfDateBarProps {
  /** `null` when the pivot table cannot be updated from here. */
  onUpdate: (() => void) | null;
  onKeyDown: (keyEvent: React.KeyboardEvent) => void;
  className: string;
  style: StyleWithVariables;
  ref: React.Ref<HTMLFieldSetElement>;
}
export function pivotSectionLabel(section: PivotSectionName): string {
  switch (section) {
    case 'rows':
      return translateMessage({
        defaultMessage: 'Rows',
        id: 'gDstDrJycv',
      });
    case 'columns':
      return translateMessage({
        defaultMessage: 'Columns',
        id: 'epPlIwCdI+',
      });
    case 'values':
      return translateMessage({
        defaultMessage: 'Values',
        id: 'LJpjQ1J484',
      });
    case 'filters':
      return translateMessage({
        defaultMessage: 'Filters',
        id: 'IV2xywu5+e',
      });
  }
}
export function pivotAddToSectionLabel(section: PivotSectionName): string {
  switch (section) {
    case 'rows':
      return translateMessage({
        defaultMessage: 'Add to Rows',
        id: '6bfHFrVnbg',
      });
    case 'columns':
      return translateMessage({
        defaultMessage: 'Add to Columns',
        id: '3Aq7UOM0dD',
      });
    case 'values':
      return translateMessage({
        defaultMessage: 'Add to Values',
        id: 'GhQ2n0GIdk',
      });
    case 'filters':
      return translateMessage({
        defaultMessage: 'Add to Filters',
        id: 'lw8MU6fqxF',
      });
  }
}
export function pivotTotalLabel(total: PivotTotal): string {
  switch (total) {
    case 'sum':
      return translateMessage({
        defaultMessage: 'Sum',
        id: 'Udl/V3vsTY',
      });
    case 'count':
      return translateMessage({
        defaultMessage: 'Count',
        id: 'aHRSV/Llzt',
      });
    case 'distinctCount':
      return translateMessage({
        defaultMessage: 'Distinct count',
        id: 'k/ET9+yJu/',
      });
    case 'average':
      return translateMessage({
        defaultMessage: 'Average',
        id: 'hX669dz3em',
      });
    case 'min':
      return translateMessage({
        defaultMessage: 'Smallest',
        id: '+mWUEW70FF',
      });
    case 'max':
      return translateMessage({
        defaultMessage: 'Largest',
        id: 'jZu9DpTZkK',
      });
    case 'shareOfTotal':
      return translateMessage({
        defaultMessage: '% of total',
        id: 'MGuYCUYYiN',
      });
  }
}
export function pivotPeriodLabel(by: PivotPeriod | null): string {
  switch (by) {
    case null:
      return translateMessage({
        defaultMessage: 'Each value',
        id: 'hb/dblR2Wm',
      });
    case 'day':
      return translateMessage({
        defaultMessage: 'Day',
        id: 'bH5JvtfJvz',
      });
    case 'month':
      return translateMessage({
        defaultMessage: 'Month',
        id: '79lt3AmWyG',
      });
    case 'quarter':
      return translateMessage({
        defaultMessage: 'Quarter',
        id: 'fKYnMMPqZu',
      });
    case 'year':
      return translateMessage({
        defaultMessage: 'Year',
        id: 'LB93qUZAqw',
      });
  }
}
export function pivotOrderLabel(order: PivotOrder): string {
  switch (order) {
    case 'ascending':
      return translateMessage({
        defaultMessage: 'Ascending',
        id: 'bKGtz5CqIN',
      });
    case 'descending':
      return translateMessage({
        defaultMessage: 'Descending',
        id: 'GXSgmKwNuq',
      });
  }
}
export function pivotOrderByValueLabel(order: PivotOrder | null): string {
  switch (order) {
    case null:
      return translateMessage({
        defaultMessage: 'Don’t sort',
        id: 'UyURd7qxXC',
      });
    case 'descending':
      return translateMessage({
        defaultMessage: 'Largest first',
        id: 'Kc8MTcYbon',
      });
    case 'ascending':
      return translateMessage({
        defaultMessage: 'Smallest first',
        id: 'iBEc7ThkOM',
      });
  }
}
export function pivotFilterKeepsLabel({ keeps, count }: Pick<Extract<PivotFilterBy, { kind: 'values' }>, 'keeps' | 'count'>): string {
  switch (keeps) {
    case 'all':
      return translateMessage({
        defaultMessage: 'All values',
        id: 'PVLTo4ANGW',
      });
    case 'oneOf':
      return translateMessage(
        {
          defaultMessage: '{count, plural, one {# value selected} other {# values selected}}',
          id: '3oC1O3uD38',
        },
        {
          count,
        },
      );
    case 'noneOf':
      return translateMessage(
        {
          defaultMessage: '{count, plural, one {# value left out} other {# values left out}}',
          id: 'TaJ0uHKqb2',
        },
        {
          count,
        },
      );
  }
}
export const pivotTableMessages = {
  pivotTable: (): string =>
    translateMessage({
      defaultMessage: 'Pivot table',
      id: 'UyFVPEGWOA',
    }),
  edit: (): string =>
    translateMessage({
      defaultMessage: 'Edit pivot table',
      id: 'dFRKh9ezfS',
    }),
  nameOfNewSheet: (): string =>
    translateMessage({
      defaultMessage: 'Pivot table',
      id: 'HJAallVPqg',
    }),
  order: (): string =>
    translateMessage({
      defaultMessage: 'Order',
      id: 'rqf2wZqWjn',
    }),
  groupDatesBy: (): string =>
    translateMessage({
      defaultMessage: 'Group dates by',
      id: 'qtxPpvQCq6',
    }),
  summarizeBy: (): string =>
    translateMessage({
      defaultMessage: 'Summarize by',
      id: 'vBVM604RYV',
    }),
  sortRowsByThis: (): string =>
    translateMessage({
      defaultMessage: 'Sort rows by this',
      id: 'YxVpMT2sCX',
    }),
  heading: (): string =>
    translateMessage({
      defaultMessage: 'Heading',
      id: 'u/c8x0k6Cd',
    }),
  keepSelectedValues: (): string =>
    translateMessage({
      defaultMessage: 'Keep selected values',
      id: 'r991RmHGk1',
    }),
  matchACell: (): string =>
    translateMessage({
      defaultMessage: 'Match a cell',
      id: 'Jj6Y4VnwaA',
    }),
  cell: (): string =>
    translateMessage({
      defaultMessage: 'Cell',
      id: 'a5VQMRijXG',
    }),
  takeSelection: (): string =>
    translateMessage({
      defaultMessage: 'Use selection',
      id: '5IrW5EZkkD',
    }),
  blankCellKeepsAll: (): string =>
    translateMessage({
      defaultMessage: 'A blank cell keeps every row.',
      id: '89UN/LpG7w',
    }),
  cellNotFound: (): string =>
    translateMessage({
      defaultMessage: 'Enter one cell, or select a cell and press Use selection.',
      id: '1Gatrf70lf',
    }),
  oneValueWithColumns: (): string =>
    translateMessage({
      defaultMessage: 'With a field in Columns, a pivot table shows only one value.',
      id: 'drUdtPeVEg',
    }),
  outOfDate: (): string =>
    translateMessage({
      defaultMessage: 'The table has changed, so this pivot table is out of date.',
      id: 'PLdm/Vxiix',
    }),
  update: (): string =>
    translateMessage({
      defaultMessage: 'Update',
      id: 'q6LI88ju6I',
    }),
  notRead: (): string =>
    translateMessage({
      defaultMessage: 'This pivot table can’t be shown right now. Try again in a moment.',
      id: 'ks5wpdp3ah',
    }),
  tableNotClear: (): string =>
    translateMessage({
      defaultMessage:
        'The pane can’t edit this pivot table, because it isn’t clear which rows belong to its data. Unmerge cells and remove repeated headings and subtotals, then try again.',
      id: 'ViataDfmF5',
    }),
  cannotEdit: (): string =>
    translateMessage({
      defaultMessage: 'The pane can’t edit this pivot table’s formula. You can edit it in the cell.',
      id: 'WJvGGn+ek1',
    }),
};
export const pivotDataSourceLabel = (sheet: string, cells: string): string =>
  translateMessage(
    {
      defaultMessage: 'Data: {sheet}, {cells}',
      id: '4BrSBiy0yR',
    },
    {
      sheet,
      cells,
    },
  );
export const pivotRemoveFieldLabel = (column: string, section: string): string =>
  translateMessage(
    {
      defaultMessage: 'Remove {column} from {section}',
      id: 'r7iuHHfuJ7',
    },
    {
      column,
      section,
    },
  );
export const pivotChoiceLabel = (label: string, column: string, value: string): string =>
  translateMessage(
    {
      defaultMessage: '{label}, {column}: {value}',
      id: 'OfEllZb4Sf',
    },
    {
      label,
      column,
      value,
    },
  );
export const pivotFieldLabel = (label: string, column: string): string =>
  translateMessage(
    {
      defaultMessage: '{label}, {column}',
      id: 'RBsz9Ab7F4',
    },
    {
      label,
      column,
    },
  );
export const PivotTableOutOfDateBar = React.memo(function ({ onUpdate, onKeyDown, className, style, ref }: PivotTableOutOfDateBarProps) {
  let labelId = React.useId();
  return (
    <fieldset ref={ref} aria-labelledby={labelId} className={`sheet-own-filter-bar sheet-pivot-table-bar ${className}`} style={style}>
      <ContentsBox onMouseDown={preventMouseDownDefault} onKeyDown={onKeyDown}>
        <div className="sheet-own-filter-parts" data-stays-in-one-row>
          <span className="sheet-own-filter-glyph">
            <Icon name="Table" customSize={14} />
          </span>
          <span id={labelId} className="min-w-0 self-center">
            {pivotTableMessages.outOfDate()}
          </span>
          {onUpdate !== null && (
            <Button variant="secondary" size="xs" className="shrink-0 text-accent" onClick={onUpdate}>
              {pivotTableMessages.update()}
            </Button>
          )}
        </div>
      </ContentsBox>
    </fieldset>
  );
});
