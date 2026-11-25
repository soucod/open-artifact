import type { GroupDone, GroupsDone, ShownToLevelDone } from '../state/initial-state.ts';
import type { LabelEnds } from '../model/a1-references.ts';
import type { LinesAxisName } from '../grid/geometry.ts';
import type { SelectedRangeView } from '../view/page-view.ts';
import { translateMessage } from '../i18n/messages.ts';

/** Rows or columns between two labels, such as a group of lines. */
export interface LabelledLineSpan extends LabelEnds {
  of: LinesAxisName;
}

export function lineGroupsDoneWords(done: GroupDone | GroupsDone | ShownToLevelDone): string {
  switch (done.what) {
    case 'grouped':
      return translateMessage(
        {
          defaultMessage:
            '{lines, select, row {Grouped row {first}} rows {Grouped rows {first} to {last}} column {Grouped column {first}} other {Grouped columns {first} to {last}}}',
          id: 'YHS9JEriFr',
        },
        {
          lines: lineSpanSelector(done),
          first: done.first,
          last: done.last,
        },
      );
    case 'ungrouped':
      return translateMessage(
        {
          defaultMessage:
            '{lines, select, row {Ungrouped row {first}} rows {Ungrouped rows {first} to {last}} column {Ungrouped column {first}} other {Ungrouped columns {first} to {last}}}',
          id: 'OuNRtYOTaC',
        },
        {
          lines: lineSpanSelector(done),
          first: done.first,
          last: done.last,
        },
      );
    case 'collapsed':
      return translateMessage(
        {
          defaultMessage:
            '{lines, select, row {Collapsed row {first}} rows {Collapsed rows {first} to {last}} column {Collapsed column {first}} other {Collapsed columns {first} to {last}}}',
          id: 'Hpdz1fpdch',
        },
        {
          lines: lineSpanSelector(done),
          first: done.first,
          last: done.last,
        },
      );
    case 'expanded':
      return translateMessage(
        {
          defaultMessage:
            '{lines, select, row {Expanded row {first}} rows {Expanded rows {first} to {last}} column {Expanded column {first}} other {Expanded columns {first} to {last}}}',
          id: 'FekjZ5EuWc',
        },
        {
          lines: lineSpanSelector(done),
          first: done.first,
          last: done.last,
        },
      );
    case 'groupsCollapsed':
      return translateMessage(
        {
          defaultMessage: '{count, plural, one {Collapsed # group} other {Collapsed # groups}}',
          id: '8Om7/aVATP',
        },
        {
          count: done.groupCount,
        },
      );
    case 'groupsExpanded':
      return translateMessage(
        {
          defaultMessage: '{count, plural, one {Expanded # group} other {Expanded # groups}}',
          id: 'ZCMN3XxE5Z',
        },
        {
          count: done.groupCount,
        },
      );
    case 'shownToLevel':
      return done.of === 'rows'
        ? translateMessage(
            {
              defaultMessage: 'Showing rows to level {level}',
              id: 'JwkAEyC0RI',
            },
            {
              level: done.level,
            },
          )
        : translateMessage(
            {
              defaultMessage: 'Showing columns to level {level}',
              id: 'R9JR1M/13L',
            },
            {
              level: done.level,
            },
          );
  }
}
export function selectionWithHiddenLinesWords(cellsWords: string, { rowCount, columnCount }: SelectedRangeView['outOfSight']): string {
  if (columnCount === 0)
    return translateMessage(
      {
        defaultMessage: '{count, plural, one {{cells} selected, # row hidden} other {{cells} selected, # rows hidden}}',
        id: 'JSzXTgUyuC',
      },
      {
        cells: cellsWords,
        count: rowCount,
      },
    );
  if (rowCount === 0)
    return translateMessage(
      {
        defaultMessage: '{count, plural, one {{cells} selected, # column hidden} other {{cells} selected, # columns hidden}}',
        id: '8CN/nA2CZp',
      },
      {
        cells: cellsWords,
        count: columnCount,
      },
    );
  return translateMessage(
    {
      defaultMessage: '{cells} selected. {rows}. {columns}',
      id: 'IkC8TgrEdV',
    },
    {
      cells: cellsWords,
      rows: translateMessage(
        {
          defaultMessage: '{count, plural, one {# row hidden} other {# rows hidden}}',
          id: 'In4UBr19sw',
        },
        {
          count: rowCount,
        },
      ),
      columns: translateMessage(
        {
          defaultMessage: '{count, plural, one {# column hidden} other {# columns hidden}}',
          id: 'QXs47o5Ff2',
        },
        {
          count: columnCount,
        },
      ),
    },
  );
}
export const groupLinesLabel = (lineKind: LinesAxisName, count: number): string =>
  lineKind === 'rows'
    ? translateMessage(
        {
          defaultMessage: '{count, plural, one {Group row} other {Group # rows}}',
          id: '3Ru98v1OIb',
        },
        {
          count,
        },
      )
    : translateMessage(
        {
          defaultMessage: '{count, plural, one {Group column} other {Group # columns}}',
          id: 'GRN3/UTdpf',
        },
        {
          count,
        },
      );
export const ungroupLinesLabel = (lineKind: LinesAxisName): string =>
  lineKind === 'rows'
    ? translateMessage({
        defaultMessage: 'Ungroup rows',
        id: 'T2rVfr8nPx',
      })
    : translateMessage({
        defaultMessage: 'Ungroup columns',
        id: 'cKLFkMRM8y',
      });
export const collapseGroupsLabel = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, one {Collapse group} other {Collapse # groups}}',
      id: '3iaLsDqmvY',
    },
    {
      count,
    },
  );
export const expandGroupsLabel = (count: number): string =>
  translateMessage(
    {
      defaultMessage: '{count, plural, one {Expand group} other {Expand # groups}}',
      id: 'Rvc68E31Je',
    },
    {
      count,
    },
  );
export const lineSpanSelector = ({ of: lineKind, first, last }: LabelledLineSpan): 'row' | 'rows' | 'column' | 'columns' =>
  lineKind === 'rows' ? (first === last ? 'row' : 'rows') : first === last ? 'column' : 'columns';
export const toggleGroupLabel = (group: LabelledLineSpan, isCollapsed: boolean): string =>
  isCollapsed
    ? translateMessage(
        {
          defaultMessage:
            '{lines, select, row {Expand row {first}} rows {Expand rows {first} to {last}} column {Expand column {first}} other {Expand columns {first} to {last}}}',
          id: 'cDM0L5QUGC',
        },
        {
          lines: lineSpanSelector(group),
          first: group.first,
          last: group.last,
        },
      )
    : translateMessage(
        {
          defaultMessage:
            '{lines, select, row {Collapse row {first}} rows {Collapse rows {first} to {last}} column {Collapse column {first}} other {Collapse columns {first} to {last}}}',
          id: 'BUNmXbBuQs',
        },
        {
          lines: lineSpanSelector(group),
          first: group.first,
          last: group.last,
        },
      );
export const showToLevelLabel = (lineKind: LinesAxisName, level: number): string =>
  lineKind === 'rows'
    ? translateMessage(
        {
          defaultMessage: 'Show rows to level {level}',
          id: 'nroq0TuraU',
        },
        {
          level,
        },
      )
    : translateMessage(
        {
          defaultMessage: 'Show columns to level {level}',
          id: 'Spp8R16J6+',
        },
        {
          level,
        },
      );
export const lineGroupsLabel = (lineKind: LinesAxisName): string =>
  lineKind === 'rows'
    ? translateMessage({
        defaultMessage: 'Row groups',
        id: '6zau7ejw1I',
      })
    : translateMessage({
        defaultMessage: 'Column groups',
        id: 'aZfLZk8Loz',
      });
