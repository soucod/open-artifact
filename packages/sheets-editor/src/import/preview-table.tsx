import { Menu } from '../kit/menu.tsx';
import { Badge } from '../kit/badge.tsx';
import { Icon } from '../kit/icon.tsx';
import { Tooltip } from '../kit/tooltip.tsx';
import * as React from 'react';
import { Fragment } from 'react/jsx-runtime';
import {
  importLinesWithRowLabels,
  cellsStayTextWords,
  joinImportWordsWithCommas,
  columnReadingKindLabel,
  formatOfColumnLabel,
  columnReadingWithNoteLabel,
  kindWithNoteLabel,
  importColumnMessages,
  columnNameAndKindLabel,
  columnReadingLabel,
  rowAndLineOfFileLabel,
  lineOfFileLabel,
} from './csv-file.tsx';
import { translateMessage } from '../i18n/messages.ts';
import { MenuItemWithWhyOff } from '../ui/menu-item-why-off.tsx';
import { CellChip } from '../grid/cell-drawing.tsx';
import { cachedOptionChipColors } from '../format/cell-colors.ts';
import { MENU_CARETS } from '../ui/menu-trigger.tsx';
import { PANE_SELECT_TRIGGER_CLASSES, PANE_SELECT_HEIGHT_CLASSES, PaneSelectCaret } from '../ui/side-pane/side-pane.tsx';
import { notCheckedYetLabel } from './destination.tsx';
import { blockRepeatedEnterOrSpace } from '../ui/repeated-key-guards.ts';
import { dateShownAsForOrder } from './column-readings.ts';
import { importCellWasLabel, moreRowsChangeWords, rowsStayWords, importMessages, importRowChangeLabel } from '../messages/import.ts';
import { DrawnAndSaid } from '../agent/agent-rows.tsx';
import type { DateOrder } from '@open-artifact/sheets-core';
import type { IconName } from '../kit/icon.tsx';
import type { BadgeVariant } from '../kit/badge.tsx';
import type { ImportTextOnRow } from './csv-file.tsx';
import type {
  ImportDigitsLost,
  ImportIntoSheetChanges,
  ImportIntoSheetRow,
  ImportPreviewCell,
  ImportPreviewColumn,
  ImportReadingKind,
} from '../state/initial-state.ts';
import type { ImportChangeByHand, ImportReading } from '../state/event-reducer.ts';
/** Where a cell's content sits across it. */
export type ImportCellPlace = 'start' | 'middle' | 'end';
/** A change to a column of the file, as a menu of the column asks for it. */
type ColumnChange = Omit<Extract<ImportChangeByHand, { kind: 'column' }>, 'kind' | 'columnIndex'>;
interface KeptAsTextCountInBoxProps {
  count: number;
  /** How many digits wide the box is kept, so counts of a list line up. */
  digits: number;
}
/** What a tooltip about cells that stay text says. */
export interface KeptAsTextTooltipWords {
  picked: string;
  count: number;
  note?: string | null;
  cells: ImportTextOnRow[];
}
interface ReadingKindLabelProps {
  kind: ImportReading['kind'];
  label: string;
  isInPaneSelect: boolean;
}
interface ReadingKindMenuItemsProps {
  name: string;
  reading: ImportReading;
  keptAsTextCount: number;
  offered: ImportReadingKind[];
  noteUnderText?: string | null;
  onPicked: (reading: ImportReading) => void;
}
interface ImportCellContentProps {
  cell: ImportPreviewCell;
}
interface ColumnKindMenuProps {
  column: ImportPreviewColumn;
  kinds: ImportReadingKind[] | undefined;
  isLeftOut: boolean;
  mustComeIn: boolean;
  /** Whether the menu's button is the heading row's tab stop; null for a select in a side pane. */
  isTabStop: boolean | null;
  onKindsWanted: (columnIndex: number) => void;
  onChanged: ((change: ImportChangeByHand) => void) | null;
  /** The field that renames the column, or null where it can't be renamed. */
  nameField: (() => HTMLInputElement | undefined) | null;
  showsIconAlone?: boolean;
  isLeftOpen?: boolean;
  noteUnderText?: string | null;
  digitsOfCountInBox?: number | null;
  firstTextCells?: ImportTextOnRow[];
}
interface LineNumberMenuProps {
  rowNumber: number;
  line: number;
  becomes: 'names' | 'row';
  isLastRow: boolean;
  isOnlyRow: boolean;
  isTabStop: boolean;
  onChanged: ((change: ImportChangeByHand) => void) | null;
}
interface ImportChangedCellProps {
  cell: ImportIntoSheetRow['cells'][number];
}
interface ImportChangesTableProps {
  changes: ImportIntoSheetChanges;
}
export function KeptAsTextCountInBox(countInBox: KeptAsTextCountInBoxProps) {
  return <span className="sheet-import-count-in-box text-caption text-muted" aria-hidden="true"><Icon name="TextT" size="xs" /><span style={{
          minInlineSize: `${countInBox.digits}ch`,
        }}>{countInBox.count}</span></span>;
}
export function keptAsTextTooltip({ picked, count, note = null, cells }: KeptAsTextTooltipWords) {
  let keptAsTextLines = importLinesWithRowLabels(cells, count);
  return {
    content: <span className="flex flex-wrap gap-x-1.5">{picked}{count > 0 &&
          <span className="text-secondary">{cellsStayTextWords(count)}</span>}{note !== null &&
          <span className="text-secondary">{note}</span>}</span>,
    ...(keptAsTextLines.lines.length > 0 && {
      detail: <span className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-1.5">{keptAsTextLines.lines.map(
            ({ row, text }) =>
              <React.Fragment key={row}><span className="text-primary">{row}</span><span dir="auto" className="truncate text-left">{text}</span></React.Fragment>,
          )}{keptAsTextLines.more !== null &&
            <span className="col-span-2">{keptAsTextLines.more}</span>}</span>,
    }),
  };
}
export function digitsNoteWords(digitsNote: ImportDigitsLost) {
  const { digits, count, filled } = digitsNote;
  if (digits === 'decimalPlaces') {
    const { shown } = digitsNote;
    if (shown === 0)
      return translateMessage(
        {
          defaultMessage:
            '{count, plural, one {# of {filled, number} has decimal places not shown} other {{count, number} of {filled, number} have decimal places not shown}}',
          id: 'affinMCpk3',
        },
        {
          count,
          filled,
        },
      );
    if (shown === 1)
      return translateMessage(
        {
          defaultMessage:
            '{count, plural, one {# of {filled, number} has more places than the 1 shown} other {{count, number} of {filled, number} have more places than the 1 shown}}',
          id: 'eX6lw/m5E4',
        },
        {
          count,
          filled,
        },
      );
    return translateMessage(
      {
        defaultMessage:
          '{count, plural, one {# of {filled, number} has more places than the {shown} shown} other {{count, number} of {filled, number} have more places than the {shown} shown}}',
        id: 'N3D0mONqPY',
      },
      {
        count,
        filled,
        shown,
      },
    );
  }
  const { isKept } = digitsNote;
  if (digits === 'leadingZeros')
    return isKept
      ? translateMessage(
          {
            defaultMessage:
              '{count, plural, one {# of {filled, number} keeps its leading 0} other {{count, number} of {filled, number} keep their leading 0}}',
            id: '44RLtQSXZp',
          },
          {
            count,
            filled,
          },
        )
      : translateMessage(
          {
            defaultMessage:
              '{count, plural, one {# of {filled, number} loses its leading 0} other {{count, number} of {filled, number} lose their leading 0}}',
            id: 'e3wN+03cZU',
          },
          {
            count,
            filled,
          },
        );
  return isKept
    ? translateMessage(
        {
          defaultMessage:
            '{count, plural, one {# of {filled, number} has over 15 digits, all kept} other {{count, number} of {filled, number} have over 15 digits, all kept}}',
          id: 'mM5zIVESoQ',
        },
        {
          count,
          filled,
        },
      )
    : translateMessage(
        {
          defaultMessage:
            '{count, plural, one {# of {filled, number} loses digits after the 15th} other {{count, number} of {filled, number} lose digits after the 15th}}',
          id: 'AhMffB8C5n',
        },
        {
          count,
          filled,
        },
      );
}
export function ReadingKindLabel({ kind, label, isInPaneSelect }: ReadingKindLabelProps) {
  return <span className={`flex min-w-0 items-center ${isInPaneSelect ? 'gap-1.5' : 'gap-xs'}`}><Icon name={READING_KIND_ICONS[kind].icon} size="sm" className="shrink-0 text-secondary" /><span className="min-w-0 truncate">{label}</span></span>;
}
export function ReadingKindMenuItems(props: ReadingKindMenuItemsProps) {
  let { name, reading, keptAsTextCount, offered, noteUnderText = null, onPicked } = props;
  let menuItemOf = (offer: ImportReadingKind) => {
    let { kind } = offer.reading;
    let isChecked = kind === reading.kind;
    let keptAsText = isChecked ? keptAsTextCount : offer.fitting > 0 ? offer.notFitting : 0;
    let notes = [
      ...offer.digits.map(digitsNoteWords),
      ...(keptAsText > 0 ? [cellsStayTextWords(keptAsText)] : []),
      ...(isChecked && kind === 'text' && noteUnderText !== null ? [noteUnderText] : []),
    ];
    return <MenuItemWithWhyOff key={kind} icon={READING_KIND_ICONS[kind].icon} checked={isChecked} checkedRole="radio" description={notes.length === 0 ? null : joinImportWordsWithCommas(notes)} disabled={offer.fitting === 0 && offer.notFitting > 0 && !isChecked && !offer.isAgentsPick} whyOff={formatSuggestionLabels.doesNotFit()} {...(offer.example !== null && {
          hint: offer.example,
          hintDir: 'auto',
        })} onClick={() => {
          if (!isChecked) onPicked(offer.reading);
        }}>{columnReadingKindLabel(kind)}{offer.isAgentsPick &&
            <span className="sr-only">{' '}{formatSuggestionLabels.suggestedByAgent()}</span>}</MenuItemWithWhyOff>;
  };
  let agentsPicks = offered.filter((offer) => offer.isAgentsPick);
  if (agentsPicks.length === 0)
    return <Menu.Group><Menu.GroupLabel>{formatOfColumnLabel(name)}</Menu.GroupLabel>{offered.map(menuItemOf)}</Menu.Group>;
  return <Menu.Group aria-label={formatOfColumnLabel(name)}><SuggestedByAgentHeader />{agentsPicks.map(menuItemOf)}<Menu.Separator /><Menu.Header>{formatSuggestionLabels.otherFormats()}</Menu.Header>{offered.filter((offer) => !offer.isAgentsPick).map(menuItemOf)}</Menu.Group>;
}
export function alignmentOfReading({ kind }: Pick<ImportReading, 'kind'>): ImportCellPlace {
  if (kind === 'text' || kind === 'dropdown') return 'start';
  return kind === 'trueOrFalse' ? 'middle' : 'end';
}
export function ImportCellContent({ cell }: ImportCellContentProps) {
  if (cell.kind === 'blank') return '';
  if (cell.kind !== 'option') return cell.shown;
  return <CellChip optionPaints={cachedOptionChipColors(cell.color)} fillsCell after={MENU_CARETS.chipInCell}>{cell.shown}</CellChip>;
}
export function ColumnKindMenu({
  column: { columnIndex, name, reading, optionCount, keptAsTextCount },
  kinds,
  isLeftOut,
  mustComeIn,
  isTabStop,
  onKindsWanted,
  onChanged,
  nameField,
  showsIconAlone = false,
  isLeftOpen = false,
  noteUnderText = null,
  digitsOfCountInBox = null,
  firstTextCells = NO_FIRST_TEXT_CELLS,
}: ColumnKindMenuProps) {
  let wantsRenameRef = React.useRef(false);
  let changeColumn = (change: ColumnChange) =>
    onChanged?.({
      kind: 'column',
      columnIndex,
      ...change,
    });
  let readingLabel = readingLabelOfColumn({
    reading,
    optionCount,
  });
  let readingDescription = columnReadingWithNoteLabel(reading, optionCount, keptAsTextCount);
  let readingTitle = noteUnderText === null ? readingDescription : kindWithNoteLabel(readingDescription, noteUnderText);
  let shownLabel = isLeftOut ? importColumnMessages.leftOut() : readingLabel;
  let offered: ImportReadingKind[] =
    kinds?.some((kind) => kind.reading.kind === reading.kind) === true
      ? kinds
      : [
          {
            reading,
            fitting: 0,
            notFitting: 0,
            isAgentsPick: false,
            digits: [],
            example: null,
          },
          ...(kinds ?? []),
        ];
  let trigger = <Menu.Trigger render={<button type="button" className={isTabStop === null ? `${PANE_SELECT_TRIGGER_CLASSES.className} ${PANE_SELECT_HEIGHT_CLASSES.className}` : 'sheet-import-cap'} {...(isTabStop !== null && {
        tabIndex: isTabStop ? 0 : -1,
      })} disabled={onChanged === null} aria-label={isLeftOpen
        ? notCheckedYetLabel(columnNameAndKindLabel(name, readingTitle))
        : columnNameAndKindLabel(name, isLeftOut ? shownLabel : readingTitle)} {...(isTabStop !== null && {
        title: readingTitle,
      })}><span className={`min-w-0 truncate ${isTabStop === null ? 'flex-1' : ''}`}>{isLeftOut
            ? shownLabel
            : <ReadingKindLabel kind={reading.kind} label={showsIconAlone ? '' : shownLabel} isInPaneSelect={isTabStop === null} />}</span>{digitsOfCountInBox !== null &&
          keptAsTextCount > 0 &&
          <KeptAsTextCountInBox count={keptAsTextCount} digits={digitsOfCountInBox} />}{isTabStop === null
          ? <PaneSelectCaret />
          : <Icon name="CaretDownSmall" size="sm" className="shrink-0 text-muted" />}</button>} />;
  return <Menu.Root onOpenChange={(isOpen) => {
      if (isOpen) onKindsWanted(columnIndex);
    }}>{isTabStop === null
        ? (<Tooltip {...keptAsTextTooltip({
              picked: columnReadingLabel(reading, optionCount),
              count: keptAsTextCount,
              note: noteUnderText,
              cells: firstTextCells,
            })}>{trigger}</Tooltip>)
        : trigger}<Menu.Popup align="start" className="w-[21rem] max-w-[var(--available-width)]" onKeyDownCapture={blockRepeatedEnterOrSpace} finalFocus={() => {
          let nameInput = wantsRenameRef.current ? nameField?.() : undefined;
          wantsRenameRef.current = false;
          nameInput?.select();
          return nameInput ?? true;
        }}><ReadingKindMenuItems name={name} reading={reading} keptAsTextCount={keptAsTextCount} offered={offered} noteUnderText={noteUnderText} onPicked={(pickedReading) =>
              changeColumn({
                reading: pickedReading,
              })} />{(reading.kind === 'date' || reading.kind === 'dateAndTime') &&
            (<><Menu.Separator /><Menu.Group>{DATE_ORDER_CHOICES.map(
                    ([order, label, example]) =>
                      (<Menu.Item key={order} icon={null} checked={reading.order === order} checkedRole="radio" hint={example} onClick={() => {
                            if (order === reading.order) return;
                            changeColumn({
                              reading: {
                                ...reading,
                                order,
                                shownAs: dateShownAsForOrder(order),
                              },
                            });
                          }}>{label()}</Menu.Item>),
                  )}</Menu.Group></>)}<Menu.Separator />{nameField !== null &&
            <Menu.Item icon="Edit" onClick={() => void (wantsRenameRef.current = true)}>{importColumnMessages.rename()}</Menu.Item>}<Menu.Item icon={isLeftOut ? 'Eye' : 'EyeSlash'} disabled={mustComeIn && !isLeftOut} onClick={() =>
              changeColumn({
                isLeftOut: !isLeftOut,
              })}>{isLeftOut ? importColumnMessages.bringColumnBack() : importColumnMessages.leaveColumnOut()}</Menu.Item></Menu.Popup></Menu.Root>;
}
export function LineNumberMenu(props: LineNumberMenuProps) {
  let {
    rowNumber,
    line,
    becomes,
    isLastRow,
    isOnlyRow,
    isTabStop,
    onChanged,
  } = props;
  return <><Menu.Root><Menu.Trigger render={<button type="button" className="sheet-import-line-number" data-line={line} tabIndex={isTabStop ? 0 : -1} disabled={onChanged === null || (becomes === 'row' && isOnlyRow === true)} data-has-no-menu={(becomes === 'row' && isOnlyRow === true) || undefined} aria-label={rowAndLineOfFileLabel(rowNumber, line)}>{rowNumber}<Icon name="CaretRight" size="xs" className="sheet-import-line-caret" /></button>} /><Menu.Popup align="start" side="inline-end" className="min-w-[13rem]"><Menu.Group><Menu.GroupLabel>{lineOfFileLabel(line)}</Menu.GroupLabel>{becomes === 'names'
                ? (<Menu.Item onClick={() =>
                      onChanged?.({
                        kind: 'headings',
                        line: null,
                      })}>{importColumnMessages.notHeadings()}</Menu.Item>)
                : isLastRow !== true &&
                  (<Menu.Item icon="Heading1" onClick={() =>
                      onChanged?.({
                        kind: 'headings',
                        line,
                      })}>{importColumnMessages.asHeadings()}</Menu.Item>)}{becomes === 'row' &&
                isOnlyRow !== true &&
                (<Menu.Item icon="EyeSlash" onClick={() =>
                    onChanged?.({
                      kind: 'line',
                      line,
                      isLeftOut: true,
                    })}>{importColumnMessages.leaveRowOut()}</Menu.Item>)}</Menu.Group></Menu.Popup></Menu.Root></>;
}
export function ImportChangedCell({ cell: { cell, before } }: ImportChangedCellProps) {
  return <td data-place={CELL_KIND_ALIGNMENT[cell.kind]} {...(before !== null && {
      'data-is-changed': true,
    })}>{before !== null &&
        <span className="sheet-import-text sheet-import-was text-footnote"><span className="sr-only">{importCellWasLabel(before)}</span><s aria-hidden>{before}</s></span>}<span className="sheet-import-text"><ImportCellContent cell={cell} /></span></td>;
}
export const formatSuggestionLabels = {
  suggested: () =>
    translateMessage({
      defaultMessage: 'Suggested',
      id: 'K8UcT1+bHw',
    }),
  suggestedByAgent: () =>
    translateMessage({
      defaultMessage: 'Suggested by Agent',
      id: 'u19kydsgzq',
    }),
  otherFormats: () =>
    translateMessage({
      defaultMessage: 'Other formats',
      id: 'alGRTYEWzZ',
    }),
  doesNotFit: () =>
    translateMessage({
      defaultMessage: 'This format doesn’t fit this column',
      id: 'vYHd9sQ30d',
    }),
};
export const READING_KIND_ICONS: Record<ImportReading['kind'], { icon: IconName }> = {
  text: {
    icon: 'TextT',
  },
  number: {
    icon: 'Numbers',
  },
  currency: {
    icon: 'DollarSign',
  },
  percent: {
    icon: 'PercentSign',
  },
  date: {
    icon: 'Calendar',
  },
  dateAndTime: {
    icon: 'CalendarClock',
  },
  timeOfDay: {
    icon: 'Clock',
  },
  trueOrFalse: {
    icon: 'CheckSquare',
  },
  dropdown: {
    icon: 'Dropdown',
  },
};
export const SuggestedByAgentHeader = () =>
  <Menu.Header><DrawnAndSaid drawn={formatSuggestionLabels.suggested()} said={formatSuggestionLabels.suggestedByAgent()} /></Menu.Header>;
export const cascadeDelayStyle = (index: number) => ({
  animationDelay: `${Math.min(index * 60, 900)}ms`,
});
export const CELL_KIND_ALIGNMENT: Record<ImportPreviewCell['kind'], ImportCellPlace> = {
  blank: 'start',
  text: 'start',
  keptAsText: 'start',
  trueOrFalse: 'middle',
  number: 'end',
  option: 'start',
};
export const DATE_ORDER_CHOICES: [order: DateOrder, label: () => string, example: string][] = [
  ['dayMonthYear', importColumnMessages.dayFirst, '31/12/2026'],
  ['monthDayYear', importColumnMessages.monthFirst, '12/31/2026'],
  ['yearMonthDay', importColumnMessages.yearFirst, '2026-12-31'],
];
export const NO_FIRST_TEXT_CELLS: ImportTextOnRow[] = [];
export const readingLabelOfColumn = ({ reading, optionCount }: Pick<ImportPreviewColumn, 'reading' | 'optionCount'>) =>
  reading.kind === 'dropdown' ? columnReadingKindLabel('dropdown') : columnReadingWithNoteLabel(reading, optionCount, 0);
export const IMPORT_LINE_NUMBER_SELECTOR = '.sheet-import-line-number';
export const ROW_CHANGE_BADGE_VARIANTS: Record<ImportIntoSheetRow['kind'], BadgeVariant> = {
  added: 'success',
  changed: 'warning',
  gone: 'danger',
};
export const ImportChangesTable = React.memo(function ({ changes }: ImportChangesTableProps) {
  let { columns, rows } = changes;
  let footLines = [
    {
      about: 'more',
      line: moreRowsChangeWords(changes),
    },
    {
      about: 'stay',
      line: rowsStayWords(changes),
    },
  ].filter(({ line }) => line !== null);
  return <div className={`flex flex-col gap-sm ${rows.length > 0 ? '[&>p]:px-md' : 'pt-md [&>p]:px-xl'}`}>{rows.length > 0 &&
        (<div><table className="sheet-import-grid"><thead><tr><th scope="col">{importMessages.change()}</th>{columns.map(
                      ({ columnIndexInTheFile, name, reading }) =>
                        <th key={columnIndexInTheFile} scope="col" data-is-name data-place={alignmentOfReading(reading)}><span className="sheet-import-text" title={name}>{name}</span></th>,
                    )}</tr></thead><tbody>{rows.map(
                  ({ id, kind, cells }, rowIndex) =>
                    (<tr key={id} className="sheet-import-comes" data-change={kind} style={cascadeDelayStyle(rowIndex)}><th scope="row"><Badge variant={ROW_CHANGE_BADGE_VARIANTS[kind]}>{importRowChangeLabel(kind)}</Badge></th>{cells.map(
                            (cell, cellIndex) =>
                              <ImportChangedCell key={columns[cellIndex]?.columnIndexInTheFile ?? cellIndex} cell={cell} />,
                          )}</tr>),
                )}</tbody></table></div>)}{footLines.map(
        ({ about, line }) =>
          (<p key={`${about} under ${rows[0]?.id ?? ''}`} className="text-footnote text-secondary" {...(rows.length > 0 && {
                className: 'sheet-import-comes text-footnote text-secondary',
                style: cascadeDelayStyle(rows.length),
              })}>{line}</p>),
      )}</div>;
});
