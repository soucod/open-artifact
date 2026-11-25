import { TextInput } from '../kit/text-input.tsx';
import { Skeleton } from '../kit/skeleton.tsx';
import { Icon } from '../kit/icon.tsx';
import * as React from 'react';
import { translateMessage, MESSAGE_LOCALE } from '../i18n/messages.ts';
import { importMessages, intoSheetLabel } from '../messages/import.ts';
import {
  importDestinationOf,
  importPlacesLeft,
  destinationWithColumnsLeftOut,
  NOTHING_AS_THE_SHEET_HOLDS,
  importPlanAsShown,
  withoutAsTheSheetHolds,
} from './import-flow.ts';
import { importPlanSoFar, isImportPlanComing, isDestinationQuestionOpen, stoodByHandChanges } from './import-review.ts';
import { PANE_SELECT_HEIGHT_CLASSES, PaneRow, PANE_SELECT_TRIGGER_CLASSES, PaneSelectCaret, PaneSelect } from '../ui/side-pane/side-pane.tsx';
import { chosenAnswersOf, questionColumnIndexes } from './column-readings.ts';
import { readingsAsTheSheetHolds } from './places.ts';
import type { WorkbookReads } from '../model/workbook.ts';
import type { IconName } from '../kit/icon.tsx';
import type { ImportBeforePreview } from './import-flow.ts';
import type { NamesListedWithMore } from './csv-file.tsx';
import type { ImportHow, ImportOfAFile, ImportPlace } from '../state/initial-state.ts';
import type { ImportDestinationPick, ImportReading } from '../state/event-reducer.ts';
import type { SheetId } from '@open-artifact/sheets-core';
/** How a file can be imported: as a new sheet, or into a sheet in one of the ways. */
export type ImportHowChoice = 'newSheet' | ImportHow['kind'];
/** The icon of a way to import, and whether it is drawn turned. */
export interface ImportHowIcon {
  icon: IconName;
  isIconTurned?: boolean;
}
/** A name field that keeps a draft until Enter or leaving it, and drops it on Escape. */
export interface RenameFieldSetup {
  name: string;
  onNamed: (name: string) => void;
  onDone?: (field: HTMLInputElement) => void;
}
export interface NewSheetNameFieldProps {
  name: string;
  isOff: boolean;
  onNamed: (name: string) => void;
}
export interface ImportDestinationRowsProps {
  open: ImportOfAFile;
  isRead: boolean;
  onPicked: (picked: ImportDestinationPick) => void;
  onSheetNamed: (name: string) => void;
}
export interface ImportGhostGridProps {
  isGray: boolean;
}
export interface ImportWarningHeadlineProps {
  children: React.ReactNode;
}
export interface ImportCannotShowProps {
  headline: string;
  wayOn: string | null;
}
export let GHOST_GRID_COLUMNS: number;
export let GHOST_GRID_ROWS: number;
export function useRenameField({ name, onNamed, onDone }: RenameFieldSetup) {
  let [draft, setDraft] = React.useState<string | null>(null);
  let isFinishingRef = React.useRef(false);
  let commitName = () => {
    if (isFinishingRef.current) return;
    let trimmed = draft?.trim() ?? '';
    if (trimmed !== '' && trimmed !== name) onNamed(trimmed);
    setDraft(null);
  };
  return {
    value: draft ?? name,
    onChange: ({ currentTarget }: React.ChangeEvent<HTMLInputElement>) => setDraft(currentTarget.value),
    onBlur: commitName,
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key !== 'Enter' && event.key !== 'Escape') return;
      event.stopPropagation();
      event.preventDefault();
      if (event.key === 'Escape') setDraft(null);
      else commitName();
      isFinishingRef.current = true;
      onDone?.(event.currentTarget);
      isFinishingRef.current = false;
    },
  };
}
export function namesListedWithMore(names: string[]): NamesListedWithMore {
  let listed = names.length <= MAX_NAMES_LISTED + 1 ? names : names.slice(0, MAX_NAMES_LISTED);
  return {
    names: formatUnitList(listed.map(quotedLabel)),
    moreCount: names.length - listed.length,
  };
}
export function importHowLabel(how: ImportHowChoice) {
  switch (how) {
    case 'newSheet':
      return translateMessage({
        defaultMessage: 'New sheet',
        id: 'PpRu/+0n5E',
      });
    case 'addRows':
      return importMessages.addRows();
    case 'mergeByKey':
      return importMessages.merge();
    case 'replaceRows':
      return importMessages.replace();
  }
}
export function importHowDescription(how: ImportHowChoice) {
  switch (how) {
    case 'newSheet':
      return translateMessage({
        defaultMessage: 'Puts the file on a sheet of its own',
        id: 'J2P/Wh7yEy',
      });
    case 'addRows':
      return translateMessage({
        defaultMessage: 'Adds the file’s rows after the sheet’s rows',
        id: '9p1+TJvAR2',
      });
    case 'mergeByKey':
      return translateMessage({
        defaultMessage: 'Updates rows that match and adds the rest',
        id: 'V1EY64x2iV',
      });
    case 'replaceRows':
      return translateMessage({
        defaultMessage: 'Replaces the sheet’s rows with the file’s',
        id: 'CX0sUynxFt',
      });
  }
}
export function sheetToImportInto(open: ImportOfAFile) {
  let destination = importDestinationOf(open);
  let placesLeft = importPlacesLeft(open);
  return (
    (destination.kind === 'sheet' ? placesLeft.find(({ table }) => table.sheetId === destination.sheetId) : undefined) ??
    placesLeft[0]
  );
}
export function keyColumnName(open: ImportOfAFile, columnIndex: number) {
  let destination = importDestinationOf(open);
  let intoColumnId = destination.kind === 'sheet' ? destination.intoColumns[columnIndex] : undefined;
  return (
    sheetToImportInto(open)?.table.columns.find(({ columnId }) => columnId === intoColumnId)?.name ??
    importPlanSoFar(open).plan.columns[columnIndex]?.name ??
    ''
  );
}
export function keyColumnChoices(open: Pick<ImportOfAFile, 'plan' | 'destinationChosen'>, place: ImportPlace) {
  let { destination, destinationQuestion } = open.plan;
  let optionDestinations = (destinationQuestion?.options ?? []).map((option) => option.destination);
  let planKeyColumns = [importDestinationOf(open), destination, ...optionDestinations].flatMap(
    (someDestination) =>
      someDestination.kind === 'sheet' && someDestination.sheetId === place.table.sheetId && someDestination.how.kind === 'mergeByKey'
        ? [someDestination.how.keyColumnIndex]
        : [],
  );
  return [...new Set([...planKeyColumns, ...place.keys.map(({ keyColumnIndex }) => keyColumnIndex)])];
}
export function NewSheetNameField({ name, isOff, onNamed }: NewSheetNameFieldProps) {
  let labelId = React.useId();
  return <><TextInput fullWidth className={PANE_SELECT_HEIGHT_CLASSES.className} aria-labelledby={labelId} disabled={isOff} autoComplete="off" autoCorrect="off" spellCheck={false} {...useRenameField({
          name,
          onNamed,
        })} /><span id={labelId} hidden>{importSettingsLabels.nameOfNewSheet()}</span></>;
}
export function readingsAsTheSheetHoldsFor(open: ImportBeforePreview, reads: WorkbookReads): Record<number, ImportReading> | null {
  let destination = destinationWithColumnsLeftOut(open);
  if (destination.kind === 'newSheet') return NOTHING_AS_THE_SHEET_HOLDS;
  let place = importPlacesLeft(open).find(({ table }) => table.sheetId === destination.sheetId);
  let columnsLeftAlone = new Set([
    ...Object.entries(open.byHand.columns).flatMap(
      ([columnIndex, { reading }]) => (reading === undefined ? [] : [Number(columnIndex)]),
    ),
    ...chosenAnswersOf(open.plan, open.answers).flatMap(
      ({ question }) =>
        questionColumnIndexes(question).filter((columnIndex) => open.columnsAnswered.includes(columnIndex)),
    ),
    ...open.columnsAskedFor,
  ]);
  let keyColumnIndex = place === undefined ? undefined : keyColumnChoices(open, place)[0];
  if (!(keyColumnIndex !== undefined && (destination.intoColumns[keyColumnIndex] ?? null) !== null)) return NOTHING_AS_THE_SHEET_HOLDS;
  let shown = importPlanAsShown(withoutAsTheSheetHolds(open));
  return readingsAsTheSheetHolds(open.table, shown, destination, keyColumnIndex, columnsLeftAlone, reads);
}
export function importHowChoices(open: ImportOfAFile): ImportHowChoice[] {
  let sheet = sheetToImportInto(open);
  return ['newSheet', 'addRows', ...(sheet !== undefined && keyColumnChoices(open, sheet).length > 0 ? (['mergeByKey'] satisfies ImportHowChoice[]) : []), 'replaceRows'];
}
export function ImportDestinationRows({ open, isRead = false, onPicked, onSheetNamed }: ImportDestinationRowsProps) {
  let destination = importDestinationOf(open);
  let placesLeft = importPlacesLeft(open);
  let sheet = sheetToImportInto(open);
  let keyColumnOptions = sheet === undefined ? [] : keyColumnChoices(open, sheet);
  let [firstKeyColumn] = keyColumnOptions;
  let isPlanIn = !isImportPlanComing(open);
  let isOff = isRead || !isPlanIn || open.agent.kind === 'isAsked';
  let how: ImportHowChoice = destination.kind === 'newSheet' ? 'newSheet' : destination.how.kind;
  let keyColumnIndex = destination.kind === 'sheet' && destination.how.kind === 'mergeByKey' ? destination.how.keyColumnIndex : null;
  let pick = (
    howPicked: ImportHowChoice,
    sheetId: SheetId | undefined = sheet?.table.sheetId,
    keyColumn: number | undefined = keyColumnIndex ?? firstKeyColumn,
  ) => {
    if (howPicked === 'newSheet')
      return onPicked({
        kind: 'newSheet',
      });
    if (sheetId === undefined) return;
    if (howPicked !== 'mergeByKey')
      return onPicked({
        kind: 'sheet',
        sheetId,
        how: {
          kind: howPicked,
        },
      });
    if (keyColumn === undefined) return;
    return onPicked({
      kind: 'sheet',
      sheetId,
      how: {
        kind: howPicked,
        keyColumnIndex: keyColumn,
      },
    });
  };
  let isPickTold = isPlanIn && isDestinationQuestionOpen(open);
  if (!isPlanIn)
    return <PaneRow label={importSettingsLabels.importAs()}><button type="button" disabled aria-label={importSettingsLabels.importAs()} className={`${PANE_SELECT_TRIGGER_CLASSES.className} ${PANE_SELECT_HEIGHT_CLASSES.className}`}><span className="min-w-0 flex-1"><Skeleton decorative as="span" width="70%" className="text-body" /></span><PaneSelectCaret /></button></PaneRow>;
  let importAsRow = <PaneRow label={importSettingsLabels.importAs()} hasDot={isPickTold} isPointedAt={stoodByHandChanges(open).some(({ kind }) => kind === 'destination')}><PaneSelect name={importAsChosenName(importHowLabel(how), isPickTold)} {...(isPickTold && {
        isSamePickTold: true,
      })} isOff={isOff} value={how} items={importHowChoices(open).map(
        (howChoice) => ({
          value: howChoice,
          label: importHowLabel(howChoice),
          icon: IMPORT_HOW_ICONS[howChoice].icon,
          isIconTurned: IMPORT_HOW_ICONS[howChoice].isIconTurned === true,
          description: importHowDescription(howChoice),
        }),
      )} onChange={pick} /></PaneRow>;
  return <>{importAsRow}{how === 'newSheet' &&
        <PaneRow label={importSettingsLabels.name()} isPointedAt={stoodByHandChanges(open).some(({ kind }) => kind === 'sheetName')}><NewSheetNameField name={open.newSheet?.name ?? ''} isOff={isOff} onNamed={onSheetNamed} /></PaneRow>}{how !== 'newSheet' &&
        (<PaneRow label={importMessages.into()}><PaneSelect name={intoSheetLabel(sheet?.table.name ?? '')} {...(isPickTold && {
              isSamePickTold: true,
            })} isOff={isOff} hasLongRows value={sheet?.table.sheetId ?? ''} items={placesLeft.map(
              ({ table, matchedCount }) => ({
                value: table.sheetId,
                label: table.name,
                hint: matchedColumnsLabel(matchedCount, open.table.columnCount),
              }),
            )} onChange={(sheetId: SheetId) => {
              let place = placesLeft.find(({ table }) => table.sheetId === sheetId);
              if (place === undefined) return;
              let [keyColumn] = keyColumnChoices(open, place);
              pick(how === 'mergeByKey' && keyColumn === undefined ? 'addRows' : how, place.table.sheetId, keyColumn);
            }} /></PaneRow>)}{keyColumnIndex !== null &&
        (<PaneRow label={importSettingsLabels.matchBy()}><PaneSelect name={labelAndChosen(importSettingsLabels.matchBy(), keyColumnName(open, keyColumnIndex))} {...(isPickTold && {
              isSamePickTold: true,
            })} isOff={isOff} value={String(keyColumnIndex)} items={keyColumnOptions.map(
              (columnIndex) => ({
                value: String(columnIndex),
                label: keyColumnName(open, columnIndex),
              }),
            )} onChange={(columnIndex: string) => pick('mergeByKey', sheet?.table.sheetId, Number(columnIndex))} /></PaneRow>)}</>;
}
export function ImportGhostGrid({ isGray = false }: ImportGhostGridProps) {
  return <div aria-hidden className="sheet-import-ghost" data-is-gray={isGray || undefined}>{GHOST_GRID_CELLS}</div>;
}
export function ImportWarningHeadline({ children }: ImportWarningHeadlineProps) {
  return <p className="m-0 text-body font-medium text-balance text-primary"><span className="me-xs inline-flex h-[1lh] items-center align-top"><Icon name="WarningFilled" size="sm" /></span>{children}</p>;
}
export function ImportCannotShow({ headline, wayOn }: ImportCannotShowProps) {
  return <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden"><ImportGhostGrid isGray /><div className="relative m-auto flex flex-col items-center gap-sm px-xl text-center"><ImportWarningHeadline>{headline}</ImportWarningHeadline>{wayOn !== null &&
            <p className="m-0 text-body text-secondary">{wayOn}</p>}</div></div>;
}
export const summaryByAgentLabel = (summary: string) =>
  translateMessage(
    {
      defaultMessage: 'Summary by Agent: {summary}',
      id: 'uveSNKwiRK',
    },
    {
      summary,
    },
  );
export const importSettingsLabels = {
  name: () =>
    translateMessage({
      defaultMessage: 'Name',
      id: '4pND26YoAZ',
    }),
  headings: () =>
    translateMessage({
      defaultMessage: 'Headings',
      id: 'i4RCq6UwPt',
    }),
  noHeadings: () =>
    translateMessage({
      defaultMessage: 'No headings',
      id: 'C0bcU/r2RV',
    }),
  importAs: () =>
    translateMessage({
      defaultMessage: 'Import as',
      id: 'tYHTYRU0cG',
    }),
  leftOut: () =>
    translateMessage({
      defaultMessage: 'Left out',
      id: 'ifkuBfOpqJ',
    }),
  nameOfNewSheet: () =>
    translateMessage({
      defaultMessage: 'Name of the new sheet',
      id: '0Xqu6C19NA',
    }),
  summary: () =>
    translateMessage({
      defaultMessage: 'Summary',
      id: 'lBe/xOYlTv',
    }),
  summaryByAgent: () =>
    translateMessage({
      defaultMessage: 'Summary by Agent',
      id: 'tt67oQyMwo',
    }),
  byAgent: () =>
    translateMessage({
      defaultMessage: 'By Agent',
      id: 'q725UmuovD',
    }),
  notCertain: () =>
    translateMessage({
      defaultMessage: 'Agent wasn’t certain of this one',
      id: 'oISmIkm6Yc',
    }),
  commaDecimal: () =>
    translateMessage({
      defaultMessage: 'Comma decimal',
      id: 'd8rDqVcaiq',
    }),
  periodDecimal: () =>
    translateMessage({
      defaultMessage: 'Period decimal',
      id: 'ImqFStOwMH',
    }),
  aboveTheHeadings: () =>
    translateMessage({
      defaultMessage: 'Above the headings, so it can’t be a row',
      id: 'pTrmByLX3R',
    }),
  matchBy: () =>
    translateMessage({
      defaultMessage: 'Match by',
      id: 'rruIXiLpHo',
    }),
};
export const labelAndChosen = (label: string, chosen: string) =>
  translateMessage(
    {
      defaultMessage: '{label}: {chosen}',
      id: 'UQE+W02iZS',
    },
    {
      label,
      chosen,
    },
  );
export const labelAndExample = (label: string, example: string) =>
  translateMessage(
    {
      defaultMessage: '{label}, {example}',
      id: '7kha9HJI+B',
    },
    {
      label,
      example,
    },
  );
export const MAX_NAMES_LISTED = 3;
export const quotedLabel = (label: string) =>
  translateMessage(
    {
      defaultMessage: '“{label}”',
      id: '7jUVxZKdHl',
    },
    {
      label,
    },
  );
export const notCheckedYetLabel = (setting: string) =>
  translateMessage(
    {
      defaultMessage: '{setting} (not checked yet)',
      id: '8qxk+tj/BV',
    },
    {
      setting,
    },
  );
export const formatUnitList = (units: string[]) =>
  new Intl.ListFormat(MESSAGE_LOCALE, {
    type: 'unit',
  }).format(units);
export const importLineLabel = (line: number) =>
  translateMessage(
    {
      defaultMessage: 'Line {line, number, ::group-off}',
      id: 'B2IQKVKbaZ',
    },
    {
      line,
    },
  );
export const lineCountLabel = (count: number) =>
  translateMessage(
    {
      defaultMessage: '{count, plural, one {# line} other {{count, number} lines}}',
      id: 'mUK+QMyqHt',
    },
    {
      count,
    },
  );
export const moreLinesLeftOutLabel = (count: number) =>
  translateMessage(
    {
      defaultMessage: '{count, plural, one {# more line left out} other {{count, number} more lines left out}}',
      id: 'J6lNZIlsDS',
    },
    {
      count,
    },
  );
export const matchedColumnsLabel = (matchedCount: number, columnCount: number) =>
  translateMessage(
    {
      defaultMessage: '{matchedCount, number} of {columnCount, plural, one {# column matches} other {{columnCount, number} columns match}}',
      id: 'XVvs2pB+kf',
    },
    {
      matchedCount,
      columnCount,
    },
  );
export const plusCountLabel = (count: number) =>
  translateMessage(
    {
      defaultMessage: '+{count, number}',
      id: 'eBy7HukaxC',
    },
    {
      count,
    },
  );
export const optionNthLabel = (nth: number) =>
  translateMessage(
    {
      defaultMessage: 'Option {nth, number, ::group-off}',
      id: '1GjLqGdE7u',
    },
    {
      nth,
    },
  );
export const IMPORT_HOW_ICONS: Record<ImportHowChoice, ImportHowIcon> = {
  newSheet: {
    icon: 'FileAdd',
  },
  addRows: {
    icon: 'TableRowInsertBelow',
  },
  mergeByKey: {
    icon: 'ArrowsIn',
    isIconTurned: true,
  },
  replaceRows: {
    icon: 'ArrowClockwise',
  },
};
export const importAsChosenName = (chosen: string, isPickTold: boolean) => {
  let label = labelAndChosen(importSettingsLabels.importAs(), chosen);
  return isPickTold ? notCheckedYetLabel(label) : label;
};
[GHOST_GRID_COLUMNS, GHOST_GRID_ROWS] = [12, 32];
export const GHOST_BAR_WIDTHS = [62, 40, 78, 52, 34, 70, 46];
export const GHOST_GRID_CELLS = Array.from(
  {
    length: GHOST_GRID_ROWS * GHOST_GRID_COLUMNS,
  },
  (unused, cellIndex) =>
    <div key={cellIndex} className="sheet-import-ghost-cell" {...(cellIndex < GHOST_GRID_COLUMNS && {
          'data-is-name': true,
        })}><span className="sheet-import-ghost-bar" style={{
            width: `${cellIndex % GHOST_GRID_COLUMNS === 0 ? 40 : GHOST_BAR_WIDTHS[cellIndex % GHOST_BAR_WIDTHS.length]}%`,
          }} /></div>,
);
